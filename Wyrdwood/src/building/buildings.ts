import * as THREE from 'three';
import type RAPIER_API from '@dimforge/rapier3d-compat';
import { Physics, RAPIER } from '../physics/physics';
import type { Terrain } from '../world/terrain';
import { GRID, WALL_H, type PieceKind, type PlacedPiece } from '../data/pieces';
import { structureMaterial } from '../render/assets';

// Real scanned surfaces: sawn planks for walls/floors, raw beams for framing,
// thatch for roofs. See render/assets.ts and scripts/fetch-assets.mjs.
const WOOD_MAT = structureMaterial('build/planks', 2);
const DARK_MAT = structureMaterial('build/beam', 3);
const ROOF_MAT = structureMaterial('build/thatch', 2);

/** Key for cell pieces (foundation/floor/roof). */
const cellKey = (kind: string, gx: number, level: number, gz: number): string =>
  `${kind}:${gx},${level},${gz}`;
/** Key for edge pieces (wall/door); normalized so a shared edge has one key. */
const edgeKey = (gx: number, level: number, gz: number, dir: number): string => {
  // Normalize: dir 2 (S of cell) == dir 0 (N of cell gz+1); dir 3 (W) == dir 1 (E of gx-1).
  if (dir === 2) return `edge:${gx},${level},${gz + 1},0`;
  if (dir === 3) return `edge:${gx - 1},${level},${gz},1`;
  return `edge:${gx},${level},${gz},${dir}`;
};

interface BuiltPiece {
  piece: PlacedPiece;
  mesh: THREE.Object3D;
  collider: RAPIER_API.Collider | null;
  /** Doors only: open state + the hinged panel. */
  doorPanel?: THREE.Object3D;
  open?: boolean;
}

/**
 * Placed build pieces on a 2m structural grid. Owns meshes/colliders,
 * support rules, overlap checks, and door toggling. Serializable via `pieces`.
 */
export class Buildings {
  private byKey = new Map<string, BuiltPiece>();

  constructor(
    private scene: THREE.Scene,
    private physics: Physics,
    private terrain: Terrain,
  ) {}

  get pieces(): PlacedPiece[] {
    return [...this.byKey.values()].map((b) => b.piece);
  }

  /** Placed meshes — for build-aim raycasts (so you can stack on floors). */
  get meshes(): THREE.Object3D[] {
    return [...this.byKey.values()].map((b) => b.mesh);
  }

  keyFor(p: { kind: PieceKind; gx: number; gz: number; level: number; dir: number }): string {
    return p.kind === 'wall' || p.kind === 'door'
      ? edgeKey(p.gx, p.level, p.gz, p.dir)
      : cellKey(p.kind === 'roof' ? 'top' : p.kind === 'floor' ? 'top' : 'cell', p.gx, p.level, p.gz);
  }

  occupied(p: { kind: PieceKind; gx: number; gz: number; level: number; dir: number }): boolean {
    return this.byKey.has(this.keyFor(p));
  }

  /** Base world-Y for a piece at a grid location (terrain-following foundations). */
  baseYFor(gx: number, gz: number, level: number): number {
    // Foundation top sits at max terrain corner height + small lip; storeys stack.
    const x0 = gx * GRID;
    const z0 = gz * GRID;
    const h = Math.max(
      this.terrain.height(x0, z0),
      this.terrain.height(x0 + GRID, z0),
      this.terrain.height(x0, z0 + GRID),
      this.terrain.height(x0 + GRID, z0 + GRID),
    );
    return h + 0.15 + level * WALL_H;
  }

  /** Support rule (lenient): what a piece needs below/adjacent to exist. */
  supported(p: { kind: PieceKind; gx: number; gz: number; level: number; dir: 0 | 1 | 2 | 3 }): boolean {
    const { kind, gx, gz, level, dir } = p;
    if (kind === 'foundation') {
      if (level !== 0) return false;
      // Terrain must be close enough under all corners (no floating/cliff spans).
      const base = this.baseYFor(gx, gz, 0);
      const x0 = gx * GRID;
      const z0 = gz * GRID;
      const minH = Math.min(
        this.terrain.height(x0, z0),
        this.terrain.height(x0 + GRID, z0),
        this.terrain.height(x0, z0 + GRID),
        this.terrain.height(x0 + GRID, z0 + GRID),
      );
      return base - minH < 1.6;
    }
    const hasCellBelow =
      this.byKey.has(cellKey('cell', gx, level, gz)) || // foundation this level
      this.byKey.has(cellKey('top', gx, level, gz)); // floor/roof at this level
    if (kind === 'wall' || kind === 'door') {
      // Needs a foundation/floor at its level in either adjacent cell, or a wall below.
      const nb = dir === 0 ? [gx, gz - 1] : dir === 1 ? [gx + 1, gz] : dir === 2 ? [gx, gz + 1] : [gx - 1, gz];
      const hasNeighborCell =
        this.byKey.has(cellKey('cell', nb[0]!, level, nb[1]!)) ||
        this.byKey.has(cellKey('top', nb[0]!, level, nb[1]!));
      const wallBelow = level > 0 && this.byKey.has(edgeKey(gx, level - 1, gz, dir));
      return hasCellBelow || hasNeighborCell || wallBelow;
    }
    // floor / roof at level L: needs a wall or door at level L-1 on any edge of the cell,
    // or an adjacent floor/roof (lets roofs span), or a foundation below (floor above foundation).
    if (level <= 0) return false;
    const anyWallBelow = ([0, 1, 2, 3] as const).some((d) =>
      this.byKey.has(edgeKey(gx, level - 1, gz, d)),
    );
    const adjacentTop = [
      [gx + 1, gz],
      [gx - 1, gz],
      [gx, gz + 1],
      [gx, gz - 1],
    ].some(([ax, az]) => this.byKey.has(cellKey('top', ax!, level, az!)));
    return anyWallBelow || adjacentTop;
  }

  /** Place a piece (assumes validity was checked). Returns the stored record. */
  place(piece: PlacedPiece): void {
    const key = this.keyFor(piece);
    if (this.byKey.has(key)) return;
    const built = this.buildMesh(piece);
    this.scene.add(built.mesh);
    this.byKey.set(key, built);
  }

  /** Analytic world-space center of a piece (no scene-graph traversal). */
  private pieceCenter(p: PlacedPiece, out: THREE.Vector3): THREE.Vector3 {
    const { pos } = pieceTransform(p);
    const cy =
      p.kind === 'foundation' ? -0.15 : p.kind === 'wall' || p.kind === 'door' ? WALL_H / 2 : 0.06;
    return out.set(pos.x, pos.y + cy, pos.z);
  }

  /** Remove the piece nearest to a world point within `range` (refund handled by caller). */
  removeNearest(point: THREE.Vector3, range = 3): PlacedPiece | null {
    let bestKey: string | null = null;
    let bestD = range;
    const c = new THREE.Vector3();
    for (const [key, b] of this.byKey) {
      const d = this.pieceCenter(b.piece, c).distanceTo(point);
      if (d < bestD) {
        bestD = d;
        bestKey = key;
      }
    }
    if (!bestKey) return null;
    const b = this.byKey.get(bestKey)!;
    this.scene.remove(b.mesh);
    disposeObject(b.mesh);
    if (b.collider) this.physics.world.removeCollider(b.collider, false);
    this.byKey.delete(bestKey);
    return b.piece;
  }

  /** Toggle a door if one is near the point. Returns true if toggled. */
  toggleDoor(point: THREE.Vector3, range = 2.5): boolean {
    const c = new THREE.Vector3();
    for (const b of this.byKey.values()) {
      if (b.piece.kind !== 'door' || !b.doorPanel) continue;
      if (this.pieceCenter(b.piece, c).distanceTo(point) < range) {
        b.open = !b.open;
        b.doorPanel.rotation.y = b.open ? -Math.PI / 2 + 0.06 : 0;
        // Swap collider solidity: open door = sensor (walk through).
        b.collider?.setSensor(b.open ?? false);
        return true;
      }
    }
    return false;
  }

  /** World-space center/orientation helpers for ghosts. */
  worldTransform(p: PlacedPiece): { pos: THREE.Vector3; yaw: number } {
    const { pos, yaw } = pieceTransform(p);
    return { pos, yaw };
  }

  private buildMesh(piece: PlacedPiece): BuiltPiece {
    const { pos, yaw } = pieceTransform(piece);
    let mesh: THREE.Object3D;
    let collider: RAPIER_API.Collider | null = null;
    let doorPanel: THREE.Object3D | undefined;

    const solidBox = (w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const boxCollider = (w: number, h: number, d: number, cy: number): RAPIER_API.Collider =>
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
          .setTranslation(pos.x, pos.y + cy, pos.z)
          .setRotation(yawQuat(yaw)),
      );

    switch (piece.kind) {
      case 'foundation': {
        mesh = solidBox(GRID, 0.3, GRID, DARK_MAT);
        mesh.position.set(pos.x, pos.y - 0.15, pos.z);
        collider = boxCollider(GRID, 0.3, GRID, -0.15);
        break;
      }
      case 'floor':
      case 'roof': {
        mesh = solidBox(GRID, 0.12, GRID, piece.kind === 'roof' ? ROOF_MAT : WOOD_MAT);
        mesh.position.set(pos.x, pos.y + 0.06, pos.z);
        collider = boxCollider(GRID, 0.12, GRID, 0.06);
        break;
      }
      case 'wall': {
        mesh = solidBox(GRID, WALL_H, 0.14, WOOD_MAT);
        mesh.position.set(pos.x, pos.y + WALL_H / 2, pos.z);
        mesh.rotation.y = yaw;
        collider = boxCollider(GRID, WALL_H, 0.14, WALL_H / 2);
        break;
      }
      case 'door': {
        // Frame (two posts + lintel) + hinged panel.
        const group = new THREE.Group();
        const post = solidBox(0.25, WALL_H, 0.14, WOOD_MAT);
        post.position.x = -GRID / 2 + 0.125;
        const post2 = post.clone();
        post2.position.x = GRID / 2 - 0.125;
        const lintel = solidBox(GRID, 0.3, 0.14, WOOD_MAT);
        lintel.position.y = WALL_H / 2 - 0.15;
        group.add(post, post2, lintel);
        // Hinged panel pivots at its left edge.
        const hinge = new THREE.Group();
        const panel = solidBox(GRID - 0.5, WALL_H - 0.3, 0.08, DARK_MAT);
        panel.position.x = (GRID - 0.5) / 2;
        hinge.add(panel);
        hinge.position.set(-GRID / 2 + 0.25, -0.15, 0);
        group.add(hinge);
        group.position.set(pos.x, pos.y + WALL_H / 2, pos.z);
        group.rotation.y = yaw;
        mesh = group;
        doorPanel = hinge;
        collider = boxCollider(GRID - 0.5, WALL_H, 0.12, WALL_H / 2);
        break;
      }
    }
    return { piece, mesh, collider, doorPanel, open: false };
  }
}

/** Dispose all geometries under an object (materials are shared module-level). */
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}

function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** Grid → world transform for each piece kind. */
export function pieceTransform(p: PlacedPiece): { pos: THREE.Vector3; yaw: number } {
  const cx = p.gx * GRID + GRID / 2;
  const cz = p.gz * GRID + GRID / 2;
  if (p.kind === 'wall' || p.kind === 'door') {
    // Edge midpoint: N edge at cz-1, E at cx+1, etc.
    const off = GRID / 2;
    const ex = p.dir === 1 ? cx + off : p.dir === 3 ? cx - off : cx;
    const ez = p.dir === 0 ? cz - off : p.dir === 2 ? cz + off : cz;
    const yaw = p.dir === 0 || p.dir === 2 ? 0 : Math.PI / 2;
    return { pos: new THREE.Vector3(ex, p.baseY, ez), yaw };
  }
  return { pos: new THREE.Vector3(cx, p.baseY, cz), yaw: 0 };
}
