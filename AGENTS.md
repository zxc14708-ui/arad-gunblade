# ARAD: Gunblade — Working Rules

TypeScript + Vite + Three.js browser game. `src/main.ts` starts the game and
`src/core/Game.ts` owns the game loop.

## Read only what applies

1. Always read this file, `PROJECT_STATUS.md`, and `HANDOFF.md`.
2. Read `DESIGN_LOG.md` only for unresolved decisions related to the task.
3. Read one matching detailed document from `docs/` when it exists.
4. Do not read `docs/archive/` unless historical context is required.

`docs/INDEX.md` routes each task to its smallest required context. The archive
is history, not a second source of truth.

## Commands and quality gate

- `npm install` — install dependencies.
- `npm run build` — TypeScript and production build only.
- `npm run qc` — build, automated browser play, screenshots, and error check.

`npm run build` is never enough. Before a gameplay or visual change is called
complete, run `npm run qc` and inspect `qc-out/contact.png`. Do not commit
`node_modules`, `dist`, `.npm-cache`, `qc-out`, `desktop`, or `tmp`.

## Collaboration boundaries

- Claude (chat): design proposals and written specifications.
- Codex: code implementation of approved decisions.
- GPT: PNG art assets only.
- Claude Code: final integration and visual QC.

Do not invent gameplay balance or system rules. If a required design decision
is missing, add concise options to `DESIGN_LOG.md` and stop for user direction.
All balance numbers belong in `src/config.ts`, `src/systems/Weapons.ts`, or
`src/systems/Upgrades.ts`.

## Gameplay invariants

- `RunState.ts` builds the connected room map. Cleared rooms never respawn
  enemies or duplicate rewards.
- `Room.ts` owns room bounds and entrances; `HUD.ts` owns the minimap.
- Enemy density comes from `CONFIG.spawn.roomDensity`.
- Right click is gameplay-only; keep the browser context menu disabled.
- The camera must never reveal floor-edge black voids.

## Asset invariants

- Character/enemy sheets are horizontal square-cell strips. Frame counts must
  match code.
- All sprites are bottom-anchored. Source art sits on the cell bottom edge.
- PNGs use transparent backgrounds, nearest-neighbour filtering, no soft
  anti-aliasing or opaque black backgrounds.
- Props keep their real aspect ratio and matching `ASPECT` declaration.
- New art must be registered in `src/rendering/assets.ts` and covered by QC.

See `ART_GUIDE.md` for dimensions and the delivery checklist.
