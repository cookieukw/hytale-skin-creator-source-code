# Hytale Skin Creator

A browser-based Hytale skin creator designed to let users create, customize, and preview characters directly in the browser.

Renders character models directly from the `.blockymodel` format using Three.js and features **587 cosmetics** across 18 categories extracted from game files.

- Imports and exports skins in Hytale's native format (`UserData/CachedPlayerSkins/<uuid>.json`)
- Tinting powered by official color ramps (215 gradients across 13 sets)
- Multilingual interface (English and Portuguese) using in-game text definitions

## Running Locally

This is a static web app — simply serve the root directory:

```bash
python3 tools/devserver.py 5173
```

Then open <http://localhost:5173>. The dev server sets `no-store` headers so editing any file updates immediately upon reloading.

## Deployment

No build step required. On Netlify or Vercel, deploy the repository root directory — `netlify.toml` configures caching headers.

## Project Structure

| Path | Description |
|---|---|
| `index.html` | Single page application entry point |
| `fitting_room.js` | 3D rendering, character assembly, import/export logic |
| `fitting_room.css` | Styling, based on the game's UI design system |
| `catalog.js` | **Generated** — 587 cosmetics, gradients, and fallback mappings |
| `i18n.js` | **Generated** — Menu and tab UI translations |
| `Assets/` | Game 3D models and textures used by the fitting room |
| `ui/` | Interface icons, frames, and fonts from the game |
| `tools/` | Maintenance and generation scripts (node/python) |

## Regenerating Assets from Game Files

Files marked as generated are built from Hytale assets. The generation scripts expect assets at `/mnt/devhd/Assets` and an installed client — adjust the paths at the top of each script if your setup differs.

```bash
python3 tools/gen_catalog.py    # Generates catalog.js from Cosmetics/CharacterCreator/*.json
python3 tools/gen_i18n.py       # Generates i18n.js from Shared/Language/<locale>/client.lang
python3 tools/copy_assets.py    # Copies only the assets referenced by catalog.js to Assets/
```

Run them in this exact order: `copy_assets.py` reads `catalog.js` to determine which assets to copy.

## Format & Rendering Notes

Important nuances about the `.blockymodel` format discovered during implementation:

- **Tinting is a LUT lookup, not color multiplication.** Cosmetic textures are grayscale by design: gray values index a 256×16 table in `TintGradients/`. Only *strictly grayscale* pixels (`r == g == b`) are tinted — this is how artists mark tintable regions. Eye scleras have a subtle blue tint so they don't take on iris colors.
- **`stretch` is per-piece**, and does not propagate to children; child positions in the asset file are pre-mirrored.
- **Child positions are relative to the parent shape's center**, not the bone pivot.
- **`isPiece: true` at any depth** means the node belongs to another bone — for instance, shirts store `Chest`/`L-Arm`/`R-Arm` inside `Belly`.
- **For an attachment root, rotation originates from the bone**; the file repeats the bone rotation, so applying it again doubles the rotation angle.
- **`RequiresGenericHaircut`** makes the engine draw the generic fallback haircut of the same `HairType` underneath — applies to 83 out of 112 haircuts.
- **`HeadAccessoryType` handling**: `HalfCovering` head accessories (caps/hats) suppress bulky styled top hair layers and render generic fallback hair (`GenericShort`, `GenericMedium`, `GenericLong`) to prevent hat clipping. `FullyCovering` head accessories completely hide haircuts.
- **UV rectangles touch each other** in the atlas, so UV boundaries must be inset by a fraction of a texel to prevent NEAREST filtering from sampling adjacent pixels.

## License

The source code of this repository is licensed under the [MIT License](LICENSE).

All Hytale 3D models, textures, icons, fonts, and game assets remain the intellectual property of Hypixel Studios.

## Disclaimer & Credits

3D models, textures, icons, and fonts are property of Hypixel Studios. This project is a fan-made tool and is not affiliated with or endorsed by Hypixel Studios or Hytale.

Format specifications were understood with reference to the official [Blockbench plugin](https://github.com/JannisX11/hytale-blockbench-plugin) (GPL) as reference — no plugin code was copied.
