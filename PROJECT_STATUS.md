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
- **QC now waits on the game's own simulated clock, not wall time, for
  in-game durations.** `Game.ts` exposes `simClock` (seconds), accumulated in
  `step(dt)` from the same hitstop-scaled `dt` gameplay timers use; it stalls
  exactly when gameplay does (any non-`'play'` state, or `settingsOpen`).
  `tools/qc.mjs` adds `waitGame(p, gameSeconds)` — polls via
  `page.waitForFunction(..., { polling: 'raf' })` until `simClock` advances by
  the requested amount, with a wall-clock safety cap
  (`max(15s, gameSeconds × 20)`) that distinguishes "clock stalled" from
  "clock too slow" in its error, reporting the measured rate either way.
  15 of the 50 `waitForTimeout` calls that were gating in-game durations
  (reload, boss telegraph/charge/stagger, regen delay, active-skill/iaido
  windows, i-frames, frame-processing waits for death/split/phase-2 handling)
  now use `waitGame`; the other 35 (modal opens/closes, pure screenshot
  stabilization, page load, viewport resize, `walkTo()`'s 80ms input pump)
  stayed on `waitForTimeout` — they either occur while the sim clock is
  frozen or don't gate any correctness check. `walkTo()`'s deadline is now
  `gameSeconds` (default 6, matching its old 6000ms) with the same wall-clock
  safety cap. The boss-timing sampler (`startQcSampler`/`stopQcSampler`)
  switched its sample timestamps from `performance.now()` to `simClock` too —
  it was measuring wall-clock segment lengths against in-game-second
  expectations, which was the other half of why `17-boss-charge`/
  `18-boss-slam` read inflated durations on this container.
  A preflight in `01-town-idle` measures the rate (game-seconds ÷
  wall-clock-seconds) once per run and prints/logs it; this sandbox measures
  ~0.25–0.29× consistently.
- Result: all 7 previously-failing scenarios (`04-reload`, `09-town-meta`,
  `12-active-skills`, `13-iaido`, `17-boss-charge`, `18-boss-slam`,
  `21-elite-regen`) now pass reliably in this sandbox — confirmed clean
  24/24 across 3 consecutive `npm run qc` runs. Asset integrity and
  `state_snapshot.mjs --check` both still pass.
- One unrelated, pre-existing flake surfaced while re-running: `16-boss-prep`
  (the `fountainRoomCount` assertion added in an earlier change) failed once
  with "실제 3" fountain rooms instead of 4. `RunState`'s room-kind roll
  (`combat`/`elite`/`treasure`) is unseeded `Math.random()`, and
  `assignFountains()`'s own documented fallback ("전투방이 부족하면 있는 만큼만
  배치") means a map that randomly rolls fewer than 2 `combat` rooms
  legitimately produces 3, not 4. This is independent of the clock-source
  change (game-clock or wall-clock, the map itself is unaffected) and outside
  this task's scope (no gameplay/balance numbers touched) — flagging it here
  rather than fixing it, since it's a pre-existing map-generation edge case
  in a check from a prior task, not a regression from this one.
- `qc-out/contact.png` was inspected; `12-active-skills` now visibly shows
  the R finishing shockwave, and `13-iaido` shows both pierced enemies
  correctly damaged — both previously-failing assertions were also visually
  confirmed, not just green-checkmarked.

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
