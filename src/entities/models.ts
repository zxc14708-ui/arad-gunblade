import * as THREE from 'three'
import { COLORS } from '../config'

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...opts })
}

/**
 * 총검사(Gunblade) 캐릭터 모델 — "Commander of the Iron Flora" 피규어 참조.
 * 금발 스웨이드 헤어 + 안경 + 금색 자수 흰 롱코트 + 흰 크라바트 + 녹색 조끼 +
 * 큰 벨트 메달 + 금색 술 + 짙은 갈색 바지(금 사이드라인) + 갈색 레이스업 부츠 +
 * 왼손 M1911(총구 위로) + 오른손 붉은 카타나(금색 술).
 *
 * 애니메이션을 위해 팔다리를 관절 그룹으로 구성:
 *  'legL','legR' = 다리(걷기/뛰기), 'armR' = 검 팔(휘두르기, 카타나 포함),
 *  'katana','pistolSlide' = 무기 파츠. 루트는 +Z 정면, rotation.order='YXZ'(요우+린).
 */
export function buildGunblade(): THREE.Group {
  const g = new THREE.Group()
  g.rotation.order = 'YXZ' // 먼저 방향(y) 후 대시 기울임(x)

  const skin = mat(COLORS.skin, { roughness: 0.55 })
  const coat = mat(COLORS.coat, { roughness: 0.78 })
  const lining = mat(0xd9c8a4, { roughness: 0.85 }) // 코트 안감(베이지)
  const vest = mat(COLORS.vest, { roughness: 0.6 })
  const cravat = mat(0xf2ebd8, { roughness: 0.7 }) // 흰 크라바트
  const pants = mat(0x33271c, { roughness: 0.7 }) // 짙은 갈색 바지
  const boots = mat(0x6b4526, { roughness: 0.55 })
  const belt = mat(0x4f3320, { roughness: 0.55 })
  const glove = mat(0x2b2620, { roughness: 0.6 })
  const hair = mat(0xdcc074, { roughness: 0.45, metalness: 0.2 }) // 금발
  const metal = mat(COLORS.gunMetal, { metalness: 0.85, roughness: 0.3 })
  const gold = mat(0xca9b3e, { metalness: 0.7, roughness: 0.35 }) // 금색 자수/장식

  // ═══ 다리 (관절 그룹: 엉덩이 피벗) ═══
  const legGeoT = new THREE.CylinderGeometry(0.15, 0.13, 0.52, 8)
  const legGeoS = new THREE.CylinderGeometry(0.13, 0.11, 0.5, 8)
  for (const [name, sx] of [['legL', -0.18], ['legR', 0.18]] as [string, number][]) {
    const leg = new THREE.Group()
    leg.name = name
    leg.position.set(sx, 1.0, 0)
    const thigh = new THREE.Mesh(legGeoT, pants)
    thigh.position.y = -0.24
    leg.add(thigh)
    const shin = new THREE.Mesh(legGeoS, pants)
    shin.position.y = -0.64
    leg.add(shin)
    // 바지 금색 사이드라인
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.85, 0.03), gold)
    stripe.position.set(sx < 0 ? -0.14 : 0.14, -0.46, 0.02)
    leg.add(stripe)
    // 부츠 (레이스업) — 발바닥이 지면(world y≈0)에 닿도록
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.38), boots)
    boot.position.set(0, -0.86, 0.05)
    leg.add(boot)
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 0.22), boots)
    toe.position.set(0, -0.94, 0.24)
    leg.add(toe)
    const laces = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.02), gold)
    laces.position.set(0, -0.82, 0.25)
    leg.add(laces)
    g.add(leg)
  }

  // ═══ 골반 / 벨트 / 메달 / 술 ═══
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.27, 0.34, 10), pants)
  hips.position.y = 1.05
  g.add(hips)
  const beltBand = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.13, 14), belt)
  beltBand.position.y = 1.18
  g.add(beltBand)
  // 큰 원형 메달 버클
  const medal = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16), gold)
  medal.rotation.x = Math.PI / 2
  medal.position.set(0, 1.18, 0.31)
  g.add(medal)
  const medalCore = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12), mat(0x8a6a28, { metalness: 0.6 }))
  medalCore.rotation.x = Math.PI / 2
  medalCore.position.set(0, 1.18, 0.33)
  g.add(medalCore)
  // 왼쪽 힙 파우치
  const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.1), mat(0x3a2718, { roughness: 0.7 }))
  pouch.position.set(-0.28, 1.06, 0.16)
  g.add(pouch)
  // 오른쪽 힙에서 늘어지는 금색 술(cord tassel)
  for (let i = 0; i < 4; i++) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.5 + (i % 2) * 0.15, 5), gold)
    cord.position.set(0.24 + i * 0.03, 0.85, 0.18 - i * 0.02)
    cord.rotation.x = 0.15
    g.add(cord)
  }

  // ═══ 몸통: 흰 셔츠 + 녹색 조끼 ═══
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.27, 0.92, 12), cravat)
  torso.position.y = 1.6
  g.add(torso)
  const vestBody = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.285, 0.88, 12, 1, false, -Math.PI * 0.68, Math.PI * 1.36), vest)
  vestBody.position.y = 1.56
  g.add(vestBody)
  for (let i = 0; i < 4; i++) {
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), gold)
    btn.position.set(0, 1.34 + i * 0.15, 0.3)
    g.add(btn)
  }

  // ═══ 흰 롱코트 ═══
  const coatBody = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.35, 1.0, 14, 1, true, -Math.PI * 0.58, Math.PI * 1.16), coat)
  coatBody.position.y = 1.6
  g.add(coatBody)
  // 옷깃 (넓은 라펠)
  for (const sx of [-1, 1]) {
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.04), coat)
    lapel.position.set(sx * 0.17, 1.78, 0.29)
    lapel.rotation.set(-0.15, 0, sx * 0.22)
    g.add(lapel)
  }
  // 밑단 스커트 (두 겹: 흰 겉감 + 베이지 안감)
  const coatSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.6, 1.15, 14, 1, true), coat)
  coatSkirt.position.set(0, 0.95, -0.05)
  g.add(coatSkirt)
  // 뒤로 크게 나부끼는 자락
  const flapInner = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.7, 0.03), lining)
  flapInner.position.set(0, 0.6, -0.44)
  flapInner.rotation.x = 0.4
  g.add(flapInner)
  const flapOuter = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.03), coat)
  flapOuter.position.set(0, 0.62, -0.49)
  flapOuter.rotation.x = 0.4
  g.add(flapOuter)

  // ═══ 어깨 + 오른쪽 가슴/어깨 금색 자수 ═══
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.52, 4, 8), coat)
  shoulders.rotation.z = Math.PI / 2
  shoulders.position.y = 2.0
  g.add(shoulders)
  // 금색 바로크 자수 패치(오른쪽 가슴+어깨)
  const embShoulder = new THREE.Mesh(new THREE.CircleGeometry(0.15, 12), gold)
  embShoulder.position.set(0.28, 2.02, 0.16)
  embShoulder.rotation.set(-0.5, 0.4, 0)
  g.add(embShoulder)
  for (let i = 0; i < 5; i++) {
    const swirl = new THREE.Mesh(new THREE.TorusGeometry(0.04 + i * 0.012, 0.008, 5, 8, Math.PI * 1.3), gold)
    swirl.position.set(0.16 + i * 0.02, 1.9 - i * 0.09, 0.29)
    swirl.rotation.set(0, 0.2, i * 0.5)
    g.add(swirl)
  }
  // 오른 상완 코트 버클 스트랩
  const armStrap = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 6, 12), belt)
  armStrap.position.set(0.5, 1.82, 0.05)
  armStrap.rotation.y = Math.PI / 2
  g.add(armStrap)

  // ═══ 왼팔 (M1911을 얼굴 옆으로 올려 든 포즈 — 참조 이미지) ═══
  // 상완: 어깨→팔꿈치(앞으로)
  const leftUpper = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.38, 4, 6), coat)
  leftUpper.position.set(-0.4, 1.8, 0.18)
  leftUpper.rotation.set(-0.9, 0, 0.2)
  g.add(leftUpper)
  // 전완: 팔꿈치→손(위로, 얼굴 앞)
  const leftFore = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.36, 4, 6), coat)
  leftFore.position.set(-0.32, 2.0, 0.34)
  leftFore.rotation.set(-0.2, 0, 0.5)
  g.add(leftFore)
  const lHand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), glove)
  lHand.position.set(-0.16, 2.16, 0.36)
  g.add(lHand)

  // ── M1911 권총 (왼손, 총구를 위로 치켜든 포즈) ──
  const pistol = new THREE.Group()
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.34), metal)
  frame.position.set(0, -0.02, 0.06)
  pistol.add(frame)
  const slideGrp = new THREE.Group()
  const slideBody = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.4), mat(0x3a3a42, { metalness: 0.85, roughness: 0.28 }))
  slideBody.position.z = 0.08
  slideGrp.add(slideBody)
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), metal)
  muzzle.rotation.x = Math.PI / 2
  muzzle.position.set(0, 0, 0.29)
  slideGrp.add(muzzle)
  slideGrp.position.set(0, 0.04, 0)
  slideGrp.name = 'pistolSlide'
  pistol.add(slideGrp)
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.24, 0.11), mat(0x5a3a24, { roughness: 0.7 }))
  grip.position.set(0, -0.16, -0.08)
  grip.rotation.x = 0.28
  pistol.add(grip)
  const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), metal)
  hammer.position.set(0, 0.05, -0.14)
  pistol.add(hammer)
  // 손 위치에서 총구를 위로 치켜든 포즈
  pistol.position.set(-0.13, 2.14, 0.4)
  pistol.rotation.set(-1.35, 0.15, 0.25)
  g.add(pistol)
  // 총구 연기(살짝)
  const smoke = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 6, 6),
    mat(0xcccccc, { transparent: true, opacity: 0.25, roughness: 1 }),
  )
  smoke.position.set(-0.08, 2.55, 0.42)
  g.add(smoke)

  // ═══ 오른팔 (관절 그룹 'armR' — 카타나 포함, 검 휘두르기용) ═══
  const armR = new THREE.Group()
  armR.name = 'armR'
  armR.position.set(0.46, 1.98, 0.04) // 어깨 피벗
  const rUpper = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.42, 4, 6), coat)
  rUpper.position.set(0.04, -0.24, 0.02)
  rUpper.rotation.set(0.1, 0, -0.12)
  armR.add(rUpper)
  const rFore = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 4, 6), coat)
  rFore.position.set(0.08, -0.6, 0.14)
  rFore.rotation.set(0.5, 0, -0.1)
  armR.add(rFore)
  const rHand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), glove)
  rHand.position.set(0.1, -0.82, 0.3)
  armR.add(rHand)

  // 카타나 (오른손, 아래-앞으로 든 붉은 도신 + 금색 술)
  const katana = new THREE.Group()
  katana.name = 'katana'
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.028, 2.2), mat(COLORS.katana, { metalness: 0.5, roughness: 0.3 }))
  blade.position.z = 1.2
  katana.add(blade)
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.034, 2.2), mat(COLORS.katanaEdge, { metalness: 0.4 }))
  edge.position.set(0.026, 0, 1.2)
  katana.add(edge)
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.18, 4), mat(COLORS.katana, { metalness: 0.5 }))
  tip.rotation.x = Math.PI / 2
  tip.position.z = 2.38
  katana.add(tip)
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 8), gold)
  guard.rotation.x = Math.PI / 2
  guard.position.z = 0.1
  katana.add(guard)
  const hiltMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.36, 8), mat(0x171717))
  hiltMesh.rotation.x = Math.PI / 2
  hiltMesh.position.z = -0.12
  katana.add(hiltMesh)
  // 손잡이 금색 술
  for (let i = 0; i < 4; i++) {
    const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.3, 5), gold)
    tassel.position.set((i - 1.5) * 0.025, -0.16, -0.34)
    tassel.rotation.x = 0.2
    katana.add(tassel)
  }
  // 손 위치에서 아래-앞으로 뻗도록 배치
  katana.position.set(0.1, -0.82, 0.32)
  katana.rotation.set(1.15, 0.1, 0)
  armR.add(katana)
  g.add(armR)

  // ═══ 목 + 흰 크라바트(가슴으로 흘러내림) ═══
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.14, 8), skin)
  neck.position.y = 2.1
  g.add(neck)
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), cravat)
  knot.position.set(0, 2.0, 0.2)
  knot.scale.set(1, 0.8, 0.8)
  g.add(knot)
  const cravatTail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.4, 0.05), cravat)
  cravatTail.position.set(0.02, 1.72, 0.28)
  cravatTail.rotation.set(0.1, 0, 0.08)
  g.add(cravatTail)

  // ═══ 머리 + 금발(스웨이드 뒤로 넘김) + 안경 ═══
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 14), skin)
  head.position.y = 2.36
  head.scale.set(0.92, 1.06, 0.96)
  g.add(head)
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), hair)
  hairTop.position.set(0, 2.42, -0.02)
  hairTop.scale.set(1, 1.05, 1.08)
  g.add(hairTop)
  // 위로 솟구쳐 뒤로 넘긴 앞머리 스파이크
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 5), hair)
    const a = (i / 4 - 0.5) * 1.2
    spike.position.set(Math.sin(a) * 0.16, 2.56, 0.08 - Math.cos(a) * 0.04)
    spike.rotation.set(-0.7, 0, a * 0.4)
    g.add(spike)
  }
  // 옆/뒤 머릿결
  for (let i = 0; i < 5; i++) {
    const strand = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 5), hair)
    const a = (i / 4 - 0.5) * 1.7
    strand.position.set(Math.sin(a) * 0.22, 2.44, -0.16 - Math.cos(a) * 0.04)
    strand.rotation.set(1.9, 0, a * 0.3)
    g.add(strand)
  }

  const eyeMat = mat(0x2a2a30, { metalness: 0.5 })
  for (const sx of [-0.09, 0.09]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.013, 6, 14), metal)
    rim.position.set(sx, 2.34, 0.22)
    g.add(rim)
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.066, 12), eyeMat)
    lens.position.set(sx, 2.34, 0.215)
    g.add(lens)
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), metal)
  bridge.position.set(0, 2.34, 0.24)
  g.add(bridge)

  // 오른 허리 홀스터
  const holster = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.13), mat(0x3a2718, { roughness: 0.7 }))
  holster.position.set(0.29, 1.0, 0.08)
  holster.rotation.z = 0.15
  g.add(holster)

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = false
    }
  })

  return g
}

/** 마족 임프 (기본 근접 적) */
export function buildImp(color = COLORS.imp): THREE.Group {
  const g = new THREE.Group()
  const body = mat(color, { roughness: 0.8 })
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), body)
  torso.scale.set(1, 1.1, 1)
  torso.position.y = 0.7
  g.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), body)
  head.position.set(0, 1.3, 0.05)
  g.add(head)
  // 뿔
  for (const sx of [-0.16, 0.16]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 6), mat(COLORS.impHorn))
    horn.position.set(sx, 1.55, 0)
    horn.rotation.z = sx > 0 ? -0.3 : 0.3
    g.add(horn)
  }
  // 눈
  for (const sx of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mat(0xffe08a, { emissive: 0xffaa00, emissiveIntensity: 1 }))
    eye.position.set(sx, 1.34, 0.3)
    g.add(eye)
  }
  // 팔
  for (const sx of [-0.5, 0.5]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 4, 6), body)
    arm.position.set(sx, 0.75, 0)
    arm.rotation.z = sx > 0 ? -0.5 : 0.5
    g.add(arm)
  }
  // 다리
  for (const sx of [-0.2, 0.2]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.3, 4, 6), body)
    leg.position.set(sx, 0.25, 0)
    g.add(leg)
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })
  return g
}

/** 브루트 (거대 근접 탱커) */
export function buildBrute(): THREE.Group {
  const g = buildImp(COLORS.brute)
  g.scale.setScalar(1.7)
  return g
}

/** 슈터 (원거리 마법 적) */
export function buildShooter(): THREE.Group {
  const g = new THREE.Group()
  const body = mat(COLORS.shooter, { roughness: 0.6, emissive: COLORS.shooter, emissiveIntensity: 0.15 })
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.6, 10), body)
  robe.position.y = 0.8
  g.add(robe)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), mat(0x1a2a30))
  head.position.y = 1.6
  g.add(head)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), mat(0x6ad0ff, { emissive: 0x6ad0ff, emissiveIntensity: 1.5 }))
  eye.position.set(0, 1.62, 0.2)
  g.add(eye)
  // 떠다니는 오브
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), mat(COLORS.enemyBullet, { emissive: COLORS.enemyBullet, emissiveIntensity: 1 }))
  orb.position.set(0.5, 1.2, 0.3)
  orb.name = 'orb'
  g.add(orb)
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })
  return g
}

/** 보스 (거대 마족) */
export function buildBoss(): THREE.Group {
  const g = buildImp(COLORS.boss)
  g.scale.setScalar(2.6)
  // 왕관 뿔
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 16), mat(0xffd070, { emissive: 0xffa000, emissiveIntensity: 0.4 }))
  crown.rotation.x = Math.PI / 2
  crown.position.y = 1.5
  g.add(crown)
  return g
}
