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
      'attribute vec4 aSplat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNor;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vSplat = aSplat;
         // World position and normal, for triplanar rock (see the fragment shader).
         vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
         vWNor = normalize(mat3(modelMatrix) * normal);`,
      );

    sh.fragmentShader =
      `
      uniform sampler2D uGrassMap, uGrassNor, uGrassArm;
      uniform sampler2D uRockMap,  uRockNor,  uRockArm;
      uniform sampler2D uSandMap,  uSandNor,  uSandArm;
      uniform sampler2D uSnowMap,  uSnowNor,  uSnowArm;
      uniform vec4 uScale;
      varying vec4 vSplat;
      varying vec3 vWPos;
      varying vec3 vWNor;
      vec3 splatArm;
      vec3 splatNor;

      /**
       * Triplanar sampling.
       *
       * The terrain's UVs are a flat top-down projection (world X,Z). That is
       * fine for a meadow, but on a cliff face — where the surface is nearly
       * vertical — the projected UVs barely change as you climb, so the texture
       * gets smeared into long vertical streaks. It is *the* reason cliffs look
       * like painted cardboard.
       *
       * Triplanar fixes it by projecting from all three axes and blending by the
       * surface normal: the wall gets its texture from a side projection, the
       * ledge from the top one, and neither is stretched. It costs 3 samples
       * instead of 1, so it is used only for the rock layer, where it matters.
       */
      vec3 triplanar(sampler2D tex, vec3 p, vec3 n, float scale) {
        vec3 b = abs(n);
        b = pow(b, vec3(4.0));          // sharpen, so faces don't cross-fade to mud
        b /= (b.x + b.y + b.z);
        return texture2D(tex, p.yz * scale).rgb * b.x
             + texture2D(tex, p.xz * scale).rgb * b.y
             + texture2D(tex, p.xy * scale).rgb * b.z;
      }
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

          vec3 wn = normalize(vWNor);
          // Rock is triplanar; everything else keeps the cheap planar projection,
          // because grass/sand/snow only ever sit on ground you can stand on.
          vec3 rockAlbedo = triplanar(uRockMap, vWPos, wn, uScale.y);
          vec3 rockNor    = triplanar(uRockNor, vWPos, wn, uScale.y);
          vec3 rockArm    = triplanar(uRockArm, vWPos, wn, uScale.y);

          vec3 albedo =
              texture2D(uGrassMap, gUv).rgb * w.x
            + rockAlbedo                    * w.y
            + texture2D(uSandMap,  sUv).rgb * w.z
            + texture2D(uSnowMap,  nUv).rgb * w.w;

          splatNor =
              texture2D(uGrassNor, gUv).xyz * w.x
            + rockNor                       * w.y
            + texture2D(uSandNor,  sUv).xyz * w.z
            + texture2D(uSnowNor,  nUv).xyz * w.w;

          splatArm =
              texture2D(uGrassArm, gUv).rgb * w.x
            + rockArm                       * w.y
            + texture2D(uSandArm,  sUv).rgb * w.z
            + texture2D(uSnowArm,  nUv).rgb * w.w;

          // A 1k texture tiling every few metres is obvious from a distance, so
          // break it up with a slow large-scale brightness wave. Cheaper than a
          // second set of samples at a macro scale, and enough to kill the grid.
          float macro = 0.86
            + 0.18 * sin(vMapUv.x * 0.021 + 1.7)
            * cos(vMapUv.y * 0.017 - 0.6);

          // Rock is not one colour. Real cliff faces run from cold blue-grey in
          // the shade to warm iron-stained ochre where they've weathered, with
          // lichen in the damp. A slow noise between two of those, plus a darker
          // wash down in the gullies, is most of what stops a mountain reading as
          // one flat quarry wall.
          float stain = 0.5 + 0.5 * sin(vWPos.x * 0.021 + vWPos.z * 0.017 + vWPos.y * 0.03);
          vec3 coldRock = vec3(0.90, 0.94, 1.02);   // shaded granite
          vec3 warmRock = vec3(1.05, 1.00, 0.93);   // sun-baked, faintly iron-stained
          vec3 rockTint = mix(coldRock, warmRock, stain);
          // Lichen: greenish, and only on surfaces flat enough to hold moisture.
          float lichen = smoothstep(0.55, 0.9, wn.y) *
                         smoothstep(0.45, 0.75, sin(vWPos.x * 0.09) * cos(vWPos.z * 0.11) * 0.5 + 0.5);
          rockTint = mix(rockTint, vec3(0.74, 0.86, 0.66), lichen * 0.3);

          albedo = mix(albedo, albedo * rockTint, w.y);
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
