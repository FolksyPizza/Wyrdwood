import * as THREE from 'three';
import { settings, notifySettingsChanged, keyFor } from './data/settings';
import { makeWater } from './render/water';
import { preloadModels } from './render/models';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { DayNight } from './core/daynight';
import { GameRenderer } from './render/renderer';
import { Physics } from './physics/physics';
import { DebugOverlay } from './ui/debug';
import { Terrain, SEA_LEVEL } from './world/terrain';
import { ChunkManager } from './world/chunks';
import { hashSeed } from './world/noise';
import { PlayerController } from './player/controller';
import { ThirdPersonCamera } from './player/camera';
import { PlayerStats } from './player/stats';
import { Interaction } from './player/interact';
import { Inventory, HOTBAR_SIZE } from './items/inventory';
import { Hud } from './ui/hud';
import { InventoryScreen } from './ui/inventoryScreen';
import { CraftScreen } from './ui/craftScreen';
import { WorldMap } from './map/map';
import { PlacedObjects } from './building/placed';
import { Buildings } from './building/buildings';
import { BuildMode } from './building/buildMode';
import { BuildMenu } from './ui/buildMenu';
import { Crafting } from './crafting/crafting';
import { MobManager } from './entities/mobs';
import { Progression } from './progression/progression';
import { ObjectiveManager } from './progression/objectives';
import { CharScreen } from './ui/charScreen';
import { ObjectiveTracker } from './ui/objectiveTracker';
import { ParticleSystem } from './fx/particles';
import { GameAudio } from './fx/audio';
import { SkyDome } from './render/sky';
import { worldClock } from './render/textures';
import type { Appearance } from './data/appearance';
import { itemDef, type PlaceableKind } from './data/items';
import { BLUEPRINTS } from './data/blueprints';
import { worldConfig } from './data/difficulty';
import type { GameProbe } from './data/objectives';
import { writeSave, clearSave, type SaveData } from './save/save';
import type { SkillId } from './data/skills';
import type { ItemStack } from './items/inventory';

/** Recovery for a bare-handed punch. Weapons carry their own `swingTime`. */
const FIST_SWING_TIME = 0.45;

interface Grave {
  x: number;
  y: number;
  z: number;
  items: (ItemStack | null)[];
  mesh: THREE.Object3D;
}

export interface WorldOptions {
  seedText: string;
  appearance: Appearance;
  /** Resume from a save (Continue). */
  save?: SaveData;
}

/**
 * The running world: owns every gameplay system and the loop.
 * Constructed by the menu flow (main.ts) once the player configures a world.
 */
export class Game {
  // Core
  readonly gfx: GameRenderer;
  readonly physics: Physics;
  readonly input: Input;
  private debug = new DebugOverlay();
  private dayNight = new DayNight();
  private loop: GameLoop;

  // World & player (assigned in start()).
  terrain!: Terrain;
  chunks!: ChunkManager;
  player!: PlayerController;
  camera = new ThirdPersonCamera();
  stats = new PlayerStats();
  inventory = new Inventory();
  placed!: PlacedObjects;
  buildings!: Buildings;
  buildMode!: BuildMode;
  crafting!: Crafting;
  mobs!: MobManager;
  progression = new Progression(this.stats);
  objectives = new ObjectiveManager(this.progression);
  interaction!: Interaction;

  // UI
  private hud!: Hud;
  private invScreen!: InventoryScreen;
  private craftScreen!: CraftScreen;
  private buildMenu!: BuildMenu;
  private charScreen!: CharScreen;
  private tracker!: ObjectiveTracker;
  worldMap!: WorldMap;

  private water!: THREE.Mesh;
  private spawn = { x: 0, y: 0, z: 0 };
  private particles!: ParticleSystem;
  private audio = new GameAudio();
  private sky!: SkyDome;

  /** Pause flag (Esc menu). The loop keeps rendering; simulation freezes. */
  paused = false;
  /** Fired once when the objective chain completes. */
  onWin: () => void = () => {};
  /** Fired on Esc (main shows the pause menu). */
  onPauseToggle: () => void = () => {};
  /** Loading progress 0–1 while the spawn area streams in. */
  onLoadProgress: (progress: number) => void = () => {};
  /** Fired once when the spawn area is ready to play. */
  onReady: () => void = () => {};
  private readySignaled = false;

  private started = false;
  private wasDead = false;
  private runXpAccum = 0;
  private objectivePollTimer = 0;
  private kills = 0;
  private craftedIds = new Set<string>();
  private sawNight = false;
  private survivedNight = false;
  private keydownHandler: (e: KeyboardEvent) => void;
  private seedText = 'wyrdwood';
  private appearance!: Appearance;
  private autosaveTimer = 30;
  private graves: Grave[] = [];
  /** Fired for a hardcore-death permadeath (wipe save, back to menu). */
  onPermadeath: () => void = () => location.reload();

  private constructor(container: HTMLElement, physics: Physics) {
    this.gfx = new GameRenderer(container);
    this.physics = physics;
    this.input = new Input(this.gfx.renderer.domElement);
    this.keydownHandler = (e) => this.onKeydown(e);
    this.loop = new GameLoop({
      update: (dt) => this.update(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });
  }

  static async create(container: HTMLElement): Promise<Game> {
    const physics = await Physics.create();
    // Rigged creature/character models must be in memory before anything spawns,
    // so the rest of the game can pull one synchronously.
    await preloadModels();
    return new Game(container, physics);
  }

  /** Build the world and start playing. */
  start(options: WorldOptions): void {
    if (this.started) return;
    this.started = true;
    this.seedText = options.seedText || 'wyrdwood';
    this.appearance = options.appearance;
    if (options.save) Object.assign(worldConfig, options.save.worldConfig);

    this.terrain = new Terrain(hashSeed(this.seedText));
    this.chunks = new ChunkManager(this.gfx.scene, this.physics, this.terrain);

    // Water plane — follows the player so it always covers the horizon.
    this.water = makeWater();
    this.water.position.y = SEA_LEVEL;
    this.gfx.scene.add(this.water);

    this.spawn = this.terrain.findSpawn();
    this.player = new PlayerController(
      this.physics,
      this.gfx.scene,
      options.appearance,
      this.spawn,
    );
    this.particles = new ParticleSystem(this.gfx.scene);
    this.sky = new SkyDome(this.gfx.scene);

    this.placed = new PlacedObjects(this.gfx.scene, this.physics);
    this.buildings = new Buildings(this.gfx.scene, this.physics, this.terrain);
    this.buildMode = new BuildMode(this.gfx.scene, this.terrain, this.buildings, this.inventory);
    this.buildMode.onPlace = () => {
      this.progression.addSkillXp('building', 5);
      this.progression.addXp(2);
      this.audio.place();
    };
    this.interaction = new Interaction(
      this.chunks,
      this.water,
      this.inventory,
      this.stats,
      this.placed,
      this.terrain,
      this.progression,
    );
    this.crafting = new Crafting(this.inventory, this.placed);
    this.crafting.onCraft = (recipe) => {
      this.craftedIds.add(recipe.output);
      this.progression.addXp(6);
      this.audio.place();
    };

    // Game-feel hooks: particles + sound on harvest hits.
    this.interaction.onHarvestHit = (inst) => {
      const y = inst.y + (inst.type === 'tree' ? 1.2 : 0.4);
      if (inst.type === 'tree') {
        this.particles.chop(inst.x, y, inst.z);
        this.audio.chop();
      } else if (inst.type === 'rock') {
        this.particles.mine(inst.x, y, inst.z);
        this.audio.mine();
      } else {
        this.particles.forage(inst.x, y, inst.z);
        this.audio.eat();
      }
    };

    this.mobs = new MobManager(this.gfx.scene, this.terrain);
    this.mobs.onPlayerHit = (damage) => {
      this.stats.hurt(damage);
      this.audio.hurt();
      this.camera.addShake(0.4);
      const p = this.player.position;
      this.particles.hit(p.x, p.y + 1.1, p.z);
    };
    this.mobs.onKill = (mob) => {
      this.kills++;
      const gained = mob.def.drops
        .map((d) => {
          const leftover = this.inventory.add(d.itemId, d.count);
          return d.count - leftover > 0 ? `+${d.count - leftover} ${itemDef(d.itemId).name}` : '';
        })
        .filter(Boolean)
        .join('  ');
      if (gained) this.interaction.showFeedback(`${mob.def.name} slain  ${gained}`);
      this.progression.addSkillXp('combat', Math.round(mob.def.hp / 3));
      this.progression.addXp(Math.round(mob.def.hp / 2));
    };

    // UI
    this.hud = new Hud(this.stats, this.inventory);
    this.invScreen = new InventoryScreen(this.inventory);
    this.craftScreen = new CraftScreen(this.crafting);
    this.craftScreen.getPos = () => ({ x: this.player.position.x, z: this.player.position.z });
    this.buildMenu = new BuildMenu(this.buildMode);
    this.charScreen = new CharScreen(this.progression);
    this.tracker = new ObjectiveTracker(this.objectives);
    this.worldMap = new WorldMap(this.terrain);
    this.worldMap.markers.push({ x: this.spawn.x, z: this.spawn.z, icon: '🏠' });

    this.objectives.onWin = () => this.onWin();

    // Held tool follows the active hotbar slot.
    const hudRefresh = this.inventory.onChange;
    this.inventory.onChange = () => {
      hudRefresh?.();
      const active = this.inventory.active;
      const def = active ? itemDef(active.itemId) : null;
      this.player.humanoid.setHeldTool(def?.tool?.kind ?? null);
    };

    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('beforeunload', () => {
      if (this.started) this.saveNow();
    });

    if (options.save) this.applySave(options.save);

    // Dev mode (?dev): starting materials + console access for scripted playtests.
    if (new URLSearchParams(location.search).has('dev')) {
      if (!options.save) {
        this.inventory.add('wood', 80);
        this.inventory.add('stone', 20);
      }
      (window as unknown as Record<string, unknown>).__game = {
        inventory: this.inventory,
        crafting: this.crafting,
        placed: this.placed,
        stats: this.stats,
        player: this.player,
        craftScreen: this.craftScreen,
        buildings: this.buildings,
        buildMode: this.buildMode,
        blueprints: BLUEPRINTS,
        mobs: this.mobs,
        worldConfig,
        settings,
        applySettings: notifySettingsChanged,
        progression: this.progression,
        objectives: this.objectives,
        game: this,
      };
    }

    this.loop.start();
  }

  private uiOpen(): boolean {
    return (
      this.invScreen.visible ||
      this.worldMap.visible ||
      this.craftScreen.visible ||
      this.buildMenu.visible ||
      this.charScreen.visible ||
      this.paused
    );
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      // Close any open screen first; otherwise toggle pause.
      if (this.invScreen.visible) this.invScreen.toggle();
      else if (this.worldMap.visible) this.worldMap.toggle();
      else if (this.craftScreen.visible) this.craftScreen.toggle();
      else if (this.buildMenu.visible) this.buildMenu.toggle();
      else if (this.charScreen.visible) this.charScreen.toggle();
      else if (this.buildMode.active) this.buildMode.exit();
      else this.onPauseToggle();
      return;
    }
    // HUD toggles work even while paused, and are matched against the *bound*
    // key rather than a hard-coded one.
    if (e.code === keyFor('toggleHud')) {
      e.preventDefault();
      settings.showHud = !settings.showHud;
      settings.showStatus = settings.showHud;
      notifySettingsChanged();
      return;
    }
    if (e.code === keyFor('togglePerf')) {
      e.preventDefault();
      settings.showPerf = !settings.showPerf;
      notifySettingsChanged();
      return;
    }

    if (this.paused) return;
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= HOTBAR_SIZE) this.inventory.setActiveSlot(n - 1);
    } else if (e.code === keyFor('inventory') || e.code === 'KeyI') {
      e.preventDefault();
      this.invScreen.toggle();
    } else if (e.code === keyFor('map')) {
      this.worldMap.toggle();
    } else if (e.code === keyFor('craft')) {
      this.craftScreen.toggle();
    } else if (e.code === keyFor('build')) {
      this.buildMenu.toggle();
    } else if (e.code === keyFor('character')) {
      this.charScreen.toggle();
    } else if (e.code === keyFor('interact')) {
      if (!this.interaction.target && !this.stats.dead) {
        // Loot a grave, else light a beacon, else toggle a door.
        if (this.tryLootGrave()) return;
        const beacon = this.placed.lightBeacon(this.player.position.x, this.player.position.z);
        if (beacon) {
          this.interaction.showFeedback('🔥 The Wyrd Beacon burns!');
          this.worldMap.markers.push({ x: beacon.x, z: beacon.z, icon: '🗼' });
        } else {
          this.buildings.toggleDoor(this.player.position, 3);
        }
      }
    } else if (e.code === keyFor('eat')) {
      const active = this.inventory.active;
      if (active && itemDef(active.itemId).food && !this.stats.dead) {
        const id = this.inventory.consumeOne(this.inventory.activeSlot);
        if (id) {
          this.stats.eat(itemDef(id).food!);
          this.audio.eat();
        }
      }
    } else if (e.code === 'KeyR' && this.stats.dead) {
      this.stats.respawn();
      this.sawNight = false;
      this.player.teleport(this.spawn.x, this.spawn.y, this.spawn.z);
    }
  }

  private update(dt: number): void {
    this.chunks.update(this.player.position.x, this.player.position.z);
    const ready = this.chunks.isLoadedAt(this.player.position.x, this.player.position.z);

    // Loading progress: report % of the spawn 3×3 that's streamed in.
    if (!this.readySignaled) {
      const px = this.player.position.x;
      const pz = this.player.position.z;
      let loaded = 0;
      const R = 96; // ~1.5 chunks
      for (let dx = -R; dx <= R; dx += R) {
        for (let dz = -R; dz <= R; dz += R) {
          if (this.chunks.isLoadedAt(px + dx, pz + dz)) loaded++;
        }
      }
      this.onLoadProgress(loaded / 9);
      if (ready && loaded >= 9) {
        this.readySignaled = true;
        this.onReady();
      }
    }
    if (this.paused) return;

    const frozen = !ready || this.stats.dead || this.uiOpen();
    this.player.update(dt, this.input, this.camera.moveYaw, this.stats, frozen);
    this.physics.step(dt);

    this.stats.update(dt, {
      running: this.player.running,
      moving: this.player.speed > 0.5,
      isNight: this.dayNight.isNight,
      altitude: this.player.position.y,
      nearFire:
        this.placed.nearest('campfire', this.player.position.x, this.player.position.z, 5) !==
        null,
    });

    // Survive-a-night tracking.
    if (this.dayNight.isNight && !this.stats.dead) this.sawNight = true;
    else if (this.sawNight && !this.dayNight.isNight && !this.stats.dead)
      this.survivedNight = true;

    // Death penalty (once, on the tick the player dies).
    if (this.stats.dead && !this.wasDead) {
      this.wasDead = true;
      this.audio.hurt();
      if (worldConfig.deathPenalty === 'hardcore') {
        // Permadeath: wipe the save and return to menu shortly after.
        clearSave();
        setTimeout(() => this.onPermadeath(), 2500);
      } else if (worldConfig.deathPenalty === 'drop') {
        // Drop everything into a lootable grave at the death spot.
        this.dropGrave();
      }
    } else if (!this.stats.dead) this.wasDead = false;

    this.mobs.update(dt, this.player.position, this.dayNight.isNight, this.stats.dead);

    // Melee swing (LMB while playing; build mode owns clicks when active).
    // A swing has to *land* before you can throw another — without a cooldown you
    // can click as fast as your mouse allows and the damage rate is bounded only
    // by your finger, which makes every weapon stat meaningless.
    this.swingCooldown -= dt;
    if (
      !this.buildMode.active &&
      !this.uiOpen() &&
      !this.stats.dead &&
      this.swingCooldown <= 0 &&
      this.input.consumeLeftClick()
    ) {
      if (this.stats.spend(8)) {
        const active = this.inventory.active;
        const weapon = active ? itemDef(active.itemId).weapon : undefined;
        // The cooldown *is* the swing: you cannot throw the next one until this
        // one has played out. So the animation and the cooldown are driven from
        // the same number, and a heavier weapon is genuinely slower.
        const swingTime = weapon?.swingTime ?? FIST_SWING_TIME;
        this.swingCooldown = swingTime;
        this.player.humanoid.swing(swingTime);
        const damage = weapon?.damage ?? 4;
        const hit = this.mobs.swingAt(
          this.player.position,
          this.camera.yaw + Math.PI,
          damage * this.progression.damageMultiplier,
        );
        if (hit) {
          this.progression.addSkillXp('combat', 6);
          this.particles.hit(hit.x, hit.y + 0.7 * hit.def.size, hit.z);
          this.audio.hit();
        }
      }
    }

    // Use-based skills: running trains Running (1 XP per second sprinted).
    this.stats.sprintCostMult = this.progression.sprintCostMultiplier;
    if (this.player.running) {
      this.runXpAccum += dt;
      if (this.runXpAccum >= 1) {
        this.runXpAccum -= 1;
        this.progression.addSkillXp('running', 1);
      }
    }

    this.worldMap.updateDiscovery(this.player.position.x, this.player.position.z);

    // Objectives poll (~1/s).
    this.objectivePollTimer -= dt;
    if (this.objectivePollTimer <= 0) {
      this.objectivePollTimer = 1;
      this.objectives.check(this.probe());
    }

    // Autosave every 30s.
    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = 30;
      this.saveNow();
    }
  }

  /** Drop the whole inventory into a grave at the player's feet (E to reclaim). */
  private dropGrave(): void {
    const items = this.inventory.slots.map((s) => (s ? { ...s } : null));
    if (!items.some(Boolean)) return;
    this.inventory.slots.fill(null);
    this.inventory.onChange?.();
    const p = this.player.position;
    const grave = { x: p.x, y: p.y, z: p.z, items, mesh: buildGraveMesh() };
    grave.mesh.position.set(p.x, this.terrain.height(p.x, p.z), p.z);
    this.gfx.scene.add(grave.mesh);
    this.graves.push(grave);
    this.worldMap.markers.push({ x: p.x, z: p.z, icon: '⚰️' });
  }

  /** Reclaim the nearest grave within range. Returns true if looted. */
  private tryLootGrave(): boolean {
    for (let i = 0; i < this.graves.length; i++) {
      const g = this.graves[i]!;
      if (Math.hypot(g.x - this.player.position.x, g.z - this.player.position.z) < 3) {
        for (const s of g.items) if (s) this.inventory.add(s.itemId, s.count);
        this.gfx.scene.remove(g.mesh);
        this.graves.splice(i, 1);
        const mi = this.worldMap.markers.findIndex(
          (m) => m.icon === '⚰️' && Math.hypot(m.x - g.x, m.z - g.z) < 1,
        );
        if (mi !== -1) this.worldMap.markers.splice(mi, 1);
        this.interaction.showFeedback('Recovered your belongings');
        return true;
      }
    }
    return false;
  }

  /** Snapshot the world into the save format. */
  private collectSave(): SaveData {
    const p = this.player.position;
    return {
      version: 1,
      savedAt: Date.now(),
      seedText: this.seedText,
      worldConfig: structuredClone(worldConfig),
      appearance: { ...this.appearance },
      dayTime: this.dayNight.time,
      player: {
        x: p.x,
        y: p.y,
        z: p.z,
        health: this.stats.health,
        stamina: this.stats.stamina,
        hunger: this.stats.hunger,
        thirst: this.stats.thirst,
        warmth: this.stats.warmth,
        maxHealth: this.stats.maxHealth,
        maxStamina: this.stats.maxStamina,
      },
      inventory: this.inventory.slots.map((s) => (s ? { ...s } : null)),
      progression: {
        level: this.progression.level,
        xp: this.progression.xp,
        skills: structuredClone(this.progression.skills),
      },
      objectives: {
        index: this.objectives.index,
        won: this.objectives.won,
        kills: this.kills,
        craftedIds: [...this.craftedIds],
        survivedNight: this.survivedNight,
      },
      placed: this.placed.objects.map((o) => ({ ...o })),
      graves: this.graves.map((g) => ({ x: g.x, y: g.y, z: g.z, items: g.items })),
      buildingPieces: this.buildings.pieces.map((pc) => ({ ...pc })),
      removedInstances: [...this.chunks.removedInstances],
      damagedInstances: [...this.chunks.damagedInstances.entries()],
      discovered: [...this.worldMap.discovered],
      markers: this.worldMap.markers.map((m) => ({ ...m })),
    };
  }

  /** Persist now (autosave, pause, beforeunload). */
  saveNow(): void {
    if (!this.started) return;
    writeSave(this.collectSave());
  }

  /** Restore world deltas after systems are constructed (Continue flow). */
  private applySave(save: SaveData): void {
    this.dayNight.time = save.dayTime;
    // World deltas BEFORE chunks build: harvested objects stay gone.
    for (const key of save.removedInstances) this.chunks.removedInstances.add(key);
    for (const [key, hp] of save.damagedInstances ?? []) this.chunks.damagedInstances.set(key, hp);
    for (const cell of save.discovered) this.worldMap.discovered.add(cell);
    this.worldMap.markers.length = 0;
    this.worldMap.markers.push(...save.markers);

    // Player.
    Object.assign(this.stats, {
      health: save.player.health,
      stamina: save.player.stamina,
      hunger: save.player.hunger,
      thirst: save.player.thirst,
      warmth: save.player.warmth,
      maxHealth: save.player.maxHealth,
      maxStamina: save.player.maxStamina,
    });
    this.player.teleport(save.player.x, save.player.y + 0.5, save.player.z);

    // Inventory.
    save.inventory.forEach((s, i) => {
      this.inventory.slots[i] = s ? { ...s } : null;
    });
    this.inventory.onChange?.();

    // Progression.
    this.progression.level = save.progression.level;
    this.progression.xp = save.progression.xp;
    for (const [id, state] of Object.entries(save.progression.skills)) {
      this.progression.skills[id as SkillId] = { ...state };
    }
    this.progression.toasts.length = 0; // don't replay level-up toasts

    // Objectives & counters.
    this.objectives.index = save.objectives.index;
    this.objectives.won = save.objectives.won;
    this.kills = save.objectives.kills;
    this.craftedIds = new Set(save.objectives.craftedIds);
    this.survivedNight = save.objectives.survivedNight;

    // Placed objects & buildings.
    for (const o of save.placed) {
      const obj = this.placed.place(o.kind as PlaceableKind, o.x, o.y, o.z, o.yaw);
      if (o.lit) {
        this.placed.lightBeacon(obj.x, obj.z, 0.1);
      }
    }
    for (const piece of save.buildingPieces) this.buildings.place({ ...piece });

    // Death-drop graves.
    for (const g of save.graves ?? []) {
      const mesh = buildGraveMesh();
      mesh.position.set(g.x, this.terrain.height(g.x, g.z), g.z);
      this.gfx.scene.add(mesh);
      this.graves.push({ x: g.x, y: g.y, z: g.z, items: g.items, mesh });
    }
  }

  private probe(): GameProbe {
    return {
      itemCount: (id) => this.inventory.count(id),
      placedCount: (kind) => this.placed.objects.filter((o) => o.kind === kind).length,
      buildingPieces: this.buildings.pieces.length,
      kills: this.kills,
      craftedIds: this.craftedIds,
      survivedNight: this.survivedNight,
      beaconLit: this.placed.objects.some((o) => o.kind === 'beacon' && o.lit),
      level: this.progression.level,
    };
  }

  private titleTimer = 0;
  /** Seconds until the player can swing again. */
  private swingCooldown = 0;

  private render(alpha: number, frameDt: number): void {
    // Draw (and follow) the *interpolated* position, not the last simulated one —
    // see PlayerController.renderPosition. Paused, alpha is meaningless.
    this.player.syncVisuals(this.paused ? 0 : frameDt, this.paused ? 1 : alpha);
    if (!this.uiOpen()) {
      // Hold Alt (or middle-mouse) to free-look without curving your path.
      const freeLook = this.input.action('freeLook') || this.input.mouseHeld(1);
      this.camera.update(
        this.gfx.camera,
        this.input,
        this.player.renderPosition,
        this.terrain,
        frameDt,
        this.player.running,
        freeLook,
      );
    }
    if (!this.paused) {
      this.dayNight.update(frameDt, this.gfx, this.player.position);
      worldClock.value += frameDt; // drives grass/foliage wind shaders
    }
    this.sky.update(this.dayNight, this.player.position, this.gfx);
    this.placed.updateLights(performance.now() / 1000);
    this.water.position.x = this.player.position.x;
    this.water.position.z = this.player.position.z;

    // Effects: fire emitters on campfires/lit beacons near the player, footsteps, particle sim.
    if (!this.paused) {
      for (const o of this.placed.objects) {
        const d2 =
          (o.x - this.player.position.x) ** 2 + (o.z - this.player.position.z) ** 2;
        if (d2 > 45 * 45) continue;
        if (o.kind === 'campfire') this.particles.fire(o.x, o.y, o.z, frameDt);
        else if (o.kind === 'beacon' && o.lit) this.particles.fire(o.x, o.y + 3.2, o.z, frameDt);
      }
      this.audio.footsteps(frameDt, this.player.speed, this.player.grounded);
      this.particles.update(frameDt);
    }

    // Level-up / objective toasts.
    const toast = this.progression.toasts.shift() ?? this.objectives.toasts.shift();
    if (toast) {
      this.interaction.showFeedback(`✨ ${toast}`);
      if (toast.startsWith('Level up') || toast.startsWith('Objective')) this.audio.levelUp();
    }

    if (!this.uiOpen()) this.buildMode.update(this.gfx.camera, this.player.position, this.input);
    if (!this.buildMode.active && !this.paused) {
      this.interaction.update(frameDt, this.gfx.camera, this.player.position, this.input);
    }
    const prompt = this.buildMode.active
      ? this.buildMode.status
      : this.interaction.target && !this.stats.dead && !this.uiOpen()
        ? `E — ${this.interaction.target.label}`
        : '';
    this.hud.update(prompt, this.interaction.feedback);
    this.tracker.update();
    this.worldMap.render(frameDt, this.player.position.x, this.player.position.z, this.camera.yaw);

    const p = this.player.position;
    // Diagnostic title for the playtest harness — throttled (DOM/tab-UI cost).
    this.titleTimer -= frameDt;
    if (this.titleTimer <= 0) {
      this.titleTimer = 0.5;
      document.title = `Wyrdwood — p=${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} loaded=${this.chunks.isLoadedAt(p.x, p.z)}`;
    }
    this.debug.timeOfDay = this.dayNight.time * 24;
    this.debug.biome = this.terrain.biomeAt(p.x, p.z).id;
    this.debug.pos = { x: p.x, y: p.y, z: p.z };
    this.debug.showHint = !this.input.pointerLocked;
    this.debug.tick(frameDt);
    this.gfx.render();
  }
}

/** A simple tombstone/loot-sack marker for death drops. */
function buildGraveMesh(): THREE.Group {
  const g = new THREE.Group();
  const sackMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.95 });
  const sack = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), sackMat);
  sack.scale.y = 1.2;
  sack.position.y = 0.35;
  sack.castShadow = true;
  const tie = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.18, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a3d26 }),
  );
  tie.position.y = 0.7;
  g.add(sack, tie);
  return g;
}
