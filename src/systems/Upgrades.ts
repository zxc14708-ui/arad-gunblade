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
 * 각인 등급 5단계(작업 지시 P8 커밋3, P11 표시명 변경) —
 * "일반 → 희귀 → 영웅 → 전설 → 신화". 등급은 각인에만 있다(규칙 2) — 핵심 슬롯 12종에는 없다. 스택은
 * 폐지됐다(규칙 1) — 이미 보유한 각인을 다시 만나면 스택이 아니라 승급이고,
 * 각인 하나당 등급 하나만 존재한다(Player.sigilGrades: Map<id, Grade>).
 */
export type Grade = 'normal' | 'rare' | 'unique' | 'legendary' | 'epic'
export const GRADES: Grade[] = ['normal', 'rare', 'unique', 'legendary', 'epic']
export const GRADE_LABEL: Record<Grade, string> = {
  normal: '일반', rare: '희귀', unique: '영웅', legendary: '전설', epic: '신화',
}
/** 등급 색상 — P6 커밋5가 "자리만 남겨두라"던 그 자리(HUD 배지/카드에서 사용). */
export const GRADE_COLOR: Record<Grade, string> = {
  normal: '#9098a8', rare: '#6aa0ff', unique: '#c878ff', legendary: '#f0a030', epic: '#ff5c9e',
}
export const gradeIndex = (g: Grade) => GRADES.indexOf(g)
/** g1이 g2보다 더 높은(승급된) 등급인가 */
export const gradeAbove = (g1: Grade, g2: Grade) => gradeIndex(g1) > gradeIndex(g2)

/** P11 각인 계열 메타데이터 — 표시와 향후 선택 알고리즘용이며 효과 계산에는 쓰지 않는다. */
export type SigilTag = '감전' | '출혈' | '과열' | '연참' | '총검연계' | '골드' | '하이리스크' | '태세'
export type SigilRole = '부여' | '증폭' | '소비'

export interface SigilMetadata {
  tags: readonly SigilTag[]
  role?: SigilRole
  synergy: readonly string[]
  conflict: readonly string[]
}

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
  /** 각인 제안 카드에 복사되는 P11 분류 정보. 핵심 슬롯 특성에는 없다. */
  tags?: readonly SigilTag[]
  role?: SigilRole
  synergy?: readonly string[]
  conflict?: readonly string[]
}

/**
 * 각인 등급별 수치표(작업 지시 P8 커밋3 초안 → P8c4에서 신규 18종과 함께
 * 최종 승인) — 파라미터 이름은 각인마다 다르다(예: 신속 장전은 `frac` 하나,
 * 혈탄은 `dmgFrac`+`hpCost` 둘). 적용 코드(Player.recomputeSigilMods 등)가
 * 이 이름으로 값을 꺼낸다. 고유 각인(unique 필드)은 그 등급 하나에서만
 * 값이 정의된다 — 승급으로 도달할 수 없고(work order), 다른 등급 값을
 * 조회할 일이 아예 없다.
 */
export interface SigilDef extends SigilMetadata {
  /** 고유 각인이면 고정 등급 — 이 각인은 이 등급으로만 존재하고 승급하지 않는다. */
  unique?: Grade
  values: Partial<Record<Grade, Record<string, number>>>
  /** 이 등급에서만 규칙이 바뀐다는 서술(에픽 규칙 변경 또는 고유 각인 설명) */
  epicRule?: string
  desc: (v: Record<string, number>, grade: Grade) => string
}

// 소수 첫째 자리까지 표시 — 정수 반올림만 쓰면 인접 등급의 실제 값이
// 달라도(예: 2.5%와 3%) 화면엔 같은 정수로 뭉개져 보였다(작업 지시 P10
// 커밋3-1에서 발견 — 저장값 자체는 항상 소수로 정확했다, 표시 전용 버그).
const pct = (v: number) => {
  const p = Math.round(v * 1000) / 10
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`
}

export const SIGIL_DEFS: Record<string, SigilDef> = {
  // ══════ 기존 7종(P8 커밋3) ══════
  reload: {
    tags: [], synergy: [], conflict: [],
    // 에픽 규칙 변경("리듬 재장전 성공 구간 확대")은 리듬 장전 폐지로
    // 함께 제거했다(작업 지시 P10 커밋1) — 수치(-50%)는 그대로 유지, 다른
    // 등급과 같은 방식(수치 스케일링만)으로 표시한다.
    values: {
      normal: { frac: 0.15 }, rare: { frac: 0.22 }, unique: { frac: 0.30 }, legendary: { frac: 0.40 }, epic: { frac: 0.50 },
    },
    desc: (v) => `장전 시간 -${pct(v.frac)}`,
  },
  crit: {
    tags: [], synergy: [], conflict: [],
    values: {
      normal: { frac: 0.08 }, rare: { frac: 0.11 }, unique: { frac: 0.15 }, legendary: { frac: 0.20 }, epic: { frac: 0.26 },
    },
    desc: (v) => `치명타 확률 +${pct(v.frac)}p`,
  },
  crit_dmg: {
    tags: [], synergy: [], conflict: [],
    values: {
      normal: { amount: 0.4 }, rare: { amount: 0.6 }, unique: { amount: 0.85 }, legendary: { amount: 1.15 }, epic: { amount: 1.5 },
    },
    desc: (v) => `치명타 배율 +${v.amount.toFixed(2)}`,
  },
  lifesteal: {
    tags: ['출혈'], synergy: ['bleed_blade', 'blood_trace'], conflict: [],
    values: {
      normal: { frac: 0.04 }, rare: { frac: 0.06 }, unique: { frac: 0.08 }, legendary: { frac: 0.11 }, epic: { frac: 0.14 },
    },
    desc: (v) => `가한 피해의 ${pct(v.frac)} 회복`,
  },
  hp: {
    tags: [], synergy: [], conflict: [],
    values: {
      normal: { amount: 20 }, rare: { amount: 30 }, unique: { amount: 42 }, legendary: { amount: 56 }, epic: { amount: 72 },
    },
    desc: (v) => `최대 체력 +${v.amount}, 완전 회복`,
  },
  speed: {
    tags: [], synergy: [], conflict: [],
    values: {
      normal: { frac: 0.08 }, rare: { frac: 0.12 }, unique: { frac: 0.16 }, legendary: { frac: 0.22 }, epic: { frac: 0.28 },
    },
    desc: (v) => `이동 속도 +${pct(v.frac)}`,
  },
  lg_detonator: {
    tags: [], synergy: [], conflict: [],
    values: {
      normal: { amount: 14 }, rare: { amount: 20 }, unique: { amount: 28 }, legendary: { amount: 38 }, epic: { amount: 50 },
    },
    epicRule: '폭발로 죽은 적이 있으면 그 자리에서 한 번 더 연쇄 폭발한다',
    desc: (v, g) => `적 처치 시 폭발로 주변에 ${v.amount} 피해${g === 'epic' ? ' — 연쇄 폭발' : ''}`,
  },

  // ══════ 총 축 신규 4종(P8c4) ══════
  blood_bullet: {
    tags: ['하이리스크'], synergy: [], conflict: [],
    values: {
      normal: { dmgFrac: 0.15, hpCost: 1 }, rare: { dmgFrac: 0.22, hpCost: 1.3 }, unique: { dmgFrac: 0.30, hpCost: 1.6 },
      legendary: { dmgFrac: 0.40, hpCost: 2.0 }, epic: { dmgFrac: 0.55, hpCost: 2.5 },
    },
    desc: (v) => `총 피해 +${pct(v.dmgFrac)} · 발사할 때마다 체력 -${v.hpCost} (하이리스크)`,
  },
  overheat: {
    tags: ['과열'], synergy: [], conflict: [],
    values: {
      normal: { stackFrac: 0.02, maxStacks: 5 }, rare: { stackFrac: 0.025, maxStacks: 6 }, unique: { stackFrac: 0.03, maxStacks: 7 },
      legendary: { stackFrac: 0.035, maxStacks: 8 }, epic: { stackFrac: 0.04, maxStacks: 10 },
    },
    desc: (v) => `재장전 없이 연사할수록 스택당 피해 +${pct(v.stackFrac)}(최대 ${v.maxStacks}, +${pct(v.stackFrac * v.maxStacks)}), 재장전 시 초기화`,
  },
  gun_focus: {
    tags: ['태세'], synergy: [], conflict: ['sword_focus', 'hybrid_stance'],
    values: {
      normal: { gunFrac: 0.12, swordPenalty: 0.10 }, rare: { gunFrac: 0.18, swordPenalty: 0.13 }, unique: { gunFrac: 0.25, swordPenalty: 0.17 },
      legendary: { gunFrac: 0.34, swordPenalty: 0.22 }, epic: { gunFrac: 0.45, swordPenalty: 0.30 },
    },
    desc: (v) => `총 피해 +${pct(v.gunFrac)} · 검 피해 -${pct(v.swordPenalty)} (검날 집중·총검일체와 상충)`,
  },
  shock_bullet: {
    tags: ['감전'], role: '부여', synergy: [], conflict: [],
    values: {
      normal: { chance: 0.20, duration: 1.5 }, rare: { chance: 0.30, duration: 1.8 }, unique: { chance: 0.45, duration: 2.1 },
      legendary: { chance: 0.65, duration: 2.4 }, epic: { chance: 0.85, duration: 3.0 },
    },
    desc: (v) => `사격 명중 시 ${pct(v.chance)} 확률로 감전(${v.duration}s)`,
  },
  // '연쇄 장전'(chain_reload)은 리듬 재장전 폐지로 전제가 사라져 폐지했다
  // (작업 지시 P10 커밋2) — '예비 탄창'(reserve_mag)으로 대체.
  reserve_mag: {
    tags: [], synergy: [], conflict: [],
    unique: 'legendary',
    values: { legendary: { maxCharges: 3 } },
    desc: (v) => `재장전이 즉시 완료된다. 런당 사용 횟수 제한(최대 ${v.maxCharges}) — 상인 노드·보스 준비방에서 충전 (고유·레전더리)`,
  },
  rapid_reload: {
    tags: [], synergy: [], conflict: [],
    values: {
      normal: { duration: 2.0, cutFrac: 0.12 }, rare: { duration: 2.3, cutFrac: 0.18 }, unique: { duration: 2.6, cutFrac: 0.25 },
      legendary: { duration: 3.0, cutFrac: 0.34 }, epic: { duration: 3.5, cutFrac: 0.45 },
    },
    desc: (v) => `재장전 직후 ${v.duration}s간 사격 쿨타임 -${pct(v.cutFrac)}`,
  },
  zero_shot: {
    tags: [], synergy: [], conflict: [],
    unique: 'epic',
    values: { epic: { perSecond: 0.08, cap: 0.40 } },
    desc: (v) => `정지 시간에 비례해 총 피해 +${pct(v.perSecond)}/s(최대 +${pct(v.cap)}), 이동 시 초기화 (고유·에픽)`,
  },

  // ══════ 검 축 신규 4종(P8c4) ══════
  berserk_blade: {
    tags: ['하이리스크'], synergy: [], conflict: [],
    values: {
      normal: { swordFrac: 0.15, dmgTakenFrac: 0.10 }, rare: { swordFrac: 0.22, dmgTakenFrac: 0.14 }, unique: { swordFrac: 0.30, dmgTakenFrac: 0.18 },
      legendary: { swordFrac: 0.40, dmgTakenFrac: 0.23 }, epic: { swordFrac: 0.55, dmgTakenFrac: 0.30 },
    },
    desc: (v) => `검 피해 +${pct(v.swordFrac)} · 받는 피해 +${pct(v.dmgTakenFrac)} (하이리스크)`,
  },
  chain_slash: {
    tags: ['연참'], synergy: [], conflict: [],
    values: {
      normal: { cutFrac: 0.03, maxStacks: 5 }, rare: { cutFrac: 0.035, maxStacks: 6 }, unique: { cutFrac: 0.04, maxStacks: 7 },
      legendary: { cutFrac: 0.045, maxStacks: 8 }, epic: { cutFrac: 0.05, maxStacks: 10 },
    },
    desc: (v) => `연속으로 벨수록 검 쿨타임 -${pct(v.cutFrac)}/타(최대 ${v.maxStacks}, -${pct(v.cutFrac * v.maxStacks)}), 멈추면 초기화`,
  },
  sword_focus: {
    tags: ['태세'], synergy: [], conflict: ['gun_focus', 'hybrid_stance'],
    values: {
      normal: { swordFrac: 0.12, gunPenalty: 0.10 }, rare: { swordFrac: 0.18, gunPenalty: 0.13 }, unique: { swordFrac: 0.25, gunPenalty: 0.17 },
      legendary: { swordFrac: 0.34, gunPenalty: 0.22 }, epic: { swordFrac: 0.45, gunPenalty: 0.30 },
    },
    desc: (v) => `검 피해 +${pct(v.swordFrac)} · 총 피해 -${pct(v.gunPenalty)} (총구 집중·총검일체와 상충)`,
  },
  bleed_blade: {
    tags: ['출혈'], role: '부여', synergy: ['blood_trace', 'lifesteal'], conflict: [],
    values: {
      normal: { stacks: 1, durationMult: 1.0 }, rare: { stacks: 1, durationMult: 1.2 }, unique: { stacks: 2, durationMult: 1.0 },
      legendary: { stacks: 2, durationMult: 1.4 }, epic: { stacks: 3, durationMult: 1.0 },
    },
    desc: (v) => `베기 적중 시 출혈 ${v.stacks}중첩 부여${v.durationMult !== 1 ? ` (지속 +${pct(v.durationMult - 1)})` : ''}`,
  },
  blood_trace: {
    tags: ['출혈'], role: '소비', synergy: ['bleed_blade', 'lifesteal'], conflict: [],
    unique: 'legendary',
    values: { legendary: { stacks: 1 } },
    desc: () => '벤 적에게 출혈 1중첩 부여(단독 작동) · 출혈 적을 다시 베면 남은 출혈 잔여 피해가 즉시 폭발한다 (고유·레전더리)',
  },
  execute_blade: {
    tags: [], synergy: [], conflict: [],
    unique: 'epic',
    values: { epic: { executeThreshold: 0.30, bossFrac: 0.06 } },
    desc: (v) => `체력 ${pct(v.executeThreshold)} 이하 일반 적 즉사 · 보스·엘리트에는 최대 체력의 ${pct(v.bossFrac)} 고정 피해 (고유·에픽)`,
  },

  // ══════ 캐릭터 축 신규 4종(P8c4) ══════
  berserker: {
    tags: ['하이리스크'], synergy: [], conflict: [],
    values: {
      normal: { maxHpPenalty: 0.10, dmgTakenFrac: 0.08, allDmgFrac: 0.10 }, rare: { maxHpPenalty: 0.14, dmgTakenFrac: 0.12, allDmgFrac: 0.15 },
      unique: { maxHpPenalty: 0.18, dmgTakenFrac: 0.16, allDmgFrac: 0.21 }, legendary: { maxHpPenalty: 0.23, dmgTakenFrac: 0.21, allDmgFrac: 0.28 },
      epic: { maxHpPenalty: 0.30, dmgTakenFrac: 0.28, allDmgFrac: 0.38 },
    },
    desc: (v) => `최대 체력 -${pct(v.maxHpPenalty)} · 받는 피해 +${pct(v.dmgTakenFrac)} · 모든 피해 +${pct(v.allDmgFrac)} (하이리스크)`,
  },
  reversal: {
    tags: [], synergy: [], conflict: [],
    values: {
      normal: { maxDmgFrac: 0.15, maxSpeedFrac: 0.10 }, rare: { maxDmgFrac: 0.20, maxSpeedFrac: 0.14 }, unique: { maxDmgFrac: 0.27, maxSpeedFrac: 0.18 },
      legendary: { maxDmgFrac: 0.36, maxSpeedFrac: 0.24 }, epic: { maxDmgFrac: 0.48, maxSpeedFrac: 0.32 },
    },
    desc: (v) => `체력이 낮을수록 피해 최대 +${pct(v.maxDmgFrac)} · 이동 속도 최대 +${pct(v.maxSpeedFrac)} (체력 20% 이하에서 포화)`,
  },
  hybrid_stance: {
    tags: ['총검연계', '태세'], synergy: [], conflict: ['gun_focus', 'sword_focus'],
    values: {
      normal: { duration: 1.5, dmgFrac: 0.15 }, rare: { duration: 1.8, dmgFrac: 0.20 }, unique: { duration: 2.1, dmgFrac: 0.27 },
      legendary: { duration: 2.5, dmgFrac: 0.36 }, epic: { duration: 3.0, dmgFrac: 0.48 },
    },
    desc: (v) => `무기 전환 직후 ${v.duration}s간 모든 피해 +${pct(v.dmgFrac)} (총구 집중·검날 집중과 상충)`,
  },
  golden_weight: {
    tags: ['골드'], synergy: [], conflict: [],
    values: {
      normal: { ratePer200: 0.01, cap: 0.15 }, rare: { ratePer200: 0.013, cap: 0.20 }, unique: { ratePer200: 0.017, cap: 0.27 },
      legendary: { ratePer200: 0.022, cap: 0.36 }, epic: { ratePer200: 0.03, cap: 0.50 },
    },
    desc: (v) => `골드 200당 모든 피해 +${pct(v.ratePer200)}(최대 +${pct(v.cap)})`,
  },
  remnant: {
    tags: [], synergy: [], conflict: [],
    unique: 'legendary',
    values: { legendary: { duration: 3, dmgFrac: 0.5 } },
    desc: (v) => `처치 시 ${v.duration}초간 잔상이 남아 현재 총 피해의 ${pct(v.dmgFrac)}로 대신 공격 (고유·레전더리)`,
  },
  // '최후의 저항'(last_stand)은 효과가 약하고 런당 1회라 존재감이 없어
  // 폐지했다(작업 지시 P10 커밋2) — '불굴'(undaunted)로 대체.
  undaunted: {
    tags: [], synergy: [], conflict: [],
    unique: 'epic',
    values: { epic: { capFrac: 0.20 } },
    desc: (v) => `받는 피해가 최대 체력의 ${pct(v.capFrac)}를 넘으면 ${pct(v.capFrac)}로 제한된다(무적 아님, 상시 작동) (고유·에픽)`,
  },
}

export const isUniqueSigil = (id: string) => SIGIL_DEFS[id]?.unique !== undefined

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
  if (!v) return ''
  const base = def.desc(v, grade)
  const epicSuffix = grade === 'epic' && def.epicRule && !def.unique ? ` — ${def.epicRule}` : ''
  return base + epicSuffix
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
 * 각인 등급 5단계(작업 지시 P8 커밋3) — 스택 폐지, 등급으로 일원화. 신규
 * 각인 18종(작업 지시 P8c4) — 총/검/캐릭터 축 각 4종 + 고유 2종(레전더리1·
 * 에픽1). 각인 전부 `apply`는 더 이상 쓰이지 않는다(no-op) — 실제 적용은
 * Player.applySigil(id, grade)가 SIGIL_DEFS를 등급으로 조회해 mods를
 * "누적"이 아니라 "그 등급 값으로 전면 재계산"한다(Player.recomputeSigilMods
 * 참고) — 승급이 이전 등급 효과 위에 쌓이면 안 되기 때문이다. 핵심 슬롯
 * 12종은 등급이 없으므로 apply()가 그대로 유일한 적용 경로다(규칙 2).
 *
 * 각인 3종 교체(작업 지시 P10 커밋2) — 리듬 재장전 폐지로 전제가 사라진
 * '연쇄 장전'(gun 고유·레전더리)과 존재감이 약했던 '최후의 저항'(character
 * 고유·에픽)을 폐지하고 '예비 탄창'(gun 고유·레전더리)·'불굴'(character
 * 고유·에픽)로 각각 대체, '속사 전환'(gun 일반 각인)을 신규 추가했다.
 * 작업 지시 표제는 "각인 25종 유지(총 8/검 8/캐릭터 9)"라고 적었지만,
 * 실제 이 커밋의 항목별 폐지 2종(연쇄 장전·최후의 저항) + 신규 3종(예비
 * 탄창·불굴·속사 전환)을 그대로 반영하면 순증 +1이라 총 26종(gun 9/sword
 * 8/character 9)이 된다 — 지시문 자체의 산술 불일치이며, 표제 숫자를
 * 맞추려 신규 각인 중 하나를 임의로 빼지 않고 항목별 지시를 그대로
 * 따랐다(작업 지시: "예상과 다르면 임의 해석하지 말고 보고하라").
 */
const RAW_POOL: Upgrade[] = [
  // ── 총 각인(gun-sigil) 9종 — 등급 5단계, apply는 no-op(Player.applySigil 참고) ──
  { id: 'reload', name: '신속 장전', desc: describeSigil('reload', 'normal'), icon: '🔁', slot: 'gun-sigil', apply: () => {} },
  { id: 'crit', name: '급소 간파', desc: describeSigil('crit', 'normal'), icon: '💥', slot: 'gun-sigil', apply: () => {} },
  { id: 'blood_bullet', name: '혈탄(血彈)', desc: describeSigil('blood_bullet', 'normal'), icon: '🩸', slot: 'gun-sigil', apply: () => {} },
  { id: 'overheat', name: '과열', desc: describeSigil('overheat', 'normal'), icon: '🔥', slot: 'gun-sigil', apply: () => {} },
  { id: 'gun_focus', name: '총구 집중', desc: describeSigil('gun_focus', 'normal'), icon: '🎯', slot: 'gun-sigil', apply: () => {} },
  { id: 'shock_bullet', name: '감전 탄환', desc: describeSigil('shock_bullet', 'normal'), icon: '⚡', slot: 'gun-sigil', apply: () => {} },
  { id: 'rapid_reload', name: '속사 전환', desc: describeSigil('rapid_reload', 'normal'), icon: '💨', slot: 'gun-sigil', apply: () => {} },
  { id: 'reserve_mag', name: '예비 탄창', desc: describeSigil('reserve_mag', 'legendary'), icon: '🧰', slot: 'gun-sigil', apply: () => {} },
  { id: 'zero_shot', name: '영점 사격', desc: describeSigil('zero_shot', 'epic'), icon: '🧊', slot: 'gun-sigil', apply: () => {} },

  // ── 검 각인(sword-sigil) 6종 ──
  { id: 'crit_dmg', name: '처형인', desc: describeSigil('crit_dmg', 'normal'), icon: '☠️', slot: 'sword-sigil', apply: () => {} },
  { id: 'lifesteal', name: '흡혈', desc: describeSigil('lifesteal', 'normal'), icon: '🩸', slot: 'sword-sigil', apply: () => {} },
  { id: 'berserk_blade', name: '광전(狂戰)', desc: describeSigil('berserk_blade', 'normal'), icon: '💢', slot: 'sword-sigil', apply: () => {} },
  { id: 'chain_slash', name: '연참 가속', desc: describeSigil('chain_slash', 'normal'), icon: '🌀', slot: 'sword-sigil', apply: () => {} },
  { id: 'sword_focus', name: '검날 집중', desc: describeSigil('sword_focus', 'normal'), icon: '🗡️', slot: 'sword-sigil', apply: () => {} },
  { id: 'bleed_blade', name: '출혈 칼날', desc: describeSigil('bleed_blade', 'normal'), icon: '🔪', slot: 'sword-sigil', apply: () => {} },
  { id: 'blood_trace', name: '혈흔', desc: describeSigil('blood_trace', 'legendary'), icon: '🌹', slot: 'sword-sigil', apply: () => {} },
  { id: 'execute_blade', name: '일도양단', desc: describeSigil('execute_blade', 'epic'), icon: '⚔️', slot: 'sword-sigil', apply: () => {} },

  // ── 캐릭터 각인(character-sigil) 7종 ──
  // '전투의 깨달음'(xp_gain, 경험치 획득량 +10%)은 작업 지시 P7 커밋1에서
  // 경험치 체계 자체가 폐지되며 함께 삭제됐다(8→7종).
  { id: 'hp', name: '강인한 육체', desc: describeSigil('hp', 'normal'), icon: '❤️', slot: 'character-sigil', apply: () => {} },
  { id: 'speed', name: '경신법', desc: describeSigil('speed', 'normal'), icon: '👟', slot: 'character-sigil', apply: () => {} },
  { id: 'lg_detonator', name: '⭐ 폭심(爆心)', desc: describeSigil('lg_detonator', 'normal'), icon: '💣', slot: 'character-sigil', apply: () => {} },
  { id: 'berserker', name: '광전사', desc: describeSigil('berserker', 'normal'), icon: '👹', slot: 'character-sigil', apply: () => {} },
  { id: 'reversal', name: '역전', desc: describeSigil('reversal', 'normal'), icon: '🔃', slot: 'character-sigil', apply: () => {} },
  { id: 'hybrid_stance', name: '총검일체', desc: describeSigil('hybrid_stance', 'normal'), icon: '🎭', slot: 'character-sigil', apply: () => {} },
  { id: 'golden_weight', name: '황금의 무게', desc: describeSigil('golden_weight', 'normal'), icon: '💰', slot: 'character-sigil', apply: () => {} },
  { id: 'remnant', name: '잔재', desc: describeSigil('remnant', 'legendary'), icon: '👻', slot: 'character-sigil', apply: () => {} },
  { id: 'undaunted', name: '불굴', desc: describeSigil('undaunted', 'epic'), icon: '🛡️', slot: 'character-sigil', apply: () => {} },

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
  const metadata = SIGIL_DEFS[u.id]
  return {
    ...u,
    desc: describeSigil(u.id, grade),
    grade,
    tags: metadata.tags,
    role: metadata.role,
    synergy: metadata.synergy,
    conflict: metadata.conflict,
  }
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
 * 각인은 더 승급할 수 없어 후보에서 빠진다. 고유 각인(unique)은 이 경로로
 * 절대 나오지 않는다(작업 지시 P8c4 — "승급으로 도달할 수 없다", 해당 등급이
 * 열린 노드에서만 등장) — sigilOffers를 만들 때부터 걸러낸다.
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
  for (const u of POOL.filter((u) => isSigilSlot(u.slot) && !isUniqueSigil(u.id))) {
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
 * "교체 = 등가 교환"이라는 제련소의 취지 자체는 안 바뀌었다). 고유 각인은
 * 여기서도 후보로 나오지 않는다 — 노드 전용이라 등가 교환 개념이 성립하지
 * 않는다(다른 등급에서 얻을 방법 자체가 없다).
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
      if (isUniqueSigil(u.id)) return false
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
 * 맵 노드(각인/상위 전투/엘리트/보스) 보상 각인 선택지(작업 지시 P8 커밋3,
 * 고유 각인은 P8c4에서 추가). count는 3(엘리트는 4).
 *
 * 일반 각인(20종)의 후보는 "그 노드 등급(nodeGrade)에 아직 못 미친" 것만 —
 * 미보유면 nodeGrade로 직행, 보유 중이면 nodeGrade로 승급(현재 등급이
 * nodeGrade보다 낮을 때만 후보) — 이미 nodeGrade 이상이면 후보에서 빠진다
 * (상한 규칙, 더 낮은 노드로는 채울 수 없다).
 *
 * 고유 각인(6종)은 다르게 취급한다 — "해당 등급이 열린 노드에서만 등장"
 * (work order): 이 노드의 등급이 그 고유 각인의 고정 등급 이상으로 올라선
 * 순간부터 후보에 들어가고(예: 노드가 레전더리 이상이면 레전더리 고유 각인이
 * 후보에 들어간다), 항상 자신의 고정 등급으로만 제안한다(nodeGrade로 직행하지
 * 않는다 — "획득 시점의 등급으로 고정되며 더 이상 승급하지 않는다"). 이미
 * 보유했으면(고유는 등급이 하나뿐이라 보유 = 최종) 다시 후보에 들어가지 않는다.
 *
 * "최소 1장은 확정 이득": 각인 후보(sigilCandidates)가 하나라도 있으면
 * 최소 1장은 반드시 그중에서 뽑는다 — 각인 후보는 전부 미보유 획득 또는
 * 실제 승급이라 항상 이득이지만(스택 상한 개념이 사라져 손해 볼 카드가
 * 없다), 핵심 슬롯 교체 후보는 "다른 걸로 바꾸는" 선택이라 이득이 보장되지
 * 않는다 — 그래서 순서상 각인을 항상 먼저 채운다.
 * 각인 20종(고유 제외)을 전부 nodeGrade 이상으로 이미 보유한 극단적인 경우
 * (일반 각인 후보가 0개, 고유도 없거나 이미 보유)에는 작업 지시에 명시된
 * 대체 규칙이 없어, 핵심 슬롯 후보(빈 슬롯 → 교체 후보 순)로 채운다 —
 * 아무 보상도 없는 것보다는 낫다는 판단이며, 별도 규칙이 필요하면 설계
 * 판단이 있어야 한다(DESIGN_LOG.md에 기록).
 */
export function rollNodeSigilRewards(
  count: number,
  nodeGrade: Grade,
  sigilGrades: ReadonlyMap<string, Grade>,
  coreSlots: ReadonlyMap<CoreSlot, string> = new Map(),
): Upgrade[] {
  const sigilCandidates: Upgrade[] = []
  for (const u of POOL.filter((u) => isSigilSlot(u.slot))) {
    const def = SIGIL_DEFS[u.id]
    const cur = sigilGrades.get(u.id)
    if (def?.unique) {
      if (!cur && gradeIndex(nodeGrade) >= gradeIndex(def.unique)) sigilCandidates.push(offerSigil(u, def.unique))
    } else if (!cur || gradeAbove(nodeGrade, cur)) {
      sigilCandidates.push(offerSigil(u, nodeGrade))
    }
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
