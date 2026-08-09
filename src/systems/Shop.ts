import { Upgrade, rollChoices, CoreSlot, isSigilSlot } from './Upgrades'
import { WeaponDef, rollWeapons, Rarity } from './Weapons'

export type ShopItem =
  | { type: 'weapon'; def: WeaponDef; price: number; sold: boolean }
  | { type: 'trait'; def: Upgrade; price: number; sold: boolean }
  | { type: 'heal'; amount: number; price: number; sold: boolean }

/** 무기 가격은 계속 등급 기준이다(작업 지시: 건드리지 말 것) */
const PRICE: Record<Rarity, number> = { common: 35, rare: 60, epic: 95, legendary: 150 }
/** 특성 가격은 등급이 아니라 슬롯 기준 — 핵심 슬롯(gun/sword/character) 90G, 각인 45G */
const TRAIT_PRICE = { core: 90, sigil: 45 }
export const REROLL_COST = 25

function jitter(base: number) {
  return Math.round((base * (0.9 + Math.random() * 0.25)) / 5) * 5
}

function traitPrice(t: Upgrade) {
  return jitter(isSigilSlot(t.slot) ? TRAIT_PRICE.sigil : TRAIT_PRICE.core)
}

/**
 * 상점 재고 생성 — 무기 2개 + 특성 2개 + 회복 1개.
 * 골드를 소모해 재고를 리셋(리롤)할 수 있다.
 */
export class Shop {
  items: ShopItem[] = []
  rerollCount = 0
  private traitStacks: ReadonlyMap<string, number>
  private coreSlots: ReadonlyMap<CoreSlot, string>

  constructor(
    excludeWeaponIds: string[] = [],
    traitStacks: ReadonlyMap<string, number> = new Map(),
    coreSlots: ReadonlyMap<CoreSlot, string> = new Map(),
  ) {
    this.traitStacks = traitStacks
    this.coreSlots = coreSlots
    this.restock(excludeWeaponIds, traitStacks, coreSlots)
  }

  restock(excludeWeaponIds: string[] = [], traitStacks = this.traitStacks, coreSlots = this.coreSlots) {
    const weapons = rollWeapons(2, excludeWeaponIds)
    const traits = rollChoices(2, traitStacks, coreSlots)
    this.items = [
      ...weapons.map<ShopItem>((w) => ({ type: 'weapon', def: w, price: jitter(PRICE[w.rarity]), sold: false })),
      ...traits.map<ShopItem>((t) => ({ type: 'trait', def: t, price: traitPrice(t), sold: false })),
      { type: 'heal', amount: 40, price: 30, sold: false },
    ]
  }

  /** 리롤 비용 (횟수마다 증가) */
  get rerollPrice() {
    return REROLL_COST + this.rerollCount * 15
  }

  reroll(excludeWeaponIds: string[] = [], traitStacks = this.traitStacks, coreSlots = this.coreSlots) {
    this.rerollCount++
    this.restock(excludeWeaponIds, traitStacks, coreSlots)
  }
}
