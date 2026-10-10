# Side-scrolling (belt) combat rooms — pilot

User-approved 2026-10-09 (`DESIGN_LOG.md` "횡스크롤 전환"). Normal `combat`
nodes are the pilot; every other room keeps its single-screen layout until the
pilot is playtested.

## Rules

| Item | Value | Where |
|---|---|---|
| Rooms affected | `combat` nodes with depth ≥ 1 (not elite/trait/hardCombat/shop/rest/boss, not the hidden depth-0 lobby) | `isBeltPlan()` in `Game.ts` |
| Room size | 126 × 16 world units (≈ 2.5 screens wide, about half the old depth of 30) | `CONFIG.belt.width/depth` |
| Sections | 3 sections of 42 units each — a section fits inside the ~50-unit camera view | `CONFIG.belt.sections` |
| Entry | West edge, progress left → right | `Room.entryPoint('west')` |
| Lock | Section 1 locks on entry; later sections lock when the player is `triggerInset` (4) units past the section's left edge. While locked, player and camera stay inside the section | `Game.updateBelt/clampToBeltLock/camTarget` |
| Waves | The room's enemy list (unchanged density formula) is dealt round-robin into the sections; each section's share spawns inside that section, ≥ 9 units from the player horizontally | `Game.planBelt/safeSpawnPoint` |
| Section cleared | Lock releases, blinking `GO ▶` appears at the right edge | `HUD.setBeltGo` |
| Room cleared | After the last section — the normal `onRoomClear()` path opens route cards at the room's end | `Game.step` |
| Chest | Placed in the last section | `Game.loadRoom` |
| Camera | Unchanged angle (`camOffset` 0,24,17, `viewSize` 14). Follows the player, clamped to the locked section and to the room | `Game.camTarget` |
| Shadows | Key light and its ±34 shadow box follow the camera look-at point | render loop in `Game.ts` |
| Aiming | 360° mouse aim unchanged | — |

Room art repeats one decoration set (trees, bushes, stones, vine, two torches)
per 42-unit segment (`Room.ts` `SEGMENT_WIDTH`), so single-screen rooms are
unchanged and the belt room gets three sets.

Performance: only two torch `PointLight`s exist per room; in rooms with more
torches they move to the two torches nearest the camera each frame
(`Room.update(dt, viewX)`). Six real lights made the belt room render ~45%
slower in the QC browser (game clock 0.14× vs 0.26×); pooled lights bring it to
0.23×.

## Known effects to watch in playtest

- Each wave is about a third of the room's enemies (stage 1 depth 2: 10–13
  enemies → 3–5 per wave). Density per wave is lower than the old room; the
  enemy-count formula was not changed because that is a balance decision.
- The narrow 16-unit depth lines enemies up, which favours sword multi-hits and
  gun pierce. Issue-6 swing/pierce measurement (`aimed-density` QC) still runs
  in the 42×30 sandbox; belt-room measurement is future work.
- Route cards open immediately when the last wave dies (same as before for
  combat rooms), so a chest must be opened during the last wave.

## QC

- `belt-room` loads an uncleared combat room and drives all three sections:
  size, entry lock, out-of-section clamp, in-section spawns, GO toggle,
  camera scroll, and route cards after the last section.
  Screenshot `qc-out/belt-go.png` shows the GO state.
- The shared combat sandbox (after `route-choice`, and `ensureRouteNotBlocking`
  for `--only` runs) deliberately picks a non-combat card so older scenarios
  keep their 42×30 coordinates.
- `belt-room` waits on game state (wave fully spawned, enemies gone, route
  shown) instead of fixed game-time sleeps.
- `boss-prep`'s 300-map sample and `combat-gold-mult` are unaffected.

## Art request template (Gemini)

Belt rooms currently reuse the Stage-1 forest floor, wall texture and
foreground props. Final per-stage art follows `ART_GUIDE.md` §7 and is
requested as **separate layers**, never as one finished painting.

> **Pending view change (2026-10-10):** the user chose option ④ — camera ~30°,
> south wall removed, a side-view backdrop standing behind the north wall
> (`DESIGN_LOG.md` "화면 시점 전환 — ④"). When it lands, layer A grows from a
> band to the whole upper part of the screen (side view, the part of a
> reference above its ground line), and props become standing (billboard)
> art instead of flat ground decals. Layer sizes below will be re-issued with
> the implementation; the layer split, PNG/pixel-density/palette rules stay.

### Why layers — reference review (2026-10-09)

The user supplied two reference illustrations (a half-timbered village with a
smithy/tavern/stone arch, and overgrown forest ruins with an arch). Measured
and judged against the game, neither can be dropped in as-is:

| Problem | Measured / observed | Consequence in game |
|---|---|---|
| Side-view perspective | Eye-level horizon at ~55% height, floor stones grow toward the bottom | The game floor is an orthographic 3D plane seen from ~55° above; a perspective floor doubles the perspective and sprites look like they float |
| Not seamless | Left/right edge colour difference 29–35 vs 4.5–5 between neighbouring columns | A 126-unit room (~4,860 screen px) shows a hard seam every repeat |
| Size/format | 1671×941 lossy WebP | Spec is lossless PNG, 1920×1080 reference frame; WebP smears pixel edges |
| Pixel density | "Pixel-style" painting, irregular grid, ~3,500–4,000 colours | Characters/monsters are true pixel art at ~2 screen px per art pixel; the backdrop reads as a different resolution |
| Lighting/mood | Bright daylight, baked light | Stage 1 is a dark underground forest with fog and torches; baked daylight fights scene lighting |
| Readability | Dense green foliage | Green goblins blend into mid-ground foliage |

Verdict: the **composition and mood** are good references — village (1) fits
the town, ruins (2) fit a Stage-1 belt backdrop — but they must be re-made as
the layers below.

### Layers

| # | Layer | Native art size → delivered PNG | Rules | Code status |
|---|---|---|---|---|
| A | Backdrop band (sky, trees, buildings — the top half of a reference) | 960×300 art px → **1920×600** (×2 nearest) | Side view allowed (it stands behind the north wall); left/right edges seamless; opaque; no floor/ground in the band; dungeon version pre-darkened | Not wired — needs an unlit vertical plane behind the north wall (`Room.ts`) |
| B | Floor tile (dirt, flagstones) | 64×64 art px → **256×256** (×4 nearest) | Seen from straight above, **no perspective**; seamless on all four sides; low contrast so sprites read | Wired (`art.floor`, 2×2 world units per tile — world size may be retuned to match density) |
| C | North wall strip | 128×64 art px → **512×256** (×4 nearest) | Seamless left/right; top edge meets layer A | Not wired (wall is a generated texture) |
| D | Props (smithy, arch, barrels, woodpile, stalls, ruins pillars, bushes) | each on its own canvas, ×2 nearest | One prop per PNG, transparent, bottom-centre anchor, real aspect ratio | Ruins/bush/tree slots wired; buildings need `Interactable`/decor wiring |

Common rules for every layer:

- 1 art pixel = 2 screen px (characters/monsters are 1.8–2.1); export with
  nearest-neighbour scaling only.
- PNG, RGBA for props, no lossy formats, no anti-aliasing or gradients.
- ≤ 64 colours per layer; keep mid-ground foliage hue away from enemy greens
  (goblins) or lower its saturation.
- Stage 1 / dungeon: dark variant (night, torch-lit); town: daylight is fine.
- Check the seam by placing two copies side by side before delivery.

### Request form

```
[배경 레이어 요청]
대상: 마을 / 스테이지 N 횡스크롤 전투방 (테마: …)
참조 이미지: (첨부) — 구도·분위기만 참조, 그대로 쓰지 않음
산출물:
  A. 원경 띠   — 960×300 원본 → 1920×600 PNG(×2 최근접), 좌우 이음매 없음, 불투명,
                 바닥 없이 하늘·나무·건물만, (던전) 어두운 버전
  B. 바닥 타일 — 64×64 원본 → 256×256 PNG(×4 최근접), 정수리 시점(원근 없음),
                 상하좌우 이음매 없음, 저대비
  C. 북쪽 벽 띠 — 128×64 원본 → 512×256 PNG(×4 최근접), 좌우 이음매 없음,
                 윗변이 원경 띠와 자연스럽게 이어질 것
  D. 소품      — 1개당 1파일, 투명 배경, 하단 중앙 기준, ×2 최근접 (목록: …)
공통: 1아트픽셀 = 화면 2px, 레이어당 64색 이하, 안티앨리어싱·그라데이션 금지,
      적(녹색 고블린)과 겹치는 채도 높은 녹색 피하기
확인: ART_GUIDE.md §8 체크리스트 + §7 배경 항목, 두 장 이어 붙여 이음매 확인
```

### Ready-to-send requests

> 마을은 2026-10-10부터 그림 맵(`picture-town.md`)이라 아래 마을 레이어 요청은
> 더 이상 쓰지 않는다 — 기록용으로만 남긴다.

```
[배경 레이어 요청 — 마을 (폐기)]
대상: 마을 (현재 숲 소품 조합 임시본 대체)
참조 이미지: 반목조 마을(대장간·선술집·돌 아치), 2026-10-09 사용자 제공
산출물:
  A. 원경 띠 — 대장간·선술집 2층 건물·아치·뒤편 숲과 언덕 위 성채, 낮
  B. 바닥 타일 — 다져진 흙 + 드문드문 납작한 돌판
  C. 북쪽 벽 띠 — 낮은 나무 울타리 + 돌 기단
  D. 소품 — 모루, 나무통, 장작더미, 천막 노점, 걸이 간판(모루/맥주잔), 랜턴 기둥
공통·확인: 위 양식과 동일
```

```
[배경 레이어 요청 — 스테이지 1 횡스크롤 전투방]
대상: 스테이지 1 "검은 숲 지하" 일반 전투방(126×16, 3구간)
참조 이미지: 덩굴 덮인 숲 유적·아치, 2026-10-09 사용자 제공
산출물:
  A. 원경 띠 — 거목·무너진 석벽·덩굴 아치, 어두운 밤/지하 버전(횃불 빛 없이 어둡게)
  B. 바닥 타일 — 이끼 낀 흙 + 깨진 돌판(현재 forest_floor_room.png 대체)
  C. 북쪽 벽 띠 — 이끼 덮인 석벽, 횃불 걸이 자리 2곳(42단위마다)
  D. 소품 — 무너진 석주 2종, 굵은 뿌리 2종, 덤불 2종, 바위 2종, 덩굴 1종
      (현재 장식 슬롯: 나무 4.2×5.6, 덤불 2.6×1.75, 바위 1.5×2, 덩굴 3.6×1.8 월드 단위)
공통·확인: 위 양식과 동일
```
