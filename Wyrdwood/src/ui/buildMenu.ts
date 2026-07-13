import { PIECES, type PieceKind } from '../data/pieces';
import { BLUEPRINTS } from '../data/blueprints';
import type { BuildMode } from '../building/buildMode';

/**
 * Build palette (B): pick a piece, a blueprint, or the dismantle tool.
 * Selecting closes the menu and enters build mode with a ghost preview.
 */
export class BuildMenu {
  private root = document.createElement('div');
  visible = false;

  constructor(private buildMode: BuildMode) {
    this.root.innerHTML = `<style>
      .build-screen { position: fixed; inset: 0; background: rgba(8,10,14,0.72); display: flex; align-items: center; justify-content: center; z-index: 20; font-family: system-ui, sans-serif; }
      .build-panel { background: rgba(24,28,34,0.95); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 20px 24px; width: 460px; }
      .build-panel h2 { color: #e8d9b0; margin: 0 0 6px; font-size: 18px; letter-spacing: 1px; }
      .build-panel h3 { color: rgba(255,255,255,0.5); margin: 14px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
      .build-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .build-item { background: rgba(10,14,18,0.7); border: 2px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 10px 6px; text-align: center; cursor: pointer; color: #fff; }
      .build-item:hover { border-color: #ffd97a; }
      .build-item .bicon { font-size: 26px; }
      .build-item .bname { font-size: 11px; margin-top: 4px; color: rgba(255,255,255,0.8); }
      .build-item .bcost { font-size: 10px; color: rgba(255,255,255,0.5); }
      .build-hint { color: rgba(255,255,255,0.45); font-size: 12px; margin-top: 12px; }
    </style>`;
    const screen = document.createElement('div');
    screen.className = 'build-screen';
    const panel = document.createElement('div');
    panel.className = 'build-panel';
    panel.innerHTML = '<h2>Build</h2>';

    const mkItem = (icon: string, name: string, cost: string, onClick: () => void): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'build-item';
      el.innerHTML = `<div class="bicon">${icon}</div><div class="bname">${name}</div><div class="bcost">${cost}</div>`;
      el.addEventListener('click', () => {
        onClick();
        this.toggle();
      });
      return el;
    };

    const piecesHdr = document.createElement('h3');
    piecesHdr.textContent = 'Pieces';
    panel.appendChild(piecesHdr);
    const pieceGrid = document.createElement('div');
    pieceGrid.className = 'build-grid';
    for (const kind of Object.keys(PIECES) as PieceKind[]) {
      const def = PIECES[kind];
      const cost = def.cost.map((c) => `${c.count} ${c.itemId}`).join(', ');
      pieceGrid.appendChild(
        mkItem(def.icon, def.name, cost, () => this.buildMode.select({ type: 'piece', kind })),
      );
    }
    panel.appendChild(pieceGrid);

    const bpHdr = document.createElement('h3');
    bpHdr.textContent = 'Blueprints';
    panel.appendChild(bpHdr);
    const bpGrid = document.createElement('div');
    bpGrid.className = 'build-grid';
    for (const bp of BLUEPRINTS) {
      bpGrid.appendChild(
        mkItem(bp.icon, bp.name, `${bp.pieces.length} pieces`, () =>
          this.buildMode.select({ type: 'blueprint', blueprint: bp }),
        ),
      );
    }
    bpGrid.appendChild(mkItem('🔨', 'Dismantle', 'refund', () => this.buildMode.select({ type: 'remove' })));
    panel.appendChild(bpGrid);

    const hint = document.createElement('div');
    hint.className = 'build-hint';
    hint.textContent = 'Click to select, then aim & click in world · G rotates blueprints · X cancels';
    panel.appendChild(hint);
    screen.appendChild(panel);
    this.root.appendChild(screen);
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
    if (this.visible && document.pointerLockElement) document.exitPointerLock();
  }
}
