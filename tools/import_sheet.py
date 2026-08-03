#!/usr/bin/env python3
"""AI 생성 스프라이트(단색 배경, 프레임 정렬 없음)를 규격 시트(RGBA, 가로
스트립, 정사각 셀, 발이 셀 바닥에 닿음)로 변환한다 — 아트 임포트 파이프라인
1단계(작업 지시 P4_prompt_import_tool).

실측 결과 이미지 생성 모델은 알파 채널을 출력하지 못하고 프레임을 셀에
정렬하지도 못한다. 그래서 발주 방식을 "순수 단색(기본 마젠타) 배경 +
프레임을 가로 한 줄로 나열"로 바꿨고, 이 도구가 그 산출물을 규격 시트로
바꾼다.

  생성물(단색 배경, 정렬 안 됨)
    -> [이 도구] 키잉 + 분할 + 정렬 + 리사이즈
    -> 규격 시트
    -> quantize_sheet.py
    -> 마스터

색 양자화(32색화)는 이 도구의 역할이 아니다 — quantize_sheet.py가 다음
단계에서 한다. 이 도구는 순수 RGBA 시트만 만든다.

사용법:
  python3 tools/import_sheet.py <입력.png> --frames 6 --cell 48 \
      --key FF00FF --out <규격시트.png>
  python3 tools/import_sheet.py <입력.png> --frames 6 --cell 48 \
      --key FF00FF --out <규격시트.png> --split=even --align=perframe \
      --report <검수용.png>

동작:
  1. 키잉 — --key와의 색 거리가 --tolerance 이내인 픽셀을 알파 0으로 만든다.
     알파는 0 또는 255만 남긴다(이진화, 반투명 경계 없음). 남은 프린지(키
     컬러 기운이 남은 경계 픽셀)는 별도 침식 패스로 제거한다(REMOVE_FRINGE
     참고). 키 컬러가 아닌 배경(체크무늬 등)이 섞여 있으면 키잉 후 배경
     비율이 비정상적으로 낮게 나온다 — 그 경우 경고하고 중단한다.
  2. 분할 — 키잉된 알파의 가로 방향 빈 열(완전 투명한 열)을 갭으로 보고
     그 갭 사이 덩어리를 프레임으로 본다(균등 분할을 신뢰하지 않는다 —
     생성물의 포즈 간격이 균일하지 않기 때문). 검출된 덩어리 수가 --frames
     와 다르면 산출물을 만들지 않고 실패한다(종료코드 1) — 프레임 수가
     다른 시트가 조용히 나가면 EnemySprite.FRAMES와 어긋나 애니메이션이
     깨지기 때문이다. --split=even으로 균등 분할을 강제하거나, 사람이
     원인을 확인한 뒤 --force로 검출된 수 그대로 진행할 수 있다.
  3. 정렬 — 각 프레임의 알파 바운딩박스를 --cell 정사각 셀에 배치한다.
     가로는 콘텐츠 중심을 셀 중심에 맞추고, 세로는 --align 모드를 따른다.
     콘텐츠가 셀보다 크면 비율 유지한 채 NEAREST로 축소한다(업스케일 없음).
     상하좌우 최소 2px 여백이 안 나오면 경고한다.
  4. 출력 — RGBA PNG(가로 스트립, 정사각 셀)와, 원하면 셀 경계선을 그린
     검수용 이미지를 저장한다. 프레임별 바운딩박스·축소 배율·여백을
     콘솔에 출력한다.
"""
import argparse
import math
import os
import sys

from PIL import Image, ImageDraw

# 키 컬러와의 색 거리(유클리드, RGB 0~255 3채널이라 최대 약 441.7) 기준값.
# 기본 발주 배경은 순수 마젠타(255,0,255)이고 AI 산출물의 안티앨리어싱
# 경계는 마젠타와 배경 인접색이 섞인 중간톤이라, 40 정도면 또렷한 배경은
# 잡고 캐릭터 자체의 채도 높은 분홍/보라 계열은 웬만하면 건드리지 않는다.
# 실제 산출물에 따라 --tolerance로 조절한다.
DEFAULT_TOLERANCE = 40.0

# 프린지 제거 패스가 쓰는 두 번째(더 느슨한) 임계값. 이미 배경으로 판정된
# 픽셀에 인접한 픽셀에만 적용되므로(공간적으로 경계 근처로 한정), 임계값을
# 넓게 잡아도 캐릭터 안쪽 색까지 침식하지 않는다.
FRINGE_TOLERANCE_BONUS = 60.0
# 침식을 몇 번 반복할지 — 부드러운(여러 픽셀에 걸친) 경계를 한 패스로 다
# 못 잡는 경우를 대비한다. 너무 크면 얇은 실루엣(팔·무기 끝)을 깎아먹을
# 수 있어 작은 값으로 제한한다.
FRINGE_PASSES = 3

MIN_MARGIN = 2  # 셀 상하좌우 최소 여백(px). 발 기준선 여유(FEET_TOL)와도 맞춘다.
MIN_GAP_COLS = 1  # 이 이상 연속으로 완전 투명한 열이 있어야 갭으로 본다
MIN_BLOB_COLS = 2  # 이보다 좁은 덩어리는 노이즈로 보고 버린다(경고)


def parse_hex_color(s):
    s = s.strip().lstrip('#')
    if len(s) != 6:
        raise argparse.ArgumentTypeError(f'색상은 RRGGBB 6자리 16진수여야 함: {s!r}')
    try:
        return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        raise argparse.ArgumentTypeError(f'유효하지 않은 16진수 색상: {s!r}')


def color_dist(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def key_out(img, key, tolerance):
    """key와의 거리가 tolerance 이내인 픽셀을 알파 0으로 만든 RGBA 이미지를
    반환한다. 그 외 픽셀은 알파 255(원본 알파는 무시 — 입력은 알파가 없는
    RGB로 가정한다). 반환값과 함께 총 배경 픽셀 비율을 준다."""
    img = img.convert('RGB')
    w, h = img.size
    out = Image.new('RGBA', (w, h))
    src = img.load()
    dst = out.load()
    bg_count = 0
    for y in range(h):
        for x in range(w):
            rgb = src[x, y]
            if color_dist(rgb, key) <= tolerance:
                dst[x, y] = (0, 0, 0, 0)
                bg_count += 1
            else:
                dst[x, y] = (*rgb, 255)
    return out, bg_count / (w * h)


def remove_fringe(rgba, key, tolerance):
    """이미 배경(알파 0)으로 판정된 픽셀에 4-이웃으로 붙어 있고, key와의
    거리가 tolerance + FRINGE_TOLERANCE_BONUS 이내인 불투명 픽셀을 마저
    배경으로 편입시킨다. 공간적으로 기존 배경 경계에 닿은 픽셀만 대상으로
    하므로 느슨한 임계값을 써도 캐릭터 안쪽 색은 건드리지 않는다. 부드러운
    경계를 잡기 위해 여러 패스를 반복한다(패스마다 새로 배경이 된 픽셀의
    이웃이 다음 패스 대상이 된다)."""
    w, h = rgba.size
    px = rgba.load()
    fringe_tol = tolerance + FRINGE_TOLERANCE_BONUS
    removed_total = 0
    for _ in range(FRINGE_PASSES):
        bg_mask = [[px[x, y][3] == 0 for x in range(w)] for y in range(h)]
        to_clear = []
        for y in range(h):
            for x in range(w):
                if bg_mask[y][x]:
                    continue
                neighbors_bg = (
                    (x > 0 and bg_mask[y][x - 1])
                    or (x < w - 1 and bg_mask[y][x + 1])
                    or (y > 0 and bg_mask[y - 1][x])
                    or (y < h - 1 and bg_mask[y + 1][x])
                )
                if not neighbors_bg:
                    continue
                r, g, b, a = px[x, y]
                if color_dist((r, g, b), key) <= fringe_tol:
                    to_clear.append((x, y))
        if not to_clear:
            break
        for x, y in to_clear:
            px[x, y] = (0, 0, 0, 0)
        removed_total += len(to_clear)
    return removed_total


def find_blobs(rgba):
    """알파가 있는 열(컬럼)의 연속 구간을 찾아 [(x0, x1), ...]로 반환한다
    (x1은 포함). 완전 투명한 열은 갭으로 취급해 구간을 끊는다."""
    w, h = rgba.size
    px = rgba.load()
    col_has_content = []
    for x in range(w):
        has = any(px[x, y][3] > 0 for y in range(h))
        col_has_content.append(has)

    blobs = []
    start = None
    for x in range(w):
        if col_has_content[x]:
            if start is None:
                start = x
        else:
            if start is not None:
                blobs.append((start, x - 1))
                start = None
    if start is not None:
        blobs.append((start, w - 1))
    return blobs


def content_bbox(rgba, x0, x1):
    """[x0, x1] 열 범위 안에서 알파가 있는 픽셀의 바운딩박스
    (left, top, right, bottom, 전부 포함)를 반환한다. 없으면 None."""
    w, h = rgba.size
    px = rgba.load()
    left = top = right = bottom = None
    for y in range(h):
        for x in range(x0, x1 + 1):
            if px[x, y][3] > 0:
                if left is None or x < left:
                    left = x
                if right is None or x > right:
                    right = x
                if top is None or y < top:
                    top = y
                if bottom is None or y > bottom:
                    bottom = y
    if left is None:
        return None
    return left, top, right, bottom


def crop_content(rgba, bbox):
    left, top, right, bottom = bbox
    return rgba.crop((left, top, right + 1, bottom + 1))


def scale_to_fit(w, h, usable):
    """content가 usable x usable 정사각 영역에 들어가도록 하는 배율.
    이미 들어가면 1.0(업스케일 없음)."""
    if w <= usable and h <= usable:
        return 1.0
    return min(usable / w, usable / h)


def nearest_resize(img, factor):
    if factor >= 1.0:
        return img
    w, h = img.size
    new_w = max(1, round(w * factor))
    new_h = max(1, round(h * factor))
    return img.resize((new_w, new_h), Image.Resampling.NEAREST)


def build_sheet(frames_rgba, placements, cell):
    n = len(frames_rgba)
    sheet = Image.new('RGBA', (cell * n, cell), (0, 0, 0, 0))
    for i, (img, (px, py)) in enumerate(zip(frames_rgba, placements)):
        sheet.paste(img, (i * cell + px, py), img)
    return sheet


def make_report(sheet, cell):
    im = sheet.convert('RGBA').copy()
    draw = ImageDraw.Draw(im)
    n = im.width // cell
    for i in range(1, n):
        x = i * cell
        draw.line([(x, 0), (x, im.height - 1)], fill=(0, 255, 0, 255), width=1)
    draw.rectangle([0, 0, im.width - 1, im.height - 1], outline=(0, 255, 0, 255), width=1)
    return im


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input', help='입력 PNG (AI 생성 원본, 단색 배경)')
    ap.add_argument('--frames', type=int, required=True, help='기대하는 프레임 수(자동 분할 검증 기준, --split=even일 때는 등분 개수)')
    ap.add_argument('--cell', type=int, required=True, help='출력 셀 크기(정사각, px)')
    ap.add_argument('--key', type=parse_hex_color, required=True, help='배경 키 컬러 (RRGGBB, 예: FF00FF)')
    ap.add_argument('--tolerance', type=float, default=DEFAULT_TOLERANCE, help=f'키 컬러 거리 임계값 (기본 {DEFAULT_TOLERANCE})')
    ap.add_argument('--out', required=True, help='출력 규격 시트 PNG 경로')
    ap.add_argument('--split', choices=['auto', 'even'], default='auto', help='auto=갭 검출(기본), even=--frames로 균등 분할 강제')
    ap.add_argument('--force', action='store_true', help='auto 분할에서 검출된 덩어리 수가 --frames와 달라도 실패하지 않고 검출된 수 그대로 출력한다')
    ap.add_argument('--align', choices=['perframe', 'global'], default='global', help='perframe=프레임별 개별 하단 정렬, global=전체 최저점 기준 일괄 이동(기본)')
    ap.add_argument('--report', help='셀 경계선을 그린 검수용 이미지 경로(선택)')
    args = ap.parse_args()

    original = Image.open(args.input)
    w0, h0 = original.size

    # ── 1. 키잉 ──
    keyed, bg_ratio = key_out(original, args.key, args.tolerance)
    removed = remove_fringe(keyed, args.key, args.tolerance)
    print(f'키잉: 배경 비율 {bg_ratio * 100:.1f}% · 프린지 침식 {removed}px 추가 제거')

    # 배경이 순수 키 컬러가 아니면(체크무늬 등) 키잉 후에도 배경으로 잡히는
    # 비율이 비정상적으로 낮게 나온다 — 조용히 잘못 처리하지 않고 중단한다.
    BACKGROUND_MIN_RATIO = 0.15
    if bg_ratio < BACKGROUND_MIN_RATIO:
        key_hex = ''.join(f'{c:02X}' for c in args.key)
        print(
            f'오류: 배경 픽셀 비율이 {bg_ratio * 100:.1f}%로 비정상적으로 낮음 '
            f'(임계 {BACKGROUND_MIN_RATIO * 100:.0f}%) — 키 컬러({key_hex})가 '
            f'실제 배경과 다르거나, 배경이 체크무늬 등 단색이 아닐 수 있음. 중단.',
            file=sys.stderr,
        )
        sys.exit(1)

    # ── 2. 분할 ──
    if args.split == 'even':
        n = args.frames
        seg_w = w0 / n
        blobs = [(round(i * seg_w), round((i + 1) * seg_w) - 1) for i in range(n)]
        print(f'분할: --split=even 강제 — {n}등분 (프레임 폭 {seg_w:.1f}px)')
    else:
        raw_blobs = find_blobs(keyed)
        blobs = [(x0, x1) for x0, x1 in raw_blobs if x1 - x0 + 1 >= MIN_BLOB_COLS]
        dropped = len(raw_blobs) - len(blobs)
        if dropped:
            print(f'경고: 노이즈로 보이는 좁은 덩어리 {dropped}개를 버림(폭 < {MIN_BLOB_COLS}px)')
        print(f'분할: 갭 검출로 {len(blobs)}개 덩어리 발견 (기대 프레임 수 {args.frames})')
        if len(blobs) != args.frames:
            msg = (
                f'검출된 덩어리 수({len(blobs)})가 --frames({args.frames})와 다름 — '
                f'포즈가 겹쳐 붙었거나(개수 < frames) 캐릭터가 여러 조각으로 끊겨 보였을 수 있음'
                f'(개수 > frames). --split=even으로 강제하거나 --tolerance를 조정할 것.'
            )
            if args.force:
                print(f'경고: {msg} (--force로 그대로 진행)')
            else:
                # 프레임 수가 다른 시트를 그대로 내보내면 EnemySprite.FRAMES와
                # 어긋나 애니메이션이 깨진다 — measure_sprites.py가 잡을 때까지
                # 아무도 모르는 상태로 넘어가는 걸 막기 위해 산출물을 만들지
                # 않고 실패한다. --force가 있을 때만(사람이 원인을 확인하고
                # 의도적으로 허용할 때만) 예전처럼 진행한다.
                print(f'실패: {msg}', file=sys.stderr)
                sys.exit(1)
        if not blobs:
            print('오류: 프레임을 하나도 검출하지 못함 — 키 컬러/임계값을 확인할 것', file=sys.stderr)
            sys.exit(1)

    # ── 콘텐츠 바운딩박스 계산 ──
    bboxes = []
    for x0, x1 in blobs:
        bbox = content_bbox(keyed, x0, x1)
        if bbox is None:
            print(f'오류: 열 구간 [{x0},{x1}]에서 콘텐츠를 찾지 못함', file=sys.stderr)
            sys.exit(1)
        bboxes.append(bbox)

    usable = args.cell - 2 * MIN_MARGIN
    if usable <= 0:
        print(f'오류: --cell({args.cell})이 너무 작음(여백 {MIN_MARGIN}px x2 확보 불가)', file=sys.stderr)
        sys.exit(1)

    crops = [crop_content(keyed, b) for b in bboxes]
    content_sizes = [c.size for c in crops]

    if args.align == 'perframe':
        factors = [scale_to_fit(cw, ch, usable) for cw, ch in content_sizes]
        offsets_src = [0] * len(crops)
    else:
        # global: 프레임마다 다른 배율을 쓰면 상대적인 크기/높이 관계가
        # 깨진다 — 셀에 다 들어가도록 요구되는 배율 중 가장 작은 값(가장
        # 강하게 줄여야 하는 프레임 기준) 하나를 전체에 적용한다.
        #
        # 배율은 "정렬을 적용한 뒤"의 합성 바운딩박스 기준으로 정해야 한다.
        # 콘텐츠 원본 높이만 보고 배율을 정한 뒤 상승 오프셋을 나중에 더하면,
        # 오프셋만큼 위로 뜬 프레임이 셀 위쪽 여백을 침범할 수 있다(예: 무기를
        # 머리 위로 든 프레임 — 원본 높이만으로는 셀에 딱 맞아도, 정렬
        # 오프셋을 더하면 넘친다). 그래서 세로는 "콘텐츠 높이 + 전역 기준선
        # 대비 오프셋"을 하나의 값으로 보고 배율을 정한다.
        global_bottom_src = max(b[3] for b in bboxes)  # bbox = (left, top, right, bottom)
        offsets_src = [global_bottom_src - b[3] for b in bboxes]
        shared = min(
            scale_to_fit(cw, ch + off, usable)
            for (cw, ch), off in zip(content_sizes, offsets_src)
        )
        factors = [shared] * len(crops)

    scaled = [nearest_resize(img, f) for img, f in zip(crops, factors)]

    placements = []
    if args.align == 'perframe':
        for img in scaled:
            cw, ch = img.size
            px = (args.cell - cw) // 2
            # 발이 셀 바닥에 닿도록 — 바닥에서 MIN_MARGIN만큼만 띄운다
            # (measure_sprites.py의 FEET_TOL과 맞춘 값이라 이 정렬이
            # "발 기준선" 검사를 통과한다).
            py = args.cell - MIN_MARGIN - ch
            placements.append((px, py))
    else:
        # 소스 이미지 좌표계 기준으로 "가장 아래(=y가 가장 큰) 콘텐츠 하단"을
        # 전역 기준선으로 잡는다. 모든 프레임을 이 기준에 대해 같은 규칙으로
        # 배치하면(각자 다른 하단이 아니라) 점프처럼 하단이 원래 더 높이
        # 떠 있던 프레임은 셀 안에서도 그만큼 위로 떠서, 상대적인 높이차가
        # 그대로 보존된다.
        for img, factor, offset_src in zip(scaled, factors, offsets_src):
            cw, ch = img.size
            px = (args.cell - cw) // 2
            offset_scaled = round(offset_src * factor)
            py = args.cell - MIN_MARGIN - ch - offset_scaled
            placements.append((px, py))

    # ── 여백 확인 + 콘솔 리포트 ──
    print(f'\n정렬: --align={args.align} · 셀 {args.cell}x{args.cell} · 프레임 {len(crops)}개')
    print(f'{"frame":>5} {"content(w x h)":>16} {"scale":>6} {"pos(x,y)":>10} {"margins(l,t,r,b)":>18}')
    for i, ((px, py), img) in enumerate(zip(placements, scaled)):
        cw, ch = img.size
        margin_l = px
        margin_t = py
        margin_r = args.cell - (px + cw)
        margin_b = args.cell - (py + ch)
        margins = (margin_l, margin_t, margin_r, margin_b)
        print(f'{i:>5} {f"{cw}x{ch}":>16} {factors[i]:>6.3f} {f"({px},{py})":>10} {str(margins):>18}')
        if min(margins) < MIN_MARGIN or px < 0 or py < 0 or px + cw > args.cell or py + ch > args.cell:
            print(f'  경고: 프레임 {i} 여백이 최소 {MIN_MARGIN}px 미만이거나 셀을 벗어남 — margins={margins}')

    sheet = build_sheet(scaled, placements, args.cell)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or '.', exist_ok=True)
    sheet.save(args.out)
    print(f'\n출력: {args.out} ({sheet.width}x{sheet.height}, 셀 {args.cell}, 프레임 {len(crops)})')

    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or '.', exist_ok=True)
        report_img = make_report(sheet, args.cell)
        report_img.save(args.report)
        print(f'검수 이미지: {args.report}')


if __name__ == '__main__':
    main()
