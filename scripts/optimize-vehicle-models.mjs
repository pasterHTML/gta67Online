import fs from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const NEAR_LOD_TARGET_RATIO = 0.48;
const FAR_LOD_TARGET_RATIO = 0.09;
const root = process.cwd();
const manifestPath = path.join(root, "assets/cars/manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);

await MeshoptSimplifier.ready;

async function directoryStats(folder) {
  let bytes = 0;
  let files = 0;
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && !["scene-optimized.glb", "scene-lod.glb"].includes(entry.name)) {
        const stat = await fs.stat(full);
        bytes += stat.size;
        files++;
      }
    }
  }
  await walk(folder);
  return { bytes, files };
}

function geometryStats(document) {
  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (!position) continue;
      vertices += position.getCount();
      primitives++;
      if (primitive.getMode() === 4) {
        const indices = primitive.getIndices();
        triangles += indices ? indices.getCount() / 3 : position.getCount() / 3;
      }
    }
  }
  return { triangles: Math.round(triangles), vertices, primitives };
}

async function optimizeDocument(inputPath, outputPath, ratio, error, maxTextureSize) {
  const document = await io.read(inputPath);
  const before = geometryStats(document);
  await document.transform(
    dedup(),
    weld({}),
    simplify({ simplifier: MeshoptSimplifier, ratio, error }),
    textureCompress({ encoder: sharp, resize: [maxTextureSize, maxTextureSize] }),
    prune()
  );
  const after = geometryStats(document);
  await io.write(outputPath, document);
  const outputStat = await fs.stat(outputPath);
  return { before, after, bytes: outputStat.size };
}

for (const vehicle of manifest.vehicles) {
  const folder = path.dirname(path.join(root, vehicle.model));
  const inputPath = path.join(folder, "scene.gltf");
  const highPath = path.join(folder, "scene-optimized.glb");
  const farPath = path.join(folder, "scene-lod.glb");

  console.log("\nOptimizing " + vehicle.name);
  const originalFiles = await directoryStats(folder);

  const high = await optimizeDocument(inputPath, highPath, NEAR_LOD_TARGET_RATIO, 0.004, 768);
  const far = await optimizeDocument(inputPath, farPath, FAR_LOD_TARGET_RATIO, 0.016, 384);

  const highReduction = high.before.triangles > 0
    ? Math.round((1 - high.after.triangles / high.before.triangles) * 1000) / 10 : 0;
  const farReduction = far.before.triangles > 0
    ? Math.round((1 - far.after.triangles / far.before.triangles) * 1000) / 10 : 0;
  const highBytesReduction = originalFiles.bytes > 0
    ? Math.round((1 - high.bytes / originalFiles.bytes) * 1000) / 10 : 0;

  vehicle.optimizedModel = path.relative(root, highPath).split(path.sep).join("/");
  vehicle.farOptimizedModel = path.relative(root, farPath).split(path.sep).join("/");
  vehicle.optimizedFormat = "glb";
  vehicle.originalAssetBytes = originalFiles.bytes;
  vehicle.originalAssetFiles = originalFiles.files;
  vehicle.optimizedBytes = high.bytes;
  vehicle.farOptimizedBytes = far.bytes;
  vehicle.sourceTriangles = high.before.triangles;
  vehicle.optimizedTriangles = high.after.triangles;
  vehicle.farOptimizedTriangles = far.after.triangles;
  vehicle.triangleReductionPercent = highReduction;
  vehicle.farTriangleReductionPercent = farReduction;
  vehicle.assetSizeReductionPercent = highBytesReduction;
  vehicle.sourceVertices = high.before.vertices;
  vehicle.optimizedVertices = high.after.vertices;
  vehicle.farOptimizedVertices = far.after.vertices;
  vehicle.optimizedPrimitives = high.after.primitives;
  vehicle.textureMaxDimension = 768;
  vehicle.farTextureMaxDimension = 384;

  console.log(
    vehicle.name + ": " +
    high.before.triangles.toLocaleString() + " source -> " +
    high.after.triangles.toLocaleString() + " near -> " +
    far.after.triangles.toLocaleString() + " far triangles; " +
    highReduction + "% near reduction, " + farReduction + "% far reduction"
  );
  console.log(
    "  Full source: " + Math.round(originalFiles.bytes / 1048576 * 10) / 10 +
    " MiB; near GLB: " + Math.round(high.bytes / 1048576 * 10) / 10 +
    " MiB; far GLB: " + Math.round(far.bytes / 1048576 * 10) / 10 + " MiB"
  );
}

await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("\nNear and far LOD models generated. Original GLTF, BIN, textures and licenses remain unchanged.");
