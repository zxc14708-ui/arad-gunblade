import * as THREE from 'three'

/**
 * 게임 전역 픽셀 아트 렌더 계약.
 *
 * 이미지 파일과 절차 생성 캔버스가 같은 필터·색공간을 사용해야 상태 전환 때
 * 선명도와 색이 달라지지 않는다. 캐릭터·몬스터·프롭처럼 지면에 서는 스프라이트는
 * 하단 중앙을 원점으로 삼고, 보이는 크기는 월드 높이와 원본 종횡비로만 결정한다.
 */
export function configurePixelTexture<T extends THREE.Texture>(texture: T): T {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** 픽셀 보간이 없는 CanvasTexture를 만든다. */
export function makePixelCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  return configurePixelTexture(new THREE.CanvasTexture(canvas))
}

/** 발/밑면이 셀 아래에 맞춰진 월드 스프라이트를 만든다. */
export function makeBottomAnchoredSprite(material: THREE.SpriteMaterial): THREE.Sprite {
  const sprite = new THREE.Sprite(material)
  sprite.center.set(0.5, 0)
  return sprite
}

/** 원본 종횡비를 유지하면서 월드 높이를 지정한다. */
export function setSpriteWorldHeight(sprite: THREE.Sprite, height: number, aspect = 1): void {
  sprite.scale.set(height * aspect, height, 1)
}
