# City texture assets

Upload the following ambientCG ZIP archives to the repository root (next to `gta67.html`):

- `Grass001_1K-JPG.zip` — grass ground surface
- `Road015A_1K-JPG.zip` — worn asphalt road
- `Concrete049_1K-JPG.zip` — sidewalk / exposed concrete
- `Plaster001_1K-JPG.zip` — clean building wall / stucco
- `Bark001_1K-JPG.zip` — tree bark
- `Leaf001_1K-JPG.zip` — leaf surface
- `Ground061_1K-JPG.zip` — lightly wet beach sand

The `prepare-city-textures.yml` workflow automatically extracts them to:

```
assets/city/textures/
  grass/
  asphalt/
  concrete/
  building-plaster/
  tree-bark/
  tree-leaves/
  beach-sand/
```

Original ZIPs are moved to `asset-sources/city/`. The workflow writes `manifest.json` with the source URLs and extracted map files.

All seven recommended ambientCG texture sets are published under CC0. The 1K-JPG packs are the smaller starting choice for a browser game; the material maps can be replaced with 2K versions later if close-up quality needs improvement.

Note: bark and leaf textures do not create tree geometry by themselves. The next environment pass will also need actual tree meshes or generated tree geometry.
