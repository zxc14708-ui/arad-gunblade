import * as THREE from 'three'
import { noOutline } from '../rendering/toon'
import { ASSET, loadTex } from '../rendering/assets'
import type { Direction } from '../systems/RunState'

export type InteractKind = 'chest' | 'fountain' | 'merchant' | 'portal' | 'door'

// ── 프롭 텍스처 (제공된 픽셀 애셋) ──
const chestClosedTex = () => loadTex(ASSET.props.chestClosed)
const chestOpenTex = () => loadTex(ASSET.props.chestOpen)
const fountainTex = () => loadTex(ASSET.props.fountain)
const merchantTex = () => loadTex(ASSET.props.merchant)
const portalTex = () => loadTex(ASSET.props.portal)
const doorTex = () => loadTex(ASSET.props.door)

const TEXFN: Record<InteractKind, () => THREE.Texture> = {
  chest: chestClosedTex,
  fountain: fountainTex,
  merchant: merchantTex,
  portal: portalTex,
  door: doorTex,
}
const SCALE: Record<InteractKind, number> = { chest: 1.8, fountain: 2.8, merchant: 3.2, portal: 5.2, door: 4.2 }
/** 애셋 원본 종횡비(가로/세로) — 텍스처가 비동기 로드라 상수로 고정 */
const ASPECT: Record<InteractKind, number> = {
  chest: 24 / 20,
  fountain: 28 / 30,
  merchant: 26 / 34,
  portal: 26 / 34,
  door: 24 / 30,
}
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
  targetRoomId: string | null = null
  direction: Direction | null = null
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

    this.mat = new THREE.SpriteMaterial({
      map: TEXFN[kind](),
      transparent: true,
      depthWrite: false,
      depthTest: kind !== 'portal' && kind !== 'door',
    })
    this.sprite = new THREE.Sprite(this.mat)
    this.sprite.center.set(0.5, 0)
    this.sprite.renderOrder = kind === 'portal' || kind === 'door' ? 12 : 2
    const sc = SCALE[kind]
    this.sprite.scale.set(sc * ASPECT[kind], sc, 1)
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
          map: TEXFN[kind](),
          color: kind === 'portal' ? 0x9a7aff : 0xffd070,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          depthTest: false,
        }),
      )
      this.glow = new THREE.Sprite(gm)
      this.glow.scale.setScalar(sc * 1.5)
      this.glow.center.set(0.5, 0)
      this.glow.renderOrder = 11
      this.group.add(this.glow)

      if (kind === 'portal') {
        const marker = noOutline(
          new THREE.MeshBasicMaterial({ color: 0x72eaff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
        )
        const ring = new THREE.Mesh(new THREE.RingGeometry(sc * 0.34, sc * 0.5, 32), marker)
        ring.rotation.x = -Math.PI / 2
        ring.position.y = 0.045
        this.group.add(ring)
      }
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
