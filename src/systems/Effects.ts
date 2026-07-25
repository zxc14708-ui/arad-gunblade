import * as THREE from 'three'
import { COLORS } from '../config'
import { puffTex, slashTex } from '../rendering/pixelfx'

type Particle = {
  mesh: THREE.Sprite
  vel: THREE.Vector3
  life: number
  maxLife: number
}

type Floater = {
  el: HTMLDivElement
  world: THREE.Vector3
  life: number
  vy: number
}

/** 파티클 / 베기 궤적 / 데미지 숫자 / XP 오브 관리 */
export class Effects {
  private scene: THREE.Scene
  private particles: Particle[] = []
  private slashes: { mesh: THREE.Sprite; life: number; max: number }[] = []
  private floaters: Floater[] = []
  private layer: HTMLDivElement

  constructor(scene: THREE.Scene, uiLayer: HTMLDivElement) {
    this.scene = scene
    this.layer = uiLayer
  }

  /** 픽셀 퍼프 파티클 폭발 */
  burst(pos: THREE.Vector3, color = COLORS.hit, count = 8, power = 6) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: puffTex(), color, transparent: true, depthWrite: false })
      const m = new THREE.Sprite(mat)
      m.position.copy(pos)
      const a = Math.random() * Math.PI * 2
      const up = Math.random() * 0.6 + 0.2
      const s = Math.random() * power
      m.scale.setScalar(Math.random() * 0.4 + 0.3)
      this.scene.add(m)
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3(Math.cos(a) * s, up * s, Math.sin(a) * s),
        life: 0.5,
        maxLife: 0.5,
      })
    }
  }

  /** 픽셀 베기 크레센트 (조준 방향으로 회전한 빌보드) */
  slash(pos: THREE.Vector3, angle: number, _arc: number, range: number) {
    const mat = new THREE.SpriteMaterial({ map: slashTex(), transparent: true, depthWrite: false })
    mat.rotation = -angle + Math.PI / 2 // 조준 방향으로 크레센트 회전(근사)
    const sp = new THREE.Sprite(mat)
    const fwd = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
    sp.position.set(pos.x + fwd.x * range * 0.4, 0.9, pos.z + fwd.z * range * 0.4)
    sp.scale.setScalar(range * 1.2)
    this.scene.add(sp)
    this.slashes.push({ mesh: sp, life: 0.18, max: 0.18 })
  }

  /** 데미지 숫자 (크리티컬이면 강조) */
  damageNumber(world: THREE.Vector3, amount: number, crit = false) {
    const el = document.createElement('div')
    el.className = 'floater' + (crit ? ' crit' : '')
    el.textContent = crit ? `${Math.round(amount)}!` : `${Math.round(amount)}`
    this.layer.appendChild(el)
    this.floaters.push({ el, world: world.clone(), life: 0.8, vy: 2.2 })
  }

  update(dt: number, camera: THREE.Camera, canvasRect: DOMRect) {
    // 파티클
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      if (p.life <= 0) {
        this.scene.remove(p.mesh)
        ;(p.mesh.material as THREE.Material).dispose()
        this.particles.splice(i, 1)
        continue
      }
      p.vel.y -= 18 * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05
        p.vel.y *= -0.4
        p.vel.x *= 0.7
        p.vel.z *= 0.7
      }
      const t = p.life / p.maxLife
      p.mesh.scale.setScalar(t * 0.9 + 0.1)
    }

    // 베기 궤적
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i]
      s.life -= dt
      const t = Math.max(0, s.life / s.max)
      ;(s.mesh.material as THREE.SpriteMaterial).opacity = t
      if (s.life <= 0) {
        this.scene.remove(s.mesh)
        ;(s.mesh.material as THREE.Material).dispose()
        this.slashes.splice(i, 1)
      }
    }

    // 데미지 숫자
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]
      f.life -= dt
      f.world.y += f.vy * dt
      f.vy -= 3 * dt
      if (f.life <= 0) {
        f.el.remove()
        this.floaters.splice(i, 1)
        continue
      }
      const p = f.world.clone().project(camera)
      const x = canvasRect.left + ((p.x + 1) / 2) * canvasRect.width
      const y = canvasRect.top + ((-p.y + 1) / 2) * canvasRect.height
      f.el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px)`
      f.el.style.opacity = String(Math.min(1, f.life * 2))
    }
  }

  clear() {
    for (const p of this.particles) this.scene.remove(p.mesh)
    for (const s of this.slashes) this.scene.remove(s.mesh)
    for (const f of this.floaters) f.el.remove()
    this.particles = []
    this.slashes = []
    this.floaters = []
  }
}
