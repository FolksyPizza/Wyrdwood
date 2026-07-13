import type { PieceKind } from './pieces';

/**
 * Blueprints — pre-authored structures placed in one action (Aska-style).
 * Offsets are in grid cells relative to the blueprint anchor; the same piece
 * pipeline builds them, so freeform and template building stay unified.
 */

export interface BlueprintPiece {
  kind: PieceKind;
  dx: number;
  dz: number;
  level: number;
  dir: 0 | 1 | 2 | 3;
}

export interface Blueprint {
  id: string;
  name: string;
  icon: string;
  pieces: BlueprintPiece[];
}

/** 2×2 hut: foundations, walls all around with a door, flat roof. */
const hut: Blueprint = {
  id: 'hut',
  name: 'Hut',
  icon: '🛖',
  pieces: [
    // Foundations 2×2.
    { kind: 'foundation', dx: 0, dz: 0, level: 0, dir: 0 },
    { kind: 'foundation', dx: 1, dz: 0, level: 0, dir: 0 },
    { kind: 'foundation', dx: 0, dz: 1, level: 0, dir: 0 },
    { kind: 'foundation', dx: 1, dz: 1, level: 0, dir: 0 },
    // North edge (dz=0, dir 0) — door on one cell.
    { kind: 'door', dx: 0, dz: 0, level: 0, dir: 0 },
    { kind: 'wall', dx: 1, dz: 0, level: 0, dir: 0 },
    // South edge.
    { kind: 'wall', dx: 0, dz: 1, level: 0, dir: 2 },
    { kind: 'wall', dx: 1, dz: 1, level: 0, dir: 2 },
    // West edge.
    { kind: 'wall', dx: 0, dz: 0, level: 0, dir: 3 },
    { kind: 'wall', dx: 0, dz: 1, level: 0, dir: 3 },
    // East edge.
    { kind: 'wall', dx: 1, dz: 0, level: 0, dir: 1 },
    { kind: 'wall', dx: 1, dz: 1, level: 0, dir: 1 },
    // Roof.
    { kind: 'roof', dx: 0, dz: 0, level: 1, dir: 0 },
    { kind: 'roof', dx: 1, dz: 0, level: 1, dir: 0 },
    { kind: 'roof', dx: 0, dz: 1, level: 1, dir: 0 },
    { kind: 'roof', dx: 1, dz: 1, level: 1, dir: 0 },
  ],
};

/** Straight 4-cell fence line (walls on north edges). */
const fence: Blueprint = {
  id: 'fence',
  name: 'Fence',
  icon: '🚧',
  pieces: [0, 1, 2, 3].map((i) => ({ kind: 'wall' as PieceKind, dx: i, dz: 0, level: 0, dir: 0 })),
};

/** 3×2 cabin with door + flat roof. */
const cabin: Blueprint = {
  id: 'cabin',
  name: 'Cabin',
  icon: '🏡',
  pieces: [
    ...[0, 1, 2].flatMap((dx) =>
      [0, 1].map((dz) => ({ kind: 'foundation' as PieceKind, dx, dz, level: 0, dir: 0 as const })),
    ),
    { kind: 'wall', dx: 0, dz: 0, level: 0, dir: 0 },
    { kind: 'door', dx: 1, dz: 0, level: 0, dir: 0 },
    { kind: 'wall', dx: 2, dz: 0, level: 0, dir: 0 },
    { kind: 'wall', dx: 0, dz: 1, level: 0, dir: 2 },
    { kind: 'wall', dx: 1, dz: 1, level: 0, dir: 2 },
    { kind: 'wall', dx: 2, dz: 1, level: 0, dir: 2 },
    { kind: 'wall', dx: 0, dz: 0, level: 0, dir: 3 },
    { kind: 'wall', dx: 0, dz: 1, level: 0, dir: 3 },
    { kind: 'wall', dx: 2, dz: 0, level: 0, dir: 1 },
    { kind: 'wall', dx: 2, dz: 1, level: 0, dir: 1 },
    ...[0, 1, 2].flatMap((dx) =>
      [0, 1].map((dz) => ({ kind: 'roof' as PieceKind, dx, dz, level: 1, dir: 0 as const })),
    ),
  ],
};

export const BLUEPRINTS: Blueprint[] = [hut, cabin, fence];
