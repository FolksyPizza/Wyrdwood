import * as THREE from 'three';

/**
 * Loads the CC0 PBR texture kit in `public/assets` (see scripts/fetch-assets.mjs).
 *
 * Poly Haven packs AO + roughness + metalness into one "ARM" image (r/g/b).
 * three.js reads `aoMap` from .r, `roughnessMap` from .g and `metalnessMap`
 * from .b, so the *same* texture can be bound to all three slots — that's the
 * whole trick, and it's why a full PBR ground layer costs only 3 samplers.
 */

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();

export interface PBRMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** AO + roughness + metalness packed into r/g/b. */
  armMap: THREE.Texture | null;
  alphaMap: THREE.Texture | null;
}

function tex(path: string, srgb: boolean): THREE.Texture {
  const hit = cache.get(path);
  if (hit) return hit;
  const t = loader.load(`assets/${path}.jpg`);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  // Albedo is authored in sRGB; normal/ARM/alpha are raw data and must stay linear.
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  cache.set(path, t);
  return t;
}

/** Load a `<name>_diff/_nor/_arm(/_alpha)` set. */
export function loadPBR(name: string, opts: { arm?: boolean; alpha?: boolean } = {}): PBRMaps {
  const { arm = true, alpha = false } = opts;
  return {
    map: tex(`${name}_diff`, true),
    normalMap: tex(`${name}_nor`, false),
    armMap: arm ? tex(`${name}_arm`, false) : null,
    alphaMap: alpha ? tex(`${name}_alpha`, false) : null,
  };
}

/**
 * Bind an ARM texture to the slots it feeds: AO from .r, roughness from .g.
 *
 * Deliberately NOT metalness. The .b channel of a scanned natural material is
 * noise, not a metal mask — binding it turns grass and bark into brushed metal
 * that reflects the sky as a silvery sheen. Nothing in a forest is metallic.
 */
export function applyARM(mat: THREE.MeshStandardMaterial, armMap: THREE.Texture | null): void {
  if (!armMap) return;
  mat.aoMap = armMap;
  mat.roughnessMap = armMap;
  // The map carries the variation; this is the multiplier on top of it.
  mat.roughness = 1;
  mat.metalness = 0;
  mat.aoMapIntensity = 1;
}

/**
 * A tiling PBR surface for built structures (planks, beams, thatch, stone).
 *
 * `repeat` is in tiles per UV unit. Box geometries UV each face 0→1 regardless of
 * its size, so a 2 m wall and a 0.2 m beam would otherwise show the same number
 * of planks — pass a repeat that suits the piece's scale.
 */
const structureCache = new Map<string, THREE.MeshStandardMaterial>();
export function structureMaterial(name: string, repeat = 1): THREE.MeshStandardMaterial {
  const key = `${name}@${repeat}`;
  const hit = structureCache.get(key);
  if (hit) return hit;

  const p = loadPBR(name);
  // Each repeat needs its own texture objects — repeat lives on the texture, so
  // sharing one across scales would make the last caller win.
  const map = p.map.clone();
  const nor = p.normalMap.clone();
  const arm = p.armMap?.clone() ?? null;
  for (const t of [map, nor, arm]) {
    if (!t) continue;
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
  }
  const mat = new THREE.MeshStandardMaterial({ map, normalMap: nor });
  applyARM(mat, arm);
  structureCache.set(key, mat);
  return mat;
}

/** All maps used by a chunk's terrain — loaded once, shared by every chunk. */
export interface TerrainMaps {
  grass: PBRMaps;
  rock: PBRMaps;
  sand: PBRMaps;
  snow: PBRMaps;
}

let terrainMaps: TerrainMaps | null = null;
export function loadTerrainMaps(): TerrainMaps {
  if (!terrainMaps) {
    terrainMaps = {
      grass: loadPBR('terrain/grass'),
      rock: loadPBR('terrain/rock'),
      sand: loadPBR('terrain/sand'),
      snow: loadPBR('terrain/snow'),
    };
  }
  return terrainMaps;
}

export interface AtlasRect {
  u: number;
  v: number;
  w: number;
  h: number;
}

const load = (url: string): Promise<HTMLImageElement> =>
  new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });

/**
 * Builds a leaf-CLUSTER card texture out of a scanned single-leaf atlas.
 *
 * A canopy card has to show a clump of foliage. Poly Haven's leaf atlas holds
 * individual leaves on black (it was unwrapped for a photoscanned mesh where
 * every leaf is real geometry), so mapping one card to one leaf gives a tree
 * with a dozen enormous leaves. Instead we stamp many leaves — rotated, scaled
 * and scattered — onto one transparent canvas, and use *that* as the card. This
 * is exactly how hand-authored foliage atlases are made; we're just doing it at
 * load time from real photographs.
 *
 * Colour comes from the `_diff` image and opacity from the matching `_alpha`
 * image (the atlases keep them separate). Rects are in three.js UV space, with
 * (0,0) at the bottom-left.
 */
export function makeLeafCluster(
  name: string,
  rects: AtlasRect[],
  opts: { size?: number; leaves?: number; seed?: number } = {},
): THREE.Texture {
  const { size = 512, leaves = 90, seed = 1 } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const out = new THREE.CanvasTexture(canvas);
  out.colorSpace = THREE.SRGBColorSpace;

  // Deterministic scatter, so a reload gives the same tree.
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  void Promise.all([
    load(`assets/${name}_diff.jpg`),
    load(`assets/${name}_alpha.jpg`),
  ]).then(([diff, alpha]) => {
    // Compose colour and cutout into one RGBA image first: draw the leaf's
    // colour, then multiply in its mask as the alpha channel.
    const cut = document.createElement('canvas');
    cut.width = diff.width;
    cut.height = diff.height;
    const cctx = cut.getContext('2d')!;
    cctx.drawImage(diff, 0, 0);
    const colour = cctx.getImageData(0, 0, cut.width, cut.height);
    cctx.clearRect(0, 0, cut.width, cut.height);
    cctx.drawImage(alpha, 0, 0);
    const mask = cctx.getImageData(0, 0, cut.width, cut.height);
    for (let p = 0; p < colour.data.length; p += 4) {
      colour.data[p + 3] = mask.data[p]!; // alpha atlas is greyscale
    }
    cctx.putImageData(colour, 0, 0);

    for (let i = 0; i < leaves; i++) {
      const r = rects[i % rects.length]!;
      const sx = r.u * cut.width;
      const sy = (1 - r.v - r.h) * cut.height; // UV is bottom-up, canvas is top-down
      const sw = r.w * cut.width;
      const sh = r.h * cut.height;

      // Cluster towards the middle so the card's edges stay wispy — a hard
      // rectangular edge of leaves is instantly readable as a billboard.
      const a = rnd() * Math.PI * 2;
      const rad = Math.sqrt(rnd()) * size * 0.34;
      const cx = size / 2 + Math.cos(a) * rad;
      const cy = size / 2 + Math.sin(a) * rad;
      // Leaf size relative to the card. A card is ~2 m of canopy, so a leaf must
      // be a small fraction of it — at 1/3 of the card (the first attempt) every
      // leaf was nearly a metre across and the tree looked like a houseplant.
      const scale = (size / 7.5) * (0.6 + rnd() * 0.7);
      const aspect = sh / sw;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rnd() * Math.PI * 2);
      // Vary brightness a little so the clump has internal depth rather than
      // reading as one flat decal.
      ctx.globalAlpha = 0.8 + rnd() * 0.2;
      ctx.drawImage(cut, sx, sy, sw, sh, -scale / 2, (-scale * aspect) / 2, scale, scale * aspect);
      ctx.restore();
    }
    out.needsUpdate = true;
  });

  return out;
}
