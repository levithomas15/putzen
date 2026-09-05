import * as THREE from 'three';
import { NOISE_GLSL } from './glsl-noise.js';

/**
 * Backt prozedurale PBR-Texturen auf der GPU — kein einziges Bild von der Platte.
 *
 * Jedes Material liefert eine GLSL-Funktion
 *     void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height)
 * und der Backer erzeugt daraus drei Karten:
 *   - albedo  (RGBA8, sRGB)   Grundfarbe, direkt in sRGB geschrieben
 *   - orm     (RGBA8, linear) r = frei, g = Roughness, b = Metalness  (three-Konvention)
 *   - normal  (RGBA8, linear) aus der Höhe per Sobel abgeleitet
 *
 * Die Höhe läuft über ein Half-Float-Target, damit die Normalen nicht stufen.
 */

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const PREAMBLE = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uRepeat;   // Kachelperiode: hält das Rauschen nahtlos
${NOISE_GLSL}
`;

export class TextureBaker {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  _run(material, target) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    this.quad.material = material;
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
    material.dispose();
  }

  _target(size, { float = false, srgb = false } = {}) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    rt.texture.anisotropy = this.maxAniso;
    return rt;
  }

  /**
   * @param {string} surfaceGlsl  GLSL mit der Funktion `surface(...)`
   * @param {object} opts         size, uniforms, normalStrength, tile
   */
  bake(surfaceGlsl, opts = {}) {
    const size = opts.size ?? 512;
    const tile = opts.tile ?? 8;
    const normalStrength = opts.normalStrength ?? 1.0;
    const extra = opts.uniforms ?? {};

    const uniforms = () => {
      const u = { uRepeat: { value: tile } };
      for (const [k, v] of Object.entries(extra)) u[k] = { value: v };
      return u;
    };

    const albedoRT = this._target(size, { srgb: true });
    const ormRT = this._target(size);
    const heightRT = this._target(size, { float: true });
    const normalRT = this._target(size);

    const common = `${PREAMBLE}\n${surfaceGlsl}\n`;

    // --- Albedo (direkt in sRGB geschrieben) ---
    this._run(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: `in vec3 position;\nin vec2 uv;\nout vec2 vUv;\nvoid main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
        fragmentShader: `${common}
out vec4 fragColor;
void main(){
  vec3 a; float r, m, h;
  surface(vUv, a, r, m, h);
  fragColor = vec4(a, 1.0);
}`,
        uniforms: uniforms(),
      }),
      albedoRT,
    );

    // --- ORM ---
    this._run(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: `in vec3 position;\nin vec2 uv;\nout vec2 vUv;\nvoid main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
        fragmentShader: `${common}
out vec4 fragColor;
void main(){
  vec3 a; float r, m, h;
  surface(vUv, a, r, m, h);
  fragColor = vec4(1.0, r, m, 1.0);
}`,
        uniforms: uniforms(),
      }),
      ormRT,
    );

    // --- Höhe ---
    this._run(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: `in vec3 position;\nin vec2 uv;\nout vec2 vUv;\nvoid main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
        fragmentShader: `${common}
out vec4 fragColor;
void main(){
  vec3 a; float r, m, h;
  surface(vUv, a, r, m, h);
  fragColor = vec4(h, h, h, 1.0);
}`,
        uniforms: uniforms(),
      }),
      heightRT,
    );

    // --- Normale aus der Höhe (Sobel) ---
    this._run(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: `in vec3 position;\nin vec2 uv;\nout vec2 vUv;\nvoid main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
        fragmentShader: /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uStrength;

float H(vec2 uv){ return texture(uHeight, uv).r; }

void main(){
  // Sobel über 3x3 — robuster gegen Rauschen als zentrale Differenzen
  float tl = H(vUv + uTexel*vec2(-1, 1)), t = H(vUv + uTexel*vec2(0, 1)), tr = H(vUv + uTexel*vec2(1, 1));
  float l  = H(vUv + uTexel*vec2(-1, 0)),                                  r = H(vUv + uTexel*vec2(1, 0));
  float bl = H(vUv + uTexel*vec2(-1,-1)), b = H(vUv + uTexel*vec2(0,-1)), br = H(vUv + uTexel*vec2(1,-1));

  float dx = (tr + 2.0*r + br) - (tl + 2.0*l + bl);
  float dy = (tl + 2.0*t + tr) - (bl + 2.0*b + br);

  vec3 n = normalize(vec3(-dx * uStrength, -dy * uStrength, 1.0));
  fragColor = vec4(n * 0.5 + 0.5, 1.0);
}`,
        uniforms: {
          uHeight: { value: heightRT.texture },
          uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
          uStrength: { value: normalStrength * size * 0.02 },
        },
      }),
      normalRT,
    );

    heightRT.dispose();

    return { albedo: albedoRT.texture, orm: ormRT.texture, normal: normalRT.texture, _targets: [albedoRT, ormRT, normalRT] };
  }
}

/** Wiederholung der drei Karten gemeinsam setzen. */
export function setRepeat(maps, x, y = x) {
  for (const t of [maps.albedo, maps.orm, maps.normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(x, y);
  }
  return maps;
}
