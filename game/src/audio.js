// Saltline City — synthesised WebAudio sound. No audio files: every sound
// is an oscillator/noise recipe, so the game stays fully offline and tiny.
// The context is created lazily on the first user gesture (Start button).

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenFlip = 0;
    this.enabled = true;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.#startEngine();
      this.#startSiren();
    } catch {
      this.enabled = false;
    }
  }

  #noiseBuffer(seconds = 0.3) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  #startEngine() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 40;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 240;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
  }

  #startSiren() {
    const ctx = this.ctx;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start();
  }

  // Called every frame: engine pitch follows speed while driving, the
  // siren wails at a volume set by the nearest police car.
  update(dt, { driving = false, speedRatio = 0, sirenDistance = Infinity } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const rpm = 40 + Math.abs(speedRatio) * 130;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(240 + Math.abs(speedRatio) * 900, t, 0.08);
    this.engineGain.gain.setTargetAtTime(driving ? 0.05 + Math.abs(speedRatio) * 0.05 : 0, t, 0.1);

    if (sirenDistance < 90) {
      this.sirenFlip += dt;
      const tone = Math.floor(this.sirenFlip * 1.6) % 2 === 0 ? 660 : 880;
      this.sirenOsc.frequency.setTargetAtTime(tone, t, 0.03);
      const vol = Math.max(0, 0.055 * (1 - sirenDistance / 90));
      this.sirenGain.gain.setTargetAtTime(vol, t, 0.1);
    } else {
      this.sirenGain.gain.setTargetAtTime(0, t, 0.15);
    }
  }

  #blip(freqA, freqB, seconds, type = 'square', volume = 0.12) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqB), ctx.currentTime + seconds);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + seconds + 0.02);
  }

  #noise(seconds, volume, filterFreq) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.#noiseBuffer(seconds);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  horn() { this.#blip(370, 370, 0.3, 'square', 0.07); this.#blip(466, 466, 0.3, 'square', 0.05); }
  shot() { this.#noise(0.14, 0.28, 2600); this.#blip(220, 55, 0.1, 'square', 0.1); }
  rivalShot() { this.#noise(0.1, 0.1, 2000); }
  melee() { this.#noise(0.08, 0.2, 700); }
  hurt() { this.#blip(160, 70, 0.16, 'sawtooth', 0.12); }
  crash(strength = 1) { this.#noise(0.22, 0.16 * strength, 500); this.#blip(90, 40, 0.18, 'triangle', 0.14); }
  skid() { this.#noise(0.16, 0.05, 3200); }
  door() { this.#blip(140, 90, 0.07, 'square', 0.08); this.#noise(0.05, 0.06, 900); }
  pickup() { this.#blip(660, 990, 0.12, 'sine', 0.14); }
  cash() { this.#blip(880, 880, 0.07, 'square', 0.1); setTimeout(() => this.#blip(1320, 1320, 0.12, 'square', 0.1), 70); }
  phone() { this.#blip(1046, 1046, 0.09, 'sine', 0.1); setTimeout(() => this.#blip(1046, 1046, 0.09, 'sine', 0.1), 140); }
  success() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.#blip(f, f, 0.16, 'triangle', 0.12), i * 95)); }
  fail() { this.#blip(300, 90, 0.5, 'sawtooth', 0.12); }
  objective() { this.#blip(784, 1174, 0.14, 'sine', 0.11); }
}
