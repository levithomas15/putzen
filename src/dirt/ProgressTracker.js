import * as THREE from 'three';

/**
 * Misst, wie viel Dreck noch auf jeder Maske liegt.
 *
 * Die Maske wird über eine Kette von 4×-Reduktionen auf 4×4 heruntergerechnet
 * und dann per `readRenderTargetPixelsAsync` ausgelesen — nicht blockierend, es
 * gibt also keinen Ruckler durch die Messung.
 *
 * Der Fortschritt wird gegen den **Anfangswert** normiert, nicht gegen 1.0.
 * Das ist wichtig: der Atlas ist nie ganz gefüllt und der Startdreck ist
 * ungleich verteilt. Nur so bedeutet "100 %" wirklich "nichts mehr da".
 */

const REDUCE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;     // Abgriffsversatz, siehe _reduce()
varying vec2 vUv;

void main(){
  // Vier bilineare Abgriffe. Jeder mittelt ein 2x2-Feld, zusammen also 4x4 --
  // vorausgesetzt, der Versatz passt zum Verkleinerungsfaktor.
  vec2 o = uTexel;
  vec4 s = texture2D(tSrc, vUv + vec2(-o.x, -o.y))
         + texture2D(tSrc, vUv + vec2( o.x, -o.y))
         + texture2D(tSrc, vUv + vec2(-o.x,  o.y))
         + texture2D(tSrc, vUv + vec2( o.x,  o.y));
  gl_FragColor = s * 0.25;
}
`;

const REDUCE_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FINAL_SIZE = 4;

export class ProgressTracker {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: REDUCE_VERT,
      fragmentShader: REDUCE_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;

    this.chains = new Map(); // Maskengröße -> Zwischenziele
    this.cursor = 0;
    this.inFlight = new Set();
  }

  _target(size) {
    return new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      colorSpace: THREE.NoColorSpace,
    });
  }

  /** Zwischenziele je Maskengröße — werden von allen Masken gleicher Größe geteilt. */
  _chain(size) {
    if (this.chains.has(size)) return this.chains.get(size);
    const steps = [];
    let s = size;
    while (s > FINAL_SIZE) {
      s = Math.max(FINAL_SIZE, s >> 2);
      steps.push(this._target(s));
    }
    this.chains.set(size, steps);
    return steps;
  }

  register(mask) {
    this._chain(mask.size);
    if (!mask._readTarget) {
      mask._readTarget = this._target(FINAL_SIZE);
      mask._readBuffer = new Uint8Array(FINAL_SIZE * FINAL_SIZE * 4);
    }
  }

  /** Reduktion ausführen und den kleinen Endpuffer füllen. */
  _reduce(mask) {
    const chain = this._chain(mask.size);
    const r = this.renderer;
    const prev = r.getRenderTarget();

    let srcTex = mask.texture;
    let srcSize = mask.size;

    for (const step of chain) {
      this.material.uniforms.tSrc.value = srcTex;
      // Der Versatz muss mit dem Verkleinerungsfaktor mitgehen: bei 4:1 liegt
      // er bei einem Texel, bei 2:1 bei einem halben. Sonst greifen die Abgriffe
      // über das Feld hinaus, das dieses Zieltexel abdecken soll, und der
      // Mittelwert stimmt nicht mehr genau.
      const ratio = srcSize / step.width;
      const off = ratio / 4 / srcSize;
      this.material.uniforms.uTexel.value.set(off, off);
      r.setRenderTarget(step);
      r.render(this.quad, this.camera);
      srcTex = step.texture;
      srcSize = step.width;
    }

    // Ergebnis in das maskeneigene Endziel kopieren, damit der laufende
    // Readback nicht von der nächsten Maske überschrieben wird.
    this.material.uniforms.tSrc.value = srcTex;
    this.material.uniforms.uTexel.value.set(0, 0);
    r.setRenderTarget(mask._readTarget);
    r.render(this.quad, this.camera);

    r.setRenderTarget(prev);
  }

  /** Einen Messwert holen. Gibt den mittleren Dreckanteil zurück. */
  async measure(mask) {
    this.register(mask);
    this._reduce(mask);
    await this.renderer.readRenderTargetPixelsAsync(
      mask._readTarget, 0, 0, FINAL_SIZE, FINAL_SIZE, mask._readBuffer,
    );
    let sum = 0;
    const b = mask._readBuffer;
    for (let i = 0; i < b.length; i += 4) sum += b[i];
    return sum / (b.length / 4) / 255;
  }

  /**
   * Nach dem Säen einmal den Ausgangswert festhalten.
   *
   * Erst alle Reduktionen zeichnen, dann alle Readbacks gemeinsam abwarten.
   * Nacheinander abgewartet kostet jeder Readback eine eigene GPU-Synchronisation
   * — bei einem Dutzend Flächen macht das den Unterschied zwischen einem
   * Wimpernschlag und mehreren Sekunden Ladezeit.
   */
  async captureInitial(masks) {
    for (const mask of masks) {
      this.register(mask);
      this._reduce(mask);
    }
    await Promise.all(
      masks.map(async (mask) => {
        await this.renderer.readRenderTargetPixelsAsync(
          mask._readTarget, 0, 0, FINAL_SIZE, FINAL_SIZE, mask._readBuffer,
        );
        let sum = 0;
        const b = mask._readBuffer;
        for (let i = 0; i < b.length; i += 4) sum += b[i];
        const v = sum / (b.length / 4) / 255;
        mask.initialDirt = Math.max(v, 1e-4);
        mask.currentDirt = v;
        mask.progress = 0;
        mask.done = false;
      }),
    );
  }

  /**
   * Läuft im Spiel mit: pro Aufruf werden ein paar Masken nachgemessen.
   * @param {Function} onDone  wird gerufen, wenn eine Maske fertig wird
   */
  update(masks, perFrame = 2, onDone = null) {
    if (!masks.length) return;
    for (let k = 0; k < perFrame; k++) {
      const mask = masks[this.cursor % masks.length];
      this.cursor++;
      if (mask.done || this.inFlight.has(mask)) continue;

      this.inFlight.add(mask);
      this.measure(mask)
        .then((v) => {
          mask.currentDirt = v;
          const p = THREE.MathUtils.clamp(1 - v / mask.initialDirt, 0, 1);
          mask.progress = p;
          // Die letzten Reste sollen nicht zur Pixeljagd werden.
          if (p >= 0.995 && !mask.done) {
            mask.done = true;
            mask.progress = 1;
            onDone?.(mask);
          }
        })
        .catch(() => {})
        .finally(() => this.inFlight.delete(mask));
    }
  }

  /** Gesamtfortschritt, nach Fläche gewichtet. */
  total(masks) {
    let num = 0;
    let den = 0;
    for (const m of masks) {
      num += m.progress * m.area;
      den += m.area;
    }
    return den > 0 ? num / den : 0;
  }

  dispose() {
    for (const chain of this.chains.values()) for (const t of chain) t.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
