import type { PlayerStats } from '../player/stats';
import type { Inventory } from '../items/inventory';
import { HOTBAR_SIZE } from '../items/inventory';
import { itemDef } from '../data/items';

/**
 * In-game HUD: vitals (bottom-left), hotbar (bottom-centre), crosshair, interact
 * prompt, feedback line, death overlay. Pure DOM overlay.
 *
 * Design notes — the old HUD was five flat rectangles with a text label inside,
 * which is the fastest way to make a game look unfinished. What sells a survival
 * HUD as *made* rather than *generated*:
 *
 *  - Material. Nothing here is a flat fill: the frames are dark iron with a
 *    bevel (a light inner edge on top, a dark one below), the fills are
 *    gradients with a specular streak across the upper half, and everything sits
 *    on a leather-brown plate rather than floating on the scene.
 *  - Icons, not labels. A heart reads instantly; the word "HP" has to be read.
 *    These are inline SVG so they stay crisp at any DPI (emoji would render as a
 *    different picture on every platform).
 *  - Feedback. Vitals pulse red when they drop below a fifth, so the player
 *    notices starving before it kills them.
 */

/** Inline SVG glyphs — one per vital. Crisp at any DPI, styled by currentColor. */
const ICONS: Record<string, string> = {
  health: `<path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0 1 12 6.6 5.3 5.3 0 0 1 21.3 12c-1.8 4.3-9.3 9-9.3 9z"/>`,
  stamina: `<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/>`,
  hunger: `<path d="M7 3v8a3 3 0 0 0 2 2.8V21h2v-7.2A3 3 0 0 0 13 11V3h-1.5v6H10.5V3H9v6H7.5V3H7zM17.5 3C16 3 15 6 15 9.5c0 2 .6 3.2 1.5 3.8V21h2V3h-1z"/>`,
  thirst: `<path d="M12 2.5S5.5 9.7 5.5 14a6.5 6.5 0 0 0 13 0c0-4.3-6.5-11.5-6.5-11.5z"/>`,
  warmth: `<path d="M12 2c1 3-2 4-2 7a4 4 0 0 0 1.2 2.8C10 12 9 11 8.5 9.5 7 11 6 13 6 15a6 6 0 0 0 12 0c0-5-6-6-6-13z"/>`,
};

interface VitalDef {
  key: string;
  label: string;
  from: string;
  to: string;
}

const VITALS: VitalDef[] = [
  { key: 'health', label: 'Health', from: '#8e1f22', to: '#e0524f' },
  { key: 'stamina', label: 'Stamina', from: '#8a6c15', to: '#ecd268' },
  { key: 'hunger', label: 'Food', from: '#7a3f14', to: '#e0913f' },
  { key: 'thirst', label: 'Water', from: '#1c5375', to: '#54aee2' },
  { key: 'warmth', label: 'Warmth', from: '#7a2d4e', to: '#dc7fae' },
];

export class Hud {
  private root = document.createElement('div');
  private fills = new Map<string, HTMLElement>();
  private gauges = new Map<string, HTMLElement>();
  private hotbarSlots: HTMLDivElement[] = [];
  private prompt = document.createElement('div');
  private feedback = document.createElement('div');
  private death = document.createElement('div');

  constructor(
    private stats: PlayerStats,
    private inventory: Inventory,
  ) {
    this.root.id = 'hud';
    this.root.innerHTML = `<style>
      #hud { position: fixed; inset: 0; pointer-events: none; z-index: 10;
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif; }

      /* ── Vitals ─────────────────────────────────────────────────────── */
      #hud .vitals { position: absolute; left: 18px; bottom: 18px; display: flex;
        flex-direction: column; gap: 7px; padding: 12px 14px 12px 12px;
        background: linear-gradient(160deg, rgba(38,30,22,0.82), rgba(18,15,12,0.86));
        border: 1px solid rgba(0,0,0,0.6);
        border-radius: 10px;
        box-shadow: inset 0 1px 0 rgba(220,190,140,0.14), 0 6px 22px rgba(0,0,0,0.5);
      }
      #hud .vital { display: flex; align-items: center; gap: 9px; }

      /* Icon medallion: a struck-metal disc, not a flat square. */
      #hud .medallion { width: 24px; height: 24px; flex: 0 0 24px; border-radius: 50%;
        display: grid; place-items: center;
        background: radial-gradient(circle at 35% 30%, #4b453c, #211e1a 70%);
        box-shadow: inset 0 1px 0 rgba(226,199,150,0.28), inset 0 -2px 3px rgba(0,0,0,0.7),
                    0 1px 2px rgba(0,0,0,0.6);
        border: 1px solid rgba(0,0,0,0.7); }
      #hud .medallion svg { width: 14px; height: 14px; display: block;
        filter: drop-shadow(0 1px 0 rgba(0,0,0,0.55)); }

      /* Gauge: recessed iron channel with a bevelled lip. */
      #hud .gauge { position: relative; width: 168px; height: 14px; border-radius: 7px;
        background: linear-gradient(180deg, #0d0c0a, #1d1a16);
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.85), inset 0 -1px 0 rgba(210,180,130,0.1);
        border: 1px solid rgba(0,0,0,0.75); overflow: hidden; }
      #hud .gauge > .fill { position: absolute; inset: 1px; border-radius: 6px;
        transform-origin: left; transform: scaleX(1);
        transition: transform 0.25s ease-out; }
      /* Specular streak across the top half — what makes a fill look like a
         volume of liquid/metal instead of a coloured rectangle. */
      #hud .gauge > .fill::after { content: ''; position: absolute; inset: 0 0 45% 0;
        border-radius: 6px 6px 3px 3px;
        background: linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0.03)); }
      /* Tick marks, so the bar has a readable scale. */
      #hud .gauge > .ticks { position: absolute; inset: 0; pointer-events: none;
        background: repeating-linear-gradient(90deg,
          rgba(0,0,0,0) 0 24px, rgba(0,0,0,0.4) 24px 25px); }
      #hud .gauge > .val { position: absolute; right: 6px; top: 0; line-height: 14px;
        font-size: 9px; font-family: ui-monospace, monospace; letter-spacing: 0.5px;
        color: rgba(255,244,224,0.75); text-shadow: 0 1px 2px rgba(0,0,0,0.9); }

      #hud .vital.low .medallion { animation: hud-pulse 1s ease-in-out infinite; }
      @keyframes hud-pulse {
        0%,100% { box-shadow: inset 0 1px 0 rgba(226,199,150,0.28), 0 0 0 rgba(210,60,50,0); }
        50%     { box-shadow: inset 0 1px 0 rgba(226,199,150,0.28), 0 0 9px rgba(224,82,79,0.9); }
      }

      /* ── Hotbar ─────────────────────────────────────────────────────── */
      #hud .hotbar { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
        display: flex; gap: 6px; padding: 7px;
        background: linear-gradient(160deg, rgba(38,30,22,0.8), rgba(18,15,12,0.85));
        border: 1px solid rgba(0,0,0,0.6); border-radius: 10px;
        box-shadow: inset 0 1px 0 rgba(220,190,140,0.13), 0 6px 22px rgba(0,0,0,0.5); }
      #hud .slot { width: 50px; height: 50px; border-radius: 7px; position: relative;
        display: grid; place-items: center; font-size: 24px;
        background: radial-gradient(circle at 40% 30%, #37312a, #1a1714 75%);
        border: 1px solid rgba(0,0,0,0.75);
        box-shadow: inset 0 1px 0 rgba(222,193,146,0.16), inset 0 -3px 6px rgba(0,0,0,0.55);
        transition: transform 0.08s, box-shadow 0.12s; }
      /* Selected slot: lit from within and lifted, rather than just recoloured. */
      #hud .slot.active { transform: translateY(-3px);
        border-color: #b99247;
        box-shadow: inset 0 1px 0 rgba(255,224,164,0.35), 0 0 0 1px rgba(201,161,84,0.55),
                    0 0 14px rgba(214,168,74,0.45), 0 5px 10px rgba(0,0,0,0.55); }
      #hud .slot .count { position: absolute; right: 4px; bottom: 2px; font-size: 11px;
        font-family: ui-monospace, monospace; color: #f3e7cf;
        text-shadow: 0 1px 2px #000, 0 0 3px #000; }
      #hud .slot .key { position: absolute; left: 5px; top: 2px; font-size: 9px;
        font-family: ui-monospace, monospace; color: rgba(226,199,150,0.45); }

      /* ── Reticle / prompts ──────────────────────────────────────────── */
      #hud .crosshair { position: absolute; left: 50%; top: 50%; width: 5px; height: 5px;
        margin: -2.5px; border-radius: 50%;
        background: rgba(255,250,240,0.9);
        box-shadow: 0 0 0 1px rgba(0,0,0,0.55), 0 0 6px rgba(0,0,0,0.8); }
      #hud .prompt { position: absolute; left: 50%; top: 55%; transform: translateX(-50%);
        color: #f6ecd8; font-size: 15px; letter-spacing: 0.3px;
        padding: 5px 14px; border-radius: 7px;
        background: linear-gradient(160deg, rgba(34,28,20,0.86), rgba(16,13,10,0.9));
        border: 1px solid rgba(0,0,0,0.65);
        box-shadow: inset 0 1px 0 rgba(220,190,140,0.16), 0 3px 12px rgba(0,0,0,0.5); }
      #hud .prompt b { color: #e8c96a; font-weight: 700; }
      #hud .feedback { position: absolute; left: 50%; top: 62%; transform: translateX(-50%);
        color: #ffe9a8; font-size: 14px; text-shadow: 0 1px 3px #000, 0 0 8px rgba(0,0,0,0.7); }

      /* ── Death ──────────────────────────────────────────────────────── */
      #hud .death { position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; color: #f0e2c8;
        background: radial-gradient(ellipse at 50% 45%, rgba(70,8,8,0.55), rgba(8,4,4,0.9)); }
      #hud .death h1 { font-size: 46px; margin: 0 0 12px; letter-spacing: 8px;
        color: #d9c39a; text-shadow: 0 4px 24px rgba(0,0,0,0.9); }
      #hud .death div { letter-spacing: 2px; font-size: 13px; text-transform: uppercase;
        color: rgba(240,226,200,0.6); }
    </style>`;

    // ── Vitals ────────────────────────────────────────────────────────────
    const vitals = document.createElement('div');
    vitals.className = 'vitals';
    for (const v of VITALS) {
      const row = document.createElement('div');
      row.className = 'vital';

      const med = document.createElement('div');
      med.className = 'medallion';
      med.innerHTML = `<svg viewBox="0 0 24 24" fill="${v.to}">${ICONS[v.key]}</svg>`;

      const gauge = document.createElement('div');
      gauge.className = 'gauge';
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.background = `linear-gradient(180deg, ${v.to}, ${v.from})`;
      const ticks = document.createElement('div');
      ticks.className = 'ticks';
      const val = document.createElement('div');
      val.className = 'val';
      gauge.append(fill, ticks, val);

      row.append(med, gauge);
      row.title = v.label;
      vitals.appendChild(row);

      this.fills.set(v.key, fill);
      this.gauges.set(v.key, row);
      this.values.set(v.key, val);
    }
    this.root.appendChild(vitals);

    // ── Hotbar ────────────────────────────────────────────────────────────
    const hotbar = document.createElement('div');
    hotbar.className = 'hotbar';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      hotbar.appendChild(slot);
      this.hotbarSlots.push(slot);
    }
    this.root.appendChild(hotbar);

    const cross = document.createElement('div');
    cross.className = 'crosshair';
    this.prompt.className = 'prompt';
    this.feedback.className = 'feedback';
    this.death.className = 'death';
    this.death.innerHTML = '<h1>YOU DIED</h1><div>Press R to respawn</div>';
    this.death.style.display = 'none';
    this.root.append(cross, this.prompt, this.feedback, this.death);

    document.body.appendChild(this.root);
    inventory.onChange = () => this.renderHotbar();
    this.renderHotbar();
  }

  private values = new Map<string, HTMLElement>();

  private renderHotbar(): void {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = this.hotbarSlots[i]!;
      const stack = this.inventory.slots[i];
      slot.classList.toggle('active', i === this.inventory.activeSlot);
      slot.innerHTML = `<span class="key">${i + 1}</span>`;
      if (stack) {
        const def = itemDef(stack.itemId);
        slot.innerHTML += `${def.icon}<span class="count">${stack.count}</span>`;
        slot.title = def.name;
      }
    }
  }

  /** Per-frame refresh of vitals/prompt/feedback. */
  update(promptText: string, feedbackText: string): void {
    const s = this.stats;
    const vals: [string, number][] = [
      ['health', s.health / s.maxHealth],
      ['stamina', s.stamina / s.maxStamina],
      ['hunger', s.hunger / 100],
      ['thirst', s.thirst / 100],
      ['warmth', s.warmth / 100],
    ];
    for (const [key, v] of vals) {
      const clamped = Math.max(0, Math.min(1, v));
      this.fills.get(key)!.style.transform = `scaleX(${clamped})`;
      this.values.get(key)!.textContent = String(Math.round(clamped * 100));
      // Below a fifth, the medallion pulses — you should feel a vital failing
      // without having to read a number.
      this.gauges.get(key)!.classList.toggle('low', clamped < 0.2);
    }
    this.prompt.innerHTML = promptText;
    this.prompt.style.display = promptText ? 'block' : 'none';
    this.feedback.textContent = feedbackText;
    this.death.style.display = s.dead ? 'flex' : 'none';
  }
}
