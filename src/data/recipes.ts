/** Crafting recipes — data-driven. `station` gates recipes to a nearby placed object. */

export interface Recipe {
  id: string;
  output: string;
  count: number;
  ingredients: { itemId: string; count: number }[];
  /** Required nearby station (within STATION_RANGE), or none for hand-crafting. */
  station?: 'workbench';
}

export const STATION_RANGE = 4;

export const RECIPES: Recipe[] = [
  {
    id: 'club',
    output: 'club',
    count: 1,
    ingredients: [{ itemId: 'wood', count: 5 }],
  },
  {
    id: 'workbench',
    output: 'workbench',
    count: 1,
    ingredients: [{ itemId: 'wood', count: 10 }],
  },
  {
    id: 'campfire',
    output: 'campfire',
    count: 1,
    ingredients: [
      { itemId: 'wood', count: 5 },
      { itemId: 'stone', count: 2 },
    ],
  },
  {
    id: 'stone_axe',
    output: 'stone_axe',
    count: 1,
    ingredients: [
      { itemId: 'wood', count: 3 },
      { itemId: 'stone', count: 2 },
    ],
    station: 'workbench',
  },
  {
    id: 'stone_pickaxe',
    output: 'stone_pickaxe',
    count: 1,
    ingredients: [
      { itemId: 'wood', count: 3 },
      { itemId: 'stone', count: 2 },
    ],
    station: 'workbench',
  },
  {
    id: 'beacon',
    output: 'beacon',
    count: 1,
    ingredients: [
      { itemId: 'wood', count: 20 },
      { itemId: 'stone', count: 10 },
      { itemId: 'resin', count: 4 },
    ],
    station: 'workbench',
  },
];
