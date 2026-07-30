# Open Design Decisions

Resolved history was moved to `docs/archive/DESIGN_LOG_2026-07.md` on
2026-07-30. Keep this file short: unresolved decisions only.

## Chapter 1 stages 2–7

- Stage 1 is the only implemented stage.
- The user-approved campaign structure is Stage 1 through Stage 7 as Chapter
  1. Level, traits, equipment, gold, and current HP persist between stages.
- Each stage ends with a boss preparation room that contains a merchant and a
  healing fountain.
- Every boss gives a reward; higher stages add extra rewards. Exact reward
  contents and escalation are not decided.
- Required decision before implementation: theme, room props, enemy roster,
  boss identity, and boss reward for each Stage 2–7.

## Persistent cloud save

- Browser `localStorage` is the current supported persistence mechanism.
- Cloud-synced progression needs an approved account/authentication and backend
  approach before implementation. Do not add a server or collect identity data
  without a user decision.

## Final weapon motion art

- Current non-default weapons use temporary equipment, projectile, and melee
  effect sprites. Their gameplay stats remain unchanged.
- Final per-weapon character motion sheets must use the 112×64, 27-frame grid
  in `ART_GUIDE.md`; detailed handoff is in `docs/systems/weapon-visuals.md`.
