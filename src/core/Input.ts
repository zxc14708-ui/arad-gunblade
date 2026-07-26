/**
 * 키보드 / 마우스 입력 관리
 *
 * 키 고정(stuck key) 방지:
 *   창 포커스 상실(알트탭)·탭 전환·우클릭 메뉴 등에서 keyup 이벤트가 유실되면
 *   키가 계속 눌린 상태로 남아 캐릭터가 한 방향으로 고정된다.
 *   blur/visibilitychange/pagehide에서 초기화하고, 매 프레임 document.hasFocus()로
 *   이벤트가 유실된 경우까지 복구한다.
 */
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
    if (this.down('KeyW') || this.down('ArrowUp')) z -= 1
    if (this.down('KeyS') || this.down('ArrowDown')) z += 1
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1
    return { x, z }
  }
}
