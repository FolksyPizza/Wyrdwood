/**
 * Difficulty presets + world modifiers. One config object, read by every
 * system (stats decay, spawning, combat, map, building). Chosen at world
 * creation (M7 menus) and editable in settings; saved with the world (M8).
 */

export type DifficultyPreset = 'peaceful' | 'normal' | 'hard' | 'survival' | 'custom';
export type DeathPenalty = 'none' | 'drop' | 'hardcore';

export interface WorldModifiers {
  preset: DifficultyPreset;
  /** PvE/combat dial — independent from survival difficulty. */
  combat: {
    /** 0 disables hostile spawns entirely. */
    enemyDensity: number;
    enemyDamage: number;
    enemyAggression: number; // aggro radius multiplier
  };
  /** Survival decay-rate multipliers. */
  survival: {
    hungerRate: number;
    thirstRate: number;
    warmthRate: number;
    staminaCost: number;
  };
  /** Feature toggles (custom worlds). */
  toggles: {
    map: boolean;
    minimap: boolean;
    hunger: boolean;
    thirst: boolean;
    warmth: boolean;
    freeBuild: boolean;
  };
  world: {
    passiveDensity: number;
    resourceAbundance: number;
    /** Real minutes per in-game day. */
    dayLengthMin: number;
  };
  deathPenalty: DeathPenalty;
}

const BASE: WorldModifiers = {
  preset: 'normal',
  combat: { enemyDensity: 1, enemyDamage: 1, enemyAggression: 1 },
  survival: { hungerRate: 1, thirstRate: 1, warmthRate: 1, staminaCost: 1 },
  toggles: { map: true, minimap: true, hunger: true, thirst: true, warmth: true, freeBuild: false },
  world: { passiveDensity: 1, resourceAbundance: 1, dayLengthMin: 30 },
  deathPenalty: 'none',
};

export const PRESETS: Record<Exclude<DifficultyPreset, 'custom'>, WorldModifiers> = {
  peaceful: {
    ...structuredClone(BASE),
    preset: 'peaceful',
    combat: { enemyDensity: 0, enemyDamage: 0, enemyAggression: 0 },
    survival: { hungerRate: 0.5, thirstRate: 0.5, warmthRate: 0.5, staminaCost: 0.6 },
  },
  normal: { ...structuredClone(BASE), preset: 'normal' },
  hard: {
    ...structuredClone(BASE),
    preset: 'hard',
    combat: { enemyDensity: 1.5, enemyDamage: 1.6, enemyAggression: 1.4 },
    survival: { hungerRate: 1.4, thirstRate: 1.4, warmthRate: 1.3, staminaCost: 1.2 },
    deathPenalty: 'drop',
  },
  survival: {
    ...structuredClone(BASE),
    preset: 'survival',
    combat: { enemyDensity: 2, enemyDamage: 2.2, enemyAggression: 1.8 },
    survival: { hungerRate: 1.8, thirstRate: 1.9, warmthRate: 1.6, staminaCost: 1.35 },
    deathPenalty: 'drop',
  },
};

/** The live config for the current world (mutable; M7 menus edit it). */
export const worldConfig: WorldModifiers = structuredClone(PRESETS.normal);

export function applyPreset(preset: Exclude<DifficultyPreset, 'custom'>): void {
  Object.assign(worldConfig, structuredClone(PRESETS[preset]));
}
