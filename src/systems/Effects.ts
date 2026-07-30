import * as THREE from 'three'
import { CONFIG, COLORS } from '../config'
import { puffTex } from '../rendering/pixelfx'
import { ASSET, frameTextures } from '../rendering/assets'
import { makeBottomAnchoredSprite, setSpriteWorldHeight } from '../rendering/pixelArt'
import { DISPLAY } from '../rendering/viewport'

export type FxKind = 'slash' | 'slashWind' | 'death' | 'muzzle' | 'hit' | 'ultimateCross' | 'iaido'
export type GroundFxKind = 'warning' | 'shockwave' | 'tealMagic'

/** 이펙트별 재생 속도(fps) */
// Four temporary ultimate frames need to remain readable through the final impact beat.
const FX_FPS: Record<FxKind, number> = { slash: 26, slashWind: 26, death: 16, muzzle: 26, hit: 22, ultimateCross: 8, iaido: 7 }

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

type GroundFx = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  time: number
  duration: number
  frames: THREE.Texture[]
}

/** 파티클 / 베기 궤적 / 데미지 숫자 / XP 오브 관리 */
export class Effects {
  private scene: THREE.Scene
  private particles: Particle[] = []
  private slashes: { mesh: THREE.Sprite; life: number; max: number }[] = []
  private floaters: Floater[] = []
  private deaths: { sp: THREE.Sprite; life: number; max: number; base: number }[] = []
  private ghosts: { sp: THREE.Sprite; life: number; max: number }[] = []
  private groundFx: GroundFx[] = []
  /** 스프라이트 시트 이펙트 (베기/사망/총구화염/타격) */
  private fx: { sp: THREE.Sprite; kind: FxKind; time: number; frames: THREE.Texture[]; fps: number }[] = []
  private layer: HTMLDivElement

  // 화면 흔들림: 누적 강도(shakeAmp)를 프레임마다 지수적으로 감쇠시킨다.
  private shakeAmp = 0
  private shakeDecayRate = 8
  private shakeEnabled = true

  constructor(scene: THREE.Scene, uiLayer: HTMLDivElement) {
    this.scene = scene
    this.layer = uiLayer
    try {
      const s = JSON.parse(localStorage.getItem('arad_settings') || '{}')
      if (typeof s.shakeEnabled === 'boolean') this.shakeEnabled = s.shakeEnabled
    } catch {
      /* 무시 */
    }
  }

  get shakeIsEnabled() {
    return this.shakeEnabled
  }

  /** 설정창 토글 — 3D 멀미에 민감한 사용자를 위해 완전히 끌 수 있다. */
  setShakeEnabled(on: boolean) {
    this.shakeEnabled = on
    if (!on) this.shakeAmp = 0
    try {
      localStorage.setItem('arad_settings', JSON.stringify({ shakeEnabled: on }))
    } catch {
      /* 무시 */
    }
  }

  /**
   * 화면 흔들림 요청 — 강도는 겹치면 합산하되 상한(CONFIG.effects.shakeMax)을 둔다.
   * 지속시간은 감쇠 속도를 결정한다(짧을수록 빨리 잦아듦).
   */
  shake(intensity: number, duration = CONFIG.effects.shakeDuration) {
    if (!this.shakeEnabled) return
    this.shakeAmp = Math.min(CONFIG.effects.shakeMax, this.shakeAmp + intensity)
    // duration 초 뒤 5% 남도록 지수 감쇠율을 정한다 — 시작이 강하고 빠르게 잦아든다.
    this.shakeDecayRate = -Math.log(0.05) / duration
  }

  /** 적 사망 산화: 흰 섬광 → 주황 틴트로 주저앉으며 소멸 */
  deathDissolve(pos: THREE.Vector3, map: THREE.Texture, scale: number) {
    const mat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false })
    const sp = makeBottomAnchoredSprite(mat)
    setSpriteWorldHeight(sp, scale)
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
    const sp = makeBottomAnchoredSprite(mat)
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

  /**
   * 스프라이트 시트 이펙트 재생 (1회, 마지막 프레임 후 제거)
   * @param angle 월드 조준각 — 화면 회전으로 변환해 적용
   */
  playFx(kind: FxKind, x: number, y: number, z: number, scale: number, angle?: number) {
    const def = ASSET.fx[kind]
    const frames = frameTextures(def.path, def.frames)
    const mat = new THREE.SpriteMaterial({ map: frames[0], transparent: true, depthWrite: false })
    if (angle !== undefined) mat.rotation = -angle + Math.PI / 2
    const sp = new THREE.Sprite(mat)
    sp.position.set(x, y, z)
    sp.scale.setScalar(scale)
    this.scene.add(sp)
    this.fx.push({ sp, kind, time: 0, frames, fps: FX_FPS[kind] })
  }

  /** 베기 크레센트 (조준 방향, 사거리에 맞춰 전방 배치) — 바람 잔상을 겹쳐 타격감 보강 */
  slash(pos: THREE.Vector3, angle: number, _arc: number, range: number) {
    const fwd = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
    const x = pos.x + fwd.x * range * 0.45
    const z = pos.z + fwd.z * range * 0.45
    this.playFx('slashWind', x, 1.1, z, range * 1.5, angle)
    this.playFx('slash', x, 1.1, z, range * 1.5, angle)
  }

  /** 궁극기 마무리용 임시 십자 베기 시트. 캐릭터 높이(3.7)의 정확히 두 배로 표시한다. */
  ultimateCross(pos: THREE.Vector3) {
    this.playFx('ultimateCross', pos.x, 1.35, pos.z, 7.4)
  }

  /** 발도 이동 경로 전체에 임시 픽셀 번개 검광을 표시한다. */
  iaido(start: THREE.Vector3, end: THREE.Vector3) {
    const dx = end.x - start.x
    const dz = end.z - start.z
    const distance = Math.max(1, Math.hypot(dx, dz))
    const angle = Math.atan2(dx, dz)
    const frames = frameTextures(ASSET.fx.iaido.path, ASSET.fx.iaido.frames)
    const mat = new THREE.SpriteMaterial({ map: frames[0], transparent: true, depthWrite: false })
    // 스프라이트 원본은 오른쪽을 향한다. 화면에서 +Z 이동은 아래쪽이므로
    // 월드 진행 각도의 상하 부호를 뒤집지 않고 오른쪽 기준만 보정한다.
    mat.rotation = angle - Math.PI / 2
    const sp = new THREE.Sprite(mat)
    sp.position.set((start.x + end.x) / 2, 1.2, (start.z + end.z) / 2)
    // 원본은 넓은 검광이 정사각 캔버스 중앙에 들어 있으므로 경로 길이에 맞춰
    // 가로만 늘리고 세로는 캐릭터 높이보다 살짝 작게 고정한다.
    sp.scale.set(distance * 1.2, 5.2, 1)
    this.scene.add(sp)
    this.fx.push({ sp, kind: 'iaido', time: 0, frames, fps: FX_FPS.iaido })
  }

  /** 총구 화염 (총구 앞쪽에 배치) — 높이는 gunblader_gun_m1911.png 발사 프레임의
   * 실제 총구 픽셀 위치를 월드 단위로 환산한 값(CharacterSprite.ts GUN_SHOOT_FIX 참고) */
  muzzleFlash(pos: THREE.Vector3, angle: number) {
    const fwd = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
    this.playFx('muzzle', pos.x + fwd.x * 1.35, 2.6, pos.z + fwd.z * 1.35, 1.5, angle)
  }

  /** 피격 임팩트 */
  hitImpact(x: number, z: number, scale = 1.3) {
    this.playFx('hit', x, 1.2, z, scale)
  }

  /** 보스 예고와 충격파처럼 바닥에 붙는 프레임 이펙트. */
  playGroundFx(kind: GroundFxKind, x: number, z: number, diameter: number, duration = 1) {
    const frames = frameTextures(ASSET.stage1.effects[kind], kind === 'shockwave' ? 6 : 4)
    const mat = new THREE.MeshBasicMaterial({ map: frames[0], transparent: true, depthWrite: false })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.03, z)
    mesh.scale.set(diameter, diameter, 1)
    this.scene.add(mesh)
    this.groundFx.push({ mesh, time: 0, duration, frames })
  }

  /** 데미지 숫자 (크리티컬이면 강조, rangeBonus면 거리 보너스 발동 색으로 표시) */
  damageNumber(world: THREE.Vector3, amount: number, crit = false, rangeBonus = false) {
    const el = document.createElement('div')
    el.className = 'floater' + (crit ? ' crit' : '') + (rangeBonus ? ' range' : '')
    el.textContent = crit ? `${Math.round(amount)}!` : `${Math.round(amount)}`
    this.layer.appendChild(el)
    this.floaters.push({ el, world: world.clone(), life: 0.8, vy: 2.2 })
  }

  update(dt: number, camera: THREE.Camera) {
    // 화면 흔들림 — Game이 이번 프레임 카메라 위치를 이미 정한 뒤이므로, 그 위에
    // 오프셋을 더하기만 한다(카메라 기준 위치 자체는 건드리지 않는다).
    if (dt > 0 && this.shakeAmp > 0.0005) {
      camera.position.x += (Math.random() * 2 - 1) * this.shakeAmp
      camera.position.z += (Math.random() * 2 - 1) * this.shakeAmp
      this.shakeAmp *= Math.exp(-this.shakeDecayRate * dt)
      if (this.shakeAmp < 0.0005) this.shakeAmp = 0
    }

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

    // 스프라이트 시트 이펙트 (1회 재생 후 제거)
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]
      f.time += dt
      const idx = Math.floor(f.time * f.fps)
      if (idx >= f.frames.length) {
        this.scene.remove(f.sp)
        ;(f.sp.material as THREE.Material).dispose()
        this.fx.splice(i, 1)
        continue
      }
      const m = f.sp.material as THREE.SpriteMaterial
      m.map = f.frames[idx]
      m.needsUpdate = true
      // 끝으로 갈수록 페이드
      m.opacity = 1 - (idx / f.frames.length) * 0.35
    }

    // 바닥 이펙트 (예고/충격파)
    for (let i = this.groundFx.length - 1; i >= 0; i--) {
      const effect = this.groundFx[i]
      effect.time += dt
      const progress = Math.min(1, effect.time / effect.duration)
      const index = Math.min(effect.frames.length - 1, Math.floor(progress * effect.frames.length))
      const mat = effect.mesh.material
      mat.map = effect.frames[index]
      mat.needsUpdate = true
      mat.opacity = 1 - progress * 0.25
      if (effect.time >= effect.duration) {
        this.scene.remove(effect.mesh)
        effect.mesh.geometry.dispose()
        mat.dispose()
        this.groundFx.splice(i, 1)
      }
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
      const x = ((p.x + 1) / 2) * DISPLAY.width
      const y = ((-p.y + 1) / 2) * DISPLAY.height
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
    for (const f of this.fx) this.scene.remove(f.sp)
    for (const effect of this.groundFx) {
      this.scene.remove(effect.mesh)
      effect.mesh.geometry.dispose()
      effect.mesh.material.dispose()
    }
    this.particles = []
    this.slashes = []
    this.floaters = []
    this.deaths = []
    this.ghosts = []
    this.fx = []
    this.groundFx = []
  }
}
