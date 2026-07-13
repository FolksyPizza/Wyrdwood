/**
 * Character appearance config — drives the procedural humanoid model.
 * The character creator (M7) edits one of these; presets ship as defaults.
 */

/** Which rigged body the player wears (see render/models.ts). */
export type Outfit = 'adventurer' | 'farmer' | 'worker';
export const OUTFITS: Outfit[] = ['adventurer', 'farmer', 'worker'];

export interface Appearance {
  skinTone: number;
  hairColor: number;
  hairStyle: 'short' | 'long' | 'none';
  shirtColor: number;
  pantsColor: number;
  bootsColor: number;
  /** 1 = average build; small range keeps proportions sane. */
  build: number;
  outfit: Outfit;
}

export const SKIN_TONES = [0xf2d3b3, 0xe0ac82, 0xc68d5e, 0x9c6b43, 0x6f4a2f, 0x4a3121];
export const HAIR_COLORS = [0x2b2118, 0x4a341f, 0x7a5230, 0xb08d57, 0xd8c08a, 0x8a8a8a, 0xb5451d];
export const CLOTH_COLORS = [0x5b6d8a, 0x7a4b3a, 0x4f6b45, 0x6b5b7a, 0x8a7a4b, 0x555a5e];

export const DEFAULT_APPEARANCE: Appearance = {
  skinTone: SKIN_TONES[1]!,
  hairColor: HAIR_COLORS[1]!,
  hairStyle: 'short',
  shirtColor: CLOTH_COLORS[0]!,
  pantsColor: 0x4a4238,
  bootsColor: 0x33291e,
  build: 1,
  outfit: 'adventurer',
};
