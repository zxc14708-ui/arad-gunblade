import * as THREE from 'three'
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js'
import { CONFIG, COLORS } from '../config'
import { Input } from './Input'
import { Room, RoomVisualKind, DEFAULT_ROOM_SIZES } from '../systems/Room'
import { RunState, RoomPlan, RoomEnemy, ROOM_ICON, roomLabel, Direction } from '../systems/RunState'
import { Player } from '../entities/Player'
import { Enemy, EnemyAction, EnemyKind } from '../entities/Enemy'
import { enemyDeathArt, ENEMY_SCALE } from '../entities/EnemySprite'
import { Interactable } from '../entities/Interactable'
import { Projectiles } from '../systems/Projectiles'
import { Pickups } from '../systems/Pickups'
import { Effects } from '../systems/Effects'
import { rollChoices, Upgrade, forgeSwapCandidates, upgradeById, CoreSlot, isSigilSlot, nodeGradeFor, rollNodeSigilRewards } from '../systems/Upgrades'
import { Shop, ShopItem } from '../systems/Shop'
import { AudioManager } from '../systems/Audio'
import { ELITE_AFFIX } from '../systems/EliteAffixes'
import { MetaProgression } from '../systems/MetaProgression'
import { weaponById } from '../systems/Weapons'
import { preloadAssets } from '../rendering/assets'
import { noOutline } from '../rendering/toon'
import { DISPLAY, fitStage } from '../rendering/viewport'
import { HUD, type RouteChoice } from '../ui/HUD'

type State = 'start' | 'play' | 'route' | 'levelup' | 'reward' | 'shop' | 'meta' | 'loadout' | 'clear' | 'gameover'
type Mode = 'town' | 'dungeon'

/** 경로 카드에서 전투 구성을 짧고 일관되게 읽기 위한 표시명. */
const ROUTE_ENEMY_LABEL: Record<EnemyKind, string> = {
  imp: '근접',
  brute: '중형',
  shooter: '원거리',
  boss: '보스',
  suicide: '자폭',
  frostSuicide: '빙결 자폭',
  fireMage: '화염 마법',
  iceMage: '빙결 마법',
  summoner: '소환술사',
  zombie: '좀비',
  voidMage: '공허 마법',
  charger: '돌진',
}

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
  /** '잔재'(고유·레전더리, 작업 지시 P8c4) — 처치 지점에 남는 잔상 공격체.
   * 자체 스프라이트 없이 주기적으로 가장 가까운 적을 타격만 한다(간단한
   * 원거리 판정으로 구현 — 이동/추적 없이 고정 위치에서 사거리 안을 친다). */
  private remnants: { pos: THREE.Vector3; timer: number; tickTimer: number; damage: number; slot: number }[] = []
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
    this.hud.onRouteContinue(() => {
      if (this.mode === 'dungeon' && this.state === 'play' && this.roomCleared) {
        this.presentNextRoutes()
      }
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
    this.remnants = []
    this.projectiles.clear()
    this.pickups.clear()
    this.effects.clear()
    this.interactables.forEach((o) => o.removeFrom(this.scene))
    this.interactables = []
    this.boss = null
    this.hud.showBoss(false)
    this.hud.setPrompt(null)
    this.hud.hideRouteChoices()
    this.hud.hideRouteContinue()
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
    this.player.group.visible = true

    // 던전 포탈 — 북쪽 문 라인 대신 마을 안쪽에 둬 상단 벽/HUD에 가리지 않게 한다.
    const p = { x: 0, z: this.room.bounds.minZ + 8 }
    this.interactables.push(
      new Interactable('portal', p.x, p.z, `던전 입장 — ${this.run.cfg.name}`).addTo(this.scene),
    )
    // 마을 상인은 런 골드가 아닌 영구 재화로 무기를 해금한다.
    this.interactables.push(new Interactable('merchant', -10, -2, '모험가 상점 — 무기 설계도').addTo(this.scene))
    // 마을 분수는 작업 지시 P7 커밋2에서 제거됐다 — 마을 입장 시 이미
    // heal(9999)로 완전 회복되므로(아래) 회복 수단이 중복이었다.
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
    this.run.enterFirst()
    this.prepareStageRoutes()
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
    this.player.heal(this.player.stats.maxHp * 0.3)
    this.run.enterFirst()
    this.prepareStageRoutes()
    this.audio.waveStart()
  }

  /**
   * 깊이 0 로비는 그래프 연결을 위한 논리 루트로만 남긴다. 실제 방을 만들지
   * 않고 첫 경로 카드를 바로 열어, 던전 진입 화면 자체가 첫 선택이 되게 한다.
   */
  private prepareStageRoutes() {
    this.clearWorld()
    this.room?.dispose()
    this.player.group.visible = false
    this.curPlan = null
    this.roomCleared = true
    this.run.markCurrentCleared()
    this.hud.setMinimap(this.run.minimap())
    this.hud.banner_(`${this.run.cfg.name} · 첫 경로를 선택하세요`)
    this.presentNextRoutes()
    this.clock.getDelta()
  }

  /** 경로 카드에서 사용할 배율 표기 — 게임 수치는 바꾸지 않고 읽기만 한다. */
  private routeMultiplier(value: number) {
    return Number(value.toFixed(2)).toString()
  }

  private routeRisk(plan: RoomPlan) {
    if (plan.enemies.length === 0) return '전투 없음'
    if (plan.kind === 'boss') {
      return `보스 1 + 호위 ${Math.max(0, plan.enemies.length - 1)} · 체력×${this.routeMultiplier(plan.hpMul)} · 공격×${this.routeMultiplier(plan.dmgMul)}`
    }
    const roster = [...new Set(plan.enemies.map((enemy) => ROUTE_ENEMY_LABEL[enemy.kind]))].join('/')
    return `적 ${plan.enemies.length}명 · ${roster} · 체력×${this.routeMultiplier(plan.hpMul)} · 공격×${this.routeMultiplier(plan.dmgMul)} · 속도×${this.routeMultiplier(plan.speedMul)}`
  }

  /** 현재 구현의 실제 보상만 표기한다. 전투 골드 배수는 P9 커밋 1에서 추가된다. */
  private routeReward(plan: RoomPlan) {
    switch (plan.kind) {
      case 'trait': return '각인 후보 3장 중 1장'
      case 'hardCombat': return `각인 후보 3장 중 1장 · 골드 +${20 + plan.depth * 8}`
      case 'elite': return `각인 후보 4장 중 1장 · 골드 +${35 + plan.depth * 12} · 증표 1`
      case 'boss': return '각인 후보 3장 중 1장 · 스테이지 보상'
      case 'shop': return '상점 · 제련소'
      case 'rest': return '상점 · 회복 우물 · 제련소'
      case 'recover': return '회복 우물'
      default: return plan.chests > 0 ? '기본 골드 · 보물상자' : '기본 골드'
    }
  }

  private routeGrade(plan: RoomPlan) {
    switch (plan.kind) {
      case 'trait': return nodeGradeFor(this.run.stage, 'trait')
      case 'hardCombat': return nodeGradeFor(this.run.stage, 'hardCombat')
      case 'elite': return nodeGradeFor(this.run.stage, 'elite')
      case 'boss': return nodeGradeFor(this.run.stage, 'boss')
      default: return undefined
    }
  }

  private routeRecharge(plan: RoomPlan) {
    if (!this.player.sigilGrades.has('reserve_mag') || (plan.kind !== 'shop' && plan.kind !== 'rest')) return undefined
    const current = this.player.reserveMagChargesLeft
    const max = this.player.reserveMagMaxCharges
    return current < max ? `가능 · ${current}/${max}` : `현재 최대 · ${current}/${max}`
  }

  private routeChoice(plan: RoomPlan): RouteChoice {
    return {
      id: plan.id,
      icon: ROOM_ICON[plan.kind],
      title: roomLabel(plan),
      kind: `${plan.depth}구역 · ${roomLabel(plan)}`,
      risk: this.routeRisk(plan),
      reward: this.routeReward(plan),
      grade: this.routeGrade(plan),
      eliteAffix: plan.kind === 'elite' && plan.affix ? ELITE_AFFIX[plan.affix].name : undefined,
      recharge: this.routeRecharge(plan),
    }
  }

  /**
   * 물리적인 문 대신 현재 노드의 단방향 출구를 카드로 보여준다. 별도 route
   * 상태에서 게임 루프가 멈추며, 카드 선택이 확정된 뒤에만 목표 방을 로드한다.
   */
  private presentNextRoutes() {
    if (this.curPlan?.kind === 'boss') return
    const exits = this.run.exits
    if (exits.length === 0) {
      this.state = 'play'
      this.hud.hideRouteChoices()
      this.hud.hideRouteContinue()
      return
    }

    const choices = exits.map(({ plan }) => this.routeChoice(plan))
    this.state = 'route'
    this.input.clearAll()
    this.hud.setPrompt(null)
    this.hud.showRouteChoices(choices, (choice) => {
      if (this.state !== 'route') return
      const target = this.run.exits.find(({ plan }) => plan.id === choice.id)
      if (!target) return
      this.audio.pick()
      this.loadRoom(this.run.enter(target.plan.id))
    })
  }

  /** 방 하나 구성 — 다음 방 이동은 물리 문이 아니라 경로 카드에서 처리한다. */
  private loadRoom(plan: RoomPlan) {
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
    this.player.group.visible = true

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
        this.shopRooms.set(plan.id, new Shop([this.player.gun.id, this.player.sword.id], this.player.sigilGrades, this.player.coreSlots))
      }
      this.interactables.push(new Interactable('merchant', -6, -1, plan.kind === 'rest' ? '보스전 상점' : '상인과 거래').addTo(this.scene))
      this.interactables.push(new Interactable('dungeonForge', 0, 4, this.dungeonForgeLabel()).addTo(this.scene))
      // '예비 탄창'(고유·레전더리, 작업 지시 P10) — 상인 노드(shop)와 보스
      // 준비방(rest) 최초 입장 시 충전(방 단위로 1회, run.usedObjects가
      // 방마다 독립이라 재방문해도 다시 충전되지 않는다 — 상자/분수와 같은
      // 관례). 미보유면 grantReserveMagCharge()가 아무 일도 하지 않는다.
      if (!this.run.isObjectUsed('reserve-mag-charge')) {
        this.run.markObjectUsed('reserve-mag-charge')
        this.player.grantReserveMagCharge()
      }
    }

    // 회복 분수 — RunState.generateMap()이 맵 생성 시점에 hasFountain을 정해
    // 재방문해도 나타났다 사라지지 않는다. 'rest'(깊이 8 고정 보스 준비방)와
    // 'recover'(분기 노드, 작업 지시 P7 커밋2)만 hasFountain: true다.
    if (plan.hasFountain) {
      const p = plan.kind === 'rest' ? { x: 6, z: -1 } : this.room.randomPoint(5)
      this.interactables.push(new Interactable('fountain', p.x, p.z, plan.kind === 'rest' ? `보스전 회복 우물 · ${this.fountainLabel()}` : `회복의 우물 · ${this.fountainLabel()}`).addTo(this.scene))
    }

    // 플레이어 진입 위치
    const e = this.room.entryPoint()
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

    // 시설방은 입장 즉시 클리어 상태지만, 시설 이용 전에 경로 화면이 플레이를
    // 막지 않도록 명시적인 진행 버튼으로만 다음 카드를 연다. recover는 P9
    // 커밋 1에서 제거 예정이므로 그전까지 같은 안전 규칙을 적용한다.
    if (this.roomCleared && (plan.kind === 'shop' || plan.kind === 'rest' || plan.kind === 'recover')) {
      this.hud.showRouteContinue(plan.kind === 'rest' ? '보스전 준비 완료 · 다음 경로 보기' : '다음 경로 보기')
    }

    this.snapCamera()
    this.clock.getDelta()
  }

  private onRoomClear() {
    if (this.roomCleared) return
    this.roomCleared = true
    this.run.markCurrentCleared()
    this.hud.setMinimap(this.run.minimap())
    if (this.curPlan?.kind === 'boss') {
      this.grantBossStageReward()
    } else if (this.curPlan?.kind === 'elite') {
      this.grantEliteReward()
    } else if (this.curPlan?.kind === 'trait') {
      this.grantTraitReward()
    } else if (this.curPlan?.kind === 'hardCombat') {
      this.grantHardCombatReward()
    } else {
      this.audio.pick()
      this.hud.banner_('방 클리어! 다음 경로를 선택하세요')
      this.presentNextRoutes()
    }
  }

  /**
   * '각인' 노드(작업 지시 P7 커밋2, 등급 보상은 P8 커밋3) — 전투 후 각인
   * 하나를 자동으로 지급한다. 상자(openChest)와 달리 확률로 골드가 나오는
   * 대신 항상 특성이 나온다. 등급은 nodeGradeFor(stage, 'trait') — 노드
   * 보정 없음(표 그대로).
   */
  private grantTraitReward() {
    this.state = 'reward'
    this.input.clearAll()
    this.audio.levelup()
    const grade = nodeGradeFor(this.run.stage, 'trait')
    const choices = rollNodeSigilRewards(3, grade, this.player.sigilGrades, this.player.coreSlots)
    if (choices.length === 0) {
      this.state = 'play'
      this.hud.banner_('획득 가능한 특성이 없습니다')
      this.presentNextRoutes()
      this.clock.getDelta()
      return
    }
    this.hud.showLevelUp('각인 획득!', '특성 하나를 선택하세요', choices, (u) => {
      this.offerTrait(u, () => {
        this.audio.pick()
        this.state = 'play'
        this.hud.banner_('각인 획득!')
        this.presentNextRoutes()
        this.clock.getDelta()
      })
    })
  }

  /**
   * '상위 전투' 노드(작업 지시 P7 커밋2) — 등급 체계가 없던 시절엔 4장
   * 선택 + 골드로 "더 나은 보상"을 흉내 냈는데, 이번 커밋(P8 커밋3)의
   * 노드 등급 표가 정확히 이 노드를 "기본 등급 +1, 3장"으로 지정하므로
   * 그 임시방편을 정식 등급 보상으로 대체한다 — 카드 수는 표대로 3장이다
   * (예전의 4장은 폐기; 4장은 엘리트 전용이라는 게 표의 명시적 구분이다).
   */
  private grantHardCombatReward() {
    this.state = 'reward'
    this.input.clearAll()
    this.audio.levelup()
    const gold = 20 + this.run.depth * 8
    this.run.addGold(gold)
    const grade = nodeGradeFor(this.run.stage, 'hardCombat')
    const choices = rollNodeSigilRewards(3, grade, this.player.sigilGrades, this.player.coreSlots)
    if (choices.length === 0) {
      this.state = 'play'
      this.hud.banner_(`골드 +${gold} · 획득 가능한 특성이 없습니다`)
      this.presentNextRoutes()
      this.clock.getDelta()
      return
    }
    this.hud.showLevelUp('상위 전투 클리어!', `각인을 선택하세요 · 골드 +${gold}`, choices, (u) => {
      this.offerTrait(u, () => {
        this.audio.pick()
        this.state = 'play'
        this.hud.banner_('상위 전투 보상 획득!')
        this.presentNextRoutes()
        this.clock.getDelta()
      })
    })
  }

  /**
   * 엘리트방 보상(작업 지시 P8 커밋3 노드 표 — 기본 등급 +1, 4장). 예전
   * 주석이 "보스 보상 4장을 여기 잘못 적용했다"고 지적했던 부분은 이제
   * 해소됐다 — 표가 엘리트를 명시적으로 4장으로 지정하고, 보스(스테이지
   * 클리어)는 grantBossStageReward()로 별도 3장을 받는다.
   */
  private grantEliteReward() {
    this.state = 'reward'
    this.input.clearAll()
    this.audio.levelup()
    const gold = 35 + this.run.depth * 12
    this.run.addGold(gold)
    this.meta.grantEliteToken()
    const grade = nodeGradeFor(this.run.stage, 'elite')
    const choices = rollNodeSigilRewards(4, grade, this.player.sigilGrades, this.player.coreSlots)
    if (choices.length === 0) {
      this.state = 'play'
      this.hud.banner_(`골드 +${gold} · 모험가 증표 +1 · 획득 가능한 특성이 없습니다`)
      this.presentNextRoutes()
      this.clock.getDelta()
      return
    }
    this.hud.showLevelUp('ELITE CLEAR!', `고급 특성을 선택하세요 · 골드 +${gold}`, choices, (u) => {
      this.offerTrait(u, () => {
        this.audio.pick()
        this.state = 'play'
        this.hud.banner_('엘리트 보상 획득!')
        this.presentNextRoutes()
        this.clock.getDelta()
      })
    })
  }

  /**
   * 보스방(스테이지 클리어) 각인 보상(작업 지시 P8 커밋3 노드 표 — 기본
   * 등급 +1, 3장). 이 저장소엔 원래 보스 처치 시 각인 카드를 고르는 흐름
   * 자체가 없었다(onStageClear가 메타 보상 화면만 보여줬다) — 노드 표가
   * "보스(스테이지 클리어)"를 명시적인 각인 보상 노드로 지정했으므로 이
   * 커밋에서 새로 추가했다. 카드를 고른 뒤에 기존 onStageClear() 흐름
   * (메타 보상 화면)으로 이어진다.
   */
  private grantBossStageReward() {
    this.state = 'reward'
    this.input.clearAll()
    this.audio.levelup()
    const grade = nodeGradeFor(this.run.stage, 'boss')
    const choices = rollNodeSigilRewards(3, grade, this.player.sigilGrades, this.player.coreSlots)
    if (choices.length === 0) {
      this.onStageClear()
      return
    }
    this.hud.showLevelUp('보스 처치! 각인 획득', '특성 하나를 선택하세요', choices, (u) => {
      this.offerTrait(u, () => {
        this.audio.pick()
        this.onStageClear()
      })
    })
  }

  private onStageClear() {
    this.state = 'clear'
    this.audio.levelup()
    const reward = this.meta.grantStageClear(this.run.cfg.reward)
    this.hud.showStageClear(this.run.stage, this.kills, this.run.gold, this.run.isLastStage, reward)
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

    this.hud.setPrompt(target ? target.label : null)
    if (!target || !justPressed) return

    switch (target.kind) {
      case 'portal':
        this.openLoadout()
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
    const choices = rollChoices(3, this.player.sigilGrades, this.player.coreSlots)
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
   * 던전 제련소 — 보유 특성 1개를 같은 축의 다른 특성으로 교체(유료, 반복 사용
   * 가능). 각인은 등급 5단계(작업 지시 P8 커밋3) 도입으로 스택이 아니라
   * 등급을 갖는다 — forgeSwapCandidates()가 "교체해도 힘이 줄지 않는다"는
   * 기존 취지를 이어받아 새 각인을 from과 같은 등급으로 제안하고(offerSigil),
   * from은 sigilGrades에서 완전히 지운다(스택 감산이 아니라 삭제 — 등급은
   * 누적값이 아니라 단일값이라 "1 내린다"는 개념 자체가 없다).
   */
  private useDungeonForge(forge: Interactable) {
    const price = this.run.dungeonForgePrice
    const owned = [...this.acquired.values()]
      .map((a) => a.upgrade)
      .filter((u) => forgeSwapCandidates(u.id, this.player.sigilGrades, this.player.coreSlots).length > 0)
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
      const candidates = forgeSwapCandidates(from.id, this.player.sigilGrades, this.player.coreSlots).sort(() => Math.random() - 0.5).slice(0, 3)
      this.hud.showLevelUp('제련소 — 무엇으로 교체할까요?', `${from.name} 을(를) 교체`, candidates, (to) => {
        if (!this.run.spendGold(price)) {
          this.state = 'play'
          return
        }
        // 각인은 from을 완전히 지운다(등급은 단일값이라 감산 개념이 없다) —
        // 새로 적용될 to는 아래 applyTrait(to)가 from과 같은 등급으로 넣는다
        // (교체해도 힘이 줄지 않는다는 취지 유지). 핵심 슬롯은 애초에 슬롯당
        // 1개뿐이라 setCoreSlot이 덮어쓰는 것 자체가 교체다.
        if (isSigilSlot(from.slot)) {
          this.player.sigilGrades.delete(from.id)
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
      const choices = rollChoices(3, this.player.sigilGrades, this.player.coreSlots)
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
      this.shopRooms.set(roomId, new Shop([this.player.gun.id, this.player.sword.id], this.player.sigilGrades, this.player.coreSlots))
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
      this.hud.banner_(isSigilSlot(it.def.slot) ? '이 특성은 최대 스택에 도달했습니다' : '이미 보유한 특성입니다')
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
    shop.reroll([this.player.gun.id, this.player.sword.id], this.player.sigilGrades, this.player.coreSlots)
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
    // '황금의 무게'(작업 지시 P8c4) — 현재 골드를 매 프레임 알려준다. Player.update()
    // 끝에서 recompute()가 이 값을 읽어 동적 피해 배수에 반영한다.
    this.player.setGold(this.run.gold)
    const { bullets, slash, startedReload, reloadTriggerAttempt } = this.player.update(playerDt, this.input, this.aimGround)
    this.room.clamp(this.player.pos, CONFIG.player.radius)

    for (const b of bullets) {
      this.projectiles.spawnBullet(b.pos, b.dir, this.player.stats.bulletSpeed, b.damage, b.crit, this.player.stats.pierce, b.shockwave)
    }
    if (bullets.length > 0) {
      this.audio.gunshot(this.player.gun.id)
      for (const bullet of bullets) this.effects.muzzleFlash(this.player.pos, Math.atan2(bullet.dir.x, bullet.dir.z))
    }
    if (startedReload) this.audio.reload(this.player.gun.id)
    if (reloadTriggerAttempt) this.audio.reloadTriggerAttempt()
    // 장전 진행 바(작업 지시 P6 커밋3 도입, P10 커밋1에서 리듬 판정 제거) —
    // 발밑 원호 게이지와 겹치지 않게 살짝 남쪽으로 띄운 순수 진행률 바.
    if (this.player.reloading) {
      this.effects.showReloadBar(this.player.pos.x, this.player.pos.z, this.player.reloadRatio)
    } else {
      this.effects.hideReloadBar()
    }
    if (slash) {
      this.audio.slash(this.player.sword.id)
      this.effects.slash(slash.pos, slash.angle, slash.arc, slash.range)
      if (this.player.coreSlots.get('sword') === 'dualblade') {
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
        if (this.player.coreSlots.get('sword') === 'parry') {
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
      if (this.player.coreSlots.get('character') === 'mark') this.resolveDashMark(this.player.dashStart, this.player.pos)
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
        const e = new Enemy(spawn.kind, spawn.artSet, p.x, p.z, plan.hpMul, plan.dmgMul, plan.speedMul, plan.kind === 'elite', plan.affix, this.run.stage)
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
    this.updateRemnants(worldDt)
    // 플레이어 총알은 playerDt(항상 정상 속도), 적 총알은 worldDt(히트스톱
    // 대상)로 각각 갱신한다 — 작업 지시 P6 커밋1-1/1-3.
    this.projectiles.update(playerDt, worldDt, this.room.bounds, this.player.pos)
    this.updateSlowZones(worldDt)
    this.resolveBullets()
    this.resolveEnemyBullets()

    const got = this.pickups.update(worldDt, this.player.pos, CONFIG.economy.goldPickupSpeed)
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
      this.player.coreSlots.get('gun') === 'last_bullet',
    )
    this.hud.setReserveMag(this.player.reserveMagChargesLeft, this.player.reserveMagMaxCharges)
    this.hud.setStats(this.mode === 'town' ? 0 : this.run.depth, this.kills, this.run.gold)

    const damageEvent = this.player.consumeDamageEvent()
    if (damageEvent === 'ward') this.hud.banner_('수호막이 피해를 막았습니다!')
    else if (damageEvent === 'revive') this.hud.banner_('불굴 발동 — 체력 50%로 부활!')
    else if (damageEvent === 'dashBlock' && this.player.coreSlots.get('character') === 'afterimage' && this.player.tryRefreshDashOnBlock()) {
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

  /**
   * 광역 피해 — 섬광강타(dashStrike)/폭심(explodeOnKill)이 이 한 지점을 거친다.
   * isExplosionSource가 참이면(폭심 발동) 이 폭발로 죽는 적에게 dieFromExplosion
   * 플래그만 세운다 — 여기서 직접 killEnemy()+배열 제거를 하지 않는다.
   * aoeDamage()는 updateEnemies()의 메인 순회(적 자연사가 다시 폭발을
   * 유발하는 경우) 도중에도 불릴 수 있는데, 그 순회는 인덱스 기반이라
   * 콜백 도중 배열을 직접 스플라이스하면 인덱스가 밀려 실제 크래시가 났다
   * (Enemy.dieFromExplosion 주석 참고). 실제 제거·killEnemy() 호출은
   * updateEnemies() 한 곳에서만 한다 — 이 폭발로 죽은 적도 그 루프가
   * (같은 프레임 안에서, 아직 순회 전이면) 자연스럽게 찾아내 처리한다.
   */
  private aoeDamage(x: number, z: number, radius: number, damage: number, color: number, isExplosionSource = false) {
    this.effects.burst(new THREE.Vector3(x, 1, z), color, 18, 10)
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = Math.hypot(e.pos.x - x, e.pos.z - z)
      if (d <= radius + e.radius) {
        e.takeDamage(damage)
        e.knockback(x, z, 6)
        this.effects.damageNumber(new THREE.Vector3(e.pos.x, 1.6, e.pos.z), damage, false)
        if (isExplosionSource && !e.alive) e.dieFromExplosion = true
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
        this.killEnemy(e, e.dieFromExplosion)
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

    if (action.type === 'bossCancelWarning') {
      // 브레이크(P7 커밋3)로 예고 중이던 패턴이 취소됨 — 공격이 오지 않는데
      // 예고 이펙트만 남는 "유령 예고"를 막기 위해 즉시 제거한다.
      this.effects.clearGroundFx('warning')
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

  /**
   * '잔재'(고유·레전더리, 작업 지시 P8c4 → 이동 방식은 P10 커밋3-2) — 처치
   * 지점에 남는 잔상이 지속시간 동안 플레이어를 일정 거리 두고 따라다니며
   * 주기적으로 사거리 안 가장 가까운 적을 공격한다. 공격 주기·사거리·피해
   * 배율은 각인 승인 수치라 그대로 두고 이동만 새로 추가했다.
   *
   * 여러 개가 동시에 존재할 때 겹치지 않도록 원거리 적 각도 슬롯 포위
   * (assignSurroundSlots(), 작업 지시 P6 커밋1-2)와 같은 방식을 재사용한다 —
   * 배열 인덱스로 매 프레임 균등 각도를 다시 매겨(살아있는 잔재만 대상이라
   * 소멸 시 자동 재배정) 플레이어 주위 원 위의 서로 다른 지점을 목표로 잡는다.
   */
  private updateRemnants(dt: number) {
    const n = this.remnants.length
    for (let i = n - 1; i >= 0; i--) {
      const r = this.remnants[i]
      r.timer -= dt
      if (r.timer <= 0) {
        this.remnants.splice(i, 1)
        continue
      }
      r.slot = (i / n) * Math.PI * 2
      const targetX = this.player.pos.x + Math.cos(r.slot) * CONFIG.traits.remnantFollowRadius
      const targetZ = this.player.pos.z + Math.sin(r.slot) * CONFIG.traits.remnantFollowRadius
      const dx = targetX - r.pos.x
      const dz = targetZ - r.pos.z
      const dist = Math.hypot(dx, dz)
      const step = CONFIG.traits.remnantMoveSpeed * dt
      if (dist > step) {
        r.pos.x += (dx / dist) * step
        r.pos.z += (dz / dist) * step
      } else {
        r.pos.x = targetX
        r.pos.z = targetZ
      }

      r.tickTimer -= dt
      if (r.tickTimer > 0) continue
      r.tickTimer = CONFIG.traits.remnantAttackInterval
      const target = this.nearestUnhitEnemy(r.pos, CONFIG.traits.remnantAttackRange, new Set())
      if (!target) continue
      target.takeDamage(r.damage, 'ranged')
      this.effects.hitImpact(target.pos.x, target.pos.z, 1.2)
      this.effects.damageNumber(new THREE.Vector3(target.pos.x, 1.6, target.pos.z), r.damage, false)
      this.effects.burst(r.pos.clone().setY(1), 0xd0a0ff, 4, 3)
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
    const edges: Direction[] = ['north', 'east', 'south', 'west']
    for (let i = 0; i < 18; i++) {
      const p = this.room.randomPoint(5)
      const nearPlayer = Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z) < 7
      const nearEntrance = edges.some((d) => {
        const edge = this.room.edgePoint(d)
        return Math.hypot(p.x - edge.x, p.z - edge.z) < 5
      })
      if (!nearPlayer && !nearEntrance) return p
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
          const closeRange = this.player.coreSlots.get('gun') === 'close_range' && travelDist <= CONFIG.traits.closeRangeDist
          const dmg = rangeBonus ? b.damage * CONFIG.combat.gunRangeBonusMult : closeRange ? b.damage * CONFIG.traits.closeRangeMult : b.damage
          e.takeDamage(dmg, 'ranged', b.crit)
          // '감전 탄환'(작업 지시 P8c4) — 명중 시 확률로 감전 부여.
          if (this.player.mods.shockOnHitChance > 0 && Math.random() < this.player.mods.shockOnHitChance) {
            e.applyShock(this.player.mods.shockOnHitDuration)
          }
          b.hitSet.add(e.id)
          this.audio.hit()
          this.triggerHitstop(b.crit ? CONFIG.effects.hitstopCrit : CONFIG.effects.hitstopHit)
          this.effects.shake(b.crit ? CONFIG.effects.shakeCrit : CONFIG.effects.shakeGunHit)
          this.applyLifesteal(dmg)
          this.effects.hitImpact(e.pos.x, e.pos.z, b.crit ? 1.9 : 1.3)
          this.effects.damageNumber(new THREE.Vector3(e.pos.x, 1.6, e.pos.z), dmg, b.crit, rangeBonus)
          // '마지막 한발'(gun) — 명중 지점 주변에 넉백 충격파(피해는 없음, 순수 넉백).
          if (b.shockwave) {
            this.effects.burst(new THREE.Vector3(e.pos.x, 1, e.pos.z), COLORS.slash, 10, 5)
            for (const other of this.enemies) {
              if (!other.alive) continue
              const d = Math.hypot(other.pos.x - e.pos.x, other.pos.z - e.pos.z)
              if (d <= CONFIG.traits.lastBulletShockwaveRadius + other.radius) other.knockback(e.pos.x, e.pos.z, CONFIG.traits.lastBulletShockwaveKnockback)
            }
          }
          if (b.hitSet.size > b.pierce) {
            // '도탄'(shot) — 관통 소진으로 소멸하는 시점이 기준이라 무기 고유
            // 관통과 자연스럽게 합쳐진다(관통 3인 무기는 3명 뚫은 뒤 튕긴다).
            // 탄환당 1회만, 아직 안 맞은 적 중 가장 가까운 쪽으로 튕긴다.
            // hitSet은 그대로 유지 — 같은 적을 다시 맞히지 않는다.
            if (this.player.coreSlots.get('gun') === 'ricochet' && !b.ricocheted) {
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
    const ilseomActive = this.player.coreSlots.get('sword') === 'ilseom' && hits.length === 1
    const finalDamage = ilseomActive ? damage * CONFIG.traits.ilseomMult : damage
    const fxScale = opts.halfFx ? CONFIG.traits.dualbladeSecondHitFxScale : 1

    // 2패스 — 확정된 배수로 피해/넉백/이펙트 적용
    let hitAny = false
    for (const e of hits) {
      hitAny = true
      // '혈흔'(고유·레전더리, 작업 지시 P8c4) — 피해 적용 전에 판정한다:
      // 이미 출혈 중이던 적이면 그 잔여 피해를 먼저 터뜨린다(단독 작동 —
      // '출혈 칼날' 없이도 이 각인 자신이 매 타격마다 1중첩을 건다).
      if (this.player.mods.bloodTraceOwned) {
        if (e.bleeding) {
          const burst = e.detonateBleed()
          if (burst > 0) {
            e.takeDamage(burst, 'bleed')
            this.effects.damageNumber(new THREE.Vector3(e.pos.x, 2.0, e.pos.z), Math.round(burst), false)
            this.effects.burst(new THREE.Vector3(e.pos.x, 1, e.pos.z), 0xff3b3b, 8, 5)
          }
        }
        e.applyBleed(CONFIG.enemy.bleed.duration)
      }
      // '출혈 칼날'(작업 지시 P8c4) — 베기 적중 시 등급별 중첩 부여.
      if (this.player.mods.bleedOnHitStacks > 0) {
        for (let s = 0; s < this.player.mods.bleedOnHitStacks; s++) {
          e.applyBleed(CONFIG.enemy.bleed.duration * this.player.mods.bleedOnHitDurationMult)
        }
      }
      const reflected = e.takeDamage(finalDamage, 'melee', crit)
      // '일도양단'(고유·에픽, 작업 지시 P8c4) — 피해 적용 후 판정한다(방금
      // 이 타격으로 낮아진 체력 기준). 일반 적은 즉사(다음 프레임
      // updateEnemies()가 일반 사망 경로로 처리 — killEnemy()를 여기서
      // 직접 부르지 않는다), 보스·엘리트는 최대 체력 비례 고정 피해를 더 준다.
      if (this.player.mods.executeBladeOwned && e.alive) {
        if (!e.elite && e.kind !== 'boss' && e.hp / e.maxHp <= this.player.mods.executeThreshold) {
          e.hp = 0
          e.alive = false
        } else if (e.elite || e.kind === 'boss') {
          e.takeDamage(e.maxHp * this.player.mods.executeBossFrac, 'melee')
        }
      }
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

  /**
   * fromExplosion: 이 죽음이 폭심(explodeOnKill)의 폭발 자체로 발생했는가.
   * 아래 explodeOnKill 재기폭 분기가 fromExplosion을 확인하는 이유 —
   * killEnemy()는 죽은 원인과 무관하게 매 킬마다 `mods.explodeOnKill > 0`이면
   * 무조건 폭발시키므로, 손대지 않으면 폭발로 죽은 적이 다시 폭발을 켜고
   * 그게 또 다른 적을 죽여 재귀적으로 무한 연쇄한다(모든 등급에서 이미
   * 그렇게 동작하고 있었다 — QC로 확인 후 발견). '폭심'의 등급별 연쇄는
   * 에픽 전용 규칙이어야 하므로(work order), 에픽이 아니면 폭발 유발 킬은
   * 재기폭을 막는다 — 직접 처치(fromExplosion=false)는 항상 정상 발동한다.
   */
  private killEnemy(e: Enemy, fromExplosion = false) {
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

    // 골드 드랍
    const gold = e.kind === 'boss' ? 120 + Math.floor(Math.random() * 60) : Math.max(2, Math.round(e.maxHp * 0.22))
    this.pickups.dropGold(e.pos.x, e.pos.z, gold)

    if (this.player.mods.explodeOnKill > 0 && (!fromExplosion || this.player.mods.detonatorChain)) {
      this.aoeDamage(e.pos.x, e.pos.z, 3.2, this.player.mods.explodeOnKill, 0xffa040, true)
    }
    // '잔재'(고유·레전더리, 작업 지시 P8c4) — 처치 지점에 잔상을 남긴다.
    // 피해는 "현재 총 피해"의 비율로 고정한다(work order 확정 문구) — 처치
    // 시점의 gunDamage 스냅샷이라 잔상이 유지되는 동안 플레이어 스탯이
    // 바뀌어도(예: 무기 교체) 흔들리지 않는다.
    if (this.player.mods.remnantOwned) {
      this.remnants.push({
        pos: e.pos.clone(),
        timer: this.player.mods.remnantDuration,
        tickTimer: 0,
        damage: this.player.stats.gunDamage * this.player.mods.remnantDmgFrac,
        slot: 0,
      })
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
      this.hud.banner_(isSigilSlot(u.slot) ? '이 각인은 이미 최고 등급(에픽)입니다' : '이미 보유한 특성입니다')
      return false
    }
    this.audio.pick()
    if (isSigilSlot(u.slot)) {
      // 각인은 u.grade가 항상 붙어 있다(rollChoices/rollNodeSigilRewards가
      // 만든 제안만 여기 들어온다) — u.apply()는 각인에서 더 이상 쓰이지
      // 않는다(작업 지시 P8 커밋3, Player.applySigil() 참고).
      this.player.applySigil(u.id, u.grade!)
    } else {
      u.apply(this.player)
      this.player.setCoreSlot(u.slot as CoreSlot, u.id)
    }
    const cur = this.acquired.get(u.id)
    if (cur) { cur.count++; cur.upgrade = u }
    else this.acquired.set(u.id, { upgrade: u, count: 1 })
    this.hud.setHp(this.player.hp, this.player.stats.maxHp)
    return true
  }

  /**
   * 특성 카드 하나를 "선택"한다 — 각인이거나 빈 슬롯이면 바로 적용한다.
   * 이미 채워진 핵심 슬롯의 다른 특성이면 현재 보유 특성과 나란히 보여주고
   * 교체/유지를 고르게 한다(유지를 고르면 이번 선택 기회는 소모된다).
   */
  private offerTrait(u: Upgrade, onDone: (applied: boolean) => void) {
    if (!isSigilSlot(u.slot)) {
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

  private gameOver() {
    this.state = 'gameover'
    this.audio.gameOver()
    this.hud.setPrompt(null)
    this.hud.showGameOver(this.run.depth, this.kills, this.run.gold)
  }
}
