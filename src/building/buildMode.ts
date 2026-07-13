import * as THREE from 'three';
import type { Terrain } from '../world/terrain';
import type { Inventory } from '../items/inventory';
import type { Input } from '../core/input';
import { Buildings, pieceTransform } from './buildings';
import { GRID, WALL_H, PIECES, type PieceKind, type PlacedPiece } from '../data/pieces';
import type { Blueprint } from '../data/blueprints';
import { worldConfig } from '../data/difficulty';

export type BuildSelection =
  | { type: 'piece'; kind: PieceKind }
  | { type: 'blueprint'; blueprint: Blueprint }
  | { type: 'remove' }
  | null;

const GHOST_OK = new THREE.MeshBasicMaterial({
  color: 0x4dd964,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});
const GHOST_BAD = new THREE.MeshBasicMaterial({
  color: 0xd94d4d,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});

// Shared ghost geometries — renderGhost runs per frame; never allocate there.
const GHOST_GEO = {
  cell: new THREE.BoxGeometry(GRID, 0.3, GRID), // foundation
  panel: new THREE.BoxGeometry(GRID, 0.12, GRID), // floor/roof
  wall: new THREE.BoxGeometry(GRID, WALL_H, 0.14), // wall/door
};

/**
 * Build mode: aim → snapped ghost preview → click to place (or remove).
 * Handles single pieces and whole blueprints (rotate with G).
 */
export class BuildMode {
  selection: BuildSelection = null;
  /** Blueprint rotation (0-3 quarter turns). */
  rotation: 0 | 1 | 2 | 3 = 0;
  /** Status line for the HUD. */
  status = '';
  /** Called per piece placed (XP hooks). */
  onPlace: (piece: PlacedPiece) => void = () => {};

  private ghostGroup = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    private terrain: Terrain,
    private buildings: Buildings,
    private inventory: Inventory,
  ) {
    this.ghostGroup.visible = false;
    scene.add(this.ghostGroup);
  }

  get active(): boolean {
    return this.selection !== null;
  }

  select(sel: BuildSelection): void {
    this.selection = sel;
    this.rotation = 0;
  }

  exit(): void {
    this.selection = null;
    this.ghostGroup.visible = false;
    this.status = '';
  }

  /** Per-frame while playing. Uses camera aim; consumes clicks when active. */
  update(camera: THREE.PerspectiveCamera, playerPos: THREE.Vector3, input: Input): void {
    if (!this.selection) {
      this.ghostGroup.visible = false;
      return;
    }
    if (input.down('KeyX') || input.down('Escape')) {
      this.exit();
      return;
    }

    const aim = this.aimPoint(camera, playerPos);
    if (!aim) {
      this.ghostGroup.visible = false;
      this.status = 'Aim at the ground';
      return;
    }

    if (this.selection.type === 'remove') {
      this.status = 'Click to dismantle nearest piece (full refund) · X to cancel';
      this.ghostGroup.visible = false;
      if (input.consumeLeftClick()) {
        const removed = this.buildings.removeNearest(aim, 3);
        if (removed) for (const c of PIECES[removed.kind].cost) this.inventory.add(c.itemId, c.count);
      }
      return;
    }

    const pieces =
      this.selection.type === 'piece'
        ? [this.resolvePiece(this.selection.kind, aim)]
        : this.resolveBlueprint(this.selection.blueprint, aim);

    const valid = pieces.every((p) => p !== null) && this.validate(pieces as PlacedPiece[]);
    this.renderGhost(pieces.filter(Boolean) as PlacedPiece[], valid);

    const label =
      this.selection.type === 'piece'
        ? PIECES[this.selection.kind].name
        : `${this.selection.blueprint.name} (G rotate)`;
    this.status = `${label} — ${valid ? 'click to place' : 'invalid spot'} · cost ${this.costText(pieces as PlacedPiece[])} · X cancel`;

    if (input.down('KeyG') && this.selection.type === 'blueprint' && !this.rotateHeld) {
      this.rotation = ((this.rotation + 1) % 4) as 0 | 1 | 2 | 3;
    }
    this.rotateHeld = input.down('KeyG');

    if (valid && input.consumeLeftClick()) {
      const list = pieces as PlacedPiece[];
      for (const p of list) {
        if (!this.buildings.occupied(p)) {
          this.buildings.place(p);
          if (!worldConfig.toggles.freeBuild) {
            for (const c of PIECES[p.kind].cost) this.inventory.remove(c.itemId, c.count);
          }
          this.onPlace(p);
        }
      }
      if (this.selection.type === 'blueprint') this.exit(); // one-shot templates
    }
  }

  private rotateHeld = false;
  private raycaster = new THREE.Raycaster();
  private aimCenter = new THREE.Vector2(0, 0);

  /**
   * Aim point = nearest of (a) camera ray vs existing building surfaces and
   * (b) the terrain-march hit. Hitting a floor/foundation lets you stack a
   * storey; otherwise you snap to the ground.
   */
  private aimPoint(camera: THREE.PerspectiveCamera, playerPos: THREE.Vector3): THREE.Vector3 | null {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const origin = camera.position.clone();

    // (a) Existing building surfaces.
    let buildingHit: THREE.Vector3 | null = null;
    const meshes = this.buildings.meshes;
    if (meshes.length) {
      this.raycaster.setFromCamera(this.aimCenter, camera);
      this.raycaster.far = 20;
      const hits = this.raycaster.intersectObjects(meshes, true);
      for (const h of hits) {
        if (h.point.distanceTo(playerPos) <= 9) {
          buildingHit = h.point.clone();
          break;
        }
      }
    }

    // (b) Terrain march.
    let terrainHit: THREE.Vector3 | null = null;
    for (let t = 2; t < 18; t += 0.4) {
      const p = origin.clone().addScaledVector(dir, t);
      if (p.distanceTo(playerPos) > 9) break;
      if (p.y <= this.terrain.height(p.x, p.z)) {
        p.y = this.terrain.height(p.x, p.z);
        terrainHit = p;
        break;
      }
    }

    if (buildingHit && terrainHit) {
      return buildingHit.distanceToSquared(origin) < terrainHit.distanceToSquared(origin)
        ? buildingHit
        : terrainHit;
    }
    return buildingHit ?? terrainHit;
  }

  /** Snap a single piece to the grid at the aim point. */
  private resolvePiece(kind: PieceKind, aim: THREE.Vector3): PlacedPiece | null {
    const gx = Math.floor(aim.x / GRID);
    const gz = Math.floor(aim.z / GRID);
    if (kind === 'wall' || kind === 'door') {
      // Nearest edge of the aimed cell.
      const fx = aim.x / GRID - gx;
      const fz = aim.z / GRID - gz;
      const cands: [number, 0 | 1 | 2 | 3][] = [
        [fz, 0],
        [1 - fx, 1],
        [1 - fz, 2],
        [fx, 3],
      ];
      cands.sort((a, b) => a[0] - b[0]);
      const dir = cands[0]![1];
      for (let level = 0; level < 4; level++) {
        const p: PlacedPiece = { kind, gx, gz, level, dir, baseY: this.buildings.baseYFor(gx, gz, level) };
        if (!this.buildings.occupied(p)) return p;
      }
      return null;
    }
    // Cell pieces: first free level (foundation only 0; floor/roof stack upward).
    const maxLevel = kind === 'foundation' ? 1 : 4;
    for (let level = kind === 'foundation' ? 0 : 1; level < maxLevel; level++) {
      const p: PlacedPiece = { kind, gx, gz, level, dir: 0, baseY: this.buildings.baseYFor(gx, gz, level) };
      if (!this.buildings.occupied(p)) return p;
    }
    return null;
  }

  /** Blueprint → concrete pieces. A blueprint is a rigid structure, so every
   * piece shares one base height = the HIGHEST footprint corner, keeping it
   * level and never buried on sloped ground. */
  private resolveBlueprint(bp: Blueprint, aim: THREE.Vector3): (PlacedPiece | null)[] {
    const agx = Math.floor(aim.x / GRID);
    const agz = Math.floor(aim.z / GRID);

    const rotate = (dx: number, dz: number, dir: 0 | 1 | 2 | 3): { dx: number; dz: number; dir: 0 | 1 | 2 | 3 } => {
      for (let r = 0; r < this.rotation; r++) {
        [dx, dz] = [-dz, dx];
        dir = ((dir + 1) % 4) as 0 | 1 | 2 | 3;
      }
      return { dx, dz, dir };
    };

    // Uniform base = tallest terrain under any footprint cell (level 0).
    let baseY0 = -Infinity;
    for (const bpp of bp.pieces) {
      if (bpp.level !== 0) continue;
      const r = rotate(bpp.dx, bpp.dz, bpp.dir);
      baseY0 = Math.max(baseY0, this.buildings.baseYFor(agx + r.dx, agz + r.dz, 0));
    }
    if (!isFinite(baseY0)) baseY0 = this.buildings.baseYFor(agx, agz, 0);

    return bp.pieces.map((bpp) => {
      const r = rotate(bpp.dx, bpp.dz, bpp.dir);
      return {
        kind: bpp.kind,
        gx: agx + r.dx,
        gz: agz + r.dz,
        level: bpp.level,
        dir: r.dir,
        baseY: baseY0 + bpp.level * WALL_H,
      };
    });
  }

  private validate(pieces: PlacedPiece[]): boolean {
    if (pieces.some((p) => this.buildings.occupied(p))) return false;
    // Cost check across all pieces (skipped in free-build worlds).
    if (!worldConfig.toggles.freeBuild) {
      const need = new Map<string, number>();
      for (const p of pieces) {
        for (const c of PIECES[p.kind].cost) need.set(c.itemId, (need.get(c.itemId) ?? 0) + c.count);
      }
      for (const [itemId, count] of need) {
        if (this.inventory.count(itemId) < count) return false;
      }
    }
    if (pieces.length === 1) {
      return this.buildings.supported(pieces[0]!);
    }
    // Blueprints: only require sane terrain under each foundation.
    return pieces
      .filter((p) => p.kind === 'foundation')
      .every((p) => this.buildings.supported(p));
  }

  private costText(pieces: (PlacedPiece | null)[]): string {
    const need = new Map<string, number>();
    for (const p of pieces) {
      if (!p) continue;
      for (const c of PIECES[p.kind].cost) need.set(c.itemId, (need.get(c.itemId) ?? 0) + c.count);
    }
    return [...need.entries()].map(([id, n]) => `${n} ${id}`).join(', ') || '-';
  }

  private renderGhost(pieces: PlacedPiece[], valid: boolean): void {
    this.ghostGroup.clear();
    this.ghostGroup.visible = pieces.length > 0;
    const mat = valid ? GHOST_OK : GHOST_BAD;
    for (const p of pieces) {
      const { pos, yaw } = pieceTransform(p);
      let geo: THREE.BoxGeometry;
      let cy = 0;
      if (p.kind === 'foundation') {
        geo = GHOST_GEO.cell;
        cy = -0.15;
      } else if (p.kind === 'floor' || p.kind === 'roof') {
        geo = GHOST_GEO.panel;
        cy = 0.06;
      } else {
        geo = GHOST_GEO.wall;
        cy = WALL_H / 2;
      }
      const m = new THREE.Mesh(geo, mat);
      m.position.set(pos.x, pos.y + cy, pos.z);
      m.rotation.y = yaw;
      this.ghostGroup.add(m);
    }
  }
}
