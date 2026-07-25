/**
 * 무기 정의 — 총(gun) / 검(sword) 종류.
 * Hades/뱀파이어서바이벌/위즈오브레전드 참고: 무기마다 다른 손맛 + 보스 보상으로 교체.
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface GunDef {
  kind: 'gun'
  id: string
  name: string
  icon: string
  rarity: Rarity
  desc: string
  damage: number
  cooldown: number // 발사 간격(초)
  bulletSpeed: number
  magSize: number
  reloadTime: number
  pellets: number // 한 번에 발사되는 탄 수
  spread: number
  pierce: number
}

export interface SwordDef {
  kind: 'sword'
  id: string
  name: string
  icon: string
  rarity: Rarity
  desc: string
  damage: number
  cooldown: number
  range: number
  arc: number // 부채꼴 각(라디안)
  knockback: number
  lunge: number
}

export type WeaponDef = GunDef | SwordDef

export const GUNS: GunDef[] = [
  {
    kind: 'gun', id: 'm1911', name: 'M1911', icon: '🔫', rarity: 'common',
    desc: '기본 권총 · 균형 잡힌 성능',
    damage: 12, cooldown: 0.15, bulletSpeed: 42, magSize: 7, reloadTime: 1.15, pellets: 1, spread: 0.03, pierce: 0,
  },
  {
    kind: 'gun', id: 'smg', name: '기관단총', icon: '⚡', rarity: 'rare',
    desc: '초고속 연사 · 낮은 데미지 · 큰 탄창',
    damage: 6, cooldown: 0.07, bulletSpeed: 40, magSize: 30, reloadTime: 1.5, pellets: 1, spread: 0.07, pierce: 0,
  },
  {
    kind: 'gun', id: 'shotgun', name: '산탄총', icon: '🔱', rarity: 'rare',
    desc: '한 번에 6발 · 근거리 광역',
    damage: 7, cooldown: 0.7, bulletSpeed: 34, magSize: 5, reloadTime: 1.8, pellets: 6, spread: 0.3, pierce: 0,
  },
  {
    kind: 'gun', id: 'rifle', name: '저격소총', icon: '🎯', rarity: 'epic',
    desc: '고속 관통탄 · 정확 · 높은 데미지',
    damage: 20, cooldown: 0.28, bulletSpeed: 62, magSize: 10, reloadTime: 1.6, pellets: 1, spread: 0.008, pierce: 2,
  },
  {
    kind: 'gun', id: 'magnum', name: '매그넘 리볼버', icon: '💥', rarity: 'epic',
    desc: '강력한 한 방 · 관통 · 느린 연사',
    damage: 34, cooldown: 0.5, bulletSpeed: 50, magSize: 6, reloadTime: 1.4, pellets: 1, spread: 0.01, pierce: 1,
  },
]

export const SWORDS: SwordDef[] = [
  {
    kind: 'sword', id: 'katana', name: '카타나', icon: '🗡️', rarity: 'common',
    desc: '기본 도 · 균형 잡힌 횡베기',
    damage: 34, cooldown: 0.42, range: 3.6, arc: Math.PI * 0.7, knockback: 9, lunge: 4.5,
  },
  {
    kind: 'sword', id: 'daggers', name: '쌍단검', icon: '🔪', rarity: 'rare',
    desc: '초고속 난도질 · 짧은 사거리',
    damage: 15, cooldown: 0.18, range: 2.7, arc: Math.PI * 0.6, knockback: 4, lunge: 6,
  },
  {
    kind: 'sword', id: 'rapier', name: '레이피어', icon: '🤺', rarity: 'rare',
    desc: '전방 찌르기 · 긴 사거리 · 좁은 각',
    damage: 40, cooldown: 0.34, range: 4.8, arc: Math.PI * 0.28, knockback: 6, lunge: 9,
  },
  {
    kind: 'sword', id: 'greatsword', name: '대검', icon: '⚔️', rarity: 'epic',
    desc: '광역 강타 · 느림 · 매우 높은 데미지',
    damage: 72, cooldown: 0.78, range: 4.3, arc: Math.PI * 0.95, knockback: 16, lunge: 3,
  },
  {
    kind: 'sword', id: 'warhammer', name: '전투 망치', icon: '🔨', rarity: 'epic',
    desc: '초강력 강타 + 강한 넉백 · 매우 느림',
    damage: 96, cooldown: 1.0, range: 3.9, arc: Math.PI, knockback: 28, lunge: 2,
  },
]

export const ALL_WEAPONS: WeaponDef[] = [...GUNS, ...SWORDS]

export function weaponById(id: string): WeaponDef | undefined {
  return ALL_WEAPONS.find((w) => w.id === id)
}

export const START_GUN = GUNS[0]
export const START_SWORD = SWORDS[0]

/** 보스 보상용: 현재 장착 무기를 제외한 랜덤 무기 count개 */
export function rollWeapons(count: number, exclude: string[] = []): WeaponDef[] {
  const pool = ALL_WEAPONS.filter((w) => !exclude.includes(w.id))
  const out: WeaponDef[] = []
  const tmp = [...pool]
  while (out.length < count && tmp.length) {
    const i = Math.floor(Math.random() * tmp.length)
    out.push(tmp.splice(i, 1)[0])
  }
  return out
}
