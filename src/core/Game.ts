import * as THREE from 'three'
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js'
import { CONFIG, COLORS } from '../config'
import { Input } from './Input'
import { Room, RoomVisualKind, DEFAULT_ROOM_SIZES } from '../systems/Room'
import { RunState, RoomPlan, RoomEnemy, ROOM_ICON, roomLabel, Direction, OPPOSITE } from '../systems/RunState'
import { Player } from '../entities/Player'
import { Enemy, EnemyAction } from '../entities/Enemy'
import { enemyDeathArt, ENEMY_SCALE } from '../entities/EnemySprite'
import { Interactable } from '../entities/Interactable'
import { Projectiles } from '../systems/Projectiles'
import { Pickups } from '../systems/Pickups'
import { Effects } from '../systems/Effects'
import { rollChoices, Upgrade, forgeSwapCandidates, upgradeById, CoreSlot } from '../systems/Upgrades'
import { Shop, ShopItem } from '../systems/Shop'
import { AudioManager } from '../systems/Audio'
import { ELITE_AFFIX } from '../systems/EliteAffixes'
import { MetaProgression } from '../systems/MetaProgression'
import { weaponById } from '../systems/Weapons'
import { preloadAssets } from '../rendering/assets'
import { noOutline } from '../rendering/toon'
import { DISPLAY, fitStage } from '../rendering/viewport'
import { HUD } from '../ui/HUD'

type State = 'start' | 'play' | 'levelup' | 'reward' | 'shop' | 'meta' | 'loadout' | 'clear' | 'gameover'
type Mode = 'town' | 'dungeon'

export class Game {
  private renderer: THREE.WebGLRenderer
  private outline!: OutlineEffect
  private scene: THREE.Scene
  private camera!: THREE.OrthographicCamera
  private viewSize = 14
  private stage: HTMLDivElement
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
  /** 던전 상점방 전용 재고. 방 id별로 하나씩 — 상점방과 보스 준비방(rest)을
   *  오가도 각 방의 재고·리롤 가격·판매 상태가 서로 독립으로 유지된다. */
  private shopRooms = new Map<string, Shop>()
  private mode: Mode = 'town'
  private state: State = 'start'
  private roomCleared = false
  /** 룸 입장 시 순차 스폰 대기열 */
  private spawnQueue: RoomEnemy[] = []
  private slowZones: { position: THREE.Vector3; radius: number; timer: number; multiplier: number; ring: THREE.Mesh }[] = []
  private spawnTimer = 0
  /** 방 입장 직후 스폰을 미루는 유예 시간 — 문 열자마자 맞는 것을 막는다 */
  private entrySafeTimer = 0
  private curPlan: RoomPlan | null = null

  private kills = 0
  private boss: Enemy | null = null
  /** 히트스톱 잔여 시간 — 겹치면 더하지 않고 더 긴 쪽으로 갱신(triggerHitstop) */
  private hitstopTimer = 0
  /** 재발동 최소 간격 남은 시간 — 이게 0보다 크면 triggerHitstop() 요청을
   * 무시한다(연속 명중이 히트스톱을 계속 채워 끊기지 않는 것을 막는다).
   * 히트스톱 스케일과 무관하게 실제 경과 시간(rawDt)으로 감소시킨다. */
  private hitstopCooldown = 0
  /**
   * 시뮬레이션 누적 시간(초) — 플레이어 기준 dt(rawDt, 히트스톱 영향을 받지
   * 않음)를 더한다(작업 지시 P6 커밋1 — 이전에는 히트스톱 스케일이 적용된
   * dt를 더해 QC 대기가 플레이어 체감 시간과 어긋났다). 모달이 열려 있거나
   * state !== 'play'이면 step()이 안 불려 이 값도 멈춘다 — QC가 "정지"와
   * "느림"을 구분하는 근거가 이 필드다. 리셋하지 않는다: 소비 측(QC)이 두
   * 샘플의 차이만 본다.
   */
  private simClock = 0
  private wasDashing = false
  /** '이도류'(slash) 두 번째 타격 대기열 — playerDt 누적으로 소진(step()에서 처리,
   * 히트스톱 영향 없음 — 작업 지시 P6 커밋1-1) */
  private pendingSlashes: { timer: number; arc: number; range: number; damage: number; crit: boolean; knockback: number }[] = []
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
    this.stage = document.createElement('div')
    this.stage.className = 'game-stage'
    container.appendChild(this.stage)

    // 1920×1080 고정 렌더러. 브라우저 적응은 .game-stage 전체 스케일로 처리한다.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.domElement.classList.add('pixelated')
    this.stage.appendChild(this.renderer.domElement)

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
    this.hud = new HUD(this.stage)
    this.effects = new Effects(this.scene, this.hud.floaterLayer)

    this.hud.onStart(() => this.startGame())
    this.hud.onRestart(() => this.startGame())
    this.hud.onStageClear(() => {
      if (this.run.isLastStage) this.enterTown()
      else this.advanceStage()
    })
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
    this.camera.left = -DISPLAY.aspect * this.viewSize
    this.camera.right = DISPLAY.aspect * this.viewSize
    this.camera.top = this.viewSize
    this.camera.bottom = -this.viewSize
    this.camera.updateProjectionMatrix()

    this.renderer.setSize(DISPLAY.width, DISPLAY.height, false)
    this.outline.setSize(DISPLAY.width, DISPLAY.height)

    const layout = fitStage(window.innerWidth, window.innerHeight)
    this.stage.style.transform = `translate3d(${layout.left}px, ${layout.top}px, 0) scale(${layout.scale})`
    this.stage.dataset.scale = String(layout.scale)
  }

  // ══════════════════ 게임 시작 / 씬 전환 ══════════════════

  private startGame() {
    this.settingsOpen = false
    this.hud.closeSettings()

    this.audio.init()
    this.audio.resume()
    this.audio.startMusic()

    this.enterTown()
  }

  /**
   * 런 범위 상태 초기화. 초기화 경계는 "마을 입장 시점"이지 던전 입장
   * 시점이 아니다 — 마을의 시작 특성 제단은 던전 입장 전에 쓰는 기능이라
   * 던전 입장 시점에 초기화하면 방금 고른 특성이 지워진다. 스테이지 2-7이
   * 마을을 거치지 않고 이어지는 향후 설계와도 이 경계가 맞는다.
   */
  private startRun() {
    this.kills = 0
    this.acquired.clear()
    this.startingTraitTaken = false
    this.traitForgeUsed = false
    this.wasDashing = false
    this.ghostTimer = 0
    this.shopRooms.clear()

    if (this.player) this.scene.remove(this.player.group)
    this.player = new Player(this.meta.bonuses())
    const loadout = this.meta.loadoutWeapons().selected
    const gun = weaponById(loadout.gunId)
    const sword = weaponById(loadout.swordId)
    if (gun?.kind === 'gun') this.player.equip(gun)
    if (sword?.kind === 'sword') this.player.equip(sword)
    this.scene.add(this.player.group)
  }

  /** 월드(적/픽업/투사체/오브젝트) 정리 */
  private clearWorld() {
    this.enemies.forEach((e) => this.scene.remove(e.group))
    this.enemies = []
    this.spawnQueue = []
    this.slowZones.forEach((z) => {
      this.scene.remove(z.ring)
      z.ring.geometry.dispose()
    })
    this.slowZones = []
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
    this.room = new Room(this.scene, DEFAULT_ROOM_SIZES.town, 'town')
    this.mode = 'town'
    this.state = 'play'
    this.roomCleared = true
    this.curPlan = null
    this.run.reset()
    this.startRun()

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

  /**
   * 이어가기 런 — 챕터(7스테이지) 완주 전까지는 마을을 거치지 않고 다음
   * 스테이지 첫 방으로 바로 넘어간다(작업 지시
   * P2_prompt_stage_data_and_continuous_run_1 커밋4). 레벨/경험치/특성/
   * 골드/장비/스킬 쿨다운은 그대로 유지된다 — startRun()(플레이어 재생성)은
   * 호출하지 않는다, 그건 "마을 입장" 시점 전용 규칙이라 여기서 건드리지
   * 않는다. 방 맵/깊이/상점 재고/분수·제련소 사용 이력만 새로 시작한다.
   */
  private advanceStage() {
    this.shopRooms.clear()
    this.run.advanceStage()
    const plan = this.run.enterFirst()
    this.loadRoom(plan)
    this.player.heal(this.player.stats.maxHp * 0.3)
    this.audio.waveStart()
  }

  /** 방 하나 구성 */
  private loadRoom(plan: RoomPlan, enteredFrom: Direction = 'south') {
    this.clearWorld()
    this.room?.dispose()
    const visual: RoomVisualKind = plan.kind === 'boss' ? 'boss' : 'dungeon'
    // 'elite'는 스테이지 정의에 크기가 없다 — 기존에도 SIZES['elite'] 미존재로
    // SIZES.combat 폴백이었던 것과 동일하게 'combat' 크기를 쓴다.
    const sizeKey = plan.kind === 'elite' ? 'combat' : plan.kind
    const size = this.run.cfg.roomSize[sizeKey as keyof typeof this.run.cfg.roomSize] ?? DEFAULT_ROOM_SIZES[sizeKey] ?? DEFAULT_ROOM_SIZES.combat
    this.room = new Room(this.scene, size, visual, this.run.cfg.art)
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
      if (!this.shopRooms.has(plan.id)) {
        this.shopRooms.set(plan.id, new Shop([this.player.gun.id, this.player.sword.id], this.player.traitStacks, this.player.coreSlots))
      }
      this.interactables.push(new Interactable('merchant', -6, -1, plan.kind === 'rest' ? '보스전 상점' : '상인과 거래').addTo(this.scene))
      this.interactables.push(new Interactable('dungeonForge', 0, 4, this.dungeonForgeLabel()).addTo(this.scene))
    }

    // 회복 분수 — RunState.generateMap()이 맵 생성 시점에 hasFountain을 정해
    // 재방문해도 나타났다 사라지지 않는다(상점방 1개 + 전투방 일부, DESIGN_LOG
    // B5 "분수 사문화" 해결).
    if (plan.hasFountain) {
      const p = plan.kind === 'shop' || plan.kind === 'rest' ? { x: 6, z: -1 } : this.room.randomPoint(5)
      this.interactables.push(new Interactable('fountain', p.x, p.z, plan.kind === 'rest' ? `보스전 회복 우물 · ${this.fountainLabel()}` : this.fountainLabel()).addTo(this.scene))
    }

    // 플레이어 진입 위치
    const e = this.room.entryPoint(enteredFrom)
    this.player.pos.set(e.x, 0, e.z)

    // 배너 / 진행 표시
    this.hud.setMinimap(this.run.minimap())
    if (plan.kind === 'boss') {
      this.audio.bossWarn()
      this.hud.banner_('⚠ 보스 ⚠')
    } else if (plan.kind === 'rest') {
      this.hud.banner_('보스 준비 장소 · 회복 우물과 상점')
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
    // "보스 보상은 3장이 아니라 4장"(작업 지시) — 이 저장소에는 보스 처치 시
    // 특성을 고르는 흐름이 없고(스테이지 클리어는 onStageClear로 별도 처리),
    // 특성 선택을 동반하는 유일한 고급 보상이 엘리트방 클리어라 여기에 적용했다.
    // 문자 그대로 "보스" 보상이 아니므로 최종 보고에서 별도로 짚는다.
    const choices = rollChoices(4, this.player.traitStacks, this.player.coreSlots)
    if (choices.length === 0) {
      this.state = 'play'
      this.hud.banner_(`골드 +${gold} · 모험가 증표 +1 · 획득 가능한 특성이 없습니다`)
      this.openDoors()
      this.clock.getDelta()
      return
    }
    this.hud.showLevelUp('ELITE CLEAR!', `고급 특성을 선택하세요 · 골드 +${gold}`, choices, (u) => {
      this.offerTrait(u, () => {
        this.audio.pick()
        this.state = 'play'
        this.hud.banner_('엘리트 보상 획득!')
        this.openDoors()
        this.clock.getDelta()
      })
    })
  }

  private onStageClear() {
    this.state = 'clear'
    this.audio.levelup()
    const reward = this.meta.grantStageClear(this.run.cfg.reward)
    this.hud.showStageClear(this.run.stage, this.kills, this.run.gold, this.player.level, this.run.isLastStage, reward)
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
    const choices = rollChoices(3, this.player.traitStacks, this.player.coreSlots)
    if (choices.length === 0) {
      this.startingTraitTaken = true
      altar.markUsed()
      this.state = 'play'
      this.hud.banner_('획득 가능한 특성이 없습니다')
      this.clock.getDelta()
      return
    }
    this.hud.showLevelUp('첫 번째 특성', '이번 런을 이끌 특성 하나를 선택하세요', choices, (u) => {
      this.offerTrait(u, () => {
        this.startingTraitTaken = true
        altar.markUsed()
        this.state = 'play'
        this.hud.banner_(`${u.name} 선택!`)
        this.clock.getDelta()
      })
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
      .filter((u) => this.player.canAcquireTrait(u))
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
      .filter((u) => forgeSwapCandidates(u.id, this.player.traitStacks, this.player.coreSlots).length > 0)
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
    this.hud.showLevelUp('제련소 — 교체할 특성', `${price} 골드 — 같은 슬롯의 다른 특성으로 교체합니다`, choices, (from) => {
      const candidates = forgeSwapCandidates(from.id, this.player.traitStacks, this.player.coreSlots).sort(() => Math.random() - 0.5).slice(0, 3)
      this.hud.showLevelUp('제련소 — 무엇으로 교체할까요?', `${from.name} 을(를) 교체`, candidates, (to) => {
        if (!this.run.spendGold(price)) {
          this.state = 'play'
          return
        }
        // 각인은 스택 장부만 옮긴다(교체해도 힘이 줄지 않는다). 핵심 슬롯은
        // 애초에 슬롯당 1개뿐이라 setCoreSlot이 덮어쓰는 것 자체가 교체다.
        if (from.slot === 'sigil') {
          const stack = Math.max(0, this.player.traitStacks.get(from.id) ?? 0)
          this.player.traitStacks.set(from.id, stack > 0 ? stack - 1 : 0)
        }
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
      const choices = rollChoices(3, this.player.traitStacks, this.player.coreSlots)
      if (choices.length === 0) {
        this.state = 'play'
        this.hud.banner_('획득 가능한 특성이 없습니다')
        this.clock.getDelta()
        return
      }
      this.hud.showLevelUp('보물 발견!', '특성 하나를 선택하세요', choices, (u) => {
        this.offerTrait(u, () => {})
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
    const roomId = this.curPlan?.id
    if (roomId && !this.shopRooms.has(roomId)) {
      this.shopRooms.set(roomId, new Shop([this.player.gun.id, this.player.sword.id], this.player.traitStacks, this.player.coreSlots))
    }
    this.state = 'shop'
    this.input.clearAll()
    this.renderShop()
  }

  private activeShop() {
    const roomId = this.curPlan?.id
    return roomId ? this.shopRooms.get(roomId) ?? null : null
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
        badgeClass: it.def.rarity as string,
        price: it.price,
        sold: it.sold,
        tag: it.def.kind === 'gun' ? '총' : '검',
      }
    }
    if (it.type === 'trait') {
      // 특성 등급(rarity) 축은 슬롯제 도입 때 이미 폐기됐다 — 슬롯으로 표기한다.
      return {
        icon: it.def.icon,
        name: it.def.name,
        desc: it.def.desc,
        badgeClass: `slot-${it.def.slot}`,
        price: it.price,
        sold: it.sold,
        tag: '특성',
      }
    }
    return {
      icon: '❤️',
      name: '치유 물약',
      desc: `체력 ${it.amount} 회복`,
      badgeClass: 'common',
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
    if (it.type === 'trait' && !this.player.canAcquireTrait(it.def)) {
      this.hud.banner_(it.def.slot === 'sigil' ? '이 특성은 최대 스택에 도달했습니다' : '이미 보유한 특성입니다')
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
    shop.reroll([this.player.gun.id, this.player.sword.id], this.player.traitStacks, this.player.coreSlots)
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

  /** 히트스톱 요청 — 재발동 최소 간격 안이면 무시하고, 지속시간은 누적
   * 상한을 넘지 않는다(작업 지시 P6 커밋1). */
  private triggerHitstop(duration: number) {
    if (this.hitstopCooldown > 0) return
    this.hitstopTimer = Math.min(CONFIG.effects.hitstopMaxDuration, Math.max(this.hitstopTimer, duration))
    this.hitstopCooldown = CONFIG.effects.hitstopRetriggerInterval
  }

  private loop = () => {
    requestAnimationFrame(this.loop)
    const rawDt = Math.min(this.clock.getDelta(), 0.05)
    // 히트스톱 타이머는 실제 경과 시간으로 감소시킨다 — 늦춰진 dt로 감소시키면
    // 스스로를 거의 끝내지 못한다.
    if (this.hitstopTimer > 0) this.hitstopTimer = Math.max(0, this.hitstopTimer - rawDt)
    if (this.hitstopCooldown > 0) this.hitstopCooldown = Math.max(0, this.hitstopCooldown - rawDt)
    // 히트스톱은 "세계"만 늦춘다 — 플레이어는 항상 rawDt(정상 속도)로 갱신한다
    // (작업 지시 P6 커밋1-1: 이동·조준·대시·쿨타임이 같이 느려지던 문제).
    const worldDt = this.hitstopTimer > 0 ? rawDt * CONFIG.effects.hitstopScale : rawDt
    this.input.update()

    const running = this.state === 'play' && !this.settingsOpen
    if (running) this.step(rawDt, worldDt)

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

    this.effects.update(running ? worldDt : 0, this.camera)

    this.outline.render(this.scene, this.camera)
  }

  /**
   * playerDt(rawDt, 히트스톱 무관)는 플레이어 입력·이동·대시·쿨타임에만 쓴다.
   * worldDt(히트스톱이 적용될 수 있음)는 적·적 투사체·이펙트·바닥 장판 등
   * "세계" 쪽 갱신에 쓴다(작업 지시 P6 커밋1-1).
   */
  private step(playerDt: number, worldDt: number) {
    this.simClock += playerDt
    this.updateAim()
    this.entrySafeTimer = Math.max(0, this.entrySafeTimer - worldDt)

    // ── 플레이어 ──
    const { bullets, slash, startedReload, reloadTriggerAttempt } = this.player.update(playerDt, this.input, this.aimGround)
    this.room.clamp(this.player.pos, CONFIG.player.radius)

    for (const b of bullets) {
      this.projectiles.spawnBullet(b.pos, b.dir, this.player.stats.bulletSpeed, b.damage, b.crit, this.player.stats.pierce)
    }
    if (bullets.length > 0) {
      this.audio.gunshot(this.player.gun.id)
      for (const bullet of bullets) this.effects.muzzleFlash(this.player.pos, Math.atan2(bullet.dir.x, bullet.dir.z))
    }
    if (startedReload) this.audio.reload(this.player.gun.id)
    if (reloadTriggerAttempt) this.audio.reloadTriggerAttempt()
    if (slash) {
      this.audio.slash(this.player.sword.id)
      this.effects.slash(slash.pos, slash.angle, slash.arc, slash.range)
      if (this.player.coreSlots.get('slash') === 'dualblade') {
        // '이도류' — 2연타, 각 타 60%(합계 120%). 첫 타는 즉시, 두 번째 타는
        // 0.12초 뒤 그 시점의 플레이어 위치/각도로 다시 판정한다(대기열 방식,
        // Game.step()에서 playerDt 누적으로 소진 — 히트스톱 영향 없음).
        const hitDmg = slash.damage * CONFIG.traits.dualbladeHitMult
        this.resolveSlash(slash.pos, slash.angle, slash.arc, slash.range, hitDmg, slash.crit, slash.knockback)
        this.pendingSlashes.push({
          timer: CONFIG.traits.dualbladeDelaySec,
          arc: slash.arc,
          range: slash.range,
          damage: hitDmg,
          crit: slash.crit,
          knockback: slash.knockback,
        })
      } else {
        this.resolveSlash(slash.pos, slash.angle, slash.arc, slash.range, slash.damage, slash.crit, slash.knockback)
        if (this.player.coreSlots.get('slash') === 'parry') {
          this.resolveDeflect(slash.pos, slash.angle, slash.arc, slash.range, slash.damage)
        }
      }
    }
    // '이도류' 두 번째 타격 대기열 — 플레이어 자신의 공격 후속 타이밍이라
    // playerDt로 소진한다(히트스톱에 영향받지 않음 — 작업 지시 P6 커밋1-1).
    for (let i = this.pendingSlashes.length - 1; i >= 0; i--) {
      const q = this.pendingSlashes[i]
      q.timer -= playerDt
      if (q.timer <= 0) {
        this.pendingSlashes.splice(i, 1)
        const pos = this.player.pos.clone()
        const angle = this.player.angle
        this.audio.slash(this.player.sword.id)
        this.effects.slash(pos, angle, q.arc, q.range)
        this.resolveSlash(pos, angle, q.arc, q.range, q.damage, q.crit, q.knockback, { halfFx: true })
      }
    }
    // 대시 잔상
    if (this.player.isDashing) {
      this.ghostTimer -= playerDt
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
    if (!this.player.isDashing && this.wasDashing) {
      this.player.onDashEnd() // '급전환' — 대시 종료 직후 검 쿨 절반 + 총 즉시 장전
      if (this.player.coreSlots.get('dash') === 'mark') this.resolveDashMark(this.player.dashStart, this.player.pos)
    }
    this.wasDashing = this.player.isDashing

    // 조건부 핵심 슬롯 특성 발동 게이지(발도참/조준사격/역행) — 특성이 없으면
    // null이라 아무것도 표시되지 않는다.
    const gauge = this.player.conditionGauge()
    if (gauge) this.effects.requestGauge(this.player.pos.x, this.player.pos.z, gauge.progress, gauge.color, gauge.decreasing)

    // ── 룸 적 스폰 ──
    if (this.spawnQueue.length > 0 && this.entrySafeTimer <= 0) {
      this.spawnTimer -= worldDt
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 0.14
        const spawn = this.spawnQueue.shift()!
        const p = this.safeSpawnPoint()
        const plan = this.curPlan!
        const e = new Enemy(spawn.kind, spawn.artSet, p.x, p.z, plan.hpMul, plan.dmgMul, plan.speedMul, plan.xpMul, plan.kind === 'elite', plan.affix, this.run.stage)
        this.enemies.push(e)
        this.scene.add(e.group)
        this.effects.burst(new THREE.Vector3(p.x, 1, p.z), 0x8a4a6a, 8, 5)
        if (spawn.kind === 'boss') {
          this.boss = e
          this.hud.showBoss(true)
        }
      }
    }

    // ── 적 / 투사체 / 픽업 ──
    this.assignSurroundSlots()
    this.updateEnemies(worldDt)
    // 플레이어 총알은 playerDt(항상 정상 속도), 적 총알은 worldDt(히트스톱
    // 대상)로 각각 갱신한다 — 작업 지시 P6 커밋1-1/1-3.
    this.projectiles.update(playerDt, worldDt, this.room.bounds, this.player.pos)
    this.updateSlowZones(worldDt)
    this.resolveBullets()
    this.resolveEnemyBullets()

    const got = this.pickups.update(worldDt, this.player.pos, this.player.stats.magnetRange, CONFIG.xp.orbSpeed)
    if (got.xp > 0) this.gainXp(got.xp * this.player.stats.xpGain)
    if (got.gold > 0) this.run.addGold(got.gold)

    // ── 방 장식 / 상호작용 오브젝트 ──
    this.room.update(worldDt)
    for (const o of this.interactables) o.update(worldDt)
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
    this.hud.setAmmo(
      this.player.ammo,
      this.player.magSize,
      this.player.reloading,
      this.player.reloadRatio,
      this.player.gun.name,
      this.player.coreSlots.get('shot') === 'last_bullet',
    )
    this.hud.setStats(this.player.level, this.mode === 'town' ? 0 : this.run.depth, this.kills, this.run.gold)

    const damageEvent = this.player.consumeDamageEvent()
    if (damageEvent === 'ward') this.hud.banner_('수호막이 피해를 막았습니다!')
    else if (damageEvent === 'revive') this.hud.banner_('불굴 발동 — 체력 50%로 부활!')
    else if (damageEvent === 'dashBlock' && this.player.coreSlots.get('dash') === 'afterimage' && this.player.tryRefreshDashOnBlock()) {
      // '잔영' — 대시 무적으로 흘렸을 때만(피격 후 무적은 dashBlock을 만들지 않는다),
      // 대시 1회당 최대 1회(tryRefreshDashOnBlock 자체가 가드). 적 탄환 피격
      // (resolveEnemyBullets)과 근접 접촉 피해(위 contactDamage 블록) 모두
      // Player.takeDamage()를 거치므로 이 한 지점에서 양쪽 다 처리된다.
      this.audio.dashRefresh()
      this.effects.burst(new THREE.Vector3(this.player.pos.x, 1.2, this.player.pos.z), COLORS.slash, 10, 6)
      this.hud.banner_('잔영 — 대시 재충전!')
    }

    if (!this.player.alive) this.gameOver()
  }

  /** 광역 피해 — 섬광강타(dashStrike)/폭심(explodeOnKill)이 이 한 지점을 거친다. */
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

  /**
   * 원거리 적(shooter/fireMage/iceMage/summoner/voidMage — boss 제외)에게
   * 플레이어를 중심으로 균등한 각도 슬롯을 배정한다(작업 지시 P6 커밋1-2).
   * 매 프레임 살아있는 대상만 다시 나열해 인덱스를 매기므로, 죽거나 새로
   * 스폰될 때 자동으로 "재배정"된다 — 별도의 스폰/사망 이벤트 훅이 필요
   * 없다. id 순으로 안정 정렬해 프레임마다 순서가 흔들리지 않게 한다.
   */
  private assignSurroundSlots() {
    const ranged = this.enemies.filter((e) => e.alive && e.wantsSurroundSlot).sort((a, b) => a.id - b.id)
    const n = ranged.length
    for (let i = 0; i < n; i++) ranged[i].surroundAngle = (i / n) * Math.PI * 2
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
          this.effects.shake(e.isCharging ? CONFIG.effects.shakeBossCharge : CONFIG.effects.shakePlayerHit)
        }
        if (e.isCharging) this.pushPlayerAway(e.pos.x, e.pos.z, e.radius + CONFIG.player.radius)
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
      this.projectiles.spawnEnemyBullet(origin, action.direction, action.speed ?? 14, enemy.damage, action.style, action.homing, action.slowDuration)
      return
    }

    if (action.type === 'summon') {
      const plan = this.curPlan
      if (!plan) return
      for (let i = 0; i < action.count; i++) {
        const angle = (i / action.count) * Math.PI * 2
        const child = new Enemy(
          action.kind,
          action.artSet,
          enemy.pos.x + Math.cos(angle) * 2,
          enemy.pos.z + Math.sin(angle) * 2,
          plan.hpMul,
          plan.dmgMul,
          plan.speedMul,
          plan.xpMul,
          false,
          undefined,
          this.run.stage,
        )
        this.room.clamp(child.pos, child.radius)
        this.enemies.push(child)
        this.scene.add(child.group)
      }
      this.effects.playGroundFx('tealMagic', enemy.pos.x, enemy.pos.z, 4, 0.65)
      return
    }

    if (action.type === 'areaStrike') {
      this.effects.playGroundFx(action.style === 'fire' ? 'shockwave' : 'tealMagic', action.position.x, action.position.z, action.radius * 2, 0.7)
      const distance = Math.hypot(this.player.pos.x - action.position.x, this.player.pos.z - action.position.z)
      if (distance <= action.radius + CONFIG.player.radius && this.player.takeDamage(enemy.damage * action.damageMultiplier)) {
        this.audio.hurt()
        this.effects.shake(CONFIG.effects.shakeBossSlam)
      }
      if (action.slowZoneDuration && action.slowMultiplier) {
        this.spawnSlowZone(action.position, action.radius, action.slowZoneDuration, action.slowMultiplier)
      }
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

  /**
   * 효과 영역(이동속도 감소) 하나를 등록한다 — 생성 주체(적 사망/지형/보스
   * 패턴)와 무관하게 이 메서드만 호출하면 된다(작업 지시 P6 커밋1-4, "slowZones
   * 를 범용 효과 영역으로 일반화"). 상시 경계 표시로 링 메시를 지속시간 동안
   * 그대로 띄운다 — 기존엔 0.65초마다 이펙트를 재생하는 점멸 방식이라
   * 경계가 흐릿했다.
   */
  private spawnSlowZone(position: THREE.Vector3, radius: number, duration: number, multiplier: number) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.18, radius, 40),
      noOutline(new THREE.MeshBasicMaterial({ color: 0x78d8ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.set(position.x, 0.04, position.z)
    this.scene.add(ring)
    this.slowZones.push({ position: position.clone(), radius, timer: duration, multiplier, ring })
  }

  /**
   * 효과 영역은 플레이어뿐 아니라 적에게도 적용한다 — 적도 느려지면 장판으로
   * 유인하는 전술이 생긴다(승인된 설계 결정, 작업 지시 P6 커밋1-4). 중첩 규칙:
   * 여러 존이 겹쳐도 배율을 곱해 누적하지 않는다 — Enemy/Player.applyMovementSlow()
   * 가 Math.min()으로 "가장 강한(배율이 작은) 감속 하나만" 유지한다. 장판을
   * 여러 겹 깔아도 무한히 느려지지 않게 하려는 의도적 규칙이다.
   */
  private updateSlowZones(dt: number) {
    for (let i = this.slowZones.length - 1; i >= 0; i--) {
      const zone = this.slowZones[i]
      zone.timer -= dt
      if (zone.timer <= 0) {
        this.scene.remove(zone.ring)
        zone.ring.geometry.dispose()
        this.slowZones.splice(i, 1)
        continue
      }
      const playerDist = Math.hypot(this.player.pos.x - zone.position.x, this.player.pos.z - zone.position.z)
      if (playerDist <= zone.radius + CONFIG.player.radius) this.player.applyMovementSlow(zone.multiplier, 0.2)
      for (const e of this.enemies) {
        if (!e.alive) continue
        const enemyDist = Math.hypot(e.pos.x - zone.position.x, e.pos.z - zone.position.z)
        if (enemyDist <= zone.radius + e.radius) e.applyMovementSlow(zone.multiplier, 0.2)
      }
    }
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
          const travelDist = Math.hypot(rdx, rdz)
          const rangeBonus = travelDist >= CONFIG.combat.gunRangeBonusDist
          // '밀착사격'(shot) — 먼 거리 보너스와 정반대 축이라 동시에 성립할 수 없다
          // (gunRangeBonusDist 8 ≫ closeRangeDist 3).
          const closeRange = this.player.coreSlots.get('shot') === 'close_range' && travelDist <= CONFIG.traits.closeRangeDist
          const dmg = rangeBonus ? b.damage * CONFIG.combat.gunRangeBonusMult : closeRange ? b.damage * CONFIG.traits.closeRangeMult : b.damage
          e.takeDamage(dmg, 'ranged', b.crit)
          b.hitSet.add(e.id)
          this.audio.hit()
          this.triggerHitstop(b.crit ? CONFIG.effects.hitstopCrit : CONFIG.effects.hitstopHit)
          this.effects.shake(b.crit ? CONFIG.effects.shakeCrit : CONFIG.effects.shakeGunHit)
          this.applyLifesteal(dmg)
          this.effects.hitImpact(e.pos.x, e.pos.z, b.crit ? 1.9 : 1.3)
          this.effects.damageNumber(new THREE.Vector3(e.pos.x, 1.6, e.pos.z), dmg, b.crit, rangeBonus)
          if (b.hitSet.size > b.pierce) {
            // '도탄'(shot) — 관통 소진으로 소멸하는 시점이 기준이라 무기 고유
            // 관통과 자연스럽게 합쳐진다(관통 3인 무기는 3명 뚫은 뒤 튕긴다).
            // 탄환당 1회만, 아직 안 맞은 적 중 가장 가까운 쪽으로 튕긴다.
            // hitSet은 그대로 유지 — 같은 적을 다시 맞히지 않는다.
            if (this.player.coreSlots.get('shot') === 'ricochet' && !b.ricocheted) {
              const target = this.nearestUnhitEnemy(b.pos, CONFIG.traits.ricochetRadius, b.hitSet)
              if (target) {
                b.ricocheted = true
                b.dir.set(target.pos.x - b.pos.x, 0, target.pos.z - b.pos.z).normalize()
                b.spawnPos.copy(b.pos) // 다음 구간의 사거리 보너스는 튕긴 지점부터 새로 잰다
                this.effects.burst(b.pos.clone(), COLORS.slash, 6, 4) // 튕기는 궤적 — 전용 이펙트
                break // consumed=false 유지 — 이번 프레임엔 더 판정하지 않고 다음 프레임부터 새 방향으로 날아간다
              }
            }
            consumed = true
            break
          }
        }
      }
      if (consumed) this.projectiles.removeBullet(i)
    }
  }

  /** '도탄'(shot) 대상 탐색 — 반경 안, 아직 이 탄환에 안 맞은 적 중 가장 가까운 하나. */
  private nearestUnhitEnemy(pos: THREE.Vector3, radius: number, hitSet: ReadonlySet<number>): Enemy | null {
    let best: Enemy | null = null
    let bestDist = radius
    for (const e of this.enemies) {
      if (!e.alive || hitSet.has(e.id)) continue
      const dist = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z)
      if (dist <= bestDist) {
        best = e
        bestDist = dist
      }
    }
    return best
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
        if (b.slowDuration > 0) this.player.applyMovementSlow(CONFIG.enemy.stagePatterns.frostSuicide.slowMultiplier, b.slowDuration)
        this.projectiles.removeEnemyBullet(i)
      }
    }
  }

  /**
   * 베기 부채꼴(pos/angle/arc/range) 판정 — 검 스윙(resolveSlash)과 흘리기의
   * 적 탄환 판정이 이 함수를 공유한다(작업 지시 slot_traits_midcost_v2 커밋2:
   * "중복 구현을 만들지 마라"). extraRadius는 대상별 판정 반경 가산치
   * (적은 자기 radius, 적 탄환은 스프라이트가 작아 고정 소반경을 쓴다).
   */
  private inArc<T extends { pos: THREE.Vector3 }>(
    items: T[],
    pos: THREE.Vector3,
    angle: number,
    arc: number,
    range: number,
    extraRadius: (item: T) => number,
  ): T[] {
    const hits: T[] = []
    for (const item of items) {
      const dx = item.pos.x - pos.x
      const dz = item.pos.z - pos.z
      const dist = Math.hypot(dx, dz)
      if (dist > range + extraRadius(item)) continue
      const toAng = Math.atan2(dx, dz)
      let diff = Math.abs(toAng - angle)
      if (diff > Math.PI) diff = Math.PI * 2 - diff
      if (diff <= arc / 2 + 0.15) hits.push(item)
    }
    return hits
  }

  private enemiesInArc(pos: THREE.Vector3, angle: number, arc: number, range: number): Enemy[] {
    return this.inArc(this.enemies.filter((e) => e.alive), pos, angle, arc, range, (e) => e.radius)
  }

  /**
   * '흘리기'(slash) — 베기 부채꼴 안 적 탄환을 소멸시키고 플레이어 탄환으로
   * 반사한다(피해는 검 피해의 배율, 방향은 원래 진행 방향의 반대). 근접 적
   * (imp/brute)은 접촉 피해라 흘릴 대상이 없다 — 슈터·보스 전용은 의도된
   * 제약이라 보정하지 않는다(작업 지시).
   */
  private resolveDeflect(pos: THREE.Vector3, angle: number, arc: number, range: number, swordDamage: number) {
    // 적 탄환은 별도 radius 필드가 없다 — resolveEnemyBullets()의 플레이어
    // 충돌 판정(0.9 고정)과 달리 스프라이트가 작아 더 작은 고정치를 쓴다.
    const DEFLECT_BULLET_RADIUS = 0.3
    const bs = this.projectiles.enemyBullets
    const hitBullets = this.inArc(bs, pos, angle, arc, range, () => DEFLECT_BULLET_RADIUS)
    if (hitBullets.length === 0) return
    for (const b of hitBullets) {
      const idx = bs.indexOf(b)
      if (idx === -1) continue
      const reflectDir = b.dir.clone().negate()
      this.projectiles.spawnBullet(b.pos.clone(), reflectDir, this.player.stats.bulletSpeed, swordDamage * CONFIG.traits.deflectDamageMult, false, this.player.stats.pierce)
      this.projectiles.removeEnemyBullet(idx)
    }
    // 실제로 흘렸을 때만(탄환이 있었을 때만) 전용 피드백 — 성공 여부가 바로 느껴져야 한다.
    this.audio.parry()
    this.effects.burst(new THREE.Vector3(pos.x, 1.4, pos.z), COLORS.slash, 10, 7)
  }

  /**
   * 2패스 판정 — 1패스로 부채꼴 안 적을 모두 수집한 뒤(피해 계산 전), 2패스에서
   * 배수를 확정해 적용한다. '일섬'이 "몇 명을 맞혔는가"를 피해 적용 전에 알아야
   * 해서 나눴다(작업 지시 slot_traits_midcost_v2 커밋1). 기존 동작(부채꼴 내
   * 전원 풀 데미지, 스윙당 검 장전 1회)은 그대로다 — 명중 수와 무관하게
   * 전원이 맞고, 일섬 조건이 아니면 배수는 항상 1.0이다.
   *
   * opts.halfFx: 이도류 두 번째 타격 — 히트스톱/화면 흔들림을 절반으로 줄인다.
   */
  private resolveSlash(
    pos: THREE.Vector3,
    angle: number,
    arc: number,
    range: number,
    damage: number,
    crit: boolean,
    knockback: number,
    opts: { halfFx?: boolean } = {},
  ) {
    // 1패스 — 판정만, 피해 계산/적용 없음
    const hits = this.enemiesInArc(pos, angle, arc, range)

    // '일섬(一閃)' — 정확히 1명 명중 시에만 배수, 2명 이상이면 절반이라도 주는
    // 완충 없이 1.0배(작업 지시: "교환이 흐려진다" — 의도된 전부-아니면-없음).
    const ilseomActive = this.player.coreSlots.get('slash') === 'ilseom' && hits.length === 1
    const finalDamage = ilseomActive ? damage * CONFIG.traits.ilseomMult : damage
    const fxScale = opts.halfFx ? CONFIG.traits.dualbladeSecondHitFxScale : 1

    // 2패스 — 확정된 배수로 피해/넉백/이펙트 적용
    let hitAny = false
    for (const e of hits) {
      hitAny = true
      const reflected = e.takeDamage(finalDamage, 'melee', crit)
      e.knockback(pos.x, pos.z, knockback)
      this.audio.hit(true)
      this.triggerHitstop((crit ? CONFIG.effects.hitstopCrit : CONFIG.effects.hitstopHit) * fxScale)
      this.effects.shake((crit ? CONFIG.effects.shakeCrit : CONFIG.effects.shakeSwordHit) * fxScale)
      this.applyLifesteal(finalDamage)
      this.effects.hitImpact(e.pos.x, e.pos.z, crit ? 2.0 : 1.4)
      this.effects.damageNumber(new THREE.Vector3(e.pos.x, 1.8, e.pos.z), finalDamage, crit, false, ilseomActive)
      if (reflected > 0 && this.player.takeDamage(reflected)) {
        this.audio.hurt()
        this.effects.hitImpact(this.player.pos.x, this.player.pos.z)
        this.effects.shake(CONFIG.effects.shakePlayerHit)
      }
    }
    // 검 적중 시 총알 장전(기본 메커니즘) — 여러 적을 맞혀도 스윙당 1회만
    if (hitAny) this.player.reloadFromSwordHit()
    return hits.length
  }

  /** '표식'(dash) — 대시 시작~끝 선분으로 관통한 적을 표식한다(피해는 주지
   * 않는다). 표식된 적은 markDuration초 동안 받는 피해가 늘어난다
   * (Enemy.takeDamage에서 처리). */
  private resolveDashMark(start: THREE.Vector3, end: THREE.Vector3) {
    const abx = end.x - start.x
    const abz = end.z - start.z
    const lenSq = abx * abx + abz * abz
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue
      const apx = enemy.pos.x - start.x
      const apz = enemy.pos.z - start.z
      const t = lenSq > 0.0001 ? Math.max(0, Math.min(1, (apx * abx + apz * abz) / lenSq)) : 0
      const closestX = start.x + abx * t
      const closestZ = start.z + abz * t
      const distance = Math.hypot(enemy.pos.x - closestX, enemy.pos.z - closestZ)
      if (distance > enemy.radius + CONFIG.player.radius) continue
      enemy.mark(CONFIG.traits.markDuration)
    }
  }

  private applyLifesteal(damage: number) {
    if (this.player.stats.lifesteal > 0) this.player.heal(damage * this.player.stats.lifesteal)
  }

  private killEnemy(e: Enemy) {
    this.triggerHitstop(e.kind === 'boss' ? CONFIG.effects.hitstopBossKill : CONFIG.effects.hitstopKill)
    this.effects.shake(CONFIG.effects.shakeKill)
    this.scene.remove(e.group)
    this.kills++
    const death = enemyDeathArt(e.artSet)
    this.effects.deathDissolve(e.pos, death.map, death.scale)
    this.effects.playFx('death', e.pos.x, 1.0, e.pos.z, ENEMY_SCALE[e.artSet] * 1.3)

    const burst = e.deathBurst()
    if (burst) {
      this.effects.playGroundFx(burst.slowZoneDuration > 0 ? 'tealMagic' : 'shockwave', e.pos.x, e.pos.z, burst.radius * 2, 0.8)
      const distance = Math.hypot(this.player.pos.x - e.pos.x, this.player.pos.z - e.pos.z)
      if (distance <= burst.radius + CONFIG.player.radius && this.player.takeDamage(e.damage * burst.damageMultiplier)) {
        this.audio.hurt()
        this.effects.shake(CONFIG.effects.shakePlayerHit)
      }
      if (burst.slowZoneDuration > 0) {
        this.spawnSlowZone(e.pos, burst.radius, burst.slowZoneDuration, burst.slowMultiplier)
      }
    }

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
    if (!this.player.canAcquireTrait(u)) {
      this.hud.banner_(u.slot === 'sigil' ? '이 특성은 최대 스택에 도달했습니다' : '이미 보유한 특성입니다')
      return false
    }
    this.audio.pick()
    u.apply(this.player)
    if (u.slot === 'sigil') this.player.recordTrait(u.id)
    else this.player.setCoreSlot(u.slot as CoreSlot, u.id)
    const cur = this.acquired.get(u.id)
    if (cur) cur.count++
    else this.acquired.set(u.id, { upgrade: u, count: 1 })
    this.hud.setHp(this.player.hp, this.player.stats.maxHp)
    this.hud.setXp(this.player.xp, this.player.xpToNext)
    return true
  }

  /**
   * 특성 카드 하나를 "선택"한다 — 각인이거나 빈 슬롯이면 바로 적용한다.
   * 이미 채워진 핵심 슬롯의 다른 특성이면 현재 보유 특성과 나란히 보여주고
   * 교체/유지를 고르게 한다(유지를 고르면 이번 선택 기회는 소모된다).
   * 이번 커밋은 핵심 슬롯 특성이 0종이라 이 분기는 실제로 타지 않는다 —
   * 커밋 3에서 슬롯 특성이 들어오면 그대로 쓰인다.
   */
  private offerTrait(u: Upgrade, onDone: (applied: boolean) => void) {
    if (u.slot !== 'sigil') {
      const currentId = this.player.coreSlots.get(u.slot as CoreSlot)
      const current = currentId ? upgradeById(currentId) : undefined
      if (current && current.id !== u.id) {
        this.hud.showSlotSwap(current, u, (keepCurrent) => {
          if (keepCurrent) {
            onDone(false)
            return
          }
          onDone(this.applyTrait(u))
        })
        return
      }
    }
    onDone(this.applyTrait(u))
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
    const choices = rollChoices(3, this.player.traitStacks, this.player.coreSlots)
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
      this.offerTrait(u, () => {
        // 레벨이 더 쌓였으면 연속 처리
        if (this.player.gainXp(0)) {
          this.hud.setXp(this.player.xp, this.player.xpToNext)
          this.openLevelUp()
        } else {
          this.state = 'play'
          this.clock.getDelta()
        }
      })
    })
  }

  private gameOver() {
    this.state = 'gameover'
    this.audio.gameOver()
    this.hud.setPrompt(null)
    this.hud.showGameOver(this.run.depth, this.kills, this.run.gold, this.player.level)
  }
}
