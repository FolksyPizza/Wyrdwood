/**
 * Animated atmospheric backdrop for the menus: gradient dusk sky, a glowing
 * moon, twinkling stars, parallax hill silhouettes, drifting mist, and slow
 * falling leaves. Pure 2D canvas — cheap and self-contained.
 */
export class MenuBackground {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private rafId = 0;
  private t = 0;
  private stars: { x: number; y: number; r: number; tw: number }[] = [];
  private leaves: { x: number; y: number; vx: number; vy: number; rot: number; vr: number; s: number; c: string }[] = [];
  private hills: { color: string; amp: number; base: number; speed: number; step: number }[] = [];

  constructor() {
    Object.assign(this.canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '0',
    });
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Star field.
    for (let i = 0; i < 120; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random() * 0.55,
        r: Math.random() * 1.4 + 0.3,
        tw: Math.random() * Math.PI * 2,
      });
    }
    // Parallax hill layers (far → near).
    this.hills = [
      { color: '#16202c', amp: 60, base: 0.62, speed: 3, step: 0.9 },
      { color: '#111a24', amp: 90, base: 0.72, speed: 6, step: 0.8 },
      { color: '#0c1119', amp: 130, base: 0.84, speed: 10, step: 0.7 },
    ];
    // Falling leaves.
    const leafColors = ['#8a5a2b', '#a9722f', '#6b8a3a', '#c08a3a'];
    for (let i = 0; i < 26; i++) {
      this.leaves.push(this.newLeaf(leafColors, true));
    }
    this.leafColors = leafColors;
  }

  private leafColors: string[] = [];

  private newLeaf(colors: string[], anywhere: boolean): (typeof this.leaves)[number] {
    return {
      x: Math.random(),
      y: anywhere ? Math.random() : -0.05,
      vx: (Math.random() - 0.5) * 0.02,
      vy: 0.015 + Math.random() * 0.02,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 2,
      s: 4 + Math.random() * 5,
      c: colors[Math.floor(Math.random() * colors.length)]!,
    };
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start(): void {
    this.canvas.style.display = 'block';
    let last = performance.now();
    const tick = (now: number): void => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this.t += dt;
      this.draw(dt);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.canvas.style.display = 'none';
  }

  private draw(dt: number): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Sky gradient (dusk).
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0e1622');
    sky.addColorStop(0.45, '#243247');
    sky.addColorStop(0.7, '#c9764a');
    sky.addColorStop(1, '#e0a35c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Stars (upper sky, twinkling).
    for (const s of this.stars) {
      const a = 0.4 + 0.6 * Math.abs(Math.sin(this.t * 1.3 + s.tw));
      ctx.globalAlpha = a * (1 - s.y / 0.55);
      ctx.fillStyle = '#cdd8ff';
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Moon with glow.
    const mx = w * 0.78;
    const my = h * 0.24;
    const glow = ctx.createRadialGradient(mx, my, 8, mx, my, 120);
    glow.addColorStop(0, 'rgba(255,240,210,0.5)');
    glow.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - 120, my - 120, 240, 240);
    ctx.fillStyle = '#f3ead2';
    ctx.beginPath();
    ctx.arc(mx, my, 42, 0, Math.PI * 2);
    ctx.fill();

    // Parallax hills.
    for (const layer of this.hills) {
      ctx.fillStyle = layer.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      const off = this.t * layer.speed;
      for (let x = 0; x <= w; x += 8) {
        const n =
          Math.sin((x + off) * 0.004) * layer.amp * layer.step +
          Math.sin((x + off) * 0.011) * layer.amp * (1 - layer.step);
        ctx.lineTo(x, h * layer.base - n);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }

    // Drifting mist band.
    ctx.fillStyle = 'rgba(200,180,160,0.06)';
    for (let i = 0; i < 3; i++) {
      const y = h * (0.6 + i * 0.08);
      const x = ((this.t * (8 + i * 4)) % (w + 400)) - 200;
      ctx.beginPath();
      ctx.ellipse(x, y, 260, 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Falling leaves.
    for (const l of this.leaves) {
      l.x += (l.vx + Math.sin(this.t + l.rot) * 0.004) * dt * 8;
      l.y += l.vy * dt * 8;
      l.rot += l.vr * dt;
      if (l.y > 1.1) Object.assign(l, this.newLeaf(this.leafColors, false));
      ctx.save();
      ctx.translate(l.x * w, l.y * h);
      ctx.rotate(l.rot);
      ctx.fillStyle = l.c;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(0, 0, l.s, l.s * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
