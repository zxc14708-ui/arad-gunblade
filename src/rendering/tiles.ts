import * as THREE from 'three'

/** 픽셀 타일 텍스처 생성기 (니어리스트, 캐시) */
const cache = new Map<string, THREE.Texture>()

function tex(key: string, size: number, draw: (x: CanvasRenderingContext2D, s: number) => void, repeat = 1): THREE.Texture {
  const ck = `${key}:${repeat}`
  let t = cache.get(ck)
  if (!t) {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    draw(ctx, size)
    t = new THREE.CanvasTexture(c)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    cache.set(ck, t)
  }
  return t
}

const P = (x: CanvasRenderingContext2D, px: number, py: number, s: number, c: string) => {
  x.fillStyle = c
  x.fillRect(px, py, s, s)
}
const pick = <T,>(arr: T[]) => arr[(Math.random() * arr.length) | 0]

/** 던전 석재 바닥 (타일 이음선 있는 4x4 슬랩) */
export const dungeonFloorTex = () =>
  tex('dfloor', 32, (x, S) => {
    const base = ['#3b3a44', '#43424e', '#3f3e49', '#484754']
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) P(x, i, j, 1, pick(base))
    // 타일 이음선 (16px 격자)
    x.fillStyle = '#2a2933'
    x.fillRect(0, 0, S, 1)
    x.fillRect(0, 16, S, 1)
    x.fillRect(0, 0, 1, S)
    x.fillRect(16, 0, 1, S)
    // 얼룩/균열
    for (let n = 0; n < 12; n++) P(x, (Math.random() * S) | 0, (Math.random() * S) | 0, 1, '#33323c')
    for (let n = 0; n < 5; n++) P(x, (Math.random() * S) | 0, (Math.random() * S) | 0, 1, '#4f4e5c')
  })

/** 던전 벽 (위쪽 밝은 캡 + 어두운 몸통) */
export const dungeonWallTex = () =>
  tex('dwall', 32, (x, S) => {
    const body = ['#2c2b34', '#32313b', '#2f2e38']
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) P(x, i, j, 1, pick(body))
    // 벽돌 이음선
    x.fillStyle = '#23222b'
    for (let j = 0; j < S; j += 8) x.fillRect(0, j, S, 1)
    for (let j = 0; j < S; j += 8) {
      const off = (j / 8) % 2 === 0 ? 0 : 8
      for (let i = off; i < S; i += 16) x.fillRect(i, j, 1, 8)
    }
    // 상단 하이라이트
    for (let i = 0; i < S; i++) P(x, i, 0, 1, '#4a4956')
  })

/** 타운 바닥 (잔디 + 흙길 느낌의 밝은 톤) */
export const townFloorTex = () =>
  tex('tfloor', 32, (x, S) => {
    const g = ['#3f6e33', '#487a38', '#417036', '#4f8340']
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) P(x, i, j, 1, pick(g))
    for (let n = 0; n < 26; n++) {
      const gx = (Math.random() * S) | 0
      const gy = (Math.random() * (S - 2)) | 0
      const c = Math.random() < 0.5 ? '#2f5626' : '#5b9247'
      P(x, gx, gy, 1, c)
      P(x, gx, gy + 1, 1, c)
    }
  })

/** 타운 석벽 (밝은 벽돌) */
export const townWallTex = () =>
  tex('twall', 32, (x, S) => {
    const body = ['#6b6357', '#756d60', '#706859']
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) P(x, i, j, 1, pick(body))
    x.fillStyle = '#544d43'
    for (let j = 0; j < S; j += 8) x.fillRect(0, j, S, 1)
    for (let j = 0; j < S; j += 8) {
      const off = (j / 8) % 2 === 0 ? 0 : 8
      for (let i = off; i < S; i += 16) x.fillRect(i, j, 1, 8)
    }
    for (let i = 0; i < S; i++) P(x, i, 0, 1, '#8a8274')
  })

/** 보스방 바닥 (붉은 마법진 톤) */
export const bossFloorTex = () =>
  tex('bfloor', 32, (x, S) => {
    const base = ['#43323a', '#4b3841', '#3e2f36', '#523c46']
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) P(x, i, j, 1, pick(base))
    x.fillStyle = '#31242a'
    x.fillRect(0, 0, S, 1)
    x.fillRect(0, 16, S, 1)
    x.fillRect(0, 0, 1, S)
    x.fillRect(16, 0, 1, S)
    for (let n = 0; n < 8; n++) P(x, (Math.random() * S) | 0, (Math.random() * S) | 0, 1, '#5e4550')
  })
