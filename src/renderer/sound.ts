// Photoshoot sound design — 100% synthesized with the Web Audio API at runtime.
// There are NO audio files anywhere in this project: every beep, shutter and
// chime is generated from oscillators and filtered noise, so the sounds are
// original and contain nothing copied from Apple or anyone else, while aiming
// for the feel of a real photo booth: a clean countdown beep, a mechanical
// camera shutter with a body you can feel, a silent screen flash, quiet UI.
//
// Everything plays through one bus with a small synthetic room (a generated
// impulse response, mixed low), so the cues sound like one physical device.

type Cue =
  | 'tick'
  | 'shutter'
  | 'flash'
  | 'stripComplete'
  | 'trayDrop'
  | 'button'
  | 'themeSwitch'
  | 'error';

// Per-cue output level, balanced by rendering each cue offline and measuring
// it: the shutter is the loudest moment, the countdown beep clearly audible,
// UI sounds quiet, the error never louder than the shutter.
const LEVEL: Record<Cue, number> = {
  tick: 4.2,
  shutter: 3.2,
  flash: 1,
  stripComplete: 1.9,
  trayDrop: 3.6,
  button: 4,
  themeSwitch: 3.4,
  error: 0.9,
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null; // every cue connects here (dry + room)
  private out: AudioNode | null = null; // the cue being scheduled (its level → bus)
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
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      // A gentle limiter keeps layered cues from clipping on loud volumes.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      this.master.connect(limiter).connect(ctx.destination);

      this.bus = ctx.createGain();
      this.bus.connect(this.master);
      const room = ctx.createConvolver();
      room.buffer = this.makeRoom(0.42);
      const wet = ctx.createGain();
      wet.gain.value = 0.16;
      this.bus.connect(room).connect(wet).connect(this.master);

      this.noiseBuffer = this.makeNoise(0.6);
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

  /** A small, slightly dark room: stereo decaying noise with early reflections. */
  private makeRoom(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const white = Math.random() * 2 - 1;
        last = last * 0.55 + white * 0.45; // one-pole low-pass: a softer room
        data[i] = last * Math.pow(1 - t, 3.2);
      }
      // A couple of early reflections off nearby walls.
      for (const ms of c ? [7, 17] : [11, 23]) {
        const at = Math.floor((ms / 1000) * ctx.sampleRate);
        if (at < len) data[at] += 0.5;
      }
    }
    return buf;
  }

  play(cue: Cue): void {
    this.ensure();
    if (!this.ctx || !this.bus || this.muted) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const t = this.ctx.currentTime + 0.005;
    const level = this.ctx.createGain();
    level.gain.value = LEVEL[cue];
    level.connect(this.bus);
    this.out = level;
    switch (cue) {
      case 'tick':
        // The countdown beep: one clean, rounded tone, the same every second.
        this.tone(t, 1175, 0.16, 0.2, { attack: 0.004, partials: [[2, 0.08]], glideTo: 1160 });
        break;
      case 'button':
        // A quiet, dry UI tick.
        this.tone(t, 1900, 0.025, 0.06, { attack: 0.001 });
        this.noise(t, 0.008, 4200, 2, 0.05, 'bandpass');
        break;
      case 'shutter':
        this.shutter(t);
        break;
      case 'flash':
        // The screen flash is silent, as in a real photo booth; the shutter
        // carries the moment. (Kept as a cue so callers need not change.)
        break;
      case 'trayDrop':
        // A print settling onto the stack: a soft papery tap with a little body.
        this.noise(t, 0.05, 1100, 0.9, 0.16, 'lowpass');
        this.tone(t, 240, 0.09, 0.12, { attack: 0.002, glideTo: 150 });
        break;
      case 'stripComplete':
        // The booth "prints" your four: a short motor whir, then a warm bell.
        this.whir(t, 0.42);
        this.tone(t + 0.36, 1046.5, 0.9, 0.12, { attack: 0.012, partials: [[2, 0.18], [3, 0.06]] });
        this.tone(t + 0.5, 1318.5, 1.1, 0.1, { attack: 0.012, partials: [[2, 0.18], [3, 0.06]] });
        break;
      case 'themeSwitch':
        this.tone(t, 660, 0.14, 0.08, { attack: 0.004, glideTo: 990 });
        this.noise(t, 0.08, 3000, 1.5, 0.03, 'bandpass');
        break;
      case 'error':
        // A soft, low "bonk" — never a buzzer.
        this.tone(t, 330, 0.22, 0.16, { attack: 0.004, partials: [[2, 0.12]], glideTo: 290 });
        this.tone(t + 0.12, 247, 0.28, 0.14, { attack: 0.004, partials: [[2, 0.12]], glideTo: 220 });
        break;
    }
  }

  /**
   * A mechanical camera shutter, built in layers: the mirror lifting (a sharp
   * high click with a short metallic ring), the first curtain, the body's thump,
   * then the second curtain and mirror returning ~70 ms later, and a tiny
   * spring rattle as everything settles.
   */
  private shutter(t: number): void {
    // Mirror up: crisp transient + metallic ring.
    this.noise(t, 0.012, 5200, 1.4, 0.55, 'bandpass');
    this.noise(t, 0.02, 2400, 3, 0.28, 'bandpass');
    for (const [f, g] of [[3150, 0.05], [4720, 0.035], [6890, 0.02]] as const) this.tone(t, f, 0.045, g, { attack: 0.0008 });
    // The body: a short low thump you feel more than hear.
    this.tone(t + 0.002, 150, 0.075, 0.32, { attack: 0.001, glideTo: 70 });
    // First curtain.
    this.noise(t + 0.018, 0.02, 3300, 2.2, 0.26, 'bandpass');
    // Second curtain + mirror down: the "chk" that closes the sound.
    this.noise(t + 0.072, 0.016, 4400, 1.6, 0.36, 'bandpass');
    this.noise(t + 0.078, 0.035, 1500, 2.5, 0.2, 'bandpass');
    this.tone(t + 0.076, 115, 0.06, 0.18, { attack: 0.001, glideTo: 60 });
    // Spring settle: three tiny, fading ticks.
    [0.112, 0.128, 0.141].forEach((dt, i) => this.noise(t + dt, 0.006, 6000, 3, 0.05 / (i + 1), 'bandpass'));
  }

  /** A sine voice with optional harmonics, glide and a smooth exponential decay. */
  private tone(
    start: number,
    freq: number,
    dur: number,
    gain: number,
    opts: { attack?: number; partials?: [number, number][]; glideTo?: number } = {}
  ): void {
    const ctx = this.ctx!;
    const attack = opts.attack ?? 0.005;
    const voices: [number, number][] = [[1, 1], ...(opts.partials ?? [])];
    for (const [mult, level] of voices) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * mult, start);
      if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.glideTo * mult), start + dur);
      const length = mult === 1 ? dur : dur / Math.sqrt(mult); // upper partials fade first
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * level), start + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(g).connect(this.out!);
      osc.start(start);
      osc.stop(start + length + 0.05);
    }
  }

  /** A small print motor: low-passed noise with a mechanical flutter and a quiet hum. */
  private whir(start: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, start);
    filter.frequency.linearRampToValueAtTime(1400, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.07, start + 0.05);
    // Flutter: the gain dips a little 28 times a second, like gears turning.
    for (let k = 0.06; k < dur - 0.08; k += 1 / 28) {
      g.gain.setValueAtTime(0.07, start + k);
      g.gain.linearRampToValueAtTime(0.045, start + k + 1 / 56);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter).connect(g).connect(this.out!);
    src.start(start);
    src.stop(start + dur + 0.03);
    this.tone(start, 110, dur, 0.05, { attack: 0.03, glideTo: 150 }); // the motor's hum
  }

  private noise(start: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    // Start at a random point so repeated clicks never sound identical.
    const offset = Math.random() * Math.max(0, this.noiseBuffer!.duration - dur - 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter).connect(g).connect(this.out!);
    src.start(start, offset);
    src.stop(start + dur + 0.03);
  }
}

export const sound = new SoundEngine();
