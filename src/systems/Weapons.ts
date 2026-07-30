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
    damage: 15, cooldown: 0.15, bulletSpeed: 42, magSize: 7, reloadTime: 1.15, pellets: 1, spread: 0.03, pierce: 0,
  },
  {
    kind: 'gun', id: 'smg', name: '기관단총', icon: '⚡', rarity: 'rare',
    desc: '초고속 연사 · 낮은 데미지 · 큰 탄창',
    damage: 8, cooldown: 0.07, bulletSpeed: 40, magSize: 30, reloadTime: 1.5, pellets: 1, spread: 0.07, pierce: 0,
  },
  {
    kind: 'gun', id: 'shotgun', name: '산탄총', icon: '🔱', rarity: 'rare',
    desc: '한 번에 6발 · 근거리 광역',
    damage: 9, cooldown: 0.7, bulletSpeed: 34, magSize: 5, reloadTime: 1.8, pellets: 6, spread: 0.3, pierce: 0,
  },
  {
    kind: 'gun', id: 'rifle', name: '저격소총', icon: '🎯', rarity: 'epic',
    desc: '스코프 관통탄 · 5발 장전 · 3명 관통',
    damage: 50, cooldown: 0.56, bulletSpeed: 62, magSize: 5, reloadTime: 3.2, pellets: 1, spread: 0.008, pierce: 3,
  },
  {
    kind: 'gun', id: 'magnum', name: '매그넘 리볼버', icon: '💥', rarity: 'epic',
    desc: '강력한 한 방 · 관통 · 느린 연사',
    damage: 43, cooldown: 0.5, bulletSpeed: 50, magSize: 6, reloadTime: 1.4, pellets: 1, spread: 0.01, pierce: 1,
  },
  {
    kind: 'gun', id: 'crossbow', name: '연발 석궁', icon: '🏹', rarity: 'rare',
    desc: '강한 관통 볼트 · 중간 연사',
    damage: 28, cooldown: 0.4, bulletSpeed: 46, magSize: 8, reloadTime: 1.5, pellets: 1, spread: 0.015, pierce: 3,
  },
  {
    kind: 'gun', id: 'autocannon', name: '오토캐논', icon: '🚀', rarity: 'legendary',
    desc: '폭발적 연사 + 관통 + 대용량 탄창',
    damage: 14, cooldown: 0.09, bulletSpeed: 52, magSize: 40, reloadTime: 1.7, pellets: 1, spread: 0.05, pierce: 1,
  },
]

export const SWORDS: SwordDef[] = [
  {
    kind: 'sword', id: 'katana', name: '카타나', icon: '🗡️', rarity: 'common',
    desc: '기본 도 · 균형 잡힌 횡베기',
    damage: 27, cooldown: 0.42, range: 3.6, arc: Math.PI * 0.7, knockback: 9, lunge: 4.5,
  },
  {
    kind: 'sword', id: 'daggers', name: '한손검', icon: '🗡️', rarity: 'rare',
    desc: '초고속 연속 베기 · 짧은 사거리',
    damage: 12, cooldown: 0.18, range: 2.7, arc: Math.PI * 0.6, knockback: 4, lunge: 6,
  },
  {
    kind: 'sword', id: 'rapier', name: '레이피어', icon: '🤺', rarity: 'rare',
    desc: '전방 찌르기 · 긴 사거리 · 좁은 각',
    damage: 32, cooldown: 0.34, range: 4.8, arc: Math.PI * 0.28, knockback: 6, lunge: 9,
  },
  {
    kind: 'sword', id: 'greatsword', name: '대검', icon: '⚔️', rarity: 'epic',
    desc: '광역 강타 · 느림 · 매우 높은 데미지',
    damage: 58, cooldown: 0.78, range: 4.3, arc: Math.PI * 0.95, knockback: 16, lunge: 3,
  },
  {
    kind: 'sword', id: 'warhammer', name: '전투 망치', icon: '🔨', rarity: 'epic',
    desc: '초강력 강타 + 강한 넉백 · 매우 느림',
    damage: 77, cooldown: 1.0, range: 3.9, arc: Math.PI, knockback: 28, lunge: 2,
  },
  {
    kind: 'sword', id: 'glaive', name: '언월도', icon: '🌙', rarity: 'rare',
    desc: '전방위 광역 베기 · 넓은 사거리',
    damage: 35, cooldown: 0.5, range: 4.4, arc: Math.PI * 1.4, knockback: 10, lunge: 4,
  },
  {
    kind: 'sword', id: 'moonblade', name: '월광검(月光劍)', icon: '🗡️', rarity: 'legendary',
    desc: '초광역 360° 참격 · 빠름 · 강력',
    damage: 46, cooldown: 0.4, range: 4.6, arc: Math.PI * 1.9, knockback: 12, lunge: 5,
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
