/**
 * User settings — persisted separately from world saves so they apply across
 * every world.
 *
 * Graphics are stored as **individual knobs**, not as a preset. A preset is just
 * a button that writes a set of those knobs; afterwards you can move any one of
 * them and the rest stay put. Storing only the preset name (the old design) made
 * "quality" a single opaque dial that mostly changed render distance, with no
 * way to say "I want the shadows but not the grass".
 */

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';

/** Actions the player can rebind. */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'interact'
  | 'eat'
  | 'inventory'
  | 'craft'
  | 'build'
  | 'map'
  | 'character'
  | 'freeLook'
  | 'toggleHud'
  | 'togglePerf';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump',
  sprint: 'Sprint',
  crouch: 'Crouch',
  interact: 'Interact / harvest',
  eat: 'Eat',
  inventory: 'Inventory',
  craft: 'Crafting',
  build: 'Build menu',
  map: 'Map',
  character: 'Character',
  freeLook: 'Free look',
  toggleHud: 'Show/hide HUD',
  togglePerf: 'Show/hide performance',
};

export const DEFAULT_KEYBINDS: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  crouch: 'ControlLeft',
  interact: 'KeyE',
  eat: 'KeyF',
  inventory: 'Tab',
  craft: 'KeyC',
  build: 'KeyB',
  map: 'KeyM',
  character: 'KeyP',
  freeLook: 'AltLeft',
  toggleHud: 'F1',
  togglePerf: 'F3',
};

export interface Settings {
  // ── Audio ────────────────────────────────────────────────────────────────
  volumeMaster: number;
  volumeEffects: number;
  volumeAmbience: number;
  volumeMusic: number;

  // ── Graphics ─────────────────────────────────────────────────────────────
  /** The last preset applied — 'custom' once any individual knob is moved. */
  quality: QualityPreset;
  shadows: boolean;
  shadowMapSize: number;
  maxPixelRatio: number;
  /** Grass coverage multiplier (0 = none). */
  grassDensity: number;
  /** How many chunks out grass is grown (it's dense — kept close). */
  grassRadius: number;
  /** Chunk view radius (render distance). */
  viewRadius: number;
  /** Post-processing master switch. */
  postFX: boolean;
  /** Ambient occlusion (GTAO) — contact shadows in creases and undergrowth. */
  ao: boolean;
  /** Anti-aliasing (SMAA). Off, every edge stair-steps and the foliage shimmers. */
  antialias: boolean;
  /** Bloom strength (0 = off). */
  bloom: number;
  /** Vignette darkness (0 = off). */
  vignette: number;
  /** Colour-grade saturation (1 = neutral). */
  saturation: number;
  /**
   * Exposure bias, in stops. 0 = the tuned default; negative darkens.
   *
   * Displays differ enough (and taste differs enough) that a single baked-in
   * exposure cannot be right for everyone — this is the standard camera control,
   * and it ends the argument.
   */
  exposure: number;
  fov: number;

  // ── Controls ─────────────────────────────────────────────────────────────
  mouseSensitivity: number;
  invertY: boolean;
  keybinds: Record<Action, string>;

  // ── Interface ────────────────────────────────────────────────────────────
  showHud: boolean;
  showStatus: boolean;
  showPerf: boolean;
  showCrosshair: boolean;
}

/** The graphics knobs a preset writes. */
type GraphicsPreset = Pick<
  Settings,
  | 'shadows'
  | 'shadowMapSize'
  | 'maxPixelRatio'
  | 'grassDensity'
  | 'grassRadius'
  | 'viewRadius'
  | 'postFX'
  | 'bloom'
  | 'vignette'
  | 'ao'
  | 'antialias'
>;

export const PRESETS: Record<Exclude<QualityPreset, 'custom'>, GraphicsPreset> = {
  low:    { shadows: false, shadowMapSize: 1024, maxPixelRatio: 1,    grassDensity: 0,    grassRadius: 0, viewRadius: 3, postFX: false, bloom: 0,    vignette: 0,   ao: false, antialias: false },
  medium: { shadows: true,  shadowMapSize: 1024, maxPixelRatio: 1.25, grassDensity: 0.55, grassRadius: 1, viewRadius: 4, postFX: true,  bloom: 0.2,  vignette: 0.9, ao: false, antialias: true },
  high:   { shadows: true,  shadowMapSize: 2048, maxPixelRatio: 1.5,  grassDensity: 1,    grassRadius: 1, viewRadius: 5, postFX: true,  bloom: 0.3,  vignette: 1.1, ao: true,  antialias: true },
  ultra:  { shadows: true,  shadowMapSize: 4096, maxPixelRatio: 2,    grassDensity: 1.3,  grassRadius: 2, viewRadius: 7, postFX: true,  bloom: 0.35, vignette: 1.1, ao: true,  antialias: true },
};

export const DEFAULT_SETTINGS: Settings = {
  volumeMaster: 0.7,
  volumeEffects: 1,
  volumeAmbience: 0.8,
  volumeMusic: 0.6,

  quality: 'high',
  ...PRESETS.high,
  saturation: 1.28,
  exposure: 0,
  fov: 70,

  mouseSensitivity: 1,
  invertY: false,
  keybinds: { ...DEFAULT_KEYBINDS },

  showHud: true,
  showStatus: true,
  showPerf: false,
  showCrosshair: true,
};

/** Write a preset's knobs into the live settings. */
export function applyPreset(p: Exclude<QualityPreset, 'custom'>): void {
  Object.assign(settings, PRESETS[p]);
  settings.quality = p;
}

/**
 * The active graphics config. Reads straight from the individual knobs, so a
 * slider the player moved is honoured even though the preset chip still says
 * "High" — the preset is a starting point, not a lock.
 */
export function quality(): GraphicsPreset {
  return {
    shadows: settings.shadows,
    shadowMapSize: settings.shadowMapSize,
    maxPixelRatio: settings.maxPixelRatio,
    grassDensity: settings.grassDensity,
    grassRadius: settings.grassRadius,
    viewRadius: settings.viewRadius,
    postFX: settings.postFX,
    bloom: settings.bloom,
    vignette: settings.vignette,
    ao: settings.ao,
    antialias: settings.antialias,
  };
}

/** Resolve a rebindable action to its current key code. */
export function keyFor(action: Action): string {
  return settings.keybinds[action] ?? DEFAULT_KEYBINDS[action];
}

const KEY = 'wyrdwood-settings-v2';

/** The live settings object — mutated by the settings UI, read by systems. */
export const settings: Settings = loadSettings();

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      return {
        ...DEFAULT_SETTINGS,
        ...saved,
        // Merge keybinds rather than replacing them, so a new action added in a
        // later version still gets its default instead of coming back undefined.
        keybinds: { ...DEFAULT_KEYBINDS, ...(saved.keybinds ?? {}) },
      };
    }
  } catch {
    /* ignore corrupt settings */
  }
  return { ...DEFAULT_SETTINGS, keybinds: { ...DEFAULT_KEYBINDS } };
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage full — ignore */
  }
}

/** Listeners notified when settings change (audio buses, renderer, chunks). */
const listeners = new Set<() => void>();
export function onSettingsChange(fn: () => void): void {
  listeners.add(fn);
}
export function notifySettingsChanged(): void {
  saveSettings();
  for (const fn of listeners) fn();
}
