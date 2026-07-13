import type { BiomeId } from './biomes';

/** Mob definitions — data-driven. */

export interface MobDef {
  id: string;
  name: string;
  hostile: boolean;
  /** Neutral animals: passive until attacked, then they fight back. */
  retaliates?: boolean;
  hp: number;
  damage: number;
  speed: number;
  fleeSpeed: number;
  /** Aggro / flee trigger radius (m). */
  senseRadius: number;
  attackRange: number;
  attackCooldown: number;
  drops: { itemId: string; count: number }[];
  biomes: BiomeId[];
  /** Hostiles only: spawn multiplier at night. */
  nightBoost?: number;
  /** Visual: body color + rough size. */
  color: number;
  size: number;
}

export const MOBS: Record<string, MobDef> = {
  deer: {
    id: 'deer',
    name: 'Deer',
    hostile: false,
    hp: 20,
    damage: 0,
    speed: 3.2,
    fleeSpeed: 7.5,
    senseRadius: 11,
    attackRange: 0,
    attackCooldown: 0,
    drops: [{ itemId: 'meat', count: 2 }],
    biomes: ['meadow', 'forest'],
    color: 0x9a6b47,
    size: 1.0,
  },
  bull: {
    id: 'bull',
    name: 'Bull',
    hostile: false,
    retaliates: true,
    hp: 55,
    damage: 12,
    speed: 3.0,
    fleeSpeed: 5.0,
    senseRadius: 10,
    attackRange: 1.9,
    attackCooldown: 1.6,
    drops: [
      { itemId: 'meat', count: 3 },
      { itemId: 'hide', count: 2 },
    ],
    biomes: ['meadow', 'forest'],
    color: 0x4a3a2c,
    size: 1.25,
  },
  alpaca: {
    id: 'alpaca',
    name: 'Alpaca',
    hostile: false,
    hp: 26,
    damage: 0,
    speed: 3.0,
    fleeSpeed: 6.0,
    senseRadius: 11,
    attackRange: 0,
    attackCooldown: 0,
    drops: [
      { itemId: 'meat', count: 1 },
      { itemId: 'hide', count: 2 },
    ],
    biomes: ['meadow', 'mountain'],
    color: 0xd6c6a8,
    size: 1.0,
  },
  fox: {
    id: 'fox',
    name: 'Fox',
    hostile: false,
    retaliates: true,
    hp: 22,
    damage: 7,
    speed: 5.0,
    fleeSpeed: 7.0,
    senseRadius: 12,
    attackRange: 1.4,
    attackCooldown: 1.3,
    drops: [
      { itemId: 'meat', count: 1 },
      { itemId: 'hide', count: 1 },
    ],
    biomes: ['forest', 'meadow'],
    color: 0xb5651d,
    size: 0.6,
  },
  cow: {
    id: 'cow',
    name: 'Cow',
    hostile: false,
    hp: 40,
    damage: 0,
    speed: 2.2,
    fleeSpeed: 4.5,
    senseRadius: 8,
    attackRange: 0,
    attackCooldown: 0,
    drops: [
      { itemId: 'meat', count: 3 },
      { itemId: 'hide', count: 2 },
    ],
    biomes: ['meadow'],
    color: 0xd8cbb8,
    size: 1.15,
  },
  horse: {
    id: 'horse',
    name: 'Wild Horse',
    hostile: false,
    hp: 45,
    damage: 0,
    speed: 5.5,
    fleeSpeed: 10.0,
    senseRadius: 14,
    attackRange: 0,
    attackCooldown: 0,
    drops: [
      { itemId: 'meat', count: 2 },
      { itemId: 'hide', count: 2 },
    ],
    biomes: ['meadow'],
    color: 0x6b4a33,
    size: 1.35,
  },
  stag: {
    id: 'stag',
    name: 'Stag',
    hostile: false,
    retaliates: true,
    hp: 40,
    damage: 10,
    speed: 4.0,
    fleeSpeed: 8.5,
    senseRadius: 13,
    attackRange: 1.8,
    attackCooldown: 1.5,
    drops: [
      { itemId: 'meat', count: 3 },
      { itemId: 'hide', count: 2 },
    ],
    biomes: ['forest', 'mountain'],
    color: 0x7d5636,
    size: 1.2,
  },
  wolf: {
    id: 'wolf',
    name: 'Wolf',
    hostile: true,
    hp: 45,
    damage: 14,
    speed: 6.5,
    fleeSpeed: 6.5,
    senseRadius: 18,
    attackRange: 1.8,
    attackCooldown: 1.2,
    drops: [
      { itemId: 'meat', count: 2 },
      { itemId: 'hide', count: 2 },
    ],
    biomes: ['forest', 'mountain', 'snow'],
    nightBoost: 2.0,
    color: 0x8c8c94,
    size: 1.0,
  },
};
