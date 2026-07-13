import { Inventory, INVENTORY_SIZE, HOTBAR_SIZE } from '../items/inventory';
import { itemDef } from '../data/items';

/**
 * Inventory screen (toggle with Tab/I). Click one slot then another to swap.
 * First row is the hotbar.
 */
export class InventoryScreen {
  private root = document.createElement('div');
  private grid = document.createElement('div');
  private selected: number | null = null;
  visible = false;

  constructor(private inventory: Inventory) {
    this.root.innerHTML = `<style>
      .inv-screen { position: fixed; inset: 0; background: rgba(8,10,14,0.72); display: flex; align-items: center; justify-content: center; z-index: 20; font-family: system-ui, sans-serif; }
      .inv-panel { background: rgba(24,28,34,0.95); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 20px 24px; }
      .inv-panel h2 { color: #e8d9b0; margin: 0 0 14px; font-size: 18px; letter-spacing: 1px; }
      .inv-grid { display: grid; grid-template-columns: repeat(8, 52px); gap: 6px; }
      .inv-slot { width: 52px; height: 52px; background: rgba(10,14,18,0.7); border: 2px solid rgba(255,255,255,0.14); border-radius: 8px; position: relative; display: flex; align-items: center; justify-content: center; font-size: 24px; cursor: pointer; }
      .inv-slot:hover { border-color: rgba(255,255,255,0.4); }
      .inv-slot.selected { border-color: #ffd97a; }
      .inv-slot.hotbar-slot { background: rgba(30,34,24,0.75); }
      .inv-slot .count { position: absolute; right: 4px; bottom: 2px; font-size: 12px; color: #fff; text-shadow: 0 1px 2px #000; }
      .inv-hint { color: rgba(255,255,255,0.45); font-size: 12px; margin-top: 12px; }
    </style>`;
    const screen = document.createElement('div');
    screen.className = 'inv-screen';
    const panel = document.createElement('div');
    panel.className = 'inv-panel';
    panel.innerHTML = '<h2>Inventory</h2>';
    this.grid.className = 'inv-grid';
    panel.appendChild(this.grid);
    const hint = document.createElement('div');
    hint.className = 'inv-hint';
    hint.textContent = 'Top row = hotbar · click two slots to swap · Tab to close · F to eat held food';
    panel.appendChild(hint);
    screen.appendChild(panel);
    this.root.appendChild(screen);
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
    this.selected = null;
    if (this.visible) this.render();
    if (this.visible && document.pointerLockElement) document.exitPointerLock();
  }

  private render(): void {
    this.grid.innerHTML = '';
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot' + (i < HOTBAR_SIZE ? ' hotbar-slot' : '');
      if (i === this.selected) slot.classList.add('selected');
      const stack = this.inventory.slots[i];
      if (stack) {
        const def = itemDef(stack.itemId);
        slot.innerHTML = `${def.icon}<span class="count">${stack.count}</span>`;
        slot.title = def.name;
      }
      slot.addEventListener('click', () => {
        if (this.selected === null) {
          if (this.inventory.slots[i]) {
            this.selected = i;
            this.render();
          }
        } else {
          this.inventory.swap(this.selected, i);
          this.selected = null;
          this.render();
        }
      });
      this.grid.appendChild(slot);
    }
  }
}
