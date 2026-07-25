import * as THREE from 'three'

/**
 * 하이브리드 2D 캐릭터 — 3D 월드 안에 항상 카메라를 향하는 빌보드 스프라이트.
 *
 * 지금은 캔버스로 그린 "플레이스홀더 총검사"를 쓰지만,
 * 나중에 고퀄 스프라이트 시트/일러스트로 교체하기 쉽게 설계되어 있다:
 *   - CharacterSprite.SHEET_URL 에 이미지 경로를 넣으면 그 이미지를 사용
 *   - (스프라이트 시트 프레임 애니메이션은 setSheet()로 확장 가능)
 */
export class CharacterSprite {
  /** 실제 아트로 교체하려면 여기에 '/character.png' 같은 경로를 넣으세요. */
  static SHEET_URL: string | null = null

  object = new THREE.Group()
  private sprite: THREE.Sprite
  private mat: THREE.SpriteMaterial
  private shadow: THREE.Mesh
  private readonly baseW = 2.0
  private readonly baseH = 2.9
  private walkPhase = 0
  private flip = 1
  private facingLerp = 1

  constructor() {
    const tex = CharacterSprite.SHEET_URL
      ? new THREE.TextureLoader().load(CharacterSprite.SHEET_URL)
      : new THREE.CanvasTexture(drawGunbladeSprite())
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.colorSpace = THREE.SRGBColorSpace

    this.mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    this.sprite = new THREE.Sprite(this.mat)
    this.sprite.center.set(0.5, 0) // 하단(발) 기준 앵커
    this.sprite.scale.set(this.baseW, this.baseH, 1)
    this.object.add(this.sprite)

    // 발밑 가짜 그림자 (스프라이트는 그림자를 못 드리우므로)
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })
    shadowMat.userData.outlineParameters = { visible: false }
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.02
    this.shadow.scale.set(1, 0.55, 1)
    this.object.add(this.shadow)
  }

  update(
    dt: number,
    pos: THREE.Vector3,
    aimAngle: number,
    st: { moving: boolean; dashing: boolean; swinging: boolean; invulnerable: boolean },
    hitFlash: number,
  ) {
    // ── 좌우 바라보기 (조준 x 방향으로 플립) ──
    const targetFlip = Math.sin(aimAngle) < -0.15 ? -1 : Math.sin(aimAngle) > 0.15 ? 1 : this.flip
    this.flip = targetFlip
    this.facingLerp += (this.flip - this.facingLerp) * Math.min(1, dt * 16)

    // ── 걷기 바운스 / 대시 스트레치 / 베기 펀치 ──
    let bob = 0
    if (st.moving) {
      this.walkPhase += dt * (st.dashing ? 20 : 11)
      bob = Math.abs(Math.sin(this.walkPhase)) * (st.dashing ? 0.16 : 0.1)
    } else {
      this.walkPhase = 0
    }
    let sw = this.baseW * this.facingLerp
    let sh = this.baseH
    if (st.dashing) {
      sh *= 1.06
      sw *= 0.96
    }
    if (st.swinging) {
      sw *= 1.06
      sh *= 1.04
    }
    this.sprite.scale.set(sw, sh, 1)
    this.sprite.position.set(0, bob, 0)
    this.object.position.set(pos.x, 0, pos.z)

    // ── 피격 붉은 틴트 ──
    if (hitFlash > 0) this.mat.color.setRGB(1, 0.4, 0.4)
    else this.mat.color.setRGB(1, 1, 1)

    // ── 무적 깜빡임 ──
    this.mat.opacity = st.invulnerable && Math.floor(performance.now() / 70) % 2 === 0 ? 0.35 : 1
    this.shadow.visible = !st.dashing || true
  }
}

/** 캔버스로 그린 플레이스홀더 총검사 스프라이트 (셀/도트풍) */
function drawGunbladeSprite(): HTMLCanvasElement {
  const W = 220
  const H = 320
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const x = cv.getContext('2d')!
  x.lineJoin = 'round'
  x.lineCap = 'round'

  const OUTLINE = '#241f1b'
  const shape = (fill: string, lw = 5, draw?: () => void) => {
    x.beginPath()
    draw?.()
    x.fillStyle = fill
    x.fill()
    x.lineWidth = lw
    x.strokeStyle = OUTLINE
    x.stroke()
  }
  const rrect = (px: number, py: number, w: number, h: number, r: number) => {
    x.beginPath()
    x.moveTo(px + r, py)
    x.arcTo(px + w, py, px + w, py + h, r)
    x.arcTo(px + w, py + h, px, py + h, r)
    x.arcTo(px, py + h, px, py, r)
    x.arcTo(px, py, px + w, py, r)
    x.closePath()
  }

  // ── 뒤로 나부끼는 코트 자락 (베이지 안감) ──
  shape('#d9c8a4', 5, () => {
    x.moveTo(70, 150)
    x.quadraticCurveTo(20, 230, 55, 300)
    x.lineTo(95, 290)
    x.quadraticCurveTo(80, 220, 95, 160)
    x.closePath()
  })

  // ── 카타나 (오른손, 뒤쪽 대각선 — 붉은 도신) ──
  x.save()
  x.translate(150, 175)
  x.rotate(0.55)
  shape('#a6503c', 5, () => rrect(-6, -8, 12, 150, 5)) // 도신
  x.fillStyle = '#e8d9b0' // 날
  x.fillRect(-6, -8, 3, 150)
  shape('#c99a3e', 4, () => rrect(-14, 138, 28, 10, 4)) // 금 코등이
  shape('#1a1a1a', 4, () => rrect(-7, 146, 14, 34, 5)) // 손잡이
  // 금색 술
  x.strokeStyle = '#d8b24a'
  x.lineWidth = 3
  for (let i = -1; i <= 1; i++) {
    x.beginPath()
    x.moveTo(i * 5, 180)
    x.lineTo(i * 6, 205)
    x.stroke()
  }
  x.restore()

  // ── 다리 & 부츠 ──
  shape('#33271c', 5, () => rrect(88, 240, 20, 55, 7)) // 왼다리
  shape('#33271c', 5, () => rrect(114, 240, 20, 55, 7)) // 오른다리
  shape('#6b4526', 5, () => rrect(84, 288, 26, 24, 6)) // 왼부츠
  shape('#6b4526', 5, () => rrect(112, 288, 26, 24, 6)) // 오른부츠

  // ── 흰 롱코트 몸통 (아래로 벌어짐) ──
  shape('#f2efe6', 6, () => {
    x.moveTo(78, 120)
    x.lineTo(142, 120)
    x.lineTo(158, 275)
    x.lineTo(62, 275)
    x.closePath()
  })
  // 코트 앞 열림(녹색 조끼)
  shape('#4a5a3c', 4, () => {
    x.moveTo(98, 128)
    x.lineTo(122, 128)
    x.lineTo(118, 205)
    x.lineTo(102, 205)
    x.closePath()
  })
  // 조끼 금단추
  x.fillStyle = '#d8b24a'
  for (let i = 0; i < 3; i++) {
    x.beginPath()
    x.arc(110, 145 + i * 20, 2.6, 0, 7)
    x.fill()
  }
  // 벨트 + 금 메달
  shape('#4f3320', 3, () => rrect(80, 200, 60, 12, 4))
  x.fillStyle = '#c99a3e'
  x.beginPath()
  x.arc(110, 206, 8, 0, 7)
  x.fill()
  x.lineWidth = 2
  x.strokeStyle = OUTLINE
  x.stroke()
  // 코트 라펠(옷깃)
  shape('#f2efe6', 4, () => {
    x.moveTo(98, 122)
    x.lineTo(110, 150)
    x.lineTo(90, 150)
    x.closePath()
  })
  shape('#f2efe6', 4, () => {
    x.moveTo(122, 122)
    x.lineTo(130, 150)
    x.lineTo(110, 150)
    x.closePath()
  })
  // 오른어깨 금색 자수
  x.fillStyle = '#c99a3e'
  for (let i = 0; i < 4; i++) {
    x.beginPath()
    x.arc(140 - i * 3, 130 + i * 9, 3 - i * 0.3, 0, 7)
    x.fill()
  }

  // ── 오른팔 소매(카타나 쪽, 몸 앞) ──
  shape('#f2efe6', 5, () => rrect(132, 150, 22, 60, 10))
  shape('#2b2620', 4, () => x.arc(146, 210, 9, 0, 7)) // 장갑 손

  // ── 왼팔 + M1911 (얼굴 옆, 총구 위로) ──
  shape('#f2efe6', 5, () => {
    // 어깨→팔꿈치→위로
    x.moveTo(80, 135)
    x.lineTo(66, 100)
    x.lineTo(80, 96)
    x.lineTo(94, 140)
    x.closePath()
  })
  shape('#2b2620', 4, () => x.arc(72, 92, 9, 0, 7)) // 장갑 손
  // M1911 (총구 위)
  x.save()
  x.translate(72, 88)
  x.rotate(-0.15)
  shape('#3a3a42', 3.5, () => rrect(-6, -46, 12, 40, 3)) // 슬라이드
  shape('#5a3a24', 3.5, () => rrect(-7, -8, 14, 16, 3)) // 그립
  x.restore()

  // ── 흰 크라바트 ──
  shape('#f2ebd8', 4, () => {
    x.moveTo(102, 116)
    x.lineTo(118, 116)
    x.lineTo(112, 140)
    x.lineTo(108, 140)
    x.closePath()
  })

  // ── 머리 ──
  shape('#e2b48c', 5, () => x.arc(110, 92, 27, 0, 7)) // 얼굴
  // 금발 (뒤로 넘긴 스파이크)
  shape('#d8bf6e', 5, () => {
    x.moveTo(84, 88)
    x.quadraticCurveTo(80, 58, 100, 62)
    x.quadraticCurveTo(105, 48, 116, 60)
    x.quadraticCurveTo(126, 50, 132, 66)
    x.quadraticCurveTo(140, 62, 136, 90)
    x.quadraticCurveTo(120, 72, 84, 88)
    x.closePath()
  })
  // 안경
  x.strokeStyle = '#2a2a30'
  x.lineWidth = 3
  x.fillStyle = 'rgba(120,140,160,0.5)'
  x.beginPath()
  x.arc(101, 92, 7, 0, 7)
  x.fill()
  x.stroke()
  x.beginPath()
  x.arc(119, 92, 7, 0, 7)
  x.fill()
  x.stroke()
  x.beginPath()
  x.moveTo(108, 92)
  x.lineTo(112, 92)
  x.stroke()

  return cv
}
