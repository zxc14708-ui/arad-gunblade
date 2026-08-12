/**
 * 노드 등급 보상 규칙(작업 지시 P8 커밋3)을 정적으로(브라우저 없이) 검증한다.
 *
 * 검증하는 것:
 *   - nodeGradeFor(stage, kind) 표가 지시문 표 그대로인가
 *     (1-2:노멀, 3-4:레어, 5-6:유니크, 7:레전더리 · trait는 보정 없음,
 *     hardCombat/elite/boss는 +1 · 에픽은 스테이지7의 hardCombat/elite/boss에서만)
 *   - rollNodeSigilRewards()가 반환하는 모든 각인 오퍼의 등급이 nodeGrade를
 *     넘지 않는가(승급 상한)
 *   - 각인 후보가 하나라도 있는 상황에서 최소 1장은 각인(확정 이득)인가
 *
 * state_snapshot.mjs와 같은 방식으로 esbuild가 TS를 번들해 순수 node에서
 * 필요한 export를 직접 import한다.
 *
 * 사용: node tools/verify_node_grade_rewards.mjs [표본수=2000]
 */
import { build } from 'vite'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const N = Number(process.argv[2] ?? 2000)

const ENTRY = `export { POOL, rollNodeSigilRewards, nodeGradeFor, CORE_SLOTS, SIGIL_SLOTS, isSigilSlot, GRADES, gradeIndex } from './src/systems/Upgrades'`
const entryPath = join(ROOT, '.node-grade-entry.ts')
const bundleDir = join(ROOT, '.node-grade-tmp')
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
  run(m)
} finally {
  rmSync(entryPath, { force: true })
  rmSync(bundleDir, { force: true, recursive: true })
}

function run({ POOL, rollNodeSigilRewards, nodeGradeFor, CORE_SLOTS, SIGIL_SLOTS, isSigilSlot, GRADES, gradeIndex }) {
  const sigilIds = POOL.filter((u) => isSigilSlot(u.slot)).map((u) => u.id)
  const coreIdsBySlot = new Map(CORE_SLOTS.map((s) => [s, POOL.filter((u) => u.slot === s).map((u) => u.id)]))
  const NODE_KINDS = ['trait', 'hardCombat', 'elite', 'boss']

  // ── 1. 스테이지×노드 등급 표 검증(표 그대로) ──
  const EXPECTED = {
    trait: { 1: 'normal', 2: 'normal', 3: 'rare', 4: 'rare', 5: 'unique', 6: 'unique', 7: 'legendary' },
    hardCombat: { 1: 'rare', 2: 'rare', 3: 'unique', 4: 'unique', 5: 'legendary', 6: 'legendary', 7: 'epic' },
    elite: { 1: 'rare', 2: 'rare', 3: 'unique', 4: 'unique', 5: 'legendary', 6: 'legendary', 7: 'epic' },
    boss: { 1: 'rare', 2: 'rare', 3: 'unique', 4: 'unique', 5: 'legendary', 6: 'legendary', 7: 'epic' },
  }
  const tableMismatches = []
  for (const kind of NODE_KINDS) {
    for (let stage = 1; stage <= 7; stage++) {
      const got = nodeGradeFor(stage, kind)
      const want = EXPECTED[kind][stage]
      if (got !== want) tableMismatches.push({ stage, kind, got, want })
    }
  }
  // 에픽은 스테이지7의 hardCombat/elite/boss에서만 나와야 한다(그 외 전부 아님).
  const epicLeaks = []
  for (const kind of NODE_KINDS) {
    for (let stage = 1; stage <= 7; stage++) {
      const isEpic = nodeGradeFor(stage, kind) === 'epic'
      const shouldBeEpic = stage === 7 && kind !== 'trait'
      if (isEpic !== shouldBeEpic) epicLeaks.push({ stage, kind, isEpic, shouldBeEpic })
    }
  }

  // ── 2. 표본 — 승급 상한 + 확정 이득 1장 ──
  let capViolations = 0
  let missingGuaranteed = 0
  const capSamples = []
  const guaranteedSamples = []

  for (let i = 0; i < N; i++) {
    const stage = 1 + Math.floor(Math.random() * 7)
    const kind = NODE_KINDS[Math.floor(Math.random() * NODE_KINDS.length)]
    const count = kind === 'elite' ? 4 : 3
    const nodeGrade = nodeGradeFor(stage, kind)

    const coreSlots = new Map()
    for (const slot of CORE_SLOTS) {
      if (Math.random() < 0.5) {
        const ids = coreIdsBySlot.get(slot)
        coreSlots.set(slot, ids[Math.floor(Math.random() * ids.length)])
      }
    }
    const sigilGrades = new Map()
    for (const id of sigilIds) {
      if (Math.random() < 0.5) sigilGrades.set(id, GRADES[Math.floor(Math.random() * GRADES.length)])
    }

    const choices = rollNodeSigilRewards(count, nodeGrade, sigilGrades, coreSlots)

    // 승급 상한: 오퍼로 나온 각인은 전부 grade <= nodeGrade여야 한다.
    for (const u of choices) {
      if (isSigilSlot(u.slot) && u.grade && gradeIndex(u.grade) > gradeIndex(nodeGrade)) {
        capViolations++
        if (capSamples.length < 5) capSamples.push({ i, stage, kind, nodeGrade, offered: u.grade, id: u.id })
        break
      }
    }

    // 확정 이득 1장: 이 nodeGrade에서 미보유이거나 승급 가능한 각인이
    // 하나라도 있다면(=각인 후보가 존재), choices 중 최소 1장은 각인이어야 한다.
    const hasSigilCandidate = sigilIds.some((id) => {
      const cur = sigilGrades.get(id)
      return !cur || gradeIndex(nodeGrade) > gradeIndex(cur)
    })
    if (hasSigilCandidate) {
      const gotSigil = choices.some((u) => isSigilSlot(u.slot))
      if (!gotSigil) {
        missingGuaranteed++
        if (guaranteedSamples.length < 5) guaranteedSamples.push({ i, stage, kind, nodeGrade, choices: choices.map((u) => u.id) })
      }
    }
  }

  console.log(`노드 등급 보상 표본 검증 — ${N}회 (작업 지시 P8 커밋3)`)
  console.log(`  스테이지×노드 등급 표 불일치: ${tableMismatches.length}건`)
  if (tableMismatches.length) console.log('   ', JSON.stringify(tableMismatches))
  console.log(`  에픽 노출 범위(스테이지7의 hardCombat/elite/boss만) 위반: ${epicLeaks.length}건`)
  if (epicLeaks.length) console.log('   ', JSON.stringify(epicLeaks))
  console.log(`  승급 상한(오퍼 등급 ≤ nodeGrade) 위반: ${capViolations}건`)
  console.log(`  확정 이득 1장(각인 후보 있으면 최소 1장 각인) 위반: ${missingGuaranteed}건`)

  if (capSamples.length) console.log('  상한 위반 표본:', JSON.stringify(capSamples, null, 2))
  if (guaranteedSamples.length) console.log('  확정이득 위반 표본:', JSON.stringify(guaranteedSamples, null, 2))

  if (tableMismatches.length || epicLeaks.length || capViolations || missingGuaranteed) {
    console.error('노드 등급 보상 규칙 검증 실패')
    process.exit(1)
  }
  console.log('통과')
}
