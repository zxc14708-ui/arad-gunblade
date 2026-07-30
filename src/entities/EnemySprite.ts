import * as THREE from 'three'
import { CONFIG } from '../config'
import type { EnemyKind } from './Enemy'
import { noOutline } from '../rendering/toon'
import { ASSET, cloneTex } from '../rendering/assets'
import { makeBottomAnchoredSprite, setSpriteWorldHeight } from '../rendering/pixelArt'

export type EnemyAnimState = 'idle' | 'walk' | 'attack' | 'charge'
type StandardEnemyAnimState = Exclude<EnemyAnimState, 'charge'>
type EnemyFrames = Record<StandardEnemyAnimState, number> & Partial<Record<'charge', number>>

/**
 * 각 애니메이션의 프레임 수 (시트 = 가로 스트립, 정사각 셀)
 * 시트 규격은 tools/measure_sprites.py 로 검사한다 — 셀 크기·프레임 수가 맞고
 * 모든 프레임의 발이 셀 아래변에 닿아 있어야 이 단순한 렌더링이 성립한다.
 */
const FRAMES: Record<EnemyKind, EnemyFrames> = {
  imp: { idle: 4, walk: 6, attack: 4 },
  brute: { idle: 4, walk: 6, attack: 4 },
  shooter: { idle: 4, walk: 6, attack: 4 },
  boss: { idle: 4, walk: 6, attack: 6, charge: 6 },
}
const FPS: Record<EnemyAnimState, number> = { idle: 5, walk: 10, attack: 12, charge: 12 }

/** 셀(=캐릭터) 월드 높이 */
const SCALE: Record<EnemyKind, number> = { imp: 2.2, brute: 3.5, shooter: 2.4, boss: 5.4 }

/**
 * 사망 연출용 스프라이트 재료 — 대기 시트의 첫 프레임 기준.
 * (시트 전체를 그대로 넘기면 프레임 4장이 가로로 눌려 나온다)
 */
export function enemyDeathArt(kind: EnemyKind): { map: THREE.Texture; scale: number } {
  const map = cloneTex(ASSET.monsters[kind].idle)
  map.repeat.set(1 / FRAMES[kind].idle, 1)
  return { map, scale: SCALE[kind] }
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
  private texes: Record<StandardEnemyAnimState, THREE.Texture> & Partial<Record<'charge', THREE.Texture>>
  private kind: EnemyKind
  private state: EnemyAnimState = 'idle'
  private time = 0
  private flip = 1
  /** 공격 모션 잔여 시간 */
  private attackTimer = 0
  private chargeTimer = 0

  constructor(kind: EnemyKind) {
    this.kind = kind
    const src = ASSET.monsters[kind]
    this.texes = {
      idle: cloneTex(src.idle),
      walk: cloneTex(src.walk),
      attack: cloneTex(src.attack),
    }
    for (const k of ['idle', 'walk', 'attack'] as StandardEnemyAnimState[]) {
      this.texes[k].repeat.set(1 / FRAMES[kind][k], 1)
    }
    if ('charge' in src) {
      this.texes.charge = cloneTex(src.charge)
      this.texes.charge.repeat.set(1 / (FRAMES[kind].charge ?? 1), 1)
    }

    this.mat = new THREE.SpriteMaterial({ map: this.texes.idle, transparent: true, depthWrite: false })
    this.sprite = makeBottomAnchoredSprite(this.mat)
    const sc = SCALE[kind]
    setSpriteWorldHeight(this.sprite, sc)
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

  /** 보스 돌진 예고/실행 모션. charge 시트가 없는 적은 무시한다. */
  playCharge(duration: number) {
    if (this.texes.charge) this.chargeTimer = duration
  }

  /**
   * @param moving 이동 중인지
   * @param faceLeft 왼쪽을 보는지
   */
  update(dt: number, moving: boolean, faceLeft: boolean, hitFlash: number, hitFlashCrit: boolean, bobY: number) {
    if (this.attackTimer > 0) this.attackTimer -= dt
    if (this.chargeTimer > 0) this.chargeTimer -= dt

    const next: EnemyAnimState = this.chargeTimer > 0 && this.texes.charge
      ? 'charge'
      : this.attackTimer > 0 ? 'attack' : moving ? 'walk' : 'idle'
    if (next !== this.state) {
      this.state = next
      this.time = 0
      this.mat.map = this.texes[next] ?? this.texes.idle
      this.mat.needsUpdate = true
    }
    this.time += dt

    const n = FRAMES[this.kind][this.state] ?? FRAMES[this.kind].idle
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

    // 피격 시 번쩍 — 텍스처는 그대로 두고 SpriteMaterial.color 배율만 조작한다.
    // 보스는 매 명중마다 번쩍이면 시야를 방해하므로 강도를 절반으로 낮춘다
    // (지속시간은 Enemy.ts에서 이미 짧게 준다).
    if (hitFlash > 0) {
      const peak = CONFIG.effects.flashIntensity * (this.kind === 'boss' ? CONFIG.effects.flashBossIntensityMul : 1)
      if (hitFlashCrit) this.mat.color.setRGB(peak, peak, peak * 0.3) // 치명타는 흰색 대신 노란색
      else this.mat.color.setRGB(peak, peak, peak)
    } else {
      this.mat.color.setRGB(1, 1, 1)
    }
  }
}
