import type { ToolKind } from './items';

/** What scattered world objects yield when harvested. Tools cut hit counts. */

export interface HarvestDrop {
  itemId: string;
  count: number;
  /** Probability [0,1] this drop appears (default 1). */
  chance?: number;
}

export interface HarvestDef {
  /** Hits required by hand. */
  hits: number;
  /** Matching tool kind and its (lower) hit count. */
  tool?: { kind: ToolKind; hits: number };
  drops: HarvestDrop[];
  /** Verb shown in the interact prompt. */
  verb: string;
}

export type HarvestType =
  | 'tree'
  | 'pine'
  | 'dandelion'
  | 'daisy'
  | 'rock'
  | 'bush'
  | 'flower'
  | 'mushroom'
  | 'herb'
  | 'fern'
  | 'stick'
  | 'pebble'
  | 'log';

export const HARVEST: Record<HarvestType, HarvestDef> = {
  tree: {
    hits: 6,
    tool: { kind: 'axe', hits: 2 },
    // Resin is tree sap — its main source, so the beacon is reachable even on
    // Peaceful worlds where hostile (resin-dropping) greylings never spawn.
    drops: [
      { itemId: 'wood', count: 4 },
      { itemId: 'resin', count: 1, chance: 0.35 },
    ],
    verb: 'Chop',
  },
  // Conifer: more wood, more resin, and it takes longer to fell.
  pine: {
    hits: 8,
    tool: { kind: 'axe', hits: 3 },
    drops: [
      { itemId: 'wood', count: 5 },
      { itemId: 'resin', count: 1, chance: 0.6 },
    ],
    verb: 'Chop',
  },
  rock: {
    hits: 6,
    tool: { kind: 'pickaxe', hits: 2 },
    drops: [{ itemId: 'stone', count: 3 }],
    verb: 'Mine',
  },
  bush: { hits: 1, drops: [{ itemId: 'berries', count: 3 }], verb: 'Pick' },
  flower: { hits: 1, drops: [{ itemId: 'flower', count: 1 }], verb: 'Pick' },
  mushroom: { hits: 1, drops: [{ itemId: 'mushroom', count: 2 }], verb: 'Gather' },
  herb: { hits: 1, drops: [{ itemId: 'herb', count: 2 }], verb: 'Gather' },
  fern: { hits: 1, drops: [{ itemId: 'herb', count: 1 }], verb: 'Gather' },
  dandelion: { hits: 1, drops: [{ itemId: 'herb', count: 1 }], verb: 'Pick' },
  daisy: { hits: 1, drops: [{ itemId: 'herb', count: 1 }], verb: 'Pick' },

  // Ground clutter: free, instant, no tool. This is the bootstrap — you need
  // wood and stone to make the axe and pick that let you take wood and stone
  // from trees and boulders, so the first of each has to come from the floor.
  stick: { hits: 1, drops: [{ itemId: 'wood', count: 1 }], verb: 'Pick up' },
  pebble: { hits: 1, drops: [{ itemId: 'stone', count: 1 }], verb: 'Pick up' },
  log: {
    hits: 3,
    tool: { kind: 'axe', hits: 1 },
    drops: [{ itemId: 'wood', count: 5 }],
    verb: 'Break',
  },
};
