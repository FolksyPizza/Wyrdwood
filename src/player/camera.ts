import * as THREE from 'three';
import type { Input } from '../core/input';
import type { Terrain } from '../world/terrain';
import { settings } from '../data/settings';

const BASE_SENSITIVITY = 0.0022;
const DISTANCE = 5.5;
const HEAD_HEIGHT = 1.55;
/** Sprinting widens the lens by this much, on top of the player's FOV setting. */
const SPRINT_FOV_KICK = 6;

/**
 * Third-person follow camera: free mouse-look orbit with spring-damped
 * position, impact shake, and a sprint FOV kick. `moveYaw` is the WASD basis:
 * it follows the camera yaw unless free-look is held (so you can look around
 * without curving your path). Kept above terrain.
 */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.35;
  /** Movement basis — the direction W means. Frozen during free-look. */
  moveYaw = 0;

  private target = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private smoothed = new THREE.Vector3();
  private initialized = false;
  private shake = 0;
  private fov = settings.fov;

  /** Kick the camera (damage, explosions). amount ~0.2-0.6. */
  addShake(amount: number): void {
    this.shake = Math.min(this.shake + amount, 0.8);
  }

  update(
    camera: THREE.PerspectiveCamera,
    input: Input,
    playerPos: THREE.Vector3,
    terrain: Terrain,
    frameDt = 1 / 60,
    sprinting = false,
    freeLook = false,
  ): void {
    const { dx, dy } = input.consumeMouseDelta();
    const s = BASE_SENSITIVITY * settings.mouseSensitivity;
    this.yaw -= dx * s;
    const iy = settings.invertY ? -1 : 1;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * s * iy, -0.5, 1.25);
    // Movement basis tracks the camera except while free-looking.
    if (!freeLook) this.moveYaw = this.yaw;

    this.target.set(playerPos.x, playerPos.y + HEAD_HEIGHT, playerPos.z);

    const cp = Math.cos(this.pitch);
    this.desired.set(
      this.target.x + Math.sin(this.yaw) * cp * DISTANCE,
      this.target.y + Math.sin(this.pitch) * DISTANCE,
      this.target.z + Math.cos(this.yaw) * cp * DISTANCE,
    );

    // Keep the camera above the ground.
    const groundY = terrain.height(this.desired.x, this.desired.z) + 0.4;
    if (this.desired.y < groundY) this.desired.y = groundY;

    // Spring-damped follow (snappier horizontally than vertically).
    if (!this.initialized) {
      this.smoothed.copy(this.desired);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-frameDt * 14);
      this.smoothed.lerp(this.desired, k);
    }

    // Impact shake decays quickly.
    let sx = 0;
    let sy = 0;
    if (this.shake > 0.001) {
      sx = (Math.random() - 0.5) * this.shake * 0.35;
      sy = (Math.random() - 0.5) * this.shake * 0.35;
      this.shake *= Math.exp(-frameDt * 7);
    }

    camera.position.set(this.smoothed.x + sx, this.smoothed.y + sy, this.smoothed.z);
    camera.lookAt(this.target.x + sx, this.target.y + sy, this.target.z);

    // Sprint FOV kick, relative to whatever FOV the player chose in settings —
    // hard-coding 70 here silently overrode their choice every frame.
    const targetFov = settings.fov + (sprinting ? SPRINT_FOV_KICK : 0);
    if (Math.abs(this.fov - targetFov) > 0.05) {
      this.fov += (targetFov - this.fov) * Math.min(frameDt * 6, 1);
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}
