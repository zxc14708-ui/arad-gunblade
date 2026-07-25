import * as THREE from 'three'
import type { EnemyKind } from './Enemy'
import { noOutline } from '../rendering/toon'

const texCache = new Map<EnemyKind, THREE.Texture>()

function tex(kind: EnemyKind): THREE.Texture {
  let t = texCache.get(kind)
  if (!t) {
    t = new THREE.CanvasTexture(drawEnemy(kind))
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.colorSpace = THREE.SRGBColorSpace
    texCache.set(kind, t)
  }
  return t
}

const SCALE: Record<EnemyKind, number> = { imp: 1.7, brute: 3.0, shooter: 2.0, boss: 4.2 }

/** 적 빌보드 스프라이트 + 그림자. 반환 group을 씬에 추가하고, mat로 피격 틴트. */
export function buildEnemySprite(kind: EnemyKind): { group: THREE.Group; mat: THREE.SpriteMaterial } {
  const group = new THREE.Group()
  const mat = new THREE.SpriteMaterial({ map: tex(kind), transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.center.set(0.5, 0)
  const sc = SCALE[kind]
  sprite.scale.set(sc, sc, 1)
  group.add(sprite)

  const shadowMat = noOutline(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }))
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(sc * 0.28, 16), shadowMat)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.02
  shadow.scale.set(1, 0.55, 1)
  group.add(shadow)

  return { group, mat }
}

// ── 픽셀 적 그리기 ──
function P(x: CanvasRenderingContext2D, px: number, py: number, s: number, c: string) {
  x.fillStyle = c
  x.fillRect(px, py, s, s)
}
function blob(x: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, c: string) {
  x.fillStyle = c
  x.beginPath()
  x.ellipse(cx, cy, rx, ry, 0, 0, 7)
  x.fill()
}

function drawEnemy(kind: EnemyKind): HTMLCanvasElement {
  const W = 48
  const H = 56
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')!
  x.imageSmoothingEnabled = false

  if (kind === 'imp') demon(x, W, H, { body: '#a83149', dark: '#7a2236', horn: '#f0d0a0', eye: '#ffe066', scale: 1 })
  else if (kind === 'brute') demon(x, W, H, { body: '#6d4a7a', dark: '#4c3358', horn: '#e8c8a0', eye: '#ff7a4a', scale: 1.25 })
  else if (kind === 'shooter') caster(x, W, H)
  else boss(x, W, H)

  return c
}

function demon(
  x: CanvasRenderingContext2D,
  W: number,
  H: number,
  o: { body: string; dark: string; horn: string; eye: string; scale: number },
) {
  const cx = W / 2
  const s = o.scale
  const outline = '#1a0e14'
  // 다리
  P(x, cx - 8 * s, H - 8, 5, o.dark)
  P(x, cx + 3 * s, H - 8, 5, o.dark)
  // 몸통
  x.strokeStyle = outline
  x.lineWidth = 2
  blob(x, cx, H - 16 * s, 12 * s, 12 * s, o.body)
  x.stroke()
  blob(x, cx, H - 16 * s, 12 * s, 12 * s, o.body)
  // 배 밝은 부분
  blob(x, cx, H - 12 * s, 6 * s, 5 * s, o.dark)
  // 팔
  blob(x, cx - 12 * s, H - 18 * s, 4 * s, 6 * s, o.body)
  blob(x, cx + 12 * s, H - 18 * s, 4 * s, 6 * s, o.body)
  // 머리
  const hy = H - 30 * s
  blob(x, cx, hy, 9 * s, 8 * s, o.body)
  // 뿔
  x.fillStyle = o.horn
  x.beginPath()
  x.moveTo(cx - 8 * s, hy - 4 * s)
  x.lineTo(cx - 12 * s, hy - 12 * s)
  x.lineTo(cx - 4 * s, hy - 6 * s)
  x.fill()
  x.beginPath()
  x.moveTo(cx + 8 * s, hy - 4 * s)
  x.lineTo(cx + 12 * s, hy - 12 * s)
  x.lineTo(cx + 4 * s, hy - 6 * s)
  x.fill()
  // 눈 (발광)
  P(x, cx - 5 * s, hy - 1, 3 * s, o.eye)
  P(x, cx + 2 * s, hy - 1, 3 * s, o.eye)
}

function caster(x: CanvasRenderingContext2D, W: number, H: number) {
  const cx = W / 2
  const robe = '#2a6a7a'
  const dark = '#1a4a56'
  // 로브 (원뿔)
  x.fillStyle = robe
  x.beginPath()
  x.moveTo(cx, H - 40)
  x.lineTo(cx - 14, H - 6)
  x.lineTo(cx + 14, H - 6)
  x.closePath()
  x.fill()
  x.fillStyle = dark
  x.fillRect(cx - 2, H - 34, 4, 28)
  // 후드/머리
  blob(x, cx, H - 40, 9, 9, dark)
  // 발광 눈
  P(x, cx - 4, H - 42, 3, '#6ad0ff')
  P(x, cx + 1, H - 42, 3, '#6ad0ff')
  // 떠다니는 오브
  blob(x, cx + 12, H - 26, 4, 4, '#ff5a7a')
  P(x, cx + 11, H - 27, 2, '#ffd0dd')
}

function boss(x: CanvasRenderingContext2D, W: number, H: number) {
  const cx = W / 2
  const body = '#b02a2a'
  const dark = '#7a1010'
  const outline = '#2a0808'
  // 다리
  P(x, cx - 9, H - 7, 6, dark)
  P(x, cx + 3, H - 7, 6, dark)
  // 몸통
  x.strokeStyle = outline
  x.lineWidth = 2
  blob(x, cx, H - 18, 15, 14, body)
  x.stroke()
  blob(x, cx, H - 18, 15, 14, body)
  blob(x, cx, H - 13, 8, 6, dark)
  // 팔
  blob(x, cx - 15, H - 20, 5, 8, body)
  blob(x, cx + 15, H - 20, 5, 8, body)
  // 머리
  const hy = H - 36
  blob(x, cx, hy, 11, 10, body)
  // 큰 뿔
  x.fillStyle = '#e8c8a0'
  x.beginPath(); x.moveTo(cx - 9, hy - 5); x.lineTo(cx - 16, hy - 18); x.lineTo(cx - 3, hy - 8); x.fill()
  x.beginPath(); x.moveTo(cx + 9, hy - 5); x.lineTo(cx + 16, hy - 18); x.lineTo(cx + 3, hy - 8); x.fill()
  // 금 왕관
  x.fillStyle = '#ffd070'
  x.fillRect(cx - 8, hy - 6, 16, 3)
  // 성난 눈
  P(x, cx - 6, hy - 1, 4, '#ffe066')
  P(x, cx + 2, hy - 1, 4, '#ffe066')
}
