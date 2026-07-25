import * as THREE from 'three'
import { noOutline } from '../rendering/toon'

export type InteractKind = 'chest' | 'fountain' | 'merchant' | 'portal' | 'door'

const texCache = new Map<string, THREE.Texture>()

function tex(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D) => void): THREE.Texture {
  let t = texCache.get(key)
  if (!t) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    draw(ctx)
    t = new THREE.CanvasTexture(c)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.colorSpace = THREE.SRGBColorSpace
    texCache.set(key, t)
  }
  return t
}

const R = (x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, c: string) => {
  x.fillStyle = c
  x.fillRect(px, py, w, h)
}

// ── 픽셀 아트: 각 오브젝트 ──
const chestClosedTex = () =>
  tex('chestC', 24, 20, (x) => {
    R(x, 2, 8, 20, 11, '#6b4526') // 몸통
    R(x, 2, 8, 20, 2, '#8a5c33')
    R(x, 1, 4, 22, 5, '#7a4f2a') // 뚜껑
    R(x, 1, 4, 22, 1, '#a06a3a')
    R(x, 1, 9, 22, 1, '#3a2415') // 이음선
    R(x, 10, 8, 4, 6, '#d8b24a') // 자물쇠
    R(x, 11, 10, 2, 2, '#5a4520')
    R(x, 1, 18, 22, 1, '#2a1a0f')
  })

const chestOpenTex = () =>
  tex('chestO', 24, 20, (x) => {
    R(x, 2, 10, 20, 9, '#6b4526')
    R(x, 3, 11, 18, 3, '#3a2415') // 안쪽 어둠
    R(x, 0, 2, 24, 5, '#7a4f2a') // 열린 뚜껑
    R(x, 0, 2, 24, 1, '#a06a3a')
    R(x, 1, 18, 22, 1, '#2a1a0f')
    R(x, 8, 12, 3, 2, '#ffe066') // 반짝임
    R(x, 14, 13, 2, 2, '#ffe066')
  })

const fountainTex = () =>
  tex('fountain', 28, 30, (x) => {
    R(x, 3, 20, 22, 8, '#7a7d84') // 하단 수조
    R(x, 3, 20, 22, 2, '#9a9da4')
    R(x, 6, 22, 16, 4, '#3aa0d0') // 물
    R(x, 7, 22, 14, 1, '#7fd8f0')
    R(x, 11, 8, 6, 13, '#8a8d94') // 기둥
    R(x, 11, 8, 2, 13, '#a8abb2')
    R(x, 8, 4, 12, 5, '#7a7d84') // 상단 접시
    R(x, 9, 5, 10, 3, '#3aa0d0')
    R(x, 13, 1, 2, 4, '#7fd8f0') // 솟는 물
    R(x, 12, 0, 4, 2, '#bff0ff')
    R(x, 3, 27, 22, 1, '#4a4d54')
  })

const merchantTex = () =>
  tex('merchant', 26, 34, (x) => {
    // 노점 천막
    R(x, 0, 4, 26, 4, '#a03a3a')
    R(x, 0, 4, 26, 1, '#c05050')
    for (let i = 0; i < 26; i += 6) R(x, i, 8, 3, 2, '#e8d0b0')
    R(x, 1, 10, 3, 14, '#6b4526') // 지지대
    R(x, 22, 10, 3, 14, '#6b4526')
    R(x, 2, 22, 22, 3, '#7a4f2a') // 좌판
    // 상인 (후드 상인)
    R(x, 9, 12, 8, 10, '#3f5a8a') // 로브
    R(x, 10, 9, 6, 5, '#e6b98e') // 얼굴
    R(x, 9, 7, 8, 3, '#2a3f66') // 후드
    R(x, 11, 11, 2, 1, '#1a1a22') // 눈
    R(x, 14, 11, 2, 1, '#1a1a22')
    // 진열 아이템
    R(x, 4, 19, 3, 3, '#d8b24a')
    R(x, 18, 19, 3, 3, '#a6503c')
    R(x, 1, 31, 24, 1, '#2a1a0f')
  })

const portalTex = () =>
  tex('portal', 26, 34, (x) => {
    // 돌 아치
    R(x, 1, 6, 4, 26, '#6b6357')
    R(x, 21, 6, 4, 26, '#6b6357')
    R(x, 1, 2, 24, 5, '#756d60')
    R(x, 1, 2, 24, 1, '#8a8274')
    // 포탈 소용돌이
    R(x, 6, 8, 14, 23, '#3a2a6a')
    R(x, 7, 10, 12, 19, '#5a3fa0')
    R(x, 9, 13, 8, 13, '#8a6ad0')
    R(x, 11, 16, 4, 7, '#c8b0ff')
    R(x, 12, 12, 2, 2, '#ffffff')
    R(x, 10, 22, 2, 2, '#ffffff')
    R(x, 1, 32, 24, 1, '#2a2620')
  })

const doorTex = () =>
  tex('door', 24, 30, (x) => {
    R(x, 1, 4, 22, 25, '#5a3f26') // 문짝
    R(x, 2, 5, 20, 23, '#6b4a2c')
    R(x, 1, 2, 22, 3, '#7a7d84') // 상단 석재
    R(x, 11, 4, 2, 25, '#3a2415') // 중앙 이음
    R(x, 6, 15, 3, 3, '#d8b24a') // 손잡이
    R(x, 15, 15, 3, 3, '#d8b24a')
    R(x, 1, 28, 22, 1, '#2a1a0f')
  })

const TEXFN: Record<InteractKind, () => THREE.Texture> = {
  chest: chestClosedTex,
  fountain: fountainTex,
  merchant: merchantTex,
  portal: portalTex,
  door: doorTex,
}
const SCALE: Record<InteractKind, number> = { chest: 1.7, fountain: 2.4, merchant: 2.8, portal: 3.0, door: 2.6 }
export const INTERACT_RANGE: Record<InteractKind, number> = {
  chest: 2.2,
  fountain: 2.4,
  merchant: 3.0,
  portal: 2.6,
  door: 2.0,
}

/** 상호작용 가능한 월드 오브젝트 (빌보드 스프라이트 + 근접 판정) */
export class Interactable {
  kind: InteractKind
  group = new THREE.Group()
  pos = new THREE.Vector3()
  used = false
  /** 문 전용: 선택지 인덱스 */
  choiceIndex = 0
  /** 프롬프트에 표시할 라벨 */
  label: string
  private sprite: THREE.Sprite
  private mat: THREE.SpriteMaterial
  private glow: THREE.Sprite | null = null
  private bob = Math.random() * 6

  constructor(kind: InteractKind, x: number, z: number, label: string) {
    this.kind = kind
    this.label = label
    this.pos.set(x, 0, z)

    this.mat = new THREE.SpriteMaterial({ map: TEXFN[kind](), transparent: true, depthWrite: false })
    this.sprite = new THREE.Sprite(this.mat)
    this.sprite.center.set(0.5, 0)
    const sc = SCALE[kind]
    const t = this.mat.map!
    const img = t.image as HTMLCanvasElement
    this.sprite.scale.set(sc * (img.width / img.height), sc, 1)
    this.group.add(this.sprite)

    // 발밑 그림자
    const shadowMat = noOutline(
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    )
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(sc * 0.3, 14), shadowMat)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    shadow.scale.set(1, 0.5, 1)
    this.group.add(shadow)

    // 포탈/문은 은은한 발광
    if (kind === 'portal' || kind === 'door') {
      const gm = noOutline(
        new THREE.SpriteMaterial({
          color: kind === 'portal' ? 0x9a7aff : 0xffd070,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        }),
      )
      this.glow = new THREE.Sprite(gm)
      this.glow.scale.setScalar(sc * 1.5)
      this.glow.center.set(0.5, 0)
      this.group.add(this.glow)
    }

    this.group.position.copy(this.pos)
  }

  update(dt: number) {
    this.bob += dt * 2.5
    // 포탈/분수는 살짝 위아래로
    if (this.kind === 'portal' || this.kind === 'fountain') {
      this.sprite.position.y = Math.sin(this.bob) * 0.08
    }
    if (this.glow) {
      const m = this.glow.material as THREE.SpriteMaterial
      m.opacity = 0.2 + Math.sin(this.bob * 1.6) * 0.1
    }
  }

  /** 상자 열기 등 상태 변경 */
  markUsed() {
    this.used = true
    if (this.kind === 'chest') {
      this.mat.map = chestOpenTex()
      this.mat.needsUpdate = true
    } else if (this.kind === 'fountain') {
      this.mat.color.setRGB(0.5, 0.5, 0.55) // 사용된 분수는 어둡게
    }
  }

  inRange(p: THREE.Vector3) {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) <= INTERACT_RANGE[this.kind]
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group)
    return this
  }
  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group)
  }
}
