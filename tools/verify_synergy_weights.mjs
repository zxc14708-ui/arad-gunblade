/**
 * P11 각인 계열 메타데이터·시너지 가중 추첨을 정적으로(브라우저 없이) 검증한다.
 * 2026-10-09 사용자 결정: 보상 카드 표시 + 추첨 가중(세트 효과 보류), 태그
 * 없는 각인 0종, 상충은 수치로만 상쇄(추첨 감점 없음), 가중 강도는
 * 오케스트레이터 초기값(Upgrades.SYNERGY_WEIGHT).
 *
 * 검증하는 것:
 *   - 모든 각인이 계열 태그를 1개 이상 가진다
 *   - synergy/conflict 목록이 실제 각인 id만 가리키고 자기 자신을 넣지 않는다
 *   - offerWeight 규칙: 명시적 시너지 ×explicit, 태그 공유 ×sameTag,
 *     이번 추첨에 같은 태그가 이미 뽑혔으면 ×1, 상충 각인은 감점 없음(≥1)
 *   - 제안 카드의 synergyWith가 보유한 시너지 각인 이름을 담는다
 *   - 표본: 시너지 짝을 보유하면 그 후보의 출현율이 실제로 올라간다
 *
 * 사용: node tools/verify_synergy_weights.mjs [표본수=4000]
 */
import { build } from 'vite'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const N = Number(process.argv[2] ?? 4000)

const ENTRY = `export { POOL, SIGIL_DEFS, SYNERGY_WEIGHT, offerWeight, rollNodeSigilRewards, rollChoices, isSigilSlot } from './src/systems/Upgrades'`
const entryPath = join(ROOT, '.synergy-entry.ts')
const bundleDir = join(ROOT, '.synergy-tmp')
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
  run(await import(pathToFileURL(bundlePath).href))
} finally {
  rmSync(entryPath, { force: true })
  rmSync(bundleDir, { force: true, recursive: true })
}

function run({ POOL, SIGIL_DEFS, SYNERGY_WEIGHT, offerWeight, rollNodeSigilRewards, rollChoices, isSigilSlot }) {
  const errors = []
  const byId = (id) => POOL.find((u) => u.id === id)
  const sigilIds = POOL.filter((u) => isSigilSlot(u.slot)).map((u) => u.id)
  const owned = (...ids) => new Map(ids.map((id) => [id, 'normal']))

  console.log(`각인 계열/시너지 가중 검증 — 표본 ${N}회 (P11)`)

  // 1. 메타데이터 무결성
  for (const id of sigilIds) {
    const def = SIGIL_DEFS[id]
    if (!def) { errors.push(`${id}: SIGIL_DEFS 정의 없음`); continue }
    if (def.tags.length === 0) errors.push(`${id}: 계열 태그 없음`)
    for (const other of [...def.synergy, ...def.conflict]) {
      if (other === id) errors.push(`${id}: 자기 자신을 synergy/conflict에 넣음`)
      if (!sigilIds.includes(other)) errors.push(`${id}: 존재하지 않는 각인 id '${other}'`)
    }
  }
  console.log(`  태그 없는 각인: ${sigilIds.filter((id) => SIGIL_DEFS[id]?.tags.length === 0).length}종`)

  // 2. 가중치 규칙
  const w = (id, own, chosen = []) => offerWeight(byId(id), own, chosen.map(byId))
  const expect = (label, got, want) => { if (got !== want) errors.push(`${label}: 가중치 ${got} (기대 ${want})`) }
  expect('명시적 시너지(신속 장전 보유 → 속사 전환)', w('rapid_reload', owned('reload')), SYNERGY_WEIGHT.explicit)
  expect('태그 공유만(광전 보유 → 혈탄, 하이리스크)', w('blood_bullet', owned('berserk_blade')), SYNERGY_WEIGHT.sameTag)
  expect('관련 없음(신속 장전 보유 → 경신법)', w('speed', owned('reload')), 1)
  expect('자기 자신은 시너지 아님(신속 장전만 보유 → 신속 장전)', w('reload', owned('reload')), 1)
  expect('같은 계열 이미 뽑힘(→ 상한, 가중 없음)', w('rapid_reload', owned('reload'), ['reserve_mag']), 1)
  const conflictW = w('sword_focus', owned('gun_focus'))
  if (conflictW < 1) errors.push(`상충 각인이 감점됨(총구 집중 보유 → 검날 집중 ${conflictW}) — 사용자 결정은 수치 상쇄만`)

  // 3. 카드 표시용 synergyWith
  const offers = rollNodeSigilRewards(26, 'normal', owned('bleed_blade'))
  const ls = offers.find((u) => u.id === 'lifesteal')
  if (!ls) errors.push('출혈 칼날 보유 시 흡혈이 후보에 없음(표시 검증 불가)')
  else if (!ls.synergyWith?.includes(byId('bleed_blade').name)) errors.push(`흡혈 카드의 synergyWith에 출혈 칼날이 없음 (${JSON.stringify(ls.synergyWith)})`)
  const plain = offers.find((u) => u.id === 'speed')
  if (plain?.synergyWith?.length) errors.push(`관련 없는 경신법 카드에 시너지가 표시됨 (${plain.synergyWith})`)

  // 4. 표본 — 시너지 짝 보유 시 출현율 상승
  const rate = (own, target, roll) => {
    let hit = 0
    for (let i = 0; i < N; i++) if (roll(own).some((u) => u.id === target)) hit++
    return hit / N
  }
  const node = (own) => rollNodeSigilRewards(3, 'normal', own)
  const shop = (own) => rollChoices(3, own, new Map([['gun', 'close_range'], ['sword', 'iaijutsu'], ['character', 'mark']]))
  // 상점/제련소는 3장 중 보유 각인 우선 1장·교체 후보 1장이 고정이라 자유 추첨이
  // 1장뿐이다 — 상승폭이 원래 작아 기준을 따로 둔다(표본 오차 여유 포함).
  for (const [label, roll, minRatio] of [['노드 보상', node, 1.8], ['상점/제련소', shop, 1.25]]) {
    const base = rate(owned('speed'), 'lifesteal', roll)
    const boosted = rate(owned('speed', 'bleed_blade'), 'lifesteal', roll)
    const ratio = boosted / Math.max(base, 1e-9)
    console.log(`  ${label}: 흡혈 출현율 ${(base * 100).toFixed(1)}% → 출혈 칼날 보유 시 ${(boosted * 100).toFixed(1)}% (×${ratio.toFixed(2)})`)
    if (ratio < minRatio) errors.push(`${label}: 시너지 보유 시 출현율 상승이 ×${minRatio} 미만 (×${ratio.toFixed(2)})`)
  }

  if (errors.length) {
    console.log('실패:')
    for (const e of errors) console.log('  - ' + e)
    process.exit(1)
  }
  console.log('통과')
}
