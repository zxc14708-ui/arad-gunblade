import * as THREE from 'three'

/**
 * 픽셀 애셋 로더 (public/assets/...)
 * 니어리스트 필터 + sRGB. 같은 경로는 캐시해서 GPU 소스를 공유한다.
 */
const cache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader()

export function loadTex(path: string): THREE.Texture {
  let t = cache.get(path)
  if (!t) {
    t = loader.load(path)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.colorSpace = THREE.SRGBColorSpace
    cache.set(path, t)
  }
  return t
}

/** 타일용: 반복(래핑) 텍스처 */
export function loadTileTex(path: string): THREE.Texture {
  const t = loadTex(path)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/**
 * 스프라이트 시트용 클론 — offset/repeat를 개체별로 조작해야 하므로
 * 원본은 캐시에 두고 인스턴스마다 clone()을 쓴다(이미지 소스는 공유).
 */
export function cloneTex(path: string): THREE.Texture {
  const c = loadTex(path).clone()
  c.needsUpdate = true
  return c
}

export const ASSET = {
  tiles: {
    dungeonFloor: 'assets/tiles/dungeon_floor_01.png',
    dungeonWall: 'assets/tiles/dungeon_wall_01.png',
    bossFloor: 'assets/tiles/boss_floor_01.png',
    villageGrass: 'assets/tiles/village_grass_01.png',
    villageWall: 'assets/tiles/village_wall_01.png',
  },
  props: {
    chestClosed: 'assets/props/chest_closed.png',
    chestOpen: 'assets/props/chest_open.png',
    fountain: 'assets/props/healing_fountain.png',
    merchant: 'assets/props/merchant_stall.png',
    portal: 'assets/props/dungeon_portal.png',
    door: 'assets/props/dungeon_door.png',
    torchStrip: 'assets/props/torch_strip.png',
    coinStrip: 'assets/props/coin_strip.png',
    xpCrystal: 'assets/props/xp_crystal.png',
  },
  monsters: {
    imp: {
      idle: 'assets/monsters/imp_idle.png',
      walk: 'assets/monsters/imp_walk.png',
      attack: 'assets/monsters/imp_attack.png',
    },
    brute: {
      idle: 'assets/monsters/brute_idle.png',
      walk: 'assets/monsters/brute_walk.png',
      attack: 'assets/monsters/brute_attack.png',
    },
    shooter: {
      idle: 'assets/monsters/shooter_idle.png',
      walk: 'assets/monsters/shooter_walk.png',
      attack: 'assets/monsters/shooter_cast.png',
    },
    boss: {
      idle: 'assets/monsters/stage1_boss_idle.png',
      walk: 'assets/monsters/stage1_boss_move.png',
      attack: 'assets/monsters/stage1_boss_attack.png',
    },
  },
} as const
