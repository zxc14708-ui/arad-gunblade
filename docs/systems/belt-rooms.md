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
foreground props. Final per-stage belt art should follow `ART_GUIDE.md` §7.
Use this template when routing a request:

```
[횡스크롤 전투방 배경 요청]
스테이지: N (테마: …)
산출물:
  1. 바닥 타일  — 256×256 PNG, 좌우·상하 이음매 없이 반복(월드 2×2 단위)
  2. 북쪽 벽 띠 — 512×256 PNG, 좌우 이음매 없이 반복(월드 4×2 단위)
     (현재 벽은 코드 생성 텍스처 — 납품되면 Room.ts 배선 필요)
  3. 구간 장식 세트 — 나무 2·덤불 2·바위 2·덩굴 1, 하단 중앙 기준, 투명 배경
     (현재 크기: 나무 4.2×5.6, 덤불 2.6×1.75, 바위 1.5×2, 덩굴 3.6×1.8 월드 단위)
  4. (선택·미구현) 원경 패럴랙스 띠 — 1920×540 PNG, 좌우 이음매 없음, 불투명
확인: ART_GUIDE.md §8 체크리스트 + §7 횡스크롤 항목
```
