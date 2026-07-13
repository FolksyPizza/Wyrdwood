import * as THREE from 'three';
import { structureMaterial } from '../render/assets';
import type RAPIER_API from '@dimforge/rapier3d-compat';
import { Physics, RAPIER } from '../physics/physics';
import type { PlaceableKind } from '../data/items';

/** A placed world object (workbench, campfire, beacon). */
export interface PlacedObject {
  kind: PlaceableKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Beacons: lit state (win condition). */
  lit?: boolean;
}

/**
 * Manages player-placed objects: meshes, colliders, lights, and queries
 * (e.g. "is there a workbench nearby?"). Serialized for saves in M8.
 */
export class PlacedObjects {
  readonly objects: PlacedObject[] = [];
  private meshes = new Map<PlacedObject, THREE.Object3D>();
  private colliders = new Map<PlacedObject, RAPIER_API.Collider>();

  constructor(
    private scene: THREE.Scene,
    private physics: Physics,
  ) {}

  place(kind: PlaceableKind, x: number, y: number, z: number, yaw: number): PlacedObject {
    const obj: PlacedObject = { kind, x, y, z, yaw };
    this.objects.push(obj);

    const mesh =
      kind === 'workbench'
        ? buildWorkbenchMesh()
        : kind === 'campfire'
          ? buildCampfireMesh()
          : buildBeaconMesh();
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);
    this.meshes.set(obj, mesh);

    if (kind === 'workbench') {
      this.colliders.set(
        obj,
        this.physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.7, 0.45, 0.45)
            .setTranslation(x, y + 0.45, z)
            .setRotation(quatFromYaw(yaw)),
        ),
      );
    } else if (kind === 'beacon') {
      this.colliders.set(
        obj,
        this.physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.5, 1.6, 0.5).setTranslation(x, y + 1.6, z),
        ),
      );
    }
    return obj;
  }

  /** Light a nearby unlit beacon. Returns it, or null if none in range. */
  lightBeacon(x: number, z: number, range = 4): PlacedObject | null {
    const beacon = this.nearest('beacon', x, z, range);
    if (!beacon || beacon.lit) return null;
    beacon.lit = true;
    const mesh = this.meshes.get(beacon);
    const flame = mesh?.getObjectByName('beaconflame');
    if (flame) flame.visible = true;
    return beacon;
  }

  /** Nearest placed object of a kind within `range` of (x,z), or null. */
  nearest(kind: PlaceableKind, x: number, z: number, range: number): PlacedObject | null {
    let best: PlacedObject | null = null;
    let bestD = range;
    for (const o of this.objects) {
      if (o.kind !== kind) continue;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Flicker campfire/beacon lights (call per frame). */
  updateLights(time: number): void {
    for (const [obj, mesh] of this.meshes) {
      if (obj.kind === 'campfire') {
        const light = mesh.getObjectByName('firelight') as THREE.PointLight | null;
        if (light)
          light.intensity = 14 + Math.sin(time * 9 + obj.x) * 2.5 + Math.sin(time * 23) * 1.2;
      } else if (obj.kind === 'beacon' && obj.lit) {
        const light = mesh.getObjectByName('beaconlight') as THREE.PointLight | null;
        if (light) light.intensity = 30 + Math.sin(time * 7 + obj.x) * 5;
      }
    }
  }
}

function quatFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

function buildWorkbenchMesh(): THREE.Group {
  const g = new THREE.Group();
  const wood = structureMaterial('build/planks', 2);
  const darkWood = structureMaterial('build/beam', 1);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.8), wood);
  top.position.y = 0.85;
  top.castShadow = true;
  g.add(top);
  for (const [lx, lz] of [
    [-0.6, -0.3],
    [0.6, -0.3],
    [-0.6, 0.3],
    [0.6, 0.3],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), darkWood);
    leg.position.set(lx, 0.4, lz);
    leg.castShadow = true;
    g.add(leg);
  }
  return g;
}

function buildBeaconMesh(): THREE.Group {
  const g = new THREE.Group();
  const stoneMat = structureMaterial('build/stone', 2);
  const woodMat = structureMaterial('build/beam', 1);
  // Tapered stone pillar.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.5, 8), stoneMat);
  base.position.y = 0.25;
  base.castShadow = true;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 2.4, 8), stoneMat);
  shaft.position.y = 1.7;
  shaft.castShadow = true;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.4, 0.4, 8), woodMat);
  bowl.position.y = 3.1;
  bowl.castShadow = true;
  g.add(base, shaft, bowl);
  // Flame (hidden until lit) + light.
  const flame = new THREE.Group();
  flame.name = 'beaconflame';
  flame.visible = false;
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffb52a,
    emissive: 0xff7a00,
    emissiveIntensity: 2.2,
  });
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 7), flameMat);
  f1.position.y = 3.9;
  flame.add(f1);
  const light = new THREE.PointLight(0xffa03d, 0, 30, 1.6);
  light.name = 'beaconlight';
  light.position.y = 4.0;
  flame.add(light);
  g.add(flame);
  return g;
}

function buildCampfireMesh(): THREE.Group {
  const g = new THREE.Group();
  const stoneMat = structureMaterial('terrain/rock', 1);
  const logMat = structureMaterial('bark/pine', 1);
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xff8c2a,
    emissive: 0xff6a00,
    emissiveIntensity: 1.6,
  });
  // Stone ring.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), stoneMat);
    s.position.set(Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5);
    g.add(s);
  }
  // Crossed logs.
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 5), logMat);
    log.rotation.z = Math.PI / 2.3;
    log.rotation.y = (i / 3) * Math.PI * 2;
    log.position.y = 0.15;
    g.add(log);
  }
  // Flame + light.
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 6), flameMat);
  flame.position.y = 0.42;
  g.add(flame);
  const light = new THREE.PointLight(0xff9a3d, 14, 14, 1.8);
  light.name = 'firelight';
  light.position.y = 0.7;
  g.add(light);
  return g;
}
