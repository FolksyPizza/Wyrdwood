/**
 * Top-left overlay. Two distinct things that used to be one blob of green
 * monospace text on a black box — which read as a debug console someone forgot
 * to remove, not as part of a game:
 *
 *  - A **status card** the player is meant to see: a clock face showing the time
 *    of day, the biome they're standing in, and their coordinates.
 *  - A **dev readout** (FPS / frame time), hidden behind F3, where it belongs.
 */
export class DebugOverlay {
  private card: HTMLDivElement;
  private clockHand: SVGLineElement;
  private clockFace: SVGCircleElement;
  private timeText: HTMLSpanElement;
  private biomeText: HTMLSpanElement;
  private coordText: HTMLSpanElement;
  private hint: HTMLDivElement;

  private perf: HTMLDivElement;
  private frames = 0;
  private accum = 0;
  private perfVisible = false;

  /** Live state, set by the game each frame. */
  timeOfDay = 8; // hours, 0–24
  biome = '';
  pos = { x: 0, y: 0, z: 0 };
  /** Shown until the player clicks in (pointer lock). */
  showHint = true;

  /** Last measured frames per second. */
  fps = 0;

  constructor() {
    const style = document.createElement('style');
    style.textContent = `
      #wyrd-status { position: fixed; top: 14px; left: 14px; z-index: 1000;
        pointer-events: none; display: flex; align-items: center; gap: 11px;
        padding: 9px 16px 9px 10px;
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
        color: #efe2c8;
        background: linear-gradient(160deg, rgba(38,30,22,0.82), rgba(18,15,12,0.86));
        border: 1px solid rgba(0,0,0,0.6); border-radius: 10px;
        box-shadow: inset 0 1px 0 rgba(220,190,140,0.14), 0 6px 22px rgba(0,0,0,0.45); }

      /* A real clock face — the time of day matters in a survival game (night is
         dangerous), so it gets a dial rather than a number buried in a log line. */
      #wyrd-status .dial { width: 38px; height: 38px; flex: 0 0 38px; border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #4b453c, #1d1a16 72%);
        box-shadow: inset 0 1px 0 rgba(226,199,150,0.3), inset 0 -3px 5px rgba(0,0,0,0.7),
                    0 1px 3px rgba(0,0,0,0.6);
        border: 1px solid rgba(0,0,0,0.75); display: grid; place-items: center; }
      #wyrd-status .dial svg { width: 30px; height: 30px; overflow: visible; }

      #wyrd-status .meta { display: flex; flex-direction: column; gap: 1px; line-height: 1.35; }
      #wyrd-status .top { display: flex; align-items: baseline; gap: 8px; }
      #wyrd-status .time { font-size: 15px; letter-spacing: 0.5px; color: #f4e7cd; }
      #wyrd-status .biome { font-size: 10px; letter-spacing: 1.6px; text-transform: uppercase;
        color: #c9a45f; }
      #wyrd-status .coord { font-size: 10px; font-family: ui-monospace, monospace;
        color: rgba(239,226,200,0.42); letter-spacing: 0.4px; }

      #wyrd-hint { position: fixed; top: 66px; left: 14px; z-index: 1000; pointer-events: none;
        max-width: 300px; padding: 8px 12px; border-radius: 8px;
        font-family: "Iowan Old Style", Georgia, serif; font-size: 12px; line-height: 1.65;
        color: rgba(240,228,204,0.75);
        background: linear-gradient(160deg, rgba(38,30,22,0.7), rgba(18,15,12,0.78));
        border: 1px solid rgba(0,0,0,0.5);
        box-shadow: inset 0 1px 0 rgba(220,190,140,0.1); }
      #wyrd-hint b { color: #e8c96a; font-weight: 700; }

      #wyrd-perf { position: fixed; top: 14px; right: 14px; z-index: 1000; pointer-events: none;
        display: none; padding: 5px 9px; border-radius: 6px;
        font: 11px/1.5 ui-monospace, Menlo, monospace; color: #9fe08f;
        background: rgba(0,0,0,0.6); white-space: pre; }
    `;
    document.head.appendChild(style);

    this.card = document.createElement('div');
    this.card.id = 'wyrd-status';
    this.card.innerHTML = `
      <div class="dial">
        <svg viewBox="-15 -15 30 30">
          <circle class="face" r="13" fill="none" stroke="rgba(226,199,150,0.22)" stroke-width="1.2"/>
          <line class="hand" x1="0" y1="0" x2="0" y2="-9.5"
                stroke="#e8c96a" stroke-width="1.8" stroke-linecap="round"/>
          <circle r="1.6" fill="#e8c96a"/>
        </svg>
      </div>
      <div class="meta">
        <div class="top">
          <span class="time">—</span>
          <span class="biome">—</span>
        </div>
        <span class="coord">—</span>
      </div>`;
    document.body.appendChild(this.card);

    this.clockHand = this.card.querySelector('.hand')!;
    this.clockFace = this.card.querySelector('.face')!;
    this.timeText = this.card.querySelector('.time')!;
    this.biomeText = this.card.querySelector('.biome')!;
    this.coordText = this.card.querySelector('.coord')!;

    this.hint = document.createElement('div');
    this.hint.id = 'wyrd-hint';
    this.hint.innerHTML = `<b>Click to play.</b><br>
      <b>WASD</b> move · <b>Shift</b> run · <b>Space</b> jump<br>
      <b>E</b> interact · <b>LMB</b> attack · <b>F</b> eat<br>
      <b>Tab</b> inventory · <b>C</b> craft · <b>B</b> build · <b>M</b> map`;
    document.body.appendChild(this.hint);

    this.perf = document.createElement('div');
    this.perf.id = 'wyrd-perf';
    document.body.appendChild(this.perf);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.perfVisible = !this.perfVisible;
        this.perf.style.display = this.perfVisible ? 'block' : 'none';
      }
    });
  }

  /** Call once per rendered frame. */
  tick(frameDt: number): void {
    // Clock: one full sweep per in-game day, so the hand's angle *is* the time.
    const angle = (this.timeOfDay / 24) * 360;
    this.clockHand.setAttribute('transform', `rotate(${angle})`);
    // The dial darkens at night — a glanceable "it's getting late".
    const night = this.timeOfDay < 6 || this.timeOfDay > 19;
    this.clockFace.setAttribute(
      'stroke',
      night ? 'rgba(120,150,220,0.35)' : 'rgba(226,199,150,0.22)',
    );

    const h = Math.floor(this.timeOfDay);
    const m = Math.floor((this.timeOfDay - h) * 60);
    this.timeText.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.biomeText.textContent = this.biome;
    this.coordText.textContent = `${this.pos.x.toFixed(0)}, ${this.pos.z.toFixed(0)}`;
    this.hint.style.display = this.showHint ? 'block' : 'none';

    this.frames++;
    this.accum += frameDt;
    if (this.accum >= 0.5) {
      this.fps = this.frames / this.accum;
      const ms = (this.accum / this.frames) * 1000;
      this.perf.textContent = `${this.fps.toFixed(0)} fps   ${ms.toFixed(1)} ms`;
      this.frames = 0;
      this.accum = 0;
    }
  }
}
