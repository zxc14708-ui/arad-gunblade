# Fast Handoff

Read in this order: `AGENTS.md` → `PROJECT_STATUS.md` → this file → the one
task-specific document listed in `docs/INDEX.md`.

## Current baseline

- Mainline visual target: 1920×1080, 16:9, pixel-art sprites.
- QC gate: `npm run qc`, then inspect `qc-out/contact.png`.
- Stage 1 is playable; Stage 2–7 need concepts before implementation.
- Default character art is final-looking. Non-default weapon visuals are a
  temporary, runtime-composited set; their asset map is documented in
  `docs/systems/weapon-visuals.md`.

## Safety notes

- Preserve the user’s untracked folders and never commit generated caches.
- Do not change combat values without an approved design entry.
- For asset changes, check transparent corners, declared dimensions, and
  in-game scale in the QC contact sheet.

## Current open work

Temporary weapon appearance, projectile, and melee effect verification is in
progress. Final art replacement and Stages 2–7 remain future work.
