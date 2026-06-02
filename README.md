# SMV — Source Model Viewer

> A browser-based 3D model viewer for Valve's game engine family. No installation. No game files. Just drop a `.mdl` and go.

---

## What we're building

I realized that, to view a model file related with GoldSrc or different Source versions, you have to have corresponding model viewer application. I decided to why not create my own viewer. Claude may have overwritten things on the README and information may seem too robotic (which even I dont even understand some of them at all) but wanted to write this section myself. This tool aims to support all engine versions/branches at one place.

---

## Screenshots

<!-- Drop your screenshots here -->

| Empty state | Model loaded | With textures |
|:-----------:|:------------:|:-------------:|
| `screenshot here` | `screenshot here` | `screenshot here` |

---

## Supported formats

| Engine | Games | MDL version | Geometry | Textures |
|--------|-------|-------------|----------|----------|
| **GoldSrc** | Half-Life, CS 1.6, TFC, DoD | v10 | ✅ | ✅ Embedded in MDL |
| **Source** | Half-Life 2, TF2, CS:S, L4D, Portal | v44 – v49 | ✅ | ✅ VTF (drop alongside) |
| **Source 2** | CS2, Half-Life: Alyx, Dota 2 | v53+ | 🚧 | 🚧 |

### Texture formats decoded client-side

`DXT1` `DXT3` `DXT5` `RGBA8888` `ABGR8888` `BGR888` `RGB888` `BGRA8888` `BGRX8888` `I8` `IA88` `BGR565`

---

## How to use it

### GoldSrc models
Drop a single `.mdl` file. Textures are embedded in the file itself — nothing else needed.

### Source models
Drop **all three files at once** (or one after the other — the viewer holds state):

```
playermodel.mdl
playermodel.vvd
playermodel.dx90.vtx
```

The `.mdl` holds the skeleton, mesh metadata, and texture names. The `.vvd` holds vertex data (positions, normals, UVs, bone weights). The `.vtx` holds the optimised strip index buffers. All three are required for geometry.

### Source textures
Source textures are separate `.vtf` files stored in the game's `materials/` folder. Once your model is loaded, the sidebar shows every texture the model needs by filename. You can:

- Drop any number of `.vtf` files onto the viewport — they match automatically by name
- Click **add…** in the Textures panel to browse for multiple VTF files at once
- Hover a missing texture row and click **pick** to browse for that specific file

Textures apply instantly without re-parsing the model.

---

## Controls

| Input | Action |
|-------|--------|
| Left drag | Orbit |
| Right drag | Pan |
| Scroll | Zoom |
| `F` | Reset camera |
| `T` | Toggle textures |
| `G` | Toggle grid |
| `B` | Cycle background |
| `1` | Solid shading |
| `2` | Wireframe |
| `3` | Normals |

---

## Running locally

```bash
git clone https://github.com/mebastem/SMV
cd SMV
npm install
npm run dev
```

Open `http://localhost:5173`.

### Build for production

```bash
npm run build
```

Output goes to `dist/`. Fully static — host anywhere (GitHub Pages, Netlify, Vercel, a CDN, etc.).

---

## Project structure

```
src/
├── main.js              Entry point — file handling, state, keyboard shortcuts
├── scene.js             Three.js scene, camera, lights, view modes, toggles
├── ui.js                All DOM updates isolated in one place
├── style.css            All styles — single CSS file, CSS variables throughout
└── parsers/
    ├── detect.js         Reads MDL magic + version, identifies engine
    ├── binary.js         DataView helpers (readStr, readCStr, readVec3)
    ├── goldsrc.js        GoldSrc MDL v10 — geometry + embedded textures
    ├── source.js         Source MDL v44–49 — parses MDL/VVD/VTX together
    └── vtf.js            VTF image decoder — DXT1/3/5 + uncompressed formats
```

---

## Parser notes

These are the parts of the format that took the most work to get right, documented here so the next person doesn't have to re-derive them.

**GoldSrc MDL** — All offsets are absolute from file start. Textures are raw 8-bit indexed pixels followed immediately by a 768-byte (256 × RGB) palette. Triangle data uses a run-length strip/fan encoding where positive counts are strips and negative counts are fans.

**Source MDL** — `bodypartindex`, `modelindex`, and `meshindex` are all *relative offsets from the containing struct*, not absolute file offsets. `mstudiomesh_t` is 116 bytes (not 84 — it includes an embedded `mstudio_meshvertexdata_t` struct). `mstudiomodel_t::vertexindex` is at byte offset 84 (not 88, which is `tangentsindex`).

**VVD** — The real header layout: `id(4) version(4) checksum(4) numLODs(4) numLODVertices[8](32) numFixups(4) fixupTableStart(4) vertexDataStart(4)`. `numLODVertices[0]` is at offset 16. `numFixups` is at offset 48 (not 20).

**VTF** — `imageFormat` is at header offset 52 (not 24, which is the `frames` field). Mipmaps are stored smallest-first after the low-res thumbnail. Full-res image is always last.

---

## Roadmap

- [ ] Source 2 support (`.vmdl_c` / resource system)
- [ ] Animation playback
- [ ] Bone / skeleton overlay
- [ ] Hitbox visualisation
- [ ] Skin group switching
- [ ] LOD switching
- [ ] Export to glTF

---

## References

- [Valve Developer Community — MDL](https://developer.valvesoftware.com/wiki/MDL)
- [Valve Developer Community — VTF](https://developer.valvesoftware.com/wiki/VTF)
- [Half-Life SDK — studio.h](https://github.com/ValveSoftware/halflife/blob/master/utils/common/studio.h)
- [Source SDK 2013 — studio.h](https://github.com/ValveSoftware/source-sdk-2013/blob/master/mp/src/public/studio.h)
- [Source SDK 2013 — optimize.h](https://github.com/ValveSoftware/source-sdk-2013/blob/master/mp/src/public/optimize.h)

---

## License

MIT
