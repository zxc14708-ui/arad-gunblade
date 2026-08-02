#!/usr/bin/env python3
"""마스터(32색 인덱스 PNG)에서 스테이지/보스 팔레트 변형을 생성한다 — 팔레트
리컬러 파이프라인 2단계(작업 지시 P0_prompt_palette_pipeline).

픽셀 인덱스 배열은 절대 건드리지 않는다 — 마스터의 팔레트 테이블만 교체해서
저장한다. 그래서 변형본의 인덱스 배열은 마스터와 항상 완전히 같다(실루엣·
프레임 정합이 구조적으로 보장된다 — measure_sprites.py의 인덱스 일치 검사가
이걸 확인한다).

사용법:
  python3 tools/recolor_sheet.py <마스터.png> --map <변형팔레트.json> --out <변형.png>
  python3 tools/recolor_sheet.py --all      # manifest.json 전체 재생성

디렉터리 구조(권장, 강제 아님):
  public/assets/monsters/
    <archetype>/
      master/  <sheet>.png  <sheet>.palette.json  (quantize_sheet.py 산출물 —
               팔레트 JSON은 시트 옆에 "<시트 파일명(확장자 제외)>.palette.json"
               이름으로 둔다. 이 스크립트가 마스터 PNG 경로에서 그 이름을
               유도한다)
      <variant>/  <sheet>.png  (이 스크립트 산출물 — 직접 편집 금지, 디렉터리에
                  마커 파일을 남긴다)
    palettes/  <variant>.json
    manifest.json

변형 팔레트 JSON:
  { "name": "swamp", "base_slots": { "skin_hi": [r,g,b], ... } }
  슬롯 이름으로 색을 지정한다(인덱스 직접 지정이 아님) — 마스터를 다시
  양자화해 인덱스 배치가 바뀌어도 변형 정의가 살아남는다. 마스터
  palette.json의 slots(인덱스 문자열 -> 이름)로 이름→인덱스를 역매핑해 찾는다.
  지정 안 된 슬롯은 마스터 색을 그대로 쓴다.

manifest.json:
  { "archetypes": [ { "name": "melee_goblin", "sheets": ["idle_4f.png", ...],
                       "variants": ["swamp", "frost"] }, ... ] }
  --all은 이걸 읽어 모든 마스터 × 변형 조합을 재생성한다. 마스터가 갱신되면
  이 명령 한 번으로 전 변형이 따라온다.

결정성: 순수한 팔레트 테이블 치환이라 무작위 요소가 없다 — 같은 입력엔
항상 같은 바이트가 나온다(measure_sprites.py의 재생성 일치 검사가 이걸
확인한다).
"""
import argparse
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONSTERS_DIR = os.path.join(ROOT, 'public', 'assets', 'monsters')
MANIFEST_PATH = os.path.join(MONSTERS_DIR, 'manifest.json')
PALETTES_DIR = os.path.join(MONSTERS_DIR, 'palettes')
GENERATED_MARKER = '_GENERATED_DO_NOT_EDIT.txt'
GENERATED_NOTICE = (
    '이 디렉터리는 recolor_sheet.py --all 로 자동 생성됩니다.\n'
    '직접 편집하지 마세요 — 다음 재생성 때 덮어써집니다.\n'
    '색을 바꾸려면 public/assets/monsters/palettes/ 의 변형 팔레트 JSON을 고치세요.\n'
)


def master_palette_path(master_png_path):
    """마스터 PNG 옆의 팔레트 JSON 경로 — "<시트명(확장자 제외)>.palette.json"."""
    base, _ = os.path.splitext(master_png_path)
    return base + '.palette.json'


def load_master_palette(master_png_path):
    path = master_palette_path(master_png_path)
    if not os.path.exists(path):
        raise FileNotFoundError(
            f'{master_png_path} 옆에 팔레트 JSON이 없음(찾은 경로: {path}) — '
            f'quantize_sheet.py --palette 로 이 이름에 맞춰 생성할 것'
        )
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def apply_variant(master_png_path, variant_map, out_path):
    img = Image.open(master_png_path)
    if img.mode != 'P':
        raise ValueError(f'{master_png_path}: 모드 P가 아님(팔레트 리컬러 대상이 아니다)')
    master_pal_doc = load_master_palette(master_png_path)
    slots = master_pal_doc.get('slots', {})
    name_to_index = {name: int(idx) for idx, name in slots.items()}

    palette = img.getpalette()  # flat [r,g,b,r,g,b,...]
    new_palette = list(palette)
    for slot_name, rgb in variant_map.get('base_slots', {}).items():
        if slot_name not in name_to_index:
            raise ValueError(
                f'{master_png_path}: 마스터 palette.json에 슬롯 "{slot_name}"이 없음 '
                f'(정의된 슬롯: {sorted(name_to_index)})'
            )
        idx = name_to_index[slot_name]
        new_palette[idx * 3:idx * 3 + 3] = list(rgb)

    out_img = img.copy()
    out_img.putpalette(new_palette)
    transparency = img.info.get('transparency')
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or '.', exist_ok=True)
    if transparency is not None:
        out_img.save(out_path, transparency=transparency)
    else:
        out_img.save(out_path)
    return out_img


def write_generated_marker(dirpath):
    os.makedirs(dirpath, exist_ok=True)
    with open(os.path.join(dirpath, GENERATED_MARKER), 'w', encoding='utf-8') as f:
        f.write(GENERATED_NOTICE)


def run_all():
    if not os.path.exists(MANIFEST_PATH):
        print(f'매니페스트 없음: {MANIFEST_PATH}')
        return 0
    with open(MANIFEST_PATH, encoding='utf-8') as f:
        manifest = json.load(f)
    archetypes = manifest.get('archetypes', [])
    if not archetypes:
        print('매니페스트에 아키타입이 없음 — 재생성할 것이 없음')
        return 0
    total = 0
    for arche in archetypes:
        name = arche['name']
        sheets = arche.get('sheets', [])
        variants = arche.get('variants', [])
        arche_dir = os.path.join(MONSTERS_DIR, name)
        master_dir = os.path.join(arche_dir, 'master')
        for variant_name in variants:
            variant_palette_path = os.path.join(PALETTES_DIR, f'{variant_name}.json')
            with open(variant_palette_path, encoding='utf-8') as f:
                variant_map = json.load(f)
            variant_dir = os.path.join(arche_dir, variant_name)
            write_generated_marker(variant_dir)
            for sheet in sheets:
                master_png = os.path.join(master_dir, sheet)
                out_png = os.path.join(variant_dir, sheet)
                apply_variant(master_png, variant_map, out_png)
                total += 1
                print(f'{name}/{variant_name}/{sheet} 재생성')
    print(f'총 {total}개 파일 재생성')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('master', nargs='?', help='마스터 PNG(모드 P) — --all과 함께 쓸 수 없음')
    ap.add_argument('--map', help='변형 팔레트 JSON')
    ap.add_argument('--out', help='출력 변형 PNG 경로')
    ap.add_argument('--all', action='store_true', help='manifest.json 전체 재생성')
    args = ap.parse_args()

    if args.all:
        if args.master or args.map or args.out:
            ap.error('--all은 master/--map/--out과 함께 쓸 수 없음')
        return run_all()

    if not (args.master and args.map and args.out):
        ap.error('단일 변환에는 master, --map, --out이 모두 필요함(또는 --all 단독)')

    with open(args.map, encoding='utf-8') as f:
        variant_map = json.load(f)
    apply_variant(args.master, variant_map, args.out)
    write_generated_marker(os.path.dirname(os.path.abspath(args.out)) or '.')
    print(f'리컬러 완료: {args.master} + {args.map} -> {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
