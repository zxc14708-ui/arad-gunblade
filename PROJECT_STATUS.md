# Current Project Status

Last updated: 2026-07-30

## Playable now

- Stage 1 random connected dungeon run, elite/treasure/shop rooms, and boss
  preparation room (merchant + healing fountain).
- Boss and elite affix systems, active skills (Q/E/R), dash, reload, loadout,
  traits, town meta progression, and keyboard rebinding.
- Fixed 1920 x 1080 presentation with aspect-safe browser scaling.
- Pixel texture/filter, sprite anchoring, and prop aspect rules are centralized
  in `src/rendering/pixelArt.ts`.
- All loadouts use the finished original character sheet. Per-weapon visual
  changes are deferred until matching final motion sheets are delivered; see
  `docs/systems/weapon-visuals.md`.

## Verification baseline

- `npm run qc`: 22 scenarios passed on 2026-07-30.
- Asset integrity passed; browser console/network errors: 0.
- `qc-out/contact.png` was inspected after the 1920 x 1080 and pixel-rendering
  updates.

## Next approved implementation work

1. Integrate per-weapon visuals only after matching final motion sheets are
   delivered, then visually QC each loadout.
2. Define Stage 2-7 themes, enemies, bosses, and escalating boss rewards.
3. Add final weapon/projectile/melee-effect art once the matching sheets are
   delivered.

## Before starting work

Read `AGENTS.md`, `HANDOFF.md`, then only the relevant document named in
`docs/INDEX.md`. Open design decisions live in `DESIGN_LOG.md`; resolved
history lives in `docs/archive/`.
