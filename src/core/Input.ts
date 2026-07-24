/** 키보드 / 마우스 입력 관리 */
export class Input {
  keys = new Set<string>()
  mouseDown = false
  rightDown = false
  /** 마우스의 NDC 좌표 (-1..1) */
  ndc = { x: 0, y: 0 }
  private el: HTMLElement

  constructor(el: HTMLElement) {
    this.el = el
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKeyUp)
    el.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMove)
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private onKey = (e: KeyboardEvent) => {
    this.keys.add(e.code)
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
