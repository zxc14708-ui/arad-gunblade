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
    what: '장전 — 탄창 UI 가 7/7 로 복귀하는가 (R, 리듬 입력 없이 무입력 완료)',
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
    what: '포탈로 던전 입장 — 방이 생성되고 적이 배치되는가',
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
        if (await inDungeon(p)) break
      }
      await p.waitForTimeout(1400)
    },
    check: async (p) => ((await inDungeon(p)) ? null : '던전에 진입하지 못함'),
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
      // 장전 (R) — 리듬 입력 없이 무입력 완료 경로만 검증(리듬 성공/실패는 별도 스텝)
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
    // 작업 지시 P6 커밋3 — R 리듬 장전. 성공 구간 안에서 두 번째 R을 누르면
    // 즉시 완료 + 다음 3발 피해 +30%, 구간 밖이면 소폭 지연(즉시 완료되지
    // 않고 원래 예정 시각을 넘긴다), 아무 입력도 없는 정상 완료는 위의
    // 'reload' 스텝이 이미 검증한다.
    name: 'reload-rhythm',
    needs: 'dungeon',
    what: 'R 리듬 장전 — 성공 구간 즉시완료+다음3발 30% 가산, 구간 밖 입력은 완료를 지연시키는가',
    async run(p) {
      await dismissLevelUp(p)
      const reloadTime = await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.player.pos.set(0, 0, 0)
        g.player.coreSlots.clear()
        g.player.stats.critChance = 0
        g.player.reloading = false
        g.player.ammo = 0
        // 이전 스텝의 검격이 남겨둔 발도장전 보너스(swordReloadBurstShotsLeft,
        // 기본 메커니즘이라 항상 활성)가 리듬 보너스와 같은 발에 겹쳐 적용되면
        // 피해가 1.3×1.3배로 부풀어 성공 보너스 단독 측정이 깨진다 — 리셋한다.
        g.player.swordReloadBurstShotsLeft = 0
        const target = g.debugSpawnEnemy('brute')
        target.pos.set(5, 0, 0)
        target.hp = 9999
        target.maxHp = 9999
        // 장전 사이클 여러 번 도는 동안 오래 대기한다 — speed=0으로 고정하지
        // 않으면 다가와서 접촉 피해로 플레이어를 죽여 게임을 gameover로
        // 만든다(다른 더미 적 스텝들의 관례, qc.mjs 686/715/799/1459줄 참고).
        target.speed = 0
        window.__qcReloadRhythm = {
          gunDamage: g.player.stats.gunDamage,
          targetId: target.id,
          targetHp: target.hp,
        }
        return g.player.stats.reloadTime
      })
      await aimAtPoint(p, 5, 0)

      // ── 성공 구간: 창 중앙에서 두 번째 R ──
      // 성공 구간 폭(~0.15~0.2게임초)이 이 샌드박스의 Node↔브라우저 왕복
      // 지연보다 좁아, waitGame()으로 창 중앙까지 기다린 뒤 별도로
      // p.keyboard.press()를 보내면 그사이 실제 시간이 흘러 창을 이미
      // 지나쳐버린다(page.evaluate 왕복 수백ms가 왕복마다 쌓인다 — 실측
      // ratio가 목표 0.70 대신 0.87까지 밀림). '이도류/잔영'과 같은 이유로,
      // 판정과 입력 디스패치를 모두 페이지 내부 rAF 콜백 안에서 동기적으로
      // 처리해 왕복 지연을 없앤다(왕복이 없으면 오차가 프레임 하나의 dt로
      // 묶인다 — waitUntilPage()의 문서화된 근거와 동일).
      await p.keyboard.press('KeyR')
      await p.evaluate(() => new Promise((resolve) => {
        const g = window.__game
        const tick = () => {
          const win = g.player.reloadWindow
          const ratio = g.player.reloadRatio
          if (g.player.reloading && ratio >= win.start && ratio <= win.end) {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true }))
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR', bubbles: true }))
            resolve()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }))
      await waitGame(p, 0.05)
      await p.evaluate(() => {
        const g = window.__game
        window.__qcReloadRhythm.successReloading = g.player.reloading
        window.__qcReloadRhythm.successAmmo = g.player.ammo
        window.__qcReloadRhythm.successMagSize = g.player.magSize
        window.__qcReloadRhythm.successBonusShotsLeft = g.player.rhythmBonusShotsLeft
      })
      // 보너스가 실제 피해에 반영되는지 한 발 쏴서 확인
      await p.mouse.down()
      await p.waitForTimeout(90)
      await p.mouse.up()
      await waitGame(p, 0.6)
      await p.evaluate(() => {
        const g = window.__game
        const before = window.__qcReloadRhythm
        const target = g.enemies.find((e) => e.id === before.targetId)
        before.dealtDamage = target ? before.targetHp - target.hp : null
      })

      // ── 실패(구간 밖): 창 시작보다 한참 이른 시점에 두 번째 R ──
      await p.evaluate(() => {
        const g = window.__game
        g.player.reloading = false
        g.player.ammo = 0
        // 성공 구간 검증에서 한 발만 쏘고 남은 보너스(2발)가 실패 구간
        // 검증으로 새어 들어가지 않게 리셋한다 — 게임 로직이 아니라 이
        // 스텝의 두 단계가 같은 카운터를 공유해서 생기는 테스트 설계 문제.
        g.player.rhythmBonusShotsLeft = 0
      })
      await p.keyboard.press('KeyR')
      await waitGame(p, Math.max(0.03, reloadTime * 0.05)) // 창(대략 0.55~0.85 구간)보다 한참 이름
      await p.keyboard.press('KeyR')
      await p.evaluate(() => {
        window.__qcReloadRhythm.failStillReloadingRightAfter = window.__game.player.reloading
      })
      // 실패 페널티가 없었다면 이 시점(원래 예정 완료 시각 근방)에 이미 끝나 있어야 한다
      await waitGame(p, Math.max(0, reloadTime - reloadTime * 0.05 - 0.15))
      await p.evaluate(() => {
        window.__qcReloadRhythm.failStillReloadingNearOriginalDeadline = window.__game.player.reloading
      })
      // 지연분까지 넉넉히 기다리면 결국 정상 완료된다
      await waitGame(p, 0.6)
      await p.evaluate(() => {
        const g = window.__game
        window.__qcReloadRhythm.failEventuallyReloading = g.player.reloading
        window.__qcReloadRhythm.failEventuallyAmmo = g.player.ammo
        window.__qcReloadRhythm.failBonusShotsLeft = g.player.rhythmBonusShotsLeft
      })
    },
    check: async (p) => p.evaluate(() => {
      const r = window.__qcReloadRhythm
      if (r.successReloading) return '성공 구간 입력이 장전을 즉시 완료시키지 않음'
      if (r.successAmmo !== r.successMagSize) return `성공 구간 입력 후 탄약이 가득 차지 않음 (${r.successAmmo}/${r.successMagSize})`
      if (r.successBonusShotsLeft !== 3) return `성공 직후 보너스 발수가 3발이 아님 (${r.successBonusShotsLeft})`
      if (r.dealtDamage === null) return '보너스 확인용 사격이 대상에 명중하지 않음'
      const expected = r.gunDamage * 1.3
      if (Math.abs(r.dealtDamage - expected) > expected * 0.05) {
        return `성공 보너스(+30%)가 피해에 반영되지 않음 (${r.dealtDamage.toFixed(1)} / 기대 ${expected.toFixed(1)})`
      }
      if (!r.failStillReloadingRightAfter) return '구간 밖 입력이 장전을 즉시 끝내버림(지연 페널티 없음)'
      if (!r.failStillReloadingNearOriginalDeadline) return '구간 밖 입력에 지연 페널티가 적용되지 않음(원래 완료 시각에 이미 끝남)'
      if (r.failEventuallyReloading) return '지연 페널티 이후에도 장전이 끝내 완료되지 않음'
      if (r.failEventuallyAmmo !== 7) return `지연 완료 후 탄약이 가득 차지 않음 (${r.failEventuallyAmmo})`
      if (r.failBonusShotsLeft !== 0) return `구간 밖 입력인데도 보너스가 지급됨 (${r.failBonusShotsLeft})`
      return null
    }),
  },
  {
    name: 'trait-slots',
    needs: 'dungeon',
    what: '핵심 슬롯 특성(작업 지시 slot_system_phase1 커밋 3) — 발도참/조준사격/최후탄/표식/급전환 실제 발동과 슬롯 교체 UI',
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

        // ── 발도참(slash) — 0.5초 이상 정지 후 첫 베기 250% ──
        g.debugClearEnemies()
        g.player.pos.set(0, 0, 0)
        g.player.invuln = 5
        // 기본 10% 치명타 확률이 배율 검증(최후탄 등)을 이따금 흔들지 않도록 끈다
        g.player.mods.critChance = -0.1
        g.player.recompute()
        g.debugSetCoreSlot('slash', 'iaijutsu')
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

        // ── 조준사격(shot) — 0.35초 이상 쉬고 쏘면 확정 치명타 ──
        g.debugSetCoreSlot('shot', 'aimed_shot')
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

      // ── 최후탄(shot) — 탄창 마지막 1발 220%, 핍 색 변경 ──
      // 실제로 명중시키려면 정밀 조준(aimAtPoint)이 필요해 조준 오차가 결과에
      // 섞인다 — 배율 자체는 발사 시점에 이미 bullets[].damage에 반영되므로
      // 총알이 맞았는지와 무관하게 스폰된 총알의 damage 필드로 직접 검증한다.
      const lastBulletSetup = await p.evaluate(() => {
        const g = window.__game
        g.debugSetCoreSlot('shot', 'last_bullet')
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

      // ── 표식(dash) — 대시로 관통한 적은 3초간 받는 피해 +35% ──
      const markResult = await p.evaluate(async () => {
        const g = window.__game
        g.state = 'play'
        g.settingsOpen = false
        g.hitstopTimer = 0
        g.player.alive = true
        g.player.hp = g.player.stats.maxHp
        g.player.invuln = 999
        g.debugSetCoreSlot('dash', 'mark')
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

      // ── 급전환(dash) — 대시 종료 직후 검 쿨 절반 + 총 즉시 장전 ──
      const quickSwitch = await p.evaluate(async () => {
        const g = window.__game
        g.state = 'play'
        g.settingsOpen = false
        g.hitstopTimer = 0
        g.player.alive = true
        g.player.hp = g.player.stats.maxHp
        g.player.invuln = 999
        g.debugSetCoreSlot('dash', 'quick_switch')
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
        const current = { id: 'close_range', name: '밀착사격', desc: '', icon: '🔫', slot: 'shot' }
        const incoming = { id: 'last_bullet', name: '최후탄', desc: '', icon: '🎯', slot: 'shot' }
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
        return `최후탄 피해 배율이 220%가 아님 (${r.lastBulletResult.dealt} / 기대 ${lastExpected.toFixed(1)})`
      }
      if (!r.lastBulletResult.pipClass || !r.lastBulletResult.pipClass.includes('last-bullet')) {
        return '최후탄 상태에서 탄약 UI 마지막 핍에 강조 클래스가 없음'
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
        g.debugSetCoreSlot('slash', 'ilseom')
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
        g.debugSetCoreSlot('slash', 'dualblade')
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
        g.debugSetCoreSlot('slash', 'parry')
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
        g.debugSetCoreSlot('shot', 'ricochet')
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
        g.debugSetCoreSlot('dash', 'afterimage')
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
    name: 'boss-prep',
    needs: 'dungeon',
    what: '보스 준비 장소 — 적 없이 상점·분수로 보스방 하나만 연결되는가',
    async run(p) {
      await p.evaluate(() => {
        const g = window.__game
        const nodes = g.run.nodes
        const rest = [...nodes.values()].find((node) => node.plan.kind === 'rest')
        if (!rest) throw new Error('보스 준비 장소가 생성되지 않음')
        g.loadRoom(g.run.enter(rest.plan.id))
      })
      await p.waitForTimeout(350)
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
        let structural = null
        if (!rest || !boss) structural = '보스 준비 장소 또는 보스방이 없음'
        else if (rest.plan.enemies.length !== 0) structural = '보스 준비 장소에 적이 배치됨'
        else if (!kinds.includes('merchant') || !kinds.includes('fountain')) structural = '보스 준비 장소에 상점 또는 분수가 없음'
        else if (restExitIds.length !== 2 || !restExitIds.includes(boss.plan.id)) structural = '준비 장소가 보스방과 단일 통로로 연결되지 않음'
        else if (bossExitIds.length !== 1 || bossExitIds[0] !== rest.plan.id) structural = '보스방에 준비 장소 외의 출입구가 있음'

        // 단일 런 관찰로는 분수 배치 결함(전투방만으로 못 채우는 약 1.3%
        // 케이스)을 못 잡는다 — RunState를 300회 이상 독립적으로 새로 생성해
        // hasFountain 분포로 검증한다(게임 상태는 건드리지 않음, debugFountainSample 참고).
        const sample = g.debugFountainSample(300)
        return { structural, sample }
      })
      if (r.structural) return r.structural

      const { sample } = r
      const dist = Object.entries(sample.counts)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([count, times]) => `${count}개 ${times}회`)
        .join(', ')
      const supplementRate = ((sample.supplementUsed / sample.n) * 100).toFixed(2)
      console.log(`  · 분수 배치 표본 ${sample.n}회 — 분포: ${dist} · 보충(보물/엘리트) 발동 ${sample.supplementUsed}회(${supplementRate}%)`)

      if (sample.shopMissing > 0) return `상점방에 분수가 없는 표본 ${sample.shopMissing}건`
      if (sample.restMissing > 0) return `보스 준비방에 분수가 없는 표본 ${sample.restMissing}건`
      if (sample.bossHasFountain > 0) return `보스방에 분수가 배치된 표본 ${sample.bossHasFountain}건`
      const wantCount = sample.counts[4] ?? 0
      if (wantCount !== sample.n) {
        return `분수 개수가 4가 아닌 표본 있음 (${sample.n}회 중 4개 ${wantCount}회) — 분포: ${dist}`
      }
      return null
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
        g.player.recordTrait('qc-test-trait')
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
        if (g.player.traitStacks.size !== 0) return `특성 스택이 초기화되지 않음 (${g.player.traitStacks.size}개 남음)`
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
    what: '상점 재고 유지 — 상점방↔보스 준비방을 오가도 구매/판매/리롤 상태가 리롤되지 않고, 두 방의 재고는 서로 독립',
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

        g.loadRoom(g.run.enter(shopRoom.id))
        g.openShop()
        g.rerollShop() // 리롤 먼저 — 구매 후 리롤하면 재고 자체가 새로 생성돼 방금 산 항목의 sold가 사라지는 게 정상 동작이라 순서를 바꿔 검증한다
        g.buyShopItem(0)
        const shopA = g.shopRooms.get(shopRoom.id)
        window.__qcShopBefore = { sold: shopA.items.map((it) => it.sold), rerollCount: shopA.rerollCount, items: shopA.items.length }
        g.closeShop()

        g.loadRoom(g.run.enter(restRoom.id))
        const shopRest = g.shopRooms.get(restRoom.id)
        window.__qcRestShop = { sold: shopRest.items.map((it) => it.sold), rerollCount: shopRest.rerollCount }

        g.loadRoom(g.run.enter(shopRoom.id))
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
    name: 'trait-slot-badges',
    what: '특성 rarity → 슬롯 배지 전환(작업 지시 skill_slot_and_rarity 커밋1) — 레벨업/상점/보유 목록은 슬롯으로, 무기 등급 표기는 그대로인가',
    async run(p) {
      const levelUp = await p.evaluate(() => {
        const g = window.__game
        const sigil = { id: 'hp', name: '강인한 육체', desc: '', icon: '❤️', slot: 'sigil', maxStacks: 3, apply: () => {} }
        const slash = { id: 'ilseom', name: '일섬', desc: '', icon: '💫', slot: 'slash', maxStacks: 1, apply: () => {} }
        g.hud.showLevelUp('레벨 업!', '', [sigil, slash], () => {})
        const cards = [...document.querySelectorAll('#cards .card')]
        const result = cards.map((c) => ({ className: c.className, crar: c.querySelector('.crar')?.textContent }))
        document.querySelector('#levelOv')?.classList.remove('show')
        return result
      })
      const shop = await p.evaluate(() => {
        const g = window.__game
        g.hud.renderShop(
          [
            { icon: '💫', name: '일섬', desc: '', badgeClass: 'slot-slash', price: 90, sold: false, tag: '특성' },
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
        const slash = { id: 'ilseom', name: '일섬', desc: '', icon: '💫', slot: 'slash', maxStacks: 1, apply: () => {} }
        const prevAcquired = new Map(g.acquired)
        g.acquired.set('ilseom', { upgrade: slash, count: 1 })
        g.hud.openSettings(
          [...g.acquired.values()],
          { master: 1, music: 1, sfx: 1 },
          { gun: g.player.gun.name, gunIcon: g.player.gun.icon, sword: g.player.sword.name, swordIcon: g.player.sword.icon },
          true,
          g.input.keyBindings,
        )
        const el = document.querySelector('#traits .trait')
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
      const slashCard = r.levelUp[1]
      if (!sigilCard || sigilCard.className !== 'card slot-sigil' || sigilCard.crar !== '각인') {
        return `레벨업 카드(각인)가 슬롯 배지로 표기되지 않음 (${JSON.stringify(sigilCard)})`
      }
      if (!slashCard || slashCard.className !== 'card slot-slash' || slashCard.crar !== '베기') {
        return `레벨업 카드(베기)가 슬롯 배지로 표기되지 않음 (${JSON.stringify(slashCard)})`
      }
      if (r.shop[0] !== 'shop-item slot-slash') return `상점 특성 아이템이 슬롯 배지가 아님 (${r.shop[0]})`
      if (r.shop[1] !== 'shop-item common') return `상점 무기 아이템의 등급 표기가 이전과 달라짐 (${r.shop[1]})`
      if (r.settings !== 'trait slot-slash') return `보유 특성 목록이 슬롯 배지로 표기되지 않음 (${r.settings})`
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
    const open = await p.evaluate(() => window.__game.state === 'levelup')
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
async function ensureBaseline(p, needs) {
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
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
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
  if (only) await ensureBaseline(page, s.needs)
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
 * 특성 슬롯제(작업 지시 slot_system_phase1) 커밋 1의 완료 기준 —
 * tools/verify_roll_choices.mjs 참고.
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
