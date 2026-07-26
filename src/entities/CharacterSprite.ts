import * as THREE from 'three'

/**
 * 2D 주인공 빌보드 — SD 총검사 아트 시트(public/gunblader.png) 사용.
 *
 * 아트 시트: 112x64 셀 × 27프레임 스트립 (오른쪽 기준)
 *   셀 폭은 카타나가 몸통 왼쪽으로 길게 뻗는 것을 담기 위한 값 — 캐릭터는 셀 중앙,
 *   발끝이 셀 바닥에 오도록 정렬되어 있다.
 *   대기 0-3 / 걷기 4-10 / 검 공격 11-18 / 총 공격 19-26
 * 로드 실패 시(또는 로드 전) 절차 생성 픽셀 시트(9프레임)로 폴백.
 * 절차 시트는 무기별 드로잉을 지원하므로 폴백 상태에선 무기 교체가 반영된다.
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
  /** 커스텀 아트 시트 경로 (null이면 절차 생성만 사용) */
  static SHEET_URL: string | null = 'gunblader.png'

  object = new THREE.Group()
  private sprite: THREE.Sprite
  private mat: THREE.SpriteMaterial
  private shadow: THREE.Mesh
  private readonly baseH = 3.15
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

    // 아트 시트 비동기 로드 → 성공 시 교체
    if (CharacterSprite.SHEET_URL) {
      new THREE.TextureLoader().load(
        CharacterSprite.SHEET_URL,
        (loaded) => {
          loaded.magFilter = THREE.NearestFilter
          loaded.minFilter = THREE.NearestFilter
          loaded.generateMipmaps = false
          loaded.colorSpace = THREE.SRGBColorSpace
          this.spec = ART_SPEC
          loaded.repeat.set(1 / this.spec.n, 1)
          const old = this.mat.map
          this.mat.map = loaded
          this.mat.needsUpdate = true
          this.artActive = true
          this.applyScale()
          old?.dispose()
        },
        undefined,
        () => {
          /* 로드 실패 → 절차 시트 유지 */
        },
      )
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
  if (mode === 'shoot1' || mode === 'shoot2') {
    R(bx + 2, 18, 9, 3, C.coat) // 팔 전방으로 쭉
    R(bx + 10, 18, 3, 3, C.glove)
    drawGun(x, bx + 12, 18, gunId, mode === 'shoot1')
  } else if (mode === 'slash') {
    R(bx - 7, 18, 5, 3, C.coat) // 베기 중 뒤로 젖힌 팔
  } else {
    const armSwing = -leg * 2 // 팔은 다리와 반대로
    R(bx - 8 + armSwing, 17, 3, 9, C.coat)
    R(bx - 8 + armSwing, 25, 3, 3, C.glove)
    drawGunSmall(x, bx - 8 + armSwing, 27, gunId)
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

/** 총(전방 발사 자세): 손 위치에서 오른쪽으로. flash=총구 화염 */
function drawGun(x: CanvasRenderingContext2D, gx: number, gy: number, id: string, flash: boolean) {
  const R = (px: number, py: number, w: number, h: number, c: string) => {
    x.fillStyle = c
    x.fillRect(Math.round(px), Math.round(py), w, h)
  }
  let tip = gx + 7
  switch (id) {
    case 'smg':
      R(gx, gy, 8, 3, C.metal)
      R(gx + 2, gy + 3, 2, 4, C.metal) // 탄창
      tip = gx + 8
      break
    case 'shotgun':
      R(gx - 2, gy, 3, 3, C.wood) // 개머리
      R(gx + 1, gy, 11, 2, C.metal)
      R(gx + 3, gy + 2, 4, 2, C.wood) // 펌프
      tip = gx + 12
      break
    case 'rifle':
      R(gx - 1, gy, 14, 2, C.metal)
      R(gx + 3, gy - 2, 3, 2, C.metal) // 스코프
      tip = gx + 13
      break
    case 'magnum':
      R(gx, gy, 9, 2, C.silver)
      R(gx + 1, gy + 1, 3, 3, C.metal) // 실린더
      tip = gx + 9
      break
    case 'crossbow':
      R(gx, gy, 8, 2, C.wood)
      R(gx + 6, gy - 4, 2, 10, C.metal) // 활대
      x.strokeStyle = '#ddd'
      x.lineWidth = 1
      x.beginPath()
      x.moveTo(gx + 7, gy - 4)
      x.lineTo(gx + 1, gy + 1)
      x.lineTo(gx + 7, gy + 6)
      x.stroke()
      tip = gx + 8
      break
    case 'autocannon':
      R(gx, gy - 1, 10, 2, C.metal)
      R(gx, gy + 1, 10, 2, C.metal)
      R(gx - 1, gy - 2, 3, 6, '#565a66')
      tip = gx + 10
      break
    default: // m1911
      R(gx, gy, 6, 3, C.metal)
      R(gx + 1, gy + 3, 2, 3, C.wood)
      tip = gx + 6
  }
  if (flash) {
    R(tip, gy - 1, 3, 3, '#fff6c0')
    R(tip + 2, gy, 3, 1, '#ffd020')
    R(tip + 1, gy - 3, 1, 2, '#ffd020')
    R(tip + 1, gy + 2, 1, 2, '#ffd020')
  }
}

/** 대기/걷기 시 내려 든 총 (간단 실루엣) */
function drawGunSmall(x: CanvasRenderingContext2D, gx: number, gy: number, id: string) {
  x.fillStyle = C.metal
  const big = id === 'shotgun' || id === 'rifle' || id === 'autocannon' || id === 'crossbow'
  x.fillRect(gx, gy, 3, big ? 8 : 5)
  if (id === 'magnum') x.fillStyle = C.silver
  x.fillRect(gx - 1, gy, 2, 2)
}
