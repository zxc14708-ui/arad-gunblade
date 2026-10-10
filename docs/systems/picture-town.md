# Picture town

User-approved 2026-10-10 (`DESIGN_LOG.md` "그림 한 장 마을"). The town is one
illustration that fills the screen; the old floor/wall/tree geometry is gone.

## How it works

| Item | Implementation |
|---|---|
| Background | `ASSET.town.village` (`public/assets/town/arad_village_bg.png`) set as `scene.background` in `Game.enterTown()`; restored to the dark colour in `clearWorld()` |
| Room | `new Room(scene, size, 'picture')` — bounds only, no meshes |
| Camera | Fixed while `townPicture` is true (`camTarget()` returns the origin) |
| Walkable area | Screen fractions `TOWN_PICTURE.walk` (x 3–97 %, y 64–92 %) projected onto the ground plane with `groundAtScreen()`; the south bound adds back the 2.4 foreground inset `Room.clamp` subtracts |
| Facility spots | `TOWN_PICTURE.spots` (screen fractions → ground) |
| Name tags | `Interactable.setNameTag(text)` — canvas sprite above the placeholder |
| Hidden facility | `Interactable.hideVisual()` — the dungeon gate is the road through the arch, not a portal sprite |

Because spots are screen fractions, replacing the illustration only needs new
fractions, and a camera-angle change keeps everything aligned.

## Spots (current illustration)

| Spot | Screen (x, y) | Facility | Placeholder |
|---|---|---|---|
| Smithy front (anvil, forge) | 0.18, 0.66 | Weapon blueprints (meta currency) — "대장장이 · 무기" | merchant stall sprite |
| Tavern door | 0.58, 0.66 | Starting trait (once per run) — "선술집 · 시작 특성" | trait altar stone |
| Canvas stall | 0.73, 0.66 | Power altar (permanent upgrades) — "노점 · 힘의 제단" | meta altar stone |
| Right stone arch road | 0.93, 0.66 | Enter dungeon — "▶ 던전으로" | hidden portal |
| Player entry | 0.40, 0.80 | — | — |

## Known issues

- The illustration is the user's 1671×941 reference converted to PNG; it is
  upscaled ~1.15× with nearest filtering, so its pixels are finer than the
  character's (~2 screen px per art pixel). Re-deliver at 960×540 art
  pixels exported ×2.
- The character is small next to the buildings (tavern door ≈ 1.2× the
  character). Decide whether the town illustration is redrawn at a larger
  building scale or the town camera zooms in.
- HUD top stats sit on the bright sky; contrast is lower than in dungeons.

## Picture spec (for replacements)

- 16:9, delivered 1920×1080 PNG (960×540 art pixels ×2 nearest), ≤ 64 colours.
- Side view; a clear ground line around 60 % height. Below it, a flat walkable
  road with **no props** in the walking band (props would look walkable-through).
- Leave a clear standing spot in front of every building that hosts an NPC.
- Daylight is fine for the town.

## NPC sprite request (Gemini)

```
[마을 NPC 스프라이트 요청]
대상: 그림 마을 NPC 3명 (참조: assets/town/arad_village_bg.png 의 각 건물 앞)
  1. 대장장이 — 가죽 앞치마, 망치 (대장간 앞)
  2. 선술집 주인 — 앞치마, 맥주잔 (선술집 문 앞)
  3. 노점 상인 — 두건, 작은 저울 또는 보따리 (천막 노점 앞)
규격:
  - 대기 4프레임 가로 시트, 정사각 셀 64×64 (ART_GUIDE §4 중형 기준)
  - 하단 중앙 기준(발이 셀 하단 0~2px), 투명 배경 PNG, 네 모서리 완전 투명
  - 옆모습(오른쪽을 바라봄 — 코드에서 좌우 반전), 플레이어 캐릭터와 같은 픽셀 밀도
  - 레이어당 64색 이하, 안티앨리어싱 없음
확인: ART_GUIDE §8 체크리스트, 마을 그림 위에 올렸을 때 건물 문 대비 키(문 높이의 약 2/3)
```
