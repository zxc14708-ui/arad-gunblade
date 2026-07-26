import * as THREE from 'three'
import { ASSET, cloneTex } from '../rendering/assets'

/**
 * 2D 주인공 빌보드 — GPT 제작 아트 시트(public/assets/player/) 사용.
 * 상태(대기/걷기/대시/베기/사격)마다 독립된 시트이며 전부 64x64 정사각 셀,
 * 발끝이 셀 하단에 오도록 정렬되어 있다 (center.set(0.5, 0) 기준).
 */
type AnimState = 'idle' | 'walk' | 'dash' | 'attack' | 'shoot'

const SHEETS: Record<AnimState, { path: string; frames: number }> = {
  idle: { path: ASSET.player.idle, frames: 4 },
  walk: { path: ASSET.player.walk, frames: 6 },
  dash: { path: ASSET.player.dash, frames: 4 },
  attack: { path: ASSET.player.slash, frames: 4 },
  shoot: { path: ASSET.player.shoot, frames: 4 },
}
// 베기/사격은 원샷 재생 — 실제 판정 지속시간(Player.ts swingAnim/shootAnim)에 맞춘 fps
const FPS: Record<AnimState, number> = { idle: 6, walk: 12, dash: 18, attack: 13, shoot: 25 }

export class CharacterSprite {
  object = new THREE.Group()
  private sprite: THREE.Sprite
  private mat: THREE.SpriteMaterial
  private shadow: THREE.Mesh
  private readonly baseH = 3.7
  private texes: Record<AnimState, THREE.Texture>
  private state: AnimState = 'idle'
  private animTime = 0
  private flip = 1

  constructor() {
    this.texes = {
      idle: cloneTex(SHEETS.idle.path),
      walk: cloneTex(SHEETS.walk.path),
      dash: cloneTex(SHEETS.dash.path),
      attack: cloneTex(SHEETS.attack.path),
      shoot: cloneTex(SHEETS.shoot.path),
    }
    for (const k of Object.keys(SHEETS) as AnimState[]) {
      this.texes[k].repeat.set(1 / SHEETS[k].frames, 1)
    }

    this.mat = new THREE.SpriteMaterial({ map: this.texes.idle, transparent: true, depthWrite: false })
    this.sprite = new THREE.Sprite(this.mat)
    this.sprite.center.set(0.5, 0)
    this.sprite.scale.set(this.baseH, this.baseH, 1) // 정사각 셀 → 가로세로 동일
    this.object.add(this.sprite)

    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    shadowMat.userData.outlineParameters = { visible: false }
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.02
    this.shadow.scale.set(1, 0.55, 1)
    this.object.add(this.shadow)
  }

  /** 대시 잔상용: 현재 프레임의 텍스처/UV/크기 정보 */
  ghostParams() {
    const map = this.mat.map!
    return {
      map,
      offsetX: map.offset.x,
      repeatX: map.repeat.x,
      sx: this.sprite.scale.x,
      sy: this.sprite.scale.y,
      bobY: this.sprite.position.y,
    }
  }

  private setFrame(idx: number, faceLeft: boolean) {
    const fw = 1 / SHEETS[this.state].frames
    const map = this.mat.map!
    if (faceLeft) {
      map.offset.x = (idx + 1) * fw
      map.repeat.x = -fw
    } else {
      map.offset.x = idx * fw
      map.repeat.x = fw
    }
  }

  update(
    dt: number,
    pos: THREE.Vector3,
    aimAngle: number,
    st: { moving: boolean; dashing: boolean; swinging: boolean; shooting: boolean; invulnerable: boolean },
    hitFlash: number,
  ) {
    // 조준 x성분으로 좌우 전환 (데드존 좁게 → 방향 전환이 굼뜨지 않게)
    if (Math.sin(aimAngle) < -0.05) this.flip = -1
    else if (Math.sin(aimAngle) > 0.05) this.flip = 1
    const faceLeft = this.flip < 0

    // 우선순위: 베기 > 사격 > 대시 > 걷기 > 대기
    const state: AnimState = st.swinging
      ? 'attack'
      : st.shooting
        ? 'shoot'
        : st.moving
          ? st.dashing
            ? 'dash'
            : 'walk'
          : 'idle'
    if (state !== this.state) {
      this.state = state
      this.animTime = 0
      this.mat.map = this.texes[state]
      this.mat.needsUpdate = true
    }
    this.animTime += dt

    const frames = SHEETS[state].frames
    const raw = Math.floor(this.animTime * FPS[state])
    // 베기/사격은 원샷(마지막 프레임 유지), 나머지는 루프
    const idx = state === 'attack' || state === 'shoot' ? Math.min(raw, frames - 1) : raw % frames
    this.setFrame(idx, faceLeft)

    const bob = st.moving ? Math.abs(Math.sin(this.animTime * (st.dashing ? 18 : 11))) * (st.dashing ? 0.14 : 0.08) : 0
    this.sprite.position.set(0, bob, 0)
    this.object.position.set(pos.x, 0, pos.z)

    if (hitFlash > 0) this.mat.color.setRGB(1, 0.45, 0.45)
    else this.mat.color.setRGB(1, 1, 1)
    this.mat.opacity = st.invulnerable && Math.floor(performance.now() / 70) % 2 === 0 ? 0.35 : 1
  }
}
