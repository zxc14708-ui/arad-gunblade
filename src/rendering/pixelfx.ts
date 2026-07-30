import * as THREE from 'three'
import { makePixelCanvasTexture } from './pixelArt'

/** 픽셀 이펙트용 캔버스 텍스처 (총알/적탄/파티클/베기) — 니어리스트 필터, 캐시 */
const cache = new Map<string, THREE.Texture>()

function make(key: string, size: number, draw: (x: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  let t = cache.get(key)
  if (!t) {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    draw(ctx, size)
    t = makePixelCanvasTexture(c)
    cache.set(key, t)
  }
  return t
}

const P = (x: CanvasRenderingContext2D, px: number, py: number, s: number, c: string) => {
  x.fillStyle = c
  x.fillRect(px, py, s, s)
}

export const bulletTex = () =>
  make('bullet', 8, (x) => {
    P(x, 2, 1, 4, '#fff6c0')
    P(x, 1, 2, 6, '#ffe066')
    P(x, 2, 2, 4, '#fffbe0')
    P(x, 3, 0, 2, '#ffd020')
    P(x, 3, 6, 2, '#ffd020')
  })

export const enemyBulletTex = () =>
  make('ebullet', 8, (x) => {
    P(x, 2, 1, 4, '#ff9ab0')
    P(x, 1, 2, 6, '#ff5a7a')
    P(x, 3, 3, 2, '#ffd0dd')
  })

export const puffTex = () =>
  make('puff', 8, (x) => {
    P(x, 1, 1, 6, '#ffffff')
    P(x, 0, 2, 8, '#ffffff')
    P(x, 2, 0, 4, '#ffffff')
    // 가운데만 남기고 모서리 비움(픽셀 원형)
    x.clearRect(0, 0, 2, 2)
    x.clearRect(6, 0, 2, 2)
    x.clearRect(0, 6, 2, 2)
    x.clearRect(6, 6, 2, 2)
  })

/** 베기 크레센트 — 지면에 눕혀 aim 방향으로 회전해서 사용 */
export const slashTex = () =>
  make('slash', 32, (x, s) => {
    const cx = 4
    const cy = s / 2
    for (let r = 10; r <= 28; r++) {
      for (let a = -0.7; a <= 0.7; a += 0.03) {
        const px = Math.round(cx + Math.cos(a) * r)
        const py = Math.round(cy + Math.sin(a) * r)
        const edge = Math.abs(a) > 0.5 || r < 13 || r > 26
        P(x, px, py, 1, edge ? '#fff2c0' : '#ffffff')
      }
    }
  })
