import * as THREE from 'three'
import type { EnemyKind } from './Enemy'
import { noOutline } from '../rendering/toon'
import { ASSET, cloneTex, loadTex } from '../rendering/assets'

export type EnemyAnimState = 'idle' | 'walk' | 'attack'

/** 각 애니메이션의 프레임 수 (시트 = 가로 스트립, 정사각 셀) */
const FRAMES: Record<EnemyKind, Record<EnemyAnimState, number>> = {
  imp: { idle: 4, walk: 6, attack: 4 },
  brute: { idle: 4, walk: 6, attack: 4 },
  shooter: { idle: 4, walk: 6, attack: 4 },
  boss: { idle: 4, walk: 6, attack: 6 },
}
const FPS: Record<EnemyAnimState, number> = { idle: 5, walk: 10, attack: 12 }
const SCALE: Record<EnemyKind, number> = { imp: 2.7, brute: 3.8, shooter: 2.8, boss: 5.7 }

/** 사망 연출 등 외부에서 적 텍스처/크기 참조용 (대기 시트 첫 프레임 기준) */
export function enemyTexture(kind: EnemyKind): THREE.Texture {
  return loadTex(ASSET.monsters[kind].idle)
}
export { SCALE as ENEMY_SCALE }

/**
 * 적 빌보드 스프라이트 — 상태별(대기/이동/공격) 프레임 애니메이션.
 * 시트는 가로 스트립이며 셀은 정사각(높이=셀 크기).
 */
export class EnemySprite {
  group = new THREE.Group()
  private sprite: THREE.Sprite
  private mat: THREE.SpriteMaterial
  private texes: Record<EnemyAnimState, THREE.Texture>
  private kind: EnemyKind
  private state: EnemyAnimState = 'idle'
  private time = 0
  private flip = 1
  /** 공격 모션 잔여 시간 */
  private attackTimer = 0

  constructor(kind: EnemyKind) {
    this.kind = kind
    const src = ASSET.monsters[kind]
    this.texes = {
      idle: cloneTex(src.idle),
      walk: cloneTex(src.walk),
      attack: cloneTex(src.attack),
    }
    for (const k of ['idle', 'walk', 'attack'] as EnemyAnimState[]) {
      this.texes[k].repeat.set(1 / FRAMES[kind][k], 1)
    }

    this.mat = new THREE.SpriteMaterial({ map: this.texes.idle, transparent: true, depthWrite: false })
    this.sprite = new THREE.Sprite(this.mat)
    this.sprite.center.set(0.5, 0)
    const sc = SCALE[kind]
    this.sprite.scale.set(sc, sc, 1)
    this.group.add(this.sprite)

    // 발밑 그림자
    const shadowMat = noOutline(
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    )
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(sc * 0.22, 14), shadowMat)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    shadow.scale.set(1, 0.55, 1)
    this.group.add(shadow)
  }

  /** 공격 모션 재생 (지속시간 동안 attack 상태 유지) */
  playAttack(duration = 0.45) {
    this.attackTimer = duration
  }

  /**
   * @param moving 이동 중인지
   * @param faceLeft 왼쪽을 보는지
   */
  update(dt: number, moving: boolean, faceLeft: boolean, hitFlash: number, bobY: number) {
    if (this.attackTimer > 0) this.attackTimer -= dt

    const next: EnemyAnimState = this.attackTimer > 0 ? 'attack' : moving ? 'walk' : 'idle'
    if (next !== this.state) {
      this.state = next
      this.time = 0
      this.mat.map = this.texes[next]
      this.mat.needsUpdate = true
    }
    this.time += dt

    const n = FRAMES[this.kind][this.state]
    const idx = Math.floor(this.time * FPS[this.state]) % n
    const fw = 1 / n
    const map = this.mat.map!
    this.flip = faceLeft ? -1 : 1
    if (faceLeft) {
      map.offset.x = (idx + 1) * fw
      map.repeat.x = -fw
    } else {
      map.offset.x = idx * fw
      map.repeat.x = fw
    }

    this.sprite.position.y = bobY

    // 피격 시 흰색 번쩍
    if (hitFlash > 0) this.mat.color.setRGB(2.4, 2.4, 2.4)
    else this.mat.color.setRGB(1, 1, 1)
  }
}
