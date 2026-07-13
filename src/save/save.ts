import type { ItemStack } from '../items/inventory';
import type { Appearance } from '../data/appearance';
import type { WorldModifiers } from '../data/difficulty';
import type { PlacedPiece } from '../data/pieces';
import type { SkillId } from '../data/skills';
import type { SkillState } from '../progression/progression';

/**
 * Save format v1 — one JSON blob in localStorage. Everything the world needs
 * to resume: seed + modifiers rebuild the terrain deterministically; the rest
 * is player/world deltas. (Works identically in the browser and Electron.)
 */
export interface SaveData {
  version: 1;
  savedAt: number;
  seedText: string;
  worldConfig: WorldModifiers;
  appearance: Appearance;
  dayTime: number;
  player: {
    x: number;
    y: number;
    z: number;
    health: number;
    stamina: number;
    hunger: number;
    thirst: number;
    warmth: number;
    maxHealth: number;
    maxStamina: number;
  };
  inventory: (ItemStack | null)[];
  progression: {
    level: number;
    xp: number;
    skills: Record<SkillId, SkillState>;
  };
  objectives: {
    index: number;
    won: boolean;
    kills: number;
    craftedIds: string[];
    survivedNight: boolean;
  };
  placed: { kind: string; x: number; y: number; z: number; yaw: number; lit?: boolean }[];
  graves: { x: number; y: number; z: number; items: (ItemStack | null)[] }[];
  buildingPieces: PlacedPiece[];
  removedInstances: string[];
  /** Partial-harvest progress [instanceKey, remainingHp]. */
  damagedInstances: [string, number][];
  discovered: string[];
  markers: { x: number; z: number; icon: string; name?: string; custom?: boolean }[];
}

const KEY = 'wyrdwood-save-v1';

export function hasSave(): boolean {
  return localStorage.getItem(KEY) !== null;
}

export function loadSave(): SaveData | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Save failed (storage full?):', err);
  }
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}
