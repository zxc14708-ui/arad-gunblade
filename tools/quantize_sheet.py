#!/usr/bin/env python3
"""AI 생성 몬스터 스프라이트 PNG를 마스터 규격(32색 인덱스 PNG, 인덱스 0=투명)
으로 변환한다 — 팔레트 리컬러 파이프라인 1단계(작업 지시 P0_prompt_palette_pipeline).

지금 자산은 픽셀 아트처럼 보여도 그라디언트·디더링이 섞여 있어 부위별 색
교체가 불가능하다(실측: melee_goblin_idle_4f.png 3,614색). 이 스크립트가
그 자산을 32색 인덱스 PNG로 눌러, 이후 recolor_sheet.py가 "팔레트 테이블만
교체 = 픽셀 인덱스 배열은 그대로"인 안전한 리컬러를 할 수 있게 만든다.

사용법:
  python3 tools/quantize_sheet.py <입력.png> --out <마스터.png> --palette <팔레트.json>
  python3 tools/quantize_sheet.py <입력.png> --out <마스터.png> --palette <팔레트.json> --report <비교.png>

동작:
  1. 알파를 128 임계로 이진화(0 또는 255)한다 — 먼저 해야 반투명 경계의
     오염된 색이 양자화 팔레트를 잡아먹지 않는다.
  2. 불투명 픽셀만 대상으로 31색으로 양자화한다(인덱스 0은 투명 전용이라
     32 - 1 = 31). PIL의 MEDIANCUT을 kmeans=0·디더링 없이 쓴다 — 둘 다
     끄면 순수 기하 버킷팅이라 같은 입력엔 항상 같은 출력이 나온다(난수
     없음, 시드가 필요 없다). 디더링을 켜면 색이 더 섞여 나와 "부위별로
     같은 인덱스" 전제 자체가 깨진다.
  3. 결과를 모드 P, 인덱스 0=투명인 PNG로 저장한다.
  4. 팔레트 JSON을 같이 출력한다. colors는 32칸(0=투명, 1..N=밝기순 정렬된
     양자화 색, 못 채운 칸은 null)이고 slots는 빈 채로 둔다 — 어느 색이
     피부고 어느 색이 의복인지는 기계가 판단할 수 없고, 잘못 붙이면 조용히
     틀린 리컬러가 나온다. 대신 밝기순 색 목록과 픽셀 점유율을 콘솔에 찍어
     사람이 slots를 채울 때 참고하게 한다.
"""
import argparse
import json
import os
import sys

from PIL import Image

ALPHA_THRESHOLD = 128
MAX_COLORS = 31  # 인덱스 0은 투명 전용이라 32 - 1


def binarize_alpha(img):
    """알파를 0/255로 이진화한 RGBA 이미지를 반환한다. 원본은 건드리지 않는다."""
    img = img.convert('RGBA')
    out = Image.new('RGBA', img.size)
    src = img.load()
    dst = out.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            dst[x, y] = (r, g, b, 255) if a >= ALPHA_THRESHOLD else (0, 0, 0, 0)
    return out


def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def quantize(binarized):
    """이진화된 이미지의 불투명 픽셀만 최대 MAX_COLORS색으로 양자화한다.
    반환: (최종 P모드 이미지(인덱스 0=투명, 1..N=밝기순 정렬된 색), colors[[r,g,b],...],
           occupancy{색idx(1부터): 픽셀 수})
    """
    w, h = binarized.size
    src = binarized.load()

    opaque_rgb = Image.new('RGB', (w, h))
    mask = Image.new('L', (w, h), 0)
    opaque_px = opaque_rgb.load()
    mask_px = mask.load()
    opaque_count = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a > 0:
                opaque_px[x, y] = (r, g, b)
                mask_px[x, y] = 255
                opaque_count += 1

    if opaque_count == 0:
        raise ValueError('불투명 픽셀이 없음 — 입력 이미지를 확인할 것')

    quantized = opaque_rgb.quantize(
        colors=MAX_COLORS,
        method=Image.Quantize.MEDIANCUT,
        kmeans=0,
        dither=Image.Dither.NONE,
    )
    q_palette = quantized.getpalette()
    q_px = quantized.load()
    counts = quantized.getcolors(maxcolors=w * h) or []  # [(count, q_idx), ...]
    used_q_indices = [idx for _, idx in counts]
    q_colors = {idx: tuple(q_palette[idx * 3:idx * 3 + 3]) for idx in used_q_indices}

    # 밝기순 정렬 — 어두운 색(외곽선류)이 낮은 인덱스, 밝은 색이 높은 인덱스에
    # 오도록. 사람이 slots를 채울 때 훑기 쉬운 순서다.
    sorted_q_indices = sorted(used_q_indices, key=lambda i: luminance(q_colors[i]))
    remap = {q_idx: final_idx + 1 for final_idx, q_idx in enumerate(sorted_q_indices)}  # 1부터(0=투명)
    colors = [q_colors[q_idx] for q_idx in sorted_q_indices]

    final_img = Image.new('P', (w, h))
    pal = [0, 0, 0]  # 인덱스 0 = 투명(RGB는 의미 없음, transparency로 표시)
    for c in colors:
        pal.extend(c)
    pal.extend([0, 0, 0] * (256 - len(pal) // 3))
    final_img.putpalette(pal)

    final_px = final_img.load()
    occupancy = {}
    for y in range(h):
        for x in range(w):
            if mask_px[x, y] == 0:
                final_px[x, y] = 0
            else:
                final_idx = remap[q_px[x, y]]
                final_px[x, y] = final_idx
                occupancy[final_idx] = occupancy.get(final_idx, 0) + 1

    return final_img, colors, occupancy, opaque_count


def make_report(original, quantized_rgba, out_path):
    """좌: 원본, 우: 양자화 결과 — 육안 검수용 비교 이미지."""
    w, h = original.size
    gap = max(4, w // 20)
    canvas = Image.new('RGBA', (w * 2 + gap, h), (30, 30, 30, 255))
    canvas.paste(original.convert('RGBA'), (0, 0))
    canvas.paste(quantized_rgba, (w + gap, 0))
    canvas.save(out_path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input', help='입력 PNG (AI 생성 원본)')
    ap.add_argument('--out', required=True, help='출력 마스터 PNG 경로(모드 P, 32색 이하)')
    ap.add_argument('--palette', required=True, help='출력 팔레트 JSON 경로')
    ap.add_argument('--report', help='원본/양자화 비교 이미지 경로(선택)')
    args = ap.parse_args()

    original = Image.open(args.input)
    binarized = binarize_alpha(original)
    final_img, colors, occupancy, opaque_count = quantize(binarized)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or '.', exist_ok=True)
    final_img.save(args.out, transparency=0)

    colors_padded = [[0, 0, 0]] + [list(c) for c in colors] + [None] * (MAX_COLORS - len(colors))
    palette_doc = {
        'source': os.path.basename(args.input),
        'colors': colors_padded,
        'slots': {},
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.palette)) or '.', exist_ok=True)
    with open(args.palette, 'w', encoding='utf-8') as f:
        json.dump(palette_doc, f, ensure_ascii=False, indent=2)
        f.write('\n')

    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or '.', exist_ok=True)
        make_report(original, final_img.convert('RGBA'), args.report)

    print(f'양자화 완료: {args.input} -> {args.out}')
    print(f'색 수: {len(colors)} / {MAX_COLORS} (인덱스 0=투명 별도)')
    if len(colors) < MAX_COLORS:
        print(f'  참고: {MAX_COLORS - len(colors)}개 인덱스가 비어 있음(원본 색 수가 {MAX_COLORS}보다 적음)')
    print('밝기순 색 목록(인덱스: RGB, 픽셀 점유율):')
    for i, c in enumerate(colors, start=1):
        pct = occupancy.get(i, 0) / opaque_count * 100
        print(f'  {i:2d}: rgb{tuple(c)}  {pct:5.1f}%')
    print(f'팔레트 JSON: {args.palette} (slots는 비어 있음 — 사람이 채울 것)')
    if args.report:
        print(f'비교 이미지: {args.report}')


if __name__ == '__main__':
    sys.exit(main())
