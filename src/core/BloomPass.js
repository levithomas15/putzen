import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Bloom nach dem Downsample-/Upsample-Verfahren (wie in modernen Engines üblich):
 * heller Anteil wird herausgefiltert, über eine Mip-Kette verkleinert und mit
 * einem Zeltfilter wieder aufgezogen. Das ergibt einen weichen, breiten Schein
 * ohne die Ringe, die einfache Gauß-Ketten erzeugen.
 *
 * Bewusst ohne GL-Blending: jeder Schritt liest seine Eingänge explizit und
 * schreibt das Ergebnis. Das ist robuster über Treiber hinweg — three's
 * UnrealBloomPass verlässt sich auf additives Blending in den Half-Float-Puffer
 * des Composers und liefert unter ANGLE/SwiftShader ein komplett schwarzes Bild.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Weicher Schwellenwert: kein harter Schnitt, sondern ein Knie, damit
// Flächen nicht plötzlich anfangen zu leuchten, wenn sie heller werden.
const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uKnee;
uniform float uClamp;
varying vec2 vUv;

void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  c = min(c, vec3(uClamp));                       // Feuerwerk einzelner Pixel dämpfen
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float w = max(soft, br - uThreshold) / max(br, 1e-5);
  gl_FragColor = vec4(c * w, 1.0);
}
`;

// 13-Tap-Filter beim Verkleinern — unterdrückt das Flimmern, das ein simpler
// Box-Filter bei hellen Einzelpunkten erzeugt.
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
varying vec2 vUv;

vec3 T(vec2 o){ return texture2D(tDiffuse, vUv + o * uTexel).rgb; }

void main(){
  vec3 a = T(vec2(-2.0,  2.0)), b = T(vec2( 0.0,  2.0)), c = T(vec2( 2.0,  2.0));
  vec3 d = T(vec2(-2.0,  0.0)), e = T(vec2( 0.0,  0.0)), f = T(vec2( 2.0,  0.0));
  vec3 g = T(vec2(-2.0, -2.0)), h = T(vec2( 0.0, -2.0)), i = T(vec2( 2.0, -2.0));
  vec3 j = T(vec2(-1.0,  1.0)), k = T(vec2( 1.0,  1.0));
  vec3 l = T(vec2(-1.0, -1.0)), m = T(vec2( 1.0, -1.0));

  vec3 sum = e * 0.125;
  sum += (a + c + g + i) * 0.03125;
  sum += (b + d + f + h) * 0.0625;
  sum += (j + k + l + m) * 0.125;
  gl_FragColor = vec4(sum, 1.0);
}
`;

// Zeltfilter beim Vergrößern, plus explizite Addition der gröberen Stufe.
const UP_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;   // gröbere (kleinere) Stufe
uniform sampler2D tPrevious;  // Stufe, auf die addiert wird
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;

vec3 T(vec2 o){ return texture2D(tDiffuse, vUv + o * uTexel * uRadius).rgb; }

void main(){
  vec3 sum = T(vec2(-1.0,  1.0)) * 1.0 + T(vec2( 0.0,  1.0)) * 2.0 + T(vec2( 1.0,  1.0)) * 1.0
           + T(vec2(-1.0,  0.0)) * 2.0 + T(vec2( 0.0,  0.0)) * 4.0 + T(vec2( 1.0,  0.0)) * 2.0
           + T(vec2(-1.0, -1.0)) * 1.0 + T(vec2( 0.0, -1.0)) * 2.0 + T(vec2( 1.0, -1.0)) * 1.0;
  sum *= 1.0 / 16.0;
  gl_FragColor = vec4(texture2D(tPrevious, vUv).rgb + sum, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;  // Ausgangsbild
uniform sampler2D tBloom;
uniform float uStrength;
varying vec2 vUv;

void main(){
  vec4 base = texture2D(tDiffuse, vUv);
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  gl_FragColor = vec4(base.rgb + bloom * uStrength, base.a);
}
`;

export class BloomPass extends Pass {
  constructor(width = 512, height = 512, opts = {}) {
    super();
    this.needsSwap = true;

    this.strength = opts.strength ?? 0.4;
    this.threshold = opts.threshold ?? 0.85;
    this.knee = opts.knee ?? 0.5;
    this.radius = opts.radius ?? 1.0;
    this.clampMax = opts.clamp ?? 12.0;
    this.levels = opts.levels ?? 5;

    const mk = (frag, uniforms) =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERT,
        fragmentShader: frag,
        depthTest: false,
        depthWrite: false,
      });

    this.matPrefilter = mk(PREFILTER_FRAG, {
      tDiffuse: { value: null },
      uThreshold: { value: this.threshold },
      uKnee: { value: this.knee },
      uClamp: { value: this.clampMax },
    });
    this.matDown = mk(DOWN_FRAG, { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.matUp = mk(UP_FRAG, {
      tDiffuse: { value: null },
      tPrevious: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: this.radius },
    });
    this.matComposite = mk(COMPOSITE_FRAG, {
      tDiffuse: { value: null },
      tBloom: { value: null },
      uStrength: { value: this.strength },
    });

    this.quad = new FullScreenQuad(null);
    this.mips = [];
    this.upMips = [];
    this.setSize(width, height);
  }

  _makeTarget(w, h) {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      colorSpace: THREE.NoColorSpace,
    });
  }

  setSize(width, height) {
    for (const t of this.mips) t.dispose();
    for (const t of this.upMips) t.dispose();
    this.mips = [];
    this.upMips = [];

    let w = Math.max(1, Math.floor(width / 2));
    let h = Math.max(1, Math.floor(height / 2));
    for (let i = 0; i < this.levels; i++) {
      this.mips.push(this._makeTarget(w, h));
      this.upMips.push(this._makeTarget(w, h));
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      if (w === 1 && h === 1) break;
    }
  }

  _draw(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.clear();
    this.quad.render(renderer);
  }

  render(renderer, writeBuffer, readBuffer) {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // 1. Helle Anteile herausfiltern, gleich auf halbe Auflösung
    this.matPrefilter.uniforms.tDiffuse.value = readBuffer.texture;
    this.matPrefilter.uniforms.uThreshold.value = this.threshold;
    this.matPrefilter.uniforms.uKnee.value = this.knee;
    this.matPrefilter.uniforms.uClamp.value = this.clampMax;
    this._draw(renderer, this.matPrefilter, this.mips[0]);

    // 2. Verkleinern
    for (let i = 1; i < this.mips.length; i++) {
      const src = this.mips[i - 1];
      this.matDown.uniforms.tDiffuse.value = src.texture;
      this.matDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this._draw(renderer, this.matDown, this.mips[i]);
    }

    // 3. Wieder aufziehen und aufaddieren (explizit im Shader, kein Blending)
    const last = this.mips.length - 1;
    let current = this.mips[last];
    for (let i = last - 1; i >= 0; i--) {
      this.matUp.uniforms.tDiffuse.value = current.texture;
      this.matUp.uniforms.tPrevious.value = this.mips[i].texture;
      this.matUp.uniforms.uTexel.value.set(1 / current.width, 1 / current.height);
      this.matUp.uniforms.uRadius.value = this.radius;
      this._draw(renderer, this.matUp, this.upMips[i]);
      current = this.upMips[i];
    }

    // 4. Über das Ausgangsbild legen
    this.matComposite.uniforms.tDiffuse.value = readBuffer.texture;
    this.matComposite.uniforms.tBloom.value = current.texture;
    this.matComposite.uniforms.uStrength.value = this.strength;

    this.quad.material = this.matComposite;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.quad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.quad.render(renderer);
    }

    renderer.autoClear = oldAutoClear;
  }

  dispose() {
    for (const t of this.mips) t.dispose();
    for (const t of this.upMips) t.dispose();
    this.matPrefilter.dispose();
    this.matDown.dispose();
    this.matUp.dispose();
    this.matComposite.dispose();
    this.quad.dispose();
  }
}
