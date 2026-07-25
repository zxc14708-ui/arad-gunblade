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
  private deaths: { sp: THREE.Sprite; life: number; max: number; base: number }[] = []
  private ghosts: { sp: THREE.Sprite; life: number; max: number }[] = []
  private layer: HTMLDivElement

  constructor(scene: THREE.Scene, uiLayer: HTMLDivElement) {
    this.scene = scene
    this.layer = uiLayer
  }

  /** 적 사망 산화: 흰 섬광 → 주황 틴트로 주저앉으며 소멸 */
  deathDissolve(pos: THREE.Vector3, map: THREE.Texture, scale: number) {
    const mat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false })
    const sp = new THREE.Sprite(mat)
    sp.center.set(0.5, 0)
    sp.scale.set(scale, scale, 1)
    sp.position.set(pos.x, 0.02, pos.z)
    this.scene.add(sp)
    this.deaths.push({ sp, life: 0.38, max: 0.38, base: scale })
  }

  /** 대시 잔상: 현재 캐릭터 프레임을 청백색 고스트로 남김 */
  ghost(
    p: { map: THREE.Texture; offsetX: number; repeatX: number; sx: number; sy: number; bobY: number },
    pos: THREE.Vector3,
  ) {
    const tex = p.map.clone()
    tex.needsUpdate = true
    tex.offset.x = p.offsetX
    tex.repeat.x = p.repeatX
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0.45,
      color: 0x9fd8ff,
      depthWrite: false,
    })
    const sp = new THREE.Sprite(mat)
    sp.center.set(0.5, 0)
    sp.scale.set(p.sx, p.sy, 1)
    sp.position.set(pos.x, p.bobY, pos.z)
    this.scene.add(sp)
    this.ghosts.push({ sp, life: 0.28, max: 0.28 })
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

    // 사망 산화
    for (let i = this.deaths.length - 1; i >= 0; i--) {
      const d = this.deaths[i]
      d.life -= dt
      const t = Math.max(0, d.life / d.max) // 1→0
      const m = d.sp.material as THREE.SpriteMaterial
      if (t > 0.72) {
        m.color.setRGB(3, 3, 3) // 흰 섬광
        m.opacity = 1
      } else {
        m.color.setRGB(1.4, 0.7, 0.4) // 주황 산화 틴트
        m.opacity = t / 0.72
      }
      d.sp.scale.y = d.base * (0.35 + 0.65 * t) // 주저앉기
      d.sp.scale.x = d.base * (1 + (1 - t) * 0.45) // 옆으로 흩어짐
      if (d.life <= 0) {
        this.scene.remove(d.sp)
        m.dispose() // 텍스처는 공유 캐시라 유지
        this.deaths.splice(i, 1)
      }
    }

    // 대시 잔상
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i]
      g.life -= dt
      const t = Math.max(0, g.life / g.max)
      const m = g.sp.material as THREE.SpriteMaterial
      m.opacity = 0.45 * t
      if (g.life <= 0) {
        this.scene.remove(g.sp)
        m.map?.dispose() // 클론 텍스처는 해제
        m.dispose()
        this.ghosts.splice(i, 1)
      }
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
    for (const d of this.deaths) this.scene.remove(d.sp)
    for (const g of this.ghosts) this.scene.remove(g.sp)
    this.particles = []
    this.slashes = []
    this.floaters = []
    this.deaths = []
    this.ghosts = []
  }
}
