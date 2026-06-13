// Photoshoot sound design — 100% synthesized with the Web Audio API at runtime.
// There are NO audio files anywhere in this project: every click, tick, flash,
// and chime is generated from oscillators and filtered noise. This guarantees
// the sounds are original and contain nothing copied from Apple or anyone else,
// while recreating the *feeling* of a tactile photobooth.

type Cue =
  | 'tick'
  | 'shutter'
  | 'flash'
  | 'stripComplete'
  | 'trayDrop'
  | 'button'
  | 'themeSwitch'
  | 'error';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.7;
  private muted = false;

  /** Must be called from a user gesture the first time, per autoplay policy. */
  unlock(): void {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyGain();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }

  private applyGain(): void {
    if (this.master && this.ctx) {
      const target = this.muted ? 0 : this.volume;
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
    }
  }

  private ensure(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise(0.5);
    } catch {
      this.ctx = null; // app continues silently
    }
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  play(cue: Cue): void {
    this.ensure();
    if (!this.ctx || !this.master || this.muted) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const t = this.ctx.currentTime;
    switch (cue) {
      case 'tick':
        this.blip(t, 920, 0.07, 'triangle', 0.32, 1180);
        this.noise(t, 0.018, 2600, 6, 0.12);
        break;
      case 'button':
        this.blip(t, 540, 0.045, 'sine', 0.12, 720);
        break;
      case 'shutter':
        // Mechanical "k-chk": a sharp click, a softer clack, a low body thunk.
        this.noise(t, 0.012, 3200, 8, 0.5);
        this.noise(t + 0.028, 0.03, 1500, 5, 0.32);
        this.blip(t + 0.004, 180, 0.07, 'sine', 0.3, 90);
        break;
      case 'flash':
        // Bright airy shimmer that rides on top of the shutter at capture.
        this.blip(t, 1400, 0.22, 'sine', 0.16, 3200);
        this.noise(t, 0.14, 5200, 1.2, 0.06);
        break;
      case 'trayDrop':
        // Soft "plip" as a photo lands in the tray.
        this.blip(t, 660, 0.12, 'sine', 0.22, 240);
        this.noise(t + 0.02, 0.04, 900, 3, 0.07);
        break;
      case 'stripComplete':
        // Cheerful ascending arpeggio.
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.blip(t + i * 0.085, f, 0.26, 'triangle', 0.22)
        );
        break;
      case 'themeSwitch':
        this.blip(t, 380, 0.18, 'sine', 0.14, 760);
        this.noise(t, 0.1, 3000, 1.5, 0.04);
        break;
      case 'error':
        this.blip(t, 220, 0.18, 'sawtooth', 0.18, 150);
        this.blip(t + 0.14, 165, 0.22, 'sawtooth', 0.16, 110);
        break;
    }
  }

  private blip(
    start: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    sweepTo?: number
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }

  private noise(start: number, dur: number, freq: number, q: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(start);
    src.stop(start + dur + 0.03);
  }
}

export const sound = new SoundEngine();
