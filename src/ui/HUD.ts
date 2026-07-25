import { Upgrade } from '../systems/Upgrades'
import { WeaponDef } from '../systems/Weapons'

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
  private volCb: ((kind: 'master' | 'music' | 'sfx', v: number) => void) | null = null

  constructor(container: HTMLElement) {
    this.root = document.createElement('div')
    this.root.id = 'ui'
    this.root.innerHTML = this.template()
    container.appendChild(this.root)
    this.floaterLayer = this.root

    this.elLevel = this.q('#sLevel')
    this.elWave = this.q('#sWave')
    this.elScore = this.q('#sScore')
    this.elKills = this.q('#sKills')
    this.hpFill = this.q('#hpFill')
    this.hpLabel = this.q('#hpLabel')
    this.xpFill = this.q('#xpFill')
    this.dashRing = this.q('#dashRing')
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
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T
  }

  private template(): string {
    return `
      <div class="hud-top">
        <div class="stat-row">
          <span>Lv <b id="sLevel">1</b></span>
          <span>웨이브 <b id="sWave">0</b></span>
          <span>처치 <b id="sKills">0</b></span>
          <span>점수 <b id="sScore">0</b></span>
        </div>
      </div>

      <button class="icon-btn" id="settingsBtn" title="설정 (Tab)">⚙️</button>

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
        <div class="ammo-label"><span id="gunName">M1911</span> · <kbd>R</kbd> 장전</div>
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
          <kbd>좌클릭</kbd> M1911 사격 (7발) &nbsp;·&nbsp; <kbd>R</kbd> 장전<br/>
          <kbd>우클릭</kbd> / <kbd>Space</kbd> 카타나 베기 &nbsp;·&nbsp; <kbd>Shift</kbd> 대시 (무적)<br/>
          <kbd>Tab</kbd> 설정 · 획득 특성 보기<br/><br/>
          밀려오는 마족을 처치하고, 레벨업마다 능력을 강화하라.<br/>
          5웨이브마다 <b style="color:#e0554f">보스</b>가 등장한다.
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

      <div class="overlay" id="overOv">
        <div class="title" style="color:#e0554f">YOU DIED</div>
        <div class="gameover-stats" id="overStats"></div>
        <button class="btn" id="restartBtn">다시 도전</button>
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

  openSettings(
    traits: { upgrade: Upgrade; count: number }[],
    vol: { master: number; music: number; sfx: number },
    equip?: { gun: string; gunIcon: string; sword: string; swordIcon: string },
  ) {
    // 슬라이더를 현재 음량에 맞춤
    const set = (id: string, valId: string, v: number) => {
      ;(this.q(id) as HTMLInputElement).value = String(Math.round(v * 100))
      this.q(valId).textContent = Math.round(v * 100) + '%'
    }
    set('#volMaster', '#volMasterV', vol.master)
    set('#volMusic', '#volMusicV', vol.music)
    set('#volSfx', '#volSfxV', vol.sfx)

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
    this.settingsOv.classList.remove('show')
  }

  /** 탄약 표시 갱신 */
  setAmmo(ammo: number, mag: number, reloading: boolean, ratio: number, gunName?: string) {
    if (ammo !== this.lastAmmo || mag !== this.lastMag) {
      this.lastAmmo = ammo
      this.lastMag = mag
      // 탄알 핍 재구성 (너무 많으면 숫자만)
      if (mag <= 14) {
        let pips = ''
        for (let i = 0; i < mag; i++) pips += `<i class="${i < ammo ? 'on' : 'off'}"></i>`
        this.ammoPips.innerHTML = pips
      } else {
        this.ammoPips.innerHTML = ''
      }
    }
    if (gunName) this.q('#gunName').textContent = gunName
    this.ammoBox.classList.toggle('reloading', reloading)
    this.ammoText.textContent = reloading ? `장전 중… ${Math.round(ratio * 100)}%` : `${ammo} / ${mag}`
  }

  setStats(level: number, wave: number, kills: number, score: number) {
    this.elLevel.textContent = String(level)
    this.elWave.textContent = String(wave)
    this.elKills.textContent = String(kills)
    this.elScore.textContent = String(score)
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

  showGameOver(wave: number, kills: number, score: number, level: number) {
    this.q('#overStats').innerHTML = `
      도달 웨이브 <b>${wave}</b> &nbsp;·&nbsp; 레벨 <b>${level}</b><br/>
      처치 <b>${kills}</b> &nbsp;·&nbsp; 최종 점수 <b>${score}</b>`
    this.overOv.classList.add('show')
  }
}
