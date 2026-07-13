import * as THREE from 'three';
import { loadTerrainMaps } from './assets';

/**
 * PBR terrain material: four photoscanned ground layers (grass / rock / sand /
 * snow) blended per-pixel from a per-vertex weight attribute (`aSplat`), lit by
 * real albedo + normal + roughness/AO maps.
 *
 * Two things make this work with three's built-in lighting instead of fighting it:
 *
 *  - The chunk geometry's `uv` attribute is set to *world* XZ (see chunks.ts), so
 *    the material's tangent frame — which three derives from the uv derivatives —
 *    is correct for every layer, and neighbouring chunks tile seamlessly. Scaling
 *    a layer's uv only changes tangent magnitude, which normalizes out, so each
 *    layer can tile at its own rate.
 *  - Poly Haven's ARM map packs AO/roughness/metalness into r/g/b, which is
 *    exactly the three slots three reads, so one sampler covers all three.
 *
 * Sampler budget matters here: 4 layers × (albedo, normal, ARM) = 12 units, plus
 * the environment map and the sun's shadow map. WebGL2 guarantees 16 per stage,
 * so there is no room for a fifth layer — biome variety comes from the vertex
 * colour tint multiplied over the blend instead.
 */
export function makeTerrainMaterial(): THREE.MeshStandardMaterial {
  const t = loadTerrainMaps();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, // biome tint, multiplied over the blended albedo
    // These must be assigned for three to compile in the map/normal/rough/AO
    // code paths (and the tangent frame). Our injected shader does the real
    // sampling; which texture is bound here doesn't matter.
    map: t.grass.map,
    normalMap: t.grass.normalMap,
    roughnessMap: t.grass.armMap,
    metalnessMap: t.grass.armMap,
    aoMap: t.grass.armMap,
    roughness: 1,
    metalness: 1,
    normalScale: new THREE.Vector2(1, 1),
  });

  // Metres per texture repeat, per layer. Rock and snow read better coarse;
  // sand is fine-grained.
  const uScale = new THREE.Vector4(1 / 3, 1 / 5, 1 / 2, 1 / 4);

  mat.onBeforeCompile = (sh) => {
    sh.uniforms['uGrassMap'] = { value: t.grass.map };
    sh.uniforms['uGrassNor'] = { value: t.grass.normalMap };
    sh.uniforms['uGrassArm'] = { value: t.grass.armMap };
    sh.uniforms['uRockMap'] = { value: t.rock.map };
    sh.uniforms['uRockNor'] = { value: t.rock.normalMap };
    sh.uniforms['uRockArm'] = { value: t.rock.armMap };
    sh.uniforms['uSandMap'] = { value: t.sand.map };
    sh.uniforms['uSandNor'] = { value: t.sand.normalMap };
    sh.uniforms['uSandArm'] = { value: t.sand.armMap };
    sh.uniforms['uSnowMap'] = { value: t.snow.map };
    sh.uniforms['uSnowNor'] = { value: t.snow.normalMap };
    sh.uniforms['uSnowArm'] = { value: t.snow.armMap };
    sh.uniforms['uScale'] = { value: uScale };

    sh.vertexShader =
      'attribute vec4 aSplat;\nvarying vec4 vSplat;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  vSplat = aSplat;`);

    sh.fragmentShader =
      `
      uniform sampler2D uGrassMap, uGrassNor, uGrassArm;
      uniform sampler2D uRockMap,  uRockNor,  uRockArm;
      uniform sampler2D uSandMap,  uSandNor,  uSandArm;
      uniform sampler2D uSnowMap,  uSnowNor,  uSnowArm;
      uniform vec4 uScale;
      varying vec4 vSplat;
      vec3 splatArm;
      vec3 splatNor;
      ` +
      sh.fragmentShader
        .replace(
          '#include <map_fragment>',
          `
          vec4 w = vSplat / max(vSplat.x + vSplat.y + vSplat.z + vSplat.w, 1e-4);
          vec2 gUv = vMapUv * uScale.x;
          vec2 rUv = vMapUv * uScale.y;
          vec2 sUv = vMapUv * uScale.z;
          vec2 nUv = vMapUv * uScale.w;

          vec3 albedo =
              texture2D(uGrassMap, gUv).rgb * w.x
            + texture2D(uRockMap,  rUv).rgb * w.y
            + texture2D(uSandMap,  sUv).rgb * w.z
            + texture2D(uSnowMap,  nUv).rgb * w.w;

          splatNor =
              texture2D(uGrassNor, gUv).xyz * w.x
            + texture2D(uRockNor,  rUv).xyz * w.y
            + texture2D(uSandNor,  sUv).xyz * w.z
            + texture2D(uSnowNor,  nUv).xyz * w.w;

          splatArm =
              texture2D(uGrassArm, gUv).rgb * w.x
            + texture2D(uRockArm,  rUv).rgb * w.y
            + texture2D(uSandArm,  sUv).rgb * w.z
            + texture2D(uSnowArm,  nUv).rgb * w.w;

          // A 1k texture tiling every few metres is obvious from a distance, so
          // break it up with a slow large-scale brightness wave. Cheaper than a
          // second set of samples at a macro scale, and enough to kill the grid.
          float macro = 0.86
            + 0.18 * sin(vMapUv.x * 0.021 + 1.7)
            * cos(vMapUv.y * 0.017 - 0.6);
          diffuseColor.rgb *= albedo * macro;
          `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness * splatArm.g;`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          // These ground scans have no metal; the packed b channel is noise here.
          `float metalnessFactor = 0.0;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `
          vec3 mapN = splatNor * 2.0 - 1.0;
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );
          `,
        )
        .replace(
          '#include <aomap_fragment>',
          `
          float ambientOcclusion = (splatArm.r - 1.0) * aoMapIntensity + 1.0;
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
          #endif
          `,
        );
  };

  // Changing onBeforeCompile after materials exist needs a cache-key bump; this
  // material is created once per world, so a constant key is fine.
  mat.customProgramCacheKey = () => 'wyrdwood-terrain-splat-v1';
  return mat;
}
