import {
  settings,
  notifySettingsChanged,
  DEFAULT_SETTINGS,
  DEFAULT_KEYBINDS,
  ACTION_LABELS,
  applyPreset,
  type Action,
  type QualityPreset,
} from '../data/settings';

/**
 * Settings overlay, organised into tabs: Graphics, Audio, Controls, Keybinds,
 * Interface. Reachable from the main menu and the pause menu; changes apply live
 * and persist to localStorage.
 *
 * Graphics are per-knob, not a single opaque "quality" dial. The presets are
 * buttons that write a whole set of knobs at once — after that, moving any one
 * slider flips the preset chip to "Custom" and leaves the rest alone, so you can
 * run Ultra shadows with the grass turned down (or the reverse) without the UI
 * fighting you.
 */

type TabId = 'graphics' | 'audio' | 'controls' | 'keybinds' | 'interface';

const TABS: { id: TabId; label: string }[] = [
  { id: 'graphics', label: 'Graphics' },
  { id: 'audio', label: 'Audio' },
  { id: 'controls', label: 'Controls' },
  { id: 'keybinds', label: 'Keybinds' },
  { id: 'interface', label: 'Interface' },
];

/** Turn a KeyboardEvent.code into something a human can read on a key cap. */
function keyLabel(code: string): string {
  if (!code) return '—';
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow/, '')
    .replace(/Left$/, ' L')
    .replace(/Right$/, ' R')
    .replace('ControlL', 'Ctrl L')
    .replace('Escape', 'Esc');
}

export class SettingsScreen {
  private root = document.createElement('div');
  private panes = new Map<TabId, HTMLDivElement>();
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private sync: (() => void)[] = [];
  /** Set while waiting for the player to press a key for a rebind. */
  private capturing: { action: Action; button: HTMLButtonElement } | null = null;

  visible = false;
  onClose: () => void = () => {};

  constructor() {
    this.root.innerHTML = `<style>
      .set-screen { position: fixed; inset: 0; z-index: 45; display: flex;
        align-items: center; justify-content: center;
        background: radial-gradient(ellipse at 50% 40%, rgba(20,16,12,0.82), rgba(6,5,4,0.93));
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif; }

      .set-panel { width: 640px; max-height: 82vh; display: flex; flex-direction: column;
        color: #efe2c8; border-radius: 14px; overflow: hidden;
        background: linear-gradient(165deg, rgba(44,35,26,0.97), rgba(22,18,14,0.98));
        border: 1px solid rgba(0,0,0,0.7);
        box-shadow: inset 0 1px 0 rgba(224,196,148,0.16), 0 24px 70px rgba(0,0,0,0.7); }

      .set-head { padding: 18px 24px 0; }
      .set-head h2 { margin: 0 0 14px; font-size: 22px; letter-spacing: 3px;
        text-transform: uppercase; color: #e2cb98; font-weight: 600; }

      /* Tabs: a row of struck plates, the active one lit and joined to the body. */
      .set-tabs { display: flex; gap: 3px; }
      .set-tab { flex: 1; padding: 10px 6px; cursor: pointer; font-size: 12px;
        letter-spacing: 1.4px; text-transform: uppercase; font-family: inherit;
        color: rgba(239,226,200,0.5); border: 1px solid rgba(0,0,0,0.6);
        border-bottom: none; border-radius: 8px 8px 0 0;
        background: linear-gradient(180deg, rgba(52,42,32,0.7), rgba(28,22,17,0.7)); }
      .set-tab:hover { color: #efe2c8; background: linear-gradient(180deg, rgba(66,53,40,0.8), rgba(34,27,21,0.8)); }
      .set-tab.on { color: #f3dfae; background: linear-gradient(180deg, rgba(86,68,44,0.95), rgba(46,37,27,0.95));
        box-shadow: inset 0 2px 0 rgba(232,201,106,0.55); }

      .set-body { flex: 1; overflow-y: auto; padding: 20px 24px;
        border-top: 1px solid rgba(232,201,106,0.22);
        background: rgba(0,0,0,0.18); }
      .set-body::-webkit-scrollbar { width: 8px; }
      .set-body::-webkit-scrollbar-thumb { background: rgba(232,201,106,0.25); border-radius: 4px; }

      .set-group { font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
        color: rgba(232,201,106,0.65); margin: 16px 0 8px; }
      .set-group:first-child { margin-top: 0; }

      .set-row { display: flex; align-items: center; gap: 12px; margin: 9px 0; font-size: 14px; }
      .set-row > label { flex: 0 0 168px; color: rgba(239,226,200,0.9); }
      .set-row .hint { font-size: 11px; color: rgba(239,226,200,0.4); margin-left: 180px;
        margin-top: -5px; margin-bottom: 8px; }
      .set-row input[type=range] { flex: 1; accent-color: #d8b45e; height: 4px; }
      .set-row .val { flex: 0 0 62px; text-align: right; font-size: 12px;
        font-family: ui-monospace, monospace; color: rgba(239,226,200,0.65); }
      .set-row input[type=checkbox] { width: 16px; height: 16px; accent-color: #d8b45e; }

      .set-seg { flex: 1; display: flex; gap: 4px; }
      .set-seg-btn { flex: 1; padding: 7px 0; font-size: 11px; cursor: pointer;
        font-family: inherit; letter-spacing: 1px; text-transform: uppercase;
        border-radius: 6px; color: rgba(239,226,200,0.6);
        border: 1px solid rgba(0,0,0,0.65);
        background: linear-gradient(180deg, rgba(60,49,37,0.8), rgba(30,24,19,0.8));
        box-shadow: inset 0 1px 0 rgba(224,196,148,0.12); }
      .set-seg-btn:hover { color: #f3e6cc; }
      .set-seg-btn.on { color: #1c1408; font-weight: 700;
        background: linear-gradient(180deg, #e6c675, #b8934a);
        box-shadow: inset 0 1px 0 rgba(255,240,200,0.6), 0 0 10px rgba(214,168,74,0.35); }

      /* Keybinds */
      .set-bind { display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
      .set-bind > span { font-size: 13px; color: rgba(239,226,200,0.85); }
      .set-key { min-width: 92px; padding: 6px 10px; cursor: pointer; font-size: 11px;
        font-family: ui-monospace, monospace; letter-spacing: 0.5px; color: #f0e2c4;
        border-radius: 6px; border: 1px solid rgba(0,0,0,0.7);
        background: linear-gradient(180deg, #443729, #241d16);
        box-shadow: inset 0 1px 0 rgba(224,196,148,0.2), 0 2px 0 rgba(0,0,0,0.5); }
      .set-key:hover { border-color: rgba(232,201,106,0.5); }
      .set-key.capturing { color: #1c1408; background: linear-gradient(180deg, #e6c675, #b8934a);
        animation: set-blink 0.7s ease-in-out infinite; }
      @keyframes set-blink { 50% { opacity: 0.55; } }

      .set-foot { display: flex; gap: 10px; padding: 16px 24px;
        border-top: 1px solid rgba(0,0,0,0.5); background: rgba(0,0,0,0.25); }
      .set-btn { flex: 1; padding: 11px; font-size: 12px; font-weight: 600; cursor: pointer;
        font-family: inherit; letter-spacing: 1.6px; text-transform: uppercase;
        border-radius: 8px; color: #efe2c8; border: 1px solid rgba(0,0,0,0.65);
        background: linear-gradient(180deg, rgba(66,54,41,0.9), rgba(32,26,20,0.9));
        box-shadow: inset 0 1px 0 rgba(224,196,148,0.16); }
      .set-btn:hover { filter: brightness(1.2); }
      .set-btn.primary { color: #1c1408;
        background: linear-gradient(180deg, #e6c675, #b8934a);
        box-shadow: inset 0 1px 0 rgba(255,240,200,0.6); }
    </style>`;

    const screen = document.createElement('div');
    screen.className = 'set-screen';
    const panel = document.createElement('div');
    panel.className = 'set-panel';

    const head = document.createElement('div');
    head.className = 'set-head';
    head.innerHTML = '<h2>Settings</h2>';
    const tabs = document.createElement('div');
    tabs.className = 'set-tabs';
    head.appendChild(tabs);

    const body = document.createElement('div');
    body.className = 'set-body';

    for (const t of TABS) {
      const btn = document.createElement('button');
      btn.className = 'set-tab';
      btn.textContent = t.label;
      btn.addEventListener('click', () => this.showTab(t.id));
      tabs.appendChild(btn);
      this.tabButtons.set(t.id, btn);

      const pane = document.createElement('div');
      pane.style.display = 'none';
      body.appendChild(pane);
      this.panes.set(t.id, pane);
    }

    this.buildGraphics(this.panes.get('graphics')!);
    this.buildAudio(this.panes.get('audio')!);
    this.buildControls(this.panes.get('controls')!);
    this.buildKeybinds(this.panes.get('keybinds')!);
    this.buildInterface(this.panes.get('interface')!);

    const foot = document.createElement('div');
    foot.className = 'set-foot';
    const reset = document.createElement('button');
    reset.className = 'set-btn';
    reset.textContent = 'Restore defaults';
    reset.addEventListener('click', () => {
      Object.assign(settings, DEFAULT_SETTINGS, { keybinds: { ...DEFAULT_KEYBINDS } });
      notifySettingsChanged();
      this.syncAll();
    });
    const done = document.createElement('button');
    done.className = 'set-btn primary';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.hide());
    foot.append(reset, done);

    panel.append(head, body, foot);
    screen.appendChild(panel);
    this.root.appendChild(screen);
    this.root.style.display = 'none';
    document.body.appendChild(this.root);

    // Keybind capture: swallow the next keypress while a bind button is armed.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.capturing) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== 'Escape') {
          settings.keybinds[this.capturing.action] = e.code;
          notifySettingsChanged();
        }
        this.capturing.button.classList.remove('capturing');
        this.capturing = null;
        this.syncAll();
      },
      true, // capture phase, so the game never sees the rebind keypress
    );

    this.showTab('graphics');
  }

  private showTab(id: TabId): void {
    for (const [tid, pane] of this.panes) pane.style.display = tid === id ? 'block' : 'none';
    for (const [tid, btn] of this.tabButtons) btn.classList.toggle('on', tid === id);
  }

  // ── Widget helpers ────────────────────────────────────────────────────────

  private group(parent: HTMLElement, text: string): void {
    const g = document.createElement('div');
    g.className = 'set-group';
    g.textContent = text;
    parent.appendChild(g);
  }

  private slider(
    parent: HTMLElement,
    label: string,
    get: () => number,
    set: (v: number) => void,
    opts: { min?: number; max?: number; step?: number; fmt?: (v: number) => string; custom?: boolean } = {},
  ): void {
    const row = document.createElement('div');
    row.className = 'set-row';
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(opts.min ?? 0);
    input.max = String(opts.max ?? 1);
    input.step = String(opts.step ?? 0.05);
    const val = document.createElement('span');
    val.className = 'val';
    const fmt = opts.fmt ?? ((v: number) => `${Math.round(v * 100)}%`);

    input.addEventListener('input', () => {
      const v = Number(input.value);
      set(v);
      // Touching an individual graphics knob means the preset no longer
      // describes the settings — say so, rather than lying with a lit chip.
      if (opts.custom) settings.quality = 'custom';
      val.textContent = fmt(v);
      notifySettingsChanged();
      this.syncAll();
    });
    row.append(lab, input, val);
    parent.appendChild(row);
    this.sync.push(() => {
      input.value = String(get());
      val.textContent = fmt(get());
    });
  }

  private toggle(
    parent: HTMLElement,
    label: string,
    get: () => boolean,
    set: (v: boolean) => void,
    custom = false,
  ): void {
    const row = document.createElement('div');
    row.className = 'set-row';
    const lab = document.createElement('label');
    lab.textContent = label;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      set(box.checked);
      if (custom) settings.quality = 'custom';
      notifySettingsChanged();
      this.syncAll();
    });
    row.append(lab, box);
    parent.appendChild(row);
    this.sync.push(() => (box.checked = get()));
  }

  // ── Panes ─────────────────────────────────────────────────────────────────

  private buildGraphics(pane: HTMLElement): void {
    this.group(pane, 'Preset');
    const row = document.createElement('div');
    row.className = 'set-row';
    const lab = document.createElement('label');
    lab.textContent = 'Quality';
    const seg = document.createElement('div');
    seg.className = 'set-seg';
    const presets: QualityPreset[] = ['low', 'medium', 'high', 'ultra', 'custom'];
    const chips = presets.map((p) => {
      const b = document.createElement('button');
      b.className = 'set-seg-btn';
      b.textContent = p;
      // "Custom" is a status, not a choice — it lights up on its own when you
      // move a slider, so there is nothing to click.
      if (p === 'custom') b.disabled = true;
      else
        b.addEventListener('click', () => {
          applyPreset(p as Exclude<QualityPreset, 'custom'>);
          notifySettingsChanged();
          this.syncAll();
        });
      seg.appendChild(b);
      return b;
    });
    row.append(lab, seg);
    pane.appendChild(row);
    this.sync.push(() => {
      chips.forEach((b, i) => b.classList.toggle('on', presets[i] === settings.quality));
    });

    this.group(pane, 'World detail');
    this.slider(pane, 'Render distance', () => settings.viewRadius, (v) => (settings.viewRadius = v), {
      min: 2, max: 10, step: 1, fmt: (v) => `${v} chunks`, custom: true,
    });
    this.slider(pane, 'Vegetation density', () => settings.grassDensity, (v) => (settings.grassDensity = v), {
      min: 0, max: 1.6, step: 0.1, fmt: (v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`), custom: true,
    });
    this.slider(pane, 'Vegetation range', () => settings.grassRadius, (v) => (settings.grassRadius = v), {
      min: 0, max: 3, step: 1, fmt: (v) => (v === 0 ? 'off' : `${v * 64} m`), custom: true,
    });

    this.group(pane, 'Lighting');
    this.toggle(pane, 'Shadows', () => settings.shadows, (v) => (settings.shadows = v), true);
    this.slider(pane, 'Shadow detail', () => settings.shadowMapSize, (v) => (settings.shadowMapSize = v), {
      min: 512, max: 4096, step: 512, fmt: (v) => `${v}px`, custom: true,
    });

    this.group(pane, 'Post-processing');
    this.toggle(pane, 'Enable post-FX', () => settings.postFX, (v) => (settings.postFX = v), true);
    this.slider(pane, 'Bloom', () => settings.bloom, (v) => (settings.bloom = v), {
      min: 0, max: 1, step: 0.05, fmt: (v) => (v === 0 ? 'off' : v.toFixed(2)), custom: true,
    });
    this.slider(pane, 'Vignette', () => settings.vignette, (v) => (settings.vignette = v), {
      min: 0, max: 2, step: 0.1, fmt: (v) => (v === 0 ? 'off' : v.toFixed(1)), custom: true,
    });
    this.slider(pane, 'Saturation', () => settings.saturation, (v) => (settings.saturation = v), {
      min: 0.6, max: 1.8, step: 0.02, fmt: (v) => `${v.toFixed(2)}×`,
    });

    this.group(pane, 'Display');
    this.slider(pane, 'Resolution scale', () => settings.maxPixelRatio, (v) => (settings.maxPixelRatio = v), {
      min: 0.75, max: 2, step: 0.25, fmt: (v) => `${v.toFixed(2)}×`, custom: true,
    });
    this.slider(pane, 'Field of view', () => settings.fov, (v) => (settings.fov = v), {
      min: 55, max: 100, step: 1, fmt: (v) => `${v}°`,
    });
  }

  private buildAudio(pane: HTMLElement): void {
    this.group(pane, 'Volume');
    this.slider(pane, 'Master', () => settings.volumeMaster, (v) => (settings.volumeMaster = v));
    this.slider(pane, 'Effects', () => settings.volumeEffects, (v) => (settings.volumeEffects = v));
    this.slider(pane, 'Ambience', () => settings.volumeAmbience, (v) => (settings.volumeAmbience = v));
    this.slider(pane, 'Music', () => settings.volumeMusic, (v) => (settings.volumeMusic = v));
  }

  private buildControls(pane: HTMLElement): void {
    this.group(pane, 'Mouse');
    this.slider(pane, 'Sensitivity', () => settings.mouseSensitivity, (v) => (settings.mouseSensitivity = v), {
      min: 0.3, max: 2.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`,
    });
    this.toggle(pane, 'Invert look (Y)', () => settings.invertY, (v) => (settings.invertY = v));
  }

  private buildKeybinds(pane: HTMLElement): void {
    this.group(pane, 'Click a key, then press the new one (Esc cancels)');
    for (const action of Object.keys(ACTION_LABELS) as Action[]) {
      const row = document.createElement('div');
      row.className = 'set-bind';
      const name = document.createElement('span');
      name.textContent = ACTION_LABELS[action];
      const btn = document.createElement('button');
      btn.className = 'set-key';
      btn.addEventListener('click', () => {
        if (this.capturing) this.capturing.button.classList.remove('capturing');
        this.capturing = { action, button: btn };
        btn.classList.add('capturing');
        btn.textContent = 'press…';
      });
      row.append(name, btn);
      pane.appendChild(row);
      this.sync.push(() => {
        if (this.capturing?.action === action) return;
        btn.textContent = keyLabel(settings.keybinds[action]);
      });
    }
  }

  private buildInterface(pane: HTMLElement): void {
    this.group(pane, 'On-screen');
    this.toggle(pane, 'HUD (vitals, hotbar)', () => settings.showHud, (v) => (settings.showHud = v));
    this.toggle(pane, 'Status card (clock)', () => settings.showStatus, (v) => (settings.showStatus = v));
    this.toggle(pane, 'Crosshair', () => settings.showCrosshair, (v) => (settings.showCrosshair = v));
    this.toggle(pane, 'Performance readout', () => settings.showPerf, (v) => (settings.showPerf = v));
  }

  private syncAll(): void {
    for (const fn of this.sync) fn();
  }

  show(): void {
    this.visible = true;
    this.syncAll();
    this.root.style.display = 'block';
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.onClose();
  }
}
