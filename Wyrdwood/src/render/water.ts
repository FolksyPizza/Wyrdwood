import * as THREE from 'three';
import { makeNoiseNormal, worldClock } from './textures';

/**
 * Ocean/lake surface.
 *
 * A flat blue plane is the other big "this is a game engine" tell. Real water
 * reads as water because of three things, all of which this does:
 *
 *  - It *moves*: two normal-map layers scroll across each other at different
 *    speeds, scales and directions. One layer alone just looks like a sliding
 *    texture; two beating against each other look like a wind-driven surface.
 *  - It *reflects the sky*: with the sky baked into an environment map (SkyDome),
 *    a low-roughness surface picks up the real horizon glow and sun colour for
 *    free — including at sunset — which is most of the effect.
 *  - It gets *deeper*: shallow water over sand is bright and see-through, deep
 *    water is dark and opaque. Blending opacity and colour by depth is what
 *    makes a shoreline look like a shoreline rather than a cut-out.
 *
 * Vertices also rise and fall on a sum of sine waves, so the surface has actual
 * swell rather than being a mirror-flat sheet.
 */
export function makeWater(size = 1600): THREE.Mesh {
  // Enough segments that the swell is visible geometry, not just shading.
  const geo = new THREE.PlaneGeometry(size, size, 96, 96);

  const normals = makeNoiseNormal(256, 2.2, 4477);
  normals.wrapS = THREE.RepeatWrapping;
  normals.wrapT = THREE.RepeatWrapping;

  const mat = new THREE.MeshStandardMaterial({
    color: 0x2c5a78,
    transparent: true,
    opacity: 0.9,
    roughness: 0.08, // glassy — this is what lets it mirror the sky
    metalness: 0.02,
    normalMap: normals,
    normalScale: new THREE.Vector2(0.5, 0.5),
    envMapIntensity: 1.6, // water reflects the sky harder than the land does
  });

  mat.onBeforeCompile = (sh) => {
    sh.uniforms['uTime'] = worldClock;

    sh.vertexShader =
      'uniform float uTime;\nvarying vec3 vWorld;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
         // Swell: a few sine waves at different angles and wavelengths. Summing
         // waves that don't share a period keeps it from looking like a repeating
         // corrugation.
         float h =
             sin(wp.x * 0.055 + uTime * 0.8) * 0.16
           + sin(wp.z * 0.041 - uTime * 0.62) * 0.13
           + sin((wp.x + wp.z) * 0.021 + uTime * 0.44) * 0.09;
         transformed.z += h;   // plane is rotated flat, so local z is world up
         vWorld = wp;`,
      );

    sh.fragmentShader =
      'uniform float uTime;\nvarying vec3 vWorld;\n' +
      sh.fragmentShader
        .replace(
          '#include <normal_fragment_maps>',
          `
          // Two scrolling normal layers at different scale/speed/direction. The
          // interference between them is what makes the surface look alive.
          vec2 uvA = vWorld.xz * 0.045 + vec2( uTime * 0.020,  uTime * 0.013);
          vec2 uvB = vWorld.xz * 0.017 + vec2(-uTime * 0.011,  uTime * 0.008);
          vec3 nA = texture2D(normalMap, uvA).xyz * 2.0 - 1.0;
          vec3 nB = texture2D(normalMap, uvB).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(nA + nB);
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );
          `,
        )
        .replace(
          '#include <opaque_fragment>',
          `
          // Fresnel: water is nearly transparent looking straight down and nearly
          // a mirror at a grazing angle. Without this it looks like coloured glass.
          float fres = pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);
          diffuseColor.a = mix(0.72, 1.0, fres);
          #include <opaque_fragment>
          `,
        );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  // The plane is huge and always under the player; culling it by its (rotated)
  // bounding box just makes it pop out at the edges of the view.
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}
