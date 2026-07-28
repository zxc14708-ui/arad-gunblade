import * as THREE from 'three'

/**
 * 2D 주인공 빌보드 — SD 총검사 아트 시트 3장(base+sword+gun 레이어) 합성 사용.
 *
 * 아트 시트: 112x64 셀 × 27프레임 스트립 (오른쪽 기준), 세 장이 프레임 그리드를 공유한다.
 *   - `gunblader_base.png`: 몸(무기 없음)
 *   - `gunblader_sword_katana.png`: 카타나만(등에 거치 or 휘두르는 자세), 나머지 투명
 *   - `gunblader_gun_m1911.png`: M1911만(허리에 거치 or 조준 자세), 나머지 투명
 *   전 프레임에 검/총이 항상 그려져 있다(평소엔 거치, 해당 공격 애니메이션 중엔 사용 자세) —
 *   그래서 base → sword → gun 순서로 그냥 겹쳐 그리면 모든 프레임에서 올바르게 합성된다.
 *   셀 폭은 카타나가 몸통 왼쪽으로 길게 뻗는 것을 담기 위한 값 — 캐릭터는 셀 중앙,
 *   발끝이 셀 바닥에 오도록 정렬되어 있다.
 *   대기 0-3 / 걷기 4-10 / 검 공격 11-18 / 총 공격 19-26
 * 로드 실패 시(또는 로드 전) 절차 생성 픽셀 시트(9프레임)로 폴백.
 * 절차 시트는 무기별 드로잉을 지원하므로 폴백 상태에선 무기 교체가 반영된다.
 * (아트 시트는 카타나/M1911 고정 — 다른 무기 장착 시에도 외형은 바뀌지 않는다.)
 */
interface SheetSpec {
  n: number
  aspect: number // 셀 가로/세로
  anim: Record<'idle' | 'walk' | 'attack' | 'shoot', number[]>
  fps: { idle: number; walk: number; dash: number; attack: number; shoot: number }
}

const FW = 48
const FH = 56
const PROC_SPEC: SheetSpec = {
  n: 9,
  aspect: FW / FH,
  anim: { idle: [0], walk: [1, 2, 3, 4], attack: [5, 6], shoot: [7, 8] },
  fps: { idle: 2, walk: 9, dash: 15, attack: 10, shoot: 12 },
}
const ART_SPEC: SheetSpec = {
  n: 27,
  aspect: 112 / 64,
  anim: {
    idle: [0, 1, 2, 3],
    walk: [4, 5, 6, 7, 8, 9, 10],
    attack: [11, 12, 13, 14, 15, 16, 17, 18],
    shoot: [19, 20, 21, 22, 23, 24, 25, 26],
  },
  fps: { idle: 5, walk: 14, dash: 20, attack: 26, shoot: 26 },
}

export class CharacterSprite {
  /** 커스텀 아트 시트 레이어 경로 (null이면 절차 생성만 사용) */
  static SHEET_LAYERS: { base: string; sword: string; gun: string } | null = {
    base: 'gunblader_base.png',
    sword: 'gunblader_sword_katana.png',
    gun: 'gunblader_gun_m1911.png',
  }

  object = new THREE.Group()
  private sprite: THREE.Sprite
  private mat: THREE.SpriteMaterial
  private shadow: THREE.Mesh
  private readonly baseH = 3.7
  private spec: SheetSpec = PROC_SPEC
  private artActive = false
  private animTime = 0
  private flip = 1
  private lastState = ''
  private gunId: string
  private swordId: string

  constructor(gunId = 'm1911', swordId = 'katana') {
    this.gunId = gunId
    this.swordId = swordId

    // 우선 절차 시트로 시작 (즉시 표시)
    const tex = makeTexture(makeSheet(gunId, swordId))
    tex.repeat.set(1 / this.spec.n, 1)
    this.mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    this.sprite = new THREE.Sprite(this.mat)
    this.sprite.center.set(0.5, 0)
    this.applyScale()
    this.object.add(this.sprite)

    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    shadowMat.userData.outlineParameters = { visible: false }
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.02
    this.shadow.scale.set(1, 0.55, 1)
    this.object.add(this.shadow)

    // 아트 시트 3장(base+sword+gun) 비동기 로드 → 캔버스에 합성 후 교체
    if (CharacterSprite.SHEET_LAYERS) {
      const { base, sword, gun } = CharacterSprite.SHEET_LAYERS
      Promise.all([loadImage(base), loadImage(sword), loadImage(gun)])
        .then(([baseImg, swordImg, gunImg]) => {
          const cv = document.createElement('canvas')
          cv.width = baseImg.width
          cv.height = baseImg.height
          const ctx = cv.getContext('2d')!
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(baseImg, 0, 0)
          ctx.drawImage(swordImg, 0, 0)
          // 총 공격 프레임(19~26)은 gunblader_gun_m1911.png 자체가 손/몸 대비 과대
          // 스케일에 위치도 안 맞아(그립 중심이 손 위치에서 최대 20px 이상 어긋남),
          // 그 구간만 프레임별로 축소·재배치해서 합성한다. 나머지(0~18, 거치 자세)는
          // 문제 없어 원본 그대로 그린다.
          ctx.drawImage(gunImg, 0, 0, 19 * ART_CELL, ART_CELL_H, 0, 0, 19 * ART_CELL, ART_CELL_H)
          for (const [frameStr, off] of Object.entries(GUN_SHOOT_FIX)) {
            drawFixedGunCell(ctx, gunImg, Number(frameStr) * ART_CELL, off.dx, off.dy)
          }
          const loaded = makeTexture(cv)
          this.spec = ART_SPEC
          loaded.repeat.set(1 / this.spec.n, 1)
          const old = this.mat.map
          this.mat.map = loaded
          this.mat.needsUpdate = true
          this.artActive = true
          this.applyScale()
          old?.dispose()
        })
        .catch(() => {
          /* 로드 실패 → 절차 시트 유지 */
        })
    }
  }

  private applyScale() {
    this.sprite.scale.set(this.baseH * this.spec.aspect, this.baseH, 1)
  }

  /** 무기 교체 — 아트 시트 사용 중엔 시트 고정, 폴백(절차) 상태에서만 재생성 */
  setWeapons(gunId: string, swordId: string) {
    this.gunId = gunId
    this.swordId = swordId
    if (this.artActive) return
    const old = this.mat.map
    const tex = makeTexture(makeSheet(gunId, swordId))
    tex.repeat.set(1 / this.spec.n, 1)
    this.mat.map = tex
    this.mat.needsUpdate = true
    old?.dispose()
  }

  /** 대시 잔상용: 현재 프레임의 텍스처/UV/크기 정보 */
  ghostParams() {
    const map = this.mat.map!
    return {
      map,
      offsetX: map.offset.x,
      repeatX: map.repeat.x,
      sx: this.sprite.scale.x,
      sy: this.sprite.scale.y,
      bobY: this.sprite.position.y,
    }
  }

  private setFrame(idx: number, faceLeft: boolean) {
    const fw = 1 / this.spec.n
    const map = this.mat.map!
    if (faceLeft) {
      map.offset.x = (idx + 1) * fw
      map.repeat.x = -fw
    } else {
      map.offset.x = idx * fw
      map.repeat.x = fw
    }
  }

  update(
    dt: number,
    pos: THREE.Vector3,
    aimAngle: number,
    st: { moving: boolean; dashing: boolean; swinging: boolean; shooting: boolean; invulnerable: boolean },
    hitFlash: number,
  ) {
    // 조준 x성분으로 좌우 전환 (데드존 좁게 → 방향 전환이 굼뜨지 않게)
    if (Math.sin(aimAngle) < -0.05) this.flip = -1
    else if (Math.sin(aimAngle) > 0.05) this.flip = 1
    const faceLeft = this.flip < 0

    // 우선순위: 베기 > 사격 > 걷기 > 대기
    const state = st.swinging ? 'attack' : st.shooting ? 'shoot' : st.moving ? 'walk' : 'idle'
    if (state !== this.lastState) {
      this.animTime = 0 // 동작 시작 프레임부터 재생
      this.lastState = state
    }
    const fpsT = this.spec.fps
    const fps = state === 'attack' ? fpsT.attack : state === 'shoot' ? fpsT.shoot : state === 'walk' ? (st.dashing ? fpsT.dash : fpsT.walk) : fpsT.idle
    this.animTime += dt
    const frames = this.spec.anim[state]
    const raw = Math.floor(this.animTime * fps)
    // 베기는 원샷(마지막 프레임 유지), 나머지는 루프
    const idx = state === 'attack' ? frames[Math.min(raw, frames.length - 1)] : frames[raw % frames.length]
    this.setFrame(idx, faceLeft)

    const bob = st.moving ? Math.abs(Math.sin(this.animTime * (st.dashing ? 18 : 11))) * (st.dashing ? 0.14 : 0.08) : 0
    this.sprite.position.set(0, bob, 0)
    this.object.position.set(pos.x, 0, pos.z)

    if (hitFlash > 0) this.mat.color.setRGB(1, 0.45, 0.45)
    else this.mat.color.setRGB(1, 1, 1)
    this.mat.opacity = st.invulnerable && Math.floor(performance.now() / 70) % 2 === 0 ? 0.35 : 1
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

const ART_CELL = 112
const ART_CELL_H = 64

/**
 * gunblader_gun_m1911.png의 총 공격 프레임(19~26) 보정값.
 *
 * 원본 그립 중심은 프레임마다 대략 (60, 39) 근방에 있는데(측정치), 몸통 쪽
 * 손 위치는 프레임마다 크게 달라(조준 동작이라 팔이 넓게 움직임) — 프레임별로
 * dx/dy를 따로 재서 grip 기준점을 실제 손 위치로 옮긴다. 축소(0.55배)는
 * 손 대비 총이 과대했던 것(측정: 손+총 높이가 전신 높이의 40%대)을 줄인 것.
 */
const GUN_SHOOT_PIVOT = { x: 60, y: 39 }
const GUN_SHOOT_SCALE = 0.55
const GUN_SHOOT_FIX: Record<number, { dx: number; dy: number }> = {
  19: { dx: -5, dy: -22 },
  20: { dx: 15, dy: -20 },
  21: { dx: 22, dy: -21 },
  22: { dx: 6, dy: -20 },
  23: { dx: 3, dy: -22 },
  24: { dx: -22, dy: -20 },
  25: { dx: 5, dy: -16 },
  26: { dx: 5, dy: -18 },
}

/** gunImg의 frameX 셀 하나를 그립 기준점 축소+이동해서 ctx의 같은 셀 위치에 그린다. */
function drawFixedGunCell(ctx: CanvasRenderingContext2D, gunImg: HTMLImageElement, frameX: number, dx: number, dy: number) {
  const tmp = document.createElement('canvas')
  tmp.width = ART_CELL
  tmp.height = ART_CELL_H
  const t = tmp.getContext('2d')!
  t.imageSmoothingEnabled = true
  const { x: px, y: py } = GUN_SHOOT_PIVOT
  t.translate(px - px * GUN_SHOOT_SCALE + dx, py - py * GUN_SHOOT_SCALE + dy)
  t.scale(GUN_SHOOT_SCALE, GUN_SHOOT_SCALE)
  t.drawImage(gunImg, frameX, 0, ART_CELL, ART_CELL_H, 0, 0, ART_CELL, ART_CELL_H)
  ctx.drawImage(tmp, frameX, 0)
}

function makeTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ══════════════════ 절차 생성 폴백 시트 (아트 로드 실패 시) ══════════════════
const C = {
  out: '#241f1b',
  skin: '#e6b98e',
  skinSh: '#c9976c',
  hair: '#e9dfc6', // 은백발
  hairSh: '#c2b492',
  coat: '#f3f0e7',
  coatSh: '#d0c7b5',
  gold: '#c99a3e',
  vest: '#49603a',
  cravat: '#f7f1de',
  pants: '#2e2620',
  boot: '#7a4f2a',
  glove: '#2b2620',
  metal: '#3b3e48',
  metalHi: '#9aa0ab',
  silver: '#c8ccd4',
  wood: '#6b4526',
  katana: '#a6503c',
  katEdge: '#ecdcb2',
  moon: '#7fd8e8',
}

type Mode = 'idle' | 'walk' | 'windup' | 'slash' | 'shoot1' | 'shoot2'

/** 가로 9프레임 폴백 시트 생성 (무기별) */
export function makeSheet(gunId: string, swordId: string): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = FW * 9
  cv.height = FH
  const x = cv.getContext('2d')!
  x.imageSmoothingEnabled = false
  const F = (i: number, mode: Mode, leg: number) => {
    x.save()
    x.translate(i * FW, 0)
    x.beginPath()
    x.rect(0, 0, FW, FH)
    x.clip()
    drawFrame(x, mode, leg, gunId, swordId)
    x.restore()
  }
  F(0, 'idle', 0)
  F(1, 'walk', 1)
  F(2, 'walk', 0)
  F(3, 'walk', -1)
  F(4, 'walk', 0)
  F(5, 'windup', 0)
  F(6, 'slash', 0)
  F(7, 'shoot1', 0)
  F(8, 'shoot2', 0)
  return cv
}

function drawFrame(x: CanvasRenderingContext2D, mode: Mode, leg: number, gunId: string, swordId: string) {
  const cx = 22 // 몸 중심 (오른쪽 여백은 무기 스윙 공간)
  const R = (px: number, py: number, w: number, h: number, c: string) => {
    x.fillStyle = c
    x.fillRect(Math.round(px), Math.round(py), Math.round(w), Math.round(h))
  }
  const TRI = (pts: [number, number][], c: string) => {
    x.fillStyle = c
    x.beginPath()
    x.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1])
    x.closePath()
    x.fill()
  }

  // 비율: 머리 축소(r6) + 다리 연장(엉덩이35→발51) → 팔다리 모션 가독성 향상
  const lunge = mode === 'slash' ? 3 : 0 // 베기 시 전진
  const recoil = mode === 'shoot1' ? -1 : 0 // 사격 반동
  const bx = cx + lunge + recoil // 몸 기준 x

  // ── 뒤로 펄럭이는 코트 자락 ──
  const tailSwing = mode === 'slash' ? 7 : mode === 'windup' ? 2 : Math.abs(leg) * 3
  TRI(
    [
      [bx - 5, 23],
      [bx - 13 - tailSwing, 48],
      [bx - 4 - tailSwing / 2, 46],
    ],
    C.coatSh,
  )
  TRI(
    [
      [bx - 3, 23],
      [bx - 9 - tailSwing, 49],
      [bx, 45],
    ],
    C.coat,
  )

  // ── 검 (몸 뒤: 대기/걷기=어깨 거치, windup=치켜듦) ──
  if (mode === 'idle' || mode === 'walk') drawSword(x, bx + 7, 20, 'shoulder', swordId)
  if (mode === 'windup') drawSword(x, bx + 6, 16, 'windup', swordId)

  // ── 다리 & 부츠 (긴 다리 + 보폭 스트라이드) ──
  const stride = leg * 2.5 // 앞뒤 보폭
  const fLift = Math.max(0, leg) * 4 // 앞다리 들어올림
  const bLift = Math.max(0, -leg) * 4 // 뒷다리 들어올림
  const spread = mode === 'slash' ? 5 : 0 // 돌진 자세 벌림
  // 뒷다리
  R(bx - 5 - spread - stride, 34, 4, 13 - bLift, C.pants)
  R(bx - 6 - spread - stride, 46 - bLift, 6, 4, C.boot)
  R(bx - 6 - spread - stride, 49 - bLift, 6, 1, C.out)
  // 앞다리
  R(bx + 1 + spread + stride, 34, 4, 13 - fLift, C.pants)
  R(bx + spread + stride, 46 - fLift, 6, 4, C.boot)
  R(bx + spread + stride, 49 - fLift, 6, 1, C.out)

  // ── 코트 몸통 (흰 롱코트) ──
  TRI(
    [
      [bx - 7, 15],
      [bx + 7, 15],
      [bx + 9, 35],
      [bx - 9, 35],
    ],
    C.coat,
  )
  R(bx + 3, 16, 5, 18, C.coatSh) // 음영
  R(bx - 8, 34, 17, 1, C.gold) // 금색 밑단 트림
  // 앞 열림 → 녹색 조끼 + 금단추
  R(bx - 3, 16, 6, 12, C.vest)
  R(bx - 1, 18, 1, 1, C.gold)
  R(bx - 1, 22, 1, 1, C.gold)
  R(bx - 1, 26, 1, 1, C.gold)
  // 벨트 + 버클
  R(bx - 7, 29, 15, 2, '#4f3320')
  R(bx - 1, 28, 3, 3, C.gold)
  // 흰 크라바트
  TRI(
    [
      [bx - 3, 13],
      [bx + 3, 13],
      [bx, 19],
    ],
    C.cravat,
  )

  // ── 검 팔 (오른팔) ──
  if (mode === 'idle' || mode === 'walk') {
    R(bx + 4, 16, 4, 7, C.coat) // 어깨로 올린 팔
    R(bx + 6, 18, 3, 3, C.glove)
  } else if (mode === 'windup') {
    R(bx + 3, 12, 4, 6, C.coat)
    R(bx + 5, 11, 3, 3, C.glove)
  }

  // ── 머리 (은백발 스파이크 + 안경) — 축소된 머리 ──
  const hy = 9 + (mode === 'slash' ? 1 : 0)
  x.fillStyle = C.skin
  x.beginPath()
  x.arc(bx, hy, 6, 0, 7)
  x.fill()
  R(bx - 5, hy + 3, 10, 1, C.skinSh) // 턱 음영
  // 머리카락
  x.fillStyle = C.hair
  x.beginPath()
  x.arc(bx, hy - 2, 6.5, Math.PI, 0)
  x.fill()
  TRI([[bx - 6, hy - 4], [bx - 9, hy - 9], [bx - 2, hy - 6]], C.hair)
  TRI([[bx - 2, hy - 6], [bx, hy - 12], [bx + 3, hy - 5]], C.hair)
  TRI([[bx + 3, hy - 5], [bx + 7, hy - 9], [bx + 6, hy - 3]], C.hair)
  TRI([[bx + 5, hy - 2], [bx + 10, hy - 5], [bx + 6, hy]], C.hairSh) // 옆 뻗침
  // 안경 (은테)
  R(bx - 4, hy, 3, 2, C.out)
  R(bx + 1, hy, 3, 2, C.out)
  R(bx - 3, hy, 1, 1, '#8899aa')
  R(bx + 2, hy, 1, 1, '#8899aa')
  R(bx - 1, hy, 2, 1, C.out)

  // ── 총 팔 (왼팔) + 총 — 걷기 시 다리 반대 위상으로 스윙 ──
  // 총은 팔보다 먼저 그린다: 손/장갑이 그립 부분을 덮어써 자연스럽게 손에 쥔 것처럼
  // 보이고, 석궁 활대가 팔과 겹치는 구간도 팔에 가려진다(수정 6).
  if (mode === 'shoot1' || mode === 'shoot2') {
    drawGun(x, shootAnchor(bx), gunId, mode === 'shoot1')
    R(bx + 2, 18, 9, 3, C.coat) // 팔 전방으로 쭉
    R(bx + 10, 18, 3, 3, C.glove)
  } else if (mode === 'slash') {
    drawGun(x, slashAnchor(bx), gunId, false)
    R(bx - 7, 18, 5, 3, C.coat) // 베기 중 뒤로 젖힌 팔
  } else {
    const armSwing = -leg * 2 // 팔은 다리와 반대로
    drawGun(x, idleAnchor(bx, armSwing), gunId, false)
    R(bx - 8 + armSwing, 17, 3, 9, C.coat)
    R(bx - 8 + armSwing, 25, 3, 3, C.glove)
  }

  // ── 베기 검 (몸 앞, 스윙 궤적 포함) ──
  if (mode === 'slash') {
    drawSword(x, bx + 6, 23, 'slash', swordId)
    // 잔상 아크
    x.strokeStyle = 'rgba(255,244,200,0.75)'
    x.lineWidth = 2
    x.beginPath()
    x.arc(bx + 4, 22, 17, -0.9, 0.75)
    x.stroke()
  }
}

// ══════════ 무기 드로잉 ══════════
/** 검: shoulder(어깨 거치·뒤) / windup(치켜듦) / slash(전방 휘두름) */
function drawSword(x: CanvasRenderingContext2D, hx: number, hy: number, mode: 'shoulder' | 'windup' | 'slash', id: string) {
  // 방향 벡터 (shoulder: 어깨 너머 위-오른쪽으로 뻗어 잘 보이게 — 참조 원화 포즈)
  let dx = 0.6
  let dy = -0.8
  if (mode === 'windup') {
    dx = 0.2
    dy = -0.98
  }
  if (mode === 'slash') {
    dx = 0.97
    dy = 0.26
  }

  const L: Record<string, number> = {
    katana: 21, daggers: 11, rapier: 23, greatsword: 18, warhammer: 15, glaive: 23, moonblade: 21,
  }
  const len = L[id] ?? 20
  const ex = hx + dx * len
  const ey = hy + dy * len

  const line = (w: number, c: string, off = 0) => {
    x.strokeStyle = c
    x.lineWidth = w
    x.beginPath()
    x.moveTo(hx + off, hy)
    x.lineTo(ex + off, ey)
    x.stroke()
  }

  switch (id) {
    case 'daggers':
      line(2.5, C.silver)
      line(2.5, C.silver, mode === 'slash' ? 0 : 4) // 두 자루
      line(1, '#ffffff')
      break
    case 'rapier':
      line(1.5, C.silver)
      // 컵 가드
      x.fillStyle = C.gold
      x.beginPath()
      x.arc(hx, hy, 2.5, 0, 7)
      x.fill()
      break
    case 'greatsword':
      line(5, '#8a8f9a')
      line(2, '#c8ccd4')
      x.fillStyle = C.gold
      x.fillRect(hx - 3, hy - 1, 6, 3) // 크로스가드
      break
    case 'warhammer': {
      line(2.5, C.wood)
      // 망치 머리
      x.fillStyle = '#6f7480'
      x.fillRect(ex - 4, ey - 4, 8, 8)
      x.fillStyle = C.metalHi
      x.fillRect(ex - 4, ey - 4, 8, 2)
      break
    }
    case 'glaive': {
      line(2, C.wood)
      // 끝의 굽은 날
      x.strokeStyle = C.silver
      x.lineWidth = 3
      x.beginPath()
      x.arc(ex, ey, 4, Math.atan2(dy, dx) - 1.4, Math.atan2(dy, dx) + 0.6)
      x.stroke()
      break
    }
    case 'moonblade':
      // 빛나는 청월도
      line(5, 'rgba(127,216,232,0.35)')
      line(2.5, C.moon)
      line(1, '#eafcff')
      break
    default: // katana
      line(2.5, C.katana)
      line(1, C.katEdge)
      x.fillStyle = C.gold
      x.fillRect(hx - 1, hy - 1, 3, 3) // 코등이
  }
}

/**
 * 손 앵커: 총이 그려질 기준점(그립 위치) + 방향.
 * angle 0 = 로컬 +x(=총구 방향)가 캔버스 +x(오른쪽)와 일치, PI/2 = 아래쪽.
 * 대기/걷기/베기가 서로 다른 그림이 아니라 같은 drawGun을 다른 각도로 회전시켜
 * 재사용하도록 만든 것이 이 앵커의 목적이다(수정 1·3).
 */
type HandAnchor = { x: number; y: number; angle: number }

/** 그립~총구 길이 — 상체 폭(코트 몸통 14~18px) 대비 과했던 걸 축소(수정 4) */
const GUN_LEN: Record<string, number> = {
  m1911: 6,
  smg: 7,
  shotgun: 10,
  rifle: 11,
  magnum: 8,
  crossbow: 7,
  autocannon: 9,
}

/** 총구 화염이 팁에서 로컬 +x로 더 뻗는 폭 (R(tip+2,...,3,...) 까지 = 5) */
const FLASH_REACH = 5

function gunLen(id: string): number {
  return GUN_LEN[id] ?? GUN_LEN.m1911
}

/**
 * 발사 자세 앵커. 총구+화염을 포함한 끝점이 프레임 폭(FW)을 넘지 않도록
 * 무기별 실제 길이에서 계산해 x를 왼쪽으로 보정한다(수정 5) — 하드코딩 상수 없음.
 * shoot1/shoot2에서 같은 위치를 쓰도록 항상 화염 포함 최대 reach로 계산한다
 * (프레임마다 위치가 흔들리면 "같은 총, 자세만 바뀜"이 깨진다).
 */
function shootAnchor(bx: number): HandAnchor {
  return { x: bx + 12, y: 18, angle: 0 }
}

function clampShootX(x: number, id: string): number {
  const maxReach = gunLen(id) + FLASH_REACH
  return Math.min(x, FW - maxReach - 1)
}

/** 대기/걷기 앵커 — 몸 왼쪽 아래로 내린 손, 총구가 아래를 향함 */
function idleAnchor(bx: number, armSwing: number): HandAnchor {
  return { x: bx - 8 + armSwing, y: 27, angle: Math.PI / 2 }
}

/** 베기 중 앵커 — 총을 든 팔을 뒤로 젖힌 자세, 총구는 계속 아래 */
function slashAnchor(bx: number): HandAnchor {
  return { x: bx - 9, y: 20, angle: Math.PI / 2 }
}

/**
 * 총 하나로 통일된 렌더러. 각 무기는 그립(로컬 원점)에서 총구(+x) 방향으로
 * 그려지며, anchor.x/y/angle로 위치·회전만 바뀐다 — idle/walk/shoot/slash가
 * 서로 다른 그림이 아니라 같은 그립 기준 그림의 자세 차이가 되도록 한다(수정 2·3).
 */
function drawGun(x: CanvasRenderingContext2D, anchor: HandAnchor, id: string, flash: boolean) {
  const R = (px: number, py: number, w: number, h: number, c: string) => {
    x.fillStyle = c
    x.fillRect(Math.round(px), Math.round(py), Math.round(w), Math.round(h))
  }
  const anchorX = anchor.angle === 0 ? clampShootX(anchor.x, id) : anchor.x
  x.save()
  x.translate(Math.round(anchorX), Math.round(anchor.y))
  x.rotate(anchor.angle)

  let tip = gunLen(id)
  switch (id) {
    case 'smg':
      R(0, -1, 7, 3, C.metal)
      R(2, 2, 2, 4, C.metal) // 탄창
      break
    case 'shotgun':
      R(-2, -1, 3, 3, C.wood) // 개머리
      R(1, -1, 9, 2, C.metal)
      R(3, 1, 4, 2, C.wood) // 펌프
      break
    case 'rifle':
      R(-1, -1, 12, 2, C.metal)
      R(3, -3, 3, 2, C.metal) // 스코프
      break
    case 'magnum':
      R(0, -1, 8, 2, C.silver)
      R(1, 0, 3, 3, C.metal) // 실린더
      break
    case 'crossbow':
      R(0, -1, 7, 2, C.wood)
      R(5, -3, 2, 6, C.metal) // 활대 — 세로 10→6px로 축소(수정 6)
      x.strokeStyle = '#ddd'
      x.lineWidth = 1
      x.beginPath()
      x.moveTo(6, -3)
      x.lineTo(1, 0)
      x.lineTo(6, 3)
      x.stroke()
      break
    case 'autocannon':
      R(0, -2, 9, 2, C.metal)
      R(0, 0, 9, 2, C.metal)
      R(-1, -3, 3, 6, '#565a66')
      break
    default: // m1911
      R(0, -1, 6, 3, C.metal)
      R(1, 2, 2, 3, C.wood)
  }
  if (flash) {
    R(tip, -2, 3, 3, '#fff6c0')
    R(tip + 2, -1, 3, 1, '#ffd020')
    R(tip + 1, -4, 1, 2, '#ffd020')
    R(tip + 1, 1, 1, 2, '#ffd020')
  }
  x.restore()
}
