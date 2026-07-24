import * as THREE from 'three'
import { CONFIG, COLORS } from '../config'
import { Input } from '../core/Input'
import { buildGunblade } from './models'

export interface PlayerStats {
  maxHp: number
  moveSpeed: number
  // 총
  gunDamage: number
  gunCooldown: number
  bulletSpeed: number
  pierce: number
  multishot: number
  // 검
  swordDamage: number
  swordRange: number
  swordCooldown: number
  // 공통
  critChance: number
  critMult: number
  lifesteal: number // 흡혈 비율
  magnetRange: number
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
  hp: number
  stats: PlayerStats

  level = 1
  xp = 0
  xpToNext = CONFIG.xp.baseToLevel
  alive = true

  private gunTimer = 0
  private swordTimer = 0
  private dashTimer = 0
  private dashCdTimer = 0
  private dashDir = new THREE.Vector3()
  private invuln = 0
  private hitFlash = 0
  private walkPhase = 0
  private katana: THREE.Object3D | null = null
  private slide: THREE.Object3D | null = null
  private legL: THREE.Object3D | null = null
  private legR: THREE.Object3D | null = null
  private armR: THREE.Object3D | null = null
  private moving = false
  private lean = 0

  // M1911 탄약/장전
  magSize = CONFIG.gun.magSize
  ammo = CONFIG.gun.magSize
  reloading = false
  private reloadTimer = 0
  private slideKick = 0

  constructor() {
    this.group = buildGunblade()
    this.katana = this.group.getObjectByName('katana') ?? null
    this.slide = this.group.getObjectByName('pistolSlide') ?? null
    this.legL = this.group.getObjectByName('legL') ?? null
    this.legR = this.group.getObjectByName('legR') ?? null
    this.armR = this.group.getObjectByName('armR') ?? null
    this.stats = {
      maxHp: CONFIG.player.maxHp,
      moveSpeed: CONFIG.player.speed,
      gunDamage: CONFIG.gun.damage,
      gunCooldown: CONFIG.gun.cooldown,
      bulletSpeed: CONFIG.gun.bulletSpeed,
      pierce: CONFIG.gun.pierce,
      multishot: 1,
      swordDamage: CONFIG.sword.damage,
      swordRange: CONFIG.sword.range,
      swordCooldown: CONFIG.sword.cooldown,
      critChance: 0.1,
      critMult: 2,
      lifesteal: 0,
      magnetRange: CONFIG.xp.orbMagnetRange,
    }
    this.hp = this.stats.maxHp
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
    return 1 - Math.max(0, this.dashCdTimer) / CONFIG.player.dashCooldown
  }
  /** 장전 진행도 0..1 */
  get reloadRatio() {
    return this.reloading ? 1 - this.reloadTimer / CONFIG.gun.reloadTime : 1
  }
  private startReload() {
    if (this.reloading || this.ammo >= this.magSize) return false
    this.reloading = true
    this.reloadTimer = CONFIG.gun.reloadTime
    return true
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
    arenaRadius: number,
  ): { bullets: BulletSpec[]; slash: SlashSpec | null; startedReload: boolean } {
    const bullets: BulletSpec[] = []
    let slash: SlashSpec | null = null
    let startedReload = false

    // 조준: 마우스 지면 좌표 방향
    const dx = aimGround.x - this.pos.x
    const dz = aimGround.z - this.pos.z
    if (dx * dx + dz * dz > 0.01) this.angle = Math.atan2(dx, dz)

    // 타이머 감소
    this.gunTimer -= dt
    this.swordTimer -= dt
    this.dashCdTimer -= dt
    if (this.invuln > 0) this.invuln -= dt
    if (this.hitFlash > 0) this.hitFlash -= dt

    // 대시
    if (this.dashTimer > 0) {
      this.dashTimer -= dt
      this.pos.addScaledVector(this.dashDir, CONFIG.player.dashSpeed * dt)
      this.moving = true
      this.walkPhase += dt * 24 // 대시 중 빠른 다리 회전
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
        this.dashCdTimer = CONFIG.player.dashCooldown
      }
    }

    // 아레나 경계
    const r = Math.hypot(this.pos.x, this.pos.z)
    const limit = arenaRadius - CONFIG.player.radius
    if (r > limit) {
      this.pos.x = (this.pos.x / r) * limit
      this.pos.z = (this.pos.z / r) * limit
    }

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
        this.slideKick = 0.06
        const shots = this.stats.multishot
        const baseDir = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle))
        for (let i = 0; i < shots; i++) {
          const spreadIdx = shots > 1 ? (i - (shots - 1) / 2) * 0.12 : 0
          const dir = baseDir.clone()
          const jitter = (Math.random() - 0.5) * CONFIG.gun.spread + spreadIdx
          dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), jitter)
          const crit = this.rollCrit()
          bullets.push({
            pos: new THREE.Vector3(this.pos.x, 1.2, this.pos.z).addScaledVector(dir, 0.8),
            dir,
            damage: this.stats.gunDamage * (crit ? this.stats.critMult : 1),
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
        arc: CONFIG.sword.arc,
        range: this.stats.swordRange,
        damage: this.stats.swordDamage * (crit ? this.stats.critMult : 1),
        crit,
        knockback: CONFIG.sword.knockback,
      }
      // 전방 짧은 대시
      const fwd = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle))
      this.pos.addScaledVector(fwd, CONFIG.sword.lunge * dt * 6)
      this.swingAnim = 0.25
    }

    this.syncMesh(dt)
    return { bullets, slash, startedReload }
  }

  private swingAnim = 0
  private readonly SWING_DUR = 0.25
  private syncMesh(dt: number) {
    this.group.position.set(this.pos.x, 0, this.pos.z)
    this.group.rotation.y = this.angle

    // ── 대시 시 전방 기울임 (order YXZ) ──
    const leanTarget = this.isDashing ? -0.3 : 0
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 14)
    this.group.rotation.x = this.lean

    // ── 걷기/뛰기: 다리 스윙 + 몸통 바운스 ──
    const swing = Math.sin(this.walkPhase)
    const amp = this.isDashing ? 0.95 : 0.5
    if (this.moving) {
      if (this.legL) this.legL.rotation.x = swing * amp
      if (this.legR) this.legR.rotation.x = -swing * amp
      this.group.position.y = Math.abs(Math.sin(this.walkPhase)) * (this.isDashing ? 0.09 : 0.05)
    } else {
      // 멈추면 다리를 서서히 기본 자세로
      if (this.legL) this.legL.rotation.x *= 1 - Math.min(1, dt * 12)
      if (this.legR) this.legR.rotation.x *= 1 - Math.min(1, dt * 12)
      this.group.position.y *= 1 - Math.min(1, dt * 12)
    }

    // ── 검 휘두르기: 오른팔(어깨) 아크 스윙 ──
    if (this.swingAnim > 0) {
      this.swingAnim -= dt
      if (this.armR) {
        const t = 1 - Math.max(0, this.swingAnim) / this.SWING_DUR // 0→1
        // 오른쪽 위에서 앞쪽 왼편으로 쓸어내리는 횡베기
        const raise = Math.sin(t * Math.PI) // 0→1→0 (중간에 살짝 들림)
        this.armR.rotation.set(-0.4 - raise * 0.9, 0.6 - t * 1.9, -raise * 0.4)
      }
    } else if (this.armR) {
      // 기본 자세로 복귀
      this.armR.rotation.x += (0 - this.armR.rotation.x) * Math.min(1, dt * 14)
      this.armR.rotation.y += (0 - this.armR.rotation.y) * Math.min(1, dt * 14)
      this.armR.rotation.z += (0 - this.armR.rotation.z) * Math.min(1, dt * 14)
    }

    // 권총 슬라이드 블로우백 (발사 시 뒤로 튐)
    if (this.slide) {
      if (this.slideKick > 0) this.slideKick -= dt
      const kick = Math.max(0, this.slideKick) / 0.06
      this.slide.position.z = -kick * 0.12
    }
    // 피격 플래시
    const flash = this.hitFlash > 0
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m && m.emissive) {
        m.emissiveIntensity = flash ? 0.8 : (m.userData.baseEmissive ?? 0)
        if (flash) m.emissive.setHex(0xff3030)
      }
    })
    this.group.visible = !(this.invulnerable && Math.floor(performance.now() / 60) % 2 === 0)
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
