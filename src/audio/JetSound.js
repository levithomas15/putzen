/**
 * Der Klang von Strahl und Aufprall.
 *
 * Zwei getrennte Instrumente, die zusammen erst überzeugen:
 *  - Der **Strahl** ist gefiltertes Rauschen an der Düse. Er klingt immer gleich,
 *    egal wohin man hält.
 *  - Der **Aufprall** ist eine zweite Rauschschicht, deren Klangfarbe vom
 *    getroffenen Material kommt. Holz antwortet dumpf, Ziegel rau und breit,
 *    Metall hell mit Nachklang, Gewebe schluckt fast alles.
 *
 * Dieses zweite Instrument verkauft die ganze Szene: Man hört, worauf man hält,
 * bevor man es sieht.
 */

/** Akustische Eigenschaften je Oberfläche. */
const MATERIAL_VOICE = {
  deckWood: { freq: 950, q: 1.3, gain: 0.85, ring: 0.0, body: 0.55 },
  brick: { freq: 2500, q: 0.8, gain: 1.0, ring: 0.0, body: 0.3 },
  concrete: { freq: 2900, q: 0.7, gain: 1.0, ring: 0.0, body: 0.28 },
  paintedMetal: { freq: 3600, q: 5.5, gain: 0.9, ring: 0.55, body: 0.2 },
  plastic: { freq: 1500, q: 2.2, gain: 0.8, ring: 0.18, body: 0.42 },
  terracotta: { freq: 2100, q: 3.0, gain: 0.85, ring: 0.3, body: 0.35 },
  fabric: { freq: 700, q: 0.7, gain: 0.42, ring: 0.0, body: 0.6 },
  soil: { freq: 420, q: 0.6, gain: 0.6, ring: 0.0, body: 0.75 },
  _default: { freq: 1800, q: 1.2, gain: 0.8, ring: 0.0, body: 0.4 },
};

export class JetSound {
  constructor(engine) {
    this.engine = engine;
    this.started = false;
    this.currentMaterial = null;
  }

  start() {
    const e = this.engine;
    if (!e.ready || this.started) return;
    const ctx = e.ctx;
    this.started = true;

    // ---- Strahl an der Düse ----
    this.jetNoise = e.noiseSource('white');
    this.jetBand = ctx.createBiquadFilter();
    this.jetBand.type = 'bandpass';
    this.jetBand.frequency.value = 1800;
    this.jetBand.Q.value = 2.5;

    this.jetLow = ctx.createBiquadFilter();
    this.jetLow.type = 'lowpass';
    this.jetLow.frequency.value = 700;
    this.jetLow.Q.value = 0.8;

    this.jetGain = ctx.createGain();
    this.jetGain.gain.value = 0;
    this.bodyGain = ctx.createGain();
    this.bodyGain.gain.value = 0;

    this.jetNoise.connect(this.jetBand);
    this.jetBand.connect(this.jetGain);
    this.jetNoise.connect(this.jetLow);
    this.jetLow.connect(this.bodyGain);

    this.jetSum = ctx.createGain();
    this.jetSum.gain.value = 0.32;
    this.jetGain.connect(this.jetSum);
    this.bodyGain.connect(this.jetSum);
    this.jetSum.connect(e.dry);
    this.jetSum.connect(e.reverbSend);

    // Leichtes Wabern, damit der Strahl lebt statt zu stehen
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 7.3;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 190;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.jetBand.frequency);
    this.lfo.start();

    // ---- Aufprall auf dem Material ----
    this.hitNoise = e.noiseSource('white');
    this.hitBand = ctx.createBiquadFilter();
    this.hitBand.type = 'bandpass';
    this.hitBand.frequency.value = 1800;
    this.hitBand.Q.value = 1.2;

    this.hitRing = ctx.createBiquadFilter();
    this.hitRing.type = 'peaking';
    this.hitRing.frequency.value = 3600;
    this.hitRing.Q.value = 9;
    this.hitRing.gain.value = 0;

    this.hitBody = ctx.createBiquadFilter();
    this.hitBody.type = 'lowpass';
    this.hitBody.frequency.value = 420;

    this.hitGain = ctx.createGain();
    this.hitGain.gain.value = 0;
    this.hitBodyGain = ctx.createGain();
    this.hitBodyGain.gain.value = 0;

    // Entfernung macht den Aufprall dumpfer, nicht nur leiser
    this.distanceFilter = ctx.createBiquadFilter();
    this.distanceFilter.type = 'lowpass';
    this.distanceFilter.frequency.value = 20000;

    this.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    this.hitNoise.connect(this.hitBand);
    this.hitBand.connect(this.hitRing);
    this.hitRing.connect(this.hitGain);
    this.hitNoise.connect(this.hitBody);
    this.hitBody.connect(this.hitBodyGain);

    this.hitSum = ctx.createGain();
    this.hitSum.gain.value = 0.55;
    this.hitGain.connect(this.hitSum);
    this.hitBodyGain.connect(this.hitSum);
    this.hitSum.connect(this.distanceFilter);

    if (this.panner) {
      this.distanceFilter.connect(this.panner);
      this.panner.connect(e.dry);
      this.panner.connect(e.reverbSend);
    } else {
      this.distanceFilter.connect(e.dry);
      this.distanceFilter.connect(e.reverbSend);
    }

    this.jetNoise.start();
    this.hitNoise.start();
  }

  /**
   * @param {object} state
   *   pressure   0..1
   *   nozzle     Eintrag aus NOZZLES
   *   hit        { distance, surface } oder null
   *   pan        -1..1, Auftreffpunkt relativ zur Blickrichtung
   */
  update(state) {
    if (!this.started) return;
    const e = this.engine;
    const t = e.now;
    const k = 0.045; // Zeitkonstante: schnell genug zum Reagieren, ohne zu klicken

    const p = state.pressure ?? 0;
    const n = state.nozzle?.sound ?? { cutoff: 2000, q: 3, noise: 1, body: 0.5 };

    // ---- Strahl ----
    this.jetBand.frequency.setTargetAtTime(n.cutoff, t, 0.08);
    this.jetBand.Q.setTargetAtTime(n.q, t, 0.08);
    this.lfoGain.gain.setTargetAtTime(n.cutoff * 0.09, t, 0.1);
    this.lfo.frequency.setTargetAtTime(n.warble ?? 7.3, t, 0.1);

    // Nicht linear: der Druckaufbau soll hörbar "anziehen"
    const jetLevel = Math.pow(p, 0.75);
    this.jetGain.gain.setTargetAtTime(jetLevel * n.noise * 0.9, t, k);
    this.bodyGain.gain.setTargetAtTime(jetLevel * n.body * 0.8, t, k);

    // ---- Aufprall ----
    const hit = state.hit;
    if (hit && p > 0.02) {
      const v = MATERIAL_VOICE[hit.surface] ?? MATERIAL_VOICE._default;
      if (this.currentMaterial !== hit.surface) {
        this.currentMaterial = hit.surface;
        // Materialwechsel etwas träger, sonst zirpt es beim Schwenken
        this.hitBand.frequency.setTargetAtTime(v.freq, t, 0.05);
        this.hitBand.Q.setTargetAtTime(v.q, t, 0.05);
        this.hitRing.frequency.setTargetAtTime(v.freq * 1.15, t, 0.05);
        this.hitRing.gain.setTargetAtTime(v.ring * 14, t, 0.05);
      }

      // Näher dran heißt lauter und heller
      const d = Math.max(hit.distance, 0.3);
      const near = Math.min(2.6 / d, 1.4);
      this.distanceFilter.frequency.setTargetAtTime(
        Math.max(700, 16000 / (1 + d * 0.55)), t, 0.06,
      );

      this.hitGain.gain.setTargetAtTime(jetLevel * v.gain * near * 0.75, t, k);
      this.hitBodyGain.gain.setTargetAtTime(jetLevel * v.body * near * 0.6, t, k);
      if (this.panner) this.panner.pan.setTargetAtTime(state.pan ?? 0, t, 0.09);
    } else {
      this.hitGain.gain.setTargetAtTime(0, t, 0.07);
      this.hitBodyGain.gain.setTargetAtTime(0, t, 0.07);
    }
  }

  stop() {
    if (!this.started) return;
    try {
      this.jetNoise.stop();
      this.hitNoise.stop();
      this.lfo.stop();
    } catch {
      /* schon gestoppt */
    }
    this.started = false;
  }
}
