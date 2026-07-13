/**
 * Fixed-timestep game loop.
 *
 * Simulation (physics, gameplay) runs at a fixed rate for determinism —
 * important for future co-op — while rendering runs at display rate with
 * an interpolation alpha for smooth visuals.
 */

export interface LoopCallbacks {
  /** Fixed-rate simulation step. `dt` is always FIXED_DT seconds. */
  update: (dt: number) => void;
  /** Per-frame render. `alpha` = fraction [0,1) into the next fixed step. */
  render: (alpha: number, frameDt: number) => void;
}

export const FIXED_DT = 1 / 60;

/** Cap so a background tab / debugger pause doesn't spiral the simulation. */
const MAX_FRAME_DT = 0.25;
const MAX_STEPS_PER_FRAME = 5;

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  constructor(private callbacks: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(frame);
      const frameDt = Math.min((now - this.lastTime) / 1000, MAX_FRAME_DT);
      this.lastTime = now;
      this.accumulator += frameDt;

      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        this.callbacks.update(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      // If we hit the step cap, drop leftover time instead of accruing debt.
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

      this.callbacks.render(this.accumulator / FIXED_DT, frameDt);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
