/**
 * Upgrades.rollChoices() 구성 규칙을 정적으로(브라우저 없이) 검증한다.
 * 슬롯 3축 재편(작업 지시 P8 커밋1)으로 핵심 슬롯이 3개(gun/sword/character),
 * 각인이 축별 3개 풀(gun-sigil/sword-sigil/character-sigil)로 나뉜 뒤의
 * rollChoices() 전체 동작을 검증한다 — 예전(커밋1 이전) 버전은 "각인만 있는
 * 상태" 전용이라 지금 POOL과 맞지 않아 폐기했다.
 *
 * 검증하는 것:
 *   - 어떤 coreSlots/traitStacks 조합에서도 요청한 장수(count)만큼 항상 채워지는가
 *   - 빈 핵심 슬롯이 있으면 최대 2장까지 그 슬롯 특성이 우선 배치되는가
 *   - 핵심 슬롯이 모두 찼을 때, 보유(스택 1 이상) 각인이 있으면 결과에
 *     최소 1장은 보유 각인을 포함하는가(확정 이득 규칙의 전신)
 *   - 각인 축(gun-sigil/sword-sigil/character-sigil)별 출현 비율 — 통과/실패
 *     기준은 아니고 보고 전용(축마다 보유 종수가 2/2/3으로 달라 완전 균등은
 *     기대치가 아니다)
 *
 * state_snapshot.mjs와 같은 방식으로 esbuild가 TS를 번들해 순수 node에서
 * POOL/rollChoices/CORE_SLOTS/SIGIL_SLOTS를 직접 import한다 — 게임 UI 없이
 * 로직만 표본추출한다.
 *
 * 사용: node tools/verify_roll_choices.mjs [표본수=2000]
 */
import { build } from 'vite'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const N = Number(process.argv[2] ?? 2000)

const ENTRY = `export { POOL, rollChoices, CORE_SLOTS, SIGIL_SLOTS, isSigilSlot } from './src/systems/Upgrades'`
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
  const { POOL, rollChoices, CORE_SLOTS, SIGIL_SLOTS, isSigilSlot } = await import(pathToFileURL(bundlePath).href)
  run(POOL, rollChoices, CORE_SLOTS, SIGIL_SLOTS, isSigilSlot)
} finally {
  rmSync(entryPath, { force: true })
  rmSync(bundleDir, { force: true, recursive: true })
}

function run(POOL, rollChoices, CORE_SLOTS, SIGIL_SLOTS, isSigilSlot) {
  const count = 3
  const sigilIds = POOL.filter((u) => isSigilSlot(u.slot)).map((u) => u.id)
  const coreIdsBySlot = new Map(CORE_SLOTS.map((s) => [s, POOL.filter((u) => u.slot === s).map((u) => u.id)]))

  let underfilled = 0
  let emptySlotPriorityViolations = 0
  let missingOwnedPick = 0
  const underfilledSamples = []
  const priorityViolationSamples = []
  const missingOwnedSamples = []
  const axisCount = Object.fromEntries(SIGIL_SLOTS.map((s) => [s, 0]))

  for (let i = 0; i < N; i++) {
    // coreSlots: 각 축을 50% 확률로 "이미 보유"(그 축의 무작위 특성)로 채운다.
    const coreSlots = new Map()
    for (const slot of CORE_SLOTS) {
      if (Math.random() < 0.5) {
        const ids = coreIdsBySlot.get(slot)
        coreSlots.set(slot, ids[Math.floor(Math.random() * ids.length)])
      }
    }
    // traitStacks: 각인은 50% 확률로 1~2스택 보유 중(maxStacks=3 미만 유지).
    // 핵심 슬롯 특성도 traitStacks에 들어갈 수 있다(획득 시 acquired 집계는
    // 별도지만 canAcquireTrait 판정 자체는 traitStacks를 안 본다 — rollChoices는
    // coreSlots만으로 핵심 슬롯 보유 여부를 판정하므로 여기선 sigil만 채운다).
    const traitStacks = new Map()
    for (const id of sigilIds) {
      if (Math.random() < 0.5) traitStacks.set(id, 1 + Math.floor(Math.random() * 2))
    }

    const choices = rollChoices(count, traitStacks, coreSlots)

    if (choices.length !== count) {
      underfilled++
      if (underfilledSamples.length < 5) {
        underfilledSamples.push({ i, got: choices.length, want: count, coreSlots: [...coreSlots.entries()], traitStacks: [...traitStacks.entries()] })
      }
    }

    const emptySlots = CORE_SLOTS.filter((s) => !coreSlots.has(s))
    if (emptySlots.length > 0) {
      // 빈 핵심 슬롯이 있으면 min(2,count)장은 그 슬롯 특성이어야 한다(각인이 섞이면 안 됨).
      const expectedSlotCards = Math.min(2, count)
      const firstCards = choices.slice(0, expectedSlotCards)
      const ok = firstCards.every((u) => !isSigilSlot(u.slot) && emptySlots.includes(u.slot))
      if (!ok) {
        emptySlotPriorityViolations++
        if (priorityViolationSamples.length < 5) {
          priorityViolationSamples.push({ i, emptySlots, choices: choices.map((u) => ({ id: u.id, slot: u.slot })) })
        }
      }
    } else {
      // 핵심 슬롯이 모두 찼을 때 — 보유 각인이 있으면 최소 1장은 보유 각인 포함.
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

    for (const u of choices) if (isSigilSlot(u.slot)) axisCount[u.slot]++
  }

  console.log(`rollChoices() 표본 검증 — ${N}회 (핵심 슬롯 3축 + 각인 3축, 작업 지시 P8 커밋1)`)
  console.log(`  ${count}장 항상 채워짐: ${N - underfilled}/${N} (${underfilled}건 미달)`)
  console.log(`  빈 핵심 슬롯 우선 배치(최대 2장) 준수: 위반 ${emptySlotPriorityViolations}건`)
  console.log(`  핵심 슬롯 만석 시 보유 각인 최소 1장 포함: 위반 ${missingOwnedPick}건`)
  const totalSigilPicks = Object.values(axisCount).reduce((a, b) => a + b, 0)
  console.log(`  각인 축별 출현 비율(정보용, 축마다 보유 종수가 달라 완전 균등은 기대치 아님):`)
  for (const slot of SIGIL_SLOTS) {
    const c = axisCount[slot]
    const pct = totalSigilPicks > 0 ? ((c / totalSigilPicks) * 100).toFixed(1) : '0.0'
    console.log(`    ${slot}: ${c} (${pct}%)`)
  }

  if (underfilled > 0) console.log('  미달 표본:', JSON.stringify(underfilledSamples, null, 2))
  if (emptySlotPriorityViolations > 0) console.log('  우선배치 위반 표본:', JSON.stringify(priorityViolationSamples, null, 2))
  if (missingOwnedPick > 0) console.log('  보유각인 누락 표본:', JSON.stringify(missingOwnedSamples, null, 2))

  if (underfilled > 0 || emptySlotPriorityViolations > 0 || missingOwnedPick > 0) {
    console.error('rollChoices() 구성 규칙 검증 실패')
    process.exit(1)
  }
  console.log('통과')
}
