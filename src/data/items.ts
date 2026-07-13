/** Item definitions — data-driven. Icons are emoji for now (art pass later). */

export interface FoodEffect {
  hunger?: number;
  thirst?: number;
  health?: number;
}

export type ToolKind = 'axe' | 'pickaxe';
export type PlaceableKind = 'workbench' | 'campfire' | 'beacon';

export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  stackSize: number;
  food?: FoodEffect;
  /** Tool: speeds up matching harvests (fewer hits per object). */
  tool?: { kind: ToolKind };
  /** Weapon: melee damage when swung (LMB). */
  weapon?: {
    damage: number;
    knockback?: number;
    /**
     * Seconds the swing takes — which is also how long until you can swing
     * again. Heft is the whole trade: a club hits hard but leaves you exposed
     * while you recover, a knife is quick and weak. A single global cooldown
     * would flatten all of that into one weapon with different numbers on it.
     */
    swingTime: number;
  };
  /** Placeable: right-click places this object in the world. */
  placeable?: PlaceableKind;
}

export const ITEMS: Record<string, ItemDef> = {
  wood: { id: 'wood', name: 'Wood', icon: '🪵', stackSize: 50 },
  stone: { id: 'stone', name: 'Stone', icon: '🪨', stackSize: 50 },
  berries: {
    id: 'berries',
    name: 'Berries',
    icon: '🫐',
    stackSize: 20,
    food: { hunger: 12, thirst: 4 },
  },
  stone_axe: {
    id: 'stone_axe',
    name: 'Stone Axe',
    icon: '🪓',
    stackSize: 1,
    tool: { kind: 'axe' },
    weapon: { damage: 12, swingTime: 0.7 },
  },
  stone_pickaxe: {
    id: 'stone_pickaxe',
    name: 'Stone Pickaxe',
    icon: '⛏️',
    stackSize: 1,
    tool: { kind: 'pickaxe' },
    weapon: { damage: 9, swingTime: 0.8 },
  },
  club: {
    id: 'club',
    name: 'Wooden Club',
    icon: '🏏',
    stackSize: 1,
    weapon: { damage: 10, knockback: 1.5, swingTime: 0.85 }, // heavy, slow
  },
  meat: {
    id: 'meat',
    name: 'Raw Meat',
    icon: '🥩',
    stackSize: 20,
    food: { hunger: 18, health: 2 },
  },
  hide: { id: 'hide', name: 'Hide', icon: '🟤', stackSize: 20 },
  resin: { id: 'resin', name: 'Resin', icon: '🟡', stackSize: 30 },
  mushroom: {
    id: 'mushroom',
    name: 'Mushroom',
    icon: '🍄',
    stackSize: 20,
    food: { hunger: 8, health: 1 },
  },
  herb: { id: 'herb', name: 'Herb', icon: '🌿', stackSize: 20, food: { hunger: 3, thirst: 3 } },
  flower: { id: 'flower', name: 'Flower', icon: '🌼', stackSize: 20 },
  feathers: { id: 'feathers', name: 'Feathers', icon: '🪶', stackSize: 30 },
  workbench: {
    id: 'workbench',
    name: 'Workbench',
    icon: '🛠️',
    stackSize: 1,
    placeable: 'workbench',
  },
  campfire: {
    id: 'campfire',
    name: 'Campfire',
    icon: '🔥',
    stackSize: 1,
    placeable: 'campfire',
  },
  beacon: {
    id: 'beacon',
    name: 'Wyrd Beacon',
    icon: '🗼',
    stackSize: 1,
    placeable: 'beacon',
  },
};

export function itemDef(id: string): ItemDef {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item: ${id}`);
  return def;
}
