import * as THREE from 'three'

/**
 * 하이브리드 2D 주인공 — 카메라를 향하는 빌보드 + 스프라이트 시트 프레임 애니메이션.
 * 캔버스로 7프레임(대기/걷기4/공격2) 시트를 생성해 idle·walk·attack을 재생한다.
 * 실제 아트로 교체하려면 SHEET_URL(가로 7프레임 스트립)만 넣으면 된다.
 */
const FW = 40 // 프레임 너비(px)
const FH = 56 // 프레임 높이(px)
const N = 7 // 총 프레임 수
const ANIM: Record<'idle' | 'walk' | 'attack', number[]> = {
  idle: [0],
  walk: [1, 2, 3, 4],
  attack: [5, 6],
}

export class CharacterSprite {
  static SHEET_URL: string | null = null

  object = new THREE.Group()
  private sprite: THREE.Sprite
  private mat: THREE.SpriteMaterial
  private shadow: THREE.Mesh
  private readonly baseH = 3.0
  private animTime = 0
  private flip = 1

  constructor() {
    const tex = CharacterSprite.SHEET_URL
      ? new THREE.TextureLoader().load(CharacterSprite.SHEET_URL)
      : new THREE.CanvasTexture(makeSheet())
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.colorSpace = THREE.SRGBColorSpace
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
    st: { moving: boolean; dashing: boolean; swinging: boolean; invulnerable: boolean },
    hitFlash: number,
  ) {
    // 좌우 바라보기
    if (Math.sin(aimAngle) < -0.15) this.flip = -1
    else if (Math.sin(aimAngle) > 0.15) this.flip = 1
    const faceLeft = this.flip < 0

    // 애니메이션 선택
    const state = st.swinging ? 'attack' : st.moving ? 'walk' : 'idle'
    const fps = state === 'attack' ? 14 : state === 'walk' ? (st.dashing ? 14 : 9) : 2.5
    this.animTime += dt
    const frames = ANIM[state]
    const idx = frames[Math.floor(this.animTime * fps) % frames.length]
    this.setFrame(idx, faceLeft)

    // 위치 + 걷기 바운스
    const bob = st.moving ? Math.abs(Math.sin(this.animTime * (st.dashing ? 18 : 11))) * (st.dashing ? 0.14 : 0.08) : 0
    this.sprite.position.set(0, bob, 0)
    this.object.position.set(pos.x, 0, pos.z)

    // 피격 틴트 / 무적 깜빡임
    if (hitFlash > 0) this.mat.color.setRGB(1, 0.45, 0.45)
    else this.mat.color.setRGB(1, 1, 1)
    this.mat.opacity = st.invulnerable && Math.floor(performance.now() / 70) % 2 === 0 ? 0.35 : 1
  }
}

// ══════════ 스프라이트 시트 생성 ══════════
function makeSheet(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = FW * N
  cv.height = FH
  const x = cv.getContext('2d')!
  x.imageSmoothingEnabled = false
  // 0 idle, 1-4 walk, 5-6 attack
  drawFrame(x, 0, { legPhase: 0, swing: 0 })
  drawFrame(x, 1, { legPhase: 1, swing: 0 })
  drawFrame(x, 2, { legPhase: 0, swing: 0 })
  drawFrame(x, 3, { legPhase: -1, swing: 0 })
  drawFrame(x, 4, { legPhase: 0, swing: 0 })
  drawFrame(x, 5, { legPhase: 0, swing: 0.25 })
  drawFrame(x, 6, { legPhase: 0, swing: 1 })
  return cv
}

const COL = {
  coat: '#f2efe6',
  coatSh: '#d3cabb',
  skin: '#e2b48c',
  hair: '#d8bf6e',
  vest: '#4a5a3c',
  cravat: '#f2ebd8',
  pants: '#33271c',
  boot: '#6b4526',
  kat: '#a6503c',
  katEdge: '#e8d9b0',
  gold: '#c99a3e',
  gun: '#33343a',
  out: '#241f1b',
}

function drawFrame(x: CanvasRenderingContext2D, frame: number, pose: { legPhase: number; swing: number }) {
  const ox = frame * FW
  const cx = ox + 20
  const R = (px: number, py: number, w: number, h: number, c: string) => {
    x.fillStyle = c
    x.fillRect(Math.round(px), Math.round(py), w, h)
  }
  const lp = pose.legPhase

  // ── 다리 & 부츠 (걷기: 앞발 올라감) ──
  const lBootY = 49 - Math.max(0, lp) * 2
  const rBootY = 49 - Math.max(0, -lp) * 2
  R(cx - 6, 40, 5, lBootY - 40 + 2, COL.pants)
  R(cx + 1, 40, 5, rBootY - 40 + 2, COL.pants)
  R(cx - 7, lBootY, 6, 5, COL.boot)
  R(cx + 1, rBootY, 6, 5, COL.boot)
  R(cx - 7, lBootY + 4, 6, 1, COL.out)
  R(cx + 1, rBootY + 4, 6, 1, COL.out)

  // ── 흰 롱코트 (사다리꼴) ──
  x.fillStyle = COL.coat
  x.beginPath()
  x.moveTo(cx - 8, 20)
  x.lineTo(cx + 8, 20)
  x.lineTo(cx + 11, 45)
  x.lineTo(cx - 11, 45)
  x.closePath()
  x.fill()
  // 코트 그림자(오른쪽)
  R(cx + 4, 22, 4, 22, COL.coatSh)
  // 코트 외곽선(간단)
  x.strokeStyle = COL.out
  x.lineWidth = 1
  x.stroke()
  // 앞 열림 + 녹색 조끼
  R(cx - 3, 21, 6, 16, COL.vest)
  R(cx - 1, 23, 1, 1, COL.gold)
  R(cx - 1, 27, 1, 1, COL.gold)
  R(cx - 1, 31, 1, 1, COL.gold)
  // 벨트
  R(cx - 8, 36, 17, 2, '#4f3320')
  R(cx - 1, 35, 3, 3, COL.gold)

  // ── 흰 크라바트 ──
  x.fillStyle = COL.cravat
  x.beginPath()
  x.moveTo(cx - 3, 18)
  x.lineTo(cx + 3, 18)
  x.lineTo(cx, 26)
  x.closePath()
  x.fill()

  // ── 카타나 (오른손) — swing에 따라 아래-오른쪽 → 위-왼쪽 횡베기 ──
  const pivX = cx + 7
  const pivY = 26
  const ang = lerp(0.7, -2.1, pose.swing) // rad (canvas y-down)
  const len = 20
  const ex = pivX + Math.cos(ang) * len
  const ey = pivY + Math.sin(ang) * len
  x.strokeStyle = COL.kat
  x.lineWidth = 3
  x.beginPath()
  x.moveTo(pivX, pivY)
  x.lineTo(ex, ey)
  x.stroke()
  x.strokeStyle = COL.katEdge
  x.lineWidth = 1
  x.beginPath()
  x.moveTo(pivX, pivY)
  x.lineTo(ex, ey)
  x.stroke()
  R(pivX - 2, pivY - 2, 4, 4, COL.gold) // 코등이

  // ── 왼팔 + M1911 (얼굴 옆, 총구 위) ──
  R(cx - 10, 12, 4, 12, COL.coat) // 소매
  R(cx - 12, 5, 4, 9, COL.gun) // 슬라이드
  R(cx - 13, 12, 5, 4, COL.gun) // 그립부
  R(cx - 11, 3, 2, 3, COL.gun) // 총구

  // ── 머리 ──
  x.fillStyle = COL.skin
  x.beginPath()
  x.arc(cx, 12, 7, 0, 7)
  x.fill()
  // 금발
  x.fillStyle = COL.hair
  x.beginPath()
  x.arc(cx, 9, 8, Math.PI, 0)
  x.fill()
  R(cx - 8, 6, 3, 3, COL.hair)
  R(cx + 5, 6, 3, 3, COL.hair)
  R(cx - 2, 3, 3, 3, COL.hair)
  // 안경
  R(cx - 5, 11, 3, 2, COL.out)
  R(cx + 1, 11, 3, 2, COL.out)
  R(cx - 2, 11, 1, 1, COL.out)
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
