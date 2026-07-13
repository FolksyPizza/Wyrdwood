import { LayeredNoise } from './noise';
import { BIOMES, type BiomeDef } from '../data/biomes';

/** Sea level in world units — water plane sits here. */
export const SEA_LEVEL = 0;

/**
 * Pure terrain functions: world (x,z) → height and biome.
 * Everything downstream (meshes, colliders, scatter, minimap) samples these,
 * so terrain is fully deterministic from the seed.
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class Terrain {
  private continents: LayeredNoise;
  private hills: LayeredNoise;
  private detail: LayeredNoise;
  private moisture: LayeredNoise;
  private ridges: LayeredNoise;
  private warp: LayeredNoise;

  constructor(readonly seed: number) {
    this.continents = new LayeredNoise(seed ^ 0x1a2b3c, 3, 1 / 700, 0.55);
    this.hills = new LayeredNoise(seed ^ 0x4d5e6f, 4, 1 / 160, 0.5);
    this.detail = new LayeredNoise(seed ^ 0x708192, 3, 1 / 28, 0.5);
    this.moisture = new LayeredNoise(seed ^ 0xa3b4c5, 3, 1 / 400, 0.5);
    this.ridges = new LayeredNoise(seed ^ 0xc6d7e8, 4, 1 / 220, 0.55);
    this.warp = new LayeredNoise(seed ^ 0xe9fa0b, 2, 1 / 300, 0.5);
  }

  height(x: number, z: number): number {
    // Domain warping: sample the terrain at a position that has itself been
    // pushed around by noise. Plain layered noise gives soft, evenly-spaced
    // blobs that read as "computer hills"; warping the input bends those blobs
    // into the winding, irregular ridges and valleys real land has.
    const wx = x + this.warp.sample(x, z) * 90;
    const wz = z + this.warp.sample(x + 1000, z - 1000) * 90;

    const c = this.continents.sample(wx, wz); // large landmass swells
    const h = this.hills.sample(wx, wz); // rolling hills
    const d = this.detail.sample(x, z); // small bumps

    let y = 6 + c * 26 + h * 7 + d * 1.4;

    // Ridged noise: folding the noise at zero (1 - |n|) turns its smooth peaks
    // into sharp creases, which is what gives mountains actual ridgelines and
    // gullies instead of dome-shaped lumps. Squared to keep the crests thin.
    const ridge = 1 - Math.abs(this.ridges.sample(wx, wz));
    // Only where the land is already rising — ridges in a meadow look wrong.
    const uplift = smoothstep(0.18, 0.62, c);
    y += uplift * ridge * ridge * 52;

    return y;
  }

  moistureAt(x: number, z: number): number {
    return this.moisture.sample(x, z) * 0.5 + 0.5; // [0,1]
  }

  biomeAt(x: number, z: number, y = this.height(x, z)): BiomeDef {
    if (y < SEA_LEVEL + 1.2) return BIOMES.shore;
    if (y > 34) return BIOMES.snow;
    if (y > 22) return BIOMES.mountain;
    return this.moistureAt(x, z) > 0.52 ? BIOMES.forest : BIOMES.meadow;
  }

  /** Approximate surface normal via central differences (for slope checks). */
  slopeAt(x: number, z: number): number {
    const e = 0.75;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return Math.sqrt(dx * dx + dz * dz) / (2 * e); // rise over run
  }

  /** Find a pleasant spawn: meadow, above water, gentle slope, near origin. */
  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r < 40; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const x = Math.cos(ang) * r * 12;
        const z = Math.sin(ang) * r * 12;
        const y = this.height(x, z);
        if (y > SEA_LEVEL + 2 && y < 20 && this.slopeAt(x, z) < 0.35) {
          return { x, y: y + 1.2, z };
        }
      }
    }
    return { x: 0, y: this.height(0, 0) + 2, z: 0 };
  }
}
