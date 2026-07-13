import { worldConfig } from '../data/difficulty';

/**
 * Player needs: health, stamina, hunger, thirst, warmth. All 0–100.
 * Decay rates are per-second, scaled by the world difficulty modifiers.
 */

export interface NeedsContext {
  running: boolean;
  moving: boolean;
  isNight: boolean;
  altitude: number;
  /** Near a lit fire — overrides cold. */
  nearFire?: boolean;
}

export class PlayerStats {
  maxHealth = 100;
  maxStamina = 100;
  health = 100;
  stamina = 100;
  hunger = 100; // 100 = full
  thirst = 100; // 100 = hydrated
  warmth = 100; // 100 = warm

  /** Sprint cost multiplier (lowered by the Running skill). */
  sprintCostMult = 1;

  dead = false;

  update(dt: number, ctx: NeedsContext): void {
    if (this.dead) return;

    // --- Stamina (drains slower, recovers faster so it isn't a nuisance) ---
    if (ctx.running) {
      this.stamina -= 6.5 * this.sprintCostMult * worldConfig.survival.staminaCost * dt;
    } else {
      const regen = this.hunger > 20 && this.thirst > 20 ? 22 : 10;
      this.stamina += regen * dt;
    }
    this.stamina = clamp(this.stamina, this.maxStamina);

    // --- Hunger / thirst decay (difficulty-scaled; toggleable off) ---
    // Standing still costs little; walking a normal amount; sprinting/working
    // burns fast — so idle players don't starve while planning or building.
    const cfg = worldConfig;
    const activity = ctx.running ? 1.9 : ctx.moving ? 1.0 : 0.4;
    // Low base rates: a full meter lasts ~20+ min of walking, far longer idle.
    if (cfg.toggles.hunger) {
      this.hunger = clamp(this.hunger - 0.075 * activity * cfg.survival.hungerRate * dt);
    } else this.hunger = 100;
    if (cfg.toggles.thirst) {
      this.thirst = clamp(this.thirst - 0.1 * activity * cfg.survival.thirstRate * dt);
    } else this.thirst = 100;

    // --- Warmth: cold at night and at altitude; fire always warms ---
    if (cfg.toggles.warmth) {
      const cold = (ctx.isNight ? 6 : 0) + Math.max(0, ctx.altitude - 22) * 0.35;
      const delta = ctx.nearFire
        ? 14
        : cold > 4
          ? -cold * 0.35 * cfg.survival.warmthRate
          : 8; // warm / freeze / recover
      this.warmth = clamp(this.warmth + delta * dt);
    } else this.warmth = 100;

    // --- Starvation / dehydration / freezing hurt ---
    let drain = 0;
    if (this.hunger <= 0) drain += 1.2;
    if (this.thirst <= 0) drain += 1.8;
    if (this.warmth <= 0) drain += 1.5;
    if (drain > 0) this.health = clamp(this.health - drain * dt, this.maxHealth);
    // Gentle regen when well-fed and hydrated.
    else if (this.hunger > 60 && this.thirst > 60)
      this.health = clamp(this.health + 0.8 * dt, this.maxHealth);

    if (this.health <= 0) this.dead = true;
  }

  /** Spend stamina on an action (jump, swing). False if too tired. */
  spend(amount: number): boolean {
    const cost = amount * worldConfig.survival.staminaCost;
    if (this.stamina < cost) return false;
    this.stamina -= cost;
    return true;
  }

  /** Take external damage (mob attacks). */
  hurt(amount: number): void {
    if (this.dead) return;
    this.health = clamp(this.health - amount, this.maxHealth);
    if (this.health <= 0) this.dead = true;
  }

  eat(food: { hunger?: number; thirst?: number; health?: number }): void {
    this.hunger = clamp(this.hunger + (food.hunger ?? 0));
    this.thirst = clamp(this.thirst + (food.thirst ?? 0));
    this.health = clamp(this.health + (food.health ?? 0), this.maxHealth);
  }

  drink(amount = 30): void {
    this.thirst = clamp(this.thirst + amount);
  }

  respawn(): void {
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.hunger = 75;
    this.thirst = 75;
    this.warmth = 100;
    this.dead = false;
  }

  get canRun(): boolean {
    return this.stamina > 1;
  }
}

function clamp(v: number, max = 100): number {
  return Math.min(max, Math.max(0, v));
}
