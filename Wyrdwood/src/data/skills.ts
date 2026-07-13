/** Use-based skills (Valheim-style): using an action levels it up. */

export type SkillId = 'woodcutting' | 'mining' | 'foraging' | 'running' | 'combat' | 'building';

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  effect: string;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  woodcutting: {
    id: 'woodcutting',
    name: 'Woodcutting',
    icon: '🪓',
    effect: 'Fewer hits to fell trees',
  },
  mining: { id: 'mining', name: 'Mining', icon: '⛏️', effect: 'Fewer hits to break rocks' },
  foraging: { id: 'foraging', name: 'Foraging', icon: '🫐', effect: 'Bonus food from bushes' },
  running: { id: 'running', name: 'Running', icon: '🏃', effect: 'Cheaper sprinting' },
  combat: { id: 'combat', name: 'Combat', icon: '⚔️', effect: 'More melee damage' },
  building: { id: 'building', name: 'Building', icon: '🔨', effect: 'XP from construction' },
};

/** Skill XP needed to advance from `level` to `level+1`. */
export function skillXpToNext(level: number): number {
  return Math.round(40 * Math.pow(level + 1, 1.25));
}

/** Character XP needed to advance from `level` to `level+1`. */
export function charXpToNext(level: number): number {
  return Math.round(90 * Math.pow(level, 1.45) + 60);
}
