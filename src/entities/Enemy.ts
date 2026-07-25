import * as THREE from 'three'
import { CONFIG } from '../config'
import { buildEnemySprite } from './EnemySprite'

export type EnemyKind = 'imp' | 'brute' | 'shooter' | 'boss'

interface KindDef {
  hp: number
  speed: number
  damage: number
  xp: number
  radius: number
  ranged?: boolean
  shootCd?: number
}

const DEFS: Record<EnemyKind, KindDef> = {
  imp: { hp: 1, speed: 1, damage: 1, xp: 1, radius: 0.6 },
  brute: { hp: 4.5, speed: 0.6, damage: 2.2, xp: 3.5, radius: 1.1 },
  shooter: { hp: 1.4, speed: 0.7, damage: 1.4, xp: 2.2, radius: 0.6, ranged: true, shootCd: 2.2 },
  boss: { hp: 40, speed: 0.85, damage: 3, xp: 30, radius: 1.9, ranged: true, shootCd: 1.6 },
}

let NEXT_ID = 1

/** 적 개체 */
export class Enemy {
  id = NEXT_ID++
  kind: EnemyKind
  group: THREE.Group
  pos = new THREE.Vector3()
  vel = new THREE.Vector3()
  hp: number
  maxHp: number
  speed: number
  damage: number
  xp: number
  radius: number
  alive = true
  contactTimer = 0
  shootTimer: number
  knockTimer = 0
  private hitFlash = 0
  private def: KindDef
  private bob = Math.random() * Math.PI * 2
  private mat: THREE.SpriteMaterial

  constructor(kind: EnemyKind, x: number, z: number, hpMul: number, dmgMul: number, speedMul: number) {
    this.kind = kind
    this.def = DEFS[kind]
    const built = buildEnemySprite(kind)
    this.group = built.group
    this.mat = built.mat
    this.pos.set(x, 0, z)
    this.group.position.copy(this.pos)
    this.maxHp = CONFIG.enemy.baseHp * this.def.hp * hpMul
    this.hp = this.maxHp
    this.speed = CONFIG.enemy.baseSpeed * this.def.speed * speedMul
    this.damage = CONFIG.enemy.baseDamage * this.def.damage * dmgMul
    this.xp = CONFIG.enemy.baseXp * this.def.xp
    this.radius = this.def.radius
    this.shootTimer = (this.def.shootCd ?? 0) * Math.random()
  }

  /** 반환: 발사할 적 투사체 방향(있으면) */
  update(dt: number, target: THREE.Vector3): THREE.Vector3 | null {
    if (this.hitFlash > 0) this.hitFlash -= dt
    if (this.contactTimer > 0) this.contactTimer -= dt

    const dir = new THREE.Vector3(target.x - this.pos.x, 0, target.z - this.pos.z)
    const dist = dir.length()
    if (dist > 0.001) dir.divideScalar(dist)

    let shoot: THREE.Vector3 | null = null

    if (this.knockTimer > 0) {
      // 넉백 중
      this.knockTimer -= dt
      this.pos.addScaledVector(this.vel, dt)
      this.vel.multiplyScalar(0.86)
    } else if (this.def.ranged) {
      // 원거리: 일정 거리 유지하며 사격
      const desired = 12
      if (dist > desired + 1.5) this.pos.addScaledVector(dir, this.speed * dt)
      else if (dist < desired - 2) this.pos.addScaledVector(dir, -this.speed * dt)
      this.shootTimer -= dt
      if (this.shootTimer <= 0) {
        this.shootTimer = this.def.shootCd ?? 2
        shoot = dir.clone()
      }
    } else {
      // 근접: 추격
      this.pos.addScaledVector(dir, this.speed * dt)
    }

    // 스프라이트 동기화 (빌보드 — 회전 불필요, 위아래 바운스)
    this.bob += dt * (this.def.ranged ? 2 : 8)
    this.group.position.set(this.pos.x, Math.abs(Math.sin(this.bob)) * 0.15, this.pos.z)

    // 피격 플래시 (흰색 번쩍)
    if (this.hitFlash > 0) this.mat.color.setRGB(2.2, 2.2, 2.2)
    else this.mat.color.setRGB(1, 1, 1)

    return shoot
  }

  takeDamage(amount: number) {
    this.hp -= amount
    this.hitFlash = 0.12
    if (this.hp <= 0) this.alive = false
  }

  knockback(fromX: number, fromZ: number, power: number) {
    if (this.kind === 'boss') return
    const dx = this.pos.x - fromX
    const dz = this.pos.z - fromZ
    const d = Math.hypot(dx, dz) || 1
    this.vel.set((dx / d) * power, 0, (dz / d) * power)
    this.knockTimer = 0.2
  }
}
