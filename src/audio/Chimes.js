/**
 * Belohnungsklänge.
 *
 * Der wichtigste Trick steckt in `surfaceDone`: die Töne steigen über die
 * Flächen hinweg an. Jede fertige Fläche klingt eine Stufe höher als die
 * vorige, sodass sich über eine Runde eine Tonleiter aufbaut. Das koppelt
 * Fortschritt direkt an eine Auflösung, auf die das Ohr wartet — deutlich
 * wirksamer als derselbe Ton immer wieder.
 */

// Pentatonik: klingt in jeder Reihenfolge zusammen, es kann nichts schief gehen
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
const ROOT = 523.25; // C5

const semitone = (n) => ROOT * Math.pow(2, n / 12);

export class Chimes {
  constructor(engine) {
    this.engine = engine;
    this.step = 0;
  }

  reset() {
    this.step = 0;
  }

  _bell(freq, when, duration, gain, harmonics = [1, 2.01, 3.02], decayShape = 3.2) {
    const e = this.engine;
    if (!e.ready) return;
    const ctx = e.ctx;

    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(e.dry);
    out.connect(e.reverbSend);

    harmonics.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;

      const g = ctx.createGain();
      const level = gain / Math.pow(i + 1, 1.7);
      // Höhere Teiltöne klingen schneller ab — so klingt eine echte Glocke
      const decay = duration / Math.pow(ratio, 0.6);

      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(level, when + 0.006);
      g.gain.exponentialRampToValueAtTime(Math.max(level * 0.0008, 1e-5), when + decay);

      osc.connect(g);
      g.connect(out);
      osc.start(when);
      osc.stop(when + decay + 0.05);
    });

    setTimeout(() => out.disconnect(), (when - e.now + duration + 0.4) * 1000 + 200);
  }

  /** Eine Fläche ist fertig — der nächste Ton der Leiter. */
  surfaceDone() {
    const e = this.engine;
    if (!e.ready) return;
    const n = SCALE[Math.min(this.step, SCALE.length - 1)];
    this.step++;
    const t = e.now;
    this._bell(semitone(n), t, 1.5, 0.19);
    this._bell(semitone(n + 7), t + 0.055, 1.1, 0.1); // Quinte für Glanz
  }

  /** Kleiner Zwischenschritt bei 25/50/75 %. */
  tick(index = 0) {
    const e = this.engine;
    if (!e.ready) return;
    this._bell(semitone(12 + index * 2), e.now, 0.42, 0.075, [1, 2.4], 4.0);
  }

  /** Alles sauber. */
  fanfare() {
    const e = this.engine;
    if (!e.ready) return;
    const t = e.now;
    [0, 4, 7, 12, 16].forEach((n, i) => {
      this._bell(semitone(n), t + i * 0.11, 2.4, 0.2);
    });
    this._bell(semitone(24), t + 0.62, 3.4, 0.14);
  }

  /** Rückmeldung beim Düsenwechsel — kurz und mechanisch. */
  clack() {
    const e = this.engine;
    if (!e.ready) return;
    const ctx = e.ctx;
    const t = e.now;

    const src = e.noiseSource('white');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

    src.connect(bp);
    bp.connect(g);
    g.connect(e.dry);
    src.start(t);
    src.stop(t + 0.09);
  }
}
