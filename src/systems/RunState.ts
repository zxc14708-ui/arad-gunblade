import { CONFIG } from '../config'
import { EnemyKind } from '../entities/Enemy'
import { ELITE_AFFIX, EliteAffix, rollEliteAffix } from './EliteAffixes'

export type RoomKind = 'combat' | 'elite' | 'treasure' | 'shop' | 'rest' | 'boss'
export type Direction = 'north' | 'east' | 'south' | 'west'

export const DIRECTIONS: Direction[] = ['north', 'east', 'south', 'west']
export const OPPOSITE: Record<Direction, Direction> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
}

const DELTA: Record<Direction, { x: number; y: number }> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
}

/** 방 안에 스폰될 적 1개체 — kind(행동/AI)와 artSet(외형)를 분리한다(작업 지시
 * P2_prompt_stage_data_and_continuous_run_1 커밋2). */
export interface RoomEnemy {
  kind: EnemyKind
  artSet: string
}

export interface RoomPlan {
  id: string
  kind: RoomKind
  enemies: RoomEnemy[]
  chests: number
  hpMul: number
  dmgMul: number
  speedMul: number
  xpMul: number
  affix?: EliteAffix
  x: number
  y: number
  depth: number
  /** 이 방에 분수를 배치할지 — 맵 생성 시점에 정해져 재방문해도 유지된다 */
  hasFountain: boolean
}

interface RoomNode {
  plan: RoomPlan
  exits: Partial<Record<Direction, string>>
  visited: boolean
  cleared: boolean
  usedObjects: Set<string>
}

export interface MapRoom {
  id: string
  kind: RoomKind
  x: number
  y: number
  current: boolean
  visited: boolean
  cleared: boolean
  visible: boolean
  exits: Direction[]
}

export interface RoomExit {
  direction: Direction
  plan: RoomPlan
}

export const ROOM_LABEL: Record<RoomKind, string> = {
  combat: '전투',
  elite: '엘리트',
  treasure: '보물',
  shop: '상점',
  rest: '보스 준비',
  boss: '보스',
}
export const ROOM_ICON: Record<RoomKind, string> = {
  combat: '⚔',
  elite: '✦',
  treasure: '◆',
  shop: '¤',
  rest: '⛺',
  boss: '☠',
}

export function roomLabel(plan: Pick<RoomPlan, 'kind' | 'affix'>) {
  if (plan.kind === 'elite' && plan.affix) return `${ROOM_LABEL.elite} · ${ELITE_AFFIX[plan.affix].name}`
  return ROOM_LABEL[plan.kind]
}

/** 전투방(일반) 적 등장표 한 줄. weight는 병렬 정규화 가중치가 아니라
 * 누적 임계값이다 — enemiesFor()가 배열 순서대로 "r < weight"를 검사해
 * 처음 만족하는 항목을 고른다(기존 depth>=3 && r<0.2 같은 중첩 조건문을
 * 그대로 데이터로 옮긴 것). 배열의 마지막 항목은 나머지 전부를 흡수하는
 * 폴백이라 보통 weight: 1을 둔다. */
export interface StageEnemyEntry {
  kind: EnemyKind
  /** 외형 — ASSET.monsters의 키(작업 지시 커밋2). 스테이지 1은 kind와 동일한
   * 문자열을 써 기존 1:1 매핑을 그대로 유지한다. */
  artSet: string
  weight: number
  minDepth: number
}

export interface StageDef {
  id: number
  name: string
  normalRooms: number
  difficulty: {
    baseHp: number
    baseDmg: number
    baseXp: number
    /** depth 1당 hpMul 증가율 (기존 하드코딩 0.17) */
    depthHpStep: number
    /** depth 1당 dmgMul 증가율 (기존 하드코딩 0.1) */
    depthDmgStep: number
  }
  /** 일반 전투방(combat) 적 구성표 — enemiesFor()가 읽는다. 엘리트/보물/보스방
   * 구성은 이번 작업 지시 범위 밖(스키마에 명시된 필드가 아님)이라 기존
   * 하드코딩된 확률을 그대로 둔다. */
  enemies: StageEnemyEntry[]
  boss: { kind: EnemyKind; artSet: string }
  art: {
    floor: string
    foreground: {
      treeA: string
      treeB: string
      bushA: string
      bushB: string
      stoneA: string
      stoneB: string
      vineTop: string
    }
    campfire: string
  }
  /** 방 종류별 크기. 'elite'는 기존과 동일하게 'combat' 크기로 대체한다
   * (기존 코드가 SIZES['elite'] 미존재 시 SIZES.combat으로 폴백하던 것과 동일). */
  roomSize: Record<'combat' | 'treasure' | 'shop' | 'rest' | 'boss', { w: number; d: number }>
  reward: { faint: number; decent: number; strong: number; tokens: number }
}

export const STAGES: StageDef[] = [
  {
    id: 1,
    name: '검은 숲 지하',
    normalRooms: 6,
    difficulty: { baseHp: 1.0, baseDmg: 1.0, baseXp: 1.0, depthHpStep: 0.17, depthDmgStep: 0.1 },
    // 기존 combat 블록: depth>=3 && r<0.2 → brute, depth>=2 && r<0.5 → shooter, else imp.
    // enemiesFor()의 누적 임계값 검사로 그대로 옮겼다(표본 검사로 확인, 최종 보고 참고).
    enemies: [
      { kind: 'brute', artSet: 'brute', weight: 0.2, minDepth: 3 },
      { kind: 'shooter', artSet: 'shooter', weight: 0.5, minDepth: 2 },
      { kind: 'imp', artSet: 'imp', weight: 1, minDepth: 1 },
    ],
    boss: { kind: 'boss', artSet: 'boss' },
    art: {
      floor: 'assets/stage1/stage1_background/forest_floor_room.png',
      foreground: {
        treeA: 'assets/stage1/stage1_forest_foreground/great_tree_a.png',
        treeB: 'assets/stage1/stage1_forest_foreground/great_tree_b.png',
        bushA: 'assets/stage1/stage1_forest_foreground/dark_bush_a.png',
        bushB: 'assets/stage1/stage1_forest_foreground/dark_bush_b.png',
        stoneA: 'assets/stage1/stage1_forest_foreground/guardian_stone_a.png',
        stoneB: 'assets/stage1/stage1_forest_foreground/guardian_stone_b.png',
        vineTop: 'assets/stage1/stage1_forest_foreground/root_vine_top.png',
      },
      campfire: 'assets/stage1/stage1_interactive_objects/campfire_3frames.png',
    },
    roomSize: {
      combat: { w: 42, d: 30 },
      treasure: { w: 34, d: 26 },
      shop: { w: 38, d: 26 },
      rest: { w: 38, d: 26 },
      boss: { w: 50, d: 36 },
    },
    reward: { faint: 3, decent: 1, strong: 1, tokens: 2 },
  },
  // ── 임시 테스트 데이터 — 스테이지 2~5는 스테이지 1의 복제본이며 콘텐츠
  // 교체 예정이다(작업 지시 P2_prompt_stage_data_and_continuous_run_1 커밋4).
  // 이어가기 전환 흐름(마을을 거치지 않고 다음 스테이지로 넘어가는 것)을
  // 검증하려면 STAGES가 최소 5개 있어야 하는데 아직 실제 스테이지 2~5
  // 콘텐츠(적 구성/아트/방크기)가 없어 채워 넣었다. difficulty(baseHp/
  // baseDmg/baseXp 램프)만 스테이지별로 다르고 나머지(enemies/boss/art/
  // roomSize/reward)는 스테이지 1과 완전히 동일하다 — 실제 콘텐츠가
  // 정해지면 이 4개 항목을 교체해야 한다. baseXp = 1 + (stage-1) * 0.15
  // 공식(작업 지시 커밋3)을 그대로 따랐다. baseHp/baseDmg 램프는 depth당
  // 증가폭(depthHpStep 0.17 / depthDmgStep 0.1)과 같은 폭을 스테이지
  // 단위로도 적용한 것으로, 실제 밸런스 수치가 아니라 전환 흐름 테스트용
  // placeholder다.
  {
    id: 2,
    name: '안개 습지 · 스테이지 2',
    normalRooms: 6,
    difficulty: { baseHp: 1.17, baseDmg: 1.1, baseXp: 1.15, depthHpStep: 0.17, depthDmgStep: 0.1 },
    enemies: [
      { kind: 'suicide', artSet: 's2Suicide', weight: 0.22, minDepth: 2 },
      { kind: 'brute', artSet: 's2Brute', weight: 0.42, minDepth: 3 },
      { kind: 'shooter', artSet: 's2Shooter', weight: 0.68, minDepth: 2 },
      { kind: 'imp', artSet: 's2Imp', weight: 1, minDepth: 1 },
    ],
    boss: { kind: 'boss', artSet: 's2Boss' },
    art: {
      floor: 'assets/temp/stage2/environment/floor.png',
      foreground: {
        treeA: 'assets/temp/stage2/environment/treeA.png', treeB: 'assets/temp/stage2/environment/treeB.png',
        bushA: 'assets/temp/stage2/environment/bushA.png', bushB: 'assets/temp/stage2/environment/bushB.png',
        stoneA: 'assets/temp/stage2/environment/stoneA.png', stoneB: 'assets/temp/stage2/environment/stoneB.png',
        vineTop: 'assets/temp/stage2/environment/vineTop.png',
      },
      campfire: 'assets/stage1/stage1_interactive_objects/campfire_3frames.png',
    },
    roomSize: {
      combat: { w: 42, d: 30 },
      treasure: { w: 34, d: 26 },
      shop: { w: 38, d: 26 },
      rest: { w: 38, d: 26 },
      boss: { w: 50, d: 36 },
    },
    reward: { faint: 3, decent: 1, strong: 1, tokens: 2 },
  },
  {
    id: 3,
    name: '독버섯 군락 · 스테이지 3',
    normalRooms: 6,
    difficulty: { baseHp: 1.34, baseDmg: 1.2, baseXp: 1.3, depthHpStep: 0.17, depthDmgStep: 0.1 },
    enemies: [
      { kind: 'suicide', artSet: 's3Suicide', weight: 0.25, minDepth: 2 },
      { kind: 'brute', artSet: 's3Brute', weight: 0.45, minDepth: 3 },
      { kind: 'shooter', artSet: 's3Shooter', weight: 0.7, minDepth: 2 },
      { kind: 'imp', artSet: 's3Imp', weight: 1, minDepth: 1 },
    ],
    boss: { kind: 'boss', artSet: 's3Boss' },
    art: {
      floor: 'assets/temp/stage3/environment/floor.png',
      foreground: {
        treeA: 'assets/temp/stage3/environment/treeA.png', treeB: 'assets/temp/stage3/environment/treeB.png',
        bushA: 'assets/temp/stage3/environment/bushA.png', bushB: 'assets/temp/stage3/environment/bushB.png',
        stoneA: 'assets/temp/stage3/environment/stoneA.png', stoneB: 'assets/temp/stage3/environment/stoneB.png',
        vineTop: 'assets/temp/stage3/environment/vineTop.png',
      },
      campfire: 'assets/stage1/stage1_interactive_objects/campfire_3frames.png',
    },
    roomSize: {
      combat: { w: 42, d: 30 },
      treasure: { w: 34, d: 26 },
      shop: { w: 38, d: 26 },
      rest: { w: 38, d: 26 },
      boss: { w: 50, d: 36 },
    },
    reward: { faint: 3, decent: 1, strong: 1, tokens: 2 },
  },
  {
    id: 4,
    name: '불타는 주둔지 · 스테이지 4',
    normalRooms: 6,
    difficulty: { baseHp: 1.51, baseDmg: 1.3, baseXp: 1.45, depthHpStep: 0.17, depthDmgStep: 0.1 },
    enemies: [
      { kind: 'fireMage', artSet: 's4FireMage', weight: 0.24, minDepth: 3 },
      { kind: 'shooter', artSet: 's4Shooter', weight: 0.62, minDepth: 2 },
      { kind: 'imp', artSet: 's4Imp', weight: 1, minDepth: 1 },
    ],
    boss: { kind: 'boss', artSet: 's4Boss' },
    art: {
      floor: 'assets/temp/stage4/environment/floor.png',
      foreground: {
        treeA: 'assets/temp/stage4/environment/treeA.png', treeB: 'assets/temp/stage4/environment/treeB.png',
        bushA: 'assets/temp/stage4/environment/bushA.png', bushB: 'assets/temp/stage4/environment/bushB.png',
        stoneA: 'assets/temp/stage4/environment/stoneA.png', stoneB: 'assets/temp/stage4/environment/stoneB.png',
        vineTop: 'assets/temp/stage4/environment/vineTop.png',
      },
      campfire: 'assets/stage1/stage1_interactive_objects/campfire_3frames.png',
    },
    roomSize: {
      combat: { w: 42, d: 30 },
      treasure: { w: 34, d: 26 },
      shop: { w: 38, d: 26 },
      rest: { w: 38, d: 26 },
      boss: { w: 50, d: 36 },
    },
    reward: { faint: 3, decent: 1, strong: 1, tokens: 2 },
  },
  {
    id: 5,
    name: '얼어붙은 계곡 · 스테이지 5',
    normalRooms: 6,
    difficulty: { baseHp: 1.68, baseDmg: 1.4, baseXp: 1.6, depthHpStep: 0.17, depthDmgStep: 0.1 },
    enemies: [
      { kind: 'iceMage', artSet: 's5IceMage', weight: 0.2, minDepth: 3 },
      { kind: 'frostSuicide', artSet: 's5FrostSuicide', weight: 0.4, minDepth: 2 },
      { kind: 'shooter', artSet: 's5Shooter', weight: 0.68, minDepth: 2 },
      { kind: 'imp', artSet: 's5Imp', weight: 1, minDepth: 1 },
    ],
    boss: { kind: 'boss', artSet: 's5Boss' },
    art: {
      floor: 'assets/temp/stage5/environment/floor.png',
      foreground: {
        treeA: 'assets/temp/stage5/environment/treeA.png', treeB: 'assets/temp/stage5/environment/treeB.png',
        bushA: 'assets/temp/stage5/environment/bushA.png', bushB: 'assets/temp/stage5/environment/bushB.png',
        stoneA: 'assets/temp/stage5/environment/stoneA.png', stoneB: 'assets/temp/stage5/environment/stoneB.png',
        vineTop: 'assets/temp/stage5/environment/vineTop.png',
      },
      campfire: 'assets/stage1/stage1_interactive_objects/campfire_3frames.png',
    },
    roomSize: {
      combat: { w: 42, d: 30 },
      treasure: { w: 34, d: 26 },
      shop: { w: 38, d: 26 },
      rest: { w: 38, d: 26 },
      boss: { w: 50, d: 36 },
    },
    reward: { faint: 3, decent: 1, strong: 1, tokens: 2 },
  },
  {
    id: 6,
    name: '망자의 숲 · 스테이지 6',
    normalRooms: 6,
    difficulty: { baseHp: 1.85, baseDmg: 1.5, baseXp: 1.75, depthHpStep: 0.17, depthDmgStep: 0.1 },
    enemies: [
      { kind: 'summoner', artSet: 's6Summoner', weight: 0.2, minDepth: 3 },
      { kind: 'shooter', artSet: 's6Shooter', weight: 0.62, minDepth: 2 },
      { kind: 'imp', artSet: 's6Imp', weight: 1, minDepth: 1 },
    ],
    boss: { kind: 'boss', artSet: 's6Boss' },
    art: {
      floor: 'assets/temp/stage6/environment/floor.png',
      foreground: {
        treeA: 'assets/temp/stage6/environment/treeA.png', treeB: 'assets/temp/stage6/environment/treeB.png',
        bushA: 'assets/temp/stage6/environment/bushA.png', bushB: 'assets/temp/stage6/environment/bushB.png',
        stoneA: 'assets/temp/stage6/environment/stoneA.png', stoneB: 'assets/temp/stage6/environment/stoneB.png',
        vineTop: 'assets/temp/stage6/environment/vineTop.png',
      },
      campfire: 'assets/stage1/stage1_interactive_objects/campfire_3frames.png',
    },
    roomSize: { combat: { w: 42, d: 30 }, treasure: { w: 34, d: 26 }, shop: { w: 38, d: 26 }, rest: { w: 38, d: 26 }, boss: { w: 50, d: 36 } },
    reward: { faint: 3, decent: 1, strong: 1, tokens: 2 },
  },
  {
    id: 7,
    name: '차원의 문턱 · 스테이지 7',
    normalRooms: 6,
    difficulty: { baseHp: 2.02, baseDmg: 1.6, baseXp: 1.9, depthHpStep: 0.17, depthDmgStep: 0.1 },
    enemies: [
      { kind: 'voidMage', artSet: 's7VoidMage', weight: 0.18, minDepth: 3 },
      { kind: 'charger', artSet: 's7Charger', weight: 0.38, minDepth: 2 },
      { kind: 'shooter', artSet: 's7Shooter', weight: 0.68, minDepth: 2 },
      { kind: 'imp', artSet: 's7Imp', weight: 1, minDepth: 1 },
    ],
    boss: { kind: 'boss', artSet: 's7Boss' },
    art: {
      floor: 'assets/temp/stage7/environment/floor.png',
      foreground: {
        treeA: 'assets/temp/stage7/environment/treeA.png', treeB: 'assets/temp/stage7/environment/treeB.png',
        bushA: 'assets/temp/stage7/environment/bushA.png', bushB: 'assets/temp/stage7/environment/bushB.png',
        stoneA: 'assets/temp/stage7/environment/stoneA.png', stoneB: 'assets/temp/stage7/environment/stoneB.png',
        vineTop: 'assets/temp/stage7/environment/vineTop.png',
      },
      campfire: 'assets/stage1/stage1_interactive_objects/campfire_3frames.png',
    },
    roomSize: { combat: { w: 42, d: 30 }, treasure: { w: 34, d: 26 }, shop: { w: 38, d: 26 }, rest: { w: 38, d: 26 }, boss: { w: 50, d: 36 } },
    reward: { faint: 3, decent: 1, strong: 1, tokens: 2 },
  },
]

/**
 * 한 스테이지의 모든 방을 시작할 때 생성한다. 방은 격자 위의 연결 그래프로
 * 배치되며, 한 번 방문한 인접 방은 언제든 다시 이동할 수 있다.
 */
export class RunState {
  stage = 1
  depth = 0
  gold = 0
  roomsCleared = 0
  current: RoomPlan | null = null

  /** 던전 제련소 다음 사용 가격 — 런 단위로 유지, 사용할 때마다 오름 */
  dungeonForgePrice = CONFIG.economy.dungeonForgeBasePrice
  /** 던전 분수 런 전체 첫 사용(무료) 소진 여부 */
  fountainFreeUsed = false
  /** 던전 분수 다음 유료 사용 가격 — 런 단위로 유지 */
  fountainPrice = CONFIG.economy.fountainBasePrice

  private nodes = new Map<string, RoomNode>()
  private currentId: string | null = null
  private previousEliteAffix: EliteAffix | undefined

  get cfg() {
    return STAGES[Math.min(this.stage - 1, STAGES.length - 1)]
  }
  get bossDepth() {
    return this.cfg.normalRooms + 3
  }
  get isBossRoom() {
    return this.current?.kind === 'boss'
  }
  /** 챕터(5스테이지) 완주 여부 — true면 이번 보스 클리어로 마을 복귀 */
  get isLastStage() {
    return this.stage >= STAGES.length
  }

  reset(stage = 1) {
    this.stage = stage
    this.depth = 0
    this.gold = 0
    this.roomsCleared = 0
    this.current = null
    this.currentId = null
    this.nodes.clear()
    this.previousEliteAffix = undefined
    this.dungeonForgePrice = CONFIG.economy.dungeonForgeBasePrice
    this.fountainFreeUsed = false
    this.fountainPrice = CONFIG.economy.fountainBasePrice
  }

  /** 이어가기 런의 스테이지 전환 — reset()과 달리 골드를 유지한다(작업 지시
   * P2_prompt_stage_data_and_continuous_run_1 커밋4). 레벨/경험치/특성/장비는
   * Player 쪽 상태라 이 메서드가 건드리지 않는다. 방 맵(nodes)/depth/분수·
   * 제련소 가격 사다리·사용 이력은 새로 시작한다. */
  advanceStage() {
    this.stage++
    this.depth = 0
    this.roomsCleared = 0
    this.current = null
    this.currentId = null
    this.nodes.clear()
    this.previousEliteAffix = undefined
    this.dungeonForgePrice = CONFIG.economy.dungeonForgeBasePrice
    this.fountainFreeUsed = false
    this.fountainPrice = CONFIG.economy.fountainBasePrice
  }

  private muls(depth: number) {
    const c = this.cfg
    return {
      hpMul: c.difficulty.baseHp * (1 + (depth - 1) * c.difficulty.depthHpStep),
      dmgMul: c.difficulty.baseDmg * (1 + (depth - 1) * c.difficulty.depthDmgStep),
      speedMul: Math.min(1.7, 1 + (depth - 1) * 0.035),
      // 스테이지 배수만 적용(depth 배수는 이번 작업 범위 밖) — 스테이지 정의의
      // difficulty.baseXp 자체가 그 배수다. 스테이지 1은 1.0 = 기존과 동일.
      xpMul: c.difficulty.baseXp,
    }
  }

  /** 일반 전투방 적 1명 선택 — 스테이지 정의의 enemies 표를 읽는다(작업 지시
   * P2_prompt_stage_data_and_continuous_run_1 커밋1). 배열 순서대로 "r < weight"를
   * 검사해 처음 만족하는(그리고 depth >= minDepth인) 항목을 고른다 — 기존
   * depth>=3 && r<0.2 → brute 같은 중첩 조건문과 동일한 결과를 낸다. */
  private enemiesFor(depth: number): StageEnemyEntry {
    const r = Math.random()
    const eligible = this.cfg.enemies.filter((e) => depth >= e.minDepth)
    for (const e of eligible) {
      if (r < e.weight) return e
    }
    return eligible[eligible.length - 1] ?? this.cfg.enemies[this.cfg.enemies.length - 1]
  }

  private makePlan(id: string, depth: number, kind: RoomKind, x: number, y: number): RoomPlan {
    const m = this.muls(depth)
    if (kind === 'boss') {
      const adds = Array.from({ length: 5 }, () => this.enemiesFor(depth))
      const enemies: RoomEnemy[] = [
        { kind: this.cfg.boss.kind, artSet: this.cfg.boss.artSet },
        ...adds.map((e) => ({ kind: e.kind, artSet: e.artSet })),
      ]
      return { id, kind, enemies, chests: 0, x, y, depth, hasFountain: false, ...m }
    }
    if (kind === 'shop' || kind === 'rest') return { id, kind, enemies: [], chests: 0, x, y, depth, hasFountain: true, ...m }
    if (kind === 'elite') {
      const affix = rollEliteAffix(this.previousEliteAffix)
      this.previousEliteAffix = affix
      const count = Math.ceil((3 + depth * 1.4) * CONFIG.spawn.roomDensity)
      const enemies: RoomEnemy[] = []
      for (let i = 0; i < count; i++) {
        const e = this.enemiesFor(depth)
        enemies.push({ kind: e.kind, artSet: e.artSet })
      }
      return { id, kind, enemies, chests: 0, x, y, depth, hasFountain: false, affix, hpMul: m.hpMul * 1.45, dmgMul: m.dmgMul * 1.2, speedMul: m.speedMul * 1.08, xpMul: m.xpMul }
    }
    if (kind === 'treasure') {
      const n = Math.max(2, Math.ceil((1 + Math.floor(Math.random() * 2)) * CONFIG.spawn.roomDensity))
      const enemies: RoomEnemy[] = Array.from({ length: n }, () => {
        const e = this.enemiesFor(depth)
        return { kind: e.kind, artSet: e.artSet }
      })
      return { id, kind, enemies, chests: 2, x, y, depth, hasFountain: false, ...m }
    }

    const count = Math.ceil((4 + Math.floor(depth * 1.2) + Math.floor(Math.random() * 3)) * CONFIG.spawn.roomDensity)
    const enemies: RoomEnemy[] = Array.from({ length: count }, () => {
      const e = this.enemiesFor(depth)
      return { kind: e.kind, artSet: e.artSet }
    })
    return { id, kind, enemies, chests: Math.random() < 0.4 ? 1 : 0, x, y, depth, hasFountain: false, ...m }
  }

  private key(x: number, y: number) {
    return `${x},${y}`
  }

  private addNode(plan: RoomPlan) {
    this.nodes.set(plan.id, { plan, exits: {}, visited: false, cleared: false, usedObjects: new Set() })
  }

  private connect(a: RoomNode, direction: Direction, b: RoomNode) {
    a.exits[direction] = b.plan.id
    b.exits[OPPOSITE[direction]] = a.plan.id
  }

  /** 무작위 연결형 방 지도 생성. 인접한 방은 자동으로 이어져 가끔 순환 경로도 생긴다. */
  private generateMap() {
    const start = this.makePlan('room-0', 1, 'combat', 0, 0)
    this.addNode(start)

    const occupied = new Map<string, RoomNode>()
    occupied.set(this.key(0, 0), this.nodes.get(start.id)!)
    const roomCount = this.cfg.normalRooms + 3
    const restIndex = roomCount - 2
    const bossIndex = roomCount - 1
    const shopIndex = 2 + Math.floor(Math.random() * Math.max(1, this.cfg.normalRooms - 2))

    for (let index = 1; index < roomCount; index++) {
      if (index === bossIndex) {
        const rest = this.nodes.get(`room-${restIndex}`)!
        const directions = DIRECTIONS.filter((direction) => {
          const d = DELTA[direction]
          return !rest.exits[direction] && !occupied.has(this.key(rest.plan.x + d.x, rest.plan.y + d.y))
        })
        const direction = directions[Math.floor(Math.random() * directions.length)]
        const d = DELTA[direction]
        const plan = this.makePlan(`room-${index}`, index + 1, 'boss', rest.plan.x + d.x, rest.plan.y + d.y)
        this.addNode(plan)
        const node = this.nodes.get(plan.id)!
        occupied.set(this.key(plan.x, plan.y), node)
        this.connect(rest, direction, node)
        continue
      }

      const candidates: { parent: RoomNode; direction: Direction; x: number; y: number }[] = []
      for (const node of occupied.values()) {
        if (node.plan.kind === 'boss' || node.plan.kind === 'rest') continue
        for (const direction of DIRECTIONS) {
          const d = DELTA[direction]
          const x = node.plan.x + d.x
          const y = node.plan.y + d.y
          if (!occupied.has(this.key(x, y))) candidates.push({ parent: node, direction, x, y })
        }
      }
      const placementCandidates = index === restIndex
        ? candidates.filter((candidate) => DIRECTIONS.some((direction) => {
          const d = DELTA[direction]
          return !occupied.has(this.key(candidate.x + d.x, candidate.y + d.y))
        }))
        : candidates
      const pick = placementCandidates[Math.floor(Math.random() * placementCandidates.length)]
      const roll = Math.random()
      const kind: RoomKind = index === restIndex ? 'rest' : index === shopIndex ? 'shop' : roll < 0.16 ? 'elite' : roll < 0.42 ? 'treasure' : 'combat'
      const plan = this.makePlan(`room-${index}`, index + 1, kind, pick.x, pick.y)
      this.addNode(plan)
      const node = this.nodes.get(plan.id)!
      occupied.set(this.key(pick.x, pick.y), node)
      this.connect(pick.parent, pick.direction, node)

      // 새 방이 기존 방에 맞닿아 있으면 함께 연결해 지름길/순환 경로를 만든다.
      for (const direction of kind === 'rest' ? [] : DIRECTIONS) {
        const d = DELTA[direction]
        const neighbor = occupied.get(this.key(pick.x + d.x, pick.y + d.y))
        if (neighbor && neighbor !== node && !node.exits[direction]) this.connect(node, direction, neighbor)
      }
    }

    this.assignFountains(roomCount)
  }

  /**
   * 분수 배치 — 확률이 아니라 개수를 보장한다(런마다 0개가 나오는 걸 막는다).
   * 상점방과 보스 준비방은 makePlan()에서 이미 hasFountain: true로 고정된다.
   * 나머지 (fountainRoomCount - 2)개는 전투방 중에서 고르되, 첫 분수를
   * 후반부에서만 만나는 일이 없도록 최소 1개는 전반부(depth가 전체 방 수의
   * 절반 이하) 방에서 뽑는다. 전투방만으로 정원을 못 채우면 보물방 →
   * 엘리트방 순으로 보충한다(보스/상점/보스준비방은 대상에서 제외 — 상점·
   * 보스준비는 이미 확정, 보스방은 원래도 분수를 두지 않는다). 전반부 우선
   * 규칙은 보충 단계에도 그대로 적용한다 — 아직 전반부 방을 못 뽑았다면
   * 지금 보는 풀(보물/엘리트)의 전반부 후보부터 시도한다.
   * 그래도 후보가 모자라면(작은 스테이지 등) 있는 만큼만 배치한다.
   */
  private assignFountains(roomCount: number) {
    const extraNeeded = CONFIG.economy.fountainRoomCount - 2
    if (extraNeeded <= 0) return

    const earlyCutoff = roomCount / 2
    const chosen: RoomPlan[] = []
    let haveEarly = false

    for (const kind of ['combat', 'treasure', 'elite'] as const) {
      if (chosen.length >= extraNeeded) break
      const pool = [...this.nodes.values()].map((n) => n.plan).filter((p) => p.kind === kind)
      if (pool.length === 0) continue

      if (!haveEarly) {
        const earlyPool = pool.filter((p) => p.depth <= earlyCutoff)
        if (earlyPool.length > 0) {
          chosen.push(earlyPool[Math.floor(Math.random() * earlyPool.length)])
          haveEarly = true
        }
      }

      const remaining = pool.filter((p) => !chosen.includes(p))
      while (chosen.length < extraNeeded && remaining.length > 0) {
        const idx = Math.floor(Math.random() * remaining.length)
        chosen.push(remaining[idx])
        remaining.splice(idx, 1)
      }
    }

    for (const p of chosen) p.hasFountain = true
  }

  /** 새 스테이지 지도 생성 후 시작 방으로 진입 */
  enterFirst(): RoomPlan {
    this.generateMap()
    return this.enter('room-0')
  }

  /** 현재 방과 연결된 방으로 이동 */
  enter(id: string): RoomPlan {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`Unknown room: ${id}`)
    node.visited = true
    this.currentId = id
    this.current = node.plan
    this.depth = node.plan.depth
    return node.plan
  }

  get exits(): RoomExit[] {
    const current = this.currentId ? this.nodes.get(this.currentId) : null
    if (!current) return []
    return DIRECTIONS.flatMap((direction) => {
      const id = current.exits[direction]
      const node = id ? this.nodes.get(id) : undefined
      return node ? [{ direction, plan: node.plan }] : []
    })
  }

  isCurrentCleared() {
    return this.currentId ? this.nodes.get(this.currentId)?.cleared === true : false
  }

  markCurrentCleared() {
    const node = this.currentId ? this.nodes.get(this.currentId) : null
    if (!node || node.cleared) return false
    node.cleared = true
    this.roomsCleared++
    return true
  }

  isObjectUsed(key: string) {
    return this.currentId ? this.nodes.get(this.currentId)?.usedObjects.has(key) === true : false
  }

  markObjectUsed(key: string) {
    if (this.currentId) this.nodes.get(this.currentId)?.usedObjects.add(key)
  }

  minimap(): MapRoom[] {
    const visibleIds = new Set<string>()
    for (const node of this.nodes.values()) {
      if (!node.visited) continue
      visibleIds.add(node.plan.id)
      Object.values(node.exits).forEach((id) => id && visibleIds.add(id))
    }
    return [...this.nodes.values()].map((node) => ({
      id: node.plan.id,
      kind: node.plan.kind,
      x: node.plan.x,
      y: node.plan.y,
      current: node.plan.id === this.currentId,
      visited: node.visited,
      cleared: node.cleared,
      visible: visibleIds.has(node.plan.id),
      exits: Object.keys(node.exits) as Direction[],
    }))
  }

  addGold(n: number) {
    this.gold += n
  }
  spendGold(n: number) {
    if (this.gold < n) return false
    this.gold -= n
    return true
  }
}
