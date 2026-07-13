import { applyPreset, worldConfig } from '../data/difficulty';
import { MenuBackground } from './menuBackground';

/** A short random, memorable-ish world seed for new games. */
function randomSeed(): string {
  const syl = ['wyrd', 'thorn', 'mist', 'fell', 'grim', 'hollow', 'ash', 'frost', 'raven', 'stone', 'wolf', 'iron'];
  const a = syl[Math.floor(Math.random() * syl.length)];
  const b = syl[Math.floor(Math.random() * syl.length)];
  return `${a}${b}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

const SHARED_CSS = `
  .menu-screen { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 40; font-family: 'Georgia', 'Times New Roman', serif; }
  .menu-title { font-size: 76px; font-weight: 800; letter-spacing: 12px; color: #f0e2bc;
    text-shadow: 0 2px 4px rgba(0,0,0,0.8), 0 0 40px rgba(232,201,106,0.35); margin-bottom: 2px;
    animation: titleGlow 4s ease-in-out infinite; }
  @keyframes titleGlow { 0%,100% { text-shadow: 0 2px 4px rgba(0,0,0,0.8), 0 0 32px rgba(232,201,106,0.28); }
    50% { text-shadow: 0 2px 4px rgba(0,0,0,0.8), 0 0 52px rgba(232,201,106,0.5); } }
  .menu-title-rule { width: 320px; height: 2px; margin: 6px auto 8px;
    background: linear-gradient(90deg, transparent, rgba(232,201,106,0.7), transparent); }
  .menu-sub { color: rgba(240,226,188,0.55); letter-spacing: 5px; font-size: 13px; margin-bottom: 44px; text-transform: uppercase; }
  .menu-btn { display: block; width: 300px; margin: 11px auto; padding: 14px; font-size: 15px; font-weight: 600; letter-spacing: 2px; color: #f0e2bc; background: rgba(20,26,34,0.55); border: 1px solid rgba(232,201,106,0.3); border-radius: 8px; cursor: pointer; backdrop-filter: blur(3px); transition: all 0.18s; font-family: 'Georgia', serif; }
  .menu-btn:hover { background: rgba(40,50,60,0.7); border-color: rgba(232,201,106,0.7); transform: translateY(-1px); }
  .menu-btn.primary { background: linear-gradient(180deg, #f0d27a, #d8b154); color: #1a1408; border: 1px solid rgba(0,0,0,0.2); text-shadow: 0 1px 0 rgba(255,255,255,0.3); }
  .menu-btn.primary:hover { background: linear-gradient(180deg, #f8dd8a, #e0bb60); }
  .menu-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .setup-panel { background: rgba(16,20,26,0.92); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 26px 30px; width: 460px; max-height: 82vh; overflow-y: auto; }
  .setup-panel h2 { color: #e8d9b0; margin: 0 0 16px; font-size: 20px; letter-spacing: 1px; }
  .setup-label { color: rgba(255,255,255,0.6); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 14px 0 6px; }
  .seed-input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.35); color: #fff; font-size: 14px; }
  .preset-row { display: flex; gap: 8px; }
  .preset-btn { flex: 1; padding: 9px 4px; border-radius: 8px; border: 2px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.3); color: #fff; cursor: pointer; font-size: 12px; }
  .preset-btn.sel { border-color: #ffd97a; background: rgba(60,50,20,0.5); }
  .mod-row { display: flex; align-items: center; justify-content: space-between; margin: 7px 0; color: #fff; font-size: 13px; }
  .mod-row input[type=range] { width: 150px; }
  .mod-row select { background: rgba(0,0,0,0.4); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 3px 6px; }
  .mod-val { color: rgba(255,255,255,0.5); font-size: 11px; width: 34px; text-align: right; }
  details.custom { margin-top: 12px; }
  details.custom summary { color: #ffd97a; font-size: 13px; cursor: pointer; letter-spacing: 0.5px; }
`;

/** Title screen. */
export class MainMenu {
  private root = document.createElement('div');
  onNewGame: () => void = () => {};
  onContinue: (() => void) | null = null;
  onSettings: () => void = () => {};

  private background = new MenuBackground();

  constructor(hasSave: boolean) {
    this.root.innerHTML = `<style>${SHARED_CSS}
      .main-menu { flex-direction: column; background: transparent; }
    </style>`;
    const screen = document.createElement('div');
    screen.className = 'menu-screen main-menu';
    screen.innerHTML = `
      <div class="menu-title">WYRDWOOD</div>
      <div class="menu-title-rule"></div>
      <div class="menu-sub">survive · craft · build · conquer</div>`;

    const newBtn = document.createElement('button');
    newBtn.className = 'menu-btn primary';
    newBtn.textContent = 'NEW GAME';
    newBtn.addEventListener('click', () => {
      this.hide();
      this.onNewGame();
    });
    screen.appendChild(newBtn);

    const contBtn = document.createElement('button');
    contBtn.className = 'menu-btn';
    contBtn.textContent = 'CONTINUE';
    contBtn.disabled = !hasSave;
    contBtn.addEventListener('click', () => {
      if (this.onContinue) {
        this.hide();
        this.onContinue();
      }
    });
    screen.appendChild(contBtn);

    const setBtn = document.createElement('button');
    setBtn.className = 'menu-btn';
    setBtn.textContent = 'SETTINGS';
    setBtn.addEventListener('click', () => this.onSettings());
    screen.appendChild(setBtn);

    this.root.appendChild(screen);
    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.style.display = 'block';
    this.background.start();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.background.stop();
  }
}

/** World setup: name/seed, difficulty preset, custom modifiers. */
export class WorldSetup {
  private root = document.createElement('div');
  seedText = 'wyrdwood';
  onStart: () => void = () => {};
  onBack: () => void = () => {};

  constructor() {
    this.root.innerHTML = `<style>${SHARED_CSS}
      .setup-screen { background: linear-gradient(170deg, #0e1622, #10200f); }
    </style>`;
    const screen = document.createElement('div');
    screen.className = 'menu-screen setup-screen';
    const panel = document.createElement('div');
    panel.className = 'setup-panel';
    panel.innerHTML = '<h2>World Setup</h2>';

    // Seed.
    const seedLab = document.createElement('div');
    seedLab.className = 'setup-label';
    seedLab.textContent = 'World seed';
    panel.appendChild(seedLab);
    // Each new world gets a fresh random seed by default (type your own to share worlds).
    this.seedText = randomSeed();
    const seedRow = document.createElement('div');
    seedRow.style.cssText = 'display:flex; gap:8px;';
    const seed = document.createElement('input');
    seed.className = 'seed-input';
    seed.value = this.seedText;
    seed.addEventListener('input', () => (this.seedText = seed.value));
    const dice = document.createElement('button');
    dice.className = 'menu-btn';
    dice.style.cssText = 'width:52px; margin:0; padding:0; font-size:20px;';
    dice.title = 'Random seed';
    dice.textContent = '🎲';
    dice.addEventListener('click', () => {
      this.seedText = randomSeed();
      seed.value = this.seedText;
    });
    seedRow.append(seed, dice);
    panel.appendChild(seedRow);

    // Difficulty presets.
    const diffLab = document.createElement('div');
    diffLab.className = 'setup-label';
    diffLab.textContent = 'Difficulty';
    panel.appendChild(diffLab);
    const presetRow = document.createElement('div');
    presetRow.className = 'preset-row';
    const presetBtns = new Map<string, HTMLButtonElement>();
    for (const preset of ['peaceful', 'normal', 'hard', 'survival'] as const) {
      const btn = document.createElement('button');
      btn.className = 'preset-btn' + (preset === 'normal' ? ' sel' : '');
      btn.textContent = preset[0]!.toUpperCase() + preset.slice(1);
      btn.addEventListener('click', () => {
        applyPreset(preset);
        presetBtns.forEach((b) => b.classList.remove('sel'));
        btn.classList.add('sel');
        this.syncCustomInputs();
      });
      presetBtns.set(preset, btn);
      presetRow.appendChild(btn);
    }
    panel.appendChild(presetRow);

    // Customize (world modifiers).
    const custom = document.createElement('details');
    custom.className = 'custom';
    custom.innerHTML = '<summary>Customize world modifiers</summary>';
    this.buildCustomizePanel(custom, () => {
      worldConfig.preset = 'custom';
      presetBtns.forEach((b) => b.classList.remove('sel'));
    });
    panel.appendChild(custom);

    const start = document.createElement('button');
    start.className = 'menu-btn primary';
    start.style.marginTop = '20px';
    start.textContent = 'BEGIN ➜';
    start.addEventListener('click', () => {
      this.hide();
      this.onStart();
    });
    panel.appendChild(start);

    const back = document.createElement('button');
    back.className = 'menu-btn';
    back.style.marginTop = '4px';
    back.textContent = '‹ BACK';
    back.addEventListener('click', () => {
      this.hide();
      this.onBack();
    });
    panel.appendChild(back);

    screen.appendChild(panel);
    this.root.appendChild(screen);
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  private customInputs: (() => void)[] = [];

  private buildCustomizePanel(parent: HTMLElement, markCustom: () => void): void {
    const row = (label: string, input: HTMLElement, valEl?: HTMLElement): void => {
      const div = document.createElement('div');
      div.className = 'mod-row';
      const span = document.createElement('span');
      span.textContent = label;
      div.appendChild(span);
      const wrap = document.createElement('span');
      wrap.appendChild(input);
      if (valEl) wrap.appendChild(valEl);
      div.appendChild(wrap);
      parent.appendChild(div);
    };

    const slider = (
      label: string,
      min: number,
      max: number,
      step: number,
      get: () => number,
      set: (v: number) => void,
    ): void => {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      const val = document.createElement('span');
      val.className = 'mod-val';
      const sync = (): void => {
        input.value = String(get());
        val.textContent = String(get());
      };
      sync();
      this.customInputs.push(sync);
      input.addEventListener('input', () => {
        set(Number(input.value));
        val.textContent = input.value;
        markCustom();
      });
      row(label, input, val);
    };

    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): void => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      const sync = (): void => {
        input.checked = get();
      };
      sync();
      this.customInputs.push(sync);
      input.addEventListener('change', () => {
        set(input.checked);
        markCustom();
      });
      row(label, input);
    };

    slider('Enemy amount', 0, 3, 0.25, () => worldConfig.combat.enemyDensity, (v) => (worldConfig.combat.enemyDensity = v));
    slider('Enemy damage', 0, 3, 0.25, () => worldConfig.combat.enemyDamage, (v) => (worldConfig.combat.enemyDamage = v));
    slider('Enemy aggression', 0.5, 2.5, 0.25, () => worldConfig.combat.enemyAggression, (v) => (worldConfig.combat.enemyAggression = v));
    slider('Wildlife amount', 0, 3, 0.25, () => worldConfig.world.passiveDensity, (v) => (worldConfig.world.passiveDensity = v));
    slider('Hunger rate', 0, 3, 0.25, () => worldConfig.survival.hungerRate, (v) => (worldConfig.survival.hungerRate = v));
    slider('Thirst rate', 0, 3, 0.25, () => worldConfig.survival.thirstRate, (v) => (worldConfig.survival.thirstRate = v));
    slider('Day length (min)', 4, 30, 1, () => worldConfig.world.dayLengthMin, (v) => (worldConfig.world.dayLengthMin = v));
    toggle('Hunger', () => worldConfig.toggles.hunger, (v) => (worldConfig.toggles.hunger = v));
    toggle('Thirst', () => worldConfig.toggles.thirst, (v) => (worldConfig.toggles.thirst = v));
    toggle('Cold/warmth', () => worldConfig.toggles.warmth, (v) => (worldConfig.toggles.warmth = v));
    toggle('Map', () => worldConfig.toggles.map, (v) => (worldConfig.toggles.map = v));
    toggle('Minimap', () => worldConfig.toggles.minimap, (v) => (worldConfig.toggles.minimap = v));
    toggle('Free building', () => worldConfig.toggles.freeBuild, (v) => (worldConfig.toggles.freeBuild = v));

    // Death penalty select.
    const sel = document.createElement('select');
    for (const opt of ['none', 'drop'] as const) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt === 'none' ? 'Keep items' : 'Drop everything';
      sel.appendChild(o);
    }
    const syncSel = (): void => {
      sel.value = worldConfig.deathPenalty === 'drop' ? 'drop' : 'none';
    };
    syncSel();
    this.customInputs.push(syncSel);
    sel.addEventListener('change', () => {
      worldConfig.deathPenalty = sel.value as 'none' | 'drop';
      markCustom();
    });
    const div = document.createElement('div');
    div.className = 'mod-row';
    div.innerHTML = '<span>On death</span>';
    div.appendChild(sel);
    parent.appendChild(div);
  }

  private syncCustomInputs(): void {
    for (const sync of this.customInputs) sync();
  }

  show(): void {
    this.root.style.display = 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

/** Pause menu (Esc in game). */
export class PauseMenu {
  private root = document.createElement('div');
  visible = false;
  onResume: () => void = () => {};
  onQuit: () => void = () => {};
  onSettings: () => void = () => {};

  constructor() {
    this.root.innerHTML = `<style>${SHARED_CSS}
      .pause-screen { background: rgba(8,10,14,0.8); flex-direction: column; }
      .pause-title { font-size: 34px; font-weight: 700; letter-spacing: 6px; color: #e8d9b0; margin-bottom: 26px; }
    </style>`;
    const screen = document.createElement('div');
    screen.className = 'menu-screen pause-screen';
    screen.innerHTML = '<div class="pause-title">PAUSED</div>';

    const resume = document.createElement('button');
    resume.className = 'menu-btn primary';
    resume.textContent = 'RESUME';
    resume.addEventListener('click', () => this.onResume());
    const setBtn = document.createElement('button');
    setBtn.className = 'menu-btn';
    setBtn.textContent = 'SETTINGS';
    setBtn.addEventListener('click', () => this.onSettings());
    const quit = document.createElement('button');
    quit.className = 'menu-btn';
    quit.textContent = 'QUIT TO MENU';
    quit.addEventListener('click', () => this.onQuit());
    screen.append(resume, setBtn, quit);

    this.root.appendChild(screen);
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? 'block' : 'none';
    if (v && document.pointerLockElement) document.exitPointerLock();
  }
}

/** Victory overlay when the beacon is lit. */
export class WinScreen {
  private root = document.createElement('div');
  onContinue: () => void = () => {};

  constructor() {
    this.root.innerHTML = `<style>${SHARED_CSS}
      .win-screen { background: radial-gradient(ellipse at center, rgba(60,40,5,0.85), rgba(8,10,14,0.95)); flex-direction: column; }
      .win-title { font-size: 44px; font-weight: 800; letter-spacing: 6px; color: #ffd97a; text-shadow: 0 0 40px rgba(255,160,40,0.6); margin-bottom: 12px; }
      .win-sub { color: rgba(255,255,255,0.75); font-size: 15px; margin-bottom: 34px; max-width: 460px; text-align: center; line-height: 1.6; }
    </style>`;
    const screen = document.createElement('div');
    screen.className = 'menu-screen win-screen';
    screen.innerHTML = `
      <div class="win-title">🔥 THE BEACON BURNS</div>
      <div class="win-sub">From bare hands to blazing wyrd-fire — you gathered, crafted, built, and
      survived the wilds. Wyrdwood is yours, wanderer. The world remains open: keep building, keep exploring.</div>`;
    const btn = document.createElement('button');
    btn.className = 'menu-btn primary';
    btn.textContent = 'CONTINUE PLAYING';
    btn.addEventListener('click', () => {
      this.root.style.display = 'none';
      this.onContinue();
    });
    screen.appendChild(btn);
    this.root.appendChild(screen);
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.style.display = 'block';
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
