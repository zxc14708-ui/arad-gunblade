# Current Project Status

Last updated: 2026-10-09

## Playable now

- Chapter 1 runs through Stages 1-7 as a **linear branching map** (depth
  1-9, `RunState.ts`). Depth 4 is always a shop, depth 8 is always the boss
  preparation room, depth 9 is the boss — no choice at those depths.
  Branching depths (1/2/3/5/6/7) always offer `combat` + `elite`; the 2-4
  depths that also carry a `trait`/`hardCombat` node offer 3 choices (P9
  commit 1, 2026-10-09 — the `recover` node was removed). Every room connection
  is parent→child one-way, so **backtracking to a previous room is
  structurally impossible**. Exits are presented as 1-3 route cards that show
  room type, enemy roster/count, difficulty multipliers, reward/grade, elite
  affix, and reserve-magazine recharge information when relevant. Physical
  dungeon door interactables are gone. Combat rooms open the cards after all
  reward selection finishes; shop/boss-prep rooms keep their facilities
  usable until the player presses `다음 경로 보기`. The depth-0 lobby remains
  only as a hidden graph root and is never rendered. Stage 2-7 use the
  user-approved illustrated
  Stage 2 enemy set plus temporary Stages 3-7 environments/roster
  (`docs/systems/stages-2-7.md`); stage themes/final boss identities remain
  open (`DESIGN_LOG.md`).
- **Side-scrolling combat rooms (pilot, 2026-10-09).** Normal `combat` nodes
  are 126×16 belt rooms entered from the west: three 42-unit sections lock the
  player and camera until that section's wave (a third of the room's enemies)
  is cleared, a blinking `GO ▶` points onward, and route cards open after the
  last section. Camera angle and 360° aim are unchanged; other room kinds stay
  single-screen. Details: `docs/systems/belt-rooms.md`; open follow-ups in
  `DESIGN_LOG.md` "횡스크롤 전환".
- **No active skills (Q/E/R) and no experience/leveling.** Combat is
  shoot/slash/dash/reload only. Trait acquisition comes from chests, elite
  kills, the dungeon forge, and map reward nodes (각인/상위 전투) — leveling
  never granted stats or unlocks, so removing it (P7 커밋1) cost nothing.
- **Reload**: R (manual), automatic on empty magazine. No rhythm/timing
  window (P10 커밋1 reverted P6's rhythm mechanic — it added negligible
  feel for its complexity). Sword-hit-triggered reload (발도장전) and
  condition gauges (발도참/조준사격) are unrelated mechanics and untouched.
- **Trait system: 3 slot axes × sigils, 5 grades.** Core slots are
  gun/sword/character (1 trait each, no grade, no stacking). Sigils
  (35 total — gun 11 / sword 11 / character 13) use a 5-tier grade ladder
  (일반→희귀→영웅→전설→신화); re-acquiring a held sigil promotes it
  (never stacks, downgrade attempts are ignored). Grades exist only for
  sigils, not core-slot traits — see `DESIGN_LOG.md` "각인 등급 부활 근거"
  for why the concept was scoped this narrowly.
- **Sigil families + synergy-weighted rewards (P11, 2026-10-09).** Every
  sigil carries 1-2 family tags (15 families, each with ≥2 sigils) plus
  explicit synergy links. Reward cards show the tags and "보유 중인 ○○와
  시너지"; offer draws weight explicit-synergy candidates ×3 and same-family
  ×2, with no bonus for a family already drawn in the same roll. Conflicting
  sigils are not penalized (they cancel numerically). 7 partner sigils were
  added (뇌격·임계점·연격·저격 자세·질풍·교차 장전·전리품). Weights are
  initial values pending playtest feedback.
- **Set bonuses (2026-10-09).** Owning 2+ sigils of one family turns on that
  family's single bonus (table in `docs/STATE_SNAPSHOT.md`, applied in
  `Player.recomputeSigilMods`). The trait panel lists active sets; reward
  cards show "○○ 세트 완성" when a pick would complete one.
- **Status effects (3)**: stun (sigils 뇌진탕/충격 대시 — elites take half
  duration, bosses immune, 2s re-stun immunity after a stun ends),
  bleed (stacking, per-stack tick damage), shock (refreshing, damage-taken
  multiplier, no stagger). See `docs/STATE_SNAPSHOT.md` for exact numbers.
- Boss state machine (idle → telegraph → charge/slam → stagger → phase 2)
  plus boss break (HP 75%/25% stun windows) and 6 elite affixes.
- **Picture town (2026-10-10).** The town is one illustration filling the
  screen (`assets/town/arad_village_bg.png`, `scene.background`, fixed
  camera). Only the dirt road (screen 3–97% × 64–92%) is walkable; facility
  spots are screen-fraction coordinates projected to the ground
  (`TOWN_PICTURE` in `Game.ts`): smith → weapon blueprints, tavern → starting
  trait, stall → power altar, right stone arch → dungeon. Since the v3 art
  delivery the background is `arad_village_v3.png` (960×540 ×2, 64 colours)
  and the three facilities are animated NPCs (`Interactable.useNpcSheet`).
- Town fully heals on entry; the town fountain was removed as a redundant
  duplicate of that (P7 커밋2). In-dungeon recovery is the fountain in the
  depth-4 shop room and the depth-8 boss-prep room (first use per run free,
  then 60→96→154G).
- Normal `combat` nodes pay kill gold ×1.5 (`CONFIG.economy.combatGoldMultiplier`,
  P9 commit 1) so they are the gold route against trait/elite sigil routes.
- Fixed 1920 x 1080 presentation with aspect-safe browser scaling. Pixel
  texture/filter, sprite anchoring, and prop aspect rules are centralized
  in `src/rendering/pixelArt.ts`.
- All loadouts use one character sheet — since 2026-10-10 the new SD sheet
  `assets/characters/gunblader-sd/compat27.png` plus a second atlas row with
  the run (6) and X-slash (12) sheets. Dungeon movement plays run, the town
  plays walk. **Basic attack = X-shaped double slash** (two hits × 50%, second
  0.15 s later, on-hit effects per hit); the '이도류' core trait was removed.
  Dash plays its own 4-frame sheet (atlas row 2) and the `windX` X-slash
  layer is drawn in front of the character on attack frames 2–9; the world
  slash shows only the thin aim-direction arc (`docs/art/gunblader-sd.md`).
  Per-weapon visual
  changes are deferred until matching final motion sheets are delivered; see
  `docs/systems/weapon-visuals.md`.
- Run-scope state (traits, gold, equipped loadout, "once per run" facility
  flags) resets at the town-entry boundary via `Game.startRun()`. Meta
  progression (`MetaProgression`) and weapon unlocks persist across it.
- Dungeon shop stock (shop room and boss-prep/`rest` room) is keyed per room
  ID in a `Map`, so shuttling between the two rooms doesn't force-regenerate
  either room's inventory, sold state, or reroll price.
- `docs/STATE_SNAPSHOT.md` is a generated weapon/trait/enemy/economy value
  table, produced by `node tools/state_snapshot.mjs` importing directly from
  `config.ts`/`Weapons.ts`/`Upgrades.ts`/`Enemy.ts`/`RunState.ts`/
  `EliteAffixes.ts` — never hand-edited. `npm run qc` runs
  `tools/state_snapshot.mjs --check` as a static gate, so a balance change
  without a regenerated, committed snapshot fails QC.
- Weapon balance pass (user-approved, exact values given): rifle
  damage 50→58 / reload 3.2→2.5, magnum damage 43→50 / cooldown 0.5→0.45,
  rapier damage 32→28 / cooldown 0.34→0.36, greatsword damage 58→65 /
  cooldown 0.78→0.75, warhammer damage 77→82 / cooldown 1.0→0.95. All 7
  swords' `range` × 1.5. Weapon numbers and core-slot trait effects are not
  to be changed casually — see `CLAUDE.md`.

- Interaction/reload key hints on screen (`E`/`R`) follow the player's
  saved key bindings from startup and after rebinding in settings
  (`HUD.setKeyHints`, checked by the `settings` QC step).
- `tsconfig.json` now enables `noUnusedLocals`/`noUnusedParameters`, so
  dead locals/imports fail the type check instead of accumulating.

## Verification baseline

- `npm run qc` builds, serves, and drives a real headless browser through
  40+ scenarios, writing `qc-out/contact.png` (every step on one page,
  judged by eye) and `report.txt`. It gates on: 0 console/network errors,
  every scenario's assertions, asset integrity (`measure_sprites.py`), and
  `state_snapshot.mjs --check`.
- **This sandbox's game clock runs far slower than wall clock** (commonly
  0.15-0.29× game-seconds/wall-second, measured fresh each run in a
  `01-town-idle` preflight and logged). Timing-sensitive QC steps wait on
  the game's own simulated clock (`Game.simClock`) via `waitGame()`
  (`page.waitForFunction` polling), not wall time, with a wall-clock safety
  cap that distinguishes "clock stalled" (a real bug/hang) from "clock too
  slow" (environmental) in its error message.
- The recurring `boss-break` "게임 시계 정지" failure followed by a hung run
  was a real harness bug, not environment: `boss-charge` makes the player
  near-immortal by raising HP, but the reward step in between triggers
  `recompute()`, which clamps HP back to the normal max. `boss-break` then let
  the boss attack for several game-seconds and the player sometimes died
  (`gameover` stops the clock). Fixed 2026-10-09 by setting the post-hit
  invulnerability timer for that step; `waitGame()` failures now also print
  `state`/`settingsOpen`/player HP so a stalled clock names its cause.
- The shared combat sandbox used by most dungeon QC scenarios is a 42×30
  non-combat room on purpose (`route-choice` picks a non-`combat` card); the
  belt room is covered by its own `belt-room` scenario.
- QC needs Python Pillow + NumPy for `tools/measure_sprites.py`
  (`pip install pillow numpy`); a fresh sandbox without them fails the asset
  integrity gate with `ModuleNotFoundError: PIL`.
- **Known environmental flakiness**: individual steps occasionally fail
  with "게임 시계 정지" in a full sequential run while passing cleanly in
  an isolated `--only <step>` rerun, especially after several consecutive
  full `npm run qc` invocations in the same sandbox session accumulate
  CPU/process load (stale `vite preview` servers from earlier runs are a
  known contributor — kill them, let load average settle, and retry before
  concluding a step actually regressed). Isolated `--only` runs skip the
  `town-idle` preflight. Since the picture town (2026-10-10) the preflight
  measures a much cheaper scene (~0.9× vs ~0.2× in dungeons), so it is only a
  sandbox-load indicator; `hitstop-surround-slowzone` now derives its expected
  distances from the game time elapsed inside its own measurement window.

## Next approved implementation work

1. View change ④ (camera ~30°, backdrop behind the north wall, south wall
   removed) was chosen 2026-10-10; implementation numbers await approval in
   `DESIGN_LOG.md` "화면 시점 전환 — ④". The village reference illustration is
   usable as the town backdrop under ④ (re-delivered as PNG).
2. Playtest the belt-room pilot, then decide the `DESIGN_LOG.md` "횡스크롤
   전환" follow-ups (wave size, extending to other room kinds, route-card
   timing, issue-6 re-measurement) and request per-stage belt background art
   (template in `docs/systems/belt-rooms.md`).
3. Integrate per-weapon visuals only after matching final motion sheets are
   delivered, then visually QC each loadout.
4. Replace the Stage 2-7 palette placeholders with final theme-specific art
   and name/illustrate each boss. Escalating boss reward contents remain open.
5. Add final weapon/projectile/melee-effect art once the matching sheets are
   delivered.
6. All 2026-10-09 orchestrator-review items are decided and implemented
   (P10 numbers, '철벽' rename, issue-6 한손검 starter, P11 families/partner
   sigils, stun sigils, P9 commit 1, set bonuses) — history in `DESIGN_LOG.md`
   ("오케스트레이터 점검 결과"). Synergy weights and set values await playtest
   feedback.
7. Three items with no decided direction yet (see `DESIGN_LOG.md` "보류
   항목"): 4-way job advancement (전직), locking a run to one weapon family
   at start, and character/monster palette recolor variants.

## Before starting work

Read `AGENTS.md`, `HANDOFF.md`, then only the relevant document named in
`docs/INDEX.md`. Open design decisions live in `DESIGN_LOG.md`; resolved
history lives in `docs/archive/`.
