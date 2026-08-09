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

    // R 리듬 장전(작업 지시 P6 커밋3) — 장전 진행 중 R을 한 번 더 누르면
    // 성공 구간에서는 즉시 완료 + 다음 몇 발 피해 보너스, 구간 밖이면 약간의
    // 지연 페널티. 위치(windowCenterRatio)는 무기와 무관하게 고정 — 학습
    // 가능해야 한다. 폭(windowWidth*)만 무기별 reloadTime에 비례해 늘어난다
    // (장전이 긴 무기일수록 여유 있게). 발도장전(검격 적중 시 장전)은 이
    // 리듬 로직과 완전히 분리돼 있어 보너스를 받지 않는다 — Player.ts 참고.
    reloadRhythm: {
      windowCenterRatio: 0.7,
      windowWidthBase: 0.12,
      windowWidthPerSecond: 0.03,
      windowWidthMax: 0.3,
      successBonusMult: 0.3,
      successBonusShots: 3,
      failDelay: 0.25,
      flashDuration: 0.35,
    },
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
    contactCooldown: 0.6,
    stagePatterns: {
      // shooter는 스테이지1부터 쓰는 기본 원거리 종류라 다른 kind처럼 전용
      // 패턴 블록이 없었다 — 유지 거리(preferredRange)만 하드코딩돼 있던 것을
      // 여기로 옮겼다(작업 지시 P6 커밋1 — 수치는 config.ts에 둔다).
      shooter: { preferredRange: 12 },
      suicide: { triggerRange: 2.1, radius: 4.2, damageMultiplier: 1.6, fuse: 0.65 },
      frostSuicide: { triggerRange: 2.1, radius: 4.2, damageMultiplier: 1.35, fuse: 0.7, slowZoneDuration: 4, slowMultiplier: 0.55 },
      fireMage: { preferredRange: 11, cooldown: 3.2, warning: 0.85, radius: 3.2, damageMultiplier: 1.45 },
      iceMage: { preferredRange: 12, cooldown: 2.8, projectileSpeed: 9, homing: 2.6, slowDuration: 2.4 },
      summoner: { preferredRange: 13, cooldown: 6, maxSummons: 2 },
      voidMage: { preferredRange: 12, cooldown: 2.5, teleportCooldown: 5, projectileSpeed: 10, homing: 3.2 },
      charger: { triggerRange: 9, warning: 0.55, duration: 0.8, speedMultiplier: 3.1, damageMultiplier: 1.45 },
      bossSpecialChance: 0.38,
    },
    // 보스 브레이크(작업 지시 P7 커밋3) — 체력 75%/25%(각각 런당 1회)에서
    // 발동하는 기절 지속시간. 50%(2페이즈 진입)와 겹치지 않도록 임계를
    // 나눴다 — Enemy.updateBoss() 참고.
    bossBreak: { duration: 1.5 },
    // 상태이상(작업 지시 P8 커밋2) — 이 커밋은 시스템만 넣고 이 값을 실제로
    // 거는 각인은 아직 없다(디버그 훅으로만 검증). 수치는 향후 각인이
    // 들어올 때 조정될 수 있는 자리값이다.
    bleed: {
      duration: 4, // 스택 하나의 지속시간(초)
      tickInterval: 1, // 이 간격마다 스택 수만큼 곱한 피해가 들어간다
      tickDamage: 3, // 스택 1개, 틱 1회당 피해
    },
    shock: {
      duration: 3,
      damageTakenMult: 1.3, // 감전 중 받는 모든 피해 배율(중첩 없음, 경직 아님)
    },
  },

  spawn: {
    firstWaveDelay: 1.2,
    betweenWaves: 3.0,
    baseCount: 5,
    countPerWave: 2,
    // 방 하나에서 등장하는 적 수. 전투 템포를 높이되 방 크기에 맞춰 1.6배로 제한한다.
    roomDensity: 1.6,
  },

  // 골드 소비처 (DESIGN_LOG B5 2·3단계 — 잉여 골드 흡수용)
  economy: {
    // 바닥 골드 픽업이 플레이어에게 끌려오는 속도/범위(작업 지시 P7 커밋1 —
    // 경험치 체계 폐지로 픽업이 골드 하나만 남으면서 CONFIG.xp에서 옮겨왔다).
    goldPickupSpeed: 16,
    goldMagnetRange: 6,
    // 던전 제련소: 보유 특성을 같은 등급의 다른 특성으로 교체. 사용할 때마다 가격이
    // 오른다(런 단위 유지) — 가격 = 이전 가격 * ratio, 반올림은 매 단계 누적 적용.
    dungeonForgeBasePrice: 100,
    dungeonForgePriceRatio: 1.7,
    // 던전 분수: 런 전체 첫 사용은 무료, 두 번째 사용부터 유료(방당 1회 제한은 별도).
    // 분수가 배치되는 방(보스 준비방 고정 1개 + '회복' 분기 노드, 작업 지시
    // P7 커밋2)의 개수는 이제 맵 구조 자체가 보장한다 — 별도 설정값이 필요
    // 없다(예전 fountainRoomCount는 격자 맵 시절 확률 배치를 보정하던 값).
    fountainBasePrice: 60,
    fountainPriceRatio: 1.6,
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
    // stageClear 보상은 RunState.StageDef.reward로 옮겼다(스테이지별로 다르게
    // 두기 위함, 작업 지시 P2_prompt_stage_data_and_continuous_run_1 커밋1).
    rewards: {
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

  // 핵심 슬롯 특성(slash/shot/dash) 튜닝값 — 작업 지시 slot_system_phase1 커밋 3.
  // 조건부 발동 조건과 배율만 모아둔다. 어떤 특성이 어느 슬롯인지는 Upgrades.ts.
  traits: {
    // 발도참(slash): 이 시간 이상 정지해 있으면 다음 첫 베기가 강화된다.
    iaijutsuIdleThreshold: 0.5,
    iaijutsuDamageMult: 2.5,
    iaijutsuKnockbackMult: 2,
    // 밀착사격(shot): 총알 발사 지점에서 이 거리 이내에 명중하면 강화.
    // gunRangeBonusDist(먼 거리 보너스)와 정반대 축 — 서로 겹칠 수 없다.
    closeRangeDist: 3,
    closeRangeMult: 1.9,
    // 마지막 한발(gun, 구 최후탄): 탄창의 마지막 1발 — 피해 증폭 + 명중 시
    // 넉백 충격파(작업 지시 P8 커밋1, 개명과 함께 추가). 피해는 없이 순수 넉백.
    lastBulletMult: 2.2,
    lastBulletShockwaveRadius: 3.5,
    lastBulletShockwaveKnockback: 9,
    // 조준사격(shot): 이 시간 이상 사격을 쉰 뒤 첫 발은 확정 치명타.
    aimedShotPauseThreshold: 0.35,
    // 표식(dash): 대시로 관통한 적이 받는 피해 배율(지속시간, 초).
    markDuration: 3,
    markedDamageMult: 1.35,
    // 급전환(dash): 대시 종료 직후 지속시간 동안 검 쿨타임 배율 + 총 즉시 장전.
    quickSwitchDuration: 0.5,
    quickSwitchSwordCooldownMult: 0.5,

    // ── 중비용 슬롯 특성(slot_traits_midcost_v2) ──
    // 일섬(slash): 정확히 1명 명중 시 배율. 2명 이상은 1.0배(보정 없음 — 의도된 교환).
    ilseomMult: 2.0,
    // 이도류(slash): 2연타, 각 타 피해 배율(합계 120%) + 두 번째 타격까지의 지연(초).
    dualbladeHitMult: 0.6,
    dualbladeDelaySec: 0.12,
    // 이도류 두 번째 타격의 히트스톱/화면 흔들림 배율 — 같은 강도로 두 번 걸리면 끊겨 보인다.
    dualbladeSecondHitFxScale: 0.5,
    // 흘리기(slash): 부채꼴 판정 안 적 탄환 반사 — 반사탄 피해는 현재 검 피해의 배율.
    deflectDamageMult: 0.6,
    // 도탄(shot): 탄환 소멸 시 튕길 반경, 배율은 없음(원 데미지 그대로 재사용).
    ricochetRadius: 8,
    // 잔영(dash): 대시 무적으로 공격을 흘리면 대시 쿨타임을 즉시 초기화.
    // (수치 없음 — 즉시 0으로 리셋. 항목만 문서화 목적으로 남겨둔다.)
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
    // 재발동 최소 간격: 이 시간 안에 새 히트스톱 요청이 오면 무시한다(연속 명중이
    // 타이머를 계속 채워 끊기지 않는 것을 막는다). 누적 상한: 한 프레임에 여러
    // 적을 때려도(광역기 등) 히트스톱 지속시간이 이 값을 넘지 않는다.
    hitstopRetriggerInterval: 0.08,
    hitstopMaxDuration: 0.35,

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
