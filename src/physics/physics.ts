import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Wraps Rapier: WASM init, the physics world, and the fixed-rate step.
 * All colliders/bodies for gameplay are created through `world`.
 */
export class Physics {
  private constructor(readonly world: RAPIER.World) {}

  static async create(): Promise<Physics> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    return new Physics(world);
  }

  /** Advance the simulation by `dt` seconds (call from the fixed update). */
  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }
}

export { RAPIER };
