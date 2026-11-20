# LEONIDA ONLINE 3D

Browser-based 3D city game built with Three.js and a Node.js WebSocket server.

## Project layout

- `gta67.html` — game entry point, scene, player controls, driving physics, HUD, loading screen, and WebSocket client.
- `server.js` — Node.js HTTP server, static asset hosting, and WebSocket rooms.
- `src/vehicle-assets.js` — GLB loading, normalization, wheel-pivot animation, near/far LOD switching, and lazy detail streaming.
- `assets/cars/manifest.json` — runtime list of the five imported vehicles and their two optimized LOD paths.
- `assets/cars/<vehicle-id>/` — original GLTF, binary buffer, source textures, license file, optimized near GLB, and simplified far GLB.
- `asset-sources/cars/` — original ZIP archives retained for future re-extraction.
- `assets/city/README.md` — city PBR texture pack download names and folder layout.
- `.github/workflows/prepare-vehicle-assets.yml` — extracts the five vehicle ZIPs.
- `.github/workflows/optimize-vehicle-models.yml` — creates optimized near and far GLB versions, records triangle counts, and downsizes textures.
- `.github/workflows/prepare-city-textures.yml` — extracts city PBR texture ZIPs uploaded to the repository root.
- `.github/workflows/game-smoke-test.yml` — checks JavaScript syntax, model manifests, and HTTP delivery of near/far GLBs.

## Current vehicle set

1. McLaren 650S GT3 — first parked car near the starting position.
2. BMW M4 GT3 EVO G82.
3. Lamborghini Fenomeno.
4. BMW M1 Turbo.
5. Volkswagen Golf GTI (2025).

The four non-McLaren cars are selected deterministically by traffic slot so connected clients use the same model for the same car ID. Police cars use the Lamborghini model with a separate flashing lightbar.

### Vehicle LOD and loading

The game loads simplified far LOD versions first. A detailed near version is streamed when a car is within 58 game units of the player or becomes the active vehicle. The first detailed model is the McLaren near the start.

The near GLBs are simplified to a 0.62 target ratio and their texture maps are capped at 1024 px. Far LOD GLBs use a 0.15 target ratio and 512 px texture maps. Actual triangle counts are recorded in `assets/cars/manifest.json`. These ratios are simplification targets; the resulting count depends on each source mesh and its geometry.

Original GLTF sources and licenses remain unchanged. The near/far optimized GLBs are generated files and can be recreated by the optimizer workflow.

## Running locally

Install the dependency and start the server:

```bash
npm install
npm start
```

Then open `http://localhost:3000/`.

The server serves the game, JavaScript modules, GLB/GLTF files, binary buffers, and textures from the repository directory.

## Adding or replacing vehicle assets

The vehicle extraction workflow expects the five archive names already used in the repository. Keep each archive's internal folder structure intact. For a replacement, upload a ZIP with the expected filename to the repository root; the workflow extracts it into `assets/cars/<vehicle-id>/` and regenerates the manifest.

Before publishing an updated vehicle, preserve its `license.txt` and review [assets/cars/ATTRIBUTION.md](assets/cars/ATTRIBUTION.md). Three of the current models are licensed CC BY-NC-SA 4.0 and are not cleared for commercial use.

## Adding city PBR textures

Download the seven 1K-JPG ambientCG ZIPs listed in [assets/city/README.md](assets/city/README.md) and upload all ZIP files to the repository root (next to `gta67.html`). The city texture workflow will move the originals to `asset-sources/city/`, extract their maps into `assets/city/textures/`, and create a manifest. No folders need to be created manually.
