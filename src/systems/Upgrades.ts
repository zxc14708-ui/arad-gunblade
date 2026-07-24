import { Player } from '../entities/Player'

export interface Upgrade {
  id: string
  name: string
  desc: string
  icon: string
  rarity: 'common' | 'rare' | 'epic'
  apply: (p: Player) => void
}

/** 업그레이드 전체 풀 */
const POOL: Upgrade[] = [
  {
    id: 'gun_dmg',
    name: '강선 탄환',
    desc: '총 데미지 +25%',
    icon: '🔫',
    rarity: 'common',
    apply: (p) => (p.stats.gunDamage *= 1.25),
  },
  {
    id: 'gun_rof',
    name: '속사',
    desc: '총 연사 속도 +20%',
    icon: '⚡',
    rarity: 'common',
    apply: (p) => (p.stats.gunCooldown *= 0.8),
  },
  {
    id: 'multishot',
    name: '멀티샷',
    desc: '발사 탄환 +1',
    icon: '🎯',
    rarity: 'epic',
    apply: (p) => (p.stats.multishot += 1),
  },
  {
    id: 'pierce',
    name: '관통탄',
    desc: '탄환이 적 +1명 관통',
    icon: '➤',
    rarity: 'rare',
    apply: (p) => (p.stats.pierce += 1),
  },
  {
    id: 'sword_dmg',
    name: '요도(妖刀)',
    desc: '검 데미지 +30%',
    icon: '🗡️',
    rarity: 'common',
    apply: (p) => (p.stats.swordDamage *= 1.3),
  },
  {
    id: 'sword_range',
    name: '발도 확장',
    desc: '검 사거리 +25%, 쿨감 -10%',
    icon: '⚔️',
    rarity: 'rare',
    apply: (p) => {
      p.stats.swordRange *= 1.25
      p.stats.swordCooldown *= 0.9
    },
  },
  {
    id: 'crit',
    name: '급소 간파',
    desc: '치명타 확률 +12%',
    icon: '💥',
    rarity: 'rare',
    apply: (p) => (p.stats.critChance = Math.min(1, p.stats.critChance + 0.12)),
  },
  {
    id: 'crit_dmg',
    name: '처형인',
    desc: '치명타 배율 +0.6',
    icon: '☠️',
    rarity: 'rare',
    apply: (p) => (p.stats.critMult += 0.6),
  },
  {
    id: 'speed',
    name: '경신법',
    desc: '이동 속도 +15%',
    icon: '👟',
    rarity: 'common',
    apply: (p) => (p.stats.moveSpeed *= 1.15),
  },
  {
    id: 'hp',
    name: '강인한 육체',
    desc: '최대 체력 +25, 완전 회복',
    icon: '❤️',
    rarity: 'common',
    apply: (p) => {
      p.stats.maxHp += 25
      p.hp = p.stats.maxHp
    },
  },
  {
    id: 'lifesteal',
    name: '흡혈',
    desc: '가한 피해의 5% 회복',
    icon: '🩸',
    rarity: 'epic',
    apply: (p) => (p.stats.lifesteal += 0.05),
  },
  {
    id: 'magnet',
    name: '자력장',
    desc: '경험치 흡수 범위 +60%',
    icon: '🧲',
    rarity: 'common',
    apply: (p) => (p.stats.magnetRange *= 1.6),
  },
]

/** 랜덤 3개 선택지 뽑기 (가중치: common이 더 자주) */
export function rollChoices(count = 3): Upgrade[] {
  const weights: Record<Upgrade['rarity'], number> = { common: 5, rare: 2.5, epic: 1 }
  const pool = [...POOL]
  const chosen: Upgrade[] = []
  while (chosen.length < count && pool.length > 0) {
    const total = pool.reduce((s, u) => s + weights[u.rarity], 0)
    let r = Math.random() * total
    let idx = 0
    for (let i = 0; i < pool.length; i++) {
      r -= weights[pool[i].rarity]
      if (r <= 0) {
        idx = i
        break
      }
    }
    chosen.push(pool[idx])
    pool.splice(idx, 1)
  }
  return chosen
}
