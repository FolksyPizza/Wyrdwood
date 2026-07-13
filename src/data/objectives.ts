/**
 * Objective chain — the "point of the game". Each objective's completion is
 * checked against a GameProbe snapshot; finishing the chain wins the world
 * (then sandbox continues). Data-driven so chapters can be added.
 */

export interface GameProbe {
  itemCount: (itemId: string) => number;
  placedCount: (kind: string) => number;
  buildingPieces: number;
  kills: number;
  craftedIds: Set<string>;
  survivedNight: boolean;
  beaconLit: boolean;
  level: number;
}

export interface Objective {
  id: string;
  title: string;
  hint: string;
  xp: number;
  done: (probe: GameProbe) => boolean;
}

export const OBJECTIVES: Objective[] = [
  {
    id: 'gather-wood',
    title: 'Gather 10 wood',
    hint: 'Hold E on a tree to chop it',
    xp: 20,
    done: (p) => p.itemCount('wood') >= 10,
  },
  {
    id: 'workbench',
    title: 'Craft and place a workbench',
    hint: 'Craft (C), then right-click with it held',
    xp: 30,
    done: (p) => p.placedCount('workbench') >= 1,
  },
  {
    id: 'tools',
    title: 'Craft a stone axe',
    hint: 'Stand near your workbench and craft (C)',
    xp: 30,
    done: (p) => p.craftedIds.has('stone_axe'),
  },
  {
    id: 'campfire',
    title: 'Place a campfire',
    hint: 'Fire keeps you warm at night',
    xp: 25,
    done: (p) => p.placedCount('campfire') >= 1,
  },
  {
    id: 'shelter',
    title: 'Build a shelter (8+ pieces)',
    hint: 'Open the build menu (B) — try the Hut blueprint',
    xp: 50,
    done: (p) => p.buildingPieces >= 8,
  },
  {
    id: 'survive-night',
    title: 'Survive a night',
    hint: 'Stay warm, fed, and alive until morning',
    xp: 50,
    done: (p) => p.survivedNight,
  },
  {
    id: 'hunt',
    title: 'Slay 3 creatures',
    hint: 'Craft a club or axe and fight (LMB)',
    xp: 60,
    done: (p) => p.kills >= 3,
  },
  {
    id: 'beacon',
    title: 'Build and light the Wyrd Beacon',
    hint: 'Craft the beacon (needs resin from trees), place it, then light it (E)',
    xp: 150,
    done: (p) => p.beaconLit,
  },
];
