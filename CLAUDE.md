# ARAD Gunblade — Claude Code

**Read `AGENTS.md` first.** It holds the project overview, commands,
collaboration roles, asset rules, gameplay architecture, and housekeeping —
shared by every agent working on this repo. Do not duplicate any of it here;
two copies drift apart and the drift is invisible until something breaks.

This file covers only what is specific to Claude Code.

## Your role

Integration and QC. You are the only contributor that pushes to `main`.

- Verify what Codex and GPT produce. Integrate the valid parts, reject the rest.
- Run `npm run qc` and judge `contact.png` by eye before claiming anything works.
- Perform factual verification of open issues in `DESIGN_LOG.md` — reading code,
  measuring values, confirming or refuting claims — and record the results.
- Make no design calls. If a task needs one that is not already decided, log the
  question in `DESIGN_LOG.md` and tell the user.

Claude (chat) proposes; the user approves; Codex implements; you gate and ship.

## Verification: `npm run qc` is the gate

`npm run build` only proves the code compiles. Every bug that actually shipped
in this project was visual and passed the type check: character frames sliced
with a neighbour's sword in them, effect textures uploading black, the muzzle
flash drawn behind the head, boss rewards never appearing.

`npm run qc` builds, serves, and drives a real browser through fifteen steps
(town idle/walk, shoot, reload, slash, dash, settings, dungeon entry, combat,
boss charge/slam/phase-2, six elite affixes), then writes to `qc-out/`:

- `contact.png` — every step on one page. **Look at this before claiming a
  change works.**
- `NN-<step>.png` / `-zoom.png` — full frame and a crop around the player.
- `report.txt` — console/network errors and step failures.

A non-zero exit code means the change is rejected. A zero exit code only means
nothing crashed — sprite defects, effect placement, and layout breakage are
judged by eye from `contact.png`.

## Automated checks belong in the harness, not your eyes

Anything a script can decide should not consume a visual judgement. Extend
`tools/qc.mjs` (and `tools/measure_sprites.py`) rather than re-checking these
manually each time:

- `ASPECT` in `src/entities/Interactable.ts` vs. actual PNG width/height ratio.
- `FRAMES` in `src/entities/EnemySprite.ts` vs. sheet width divided by height.
- Every path referenced in `src/rendering/assets.ts` exists on disk.
- Sheet cells are square where the loader assumes square.
- Corner pixels are fully transparent — catches the black-halo class of bug.

Reserve eyes for what scripts cannot judge: composition, readability, whether
two interactables are actually distinguishable, whether pixel density looks
consistent across sprites sharing a frame.

## Boss/elite debug hooks (`QC_DEBUG` build flag)

The boss (idle → 예고 → 실행 → 경직 → phase-2) and elite-affix state machines
can't be reached deterministically through normal play — the boss room needs a
full 8-room clear and elite affixes are random. `tools/qc.mjs` builds with
`QC_DEBUG=1`, which flips `vite.config.ts`'s `__QC_DEBUG__` define to `true`;
`main.ts` then dynamically imports `src/core/qcDebugHooks.ts` and installs
`window.__game.debugSpawnBoss()` / `debugSpawnElite(kind, affix)` /
`debugClearEnemies()`. QC steps 10–15 use these to spawn the boss/elites
in-place and poll internal state (`bossState`, `bossTimer`, `shield`, etc. —
all reachable at runtime despite being `private` in TS) against the durations
in `Enemy.ts`'s `BOSS_PATTERN`/`ELITE_AFFIX` tables.

`QC_DEBUG` is unset for `npm run build` (the deploy build), so
`__QC_DEBUG__` folds to `false` and esbuild dead-code-eliminates the whole
dynamic-import block — `qcDebugHooks.ts` never ends up in `dist/`. Verify this
hasn't regressed with `npm run build && grep -r debugSpawnBoss dist/` (must be
empty) whenever touching this mechanism.

## Assets from GPT

New prop art lands at these paths; update `src/rendering/assets.ts` to point at
them and verify with `npm run qc`:

- `public/assets/props/trait_altar.png` / `trait_altar_glow_4f.png`
- `public/assets/props/trait_forge.png` / `trait_forge_glow_4f.png`

`trait_altar` and `trait_forge` currently borrow
`assets/stage1/stage1_forest_foreground/guardian_stone_a.png` and `_b.png` as
placeholders. `ASPECT` for both is already `48/64`, which matches the incoming
art, so `Interactable.ts` needs no change.

Fountain and portal art replaces existing files in place at unchanged
dimensions — no path or `ASPECT` change.
