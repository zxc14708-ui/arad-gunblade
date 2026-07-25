import * as THREE from 'three'
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js'
import { CONFIG, COLORS } from '../config'
import { Input } from './Input'
import { Dungeon } from '../systems/Dungeon'
import { Player } from '../entities/Player'
import { Enemy } from '../entities/Enemy'
import { Projectiles } from '../systems/Projectiles'
import { Orbs } from '../systems/Orbs'
import { Effects } from '../systems/Effects'
import { Spawner } from '../systems/Spawner'
import { rollChoices, Upgrade } from '../systems/Upgrades'
import { rollWeapons, WeaponDef } from '../systems/Weapons'
import { AudioManager } from '../systems/Audio'
import { HUD } from '../ui/HUD'

type State = 'start' | 'playing' | 'levelup' | 'reward' | 'gameover'

export class Game {
  private renderer: THREE.WebGLRenderer
  private outline!: OutlineEffect
  private scene: THREE.Scene
  private camera!: THREE.OrthographicCamera
  private viewSize = 14 // 오쏘 카메라가 보여줄 세로 절반 크기(월드 단위)
  private pixelScale = 3 // 픽셀아트: 내부 렌더 해상도 축소 배율
  private input: Input
  private hud: HUD

  private dungeon: Dungeon
  private player!: Player
  private enemies: Enemy[] = []
  private projectiles: Projectiles
  private orbs: Orbs
  private effects: Effects
  private spawner: Spawner
  private audio = new AudioManager()

  private state: State = 'start'
  private kills = 0
  private score = 0
  private boss: Enemy | null = null
  private wasDashing = false
  private pendingReward = false
  private settingsOpen = false
  /** 획득한 특성 목록 (id → 업그레이드 + 획득 횟수=레벨) */
  private acquired = new Map<string, { upgrade: Upgrade; count: number }>()

  private clock = new THREE.Clock()
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private raycaster = new THREE.Raycaster()
  private aimGround = new THREE.Vector3()
  private camOffset = new THREE.Vector3(0, 24, 17)

  constructor(container: HTMLElement) {
    // 렌더러 (픽셀아트: 저해상도 렌더 → CSS 확대)
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.domElement.classList.add('pixelated')
    container.appendChild(this.renderer.domElement)

    // 만화풍 잉크 외곽선 (셀 셰이딩과 함께)
    this.outline = new OutlineEffect(this.renderer, {
      defaultThickness: 0.004,
      defaultColor: [0.04, 0.02, 0.05],
      defaultAlpha: 0.9,
      defaultKeepAlive: true,
    })

    // 씬
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(COLORS.fog)
    this.scene.fog = new THREE.Fog(COLORS.fog, 35, 70)

    // 카메라 (오쏘그래픽 2.5D 탑다운)
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
    this.camera.position.copy(this.camOffset)
    this.camera.lookAt(0, 0, 0)
    this.setRenderSize()

    // 조명
    this.scene.add(new THREE.AmbientLight(COLORS.ambient, 1.1))
    const key = new THREE.DirectionalLight(0xfff2d8, 1.6)
    key.position.set(20, 40, 18)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 120
    const s = CONFIG.arenaRadius + 6
    key.shadow.camera.left = -s
    key.shadow.camera.right = s
    key.shadow.camera.top = s
    key.shadow.camera.bottom = -s
    key.shadow.bias = -0.0004
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x6a8cff, 0.9) // 셀룩 강조용 림라이트
    rim.position.set(-15, 14, -22)
    this.scene.add(rim)
    const fill = new THREE.DirectionalLight(0xffd0a0, 0.35)
    fill.position.set(10, 6, 14)
    this.scene.add(fill)

    // 시스템
    this.dungeon = new Dungeon(this.scene)
    this.projectiles = new Projectiles(this.scene)
    this.orbs = new Orbs(this.scene)
    this.spawner = new Spawner()
    this.input = new Input(this.renderer.domElement)
    this.hud = new HUD(container)
    this.effects = new Effects(this.scene, this.hud.floaterLayer)

    this.hud.onStart(() => this.startGame())
    this.hud.onRestart(() => this.startGame())
    this.hud.onOpenSettings(() => this.toggleSettings())
    this.hud.onCloseSettings(() => this.closeSettings())
    this.hud.onVolume((kind, v) => {
      this.audio.init()
      if (kind === 'master') this.audio.setMasterVolume(v)
      else if (kind === 'music') this.audio.setMusicVolume(v)
      else this.audio.setSfxVolume(v)
    })

    // Tab: 설정창 열기/닫기 (기본 포커스 이동 방지)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault()
        this.toggleSettings()
      } else if (e.code === 'Escape' && this.settingsOpen) {
        this.closeSettings()
      }
    })

    window.addEventListener('resize', this.onResize)
    this.clock.start()
    requestAnimationFrame(this.loop)
  }

  private onResize = () => this.setRenderSize()

  /** 오쏘 프러스텀 + 저해상도(픽셀) 렌더 버퍼 설정 */
  private setRenderSize() {
    const w = window.innerWidth
    const h = window.innerHeight
    const aspect = w / h
    this.camera.left = -aspect * this.viewSize
    this.camera.right = aspect * this.viewSize
    this.camera.top = this.viewSize
    this.camera.bottom = -this.viewSize
    this.camera.updateProjectionMatrix()
    // 내부 렌더는 축소, 캔버스는 CSS로 화면 전체 (image-rendering: pixelated)
    const rw = Math.ceil(w / this.pixelScale)
    const rh = Math.ceil(h / this.pixelScale)
    this.renderer.setSize(rw, rh, false)
    this.outline.setSize(rw, rh)
  }

  private startGame() {
    // 리셋
    this.enemies.forEach((e) => this.scene.remove(e.group))
    this.enemies = []
    this.projectiles.clear()
    this.orbs.clear()
    this.effects.clear()
    this.spawner.reset()
    this.boss = null
    this.hud.showBoss(false)
    this.kills = 0
    this.score = 0
    this.acquired.clear()
    this.settingsOpen = false
    this.hud.closeSettings()

    if (this.player) this.scene.remove(this.player.group)
    this.player = new Player()
    this.scene.add(this.player.group)

    this.hud.setStats(1, 0, 0, 0)
    this.hud.setHp(this.player.hp, this.player.stats.maxHp)
    this.hud.setXp(0, this.player.xpToNext)

    // 오디오 (사용자 클릭 제스처이므로 여기서 시작 가능)
    this.audio.init()
    this.audio.resume()
    this.audio.startMusic()

    this.wasDashing = false
    this.state = 'playing'
  }

  private toggleSettings() {
    // 게임 진행 중(또는 이미 열림)일 때만 토글
    if (!this.player || (this.state !== 'playing' && !this.settingsOpen)) return
    if (this.settingsOpen) {
      this.closeSettings()
    } else {
      this.settingsOpen = true
      this.audio.init()
      this.audio.resume()
      this.hud.openSettings(
        [...this.acquired.values()],
        { master: this.audio.masterVol, music: this.audio.musicVol, sfx: this.audio.sfxVol },
        { gun: this.player.gun.name, gunIcon: this.player.gun.icon, sword: this.player.sword.name, swordIcon: this.player.sword.icon },
      )
    }
  }

  private closeSettings() {
    if (!this.settingsOpen) return
    this.settingsOpen = false
    this.hud.closeSettings()
    this.clock.getDelta() // 정지 동안 누적된 dt 폐기
  }

  private updateAim() {
    this.raycaster.setFromCamera(this.input.ndc as THREE.Vector2, this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.aimPlane, this.aimGround)
    if (!hit) this.aimGround.set(this.player.pos.x, 0, this.player.pos.z + 1)
  }

  // ===== 메인 루프 =====
  private loop = () => {
    requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta(), 0.05)

    if (this.state === 'playing' && !this.settingsOpen) this.step(dt)

    // 카메라 추적
    if (this.player) {
      const target = new THREE.Vector3(
        this.player.pos.x + this.camOffset.x,
        this.camOffset.y,
        this.player.pos.z + this.camOffset.z,
      )
      this.camera.position.lerp(target, this.state === 'playing' ? 0.08 : 0.05)
      this.camera.lookAt(this.player.pos.x, 1, this.player.pos.z)
    }

    // 이펙트는 일시정지 중에도 갱신(데미지 숫자 등)
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.effects.update(this.state === 'playing' ? dt : 0, this.camera, rect)

    this.outline.render(this.scene, this.camera)
  }

  private step(dt: number) {
    this.updateAim()

    // 플레이어
    const { bullets, slash, startedReload } = this.player.update(dt, this.input, this.aimGround, this.dungeon.radius)
    for (const b of bullets) {
      this.projectiles.spawnBullet(b.pos, b.dir, this.player.stats.bulletSpeed, b.damage, b.crit, this.player.stats.pierce)
    }
    if (bullets.length > 0) this.audio.gunshot()
    if (startedReload) this.audio.reload()
    if (slash) {
      this.audio.slash()
      this.effects.slash(slash.pos, slash.angle, slash.arc, slash.range)
      this.resolveSlash(slash.pos, slash.angle, slash.arc, slash.range, slash.damage, slash.crit, slash.knockback)
    }

    // 대시 시작 감지 → 회피 사운드
    if (this.player.isDashing && !this.wasDashing) this.audio.dash()
    // 대시 종료 감지 → 레전더리 '섬광강타' 폭발
    if (!this.player.isDashing && this.wasDashing && this.player.mods.dashStrike > 0) {
      this.aoeDamage(this.player.pos.x, this.player.pos.z, 4.5, this.player.mods.dashStrike, COLORS.slash)
    }
    this.wasDashing = this.player.isDashing

    // 스포너 (새로 스폰된 적을 씬에 추가)
    const newWave = this.spawner.update(dt, this.enemies, this.dungeon)
    for (const e of this.enemies) {
      if (!e.group.parent) this.scene.add(e.group)
    }
    if (newWave !== null) this.onWaveStart(newWave)

    // 적 갱신 + 충돌
    this.updateEnemies(dt)

    // 투사체
    this.projectiles.update(dt, this.dungeon.radius)
    this.resolveBullets()
    this.resolveEnemyBullets()

    // 경험치 오브
    const gained = this.orbs.update(dt, this.player.pos, this.player.stats.magnetRange, CONFIG.xp.orbSpeed)
    if (gained > 0) this.gainXp(gained)

    // 보스 체력바
    if (this.boss) {
      if (!this.boss.alive) {
        this.boss = null
        this.hud.showBoss(false)
      } else {
        this.hud.setBoss(this.boss.hp, this.boss.maxHp)
      }
    }

    // HUD
    this.hud.setHp(this.player.hp, this.player.stats.maxHp)
    this.hud.setDash(this.player.dashCooldownRatio, this.player.dashReady)
    this.hud.setAmmo(this.player.ammo, this.player.magSize, this.player.reloading, this.player.reloadRatio, this.player.gun.name)
    this.hud.setStats(this.player.level, this.spawner.wave, this.kills, this.score)

    // 사망
    if (!this.player.alive) this.gameOver()
    // 보스 처치 보상 (프레임 종료 후 안전하게 오픈)
    else if (this.pendingReward) {
      this.pendingReward = false
      this.openBossReward()
    }
  }

  /** 지정 위치 주변 원형 광역 피해 (레전더리 폭발 등) */
  private aoeDamage(x: number, z: number, radius: number, damage: number, color: number) {
    this.effects.burst(new THREE.Vector3(x, 1, z), color, 18, 10)
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = Math.hypot(e.pos.x - x, e.pos.z - z)
      if (d <= radius + e.radius) {
        e.takeDamage(damage)
        e.knockback(x, z, 6)
        this.effects.damageNumber(new THREE.Vector3(e.pos.x, 1.6, e.pos.z), damage, false)
      }
    }
  }

  private onWaveStart(wave: number) {
    if (this.spawner.isBossWave()) {
      this.audio.bossWarn()
      this.hud.banner_(`웨이브 ${wave}\n⚠ 보스 출현 ⚠`)
      // 이번 웨이브에 스폰될 보스를 추적 (스폰 직후 참조)
      setTimeout(() => {
        this.boss = this.enemies.find((e) => e.kind === 'boss') ?? null
        if (this.boss) this.hud.showBoss(true)
      }, 400)
    } else {
      this.audio.waveStart()
      this.hud.banner_(`웨이브 ${wave}`)
    }
  }

  private updateEnemies(dt: number) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      const shootDir = e.update(dt, this.player.pos)

      if (shootDir) {
        const origin = new THREE.Vector3(e.pos.x, 1.2, e.pos.z)
        this.projectiles.spawnEnemyBullet(origin, shootDir, 14, e.damage)
      }

      // 아레나 경계
      const r = Math.hypot(e.pos.x, e.pos.z)
      if (r > this.dungeon.radius) {
        e.pos.x = (e.pos.x / r) * this.dungeon.radius
        e.pos.z = (e.pos.z / r) * this.dungeon.radius
      }

      // 근접 접촉 데미지
      const dx = e.pos.x - this.player.pos.x
      const dz = e.pos.z - this.player.pos.z
      const d = Math.hypot(dx, dz)
      if (d < e.radius + CONFIG.player.radius && e.contactTimer <= 0) {
        if (this.player.takeDamage(e.damage)) {
          e.contactTimer = CONFIG.enemy.contactCooldown
          this.audio.hurt()
          this.effects.burst(new THREE.Vector3(this.player.pos.x, 1, this.player.pos.z), 0xff4040, 6, 4)
        }
      }

      // 적끼리 겹침 방지 (간단한 밀어내기)
      if (d < e.radius + CONFIG.player.radius && !this.player.isDashing) {
        // 플레이어를 관통하지 않도록 살짝 밀림
        const push = (e.radius + CONFIG.player.radius - d) * 0.5
        if (d > 0.01) {
          e.pos.x += (dx / d) * push
          e.pos.z += (dz / d) * push
        }
      }

      if (!e.alive) {
        this.killEnemy(e)
        this.enemies.splice(i, 1)
      }
    }
  }

  private resolveBullets() {
    const bs = this.projectiles.bullets
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i]
      let consumed = false
      for (const e of this.enemies) {
        if (!e.alive || b.hitSet.has(e.id)) continue
        const dx = e.pos.x - b.pos.x
        const dz = e.pos.z - b.pos.z
        if (dx * dx + dz * dz < (e.radius + 0.2) * (e.radius + 0.2)) {
          e.takeDamage(b.damage)
          b.hitSet.add(e.id)
          this.audio.hit()
          this.applyLifesteal(b.damage)
          this.effects.burst(new THREE.Vector3(e.pos.x, 1, e.pos.z), COLORS.hit, 5, 5)
          this.effects.damageNumber(new THREE.Vector3(e.pos.x, 1.6, e.pos.z), b.damage, b.crit)
          if (b.hitSet.size > b.pierce) {
            consumed = true
            break
          }
        }
      }
      if (consumed) this.projectiles.removeBullet(i)
    }
  }

  private resolveEnemyBullets() {
    const bs = this.projectiles.enemyBullets
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i]
      const dx = this.player.pos.x - b.pos.x
      const dz = this.player.pos.z - b.pos.z
      if (dx * dx + dz * dz < 0.9 * 0.9) {
        if (this.player.takeDamage(b.damage)) {
          this.audio.hurt()
          this.effects.burst(new THREE.Vector3(this.player.pos.x, 1, this.player.pos.z), 0xff4040, 6, 4)
        }
        this.projectiles.removeEnemyBullet(i)
      }
    }
  }

  private resolveSlash(
    pos: THREE.Vector3,
    angle: number,
    arc: number,
    range: number,
    damage: number,
    crit: boolean,
    knockback: number,
  ) {
    for (const e of this.enemies) {
      if (!e.alive) continue
      const dx = e.pos.x - pos.x
      const dz = e.pos.z - pos.z
      const dist = Math.hypot(dx, dz)
      if (dist > range + e.radius) continue
      const toAng = Math.atan2(dx, dz)
      let diff = Math.abs(toAng - angle)
      if (diff > Math.PI) diff = Math.PI * 2 - diff
      if (diff <= arc / 2 + 0.15) {
        e.takeDamage(damage)
        e.knockback(pos.x, pos.z, knockback)
        this.audio.hit()
        this.applyLifesteal(damage)
        this.effects.burst(new THREE.Vector3(e.pos.x, 1.2, e.pos.z), COLORS.slash, 8, 7)
        this.effects.damageNumber(new THREE.Vector3(e.pos.x, 1.8, e.pos.z), damage, crit)
      }
    }
  }

  private applyLifesteal(damage: number) {
    if (this.player.stats.lifesteal > 0) {
      this.player.heal(damage * this.player.stats.lifesteal)
    }
  }

  private killEnemy(e: Enemy) {
    this.scene.remove(e.group)
    this.kills++
    this.score += Math.round(e.maxHp)
    this.effects.burst(new THREE.Vector3(e.pos.x, 0.8, e.pos.z), COLORS.hit, 14, 8)
    this.orbs.drop(e.pos.x, e.pos.z, e.xp)
    // 레전더리 '폭심': 처치 시 폭발
    if (this.player.mods.explodeOnKill > 0) {
      this.aoeDamage(e.pos.x, e.pos.z, 3.2, this.player.mods.explodeOnKill, 0xffa040)
    }
    if (e.kind === 'boss') {
      this.boss = null
      this.hud.showBoss(false)
      this.hud.banner_('보스 격파! 보상 획득')
      this.audio.bossDeath()
      this.score += 500
      this.pendingReward = true
    } else {
      this.audio.death()
    }
  }

  private gainXp(amount: number) {
    const leveled = this.player.gainXp(amount)
    this.hud.setXp(this.player.xp, this.player.xpToNext)
    if (leveled) this.openLevelUp()
  }

  /** 특성 적용 + 획득 기록 */
  private applyTrait(u: Upgrade) {
    this.audio.pick()
    u.apply(this.player)
    const cur = this.acquired.get(u.id)
    if (cur) cur.count++
    else this.acquired.set(u.id, { upgrade: u, count: 1 })
    this.hud.setHp(this.player.hp, this.player.stats.maxHp)
    this.hud.setXp(this.player.xp, this.player.xpToNext)
  }

  /** 특성 선택 후, 쌓인 레벨업이 더 있으면 이어서 처리 */
  private afterTrait() {
    if (this.player.gainXp(0)) {
      this.hud.setXp(this.player.xp, this.player.xpToNext)
      this.openLevelUp()
    } else {
      this.state = 'playing'
      this.clock.getDelta() // 정지 동안 누적된 dt 폐기
    }
  }

  private openLevelUp() {
    this.state = 'levelup'
    this.audio.levelup()
    this.hud.showLevelUp('LEVEL UP!', '강화할 능력을 선택하세요', rollChoices(3), (u) => {
      this.applyTrait(u)
      this.afterTrait()
    })
  }

  /** 보스 처치 보상: 장비 1개 + 특성 1개 선택 */
  private openBossReward() {
    this.state = 'reward'
    this.audio.levelup()
    const weapons = rollWeapons(3, [this.player.gun.id, this.player.sword.id])
    this.hud.showEquipment(weapons as WeaponDef[], (w) => {
      this.audio.pick()
      this.player.equip(w)
      this.hud.setAmmo(this.player.ammo, this.player.magSize, false, 1, this.player.gun.name)
      // 이어서 특성 선택 (보스 보상 — 고희귀 편향)
      this.hud.showLevelUp('보스 보상 · 특성', '강력한 특성을 선택하세요', rollChoices(3, true), (u) => {
        this.applyTrait(u)
        this.afterTrait()
      })
    })
  }

  private gameOver() {
    this.state = 'gameover'
    this.audio.gameOver()
    this.audio.stopMusic()
    this.hud.showGameOver(this.spawner.wave, this.kills, this.score, this.player.level)
  }
}
