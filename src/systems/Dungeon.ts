import * as THREE from 'three'
import { CONFIG, COLORS } from '../config'

/** 원형 던전 아레나 — 바닥, 외벽, 장식 기둥 */
export class Dungeon {
  group = new THREE.Group()
  radius = CONFIG.arenaRadius

  constructor(scene: THREE.Scene) {
    // 바닥
    const floorGeo = new THREE.CircleGeometry(this.radius, 48)
    const floorMat = new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.95 })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.group.add(floor)

    // 그리드 오버레이 (던전 타일 느낌)
    const grid = new THREE.GridHelper(this.radius * 2, 34, COLORS.floorGrid, COLORS.floorGrid)
    ;(grid.material as THREE.Material).opacity = 0.25
    ;(grid.material as THREE.Material).transparent = true
    grid.position.y = 0.02
    this.group.add(grid)

    // 중앙 마법진 장식
    const rune = new THREE.Mesh(
      new THREE.RingGeometry(3, 3.4, 40),
      new THREE.MeshBasicMaterial({ color: COLORS.xp, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
    )
    rune.rotation.x = -Math.PI / 2
    rune.position.y = 0.03
    this.group.add(rune)
    const rune2 = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.6, 30),
      new THREE.MeshBasicMaterial({ color: COLORS.xp, transparent: true, opacity: 0.15, side: THREE.DoubleSide }),
    )
    rune2.rotation.x = -Math.PI / 2
    rune2.position.y = 0.03
    this.group.add(rune2)

    // 외벽 (원통)
    const wallGeo = new THREE.CylinderGeometry(this.radius + 0.5, this.radius + 0.5, 4, 48, 1, true)
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9, side: THREE.BackSide })
    const wall = new THREE.Mesh(wallGeo, wallMat)
    wall.position.y = 2
    this.group.add(wall)

    // 벽 상단 테두리
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(this.radius + 0.5, 0.35, 8, 48),
      new THREE.MeshStandardMaterial({ color: COLORS.wallTop, roughness: 0.7 }),
    )
    rim.rotation.x = Math.PI / 2
    rim.position.y = 4
    this.group.add(rim)

    // 장식 기둥 (외곽을 따라 — 던전 분위기, 충돌 없음)
    const pillarGeo = new THREE.CylinderGeometry(0.6, 0.7, 5, 8)
    const pillarMat = new THREE.MeshStandardMaterial({ color: COLORS.wallTop, roughness: 0.8 })
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      const pillar = new THREE.Mesh(pillarGeo, pillarMat)
      pillar.position.set(Math.cos(a) * (this.radius - 1.5), 2.5, Math.sin(a) * (this.radius - 1.5))
      pillar.castShadow = true
      this.group.add(pillar)
      // 기둥 위 횃불 불빛
      const torch = new THREE.PointLight(0xff8030, 6, 14, 2)
      torch.position.set(Math.cos(a) * (this.radius - 1.5), 5, Math.sin(a) * (this.radius - 1.5))
      this.group.add(torch)
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffb050 }),
      )
      flame.position.copy(torch.position)
      this.group.add(flame)
    }

    scene.add(this.group)
  }

  /** 랜덤한 가장자리 스폰 위치 */
  randomEdgePoint(): { x: number; z: number } {
    const a = Math.random() * Math.PI * 2
    const r = this.radius - 2
    return { x: Math.cos(a) * r, z: Math.sin(a) * r }
  }
}
