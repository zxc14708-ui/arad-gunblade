import * as THREE from 'three'
import { Enemy, EnemyKind } from '../entities/Enemy'
import type { EliteAffix } from '../systems/EliteAffixes'
import { weaponById } from '../systems/Weapons'
import { RunState, RoomKind } from '../systems/RunState'
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
  }
  boss: Enemy | null
  hud: { showBoss(show: boolean): void }
  mode: 'town' | 'dungeon'
  spawnQueue: EnemyKind[]
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

export function installQcDebugHooks(game: Game) {
  const api = game as unknown as {
    debugSpawnBoss: () => Enemy
    debugSpawnEnemy: (kind: EnemyKind) => Enemy
    debugSpawnElite: (kind: EnemyKind, affix: EliteAffix) => Enemy
    debugEquipWeapons: (gunId: string, swordId: string) => boolean
    debugClearEnemies: () => void
    debugFountainSample: (n: number) => FountainSampleResult
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
}
