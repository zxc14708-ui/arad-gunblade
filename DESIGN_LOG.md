# Design Log — ARAD: Gunblade

## 2026-07-30 — 1920×1080 화면·아트 기준 통일

- 사용자 승인에 따라 내부 렌더링 기준을 1920×1080(16:9)으로 고정했다.
- 브라우저 크기와 무관하게 동일한 카메라·HUD 좌표를 사용하고, 전체 스테이지만
  비율 유지 확대·축소한다.
- 기존 캐릭터·몬스터 원본 그림은 수정하지 않았다.
- HUD와 메뉴를 새 안전 영역에 재배치하고, `ART_GUIDE.md`에 캐릭터·몬스터·
  오브젝트·이펙트·UI 제작 규격을 기록했다.
- 던전 벽의 단색 검정 표현을 기존 픽셀 타일 표현으로 되돌려 16:9 화면 상·하단이
  빈 검은 영역처럼 보이지 않게 했다.
- `tools/qc.mjs`가 캔버스 해상도와 16:9 축소 배치를 검사하며,
  `tools/measure_sprites.py`가 확정 캐릭터 시트 규격과 발 기준선을 검사한다.

### 2026-07-30 캐릭터 원화 유지 및 발도 방향 보정
- **의도**: 임시 무기 외형 때문에 확정된 기존 캐릭터 원화가 교체되는 회귀를 막고, 발도 검광이 실제 진행 방향과 일치하도록 한다.
- **결과**: 장착 장비와 관계없이 기존 캐릭터 시트를 유지하며 장비는 전투 수치에만 반영한다. 발도 검광은 화면의 상하 진행 방향과 같은 방향으로 회전한다.
- **남은 문제**: 무기별 외형 변화는 최종 캐릭터·무기 파츠 시트가 준비된 뒤 다시 연결한다.

### 2026-07-29 발도·화염 고블린·무기 피드백 개선
- **의도**: Q를 단순 돌진에서 경로를 가르며 통과하는 무적 발도로 바꾸고, 화염 고블린이 한 지점에 겹쳐 서는 문제와 화면 아래 전경 벽에 전투 개체가 가려지는 문제를 함께 해소한다.
- **결과**: 발도는 이동 경로 전체를 검 공격력 기반으로 판정하고 이동 중 무적을 제공한다. 화염 고블린은 적정 거리에서 서로 다른 방향으로 측면 이동하며 화염구의 가시성이 커졌다. 화면 하단의 전경 안전 경계, 붉은 치명타 숫자, 경험치 획득량 특성, 무기별 임시 외형·합성 효과음을 추가했다.
- **준비 장소**: 보스방 직전의 적 없는 준비 장소는 기존 구조를 유지하고, 상점과 회복 우물이 더 명확히 읽히도록 명칭과 입장 배너를 정리했다.
- **임시 아트**: `public/assets/fx/iaido_flash_temp_v2.png`는 임시 발도 검광이며 최종 모션 시트가 들어오면 교체한다. 다른 무기 장착 시 절차 픽셀 캐릭터로 전환하던 시도는 기존 원화와 괴리가 커 2026-07-30에 되돌렸다.

### 2026-07-29 HUD readability and ultimate presentation
- **Target**: `HUD.ts`, `style.css`, `Input.ts`, `Player.ts`, `Game.ts`, temporary effect asset
- **Intent**: Separate overlapping health and active-skill HUD elements, make dash/ammo legible, and let players store their keyboard preferences in the browser.
- **Result**: Active skills sit above the health/XP bars; dash and ammo widgets are 1.5× their previous visual size. The settings panel supports persistent key rebinding with duplicate-key prevention. R now fires the existing six ultimate shots evenly around 360° and ends in two perpendicular sword hits plus a temporary four-frame cross-slash sprite at 2× character height.
- **Asset note**: `public/assets/fx/ultimate_cross_temp_4f.png` is an ImageGen temporary sprite sheet, to be replaced by final art later.

기획 의도와 판단 근거를 남기는 문서. **수치 자체는 여기 적지 않는다** —
`src/config.ts`, `src/systems/Weapons.ts`, `src/systems/Upgrades.ts`가 원본이다.
여기에는 "왜 그렇게 바꿨는가", "무엇을 시도했다가 되돌렸는가", "무엇이 아직 안 풀렸는가"만 기록한다.

## 기록 규칙

- 게임플레이·밸런스·시스템 구조를 바꾸면 **최신 항목을 맨 위에** 추가한다.
- `npm run qc`의 `contact.png`에서 눈으로 발견한 시각적 결함은 타입 체크를 통과했더라도 반드시 남긴다.
- 되돌린 시도를 지우지 않는다. 같은 함정을 두 번 밟는 것을 막는 게 이 문서의 주 목적이다.
- 항목 형식:

```
### YYYY-MM-DD — 제목
- **대상**: 파일 / 시스템
- **의도**: 무엇을 해결하려 했는가
- **결과**: 실제로 어떻게 됐는가
- **되돌림**: 시도했다 폐기한 것 (없으면 생략)
- **남은 문제**: (없으면 생략)
```

---

### 2026-07-29 액티브 스킬 Q/E/R 및 장전 키 전환
- **대상**: `Player.ts`, `Game.ts`, `HUD.ts`, `config.ts`, QC 하네스
- **의도**: 총검사 조작에 능동적인 전투 선택지를 추가한다.
- **결과**: Q는 검격과 전진 돌진, E는 두 발의 동시 사격, R은 탄막 후 광범위 검격·충격파로 구현했다. 탄창 소진 시 자동 장전은 유지하고, 수동 장전 키는 T로 옮겼다.
- **검증**: Q/E/R의 이동·탄약·쿨다운·충격파와 HUD 존재 여부를 QC 시나리오로 추가했다.


## 사용자 승인 구현 방향 · 챕터 1 진행 구조

- 챕터 1은 스테이지 1부터 스테이지 7까지를 순서대로 완료하는 구성이다.
  각 스테이지는 현행처럼 무작위로 연결된 방 지도와 전투 진행을 사용한다.
  현재는 스테이지 1만 구현하며, 스테이지 2~7은 각 컨셉이 확정된 뒤 별도 요청으로
  구현한다.
- 각 스테이지의 보스방 바로 앞에는 보스 준비 대기 장소를 둔다. 대기 장소에는
  기존 회복 분수와 던전 상점을 배치하며, 적은 생성하지 않는다. 보스방은 이
  대기 장소를 거쳐서만 진입할 수 있어야 한다.
- 스테이지 1~6의 보스 처치 뒤에는 다음 스테이지를 시작하고, 스테이지 7의
  보스 처치로 챕터 1을 완료하여 마을로 돌아간다. 스테이지 전환 시 레벨, 특성,
  장비, 런 골드, 현재 체력을 모두 유지하며 회복은 보스 준비 대기 장소의 기존
  분수로 해결한다.
- 영구 보상은 각 스테이지의 보스 처치마다 지급한다. 높은 스테이지에는 추가
  보상을 제공할 예정이나, 보상 구성과 증가 기준은 스테이지 컨셉 확정 시 결정한다.
- 현재 구현 순서: 스테이지 1 보스 준비 대기 장소 → 액티브 스킬 → 적 종류 확장
  → 문서 정리. 스테이지 2~7 전환과 추가 보상은 보류한다.

### 액티브 스킬 결정

- 액티브 스킬은 Q 돌진, E 더블 샷, R 폭렬 난무로 구성한다. 돌진은 검을 쓰는
  전방 공격, 더블 샷은 총을 쓰는 연사, 폭렬 난무는 전방 탄환 난사 뒤 넓은 검격과
  충격파로 마무리하는 총검사 궁극기다. 수치는 구현 시 `config.ts`에 둔다.
- 탄창이 비면 자동 장전한다. 수동 장전은 T로 옮기고 R은 폭렬 난무에 사용한다.
- 적 종류 확장은 신규 일러스트 없이 기존 시트를 재사용한 행동형 변형으로
  시작할 수 있다. 어떤 행동형을 첫 묶음으로 넣을지와 배치 규칙이 필요하다.

## 미해결 이슈

우선순위 순. 해결되면 아래 변경 이력으로 옮기고 여기서 지운다.

### B4. 검이 총을 압도해 "총검사" 컨셉이 붕괴

장전 시간을 포함한 지속 DPS 기준으로 검 계열이 총 계열의 약 2배다.
기본 카타나가 레전더리 오토캐논과 비슷한 수준이고,
검은 부채꼴 광역 + 넉백 + 런지 이동까지 붙는다.
총의 차별점이 사거리 하나뿐이라 실질적으로 "가끔 총 쏘는 검사"가 된다.

부가 문제: 산탄총(레어)이 M1911(커먼)과 지속 DPS 차이가 거의 없다.

수정 방향 후보 — 단순 하향보다 **역할 분리**가 바람직:
- 총에 고유 가치 부여 (원거리 처형 보너스, 총으로만 파괴 가능한 대상 등)
- 검에 리스크 부여 (사용 중 이동 제약, 피격 취약 프레임)
- 총↔검 전환 시너지 강화 (`발도장전` 계열을 기본 메커니즘으로 승격)

### C1. 보스가 슈터와 동일한 AI다

`src/entities/Enemy.ts`의 `update()`는 `def.ranged` 하나로만 분기한다.
보스는 `ranged: true`에 사격 쿨타임만 다를 뿐, **고유 패턴·페이즈·텔레그래프가 없다.**
스테이지의 클라이맥스가 체력 많은 슈터인 상태.

### C2. 적 종류가 3종뿐 (보스 제외)

근접 추격 / 원거리 카이팅 / 느린 탱커. 행동 패턴이 사실상 2가지라
8개 방을 도는 동안 같은 상황이 반복된다.

추가 후보 (행동이 겹치지 않는 것 위주):
자폭형 · 돌진형(텔레그래프 후 직선 돌진) · 소환사 · 방패병(정면 감소) · 분열체

### C4. 액티브 스킬이 없다

플레이어 행동이 이동·총·검·대시 4개뿐. 던파 팬 게임의 정체성과 가장 크게
어긋나는 지점. 쿨타임 기반 액티브 스킬 슬롯(Q/E/R) 도입 검토.

**주의**: 실제 던파 총검사 스킬명을 사용할 경우 공식 자료로 확인할 것.
기억에 의존해 이름을 붙이면 틀릴 가능성이 높다.

### C5. 특성이 대부분 단순 배율

27개 중 조건부·상호작용형은 `폭심`, `발도장전`, `섬광강타` 3개뿐.
나머지는 곱연산이라 빌드가 갈리지 않는다.

- 상태이상 축(화상/빙결/감전/중독) 도입
- 조건부 특성 도입 (체력 낮을 때 강화, 장전 직후 확정 치명타, 대시 직후 강타 등)

### C6. 스테이지가 1개

`RunState.ts`의 `STAGES`에 "검은 숲 지하" 하나만 정의됨.

### C7. 메타 진행의 클라우드 동기화가 없다

영구 성장과 무기 해금은 브라우저 프로필에 저장되지만, 현재는 해당 브라우저·기기에만 유지된다.
기기 간 공유는 로그인 체계와 서버 저장소를 설계한 뒤 별도 작업으로 처리한다.

### C8. 전략적 선택지가 "특성 3택 1"뿐

방 종류는 전투/엘리트/보물/상점/보스.
저주를 감수하고 강해지는 계약 방, 페널티 조건부 도전 방 등
위험-보상 판단 지점이 없다.

### B5. 마을 상점이 실제로는 도달 불가능하다 — 해결

**2026-07-28 3차 실측에서 구조적 결함 2건을 발견했다.** 그중 "분수 사문화"는
같은 날 배치 수정으로 해결했다(아래 변경 이력 "분수 배치 확대" 참조). 나머지
"마을 상점 도달 불가" 하나만 미해결로 남는다:

**마을 상점은 실제로는 도달 불가능하다.** `Game.ts`의 `enterTown()`과
`enterDungeon()`이 둘 다 `this.run.reset()`을 호출하고, `reset()`은
`this.gold = 0`으로 초기화한다. 골드는 오직 `RunState.gold` 하나뿐이고
(`Player.ts`에는 골드 필드 자체가 없다) 마을 진입은 전부 `enterTown()`을
거친다(게임 시작·사망 후 재시작·스테이지 클리어 후 귀환, 3개 경로 전부).
즉 **마을에 도착하는 순간 골드가 0으로 리셋되고, 마을 자체에는 골드를
벌 수단이 없다** — 마을 상인은 코드는 정상 동작하지만(직접 골드를
주입해서 확인함) 실제 플레이에서 골드가 있는 상태로 열릴 일이 없다.
`window.__game`으로 직접 확인: 골드 999 세팅 → `enterDungeon()` 호출 →
0. 골드 777 세팅 → `enterTown()` 호출 → 0. 1·2차 측정이 "상점 2개(마을+
던전) 합산 소비 가능액"으로 502.2~1460.0골드를 계산한 것은 **이 전제가
틀렸다** — 실제로 도달 가능한 상점은 던전 상점 1개뿐이다.

이건 **설계 판단이 필요한 문제라 여기 기록만 하고 직접 고치지 않았다** —
마을 상점의 존재 의의(마을에 골드를 가져올 방법을 새로 만들 것인지, 마을
상점을 없앨 것인지)는 C7(런 간 메타 프로그레션 부재)과 겹치는 결정이라
그쪽 설계와 함께 다룰 예정이다.

**2026-07-28 4차 실측 — 분수 배치 확대 반영, 사용자 예측(580→약 424,
21.9%) 검증.** 3차와 동일한 방식(4000회 몬테카를로, 실제 클래스 그대로
인스턴스화)으로 재측정했다. 결과 요약:

- 평균 총 골드/런 1929.2 (3차 1934.5와 노이즈 범위 안에서 동일 — 이번
  수정은 골드 생성 공식을 안 건드렸으니 예상대로).
- 던전 상점 평균 303.5 / 최악 730 (3차와 동일).
- 분수 흡수: 런당 분수방 평균 2.982개(설정값 3에 근접, 불일치 71/4000=
  1.78%는 전투방 부족 엣지 케이스 — 배치 검증 때와 같은 종류), 3회 모두
  방문 시 무료 1회 + 유료 60 + 유료 96 = **156골드 소진**, 사용자 예측과
  정확히 일치.
- **평균 기준**: 분수(156)를 먼저 충당하고 남은 골드로 제련소 — 제련소는
  여전히 4회(1050골드) 감당 가능, 최종 잉여 **419.7골드(21.76%)** —
  사용자가 예측한 "약 424(21.9%)"와 사실상 일치(오차는 몬테카를로
  샘플링 노이즈 범위). **예측이 맞았다.**
- **최악 기준(전부 레전더리 구매)에서는 예측과 다르게 나온다** — 단순
  뺄셈(154.5−156)과 달리 결과는 오히려 잉여가 **늘었다(154.5→484.2,
  8.0%→25.1%)**. 이유: 제련소 가격 사다리는 4단계 합이 정확히 1050인데,
  최악 기준 상점 구매 후 남는 골드(1204.5)에서 분수 156을 먼저 빼면
  1048.5로 **1050에 1.5골드 모자라** 제련소 사용 횟수가 4회→3회(559골드)로
  뚝 떨어진다 — 분수가 새로 흡수하는 156골드보다 제련소가 못 쓰게 된
  491골드(4번째 사용분)가 더 커서, 두 소비처가 좁은 예산을 두고 부딪히며
  순 흡수력이 오히려 줄어드는 역설이 생긴다. 반대로 제련소를 먼저 최대한
  채우면(4회, 1050골드) 남는 149.2골드로는 분수 유료 2회(156골드)를 다
  못 감당한다 — 최악 기준에서는 "제련소 4회 + 분수 3회"를 동시에
  실현할 예산 자체가 없다(어느 쪽을 우선해도 한쪽이 깎인다).
- **결론**: 평균적인 플레이 기준으로는 사용자의 예측이 정확히 들어맞는다.
  다만 최악 기준(이론상 최대 흡수력 측정용 극단치)은 제련소 가격
  사다리가 굵은 계단식이라 분수 흡수분과 상호작용하며 단순 뺄셈으로는
  예측되지 않는 방향으로 움직인다 — 절대적인 문제는 아니지만(최악
  기준은 애초에 현실적인 플레이가 아님) 두 소비처의 가격을 독립적으로
  조정할 때는 이 계단 효과를 염두에 둬야 한다.

**아래는 분수 사문화 수정 전(2026-07-28 3차 실측 당시)의 실제 도달 가능
경제 측정 기록이다 — 분수 배치 확대로 분수의 흡수력이 0에서 바뀌었으니
정확한 최신 잉여율은 아니지만, 마을 상점 도달 불가 문제의 근거 수치이자
기록 보존을 위해 남겨둔다** (4000회 몬테카를로,
`RunState`/`Enemy`/`Shop`/`EliteAffixes`의 실제 클래스를 그대로 인스턴스화해
측정 — 손으로 수식을 베끼지 않음):

- 방 1개 클리어 평균 골드 — 전투 261.6 / 엘리트 662.2 / 보물 **77.8** / 보스 283.1.
  엘리트·전투·보스는 2차 측정(273.9/672.4/282.7)과 노이즈 범위 안에서 일치
  (엘리트는 `분열` 접두사 자식 유닛 처치 골드를 처음에 빠뜨렸다가 반영 후
  672.4와 거의 일치하도록 보정함 — `Enemy.createSplitChildren()`이 만드는
  자식 2마리도 각자 처치 골드를 준다는 걸 처음 놓쳤다). **보물만 137.0 →
  77.8로 크게 낮다** — `openChest()`가 상자당 60% 확률로 특성(골드 0),
  40% 확률로만 골드(30~69)를 주는 현재 코드를 그대로 반영한 결과다. 이
  60/40 분기는 이번에 바뀐 게 아니라 원래부터 있었다(git log로 확인) —
  1·2차 측정이 상자를 "항상 골드"로 가정했던 것으로 보인다.
- 스테이지 1회 완주 평균 총 골드 **약 1934.5** (보물 상자 정정으로 2064→1934.5,
  약 6.3% 하향 — 코드가 바뀐 게 아니라 이전 측정의 상자 가정이 부정확했던 것).

**실제 도달 가능 소비처** (마을 상점 제외 — 던전 상점 1개 + 던전 제련소 + 던전
분수):
- 던전 상점 1개 가격 합: 평균 가격 기준 **304.4골드**, 최악(4칸 전부 레전더리)
  기준 **730골드** (1·2차가 "상점 2개" 기준으로 낸 502.2/1460.0의 정확히 절반
  — 실제로 도달 가능한 상점이 하나뿐이므로).
- 던전 제련소(가격 100→170→289→491→835→…, ×1.7): 상점 구매 후 남는 골드
  기준으로 평균 1630.1골드·최악 1204.5골드가 남는데, 둘 다 처음 4단계
  (100+170+289+491=1050)까지만 감당하고 5단계(835)는 못 미친다 — **평균·
  최악 두 시나리오 모두 제련소 사용 횟수가 동일하게 4회로 수렴**한다(가격
  사다리가 기하급수적이라 그 이상은 거의 항상 무리).
- 던전 분수: 위 1번 결함으로 **0골드 흡수** (첫 사용은 항상 무료이고
  재사용이 아예 불가능하므로 유료 경로가 실행되지 않는다).

**최종 잉여**:
- 평균 기준: 1934.5 − 304.4(상점) − 1050(제련소 4회) = **580.1골드 잉여
  (30.0%)** — 2차(75.7%)보다 크게 개선.
- 최악 기준: 1934.5 − 730(상점) − 1050(제련소 4회) = **154.5골드 잉여
  (8.0%)** — 2차(29.2%)보다 크게 개선, 사실상 다 쓴 수준.

**결론(측정 당시 기준)**: 던전 제련소(2단계)는 실제로 큰 흡수력을 낸다 —
마을 상점이 애초에 도달 불가능했다는 걸 감안하면, 2단계가 사실상 B5의
핵심 해법 역할을 하고 있었다. 분수 유료화(3단계)는 위에서 기록한 배치
결함으로 흡수력 기여가 0이었으나, 같은 날 배치를 상점방 1개 + 전투방
2개로 늘려 해결했다(아래 변경 이력 참조) — 이제 분수도 런당 최대 3회
(무료 1 + 유료 2)까지 실제로 흡수력을 낸다. **마을 상점 도달 불가만
남아 B5를 해결로 처리하지 않고 미해결로 유지한다** — 위 수치는 그
수정 전 기록이라 최신 잉여율과는 다르다.

### D1. 사용되지 않는 에셋 (재실측 2026-07-28)

2026-07-27 실측 이후 두 가지가 반영 안 돼 있었다 — `tau_chief_charge_6f.png`가
C1(보스 돌진 패턴) 구현으로 `assets.ts` 147행에 등록되어 더 이상 고아가
아니었고, `public/assets` 전체를 `src/` 전체 참조와 다시 대조하니 이전
audit이 놓친 파일 3개(`props/chest_closed.png`·`chest_open.png`·
`healing_fountain.png` — `stage1_interactive_objects/`의 동명 파일로 이미
교체된 구버전 중복)가 추가로 나왔다. 캐릭터가 절차 생성에서 일러스트
시트(`gunblader_*.png` 3장)로 교체되면서 새로 고아가 된 파일은 없다
(`public/` 루트 파일이라 애초에 이 audit 범위인 `public/assets` 밖).

**삭제함**(구버전 교체·미사용 변형 — 요청에 따라 이 두 부류만, 총 26개 39.0KB):
- `public/assets/monsters/*` 구버전 12개 (imp_*, brute_*, shooter_*, stage1_boss_*) —
  `stage1_goblins`/`stage1_tau` 체계로 교체되기 전 잔재
- `public/assets/props/coin_0~3.png`, `torch_0~2.png`(7개) — `coin_strip.png`/
  `torch_strip.png` 프레임 분리 시스템 도입 전 개별 프레임 파일
- `public/assets/props/dungeon_portal.png` — `arcane_portal_v1.png`로 교체된 구버전
- `public/assets/fx/hit_impact_strip.png` — `goblin_hit_impact_4f.png`로 교체됨
- `stage1_forest_foreground/dark_bush_c.png`, `great_tree_c.png`,
  `root_vine_bottom/left/right.png`(5개) — 배경 배치 코드가 a/b 변형과
  `vineTop`만 사용

**남은 고아 파일 3개, 0.53KB** (삭제 범위 밖 — 다음 정리 때 검토):
- `public/assets/props/chest_closed.png`, `chest_open.png`, `healing_fountain.png` —
  `stage1_interactive_objects/`의 동명 파일(치수도 다르고 실제로 사용 중)로
  대체된 것으로 보이나, 이번 지시에 명시된 삭제 목록에 없어 삭제하지 않음.

장식 프롭(`wildflower_*`, `wooden_crate`)은 "교체된 구버전"이 아니라 별도
분류로 옮김 — D3 참고. `tau_chief_charge_6f.png`는 사용 중이라 목록에서 제외.

`tools/measure_sprites.py`에 `public/assets` 전체 vs `src/` 참조 대조를
경고(실패 아님)로 추가했다 — 이제 이 표를 수동으로 다시 만들 필요 없이
`npm run qc` 출력에서 고아 파일 최신 목록을 바로 확인할 수 있다.

### D3. 미연결 장식 프롭 4개, 1.74KB

`stage1_interactive_objects/wildflower_blue.png`, `wildflower_red.png`,
`wildflower_white.png`, `wooden_crate.png` — GPT가 만든 장식 프롭 아트지만
스폰/배치 코드에 연결된 적이 없다. D1과 달리 "교체돼서 되살릴 이유가 없는"
게 아니라 "아직 안 쓴 신규 자산"이라 별도로 분류한다 — 나중에 방 장식으로
쓸 수 있어 삭제하지 않는다.

### D2. 캐릭터 검공격 시트(frame 11~18) 잔여 결함 (1차 재생성 후에도 일부 남음)

`gunblader_base.png`(몸통)와 `gunblader_sword_katana.png`(검) 레이어 합성 시,
검공격 구간(프레임 11~18) 두 곳에 결함이 남아있다:

- **`gunblader_base.png` frame 15·16 프레임 겹침**: 한 프레임(112px 폭) 안에 서로
  떨어진 두 실루엣이 들어있고(frame 16), 인접 frame 15는 팔이 몸통에서 끊겨 보인다.
  `tools/extract_character_sheet.py`가 이전 시트에서 고쳤던 것과 같은 종류의
  프레임 간격 불균일 문제로 추정 — 원본(자르기 전) 일러스트가 있어야 그 도구로
  다시 깨끗하게 잘라낼 수 있다. **몸통 파일은 아직 미수정.**
- **`gunblader_sword_katana.png` frame 12·13·16 칼날 클리핑**: 나노바나나로
  1차 재생성(사용자 요청)한 결과 frame 11/14/17/18은 손 위치에 자연스럽게
  붙었지만, frame 12·13·16은 칼날이 112px 셀 경계에 닿기 전에 잘리면서
  경계에 디더링 노이즈가 남는다(칼끝이 뾰족하게 마무리되지 않고 뭉개짐).
  실제 게임 축소 스케일에서는 크게 두드러지지 않지만 확대하면 보인다.

원래 있던 "칼이 스윙 내내 등에 고정된 것처럼 안 움직이던" 문제(검 레이어가
몸통 동작을 거의 안 따라감)는 이번 재생성으로 해소됐다 — 위 두 항목은 그
잔여 결함이다.

### D4. `gunblader_gun_m1911.png` — 총이 대기/걷기/베기 프레임(0~18)에서 허리 홀스터로 보임

사용자가 "총을 계속 들고 있는 걸로" 요청. 프레임 0~18은 허리에 작게 거치된
총 아이콘이고, 사격 프레임(19~26)만 손에 쥔 큰 아이콘이다(실측: 각 구간
대표 프레임을 잘라 비교, `frame_0`·`frame_11`·`frame_19` 등에서 확인). 코드로는
고칠 수 없다 — 홀스터 포즈 자체가 다른 그림이라 확대/재배치로 "쥔 포즈"를
만들 수 없다. 아래 변경 이력의 "캐릭터 방향/사격 튐 진단" 항목에서 작성한
나노바나나 재생성 프롬프트로 새 `gunblader_gun_m1911.png`를 받아야 한다.
받은 뒤에는 프레임 19~26용 `GUN_SHOOT_FIX` 보정 테이블(`CharacterSprite.ts`)이
새 좌표에 맞게 다시 필요할 가능성이 높다 — D2의 기존 경고와 같은 종류.

---

## 미검증 영역

(현재 없음 — 2026-07-27 실측으로 아래 두 항목 해소, 변경 이력 참조)

---

## 변경 이력

### 2026-07-29 — 영구 성장 제단·모험가 상점 (B5/C7 1단계)
- **대상**: `MetaProgression`, `Game`, `Player`, `HUD`, `config`
- **의도**: 런 골드가 마을 귀환 시 초기화되어 마을 상점에 쓸 수 없던 구조를, 런과 분리된 영구 재화·해금 구조로 교체한다.
- **결과**: 스테이지 완료 보상과 엘리트 증표가 브라우저 프로필에 저장된다. 마을 상점은 무기 설계도 해금 전용, 힘의 제단은 영구 능력 전용으로 분리했고, 포탈 진입 전에 해금한 장비를 선택한다. 부활과 첫 피해 무효화는 런마다 재충전된다.
- **남은 문제**: 저장 범위는 현재 브라우저 로컬이다. 기기 간 동기화는 계정/서버 저장소 설계 후 C7의 후속 단계로 처리한다.

### 2026-07-28 — B5 4차 실측 (분수 배치 확대 반영, 예측치 검증)
- **대상**: `DESIGN_LOG.md`(B5) — 코드 변경 없음, 3차와 동일 방식(4000회
  몬테카를로) 재측정
- **의도**: 사용자가 분수 배치 확대(위 "분수 배치 확대" 커밋) 이후
  잉여 골드가 580.1 → 약 424(21.9%)로 줄 것으로 예측 — 실측으로 검증
  요청.
- **결과**: 평균 기준 419.7골드(21.76%)로 예측과 사실상 일치, **예측이
  맞았다**. 다만 최악 기준(전부 레전더리 구매)은 단순 뺄셈과 다르게
  나왔다 — 제련소 가격 사다리(4단계 합 정확히 1050)와 분수 신규 흡수분
  (156)이 좁은 예산을 두고 부딪혀, 분수를 먼저 충당하면 제련소 4회차
  (491골드)가 통째로 밀려나 순 흡수력이 오히려 줄고 잉여가 154.5→484.2
  (8.0%→25.1%)로 늘어난다. 자세한 수치·근거는 B5 항목 본문 참조.
- **남은 문제**: 없음(측정 완료). B5 자체는 "마을 상점 도달 불가"가
  남아 여전히 미해결.

### 2026-07-28 — 캐릭터 방향/사격 튐 진단 + 발사 간격 튐 수정
- **대상**: `src/entities/Player.ts`(`shootAnim`), `DESIGN_LOG.md`(D4)
- **의도**: 사용자가 "캐릭터가 마우스랑 반대 방향을 보고 있고, 총을 쏠 때
  좌우로 계속 움직인다"고 보고. 두 증상을 각각 사실 확인했다.
- **"마우스 반대 방향" 검증 — 실제로는 버그가 아니었다**: `CharacterSprite.ts`의
  좌우 반전 조건(`Math.sin(aimAngle)`의 부호로 `flip` 결정)을 의심해 먼저
  반전시켜 봤으나, 실제 게임 루프가 백그라운드에서 계속 돌면서 수동으로
  주입한 애니메이션 상태(`animTime`)를 곧바로 덮어써 판정이 오염됐다(과거
  "flip jitter" 조사 때와 같은 종류의 레이스 컨디션). `CharacterSprite`만
  독립적으로 인스턴스화하는 별도 HTML 페이지(Game 루프 완전 배제)로 다시
  검증하니, 원본 코드가 이미 정확했다 — 조준 우측(`sin>0`)일 때 미러링
  없는 원본 프레임이 총을 오른쪽으로 겨눈다. 처음의 오판은 사격 8프레임
  사이 팔이 크게 움직이는 과도기 프레임(`GUN_SHOOT_FIX` 대상 구간)을
  캡처해서 생긴 착시였다. **`CharacterSprite.ts`는 결국 변경하지 않았다**
  (한 차례 반전시켰다가 검증 후 원복).
- **"좌우로 계속 움직임" 검증 — 실재하는 버그, 수정함**: 사격 모션 표시
  시간(`shootAnim`)이 무기 종류와 무관하게 `0.16`초로 고정돼 있었는데,
  `CONFIG`상 총 7종 중 4종(산탄총 0.7 · 저격소총 0.28 · 매그넘 0.5 ·
  석궁 0.4)은 발사 간격(`gunCooldown`)이 이보다 길다. 이 네 무기로 연사하면
  한 발 쏜 뒤 다음 발이 나가기 전에 `shootAnim`이 다 닳아 `st.shooting`이
  꺼지고, `CharacterSprite`의 좌우 반전 고정(사격 중엔 마우스를 안 따라가게
  얼린 것)이 풀린다 — 그 사이 마우스가 반대편으로 넘어가 있으면 다음 발이
  나가는 순간 반전이 다시 걸리며 화면에서 좌우로 튄다(M1911·SMG·오토캐논은
  쿨타임이 0.16보다 짧아 이 틈이 안 생겨서 증상이 없었다). `shootAnim =
  Math.max(0.16, this.stats.gunCooldown)`로 고쳐 연사 중 내내 얼어있게 했다.
  dev 서버로 산탄총(쿨타임 0.7) 장착 후 직접 재현: 발사 직후 마우스를
  반대쪽으로 옮기고 다음 발 전까지 여러 프레임을 진행시켜도 `flip`이
  발사 시점 방향으로 고정된 채 유지됨을 확인(수정 전이라면 쿨타임 중간에
  풀렸을 것). `npx tsc --noEmit` 통과, `npm run qc` 15단계 전부 통과,
  `contact.png` 육안 확인(결함 없음).
- **홀스터 제거 요청**: 코드로 해결 불가 — D4(미해결 이슈)에 원인과 재생성
  프롬프트를 기록했다. 아래 프롬프트로 `gunblader_gun_m1911.png`를
  나노바나나 등으로 재생성해야 한다.

  ```
  Pixel art sprite sheet edit. Input: a 3024x64px horizontal strip of 27
  frames (112x64px each), transparent background, showing ONLY a hand
  gripping an M1911 pistol (no body, no other character parts) — this is
  one layer of a 3-layer character composite (base body + katana + this
  gun layer), all sharing the same 112x64 frame grid.

  Current problem: frames 0-18 (idle/walk/sword-attack range) show a tiny
  holstered gun icon tucked near the waist — looks like the character
  isn't holding the weapon. Frames 19-26 (the dedicated gun-fire range)
  correctly show a large hand gripping the gun in a raised, ready-to-fire
  pose.

  Requested change: replace the holstered pose in frames 0-18 with the
  character actively holding the gun down at their side, ready-but-not-
  aiming — NOT holstered, NOT raised to fire. Keep the same grip scale and
  art style as the existing frames 19-26 pose (same pistol design, same
  pixel-art shading, same nearest-neighbor/no-anti-aliasing look), just
  lowered to a relaxed carry position consistent with the body's
  idle/walk/sword-swing poses in that frame range. The gun's grip point
  must track the same hand position established in `gunblader_base.png`
  for each of frames 0-18 (idle: 0-3, walk: 4-10, sword attack: 11-18) —
  do not change hand position, only replace what's drawn in the hand.

  Frames 19-26 (aiming/firing pose) must stay exactly as they are —
  do not touch them.

  Output: same 3024x64px strip, same 27-frame grid, transparent
  background elsewhere, nearest-neighbor pixel art, no soft edges.
  ```

  받은 뒤 필요한 후속 작업(별도 커밋): 프레임 0~18의 새 그립 좌표를 실측해
  `CharacterSprite.ts`에 프레임별 위치 보정이 필요한지 확인(기존
  `GUN_SHOOT_FIX`와 같은 종류의 보정이 이 구간에도 필요할 수 있음), `npm
  run qc`로 전 프레임 재검증.
- **남은 문제**: D4(홀스터 제거)는 새 아트 수령 후 별도 커밋으로 진행.

### 2026-07-28 — 분수 배치 확대 (B5 "분수 사문화" 해결)
- **대상**: `src/config.ts`(`economy.fountainRoomCount`), `src/systems/RunState.ts`
  (`RoomPlan.hasFountain`, `makePlan`, `assignFountains`), `src/core/Game.ts`
  (`loadRoom`의 분수 배치)
- **의도**: 3차 실측에서 발견한 결함(분수가 상점방에만 배치되는데 상점방은
  런당 1개뿐이라, 방당-1회 제한과 겹쳐 분수 유료화 경로가 같은 런에서
  다시 트리거될 방법이 없었다)을 고친다. 가격 사다리(`fountainFreeUsed`/
  `fountainPrice`)와 방당 1회 제한 로직은 지시대로 손대지 않았다 — 문제는
  배치 하나였다.
- **결과**:
  - `RoomPlan`에 `hasFountain: boolean` 필드 추가. `RunState.makePlan()`이
    상점방은 항상 `hasFountain: true`로 고정하고, 나머지 방 종류는 전부
    `false`로 시작한다.
  - `RunState.generateMap()` 끝에서 `assignFountains(roomCount)`를 호출해
    **확률이 아니라 개수로** 나머지 분수 방을 정한다: 상점방 1개를 포함해
    총 `CONFIG.economy.fountainRoomCount`(3)개가 되도록, 전투(`combat`)
    kind 방 중 2개를 골라 `hasFountain = true`로 표시한다. 그중 최소
    1개는 반드시 depth가 전체 방 수의 절반 이하인 "전반부" 풀에서 뽑아,
    첫 무료 사용이 마지막 방까지 미뤄지지 않게 했다. 전투방이 부족하면
    (예: 무작위 룸 5개가 전부 엘리트/보물로 나온 경우) 있는 만큼만
    배치하고 억지로 채우지 않는다 — 500회 시뮬레이션 기준 약 1.4%
    비율로 발생, 지시대로 우아하게 처리됨을 확인.
  - `Game.loadRoom()`에서 분수 배치를 상점방 전용 블록(`plan.kind ===
    'shop'`, 상인·제련소는 그대로 유지)에서 분리해 `plan.hasFountain`
    조건으로 옮겼다. 상점방은 기존 고정 좌표(6,-1)를 유지하고, 전투방은
    `Room.randomPoint(5)`로 배치(기존 상자 배치와 동일 관례)한다.
    보스·엘리트·보물방에는 배치하지 않는다(지시대로 — 회복이 그 방들의
    난이도 설계를 흔든다). 마을 분수(`enterTown()`, 245행)는 손대지 않아
    계속 무료다.
  - dev 서버 + `window.__game` 직접 조작으로 검증: 500회 반복 중 상점방은
    100% `hasFountain`, 개수 불일치는 전투방 부족 케이스 7건(1.4%)뿐이고
    나머지 493건은 정확히 3개, 전반부 커버리지 100%; 실제 던전 진입 후
    분수 3방을 순회하며 사용 — 1회차 무료(골드 불변·회복), 2회차 가격
    60→60(과금)→96(`60×1.6`), 3회차 96→154(`96×1.6`, 반올림) — 가격
    사다리가 `CONFIG.economy.fountainPriceRatio`대로 정확히 상승함을
    확인; 같은 방 재방문 후 재사용 시도는 골드·체력 모두 불변(막힘)
    확인; 골드 부족 시 유료 경로가 골드·체력 둘 다 바꾸지 않고 막히는
    것도 확인.
  - `npx tsc --noEmit` 통과, `npm run qc` 15단계 전부 통과·`contact.png`
    육안 확인(결함 없음 — 배치 로직 변경이라 시각적 차이는 방마다 분수가
    있고 없고 정도이며 기존 상자·상점 오브젝트 렌더링과 동일하게 표시됨).
- **남은 문제**: B5의 나머지 하나(마을 상점 도달 불가)는 C7(런 간 메타
  프로그레션 부재)과 겹치는 설계 판단이 필요해 미해결로 유지한다.

### 2026-07-28 — 피격 플래시 (타격감 개선 3단계)
- **대상**: `src/config.ts`(`effects` 플래시 상수), `src/entities/EnemySprite.ts`
  (`update` 시그니처·색상 계산), `src/entities/Enemy.ts`(`takeDamage`,
  `hitFlashCrit`), `src/core/Game.ts`(`resolveBullets`/`resolveSlash`가
  `crit`을 `takeDamage`로 전달)
- **사실 확인**: 지시사항은 "피격 플래시가 없다"고 전제했지만, 실제로는
  `EnemySprite.update()`에 색상만 조작하는 흰색 번쩍임이 이미 존재했다
  (`hitFlash>0`이면 `mat.color.setRGB(2.4,2.4,2.4)`, 지속 0.12초, 치명타
  구분·보스 감쇠 없음). 텍스처 교체 금지 요구사항과는 이미 일치하는
  구현이었으므로 새로 만들지 않고 이 기존 메커니즘을 스펙대로 확장했다.
- **결과**:
  - `Enemy.takeDamage(amount, source, crit = false)`에 `crit` 인자를 추가.
    `hitFlash` 지속시간을 보스는 `CONFIG.effects.flashBossDuration`(0.04),
    그 외는 `flashDuration`(0.06)로 설정하고, `hitFlashCrit`에 `crit`을
    저장한다.
  - `EnemySprite.update()`가 `hitFlashCrit`을 추가로 받아, 밝기 배율
    `peak = flashIntensity(2.4) × (보스면 flashBossIntensityMul(0.5), 아니면
    1)`을 계산한다. 치명타면 `(peak, peak, peak×0.3)`으로 파란 채널만
    낮춰 노란색, 아니면 `(peak, peak, peak)`로 흰색 — 스프라이트 텍스처는
    건드리지 않고 `SpriteMaterial.color` 배율만 조작한다.
  - `Game.resolveBullets()`(`b.crit`)와 `resolveSlash()`(`crit` 매개변수)가
    실제 명중 시 `crit` 플래그를 `takeDamage`로 넘기도록 수정.
  - 엘리트 접두사 체력바(`eliteBarFill`/`shieldBarFill`)는 몸체 스프라이트와
    별개의 `THREE.Sprite`·별도 `SpriteMaterial`이라 몸체 색상 배율과
    간섭하지 않음을 코드로 확인(`Enemy.createEliteMarker`).
  - dev 서버 + `window.__game` 직접 조작으로 검증: 일반 명중 → 지속
    0.06·색상 (2.4,2.4,2.4); 치명타 → (2.4,2.4,0.72); 보스 일반 명중 →
    지속 0.04·색상 (1.2,1.2,1.2); 보스 치명타 → (1.2,1.2,0.36); 플래시
    시간 경과 후 (1,1,1)로 복귀; `resolveBullets` 실전 경로에서 치명타
    총알이 `hitFlashCrit=true`를 정확히 전달함을 확인.
  - `npx tsc --noEmit` 통과, `npm run qc` 15단계 전부 통과. `contact.png`
    및 `13-elite-ward-thorns-zoom.png` 확대본 육안 확인 — 엘리트 보호막
    체력바가 몸체 플래시와 겹치거나 색이 섞이지 않음, 결함 없음.
- **남은 문제**: 없음 — 타격감 개선(히트스톱/화면 흔들림/피격 플래시)
  3단계를 모두 마쳤다.

### 2026-07-28 — 화면 흔들림 (타격감 개선 2단계)
- **대상**: `src/config.ts`(`effects` 흔들림 상수), `src/systems/Effects.ts`
  (`shake`, `setShakeEnabled`, `update`), `src/core/Game.ts`(각 피해 판정
  지점), `src/ui/HUD.ts`·`src/style.css`(설정창 토글)
- **의도**: 타격/피격 종류별로 카메라를 짧게 흔들어 임팩트를 강조한다.
  단, 3D 멀미에 민감한 사용자를 위해 설정에서 완전히 끌 수 있어야 한다.
- **결과**:
  - `Effects.shake(intensity, duration = CONFIG.effects.shakeDuration)`가
    누적 강도(`shakeAmp`)를 `Math.min(CONFIG.effects.shakeMax, shakeAmp +
    intensity)`로 합산(상한 0.6)하고, `update()`에서 매 프레임
    `shakeAmp *= exp(-decayRate·dt)`로 지수 감쇠시킨다 — `decayRate`는
    `duration`초 뒤 5%만 남도록 역산해, 시작이 강하고 빠르게 잦아드는 모양이
    된다. `Game.ts`가 이미 이번 프레임 카메라 위치를 정한 뒤(`loop()`의 lerp
    직후) 호출되는 `effects.update()` 안에서 `camera.position.x/z`에
    무작위 오프셋을 더하기만 하므로 카메라 기준 로직 자체는 건드리지 않는다.
  - 트리거·강도: 검 명중 0.08 / 총 명중 0.03 / 치명타 0.15(무기 종류 무관,
    명중 강도 대신 적용) / 처치 0.12 / 플레이어 피격(일반) 0.35 / 보스 슬램
    0.4 / 보스 돌진 충돌 0.3(`e.isBossCharging`일 때만 — 나머지 접촉 피해는
    일반 피격 0.35). `resolveBullets`·`resolveSlash`·`killEnemy`·
    `resolveEnemyBullets`·`resolveEnemyAction`(보스 슬램 액션)·적 접촉
    판정·가시 반사·변덕(volatile) 처치 폭발까지, 플레이어가 피해를 받거나
    입히는 모든 지점에 대응하는 흔들림을 걸었다.
  - 설정창에 "🎬 화면 효과 → 화면 흔들림" 체크박스를 추가했다. 끄면
    `shakeAmp`를 즉시 0으로 비우고 이후 `shake()` 호출을 전부 무시한다.
    `localStorage`(`arad_settings`)에 저장해 새로고침 후에도 유지된다
    (기존 `AudioManager`의 음량 저장 패턴을 그대로 따름).
  - 구현 중 발견한 잠재 버그를 미리 막음: 설정창이 열려 게임이 일시정지되면
    `effects.update(0, ...)`처럼 `dt=0`으로 호출되는데, 이때도 감쇠 없이
    매 프레임 새 무작위 오프셋만 계속 더해지면 정지 화면이 끝없이
    떨리게 된다. `shake()` 적용 블록에 `dt > 0` 조건을 추가해 방지했다.
  - dev 서버 + `window.__game` 직접 조작으로 검증: 강도 합산(0.08+0.15=0.23)과
    상한(1.0 요청 시 0.6로 캡) 확인; `shakeDecayRate`를 duration=0.3 기준으로
    설정 후 30프레임(≈0.48s) 경과시키자 0.3 → 0.0025로 감쇠(단조 감소) 확인;
    토글 off 시 기존 amp 즉시 0 및 이후 `shake()` 무시, on 재전환 후 정상
    동작 확인; `localStorage` 저장값이 토글 상태와 일치함을 확인; `dt=0`으로
    `update()` 호출 시 `shakeAmp`가 변하지 않음(끝없는 떨림 없음) 확인;
    `resolveBullets` 실전 경로로 일반 총 명중 0.03·치명타 총 명중 0.15가
    정확히 적용됨을 확인.
  - `npx tsc --noEmit` 통과, `npm run qc` 15단계 전부 통과·`contact.png`와
    `07-settings.png` 확대본 육안 확인 — 새 토글 행이 설정 패널 안에 정상
    배치되고 잘림 없음, 결함 없음.
- **남은 문제**: 피격 플래시(3단계)가 이어진다.

### 2026-07-28 — 히트스톱 (타격감 개선 1단계)
- **대상**: `src/config.ts`(`effects` 상수), `src/core/Game.ts`(`triggerHitstop`,
  `loop`, `resolveBullets`, `resolveSlash`, `killEnemy`)
- **의도**: 타격 순간 게임 시간을 아주 짧게 늦춰 충격을 강조한다. B4 밸런스
  작업과 무관한 순수 연출 작업 — 전투 수치는 건드리지 않았다.
- **결과**:
  - `Game.loop()`에서 매 프레임 실제 경과 시간(`rawDt`)으로 `hitstopTimer`를
    감소시키고, 타이머가 남아있는 동안에는 `step()`과 `effects.update()`에
    `rawDt × CONFIG.effects.hitstopScale`(0.05배)를 넘긴다 — 완전히 0으로
    멈추면 애니메이션이 얼어붙어 버그처럼 보이므로 아주 느리게만 흐르게 했다.
    `Input.update()`는 이 스케일링 이전에 매 프레임 그대로 호출되므로 입력은
    히트스톱 중에도 씹히지 않는다.
  - `triggerHitstop(duration)`은 겹치는 요청을 더하지 않고 `Math.max`로
    갱신한다 — 다수 적을 동시에 맞혀도 정지 시간이 길게 누적되어 조작이
    끊기지 않는다.
  - 지속시간은 피해량 성격에 비례: 일반 명중 0.04초(`resolveBullets`/
    `resolveSlash`), 치명타 0.07초, 처치 0.10초(`killEnemy`), 보스 처치
    0.35초(`killEnemy`에서 `e.kind === 'boss'` 분기). 상수는 `CONFIG.effects`에
    모았다.
  - dev 서버 + `window.__game` 직접 조작으로 검증: `triggerHitstop`이 더 짧은
    요청은 무시하고(`0.04`→`0.02` 요청 시 `0.04` 유지) 더 긴 요청만 반영
    (`0.1`로 갱신)함을 확인; `resolveBullets`를 통한 실전 경로로 일반 명중
    0.04·치명타 0.07을, `killEnemy`로 일반 처치 0.10·보스 처치 0.35를 각각
    정확히 확인; `hitstopTimer`가 남아있는 상태에서 `player.update()`에
    `rawDt×hitstopScale`을 넣으면 이동 거리가 이론적 상한(`speed×scaledDt`)
    이내로 억제됨(완전히 0은 아님)을 확인.
  - `npx tsc --noEmit` 통과, `npm run qc` 15단계 전부 통과·`contact.png`
    육안 확인(결함 없음 — 히트스톱은 타이밍 연출이라 정지 프레임 스크린샷
    자체에는 차이가 나타나지 않는다).
- **남은 문제**: 화면 흔들림(2단계), 피격 플래시(3단계)가 이어진다.

### 2026-07-28 — 발도장전 기본 승격 (B4 3단계, B4 해결)
- **대상**: `src/entities/Player.ts`(`Mods`, `reloadFromSwordHit`, 사격 루프),
  `src/core/Game.ts`(`resolveSlash`), `src/systems/Upgrades.ts`(`lg_quickdraw`)
- **의도**: "검 적중 시 총알 1발 장전"을 특성이 아니라 모두가 갖는 기본
  메커니즘으로 승격해 검→총 전환을 강제 시너지로 만든다. 기존 `발도장전`
  특성은 이 기본 기능과 중복되므로 강화형으로 교체한다.
- **결과**:
  - `Player.reloadFromSwordHit()` 신설 — 탄창이 이미 가득 차면 아무 일도
    하지 않고, 그렇지 않으면 `mods.swordReloadAmount`(기본 1)만큼 ammo를
    더한다. 장전이 이미 진행 중이어도 `reloading`/`reloadTimer`를 건드리지
    않고(즉시 완료시키지 않고) 그 위에 그냥 더한다 — 기존 장전 타이머는
    그대로 흐른다.
  - `Game.resolveSlash()`에 `hitAny` 플래그를 추가해 스윙 한 번에 여러 적을
    맞혀도 `reloadFromSwordHit()`은 스윙당 정확히 1회만 호출한다. 완전
    미스면 호출 자체가 없다.
  - 발도 시 즉시 전탄 장전하는 기존 `swordReloads`(스윙 시작 시 트리거,
    `총검일체` 레전더리 전용)는 손대지 않았다 — 새 메커니즘은 스윙
    적중(hit) 시점, 기존 것은 스윙 시작 시점으로 트리거 조건이 다르고
    둘은 별개 특성이다.
  - `발도장전`(`lg_quickdraw`) 재정의: 기존 "발도 시 총 즉시 장전 · 검뎀
    +20%"를 폐기하고, `mods.swordReloadAmount = 2`(장전량 1→2발),
    `mods.swordReloadBurstBonus = 0.3`(검으로 장전한 직후 발사하는 3발
    피해 +30%, `swordReloadBurstShotsLeft` 카운터로 사격 루프에서 소모)로
    교체. 이름/등급은 유지.
  - dev 서버 + `window.__game` 직접 조작으로 검증: 기본 장전 3→4(+1);
    탄창 가득(7/7)이면 무변화; 장전 진행 중(reloading=true, reloadTimer=
    0.5) 적중 시 ammo만 +1 되고 `reloading`/`reloadTimer` 불변; `resolveSlash`
    로 적 2체 동시 적중시켜도 ammo +1 딱 한 번만(4); 완전 미스 시 무변화;
    `lg_quickdraw` 적용 후 적중 시 3→5(+2); 이후 발사 4발 중 처음 3발은
    `15×1.3=19.5`, 4번째 발은 다시 기본 `15`로 정확히 복귀 — 스펙과 전부
    일치.
  - `npx tsc --noEmit` 통과, `npm run qc` 15단계 전부 통과·`contact.png`
    육안 확인(결함 없음, 이번 변경은 수치/로직이라 시각 차이 없음).
- **남은 문제**: 없음 — B4(검이 총을 압도하는 문제)는 1~3단계(수치 조정,
  거리 보너스/스윙 커밋, 발도장전 기본화)로 해결 처리한다.

### 2026-07-28 — 총 거리 보너스 + 검 스윙 커밋 (B4 2단계)
- **대상**: `src/config.ts`(`combat` 상수), `src/systems/Projectiles.ts`,
  `src/core/Game.ts`(`resolveBullets`), `src/systems/Effects.ts`
  (`damageNumber`), `src/style.css`(`.floater.range`), `src/entities/Player.ts`
  (스윙 커밋)
- **의도**: B4 1단계(수치 조정)만으로는 역할 분리가 안 된다 — 총에 사거리 외
  고유 가치를, 검에 리스크를 부여해 "멀면 총, 붙으면 검"을 실체화한다.
- **결과**:
  - **총 거리 보너스**: 총알에 발사 시점 위치(`spawnPos`, 불변)를 기록해두고,
    명중 시 `spawnPos`↔명중 지점(`pos`, 현재 위치) 거리로 판정한다 — 적/플레이어
    둘 다 움직이므로 현재 위치끼리 비교하면 틀린다. 거리 ≥ `CONFIG.combat.
    gunRangeBonusDist`(8, 검 최대 사거리 4.8과 겹치지 않도록 고정)면 피해
    ×`gunRangeBonusMult`(1.35). 관통/산탄은 `resolveBullets`가 이미 개별
    총알(bullet 객체)로 명중을 순회하므로 각 명중마다 독립적으로 판정된다.
    보너스가 붙은 명중은 데미지 넘버에 `.floater.range` 클래스(하늘색,
    `#6ad0ff`)를 추가로 표시해 크리티컬과 시각적으로 구분한다.
    dev 서버 + `window.__game` 직접 조작으로 검증: 거리 3 명중 → 기본 피해
    (100, `floater`만), 거리 10 명중 → 135(`100×1.35`, `floater range`) —
    정확히 일치.
  - **검 스윙 커밋**: 스윙 시작 시 `swingCommitTimer = min(검 cooldown,
    CONFIG.combat.swordSwingCommitMax(0.25))`를 설정하고, 타이머가 0보다 큰
    동안 이동 입력(`moving = false`)·방향 전환(`angle` 갱신 건너뜀)·대시 트리거를
    모두 막는다. 런지(스윙 시작 시 부여된 전방 속도)는 이 게이트 밖이라 그대로
    적용된다. 카타나(cooldown 0.42)로 검증: `swingCommitTimer` 정확히
    0.25(상한 적용)로 설정, 이후 이동/재조준/대시 시도 모두 무효(`pos`
    불변, `angle` 불변, `isDashing: false`); 대거(cooldown 0.18 < 상한)는
    상한 미적용 0.18 그대로 설정됨을 확인. 타이머 만료 후에는 이동이 정상
    재개됨(`movedAfterCommitExpired: true`)도 확인.
  - **UI 여부 확인**: "스윙 커밋 중임을 플레이어가 알 수 있어야 한다"는 요구에
    대해, 기존 공격 프레임 표시 창(`swingAnim = 0.3`)이 스윙 커밋 지속시간
    (최대 0.25)보다 항상 길어 커밋이 풀리기 전까지 캐릭터가 계속 공격 스프라이트
    프레임으로 보인다 — 별도 UI 없이 기존 스프라이트 애니메이션만으로 충분하다고
    판단, 추가 UI를 만들지 않았다.
  - `npx tsc --noEmit` 통과, `npm run qc` 15단계 전부 통과(`contact.png`
    육안 확인 — 이번 변경은 수치/입력 게이팅이라 시각적 차이 없음, 결함 없음).
- **남은 문제**: 발도장전 기본 승격(B4 3단계)이 남아있다 — 이어서 반영한다.

### 2026-07-28 — 검/총 데미지 격차 축소 (B4 1단계)
- **대상**: `src/systems/Weapons.ts`(damage만)
- **의도**: 클로드(기획) 지시사항 검증 후 반영. 단순 동률화가 아니라 역할
  분리(멀면 총, 붙으면 검)를 위한 사전 작업 — 검 damage ×0.8, 총 damage
  ×1.25(반올림), cooldown/range/arc/knockback/lunge/magSize/reloadTime은
  그대로 뒀다.
- **결과**: 장전시간 포함 지속 DPS(총 = magSize×damage÷(magSize×cooldown+
  reloadTime), 검 = damage÷cooldown)를 재계산:

  | 무기 | 이전 DPS | 이후 DPS | | 무기 | 이전 DPS | 이후 DPS |
  |---|---|---|---|---|---|---|
  | m1911 | 38.2 | 47.7 | | katana | 81.0 | 64.3 |
  | smg | 50.0 | 66.7 | | daggers | 83.3 | 66.7 |
  | shotgun | 39.6 | 50.9 | | rapier | 117.6 | 94.1 |
  | rifle | 45.5 | 56.8 | | greatsword | 92.3 | 74.4 |
  | magnum | 46.4 | 58.6 | | warhammer | 96.0 | 77.0 |
  | crossbow | 37.4 | 47.7 | | glaive | 88.0 | 70.0 |
  | autocannon | 83.0 | 105.7 | | moonblade | 145.0 | 115.0 |

  총 DPS 범위 38~83 → 48~106, 검 DPS 범위 81~145 → 64~115. 7종 평균으로 보면
  검/총 비율이 약 2.0배 → 약 1.29배로 줄었다 — 완전 동률은 아니고 근접
  리스크 보상으로 검이 더 높게 남는 게 의도된 결과(지시사항 그대로).
  `npm run qc` 15단계 통과(수치만 바뀐 변경이라 시각적 영향 없음).
- **남은 문제**: 이 수치 조정만으로는 역할 분리가 완성되지 않는다 —
  B4 2·3·4단계(총 거리 보너스, 검 스윙 커밋, 발도장전 기본 승격)가 이어진다.

### 2026-07-28 — 분수 유료화 (B5 3단계)
- **대상**: `src/core/Game.ts`(`useFountain`/`fountainLabel`) ·
  `src/systems/RunState.ts`(`fountainFreeUsed`/`fountainPrice`) ·
  `src/config.ts`(`economy.fountainBasePrice`/`fountainPriceRatio`)
- **의도**: 클로드(기획) 지시사항 검증 후 반영. 던전 분수를 런 전체 첫 사용만
  무료로 두고 이후 유료화해 잉여 골드를 추가로 흡수한다.
- **결과**: 런 전체에서 첫 사용은 무료(마을 분수 포함 여부와 무관 — 마을 분수는
  `mode==='town'`이면 늘 무료, `fountainFreeUsed` 자체를 건드리지 않는다).
  던전에서 두 번째 사용부터 유료, 60 → 96 → 154 → 246 → 394(1.6배, 제련소와
  동일하게 직전 가격에서 반올림 누적). 방당 1회 제한은 기존
  `run.isObjectUsed('fountain')` 그대로 유지 — 새 로직은 "이 런에서 총 몇 번
  썼는지"만 추가로 본다. 골드가 부족하면 회복도 안 하고 사용 횟수·가격도 그대로
  둔 채 안내만 한다(스펙 그대로 — `spendGold` 실패 시 즉시 반환). HUD 라벨에
  현재 상태를 표시("무료" 또는 "N G"). Playwright로 `window.__game`을 직접
  조작해 검증: 마을에서 골드 0이어도 회복됨, 던전 진입 후 첫 사용은 무료(골드
  불변)에 `fountainFreeUsed`가 true로 전환, 같은 방에서 재사용 시도는
  `isObjectUsed`에 막혀 회복 안 됨, 방을 이동한 것처럼 room id를 바꿔가며
  두·세 번째 사용을 재현하니 60→96, 96→154로 정확히 청구·인상됨을 확인.
  `npm run qc` 15단계 통과.
- **남은 문제**: 없음. B5는 이제 1·2·3단계 전부 구현 완료 — 3차 재측정(잉여
  골드 재시뮬레이션)이 남았다.

### 2026-07-28 — 던전 제련소 추가 (B5 2단계)
- **대상**: `src/core/Game.ts`(`useDungeonForge`/`dungeonForgeLabel`) ·
  `src/entities/Interactable.ts`(`dungeonForge` kind) ·
  `src/systems/Upgrades.ts`(`forgeSwapCandidates`/`upgradeById`) ·
  `src/systems/RunState.ts`(`dungeonForgePrice`) · `src/config.ts`(`economy`)
- **의도**: 클로드(기획) 지시사항 검증 후 반영. 마을 제련소는 마을에만 있고
  던전→마을 복귀 경로가 없어(mode='town'은 런 초기화에서만 설정) 유료화가
  불가능 — 대신 던전 상점방(`plan.kind === 'shop'`)에 상인·분수와 같은
  방식으로 새 제련소를 배치했다.
- **결과**: 유료·반복 사용 가능. 가격 100 → 170 → 289 → 491 → 835(1.7배,
  반올림은 매 단계 누적 — `round(base*ratio^n)`이 아니라 `round(직전가격*ratio)`
  여야 이 수열이 나온다, 검증 시 실제로 발견). 가격과 사용 횟수는
  `RunState`에 저장돼 런 단위로 유지되고 방을 나갔다 들어와도 안 바뀐다.
  기능은 "보유 특성 1개를 같은 등급의 다른 특성으로 교체" — 다만 특성의
  `apply()`가 스탯을 누적 연산만 하고 되돌리는 함수가 없는 구조라, 진짜
  "교체"(A의 효과를 지우고 B를 부여)는 이번 범위 밖의 아키텍처 변경이
  필요하다. 그래서 "교체"를 스택 장부 이동으로 구현했다 — A의 스택을 1
  내리고(효과는 유지, 파워가 줄지 않음) B의 스택을 1 올려 적용한다. 이미
  마을/던전 제련소가 "스택을 더 쌓는" 방식이라 같은 성질을 유지한 것이다.
  교체 대상은 `forgeSwapCandidates()`로 같은 등급·자기 자신 제외·maxStacks
  미달만 추리고, 이미 보유 중인 다른 특성도 후보에 포함되므로 그 특성의
  스택이 더 쌓일 수 있다(정상 동작). 골드 부족 시 선택 UI 자체를 열지 않고
  안내만 한다. HUD 프롬프트 라벨에 현재 가격을 표시하고 사용할 때마다
  갱신한다. Playwright로 `window.__game` 내부를 직접 조작해 검증: 초기가
  100, 2회 반복 사용 시 170→289, 골드 부족 시 아무것도 안 바뀜(골드·가격
  불변, UI도 안 열림), 스택 장부(A -1 / B +1)와 `acquired` 맵 정리(카운트
  0이면 제거)까지 전부 확인. `npm run qc` 15단계 통과.
- **남은 문제**: B5 3차 재측정 필요(분수 유료화까지 합쳐서 측정 예정).

### 2026-07-28 — D1 미사용 에셋 재실측·정리 + 고아 파일 자동 경고 추가
- **대상**: `public/assets/*`(26개 파일 삭제) · `tools/measure_sprites.py`
  (`check_orphan_assets` 추가) · `DESIGN_LOG.md`
- **의도**: 클로드(기획) 지시사항 검증 후 반영. D1이 2026-07-27 기준이라
  이후 변경(C1의 `tau_chief_charge_6f.png` 사용 시작 등)이 반영 안 돼 있었고,
  자동 검사가 `assets.ts` 참조 경로만 봐서 고아 파일을 영구히 못 잡는 구조였다.
- **결과**: `public/assets` 전체 파일을 `src/**/*.ts` 전체 텍스트와 대조해
  재실측 — `tau_chief_charge_6f.png`는 제외, 이전 audit이 놓친 `props/`
  중복 파일 3개(`chest_closed.png`·`chest_open.png`·`healing_fountain.png`)를
  새로 발견. 지시된 두 부류(구버전 교체 21개 + 미사용 변형 5개, 총 26개
  39.0KB)만 삭제하고, 장식 프롭(`wildflower_*`·`wooden_crate`)은 "교체된
  구버전"이 아니라 "미연결 신규 자산"이라 D1에서 D3로 분리 기록, 새로
  찾은 3개는 이번 삭제 범위 밖이라 D1에 남겨뒀다. `measure_sprites.py`에
  `public/assets` 전체 vs `src/` 참조를 경고(실패 아님)로 대조하는 검사를
  추가해 이제 고아 파일이 생겨도 `npm run qc` 실행 때마다 자동으로 드러난다
  (의도적으로 보관 중인 파일이 있어 실패로 처리하지 않음). 삭제 후
  `npm run qc` 15단계 통과, 자산 무결성 검사도 통과(경고 7건 — D1·D3에
  남긴 파일들과 정확히 일치).
- **남은 문제**: 없음. `props/chest_*`·`healing_fountain.png` 3개는 다음
  정리 때 삭제 여부 판단 필요(D1 참고).

### 2026-07-28 — 사격 중 캐릭터 좌우 반전(flip) 튐 수정
- **대상**: `src/entities/CharacterSprite.ts` (`update()`의 좌우 반전 로직)
- **의도**: 사용자가 "총 쏠 때 캐릭터가 좌우로 움직인다"고 제보, 사격 방향으로 몸이
  고정되길 요청.
- **결과**: 좌우 반전은 `Math.sin(aimAngle)`이 ±0.05 데드존을 넘을 때마다 매 프레임
  재평가된다. 조준선이 캐릭터 정면축(각도 0 또는 π, 즉 화면상 캐릭터 바로 위/아래를
  겨눌 때) 가까이 있으면 `sin(aimAngle)`이 0 근처라 미세한 조준 흔들림만으로도 그
  데드존 경계를 프레임마다 넘나들어 스프라이트가 좌우로 반전을 반복 — 실제 위치는
  안 움직이는데(사격은 `player.pos`를 바꾸지 않음, 코드로 확인) 좌우로 튀어 보였다.
  `st.shooting`이 true인 동안(발사 모션 0.16초 구간)은 반전 재평가를 건너뛰고 직전
  방향을 유지하도록 수정 — 발사 순간의 방향에 몸이 고정된다. `CharacterSprite`를
  독립적으로 로드해 `update()`를 직접 호출하는 방식으로 검증: 조준각을 데드존을
  넘나들게 오실레이션시키면서 `shooting:true`일 때는 20프레임 내내 반전 없음(`++++...`),
  `shooting:false`일 때는 정상적으로 매 프레임 반전(`+-+-...`) 확인 — 사격 중 튐만
  없어지고 평상시 조준 반전 반응성은 그대로다. `npm run qc` 15단계 통과.
- **남은 문제**: 없음.

### 2026-07-28 — 총알/총구 화염 스폰 높이를 보정된 총구 위치에 맞춤
- **대상**: `src/entities/Player.ts` (총알 스폰), `src/systems/Effects.ts` (`muzzleFlash`)
- **의도**: 바로 위 항목(발사 프레임 손-총 스케일/정렬 보정)으로 총구가 화면상
  더 높이(어깨~눈높이 근처)로 옮겨갔는데, 총알·총구 화염 스폰 위치는 옛 총구
  좌표(허리 높이)에 그대로 고정돼 있어 사용자가 "총알 나가는 부분이랑 총구
  부분이 차이난다"고 지적.
- **결과**: 보정된 발사 프레임(19~26)의 실제 총구 픽셀 좌표를 다시 측정해
  월드 단위로 환산(`(64-py) * baseH/64`) — 프레임별 총구 높이 실측 평균이
  전방 거리 ~1.3, 높이 ~2.6(캐릭터 전체 높이 3.7 기준) 수준이었다. 총알 스폰
  높이를 1.2→2.6, 전방 거리를 0.8→0.9로, 총구 화염 높이를 1.75→2.6으로
  올렸다(전방 거리는 원래도 1.35로 비슷해 유지). 총알은 `dir.y=0`으로
  수평 이동만 하므로 스폰 높이가 곧 비행 내내 유지되는 높이다.
  `npm run qc` 15단계 통과, `03-shoot` 스크린샷에서 화염·총알이 총구
  높이에 맞게 뜨는 것 확인.
- **남은 문제**: 총구 위치가 프레임마다 조금씩 다른데(사격 애니메이션이라 팔이
  움직임) 스폰 위치는 고정 상수 하나로 근사한 것 — 프레임 평균값이라 실제로는
  발사 애니메이션 중 어느 순간이냐에 따라 1px 안팎 오차가 있을 수 있다.

### 2026-07-28 — 아트 시트 발사 프레임(19~26) 손-총 스케일/정렬 보정
- **대상**: `src/entities/CharacterSprite.ts` (`GUN_SHOOT_FIX`/`drawFixedGunCell` 추가)
- **의도**: 사용자가 실기기 스크린샷으로 발사 자세에서 손+총 크기가 몸과 안 맞고
  위치도 따로 논다고 지적. 실측 확인 요청.
- **결과**: `gunblader_gun_m1911.png`의 발사 프레임(19~26) 손+총 실루엣 높이가 25px로
  전신 높이(61px)의 41% — 대기/거치 프레임(19px, 31%)보다도 크고, 정상적인 손 비율
  (15% 안팎)의 약 2.5배였다. 그립 중심 좌표(대략 (60,39) 고정)와 `gunblader_base.png`의
  실제 팔/손 도달 위치를 프레임별로 각각 측정해보니 그립-손 간 어긋남이 프레임에 따라
  최대 22px까지 벌어져 있었다(조준 동작이라 팔이 넓게 움직이는데 총 그림은 프레임마다
  같은 좌표에 고정 배치된 것으로 보임). 프레임 0~18(거치 자세)은 이 문제가 없어(변화
  없는 고정 실루엣) 그대로 두고, 19~26만 캔버스 합성 시점에 그립 기준점을 0.55배
  축소한 뒤 프레임별 실측 델타(dx,dy)로 손 위치까지 이동시켜 다시 그린다
  (`GUN_SHOOT_FIX` 테이블, 임시 캔버스에 그려 조합). `npm run qc` 15단계 통과,
  발사 8프레임 전부 합성 전/후 비교 이미지로 확인 — 손 크기가 자연스러워지고
  프레임 간 위치 점프가 사라짐.
- **남은 문제**: 이건 원본 아트의 좌표 오류를 코드에서 보정한 것이지 원본을 고친 게
  아니다 — `gunblader_gun_m1911.png`을 다시 받으면(예: 나노바나나 재생성) 이 보정
  테이블도 같이 재조정하거나 제거해야 한다.

### 2026-07-28 — 절차 생성 폴백 시트: 총 렌더링을 손 앵커 기반으로 재작성
- **대상**: `src/entities/CharacterSprite.ts` (`drawFrame`/`drawGun`/`drawGunSmall` →
  `HandAnchor`/`drawGun` 통합), `DESIGN_LOG.md`
- **의도**: 클로드(기획)가 작성한 지시사항 검증 후 반영. 절차 생성 폴백 시트(아트 시트
  로드 전/실패 시 노출)에서 총 렌더링에 4가지 문제가 있었다 — (1) 발사 자세에서 저격소총/
  산탄총/오토캐논의 총구 화염이 프레임(FW=48) 밖으로 잘림, (2) 대기·걷기는
  `drawGunSmall`(범용 실루엣), 발사는 `drawGun`(무기별 상세 그림)으로 서로 다른 그림을 써서
  모드 전환 시 총이 다른 모양으로 순간 바뀜 + 몸 반대편으로 위치가 튐, (3) 석궁 활대(세로
  10px)가 팔 두께(3px)를 관통, (4) 총 길이가 상체 폭 대비 과함.
- **결과**: 무기별 그립(로컬 원점)~총구(+x) 좌표로 그리는 `drawGun` 하나로 통일하고,
  모드별 `HandAnchor{x,y,angle}`(idle/walk: 아래로 내린 손, angle=90° · shoot: 앞으로
  뻗은 손, angle=0° · slash: 뒤로 젖힌 손, angle=90°)로 위치·회전만 바꿔 재사용한다.
  `drawGunSmall` 삭제. 발사 자세는 총구+화염 reach(`GUN_LEN[id] + 5`)를 프레임 폭에서
  역산해 초과분만큼 앵커 x를 왼쪽으로 자동 보정(하드코딩 없음) — shoot1/shoot2 둘 다
  화염 유무와 무관하게 항상 최대 reach 기준으로 계산해 두 프레임 사이에 총이 흔들리지
  않게 했다. 총 길이는 지시사항대로 축소(rifle 14→11, shotgun 12→10, autocannon 10→9,
  magnum 9→8, smg 8→7, crossbow 8→7, m1911 6 유지). 석궁 활대는 세로 10→6px로 줄이고,
  모든 무기에서 총을 팔보다 먼저 그려(팔·장갑이 그립 부분을 덮음) 활대-팔 겹침 문제를
  z-order로 해결. 지시사항 검증 중 발견한 추가 사항: `slash` 모드는 원래 총이 아예
  안 그려졌는데(양손이 검에 쏠린 자세), 지시사항의 앵커 표에 slash 항목이 있어 이번에
  같이 채웠다. 7개 총(m1911/smg/shotgun/rifle/magnum/crossbow/autocannon) 전부
  idle/walk×4/windup/slash/shoot1/shoot2 9프레임을 Playwright로 렌더링해 개별 확인 —
  전 무기에서 프레임 밖으로 안 나가고, 무기별 실루엣이 자세 전환에도 유지됨.
  `npm run qc` 15단계 통과(아트 시트 사용 경로는 이 변경과 무관해 영향 없음).
- **되돌림**: 지시사항은 `HandAnchor`에 `facing: 1 | -1` 필드를 요구했으나, "아래 향함"과
  "앞 향함"처럼 각도 자체가 달라지는 요구를 boolean 하나로는 표현할 수 없어 `angle:
  number`(라디안)로 대체했다 — 캔버스 `rotate()`로 같은 로컬 좌표 그림을 재사용한다는
  핵심 의도는 그대로 satisfy한다.
- **남은 문제**: 없음.

### 2026-07-27 — 캐릭터 아트 base+무기 레이어 교체, FX 시트 갱신
- **대상**: `src/entities/CharacterSprite.ts` · `src/rendering/assets.ts` ·
  `src/systems/Effects.ts` · `AGENTS.md` · `public/gunblader_base.png`(신규) ·
  `public/gunblader_sword_katana.png`(신규) · `public/gunblader_gun_m1911.png`(신규) ·
  `public/gunblader.png`(삭제) · `public/assets/fx/slash_strip.png`(교체) ·
  `public/assets/fx/muzzle_flash_strip.png`(교체) ·
  `public/assets/fx/slash_wind_strip.png`(신규)
- **의도**: 사용자가 새 캐릭터 일러스트(112x64×27프레임 그리드를 공유하는 base/katana/M1911
  3장 레이어 + 전용 FX 3종)를 전달하며 캐릭터 코드를 다시 짜서 적용해 달라고 직접 지시.
- **결과**: 기존에는 무기가 이미 그려진 단일 시트(`gunblader.png`) 하나를 그대로 로드했다.
  새 아트는 몸(무기 없음) + 검 오버레이(투명 배경) + 총 오버레이(투명 배경) 3장으로 분리돼
  왔고, 두 무기 모두 전 프레임에 항상 그려져 있다(평소엔 거치, 자기 공격 애니메이션
  중엔 사용 자세) — 그래서 프레임별 조건 분기 없이 `base → sword → gun` 순서로 캔버스에
  겹쳐 그리기만 하면 idle/walk/검공격/총공격 모든 프레임에서 올바르게 합성된다는 걸
  PIL로 몇 프레임 합성해 미리 확인한 뒤 적용했다. `CharacterSprite`의 애니메이션/UV
  로직(오프셋 기반 프레임 전환, 대시 잔상, 좌우 반전)은 텍스처가 단일 소스에서 3장
  Promise.all 로드 + 캔버스 합성으로 바뀐 것 외에는 그대로다. FX는 `slash_strip.png`
  (6→8프레임)·`muzzle_flash_strip.png`(3→8프레임)를 새 아트로 교체하고, 함께 온
  `fx_sword_slash_katana_wind_8f.png`는 신규 `slashWind` 종류로 추가해 베기 시 기존
  크레센트와 겹쳐 재생하도록 `Effects.slash()`를 수정했다(잔상 보강 목적 — 수치/밸런스
  변경 없음). `npm run qc` 통과, `contact.png` 육안 확인(idle/walk/shoot/slash/dash 전부
  무기 위치·총구화염·베기 궤적 정상).
- **남은 문제**: 없음. 다만 아트 시트는 카타나/M1911 고정이라 다른 무기 장착 시 외형이
  안 바뀌는 기존 제약은 그대로 남아있다(절차 생성 폴백만 무기별로 다르게 그려짐) — 이후
  다른 무기 전용 아트가 오면 같은 3층 합성 패턴을 확장하면 된다.

### 2026-07-27 — 보스/엘리트 QC 하네스 정착 (C1·C3 검증 자동화 미비 해소)
- **대상**: `tools/qc.mjs`(신규 10~15단계) · `src/core/qcDebugHooks.ts`(신규) ·
  `vite.config.ts`(`__QC_DEBUG__` define) · `src/main.ts` · `CLAUDE.md`
- **의도**: C1(보스 패턴)·C3(엘리트 접두사) 검증 때 썼던 임시 디버그 훅·스크립트를
  일회성이 아니라 `npm run qc`가 매번 자동으로 도는 상시 하네스로 정착시킨다.
- **결과**:
  - `src/core/qcDebugHooks.ts`에 `debugSpawnBoss()`/`debugSpawnElite(kind, affix)`/
    `debugClearEnemies()`를 구현. `main.ts`가 `__QC_DEBUG__`(vite.config.ts의
    define, `QC_DEBUG=1`로 빌드할 때만 true) 블록 안에서 동적 import로만 설치한다 —
    일반 배포 빌드(`npm run build`, QC_DEBUG 미설정)에는 esbuild가 죽은 코드로
    제거해 이 파일 자체가 번들에 안 실린다. `npm run build && grep -r
    debugSpawnBoss dist/`로 빈 결과 확인 완료.
  - `tools/qc.mjs`가 빌드 시 `QC_DEBUG=1`을 넘기도록 수정, 새 단계 6개 추가:
    - `10-boss-charge`/`11-boss-slam`: 보스를 강제로 특정 상태로 진입시키고
      50ms 간격 브라우저 내 폴링으로 `bossState` 전이 시퀀스와 각 구간 길이를
      실측, `Enemy.ts`의 `BOSS_PATTERN` 상수(예고/실행/경직 시간)와 ±300ms
      오차로 대조 — 어긋나면 반려.
    - `12-boss-phase2`: 체력을 50% 밑으로 직접 낮춰 `bossPhaseTwo`가 1회만
      true가 되는지, HUD 배너에 "2페이즈" 텍스트가 뜨는지, 체력을 더 깎아도
      재진입 안 하는지 검증.
    - `13-elite-ward-thorns`/`14-elite-regen`/`15-elite-split-volatile-swift`:
      6개 접두사 각각의 핵심 효과(실드 흡수량, 반사량, 회복 델타, 분열 자식
      수, 폭발 피해, 이동속도 배율)를 직접 호출·대조.
    - 각 단계의 `run()`이 예고/충격파/2페이즈 배너가 화면에 뜬 시점에서
      멈춰 스크린샷을 찍으므로 `contact.png`에도 포함된다.
  - **버그 두 건을 하네스 작성 중 발견·수정(게임 코드 아님, 전부 qc.mjs 쪽 원인)**:
    1. 09-combat에서 얻은 경험치로 레벨업 모달이 열린 채 남아있으면
       `state!=='play'`라 Game의 프레임 루프 전체가 멈춰(적 갱신 안 됨) 이후
       모든 보스/엘리트 단계가 연쇄로 얼어붙었다 — 각 단계 진입 전 열린
       모달을 자동으로 닫는 `dismissLevelUp()` 헬퍼 추가로 해결.
    2. 방의 원래 스폰 대기열이 백그라운드에서 계속 실제 몬스터를 흘려보내,
       그 몬스터의 접촉 피해가 플레이어의 `invuln` 타이머를 불시에 갱신해
       폭발 접두사 피해 판정이 가끔(비결정적으로) 막혔다 — `debugClearEnemies()`가
       `spawnQueue`도 함께 비우도록 수정, 폭발 피해 직전 `player.invuln = 0`도
       방어적으로 추가. 연속 3회 재실행으로 안정성 확인.
- **남은 문제**: 없음(자동화 완료). 다만 보스/엘리트 수치가 `Enemy.ts`의
  `BOSS_PATTERN`/`ELITE_AFFIX`에서 바뀌면 `tools/qc.mjs`의 기대값도 같이
  고쳐야 한다 — 두 곳이 수동 동기화라는 점은 남아있다.

### 2026-07-27 — B5 골드 경제 2차 실측 (상점 분리 반영)
- **대상**: `DESIGN_LOG.md` — 코드 변경 없음, 1차와 동일 방식(2만 회 몬테카를로) 재측정
- **의도**: B5 1단계(상점 인스턴스 분리) 이후 골드 잉여량이 어떻게 바뀌었는지 확인
- **결과**: 스테이지 완주 평균 총 골드는 약 2064로 1차(2088)와 사실상 동일(예상대로).
  던전 상점방은 `RunState.shopIndex` 로직상 런당 정확히 1개로 고정됨을 코드·실측
  양쪽으로 확인. 상점 2개(마을+던전) 합산 최대 소비 가능액이 분리 전 약 720골드에서
  최악 기준 약 1460골드로 2배 늘어 잉여 비율이 개선(최악 기준 약 65%→29.2%)됐지만,
  평균적인 구매가 기준으로는 여전히 75.7% 잉여 — 근본적인 과잉은 해소되지 않음.
- **남은 문제**: B5 자체는 미해결로 유지. 2·3단계(제련소·분수 유료화)가 필요하다는
  결론은 그대로.

### 2026-07-27 — B5 1단계 마을·던전 상점 인스턴스 분리
- **대상**: `src/core/Game.ts`
- **의도**: 마을 상인과 던전 상점방이 재고와 리롤 상태를 공유하지 않게 한다.
- **결과**: 두 상점은 런 동안 독립된 재고·판매 상태·리롤 횟수를 유지한다. 골드 잉여량
  재측정 완료 — 위 항목 참조.
- **버그 수정 (통합 중 발견)**: `enterDungeon()`이 `this.townShop`을 무조건 새로 생성하고 있었다 —
  포탈은 마을에서 던전으로 넘어갈 때마다 호출되므로, 마을 상점에서 리롤을 사고
  물건을 산 직후 포탈로 들어가면 그 상태가 전부 날아가는 실사용 버그였다(정작
  던전 상점방 생성 쪽은 이미 `if (!this.shop)`로 가드돼 있었음). 스크립트로
  "마을에서 리롤 2회 → 포탈 진입 → `townShop.rerollCount`가 0으로 리셋됨"을
  재현해 확인 후, 같은 가드(`if (!this.townShop)`)를 추가해 수정. 재빌드 후
  같은 스크립트로 리롤 횟수가 유지됨을 재확인.

### 2026-07-27 — C3 엘리트 사망·피격 이벤트형 접두사
- **대상**: `src/systems/EliteAffixes.ts` · `src/entities/Enemy.ts` · `src/systems/Effects.ts` · `src/core/Game.ts`
- **의도**: 사망과 피격 순간에도 엘리트 접두사가 명확한 위험·대응 방식을 만들게 한다.
- **결과**: 분열·폭발·보호막 접두사를 추가했다. C3의 방 단위 접두사 체계가 상시형과 이벤트형 효과를 모두 갖추어 해결됐다.
- **검증**: 엘리트 방은 절차 생성상 매번 나온다는 보장이 없어 `contact.png` 9단계로는 6개 접두사를 다 못 본다. 임시 디버그 훅(커밋 전 제거)으로 접두사별 직접 검증: 재생(피격 후 2초 지연·초당 최대체력 3% 회복 — 델타 실측 약 4.05/초, `maxHp*0.03` 기대값과 일치), 보호막(피격 시 실드가 먼저 흡수 후 체력 차감, 3초 후 재충전 필드 존재), 가시(근접 피해의 25% 반사값 반환 확인, 원거리 공격은 반사 안 됨 — `takeDamage` 호출부에서 근접만 `'melee'` 소스로 넘김), 분열(사망 시 자식 2마리 생성·경험치 0), 폭발(사망 시 반경 내 플레이어 피해 확인). 전부 사양대로 동작.
- **해소 (2026-07-27)**: `tools/qc.mjs`에 영구 단계(13~15)로 정착 — 아래 "보스/엘리트 QC 하네스 정착" 항목 참조.

### 2026-07-27 — C3 엘리트 방 단위 접두사 기반과 상시 효과
- **대상**: `src/systems/EliteAffixes.ts` · `src/systems/RunState.ts` · `src/entities/Enemy.ts` · `src/core/Game.ts`
- **의도**: 엘리트를 단순한 능력치 증폭이 아니라, 방 단위로 읽을 수 있는 전투 변형으로 확장한다.
- **결과**: 엘리트 방은 접두사 하나를 공유하며, 재생·신속·가시 상시 효과와 접두사별 체력바·입장 안내를 제공한다. 사망·보호막 이벤트형 효과는 후속 변경으로 분리한다.

### 2026-07-27 — 쿨타임 하한을 장착 무기 기준으로 수정
- **대상**: `src/entities/Player.ts`
- **의도**: B1 수정 시 도입한 쿨타임 하한이 `CONFIG`의 고정 기본 무기 수치를 기준으로 삼고 있어, 장착 무기에 따라 실효 하한이 크게 벌어지는 문제(예: 산탄총은 자기 기본값의 7.5%까지 내려가 사실상 무제한)를 바로잡는다.
- **결과**: 총/검 쿨타임 하한을 `CONFIG` 고정값이 아니라 **장착 중인 무기 자신의 기본 쿨타임**(`g.cooldown`/`s.cooldown`) 기준으로 계산하도록 변경. 대시 쿨타임은 무기와 무관해 현행 유지.

### 2026-07-27 — C1 보스 전용 패턴과 D2 이펙트 연결
- **대상**: `src/entities/Enemy.ts` · `src/entities/EnemySprite.ts` · `src/systems/Effects.ts` · `src/core/Game.ts` · `src/rendering/assets.ts`
- **의도**: 보스를 체력만 높은 슈터가 아닌, 예고·실행·경직·페이즈를 가진 전투의 정점으로 만든다. 등록만 되었던 보스 예고·충격파 아트를 실제 전투에 연결한다.
- **결과**: 보스는 거리와 이전 패턴에 따라 돌진·슬램·사격을 선택한다. 돌진과 슬램은 바닥 이펙트로 예고되며, 체력 절반에서 한 번만 강화 페이즈로 전환한다.
- **검증**: `npm run qc`의 9단계는 방-1 일반 전투에서 끝나 보스방까지 도달하지 않아(절차 생성 던전 특성상 보스방은 최소 8개 방을 다 돌아야 나옴) `contact.png`로는 자동 검증되지 않는다. 별도로 임시 디버그 훅(커밋 전 제거)으로 보스를 즉석 스폰해 상태머신을 직접 관찰: idle→chargeWarning(0.7s)→charge(1.0s, 3.5배속)→stagger(1.2s) 및 idle→slamWarning(0.9s)→slam(반경7, 2배 피해)→stagger(1.0s) 전이, 체력 50% 시점의 1회성 페이즈 전환(배너·무료 슬램·예고/경직 단축) 전부 사양대로 동작 확인. 벽 충돌 시 돌진 즉시 중단, 3연속 동일 패턴 방지 로직도 코드로 확인.
- **해소 (2026-07-27)**: `tools/qc.mjs`에 영구 단계(10~12)로 정착 — 아래 "보스/엘리트 QC 하네스 정착" 항목 참조.

### 2026-07-27 — B1·B2·B3 특성 선택 안전장치와 희귀도 추첨 수정
- **대상**: `src/systems/Upgrades.ts` · `src/entities/Player.ts` · `src/core/Game.ts` · `src/systems/Shop.ts`
- **의도**: 특성의 무제한 중첩과 대시 무적 가동률 상승을 차단하고, 특성 수가 등급 출현 빈도를 바꾸지 않게 한다.
- **결과**: 플레이어가 특성 스택을 보관하며 선택지·상점·제련소·획득 처리 모두 상한을 지킨다. 선택할 특성이 전혀 없을 때에도 보상·레벨업 흐름이 멈추지 않는다. 최종 쿨타임에는 기본 설정 기준 하한을 적용했다. 일반 및 보스 보상은 등급을 먼저 뽑고 해당 등급 내에서 균등하게 고른다.

### 2026-07-27 — 문서 체계 개편(AGENTS.md 도입) + 사실 검증 일괄 + qc.mjs 자동 검사 확장
- **대상**: `AGENTS.md`(신규, 정본) · `CLAUDE.md`(Claude Code 전용 축소판으로 교체) ·
  `DESIGN_LOG.md` · `tools/measure_sprites.py` · `tools/qc.mjs` — 게임 코드 변경 없음
- **의도**: 4인 협업 체제(Claude 기획 / Codex / GPT / Claude Code) 확정에 따라
  규칙 문서를 코덱스가 자동으로 읽는 `AGENTS.md` 하나로 통합하고, "미검증 영역"에
  남아있던 사실들을 코드를 직접 읽어 확정한다. 사람 눈으로만 판정하던 것 중
  스크립트로 판정 가능한 항목은 `qc.mjs`에 자동 검사로 옮긴다.
- **결과**:
  - `AGENTS.md` 배치 중 자체 오류 발견 및 수정: Asset rules 항목이
    `public/assets/player/gunblade_*.png` 5장 체계를 언급했으나, 실제 코드
    (`CharacterSprite.ts`)는 이 경로 자체가 디스크에 없고 단일 시트
    `public/gunblader.png`(SD 일러스트, 112x64 셀 × 27프레임) + 로드 전 절차
    생성 폴백만 사용 중임을 확인 — 5장 체계는 과거에 시도했다가 되돌려진 것
    (git 이력상 "주인공 캐릭터를 원본 SD 일러스트 시트로 되돌림" 커밋 존재).
    문서를 실제 코드에 맞게 정정.
  - `Game.ts` 데미지 경로 전수 확인: `Player.Mods`/`PlayerStats`에 선언된
    모든 필드(치명타·치명타배율·흡혈·관통·멀티샷·자력범위·폭심·섬광강타·
    발도장전 포함)가 실제로 소비되는 코드를 확인 — **선언만 되고 미사용인
    mod 없음**.
  - 골드 경제 실측 → 새 이슈 B5로 기록(상점 용량 대비 골드 과잉).
  - 에셋 감사 → 새 이슈 D1(고아 파일 31개, 131.5KB)/D2(등록됐지만 미사용인
    이펙트 3종, C1과 연관)로 기록.
  - 시각 판정(`contact.png` 육안 확인):
    - 구 CLAUDE.md UI Rules의 "분수와 포탈이 같은 청록 구슬로 보인다"는
      **더 이상 해당 없음** — 포탈은 큰 파랑 소용돌이, 분수는 작은 청록
      결정체로 실루엣·색 모두 뚜렷이 구분됨. 리소스 교체 과정에서 이미 해결.
    - 몬스터 픽셀 밀도 편차(임프 29.1 ~ 보스 11.9 px/유닛)는 **결함 아님** —
      네 종 모두 원본 셀 높이가 64px로 동일하고(`SCALE × 밀도 ≈ 64` 확인),
      차이는 종족별 `SCALE`(월드 크기)만 다르기 때문. 니어리스트 스케일링이라
      스타일 자체는 크기와 무관하게 일관됨.
    - 반면 포탈(39.2 px/유닛, 원본 128x192)은 다른 마을 프롭(7~11 px/유닛,
      원본 24~34px)보다 훨씬 고해상도로 그려져 있어 **육안으로도 이질적으로
      매끄럽게 보임** — 프롭들 사이의 실제 시각적 불일치로 확인됨.
    - `traitAltar`/`traitForge`는 여전히 동일한 룬석 아트(`guardian_stone_a/b`)를
      색만 다르게 써서 실루엣이 같음 — 전용 아트 도착 전까지는 미해결로 유지.
  - `tools/measure_sprites.py`를 몬스터 전용 검사기에서 에셋 전반 무결성
    검사기로 확장: `FRAMES`/`ASSET.monsters` 경로를 소스에서 직접 파싱(하드코딩
    제거로 이중 관리 방지), `assets.ts`가 참조하는 43개 경로 실존 + 모서리
    알파(검은 후광) 검사, `Interactable.ts`의 `ASPECT` 7건을 실제 PNG 비율과
    대조하는 기능 추가. `tools/qc.mjs`가 빌드 전 이 검사를 항상 실행하고
    실패 시 QC 전체를 반려하도록 연결.
- **남은 문제**: B5(상점 경제)·D1/D2(에셋 정리)는 판단·결정 대기 — 방식 결정은
  사용자 승인 필요. `traitAltar`/`traitForge` 전용 아트는 GPT 작업 대기 중.

### 2026-07-27 — B1·B2 실측 검증
- **대상**: `src/entities/Player.ts` (`recompute()`, `invulnerable`) — 코드 변경 없음, 확인만
- **의도**: "미검증 영역"에 남아있던 `recompute()` 스탯 상한 유무를 확인해 B1·B2를 확정
- **결과**: `critChance`는 이미 100% 상한이 걸려 있어 B1의 관련 서술은 오류로 정정.
  `gunCooldown`·`swordCooldown`·`dashCooldown`은 상한이 없어 B1 핵심 문제는 유효로 확정.
  대시 무적은 기본값부터 대시 전체 구간을 덮는 구조이며(의도된 설계로 추정),
  가동률은 순수히 `dashCooldown`에 좌우됨을 확인 — B2도 유효로 확정, 단 원래
  기재된 구체 수치(76%)는 재현 안 돼 삭제
- **남은 문제**: B1·B2 자체의 해결책(선택지 1/2/3)은 아직 미결정

### 2026-07-27 — 설계 로그 도입
- **대상**: `DESIGN_LOG.md` (신규)
- **의도**: 코드에는 남지 않는 기획 의도·폐기된 시도·미해결 이슈를 축적한다.
  기획 논의를 코드베이스 밖에서 진행할 때, 최신 코드와 논의 맥락이
  어긋나는 것을 방지하는 것이 목적.
- **결과**: 현재 코드 기준 미해결 이슈 12건(B1~B4, C1~C8)을 정리.
  밸런스 이슈 4건은 `config.ts`·`Upgrades.ts`·`Weapons.ts` 실측값 계산에서 도출.
- **남은 문제**: 미검증 영역 3개 파일을 읽기 전까지 B1·B2는 확정 아님.
### 2026-07-28 — Paperdoll 캐릭터 적용 보류
- **대상**: `CharacterSprite.ts`, `assets/player/*`
- **의도**: 분리 파츠의 최종 모션·피벗 기준이 확정될 때까지 화면 회귀를 막는다.
- **결과**: 임시 Paperdoll 레이어와 에셋을 되돌리고, 기존 단일 2D 시트 `gunblader.png` 표시 방식으로 복귀했다. 새 캐릭터 에셋 확정 후 재검토 필요.
