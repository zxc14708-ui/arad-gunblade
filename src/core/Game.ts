import * as THREE from 'three'
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js'
import { CONFIG, COLORS } from '../config'
import { Input } from './Input'
import { Room, RoomVisualKind } from '../systems/Room'
import { RunState, RoomPlan, ROOM_ICON, ROOM_LABEL } from '../systems/RunState'
import { Player } from '../entities/Player'
import { Enemy, EnemyKind } from '../entities/Enemy'
import { enemyTexture, ENEMY_SCALE } from '../entities/EnemySprite'
import { Interactable } from '../entities/Interactable'
import { Projectiles } from '../systems/Projectiles'
import { Pickups } from '../systems/Pickups'
import { Effects } from '../systems/Effects'
import { rollChoices, Upgrade } from '../systems/Upgrades'
import { Shop, ShopItem } from '../systems/Shop'
import { AudioManager } from '../systems/Audio'
import { HUD } from '../ui/HUD'

type State = 'start' | 'play' | 'levelup' | 'reward' | 'shop' | 'clear' | 'gameover'
type Mode = 'town' | 'dungeon'

export class Game {
  private renderer: THREE.WebGLRenderer
  private outline!: OutlineEffect
  private scene: THREE.Scene
  private camera!: THREE.OrthographicCamera
  private viewSize = 14
  private pixelScale = 3
  private input: Input
  private hud: HUD

  private room!: Room
  private interactables: Interactable[] = []
  private player!: Player
  private enemies: Enemy[] = []
  private projectiles: Projectiles
  private pickups: Pickups
  private effects: Effects
  private audio = new AudioManager()

  private run = new RunState()
  private shop: Shop | null = null
  private mode: Mode = 'town'
  private state: State = 'start'
  private roomCleared = false
  /** 룸 입장 시 순차 스폰 대기열 */
  private spawnQueue: EnemyKind[] = []
  private spawnTimer = 0
  private curPlan: RoomPlan | null = null

  private kills = 0
  private boss: Enemy | null = null
  private wasDashing = false
  private ghostTimer = 0
  private settingsOpen = false
  private prevE = false
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

    this.outline = new OutlineEffect(this.renderer, {
      defaultThickness: 0.004,
      defaultColor: [0.04, 0.02, 0.05],
      defaultAlpha: 0.9,
      defaultKeepAlive: true,
    })

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x05060a)
    this.scene.fog = new THREE.Fog(0x05060a, 45, 90)

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
    this.camera.position.copy(this.camOffset)
    this.camera.lookAt(0, 0, 0)
    this.setRenderSize()

    // 조명
    this.scene.add(new THREE.AmbientLight(COLORS.ambient, 1.15))
    const key = new THREE.DirectionalLight(0xfff2d8, 1.5)
    key.position.set(20, 40, 18)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 140
    const s = 34
    key.shadow.camera.left = -s
    key.shadow.camera.right = s
    key.shadow.camera.top = s
    key.shadow.camera.bottom = -s
    key.shadow.bias = -0.0004
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x6a8cff, 0.85)
    rim.position.set(-15, 14, -22)
    this.scene.add(rim)
    const fill = new THREE.DirectionalLight(0xffd0a0, 0.35)
    fill.position.set(10, 6, 14)
    this.scene.add(fill)

    // 시스템
    this.projectiles = new Projectiles(this.scene)
    this.pickups = new Pickups(this.scene)
    this.input = new Input(this.renderer.domElement)
    this.hud = new HUD(container)
    this.effects = new Effects(this.scene, this.hud.floaterLayer)

    this.hud.onStart(() => this.startGame())
    this.hud.onRestart(() => this.startGame())
    this.hud.onStageClear(() => this.enterTown())
    this.hud.onOpenSettings(() => this.toggleSettings())
    this.hud.onCloseSettings(() => this.closeSettings())
    this.hud.onVolume((kind, v) => {
      this.audio.init()
      if (kind === 'master') this.audio.setMasterVolume(v)
      else if (kind === 'music') this.audio.setMusicVolume(v)
      else this.audio.setSfxVolume(v)
    })
    this.hud.onShop(
      (i) => this.buyShopItem(i),
      () => this.rerollShop(),
      () => this.closeShop(),
    )

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault()
        this.toggleSettings()
      } else if (e.code === 'Escape') {
        if (this.settingsOpen) this.closeSettings()
        else if (this.state === 'shop') this.closeShop()
      }
    })

    window.addEventListener('resize', this.onResize)
    this.clock.start()
    requestAnimationFrame(this.loop)
  }

  private onResize = () => this.setRenderSize()

  private setRenderSize() {
    const w = window.innerWidth
    const h = window.innerHeight
    const aspect = w / h
    this.camera.left = -aspect * this.viewSize
    this.camera.right = aspect * this.viewSize
    this.camera.top = this.viewSize
    this.camera.bottom = -this.viewSize
    this.camera.updateProjectionMatrix()
    const rw = Math.ceil(w / this.pixelScale)
    const rh = Math.ceil(h / this.pixelScale)
    this.renderer.setSize(rw, rh, false)
    this.outline.setSize(rw, rh)
  }

  // ══════════════════ 게임 시작 / 씬 전환 ══════════════════

  private startGame() {
    this.clearWorld()
    this.kills = 0
    this.acquired.clear()
    this.settingsOpen = false
    this.hud.closeSettings()

    if (this.player) this.scene.remove(this.player.group)
    this.player = new Player()
    this.scene.add(this.player.group)

    this.audio.init()
    this.audio.resume()
    this.audio.startMusic()

    this.enterTown()
  }

  /** 월드(적/픽업/투사체/오브젝트) 정리 */
  private clearWorld() {
    this.enemies.forEach((e) => this.scene.remove(e.group))
    this.enemies = []
    this.spawnQueue = []
    this.projectiles.clear()
    this.pickups.clear()
    this.effects.clear()
    this.interactables.forEach((o) => o.removeFrom(this.scene))
    this.interactables = []
    this.boss = null
    this.hud.showBoss(false)
    this.hud.setPrompt(null)
  }

  /** 마을(허브) 입장 */
  private enterTown() {
    this.clearWorld()
    this.room?.dispose()
    this.room = new Room(this.scene, 'town', 'town')
    this.mode = 'town'
    this.state = 'play'
    this.roomCleared = true
    this.curPlan = null
    this.run.reset()

    // 던전 포탈 (북쪽 중앙)
    const p = this.room.doorPoints(1)[0]
    this.interactables.push(
      new Interactable('portal', p.x, p.z, `던전 입장 — ${this.run.cfg.name}`).addTo(this.scene),
    )
    // 마을 상인 (무료 아님 — 골드 있으면 구매 가능)
    this.interactables.push(new Interactable('merchant', -10, -2, '상인과 거래').addTo(this.scene))
    // 회복 분수
    this.interactables.push(new Interactable('fountain', 10, -2, '분수에서 회복').addTo(this.scene))

    const e = this.room.entryPoint()
    this.player.pos.set(e.x, 0, e.z)
    this.player.heal(9999) // 마을 복귀 시 완전 회복
    this.hud.setRoomTrack(0, 0, [])
    this.hud.banner_('아라드 마을')
    this.snapCamera()
    this.clock.getDelta()
  }

  /** 던전 1스테이지 시작 */
  private enterDungeon() {
    this.run.reset(1)
    this.mode = 'dungeon'
    const plan = this.run.enterFirst()
    this.loadRoom(plan)
    this.audio.waveStart()
  }

  /** 방 하나 구성 */
  private loadRoom(plan: RoomPlan) {
    this.clearWorld()
    this.room?.dispose()
    const visual: RoomVisualKind = plan.kind === 'boss' ? 'boss' : 'dungeon'
    this.room = new Room(this.scene, plan.kind, visual)
    this.curPlan = plan
    this.state = 'play'

    // 적 스폰 대기열
    this.spawnQueue = [...plan.enemies]
    this.spawnTimer = 0.25
    this.roomCleared = plan.enemies.length === 0

    // 보물상자
    for (let i = 0; i < plan.chests; i++) {
      const p = this.room.randomPoint(5)
      this.interactables.push(new Interactable('chest', p.x, p.z, '상자 열기').addTo(this.scene))
    }

    // 상점 방: 상인 + 회복 분수 (보스 입구)
    if (plan.kind === 'shop') {
      this.shop = new Shop([this.player.gun.id, this.player.sword.id])
      this.interactables.push(new Interactable('merchant', -6, -1, '상인과 거래').addTo(this.scene))
      this.interactables.push(new Interactable('fountain', 6, -1, '분수에서 회복').addTo(this.scene))
    }

    // 플레이어 진입 위치
    const e = this.room.entryPoint()
    this.player.pos.set(e.x, 0, e.z)

    // 배너 / 진행 표시
    this.hud.setRoomTrack(this.run.depth, this.run.bossDepth, [ROOM_ICON[plan.kind]])
    if (plan.kind === 'boss') {
      this.audio.bossWarn()
      this.hud.banner_('⚠ 보스 ⚠')
    } else {
      this.hud.banner_(`${this.run.depth}번째 방 · ${ROOM_LABEL[plan.kind]}`)
    }

    // 적 없는 방(상점)은 즉시 문 개방
    if (this.roomCleared) this.openDoors()

    this.snapCamera()
    this.clock.getDelta()
  }

  /** 방 클리어 → 다음 방 문 생성 */
  private openDoors() {
    if (this.curPlan?.kind === 'boss') return
    const choices = this.run.rollChoices()
    const pts = this.room.doorPoints(choices.length)
    choices.forEach((plan, i) => {
      const label = `${ROOM_LABEL[plan.kind]} 방으로 (${ROOM_ICON[plan.kind]})`
      const door = new Interactable('door', pts[i].x, pts[i].z, label)
      door.choiceIndex = i
      this.interactables.push(door.addTo(this.scene))
    })
  }

  private onRoomClear() {
    if (this.roomCleared) return
    this.roomCleared = true
    this.run.roomsCleared++
    if (this.curPlan?.kind === 'boss') {
      this.onStageClear()
    } else {
      this.audio.pick()
      this.hud.banner_('방 클리어! 문이 열렸다')
      this.openDoors()
    }
  }

  private onStageClear() {
    this.state = 'clear'
    this.audio.levelup()
    this.hud.showStageClear(this.run.stage, this.kills, this.run.gold, this.player.level)
  }

  /**
   * 카메라가 바라볼 지점 — 플레이어를 따라가되 방 밖(빈 공간)이 보이지 않도록 제한.
   * 방이 화면보다 작으면 방 중앙에 고정한다.
   */
  private camTarget() {
    const b = this.room.bounds
    // 화면이 덮는 지면 범위 (카메라 기울기 보정)
    const halfX = (this.camera.right - this.camera.left) / 2
    const pitchSin = this.camOffset.y / Math.hypot(this.camOffset.y, this.camOffset.z)
    const halfZ = this.viewSize / pitchSin

    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    const roomHalfX = (b.maxX - b.minX) / 2
    const roomHalfZ = (b.maxZ - b.minZ) / 2

    const x = roomHalfX <= halfX ? cx : Math.min(b.maxX - halfX, Math.max(b.minX + halfX, this.player.pos.x))
    const z = roomHalfZ <= halfZ ? cz : Math.min(b.maxZ - halfZ, Math.max(b.minZ + halfZ, this.player.pos.z))
    return { x, z }
  }

  private snapCamera() {
    const t = this.camTarget()
    this.camera.position.set(t.x + this.camOffset.x, this.camOffset.y, t.z + this.camOffset.z)
    this.camera.lookAt(t.x, 1, t.z)
  }

  // ══════════════════ 상호작용 ══════════════════

  private handleInteract() {
    const pressed = this.input.down('KeyE')
    const justPressed = pressed && !this.prevE
    this.prevE = pressed

    // 가장 가까운 상호작용 대상 찾기
    let target: Interactable | null = null
    let best = Infinity
    for (const o of this.interactables) {
      if (o.used && o.kind !== 'merchant' && o.kind !== 'portal') continue
      if (!o.inRange(this.player.pos)) continue
      const d = Math.hypot(o.pos.x - this.player.pos.x, o.pos.z - this.player.pos.z)
      if (d < best) {
        best = d
        target = o
      }
    }

    // 문은 적이 남아있으면 사용 불가
    if (target?.kind === 'door' && !this.roomCleared) target = null

    this.hud.setPrompt(target ? target.label : null)
    if (!target || !justPressed) return

    switch (target.kind) {
      case 'portal':
        this.enterDungeon()
        break
      case 'door':
        this.loadRoom(this.run.enter(target.choiceIndex))
        break
      case 'chest':
        this.openChest(target)
        break
      case 'fountain':
        this.useFountain(target)
        break
      case 'merchant':
        this.openShop()
        break
    }
  }

  private openChest(chest: Interactable) {
    chest.markUsed()
    this.audio.pick()
    this.effects.burst(new THREE.Vector3(chest.pos.x, 1.2, chest.pos.z), 0xffd870, 16, 7)
    // 60% 특성, 40% 골드
    if (Math.random() < 0.6) {
      this.state = 'levelup'
      this.input.clearAll()
      this.hud.showLevelUp('보물 발견!', '특성 하나를 선택하세요', rollChoices(3), (u) => {
        this.applyTrait(u)
        this.state = 'play'
        this.clock.getDelta()
      })
    } else {
      const gold = 30 + Math.floor(Math.random() * 40)
      this.pickups.dropGold(chest.pos.x, chest.pos.z + 1.2, gold)
      this.hud.banner_(`🪙 ${gold} 골드!`)
    }
  }

  private useFountain(f: Interactable) {
    const heal = Math.round(this.player.stats.maxHp * 0.45)
    this.player.heal(heal)
    f.markUsed()
    this.audio.pick()
    this.effects.burst(new THREE.Vector3(this.player.pos.x, 1.2, this.player.pos.z), 0x7fd8f0, 18, 6)
    this.hud.banner_(`체력 +${heal} 회복`)
  }

  // ══════════════════ 상점 ══════════════════

  private openShop() {
    if (!this.shop) this.shop = new Shop([this.player.gun.id, this.player.sword.id])
    this.state = 'shop'
    this.input.clearAll()
    this.renderShop()
  }

  private renderShop() {
    if (!this.shop) return
    const items = this.shop.items.map((it) => this.shopItemView(it))
    this.hud.renderShop(items, this.run.gold, this.shop.rerollPrice)
  }

  private shopItemView(it: ShopItem) {
    if (it.type === 'weapon') {
      return {
        icon: it.def.icon,
        name: it.def.name,
        desc: it.def.desc,
        rarity: it.def.rarity as string,
        price: it.price,
        sold: it.sold,
        tag: it.def.kind === 'gun' ? '총' : '검',
      }
    }
    if (it.type === 'trait') {
      return {
        icon: it.def.icon,
        name: it.def.name,
        desc: it.def.desc,
        rarity: it.def.rarity as string,
        price: it.price,
        sold: it.sold,
        tag: '특성',
      }
    }
    return {
      icon: '❤️',
      name: '치유 물약',
      desc: `체력 ${it.amount} 회복`,
      rarity: 'common',
      price: it.price,
      sold: it.sold,
      tag: '회복',
    }
  }

  private buyShopItem(index: number) {
    const shop = this.shop
    if (!shop) return
    const it = shop.items[index]
    if (!it || it.sold) return
    if (!this.run.spendGold(it.price)) return
    it.sold = true
    this.audio.pick()

    if (it.type === 'weapon') {
      this.player.equip(it.def)
      this.hud.banner_(`${it.def.name} 장착!`)
    } else if (it.type === 'trait') {
      this.applyTrait(it.def)
      this.hud.banner_(`${it.def.name} 획득!`)
    } else {
      this.player.heal(it.amount)
      this.hud.banner_(`체력 +${it.amount}`)
    }
    this.hud.setHp(this.player.hp, this.player.stats.maxHp)
    this.renderShop()
  }

  private rerollShop() {
    const shop = this.shop
    if (!shop) return
    if (!this.run.spendGold(shop.rerollPrice)) return
    shop.reroll([this.player.gun.id, this.player.sword.id])
    this.audio.reload()
    this.renderShop()
  }

  private closeShop() {
    if (this.state !== 'shop') return
    this.hud.closeShop()
    this.state = 'play'
    this.clock.getDelta()
  }

  // ══════════════════ 설정 ══════════════════

  private toggleSettings() {
    if (!this.player || (this.state !== 'play' && !this.settingsOpen)) return
    if (this.settingsOpen) {
      this.closeSettings()
    } else {
      this.settingsOpen = true
      this.input.clearAll()
      this.audio.init()
      this.audio.resume()
      this.hud.openSettings(
        [...this.acquired.values()],
        { master: this.audio.masterVol, music: this.audio.musicVol, sfx: this.audio.sfxVol },
        {
          gun: this.player.gun.name,
          gunIcon: this.player.gun.icon,
          sword: this.player.sword.name,
          swordIcon: this.player.sword.icon,
        },
      )
    }
  }

  private closeSettings() {
    if (!this.settingsOpen) return
    this.settingsOpen = false
    this.hud.closeSettings()
    this.clock.getDelta()
  }

  private updateAim() {
    this.raycaster.setFromCamera(this.input.ndc as THREE.Vector2, this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.aimPlane, this.aimGround)
    if (!hit) this.aimGround.set(this.player.pos.x, 0, this.player.pos.z + 1)
  }

  // ══════════════════ 메인 루프 ══════════════════

  private loop = () => {
    requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    this.input.update()

    const running = this.state === 'play' && !this.settingsOpen
    if (running) this.step(dt)

    if (this.player && this.room) {
      const t = this.camTarget()
      const target = new THREE.Vector3(t.x + this.camOffset.x, this.camOffset.y, t.z + this.camOffset.z)
      this.camera.position.lerp(target, running ? 0.1 : 0.05)
      const look = new THREE.Vector3(
        this.camera.position.x - this.camOffset.x,
        1,
        this.camera.position.z - this.camOffset.z,
      )
      this.camera.lookAt(look)
    }

    const rect = this.renderer.domElement.getBoundingClientRect()
    this.effects.update(running ? dt : 0, this.camera, rect)

    this.outline.render(this.scene, this.camera)
  }

  private step(dt: number) {
    this.updateAim()

    // ── 플레이어 ──
    const { bullets, slash, startedReload } = this.player.update(dt, this.input, this.aimGround)
    this.room.clamp(this.player.pos, CONFIG.player.radius)

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

    // 대시 잔상
    if (this.player.isDashing) {
      this.ghostTimer -= dt
      if (this.ghostTimer <= 0) {
        this.ghostTimer = 0.045
        this.effects.ghost(this.player.ghostParams(), this.player.pos)
      }
    } else {
      this.ghostTimer = 0
    }
    if (this.player.isDashing && !this.wasDashing) this.audio.dash()
    if (!this.player.isDashing && this.wasDashing && this.player.mods.dashStrike > 0) {
      this.aoeDamage(this.player.pos.x, this.player.pos.z, 4.5, this.player.mods.dashStrike, COLORS.slash)
    }
    this.wasDashing = this.player.isDashing

    // ── 룸 적 스폰 ──
    if (this.spawnQueue.length > 0) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 0.14
        const kind = this.spawnQueue.shift()!
        const p = this.room.spawnPoint()
        const plan = this.curPlan!
        const e = new Enemy(kind, p.x, p.z, plan.hpMul, plan.dmgMul, plan.speedMul)
        this.enemies.push(e)
        this.scene.add(e.group)
        this.effects.burst(new THREE.Vector3(p.x, 1, p.z), 0x8a4a6a, 8, 5)
        if (kind === 'boss') {
          this.boss = e
          this.hud.showBoss(true)
        }
      }
    }

    // ── 적 / 투사체 / 픽업 ──
    this.updateEnemies(dt)
    this.projectiles.update(dt, this.room.bounds)
    this.resolveBullets()
    this.resolveEnemyBullets()

    const got = this.pickups.update(dt, this.player.pos, this.player.stats.magnetRange, CONFIG.xp.orbSpeed)
    if (got.xp > 0) this.gainXp(got.xp)
    if (got.gold > 0) this.run.addGold(got.gold)

    // ── 방 장식 / 상호작용 오브젝트 ──
    this.room.update(dt)
    for (const o of this.interactables) o.update(dt)
    this.handleInteract()

    // ── 방 클리어 판정 ──
    if (!this.roomCleared && this.spawnQueue.length === 0 && this.enemies.length === 0) this.onRoomClear()

    // ── 보스 체력바 ──
    if (this.boss) {
      if (!this.boss.alive) {
        this.boss = null
        this.hud.showBoss(false)
      } else {
        this.hud.setBoss(this.boss.hp, this.boss.maxHp)
      }
    }

    // ── HUD ──
    this.hud.setHp(this.player.hp, this.player.stats.maxHp)
    this.hud.setDash(this.player.dashCooldownRatio, this.player.dashReady)
    this.hud.setAmmo(this.player.ammo, this.player.magSize, this.player.reloading, this.player.reloadRatio, this.player.gun.name)
    this.hud.setStats(this.player.level, this.mode === 'town' ? 0 : this.run.depth, this.kills, this.run.gold)

    if (!this.player.alive) this.gameOver()
  }

  /** 광역 피해 */
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

  private updateEnemies(dt: number) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      const shootDir = e.update(dt, this.player.pos)

      if (shootDir) {
        const origin = new THREE.Vector3(e.pos.x, 1.2, e.pos.z)
        this.projectiles.spawnEnemyBullet(origin, shootDir, 14, e.damage)
      }

      // 방 경계
      this.room.clamp(e.pos, e.radius * 0.6)

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
      if (d < e.radius + CONFIG.player.radius && !this.player.isDashing) {
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
    if (this.player.stats.lifesteal > 0) this.player.heal(damage * this.player.stats.lifesteal)
  }

  private killEnemy(e: Enemy) {
    this.scene.remove(e.group)
    this.kills++
    this.effects.deathDissolve(e.pos, enemyTexture(e.kind), ENEMY_SCALE[e.kind])
    this.effects.burst(new THREE.Vector3(e.pos.x, 0.8, e.pos.z), COLORS.hit, 14, 8)

    // 경험치 + 골드 드랍
    this.pickups.dropXp(e.pos.x, e.pos.z, e.xp)
    const gold = e.kind === 'boss' ? 120 + Math.floor(Math.random() * 60) : Math.max(2, Math.round(e.maxHp * 0.22))
    this.pickups.dropGold(e.pos.x, e.pos.z, gold)

    if (this.player.mods.explodeOnKill > 0) {
      this.aoeDamage(e.pos.x, e.pos.z, 3.2, this.player.mods.explodeOnKill, 0xffa040)
    }
    if (e.kind === 'boss') {
      this.boss = null
      this.hud.showBoss(false)
      this.audio.bossDeath()
    } else {
      this.audio.death()
    }
  }

  private applyTrait(u: Upgrade) {
    this.audio.pick()
    u.apply(this.player)
    const cur = this.acquired.get(u.id)
    if (cur) cur.count++
    else this.acquired.set(u.id, { upgrade: u, count: 1 })
    this.hud.setHp(this.player.hp, this.player.stats.maxHp)
    this.hud.setXp(this.player.xp, this.player.xpToNext)
  }

  private gainXp(amount: number) {
    const leveled = this.player.gainXp(amount)
    this.hud.setXp(this.player.xp, this.player.xpToNext)
    if (leveled) this.openLevelUp()
  }

  private openLevelUp() {
    this.state = 'levelup'
    this.input.clearAll()
    this.audio.levelup()
    this.hud.showLevelUp('LEVEL UP!', '강화할 능력을 선택하세요', rollChoices(3), (u) => {
      this.applyTrait(u)
      // 레벨이 더 쌓였으면 연속 처리
      if (this.player.gainXp(0)) {
        this.hud.setXp(this.player.xp, this.player.xpToNext)
        this.openLevelUp()
      } else {
        this.state = 'play'
        this.clock.getDelta()
      }
    })
  }

  private gameOver() {
    this.state = 'gameover'
    this.audio.gameOver()
    this.hud.setPrompt(null)
    this.hud.showGameOver(this.run.depth, this.kills, this.run.gold, this.player.level)
  }
}
