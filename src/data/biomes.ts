/** Biome definitions — colors and scatter densities, data-driven. */

export type BiomeId = 'meadow' | 'forest' | 'mountain' | 'snow' | 'shore';

export interface BiomeDef {
  id: BiomeId;
  /** Ground vertex color (hex). */
  color: number;
  /** Trees per chunk-cell probability [0,1] at full density. */
  treeDensity: number;
  rockDensity: number;
  bushDensity: number;
  flowerDensity: number;
  mushroomDensity: number;
  herbDensity: number;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  shore: { id: 'shore', color: 0xb8a877, treeDensity: 0.0, rockDensity: 0.01, bushDensity: 0.005, flowerDensity: 0.01, mushroomDensity: 0, herbDensity: 0.01 },
  meadow: { id: 'meadow', color: 0x6a8f3f, treeDensity: 0.012, rockDensity: 0.012, bushDensity: 0.03, flowerDensity: 0.06, mushroomDensity: 0.01, herbDensity: 0.04 },
  forest: { id: 'forest', color: 0x49702f, treeDensity: 0.14, rockDensity: 0.02, bushDensity: 0.02, flowerDensity: 0.02, mushroomDensity: 0.05, herbDensity: 0.03 },
  mountain: { id: 'mountain', color: 0x8b8578, treeDensity: 0.01, rockDensity: 0.09, bushDensity: 0, flowerDensity: 0.008, mushroomDensity: 0.005, herbDensity: 0.01 },
  snow: { id: 'snow', color: 0xe8ecef, treeDensity: 0.0, rockDensity: 0.05, bushDensity: 0, flowerDensity: 0, mushroomDensity: 0, herbDensity: 0 },
};
