#!/usr/bin/env python3
"""에셋 무결성 검사기 — 사람 눈이 아니라 스크립트로 판정 가능한 것들.

코드가 선언한 값(FRAMES, ASPECT, ASSET 경로)과 실제 PNG 파일이 어긋나면
타입 체크도 npm run build 도 잡지 못한다. 이 스크립트가 그 틈을 잡는다.
FRAMES/ASPECT/경로는 소스(EnemySprite.ts / Interactable.ts / assets.ts)에서
직접 파싱한다 — 이 스크립트 안에 값을 복제해두면 소스가 바뀌어도 여기는
그대로라 거짓 통과가 나온다 (AGENTS.md가 경고하는 "갈라짐"과 같은 문제).

검사 항목:
  1. 몬스터 시트: 가로 스트립 정사각 셀, FRAMES 프레임 수, 발이 셀 바닥에 닿음,
     대기/공격 캐릭터 크기가 걷기 기준과 크게 다르지 않음
  2. assets.ts 가 참조하는 모든 경로가 실제로 존재
  3. Interactable.ts 의 ASPECT 값이 실제 PNG 가로/세로 비율과 일치
  4. 배경이어야 하는 타일을 제외한 모든 스프라이트/프롭의 네 모서리가
     완전 투명(alpha=0에 가까움) — 검은 후광 사전 차단
  5. public/assets 전체를 훑어 src/ 어디에서도 참조되지 않는 파일(고아 에셋) —
     이건 경고만 남긴다(실패 아님). 의도적으로 보관 중인 미연결 장식 프롭이
     있어 단순 "미참조 = 삭제 대상"으로 볼 수 없다 — DESIGN_LOG.md D1 참고.

사용법:
  python3 tools/measure_sprites.py
  종료코드 0 = 통과, 1 = 위반 있음
"""
import os
import re
import sys
from statistics import median
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
SRC = os.path.join(ROOT, 'src')

ENEMY_SPRITE_TS = os.path.join(SRC, 'entities', 'EnemySprite.ts')
ASSETS_TS = os.path.join(SRC, 'rendering', 'assets.ts')
INTERACTABLE_TS = os.path.join(SRC, 'entities', 'Interactable.ts')

FEET_TOL = 2  # 발 위치 허용오차(px) — 1~2px 차이는 눈에 보이지 않는다
ALPHA_TOL = 10  # 모서리 알파 허용치 — 완전 0이 아니어도 이 이하면 통과

errors = []
warnings = []


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


# ── 소스 파싱 ────────────────────────────────────────────────────────────

def parse_frames(src):
    """EnemySprite.ts 의 FRAMES 테이블: kind -> {state: count}"""
    m = re.search(r'const FRAMES[^=]*=\s*\{(.*?)\n\}', src, re.DOTALL)
    if not m:
        errors.append('EnemySprite.ts: FRAMES 테이블을 찾지 못함')
        return {}
    out = {}
    for line in m.group(1).splitlines():
        lm = re.match(r"\s*(\w+):\s*\{\s*idle:\s*(\d+),\s*walk:\s*(\d+),\s*attack:\s*(\d+)\s*\}", line)
        if lm:
            kind, idle, walk, attack = lm.groups()
            out[kind] = {'idle': int(idle), 'walk': int(walk), 'attack': int(attack)}
    return out


def parse_monster_paths(src):
    """assets.ts 의 ASSET.monsters 테이블: kind -> {state: path}"""
    m = re.search(r'monsters:\s*\{(.*?)\n  \},\n  stage1:', src, re.DOTALL)
    if not m:
        errors.append('assets.ts: ASSET.monsters 테이블을 찾지 못함')
        return {}
    out = {}
    block = m.group(1)
    for km in re.finditer(r"(\w+):\s*\{\s*idle:\s*'([^']+)',\s*walk:\s*'([^']+)',\s*attack:\s*'([^']+)',?\s*\}", block):
        kind, idle, walk, attack = km.groups()
        out[kind] = {'idle': idle, 'walk': walk, 'attack': attack}
    return out


def parse_all_asset_paths(src):
    """assets.ts 전체에서 참조하는 모든 'assets/...' 경로 문자열"""
    return sorted(set(re.findall(r"'(assets/[^']+)'", src)))


def parse_aspect(src):
    m = re.search(r'const ASPECT[^=]*=\s*\{(.*?)\n\}', src, re.DOTALL)
    if not m:
        errors.append('Interactable.ts: ASPECT 테이블을 찾지 못함')
        return {}
    out = {}
    for lm in re.finditer(r"(\w+):\s*([\d.]+)\s*/\s*([\d.]+),", m.group(1)):
        kind, a, b = lm.groups()
        out[kind] = float(a) / float(b)
    return out


def parse_texfn(src):
    """kind -> 텍스처 함수명 (TEXFN 테이블)"""
    # 타입 주석에 "() => THREE.Texture" 처럼 "=>"가 들어있어 [^=]* 로는
    # 엉뚱한 "="에서 멈춘다 — "{" 가 나올 때까지로 잡는다.
    m = re.search(r'const TEXFN[^{]*=\s*\{(.*?)\n\}', src, re.DOTALL)
    if not m:
        errors.append('Interactable.ts: TEXFN 테이블을 찾지 못함')
        return {}
    return dict(re.findall(r"(\w+):\s*(\w+),", m.group(1)))


def parse_tex_defs(src):
    """텍스처 함수명 -> ASSET.props 키 (초기 텍스처 기준, 예: chestClosedTex -> chestClosed)"""
    return dict(re.findall(r"const (\w+) = \(\) => loadTex\(ASSET\.props\.(\w+)\)", src))


def parse_props_paths(src):
    m = re.search(r'props:\s*\{(.*?)\n  \},\n  fx:', src, re.DOTALL)
    if not m:
        errors.append('assets.ts: ASSET.props 테이블을 찾지 못함')
        return {}
    return dict(re.findall(r"(\w+):\s*'([^']+)',", m.group(1)))


# ── 이미지 측정 ──────────────────────────────────────────────────────────

def measure_sheet(path):
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


def corner_alpha_ok(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    px = im.load()
    bad = [c for c in corners if px[c][3] > ALPHA_TOL]
    return bad


# ── 1. 몬스터 시트 규격 ──────────────────────────────────────────────────

def check_monster_sheets():
    frames = parse_frames(read(ENEMY_SPRITE_TS))
    paths = parse_monster_paths(read(ASSETS_TS))
    kinds = sorted(set(frames) | set(paths))
    if set(frames) != set(paths):
        errors.append(f'EnemySprite.ts FRAMES 키 {sorted(frames)} 와 '
                       f'assets.ts ASSET.monsters 키 {sorted(paths)} 가 다름')

    print(f'{"kind":9} {"state":7} {"size":>10} {"cell":>5} {"frames":>7} {"bodyH(med)":>11} {"ratio":>6}')
    print('-' * 64)
    for kind in kinds:
        want = frames.get(kind)
        rel = paths.get(kind)
        if not want or not rel:
            continue
        got = {}
        for state in ('idle', 'walk', 'attack'):
            full = os.path.join(PUBLIC, rel[state])
            if not os.path.exists(full):
                errors.append(f'{rel[state]}: 파일 없음')
                continue
            got[state] = measure_sheet(full)
            bad = corner_alpha_ok(full)
            if bad:
                errors.append(f'{rel[state]}: 모서리 픽셀이 불투명함 {bad} — 검은 후광 위험')

        if 'walk' not in got:
            continue
        wm = got['walk']
        ref = (median(wm['heights']) / wm['cell']) if wm['heights'] else 0

        for state in ('idle', 'walk', 'attack'):
            if state not in got:
                continue
            m = got[state]
            name = rel[state]
            bh = median(m['heights']) if m['heights'] else 0
            ratio = (bh / m['cell']) / ref if ref else float('nan')
            print(f'{kind:9} {state:7} {m["w"]}x{m["h"]:<5} {m["cell"]:>5} '
                  f'{m["frames"]:>7} {bh:>11.0f} {ratio:>6.2f}')

            if m['w'] % m['cell']:
                errors.append(f'{name}: 가로 {m["w"]} 가 셀(정사각) {m["cell"]} 의 배수가 아님')
            if m['frames'] != want[state]:
                errors.append(f'{name}: 프레임 {m["frames"]}개 (FRAMES 선언 {want[state]}개)')
            bad_feet = [(i, f) for i, f in enumerate(m['feet']) if m['cell'] - 1 - f > FEET_TOL]
            if bad_feet:
                errors.append(f'{name}: 발이 셀 바닥에서 뜬 프레임 {[i for i, _ in bad_feet]} '
                              f'(발y={[f for _, f in bad_feet]}, 기대 {m["cell"] - 1})')
            if state == 'idle' and not (0.85 <= ratio <= 1.2):
                errors.append(f'{name}: 대기 캐릭터 크기가 걷기의 {ratio:.2f}배 (0.85~1.2 이어야 함)')
            if state == 'attack' and not (0.5 <= ratio <= 1.2):
                warnings.append(f'{name}: 공격 캐릭터 크기가 걷기의 {ratio:.2f}배 — 자세 때문인지 확인')
        print()


# ── 2. assets.ts 경로 실존 ───────────────────────────────────────────────

TILE_PREFIXES = ('assets/tiles/', 'assets/stage1/stage1_background/')  # 배경은 불투명이 정상 — 모서리 알파 검사 제외


def check_all_paths_exist():
    all_paths = parse_all_asset_paths(read(ASSETS_TS))
    for rel in all_paths:
        full = os.path.join(PUBLIC, rel)
        if not os.path.exists(full):
            errors.append(f'assets.ts 가 참조하는 파일이 없음: {rel}')
            continue
        if rel.startswith(TILE_PREFIXES):
            continue
        bad = corner_alpha_ok(full)
        if bad:
            errors.append(f'{rel}: 모서리 픽셀이 불투명함 {bad} — 검은 후광 위험')
    print(f'assets.ts 참조 경로 {len(all_paths)}개 실존/모서리 알파 검사 완료')


# ── 3. Interactable ASPECT vs 실제 비율 ─────────────────────────────────

def check_prop_aspect():
    inter_src = read(INTERACTABLE_TS)
    assets_src = read(ASSETS_TS)
    aspect = parse_aspect(inter_src)
    texfn = parse_texfn(inter_src)
    tex_defs = parse_tex_defs(inter_src)
    props_paths = parse_props_paths(assets_src)

    for kind, declared in aspect.items():
        func = texfn.get(kind)
        props_key = tex_defs.get(func) if func else None
        rel = props_paths.get(props_key) if props_key else None
        if not rel:
            warnings.append(f'{kind}: ASPECT는 있으나 텍스처 경로를 못 찾음 (수동 확인 필요)')
            continue
        full = os.path.join(PUBLIC, rel)
        if not os.path.exists(full):
            errors.append(f'{kind}: {rel} 파일 없음')
            continue
        im = Image.open(full)
        w, h = im.size
        actual = w / h
        if abs(actual - declared) / declared > 0.02:
            errors.append(f'{kind}: Interactable.ts ASPECT 선언값 {declared:.3f} 와 '
                          f'실제 {rel} 비율 {actual:.3f} ({w}x{h}) 불일치 — 렌더 시 비율이 눌리거나 늘어남')
    print(f'Interactable ASPECT {len(aspect)}건 대조 완료')


# ── 5. 고아 에셋(public/assets 전체 vs src/ 참조) — 경고만, 실패 아님 ──────

ASSET_EXTS = ('.png', '.jpg', '.jpeg', '.ogg', '.mp3', '.wav')


def check_orphan_assets():
    all_files = []
    for dirpath, _, filenames in os.walk(os.path.join(PUBLIC, 'assets')):
        for fn in filenames:
            if fn.lower().endswith(ASSET_EXTS):
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, PUBLIC).replace(os.sep, '/')
                all_files.append(rel)

    src_text = ''
    for dirpath, _, filenames in os.walk(SRC):
        for fn in filenames:
            if fn.endswith('.ts'):
                src_text += read(os.path.join(dirpath, fn))

    orphans = sorted(f for f in all_files if f not in src_text)
    if orphans:
        total_kb = sum(os.path.getsize(os.path.join(PUBLIC, f)) for f in orphans) / 1024
        for f in orphans:
            warnings.append(f'미사용 에셋(고아 파일): {f}')
        print(f'고아 에셋 {len(orphans)}개, {total_kb:.1f}KB - 경고 처리(DESIGN_LOG.md D1 참고)')
    else:
        print('고아 에셋 없음')


# ── 실행 ─────────────────────────────────────────────────────────────────

check_monster_sheets()
check_all_paths_exist()
check_prop_aspect()
check_orphan_assets()

for w in warnings:
    print(f'경고: {w}')
for e in errors:
    print(f'위반: {e}')
print(f'\n{"통과" if not errors else f"위반 {len(errors)}건"}')
sys.exit(1 if errors else 0)
