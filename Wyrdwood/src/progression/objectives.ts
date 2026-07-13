import { OBJECTIVES, type GameProbe } from '../data/objectives';
import type { Progression } from './progression';

/**
 * Tracks the objective chain. Poll `check` with a fresh probe ~once a second;
 * completions grant XP and advance the chain. Finishing everything = win.
 */
export class ObjectiveManager {
  index = 0;
  won = false;
  /** One-shot completion messages for the HUD. */
  toasts: string[] = [];
  /** Fired once when the final objective completes. */
  onWin: () => void = () => {};

  constructor(private progression: Progression) {}

  get current(): { title: string; hint: string } | null {
    if (this.index >= OBJECTIVES.length) return null;
    return OBJECTIVES[this.index]!;
  }

  check(probe: GameProbe): void {
    if (this.won) return;
    while (this.index < OBJECTIVES.length && OBJECTIVES[this.index]!.done(probe)) {
      const obj = OBJECTIVES[this.index]!;
      this.progression.addXp(obj.xp);
      this.toasts.push(`Objective complete: ${obj.title} (+${obj.xp} XP)`);
      this.index++;
    }
    if (this.index >= OBJECTIVES.length && !this.won) {
      this.won = true;
      this.onWin();
    }
  }
}
