import * as THREE from 'three'
import { bulletTex, enemyBulletTex } from '../rendering/pixelfx'

export interface Bullet {
  mesh: THREE.Sprite
  pos: THREE.Vector3
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
  private ebMat = new THREE.SpriteMaterial({ map: enemyBulletTex(), transparent: true, depthWrite: false })

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  spawnBullet(pos: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, crit: boolean, pierce: number) {
    const mesh = new THREE.Sprite(crit ? this.critMat : this.bulletMat)
    mesh.position.copy(pos)
    mesh.scale.setScalar(crit ? 0.9 : 0.6)
    this.scene.add(mesh)
    this.bullets.push({
      mesh,
      pos: pos.clone(),
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
    mesh.scale.setScalar(0.8)
    this.scene.add(mesh)
    this.enemyBullets.push({ mesh, pos: pos.clone(), dir: dir.clone().normalize(), speed, life: 4, damage })
  }

  update(dt: number, arenaRadius: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]
      b.life -= dt
      b.pos.addScaledVector(b.dir, b.speed * dt)
      b.mesh.position.copy(b.pos)
      const r = Math.hypot(b.pos.x, b.pos.z)
      if (b.life <= 0 || r > arenaRadius + 2) this.removeBullet(i)
    }
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i]
      b.life -= dt
      b.pos.addScaledVector(b.dir, b.speed * dt)
      b.mesh.position.copy(b.pos)
      const r = Math.hypot(b.pos.x, b.pos.z)
      if (b.life <= 0 || r > arenaRadius + 2) this.removeEnemyBullet(i)
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
