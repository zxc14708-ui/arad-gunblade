/**
 * Web Audio API 실시간 합성 사운드 시스템.
 * 오디오 파일 없이 오실레이터/노이즈로 효과음과 BGM을 생성한다.
 * (브라우저 자동재생 정책 때문에 init()/resume()은 사용자 클릭 이후 호출)
 */
export class AudioManager {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private musicGain!: GainNode
  private sfxGain!: GainNode
  private noiseBuf!: AudioBuffer

  muted = false
  private musicOn = false
  private schedulerId: number | null = null
  private nextStepTime = 0
  private step = 0
  private lastHit = 0

  // 음량 (0..1). 설정창 슬라이더와 연동, localStorage에 저장.
  private static readonly MUSIC_BASE = 0.38
  private static readonly SFX_BASE = 0.6
  masterVol = 0.85
  musicVol = 0.7
  sfxVol = 0.85

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem('arad_audio') || '{}')
      if (typeof s.master === 'number') this.masterVol = s.master
      if (typeof s.music === 'number') this.musicVol = s.music
      if (typeof s.sfx === 'number') this.sfxVol = s.sfx
    } catch {
      /* 무시 */
    }
  }

  private save() {
    try {
      localStorage.setItem('arad_audio', JSON.stringify({ master: this.masterVol, music: this.musicVol, sfx: this.sfxVol }))
    } catch {
      /* 무시 */
    }
  }

  // ── 초기화 (첫 사용자 제스처에서 호출) ──
  init() {
    if (this.ctx) return
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    this.ctx = new Ctx()

    this.master = this.ctx.createGain()
    this.master.gain.value = this.masterVol
    this.master.connect(this.ctx.destination)

    this.musicGain = this.ctx.createGain()
    this.musicGain.gain.value = this.musicVol * AudioManager.MUSIC_BASE
    this.musicGain.connect(this.master)

    this.sfxGain = this.ctx.createGain()
    this.sfxGain.gain.value = this.sfxVol * AudioManager.SFX_BASE
    this.sfxGain.connect(this.master)

    // 재사용 노이즈 버퍼 (1초 화이트노이즈)
    const len = this.ctx.sampleRate
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }

  resume() {
    this.ctx?.resume()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.ctx) this.master.gain.value = m ? 0 : this.masterVol
  }

  setMasterVolume(v: number) {
    this.masterVol = Math.max(0, Math.min(1, v))
    if (this.ctx && !this.muted) this.master.gain.value = this.masterVol
    this.save()
  }
  setMusicVolume(v: number) {
    this.musicVol = Math.max(0, Math.min(1, v))
    if (this.ctx) this.musicGain.gain.value = this.musicVol * AudioManager.MUSIC_BASE
    this.save()
  }
  setSfxVolume(v: number) {
    this.sfxVol = Math.max(0, Math.min(1, v))
    if (this.ctx) this.sfxGain.gain.value = this.sfxVol * AudioManager.SFX_BASE
    this.save()
  }

  private now() {
    return this.ctx ? this.ctx.currentTime : 0
  }

  // ── 기본 합성 헬퍼 ──
  private tone(
    freq: number,
    dur: number,
    opts: { type?: OscillatorType; gain?: number; to?: NodeGainOrDest; slideTo?: number; delay?: number; attack?: number } = {},
  ) {
    if (!this.ctx || this.muted) return
    const t = this.now() + (opts.delay ?? 0)
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.setValueAtTime(freq, t)
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t + dur)
    const peak = opts.gain ?? 0.4
    const atk = opts.attack ?? 0.005
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + atk)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g)
    g.connect(opts.to ?? this.sfxGain)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  private noise(
    dur: number,
    opts: { gain?: number; type?: BiquadFilterType; freq?: number; q?: number; to?: NodeGainOrDest; delay?: number; slideTo?: number } = {},
  ) {
    if (!this.ctx || this.muted) return
    const t = this.now() + (opts.delay ?? 0)
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const filt = this.ctx.createBiquadFilter()
    filt.type = opts.type ?? 'bandpass'
    filt.frequency.setValueAtTime(opts.freq ?? 1000, t)
    if (opts.slideTo) filt.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur)
    filt.Q.value = opts.q ?? 1
    const g = this.ctx.createGain()
    const peak = opts.gain ?? 0.4
    g.gain.setValueAtTime(peak, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filt)
    filt.connect(g)
    g.connect(opts.to ?? this.sfxGain)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  // ── 효과음 ──
  gunshot() {
    // M1911 .45 — 묵직한 발사음
    this.noise(0.11, { type: 'lowpass', freq: 2200, slideTo: 300, gain: 0.4, q: 1 })
    this.tone(180, 0.08, { type: 'square', gain: 0.16, slideTo: 60 })
    this.noise(0.03, { type: 'highpass', freq: 4000, gain: 0.18 }) // 총구 크랙
  }

  /** 재장전: 탄창 분리 → 삽입 → 슬라이드 (딸깍-철컥) */
  reload() {
    this.noise(0.04, { type: 'highpass', freq: 3000, gain: 0.18, delay: 0 }) // 탄창 분리 클릭
    this.noise(0.05, { type: 'bandpass', freq: 1200, gain: 0.2, delay: 0.35, q: 3 }) // 탄창 삽입
    this.tone(140, 0.05, { type: 'square', gain: 0.12, delay: 0.35 })
    this.noise(0.06, { type: 'highpass', freq: 2500, gain: 0.25, delay: 0.85 }) // 슬라이드 철컥
    this.tone(200, 0.04, { type: 'square', gain: 0.14, delay: 0.9, slideTo: 400 })
  }

  /** 탄창이 비어 방아쇠를 당겼을 때의 빈 클릭 */
  emptyClick() {
    const t = this.now()
    if (t - this.lastHit < 0.05) return
    this.noise(0.02, { type: 'highpass', freq: 5000, gain: 0.12 })
  }

  slash() {
    this.noise(0.22, { type: 'bandpass', freq: 900, slideTo: 3200, gain: 0.3, q: 1.2 })
    this.tone(600, 0.18, { type: 'triangle', gain: 0.1, slideTo: 1400 })
  }

  hit() {
    const t = this.now()
    if (t - this.lastHit < 0.035) return // 연타 스팸 방지
    this.lastHit = t
    this.tone(320, 0.06, { type: 'square', gain: 0.14, slideTo: 160 })
    this.noise(0.04, { type: 'highpass', freq: 2000, gain: 0.1 })
  }

  death() {
    this.noise(0.2, { type: 'lowpass', freq: 1200, slideTo: 200, gain: 0.28 })
    this.tone(180, 0.22, { type: 'sawtooth', gain: 0.18, slideTo: 50 })
  }

  bossDeath() {
    this.tone(120, 0.7, { type: 'sawtooth', gain: 0.3, slideTo: 30 })
    this.noise(0.6, { type: 'lowpass', freq: 800, slideTo: 100, gain: 0.3 })
    for (let i = 0; i < 4; i++) this.noise(0.15, { type: 'bandpass', freq: 600 + i * 400, gain: 0.2, delay: i * 0.12 })
  }

  hurt() {
    this.tone(160, 0.16, { type: 'sawtooth', gain: 0.22, slideTo: 70 })
    this.noise(0.08, { type: 'lowpass', freq: 900, gain: 0.15 })
  }

  dash() {
    this.noise(0.18, { type: 'bandpass', freq: 400, slideTo: 2600, gain: 0.22, q: 2 })
  }

  levelup() {
    const notes = [523, 659, 784, 1047] // C E G C 상승 아르페지오
    notes.forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', gain: 0.22, delay: i * 0.08 }))
  }

  pick() {
    this.tone(784, 0.12, { type: 'triangle', gain: 0.2 })
    this.tone(1175, 0.16, { type: 'triangle', gain: 0.18, delay: 0.09 })
  }

  bossWarn() {
    this.tone(70, 0.8, { type: 'sawtooth', gain: 0.3, slideTo: 55 })
    this.tone(140, 0.8, { type: 'square', gain: 0.12, delay: 0.05 })
    this.noise(0.9, { type: 'lowpass', freq: 300, gain: 0.2 })
  }

  waveStart() {
    this.tone(440, 0.12, { type: 'triangle', gain: 0.16 })
    this.tone(660, 0.16, { type: 'triangle', gain: 0.14, delay: 0.1 })
  }

  gameOver() {
    const notes = [440, 349, 262, 196]
    notes.forEach((f, i) => this.tone(f, 0.5, { type: 'sawtooth', gain: 0.24, delay: i * 0.22 }))
  }

  // ── BGM (스텝 시퀀서, 던전 배틀 루프) ──
  private readonly bpm = 128
  // 32스텝(2마디) 루프. midi 0 = 쉼표
  private bass = [38, 38, 34, 34, 41, 41, 36, 36] // 비트당 1음 (Dm-Bb-F-C)
  private lead = [
    74, 0, 77, 0, 81, 0, 77, 0, 76, 0, 74, 0, 69, 0, 72, 0, 74, 0, 77, 81, 84, 0, 81, 0, 77, 0, 74, 0, 72, 0, 69, 0,
  ]

  private mtof(m: number) {
    return 440 * Math.pow(2, (m - 69) / 12)
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return
    this.musicOn = true
    this.step = 0
    this.nextStepTime = this.now() + 0.1
    this.scheduler()
  }

  stopMusic() {
    this.musicOn = false
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId)
      this.schedulerId = null
    }
  }

  /** 룩어헤드 스케줄러 */
  private scheduler = () => {
    if (this.schedulerId !== null) clearInterval(this.schedulerId)
    this.schedulerId = window.setInterval(() => {
      if (!this.ctx || !this.musicOn) return
      const sixteenth = 60 / this.bpm / 4
      while (this.nextStepTime < this.now() + 0.12) {
        this.scheduleStep(this.step, this.nextStepTime)
        this.nextStepTime += sixteenth
        this.step = (this.step + 1) % 32
      }
    }, 25)
  }

  private scheduleStep(step: number, time: number) {
    if (this.muted || !this.ctx) return
    const mg = this.musicGain

    // 킥: 4스텝(비트)마다
    if (step % 4 === 0) this.kick(time)
    // 스네어: 3박(각 마디의 8, 24스텝)
    if (step === 8 || step === 24) this.snare(time)
    // 하이햇: 8분(짝수 스텝)
    if (step % 2 === 0) this.hat(time, step % 4 === 0 ? 0.06 : 0.09)

    // 베이스: 비트마다
    if (step % 4 === 0) {
      const b = this.bass[(step / 4) % this.bass.length]
      this.playMusicTone(this.mtof(b), 60 / this.bpm * 0.9, time, 'sawtooth', 0.5, mg, 500)
    }
    // 리드 아르페지오: 16분
    const ln = this.lead[step]
    if (ln > 0) this.playMusicTone(this.mtof(ln), 60 / this.bpm / 4 * 1.4, time, 'square', 0.16, mg, 2600)
  }

  private playMusicTone(freq: number, dur: number, time: number, type: OscillatorType, gain: number, dest: GainNode, cutoff: number) {
    if (!this.ctx) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    const filt = this.ctx.createBiquadFilter()
    filt.type = 'lowpass'
    filt.frequency.value = cutoff
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0.0001, time)
    g.gain.exponentialRampToValueAtTime(gain, time + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    osc.connect(filt)
    filt.connect(g)
    g.connect(dest)
    osc.start(time)
    osc.stop(time + dur + 0.02)
  }

  private kick(time: number) {
    if (!this.ctx) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.frequency.setValueAtTime(150, time)
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12)
    g.gain.setValueAtTime(0.9, time)
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16)
    osc.connect(g)
    g.connect(this.musicGain)
    osc.start(time)
    osc.stop(time + 0.18)
  }

  private snare(time: number) {
    if (!this.ctx) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const filt = this.ctx.createBiquadFilter()
    filt.type = 'highpass'
    filt.frequency.value = 1800
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.5, time)
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.13)
    src.connect(filt)
    filt.connect(g)
    g.connect(this.musicGain)
    src.start(time)
    src.stop(time + 0.15)
  }

  private hat(time: number, gain: number) {
    if (!this.ctx) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const filt = this.ctx.createBiquadFilter()
    filt.type = 'highpass'
    filt.frequency.value = 7000
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, time)
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.04)
    src.connect(filt)
    filt.connect(g)
    g.connect(this.musicGain)
    src.start(time)
    src.stop(time + 0.05)
  }
}

type NodeGainOrDest = AudioNode
