import * as THREE from 'three'

/**
 * 2D 주인공 빌보드 — 던파 총검사 픽셀 스프라이트 (참조 원화 기반).
 * 은백발 스파이크 헤어 + 안경 + 흰 롱코트(펄럭이는 자락) + 녹색 조끼 + 흰 크라바트.
 *
 * 스프라이트 시트 9프레임: 0 대기 / 1-4 걷기 / 5-6 검 베기(들기→휘두름) / 7-8 사격(발사→반동).
 * 무기(gunId/swordId)별로 캐릭터가 실제로 그 무기를 든 시트를 새로 그린다 → setWeapons().
 * 실제 아트로 교체하려면 SHEET_URL(가로 9프레임 스트립)만 지정.
 */
const FW = 48
const FH = 56
const N = 9
const ANIM: Record<'idle' | 'walk' | 'attack' | 'shoot', number[]> = {
  idle: [0],
  walk: [1, 2, 3, 4],
  attack: [5, 6],
  shoot: [7, 8],
}

export class CharacterSprite {
  static SHEET_URL: string | null = null

  object = new THREE.Group()
  private sprite: THREE.Sprite
  private mat: THREE.SpriteMaterial
  private shadow: THREE.Mesh
  private readonly baseH = 3.1
  private animTime = 0
  private flip = 1
  private lastState = ''
  private gunId: string
  private swordId: string

  constructor(gunId = 'm1911', swordId = 'katana') {
    this.gunId = gunId
    this.swordId = swordId
    const tex = CharacterSprite.SHEET_URL
      ? new THREE.TextureLoader().load(CharacterSprite.SHEET_URL)
      : makeTexture(makeSheet(gunId, swordId))
    tex.repeat.set(1 / N, 1)

    this.mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    this.sprite = new THREE.Sprite(this.mat)
    this.sprite.center.set(0.5, 0)
    this.sprite.scale.set(this.baseH * (FW / FH), this.baseH, 1)
    this.object.add(this.sprite)

    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    shadowMat.userData.outlineParameters = { visible: false }
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.02
    this.shadow.scale.set(1, 0.55, 1)
    this.object.add(this.shadow)
  }

  /** 무기 교체 시 해당 무기를 든 시트로 재생성 */
  setWeapons(gunId: string, swordId: string) {
    if (CharacterSprite.SHEET_URL) return
    if (gunId === this.gunId && swordId === this.swordId) return
    this.gunId = gunId
    this.swordId = swordId
    const old = this.mat.map
    const tex = makeTexture(makeSheet(gunId, swordId))
    tex.repeat.set(1 / N, 1)
    this.mat.map = tex
    this.mat.needsUpdate = true
    old?.dispose()
  }

  private setFrame(idx: number, faceLeft: boolean) {
    const fw = 1 / N
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
    if (Math.sin(aimAngle) < -0.15) this.flip = -1
    else if (Math.sin(aimAngle) > 0.15) this.flip = 1
    const faceLeft = this.flip < 0

    // 우선순위: 베기 > 사격 > 걷기 > 대기
    const state = st.swinging ? 'attack' : st.shooting ? 'shoot' : st.moving ? 'walk' : 'idle'
    if (state !== this.lastState) {
      this.animTime = 0 // 동작 시작 프레임부터 재생
      this.lastState = state
    }
    const fps = state === 'attack' ? 10 : state === 'shoot' ? 12 : state === 'walk' ? (st.dashing ? 15 : 9) : 2
    this.animTime += dt
    const frames = ANIM[state]
    const idx = frames[Math.floor(this.animTime * fps) % frames.length]
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

// ══════════════════ 시트 드로잉 ══════════════════
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

/** 가로 9프레임 시트 생성 (무기별) */
export function makeSheet(gunId: string, swordId: string): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = FW * N
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

  const lunge = mode === 'slash' ? 3 : 0 // 베기 시 전진
  const recoil = mode === 'shoot1' ? -1 : 0 // 사격 반동
  const bx = cx + lunge + recoil // 몸 기준 x

  // ── 뒤로 펄럭이는 코트 자락 (참조: 크게 갈라진 흰 자락) ──
  const tailSwing = mode === 'slash' ? 6 : mode === 'windup' ? 2 : leg !== 0 ? 2 : 0
  TRI(
    [
      [bx - 6, 26],
      [bx - 13 - tailSwing, 50],
      [bx - 5 - tailSwing / 2, 48],
    ],
    C.coatSh,
  )
  TRI(
    [
      [bx - 4, 26],
      [bx - 9 - tailSwing, 51],
      [bx - 1, 47],
    ],
    C.coat,
  )

  // ── 검 (몸 뒤: 대기/걷기=어깨 거치, windup=치켜듦) ──
  if (mode === 'idle' || mode === 'walk') drawSword(x, bx + 8, 24, 'shoulder', swordId)
  if (mode === 'windup') drawSword(x, bx + 7, 20, 'windup', swordId)

  // ── 다리 & 부츠 ──
  const lLift = Math.max(0, leg) * 3
  const rLift = Math.max(0, -leg) * 3
  const legSpread = mode === 'slash' ? 4 : 0 // 돌진 자세
  // 뒷다리
  R(bx - 5 - legSpread, 40, 5, 10 - rLift, C.pants)
  R(bx - 6 - legSpread, 48 - rLift, 7, 4, C.boot)
  R(bx - 6 - legSpread, 51 - rLift, 7, 1, C.out)
  // 앞다리
  R(bx + 1 + legSpread, 40, 5, 10 - lLift, C.pants)
  R(bx + legSpread, 48 - lLift, 7, 4, C.boot)
  R(bx + legSpread, 51 - lLift, 7, 1, C.out)

  // ── 코트 몸통 (흰 롱코트, 허리 아래로 벌어짐) ──
  TRI(
    [
      [bx - 8, 20],
      [bx + 8, 20],
      [bx + 10, 43],
      [bx - 10, 43],
    ],
    C.coat,
  )
  R(bx + 4, 21, 5, 21, C.coatSh) // 음영
  R(bx - 8, 42, 18, 1, C.gold) // 금색 밑단 트림
  // 앞 열림 → 녹색 조끼 + 금단추
  R(bx - 3, 21, 6, 15, C.vest)
  R(bx - 1, 23, 1, 1, C.gold)
  R(bx - 1, 27, 1, 1, C.gold)
  R(bx - 1, 31, 1, 1, C.gold)
  // 벨트 + 버클
  R(bx - 8, 36, 17, 2, '#4f3320')
  R(bx - 1, 35, 3, 3, C.gold)
  // 흰 크라바트
  TRI(
    [
      [bx - 3, 18],
      [bx + 3, 18],
      [bx, 25],
    ],
    C.cravat,
  )

  // ── 검 팔 (오른팔) ──
  if (mode === 'idle' || mode === 'walk') {
    R(bx + 5, 21, 4, 8, C.coat) // 어깨로 올린 팔
    R(bx + 7, 23, 3, 3, C.glove)
  } else if (mode === 'windup') {
    R(bx + 4, 17, 4, 7, C.coat)
    R(bx + 6, 16, 3, 3, C.glove)
  }

  // ── 머리 (은백발 스파이크 + 안경) ──
  const hy = 12 + (mode === 'slash' ? 1 : 0)
  x.fillStyle = C.skin
  x.beginPath()
  x.arc(bx, hy, 7, 0, 7)
  x.fill()
  R(bx - 7, hy + 1, 14, 2, C.skinSh) // 턱 음영
  // 머리카락: 위로 뻗친 스파이크
  x.fillStyle = C.hair
  x.beginPath()
  x.arc(bx, hy - 3, 7.5, Math.PI, 0)
  x.fill()
  TRI([[bx - 7, hy - 5], [bx - 10, hy - 11], [bx - 3, hy - 7]], C.hair)
  TRI([[bx - 2, hy - 7], [bx - 1, hy - 14], [bx + 3, hy - 7]], C.hair)
  TRI([[bx + 3, hy - 6], [bx + 8, hy - 12], [bx + 7, hy - 4]], C.hair)
  TRI([[bx + 6, hy - 3], [bx + 11, hy - 6], [bx + 7, hy - 1]], C.hairSh) // 옆 뻗침
  // 안경 (은테)
  R(bx - 5, hy - 1, 4, 3, C.out)
  R(bx + 1, hy - 1, 4, 3, C.out)
  R(bx - 4, hy, 2, 1, '#8899aa')
  R(bx + 2, hy, 2, 1, '#8899aa')
  R(bx - 1, hy, 2, 1, C.out)

  // ── 총 팔 (왼팔) + 총 ──
  if (mode === 'shoot1' || mode === 'shoot2') {
    // 팔 전방으로 쭉
    R(bx + 2, 22, 9, 3, C.coat)
    R(bx + 10, 22, 3, 3, C.glove)
    drawGun(x, bx + 12, 22, gunId, mode === 'shoot1')
  } else if (mode === 'slash') {
    // 베기 중엔 총 팔은 뒤로
    R(bx - 8, 22, 5, 3, C.coat)
  } else {
    // 대기/걷기: 총 내려 든 손
    R(bx - 8, 24, 3, 8, C.coat)
    R(bx - 8, 31, 3, 3, C.glove)
    drawGunSmall(x, bx - 8, 33, gunId)
  }

  // ── 베기 검 (몸 앞, 스윙 궤적 포함) ──
  if (mode === 'slash') {
    drawSword(x, bx + 6, 27, 'slash', swordId)
    // 잔상 아크
    x.strokeStyle = 'rgba(255,244,200,0.75)'
    x.lineWidth = 2
    x.beginPath()
    x.arc(bx + 4, 26, 17, -0.9, 0.75)
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
