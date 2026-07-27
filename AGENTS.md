# ARAD Gunblade

Browser game: TypeScript + Vite + Three.js. Top-down roguelike, 2D billboard
sprites rendered in a 3D scene. Entry point `src/main.ts`; game loop and flow
`src/core/Game.ts`.

This repository is the single source of truth. All work lands here.
This file is the canonical rule set for every agent working on it.

## Commands

- `npm install` — install dependencies.
- `npm run build` — TypeScript check and Vite build.
- `npm run dev` — browser development server.
- `npm run qc` — build, play the game headlessly, screenshot every step.

`npm run build` passing is not verification. Every bug that shipped in this
project was visual and passed the type check. `npm run qc` is the gate, and
Claude Code owns it — see `CLAUDE.md`.

## Collaboration roles

Four contributors. Each stays in its lane and does not cross without the
user's sign-off. The user is the only channel between them.

- **Claude (chat)** — game design director. Reads the full codebase to surface
  balance and system issues, and writes specs. Proposals land in
  `DESIGN_LOG.md` under 미해결 이슈. Has no write access to this repo and does
  not read this file automatically; the user re-shares the repo each session.
- **Codex** — code implementation. Implements decisions already recorded in
  `DESIGN_LOG.md` or handed over as an explicit spec. Does not invent balance
  numbers or system-structure changes. If a task needs a design call that is
  not already decided, add the options to `DESIGN_LOG.md` under 미해결 이슈 and
  stop — do not pick one and ship it.
- **GPT** — art only. Produces PNG sprite sheets and props per Asset rules
  below. Never touches code.
- **Claude Code** — integration and QC. Verifies what Codex and GPT produce,
  runs `npm run qc`, judges `contact.png` by eye, commits and pushes. Also
  performs factual verification of open issues and records results. Makes no
  design calls; logs the question and tells the user instead.

Only Claude Code pushes to `main`. Work that has not passed `npm run qc` does
not merge, regardless of which agent produced it.

## Design log

`DESIGN_LOG.md` is the shared record of design decisions across all four.

- Any change to gameplay, balance, or system structure adds an entry at the top.
- Do not write numbers there — `src/config.ts` is the source of truth. Record
  intent, abandoned attempts, and open problems only.
- Visual defects spotted by eye in `qc-out` must be logged even when the type
  check passed.
- When an open issue is resolved, delete its entry and move it to the changelog.

## Gameplay architecture

- `src/systems/RunState.ts` builds a random connected grid of rooms at the
  start of a run. Room kinds: combat, elite, treasure, shop, boss.
- A cleared room opens every connected exit. Revisiting a cleared room must not
  respawn enemies or duplicate rewards.
- Elite rooms grant a trait choice and bonus gold before exits unlock.
- `src/systems/Room.ts` owns room bounds and cardinal entry/door coordinates.
- `src/ui/HUD.ts` renders the minimap. Keep it synchronized with
  `RunState.minimap()`.
- Enemy counts come from `CONFIG.spawn.roomDensity` in `src/config.ts`.
- All balance values live in `src/config.ts`, `src/systems/Weapons.ts`, and
  `src/systems/Upgrades.ts`. Do not scatter magic numbers elsewhere.

## Asset rules

### Character and enemy sheets

- Horizontal strips of square cells. Frame counts live in
  `src/entities/EnemySprite.ts` (`FRAMES`) and `src/rendering/assets.ts`.
- The player currently renders from a single static sheet, `public/gunblader.png`
  (an SD illustration, loaded via `CharacterSprite.SHEET_URL`), with a
  procedurally-drawn canvas sheet as the fallback shown before it loads. There
  is no `public/assets/player/gunblade_*.png` five-sheet set on disk — an
  earlier attempt at one was reverted (see `DESIGN_LOG.md` changelog). Do not
  assume per-state player PNGs exist without checking `public/` first.
- A creature's walk and attack sheets must use the same cell size and body
  proportions as its idle sheet. Mismatches between animation states are
  immediately visible in game.

### Props

- Props have no fixed canvas size. `src/entities/Interactable.ts` holds a
  per-item `ASPECT` (source width/height) and `SCALE` (world height).
- What must stay consistent is **pixel density**: source height in pixels
  divided by `SCALE`. Existing props sit near 11 px per world unit; character
  sheets range 12–29, so the project is not currently uniform. Do not widen
  that spread.
- New prop art must arrive at exactly the dimensions declared in `ASPECT`.
  A mismatched ratio is silently stretched at render time — the type check will
  not catch it and it is easy to miss in `contact.png`.
- Changing a prop's source resolution requires updating `ASPECT` in the same
  commit.

### All sprites

- Sprites are bottom-anchored (`center.set(0.5, 0)`). Art must sit with its
  base on the bottom edge of the cell, or it floats above the ground.
- Backgrounds must be fully transparent (alpha 0), never a dark fill. Art drawn
  against a dark backdrop leaves black halos on bright floors.
- Nearest-neighbour filtering. No anti-aliasing, no soft gradients, no
  semi-transparent edges.
- Floors are tiled textures — keep them small and low-contrast. A busy floor
  hides the player and enemies.
- Every file in `public/` is downloaded before play. Do not ship
  multi-megabyte images.
- Do not add external art unless explicitly requested. Existing assets are in
  `public/assets/`.

## UI rules

- Right-click is reserved for gameplay. Keep context menus disabled globally in
  `src/main.ts`.
- The room must fill the view. If the floor plane ends inside the camera
  frustum the player sees black voids — clamp the camera or enlarge the room.
- Interactables must be visually distinguishable from each other, by silhouette
  as well as colour.
- `src/main.ts` exposes `window.__game` for the QC harness to read the player's
  screen position and run state. Keep it.

## Housekeeping

- Do not commit `node_modules`, `dist`, `.npm-cache`, or `qc-out`.
- Browser play is the only supported target. Desktop packaging was removed;
  ask before reintroducing it.
