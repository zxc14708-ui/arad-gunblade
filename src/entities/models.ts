import * as THREE from 'three'
import { COLORS } from '../config'

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...opts })
}

/**
 * 총검사(Gunblade) 캐릭터 모델.
 * 참조 원화: 은발 뒤로 넘긴 머리 + 안경 + 흰 롱코트(어깨 자수) + 흰 스카프 +
 * 녹색 조끼 + 짙은 바지 + 갈색 부츠 + 벨트/홀스터 + M1911 권총 + 붉은 도신 카타나(노란 술).
 * 반환 그룹은 +Z를 정면으로 향하고, 'pistolSlide'/'katana' 이름의 파츠를 애니메이션한다.
 */
export function buildGunblade(): THREE.Group {
  const g = new THREE.Group()

  const skin = mat(COLORS.skin, { roughness: 0.55 })
  const coat = mat(COLORS.coat, { roughness: 0.8 })
  const coatDark = mat(COLORS.coatShadow, { roughness: 0.88 })
  const vest = mat(COLORS.vest, { roughness: 0.65 })
  const shirt = mat(0xefe9dc, { roughness: 0.7 }) // 흰 셔츠/스카프
  const pants = mat(COLORS.pants)
  const boots = mat(COLORS.boots, { roughness: 0.6 })
  const belt = mat(0x5b3d26, { roughness: 0.6 })
  const hair = mat(COLORS.hair, { roughness: 0.5, metalness: 0.15 })
  const metal = mat(COLORS.gunMetal, { metalness: 0.85, roughness: 0.3 })
  const gold = mat(0xd8b45a, { metalness: 0.6, roughness: 0.4 })

  // ── 다리 & 부츠 ──
  for (const sx of [-0.2, 0.2]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 1.0, 8), pants)
    leg.position.set(sx, 0.55, 0)
    g.add(leg)
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.46), boots)
    boot.position.set(sx, 0.12, 0.08)
    g.add(boot)
    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.22), mat(0x3a2818))
    heel.position.set(sx, 0.05, -0.06)
    g.add(heel)
  }

  // ── 골반/벨트 ──
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.3, 10), pants)
  hips.position.y = 1.02
  g.add(hips)
  const beltBand = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 12), belt)
  beltBand.position.y = 1.12
  g.add(beltBand)
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.05), gold)
  buckle.position.set(0, 1.12, 0.32)
  g.add(buckle)

  // ── 몸통: 흰 셔츠 + 녹색 조끼 ──
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.95, 12), shirt)
  torso.position.y = 1.55
  g.add(torso)
  // 녹색 조끼(앞면 살짝 벌어짐)
  const vestBody = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.29, 0.9, 12, 1, false, -Math.PI * 0.72, Math.PI * 1.44), vest)
  vestBody.position.y = 1.5
  g.add(vestBody)
  // 조끼 단추
  for (let i = 0; i < 3; i++) {
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), gold)
    btn.position.set(0, 1.35 + i * 0.18, 0.31)
    g.add(btn)
  }

  // ── 흰 롱코트 ──
  const coatBody = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.36, 1.05, 14, 1, true, -Math.PI * 0.62, Math.PI * 1.24), coat)
  coatBody.position.y = 1.55
  g.add(coatBody)
  // 코트 옷깃(lapel)
  for (const sx of [-1, 1]) {
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.04), coat)
    lapel.position.set(sx * 0.16, 1.75, 0.3)
    lapel.rotation.z = sx * 0.2
    lapel.rotation.x = -0.15
    g.add(lapel)
  }
  // 코트 밑단 스커트
  const coatSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.1, 14, 1, true), coat)
  coatSkirt.position.set(0, 0.92, -0.06)
  g.add(coatSkirt)
  // 뒤로 나부끼는 긴 자락 (안감은 어두운 색)
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.5, 0.04), coatDark)
  flap.position.set(0, 0.7, -0.46)
  flap.rotation.x = 0.32
  g.add(flap)
  const flapOuter = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.03), coat)
  flapOuter.position.set(0, 0.72, -0.5)
  flapOuter.rotation.x = 0.32
  g.add(flapOuter)

  // ── 어깨 + 자수 장식(오른쪽) ──
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 4, 8), coat)
  shoulders.rotation.z = Math.PI / 2
  shoulders.position.y = 1.95
  g.add(shoulders)
  const epaulet = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), gold)
  epaulet.position.set(0.3, 2.0, 0.18)
  epaulet.rotation.x = -0.6
  g.add(epaulet)

  // ── 팔 (코트 소매) ──
  // 왼팔: 권총을 든 채 앞으로 올림
  const leftUpper = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.42, 4, 6), coat)
  leftUpper.position.set(-0.42, 1.72, 0.12)
  leftUpper.rotation.set(-0.5, 0, 0.25)
  g.add(leftUpper)
  const leftFore = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 4, 6), coat)
  leftFore.position.set(-0.5, 1.55, 0.42)
  leftFore.rotation.set(-1.1, 0, 0.2)
  g.add(leftFore)
  // 오른팔: 카타나를 어깨에 걸침
  const rightUpper = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.45, 4, 6), coat)
  rightUpper.position.set(0.44, 1.68, 0.06)
  rightUpper.rotation.set(-0.4, 0, -0.35)
  g.add(rightUpper)
  const rightFore = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 4, 6), coat)
  rightFore.position.set(0.5, 1.62, 0.34)
  rightFore.rotation.set(-0.9, 0, -0.2)
  g.add(rightFore)
  // 손
  const lHand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), skin)
  lHand.position.set(-0.52, 1.42, 0.6)
  g.add(lHand)
  const rHand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), skin)
  rHand.position.set(0.52, 1.55, 0.52)
  g.add(rHand)

  // ── 목 + 흰 스카프 ──
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.14, 8), skin)
  neck.position.y = 2.06
  g.add(neck)
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.07, 8, 16), shirt)
  scarf.position.set(0, 2.02, 0.02)
  scarf.rotation.x = Math.PI / 2
  g.add(scarf)
  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.04), shirt)
  scarfTail.position.set(0.1, 1.82, 0.26)
  scarfTail.rotation.z = 0.3
  g.add(scarfTail)

  // ── 머리 ──
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 14), skin)
  head.position.y = 2.32
  head.scale.set(0.92, 1.06, 0.96)
  g.add(head)
  // 은발: 뒤로 넘긴 스타일(정수리 + 옆 + 뒤통수 볼륨)
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), hair)
  hairTop.position.set(0, 2.38, -0.02)
  hairTop.scale.set(1, 1, 1.08)
  g.add(hairTop)
  // 뒤로 넘긴 머릿결 가닥
  for (let i = 0; i < 6; i++) {
    const strand = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 5), hair)
    const a = (i / 5 - 0.5) * 1.6
    strand.position.set(Math.sin(a) * 0.2, 2.42, -0.18 - Math.cos(a) * 0.05)
    strand.rotation.x = 1.9
    strand.rotation.z = a * 0.3
    g.add(strand)
  }
  // 앞머리 살짝
  const bang = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 6), hair)
  bang.position.set(-0.08, 2.5, 0.16)
  bang.rotation.x = 2.6
  g.add(bang)

  // ── 안경 (실버 프레임) ──
  const eyeMat = mat(0x2a2a30, { metalness: 0.5 })
  for (const sx of [-0.09, 0.09]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 14), metal)
    rim.position.set(sx, 2.3, 0.22)
    g.add(rim)
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), eyeMat)
    lens.position.set(sx, 2.3, 0.215)
    g.add(lens)
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), metal)
  bridge.position.set(0, 2.3, 0.24)
  g.add(bridge)

  // ===== 무기 =====
  // ── M1911 권총 (왼손, 정면 조준) ──
  const pistol = new THREE.Group()
  // 프레임(하부)
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.34), metal)
  frame.position.set(0, -0.02, 0.06)
  pistol.add(frame)
  // 슬라이드(상부, 발사 시 뒤로 반동) — 이름 지정
  const slideGrp = new THREE.Group()
  const slideBody = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.4), mat(0x3a3a42, { metalness: 0.85, roughness: 0.28 }))
  slideBody.position.z = 0.08
  slideGrp.add(slideBody)
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), metal)
  muzzle.rotation.x = Math.PI / 2
  muzzle.position.set(0, 0.0, 0.29)
  slideGrp.add(muzzle)
  slideGrp.position.set(0, 0.04, 0)
  slideGrp.name = 'pistolSlide'
  pistol.add(slideGrp)
  // 그립(45도 뒤로)
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.24, 0.11), mat(0x5a3a24, { roughness: 0.7 }))
  grip.position.set(0, -0.16, -0.08)
  grip.rotation.x = 0.28
  pistol.add(grip)
  // 방아쇠울
  const guardR = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10, Math.PI), metal)
  guardR.position.set(0, -0.08, -0.01)
  guardR.rotation.x = Math.PI / 2
  pistol.add(guardR)
  pistol.position.set(-0.52, 1.42, 0.62)
  g.add(pistol)

  // ── 오른 허리 홀스터 ──
  const holster = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.14), mat(0x4a3018, { roughness: 0.7 }))
  holster.position.set(0.3, 0.98, 0.06)
  holster.rotation.z = 0.15
  g.add(holster)

  // ── 카타나 (오른손, 어깨에 걸침 — 붉은 도신 + 노란 술) ──
  const katana = new THREE.Group()
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.03, 2.1), mat(COLORS.katana, { metalness: 0.55, roughness: 0.28 }))
  blade.position.z = 1.15
  katana.add(blade)
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.036, 2.1), mat(COLORS.katanaEdge, { metalness: 0.4 }))
  edge.position.set(0.028, 0, 1.15)
  katana.add(edge)
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 4), mat(COLORS.katana, { metalness: 0.55 }))
  tip.rotation.x = Math.PI / 2
  tip.position.z = 2.28
  katana.add(tip)
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 8), gold)
  guard.rotation.x = Math.PI / 2
  guard.position.z = 0.1
  katana.add(guard)
  const hiltMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), mat(0x171717))
  hiltMesh.rotation.x = Math.PI / 2
  hiltMesh.position.z = -0.1
  katana.add(hiltMesh)
  // 손잡이 노란 술(tassel)
  for (let i = 0; i < 3; i++) {
    const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.28, 5), mat(0xe8c454, { roughness: 0.6 }))
    tassel.position.set((i - 1) * 0.03, -0.15, -0.3)
    tassel.rotation.x = 0.2
    katana.add(tassel)
  }
  katana.position.set(0.52, 1.62, 0.1)
  katana.rotation.set(-0.5, 0.2, 0)
  katana.name = 'katana'
  g.add(katana)

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
