import * as THREE from 'three'
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js'
import { CONFIG, COLORS } from '../config'
import { Input } from './Input'
import { Room, RoomVisualKind } from '../systems/Room'
import { RunState, RoomPlan, ROOM_ICON, roomLabel, Direction, OPPOSITE } from '../systems/RunState'
import { Player } from '../entities/Player'
import { Enemy, EnemyAction, EnemyKind } from '../entities/Enemy'
import { enemyDeathArt, ENEMY_SCALE } from '../entities/EnemySprite'
import { Interactable } from '../entities/Interactable'
import { Projectiles } from '../systems/Projectiles'
import { Pickups } from '../systems/Pickups'
import { Effects } from '../systems/Effects'
import { rollChoices, Upgrade, forgeSwapCandidates } from '../systems/Upgrades'
import { Shop, ShopItem } from '../systems/Shop'
import { AudioManager } from '../systems/Audio'
import { ELITE_AFFIX } from '../systems/EliteAffixes'
import { MetaProgression } from '../systems/MetaProgression'
import { weaponById } from '../systems/Weapons'
import { preloadAssets } from '../rendering/assets'
import { HUD } from '../ui/HUD'

type State = 'start' | 'play' | 'levelup' | 'reward' | 'shop' | 'meta' | 'loadout' | 'clear' | 'gameover'
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
  /** 마을 상인 전용 재고. 런 시작부터 런 종료까지 유지한다. */
  private meta = new MetaProgression()
  /** 던전 상점방 전용 재고. 방 id 기준으로 재방문 시 유지한다. */
  private shop: Shop | null = null
  private shopRoomId: string | null = null
  private mode: Mode = 'town'
  private state: State = 'start'
  private roomCleared = false
  /** 룸 입장 시 순차 스폰 대기열 */
  private spawnQueue: EnemyKind[] = []
  private spawnTimer = 0
  /** 방 입장 직후 스폰을 미루는 유예 시간 — 문 열자마자 맞는 것을 막는다 */
  private entrySafeTimer = 0
  private curPlan: RoomPlan | null = null

  private kills = 0
  private boss: Enemy | null = null
  /** 히트스톱 잔여 시간 — 겹치면 더하지 않고 더 긴 쪽으로 갱신(triggerHitstop) */
  private hitstopTimer = 0
  private wasDashing = false
  private ghostTimer = 0
  private settingsOpen = false
  private acquired = new Map<string, { upgrade: Upgrade; count: number }>()
  /** 마을 시설은 런당 1회 — 마을을 다시 방문해도 재사용되지 않게 런 단위로 기억한다 */
  private startingTraitTaken = false
  private traitForgeUsed = false

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
    this.hud.onShakeToggle((on) => this.effects.setShakeEnabled(on))
    this.hud.onKeybind((action, code) => this.input.rebind(action, code))
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
        else if (this.state === 'meta') this.closeMeta()
        else if (this.state === 'loadout') this.closeLoadout()
      }
    })

    // 애셋 선로딩 (첫 사용 시 텍스처가 비어 검게 나오는 것 방지)
    void preloadAssets()

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
    this.startingTraitTaken = false
    this.traitForgeUsed = false
    this.settingsOpen = false
    this.hud.closeSettings()

    if (this.player) this.scene.remove(this.player.group)
    this.player = new Player(this.meta.bonuses())
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
    this.shop = null
    this.shopRoomId = null

    // 던전 포탈 — 북쪽 문 라인 대신 마을 안쪽에 둬 상단 벽/HUD에 가리지 않게 한다.
    const p = { x: 0, z: this.room.bounds.minZ + 8 }
    this.interactables.push(
      new Interactable('portal', p.x, p.z, `던전 입장 — ${this.run.cfg.name}`).addTo(this.scene),
    )
    // 마을 상인은 런 골드가 아닌 영구 재화로 무기를 해금한다.
    this.interactables.push(new Interactable('merchant', -10, -2, '모험가 상점 — 무기 설계도').addTo(this.scene))
    // 회복 분수
    this.interactables.push(new Interactable('fountain', 10, -2, '분수에서 회복').addTo(this.scene))
    // 특성 시설 (런당 1회)
    this.interactables.push(new Interactable('traitAltar', -6, 6, '시작 특성 선택').addTo(this.scene))
    this.interactables.push(new Interactable('metaAltar', 6, 6, '힘의 제단 — 영구 강화').addTo(this.scene))

    const e = this.room.entryPoint()
    this.player.pos.set(e.x, 0, e.z)
    this.player.heal(9999) // 마을 복귀 시 완전 회복
    this.hud.setMinimap([])
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
  private loadRoom(plan: RoomPlan, enteredFrom: Direction = 'south') {
    this.clearWorld()
    this.room?.dispose()
    const visual: RoomVisualKind = plan.kind === 'boss' ? 'boss' : 'dungeon'
    this.room = new Room(this.scene, plan.kind, visual)
    this.curPlan = plan
    this.state = 'play'

    // 적 스폰 대기열
    const alreadyCleared = this.run.isCurrentCleared()
    this.spawnQueue = alreadyCleared ? [] : [...plan.enemies]
    this.spawnTimer = 0.25
    this.entrySafeTimer = alreadyCleared ? 0 : 1
    if (plan.enemies.length === 0) this.run.markCurrentCleared()
    this.roomCleared = this.run.isCurrentCleared()

    // 보물상자
    for (let i = 0; i < plan.chests; i++) {
      if (this.run.isObjectUsed('chests-opened')) break
      const p = this.room.randomPoint(5)
      this.interactables.push(new Interactable('chest', p.x, p.z, '상자 열기').addTo(this.scene))
    }

    // 상점 방: 상인 + 제련소 (분수는 별도 — 상점방 포함 여러 방에 배치될 수 있다)
    if (plan.kind === 'shop' || plan.kind === 'rest') {
      if (this.shopRoomId !== plan.id) {
        this.shop = new Shop([this.player.gun.id, this.player.sword.id], this.player.traitStacks)
        this.shopRoomId = plan.id
      }
      this.interactables.push(new Interactable('merchant', -6, -1, plan.kind === 'rest' ? '보스전 물자 준비' : '상인과 거래').addTo(this.scene))
      this.interactables.push(new Interactable('dungeonForge', 0, 4, this.dungeonForgeLabel()).addTo(this.scene))
    }

    // 회복 분수 — RunState.generateMap()이 맵 생성 시점에 hasFountain을 정해
    // 재방문해도 나타났다 사라지지 않는다(상점방 1개 + 전투방 일부, DESIGN_LOG
    // B5 "분수 사문화" 해결).
    if (plan.hasFountain) {
      const p = plan.kind === 'shop' || plan.kind === 'rest' ? { x: 6, z: -1 } : this.room.randomPoint(5)
      this.interactables.push(new Interactable('fountain', p.x, p.z, plan.kind === 'rest' ? `보스전 ${this.fountainLabel()}` : this.fountainLabel()).addTo(this.scene))
    }

    // 플레이어 진입 위치
    const e = this.room.entryPoint(enteredFrom)
    this.player.pos.set(e.x, 0, e.z)

    // 배너 / 진행 표시
    this.hud.setMinimap(this.run.minimap())
    if (plan.kind === 'boss') {
      this.audio.bossWarn()
      this.hud.banner_('⚠ 보스 ⚠')
    } else {
      this.hud.banner_(`${this.run.depth}번째 방 · ${roomLabel(plan)}`)
    }

    // 적 없는 방(상점)은 즉시 문 개방
    if (this.roomCleared) this.openDoors()

    this.snapCamera()
    this.clock.getDelta()
  }

  /** 방 클리어 → 다음 방 문 생성 */
  private openDoors() {
    if (this.curPlan?.kind === 'boss') return
    this.run.exits.forEach(({ direction, plan }) => {
      const p = this.room.doorPoint(direction)
      const label = `${roomLabel(plan)} 방으로 (${ROOM_ICON[plan.kind]})`
      const door = new Interactable('door', p.x, p.z, label)
      door.targetRoomId = plan.id
      door.direction = direction
      this.interactables.push(door.addTo(this.scene))
    })
  }

  private onRoomClear() {
    if (this.roomCleared) return
    this.roomCleared = true
    this.run.markCurrentCleared()
    this.hud.setMinimap(this.run.minimap())
    if (this.curPlan?.kind === 'boss') {
      this.onStageClear()
    } else if (this.curPlan?.kind === 'elite') {
      this.grantEliteReward()
    } else {
      this.audio.pick()
      this.hud.banner_('방 클리어! 문이 열렸다')
      this.openDoors()
    }
  }

  /** Elite rooms grant a reward before exits are unlocked. */
  private grantEliteReward() {
    this.state = 'reward'
    this.input.clearAll()
    this.audio.levelup()
    const gold = 35 + this.run.depth * 12
    this.run.addGold(gold)
    this.meta.grantEliteToken()
    const choices = rollChoices(3, false, this.player.traitStacks)
    if (choices.length === 0) {
      this.state = 'play'
      this.hud.banner_(`골드 +${gold} · 모험가 증표 +1 · 획득 가능한 특성이 없습니다`)
      this.openDoors()
      this.clock.getDelta()
      return
    }
    this.hud.showLevelUp('ELITE CLEAR!', `고급 특성을 선택하세요 · 골드 +${gold}`, choices, (u) => {
      this.applyTrait(u)
      this.audio.pick()
      this.state = 'play'
      this.hud.banner_('엘리트 보상 획득!')
      this.openDoors()
      this.clock.getDelta()
    })
  }

  private onStageClear() {
    this.state = 'clear'
    this.audio.levelup()
    const reward = this.meta.grantStageClear()
    this.hud.showStageClear(this.run.stage, this.kills, this.run.gold, this.player.level, reward)
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
    // 엣지 트리거 — 빠른 E 탭도 놓치지 않음
    const justPressed = this.input.consumeAction('interact')

    // 가장 가까운 상호작용 대상 찾기
    let target: Interactable | null = null
    let best = Infinity
    for (const o of this.interactables) {
      if (o.used && o.kind !== 'merchant' && o.kind !== 'portal' && o.kind !== 'dungeonForge') continue
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
        this.openLoadout()
        break
      case 'door':
        if (target.targetRoomId && target.direction) {
          this.loadRoom(this.run.enter(target.targetRoomId), OPPOSITE[target.direction])
        }
        break
      case 'chest':
        this.openChest(target)
        break
      case 'fountain':
        this.useFountain(target)
        break
      case 'merchant':
        if (this.mode === 'town') this.openMetaShop()
        else this.openShop()
        break
      case 'traitAltar':
        this.useTraitAltar(target)
        break
      case 'traitForge':
        this.useTraitForge(target)
        break
      case 'metaAltar':
        this.openMetaAltar()
        break
      case 'dungeonForge':
        this.useDungeonForge(target)
        break
    }
  }

  /** 시작 특성 제단 — 런 시작 시 특성 하나를 골라 방향성을 잡는다 (런당 1회) */
  private useTraitAltar(altar: Interactable) {
    if (this.startingTraitTaken) {
      this.hud.banner_('시작 특성은 이번 런에서 이미 선택했습니다')
      return
    }
    this.state = 'levelup'
    this.input.clearAll()
    this.audio.levelup()
    const choices = rollChoices(3, false, this.player.traitStacks)
    if (choices.length === 0) {
      this.startingTraitTaken = true
      altar.markUsed()
      this.state = 'play'
      this.hud.banner_('획득 가능한 특성이 없습니다')
      this.clock.getDelta()
      return
    }
    this.hud.showLevelUp('첫 번째 특성', '이번 런을 이끌 특성 하나를 선택하세요', choices, (u) => {
      this.applyTrait(u)
      this.startingTraitTaken = true
      altar.markUsed()
      this.state = 'play'
      this.hud.banner_(`${u.name} 선택!`)
      this.clock.getDelta()
    })
  }

  /** 특성 제련소 — 이미 가진 특성 하나를 한 단계 더 올린다 (런당 1회) */
  private useTraitForge(forge: Interactable) {
    if (this.traitForgeUsed) {
      this.hud.banner_('특성 제련은 이번 런에서 이미 사용했습니다')
      return
    }
    const owned = [...this.acquired.values()]
      .map((a) => a.upgrade)
      .filter((u) => this.player.canAcquireTrait(u.id, u.maxStacks))
    if (owned.length === 0) {
      this.hud.banner_('강화할 특성이 없습니다 — 먼저 특성을 획득하세요')
      return
    }
    // 보유 특성이 많으면 무작위 3개만 제시 (앞의 3개만 계속 나오지 않게)
    const choices = owned.sort(() => Math.random() - 0.5).slice(0, 3)
    this.state = 'levelup'
    this.input.clearAll()
    this.audio.levelup()
    this.hud.showLevelUp('특성 제련', '보유 특성 하나를 한 단계 강화합니다', choices, (u) => {
      this.applyTrait(u)
      this.traitForgeUsed = true
      forge.markUsed()
      this.state = 'play'
      this.hud.banner_(`${u.name} 강화!`)
      this.clock.getDelta()
    })
  }

  /**
   * 던전 제련소 — 보유 특성 1개를 같은 등급의 다른 특성으로 교체(유료, 반복 사용
   * 가능). 특성 효과는 apply()가 누적 연산만 하고 되돌릴 수 없는 구조라 "교체"는
   * 스택 장부만 옮긴다 — 기존 특성 A의 스택을 1 내리고(효과는 유지) 새 특성 B의
   * 스택을 1 올려 적용한다. 플레이어 파워가 줄어드는 일은 없다(마을/던전 제련소가
   * 이미 "스택을 더 쌓는" 방식이라 이번 것도 같은 성질을 유지한 것 — DESIGN_LOG 참고).
   */
  private useDungeonForge(forge: Interactable) {
    const price = this.run.dungeonForgePrice
    const owned = [...this.acquired.values()]
      .map((a) => a.upgrade)
      .filter((u) => forgeSwapCandidates(u.id, this.player.traitStacks).length > 0)
    if (owned.length === 0) {
      this.hud.banner_('교체할 수 있는 특성이 없습니다')
      return
    }
    if (this.run.gold < price) {
      this.hud.banner_(`골드가 부족합니다 (제련소 ${price}G)`)
      return
    }
    const choices = owned.sort(() => Math.random() - 0.5).slice(0, 3)
    this.state = 'levelup'
    this.input.clearAll()
    this.audio.levelup()
    this.hud.showLevelUp('제련소 — 교체할 특성', `${price} 골드 — 같은 등급의 다른 특성으로 교체합니다`, choices, (from) => {
      const candidates = forgeSwapCandidates(from.id, this.player.traitStacks).sort(() => Math.random() - 0.5).slice(0, 3)
      this.hud.showLevelUp('제련소 — 무엇으로 교체할까요?', `${from.name} 을(를) 교체`, candidates, (to) => {
        if (!this.run.spendGold(price)) {
          this.state = 'play'
          return
        }
        const stack = Math.max(0, this.player.traitStacks.get(from.id) ?? 0)
        this.player.traitStacks.set(from.id, stack > 0 ? stack - 1 : 0)
        const cur = this.acquired.get(from.id)
        if (cur) {
          cur.count--
          if (cur.count <= 0) this.acquired.delete(from.id)
        }
        this.applyTrait(to)
        this.run.dungeonForgePrice = Math.round(price * CONFIG.economy.dungeonForgePriceRatio)
        forge.label = this.dungeonForgeLabel()
        this.state = 'play'
        this.hud.banner_(`${from.name} → ${to.name} 교체!`)
        this.clock.getDelta()
      })
    })
  }

  private dungeonForgeLabel() {
    return `제련소 — 특성 교체 (${this.run.dungeonForgePrice}G)`
  }

  private fountainLabel() {
    return this.run.fountainFreeUsed ? `분수에서 회복 (${this.run.fountainPrice}G)` : '분수에서 회복 (무료)'
  }

  private openChest(chest: Interactable) {
    chest.markUsed()
    this.run.markObjectUsed('chests-opened')
    this.audio.pick()
    this.effects.burst(new THREE.Vector3(chest.pos.x, 1.2, chest.pos.z), 0xffd870, 16, 7)
    // 60% 특성, 40% 골드
    if (Math.random() < 0.6) {
      this.state = 'levelup'
      this.input.clearAll()
      const choices = rollChoices(3, false, this.player.traitStacks)
      if (choices.length === 0) {
        this.state = 'play'
        this.hud.banner_('획득 가능한 특성이 없습니다')
        this.clock.getDelta()
        return
      }
      this.hud.showLevelUp('보물 발견!', '특성 하나를 선택하세요', choices, (u) => {
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

  /**
   * 회복 분수. 마을 분수는 항상 무료. 던전 분수는 런 전체 첫 사용만 무료이고
   * 이후로는 유료(가격은 런 단위로 유지, 사용할 때마다 오름) — 방당 1회 제한은
   * run.isObjectUsed('fountain')로 그대로 유지된다.
   */
  private useFountain(f: Interactable) {
    if (this.run.isObjectUsed('fountain')) return
    const isTown = this.mode === 'town'
    let priceCharged = 0
    if (!isTown && this.run.fountainFreeUsed) {
      const price = this.run.fountainPrice
      if (!this.run.spendGold(price)) {
        this.hud.banner_(`골드가 부족합니다 (분수 ${price}G)`)
        return
      }
      priceCharged = price
      this.run.fountainPrice = Math.round(price * CONFIG.economy.fountainPriceRatio)
    }
    const heal = Math.round(this.player.stats.maxHp * 0.45)
    this.player.heal(heal)
    f.markUsed()
    this.run.markObjectUsed('fountain')
    if (!isTown) this.run.fountainFreeUsed = true
    this.audio.pick()
    this.effects.burst(new THREE.Vector3(this.player.pos.x, 1.2, this.player.pos.z), 0x7fd8f0, 18, 6)
    this.hud.banner_(priceCharged > 0 ? `체력 +${heal} 회복 (-${priceCharged}G)` : `체력 +${heal} 회복`)
  }

  // ══════════════════ 상점 ══════════════════

  private openShop() {
    if (!this.shop) {
      this.shop = new Shop([this.player.gun.id, this.player.sword.id], this.player.traitStacks)
    }
    this.state = 'shop'
    this.input.clearAll()
    this.renderShop()
  }

  private activeShop() {
    return this.shop
  }

  private renderShop() {
    const shop = this.activeShop()
    if (!shop) return
    const items = shop.items.map((it) => this.shopItemView(it))
    this.hud.renderShop(items, this.run.gold, shop.rerollPrice)
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
    const shop = this.activeShop()
    if (!shop) return
    const it = shop.items[index]
    if (!it || it.sold) return
    if (it.type === 'trait' && !this.player.canAcquireTrait(it.def.id, it.def.maxStacks)) {
      this.hud.banner_('이 특성은 최대 스택에 도달했습니다')
      return
    }
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
    const shop = this.activeShop()
    if (!shop) return
    if (!this.run.spendGold(shop.rerollPrice)) return
    shop.reroll([this.player.gun.id, this.player.sword.id], this.player.traitStacks)
    this.audio.reload()
    this.renderShop()
  }

  private closeShop() {
    if (this.state !== 'shop') return
    this.hud.closeShop()
    this.state = 'play'
    this.clock.getDelta()
  }

  private openMetaAltar() {
    this.state = 'meta'
    this.input.clearAll()
    this.renderMetaAltar()
  }

  private renderMetaAltar() {
    const profile = this.meta.snapshot
    this.hud.showMetaAltar(profile.crystals, this.meta.upgradeViews(), (id) => {
      if (!this.meta.buyUpgrade(id)) return
      this.player.applyMetaBonuses(this.meta.bonuses())
      this.audio.pick()
      this.hud.banner_('영구 강화 완료 — 이번 출발부터 적용됩니다')
      this.renderMetaAltar()
    }, () => this.closeMeta())
  }

  private openMetaShop() {
    this.state = 'meta'
    this.input.clearAll()
    this.renderMetaShop()
  }

  private renderMetaShop() {
    const profile = this.meta.snapshot
    this.hud.showMetaShop(profile.tokens, this.meta.weaponViews(), (id) => {
      if (!this.meta.unlockWeapon(id)) return
      const weapon = weaponById(id)
      this.audio.pick()
      this.hud.banner_(`${weapon?.name ?? '무기'} 설계도 해금!`)
      this.renderMetaShop()
    }, () => this.closeMeta())
  }

  private closeMeta() {
    if (this.state !== 'meta') return
    this.hud.closeMeta()
    this.state = 'play'
    this.clock.getDelta()
  }

  private openLoadout() {
    const loadout = this.meta.loadoutWeapons()
    this.state = 'loadout'
    this.input.clearAll()
    this.hud.showLoadout(loadout.guns, loadout.swords, loadout.selected, (gunId, swordId) => {
      if (!this.meta.setLoadout(gunId, swordId)) return
      const gun = weaponById(gunId)
      const sword = weaponById(swordId)
      if (!gun || !sword || gun.kind !== 'gun' || sword.kind !== 'sword') return
      this.player.equip(gun)
      this.player.equip(sword)
      this.hud.closeLoadout()
      this.enterDungeon()
    }, () => this.closeLoadout())
  }

  private closeLoadout() {
    if (this.state !== 'loadout') return
    this.hud.closeLoadout()
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
        this.effects.shakeIsEnabled,
        this.input.keyBindings,
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

  /** 히트스톱 요청 — 겹치면 합산하지 않고 더 긴 지속시간으로 갱신한다. */
  private triggerHitstop(duration: number) {
    this.hitstopTimer = Math.max(this.hitstopTimer, duration)
  }

  private loop = () => {
    requestAnimationFrame(this.loop)
    const rawDt = Math.min(this.clock.getDelta(), 0.05)
    // 히트스톱 타이머는 실제 경과 시간으로 감소시킨다 — 늦춰진 dt로 감소시키면
    // 스스로를 거의 끝내지 못한다.
    if (this.hitstopTimer > 0) this.hitstopTimer = Math.max(0, this.hitstopTimer - rawDt)
    const dt = this.hitstopTimer > 0 ? rawDt * CONFIG.effects.hitstopScale : rawDt
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
    this.entrySafeTimer = Math.max(0, this.entrySafeTimer - dt)

    // ── 플레이어 ──
    // 상호작용 키 E와 충돌하지 않도록 액티브 스킬은 적이 살아 있는 전투 중에만 쓴다.
    // 방 정리 후, 상점/분수/문 앞에서는 E가 언제나 상호작용으로 동작한다.
    const activeSkillsEnabled = this.mode === 'dungeon' && this.enemies.some((enemy) => enemy.alive)
    const { bullets, slash, chargeSlash, ultimate, startedReload } = this.player.update(dt, this.input, this.aimGround, activeSkillsEnabled)
    this.room.clamp(this.player.pos, CONFIG.player.radius)

    for (const b of bullets) {
      this.projectiles.spawnBullet(b.pos, b.dir, this.player.stats.bulletSpeed, b.damage, b.crit, this.player.stats.pierce)
    }
    if (bullets.length > 0) {
      this.audio.gunshot()
      // More than one projectile (double shot / ultimate) needs a muzzle flash in each real firing direction.
      for (const bullet of bullets) this.effects.muzzleFlash(this.player.pos, Math.atan2(bullet.dir.x, bullet.dir.z))
    }
    if (startedReload) this.audio.reload()
    if (slash) {
      this.audio.slash()
      this.effects.slash(slash.pos, slash.angle, slash.arc, slash.range)
      this.resolveSlash(slash.pos, slash.angle, slash.arc, slash.range, slash.damage, slash.crit, slash.knockback)
    }
    if (chargeSlash) {
      this.audio.slash()
      this.effects.slash(chargeSlash.pos, chargeSlash.angle, chargeSlash.arc, chargeSlash.range)
      this.resolveSlash(chargeSlash.pos, chargeSlash.angle, chargeSlash.arc, chargeSlash.range, chargeSlash.damage, chargeSlash.crit, chargeSlash.knockback)
    }
    if (ultimate) {
      this.audio.slash()
      for (const slashPart of ultimate.slashes) {
        this.effects.slash(slashPart.pos, slashPart.angle, slashPart.arc, slashPart.range)
        this.resolveSlash(slashPart.pos, slashPart.angle, slashPart.arc, slashPart.range, slashPart.damage, slashPart.crit, slashPart.knockback)
      }
      this.effects.ultimateCross(this.player.pos)
      this.effects.playGroundFx('shockwave', this.player.pos.x, this.player.pos.z, ultimate.shockwaveRadius * 2)
      this.aoeDamage(this.player.pos.x, this.player.pos.z, ultimate.shockwaveRadius, ultimate.shockwaveDamage, COLORS.slash)
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
    if (this.spawnQueue.length > 0 && this.entrySafeTimer <= 0) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 0.14
        const kind = this.spawnQueue.shift()!
        const p = this.safeSpawnPoint()
        const plan = this.curPlan!
        const e = new Enemy(kind, p.x, p.z, plan.hpMul, plan.dmgMul, plan.speedMul, plan.kind === 'elite', plan.affix)
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
    this.hud.setActiveSkills(
      this.player.activeSkillCooldowns,
      activeSkillsEnabled && this.player.chargeReady,
      activeSkillsEnabled && this.player.doubleShotReady,
      activeSkillsEnabled && this.player.ultimateReady,
    )
    this.hud.setAmmo(this.player.ammo, this.player.magSize, this.player.reloading, this.player.reloadRatio, this.player.gun.name)
    this.hud.setStats(this.player.level, this.mode === 'town' ? 0 : this.run.depth, this.kills, this.run.gold)

    const damageEvent = this.player.consumeDamageEvent()
    if (damageEvent === 'ward') this.hud.banner_('수호막이 피해를 막았습니다!')
    else if (damageEvent === 'revive') this.hud.banner_('불굴 발동 — 체력 50%로 부활!')

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
      const actions = e.update(dt, this.player.pos)
      for (const action of actions) this.resolveEnemyAction(e, action)

      // 방 경계
      const beforeClampX = e.pos.x
      const beforeClampZ = e.pos.z
      this.room.clamp(e.pos, e.radius * 0.6)
      if (e.isBossCharging && (e.pos.x !== beforeClampX || e.pos.z !== beforeClampZ)) e.stopBossChargeAtWall()

      const dx = e.pos.x - this.player.pos.x
      const dz = e.pos.z - this.player.pos.z
      const d = Math.hypot(dx, dz)
      if (d < e.radius + CONFIG.player.radius && e.contactTimer <= 0) {
        if (this.player.takeDamage(e.contactDamage)) {
          e.contactTimer = CONFIG.enemy.contactCooldown
          this.audio.hurt()
          this.effects.burst(new THREE.Vector3(this.player.pos.x, 1, this.player.pos.z), 0xff4040, 6, 4)
          this.effects.shake(e.isBossCharging ? CONFIG.effects.shakeBossCharge : CONFIG.effects.shakePlayerHit)
        }
        if (e.isBossCharging) this.pushPlayerAway(e.pos.x, e.pos.z, e.radius + CONFIG.player.radius)
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

    this.separateEnemies()
  }

  private resolveEnemyAction(enemy: Enemy, action: EnemyAction) {
    if (action.type === 'shoot') {
      const origin = new THREE.Vector3(enemy.pos.x, 1.2, enemy.pos.z)
      this.projectiles.spawnEnemyBullet(origin, action.direction, 14, enemy.damage)
      return
    }

    if (action.type === 'bossGroundFx') {
      this.effects.playGroundFx(action.effect, action.position.x, action.position.z, action.radius * 2, action.duration)
      return
    }

    if (action.type === 'eliteRegenFx') {
      this.effects.playGroundFx('tealMagic', action.position.x, action.position.z, action.radius * 2, action.duration)
      return
    }

    this.effects.playGroundFx('shockwave', action.position.x, action.position.z, action.radius * 2, action.effectDuration)
    if (action.phaseEntry) this.hud.banner_('⚠ 보스 2페이즈 ⚠')

    const dx = this.player.pos.x - action.position.x
    const dz = this.player.pos.z - action.position.z
    const distance = Math.hypot(dx, dz)
    if (distance > action.radius + CONFIG.player.radius) return
    if (this.player.takeDamage(enemy.damage * action.damageMultiplier)) {
      this.audio.hurt()
      this.effects.burst(new THREE.Vector3(this.player.pos.x, 1, this.player.pos.z), 0xff4040, 6, 4)
      this.effects.shake(CONFIG.effects.shakeBossSlam)
    }
    this.pushPlayerAway(action.position.x, action.position.z, action.radius + CONFIG.player.radius)
  }

  /** 보스 돌진·슬램에 맞은 플레이어를 공격 중심의 바깥까지 밀어낸다. */
  private pushPlayerAway(fromX: number, fromZ: number, targetDistance: number) {
    const dx = this.player.pos.x - fromX
    const dz = this.player.pos.z - fromZ
    const distance = Math.hypot(dx, dz)
    const nx = distance > 0.001 ? dx / distance : 1
    const nz = distance > 0.001 ? dz / distance : 0
    const push = Math.max(0, targetDistance - distance)
    this.player.pos.x += nx * push
    this.player.pos.z += nz * push
    this.room.clamp(this.player.pos, CONFIG.player.radius)
  }

  /**
   * 적끼리 겹치지 않게 서로 밀어낸다.
   * 전부 플레이어를 향해 최단거리로 직진하므로, 같은 방향에서 온 무리는 좌표가
   * 수렴해 스프라이트가 한 덩어리로 포개져 보인다(몇 마리인지 분간이 안 된다).
   */
  private separateEnemies() {
    const es = this.enemies
    for (let i = 0; i < es.length; i++) {
      const a = es[i]
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j]
        // 히트박스보다 살짝 넉넉하게 — 스프라이트가 히트박스보다 넓다
        const min = (a.radius + b.radius) * 1.15
        const dx = b.pos.x - a.pos.x
        const dz = b.pos.z - a.pos.z
        const d2 = dx * dx + dz * dz
        if (d2 >= min * min) continue

        const d = Math.sqrt(d2)
        let nx: number
        let nz: number
        if (d < 0.001) {
          // 완전히 같은 좌표면 방향이 없으므로 임의 방향으로 흩는다
          const a2 = Math.random() * Math.PI * 2
          nx = Math.cos(a2)
          nz = Math.sin(a2)
        } else {
          nx = dx / d
          nz = dz / d
        }
        const push = (min - d) * 0.5

        // 보스는 밀리지 않는다 — 대신 상대를 두 배로 밀어낸다
        if (a.kind === 'boss') {
          b.pos.x += nx * push * 2
          b.pos.z += nz * push * 2
        } else if (b.kind === 'boss') {
          a.pos.x -= nx * push * 2
          a.pos.z -= nz * push * 2
        } else {
          a.pos.x -= nx * push
          a.pos.z -= nz * push
          b.pos.x += nx * push
          b.pos.z += nz * push
        }
      }
    }
    // 밀려난 결과가 방 밖으로 나가지 않게 다시 제한
    for (const e of es) this.room.clamp(e.pos, e.radius * 0.6)
  }

  /** 진입 위치와 출입구 주변은 비워, 방을 여는 순간의 불합리한 피격을 막는다. */
  private safeSpawnPoint() {
    const doors: Direction[] = ['north', 'east', 'south', 'west']
    for (let i = 0; i < 18; i++) {
      const p = this.room.randomPoint(5)
      const nearPlayer = Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z) < 7
      const nearDoor = doors.some((d) => {
        const door = this.room.doorPoint(d)
        return Math.hypot(p.x - door.x, p.z - door.z) < 5
      })
      if (!nearPlayer && !nearDoor) return p
    }
    return this.room.randomPoint(5)
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
          // 거리 보너스: 발사 지점(spawnPos, 불변) ~ 명중 지점(b.pos, 현재 위치)
          // 거리로 판정한다. 관통/산탄 각 발은 이 루프에서 개별 총알(b)로 이미
          // 분리돼 있어 명중마다 따로 계산된다.
          const rdx = b.pos.x - b.spawnPos.x
          const rdz = b.pos.z - b.spawnPos.z
          const rangeBonus = Math.hypot(rdx, rdz) >= CONFIG.combat.gunRangeBonusDist
          const dmg = rangeBonus ? b.damage * CONFIG.combat.gunRangeBonusMult : b.damage
          e.takeDamage(dmg, 'ranged', b.crit)
          b.hitSet.add(e.id)
          this.audio.hit()
          this.triggerHitstop(b.crit ? CONFIG.effects.hitstopCrit : CONFIG.effects.hitstopHit)
          this.effects.shake(b.crit ? CONFIG.effects.shakeCrit : CONFIG.effects.shakeGunHit)
          this.applyLifesteal(dmg)
          this.effects.hitImpact(e.pos.x, e.pos.z, b.crit ? 1.9 : 1.3)
          this.effects.damageNumber(new THREE.Vector3(e.pos.x, 1.6, e.pos.z), dmg, b.crit, rangeBonus)
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
          this.effects.shake(CONFIG.effects.shakePlayerHit)
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
    let hitAny = false
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
        hitAny = true
        const reflected = e.takeDamage(damage, 'melee', crit)
        e.knockback(pos.x, pos.z, knockback)
        this.audio.hit()
        this.triggerHitstop(crit ? CONFIG.effects.hitstopCrit : CONFIG.effects.hitstopHit)
        this.effects.shake(crit ? CONFIG.effects.shakeCrit : CONFIG.effects.shakeSwordHit)
        this.applyLifesteal(damage)
        this.effects.hitImpact(e.pos.x, e.pos.z, crit ? 2.0 : 1.4)
        this.effects.damageNumber(new THREE.Vector3(e.pos.x, 1.8, e.pos.z), damage, crit)
        if (reflected > 0 && this.player.takeDamage(reflected)) {
          this.audio.hurt()
          this.effects.hitImpact(this.player.pos.x, this.player.pos.z)
          this.effects.shake(CONFIG.effects.shakePlayerHit)
        }
      }
    }
    // 검 적중 시 총알 장전(기본 메커니즘) — 여러 적을 맞혀도 스윙당 1회만
    if (hitAny) this.player.reloadFromSwordHit()
  }

  private applyLifesteal(damage: number) {
    if (this.player.stats.lifesteal > 0) this.player.heal(damage * this.player.stats.lifesteal)
  }

  private killEnemy(e: Enemy) {
    this.triggerHitstop(e.kind === 'boss' ? CONFIG.effects.hitstopBossKill : CONFIG.effects.hitstopKill)
    this.effects.shake(CONFIG.effects.shakeKill)
    this.scene.remove(e.group)
    this.kills++
    const death = enemyDeathArt(e.kind)
    this.effects.deathDissolve(e.pos, death.map, death.scale)
    this.effects.playFx('death', e.pos.x, 1.0, e.pos.z, ENEMY_SCALE[e.kind] * 1.3)

    if (e.affix === 'split') {
      for (const child of e.createSplitChildren()) {
        this.enemies.push(child)
        this.scene.add(child.group)
      }
    }

    if (e.affix === 'volatile') {
      this.effects.playGroundFx('shockwave', e.pos.x, e.pos.z, ELITE_AFFIX.volatile.radius * 2)
      const distance = Math.hypot(this.player.pos.x - e.pos.x, this.player.pos.z - e.pos.z)
      if (distance <= ELITE_AFFIX.volatile.radius && this.player.takeDamage(e.damage * ELITE_AFFIX.volatile.damageMultiplier)) {
        this.audio.hurt()
        this.effects.burst(new THREE.Vector3(this.player.pos.x, 1, this.player.pos.z), 0xff4040, 6, 4)
        this.effects.shake(CONFIG.effects.shakePlayerHit)
      }
    }

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
    if (!this.player.canAcquireTrait(u.id, u.maxStacks)) {
      this.hud.banner_('이 특성은 최대 스택에 도달했습니다')
      return false
    }
    this.audio.pick()
    u.apply(this.player)
    this.player.recordTrait(u.id)
    const cur = this.acquired.get(u.id)
    if (cur) cur.count++
    else this.acquired.set(u.id, { upgrade: u, count: 1 })
    this.hud.setHp(this.player.hp, this.player.stats.maxHp)
    this.hud.setXp(this.player.xp, this.player.xpToNext)
    return true
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
    const choices = rollChoices(3, false, this.player.traitStacks)
    if (choices.length === 0) {
      while (this.player.gainXp(0)) {
        // 특성이 모두 소진된 뒤 남은 경험치는 선택창 없이 정상적으로 처리한다.
      }
      this.hud.setXp(this.player.xp, this.player.xpToNext)
      this.state = 'play'
      this.hud.banner_('모든 특성이 최대 스택에 도달했습니다')
      this.clock.getDelta()
      return
    }
    this.hud.showLevelUp('LEVEL UP!', '강화할 능력을 선택하세요', choices, (u) => {
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
