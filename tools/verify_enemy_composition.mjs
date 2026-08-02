/**
 * RunState.enemiesFor() (일반 전투방 적 등장표)가 기존 하드코딩된 중첩 조건문과
 * 동일한 확률을 내는지 맵 생성 표본으로 검증한다.
 *
 * 기존 로직(스테이지 데이터화 이전, RunState.ts 주석에 보존):
 *   depth>=3 && r<0.2 → brute, depth>=2 && r<0.5 → shooter, else → imp
 * 이론값: depth<2 → imp 100%; depth==2 → shooter 50% / imp 50%;
 *         depth>=3 → brute 20% / shooter 30% / imp 50%.
 *
 * verify_roll_choices.mjs와 같은 방식으로 esbuild가 TS를 번들해 순수 node에서
 * RunState를 직접 import한다 — 브라우저 없이 로직만 표본추출한다. RunState는
 * Game에 의존하지 않아 standalone 인스턴스화가 안전하다(qcDebugHooks.ts의
 * debugFountainSample과 동일 전제).
 *
 * 사용: node tools/verify_enemy_composition.mjs [표본수=2000]
 */
import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const N = Number(process.argv[2] ?? 2000)

const ENTRY = `export { RunState } from './src/systems/RunState'`
const entryPath = join(ROOT, '.enemy-comp-entry.ts')
const bundlePath = join(ROOT, '.enemy-comp-bundle.mjs')

const THEORY = {
  '<2': { imp: 1.0, shooter: 0, brute: 0 },
  '==2': { imp: 0.5, shooter: 0.5, brute: 0 },
  '>=3': { imp: 0.5, shooter: 0.3, brute: 0.2 },
}
const TOLERANCE = 0.03 // 표본 오차 허용치 (percentage points)

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
  const { RunState } = await import(pathToFileURL(bundlePath).href)
  run(RunState)
} finally {
  rmSync(entryPath, { force: true })
  rmSync(bundlePath, { force: true })
}

function bucketOf(depth) {
  if (depth < 2) return '<2'
  if (depth === 2) return '==2'
  return '>=3'
}

function run(RunState) {
  const counts = {
    '<2': { imp: 0, shooter: 0, brute: 0, total: 0 },
    '==2': { imp: 0, shooter: 0, brute: 0, total: 0 },
    '>=3': { imp: 0, shooter: 0, brute: 0, total: 0 },
  }

  for (let i = 0; i < N; i++) {
    const run = new RunState()
    run.enterFirst()
    const nodes = run.nodes // private in TS, plain field at runtime
    for (const node of nodes.values()) {
      const plan = node.plan
      if (plan.kind !== 'combat') continue
      const bucket = bucketOf(plan.depth)
      const b = counts[bucket]
      for (const kind of plan.enemies) {
        b.total++
        if (kind === 'imp') b.imp++
        else if (kind === 'shooter') b.shooter++
        else if (kind === 'brute') b.brute++
      }
    }
  }

  console.log(`enemiesFor() 표본 검증 — 맵 생성 ${N}회, 전투방 적 등장 비율`)
  let failed = false
  for (const bucket of ['<2', '==2', '>=3']) {
    const b = counts[bucket]
    const theory = THEORY[bucket]
    console.log(`\ndepth ${bucket} (표본 적 수 ${b.total}):`)
    for (const kind of ['imp', 'shooter', 'brute']) {
      const observed = b.total > 0 ? b[kind] / b.total : 0
      const expected = theory[kind]
      const diff = Math.abs(observed - expected)
      const ok = diff <= TOLERANCE
      if (!ok) failed = true
      console.log(
        `  ${kind}: 실측 ${(observed * 100).toFixed(2)}% / 이론 ${(expected * 100).toFixed(2)}% ` +
        `(차이 ${(diff * 100).toFixed(2)}pt) ${ok ? 'OK' : 'FAIL'}`,
      )
    }
  }

  if (failed) {
    console.error('\nenemiesFor() 표본 검증 실패 — 이론값과 허용 오차를 벗어남')
    process.exit(1)
  }
  console.log('\n통과 — enemiesFor()는 기존 중첩 조건문과 동일한 확률을 낸다')
}
