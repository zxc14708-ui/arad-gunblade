# ARAD Gunblade — Claude Code Handoff

## Project

- Browser game built with TypeScript, Vite, and Three.js.
- Entry point: `src/main.ts`; game loop and flow: `src/core/Game.ts`.
- This repository is the single source of truth. All work lands here.
- Do not add external art unless explicitly requested. Existing assets are in `public/assets/`.

## Collaboration roles

Three contributors work this repo; each has one lane and doesn't cross into
another's without the user's sign-off:

- **Codex** — code implementation. Builds features/fixes against values already
  set in `config.ts` and decisions already recorded in `DESIGN_LOG.md`. Does not
  invent balance numbers or system-structure changes on its own — if a task
  needs a design call that isn't already decided, it proposes options in
  `DESIGN_LOG.md` under 미해결 이슈 instead of picking one and shipping it.
- **GPT** — art only. Produces sprite sheets/props per the Asset rules below.
  Does not touch code.
- **Claude** — two jobs, not one person double-hatting silently:
  1. Game design: reads the whole codebase (something Codex/GPT don't share
     access to) to surface balance/system issues and propose fixes, recorded
     as entries in `DESIGN_LOG.md`. These are **proposals**, not unilateral
     decisions — the user approves before Codex implements them.
  2. Integration + QC: reviews what Codex/GPT push, verifies with `npm run qc`,
     integrates only the valid parts, and deploys.

`DESIGN_LOG.md` is the shared source of truth for design decisions across all
three — not just Claude's own scratch notes.

## Commands

- `npm install` — install dependencies.
- `npm run build` — TypeScript check and Vite build.
- `npm run dev` — browser development server.
- `npm run qc` — build, play the game headlessly, and screenshot every step.

## Verification: `npm run qc` is the gate

`npm run build` only proves the code compiles. Every bug that actually shipped in
this project was visual and passed the type check: character frames sliced with a
neighbour's sword in them, effect textures uploading black, the muzzle flash
drawn behind the head, boss rewards never appearing.

`npm run qc` builds, serves, and drives a real browser through nine steps
(town idle/walk, shoot, reload, slash, dash, settings, dungeon entry, combat),
then writes to `qc-out/`:

- `contact.png` — every step on one page. **Look at this before claiming a change works.**
- `NN-<step>.png` / `-zoom.png` — full frame and a crop around the player.
- `report.txt` — console/network errors and step failures.

A non-zero exit code means the change is rejected. A zero exit code only means
nothing crashed — sprite defects, effect placement, and layout breakage are
judged by eye from `contact.png`.

`src/main.ts` exposes `window.__game` for the harness to read the player's screen
position and run state. Keep it.

## Asset rules

- Sprite sheets are horizontal strips of square cells. Frame counts live in
  `src/entities/EnemySprite.ts` (`FRAMES`) and `src/rendering/assets.ts`.
- A creature's walk/attack sheets must use the **same cell size and body
  proportions as its idle sheet**. Mismatched proportions between animation
  states are immediately visible in game.
- Sprites are bottom-anchored (`center.set(0.5, 0)`). Art must sit with the
  feet on the bottom edge of the cell, or the creature floats above the ground.
- Backgrounds must be fully transparent (alpha 0), never a dark fill. Art drawn
  against a dark backdrop leaves black halos on bright floors.
- Floors are tiled textures. Keep them small and low-contrast — a busy floor
  hides the player and enemies. Do not ship multi-megabyte single images; every
  file in `public/` is downloaded before play.
- The player character is `public/assets/player/gunblade_*.png` — five
  independent state sheets (idle/walk/dash/katana/pistol), all 64x64 square
  cells. `src/entities/CharacterSprite.ts` swaps between them; it has no
  per-weapon visual skins.

## Gameplay Architecture

- `src/systems/RunState.ts` creates a random connected grid of rooms at the start of a run.
- A cleared room opens every connected exit; revisiting cleared rooms must not respawn enemies or duplicate rewards.
- Room kinds: combat, elite, treasure, shop, boss.
- Elite rooms grant a trait choice and bonus gold before exits unlock.
- `src/systems/Room.ts` owns room bounds and cardinal entry/door coordinates.
- `src/ui/HUD.ts` renders the minimap. Keep it synchronized with `RunState.minimap()`.
- Enemy counts are controlled through `CONFIG.spawn.roomDensity` in `src/config.ts`.

## UI Rules

- Right-click is reserved for gameplay. Keep context menus disabled globally in `src/main.ts`.
- The room must fill the view. If the floor plane ends inside the camera frustum,
  the player sees black voids — clamp the camera or enlarge the room.
- Interactables must be visually distinguishable from each other. The healing
  fountain and the dungeon portal currently read as the same teal orb.

## Design log

- Any change to gameplay, balance, or system structure adds an entry to the
  top of `DESIGN_LOG.md`.
- Do not write numbers there — `config.ts` is the source of truth. Record only
  intent, abandoned attempts, and open problems.
- Visual defects spotted by eye in `qc-out` must be logged even if the type
  check passed.
- When an open issue is resolved, delete its entry and move it into the
  changelog section.

## Housekeeping

- Do not commit `node_modules`, `dist`, `.npm-cache`, or `qc-out`.
- Browser play is the only supported target. Desktop packaging was removed;
  ask before reintroducing it.
