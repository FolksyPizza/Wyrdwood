import * as THREE from 'three';
import type { Appearance } from '../data/appearance';
import type { ToolKind } from '../data/items';
import { clipsOf, findClip, instantiate, modelHeight } from '../render/models';

/**
 * The player's body: a rigged, skinned character model with real animation clips
 * (Quaternius, CC0). It used to be a stack of primitives with a hand-written
 * walk cycle, and it always read as a mannequin — a person is recognised by
 * their gait as much as their shape, and rotating limb pivots by hand does not
 * produce one.
 *
 * We use the pack's base human body, which ships with its own matching clip set
 * (Idle / Walking / Run / Jump / Attack / Death).
 *
 * The pack's "modular men" bodies were the obvious choice — they're the ones
 * with outfits — but they ship with no clips, and retargeting the base body's
 * clips onto them does NOT work despite both rigs using the same bone names:
 * an AnimationMixer binds by name and happily drove every bone, but the two rigs
 * have different *bind poses*, so the clip's local rotations produced a mangled,
 * near-T-posed body. Retargeting across rest poses needs a real retarget step,
 * not name matching. Colour variation comes from the creator's tints instead.
 */
const BODY = 'char/anims';

export class Humanoid {
  readonly group = new THREE.Group();

  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction | null;
  private walk: THREE.AnimationAction | null;
  private run: THREE.AnimationAction | null;
  private jump: THREE.AnimationAction | null;
  private attack: THREE.AnimationAction | null;
  private current: THREE.AnimationAction | null = null;

  /** Skinned materials we recolour from the character creator. */
  private tinted: THREE.MeshStandardMaterial[] = [];
  private hand: THREE.Object3D | null = null;
  private heldTool: THREE.Group | null = null;
  private heldToolKind: ToolKind | null = null;
  private swingTimer = 0;

  constructor(appearance: Appearance) {
    const model = instantiate(BODY);
    // Normalise to a 1.8 m person, then let `build` scale from there.
    const h = modelHeight(model) || 1.8;
    model.scale.setScalar(1.8 / h);
    this.group.add(model);

    // Clips live on the knight; the mixer targets *our* model.
    this.mixer = new THREE.AnimationMixer(model);
    const clips = clipsOf(BODY);
    const action = (...names: string[]): THREE.AnimationAction | null => {
      const clip = findClip(clips, ...names);
      return clip ? this.mixer.clipAction(clip) : null;
    };
    this.idle = action('Idle');
    this.walk = action('Walking', 'Walk');
    this.run = action('Run');
    this.jump = action('Jump');
    this.attack = action('Run_swordAttack', 'swordAttackJump');

    // The right hand bone is where a held tool hangs.
    this.hand = model.getObjectByName('Hand.R') ?? model.getObjectByName('LowerArm.R') ?? null;

    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = m as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue;
        // Each Humanoid gets its own material copies, or recolouring one player
        // would recolour every character sharing the cached model.
        const own = std.clone();
        this.tinted.push(own);
        if (Array.isArray(mesh.material)) {
          mesh.material[mesh.material.indexOf(std)] = own;
        } else {
          mesh.material = own;
        }
      }
    });

    this.setAppearance(appearance);
  }

  /** Trigger a melee swing animation. */
  swing(): void {
    this.swingTimer = 0.45;
    if (this.attack) {
      this.attack.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.08).play();
      this.current?.fadeOut(0.08);
      this.current = this.attack;
    }
  }

  /** Show a tool in the right hand (null = empty hands). */
  setHeldTool(kind: ToolKind | null): void {
    if (kind === this.heldToolKind) return;
    this.heldToolKind = kind;
    if (this.heldTool) {
      this.heldTool.parent?.remove(this.heldTool);
      this.heldTool = null;
    }
    if (!kind || !this.hand) return;

    const tool = new THREE.Group();
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x8d8d88,
      roughness: 0.5,
      metalness: 0.3,
    });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.55, 7), handleMat);
    handle.castShadow = true;
    tool.add(handle);
    if (kind === 'axe') {
      const bit = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), headMat);
      bit.castShadow = true;
      bit.scale.set(1, 0.9, 0.32);
      bit.position.set(0.075, 0.24, 0);
      tool.add(bit);
    } else {
      const pick = new THREE.Mesh(new THREE.OctahedronGeometry(0.19, 0), headMat);
      pick.castShadow = true;
      pick.scale.set(1, 0.22, 0.18);
      pick.position.set(0, 0.27, 0);
      tool.add(pick);
    }
    // The hand bone lives inside the model's scaled hierarchy, so the tool
    // inherits that scale — size it in the bone's local space.
    tool.scale.setScalar(1.4);
    tool.rotation.set(Math.PI / 2, 0, 0);
    this.hand.add(tool);
    this.heldTool = tool;
  }

  setAppearance(a: Appearance): void {
    // The model's own materials are named by role (Skin / Hair / clothing
    // colours), so the creator tints the ones it recognises and leaves the rest.
    for (const mat of this.tinted) {
      const name = mat.name.toLowerCase();
      if (name.includes('skin')) mat.color.setHex(a.skinTone);
      else if (name.includes('hair') || name.includes('eyebrow')) mat.color.setHex(a.hairColor);
      else if (name.includes('black') || name.includes('grey') || name.includes('gray'))
        mat.color.setHex(a.pantsColor);
      else if (name.includes('green') || name.includes('blue') || name.includes('red'))
        mat.color.setHex(a.shirtColor);
    }
    this.group.scale.setScalar(a.build);
  }

  /** Procedural animation. `speed` = horizontal m/s, `grounded` = on floor. */
  animate(dt: number, speed: number, grounded: boolean): void {
    if (this.swingTimer > 0) this.swingTimer -= dt;

    // The swing plays once and owns the body until it finishes.
    if (this.swingTimer <= 0) {
      const next = !grounded ? this.jump : speed > 5 ? this.run : speed > 0.3 ? this.walk : this.idle;
      if (next && next !== this.current) {
        next.reset().fadeIn(0.2).play();
        this.current?.fadeOut(0.2);
        this.current = next;
      }
    }

    // Match the walk cycle's cadence to how fast we're actually moving, or the
    // feet skate across the ground.
    const cur = this.current;
    if (cur) {
      if (cur === this.walk) cur.timeScale = Math.max(0.6, speed / 2.2);
      else if (cur === this.run) cur.timeScale = Math.max(0.7, speed / 6);
      else cur.timeScale = 1;
    }

    this.mixer.update(dt);
  }
}
