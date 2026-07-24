import * as THREE from 'three'

/**
 * 셀(툰) 셰이딩 공용 유틸.
 * 계단식 그라디언트 맵으로 만화풍 음영을 만든다. OutlineEffect(외곽선)와 함께 사용.
 */
const steps = new Uint8Array([70, 130, 190, 245]) // 4단계 명암
export const toonGradient = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
toonGradient.needsUpdate = true
toonGradient.minFilter = THREE.NearestFilter
toonGradient.magFilter = THREE.NearestFilter
toonGradient.generateMipmaps = false

/** MeshStandardMaterial 대체용 툰 머티리얼 (roughness/metalness는 무시) */
export function toonMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient,
    emissive: (opts.emissive as THREE.ColorRepresentation) ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent,
    opacity: opts.opacity,
    side: opts.side,
  })
}

/** OutlineEffect가 이 머티리얼에는 외곽선을 그리지 않도록 표시 */
export function noOutline<T extends THREE.Material>(m: T): T {
  m.userData.outlineParameters = { visible: false }
  return m
}
