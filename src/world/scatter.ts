import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cellHash, mulberry32 } from './noise';
import { SEA_LEVEL, type Terrain } from './terrain';
import { worldClock } from '../render/textures';
import { applyARM, loadPBR, makeLeafCluster } from '../render/assets';

export type ScatterType =
  | 'tree'
  | 'pine'
  | 'dandelion'
  | 'daisy'
  | 'rock'
  | 'bush'
  | 'flower'
  | 'mushroom'
  | 'herb'
  | 'fern'
  // Ground clutter. These are what you pick up bare-handed before you have any
  // tools at all — a forest floor is covered in usable material, and a world
  // where the only wood is a standing tree you can't chop yet is a dead end.
  | 'stick'
  | 'pebble'
  | 'log';

/** A scattered world object — serializable identity for harvesting. */
export interface ScatterInstance {
  type: ScatterType;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  /** Remaining harvest hits (initialized from HARVEST data on first hit). */
  hp?: number;
}

/** Spacing of the deterministic scatter grid within a chunk (world units). */
const CELL = 4;

function smoothstep01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Deterministically list scatter objects for a chunk (seed + coords → same result). */
export function scatterForChunk(
  terrain: Terrain,
  cx: number,
  cz: number,
  chunkSize: number,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  const x0 = cx * chunkSize;
  const z0 = cz * chunkSize;
  for (let gx = 0; gx < chunkSize / CELL; gx++) {
    for (let gz = 0; gz < chunkSize / CELL; gz++) {
      const cellX = Math.floor(x0 / CELL) + gx;
      const cellZ = Math.floor(z0 / CELL) + gz;
      const roll = cellHash(terrain.seed, cellX, cellZ, 1);
      // Jittered position inside the cell.
      const jx = cellHash(terrain.seed, cellX, cellZ, 2);
      const jz = cellHash(terrain.seed, cellX, cellZ, 3);
      const x = x0 + gx * CELL + jx * CELL;
      const z = z0 + gz * CELL + jz * CELL;
      const y = terrain.height(x, z);
      if (y < SEA_LEVEL + 1.0) continue; // no vegetation under water
      if (terrain.slopeAt(x, z) > 0.9) continue; // cliffs stay bare
      const biome = terrain.biomeAt(x, z, y);

      // Cumulative-probability pick across all scatter types for this cell.
      let type: ScatterType | null = null;
      let acc = biome.treeDensity;
      if (roll < acc) {
        // Which species. Conifers take over with altitude and in the damp — a
        // forest of one tree is the thing that reads as wallpaper, and the
        // handover between species is most of what gives a treeline its shape.
        const conifer = cellHash(terrain.seed, cellX, cellZ, 6);
        const pineChance = smoothstep01(12, 40, y) * 0.75 + terrain.moistureAt(x, z) * 0.35;
        type = conifer < pineChance ? 'pine' : 'tree';
      }
      else if (roll < (acc += biome.rockDensity)) type = 'rock';
      else if (roll < (acc += biome.bushDensity)) type = 'bush';
      else if (roll < (acc += biome.flowerDensity)) {
        // Three flower species, not one. A meadow strewn with a single identical
        // orange bloom is the same wallpaper problem as a forest of one tree.
        const pick = cellHash(terrain.seed, cellX, cellZ, 7);
        type = pick < 0.4 ? 'flower' : pick < 0.75 ? 'dandelion' : 'daisy';
      }
      else if (roll < (acc += biome.mushroomDensity)) type = 'mushroom';
      else if (roll < (acc += biome.herbDensity)) type = 'herb';
      else if (roll < (acc += biome.fernDensity)) type = 'fern';
      else if (roll < (acc += biome.stickDensity)) type = 'stick';
      else if (roll < (acc += biome.pebbleDensity)) type = 'pebble';
      else if (roll < (acc += biome.logDensity)) type = 'log';
      if (!type) continue;

      const isPlant =
        type === 'flower' || type === 'mushroom' || type === 'herb' || type === 'fern';
      out.push({
        type,
        x,
        y,
        z,
        scale: isPlant
          ? 0.8 + cellHash(terrain.seed, cellX, cellZ, 4) * 0.5
          : 0.75 + cellHash(terrain.seed, cellX, cellZ, 4) * 0.6,
        rotation: cellHash(terrain.seed, cellX, cellZ, 5) * Math.PI * 2,
      });
    }
  }
  return out;
}

/** Shared low-poly geometries/materials (created once, reused by every chunk). */
export class ScatterAssets {
  // Trunk: a tapered cylinder wearing real scanned bark. 10 sides (not 6) so the
  // silhouette doesn't read as a hexagon at close range, and the UVs are scaled
  // so the bark tiles at roughly life size rather than being stretched up 3.4 m.
  readonly trunkGeo = makeTrunk(0.16, 0.34, 3.4);
  /** Real limbs. A canopy floating on a bare pole is the classic procedural
   * tree; branches are what connect the two and let you see structure through
   * the leaves. */
  readonly branchGeo = makeBranches();
  readonly foliageGeo = makeCanopy(2.0, 2.4, 16, 0.0);
  readonly foliage2Geo = makeCanopy(1.5, 1.9, 12, 1.5); // upper tier
  readonly foliage3Geo = makeCanopy(0.95, 1.5, 8, 2.6); // crown

  // ── Conifer ──────────────────────────────────────────────────────────────
  readonly pineTrunkGeo = makeTrunk(0.08, 0.30, 7.2);
  readonly pineCanopyGeo = makeConifer();
  readonly pineMat = makeLeafClusterMaterial('foliage/pine_needles', PINE_RECTS, 0x9143);
  readonly rockGeo = makeRock();
  readonly bushGeo = makeCanopy(0.8, 0.9, 9, 0.0);
  /** Berries, nestled *inside* the bush's leaf shell rather than sitting on it. */
  readonly berryGeo = makeBerries(0.8, 0.9, 22);
  readonly berryMat = new THREE.MeshStandardMaterial({
    color: 0xa3172b,
    roughness: 0.35, // fruit is waxy — it catches a small highlight, unlike leaves
    metalness: 0,
  });

  readonly trunkMat = makeBarkMaterial();
  // Three DIFFERENT cluster cards, one per canopy tier. Using one texture for
  // every card meant a tree was the same photograph repeated 36 times, and a
  // forest was that same photograph a thousand times — which is exactly what
  // makes it read as wallpaper rather than as leaves.
  readonly foliageMat = makeLeafClusterMaterial('foliage/leaves', LEAF_RECTS, 0xbeef);
  readonly foliage2Mat = makeLeafClusterMaterial('foliage/leaves', LEAF_RECTS, 0x1c3d);
  readonly foliage3Mat = makeLeafClusterMaterial('foliage/leaves', LEAF_RECTS, 0x7a91);
  readonly rockMat = makeRockMaterial();
  /** Bushes get their own leaf cluster from the shrub scan — broad leaves, some
   * of them autumn-yellow, which is where most of the undergrowth's colour
   * variation comes from. Reusing the tree canopy made every plant one green. */
  readonly bushMat = makeLeafClusterMaterial('foliage/shrub', SHRUB_RECTS, 0x5117);

  // Flowers, ferns and herbs are photographs of real plants on crossed cards —
  // the old icosahedron-on-a-stick and cone were the most obviously fake things
  // in the undergrowth.
  readonly flowerGeo = makePlantCards(FLOWER_RECTS, 0.34, 0.34, 3);
  readonly flowerMat = makePlantMaterial(
    makeLeafCluster('foliage/gazania', FLOWER_RECTS, { leaves: 9, seed: 0x0f10, size: 384 }),
    0.34,
  );
  // Dandelions (yellow) and celandines — the meadow's other two flowers.
  readonly dandelionGeo = makePlantCards(DANDELION_RECTS, 0.3, 0.32, 3);
  readonly dandelionMat = makePlantMaterial(
    makeLeafCluster('foliage/dandelion', DANDELION_RECTS, { leaves: 8, seed: 0xda1d, size: 384 }),
    0.32,
  );
  readonly daisyGeo = makePlantCards(DAISY_RECTS, 0.26, 0.26, 3);
  readonly daisyMat = makePlantMaterial(
    makeLeafCluster('foliage/celandine', DAISY_RECTS, { leaves: 10, seed: 0xce1a, size: 384 }),
    0.26,
  );

  readonly fernGeo = makePlantCards(FERN_RECTS, 0.5, 0.75, 3);
  readonly fernMat = makePlantMaterial(
    loadPBR('foliage/fern', { alpha: true, arm: false }).map,
    0.75,
    loadPBR('foliage/fern', { alpha: true, arm: false }).alphaMap,
  );
  readonly herbGeo = makePlantCards(FERN_RECTS, 0.3, 0.34, 2);
  readonly herbMat = makePlantMaterial(
    loadPBR('foliage/nettle', { alpha: true, arm: false }).map,
    0.34,
    loadPBR('foliage/nettle', { alpha: true, arm: false }).alphaMap,
  );

  // ── Ground clutter ───────────────────────────────────────────────────────
  readonly stickGeo = makeStick();
  readonly pebbleGeo = makePebbles();
  readonly logGeo = makeLog();
  readonly woodMat = makeBarkMaterial();
  readonly stoneMat = makeRockMaterial();

  // Mushrooms: pale stem + red spotted cap.
  readonly mushStemGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.24, 6);
  readonly mushCapGeo = new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  readonly mushStemMat = new THREE.MeshStandardMaterial({ color: 0xe4d8c0, roughness: 0.9 });
  readonly mushCapMat = new THREE.MeshStandardMaterial({ color: 0xb43b32, roughness: 0.8, flatShading: true });

  // Grass tuft: a small fan of blade-quads (decorative, non-interactive).
  readonly grassGeo = makeGrassTuft();
  readonly grassMat = makeGrassMaterial();

  constructor() {
    this.trunkGeo.translate(0, 1.7, 0); // pivot at base
    this.pineTrunkGeo.translate(0, 3.6, 0);
    // The canopy tiers already stagger themselves vertically (makeCanopy's
    // yOffset), so they all sit on the same base — just below the trunk's top.
    this.foliageGeo.translate(0, 2.7, 0);
    this.foliage2Geo.translate(0, 2.7, 0);
    this.foliage3Geo.translate(0, 2.7, 0);
    this.bushGeo.scale(1, 0.8, 1);
    this.bushGeo.translate(0, 0.15, 0);
    // The berries must take the same squash and lift as the leaf shell they sit
    // inside, or the fruit ends up hanging in the air beside the bush.
    this.berryGeo.scale(1, 0.8, 1);
    this.berryGeo.translate(0, 0.15, 0);
    // Plant cards already pivot at ground level (makePlantCards translates them).
    this.mushStemGeo.translate(0, 0.12, 0);
    this.mushCapGeo.translate(0, 0.24, 0);
  }
}

/** The two clean needle sprigs in the scanned pine atlas. The rest of that image
 * is smeared UV filler from the photogrammetry unwrap. */
const PINE_RECTS = [
  { u: 0.029, v: 0.556, w: 0.2, h: 0.41 },
  { u: 0.674, v: 0.478, w: 0.269, h: 0.181 },
];

/**
 * A conifer: rings of needle cards on a tall spike, each ring wider than the one
 * above it and angled downward.
 *
 * A spruce is not a ball on a stick — it is a *cone of drooping tiers*, and that
 * silhouette is basically the whole species. Getting the taper and the downward
 * tilt right matters far more than the texture does.
 */
function makeConifer(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const rng = mulberry32(0xc04f1e);
  const RINGS = 7;
  const BOTTOM = 1.4; // where the lowest branches start
  const TOP = 7.6;

  for (let r = 0; r < RINGS; r++) {
    const t = r / (RINGS - 1); // 0 at the bottom ring, 1 at the tip
    const y = BOTTOM + t * (TOP - BOTTOM);
    // Taper: wide skirt, narrow crown. Slightly convex, not a straight cone.
    const radius = 2.1 * Math.pow(1 - t, 0.78) + 0.12;
    const cards = Math.max(3, Math.round(7 * (1 - t) + 3));

    for (let i = 0; i < cards; i++) {
      const theta = (i / cards) * Math.PI * 2 + r * 0.9 + rng() * 0.4;
      const size = radius * (0.95 + rng() * 0.4);
      const q = new THREE.PlaneGeometry(size * 1.5, size);
      // Branches hang. Tilt the card down and outward.
      q.rotateX(0.42 + rng() * 0.2);
      q.rotateY(theta);
      q.translate(
        Math.cos(theta) * radius * 0.55,
        y + (rng() - 0.5) * 0.25,
        Math.sin(theta) * radius * 0.55,
      );
      geos.push(q);
    }
  }
  return mergeGeometries(geos);
}

/**
 * Branches for a broadleaf: a few tapered limbs sweeping up and out of the trunk
 * into the canopy. Without them the crown floats on a bare pole, which is the
 * single most obvious sign of a procedural tree.
 */
function makeBranches(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const rng = mulberry32(0xb2a4c);
  const N = 6;
  for (let i = 0; i < N; i++) {
    const theta = (i / N) * Math.PI * 2 + rng() * 0.5;
    const len = 1.5 + rng() * 0.9;
    const g = new THREE.CylinderGeometry(0.035, 0.085, len, 5);
    // Pivot at the base of the limb, then sweep it out and up.
    g.translate(0, len / 2, 0);
    g.rotateZ(0.75 + rng() * 0.35); // lean outward
    g.rotateY(theta);
    g.translate(0, 2.3 + rng() * 0.8, 0); // spring from partway up the trunk
    geos.push(g);
  }
  return mergeGeometries(geos);
}

/** Tapered trunk with bark UVs scaled to life size (rather than stretched). */
function makeTrunk(rTop: number, rBot: number, h: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 10, 1, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const circumference = 2 * Math.PI * rBot;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * circumference * 0.8, uv.getY(i) * h * 0.35);
  }
  return g;
}

/**
 * A canopy tier: leaf cards scattered over the surface of a squashed sphere.
 * A solid cone is the classic procedural-tree tell — a real canopy is a shell of
 * leaf clusters with sky showing through it, so that's what this builds. Each
 * card is a quad UV'd to one clump of the scanned leaf atlas, tilted outward
 * along the sphere normal so the shell catches light from the right side.
 */
function makeCanopy(radius: number, height: number, cards: number, yOffset: number): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const rng = mulberry32(0x1eaf + cards * 7919);
  for (let i = 0; i < cards; i++) {
    // Distribute over the shell of a squashed sphere. The sqrt spreads points
    // evenly by area rather than bunching them at the pole.
    const t = (i + 0.5) / cards;
    const phi = Math.acos(1 - 1.7 * t); // bias to the top/sides, not the underside
    const theta = i * 2.399 + rng() * 0.7;

    const size = radius * (0.75 + rng() * 0.45);
    const q = new THREE.PlaneGeometry(size, size);
    // Each card is a whole leaf clump (see makeLeafCluster), so it uses the full
    // texture — no atlas sub-rect.
    q.rotateZ(rng() * Math.PI * 2);
    q.rotateX(phi - Math.PI / 2);
    q.rotateY(theta);
    q.translate(
      Math.sin(phi) * Math.cos(theta) * radius * 0.62,
      yOffset + Math.cos(phi) * height * 0.45 + height * 0.12,
      Math.sin(phi) * Math.sin(theta) * radius * 0.62,
    );
    geos.push(q);
  }
  return mergeGeometries(geos);
}

/**
 * Berries for a bush: little spheres scattered through the volume the leaf cards
 * occupy — *inside* the shell, at a slightly smaller radius, so they peek out
 * from between the leaves the way real fruit does. Merged into one geometry so a
 * whole chunk's berries cost a single instanced draw.
 */
function makeBerries(radius: number, height: number, count: number): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const rng = mulberry32(0xb3221);
  const bead = new THREE.SphereGeometry(0.035, 6, 5);
  for (let i = 0; i < count; i++) {
    // Berries grow in little clusters, not evenly — pick a few anchor points and
    // hang two or three berries off each.
    const t = (i + 0.5) / count;
    const phi = Math.acos(1 - 1.6 * t);
    const theta = i * 2.399 + rng() * 0.8;
    // 0.78 of the leaf radius: deep enough to be *in* the foliage, shallow
    // enough to be seen through it.
    const r = radius * 0.78 * (0.85 + rng() * 0.25);

    const g = bead.clone();
    g.translate(
      Math.sin(phi) * Math.cos(theta) * r + (rng() - 0.5) * 0.06,
      Math.cos(phi) * height * 0.42 + height * 0.16 + (rng() - 0.5) * 0.06,
      Math.sin(phi) * Math.sin(theta) * r + (rng() - 0.5) * 0.06,
    );
    geos.push(g);
  }
  bead.dispose();
  return mergeGeometries(geos);
}

/** A fallen branch: a slightly bent twig lying flat on the ground. */
function makeStick(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.CylinderGeometry(0.022, 0.032, 0.85, 5);
  main.rotateZ(Math.PI / 2); // lay it down
  main.rotateY(0.2);
  main.translate(0, 0.03, 0);
  parts.push(main);
  // A side twig, so it isn't a perfect dowel.
  const twig = new THREE.CylinderGeometry(0.012, 0.018, 0.3, 4);
  twig.rotateZ(Math.PI / 2.3);
  twig.rotateY(-0.9);
  twig.translate(0.18, 0.04, 0.1);
  parts.push(twig);
  return mergeGeometries(parts);
}

/** A small scatter of loose stones — several, because one lone pebble reads as
 * a dropped prop rather than as ground. */
function makePebbles(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rng = mulberry32(0x9eb1);
  for (let i = 0; i < 4; i++) {
    const r = 0.06 + rng() * 0.07;
    const g = new THREE.DodecahedronGeometry(r, 0);
    g.scale(1, 0.6 + rng() * 0.3, 1);
    const a = rng() * Math.PI * 2;
    const d = rng() * 0.2;
    g.rotateY(rng() * Math.PI);
    g.translate(Math.cos(a) * d, r * 0.5, Math.sin(a) * d);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/** A fallen log: a thick trunk lying on its side, with a broken-off stub. */
function makeLog(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.19, 0.24, 2.6, 9);
  // Real bark UVs — the log is big enough to read the texture on.
  const uv = trunk.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.4, uv.getY(i) * 0.9);
  trunk.rotateZ(Math.PI / 2);
  trunk.rotateY(0.35);
  trunk.translate(0, 0.22, 0);
  parts.push(trunk);
  const stub = new THREE.CylinderGeometry(0.06, 0.09, 0.5, 6);
  stub.rotateZ(0.7);
  stub.rotateY(1.2);
  stub.translate(0.55, 0.4, 0.15);
  parts.push(stub);
  return mergeGeometries(parts);
}

/** Lumpy boulder: an icosphere pushed around by noise, so no two rocks match. */
function makeRock(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.8, 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * 3.1 + 1.3) * Math.cos(v.y * 2.7) * Math.sin(v.z * 3.9 - 0.4) * 0.22 +
      Math.sin(v.x * 8.3) * Math.sin(v.z * 7.1) * 0.06;
    v.multiplyScalar(1 + n);
    v.y *= 0.75; // boulders sit low, not spherical
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // Spherical UVs so the scanned rock texture wraps without a visible seam pole.
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    uv[i * 2] = (Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5) * 1.6;
    uv[i * 2 + 1] = (Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) / Math.PI + 0.5) * 1.6;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function makeBarkMaterial(): THREE.MeshStandardMaterial {
  const b = loadPBR('bark/pine');
  const mat = new THREE.MeshStandardMaterial({
    map: b.map,
    normalMap: b.normalMap,
    side: THREE.DoubleSide, // trunk is open-ended, so we see the inside at the top
  });
  applyARM(mat, b.armMap);
  return mat;
}

function makeRockMaterial(): THREE.MeshStandardMaterial {
  const r = loadPBR('terrain/rock');
  const mat = new THREE.MeshStandardMaterial({ map: r.map, normalMap: r.normalMap });
  applyARM(mat, r.armMap);
  return mat;
}

/**
 * Where the individual leaves sit in the scanned atlas: a grid of single leaves
 * on black. makeLeafCluster stamps these into a dense clump card.
 */
const LEAF_RECTS = [
  { u: 0.02, v: 0.55, w: 0.16, h: 0.42 },
  { u: 0.17, v: 0.6, w: 0.15, h: 0.38 },
  { u: 0.35, v: 0.63, w: 0.13, h: 0.35 },
  { u: 0.52, v: 0.62, w: 0.13, h: 0.36 },
  { u: 0.68, v: 0.58, w: 0.16, h: 0.4 },
  { u: 0.02, v: 0.06, w: 0.17, h: 0.36 },
  { u: 0.22, v: 0.03, w: 0.15, h: 0.42 },
  { u: 0.43, v: 0.03, w: 0.14, h: 0.4 },
];

/** Canopy/bush material: leaves stamped from a scan into a clump card. */
function makeLeafClusterMaterial(
  atlas: string,
  rects: { u: number; v: number; w: number; h: number }[],
  seed: number,
): THREE.MeshStandardMaterial {
  const cluster = makeLeafCluster(atlas, rects, { leaves: 110, seed });
  const mat = new THREE.MeshStandardMaterial({
    map: cluster,
    // The cluster texture carries its own alpha, so cut straight from it.
    alphaTest: 0.42,
    transparent: false,
    side: THREE.DoubleSide,
    roughness: 0.95, // matte, for the same reason as the grass cards
    metalness: 0,
  });

  mat.onBeforeCompile = (sh) => {
    sh.uniforms['uWind'] = worldClock;
    sh.vertexShader =
      'uniform float uWind;\n' +
      sh.vertexShader
        // Same problem as grass: a leaf card's true normal points out of the
        // quad, so half the canopy lights black. Blending it towards the
        // outward direction from the trunk makes the canopy shade like a mass
        // of foliage rather than a pile of flat cards.
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = normalize(mix(normalize(position + vec3(0.0, 0.6, 0.0)), normal, 0.35));`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
         float wph = uWind * 1.1 + instanceMatrix[3].x * 0.3 + instanceMatrix[3].z * 0.3;
         float sway = smoothstep(0.4, 3.5, position.y) * 0.09;
         transformed.x += sin(wph) * sway;
         transformed.z += cos(wph * 0.8) * sway * 0.7;`,
        );
  };
  return mat;
}

/**
 * Crossed billboards for a single plant, each card UV'd to a different specimen
 * in a scanned atlas. Same trick as the grass tuft: two or three quads at an
 * angle read as a volume from any direction, and the alpha cutout does the rest.
 */
function makePlantCards(
  rects: { u: number; v: number; w: number; h: number }[],
  width: number,
  height: number,
  cards = 2,
): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < cards; i++) {
    const g = new THREE.PlaneGeometry(width, height, 1, 3);
    g.translate(0, height / 2, 0);
    g.rotateY((i / cards) * Math.PI);
    const r = rects[i % rects.length]!;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let v = 0; v < uv.count; v++) {
      uv.setXY(v, r.u + uv.getX(v) * r.w, r.v + uv.getY(v) * r.h);
    }
    geos.push(g);
  }
  return mergeGeometries(geos);
}

/** A matte, alpha-cut, wind-swayed material for a plant billboard.
 * `alphaMap` is null when the map already carries its own alpha (a composited
 * cluster canvas does; a raw scanned atlas keeps its mask in a separate image). */
function makePlantMaterial(
  map: THREE.Texture,
  swayHeight: number,
  alphaMap: THREE.Texture | null = null,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map,
    alphaMap,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    // Vegetation is uniformly rough. A scanned roughness map here makes plants
    // mirror the sky and turn silver (see the grass material).
    roughness: 0.95,
    metalness: 0,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms['uWind'] = worldClock;
    sh.vertexShader =
      'uniform float uWind;\n' +
      sh.vertexShader
        // Shade with a mostly-upward normal, or each vertical card lights like a
        // little wall and the undergrowth reads as shiny litter.
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + normal * 0.35);`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
         float h = clamp(position.y / ${swayHeight.toFixed(2)}, 0.0, 1.0);
         float wph = uWind * 1.3 + instanceMatrix[3].x * 0.3 + instanceMatrix[3].z * 0.3;
         float bend = h * h * 0.09;
         transformed.x += sin(wph) * bend;
         transformed.z += cos(wph * 0.7) * bend * 0.7;`,
        );
  };
  return mat;
}

/** Fern fronds — five specimens in the scan, all upright. */
const FERN_RECTS = [
  { u: 0.093, v: 0.092, w: 0.152, h: 0.81 },
  { u: 0.313, v: 0.219, w: 0.147, h: 0.742 },
  { u: 0.532, v: 0.482, w: 0.142, h: 0.498 },
  { u: 0.737, v: 0.131, w: 0.112, h: 0.771 },
  { u: 0.513, v: 0.121, w: 0.112, h: 0.381 },
];

/** Broad shrub leaves — green *and* autumn-yellow, which is most of where the
 * undergrowth's colour variation comes from. */
const SHRUB_RECTS = [
  { u: 0.45, v: 0.68, w: 0.23, h: 0.3 },
  { u: 0.73, v: 0.69, w: 0.16, h: 0.24 },
  { u: 0.22, v: 0.2, w: 0.22, h: 0.32 },
  { u: 0.72, v: 0.22, w: 0.21, h: 0.32 },
  { u: 0.05, v: 0.72, w: 0.13, h: 0.22 }, // autumn yellow
  { u: 0.02, v: 0.06, w: 0.19, h: 0.28 }, // autumn yellow
];

/** Dandelion: two open yellow blooms and its serrated leaves. */
const DANDELION_RECTS = [
  { u: 0.58, v: 0.755, w: 0.19, h: 0.22 }, // bloom
  { u: 0.82, v: 0.76, w: 0.17, h: 0.21 }, // bloom
  { u: 0.03, v: 0.32, w: 0.14, h: 0.42 }, // leaf
  { u: 0.31, v: 0.06, w: 0.32, h: 0.28 }, // leaf
];

/** Celandine — the atlas is a plant on black, so a coarse split is enough. */
const DAISY_RECTS = [
  { u: 0.05, v: 0.5, w: 0.4, h: 0.45 },
  { u: 0.52, v: 0.5, w: 0.4, h: 0.45 },
  { u: 0.05, v: 0.05, w: 0.4, h: 0.4 },
  { u: 0.52, v: 0.05, w: 0.4, h: 0.4 },
];

/** Gazania: two open flower heads plus its lobed leaves. */
const FLOWER_RECTS = [
  { u: 0.02, v: 0.023, w: 0.3, h: 0.318 }, // big bloom
  { u: 0.39, v: 0.062, w: 0.225, h: 0.21 }, // second bloom
  { u: 0.273, v: 0.317, w: 0.41, h: 0.176 }, // leaf
  { u: 0.605, v: 0.385, w: 0.37, h: 0.107 }, // leaf
];

/**
 * Grass tuft: crossed billboards carrying a *photograph* of a real grass clump,
 * cut out of the scanned atlas (see GRASS_CARDS). Flat-shaded geometric blades
 * are the single biggest tell that a scene is procedural — a photo card with an
 * alpha cutout costs two quads and looks like grass.
 *
 * Each card samples a different clump from the atlas, so a field doesn't repeat.
 * UV v runs 0 at the root → 1 at the tip so the wind shader can bend the tips.
 */
function makeGrassTuft(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];

  // A skirt of low, wide cards around the base of the clump.
  //
  // Tall tufts alone leave the ground showing between them, and no amount of
  // extra tufts closes that up — you just get taller gaps. Real turf is grass
  // all the way down: a dense low mat with taller clumps standing out of it.
  // These cost 3 quads per tuft (no extra draw call, they merge into the same
  // geometry) and they are what stops the field reading as plants sitting on
  // dirt.
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(0.85, 0.26, 1, 1);
    g.translate(0, 0.12, 0);
    g.rotateX(-0.75); // lie it over, almost flat against the ground
    g.rotateY((i / 4) * Math.PI * 2 + 0.4);
    const card = GRASS_CARDS[(i + 2) % GRASS_CARDS.length]!;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let v = 0; v < uv.count; v++) {
      uv.setXY(v, card.u + uv.getX(v) * card.w, card.v + uv.getY(v) * card.h * 0.45);
    }
    geos.push(g);
  }

  const N = 3; // three tall cards at 60° — reads as volume from any angle
  for (let i = 0; i < N; i++) {
    // Taller than wide. The old card was 0.55 × 0.42, which is a doormat; real
    // meadow grass stands up, and the height is what fills the gaps between
    // tufts when you look across a field at a shallow angle.
    // Two height segments, not three. The wind bend only needs enough rows to
    // curve; a third row cost 2 triangles per card across ~130k tufts.
    const g = new THREE.PlaneGeometry(0.5, 0.62, 1, 2);
    g.translate(0, 0.31, 0);
    g.rotateY((i / N) * Math.PI);
    // Pick one of the atlas clumps for this card.
    const card = GRASS_CARDS[i % GRASS_CARDS.length]!;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let v = 0; v < uv.count; v++) {
      uv.setXY(v, card.u + uv.getX(v) * card.w, card.v + uv.getY(v) * card.h);
    }
    geos.push(g);
  }
  // Manual merge (position + uv + index), no external util.
  let posLen = 0;
  let idxLen = 0;
  for (const g of geos) {
    posLen += (g.getAttribute('position').array as Float32Array).length;
    idxLen += (g.getIndex()!.array as ArrayLike<number>).length;
  }
  const positions = new Float32Array(posLen);
  const uvs = new Float32Array((posLen / 3) * 2);
  const indices = new Uint16Array(idxLen);
  let po = 0;
  let uo = 0;
  let io = 0;
  let vbase = 0;
  for (const g of geos) {
    const p = g.getAttribute('position').array as Float32Array;
    const u = g.getAttribute('uv').array as Float32Array;
    const idx = g.getIndex()!.array as ArrayLike<number>;
    positions.set(p, po);
    uvs.set(u, uo);
    for (let i = 0; i < idx.length; i++) indices[io + i] = idx[i]! + vbase;
    po += p.length;
    uo += u.length;
    io += idx.length;
    vbase += p.length / 3;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeVertexNormals();
  return merged;
}

/** Grass material with a shared wind uniform that bends blade tips.
 * Base color is white so per-instance colors define the final green directly
 * (multiplying a green base by a green tint compounds into near-black). */
/**
 * Sub-rectangles of the scanned grass atlas that contain a whole clump, in UV
 * space with (0,0) bottom-left. The atlas is packed for the original
 * photogrammetry mesh, so most of it is smeared UV filler — these are the
 * regions that actually hold usable billboards (the bottom row of the image).
 */
/**
 * Where the grass carpet fades out, in metres from the camera. Must stay inside
 * the smallest grassRadius (1 chunk = 64 m guaranteed in every direction), or
 * the ring would end before the fade does and you'd see the edge.
 */
const GRASS_FADE = { start: 40, end: 58 };

const GRASS_CARDS = [
  { u: 0.215, v: 0.109, w: 0.2, h: 0.127 },
  { u: 0.586, v: 0.113, w: 0.195, h: 0.115 },
  { u: 0.259, v: 0.009, w: 0.2, h: 0.098 },
  { u: 0.6, v: 0.009, w: 0.17, h: 0.09 },
  { u: 0.015, v: 0.012, w: 0.14, h: 0.095 },
];

function makeGrassMaterial(): THREE.MeshStandardMaterial {
  const g = loadPBR('foliage/grass_blades', { alpha: true, arm: false });
  const mat = new THREE.MeshStandardMaterial({
    map: g.map,
    alphaMap: g.alphaMap,
    // Cutout, not blending: alpha-tested grass writes depth, so tufts sort
    // correctly against each other with no per-instance depth sorting.
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    // No roughness map from the scan. Its ARM green channel is dark, which reads
    // as a near-mirror surface — the tufts then reflect the sky and the whole
    // field turns silver. Vegetation is uniformly rough; just say so.
    roughness: 0.95,
    metalness: 0,
  });

  mat.onBeforeCompile = (sh) => {
    sh.uniforms['uWind'] = worldClock;
    sh.vertexShader =
      'uniform float uWind;\n' +
      sh.vertexShader
        // Cards are vertical planes, so their true normals point sideways and
        // each card lights like a little wall — a field of them reads as shiny
        // debris scattered on the hill. Shading them with a mostly-upward normal
        // makes grass catch light the way the ground under it does.
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + normal * 0.3);`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
         // Bend from height above the tuft's base. (Not uv.y — these UVs point
         // into an atlas sub-rect now, so they no longer run 0→1 up the blade.)
         float h = clamp(position.y / 0.62, 0.0, 1.0);
         float wph = uWind * 1.6 + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.35;
         float bend = h * h * 0.14;
         transformed.x += sin(wph) * bend;
         transformed.z += cos(wph * 0.7) * bend * 0.7;

         // Distance fade. The dense carpet only exists in a ring around the
         // player (quality().grassRadius), and ending it at a chunk border would
         // draw a hard line of grass across the field. Instead the tufts sink
         // into the ground as they approach the edge of the ring, which reads as
         // the grass simply becoming ground texture — the terrain's albedo is a
         // photo of grass anyway, so the handoff is invisible.
         vec3 wpos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
         float dist = distance(wpos.xz, cameraPosition.xz);
         float fade = 1.0 - smoothstep(${GRASS_FADE.start.toFixed(1)}, ${GRASS_FADE.end.toFixed(1)}, dist);
         transformed.y *= fade;`,
        );
  };
  return mat;
}

const TINT = new THREE.Color();

/** Stable [0,1) hash from a world position — same tree, same colour, every load. */
function hash01(x: number, z: number, salt: number): number {
  const n = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

const M = new THREE.Matrix4();
const P = new THREE.Vector3();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Build the instanced meshes for one chunk's scatter. */
export function buildScatterMeshes(
  assets: ScatterAssets,
  instances: ScatterInstance[],
): THREE.InstancedMesh[] {
  const trees = instances.filter((i) => i.type === 'tree');
  const pines = instances.filter((i) => i.type === 'pine');
  const rocks = instances.filter((i) => i.type === 'rock');
  const bushes = instances.filter((i) => i.type === 'bush');
  const flowers = instances.filter((i) => i.type === 'flower');
  const mushrooms = instances.filter((i) => i.type === 'mushroom');
  const herbs = instances.filter((i) => i.type === 'herb');
  const ferns = instances.filter((i) => i.type === 'fern');
  const dandelions = instances.filter((i) => i.type === 'dandelion');
  const daisies = instances.filter((i) => i.type === 'daisy');
  const sticks = instances.filter((i) => i.type === 'stick');
  const pebbles = instances.filter((i) => i.type === 'pebble');
  const logs = instances.filter((i) => i.type === 'log');

  const meshes: THREE.InstancedMesh[] = [];
  const make = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    list: ScatterInstance[],
    name: string,
    castShadow = true,
    /** Per-instance colour jitter — see TINT below. 0 = leave the texture alone. */
    tint = 0,
  ) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    // Anything too small to cast a shadow is also too small to be worth a second
    // full render into the ambient-occlusion depth buffer. That's every flower,
    // fern, herb, mushroom, stick and pebble — hundreds of draw calls for an
    // effect measured in single pixels.
    if (!castShadow) mesh.userData['noAO'] = true;
    list.forEach((inst, i) => {
      P.set(inst.x, inst.y, inst.z);
      Q.setFromAxisAngle(Y_AXIS, inst.rotation);
      // Trees vary in height as well as girth — scaling uniformly makes a forest
      // of identical trees at different sizes, which the eye reads as a repeat.
      S.set(inst.scale, inst.scale * (0.85 + hash01(inst.x, inst.z, 31) * 0.45), inst.scale);
      mesh.setMatrixAt(i, M.compose(P, Q, S));

      if (tint > 0) {
        // A real stand of trees is not one green: individuals differ in hue
        // (yellow-green through blue-green) and in how much light they've had.
        // One colour for the whole species is the loudest "instanced" tell there
        // is, and it costs nothing to break it.
        const t = hash01(inst.x, inst.z, 17);
        const shade = hash01(inst.x, inst.z, 23);
        TINT.setHSL(
          0.22 + t * 0.09 * tint, // yellow-green → blue-green
          0.35 + t * 0.25,
          0.72 + (shade - 0.5) * 0.3 * tint,
        );
        mesh.setColorAt(i, TINT);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Attach the source list so raycast hits can resolve identity later (M2).
    mesh.userData.instances = list;
    meshes.push(mesh);
  };

  make(assets.trunkGeo, assets.trunkMat, trees, 'trunks', true, 0.25);
  make(assets.branchGeo, assets.trunkMat, trees, 'branches', true, 0.25);
  make(assets.pineTrunkGeo, assets.trunkMat, pines, 'pineTrunks', true, 0.25);
  make(assets.pineCanopyGeo, assets.pineMat, pines, 'pineCanopy', true, 0.7);
  make(assets.foliageGeo, assets.foliageMat, trees, 'foliage', true, 1);
  make(assets.foliage2Geo, assets.foliage2Mat, trees, 'foliage2', true, 1);
  make(assets.foliage3Geo, assets.foliage3Mat, trees, 'foliage3', true, 1);
  make(assets.rockGeo, assets.rockMat, rocks, 'rocks', true, 0.3);
  make(assets.bushGeo, assets.bushMat, bushes, 'bushes', false, 1);
  // Fruit. Not tinted: a berry bush should read as a berry bush at a glance, and
  // hue-jittering the berries along with the leaves would grey them out.
  make(assets.berryGeo, assets.berryMat, bushes, 'berries', false);
  // Small plants — no shadow casting (cheap, and they'd shadow-flicker).
  make(assets.flowerGeo, assets.flowerMat, flowers, 'flowers', false);
  make(assets.dandelionGeo, assets.dandelionMat, dandelions, 'dandelions', false);
  make(assets.daisyGeo, assets.daisyMat, daisies, 'daisies', false);
  make(assets.fernGeo, assets.fernMat, ferns, 'ferns', false);
  make(assets.herbGeo, assets.herbMat, herbs, 'herbs', false);
  make(assets.mushStemGeo, assets.mushStemMat, mushrooms, 'mushStems', false);
  make(assets.mushCapGeo, assets.mushCapMat, mushrooms, 'mushCaps', false);
  // Ground clutter. Logs cast shadows (they're big enough to matter); sticks and
  // pebbles don't — they'd cost a shadow draw to produce a smudge.
  make(assets.logGeo, assets.woodMat, logs, 'logs', true, 0.2);
  make(assets.stickGeo, assets.woodMat, sticks, 'sticks', false, 0.2);
  make(assets.pebbleGeo, assets.stoneMat, pebbles, 'pebbles', false, 0.25);
  return meshes;
}
