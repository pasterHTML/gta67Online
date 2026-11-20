# City texture assets

The seven original ambientCG ZIP archives have been uploaded to the repository root. A GitHub Actions workflow extracts them into `assets/city/textures/` and moves their original ZIP archives into `asset-sources/city/`.

The workflow now stages the entire repository after extraction. This is important because moving a ZIP out of the repository root creates a tracked-file deletion as well as a new archived copy.

## Uploaded packs

- `Grass001_1K-JPG.zip` — grass ground surface
- `Road015A_1K-JPG.zip` — worn asphalt road
- `Concrete049_1K-JPG.zip` — sidewalk / exposed concrete
- `Plaster001_1K-JPG.zip` — clean building wall / stucco
- `Bark001_1K-JPG.zip` — tree bark
- `Leaf001_1K-JPG.zip` — leaf surface
- `Ground061_1K-JPG.zip` — beach sand

All seven ambientCG texture sets are CC0. The 1K-JPG packs are a suitable starting point for a browser game.

## Water surface pack (additional)

The existing water material is a tiny hand-drawn canvas texture. For a better surface, use the seamless **Water Surface PBR** pack from ProcTexture:

- Download page: https://proctexture.com/textures/water/surface-water/water-surface
- Direct 1K PBR ZIP: https://proctexture.com/pbr-packs/water/water-surface.zip
- Archive name expected by the workflow: `water-surface.zip`
- Maps: Base Color, Normal, Height, Roughness and AO
- Resolution: 1024x1024
- License: CC0

The ZIP is optional. Upload it to the repository root (next to `gta67.html`) and the same workflow will extract it to `assets/city/textures/water-surface/`.

A tileable PBR water material is not a water simulation by itself. Moving waves, reflections, Fresnel and shoreline foam are handled by the game shader.

## Folder layout

```
assets/city/textures/
  grass/
  asphalt/
  concrete/
  building-plaster/
  tree-bark/
  tree-leaves/
  beach-sand/
  water-surface/   # appears after uploading the optional water ZIP
  manifest.json
```

Do not manually rename the files inside a pack. The manifest records their original names so the game can load the correct PBR maps.
