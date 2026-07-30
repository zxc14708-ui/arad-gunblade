# Fast Handoff

Read in this order: `AGENTS.md` -> `PROJECT_STATUS.md` -> this file -> the one
task-specific document listed in `docs/INDEX.md`.

## Current baseline

- Mainline visual target: 1920 x 1080, 16:9, pixel-art sprites.
- QC gate: `npm run qc`, then inspect `qc-out/contact.png`.
- Stage 1 is playable; Stage 2-7 need concepts before implementation.
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
until matched final sheets arrive. Final art replacement and Stages 2-7 remain
future work.
