/**
 * Hintergrundatmosphäre: leiser Wind.
 *
 * Gefiltertes Rauschen mit langsam wandernder Filterfrequenz. Ohne diese
 * Grundschicht wirkt die Szene tot, sobald man den Abzug loslässt.
 */
export class Ambience {
  constructor(engine) {
    this.engine = engine;
    this.started = false;
  }

  start() {
    const e = this.engine;
    if (!e.ready || this.started) return;
    const ctx = e.ctx;
    this.started = true;

    this.noise = e.noiseSource('pink');
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 420;
    this.filter.Q.value = 0.7;

    this.gain = ctx.createGain();
    this.gain.gain.value = 0;

    this.noise.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(e.dry);

    // Böen: zwei langsame, unterschiedlich schnelle Bewegungen überlagert,
    // damit sich kein hörbares Muster einstellt
    this.lfo1 = ctx.createOscillator();
    this.lfo1.frequency.value = 0.07;
    this.lfo2 = ctx.createOscillator();
    this.lfo2.frequency.value = 0.031;
    this.lfoGain1 = ctx.createGain();
    this.lfoGain1.gain.value = 170;
    this.lfoGain2 = ctx.createGain();
    this.lfoGain2.gain.value = 95;

    this.lfo1.connect(this.lfoGain1);
    this.lfo2.connect(this.lfoGain2);
    this.lfoGain1.connect(this.filter.frequency);
    this.lfoGain2.connect(this.filter.frequency);

    this.noise.start();
    this.lfo1.start();
    this.lfo2.start();

    this.gain.gain.setTargetAtTime(0.055, e.now, 2.0);
  }

  stop() {
    if (!this.started) return;
    try {
      this.noise.stop();
      this.lfo1.stop();
      this.lfo2.stop();
    } catch {
      /* schon gestoppt */
    }
    this.started = false;
  }
}
