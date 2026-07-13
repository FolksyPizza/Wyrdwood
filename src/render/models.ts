import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Rigged, animated glTF models (Quaternius, CC0 — see scripts/fetch-assets.mjs).
 *
 * Animals and people were built from spheres and cylinders, and no amount of
 * reshaping primitives makes a deer look like a deer: what reads as a living
 * creature is anatomy *plus motion* — the gait, the head bob, the ears. So the
 * creatures are real skinned meshes with real animation clips now.
 *
 * Everything is preloaded during the loading screen (`preloadModels`) so the
 * rest of the game can pull a model synchronously whenever it spawns something.
 */

export interface ModelAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

const loader = new GLTFLoader();
const loaded = new Map<string, ModelAsset>();

const MODEL_PATHS = [
  'animals/deer',
  'animals/stag',
  'animals/wolf',
  'animals/fox',
  'animals/cow',
  'animals/bull',
  'animals/horse',
  'animals/alpaca',
  'animals/husky',
  'char/anims',
];

/**
 * Turn a flat model material into fur.
 *
 * The animal models are smooth shells with a flat colour, which is why their
 * rounded shapes read as plastic toys — a real coat is fibrous, so it scatters
 * light instead of returning a clean specular highlight, and it catches a bright
 * fringe where it's grazed by light at the silhouette.
 *
 * Two things buy nearly all of that:
 *  - `sheen` (MeshPhysicalMaterial): the retroreflective fuzz lobe that cloth and
 *    fur have. It gives the rim glow, and it needs no UVs at all.
 *  - A high-frequency perturbation of the normal, derived procedurally from the
 *    object-space position. These models are UV-mapped onto a tiny colour atlas,
 *    so a tiling normal map is useless on them — but a 3D noise evaluated in
 *    object space needs no UVs and never seams.
 */
function furMaterial(src: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const fur = new THREE.MeshPhysicalMaterial({
    color: src.color,
    map: src.map,
    roughness: 0.95, // fur has essentially no mirror specular
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.75,
    // Fur's fringe is a paler version of the coat, not white.
    sheenColor: src.color.clone().lerp(new THREE.Color(0xffffff), 0.55),
  });
  fur.name = src.name;

  fur.onBeforeCompile = (sh) => {
    sh.vertexShader =
      'varying vec3 vFurPos;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  vFurPos = position;`);

    sh.fragmentShader =
      `varying vec3 vFurPos;
       // Cheap value noise — enough for a coat's texture; no texture fetch.
       float furHash(vec3 p) {
         return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
       }
       float furNoise(vec3 p) {
         vec3 i = floor(p), f = fract(p);
         f = f * f * (3.0 - 2.0 * f);
         float n = mix(
           mix(mix(furHash(i + vec3(0,0,0)), furHash(i + vec3(1,0,0)), f.x),
               mix(furHash(i + vec3(0,1,0)), furHash(i + vec3(1,1,0)), f.x), f.y),
           mix(mix(furHash(i + vec3(0,0,1)), furHash(i + vec3(1,0,1)), f.x),
               mix(furHash(i + vec3(0,1,1)), furHash(i + vec3(1,1,1)), f.x), f.y), f.z);
         return n;
       }
      ` + sh.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         // Ruffle the surface normal at fur scale. Sampling the noise field at
         // three offset points gives its gradient, which is the direction the
         // "hairs" lean — pushing the normal along it makes the coat catch light
         // unevenly, the way a real one does.
         float fs = 90.0;
         float n0 = furNoise(vFurPos * fs);
         vec3 furGrad = vec3(
           furNoise(vFurPos * fs + vec3(0.7, 0.0, 0.0)) - n0,
           furNoise(vFurPos * fs + vec3(0.0, 0.7, 0.0)) - n0,
           furNoise(vFurPos * fs + vec3(0.0, 0.0, 0.7)) - n0);
         normal = normalize(normal + furGrad * 1.4);
         // Coarser clumping in the coat's colour, so it isn't one flat tone.
         diffuseColor.rgb *= 0.9 + 0.2 * furNoise(vFurPos * 26.0);
        `,
      );
  };
  return fur;
}

/** Load every model up front. Resolves when they're all in the cache. */
export async function preloadModels(onProgress?: (frac: number) => void): Promise<void> {
  let done = 0;
  await Promise.all(
    MODEL_PATHS.map(async (name) => {
      const gltf = await loader.loadAsync(`assets/${name}.glb`);
      // These packs are authored with unlit-ish flat materials. Nudging them
      // towards matte, non-metallic PBR lets them sit in the same light as the
      // scanned terrain instead of looking like stickers pasted on top.
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // A SkinnedMesh's bounding sphere is computed in bind pose, so once the
        // skeleton moves the body outside it, three culls the whole creature —
        // it blinks out of existence mid-stride. There are only a handful of
        // these on screen; just always draw them.
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;

        const furred = name.startsWith('animals/');
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const next = mats.map((m) => {
          const std = m as THREE.MeshStandardMaterial;
          if (!std.isMeshStandardMaterial) return m;
          // Eyes and hooves are hard, shiny surfaces — fur on them looks wrong.
          const bare = /eye|hoof|hooves|horn|antler|beak|nose|tooth|claw/i.test(std.name);
          if (furred && !bare) return furMaterial(std);
          std.metalness = 0;
          std.roughness = bare ? 0.35 : 0.85;
          return std;
        });
        mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
      });
      loaded.set(name, { scene: gltf.scene, clips: gltf.animations });
      done++;
      onProgress?.(done / MODEL_PATHS.length);
    }),
  );
}

/**
 * A fresh, independently-animatable instance of a preloaded model.
 *
 * Must use SkeletonUtils.clone, not Object3D.clone: a plain clone copies the
 * SkinnedMeshes but leaves them bound to the *original's* skeleton, so every
 * copy of an animal would play the same animation in lockstep.
 */
export function instantiate(name: string): THREE.Group {
  const asset = loaded.get(name);
  if (!asset) throw new Error(`model "${name}" was not preloaded`);
  return cloneSkinned(asset.scene) as THREE.Group;
}

/** The animation clips shipped with a model. */
export function clipsOf(name: string): THREE.AnimationClip[] {
  return loaded.get(name)?.clips ?? [];
}

/**
 * Find a clip by the tail of its name, ignoring the armature prefix — clips are
 * exported as e.g. "AnimalArmature|Walk" or "HumanArmature|Idle".
 */
export function findClip(
  clips: THREE.AnimationClip[],
  ...names: string[]
): THREE.AnimationClip | null {
  for (const want of names) {
    const hit = clips.find((c) => {
      const tail = c.name.split('|').pop() ?? c.name;
      return tail.toLowerCase() === want.toLowerCase();
    });
    if (hit) return hit;
  }
  return null;
}

/**
 * Height of a model in world units — used to scale it to a target size.
 *
 * `Box3.setFromObject` is wrong for these: a SkinnedMesh stores its vertices in
 * bind space and lets the skeleton place them, so the raw geometry bounds are
 * meaningless (for these models, about 1 cm tall). Box3 would then report some
 * unrelated number and we'd scale the character down to a speck. SkinnedMesh has
 * `computeBoundingBox`, which actually skins the vertices first — use that.
 */
export function modelHeight(obj: THREE.Object3D): number {
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    const skinned = o as THREE.SkinnedMesh;
    const mesh = o as THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      skinned.computeBoundingBox();
      if (skinned.boundingBox) box.union(part.copy(skinned.boundingBox));
    } else if (mesh.isMesh) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (bb) box.union(part.copy(bb).applyMatrix4(mesh.matrixWorld));
    }
  });
  return box.isEmpty() ? 0 : box.max.y - box.min.y;
}
