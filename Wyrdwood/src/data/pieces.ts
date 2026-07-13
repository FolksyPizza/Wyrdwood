/** Build pieces — data-driven. The build grid module is 2m; walls are 2m tall. */

export const GRID = 2;
export const WALL_H = 2;

export type PieceKind = 'foundation' | 'floor' | 'wall' | 'door' | 'roof';

export interface PieceDef {
  kind: PieceKind;
  name: string;
  icon: string;
  cost: { itemId: string; count: number }[];
}

export const PIECES: Record<PieceKind, PieceDef> = {
  foundation: {
    kind: 'foundation',
    name: 'Foundation',
    icon: '🟫',
    cost: [{ itemId: 'wood', count: 2 }],
  },
  floor: { kind: 'floor', name: 'Floor', icon: '🟧', cost: [{ itemId: 'wood', count: 1 }] },
  wall: { kind: 'wall', name: 'Wall', icon: '🧱', cost: [{ itemId: 'wood', count: 2 }] },
  door: { kind: 'door', name: 'Doorway', icon: '🚪', cost: [{ itemId: 'wood', count: 3 }] },
  roof: { kind: 'roof', name: 'Roof', icon: '⛺', cost: [{ itemId: 'wood', count: 2 }] },
};

/**
 * A placed piece, in grid coordinates (serializable).
 * Cell pieces (foundation/floor/roof): gx,gz = cell, level = storey.
 * Edge pieces (wall/door): edge of cell (gx,gz) facing `dir`
 *   (0 = N = -z edge, 1 = E = +x edge, 2 = S = +z edge, 3 = W = -x edge).
 */
export interface PlacedPiece {
  kind: PieceKind;
  gx: number;
  gz: number;
  level: number;
  dir: 0 | 1 | 2 | 3;
  /** World y of the piece's base (foundations follow terrain). */
  baseY: number;
}
