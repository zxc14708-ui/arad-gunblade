import { Upgrade, rollChoices } from './Upgrades'
import { WeaponDef, rollWeapons, Rarity } from './Weapons'

export type ShopItem =
  | { type: 'weapon'; def: WeaponDef; price: number; sold: boolean }
  | { type: 'trait'; def: Upgrade; price: number; sold: boolean }
  | { type: 'heal'; amount: number; price: number; sold: boolean }

/** 희귀도별 기본 가격 */
const PRICE: Record<Rarity, number> = { common: 35, rare: 60, epic: 95, legendary: 150 }
export const REROLL_COST = 25

function jitter(base: number) {
  return Math.round((base * (0.9 + Math.random() * 0.25)) / 5) * 5
}

/**
 * 상점 재고 생성 — 무기 2개 + 특성 2개 + 회복 1개.
 * 골드를 소모해 재고를 리셋(리롤)할 수 있다.
 */
export class Shop {
  items: ShopItem[] = []
  rerollCount = 0

  constructor(excludeWeaponIds: string[] = []) {
    this.restock(excludeWeaponIds)
  }

  restock(excludeWeaponIds: string[] = []) {
    const weapons = rollWeapons(2, excludeWeaponIds)
    const traits = rollChoices(2)
    this.items = [
      ...weapons.map<ShopItem>((w) => ({ type: 'weapon', def: w, price: jitter(PRICE[w.rarity]), sold: false })),
      ...traits.map<ShopItem>((t) => ({ type: 'trait', def: t, price: jitter(PRICE[t.rarity]), sold: false })),
      { type: 'heal', amount: 40, price: 30, sold: false },
    ]
  }

  /** 리롤 비용 (횟수마다 증가) */
  get rerollPrice() {
    return REROLL_COST + this.rerollCount * 15
  }

  reroll(excludeWeaponIds: string[] = []) {
    this.rerollCount++
    this.restock(excludeWeaponIds)
  }
}
