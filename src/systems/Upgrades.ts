import { Player } from '../entities/Player'

/**
 * 특성을 관리하는 두 축 — 슬롯 3축 재편(작업 지시 P8 커밋1). 예전엔
 * slash/shot/dash/skill(핵심 슬롯, 슬롯당 1개) + sigil(각인, 스택형) 이었는데,
 * 무기 축 이름을 그대로 슬롯 이름으로 쓰던 걸 캐릭터/총/검 3축으로 재편하며
 * 각인도 축별로 분리했다(총 각인/검 각인/캐릭터 각인) — 'sigil' 하나로 뭉쳐
 * 있으면 "이 각인이 어느 무기 계열과 어울리는지"가 이름에서 안 읽혔다.
 * `skill` 슬롯은 액티브 스킬(Q/E/R)이 P6 커밋2에서 전면 폐지된 뒤로 채울
 * 특성이 하나도 없어 이번에 완전히 제거했다 — 핵심 슬롯은 이제 정확히 3개다.
 */
export type CoreSlot = 'gun' | 'sword' | 'character'
export type SigilSlot = 'gun-sigil' | 'sword-sigil' | 'character-sigil'
export type UpgradeSlot = CoreSlot | SigilSlot
export const CORE_SLOTS: CoreSlot[] = ['gun', 'sword', 'character']
export const SIGIL_SLOTS: SigilSlot[] = ['gun-sigil', 'sword-sigil', 'character-sigil']
export const isSigilSlot = (slot: UpgradeSlot): slot is SigilSlot => (SIGIL_SLOTS as UpgradeSlot[]).includes(slot)
/** 핵심 슬롯 축(gun/sword/character) ↔ 그 축의 각인 슬롯 */
export const sigilSlotOf = (core: CoreSlot): SigilSlot => `${core}-sigil` as SigilSlot

/**
 * 특성 등급(rarity)은 슬롯제 도입 때 이미 폐기된 개념이었는데 필드만 남아
 * UI가 계속 소비하고 있었다(작업 지시 skill_slot_and_rarity 커밋1). 가격도
 * 이미 슬롯 기준(핵심 90G / 각인 45G)이므로, 표기도 슬롯으로 통일한다 — 무기는
 * 여전히 `Rarity`(Weapons.ts)를 쓰며 이 맵과 무관하다.
 */
export const SLOT_LABEL: Record<UpgradeSlot, string> = {
  gun: '총',
  sword: '검',
  character: '캐릭터',
  'gun-sigil': '총 각인',
  'sword-sigil': '검 각인',
  'character-sigil': '캐릭터 각인',
}

/**
 * 각인 등급 5단계(작업 지시 P8 커밋3) — "노멀 → 레어 → 유니크 → 레전더리 →
 * 에픽". 등급은 각인에만 있다(규칙 2) — 핵심 슬롯 12종에는 없다. 스택은
 * 폐지됐다(규칙 1) — 이미 보유한 각인을 다시 만나면 스택이 아니라 승급이고,
 * 각인 하나당 등급 하나만 존재한다(Player.sigilGrades: Map<id, Grade>).
 */
export type Grade = 'normal' | 'rare' | 'unique' | 'legendary' | 'epic'
export const GRADES: Grade[] = ['normal', 'rare', 'unique', 'legendary', 'epic']
export const GRADE_LABEL: Record<Grade, string> = {
  normal: '노멀', rare: '레어', unique: '유니크', legendary: '레전더리', epic: '에픽',
}
/** 등급 색상 — P6 커밋5가 "자리만 남겨두라"던 그 자리(HUD 배지/카드에서 사용). */
export const GRADE_COLOR: Record<Grade, string> = {
  normal: '#9098a8', rare: '#6aa0ff', unique: '#c878ff', legendary: '#f0a030', epic: '#ff5c9e',
}
export const gradeIndex = (g: Grade) => GRADES.indexOf(g)
/** g1이 g2보다 더 높은(승급된) 등급인가 */
export const gradeAbove = (g1: Grade, g2: Grade) => gradeIndex(g1) > gradeIndex(g2)

export interface Upgrade {
  id: string
  name: string
  desc: string
  icon: string
  slot: UpgradeSlot
  apply: (p: Player) => void
  /** 각인 오퍼(offer) 전용 — 이 특정 카드가 제안하는 등급. 핵심 슬롯 특성과
   * POOL 원본 정의(카탈로그) 자체에는 없고, rollChoices()/rollNodeSigilRewards()가
   * 룰에 따라 등급을 붙여 만들어낸 "제안 인스턴스"에만 존재한다. */
  grade?: Grade
}

/**
 * 각인 등급별 수치표(작업 지시 P8 커밋3) — 기존 7종. 초안이며, 정식 승인
 * 전까지는 자리값이다(work order: "수치는 초안을 제시하고 보고하라"는
 * 커밋4의 신규 18종에 명시된 요구이지만, 이 7종도 같은 성격의 수치라
 * 최종 보고에 초안으로 명시한다). 등급이 오르면 수치가 커지고, 에픽에서는
 * 신속 장전/폭심 두 종에 한해 규칙이 하나 바뀐다(work order가 예시로 직접
 * 지목한 두 종) — 나머지 5종은 수치 스케일링만 있고 규칙 변경은 없다.
 */
type SigilField = 'maxHp' | 'critChance' | 'critMult' | 'lifesteal' | 'explodeOnKill' | 'moveSpeedFrac' | 'reloadTimeCutFrac'
interface SigilDef {
  field: SigilField
  values: Record<Grade, number>
  /** 이 등급에서만 규칙이 바뀐다는 서술(현재는 'epic'에서만 쓰인다) */
  epicRule?: string
}
export const SIGIL_DEFS: Record<string, SigilDef> = {
  reload: {
    field: 'reloadTimeCutFrac',
    values: { normal: 0.15, rare: 0.22, unique: 0.30, legendary: 0.40, epic: 0.50 },
    epicRule: '에픽: 리듬 재장전 성공 구간이 더 넓어진다',
  },
  crit: {
    field: 'critChance',
    values: { normal: 0.08, rare: 0.11, unique: 0.15, legendary: 0.20, epic: 0.26 },
  },
  crit_dmg: {
    field: 'critMult',
    values: { normal: 0.4, rare: 0.6, unique: 0.85, legendary: 1.15, epic: 1.5 },
  },
  lifesteal: {
    field: 'lifesteal',
    values: { normal: 0.04, rare: 0.06, unique: 0.08, legendary: 0.11, epic: 0.14 },
  },
  hp: {
    field: 'maxHp',
    values: { normal: 20, rare: 30, unique: 42, legendary: 56, epic: 72 },
  },
  speed: {
    field: 'moveSpeedFrac',
    values: { normal: 0.08, rare: 0.12, unique: 0.16, legendary: 0.22, epic: 0.28 },
  },
  lg_detonator: {
    field: 'explodeOnKill',
    values: { normal: 14, rare: 20, unique: 28, legendary: 38, epic: 50 },
    epicRule: '에픽: 폭발로 죽은 적이 있으면 그 자리에서 한 번 더 연쇄 폭발한다',
  },
}

/**
 * 각인 카드/패널에 표시할 등급별 설명 텍스트를 만든다. POOL을 참조하지
 * 않는다 — RAW_POOL 리터럴 자신의 초기화 중에도 호출되므로(각 항목의
 * `desc`) POOL을 읽으면 아직 대입되지 않은 자기 자신을 읽는 순환 참조가
 * 된다(TDZ 에러로 실제 재현했다) — SIGIL_DEFS만으로 완결되게 한다.
 */
export function describeSigil(id: string, grade: Grade): string {
  const def = SIGIL_DEFS[id]
  if (!def) return ''
  const v = def.values[grade]
  const epicSuffix = grade === 'epic' && def.epicRule ? ` — ${def.epicRule}` : ''
  switch (def.field) {
    case 'maxHp': return `최대 체력 +${v}, 완전 회복${epicSuffix}`
    case 'critChance': return `치명타 확률 +${Math.round(v * 100)}%p${epicSuffix}`
    case 'critMult': return `치명타 배율 +${v.toFixed(2)}${epicSuffix}`
    case 'lifesteal': return `가한 피해의 ${Math.round(v * 100)}% 회복${epicSuffix}`
    case 'moveSpeedFrac': return `이동 속도 +${Math.round(v * 100)}%${epicSuffix}`
    case 'reloadTimeCutFrac': return `장전 시간 -${Math.round(v * 100)}%${epicSuffix}`
    case 'explodeOnKill': return `적 처치 시 폭발로 주변에 ${v} 피해${epicSuffix}`
  }
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
 *
 * 슬롯 3축 재편(작업 지시 P8 커밋1) — 효과는 그대로, 슬롯/축 소속만 바꾼다:
 * shot→gun, slash→sword, dash→character, sigil→축별 3분리(표는 지시문 그대로).
 * '최후탄'만 '마지막 한발'로 개명하며 넉백 충격파를 추가한다(Game.resolveBullets()
 * 참고) — 그 외 11종은 이름·효과 불변.
 *
 * 각인 등급 5단계(작업 지시 P8 커밋3) — 스택 폐지, 등급으로 일원화. 각인
 * 7종의 `apply`는 더 이상 쓰이지 않는다(no-op) — 실제 적용은
 * Player.applySigil(id, grade)가 SIGIL_DEFS를 등급으로 조회해 mods를
 * "누적"이 아니라 "그 등급 값으로 전면 재계산"한다(Player.recomputeSigilMods
 * 참고) — 승급이 이전 등급 효과 위에 쌓이면 안 되기 때문이다. 핵심 슬롯
 * 12종은 등급이 없으므로 apply()가 그대로 유일한 적용 경로다(규칙 2).
 */
const RAW_POOL: Upgrade[] = [
  // ── 총 각인(gun-sigil) 2종 — 등급 5단계, apply는 no-op(Player.applySigil 참고) ──
  { id: 'reload', name: '신속 장전', desc: describeSigil('reload', 'normal'), icon: '🔁', slot: 'gun-sigil', apply: () => {} },
  { id: 'crit', name: '급소 간파', desc: describeSigil('crit', 'normal'), icon: '💥', slot: 'gun-sigil', apply: () => {} },

  // ── 검 각인(sword-sigil) 2종 ──
  { id: 'crit_dmg', name: '처형인', desc: describeSigil('crit_dmg', 'normal'), icon: '☠️', slot: 'sword-sigil', apply: () => {} },
  { id: 'lifesteal', name: '흡혈', desc: describeSigil('lifesteal', 'normal'), icon: '🩸', slot: 'sword-sigil', apply: () => {} },

  // ── 캐릭터 각인(character-sigil) 3종 ──
  // '전투의 깨달음'(xp_gain, 경험치 획득량 +10%)은 작업 지시 P7 커밋1에서
  // 경험치 체계 자체가 폐지되며 함께 삭제됐다(8→7종).
  { id: 'hp', name: '강인한 육체', desc: describeSigil('hp', 'normal'), icon: '❤️', slot: 'character-sigil', apply: () => {} },
  { id: 'speed', name: '경신법', desc: describeSigil('speed', 'normal'), icon: '👟', slot: 'character-sigil', apply: () => {} },
  { id: 'lg_detonator', name: '⭐ 폭심(爆心)', desc: describeSigil('lg_detonator', 'normal'), icon: '💣', slot: 'character-sigil', apply: () => {} },

  // ── 핵심 슬롯: sword(4종, 구 slash — 작업 지시 slot_traits_midcost_v2로 3종 추가) ──
  { id: 'iaijutsu', name: '발도참(拔刀斬)', desc: '0.5초 이상 정지 후 첫 베기 250% 피해, 넉백 2배', icon: '🌸', slot: 'sword',
    apply: () => { /* 발동 로직은 Player.update()의 sword 판정에서 stillTimer로 처리 — 상시 배수가 아니라 조건부라 apply는 상태만 등록한다(coreSlots에 이미 기록됨) */ } },
  { id: 'ilseom', name: '일섬(一閃)', desc: '베기가 정확히 1명만 맞혔을 때 피해 +100% (2명 이상은 배수 없음)', icon: '💫', slot: 'sword',
    apply: () => { /* Game.resolveSlash()에서 명중 수 1일 때만 판정 */ } },
  { id: 'dualblade', name: '이도류(二刀流)', desc: '베기가 2연타(각 60%, 합계 120%), 온힛 효과 각 타마다 발동', icon: '⚔️', slot: 'sword',
    apply: () => { /* Game.ts pendingSlashes 대기열에서 0.12초 뒤 두 번째 타격 처리 */ } },
  { id: 'parry', name: '흘리기', desc: '베기 부채꼴 안 적 탄환을 반사(검 피해의 60%, 역방향) — 근접 적에겐 무효', icon: '🛡️', slot: 'sword',
    apply: () => { /* Game.resolveDeflect()에서 판정 — 근접 적은 접촉 피해라 대상이 없다(의도) */ } },

  // ── 핵심 슬롯: gun(4종, 구 shot) ──
  { id: 'close_range', name: '밀착사격', desc: '거리 3 이하 명중 시 피해 +90%', icon: '🔫', slot: 'gun',
    apply: () => { /* Game.resolveBullets()에서 travelDist로 판정 */ } },
  { id: 'last_bullet', name: '마지막 한발', desc: '탄창 마지막 1발 피해 220%, 명중 시 주변에 넉백 충격파', icon: '🎯', slot: 'gun',
    apply: () => { /* Player.update() 발사 블록에서 ammo===1로 판정, 넉백은 Game.resolveBullets()에서 처리 */ } },
  { id: 'aimed_shot', name: '조준사격', desc: '0.35초 이상 사격을 쉰 뒤 첫 발 확정 치명타', icon: '🎯', slot: 'gun',
    apply: () => { /* Player.update() 발사 블록에서 aimPauseTimer로 판정 */ } },
  { id: 'ricochet', name: '도탄(跳彈)', desc: '탄환이 소멸할 때 반경 8 안의 안 맞은 가장 가까운 적으로 1회 튕긴다', icon: '🔀', slot: 'gun',
    apply: () => { /* Game.resolveBullets()에서 관통 소진 시점에 판정 — 관통과 배타 아님 */ } },

  // ── 핵심 슬롯: character(4종, 구 dash, lg_blink 이관 포함) ──
  { id: 'mark', name: '표식(標識)', desc: '대시로 관통한 적은 3초간 받는 피해 +35%', icon: '🏷️', slot: 'character',
    apply: () => { /* Game.resolveDashMark()에서 대시 종료 시 판정 */ } },
  { id: 'quick_switch', name: '급전환', desc: '대시 종료 후 0.5초간 검 쿨 절반 + 총 즉시 장전', icon: '🔄', slot: 'character',
    apply: () => { /* Player.onDashEnd()에서 처리 */ } },
  { id: 'afterimage', name: '잔영(殘影)', desc: '대시 무적으로 공격을 흘리면 대시 쿨타임 즉시 초기화(대시 1회당 1번)', icon: '👥', slot: 'character',
    apply: () => { /* Player.takeDamage()의 dashBlock 이벤트를 Game.ts가 감지해 tryRefreshDashOnBlock() 호출 */ } },
  { id: 'lg_blink', name: '⭐ 섬광강타', desc: '대시 종료 시 주변에 폭발 피해', icon: '⚡', slot: 'character',
    apply: (p) => { p.mods.dashStrike += 44; p.recompute() } },
]

export const POOL: Upgrade[] = RAW_POOL

/** POOL의 정적 정의를 특정 등급의 "제안 카드"로 복제한다(원본을 변형하지 않는다). */
function offerSigil(u: Upgrade, grade: Grade): Upgrade {
  return { ...u, desc: describeSigil(u.id, grade), grade }
}

/**
 * 랜덤 특성 선택지 — 상점/제련소 등 "노드가 아닌" 일반 획득 경로 전용.
 * (맵 노드의 등급 보상 규칙은 별도인 rollNodeSigilRewards() 참고.)
 *
 * 등급 기반 가중치는 폐기됐다 — 후보군 안에서는 균등 추첨이다. 대신 슬롯
 * 상태를 기준으로 카드 구성을 짠다:
 *   - 빈 핵심 슬롯이 있으면 그 슬롯 특성을 최대 2장까지 우선 배치하고
 *     나머지는 각인으로 채운다.
 *   - 핵심 슬롯이 모두 찼으면 각인 2장(그중 최소 1장은 이미 보유해 승급
 *     가능한 것 우선) + 교체 후보(이미 채운 슬롯의 다른 특성) 1장.
 *   - 그래도 못 채우면(모든 각인이 에픽 상한, 교체 후보도 없음) 남은
 *     자리는 아무 후보로나 채운다.
 *
 * 각인의 등급: 미보유면 'normal', 보유 중이면 한 단계 승급(현재 등급의
 * 바로 위 등급 — 상점/제련소는 맵 노드가 아니라 깊이와 무관하므로 노드처럼
 * "그 노드 등급으로 직행"하지 않고 점진적으로 한 칸씩 오른다). 이미 에픽인
 * 각인은 더 승급할 수 없어 후보에서 빠진다.
 *
 * coreSlots는 "슬롯 → 현재 보유한 특성 id" — 교체 후보를 고를 때 지금
 * 채워진 특성 자신은 후보에서 제외하기 위해 id까지 필요하다.
 */
export function rollChoices(
  count = 3,
  sigilGrades: ReadonlyMap<string, Grade> = new Map(),
  coreSlots: ReadonlyMap<CoreSlot, string> = new Map(),
): Upgrade[] {
  const coreCandidates = POOL.filter((u) => !isSigilSlot(u.slot))
  const emptySlots = CORE_SLOTS.filter((s) => !coreSlots.has(s))
  const coreSlotCandidates = coreCandidates.filter((u) => emptySlots.includes(u.slot as CoreSlot))
  const swapCandidates = coreCandidates.filter(
    (u) => coreSlots.get(u.slot as CoreSlot) !== undefined && coreSlots.get(u.slot as CoreSlot) !== u.id,
  )

  // 각인 후보 — 3축(총/검/캐릭터)을 하나의 풀로 합쳐 뽑는다. 축 구분은
  // 표시(배지 색/라벨)와 제련소 교체(같은 축끼리만) 몫이지, 카드 구성
  // 알고리즘 자체의 취지("빈 슬롯 우선 → 각인 위주 → 확정 이득 1장")는
  // 축을 몰라도 성립해 굳이 축별로 쪼개지 않는다(작업 지시: 기존 취지 유지).
  const sigilOffers: Upgrade[] = []
  for (const u of POOL.filter((u) => isSigilSlot(u.slot))) {
    const cur = sigilGrades.get(u.id)
    if (!cur) sigilOffers.push(offerSigil(u, 'normal'))
    else if (cur !== 'epic') sigilOffers.push(offerSigil(u, GRADES[gradeIndex(cur) + 1]))
  }
  const ownedSigilOffers = sigilOffers.filter((u) => sigilGrades.has(u.id))

  const chosen: Upgrade[] = []
  const takeRandom = (arr: Upgrade[]) => {
    const pool = arr.filter((u) => !chosen.includes(u))
    if (pool.length === 0) return null
    const u = pool[Math.floor(Math.random() * pool.length)]
    chosen.push(u)
    return u
  }
  const fillWithSigils = (max: number, preferOwned: boolean) => {
    if (preferOwned && ownedSigilOffers.some((u) => !chosen.includes(u))) takeRandom(ownedSigilOffers)
    while (chosen.length < max) {
      const rest = sigilOffers.filter((u) => !chosen.includes(u))
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
  // 그래도 자리가 남으면(모든 각인 에픽 상한 + 교체 후보 없음) 가능한 후보로 채운다
  while (chosen.length < count) {
    if (!takeRandom([...coreCandidates, ...sigilOffers])) break
  }
  return chosen
}

export function upgradeById(id: string): Upgrade | undefined {
  return POOL.find((u) => u.id === id)
}

/**
 * 던전 제련소용 교체 후보 — "같은 축 내 교체"(작업 지시 P8 커밋1). 각인은
 * 같은 축의 각인끼리, 핵심 슬롯 특성은 같은 슬롯(축)끼리만 후보가 된다.
 * currentId 자신은 제외한다. 각인 교체 후보의 등급은 "교체해도 힘이 줄지
 * 않는다"는 기존 취지를 그대로 이어받아 currentId가 보유한 등급과 같은
 * 등급으로 제안한다(작업 지시 P8 커밋3으로 스택이 등급으로 바뀌었을 뿐,
 * "교체 = 등가 교환"이라는 제련소의 취지 자체는 안 바뀌었다).
 */
export function forgeSwapCandidates(
  currentId: string,
  sigilGrades: ReadonlyMap<string, Grade>,
  coreSlots: ReadonlyMap<CoreSlot, string> = new Map(),
): Upgrade[] {
  const current = upgradeById(currentId)
  if (!current) return []
  const curGrade = isSigilSlot(current.slot) ? sigilGrades.get(currentId) ?? 'normal' : undefined
  const candidates = POOL.filter((u) => {
    if (u.id === currentId || u.slot !== current.slot) return false
    if (isSigilSlot(u.slot)) {
      // 이미 curGrade 이상으로 보유 중인 각인은 후보에서 뺀다 — "교체"가
      // 실제로는 아무 변화도 없는(applySigil()이 무시하는) 가짜 선택지가
      // 되는 걸 막는다.
      const owned = sigilGrades.get(u.id)
      return !owned || gradeAbove(curGrade!, owned)
    }
    return coreSlots.get(u.slot as CoreSlot) !== u.id
  })
  if (!isSigilSlot(current.slot)) return candidates
  return candidates.map((u) => offerSigil(u, curGrade!))
}

/**
 * 노드 등급 표(작업 지시 P8 커밋3) — 스테이지 기본 등급 × 노드 보정.
 * 에픽은 이 표에 의해 자연스럽게 "스테이지 7의 상위 전투/엘리트/보스"에서만
 * 나온다(7단계는 legendary, +1 보정이 있는 세 노드만 그 위인 epic에 닿는다 —
 * 'trait' 노드는 보정이 없어 스테이지 7에서도 legendary가 상한이다).
 */
export type RewardNodeKind = 'trait' | 'hardCombat' | 'elite' | 'boss'
export function nodeGradeFor(stage: number, kind: RewardNodeKind): Grade {
  const baseIdx = stage <= 2 ? 0 : stage <= 4 ? 1 : stage <= 6 ? 2 : 3 // normal/rare/unique/legendary
  const bonus = kind === 'trait' ? 0 : 1 // 상위 전투/엘리트/보스는 기본 +1
  return GRADES[Math.min(GRADES.length - 1, baseIdx + bonus)]
}

/**
 * 맵 노드(각인/상위 전투/엘리트/보스) 보상 각인 선택지(작업 지시 P8 커밋3).
 * count는 3(엘리트는 4). 후보는 "그 노드 등급(nodeGrade)에 아직 못 미친"
 * 각인만 — 미보유면 nodeGrade로 직행(새 등급 노드를 방문한 보상이니 그
 * 노드가 여는 등급을 바로 받는다), 보유 중이면 "승급도 그 노드의 등급
 * 상한을 넘지 못한다"는 규칙에 따라 nodeGrade로 승급(현재 등급 < nodeGrade
 * 일 때만 후보) — 이미 nodeGrade 이상이면 후보에서 빠진다(그 이상은 더 낮은
 * 노드로는 채울 수 없다, 상한 규칙).
 *
 * "최소 1장은 확정 이득": 각인 후보(sigilCandidates)가 하나라도 있으면
 * 최소 1장은 반드시 그중에서 뽑는다 — 각인 후보는 전부 미보유 획득 또는
 * 실제 승급이라 항상 이득이지만(스택 상한 개념이 사라져 손해 볼 카드가
 * 없다), 핵심 슬롯 교체 후보는 "다른 걸로 바꾸는" 선택이라 이득이 보장되지
 * 않는다 — 그래서 순서상 각인을 항상 먼저 채운다.
 * 각인 7종을 전부 nodeGrade 이상으로 이미 보유한 극단적인 경우(각인 후보가
 * 0개)에는 작업 지시에 명시된 대체 규칙이 없어, 핵심 슬롯 후보(빈 슬롯 →
 * 교체 후보 순)로 채운다 — 아무 보상도 없는 것보다는 낫다는 판단이며,
 * 별도 규칙이 필요하면 설계 판단이 있어야 한다(최종 보고에서 짚는다).
 */
export function rollNodeSigilRewards(
  count: number,
  nodeGrade: Grade,
  sigilGrades: ReadonlyMap<string, Grade>,
  coreSlots: ReadonlyMap<CoreSlot, string> = new Map(),
): Upgrade[] {
  const sigilCandidates: Upgrade[] = []
  for (const u of POOL.filter((u) => isSigilSlot(u.slot))) {
    const cur = sigilGrades.get(u.id)
    if (!cur || gradeAbove(nodeGrade, cur)) sigilCandidates.push(offerSigil(u, nodeGrade))
  }

  const chosen: Upgrade[] = []
  const takeRandom = (arr: Upgrade[]) => {
    const pool = arr.filter((u) => !chosen.some((c) => c.id === u.id))
    if (pool.length === 0) return null
    const u = pool[Math.floor(Math.random() * pool.length)]
    chosen.push(u)
    return u
  }
  while (chosen.length < count) {
    if (!takeRandom(sigilCandidates)) break
  }
  if (chosen.length < count) {
    // 각인 후보가 바닥남 — 핵심 슬롯으로 대체(빈 슬롯 우선, 그다음 교체 후보)
    const coreCandidates = POOL.filter((u) => !isSigilSlot(u.slot))
    const emptySlots = CORE_SLOTS.filter((s) => !coreSlots.has(s))
    const emptySlotCandidates = coreCandidates.filter((u) => emptySlots.includes(u.slot as CoreSlot))
    while (chosen.length < count) {
      if (!takeRandom(emptySlotCandidates)) break
    }
    const swapCandidates = coreCandidates.filter(
      (u) => coreSlots.get(u.slot as CoreSlot) !== undefined && coreSlots.get(u.slot as CoreSlot) !== u.id,
    )
    while (chosen.length < count) {
      if (!takeRandom(swapCandidates)) break
    }
  }
  return chosen
}
