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
import { build } from 'vite'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'docs', 'STATE_SNAPSHOT.md')
const checkOnly = process.argv.includes('--check')

const ENTRY = `
export { CONFIG } from './src/config'
export { GUNS, SWORDS } from './src/systems/Weapons'
export { POOL, SIGIL_DEFS, GRADES, GRADE_LABEL, describeSigil } from './src/systems/Upgrades'
export { DEFS } from './src/entities/Enemy'
export { STAGES } from './src/systems/RunState'
export { ELITE_AFFIXES, ELITE_AFFIX } from './src/systems/EliteAffixes'
`

// 번들은 반드시 저장소 안에 떨궈야 한다 — /tmp 에 두면 external 로 남긴
// 'three' 를 node 가 저장소 node_modules 에서 찾지 못한다.
const entryPath = join(ROOT, '.state-snapshot-entry.ts')
const bundleDir = join(ROOT, '.state-snapshot-tmp')
const bundlePath = join(bundleDir, 'bundle.mjs')
try {
  writeFileSync(entryPath, ENTRY)
  await build({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    build: {
      minify: false,
      emptyOutDir: true,
      outDir: bundleDir,
      lib: { entry: entryPath, formats: ['es'], fileName: () => 'bundle.mjs' },
      rollupOptions: { external: ['three'] },
    },
  })
  const m = await import(pathToFileURL(bundlePath).href)
  writeSnapshot(m)
} finally {
  rmSync(entryPath, { force: true })
  rmSync(bundleDir, { force: true, recursive: true })
}

// ── 문서 생성 ─────────────────────────────────────────────────────────────

function writeSnapshot(m) {
  const { CONFIG, GUNS, SWORDS, POOL, DEFS, STAGES, ELITE_AFFIXES, SIGIL_DEFS, GRADES, GRADE_LABEL, describeSigil } = m
  for (const [name, value] of Object.entries({ CONFIG, GUNS, SWORDS, POOL, DEFS, STAGES, ELITE_AFFIXES, SIGIL_DEFS, GRADES, GRADE_LABEL, describeSigil })) {
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

  // ── 특성 (슬롯 3축 기준 — 작업 지시 P8 커밋1, 등급 축은 여전히 폐기 상태) ──
  const SIGIL_SLOTS = ['gun-sigil', 'sword-sigil', 'character-sigil']
  const SLOT_ORDER = ['gun', 'sword', 'character', ...SIGIL_SLOTS]
  const bySlot = {}
  for (const slot of SLOT_ORDER) bySlot[slot] = POOL.filter((u) => u.slot === slot)
  // 조건부 판정: 핵심 슬롯 특성은 apply()가 대부분 비어있고(발동 로직이
  // Player/Game의 조건부 판정 쪽에 있다) 각인 슬롯이 아닌 것 자체가 이미
  // "조건부"라 트리거 목록 스캔과 별개로 넣는다. 각인은 등급 5단계 도입
  // (P8 커밋3) 이후 apply()가 전부 no-op이라(실제 적용은 SIGIL_DEFS +
  // Player.recomputeSigilMods) apply() 본문을 파싱해 트리거성을 가려내는
  // 옛 방식이 안 통한다. SIGIL_DEFS가 P8c4에서 각인마다 다른 파라미터
  // 이름을 쓰는 구조로 바뀌어(공용 `field` 하나가 아니라 id별 분기,
  // Player.recomputeSigilMods 참고) 필드명으로 자동 판별할 수 없어졌다 —
  // "이벤트/상태에 반응하는" 각인 id를 직접 나열한다(연속 처치·명중·전환·
  // 체력·골드처럼 매 순간 조건을 다시 평가하는 것 vs 등급만큼 상시 적용되는
  // 단순 배수/가산을 구분하는 기준).
  const TRIGGER_SIGIL_IDS = [
    'lg_detonator', 'overheat', 'shock_bullet', 'chain_reload', 'zero_shot',
    'chain_slash', 'bleed_blade', 'blood_trace', 'execute_blade',
    'reversal', 'hybrid_stance', 'golden_weight', 'remnant', 'last_stand',
  ]
  const isSigil = (u) => SIGIL_SLOTS.includes(u.slot)
  const conditional = POOL.filter((u) => !isSigil(u) || TRIGGER_SIGIL_IDS.includes(u.id))
  const sigils = SIGIL_SLOTS.flatMap((s) => bySlot[s])
  L.push('## 특성')
  L.push('')
  L.push(`총 ${POOL.length}종 — ` + SLOT_ORDER.map((s) => `${s} ${bySlot[s].length}`).join(' / '))
  L.push(`각인 등급 5단계(작업 지시 P8 커밋3, 스택 폐지): ${GRADES.map((g) => GRADE_LABEL[g]).join(' → ')} · 핵심 슬롯은 등급 없음(슬롯당 1개)`)
  L.push('')
  L.push(`조건부·트리거형 ${conditional.length}종: ${conditional.map((u) => u.name).join(', ')}`)
  L.push(`나머지 ${POOL.length - conditional.length}종은 상시 배수·가산이다.`)
  L.push(`상태이상(작업 지시 P8 커밋2): 기절(적용 각인 없음, 시스템만) · 출혈(중첩형, 스택당 ${CONFIG.enemy.bleed.tickDamage} 피해/${CONFIG.enemy.bleed.tickInterval}s, 지속 ${CONFIG.enemy.bleed.duration}s) · 감전(갱신형, 받는 피해 ×${CONFIG.enemy.shock.damageTakenMult}, 지속 ${CONFIG.enemy.shock.duration}s) — 아직 이를 거는 각인은 없다.`)
  L.push('')
  L.push('### 각인 등급별 수치 (작업 지시 P8 커밋3 초안 7종 + P8c4 승인 18종, 25종 전체)')
  L.push('')
  L.push(`| 각인 | ${GRADES.map((g) => GRADE_LABEL[g]).join(' | ')} | 에픽 규칙 변경 |`)
  L.push(`|---|${GRADES.map(() => '---:').join('|')}|---|`)
  for (const u of sigils) {
    const def = SIGIL_DEFS[u.id]
    if (!def) continue
    const cells = GRADES.map((g) => describeSigil(u.id, g).split(/[,—]/)[0])
    L.push(`| ${u.name} | ${cells.join(' | ')} | ${def.epicRule ?? '-'} |`)
  }
  L.push('')

  // ── 적 ──
  L.push('## 적')
  L.push('')
  L.push(`기준값: HP ${CONFIG.enemy.baseHp} / 속도 ${CONFIG.enemy.baseSpeed} / 피해 ${CONFIG.enemy.baseDamage}`)
  L.push('')
  L.push('| 종류 | HP배율 | 속도배율 | 피해배율 | 반경 | 원거리 |')
  L.push('|---|---:|---:|---:|---:|---|')
  for (const [kind, d] of Object.entries(DEFS)) {
    L.push(`| ${kind} | ${d.hp} | ${d.speed} | ${d.damage} | ${d.radius} | ${d.ranged ? `O (쿨 ${d.shootCd}s)` : '-'} |`)
  }
  L.push('')
  L.push(`엘리트 접두사 ${ELITE_AFFIXES.length}종: ${ELITE_AFFIXES.join(', ')} — 개체가 아니라 방 단위로 적용된다.`)
  L.push('')

  // ── 런 구조 / 경제 ──
  const e = CONFIG.economy
  L.push('## 런 구조와 경제')
  L.push('')
  L.push(`스테이지 ${STAGES.length}개: ${STAGES.map((s) => s.name).join(', ')}`)
  L.push('방 구성(작업 지시 P7 커밋2) = 선형 분기 깊이 9 고정: 1·2·3·5·6·7 분기(2~3 선택지) · 4 상점 · 8 보스 준비방 · 9 보스.')
  L.push('')
  L.push(`- 제련소: ${ladder(e.dungeonForgeBasePrice, e.dungeonForgePriceRatio, 3).join(' → ')} G (런 단위 누적)`)
  L.push(`- 분수: 첫 사용 무료, 이후 ${ladder(e.fountainBasePrice, e.fountainPriceRatio, 3).join(' → ')} G`)
  L.push(`- 적 처치 골드 = 최대 HP × 0.22 (보스 120~180), 상자 30~70 · 60%는 특성`)
  L.push('')
  L.push('메타(영구) 강화 — 런 골드가 아닌 결정/증표로 구매한다.')
  L.push(`- 공격 숙련 단계당 +${(CONFIG.meta.altar.damagePerRank * 100).toFixed(0)}% / 체력 단계당 +${CONFIG.meta.altar.maxHpPerRank}`)
  L.push(`- 단계 비용: ${CONFIG.meta.altar.rankCosts.map((c) => `${c.kind} ${c.amount}`).join(' → ')}`)
  L.push(`- 스테이지 클리어 보상(스테이지 1): ${Object.entries(STAGES[0].reward).map(([k, v]) => `${k} ${v}`).join(', ')} · 엘리트 증표 ${CONFIG.meta.rewards.eliteToken}`)
  L.push(`- 무기 해금 가격(증표): ${Object.entries(CONFIG.meta.weaponPrice).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
  L.push('')

  // ── 플레이어 / 스킬 ──
  const p = CONFIG.player
  L.push('## 플레이어')
  L.push('')
  L.push(`이동 ${p.speed} · 최대 HP ${p.maxHp} · 대시 지속 ${p.dashDuration}s / 무적 ${p.dashIFrames}s / 쿨 ${p.dashCooldown}s`)
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
