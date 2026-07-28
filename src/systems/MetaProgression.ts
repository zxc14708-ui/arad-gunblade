import { CONFIG } from '../config'
import { GUNS, SWORDS, WeaponDef, weaponById } from './Weapons'

export type CrystalKind = 'faint' | 'decent' | 'strong'
export type MetaUpgradeId = 'gunMastery' | 'swordMastery' | 'vitality' | 'revive' | 'ward'

export interface MetaProfile {
  version: 1
  crystals: Record<CrystalKind, number>
  tokens: number
  upgrades: Record<MetaUpgradeId, number>
  unlockedWeapons: string[]
  loadout: { gunId: string; swordId: string }
}

export interface MetaBonuses {
  gunDamageMultiplier: number
  swordDamageMultiplier: number
  maxHpFlat: number
  revives: number
  wardReady: boolean
}

export interface MetaReward {
  faint: number
  decent: number
  strong: number
  tokens: number
}

export interface MetaUpgradeView {
  id: MetaUpgradeId
  icon: string
  name: string
  desc: string
  rank: number
  maxRank: number
  cost: Partial<Record<CrystalKind, number>> | null
  affordable: boolean
}

export interface MetaWeaponView {
  def: WeaponDef
  price: number
  unlocked: boolean
  affordable: boolean
}

const STORAGE_KEY = 'arad-gunblade.meta.v1'
const CRYSTALS: CrystalKind[] = ['faint', 'decent', 'strong']
const UPGRADE_IDS: MetaUpgradeId[] = ['gunMastery', 'swordMastery', 'vitality', 'revive', 'ward']

const UPGRADE_INFO: Record<MetaUpgradeId, { icon: string; name: string; desc: string; maxRank: number }> = {
  gunMastery: { icon: '🔫', name: '사격 숙련', desc: '총 공격력 +4% / 단계', maxRank: 5 },
  swordMastery: { icon: '⚔️', name: '검술 숙련', desc: '칼 공격력 +4% / 단계', maxRank: 5 },
  vitality: { icon: '❤', name: '생명력 단련', desc: '최대 생명력 +10 / 단계', maxRank: 5 },
  revive: { icon: '✦', name: '불굴', desc: '런당 1회, 체력 50%로 부활', maxRank: 1 },
  ward: { icon: '◈', name: '수호막', desc: '매 런 첫 피해 1회를 무효화', maxRank: 1 },
}

function freshProfile(): MetaProfile {
  return {
    version: 1,
    crystals: { faint: 0, decent: 0, strong: 0 },
    tokens: 0,
    upgrades: { gunMastery: 0, swordMastery: 0, vitality: 0, revive: 0, ward: 0 },
    unlockedWeapons: ['m1911', 'katana'],
    loadout: { gunId: 'm1911', swordId: 'katana' },
  }
}

function numberOrZero(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/** Browser-local permanent progression. Cloud sync can replace only this storage boundary later. */
export class MetaProgression {
  private profile: MetaProfile

  constructor() {
    this.profile = this.load()
  }

  get snapshot(): MetaProfile {
    return {
      ...this.profile,
      crystals: { ...this.profile.crystals },
      upgrades: { ...this.profile.upgrades },
      unlockedWeapons: [...this.profile.unlockedWeapons],
      loadout: { ...this.profile.loadout },
    }
  }

  bonuses(): MetaBonuses {
    const u = this.profile.upgrades
    return {
      gunDamageMultiplier: 1 + u.gunMastery * CONFIG.meta.altar.damagePerRank,
      swordDamageMultiplier: 1 + u.swordMastery * CONFIG.meta.altar.damagePerRank,
      maxHpFlat: u.vitality * CONFIG.meta.altar.maxHpPerRank,
      revives: u.revive,
      wardReady: u.ward > 0,
    }
  }

  grantStageClear(): MetaReward {
    const reward = { ...CONFIG.meta.rewards.stageClear }
    this.profile.crystals.faint += reward.faint
    this.profile.crystals.decent += reward.decent
    this.profile.crystals.strong += reward.strong
    this.profile.tokens += reward.tokens
    this.save()
    return reward
  }

  grantEliteToken() {
    this.profile.tokens += CONFIG.meta.rewards.eliteToken
    this.save()
  }

  upgradeViews(): MetaUpgradeView[] {
    return UPGRADE_IDS.map((id) => {
      const info = UPGRADE_INFO[id]
      const rank = this.profile.upgrades[id]
      const cost = rank >= info.maxRank ? null : this.costForRank(id, rank + 1)
      return { id, ...info, rank, cost, affordable: cost ? this.canAfford(cost) : false }
    })
  }

  buyUpgrade(id: MetaUpgradeId) {
    const info = UPGRADE_INFO[id]
    const rank = this.profile.upgrades[id]
    if (rank >= info.maxRank) return false
    const cost = this.costForRank(id, rank + 1)
    if (!this.canAfford(cost)) return false
    for (const crystal of CRYSTALS) this.profile.crystals[crystal] -= cost[crystal] ?? 0
    this.profile.upgrades[id]++
    this.save()
    return true
  }

  weaponViews(): MetaWeaponView[] {
    return [...GUNS, ...SWORDS]
      .filter((weapon) => weapon.rarity !== 'common')
      .map((def) => {
        const unlocked = this.profile.unlockedWeapons.includes(def.id)
        const price = CONFIG.meta.weaponPrice[def.rarity]
        return { def, price, unlocked, affordable: unlocked || this.profile.tokens >= price }
      })
  }

  unlockWeapon(id: string) {
    const def = weaponById(id)
    if (!def || def.rarity === 'common' || this.profile.unlockedWeapons.includes(id)) return false
    const price = CONFIG.meta.weaponPrice[def.rarity]
    if (this.profile.tokens < price) return false
    this.profile.tokens -= price
    this.profile.unlockedWeapons.push(id)
    this.save()
    return true
  }

  loadoutWeapons() {
    const unlocked = new Set(this.profile.unlockedWeapons)
    return {
      guns: GUNS.filter((weapon) => unlocked.has(weapon.id)),
      swords: SWORDS.filter((weapon) => unlocked.has(weapon.id)),
      selected: { ...this.profile.loadout },
    }
  }

  setLoadout(gunId: string, swordId: string) {
    const allowed = new Set(this.profile.unlockedWeapons)
    const gun = weaponById(gunId)
    const sword = weaponById(swordId)
    if (!gun || gun.kind !== 'gun' || !allowed.has(gunId)) return false
    if (!sword || sword.kind !== 'sword' || !allowed.has(swordId)) return false
    this.profile.loadout = { gunId, swordId }
    this.save()
    return true
  }

  private costForRank(id: MetaUpgradeId, nextRank: number): Partial<Record<CrystalKind, number>> {
    if (id === 'revive') return { decent: CONFIG.meta.altar.reviveCost.decent, strong: CONFIG.meta.altar.reviveCost.strong }
    if (id === 'ward') return { decent: CONFIG.meta.altar.wardCost.decent, strong: CONFIG.meta.altar.wardCost.strong }
    const cost = CONFIG.meta.altar.rankCosts[nextRank - 1]
    return { [cost.kind]: cost.amount }
  }

  private canAfford(cost: Partial<Record<CrystalKind, number>>) {
    return CRYSTALS.every((crystal) => this.profile.crystals[crystal] >= (cost[crystal] ?? 0))
  }

  private load(): MetaProfile {
    const fallback = freshProfile()
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return fallback
      const stored = JSON.parse(raw) as Partial<MetaProfile>
      const profile = freshProfile()
      for (const crystal of CRYSTALS) profile.crystals[crystal] = numberOrZero(stored.crystals?.[crystal])
      profile.tokens = numberOrZero(stored.tokens)
      for (const id of UPGRADE_IDS) {
        profile.upgrades[id] = Math.min(UPGRADE_INFO[id].maxRank, numberOrZero(stored.upgrades?.[id]))
      }
      const validIds = new Set([...GUNS, ...SWORDS].map((weapon) => weapon.id))
      const storedUnlocks = Array.isArray(stored.unlockedWeapons) ? stored.unlockedWeapons.filter((id): id is string => typeof id === 'string' && validIds.has(id)) : []
      profile.unlockedWeapons = [...new Set(['m1911', 'katana', ...storedUnlocks])]
      const gunId = stored.loadout?.gunId
      const swordId = stored.loadout?.swordId
      if (typeof gunId === 'string' && profile.unlockedWeapons.includes(gunId) && weaponById(gunId)?.kind === 'gun') profile.loadout.gunId = gunId
      if (typeof swordId === 'string' && profile.unlockedWeapons.includes(swordId) && weaponById(swordId)?.kind === 'sword') profile.loadout.swordId = swordId
      return profile
    } catch {
      return fallback
    }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile))
    } catch {
      // Private browsing/storage denial must not block the current run.
    }
  }
}
