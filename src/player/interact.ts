import * as THREE from 'three';
import type { ChunkManager } from '../world/chunks';
import type { ScatterInstance, ScatterType } from '../world/scatter';
import type { Inventory } from '../items/inventory';
import type { PlayerStats } from './stats';
import type { Input } from '../core/input';
import type { PlacedObjects } from '../building/placed';
import type { Terrain } from '../world/terrain';
import type { Progression } from '../progression/progression';
import { SEA_LEVEL } from '../world/terrain';
import { HARVEST } from '../data/harvest';
import { itemDef } from '../data/items';
import type { SkillId } from '../data/skills';

const HARVEST_SKILL: Record<ScatterType, SkillId> = {
  tree: 'woodcutting',
  rock: 'mining',
  bush: 'foraging',
  flower: 'foraging',
  mushroom: 'foraging',
  herb: 'foraging',
};

const SCATTER_NAMES: Record<ScatterType, string> = {
  tree: 'Tree',
  rock: 'Rock',
  bush: 'Berry Bush',
  flower: 'Flower',
  mushroom: 'Mushroom',
  herb: 'Herb',
};

const RANGE = 4.0;
const HIT_COOLDOWN = 0.5;
const HIT_STAMINA = 4;

export interface InteractTarget {
  kind: 'scatter' | 'water';
  instance?: ScatterInstance;
  /** Prompt text, e.g. "Chop Tree". */
  label: string;
}

/**
 * Center-screen raycast interaction: harvest scatter objects, drink water.
 * Hold E to repeatedly hit the current target.
 */
export class Interaction {
  target: InteractTarget | null = null;
  /** Fired on each harvest hit (particles/sound). */
  onHarvestHit: (inst: ScatterInstance, destroyed: boolean) => void = () => {};
  /** One-shot feedback message for the HUD ("+4 Wood"). */
  feedback = '';
  private feedbackTimer = 0;
  private cooldown = 0;
  private raycaster = new THREE.Raycaster();
  private center = new THREE.Vector2(0, 0);

  constructor(
    private chunks: ChunkManager,
    private water: THREE.Mesh,
    private inventory: Inventory,
    private stats: PlayerStats,
    private placed: PlacedObjects,
    private terrain: Terrain,
    private progression: Progression,
  ) {
    this.raycaster.far = RANGE + 8; // camera sits behind the player
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    playerPos: THREE.Vector3,
    input: Input,
  ): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.feedbackTimer = Math.max(0, this.feedbackTimer - dt);
    if (this.feedbackTimer === 0) this.feedback = '';

    // --- Find target under the crosshair, within reach of the player ---
    this.target = null;
    this.raycaster.setFromCamera(this.center, camera);
    const meshes: THREE.Object3D[] = [
      ...this.chunks.interactablesNear(playerPos.x, playerPos.z),
      this.water,
    ];
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      if (hit.point.distanceTo(playerPos) > RANGE) continue;
      if (hit.object === this.water) {
        this.target = { kind: 'water', label: 'Drink' };
        break;
      }
      const instances = (hit.object.userData.instances ?? []) as ScatterInstance[];
      const inst = hit.instanceId !== undefined ? instances[hit.instanceId] : undefined;
      if (inst) {
        const def = HARVEST[inst.type];
        const name = SCATTER_NAMES[inst.type] ?? inst.type;
        this.target = { kind: 'scatter', instance: inst, label: `${def.verb} ${name}` };
        break;
      }
    }

    // --- Right-click: place the held placeable in front of the player ---
    if (input.consumeRightClick() && !this.stats.dead) {
      const active = this.inventory.active;
      const def = active ? itemDef(active.itemId) : null;
      if (def?.placeable) {
        // Drop point: 2m ahead of the camera direction, snapped to terrain.
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const px = playerPos.x + dir.x * 2.2;
        const pz = playerPos.z + dir.z * 2.2;
        const py = this.terrain.height(px, pz);
        if (py > SEA_LEVEL && this.terrain.slopeAt(px, pz) < 0.6) {
          const yaw = Math.atan2(dir.x, dir.z) + Math.PI;
          this.placed.place(def.placeable, px, py, pz, yaw);
          this.inventory.consumeOne(this.inventory.activeSlot);
          this.show(`Placed ${def.name}`);
        } else {
          this.show("Can't place here");
        }
      }
    }

    // --- Act on E ---
    if (!input.action('interact') || this.cooldown > 0 || !this.target || this.stats.dead) return;
    this.cooldown = HIT_COOLDOWN;

    if (this.target.kind === 'water') {
      this.stats.drink();
      this.show('Drank water');
      return;
    }

    const inst = this.target.instance!;
    if (!this.stats.spend(HIT_STAMINA)) {
      this.show('Too tired…');
      return;
    }
    const def = HARVEST[inst.type];
    const skill = HARVEST_SKILL[inst.type];
    // The right tool cuts total hits (e.g. axe on trees); skill shaves more.
    const activeDef = this.inventory.active ? itemDef(this.inventory.active.itemId) : null;
    const hasTool = def.tool && activeDef?.tool?.kind === def.tool.kind;
    const baseHits = hasTool ? def.tool!.hits : def.hits;
    const totalHits = Math.max(1, baseHits - this.progression.harvestHitReduction(skill));
    inst.hp = Math.min(inst.hp ?? totalHits, totalHits) - 1;
    this.progression.addSkillXp(skill, 3);
    this.onHarvestHit(inst, inst.hp <= 0);
    if (inst.hp > 0) {
      this.chunks.recordDamage(inst, inst.hp); // persist partial progress
      return;
    }

    // Depleted: drop items (skill bonus applies), remove from world, grant XP.
    const gained: string[] = [];
    const bonus = this.progression.bonusDrops(skill);
    for (const drop of def.drops) {
      if (drop.chance !== undefined && Math.random() > drop.chance) continue;
      const count = drop.count + bonus;
      const leftover = this.inventory.add(drop.itemId, count);
      const got = count - leftover;
      if (got > 0) gained.push(`+${got} ${itemDef(drop.itemId).name}`);
      if (leftover > 0) gained.push('(inventory full)');
    }
    this.chunks.removeInstance(inst);
    this.progression.addSkillXp(skill, 10);
    this.progression.addXp(5);
    this.show(gained.join('  '));
  }

  private show(msg: string): void {
    this.feedback = msg;
    this.feedbackTimer = 2;
  }

  /** External systems (combat kills, etc.) can surface feedback too. */
  showFeedback(msg: string): void {
    this.show(msg);
  }
}
