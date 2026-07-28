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

  // 골드 소비처 (DESIGN_LOG B5 2·3단계 — 잉여 골드 흡수용)
  economy: {
    // 던전 제련소: 보유 특성을 같은 등급의 다른 특성으로 교체. 사용할 때마다 가격이
    // 오른다(런 단위 유지) — 가격 = 이전 가격 * ratio, 반올림은 매 단계 누적 적용.
    dungeonForgeBasePrice: 100,
    dungeonForgePriceRatio: 1.7,
    // 던전 분수: 런 전체 첫 사용은 무료, 두 번째 사용부터 유료(방당 1회 제한은 별도).
    fountainBasePrice: 60,
    fountainPriceRatio: 1.6,
    // 분수가 배치되는 방의 총 개수(상점방 1개 포함) — RunState.generateMap()이
    // 맵 생성 시점에 이 개수를 보장한다. 확률 배치로 두면 런마다 0개가 나올 수
    // 있어 개수 보장 방식으로 고정했다(DESIGN_LOG B5 "분수 사문화" 해결).
    fountainRoomCount: 3,
  },

  // 브라우저 프로필에 저장되는 영구 성장. 런 중 골드/특성과는 분리한다.
  meta: {
    altar: {
      damagePerRank: 0.04,
      maxHpPerRank: 10,
      rankCosts: [
        { kind: 'faint' as const, amount: 3 },
        { kind: 'faint' as const, amount: 6 },
        { kind: 'decent' as const, amount: 3 },
        { kind: 'decent' as const, amount: 6 },
        { kind: 'strong' as const, amount: 2 },
      ],
      reviveCost: { decent: 5, strong: 3 },
      wardCost: { decent: 3, strong: 2 },
    },
    rewards: {
      stageClear: { faint: 3, decent: 1, strong: 1, tokens: 2 },
      eliteToken: 1,
    },
    weaponPrice: { common: 0, rare: 3, epic: 7, legendary: 15 },
  },

  // 총검사 역할 분리 (DESIGN_LOG B4 — 멀면 총, 붙으면 검)
  combat: {
    // 총 거리 보너스: 발사 지점~명중 지점 거리가 이 이상이면 피해 배율 적용.
    // 검 사거리 최대(4.8)와 안 겹치도록 8로 고정 — 임의로 낮추지 말 것.
    gunRangeBonusDist: 8,
    gunRangeBonusMult: 1.35,
    // 검 스윙 커밋: 스윙 중 이동/방향전환/대시를 막는 시간. 검 쿨타임에 비례하되
    // 이 값을 넘지 않는다(전투 망치처럼 느린 검에서 조작감이 나빠지는 걸 방지).
    swordSwingCommitMax: 0.25,
  },

  // 타격감 연출 (히트스톱/화면 흔들림/피격 플래시)
  effects: {
    // 히트스톱: 타격 순간 게임 시간을 짧게 늦춘다. 0으로 완전히 멈추면 애니메이션이
    // 얼어붙어 버그처럼 보이므로 아주 느리게(0.05배)만 흐르게 한다.
    hitstopScale: 0.05,
    hitstopHit: 0.04,
    hitstopCrit: 0.07,
    hitstopKill: 0.1,
    hitstopBossKill: 0.35,

    // 화면 흔들림: 강도(카메라 오프셋 크기)와 지속(초, 지수 감쇠 — 시작이 강하고
    // 빠르게 잦아든다). shakeMax는 여러 흔들림이 겹칠 때의 합산 상한.
    shakeDuration: 0.3,
    shakeMax: 0.6,
    shakeSwordHit: 0.08,
    shakeGunHit: 0.03,
    shakeCrit: 0.15,
    shakeKill: 0.12,
    shakePlayerHit: 0.35,
    shakeBossSlam: 0.4,
    shakeBossCharge: 0.3,

    // 피격 플래시: 적 스프라이트 색상 배율(1=원색, 클수록 밝게 번쩍)과 지속(초).
    // 텍스처 교체 없이 SpriteMaterial.color만 곱해 구현 — 짧고 선명하게.
    flashDuration: 0.06,
    flashIntensity: 2.4,
    // 보스는 매 명중마다 번쩍이면 시야를 방해하므로 지속·강도를 낮춘다.
    flashBossDuration: 0.04,
    flashBossIntensityMul: 0.5,
  },
}

export type Difficulty = { hpMul: number; dmgMul: number; speedMul: number; countMul: number }
