/**
 * Tonerzeugung — vollständig prozedural über WebAudio.
 *
 * Keine Audiodateien: jedes Geräusch entsteht aus Rauschen, Filtern und
 * Oszillatoren. Das spart nicht nur Ladezeit und Lizenzfragen, es erlaubt auch,
 * den Klang stufenlos an das Geschehen zu koppeln — Filterfrequenz am Druck,
 * Klangfarbe am getroffenen Material. Ein abgespieltes Sample kann das nicht.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.masterVolume = 0.75;
  }

  /** Muss aus einer Nutzeraktion heraus gerufen werden (Autoplay-Regeln). */
  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // --- Summenweg ---
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;

    // Ein sanfter Begrenzer verhindert, dass gleichzeitige Spritzer,
    // Pumpe und Glocken übersteuern.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -9;
    this.limiter.knee.value = 22;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.22;

    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    // --- Hall ---
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(1.15, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.28;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);

    // Trockenweg
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.master);

    // Wiederverwendbare Rauschpuffer
    this.whiteNoise = this._makeNoise(3.0, 'white');
    this.pinkNoise = this._makeNoise(3.0, 'pink');

    this.listener = ctx.listener;
    this.ready = true;
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }

  /**
   * Impulsantwort: abklingendes Rauschen mit vorgeschalteten frühen
   * Reflexionen. Kein aufgenommener Raum, aber für einen Hinterhof mit einer
   * Mauer im Rücken überzeugend — und es sind zwölf Zeilen statt einer Datei.
   */
  _makeImpulse(seconds = 1.2, decay = 2.5) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);

    // Frühe Reflexionen: Mauer, Boden, Zaun
    const taps = [
      [0.011, 0.5],
      [0.019, 0.38],
      [0.031, 0.29],
      [0.047, 0.22],
      [0.068, 0.16],
    ];

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      const detune = ch === 0 ? 1.0 : 1.06; // Kanäle leicht auseinanderziehen
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.55;
      }
      for (const [time, gain] of taps) {
        const idx = Math.floor(time * detune * rate);
        if (idx < len) data[idx] += gain * (ch === 0 ? 1 : -0.85);
      }
    }
    return buf;
  }

  _makeNoise(seconds, kind = 'white') {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);

    if (kind === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else {
      // Rosa Rauschen nach Voss-McCartney: tiefer, weicher, weniger zischend
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  /** Endlos laufende Rauschquelle. */
  noiseSource(kind = 'white') {
    const src = this.ctx.createBufferSource();
    src.buffer = kind === 'pink' ? this.pinkNoise : this.whiteNoise;
    src.loop = true;
    return src;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime, 0.05);
    }
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
}
