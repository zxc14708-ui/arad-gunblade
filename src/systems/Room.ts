import * as THREE from 'three'
import { noOutline } from '../rendering/toon'
import { dungeonFloorTex, dungeonWallTex, townFloorTex, townWallTex, bossFloorTex } from '../rendering/tiles'
import { ASSET, cloneTex } from '../rendering/assets'

const TORCH_FRAMES = 2

export type RoomVisualKind = 'dungeon' | 'boss' | 'town'

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const SIZES: Record<string, { w: number; d: number }> = {
  combat: { w: 42, d: 30 },
  treasure: { w: 34, d: 26 },
  shop: { w: 38, d: 26 },
  boss: { w: 50, d: 36 },
  town: { w: 46, d: 32 },
}

/**
 * 직사각형 방 하나를 씬에 구성한다 (2.5D 픽셀 탑다운).
 * 바닥 타일 + 4면 벽 + 장식. 문/상자 등 오브젝트는 Interactable이 담당.
 */
export class Room {
  group = new THREE.Group()
  bounds: Bounds
  /** 방 크기 */
  w: number
  d: number
  private scene: THREE.Scene
  private torchMap: THREE.Texture | null = null
  private torchTime = 0

  constructor(scene: THREE.Scene, sizeKey: string, visual: RoomVisualKind) {
    this.scene = scene
    const s = SIZES[sizeKey] ?? SIZES.combat
    this.w = s.w
    this.d = s.d
    const halfW = this.w / 2
    const halfD = this.d / 2
    // 플레이 가능 영역(벽 두께 제외)
    this.bounds = { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD }

    const floorTex = visual === 'town' ? townFloorTex() : visual === 'boss' ? bossFloorTex() : dungeonFloorTex()
    const wallTex = visual === 'town' ? townWallTex() : dungeonWallTex()

    // ── 바닥 ──
    const ft = floorTex.clone()
    ft.needsUpdate = true
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping
    ft.repeat.set(this.w / 2, this.d / 2) // 타일 2월드유닛
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.w, this.d),
      noOutline(new THREE.MeshStandardMaterial({ map: ft, roughness: 1 })),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.group.add(floor)

    // ── 벽 (4면, 안쪽을 향한 박스) ──
    const WT = 2 // 벽 두께
    const WH = visual === 'town' ? 3 : 4 // 벽 높이
    const wt = wallTex.clone()
    wt.needsUpdate = true
    wt.wrapS = wt.wrapT = THREE.RepeatWrapping
    // 바닥과 같은 2월드유닛 타일 크기로 맞춤 (늘어짐 방지)
    wt.repeat.set(this.w / 2, WH / 2)
    const wallMat = noOutline(new THREE.MeshStandardMaterial({ map: wt, roughness: 1 }))
    const addWall = (cx: number, cz: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, WH, sz), wallMat)
      m.position.set(cx, WH / 2, cz)
      m.castShadow = true
      m.receiveShadow = true
      this.group.add(m)
    }
    addWall(0, -halfD - WT / 2, this.w + WT * 2, WT) // 북
    addWall(0, halfD + WT / 2, this.w + WT * 2, WT) // 남
    addWall(-halfW - WT / 2, 0, WT, this.d) // 서
    addWall(halfW + WT / 2, 0, WT, this.d) // 동

    // ── 바깥 어둠 (방 밖 여백을 검게 채워 빈 공간이 보이지 않게) ──
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      noOutline(new THREE.MeshBasicMaterial({ color: 0x05060a })),
    )
    outer.rotation.x = -Math.PI / 2
    outer.position.y = -0.08
    this.group.add(outer)

    // ── 장식: 벽면 횃불 (2프레임 애니메이션) ──
    if (visual !== 'town') {
      this.torchMap = cloneTex(ASSET.props.torchStrip)
      this.torchMap.repeat.set(1 / TORCH_FRAMES, 1)
      const torchMat = noOutline(
        new THREE.SpriteMaterial({ map: this.torchMap, transparent: true, depthWrite: false }),
      )
      for (const tx of [-halfW * 0.55, halfW * 0.55]) {
        const light = new THREE.PointLight(0xff8030, 8, 20, 2)
        light.position.set(tx, 3.4, -halfD + 0.5)
        this.group.add(light)
        const torch = new THREE.Sprite(torchMat)
        torch.scale.set(1.5 * (24 / 24), 1.5, 1)
        torch.position.set(tx, 2.6, -halfD + 0.5)
        this.group.add(torch)
      }
    }

    // ── 보스방 바닥 마법진 ──
    if (visual === 'boss') {
      for (const r of [5, 8]) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(r, r + 0.5, 40),
          noOutline(new THREE.MeshBasicMaterial({ color: 0xe0554f, transparent: true, opacity: 0.22, side: THREE.DoubleSide })),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.y = 0.03
        this.group.add(ring)
      }
    }

    scene.add(this.group)
  }

  /** 횃불 불꽃 애니메이션 */
  update(dt: number) {
    if (!this.torchMap) return
    this.torchTime += dt
    this.torchMap.offset.x = (Math.floor(this.torchTime * 7) % TORCH_FRAMES) / TORCH_FRAMES
  }

  /** 플레이어 진입 위치 (남쪽 중앙) */
  entryPoint() {
    return { x: 0, z: this.bounds.maxZ - 3 }
  }

  /** 북쪽 벽 앞 문 위치들 (개수에 따라 균등 배치) */
  doorPoints(count: number): { x: number; z: number }[] {
    const z = this.bounds.minZ + 1.2
    if (count <= 1) return [{ x: 0, z }]
    const span = this.w * 0.5
    return Array.from({ length: count }, (_, i) => ({
      x: -span / 2 + (span / (count - 1)) * i,
      z,
    }))
  }

  /** 방 안 랜덤 위치 (가장자리 여백 확보) */
  randomPoint(margin = 4): { x: number; z: number } {
    return {
      x: this.bounds.minX + margin + Math.random() * (this.w - margin * 2),
      z: this.bounds.minZ + margin + Math.random() * (this.d - margin * 2),
    }
  }

  /** 적 스폰 위치 (플레이어 진입점에서 떨어진 곳) */
  spawnPoint(): { x: number; z: number } {
    const p = this.randomPoint(4)
    // 진입점(남쪽)과 너무 가까우면 북쪽으로 밀기
    if (p.z > this.bounds.maxZ - 7) p.z = this.bounds.minZ + 4 + Math.random() * (this.d * 0.4)
    return p
  }

  /** 좌표를 방 안으로 제한 */
  clamp(pos: THREE.Vector3, radius: number) {
    const b = this.bounds
    pos.x = Math.min(b.maxX - radius, Math.max(b.minX + radius, pos.x))
    pos.z = Math.min(b.maxZ - radius, Math.max(b.minZ + radius, pos.z))
  }

  dispose() {
    this.scene.remove(this.group)
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
    })
  }
}
