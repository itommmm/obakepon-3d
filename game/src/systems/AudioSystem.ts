import * as THREE from 'three';

/**
 * Web Audio だけで作る手続き的なホラー音響。
 * 外部音源ファイルは使わない(ElevenLabs のキーがあれば後で差し替え可能)。
 */
export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private heartGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private nextBeat = 0;
  private nextToy = 0;
  private heartIntensity = 0;
  private muted = false;
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  async unlock(): Promise<void> {
    if (this.context) {
      if (this.context.state !== 'running') await this.context.resume();
      return;
    }
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    this.context = context;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 6;
    compressor.connect(context.destination);
    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(compressor);
    this.noiseBuffer = this.createNoise(context, 2);
    this.heartGain = context.createGain();
    this.heartGain.gain.value = 0;
    this.heartGain.connect(this.master);
    this.startAmbience(context);
    await context.resume();
    this.nextToy = context.currentTime + 18;
  }

  get ready(): boolean {
    return !!this.context && this.context.state === 'running';
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.context.currentTime, 0.05);
  }

  isMuted(): boolean {
    return this.muted;
  }

  suspend(): void {
    void this.context?.suspend();
  }

  resume(): void {
    void this.context?.resume();
  }

  updateListener(camera: THREE.Camera): void {
    if (!this.ready || !this.context) return;
    const listener = this.context.listener;
    camera.getWorldDirection(this.forward);
    this.up.set(0, 1, 0);
    const t = this.context.currentTime;
    if (listener.positionX) {
      listener.positionX.setValueAtTime(camera.position.x, t);
      listener.positionY.setValueAtTime(camera.position.y, t);
      listener.positionZ.setValueAtTime(camera.position.z, t);
      listener.forwardX.setValueAtTime(this.forward.x, t);
      listener.forwardY.setValueAtTime(this.forward.y, t);
      listener.forwardZ.setValueAtTime(this.forward.z, t);
      listener.upX.setValueAtTime(0, t);
      listener.upY.setValueAtTime(1, t);
      listener.upZ.setValueAtTime(0, t);
    } else {
      listener.setPosition(camera.position.x, camera.position.y, camera.position.z);
      listener.setOrientation(this.forward.x, this.forward.y, this.forward.z, 0, 1, 0);
    }
  }

  /** 毎フレーム呼ぶ: 心拍と、遠くのチャイムや噛みつき音 */
  tick(danger: number, randomValue: () => number, playerPosition: THREE.Vector3): void {
    if (!this.ready || !this.context || !this.heartGain) return;
    const now = this.context.currentTime;
    this.heartIntensity = THREE.MathUtils.lerp(this.heartIntensity, danger, 0.05);
    this.heartGain.gain.setTargetAtTime(0.15 + this.heartIntensity * 0.85, now, 0.2);
    if (this.heartIntensity > 0.08 && now >= this.nextBeat) {
      const bpm = 62 + this.heartIntensity * 95;
      this.beat(now);
      this.nextBeat = now + 60 / bpm;
    }
    if (now >= this.nextToy) {
      this.nextToy = now + 22 + randomValue() * 25;
      const angle = randomValue() * Math.PI * 2;
      const position = new THREE.Vector3(
        playerPosition.x + Math.cos(angle) * 18,
        2,
        playerPosition.z + Math.sin(angle) * 18,
      );
      if (randomValue() < 0.5) this.chime(position, true);
      else this.distantChomps(position);
    }
  }

  monsterFootstep(position: THREE.Vector3, loudness: number): void {
    const ctx = this.context;
    if (!this.ready || !ctx) return;
    const now = ctx.currentTime;
    const panner = this.panner(position, 6, 60);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.25);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.9 * loudness, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    osc.connect(gain).connect(panner);
    osc.start(now);
    osc.stop(now + 0.45);
    // 布が擦れる音
    this.noiseBurst(panner, now, 0.28, 900, 0.12 * loudness, 'bandpass');
  }

  playerStep(sprinting: boolean): void {
    const ctx = this.context;
    if (!this.ready || !ctx || !this.master) return;
    this.noiseBurst(this.master, ctx.currentTime, sprinting ? 0.09 : 0.07, sprinting ? 1400 : 900, sprinting ? 0.09 : 0.04, 'lowpass');
  }

  flashlightClick(): void {
    const ctx = this.context;
    if (!this.ready || !ctx || !this.master) return;
    this.noiseBurst(this.master, ctx.currentTime, 0.03, 4000, 0.2, 'highpass');
  }

  pickup(): void {
    const ctx = this.context;
    if (!this.ready || !ctx || !this.master) return;
    const now = ctx.currentTime;
    [523, 784].forEach((freq, i) => this.tone(freq, now + i * 0.09, 0.4, 0.08, 'triangle'));
  }

  insertFuse(count: number): void {
    const ctx = this.context;
    if (!this.ready || !ctx || !this.master) return;
    const now = ctx.currentTime;
    this.noiseBurst(this.master, now, 0.12, 600, 0.5, 'lowpass');
    this.tone(55, now, 0.5, 0.3, 'square');
    this.tone(110 + count * 40, now + 0.1, 1.2, 0.05, 'sawtooth');
  }

  powerOn(): void {
    const ctx = this.context;
    if (!this.ready || !ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(40, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 2.2);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 2.7);
    // 遠くで鳴る警報
    for (let i = 0; i < 4; i += 1) this.tone(880, now + 2.4 + i * 0.6, 0.35, 0.05, 'square');
  }

  /** 見つかった瞬間: 不協和なオルゴールの下降 */
  noticeSting(): void {
    const ctx = this.context;
    if (!this.ready || !ctx || !this.master) return;
    const now = ctx.currentTime;
    [1318, 1244, 1046, 932, 698].forEach((freq, i) => this.tone(freq, now + i * 0.07, 0.6, 0.07, 'triangle'));
    this.tone(46, now, 1.6, 0.35, 'sawtooth');
  }

  lostSigh(): void {
    const ctx = this.context;
    if (!this.ready || !ctx || !this.master) return;
    this.tone(330, ctx.currentTime, 1.4, 0.04, 'sine', 220);
  }

  /** ジャンプスケアの叫び声 */
  scream(): void {
    const ctx = this.context;
    if (!this.ready || !ctx || !this.master) return;
    const now = ctx.currentTime;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i += 1) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(x * 6);
    }
    shaper.curve = curve;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.7, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    shaper.connect(gain).connect(this.master);
    for (const [start, end] of [
      [920, 260],
      [1240, 380],
      [610, 140],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(start, now);
      osc.frequency.exponentialRampToValueAtTime(end, now + 1.4);
      const vib = ctx.createOscillator();
      const vibGain = ctx.createGain();
      vib.frequency.value = 17;
      vibGain.gain.value = 40;
      vib.connect(vibGain).connect(osc.frequency);
      osc.connect(shaper);
      osc.start(now);
      osc.stop(now + 1.5);
      vib.start(now);
      vib.stop(now + 1.5);
    }
    this.noiseBurst(this.master, now, 1.2, 2500, 0.4, 'bandpass');
  }

  doorOpen(position: THREE.Vector3): void {
    const ctx = this.context;
    if (!this.ready || !ctx) return;
    const panner = this.panner(position, 4, 80);
    this.noiseBurst(panner, ctx.currentTime, 2.4, 300, 0.8, 'lowpass');
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }

  // ---------- 内部 ----------

  private startAmbience(context: AudioContext): void {
    if (!this.master || !this.noiseBuffer) return;
    this.ambience = context.createGain();
    this.ambience.gain.value = 0.32;
    this.ambience.connect(this.master);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    filter.connect(this.ambience);
    for (const freq of [43.6, 44.1, 65.4]) {
      const osc = context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const gain = context.createGain();
      gain.gain.value = 0.08;
      osc.connect(gain).connect(filter);
      osc.start();
    }
    // 空調のような低いノイズ
    const noise = context.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 420;
    noiseFilter.Q.value = 0.6;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.05;
    noise.connect(noiseFilter).connect(noiseGain).connect(this.ambience);
    noise.start();
    // ゆっくり揺れるうなり
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
  }

  private beat(now: number): void {
    const ctx = this.context;
    if (!ctx || !this.heartGain) return;
    for (const [offset, level] of [
      [0, 1],
      [0.16, 0.7],
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(58, now + offset);
      osc.frequency.exponentialRampToValueAtTime(38, now + offset + 0.12);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.7 * level, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
      osc.connect(gain).connect(this.heartGain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.22);
    }
  }

  /**
   * 学校のチャイム(キーンコーンカーンコーン)。distant = true なら遠くで、遅く、音程が狂って鳴る。
   */
  chime(position: THREE.Vector3 | null, distant = false): void {
    const ctx = this.context;
    if (!this.ready || !ctx || !this.master) return;
    const destination = position ? this.panner(position, 8, 80) : this.master;
    const notes = distant ? [659, 523, 587, 392] : [659, 523, 587, 392, 392, 587, 659, 523];
    const step = distant ? 1.05 : 0.75;
    const now = ctx.currentTime;
    notes.forEach((freq, i) => {
      const detune = distant ? 1 - i * 0.012 : 1;
      const t = now + i * step;
      for (const [harmonic, level] of [
        [1, 0.16],
        [2.76, 0.05],
        [5.4, 0.02],
      ]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * harmonic * detune, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level * (distant ? 0.8 : 0.5), t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + step * 2.2);
        osc.connect(gain).connect(destination);
        osc.start(t);
        osc.stop(t + step * 2.3);
      }
    });
  }

  /** 噛み鳴らす音「ガブッ」: 低い打撃 + 歯がぶつかる硬い音 */
  chomp(position: THREE.Vector3, level = 1): void {
    const ctx = this.context;
    if (!this.ready || !ctx) return;
    const panner = this.panner(position, 5, 60);
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.7 * level, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(panner);
    osc.start(now);
    osc.stop(now + 0.2);
    this.noiseBurst(panner, now, 0.06, 3200, 0.5 * level, 'bandpass');
  }

  /** チョーク・ワニーニの鳴き声: 黒板をひっかくような高い軋み */
  chalkScreech(position: THREE.Vector3): void {
    const ctx = this.context;
    if (!this.ready || !ctx) return;
    const panner = this.panner(position, 6, 70);
    const now = ctx.currentTime;
    for (const [base, detune] of [
      [2900, 1],
      [3350, 1.013],
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const wobble = ctx.createOscillator();
      const wobbleGain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base * detune, now);
      osc.frequency.linearRampToValueAtTime(base * 1.25 * detune, now + 0.9);
      wobble.frequency.value = 23;
      wobbleGain.gain.value = 180;
      wobble.connect(wobbleGain).connect(osc.frequency);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.04);
      gain.gain.setValueAtTime(0.09, now + 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
      osc.connect(gain).connect(panner);
      osc.start(now);
      osc.stop(now + 1.15);
      wobble.start(now);
      wobble.stop(now + 1.15);
    }
    this.noiseBurst(panner, now, 1.0, 5200, 0.12, 'highpass');
  }

  /** ドラゴンチーノの咆哮: 低いうなり + 息 */
  dragonRoar(position: THREE.Vector3): void {
    const ctx = this.context;
    if (!this.ready || !ctx) return;
    const panner = this.panner(position, 6, 80);
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.linearRampToValueAtTime(120, now + 0.4);
    osc.frequency.exponentialRampToValueAtTime(45, now + 1.6);
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    osc.connect(filter).connect(gain).connect(panner);
    osc.start(now);
    osc.stop(now + 1.9);
    this.noiseBurst(panner, now + 0.1, 1.5, 700, 0.5, 'bandpass');
  }

  /** ドラゴンチーノのいびき(近づくと聞こえる予告) */
  snore(position: THREE.Vector3): void {
    const ctx = this.context;
    if (!this.ready || !ctx) return;
    const panner = this.panner(position, 3, 25);
    const now = ctx.currentTime;
    this.noiseBurst(panner, now, 1.1, 260, 0.35, 'lowpass');
    this.tone(55, now, 1.0, 0.04, 'sawtooth');
  }

  /** ペンギーノが向きを変えたときの「キュッ」(紙パックが擦れる音 + 小さな鳴き声) */
  squeak(position: THREE.Vector3): void {
    const ctx = this.context;
    if (!this.ready || !ctx) return;
    const panner = this.panner(position, 3, 30);
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1300, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(gain).connect(panner);
    osc.start(now);
    osc.stop(now + 0.22);
    this.noiseBurst(panner, now, 0.12, 2400, 0.25, 'bandpass');
  }

  private distantChomps(position: THREE.Vector3): void {
    const ctx = this.context;
    if (!ctx) return;
    // 遠くで「ガブ…ガブ…ガブーノ…」
    [0, 0.45, 1.3].forEach((offset) => {
      window.setTimeout(() => this.chomp(position, 0.5), offset * 1000);
    });
  }

  private panner(position: THREE.Vector3, refDistance: number, maxDistance: number): PannerNode {
    const ctx = this.context!;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = maxDistance;
    panner.rolloffFactor = 1.2;
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }
    panner.connect(this.master!);
    return panner;
  }

  private tone(
    freq: number,
    start: number,
    duration: number,
    level: number,
    type: OscillatorType,
    endFreq?: number,
  ): void {
    const ctx = this.context!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private noiseBurst(
    destination: AudioNode,
    start: number,
    duration: number,
    frequency: number,
    level: number,
    type: BiquadFilterType,
  ): void {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(start, Math.random() * 1.5, duration + 0.05);
  }

  private createNoise(context: AudioContext, seconds: number): AudioBuffer {
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < data.length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return buffer;
  }
}
