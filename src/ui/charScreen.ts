import type { Progression } from '../progression/progression';
import { SKILLS, skillXpToNext, charXpToNext, type SkillId } from '../data/skills';

/** Character screen (P): level, XP progress, and skill levels. */
export class CharScreen {
  private root = document.createElement('div');
  private body = document.createElement('div');
  visible = false;

  constructor(private progression: Progression) {
    this.root.innerHTML = `<style>
      .char-screen { position: fixed; inset: 0; background: rgba(8,10,14,0.72); display: flex; align-items: center; justify-content: center; z-index: 20; font-family: system-ui, sans-serif; }
      .char-panel { background: rgba(24,28,34,0.95); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 20px 24px; width: 420px; }
      .char-panel h2 { color: #e8d9b0; margin: 0 0 4px; font-size: 18px; letter-spacing: 1px; }
      .char-level { color: #fff; font-size: 26px; font-weight: 700; margin-bottom: 4px; }
      .char-xpbar { height: 10px; background: rgba(0,0,0,0.5); border-radius: 5px; overflow: hidden; margin-bottom: 16px; }
      .char-xpbar > i { display: block; height: 100%; background: #7ac06a; border-radius: 5px; }
      .skill-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
      .skill-row .sicon { font-size: 20px; width: 28px; text-align: center; }
      .skill-row .sinfo { flex: 1; }
      .skill-row .sname { color: #fff; font-size: 13px; display: flex; justify-content: space-between; }
      .skill-row .sname b { color: #ffd97a; }
      .skill-row .sbar { height: 6px; background: rgba(0,0,0,0.5); border-radius: 3px; overflow: hidden; margin-top: 3px; }
      .skill-row .sbar > i { display: block; height: 100%; background: #5b8dd9; border-radius: 3px; }
      .skill-row .seffect { color: rgba(255,255,255,0.4); font-size: 10px; margin-top: 1px; }
      .char-hint { color: rgba(255,255,255,0.45); font-size: 12px; margin-top: 10px; }
    </style>`;
    const screen = document.createElement('div');
    screen.className = 'char-screen';
    const panel = document.createElement('div');
    panel.className = 'char-panel';
    panel.innerHTML = '<h2>Character</h2>';
    panel.appendChild(this.body);
    const hint = document.createElement('div');
    hint.className = 'char-hint';
    hint.textContent = 'Skills level as you use them · levels grant +HP/+stamina · P to close';
    panel.appendChild(hint);
    screen.appendChild(panel);
    this.root.appendChild(screen);
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.render();
    if (this.visible && document.pointerLockElement) document.exitPointerLock();
  }

  private render(): void {
    const p = this.progression;
    const xpPct = Math.round((p.xp / charXpToNext(p.level)) * 100);
    let html = `
      <div class="char-level">Level ${p.level}</div>
      <div class="char-xpbar"><i style="width:${xpPct}%"></i></div>`;
    for (const id of Object.keys(SKILLS) as SkillId[]) {
      const def = SKILLS[id];
      const s = p.skills[id];
      const pct = Math.round((s.xp / skillXpToNext(s.level)) * 100);
      html += `
        <div class="skill-row">
          <div class="sicon">${def.icon}</div>
          <div class="sinfo">
            <div class="sname"><span>${def.name}</span><b>${s.level}</b></div>
            <div class="sbar"><i style="width:${pct}%"></i></div>
            <div class="seffect">${def.effect}</div>
          </div>
        </div>`;
    }
    this.body.innerHTML = html;
  }
}
