import { Player } from '../entities/Player'
import { Rarity } from './Weapons'

export interface Upgrade {
  id: string
  name: string
  desc: string
  icon: string
  rarity: Rarity
  maxStacks: number
  apply: (p: Player) => void
}

const DEFAULT_MAX_STACKS: Record<Rarity, number> = {
  common: 5,
  rare: 5,
  epic: 3,
  legendary: 1,
}

/** 특성 전체 풀 (mods를 수정하고 recompute) */
const RAW_POOL: Array<Omit<Upgrade, 'maxStacks'>> = [
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
  { id: 'xp_gain', name: '전투의 깨달음', desc: '경험치 획득량 +10%', icon: '📘', rarity: 'common',
    apply: (p) => { p.mods.xpGain *= 1.1; p.recompute() } },

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
  { id: 'reload', name: '신속 장전', desc: '장전 시간 -30%', icon: '🔁', rarity: 'rare',
    apply: (p) => { p.mods.reloadTime *= 0.7; p.recompute() } },
  { id: 'bullet_speed', name: '고속탄', desc: '탄속 +35%, 총 데미지 +10%', icon: '💨', rarity: 'rare',
    apply: (p) => { p.mods.bulletSpeed *= 1.35; p.mods.gunDamage *= 1.1; p.recompute() } },

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
  { id: 'lg_quickdraw', name: '⭐ 발도장전', desc: '검 적중 시 장전 1발→2발 · 장전 직후 3발 피해 +30%', icon: '🎴', rarity: 'legendary',
    apply: (p) => { p.mods.swordReloadAmount = 2; p.mods.swordReloadBurstBonus = 0.3; p.recompute() } },
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
  { id: 'lg_twinblade', name: '⭐ 쌍검무(雙劍舞)', desc: '검 연사 속도 +45%, 검 데미지 +15%', icon: '🌀', rarity: 'legendary',
    apply: (p) => { p.mods.swordCooldown *= 0.55; p.mods.swordDamage *= 1.15; p.recompute() } },
  { id: 'lg_gunsword', name: '⭐ 총검일체', desc: '총·검 데미지 +25%, 발도 시 총 즉시 장전', icon: '⚜️', rarity: 'legendary',
    apply: (p) => { p.mods.gunDamage *= 1.25; p.mods.swordDamage *= 1.25; p.mods.swordReloads = true; p.recompute() } },
]

const POOL: Upgrade[] = RAW_POOL.map((upgrade) => ({
  ...upgrade,
  maxStacks: DEFAULT_MAX_STACKS[upgrade.rarity],
}))

const WEIGHTS: Record<Rarity, number> = { common: 5, rare: 2.5, epic: 1, legendary: 0.4 }
const BOSS_WEIGHTS: Record<Rarity, number> = { common: 0, rare: 1.5, epic: 3, legendary: 2 }

function weightedPick(pool: Upgrade[], w: Record<Rarity, number>): Upgrade {
  const rarities = [...new Set(pool.map((u) => u.rarity))].filter((rarity) => w[rarity] > 0)
  const total = rarities.reduce((sum, rarity) => sum + w[rarity], 0)
  let r = Math.random() * total
  let chosenRarity = rarities[rarities.length - 1]
  for (const rarity of rarities) {
    r -= w[rarity]
    if (r <= 0) {
      chosenRarity = rarity
      break
    }
  }
  const candidates = pool.filter((u) => u.rarity === chosenRarity)
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/** 랜덤 특성 선택지 (boss=true면 고희귀 편향) */
export function rollChoices(count = 3, boss = false, traitStacks: ReadonlyMap<string, number> = new Map()): Upgrade[] {
  const w = boss ? BOSS_WEIGHTS : WEIGHTS
  const pool = POOL.filter((u) => w[u.rarity] > 0 && (traitStacks.get(u.id) ?? 0) < u.maxStacks)
  const chosen: Upgrade[] = []
  while (chosen.length < count && pool.length > 0) {
    const u = weightedPick(pool, w)
    chosen.push(u)
    pool.splice(pool.indexOf(u), 1)
  }
  return chosen
}

export function upgradeById(id: string): Upgrade | undefined {
  return POOL.find((u) => u.id === id)
}

/**
 * 던전 제련소용: currentId 특성과 같은 등급이면서, currentId 자신이 아니고,
 * 아직 maxStacks에 도달하지 않은 교체 후보 목록.
 */
export function forgeSwapCandidates(currentId: string, traitStacks: ReadonlyMap<string, number>): Upgrade[] {
  const current = upgradeById(currentId)
  if (!current) return []
  return POOL.filter(
    (u) => u.rarity === current.rarity && u.id !== currentId && (traitStacks.get(u.id) ?? 0) < u.maxStacks,
  )
}
