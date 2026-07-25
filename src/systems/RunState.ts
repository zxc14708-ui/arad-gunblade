import { EnemyKind } from '../entities/Enemy'

export type RoomKind = 'combat' | 'treasure' | 'shop' | 'boss'

export interface RoomPlan {
  kind: RoomKind
  /** 이 방에서 스폰할 적 목록 (전투/보스방) */
  enemies: EnemyKind[]
  /** 보물상자 개수 */
  chests: number
  /** 난이도 배수 */
  hpMul: number
  dmgMul: number
  speedMul: number
}

export const ROOM_LABEL: Record<RoomKind, string> = {
  combat: '전투',
  treasure: '보물',
  shop: '상점',
  boss: '보스',
}
export const ROOM_ICON: Record<RoomKind, string> = {
  combat: '⚔️',
  treasure: '💰',
  shop: '🛒',
  boss: '💀',
}

/** 스테이지별 설정 (현재 1스테이지만) */
const STAGES = [
  {
    name: '검은 숲 지하',
    /** 보스 전까지 일반 방 수 */
    normalRooms: 6,
    baseHp: 1.0,
    baseDmg: 1.0,
  },
]

/**
 * 한 번의 던전 런 상태.
 * 방 구성은 매 판 랜덤 — 진행할 때마다 다음 방 후보(문 선택지)를 새로 뽑는다.
 * 구조: 일반 방 N개 → 상점/휴식 방 → 보스 방
 */
export class RunState {
  stage = 1
  /** 현재 방 깊이 (1부터). 0 = 아직 입장 전 */
  depth = 0
  gold = 0
  roomsCleared = 0
  /** 현재 방 계획 */
  current: RoomPlan | null = null
  /** 다음 방 후보 (문 선택지) */
  choices: RoomPlan[] = []

  get cfg() {
    return STAGES[Math.min(this.stage - 1, STAGES.length - 1)]
  }
  /** 보스 방 깊이 */
  get bossDepth() {
    return this.cfg.normalRooms + 2 // 일반 N + 상점 1 + 보스
  }
  get shopDepth() {
    return this.cfg.normalRooms + 1
  }
  get isBossRoom() {
    return this.current?.kind === 'boss'
  }

  reset(stage = 1) {
    this.stage = stage
    this.depth = 0
    this.gold = 0
    this.roomsCleared = 0
    this.current = null
    this.choices = []
  }

  /** 난이도 배수 (깊이에 따라 상승) */
  private muls(depth: number) {
    const c = this.cfg
    return {
      hpMul: c.baseHp * (1 + (depth - 1) * 0.17),
      dmgMul: c.baseDmg * (1 + (depth - 1) * 0.1),
      speedMul: Math.min(1.7, 1 + (depth - 1) * 0.035),
    }
  }

  /** 지정 깊이의 방 계획 생성 (랜덤) */
  private makePlan(depth: number, kind: RoomKind): RoomPlan {
    const m = this.muls(depth)
    if (kind === 'boss') {
      const adds: EnemyKind[] = ['imp', 'imp', 'shooter']
      return { kind, enemies: ['boss', ...adds], chests: 0, ...m }
    }
    if (kind === 'shop') {
      return { kind, enemies: [], chests: 0, ...m }
    }
    if (kind === 'treasure') {
      // 보물방: 적 소수 + 상자 2개
      const n = 1 + Math.floor(Math.random() * 2)
      const enemies: EnemyKind[] = Array.from({ length: n }, () => (Math.random() < 0.5 ? 'imp' : 'shooter'))
      return { kind, enemies, chests: 2, ...m }
    }
    // 전투방: 깊이에 따라 적 수/종류 증가
    const count = 4 + Math.floor(depth * 1.2) + Math.floor(Math.random() * 3)
    const enemies: EnemyKind[] = []
    for (let i = 0; i < count; i++) {
      const r = Math.random()
      if (depth >= 3 && r < 0.16) enemies.push('brute')
      else if (depth >= 2 && r < 0.42) enemies.push('shooter')
      else enemies.push('imp')
    }
    // 전투방도 낮은 확률로 상자 1개
    const chests = Math.random() < 0.35 ? 1 : 0
    return { kind, enemies, chests, ...m }
  }

  /** 다음 방 후보(문 선택지) 생성. 상점/보스 깊이는 고정. */
  rollChoices(): RoomPlan[] {
    const next = this.depth + 1
    if (next === this.bossDepth) {
      this.choices = [this.makePlan(next, 'boss')]
    } else if (next === this.shopDepth) {
      this.choices = [this.makePlan(next, 'shop')]
    } else {
      // 2개 선택지: 전투 / 보물 랜덤 (하데스식 문 선택)
      const kinds: RoomKind[] = Math.random() < 0.5 ? ['combat', 'treasure'] : ['treasure', 'combat']
      if (Math.random() < 0.35) kinds[1] = 'combat' // 전투 2개인 경우도
      this.choices = kinds.map((k) => this.makePlan(next, k))
    }
    return this.choices
  }

  /** 선택지 중 하나로 입장 */
  enter(index: number): RoomPlan {
    const plan = this.choices[index] ?? this.choices[0]
    this.depth += 1
    this.current = plan
    this.choices = []
    return plan
  }

  /** 첫 방 입장 (전투방 고정) */
  enterFirst(): RoomPlan {
    this.depth = 1
    this.current = this.makePlan(1, 'combat')
    this.choices = []
    return this.current
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
