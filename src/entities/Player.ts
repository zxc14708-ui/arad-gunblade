import * as THREE from 'three'
import { CONFIG } from '../config'
import { Input } from '../core/Input'
import { CharacterSprite } from './CharacterSprite'
import { GunDef, SwordDef, START_GUN, START_SWORD } from '../systems/Weapons'

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
    maxHp: 0, critChance: 0, critMult: 2, lifesteal: 0, magnetRange: 1,
    explodeOnKill: 0, swordReloads: false, dashStrike: 0,
    swordReloadAmount: 1, swordReloadBurstBonus: 0,
  }
}

export interface BulletSpec {
  pos: THREE.Vector3
  dir: THREE.Vector3
  damage: number
  crit: boolean
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

/** 총검사 플레이어 */
export class Player {
  group: THREE.Group
  pos = new THREE.Vector3(0, 0, 0)
  vel = new THREE.Vector3()
  angle = 0 // 바라보는 방향(라디안, +Z 기준)
  hp = 0
  stats: PlayerStats
  mods: Mods = freshMods()
  /** 런 동안 획득한 특성별 스택 수. 선택지와 획득 검증의 단일 기준이다. */
  traitStacks = new Map<string, number>()
  gun: GunDef = START_GUN
  sword: SwordDef = START_SWORD

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

  constructor() {
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
      maxHp: CONFIG.player.maxHp + m.maxHp,
      moveSpeed: CONFIG.player.speed * m.moveSpeed,
      dashCooldown: Math.max(CONFIG.player.dashCooldown * 0.45, CONFIG.player.dashCooldown * m.dashCooldown),
      gunDamage: g.damage * m.gunDamage,
      gunCooldown: Math.max(g.cooldown * 0.35, g.cooldown * m.gunCooldown),
      bulletSpeed: g.bulletSpeed * m.bulletSpeed,
      pierce: g.pierce + m.pierce,
      multishot: g.pellets + m.multishot,
      spread: g.spread,
      magSize: g.magSize,
      reloadTime: g.reloadTime * m.reloadTime,
      swordDamage: s.damage * m.swordDamage,
      swordRange: s.range * m.swordRange,
      swordCooldown: Math.max(s.cooldown * 0.4, s.cooldown * m.swordCooldown),
      swordArc: s.arc,
      knockback: s.knockback,
      lunge: s.lunge,
      critChance: Math.min(1, 0.1 + m.critChance),
      critMult: m.critMult,
      lifesteal: m.lifesteal,
      magnetRange: CONFIG.xp.orbMagnetRange * m.magnetRange,
    }
    this.magSize = this.stats.magSize
    if (this.hp > 0) this.hp = Math.min(this.hp, this.stats.maxHp)
  }

  traitStackCount(id: string) {
    return this.traitStacks.get(id) ?? 0
  }

  canAcquireTrait(id: string, maxStacks: number) {
    return this.traitStackCount(id) < maxStacks
  }

  recordTrait(id: string) {
    const next = this.traitStackCount(id) + 1
    this.traitStacks.set(id, next)
    return next
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

  get isDashing() {
    return this.dashTimer > 0
  }
  get invulnerable() {
    return this.invuln > 0 || (this.isDashing && this.dashTimer > CONFIG.player.dashDuration - CONFIG.player.dashIFrames)
  }
  get dashReady() {
    return this.dashCdTimer <= 0
  }
  get dashCooldownRatio() {
    return 1 - Math.max(0, this.dashCdTimer) / this.stats.dashCooldown
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
  ): { bullets: BulletSpec[]; slash: SlashSpec | null; startedReload: boolean } {
    const bullets: BulletSpec[] = []
    let slash: SlashSpec | null = null
    let startedReload = false

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
    if (this.swingCommitTimer > 0) this.swingCommitTimer -= dt
    if (this.invuln > 0) this.invuln -= dt
    if (this.hitFlash > 0) this.hitFlash -= dt

    // 대시
    if (this.dashTimer > 0) {
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
      // 대시 시작
      if (input.down('ShiftLeft') && this.dashReady && (mv.x !== 0 || mv.z !== 0)) {
        this.dashDir.set(mv.x, 0, mv.z).normalize()
        this.dashTimer = CONFIG.player.dashDuration
        this.dashCdTimer = this.stats.dashCooldown
      }
    }

    // (방 경계 제한은 Game이 Room.clamp로 처리)

    // M1911 장전 처리
    if (this.reloading) {
      this.reloadTimer -= dt
      if (this.reloadTimer <= 0) {
        this.reloading = false
        this.ammo = this.magSize
      }
    } else if (input.down('KeyR')) {
      // 수동 장전 (R)
      startedReload = this.startReload()
    }

    // 총 발사 (좌클릭 홀드로 연사 — 탄창 소진 시 자동 장전)
    if (input.mouseDown && this.gunTimer <= 0 && !this.reloading) {
      if (this.ammo > 0) {
        this.gunTimer = this.stats.gunCooldown
        this.ammo--
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
          const crit = this.rollCrit()
          let dmg = this.stats.gunDamage * (crit ? this.stats.critMult : 1)
          // 발도장전 강화: 검으로 장전한 직후 발사하는 총알 N발에 피해 보너스
          if (this.swordReloadBurstShotsLeft > 0) {
            dmg *= 1 + this.mods.swordReloadBurstBonus
            this.swordReloadBurstShotsLeft--
          }
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
    }

    // 검 베기 (우클릭 또는 스페이스)
    if ((input.rightDown || input.down('Space')) && this.swordTimer <= 0) {
      this.swordTimer = this.stats.swordCooldown
      const crit = this.rollCrit()
      slash = {
        pos: this.pos.clone(),
        angle: this.angle,
        arc: this.stats.swordArc,
        range: this.stats.swordRange,
        damage: this.stats.swordDamage * (crit ? this.stats.critMult : 1),
        crit,
        knockback: this.stats.knockback,
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
    return { bullets, slash, startedReload }
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
        dashing: this.isDashing,
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
    if (this.invulnerable || !this.alive) return false
    this.hp -= amount
    this.invuln = CONFIG.player.invulnAfterHit
    this.hitFlash = 0.15
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
    }
    return true
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
