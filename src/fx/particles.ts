import * as THREE from 'three';

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
}

const MAX_PARTICLES = 600;

/**
 * Lightweight CPU particle pool rendered as a single THREE.Points cloud —
 * one draw call for every effect (wood chips, sparks, smoke, embers).
 */
export class ParticleSystem {
  private particles: Particle[] = [];
  private points: THREE.Points;
  private positions = new Float32Array(MAX_PARTICLES * 3);
  private colors = new Float32Array(MAX_PARTICLES * 3);
  private sizes = new Float32Array(MAX_PARTICLES);
  private geo = new THREE.BufferGeometry();

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        alive: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        color: new THREE.Color(),
        gravity: 0,
        drag: 0,
      });
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: {},
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (180.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.15, d);
          gl_FragColor = vec4(vColor, a * 0.9);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  private emit(opts: {
    x: number;
    y: number;
    z: number;
    count: number;
    color: number | number[];
    speed: number;
    up: number;
    life: number;
    size: number;
    gravity?: number;
    drag?: number;
    spread?: number;
  }): void {
    let emitted = 0;
    for (const p of this.particles) {
      if (emitted >= opts.count) break;
      if (p.alive) continue;
      emitted++;
      p.alive = true;
      const spread = opts.spread ?? 1;
      p.x = opts.x + (Math.random() - 0.5) * 0.3 * spread;
      p.y = opts.y + (Math.random() - 0.5) * 0.3 * spread;
      p.z = opts.z + (Math.random() - 0.5) * 0.3 * spread;
      const a = Math.random() * Math.PI * 2;
      const s = opts.speed * (0.4 + Math.random() * 0.8);
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = opts.up * (0.5 + Math.random() * 0.9);
      p.life = 0;
      p.maxLife = opts.life * (0.6 + Math.random() * 0.7);
      p.size = opts.size * (0.7 + Math.random() * 0.6);
      const c = Array.isArray(opts.color)
        ? opts.color[Math.floor(Math.random() * opts.color.length)]!
        : opts.color;
      p.color.setHex(c);
      p.gravity = opts.gravity ?? -9;
      p.drag = opts.drag ?? 0.5;
    }
  }

  /** Wood chips flying when chopping. */
  chop(x: number, y: number, z: number): void {
    this.emit({ x, y, z, count: 10, color: [0x9a6b3f, 0x7a5230, 0xc4a26a], speed: 2.4, up: 3, life: 0.7, size: 1.6 });
  }

  /** Stone shards when mining. */
  mine(x: number, y: number, z: number): void {
    this.emit({ x, y, z, count: 10, color: [0x8a8a85, 0x6e6e68, 0xa8a8a2], speed: 2.6, up: 2.6, life: 0.6, size: 1.4 });
  }

  /** Red burst when a mob (or the player) is struck. */
  hit(x: number, y: number, z: number): void {
    this.emit({ x, y, z, count: 12, color: [0xd64545, 0xa83232, 0xe08f5a], speed: 2.2, up: 2.2, life: 0.5, size: 1.5 });
  }

  /** Leafy puff for bushes/foraging. */
  forage(x: number, y: number, z: number): void {
    this.emit({ x, y, z, count: 8, color: [0x3c7033, 0x2f5d2a, 0x6a8f3f], speed: 1.6, up: 2, life: 0.6, size: 1.4 });
  }

  /** Continuous campfire smoke + embers (call per frame per fire). */
  fire(x: number, y: number, z: number, dt: number): void {
    if (Math.random() < dt * 14) {
      this.emit({ x, y: y + 0.5, z, count: 1, color: [0x555550, 0x6a6a64], speed: 0.15, up: 1.1, life: 2.2, size: 3.2, gravity: 0.6, drag: 0.4, spread: 0.8 });
    }
    if (Math.random() < dt * 8) {
      this.emit({ x, y: y + 0.4, z, count: 1, color: [0xffa03d, 0xff7a2a, 0xffd97a], speed: 0.35, up: 1.8, life: 0.9, size: 1.1, gravity: 1.2, drag: 0.5, spread: 0.6 });
    }
  }

  update(dt: number): void {
    let i = 0;
    for (const p of this.particles) {
      if (p.alive) {
        p.life += dt;
        if (p.life >= p.maxLife) p.alive = false;
        else {
          const dragK = Math.max(0, 1 - p.drag * dt);
          p.vx *= dragK;
          p.vz *= dragK;
          p.vy += p.gravity * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
        }
      }
      const t = p.alive ? 1 - p.life / p.maxLife : 0;
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.alive ? p.y : -9999;
      this.positions[i * 3 + 2] = p.z;
      this.colors[i * 3] = p.color.r;
      this.colors[i * 3 + 1] = p.color.g;
      this.colors[i * 3 + 2] = p.color.b;
      this.sizes[i] = p.size * (0.4 + 0.6 * t);
      i++;
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
    this.geo.attributes.size!.needsUpdate = true;
  }
}
