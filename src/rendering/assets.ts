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

/**
 * 스프라이트 시트를 프레임별 텍스처 배열로 미리 잘라둔다.
 * (인스턴스마다 clone하지 않고 프레임 텍스처를 공유 → 이펙트 대량 생성에 유리)
 */
const frameCache = new Map<string, THREE.Texture[]>()
export function frameTextures(path: string, frames: number): THREE.Texture[] {
  const key = `${path}#${frames}`
  let arr = frameCache.get(key)
  if (!arr) {
    arr = Array.from({ length: frames }, (_, i) => {
      const t = cloneTex(path)
      t.repeat.set(1 / frames, 1)
      t.offset.set(i / frames, 0)
      return t
    })
    frameCache.set(key, arr)
  }
  return arr
}

/**
 * 모든 애셋을 미리 로드한다.
 * 시트 프레임 텍스처는 원본 이미지가 로드되기 전에 clone하면 빈(검은) 텍스처로
 * 업로드되므로, 실제 사용 전에 반드시 원본을 먼저 받아둬야 한다.
 */
export function preloadAssets(): Promise<void> {
  const paths: string[] = [
    ...Object.values(ASSET.tiles),
    ...Object.values(ASSET.props),
    ...Object.values(ASSET.fx).map((f) => f.path),
    ...Object.values(ASSET.monsters).flatMap((m) => Object.values(m)),
    ASSET.stage1.floor,
    ...Object.values(ASSET.stage1.foreground),
    ...Object.values(ASSET.stage1.effects),
    ...Object.values(ASSET.player),
  ]
  return Promise.all(
    paths.map(
      (p) =>
        new Promise<void>((resolve) => {
          const t = loadTex(p)
          const img = t.image as HTMLImageElement | undefined
          if (img && img.complete) return resolve()
          const done = () => resolve()
          // TextureLoader가 이미 로딩 중이면 이미지 이벤트로 대기
          if (img) {
            img.addEventListener('load', done, { once: true })
            img.addEventListener('error', done, { once: true })
          } else {
            loader.load(p, () => resolve(), undefined, () => resolve())
          }
        }),
    ),
  ).then(() => {
    // 로드 완료 후 프레임 텍스처를 미리 생성해 두면 첫 사용에서 검게 나오지 않는다
    for (const f of Object.values(ASSET.fx)) frameTextures(f.path, f.frames)
  })
}

export const ASSET = {
  /** 주인공 — 상태별 독립 시트, 전부 64x64 정사각 셀 (발끝 = 셀 하단) */
  player: {
    idle: 'assets/player/gunblade_idle_4f.png',
    walk: 'assets/player/gunblade_walk_6f.png',
    dash: 'assets/player/gunblade_dash_4f.png',
    slash: 'assets/player/gunblade_katana_4f.png',
    shoot: 'assets/player/gunblade_pistol_4f.png',
  },
  tiles: {
    dungeonFloor: 'assets/tiles/dungeon_floor_01.png',
    dungeonWall: 'assets/tiles/dungeon_wall_01.png',
    bossFloor: 'assets/tiles/boss_floor_01.png',
    villageGrass: 'assets/tiles/village_grass_01.png',
    villageWall: 'assets/tiles/village_wall_01.png',
  },
  props: {
    chestClosed: 'assets/stage1/stage1_interactive_objects/treasure_chest_closed.png',
    chestOpen: 'assets/stage1/stage1_interactive_objects/treasure_chest_open.png',
    fountain: 'assets/stage1/stage1_interactive_objects/healing_fountain.png',
    merchant: 'assets/props/merchant_stall.png',
    portal: 'assets/stage1/stage1_interactive_objects/dungeon_portal.png',
    door: 'assets/props/dungeon_door.png',
    torchStrip: 'assets/props/torch_strip.png',
    coinStrip: 'assets/props/coin_strip.png',
    xpCrystal: 'assets/props/xp_crystal.png',
  },
  fx: {
    slash: { path: 'assets/fx/slash_strip.png', frames: 6 },
    death: { path: 'assets/fx/death_dissolve_strip.png', frames: 6 },
    muzzle: { path: 'assets/fx/muzzle_flash_strip.png', frames: 3 },
    hit: { path: 'assets/stage1/stage1_combat_effects/goblin_hit_impact_4f.png', frames: 4 },
  },
  monsters: {
    imp: {
      idle: 'assets/stage1/stage1_goblins/melee_goblin_idle_4f.png',
      walk: 'assets/stage1/stage1_goblins/melee_goblin_walk_6f.png',
      attack: 'assets/stage1/stage1_goblins/melee_goblin_club_attack_4f.png',
    },
    brute: {
      idle: 'assets/stage1/stage1_tau/tau_warrior_idle_4f.png',
      walk: 'assets/stage1/stage1_tau/tau_warrior_walk_6f.png',
      attack: 'assets/stage1/stage1_tau/tau_warrior_slam_4f.png',
    },
    shooter: {
      idle: 'assets/stage1/stage1_goblins/fire_goblin_idle_4f.png',
      walk: 'assets/stage1/stage1_goblins/fire_goblin_walk_6f.png',
      attack: 'assets/stage1/stage1_goblins/fire_goblin_cast_4f.png',
    },
    boss: {
      idle: 'assets/stage1/stage1_tau/tau_chief_idle_4f.png',
      walk: 'assets/stage1/stage1_tau/tau_chief_move_6f.png',
      attack: 'assets/stage1/stage1_tau/tau_chief_slam_6f.png',
    },
  },
  stage1: {
    floor: 'assets/stage1/stage1_background/forest_floor_room.png',
    foreground: {
      treeA: 'assets/stage1/stage1_forest_foreground/great_tree_a.png',
      treeB: 'assets/stage1/stage1_forest_foreground/great_tree_b.png',
      bushA: 'assets/stage1/stage1_forest_foreground/dark_bush_a.png',
      bushB: 'assets/stage1/stage1_forest_foreground/dark_bush_b.png',
      stoneA: 'assets/stage1/stage1_forest_foreground/guardian_stone_a.png',
      stoneB: 'assets/stage1/stage1_forest_foreground/guardian_stone_b.png',
      vineTop: 'assets/stage1/stage1_forest_foreground/root_vine_top.png',
    },
    effects: {
      fireball: 'assets/stage1/stage1_combat_effects/fireball_4f.png',
      hit: 'assets/stage1/stage1_combat_effects/goblin_hit_impact_4f.png',
      tealMagic: 'assets/stage1/stage1_combat_effects/teal_magic_4f.png',
      warning: 'assets/stage1/stage1_combat_effects/boss_ground_warning_4f.png',
      shockwave: 'assets/stage1/stage1_combat_effects/tau_slam_shockwave_6f.png',
      campfire: 'assets/stage1/stage1_interactive_objects/campfire_3frames.png',
    },
  },
} as const
