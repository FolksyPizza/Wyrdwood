import { SKILLS, skillXpToNext, charXpToNext, type SkillId } from '../data/skills';
import type { PlayerStats } from '../player/stats';

export interface SkillState {
  level: number;
  xp: number;
}

/**
 * Character progression: overall level/XP plus use-based skills.
 * Leveling up auto-grants perks (max health/stamina); skills improve the
 * actions that train them. Serialized in M8.
 */
export class Progression {
  level = 1;
  xp = 0;
  readonly skills: Record<SkillId, SkillState> = Object.fromEntries(
    Object.keys(SKILLS).map((id) => [id, { level: 0, xp: 0 }]),
  ) as Record<SkillId, SkillState>;

  /** One-shot notifications for the HUD ("Level up!", "Woodcutting 5"). */
  toasts: string[] = [];

  constructor(private stats: PlayerStats) {}

  addXp(amount: number): void {
    this.xp += amount;
    while (this.xp >= charXpToNext(this.level)) {
      this.xp -= charXpToNext(this.level);
      this.level++;
      // Auto-perk: sturdier every level.
      this.stats.maxHealth += 5;
      this.stats.maxStamina += 4;
      this.stats.health = this.stats.maxHealth; // level-up heals
      this.stats.stamina = this.stats.maxStamina;
      this.toasts.push(`Level up! Now level ${this.level} (+5 HP, +4 stamina)`);
    }
  }

  addSkillXp(id: SkillId, amount: number): void {
    const s = this.skills[id];
    s.xp += amount;
    while (s.xp >= skillXpToNext(s.level) && s.level < 100) {
      s.xp -= skillXpToNext(s.level);
      s.level++;
      if (s.level % 5 === 0) this.toasts.push(`${SKILLS[id].name} reached ${s.level}`);
      this.addXp(6); // skill-ups feed character XP
    }
  }

  /** Harvest hit reduction from woodcutting/mining/foraging (min 1 hit). */
  harvestHitReduction(id: SkillId): number {
    return Math.floor(this.skills[id].level / 20);
  }

  /** Bonus drops at higher gathering skill. */
  bonusDrops(id: SkillId): number {
    return this.skills[id].level >= 40 ? 1 : 0;
  }

  /** Melee damage multiplier from combat skill. */
  get damageMultiplier(): number {
    return 1 + this.skills.combat.level * 0.012;
  }

  /** Sprint stamina drain multiplier from running skill. */
  get sprintCostMultiplier(): number {
    return Math.max(0.5, 1 - this.skills.running.level * 0.005);
  }
}
