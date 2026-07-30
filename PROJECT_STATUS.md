# Current Project Status

Last updated: 2026-07-30

## Playable now

- Stage 1 random connected dungeon run, elite/treasure/shop rooms, and boss
  preparation room (merchant + healing fountain).
- Boss and elite affix systems, active skills (Q/E/R), dash, reload, loadout,
  traits, town meta progression, and keyboard rebinding.
- Fixed 1920×1080 presentation with aspect-safe browser scaling.
- Pixel texture/filter, sprite anchoring, and prop aspect rules are centralized
  in `src/rendering/pixelArt.ts`.
- Default M1911 + katana uses the finished original character sheet. Other
  loadouts use temporary weapon visuals; see `docs/systems/weapon-visuals.md`.

## Verification baseline

- `npm run qc`: 22 scenarios passed on 2026-07-30.
- Asset integrity passed; browser console/network errors: 0.
- `qc-out/contact.png` was inspected after the 1920×1080 and pixel-rendering
  updates.

## Next approved implementation work

1. Finish the temporary per-weapon visual pass and visually QC each loadout.
2. Define Stage 2–7 themes, enemies, bosses, and escalating boss rewards.
3. Replace temporary weapon/effect art with final motion sheets once delivered.

## Before starting work

Read `AGENTS.md`, `HANDOFF.md`, then only the relevant document named in
`docs/INDEX.md`. Open design decisions live in `DESIGN_LOG.md`; resolved
history lives in `docs/archive/`.
