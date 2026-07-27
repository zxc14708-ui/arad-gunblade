#!/usr/bin/env node
/**
 * QC 하네스 — 빌드하고, 실제로 플레이하고, 화면을 찍어 남긴다.
 *
 *   npm run qc                 빌드 + 프리뷰 서버 + 전 시나리오 주행
 *   npm run qc -- --url <URL>  이미 떠 있는 서버에 붙어서 주행 (빌드 생략)
 *   npm run qc -- --only town  이름에 'town'이 들어간 단계만
 *
 * 산출물 (qc-out/):
 *   contact.png      전 단계 한 장 요약 — 리뷰는 이것부터 본다
 *   NN-<단계>.png     단계별 전체 화면
 *   NN-<단계>-zoom.png 플레이어 주변 확대 (스프라이트 결함 확인용)
 *   report.txt       콘솔 에러 / 실패 단계 / 판정
 *
 * 종료 코드가 0이 아니면 그 PR 은 반려다.
 * 이 게임의 버그는 대부분 타입 체크나 유닛 테스트가 아니라 '화면을 봐야' 잡혔다.
 * (프레임 슬라이싱, fx 텍스처 검게 나옴, 총구 화염 위치, 보스 보상 미출현)
 */
import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'qc-out')
const PORT = 4390
const VIEW = { width: 1280, height: 760 }
const ZOOM = { w: 300, h: 190 } // 플레이어 주변 확대 크롭 크기

const argv = process.argv.slice(2)
const arg = (k) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : null
}
const only = arg('--only')
const url = arg('--url')

// ── 브라우저 실행 파일 찾기 ────────────────────────────────────────────
function chromePath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(base)) throw new Error(`브라우저 경로 없음: ${base}`)
  const dir = readdirSync(base)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .pop()
  if (!dir) throw new Error(`${base} 에 chromium-* 없음`)
  return join(base, dir, 'chrome-linux', 'chrome')
}

// ── 시나리오 ──────────────────────────────────────────────────────────
// 조작: 좌클릭 사격 · 우클릭/Space 베기 · Shift+이동 대시 · R 장전 · E 상호작용 · Tab 설정
const aim = (p, dx) => p.mouse.move(VIEW.width / 2 + dx, VIEW.height / 2)

const STEPS = [
  {
    name: 'town-idle',
    what: '마을 진입 · 오른쪽 조준 대기 — 카타나가 온전히 그려지는가',
    async run(p) {
      await p.click('#startBtn')
      await p.waitForTimeout(2200)
      await aim(p, 400)
      await p.waitForTimeout(500)
    },
  },
  {
    name: 'town-walk',
    what: '걷기 모션 · 좌우 반전',
    async run(p) {
      await aim(p, -400)
      await p.keyboard.down('KeyA')
      await p.waitForTimeout(600)
      await p.keyboard.up('KeyA')
      await p.waitForTimeout(120)
    },
  },
  {
    name: 'shoot',
    what: '사격 — 총구 화염이 총구 앞에 뜨는가 (뒤통수 아님)',
    async run(p) {
      await aim(p, 400)
      await p.waitForTimeout(300)
      await p.mouse.down()
      await p.waitForTimeout(140)
    },
    async after(p) {
      await p.mouse.up()
    },
  },
  {
    name: 'reload',
    what: '장전 — 탄창 UI 가 7/7 로 복귀하는가',
    async run(p) {
      await p.keyboard.press('KeyR')
      await p.waitForTimeout(1400)
    },
    check: async (p) => {
      const t = await p.textContent('#ammoText').catch(() => null)
      return t && t.includes('7') ? null : `탄약 표시가 '${t}'`
    },
  },
  {
    name: 'slash',
    what: '베기 — 검이 손에 붙어 있고 궤적이 전방에 뜨는가',
    async run(p) {
      await p.mouse.down({ button: 'right' })
      await p.waitForTimeout(130)
    },
    async after(p) {
      await p.mouse.up({ button: 'right' })
    },
  },
  {
    name: 'dash',
    what: '대시 — 잔상이 남는가',
    async run(p) {
      await p.keyboard.down('KeyD')
      await p.keyboard.down('ShiftLeft')
      await p.waitForTimeout(130)
    },
    async after(p) {
      await p.keyboard.up('ShiftLeft')
      await p.keyboard.up('KeyD')
    },
  },
  {
    name: 'settings',
    what: '설정창 — 음량 3종 + 획득 특성 목록',
    async run(p) {
      await p.keyboard.press('Tab')
      await p.waitForTimeout(400)
    },
    check: async (p) => {
      const ok = await p.isVisible('#volMaster').catch(() => false)
      return ok ? null : '설정창이 열리지 않음'
    },
    async after(p) {
      await p.keyboard.press('Tab')
      await p.waitForTimeout(300)
    },
  },
  {
    name: 'dungeon',
    what: '포탈로 던전 입장 — 방이 생성되고 적이 배치되는가',
    async run(p) {
      await walkTo(p, 'portal')
      for (let i = 0; i < 8; i++) {
        await p.keyboard.press('KeyE')
        await p.waitForTimeout(300)
        if (await inDungeon(p)) break
      }
      await p.waitForTimeout(1400)
    },
    check: async (p) => ((await inDungeon(p)) ? null : '던전에 진입하지 못함'),
  },
  {
    name: 'combat',
    what: '전투 — 피격 이펙트 / 데미지 숫자 / 사망 연출',
    async run(p) {
      for (let i = 0; i < 5; i++) {
        await aim(p, i % 2 ? 400 : -400)
        await p.mouse.down()
        await p.waitForTimeout(260)
        await p.mouse.up()
        await p.mouse.down({ button: 'right' })
        await p.waitForTimeout(200)
        await p.mouse.up({ button: 'right' })
      }
      await p.waitForTimeout(200)
    },
  },
]

const inDungeon = (p) =>
  p.evaluate(() => window.__game?.mode === 'dungeon').catch(() => false)

/**
 * 상호작용 오브젝트까지 걸어간다.
 * 방 배치가 매 판 랜덤이라 "위로 2.6초" 같은 고정 이동은 신뢰할 수 없다.
 */
async function walkTo(p, kind, ms = 6000) {
  const held = new Set()
  const t0 = Date.now()
  try {
    while (Date.now() - t0 < ms) {
      const d = await p.evaluate((k) => {
        const g = window.__game
        const o = g?.interactables?.find((i) => i.kind === k && !i.used)
        if (!o || !g.player?.pos) return null
        return { dx: o.pos.x - g.player.pos.x, dz: o.pos.z - g.player.pos.z }
      }, kind)
      if (!d) return false
      if (Math.hypot(d.dx, d.dz) < 1.6) return true
      const want = new Set()
      if (d.dx > 0.6) want.add('KeyD')
      if (d.dx < -0.6) want.add('KeyA')
      if (d.dz > 0.6) want.add('KeyS')
      if (d.dz < -0.6) want.add('KeyW')
      for (const k of held) if (!want.has(k)) (await p.keyboard.up(k), held.delete(k))
      for (const k of want) if (!held.has(k)) (await p.keyboard.down(k), held.add(k))
      await p.waitForTimeout(80)
    }
    return false
  } finally {
    for (const k of held) await p.keyboard.up(k).catch(() => {})
  }
}

// ── 주행 ──────────────────────────────────────────────────────────────
const errors = []
const results = []
const assetReport = checkAssetIntegrity()

let server = null
let port = PORT
if (!url) {
  console.log('· 빌드')
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })
  port = await freePort(PORT)
  console.log(`· 프리뷰 :${port}`)
  // Windows 의 spawn()은 셸을 거치지 않아 확장자 없는 'npx'를 ENOENT로 못 찾는다
  // (npm이 깔아둔 실제 실행 파일은 npx.cmd) — execSync는 항상 셸을 거쳐 괜찮지만
  // 이 spawn은 그렇지 않으므로 플랫폼별로 분기한다.
  // npx.cmd는 배치 파일이라 shell:false로 직접 spawn하면 Windows에서 EINVAL이
  // 난다 — .cmd/.bat 실행은 cmd.exe를 통해야 하므로 win32에서는 shell:true.
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  server = spawn(npxCmd, ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
    shell: process.platform === 'win32',
  })
  // 'error' 이벤트를 안 받으면 Node가 처리되지 않은 예외로 던져 QC가 그대로
  // 멈추거나 비정상 종료한다 — spawn 실패(ENOENT 등)를 리포트로 흡수한다.
  server.on('error', (e) => {
    errors.push(`프리뷰 서버 실행 실패 (${npxCmd}): ${e.message}`)
  })
  await waitFor(`http://localhost:${port}/`)
  await assertServesLocalBuild(`http://localhost:${port}/`)
}
const target = url || `http://localhost:${port}/`

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const ctx = await browser.newContext({ viewport: VIEW })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('requestfailed', (r) => errors.push(`request: ${r.url()} — ${r.failure()?.errorText}`))

await page.goto(target, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

let i = 0
for (const s of STEPS) {
  i++
  if (only && !s.name.includes(only)) continue
  const tag = `${String(i).padStart(2, '0')}-${s.name}`
  let fail = null
  try {
    await s.run(page)
    await page.screenshot({ path: join(OUT, `${tag}.png`) })
    await zoomShot(page, join(OUT, `${tag}-zoom.png`))
    if (s.check) fail = await s.check(page)
  } catch (e) {
    fail = e.message.split('\n')[0]
  }
  if (s.after) await s.after(page).catch(() => {})
  results.push({ tag, what: s.what, fail })
  console.log(`${fail ? '✗' : '✓'} ${tag}  ${s.what}${fail ? `\n    → ${fail}` : ''}`)
}

await contactSheet(page)
await browser.close()
if (server) try { process.kill(-server.pid) } catch {}

// ── 리포트 ────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.fail)
const report = [
  `대상: ${target}`,
  `시각: ${new Date().toISOString()}`,
  '',
  `에셋 무결성 검사: ${assetReport.ok ? '통과' : '위반'}`,
  ...assetReport.output.split('\n').map((l) => `  ${l}`),
  '',
  '단계',
  ...results.map((r) => `  ${r.fail ? '✗' : '✓'} ${r.tag}  ${r.what}${r.fail ? `  → ${r.fail}` : ''}`),
  '',
  `콘솔/네트워크 오류 ${errors.length}건`,
  ...errors.map((e) => `  ${e}`),
  '',
  failed.length || errors.length ? '판정: 반려' : '판정: 합격 (자동 검사 기준)',
  '',
  '※ 자동 검사는 "죽지 않았다"까지만 본다. 스프라이트 결함·이펙트 위치·',
  '   레이아웃 깨짐은 contact.png 를 눈으로 확인해야 판정된다.',
].join('\n')
writeFileSync(join(OUT, 'report.txt'), report)
console.log(`\n${report}\n\n산출물: ${OUT}/contact.png`)
process.exit(failed.length || errors.length ? 1 : 0)

// ── 헬퍼 ──────────────────────────────────────────────────────────────

/**
 * FRAMES/ASPECT/에셋 경로 같은, 스크립트로 판정 가능한 것들은 사람 눈이 아니라
 * tools/measure_sprites.py 가 본다 (몬스터 시트 규격, assets.ts 경로 실존,
 * 모서리 알파, Interactable ASPECT 대조). 브라우저 없이 도는 정적 검사라
 * 빌드/서버 기동보다 먼저, 항상 돌린다.
 */
function checkAssetIntegrity() {
  console.log('· 에셋 무결성 검사 (tools/measure_sprites.py)')
  try {
    const out = execSync('python3 tools/measure_sprites.py', { cwd: ROOT, encoding: 'utf-8' })
    console.log(out)
    return { ok: true, output: out }
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    console.log(out)
    errors.push('에셋 무결성 검사 실패 (tools/measure_sprites.py) — 위 출력의 "위반" 항목 참조')
    return { ok: false, output: out }
  }
}

async function waitFor(u, tries = 40) {
  for (let n = 0; n < tries; n++) {
    try {
      const r = await fetch(u)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`서버가 뜨지 않음: ${u}`)
}

/** 안 쓰는 포트를 고른다 — 이미 떠 있는 서버에 붙으면 엉뚱한 빌드를 검사하게 된다 */
async function freePort(from) {
  const net = await import('node:net')
  for (let p = from; p < from + 40; p++) {
    const ok = await new Promise((res) => {
      const s = net.createServer()
      s.once('error', () => res(false))
      s.once('listening', () => s.close(() => res(true)))
      s.listen(p, '127.0.0.1')
    })
    if (ok) return p
  }
  throw new Error(`빈 포트를 찾지 못함 (${from}~)`)
}

/**
 * 서버가 내보내는 번들이 방금 빌드한 dist 와 같은지 확인한다.
 * 이 검사가 없으면 남아 있던 다른 프로젝트의 프리뷰 서버에 붙어
 * '전부 통과'라는 잘못된 합격 판정을 낼 수 있다. (실제로 한 번 났다)
 */
async function assertServesLocalBuild(u) {
  const html = await (await fetch(u)).text()
  const served = html.match(/index-[A-Za-z0-9_-]+\.js/)?.[0]
  const local = readdirSync(join(ROOT, 'dist', 'assets')).find((f) => /^index-.*\.js$/.test(f))
  if (!served || !local || served !== local) {
    throw new Error(`서버가 다른 빌드를 서빙 중: 서버=${served} 로컬=${local}`)
  }
}

/** 플레이어 주변만 확대 캡처 — 캐릭터가 화면에서 작아 전체 샷으론 결함이 안 보인다 */
async function zoomShot(page, path) {
  const pt = await page
    .evaluate(() => {
      const g = window.__game
      if (!g?.player?.pos || !g?.camera) return null
      const v = g.player.pos.clone()
      v.y += 1.4
      v.project(g.camera)
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((-v.y + 1) / 2) * innerHeight }
    })
    .catch(() => null)
  const cx = pt ? pt.x : VIEW.width / 2
  const cy = pt ? pt.y : VIEW.height / 2
  const clip = {
    x: Math.max(0, Math.min(VIEW.width - ZOOM.w, cx - ZOOM.w / 2)),
    y: Math.max(0, Math.min(VIEW.height - ZOOM.h, cy - ZOOM.h / 2)),
    width: ZOOM.w,
    height: ZOOM.h,
  }
  await page.screenshot({ path, clip })
}

/** 전 단계를 한 장으로 — 리뷰어(사람이든 모델이든)가 처음 보는 화면 */
async function contactSheet(page) {
  const cards = results
    .map((r) => {
      const full = b64(join(OUT, `${r.tag}.png`))
      const zoom = b64(join(OUT, `${r.tag}-zoom.png`))
      if (!full) return ''
      return `<figure class="${r.fail ? 'bad' : ''}">
        <figcaption><b>${r.tag}</b>${r.fail ? ` — 실패: ${esc(r.fail)}` : ''}<br><span>${esc(r.what)}</span></figcaption>
        <div class="row"><img class="full" src="${full}">${zoom ? `<img class="zoom" src="${zoom}">` : ''}</div>
      </figure>`
    })
    .join('')
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{background:#14161a;color:#e8e8e8;font:13px/1.5 ui-monospace,monospace;margin:0;padding:20px}
    h1{font-size:16px;margin:0 0 4px}
    .meta{color:#8b93a1;margin-bottom:18px}
    figure{margin:0 0 18px;border:1px solid #2a2f38;border-radius:6px;overflow:hidden}
    figure.bad{border-color:#c0392b}
    figcaption{padding:8px 12px;background:#1c1f26}
    figure.bad figcaption{background:#3a1d1a}
    figcaption span{color:#8b93a1}
    .row{display:flex;gap:0;align-items:flex-start;background:#0d0f12}
    img.full{width:640px;display:block}
    img.zoom{width:600px;image-rendering:pixelated;border-left:1px solid #2a2f38}
  </style>
  <h1>ARAD: GUNBLADE — QC ${errors.length || results.some((r) => r.fail) ? '반려' : '합격'}</h1>
  <div class="meta">${new Date().toISOString()} · 오류 ${errors.length}건 · 실패 ${results.filter((r) => r.fail).length}/${results.length}</div>
  ${cards}`
  const p2 = await ctx.newPage()
  await p2.setViewportSize({ width: 1320, height: 900 })
  await p2.setContent(html)
  await p2.screenshot({ path: join(OUT, 'contact.png'), fullPage: true })
  await p2.close()
}

function esc(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])
}
function b64(p) {
  try {
    return `data:image/png;base64,${readFileSync(p).toString('base64')}`
  } catch {
    return null
  }
}
