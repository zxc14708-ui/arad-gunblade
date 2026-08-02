import * as THREE from 'three'
import { CONFIG } from '../config'
import { Input } from '../core/Input'
import { CharacterSprite } from './CharacterSprite'
import { GunDef, SwordDef, START_GUN, START_SWORD } from '../systems/Weapons'
import { MetaBonuses } from '../systems/MetaProgression'
import type { CoreSlot, UpgradeSlot } from '../systems/Upgrades'

/** 무기 정의 × 특성 배수로 산출되는 실효 스탯 */
export interface PlayerStats {
  maxHp: number
  moveSpeed: number
  dashCooldown: number
  // 총
  gunDamage: number
  gunCooldown: number
  bulletSpeed: number
  pierce: number
  multishot: number
  spread: number
  magSize: number
  reloadTime: number
  // 검
  swordDamage: number
  swordRange: number
  swordCooldown: number
  swordArc: number
  knockback: number
  lunge: number
  // 공통
  critChance: number
  critMult: number
  lifesteal: number
  magnetRange: number
  xpGain: number
}

/** 특성이 누적하는 배수/가산치 + 레전더리 특수 효과 플래그 */
export interface Mods {
  gunDamage: number // ×
  gunCooldown: number // ×
  bulletSpeed: number // ×
  reloadTime: number // ×
  pierce: number // +
  multishot: number // +
  swordDamage: number // ×
  swordRange: number // ×
  swordCooldown: number // ×
  moveSpeed: number // ×
  dashCooldown: number // ×
  maxHp: number // +
  critChance: number // +
  critMult: number // 기본 2, +
  lifesteal: number // +
  magnetRange: number // ×
  xpGain: number // ×
  // 레전더리 특수
  explodeOnKill: number // >0이면 처치 시 폭발 데미지
  swordReloads: boolean // 검을 휘두르면 총 즉시 장전 (총검일체 전용, 발도장전은 기본 메커니즘으로 이관)
  dashStrike: number // >0이면 대시 종료 시 주변 데미지
  // 검 적중 시 장전 (기본 메커니즘 — 발도장전은 이 값들을 강화한다)
  swordReloadAmount: number // 검이 적을 맞히면 장전되는 총알 수 (기본 1)
  swordReloadBurstBonus: number // >0이면 검으로 장전한 직후 발사하는 총알 N발의 피해 배율 보너스
}

function freshMods(): Mods {
  return {
    gunDamage: 1, gunCooldown: 1, bulletSpeed: 1, reloadTime: 1, pierce: 0, multishot: 0,
    swordDamage: 1, swordRange: 1, swordCooldown: 1, moveSpeed: 1, dashCooldown: 1,
    maxHp: 0, critChance: 0, critMult: 2, lifesteal: 0, magnetRange: 1, xpGain: 1,
    explodeOnKill: 0, swordReloads: false, dashStrike: 0,
    // '발도장전'(lg_quickdraw)이 기본 메커니즘으로 승격됐다(작업 지시
    // slot_system_phase1 커밋 3) — 검 적중 직후 총알 3발에 항상 +30% 피해.
    swordReloadAmount: 1, swordReloadBurstBonus: 0.3,
  }
}

export interface BulletSpec {
  pos: THREE.Vector3
  dir: THREE.Vector3
  damage: number
  crit: boolean
  /** '순환'(skill) — 이 탄환이 처치를 낸 스킬을 식별한다. 일반 사격은 없음(undefined) */
  skillSource?: 'doubleShot' | 'ultimate'
}

export interface SlashSpec {
  pos: THREE.Vector3
  angle: number
  arc: number
  range: number
  damage: number
  crit: boolean
  knockback: number
}

export interface IaidoSpec {
  start: THREE.Vector3
  damage: number
  crit: boolean
  knockback: number
}

export interface UltimateSpec {
  slashes: [SlashSpec, SlashSpec]
  shockwaveDamage: number
  shockwaveRadius: number
}

/** 총검사 플레이어 */
export class Player {
  group: THREE.Group
  pos = new THREE.Vector3(0, 0, 0)
  vel = new THREE.Vector3()
  angle = 0 // 바라보는 방향(라디안, +Z 기준)
  hp = 0
  stats: PlayerStats
  mods: Mods = freshMods()
  /** 런 동안 획득한 각인(sigil)별 스택 수. 핵심 슬롯 특성은 여기 들어가지 않는다. */
  traitStacks = new Map<string, number>()
  /** 핵심 슬롯(slash/shot/dash/skill) → 보유 중인 특성 id. 슬롯당 1개만 보유한다. */
  coreSlots = new Map<CoreSlot, string>()
  gun: GunDef = START_GUN
  sword: SwordDef = START_SWORD
  private meta: MetaBonuses
  private revivesRemaining = 0
  private wardReady = false
  /** 마지막 피격의 영구 성장 이벤트. HUD 연출에서만 읽고 게임 로직에는 의존하지 않는다. */
  lastDamageEvent: 'none' | 'ward' | 'hit' | 'revive' | 'dead' | 'dashBlock' = 'none'

  level = 1
  xp = 0
  xpToNext = CONFIG.xp.baseToLevel
  alive = true

  private gunTimer = 0
  private swordTimer = 0
  /** 검 스윙 커밋 — 이 값이 남아있는 동안 이동 입력/조준 방향 전환/대시가 막힌다 */
  private swingCommitTimer = 0
  private dashTimer = 0
  private dashCdTimer = 0
  private dashDir = new THREE.Vector3()
  /** 대시 시작 지점 — '표식'이 대시 종료 시 시작~끝 선분으로 관통 판정할 때 쓴다 */
  dashStart = new THREE.Vector3()
  /** '발도참'(slash) 발동 게이지 — 정지 상태 지속 시간 */
  private stillTimer = 0
  /** '조준사격'(shot) 발동 게이지 — 마지막 발사 이후 경과 시간 */
  private aimPauseTimer = 0
  /** '급전환'(dash) 버프 — 대시 종료 직후 남은 지속시간 */
  private quickSwitchTimer = 0
  /** 잔영(dash) - 이번 대시에서 이미 쿨타임을 초기화했는지(대시 1회당 최대 1회) */
  private afterimageDashRefreshed = false
  private chargeTimer = 0
  private chargeCdTimer = 0
  private chargeDir = new THREE.Vector3()
  private chargeStart = new THREE.Vector3()
  private chargeDamage = 0
  private chargeCrit = false
  private chargeKnockback = 0
  private doubleShotCdTimer = 0
  private ultimateCdTimer = 0
  private ultimateShotsLeft = 0
  private ultimateShotTimer = 0
  private ultimateDir = new THREE.Vector3()
  /** 역행(skill) — Q 종료 후 대시 입력을 되돌아가기로 바꿔치기하는 창(감소, 0이면 없음) */
  private reverseWindowTimer = 0
  /** 역행(skill) — 현재 진행 중인 chargeTimer 구간이 되돌아가기인지(재무장 방지용) */
  private isReverseTrip = false
  private reverseReturnDir = new THREE.Vector3()
  private reverseReturnDamage = 0
  private reverseReturnCrit = false
  private reverseReturnKnockback = 0
  /** 여운(skill) — R 종료 후 남은 지속시간(초), 0이면 비활성 */
  private aftertasteTimer = 0
  private invuln = 0
  private hitFlash = 0
  private walkPhase = 0
  private char!: CharacterSprite
  private moving = false
  private shootAnim = 0

  // 탄약/장전
  magSize = START_GUN.magSize
  ammo = START_GUN.magSize
  reloading = false
  private reloadTimer = 0
  private swordReloadBurstShotsLeft = 0

  constructor(meta: MetaBonuses = { gunDamageMultiplier: 1, swordDamageMultiplier: 1, maxHpFlat: 0, revives: 0, wardReady: false }) {
    this.meta = meta
    this.revivesRemaining = meta.revives
    this.wardReady = meta.wardReady
    this.char = new CharacterSprite(this.gun.id, this.sword.id)
    this.group = this.char.object
    this.stats = {} as PlayerStats
    this.recompute()
    this.hp = this.stats.maxHp
    this.ammo = this.magSize
  }

  /** 무기 정의 × 특성 배수 → 실효 스탯 재계산 */
  recompute() {
    const m = this.mods
    const g = this.gun
    const s = this.sword
    this.stats = {
      maxHp: CONFIG.player.maxHp + this.meta.maxHpFlat + m.maxHp,
      moveSpeed: CONFIG.player.speed * m.moveSpeed,
      dashCooldown: Math.max(CONFIG.player.dashCooldown * 0.45, CONFIG.player.dashCooldown * m.dashCooldown),
      gunDamage: g.damage * this.meta.gunDamageMultiplier * m.gunDamage,
      gunCooldown: Math.max(g.cooldown * 0.35, g.cooldown * m.gunCooldown),
      bulletSpeed: g.bulletSpeed * m.bulletSpeed,
      pierce: g.pierce + m.pierce,
      multishot: g.pellets + m.multishot,
      spread: g.spread,
      magSize: g.magSize,
      reloadTime: g.reloadTime * m.reloadTime,
      swordDamage: s.damage * this.meta.swordDamageMultiplier * m.swordDamage,
      swordRange: s.range * m.swordRange,
      swordCooldown: Math.max(s.cooldown * 0.4, s.cooldown * m.swordCooldown),
      swordArc: s.arc,
      knockback: s.knockback,
      lunge: s.lunge,
      critChance: Math.min(1, 0.1 + m.critChance),
      critMult: m.critMult,
      lifesteal: m.lifesteal,
      magnetRange: CONFIG.xp.orbMagnetRange * m.magnetRange,
      xpGain: m.xpGain,
    }
    this.magSize = this.stats.magSize
    if (this.hp > 0) this.hp = Math.min(this.hp, this.stats.maxHp)
  }

  traitStackCount(id: string) {
    return this.traitStacks.get(id) ?? 0
  }

  hasCoreSlotTrait(id: string) {
    for (const v of this.coreSlots.values()) if (v === id) return true
    return false
  }

  /**
   * 각인은 스택 상한 미만이면 계속 획득 가능(기존 방식). 핵심 슬롯 특성은
   * 슬롯당 1개뿐이라 "이미 이 특성을 보유 중이 아님"이 곧 획득 가능 조건이다
   * (다른 특성으로 슬롯을 교체하는 것은 별도 UI가 처리한다).
   */
  canAcquireTrait(u: { id: string; slot: UpgradeSlot; maxStacks: number }) {
    if (u.slot === 'sigil') return this.traitStackCount(u.id) < u.maxStacks
    return !this.hasCoreSlotTrait(u.id)
  }

  recordTrait(id: string) {
    const next = this.traitStackCount(id) + 1
    this.traitStacks.set(id, next)
    return next
  }

  /** 핵심 슬롯에 특성을 채운다(교체 포함) — 슬롯당 항상 1개만 남는다. */
  setCoreSlot(slot: CoreSlot, id: string) {
    this.coreSlots.set(slot, id)
  }

  /** 대시가 끝난 프레임에 Game이 호출한다 — '급전환'(dash)이면 버프를 건다. */
  onDashEnd() {
    if (this.coreSlots.get('dash') !== 'quick_switch') return
    this.quickSwitchTimer = CONFIG.traits.quickSwitchDuration
    this.ammo = this.magSize
    this.reloading = false
  }

  /**
   * '잔영'(dash) — 대시 무적으로 공격을 흘렸을 때 호출된다(Game.ts가
   * lastDamageEvent==='dashBlock'을 감지해 부른다). 대시 1회당 최대 1회만
   * 초기화되도록 이 함수 자체가 가드를 갖는다(afterimageDashRefreshed는
   * 새 대시가 시작될 때만 풀린다).
   */
  tryRefreshDashOnBlock(): boolean {
    if (this.afterimageDashRefreshed) return false
    this.afterimageDashRefreshed = true
    this.dashCdTimer = 0
    return true
  }

  /**
   * '순환'(skill) — Game.ts가 스킬(Q/E/R) 기인 피해로 적을 처치했을 때 호출한다.
   * 처치에 쓰인 스킬을 제외한 나머지 두 스킬의 쿨타임을 감소시킨다. 처치 1건당
   * 1회 호출된다 — 광역으로 여럿을 죽이면 Game.ts가 그만큼 여러 번 부른다
   * (의도된 동작, 여기서 횟수를 제한하지 않는다). 쿨 감소가 실제로 일어난
   * 스킬 키('q'/'e'/'r') 목록을 반환해 HUD 피드백에 쓴다.
   */
  onSkillKill(skill: 'charge' | 'doubleShot' | 'ultimate'): ('q' | 'e' | 'r')[] | null {
    if (this.coreSlots.get('skill') !== 'circulation') return null
    const reduce = CONFIG.traits.circulationCooldownReduction
    const flashed: ('q' | 'e' | 'r')[] = []
    if (skill !== 'charge') { this.chargeCdTimer = Math.max(0, this.chargeCdTimer - reduce); flashed.push('q') }
    if (skill !== 'doubleShot') { this.doubleShotCdTimer = Math.max(0, this.doubleShotCdTimer - reduce); flashed.push('e') }
    if (skill !== 'ultimate') { this.ultimateCdTimer = Math.max(0, this.ultimateCdTimer - reduce); flashed.push('r') }
    return flashed
  }

  /**
   * 조건부 핵심 슬롯 특성의 발동 게이지(0~1)와 표시 색 — Game이 매 프레임
   * Effects.requestGauge에 그대로 넘긴다. 동시에 여러 조건이 진행 중이면
   * 진행률이 더 높은 쪽만 반환한다(발밑 게이지는 최대 1개).
   *
   * decreasing: 발도참·조준사격은 0→1로 차오르는 창인 반면, 역행은 0.8초가
   * 줄어드는 창이다 — 같은 방향으로 그리면 "지금 채우는 중"과 "곧 닫히는
   * 중"이 구분되지 않아 Effects.drawGauge()가 이 값으로 아크 방향을 반대로
   * 그린다(줄어드는 쪽은 12시에서 반시계 방향).
   */
  conditionGauge(): { progress: number; color: string; decreasing?: boolean } | null {
    const candidates: { progress: number; color: string; decreasing?: boolean }[] = []
    if (this.coreSlots.get('slash') === 'iaijutsu') {
      candidates.push({ progress: Math.min(1, this.stillTimer / CONFIG.traits.iaijutsuIdleThreshold), color: '#f97316' })
    }
    if (this.coreSlots.get('shot') === 'aimed_shot') {
      candidates.push({ progress: Math.min(1, this.aimPauseTimer / CONFIG.traits.aimedShotPauseThreshold), color: '#38bdf8' })
    }
    if (this.reverseWindowTimer > 0) {
      candidates.push({ progress: this.reverseWindowTimer / CONFIG.traits.reverseWindowSec, color: '#facc15', decreasing: true })
    }
    if (candidates.length === 0) return null
    return candidates.reduce((best, c) => (c.progress > best.progress ? c : best))
  }

  /** 무기 장착(총/검 자동 판별) — 캐릭터가 든 무기 스프라이트도 갱신 */
  equip(w: GunDef | SwordDef) {
    if (w.kind === 'gun') {
      this.gun = w
      this.recompute()
      this.ammo = this.magSize // 새 총은 꽉 찬 탄창
      this.reloading = false
    } else {
      this.sword = w
      this.recompute()
    }
    this.char.setWeapons(this.gun.id, this.sword.id)
  }

  applyMetaBonuses(meta: MetaBonuses) {
    this.meta = meta
    this.revivesRemaining = meta.revives
    this.wardReady = meta.wardReady
    this.recompute()
  }

  get isDashing() {
    return this.dashTimer > 0
  }
  get isIaido() {
    return this.chargeTimer > 0
  }
  get invulnerable() {
    return this.invuln > 0 || this.isIaido || this.dashInvulnerable
  }
  /** 대시 무적 창(i-frame)만 — invuln>0(피격 후 무적)이나 발도 무적과 구분해야
   * '잔영'이 "대시로 흘렸을 때만" 초기화되고 피격 후 무적에는 반응하지 않는다. */
  get dashInvulnerable() {
    return this.isDashing && this.dashTimer > CONFIG.player.dashDuration - CONFIG.player.dashIFrames
  }
  get dashReady() {
    return this.dashCdTimer <= 0
  }
  get dashCooldownRatio() {
    return 1 - Math.max(0, this.dashCdTimer) / this.stats.dashCooldown
  }
  get chargeReady() { return this.chargeCdTimer <= 0 }
  get doubleShotReady() { return this.doubleShotCdTimer <= 0 }
  get ultimateReady() { return this.ultimateCdTimer <= 0 }
  /** 여운(skill) — R 종료 후 8초간 true. Game.ts의 4개 피해 적용 지점
   * (resolveSlash/resolveIaido/resolveBullets/aoeDamage)이 이 값으로 +25%를 건다. */
  get aftertasteActive() { return this.aftertasteTimer > 0 }
  get activeSkillCooldowns() {
    return {
      charge: Math.max(0, this.chargeCdTimer) / CONFIG.skills.charge.cooldown,
      doubleShot: Math.max(0, this.doubleShotCdTimer) / CONFIG.skills.doubleShot.cooldown,
      ultimate: Math.max(0, this.ultimateCdTimer) / CONFIG.skills.ultimate.cooldown,
    }
  }
  /** 대시 잔상용 현재 프레임 정보 */
  ghostParams() {
    return this.char.ghostParams()
  }

  /** 장전 진행도 0..1 */
  get reloadRatio() {
    return this.reloading ? 1 - this.reloadTimer / this.stats.reloadTime : 1
  }
  private startReload() {
    if (this.reloading || this.ammo >= this.magSize) return false
    this.reloading = true
    this.reloadTimer = this.stats.reloadTime
    return true
  }

  /**
   * 검이 적을 맞히면 호출 — 기본 메커니즘(항상 적용, 특성 무관)으로 총알을
   * 장전한다. 탄창이 이미 가득 차 있으면 아무 일도 일어나지 않는다. 장전
   * 진행 중이어도 그 진행을 건드리지 않고(즉시 완료시키지 않고) 그 위에
   * ammo만 더한다 — 현행 장전 로직(reloadTimer)은 그대로 계속 흐른다.
   * 발도장전 특성은 mods.swordReloadAmount/swordReloadBurstBonus로 이 값을
   * 강화한다.
   */
  reloadFromSwordHit() {
    if (this.ammo >= this.magSize) return
    this.ammo = Math.min(this.magSize, this.ammo + this.mods.swordReloadAmount)
    if (this.mods.swordReloadBurstBonus > 0) this.swordReloadBurstShotsLeft = 3
  }

  private rollCrit(): boolean {
    return Math.random() < this.stats.critChance
  }

  /**
   * 이동/조준/대시 처리. 반환값으로 발사할 총알과 베기를 알린다.
   */
  update(
    dt: number,
    input: Input,
    aimGround: THREE.Vector3,
    activeSkillsEnabled = true,
  ): {
    bullets: BulletSpec[]
    slash: SlashSpec | null
    chargeSlash: IaidoSpec | null
    ultimate: UltimateSpec | null
    startedReload: boolean
    reloadTriggerAttempt: boolean
  } {
    const bullets: BulletSpec[] = []
    let slash: SlashSpec | null = null
    let chargeSlash: IaidoSpec | null = null
    let ultimate: UltimateSpec | null = null
    let startedReload = false
    let reloadTriggerAttempt = false

    // 조준: 마우스 지면 좌표 방향 — 검 스윙 커밋 중엔 방향 전환 차단
    if (this.swingCommitTimer <= 0) {
      const dx = aimGround.x - this.pos.x
      const dz = aimGround.z - this.pos.z
      if (dx * dx + dz * dz > 0.01) this.angle = Math.atan2(dx, dz)
    }

    // 타이머 감소
    this.gunTimer -= dt
    this.swordTimer -= dt
    this.dashCdTimer -= dt
    this.chargeCdTimer -= dt
    this.doubleShotCdTimer -= dt
    this.ultimateCdTimer -= dt
    if (this.swingCommitTimer > 0) this.swingCommitTimer -= dt
    if (this.invuln > 0) this.invuln -= dt
    if (this.hitFlash > 0) this.hitFlash -= dt
    if (this.reverseWindowTimer > 0) this.reverseWindowTimer -= dt
    if (this.aftertasteTimer > 0) this.aftertasteTimer -= dt

    // 발도 이동 — 설정된 총 이동거리를 duration 동안 정확히 나눠 이동한다.
    // 이동이 끝난 프레임에 실제 시작점~현재 위치 선분을 한 번만 타격한다.
    if (this.chargeTimer > 0) {
      const stepTime = Math.min(dt, this.chargeTimer)
      const speed = CONFIG.skills.charge.distance / CONFIG.skills.charge.duration
      this.pos.addScaledVector(this.chargeDir, speed * stepTime)
      this.chargeTimer -= dt
      this.moving = true
      this.walkPhase += dt * 24
      if (this.chargeTimer <= 0) {
        chargeSlash = {
          start: this.chargeStart.clone(),
          damage: this.chargeDamage,
          crit: this.chargeCrit,
          knockback: this.chargeKnockback,
        }
        // 발도로 적을 관통한 직후 적 무리 안에서 즉시 피격되는 불합리함을 막는다.
        // 이동 종료 뒤에는 대시와 같은 짧은 후속 무적만 남긴다.
        this.invuln = Math.max(this.invuln, CONFIG.player.dashIFrames)
        this.swingAnim = 0.3
        // 역행(skill) — 방금 끝난 구간이 정방향(왕복의 첫 다리)이었을 때만
        // 되돌아가기 창을 새로 연다. 되돌아가기 구간 자체가 끝난 경우
        // (isReverseTrip) 재무장하지 않는다 — 왕복은 한 번뿐이다.
        if (!this.isReverseTrip && this.coreSlots.get('skill') === 'reverse') {
          this.reverseWindowTimer = CONFIG.traits.reverseWindowSec
          this.reverseReturnDir = this.chargeDir.clone().negate()
          this.reverseReturnDamage = this.chargeDamage * CONFIG.traits.reverseDamageMult
          this.reverseReturnCrit = this.chargeCrit
          this.reverseReturnKnockback = this.chargeKnockback
        }
        this.isReverseTrip = false
      }
    } else if (this.dashTimer > 0) {
      this.dashTimer -= dt
      this.pos.addScaledVector(this.dashDir, CONFIG.player.dashSpeed * dt)
      this.moving = true
      this.walkPhase += dt * 24 // 대시 중 빠른 다리 회전
    } else if (this.swingCommitTimer > 0) {
      // 검 스윙 커밋 — 이동 입력·대시 시작 모두 무시(런지에 의한 전진은 스윙
      // 트리거 시점에 이미 적용되어 있어 여기서 막을 이동과는 별개다)
      this.moving = false
    } else {
      // 이동
      const mv = input.moveVector()
      let mag = Math.hypot(mv.x, mv.z)
      this.moving = mag > 0
      if (mag > 0) {
        const nx = mv.x / mag
        const nz = mv.z / mag
        this.pos.x += nx * this.stats.moveSpeed * dt
        this.pos.z += nz * this.stats.moveSpeed * dt
        this.walkPhase += dt * 13 // 걷기 다리 회전
      }
      // 역행(skill) — 창이 열려 있는 동안의 대시 입력은 평소 대시 대신 되돌아가기로
      // 바꿔치기한다(창을 놓치면 아래 평소 대시로 폴스루). chargeTimer 기반 이동을
      // 재사용하므로 무적(isIaido)도 자동으로 동일하게 적용되고, 대시 쿨/이동
      // 입력 조건과 무관하게 발동한다 — "대시 쿨을 소모하지 않는다"는 요구사항이
      // dashCdTimer를 아예 건드리지 않는 것만으로 자연히 만족된다.
      if (this.reverseWindowTimer > 0 && input.downAction('dash')) {
        this.reverseWindowTimer = 0
        this.isReverseTrip = true
        this.chargeDir.copy(this.reverseReturnDir)
        this.chargeStart.copy(this.pos)
        this.chargeTimer = CONFIG.skills.charge.duration
        this.chargeDamage = this.reverseReturnDamage
        this.chargeCrit = this.reverseReturnCrit
        this.chargeKnockback = this.reverseReturnKnockback
      } else if (input.downAction('dash') && this.dashReady && !this.isDashing && (mv.x !== 0 || mv.z !== 0)) {
        // 대시 시작 — dashReady는 원래 대시 애니메이션(dashDuration) 동안은
        // 쿨타임(dashCooldown)이 항상 더 길어 참일 수 없었지만, '잔영'이 대시
        // 무적 중 피격 시 dashCdTimer를 0으로 초기화하면서 이 전제가 깨졌다.
        // Shift가 계속 눌려있으면(downAction은 레벨 트리거) 같은 프레임에 대시가
        // 즉시 재시작돼 afterimageDashRefreshed 가드까지 함께 풀려버려, 공격을
        // 계속 흘리는 한 무한 대시 사슬이 생긴다. isDashing 가드로 막는다.
        this.dashDir.set(mv.x, 0, mv.z).normalize()
        this.dashTimer = CONFIG.player.dashDuration
        this.dashCdTimer = this.stats.dashCooldown
        this.dashStart.copy(this.pos)
        this.afterimageDashRefreshed = false
      }
    }

    // (방 경계 제한은 Game이 Room.clamp로 처리)

    // '발도참' 발동 게이지 — 정지(이동/대시/발도 전부 없음) 상태가 이어지는 시간
    if (this.moving || this.dashTimer > 0 || this.chargeTimer > 0) this.stillTimer = 0
    else this.stillTimer += dt
    // '조준사격' 발동 게이지 — 총을 쏘지 않고 흐른 시간(성공 발사 시 아래서 리셋)
    this.aimPauseTimer += dt
    // '급전환' 버프 지속시간
    if (this.quickSwitchTimer > 0) this.quickSwitchTimer -= dt

    // M1911 장전 처리
    if (this.reloading) {
      this.reloadTimer -= dt
      if (this.reloadTimer <= 0) {
        this.reloading = false
        this.ammo = this.magSize
      }
    } else if (input.consumeAction('reload')) {
      // 수동 장전 (R)
      startedReload = this.startReload()
    }

    // 총 발사 (좌클릭 홀드로 연사 — 탄창 소진 시 자동 장전)
    // Q: 발도 — 적을 스쳐 지나간 뒤 이동 경로 전체를 한 번에 벤다.
    if (activeSkillsEnabled && input.consumeAction('charge') && this.chargeReady && this.chargeTimer <= 0) {
      this.chargeCdTimer = CONFIG.skills.charge.cooldown
      this.chargeTimer = CONFIG.skills.charge.duration
      this.chargeDir.set(Math.sin(this.angle), 0, Math.cos(this.angle))
      this.chargeStart.copy(this.pos)
      this.chargeCrit = this.rollCrit()
      this.chargeDamage = this.stats.swordDamage * CONFIG.skills.charge.damageMultiplier
        * (this.chargeCrit ? this.stats.critMult : 1)
      this.chargeKnockback = this.stats.knockback
    }

    // E: 탄약 두 발을 동시에 소비하고, 조준선 양 옆으로 100% 위력의 탄환을 발사한다.
    // '삼연사'(skill)면 중앙 탄환이 추가돼 3발이 되지만 탄약 소모는 그대로 2다.
    if (activeSkillsEnabled && input.consumeAction('doubleShot') && this.doubleShotReady && !this.reloading && this.ammo >= CONFIG.skills.doubleShot.ammoCost) {
      this.doubleShotCdTimer = CONFIG.skills.doubleShot.cooldown
      this.ammo -= CONFIG.skills.doubleShot.ammoCost
      this.shootAnim = Math.max(0.16, this.stats.gunCooldown)
      const offsets = this.coreSlots.get('skill') === 'triple_shot'
        ? [-CONFIG.skills.doubleShot.angleOffset, 0, CONFIG.skills.doubleShot.angleOffset]
        : [-CONFIG.skills.doubleShot.angleOffset, CONFIG.skills.doubleShot.angleOffset]
      for (const offset of offsets) {
        const dir = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle))
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), offset)
        const crit = this.rollCrit()
        bullets.push({
          pos: new THREE.Vector3(this.pos.x, 2.6, this.pos.z).addScaledVector(dir, 0.9), dir,
          damage: this.stats.gunDamage * CONFIG.skills.doubleShot.damageMultiplier * (crit ? this.stats.critMult : 1), crit,
          skillSource: 'doubleShot',
        })
      }
      if (this.ammo === 0) startedReload = this.startReload()
    }

    // R: 폭렬 난무. 발동 순간의 조준 방향을 잠그고 탄막 뒤에 넓은 검격과 충격파를 낸다.
    if (activeSkillsEnabled && input.consumeAction('ultimate') && this.ultimateReady && this.ultimateShotsLeft === 0) {
      this.ultimateCdTimer = CONFIG.skills.ultimate.cooldown
      this.ultimateShotsLeft = CONFIG.skills.ultimate.bulletCount
      this.ultimateShotTimer = 0
      this.ultimateDir.set(Math.sin(this.angle), 0, Math.cos(this.angle))
      this.shootAnim = CONFIG.skills.ultimate.bulletCount * CONFIG.skills.ultimate.bulletInterval
    }
    if (this.ultimateShotsLeft > 0) {
      this.ultimateShotTimer -= dt
      if (this.ultimateShotTimer <= 0) {
        const shotIndex = CONFIG.skills.ultimate.bulletCount - this.ultimateShotsLeft
        // 고정 조준선이 아니라 360도를 균등하게 훑어, 궁극기의 "사방 난사"를 만든다.
        const dir = this.ultimateDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.PI * 2 * shotIndex) / CONFIG.skills.ultimate.bulletCount)
        const crit = this.rollCrit()
        bullets.push({
          pos: new THREE.Vector3(this.pos.x, 2.6, this.pos.z).addScaledVector(dir, 0.9), dir,
          damage: this.stats.gunDamage * CONFIG.skills.ultimate.bulletDamageMultiplier * (crit ? this.stats.critMult : 1), crit,
          skillSource: 'ultimate',
        })
        this.ultimateShotsLeft--
        this.ultimateShotTimer += CONFIG.skills.ultimate.bulletInterval
        if (this.ultimateShotsLeft === 0) {
          const finaleCrit = this.rollCrit()
          ultimate = {
            slashes: [0, Math.PI / 2].map((turn) => ({
              pos: this.pos.clone(), angle: Math.atan2(this.ultimateDir.x, this.ultimateDir.z) + turn, arc: Math.PI * 1.35, range: this.stats.swordRange * 1.2,
              damage: this.stats.swordDamage * CONFIG.skills.ultimate.slashDamageMultiplier * (finaleCrit ? this.stats.critMult : 1),
              crit: finaleCrit, knockback: this.stats.knockback,
            })) as [SlashSpec, SlashSpec],
            shockwaveDamage: this.stats.swordDamage * CONFIG.skills.ultimate.shockwaveDamageMultiplier,
            shockwaveRadius: CONFIG.skills.ultimate.shockwaveRadius,
          }
          this.swingAnim = 0.35
          // 여운(skill) — 재사용마다 8초로 재설정(연장 아님).
          if (this.coreSlots.get('skill') === 'aftertaste') this.aftertasteTimer = CONFIG.traits.aftertasteDuration
        }
      }
    }

    if (input.mouseDown && this.gunTimer <= 0 && !this.reloading) {
      if (this.ammo > 0) {
        // '최후탄'(shot) — 이번 발사가 탄창의 마지막 1발인지는 감소 전에 판정한다.
        const isLastBullet = this.ammo === 1
        // '조준사격'(shot) — 충분히 쉬었다 쏘는 첫 발은 확정 치명타. 발동했으면
        // 게이지를 소모(리셋)한다. 매 프레임 아래서 다시 리셋되므로 항상 최신값이다.
        const aimedShotReady = this.coreSlots.get('shot') === 'aimed_shot' && this.aimPauseTimer >= CONFIG.traits.aimedShotPauseThreshold
        this.gunTimer = this.stats.gunCooldown
        this.ammo--
        this.aimPauseTimer = 0
        // 사격 모션 재생 — 총의 재장전 간격(gunCooldown)이 이 값보다 길면(산탄총·
        // 저격소총·매그넘·석궁 등) 다음 발이 나가기 전에 st.shooting이 꺼져
        // CharacterSprite의 좌우 반전 고정이 풀렸다가 다음 발에서 다시 걸리며
        // 조준 방향이 바뀌어 있으면 좌우로 튀어 보였다 — 최소한 쿨타임만큼은
        // 유지해 연사 중 내내 얼어붙게 한다.
        this.shootAnim = Math.max(0.16, this.stats.gunCooldown)
        const shots = this.stats.multishot
        const baseDir = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle))
        for (let i = 0; i < shots; i++) {
          const spreadIdx = shots > 1 ? (i - (shots - 1) / 2) * 0.12 : 0
          const dir = baseDir.clone()
          const jitter = (Math.random() - 0.5) * this.stats.spread + spreadIdx
          dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), jitter)
          const crit = aimedShotReady || this.rollCrit()
          let dmg = this.stats.gunDamage * (crit ? this.stats.critMult : 1)
          // 발도장전 강화: 검으로 장전한 직후 발사하는 총알 N발에 피해 보너스
          if (this.swordReloadBurstShotsLeft > 0) {
            dmg *= 1 + this.mods.swordReloadBurstBonus
            this.swordReloadBurstShotsLeft--
          }
          if (this.coreSlots.get('shot') === 'last_bullet' && isLastBullet) dmg *= CONFIG.traits.lastBulletMult
          bullets.push({
            // 총구 높이/전방 거리는 gunblader_gun_m1911.png 발사 프레임의 실제 총구
            // 픽셀 위치를 월드 단위로 환산한 값이다(CharacterSprite.ts GUN_SHOOT_FIX 주석 참고).
            pos: new THREE.Vector3(this.pos.x, 2.6, this.pos.z).addScaledVector(dir, 0.9),
            dir,
            damage: dmg,
            crit,
          })
        }
        // 마지막 탄 발사 후 자동 장전
        if (this.ammo === 0) startedReload = this.startReload()
      }
    } else if (input.mouseDown && this.reloading) {
      // 장전 중 방아쇠 시도 — 탄약/딜레이에는 영향 없음, 소리로만 피드백
      reloadTriggerAttempt = true
    }

    // 검 베기 (우클릭 또는 스페이스)
    if ((input.rightDown || input.downAction('slash')) && this.swordTimer <= 0) {
      // '급전환'(dash) 버프 — 대시 종료 직후 잠깐 검 쿨타임이 절반이다.
      this.swordTimer = this.quickSwitchTimer > 0
        ? this.stats.swordCooldown * CONFIG.traits.quickSwitchSwordCooldownMult
        : this.stats.swordCooldown
      const crit = this.rollCrit()
      // '발도참'(slash) — 0.5초 이상 정지 후 첫 베기는 강화된다. 발동하면 게이지를
      // 소모(리셋)해 다시 정지해야 재충전된다.
      const iaijutsuReady = this.coreSlots.get('slash') === 'iaijutsu' && this.stillTimer >= CONFIG.traits.iaijutsuIdleThreshold
      if (iaijutsuReady) this.stillTimer = 0
      const dmgMult = iaijutsuReady ? CONFIG.traits.iaijutsuDamageMult : 1
      const kbMult = iaijutsuReady ? CONFIG.traits.iaijutsuKnockbackMult : 1
      slash = {
        pos: this.pos.clone(),
        angle: this.angle,
        arc: this.stats.swordArc,
        range: this.stats.swordRange,
        damage: this.stats.swordDamage * (crit ? this.stats.critMult : 1) * dmgMult,
        crit,
        knockback: this.stats.knockback * kbMult,
      }
      // 전방 짧은 대시
      const fwd = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle))
      this.pos.addScaledVector(fwd, this.stats.lunge * dt * 6)
      this.swingAnim = 0.3 // 아트 시트 8프레임 재생 시간
      // 스윙 커밋: 검 쿨타임에 비례하되 상한을 넘지 않는다
      this.swingCommitTimer = Math.min(this.stats.swordCooldown, CONFIG.combat.swordSwingCommitMax)
      // 레전더리: 발도 시 총 즉시 장전
      if (this.mods.swordReloads && this.ammo < this.magSize) {
        this.ammo = this.magSize
        this.reloading = false
      }
    }

    this.syncMesh(dt)
    return { bullets, slash, chargeSlash, ultimate, startedReload, reloadTriggerAttempt }
  }

  private swingAnim = 0
  private syncMesh(dt: number) {
    // 2D 스프라이트(빌보드) 갱신
    this.char.update(
      dt,
      this.pos,
      this.angle,
      {
        moving: this.moving,
        // 발도 중에는 걷기 대신 전진 자세를 사용해 이동기임을 즉시 읽을 수 있게 한다.
        dashing: this.isDashing || this.isIaido,
        swinging: this.swingAnim > 0,
        shooting: this.shootAnim > 0,
        invulnerable: this.invulnerable,
      },
      this.hitFlash,
    )
    if (this.swingAnim > 0) this.swingAnim -= dt
    if (this.shootAnim > 0) this.shootAnim -= dt
  }

  takeDamage(amount: number): boolean {
    this.lastDamageEvent = 'none'
    if (!this.alive) return false
    if (this.invulnerable) {
      // '잔영'(dash)이 참고할 수 있게, 대시 무적으로 막았다는 사실만 구분해 남긴다
      // — 피격 후 무적(invuln>0)이나 발도 무적으로 막았을 때는 남기지 않는다.
      if (this.dashInvulnerable) this.lastDamageEvent = 'dashBlock'
      return false
    }
    if (this.wardReady) {
      this.wardReady = false
      this.lastDamageEvent = 'ward'
      return false
    }
    this.hp -= amount
    this.invuln = CONFIG.player.invulnAfterHit
    this.hitFlash = 0.15
    if (this.hp <= 0) {
      if (this.revivesRemaining > 0) {
        this.revivesRemaining--
        this.hp = this.stats.maxHp * 0.5
        this.invuln = CONFIG.player.invulnAfterHit
        this.lastDamageEvent = 'revive'
      } else {
        this.hp = 0
        this.alive = false
        this.lastDamageEvent = 'dead'
      }
    } else {
      this.lastDamageEvent = 'hit'
    }
    return true
  }

  consumeDamageEvent() {
    const event = this.lastDamageEvent
    this.lastDamageEvent = 'none'
    return event
  }

  heal(amount: number) {
    this.hp = Math.min(this.stats.maxHp, this.hp + amount)
  }

  gainXp(amount: number): boolean {
    this.xp += amount
    if (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext
      this.level++
      this.xpToNext = Math.round(this.xpToNext * CONFIG.xp.growth)
      return true // 레벨업
    }
    return false
  }
}
