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
    requestGauge: (x: number, z: number, progress: number, color: string, decreasing?: boolean) => void
    update: (dt: number, camera: THREE.Camera) => void
  }
  camera: THREE.Camera
  run: RunState
  loadRoom: (plan: RoomPlan) => void
}

function internals(game: Game): GameInternals {
  return game as unknown as GameInternals
}

/** RunState.nodes(private)에 QC 목적으로 접근하기 위한 캐스팅 타입 */
interface RunStateInternals {
  nodes: Map<string, {
    plan: { kind: RoomKind; depth: number; hasFountain: boolean }
    exits: Partial<Record<'north' | 'east' | 'south' | 'west', string>>
  }>
}

/**
 * 선형 분기 맵(작업 지시 P7 커밋2) 배치 규칙 표본 검증 결과. 위반 카운터는
 * 전부 "0이어야 정상"이다 — 하나라도 0이 아니면 그 규칙이 확률적으로만
 * 지켜지고 있다는 뜻이라 배치 로직 자체를 고쳐야 한다(분수 배치에서 겪은
 * 것과 같은 유형의 결함).
 */
export interface MapSampleResult {
  n: number
  /** 깊이4가 상점이 아니었던 표본 수 */
  shopDepthWrong: number
  /** 깊이8이 보스 준비방이 아니었던 표본 수 */
  restDepthWrong: number
  /** 깊이9가 보스가 아니었던 표본 수 */
  bossDepthWrong: number
  /** 분기 깊이(1·2·3·5·6·7) 수가 6이 아니었던 표본 수 */
  branchDepthCountWrong: number
  /** 분기 깊이 중 선택지가 2~3개 범위를 벗어난 것이 있었던 표본 수 */
  branchChoiceCountWrong: number
  /** 각인 계열(각인+상위 전투) 노드 총수가 2~4 범위를 벗어난 표본 수 */
  traitNodeCountWrong: number
  /** 회복 노드가 1개 미만이었던 표본 수 */
  recoverMissing: number
  /** 상위 전투가 깊이 5 미만에 나온 표본 수 */
  hardCombatTooEarly: number
  /** 같은 깊이 선택지 중 종류가 겹친 것이 있었던 표본 수 */
  duplicateKindAtDepth: number
  /** 되돌아가기가 가능한 간선(자식 깊이가 부모 깊이+1이 아님)이 있었던 표본 수 */
  backwardEdge: number
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
    debugMapSample: (n: number) => MapSampleResult
    debugGetDensityLog: () => DensityLog
    debugSetGauge: (v: { progress: number; color: string; decreasing?: boolean } | null) => void
    debugSetCoreSlot: (slot: string, id: string) => void
    debugEnterStage: (stage: number) => boolean
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
  api.debugMapSample = (n) => {
    const result: MapSampleResult = {
      n,
      shopDepthWrong: 0,
      restDepthWrong: 0,
      bossDepthWrong: 0,
      branchDepthCountWrong: 0,
      branchChoiceCountWrong: 0,
      traitNodeCountWrong: 0,
      recoverMissing: 0,
      hardCombatTooEarly: 0,
      duplicateKindAtDepth: 0,
      backwardEdge: 0,
    }
    const branchDepths = [1, 2, 3, 5, 6, 7]
    for (let i = 0; i < n; i++) {
      const run = new RunState()
      run.enterFirst()
      const nodes = (run as unknown as RunStateInternals).nodes

      const byDepth = new Map<number, RoomKind[]>()
      for (const node of nodes.values()) {
        const list = byDepth.get(node.plan.depth) ?? []
        list.push(node.plan.kind)
        byDepth.set(node.plan.depth, list)
      }

      const at = (d: number) => byDepth.get(d) ?? []
      if (!(at(4).length === 1 && at(4)[0] === 'shop')) result.shopDepthWrong++
      if (!(at(8).length === 1 && at(8)[0] === 'rest')) result.restDepthWrong++
      if (!(at(9).length === 1 && at(9)[0] === 'boss')) result.bossDepthWrong++

      if (branchDepths.filter((d) => at(d).length > 0).length !== branchDepths.length) result.branchDepthCountWrong++

      let choiceCountBad = false
      let dupKind = false
      let hardCombatEarly = false
      let traitFamilyCount = 0
      let recoverCount = 0
      for (const d of branchDepths) {
        const kinds = at(d)
        if (kinds.length < 2 || kinds.length > 3) choiceCountBad = true
        if (new Set(kinds).size !== kinds.length) dupKind = true
        for (const k of kinds) {
          if (k === 'trait' || k === 'hardCombat') traitFamilyCount++
          if (k === 'recover') recoverCount++
          if (k === 'hardCombat' && d < 5) hardCombatEarly = true
        }
      }
      if (choiceCountBad) result.branchChoiceCountWrong++
      if (dupKind) result.duplicateKindAtDepth++
      if (hardCombatEarly) result.hardCombatTooEarly++
      if (traitFamilyCount < 2 || traitFamilyCount > 4) result.traitNodeCountWrong++
      if (recoverCount < 1) result.recoverMissing++

      let backward = false
      for (const node of nodes.values()) {
        for (const targetId of Object.values(node.exits)) {
          const target = targetId ? nodes.get(targetId) : undefined
          if (target && target.plan.depth !== node.plan.depth + 1) backward = true
        }
      }
      if (backward) result.backwardEdge++
    }
    return result
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

  api.debugEnterStage = (stage) => {
    if (stage < 1 || stage > 7) return false
    const g = internals(game)
    g.run.reset(stage)
    const lobby = g.run.enterFirst()
    g.loadRoom.call(game, lobby)
    // enterFirst()는 깊이 0(진입 로비)에 들어간다 — 적이 없는 구조적
    // 앵커라 스테이지 콘텐츠(적 로스터) 검증엔 의미가 없다(작업 지시 P7
    // 커밋2, RunState.generateMap() 주석 참고). 실제 전투가 있는 깊이 1
    // 방으로 곧장 한 번 더 들어간다 — 적이 있는 선택지를 우선한다('회복'
    // 노드가 뽑히면 적이 0이라 로스터 검증이 안 된다).
    const firstExit = g.run.exits.find((exit) => exit.plan.enemies.length > 0) ?? g.run.exits[0]
    if (firstExit) g.loadRoom.call(game, g.run.enter(firstExit.plan.id))
    return g.run.stage === stage && g.curPlan?.depth === 1
  }

  api.debugSpawnBoss = () => {
    const g = internals(game)
    const e = new Enemy('boss', 'boss', g.player.pos.x, g.player.pos.z - 6, 1, 1, 1, false)
    g.enemies.push(e)
    g.scene.add(e.group)
    g.boss = e
    g.hud.showBoss(true)
    return e
  }

  api.debugSpawnEnemy = (kind) => {
    const g = internals(game)
    const e = new Enemy(kind, kind, g.player.pos.x, g.player.pos.z - 8, 1, 1, 1, false)
    g.enemies.push(e)
    g.scene.add(e.group)
    return e
  }

  api.debugSpawnElite = (kind, affix) => {
    const g = internals(game)
    const e = new Enemy(kind, kind, g.player.pos.x, g.player.pos.z - 4, 1, 1, 1, true, affix)
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
  let forcedGauge: { progress: number; color: string; decreasing?: boolean } | null = null
  const origEffectsUpdate = g1.effects.update.bind(g1.effects)
  g1.effects.update = (dt: number, camera: THREE.Camera) => {
    if (forcedGauge) {
      const g = internals(game)
      g.effects.requestGauge(g.player.pos.x, g.player.pos.z, forcedGauge.progress, forcedGauge.color, forcedGauge.decreasing)
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
