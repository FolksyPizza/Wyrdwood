import { itemDef } from '../data/items';

export interface ItemStack {
  itemId: string;
  count: number;
}

export const HOTBAR_SIZE = 8;
export const INVENTORY_SIZE = 32; // includes the hotbar (first 8 slots)

/**
 * Grid inventory. Slots [0, HOTBAR_SIZE) are the hotbar.
 * Emits `onChange` so UI can re-render without polling.
 */
export class Inventory {
  slots: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);
  activeSlot = 0;
  onChange: (() => void) | null = null;

  private changed(): void {
    this.onChange?.();
  }

  /** Add items, filling existing stacks first. Returns count that didn't fit. */
  add(itemId: string, count: number): number {
    const max = itemDef(itemId).stackSize;
    let remaining = count;
    // Top up existing stacks.
    for (const stack of this.slots) {
      if (remaining <= 0) break;
      if (stack && stack.itemId === itemId && stack.count < max) {
        const take = Math.min(max - stack.count, remaining);
        stack.count += take;
        remaining -= take;
      }
    }
    // Then empty slots.
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(max, remaining);
        this.slots[i] = { itemId, count: take };
        remaining -= take;
      }
    }
    if (remaining !== count) this.changed();
    return remaining;
  }

  /** Total count of an item across all slots. */
  count(itemId: string): number {
    return this.slots.reduce((n, s) => n + (s?.itemId === itemId ? s.count : 0), 0);
  }

  /** Remove up to `count`; returns how many were actually removed. */
  remove(itemId: string, count: number): number {
    let remaining = count;
    for (let i = this.slots.length - 1; i >= 0 && remaining > 0; i--) {
      const s = this.slots[i];
      if (s && s.itemId === itemId) {
        const take = Math.min(s.count, remaining);
        s.count -= take;
        remaining -= take;
        if (s.count === 0) this.slots[i] = null;
      }
    }
    if (remaining !== count) this.changed();
    return count - remaining;
  }

  get active(): ItemStack | null {
    return this.slots[this.activeSlot] ?? null;
  }

  setActiveSlot(i: number): void {
    if (i >= 0 && i < HOTBAR_SIZE && i !== this.activeSlot) {
      this.activeSlot = i;
      this.changed();
    }
  }

  /** Consume one item from a slot (eating). Returns the item id or null. */
  consumeOne(slot: number): string | null {
    const s = this.slots[slot];
    if (!s) return null;
    const id = s.itemId;
    s.count--;
    if (s.count === 0) this.slots[slot] = null;
    this.changed();
    return id;
  }

  swap(a: number, b: number): void {
    const tmp = this.slots[a] ?? null;
    this.slots[a] = this.slots[b] ?? null;
    this.slots[b] = tmp;
    this.changed();
  }
}
