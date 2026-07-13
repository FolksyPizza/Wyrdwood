import { settings, onSettingsChange } from '../data/settings';

/**
 * Procedural WebAudio SFX + ambience — no audio files needed.
 * All sounds are synthesized (noise bursts, filtered oscillators).
 * Routing: sources → (effects | ambience | music) bus → master → output.
 * Each bus gain tracks the user's volume sliders. Context resumes on first
 * user gesture (browser autoplay policy).
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private stepTimer = 0;

  constructor() {
    const resume = (): void => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.effectsBus = this.ctx.createGain();
        this.ambientBus = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.effectsBus.connect(this.master);
        this.ambientBus.connect(this.master);
        this.musicBus.connect(this.master);
        this.applyVolumes();
        onSettingsChange(() => this.applyVolumes());
        this.startAmbience();
      }
      void this.ctx.resume();
    };
    window.addEventListener('pointerdown', resume, { once: false });
    window.addEventListener('keydown', resume, { once: false });
  }

  /** Push the current volume sliders onto the gain buses. */
  private applyVolumes(): void {
    if (!this.master) return;
    this.master.gain.value = settings.volumeMaster;
    if (this.effectsBus) this.effectsBus.gain.value = settings.volumeEffects;
    if (this.ambientBus) this.ambientBus.gain.value = settings.volumeAmbience;
    if (this.musicBus) this.musicBus.gain.value = settings.volumeMusic;
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Short filtered-noise burst — the workhorse for impact sounds. */
  private burst(
    freq: number,
    seconds: number,
    volume: number,
    type: BiquadFilterType = 'bandpass',
    bus: GainNode | null = this.effectsBus,
  ): void {
    if (!this.ctx || !bus) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(seconds);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
    src.connect(filter).connect(gain).connect(bus);
    src.start();
  }

  private tone(
    freq: number,
    seconds: number,
    volume: number,
    type: OscillatorType = 'sine',
    bus: GainNode | null = this.effectsBus,
  ): void {
    if (!this.ctx || !bus) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, ctx.currentTime + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
    osc.connect(gain).connect(bus);
    osc.start();
    osc.stop(ctx.currentTime + seconds);
  }

  chop(): void {
    this.burst(900, 0.12, 0.5);
    this.tone(140, 0.1, 0.25, 'triangle');
  }

  mine(): void {
    this.burst(2400, 0.09, 0.4, 'highpass');
    this.tone(220, 0.08, 0.2, 'square');
  }

  hit(): void {
    this.burst(500, 0.14, 0.5);
    this.tone(90, 0.16, 0.35, 'triangle');
  }

  hurt(): void {
    this.tone(180, 0.25, 0.4, 'sawtooth');
  }

  eat(): void {
    this.burst(1200, 0.08, 0.25);
  }

  place(): void {
    this.tone(320, 0.12, 0.3, 'triangle');
    this.burst(700, 0.1, 0.3);
  }

  levelUp(): void {
    if (!this.ctx) return;
    [523, 659, 784].forEach((f, i) =>
      setTimeout(() => this.tone(f, 0.25, 0.25, 'triangle'), i * 90),
    );
  }

  /** Per-frame: footstep ticks while moving on the ground. */
  footsteps(dt: number, speed: number, grounded: boolean): void {
    if (!this.ctx || speed < 0.5 || !grounded) return;
    this.stepTimer -= dt * speed;
    if (this.stepTimer <= 0) {
      this.stepTimer = 2.4;
      this.burst(300 + Math.random() * 150, 0.06, 0.12);
    }
  }

  /** Continuous soft wind bed + sparse birdsong, on the ambience bus. */
  private startAmbience(): void {
    if (!this.ctx || !this.ambientBus) return;
    const ctx = this.ctx;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.08;
    windGain.connect(this.ambientBus);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(3);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    src.connect(filter).connect(windGain);
    src.start();

    // Sparse birdsong (day ambience) — routed through the ambience bus.
    const chirp = (): void => {
      if (this.ctx && Math.random() < 0.5) {
        const f = 2200 + Math.random() * 1400;
        this.tone(f, 0.08, 0.05, 'sine', this.ambientBus);
        setTimeout(() => this.tone(f * 1.15, 0.06, 0.04, 'sine', this.ambientBus), 110);
      }
      setTimeout(chirp, 2500 + Math.random() * 5000);
    };
    setTimeout(chirp, 3000);
  }
}
