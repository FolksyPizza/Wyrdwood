import * as THREE from 'three';
import type RAPIER_API from '@dimforge/rapier3d-compat';
import { Physics, RAPIER } from '../physics/physics';
import { SEA_LEVEL, Terrain } from './terrain';
import {
  ScatterAssets,
  buildScatterMeshes,
  scatterForChunk,
  type ScatterInstance,
} from './scatter';
import { onSettingsChange, quality, settings } from '../data/settings';
import { cellHash } from './noise';
import { makeTerrainMaterial } from '../render/terrainMaterial';

export const CHUNK_SIZE = 64;
/** Quads per chunk edge (65×65 vertices, 1 m spacing). At 2 m the ridges and
 * gullies the height field now produces were being averaged away by the mesh. */
const RES = 64;

interface Chunk {
  key: string;
  groundMesh: THREE.Mesh;
  scatterMeshes: THREE.InstancedMesh[];
  groundCollider: RAPIER_API.Collider;
  scatterColliders: Map<ScatterInstance, RAPIER_API.Collider>;
  scatter: ScatterInstance[];
  grassMesh: THREE.InstancedMesh | null;
  /** Grass is dense, so it's only built for chunks near the player — this marks
   * whether we've already tried (a null mesh after trying means "no grass here"). */
  grassBuilt: boolean;
}


/**
 * How grass grows per biome: how much of the ground it covers, and how long it
 * runs. Height is a range, not a value — a field with one uniform blade length
 * looks mown, and that was a big part of why the meadow read as fake.
 *
 *   meadow   — open, sunlit, long grass
 *   forest   — shaded understorey, sparser and cropped short
 *   shore    — thin scrubby marram in sand
 *   mountain — a little tough tussock in the lee of rocks
 */
const GRASS_BY_BIOME: Record<string, { density: number; minH: number; maxH: number }> = {
  meadow: { density: 0.95, minH: 0.55, maxH: 1.5 },
  forest: { density: 0.6, minH: 0.35, maxH: 0.85 },
  shore: { density: 0.22, minH: 0.3, maxH: 0.6 },
  mountain: { density: 0.18, minH: 0.3, maxH: 0.7 },
  snow: { density: 0, minH: 0, maxH: 0 },
  none: { density: 0, minH: 0, maxH: 0 },
};

/** The grass-affecting settings, as a comparable key. */
function grassKey(): string {
  return `${settings.grassDensity}`;
}

/** Stable identity for a scatter instance (survives chunk unload/reload). */
export function instanceKey(inst: ScatterInstance): string {
  return `${inst.type}:${inst.x.toFixed(2)},${inst.z.toFixed(2)}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Streams terrain chunks (mesh + trimesh collider + scatter) around the player.
 * Generation is amortized: at most one chunk is built per update tick.
 * Also owns scatter harvesting: damage → deplete → remove instance + collider.
 */
export class ChunkManager {
  private chunks = new Map<string, Chunk>();
  private buildQueue: { cx: number; cz: number }[] = [];
  private queued = new Set<string>();
  private assets = new ScatterAssets();
  /** Photoscanned 4-layer PBR ground (grass/rock/sand/snow) — see terrainMaterial.ts. */
  private groundMat = makeTerrainMaterial();
  /** Harvested-object keys — world modifications that survive chunk reload (saved in M8). */
  readonly removedInstances = new Set<string>();
  /** Partial-harvest progress (instanceKey → remaining hp) — survives chunk
   * reload and is serialized in saves so trees don't heal when you walk off. */
  readonly damagedInstances = new Map<string, number>();

  /** The grass settings the loaded chunks were baked with. Grass density and
   * height are baked into each chunk's instanced mesh, so changing them means
   * restreaming — but *only* those two: rebuilding on any settings change (e.g.
   * a volume slider) would drop the world every time you touched the mixer. */
  private builtGrass = grassKey();

  constructor(
    private scene: THREE.Scene,
    private physics: Physics,
    private terrain: Terrain,
  ) {
    onSettingsChange(() => {
      if (grassKey() === this.builtGrass) return;
      this.builtGrass = grassKey();
      for (const [key, chunk] of this.chunks) this.unloadChunk(key, chunk);
    });
  }

  /** Call each fixed tick with the player position. */
  update(px: number, pz: number): void {
    const ccx = Math.floor(px / CHUNK_SIZE);
    const ccz = Math.floor(pz / CHUNK_SIZE);
    const viewRadius = settings.viewRadius; // render distance (settings-driven)

    for (let dx = -viewRadius; dx <= viewRadius; dx++) {
      for (let dz = -viewRadius; dz <= viewRadius; dz++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const key = `${cx},${cz}`;
        if (!this.chunks.has(key) && !this.queued.has(key)) {
          this.queued.add(key);
          this.buildQueue.push({ cx, cz });
        }
      }
    }
    this.buildQueue.sort(
      (a, b) => Math.hypot(a.cx - ccx, a.cz - ccz) - Math.hypot(b.cx - ccx, b.cz - ccz),
    );

    // Build one chunk per tick to avoid frame hitches.
    const next = this.buildQueue.shift();
    if (next) {
      const key = `${next.cx},${next.cz}`;
      this.queued.delete(key);
      if (!this.chunks.has(key)) this.buildChunk(next.cx, next.cz);
    }

    // Grass is far denser than the rest of the scatter, so it only exists in a
    // small ring around the player — beyond that it's sub-pixel anyway.
    const grassRadius = Math.min(quality().grassRadius, viewRadius);

    for (const [key, chunk] of this.chunks) {
      const parts = key.split(',');
      const cx = Number(parts[0]);
      const cz = Number(parts[1]);
      const d = Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz));
      if (d > viewRadius + 1) {
        this.unloadChunk(key, chunk);
        continue;
      }
      if (d <= grassRadius) {
        if (!chunk.grassBuilt) {
          chunk.grassBuilt = true;
          chunk.grassMesh = this.buildGrass(cx, cz);
          if (chunk.grassMesh) this.scene.add(chunk.grassMesh);
        }
        if (chunk.grassMesh) chunk.grassMesh.visible = true;
      } else if (chunk.grassMesh) {
        chunk.grassMesh.visible = false;
      }
    }
  }

  /** True once the chunk under (x,z) has its collider — safe to drop the player. */
  isLoadedAt(x: number, z: number): boolean {
    return this.chunks.has(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`);
  }

  /** All scatter instanced meshes (for interaction raycasts). */
  get interactables(): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const c of this.chunks.values()) out.push(...c.scatterMeshes);
    return out;
  }

  /** Scatter meshes from the 3×3 chunks around (x,z) — interaction range is tiny. */
  interactablesNear(x: number, z: number): THREE.InstancedMesh[] {
    const ccx = Math.floor(x / CHUNK_SIZE);
    const ccz = Math.floor(z / CHUNK_SIZE);
    const out: THREE.InstancedMesh[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.chunks.get(`${ccx + dx},${ccz + dz}`);
        if (c) out.push(...c.scatterMeshes);
      }
    }
    return out;
  }

  /** Remove a depleted scatter instance (mesh + collider). O(1): the instance
   * matrix is zero-scaled in place instead of rebuilding the whole chunk. */
  removeInstance(inst: ScatterInstance): void {
    const chunk = this.chunkAt(inst.x, inst.z);
    if (!chunk) return;
    const idx = chunk.scatter.indexOf(inst);
    if (idx === -1) return;
    chunk.scatter.splice(idx, 1);
    const key = instanceKey(inst);
    this.removedInstances.add(key);
    this.damagedInstances.delete(key);

    const collider = chunk.scatterColliders.get(inst);
    if (collider) {
      this.physics.world.removeCollider(collider, false);
      chunk.scatterColliders.delete(inst);
    }
    // Collapse this instance in every mesh that contains it (trunk + foliage share lists).
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const mesh of chunk.scatterMeshes) {
      const list = mesh.userData.instances as ScatterInstance[];
      const i = list.indexOf(inst);
      if (i !== -1) {
        mesh.setMatrixAt(i, zero);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** Record partial-harvest progress so it persists across chunk reload/save. */
  recordDamage(inst: ScatterInstance, hp: number): void {
    this.damagedInstances.set(instanceKey(inst), hp);
  }

  private chunkAt(x: number, z: number): Chunk | undefined {
    return this.chunks.get(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`);
  }

  private buildChunk(cx: number, cz: number): void {
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const verts = RES + 1;
    const positions = new Float32Array(verts * verts * 3);
    const normals = new Float32Array(verts * verts * 3);
    const colors = new Float32Array(verts * verts * 3);
    const uvs = new Float32Array(verts * verts * 2);
    // Per-vertex blend weights for the four ground layers (grass/rock/sand/snow).
    const splat = new Float32Array(verts * verts * 4);
    const indices = new Uint32Array(RES * RES * 6);
    const color = new THREE.Color();

    let vi = 0;
    for (let iz = 0; iz < verts; iz++) {
      for (let ix = 0; ix < verts; ix++) {
        const wx = x0 + (ix / RES) * CHUNK_SIZE;
        const wz = z0 + (iz / RES) * CHUNK_SIZE;
        const wy = this.terrain.height(wx, wz);
        positions[vi * 3] = wx;
        positions[vi * 3 + 1] = wy;
        positions[vi * 3 + 2] = wz;

        // Analytic normal from the height field — identical across chunk
        // borders, so lighting shows no seams.
        const e = 0.6;
        const hR = this.terrain.height(wx + e, wz);
        const hL = this.terrain.height(wx - e, wz);
        const hU = this.terrain.height(wx, wz + e);
        const hD = this.terrain.height(wx, wz - e);
        const nx = hL - hR;
        const nz = hD - hU;
        const inv = 1 / Math.hypot(nx, 2 * e, nz);
        const ny = 2 * e * inv;
        normals[vi * 3] = nx * inv;
        normals[vi * 3 + 1] = ny;
        normals[vi * 3 + 2] = nz * inv;

        // UVs are raw world metres. The terrain material scales them per layer,
        // and three derives its tangent frame from them — so keeping them in
        // world space is what makes the normal maps correct and makes layers
        // tile seamlessly across chunk borders.
        uvs[vi * 2] = wx;
        uvs[vi * 2 + 1] = wz;

        // Ground-layer weights. Rock takes over on steep faces, sand hugs the
        // waterline, snow caps the peaks, grass fills the rest.
        const slope = 1 - ny; // 0 flat … ~1 vertical
        // Rock comes from TWO things, and the splat only had one of them.
        //
        //  - Slope: past ~0.35 the ground will not hold soil, so it's bare.
        //  - Altitude: above the treeline the ground is bare *regardless* of how
        //    gentle it is. Without this, a broad mountain shoulder is flat enough
        //    to score as "grass", so the whole massif was rendering the brown
        //    forest-floor texture and reading as a sand dune. That was the tan.
        const rockBySlope = smoothstep(0.18, 0.5, slope);
        const rockByAltitude = smoothstep(28, 46, wy);
        const wRock = Math.max(rockBySlope, rockByAltitude);
        const wSand = 1 - smoothstep(0.4, 2.6, wy - SEA_LEVEL);
        const wSnow = smoothstep(58, 74, wy) * (1 - smoothstep(0.55, 0.95, slope));
        const wGrass = Math.max(0, 1 - wRock - wSand - wSnow);
        splat[vi * 4] = wGrass;
        splat[vi * 4 + 1] = wRock;
        splat[vi * 4 + 2] = wSand;
        splat[vi * 4 + 3] = wSnow;

        // Biome tint. The albedo comes from a photoscan, so this is only a nudge
        // towards the biome's hue. Keep it *small*: every multiplier we lay over
        // a scan pulls it away from the photograph and towards flat paint, and
        // stacking tint × macro-variation × AO is exactly why the in-game
        // surfaces read as less real than the source images do.
        color.setHex(this.terrain.biomeAt(wx, wz, wy).color);
        const tint = 0.18;
        let r = 1 + (color.r - 1) * tint;
        let g = 1 + (color.g - 1) * tint;
        let b = 1 + (color.b - 1) * tint;

        // Fake ambient occlusion: darken concave dips/creases.
        const avg = (hR + hL + hU + hD) * 0.25;
        const ao = clamp(1 - (avg - wy) * 0.14, 0.72, 1);
        colors[vi * 3] = r * ao;
        colors[vi * 3 + 1] = g * ao;
        colors[vi * 3 + 2] = b * ao;
        vi++;
      }
    }
    let ii = 0;
    for (let iz = 0; iz < RES; iz++) {
      for (let ix = 0; ix < RES; ix++) {
        const a = iz * verts + ix;
        const b = a + 1;
        const c = a + verts;
        const d = c + 1;
        indices[ii++] = a;
        indices[ii++] = c;
        indices[ii++] = b;
        indices[ii++] = b;
        indices[ii++] = c;
        indices[ii++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    const groundMesh = new THREE.Mesh(geo, this.groundMat);
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    const groundCollider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.trimesh(positions, indices),
    );

    const scatter = scatterForChunk(this.terrain, cx, cz, CHUNK_SIZE).filter(
      (inst) => !this.removedInstances.has(instanceKey(inst)),
    );
    // Restore any partial-harvest progress recorded earlier.
    for (const inst of scatter) {
      const hp = this.damagedInstances.get(instanceKey(inst));
      if (hp !== undefined) inst.hp = hp;
    }
    const scatterMeshes = buildScatterMeshes(this.assets, scatter);
    for (const m of scatterMeshes) this.scene.add(m);

    const scatterColliders = new Map<ScatterInstance, RAPIER_API.Collider>();
    for (const inst of scatter) {
      if (inst.type === 'tree') {
        scatterColliders.set(
          inst,
          this.physics.world.createCollider(
            RAPIER.ColliderDesc.cylinder(1.6 * inst.scale, 0.3 * inst.scale).setTranslation(
              inst.x,
              inst.y + 1.6 * inst.scale,
              inst.z,
            ),
          ),
        );
      } else if (inst.type === 'rock') {
        scatterColliders.set(
          inst,
          this.physics.world.createCollider(
            RAPIER.ColliderDesc.ball(0.7 * inst.scale).setTranslation(inst.x, inst.y + 0.3, inst.z),
          ),
        );
      }
    }

    this.chunks.set(`${cx},${cz}`, {
      key: `${cx},${cz}`,
      groundMesh,
      scatterMeshes,
      groundCollider,
      scatterColliders,
      scatter,
      grassMesh: null, // grass is added lazily once the player is close enough
      grassBuilt: false,
    });
  }

  /** Dense decorative grass tufts (no collider, not interactable). */
  private buildGrass(cx: number, cz: number): THREE.InstancedMesh | null {
    // (see GRASS_BY_BIOME below for how height/density vary by terrain)
    const gd = quality().grassDensity;
    if (gd <= 0) return null; // low preset: no grass carpet at all
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    // Real grassland has no visible gaps. At 0.7 m spacing you could see the dirt
    // between every tuft, which is what made it read as sparse scrub. Each tuft
    // card is ~0.55 m wide, so they have to be planted closer than that to
    // overlap into a continuous carpet.
    const STEP = 0.34;
    const per = Math.floor(CHUNK_SIZE / STEP);
    const placements: {
      x: number;
      y: number;
      z: number;
      /** Clump width/spread. */
      s: number;
      /** Blade length — varies independently of width. */
      h: number;
      r: number;
      tint: number;
    }[] = [];
    for (let gx = 0; gx < per; gx++) {
      for (let gz = 0; gz < per; gz++) {
        const cellX = Math.floor(x0 / STEP) + gx;
        const cellZ = Math.floor(z0 / STEP) + gz;
        const density = cellHash(this.terrain.seed, cellX, cellZ, 10);
        const jx = cellHash(this.terrain.seed, cellX, cellZ, 11);
        const jz = cellHash(this.terrain.seed, cellX, cellZ, 12);
        const x = x0 + gx * STEP + jx * STEP;
        const z = z0 + gz * STEP + jz * STEP;
        const y = this.terrain.height(x, z);
        if (y < SEA_LEVEL + 0.6) continue;
        if (this.terrain.slopeAt(x, z) > 0.7) continue;
        const biome = this.terrain.biomeAt(x, z, y);
        const g = GRASS_BY_BIOME[biome.id] ?? GRASS_BY_BIOME.none!;
        // Density scales with the quality preset; the hash stays seed-stable so
        // the *same* tufts simply thin out on weaker hardware.
        if (density > Math.min(1, g.density * gd)) continue;

        // Height: a real field is never one uniform length. It varies per plant,
        // and it varies by where it's growing — a meadow runs long, a forest
        // floor is cropped by shade, a shoreline is short scrubby marram. Two
        // hashes: a per-tuft roll, plus a slow spatial wave so that tall and
        // short grass fall into *patches* rather than salt-and-pepper noise.
        const roll = cellHash(this.terrain.seed, cellX, cellZ, 13);
        const patch = 0.5 + 0.5 * Math.sin(x * 0.045 + Math.cos(z * 0.037) * 2.1);
        const height = g.minH + (g.maxH - g.minH) * (roll * 0.55 + patch * 0.45);

        placements.push({
          x,
          y,
          z,
          s: 0.72 + roll * 0.42, // width/spread of the clump
          h: height, // height, independently of width
          r: cellHash(this.terrain.seed, cellX, cellZ, 14) * Math.PI,
          tint: cellHash(this.terrain.seed, cellX, cellZ, 15),
        });
      }
    }
    if (placements.length === 0) return null;
    const mesh = new THREE.InstancedMesh(
      this.assets.grassGeo,
      this.assets.grassMat,
      placements.length,
    );
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    placements.forEach((g, i) => {
      p.set(g.x, g.y, g.z);
      q.setFromAxisAngle(yAxis, g.r);
      // Width and height are separate: a tall tuft is not a fat one.
      s.set(g.s, g.h, g.s);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      // The card already carries a photograph of real grass, so this is only a
      // gentle per-tuft shade/hue jitter over it — a saturated tint here would
      // stain the photo and undo the point of using it.
      col.setRGB(0.82 + g.tint * 0.3, 0.88 + g.tint * 0.2, 0.78 + g.tint * 0.22);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  private unloadChunk(key: string, chunk: Chunk): void {
    this.scene.remove(chunk.groundMesh);
    chunk.groundMesh.geometry.dispose();
    for (const m of chunk.scatterMeshes) {
      this.scene.remove(m);
      m.dispose();
    }
    if (chunk.grassMesh) {
      this.scene.remove(chunk.grassMesh);
      chunk.grassMesh.dispose();
    }
    this.physics.world.removeCollider(chunk.groundCollider, false);
    for (const c of chunk.scatterColliders.values()) this.physics.world.removeCollider(c, false);
    this.chunks.delete(key);
  }
}
