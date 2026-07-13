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
  // Bones we pose *on top of* the animation, for slope work (see animate).
  private spine: THREE.Object3D | null = null;
  private armL: THREE.Object3D | null = null;
  private armR: THREE.Object3D | null = null;
  private grade = 0;
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
    // GLTFLoader sanitises bone names, so the dots become nothing: "UpperArm.L"
    // is loaded as "UpperArmL".
    this.spine = model.getObjectByName('Chest') ?? model.getObjectByName('Torso') ?? null;
    this.armL = model.getObjectByName('UpperArmL') ?? null;
    this.armR = model.getObjectByName('UpperArmR') ?? null;

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

  /**
   * Trigger a melee swing. `duration` is the weapon's swing time — the clip is
   * time-scaled to fill exactly that, so a heavy club visibly takes longer to
   * come round than a knife rather than both playing the same animation and
   * differing only in a hidden cooldown number.
   */
  swing(duration = 0.45): void {
    this.swingTimer = duration;
    if (this.attack) {
      const clipLength = this.attack.getClip().duration;
      this.attack.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.08).play();
      this.attack.timeScale = clipLength / Math.max(0.1, duration);
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

  /**
   * Recolour the body from the character creator.
   *
   * KNOWN LIMITATION: this rig has exactly three materials — Skin, Armor (the
   * tunic, which covers torso *and* legs as one piece) and Boots. It has no hair
   * geometry and no separate trousers, so hairColor and pantsColor have nothing
   * to attach to and are silently ignored. The creator is currently offering
   * choices the body cannot express.
   *
   * Fixing it properly means a character model with separate head/hair/torso/legs
   * meshes. The pack's "modular men" are exactly that, but they ship without
   * animation clips and share only bone *names* with this rig, not its bind pose
   * — so retargeting onto them needs a real retarget step, not name matching.
   * That's the next character task, not a tweak.
   */
  setAppearance(a: Appearance): void {
    for (const mat of this.tinted) {
      const name = mat.name.toLowerCase();
      if (name.includes('skin')) mat.color.setHex(a.skinTone);
      else if (name.includes('boot') || name.includes('shoe')) mat.color.setHex(a.bootsColor);
      else if (name.includes('armor') || name.includes('armour') || name.includes('cloth')) {
        mat.color.setHex(a.shirtColor);
      }
    }
    this.group.scale.setScalar(a.build);
  }

  /**
   * Procedural animation.
   *
   * `speed` = horizontal m/s, `grounded` = on the floor, `grade` = rise over run
   * along the direction of travel (positive uphill).
   *
   * The rig ships with Idle / Walking / Run / Jump / Attack / Death and *no climb
   * clip* — so climbing is layered on top of the walk, procedurally: bones are
   * rotated after the mixer has written the clip's pose, which post-multiplies
   * the extra rotation onto it. That's a real additive layer, not a replacement,
   * so the legs keep their walk cycle while the torso and arms do the climbing.
   */
  animate(dt: number, speed: number, grounded: boolean, grade = 0): void {
    if (this.swingTimer > 0) this.swingTimer -= dt;
    this.grade += (grade - this.grade) * Math.min(1, dt * 5);

    // The swing plays once and owns the body until it finishes.
    if (this.swingTimer <= 0) {
      const next = !grounded ? this.jump : speed > 5 ? this.run : speed > 0.3 ? this.walk : this.idle;
      if (next && next !== this.current) {
        next.reset().fadeIn(0.2).play();
        this.current?.fadeOut(0.2);
        this.current = next;
      }
    }

    // Cadence. Match the cycle to how fast we're actually moving, or the feet
    // skate. Uphill the stride *shortens* as well as slowing, so the cadence
    // doesn't drop as far as the speed does — that's what makes a climb read as
    // effort rather than as slow motion.
    const cur = this.current;
    const uphill = Math.max(0, this.grade);
    // Leave the attack alone: swing() time-scaled it to the weapon's swing time,
    // and this runs every frame, so it would stamp that straight back to 1.
    if (cur && cur !== this.attack) {
      if (cur === this.walk) cur.timeScale = Math.max(0.6, speed / 2.2) * (1 + uphill * 0.35);
      else if (cur === this.run) cur.timeScale = Math.max(0.7, speed / 6) * (1 + uphill * 0.25);
      else cur.timeScale = 1;
    }

    this.mixer.update(dt);

    // ── Additive slope pose, applied after the clip has been written ─────────
    const moving = grounded && speed > 0.3;
    // Lean into the hill going up, and settle back going down.
    const lean = moving ? THREE.MathUtils.clamp(this.grade * 0.45, -0.22, 0.5) : 0;
    if (this.spine && Math.abs(lean) > 0.001) this.spine.rotateX(lean);

    // Past roughly 30°, hands come up to the slope. This is the "climb".
    const climb = moving ? THREE.MathUtils.smoothstep(this.grade, 0.55, 1.15) : 0;
    if (climb > 0.001) {
      // Negative X on the upper arm swings it forward and up, out of its hang.
      this.armL?.rotateX(-1.15 * climb);
      this.armR?.rotateX(-1.15 * climb);
      // Splay them outward a little so they don't clip through the chest.
      this.armL?.rotateZ(0.25 * climb);
      this.armR?.rotateZ(-0.25 * climb);
    }
  }
}
