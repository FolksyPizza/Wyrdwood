import * as THREE from 'three';
import { SEA_LEVEL, type Terrain } from '../world/terrain';
import { worldConfig } from '../data/difficulty';

/** Discovery grid cell size (world meters). */
const CELL = 16;
/** Radius (m) revealed around the player as they move. */
const REVEAL_RADIUS = 90;
/** Half-extent (world meters) shown across the full map. */
const FULL_RANGE = 1400;

export interface MapMarker {
  x: number;
  z: number;
  icon: string;
  /** Optional label shown on the full map (player-set markers). */
  name?: string;
  /** True for player-placed markers (removable; the rest are system markers). */
  custom?: boolean;
}

/** Icons offered when placing a custom marker. */
const MARKER_ICONS = ['📍', '🌿', '🍄', '🪵', '🪨', '⛏️', '🏠', '⚔️', '💀', '⭐'];

/**
 * World map: fog-of-war discovery grid, a live minimap (top-right), and a
 * full-screen map (M). Terrain is colored by sampling the deterministic
 * terrain functions — no texture storage needed.
 */
export class WorldMap {
  readonly markers: MapMarker[] = [];
  /** Discovered cell keys "cx,cz" — serialized in M8. */
  readonly discovered = new Set<string>();

  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private full: HTMLCanvasElement;
  private fullCtx: CanvasRenderingContext2D;
  private fullWrap: HTMLDivElement;
  visible = false;

  private redrawTimer = 0;
  private lastPx = 0;
  private lastPz = 0;
  private markerEditor!: HTMLDivElement;
  private pendingMarker: { x: number; z: number } | null = null;
  private pendingIcon = MARKER_ICONS[0]!;

  constructor(private terrain: Terrain) {
    this.mini = document.createElement('canvas');
    this.mini.width = 176;
    this.mini.height = 176;
    Object.assign(this.mini.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      borderRadius: '50%',
      border: '3px solid rgba(0,0,0,0.55)',
      zIndex: '15',
      pointerEvents: 'none',
    });
    document.body.appendChild(this.mini);
    this.miniCtx = this.mini.getContext('2d')!;

    this.fullWrap = document.createElement('div');
    Object.assign(this.fullWrap.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(8,10,14,0.8)',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '25',
    });
    this.full = document.createElement('canvas');
    this.full.width = 720;
    this.full.height = 720;
    Object.assign(this.full.style, {
      borderRadius: '12px',
      border: '1px solid rgba(255,255,255,0.15)',
      cursor: 'crosshair',
    });
    this.fullWrap.appendChild(this.full);

    // Hint + marker editor popup.
    const hint = document.createElement('div');
    hint.textContent = 'Click the map to place a marker · right-click a marker to remove';
    Object.assign(hint.style, {
      position: 'absolute',
      bottom: '18px',
      color: 'rgba(255,255,255,0.55)',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
    });
    this.fullWrap.appendChild(hint);
    this.buildMarkerEditor();

    document.body.appendChild(this.fullWrap);
    this.fullCtx = this.full.getContext('2d')!;

    // Click → world coords → open the marker editor. Right-click → remove.
    this.full.addEventListener('click', (e) => this.onMapClick(e));
    this.full.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onMapRightClick(e);
    });
  }

  private buildMarkerEditor(): void {
    this.markerEditor = document.createElement('div');
    Object.assign(this.markerEditor.style, {
      position: 'absolute',
      display: 'none',
      background: 'rgba(20,24,30,0.97)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '10px',
      padding: '12px',
      fontFamily: 'system-ui, sans-serif',
      zIndex: '2',
    });
    const iconRow = document.createElement('div');
    iconRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;width:220px;margin-bottom:8px';
    for (const icon of MARKER_ICONS) {
      const b = document.createElement('button');
      b.textContent = icon;
      b.style.cssText =
        'font-size:18px;width:34px;height:34px;border-radius:6px;cursor:pointer;background:rgba(0,0,0,0.3);border:2px solid transparent';
      b.addEventListener('click', () => {
        this.pendingIcon = icon;
        iconRow.querySelectorAll('button').forEach((x) => (x.style.borderColor = 'transparent'));
        b.style.borderColor = '#ffd97a';
      });
      iconRow.appendChild(b);
    }
    (iconRow.firstChild as HTMLButtonElement).style.borderColor = '#ffd97a';

    const nameInput = document.createElement('input');
    nameInput.placeholder = 'Marker name (optional)';
    nameInput.style.cssText =
      'width:100%;box-sizing:border-box;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.35);color:#fff;margin-bottom:8px';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px';
    const place = document.createElement('button');
    place.textContent = 'Place';
    place.style.cssText =
      'flex:1;padding:7px;border-radius:6px;border:none;background:#e8c96a;color:#1a1408;font-weight:600;cursor:pointer';
    place.addEventListener('click', () => {
      if (this.pendingMarker) {
        this.markers.push({
          x: this.pendingMarker.x,
          z: this.pendingMarker.z,
          icon: this.pendingIcon,
          name: nameInput.value.trim() || undefined,
          custom: true,
        });
      }
      nameInput.value = '';
      this.markerEditor.style.display = 'none';
      this.pendingMarker = null;
      this.redrawTimer = 0;
    });
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText =
      'flex:1;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer';
    cancel.addEventListener('click', () => {
      this.markerEditor.style.display = 'none';
      this.pendingMarker = null;
    });
    btnRow.append(place, cancel);
    this.markerEditor.append(iconRow, nameInput, btnRow);
    this.fullWrap.appendChild(this.markerEditor);
  }

  /** Canvas pixel → world coordinates on the full map. */
  private canvasToWorld(e: MouseEvent): { x: number; z: number } {
    const rect = this.full.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * this.full.width;
    const sy = ((e.clientY - rect.top) / rect.height) * this.full.height;
    const size = this.full.width;
    return {
      x: this.lastPx + ((sx - size / 2) / size) * FULL_RANGE * 2,
      z: this.lastPz + ((sy - size / 2) / size) * FULL_RANGE * 2,
    };
  }

  private onMapClick(e: MouseEvent): void {
    this.pendingMarker = this.canvasToWorld(e);
    // fullWrap is inset:0, so clientX/Y are already fullWrap-relative.
    this.markerEditor.style.left = `${Math.min(e.clientX + 12, window.innerWidth - 250)}px`;
    this.markerEditor.style.top = `${Math.min(e.clientY + 12, window.innerHeight - 140)}px`;
    this.markerEditor.style.display = 'block';
  }

  private onMapRightClick(e: MouseEvent): void {
    const w = this.canvasToWorld(e);
    // Remove the nearest custom marker within ~40m of the click.
    let bestI = -1;
    let bestD = 40;
    this.markers.forEach((m, i) => {
      if (!m.custom) return;
      const d = Math.hypot(m.x - w.x, m.z - w.z);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    });
    if (bestI !== -1) {
      this.markers.splice(bestI, 1);
      this.redrawTimer = 0;
    }
  }

  toggle(): void {
    if (!worldConfig.toggles.map && !this.visible) return; // map disabled for this world
    this.visible = !this.visible;
    this.fullWrap.style.display = this.visible ? 'flex' : 'none';
    if (this.visible && document.pointerLockElement) document.exitPointerLock();
  }

  /** Fixed-tick: reveal cells near the player. */
  updateDiscovery(px: number, pz: number): void {
    const r = Math.ceil(REVEAL_RADIUS / CELL);
    const cx0 = Math.floor(px / CELL);
    const cz0 = Math.floor(pz / CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz <= r * r) this.discovered.add(`${cx0 + dx},${cz0 + dz}`);
      }
    }
  }

  /** Per-frame (throttled internally): draw minimap and, if open, full map. */
  render(frameDt: number, px: number, pz: number, yaw: number): void {
    this.lastPx = px; // for click → world mapping
    this.lastPz = pz;
    const showMini = worldConfig.toggles.minimap && worldConfig.toggles.map;
    this.mini.style.display = showMini ? 'block' : 'none';
    this.redrawTimer -= frameDt;
    if (this.redrawTimer > 0) return;
    this.redrawTimer = 0.25;
    if (showMini) this.drawMinimap(px, pz, yaw);
    if (this.visible) this.drawFullMap(px, pz, yaw);
  }

  /** Terrain is static per-seed, so sampled colors are cached (4m quantization). */
  private colorCache = new Map<string, string>();
  private scratchColor = new THREE.Color();

  private terrainColor(x: number, z: number): string {
    const qx = Math.round(x / 4) * 4;
    const qz = Math.round(z / 4) * 4;
    const key = `${qx},${qz}`;
    const cached = this.colorCache.get(key);
    if (cached) return cached;
    const y = this.terrain.height(qx, qz);
    let result: string;
    if (y < SEA_LEVEL) result = '#2f5d8a';
    else {
      const c = this.scratchColor.setHex(this.terrain.biomeAt(qx, qz, y).color);
      // Hillshade-ish: darken steep slopes.
      const shade = 1 - Math.min(this.terrain.slopeAt(qx, qz) * 0.35, 0.45);
      result = `rgb(${(c.r * shade * 255) | 0},${(c.g * shade * 255) | 0},${(c.b * shade * 255) | 0})`;
    }
    if (this.colorCache.size > 60000) this.colorCache.clear(); // bound memory
    this.colorCache.set(key, result);
    return result;
  }

  private drawMinimap(px: number, pz: number, yaw: number): void {
    const ctx = this.miniCtx;
    const size = this.mini.width;
    const range = 130; // world meters shown across the minimap
    const step = 4;
    ctx.clearRect(0, 0, size, size);
    for (let sy = 0; sy < size; sy += step) {
      for (let sx = 0; sx < size; sx += step) {
        const wx = px + ((sx - size / 2) / size) * range * 2;
        const wz = pz + ((sy - size / 2) / size) * range * 2;
        const cell = `${Math.floor(wx / CELL)},${Math.floor(wz / CELL)}`;
        ctx.fillStyle = this.discovered.has(cell) ? this.terrainColor(wx, wz) : '#0d0f13';
        ctx.fillRect(sx, sy, step, step);
      }
    }
    this.drawMarkers(ctx, size, px, pz, range);
    // Player arrow. Map is north-up (+z = down, +x = right); camera-forward is
    // (-sin yaw, -cos yaw), so the up-pointing arrow rotates by exactly -yaw.
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawFullMap(px: number, pz: number, yaw: number): void {
    const ctx = this.fullCtx;
    const size = this.full.width;
    const range = FULL_RANGE;
    const step = 4;
    ctx.fillStyle = '#0d0f13';
    ctx.fillRect(0, 0, size, size);
    for (let sy = 0; sy < size; sy += step) {
      for (let sx = 0; sx < size; sx += step) {
        const wx = px + ((sx - size / 2) / size) * range * 2;
        const wz = pz + ((sy - size / 2) / size) * range * 2;
        const cell = `${Math.floor(wx / CELL)},${Math.floor(wz / CELL)}`;
        if (!this.discovered.has(cell)) continue;
        ctx.fillStyle = this.terrainColor(wx, wz);
        ctx.fillRect(sx, sy, step, step);
      }
    }
    this.drawMarkers(ctx, size, px, pz, range, true);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    size: number,
    px: number,
    pz: number,
    range: number,
    showNames = false,
  ): void {
    ctx.font = '16px system-ui';
    ctx.textAlign = 'center';
    for (const m of this.markers) {
      const sx = size / 2 + ((m.x - px) / (range * 2)) * size;
      const sy = size / 2 + ((m.z - pz) / (range * 2)) * size;
      if (sx < 8 || sy < 8 || sx > size - 8 || sy > size - 8) continue;
      ctx.fillText(m.icon, sx, sy + 5);
      if (showNames && m.name) {
        ctx.font = '11px system-ui';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        const w = ctx.measureText(m.name).width;
        ctx.fillRect(sx - w / 2 - 4, sy + 8, w + 8, 15);
        ctx.fillStyle = '#fff';
        ctx.fillText(m.name, sx, sy + 19);
        ctx.font = '16px system-ui';
      }
    }
  }
}
