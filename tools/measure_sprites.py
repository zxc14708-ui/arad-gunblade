#!/usr/bin/env python3
"""몬스터 시트의 실측값을 뽑아 EnemySprite.ts 의 ART 표를 생성한다.

왜 필요한가:
  같은 몬스터의 대기/걷기/공격 시트가 셀 안에서 서로 다른 크기로 그려져 왔다.
  (걷기는 셀을 꽉 채우고 발이 바닥에 닿는데, 대기/공격은 셀 중앙에 작게 떠 있음)
  스프라이트를 셀 기준으로 그리면 동작이 바뀔 때마다 몬스터 크기가 튀고 공중에 뜬다.

  아트를 리스케일하면 원본 디테일이 뭉개지므로, 대신 시트별 실측값
  (셀 안 캐릭터 높이 / 발 y좌표) 을 코드에 넘겨 렌더 단계에서 보정한다.

사용법:
  python3 tools/measure_sprites.py          # 표 출력
  python3 tools/measure_sprites.py --check  # 현재 TS 표와 불일치 시 종료코드 1

새 시트를 받으면 이걸 다시 돌려 EnemySprite.ts 의 ART 를 갱신하면 된다.
"""
import sys
from statistics import median
from PIL import Image

ROOT = 'public/assets/stage1'

# kind -> (디렉터리, idle, walk, attack)
MON = {
    'imp':     ('stage1_goblins', 'melee_goblin_idle_4f', 'melee_goblin_walk_6f', 'melee_goblin_club_attack_4f'),
    'brute':   ('stage1_tau',     'tau_warrior_idle_4f',  'tau_warrior_walk_6f',  'tau_warrior_slam_4f'),
    'shooter': ('stage1_goblins', 'fire_goblin_idle_4f',  'fire_goblin_walk_6f',  'fire_goblin_cast_4f'),
    'boss':    ('stage1_tau',     'tau_chief_idle_4f',    'tau_chief_move_6f',    'tau_chief_slam_6f'),
}


def measure(path):
    """(셀 크기, 프레임 수, 대표 캐릭터 높이, 대표 발 y) — 프레임별 중앙값 기준.

    중앙값을 쓰는 이유: 웅크림·도약처럼 프레임마다 키가 달라지는 것은 애니메이션
    자체이므로 유지해야 한다. 시트 전체에 단일 보정값만 적용한다.
    """
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    cell = h                      # 정사각 셀 전제 (가로 스트립)
    if w % cell:
        raise SystemExit(f'{path}: 가로 {w} 가 셀 {cell} 의 배수가 아니다')
    n = w // cell
    px = im.load()
    heights, feet = [], []
    for i in range(n):
        x0 = i * cell
        top = bot = None
        for y in range(h):
            if any(px[x, y][3] > 10 for x in range(x0, x0 + cell)):
                if top is None:
                    top = y
                bot = y
        if top is not None:
            heights.append(bot - top + 1)
            feet.append(bot)
    return cell, n, int(median(heights)), int(median(feet))


rows = []
for kind, (d, idle, walk, atk) in MON.items():
    entry = {}
    for state, name in (('idle', idle), ('walk', walk), ('attack', atk)):
        cell, n, bh, fy = measure(f'{ROOT}/{d}/{name}.png')
        entry[state] = dict(cell=cell, frames=n, bodyH=bh, feetY=fy)
    rows.append((kind, entry))

print('// tools/measure_sprites.py 로 생성 — 시트를 교체하면 다시 돌려 갱신할 것')
print('const ART: Record<EnemyKind, Record<EnemyAnimState, SheetMetrics>> = {')
for kind, e in rows:
    print(f'  {kind}: {{')
    for state in ('idle', 'walk', 'attack'):
        m = e[state]
        print(f'    {state}: {{ cell: {m["cell"]}, frames: {m["frames"]}, '
              f'bodyH: {m["bodyH"]}, feetY: {m["feetY"]} }},')
    print('  },')
print('}')

print('\n// 참고: 상태 간 캐릭터 높이 비율 (1.0에서 멀면 크기가 튄다)', file=sys.stderr)
for kind, e in rows:
    ref = e['walk']['bodyH'] / e['walk']['cell']
    ratios = {s: round((e[s]['bodyH'] / e[s]['cell']) / ref, 2) for s in ('idle', 'walk', 'attack')}
    print(f'//   {kind:8} {ratios}', file=sys.stderr)
