import * as THREE from 'three'
import type { EnemyKind } from './Enemy'
import { noOutline } from '../rendering/toon'
import { ASSET, cloneTex } from '../rendering/assets'

export type EnemyAnimState = 'idle' | 'walk' | 'attack'

/** 시트 실측값 — tools/measure_sprites.py 로 뽑는다 */
interface SheetMetrics {
  /** 정사각 셀 한 변(px) */
  cell: number
  /** 가로 스트립 프레임 수 */
  frames: number
  /** 셀 안 캐릭터 높이(px, 프레임별 중앙값) */
  bodyH: number
  /** 셀 안 발 y좌표(px, 프레임별 중앙값) */
  feetY: number
}

/**
 * 같은 몬스터인데도 시트마다 캐릭터가 셀 안에서 다른 크기·위치로 그려져 있다.
 * 걷기 시트는 셀을 꽉 채우고 발이 바닥에 닿지만, 대기/공격 시트는 셀 중앙에
 * 40~50% 크기로 떠 있다. 셀 기준으로 그리면 동작이 바뀔 때마다 몬스터가
 * 2배 이상 커졌다 작아지고, 공중에 뜬 채로 보인다.
 *
 * 아트를 리스케일하면 원본 픽셀 디테일이 뭉개지므로 렌더 단계에서 보정한다.
 * 시트를 교체하면 tools/measure_sprites.py 를 다시 돌려 이 표를 갱신할 것.
 */
const ART: Record<EnemyKind, Record<EnemyAnimState, SheetMetrics>> = {
  imp: {
    idle: { cell: 48, frames: 4, bodyH: 19, feetY: 32 },
    walk: { cell: 48, frames: 6, bodyH: 47, feetY: 47 },
    attack: { cell: 48, frames: 4, bodyH: 20, feetY: 33 },
  },
  brute: {
    idle: { cell: 64, frames: 4, bodyH: 29, feetY: 48 },
    walk: { cell: 64, frames: 6, bodyH: 62, feetY: 63 },
    attack: { cell: 64, frames: 4, bodyH: 27, feetY: 50 },
  },
  shooter: {
    idle: { cell: 48, frames: 4, bodyH: 19, feetY: 32 },
    walk: { cell: 48, frames: 6, bodyH: 48, feetY: 47 },
    attack: { cell: 48, frames: 4, bodyH: 20, feetY: 33 },
  },
  boss: {
    idle: { cell: 96, frames: 4, bodyH: 42, feetY: 70 },
    walk: { cell: 96, frames: 6, bodyH: 81, feetY: 95 },
    attack: { cell: 96, frames: 6, bodyH: 42, feetY: 78 },
  },
}

const FPS: Record<EnemyAnimState, number> = { idle: 5, walk: 10, attack: 12 }

/** 캐릭터(발~머리) 월드 높이 — 셀 높이가 아니라 실제 몬스터 크기 */
const SCALE: Record<EnemyKind, number> = { imp: 2.2, brute: 3.5, shooter: 2.4, boss: 5.4 }

/** 시트를 셀 기준으로 그릴 때의 스프라이트 크기 (캐릭터가 SCALE 높이가 되도록 역산) */
const spriteH = (kind: EnemyKind, s: EnemyAnimState) =>
  SCALE[kind] * (ART[kind][s].cell / ART[kind][s].bodyH)

/**
 * 스프라이트 앵커(center)를 캐릭터의 발 높이에 둔다 → 앵커를 지면에 놓으면 발이 지면에 선다.
 *
 * 월드 y로 내려서 보정하면 안 된다: 카메라가 기울어져 있어 월드 y 이동은 화면에서
 * 단축되는데, 보정해야 할 '셀 안 여백'은 스프라이트 공간(단축 없음)에 있다.
 * 두 값의 스케일이 달라 아무리 맞춰도 발이 지면에서 뜬다. center 는 스프라이트
 * 공간이라 정확히 상쇄된다.
 */
const footCenterY = (kind: EnemyKind, s: EnemyAnimState) => {
  const m = ART[kind][s]
  return (m.cell - 1 - m.feetY) / m.cell
}

/**
 * 사망 연출용 스프라이트 재료 — 대기 시트의 첫 프레임 기준.
 * (시트 전체를 그대로 넘기면 프레임 4장이 가로로 눌려 나온다)
 */
export function enemyDeathArt(kind: EnemyKind): { map: THREE.Texture; scale: number; centerY: number } {
  const map = cloneTex(ASSET.monsters[kind].idle)
  map.repeat.set(1 / ART[kind].idle.frames, 1)
  return { map, scale: spriteH(kind, 'idle'), centerY: footCenterY(kind, 'idle') }
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
      this.texes[k].repeat.set(1 / ART[kind][k].frames, 1)
    }

    this.mat = new THREE.SpriteMaterial({ map: this.texes.idle, transparent: true, depthWrite: false })
    this.sprite = new THREE.Sprite(this.mat)
    this.group.add(this.sprite)
    this.applyMetrics()

    // 발밑 그림자 — 캐릭터 실제 크기 기준
    const sc = SCALE[kind]
    const shadowMat = noOutline(
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    )
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(sc * 0.22, 14), shadowMat)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    shadow.scale.set(1, 0.55, 1)
    this.group.add(shadow)
  }

  /** 현재 상태 시트에 맞춰 크기와 발 기준점을 잡는다 (시트별 캐릭터 크기·여백 차이 보정) */
  private applyMetrics() {
    const h = spriteH(this.kind, this.state)
    this.sprite.scale.set(h, h, 1)
    this.sprite.center.set(0.5, footCenterY(this.kind, this.state))
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
      this.applyMetrics()
    }
    this.time += dt

    const n = ART[this.kind][this.state].frames
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
