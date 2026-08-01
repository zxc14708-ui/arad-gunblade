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

export interface RoomPlan {
  id: string
  kind: RoomKind
  enemies: EnemyKind[]
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

export const STAGES = [
  {
    name: '검은 숲 지하',
    normalRooms: 6,
    baseHp: 1.0,
    baseDmg: 1.0,
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

  private muls(depth: number) {
    const c = this.cfg
    return {
      hpMul: c.baseHp * (1 + (depth - 1) * 0.17),
      dmgMul: c.baseDmg * (1 + (depth - 1) * 0.1),
      speedMul: Math.min(1.7, 1 + (depth - 1) * 0.035),
    }
  }

  private makePlan(id: string, depth: number, kind: RoomKind, x: number, y: number): RoomPlan {
    const m = this.muls(depth)
    if (kind === 'boss') {
      const adds: EnemyKind[] = ['imp', 'imp', 'brute', 'shooter', 'shooter']
      return { id, kind, enemies: ['boss', ...adds], chests: 0, x, y, depth, hasFountain: false, ...m }
    }
    if (kind === 'shop' || kind === 'rest') return { id, kind, enemies: [], chests: 0, x, y, depth, hasFountain: true, ...m }
    if (kind === 'elite') {
      const affix = rollEliteAffix(this.previousEliteAffix)
      this.previousEliteAffix = affix
      const count = Math.ceil((3 + depth * 1.4) * CONFIG.spawn.roomDensity)
      const enemies: EnemyKind[] = []
      for (let i = 0; i < count; i++) {
        if (i === 0 || (depth >= 3 && Math.random() < 0.38)) enemies.push('brute')
        else if (Math.random() < 0.55) enemies.push('shooter')
        else enemies.push('imp')
      }
      return { id, kind, enemies, chests: 0, x, y, depth, hasFountain: false, affix, hpMul: m.hpMul * 1.45, dmgMul: m.dmgMul * 1.2, speedMul: m.speedMul * 1.08 }
    }
    if (kind === 'treasure') {
      const n = Math.max(2, Math.ceil((1 + Math.floor(Math.random() * 2)) * CONFIG.spawn.roomDensity))
      const enemies: EnemyKind[] = Array.from({ length: n }, () => (Math.random() < 0.5 ? 'imp' : 'shooter'))
      return { id, kind, enemies, chests: 2, x, y, depth, hasFountain: false, ...m }
    }

    const count = Math.ceil((4 + Math.floor(depth * 1.2) + Math.floor(Math.random() * 3)) * CONFIG.spawn.roomDensity)
    const enemies: EnemyKind[] = []
    for (let i = 0; i < count; i++) {
      const r = Math.random()
      if (depth >= 3 && r < 0.2) enemies.push('brute')
      else if (depth >= 2 && r < 0.5) enemies.push('shooter')
      else enemies.push('imp')
    }
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
