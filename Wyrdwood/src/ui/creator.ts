import * as THREE from 'three';
import { Humanoid } from '../player/humanoid';
import {
  SKIN_TONES,
  HAIR_COLORS,
  CLOTH_COLORS,
  DEFAULT_APPEARANCE,
  type Appearance,
} from '../data/appearance';

/**
 * Character creator: swatch pickers + a live rotating 3D preview of the
 * same procedural humanoid used in-game.
 */
export class CharacterCreator {
  readonly appearance: Appearance = { ...DEFAULT_APPEARANCE };
  private root = document.createElement('div');
  private preview: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; humanoid: Humanoid } | null = null;
  private rafId = 0;
  onDone: (appearance: Appearance) => void = () => {};
  onBack: () => void = () => {};

  constructor() {
    this.root.innerHTML = `<style>
      .creator-screen { position: fixed; inset: 0; background: linear-gradient(160deg, #101820, #1a2610); display: flex; align-items: center; justify-content: center; z-index: 40; font-family: system-ui, sans-serif; }
      .creator-panel { display: flex; gap: 28px; background: rgba(16,20,26,0.9); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 28px; }
      .creator-left canvas { border-radius: 10px; background: #0d1218; }
      .creator-right { width: 300px; }
      .creator-right h2 { color: #e8d9b0; margin: 0 0 14px; font-size: 20px; letter-spacing: 1px; }
      .swatch-label { color: rgba(255,255,255,0.6); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 6px; }
      .swatches { display: flex; gap: 6px; flex-wrap: wrap; }
      .swatch { width: 30px; height: 30px; border-radius: 6px; cursor: pointer; border: 2px solid rgba(255,255,255,0.15); }
      .swatch.sel { border-color: #ffd97a; }
      .hair-btn { padding: 5px 12px; border-radius: 6px; border: 2px solid rgba(255,255,255,0.15); color: #fff; background: rgba(0,0,0,0.3); cursor: pointer; font-size: 12px; }
      .hair-btn.sel { border-color: #ffd97a; }
      .creator-start { margin-top: 22px; width: 100%; padding: 12px; font-size: 16px; font-weight: 700; letter-spacing: 1px; color: #1a1408; background: #e8c96a; border: none; border-radius: 8px; cursor: pointer; }
      .creator-start:hover { background: #f5da85; }
      .creator-back { margin-top: 8px; width: 100%; padding: 9px; font-size: 13px; letter-spacing: 1px; color: #e7d6ab; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; cursor: pointer; }
      .creator-back:hover { background: rgba(255,255,255,0.14); }
    </style>`;
    const screen = document.createElement('div');
    screen.className = 'creator-screen';
    const panel = document.createElement('div');
    panel.className = 'creator-panel';

    const left = document.createElement('div');
    left.className = 'creator-left';
    const canvas = document.createElement('canvas');
    canvas.width = 260;
    canvas.height = 380;
    left.appendChild(canvas);

    const right = document.createElement('div');
    right.className = 'creator-right';
    right.innerHTML = '<h2>Your Wanderer</h2>';

    const swatchRow = (
      label: string,
      colors: number[],
      get: () => number,
      set: (c: number) => void,
    ): void => {
      const lab = document.createElement('div');
      lab.className = 'swatch-label';
      lab.textContent = label;
      right.appendChild(lab);
      const row = document.createElement('div');
      row.className = 'swatches';
      for (const c of colors) {
        const sw = document.createElement('div');
        sw.className = 'swatch' + (get() === c ? ' sel' : '');
        sw.style.background = `#${c.toString(16).padStart(6, '0')}`;
        sw.addEventListener('click', () => {
          set(c);
          row.querySelectorAll('.swatch').forEach((el) => el.classList.remove('sel'));
          sw.classList.add('sel');
          this.applyPreview();
        });
        row.appendChild(sw);
      }
      right.appendChild(row);
    };

    swatchRow('Skin', SKIN_TONES, () => this.appearance.skinTone, (c) => (this.appearance.skinTone = c));
    swatchRow('Hair color', HAIR_COLORS, () => this.appearance.hairColor, (c) => (this.appearance.hairColor = c));

    const hairLab = document.createElement('div');
    hairLab.className = 'swatch-label';
    hairLab.textContent = 'Hair style';
    right.appendChild(hairLab);
    const hairRow = document.createElement('div');
    hairRow.className = 'swatches';
    for (const style of ['short', 'long', 'none'] as const) {
      const btn = document.createElement('button');
      btn.className = 'hair-btn' + (this.appearance.hairStyle === style ? ' sel' : '');
      btn.textContent = style;
      btn.addEventListener('click', () => {
        this.appearance.hairStyle = style;
        hairRow.querySelectorAll('.hair-btn').forEach((el) => el.classList.remove('sel'));
        btn.classList.add('sel');
        this.applyPreview();
      });
      hairRow.appendChild(btn);
    }
    right.appendChild(hairRow);

    swatchRow('Shirt', CLOTH_COLORS, () => this.appearance.shirtColor, (c) => (this.appearance.shirtColor = c));
    swatchRow('Trousers', [0x4a4238, ...CLOTH_COLORS.slice(0, 4)], () => this.appearance.pantsColor, (c) => (this.appearance.pantsColor = c));

    const start = document.createElement('button');
    start.className = 'creator-start';
    start.textContent = 'CONTINUE ➜';
    start.addEventListener('click', () => {
      this.hide();
      this.onDone(this.appearance);
    });
    right.appendChild(start);

    const back = document.createElement('button');
    back.className = 'creator-back';
    back.textContent = '‹ Back';
    back.addEventListener('click', () => {
      this.hide();
      this.onBack();
    });
    right.appendChild(back);

    panel.append(left, right);
    screen.appendChild(panel);
    this.root.appendChild(screen);
    this.root.style.display = 'none';
    document.body.appendChild(this.root);

    // 3D preview scene.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1218);
    const camera = new THREE.PerspectiveCamera(35, 260 / 380, 0.1, 20);
    camera.position.set(0, 1.15, 3.4);
    camera.lookAt(0, 0.95, 0);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a4030, 1.1));
    const key = new THREE.DirectionalLight(0xfff2d8, 2.2);
    key.position.set(2, 3, 2);
    scene.add(key);
    const humanoid = new Humanoid(this.appearance);
    scene.add(humanoid.group);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 32),
      new THREE.MeshStandardMaterial({ color: 0x1c2430 }),
    );
    disc.rotation.x = -Math.PI / 2;
    scene.add(disc);
    this.preview = { renderer, scene, camera, humanoid };
  }

  private applyPreview(): void {
    this.preview?.humanoid.setAppearance(this.appearance);
  }

  show(): void {
    this.root.style.display = 'block';
    let last = performance.now();
    const tick = (now: number): void => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!this.preview) return;
      this.preview.humanoid.group.rotation.y += dt * 0.8;
      this.preview.humanoid.animate(dt, 0, true);
      this.preview.renderer.render(this.preview.scene, this.preview.camera);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  hide(): void {
    this.root.style.display = 'none';
    cancelAnimationFrame(this.rafId);
  }
}
