import { Player } from '../entities/Player'
import { Rarity } from './Weapons'

export interface Upgrade {
  id: string
  name: string
  desc: string
  icon: string
  rarity: Rarity
  apply: (p: Player) => void
}

/** 특성 전체 풀 (mods를 수정하고 recompute) */
const POOL: Upgrade[] = [
  // ── Common ──
  { id: 'gun_dmg', name: '강선 탄환', desc: '총 데미지 +25%', icon: '🔫', rarity: 'common',
    apply: (p) => { p.mods.gunDamage *= 1.25; p.recompute() } },
  { id: 'gun_rof', name: '속사', desc: '총 연사 속도 +20%', icon: '⚡', rarity: 'common',
    apply: (p) => { p.mods.gunCooldown *= 0.8; p.recompute() } },
  { id: 'sword_dmg', name: '요도(妖刀)', desc: '검 데미지 +30%', icon: '🗡️', rarity: 'common',
    apply: (p) => { p.mods.swordDamage *= 1.3; p.recompute() } },
  { id: 'speed', name: '경신법', desc: '이동 속도 +15%', icon: '👟', rarity: 'common',
    apply: (p) => { p.mods.moveSpeed *= 1.15; p.recompute() } },
  { id: 'hp', name: '강인한 육체', desc: '최대 체력 +25, 완전 회복', icon: '❤️', rarity: 'common',
    apply: (p) => { p.mods.maxHp += 25; p.recompute(); p.hp = p.stats.maxHp } },
  { id: 'magnet', name: '자력장', desc: '경험치 흡수 범위 +60%', icon: '🧲', rarity: 'common',
    apply: (p) => { p.mods.magnetRange *= 1.6; p.recompute() } },

  // ── Rare ──
  { id: 'pierce', name: '관통탄', desc: '탄환이 적 +1명 관통', icon: '➤', rarity: 'rare',
    apply: (p) => { p.mods.pierce += 1; p.recompute() } },
  { id: 'sword_range', name: '발도 확장', desc: '검 사거리 +25%, 쿨감 -10%', icon: '⚔️', rarity: 'rare',
    apply: (p) => { p.mods.swordRange *= 1.25; p.mods.swordCooldown *= 0.9; p.recompute() } },
  { id: 'crit', name: '급소 간파', desc: '치명타 확률 +12%', icon: '💥', rarity: 'rare',
    apply: (p) => { p.mods.critChance += 0.12; p.recompute() } },
  { id: 'crit_dmg', name: '처형인', desc: '치명타 배율 +0.6', icon: '☠️', rarity: 'rare',
    apply: (p) => { p.mods.critMult += 0.6; p.recompute() } },
  { id: 'dash_cd', name: '연막 회피', desc: '대시 쿨타임 -25%', icon: '🌫️', rarity: 'rare',
    apply: (p) => { p.mods.dashCooldown *= 0.75; p.recompute() } },

  // ── Epic ──
  { id: 'multishot', name: '멀티샷', desc: '발사 탄환 +1', icon: '🎯', rarity: 'epic',
    apply: (p) => { p.mods.multishot += 1; p.recompute() } },
  { id: 'lifesteal', name: '흡혈', desc: '가한 피해의 5% 회복', icon: '🩸', rarity: 'epic',
    apply: (p) => { p.mods.lifesteal += 0.05; p.recompute() } },
  { id: 'berserk', name: '광전사', desc: '총·검 데미지 +20%, 최대체력 -10', icon: '😤', rarity: 'epic',
    apply: (p) => { p.mods.gunDamage *= 1.2; p.mods.swordDamage *= 1.2; p.mods.maxHp -= 10; p.recompute() } },

  // ── Legendary ──
  { id: 'lg_detonator', name: '⭐ 폭심(爆心)', desc: '적 처치 시 폭발로 주변에 피해', icon: '💣', rarity: 'legendary',
    apply: (p) => { p.mods.explodeOnKill += 26; p.recompute() } },
  { id: 'lg_quickdraw', name: '⭐ 발도장전', desc: '검을 휘두르면 총 즉시 장전 · 검뎀 +20%', icon: '🎴', rarity: 'legendary',
    apply: (p) => { p.mods.swordReloads = true; p.mods.swordDamage *= 1.2; p.recompute() } },
  { id: 'lg_vampire', name: '⭐ 흡혈귀', desc: '흡혈 +10%, 최대 체력 +40', icon: '🧛', rarity: 'legendary',
    apply: (p) => { p.mods.lifesteal += 0.1; p.mods.maxHp += 40; p.recompute(); p.hp = p.stats.maxHp } },
  { id: 'lg_executioner', name: '⭐ 처형자', desc: '치명타 확률 +20%, 배율 +1.0', icon: '🔱', rarity: 'legendary',
    apply: (p) => { p.mods.critChance += 0.2; p.mods.critMult += 1; p.recompute() } },
  { id: 'lg_gale', name: '⭐ 질풍(疾風)', desc: '이동 속도 +25%, 대시 쿨 -45%', icon: '🌀', rarity: 'legendary',
    apply: (p) => { p.mods.moveSpeed *= 1.25; p.mods.dashCooldown *= 0.55; p.recompute() } },
  { id: 'lg_storm', name: '⭐ 폭풍탄막', desc: '발사 탄환 +2', icon: '🌪️', rarity: 'legendary',
    apply: (p) => { p.mods.multishot += 2; p.recompute() } },
  { id: 'lg_pierce', name: '⭐ 관통의 룬', desc: '관통 +3, 탄속 +40%', icon: '🏹', rarity: 'legendary',
    apply: (p) => { p.mods.pierce += 3; p.mods.bulletSpeed *= 1.4; p.recompute() } },
  { id: 'lg_blink', name: '⭐ 섬광강타', desc: '대시 종료 시 주변에 폭발 피해', icon: '⚡', rarity: 'legendary',
    apply: (p) => { p.mods.dashStrike += 44; p.recompute() } },
]

const WEIGHTS: Record<Rarity, number> = { common: 5, rare: 2.5, epic: 1, legendary: 0.4 }
const BOSS_WEIGHTS: Record<Rarity, number> = { common: 0, rare: 1.5, epic: 3, legendary: 2 }

function weightedPick(pool: Upgrade[], w: Record<Rarity, number>): Upgrade {
  const total = pool.reduce((s, u) => s + w[u.rarity], 0)
  let r = Math.random() * total
  for (const u of pool) {
    r -= w[u.rarity]
    if (r <= 0) return u
  }
  return pool[pool.length - 1]
}

/** 랜덤 특성 선택지 (boss=true면 고희귀 편향) */
export function rollChoices(count = 3, boss = false): Upgrade[] {
  const w = boss ? BOSS_WEIGHTS : WEIGHTS
  const pool = POOL.filter((u) => w[u.rarity] > 0)
  const chosen: Upgrade[] = []
  while (chosen.length < count && pool.length > 0) {
    const u = weightedPick(pool, w)
    chosen.push(u)
    pool.splice(pool.indexOf(u), 1)
  }
  return chosen
}
