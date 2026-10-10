import * as THREE from 'three'
import { noOutline } from '../rendering/toon'
import { ASSET, cloneTex, loadTex } from '../rendering/assets'
import { makeBottomAnchoredSprite, makePixelCanvasTexture, setSpriteWorldHeight } from '../rendering/pixelArt'

export type InteractKind = 'chest' | 'fountain' | 'merchant' | 'portal' | 'traitAltar' | 'traitForge' | 'dungeonForge' | 'metaAltar'

// ── 프롭 텍스처 (제공된 픽셀 애셋) ──
const chestClosedTex = () => loadTex(ASSET.props.chestClosed)
const chestOpenTex = () => loadTex(ASSET.props.chestOpen)
const fountainTex = () => loadTex(ASSET.props.fountain)
const merchantTex = () => loadTex(ASSET.props.merchant)
const portalTex = () => loadTex(ASSET.props.portal)
const altarTex = () => loadTex(ASSET.props.traitAltar)
const forgeTex = () => loadTex(ASSET.props.traitForge)

const TEXFN: Record<InteractKind, () => THREE.Texture> = {
  chest: chestClosedTex,
  fountain: fountainTex,
  merchant: merchantTex,
  portal: portalTex,
  traitAltar: altarTex,
  traitForge: forgeTex,
  // 던전 제련소 — 전용 아트 없이 마을 제련소와 같은 룬석을 재사용(STATION_TINT로만 구분)
  dungeonForge: forgeTex,
  metaAltar: forgeTex,
}
const SCALE: Record<InteractKind, number> = {
  chest: 1.8, fountain: 2.8, merchant: 3.2, portal: 4.9, traitAltar: 3.4, traitForge: 3.4, dungeonForge: 3.4, metaAltar: 3.4,
}
/** 애셋 원본 종횡비(가로/세로) — 텍스처가 비동기 로드라 상수로 고정 */
const ASPECT: Record<InteractKind, number> = {
  chest: 24 / 20,
  fountain: 28 / 30,
  merchant: 26 / 34,
  portal: 2 / 3,
  traitAltar: 48 / 64,
  traitForge: 48 / 64,
  dungeonForge: 48 / 64,
  metaAltar: 48 / 64,
}
export const INTERACT_RANGE: Record<InteractKind, number> = {
  chest: 2.2,
  fountain: 2.4,
  merchant: 3.0,
  portal: 2.8,
  traitAltar: 2.6,
  traitForge: 2.6,
  dungeonForge: 2.6,
  metaAltar: 2.6,
}

/**
 * 마을 시설 색 구분 — 같은 룬석 아트를 임시로 쓰고 있어 색으로만 구분된다.
 * 전용 아트가 오면 이 표와 함께 걷어낼 수 있다.
 */
const STATION_TINT: Partial<Record<InteractKind, { body: number; ring: number }>> = {
  traitAltar: { body: 0xc9a6ff, ring: 0xa76cff },
  traitForge: { body: 0xffc98a, ring: 0xff9a3c },
  metaAltar: { body: 0x8ee8ff, ring: 0x4bb9ff },
  // 마을 제련소와 같은 색 계열(제련소 기능)이되 청록 링으로 구분 — 유료 던전 시설임을 표시
  dungeonForge: { body: 0xffc98a, ring: 0x3cd2ff },
}

/** 상호작용 가능한 월드 오브젝트 (빌보드 스프라이트 + 근접 판정) */
export class Interactable {
  kind: InteractKind
  group = new THREE.Group()
  pos = new THREE.Vector3()
  used = false
  /** 프롬프트에 표시할 라벨 */
  label: string
  private sprite: THREE.Sprite
  private mat: THREE.SpriteMaterial
  private glow: THREE.Sprite | null = null
  private bob = Math.random() * 6
  /** 스프라이트 월드 높이 — 이름표를 그 위에 띄울 때 쓴다. */
  private height: number
  /** NPC 대기 애니메이션(useNpcSheet) — 가로 시트 프레임 수와 재생 속도. */
  private npcAnim: { frames: number; fps: number; time: number; faceLeft: boolean } | null = null

  constructor(kind: InteractKind, x: number, z: number, label: string) {
    this.kind = kind
    this.label = label
    this.pos.set(x, 0, z)

    this.mat = new THREE.SpriteMaterial({
      map: TEXFN[kind](),
      color: kind === 'fountain' ? 0x8dffae : (STATION_TINT[kind]?.body ?? 0xffffff),
      transparent: true,
      depthWrite: false,
      depthTest: kind !== 'portal',
    })
    this.sprite = makeBottomAnchoredSprite(this.mat)
    this.sprite.renderOrder = kind === 'portal' ? 12 : 2
    const sc = SCALE[kind]
    this.height = sc
    setSpriteWorldHeight(this.sprite, sc, ASPECT[kind])
    this.group.add(this.sprite)

    // 발밑 그림자
    const shadowMat = noOutline(
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    )
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(sc * 0.3, 14), shadowMat)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    shadow.scale.set(1, 0.5, 1)
    this.group.add(shadow)

    // 포탈은 보랏빛 수직 관문, 분수는 초록빛 고정 수원, 마을 시설은 고유색 룬석.
    const tint = STATION_TINT[kind]
    if (kind === 'portal' || kind === 'fountain' || tint) {
      const glowColor = tint ? tint.ring : kind === 'portal' ? 0xb56cff : 0x72f7a0
      const gm = noOutline(
        new THREE.SpriteMaterial({
          map: TEXFN[kind](),
          color: glowColor,
          transparent: true,
          opacity: kind === 'fountain' ? 0.12 : 0.22,
          depthWrite: false,
          depthTest: false,
        }),
      )
      this.glow = makeBottomAnchoredSprite(gm)
      setSpriteWorldHeight(this.glow, sc * (kind === 'fountain' || tint ? 1.25 : 1.5), ASPECT[kind])
      this.glow.renderOrder = 11
      this.group.add(this.glow)

      if (kind === 'portal' || kind === 'fountain' || tint) {
        const ringColor = tint ? tint.ring : kind === 'portal' ? 0xb56cff : 0x65e99a
        const marker = noOutline(
          new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: kind === 'portal' ? 0.8 : 0.55, side: THREE.DoubleSide }),
        )
        const wide = kind !== 'portal'
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(sc * (wide ? 0.42 : 0.34), sc * (wide ? 0.55 : 0.5), 32),
          marker,
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.y = 0.045
        this.group.add(ring)
      }
    }

    this.group.position.copy(this.pos)
  }

  update(dt: number) {
    if (this.npcAnim) {
      const a = this.npcAnim
      a.time += dt
      const map = this.mat.map!
      const f = Math.floor(a.time * a.fps) % a.frames
      const fw = 1 / a.frames
      if (a.faceLeft) {
        map.offset.x = (f + 1) * fw
        map.repeat.x = -fw
      } else {
        map.offset.x = f * fw
        map.repeat.x = fw
      }
      return
    }
    this.bob += dt * 2.5
    // 포탈만 떠오르게 해 물이 고인 분수와 실루엣까지 구분한다.
    if (this.kind === 'portal') {
      this.sprite.position.y = Math.sin(this.bob) * 0.1
    } else if (this.kind === 'fountain') {
      this.sprite.position.y = Math.sin(this.bob) * 0.018
    }
    if (this.glow) {
      const m = this.glow.material as THREE.SpriteMaterial
      m.opacity = 0.2 + Math.sin(this.bob * 1.6) * 0.1
    }
  }

  /**
   * 머리 위 이름표(그림 한 장 마을의 NPC 자리 표시, 2026-10-10). NPC 스프라이트가
   * 오기 전까지 기존 시설 그림 위에 무엇을 하는 곳인지 글자로 띄운다.
   */
  setNameTag(text: string, color = '#ffe58a') {
    const font = 'bold 30px sans-serif'
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.font = font
    const w = Math.ceil(ctx.measureText(text).width) + 28
    const h = 46
    canvas.width = w
    canvas.height = h
    ctx.font = font
    ctx.fillStyle = 'rgba(12, 10, 8, 0.78)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, w - 2, h - 2)
    ctx.fillStyle = color
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 14, h / 2 + 1)
    const mat = new THREE.SpriteMaterial({ map: makePixelCanvasTexture(canvas), transparent: true, depthWrite: false, depthTest: false })
    const tag = makeBottomAnchoredSprite(mat)
    const worldH = 0.8
    tag.scale.set(worldH * (w / h), worldH, 1)
    tag.position.y = this.height + 0.35
    tag.renderOrder = 20
    this.group.add(tag)
    return this
  }

  /**
   * 시설 그림 대신 NPC 대기 시트(정사각 셀 가로 스트립)로 그린다(그림 마을, 2026-10-10).
   * 빛·바닥 고리는 숨긴다 — 그림 속에 서 있는 사람처럼 보이게. worldHeight는 셀
   * 높이에 대한 월드 크기로, 플레이어(셀 64px = 3.7)와 같은 값을 주면 픽셀 밀도가 같다.
   */
  useNpcSheet(path: string, frames: number, fps: number, worldHeight: number, faceLeft = false) {
    for (const child of this.group.children) if (child !== this.sprite) child.visible = false
    const tex = cloneTex(path)
    tex.repeat.set(1 / frames, 1)
    this.mat.map = tex
    this.mat.color.setRGB(1, 1, 1)
    this.mat.depthTest = true
    this.mat.needsUpdate = true
    this.height = worldHeight * 0.85 // 셀 위쪽 여백을 빼고 머리 위에 이름표가 오게
    setSpriteWorldHeight(this.sprite, worldHeight, 1)
    this.sprite.position.y = 0
    this.npcAnim = { frames, fps, time: Math.random(), faceLeft }
    return this
  }

  /** 그림(스프라이트·빛·바닥 고리)은 숨기고 상호작용과 이름표만 남긴다 — 그림 속 장소(예: 아치 길)를 시설로 쓸 때. */
  hideVisual() {
    for (const child of this.group.children) child.visible = false
    return this
  }

  /** 상자 열기 등 상태 변경 */
  markUsed() {
    this.used = true
    if (this.kind === 'chest') {
      this.mat.map = chestOpenTex()
      this.mat.needsUpdate = true
    } else if (this.kind === 'fountain') {
      this.mat.color.setRGB(0.5, 0.5, 0.55) // 사용된 분수는 어둡게
      if (this.glow) (this.glow.material as THREE.SpriteMaterial).opacity = 0.03
    } else if (STATION_TINT[this.kind]) {
      this.mat.color.setRGB(0.45, 0.45, 0.5) // 사용한 시설도 어둡게
      if (this.glow) (this.glow.material as THREE.SpriteMaterial).opacity = 0.03
    }
  }

  inRange(p: THREE.Vector3) {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) <= INTERACT_RANGE[this.kind]
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group)
    return this
  }
  removeFrom(scene: THREE.Scene) {
    scene.remove(this.group)
  }
}
