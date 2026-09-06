export class Soundscape {
  private ctx?: AudioContext;
  private master?: GainNode;
  private ambience?: GainNode;
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
      [110, 164.81, 220, 329.63].forEach((f, i) => {
        const o = ctx.createOscillator(),
          g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        o.detune.value = i % 2 ? 3 : -3;
        g.gain.value = 0.008;
        o.connect(g);
        g.connect(this.ambience!);
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
      source.start();
    } catch {
      /* Sound remains optional when an audio device is unavailable. */
    }
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
