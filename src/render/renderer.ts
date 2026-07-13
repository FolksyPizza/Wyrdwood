import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { onSettingsChange, quality, settings } from '../data/settings';

/**
 * Final grade. Deliberately gentle.
 *
 * AgX already delivers filmic contrast and a soft highlight roll-off, so the old
 * grade — +16% saturation on top of +7% contrast — was double-processing an
 * image that was already graded: it crushed the shadows and pushed the sky to
 * clipping. All this does now is a touch of warmth in the lows and a whisper of
 * saturation back (AgX desaturates highlights by design, which is correct, but
 * it can leave foliage looking a little grey).
 */
const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, saturation: { value: 1.28 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float saturation; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);                 // AgX is flat by design
      c = c * c * (3.0 - 2.0 * c);                     // gentle S-curve: deepen lows, hold highs
      c = mix(texture2D(tDiffuse, vUv).rgb, c, 0.55);  // ...but only halfway, so it stays filmic
      c += vec3(0.014, 0.009, 0.004) * (1.0 - l);      // warm the shadows, don't lift the sky
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

/**
 * Teach GTAO about alpha cutouts.
 *
 * GTAOPass builds its depth+normal buffer by setting `scene.overrideMaterial` to
 * one shared MeshNormalMaterial — and that material's shader contains no alpha
 * chunk at all, so it cannot cut out. Every grass tuft and leaf card therefore
 * writes its **whole quad** into the depth buffer, and the AO shades each one as
 * though it were a solid box: you get a dark rectangle around every blade of
 * grass.
 *
 * The fix is to stop using one override material and instead swap in a *matching*
 * normal material per source material — one that discards the same texels the
 * real material does. Cached per material, so this is a map lookup per mesh.
 */
const normalMatCache = new WeakMap<THREE.Material, THREE.MeshNormalMaterial>();

function cutoutNormalMaterial(src: THREE.Material): THREE.MeshNormalMaterial {
  const hit = normalMatCache.get(src);
  if (hit) return hit;

  const std = src as THREE.MeshStandardMaterial;
  const out = new THREE.MeshNormalMaterial();
  out.blending = THREE.NoBlending;
  out.side = std.side ?? THREE.FrontSide;

  if (std.alphaTest > 0 && (std.alphaMap || std.map)) {
    // Where the cutout lives: a separate greyscale alphaMap (grass, ferns), or
    // the alpha channel of the colour map (the composited leaf-cluster cards).
    const cut = std.alphaMap ?? std.map!;
    const fromAlphaChannel = !std.alphaMap;
    const threshold = std.alphaTest;

    out.onBeforeCompile = (sh) => {
      sh.uniforms['uCut'] = { value: cut };
      sh.vertexShader =
        'varying vec2 vCutUv;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vCutUv = uv;');
      sh.fragmentShader =
        'uniform sampler2D uCut;\nvarying vec2 vCutUv;\n' +
        sh.fragmentShader.replace(
          'void main() {',
          `void main() {
             vec4 cutTex = texture2D(uCut, vCutUv);
             float cutA = ${fromAlphaChannel ? 'cutTex.a' : 'cutTex.g'};
             if (cutA < ${threshold.toFixed(3)}) discard;
          `,
        );
    };
    // Distinct cache key, or three reuses one compiled program for all of them.
    out.customProgramCacheKey = () => `ao-cutout-${src.uuid}`;
  }

  normalMatCache.set(src, out);
  return out;
}

/**
 * Owns the WebGL renderer, scene, camera, base lighting/atmosphere, and the
 * post-processing chain (bloom + vignette). Gameplay systems add/remove
 * objects from `scene`.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  private composer: EffectComposer;
  /** Post passes, kept so the settings sliders can retune them live. */
  private bloomPass!: UnrealBloomPass;
  private vignettePass!: ShaderPass;
  private gradePass!: ShaderPass;
  private aoPass!: GTAOPass;
  private smaaPass!: SMAAPass;

  constructor(container: HTMLElement) {
    const q = quality();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // AgX, not ACES. ACES clips a bright sky to flat white and skews saturated
    // colours towards the primaries — with a physical sky, that means a blown
    // horizon and a scene where the only way to hold the highlights is to pull
    // the exposure so far down that the shadows go black. AgX has a much longer
    // highlight shoulder: the sun and sky roll off gracefully instead of
    // clipping, so the land can sit at a normal exposure and keep its midtones.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0; // day/night drives the live value
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const skyBlue = new THREE.Color(0x87b5e0);
    this.scene.background = skyBlue;
    // Exponential fog reads far more natural for open terrain than near/far;
    // density is driven per-frame by the day/night cycle (SkyDome).
    this.scene.fog = new THREE.FogExp2(skyBlue, 0.0013);

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(12, 10, 16);
    this.camera.lookAt(0, 1, 0);

    // Sun — warm directional light with shadows.
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
    this.sun.position.set(40, 60, 25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 320;
    this.sun.shadow.bias = -0.0002; // kills shadow acne
    this.sun.shadow.normalBias = 0.03; // kills peter-panning
    this.sun.shadow.radius = 4; // softer PCF edges
    // Half-width of the sun's shadow box, in metres. At 48 m the shadow map ran
    // out a couple of trees away and the whole middle distance was flat and
    // unshadowed, which is a large part of why the landscape looked fake — a
    // real hillside is legible precisely *because* of where its shadows fall.
    // The box follows the player (DayNight orbits the sun around them), so this
    // is a radius around the camera, not a world bound.
    const s = 95;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Sky/ground bounce light.
    this.ambient = new THREE.HemisphereLight(0xbfd8ff, 0x5c6b45, 0.9);
    this.scene.add(this.ambient);

    // Post-processing. Order matters a great deal here:
    //
    //   Render → Bloom → OutputPass → Vignette → Grade
    //
    // Everything before OutputPass sees *linear HDR* values, where the sky is
    // several times brighter than 1.0. So bloom must run there (that is what
    // makes fire and the sun glow), and its threshold has to be well above 1
    // or the whole sky crosses it and bleeds a milky haze over the frame.
    // Conversely the grade must run *after* OutputPass: it clamps to 0–1, which
    // in HDR would flatten every highlight and undo the ACES tone mapping.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Ambient occlusion. This is the single biggest thing separating a scene
    // that looks rendered from one that looks photographed: in reality, ambient
    // sky light can't reach into the crease where a trunk meets the ground, or
    // between blades of grass, or under a rock — so those places go darker.
    // Without it every object looks pasted *onto* the ground rather than sitting
    // *in* it, no matter how good the textures are. GTAO computes it from the
    // depth+normal buffers, so it costs no extra geometry.
    const ao = new GTAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
    ao.updateGtaoMaterial({
      radius: 0.5, // metres — contact-scale, not a big soft dome
      distanceExponent: 1.0,
      thickness: 1.0,
      scale: 1.0,
      samples: 16,
      screenSpaceRadius: false,
    });
    // Replace GTAO's shared-override depth/normal render with a per-material one
    // that respects alpha cutouts (see cutoutNormalMaterial above).
    const swapped: { mesh: THREE.Mesh; mat: THREE.Material | THREE.Material[] }[] = [];
    const hidden: THREE.Mesh[] = [];
    const clearColour = new THREE.Color();
    type OverrideFn = (
      renderer: THREE.WebGLRenderer,
      overrideMaterial: THREE.Material,
      renderTarget: THREE.WebGLRenderTarget,
      clearColor: number,
      clearAlpha: number,
    ) => void;
    (ao as unknown as { _renderOverride: OverrideFn })._renderOverride = (
      renderer,
      _overrideMaterial,
      renderTarget,
      clearColor,
      clearAlpha,
    ) => {
      renderer.getClearColor(clearColour);
      const originalClearAlpha = renderer.getClearAlpha();
      const originalAutoClear = renderer.autoClear;

      renderer.setRenderTarget(renderTarget);
      renderer.autoClear = false;
      if (clearColor !== undefined && clearColor !== null) {
        renderer.setClearColor(clearColor);
        renderer.setClearAlpha(clearAlpha || 0.0);
        renderer.clear();
      }

      swapped.length = 0;
      hidden.length = 0;
      this.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;

        // Grass is ~3.4M triangles. Rendering it a SECOND time to build the AO
        // depth buffer roughly doubles the frame's geometry cost, and buys very
        // little: a blade of grass occluding another blade of grass is a subtlety
        // nobody sees, while the AO that actually matters — under trees, in rock
        // creases, where a trunk meets the ground — comes from the solid geometry.
        // So the dense foliage sits this pass out.
        if (mesh.userData['noAO'] === true) {
          if (mesh.visible) {
            hidden.push(mesh);
            mesh.visible = false;
          }
          return;
        }

        swapped.push({ mesh, mat: mesh.material });
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(cutoutNormalMaterial)
          : cutoutNormalMaterial(mesh.material);
      });
      renderer.render(this.scene, this.camera);
      for (const s of swapped) s.mesh.material = s.mat;
      for (const m of hidden) m.visible = true;

      renderer.autoClear = originalAutoClear;
      renderer.setClearColor(clearColour);
      renderer.setClearAlpha(originalClearAlpha);
    };

    this.composer.addPass(ao);

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.3, // strength
      0.6, // radius
      // Threshold, in *linear HDR*. This has to sit ABOVE the sky's clamped
      // ceiling (see clampSkyRadiance in sky.ts, currently 12) — otherwise the
      // whole bright sky crosses the threshold, blooms, and bleeds a white haze
      // right across the landscape. That is what has been washing the distance
      // out. Only fire, and the sun disc itself, should be above this.
      11.5,
    );
    this.composer.addPass(bloom);
    // Tone-map + sRGB encode. Always on: this is the conversion the renderer
    // would otherwise do itself, not an optional effect.
    this.composer.addPass(new OutputPass());
    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms['offset']!.value = 0.92;
    this.composer.addPass(vignette);
    // Colour grade: lift saturation + gentle contrast (Valheim/Aska lean on this).
    const grade = new ShaderPass(GRADE_SHADER);
    this.composer.addPass(grade);

    // Anti-aliasing. The renderer's own MSAA does nothing once EffectComposer is
    // in play — passes render into their own targets, and the browser's MSAA
    // only applies to the default framebuffer. So every edge in the game has
    // been aliased this whole time: hard stair-steps on every trunk, and the
    // alpha-cut grass and leaves crawl and shimmer as the camera moves. SMAA
    // runs last, on the final image, and fixes both.
    const smaa = new SMAAPass();
    this.composer.addPass(smaa);

    this.aoPass = ao;
    this.smaaPass = smaa;
    this.bloomPass = bloom;
    this.vignettePass = vignette;
    this.gradePass = grade;

    this.applyQuality();
    onSettingsChange(this.applyQuality);
    window.addEventListener('resize', this.onResize);
  }

  /** Re-read the quality preset and push it into the renderer + post chain. */
  private applyQuality = (): void => {
    const q = quality();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (q.shadows && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      // Force the shadow map to be rebuilt at the new resolution.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    // Post-FX: each effect is its own slider, and a strength of 0 disables that
    // pass outright rather than paying for a no-op fullscreen draw.
    this.bloomPass.strength = q.bloom;
    this.bloomPass.enabled = q.postFX && q.bloom > 0.001;
    this.vignettePass.uniforms['darkness']!.value = q.vignette;
    this.vignettePass.enabled = q.postFX && q.vignette > 0.001;
    this.gradePass.uniforms['saturation']!.value = settings.saturation;
    this.gradePass.enabled = q.postFX;
    this.aoPass.enabled = settings.ao;
    this.smaaPass.enabled = settings.antialias;

    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    // Shadow-enable changes require every material to recompile.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  };

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
