import * as THREE from 'three'
import { ASSET, cloneTex } from '../rendering/assets'

export interface Bullet {
  mesh: THREE.Sprite
  pos: THREE.Vector3
  /** 발사 시점 위치(불변) — 명중 시 거리 보너스 계산용. pos는 매 프레임 이동한다 */
  spawnPos: THREE.Vector3
  dir: THREE.Vector3
  speed: number
  life: number
  damage: number
  crit: boolean
  pierce: number
  hitSet: Set<number>
}

export interface EnemyBullet {
  mesh: THREE.Sprite
  pos: THREE.Vector3
  dir: THREE.Vector3
  speed: number
  life: number
  damage: number
}

/** 플레이어/적 투사체 풀 관리 */
export class Projectiles {
  scene: THREE.Scene
  bullets: Bullet[] = []
  enemyBullets: EnemyBullet[] = []
  private bulletMaterials = new Map<string, THREE.SpriteMaterial>()
  private critMaterials = new Map<string, THREE.SpriteMaterial>()
  private ebMat = this.makeEnemyBulletMaterial()

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private makeEnemyBulletMaterial() {
    const map = cloneTex(ASSET.stage1.effects.fireball)
    map.repeat.set(1 / 4, 1)
    return new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false })
  }

  private bulletMaterial(gunId: string, crit: boolean) {
    const cache = crit ? this.critMaterials : this.bulletMaterials
    let material = cache.get(gunId)
    if (!material) {
      const texture = cloneTex(ASSET.player.projectiles)
      const index = GUN_PROJECTILE_INDEX[gunId] ?? 0
      texture.repeat.set(1 / 7, 1)
      texture.offset.set(index / 7, 0)
      material = new THREE.SpriteMaterial({
        map: texture,
        color: crit ? 0xff5b5b : 0xffffff,
        transparent: true,
        depthWrite: false,
      })
      cache.set(gunId, material)
    }
    return material
  }

  spawnBullet(pos: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, crit: boolean, pierce: number, gunId = 'm1911') {
    // Rotation is per projectile, so each sprite gets a material clone while
    // sharing the cached texture/style definition for its weapon.
    const material = this.bulletMaterial(gunId, crit).clone()
    const mesh = new THREE.Sprite(material)
    mesh.position.copy(pos)
    mesh.scale.setScalar((crit ? 0.9 : 0.6) * (GUN_PROJECTILE_SCALE[gunId] ?? 1))
    material.rotation = -Math.atan2(dir.x, dir.z) + Math.PI / 2
    this.scene.add(mesh)
    this.bullets.push({
      mesh,
      pos: pos.clone(),
      spawnPos: pos.clone(),
      dir: dir.clone().normalize(),
      speed,
      life: 1.1,
      damage,
      crit,
      pierce,
      hitSet: new Set(),
    })
  }

  spawnEnemyBullet(pos: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number) {
    const mesh = new THREE.Sprite(this.ebMat)
    mesh.position.copy(pos)
    // 화염구 고블린 투사체는 기존 표시 크기의 정확히 2배.
    mesh.scale.setScalar(1.6)
    this.scene.add(mesh)
    this.enemyBullets.push({ mesh, pos: pos.clone(), dir: dir.clone().normalize(), speed, life: 4, damage })
  }

  /** 방 경계(사각형) 밖으로 나간 투사체는 제거 */
  update(dt: number, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    const out = (p: THREE.Vector3) =>
      p.x < bounds.minX - 1 || p.x > bounds.maxX + 1 || p.z < bounds.minZ - 1 || p.z > bounds.maxZ + 1
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]
      b.life -= dt
      b.pos.addScaledVector(b.dir, b.speed * dt)
      b.mesh.position.copy(b.pos)
      if (b.life <= 0 || out(b.pos)) this.removeBullet(i)
    }
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i]
      b.life -= dt
      b.pos.addScaledVector(b.dir, b.speed * dt)
      b.mesh.position.copy(b.pos)
      if (b.life <= 0 || out(b.pos)) this.removeEnemyBullet(i)
    }
  }

  removeBullet(i: number) {
    this.scene.remove(this.bullets[i].mesh)
    ;(this.bullets[i].mesh.material as THREE.Material).dispose()
    this.bullets.splice(i, 1)
  }
  removeEnemyBullet(i: number) {
    this.scene.remove(this.enemyBullets[i].mesh)
    this.enemyBullets.splice(i, 1)
  }

  clear() {
    for (const b of this.bullets) {
      this.scene.remove(b.mesh)
      ;(b.mesh.material as THREE.Material).dispose()
    }
    for (const b of this.enemyBullets) this.scene.remove(b.mesh)
    this.bullets = []
    this.enemyBullets = []
  }
}

const GUN_PROJECTILE_INDEX: Record<string, number> = {
  m1911: 0,
  smg: 1,
  shotgun: 2,
  rifle: 3,
  magnum: 4,
  crossbow: 5,
  autocannon: 6,
}

const GUN_PROJECTILE_SCALE: Record<string, number> = {
  shotgun: 0.8,
  rifle: 1.2,
  magnum: 1.15,
  crossbow: 1.05,
  autocannon: 1.1,
}
