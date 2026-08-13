import * as THREE from 'three'
import { CONFIG } from '../config'
import { Input } from '../core/Input'
import { CharacterSprite } from './CharacterSprite'
import { GunDef, SwordDef, START_GUN, START_SWORD } from '../systems/Weapons'
import { MetaBonuses } from '../systems/MetaProgression'
import type { CoreSlot, UpgradeSlot, Grade } from '../systems/Upgrades'
import { isSigilSlot, isUniqueSigil, GRADES, gradeAbove, SIGIL_DEFS } from '../systems/Upgrades'

/** 무기 정의 × 특성 배수로 산출되는 실효 스탯 */
export interface PlayerStats {
  maxHp: number
  moveSpeed: number
  dashCooldown: number
  // 총
  gunDamage: number
  gunCooldown: number
  bulletSpeed: number
  pierce: number
  multishot: number
  spread: number
  magSize: number
  reloadTime: number
  // 검
  swordDamage: number
  swordRange: number
  swordCooldown: number
  swordArc: number
  knockback: number
  lunge: number
  // 공통
  critChance: number
  critMult: number
  lifesteal: number
}

/** 특성이 누적하는 배수/가산치 + 레전더리 특수 효과 플래그 */
export interface Mods {
  gunDamage: number // ×
  gunCooldown: number // ×
  bulletSpeed: number // ×
  reloadTime: number // ×
  pierce: number // +
  multishot: number // +
  swordDamage: number // ×
  swordRange: number // ×
  swordCooldown: number // ×
  moveSpeed: number // ×
  dashCooldown: number // ×
  maxHp: number // +
  critChance: number // +
  critMult: number // 기본 2, +
  lifesteal: number // +
  // 레전더리 특수
  explodeOnKill: number // >0이면 처치 시 폭발 데미지
  swordReloads: boolean // 검을 휘두르면 총 즉시 장전 (총검일체 전용, 발도장전은 기본 메커니즘으로 이관)
  dashStrike: number // >0이면 대시 종료 시 주변 데미지
  // 검 적중 시 장전 (기본 메커니즘 — 발도장전은 이 값들을 강화한다)
  swordReloadAmount: number // 검이 적을 맞히면 장전되는 총알 수 (기본 1)
  swordReloadBurstBonus: number // >0이면 검으로 장전한 직후 발사하는 총알 N발의 피해 배율 보너스
  // 각인 등급 5단계(작업 지시 P8 커밋3) — 에픽 전용 규칙 변경. '신속 장전'의
  // 규칙 변경("리듬 성공 구간 확대")은 리듬 장전 폐지로 함께 제거했다
  // (작업 지시 P10 커밋1) — 수치(-50%)만 reloadTime mult로 남는다.
  detonatorChain: boolean // '폭심' 에픽 — 폭발로 죽은 적이 있으면 그 자리에서 한 번 더 연쇄 폭발

  // ══════ 신규 각인 18종(작업 지시 P8c4) ══════
  damageTakenMult: number // × (기본 1) — 광전/광전사가 올린다. Player.takeDamage()에서만 읽는다(stats 밖).
  allDamageMult: number // × (기본 1) — 광전사의 "모든 피해" 정적 기여분(동적 배수는 recompute()가 별도로 더한다)
  maxHpMult: number // × (기본 1) — 광전사가 최대 체력을 깎는다
  hpCostPerShot: number // + (기본 0) — 혈탄: 발사마다 소모하는 체력
  overheatStackFrac: number // 과열: 스택 1개당 피해 배율 가산
  overheatMaxStacks: number
  chainSlashCutFrac: number // 연참 가속: 연속 타격 1회당 검 쿨타임 배율 감산
  chainSlashMaxStacks: number
  shockOnHitChance: number // 감전 탄환: 사격 명중 시 감전 부여 확률
  shockOnHitDuration: number
  bleedOnHitStacks: number // 출혈 칼날: 베기 적중 시 부여할 출혈 중첩 수
  bleedOnHitDurationMult: number
  bloodTraceOwned: boolean // '혈흔'(고유) — 벤 적에게 출혈 부여 + 이미 출혈 중이면 잔여 피해 폭발
  executeBladeOwned: boolean // '일도양단'(고유)
  executeThreshold: number // 이 체력 비율 이하 일반 적 즉사
  executeBossFrac: number // 보스·엘리트에게 최대 체력의 이 비율만큼 고정 피해
  zeroShotPerSecond: number // '영점 사격'(고유) — 정지 시간당 총 피해 가산율
  zeroShotCap: number
  reversalMaxDmgFrac: number // 역전 — 체력 20% 이하에서 포화하는 최대 피해/이속 가산(동적, recompute()가 매 프레임 재계산)
  reversalMaxSpeedFrac: number
  hybridStanceDuration: number // 총검일체 — 무기 전환 직후 지속시간/피해 가산(동적)
  hybridStanceDmgFrac: number
  goldWeightRate: number // 황금의 무게 — 골드 200당 피해 가산율(동적, 상한 있음)
  goldWeightCap: number
  remnantOwned: boolean // '잔재'(고유) — Game.killEnemy()가 읽어 잔상 공격체를 스폰한다
  remnantDuration: number
  remnantDmgFrac: number

  // ══════ 각인 3종 교체(작업 지시 P10 커밋2) ══════
  reserveMagOwned: boolean // '예비 탄창'(고유) — Player.startReload()에서 충전 소모로 즉시 완료
  reserveMagMaxCharges: number
  rapidReloadDuration: number // '속사 전환' — 재장전 완료 직후 지속시간/사격 쿨타임 감산(동적)
  rapidReloadCutFrac: number
  undauntedOwned: boolean // '불굴'(고유) — Player.takeDamage()에서 받는 피해를 최대 체력 비율로 상한
  undauntedCapFrac: number
}

function freshMods(): Mods {
  return {
    gunDamage: 1, gunCooldown: 1, bulletSpeed: 1, reloadTime: 1, pierce: 0, multishot: 0,
    swordDamage: 1, swordRange: 1, swordCooldown: 1, moveSpeed: 1, dashCooldown: 1,
    maxHp: 0, critChance: 0, critMult: 2, lifesteal: 0,
    explodeOnKill: 0, swordReloads: false, dashStrike: 0,
    // '발도장전'(lg_quickdraw)이 기본 메커니즘으로 승격됐다(작업 지시
    // slot_system_phase1 커밋 3) — 검 적중 직후 총알 3발에 항상 +30% 피해.
    swordReloadAmount: 1, swordReloadBurstBonus: 0.3,
    detonatorChain: false,
    damageTakenMult: 1, allDamageMult: 1, maxHpMult: 1, hpCostPerShot: 0,
    overheatStackFrac: 0, overheatMaxStacks: 0, chainSlashCutFrac: 0, chainSlashMaxStacks: 0,
    shockOnHitChance: 0, shockOnHitDuration: 0, bleedOnHitStacks: 0, bleedOnHitDurationMult: 1,
    bloodTraceOwned: false, executeBladeOwned: false, executeThreshold: 0, executeBossFrac: 0,
    zeroShotPerSecond: 0, zeroShotCap: 0,
    reversalMaxDmgFrac: 0, reversalMaxSpeedFrac: 0, hybridStanceDuration: 0, hybridStanceDmgFrac: 0,
    goldWeightRate: 0, goldWeightCap: 0,
    remnantOwned: false, remnantDuration: 0, remnantDmgFrac: 0,
    reserveMagOwned: false, reserveMagMaxCharges: 0,
    rapidReloadDuration: 0, rapidReloadCutFrac: 0,
    undauntedOwned: false, undauntedCapFrac: 0,
  }
}

export interface BulletSpec {
  pos: THREE.Vector3
  dir: THREE.Vector3
  damage: number
  crit: boolean
  /** '마지막 한발'(gun) — 명중 시 주변에 넉백 충격파를 일으킨다(Game.resolveBullets()). */
  shockwave?: boolean
}

export interface SlashSpec {
  pos: THREE.Vector3
  angle: number
  arc: number
  range: number
  damage: number
  crit: boolean
  knockback: number
}

/** 총검사 플레이어 */
export class Player {
  group: THREE.Group
  pos = new THREE.Vector3(0, 0, 0)
  vel = new THREE.Vector3()
  angle = 0 // 바라보는 방향(라디안, +Z 기준)
  hp = 0
  stats: PlayerStats
  mods: Mods = freshMods()
  /** 런 동안 획득한 각인(sigil)별 등급(작업 지시 P8 커밋3 — 스택 폐지, 등급으로
   * 일원화). 각인 하나당 등급 하나만 존재한다 — 승급은 이 맵의 값을 교체할
   * 뿐, 누적하지 않는다. 핵심 슬롯 특성은 여기 들어가지 않는다(등급이 없다). */
  sigilGrades = new Map<string, Grade>()
  /** 핵심 슬롯(gun/sword/character) → 보유 중인 특성 id. 슬롯당 1개만 보유한다. */
  coreSlots = new Map<CoreSlot, string>()
  gun: GunDef = START_GUN
  sword: SwordDef = START_SWORD
  private meta: MetaBonuses
  private revivesRemaining = 0
  private wardReady = false
  /** 마지막 피격의 영구 성장 이벤트. HUD 연출에서만 읽고 게임 로직에는 의존하지 않는다. */
  lastDamageEvent: 'none' | 'ward' | 'hit' | 'revive' | 'dead' | 'dashBlock' = 'none'

  alive = true

  private gunTimer = 0
  private swordTimer = 0
  /** 검 스윙 커밋 — 이 값이 남아있는 동안 이동 입력/조준 방향 전환/대시가 막힌다 */
  private swingCommitTimer = 0
  private dashTimer = 0
  private dashCdTimer = 0
  private dashDir = new THREE.Vector3()
  /** 대시 시작 지점 — '표식'이 대시 종료 시 시작~끝 선분으로 관통 판정할 때 쓴다 */
  dashStart = new THREE.Vector3()
  /** '발도참'(slash) 발동 게이지 — 정지 상태 지속 시간 */
  private stillTimer = 0
  /** '조준사격'(shot) 발동 게이지 — 마지막 발사 이후 경과 시간 */
  private aimPauseTimer = 0
  /** '급전환'(dash) 버프 — 대시 종료 직후 남은 지속시간 */
  private quickSwitchTimer = 0
  /** 잔영(dash) - 이번 대시에서 이미 쿨타임을 초기화했는지(대시 1회당 최대 1회) */
  private afterimageDashRefreshed = false
  private movementSlowTimer = 0
  private movementSlowMultiplier = 1
  private invuln = 0
  private hitFlash = 0
  private walkPhase = 0
  private char!: CharacterSprite
  private moving = false
  private shootAnim = 0

  // 탄약/장전
  magSize = START_GUN.magSize
  ammo = START_GUN.magSize
  reloading = false
  private reloadTimer = 0
  private swordReloadBurstShotsLeft = 0

  // ══════ 신규 각인 18종의 동적 상태(작업 지시 P8c4) — 스택/타이머는 등급별
  // 정적 수치(mods)와 분리해 여기서 직접 관리한다. recompute()가 매 프레임
  // 다시 불려도(총검일체/역전/황금의 무게처럼 매 순간 값이 바뀌는 보너스가
  // 있어서) 이 필드들 자체는 "현재 상태"만 가리킬 뿐 누적 적용되지 않는다. ──
  private currentGold = 0
  /** '영점 사격' — 정지(이동/대시 없음) 지속시간. iaijutsu의 stillTimer와
   * 발동 조건은 같지만, 발동 시 리셋되는 stillTimer와 달리 이건 총 축
   * 전용이라 검 특성과 소모 시점이 얽히면 안 돼 별도로 둔다. */
  private zeroShotTimer = 0
  /** '과열' — 재장전 없이 연속 사격한 발수(상한 있음), 장전 시작 시 0으로. */
  private overheatStacks = 0
  /** '연참 가속' — 연속으로 벤 횟수(상한 있음), 일정 시간 베기가 없으면 0으로. */
  private chainSlashStacks = 0
  private chainSlashIdleTimer = 0
  /** '총검일체' — 남은 버프 지속시간. */
  private hybridStanceTimer = 0
  /** "마지막으로 사용한 무기" — 총검일체의 "전환" 정의(work order 확정):
   * 총을 쏘다 베면 전환, 베다가 쏘면 전환이다. */
  private lastWeaponUsed: 'gun' | 'sword' | null = null
  /** '예비 탄창'(고유·레전더리, 작업 지시 P10) — 런 동안 보유한 충전 수.
   * Game이 상인 노드·보스 준비방 최초 입장 시 grantReserveMagCharge()로
   * 채운다(상한은 mods.reserveMagMaxCharges). */
  private reserveMagCharges = 0
  /** '속사 전환' — 재장전 완료 직후 남은 버프 지속시간. */
  private rapidReloadTimer = 0

  constructor(meta: MetaBonuses = { gunDamageMultiplier: 1, swordDamageMultiplier: 1, maxHpFlat: 0, revives: 0, wardReady: false }) {
    this.meta = meta
    this.revivesRemaining = meta.revives
    this.wardReady = meta.wardReady
    this.char = new CharacterSprite(this.gun.id, this.sword.id)
    this.group = this.char.object
    this.stats = {} as PlayerStats
    this.recompute()
    this.hp = this.stats.maxHp
    this.ammo = this.magSize
  }

  /** 동적 각인 배수를 적용하기 전의 "정적" 기준값(mods만 반영) — updateDynamicStats()가
   * 매 프레임 이 값에 곱해서 stats.gunDamage/swordDamage/moveSpeed만 갱신한다. */
  private baseGunDamage = 0
  private baseSwordDamage = 0
  private baseMoveSpeed = 0
  private baseGunCooldown = 0

  /**
   * 무기 정의 × 특성 배수 → 실효 스탯 재계산. mods(등급별 정적 수치)가
   * 바뀔 때만(장비 교체·각인 획득·메타 강화) 호출한다 — QC 하네스가 종종
   * `player.stats.X = ...`로 특정 스탯을 직접 덮어써 무작위성(치명타 등)을
   * 배제하는 관례가 있어서, 이 메서드를 아무 때나(예: 매 프레임) 다시
   * 부르면 그 덮어쓴 값이 원상복구돼버린다 — 실제로 QC에서 재현됐다(리듬
   * 장전 보너스 검증이 강제로 꺼둔 크리티컬이 되살아나 피해량이 들쭉날쭉
   * 해졌다). 매 순간 값이 바뀌는 각인(역전/총검일체/황금의 무게/영점
   * 사격/속사 전환)은 updateDynamicStats()가 담당한다 — 이 메서드가 매번
   * stats 전체를 새로 만들지 않고 gunDamage/swordDamage/moveSpeed/
   * gunCooldown 네 필드만 건드리는 이유가 바로 그 격리다.
   */
  recompute() {
    const m = this.mods
    const g = this.gun
    const s = this.sword
    this.stats = {
      maxHp: (CONFIG.player.maxHp + this.meta.maxHpFlat + m.maxHp) * m.maxHpMult,
      moveSpeed: CONFIG.player.speed * m.moveSpeed,
      dashCooldown: Math.max(CONFIG.player.dashCooldown * 0.45, CONFIG.player.dashCooldown * m.dashCooldown),
      gunDamage: g.damage * this.meta.gunDamageMultiplier * m.gunDamage * m.allDamageMult,
      gunCooldown: Math.max(g.cooldown * 0.35, g.cooldown * m.gunCooldown),
      bulletSpeed: g.bulletSpeed * m.bulletSpeed,
      pierce: g.pierce + m.pierce,
      multishot: g.pellets + m.multishot,
      spread: g.spread,
      magSize: g.magSize,
      reloadTime: g.reloadTime * m.reloadTime,
      swordDamage: s.damage * this.meta.swordDamageMultiplier * m.swordDamage * m.allDamageMult,
      swordRange: s.range * m.swordRange,
      swordCooldown: Math.max(s.cooldown * 0.4, s.cooldown * m.swordCooldown),
      swordArc: s.arc,
      knockback: s.knockback,
      lunge: s.lunge,
      critChance: Math.min(1, 0.1 + m.critChance),
      critMult: m.critMult,
      lifesteal: m.lifesteal,
    }
    this.magSize = this.stats.magSize
    if (this.hp > 0) this.hp = Math.min(this.hp, this.stats.maxHp)
    this.baseGunDamage = this.stats.gunDamage
    this.baseSwordDamage = this.stats.swordDamage
    this.baseMoveSpeed = this.stats.moveSpeed
    this.baseGunCooldown = this.stats.gunCooldown
    this.updateDynamicStats() // 방금 정한 기준값에도 현재 동적 보너스를 바로 반영
  }

  /**
   * 체력·골드·타이머처럼 매 프레임 값이 바뀌는 동적 각인 보너스만 갱신한다
   * — Player.update()가 매 프레임 끝에서 부른다. gunDamage/swordDamage/
   * moveSpeed/gunCooldown 네 필드만 baseGunDamage 등 "정적 기준값 × 이
   * 순간의 배수"로 다시 쓸 뿐, stats의 다른 필드(critChance 등)는 절대
   * 건드리지 않는다 — recompute()와의 역할 분리가 이 메서드의 존재
   * 이유다(주석 위 recompute() 참고).
   */
  private updateDynamicStats() {
    const m = this.mods
    // 이전 프레임 결과인 this.stats.maxHp를 체력 비율 기준으로 쓴다(이번
    // 프레임의 baseGunDamage 등은 이미 recompute()에서 정해졌으므로 순환
    // 참조가 없다 — 프레임 간 오차는 무시할 수준이다).
    const maxHp = this.stats.maxHp > 0 ? this.stats.maxHp : CONFIG.player.maxHp
    const hpFrac = this.hp > 0 ? Math.min(1, this.hp / maxHp) : 1
    // 역전(work order ③) — 체력 20% 이하에서 포화, 100%에서 0. 20%~100% 선형.
    const reversalT = Math.max(0, Math.min(1, (1 - hpFrac) / 0.8))
    const reversalDmgFrac = m.reversalMaxDmgFrac * reversalT
    const reversalSpeedFrac = m.reversalMaxSpeedFrac * reversalT
    const goldWeightFrac = m.goldWeightRate > 0 ? Math.min(m.goldWeightCap, (this.currentGold / 200) * m.goldWeightRate) : 0
    const hybridFrac = this.hybridStanceTimer > 0 ? m.hybridStanceDmgFrac : 0
    const zeroShotFrac = m.zeroShotPerSecond > 0 ? Math.min(m.zeroShotCap, this.zeroShotTimer * m.zeroShotPerSecond) : 0
    // "모든 피해"류 동적 가산은 총/검 양쪽에 함께 곱한다 — 영점 사격만 총 축
    // 전용이라 별도로 gunDamage에만 더한다.
    // hybridFrac(총검일체)은 gun_focus/sword_focus(m.gunDamage/m.swordDamage에
    // 곱셈으로 누적, recomputeSigilMods() 참고)와 달리 여기 덧셈 항으로
    // 들어간다 — 셋을 동시에 들면 (gun_focus×sword_focus로 정해진 base) ×
    // (1+hybridFrac+...) 형태가 된다. 완화·상쇄 로직이 아니라 서로 다른
    // 배율 계층(정적 mods 곱셈 vs 동적 상황 가산)이 겹치는 것뿐이다.
    const dynamicAllMult = 1 + reversalDmgFrac + goldWeightFrac + hybridFrac
    this.stats.gunDamage = this.baseGunDamage * dynamicAllMult * (1 + zeroShotFrac)
    this.stats.swordDamage = this.baseSwordDamage * dynamicAllMult
    this.stats.moveSpeed = this.baseMoveSpeed * (1 + reversalSpeedFrac)
    // '속사 전환'(작업 지시 P10) — 재장전 완료 직후 지속시간 동안 사격 쿨타임 감소.
    const rapidReloadMult = this.rapidReloadTimer > 0 ? 1 - m.rapidReloadCutFrac : 1
    this.stats.gunCooldown = this.baseGunCooldown * rapidReloadMult
  }

  /** Game이 매 프레임 현재 런 골드를 알려준다 — '황금의 무게'가 이 값을 읽는다. */
  setGold(gold: number) {
    this.currentGold = gold
  }

  hasCoreSlotTrait(id: string) {
    for (const v of this.coreSlots.values()) if (v === id) return true
    return false
  }

  /**
   * 각인은 이미 에픽이 아닌 한 계속 획득/승급 가능(작업 지시 P8 커밋3 —
   * 스택 상한을 등급 상한으로 교체). 고유 각인(작업 지시 P8c4)은 등급이
   * 하나뿐이라 한 번 보유하면 그걸로 끝이다 — "승급으로 도달할 수 없고
   * 더 이상 승급하지 않는다"는 규칙을 여기서도 방어적으로 한 번 더 막는다
   * (제안 생성 쪽이 이미 소유한 고유 각인을 후보로 내지 않지만). 핵심 슬롯
   * 특성은 슬롯당 1개뿐이라 "이미 이 특성을 보유 중이 아님"이 곧 획득 가능
   * 조건이다(다른 특성으로 슬롯을 교체하는 것은 별도 UI가 처리한다).
   */
  canAcquireTrait(u: { id: string; slot: UpgradeSlot }) {
    if (isSigilSlot(u.slot)) {
      if (isUniqueSigil(u.id)) return !this.sigilGrades.has(u.id)
      return this.sigilGrades.get(u.id) !== 'epic'
    }
    return !this.hasCoreSlotTrait(u.id)
  }

  /**
   * 각인 획득/승급(작업 지시 P8 커밋3). 스택처럼 누적 apply()를 반복
   * 호출하지 않는다 — sigilGrades에 등급만 갱신하고 recomputeSigilMods()가
   * "현재 보유한 모든 각인의 현재 등급"으로 관련 mods 필드를 매번 처음부터
   * 다시 계산한다. 이미 보유한 등급보다 낮거나 같은 등급을 넘기면 무시한다
   * (제안 생성 쪽이 항상 상위 등급만 제안하지만, 방어적으로 한 번 더 막는다).
   */
  applySigil(id: string, grade: Grade) {
    const cur = this.sigilGrades.get(id)
    if (cur && !gradeAbove(grade, cur)) return
    this.sigilGrades.set(id, grade)
    this.recomputeSigilMods()
    // '강인한 육체'(hp) 고유 취지 유지 — 이 각인을 획득/승급했을 때만 완전 회복한다
    // (다른 각인을 고를 때마다 매번 풀피가 되는 부수효과를 만들지 않는다).
    if (id === 'hp' && this.hp > 0) this.hp = this.stats.maxHp
    // '예비 탄창'(고유·레전더리, 작업 지시 P10) — 획득 즉시 충전 1회를 준다.
    // 그러지 않으면 다음 상인 노드·보스 준비방까지 순수하게 죽은 각인이다
    // (고유 각인 규칙: "다른 각인에 의존하면 안 나올 때 죽은 각인이 된다"는
    // P8c4의 취지를 여기도 그대로 적용한다).
    if (id === 'reserve_mag' && !cur) this.reserveMagCharges = Math.min(this.mods.reserveMagMaxCharges, this.reserveMagCharges + 1)
  }

  /**
   * 각인 기여분을 전부 초기화한 뒤 sigilGrades에 있는 모든 각인을 현재
   * 등급 값으로 다시 더한다 — "승급"이 이전 등급의 효과 위에 쌓이면 안
   * 되기 때문에(등급은 스택이 아니다), 매번 전체를 재구성한다. 신규 각인
   * 18종(작업 지시 P8c4)은 파라미터 이름이 각인마다 달라(Upgrades.ts
   * SIGIL_DEFS 참고) 공용 `field` 스위치 하나로 묶을 수 없어 id별로
   * 분기한다 — 값의 "정적" 부분(등급 수치)만 여기서 mods에 반영하고,
   * "동적" 부분(체력/골드/타이머에 따라 매 순간 바뀌는 실제 배수)은
   * Player.recompute()가 매 프레임 이 mods 값을 읽어 다시 계산한다.
   */
  private recomputeSigilMods() {
    const m = this.mods
    m.maxHp = 0
    m.critChance = 0
    m.critMult = 2
    m.lifesteal = 0
    m.explodeOnKill = 0
    m.moveSpeed = 1
    m.reloadTime = 1
    m.gunDamage = 1
    m.swordDamage = 1
    m.detonatorChain = false
    m.damageTakenMult = 1
    m.allDamageMult = 1
    m.maxHpMult = 1
    m.hpCostPerShot = 0
    m.overheatStackFrac = 0
    m.overheatMaxStacks = 0
    m.chainSlashCutFrac = 0
    m.chainSlashMaxStacks = 0
    m.shockOnHitChance = 0
    m.shockOnHitDuration = 0
    m.bleedOnHitStacks = 0
    m.bleedOnHitDurationMult = 1
    m.bloodTraceOwned = false
    m.executeBladeOwned = false
    m.executeThreshold = 0
    m.executeBossFrac = 0
    m.zeroShotPerSecond = 0
    m.zeroShotCap = 0
    m.reversalMaxDmgFrac = 0
    m.reversalMaxSpeedFrac = 0
    m.hybridStanceDuration = 0
    m.hybridStanceDmgFrac = 0
    m.goldWeightRate = 0
    m.goldWeightCap = 0
    m.remnantOwned = false
    m.remnantDuration = 0
    m.remnantDmgFrac = 0
    m.reserveMagOwned = false
    m.reserveMagMaxCharges = 0
    m.rapidReloadDuration = 0
    m.rapidReloadCutFrac = 0
    m.undauntedOwned = false
    m.undauntedCapFrac = 0

    for (const [id, grade] of this.sigilGrades) {
      const def = SIGIL_DEFS[id]
      const v = def?.values[grade]
      if (!def || !v) continue
      switch (id) {
        // ── 기존 7종 ──
        case 'reload': m.reloadTime *= 1 - v.frac; break
        case 'crit': m.critChance += v.frac; break
        case 'crit_dmg': m.critMult += v.amount; break
        case 'lifesteal': m.lifesteal += v.frac; break
        case 'hp': m.maxHp += v.amount; break
        case 'speed': m.moveSpeed *= 1 + v.frac; break
        case 'lg_detonator':
          m.explodeOnKill += v.amount
          if (grade === 'epic') m.detonatorChain = true
          break
        // ── 총 축 신규 ──
        case 'blood_bullet':
          m.gunDamage *= 1 + v.dmgFrac
          m.hpCostPerShot += v.hpCost
          break
        case 'overheat':
          m.overheatStackFrac = v.stackFrac
          m.overheatMaxStacks = v.maxStacks
          break
        // 상충 각인 연산 검증(작업 지시 P10 커밋3-4) — gun_focus·sword_focus는
        // 둘 다 m.gunDamage/m.swordDamage에 *=(곱셈)로 누적된다. sigilGrades는
        // Map이라 순회 순서가 등급 부여 순서지만, 곱셈은 교환법칙이 성립해
        // 어느 쪽을 먼저 걸어도 최종 배율은 같다(에픽×에픽 기준
        // 1.45×0.70=1.015 — 상쇄에 가깝지만 정확히 1.0은 아니다, 완화 로직
        // 없음이 의도). hybrid_stance(총검일체)는 이 둘과 다른 방식으로
        // 상충한다 — m.gunDamage/m.swordDamage가 아니라 dynamicAllMult(아래
        // updateDynamicStats() 참고)에 덧셈으로 들어가는 별도 배수라, 최종
        // 배율은 (gun_focus×sword_focus로 정해진 기준값) × (1+hybridFrac)
        // 형태로 곱셈-덧셈이 섞인다. 세 각인을 모두 에픽으로 동시에 들고
        // hybrid_stance가 발동 중이면 최종 배율은 약 1.015×1.48≈1.50이
        // 되는 게 의도한 결과다(QC 'conflict-triple' 스텝에서 실측 검증).
        case 'gun_focus':
          m.gunDamage *= 1 + v.gunFrac
          m.swordDamage *= 1 - v.swordPenalty
          break
        case 'shock_bullet':
          m.shockOnHitChance = v.chance
          m.shockOnHitDuration = v.duration
          break
        case 'reserve_mag':
          m.reserveMagOwned = true
          m.reserveMagMaxCharges = v.maxCharges
          break
        case 'rapid_reload':
          m.rapidReloadDuration = v.duration
          m.rapidReloadCutFrac = v.cutFrac
          break
        case 'zero_shot':
          m.zeroShotPerSecond = v.perSecond
          m.zeroShotCap = v.cap
          break
        // ── 검 축 신규 ──
        case 'berserk_blade':
          m.swordDamage *= 1 + v.swordFrac
          m.damageTakenMult *= 1 + v.dmgTakenFrac
          break
        case 'chain_slash':
          m.chainSlashCutFrac = v.cutFrac
          m.chainSlashMaxStacks = v.maxStacks
          break
        case 'sword_focus':
          m.swordDamage *= 1 + v.swordFrac
          m.gunDamage *= 1 - v.gunPenalty
          break
        case 'bleed_blade':
          m.bleedOnHitStacks = v.stacks
          m.bleedOnHitDurationMult = v.durationMult
          break
        case 'blood_trace': m.bloodTraceOwned = true; break
        case 'execute_blade':
          m.executeBladeOwned = true
          m.executeThreshold = v.executeThreshold
          m.executeBossFrac = v.bossFrac
          break
        // ── 캐릭터 축 신규 ──
        case 'berserker':
          m.maxHpMult *= 1 - v.maxHpPenalty
          m.damageTakenMult *= 1 + v.dmgTakenFrac
          m.allDamageMult *= 1 + v.allDmgFrac
          break
        case 'reversal':
          m.reversalMaxDmgFrac = v.maxDmgFrac
          m.reversalMaxSpeedFrac = v.maxSpeedFrac
          break
        case 'hybrid_stance':
          m.hybridStanceDuration = v.duration
          m.hybridStanceDmgFrac = v.dmgFrac
          break
        case 'golden_weight':
          m.goldWeightRate = v.ratePer200
          m.goldWeightCap = v.cap
          break
        case 'remnant':
          m.remnantOwned = true
          m.remnantDuration = v.duration
          m.remnantDmgFrac = v.dmgFrac
          break
        case 'undaunted':
          m.undauntedOwned = true
          m.undauntedCapFrac = v.capFrac
          break
      }
    }
    this.recompute()
  }

  /** 핵심 슬롯에 특성을 채운다(교체 포함) — 슬롯당 항상 1개만 남는다. */
  setCoreSlot(slot: CoreSlot, id: string) {
    this.coreSlots.set(slot, id)
  }

  /** 대시가 끝난 프레임에 Game이 호출한다 — '급전환'(dash)이면 버프를 건다. */
  onDashEnd() {
    if (this.coreSlots.get('character') !== 'quick_switch') return
    this.quickSwitchTimer = CONFIG.traits.quickSwitchDuration
    this.ammo = this.magSize
    this.reloading = false
  }

  /**
   * '잔영'(dash) — 대시 무적으로 공격을 흘렸을 때 호출된다(Game.ts가
   * lastDamageEvent==='dashBlock'을 감지해 부른다). 대시 1회당 최대 1회만
   * 초기화되도록 이 함수 자체가 가드를 갖는다(afterimageDashRefreshed는
   * 새 대시가 시작될 때만 풀린다).
   */
  tryRefreshDashOnBlock(): boolean {
    if (this.afterimageDashRefreshed) return false
    this.afterimageDashRefreshed = true
    this.dashCdTimer = 0
    return true
  }

  /**
   * 조건부 핵심 슬롯 특성의 발동 게이지(0~1)와 표시 색 — Game이 매 프레임
   * Effects.requestGauge에 그대로 넘긴다. 동시에 여러 조건이 진행 중이면
   * 진행률이 더 높은 쪽만 반환한다(발밑 게이지는 최대 1개).
   *
   * decreasing: 발도참·조준사격은 0→1로 차오르는 창인 반면, 역행은 0.8초가
   * 줄어드는 창이다 — 같은 방향으로 그리면 "지금 채우는 중"과 "곧 닫히는
   * 중"이 구분되지 않아 Effects.drawGauge()가 이 값으로 아크 방향을 반대로
   * 그린다(줄어드는 쪽은 12시에서 반시계 방향).
   */
  conditionGauge(): { progress: number; color: string; decreasing?: boolean } | null {
    const candidates: { progress: number; color: string; decreasing?: boolean }[] = []
    if (this.coreSlots.get('sword') === 'iaijutsu') {
      candidates.push({ progress: Math.min(1, this.stillTimer / CONFIG.traits.iaijutsuIdleThreshold), color: '#f97316' })
    }
    if (this.coreSlots.get('gun') === 'aimed_shot') {
      candidates.push({ progress: Math.min(1, this.aimPauseTimer / CONFIG.traits.aimedShotPauseThreshold), color: '#38bdf8' })
    }
    if (candidates.length === 0) return null
    return candidates.reduce((best, c) => (c.progress > best.progress ? c : best))
  }

  /** 무기 장착(총/검 자동 판별) — 캐릭터가 든 무기 스프라이트도 갱신 */
  equip(w: GunDef | SwordDef) {
    if (w.kind === 'gun') {
      this.gun = w
      this.recompute()
      this.ammo = this.magSize // 새 총은 꽉 찬 탄창
      this.reloading = false
    } else {
      this.sword = w
      this.recompute()
    }
    this.char.setWeapons(this.gun.id, this.sword.id)
  }

  applyMetaBonuses(meta: MetaBonuses) {
    this.meta = meta
    this.revivesRemaining = meta.revives
    this.wardReady = meta.wardReady
    this.recompute()
  }

  get isDashing() {
    return this.dashTimer > 0
  }
  get invulnerable() {
    return this.invuln > 0 || this.dashInvulnerable
  }
  /** 대시 무적 창(i-frame)만 — invuln>0(피격 후 무적)과 구분해야
   * '잔영'이 "대시로 흘렸을 때만" 초기화되고 피격 후 무적에는 반응하지 않는다. */
  get dashInvulnerable() {
    return this.isDashing && this.dashTimer > CONFIG.player.dashDuration - CONFIG.player.dashIFrames
  }
  get dashReady() {
    return this.dashCdTimer <= 0
  }
  get dashCooldownRatio() {
    return 1 - Math.max(0, this.dashCdTimer) / this.stats.dashCooldown
  }
  /** 대시 잔상용 현재 프레임 정보 */
  ghostParams() {
    return this.char.ghostParams()
  }

  /** 장전 진행도 0..1 */
  get reloadRatio() {
    return this.reloading ? 1 - this.reloadTimer / this.stats.reloadTime : 1
  }
  private startReload() {
    if (this.reloading || this.ammo >= this.magSize) return false
    this.overheatStacks = 0 // '과열'(작업 지시 P8c4) — 재장전 시 스택 초기화
    // '예비 탄창'(고유·레전더리, 작업 지시 P10) — 충전이 남아있으면 재장전을
    // 즉시 완료한다(장전 시간 0). 충전이 없으면 평범한 재장전으로 대체한다.
    if (this.mods.reserveMagOwned && this.reserveMagCharges > 0) {
      this.reserveMagCharges--
      this.ammo = this.magSize
      this.reloading = false
      this.onReloadComplete()
      return true
    }
    this.reloading = true
    this.reloadTimer = this.stats.reloadTime
    return true
  }

  /** '속사 전환'(작업 지시 P10) — 재장전이 어떤 경로로든 완료될 때(수동/자동/예비 탄창) 공통으로 호출한다. */
  private onReloadComplete() {
    if (this.mods.rapidReloadDuration > 0) this.rapidReloadTimer = this.mods.rapidReloadDuration
  }

  /** '예비 탄창' 잔여 충전 수 — HUD 표시용. 미보유면 0. */
  get reserveMagChargesLeft() {
    return this.mods.reserveMagOwned ? this.reserveMagCharges : 0
  }
  get reserveMagMaxCharges() {
    return this.mods.reserveMagMaxCharges
  }

  /** Game이 상인 노드·보스 준비방 최초 입장 시 호출 — 상한을 넘지 않는다. */
  grantReserveMagCharge() {
    if (!this.mods.reserveMagOwned) return
    this.reserveMagCharges = Math.min(this.mods.reserveMagMaxCharges, this.reserveMagCharges + 1)
  }

  /**
   * 검이 적을 맞히면 호출 — 기본 메커니즘(항상 적용, 특성 무관)으로 총알을
   * 장전한다. 탄창이 이미 가득 차 있으면 아무 일도 일어나지 않는다. 장전
   * 진행 중이어도 그 진행을 건드리지 않고(즉시 완료시키지 않고) 그 위에
   * ammo만 더한다 — 현행 장전 로직(reloadTimer)은 그대로 계속 흐른다.
   * 발도장전 특성은 mods.swordReloadAmount/swordReloadBurstBonus로 이 값을
   * 강화한다.
   */
  reloadFromSwordHit() {
    if (this.ammo >= this.magSize) return
    this.ammo = Math.min(this.magSize, this.ammo + this.mods.swordReloadAmount)
    if (this.mods.swordReloadBurstBonus > 0) this.swordReloadBurstShotsLeft = 3
  }

  private rollCrit(): boolean {
    return Math.random() < this.stats.critChance
  }

  /**
   * 이동/조준/대시 처리. 반환값으로 발사할 총알과 베기를 알린다.
   */
  update(
    dt: number,
    input: Input,
    aimGround: THREE.Vector3,
  ): {
    bullets: BulletSpec[]
    slash: SlashSpec | null
    startedReload: boolean
    reloadTriggerAttempt: boolean
  } {
    const bullets: BulletSpec[] = []
    let slash: SlashSpec | null = null
    let startedReload = false
    let reloadTriggerAttempt = false

    // 조준: 마우스 지면 좌표 방향 — 검 스윙 커밋 중엔 방향 전환 차단
    if (this.swingCommitTimer <= 0) {
      const dx = aimGround.x - this.pos.x
      const dz = aimGround.z - this.pos.z
      if (dx * dx + dz * dz > 0.01) this.angle = Math.atan2(dx, dz)
    }

    // 타이머 감소
    this.gunTimer -= dt
    this.swordTimer -= dt
    this.dashCdTimer -= dt
    if (this.swingCommitTimer > 0) this.swingCommitTimer -= dt
    if (this.invuln > 0) this.invuln -= dt
    if (this.hitFlash > 0) this.hitFlash -= dt
    if (this.movementSlowTimer > 0) {
      this.movementSlowTimer -= dt
      if (this.movementSlowTimer <= 0) this.movementSlowMultiplier = 1
    }

    if (this.dashTimer > 0) {
      this.dashTimer -= dt
      this.pos.addScaledVector(this.dashDir, CONFIG.player.dashSpeed * dt)
      this.moving = true
      this.walkPhase += dt * 24 // 대시 중 빠른 다리 회전
    } else if (this.swingCommitTimer > 0) {
      // 검 스윙 커밋 — 이동 입력·대시 시작 모두 무시(런지에 의한 전진은 스윙
      // 트리거 시점에 이미 적용되어 있어 여기서 막을 이동과는 별개다)
      this.moving = false
    } else {
      // 이동
      const mv = input.moveVector()
      let mag = Math.hypot(mv.x, mv.z)
      this.moving = mag > 0
      if (mag > 0) {
        const nx = mv.x / mag
        const nz = mv.z / mag
        this.pos.x += nx * this.stats.moveSpeed * this.movementSlowMultiplier * dt
        this.pos.z += nz * this.stats.moveSpeed * this.movementSlowMultiplier * dt
        this.walkPhase += dt * 13 // 걷기 다리 회전
      }
      if (input.downAction('dash') && this.dashReady && !this.isDashing && (mv.x !== 0 || mv.z !== 0)) {
        // 대시 시작 — dashReady는 원래 대시 애니메이션(dashDuration) 동안은
        // 쿨타임(dashCooldown)이 항상 더 길어 참일 수 없었지만, '잔영'이 대시
        // 무적 중 피격 시 dashCdTimer를 0으로 초기화하면서 이 전제가 깨졌다.
        // Shift가 계속 눌려있으면(downAction은 레벨 트리거) 같은 프레임에 대시가
        // 즉시 재시작돼 afterimageDashRefreshed 가드까지 함께 풀려버려, 공격을
        // 계속 흘리는 한 무한 대시 사슬이 생긴다. isDashing 가드로 막는다.
        this.dashDir.set(mv.x, 0, mv.z).normalize()
        this.dashTimer = CONFIG.player.dashDuration
        this.dashCdTimer = this.stats.dashCooldown
        this.dashStart.copy(this.pos)
        this.afterimageDashRefreshed = false
      }
    }

    // (방 경계 제한은 Game이 Room.clamp로 처리)

    // '발도참' 발동 게이지 — 정지(이동/대시 전부 없음) 상태가 이어지는 시간
    if (this.moving || this.dashTimer > 0) this.stillTimer = 0
    else this.stillTimer += dt
    // '영점 사격'(작업 지시 P8c4, 고유·에픽) — 발도참과 조건은 같지만 발동
    // 시 리셋되는 stillTimer와 달리 총 축 전용이라 독립 타이머를 쓴다.
    if (this.moving || this.dashTimer > 0) this.zeroShotTimer = 0
    else this.zeroShotTimer += dt
    // '조준사격' 발동 게이지 — 총을 쏘지 않고 흐른 시간(성공 발사 시 아래서 리셋)
    this.aimPauseTimer += dt
    // '급전환' 버프 지속시간
    if (this.quickSwitchTimer > 0) this.quickSwitchTimer -= dt
    // '연참 가속' — 베기가 없는 채로 "현재 검 쿨타임의 2배"가 지나면 스택을
    // 초기화한다(작업 지시 P10 커밋3-3 — 이전엔 무기 상태와 무관한 고정
    // 1.0초였다. 검 쿨타임이 짧아지는 각인/버프를 들면 유예도 함께 짧아진다).
    if (this.chainSlashStacks > 0) {
      this.chainSlashIdleTimer += dt
      if (this.chainSlashIdleTimer >= this.stats.swordCooldown * 2) this.chainSlashStacks = 0
    }
    // '총검일체'/'속사 전환' 버프 지속시간
    if (this.hybridStanceTimer > 0) this.hybridStanceTimer -= dt
    if (this.rapidReloadTimer > 0) this.rapidReloadTimer -= dt

    // M1911 장전 처리(리듬 판정은 P10 커밋1에서 폐지 — R 수동 재장전, 소진 시 자동 재장전만 남는다)
    if (this.reloading) {
      this.reloadTimer -= dt
      if (this.reloadTimer <= 0) {
        this.reloading = false
        this.ammo = this.magSize
        this.onReloadComplete()
      }
    } else if (input.consumeAction('reload')) {
      // 수동 장전 시작 (R)
      startedReload = this.startReload()
    }

    // 총 발사 (좌클릭 홀드로 연사 — 탄창 소진 시 자동 장전)
    if (input.mouseDown && this.gunTimer <= 0 && !this.reloading) {
      if (this.ammo > 0) {
        // '최후탄'(shot) — 이번 발사가 탄창의 마지막 1발인지는 감소 전에 판정한다.
        const isLastBullet = this.ammo === 1
        // '조준사격'(shot) — 충분히 쉬었다 쏘는 첫 발은 확정 치명타. 발동했으면
        // 게이지를 소모(리셋)한다. 매 프레임 아래서 다시 리셋되므로 항상 최신값이다.
        const aimedShotReady = this.coreSlots.get('gun') === 'aimed_shot' && this.aimPauseTimer >= CONFIG.traits.aimedShotPauseThreshold
        this.gunTimer = this.stats.gunCooldown
        this.ammo--
        this.aimPauseTimer = 0
        // '혈탄'(하이리스크, 작업 지시 P8c4) — 발사할 때마다 체력을 소모한다.
        // takeDamage()를 거치지 않는다(무적/피격 이벤트가 아니라 자기 자신이
        // 지불하는 대가라 i-frame에 막히거나 '잔영' 등을 오발동시키면 안 된다).
        if (this.mods.hpCostPerShot > 0 && this.hp > 0) {
          this.hp = Math.max(0, this.hp - this.mods.hpCostPerShot)
          if (this.hp <= 0) this.alive = false
        }
        // '과열'(작업 지시 P8c4) — 이번 발의 배율은 "지금까지 쌓인" 스택으로
        // 정한다(첫 발은 보너스 없음), 발사 후 상한까지 스택을 쌓는다.
        const overheatMult = this.mods.overheatMaxStacks > 0 ? 1 + this.overheatStacks * this.mods.overheatStackFrac : 1
        if (this.mods.overheatMaxStacks > 0) this.overheatStacks = Math.min(this.mods.overheatMaxStacks, this.overheatStacks + 1)
        // "무기 전환" 정의(작업 지시 P8c4 확정) — 마지막으로 사용한 무기가
        // 바뀌는 순간. '총검일체' 보유 시에만 버프를 건다.
        if (this.lastWeaponUsed === 'sword' && this.mods.hybridStanceDuration > 0) this.hybridStanceTimer = this.mods.hybridStanceDuration
        this.lastWeaponUsed = 'gun'
        // 사격 모션 재생 — 총의 재장전 간격(gunCooldown)이 이 값보다 길면(산탄총·
        // 저격소총·매그넘·석궁 등) 다음 발이 나가기 전에 st.shooting이 꺼져
        // CharacterSprite의 좌우 반전 고정이 풀렸다가 다음 발에서 다시 걸리며
        // 조준 방향이 바뀌어 있으면 좌우로 튀어 보였다 — 최소한 쿨타임만큼은
        // 유지해 연사 중 내내 얼어붙게 한다.
        this.shootAnim = Math.max(0.16, this.stats.gunCooldown)
        const shots = this.stats.multishot
        const baseDir = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle))
        for (let i = 0; i < shots; i++) {
          const spreadIdx = shots > 1 ? (i - (shots - 1) / 2) * 0.12 : 0
          const dir = baseDir.clone()
          const jitter = (Math.random() - 0.5) * this.stats.spread + spreadIdx
          dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), jitter)
          const crit = aimedShotReady || this.rollCrit()
          let dmg = this.stats.gunDamage * (crit ? this.stats.critMult : 1) * overheatMult
          // 발도장전 강화: 검으로 장전한 직후 발사하는 총알 N발에 피해 보너스
          if (this.swordReloadBurstShotsLeft > 0) {
            dmg *= 1 + this.mods.swordReloadBurstBonus
            this.swordReloadBurstShotsLeft--
          }
          // '마지막 한발'(gun, 구 최후탄) — 피해 증폭 + 명중 시 넉백 충격파(Game.resolveBullets()).
          const lastBulletActive = this.coreSlots.get('gun') === 'last_bullet' && isLastBullet
          if (lastBulletActive) dmg *= CONFIG.traits.lastBulletMult
          bullets.push({
            // 총구 높이/전방 거리는 gunblader_gun_m1911.png 발사 프레임의 실제 총구
            // 픽셀 위치를 월드 단위로 환산한 값이다(CharacterSprite.ts GUN_SHOOT_FIX 주석 참고).
            pos: new THREE.Vector3(this.pos.x, 2.6, this.pos.z).addScaledVector(dir, 0.9),
            dir,
            damage: dmg,
            crit,
            shockwave: lastBulletActive,
          })
        }
        // 마지막 탄 발사 후 자동 장전
        if (this.ammo === 0) startedReload = this.startReload()
      }
    } else if (input.mouseDown && this.reloading) {
      // 장전 중 방아쇠 시도 — 탄약/딜레이에는 영향 없음, 소리로만 피드백
      reloadTriggerAttempt = true
    }

    // 검 베기 (우클릭 또는 스페이스)
    if ((input.rightDown || input.downAction('slash')) && this.swordTimer <= 0) {
      // '연참 가속'(작업 지시 P8c4) — 이번 스윙의 쿨타임 감산은 "지금까지
      // 쌓인" 스택으로 정한다(첫 타는 감산 없음), 스윙 후 상한까지 스택을 쌓는다.
      const chainSlashMult = this.mods.chainSlashMaxStacks > 0 ? 1 - this.chainSlashStacks * this.mods.chainSlashCutFrac : 1
      if (this.mods.chainSlashMaxStacks > 0) this.chainSlashStacks = Math.min(this.mods.chainSlashMaxStacks, this.chainSlashStacks + 1)
      this.chainSlashIdleTimer = 0
      // '급전환'(dash) 버프 — 대시 종료 직후 잠깐 검 쿨타임이 절반이다.
      this.swordTimer = (this.quickSwitchTimer > 0
        ? this.stats.swordCooldown * CONFIG.traits.quickSwitchSwordCooldownMult
        : this.stats.swordCooldown) * chainSlashMult
      // "무기 전환" 정의(작업 지시 P8c4 확정) — 마지막으로 사용한 무기가
      // 바뀌는 순간. '총검일체' 보유 시에만 버프를 건다.
      if (this.lastWeaponUsed === 'gun' && this.mods.hybridStanceDuration > 0) this.hybridStanceTimer = this.mods.hybridStanceDuration
      this.lastWeaponUsed = 'sword'
      const crit = this.rollCrit()
      // '발도참'(slash) — 0.5초 이상 정지 후 첫 베기는 강화된다. 발동하면 게이지를
      // 소모(리셋)해 다시 정지해야 재충전된다.
      const iaijutsuReady = this.coreSlots.get('sword') === 'iaijutsu' && this.stillTimer >= CONFIG.traits.iaijutsuIdleThreshold
      if (iaijutsuReady) this.stillTimer = 0
      const dmgMult = iaijutsuReady ? CONFIG.traits.iaijutsuDamageMult : 1
      const kbMult = iaijutsuReady ? CONFIG.traits.iaijutsuKnockbackMult : 1
      slash = {
        pos: this.pos.clone(),
        angle: this.angle,
        arc: this.stats.swordArc,
        range: this.stats.swordRange,
        damage: this.stats.swordDamage * (crit ? this.stats.critMult : 1) * dmgMult,
        crit,
        knockback: this.stats.knockback * kbMult,
      }
      // 전방 짧은 대시
      const fwd = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle))
      this.pos.addScaledVector(fwd, this.stats.lunge * dt * 6)
      this.swingAnim = 0.3 // 아트 시트 8프레임 재생 시간
      // 스윙 커밋: 검 쿨타임에 비례하되 상한을 넘지 않는다
      this.swingCommitTimer = Math.min(this.stats.swordCooldown, CONFIG.combat.swordSwingCommitMax)
      // 레전더리: 발도 시 총 즉시 장전
      if (this.mods.swordReloads && this.ammo < this.magSize) {
        this.ammo = this.magSize
        this.reloading = false
      }
    }

    this.syncMesh(dt)
    // 동적 각인(역전/총검일체/황금의 무게/영점 사격/속사 전환) —
    // gunDamage/swordDamage/moveSpeed/gunCooldown 네 필드만 갱신한다(전체
    // recompute()를 매 프레임 부르면 QC 하네스가 직접 덮어쓴 다른 stats
    // 필드가 되살아난다 — 위 recompute()/updateDynamicStats() 주석 참고).
    this.updateDynamicStats()
    return { bullets, slash, startedReload, reloadTriggerAttempt }
  }

  /** 빙결탄/냉기 지대의 이동 둔화. 더 강한 둔화와 더 긴 남은 시간만 유지한다. */
  applyMovementSlow(multiplier: number, duration: number) {
    this.movementSlowMultiplier = Math.min(this.movementSlowMultiplier, multiplier)
    this.movementSlowTimer = Math.max(this.movementSlowTimer, duration)
  }

  private swingAnim = 0
  private syncMesh(dt: number) {
    // 2D 스프라이트(빌보드) 갱신
    this.char.update(
      dt,
      this.pos,
      this.angle,
      {
        moving: this.moving,
        dashing: this.isDashing,
        swinging: this.swingAnim > 0,
        shooting: this.shootAnim > 0,
        invulnerable: this.invulnerable,
      },
      this.hitFlash,
    )
    if (this.swingAnim > 0) this.swingAnim -= dt
    if (this.shootAnim > 0) this.shootAnim -= dt
  }

  takeDamage(amount: number): boolean {
    this.lastDamageEvent = 'none'
    if (!this.alive) return false
    if (this.invulnerable) {
      // '잔영'(dash)이 참고할 수 있게, 대시 무적으로 막았다는 사실만 구분해 남긴다
      // — 피격 후 무적(invuln>0)이나 발도 무적으로 막았을 때는 남기지 않는다.
      if (this.dashInvulnerable) this.lastDamageEvent = 'dashBlock'
      return false
    }
    if (this.wardReady) {
      this.wardReady = false
      this.lastDamageEvent = 'ward'
      return false
    }
    // 광전/광전사(하이리스크, 작업 지시 P8c4) — 받는 피해 증가가 실제로
    // 적용되는지가 QC 요구사항이다. 여기 한 곳에서만 곱해 모든 피해원
    // (총알/근접/광역/장판)에 공통 적용된다.
    let effective = amount * this.mods.damageTakenMult
    // '불굴'(고유·에픽, 작업 지시 P10) — 받는 피해 증가를 적용한 뒤에
    // 상한을 건다(work order 명시 순서). 무적이 아니라 한 방의 크기만
    // 제한할 뿐, 누적 피해(여러 번 맞으면 그만큼 깎임)는 그대로다.
    if (this.mods.undauntedOwned) effective = Math.min(effective, this.stats.maxHp * this.mods.undauntedCapFrac)
    this.hp -= effective
    this.invuln = CONFIG.player.invulnAfterHit
    this.hitFlash = 0.15
    if (this.hp <= 0) {
      if (this.revivesRemaining > 0) {
        this.revivesRemaining--
        this.hp = this.stats.maxHp * 0.5
        this.invuln = CONFIG.player.invulnAfterHit
        this.lastDamageEvent = 'revive'
      } else {
        this.hp = 0
        this.alive = false
        this.lastDamageEvent = 'dead'
      }
    } else {
      this.lastDamageEvent = 'hit'
    }
    return true
  }

  consumeDamageEvent() {
    const event = this.lastDamageEvent
    this.lastDamageEvent = 'none'
    return event
  }

  heal(amount: number) {
    this.hp = Math.min(this.stats.maxHp, this.hp + amount)
  }
}
