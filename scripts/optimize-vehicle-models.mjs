import fs from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

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
      } else if (entry.isFile() && entry.name !== "scene-optimized.glb") {
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

for (const vehicle of manifest.vehicles) {
  const folder = path.dirname(path.join(root, vehicle.model));
  const inputPath = path.join(folder, "scene.gltf");
  const outputPath = path.join(folder, "scene-optimized.glb");

  console.log("\nOptimizing " + vehicle.name);
  const originalFiles = await directoryStats(folder);
  const document = await io.read(inputPath);
  const before = geometryStats(document);

  await document.transform(
    dedup(),
    weld({}),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.62,
      error: 0.0025
    }),
    textureCompress({
      encoder: sharp,
      resize: [1024, 1024]
    }),
    prune()
  );

  const after = geometryStats(document);
  await io.write(outputPath, document);
  const outputStat = await fs.stat(outputPath);
  const triangleReduction = before.triangles > 0
    ? Math.round((1 - after.triangles / before.triangles) * 1000) / 10
    : 0;
  const byteReduction = originalFiles.bytes > 0
    ? Math.round((1 - outputStat.size / originalFiles.bytes) * 1000) / 10
    : 0;

  vehicle.optimizedModel = path.relative(root, outputPath).split(path.sep).join("/");
  vehicle.optimizedFormat = "glb";
  vehicle.originalAssetBytes = originalFiles.bytes;
  vehicle.originalAssetFiles = originalFiles.files;
  vehicle.optimizedBytes = outputStat.size;
  vehicle.sourceTriangles = before.triangles;
  vehicle.optimizedTriangles = after.triangles;
  vehicle.triangleReductionPercent = triangleReduction;
  vehicle.assetSizeReductionPercent = byteReduction;
  vehicle.sourceVertices = before.vertices;
  vehicle.optimizedVertices = after.vertices;
  vehicle.optimizedPrimitives = after.primitives;
  vehicle.textureMaxDimension = 1024;

  console.log(
    vehicle.name + ": " +
    before.triangles.toLocaleString() + " -> " +
    after.triangles.toLocaleString() + " triangles (" +
    triangleReduction + "% fewer), " +
    Math.round(originalFiles.bytes / 1048576 * 10) / 10 + " MiB -> " +
    Math.round(outputStat.size / 1048576 * 10) / 10 + " MiB (" +
    byteReduction + "% smaller)"
  );
}

await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("\nOptimization finished. Original GLTF, BIN, textures and license files remain unchanged.");
