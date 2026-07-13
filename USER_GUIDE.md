# Wyrdwood — Player's Guide

*Survive · Craft · Build · Conquer*

Wyrdwood is a 3D survival-crafting game inspired by Valheim, Aska, and Minecraft. You wake
in a procedurally generated wilderness with nothing but your hands. Gather resources, craft
tools, build a home, weather the nights, grow stronger — and light the **Wyrd Beacon** to
conquer the wilds.

---

## Launching the game

### Play in your browser (fastest)
1. Open a terminal in the game folder (`~/Desktop/Code/survival-game`).
2. Run once: `npm install`
3. Start it: `npm run dev`
4. Open **http://localhost:5173** in Google Chrome.
5. Click the game to capture your mouse, and play.

### Play as a desktop app
- `npm run app` — builds and opens Wyrdwood in its own window.
- `npm run dist:mac` (or `dist:win`) — packages a shareable installer into `release/`.

---

## Getting started (first 10 minutes)

1. **Make your character** — pick skin, hair, and clothes in the creator.
2. **Choose your world** — set a seed and a difficulty (or customize every rule).
3. **Gather wood** — walk up to a tree, look at it, and hold **E** to chop. Rocks give
   stone; bushes give berries; mushrooms and herbs are food.
4. **Craft a workbench** — press **C**, craft a Workbench (10 wood), then hold it on your
   hotbar and **right-click** to place it.
5. **Make tools** — near the workbench, craft a **Stone Axe** and **Pickaxe** (they harvest
   much faster and hit harder).
6. **Build shelter** — press **B**, pick a piece or the **Hut** blueprint, and place it.
7. **Survive the night** — build a **Campfire** to stay warm; eat and drink to stay alive.
8. **Follow the objectives** (top-right) — they guide you all the way to the win condition.

---

## Controls

| Action | Key |
|---|---|
| Move | **W A S D** |
| Look around | **Mouse** (click once to capture) |
| Sprint | **Shift** |
| Jump | **Space** |
| Interact / harvest / loot / light beacon | **E** (hold to keep harvesting) |
| Attack | **Left mouse button** |
| Place held object | **Right mouse button** |
| Select hotbar slot | **1 – 8** |
| Eat held food | **F** |
| Inventory | **Tab** or **I** |
| Crafting | **C** |
| Build menu | **B** |
| World map | **M** |
| Character & skills | **P** |
| Pause / back | **Esc** |

---

## Survival needs

Five needs sit in the corner of your screen — keep them up or your health drains:

- ❤️ **Health** — regenerates when you're well-fed and hydrated; lost to attacks and neglect.
- ⚡ **Stamina** — spent sprinting, jumping, harvesting, and attacking. Let it recover.
- 🍖 **Hunger** — eat berries, mushrooms, herbs, or cooked meat (press **F** to eat).
- 💧 **Thirst** — look at water and hold **E** to drink.
- 🔥 **Warmth** — you grow cold at night and at altitude. Stand by a **campfire** or shelter.

*(Difficulty and world modifiers can soften or disable any of these.)*

---

## Crafting & building

- **Crafting (C):** turn resources into tools, weapons, campfires, and structures. Some
  recipes need a **workbench nearby**.
- **Building (B):** place individual pieces (foundation, wall, floor, roof, door) on a
  snapping grid, or drop a whole **blueprint** (Hut, Cabin, Fence) in one action. Rotate
  blueprints with **G**. Use the **Dismantle** tool to reclaim pieces (full refund).
- **Doors:** walk up and press **E** to open/close.

---

## Progression

- **Character level:** earn XP from objectives, crafting, combat, and discovery. Leveling
  up raises your max health and stamina.
- **Skills (P):** improve by *doing* — chop to raise Woodcutting, run to raise Running,
  fight to raise Combat, etc. Higher skills mean faster, cheaper, stronger actions.

---

## The world

- **Biomes:** meadows, forests, mountains, snow, and shorelines — each with its own
  resources, plants, and creatures.
- **Day & night:** a full day/night cycle with sunrise, sunset, and starry nights. Danger
  rises after dark.
- **Creatures:** deer, boar, rabbits, and foxes roam the wilds; greylings and wolves hunt
  you at night. Passive animals flee; boars and foxes fight back if provoked.
- **The map (M):** a fog-of-war map fills in as you explore. Click it to drop **named
  markers** (with your choice of icon) on plant patches, camps, or points of interest.

---

## Difficulty & world modifiers

At world creation, pick a preset — **Peaceful, Normal, Hard, Survival** — or open
**Customize** to tune everything independently:

- **Combat dial:** enemy amount, damage, and aggression.
- **Survival:** hunger / thirst / warmth rates, stamina cost.
- **Toggles:** map on/off, hunger/thirst on/off, free building, and more.
- **Death penalty:** keep your items, drop them in a recoverable grave, or hardcore permadeath.

---

## Saving

The game **auto-saves** every 30 seconds and whenever you pause or quit. Pick **Continue**
on the main menu to resume your world exactly where you left off.

---

## Goal

Progress through the objective chain: survive the first night, tool up, build a shelter,
grow your skills, hunt, and finally craft and **light the Wyrd Beacon** to claim the
wilds. After that, the world stays open — keep building and exploring.

*Good luck, wanderer.*
