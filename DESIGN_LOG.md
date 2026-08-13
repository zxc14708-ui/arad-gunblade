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
  attack cadence. Originally implemented as a stationary turret at the kill
  position (no movement/pathing); **P10 커밋3-2 explicitly changed this to
  a player-following echo** (fixed follow radius, reuses the ranged-enemy
  angle-slot pattern so multiple echoes don't overlap) — attack cadence/
  range/damage fraction untouched. Follow radius/speed are new drafts
  (`CONFIG.traits.remnantFollowRadius`/`remnantMoveSpeed`), not approved
  numbers — flagged for review same as any other numeric draft.
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

## 결정 근거 기록 (작업 지시 P10 커밋4 — 수치는 STATE_SNAPSHOT.md가 정본)

- **액티브 스킬(Q/E/R) 폐지 근거 — 확인 안 됨.** `c4fc0ac`(P6 커밋2)가
  Q/E/R과 종속 슬롯 특성 4종을 코드에서 제거한 사실은 확인되지만, 폐지
  사유를 적은 기록은 저장소 어디에도 없다(추가 당시 근거는
  `docs/archive/DESIGN_LOG_2026-07.md`의 "C4. 액티브 스킬이 없다 — 던파
  팬 게임의 정체성과 가장 크게 어긋나는 지점"으로 남아있는데, 이후 폐지
  결정은 같은 파일에 대응 기록이 없다). 원 작업 지시서(P6_prompt)가
  저장소에 보관돼 있지 않아 커밋 메시지만으로는 재구성할 수 없다 —
  근거 불명으로 기록만 남긴다.
- **리듬 재장전 폐지 근거(P10 커밋1).** `8dd489b`(P6 커밋3)로 도입한
  R 두 번 눌러 성공 창을 맞추는 리듬 판정이 "체감상 의미가 크지
  않다"는 사용자 판단으로 폐지됐다(P10 작업 지시서 원문). 재장전
  자체(R 수동, 소진 시 자동)는 그대로 유지하고, 발도장전처럼 리듬과
  무관한 다른 게이지 메커니즘은 손대지 않았다.
- **경험치 체계 폐지 근거(P7 커밋1, `571082b`).** `Player.level/xp`는
  스탯을 올리지도 무언가를 해금하지도 않는, 특성 선택 횟수를 세는
  장치에 불과했다 — 그 역할은 같은 작업의 다음 커밋(선형 분기 맵의
  각인/상위전투 노드)이 대신 맡았다. 특성 획득 경로가 상자/엘리트/
  제련소뿐이던 중간 상태를 거쳐, 맵 노드 도입으로 대체됐다.
- **각인 등급 부활 근거(P8 커밋3, `a3ea4ac`).** 특성 등급(rarity)
  축은 슬롯제 도입 때(`f634eb8`) 이미 한 번 폐기됐다 — 신규 슬롯
  특성은 전부 'epic'으로 통일돼 있고 각인은 등급이 뒤섞여 있어 카드
  색이 아무 정보도 전달하지 못했기 때문이다. P8 커밋3은 이 개념을
  슬롯 특성이 아니라 "각인"에만 한정해 되살렸다 — 각인은 슬롯 특성과
  달리 같은 각인을 런 중 반복해서 다시 만나므로, 스택 대신 승급
  (노멀→...→에픽)이라는 반복 가능한 성장 축으로 쓸 수 있다는 점이
  핵심 차이다.
- **회복 노드(마을 분수) 제거 근거(P7 커밋2, `0f66916`).** 선형 분기
  맵 도입과 함께 마을 분수를 제거했다 — 마을에 입장하면 이미 완전
  회복되므로, 마을 분수는 같은 효과를 내는 회복 수단의 순수한 중복
  이었다. 던전 내 회복은 그대로 유지되며(맵 구조 자체가 'recover'
  노드와 보스 준비방 유료 분수를 배치 규칙으로 보장), 되돌아가기
  폐지(모든 방 연결이 parent→child 단방향이라 구조적으로 이전 방에
  돌아갈 수 없다)도 같은 커밋의 산출물이다.

## 보류 항목 (작업 지시 P10 커밋4)

다음 세 항목은 저장소·문서 어디에도 결정된 방향이 없다 — 이 세션에서
새로 판단하지 않고 그대로 보류로 남긴다:

- **전직(4종) 시스템.** 캐릭터가 특정 조건에서 4가지 전직 중 하나를
  택하는 구조 자체가 아직 설계되지 않았다. 무기 3종(총/검/캐릭터
  각인 축)과의 관계, 전직별 고유 각인/슬롯 유무 등 기본 골격부터
  필요하다.
- **무기 계열 고정.** 런 중 무기를 자유롭게 교체할 수 있는 현재
  구조를, 시작 시 하나의 무기 계열(권총/기관단총/... 중 하나)로
  고정하는 모드로 바꿀지 여부. 각인 3축(총/검/캐릭터) 설계와 충돌
  가능성이 있어 먼저 검토가 필요하다.
- **캐릭터 팔레트 리컬러.** `tools/quantize_sheet.py`/`recolor_sheet.py`
  파이프라인은 존재하지만(P4/P4b), 실제 적용 대상(플레이어 색상
  베리에이션 vs. 몬스터 팔레트 스왑)과 몇 종을 만들지가 결정되지
  않았다. `measure_sprites.py`의 팔레트 파이프라인 검사도 현재
  "아키타입 0개 — 검사 스킵" 상태다(`npm run qc` 로그 참고).

## Final weapon motion art

- Current non-default weapons use temporary equipment, projectile, and melee
  effect sprites. Their gameplay stats remain unchanged.
- Final per-weapon character motion sheets must use the 112×64, 27-frame grid
  in `ART_GUIDE.md`; detailed handoff is in `docs/systems/weapon-visuals.md`.
