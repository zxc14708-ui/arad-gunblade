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

  // ── 조건 게이지 (발밑 원호) ──────────────────────────────────────────
  // 특성 종류를 몰라도 되도록 (x, z, progress, 충족 색)만 받는 공용 컴포넌트.
  // 한 프레임에 여러 조건이 requestGauge를 부를 수 있어(여러 조건부 특성이
  // 동시에 진행 중) update()가 그중 progress가 가장 높은 것 하나만 그리고,
  // 다음 프레임을 위해 후보를 비운다 — 아무도 부르지 않으면(조건이 깨짐)
  // 다음 update()에서 즉시 사라진다.
  private gaugeMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
  private gaugeCanvas = document.createElement('canvas')
  private gaugeCtx = this.gaugeCanvas.getContext('2d')!
  private gaugeTexture = new THREE.CanvasTexture(this.gaugeCanvas)
  private gaugeCandidate: { x: number; z: number; progress: number; color: string; decreasing: boolean } | null = null
  private gaugeWasFulfilled = false
  private gaugeFlashTimer = 0

  // ── R 리듬 장전 바 (작업 지시 P6 커밋3) ──────────────────────────────
  // 발밑 원호 게이지와 동시에 떠도 겹치지 않도록, 캐릭터 발밑에서 살짝
  // 남쪽(화면 아래쪽, +Z)으로 띄운 가로 막대다. Game이 매 프레임
  // showReloadBar()/hideReloadBar()를 호출해 표시 여부를 관리하고,
  // 성공/실패 순간엔 flashReloadBarResult()가 짧게 색을 덮어써 즉시
  // 피드백을 준다 — flashTimer가 남아있는 동안은 hideReloadBar()가
  // 무시되어(장전이 그 프레임에 이미 끝났어도) 피드백 색이 끊기지 않는다.
  private reloadBarMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
  private reloadBarCanvas = document.createElement('canvas')
  private reloadBarCtx = this.reloadBarCanvas.getContext('2d')!
  private reloadBarTexture = new THREE.CanvasTexture(this.reloadBarCanvas)
  private reloadBarFlashTimer = 0
  private reloadBarFlashColor = '#ffffff'

  // 화면 흔들림: 누적 강도(shakeAmp)를 프레임마다 지수적으로 감쇠시킨다.
  private shakeAmp = 0
  private shakeDecayRate = 8
  private shakeEnabled = true

  constructor(scene: THREE.Scene, uiLayer: HTMLDivElement) {
    this.scene = scene
    this.layer = uiLayer
    this.gaugeCanvas.width = 64
    this.gaugeCanvas.height = 64
    this.reloadBarCanvas.width = 96
    this.reloadBarCanvas.height = 20
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
   * @param scale 가로 기준 스케일 — 세로는 셀 종횡비(cell.h / cell.w)로 유도한다.
   *   정사각 셀(cell.w === cell.h)은 setScalar와 결과가 같다.
   * @param angle 월드 조준각 — 화면 회전으로 변환해 적용
   */
  playFx(kind: FxKind, x: number, y: number, z: number, scale: number, angle?: number) {
    const def = ASSET.fx[kind]
    const frames = frameTextures(def.path, def.frames)
    const mat = new THREE.SpriteMaterial({ map: frames[0], transparent: true, depthWrite: false })
    if (angle !== undefined) mat.rotation = -angle + Math.PI / 2
    const sp = new THREE.Sprite(mat)
    sp.position.set(x, y, z)
    sp.scale.set(scale, scale * (def.cell.h / def.cell.w), 1)
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

  /**
   * 데미지 숫자 (크리티컬이면 강조, rangeBonus면 거리 보너스 발동 색으로 표시,
   * special이면 그 외 특수 발동 강조 색 — 현재 '일섬' 단일 명중 보너스 전용)
   */
  damageNumber(world: THREE.Vector3, amount: number, crit = false, rangeBonus = false, special = false) {
    const el = document.createElement('div')
    el.className = 'floater' + (crit ? ' crit' : '') + (rangeBonus ? ' range' : '') + (special ? ' special' : '')
    el.textContent = crit ? `${Math.round(amount)}!` : `${Math.round(amount)}`
    this.layer.appendChild(el)
    this.floaters.push({ el, world: world.clone(), life: 0.8, vy: 2.2 })
  }

  /**
   * 조건부 특성용 발밑 원호 게이지 요청 — 매 프레임 조건이 살아있는 동안
   * 계속 불러야 한다(호출을 멈추면 다음 프레임에 즉시 사라진다).
   * progress: 0~1. color: 조건 충족(progress>=1) 시 표시할 색(CSS 색 문자열).
   * 충족 전에는 항상 옅은 흰색으로 채워진다 — 호출부가 색을 신경 쓸 필요는
   * 충족 색 하나뿐이다. 한 프레임에 여러 번 불리면 progress가 더 높은
   * 쪽만 남는다(동시 표시는 최대 1개).
   *
   * decreasing: 발도참·조준사격처럼 0→1로 "차오르는" 창이 아니라 역행처럼
   * 0.8초가 "줄어드는" 창일 때 true. 채우는 중과 곧 닫히는 중이 시각적으로
   * 구분되도록 아크를 반대 방향(12시에서 반시계)으로 그리고, 처음부터 지정
   * 색을 그대로 쓴다(충족 개념이 없어 옅은 흰색 단계를 거치지 않는다).
   */
  requestGauge(x: number, z: number, progress: number, color: string, decreasing = false) {
    const clamped = Math.max(0, Math.min(1, progress))
    if (!this.gaugeCandidate || clamped > this.gaugeCandidate.progress) {
      this.gaugeCandidate = { x, z, progress: clamped, color, decreasing }
    }
  }

  private ensureGaugeMesh() {
    if (this.gaugeMesh) return this.gaugeMesh
    const mat = new THREE.MeshBasicMaterial({ map: this.gaugeTexture, transparent: true, depthWrite: false })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.scale.set(1.7, 1.7, 1)
    this.scene.add(mesh)
    this.gaugeMesh = mesh
    return mesh
  }

  private drawGauge(progress: number, color: string, flash: boolean, decreasing: boolean) {
    const ctx = this.gaugeCtx
    const w = this.gaugeCanvas.width
    const h = this.gaugeCanvas.height
    ctx.clearRect(0, 0, w, h)
    const cx = w / 2
    const cy = h / 2
    const radius = w / 2 - 4
    const lineWidth = 6
    // 배경 트랙
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.stroke()
    // 진행 아크 — 차오르는 쪽은 12시에서 시계 방향, 줄어드는 쪽(역행)은 12시에서
    // 반시계 방향으로 그려 방향 자체로 "채우는 중"과 "닫히는 중"을 구분한다.
    if (progress > 0) {
      ctx.beginPath()
      if (decreasing) ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 - progress * Math.PI * 2, true)
      else ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      // 줄어드는 쪽은 "충족" 개념이 없어 옅은 흰색 단계 없이 처음부터 지정 색.
      ctx.strokeStyle = flash ? '#ffffff' : decreasing || progress >= 1 ? color : 'rgba(255,255,255,0.7)'
      ctx.stroke()
    }
    this.gaugeTexture.needsUpdate = true
  }

  private updateGauge(dt: number) {
    const c = this.gaugeCandidate
    this.gaugeCandidate = null // 다음 프레임을 위해 비운다 — 아무도 안 부르면 다음 프레임엔 사라진다
    if (!c) {
      if (this.gaugeMesh) {
        this.scene.remove(this.gaugeMesh)
        this.gaugeMesh.geometry.dispose()
        this.gaugeMesh.material.dispose()
        this.gaugeMesh = null
      }
      this.gaugeWasFulfilled = false
      this.gaugeFlashTimer = 0
      return
    }
    // 줄어드는 게이지는 "충족"이 아니라 "만료"라 fulfilled 번쩍임 로직이 안
    // 맞는다(시작부터 progress가 높아 즉시 번쩍여버린다) — 대상에서 제외한다.
    const fulfilled = !c.decreasing && c.progress >= 1
    if (fulfilled && !this.gaugeWasFulfilled) this.gaugeFlashTimer = 0.18 // 충족 순간 한 번 번쩍
    this.gaugeWasFulfilled = fulfilled
    if (this.gaugeFlashTimer > 0) this.gaugeFlashTimer = Math.max(0, this.gaugeFlashTimer - dt)
    const mesh = this.ensureGaugeMesh()
    mesh.position.set(c.x, 0.04, c.z)
    this.drawGauge(c.progress, c.color, this.gaugeFlashTimer > 0, c.decreasing)
  }

  private ensureReloadBarMesh() {
    if (this.reloadBarMesh) return this.reloadBarMesh
    const mat = new THREE.MeshBasicMaterial({ map: this.reloadBarTexture, transparent: true, depthWrite: false })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.scale.set(2.2, 0.46, 1)
    this.scene.add(mesh)
    this.reloadBarMesh = mesh
    return mesh
  }

  /** 진행 중인 장전 바 — 배경 트랙 + 성공 구간(색) + 진행 커서. */
  private drawReloadBar(progress: number, windowStart: number, windowEnd: number) {
    const ctx = this.reloadBarCtx
    const w = this.reloadBarCanvas.width
    const h = this.reloadBarCanvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(8, 11, 18, 0.78)'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(250, 204, 21, 0.55)'
    ctx.fillRect(windowStart * w, 0, (windowEnd - windowStart) * w, h)
    const cursorX = Math.max(1.5, Math.min(w - 1.5, progress * w))
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(cursorX - 1.5, 0, 3, h)
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
    this.reloadBarTexture.needsUpdate = true
  }

  /** 즉시 성공/실패 피드백 — 바 전체를 짧게 단색으로 덮는다(색 신호는 사운드와 함께 온다). */
  private drawReloadBarFlash(color: string) {
    const ctx = this.reloadBarCtx
    const w = this.reloadBarCanvas.width
    const h = this.reloadBarCanvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = color
    ctx.globalAlpha = 0.85
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
    this.reloadBarTexture.needsUpdate = true
  }

  /** 장전 중일 때 매 프레임 호출 — Game이 player.reloading===false가 되면 대신 hideReloadBar()를 부른다. */
  showReloadBar(x: number, z: number, progress: number, windowStart: number, windowEnd: number) {
    const mesh = this.ensureReloadBarMesh()
    mesh.position.set(x, 0.05, z + 1.3)
    mesh.visible = true
    if (this.reloadBarFlashTimer <= 0) this.drawReloadBar(progress, windowStart, windowEnd)
  }

  /** 장전 중이 아닐 때 매 프레임 호출 — 성공/실패 플래시가 아직 남아있으면 무시한다. */
  hideReloadBar() {
    if (this.reloadBarFlashTimer > 0) return
    if (this.reloadBarMesh) this.reloadBarMesh.visible = false
  }

  /** 리듬 장전 성공/실패 순간 — 짧게 색을 덮어써 즉시 피드백을 준다. */
  flashReloadBarResult(x: number, z: number, success: boolean) {
    this.reloadBarFlashTimer = CONFIG.player.reloadRhythm.flashDuration
    this.reloadBarFlashColor = success ? '#4ade80' : '#f87171'
    const mesh = this.ensureReloadBarMesh()
    mesh.position.set(x, 0.05, z + 1.3)
    mesh.visible = true
    this.drawReloadBarFlash(this.reloadBarFlashColor)
  }

  private updateReloadBarFlash(dt: number) {
    if (this.reloadBarFlashTimer <= 0) return
    this.reloadBarFlashTimer = Math.max(0, this.reloadBarFlashTimer - dt)
  }

  update(dt: number, camera: THREE.Camera) {
    this.updateGauge(dt)
    this.updateReloadBarFlash(dt)
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
    if (this.gaugeMesh) {
      this.scene.remove(this.gaugeMesh)
      this.gaugeMesh.geometry.dispose()
      this.gaugeMesh.material.dispose()
      this.gaugeMesh = null
    }
    this.gaugeCandidate = null
    this.gaugeWasFulfilled = false
    this.gaugeFlashTimer = 0
    if (this.reloadBarMesh) {
      this.scene.remove(this.reloadBarMesh)
      this.reloadBarMesh.geometry.dispose()
      this.reloadBarMesh.material.dispose()
      this.reloadBarMesh = null
    }
    this.reloadBarFlashTimer = 0
    this.particles = []
    this.slashes = []
    this.floaters = []
    this.deaths = []
    this.ghosts = []
    this.fx = []
    this.groundFx = []
  }
}
