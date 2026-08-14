import { CONFIG } from '../config'
import { EnemyKind } from '../entities/Enemy'
import { ELITE_AFFIX, EliteAffix, rollEliteAffix } from './EliteAffixes'

/**
 * 작업 지시 P7 커밋2 — 선형 분기 맵으로 재편되며 방 종류도 그에 맞춰
 * 바뀌었다. 'treasure'(보물방)는 분기 노드 표(전투/각인/상위 전투/엘리트/
 * 회복)에 없어 폐지, 'trait'(각인)·'hardCombat'(상위 전투)·'recover'(회복)가
 * 새로 생겼다. 'shop'(깊이 4 고정)·'rest'(깊이 8 고정 보스 준비방)·
 * 'boss'(깊이 9)는 역할이 고정된 깊이 그대로다.
 */
export type RoomKind = 'combat' | 'trait' | 'hardCombat' | 'elite' | 'recover' | 'shop' | 'rest' | 'boss'
export type Direction = 'north' | 'east' | 'south' | 'west'

export const DIRECTIONS: Direction[] = ['north', 'east', 'south', 'west']
export const OPPOSITE: Record<Direction, Direction> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
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
  trait: '각인',
  hardCombat: '상위 전투',
  elite: '엘리트',
  recover: '회복',
  shop: '상점',
  rest: '보스 준비',
  boss: '보스',
}
export const ROOM_ICON: Record<RoomKind, string> = {
  combat: '⚔',
  trait: '📘',
  hardCombat: '🔥',
  elite: '✦',
  recover: '❤',
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
    difficulty: { baseHp: 1.0, baseDmg: 1.0, depthHpStep: 0.17, depthDmgStep: 0.1 },
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
  // baseDmg 램프)만 스테이지별로 다르고 나머지(enemies/boss/art/
  // roomSize/reward)는 스테이지 1과 완전히 동일하다 — 실제 콘텐츠가
  // 정해지면 이 4개 항목을 교체해야 한다. baseHp/baseDmg 램프는 depth당
  // 증가폭(depthHpStep 0.17 / depthDmgStep 0.1)과 같은 폭을 스테이지
  // 단위로도 적용한 것으로, 실제 밸런스 수치가 아니라 전환 흐름 테스트용
  // placeholder다.
  {
    id: 2,
    name: '안개 습지 · 스테이지 2',
    normalRooms: 6,
    difficulty: { baseHp: 1.17, baseDmg: 1.1, depthHpStep: 0.17, depthDmgStep: 0.1 },
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
    difficulty: { baseHp: 1.34, baseDmg: 1.2, depthHpStep: 0.17, depthDmgStep: 0.1 },
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
    difficulty: { baseHp: 1.51, baseDmg: 1.3, depthHpStep: 0.17, depthDmgStep: 0.1 },
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
    difficulty: { baseHp: 1.68, baseDmg: 1.4, depthHpStep: 0.17, depthDmgStep: 0.1 },
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
    difficulty: { baseHp: 1.85, baseDmg: 1.5, depthHpStep: 0.17, depthDmgStep: 0.1 },
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
    difficulty: { baseHp: 2.02, baseDmg: 1.6, depthHpStep: 0.17, depthDmgStep: 0.1 },
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
 * 선형 분기 맵의 고정 구조(작업 지시 P7 커밋2) — 깊이는 항상 9.
 * 분기 깊이(1·2·3·5·6·7)에는 2~3개 선택지, 고정 깊이(4·8·9)에는 선택지가 없다.
 */
const BRANCH_DEPTHS = [1, 2, 3, 5, 6, 7]
const SHOP_DEPTH = 4
const REST_DEPTH = 8
const BOSS_DEPTH = 9

/**
 * 한 스테이지의 모든 방을 시작할 때 생성한다. 깊이 1~9의 선형 분기 그래프로
 * 배치되며(작업 지시 P7 커밋2), 한 번 지나간 방으로는 돌아갈 수 없다 —
 * 모든 연결이 단방향(부모→자식)이라 되돌아가기 자체가 구조적으로 불가능하다.
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
    return BOSS_DEPTH
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
    if (kind === 'shop') return { id, kind, enemies: [], chests: 0, x, y, depth, hasFountain: false, ...m }
    if (kind === 'rest') return { id, kind, enemies: [], chests: 0, x, y, depth, hasFountain: true, ...m }
    if (kind === 'recover') return { id, kind, enemies: [], chests: 0, x, y, depth, hasFountain: true, ...m }
    if (kind === 'elite') {
      const affix = rollEliteAffix(this.previousEliteAffix)
      this.previousEliteAffix = affix
      const count = Math.ceil((3 + depth * 1.4) * CONFIG.spawn.roomDensity)
      const enemies: RoomEnemy[] = []
      for (let i = 0; i < count; i++) {
        const e = this.enemiesFor(depth)
        enemies.push({ kind: e.kind, artSet: e.artSet })
      }
      return { id, kind, enemies, chests: 0, x, y, depth, hasFountain: false, affix, hpMul: m.hpMul * 1.45, dmgMul: m.dmgMul * 1.2, speedMul: m.speedMul * 1.08 }
    }
    if (kind === 'hardCombat') {
      // 상위 전투(작업 지시 P7 커밋2) — 원문은 "난이도 상승, 상위 등급 각인
      // 획득"이지만 각인 등급 체계는 아직 없다(P6 커밋4/5가 이 작업 다음
      // 순서로 예정돼 있다는 지시 자체가 근거). 등급으로 표현할 수 없어
      // 임시로 난이도(엘리트보다 낮게)와 선택지 수(엘리트와 동일 4장)로
      // "더 나은 보상"을 대신했다 — 등급이 생기면 이 자리를 대체해야
      // 한다. 최종 보고에서 별도로 짚는다.
      const count = Math.ceil((5 + Math.floor(depth * 1.2)) * CONFIG.spawn.roomDensity)
      const enemies: RoomEnemy[] = Array.from({ length: count }, () => {
        const e = this.enemiesFor(depth)
        return { kind: e.kind, artSet: e.artSet }
      })
      return { id, kind, enemies, chests: 0, x, y, depth, hasFountain: false, hpMul: m.hpMul * 1.25, dmgMul: m.dmgMul * 1.15, speedMul: m.speedMul * 1.04 }
    }

    // 'combat' | 'trait' — 각인 노드는 전투 구성 자체는 일반 전투와 같고
    // 보상만 다르다(클리어 시 자동 지급 — Game.onRoomClear()에서 분기).
    const count = Math.ceil((4 + Math.floor(depth * 1.2) + Math.floor(Math.random() * 3)) * CONFIG.spawn.roomDensity)
    const enemies: RoomEnemy[] = Array.from({ length: count }, () => {
      const e = this.enemiesFor(depth)
      return { kind: e.kind, artSet: e.artSet }
    })
    // 상자는 순수 '전투' 노드에만 둔다 — '각인' 노드는 클리어 시 이미 각인을
    // 확정 지급하므로, 상자가 또 특성을 얹으면 보상이 겹친다.
    const chests = kind === 'combat' && Math.random() < 0.4 ? 1 : 0
    return { id, kind, enemies, chests, x, y, depth, hasFountain: false, ...m }
  }

  private addNode(plan: RoomPlan) {
    this.nodes.set(plan.id, { plan, exits: {}, visited: false, cleared: false, usedObjects: new Set() })
  }

  /**
   * 한쪽으로만 연결한다 — 되돌아가기 완전 폐지(작업 지시 P7 커밋2). 예전
   * connect()는 양방향으로 이어(b.exits[OPPOSITE[direction]] = a.id) 인접한
   * 두 방을 서로 오갈 수 있게 했는데, 그게 되돌아가기가 가능했던 원인이다.
   * 이제는 부모→자식 한 방향만 기록되고, 자식의 exits는 자신이 다음 깊이로
   * 나갈 때만 채워진다 — 부모로 돌아가는 경로 자체가 그래프에 없다.
   */
  private connectForward(a: RoomNode, direction: Direction, b: RoomNode) {
    a.exits[direction] = b.plan.id
  }

  /**
   * 분기 깊이(1·2·3·5·6·7) 각각의 노드 종류를 먼저 확정한다 — 배치 규칙을
   * 확률이 아니라 개수 보장으로 만족시킨다(분수 배치에서 겪었던 "약 1.3%
   * 확률로 조건 미달" 결함과 같은 유형을 피하려는 것, DESIGN_LOG B5 참고).
   *
   * 규칙: 분기 깊이 6개 각각 2~3개 선택지 / 각인 노드(각인+상위 전투) 총
   * 2~4개, 서로 다른 깊이에 하나씩만 둬 "같은 깊이에 같은 종류 중복" 문제를
   * 원천적으로 피한다 / 회복 노드 최소 1개 / 상위 전투는 깊이 5 이상에서만 /
   * 같은 깊이의 선택지는 항상 서로 다른 종류.
   */
  private planBranchKinds(): Map<number, RoomKind[]> {
    const counts = new Map<number, number>()
    for (const d of BRANCH_DEPTHS) counts.set(d, Math.random() < 0.5 ? 2 : 3)

    const slots = new Map<number, (RoomKind | null)[]>()
    for (const d of BRANCH_DEPTHS) slots.set(d, new Array<RoomKind | null>(counts.get(d)!).fill(null))

    const usedAt = (d: number) => slots.get(d)!.filter((k): k is RoomKind => k !== null)
    const place = (d: number, kind: RoomKind) => {
      const arr = slots.get(d)!
      const free: number[] = []
      arr.forEach((v, i) => { if (v === null) free.push(i) })
      if (free.length === 0) return false
      arr[free[Math.floor(Math.random() * free.length)]] = kind
      return true
    }

    // 각인 계열(각인/상위 전투) — traitTarget(2~4)개를 서로 다른 깊이에
    // 하나씩 배정한다. 분기 깊이가 6개라 목표(최대 4)보다 항상 많아 반드시
    // 채워진다.
    const traitTarget = 2 + Math.floor(Math.random() * 3)
    const shuffledForTrait = [...BRANCH_DEPTHS].sort(() => Math.random() - 0.5)
    let traitPlaced = 0
    for (const d of shuffledForTrait) {
      if (traitPlaced >= traitTarget) break
      const kind: RoomKind = d >= 5 && Math.random() < 0.4 ? 'hardCombat' : 'trait'
      if (place(d, kind)) traitPlaced++
    }

    // 회복 노드 최소 1개.
    for (const d of [...BRANCH_DEPTHS].sort(() => Math.random() - 0.5)) {
      if (place(d, 'recover')) break
    }

    // 나머지 빈 슬롯 — 깊이별로 허용되는 종류 중 그 깊이에 아직 없는 것을 채운다.
    // 각인 계열(각인/상위 전투)은 위에서 이미 traitTarget만큼 정확히 배정했다 —
    // 여기 후보에 다시 넣으면 목표(2~4개) 이상으로 더 뽑혀버린다(실측 300회
    // 중 265회 위반 — 이 필터가 빠졌을 때 실제로 발생한 결함).
    const fillKinds: RoomKind[] = ['combat', 'elite', 'recover']
    for (const d of BRANCH_DEPTHS) {
      const arr = slots.get(d)!
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] !== null) continue
        const used = usedAt(d)
        const candidates = fillKinds.filter((k) => !used.includes(k))
        const pool = candidates.length > 0 ? candidates : (['combat'] as RoomKind[])
        arr[i] = pool[Math.floor(Math.random() * pool.length)]
      }
    }

    return slots as Map<number, RoomKind[]>
  }

  /**
   * 선형 분기 맵(작업 지시 P7 커밋2) — 깊이 1~9로 고정된다. 역할이 고정된
   * 깊이(4=상점, 8=보스 준비방, 9=보스)에는 선택지가 없고, 분기 깊이에는
   * planBranchKinds()가 보장한 2~3개 선택지가 있다.
   *
   * 깊이 0("로비")은 표에 없는 논리적 앵커다. 실제 방으로 렌더링하지 않고
   * 던전 입장 직후 첫 경로 카드의 출발점으로만 유지한다. 이를 남겨두면 맵
   * 연결·표본 검사·스테이지 전환 구조를 바꾸지 않으면서 플레이어 화면에서는
   * 깊이 1부터 바로 선택을 시작할 수 있다.
   *
   * 깊이 i의 모든 노드는 깊이 i+1의 모든 노드로 각각 연결된다 — 전부
   * connectForward(단방향)만 쓴다. 어느 노드를 골라도 다음 깊이의 모든
   * 선택지를 볼 수 있다: "선택"은 각 깊이에서 무엇을 겪을지에 있지, 그다음
   * 깊이 접근 자체를 좁히는 데 있지 않다.
   */
  private generateMap() {
    const lobby = this.makePlan('lobby', 0, 'combat', 0, 0)
    lobby.enemies = []
    this.addNode(lobby)

    const kindsByDepth = this.planBranchKinds()
    const nodesByDepth = new Map<number, RoomNode[]>()
    nodesByDepth.set(0, [this.nodes.get('lobby')!])

    for (const depth of BRANCH_DEPTHS) {
      const kinds = kindsByDepth.get(depth)!
      const nodes = kinds.map((kind, i) => {
        const plan = this.makePlan(`d${depth}-${i}`, depth, kind, depth, i)
        this.addNode(plan)
        return this.nodes.get(plan.id)!
      })
      nodesByDepth.set(depth, nodes)
    }
    for (const [depth, kind] of [[SHOP_DEPTH, 'shop'], [REST_DEPTH, 'rest'], [BOSS_DEPTH, 'boss']] as [number, RoomKind][]) {
      const plan = this.makePlan(`d${depth}-0`, depth, kind, depth, 0)
      this.addNode(plan)
      nodesByDepth.set(depth, [this.nodes.get(plan.id)!])
    }

    // direction은 미니맵 연결 슬롯 이름일 뿐, 물리적인 문 방향이 아니다.
    const routeSlots: Direction[] = ['north', 'east', 'west']
    for (let depth = 0; depth < BOSS_DEPTH; depth++) {
      const from = nodesByDepth.get(depth)!
      const to = nodesByDepth.get(depth + 1)!
      for (const a of from) {
        to.forEach((b, i) => this.connectForward(a, routeSlots[i % routeSlots.length], b))
      }
    }
  }

  /** 새 스테이지 지도 생성 후 진입 로비로 진입 */
  enterFirst(): RoomPlan {
    this.generateMap()
    return this.enter('lobby')
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
    // 로비는 경로 그래프의 루트로만 남기고 플레이어 미니맵에는 표시하지 않는다.
    return [...this.nodes.values()].filter((node) => node.plan.id !== 'lobby').map((node) => ({
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
