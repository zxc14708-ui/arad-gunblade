import { Upgrade } from '../systems/Upgrades'
import { GunDef, SwordDef, WeaponDef } from '../systems/Weapons'
import { CrystalKind, MetaUpgradeView, MetaWeaponView } from '../systems/MetaProgression'
import { KeyAction, KeyBindings, KEY_ACTION_LABELS, keyLabel } from '../core/Input'

export interface MiniMapRoom {
  id: string
  kind: 'combat' | 'elite' | 'treasure' | 'shop' | 'rest' | 'boss'
  x: number
  y: number
  current: boolean
  visited: boolean
  cleared: boolean
  visible: boolean
  exits: ('north' | 'east' | 'south' | 'west')[]
}

/** DOM 기반 HUD / 오버레이 관리 */
export class HUD {
  root: HTMLDivElement
  floaterLayer: HTMLDivElement

  private elLevel!: HTMLElement
  private elWave!: HTMLElement
  private elScore!: HTMLElement
  private elKills!: HTMLElement
  private hpFill!: HTMLElement
  private hpLabel!: HTMLElement
  private xpFill!: HTMLElement
  private dashRing!: HTMLElement
  private skillButtons!: Record<'q' | 'e' | 'r', HTMLElement>
  private banner!: HTMLElement
  private bossBar!: HTMLElement
  private bossFill!: HTMLElement
  private startOv!: HTMLDivElement
  private levelOv!: HTMLDivElement
  private overOv!: HTMLDivElement
  private settingsOv!: HTMLDivElement
  private ammoText!: HTMLElement
  private ammoPips!: HTMLElement
  private ammoBox!: HTMLElement
  private lastAmmo = -1
  private lastMag = -1
  private lastBulletTrait = false
  private volCb: ((kind: 'master' | 'music' | 'sfx', v: number) => void) | null = null
  private shakeCb: ((on: boolean) => void) | null = null
  private keybindCb: ((action: KeyAction, code: string) => boolean) | null = null
  private listeningAction: KeyAction | null = null

  constructor(container: HTMLElement) {
    this.root = document.createElement('div')
    this.root.id = 'ui'
    this.root.innerHTML = this.template()
    container.appendChild(this.root)
    this.floaterLayer = this.root

    this.elLevel = this.q('#sLevel')
    this.elWave = this.q('#sWave')
    this.elScore = this.q('#sGold')
    this.elKills = this.q('#sKills')
    this.hpFill = this.q('#hpFill')
    this.hpLabel = this.q('#hpLabel')
    this.xpFill = this.q('#xpFill')
    this.dashRing = this.q('#dashRing')
    this.skillButtons = { q: this.q('#skillQ'), e: this.q('#skillE'), r: this.q('#skillR') }
    this.banner = this.q('#banner')
    this.bossBar = this.q('#bossBar')
    this.bossFill = this.q('#bossFill')
    this.startOv = this.q('#startOv')
    this.levelOv = this.q('#levelOv')
    this.overOv = this.q('#overOv')
    this.settingsOv = this.q('#settingsOv')
    this.ammoText = this.q('#ammoText')
    this.ammoPips = this.q('#ammoPips')
    this.ammoBox = this.q('#ammoBox')
    window.addEventListener('keydown', (e) => this.captureKeybind(e), true)
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T
  }

  private template(): string {
    return `
      <div class="hud-top">
        <div class="stat-row">
          <span>Lv <b id="sLevel">1</b></span>
          <span id="progWrap">방 <b id="sWave">0</b></span>
          <span>처치 <b id="sKills">0</b></span>
          <span class="gold-stat">🪙 <b id="sGold">0</b></span>
        </div>
        <div class="minimap" id="miniMap" aria-label="던전 지도"></div>
      </div>

      <button class="icon-btn" id="settingsBtn" title="설정 (Tab)">⚙️</button>

      <div class="prompt" id="prompt"><kbd>E</kbd> <span id="promptText"></span></div>

      <div id="bossBar">
        <div class="name">◆ 마계의 지배자 ◆</div>
        <div class="bar"><div class="fill" id="bossFill" style="width:100%"></div></div>
      </div>

      <div class="hud-bars">
        <div class="bar" id="hpBar"><div class="fill" id="hpFill" style="width:100%"></div><div class="label" id="hpLabel">100 / 100</div></div>
        <div class="bar" id="xpBar"><div class="fill" id="xpFill" style="width:0%"></div></div>
      </div>

      <div class="hud-ammo" id="ammoBox">
        <div class="ammo-pips" id="ammoPips"></div>
        <div class="ammo-text" id="ammoText">7 / 7</div>
        <div class="ammo-label"><span id="gunName">M1911</span> · <kbd>T</kbd> 장전</div>
      </div>

      <div class="hud-skills" aria-label="액티브 스킬">
        <div class="skill ready" id="skillQ"><kbd>Q</kbd><span>발도</span><i></i></div>
        <div class="skill ready" id="skillE"><kbd>E</kbd><span>더블 샷</span><i></i></div>
        <div class="skill ready ultimate" id="skillR"><kbd>R</kbd><span>폭렬 난무</span><i></i></div>
      </div>

      <div class="hud-dash">
        <div class="dash-ring ready" id="dashRing">💨</div>
        <div class="dash-label">SHIFT 회피</div>
      </div>

      <div id="banner"></div>

      <div class="overlay show" id="startOv">
        <div class="title">ARAD: GUNBLADE</div>
        <div class="subtitle">던전앤파이터 팬 게임 · 총검사</div>
        <div class="helptext">
          <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 이동 &nbsp;·&nbsp; <kbd>마우스</kbd> 조준<br/>
          <kbd>좌클릭</kbd> 사격 &nbsp;·&nbsp; <kbd>T</kbd> 장전 &nbsp;·&nbsp; <kbd>우클릭</kbd>/<kbd>Space</kbd> 베기<br/>
          <kbd>Q</kbd> 발도 &nbsp;·&nbsp; <kbd>E</kbd> 더블 샷 &nbsp;·&nbsp; <kbd>R</kbd> 폭렬 난무<br/>
          <kbd>Shift</kbd> 대시 (무적) &nbsp;·&nbsp; <kbd>E</kbd> 상호작용 &nbsp;·&nbsp; <kbd>Tab</kbd> 설정<br/><br/>
          마을의 <b style="color:#c8b0ff">포탈</b>로 던전에 입장하라.<br/>
          방을 클리어하고 <b style="color:#ffd070">문</b>을 골라 전진 —
          보스 앞엔 <b style="color:#7fd8f0">상인과 회복 분수</b>가 있다.<br/>
          던전 구조는 <b>매 판 랜덤</b>으로 바뀐다.
        </div>
        <button class="btn" id="startBtn">게임 시작</button>
      </div>

      <div class="overlay" id="settingsOv">
        <div class="settings-panel">
          <div class="settings-title">⚙ 설정</div>
          <div class="settings-sec">🔊 음량</div>
          <div class="slider-row"><label>전체</label><input type="range" id="volMaster" min="0" max="100" value="85"/><span class="slval" id="volMasterV">85%</span></div>
          <div class="slider-row"><label>배경음</label><input type="range" id="volMusic" min="0" max="100" value="70"/><span class="slval" id="volMusicV">70%</span></div>
          <div class="slider-row"><label>효과음</label><input type="range" id="volSfx" min="0" max="100" value="85"/><span class="slval" id="volSfxV">85%</span></div>
          <div class="settings-sec">🎬 화면 효과</div>
          <div class="toggle-row"><label for="shakeToggle">화면 흔들림</label><input type="checkbox" id="shakeToggle" checked/></div>
          <div class="settings-sec">⌨ 조작 키</div>
          <div class="keybind-note" id="keybindNote">버튼을 누른 뒤 원하는 키를 누르세요. 같은 키는 중복 지정할 수 없습니다.</div>
          <div class="keybinds" id="keybinds"></div>
          <div class="settings-sec">🗡️ 장착 무기</div>
          <div class="equipped" id="equipped"></div>
          <div class="settings-sec">✨ 획득 특성 <span class="traits-count" id="traitsCount"></span></div>
          <div class="traits" id="traits"></div>
          <button class="btn small" id="settingsClose">닫기 (Tab)</button>
        </div>
      </div>

      <div class="overlay" id="levelOv">
        <div class="levelup-head" id="levelHead">LEVEL UP!</div>
        <div class="levelup-sub" id="levelSub">강화할 능력을 선택하세요</div>
        <div class="cards" id="cards"></div>
      </div>

      <div class="overlay" id="shopOv">
        <div class="shop-panel">
          <div class="shop-head">🛒 상인</div>
          <div class="shop-sub">골드로 무기·특성을 구매하세요 · 보유 <b class="gold-stat">🪙 <span id="shopGold">0</span></b></div>
          <div class="shop-items" id="shopItems"></div>
          <div class="shop-actions">
            <button class="btn small" id="shopReroll">🔄 재고 리셋 (<span id="rerollPrice">25</span>🪙)</button>
            <button class="btn small alt" id="shopClose">나가기 (Esc)</button>
          </div>
        </div>
      </div>

      <div class="overlay" id="metaOv">
        <div class="shop-panel meta-panel">
          <div class="shop-head" id="metaHead">힘의 제단</div>
          <div class="shop-sub" id="metaSub"></div>
          <div class="meta-resources" id="metaResources"></div>
          <div class="shop-items meta-items" id="metaItems"></div>
          <div class="shop-actions"><button class="btn small alt" id="metaClose">나가기 (Esc)</button></div>
        </div>
      </div>

      <div class="overlay" id="loadoutOv">
        <div class="shop-panel loadout-panel">
          <div class="shop-head">출발 장비 선택</div>
          <div class="shop-sub">해금한 총과 검을 장비한 뒤 던전으로 출발합니다.</div>
          <div class="loadout-section"><div class="loadout-label">총</div><div class="shop-items meta-items" id="loadoutGuns"></div></div>
          <div class="loadout-section"><div class="loadout-label">검</div><div class="shop-items meta-items" id="loadoutSwords"></div></div>
          <div class="shop-actions"><button class="btn small alt" id="loadoutClose">나가기 (Esc)</button><button class="btn small" id="loadoutStart">장비하고 출발</button></div>
        </div>
      </div>

      <div class="overlay" id="clearOv">
        <div class="title" style="color:#7fe08a">STAGE CLEAR</div>
        <div class="gameover-stats" id="clearStats"></div>
        <button class="btn" id="clearBtn">마을로 귀환</button>
      </div>

      <div class="overlay" id="overOv">
        <div class="title" style="color:#e0554f">YOU DIED</div>
        <div class="gameover-stats" id="overStats"></div>
        <button class="btn" id="restartBtn">마을로 귀환</button>
      </div>

      <div class="credit">Dungeon &amp; Fighter fan game — 총검사 · Three.js</div>
    `
  }

  onStart(cb: () => void) {
    const btn = this.q('#startBtn') as HTMLButtonElement
    btn.onclick = () => {
      btn.blur() // 포커스 남으면 Space/Enter가 버튼을 재활성화함
      this.startOv.classList.remove('show')
      cb()
    }
  }
  onRestart(cb: () => void) {
    const btn = this.q('#restartBtn') as HTMLButtonElement
    btn.onclick = () => {
      btn.blur()
      this.overOv.classList.remove('show')
      cb()
    }
  }

  onOpenSettings(cb: () => void) {
    const btn = this.q('#settingsBtn') as HTMLButtonElement
    btn.onclick = () => {
      btn.blur()
      cb()
    }
  }
  onCloseSettings(cb: () => void) {
    const btn = this.q('#settingsClose') as HTMLButtonElement
    btn.onclick = () => {
      btn.blur()
      cb()
    }
  }

  onVolume(cb: (kind: 'master' | 'music' | 'sfx', v: number) => void) {
    this.volCb = cb
    const wire = (id: string, valId: string, kind: 'master' | 'music' | 'sfx') => {
      const el = this.q(id) as HTMLInputElement
      const val = this.q(valId)
      el.oninput = () => {
        val.textContent = el.value + '%'
        cb(kind, Number(el.value) / 100)
      }
    }
    wire('#volMaster', '#volMasterV', 'master')
    wire('#volMusic', '#volMusicV', 'music')
    wire('#volSfx', '#volSfxV', 'sfx')
  }

  onShakeToggle(cb: (on: boolean) => void) {
    this.shakeCb = cb
    const el = this.q('#shakeToggle') as HTMLInputElement
    el.onchange = () => cb(el.checked)
  }

  onKeybind(cb: (action: KeyAction, code: string) => boolean) {
    this.keybindCb = cb
  }

  private renderKeybinds(bindings: KeyBindings) {
    const box = this.q('#keybinds')
    box.innerHTML = ''
    const order: KeyAction[] = ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'dash', 'slash', 'reload', 'charge', 'doubleShot', 'ultimate', 'interact']
    for (const action of order) {
      const row = document.createElement('div')
      row.className = 'keybind-row'
      const label = document.createElement('span')
      label.textContent = KEY_ACTION_LABELS[action]
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'keybind-btn'
      button.dataset.action = action
      button.textContent = keyLabel(bindings[action])
      button.onclick = () => {
        this.listeningAction = action
        this.q('#keybindNote').textContent = `${KEY_ACTION_LABELS[action]}: 새 키를 누르세요. Esc는 취소입니다.`
        box.querySelectorAll('.keybind-btn').forEach((el) => el.classList.remove('listening'))
        button.classList.add('listening')
        button.focus()
      }
      row.append(label, button)
      box.appendChild(row)
    }
    this.setSkillKeys(bindings)
  }

  private captureKeybind(e: KeyboardEvent) {
    if (!this.listeningAction) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const action = this.listeningAction
    const box = this.q('#keybinds')
    this.listeningAction = null
    box.querySelectorAll('.keybind-btn').forEach((el) => el.classList.remove('listening'))
    if (e.code === 'Escape') {
      this.q('#keybindNote').textContent = '키 변경을 취소했습니다.'
      return
    }
    if (this.keybindCb?.(action, e.code)) {
      const button = box.querySelector(`[data-action="${action}"]`) as HTMLButtonElement | null
      if (button) button.textContent = keyLabel(e.code)
      this.q('#keybindNote').textContent = `${KEY_ACTION_LABELS[action]}: ${keyLabel(e.code)}로 변경했습니다.`
      const bindings = Object.fromEntries([...box.querySelectorAll<HTMLButtonElement>('.keybind-btn')].map((button) => [button.dataset.action!, button.textContent!])) as Partial<KeyBindings>
      this.setSkillKeys({
        moveUp: bindings.moveUp ?? 'W', moveDown: bindings.moveDown ?? 'S', moveLeft: bindings.moveLeft ?? 'A', moveRight: bindings.moveRight ?? 'D',
        dash: bindings.dash ?? 'Left Shift', slash: bindings.slash ?? 'Space', reload: bindings.reload ?? 'T', charge: bindings.charge ?? 'Q',
        doubleShot: bindings.doubleShot ?? 'E', ultimate: bindings.ultimate ?? 'R', interact: bindings.interact ?? 'E',
      })
    } else {
      this.q('#keybindNote').textContent = '이미 다른 조작에 쓰는 키입니다. 다른 키를 선택하세요.'
    }
  }

  private setSkillKeys(bindings: KeyBindings) {
    ;(this.skillButtons.q.querySelector('kbd') as HTMLElement).textContent = keyLabel(bindings.charge)
    ;(this.skillButtons.e.querySelector('kbd') as HTMLElement).textContent = keyLabel(bindings.doubleShot)
    ;(this.skillButtons.r.querySelector('kbd') as HTMLElement).textContent = keyLabel(bindings.ultimate)
    const ammoKey = this.q('#ammoBox .ammo-label kbd')
    if (ammoKey) ammoKey.textContent = keyLabel(bindings.reload)
  }

  openSettings(
    traits: { upgrade: Upgrade; count: number }[],
    vol: { master: number; music: number; sfx: number },
    equip?: { gun: string; gunIcon: string; sword: string; swordIcon: string },
    shakeEnabled = true,
    bindings?: KeyBindings,
  ) {
    // 슬라이더를 현재 음량에 맞춤
    const set = (id: string, valId: string, v: number) => {
      ;(this.q(id) as HTMLInputElement).value = String(Math.round(v * 100))
      this.q(valId).textContent = Math.round(v * 100) + '%'
    }
    set('#volMaster', '#volMasterV', vol.master)
    set('#volMusic', '#volMusicV', vol.music)
    set('#volSfx', '#volSfxV', vol.sfx)
    ;(this.q('#shakeToggle') as HTMLInputElement).checked = shakeEnabled
    if (bindings) this.renderKeybinds(bindings)

    // 장착 무기
    if (equip) {
      this.q('#equipped').innerHTML = `
        <div class="eq"><span class="eqi">${equip.gunIcon}</span><span>${equip.gun}</span></div>
        <div class="eq"><span class="eqi">${equip.swordIcon}</span><span>${equip.sword}</span></div>`
    }

    // 획득 특성 목록
    const box = this.q('#traits')
    const count = this.q('#traitsCount')
    box.innerHTML = ''
    if (traits.length === 0) {
      box.innerHTML = '<div class="trait-empty">아직 획득한 특성이 없습니다. 레벨업으로 특성을 얻으세요.</div>'
      count.textContent = ''
    } else {
      count.textContent = `(${traits.length}종)`
      // 레벨 높은 순 정렬
      const sorted = [...traits].sort((a, b) => b.count - a.count)
      for (const t of sorted) {
        const el = document.createElement('div')
        el.className = `trait ${t.upgrade.rarity}`
        el.innerHTML = `
          <span class="ticon">${t.upgrade.icon}</span>
          <span class="tmain"><span class="tname">${t.upgrade.name}</span><span class="tdesc">${t.upgrade.desc}</span></span>
          <span class="tlv">Lv.${t.count}</span>`
        box.appendChild(el)
      }
    }
    this.settingsOv.classList.add('show')
  }

  closeSettings() {
    this.listeningAction = null
    this.settingsOv.classList.remove('show')
  }

  /**
   * 탄약 표시 갱신. lastBulletTrait가 true면 '최후탄'(shot) 보유 중 —
   * 탄창의 마지막 1발(핍)에 강조 색을 준다.
   */
  setAmmo(ammo: number, mag: number, reloading: boolean, ratio: number, gunName?: string, lastBulletTrait = false) {
    if (ammo !== this.lastAmmo || mag !== this.lastMag || lastBulletTrait !== this.lastBulletTrait) {
      this.lastAmmo = ammo
      this.lastMag = mag
      this.lastBulletTrait = lastBulletTrait
      // 탄알 핍 재구성 (너무 많으면 숫자만)
      if (mag <= 14) {
        let pips = ''
        for (let i = 0; i < mag; i++) {
          const on = i < ammo
          const isLastBulletPip = lastBulletTrait && ammo === 1 && i === 0
          pips += `<i class="${on ? 'on' : 'off'}${isLastBulletPip ? ' last-bullet' : ''}"></i>`
        }
        this.ammoPips.innerHTML = pips
      } else {
        this.ammoPips.innerHTML = ''
      }
    }
    if (gunName) this.q('#gunName').textContent = gunName
    this.ammoBox.classList.toggle('reloading', reloading)
    this.ammoText.textContent = reloading ? `장전 중… ${Math.round(ratio * 100)}%` : `${ammo} / ${mag}`
  }

  setStats(level: number, wave: number, kills: number, gold: number) {
    this.elLevel.textContent = String(level)
    this.elWave.textContent = String(wave)
    this.elKills.textContent = String(kills)
    this.elScore.textContent = String(gold)
  }

  /** 던전 진행 표시 (현재 방/보스까지) */
  setRoomTrack(depth: number, bossDepth: number, kinds: string[]) {
    const t = this.q('#roomTrack')
    if (depth <= 0) {
      t.innerHTML = ''
      return
    }
    let html = ''
    for (let i = 1; i <= bossDepth; i++) {
      const cls = i < depth ? 'done' : i === depth ? 'now' : ''
      const icon = i === bossDepth ? '💀' : i === bossDepth - 1 ? '🛒' : '·'
      html += `<i class="${cls}">${i === depth ? (kinds[0] ?? '●') : icon}</i>`
    }
    t.innerHTML = html
  }

  /** 현재까지 탐험한 방과 인접한 미발견 방을 격자 미니맵으로 표시한다. */
  setMinimap(rooms: MiniMapRoom[]) {
    const map = this.q('#miniMap')
    if (rooms.length === 0) {
      map.innerHTML = ''
      map.hidden = true // 마을에는 던전 지도가 없으니 빈 칸을 남기지 않는다
      return
    }
    map.hidden = false
    const visible = rooms.filter((room) => room.visible)
    const minX = Math.min(...visible.map((room) => room.x))
    const minY = Math.min(...visible.map((room) => room.y))
    const icon: Record<MiniMapRoom['kind'], string> = { combat: '⚔', elite: '✦', treasure: '◆', shop: '¤', rest: '⛺', boss: '☠' }
    map.innerHTML = visible
      .map((room) => {
        const cls = [
          'minimap-room',
          room.current ? 'current' : '',
          room.visited ? 'visited' : 'unknown',
          room.cleared ? 'cleared' : '',
        ].filter(Boolean).join(' ')
        const label = room.visited ? icon[room.kind] : '?'
        const links = room.exits
          .filter((direction) => direction === 'east' || direction === 'south')
          .map((direction) => `<span class="minimap-link ${direction}"></span>`)
          .join('')
        return `<i class="${cls}" style="grid-column:${room.x - minX + 1};grid-row:${room.y - minY + 1}" title="${room.visited ? room.kind : '미발견 방'}">${links}${label}</i>`
      })
      .join('')
  }

  /** 상호작용 프롬프트 */
  setPrompt(text: string | null) {
    const p = this.q('#prompt')
    if (text) {
      this.q('#promptText').textContent = text
      p.classList.add('show')
    } else {
      p.classList.remove('show')
    }
  }

  setHp(hp: number, max: number) {
    const pct = Math.max(0, (hp / max) * 100)
    this.hpFill.style.width = pct + '%'
    this.hpLabel.textContent = `${Math.ceil(hp)} / ${max}`
  }

  setXp(xp: number, toNext: number) {
    this.xpFill.style.width = Math.min(100, (xp / toNext) * 100) + '%'
  }

  setDash(ratio: number, ready: boolean) {
    this.dashRing.style.setProperty('--p', Math.round(ratio * 100) + '%')
    this.dashRing.classList.toggle('ready', ready)
  }

  setActiveSkills(cooldowns: { charge: number; doubleShot: number; ultimate: number }, chargeReady: boolean, doubleShotReady: boolean, ultimateReady: boolean) {
    const states: [keyof typeof this.skillButtons, number, boolean][] = [
      ['q', cooldowns.charge, chargeReady],
      ['e', cooldowns.doubleShot, doubleShotReady],
      ['r', cooldowns.ultimate, ultimateReady],
    ]
    for (const [key, cooldown, ready] of states) {
      const el = this.skillButtons[key]
      el.classList.toggle('ready', ready)
      el.style.setProperty('--cd', `${Math.round(Math.min(1, cooldown) * 100)}%`)
    }
  }

  banner_(text: string) {
    this.banner.textContent = text
    this.banner.classList.remove('show')
    void this.banner.offsetWidth // 리플로우로 애니메이션 재시작
    this.banner.classList.add('show')
  }

  showBoss(show: boolean) {
    this.bossBar.style.display = show ? 'block' : 'none'
  }
  setBoss(hp: number, max: number) {
    this.bossFill.style.width = Math.max(0, (hp / max) * 100) + '%'
  }

  /** 특성 선택 (레벨업 / 보스 보상 공용) */
  showLevelUp(head: string, sub: string, choices: Upgrade[], onPick: (u: Upgrade) => void) {
    this.q('#levelHead').textContent = head
    this.q('#levelSub').textContent = sub
    this.renderCards(
      choices.map((u) => ({ icon: u.icon, name: u.name, desc: u.desc, rarity: u.rarity })),
      (i) => onPick(choices[i]),
    )
  }

  /**
   * 핵심 슬롯 교체 확인 — 이미 채운 슬롯의 다른 특성을 골랐을 때, 현재 보유
   * 특성과 새 특성을 나란히 보여주고 교체/유지를 고르게 한다. 카드 UI를
   * showLevelUp과 그대로 공유한다(renderCards 재사용).
   */
  showSlotSwap(current: Upgrade, incoming: Upgrade, onPick: (keepCurrent: boolean) => void) {
    this.q('#levelHead').textContent = '핵심 슬롯 교체'
    this.q('#levelSub').textContent = `이미 "${current.name}"을(를) 보유 중입니다 — 교체할까요?`
    this.renderCards(
      [
        { icon: current.icon, name: current.name, desc: current.desc, rarity: current.rarity, tag: '유지' },
        { icon: incoming.icon, name: incoming.name, desc: incoming.desc, rarity: incoming.rarity, tag: '교체' },
      ],
      (i) => onPick(i === 0),
    )
  }

  /** 보스 보상 장비(무기) 선택 */
  showEquipment(weapons: WeaponDef[], onPick: (w: WeaponDef) => void) {
    this.q('#levelHead').textContent = '보스 보상 · 장비'
    this.q('#levelSub').textContent = '무기를 하나 선택해 교체하세요'
    this.renderCards(
      weapons.map((w) => ({
        icon: w.icon,
        name: w.name,
        desc: w.desc,
        rarity: w.rarity,
        tag: w.kind === 'gun' ? '총' : '검',
      })),
      (i) => onPick(weapons[i]),
    )
  }

  private renderCards(
    items: { icon: string; name: string; desc: string; rarity: string; tag?: string }[],
    onPick: (index: number) => void,
  ) {
    const cards = this.q('#cards')
    cards.innerHTML = ''
    items.forEach((it, i) => {
      const card = document.createElement('div')
      card.className = `card ${it.rarity}`
      card.innerHTML = `
        ${it.tag ? `<div class="ctag">${it.tag}</div>` : ''}
        <div class="cicon">${it.icon}</div>
        <div class="cname">${it.name}</div>
        <div class="cdesc">${it.desc}</div>
        <div class="crar">${it.rarity}</div>`
      card.onclick = () => {
        this.levelOv.classList.remove('show')
        onPick(i)
      }
      cards.appendChild(card)
    })
    this.levelOv.classList.add('show')
  }

  // ══════════ 상점 ══════════
  private shopHandlers: {
    buy: (i: number) => void
    reroll: () => void
    close: () => void
  } | null = null

  onShop(buy: (i: number) => void, reroll: () => void, close: () => void) {
    this.shopHandlers = { buy, reroll, close }
    ;(this.q('#shopReroll') as HTMLButtonElement).onclick = () => {
      ;(this.q('#shopReroll') as HTMLButtonElement).blur()
      reroll()
    }
    ;(this.q('#shopClose') as HTMLButtonElement).onclick = () => {
      ;(this.q('#shopClose') as HTMLButtonElement).blur()
      close()
    }
  }

  /** 상점 열기/갱신 */
  renderShop(
    items: { icon: string; name: string; desc: string; rarity: string; price: number; sold: boolean; tag?: string }[],
    gold: number,
    rerollPrice: number,
  ) {
    this.q('#shopGold').textContent = String(gold)
    this.q('#rerollPrice').textContent = String(rerollPrice)
    const box = this.q('#shopItems')
    box.innerHTML = ''
    items.forEach((it, i) => {
      const el = document.createElement('div')
      const afford = gold >= it.price && !it.sold
      el.className = `shop-item ${it.rarity}${it.sold ? ' sold' : ''}${afford ? '' : ' poor'}`
      el.innerHTML = `
        ${it.tag ? `<div class="ctag">${it.tag}</div>` : ''}
        <div class="si-icon">${it.icon}</div>
        <div class="si-name">${it.name}</div>
        <div class="si-desc">${it.desc}</div>
        <div class="si-price">${it.sold ? '판매됨' : `🪙 ${it.price}`}</div>`
      if (afford) {
        el.onclick = () => this.shopHandlers?.buy(i)
      }
      box.appendChild(el)
    })
    const rr = this.q('#shopReroll') as HTMLButtonElement
    rr.classList.toggle('poor', gold < rerollPrice)
    this.q<HTMLDivElement>('#shopOv').classList.add('show')
  }

  closeShop() {
    this.q<HTMLDivElement>('#shopOv').classList.remove('show')
  }
  get shopOpen() {
    return this.q<HTMLDivElement>('#shopOv').classList.contains('show')
  }

  showMetaAltar(
    crystals: Record<CrystalKind, number>,
    upgrades: MetaUpgradeView[],
    onBuy: (id: MetaUpgradeView['id']) => void,
    onClose: () => void,
  ) {
    this.q('#metaHead').textContent = '힘의 제단'
    this.q('#metaSub').textContent = '결정으로 영구 능력을 강화합니다. 효과는 다음 런부터도 유지됩니다.'
    this.q('#metaResources').innerHTML = this.resourceMarkup(crystals)
    const box = this.q('#metaItems')
    box.innerHTML = ''
    upgrades.forEach((upgrade) => {
      const maxed = upgrade.cost === null
      const item = document.createElement('div')
      item.className = `shop-item ${maxed || upgrade.affordable ? '' : 'poor'} meta-upgrade`
      item.innerHTML = `<div class="si-icon">${upgrade.icon}</div><div class="si-name">${upgrade.name} <small>Lv.${upgrade.rank}/${upgrade.maxRank}</small></div><div class="si-desc">${upgrade.desc}</div><div class="si-price">${maxed ? '최대 단계' : this.costMarkup(upgrade.cost!)}</div>`
      if (!maxed && upgrade.affordable) item.onclick = () => onBuy(upgrade.id)
      box.appendChild(item)
    })
    const close = this.q<HTMLButtonElement>('#metaClose')
    close.onclick = () => { close.blur(); onClose() }
    this.q<HTMLDivElement>('#metaOv').classList.add('show')
  }

  showMetaShop(tokens: number, weapons: MetaWeaponView[], onBuy: (id: string) => void, onClose: () => void) {
    this.q('#metaHead').textContent = '모험가 상점'
    this.q('#metaSub').textContent = '증표로 무기 설계도를 해금합니다. 해금한 무기는 매 런 출발 전에 선택할 수 있습니다.'
    this.q('#metaResources').innerHTML = `<span class="meta-resource token">✦ 모험가 증표 <b>${tokens}</b></span>`
    const box = this.q('#metaItems')
    box.innerHTML = ''
    weapons.forEach((weapon) => {
      const item = document.createElement('div')
      const state = weapon.unlocked ? 'sold' : weapon.affordable ? '' : 'poor'
      item.className = `shop-item ${weapon.def.rarity} ${state}`
      item.innerHTML = `<div class="ctag">${weapon.def.kind === 'gun' ? '총' : '검'}</div><div class="si-icon">${weapon.def.icon}</div><div class="si-name">${weapon.def.name}</div><div class="si-desc">${weapon.def.desc}</div><div class="si-price">${weapon.unlocked ? '해금 완료' : `✦ ${weapon.price}`}</div>`
      if (!weapon.unlocked && weapon.affordable) item.onclick = () => onBuy(weapon.def.id)
      box.appendChild(item)
    })
    const close = this.q<HTMLButtonElement>('#metaClose')
    close.onclick = () => { close.blur(); onClose() }
    this.q<HTMLDivElement>('#metaOv').classList.add('show')
  }

  closeMeta() {
    this.q<HTMLDivElement>('#metaOv').classList.remove('show')
  }

  showLoadout(
    guns: GunDef[], swords: SwordDef[], selected: { gunId: string; swordId: string },
    onStart: (gunId: string, swordId: string) => void, onClose: () => void,
  ) {
    let gunId = selected.gunId
    let swordId = selected.swordId
    const renderChoices = <T extends WeaponDef>(boxId: string, items: T[], chosen: string, choose: (id: string) => void) => {
      const box = this.q(boxId)
      box.innerHTML = ''
      items.forEach((weapon) => {
        const item = document.createElement('div')
        item.className = `shop-item ${weapon.rarity}${weapon.id === chosen ? ' selected' : ''}`
        item.innerHTML = `<div class="si-icon">${weapon.icon}</div><div class="si-name">${weapon.name}</div><div class="si-desc">${weapon.desc}</div>`
        item.onclick = () => { choose(weapon.id); render() }
        box.appendChild(item)
      })
    }
    const render = () => {
      renderChoices('#loadoutGuns', guns, gunId, (id) => { gunId = id })
      renderChoices('#loadoutSwords', swords, swordId, (id) => { swordId = id })
    }
    render()
    const start = this.q<HTMLButtonElement>('#loadoutStart')
    start.onclick = () => { start.blur(); onStart(gunId, swordId) }
    const close = this.q<HTMLButtonElement>('#loadoutClose')
    close.onclick = () => { close.blur(); onClose() }
    this.q<HTMLDivElement>('#loadoutOv').classList.add('show')
  }

  closeLoadout() {
    this.q<HTMLDivElement>('#loadoutOv').classList.remove('show')
  }

  private resourceMarkup(crystals: Record<CrystalKind, number>) {
    return `<span class="meta-resource faint">◇ 희미한 결정 <b>${crystals.faint}</b></span><span class="meta-resource decent">◆ 준수한 결정 <b>${crystals.decent}</b></span><span class="meta-resource strong">✦ 강력한 결정 <b>${crystals.strong}</b></span>`
  }

  private costMarkup(cost: Partial<Record<CrystalKind, number>>) {
    const labels: Record<CrystalKind, string> = { faint: '◇', decent: '◆', strong: '✦' }
    return (Object.keys(cost) as CrystalKind[]).map((kind) => `${labels[kind]} ${cost[kind]}`).join('  ')
  }

  onStageClear(cb: () => void) {
    const btn = this.q('#clearBtn') as HTMLButtonElement
    btn.onclick = () => {
      btn.blur()
      this.q<HTMLDivElement>('#clearOv').classList.remove('show')
      cb()
    }
  }

  showStageClear(stage: number, kills: number, gold: number, level: number, reward?: { faint: number; decent: number; strong: number; tokens: number }) {
    this.q('#clearStats').innerHTML = `
      스테이지 <b>${stage}</b> 클리어! &nbsp;·&nbsp; 레벨 <b>${level}</b><br/>
      처치 <b>${kills}</b> &nbsp;·&nbsp; 획득 골드 <b>🪙 ${gold}</b>${reward ? `<br/><span class="clear-meta">◇ ${reward.faint} &nbsp;◆ ${reward.decent} &nbsp;✦ ${reward.strong} &nbsp; 모험가 증표 ${reward.tokens}</span>` : ''}`
    this.q<HTMLDivElement>('#clearOv').classList.add('show')
  }

  showGameOver(wave: number, kills: number, score: number, level: number) {
    this.q('#overStats').innerHTML = `
      도달 웨이브 <b>${wave}</b> &nbsp;·&nbsp; 레벨 <b>${level}</b><br/>
      처치 <b>${kills}</b> &nbsp;·&nbsp; 최종 점수 <b>${score}</b>`
    this.overOv.classList.add('show')
  }
}
