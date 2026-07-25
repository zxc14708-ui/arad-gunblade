import * as THREE from 'three'
import { CONFIG } from '../config'
import { noOutline } from '../rendering/toon'

/** 픽셀아트 잔디 필드 아레나 (위즈 오브 레전드 풍 2.5D) */
export class Dungeon {
  group = new THREE.Group()
  radius = CONFIG.arenaRadius

  constructor(scene: THREE.Scene) {
    // ── 잔디 타일 바닥 ──
    const grassTex = new THREE.CanvasTexture(makeGrassTile())
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping
    grassTex.magFilter = THREE.NearestFilter
    grassTex.minFilter = THREE.NearestFilter
    grassTex.colorSpace = THREE.SRGBColorSpace
    grassTex.repeat.set(this.radius, this.radius) // 타일당 ~2월드유닛
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius + 1, 40),
      noOutline(new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 })),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.group.add(floor)

    // ── 흙 길 패치(장식) ──
    const dirtTex = new THREE.CanvasTexture(makeDirtTile())
    dirtTex.magFilter = THREE.NearestFilter
    dirtTex.minFilter = THREE.NearestFilter
    dirtTex.colorSpace = THREE.SRGBColorSpace
    const dirtMat = noOutline(new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1, transparent: true }))
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * (this.radius - 6)
      const patch = new THREE.Mesh(new THREE.CircleGeometry(2 + Math.random() * 2.5, 16), dirtMat)
      patch.rotation.x = -Math.PI / 2
      patch.position.set(Math.cos(a) * r, 0.01, Math.sin(a) * r)
      this.group.add(patch)
    }

    // ── 바깥 어두운 영역(경계 프레임) ──
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(this.radius + 1, this.radius + 30, 48),
      noOutline(new THREE.MeshBasicMaterial({ color: 0x0c1408 })),
    )
    outer.rotation.x = -Math.PI / 2
    outer.position.y = -0.02
    this.group.add(outer)

    // ── 경계 바위/덤불 장식 (빌보드) ──
    const rockTex = new THREE.CanvasTexture(makeRock())
    rockTex.magFilter = THREE.NearestFilter
    rockTex.colorSpace = THREE.SRGBColorSpace
    const bushTex = new THREE.CanvasTexture(makeBush())
    bushTex.magFilter = THREE.NearestFilter
    bushTex.colorSpace = THREE.SRGBColorSpace
    const rockMat = noOutline(new THREE.SpriteMaterial({ map: rockTex, transparent: true }))
    const bushMat = noOutline(new THREE.SpriteMaterial({ map: bushTex, transparent: true }))
    const count = 26
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.2
      const r = this.radius + 0.3 + Math.random() * 1.2
      const useBush = Math.random() < 0.55
      const sp = new THREE.Sprite(useBush ? bushMat : rockMat)
      sp.center.set(0.5, 0)
      const sc = useBush ? 2.2 + Math.random() : 1.6 + Math.random() * 0.8
      sp.scale.set(sc, sc, 1)
      sp.position.set(Math.cos(a) * r, 0, Math.sin(a) * r)
      this.group.add(sp)
    }
    // 필드 안쪽 흩뿌린 덤불 몇 개
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 4 + Math.random() * (this.radius - 8)
      const sp = new THREE.Sprite(bushMat)
      sp.center.set(0.5, 0)
      const sc = 1.5 + Math.random()
      sp.scale.set(sc, sc, 1)
      sp.position.set(Math.cos(a) * r, 0, Math.sin(a) * r)
      this.group.add(sp)
    }

    scene.add(this.group)
  }

  randomEdgePoint(): { x: number; z: number } {
    const a = Math.random() * Math.PI * 2
    const r = this.radius - 2
    return { x: Math.cos(a) * r, z: Math.sin(a) * r }
  }
}

// ── 픽셀 텍스처 생성기 ──
function px(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, c: string) {
  ctx.fillStyle = c
  ctx.fillRect(x, y, s, s)
}

function makeGrassTile(): HTMLCanvasElement {
  const S = 32
  const c = document.createElement('canvas')
  c.width = c.height = S
  const x = c.getContext('2d')!
  const greens = ['#3f6e33', '#487a38', '#417036', '#4f8340', '#396630']
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) px(x, i, j, 1, greens[(Math.random() * greens.length) | 0])
  // 풀잎(짧은 세로선)
  for (let n = 0; n < 26; n++) {
    const gx = (Math.random() * S) | 0
    const gy = (Math.random() * (S - 3)) | 0
    const c2 = Math.random() < 0.5 ? '#2f5626' : '#5b9247'
    px(x, gx, gy, 1, c2)
    px(x, gx, gy + 1, 1, c2)
  }
  return c
}

function makeDirtTile(): HTMLCanvasElement {
  const S = 32
  const c = document.createElement('canvas')
  c.width = c.height = S
  const x = c.getContext('2d')!
  const browns = ['#6b4a2c', '#5c3f26', '#755231', '#634527']
  const cx = S / 2
  for (let i = 0; i < S; i++)
    for (let j = 0; j < S; j++) {
      const d = Math.hypot(i - cx, j - cx) / cx
      if (d > 0.92) continue // 원형 페이드
      x.globalAlpha = d > 0.7 ? 0.5 : 1
      px(x, i, j, 1, browns[(Math.random() * browns.length) | 0])
    }
  x.globalAlpha = 1
  for (let n = 0; n < 10; n++) px(x, (Math.random() * S) | 0, (Math.random() * S) | 0, 1, '#3f2c19')
  return c
}

function makeRock(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 24
  c.height = 24
  const x = c.getContext('2d')!
  const body = '#7a7d84'
  const dark = '#565962'
  const light = '#9a9da4'
  // 둥근 바위
  x.fillStyle = body
  x.beginPath()
  x.ellipse(12, 15, 9, 7, 0, 0, 7)
  x.fill()
  x.fillStyle = dark
  x.beginPath()
  x.ellipse(12, 18, 9, 4, 0, 0, 7)
  x.fill()
  px(x, 8, 11, 2, light)
  px(x, 14, 12, 2, light)
  return c
}

function makeBush(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 28
  c.height = 28
  const x = c.getContext('2d')!
  const g1 = '#2f5626'
  const g2 = '#3f6e33'
  const g3 = '#4f8340'
  const blobs = [
    [14, 20, 8],
    [8, 18, 5],
    [20, 18, 5],
    [14, 14, 6],
  ]
  for (const [bx, by, r] of blobs) {
    x.fillStyle = g1
    x.beginPath()
    x.arc(bx, by, r, 0, 7)
    x.fill()
  }
  for (const [bx, by, r] of blobs) {
    x.fillStyle = g2
    x.beginPath()
    x.arc(bx, by - 1, r - 1, 0, 7)
    x.fill()
  }
  px(x, 12, 11, 2, g3)
  px(x, 16, 13, 2, g3)
  return c
}
