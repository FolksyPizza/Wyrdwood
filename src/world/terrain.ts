import { LayeredNoise, mulberry32 } from './noise';
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
  private ridgeA: LayeredNoise;
  private ridgeB: LayeredNoise;
  private valleys: LayeredNoise;
  private warp: LayeredNoise;
  private strataMask: LayeredNoise;
  private rugged: LayeredNoise;

  // ── Per-world character, derived from the seed ────────────────────────────
  //
  // Re-seeding the same noise functions gives the same *kind* of world with its
  // shapes moved around. Real regions differ in kind: one is rolling downland,
  // the next is a jagged massif cut by gorges. So the seed also decides how tall
  // the mountains get, how much of the map is mountainous at all, how deep the
  // valleys cut, and how thick the rock strata are.
  private readonly mountainAmp: number;
  private readonly upliftLo: number;
  private readonly upliftHi: number;
  private readonly valleyDepth: number;
  private readonly strataStart: number;
  private readonly strataStep: number;
  private readonly craggy: number;

  constructor(readonly seed: number) {
    const rng = mulberry32(seed ^ 0x5eed);
    this.mountainAmp = 45 + rng() * 45; // 45–90 m of relief on top of the swell
    this.upliftLo = 0.1 + rng() * 0.14; // how much of the world is upland
    this.upliftHi = this.upliftLo + 0.35 + rng() * 0.2;
    this.valleyDepth = 8 + rng() * 12;
    this.strataStart = 14 + rng() * 14;
    this.strataStep = 3.5 + rng() * 4;
    this.craggy = 0.5 + rng() * 0.8; // how broken the ridgelines are

    this.continents = new LayeredNoise(seed ^ 0x1a2b3c, 3, 1 / 900, 0.55);
    this.hills = new LayeredNoise(seed ^ 0x4d5e6f, 4, 1 / 160, 0.5);
    this.detail = new LayeredNoise(seed ^ 0x708192, 3, 1 / 26, 0.5);
    this.moisture = new LayeredNoise(seed ^ 0xa3b4c5, 3, 1 / 400, 0.5);
    // Two ridged layers at different scales: the big one lays down the mountain
    // range's spine, the small one breaks it into individual crags.
    this.ridgeA = new LayeredNoise(seed ^ 0xc6d7e8, 3, 1 / 260, 0.5);
    this.ridgeB = new LayeredNoise(seed ^ 0x2f3e4d, 3, 1 / 85, 0.5);
    this.valleys = new LayeredNoise(seed ^ 0x91a2b3, 2, 1 / 420, 0.5);
    this.warp = new LayeredNoise(seed ^ 0xe9fa0b, 2, 1 / 300, 0.5);
    this.strataMask = new LayeredNoise(seed ^ 0x7c8d9e, 2, 1 / 180, 0.5);
    // High-frequency break-up, used only on rock — see height().
    this.rugged = new LayeredNoise(seed ^ 0x3b4c5d, 3, 1 / 13, 0.55);
  }

  /**
   * Height field.
   *
   * The old one was soft rolling noise, which is why the landscape read as a
   * green duvet: real ground is *broken*. Four things fix that, and they compose:
   *
   *  1. **Domain warping** — sample the noise at a position that has itself been
   *     pushed around by noise. Straight fBm gives evenly-spaced blobs; warping
   *     bends them into the winding, irregular forms real land has.
   *  2. **Ridged noise** — folding the noise at zero (`1 - |n|`) turns its smooth
   *     peaks into sharp creases. That's what gives a mountain an actual ridgeline
   *     and gullies running off it instead of being a dome. Two scales: one for
   *     the range's spine, one to break it into crags.
   *  3. **Valley carving** — `|n|` is V-shaped with its minimum along a winding
   *     line, so subtracting it cuts drainage valleys through the uplands. Water
   *     is what actually shapes a landscape, and this is the cheap stand-in.
   *  4. **Strata terracing** — quantising the height into bands above a certain
   *     altitude produces ledges and cliff faces, the way sedimentary rock erodes.
   *     This is what finally gives the terrain *silhouette* — somewhere for the
   *     shadows to catch — instead of a smooth gradient.
   */
  height(x: number, z: number): number {
    const wx = x + this.warp.sample(x, z) * 120;
    const wz = z + this.warp.sample(x + 1000, z - 1000) * 120;

    const c = this.continents.sample(wx, wz); // large landmass swells
    const h = this.hills.sample(wx, wz); // rolling hills
    const d = this.detail.sample(x, z); // small bumps

    let y = 4 + c * 28 + h * 8;

    // ── Mountains ────────────────────────────────────────────────────────────
    const uplift = smoothstep(this.upliftLo, this.upliftHi, c);
    if (uplift > 0.001) {
      const rA = 1 - Math.abs(this.ridgeA.sample(wx, wz));
      const rB = 1 - Math.abs(this.ridgeB.sample(wx, wz));
      // Multiplying the two ridged fields (rather than adding) means the small
      // crags only appear *on* the big spine — which is how mountains build up.
      // The exponent sets how sharp the crest is: squaring it (the first attempt)
      // gave needle spires, because it drove everything off-crest to zero. 1.5
      // leaves a ridge that still has shoulders.
      const ridge = Math.pow(rA, 1.5) * (1 - this.craggy * 0.35 * (1 - rB));
      y += uplift * ridge * this.mountainAmp;
    }

    // ── Valleys ──────────────────────────────────────────────────────────────
    // Deepest along the zero-crossing of the noise, so they run as long winding
    // channels rather than as pits.
    const channel = 1 - smoothstep(0, 0.2, Math.abs(this.valleys.sample(wx, wz)));
    y -= channel * this.valleyDepth * smoothstep(-0.1, 0.4, c);

    // ── Strata ───────────────────────────────────────────────────────────────
    // Only on high ground, and only where the mask says the rock is exposed —
    // terracing a meadow would look like a wedding cake.
    const exposed =
      smoothstep(this.strataStart, this.strataStart + 16, y) *
      smoothstep(0.1, 0.6, this.strataMask.sample(x, z) * 0.5 + 0.5);
    if (exposed > 0.001) {
      const band = y / this.strataStep;
      const floorBand = Math.floor(band);
      const frac = band - floorBand;
      // A soft step per band: flat tread, then a fast riser. Pure Math.floor
      // would give vertical walls the character controller cannot climb at all.
      const stepped = (floorBand + smoothstep(0.6, 1.0, frac)) * this.strataStep;
      y += (stepped - y) * exposed * 0.6;
    }

    // Rock is *rough*. Smooth stone reads as clay however good the texture is, so
    // the upland gets a high-frequency break-up the lowland doesn't — that's what
    // gives a cliff its broken, faceted surface and somewhere for the ambient
    // occlusion to bite.
    y += uplift * this.rugged.sample(x, z) * 2.6;

    return y + d * 1.6;
  }

  moistureAt(x: number, z: number): number {
    return this.moisture.sample(x, z) * 0.5 + 0.5; // [0,1]
  }

  biomeAt(x: number, z: number, y = this.height(x, z)): BiomeDef {
    if (y < SEA_LEVEL + 1.2) return BIOMES.shore;
    // Peaks reach ~100 m now rather than ~60, so the bands moved up with them.
    if (y > 68) return BIOMES.snow;
    if (y > 34) return BIOMES.mountain;
    // A steep face is bare rock at any altitude — that is what makes a cliff
    // read as a cliff rather than as a very tilted lawn.
    if (this.slopeAt(x, z) > 0.85) return BIOMES.mountain;
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
