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
- Normal combat rooms are a side-scrolling pilot (126×16, three locked
  sections, `GO ▶`, route cards after the last section) — see
  `docs/systems/belt-rooms.md`. Other room kinds are unchanged.
- Every loadout uses the new SD character sheet (`compat27.png`, 2026-10-10;
  stage 2 — run/dash states and the X-slash — is not wired). Per-weapon
  visuals are paused until matching final motion sheets are delivered; see
  `docs/systems/weapon-visuals.md`.

## Safety notes

- Preserve the user's untracked folders and never commit generated caches.
- Do not change combat values without an approved design entry.
- For asset changes, check transparent corners, declared dimensions, and
  in-game scale in the QC contact sheet.

## Current open work

The town is now a single illustration ("picture town", `TOWN_PICTURE` in
`Game.ts`); its NPCs are placeholders awaiting NPC sprites (request in
`docs/systems/picture-town.md`).

Belt-room pilot (2026-10-09) awaits playtest; its open follow-ups are listed in
`DESIGN_LOG.md` "횡스크롤 전환" and per-stage belt background art has a request
template in `docs/systems/belt-rooms.md`.

Per-weapon appearance, projectile, and melee-effect art is deliberately disabled
until matched final sheets arrive. Stage 2-7 gameplay prototypes are complete;
their final art, boss identities and escalating reward table remain future work.

P9 commit 1 landed 2026-10-09: the `recover` node kind is gone, the depth-4
shop room has a fountain (fountains are fixed to shop + boss-prep), branch
depths are combat + elite (+ trait/hardCombat at 2-4 depths), and normal
combat nodes pay ×1.5 kill gold. The `boss-prep` QC step samples 300 maps for
these rules; `combat-gold-mult` checks the multiplier.
