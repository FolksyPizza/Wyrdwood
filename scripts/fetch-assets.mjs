/**
 * Downloads the CC0 texture kit Wyrdwood renders with (Poly Haven, CC0 — no
 * attribution required, redistributable, so the files are committed and shipped
 * inside the app).
 *
 *   node scripts/fetch-assets.mjs          # fetch anything missing
 *   node scripts/fetch-assets.mjs --force  # re-fetch everything
 *
 * Poly Haven serves each asset's maps individually, which matters: their tree
 * *models* are photogrammetry (pine_tree_01's mesh alone is a ~950 MB .bin), but
 * the bark and leaf-atlas *textures* from those same scans are a few hundred KB
 * and are what we actually want — we build game-ready foliage geometry and dress
 * it in the scanned textures, which is how engines do vegetation anyway.
 *
 * Maps we use, per Poly Haven's naming:
 *   diff    albedo / base colour
 *   nor_gl  normal map (OpenGL convention — the one three.js wants)
 *   arm     packed AO (r) + roughness (g) + metalness (b)
 *   alpha   cutout mask for leaf/grass/fern cards
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'assets');
const RES = '1k';
const FORCE = process.argv.includes('--force');

/** localName → { asset, maps: { ourName: polyHavenKey } } */
const KIT = {
  // ── Terrain splat layers ────────────────────────────────────────────────
  // Standalone Poly Haven *textures* call albedo "Diffuse"; the texture sets
  // bundled with their models call it "diff". Same maps, different casing.
  'terrain/grass': { asset: 'leafy_grass', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },
  'terrain/forest': { asset: 'forest_ground_04', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },
  'terrain/dirt': { asset: 'brown_mud_leaves_01', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },
  // Grey granite, not the warm brown rock_face_03 — that scan is what made the
  // mountains look like sand dunes. Real upland rock is cool grey-blue.
  'terrain/rock': { asset: 'gray_rocks', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },
  'terrain/cliff': { asset: 'rock_wall_02', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },
  'terrain/sand': { asset: 'coast_sand_05', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },
  'terrain/snow': { asset: 'snow_02', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },

  // ── Bark (seamless tiling texture, for procedural trunks) ───────────────
  'bark/pine': { asset: 'bark_brown_02', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },
  'bark/oak': { asset: 'bark_willow', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },

  // ── Building surfaces ───────────────────────────────────────────────────
  'build/planks': { asset: 'weathered_planks', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },
  'build/beam': { asset: 'raw_plank_wall', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },
  'build/thatch': { asset: 'thatch_roof_angled', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },
  'build/stone': { asset: 'mossy_stone_wall', maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' } },

  // ── Foliage alpha atlases (harvested from photoscanned model texture sets) ──
  'foliage/pine_needles': {
    asset: 'pine_tree_01',
    maps: { diff: 'twig_diff', nor: 'twig_nor_gl', arm: 'twig_arm', alpha: 'twig_alpha' },
  },
  'foliage/leaves': {
    asset: 'island_tree_01',
    maps: { diff: 'leaves_diff', nor: 'leaves_nor_gl', arm: 'leaves_arm', alpha: 'leaves_alpha' },
  },
  'foliage/grass_blades': {
    asset: 'grass_medium_01',
    maps: { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm', alpha: 'Alpha' },
  },
  'foliage/shrub': {
    asset: 'shrub_01',
    maps: { diff: 'Diffuse', nor: 'nor_gl', alpha: 'Alpha' },
  },
  'foliage/fern': {
    asset: 'fern_02',
    maps: { diff: 'Diffuse', nor: 'nor_gl', alpha: 'Alpha' },
  },
  // Meadow flowers. Three species, because a field strewn with one identical
  // bloom is the same wallpaper problem as a forest of one tree.
  'foliage/gazania': {
    asset: 'flower_gazania',
    maps: { diff: 'Diffuse', nor: 'nor_gl', alpha: 'Alpha' },
  },
  'foliage/dandelion': {
    asset: 'dandelion_01',
    maps: { diff: 'Diffuse', nor: 'nor_gl', alpha: 'Alpha' },
  },
  'foliage/celandine': {
    asset: 'celandine_01',
    maps: { diff: 'Diffuse', nor: 'nor_gl', alpha: 'Alpha' },
  },
  'foliage/nettle': {
    asset: 'nettle_plant',
    maps: { diff: 'Diffuse', nor: 'nor_gl', alpha: 'Alpha' },
  },
};

/**
 * Rigged, animated character models (Quaternius, CC0). Photoreal animals simply
 * are not available as freely-fetchable assets — but these have real anatomy and
 * real walk/run/attack cycles, which is what actually makes a creature read as a
 * creature. Primitives never will, no matter how they're shaped.
 */
const MODEL_BASE =
  'https://raw.githubusercontent.com/trebeljahr/quaternius-showcase/main/public/glb';
const MODELS = {
  'animals/deer': 'animals_pack/Deer.glb',
  'animals/stag': 'animals_pack/Stag.glb',
  'animals/wolf': 'animals_pack/Wolf.glb',
  'animals/fox': 'animals_pack/Fox.glb',
  'animals/cow': 'animals_pack/Cow.glb',
  'animals/bull': 'animals_pack/Bull.glb',
  'animals/horse': 'animals_pack/Horse.glb',
  'animals/alpaca': 'animals_pack/Alpaca.glb',
  'animals/husky': 'animals_pack/Husky.glb',
  'char/adventurer': 'modular_men/Adventurer.glb',
  'char/farmer': 'modular_men/Farmer.glb',
  'char/worker': 'modular_men/Worker.glb',
  // The modular_men meshes ship without animation clips, but they're rigged to
  // the same "HumanArmature" skeleton as the knight — so we borrow his clips
  // (Idle / Walking / Run / Jump / Attack / Death) and retarget them by bone name.
  'char/anims': 'single_knight_pack/KnightCharacter.glb',
};

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Poly Haven nests as files[map][res][format] — but some maps only ship a subset. */
function pickUrl(files, mapKey) {
  const m = files[mapKey];
  if (!m) return null;
  const res = m[RES] ?? m[Object.keys(m)[0]];
  if (!res) return null;
  // jpg is a fraction of the png size and these are all 8-bit maps anyway.
  const entry = res.jpg ?? res.png ?? res[Object.keys(res)[0]];
  return entry?.url ?? null;
}

let fetched = 0;
let skipped = 0;
let bytes = 0;

for (const [local, spec] of Object.entries(KIT)) {
  const need = [];
  for (const [name, key] of Object.entries(spec.maps)) {
    const dest = join(OUT, `${local}_${name}.jpg`);
    if (!FORCE && (await exists(dest))) {
      skipped++;
      continue;
    }
    need.push([name, key, dest]);
  }
  if (need.length === 0) continue;

  const res = await fetch(`https://api.polyhaven.com/files/${spec.asset}`);
  if (!res.ok) throw new Error(`Poly Haven ${spec.asset}: HTTP ${res.status}`);
  const files = await res.json();

  await mkdir(dirname(join(OUT, local)), { recursive: true });
  for (const [name, key, dest] of need) {
    const url = pickUrl(files, key);
    if (!url) {
      console.warn(`  ! ${spec.asset}: no "${key}" map — skipping ${local}_${name}`);
      continue;
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(dest, buf);
    bytes += buf.length;
    fetched++;
    console.log(`  ✓ ${local}_${name}.jpg  (${(buf.length / 1e6).toFixed(2)} MB)  ← ${spec.asset}`);
  }
}

for (const [local, remote] of Object.entries(MODELS)) {
  const dest = join(OUT, `${local}.glb`);
  if (!FORCE && (await exists(dest))) {
    skipped++;
    continue;
  }
  await mkdir(dirname(dest), { recursive: true });
  const r = await fetch(`${MODEL_BASE}/${remote}`);
  if (!r.ok) throw new Error(`${remote}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
  bytes += buf.length;
  fetched++;
  console.log(`  ✓ ${local}.glb  (${(buf.length / 1e6).toFixed(2)} MB)`);
}

console.log(
  `\n${fetched} fetched (${(bytes / 1e6).toFixed(1)} MB), ${skipped} already present → public/assets/`,
);
