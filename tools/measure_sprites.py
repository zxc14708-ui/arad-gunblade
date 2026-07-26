#!/usr/bin/env python3
"""몬스터 시트 규격 검사기.

EnemySprite.ts 의 렌더링은 시트가 아래 규격을 지킨다는 전제로 단순하게 짜여 있다.
새 시트를 받으면 통합 전에 이걸 먼저 돌려 규격 위반을 잡는다.

  1. 가로 스트립, 정사각 셀 (가로 = 셀 x 프레임수)
  2. 셀 크기·프레임 수가 EnemySprite.ts 의 FRAMES 와 일치
  3. 모든 프레임의 발(=최하단 불투명 픽셀)이 셀 아래변에 닿음
     -> 안 지키면 몬스터가 공중에 뜬다
  4. 같은 몬스터의 대기/걷기 캐릭터 높이가 비슷함 (비율 0.85~1.2)
     -> 안 지키면 동작이 바뀔 때 몬스터 크기가 튄다
     (공격은 웅크리는 자세가 많아 낮게 나오는 것이 정상이므로 경고만)

사용법:
  python3 tools/measure_sprites.py          # 검사 결과 출력
  종료코드 0 = 통과, 1 = 위반 있음
"""
import sys
from statistics import median
from PIL import Image

ROOT = 'public/assets/stage1'

# kind -> (디렉터리, [(상태, 파일명, 기대 프레임수)])
MON = {
    'imp': ('stage1_goblins', [
        ('idle', 'melee_goblin_idle_4f', 4),
        ('walk', 'melee_goblin_walk_6f', 6),
        ('attack', 'melee_goblin_club_attack_4f', 4),
    ]),
    'shooter': ('stage1_goblins', [
        ('idle', 'fire_goblin_idle_4f', 4),
        ('walk', 'fire_goblin_walk_6f', 6),
        ('attack', 'fire_goblin_cast_4f', 4),
    ]),
    'brute': ('stage1_tau', [
        ('idle', 'tau_warrior_idle_4f', 4),
        ('walk', 'tau_warrior_walk_6f', 6),
        ('attack', 'tau_warrior_slam_4f', 4),
    ]),
    'boss': ('stage1_tau', [
        ('idle', 'tau_chief_idle_4f', 4),
        ('walk', 'tau_chief_move_6f', 6),
        ('attack', 'tau_chief_slam_6f', 6),
    ]),
}


def measure(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    cell = h
    px = im.load()
    n = w // cell if cell else 0
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
    return dict(w=w, h=h, cell=cell, frames=n, heights=heights, feet=feet)


FEET_TOL = 2  # 발 위치 허용오차(px) — 1~2px 차이는 눈에 보이지 않는다

errors, warnings = [], []
print(f'{"kind":9} {"state":7} {"size":>10} {"cell":>5} {"frames":>7} {"bodyH(med)":>11} {"ratio":>6}')
print('-' * 64)

for kind, (d, sheets) in MON.items():
    # 걷기를 기준으로 삼으므로 먼저 전부 측정한 뒤 비교한다
    got = {}
    for state, name, want_frames in sheets:
        try:
            got[state] = (name, want_frames, measure(f'{ROOT}/{d}/{name}.png'))
        except FileNotFoundError:
            errors.append(f'{name}: 파일 없음')

    if 'walk' not in got:
        continue
    wm = got['walk'][2]
    ref = (median(wm['heights']) / wm['cell']) if wm['heights'] else 0

    for state, name, want_frames in sheets:
        if state not in got:
            continue
        _, want_frames, m = got[state]
        bh = median(m['heights']) if m['heights'] else 0
        ratio = (bh / m['cell']) / ref if ref else float('nan')
        size = '{}x{}'.format(m['w'], m['h'])
        print(f'{kind:9} {state:7} {size:>10} {m["cell"]:>5} '
              f'{m["frames"]:>7} {bh:>11.0f} {ratio:>6.2f}')

        if m['w'] % m['cell']:
            errors.append(f'{name}: 가로 {m["w"]} 가 셀 {m["cell"]} 의 배수가 아님')
        if m['frames'] != want_frames:
            errors.append(f'{name}: 프레임 {m["frames"]}개 (기대 {want_frames}개)')
        bad = [(i, f) for i, f in enumerate(m['feet']) if m['cell'] - 1 - f > FEET_TOL]
        if bad:
            errors.append(f'{name}: 발이 셀 바닥에서 뜬 프레임 {[i for i, _ in bad]} '
                          f'(발y={[f for _, f in bad]}, 기대 {m["cell"] - 1})')
        if state == 'idle' and not (0.85 <= ratio <= 1.2):
            errors.append(f'{name}: 대기 캐릭터 크기가 걷기의 {ratio:.2f}배 (0.85~1.2 이어야 함)')
        if state == 'attack' and not (0.5 <= ratio <= 1.2):
            warnings.append(f'{name}: 공격 캐릭터 크기가 걷기의 {ratio:.2f}배 — 자세 때문인지 확인')
    print()

for w in warnings:
    print(f'경고: {w}')
for e in errors:
    print(f'위반: {e}')
print(f'\n{"통과" if not errors else f"위반 {len(errors)}건"}')
sys.exit(1 if errors else 0)
