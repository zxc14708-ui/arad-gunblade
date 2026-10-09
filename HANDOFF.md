# Fast Handoff

Read in this order: `AGENTS.md` -> `PROJECT_STATUS.md` -> this file -> the one
task-specific document listed in `docs/INDEX.md`.

## Current baseline

- Mainline visual target: 1920 x 1080, 16:9, pixel-art sprites.
- QC gate: `npm run qc`, then inspect `qc-out/contact.png`.
- Stages 1-7 are playable as one continuous Chapter-1 run. Stage 2 uses the
  user-approved illustrated temporary monster set (including a bow archer);
  Stages 3-7 still use disposable palette variants. Prototype enemy mechanics
  are implemented; see `docs/systems/stages-2-7.md`.
- Dungeon movement uses a separate route-card overlay (click or number keys
  1-3), not world door interactables. Combat rewards resolve before the route
  overlay opens. Shop/boss-prep facilities stay interactive until the
  player presses `다음 경로 보기`. The old depth-0 lobby is a hidden logical
  root only, preserving map generation/QC without adding a visible room.
- Every loadout currently uses the finished default character art. Per-weapon
  visuals are paused until matching final motion sheets are delivered; see
  `docs/systems/weapon-visuals.md`.

## Safety notes

- Preserve the user's untracked folders and never commit generated caches.
- Do not change combat values without an approved design entry.
- For asset changes, check transparent corners, declared dimensions, and
  in-game scale in the QC contact sheet.

## Current open work

Per-weapon appearance, projectile, and melee-effect art is deliberately disabled
until matched final sheets arrive. Stage 2-7 gameplay prototypes are complete;
their final art, boss identities and escalating reward table remain future work.

P9 commit 1 landed 2026-10-09: the `recover` node kind is gone, the depth-4
shop room has a fountain (fountains are fixed to shop + boss-prep), branch
depths are combat + elite (+ trait/hardCombat at 2-4 depths), and normal
combat nodes pay ×1.5 kill gold. The `boss-prep` QC step samples 300 maps for
these rules; `combat-gold-mult` checks the multiplier.
