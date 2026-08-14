#!/usr/bin/env node
/**
 * QC 하네스 — 빌드하고, 실제로 플레이하고, 화면을 찍어 남긴다.
 *
 *   npm run qc                 빌드 + 프리뷰 서버 + 전 시나리오 주행
 *   npm run qc -- --url <URL>  이미 떠 있는 서버에 붙어서 주행 (빌드 생략)
 *   npm run qc -- --only town  이름에 'town'이 들어간 단계만 — ensureBaseline()
 *                              이 게임 시작(+ 필요시 스텝의 needs 필드에 따라
 *                              enterDungeon())만 부트스트랩하고 선행 단계는
 *                              다시 재생하지 않는다. 개발 중 특정 트레잇 하나만
 *                              반복 검증할 때 이 옵션을 써야 풀 30단계를 매번
 *                              안 돈다. run-reset/shop-persist처럼 needs가
 *                              없는 스텝은 여러 방 실제 이동이 필요해 예외 —
 *                              전체 주행으로 검증할 것.
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
const VIEW = { width: 1920, height: 1080 }
const ZOOM = { w: 450, h: 285 } // 1920×1080 기준 플레이어 주변 확대 크롭

const argv = process.argv.slice(2)
const arg = (k) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : null
}
const only = arg('--only')
const url = arg('--url')

// ── 브라우저 실행 파일 찾기 ────────────────────────────────────────────
/**
 * /opt/pw-browsers 는 이 프로젝트의 Linux 샌드박스에서만 존재하는 경로다.
 * Windows에는 Playwright 브라우저를 따로 내려받지 않고, 이미 설치돼 있는
 * 시스템 Chrome을 그대로 몰아 쓴다(플레이어 환경과 동일한 렌더러라 오히려
 * 낫다). QC_CHROME_PATH 환경변수가 있으면 무조건 그것을 최우선으로 쓴다 —
 * CI나 특수 설치 경로처럼 아래 후보로 못 잡는 경우의 탈출구.
 */
function chromePath() {
  if (process.env.QC_CHROME_PATH) {
    if (!existsSync(process.env.QC_CHROME_PATH)) {
      throw new Error(`QC_CHROME_PATH 로 지정된 경로가 없음: ${process.env.QC_CHROME_PATH}`)
    }
    return process.env.QC_CHROME_PATH
  }

  if (process.platform === 'win32') return chromePathWindows()

  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(base)) throw new Error(`브라우저 경로 없음: ${base}`)
  const dir = readdirSync(base)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .pop()
  if (!dir) throw new Error(`${base} 에 chromium-* 없음`)
  return join(base, dir, 'chrome-linux', 'chrome')
}

function chromePathWindows() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean)
  const found = candidates.find((p) => existsSync(p))
  if (found) return found
  throw new Error(
    ['Windows 에서 Chrome 실행 파일을 찾지 못함. 다음 경로를 확인했음:', ...candidates.map((p) => `  ${p}`),
      '설치 위치가 다르면 QC_CHROME_PATH 환경변수로 직접 지정할 것 (예: set QC_CHROME_PATH=C:\\...\\chrome.exe)'].join('\n'),
  )
}

// ── 시나리오 ──────────────────────────────────────────────────────────
// 조작: 좌클릭 사격 · 우클릭/Space 베기 · Shift+이동 대시 · R 장전 · E 상호작용 · Tab 설정
const aim = (p, dx) => p.mouse.move(VIEW.width / 2 + dx, VIEW.height / 2)

/**
 * 화면 고정 오프셋이 아니라 실제 월드 좌표(x, z)를 조준한다 — 지면(y=0) 평면
 * 기준으로 카메라 투영한 뒤 캔버스 픽셀 좌표로 마우스를 옮긴다. Game.ts의
 * aimPlane(y=0)·raycaster 조준 경로를 반대로 밟는 것과 같아서, 이 함수로
 * 옮긴 지점을 그대로 클릭하면 실제로 그 좌표를 조준한 것과 동일하게 처리된다
 * (zoomShot()의 project() 패턴 재사용, y 오프셋만 0으로 — aimPlane이 y=0).
 */
async function aimAtPoint(p, x, z) {
  const pt = await p
    .evaluate(({ x, z }) => {
      const g = window.__game
      if (!g?.player?.pos || !g?.camera) return null
      const v = g.player.pos.clone()
      v.set(x, 0, z)
      v.project(g.camera)
      const canvas = document.querySelector('canvas')
      const rect = canvas?.getBoundingClientRect()
      if (!rect) return null
      return {
        sx: rect.left + ((v.x + 1) / 2) * rect.width,
        sy: rect.top + ((-v.y + 1) / 2) * rect.height,
      }
    }, { x, z })
    .catch(() => null)
  if (!pt) return
  await p.mouse.move(pt.sx, pt.sy)
}

const STEPS = [
  {
    name: 'town-idle',
    what: '마을 진입 · 오른쪽 조준 대기 — 카타나가 온전히 그려지는가',
    async run(p) {
      await p.click('#startBtn')
      // 프리플라이트: 이 스텝의 기존 대기(자산 로드/씬 전환 안정화, 벽시계
      // 그대로 유지)를 그대로 관측 창으로 써서 게임 시계 배속(게임초/벽시계초)을
      // 잰다 — 별도 대기를 추가하지 않는다.
      const wallT0 = Date.now()
      const simT0 = await p.evaluate(() => window.__game.simClock)
      await p.waitForTimeout(2200)
      const simT1 = await p.evaluate(() => window.__game.simClock)
      clockRate = (simT1 - simT0) / ((Date.now() - wallT0) / 1000)
      console.log(`· 게임 시계 배속 실측(프리플라이트): ${clockRate.toFixed(2)}배 (게임초/벽시계초)`)
      if (clockRate < 0.5) console.log('  경고: 배속 0.5 미만 — 게임-시계 기준 대기가 느려진 환경임을 시사')
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
    what: '장전 — 탄창 UI 가 7/7 로 복귀하는가 (R 수동 재장전)',
    async run(p) {
      await p.keyboard.press('KeyR')
      await waitGame(p, 1.4) // 장전 시간(인게임) — reloadTime 이 dt로 카운트다운된다
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
    what: '설정창 — 음량 3종 + 화면 효과 + 키 설정 + 획득 특성 목록',
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
    name: 'weapon-variants',
    what: '캐릭터 원화 유지 — 산탄총·대검 장착 뒤에도 기존 27프레임 캐릭터가 유지되는가',
    async run(p) {
      await p.evaluate(() => {
        window.__qcWeaponVariant = window.__game.debugEquipWeapons('shotgun', 'greatsword')
      })
      await aim(p, 400)
      await p.waitForTimeout(350)
    },
    check: async (p) => p.evaluate(() => {
      const g = window.__game
      if (!window.__qcWeaponVariant) return 'QC 무기 교체 훅이 실패함'
      if (g.player.gun.id !== 'shotgun' || g.player.sword.id !== 'greatsword') return '대체 무기가 장착되지 않음'
      return null
    }),
    async after(p) {
      await p.evaluate(() => window.__game.debugEquipWeapons('m1911', 'katana'))
      await p.waitForTimeout(250)
    },
  },
  {
    name: 'gauge-charging',
    what: '조건 게이지(발밑 원호) — 진행 중(옅은 흰색)으로 캐릭터 발밑에 그려지는가. 이 게이지는 아직 소비자(조건부 특성)가 없어 QC 디버그 훅으로 강제 표시한다.',
    async run(p) {
      await aim(p, 400)
      await p.evaluate(() => {
        window.__game.debugSetGauge({ progress: 0.45, color: '#4ade80' })
      })
      await waitGame(p, 0.1) // 한 프레임 이상 처리 — requestGauge가 소비돼 메시가 생성될 시간
    },
    check: async (p) => p.evaluate(() => {
      const g = window.__game
      const mesh = g.effects.gaugeMesh
      if (!mesh) return '진행 중 게이지 메시가 생성되지 않음'
      if (mesh.parent !== g.scene) return '게이지 메시가 씬에 붙어있지 않음'
      return null
    }),
  },
  {
    name: 'gauge-fulfilled',
    what: '조건 게이지 — 충족(progress=1)되면 색이 바뀌고, 요청을 멈추면 다음 프레임에 즉시 사라지는가',
    async run(p) {
      await p.evaluate(() => {
        window.__game.debugSetGauge({ progress: 1, color: '#4ade80' })
      })
      await waitGame(p, 0.1)
    },
    check: async (p) => {
      const fulfilledOk = await p.evaluate(() => {
        const g = window.__game
        return !!g.effects.gaugeMesh
      })
      if (!fulfilledOk) return '충족 상태 게이지 메시가 없음'
      const disappeared = await p.evaluate(async () => {
        window.__game.debugSetGauge(null)
        return true
      })
      if (!disappeared) return '게이지 해제 훅 실패'
      await waitGame(p, 0.1)
      return p.evaluate(() => (window.__game.effects.gaugeMesh ? '요청을 멈췄는데 게이지가 사라지지 않음' : null))
    },
    async after(p) {
      await p.evaluate(() => window.__game.debugSetGauge(null))
    },
  },
  {
    name: 'town-meta',
    what: '마을 영구 성장 — 제단 강화·무기 설계도 해금 UI와 브라우저 프로필 반영',
    async run(p) {
      // 일반 플레이 보상으로 쌓일 영구 재화를 QC에서 결정적으로 준비한다.
      // Game의 런 골드와 분리된 MetaProgression 프로필을 직접 채워, 구매와
      // localStorage 저장 경로가 실제로 동작하는지 검증한다.
      await p.evaluate(() => {
        const profile = window.__game.meta.profile
        profile.crystals = { faint: 99, decent: 99, strong: 99 }
        profile.tokens = 99
      })

      if (!await walkTo(p, 'metaAltar')) throw new Error('힘의 제단에 접근하지 못함')
      await p.keyboard.press('KeyE')
      await p.waitForTimeout(250)
      if (!await p.isVisible('#metaOv')) throw new Error('힘의 제단 창이 열리지 않음')
      await p.locator('#metaItems .meta-upgrade').first().click()
      await p.waitForTimeout(150)
      const upgraded = await p.textContent('#metaItems').catch(() => '')
      if (!upgraded?.includes('Lv.1/5')) throw new Error('제단 강화 단계가 갱신되지 않음')

      await p.keyboard.press('Escape')
      await p.waitForTimeout(180)
      if (!await walkTo(p, 'merchant')) throw new Error('모험가 상점에 접근하지 못함')
      await p.keyboard.press('KeyE')
      await p.waitForTimeout(250)
      if (!await p.isVisible('#metaOv')) throw new Error('모험가 상점 창이 열리지 않음')
      const rare = p.locator('#metaItems .shop-item.rare:not(.sold)').first()
      if (await rare.count() === 0) throw new Error('해금 가능한 희귀 무기가 없음')
      await rare.click()
      await p.waitForTimeout(150)
    },
    check: async (p) => {
      const head = await p.textContent('#metaHead').catch(() => '')
      const unlocked = await p.locator('#metaItems .shop-item.sold').count()
      if (head !== '모험가 상점') return `상점 제목이 예상과 다름 ('${head}')`
      return unlocked > 0 ? null : '무기 설계도가 해금 완료 상태로 갱신되지 않음'
    },
    async after(p) {
      await p.keyboard.press('Escape')
      await p.waitForTimeout(180)
    },
  },
  {
    name: 'dungeon',
    what: '포탈로 던전 입장 — 빈 로비 없이 첫 경로 카드 2~3장이 표시되는가',
    async run(p) {
      await walkTo(p, 'portal')
      for (let i = 0; i < 8; i++) {
        await p.keyboard.press('KeyE')
        await p.waitForTimeout(300)
        // 영구 무기 해금이 생긴 뒤에는 포탈이 출발 장비 선택을 먼저 연다.
        // 기본 장비를 확정해 정상 플레이 경로 그대로 던전에 진입한다.
        if (await p.locator('#loadoutOv.show').count()) {
          await p.locator('#loadoutStart').click()
          await p.waitForTimeout(300)
        }
        if (await routeVisible(p)) break
      }
      const cards = await readRouteCards(p)
      await p.evaluate((value) => { window.__qcInitialRouteCards = value }, cards)
    },
    check: async (p) => {
      if (!await inDungeon(p)) return '던전에 진입하지 못함'
      const cards = await p.evaluate(() => window.__qcInitialRouteCards)
      return validateRouteCards(cards, 2, 3)
    },
  },
  {
    name: 'route-choice',
    needs: 'dungeon',
    what: '경로 카드 이동 — 숫자키 선택·방 클리어 후 재표시·전진 전용 연결·표시 정보가 모두 동작하는가',
    async run(p) {
      const initialCards = await readRouteCards(p)
      // 회복 같은 무전투 카드는 입장과 동시에 cleared라 debugClearEnemies()로
      // onRoomClear()를 다시 만들 수 없다. 경로 재표시까지 검증해야 하는 이
      // 시나리오에서는 적이 있는 카드 중 첫 번째를 결정적으로 고른다.
      const combatIndex = initialCards.findIndex((card) => card.enemyCount > 0)
      if (combatIndex < 0) throw new Error('첫 경로 카드 중 전투가 있는 방이 없음')
      const picked = await chooseRouteCard(p, { index: combatIndex, via: 'key' })
      const entered = await p.evaluate(() => ({
        id: window.__game.run.current?.id ?? window.__game.curPlan?.id ?? null,
        depth: window.__game.run.depth,
      }))
      if (entered.id !== picked.roomId) {
        throw new Error(`숫자키로 고른 방과 실제 진입 방이 다름 (${picked.roomId} → ${entered.id})`)
      }

      // 첫 실제 방을 결정적으로 비워 정상 onRoomClear() 경로를 탄다. 각인/상위
      // 전투/엘리트가 뽑혔다면 보상 카드를 먼저 고른 뒤 경로 카드가 떠야 한다.
      await p.evaluate(() => window.__game.debugClearEnemies())
      await p.waitForFunction(
        () => ['route', 'reward', 'levelup'].includes(window.__game.state),
        null,
        { timeout: 10000 },
      )
      await dismissRewardsUntilRoute(p)
      const nextCards = await readRouteCards(p)
      await p.evaluate((value) => { window.__qcRouteFlow = value }, {
        initialCards,
        picked,
        entered,
        nextCards,
      })
    },
    check: async (p) => {
      const r = await p.evaluate(() => window.__qcRouteFlow)
      if (!r) return '경로 이동 검사 결과가 없음'
      const initialError = validateRouteCards(r.initialCards, 2, 3)
      if (initialError) return `첫 경로 카드: ${initialError}`
      const nextError = validateRouteCards(r.nextCards, 2, 3)
      if (nextError) return `클리어 후 경로 카드: ${nextError}`
      if (r.entered.id !== r.picked.roomId) return '선택한 방으로 진입하지 않음'
      if (r.nextCards.some((card) => card.targetDepth !== r.entered.depth + 1)) {
        return `다음 카드에 되돌아가기/깊이 건너뛰기가 있음 (현재 ${r.entered.depth}, 대상 ${r.nextCards.map((card) => card.targetDepth).join(',')})`
      }
      return null
    },
    async after(p) {
      // 클릭 경로도 실제로 한 번 통과시킨 뒤, 이후 24개 던전 시나리오는
      // 경로 모달 재출현 없이 같은 방을 결정적 전투 샌드박스로 사용한다.
      await chooseRouteCard(p, { index: 0, via: 'click' })
      await p.evaluate(() => window.__game.debugStabilizeRouteSandbox())
    },
  },
  {
    name: 'combat',
    needs: 'dungeon',
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
  {
    name: 'aimed-density',
    needs: 'dungeon',
    what: '조준 밀도 표본 — 실제 적 좌표를 조준해 검 스윙/총알 관통 계측(이슈 6)이 의미 있는 표본을 얻는가',
    async run(p) {
      await dismissLevelUp(p)
      // 이하 실측 사거리/쿨다운은 계측 목적의 트리거일 뿐 게임플레이 수치를
      // 바꾸지 않는다 — 매 시행마다 내부 타이머를 직접 0으로 되돌려 쿨다운
      // 대기를 생략한다(맞는 수 분포는 쿨다운 길이와 무관하다). 총알은 실제
      // 비행 시간만큼은 그대로 기다린다 — 관통 판정은 프레임마다 실제로
      // 이동해야 나온다.
      const MELEE_TRIALS = 55
      const RANGED_TRIALS = 55
      await p.evaluate(() => {
        const g = window.__game
        g.player.pos.set(0, 0, 0)
      })
      for (let i = 0; i < MELEE_TRIALS; i++) {
        await dismissLevelUp(p) // 다른 트리거(상자/제련소 등)로 열린 모달이 남아있으면 게임 시계가 멈춘다
        const target = await p.evaluate(() => {
          const g = window.__game
          g.debugClearEnemies()
          // 스폰된 브루트에게 접촉당해 플레이어가 죽으면(gameover) 게임 시계가
          // 영구히 멈춘다 — 이 스텝의 목적은 명중 밀도 계측이지 생존 검증이
          // 아니므로, 시행마다 접촉 피해를 원천 차단한다.
          g.player.invuln = 5
          const dist = 1.5 + Math.random() * 3.5 // 카타나 range 5.4 안쪽
          const angle = (Math.random() - 0.5) * (Math.PI / 3) // 아크 0.7π 절반(63°) 안쪽 여유
          const bx = g.player.pos.x + Math.sin(angle) * dist
          const bz = g.player.pos.z - Math.cos(angle) * dist
          const count = 1 + Math.floor(Math.random() * 3)
          for (let n = 0; n < count; n++) {
            const e = g.debugSpawnEnemy('brute')
            e.pos.set(bx + (Math.random() - 0.5) * 1.2, 0, bz + (Math.random() - 0.5) * 1.2)
          }
          return { x: bx, z: bz }
        })
        await aimAtPoint(p, target.x, target.z)
        await p.evaluate(() => {
          window.__game.player.swordTimer = 0
        })
        await p.mouse.down({ button: 'right' })
        await waitGame(p, 0.05) // resolveSlash가 처리될 최소 한 프레임
        await p.mouse.up({ button: 'right' })
      }
      await p.evaluate(() => {
        window.__qcAimedDensityGunReady = window.__game.debugEquipWeapons('rifle', 'katana') // pierce 3 — 관통 표본 확보용
      })
      for (let i = 0; i < RANGED_TRIALS; i++) {
        await dismissLevelUp(p)
        const nearest = await p.evaluate(() => {
          const g = window.__game
          g.debugClearEnemies()
          // Projectiles.clear()은 removeBullet()을 거치지 않고 배열을 바로
          // 비운다 — qcDebugHooks의 관통 계측은 removeBullet() 래핑으로만
          // 기록되므로, clear()를 쓰면 직전 시행에서 아직 사거리/수명이 남아
          // 날아가던(이미 명중은 기록된) 총알의 표본이 통째로 사라진다.
          // removeBullet()을 직접 호출해 남은 총알을 정리하며 표본을 보존한다.
          for (let bi = g.projectiles.bullets.length - 1; bi >= 0; bi--) g.projectiles.removeBullet(bi)
          g.player.invuln = 5
          const angle = (Math.random() - 0.5) * 0.15 // 총기 spread 폭 안쪽 — 일직선 관통 유도
          const dirX = Math.sin(angle)
          const dirZ = -Math.cos(angle)
          const count = 1 + Math.floor(Math.random() * 3)
          let nearestPos = null
          let d = 2 + Math.random() * 1.5
          for (let n = 0; n < count; n++) {
            const e = g.debugSpawnEnemy('brute')
            e.pos.set(g.player.pos.x + dirX * d, 0, g.player.pos.z + dirZ * d)
            if (!nearestPos) nearestPos = { x: e.pos.x, z: e.pos.z }
            d += 1.5 + Math.random() * 1
          }
          g.player.ammo = g.player.magSize
          g.player.reloading = false
          g.player.gunTimer = 0
          return nearestPos
        })
        await aimAtPoint(p, nearest.x, nearest.z)
        await p.mouse.down()
        await waitGame(p, 0.35) // 총알이 대열을 관통해 사라질 때까지(관통 소진/사거리 만료)
        await p.mouse.up()
      }
      await p.evaluate(() => {
        const g = window.__game
        for (let bi = g.projectiles.bullets.length - 1; bi >= 0; bi--) g.projectiles.removeBullet(bi)
        g.debugEquipWeapons('m1911', 'katana')
        g.debugClearEnemies()
      })
    },
    check: async (p) => p.evaluate(() => {
      if (!window.__qcAimedDensityGunReady) return 'QC 무기 교체 훅이 실패함(rifle)'
      const log = window.__game.debugGetDensityLog?.()
      if (!log) return '밀도 계측 훅이 없음'
      return null
    }),
  },
  // ── 이하 보스/엘리트 접두사 — 절차 생성 던전에서는 매 실행마다 나온다는
  // 보장이 없어(보스방은 8개 방 완주, 특정 접두사는 확률) 정상 플레이 경로로는
  // 결정적으로 재현할 수 없다. qcDebugHooks.ts(QC_DEBUG=1 빌드에만 포함)로
  // 현재 방에 직접 스폰해 상태머신 타이밍·접두사 효과를 검증한다.
  {
    // 작업 지시 P6 커밋2 — 액티브 스킬(Q/E/R) 전면 폐지. 이전에는 이 자리에
    // 'active-skills'/'iaido' 두 스텝이 있었다(발도 이동/무적/피해 배율,
    // 더블 샷 탄약 소비, 폭렬 난무 충격파 검증). 스킬 자체가 사라졌으므로
    // 검증 대상도 사라졌고, 대신 스킬 없이도 기본 전투(사격/베기/대시/장전)가
    // 정상 동작하는지, 그리고 이제 아무 바인딩도 없는 Q/E 입력이 조용히
    // 무시되는지를 검증한다.
    name: 'combat-no-skills',
    needs: 'dungeon',
    what: '스킬 폐지 이후 기본 전투(사격/베기/대시/장전) — Q/E 입력은 아무 효과 없이 무시되는가',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.player.pos.set(0, 0, 0)
        g.player.ammo = g.player.magSize
        g.player.reloading = false
        g.player.stats.critChance = 0
        // 이전 스텝(전투/조준 밀도)에서 남은 피격 무적/대시 무적이 있으면
        // "바인딩 없는 Q가 무적을 적용함"으로 오판되므로 명시적으로 정리한다.
        g.player.invuln = 0
        g.player.dashInvulnerable = false
        const target = g.debugSpawnEnemy('brute')
        target.pos.set(5, 0, 0)
        target.hp = 9999
        target.maxHp = 9999
        window.__qcNoSkills = {
          x: g.player.pos.x,
          z: g.player.pos.z,
          ammo: g.player.ammo,
          targetId: target.id,
          targetHp: target.hp,
        }
      })
      // Q/E는 이제 아무 바인딩도 없다 — 눌러도 예외 없이 무시되고 플레이어가
      // 움직이거나 무적이 되지 않아야 한다.
      await p.keyboard.press('KeyQ')
      await waitGame(p, 0.1)
      await p.evaluate(() => {
        window.__qcNoSkills.afterQ = { x: window.__game.player.pos.x, z: window.__game.player.pos.z, invulnerable: window.__game.player.invulnerable }
      })
      // 사격 — 탄약 소비
      await aim(p, 400)
      await p.mouse.down()
      await p.waitForTimeout(140)
      await p.mouse.up()
      await waitGame(p, 0.1)
      await p.evaluate(() => {
        window.__qcNoSkills.ammoAfterShoot = window.__game.player.ammo
      })
      // 베기 — 대상에게 피해
      await aimAtPoint(p, 5, 0)
      await p.mouse.down({ button: 'right' })
      await p.waitForTimeout(130)
      await p.mouse.up({ button: 'right' })
      await waitGame(p, 0.2)
      // 대시 — 이동
      await p.keyboard.down('KeyD')
      await p.keyboard.down('ShiftLeft')
      await p.waitForTimeout(130)
      await p.keyboard.up('ShiftLeft')
      await p.keyboard.up('KeyD')
      await waitGame(p, 0.1)
      await p.evaluate(() => {
        window.__qcNoSkills.afterDash = { x: window.__game.player.pos.x, z: window.__game.player.pos.z }
      })
      // 장전 (R) — 수동 재장전 완료 경로 검증
      await p.keyboard.press('KeyR')
      await waitGame(p, 1.4)
    },
    check: async (p) => {
      const r = await p.evaluate(() => {
        const g = window.__game
        const before = window.__qcNoSkills
        const target = g.enemies.find((enemy) => enemy.id === before.targetId)
        return {
          qMoved: Math.hypot(before.afterQ.x - before.x, before.afterQ.z - before.z),
          qInvulnerable: before.afterQ.invulnerable,
          shotAmmo: before.ammo - before.ammoAfterShoot,
          targetHp: target ? target.hp : null,
          dashMoved: Math.hypot(before.afterDash.x - before.x, before.afterDash.z - before.z),
          ammo: g.player.ammo,
          magSize: g.player.magSize,
        }
      })
      if (r.qMoved > 0.05) return `바인딩 없는 Q가 플레이어를 이동시킴 (${r.qMoved.toFixed(2)})`
      if (r.qInvulnerable) return '바인딩 없는 Q가 무적을 적용함'
      if (r.shotAmmo < 1) return `사격이 탄약을 소비하지 않음 (${r.shotAmmo})`
      if (r.targetHp === null) return '베기 대상이 사라짐'
      if (r.targetHp >= 9999) return '베기가 피해를 주지 않음'
      if (r.dashMoved < 1) return `대시 이동거리가 짧음 (${r.dashMoved.toFixed(2)})`
      if (r.ammo !== r.magSize) return `장전 후 탄약이 가득 차지 않음 (${r.ammo}/${r.magSize})`
      const buttons = await p.evaluate(() => !document.querySelector('.hud-skills'))
      return buttons ? null : '폐지된 스킬 HUD가 여전히 존재함'
    },
  },
  {
    name: 'trait-slots',
    needs: 'dungeon',
    what: '핵심 슬롯 특성(작업 지시 P8 커밋1 3축 재편 반영) — 발도참/조준사격/마지막 한발/표식/급전환 실제 발동과 슬롯 교체 UI',
    async run(p) {
      await dismissLevelUp(p)
      const r = await p.evaluate(async () => {
        const g = window.__game
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const out = {}
        g.state = 'play'
        g.settingsOpen = false
        g.player.alive = true
        g.player.hp = g.player.stats.maxHp

        // ── 발도참(sword) — 0.5초 이상 정지 후 첫 베기 250% ──
        g.debugClearEnemies()
        g.player.pos.set(0, 0, 0)
        g.player.invuln = 5
        // 기본 10% 치명타 확률이 배율 검증(마지막 한발 등)을 이따금 흔들지 않도록 끈다
        g.player.mods.critChance = -0.1
        g.player.recompute()
        g.debugSetCoreSlot('sword', 'iaijutsu')
        const iaiTarget = g.debugSpawnEnemy('brute')
        iaiTarget.pos.set(0, 0, -3)
        iaiTarget.speed = 0
        iaiTarget.damage = 0
        const simT0 = g.simClock
        while (g.simClock - simT0 < 0.6) await wait(30) // 정지 상태로 0.5초 이상 대기
        const hpBefore = iaiTarget.hp
        g.resolveSlash(g.player.pos.clone(), 0, g.player.stats.swordArc, g.player.stats.swordRange, g.player.stats.swordDamage, false, g.player.stats.knockback)
        // 위 직접 호출은 발도참 배율을 안 타므로(Player.update 안의 판정), 실제 입력 경로를 대신 관찰한다
        out.note = 'resolveSlash 직접 호출은 참고용 — 실제 배율 검증은 아래 conditionGauge로 대체'
        out.iaijutsuGaugeReady = g.player.conditionGauge()?.progress >= 1

        // ── 조준사격(gun) — 0.35초 이상 쉬고 쏘면 확정 치명타 ──
        g.debugSetCoreSlot('gun', 'aimed_shot')
        g.player.ammo = g.player.magSize
        g.player.reloading = false
        g.player.gunTimer = 0
        const simT1 = g.simClock
        while (g.simClock - simT1 < 0.5) await wait(30)
        out.aimedShotGaugeReady = g.player.conditionGauge()?.progress >= 1

        return out
      })

      // 실제 발사/베기는 마우스 이벤트로 트리거해야 Player.update()의 판정 분기(조건부 배율)를 탄다.
      await aim(p, 0)
      const preSlash = await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        const e = g.debugSpawnEnemy('brute')
        e.pos.set(0, 0, -3)
        e.speed = 0
        e.damage = 0
        window.__qcTraitSlots = { hpBefore: e.hp, id: e.id, expected: g.player.stats.swordDamage * 2.5 }
        return true
      })
      if (preSlash) {
        await p.mouse.down({ button: 'right' })
        await waitGame(p, 0.05)
        await p.mouse.up({ button: 'right' })
      }
      const iaijutsuDealt = await p.evaluate(() => {
        const g = window.__game
        const e = g.enemies.find((it) => it.id === window.__qcTraitSlots.id)
        return e ? window.__qcTraitSlots.hpBefore - e.hp : null
      })

      // ── 조준사격 확정 치명타 ──
      const preShot = await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.projectiles.clear()
        g.player.ammo = g.player.magSize
        g.player.reloading = false
        g.player.gunTimer = 0
        // 직전 발도참 테스트의 검 적중이 '발도장전'(기본 메커니즘, swordReloadBurstBonus
        // 기본 0.3)을 발동시켜 다음 총알 3발에 +30% 보너스가 남아있다 — 이 테스트와
        // 무관한 배율이라 격리한다.
        g.player.swordReloadBurstShotsLeft = 0
        return true
      })
      if (preShot) {
        await p.mouse.down()
        await waitGame(p, 0.03)
        await p.mouse.up()
      }
      const aimedShotCrit = await p.evaluate(() => window.__game.projectiles.bullets[0]?.crit ?? null)

      // ── 마지막 한발(gun, 구 최후탄) — 탄창 마지막 1발 220%, 핍 색 변경 ──
      // 실제로 명중시키려면 정밀 조준(aimAtPoint)이 필요해 조준 오차가 결과에
      // 섞인다 — 배율 자체는 발사 시점에 이미 bullets[].damage에 반영되므로
      // 총알이 맞았는지와 무관하게 스폰된 총알의 damage 필드로 직접 검증한다.
      const lastBulletSetup = await p.evaluate(() => {
        const g = window.__game
        g.debugSetCoreSlot('gun', 'last_bullet')
        g.debugClearEnemies()
        g.projectiles.clear()
        g.player.ammo = 1
        g.player.reloading = false
        g.player.gunTimer = 0
        g.player.swordReloadBurstShotsLeft = 0 // 이 테스트와 무관한 발도장전 보너스 격리
        // HUD는 다음 프레임에야 갱신된다 — 발사 전(ammo=1) 핍 색은 여기서
        // 강제로 한 번 갱신해 직접 확인한다(발사 이후엔 ammo가 0으로 바뀌어
        // "마지막 총알" 핍 자체가 사라지므로 발사 전에 봐야 한다).
        g.hud.setAmmo(g.player.ammo, g.player.magSize, g.player.reloading, g.player.reloadRatio, g.player.gun.name, true)
        return {
          expected: g.player.stats.gunDamage * 2.2,
          pipClass: document.querySelector('#ammoPips i')?.className ?? null,
        }
      })
      await p.mouse.down()
      await waitGame(p, 0.03) // 총알 스폰까지 — 명중은 필요 없다
      await p.mouse.up()
      const lastBulletResult = await p.evaluate((setup) => {
        const g = window.__game
        const b = g.projectiles.bullets[0]
        return { dealt: b ? b.damage : null, expected: setup.expected, pipClass: setup.pipClass }
      }, lastBulletSetup)

      // ── 마지막 한발 넉백 충격파 — 명중 지점 근처의 다른 적(직격 대상 아님)도 밀려나는가 ──
      // 실제 조준-발사-비행 경로는 이 샌드박스의 큰 프레임 dt에서 작은 반경(imp)의
      // 적을 관통(터널링)하기 쉬워 명중 자체가 불안정하다(aimed-density 스텝이
      // 명중 수를 검증하지 않고 계측 훅 존재만 보는 것과 같은 이유) — 조준/비행에
      // 기대지 않고, 총알을 적 위치에 직접 스폰(속도 0, shockwave=true)해 다음
      // resolveBullets() 틱에서 반드시 겹치게 만든다. 이건 Game.resolveBullets()의
      // 충격파 처리 로직 자체를 검증하는 것이지 조준 판정을 검증하는 게 아니다.
      const shockwaveResult = await p.evaluate(async () => {
        const g = window.__game
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        g.debugClearEnemies()
        g.projectiles.clear()
        const direct = g.debugSpawnEnemy('imp')
        direct.pos.set(0, 0, -4)
        direct.speed = 0
        direct.damage = 0
        const nearby = g.debugSpawnEnemy('imp')
        nearby.pos.set(1.5, 0, -4) // 직격 대상 바로 옆 — 충격파 반경(3.5) 안
        nearby.speed = 0
        nearby.damage = 0
        const nearbyPos = { x: nearby.pos.x, z: nearby.pos.z }
        g.projectiles.spawnBullet(direct.pos.clone(), direct.pos.clone().set(0, 0, -1), 0, 1, false, 0, true)
        const simT0 = g.simClock
        let triggered = false
        // 프레임마다 knockTimer/velocity를 함께 표본화한다. 감쇠가 끝난 뒤의
        // 최종 변위 하나만 보면 rAF 분할에 따라 수치가 흔들리므로, 실제
        // 넉백 상태 진입과 눈에 띄는 이동을 각각 확인한다.
        while (g.simClock - simT0 < 0.3) {
          if (nearby.knockTimer > 0 || nearby.vel.lengthSq() > 0.01) triggered = true
          await wait(16)
        }
        const moved = Math.hypot(nearby.pos.x - nearbyPos.x, nearby.pos.z - nearbyPos.z)
        return { moved, triggered }
      })

      // ── 표식(character) — 대시로 관통한 적은 3초간 받는 피해 +35% ──
      const markResult = await p.evaluate(async () => {
        const g = window.__game
        g.state = 'play'
        g.settingsOpen = false
        g.hitstopTimer = 0
        g.player.alive = true
        g.player.hp = g.player.stats.maxHp
        g.player.invuln = 999
        g.debugSetCoreSlot('character', 'mark')
        g.player.dashCdTimer = 0
        g.debugClearEnemies()
        g.player.pos.set(0, 0, 0)
        // KeyS(moveDown) 입력은 +Z 방향 — 대시 경로(0,0,0)→(0,0,+x) 위에 적을 놓는다.
        const e = g.debugSpawnEnemy('brute')
        e.pos.set(0, 0, 1.5)
        e.speed = 0
        e.damage = 0
        return { spawnedId: e.id }
      })
      await p.keyboard.down('KeyS')
      await p.keyboard.down('ShiftLeft')
      await waitGame(p, 0.35) // 대시 지속시간 + 종료 처리
      await p.keyboard.up('ShiftLeft')
      await p.keyboard.up('KeyS')
      const marked = await p.evaluate((id) => {
        const g = window.__game
        const e = g.enemies.find((it) => it.id === id)
        return e ? e.isMarked : null
      }, markResult.spawnedId)

      // ── 급전환(character) — 대시 종료 직후 검 쿨 절반 + 총 즉시 장전 ──
      const quickSwitch = await p.evaluate(async () => {
        const g = window.__game
        g.state = 'play'
        g.settingsOpen = false
        g.hitstopTimer = 0
        g.player.alive = true
        g.player.hp = g.player.stats.maxHp
        g.player.invuln = 999
        g.debugSetCoreSlot('character', 'quick_switch')
        g.player.dashCdTimer = 0 // 직전 표식 테스트의 대시 쿨다운을 건너뛴다
        g.player.ammo = 0
        g.player.reloading = true
        return true
      })
      await p.keyboard.down('KeyD')
      await p.keyboard.down('ShiftLeft')
      await waitGame(p, 0.35)
      await p.keyboard.up('ShiftLeft')
      await p.keyboard.up('KeyD')
      const quickSwitchResult = await p.evaluate(() => ({
        ammo: window.__game.player.ammo,
        reloading: window.__game.player.reloading,
      }))

      // ── 슬롯 교체 UI — 이미 찬 슬롯에 다른 특성을 고르면 "유지/교체" 카드가 나란히 뜨는가 ──
      const swapUi = await p.evaluate(() => {
        const g = window.__game
        const current = { id: 'close_range', name: '밀착사격', desc: '', icon: '🔫', slot: 'gun' }
        const incoming = { id: 'last_bullet', name: '마지막 한발', desc: '', icon: '🎯', slot: 'gun' }
        g.hud.showSlotSwap(current, incoming, () => {})
        const cards = document.querySelectorAll('#cards .card')
        const tags = [...document.querySelectorAll('#cards .ctag')].map((el) => el.textContent)
        const open = document.querySelector('#levelOv')?.classList.contains('show')
        return { hasHook: typeof g.offerTrait === 'function', cardCount: cards.length, tags, open }
      })
      await p.evaluate(() => document.querySelector('#levelOv')?.classList.remove('show'))

      await p.evaluate((result) => {
        window.__qcTraitSlotsResult = result
      }, {
        iaijutsuGaugeReady: r.iaijutsuGaugeReady,
        aimedShotGaugeReady: r.aimedShotGaugeReady,
        iaijutsuDealt,
        aimedShotCrit,
        lastBulletResult,
        shockwaveResult,
        marked,
        quickSwitchResult,
        swapUi,
      })
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcTraitSlotsResult
      if (!r) return '결과 없음'
      if (!r.iaijutsuGaugeReady) return '발도참 게이지가 0.5초 정지 후 충족되지 않음'
      const iaiExpected = window.__game.player.stats.swordDamage * 2.5
      if (r.iaijutsuDealt == null || Math.abs(r.iaijutsuDealt - iaiExpected) > iaiExpected * 0.05) {
        return `발도참 피해 배율이 250%가 아님 (${r.iaijutsuDealt} / 기대 ${iaiExpected.toFixed(1)})`
      }
      if (!r.aimedShotGaugeReady) return '조준사격 게이지가 0.35초 정지 후 충족되지 않음'
      if (r.aimedShotCrit !== true) return '조준사격 조건 충족 후 첫 발이 확정 치명타가 아님'
      const lastExpected = r.lastBulletResult.expected
      if (r.lastBulletResult.dealt == null || Math.abs(r.lastBulletResult.dealt - lastExpected) > lastExpected * 0.01) {
        return `마지막 한발 피해 배율이 220%가 아님 (${r.lastBulletResult.dealt} / 기대 ${lastExpected.toFixed(1)})`
      }
      if (!r.lastBulletResult.pipClass || !r.lastBulletResult.pipClass.includes('last-bullet')) {
        return '마지막 한발 상태에서 탄약 UI 마지막 핍에 강조 클래스가 없음'
      }
      if (!r.shockwaveResult?.triggered || r.shockwaveResult.moved < 0.05) {
        return `마지막 한발 명중 시 인근 적이 넉백 충격파로 밀려나지 않음 (변위 ${r.shockwaveResult?.moved})`
      }
      if (r.marked !== true) return "표식 — 대시로 관통한 적이 마크되지 않음"
      if (r.quickSwitchResult.ammo !== window.__game.player.magSize || r.quickSwitchResult.reloading !== false) {
        return `급전환 — 대시 종료 직후 총이 즉시 장전되지 않음 (ammo=${r.quickSwitchResult.ammo}, reloading=${r.quickSwitchResult.reloading})`
      }
      if (!r.swapUi.hasHook) return '슬롯 교체 UI 훅(offerTrait)이 노출되지 않음'
      if (!r.swapUi.open || r.swapUi.cardCount !== 2) return `슬롯 교체 카드가 2장(유지/교체) 나란히 뜨지 않음 (open=${r.swapUi.open}, count=${r.swapUi.cardCount})`
      if (!r.swapUi.tags.includes('유지') || !r.swapUi.tags.includes('교체')) return `슬롯 교체 카드에 유지/교체 표시가 없음 (${JSON.stringify(r.swapUi.tags)})`
      return null
    }),
    async after(p) {
      await p.evaluate(() => {
        const g = window.__game
        g.debugSetGauge(null)
        g.debugClearEnemies()
        g.player.coreSlots.clear()
        g.debugEquipWeapons('m1911', 'katana')
      })
    },
  },
  {
    name: 'midcost-slash',
    needs: 'dungeon',
    what: '일섬/이도류(작업 지시 slot_traits_midcost_v2 커밋1) — 단일 명중 배수, 2연타 각 60%+지연+온힛 2회',
    async run(p) {
      await dismissLevelUp(p)
      await aim(p, 0)
      const setup = await p.evaluate(() => {
        const g = window.__game
        g.debugEquipWeapons('m1911', 'katana')
        g.player.pos.set(0, 0, 0)
        g.player.invuln = 5
        // 기본 치명타 확률(10%)이 무작위로 섞이면 배율 검증이 이따금(1/10) 실패한다
        // (치명타 배율 2.0×까지 겹쳐 "60%가 아님" 식 오탐이 남). 결정적 측정을 위해 끈다.
        g.player.mods.critChance = -0.1
        g.player.recompute()
        return { swordDamage: g.player.stats.swordDamage }
      })

      // ── 일섬 — 정확히 1명 명중 시 200% ──
      await p.evaluate(() => {
        const g = window.__game
        g.debugSetCoreSlot('sword', 'ilseom')
        g.debugClearEnemies()
        g.player.swordTimer = 0
        const e = g.debugSpawnEnemy('brute')
        e.pos.set(0, 0, -3)
        window.__qcMidSlash = { hpBefore: e.hp, id: e.id }
      })
      await aimAtPoint(p, 0, -3)
      await p.mouse.down({ button: 'right' })
      await waitGame(p, 0.05)
      await p.mouse.up({ button: 'right' })
      const ilseomSolo = await p.evaluate(() => {
        const g = window.__game
        const e = g.enemies.find((it) => it.id === window.__qcMidSlash.id)
        return e ? window.__qcMidSlash.hpBefore - e.hp : null
      })

      // ── 일섬 — 2명 이상 명중 시 배수 없음(1.0배) ──
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.player.swordTimer = 0
        const e1 = g.debugSpawnEnemy('brute')
        e1.pos.set(-0.5, 0, -3)
        const e2 = g.debugSpawnEnemy('brute')
        e2.pos.set(0.5, 0, -3)
        window.__qcMidSlash = { hpBefore1: e1.hp, id1: e1.id, hpBefore2: e2.hp, id2: e2.id }
      })
      await aimAtPoint(p, 0, -3)
      await p.mouse.down({ button: 'right' })
      await waitGame(p, 0.05)
      await p.mouse.up({ button: 'right' })
      const ilseomDuo = await p.evaluate(() => {
        const g = window.__game
        const e1 = g.enemies.find((it) => it.id === window.__qcMidSlash.id1)
        const e2 = g.enemies.find((it) => it.id === window.__qcMidSlash.id2)
        return {
          dealt1: e1 ? window.__qcMidSlash.hpBefore1 - e1.hp : null,
          dealt2: e2 ? window.__qcMidSlash.hpBefore2 - e2.hp : null,
        }
      })

      // ── 이도류 — 2연타 각 60%, 두 번째는 0.12초 뒤, 온힛(장전) 2회 ──
      await p.evaluate(() => {
        const g = window.__game
        g.debugSetCoreSlot('sword', 'dualblade')
        g.debugClearEnemies()
        g.player.swordTimer = 0
        g.player.ammo = 0
        g.player.reloading = false
        const e = g.debugSpawnEnemy('brute')
        e.pos.set(0, 0, -3)
        window.__qcMidSlash = { hpBefore: e.hp, id: e.id }
      })
      await aimAtPoint(p, 0, -3)
      await p.mouse.down({ button: 'right' })
      // dt가 프레임당 최대 0.05초까지 뭉치는 이 샌드박스에서는 이도류의 0.12초
      // 지연이 단 2~3프레임 만에 끝나버려, waitGame()의 벽시계 왕복 지연만으로도
      // 두 번째 타격까지 끝나버릴 수 있다(실측: 외부 폴링 경유 시 100% 재현).
      // 그래서 벽시계 폴링 대신 페이지 내부 rAF로 직접 대기열(pendingSlashes)이
      // 채워진 첫 프레임(=첫 타만 적용되고 두 번째는 아직 큐에 대기 중인 시점)을
      // 잡는다 — Game.step()이 같은 프레임 안에서 push와 처리(dt<0.12라 미소진)를
      // 순서대로 하므로, 이 프레임에서 관측하면 정확히 "1타만 적용됨"이 보장된다.
      const dualbladeFirst = await p.evaluate(() => {
        const g = window.__game
        return new Promise((resolve) => {
          let framesLeft = 180 // 안전장치 — 못 잡아도 무한 대기하지 않음
          const tick = () => {
            if (g.pendingSlashes.length > 0 || framesLeft-- <= 0) {
              const e = g.enemies.find((it) => it.id === window.__qcMidSlash.id)
              resolve({ dealt: e ? window.__qcMidSlash.hpBefore - e.hp : null, ammoAfterFirst: g.player.ammo })
              return
            }
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
      })
      await p.mouse.up({ button: 'right' })
      await waitGame(p, 0.25) // 0.12초 지연 + 처리 여유
      const dualbladeSecond = await p.evaluate(() => {
        const g = window.__game
        const e = g.enemies.find((it) => it.id === window.__qcMidSlash.id)
        return { dealtTotal: e ? window.__qcMidSlash.hpBefore - e.hp : null, ammoAfterSecond: g.player.ammo }
      })

      await p.evaluate((result) => {
        window.__qcMidSlashResult = result
      }, { swordDamage: setup.swordDamage, ilseomSolo, ilseomDuo, dualbladeFirst, dualbladeSecond })
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcMidSlashResult
      if (!r) return '결과 없음'
      const ilseomExpected = r.swordDamage * 2.0
      if (r.ilseomSolo == null || Math.abs(r.ilseomSolo - ilseomExpected) > ilseomExpected * 0.05) {
        return `일섬 단일 명중 배수가 200%가 아님 (${r.ilseomSolo} / 기대 ${ilseomExpected.toFixed(1)})`
      }
      if (r.ilseomDuo.dealt1 == null || r.ilseomDuo.dealt2 == null) return '일섬 2명 명중 테스트에서 적을 찾지 못함'
      if (Math.abs(r.ilseomDuo.dealt1 - r.swordDamage) > r.swordDamage * 0.05 || Math.abs(r.ilseomDuo.dealt2 - r.swordDamage) > r.swordDamage * 0.05) {
        return `일섬 2명 이상 명중 시에도 배수가 적용됨 (${r.ilseomDuo.dealt1}, ${r.ilseomDuo.dealt2} / 기대 각 ${r.swordDamage.toFixed(1)})`
      }
      const dualExpected = r.swordDamage * 0.6
      if (r.dualbladeFirst.dealt == null || Math.abs(r.dualbladeFirst.dealt - dualExpected) > dualExpected * 0.05) {
        return `이도류 첫 타격이 60%가 아님 (${r.dualbladeFirst.dealt} / 기대 ${dualExpected.toFixed(1)})`
      }
      if (r.dualbladeFirst.ammoAfterFirst !== 1) return `이도류 첫 타격 온힛(장전)이 발동하지 않음 (ammo=${r.dualbladeFirst.ammoAfterFirst})`
      const dualTotalExpected = r.swordDamage * 1.2
      if (r.dualbladeSecond.dealtTotal == null || Math.abs(r.dualbladeSecond.dealtTotal - dualTotalExpected) > dualTotalExpected * 0.05) {
        return `이도류 2타 합산이 120%가 아님 (${r.dualbladeSecond.dealtTotal} / 기대 ${dualTotalExpected.toFixed(1)})`
      }
      if (r.dualbladeSecond.ammoAfterSecond !== 2) return `이도류 두 번째 타격 온힛(장전)이 발동하지 않음 (ammo=${r.dualbladeSecond.ammoAfterSecond})`
      return null
    }),
    async after(p) {
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.player.coreSlots.clear()
      })
    },
  },
  {
    name: 'midcost-parry',
    needs: 'dungeon',
    what: '흘리기(작업 지시 slot_traits_midcost_v2 커밋2) — 부채꼴 안 적 탄환 반사(검 피해 60%, 역방향), 성공 시에만 피드백',
    async run(p) {
      await dismissLevelUp(p)
      await aim(p, 0)
      const setup = await p.evaluate(() => {
        const g = window.__game
        g.debugEquipWeapons('m1911', 'katana')
        g.player.pos.set(0, 0, 0)
        g.player.invuln = 5
        g.player.swordTimer = 0
        g.player.mods.critChance = -0.1 // 기본 10% 치명타 확률이 배율 검증을 흔들지 않도록
        g.player.recompute()
        g.debugSetCoreSlot('sword', 'parry')
        g.debugClearEnemies()
        g.projectiles.clear()
        // 부채꼴 판정 범위(katana range) 안, 플레이어 쪽(+Z)으로 날아오는 적 탄환을 직접 스폰
        const pos = g.player.pos.clone()
        pos.set(0, 1, -3)
        const dir = g.player.pos.clone()
        dir.set(0, 0, 1)
        g.projectiles.spawnEnemyBullet(pos, dir, 6, 5)
        return { swordDamage: g.player.stats.swordDamage }
      })
      await aimAtPoint(p, 0, -3)
      await p.mouse.down({ button: 'right' })
      await waitGame(p, 0.05)
      await p.mouse.up({ button: 'right' })
      const result = await p.evaluate((s) => {
        const g = window.__game
        const reflected = g.projectiles.bullets[0]
        return {
          enemyBulletsLeft: g.projectiles.enemyBullets.length,
          reflectedDamage: reflected ? reflected.damage : null,
          reflectedDirZ: reflected ? reflected.dir.z : null,
          swordDamage: s.swordDamage,
        }
      }, setup)
      await p.evaluate((r) => {
        window.__qcParryResult = r
      }, result)
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcParryResult
      if (!r) return '결과 없음'
      if (r.enemyBulletsLeft !== 0) return `흘리기 후에도 적 탄환이 남아있음 (${r.enemyBulletsLeft}개)`
      const expected = r.swordDamage * 0.6
      if (r.reflectedDamage == null || Math.abs(r.reflectedDamage - expected) > expected * 0.05) {
        return `반사탄 피해가 검 피해의 60%가 아님 (${r.reflectedDamage} / 기대 ${expected.toFixed(1)})`
      }
      if (r.reflectedDirZ == null || r.reflectedDirZ >= 0) return `반사탄 방향이 원래 진행 방향의 반대가 아님 (dirZ=${r.reflectedDirZ})`
      return null
    }),
    async after(p) {
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.projectiles.clear()
        g.player.coreSlots.clear()
      })
    },
  },
  {
    name: 'midcost-shot-dash',
    needs: 'dungeon',
    what: '도탄/잔영(작업 지시 slot_traits_midcost_v2 커밋3) — 관통 소진 후 튕김(관통과 비배타), 대시 무적 피격 시 쿨 초기화(1회 한정, 피격후무적 제외)',
    async run(p) {
      await dismissLevelUp(p)
      await aim(p, 0)
      await p.evaluate(() => {
        const g = window.__game
        g.player.pos.set(0, 0, 0)
        g.player.invuln = 5
      })

      // ── 도탄 — 관통 소진 시점(4번째 명중)에 튕기는지, 관통과 배타가 아닌지 ──
      // 실사격(발사 → 물리 이동 → 자연 충돌)에 기대는 대신, 이미 3명(더미 id)을
      // 맞힌 상태의 총알을 직접 구성해 다음 프레임에 "4번째 명중"만 결정적으로
      // 재현한다. 실사격 버전은 저격소총 bulletSpeed(62)와 프레임당 dt 상한
      // (0.05, 즉 프레임당 최대 3.1유닛 이동)이 겹쳐 판정 반경(1.3)보다 촘촘한
      // 대형을 종종 건너뛰어(터널링) 실패가 배치/타이밍에 따라 들쭉날쭉했다 —
      // 게임 로직이 아니라 물리 기반 테스트 자체의 불안정성이라 판단해 방식을
      // 바꿨다. target=4번째 명중 대상(관통 소진 트리거), off=반경 8 안의
      // 아직 안 맞은 적(도탄 목적지) — 관통 소진을 일으킨 그 히트 자체도 target
      // 에게 피해를 입히므로 "관통과 배타가 아님"이 같은 판정 안에서 검증된다.
      const ricochetSetup = await p.evaluate(() => {
        const g = window.__game
        g.debugEquipWeapons('rifle', 'katana') // 관통 3
        g.debugSetCoreSlot('gun', 'ricochet')
        g.debugClearEnemies()
        g.projectiles.clear()
        const target = g.debugSpawnEnemy('brute')
        target.pos.set(0, 0, -3)
        const off = g.debugSpawnEnemy('brute')
        off.pos.set(2.5, 0, -3) // target에서 반경 8 안 — 튕겨야만 맞는 위치
        const pos = g.player.pos.clone()
        pos.set(0, 0, -2.9) // target 바로 앞 — 다음 프레임 이동으로 반드시 명중 반경 진입
        const dir = g.player.pos.clone()
        dir.set(0, 0, -1)
        g.projectiles.spawnBullet(pos, dir, 20, 30, false, g.player.stats.pierce)
        const b = g.projectiles.bullets[g.projectiles.bullets.length - 1]
        b.hitSet.add(-1)
        b.hitSet.add(-2)
        b.hitSet.add(-3) // 이미 3명 맞은 것으로 간주(존재하지 않는 더미 id) — pierce(3) 소진 직전 상태
        return { targetId: target.id, targetHpBefore: target.hp, offId: off.id, offHpBefore: off.hp }
      })
      await waitGame(p, 0.4) // 4번째 명중(관통 소진) + 튕겨서 off까지 도달할 시간
      const ricochetResult = await p.evaluate((setup) => {
        const g = window.__game
        const target = g.enemies.find((e) => e.id === setup.targetId)
        const off = g.enemies.find((e) => e.id === setup.offId)
        return {
          targetHit: target ? target.hp < setup.targetHpBefore : true, // 사망(배열에서 사라짐)도 명중으로 친다
          offDealt: off ? setup.offHpBefore - off.hp : null,
        }
      }, ricochetSetup)

      // 다른 트리거(상자/제련소 등)로 'levelup' 모달이 남아있으면 state !== 'play'가
      // 되어 simClock이 멈춘다(바로 다음 잔영 서브테스트의 waitGame이 "게임 시계
      // 정지"로 실패하던 원인) — 대시 서브테스트를 시작하기 전에 반드시 닫는다.
      await dismissLevelUp(p)

      // ── 잔영 — 대시 무적 피격 시 쿨 초기화(1회), 피격 후 무적 중에는 초기화 안 됨 ──
      // dashDuration(0.16s) 내내 dashInvulnerable이 true다(dashIFrames 0.22 >
      // dashDuration 0.16이라 실질적으로 대시 전체가 무적 구간 — Player.ts 확인됨).
      // 적 AI/접촉 판정 타이밍에 기대지 않고 player.takeDamage()를 직접 호출해
      // 결정적으로 검증한다(적 접촉에 맡기면 이 느린 샌드박스에서 타이밍이 밀려
      // 무방비 상태로 실제 피해를 입고 gameover로 게임 시계가 멈추는 사고가 났다).
      await p.evaluate(() => {
        const g = window.__game
        g.debugEquipWeapons('m1911', 'katana')
        g.debugSetCoreSlot('character', 'afterimage')
        g.debugClearEnemies()
        g.projectiles.clear()
        g.player.pos.set(0, 0, 0)
        g.player.hp = g.player.stats.maxHp
        g.player.invuln = 0
        g.player.dashCdTimer = 0 // 대시가 즉시 발동하려면 쿨 없이 시작해야 한다
      })
      // dashDuration(0.16s)이 이 샌드박스의 프레임 dt 상한(0.05s)·왕복 지연과
      // 같은 자릿수라, waitGame()/실제 대기로 "같은 대시 안"을 노리면 실측상
      // 대시가 자연히 끝나고 Shift+D가 계속 눌려있어 새 대시가 자동 재시작되며
      // (쿨 가득 참) "1회 한정 위반"처럼 보이는 오탐이 났다(실측 확인됨). 매
      // 판정 직전 dashTimer를 안전한 값으로 다시 세팅해 "여전히 이 대시 안"을
      // 보장하고, 페이지 내부 rAF로 이 프레임의 피격 이벤트가 실제로
      // 처리(consumeDamageEvent가 'none'으로 리셋)될 때까지만 기다린다 — 벽시계
      // 왕복 지연에 좌우되지 않는다.
      async function afterDamageEventProcessed(p) {
        await p.evaluate(() => new Promise((resolve) => {
          const g = window.__game
          let framesLeft = 60
          const tick = () => {
            if (g.player.lastDamageEvent === 'none' || framesLeft-- <= 0) { resolve(); return }
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }))
      }

      await p.keyboard.down('KeyD')
      await p.keyboard.down('ShiftLeft')
      await p.evaluate(() => new Promise((resolve) => {
        const g = window.__game
        let framesLeft = 60
        const tick = () => {
          if (g.player.isDashing || framesLeft-- <= 0) { resolve(); return }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })) // 대시가 실제로 시작될 때까지(무적 구간 진입)
      const duringDashCd = await p.evaluate(() => {
        const g = window.__game
        g.player.dashTimer = Math.max(g.player.dashTimer, 0.1) // 판정 시점까지 "이 대시 안"을 보장
        const dashInvulnerable = g.player.dashInvulnerable
        const hpBefore = g.player.hp
        const blocked = !g.player.takeDamage(10)
        return { dashInvulnerable, blocked, hpUnchanged: g.player.hp === hpBefore }
      })
      await afterDamageEventProcessed(p)
      const cdAfterDashBlock = await p.evaluate(() => window.__game.player.dashCdTimer)

      // 같은 대시 안에서 두 번째 피격 — 1회 한정이라 추가로 초기화되면 안 됨(쿨을 다시 세팅해 판별).
      const secondHitSameDash = await p.evaluate(() => {
        const g = window.__game
        g.player.dashTimer = Math.max(g.player.dashTimer, 0.1) // 여전히 "같은 대시" 보장
        g.player.dashCdTimer = 3
        const dashInvulnerable = g.player.dashInvulnerable
        g.player.takeDamage(10)
        return dashInvulnerable
      })
      await afterDamageEventProcessed(p)
      await p.keyboard.up('ShiftLeft')
      await p.keyboard.up('KeyD')
      const cdAfterSecondHitSameDash = await p.evaluate(() => window.__game.player.dashCdTimer)

      // 피격 후 무적(invulnAfterHit) 중에는 초기화되지 않아야 한다 — 대시가 완전히
      // 끝난(dashInvulnerable=false) 뒤여야 순수하게 invuln>0만으로 판정된다.
      await p.evaluate(() => {
        const g = window.__game
        g.player.dashTimer = 0 // 대시를 확실히 끝낸다(dashInvulnerable=false)
        g.player.invuln = 0.5 // 피격 후 무적 상태를 직접 재현
        g.player.dashCdTimer = 3
        g.player.takeDamage(10)
      })
      const cdAfterPostHitInvuln = await p.evaluate(() => window.__game.player.dashCdTimer)

      await p.evaluate((result) => {
        window.__qcShotDashResult = result
      }, {
        ricochet: ricochetResult,
        duringDashCd,
        cdAfterDashBlock,
        secondHitSameDash,
        cdAfterSecondHitSameDash,
        cdAfterPostHitInvuln,
      })
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcShotDashResult
      if (!r) return '결과 없음'
      if (!r.ricochet.targetHit) return '도탄 — 관통 소진을 일으킨 4번째 명중 자체가 대상에 적용되지 않음(관통과 배타 의심)'
      if (r.ricochet.offDealt == null || r.ricochet.offDealt <= 0) return '도탄 — 관통 소진 후 반경 안의 다른 적으로 튕기지 않음'
      if (!r.duringDashCd.dashInvulnerable) return '잔영 테스트 전제 실패 — 대시 무적 구간이 아닌 시점에 피해를 시도함'
      if (!r.duringDashCd.blocked || !r.duringDashCd.hpUnchanged) return '잔영 테스트 전제 실패 — 대시 무적인데 피해가 들어감'
      if (r.cdAfterDashBlock > 0.05) return `잔영 — 대시 무적으로 흘렸는데 대시 쿨이 초기화되지 않음 (${r.cdAfterDashBlock})`
      if (r.secondHitSameDash && r.cdAfterSecondHitSameDash < 2) {
        return `잔영 — 같은 대시 안에서 두 번째 피격에도 쿨이 또 초기화됨(1회 한정 위반) (${r.cdAfterSecondHitSameDash})`
      }
      if (r.cdAfterPostHitInvuln < 2) return `잔영 — 피격 후 무적 중 접촉인데도 대시 쿨이 초기화됨 (${r.cdAfterPostHitInvuln})`
      return null
    }),
    async after(p) {
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.projectiles.clear()
        g.player.coreSlots.clear()
        g.debugEquipWeapons('m1911', 'katana')
      })
    },
  },
  // 작업 지시 P6 커밋2 — 역행(reverse)/여운(aftertaste)/순환(circulation) 스킬
  // 슬롯 특성 3종은 Q/E/R 액티브 스킬과 함께 전면 폐지됐다. 이 자리에 있던
  // 'skill-reverse'/'skill-triple-aftertaste'/'skill-circulation' 세 스텝도
  // 함께 제거한다 — 대체 커버리지는 위의 'combat-no-skills' 스텝을 참고.
  {
    name: 'fire-goblin',
    needs: 'dungeon',
    what: '화염구 고블린 — 적정 거리에서 측면 이동하고 커진 화염구(2.2배)를 발사하는가',
    async run(p) {
      // 다른 트리거(상자/제련소 등)로 'levelup' 모달이 열린 채 넘어오면
      // state!=='play'가 돼 게임 시계가 멈춘다 — 다른 대부분의 스텝처럼
      // 시작할 때 닫고 들어간다.
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.projectiles.clear()
        g.player.pos.set(0, 0, 0)
        const shooters = Array.from({ length: 6 }, (_, index) => {
          const shooter = g.debugSpawnEnemy('shooter')
          shooter.pos.set((index - 2.5) * 0.08, 0, -12)
          shooter.shootTimer = index === 0 ? 0 : 99
          return shooter
        })
        window.__qcFireGoblin = {
          starts: shooters.map((shooter) => ({ id: shooter.id, x: shooter.pos.x, z: shooter.pos.z })),
        }
      })
      await waitGame(p, 0.15) // 첫 발 발사까지 — shootTimer 카운트다운
      await p.evaluate(() => {
        window.__qcFireGoblin.bulletScale = window.__game.projectiles.enemyBullets[0]?.mesh.scale.x ?? null
      })
      await waitGame(p, 0.75) // 측면 이동 확인용 — 적정 거리 유지 이동
    },
    check: async (p) => p.evaluate(() => {
      const g = window.__game
      const shooters = g.enemies.filter((enemy) => enemy.kind === 'shooter')
      if (shooters.length !== 6) return `화염구 고블린 수가 달라짐 (${shooters.length})`
      const movedSideways = shooters.every((shooter) => {
        const start = window.__qcFireGoblin.starts.find((item) => item.id === shooter.id)
        return start && Math.abs(shooter.pos.x - start.x) > 0.05
      })
      if (!movedSideways) return '일부 화염구 고블린이 적정 거리에서 정지함'
      let minDistance = Infinity
      for (let i = 0; i < shooters.length; i++) {
        for (let j = i + 1; j < shooters.length; j++) {
          minDistance = Math.min(minDistance, shooters[i].pos.distanceTo(shooters[j].pos))
        }
      }
      if (minDistance < 0.45) return `화염구 고블린이 여전히 한곳에 뭉침 (${minDistance.toFixed(2)})`
      const bulletScale = window.__qcFireGoblin.bulletScale
      if (bulletScale == null) return '화염구를 발사하지 않음'
      // 2.2배(작업 지시 P6 커밋1-3 — 적 투사체 시인성 강화로 크기를 키움).
      if (Math.abs(bulletScale - 2.2) > 0.01) return `화염구 크기가 2.2배가 아님 (${bulletScale})`
      return null
    }),
  },
  {
    name: 'hitstop-surround-slowzone',
    needs: 'dungeon',
    what: '히트스톱 대상 분리(플레이어 정상 속도/적 감속) · 원거리 적 각도 슬롯 포위 · 효과 영역이 적에게도 적용되는가(작업 지시 P6 커밋1)',
    async run(p) {
      await dismissLevelUp(p)

      // ── 1. 히트스톱 중 플레이어는 정상 속도, 적은 느려지는가 ──
      // hitstopTimer를 실제 대기(500ms)보다 넉넉히 크게 강제해 그 구간 내내
      // 히트스톱이 유지되게 한다(자연 감소는 rawDt 기준이라 500ms 안엔 안 끝남).
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.player.pos.set(0, 0, 0)
        g.player.invuln = 999
        // 적 10마리 이상 난전 상황을 재현한다 — 측정 대상은 그중 하나(e)만
        // 추적하고 나머지는 순수 부하/혼잡 재현용.
        const others = Array.from({ length: 9 }, (_, i) => {
          const o = g.debugSpawnEnemy('imp')
          o.pos.set((i - 4) * 1.5, 0, -6)
          return o
        })
        const e = g.debugSpawnEnemy('imp')
        e.pos.set(0, 0, 10) // 플레이어 뒤(+Z)에 둬 KeyW(-Z) 이동과 겹치지 않게
        g.hitstopTimer = 3
        window.__qcHitstop = {
          enemyId: e.id,
          enemyCount: others.length + 1,
          playerStart: { x: g.player.pos.x, z: g.player.pos.z },
          enemyStart: { x: e.pos.x, z: e.pos.z },
          wallStart: performance.now(),
        }
      })
      await p.keyboard.down('KeyW')
      // 실제 wall-clock 1.5초 대기 — simClock/waitGame이 아니라 진짜 경과시간이
      // 필요하다. 이 샌드박스는 게임-시계 배속(clockRate, town-idle 프리플라이트
      // 실측)이 실제 벽시계보다 훨씬 느려(~0.25~0.29배) rawDt 합산량이 벽시계
      // 경과시간보다 훨씬 작다 — 기대 이동거리도 clockRate로 보정해야 한다.
      await p.waitForTimeout(1500)
      await p.keyboard.up('KeyW')
      const speedCheck = await p.evaluate(() => {
        const g = window.__game
        const e = g.enemies.find((it) => it.id === window.__qcHitstop.enemyId)
        const wallElapsed = (performance.now() - window.__qcHitstop.wallStart) / 1000
        const playerMoved = Math.hypot(
          g.player.pos.x - window.__qcHitstop.playerStart.x,
          g.player.pos.z - window.__qcHitstop.playerStart.z,
        )
        const enemyMoved = e
          ? Math.hypot(e.pos.x - window.__qcHitstop.enemyStart.x, e.pos.z - window.__qcHitstop.enemyStart.z)
          : null
        return {
          wallElapsed,
          playerMoved,
          enemyMoved,
          moveSpeed: g.player.stats.moveSpeed,
          hitstopStillActive: g.hitstopTimer > 0,
        }
      })
      // enemy.speed 기준값(baseSpeed*speedMul, debugSpawnEnemy는 speedMul=1) — imp의 speedMul.
      const enemyBaseSpeed = 4.2
      const rate = clockRate ?? 1
      const result = {
        ...speedCheck,
        expectedPlayerMoved: speedCheck.moveSpeed * speedCheck.wallElapsed * rate,
        expectedEnemyMovedUnslowed: enemyBaseSpeed * speedCheck.wallElapsed * rate,
      }
      await p.evaluate((data) => { window.__qcHitstopResult = data }, result)

      // ── 2. 연속 명중으로 히트스톱이 무한 연장되지 않는가 ──
      // 최소 재발동 간격보다 훨씬 촘촘하게(프레임마다) triggerHitstop을 강제
      // 호출해도 누적 상한을 넘지 않는지 확인한다.
      const hitstopCapCheck = await p.evaluate(async () => {
        const g = window.__game
        g.hitstopTimer = 0
        g.hitstopCooldown = 0
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        let maxSeen = 0
        for (let i = 0; i < 60; i++) {
          g.triggerHitstop(0.3) // 개별 요청은 hitstopMaxDuration(0.35)보다 작다
          maxSeen = Math.max(maxSeen, g.hitstopTimer)
          await wait(8) // 재발동 최소 간격(0.08s)보다 촘촘하게 반복 호출
        }
        return { maxSeen, maxDuration: window.CONFIG?.effects?.hitstopMaxDuration ?? null }
      })

      // ── 3. 원거리 적 4마리 이상 — 서로 다른 각도 슬롯에 배정되는가 ──
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.player.pos.set(0, 0, 0)
        const shooters = Array.from({ length: 5 }, () => {
          const s = g.debugSpawnEnemy('shooter')
          s.pos.set(0.01, 0, -0.01) // 전부 같은 자리에서 시작 — 슬롯 배정 전
          return s
        })
        window.__qcSurroundIds = shooters.map((s) => s.id)
      })
      await waitGame(p, 0.1) // assignSurroundSlots()가 몇 프레임 돌 시간
      const surroundCheck = await p.evaluate(() => {
        const g = window.__game
        const angles = window.__qcSurroundIds.map((id) => g.enemies.find((e) => e.id === id)?.surroundAngle ?? null)
        return { angles }
      })

      // ── 4. 효과 영역이 적에게도 적용되는가 ──
      const slowZoneSetup = await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        const e = g.debugSpawnEnemy('imp')
        // 방 경계 밖(예: 아주 먼 좌표)에 두면 room.clamp()가 매 프레임 방 안으로
        // 되돌리면서 존 중심에서 순간 이동하듯 벗어나 버린다 — 방 안쪽 좌표를 쓴다.
        e.pos.set(8, 0, 8)
        e.speed = 0 // 플레이어를 향해 걸어 나가 존 반경(5) 밖으로 벗어나지 않게 고정
        g.spawnSlowZone(e.pos.clone(), 5, 3, 0.3)
        return { id: e.id, baseSpeed: e.speed, zoneCount: g.slowZones.length }
      })
      await waitGame(p, 0.25) // updateSlowZones()가 몇 프레임 돌 시간
      const slowZoneCheck = await p.evaluate((setup) => {
        const g = window.__game
        const e = g.enemies.find((it) => it.id === setup.id)
        return { multiplier: e ? e.movementSlowMultiplier : null }
      }, slowZoneSetup)

      await p.evaluate((data) => { window.__qcHitstopSurroundResult = data }, { hitstopCapCheck, surroundCheck, slowZoneSetup, slowZoneCheck })

      // 이 스텝이 강제로 켠 상태(장시간 무적·히트스톱)가 이후 스텝(보스 피해
      // 검증 등)으로 새지 않게 원상복구한다.
      await p.evaluate(() => {
        const g = window.__game
        g.player.invuln = 0
        g.hitstopTimer = 0
        g.hitstopCooldown = 0
      })
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcHitstopResult
      const r2 = window.__qcHitstopSurroundResult
      if (!r || !r2) return '결과를 수집하지 못함'

      // 1. 히트스톱 중 플레이어 속도 — clockRate로 보정한 정상 이동 거리의 60%
      // 이상이면 통과(clockRate 자체가 프리플라이트 1회 실측이라 여유를 넉넉히 둠).
      if (!r.hitstopStillActive) return '히트스톱이 검증 도중 끝나버림 — 표본 무효'
      if (r.playerMoved < r.expectedPlayerMoved * 0.6) {
        return `히트스톱 중 플레이어 이동이 정상 속도보다 느림 (이동 ${r.playerMoved.toFixed(2)}, 기대 ${r.expectedPlayerMoved.toFixed(2)})`
      }
      // 적은 hitstopScale(0.05)만큼 느려져야 한다 — clockRate 보정한 "안 느려졌을 때
      // 기대 이동량"의 35% 미만이면 통과(참 목표는 5%대, 여유를 크게 둔 상한).
      if (r.enemyMoved == null) return '히트스톱 검증용 적이 사라짐'
      if (r.enemyMoved > r.expectedEnemyMovedUnslowed * 0.35) {
        return `히트스톱 중 적이 정상 속도로 움직임 (이동 ${r.enemyMoved.toFixed(2)}, 안 느려졌을 때 기대 ${r.expectedEnemyMovedUnslowed.toFixed(2)})`
      }

      // 2. 히트스톱 누적 상한 — 반복 재발동에도 hitstopMaxDuration을 넘지 않아야 한다
      if (r2.hitstopCapCheck.maxSeen > 0.351) {
        return `히트스톱이 누적 상한을 넘음 (${r2.hitstopCapCheck.maxSeen})`
      }

      // 3. 각도 슬롯 — 5마리 전부 다른 각도(반올림 기준)에 배정돼야 한다
      const angles = r2.surroundCheck.angles
      if (angles.some((a) => a == null)) return '일부 원거리 적에게 각도 슬롯이 배정되지 않음'
      const rounded = new Set(angles.map((a) => Math.round(a * 1000)))
      if (rounded.size !== angles.length) return `원거리 적 각도 슬롯이 겹침 (${angles.join(', ')})`

      // 4. 효과 영역 — 적의 이동속도 배율이 존 배율(0.3) 근처까지 내려가야 한다
      if (r2.slowZoneSetup.zoneCount < 1) return '효과 영역이 등록되지 않음'
      if (r2.slowZoneCheck.multiplier == null || r2.slowZoneCheck.multiplier > 0.31) {
        return `효과 영역이 적에게 적용되지 않음 (multiplier=${r2.slowZoneCheck.multiplier})`
      }
      return null
    }),
  },
  {
    name: 'critical-south-edge',
    needs: 'dungeon',
    what: '치명타 숫자·하단 가림 — 원거리 치명타도 붉고 적이 남쪽 전경 안쪽에 제한되는가',
    async run(p) {
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        const enemy = g.debugSpawnEnemy('brute')
        enemy.pos.set(0, 0, g.room.bounds.maxZ)
        window.__qcSouthEdgeId = enemy.id
        g.effects.damageNumber(g.player.pos.clone().setY(2), 999, true, true)
      })
      await waitGame(p, 0.1) // room.clamp()가 적 위치를 정리하는 프레임 처리까지
    },
    check: async (p) => p.evaluate(() => {
      const g = window.__game
      const enemy = g.enemies.find((item) => item.id === window.__qcSouthEdgeId)
      if (!enemy) return '하단 경계 검사용 적이 없음'
      const southLimit = g.room.bounds.maxZ - enemy.radius * 0.6 - 2.3
      if (enemy.pos.z > southLimit) return `적이 하단 전경 영역에 들어감 (${enemy.pos.z.toFixed(2)} > ${southLimit.toFixed(2)})`
      const crit = document.querySelector('.floater.crit.range')
      if (!crit) return '원거리 치명타 숫자가 생성되지 않음'
      if (getComputedStyle(crit).color !== 'rgb(255, 63, 63)') {
        return `원거리 치명타 숫자가 붉은색이 아님 (${getComputedStyle(crit).color})`
      }
      return null
    }),
  },
  {
    // 작업 지시 P7 커밋2 — 선형 분기 맵(깊이 9 고정). 단일 관찰로는 확률
    // 기반 배치 결함(예: 분수 배치에서 겪은 약 1.3% 조건 미달)을 못 잡는다 —
    // RunState를 300회 이상 독립적으로 새로 생성해 배치 규칙 위반 카운터로
    // 검증한다(게임 상태는 건드리지 않음, debugMapSample 참고).
    name: 'boss-prep',
    needs: 'dungeon',
    what: '보스 준비 장소 — 시설 이용을 막지 않고 출발 버튼 뒤 보스 카드 1장만 표시되는가, 선형 분기 맵 배치 규칙(깊이 9, 300회 표본)',
    async run(p) {
      const loaded = await p.evaluate(() => {
        const g = window.__game
        const nodes = g.run.nodes
        const rest = [...nodes.values()].find((node) => node.plan.kind === 'rest')
        if (!rest) throw new Error('보스 준비 장소가 생성되지 않음')
        // stabilize=false: 준비방 시설과 #routeContinue를 실제 loadRoom 결과
        // 그대로 남긴다. 경로 선택 화면이 먼저 떠 시설을 가리면 이 검사는 실패한다.
        return g.debugLoadRoom(rest.plan.id, false)
      })
      if (!loaded) throw new Error('보스 준비 장소를 QC 방 로드 훅으로 열지 못함')
      await p.waitForTimeout(350)
      await openFacilityRouteCards(p)
      const cards = await readRouteCards(p)
      await p.evaluate((value) => { window.__qcBossPrepRouteCards = value }, cards)
    },
    check: async (p) => {
      const r = await p.evaluate(() => {
        const g = window.__game
        const nodes = g.run.nodes
        const rest = [...nodes.values()].find((node) => node.plan.kind === 'rest')
        const boss = [...nodes.values()].find((node) => node.plan.kind === 'boss')
        const kinds = g.interactables.map((item) => item.kind)
        const restExitIds = rest ? Object.values(rest.exits) : []
        const bossExitIds = boss ? Object.values(boss.exits) : []
        const routeCards = window.__qcBossPrepRouteCards
        let structural = null
        if (!rest || !boss) structural = '보스 준비 장소 또는 보스방이 없음'
        else if (rest.plan.enemies.length !== 0) structural = '보스 준비 장소에 적이 배치됨'
        else if (!kinds.includes('merchant') || !kinds.includes('fountain')) structural = '보스 준비 장소에 상점 또는 분수가 없음'
        else if (restExitIds.length !== 1 || restExitIds[0] !== boss.plan.id) structural = '준비 장소가 보스방과 단일 통로로 연결되지 않음'
        else if (bossExitIds.length !== 0) structural = '보스방에 출입구가 있음(터미널 노드여야 함 — 되돌아가기 폐지 위반)'

        const sample = g.debugMapSample(300)
        return { structural, sample, routeCards, bossId: boss?.plan.id ?? null }
      })
      if (r.structural) return r.structural
      const routeError = validateRouteCards(r.routeCards, 1, 1)
      if (routeError) return `보스 진입 카드: ${routeError}`
      if (r.routeCards[0].roomId !== r.bossId) {
        return `보스 준비방의 단일 카드가 보스방을 가리키지 않음 (${r.routeCards[0].roomId} / ${r.bossId})`
      }

      const s = r.sample
      console.log(`  · 선형 분기 맵 표본 ${s.n}회 검증(작업 지시 P7 커밋2)`)
      if (s.shopDepthWrong > 0) return `깊이4가 상점이 아닌 표본 ${s.shopDepthWrong}건`
      if (s.restDepthWrong > 0) return `깊이8이 보스 준비방이 아닌 표본 ${s.restDepthWrong}건`
      if (s.bossDepthWrong > 0) return `깊이9가 보스가 아닌 표본 ${s.bossDepthWrong}건`
      if (s.branchDepthCountWrong > 0) return `분기 깊이가 6개가 아닌 표본 ${s.branchDepthCountWrong}건`
      if (s.branchChoiceCountWrong > 0) return `분기 선택지가 2~3개 범위를 벗어난 표본 ${s.branchChoiceCountWrong}건`
      if (s.traitNodeCountWrong > 0) return `각인 계열 노드 수가 2~4개 범위를 벗어난 표본 ${s.traitNodeCountWrong}건`
      if (s.recoverMissing > 0) return `회복 노드가 없는 표본 ${s.recoverMissing}건`
      if (s.hardCombatTooEarly > 0) return `상위 전투가 깊이 5 미만에 나온 표본 ${s.hardCombatTooEarly}건`
      if (s.duplicateKindAtDepth > 0) return `같은 깊이에 같은 종류 선택지가 겹친 표본 ${s.duplicateKindAtDepth}건`
      if (s.backwardEdge > 0) return `되돌아가기가 가능한 간선이 있는 표본 ${s.backwardEdge}건`
      return null
    },
    async after(p) {
      // 고정 깊이 카드도 클릭으로 실제 진입되는지 확인하고, 뒤의 보스 패턴
      // 시나리오가 계획 보스와 QC 보스를 중복 스폰하지 않도록 방을 비운다.
      await chooseRouteCard(p, { index: 0, via: 'click' })
      await p.evaluate(() => {
        window.__game.debugClearEnemies()
        window.__game.debugStabilizeRouteSandbox()
      })
    },
  },
  {
    name: 'boss-charge',
    needs: 'dungeon',
    what: '보스 돌진 — 예고(0.7s)→돌진(1.0s,3.5배속)→경직(1.2s) 타이밍',
    async run(p) {
      // 다른 트리거(상자/제련소 등)로 'levelup' 모달이 뜬 채 남아있을 수 있다 —
      // state가 'levelup'이면 Game의 프레임 루프가 적을 갱신하지 않아
      // (this.state==='play' 로만 진행) 이후 모든 보스/엘리트 단계가 멈춰
      // 보인다. 항상 먼저 치워야 한다.
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        // 이 구간부터는 보스/엘리트를 실제 피해 판정과 함께 반복 스폰한다 —
        // 죽어서 gameover가 되면 프레임 루프 전체가 멈춰 뒤 단계가 연쇄로
        // 얼어붙으므로, 이 구간 동안은 플레이어를 사실상 무적으로 둔다.
        g.player.stats.maxHp = 999999
        g.player.hp = 999999
        g.debugClearEnemies()
        const boss = g.debugSpawnBoss()
        const dir = g.player.pos.clone().sub(boss.pos).normalize()
        boss.bossFacing.copy(dir)
        boss.bossState = 'chargeWarning'
        boss.bossTimer = 0.7
        startQcSampler()
      })
      await p.waitForTimeout(400) // 예고 스프라이트가 화면에 보이는 시점에서 스크린샷
    },
    check: async (p) => {
      await waitGame(p, 2.8) // 남은 예고+돌진+경직 전 구간 관찰 (게임초)
      const samples = await stopQcSampler(p)
      return verifyStateSequence(samples, [
        { state: 'chargeWarning', ms: 700 },
        { state: 'charge', ms: 1000 },
        { state: 'stagger', ms: 1200 },
      ])
    },
  },
  {
    name: 'boss-slam',
    needs: 'dungeon',
    what: '보스 슬램 — 예고(0.9s, 바닥 경고)→발동(반경7·2배피해)→경직(1.0s) 타이밍',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        const boss = g.debugSpawnBoss()
        window.__qcPlayerHpBefore = g.player.hp
        boss.bossAnchor.copy(boss.pos)
        boss.bossState = 'slamWarning'
        boss.bossTimer = 0.9
        startQcSampler()
      })
      await p.waitForTimeout(500) // 바닥 경고 이펙트가 보이는 시점에서 스크린샷
    },
    check: async (p) => {
      await waitGame(p, 1.7) // 남은 예고+발동+경직 관찰 (게임초)
      const samples = await stopQcSampler(p)
      const seqFail = verifyStateSequence(samples, [
        { state: 'slamWarning', ms: 900 },
        { state: 'stagger', ms: 1000 },
      ])
      if (seqFail) return seqFail
      const dmg = await p.evaluate(() => window.__qcPlayerHpBefore - window.__game.player.hp)
      return dmg > 0 ? null : `슬램 발동 후 플레이어 피해 없음 (반경 내 배치했는데 피해 0)`
    },
  },
  {
    name: 'boss-phase2',
    needs: 'dungeon',
    what: '보스 2페이즈 — 체력 50% 시점 1회성 전환(배너·예고/경직 단축)',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        const boss = g.debugSpawnBoss()
        boss.hp = boss.maxHp * 0.49
      })
      // bossPhaseTwo 플래그는 Enemy 자체 업데이트(매 프레임 dt) 안에서 hp<=50%를
      // 보고 뒤집힌다 — evaluate()에서 hp만 깎은 시점엔 아직 안 뒤집혀 있어
      // check()가 최소 한 프레임의 시뮬레이션 진행을 필요로 한다.
      await waitGame(p, 0.3)
    },
    check: async (p) => {
      const r = await p.evaluate(() => {
        const g = window.__game
        const boss = g.enemies.find((e) => e.kind === 'boss')
        const bannerText = document.querySelector('#banner')?.textContent ?? ''
        const firstPhase2 = boss?.bossPhaseTwo === true
        // 체력을 더 깎아도 재진입(중복 발동)하지 않아야 한다 — 짧은 예고 시간이
        // 유지되는지로 간접 확인(재진입 시 telegraph가 phaseTwo 계산을 다시 안 함).
        if (boss) boss.hp = Math.max(1, boss.maxHp * 0.1)
        return { firstPhase2, bannerText, stillPhase2: boss?.bossPhaseTwo === true }
      })
      if (!r.firstPhase2) return '체력 50% 이하인데도 bossPhaseTwo 가 true 로 안 바뀜'
      if (!r.bannerText.includes('2페이즈')) return `배너 텍스트에 "2페이즈" 없음 (실제: "${r.bannerText}")`
      if (!r.stillPhase2) return '체력을 더 깎았더니 bossPhaseTwo 가 false 로 되돌아감 (재진입 가드 깨짐)'
      return null
    },
  },
  {
    name: 'boss-stage-reward',
    needs: 'dungeon',
    what: '보스(스테이지 클리어) 각인 보상(작업 지시 P8 커밋3 노드 표) — 카드 3장(등급 태그 포함) 선택 후 기존 스테이지 클리어 화면으로 이어지는가. 이 저장소엔 원래 이 흐름 자체가 없었다(신규 추가)',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.player.sigilGrades.clear()
      })
      await p.evaluate(() => window.__game.grantBossStageReward())
      await p.waitForTimeout(200)
      const cards = await p.evaluate(() => {
        const result = [...document.querySelectorAll('#cards .card')].map((c) => ({
          tag: c.querySelector('.ctag')?.textContent ?? null,
          open: document.querySelector('#levelOv')?.classList.contains('show'),
        }))
        window.__qcBossRewardCards = result
        return result
      })
      if (cards.length > 0) await p.click('#cards .card')
      await p.waitForTimeout(200)
    },
    check: async (p) => {
      const cards = await p.evaluate(() => window.__qcBossRewardCards)
      if (!cards || cards.length !== 3) return `보스 보상 카드가 3장이 아님 (${cards?.length})`
      if (!cards[0].open) return '카드 선택 오버레이(#levelOv)가 열리지 않음'
      if (!cards.every((c) => c.tag && ['노멀', '레어', '유니크', '레전더리', '에픽'].includes(c.tag))) {
        return `카드에 등급 태그가 없거나 알 수 없는 값 (${JSON.stringify(cards.map((c) => c.tag))})`
      }
      const clearShown = await p.evaluate(() => document.querySelector('#clearOv')?.classList.contains('show'))
      if (!clearShown) return '카드 선택 후 기존 스테이지 클리어 화면(#clearOv)으로 이어지지 않음'
      return null
    },
    async after(p) {
      await p.evaluate(() => {
        document.querySelector('#clearOv')?.classList.remove('show')
        const g = window.__game
        g.state = 'play'
        // 이 스텝에서 실제로 카드를 골라 각인을 하나 적용했다 — 뒤 스텝들이
        // 깨끗한 상태를 기대하므로 여기서도 정리한다(plain recompute()가
        // 아니라 recomputeSigilMods()로 mods까지 완전히 초기화).
        g.player.sigilGrades.clear()
        g.player.recomputeSigilMods()
      })
    },
  },
  {
    name: 'enemy-stun',
    needs: 'dungeon',
    what: '일반 적 기절(작업 지시 P7 커밋3) — 이동/공격/사격 정지, 지속시간 후 자동 해제, 보스는 applyStun() 면역',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.player.pos.set(0, 0, 0)
        const shooter = g.debugSpawnEnemy('shooter')
        shooter.pos.set(0, 0, -3)
        window.__qcStunEnemy = shooter
        window.__qcStunPosBefore = { x: shooter.pos.x, z: shooter.pos.z }
        window.__qcStunBulletsBefore = g.projectiles.bullets.length
        shooter.applyStun(1.0)
        const boss = g.debugSpawnBoss()
        boss.applyStun(1.0)
        window.__qcStunBoss = boss
      })
    },
    check: async (p) => {
      await waitGame(p, 0.4) // 기절 지속시간(1.0s) 중간 시점
      const mid = await p.evaluate(() => {
        const e = window.__qcStunEnemy
        const boss = window.__qcStunBoss
        const moved = Math.hypot(e.pos.x - window.__qcStunPosBefore.x, e.pos.z - window.__qcStunPosBefore.z)
        return {
          stunned: e.stunned,
          moved,
          bulletsNow: window.__game.projectiles.bullets.length,
          bulletsBefore: window.__qcStunBulletsBefore,
          bossStunned: boss.stunned,
        }
      })
      if (!mid.stunned) return '기절 지속시간 중인데 Enemy.stunned=false'
      if (mid.moved > 0.05) return `기절 중인데 이동함 (변위 ${mid.moved.toFixed(3)})`
      if (mid.bulletsNow > mid.bulletsBefore) return '기절 중인데 사격함 (투사체 수 증가)'
      if (mid.bossStunned) return '보스가 applyStun()에 걸림 — 보스는 일반 기절에 면역이어야 함(브레이크 전용)'

      await waitGame(p, 0.8) // 지속시간(1.0s) 경과 후
      const after = await p.evaluate(() => window.__qcStunEnemy.stunned)
      if (after) return '기절 지속시간이 지났는데도 여전히 stunned=true'
      return null
    },
  },
  {
    name: 'boss-break',
    needs: 'dungeon',
    what: '보스 브레이크(작업 지시 P7 커밋3) — HP 75%/25% 기절(50%는 기절 없이 2페이즈만), 동시 임계 통과 1회만, 예고 취소+이펙트 제거',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        const boss = g.debugSpawnBoss()
        // 슬램 예고 중(바닥 경고 이펙트가 이미 떠 있는 상태)으로 만들어, 75%
        // 임계를 통과시켰을 때 "패턴 취소 + 예고 이펙트 제거"를 검증한다.
        boss.bossAnchor.copy(boss.pos)
        boss.bossState = 'slamWarning'
        boss.bossTimer = 5
        g.effects.playGroundFx('warning', boss.pos.x, boss.pos.z, 4, 5)
        window.__qcBreakBoss = boss
      })
    },
    check: async (p) => {
      const beforeCount = await p.evaluate(() => window.__game.effects.groundFx.length)
      if (beforeCount < 1) return '사전 조건 실패 — 예고(warning) 이펙트가 생성되지 않음'

      await p.evaluate(() => { window.__qcBreakBoss.hp = window.__qcBreakBoss.maxHp * 0.74 }) // 75% 임계만 통과
      await waitGame(p, 0.15)
      const afterBreak75 = await p.evaluate(() => {
        const g = window.__game
        const boss = window.__qcBreakBoss
        return {
          stunned: boss.stunned,
          bossState: boss.bossState,
          groundFxKinds: g.effects.groundFx.map((fx) => fx.kind),
          phaseTwo: boss.bossPhaseTwo,
        }
      })
      if (!afterBreak75.stunned) return '75% 임계를 통과했는데 보스가 기절하지 않음'
      if (afterBreak75.bossState !== 'idle') return `75% 브레이크 후 bossState가 idle이 아님 (실제: ${afterBreak75.bossState})`
      if (afterBreak75.groundFxKinds.includes('warning')) return '75% 브레이크로 패턴이 취소됐는데 예고(warning) 이펙트가 남아있음 (유령 예고)'
      if (afterBreak75.phaseTwo) return '75% 임계에서 2페이즈가 잘못 진입함 (2페이즈는 50%에서만, 기절 없이 진입해야 함)'

      await waitGame(p, 1.6) // 브레이크 기절 지속시간(CONFIG.enemy.bossBreak.duration=1.5s) 경과 대기
      const afterStunEnds = await p.evaluate(() => window.__qcBreakBoss.stunned)
      if (afterStunEnds) return '보스 브레이크 기절이 지정된 지속시간 이후에도 풀리지 않음'

      // 50% 통과 — 이번엔 기절 없이 2페이즈만 진입해야 한다(작업 지시가 명시적으로 요구하는 배치)
      await p.evaluate(() => { window.__qcBreakBoss.hp = window.__qcBreakBoss.maxHp * 0.49 })
      await waitGame(p, 0.15)
      const at50 = await p.evaluate(() => {
        const boss = window.__qcBreakBoss
        return { stunned: boss.stunned, phaseTwo: boss.bossPhaseTwo }
      })
      if (!at50.phaseTwo) return '50% 임계인데 2페이즈로 진입하지 않음'
      if (at50.stunned) return '50%(2페이즈) 진입 시 기절이 함께 발생함 — 75%/25%만 기절해야 하며 50%와 겹치면 안 됨'

      // 한 번의 공격으로 75%/25% 두 임계를 동시에 통과(80%→10%) — 기절은 1회만 발동해야 한다
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        const boss = g.debugSpawnBoss()
        boss.hp = boss.maxHp * 0.1
        window.__qcBreakBoss2 = boss
      })
      await waitGame(p, 0.15)
      const doubleCross = await p.evaluate(() => window.__qcBreakBoss2.stunned)
      if (!doubleCross) return '75%/25% 동시 통과인데 기절하지 않음'

      // 이미 두 임계 모두 통과한 상태에서 체력을 더 깎아도 재발동(stunTimer 재연장) 없어야 함(래치 확인)
      const stunBefore = await p.evaluate(() => window.__qcBreakBoss2.stunTimer)
      await p.evaluate(() => { window.__qcBreakBoss2.hp = window.__qcBreakBoss2.maxHp * 0.05 })
      await waitGame(p, 0.15)
      const stunAfter = await p.evaluate(() => window.__qcBreakBoss2.stunTimer)
      if (stunAfter > stunBefore + 0.01) return '이미 통과한 임계가 재발동해 stunTimer가 다시 늘어남 (런당 1회 래치 깨짐)'

      return null
    },
  },
  {
    name: 'status-bleed-shock',
    needs: 'dungeon',
    what: '출혈/감전(작업 지시 P8 커밋2) — 출혈 중첩·개별 만료·틱 피해, 감전 갱신(비중첩)·받는피해 증가·비경직, 보스도 면역 아님, 기절과 다른 틴트',
    async run(p) {
      await dismissLevelUp(p)
      const r = await p.evaluate(async () => {
        const g = window.__game
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const out = {}

        // ── 출혈 — 중첩 3개(서로 다른 지속시간), 틱 피해, 개별 만료 ──
        g.debugClearEnemies()
        const bleedTarget = g.debugSpawnEnemy('brute')
        bleedTarget.hp = 100000
        bleedTarget.pos.set(20, 0, 20) // 화면/다른 검증과 겹치지 않게 격리
        bleedTarget.speed = 0
        bleedTarget.damage = 0
        bleedTarget.applyBleed(1.3) // 곧 만료될 스택
        bleedTarget.applyBleed() // 기본 지속시간(4s) 스택 2개
        bleedTarget.applyBleed()
        out.stackCountAfterApply = bleedTarget.bleedStackCount
        const hpBeforeTick = bleedTarget.hp
        const simT0 = g.simClock
        while (g.simClock - simT0 < 1.2) await wait(30) // 첫 틱(1s) 이후, 3스택 전부 아직 생존
        out.hpAfterFirstTick = bleedTarget.hp
        out.tickDelta = hpBeforeTick - bleedTarget.hp
        while (g.simClock - simT0 < 1.6) await wait(30) // 1.3s 스택 만료 시점 통과
        out.stackCountAfterOneExpires = bleedTarget.bleedStackCount
        out.bleedingAfterOneExpires = bleedTarget.bleeding
        out.bleedTint = bleedTarget.sprite.mat.color.getHex()

        // ── 감전 — 갱신(비중첩), 받는 피해 증가, 이동/행동 유지 ──
        g.debugClearEnemies()
        const shockTarget = g.debugSpawnEnemy('imp')
        shockTarget.hp = 100000
        shockTarget.pos.set(0, 0, -6)
        shockTarget.applyShock(3)
        const posBefore = { x: shockTarget.pos.x, z: shockTarget.pos.z }
        const simT1 = g.simClock
        while (g.simClock - simT1 < 1.0) await wait(30) // shockTimer 3s -> 남은 시간 약 2s
        const shockTimerBeforeReapply = shockTarget.stunTimer // 참고용(항상 0이어야 함, 감전은 기절이 아니다)
        const timerBefore = shockTarget.shocked
        shockTarget.applyShock(3) // 재적용 — 누적이 아니라 갱신이어야 한다
        out.shockStillShocked = shockTarget.shocked
        out.shockNeverStuns = shockTimerBeforeReapply === 0
        out.shockMoved = Math.hypot(shockTarget.pos.x - posBefore.x, shockTarget.pos.z - posBefore.z)
        const hpBeforeShockHit = shockTarget.hp
        shockTarget.takeDamage(100, 'ranged', false)
        out.shockDamageDealt = hpBeforeShockHit - shockTarget.hp
        out.shockTint = shockTarget.sprite.mat.color.getHex()

        // 감전 해제 후엔 배율이 원래대로(1배)여야 한다
        shockTarget.hp = 100000
        shockTarget.shockTimer = 0
        const hpBeforeNoShockHit = shockTarget.hp
        shockTarget.takeDamage(100, 'ranged', false)
        out.noShockDamageDealt = hpBeforeNoShockHit - shockTarget.hp

        // ── 보스 — 기절은 면역이지만 출혈/감전은 면역이 아니어야 한다 ──
        g.debugClearEnemies()
        const boss = g.debugSpawnBoss()
        boss.applyBleed()
        boss.applyShock()
        out.bossBleedStacks = boss.bleedStackCount
        out.bossShocked = boss.shocked

        return out
      })
      await p.evaluate((result) => { window.__qcStatusResult = result }, r)
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcStatusResult
      if (!r) return '결과 없음'
      if (r.stackCountAfterApply !== 3) return `출혈 3회 적용 후 스택 수가 3이 아님 (${r.stackCountAfterApply})`
      const expectedTick = 3 * 3 // 스택 3개 × 틱 피해(CONFIG.enemy.bleed.tickDamage=3)
      if (Math.abs(r.tickDelta - expectedTick) > 0.5) return `출혈 틱 피해가 스택 수(3)×틱피해와 다름 (${r.tickDelta} / 기대 ${expectedTick})`
      if (r.stackCountAfterOneExpires !== 2) return `1.3초 스택 만료 후 남은 스택이 2가 아님 (${r.stackCountAfterOneExpires}) — 개별 만료가 아니라 전체 일괄 처리되는 듯`
      if (!r.bleedingAfterOneExpires) return '스택이 남아있는데 bleeding=false'
      if (r.bleedTint == null) return '출혈 틴트 색을 읽지 못함'

      if (!r.shockStillShocked) return '감전 재적용 후 shocked=false (지속시간이 사라짐)'
      if (!r.shockNeverStuns) return '감전이 기절(stunTimer)을 함께 걸고 있음 — 경직류로 만들지 말라는 지시 위반'
      if (r.shockMoved < 1) return `감전 중인데 이동하지 않음 (변위 ${r.shockMoved}) — 경직류가 아니어야 한다`
      const shockRatio = r.shockDamageDealt / r.noShockDamageDealt
      if (Math.abs(shockRatio - 1.3) > 0.05) return `감전 중 받는 피해 배율이 1.3배가 아님 (실측 ${shockRatio.toFixed(2)})`
      if (r.shockTint == null) return '감전 틴트 색을 읽지 못함'
      if (r.shockTint === r.bleedTint) return '감전과 출혈 틴트 색이 동일함 — 시각적으로 구분되지 않음'

      if (r.bossBleedStacks < 1) return '보스가 출혈에 면역임 — 기절과 달리 면역이면 안 된다'
      if (!r.bossShocked) return '보스가 감전에 면역임 — 기절과 달리 면역이면 안 된다'

      return null
    }),
  },
  {
    name: 'sigil-grades',
    needs: 'dungeon',
    what: '각인 등급 5단계(작업 지시 P8 커밋3) — 승급은 누적이 아니라 교체, 강등 무시, 신속 장전(등급별 장전 시간 단축), 폭심 에픽(연쇄 폭발, 그 이하 등급은 단발)',
    async run(p) {
      await dismissLevelUp(p)
      const r = await p.evaluate(async () => {
        const g = window.__game
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const out = {}

        // ── 승급은 누적이 아니라 "그 등급 값으로 전면 재계산" ──
        // sigilGrades만 비우고 plain recompute()를 부르면 mods의 각인
        // 기여분(critChance/explodeOnKill/detonatorChain 등)은 안 지워진다
        // (recompute()는 mods→stats만 재계산하지 sigilGrades→mods는 안 한다) —
        // recomputeSigilMods()로 완전히 재구성해야 한다.
        g.player.sigilGrades.clear()
        g.player.recomputeSigilMods()
        g.player.applySigil('crit', 'normal')
        out.critAfterNormal = g.player.mods.critChance
        g.player.applySigil('crit', 'unique')
        out.critAfterUnique = g.player.mods.critChance
        // 강등 시도 — 무시돼야 한다(등급이 그대로여야 함)
        g.player.applySigil('crit', 'rare')
        out.critAfterDowngradeAttempt = g.player.mods.critChance
        out.gradeAfterDowngradeAttempt = g.player.sigilGrades.get('crit')

        // ── 신속 장전(리듬 폐지 이후 P10) — 등급이 오를수록 장전 시간이
        // 짧아지기만 한다(에픽 전용 규칙 변경은 리듬과 함께 제거됨) ──
        g.player.sigilGrades.delete('reload')
        g.player.recomputeSigilMods()
        const baseReloadTime = g.player.stats.reloadTime
        g.player.applySigil('reload', 'normal')
        out.reloadTimeNormal = g.player.stats.reloadTime
        g.player.applySigil('reload', 'epic')
        out.reloadTimeEpic = g.player.stats.reloadTime
        out.reloadTimeBase = baseReloadTime

        // ── 폭심 — 레전더리(비에픽)는 단발, 에픽은 연쇄 ──
        // A(직접 처치) 폭발 반경(3.2) 안에 B, B 폭발 반경 안(A 기준으로는 밖)에 C.
        const spawnChainTrio = () => {
          g.debugClearEnemies()
          const a = g.debugSpawnEnemy('imp')
          a.pos.set(0, 0, -3)
          const b = g.debugSpawnEnemy('imp')
          b.pos.set(0, 0, -6) // A에서 거리 3 — A의 폭발 반경(3.2) 안
          const c = g.debugSpawnEnemy('imp')
          c.pos.set(0, 0, -9) // A에서 거리 6(밖) — B에서는 거리 3(안), 연쇄가 있어야만 죽는다
          return { a, b, c }
        }
        // killEnemy()를 살아있는 적에 바로 부르면 안 된다 — aoeDamage()가
        // this.enemies를 그대로 순회하며 아직 alive===true인 a 자신도
        // 폭발 반경(중심, 거리 0)에 걸려 자기 자신에게도 피해를 입혀
        // 이중 사망 처리가 된다(QC로 실제 재현 — 이후 스텝에서 미아가 된
        // 적이 프레임 루프를 깨뜨렸다). 실제 게임 흐름(takeDamage → hp<=0
        // → 다음 프레임 !e.alive 감지 → killEnemy+splice)을 그대로 따라
        // hp/alive를 먼저 정리한 뒤 killEnemy를 부르고 직접 splice한다.
        const killDirect = (e) => {
          e.hp = 0
          e.alive = false
          g.killEnemy(e, false)
          const idx = g.enemies.indexOf(e)
          if (idx >= 0) g.enemies.splice(idx, 1)
        }

        // killDirect()는 e.alive=false로만 표시하고, 실제 aoeDamage/체인
        // 처리는(dieFromExplosion 플래그를 통해) updateEnemies()의 다음
        // 프레임 패스에서 일어난다(프로덕션 버그 수정 이후의 실제 흐름과
        // 동일) — 따라서 게임 시계가 최소 한 프레임 이상 진행되길 기다린
        // 뒤에 b/c의 생존 여부를 읽어야 한다.
        // 벽시계 상한(5s) — simClock이 멈추면(모달/루프 정지) 원인 없이
        // 영원히 대기하던 걸 막는다(waitGame()의 안전 상한과 같은 목적,
        // 여기는 페이지 내부라 Node의 waitGame()을 그대로 못 쓴다).
        const waitSimOrTimeout = async (target) => {
          const simT = g.simClock
          const wallT0 = performance.now()
          while (g.simClock - simT < target && performance.now() - wallT0 < 5000) await wait(30)
        }

        g.player.sigilGrades.delete('lg_detonator')
        g.player.applySigil('lg_detonator', 'legendary')
        const trioLegendary = spawnChainTrio()
        killDirect(trioLegendary.a)
        await waitSimOrTimeout(0.1)
        out.legendaryBSurvived = trioLegendary.b.alive
        out.legendaryCSurvived = trioLegendary.c.alive

        g.player.applySigil('lg_detonator', 'epic') // legendary→epic, 유효한 승급
        const trioEpic = spawnChainTrio()
        killDirect(trioEpic.a)
        await waitSimOrTimeout(0.1)
        out.epicBSurvived = trioEpic.b.alive
        out.epicCSurvived = trioEpic.c.alive

        g.debugClearEnemies()
        g.player.sigilGrades.clear()
        g.player.recomputeSigilMods() // mods.explodeOnKill/detonatorChain 등을 완전히 초기화 — 위 주석 참고
        return out
      })
      await p.evaluate((result) => { window.__qcSigilGradeResult = result }, r)
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcSigilGradeResult
      if (!r) return '결과 없음'
      if (Math.abs(r.critAfterNormal - 0.08) > 0.001) return `급소 간파 노멀 수치가 다름 (${r.critAfterNormal} / 기대 0.08)`
      if (Math.abs(r.critAfterUnique - 0.15) > 0.001) return `급소 간파 유니크 승급 후 수치가 다름 (${r.critAfterUnique} / 기대 0.15) — 노멀+유니크가 누적됐다면 0.23`
      if (Math.abs(r.critAfterDowngradeAttempt - r.critAfterUnique) > 0.001) return `레어로 강등 시도 후 수치가 바뀜 (${r.critAfterDowngradeAttempt}) — 강등은 무시돼야 한다`
      if (r.gradeAfterDowngradeAttempt !== 'unique') return `강등 시도 후 등급이 유니크로 유지되지 않음 (${r.gradeAfterDowngradeAttempt})`

      if (!(r.reloadTimeNormal < r.reloadTimeBase)) {
        return `신속 장전 노멀 적용 후 장전 시간이 줄지 않음 (기본 ${r.reloadTimeBase.toFixed(3)}, 노멀 ${r.reloadTimeNormal.toFixed(3)})`
      }
      if (!(r.reloadTimeEpic < r.reloadTimeNormal)) {
        return `신속 장전 에픽 장전 시간이 노멀보다 짧지 않음 (노멀 ${r.reloadTimeNormal.toFixed(3)}, 에픽 ${r.reloadTimeEpic.toFixed(3)})`
      }

      if (r.legendaryBSurvived) return '폭심 레전더리 — 직접 처치의 폭발 반경 안(B)인데 죽지 않음'
      if (!r.legendaryCSurvived) return '폭심 레전더리(에픽 아님)인데 연쇄가 일어나 C까지 죽음 — 비에픽은 단발이어야 한다'
      if (r.epicBSurvived) return '폭심 에픽 — 1차 폭발 반경 안(B)인데 죽지 않음'
      if (r.epicCSurvived) return '폭심 에픽인데 연쇄가 일어나지 않아 C가 생존함'

      return null
    }),
  },
  {
    name: 'sigil-p8c4',
    needs: 'dungeon',
    what: '신규 각인 18종(작업 지시 P8c4) — 상충 각인(총구 집중/검날 집중) 상호 무력화, 하이리스크(광전/광전사) 받는 피해 증가·혈탄 체력 소모, 혈흔 단독 작동, 총검일체 전환 판정, 역전 체력 20% 포화, 감전 갱신(비누적), 나머지 신규 각인의 mods 배선',
    async run(p) {
      await dismissLevelUp(p)
      const reset = async () => p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        // 직전 서브테스트의 총알이 다음 적에게 뒤늦게 명중하면 첫 베기
        // 피해 기준값이 오염된다. 각인 동작과 무관한 잔존 발사체를 격리한다.
        g.projectiles.clear()
        g.player.pos.set(0, 0, 0) // 아래 aimAtPoint()가 근처 좌표를 조준하므로 기준점을 고정한다
        g.player.sigilGrades.clear()
        g.player.recomputeSigilMods()
        g.player.hp = g.player.stats.maxHp
        g.player.invuln = 0
        g.player.ammo = g.player.magSize
        g.player.reloading = false
        g.player.gunTimer = 0
        g.player.swordTimer = 0
        // '예비 탄창'(작업 지시 P10) — sigilGrades.clear()로는 안 지워지는
        // 별도 인스턴스 상태다. 이전 서브테스트(배선 스팟체크 포함)에서
        // applySigil('reserve_mag', ...)를 부르면 충전이 1 늘어난 채
        // 남는다 — 매번 여기서 확실히 0으로 되돌린다.
        g.player.reserveMagCharges = 0
      })
      const out = {}

      // ── mods 배선 스팟체크 — 각 신규 각인이 SIGIL_DEFS 수치대로 mods에
      // 반영되는지(스위치문 오타/누락을 잡는다). 등급 하나씩만 표본으로 확인.
      out.wiring = await p.evaluate(() => {
        const g = window.__game
        const chk = (id, grade) => {
          g.player.sigilGrades.clear()
          g.player.recomputeSigilMods()
          g.player.applySigil(id, grade)
          const m = { ...g.player.mods }
          g.player.sigilGrades.clear()
          g.player.recomputeSigilMods()
          return m
        }
        return {
          blood_bullet: chk('blood_bullet', 'epic'),
          overheat: chk('overheat', 'epic'),
          gun_focus: chk('gun_focus', 'epic'),
          shock_bullet: chk('shock_bullet', 'epic'),
          rapid_reload: chk('rapid_reload', 'epic'),
          reserve_mag: chk('reserve_mag', 'legendary'),
          zero_shot: chk('zero_shot', 'epic'),
          berserk_blade: chk('berserk_blade', 'epic'),
          chain_slash: chk('chain_slash', 'epic'),
          sword_focus: chk('sword_focus', 'epic'),
          bleed_blade: chk('bleed_blade', 'epic'),
          blood_trace: chk('blood_trace', 'legendary'),
          execute_blade: chk('execute_blade', 'epic'),
          berserker: chk('berserker', 'epic'),
          reversal: chk('reversal', 'epic'),
          hybrid_stance: chk('hybrid_stance', 'epic'),
          golden_weight: chk('golden_weight', 'epic'),
          remnant: chk('remnant', 'legendary'),
          undaunted: chk('undaunted', 'epic'),
        }
      })

      // ── 상충 각인(총구 집중 × 검날 집중) — 완화 코드 없이 곱셈만으로 서로
      // 거의 무력화하는지(1.45 × 0.70 ≈ 1.015, 완전한 1.0도 배가도 아니다) ──
      await reset()
      out.conflict = await p.evaluate(() => {
        const g = window.__game
        const baseGun = g.player.stats.gunDamage
        const baseSword = g.player.stats.swordDamage
        g.player.applySigil('gun_focus', 'epic')
        g.player.applySigil('sword_focus', 'epic')
        return { gunRatio: g.player.stats.gunDamage / baseGun, swordRatio: g.player.stats.swordDamage / baseSword }
      })

      // ── 하이리스크 대가 — 광전(검): 받는 피해 증가가 takeDamage()에 실제
      // 적용되는지. 혈탄(총): 발사할 때마다 체력이 실제로 줄어드는지 ──
      await reset()
      out.berserkBladeDamageTaken = await p.evaluate(() => {
        const g = window.__game
        g.player.applySigil('berserk_blade', 'epic')
        g.player.hp = 100
        g.player.takeDamage(10)
        return g.player.hp // 기대: 100 - 10*1.30 = 87
      })
      await reset()
      await p.evaluate(() => {
        window.__game.player.applySigil('blood_bullet', 'epic')
        window.__game.player.hp = 50
      })
      out.hpBeforeShot = await p.evaluate(() => window.__game.player.hp)
      await aimAtPoint(p, 0, 5) // 빈 공간 — 명중 여부와 무관하게 발사 자체의 체력 소모만 본다
      await p.mouse.down()
      // waitGame()(Node↔브라우저 왕복 폴링)은 gunCooldown(0.15게임초)처럼 좁은
      // 창에서 왕복 지연 자체가 목표 시간을 넘겨버려 총알이 의도치 않게 2발
      // 나갈 수 있다(QC로 실제 재현 — 체력 소모가 기대의 정확히 2배로 찍힘,
      // reload-rhythm 스텝의 리듬 창 검증과 같은 이유). 탄약이 정확히 1발
      // 줄어드는 순간까지만 페이지 내부 rAF로 기다려 왕복을 없앤다.
      await waitUntilPage(p, '(g) => g.player.ammo < g.player.magSize')
      await p.mouse.up()
      out.hpAfterShot = await p.evaluate(() => window.__game.player.hp) // 기대: 50 - 2.5

      // ── 광전사(하이리스크) — 최대 체력 감소 + 모든 피해 증가가 함께 적용 ──
      await reset()
      out.berserker = await p.evaluate(() => {
        const g = window.__game
        const baseMaxHp = g.player.stats.maxHp
        const baseGunDamage = g.player.stats.gunDamage
        g.player.applySigil('berserker', 'epic')
        return { maxHpRatio: g.player.stats.maxHp / baseMaxHp, gunDamageRatio: g.player.stats.gunDamage / baseGunDamage }
      })

      // ── 혈흔(고유·레전더리) — 출혈 칼날 없이 단독 작동 + 재적중 시 잔여
      // 피해 폭발(중첩되지 않고 항상 1중첩으로 리프레시) ──
      await reset()
      const bt = await p.evaluate(() => {
        const g = window.__game
        g.player.applySigil('blood_trace', 'legendary')
        g.player.mods.critChance = -1 // 크리티컬 변동을 없애 피해량을 결정론적으로 만든다
        g.player.recompute()
        const e = g.debugSpawnEnemy('brute')
        e.pos.set(g.player.pos.x, 0, g.player.pos.z + 2)
        return { ex: e.pos.x, ez: e.pos.z, hp0: e.hp }
      })
      await aimAtPoint(p, bt.ex, bt.ez)
      await p.evaluate(() => { window.__game.player.swordTimer = 0 })
      await p.mouse.down({ button: 'right' })
      await waitGame(p, 0.05)
      await p.mouse.up({ button: 'right' })
      const afterHit1 = await p.evaluate(() => {
        const e = window.__game.enemies[0]
        return { hp: e.hp, bleeding: e.bleeding, stacks: e.bleedStackCount }
      })
      await p.evaluate(() => { window.__game.player.swordTimer = 0 })
      await p.mouse.down({ button: 'right' })
      await waitGame(p, 0.05)
      await p.mouse.up({ button: 'right' })
      const afterHit2 = await p.evaluate(() => {
        const e = window.__game.enemies[0]
        return { hp: e.hp, bleeding: e.bleeding, stacks: e.bleedStackCount }
      })
      out.bloodTrace = { hp0: bt.hp0, afterHit1, afterHit2, delta1: bt.hp0 - afterHit1.hp, delta2: afterHit1.hp - afterHit2.hp }

      // ── 총검일체 — "마지막으로 사용한 무기가 바뀌는 순간"만 버프 트리거
      // (총→총, 아무것도→총 은 전환이 아니다) ──
      await reset()
      await p.evaluate(() => {
        const g = window.__game
        g.player.applySigil('hybrid_stance', 'legendary') // duration 2.5
        g.player.lastWeaponUsed = null
      })
      await aimAtPoint(p, 0, 5)
      await p.mouse.down()
      await waitUntilPage(p, '(g) => g.player.ammo < g.player.magSize')
      await p.mouse.up()
      out.hybridAfterFirstShot = await p.evaluate(() => window.__game.player.hybridStanceTimer) // 기대: 0(전환 아님)
      await p.evaluate(() => { window.__game.player.swordTimer = 0 })
      await p.mouse.down({ button: 'right' })
      await waitGame(p, 0.05)
      await p.mouse.up({ button: 'right' })
      out.hybridAfterSwitch = await p.evaluate(() => window.__game.player.hybridStanceTimer) // 기대: >0(총→검 전환)

      // ── 역전 — 체력 20% 이하에서 포화(그 이하로 낮춰도 더 오르지 않음) ──
      await reset()
      const reversalBase = await p.evaluate(() => {
        const g = window.__game
        g.player.applySigil('reversal', 'legendary') // maxDmgFrac 0.36
        g.player.hp = g.player.stats.maxHp
        g.player.recompute()
        return g.player.stats.gunDamage
      })
      const at50 = await p.evaluate(() => {
        const g = window.__game
        g.player.hp = g.player.stats.maxHp * 0.5
        g.player.recompute()
        return g.player.stats.gunDamage
      })
      const at20 = await p.evaluate(() => {
        const g = window.__game
        g.player.hp = g.player.stats.maxHp * 0.2
        g.player.recompute()
        return g.player.stats.gunDamage
      })
      const at5 = await p.evaluate(() => {
        const g = window.__game
        g.player.hp = g.player.stats.maxHp * 0.05
        g.player.recompute()
        return g.player.stats.gunDamage
      })
      out.reversal = { base: reversalBase, at50, at20, at5 }

      // ── 감전 — 연사(짧은 간격으로 여러 번 재적용)해도 지속시간이 갱신될
      // 뿐 누적되지 않는다(기관단총처럼 초당 14발이어도 영구 감전이 안 된다) ──
      await reset()
      out.shockRefresh = await p.evaluate(() => {
        const g = window.__game
        const e = g.debugSpawnEnemy('imp')
        e.applyShock(2)
        e.applyShock(2)
        e.applyShock(2) // 연사 3회를 흉내
        return { shockTimer: e.shockTimer, stunned: e.stunned, shocked: e.shocked }
      })

      // ── 예비 탄창 — 획득 즉시 충전 1, 충전 소모로 재장전 즉시 완료,
      // 충전이 없으면 평범한 재장전으로 대체 ──
      await reset()
      out.reserveMag = await p.evaluate(() => {
        const g = window.__game
        g.player.applySigil('reserve_mag', 'legendary') // 획득 즉시 충전 1
        const chargesAfterAcquire = g.player.reserveMagChargesLeft
        g.player.ammo = 0
        g.player.reloading = false
        g.player.startReload() // 충전 소모 — 즉시 완료
        const instantAmmo = g.player.ammo
        const instantReloading = g.player.reloading
        const chargesAfterUse = g.player.reserveMagChargesLeft
        g.player.ammo = 0
        g.player.reloading = false
        g.player.startReload() // 충전 없음 — 평범한 재장전
        return { chargesAfterAcquire, instantAmmo, instantReloading, chargesAfterUse, normalReloading: g.player.reloading }
      })

      // ── 속사 전환 — 재장전 완료 직후 사격 쿨타임이 실제로 줄어드는지 ──
      await reset()
      out.rapidReload = await p.evaluate(() => {
        const g = window.__game
        g.player.applySigil('rapid_reload', 'epic') // duration 3.5, cutFrac 0.45
        const baseCooldown = g.player.stats.gunCooldown
        g.player.rapidReloadTimer = 3.5 // onReloadComplete()가 하는 일을 직접 흉내
        g.player.recompute()
        return { baseCooldown, reducedCooldown: g.player.stats.gunCooldown }
      })

      // ── 불굴 — 받는 피해 증가 적용 후 최대 체력 20%로 상한, 무적은 아님 ──
      await reset()
      out.undaunted = await p.evaluate(() => {
        const g = window.__game
        g.player.applySigil('undaunted', 'epic') // capFrac 0.20
        g.player.hp = g.player.stats.maxHp
        g.player.invuln = 0
        g.player.takeDamage(100000) // 상한이 없다면 즉사할 만큼 큰 피해
        return { hpAfter: g.player.hp, maxHp: g.player.stats.maxHp, alive: g.player.alive }
      })

      await reset()
      await p.evaluate((result) => { window.__qcSigilP8c4Result = result }, out)
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcSigilP8c4Result
      if (!r) return '결과 없음'

      // 배선 스팟체크
      const w = r.wiring
      if (Math.abs(w.blood_bullet.gunDamage - 1.55) > 0.01) return `혈탄 에픽 총 피해 배율이 다름 (${w.blood_bullet.gunDamage} / 기대 1.55)`
      if (Math.abs(w.blood_bullet.hpCostPerShot - 2.5) > 0.01) return `혈탄 에픽 발사당 체력 소모가 다름 (${w.blood_bullet.hpCostPerShot} / 기대 2.5)`
      if (Math.abs(w.overheat.overheatStackFrac - 0.04) > 0.001 || w.overheat.overheatMaxStacks !== 10) return `과열 에픽 스택 파라미터가 다름`
      if (Math.abs(w.gun_focus.gunDamage - 1.45) > 0.01 || Math.abs(w.gun_focus.swordDamage - 0.70) > 0.01) return `총구 집중 에픽 배율이 다름`
      if (Math.abs(w.shock_bullet.shockOnHitChance - 0.85) > 0.001 || Math.abs(w.shock_bullet.shockOnHitDuration - 3.0) > 0.001) return `감전 탄환 에픽 파라미터가 다름`
      if (Math.abs(w.rapid_reload.rapidReloadDuration - 3.5) > 0.01 || Math.abs(w.rapid_reload.rapidReloadCutFrac - 0.45) > 0.01) return `속사 전환 에픽 파라미터가 다름`
      if (!w.reserve_mag.reserveMagOwned || w.reserve_mag.reserveMagMaxCharges !== 3) return `예비 탄창 파라미터가 다름`
      if (Math.abs(w.zero_shot.zeroShotPerSecond - 0.08) > 0.001 || Math.abs(w.zero_shot.zeroShotCap - 0.40) > 0.001) return `영점 사격 파라미터가 다름`
      if (Math.abs(w.berserk_blade.swordDamage - 1.55) > 0.01 || Math.abs(w.berserk_blade.damageTakenMult - 1.30) > 0.01) return `광전 에픽 배율이 다름`
      if (Math.abs(w.chain_slash.chainSlashCutFrac - 0.05) > 0.001 || w.chain_slash.chainSlashMaxStacks !== 10) return `연참 가속 에픽 파라미터가 다름`
      if (Math.abs(w.sword_focus.swordDamage - 1.45) > 0.01 || Math.abs(w.sword_focus.gunDamage - 0.70) > 0.01) return `검날 집중 에픽 배율이 다름`
      if (w.bleed_blade.bleedOnHitStacks !== 3) return `출혈 칼날 에픽 중첩 수가 다름 (${w.bleed_blade.bleedOnHitStacks} / 기대 3)`
      if (!w.blood_trace.bloodTraceOwned) return `혈흔 소유 플래그가 안 켜짐`
      if (!w.execute_blade.executeBladeOwned || Math.abs(w.execute_blade.executeThreshold - 0.30) > 0.001 || Math.abs(w.execute_blade.executeBossFrac - 0.06) > 0.001) return `일도양단 파라미터가 다름`
      if (Math.abs(w.berserker.maxHpMult - 0.70) > 0.01 || Math.abs(w.berserker.damageTakenMult - 1.28) > 0.01 || Math.abs(w.berserker.allDamageMult - 1.38) > 0.01) return `광전사 에픽 배율이 다름`
      if (Math.abs(w.reversal.reversalMaxDmgFrac - 0.48) > 0.01 || Math.abs(w.reversal.reversalMaxSpeedFrac - 0.32) > 0.01) return `역전 에픽 파라미터가 다름`
      if (Math.abs(w.hybrid_stance.hybridStanceDuration - 3.0) > 0.01 || Math.abs(w.hybrid_stance.hybridStanceDmgFrac - 0.48) > 0.01) return `총검일체 에픽 파라미터가 다름`
      if (Math.abs(w.golden_weight.goldWeightRate - 0.03) > 0.001 || Math.abs(w.golden_weight.goldWeightCap - 0.50) > 0.001) return `황금의 무게 에픽 파라미터가 다름`
      if (!w.remnant.remnantOwned || Math.abs(w.remnant.remnantDmgFrac - 0.5) > 0.01) return `잔재 파라미터가 다름`
      if (!w.undaunted.undauntedOwned || Math.abs(w.undaunted.undauntedCapFrac - 0.20) > 0.01) return `불굴 파라미터가 다름`

      // 상충 각인
      if (!(r.conflict.gunRatio > 0.95 && r.conflict.gunRatio < 1.1)) return `총구 집중+검날 집중 동시 보유 시 총 피해 배율이 거의 상쇄되지 않음 (${r.conflict.gunRatio.toFixed(3)} / 기대 약 1.015, 참고: 절반씩 보정 같은 완화 로직이 있으면 안 됨)`
      if (!(r.conflict.swordRatio > 0.95 && r.conflict.swordRatio < 1.1)) return `총구 집중+검날 집중 동시 보유 시 검 피해 배율이 거의 상쇄되지 않음 (${r.conflict.swordRatio.toFixed(3)} / 기대 약 1.015)`

      // 하이리스크 대가
      if (Math.abs(r.berserkBladeDamageTaken - 87) > 0.5) return `광전 에픽 보유 중 받는 피해 증가가 실제로 적용되지 않음 (100→${r.berserkBladeDamageTaken} / 기대 87)`
      const hpDropped = r.hpBeforeShot - r.hpAfterShot
      if (Math.abs(hpDropped - 2.5) > 0.3) return `혈탄 에픽 — 발사 1회당 체력 소모가 기대(2.5)와 다름 (${hpDropped.toFixed(2)})`
      if (!(r.berserker.maxHpRatio < 0.75 && r.berserker.maxHpRatio > 0.65)) return `광전사 에픽 최대 체력 감소가 적용되지 않음 (배율 ${r.berserker.maxHpRatio.toFixed(3)} / 기대 약 0.70)`
      if (!(r.berserker.gunDamageRatio > 1.3 && r.berserker.gunDamageRatio < 1.45)) return `광전사 에픽 "모든 피해 증가"가 총 피해에 적용되지 않음 (배율 ${r.berserker.gunDamageRatio.toFixed(3)} / 기대 약 1.38)`

      // 혈흔 단독 작동
      const bt = r.bloodTrace
      if (!bt.afterHit1.bleeding || bt.afterHit1.stacks !== 1) return `혈흔 — 출혈 칼날 없이 단독으로 출혈을 걸지 못함(1타 후 stacks=${bt.afterHit1.stacks})`
      if (bt.afterHit2.stacks !== 1) return `혈흔 — 재적중 후에도 출혈 스택은 항상 1이어야 함(폭발+리프레시, 중첩 아님) — 실제 ${bt.afterHit2.stacks}`
      if (!(bt.delta2 > bt.delta1 * 1.15)) return `혈흔 — 이미 출혈 중인 적을 다시 베었을 때 잔여 피해 폭발이 감지되지 않음 (1타 ${bt.delta1.toFixed(1)}, 2타 ${bt.delta2.toFixed(1)})`

      // 총검일체 전환 판정
      if (r.hybridAfterFirstShot > 0.01) return `총검일체 — 최초 발사(아무 무기도 안 쓴 상태→총)인데 버프가 발동함, "전환"이 아니어야 한다`
      if (!(r.hybridAfterSwitch > 2.0)) return `총검일체 — 총→검으로 실제 전환했는데 버프가 발동하지 않음 (타이머 ${r.hybridAfterSwitch})`

      // 역전 포화
      const rv = r.reversal
      if (Math.abs(rv.base - 1) > 0.001 && false) { /* base는 gunDamage 절대값이라 비율 비교로 대체 */ }
      const ratio50 = rv.at50 / rv.base
      const ratio20 = rv.at20 / rv.base
      const ratio5 = rv.at5 / rv.base
      if (!(ratio50 > 1.1 && ratio50 < ratio20)) return `역전 — 체력 50%의 보너스가 20%보다 작아야 하는데 그렇지 않음 (50%:${ratio50.toFixed(3)}, 20%:${ratio20.toFixed(3)})`
      if (Math.abs(ratio20 - 1.36) > 0.02) return `역전 — 체력 20%에서 최대 보너스(+36%)에 도달하지 않음 (${ratio20.toFixed(3)})`
      if (Math.abs(ratio5 - ratio20) > 0.01) return `역전 — 체력 5%가 20%보다 보너스가 더 커짐(포화되지 않음, 20%:${ratio20.toFixed(3)}, 5%:${ratio5.toFixed(3)})`

      // 감전 갱신(비누적)
      if (Math.abs(r.shockRefresh.shockTimer - 2) > 0.05) return `감전 — 연사로 3회 재적용했는데 지속시간이 갱신이 아니라 누적됨(${r.shockRefresh.shockTimer} / 기대 2, 3배면 6)`
      if (r.shockRefresh.stunned) return `감전이 경직(행동 정지)을 유발함 — 감전은 받는 피해 증가만이어야 하고 기절과 달라야 한다`
      if (!r.shockRefresh.shocked) return '감전이 적용되지 않음'

      // 예비 탄창 — 획득 즉시 충전 1, 소모 시 즉시 완료, 소진 후엔 평범한 재장전
      const rm = r.reserveMag
      if (rm.chargesAfterAcquire !== 1) return `예비 탄창 — 획득 즉시 충전이 1이 아님 (${rm.chargesAfterAcquire})`
      if (rm.instantReloading) return '예비 탄창 — 충전 소모 시 재장전이 즉시 완료되지 않음(reloading이 여전히 true)'
      if (rm.instantAmmo !== 7) return `예비 탄창 — 충전 소모 후 탄약이 가득 차지 않음 (${rm.instantAmmo})`
      if (rm.chargesAfterUse !== 0) return `예비 탄창 — 사용 후 충전이 줄지 않음 (${rm.chargesAfterUse})`
      if (!rm.normalReloading) return '예비 탄창 — 충전 소진 후에도 평범한 재장전으로 대체되지 않음'

      // 속사 전환 — 재장전 완료 직후 사격 쿨타임이 실제로 줄어드는지
      const rr = r.rapidReload
      const rrRatio = rr.reducedCooldown / rr.baseCooldown
      if (Math.abs(rrRatio - 0.55) > 0.02) return `속사 전환 에픽 — 사격 쿨타임 감소가 기대(-45%)와 다름 (배율 ${rrRatio.toFixed(3)})`

      // 불굴 — 받는 피해가 최대 체력의 20%로 상한되지만 무적은 아님(즉사하지 않되 hp가 깎임)
      const ud = r.undaunted
      if (Math.abs(ud.hpAfter - ud.maxHp * 0.8) > 0.5) return `불굴 — 받는 피해 상한이 적용되지 않음 (100000 피해 후 hp ${ud.hpAfter} / 기대 ${(ud.maxHp * 0.8).toFixed(1)})`
      if (!ud.alive) return '불굴 — 상한이 적용됐어야 하는데 사망함(무적이 아니라 상한이므로 큰 피해라도 20%로 깎여 죽지 않아야 한다)'

      return null
    }),
  },
  {
    name: 'conflict-triple',
    needs: 'dungeon',
    what: '상충 각인 3종 실제 피해 배수(작업 지시 P10 커밋3-4) — 총구 집중×검날 집중(곱셈, 서로 거의 상쇄)· 총검일체 추가(별도 배율 계층, 덧셈 항) 조합 3가지',
    async run(p) {
      await dismissLevelUp(p)
      const out = await p.evaluate(() => {
        const g = window.__game
        const reset = () => {
          g.player.sigilGrades.clear()
          g.player.recomputeSigilMods()
          g.player.hybridStanceTimer = 0
        }
        // 1. 총구 집중 단독(에픽) — 총 +45%, 검 -30%
        reset()
        g.player.applySigil('gun_focus', 'epic')
        g.player.recompute()
        const gunOnly = { gunDamage: g.player.stats.gunDamage, swordDamage: g.player.stats.swordDamage }

        // 2. 총구 집중 × 검날 집중(둘 다 에픽) — m.gunDamage/m.swordDamage에
        // 곱셈으로 누적(1.45×0.70=1.015, 순서 무관)
        reset()
        g.player.applySigil('gun_focus', 'epic')
        g.player.applySigil('sword_focus', 'epic')
        g.player.recompute()
        const gunSword = { gunDamage: g.player.stats.gunDamage, swordDamage: g.player.stats.swordDamage }

        // 3. 위 둘 + 총검일체 발동(에픽, dmgFrac 0.48) — dynamicAllMult에
        // 덧셈으로 들어가는 별도 배율 계층이라 위 곱셈 결과에 다시 곱해진다
        reset()
        g.player.applySigil('gun_focus', 'epic')
        g.player.applySigil('sword_focus', 'epic')
        g.player.applySigil('hybrid_stance', 'epic')
        g.player.recompute()
        g.player.hybridStanceTimer = 3.0
        g.player.updateDynamicStats() // private — TS 컴파일 타임 전용, 런타임엔 그냥 메서드
        const triple = { gunDamage: g.player.stats.gunDamage, swordDamage: g.player.stats.swordDamage }

        reset()
        g.player.recompute()
        const base = { gunDamage: g.player.stats.gunDamage, swordDamage: g.player.stats.swordDamage }
        return { base, gunOnly, gunSword, triple }
      })
      await p.evaluate((result) => { window.__qcConflictTriple = result }, out)
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcConflictTriple
      if (!r) return '결과 없음'
      const gunOnlyRatio = r.gunOnly.gunDamage / r.base.gunDamage
      if (Math.abs(gunOnlyRatio - 1.45) > 0.02) return `총구 집중 단독 배율이 다름 (${gunOnlyRatio.toFixed(3)} / 기대 1.45)`
      const gunSwordGunRatio = r.gunSword.gunDamage / r.base.gunDamage
      const gunSwordSwordRatio = r.gunSword.swordDamage / r.base.swordDamage
      if (Math.abs(gunSwordGunRatio - 1.015) > 0.02) return `총구+검날 집중 동시 보유 시 총 피해 배율이 곱셈(1.45×0.70=1.015)과 다름 (${gunSwordGunRatio.toFixed(3)})`
      if (Math.abs(gunSwordSwordRatio - 1.015) > 0.02) return `총구+검날 집중 동시 보유 시 검 피해 배율이 곱셈(1.45×0.70=1.015)과 다름 (${gunSwordSwordRatio.toFixed(3)})`
      const tripleGunRatio = r.triple.gunDamage / r.base.gunDamage
      const tripleSwordRatio = r.triple.swordDamage / r.base.swordDamage
      // 기대: 1.015 × (1+0.48) ≈ 1.502 — 곱셈(총구×검날)에 총검일체의
      // 덧셈 배율 계층이 다시 곱해지는 형태(위 recomputeSigilMods() 주석 참고)
      if (Math.abs(tripleGunRatio - 1.502) > 0.03) return `상충 3종(총구+검날+총검일체) 동시 보유 시 총 피해 배율이 기대(약 1.502)와 다름 (${tripleGunRatio.toFixed(3)})`
      if (Math.abs(tripleSwordRatio - 1.502) > 0.03) return `상충 3종 동시 보유 시 검 피해 배율이 기대(약 1.502)와 다름 (${tripleSwordRatio.toFixed(3)})`
      return null
    }),
  },
  {
    name: 'elite-ward-thorns',
    needs: 'dungeon',
    what: '엘리트 접두사 — 보호막(피격 흡수) / 가시(근접 반사 25%)',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        const ward = g.debugSpawnElite('imp', 'ward')
        window.__qcWardBefore = { hp: ward.hp, shield: ward.shield, maxShield: ward.maxShield }
        ward.takeDamage(5, 'melee')
        window.__qcWardAfter = { hp: ward.hp, shield: ward.shield }

        const thorns = g.debugSpawnElite('brute', 'thorns')
        window.__qcThornsReflect = thorns.takeDamage(20, 'melee')
      })
      await p.waitForTimeout(150) // 보호막 실드 바가 체력바 위에 뜬 상태로 캡처
    },
    check: async (p) => {
      const r = await p.evaluate(() => ({ before: window.__qcWardBefore, after: window.__qcWardAfter, thornsReflect: window.__qcThornsReflect }))
      if (r.before.shield !== r.before.maxShield) return `보호막 스폰 직후 실드가 최대치가 아님 (${r.before.shield}/${r.before.maxShield})`
      if (r.after.hp !== r.before.hp) return `실드가 남아있는데 체력이 깎임 (흡수 전:${r.before.hp} 후:${r.after.hp})`
      if (r.after.shield !== r.before.shield - 5) return `실드 차감량이 안 맞음 (기대 -5, 실제 ${r.before.shield}→${r.after.shield})`
      if (r.thornsReflect !== 5) return `가시 반사량이 기대(20×0.25=5)와 다름: ${r.thornsReflect}`
      return null
    },
  },
  {
    name: 'elite-regen',
    needs: 'dungeon',
    what: '엘리트 접두사 — 재생(피격 후 2초 지연, 초당 최대체력 3% 회복)',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        const regen = g.debugSpawnElite('brute', 'regen')
        regen.takeDamage(regen.maxHp * 0.6, 'melee')
        window.__qcRegenAfterHit = regen.hp
      })
      await waitGame(p, 2.6) // 지연(2s) + 회복 틱 1회 — check()가 회복량을 검증
    },
    check: async (p) => {
      const r = await p.evaluate(() => {
        const regen = window.__game.enemies.find((e) => e.affix === 'regen')
        return { after: window.__qcRegenAfterHit, now: regen?.hp, maxHp: regen?.maxHp }
      })
      if (r.now == null) return '재생 엘리트가 사라짐'
      if (r.now <= r.after) return `2.6초 경과했는데 체력이 회복 안 됨 (${r.after} → ${r.now})`
      if (r.now > r.maxHp) return `체력이 최대치를 넘어감 (${r.now} > ${r.maxHp})`
      return null
    },
  },
  {
    name: 'elite-split-volatile-swift',
    needs: 'dungeon',
    what: '엘리트 접두사 — 분열(사망 시 자식 2) / 폭발(사망 시 광역) / 신속(이동속도↑)',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        // 이전 전투에서 남은 경험치 구슬이 이 단계 중 레벨업 모달을 열어
        // 시뮬레이션 시계를 멈추지 않도록 이벤트형 접두사만 격리한다.
        g.pickups.clear()
        g.state = 'play'

        // 신속 비교용 대조군 — thorns는 speed를 건드리지 않으므로 기준선으로 쓴다
        const normal = g.debugSpawnElite('imp', 'thorns')
        window.__qcNormalSpeed = normal.speed
        const swift = g.debugSpawnElite('imp', 'swift')
        window.__qcSwiftSpeed = swift.speed

        g.player.invuln = 0 // 직전 실제 접촉 피해로 무적창이 남아있으면 폭발 피해가 막힌다
        window.__qcPlayerHpBefore = g.player.hp
        const volatile_ = g.debugSpawnElite('imp', 'volatile')
        volatile_.pos.x = g.player.pos.x
        volatile_.pos.z = g.player.pos.z - 1
        volatile_.hp = 1
        volatile_.takeDamage(999, 'melee')

        const split = g.debugSpawnElite('imp', 'split')
        split.pos.x = g.player.pos.x + 3
        split.pos.z = g.player.pos.z
        split.hp = 1
        split.takeDamage(999, 'melee')
      })
      // killEnemy()(분열 자식 생성, 폭발 피해)는 takeDamage()가 아니라 step()의
      // 사망 처리 루프에서 실행된다 — check()가 그 결과를 보려면 최소 한 프레임의
      // 시뮬레이션이 진행돼야 한다.
      await waitGame(p, 0.25)
    },
    check: async (p) => {
      const r = await p.evaluate(() => {
        const g = window.__game
        return {
          normalSpeed: window.__qcNormalSpeed,
          swiftSpeed: window.__qcSwiftSpeed,
          playerHpBefore: window.__qcPlayerHpBefore,
          playerHpAfter: g.player.hp,
          // 분열 자식은 kind가 부모와 같고(imp) 접두사를 물려받지 않는다 — 이 스텝의
          // 다른 두 대조용 개체(normal/swift)는 둘 다 affix가 있어 걸러진다. 예전엔
          // e.xp === 0도 함께 검사했지만 경험치 체계 자체가 폐지됐다(작업 지시 P7 커밋1).
          splitChildren: g.enemies.filter((e) => e.kind === 'imp' && !e.affix).length,
        }
      })
      if (r.swiftSpeed <= r.normalSpeed) return `신속 접두사인데 속도가 더 안 빠름 (일반:${r.normalSpeed} 신속:${r.swiftSpeed})`
      if (r.playerHpAfter >= r.playerHpBefore) return `폭발 접두사 사망 후 플레이어 피해 없음 (${r.playerHpBefore} → ${r.playerHpAfter})`
      if (r.splitChildren !== 2) return `분열 자식 수가 2가 아님 (실제 ${r.splitChildren})`
      return null
    },
  },
  {
    name: 'run-reset',
    what: '런 상태 초기화 — 마을 복귀 시 특성/골드 초기화, 시작 특성 제단 재사용 가능, 메타 성장·무기 해금은 유지',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        // 던전을 뛰어 쌓일 런 범위 상태를 결정적으로 채워둔 뒤, 스테이지
        // 클리어 화면의 '계속하기' 버튼이 호출하는 것과 동일한 enterTown()을
        // 직접 불러 마을 복귀 시점의 리셋 경계를 검증한다. 경험치/레벨은
        // 작업 지시 P7 커밋1에서 폐지됐다 — 남은 런 범위 상태만 검증한다.
        g.player.applySigil('qc-test-trait', 'normal')
        g.run.addGold(500)
        g.startingTraitTaken = true
        g.traitForgeUsed = true
        window.__qcMetaBefore = JSON.stringify(g.meta.snapshot)
        g.enterTown()
      })
      await p.waitForTimeout(300)
    },
    check: async (p) => {
      return p.evaluate(() => {
        const g = window.__game
        if (g.player.sigilGrades.size !== 0) return `각인 등급이 초기화되지 않음 (${g.player.sigilGrades.size}개 남음)`
        if (g.run.gold !== 0) return `골드가 초기화되지 않음 (${g.run.gold})`
        if (g.startingTraitTaken !== false) return '시작 특성 제단이 다시 사용 가능한 상태가 아님'
        if (g.traitForgeUsed !== false) return '제련소 런당 1회 플래그가 초기화되지 않음'
        if (JSON.stringify(g.meta.snapshot) !== window.__qcMetaBefore) return '메타 성장/무기 해금이 마을 복귀로 초기화됨'
        return null
      })
    },
  },
  {
    name: 'shop-persist',
    what: '상점 재고 유지 — QC 내부 재로드 뒤에도 구매/판매/리롤 상태가 유지되고 상점·보스 준비방 재고가 서로 독립',
    async run(p) {
      await dismissLevelUp(p)
      const err = await p.evaluate(() => {
        const g = window.__game
        g.enterDungeon() // run.reset(1)을 내부에서 호출하므로 골드는 반드시 이 다음에 채운다
        g.run.addGold(99999)
        const rooms = g.run.minimap()
        const shopRoom = rooms.find((r) => r.kind === 'shop')
        const restRoom = rooms.find((r) => r.kind === 'rest')
        if (!shopRoom || !restRoom) return '상점방 또는 보스 준비방을 찾지 못함'

        // 실제 맵은 이전 깊이로 되돌아갈 수 없다. 이 시나리오는 이동 검사가
        // 아니라 방별 Shop 인스턴스 지속성 검사이므로 QC 전용 직접 로드 훅을 쓴다.
        if (!g.debugLoadRoom(shopRoom.id)) return '상점방 직접 로드 실패'
        g.openShop()
        g.rerollShop() // 리롤 먼저 — 구매 후 리롤하면 재고 자체가 새로 생성돼 방금 산 항목의 sold가 사라지는 게 정상 동작이라 순서를 바꿔 검증한다
        g.buyShopItem(0)
        const shopA = g.shopRooms.get(shopRoom.id)
        window.__qcShopBefore = { sold: shopA.items.map((it) => it.sold), rerollCount: shopA.rerollCount, items: shopA.items.length }
        g.closeShop()

        if (!g.debugLoadRoom(restRoom.id)) return '보스 준비방 직접 로드 실패'
        const shopRest = g.shopRooms.get(restRoom.id)
        window.__qcRestShop = { sold: shopRest.items.map((it) => it.sold), rerollCount: shopRest.rerollCount }

        if (!g.debugLoadRoom(shopRoom.id)) return '상점방 재로드 실패'
        window.__qcShopIds = { shop: shopRoom.id, rest: restRoom.id }
        return null
      })
      if (err) throw new Error(err)
      await p.waitForTimeout(200)
    },
    check: async (p) => {
      return p.evaluate(() => {
        const g = window.__game
        const ids = window.__qcShopIds
        const before = window.__qcShopBefore
        const restShop = window.__qcRestShop
        const shopNow = g.shopRooms.get(ids.shop)
        if (!shopNow) return '상점방 재고가 사라짐'
        const soldNow = shopNow.items.map((it) => it.sold)
        if (JSON.stringify(soldNow) !== JSON.stringify(before.sold)) return `상점 재복귀 시 판매 상태가 초기화됨 (${JSON.stringify(before.sold)} → ${JSON.stringify(soldNow)})`
        if (shopNow.rerollCount !== before.rerollCount) return `상점 재복귀 시 리롤 횟수가 초기화됨 (${before.rerollCount} → ${shopNow.rerollCount})`
        if (!before.sold.includes(true)) return '구매가 반영되지 않음 (sold 항목 없음)'
        const restShopNow = g.shopRooms.get(ids.rest)
        if (!restShopNow) return '보스 준비방 재고가 사라짐'
        if (restShopNow.rerollCount !== restShop.rerollCount) return '보스 준비방 재고가 상점방 방문의 영향을 받음'
        if (restShopNow.items.map((it) => it.sold).some((v) => v)) return '보스 준비방 재고가 상점방과 독립적이지 않음 (구매하지 않았는데 sold)'
        return null
      })
    },
  },
  {
    name: 'trait-panel-axis',
    what: '보유 각인 패널 축별 재구성(작업 지시 P8c4 커밋2) — 총/검/캐릭터 3섹션(핵심 슬롯 1개 + 그 축 각인, 등급순), 항목별 축 라벨 제거, 빈 축은 "각인 없음", 각인 26종을 전부 보유해도 패널이 화면을 넘지 않는가',
    async run(p) {
      const r = await p.evaluate(() => {
        const g = window.__game
        // POOL은 window에 노출돼 있지 않다 — trait-slot-badges 스텝과 같은
        // 관례로, 패널이 실제로 소비하는 필드(id/name/desc/icon/slot/grade)만
        // 갖춘 리터럴 객체를 직접 만든다. 핵심 슬롯은 축당 1개만 가질 수
        // 있으므로 3개, 각인은 26종(작업 지시 P10c2로 완성된 전체 명단) 전부.
        const core = [
          { id: 'close_range', name: '밀착사격', desc: '', icon: '🔫', slot: 'gun', apply: () => {} },
          { id: 'iaijutsu', name: '발도참', desc: '', icon: '🌸', slot: 'sword', apply: () => {} },
          { id: 'mark', name: '표식', desc: '', icon: '🏷️', slot: 'character', apply: () => {} },
        ]
        const sigilIds = {
          'gun-sigil': ['reload', 'crit', 'blood_bullet', 'overheat', 'gun_focus', 'shock_bullet', 'rapid_reload', 'reserve_mag', 'zero_shot'],
          'sword-sigil': ['crit_dmg', 'lifesteal', 'berserk_blade', 'chain_slash', 'sword_focus', 'bleed_blade', 'blood_trace', 'execute_blade'],
          'character-sigil': ['hp', 'speed', 'lg_detonator', 'berserker', 'reversal', 'hybrid_stance', 'golden_weight', 'remnant', 'undaunted'],
        }
        const grades = ['normal', 'rare', 'unique', 'legendary', 'epic']
        const sigils = []
        for (const [slot, ids] of Object.entries(sigilIds)) {
          ids.forEach((id, i) => sigils.push({ id, name: id, desc: `${id} 설명`, icon: '✨', slot, grade: grades[i % grades.length], apply: () => {} }))
        }
        const traits = [...core, ...sigils].map((upgrade) => ({ upgrade, count: 1 }))
        g.hud.openSettings(
          traits,
          { master: 1, music: 1, sfx: 1 },
          { gun: g.player.gun.name, gunIcon: g.player.gun.icon, sword: g.player.sword.name, swordIcon: g.player.sword.icon },
          true,
          g.input.keyBindings,
        )
        const box = document.querySelector('#traits')
        const heads = [...box.querySelectorAll('.trait-axis-head')].map((el) => el.textContent)
        const sections = [...box.querySelectorAll('.trait-section')].map((sec) => ({
          head: sec.querySelector('.trait-axis-head')?.textContent,
          rows: sec.querySelectorAll('.trait').length,
          hasEmptyLabel: !!sec.querySelector('.trait-axis-sigil-empty'),
          hasTslot: sec.querySelectorAll('.tslot').length, // 항목별 축 라벨은 제거됐어야 한다
        }))
        const panel = document.querySelector('.settings-panel')
        const panelRect = panel.getBoundingClientRect()
        return {
          heads,
          sections,
          totalRows: box.querySelectorAll('.trait').length,
          panelWithinViewport: panelRect.bottom <= window.innerHeight + 1 && panelRect.top >= -1,
          panelScrollable: panel.scrollHeight > panel.clientHeight,
        }
      })
      await p.screenshot({ path: 'qc-out/trait-panel-axis-full.png' })
      await p.evaluate(() => window.__game.hud.closeSettings())
      await p.evaluate((result) => { window.__qcTraitPanelAxis = result }, r)
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcTraitPanelAxis
      if (!r) return '결과 없음'
      if (r.heads.join(',') !== '총,검,캐릭터') return `축 섹션 순서/이름이 다름 (${r.heads.join(',')})`
      if (r.sections.length !== 3) return `섹션 수가 3이 아님 (${r.sections.length})`
      // 각 섹션 = 핵심 슬롯 1(있으면) + 그 축 각인 개수. 총=1+9=10, 검=1+8=9, 캐릭터=1+9=10.
      const expectedRows = [10, 9, 10]
      for (let i = 0; i < 3; i++) {
        if (r.sections[i].rows !== expectedRows[i]) {
          return `${r.sections[i].head} 섹션 항목 수가 다름 (${r.sections[i].rows} / 기대 ${expectedRows[i]})`
        }
        if (r.sections[i].hasEmptyLabel) return `${r.sections[i].head} 섹션에 각인이 있는데 "각인 없음" 표시가 남아있음`
        if (r.sections[i].hasTslot > 0) return `${r.sections[i].head} 섹션 항목에 축 라벨(tslot)이 남아있음 — 섹션 헤더와 중복`
      }
      if (r.totalRows !== 29) return `전체 항목 수가 다름 (${r.totalRows} / 기대 29 = 핵심 3 + 각인 26)`
      if (!r.panelWithinViewport) return '26종을 전부 보유한 상태에서 패널이 화면(뷰포트) 밖으로 넘침'
      if (!r.panelScrollable) return '내용이 뷰포트보다 긴데 패널이 스크롤 가능 상태가 아님(overflow 설정 확인)'
      return null
    }),
  },
  {
    name: 'trait-slot-badges',
    what: '특성 rarity → 슬롯 배지 전환(작업 지시 skill_slot_and_rarity 커밋1) — 레벨업/상점/보유 목록은 슬롯으로, 무기 등급 표기는 그대로인가',
    async run(p) {
      const levelUp = await p.evaluate(() => {
        const g = window.__game
        const sigil = { id: 'hp', name: '강인한 육체', desc: '', icon: '❤️', slot: 'character-sigil', grade: 'normal', apply: () => {} }
        const sword = { id: 'ilseom', name: '일섬', desc: '', icon: '💫', slot: 'sword', apply: () => {} }
        g.hud.showLevelUp('레벨 업!', '', [sigil, sword], () => {})
        const cards = [...document.querySelectorAll('#cards .card')]
        const result = cards.map((c) => ({ className: c.className, crar: c.querySelector('.crar')?.textContent }))
        document.querySelector('#levelOv')?.classList.remove('show')
        return result
      })
      const shop = await p.evaluate(() => {
        const g = window.__game
        g.hud.renderShop(
          [
            { icon: '💫', name: '일섬', desc: '', badgeClass: 'slot-sword', price: 90, sold: false, tag: '특성' },
            { icon: '🗡️', name: '카타나', desc: '', badgeClass: 'common', price: 35, sold: false, tag: '검' },
          ],
          500, 20,
        )
        const items = [...document.querySelectorAll('#shopItems .shop-item')].map((el) => el.className)
        g.hud.closeShop()
        return items
      })
      const settings = await p.evaluate(() => {
        const g = window.__game
        const sword = { id: 'ilseom', name: '일섬', desc: '', icon: '💫', slot: 'sword', apply: () => {} }
        const prevAcquired = new Map(g.acquired)
        g.acquired.set('ilseom', { upgrade: sword, count: 1 })
        g.hud.openSettings(
          [...g.acquired.values()],
          { master: 1, music: 1, sfx: 1 },
          { gun: g.player.gun.name, gunIcon: g.player.gun.icon, sword: g.player.sword.name, swordIcon: g.player.sword.icon },
          true,
          g.input.keyBindings,
        )
        // CORE_SLOTS 순서가 gun/sword/character라 첫 .trait는 이제 항상 gun
        // 슬롯이다(비어있으면 trait-slot-empty) — 주입한 sword 특성을 슬롯
        // 배지 클래스로 직접 찾는다.
        const el = document.querySelector('#traits .trait.slot-sword')
        const className = el ? el.className : null
        g.hud.closeSettings()
        g.acquired = prevAcquired
        return className
      })
      await p.evaluate((result) => { window.__qcTraitBadgeResult = result }, { levelUp, shop, settings })
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcTraitBadgeResult
      if (!r) return '결과 없음'
      const sigilCard = r.levelUp[0]
      const swordCard = r.levelUp[1]
      if (!sigilCard || sigilCard.className !== 'card slot-character-sigil' || sigilCard.crar !== '캐릭터 각인') {
        return `레벨업 카드(각인)가 슬롯 배지로 표기되지 않음 (${JSON.stringify(sigilCard)})`
      }
      if (!swordCard || swordCard.className !== 'card slot-sword' || swordCard.crar !== '검') {
        return `레벨업 카드(검)가 슬롯 배지로 표기되지 않음 (${JSON.stringify(swordCard)})`
      }
      if (r.shop[0] !== 'shop-item slot-sword') return `상점 특성 아이템이 슬롯 배지가 아님 (${r.shop[0]})`
      if (r.shop[1] !== 'shop-item common') return `상점 무기 아이템의 등급 표기가 이전과 달라짐 (${r.shop[1]})`
      if (r.settings !== 'trait slot-sword') return `보유 특성 목록이 슬롯 배지로 표기되지 않음 (${r.settings})`
      return null
    }),
  },
  {
    name: 'stage-2-7-content',
    what: '스테이지 2~7 임시 콘텐츠 — 각 로스터가 등록되고 7스테이지 테마/몬스터가 실제 방에 로드되는가',
    async run(p) {
      const result = await p.evaluate(() => {
        const expected = {
          2: 'suicide', 3: 'suicide', 4: 'fireMage', 5: 'iceMage', 6: 'summoner', 7: 'voidMage',
        }
        const roster = {}
        for (let stage = 2; stage <= 7; stage++) {
          if (!window.__game.debugEnterStage(stage)) return { error: `${stage}스테이지 진입 훅 실패`, roster }
          roster[stage] = window.__game.run.cfg.enemies.map((e) => e.kind)
          if (!roster[stage].includes(expected[stage])) return { error: `${stage}스테이지 필수 적 ${expected[stage]} 누락`, roster }
        }
        return { error: null, roster }
      })
      await p.evaluate((value) => { window.__qcStageContent = value }, result)
      await p.waitForTimeout(1200)
    },
    check: async (p) => p.evaluate(() => {
      const result = window.__qcStageContent
      if (!result) return '스테이지 검사 결과 없음'
      if (result.error) return result.error
      const g = window.__game
      if (g.run.stage !== 7 || !g.run.cfg.art.floor.includes('stage7')) return '7스테이지 임시 환경이 로드되지 않음'
      if (!g.spawnQueue.some((e) => e.artSet.startsWith('s7')) && !g.enemies.some((e) => e.artSet.startsWith('s7'))) return '7스테이지 임시 몬스터 시트가 스폰되지 않음'
      return null
    }),
  },
]

/**
 * 상자/제련소/엘리트 보상 등 특성 선택 모달(state==='levelup' — 경험치 체계는
 * 작업 지시 P7 커밋1에서 폐지됐지만 상태 이름은 그대로다, 모든 특성 선택
 * 트리거가 공유하는 UI라서)이 열린 채 남아있으면 Game의 프레임 루프가 적을
 * 갱신하지 않는다(this.state==='play' 로만 진행) — 다음 스텝 진입 전에 항상
 * 치운다. 모달이 없으면 아무것도 안 한다.
 */
async function dismissLevelUp(p) {
  for (let i = 0; i < 5; i++) {
    const open = await p.evaluate(() => ['levelup', 'reward'].includes(window.__game.state))
    if (!open) return
    await p.click('#cards .card').catch(() => {})
    await p.waitForTimeout(150)
  }
}

/**
 * window.startQcSampler를 브라우저 전역에 한 번 심어둔다 — 50ms(벽시계) 간격
 * setInterval로 폴링하되, 기록하는 시간축은 게임 시계(Game.simClock)다.
 * 이전에는 performance.now() 기준이라 이 자체가 "환경 격차" 버그의 절반이었다
 * — 느린 fps에서는 보스 상태가 실제보다 오래 지속된 것처럼 측정됐다.
 * simClock은 게임이 멈추면(모달/state!=='play') 같이 멈추므로, pauseQcSampler
 * 동안 __qcT0 를 보정해줄 필요도 없어졌다(이전엔 실시간 기준이라 필수였다).
 * SPA라 페이지 리로드가 없으므로 러닝 도중 한 번만 설치하면 이후 스텝에서
 * 계속 쓴다.
 */
async function installQcSamplerFn(p) {
  await p.evaluate(() => {
    const beginSampling = () => {
      window.__qcTimer = setInterval(() => {
        const boss = window.__game.enemies.find((e) => e.kind === 'boss')
        const t = (window.__game.simClock - window.__qcSimT0) * 1000
        window.__qcSamples.push({ t, state: boss?.bossState ?? null })
      }, 50)
    }
    window.startQcSampler = () => {
      window.__qcSimT0 = window.__game.simClock
      window.__qcSamples = []
      window.__qcSamplerActive = true
      beginSampling()
    }
    window.pauseQcSampler = () => {
      const g = window.__game
      if (g && window.__qcGameWasPaused == null) {
        window.__qcGameWasPaused = g.settingsOpen
        g.settingsOpen = true
      }
      if (window.__qcSamplerActive) clearInterval(window.__qcTimer)
    }
    window.resumeQcSampler = () => {
      const g = window.__game
      if (g && window.__qcGameWasPaused != null) {
        g.settingsOpen = window.__qcGameWasPaused
        window.__qcGameWasPaused = null
      }
      if (window.__qcSamplerActive) beginSampling()
    }
  })
}

async function stopQcSampler(p) {
  return p.evaluate(() => {
    clearInterval(window.__qcTimer)
    window.__qcSamplerActive = false
    return window.__qcSamples
  })
}

/** 연속된 동일 상태 구간의 길이(ms)를 뽑는다 */
function segmentDurations(samples) {
  const segs = []
  for (const s of samples) {
    if (!s.state) continue
    const last = segs[segs.length - 1]
    if (last && last.state === s.state) last.end = s.t
    else segs.push({ state: s.state, start: s.t, end: s.t })
  }
  return segs.map((s) => ({ state: s.state, ms: s.end - s.start }))
}

/** 폴링 간격(50ms) + 실제 프레임/타이머 지연을 감안한 허용 오차 */
const STATE_TOL_MS = 300

/** samples 안에서 expected 시퀀스가 순서대로(중간에 다른 상태가 껴도 됨) 등장하고, 각 구간 길이가 허용 오차 안인지 검증 */
function verifyStateSequence(samples, expected) {
  const segs = segmentDurations(samples)
  let idx = 0
  for (const seg of segs) {
    if (idx >= expected.length) break
    if (seg.state !== expected[idx].state) continue
    const exp = expected[idx]
    if (Math.abs(seg.ms - exp.ms) > STATE_TOL_MS) {
      return `${exp.state} 구간 실측 ${seg.ms.toFixed(0)}ms (기대 ${exp.ms}±${STATE_TOL_MS}ms)`
    }
    idx++
  }
  if (idx < expected.length) {
    const observed = segs.map((s) => `${s.state}:${s.ms.toFixed(0)}ms`).join(' → ')
    return `상태 시퀀스 미완주 — '${expected[idx].state}' 못 봄 (관측: ${observed || '없음'})`
  }
  return null
}

const inDungeon = (p) =>
  p.evaluate(() => window.__game?.mode === 'dungeon').catch(() => false)

const routeVisible = (p) =>
  p.locator('#routeOv.show').count().then((count) => count > 0).catch(() => false)

/**
 * 화면에 실제로 보이는 경로 카드 정보와 그 카드가 가리키는 RunState 깊이를
 * 함께 읽는다. 표시 필드를 DOM에서 읽어 "데이터는 있는데 화면에는 없음"인
 * 회귀도 잡고, roomId/targetDepth는 선택 결과·되돌아가기 검증에만 사용한다.
 */
async function readRouteCards(p) {
  await p.waitForSelector('#routeOv.show', { state: 'visible', timeout: 10000 })
  const cards = await p.evaluate(() => {
    const g = window.__game
    const detail = (card, name) =>
      card.querySelector(`.route-detail.${name} > span`)?.textContent?.trim()
      ?? card.querySelector(`.route-${name}`)?.textContent?.trim()
      ?? ''
    return [...document.querySelectorAll('#routeCards .route-card')].map((card) => {
      // 최종 DOM 계약은 data-room-id다. routeId는 HUD 작업 중간 명칭으로
      // 생성된 빌드도 실패 원인을 명확히 보여주기 위한 진단용 폴백이다.
      const roomId = card.dataset.roomId ?? card.dataset.routeId ?? ''
      const node = g.run.nodes?.get?.(roomId)
      return {
        roomId,
        title: card.querySelector('.route-title')?.textContent?.trim() ?? '',
        kind: card.querySelector('.route-kind')?.textContent?.trim() ?? '',
        risk: card.querySelector('.route-risk')?.textContent?.trim() ?? '',
        reward: detail(card, 'reward'),
        grade: detail(card, 'grade'),
        elite: detail(card, 'elite'),
        recharge: detail(card, 'recharge'),
        enemyCount: node?.plan?.enemies?.length ?? 0,
        targetDepth: node?.plan?.depth ?? null,
      }
    })
  })
  if (cards.length === 0) throw new Error('경로 오버레이는 열렸지만 카드가 없음')
  return cards
}

function validateRouteCards(cards, minCount, maxCount) {
  if (!Array.isArray(cards)) return '경로 카드 결과가 배열이 아님'
  if (cards.length < minCount || cards.length > maxCount) {
    return `카드 수가 ${minCount}~${maxCount} 범위가 아님 (${cards.length})`
  }
  const ids = new Set()
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    if (!card.roomId) return `${i + 1}번 카드에 data-room-id가 없음`
    if (ids.has(card.roomId)) return `같은 방 카드가 중복됨 (${card.roomId})`
    ids.add(card.roomId)
    if (!card.title) return `${i + 1}번 카드에 제목이 없음`
    if (!card.kind) return `${i + 1}번 카드에 방 종류가 없음`
    if (!card.risk) return `${i + 1}번 카드에 위험 정보가 없음`
    if (!card.reward) return `${i + 1}번 카드에 보상 정보가 없음`
    if (!card.grade) return `${i + 1}번 카드에 등급 정보가 없음`
    if (!Number.isFinite(card.targetDepth)) return `${i + 1}번 카드의 목표 깊이를 확인할 수 없음`
  }
  return null
}

/** 클릭과 숫자 키가 같은 진입 콜백을 타고 선택한 roomId를 실제로 여는지 확인한다. */
async function chooseRouteCard(p, { index = 0, via = 'click' } = {}) {
  const cards = await readRouteCards(p)
  const picked = cards[index]
  if (!picked) throw new Error(`${index + 1}번 경로 카드가 없음`)
  if (via === 'key') await p.keyboard.press(`Digit${index + 1}`)
  else await p.locator('#routeCards .route-card').nth(index).click()
  await p.waitForFunction(
    (roomId) => {
      const g = window.__game
      const currentId = g.run.current?.id ?? g.curPlan?.id ?? null
      return !document.querySelector('#routeOv')?.classList.contains('show')
        && g.state === 'play'
        && currentId === roomId
    },
    picked.roomId,
    { timeout: 10000 },
  )
  return { roomId: picked.roomId, index, via }
}

/** 시설방은 입장 즉시 모달을 띄우지 않고, 준비를 마친 뒤 버튼으로 연다. */
async function openFacilityRouteCards(p) {
  if (await routeVisible(p)) throw new Error('시설방 입장 즉시 경로 카드가 떠 시설 이용을 가림')
  const button = p.locator('#routeContinue:not([hidden])').first()
  await button.waitFor({ state: 'visible', timeout: 5000 })
  await button.click()
  await p.waitForSelector('#routeOv.show', { state: 'visible', timeout: 5000 })
}

/**
 * 디버그 전투가 방을 비운 직후 예기치 않게 열린 경로 모달을 중앙에서 흡수한다.
 * 이후 같은 방은 QC 샌드박스로 고정해 각 시나리오의 waitGame()이 route 상태로
 * 멈추지 않게 한다. 정상 경로 자체는 route-choice/boss-prep 스텝에서 검증한다.
 */
async function ensureRouteNotBlocking(p) {
  await dismissLevelUp(p)
  const state = await p.evaluate(() => window.__game?.state).catch(() => null)
  if (state === 'route' || await routeVisible(p)) {
    await chooseRouteCard(p, { index: 0, via: 'click' })
  }
  await p.evaluate(() => window.__game.debugStabilizeRouteSandbox?.())
}

/**
 * 각인/상위 전투/엘리트 보상은 첫 카드를 고른 뒤 핵심 슬롯 교체 확인을 한 번
 * 더 띄울 수 있다. 단발 dismiss로는 state==='reward'가 남아 경로 카드 대기가
 * 멈출 수 있으므로, 실제 #routeOv가 열릴 때까지 보상 카드 흐름을 끝까지 소비한다.
 */
async function dismissRewardsUntilRoute(p) {
  for (let i = 0; i < 10; i++) {
    if (await routeVisible(p)) return
    const state = await p.evaluate(() => window.__game?.state).catch(() => null)
    if (!['levelup', 'reward'].includes(state)) {
      await p.waitForTimeout(100)
      continue
    }
    const card = p.locator('#levelOv.show #cards .card').first()
    await card.waitFor({ state: 'visible', timeout: 3000 })
    await card.click()
    await p.waitForTimeout(100)
  }
  await p.waitForSelector('#routeOv.show', { state: 'visible', timeout: 3000 })
}

/**
 * --only 로 특정 스텝만 돌릴 때, 앞선 스텝들이 실제로 실행되지 않아
 * window.__game.player 조차 없는 상태로 시작해 모든 디버그 훅이 죽는
 * 문제(known limitation)를 고친다. 각 스텝이 요구하는 건 대부분 "게임이
 * 시작됐는가"와 "던전 모드인가" 두 가지뿐이다(무기/코어슬롯/적 배치는
 * 스텝 자기 자신이 debugEquipWeapons 등으로 항상 직접 세팅한다) — 그래서
 * 전체 스텝을 재생하는 대신 이 두 가지만 결정론적으로 맞춰준다.
 * shop-persist 스텝이 이미 같은 패턴(g.enterDungeon() 직접 호출)을 쓰고
 * 있었다 — TS의 private은 컴파일 타임 표시일 뿐 런타임에는 그대로 호출된다.
 * --only 를 쓰지 않는 일반 전체 실행에는 전혀 관여하지 않는다(각 스텝이
 * 이미 스스로 순서대로 상태를 쌓아가므로 끼어들 이유가 없다).
 */
async function ensureBaseline(p, needs, preserveInitialRoute = false) {
  const state = await p.evaluate(() => window.__game?.state).catch(() => null)
  if (state === 'start') {
    await p.click('#startBtn').catch(() => {})
    await p.waitForTimeout(300)
  }
  if (needs === 'dungeon') {
    const mode = await p.evaluate(() => window.__game?.mode).catch(() => null)
    if (mode !== 'dungeon') {
      await p.evaluate(() => window.__game.enterDungeon())
      await p.waitForTimeout(300)
    }
    if (preserveInitialRoute) {
      await p.waitForSelector('#routeOv.show', { state: 'visible', timeout: 10000 })
    } else {
      await ensureRouteNotBlocking(p)
    }
  }
}

/**
 * 게임 시계(Game.simClock, 초) 기준으로 gameSeconds만큼 진행될 때까지 기다린다.
 * 인게임 지속시간(장전, 보스 텔레그래프, 재생 지연, 스킬 쿨타임, 무적 프레임
 * 등)을 기다릴 때 쓴다. simClock은 step(dt)가 실제 쓰는 dt를 그대로 누적한
 * 값이라(Game.ts), 벽시계 waitForTimeout과 달리 프레임이 얼마나 늦게 돌든
 * "그만큼 진행"할 때까지 기다린다.
 *
 * 폴링은 Node↔브라우저를 매번 왕복하는 evaluate() 대신 page.waitForFunction
 * (polling:'raf')을 쓴다 — 조건 검사 자체가 브라우저 쪽 requestAnimationFrame
 * 콜백 안에서 돈다. 처음엔 Node에서 waitForTimeout(50)+evaluate()로 직접
 * 폴링했는데, 그 왕복 자체가(이 환경에서) 느려서 매 폴링 틱마다 게임 시계가
 * 목표치를 몇 배씩 지나쳐버렸다(0.1게임초 요청 → 0.3 진행 관측, iaido의
 * 좁은 무적 유예창을 통째로 넘겨버림). raf 폴링은 오차가 최대 한 프레임의
 * dt로 묶인다.
 *
 * state !== 'play' 이거나 settingsOpen 이면 simClock이 아예 멈춘다 — 그 경우
 * 무한 대기를 막기 위해 벽시계 안전 상한(max(15초, gameSeconds×20))을 둔다.
 * 상한을 넘기면 "정지"(시계가 전혀 안 움직임)와 "느림"(움직이지만 부족함)을
 * 구분해 실측 배속과 함께 던진다 — 실패 원인 판별용.
 */
async function waitGame(p, gameSeconds) {
  const wallCapMs = Math.max(15000, gameSeconds * 20 * 1000)
  const wallT0 = Date.now()
  const simT0 = await p.evaluate(() => window.__game.simClock)
  try {
    await p.waitForFunction(
      ({ simT0, gameSeconds }) => window.__game.simClock - simT0 >= gameSeconds,
      { simT0, gameSeconds },
      { timeout: wallCapMs, polling: 'raf' },
    )
  } catch {
    const simNow = await p.evaluate(() => window.__game.simClock)
    const wallElapsed = (Date.now() - wallT0) / 1000
    const advanced = simNow - simT0
    if (advanced <= 0.001) {
      throw new Error(`게임 시계 정지 — 모달 상태이거나 루프가 죽음 (목표 ${gameSeconds}게임초, 벽시계 ${wallElapsed.toFixed(1)}s 대기)`)
    }
    const rate = advanced / wallElapsed
    throw new Error(`게임 시계 진행이 너무 느림 (실측 배속 ${rate.toFixed(2)}) — ${advanced.toFixed(2)}/${gameSeconds}게임초 진행 (벽시계 ${wallElapsed.toFixed(1)}s)`)
  }
}

/**
 * 페이지 내부 requestAnimationFrame으로 predicate가 참이 될 때까지 기다린다.
 * waitGame()의 벽시계 왕복(Node↔브라우저 evaluate 호출)이 이 샌드박스에서는
 * 프레임 하나만큼도 몇 배씩 느려질 수 있어(dt가 프레임당 최대 0.05초로 뭉치는
 * 환경), 이도류·잔영 같은 좁은 시간 창(0.1~0.2초대) 검증에서 실측으로 여러 번
 * 오탐이 났다 — 그때마다 페이지 내부 rAF 폴링으로 바꿔 해결했다. 그 패턴을
 * 재사용 가능한 형태로 뽑았다. predicate는 (g) => boolean 형태의 함수이며,
 * 브라우저 컨텍스트에서 문자열로 직렬화돼 다시 컴파일된다(Node 클로저를
 * 캡처할 수 없다 — g 하나만 인자로 받는다).
 */
async function waitUntilPage(p, predicate, maxFrames = 120) {
  await p.evaluate(({ predicateSrc, maxFrames }) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${predicateSrc})`)()
    return new Promise((resolve) => {
      const g = window.__game
      let framesLeft = maxFrames
      const tick = () => {
        if (fn(g) || framesLeft-- <= 0) { resolve(); return }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }, { predicateSrc: predicate.toString(), maxFrames })
}

/**
 * 상호작용 오브젝트까지 걸어간다.
 * 방 배치가 매 판 랜덤이라 "위로 2.6초" 같은 고정 이동은 신뢰할 수 없다.
 * 데드라인은 게임 초 단위다(기본 6게임초 상당) — 플레이어 이동도 dt로
 * governed되므로, 느린 환경에서는 그만큼 실제 시간을 더 준다. 정지 상태에서
 * 무한정 기다리지 않도록 벽시계 안전 상한(max(15초, gameSeconds×20))도 둔다.
 */
async function walkTo(p, kind, gameSeconds = 6) {
  const held = new Set()
  const wallCapMs = Math.max(15000, gameSeconds * 20 * 1000)
  const wallT0 = Date.now()
  const simT0 = await p.evaluate(() => window.__game.simClock)
  try {
    while (true) {
      const simNow = await p.evaluate(() => window.__game.simClock)
      if (simNow - simT0 >= gameSeconds) return false
      if (Date.now() - wallT0 > wallCapMs) return false
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
      await p.waitForTimeout(80) // 유지 — 입력 펌프, 게임 시계와 무관
    }
  } finally {
    for (const k of held) await p.keyboard.up(k).catch(() => {})
  }
}

// ── 주행 ──────────────────────────────────────────────────────────────
const errors = []
const results = []
/** 게임 시계 배속(게임초/벽시계초) — town-idle 스텝에서 실측해 채운다 */
let clockRate = null
const assetReport = checkAssetIntegrity()
checkStateSnapshot()
checkRollChoices()
checkNodeGradeRewards()

let server = null
let port = PORT
if (!url) {
  console.log('· 빌드 (QC_DEBUG=1 — 보스/엘리트 디버그 스폰 훅 포함)')
  // QC_DEBUG=1 은 vite.config.ts의 define을 통해 __QC_DEBUG__ 를 true로 정적
  // 치환한다 — main.ts가 qcDebugHooks.ts를 동적 import해 설치한다. 이 env가
  // 없는 일반 배포 빌드(npm run build)에는 해당 코드가 죽은 코드로 제거돼
  // 번들에 실리지 않는다(사후 검증: qc.mjs 실행 후 `grep debugSpawnBoss dist`).
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, QC_DEBUG: '1' } })
  port = await freePort(PORT)
  console.log(`· 프리뷰 :${port}`)
  // Windows 의 spawn()은 셸을 거치지 않아 확장자 없는 'npx'를 ENOENT로 못 찾는다
  // (npm이 깔아둔 실제 실행 파일은 npx.cmd) — execSync는 항상 셸을 거쳐 괜찮지만
  // 이 spawn은 그렇지 않으므로 플랫폼별로 분기한다.
  // npx.cmd는 배치 파일이라 shell:false로 직접 spawn하면 Windows에서 EINVAL이
  // 난다 — .cmd/.bat 실행은 cmd.exe를 통해야 하므로 win32에서는 shell:true.
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  server = spawn(npxCmd, ['vite', 'preview', '--configLoader', 'runner', '--port', String(port), '--strictPort'], {
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
  args: process.platform === 'win32'
    ? ['--no-sandbox']
    : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const ctx = await browser.newContext({ viewport: VIEW })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ''}`))
page.on('requestfailed', (r) => errors.push(`request: ${r.url()} — ${r.failure()?.errorText}`))

await page.goto(target, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await installQcSamplerFn(page)
const displayFailure = await checkDisplayContract(page)
if (displayFailure) errors.push(`display: ${displayFailure}`)

if (only && !STEPS.some((s) => s.name.includes(only))) {
  console.log(`· 경고: --only ${only} 에 매치되는 스텝이 없음`)
}

let i = 0
for (const s of STEPS) {
  i++
  if (only && !s.name.includes(only)) continue
  const isRouteScenario = s.name === 'route-choice'
  if (only) await ensureBaseline(page, s.needs, isRouteScenario)
  if (s.needs === 'dungeon' && !isRouteScenario) await ensureRouteNotBlocking(page)
  const tag = `${String(i).padStart(2, '0')}-${s.name}`
  let fail = null
  try {
    await s.run(page)
    const checkBeforeCapture = s.name === 'critical-south-edge'
    if (checkBeforeCapture && s.check) fail = await s.check(page)
    await page.evaluate(() => window.pauseQcSampler?.())
    await page.screenshot({ path: join(OUT, `${tag}.png`) })
    await zoomShot(page, join(OUT, `${tag}-zoom.png`))
    await page.evaluate(() => window.resumeQcSampler?.())
    if (!checkBeforeCapture && s.check) fail = await s.check(page)
  } catch (e) {
    await page.evaluate(() => window.resumeQcSampler?.()).catch(() => {})
    fail = e.message.split('\n')[0]
  }
  if (s.after) await s.after(page).catch(() => {})
  results.push({ tag, what: s.what, fail })
  console.log(`${fail ? '✗' : '✓'} ${tag}  ${s.what}${fail ? `\n    → ${fail}` : ''}`)
}

// 밀도 계측 로그(QC_DEBUG 전용 훅) — 이번 주행 전체에서 실제로 발생한
// 검 스윙/총알 관통 이벤트를 집계한다. 스텝을 하나라도 건너뛰면(--only)
// 표본이 줄어든다 — 신뢰도 판단은 아래 표본 수 표기가 담당한다.
const densityLog = await page.evaluate(() => window.__game.debugGetDensityLog?.() ?? { swings: [], pierces: [] })
const densityReportLines = formatDensityReport(densityLog)

await contactSheet(page)
await browser.close()
if (server) killServerTree(server)

// ── 리포트 ────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.fail)
const report = [
  `대상: ${target}`,
  `시각: ${new Date().toISOString()}`,
  `게임 시계 배속 실측: ${clockRate == null ? '측정 안 됨' : `${clockRate.toFixed(2)}배 (게임초/벽시계초)${clockRate < 0.5 ? ' — 경고: 0.5 미만' : ''}`}`,
  '',
  `에셋 무결성 검사: ${assetReport.ok ? '통과' : '위반'}`,
  ...assetReport.output.split('\n').map((l) => `  ${l}`),
  '',
  '단계',
  ...results.map((r) => `  ${r.fail ? '✗' : '✓'} ${r.tag}  ${r.what}${r.fail ? `  → ${r.fail}` : ''}`),
  '',
  '적 밀도 계측 (이슈 6 무기 등급 재정렬용 — 수치 변경 없음, 계측만)',
  ...densityReportLines.map((l) => `  ${l}`),
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

/**
 * docs/STATE_SNAPSHOT.md 가 코드(config.ts/Weapons.ts/Upgrades.ts/Enemy.ts/
 * RunState.ts/EliteAffixes.ts)와 일치하는지 정적으로 검사한다. 밸런스 수치를
 * 고치고 `node tools/state_snapshot.mjs` 로 재생성·커밋하지 않으면 여기서
 * QC를 막는다 — 브라우저 없이 도는 검사라 에셋 무결성 검사와 같은 자리에서,
 * 항상 먼저 돌린다.
 */
function checkStateSnapshot() {
  console.log('· 상태 스냅샷 검사 (tools/state_snapshot.mjs --check)')
  try {
    const out = execSync('node tools/state_snapshot.mjs --check', { cwd: ROOT, encoding: 'utf-8' })
    console.log(out)
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    console.log(out)
    errors.push('STATE_SNAPSHOT.md 가 코드와 다름 (tools/state_snapshot.mjs --check) — 위 출력 참조')
  }
}

/**
 * rollChoices() 카드 구성 규칙을 2000회 표본으로 정적 검증한다(브라우저 불필요).
 * 슬롯 3축 재편(작업 지시 P8 커밋1)의 완료 기준 — tools/verify_roll_choices.mjs 참고.
 */
function checkRollChoices() {
  console.log('· 특성 선택지 구성 규칙 검사 (tools/verify_roll_choices.mjs)')
  try {
    const out = execSync('node tools/verify_roll_choices.mjs 2000', { cwd: ROOT, encoding: 'utf-8' })
    console.log(out)
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    console.log(out)
    errors.push('rollChoices() 구성 규칙 검증 실패 (tools/verify_roll_choices.mjs) — 위 출력 참조')
  }
}

/**
 * 노드 등급 보상 규칙(스테이지×노드 등급 표, 승급 상한, 확정 이득 1장)을
 * 2000회 표본으로 정적 검증한다(브라우저 불필요). 각인 등급 5단계(작업 지시
 * P8 커밋3)의 완료 기준 — tools/verify_node_grade_rewards.mjs 참고.
 */
function checkNodeGradeRewards() {
  console.log('· 노드 등급 보상 규칙 검사 (tools/verify_node_grade_rewards.mjs)')
  try {
    const out = execSync('node tools/verify_node_grade_rewards.mjs 2000', { cwd: ROOT, encoding: 'utf-8' })
    console.log(out)
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    console.log(out)
    errors.push('노드 등급 보상 규칙 검증 실패 (tools/verify_node_grade_rewards.mjs) — 위 출력 참조')
  }
}

/**
 * 프리뷰 서버(및 그 자식들)를 정리한다.
 * POSIX: detached spawn이 만든 프로세스 그룹을 음수 PID로 통째로 죽인다.
 * Windows: shell:true 로 띄웠으므로 server.pid는 cmd.exe 이고 그 아래에
 * npx.cmd -> node -> vite 가 자식으로 매달려 있다 — 음수 PID kill은 의미가
 * 없으므로 taskkill /T(트리) /F로 그 자식들까지 통째로 정리해야 한다.
 * 안 하면 QC 종료 후에도 vite preview가 포트를 물고 남는다.
 */
function killServerTree(server) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
    } else {
      process.kill(-server.pid)
    }
  } catch {}
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
      const canvas = document.querySelector('canvas')
      const rect = canvas?.getBoundingClientRect()
      if (!rect) return null
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((-v.y + 1) / 2) * rect.height,
      }
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
/** 1920×1080 내부 해상도와 비율 유지 축소가 실제 브라우저에서 지켜지는지 확인한다. */
async function checkDisplayContract(page) {
  const inspect = () => page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const stage = document.querySelector('.game-stage')
    if (!canvas || !stage) return null
    const rect = stage.getBoundingClientRect()
    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      stageWidth: rect.width,
      stageHeight: rect.height,
      stageLeft: rect.left,
      stageTop: rect.top,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    }
  })

  const full = await inspect()
  if (!full) return 'canvas 또는 .game-stage가 없음'
  if (full.canvasWidth !== 1920 || full.canvasHeight !== 1080) {
    return `내부 캔버스가 1920×1080이 아님 (${full.canvasWidth}×${full.canvasHeight})`
  }
  if (Math.abs(full.stageWidth - 1920) > 1 || Math.abs(full.stageHeight - 1080) > 1) {
    return `1920×1080 창에서 스테이지가 화면을 채우지 않음 (${full.stageWidth.toFixed(1)}×${full.stageHeight.toFixed(1)})`
  }

  await page.setViewportSize({ width: 1366, height: 768 })
  await page.waitForTimeout(100)
  const fitted = await inspect()
  await page.setViewportSize(VIEW)
  await page.waitForTimeout(100)
  if (!fitted) return '축소 화면에서 .game-stage를 읽지 못함'
  const ratio = fitted.stageWidth / fitted.stageHeight
  if (Math.abs(ratio - 16 / 9) > 0.002) return `축소 시 16:9 비율이 깨짐 (${ratio.toFixed(4)})`
  if (
    fitted.stageLeft < -1 ||
    fitted.stageTop < -1 ||
    fitted.stageLeft + fitted.stageWidth > fitted.viewportWidth + 1 ||
    fitted.stageTop + fitted.stageHeight > fitted.viewportHeight + 1
  ) {
    return '축소 시 스테이지가 브라우저 밖으로 잘림'
  }
  return null
}

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
  // base64로 25단계×2장을 인라인한 큰 페이지라, 느려진 샌드박스에서는 기본
  // 30초 내비게이션 타임아웃을 넘길 수 있다(실측: 0.11배속 환경에서 초과) —
  // 이건 요약 리포트 생성 단계일 뿐 게임 로직과 무관하므로 타임아웃만 늘린다.
  await p2.setContent(html, { timeout: 120000 })
  await p2.screenshot({ path: join(OUT, 'contact.png'), fullPage: true })
  await p2.close()
}

/**
 * 밀도 계측 로그(qcDebugHooks.ts debugGetDensityLog)를 리포트용 텍스트로
 * 집계한다. "이슈 6" 무기 등급 재정렬 스펙이 DPS × 기대 타격 수로 판정해야
 * 하는데 기대 타격 수의 근거인 적 밀도가 미측정이었다 — 이 블록은 계측
 * 결과만 보고한다. 여기서 어떤 밸런스 수치도 바꾸지 않는다.
 */
function median(nums) {
  if (nums.length === 0) return NaN
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function hitsDistribution(nums) {
  const buckets = { 0: 0, 1: 0, 2: 0, 3: 0, '4+': 0 }
  for (const h of nums) buckets[h >= 4 ? '4+' : String(h)]++
  const n = nums.length || 1
  return Object.entries(buckets).map(([k, v]) => `${k}:${((v / n) * 100).toFixed(0)}%`).join(' ')
}

function formatDensityReport(log) {
  const lines = []
  const swings = log?.swings ?? []
  const pierces = log?.pierces ?? []

  lines.push(`검 스윙 표본 ${swings.length}건${swings.length < 50 ? ' — 50 미만, 신뢰 불가' : ''}`)
  if (swings.length > 0) {
    const allHits = swings.map((s) => s.hits)
    lines.push(`  전체 — 명중 수 중앙값 ${median(allHits)} · 분포(0/1/2/3/4+) ${hitsDistribution(allHits)}`)
    const byKind = {}
    for (const s of swings) (byKind[s.roomKind] ??= []).push(s.hits)
    for (const kind of Object.keys(byKind).sort()) {
      const arr = byKind[kind]
      lines.push(`  ${kind} (${arr.length}건) — 중앙값 ${median(arr)} · 분포 ${hitsDistribution(arr)}${arr.length < 50 ? ' [표본 부족]' : ''}`)
    }
    const nearbyMed = (r) => median(swings.map((s) => s[`nearby${r}`]))
    lines.push(`  참고: 스윙 시점 반경별 적 수 중앙값 — r4:${nearbyMed(4)} r6:${nearbyMed(6)} r8:${nearbyMed(8)}`)
  }

  lines.push(`총알 관통 표본 ${pierces.length}건${pierces.length < 50 ? ' — 50 미만, 신뢰 불가' : ''}`)
  if (pierces.length > 0) {
    const allExtra = pierces.map((p) => p.extraHits)
    lines.push(`  전체 — 추가 명중(관통) 중앙값 ${median(allExtra)} · 분포(0/1/2/3/4+) ${hitsDistribution(allExtra)}`)
  }
  return lines
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
