import { CONFIG } from '../config'
import { Enemy, EnemyKind } from '../entities/Enemy'
import { Dungeon } from './Dungeon'

export interface WaveInfo {
  wave: number
  isBoss: boolean
}

/** 웨이브 기반 적 스폰 관리 */
export class Spawner {
  wave = 0
  timer = CONFIG.spawn.firstWaveDelay
  betweenWaves = true
  toSpawn: EnemyKind[] = []
  spawnInterval = 0.25
  private spawnTimer = 0

  /** 난이도 배수 (웨이브에 따라 상승) */
  get hpMul() {
    return 1 + this.wave * 0.16
  }
  get dmgMul() {
    return 1 + this.wave * 0.09
  }
  get speedMul() {
    return Math.min(1.8, 1 + this.wave * 0.03)
  }

  /** 다음 웨이브 구성 */
  private buildWave(): EnemyKind[] {
    const list: EnemyKind[] = []
    const isBoss = this.wave % 5 === 0
    if (isBoss) {
      list.push('boss')
      const adds = 2 + Math.floor(this.wave / 5)
      for (let i = 0; i < adds; i++) list.push('imp')
    } else {
      const count = CONFIG.spawn.baseCount + this.wave * CONFIG.spawn.countPerWave
      for (let i = 0; i < count; i++) {
        const roll = Math.random()
        if (this.wave >= 3 && roll < 0.18) list.push('brute')
        else if (this.wave >= 2 && roll < 0.4) list.push('shooter')
        else list.push('imp')
      }
    }
    return list
  }

  isBossWave() {
    return this.wave % 5 === 0 && this.wave > 0
  }

  /**
   * 매 프레임 갱신. 스폰할 적을 dungeon 가장자리에 생성해 enemies에 push.
   * 반환: 새 웨이브가 시작됐으면 그 번호, 아니면 null.
   */
  update(dt: number, enemies: Enemy[], dungeon: Dungeon): number | null {
    let startedWave: number | null = null

    if (this.betweenWaves) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.wave++
        this.toSpawn = this.buildWave()
        this.betweenWaves = false
        this.spawnTimer = 0
        startedWave = this.wave
      }
    } else {
      // 대기열에서 순차 스폰
      if (this.toSpawn.length > 0) {
        this.spawnTimer -= dt
        if (this.spawnTimer <= 0) {
          this.spawnTimer = this.spawnInterval
          const kind = this.toSpawn.shift()!
          const p = dungeon.randomEdgePoint()
          enemies.push(new Enemy(kind, p.x, p.z, this.hpMul, this.dmgMul, this.speedMul))
        }
      } else if (enemies.length === 0) {
        // 모든 적 처치 → 다음 웨이브 대기
        this.betweenWaves = true
        this.timer = CONFIG.spawn.betweenWaves
      }
    }

    return startedWave
  }

  reset() {
    this.wave = 0
    this.timer = CONFIG.spawn.firstWaveDelay
    this.betweenWaves = true
    this.toSpawn = []
  }
}
