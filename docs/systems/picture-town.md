# Picture town

User-approved 2026-10-10 (`DESIGN_LOG.md` "그림 한 장 마을"). The town is one
illustration that fills the screen; the old floor/wall/tree geometry is gone.

## How it works

| Item | Implementation |
|---|---|
| Background | `ASSET.town.village` (`public/assets/town/arad_village_v3.png`, 960×540 art ×2, 64 colours) set as `scene.background` in `Game.enterTown()`; restored to the dark colour in `clearWorld()` |
| Room | `new Room(scene, size, 'picture')` — bounds only, no meshes |
| Camera | Fixed while `townPicture` is true (`camTarget()` returns the origin) |
| Walkable area | Screen fractions `TOWN_PICTURE.walk` (x 3–97 %, y 64–92 %) projected onto the ground plane with `groundAtScreen()`; the south bound adds back the 2.4 foreground inset `Room.clamp` subtracts |
| Facility spots | `TOWN_PICTURE.spots` (screen fractions → ground) |
| NPCs | `Interactable.useNpcSheet(path, 4, 4fps, 3.7)` — 64×64 idle sheets at the player's world height (same pixel density); NPCs right of centre face left |
| Name tags | `Interactable.setNameTag(text)` — canvas sprite above the NPC |
| Hidden facility | `Interactable.hideVisual()` — the dungeon gate is the road through the arch, not a portal sprite |

Because spots are screen fractions, replacing the illustration only needs new
fractions, and a camera-angle change keeps everything aligned.

## Spots (current illustration)

| Spot | Screen (x, y) | Facility | NPC |
|---|---|---|---|
| Smithy front (anvil, forge) | 0.16, 0.67 | Weapon blueprints (meta currency) — "대장장이 · 무기" | `npcs/blacksmith-idle.png` |
| Tavern door | 0.55, 0.67 | Starting trait (once per run) — "선술집 · 시작 특성" | `npcs/tavern-idle.png` (faces left) |
| Canvas stall | 0.72, 0.67 | Power altar (permanent upgrades) — "노점 · 힘의 제단" | `npcs/merchant-idle.png` (faces left) |
| Right stone arch road | 0.885, 0.66 | Enter dungeon — "▶ 던전으로" | hidden portal |
| Player entry | 0.40, 0.80 | — | — |

## Known issues

- Resolved by the v3 delivery (2026-10-10): pixel density now 2 screen px per
  art pixel, buildings rescaled to the characters (`docs/art/town-art-delivery.md`).
- HUD top stats sit on the bright sky; contrast is lower than in dungeons.

## Picture spec (for replacements)

- 16:9, delivered 1920×1080 PNG (960×540 art pixels ×2 nearest), ≤ 64 colours.
- Side view; a clear ground line around 60 % height. Below it, a flat walkable
  road with **no props** in the walking band (props would look walkable-through).
- Leave a clear standing spot in front of every building that hosts an NPC.
- Daylight is fine for the town.

## NPC sprite request (Gemini) — delivered 2026-10-10, kept for future NPCs

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
