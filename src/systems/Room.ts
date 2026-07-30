import * as THREE from 'three'
import { noOutline } from '../rendering/toon'
import { dungeonWallTex, townFloorTex, townWallTex } from '../rendering/tiles'
import { ASSET, cloneTex, loadTex } from '../rendering/assets'
import type { Direction } from './RunState'

const TORCH_FRAMES = 3
// 방보다 카메라 시야가 넓은 경우(특히 소형 방)가 있어, 벽 바깥으로 카메라가
// 넘어가면 그 너머가 검게 비어 보인다. 바닥만 넉넉히 연장해 항상 시야를 채운다.
const FLOOR_BLEED = 28
// 카메라와 가까운 남쪽 벽은 화면 아래 전경을 차지하므로, 전투 개체가 그 뒤로
// 들어가 완전히 가려지지 않도록 플레이 가능 경계를 안쪽으로 당긴다.
const FOREGROUND_SAFE_INSET = 2.4

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
  rest: { w: 38, d: 26 },
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

    const useForestBackdrop = visual !== 'town'
    const floorTex = useForestBackdrop ? loadTex(ASSET.stage1.floor) : townFloorTex()
    const wallTex = visual === 'town' ? townWallTex() : dungeonWallTex()

    // ── 바닥 (카메라 시야를 항상 채우도록 벽 바깥까지 타일링해 연장) ──
    const ft = floorTex.clone()
    ft.needsUpdate = true
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping
    const floorW = this.w + FLOOR_BLEED * 2
    const floorD = this.d + FLOOR_BLEED * 2
    ft.repeat.set(floorW / 2, floorD / 2)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorW, floorD),
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
    wt.repeat.set(this.w / 2, WH / 2)
    // Forest rooms previously replaced the wall texture with an almost-black flat color.
    // At 16:9 this produced wide black bands above and below the playable floor.
    // Keep the wall darker than the floor, but retain the pixel-tile texture so the
    // room boundary reads as scenery rather than missing geometry.
    const wallMat = useForestBackdrop
      ? noOutline(new THREE.MeshStandardMaterial({ map: wt, color: 0x9aa58f, roughness: 1 }))
      : noOutline(new THREE.MeshStandardMaterial({ map: wt, roughness: 1 }))
    const addWall = (cx: number, cz: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, WH, sz), wallMat)
      m.position.set(cx, WH / 2, cz)
      // 벽이 바닥에 그림자를 드리우면 카메라 각도상 화면 가장자리 바닥이 거의
      // 새까맣게 덮여 '바닥이 안 채워진 검은 여백'처럼 보인다. 벽은 그림자를
      // 만들지 않게 한다(받는 것만 유지 — 플레이어/적 그림자는 그대로 진다).
      m.castShadow = false
      m.receiveShadow = true
      this.group.add(m)
    }
    addWall(0, -halfD - WT / 2, this.w + WT * 2, WT) // 북
    addWall(0, halfD + WT / 2, this.w + WT * 2, WT) // 남
    addWall(-halfW - WT / 2, 0, WT, this.d) // 서
    addWall(halfW + WT / 2, 0, WT, this.d) // 동

    if (useForestBackdrop) {
      const addDecor = (path: string, x: number, z: number, w: number, h: number) => {
        const mat = noOutline(new THREE.MeshBasicMaterial({ map: loadTex(path), transparent: true, depthWrite: false, side: THREE.DoubleSide }))
        const decor = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
        decor.rotation.x = -Math.PI / 2
        decor.position.set(x, 0.035, z)
        this.group.add(decor)
      }
      const fg = ASSET.stage1.foreground
      addDecor(fg.treeA, -halfW + 4, -halfD + 4.2, 4.2, 5.6)
      addDecor(fg.treeB, halfW - 4, -halfD + 4.2, 4.2, 5.6)
      addDecor(fg.bushA, -halfW + 3.2, halfD - 2.3, 2.6, 1.75)
      addDecor(fg.bushB, halfW - 3.2, halfD - 2.3, 2.6, 1.75)
      addDecor(fg.stoneA, -halfW + 3, -1.4, 1.5, 2)
      addDecor(fg.stoneB, halfW - 3, 1.4, 1.5, 2)
      addDecor(fg.vineTop, 0, -halfD + 1.8, 3.6, 1.8)
    }

    // ── 장식: 벽면 횃불 (2프레임 애니메이션) ──
    if (visual !== 'town') {
      this.torchMap = cloneTex(ASSET.stage1.effects.campfire)
      this.torchMap.repeat.set(1 / TORCH_FRAMES, 1)
      const torchMat = noOutline(
        new THREE.SpriteMaterial({ map: this.torchMap, transparent: true, depthWrite: false }),
      )
      for (const tx of [-halfW * 0.55, halfW * 0.55]) {
        const light = new THREE.PointLight(0xff8030, 8, 20, 2)
        light.position.set(tx, 3.4, -halfD + 0.5)
        this.group.add(light)
        const torch = new THREE.Sprite(torchMat)
        torch.scale.set(1.15, 1.7, 1)
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
  entryPoint(from: Direction = 'south') {
    const inset = 3
    switch (from) {
      case 'north': return { x: 0, z: this.bounds.minZ + inset }
      case 'east': return { x: this.bounds.maxX - inset, z: 0 }
      case 'west': return { x: this.bounds.minX + inset, z: 0 }
      default: return { x: 0, z: this.bounds.maxZ - inset }
    }
  }

  /** 북쪽 벽 앞 문 위치들 (개수에 따라 균등 배치) */
  doorPoint(direction: Direction): { x: number; z: number } {
    const inset = 2.8
    switch (direction) {
      case 'north': return { x: 0, z: this.bounds.minZ + inset }
      case 'east': return { x: this.bounds.maxX - inset, z: 0 }
      case 'south': return { x: 0, z: this.bounds.maxZ - inset }
      case 'west': return { x: this.bounds.minX + inset, z: 0 }
    }
  }

  doorPoints(count: number): { x: number; z: number }[] {
    const z = this.bounds.minZ + 1.2
    if (count <= 1) return [this.doorPoint('north')]
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
    pos.z = Math.min(b.maxZ - radius - FOREGROUND_SAFE_INSET, Math.max(b.minZ + radius, pos.z))
  }

  dispose() {
    this.scene.remove(this.group)
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
    })
  }
}
