import * as THREE from 'three'
import { COLORS } from '../config'

export interface Bullet {
  mesh: THREE.Mesh
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
  mesh: THREE.Mesh
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
  private bulletGeo = new THREE.SphereGeometry(0.16, 8, 8)
  private ebGeo = new THREE.SphereGeometry(0.28, 10, 10)
  private bulletMat = new THREE.MeshBasicMaterial({ color: COLORS.bullet })
  private critMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  private ebMat = new THREE.MeshBasicMaterial({ color: COLORS.enemyBullet })

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  spawnBullet(pos: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, crit: boolean, pierce: number) {
    const mesh = new THREE.Mesh(this.bulletGeo, crit ? this.critMat : this.bulletMat)
    mesh.position.copy(pos)
    if (crit) mesh.scale.setScalar(1.5)
    this.scene.add(mesh)
    // 궤적 잔상 느낌: 살짝 늘림
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
    const mesh = new THREE.Mesh(this.ebGeo, this.ebMat)
    mesh.position.copy(pos)
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
