export type EliteAffix = 'regen' | 'swift' | 'thorns'

export const ELITE_AFFIXES: EliteAffix[] = ['regen', 'swift', 'thorns']

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
} as const

export function rollEliteAffix(exclude?: EliteAffix): EliteAffix {
  const candidates = exclude ? ELITE_AFFIXES.filter((affix) => affix !== exclude) : ELITE_AFFIXES
  return candidates[Math.floor(Math.random() * candidates.length)]
}
