#!/usr/bin/env python3
"""원본 SD 모션 시트 → public/gunblader.png (112x64 셀 x 27프레임) 추출기.

SRC 는 작업 당시 업로드된 원본 일러스트 경로다. 시트를 다시 뽑을 일이 있으면
원본 PNG 경로와 ROWS 의 행 y구간만 바꿔서 실행하면 된다.

세로선 분할 대신 '연결 요소 소유권'으로 프레임을 나눈다.

기존 방식의 문제:
  프레임 간격(pitch)이 123~195px로 들쭉날쭉한데 카타나는 몸통 중심에서 왼쪽으로
  ~80px 뻗어 있다. 중점 세로선으로 자르면 간격이 좁은 프레임에서는 자기 칼끝이
  잘려나가고, 그 잘린 조각이 옆 프레임 셀에 이물질로 들어간다.

v5 방식:
  1) 행 전체를 한 번에 배경 제거 → 8방향 연결 요소 라벨링
  2) 몸통 위치는 '따뜻한 색(피부·금발·부츠)' 열 밀도로 검출 (칼날·궤적은 무채색)
  3) 각 연결 요소를 가장 가까운 몸통에 귀속시킴 (칼·궤적은 몸에 붙어 있거나 인접)
  4) 프레임별로 자기 요소만 합성 → 칼이 온전히 살고 이웃 조각이 섞이지 않음
"""
from PIL import Image
from collections import deque

SRC = '/root/.claude/uploads/d91fdec0-0ddc-5c0e-b903-596399db3e60/0fe74923-1000014102.png'
OUT = '/home/user/-/public/gunblader.png'
CELL_W, CELL_H = 112, 64
TARGET_BODY_H = 50    # 셀 안 캐릭터(머리~발) 높이
TIGHT, LOOSE, EXPAND = 12, 42, 2
DARK_LUMA = 88        # 평균 휘도가 이보다 낮은 분리 덩어리는 시트용 검은 연기로 보고 제거
WARM_THR = 8          # 열당 따뜻한 픽셀 수 (몸통 검출)
WARM_MIN_W = 30       # 총구 화염 같은 작은 따뜻한 덩어리 배제

im = Image.open(SRC).convert('RGB')
W, H = im.size
px = im.load()
bg = px[2, 2]

def dist(p):
    return abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2])

# 행 제목 텍스트 제거
for x in range(0, 385):
    for y in range(453, 478):
        px[x, y] = bg

ROWS = [('idle', 87, 223, 4), ('walk', 274, 394, 7),
        ('sword', 453, 591, 8), ('gun', 676, 802, 8)]


def body_spans(y0, y1):
    """피부/금발/부츠의 따뜻한 색 밀도로 몸통 x구간을 찾는다."""
    warm = [sum(1 for y in range(y0, y1)
                if px[x, y][0] - px[x, y][2] > 45 and px[x, y][0] > 110)
            for x in range(W)]
    cl, s = [], None
    for x in range(W):
        if warm[x] >= WARM_THR and s is None:
            s = x
        elif warm[x] < WARM_THR and s is not None:
            if x - s >= 5:
                cl.append([s, x])
            s = None
    if s is not None:
        cl.append([s, W])
    merged = []
    for c in cl:
        if merged and c[0] - merged[-1][1] <= 20:
            merged[-1][1] = c[1]
        else:
            merged.append(c)
    return [c for c in merged if c[1] - c[0] >= WARM_MIN_W]


def row_alpha(y0, y1):
    """행 전체를 잘라 배경을 투명화한 RGBA 이미지 (1px 여백 포함)."""
    crop = Image.new('RGB', (W + 2, y1 - y0 + 2), bg)
    crop.paste(im.crop((0, y0, W, y1)), (1, 1))
    crop = crop.convert('RGBA')
    w, h = crop.size
    cp = crop.load()

    out = [[False] * w for _ in range(h)]
    q = deque()

    def seed(x, y):
        if not out[y][x] and dist(cp[x, y][:3]) <= TIGHT:
            out[y][x] = True
            q.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not out[ny][nx] and dist(cp[nx, ny][:3]) <= TIGHT:
                out[ny][nx] = True
                q.append((nx, ny))
    for _ in range(EXPAND):
        add = []
        for y in range(h):
            for x in range(w):
                if out[y][x] or dist(cp[x, y][:3]) > LOOSE:
                    continue
                if any(0 <= nx < w and 0 <= ny < h and out[ny][nx]
                       for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))):
                    add.append((x, y))
        if not add:
            break
        for x, y in add:
            out[y][x] = True
    for y in range(h):
        for x in range(w):
            if out[y][x]:
                cp[x, y] = (0, 0, 0, 0)
    return crop


def components(img):
    """8방향 연결 요소 목록 (각 요소는 픽셀 좌표 리스트)."""
    w, h = img.size
    cp = img.load()
    seen = [[False] * w for _ in range(h)]
    comps = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or cp[sx, sy][3] == 0:
                continue
            stack = [(sx, sy)]
            seen[sy][sx] = True
            pix = []
            while stack:
                x, y = stack.pop()
                pix.append((x, y))
                for nx in range(x - 1, x + 2):
                    for ny in range(y - 1, y + 2):
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and cp[nx, ny][3] > 0:
                            seen[ny][nx] = True
                            stack.append((nx, ny))
            comps.append(pix)
    return comps


def bbox(pix):
    xs = [p[0] for p in pix]
    ys = [p[1] for p in pix]
    return min(xs), min(ys), max(xs), max(ys)


def gap(a, b):
    """두 bbox 사이 간격 (겹치면 0)."""
    dx = max(0, a[0] - b[2], b[0] - a[2])
    dy = max(0, a[1] - b[3], b[1] - a[3])
    return max(dx, dy)


frames, counts = [], []
stats = {'dark': 0, 'orphan': 0}

for name, y0, y1, n in ROWS:
    spans = body_spans(y0, y1)
    if len(spans) != n:
        print(f'  ! {name}: 몸통 {len(spans)}개 (기대 {n})')
    # row_alpha는 1px 여백을 주므로 원본 x → 잘린 이미지 x 는 +1
    spans = [[s[0] + 1, s[1] + 1] for s in spans]
    img = row_alpha(y0, y1)
    comps = components(img)
    cp = img.load()

    # 1) 각 몸통에 '본체' 요소 배정: 몸통 구간과 겹치는 가장 큰 요소
    boxes = [bbox(c) for c in comps]
    main_of = []
    for bi, sp in enumerate(spans):
        best, bestn = None, 0
        for ci, c in enumerate(comps):
            b = boxes[ci]
            ov = min(b[2], sp[1]) - max(b[0], sp[0])
            if ov > 0 and len(c) > bestn:
                best, bestn = ci, len(c)
        main_of.append(best)

    # 1b) 두 캐릭터가 궤적으로 이어져 한 덩어리가 된 경우 → 픽셀 단위로 나눈다
    own_pix = [[] for _ in spans]
    ctr = [(s[0] + s[1]) / 2 for s in spans]
    claimed = set()
    for ci in set(m for m in main_of if m is not None):
        bs = [bi for bi, m in enumerate(main_of) if m == ci]
        claimed.add(ci)
        if len(bs) == 1:
            own_pix[bs[0]] = list(comps[ci])
        else:
            print(f'  · {name}: 프레임 {bs} 가 한 덩어리 → 픽셀 분할')
            for p in comps[ci]:
                bi = min(bs, key=lambda b: abs(p[0] - ctr[b]))
                own_pix[bi].append(p)

    # 2) 본체까지의 '실제 최근접 거리' 지도 (bbox 간격은 긴 칼 때문에 오판한다)
    w, h = img.size
    near_id = [[-1] * w for _ in range(h)]
    near_d = [[10 ** 9] * w for _ in range(h)]
    q = deque()
    for bi, pxs in enumerate(own_pix):
        for x, y in pxs:
            near_id[y][x] = bi
            near_d[y][x] = 0
            q.append((x, y))
    while q:
        x, y = q.popleft()
        d = near_d[y][x] + 1
        for nx in range(x - 1, x + 2):
            for ny in range(y - 1, y + 2):
                if 0 <= nx < w and 0 <= ny < h and near_d[ny][nx] > d:
                    near_d[ny][nx] = d
                    near_id[ny][nx] = near_id[y][x]
                    q.append((nx, ny))

    # 3) 남은 요소는 가장 가까운 본체에 귀속 (요소의 최근접 지점 기준)
    for ci, c in enumerate(comps):
        if ci in claimed:
            continue
        lum = [0.299 * cp[x, y][0] + 0.587 * cp[x, y][1] + 0.114 * cp[x, y][2] for x, y in c]
        best, bestd = None, 10 ** 9
        for x, y in c:
            if near_d[y][x] < bestd:
                bestd, best = near_d[y][x], near_id[y][x]
        # 시트 배경용 검은 연기 / 행 제목 글자 / 본체와 동떨어진 파편은 버린다
        if (sum(lum) / len(lum) < DARK_LUMA or bestd > 30
                or (len(c) < 60 and bestd > 8) or best is None):
            stats['dark'] += 1
            continue
        own_pix[best].extend(c)

    # 3) 프레임별 합성
    row = []
    for bi, sp in enumerate(spans):
        pix = own_pix[bi]
        if not pix:
            print(f'  ! {name}[{bi}] 픽셀 없음')
            continue
        x0, yy0, x1, yy1 = bbox(pix)
        cell = Image.new('RGBA', (x1 - x0 + 1, yy1 - yy0 + 1), (0, 0, 0, 0))
        cc = cell.load()
        for x, y in pix:
            cc[x - x0, y - yy0] = cp[x, y]

        # 몸통(머리~발) 높이·중심: 따뜻한 색 구간 안의 내용 기준
        by0, by1 = 10 ** 9, -1
        for x, y in pix:
            if sp[0] <= x < sp[1]:
                by0 = min(by0, y)
                by1 = max(by1, y)
        # 스케일은 나중에 행 전체 공통으로 적용 (프레임마다 키가 변하면 안 됨)
        row.append((cell, (sp[0] + sp[1]) / 2 - x0, by1 - yy0, by1 - by0 + 1))
    frames.append(row)
    counts.append((name, len(row)))
    hs = [r[3] for r in row]
    print(f'{name}: {len(row)}프레임, 몸통높이 {min(hs)}~{max(hs)}px')

# 전 프레임 공통 스케일 — 기준은 대기 자세(가장 곧게 선 포즈)의 평균 키
ref = sum(r[3] for r in frames[0]) / len(frames[0])
SCALE = TARGET_BODY_H / ref
print(f'기준 키 {ref:.0f}px → 공통 scale {SCALE:.3f}')

total = sum(len(r) for r in frames)
strip = Image.new('RGBA', (CELL_W * total, CELL_H), (0, 0, 0, 0))
i = 0
clipped = 0
for row in frames:
    for raw, rbcx, rfy, _bh in row:
        cell = raw.resize((max(1, round(raw.size[0] * SCALE)), max(1, round(raw.size[1] * SCALE))), Image.NEAREST)
        bcx, fy = rbcx * SCALE, rfy * SCALE
        # 셀 밖으로 넘치는 부분은 잘라낸다 (옆 셀 침범 방지)
        one = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
        ox = round(CELL_W / 2 - bcx)
        oy = round(CELL_H - 1 - fy)
        one.alpha_composite(cell, dest=(max(0, ox), max(0, oy)),
                            source=(max(0, -ox), max(0, -oy)))
        if ox < 0 or oy < 0 or ox + cell.size[0] > CELL_W or oy + cell.size[1] > CELL_H:
            clipped += 1
        strip.paste(one, (i * CELL_W, 0))
        i += 1
strip.save(OUT)
print(f'저장: {OUT} ({strip.size[0]}x{strip.size[1]}, {total}프레임, 셀 {CELL_W}x{CELL_H})')
print(f'  버린 덩어리 {stats["dark"]}개, 셀 밖 잘림 {clipped}프레임')
idx = 0
for name, n in counts:
    print(f'  {name}={idx}..{idx + n - 1}', end='')
    idx += n
print()
