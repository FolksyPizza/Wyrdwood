import * as THREE from 'three';
import type { GameRenderer } from '../render/renderer';
import { worldConfig } from '../data/difficulty';

const DAY_SKY = new THREE.Color(0x87b5e0);
const DUSK_SKY = new THREE.Color(0xd98e57);
const NIGHT_SKY = new THREE.Color(0x0c1224);
const DAY_SUN = new THREE.Color(0xfff2d8);
const DUSK_SUN = new THREE.Color(0xff9d5c);
/** Moonlight is dim and cold, and it is *blue* — that's what reads as night. */
const MOON = new THREE.Color(0x93b0e8);

/**
 * When the sun crosses the horizon, as a fraction of the full cycle. A plain
 * sine gives an equal 50/50 split, which is not what a day feels like: the
 * default cycle is 30 minutes and the player wants most of it to be usable.
 * 0.15 → 0.85 is 70% daylight (21 min day, 9 min night at the default length).
 */
const SUNRISE = 0.15;
const SUNSET = 0.85;

/**
 * The sun's angle for a given time of day, in radians: 0 at sunrise, π at
 * sunset, π→2π through the night. Time is warped so the daylight arc occupies
 * SUNRISE→SUNSET of the clock while still sweeping a full half-circle — that's
 * what lets the day be longer than the night without the sun jumping.
 *
 * Shared with SkyDome so the sky, the sun light and the shadows never disagree.
 */
export function solarAngle(t: number): number {
  const dayLen = SUNSET - SUNRISE;
  if (t >= SUNRISE && t < SUNSET) {
    return Math.PI * ((t - SUNRISE) / dayLen);
  }
  const nightLen = 1 - dayLen;
  const p = t >= SUNSET ? (t - SUNSET) / nightLen : (t + (1 - SUNSET)) / nightLen;
  return Math.PI + Math.PI * p;
}

/** Sun height, -1 (midnight) … +1 (noon). Above 0 = above the horizon. */
export function sunElevation(t: number): number {
  return Math.sin(solarAngle(t));
}

/**
 * Day/night cycle: drives sun position/color and light intensities from a
 * normalized time-of-day (0 = midnight, 0.5 = midday).
 */
export class DayNight {
  /** Normalized time of day [0,1). Starts mid-morning. */
  time = 0.35;

  private sky = new THREE.Color();
  private sunColor = new THREE.Color();

  update(dt: number, gfx: GameRenderer, focus: THREE.Vector3): void {
    const dayLength = worldConfig.world.dayLengthMin * 60;
    this.time = (this.time + dt / dayLength) % 1;

    const ang = solarAngle(this.time);
    const elevation = Math.sin(ang);
    const night = elevation < 0;

    // The key light. At night it becomes the *moon*: the same directional light,
    // moved to the opposite side of the sky and turned cold and dim. Leaving it
    // buried under the horizon (the old behaviour) meant nothing cast a shadow
    // and the world was lit only by a scrap of ambient — which is exactly why
    // night was unplayable.
    const dist = 120;
    const keyAng = night ? ang + Math.PI : ang;
    const keyHeight = Math.abs(elevation);
    gfx.sun.position.set(
      focus.x + Math.cos(keyAng) * dist,
      focus.y + Math.max(0.15, keyHeight) * dist,
      focus.z + Math.sin(keyAng * 0.5) * 40,
    );
    gfx.sun.target.position.copy(focus);
    gfx.sun.target.updateMatrixWorld();

    const dayness = THREE.MathUtils.clamp(elevation * 3, 0, 1); // fast ramp near the horizon
    const duskness = THREE.MathUtils.clamp(1 - Math.abs(elevation) * 4, 0, 1);
    const nightness = 1 - dayness;
    this.sky.copy(NIGHT_SKY).lerp(DAY_SKY, dayness).lerp(DUSK_SKY, duskness * 0.55);

    // How far below the horizon the sun is: 0 by day, 1 in deep night.
    const darknessKey = THREE.MathUtils.clamp(-elevation * 3, 0, 1);

    // Sun by day, moon by night, warm at the horizon.
    this.sunColor.copy(DAY_SUN).lerp(DUSK_SUN, duskness).lerp(MOON, darknessKey * 0.85);
    gfx.sun.color.copy(this.sunColor);
    // Moonlight is roughly 1/400,000 of sunlight in reality — but a game that
    // simulated that would just be black. This is the cinema convention: enough
    // cold key light to read shapes and cast soft shadows, dim enough that a
    // campfire still matters.
    gfx.sun.intensity = 3.4 * dayness + 0.95 * darknessKey;

    // Ground-bounce fill. Small by day (the sky environment map does that work),
    // but it has to carry more of the load at night.
    gfx.ambient.intensity = 0.06 + 0.1 * dayness + 0.5 * darknessKey;
    gfx.ambient.color.copy(DAY_SKY).lerp(NIGHT_SKY, nightness).lerp(DUSK_SKY, duskness * 0.4);
    gfx.ambient.groundColor.setRGB(
      0.15 + dayness * 0.2,
      0.18 + dayness * 0.22,
      0.12 + dayness * 0.12,
    );

    // How strongly PBR materials pick up the sky.
    gfx.scene.environmentIntensity = 0.14 + 0.42 * dayness + 0.25 * darknessKey;

    // Exposure.
    //
    // `nightness` is 1 - dayness, and dayness ramps over elevation*3 — so it
    // only reaches 1 once the sun is a third of the way up the sky. That means
    // "nightness" is still 0.4 at mid-morning, and the night boost was being
    // applied in broad daylight, blowing the morning and evening out. Exposure
    // has to key off how far *below* the horizon the sun actually is, not off
    // the inverse of a curve that was tuned for something else.
    gfx.renderer.toneMappingExposure = 0.95 + darknessKey * 1.5 + duskness * 0.1;
  }

  get isNight(): boolean {
    return sunElevation(this.time) < -0.05;
  }
}
