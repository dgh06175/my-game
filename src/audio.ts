import type { BiomeId } from "./core/types";

type SoundEnvironment = BiomeId | "base";
const MOODS: Record<SoundEnvironment, { root: number; cutoff: number; water: number; volume: number }> = {
  base: { root: 146.83, cutoff: 1500, water: 520, volume: 0.35 },
  reef: { root: 110, cutoff: 1200, water: 410, volume: 0.42 },
  wreck: { root: 98, cutoff: 900, water: 330, volume: 0.38 },
  abyss: { root: 73.42, cutoff: 650, water: 230, volume: 0.34 },
};

export class Soundscape {
  private ctx?: AudioContext;
  private master?: GainNode;
  private ambience?: GainNode;
  private harmonicFilter?: BiquadFilterNode;
  private waterFilter?: BiquadFilterNode;
  private waterGain?: GainNode;
  private harmonics: { oscillator: OscillatorNode; gain: GainNode }[] = [];
  private environment: SoundEnvironment = "base";
  private depth = 0;
  private appliedEnvironment?: SoundEnvironment;
  private appliedDepth = -Infinity;
  private lastEnvironmentUpdate = -Infinity;
  private muted = false;
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(ctx.destination);
      this.ambience = ctx.createGain();
      this.ambience.gain.value = 0.45;
      this.ambience.connect(this.master);
      this.harmonicFilter = ctx.createBiquadFilter();
      this.harmonicFilter.type = "lowpass";
      this.harmonicFilter.Q.value = 0.35;
      this.harmonicFilter.connect(this.ambience);
      [110, 164.81, 220, 329.63].forEach((f, i) => {
        const o = ctx.createOscillator(),
          g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        o.detune.value = i % 2 ? 3 : -3;
        g.gain.value = 0.008;
        o.connect(g);
        g.connect(this.harmonicFilter!);
        this.harmonics.push({ oscillator: o, gain: g });
        o.start();
      });
      const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate),
        d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.15;
      const source = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter(),
        gain = ctx.createGain();
      source.buffer = buf;
      source.loop = true;
      filter.type = "lowpass";
      filter.frequency.value = 300;
      gain.gain.value = 0.045;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.ambience);
      this.waterFilter = filter;
      this.waterGain = gain;
      source.start();
      this.updateEnvironment(true);
    } catch {
      /* Sound remains optional when an audio device is unavailable. */
    }
  }
  /** Update existing nodes only; recording a setting never starts or resumes audio. */
  setEnvironment(environment: SoundEnvironment, depthMeters = 0): void {
    this.environment = environment;
    this.depth = Number.isFinite(depthMeters) ? Math.max(0, Math.min(200, depthMeters)) : 0;
    this.updateEnvironment();
  }
  private updateEnvironment(force = false): void {
    if (!this.ctx || !this.ambience || !this.harmonicFilter || !this.waterFilter || !this.waterGain) return;
    const now = this.ctx.currentTime;
    const changedArea = this.appliedEnvironment !== this.environment;
    // HUD updates are frequent, but automation is limited to twice per second
    // and two metres of movement. Area transitions can begin immediately.
    if (!force && !changedArea && (now - this.lastEnvironmentUpdate < 0.5 || Math.abs(this.depth - this.appliedDepth) < 2)) return;
    const mood = MOODS[this.environment];
    const depth = this.environment === "base" ? 0 : this.depth / 200;
    const smooth = (param: AudioParam, target: number) => {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(target, now, force ? 0.5 : 1.6);
    };
    // Gentle low-pass shading and reduced upper harmonics make deeper water
    // feel quieter and more enclosed, without increasing the overall volume.
    smooth(this.ambience.gain, mood.volume * (1 - depth * 0.16));
    smooth(this.harmonicFilter.frequency, mood.cutoff * (1 - depth * 0.42));
    smooth(this.waterFilter.frequency, mood.water * (1 - depth * 0.45));
    smooth(this.waterGain.gain, this.environment === "base" ? 0.022 : 0.032 + depth * 0.006);
    const ratios = [1, 1.5, 2, 3];
    const levels = [0.009, 0.006, 0.004, 0.0025];
    this.harmonics.forEach(({ oscillator, gain }, i) => {
      smooth(oscillator.frequency, mood.root * ratios[i] * (1 - depth * 0.035));
      smooth(gain.gain, levels[i] * (1 - depth * i * 0.16));
    });
    this.appliedEnvironment = this.environment;
    this.appliedDepth = this.depth;
    this.lastEnvironmentUpdate = now;
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(
        muted ? 0 : 0.7,
        this.ctx.currentTime,
        0.2,
      );
  }
  suspend(): void {
    void this.ctx?.suspend();
  }
  tone(kind: string): void {
    if (!this.ctx || !this.master || this.muted) return;
    const c = this.ctx,
      t = c.currentTime,
      o = c.createOscillator(),
      g = c.createGain();
    const f =
      kind === "scan"
        ? 660
        : kind === "collect"
          ? 440
          : kind === "shot"
            ? 120
            : kind === "hit"
              ? 70
              : kind === "complete"
                ? 880
                : 330;
    o.type = kind === "shot" ? "triangle" : "sine";
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(
      kind === "shot" ? 45 : f * 1.5,
      t + 0.15,
    );
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.32);
  }
}
