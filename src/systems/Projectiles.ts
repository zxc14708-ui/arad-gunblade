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
  /** '도탄'(shot) — 이 총알이 이미 한 번 튕겼는지(탄환당 1회만 허용) */
  ricocheted: boolean
  /** '순환'(skill) — 이 탄환이 처치를 내면 어느 스킬 기인인지. 일반 사격은 undefined */
  skillSource?: 'doubleShot' | 'ultimate'
}

export interface EnemyBullet {
  mesh: THREE.Sprite
  pos: THREE.Vector3
  dir: THREE.Vector3
  speed: number
  life: number
  damage: number
  style: 'fire' | 'ice' | 'void'
  homing: number
  slowDuration: number
}

/** 플레이어/적 투사체 풀 관리 */
export class Projectiles {
  scene: THREE.Scene
  bullets: Bullet[] = []
  enemyBullets: EnemyBullet[] = []
  private bulletMat = new THREE.SpriteMaterial({ map: bulletTex(), transparent: true, depthWrite: false })
  private critMat = new THREE.SpriteMaterial({ map: bulletTex(), color: 0xffffff, transparent: true, depthWrite: false })
  private ebMats = {
    fire: this.makeEnemyBulletMaterial(0xffffff),
    ice: this.makeEnemyBulletMaterial(0x78d8ff),
    void: this.makeEnemyBulletMaterial(0xd178ff),
  }

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private makeEnemyBulletMaterial(color: number) {
    const map = cloneTex(ASSET.stage1.effects.fireball)
    map.repeat.set(1 / 4, 1)
    return new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false })
  }

  spawnBullet(
    pos: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, crit: boolean, pierce: number,
    skillSource?: 'doubleShot' | 'ultimate',
  ) {
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
      ricocheted: false,
      skillSource,
    })
  }

  spawnEnemyBullet(
    pos: THREE.Vector3,
    dir: THREE.Vector3,
    speed: number,
    damage: number,
    style: EnemyBullet['style'] = 'fire',
    homing = 0,
    slowDuration = 0,
  ) {
    const mesh = new THREE.Sprite(this.ebMats[style])
    mesh.position.copy(pos)
    // 화염구 고블린 투사체는 기존 표시 크기의 정확히 2배.
    mesh.scale.setScalar(1.6)
    this.scene.add(mesh)
    this.enemyBullets.push({ mesh, pos: pos.clone(), dir: dir.clone().normalize(), speed, life: 4, damage, style, homing, slowDuration })
  }

  /** 방 경계(사각형) 밖으로 나간 투사체는 제거 */
  update(dt: number, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, target?: THREE.Vector3) {
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
      if (target && b.homing > 0) {
        const desired = new THREE.Vector3(target.x - b.pos.x, 0, target.z - b.pos.z).normalize()
        b.dir.lerp(desired, Math.min(1, b.homing * dt)).normalize()
      }
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
