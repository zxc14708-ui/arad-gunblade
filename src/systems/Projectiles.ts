import * as THREE from 'three'
import { bulletTex } from '../rendering/pixelfx'
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
  private bulletMat = new THREE.SpriteMaterial({ map: bulletTex(), transparent: true, depthWrite: false })
  private critMat = new THREE.SpriteMaterial({ map: bulletTex(), color: 0xffffff, transparent: true, depthWrite: false })
  private ebMat = this.makeEnemyBulletMaterial()

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private makeEnemyBulletMaterial() {
    const map = cloneTex(ASSET.stage1.effects.fireball)
    map.repeat.set(1 / 4, 1)
    return new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false })
  }

  spawnBullet(pos: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, crit: boolean, pierce: number) {
    const mesh = new THREE.Sprite(crit ? this.critMat : this.bulletMat)
    mesh.position.copy(pos)
    mesh.scale.setScalar(crit ? 0.9 : 0.6)
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
    this.bullets.splice(i, 1)
  }
  removeEnemyBullet(i: number) {
    this.scene.remove(this.enemyBullets[i].mesh)
    this.enemyBullets.splice(i, 1)
  }

  clear() {
    for (const b of this.bullets) this.scene.remove(b.mesh)
    for (const b of this.enemyBullets) this.scene.remove(b.mesh)
    this.bullets = []
    this.enemyBullets = []
  }
}
