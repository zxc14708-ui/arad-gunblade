import * as THREE from 'three'
import { COLORS } from '../config'
import { noOutline } from '../rendering/toon'

type PickupType = 'xp' | 'gold'

interface Pickup {
  type: PickupType
  sprite: THREE.Sprite
  pos: THREE.Vector3
  value: number
  bob: number
}

const texCache = new Map<string, THREE.Texture>()
function makeTex(key: string, size: number, draw: (x: CanvasRenderingContext2D) => void): THREE.Texture {
  let t = texCache.get(key)
  if (!t) {
    const c = document.createElement('canvas')
    c.width = c.height = size
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

/** 금화 픽셀 스프라이트 */
const coinTex = () =>
  makeTex('coin', 12, (x) => {
    R(x, 3, 1, 6, 10, '#c99a3e')
    R(x, 2, 2, 8, 8, '#e8c454')
    R(x, 3, 3, 6, 6, '#ffe58a')
    R(x, 4, 4, 2, 3, '#fff6c0')
    R(x, 5, 3, 2, 6, '#c99a3e')
  })

/** 경험치 결정 픽셀 스프라이트 */
const xpTex = () =>
  makeTex('xp', 12, (x) => {
    R(x, 5, 1, 2, 10, '#6ad0ff')
    R(x, 4, 2, 4, 8, '#8fe0ff')
    R(x, 3, 4, 6, 4, '#6ad0ff')
    R(x, 5, 4, 2, 3, '#eaffff')
  })

/**
 * 바닥 픽업 (경험치 결정 + 골드 코인).
 * 플레이어가 근처에 오면 끌려오고, 닿으면 수집된다.
 */
export class Pickups {
  private scene: THREE.Scene
  private items: Pickup[] = []
  private xpMat = noOutline(new THREE.SpriteMaterial({ map: xpTex(), transparent: true, depthWrite: false }))
  private goldMat = noOutline(new THREE.SpriteMaterial({ map: coinTex(), transparent: true, depthWrite: false }))

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private spawn(type: PickupType, x: number, z: number, value: number, spread: number) {
    const sp = new THREE.Sprite(type === 'xp' ? this.xpMat : this.goldMat)
    sp.scale.setScalar(type === 'gold' ? 0.85 : 0.75)
    const px = x + (Math.random() - 0.5) * spread
    const pz = z + (Math.random() - 0.5) * spread
    sp.position.set(px, 0.5, pz)
    this.scene.add(sp)
    this.items.push({ type, sprite: sp, pos: new THREE.Vector3(px, 0.5, pz), value, bob: Math.random() * 6 })
  }

  dropXp(x: number, z: number, value: number) {
    this.spawn('xp', x, z, value, 0.6)
  }

  /** 골드는 여러 코인으로 흩뿌림 */
  dropGold(x: number, z: number, total: number) {
    const coins = Math.min(5, Math.max(1, Math.round(total / 6)))
    const per = Math.max(1, Math.round(total / coins))
    for (let i = 0; i < coins; i++) this.spawn('gold', x, z, per, 1.8)
  }

  /** 반환: 수집한 경험치/골드 합계 */
  update(dt: number, playerPos: THREE.Vector3, magnetRange: number, speed: number, pickupRange = 1.1) {
    let xp = 0
    let gold = 0
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      it.bob += dt * 5
      const dx = playerPos.x - it.pos.x
      const dz = playerPos.z - it.pos.z
      const dist = Math.hypot(dx, dz)
      // 골드는 항상 넉넉히 끌려옴(놓치지 않게)
      const range = it.type === 'gold' ? Math.max(magnetRange, 6) : magnetRange
      if (dist < range) {
        const d = dist || 1
        const pull = speed * (1 - dist / range) * 1.5 + 4
        it.pos.x += (dx / d) * pull * dt
        it.pos.z += (dz / d) * pull * dt
      }
      it.sprite.position.set(it.pos.x, 0.5 + Math.sin(it.bob) * 0.1, it.pos.z)
      if (dist < pickupRange) {
        if (it.type === 'xp') xp += it.value
        else gold += it.value
        this.scene.remove(it.sprite)
        this.items.splice(i, 1)
      }
    }
    return { xp, gold }
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.sprite)
    this.items = []
  }
}
