/**
 * 키보드 / 마우스 입력 관리
 *
 * 키 고정(stuck key) 방지:
 *   창 포커스 상실(알트탭)·탭 전환·우클릭 메뉴 등에서 keyup 이벤트가 유실되면
 *   키가 계속 눌린 상태로 남아 캐릭터가 한 방향으로 고정된다.
 *   blur/visibilitychange/pagehide에서 초기화하고, 매 프레임 document.hasFocus()로
 *   이벤트가 유실된 경우까지 복구한다.
 */
export type KeyAction =
  | 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight'
  | 'dash' | 'slash' | 'reload' | 'charge' | 'doubleShot' | 'ultimate' | 'interact'

export type KeyBindings = Record<KeyAction, string>

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  moveUp: '위로 이동', moveDown: '아래로 이동', moveLeft: '왼쪽 이동', moveRight: '오른쪽 이동',
  dash: '대시', slash: '베기', reload: '장전', charge: '돌진', doubleShot: '더블 샷', ultimate: '궁극기', interact: '상호작용',
}

const DEFAULT_BINDINGS: KeyBindings = {
  moveUp: 'KeyW', moveDown: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD',
  dash: 'ShiftLeft', slash: 'Space', reload: 'KeyT', charge: 'KeyQ', doubleShot: 'KeyE', ultimate: 'KeyR', interact: 'KeyE',
}

export function keyLabel(code: string) {
  const names: Record<string, string> = {
    Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  }
  if (names[code]) return names[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

export class Input {
  keys = new Set<string>()
  /** 이번 프레임까지 '눌린 적 있는' 키 — 빠른 탭이 프레임 사이에 유실되지 않게 래치 */
  private pressed = new Set<string>()
  mouseDown = false
  rightDown = false
  /** 마우스의 NDC 좌표 (-1..1) */
  ndc = { x: 0, y: 0 }
  private el: HTMLElement
  private hadFocus = true
  private bindings: KeyBindings = { ...DEFAULT_BINDINGS }

  constructor(el: HTMLElement) {
    this.el = el
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKeyUp)
    el.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMove)
    el.addEventListener('contextmenu', (e) => e.preventDefault())

    // 포커스/가시성 변화 시 입력 초기화
    window.addEventListener('blur', this.clearAll)
    window.addEventListener('pagehide', this.clearAll)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clearAll()
    })
    try {
      const saved = JSON.parse(localStorage.getItem('arad_keybinds') || '{}') as Partial<KeyBindings>
      for (const action of Object.keys(DEFAULT_BINDINGS) as KeyAction[]) {
        if (typeof saved[action] === 'string' && saved[action]) this.bindings[action] = saved[action]!
      }
    } catch {
      /* Keep defaults when browser storage is unavailable or invalid. */
    }
  }

  get keyBindings(): KeyBindings {
    return { ...this.bindings }
  }

  rebind(action: KeyAction, code: string) {
    if (!code || code === 'Escape' || code === 'Tab') return false
    const occupied = (Object.keys(this.bindings) as KeyAction[]).find((name) => name !== action && this.bindings[name] === code)
    if (occupied) return false
    this.bindings[action] = code
    try {
      localStorage.setItem('arad_keybinds', JSON.stringify(this.bindings))
    } catch {
      /* The active session still keeps the newly selected key. */
    }
    this.clearAll()
    return true
  }

  downAction(action: KeyAction) {
    return this.down(this.bindings[action])
  }

  consumeAction(action: KeyAction) {
    return this.consumePress(this.bindings[action])
  }

  /** 눌린 키·버튼 전부 해제 */
  clearAll = () => {
    this.keys.clear()
    this.pressed.clear()
    this.mouseDown = false
    this.rightDown = false
  }

  /**
   * 키가 '눌렸는가'를 한 번만 소비한다(엣지 트리거).
   * keydown~keyup이 한 프레임 안에 끝나도 유실되지 않는다.
   */
  consumePress(code: string) {
    if (!this.pressed.has(code)) return false
    this.pressed.delete(code)
    return true
  }

  /** 매 프레임 호출 — 포커스가 빠진 사이 유실된 keyup을 복구 */
  update() {
    const focused = document.hasFocus()
    if (this.hadFocus && !focused) this.clearAll()
    this.hadFocus = focused
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return // IME 조합 중에는 무시(keyup 유실 방지)
    this.keys.add(e.code)
    if (!e.repeat) this.pressed.add(e.code) // 최초 눌림만 래치
    // 스크롤 방지
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault()
  }
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code)

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = true
    if (e.button === 2) this.rightDown = true
    this.updateNdc(e)
  }
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false
    if (e.button === 2) this.rightDown = false
  }
  private onMove = (e: MouseEvent) => this.updateNdc(e)

  private updateNdc(e: MouseEvent) {
    const r = this.el.getBoundingClientRect()
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1
  }

  down(code: string) {
    return this.keys.has(code)
  }

  /** WASD / 방향키 이동 벡터 (정규화 전) */
  moveVector() {
    let x = 0
    let z = 0
    if (this.downAction('moveUp') || this.down('ArrowUp')) z -= 1
    if (this.downAction('moveDown') || this.down('ArrowDown')) z += 1
    if (this.downAction('moveLeft') || this.down('ArrowLeft')) x -= 1
    if (this.downAction('moveRight') || this.down('ArrowRight')) x += 1
    return { x, z }
  }
}
