# Open Design Decisions

Resolved history was moved to `docs/archive/DESIGN_LOG_2026-07.md` on
2026-07-30. Keep this file short: unresolved decisions only.

## Chapter 1 stages 2–7 rewards and final art

- Stages 1-7 and their temporary enemy mechanics are implemented. Stage themes,
  roster and prototype boss pattern inheritance are recorded in
  `docs/systems/stages-2-7.md`.
- The user-approved campaign structure is Stage 1 through Stage 7 as Chapter
  1. Level, traits, equipment, gold, and current HP persist between stages.
- Each stage ends with a boss preparation room that contains a merchant and a
  healing fountain.
- Every boss gives a reward; higher stages add extra rewards. Exact reward
  contents and escalation are not decided.
- Still unresolved: final boss identities, final stage/monster art, and the
  exact escalating boss reward contents for Stages 2-7.

## Persistent cloud save

- Browser `localStorage` is the current supported persistence mechanism.
- Cloud-synced progression needs an approved account/authentication and backend
  approach before implementation. Do not add a server or collect identity data
  without a user decision.

## Sigil grade numeric values and interpretation calls (P8 commit3)

Work order `P8_prompt_axis_rework_and_sigils.md` explicitly requires draft
numeric values for commit 4's 18 new sigils to be presented for approval
before implementation. It does not say the same for commit 3's 7 pre-existing
sigils, but their 5-tier value tables are the same kind of balance judgment —
implemented as drafts (see `docs/STATE_SNAPSHOT.md` "각인 등급별 수치" table)
so the numbers are visible and adjustable, not silently finalized.

Interpretation calls made where the work order was silent, needing user/
design confirmation if the defaults are wrong:

- **Shop/forge sigil promotion vs. node reward promotion differ in size.**
  Map reward nodes (각인/상위 전투/엘리트/보스) grant the *node's* grade
  directly, per the node table. Shop and dungeon-forge acquisition (not a
  "node") instead promote by exactly one tier per pick, capped below epic.
  Rationale: nodes are tied to stage depth (a difficulty/reward gate), shop/
  forge are repeatable and depth-independent, so instant multi-tier jumps
  there would let gold trivially bypass the depth-gated curve.
- **Dry sigil pool fallback at reward nodes.** If a player already owns all
  7 sigils at or above the node's grade (plausible by mid-late run, since
  there are only 7 sigils and many reward nodes per run), the "확정 이득
  1장" guarantee has no sigil to guarantee. No fallback is specified in the
  work order; implemented as falling back to core-slot trait offers (empty
  slot, then same-slot swap) rather than granting nothing. Flagged for
  review, not a design decision — no gold/other compensation was added.
- **Epic-tier "rule change" scope.** The work order names exactly two
  sigils with an epic special rule (신속 장전, 폭심) as examples. Implemented
  literally — only those two get a rule change; the other 5 existing sigils
  only scale numerically at epic. Not confirmed this is the intended scope
  vs. "every sigil should eventually get one."
- **Pre-existing bug found and fixed in the same commit, not scoped by the
  work order:** `killEnemy()`'s explode-on-kill trigger fired unconditionally
  on every kill regardless of cause, including kills caused by its own
  explosion — meaning *any* grade of 폭심 already infinite-chained through
  a room before this commit. Since the work order describes chaining as an
  *epic-exclusive* rule, this was fixed as part of implementing that rule
  (sub-epic grades now single-explosion only) rather than filed separately,
  since the two are the same code path and splitting them would have meant
  shipping a commit that still had the bug for one release.

## New 18-sigil interpretation calls (P8c4)

Work order `P8c4_prompt_sigils_and_panel.md` supplied final approved numeric
values directly (including the 6 documented deviations from the chat-proposed
draft), so no numbers here are drafts pending approval. A few implementation
details were not specified and needed a call:

- **'잔재'(remnant, legendary unique) echo behavior.** The work order only
  says the echo "attacks in place of the player" for its duration at 50% of
  current gun damage — it doesn't specify movement, targeting range, or
  attack cadence. Implemented as a stationary turret at the kill position
  (no movement/pathing) that retargets the nearest alive enemy within
  `CONFIG.traits.remnantAttackRange` (7) every `remnantAttackInterval` (0.5s).
  Flagged for review — a mobile/tracking echo is an equally valid reading.
- **'황금의 무게'(golden_weight) scaling is continuous, not stepped.** "골드
  200당 +N%" is implemented as `(gold / 200) * rate`, i.e. a smooth ramp
  rather than snapping up only at each 200-gold threshold. Simpler and avoids
  visible discontinuities; flagged in case stepped was intended.
- **'혈흔'(blood_trace) detonation formula.** The work order's own rationale
  section specifies the intent ("잔여 피해 폭발," tied to bleed's existing
  numbers) but not an exact formula. Implemented as
  `Σ(remaining_seconds / tickInterval) * tickDamage` per active stack —
  a continuous approximation of "damage the bleed would still deal," cleared
  after detonating. Not a discrete tick-count formula; flagged for review.
- **"무기 전환" implementation detail.** The work order's definition (last
  weapon used changes) is unambiguous, but note the trigger point: it fires
  on the *first successful shot/swing after the change*, not the instant the
  player releases one weapon's input — e.g. firing the gun while already
  mid-swing-commit from a sword strike doesn't retroactively trigger it,
  since `lastWeaponUsed` only updates inside the actual fire/swing blocks.

## Final weapon motion art

- Current non-default weapons use temporary equipment, projectile, and melee
  effect sprites. Their gameplay stats remain unchanged.
- Final per-weapon character motion sheets must use the 112×64, 27-frame grid
  in `ART_GUIDE.md`; detailed handoff is in `docs/systems/weapon-visuals.md`.
