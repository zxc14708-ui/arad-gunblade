# Current Project Status

Last updated: 2026-08-01

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
- Run-scope state (level, xp, traits, gold, equipped loadout, "once per run"
  facility flags) resets at the town-entry boundary via `Game.startRun()`,
  not at dungeon entry — clearing a boss and returning to town now actually
  starts a fresh run instead of carrying the previous run's level/traits into
  depth 1. Meta progression (`MetaProgression`) and weapon unlocks persist
  across this boundary as before.
- Dungeon shop stock (shop room and boss-prep/`rest` room) is keyed per room
  ID in a `Map`, so shuttling between the two rooms no longer force-regenerates
  either room's inventory, sold state, or reroll price.
- `CONFIG.economy.fountainRoomCount` is `4` (shop + boss-prep + 2 combat
  rooms), matching the actual placement `RunState.assignFountains()` already
  produced — no gameplay change, the count now matches its own definition.
- `docs/STATE_SNAPSHOT.md` is a generated weapon/trait/enemy/economy value
  table, produced by `node tools/state_snapshot.mjs` importing directly from
  `config.ts`/`Weapons.ts`/`Upgrades.ts`/`Enemy.ts`/`RunState.ts`/
  `EliteAffixes.ts` — never hand-edited. `npm run qc` runs
  `tools/state_snapshot.mjs --check` as a static gate alongside asset
  integrity, so a balance change without a regenerated, committed snapshot
  fails QC. `POOL` (Upgrades.ts), `DEFS` (Enemy.ts), and `STAGES`
  (RunState.ts) are now exported so the generator can import them. The
  snapshot's single-target-DPS view currently surfaces 5 rarity inversions
  (a lower-rarity weapon out-DPSing a higher one) — reporting only, not a
  balance change in scope here.

## Verification baseline

- `npm run qc`: 24 scenarios (22 prior + `run-reset` + `shop-persist`).
  `tools/measure_sprites.py` now also measures the boss sheet's `charge`
  state (previously silently skipped by the checker, not by the game).
- 7 of the 24 scenarios (`04-reload`, `09-town-meta`, `12-active-skills`,
  `13-iaido`, `17-boss-charge`, `18-boss-slam`, `21-elite-regen`) fail in
  this sandbox on unmodified code — every one of them is gated by a fixed
  real-time budget (`waitForTimeout`, or `walkTo()`'s wall-clock deadline) in
  `tools/qc.mjs`, and this container's headless Chromium appears to run at a
  much lower effective frame rate than whatever machine recorded the prior
  22/22 baseline. Re-running the same steps back-to-back gives different
  failure magnitudes on identical code, which real regressions would not do.
  Treat this as a QC-harness environment gap (durations should probably be
  measured against the game's own simulated clock, not wall time) rather
  than a functional defect.
- Asset integrity passed; browser console/network errors: 0.
- `qc-out/contact.png` was inspected after this change; the 5 new/rewritten
  scenarios (`23-run-reset`, `24-shop-persist`, and the boss sheet rows in
  `measure_sprites.py`) all render/measure as expected.

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
