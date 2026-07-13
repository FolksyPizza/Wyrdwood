import * as THREE from 'three';
import type RAPIER_API from '@dimforge/rapier3d-compat';
import { Physics, RAPIER } from '../physics/physics';
import type { Input } from '../core/input';
import { Humanoid } from './humanoid';
import type { Appearance } from '../data/appearance';
import type { PlayerStats } from './stats';

const WALK_SPEED = 4.2;
const RUN_SPEED = 7.2;
const JUMP_VELOCITY = 7.5;
const GRAVITY = -22; // gamier than -9.81; snappier jumps
const CAPSULE_HALF = 0.65; // half-height of cylinder part
const CAPSULE_RADIUS = 0.35;

/**
 * Third-person player: Rapier kinematic character controller + humanoid
 * visuals. Movement is camera-relative; the model turns to face travel.
 */
export class PlayerController {
  readonly body: RAPIER_API.RigidBody;
  readonly controller: RAPIER_API.KinematicCharacterController;
  readonly humanoid: Humanoid;

  /** World position (feet), as of the last *physics* step. */
  readonly position = new THREE.Vector3();
  /** Position at the step before that — the other end of the interpolation. */
  private prevPosition = new THREE.Vector3();
  /**
   * Where the player is *drawn* this frame: `prevPosition` and `position` blended
   * by the loop's alpha.
   *
   * Physics runs on a fixed 60 Hz step, but the screen refreshes at whatever the
   * display does (120 Hz on this Mac, and not in phase with the sim). Drawing at
   * the raw simulated position means the player — and the camera following it —
   * sits still for some frames and lurches on others. That reads as a stuttering
   * camera even at a perfect frame rate, and it's why interpolation exists.
   */
  readonly renderPosition = new THREE.Vector3();
  private velocityY = 0;
  private velX = 0; // smoothed horizontal velocity (m/s)
  private velZ = 0;
  private facing = 0;
  grounded = false;
  /** Current horizontal speed (m/s) — read by animation/stamina. */
  speed = 0;
  running = false;

  constructor(
    physics: Physics,
    scene: THREE.Scene,
    appearance: Appearance,
    spawn: { x: number; y: number; z: number },
  ) {
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        spawn.y + CAPSULE_HALF + CAPSULE_RADIUS,
        spawn.z,
      ),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS),
      this.body,
    );

    this.controller = physics.world.createCharacterController(0.02);
    this.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((65 * Math.PI) / 180);
    this.controller.enableAutostep(0.55, 0.2, true);
    this.controller.enableSnapToGround(0.4);

    this.humanoid = new Humanoid(appearance);
    scene.add(this.humanoid.group);
  }

  /**
   * Fixed-tick update. `cameraYaw` = camera's horizontal angle so WASD is
   * camera-relative. `frozen` pauses control (chunk streaming, menus, death).
   */
  update(dt: number, input: Input, cameraYaw: number, stats: PlayerStats, frozen = false): void {
    // --- Desired horizontal move ---
    let mx = 0;
    let mz = 0;
    if (!frozen) {
      if (input.action('forward')) mz -= 1;
      if (input.action('back')) mz += 1;
      if (input.action('left')) mx -= 1;
      if (input.action('right')) mx += 1;
    }
    const hasInput = mx !== 0 || mz !== 0;
    this.running = hasInput && input.action('sprint') && stats.canRun;
    const speed = this.running ? RUN_SPEED : WALK_SPEED;

    // Target horizontal velocity from camera-relative input. W is ALWAYS
    // "away from the camera" (into the screen) regardless of body facing.
    // Camera sits at player + (sin(yaw), cos(yaw))*D and looks at the player,
    // so camera-forward = (-sin(yaw), -cos(yaw)); right = (cos(yaw), -sin(yaw)).
    let targetVX = 0;
    let targetVZ = 0;
    if (hasInput) {
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      const fwd = -mz; // W (mz=-1) → forward
      const right = mx; // D (mx=+1) → right
      let wx = -sin * fwd + cos * right;
      let wz = -cos * fwd - sin * right;
      const len = Math.hypot(wx, wz) || 1;
      wx /= len;
      wz /= len;
      targetVX = wx * speed;
      targetVZ = wz * speed;
      this.facing = Math.atan2(wx, wz); // body turns to face travel direction
    }
    // Smoothly approach the target velocity (quick to start, quick to stop).
    const accel = 1 - Math.exp(-dt * (hasInput ? 16 : 20));
    this.velX += (targetVX - this.velX) * accel;
    this.velZ += (targetVZ - this.velZ) * accel;
    const dx = this.velX * dt;
    const dz = this.velZ * dt;

    // --- Vertical: gravity + jump (costs stamina) ---
    if (this.grounded && !frozen && input.action('jump') && stats.spend(6)) {
      this.velocityY = JUMP_VELOCITY;
    }
    this.velocityY += GRAVITY * dt;
    this.velocityY = Math.max(this.velocityY, -30);

    // --- Move via character controller ---
    const collider = this.body.collider(0);
    this.controller.computeColliderMovement(collider, {
      x: dx,
      y: this.velocityY * dt,
      z: dz,
    });
    const corrected = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: t.x + corrected.x,
      y: t.y + corrected.y,
      z: t.z + corrected.z,
    });

    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocityY < 0) this.velocityY = -0.5; // stick to slopes

    this.prevPosition.copy(this.position);
    this.position.set(
      t.x + corrected.x,
      t.y + corrected.y - CAPSULE_HALF - CAPSULE_RADIUS,
      t.z + corrected.z,
    );
    this.speed = Math.hypot(corrected.x, corrected.z) / dt;
  }

  /** Teleport (respawn). */
  teleport(x: number, y: number, z: number): void {
    this.velocityY = 0;
    this.body.setNextKinematicTranslation({
      x,
      y: y + CAPSULE_HALF + CAPSULE_RADIUS,
      z,
    });
    this.position.set(x, y, z);
    // No interpolation across a teleport, or the player would streak across the
    // map from wherever they died.
    this.prevPosition.set(x, y, z);
    this.renderPosition.set(x, y, z);
  }

  /** Per-render-frame: sync visuals (smoothed turn + walk animation).
   * `alpha` is the fraction into the next fixed step (from the game loop). */
  syncVisuals(frameDt: number, alpha = 1): void {
    this.renderPosition.lerpVectors(this.prevPosition, this.position, alpha);
    this.humanoid.group.position.copy(this.renderPosition);
    // Shortest-path turn toward facing.
    let d = this.facing - this.humanoid.group.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // wrap to [-π, π]
    this.humanoid.group.rotation.y += d * Math.min(frameDt * 12, 1);
    this.humanoid.animate(frameDt, this.speed, this.grounded);
  }
}
