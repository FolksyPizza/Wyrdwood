import * as THREE from 'three';
import { MOBS, type MobDef } from '../data/mobs';
import { worldConfig } from '../data/difficulty';
import { mulberry32 } from '../world/noise';
import { clipsOf, findClip, instantiate, modelHeight } from '../render/models';
import type { Terrain } from '../world/terrain';
import { SEA_LEVEL } from '../world/terrain';

type MobState = 'idle' | 'wander' | 'chase' | 'attack' | 'flee';

export interface Mob {
  def: MobDef;
  hp: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: MobState;
  stateTimer: number;
  attackTimer: number;
  targetX: number;
  targetZ: number;
  mesh: THREE.Group;
  /** Set when hit — passive mobs flee, neutral ones may retaliate. */
  provoked: boolean;
  walkPhase: number;
  /** Current ground speed (m/s) — eased towards the state's target. */
  speed: number;
  /** Skeletal animation for the rigged model. */
  mixer: THREE.AnimationMixer | null;
  anims: MobAnims | null;
  current: THREE.AnimationAction | null;
}

/** How much of its top speed an animal uses when just wandering around. */
const WANDER_FRACTION = 0.35;

const MAX_MOBS = 24;
const SPAWN_MIN = 24;
const SPAWN_MAX = 55;
const DESPAWN = 75;

/**
 * Mob spawning + AI + movement + visuals. Mobs are kinematic (terrain-glued),
 * with distance-based melee — no physics bodies needed at this scale.
 */
export class MobManager {
  readonly mobs: Mob[] = [];
  private rng = mulberry32(0xbeef);
  private spawnTimer = 0;
  /** Called when a mob lands a hit on the player. */
  onPlayerHit: (damage: number) => void = () => {};

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
  ) {}

  update(dt: number, playerPos: THREE.Vector3, isNight: boolean, playerDead: boolean): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      this.trySpawn(playerPos, isNight);
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i]!;
      const distToPlayer = Math.hypot(mob.x - playerPos.x, mob.z - playerPos.z);
      if (distToPlayer > DESPAWN) {
        this.despawn(i);
        continue;
      }
      this.updateAI(mob, dt, playerPos, distToPlayer, playerDead);
      this.move(mob, dt);
      this.animate(mob, dt);
    }
  }

  /** Player melee swing: damage the best mob in an arc in front of the player. */
  swingAt(
    playerPos: THREE.Vector3,
    facingYaw: number,
    damage: number,
    range = 2.4,
  ): Mob | null {
    let best: Mob | null = null;
    let bestD = range;
    for (const mob of this.mobs) {
      const dx = mob.x - playerPos.x;
      const dz = mob.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d > range + mob.def.size * 0.5) continue;
      // Facing check (±75°). Humanoid faces atan2(wx,wz)+PI, so compare directions.
      const toMob = Math.atan2(dx, dz);
      let diff = toMob - facingYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > (75 * Math.PI) / 180) continue;
      if (d < bestD + mob.def.size * 0.5) {
        bestD = d;
        best = mob;
      }
    }
    if (best) this.damage(best, damage, playerPos);
    return best;
  }

  private damage(mob: Mob, amount: number, from: THREE.Vector3): void {
    mob.hp -= amount;
    mob.provoked = true;
    // Knockback.
    const dx = mob.x - from.x;
    const dz = mob.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    mob.x += (dx / d) * 0.7;
    mob.z += (dz / d) * 0.7;
    if (mob.hp <= 0) {
      const idx = this.mobs.indexOf(mob);
      if (idx !== -1) this.despawn(idx);
    } else if (mob.def.hostile || mob.def.retaliates) {
      // Retaliating animals turn aggressive once struck.
      mob.state = 'chase';
    } else {
      mob.state = 'flee';
      mob.stateTimer = 5;
    }
  }

  /** Drops from the last killed mob are collected by the caller via onKill. */
  onKill: (mob: Mob) => void = () => {};

  private trySpawn(playerPos: THREE.Vector3, isNight: boolean): void {
    if (this.mobs.length >= MAX_MOBS) return;
    const defs = Object.values(MOBS);
    const def = defs[Math.floor(this.rng() * defs.length)]!;

    // Density from difficulty config (combat dial for hostiles, world for passives).
    let density = def.hostile
      ? worldConfig.combat.enemyDensity
      : worldConfig.world.passiveDensity;
    if (def.hostile && isNight && def.nightBoost) density *= def.nightBoost;
    if (density <= 0 || this.rng() > density * 0.55) return;

    const ang = this.rng() * Math.PI * 2;
    const dist = SPAWN_MIN + this.rng() * (SPAWN_MAX - SPAWN_MIN);
    const x = playerPos.x + Math.cos(ang) * dist;
    const z = playerPos.z + Math.sin(ang) * dist;
    const y = this.terrain.height(x, z);
    if (y < SEA_LEVEL + 1) return;
    const biome = this.terrain.biomeAt(x, z, y);
    if (!def.biomes.includes(biome.id)) return;

    const { mesh, mixer, anims } = buildMobMesh(def);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.mobs.push({
      def,
      hp: def.hp,
      x,
      y,
      z,
      yaw: this.rng() * Math.PI * 2,
      state: 'idle',
      stateTimer: 1 + this.rng() * 3,
      attackTimer: 0,
      targetX: x,
      targetZ: z,
      mesh,
      provoked: false,
      walkPhase: 0,
      speed: 0,
      mixer,
      anims,
      current: null,
    });
  }

  private despawn(index: number): void {
    const mob = this.mobs[index]!;
    if (mob.hp <= 0) this.onKill(mob);
    this.scene.remove(mob.mesh);
    this.mobs.splice(index, 1);
  }

  private updateAI(
    mob: Mob,
    dt: number,
    playerPos: THREE.Vector3,
    distToPlayer: number,
    playerDead: boolean,
  ): void {
    const def = mob.def;
    mob.stateTimer -= dt;
    mob.attackTimer -= dt;
    const senseR = def.senseRadius * (def.hostile ? worldConfig.combat.enemyAggression : 1);

    // A neutral animal that's been struck behaves as aggressive as a hostile.
    const aggressive = def.hostile || (def.retaliates && mob.provoked);

    if (aggressive && !playerDead) {
      if (distToPlayer < def.attackRange + 0.4) {
        mob.state = 'attack';
      } else if (distToPlayer < senseR || (mob.provoked && distToPlayer < senseR * 1.8)) {
        mob.state = 'chase';
      } else if (mob.state === 'chase' || mob.state === 'attack') {
        mob.state = 'idle';
        mob.stateTimer = 2;
      }
    } else if (!def.hostile) {
      // Passive: flee when player is close or after being hit.
      if (mob.provoked || distToPlayer < senseR * 0.6) {
        if (mob.state !== 'flee') {
          mob.state = 'flee';
          mob.stateTimer = 4;
        }
      } else if (mob.state === 'flee' && mob.stateTimer <= 0) {
        mob.state = 'idle';
        mob.provoked = false;
        mob.stateTimer = 2;
      }
    }

    switch (mob.state) {
      case 'idle':
        if (mob.stateTimer <= 0) {
          mob.state = 'wander';
          const a = this.rng() * Math.PI * 2;
          const r = 4 + this.rng() * 10;
          mob.targetX = mob.x + Math.cos(a) * r;
          mob.targetZ = mob.z + Math.sin(a) * r;
          mob.stateTimer = 4 + this.rng() * 4;
        }
        break;
      case 'wander':
        if (mob.stateTimer <= 0 || Math.hypot(mob.targetX - mob.x, mob.targetZ - mob.z) < 1) {
          mob.state = 'idle';
          mob.stateTimer = 1.5 + this.rng() * 3.5;
        }
        break;
      case 'chase':
        mob.targetX = playerPos.x;
        mob.targetZ = playerPos.z;
        break;
      case 'attack':
        if (mob.attackTimer <= 0 && !playerDead) {
          mob.attackTimer = def.attackCooldown;
          this.onPlayerHit(def.damage * worldConfig.combat.enemyDamage);
        }
        if (distToPlayer > def.attackRange + 0.6) mob.state = 'chase';
        break;
      case 'flee': {
        const dx = mob.x - playerPos.x;
        const dz = mob.z - playerPos.z;
        const d = Math.hypot(dx, dz) || 1;
        mob.targetX = mob.x + (dx / d) * 12;
        mob.targetZ = mob.z + (dz / d) * 12;
        break;
      }
    }
  }

  private move(mob: Mob, dt: number): void {
    const moving = mob.state === 'wander' || mob.state === 'chase' || mob.state === 'flee';

    // A wandering animal *ambles* — it does not travel at its top speed. Using
    // def.speed for idle wandering is why the herds looked like they were being
    // chased by something invisible.
    let targetSpeed = 0;
    if (mob.state === 'wander') targetSpeed = mob.def.speed * WANDER_FRACTION;
    else if (mob.state === 'chase') targetSpeed = mob.def.speed;
    else if (mob.state === 'flee') targetSpeed = mob.def.fleeSpeed;

    // Ease into and out of that speed instead of snapping to it. Animals have
    // mass: they lean into a run and coast to a stop, and the gait animation is
    // driven from this, so a smooth speed makes a smooth walk cycle too.
    const accel = mob.state === 'flee' ? 6 : 2.5;
    mob.speed += (targetSpeed - mob.speed) * Math.min(1, accel * dt);

    if (moving || mob.speed > 0.05) {
      const dx = mob.targetX - mob.x;
      const dz = mob.targetZ - mob.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) {
        const desiredYaw = Math.atan2(dx, dz);
        let diff = desiredYaw - mob.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        // Turn rate scales with how fast it's going: a walking deer can pivot,
        // a galloping one has to arc. Snapping the heading instantly is the
        // other half of why the movement read as robotic.
        const turnRate = 1.4 + 1.6 / (1 + mob.speed * 0.35);
        mob.yaw += THREE.MathUtils.clamp(diff, -turnRate * dt, turnRate * dt);

        const nx = mob.x + Math.sin(mob.yaw) * mob.speed * dt;
        const nz = mob.z + Math.cos(mob.yaw) * mob.speed * dt;
        const ny = this.terrain.height(nx, nz);
        // Don't walk into water or up cliffs.
        if (ny > SEA_LEVEL + 0.4 && this.terrain.slopeAt(nx, nz) < 1.1) {
          mob.x = nx;
          mob.z = nz;
        }
      }
    }
    mob.y = this.terrain.height(mob.x, mob.z);
    mob.mesh.position.set(mob.x, mob.y, mob.z);
    mob.mesh.rotation.y = mob.yaw;
  }

  /**
   * Drive the model's own animation clips from the AI state. The models ship
   * with a real gait set, so an animal walks when it wanders, gallops when it
   * runs, and lunges when it strikes — instead of swinging four boxes on hinges.
   */
  private animate(mob: Mob, dt: number): void {
    // Pick the gait from how fast it's actually moving, not from the AI state —
    // an animal easing out of a run should finish in a walk, not cut to idle.
    const want =
      mob.state === 'attack'
        ? 'attack'
        : mob.speed > mob.def.speed * 0.75
          ? 'run'
          : mob.speed > 0.25
            ? 'walk'
            : 'idle';
    playClip(mob, want);

    // Match the clip's cadence to the real speed, or the feet skate.
    const cur = mob.current;
    if (cur && want === 'walk') cur.timeScale = THREE.MathUtils.clamp(mob.speed / 1.4, 0.5, 1.6);
    else if (cur && want === 'run') cur.timeScale = THREE.MathUtils.clamp(mob.speed / 5, 0.6, 1.5);
    else if (cur) cur.timeScale = 1;

    mob.mixer?.update(dt);
  }
}

/** Cross-fade the mob into a named action (see MobAnims). */
function playClip(mob: Mob, name: keyof MobAnims): void {
  const next = mob.anims?.[name];
  if (!next || mob.current === next) return;
  next.reset().fadeIn(0.25).play();
  mob.current?.fadeOut(0.25);
  mob.current = next;
}

interface MobAnims {
  idle: THREE.AnimationAction | null;
  walk: THREE.AnimationAction | null;
  run: THREE.AnimationAction | null;
  attack: THREE.AnimationAction | null;
}

/**
 * Which rigged model each creature uses — one real model per species.
 *
 * The roster in data/mobs.ts is deliberately built around the models we have.
 * Mapping a species onto a lookalike was worse than not having it: a "chicken"
 * wearing a white fox is instantly, absurdly wrong, and it undermines every
 * other creature on screen. Boar, bear, rabbit and chicken are out until there
 * are models for them.
 */
const MOB_MODEL: Record<string, string> = {
  deer: 'animals/deer',
  stag: 'animals/stag',
  wolf: 'animals/wolf',
  fox: 'animals/fox',
  cow: 'animals/cow',
  bull: 'animals/bull',
  horse: 'animals/horse',
  alpaca: 'animals/alpaca',
};

function buildMobMesh(def: MobDef): { mesh: THREE.Group; mixer: THREE.AnimationMixer; anims: MobAnims } {
  const path = MOB_MODEL[def.id] ?? 'animals/deer';
  const mesh = instantiate(path);

  // Models are authored at their own real-world sizes; MobDef.size is the scale
  // the gameplay expects, so normalise to ~1 m tall and then apply it.
  const h = modelHeight(mesh) || 1;
  mesh.scale.setScalar((def.size * 1.15) / h);

  const clips = clipsOf(path);
  const mixer = new THREE.AnimationMixer(mesh);
  const action = (...names: string[]): THREE.AnimationAction | null => {
    const clip = findClip(clips, ...names);
    return clip ? mixer.clipAction(clip) : null;
  };
  const anims: MobAnims = {
    idle: action('Idle', 'Idle_2'),
    walk: action('Walk', 'Walk_2'),
    run: action('Gallop', 'Run', 'Walk'),
    attack: action('Attack_Headbutt', 'Attack', 'Attack_Kick', 'Attack_Bite'),
  };
  return { mesh, mixer, anims };
}

