import { keyFor, type Action } from '../data/settings';
/**
 * Keyboard + pointer-lock mouse input. Systems read state; this class owns
 * event wiring. Mouse deltas accumulate between reads (consume per frame).
 */
export class Input {
  private keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheelDelta = 0;
  private rightClickQueued = false;
  pointerLocked = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('click', () => {
      if (!this.pointerLocked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) this.buttons.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Scroll wheel: camera zoom. Accumulated and consumed per frame like the
    // mouse delta, so a fast flick isn't lost between frames.
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // Browsers report wheel deltas in wildly different units (pixels, lines,
        // pages) depending on device and OS, so normalise to a signed notch
        // count rather than trusting the magnitude.
        this.wheelDelta += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      this.buttons.add(e.button);
      if (e.button === 2) this.rightClickQueued = true;
      if (e.button === 0) this.leftClickQueued = true;
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    window.addEventListener('blur', () => this.buttons.clear());
  }

  private leftClickQueued = false;
  private buttons = new Set<number>();

  /** Is a mouse button currently held? (0=L, 1=Middle, 2=R) */
  mouseHeld(button: number): boolean {
    return this.buttons.has(button);
  }

  /** One-shot right-click (place action). */
  consumeRightClick(): boolean {
    const v = this.rightClickQueued;
    this.rightClickQueued = false;
    return v;
  }

  /** One-shot left-click (build placement / attack). */
  consumeLeftClick(): boolean {
    const v = this.leftClickQueued;
    this.leftClickQueued = false;
    return v;
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /**
   * Is a rebindable *action* held? Systems should ask for the action ("forward"),
   * not the key ("KeyW") — that indirection is the whole keybinding feature, and
   * hard-coding a key anywhere silently makes it unrebindable.
   */
  action(a: Action): boolean {
    return this.keys.has(keyFor(a));
  }

  /** Read & reset accumulated wheel notches (positive = scrolled down/away). */
  consumeWheel(): number {
    const v = this.wheelDelta;
    this.wheelDelta = 0;
    return v;
  }

  /** Read & reset accumulated mouse movement. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }
}
