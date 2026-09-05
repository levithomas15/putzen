/**
 * Das Aggregat.
 *
 * Ein Hochdruckreiniger steht nicht still: die Pumpe läuft im Leerlauf mit,
 * und sobald der Abzug kommt, zieht sie hörbar an. Genau dieses Anziehen macht
 * den Unterschied zwischen "Geräusch an" und "Maschine arbeitet".
 */
export class PumpSound {
  constructor(engine) {
    this.engine = engine;
    this.started = false;
  }

  start() {
    const e = this.engine;
    if (!e.ready || this.started) return;
    const ctx = e.ctx;
    this.started = true;

    // Signalweg: Oszillatoren -> Weichzeichner -> Ausgang
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 380;
    this.tone.Q.value = 1.4;

    this.motorOut = ctx.createGain();
    this.motorOut.gain.value = 0;
    this.tone.connect(this.motorOut);
    this.motorOut.connect(e.dry);
    this.motorOut.connect(e.reverbSend);

    // Grundton des Motors plus zwei Obertöne — ein einzelner Sägezahn
    // klingt nach Synthesizer, drei leicht verstimmte nach Maschine.
    this.oscs = [];
    for (const [ratio, level, detune] of [
      [1.0, 0.5, 0],
      [2.0, 0.22, 6],
      [3.02, 0.12, -8],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 47 * ratio;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(this.tone);
      osc.start();
      this.oscs.push(osc);
    }

    // Mechanisches Rappeln
    this.rattle = e.noiseSource('pink');
    this.rattleFilter = ctx.createBiquadFilter();
    this.rattleFilter.type = 'bandpass';
    this.rattleFilter.frequency.value = 165;
    this.rattleFilter.Q.value = 1.1;
    this.rattleGain = ctx.createGain();
    this.rattleGain.gain.value = 0;
    this.rattle.connect(this.rattleFilter);
    this.rattleFilter.connect(this.rattleGain);
    this.rattleGain.connect(this.tone);
    this.rattle.start();

    // Ungleichmäßiger Lauf
    this.wobble = ctx.createOscillator();
    this.wobble.frequency.value = 3.1;
    this.wobbleGain = ctx.createGain();
    this.wobbleGain.gain.value = 2.4;
    this.wobble.connect(this.wobbleGain);
    for (const osc of this.oscs) this.wobbleGain.connect(osc.detune);
    this.wobble.start();

    this.level = 0;
  }

  /** @param {boolean} running  Gerät eingeschaltet  @param {number} load  0..1 */
  update(running, load) {
    if (!this.started) return;
    const t = this.engine.now;

    const target = running ? 0.1 + load * 0.14 : 0;
    this.motorOut.gain.setTargetAtTime(target, t, 0.12);

    // Unter Last läuft die Pumpe etwas schneller und heller
    const base = 47 + load * 7;
    const ratios = [1.0, 2.0, 3.02];
    for (let i = 0; i < this.oscs.length; i++) {
      this.oscs[i].frequency.setTargetAtTime(base * ratios[i], t, 0.14);
    }
    this.tone.frequency.setTargetAtTime(340 + load * 340, t, 0.14);
    this.rattleGain.gain.setTargetAtTime(running ? 0.1 + load * 0.22 : 0, t, 0.12);
    this.wobble.frequency.setTargetAtTime(3.1 + load * 2.4, t, 0.2);
  }

  stop() {
    if (!this.started) return;
    try {
      for (const o of this.oscs) o.stop();
      this.wobble.stop();
      this.rattle.stop();
    } catch {
      /* schon gestoppt */
    }
    this.started = false;
  }
}
