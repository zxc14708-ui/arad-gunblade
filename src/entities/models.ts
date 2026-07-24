import * as THREE from 'three'
import { COLORS } from '../config'

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...opts })
}

/**
 * 총검사(Gunblade) 캐릭터 모델.
 * 참조 이미지: 흰 롱코트 + 은발 + 안경 + 녹색 조끼 + 리볼버 + 붉은 카타나.
 * 프리미티브 조합으로 스타일라이즈드하게 표현.
 * 반환 그룹은 +Z를 정면으로 향한다.
 */
export function buildGunblade(): THREE.Group {
  const g = new THREE.Group()

  const skin = mat(COLORS.skin, { roughness: 0.6 })
  const coat = mat(COLORS.coat, { roughness: 0.85 })
  const coatDark = mat(COLORS.coatShadow, { roughness: 0.9 })
  const vest = mat(COLORS.vest)
  const pants = mat(COLORS.pants)
  const boots = mat(COLORS.boots)
  const hair = mat(COLORS.hair, { roughness: 0.55 })
  const metal = mat(COLORS.gunMetal, { metalness: 0.8, roughness: 0.35 })

  // 다리
  for (const sx of [-0.22, 0.22]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.95, 8), pants)
    leg.position.set(sx, 0.5, 0)
    g.add(leg)
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.44), boots)
    boot.position.set(sx, 0.11, 0.06)
    g.add(boot)
  }

  // 몸통 (녹색 조끼)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.95, 10), vest)
  torso.position.y = 1.42
  g.add(torso)

  // 흰 롱코트 (몸통 위 + 뒤로 흐르는 자락)
  const coatBody = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.38, 1.0, 12, 1, true), coat)
  coatBody.position.y = 1.42
  g.add(coatBody)

  const coatSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.72, 1.15, 12, 1, true), coat)
  coatSkirt.position.set(0, 0.82, -0.12)
  coatSkirt.rotation.x = -0.12
  g.add(coatSkirt)

  // 뒤로 나부끼는 코트 자락
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.05), coatDark)
  flap.position.set(0, 0.75, -0.5)
  flap.rotation.x = 0.35
  g.add(flap)

  // 어깨
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 8), coat)
  shoulders.rotation.z = Math.PI / 2
  shoulders.position.y = 1.85
  g.add(shoulders)

  // 팔
  const armMatL = coat
  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.6, 4, 6), armMatL)
  leftArm.position.set(-0.5, 1.55, 0.1)
  leftArm.rotation.z = 0.35
  g.add(leftArm)

  const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.6, 4, 6), armMatL)
  rightArm.position.set(0.42, 1.5, 0.28)
  rightArm.rotation.x = -0.7
  g.add(rightArm)

  // 목 + 머리
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 8), skin)
  neck.position.y = 1.98
  g.add(neck)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 14), skin)
  head.position.y = 2.22
  head.scale.set(0.92, 1.05, 0.95)
  g.add(head)

  // 은발 (헤어)
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.29, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair)
  hairTop.position.y = 2.28
  g.add(hairTop)
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), hair)
    const a = (i / 5) * Math.PI * 2
    spike.position.set(Math.cos(a) * 0.16, 2.42, Math.sin(a) * 0.16 + 0.02)
    spike.rotation.x = -0.3
    g.add(spike)
  }

  // 안경 (실버 프레임)
  const glasses = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.015, 6, 12), metal)
  glasses.position.set(-0.09, 2.22, 0.22)
  g.add(glasses)
  const glasses2 = glasses.clone()
  glasses2.position.x = 0.09
  g.add(glasses2)

  // 스카프 (목/가슴)
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 6, 14), coat)
  scarf.position.set(0, 1.92, 0.02)
  scarf.rotation.x = Math.PI / 2
  g.add(scarf)

  // ===== 무기 =====
  // 리볼버 (왼손, 정면을 겨눔)
  const gun = new THREE.Group()
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.4), metal)
  barrel.position.z = 0.2
  gun.add(barrel)
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.1), metal)
  grip.position.set(0, -0.12, -0.02)
  grip.rotation.x = 0.3
  gun.add(grip)
  gun.position.set(-0.55, 1.55, 0.4)
  g.add(gun)

  // 카타나 (오른손, 어깨에 걸침 — 붉은 도신)
  const katana = new THREE.Group()
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 2.0), mat(COLORS.katana, { metalness: 0.5, roughness: 0.3 }))
  blade.position.z = 1.1
  katana.add(blade)
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 2.0), mat(COLORS.katanaEdge, { metalness: 0.3 }))
  edge.position.set(0.03, 0, 1.1)
  katana.add(edge)
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 8), metal)
  guard.rotation.x = Math.PI / 2
  guard.position.z = 0.1
  katana.add(guard)
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.32, 8), mat(0x1a1a1a))
  hilt.rotation.x = Math.PI / 2
  hilt.position.z = -0.1
  katana.add(hilt)
  katana.position.set(0.5, 1.7, 0.1)
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
