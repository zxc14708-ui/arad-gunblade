# ARAD Gunblade — Claude Code Handoff

## Project

- Browser game built with TypeScript, Vite, and Three.js.
- Entry point: `src/main.ts`; game loop and flow: `src/core/Game.ts`.
- Do not add external art unless explicitly requested. Existing assets are in `public/assets/`.

## Commands

- `npm install` — install dependencies.
- `npm run build` — TypeScript check and Vite build.
- `npm run dev` — browser development server.
- `npm --prefix desktop install` — install the independent Electron package.
- `npm --prefix desktop run start` — build then start the Electron desktop wrapper.
- `npm --prefix desktop run package:win` — build a Windows NSIS installer in `desktop/release/`.

## Gameplay Architecture

- `src/systems/RunState.ts` creates a random connected grid of rooms at the start of a run.
- A cleared room opens every connected exit; revisiting cleared rooms must not respawn enemies or duplicate rewards.
- Room kinds: combat, elite, treasure, shop, boss.
- Elite rooms grant a trait choice and bonus gold before exits unlock.
- `src/systems/Room.ts` owns room bounds and cardinal entry/door coordinates.
- `src/ui/HUD.ts` renders the minimap. Keep it synchronized with `RunState.minimap()`.
- Enemy counts are controlled through `CONFIG.spawn.roomDensity` in `src/config.ts`.

## UI and Desktop Rules

- Right-click is reserved for gameplay. Keep context menus disabled globally in `src/main.ts` and in the Electron wrapper.
- The desktop wrapper is `desktop/main.cjs`. Keep Electron security defaults: `contextIsolation: true`, `nodeIntegration: false`.
- Browser play must remain supported; the desktop build is an additional distribution target.

## Current Handoff State

- Random-map work was committed as `992e181` on `agent/random-map-system` and opened as GitHub PR #1. Confirm the PR/main status before building on it.
- This handoff adds elite rewards, minimap connection indicators, and Electron packaging configuration.
- Validate with `npm run build` after code changes. Do not commit `node_modules`, `dist`, `.npm-cache`, or `release`.
