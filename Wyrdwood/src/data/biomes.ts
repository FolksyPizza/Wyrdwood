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
  fernDensity: number;
  /** Ground clutter — the free, tool-less starting materials. */
  stickDensity: number;
  pebbleDensity: number;
  logDensity: number;
}

/**
 * Densities are the probability that a 4 m scatter cell holds that object, and
 * they're cumulative — so the numbers in a row also decide what *doesn't* grow.
 * They were far too low: a forest with a 14% tree cell and nothing else in the
 * understorey is a lawn with poles on it. Real ground is crowded.
 */
export const BIOMES: Record<BiomeId, BiomeDef> = {
  shore:    { id: 'shore',    color: 0xb8a877, treeDensity: 0.004, rockDensity: 0.03, bushDensity: 0.02,  flowerDensity: 0.02, mushroomDensity: 0,    herbDensity: 0.03, fernDensity: 0.01, stickDensity: 0.03, pebbleDensity: 0.09, logDensity: 0.004 },
  meadow:   { id: 'meadow',   color: 0x6a8f3f, treeDensity: 0.035, rockDensity: 0.02, bushDensity: 0.08,  flowerDensity: 0.14, mushroomDensity: 0.02, herbDensity: 0.10, fernDensity: 0.04, stickDensity: 0.05, pebbleDensity: 0.05, logDensity: 0.008 },
  forest:   { id: 'forest',   color: 0x49702f, treeDensity: 0.26,  rockDensity: 0.03, bushDensity: 0.12,  flowerDensity: 0.05, mushroomDensity: 0.08, herbDensity: 0.07, fernDensity: 0.16, stickDensity: 0.10, pebbleDensity: 0.03, logDensity: 0.03 },
  mountain: { id: 'mountain', color: 0x939aa4, treeDensity: 0.03,  rockDensity: 0.14, bushDensity: 0.03,  flowerDensity: 0.02, mushroomDensity: 0.01, herbDensity: 0.03, fernDensity: 0.02, stickDensity: 0.02, pebbleDensity: 0.12, logDensity: 0.004 },
  snow:     { id: 'snow',     color: 0xe4eaf0, treeDensity: 0.006, rockDensity: 0.07, bushDensity: 0,     flowerDensity: 0,    mushroomDensity: 0,    herbDensity: 0,    fernDensity: 0,    stickDensity: 0.01, pebbleDensity: 0.04, logDensity: 0.002 },
};
