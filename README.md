# LEONIDA ONLINE 3D

Browser-based 3D city game built with Three.js and a Node.js WebSocket server.

## Project layout

- `gta67.html` — game entry point, scene, player controls, driving physics, HUD, and WebSocket client.
- `server.js` — Node.js HTTP server, static asset hosting, and WebSocket rooms.
- `src/vehicle-assets.js` — cached GLTF loader, car model fitting, wheel-pivot animation, and distance-based detail LOD.
- `assets/cars/manifest.json` — runtime list of the five imported vehicles.
- `assets/cars/<vehicle-id>/` — one folder per vehicle, including `.gltf`, `.bin`, textures, and the original `license.txt`.
- `asset-sources/cars/` — original ZIP archives retained for future re-extraction.
- `.github/workflows/prepare-vehicle-assets.yml` — extracts the known vehicle ZIPs and regenerates the manifest.
- `.github/workflows/game-smoke-test.yml` — checks JavaScript syntax and verifies that the game and GLTF resources are served over HTTP.

## Current vehicle set

1. McLaren 650S GT3 — the first parked car near the initial spawn.
2. BMW M4 GT3 EVO G82.
3. Lamborghini Fenomeno.
4. BMW M1 Turbo.
5. Volkswagen Golf GTI (2025).

The other traffic vehicles are selected from the four non-McLaren models. Model selection is deterministic by traffic slot so connected clients load the same model for the same car ID.

## Running locally

Install the dependency and start the server:

```bash
npm install
npm start
```

Then open `http://localhost:3000/`.

The server serves the game, JavaScript modules, GLTF files, binary buffers, and textures from the repository directory.

## Adding or replacing vehicle assets

The current extraction workflow expects the five archive names already used in the repository. Keep each archive's internal folder structure intact. For a replacement, upload a new ZIP with the same expected filename to the repository root; the workflow extracts it into the matching folder under `assets/cars/` and regenerates `manifest.json`.

Before publishing an updated vehicle, preserve its `license.txt` and review the restrictions in [assets/cars/ATTRIBUTION.md](assets/cars/ATTRIBUTION.md). Three of the current models are licensed CC BY-NC-SA 4.0 and are not cleared for commercial use.
