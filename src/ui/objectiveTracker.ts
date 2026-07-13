import type { ObjectiveManager } from '../progression/objectives';

/** Always-visible current-objective card (below the minimap). */
export class ObjectiveTracker {
  private root = document.createElement('div');
  private lastKey = '';

  constructor(private objectives: ObjectiveManager) {
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '204px',
      right: '12px',
      width: '196px',
      padding: '10px 12px',
      background: 'rgba(10,14,18,0.66)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '10px',
      fontFamily: 'system-ui, sans-serif',
      color: '#fff',
      zIndex: '14',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.root);
    this.update();
  }

  update(): void {
    const cur = this.objectives.current;
    const key = cur ? cur.title : this.objectives.won ? 'won' : 'none';
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (cur) {
      this.root.innerHTML = `
        <div style="font-size:10px;letter-spacing:1px;color:#ffd97a;margin-bottom:4px">OBJECTIVE</div>
        <div style="font-size:13px;font-weight:600">${cur.title}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:3px">${cur.hint}</div>`;
    } else {
      this.root.innerHTML = `
        <div style="font-size:10px;letter-spacing:1px;color:#7ac06a;margin-bottom:4px">WYRDWOOD CONQUERED</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.55)">The beacon burns. Play on, wanderer.</div>`;
    }
  }
}
