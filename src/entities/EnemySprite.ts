import * as THREE from 'three'
import { CONFIG } from '../config'
import { noOutline } from '../rendering/toon'
import { ASSET, cloneTex } from '../rendering/assets'
import { makeBottomAnchoredSprite, setSpriteWorldHeight } from '../rendering/pixelArt'

export type EnemyAnimState = 'idle' | 'walk' | 'attack' | 'charge'
type StandardEnemyAnimState = Exclude<EnemyAnimState, 'charge'>
type EnemyFrames = Record<StandardEnemyAnimState, number> & Partial<Record<'charge', number>>

/**
 * 각 애니메이션의 프레임 수 (시트 = 가로 스트립, 정사각 셀). artSet(외형) 기준
 * — kind(행동)가 아니다(작업 지시 P2_prompt_stage_data_and_continuous_run_1
 * 커밋2). 시트 규격은 tools/measure_sprites.py 로 검사한다 — 셀 크기·프레임
 * 수가 맞고 모든 프레임의 발이 셀 아래변에 닿아 있어야 이 단순한 렌더링이
 * 성립한다.
 */
const FRAMES: Record<string, EnemyFrames> = {
  imp: { idle: 4, walk: 6, attack: 4 },
  brute: { idle: 4, walk: 6, attack: 4 },
  shooter: { idle: 4, walk: 6, attack: 4 },
  boss: { idle: 4, walk: 6, attack: 6, charge: 6 },
  s2Imp: { idle: 4, walk: 6, attack: 4 }, s2Brute: { idle: 4, walk: 6, attack: 4 }, s2Shooter: { idle: 4, walk: 6, attack: 4 }, s2Suicide: { idle: 4, walk: 6, attack: 4 }, s2Boss: { idle: 4, walk: 6, attack: 6, charge: 6 },
  s3Imp: { idle: 4, walk: 6, attack: 4 }, s3Brute: { idle: 4, walk: 6, attack: 4 }, s3Shooter: { idle: 4, walk: 6, attack: 4 }, s3Suicide: { idle: 4, walk: 6, attack: 4 }, s3Boss: { idle: 4, walk: 6, attack: 6, charge: 6 },
  s4Imp: { idle: 4, walk: 6, attack: 4 }, s4Shooter: { idle: 4, walk: 6, attack: 4 }, s4FireMage: { idle: 4, walk: 6, attack: 4 }, s4Boss: { idle: 4, walk: 6, attack: 6, charge: 6 },
  s5Imp: { idle: 4, walk: 6, attack: 4 }, s5Shooter: { idle: 4, walk: 6, attack: 4 }, s5FrostSuicide: { idle: 4, walk: 6, attack: 4 }, s5IceMage: { idle: 4, walk: 6, attack: 4 }, s5Boss: { idle: 4, walk: 6, attack: 6, charge: 6 },
  s6Imp: { idle: 4, walk: 6, attack: 4 }, s6Shooter: { idle: 4, walk: 6, attack: 4 }, s6Summoner: { idle: 4, walk: 6, attack: 4 }, s6Zombie: { idle: 4, walk: 6, attack: 4 }, s6Boss: { idle: 4, walk: 6, attack: 6, charge: 6 },
  s7Imp: { idle: 4, walk: 6, attack: 4 }, s7Shooter: { idle: 4, walk: 6, attack: 4 }, s7VoidMage: { idle: 4, walk: 6, attack: 4 }, s7Charger: { idle: 4, walk: 6, attack: 4 }, s7Boss: { idle: 4, walk: 6, attack: 6, charge: 6 },
}
const FPS: Record<EnemyAnimState, number> = { idle: 5, walk: 10, attack: 12, charge: 12 }

/** 셀(=캐릭터) 월드 높이 — artSet 기준 */
const SCALE: Record<string, number> = {
  imp: 2.2, brute: 3.5, shooter: 2.4, boss: 5.4,
  s2Imp: 2.2, s2Brute: 3.5, s2Shooter: 2.4, s2Suicide: 2.2, s2Boss: 5.4,
  s3Imp: 2.2, s3Brute: 3.5, s3Shooter: 2.4, s3Suicide: 2.2, s3Boss: 5.4,
  s4Imp: 2.2, s4Shooter: 2.4, s4FireMage: 2.65, s4Boss: 5.4,
  s5Imp: 2.2, s5Shooter: 2.4, s5FrostSuicide: 2.2, s5IceMage: 2.65, s5Boss: 5.4,
  s6Imp: 2.2, s6Shooter: 2.4, s6Summoner: 2.65, s6Zombie: 2.2, s6Boss: 5.4,
  s7Imp: 2.2, s7Shooter: 2.4, s7VoidMage: 2.65, s7Charger: 3.5, s7Boss: 5.4,
}

/**
 * 사망 연출용 스프라이트 재료 — 대기 시트의 첫 프레임 기준.
 * (시트 전체를 그대로 넘기면 프레임 4장이 가로로 눌려 나온다)
 */
export function enemyDeathArt(artSet: string): { map: THREE.Texture; scale: number } {
  const map = cloneTex(ASSET.monsters[artSet].idle)
  map.repeat.set(1 / FRAMES[artSet].idle, 1)
  return { map, scale: SCALE[artSet] }
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
  private artSet: string
  private state: EnemyAnimState = 'idle'
  private time = 0
  private flip = 1
  /** 공격 모션 잔여 시간 */
  private attackTimer = 0
  private chargeTimer = 0

  constructor(artSet: string) {
    this.artSet = artSet
    const src = ASSET.monsters[artSet]
    this.texes = {
      idle: cloneTex(src.idle),
      walk: cloneTex(src.walk),
      attack: cloneTex(src.attack),
    }
    for (const k of ['idle', 'walk', 'attack'] as StandardEnemyAnimState[]) {
      this.texes[k].repeat.set(1 / FRAMES[artSet][k], 1)
    }
    if (src.charge) {
      this.texes.charge = cloneTex(src.charge)
      this.texes.charge.repeat.set(1 / (FRAMES[artSet].charge ?? 1), 1)
    }

    this.mat = new THREE.SpriteMaterial({ map: this.texes.idle, transparent: true, depthWrite: false })
    this.sprite = makeBottomAnchoredSprite(this.mat)
    const sc = SCALE[artSet]
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
   * 돌진 모션을 즉시 취소한다 — 브레이크(P7 커밋3)가 예고 중인 패턴을
   * 끊어도 chargeTimer가 자연 소진될 때까지 charge 애니메이션이 계속
   * 재생되는 "유령 예고"를 막기 위함. playCharge()로 남은 시간이 걸려있어도
   * 다음 update()에서 곧바로 idle/walk로 되돌아간다.
   */
  cancelCharge() {
    this.chargeTimer = 0
  }

  /**
   * @param moving 이동 중인지
   * @param faceLeft 왼쪽을 보는지
   */
  update(
    dt: number, moving: boolean, faceLeft: boolean, hitFlash: number, hitFlashCrit: boolean, bobY: number,
    stunned = false, bleeding = false, shocked = false,
  ) {
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

    const n = FRAMES[this.artSet][this.state] ?? FRAMES[this.artSet].idle
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
      const peak = CONFIG.effects.flashIntensity * (this.artSet === 'boss' ? CONFIG.effects.flashBossIntensityMul : 1)
      if (hitFlashCrit) this.mat.color.setRGB(peak, peak, peak * 0.3) // 치명타는 흰색 대신 노란색
      else this.mat.color.setRGB(peak, peak, peak)
    } else if (stunned) {
      // 기절 지속 틴트 — 피격 번쩍임과 구분되는 청색, 난전에서도 식별 가능해야 함(P7 커밋3)
      this.mat.color.setRGB(0.55, 0.8, 1.35)
    } else if (shocked) {
      // 감전 지속 틴트 — 보라 계열, 기절(청)/출혈(적)과 구분(작업 지시 P8 커밋2)
      this.mat.color.setRGB(1.3, 0.7, 1.5)
    } else if (bleeding) {
      // 출혈 지속 틴트 — 적색 계열. 중첩 수 자체는 틴트가 아니라 머리 위
      // 점(Enemy.syncBleedPips())으로 표시한다 — 색만으로는 "몇 겹"이 안 읽힌다.
      this.mat.color.setRGB(1.3, 0.5, 0.5)
    } else {
      this.mat.color.setRGB(1, 1, 1)
    }
  }
}
