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
      await p.keyboard.press('KeyT')
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
  // ── 이하 보스/엘리트 접두사 — 절차 생성 던전에서는 매 실행마다 나온다는
  // 보장이 없어(보스방은 8개 방 완주, 특정 접두사는 확률) 정상 플레이 경로로는
  // 결정적으로 재현할 수 없다. qcDebugHooks.ts(QC_DEBUG=1 빌드에만 포함)로
  // 현재 방에 직접 스폰해 상태머신 타이밍·접두사 효과를 검증한다.
  {
    name: 'active-skills',
    what: 'Q 발도 · E 더블 샷 · R 폭렬 난무 — 경로 이동/무적/탄약/쿨다운/마무리 충격파',
    async run(p) {
      await dismissLevelUp(p)
      await aim(p, 400)
      await p.evaluate(() => {
        const g = window.__game
        // 전투방 중앙에서는 E를 상호작용에 빼앗기지 않는다.
        g.player.pos.set(0, 0, 0)
        g.player.ammo = g.player.magSize
        g.player.reloading = false
        g.debugClearEnemies()
        g.debugSpawnBoss()
        window.__qcSkills = { x: g.player.pos.x, z: g.player.pos.z, ammo: g.player.ammo }
      })
      await p.keyboard.press('KeyQ')
      await p.waitForTimeout(100)
      await p.evaluate(() => {
        window.__qcSkills.qInvulnerable = window.__game.player.invulnerable
      })
      await p.waitForTimeout(120)
      await p.keyboard.press('KeyE')
      await p.waitForTimeout(90)
      await p.keyboard.press('KeyR')
      await p.waitForTimeout(900)
    },
    check: async (p) => p.evaluate(() => {
      const g = window.__game
      const before = window.__qcSkills
      const movedDistance = Math.hypot(g.player.pos.x - before.x, g.player.pos.z - before.z)
      const eAmmo = before.ammo - g.player.ammo >= 2
      const cds = g.player.activeSkillCooldowns
      const shockwave = g.effects.groundFx?.some((fx) => fx.duration > 0) ?? false
      const buttons = ['skillQ', 'skillE', 'skillR'].every((id) => document.querySelector(`#${id}`))
      if (movedDistance < 12) return `Q 발도 이동거리가 짧음 (${movedDistance.toFixed(1)})`
      if (!before.qInvulnerable) return 'Q 발도 이동 중 무적이 적용되지 않음'
      if (!eAmmo) return 'E 더블 샷이 탄약 2발을 소비하지 않음'
      if (!(cds.charge > 0 && cds.doubleShot > 0 && cds.ultimate > 0)) return '스킬 쿨다운이 시작되지 않음'
      if (!shockwave) return 'R 마무리 충격파가 생성되지 않음'
      return buttons ? null : '스킬 HUD가 없음'
    }),
  },
  {
    name: 'iaido',
    what: '발도 — 적을 관통해 검 공격력 비례 피해를 주고 이동 중 무적·종료 직후 보호가 적용되는가',
    async run(p) {
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        g.player.pos.set(0, 0, 0)
        g.player.chargeCdTimer = 0
        g.player.stats.critChance = 0
        const first = g.debugSpawnEnemy('brute')
        const second = g.debugSpawnEnemy('brute')
        const outside = g.debugSpawnEnemy('brute')
        first.pos.set(5, 0, 0)
        second.pos.set(10, 0, 0)
        outside.pos.set(7, 0, 3)
        for (const target of [first, second, outside]) {
          target.hp = 9999
          target.maxHp = 9999
        }
        window.__qcIaido = {
          x: g.player.pos.x,
          z: g.player.pos.z,
          expectedDamage: g.player.stats.swordDamage * 1.5,
          hp: 9999,
          targetIds: [first.id, second.id],
          outsideId: outside.id,
        }
        // 원본 검광은 오른쪽을 향한다. +Z(화면 아래) 진행은 -90도로 보여야 한다.
        const probeStart = g.player.pos.clone()
        const probeEnd = probeStart.clone()
        probeEnd.z += 5
        g.effects.iaido(probeStart, probeEnd)
        window.__qcIaido.southEffectRotation = g.effects.fx.at(-1)?.sp.material.rotation
      })
      await aim(p, 400)
      await p.keyboard.press('KeyQ')
      await p.waitForTimeout(100)
      await p.evaluate(() => {
        window.__qcIaido.duringInvulnerable = window.__game.player.invulnerable
      })
      await p.waitForTimeout(170)
      await p.evaluate(() => {
        window.__qcIaido.afterInvulnerable = window.__game.player.invulnerable
      })
    },
    check: async (p) => p.evaluate(() => {
      const g = window.__game
      const before = window.__qcIaido
      const targets = before.targetIds.map((id) => g.enemies.find((enemy) => enemy.id === id))
      const outside = g.enemies.find((enemy) => enemy.id === before.outsideId)
      const movedDistance = Math.hypot(g.player.pos.x - before.x, g.player.pos.z - before.z)
      if (Math.abs(before.southEffectRotation + Math.PI / 2) > 0.01) {
        return `발도 검광이 진행 방향과 어긋남 (회전 ${before.southEffectRotation})`
      }
      if (movedDistance < 12) return `발도 이동거리가 짧음 (${movedDistance.toFixed(1)})`
      if (!before.duringInvulnerable) return '발도 이동 중 무적이 적용되지 않음'
      if (!before.afterInvulnerable) return '발도 종료 직후 보호가 적용되지 않음'
      if (targets.some((target) => !target)) return '발도 경로의 복수 적을 유지하지 못함'
      for (const target of targets) {
        const dealt = before.hp - target.hp
        if (Math.abs(dealt - before.expectedDamage) > 0.01) {
          return `발도 피해 배율이 150%가 아님 (${dealt.toFixed(2)} / ${before.expectedDamage.toFixed(2)})`
        }
      }
      if (!outside || outside.hp !== before.hp) return '발도 경로 밖의 적까지 피해를 받음'
      return null
    }),
  },
  {
    name: 'fire-goblin',
    what: '화염구 고블린 — 적정 거리에서 측면 이동하고 2배 크기 화염구를 발사하는가',
    async run(p) {
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
      await p.waitForTimeout(150)
      await p.evaluate(() => {
        window.__qcFireGoblin.bulletScale = window.__game.projectiles.enemyBullets[0]?.mesh.scale.x ?? null
      })
      await p.waitForTimeout(750)
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
      if (Math.abs(bulletScale - 1.6) > 0.01) return `화염구 크기가 2배가 아님 (${bulletScale})`
      return null
    }),
  },
  {
    name: 'critical-south-edge',
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
      await p.waitForTimeout(100)
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
    check: async (p) => p.evaluate(() => {
      const g = window.__game
      const nodes = g.run.nodes
      const rest = [...nodes.values()].find((node) => node.plan.kind === 'rest')
      const boss = [...nodes.values()].find((node) => node.plan.kind === 'boss')
      const kinds = g.interactables.map((item) => item.kind)
      const restExitIds = rest ? Object.values(rest.exits) : []
      const bossExitIds = boss ? Object.values(boss.exits) : []
      if (!rest || !boss) return '보스 준비 장소 또는 보스방이 없음'
      if (rest.plan.enemies.length !== 0) return '보스 준비 장소에 적이 배치됨'
      if (!kinds.includes('merchant') || !kinds.includes('fountain')) return '보스 준비 장소에 상점 또는 분수가 없음'
      if (restExitIds.length !== 2 || !restExitIds.includes(boss.plan.id)) return '준비 장소가 보스방과 단일 통로로 연결되지 않음'
      if (bossExitIds.length !== 1 || bossExitIds[0] !== rest.plan.id) return '보스방에 준비 장소 외의 출입구가 있음'
      return null
    }),
  },
  {
    name: 'boss-charge',
    what: '보스 돌진 — 예고(0.7s)→돌진(1.0s,3.5배속)→경직(1.2s) 타이밍',
    async run(p) {
      // 09-combat 에서 처치한 적의 경험치로 레벨업 모달이 뜬 채 남아있을 수
      // 있다 — state가 'levelup'이면 Game의 프레임 루프가 적을 갱신하지 않아
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
      await p.waitForTimeout(2800) // 남은 예고+돌진+경직 전 구간 관찰
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
      await p.waitForTimeout(1700) // 남은 예고+발동+경직 관찰
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
    what: '보스 2페이즈 — 체력 50% 시점 1회성 전환(배너·예고/경직 단축)',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()
        const boss = g.debugSpawnBoss()
        boss.hp = boss.maxHp * 0.49
      })
      await p.waitForTimeout(300) // 배너 애니메이션(2s) 중 캡처
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
      await p.waitForTimeout(2600) // 지연(2s) + 회복 틱 1회 — 재생 이펙트가 뜬 상태로 캡처
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
    what: '엘리트 접두사 — 분열(사망 시 자식 2) / 폭발(사망 시 광역) / 신속(이동속도↑)',
    async run(p) {
      await dismissLevelUp(p)
      await p.evaluate(() => {
        const g = window.__game
        g.debugClearEnemies()

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
      await p.waitForTimeout(250) // 폭발 이펙트가 뜬 상태로 캡처 (Game의 매 프레임 루프가 사망 처리)
    },
    check: async (p) => {
      const r = await p.evaluate(() => {
        const g = window.__game
        return {
          normalSpeed: window.__qcNormalSpeed,
          swiftSpeed: window.__qcSwiftSpeed,
          playerHpBefore: window.__qcPlayerHpBefore,
          playerHpAfter: g.player.hp,
          splitChildren: g.enemies.filter((e) => e.kind === 'imp' && !e.affix && e.xp === 0).length,
        }
      })
      if (r.swiftSpeed <= r.normalSpeed) return `신속 접두사인데 속도가 더 안 빠름 (일반:${r.normalSpeed} 신속:${r.swiftSpeed})`
      if (r.playerHpAfter >= r.playerHpBefore) return `폭발 접두사 사망 후 플레이어 피해 없음 (${r.playerHpBefore} → ${r.playerHpAfter})`
      if (r.splitChildren !== 2) return `분열 자식 수가 2가 아님 (실제 ${r.splitChildren})`
      return null
    },
  },
]

/**
 * 09-combat 등에서 처치한 적의 경험치로 레벨업/보스보상 모달(state==='levelup')이
 * 열린 채 남아있으면 Game의 프레임 루프가 적을 갱신하지 않는다(this.state==='play'
 * 로만 진행) — 보스/엘리트 디버그 단계 진입 전에 항상 치운다. 모달이 없으면 아무것도
 * 안 한다.
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
 * window.startQcSampler를 브라우저 전역에 한 번 심어둔다 — 50ms 간격으로
 * 보스 상태를 표본 수집한다. Node↔브라우저 왕복마다 생기는 타이밍 오차를
 * 피하려고 표본 수집 자체는 전부 브라우저 쪽 setInterval로 돌린다. SPA라
 * 페이지 리로드가 없으므로 러닝 도중 한 번만 설치하면 이후 스텝에서 계속 쓴다.
 */
async function installQcSamplerFn(p) {
  await p.evaluate(() => {
    window.startQcSampler = () => {
      window.__qcT0 = performance.now()
      window.__qcSamples = []
      window.__qcTimer = setInterval(() => {
        const boss = window.__game.enemies.find((e) => e.kind === 'boss')
        window.__qcSamples.push({ t: performance.now() - window.__qcT0, state: boss?.bossState ?? null })
      }, 50)
    }
  })
}

async function stopQcSampler(p) {
  return p.evaluate(() => {
    clearInterval(window.__qcTimer)
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
await installQcSamplerFn(page)

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
if (server) killServerTree(server)

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
