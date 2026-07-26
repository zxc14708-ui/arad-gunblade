/**
 * 게임 전역 밸런스 / 색상 설정
 * ARAD: Gunblade — 던전앤파이터 팬 게임 (총검사)
 */

export const COLORS = {
  // 던파 총검사(Gunblade) 컬러 스킴 — 참조 이미지 기반
  coat: 0xf3ede2, // 흰 롱코트
  coatShadow: 0xd8cfc0,
  hair: 0xc9b98f, // 은발/금발 톤
  skin: 0xd7a98a,
  vest: 0x4a5a3c, // 녹색 조끼
  pants: 0x2c241d, // 짙은 갈색 바지
  boots: 0x6b4a2f,
  katana: 0x9a4b3a, // 붉은 도신
  katanaEdge: 0xe8d9b0,
  gunMetal: 0x2b2b30,

  // 환경
  floor: 0x1b1e2b,
  floorGrid: 0x323a52,
  wall: 0x3a4157,
  wallTop: 0x525b78,
  fog: 0x0a0c14,
  ambient: 0x404a66,

  // 적
  imp: 0x8a3b52,
  impHorn: 0xf0d0a0,
  brute: 0x6d4a7a,
  shooter: 0x3a7a8a,
  boss: 0xb02a2a,

  // 이펙트
  bullet: 0xffe08a,
  enemyBullet: 0xff5a7a,
  slash: 0xfff0c0,
  hit: 0xffb0b0,
  xp: 0x6ad0ff,
}

export const CONFIG = {
  arenaRadius: 26,

  player: {
    speed: 9,
    radius: 0.7,
    maxHp: 100,
    dashSpeed: 26,
    dashDuration: 0.16,
    dashCooldown: 0.7,
    dashIFrames: 0.22,
    invulnAfterHit: 0.6,
  },

  gun: {
    damage: 12,
    cooldown: 0.15, // 발사 간격 (M1911 세미오토)
    bulletSpeed: 42,
    bulletLife: 1.1,
    spread: 0.03,
    pierce: 0,
    magSize: 7, // M1911 탄창 (7발)
    reloadTime: 1.15, // 장전 시간(초)
  },

  sword: {
    damage: 34,
    cooldown: 0.42,
    range: 3.6,
    arc: Math.PI * 0.7, // 부채꼴 각
    knockback: 9,
    lunge: 4.5, // 베기 시 전방 대시
  },

  enemy: {
    baseHp: 30,
    baseSpeed: 4.2,
    baseDamage: 10,
    baseXp: 4,
    contactCooldown: 0.6,
  },

  spawn: {
    firstWaveDelay: 1.2,
    betweenWaves: 3.0,
    baseCount: 5,
    countPerWave: 2,
    // 방 하나에서 등장하는 적 수. 전투 템포를 높이되 방 크기에 맞춰 1.6배로 제한한다.
    roomDensity: 1.6,
  },

  xp: {
    orbMagnetRange: 4.5,
    orbSpeed: 16,
    baseToLevel: 12,
    growth: 1.28, // 레벨당 필요 경험치 증가율
  },
}

export type Difficulty = { hpMul: number; dmgMul: number; speedMul: number; countMul: number }
