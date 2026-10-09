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

## 오케스트레이터 점검 결과 (2026-10-09)

### 사용자 결정 (2026-10-09 승인)

- **P10 수치 초안 확정.** 예비 탄창 최대 3충전(획득 시 1, 상점·보스 준비방
  첫 입장 시 +1), 속사 전환 5등급(2.0s/-12% ~ 3.5s/-45%), 피해 상한 각인
  상한 최대 체력 20%, 잔재 추종 반경 2.5·이동 속도 11 — 현재 구현값 그대로.
- **피해 상한 각인 이름: '불굴' → '철벽'.** 메타 업그레이드 '불굴'(런당 1회
  부활)과 표시명이 겹쳐 각인 쪽을 바꿨다. id(`undaunted`)는 그대로.
- **각인 총수 26종 유지**(총 9/검 8/캐릭터 9). P10 표제의 "25종"은 폐기.
- **보류:** 일반 적 기절 발생 경로(시스템만 유지, `Enemy.applyStun()`은
  게임 플레이에서 호출되지 않음), P9 커밋1(회복 노드 제거·상점방 분수·분기
  보장·일반 전투 골드 배율).

### 이슈 6 — 검 계열 등급 재정렬 (계측 기반, 2026-10-09 결정)

아래 표는 계측값 기반 추정이다. 원 스펙 문서는 저장소에 없다 — "DPS × 기대 타격 수로 등급을
판정한다"는 `tools/qc.mjs` 주석이 유일한 근거다.

**계측(QC 2회, 카타나 검 스윙 117건, 2026-10-09):** 명중 수 분포
0회 43.5% · 1회 34.5% · 2회 14.5% · 3회 8% · 4회 이상 0%. 스윙 시점 반경
4/6/8 안의 적 수 중앙값은 모두 1. 즉 적이 밀집하지 않아, 범위가 넓어져도
한 번에 맞히는 수는 크게 늘지 않는다. 명중한 스윙만 보면 평균 1.55타.

**추정 모델(가정, 조정 가능):** 무기별 기대 타격 수 =
`min(2.0, 1 + 0.55 × (각도 × 사거리²) / 카타나의 같은 값)`.
0.55는 카타나 실측(1.55 − 1), 상한 2.0은 3타 이상이 8%뿐이라는 실측에서
잡았다. 런지(돌진 거리)·넉백은 반영하지 않았다.

| 검 | 현재 등급 | 단일 DPS | 기대 타격 | 실효 DPS | 순위 |
|---|---|---:|---:|---:|---:|
| 월광검 | legendary | 115.0 | 2.00 | 230 | 1 |
| 대검 | epic | 86.7 | 2.00 | 173 | 2 |
| 전투 망치 | epic | 86.3 | 1.92 | 166 | 3 |
| 언월도 | rare | 70.0 | 2.00 | 140 | 4 |
| 레이피어 | rare | 77.8 | 1.39 | 108 | 5 |
| 카타나 | common | 64.3 | 1.55 | 100 | 6 |
| 한손검 | rare | 66.7 | 1.27 | 84 | 7 |

**결과:** 역전은 1건 — 한손검(rare)이 카타나(common)보다 실효 DPS가 낮다.
나머지는 현재 등급 순서와 일치한다. 총 계열은 관통 표본이 3건뿐이라 이번 안에
포함하지 않았다.

**결정(2026-10-09 사용자 승인):** 한손검을 common으로 내린다. 이 저장소에서
common은 "처음부터 지급하는 기본 무기"를 뜻하므로(해금 상점에서 제외), 한손검도
기본 지급 무기가 된다 — 사용자가 이 처리 방식을 따로 승인했다. 기본 해금 목록은
이제 하드코딩(M1911·카타나) 대신 common 무기 전체에서 파생한다
(`MetaProgression.STARTER_WEAPON_IDS`). 수치(피해·쿨타임·사거리 등)는 그대로다.
부수 효과: 던전 상점 판매 기준가 60→35골드(Shop.ts의 등급별 가격).

### 아직 미결

- **P11 각인 리워크 — 2026-10-09 사용자 결정 및 진행.**
  1. 메타데이터 용도: (a) 보상 카드 표시 + (b) 시너지 가중 추첨 — **구현됨**.
     (c) 세트 효과는 보류. (d) 효과 재설계는 하지 않음.
  2. 태그 없던 13종에 계열 부여 — **구현됨**: 장전(신속 장전·속사 전환·예비
     탄창), 치명(급소 간파·처형인), 생존(강인한 육체·철벽, 흡혈 겸임),
     처치(폭심·일도양단·잔재), 기동(경신법), 정지(영점 사격). 역전은 저체력
     보너스라 하이리스크로. 시너지 관계 17종 기입. 현황은
     `docs/STATE_SNAPSHOT.md` "각인 계열" 표가 정본.
  3. 한 종뿐인 계열에 짝 각인 신설 — **구현됨**(아래 초안을 2026-10-09 사용자가 그대로 승인).
  4. 상충: 현행 유지(수치로만 상쇄, 추첨 감점 없음).
  5. 가중 강도: 오케스트레이터 초기값 — 명시적 시너지 ×3, 계열 공유 ×2,
     한 번의 추첨에서 같은 계열이 이미 뽑혔으면 ×1(상한). 핵심 슬롯 특성은
     ×1. 플레이 후 사용자 조정 예정. 검증: `tools/verify_synergy_weights.mjs`.

  **3번 — 짝 각인 7종 (2026-10-09 승인·구현)**. 각 5등급 일반/희귀/영웅/전설/신화.

  | 계열 | 새 각인 | 축 | 효과 | 수치(일반→신화) |
  |---|---|---|---|---|
  | 감전 | 뇌격 | 검 | 감전된 적을 베면 감전을 소모하고 검 피해의 X% 추가 번개 피해 | 40/55/75/100/140% |
  | 과열 | 임계점 | 총 | 과열 스택이 최대일 때 치명타 확률 +X%p (과열 필요) | 6/9/12/16/22 |
  | 연참 | 연격 | 검 | 연참 가속 스택 1개당 검 피해 +X% (연참 가속 필요) | 2/2.5/3/3.5/4% |
  | 정지 | 저격 자세 | 캐릭터 | 이동하지 않는 동안 받는 피해 -X% | 8/11/15/20/28% |
  | 기동 | 질풍 | 캐릭터 | 대시 쿨타임 -X% | 8/12/16/22/28% |
  | 총검연계 | 교차 장전 | 총 | 발도장전(검 적중 후 총알 3발) 보너스 피해 +X%p | 10/15/20/27/36 |
  | 골드 | 전리품 | 캐릭터 | 처치 시 골드 획득 +X% | 10/15/20/28/38% |

  각인 26→33종(총 11/검 10/캐릭터 12). 모두 비고유(일반 등급부터
  상점·노드에 등장). 임계점·연격은 짝 각인 없이는 효과가 없는 의존형이다 —
  시너지 가중으로 짝을 보유했을 때 더 잘 나온다.

### 보류 3건 재개 — 기절 수단·P9 커밋1·세트 보너스 (2026-10-09)

사용자가 세 건 모두 재개를 지시하고 방향을 골랐다(아래 "방향"). 수치는
오케스트레이터 **초안**이며 `design_needed` — 승인 전까지 구현하지 않는다.

**① 일반 적 기절 — 방향: '기절' 계열 각인 2종 신설.**

| 새 각인 | 축 | 효과 | 수치(일반→신화) |
|---|---|---|---|
| 뇌진탕 | 검 | 베기 명중 시 X% 확률로 0.6초 기절 | 8/12/16/22/30% |
| 충격 대시 | 캐릭터 | 대시로 관통한 적 X초 기절 | 0.4/0.5/0.6/0.75/0.9s |

공통 규칙 초안: 엘리트는 기절 시간 절반, 보스 면역(현행 유지), 기절이 끝난
적은 2초간 기절 면역(대시 연타·고확률 베기로 영구 기절되는 것 방지).
계열 '기절'(2종), 충격 대시는 '기동' 겸임. 각인 33→35종(총 11/검 11/캐릭터 13).

**② P9 커밋1 — 방향: 3갈래는 각인 깊이만.** (2026-10-09 승인·구현)

- `recover` 노드 종류 삭제. 깊이 4 상점방에 분수 추가(가격 사다리 그대로:
  첫 사용 무료, 이후 60→96→154G). 런당 분수는 상점방·보스 준비방 2곳 고정.
- 분기 깊이: 각인/상위 전투가 배정된 깊이(2~4곳)만 3갈래(각인계 + 전투 +
  엘리트), 나머지는 2갈래(전투 + 엘리트). 결과적으로 모든 분기 깊이에
  엘리트가 1개씩 있다.
- 일반 전투(`combat`) 노드 처치 골드 ×1.5 초안. 실측(맵 300개, 스테이지 1,
  2026-10-09): 방당 평균 처치 골드 — 전투 295 · 각인 236 · 엘리트 396 ·
  상위 전투 541. 현재 전투는 각인 노드(확정 각인 보상)보다 골드가 25%만
  많아 고를 이유가 약하다. ×1.5면 전투 ≈442로 엘리트보다 골드는 많고 각인
  보상은 없는 "골드 경로"가 된다. 참고: 현재 맵당 회복 노드가 평균 4.3개
  배치돼 있어(빈칸 채우기 후보) 제거 후 그 자리는 전투/엘리트가 된다.

**③ 세트 보너스 — 방향: 계열별 2개 보유 시 고유 효과 1개.**
여러 계열을 가진 각인은 각 계열에 1개씩 센다. 3개 이상이어도 추가 효과 없음.

| 계열 | 2개 보유 효과 초안 |
|---|---|
| 하이리스크 | 하이리스크 페널티(받는 피해 증가·발사 체력 소모·최대 체력 감소) -25% |
| 생존 | 최대 체력 +15 |
| 처치 | 처치 시 체력 1.5 회복 |
| 장전 | 재장전 시간 -10% |
| 치명 | 치명타 확률 +5%p |
| 태세 | 태세 각인끼리의 상충 페널티 절반 |
| 출혈 | 출혈 지속 +25% |
| 과열 | 과열 최대 스택 +2 |
| 감전 | 감전 받는 피해 배율 ×1.3 → ×1.4 |
| 정지 | 이동하지 않는 동안 재장전 속도 +15% |
| 총검연계 | 발도장전 탄수 3 → 4발 |
| 연참 | 연참 가속 최대 스택 +2 |
| 기동 | 대시 직후 1초간 모든 피해 +10% |
| 골드 | 던전 상점·분수·제련소 가격 -10% |
| 기절 | 기절한 적에게 주는 피해 +15% |

표시: 특성창과 보상 카드에 "◇ 계열 세트(2) 활성" 표시, 보상 카드에서
"이걸 고르면 ○○ 세트 완성" 안내.

## Final weapon motion art

- Current non-default weapons use temporary equipment, projectile, and melee
  effect sprites. Their gameplay stats remain unchanged.
- Final per-weapon character motion sheets must use the 112×64, 27-frame grid
  in `ART_GUIDE.md`; detailed handoff is in `docs/systems/weapon-visuals.md`.
