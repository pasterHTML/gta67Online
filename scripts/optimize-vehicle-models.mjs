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

for (const vehicle of manifest.vehicles) {
  const folder = path.dirname(path.join(root, vehicle.model));
  const inputPath = path.join(folder, "scene.gltf");
  const outputPath = path.join(folder, "scene-optimized.glb");

  console.log("\nOptimizing " + vehicle.name);
  const inputStat = await fs.stat(inputPath);
  const document = await io.read(inputPath);

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

  await io.write(outputPath, document);
  const outputStat = await fs.stat(outputPath);

  vehicle.optimizedModel = path.relative(root, outputPath).split(path.sep).join("/");
  vehicle.optimizedFormat = "glb";
  vehicle.originalModelBytes = vehicle.modelBytes || inputStat.size;
  vehicle.optimizedBytes = outputStat.size;

  console.log(
    vehicle.name + ": source descriptor " + inputStat.size.toLocaleString() +
    " bytes, optimized GLB " + outputStat.size.toLocaleString() + " bytes"
  );
}

await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("\nVehicle optimization complete. Original GLTF assets were kept unchanged.");
