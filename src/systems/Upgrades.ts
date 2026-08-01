import { Player } from '../entities/Player'
import { Rarity } from './Weapons'

/**
 * 특성을 관리하는 두 축.
 * `sigil`(각인)은 traitStacks로 누적 스택하는 기존 방식 그대로다.
 * `slash`/`shot`/`dash`/`skill`(핵심 슬롯)은 슬롯당 1개만 보유하며,
 * Player.coreSlots가 "슬롯 → 보유 특성 id"를 기록한다.
 */
export type UpgradeSlot = 'slash' | 'shot' | 'dash' | 'skill' | 'sigil'
export type CoreSlot = Exclude<UpgradeSlot, 'sigil'>
export const CORE_SLOTS: CoreSlot[] = ['slash', 'shot', 'dash', 'skill']

export interface Upgrade {
  id: string
  name: string
  desc: string
  icon: string
  rarity: Rarity
  slot: UpgradeSlot
  maxStacks: number
  apply: (p: Player) => void
}

/**
 * 특성 전체 풀 — 위험축 폐기 + 각인 재편 + 저비용 슬롯 특성 6종(작업 지시
 * slot_system_phase1 커밋 3).
 *
 * 폐기(작업 지시 3-1 목록 그대로, 14종): sword_range, multishot, lg_storm,
 * pierce, lg_pierce, gun_dmg, sword_dmg, berserk, bullet_speed, lg_twinblade,
 * lg_vampire, lg_executioner, lg_gale, lg_gunsword. (지시문 표제는 "11종"이라
 * 적혀 있으나 실제 나열된 id는 14개 — 최종 보고에서 짚었다.)
 * 추가로 폐기: dash_cd(대시 쿨은 후속 출발 패시브가 담당), gun_rob(어느 목록
 * 에도 없지만 "각인 확정 8종"이 최종 각인 전체 명단이라는 서술과 맞추려면
 * 같이 빠져야 앞뒤가 맞는다 — 이것도 최종 보고에서 짚었다).
 * 승격: lg_quickdraw → swordReloadBurstBonus 기본값(Player.ts freshMods)으로
 * 이관, 풀에서 제거.
 * 이관: lg_blink → slot: 'dash'로 이동(대시 3종 중 하나), 각인에서 제외.
 * 각인 확정 8종은 수치를 3-2 표에 맞춰 낮췄다(스택 상한 5→3이라 값도 같이
 * 내렸다 — 지시문 표에 있는 그대로).
 */
const RAW_POOL: Upgrade[] = [
  // ── 각인(sigil) 8종 — 스택 상한 3, 전부 가산/상시 배수 ──
  { id: 'hp', name: '강인한 육체', desc: '최대 체력 +20, 완전 회복', icon: '❤️', rarity: 'common', slot: 'sigil', maxStacks: 3,
    apply: (p) => { p.mods.maxHp += 20; p.recompute(); p.hp = p.stats.maxHp } },
  { id: 'speed', name: '경신법', desc: '이동 속도 +8%', icon: '👟', rarity: 'common', slot: 'sigil', maxStacks: 3,
    apply: (p) => { p.mods.moveSpeed *= 1.08; p.recompute() } },
  { id: 'crit', name: '급소 간파', desc: '치명타 확률 +8%p', icon: '💥', rarity: 'rare', slot: 'sigil', maxStacks: 3,
    apply: (p) => { p.mods.critChance += 0.08; p.recompute() } },
  { id: 'crit_dmg', name: '처형인', desc: '치명타 배율 +0.4', icon: '☠️', rarity: 'rare', slot: 'sigil', maxStacks: 3,
    apply: (p) => { p.mods.critMult += 0.4; p.recompute() } },
  { id: 'lifesteal', name: '흡혈', desc: '가한 피해의 4% 회복', icon: '🩸', rarity: 'epic', slot: 'sigil', maxStacks: 3,
    apply: (p) => { p.mods.lifesteal += 0.04; p.recompute() } },
  { id: 'xp_gain', name: '전투의 깨달음', desc: '경험치 획득량 +10%', icon: '📘', rarity: 'common', slot: 'sigil', maxStacks: 3,
    apply: (p) => { p.mods.xpGain *= 1.1; p.recompute() } },
  { id: 'reload', name: '신속 장전', desc: '장전 시간 -15%', icon: '🔁', rarity: 'rare', slot: 'sigil', maxStacks: 3,
    apply: (p) => { p.mods.reloadTime *= 0.85; p.recompute() } },
  { id: 'lg_detonator', name: '⭐ 폭심(爆心)', desc: '적 처치 시 폭발로 주변에 피해, 스택당 +14', icon: '💣', rarity: 'legendary', slot: 'sigil', maxStacks: 3,
    apply: (p) => { p.mods.explodeOnKill += 14; p.recompute() } },

  // ── 핵심 슬롯: slash(1종) ──
  { id: 'iaijutsu', name: '발도참(拔刀斬)', desc: '0.5초 이상 정지 후 첫 베기 250% 피해, 넉백 2배', icon: '🌸', rarity: 'epic', slot: 'slash', maxStacks: 1,
    apply: () => { /* 발동 로직은 Player.update()의 slash 판정에서 stillTimer로 처리 — 상시 배수가 아니라 조건부라 apply는 상태만 등록한다(coreSlots에 이미 기록됨) */ } },

  // ── 핵심 슬롯: shot(3종) ──
  { id: 'close_range', name: '밀착사격', desc: '거리 3 이하 명중 시 피해 +90%', icon: '🔫', rarity: 'epic', slot: 'shot', maxStacks: 1,
    apply: () => { /* Game.resolveBullets()에서 travelDist로 판정 */ } },
  { id: 'last_bullet', name: '최후탄', desc: '탄창 마지막 1발 피해 220%', icon: '🎯', rarity: 'epic', slot: 'shot', maxStacks: 1,
    apply: () => { /* Player.update() 발사 블록에서 ammo===1로 판정 */ } },
  { id: 'aimed_shot', name: '조준사격', desc: '0.35초 이상 사격을 쉰 뒤 첫 발 확정 치명타', icon: '🎯', rarity: 'epic', slot: 'shot', maxStacks: 1,
    apply: () => { /* Player.update() 발사 블록에서 aimPauseTimer로 판정 */ } },

  // ── 핵심 슬롯: dash(3종, lg_blink 이관 포함) ──
  { id: 'mark', name: '표식(標識)', desc: '대시로 관통한 적은 3초간 받는 피해 +35%', icon: '🏷️', rarity: 'epic', slot: 'dash', maxStacks: 1,
    apply: () => { /* Game.resolveDashMark()에서 대시 종료 시 판정 */ } },
  { id: 'quick_switch', name: '급전환', desc: '대시 종료 후 0.5초간 검 쿨 절반 + 총 즉시 장전', icon: '🔄', rarity: 'epic', slot: 'dash', maxStacks: 1,
    apply: () => { /* Player.onDashEnd()에서 처리 */ } },
  { id: 'lg_blink', name: '⭐ 섬광강타', desc: '대시 종료 시 주변에 폭발 피해', icon: '⚡', rarity: 'legendary', slot: 'dash', maxStacks: 1,
    apply: (p) => { p.mods.dashStrike += 44; p.recompute() } },
]

export const POOL: Upgrade[] = RAW_POOL

/**
 * 랜덤 특성 선택지.
 *
 * 등급 기반 가중치는 폐기됐다 — 후보군 안에서는 균등 추첨이다. 대신 슬롯
 * 상태를 기준으로 카드 구성을 짠다:
 *   - 빈 핵심 슬롯이 있으면 그 슬롯 특성을 최대 2장까지 우선 배치하고
 *     나머지는 각인으로 채운다.
 *   - 핵심 슬롯이 모두 찼으면 각인 2장(그중 최소 1장은 이미 보유해 스택을
 *     올릴 수 있는 것 우선) + 교체 후보(이미 채운 슬롯의 다른 특성) 1장.
 *   - 그래도 못 채우면(모든 각인이 상한, 교체 후보도 없음) 남은 자리는
 *     아무 후보로나 채운다.
 *
 * coreSlots는 "슬롯 → 현재 보유한 특성 id" — 교체 후보를 고를 때 지금
 * 채워진 특성 자신은 후보에서 제외하기 위해 id까지 필요하다.
 */
export function rollChoices(
  count = 3,
  traitStacks: ReadonlyMap<string, number> = new Map(),
  coreSlots: ReadonlyMap<CoreSlot, string> = new Map(),
): Upgrade[] {
  const acquirable = POOL.filter((u) => (traitStacks.get(u.id) ?? 0) < u.maxStacks)
  const emptySlots = CORE_SLOTS.filter((s) => !coreSlots.has(s))
  const coreSlotCandidates = acquirable.filter((u) => u.slot !== 'sigil' && emptySlots.includes(u.slot as CoreSlot))
  const sigilPool = acquirable.filter((u) => u.slot === 'sigil')
  const ownedSigils = sigilPool.filter((u) => (traitStacks.get(u.id) ?? 0) > 0)
  const swapCandidates = acquirable.filter(
    (u) => u.slot !== 'sigil' && coreSlots.get(u.slot as CoreSlot) !== undefined && coreSlots.get(u.slot as CoreSlot) !== u.id,
  )

  const chosen: Upgrade[] = []
  const takeRandom = (arr: Upgrade[]) => {
    const pool = arr.filter((u) => !chosen.includes(u))
    if (pool.length === 0) return null
    const u = pool[Math.floor(Math.random() * pool.length)]
    chosen.push(u)
    return u
  }
  const fillWithSigils = (max: number, preferOwned: boolean) => {
    if (preferOwned && ownedSigils.some((u) => !chosen.includes(u))) takeRandom(ownedSigils)
    while (chosen.length < max) {
      const rest = sigilPool.filter((u) => !chosen.includes(u))
      if (!takeRandom(rest)) break
    }
  }

  if (coreSlotCandidates.length > 0) {
    // 빈 핵심 슬롯 특성 최대 2장 우선 배치, 나머지는 각인
    const slotSlots = Math.min(2, count)
    while (chosen.length < slotSlots) {
      if (!takeRandom(coreSlotCandidates)) break
    }
    fillWithSigils(count, true)
  } else {
    // 핵심 슬롯이 모두 찼거나(또는 후보 없음) — 각인 2장(최소 1 보유 우선) + 교체 후보 1장
    fillWithSigils(Math.min(2, count), true)
    if (chosen.length < count && swapCandidates.length > 0) takeRandom(swapCandidates)
  }
  // 그래도 자리가 남으면(모든 각인 상한 + 교체 후보 없음) 가능한 후보로 채운다
  while (chosen.length < count) {
    if (!takeRandom(acquirable)) break
  }
  return chosen
}

export function upgradeById(id: string): Upgrade | undefined {
  return POOL.find((u) => u.id === id)
}

/**
 * 던전 제련소용 교체 후보.
 * 각인은 각인끼리(등급 무관, 기존엔 "같은 등급"이었으나 등급 축이
 * 폐기됐으므로 슬롯 기준으로 대체한다), 핵심 슬롯 특성은 같은 슬롯끼리만
 * 후보가 된다. currentId 자신과 이미 maxStacks에 도달한 항목은 제외한다.
 */
export function forgeSwapCandidates(
  currentId: string,
  traitStacks: ReadonlyMap<string, number>,
  coreSlots: ReadonlyMap<CoreSlot, string> = new Map(),
): Upgrade[] {
  const current = upgradeById(currentId)
  if (!current) return []
  return POOL.filter((u) => {
    if (u.id === currentId || u.slot !== current.slot) return false
    if (u.slot === 'sigil') return (traitStacks.get(u.id) ?? 0) < u.maxStacks
    return coreSlots.get(u.slot as CoreSlot) !== u.id
  })
}
