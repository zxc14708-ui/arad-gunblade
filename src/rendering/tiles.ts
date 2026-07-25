import * as THREE from 'three'
import { ASSET, loadTileTex } from './assets'

/**
 * 방 타일 텍스처 — 제공된 픽셀 애셋(32x32 seamless) 사용.
 * 타일링 반복은 Room에서 clone 후 repeat로 설정한다.
 */
export const dungeonFloorTex = (): THREE.Texture => loadTileTex(ASSET.tiles.dungeonFloor)
export const dungeonWallTex = (): THREE.Texture => loadTileTex(ASSET.tiles.dungeonWall)
export const bossFloorTex = (): THREE.Texture => loadTileTex(ASSET.tiles.bossFloor)
export const townFloorTex = (): THREE.Texture => loadTileTex(ASSET.tiles.villageGrass)
export const townWallTex = (): THREE.Texture => loadTileTex(ASSET.tiles.villageWall)
