/**
 * docs/STATE_SNAPSHOT.md 생성기.
 *
 * 목적: 기획 대화(Claude 챗)가 매 세션 저장소 전체를 읽어 상태를 재구성하는
 * 비용을 없앤다. 사람이 손으로 쓰는 요약 문서는 반드시 코드와 어긋나므로
 * (구 PROJECT_STATE.md 사례), 이 파일은 **코드에서 값을 직접 import 해서**
 * 표를 만든다. 손으로 고치지 말 것 — 고쳐도 다음 실행에서 덮어써진다.
 *
 * 사용:
 *   node tools/state_snapshot.mjs           생성
 *   node tools/state_snapshot.mjs --check   생성 결과가 커밋된 파일과 같은지만 확인
 *                                           (다르면 종료코드 1 — qc에서 이 모드로 부른다)
 *
 * 값 출처가 되는 export (없으면 명시적으로 실패한다):
 *   src/config.ts          CONFIG
 *   src/systems/Weapons.ts GUNS, SWORDS
 *   src/systems/Upgrades.ts POOL
 *   src/entities/Enemy.ts  DEFS
 *   src/systems/RunState.ts STAGES
 *   src/systems/EliteAffixes.ts ELITE_AFFIXES
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'docs', 'STATE_SNAPSHOT.md')
const checkOnly = process.argv.includes('--check')

const ENTRY = `
export { CONFIG } from './src/config'
export { GUNS, SWORDS } from './src/systems/Weapons'
export { POOL } from './src/systems/Upgrades'
export { DEFS } from './src/entities/Enemy'
export { STAGES } from './src/systems/RunState'
export { ELITE_AFFIXES, ELITE_AFFIX } from './src/systems/EliteAffixes'
`

// 번들은 반드시 저장소 안에 떨궈야 한다 — /tmp 에 두면 external 로 남긴
// 'three' 를 node 가 저장소 node_modules 에서 찾지 못한다.
const entryPath = join(ROOT, '.state-snapshot-entry.ts')
const bundlePath = join(ROOT, '.state-snapshot-bundle.mjs')
try {
  writeFileSync(entryPath, ENTRY)
  await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['three'],
    outfile: bundlePath,
    logLevel: 'silent',
  })
  const m = await import(pathToFileURL(bundlePath).href)
  writeSnapshot(m)
} finally {
  rmSync(entryPath, { force: true })
  rmSync(bundlePath, { force: true })
}

// ── 문서 생성 ─────────────────────────────────────────────────────────────

function writeSnapshot(m) {
  const { CONFIG, GUNS, SWORDS, POOL, DEFS, STAGES, ELITE_AFFIXES } = m
  for (const [name, value] of Object.entries({ CONFIG, GUNS, SWORDS, POOL, DEFS, STAGES, ELITE_AFFIXES })) {
    if (!value) throw new Error(`export 누락: ${name} — 파일 상단 주석의 출처 목록 참고`)
  }

  const L = []
  L.push('# STATE SNAPSHOT (자동 생성 — 직접 수정 금지)')
  L.push('')
  L.push('생성: `node tools/state_snapshot.mjs`')
  L.push('')
  L.push('코드에서 값을 직접 import 해 만든 파생 표다. 수치의 정본은 언제나')
  L.push('`src/config.ts` / `src/systems/Weapons.ts` / `src/systems/Upgrades.ts` 이고,')
  L.push('이 문서는 그것을 읽기 쉽게 편 것뿐이다. 의도·폐기안·미해결 논점은')
  L.push('`DESIGN_LOG.md`에 있고 여기에는 없다.')
  L.push('')

  // ── 무기 ──
  L.push('## 무기 DPS')
  L.push('')
  L.push('총 지속 DPS = 데미지 × 펠릿 × 탄창 ÷ (탄창 × 쿨 + 장전). 특성·메타 배수 제외.')
  L.push(`거리 보너스는 명중 거리 ≥ ${CONFIG.combat.gunRangeBonusDist} 에서 ×${CONFIG.combat.gunRangeBonusMult}.`)
  L.push('')
  L.push('| 총 | 등급 | 지속 DPS | 거리보너스 | 관통 | 펠릿 | 탄창/장전 |')
  L.push('|---|---|---:|---:|---:|---:|---|')
  for (const g of GUNS) {
    const dps = (g.damage * g.pellets * g.magSize) / (g.magSize * g.cooldown + g.reloadTime)
    L.push(`| ${g.name} | ${g.rarity} | ${dps.toFixed(1)} | ${(dps * CONFIG.combat.gunRangeBonusMult).toFixed(1)} | ${g.pierce} | ${g.pellets} | ${g.magSize} / ${g.reloadTime}s |`)
  }
  L.push('')
  L.push('| 검 | 등급 | DPS | 사거리 | 각 | 넉백 | 런지 |')
  L.push('|---|---|---:|---:|---:|---:|---:|')
  for (const s of SWORDS) {
    L.push(`| ${s.name} | ${s.rarity} | ${(s.damage / s.cooldown).toFixed(1)} | ${s.range} | ${Math.round((s.arc * 180) / Math.PI)}° | ${s.knockback} | ${s.lunge} |`)
  }
  L.push('')
  L.push(rarityOrderNotes(GUNS, SWORDS))
  L.push('')

  // ── 특성 (슬롯 기준 — 작업 지시 slot_system_phase1 이후 등급 축은 폐기) ──
  const SLOT_ORDER = ['sigil', 'slash', 'shot', 'dash', 'skill']
  const bySlot = {}
  for (const slot of SLOT_ORDER) bySlot[slot] = POOL.filter((u) => u.slot === slot)
  // 조건부 판정: apply 본문이 mods 곱/합만 건드리는지, 트리거성 필드를 건드리는지로 나눈다.
  // 핵심 슬롯 특성은 apply()가 대부분 비어있고(발동 로직이 Player/Game의 조건부
  // 판정 쪽에 있다) slot !== 'sigil' 자체가 이미 "조건부"라 트리거 필드 스캔과 별개로 넣는다.
  const TRIGGER_FIELDS = ['explodeOnKill', 'dashStrike']
  const conditional = POOL.filter((u) => u.slot !== 'sigil' || TRIGGER_FIELDS.some((f) => String(u.apply).includes(f)))
  const sigils = bySlot.sigil
  L.push('## 특성')
  L.push('')
  L.push(`총 ${POOL.length}종 — ` + SLOT_ORDER.map((s) => `${s} ${bySlot[s].length}`).join(' / '))
  L.push(`각인(sigil) 스택 상한: ${sigils.length ? sigils[0].maxStacks : '해당 없음'} · 핵심 슬롯은 슬롯당 1개(스택 없음)`)
  L.push('')
  L.push(`조건부·트리거형 ${conditional.length}종: ${conditional.map((u) => u.name).join(', ')}`)
  L.push(`나머지 ${POOL.length - conditional.length}종은 상시 배수·가산이다. 상태이상 축은 없다.`)
  L.push('')

  // ── 적 ──
  L.push('## 적')
  L.push('')
  L.push(`기준값: HP ${CONFIG.enemy.baseHp} / 속도 ${CONFIG.enemy.baseSpeed} / 피해 ${CONFIG.enemy.baseDamage}`)
  L.push('')
  L.push('| 종류 | HP배율 | 속도배율 | 피해배율 | XP | 반경 | 원거리 |')
  L.push('|---|---:|---:|---:|---:|---:|---|')
  for (const [kind, d] of Object.entries(DEFS)) {
    L.push(`| ${kind} | ${d.hp} | ${d.speed} | ${d.damage} | ${d.xp} | ${d.radius} | ${d.ranged ? `O (쿨 ${d.shootCd}s)` : '-'} |`)
  }
  L.push('')
  L.push(`엘리트 접두사 ${ELITE_AFFIXES.length}종: ${ELITE_AFFIXES.join(', ')} — 개체가 아니라 방 단위로 적용된다.`)
  L.push('')

  // ── 런 구조 / 경제 ──
  const e = CONFIG.economy
  L.push('## 런 구조와 경제')
  L.push('')
  L.push(`스테이지 ${STAGES.length}개: ${STAGES.map((s) => `${s.name}(일반 방 ${s.normalRooms})`).join(', ')}`)
  L.push(`방 구성 = 일반 ${STAGES[0].normalRooms} + 상점/보스준비/보스. 분수 방 ${e.fountainRoomCount}개(상점 1 + 보스준비 1 + 전투 ${e.fountainRoomCount - 2}).`)
  L.push('')
  L.push(`- 제련소: ${ladder(e.dungeonForgeBasePrice, e.dungeonForgePriceRatio, 3).join(' → ')} G (런 단위 누적)`)
  L.push(`- 분수: 첫 사용 무료, 이후 ${ladder(e.fountainBasePrice, e.fountainPriceRatio, 3).join(' → ')} G`)
  L.push(`- 적 처치 골드 = 최대 HP × 0.22 (보스 120~180), 상자 30~70 · 60%는 특성`)
  L.push('')
  L.push('메타(영구) 강화 — 런 골드가 아닌 결정/증표로 구매한다.')
  L.push(`- 공격 숙련 단계당 +${(CONFIG.meta.altar.damagePerRank * 100).toFixed(0)}% / 체력 단계당 +${CONFIG.meta.altar.maxHpPerRank}`)
  L.push(`- 단계 비용: ${CONFIG.meta.altar.rankCosts.map((c) => `${c.kind} ${c.amount}`).join(' → ')}`)
  L.push(`- 스테이지 클리어 보상: ${Object.entries(CONFIG.meta.rewards.stageClear).map(([k, v]) => `${k} ${v}`).join(', ')} · 엘리트 증표 ${CONFIG.meta.rewards.eliteToken}`)
  L.push(`- 무기 해금 가격(증표): ${Object.entries(CONFIG.meta.weaponPrice).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
  L.push('')

  // ── 플레이어 / 스킬 ──
  const p = CONFIG.player
  L.push('## 플레이어')
  L.push('')
  L.push(`이동 ${p.speed} · 최대 HP ${p.maxHp} · 대시 지속 ${p.dashDuration}s / 무적 ${p.dashIFrames}s / 쿨 ${p.dashCooldown}s`)
  L.push(`액티브 스킬 쿨: 돌진 ${CONFIG.skills.charge.cooldown}s · 더블샷 ${CONFIG.skills.doubleShot.cooldown}s · 궁극기 ${CONFIG.skills.ultimate.cooldown}s`)
  L.push('')

  const text = L.join('\n') + '\n'
  if (checkOnly) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf-8') : ''
    if (current !== text) {
      console.error('STATE_SNAPSHOT.md 가 코드와 다름 — `node tools/state_snapshot.mjs` 실행 후 커밋할 것')
      process.exit(1)
    }
    console.log('STATE_SNAPSHOT.md 최신 상태')
    return
  }
  writeFileSync(OUT, text)
  console.log(`생성: docs/STATE_SNAPSHOT.md (${text.length}자, 약 ${Math.round(text.length / 2.2)} 토큰)`)
}

/** 등급 순서 역전(하위 등급이 상위 등급보다 강한 경우)을 자동으로 짚는다. */
function rarityOrderNotes(GUNS, SWORDS) {
  const RANK = { common: 0, rare: 1, epic: 2, legendary: 3 }
  const TOL = 0.5 // 동률은 역전으로 보지 않는다
  const rows = [
    ...GUNS.map((g) => ({ name: g.name, rarity: g.rarity, dps: (g.damage * g.pellets * g.magSize) / (g.magSize * g.cooldown + g.reloadTime), kind: '총' })),
    ...SWORDS.map((s) => ({ name: s.name, rarity: s.rarity, dps: s.damage / s.cooldown, kind: '검' })),
  ]
  const out = []
  for (const kind of ['총', '검']) {
    const list = rows.filter((r) => r.kind === kind)
    for (const a of list) {
      const beaten = list.filter((b) => RANK[a.rarity] < RANK[b.rarity] && a.dps > b.dps + TOL)
      if (beaten.length) {
        out.push(`- ${kind}: ${a.name}(${a.rarity}, ${a.dps.toFixed(1)}) > ` +
          beaten.sort((x, y) => y.dps - x.dps).map((b) => `${b.name}(${b.rarity}, ${b.dps.toFixed(1)})`).join(', '))
      }
    }
  }
  return out.length
    ? '**단일 대상 DPS 기준 등급 역전** (광역·관통·사거리 미반영):\n' + out.join('\n')
    : '단일 대상 DPS 기준 등급 역전 없음.'
}

function ladder(base, ratio, n) {
  const out = []
  let v = base
  for (let i = 0; i < n; i++) {
    out.push(v)
    v = Math.round(v * ratio)
  }
  return out
}
