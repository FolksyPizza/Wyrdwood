import * as THREE from 'three';
import { mulberry32 } from '../world/noise';

/**
 * Procedural canvas textures — no asset files. Built once and shared
 * (terrain detail, bark, water normals). All tile seamlessly (RepeatWrapping).
 */

/** Value-noise helper: smooth multi-octave grayscale field in [0,1]. */
function valueNoiseField(size: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const field = new Float32Array(size * size);
  // Sum a few octaves of bilinearly-interpolated white noise on coarse grids.
  for (let oct = 0; oct < 4; oct++) {
    const cells = 4 << oct; // 4, 8, 16, 32
    const amp = 1 / (oct + 1);
    const grid = new Float32Array((cells + 1) * (cells + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy) % cells;
      const fy = gy - Math.floor(gy);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx) % cells;
        const fx = gx - Math.floor(gx);
        const a = grid[y0 * (cells + 1) + x0]!;
        const b = grid[y0 * (cells + 1) + x0 + 1]!;
        const c = grid[(y0 + 1) * (cells + 1) + x0]!;
        const d = grid[(y0 + 1) * (cells + 1) + x0 + 1]!;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const top = a + (b - a) * sx;
        const bot = c + (d - c) * sx;
        field[y * size + x]! += (top + (bot - top) * sy) * amp;
      }
    }
  }
  // Normalize.
  let min = Infinity;
  let max = -Infinity;
  for (const v of field) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const inv = 1 / (max - min || 1);
  for (let i = 0; i < field.length; i++) field[i] = (field[i]! - min) * inv;
  return field;
}

/** Near-neutral grayscale grain that MULTIPLIES vertex colors (keeps biome tint). */
export function makeNoiseAlbedo(size = 256, seed = 1234): THREE.CanvasTexture {
  const field = valueNoiseField(size, seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const g = 200 + field[i]! * 55; // 200–255 → subtle darkening only
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Tangent-space normal map (Sobel of the same field) for micro-relief. */
export function makeNoiseNormal(size = 256, strength = 1.4, seed = 1234): THREE.CanvasTexture {
  const field = valueNoiseField(size, seed);
  const at = (x: number, y: number): number =>
    field[((y + size) % size) * size + ((x + size) % size)]!;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const nz = 1;
      const len = Math.hypot(dx, dy, nz) || 1;
      const i = (y * size + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Shared wind/water clock — ticked once per frame, read by grass/foliage/water shaders. */
export const worldClock = { value: 0 };
