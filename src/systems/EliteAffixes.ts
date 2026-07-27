export type EliteAffix = 'regen' | 'swift' | 'thorns' | 'split' | 'volatile' | 'ward'

export const ELITE_AFFIXES: EliteAffix[] = ['regen', 'swift', 'thorns', 'split', 'volatile', 'ward']

export const ELITE_AFFIX = {
  regen: {
    name: '재생',
    color: 0x6fd36f,
    delay: 2,
    healPerSecond: 0.03,
    effectInterval: 1,
  },
  swift: {
    name: '신속',
    color: 0x75cef4,
    speedMultiplier: 1.5,
    hpMultiplier: 0.7,
  },
  thorns: {
    name: '가시',
    color: 0xf39a49,
    reflectRatio: 0.25,
  },
  split: {
    name: '분열',
    color: 0xdf4fc7,
    childCount: 2,
    hpMultiplier: 0.35,
    scaleMultiplier: 0.65,
  },
  volatile: {
    name: '폭발',
    color: 0xe34c4c,
    radius: 4,
    damageMultiplier: 1.2,
  },
  ward: {
    name: '보호막',
    color: 0x36d2c7,
    maxHpRatio: 0.4,
    rechargeDelay: 3,
  },
} as const

export function rollEliteAffix(exclude?: EliteAffix): EliteAffix {
  const candidates = exclude ? ELITE_AFFIXES.filter((affix) => affix !== exclude) : ELITE_AFFIXES
  return candidates[Math.floor(Math.random() * candidates.length)]
}
