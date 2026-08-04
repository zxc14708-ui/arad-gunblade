# Fast Handoff

Read in this order: `AGENTS.md` -> `PROJECT_STATUS.md` -> this file -> the one
task-specific document listed in `docs/INDEX.md`.

## Current baseline

- Mainline visual target: 1920 x 1080, 16:9, pixel-art sprites.
- QC gate: `npm run qc`, then inspect `qc-out/contact.png`.
- Stages 1-7 are playable as one continuous Chapter-1 run. Stage 2-7 use
  disposable palette-variant art and implemented prototype enemy mechanics;
  see `docs/systems/stages-2-7.md`.
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
