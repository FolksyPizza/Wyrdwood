# Wyrdwood — Claude Code guide

A 3D survival-crafting game (Valheim/Aska-inspired): gather → craft → build → survive →
follow objectives to a goal. Runs in the browser during development and ships as a native
desktop app via Electron.

## Run it

```bash
npm install          # first time only
npm run dev          # dev server → http://localhost:5173  (open in Chrome)
```

- **`npm run dev`** — Vite dev server with hot reload. Play at `http://localhost:5173`.
  Add `?dev` to skip menus and boot straight into a world with starting materials and a
  `window.__game` debug handle; `?dev&continue` resumes the last save.
- **`npm run app`** — build + launch the real Electron desktop app.
- **`npm run electron:dev`** — Electron window pointed at the running dev server (run
  `npm run dev` first in another terminal).
- **`npm run dist:mac` / `dist:win`** — package a distributable `.dmg` / `.exe` into `release/`.
- **`npm run build`** — typecheck + production build into `dist/`.
- **`npm run typecheck`** — `tsc --noEmit` (strict). Run after every change.

Controls: **WASD** move · **Shift** run · **Space** jump · **E** interact/loot/light ·
**LMB** attack · **RMB** place held · **1-8** hotbar · **F** eat · **Tab** inventory ·
**C** craft · **B** build · **M** map · **P** character · **Esc** pause.

## Tech stack

- **Three.js** (WebGL2) rendering + post-processing (bloom/vignette).
- **TypeScript** (strict; `noUnusedLocals`, `noUncheckedIndexedAccess`) + **Vite**.
- **Rapier** (`@dimforge/rapier3d-compat`, WASM) for physics / character controller.
- **simplex-noise** for terrain & scatter.
- **Electron** wraps the build as a native app (chromium engine == dev engine).
- Persistence: `localStorage` (world saves + settings). No backend.

## Architecture

Fixed-timestep loop (`src/core/loop.ts`) drives one central `Game` class
(`src/game.ts`) that owns every system. `src/main.ts` is the menu/flow shell
(MainMenu → CharacterCreator → WorldSetup → `Game.start`).

```
src/
  main.ts            entry + menu flow
  game.ts            Game class: owns systems, update/render, save/load, death/graves
  core/              loop, input, day-night cycle
  render/            renderer + post-FX, night sky
  physics/           Rapier init + step
  world/             terrain (noise), chunk streaming, scatter (trees/rocks/plants)
  player/            controller, third-person camera, stats (needs), interaction, humanoid
  items/             inventory + hotbar
  crafting/          recipes + stations
  building/          placed objects, 2m-grid build pieces, blueprints, build mode
  entities/          mobs (spawn, AI, combat, meshes)
  progression/       XP/levels + use-based skills, objective chain
  map/               minimap + full map (fog-of-war, custom markers)
  fx/                particles, procedural WebAudio
  save/              serialize/deserialize world + player
  ui/                DOM overlays: HUD, screens, menus, creator, settings
  data/              ALL content, data-driven (see below)
electron/            main.cjs — native wrapper
scripts/playtest.mjs Puppeteer harness (see Testing)
```

**Data-driven content** lives in `src/data/*` — edit these to add/tune content without
touching systems: `items`, `recipes`, `harvest`, `mobs`, `biomes`, `pieces`, `blueprints`,
`objectives`, `skills`, `appearance`, `difficulty` (world modifiers), `settings`.
`src/data/difficulty.ts` exports `worldConfig`, the single mutable config every system
reads (survival rates, PvE dials, toggles). `src/data/settings.ts` exports `settings`
(volumes, render distance, mouse look) with `notifySettingsChanged()`.

## Art assets (important)

Visuals are built on **real CC0 assets**, not procedural colours. `npm run assets`
(`scripts/fetch-assets.mjs`) downloads them into `public/assets/` — ~41 MB, committed:

- **PBR textures** (Poly Haven): terrain layers (grass/rock/sand/snow), bark, building
  surfaces (planks/beam/thatch/stone), cloth. Each is `_diff` + `_nor` + `_arm`.
  Poly Haven packs AO/roughness/metalness into one **ARM** image (r/g/b) — three reads
  `aoMap` from .r and `roughnessMap` from .g, so one sampler covers both. **Do not bind
  it to `metalnessMap`**: the .b channel of a natural scan is noise, and it turns grass
  and bark into brushed metal (`applyARM` in `render/assets.ts` exists to get this right).
- **Foliage** (`render/assets.ts:makeLeafCluster`): Poly Haven's tree *models* are
  photogrammetry — `pine_tree_01`'s mesh alone is a 950 MB `.bin` — but their bark and
  leaf-atlas *textures* are a few hundred KB. So we take the textures and build
  game-ready geometry: trunks are tapered cylinders in scanned bark, canopies are shells
  of alpha-cut leaf-cluster cards, grass tufts are photographic billboards.
- **Rigged models** (Quaternius, CC0): animals and the player are skinned glTF with real
  animation clips (`render/models.ts`). Primitives never read as creatures — gait matters
  as much as shape. Note `modelHeight` uses `SkinnedMesh.computeBoundingBox`, not
  `Box3.setFromObject`: skinned vertices live in bind space, so Box3 measures nonsense.

**Rendering rules that are easy to get wrong, and were:**
- Post chain is `Render → Bloom → OutputPass → Vignette → Grade`. Everything before
  `OutputPass` is **linear HDR** (a daylit sky sits at 2–8), so bloom's threshold must be
  well above 1 or the whole sky blooms into a milky haze; and the grade must run *after*
  `OutputPass` because it clamps to 0–1.
- Tone mapping is **AgX**, not ACES. ACES clips a physical sky to flat white, forcing an
  exposure so low the shadows crush. AgX rolls highlights off, so exposure sits near 1.0.
- The sky is baked to an **environment map** (PMREM) for image-based lighting. The `Sky`
  shader's radiance near the sun runs to five figures, which overflows PMREM's half-float
  target to `Inf` → `NaN` → **every lit material renders pure black**. `sky.ts` clamps the
  env-only copy of the sky to fix it.

**Graphics scale to the hardware.** `src/data/settings.ts` also exports `QUALITY` — four
presets (low/medium/high/ultra) over shadows, shadow-map size, pixel ratio, grass density
and radius, post-FX, and view radius — plus a `quality()` helper. `GameRenderer` and
`ChunkManager` both subscribe via `onSettingsChange` and re-apply live (changing the preset
restreams chunks, since grass density is baked into each chunk's instanced mesh). Hardware
targets are documented in `SPECS.md`.

Two rendering rules that are easy to get wrong and were:
- The post chain is `Render → Bloom → OutputPass → Vignette → Grade`. Everything before
  `OutputPass` is **linear HDR** (the sky is several times brighter than 1.0), so bloom's
  threshold must sit well above 1 or the whole sky blooms into a milky haze — and the
  colour grade must run *after* `OutputPass`, because it clamps to 0–1 and would otherwise
  flatten every highlight and undo the ACES tone mapping.
- The three.js `Sky` is calibrated for a **low** tone-mapping exposure (~0.5). Anything
  near 1.0 blows the scene out. `DayNight.update` drives the live value.

## Conventions

- **Match the surrounding code**: modular system managers (not a heavy ECS), small focused
  classes, comments explaining *why*. Keep entity/world state **serializable** and content
  **data-driven** — this keeps saves and future co-op tractable.
- Determinism matters: terrain/scatter derive from the seed (`src/world/noise.ts`). Don't
  use `Math.random()` for world generation — use the seeded `cellHash`/`mulberry32`.
- Hot-path (per-frame) code must not allocate: reuse scratch `THREE.Vector3`/`Matrix4`,
  cache, and gate expensive work behind timers (see `map/map.ts`, `game.ts`).
- Dispose GPU resources (geometries, colliders) when removing objects.
- Strict TS: unused ctor params → drop the `private` keyword; index access may be `undefined`.

## Testing / verification (important)

There are no unit tests; verification is **behavioral** via a Puppeteer harness that drives
the real game in headless Chrome and screenshots it:

```bash
node scripts/playtest.mjs --url "http://localhost:5173/?dev" --wait 8000 \
  --shot out.png \
  --pre-eval "<js run before input>" \
  --eval "<js run after, result printed>" \
  --keys "click:640:400,mouse:200:80,KeyW:600,KeyE:5000"
```

Key sequence tokens: `KeyX:ms` (hold), `click:x:y`, `rclick:0`, `mouse:dx:dy`,
`js:<uri-encoded>`, `wait:ms`. With `?dev`, `window.__game` exposes
`inventory, stats, player, mobs, buildings, buildMode, placed, progression, objectives,
worldConfig, game` for scripted assertions.

**Workflow for any change:** `npm run typecheck` → run the harness with a screenshot →
confirm the behavior on-screen (not just that it compiles).

## Milestones (all complete)

M0 render+physics · M1 terrain/character/day-night · M2 needs/gathering/inventory/map ·
M3 tools/crafting · M4 building (pieces+blueprints) · M5 mobs/combat/difficulty ·
M6 XP/skills · M6.5 particles/audio/postFX/night-sky · M7 menus/creator/objectives (light
the Wyrd Beacon = win) · M8 save-load + Electron · M9 sound sliders/named markers/flora &
fauna. Next: M10 detail pass (loading screen, decorated menus, richer visuals).
