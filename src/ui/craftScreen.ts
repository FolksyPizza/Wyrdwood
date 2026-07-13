import type { Crafting } from '../crafting/crafting';
import { itemDef } from '../data/items';

/**
 * Crafting screen (toggle with C). Lists recipes with have/need counts;
 * click to craft. Station-gated recipes show their requirement.
 */
export class CraftScreen {
  private root = document.createElement('div');
  private list = document.createElement('div');
  visible = false;
  /** Player position provider (for station checks at click time). */
  getPos: () => { x: number; z: number } = () => ({ x: 0, z: 0 });

  constructor(private crafting: Crafting) {
    this.root.innerHTML = `<style>
      .craft-screen { position: fixed; inset: 0; background: rgba(8,10,14,0.72); display: flex; align-items: center; justify-content: center; z-index: 20; font-family: system-ui, sans-serif; }
      .craft-panel { background: rgba(24,28,34,0.95); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 20px 24px; width: 440px; max-height: 70vh; overflow-y: auto; }
      .craft-panel h2 { color: #e8d9b0; margin: 0 0 14px; font-size: 18px; letter-spacing: 1px; }
      .recipe { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); margin-bottom: 8px; cursor: pointer; }
      .recipe:hover { background: rgba(255,255,255,0.05); }
      .recipe.disabled { opacity: 0.45; cursor: not-allowed; }
      .recipe .ricon { font-size: 28px; width: 40px; text-align: center; }
      .recipe .rname { color: #fff; font-size: 15px; font-weight: 600; }
      .recipe .rneeds { color: rgba(255,255,255,0.65); font-size: 12px; margin-top: 2px; }
      .recipe .rneeds .lack { color: #e08f8f; }
      .recipe .station-req { color: #e0c04a; font-size: 11px; margin-top: 2px; }
      .craft-hint { color: rgba(255,255,255,0.45); font-size: 12px; margin-top: 10px; }
    </style>`;
    const screen = document.createElement('div');
    screen.className = 'craft-screen';
    const panel = document.createElement('div');
    panel.className = 'craft-panel';
    panel.innerHTML = '<h2>Crafting</h2>';
    panel.appendChild(this.list);
    const hint = document.createElement('div');
    hint.className = 'craft-hint';
    hint.textContent = 'Click a recipe to craft · C to close · right-click in world to place held items';
    panel.appendChild(hint);
    screen.appendChild(panel);
    this.root.appendChild(screen);
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.render();
    if (this.visible && document.pointerLockElement) document.exitPointerLock();
  }

  render(): void {
    const { x, z } = this.getPos();
    this.list.innerHTML = '';
    for (const recipe of this.crafting.recipes) {
      const out = itemDef(recipe.output);
      const ok = this.crafting.canCraft(recipe, x, z);
      const stationOk = this.crafting.stationOk(recipe, x, z);
      const row = document.createElement('div');
      row.className = 'recipe' + (ok ? '' : ' disabled');
      const needs = recipe.ingredients
        .map((ing) => {
          const def = itemDef(ing.itemId);
          const have = this.crafting.count(ing.itemId);
          const lack = have < ing.count ? ' class="lack"' : '';
          return `<span${lack}>${def.icon}${have}/${ing.count}</span>`;
        })
        .join(' · ');
      row.innerHTML = `
        <div class="ricon">${out.icon}</div>
        <div>
          <div class="rname">${out.name}${recipe.count > 1 ? ` ×${recipe.count}` : ''}</div>
          <div class="rneeds">${needs}</div>
          ${recipe.station && !stationOk ? `<div class="station-req">Requires ${recipe.station} nearby</div>` : ''}
        </div>`;
      row.addEventListener('click', () => {
        const pos = this.getPos();
        if (this.crafting.craft(recipe, pos.x, pos.z)) this.render();
      });
      this.list.appendChild(row);
    }
  }

}
