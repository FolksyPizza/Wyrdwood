/**
 * Loading screen shown while the world's initial chunks generate. Themed to
 * match the menus, with a progress bar and rotating survival tips.
 */
const TIPS = [
  'Chop trees for wood, mine rocks for stone.',
  'Build a workbench to unlock better crafting.',
  'Stay warm by a campfire when night falls.',
  'Eat and drink to keep hunger and thirst at bay.',
  'Skills improve the more you use them.',
  'Wolves and bears hunt after dark — build walls.',
  'Drop a blueprint to raise a whole hut at once.',
  'Light the Wyrd Beacon to conquer the wilds.',
  'Mark plant patches and camps on your map.',
];

export class LoadingScreen {
  private root = document.createElement('div');
  private bar = document.createElement('i');
  private tip = document.createElement('div');
  private tipTimer = 0;
  private rafId = 0;

  constructor() {
    this.root.innerHTML = `<style>
      .load-screen { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column;
        align-items: center; justify-content: center; font-family: system-ui, sans-serif;
        background: radial-gradient(ellipse at 50% 35%, #16240f 0%, #0e1622 55%, #070a10 100%); }
      .load-title { font-size: 52px; font-weight: 800; letter-spacing: 9px; color: #e8d9b0;
        text-shadow: 0 4px 30px rgba(0,0,0,0.7); margin-bottom: 4px; }
      .load-sub { color: rgba(255,255,255,0.4); letter-spacing: 3px; font-size: 12px;
        text-transform: uppercase; margin-bottom: 40px; }
      .load-track { width: 340px; height: 8px; background: rgba(255,255,255,0.1);
        border-radius: 4px; overflow: hidden; }
      .load-track > i { display: block; height: 100%; width: 0%; border-radius: 4px;
        background: linear-gradient(90deg, #b89b52, #e8c96a); transition: width 0.25s ease; }
      .load-status { color: rgba(255,255,255,0.55); font-size: 13px; margin-top: 14px; }
      .load-tip { color: rgba(232,217,176,0.7); font-size: 13px; margin-top: 34px;
        max-width: 420px; text-align: center; min-height: 2.4em; transition: opacity 0.4s; }
      .load-tip b { color: #e8c96a; }
    </style>`;
    const screen = document.createElement('div');
    screen.className = 'load-screen';
    const track = document.createElement('div');
    track.className = 'load-track';
    this.bar.className = '';
    track.appendChild(this.bar);
    this.tip.className = 'load-tip';
    const status = document.createElement('div');
    status.className = 'load-status';
    status.textContent = 'Shaping the land…';
    screen.innerHTML = `
      <div class="load-title">WYRDWOOD</div>
      <div class="load-sub">entering the wilds</div>`;
    screen.append(track, status, this.tip);
    this.root.appendChild(screen);
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
    this.status = status;
  }

  private status!: HTMLDivElement;

  show(): void {
    this.root.style.display = 'block';
    this.setTip();
    let last = performance.now();
    const tick = (now: number): void => {
      this.rafId = requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      this.tipTimer -= dt;
      if (this.tipTimer <= 0) this.setTip();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** progress 0–1. */
  setProgress(p: number): void {
    this.bar.style.width = `${Math.round(Math.min(1, p) * 100)}%`;
    if (p >= 1) this.status.textContent = 'Ready.';
    else if (p > 0.5) this.status.textContent = 'Growing forests…';
    else this.status.textContent = 'Shaping the land…';
  }

  private setTip(): void {
    this.tipTimer = 3.5;
    const t = TIPS[Math.floor((performance.now() / 3500) % TIPS.length)]!;
    this.tip.style.opacity = '0';
    setTimeout(() => {
      this.tip.innerHTML = `<b>Tip:</b> ${t}`;
      this.tip.style.opacity = '1';
    }, 200);
  }

  hide(): void {
    cancelAnimationFrame(this.rafId);
    this.root.style.opacity = '0';
    this.root.style.transition = 'opacity 0.5s';
    setTimeout(() => {
      this.root.style.display = 'none';
      this.root.style.opacity = '1';
    }, 500);
  }
}
