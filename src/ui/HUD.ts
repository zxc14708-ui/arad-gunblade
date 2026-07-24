import { Upgrade } from '../systems/Upgrades'

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

      <div id="bossBar">
        <div class="name">◆ 마계의 지배자 ◆</div>
        <div class="bar"><div class="fill" id="bossFill" style="width:100%"></div></div>
      </div>

      <div class="hud-bars">
        <div class="bar" id="hpBar"><div class="fill" id="hpFill" style="width:100%"></div><div class="label" id="hpLabel">100 / 100</div></div>
        <div class="bar" id="xpBar"><div class="fill" id="xpFill" style="width:0%"></div></div>
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
          <kbd>좌클릭</kbd> 리볼버 연사 &nbsp;·&nbsp; <kbd>우클릭</kbd> / <kbd>Space</kbd> 카타나 베기<br/>
          <kbd>Shift</kbd> 대시 회피 (무적)<br/><br/>
          밀려오는 마족을 처치하고, 레벨업마다 능력을 강화하라.<br/>
          5웨이브마다 <b style="color:#e0554f">보스</b>가 등장한다.
        </div>
        <button class="btn" id="startBtn">게임 시작</button>
      </div>

      <div class="overlay" id="levelOv">
        <div class="levelup-head">LEVEL UP!</div>
        <div class="levelup-sub">강화할 능력을 선택하세요</div>
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
    ;(this.q('#startBtn') as HTMLButtonElement).onclick = () => {
      this.startOv.classList.remove('show')
      cb()
    }
  }
  onRestart(cb: () => void) {
    ;(this.q('#restartBtn') as HTMLButtonElement).onclick = () => {
      this.overOv.classList.remove('show')
      cb()
    }
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

  showLevelUp(choices: Upgrade[], onPick: (u: Upgrade) => void) {
    const cards = this.q('#cards')
    cards.innerHTML = ''
    for (const u of choices) {
      const card = document.createElement('div')
      card.className = `card ${u.rarity}`
      card.innerHTML = `
        <div class="cicon">${u.icon}</div>
        <div class="cname">${u.name}</div>
        <div class="cdesc">${u.desc}</div>
        <div class="crar">${u.rarity}</div>`
      card.onclick = () => {
        this.levelOv.classList.remove('show')
        onPick(u)
      }
      cards.appendChild(card)
    }
    this.levelOv.classList.add('show')
  }

  showGameOver(wave: number, kills: number, score: number, level: number) {
    this.q('#overStats').innerHTML = `
      도달 웨이브 <b>${wave}</b> &nbsp;·&nbsp; 레벨 <b>${level}</b><br/>
      처치 <b>${kills}</b> &nbsp;·&nbsp; 최종 점수 <b>${score}</b>`
    this.overOv.classList.add('show')
  }
}
