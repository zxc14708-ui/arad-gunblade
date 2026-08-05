import * as THREE from 'three'
import { CONFIG } from '../config'
import { EnemySprite } from './EnemySprite'
import { noOutline } from '../rendering/toon'
import { ELITE_AFFIX, EliteAffix } from '../systems/EliteAffixes'

export type EnemyKind =
  | 'imp' | 'brute' | 'shooter' | 'boss'
  | 'suicide' | 'frostSuicide' | 'fireMage' | 'iceMage'
  | 'summoner' | 'zombie' | 'voidMage' | 'charger'

export type EnemyAction =
  | { type: 'shoot'; direction: THREE.Vector3; style?: 'fire' | 'ice' | 'void'; speed?: number; homing?: number; slowDuration?: number }
  | { type: 'areaStrike'; position: THREE.Vector3; radius: number; damageMultiplier: number; style: 'fire' | 'ice' | 'void'; slowZoneDuration?: number; slowMultiplier?: number }
  | { type: 'summon'; kind: 'suicide' | 'zombie'; artSet: string; count: number }
  | { type: 'bossGroundFx'; effect: 'warning' | 'shockwave' | 'tealMagic'; position: THREE.Vector3; radius: number; duration: number }
  | { type: 'bossSlam'; position: THREE.Vector3; radius: number; damageMultiplier: number; effectDuration: number; phaseEntry: boolean }
  | { type: 'eliteRegenFx'; position: THREE.Vector3; radius: number; duration: number }
type BossSlamAction = Extract<EnemyAction, { type: 'bossSlam' }>
export type DamageSource = 'ranged' | 'melee'

interface KindDef {
  hp: number
  speed: number
  damage: number
  xp: number
  radius: number
  ranged?: boolean
  shootCd?: number
}

export const DEFS: Record<EnemyKind, KindDef> = {
  imp: { hp: 1, speed: 1, damage: 1, xp: 1, radius: 0.6 },
  brute: { hp: 4.5, speed: 0.6, damage: 2.2, xp: 3.5, radius: 1.1 },
  shooter: { hp: 1.4, speed: 0.7, damage: 1.4, xp: 2.2, radius: 0.6, ranged: true, shootCd: 2.2 },
  boss: { hp: 34, speed: 0.85, damage: 3, xp: 30, radius: 1.9, ranged: true, shootCd: 1.6 },
  suicide: { hp: 1.1, speed: 1.2, damage: 1.2, xp: 1.7, radius: 0.65 },
  frostSuicide: { hp: 1.25, speed: 1.12, damage: 1.15, xp: 2, radius: 0.65 },
  fireMage: { hp: 1.8, speed: 0.62, damage: 1.55, xp: 2.8, radius: 0.7, ranged: true, shootCd: 3.2 },
  iceMage: { hp: 1.9, speed: 0.58, damage: 1.45, xp: 3, radius: 0.7, ranged: true, shootCd: 2.8 },
  summoner: { hp: 2.2, speed: 0.55, damage: 1.2, xp: 3.4, radius: 0.75, ranged: true, shootCd: 6 },
  zombie: { hp: 1.8, speed: 0.55, damage: 1.25, xp: 0.7, radius: 0.65 },
  voidMage: { hp: 2.1, speed: 0.65, damage: 1.65, xp: 3.5, radius: 0.72, ranged: true, shootCd: 2.5 },
  charger: { hp: 3.2, speed: 0.78, damage: 1.8, xp: 4, radius: 0.95 },
}

// 보스 패턴 수치는 이후 config로 옮기기 쉽도록 이 파일 한 곳에 모아 둔다.
const BOSS_PATTERN = {
  range: 6,
  shootChance: 0.3,
  charge: {
    telegraph: 0.7,
    phaseTwoTelegraph: 0.5,
    duration: 1.0,
    speedMultiplier: 3.5,
    contactDamageMultiplier: 1.5,
    stagger: 1.2,
    phaseTwoStagger: 0.9,
  },
  slam: {
    telegraph: 0.9,
    phaseTwoTelegraph: 0.65,
    radius: 7,
    damageMultiplier: 2.0,
    stagger: 1.0,
    phaseTwoStagger: 0.75,
  },
  staggerDamageMultiplier: 1.3,
} as const

type BossState = 'idle' | 'chargeWarning' | 'charge' | 'slamWarning' | 'stagger'
type BossPattern = 'charge' | 'slam' | 'shoot'

let NEXT_ID = 1

/** 적 개체 */
export class Enemy {
  id = NEXT_ID++
  kind: EnemyKind
  artSet: string
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
  affix: EliteAffix | undefined
  alive = true
  contactTimer = 0
  shootTimer: number
  knockTimer = 0
  private hitFlash = 0
  private hitFlashCrit = false
  private def: KindDef
  private bob = Math.random() * Math.PI * 2
  /** 원거리 적이 같은 거리 지점에 멈춰 겹치지 않도록 개체마다 반대 공전 방향을 준다. */
  private rangedStrafeSign = 1
  private sprite: EnemySprite
  private eliteBarFill: THREE.Sprite | null = null
  private shieldBarFill: THREE.Sprite | null = null

  private bossState: BossState = 'idle'
  private bossTimer = 0
  private bossFacing = new THREE.Vector3(0, 0, 1)
  private bossAnchor = new THREE.Vector3()
  private bossPhaseTwo = false
  private bossStaggerVulnerable = false
  private bossHistory: BossPattern[] = []
  private lastHitTimer = -1
  private regenEffectTimer = 0
  private shield = 0
  private maxShield = 0
  private shieldHitTimer = -1
  /** '표식'(대시 핵심 슬롯 특성) — 남은 시간(초) 동안 받는 피해 +35% */
  private markTimer = 0
  /** 효과 영역(슬로우 존)의 이동속도 배율 — 여러 존이 겹치면 가장 강한(값이
   * 작은) 쪽을 유지한다(Game.updateSlowZones 참고, 작업 지시 P6 커밋1). */
  private movementSlowMultiplier = 1
  private movementSlowTimer = 0
  /** Game이 매 프레임 배정하는 원거리 포위 각도(라디안). null이면(포위 대상이
   * 아니거나 아직 배정 전) keepRange()가 옛 거리유지+좌우 스트레이프로 대체
   * 동작한다(작업 지시 P6 커밋1-2 — 각도 슬롯 포위). */
  surroundAngle: number | null = null
  private stageTier: number
  private specialState: 'idle' | 'fuse' | 'cast' | 'chargeWarning' | 'charge' = 'idle'
  private specialTimer = 0
  private specialAnchor = new THREE.Vector3()
  private specialFacing = new THREE.Vector3(0, 0, 1)
  private teleportTimer = 0
  private bossSpecialCursor = 0

  constructor(
    kind: EnemyKind,
    artSet: string,
    x: number,
    z: number,
    hpMul: number,
    dmgMul: number,
    speedMul: number,
    xpMul = 1,
    elite = false,
    affix?: EliteAffix,
    stageTier = 1,
  ) {
    this.kind = kind
    this.stageTier = stageTier
    this.artSet = artSet
    this.rangedStrafeSign = this.id % 2 === 0 ? 1 : -1
    this.def = DEFS[kind]
    this.sprite = new EnemySprite(artSet)
    this.group = this.sprite.group
    this.pos.set(x, 0, z)
    this.group.position.copy(this.pos)
    this.elite = elite && kind !== 'boss'
    this.affix = this.elite ? affix : undefined
    this.maxHp = CONFIG.enemy.baseHp * this.def.hp * hpMul
    if (this.affix === 'swift') this.maxHp *= ELITE_AFFIX.swift.hpMultiplier
    this.hp = this.maxHp
    if (this.affix === 'ward') {
      this.maxShield = this.maxHp * ELITE_AFFIX.ward.maxHpRatio
      this.shield = this.maxShield
    }
    this.speed = CONFIG.enemy.baseSpeed * this.def.speed * speedMul
    if (this.affix === 'swift') this.speed *= ELITE_AFFIX.swift.speedMultiplier
    this.damage = CONFIG.enemy.baseDamage * this.def.damage * dmgMul
    this.xp = CONFIG.enemy.baseXp * this.def.xp * xpMul
    this.radius = this.def.radius
    this.shootTimer = kind === 'boss' ? 0 : (this.def.shootCd ?? 0) * Math.random()
    this.teleportTimer = CONFIG.enemy.stagePatterns.voidMage.teleportCooldown * 0.5
    if (this.elite) this.createEliteMarker()
  }

  get isBossCharging() {
    return this.kind === 'boss' && this.bossState === 'charge'
  }

  get isCharging() {
    return this.isBossCharging || (this.kind === 'charger' && this.specialState === 'charge')
  }

  /** 거리 유지 원거리 AI(keepRange 사용) 대상인지 — 각도 슬롯 포위 배정 후보를
   * Game이 이걸로 고른다. boss는 ranged=true지만 자체 상태머신을 쓰므로 제외. */
  get wantsSurroundSlot() {
    return this.def.ranged === true && this.kind !== 'boss'
  }

  private get effectiveSpeed() {
    return this.speed * this.movementSlowMultiplier
  }

  /** 효과 영역(슬로우 존) 등에서 호출 — 가장 강한 감속을 유지하고 지속시간을
   * 갱신한다. 매 프레임 안에 있는 동안 계속 호출되는 방식(Game.updateSlowZones). */
  applyMovementSlow(multiplier: number, duration: number) {
    this.movementSlowMultiplier = Math.min(this.movementSlowMultiplier, multiplier)
    this.movementSlowTimer = Math.max(this.movementSlowTimer, duration)
  }

  get contactDamage() {
    const mul = this.isBossCharging
      ? BOSS_PATTERN.charge.contactDamageMultiplier
      : this.kind === 'charger' && this.specialState === 'charge'
        ? CONFIG.enemy.stagePatterns.charger.damageMultiplier
        : 1
    return this.damage * mul
  }

  /** 방 벽에 닿은 돌진 보스를 즉시 경직 상태로 전환한다. */
  stopBossChargeAtWall() {
    if (!this.isBossCharging) return
    this.beginBossStagger(this.chargeStaggerDuration(), true)
  }

  /** 반환: 적이 이번 프레임에 실행한 행동. */
  update(dt: number, target: THREE.Vector3): EnemyAction[] {
    if (this.hitFlash > 0) this.hitFlash -= dt
    if (this.contactTimer > 0) this.contactTimer -= dt
    if (this.markTimer > 0) this.markTimer -= dt
    if (this.movementSlowTimer > 0) {
      this.movementSlowTimer -= dt
      if (this.movementSlowTimer <= 0) this.movementSlowMultiplier = 1
    }

    const dir = new THREE.Vector3(target.x - this.pos.x, 0, target.z - this.pos.z)
    const dist = dir.length()
    if (dist > 0.001) dir.divideScalar(dist)

    let moving = false
    let actions: EnemyAction[] = []

    actions.push(...this.updateAffix(dt))

    if (this.knockTimer > 0) {
      this.knockTimer -= dt
      this.pos.addScaledVector(this.vel, dt)
      this.vel.multiplyScalar(0.86)
      moving = true
    } else if (this.kind === 'boss') {
      const result = this.updateBoss(dt, dir, dist)
      actions = result.actions
      moving = result.moving
    } else if (this.kind === 'suicide' || this.kind === 'frostSuicide') {
      const result = this.updateSuicide(dt, dir, dist)
      actions.push(...result.actions)
      moving = result.moving
    } else if (this.kind === 'fireMage') {
      const result = this.updateFireMage(dt, dir, dist, target)
      actions.push(...result.actions)
      moving = result.moving
    } else if (this.kind === 'iceMage') {
      const result = this.updateProjectileMage(dt, dir, dist, target, 'ice')
      actions.push(...result.actions)
      moving = result.moving
    } else if (this.kind === 'summoner') {
      const result = this.updateSummoner(dt, dir, dist, target)
      actions.push(...result.actions)
      moving = result.moving
    } else if (this.kind === 'voidMage') {
      const result = this.updateProjectileMage(dt, dir, dist, target, 'void')
      actions.push(...result.actions)
      moving = result.moving
    } else if (this.kind === 'charger') {
      const result = this.updateCharger(dt, dir, dist)
      actions.push(...result.actions)
      moving = result.moving
    } else if (this.def.ranged) {
      // shooter(스테이지1 기본 원거리)도 다른 원거리 kind와 같은 keepRange()로
      // 통일했다 — 각도 슬롯 포위가 전 스테이지(모든 원거리 종류)에 적용돼야
      // 한다(작업 지시 P6 커밋1-2).
      moving = this.keepRange(dt, dir, dist, CONFIG.enemy.stagePatterns.shooter.preferredRange, target)
      this.shootTimer -= dt
      if (this.shootTimer <= 0) {
        this.shootTimer = this.def.shootCd ?? 2
        actions.push({ type: 'shoot', direction: dir.clone() })
        this.sprite.playAttack(0.5)
      }
    } else {
      this.pos.addScaledVector(dir, this.effectiveSpeed * dt)
      moving = true
      if (dist < this.radius + 1.4) this.sprite.playAttack(0.4)
    }

    this.bob += dt * (this.def.ranged ? 2 : 8)
    this.group.position.set(this.pos.x, 0, this.pos.z)
    const bobY = moving ? Math.abs(Math.sin(this.bob)) * 0.12 : 0
    const facing = this.kind === 'boss' && (this.bossState === 'chargeWarning' || this.bossState === 'charge')
      ? this.bossFacing
      : dir
    this.sprite.update(dt, moving, facing.x < -0.05, this.hitFlash, this.hitFlashCrit, bobY)
    if (this.eliteBarFill) this.eliteBarFill.scale.x = Math.max(0.04, 2.5 * Math.max(0, this.hp / this.maxHp))
    if (this.shieldBarFill) {
      this.shieldBarFill.visible = this.shield > 0
      this.shieldBarFill.scale.x = Math.max(0.04, 2.5 * Math.max(0, this.shield / this.maxShield))
    }

    return actions
  }

  /** 목표(target)와 desired 거리를 유지하며 이동한다. surroundAngle이
   * Game으로부터 배정돼 있으면(원거리 종류는 매 프레임 배정된다 — 작업 지시
   * P6 커밋1-2) 그 각도의 목표 지점을 향해 직접 걸어가 포위 대형을 만든다.
   * 배정이 없으면(보스 특수패턴 등 슬롯 대상이 아닌 경우) 기존의 거리
   * 유지+좌우 스트레이프로 대체 동작한다. */
  private keepRange(dt: number, dir: THREE.Vector3, dist: number, desired: number, target: THREE.Vector3) {
    if (this.surroundAngle !== null) {
      const slotX = target.x + Math.sin(this.surroundAngle) * desired
      const slotZ = target.z + Math.cos(this.surroundAngle) * desired
      const toSlotX = slotX - this.pos.x
      const toSlotZ = slotZ - this.pos.z
      const slotDist = Math.hypot(toSlotX, toSlotZ)
      if (slotDist < 0.6) return false
      this.pos.x += (toSlotX / slotDist) * this.effectiveSpeed * dt
      this.pos.z += (toSlotZ / slotDist) * this.effectiveSpeed * dt
      return true
    }
    if (dist > desired + 1.5) this.pos.addScaledVector(dir, this.effectiveSpeed * dt)
    else if (dist < desired - 2) this.pos.addScaledVector(dir, -this.effectiveSpeed * dt)
    else this.pos.addScaledVector(new THREE.Vector3(-dir.z * this.rangedStrafeSign, 0, dir.x * this.rangedStrafeSign), this.effectiveSpeed * dt)
    return true
  }

  private updateSuicide(dt: number, dir: THREE.Vector3, dist: number) {
    const cfg = this.kind === 'frostSuicide' ? CONFIG.enemy.stagePatterns.frostSuicide : CONFIG.enemy.stagePatterns.suicide
    if (this.specialState === 'fuse') {
      this.specialTimer -= dt
      this.sprite.playAttack(Math.max(dt, this.specialTimer))
      if (this.specialTimer <= 0) this.alive = false
      return { actions: [] as EnemyAction[], moving: false }
    }
    if (dist <= cfg.triggerRange) {
      this.specialState = 'fuse'
      this.specialTimer = cfg.fuse
      this.sprite.playAttack(cfg.fuse)
      return { actions: [] as EnemyAction[], moving: false }
    }
    this.pos.addScaledVector(dir, this.effectiveSpeed * dt)
    return { actions: [] as EnemyAction[], moving: true }
  }

  private updateFireMage(dt: number, dir: THREE.Vector3, dist: number, target: THREE.Vector3) {
    const cfg = CONFIG.enemy.stagePatterns.fireMage
    if (this.specialState === 'cast') {
      this.specialTimer -= dt
      this.sprite.playAttack(Math.max(dt, this.specialTimer))
      if (this.specialTimer <= 0) {
        this.specialState = 'idle'
        this.shootTimer = cfg.cooldown
        return { actions: [{ type: 'areaStrike', position: this.specialAnchor.clone(), radius: cfg.radius, damageMultiplier: cfg.damageMultiplier, style: 'fire' } as EnemyAction], moving: false }
      }
      return { actions: [] as EnemyAction[], moving: false }
    }
    this.shootTimer -= dt
    if (this.shootTimer <= 0) {
      this.specialState = 'cast'
      this.specialTimer = cfg.warning
      this.specialAnchor.copy(target)
      this.sprite.playAttack(cfg.warning)
      return { actions: [{ type: 'bossGroundFx', effect: 'warning', position: this.specialAnchor.clone(), radius: cfg.radius, duration: cfg.warning } as EnemyAction], moving: false }
    }
    return { actions: [] as EnemyAction[], moving: this.keepRange(dt, dir, dist, cfg.preferredRange, target) }
  }

  private updateProjectileMage(dt: number, dir: THREE.Vector3, dist: number, target: THREE.Vector3, style: 'ice' | 'void') {
    const cfg = style === 'ice' ? CONFIG.enemy.stagePatterns.iceMage : CONFIG.enemy.stagePatterns.voidMage
    const actions: EnemyAction[] = []
    if (style === 'void') {
      this.teleportTimer -= dt
      if (this.teleportTimer <= 0) {
        this.teleportTimer = CONFIG.enemy.stagePatterns.voidMage.teleportCooldown
        const side = this.rangedStrafeSign
        this.pos.x += -dir.z * side * 6
        this.pos.z += dir.x * side * 6
        this.rangedStrafeSign *= -1
        actions.push({ type: 'bossGroundFx', effect: 'tealMagic', position: this.pos.clone(), radius: 2, duration: 0.45 })
      }
    }
    this.shootTimer -= dt
    if (this.shootTimer <= 0) {
      this.shootTimer = cfg.cooldown
      this.sprite.playAttack(0.5)
      const slowDuration = style === 'ice' ? CONFIG.enemy.stagePatterns.iceMage.slowDuration : 0
      actions.push({ type: 'shoot', direction: dir.clone(), style, speed: cfg.projectileSpeed, homing: cfg.homing, slowDuration })
    }
    return { actions, moving: this.keepRange(dt, dir, dist, cfg.preferredRange, target) }
  }

  private updateSummoner(dt: number, dir: THREE.Vector3, dist: number, target: THREE.Vector3) {
    const cfg = CONFIG.enemy.stagePatterns.summoner
    this.shootTimer -= dt
    const actions: EnemyAction[] = []
    if (this.shootTimer <= 0) {
      this.shootTimer = cfg.cooldown
      this.sprite.playAttack(0.7)
      actions.push({ type: 'summon', kind: 'zombie', artSet: 's6Zombie', count: cfg.maxSummons })
    }
    return { actions, moving: this.keepRange(dt, dir, dist, cfg.preferredRange, target) }
  }

  private updateCharger(dt: number, dir: THREE.Vector3, dist: number) {
    const cfg = CONFIG.enemy.stagePatterns.charger
    if (this.specialState === 'chargeWarning') {
      this.specialTimer -= dt
      this.sprite.playAttack(Math.max(dt, this.specialTimer))
      if (this.specialTimer <= 0) {
        this.specialState = 'charge'
        this.specialTimer = cfg.duration
      }
      return { actions: [] as EnemyAction[], moving: false }
    }
    if (this.specialState === 'charge') {
      this.pos.addScaledVector(this.specialFacing, this.effectiveSpeed * cfg.speedMultiplier * dt)
      this.specialTimer -= dt
      if (this.specialTimer <= 0) this.specialState = 'idle'
      return { actions: [] as EnemyAction[], moving: true }
    }
    if (dist <= cfg.triggerRange && this.shootTimer <= 0) {
      this.specialState = 'chargeWarning'
      this.specialTimer = cfg.warning
      this.specialFacing.copy(dir)
      this.shootTimer = 2.2
      return { actions: [{ type: 'bossGroundFx', effect: 'warning', position: this.pos.clone(), radius: 1.6, duration: cfg.warning } as EnemyAction], moving: false }
    }
    this.shootTimer -= dt
    this.pos.addScaledVector(dir, this.effectiveSpeed * dt)
    return { actions: [] as EnemyAction[], moving: true }
  }

  private updateBoss(dt: number, dir: THREE.Vector3, dist: number) {
    const actions: EnemyAction[] = []
    let moving = false

    if (!this.bossPhaseTwo && this.hp <= this.maxHp * 0.5) {
      this.bossPhaseTwo = true
      const phaseShockwave = this.createBossSlamAction(true)
      actions.push({
        type: 'bossGroundFx',
        effect: 'tealMagic',
        position: this.pos.clone(),
        radius: BOSS_PATTERN.slam.radius,
        duration: phaseShockwave.effectDuration,
      }, phaseShockwave)
    }

    switch (this.bossState) {
      case 'idle':
        if (this.shootTimer > 0) {
          this.shootTimer -= dt
          break
        }
        actions.push(...this.chooseBossPattern(dir, dist))
        break
      case 'chargeWarning':
        this.bossTimer -= dt
        this.sprite.playCharge(Math.max(this.bossTimer, dt))
        if (this.bossTimer <= 0) {
          this.bossState = 'charge'
          this.bossTimer = BOSS_PATTERN.charge.duration
        }
        break
      case 'charge':
        this.pos.addScaledVector(this.bossFacing, this.effectiveSpeed * BOSS_PATTERN.charge.speedMultiplier * dt)
        moving = true
        this.bossTimer -= dt
        this.sprite.playCharge(Math.max(this.bossTimer, dt))
        if (this.bossTimer <= 0) this.beginBossStagger(this.chargeStaggerDuration(), true)
        break
      case 'slamWarning':
        this.bossTimer -= dt
        this.sprite.playAttack(Math.max(this.bossTimer, dt))
        if (this.bossTimer <= 0) {
          actions.push(this.createBossSlamAction(false))
          this.beginBossStagger(this.slamStaggerDuration(), true)
        }
        break
      case 'stagger':
        this.bossTimer -= dt
        if (this.bossTimer <= 0) {
          this.bossState = 'idle'
          this.bossStaggerVulnerable = false
        }
        break
    }

    return { actions, moving }
  }

  private chooseBossPattern(dir: THREE.Vector3, dist: number): EnemyAction[] {
    const special = this.chooseBossSpecial(dir)
    if (special) {
      this.shootTimer = this.def.shootCd ?? 1.6
      this.sprite.playAttack(0.65)
      return special
    }

    let pattern: BossPattern = Math.random() < BOSS_PATTERN.shootChance
      ? 'shoot'
      : dist >= BOSS_PATTERN.range ? 'charge' : 'slam'

    if (this.bossHistory.length >= 2 && this.bossHistory[0] === pattern && this.bossHistory[1] === pattern) {
      pattern = pattern === 'shoot' ? (dist >= BOSS_PATTERN.range ? 'charge' : 'slam') : 'shoot'
    }
    this.bossHistory.push(pattern)
    if (this.bossHistory.length > 2) this.bossHistory.shift()

    if (pattern === 'charge') {
      this.bossFacing.copy(dir)
      this.bossState = 'chargeWarning'
      this.bossTimer = this.chargeTelegraphDuration()
      this.sprite.playCharge(this.bossTimer)
      return []
    }

    if (pattern === 'slam') {
      this.bossAnchor.copy(this.pos)
      this.bossState = 'slamWarning'
      this.bossTimer = this.slamTelegraphDuration()
      this.sprite.playAttack(this.bossTimer)
      return [{
        type: 'bossGroundFx',
        effect: 'warning',
        position: this.bossAnchor.clone(),
        radius: BOSS_PATTERN.slam.radius,
        duration: this.bossTimer,
      }]
    }

    this.shootTimer = this.def.shootCd ?? 0
    this.sprite.playAttack(0.5)
    return [{ type: 'shoot', direction: dir.clone() }]
  }

  /** 상위 스테이지 보스는 이전 스테이지에서 해금된 특수 패턴을 누적해서 사용한다. */
  private chooseBossSpecial(dir: THREE.Vector3): EnemyAction[] | null {
    if (this.stageTier < 2 || Math.random() >= CONFIG.enemy.stagePatterns.bossSpecialChance) return null
    const unlocked: Array<'suicide' | 'fire' | 'ice' | 'zombie' | 'void'> = ['suicide']
    if (this.stageTier >= 4) unlocked.push('fire')
    if (this.stageTier >= 5) unlocked.push('ice')
    if (this.stageTier >= 6) unlocked.push('zombie')
    if (this.stageTier >= 7) unlocked.push('void')
    const pattern = unlocked[this.bossSpecialCursor++ % unlocked.length]
    if (pattern === 'suicide') return [{ type: 'summon', kind: 'suicide', artSet: this.stageTier === 3 ? 's3Suicide' : 's2Suicide', count: 2 }]
    if (pattern === 'fire') {
      const cfg = CONFIG.enemy.stagePatterns.fireMage
      return [
        { type: 'bossGroundFx', effect: 'warning', position: this.pos.clone(), radius: cfg.radius, duration: cfg.warning },
        { type: 'areaStrike', position: this.pos.clone(), radius: cfg.radius, damageMultiplier: cfg.damageMultiplier, style: 'fire' },
      ]
    }
    if (pattern === 'ice') {
      const cfg = CONFIG.enemy.stagePatterns.iceMage
      return [{ type: 'shoot', direction: dir.clone(), style: 'ice', speed: cfg.projectileSpeed, homing: cfg.homing, slowDuration: cfg.slowDuration }]
    }
    if (pattern === 'zombie') return [{ type: 'summon', kind: 'zombie', artSet: 's6Zombie', count: 2 }]
    const cfg = CONFIG.enemy.stagePatterns.voidMage
    this.pos.addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), 5)
    return [{ type: 'shoot', direction: dir.clone(), style: 'void', speed: cfg.projectileSpeed, homing: cfg.homing }]
  }

  private createBossSlamAction(phaseEntry: boolean): BossSlamAction {
    return {
      type: 'bossSlam',
      position: (phaseEntry ? this.pos : this.bossAnchor).clone(),
      radius: BOSS_PATTERN.slam.radius,
      damageMultiplier: BOSS_PATTERN.slam.damageMultiplier,
      effectDuration: this.slamStaggerDuration(),
      phaseEntry,
    }
  }

  private chargeTelegraphDuration() {
    return this.bossPhaseTwo ? BOSS_PATTERN.charge.phaseTwoTelegraph : BOSS_PATTERN.charge.telegraph
  }

  private slamTelegraphDuration() {
    return this.bossPhaseTwo ? BOSS_PATTERN.slam.phaseTwoTelegraph : BOSS_PATTERN.slam.telegraph
  }

  private chargeStaggerDuration() {
    return this.bossPhaseTwo ? BOSS_PATTERN.charge.phaseTwoStagger : BOSS_PATTERN.charge.stagger
  }

  private slamStaggerDuration() {
    return this.bossPhaseTwo ? BOSS_PATTERN.slam.phaseTwoStagger : BOSS_PATTERN.slam.stagger
  }

  private beginBossStagger(duration: number, vulnerable: boolean) {
    this.bossState = 'stagger'
    this.bossTimer = duration
    this.bossStaggerVulnerable = vulnerable
  }

  /** '표식' — 대시로 관통한 적을 duration초 동안 표식한다(기존 표식이 남아있으면 더 긴 쪽 유지). */
  mark(duration: number) {
    this.markTimer = Math.max(this.markTimer, duration)
  }

  get isMarked() {
    return this.markTimer > 0
  }

  takeDamage(amount: number, source: DamageSource = 'ranged', crit = false) {
    let effective = this.kind === 'boss' && this.bossState === 'stagger' && this.bossStaggerVulnerable
      ? amount * BOSS_PATTERN.staggerDamageMultiplier
      : amount
    if (this.markTimer > 0) effective *= CONFIG.traits.markedDamageMult
    if (this.affix === 'ward') {
      this.shieldHitTimer = 0
      const absorbed = Math.min(this.shield, effective)
      this.shield -= absorbed
      effective -= absorbed
    }
    this.hp -= effective
    this.hitFlash = this.kind === 'boss' ? CONFIG.effects.flashBossDuration : CONFIG.effects.flashDuration
    this.hitFlashCrit = crit
    this.lastHitTimer = 0
    if (this.hp <= 0) this.alive = false
    return this.affix === 'thorns' && source === 'melee' ? amount * ELITE_AFFIX.thorns.reflectRatio : 0
  }

  private updateAffix(dt: number): EnemyAction[] {
    if (this.affix === 'ward') {
      if (this.shieldHitTimer < 0 || this.shield >= this.maxShield) return []
      this.shieldHitTimer += dt
      if (this.shieldHitTimer >= ELITE_AFFIX.ward.rechargeDelay) this.shield = this.maxShield
      return []
    }

    if (this.affix !== 'regen' || this.hp >= this.maxHp || this.lastHitTimer < 0) return []

    this.lastHitTimer += dt
    if (this.lastHitTimer < ELITE_AFFIX.regen.delay) return []

    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * ELITE_AFFIX.regen.healPerSecond * dt)
    this.regenEffectTimer -= dt
    if (this.regenEffectTimer > 0) return []
    this.regenEffectTimer = ELITE_AFFIX.regen.effectInterval
    return [{
      type: 'eliteRegenFx',
      position: this.pos.clone(),
      radius: this.radius,
      duration: ELITE_AFFIX.regen.effectInterval,
    }]
  }

  /** 분열 접두사가 붙은 적의 사망 보상. 자식은 접두사·경험치를 갖지 않는다. */
  createSplitChildren(): Enemy[] {
    if (this.affix !== 'split' || this.kind === 'boss') return []
    return Array.from({ length: ELITE_AFFIX.split.childCount }, () => {
      const child = new Enemy(this.kind, this.artSet, this.pos.x, this.pos.z, 1, 1, 1, 1, false, undefined, this.stageTier)
      child.maxHp = this.maxHp * ELITE_AFFIX.split.hpMultiplier
      child.hp = child.maxHp
      child.speed = this.speed
      child.damage = this.damage
      child.xp = 0
      child.radius = this.radius * ELITE_AFFIX.split.scaleMultiplier
      child.group.scale.setScalar(ELITE_AFFIX.split.scaleMultiplier)
      return child
    })
  }

  /** 자폭형은 근접 발화 또는 원거리 처치 어느 쪽이든 사망 지점에서 폭발한다. */
  deathBurst(): { radius: number; damageMultiplier: number; slowZoneDuration: number; slowMultiplier: number } | null {
    if (this.kind === 'suicide') {
      const cfg = CONFIG.enemy.stagePatterns.suicide
      return { radius: cfg.radius, damageMultiplier: cfg.damageMultiplier, slowZoneDuration: 0, slowMultiplier: 1 }
    }
    if (this.kind === 'frostSuicide') {
      const cfg = CONFIG.enemy.stagePatterns.frostSuicide
      return { radius: cfg.radius, damageMultiplier: cfg.damageMultiplier, slowZoneDuration: cfg.slowZoneDuration, slowMultiplier: cfg.slowMultiplier }
    }
    return null
  }

  knockback(fromX: number, fromZ: number, power: number) {
    if (this.kind === 'boss') return
    const dx = this.pos.x - fromX
    const dz = this.pos.z - fromZ
    const d = Math.hypot(dx, dz) || 1
    this.vel.set((dx / d) * power, 0, (dz / d) * power)
    this.knockTimer = 0.2
  }

  private createEliteMarker() {
    const y = this.kind === 'brute' ? 4.4 : 3.4
    const bg = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x17131e, transparent: true, opacity: 0.92, depthWrite: false }),
    )
    bg.position.set(0, y, 0)
    bg.scale.set(2.7, 0.3, 1)
    this.group.add(bg)

    const color = this.affix ? ELITE_AFFIX[this.affix].color : 0xd996ff
    const fill = new THREE.Sprite(
      new THREE.SpriteMaterial({ color, transparent: true, opacity: 0.98, depthWrite: false }),
    )
    fill.center.set(0, 0.5)
    fill.position.set(-1.25, y, 0.02)
    fill.scale.set(2.5, 0.16, 1)
    this.group.add(fill)
    this.eliteBarFill = fill

    if (this.affix === 'ward') {
      const shield = new THREE.Sprite(
        new THREE.SpriteMaterial({ color: ELITE_AFFIX.ward.color, transparent: true, opacity: 0.98, depthWrite: false }),
      )
      shield.center.set(0, 0.5)
      shield.position.set(-1.25, y + 0.22, 0.02)
      shield.scale.set(2.5, 0.1, 1)
      this.group.add(shield)
      this.shieldBarFill = shield
    }

    const badge = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.18, 0),
      noOutline(new THREE.MeshStandardMaterial({ color: 0xffd66d, emissive: 0xffa12c, emissiveIntensity: 0.8 })),
    )
    badge.position.set(0, y + 0.36, 0)
    this.group.add(badge)
  }
}
