import * as THREE from 'three'
import { CONFIG } from '../config'
import { EnemySprite } from './EnemySprite'
import { noOutline } from '../rendering/toon'

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

export interface EnemyAttack {
  directions: THREE.Vector3[]
  speed: number
  /** 발사 전 바닥 경고 반경. directions가 비어 있으면 경고 단계다. */
  telegraphRadius?: number
}

const DEFS: Record<EnemyKind, KindDef> = {
  imp: { hp: 1, speed: 1, damage: 1, xp: 1, radius: 0.6 },
  brute: { hp: 4.5, speed: 0.6, damage: 2.2, xp: 3.5, radius: 1.1 },
  shooter: { hp: 1.4, speed: 0.7, damage: 1.4, xp: 2.2, radius: 0.6, ranged: true, shootCd: 2.2 },
  boss: { hp: 34, speed: 0.85, damage: 3, xp: 30, radius: 1.9, ranged: true, shootCd: 1.6 },
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
  elite: boolean
  alive = true
  contactTimer = 0
  shootTimer: number
  knockTimer = 0
  private hitFlash = 0
  private def: KindDef
  private bob = Math.random() * Math.PI * 2
  private sprite: EnemySprite
  private bossTell = 0
  private bossPattern = 0
  private bossAim = new THREE.Vector3(0, 0, 1)
  private eliteBarFill: THREE.Sprite | null = null

  constructor(kind: EnemyKind, x: number, z: number, hpMul: number, dmgMul: number, speedMul: number, elite = false) {
    this.kind = kind
    this.def = DEFS[kind]
    this.sprite = new EnemySprite(kind)
    this.group = this.sprite.group
    this.pos.set(x, 0, z)
    this.group.position.copy(this.pos)
    this.maxHp = CONFIG.enemy.baseHp * this.def.hp * hpMul
    this.hp = this.maxHp
    this.speed = CONFIG.enemy.baseSpeed * this.def.speed * speedMul
    this.damage = CONFIG.enemy.baseDamage * this.def.damage * dmgMul
    this.xp = CONFIG.enemy.baseXp * this.def.xp
    this.radius = this.def.radius
    this.elite = elite
    this.shootTimer = (this.def.shootCd ?? 0) * Math.random()
    if (elite) this.createEliteMarker()
  }

  /** 반환: 이번 프레임에 실행할 적 공격 이벤트(있으면) */
  update(dt: number, target: THREE.Vector3): EnemyAttack | null {
    if (this.hitFlash > 0) this.hitFlash -= dt
    if (this.contactTimer > 0) this.contactTimer -= dt

    const dir = new THREE.Vector3(target.x - this.pos.x, 0, target.z - this.pos.z)
    const dist = dir.length()
    if (dist > 0.001) dir.divideScalar(dist)

    let attack: EnemyAttack | null = null
    let moving = false

    if (this.knockTimer > 0) {
      // 넉백 중
      this.knockTimer -= dt
      this.pos.addScaledVector(this.vel, dt)
      this.vel.multiplyScalar(0.86)
    } else if (this.kind === 'boss') {
      // 보스는 거리를 유지하며 "경고 → 발사"의 명확한 리듬으로 패턴을 사용한다.
      const desired = 10
      // 경고 중에는 제자리에 멈춰, 바닥 텔레그래프와 실제 공격 위치가 일치한다.
      if (this.bossTell <= 0) {
        if (dist > desired + 1.5) {
          this.pos.addScaledVector(dir, this.speed * dt)
          moving = true
        } else if (dist < desired - 2) {
          this.pos.addScaledVector(dir, -this.speed * dt)
          moving = true
        }
      }

      if (this.bossTell > 0) {
        this.bossTell -= dt
        if (this.bossTell <= 0) {
          attack = this.fireBossPattern()
          this.sprite.playAttack(0.65)
        }
      } else {
        this.shootTimer -= dt
        if (this.shootTimer <= 0) {
          this.bossTell = 0.62
          this.bossAim.copy(dir)
          const enraged = this.hp / this.maxHp <= 0.5
          const radius = this.bossPattern === 1 ? (enraged ? 7.5 : 6.2) : 4.4
          attack = { directions: [], speed: 0, telegraphRadius: radius }
        }
      }
    } else if (this.def.ranged) {
      // 원거리: 일정 거리 유지하며 사격
      const desired = 12
      if (dist > desired + 1.5) {
        this.pos.addScaledVector(dir, this.speed * dt)
        moving = true
      } else if (dist < desired - 2) {
        this.pos.addScaledVector(dir, -this.speed * dt)
        moving = true
      }
      this.shootTimer -= dt
      if (this.shootTimer <= 0) {
        this.shootTimer = this.def.shootCd ?? 2
        attack = { directions: [dir.clone()], speed: 14 }
        this.sprite.playAttack(0.5) // 시전 모션
      }
    } else {
      // 근접: 추격
      this.pos.addScaledVector(dir, this.speed * dt)
      moving = true
      // 접촉 사거리에 들어오면 공격 모션
      if (dist < this.radius + 1.4) this.sprite.playAttack(0.4)
    }

    // 스프라이트 동기화 (빌보드 — 프레임 애니메이션 + 좌우 플립)
    this.bob += dt * (this.def.ranged ? 2 : 8)
    this.group.position.set(this.pos.x, 0, this.pos.z)
    const bobY = moving ? Math.abs(Math.sin(this.bob)) * 0.12 : 0
    this.sprite.update(dt, moving, dir.x < -0.05, this.hitFlash, bobY)
    if (this.eliteBarFill) this.eliteBarFill.scale.x = Math.max(0.04, 2.5 * Math.max(0, this.hp / this.maxHp))

    return attack
  }

  private fireBossPattern(): EnemyAttack {
    const enraged = this.hp / this.maxHp <= 0.5
    const base = Math.atan2(this.bossAim.z, this.bossAim.x)
    const makeDir = (angle: number) => new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
    let directions: THREE.Vector3[]

    if (this.bossPattern === 0) {
      // 추적 부채꼴: 이동을 멈추기보다 대시로 빠져나가도록 유도한다.
      const offsets = enraged ? [-0.52, -0.26, 0, 0.26, 0.52] : [-0.34, 0, 0.34]
      directions = offsets.map((offset) => makeDir(base + offset))
      this.shootTimer = enraged ? 1.7 : 2.15
    } else if (this.bossPattern === 1) {
      // 원형 파동: 보스 근처에 오래 머무르는 플레이를 견제한다.
      const count = enraged ? 12 : 8
      directions = Array.from({ length: count }, (_, i) => makeDir((Math.PI * 2 * i) / count))
      this.shootTimer = enraged ? 2.25 : 2.8
    } else {
      // 교차 사격: 안전 지점을 읽고 가로질러 이동하게 만든다.
      const offsets = enraged ? [-0.72, -0.36, 0, 0.36, 0.72] : [-0.62, -0.2, 0.2, 0.62]
      directions = offsets.map((offset) => makeDir(base + offset))
      this.shootTimer = enraged ? 1.9 : 2.35
    }

    this.bossPattern = (this.bossPattern + 1) % 3
    return { directions, speed: enraged ? 15 : 13 }
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

  /** 엘리트는 일반 적과 즉시 구분되도록 체력 바와 속성 보석을 띄운다. */
  private createEliteMarker() {
    const y = this.kind === 'brute' ? 4.4 : 3.4
    const background = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x17131e, transparent: true, opacity: 0.92, depthWrite: false }))
    background.position.set(0, y, 0)
    background.scale.set(2.7, 0.3, 1)
    this.group.add(background)

    const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xd996ff, transparent: true, opacity: 0.98, depthWrite: false }))
    fill.center.set(0, 0.5)
    fill.position.set(-1.25, y, 0.02)
    fill.scale.set(2.5, 0.16, 1)
    this.group.add(fill)
    this.eliteBarFill = fill

    const badgeMat = noOutline(new THREE.MeshStandardMaterial({ color: 0xffd66d, emissive: 0xffa12c, emissiveIntensity: 0.8 }))
    const badge = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), badgeMat)
    badge.position.set(0, y + 0.36, 0)
    this.group.add(badge)
  }
}
