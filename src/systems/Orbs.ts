import * as THREE from 'three'
import { COLORS } from '../config'

interface Orb {
  mesh: THREE.Mesh
  pos: THREE.Vector3
  value: number
  bob: number
}

/** 경험치 오브 (적 처치 시 드랍, 플레이어에게 끌려감) */
export class Orbs {
  scene: THREE.Scene
  orbs: Orb[] = []
  private geo = new THREE.OctahedronGeometry(0.22, 0)
  private mat = new THREE.MeshStandardMaterial({
    color: COLORS.xp,
    emissive: COLORS.xp,
    emissiveIntensity: 0.9,
    roughness: 0.3,
  })

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  drop(x: number, z: number, value: number) {
    const mesh = new THREE.Mesh(this.geo, this.mat)
    mesh.position.set(x, 0.5, z)
    this.scene.add(mesh)
    this.orbs.push({ mesh, pos: new THREE.Vector3(x, 0.5, z), value, bob: Math.random() * 6 })
  }

  /** 반환: 수집한 총 경험치 */
  update(dt: number, playerPos: THREE.Vector3, magnetRange: number, orbSpeed: number, pickupRange = 1.0): number {
    let gained = 0
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i]
      o.bob += dt * 4
      const dx = playerPos.x - o.pos.x
      const dz = playerPos.z - o.pos.z
      const dist = Math.hypot(dx, dz)
      if (dist < magnetRange) {
        const d = dist || 1
        const pull = orbSpeed * (1 - dist / magnetRange) * 1.5 + 3
        o.pos.x += (dx / d) * pull * dt
        o.pos.z += (dz / d) * pull * dt
      }
      o.mesh.position.set(o.pos.x, 0.5 + Math.sin(o.bob) * 0.12, o.pos.z)
      o.mesh.rotation.y += dt * 3
      o.mesh.rotation.x += dt * 2
      if (dist < pickupRange) {
        gained += o.value
        this.scene.remove(o.mesh)
        this.orbs.splice(i, 1)
      }
    }
    return gained
  }

  clear() {
    for (const o of this.orbs) this.scene.remove(o.mesh)
    this.orbs = []
  }
}
