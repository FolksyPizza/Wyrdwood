import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mulberry32 } from '../world/noise';
import { worldClock } from './textures';
import { solarAngle, type DayNight } from '../core/daynight';
import type { GameRenderer } from './renderer';

/**
 * Sky: atmospheric-scattering dome (realistic horizon glow / sunrise / sunset)
 * plus a night star dome + moon. The Sky's sun direction and the scene fog
 * are driven by the day/night cycle; stars fade in after dusk.
 */

/**
 * The Sky shader is physically bright: around the sun disc its radiance runs to
 * five or six figures. On screen that's harmless — the tone mapper squashes it.
 * But PMREM bakes into a HALF-FLOAT target, whose ceiling is 65504, so those
 * pixels overflow to Inf, the blur chain smears Inf into NaN, and every material
 * lit by the resulting environment map renders pure black.
 *
 * Clamping the radiance for the environment-only copy of the sky fixes it. The
 * clamp is invisible in the result: the ambient contribution of the sun disc is
 * a handful of pixels, while the sun's actual light comes from the directional
 * light, not from IBL.
 */
function clampSkyRadiance(mat: THREE.ShaderMaterial): void {
  mat.fragmentShader = mat.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    'gl_FragColor = vec4( min( texColor, vec3( 40.0 ) ), 1.0 );',
  );
  mat.needsUpdate = true;
}

export class SkyDome {
  private sky: Sky;
  private stars: THREE.Points;
  private starMat: THREE.PointsMaterial;
  private moon: THREE.Mesh;
  private group = new THREE.Group();
  private sunDir = new THREE.Vector3();

  // Image-based lighting. A single hemisphere light gives every surface the same
  // flat fill from above, which is a big part of why a scene reads as "computer
  // graphics" — real ambient light is the sky itself, warm near the sun and cool
  // opposite it. So we bake the live sky into an environment map and let three's
  // PBR materials light from it. Rebuilt only when the sun has actually moved.
  private pmrem: THREE.PMREMGenerator | null = null;
  private envSky = new Sky();
  private envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lastEnvElevation = 99;

  constructor(scene: THREE.Scene) {
    // Atmospheric sky dome.
    this.sky = new Sky();
    this.sky.scale.setScalar(6000);
    const u = this.sky.material.uniforms;
    u['turbidity']!.value = 5;
    u['rayleigh']!.value = 1.8;
    // Mie scattering is the forward glare around the sun. At 0.004/0.75 the halo
    // was enormous: looking anywhere near the sun drowned the entire landscape
    // in white, which is most of what read as "washed out". Real air scatters
    // less than this, and a game has to be legible in every direction.
    u['mieCoefficient']!.value = 0.0016;
    u['mieDirectionalG']!.value = 0.6;
    // three's Sky has real volumetric cloud noise built in — drifting cumulus,
    // lit from the sun's side. Far better than a painted cloud texture, and it
    // reacts to sunrise/sunset for free.
    u['cloudScale']!.value = 0.00018;
    u['cloudSpeed']!.value = 0.00006;
    u['cloudCoverage']!.value = 0.45;
    u['cloudDensity']!.value = 0.55;
    u['cloudElevation']!.value = 0.42;
    scene.add(this.sky);

    this.envSky.scale.setScalar(100);
    clampSkyRadiance(this.envSky.material as THREE.ShaderMaterial);
    this.envScene.add(this.envSky);
    const rng = mulberry32(0x57a125);
    const count = 700;
    const positions = new Float32Array(count * 3);
    const R = 780;
    for (let i = 0; i < count; i++) {
      // Random points on the upper hemisphere.
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(rng() * 0.95); // bias away from horizon
      positions[i * 3] = R * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = R * Math.cos(phi);
      positions[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xcdd8ff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false;

    const moonMat = new THREE.MeshBasicMaterial({ color: 0xe8ecf5, fog: false });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 16), moonMat);

    this.group.add(this.stars, this.moon);
    scene.add(this.group);
  }

  update(dayNight: DayNight, playerPos: THREE.Vector3, gfx?: GameRenderer): void {
    this.sky.position.set(playerPos.x, 0, playerPos.z);
    this.group.position.set(playerPos.x, 0, playerPos.z);
    // Same warped solar clock the lighting uses — if the sky ran on its own
    // angle the sun would set at a different time than the light went out.
    const ang = solarAngle(dayNight.time);
    const elevation = Math.sin(ang);
    const dayness = THREE.MathUtils.clamp(elevation * 3, 0, 1);

    // Drive the atmospheric sky's sun direction from the day/night angle.
    const azimuth = Math.cos(ang * 0.5) * 0.6;
    this.sunDir.set(Math.cos(ang), elevation, Math.sin(ang) * 0.5 + azimuth * 0.15).normalize();
    const u = this.sky.material.uniforms;
    u['sunPosition']!.value.copy(this.sunDir);
    // Thicker atmosphere near the horizon exaggerates sunrise/sunset reds.
    // Turbidity is haze: high values give a milky white sky, so a clear midday
    // wants it low, and only the low sun gets the thick, warm, hazy air.
    u['rayleigh']!.value = 1.6 + (1 - Math.abs(elevation)) * 2.0;
    u['turbidity']!.value = 1.8 + (1 - Math.abs(elevation)) * 3.0;
    u['time']!.value = worldClock.value; // drifts the clouds

    this.starMat.opacity = (1 - dayness) * 0.9;
    this.moon.position.set(Math.cos(ang + Math.PI) * 700, -elevation * 700, 130);
    this.moon.visible = -elevation > -0.15;
    this.stars.rotation.y = dayNight.time * Math.PI * 2 * 0.3;

    // Fog color tracks the horizon; density clears by day, thickens at night
    // and dawn/dusk for atmospheric depth (less blue than before = less "milky").
    if (gfx?.scene.fog instanceof THREE.FogExp2) {
      const fog = gfx.scene.fog;
      const night = 0.02 + dayness * 0.01;
      // Aerial perspective, not milk. Fog should tint distant hills towards the
      // horizon's colour, so it stays a touch darker and bluer than the sky —
      // matching the sky exactly is what produced the white-out haze, because
      // the far terrain then dissolved into the background completely.
      // Deliberately darker and less saturated than the sky. Fog that matches the
      // sky exactly makes distant land dissolve into the background — which is
      // exactly the white-out. Distant hills should read as *hills*, just paler
      // and bluer than near ones.
      fog.color.setRGB(
        night + dayness * 0.2 + (1 - Math.abs(elevation)) * 0.14, // keep sunset warmth
        night + dayness * 0.26,
        night + dayness * 0.36,
      );
      // Thin: a clear day has very little haze inside a few hundred metres.
      fog.density = 0.0007 + (1 - dayness) * 0.001;
    }

    if (gfx) this.updateEnvironment(gfx, elevation);
  }

  /**
   * Re-bake the sky into an environment map when the sun has moved enough to
   * matter. PMREM is a real cost (a cube render + several blur passes), so it is
   * gated — at ~0.03 of elevation the ambient light hasn't visibly changed.
   */
  private updateEnvironment(gfx: GameRenderer, elevation: number): void {
    if (Math.abs(elevation - this.lastEnvElevation) < 0.03) return;
    this.lastEnvElevation = elevation;

    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(gfx.renderer);
      this.pmrem.compileEquirectangularShader();
    }
    // Mirror the live sky's look into the (tiny) env-only sky.
    const src = this.sky.material.uniforms;
    const dst = this.envSky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) {
      dst[k]!.value = src[k]!.value;
    }
    dst['sunPosition']!.value.copy(this.sunDir);

    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene);
    gfx.scene.environment = this.envTarget.texture;
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.pmrem?.dispose();
  }
}
