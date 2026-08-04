/**
 * Upgrades.rollChoices() 구성 규칙을 정적으로(브라우저 없이) 검증한다.
 *
 * 검증하는 것 (커밋 1 완료 기준):
 *   - 각인만 존재하는 현재 상태에서 요청한 장수(count)만큼 항상 채워지는가
 *   - 보유(스택 1 이상) 각인이 있을 때 결과에 최소 1장은 보유 각인인가
 *
 * state_snapshot.mjs와 같은 방식으로 esbuild가 TS를 번들해 순수 node에서
 * POOL/rollChoices를 직접 import한다 — 게임 UI 없이 로직만 표본추출한다.
 *
 * 사용: node tools/verify_roll_choices.mjs [표본수=2000]
 */
import { build } from 'vite'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const N = Number(process.argv[2] ?? 2000)

const ENTRY = `export { POOL, rollChoices } from './src/systems/Upgrades'`
const entryPath = join(ROOT, '.roll-choices-entry.ts')
const bundleDir = join(ROOT, '.roll-choices-tmp')
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
  const { POOL, rollChoices } = await import(pathToFileURL(bundlePath).href)
  run(POOL, rollChoices)
} finally {
  rmSync(entryPath, { force: true })
  rmSync(bundleDir, { force: true, recursive: true })
}

function run(POOL, rollChoices) {
  const sigilIds = POOL.filter((u) => u.slot === 'sigil').map((u) => u.id)
  if (POOL.some((u) => u.slot !== 'sigil')) {
    console.error(`검증 전제 위반: 현재 POOL에 sigil이 아닌 특성이 있음(커밋 1 범위 밖) — 표본 검증은 "각인만 있는 상태" 전용`)
  }

  let underfilled = 0
  let missingOwnedPick = 0
  const underfilledSamples = []
  const missingOwnedSamples = []

  for (let i = 0; i < N; i++) {
    // 이번 시행의 traitStacks: 무작위로 일부 각인을 "보유 중"으로 미리 채워
    // "보유 각인 있을 때 최소 1장 보유" 규칙이 실제로 시험되게 한다.
    const traitStacks = new Map()
    for (const id of sigilIds) {
      if (Math.random() < 0.5) traitStacks.set(id, 1 + Math.floor(Math.random() * 2)) // maxStacks 미만으로 유지
    }
    const count = 3
    const choices = rollChoices(count, traitStacks, new Map())

    if (choices.length !== count) {
      underfilled++
      if (underfilledSamples.length < 5) {
        underfilledSamples.push({ i, got: choices.length, want: count, traitStacks: [...traitStacks.entries()] })
      }
    }

    const hasOwned = [...traitStacks.keys()].some((id) => (traitStacks.get(id) ?? 0) > 0)
    if (hasOwned) {
      const gotOwned = choices.some((u) => (traitStacks.get(u.id) ?? 0) > 0)
      if (!gotOwned) {
        missingOwnedPick++
        if (missingOwnedSamples.length < 5) {
          missingOwnedSamples.push({ i, choices: choices.map((u) => u.id), traitStacks: [...traitStacks.entries()] })
        }
      }
    }
  }

  console.log(`rollChoices() 표본 검증 — ${N}회`)
  console.log(`  3장 항상 채워짐: ${N - underfilled}/${N} (${underfilled}건 미달)`)
  console.log(`  보유 각인 있을 때 최소 1장 보유 포함: 위반 ${missingOwnedPick}건`)

  if (underfilled > 0) {
    console.log('  미달 표본:', JSON.stringify(underfilledSamples, null, 2))
  }
  if (missingOwnedPick > 0) {
    console.log('  위반 표본:', JSON.stringify(missingOwnedSamples, null, 2))
  }

  if (underfilled > 0 || missingOwnedPick > 0) {
    console.error('rollChoices() 구성 규칙 검증 실패')
    process.exit(1)
  }
  console.log('통과')
}
