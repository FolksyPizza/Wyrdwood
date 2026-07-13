import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';

/** Deterministic 32-bit PRNG (mulberry32). Same seed → same world. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string (e.g. world name) to a numeric seed. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Cheap deterministic per-cell hash → [0,1). Used for object scatter. */
export function cellHash(seed: number, x: number, y: number, salt = 0): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Layered (fBm) 2D simplex noise in [-1, 1]. */
export class LayeredNoise {
  private noise: NoiseFunction2D;

  constructor(
    seed: number,
    private octaves: number,
    private frequency: number,
    private persistence = 0.5,
    private lacunarity = 2.0,
  ) {
    this.noise = createNoise2D(mulberry32(seed));
  }

  sample(x: number, y: number): number {
    let amp = 1;
    let freq = this.frequency;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < this.octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= this.persistence;
      freq *= this.lacunarity;
    }
    return sum / norm;
  }
}
