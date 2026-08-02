import * as THREE from 'three'
import { Enemy, EnemyKind, DamageSource } from '../entities/Enemy'
import type { EliteAffix } from '../systems/EliteAffixes'
import { weaponById } from '../systems/Weapons'
import { RunState, RoomKind, RoomPlan } from '../systems/RunState'
import type { Bullet } from '../systems/Projectiles'
import type { Game } from './Game'

/**
 * QC 하네스(tools/qc.mjs) 전용 디버그 스폰 훅.
 *
 * 절차 생성 던전에서는 보스방(8개 방 완주)과 특정 엘리트 접두사가 매 실행마다
 * 나온다는 보장이 없어, 정상 플레이 경로로는 보스 패턴·엘리트 접두사를
 * 결정적으로 재현할 수 없다. 이 모듈은 진행 중인 던전 방에 보스/엘리트를
 * 직접 스폰해 상태머신 타이밍을 폴링으로 검증할 수 있게 한다.
 *
 * main.ts에서 __QC_DEBUG__(vite.config.ts의 define, tools/qc.mjs가 빌드할 때만
 * QC_DEBUG=1로 켬) 블록 안 동적 import로만 로드된다 — 일반 배포 빌드에는
 * 이 파일 자체가 번들에 실리지 않는다.
 *
 * Game의 내부 필드는 전부 private 이지만 TS의 private는 컴파일 타임에만
 * 존재하므로, 여기서는 QC 목적의 런타임 접근을 위해 명시적으로 캐스팅한다.
 */

interface GameInternals {
  enemies: Enemy[]
  scene: THREE.Scene
  player: {
    pos: THREE.Vector3
    speed: number
    invuln: number
    equip: (weapon: NonNullable<ReturnType<typeof weaponById>>) => void
    char: { spec: { n: number } }
    coreSlots: Map<string, string>
    ammo: number
    magSize: number
    reloading: boolean
  }
  boss: Enemy | null
  hud: { showBoss(show: boolean): void }
  mode: 'town' | 'dungeon'
  spawnQueue: EnemyKind[]
  curPlan: RoomPlan | null
  enterDungeon: () => void
  resolveSlash: (
    pos: THREE.Vector3,
    angle: number,
    arc: number,
    range: number,
    damage: number,
    crit: boolean,
    knockback: number,
  ) => void
  projectiles: { bullets: Bullet[]; removeBullet: (i: number) => void }
  effects: {
    requestGauge: (x: number, z: number, progress: number, color: string) => void
    update: (dt: number, camera: THREE.Camera) => void
  }
  camera: THREE.Camera
}

function internals(game: Game): GameInternals {
  return game as unknown as GameInternals
}

/** RunState.nodes(private)에 QC 목적으로 접근하기 위한 캐스팅 타입 */
interface RunStateInternals {
  nodes: Map<string, { plan: { kind: RoomKind; hasFountain: boolean } }>
}

export interface FountainSampleResult {
  n: number
  /** hasFountain 개수 -> 그 개수가 나온 표본 수. 예: { 4: 297, 3: 3 } */
  counts: Record<number, number>
  /** 상점방에 분수가 없었던 표본 수 (항상 0이어야 한다) */
  shopMissing: number
  /** 보스 준비방에 분수가 없었던 표본 수 (항상 0이어야 한다) */
  restMissing: number
  /** 보스방에 분수가 배치된 표본 수 (항상 0이어야 한다) */
  bossHasFountain: number
  /** 전투방만으로 정원을 못 채워 보물/엘리트방을 보충으로 썼던 표본 수 */
  supplementUsed: number
}

/** 검 스윙 1회당 기록 — resolveSlash 호출마다 하나씩 쌓인다 */
export interface SwingDensityRecord {
  /** 부채꼴 판정에 실제로 들어와 맞은 적 수 (resolveSlash 실측) */
  hits: number
  /** 같은 시점 플레이어 반경 4/6/8 안의(생존) 적 수 */
  nearby4: number
  nearby6: number
  nearby8: number
  roomKind: RoomKind | 'town'
  depth: number
}

/** 총알 1발당 기록 — 최소 1명 이상 맞히고 제거(관통 소진 또는 사거리 만료)될 때 하나씩 쌓인다 */
export interface PierceDensityRecord {
  /** 이 총알이 평생 맞힌 총 적 수 (첫 명중 포함) */
  totalHits: number
  /** 첫 명중 이후 관통으로 추가 명중한 수 (totalHits - 1) */
  extraHits: number
  roomKind: RoomKind | 'town'
  depth: number
}

export interface DensityLog {
  swings: SwingDensityRecord[]
  pierces: PierceDensityRecord[]
}

export function installQcDebugHooks(game: Game) {
  const api = game as unknown as {
    debugSpawnBoss: () => Enemy
    debugSpawnEnemy: (kind: EnemyKind) => Enemy
    debugSpawnElite: (kind: EnemyKind, affix: EliteAffix) => Enemy
    debugEquipWeapons: (gunId: string, swordId: string) => boolean
    debugClearEnemies: () => void
    debugFountainSample: (n: number) => FountainSampleResult
    debugGetDensityLog: () => DensityLog
    debugSetGauge: (v: { progress: number; color: string } | null) => void
    debugSetCoreSlot: (slot: string, id: string) => void
    debugEnterDungeon: () => void
  }

  const swings: SwingDensityRecord[] = []
  const pierces: PierceDensityRecord[] = []
  const roomInfo = () => {
    const g = internals(game)
    return { roomKind: g.curPlan?.kind ?? ('town' as const), depth: g.curPlan?.depth ?? 0 }
  }

  api.debugGetDensityLog = () => ({ swings, pierces })

  // ── 검 스윙 밀도 계측 ──────────────────────────────────────────────────
  // resolveSlash를 인스턴스 프로퍼티로 감싼다(원본은 프로토타입 메서드라
  // "this.resolveSlash(...)" 호출은 인스턴스 프로퍼티를 먼저 찾는다).
  // 실제 명중 수는 resolveSlash 내부 변수라 밖에서 못 읽으므로, 스윙이 도는
  // 동안만 Enemy.prototype.takeDamage를 감싸 melee 호출 횟수를 세고 즉시
  // 원복한다 — 동기 호출이라 재진입 걱정이 없다. Game.ts/Enemy.ts 소스는
  // 건드리지 않는다.
  const g0 = internals(game)
  const origResolveSlash = g0.resolveSlash.bind(game)
  g0.resolveSlash = (pos, angle, arc, range, damage, crit, knockback) => {
    const g = internals(game)
    let hits = 0
    const origTakeDamage = Enemy.prototype.takeDamage
    Enemy.prototype.takeDamage = function (this: Enemy, amount: number, source?: DamageSource, hitCrit?: boolean) {
      if (source === 'melee') hits++
      return origTakeDamage.call(this, amount, source, hitCrit)
    }
    try {
      origResolveSlash(pos, angle, arc, range, damage, crit, knockback)
    } finally {
      Enemy.prototype.takeDamage = origTakeDamage
    }
    const px = g.player.pos.x
    const pz = g.player.pos.z
    const within = (r: number) =>
      g.enemies.filter((e) => e.alive && Math.hypot(e.pos.x - px, e.pos.z - pz) <= r).length
    swings.push({ hits, nearby4: within(4), nearby6: within(6), nearby8: within(8), ...roomInfo() })
  }

  // ── 총알 관통 밀도 계측 ────────────────────────────────────────────────
  // 총알은 관통 소진(hitSet.size > pierce) 또는 수명 만료 어느 쪽으로든
  // Projectiles.removeBullet(i)를 거쳐 사라진다. 이 인스턴스의
  // removeBullet만 감싸(프로토타입이 아니라 이 Game의 projectiles 인스턴스
  // 하나에만 영향) 제거 직전 hitSet 크기로 "이 총알이 평생 맞힌 적 수"를
  // 기록한다 — 관통 소진 시점만 잡으면 사거리 만료로 사라진, pierce 예산을
  // 다 못 쓴 총알(흔한 사례)이 표본에서 빠져 명중 수가 과대평가된다.
  const origRemoveBullet = g0.projectiles.removeBullet.bind(g0.projectiles)
  g0.projectiles.removeBullet = (i: number) => {
    const b = g0.projectiles.bullets[i]
    if (b && b.hitSet.size >= 1) {
      pierces.push({ totalHits: b.hitSet.size, extraHits: b.hitSet.size - 1, ...roomInfo() })
    }
    origRemoveBullet(i)
  }

  // 게임 상태(this.run)는 건드리지 않는다 — 매 표본마다 독립된 RunState를
  // 새로 만들어 맵만 생성하고 버린다. RunState는 Game에 의존하지 않아
  // standalone으로 안전하게 인스턴스화할 수 있다.
  api.debugFountainSample = (n) => {
    const counts: Record<number, number> = {}
    let shopMissing = 0
    let restMissing = 0
    let bossHasFountain = 0
    let supplementUsed = 0
    for (let i = 0; i < n; i++) {
      const run = new RunState()
      run.enterFirst()
      const nodes = (run as unknown as RunStateInternals).nodes
      const plans = [...nodes.values()].map((node) => node.plan)
      const fountainCount = plans.filter((p) => p.hasFountain).length
      counts[fountainCount] = (counts[fountainCount] ?? 0) + 1
      if (!plans.some((p) => p.kind === 'shop' && p.hasFountain)) shopMissing++
      if (!plans.some((p) => p.kind === 'rest' && p.hasFountain)) restMissing++
      if (plans.some((p) => p.kind === 'boss' && p.hasFountain)) bossHasFountain++
      if (plans.some((p) => (p.kind === 'treasure' || p.kind === 'elite') && p.hasFountain)) supplementUsed++
    }
    return { n, counts, shopMissing, restMissing, bossHasFountain, supplementUsed }
  }

  // `--only` 단일 스텝 실행 지원 — 던전 모드가 필요한 스텝을 포탈 실걷기
  // 없이 곧장 진입시킨다(tools/qc.mjs의 부트스트랩에서 사용).
  api.debugEnterDungeon = () => {
    const g = internals(game)
    if (g.mode !== 'dungeon') g.enterDungeon()
  }

  api.debugClearEnemies = () => {
    const g = internals(game)
    for (const e of g.enemies) g.scene.remove(e.group)
    g.enemies.length = 0
    g.boss = null
    g.hud.showBoss(false)
    // 원래 방의 스폰 대기열이 남아있으면 실제 몬스터가 계속 흘러들어와
    // 접촉 피해로 player.invuln을 불시에 갱신해 이후 피해 판정 검증을
    // 흔들 수 있다 — 디버그 구간에서는 걷어낸다.
    g.spawnQueue.length = 0
  }

  api.debugSpawnBoss = () => {
    const g = internals(game)
    const e = new Enemy('boss', g.player.pos.x, g.player.pos.z - 6, 1, 1, 1, false)
    g.enemies.push(e)
    g.scene.add(e.group)
    g.boss = e
    g.hud.showBoss(true)
    return e
  }

  api.debugSpawnEnemy = (kind) => {
    const g = internals(game)
    const e = new Enemy(kind, g.player.pos.x, g.player.pos.z - 8, 1, 1, 1, false)
    g.enemies.push(e)
    g.scene.add(e.group)
    return e
  }

  api.debugSpawnElite = (kind, affix) => {
    const g = internals(game)
    const e = new Enemy(kind, g.player.pos.x, g.player.pos.z - 4, 1, 1, 1, true, affix)
    g.enemies.push(e)
    g.scene.add(e.group)
    return e
  }

  api.debugEquipWeapons = (gunId, swordId) => {
    const g = internals(game)
    const gun = weaponById(gunId)
    const sword = weaponById(swordId)
    if (!gun || gun.kind !== 'gun' || !sword || sword.kind !== 'sword') return false
    g.player.equip(gun)
    g.player.equip(sword)
    return g.player.char.spec.n === 27
  }

  // ── 발밑 원호 게이지 강제 표시 ────────────────────────────────────────
  // 이 게이지는 아직 소비자(조건부 특성)가 없어 정상 플레이로는 절대 뜨지
  // 않는다. effects.update()를 감싸 매 프레임 강제로 requestGauge를 불러줘야
  // QC 스크린샷으로 렌더링을 확인할 수 있다 — Effects.ts 소스는 건드리지
  // 않는다. null을 넘기면 강제 표시를 끈다(다음 프레임에 즉시 사라짐 확인용).
  const g1 = internals(game)
  let forcedGauge: { progress: number; color: string } | null = null
  const origEffectsUpdate = g1.effects.update.bind(g1.effects)
  g1.effects.update = (dt: number, camera: THREE.Camera) => {
    if (forcedGauge) {
      const g = internals(game)
      g.effects.requestGauge(g.player.pos.x, g.player.pos.z, forcedGauge.progress, forcedGauge.color)
    }
    origEffectsUpdate(dt, camera)
  }
  api.debugSetGauge = (v) => {
    forcedGauge = v
  }

  // 핵심 슬롯에 특성을 직접 채운다 — QC가 실제 플레이 경로(카드 뽑기) 없이
  // 슬롯 특성 발동 조건을 결정적으로 재현하기 위한 훅.
  api.debugSetCoreSlot = (slot, id) => {
    const g = internals(game)
    g.player.coreSlots.set(slot, id)
  }
}
