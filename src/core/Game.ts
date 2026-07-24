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
import { AudioManager } from '../systems/Audio'
import { HUD } from '../ui/HUD'

type State = 'start' | 'playing' | 'levelup' | 'gameover'

export class Game {
  private renderer: THREE.WebGLRenderer
  private outline!: OutlineEffect
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
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
  private settingsOpen = false
  /** 획득한 특성 목록 (id → 업그레이드 + 획득 횟수=레벨) */
  private acquired = new Map<string, { upgrade: Upgrade; count: number }>()

  private clock = new THREE.Clock()
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private raycaster = new THREE.Raycaster()
  private aimGround = new THREE.Vector3()
  private camOffset = new THREE.Vector3(0, 33, 20)

  constructor(container: HTMLElement) {
    // 렌더러
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
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

    // 카메라
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200)
    this.camera.position.copy(this.camOffset)
    this.camera.lookAt(0, 0, 0)

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

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.outline.setSize(window.innerWidth, window.innerHeight)
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
    this.hud.setAmmo(this.player.ammo, this.player.magSize, this.player.reloading, this.player.reloadRatio)
    this.hud.setStats(this.player.level, this.spawner.wave, this.kills, this.score)

    // 사망
    if (!this.player.alive) this.gameOver()
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
    if (e === this.boss) {
      this.boss = null
      this.hud.showBoss(false)
      this.hud.banner_('보스 격파!')
      this.audio.bossDeath()
      this.score += 500
    } else {
      this.audio.death()
    }
  }

  private gainXp(amount: number) {
    const leveled = this.player.gainXp(amount)
    this.hud.setXp(this.player.xp, this.player.xpToNext)
    if (leveled) this.openLevelUp()
  }

  private openLevelUp() {
    this.state = 'levelup'
    this.audio.levelup()
    const choices = rollChoices(3)
    this.hud.showLevelUp(choices, (u) => {
      this.audio.pick()
      u.apply(this.player)
      // 획득 특성 기록 (같은 특성 재획득 시 레벨 증가)
      const cur = this.acquired.get(u.id)
      if (cur) cur.count++
      else this.acquired.set(u.id, { upgrade: u, count: 1 })
      this.hud.setHp(this.player.hp, this.player.stats.maxHp)
      this.hud.setXp(this.player.xp, this.player.xpToNext)
      // 한 번에 여러 레벨이 쌓였으면 연속으로 선택창을 다시 연다
      if (this.player.gainXp(0)) {
        this.hud.setXp(this.player.xp, this.player.xpToNext)
        this.openLevelUp()
      } else {
        this.state = 'playing'
        this.clock.getDelta() // 정지 동안 누적된 dt 폐기
      }
    })
  }

  private gameOver() {
    this.state = 'gameover'
    this.audio.gameOver()
    this.audio.stopMusic()
    this.hud.showGameOver(this.spawner.wave, this.kills, this.score, this.player.level)
  }
}
