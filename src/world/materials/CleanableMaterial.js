import * as THREE from 'three';

/**
 * Macht ein MeshStandardMaterial putzbar.
 *
 * Statt ein eigenes Material zu schreiben, wird das eingebaute per
 * `onBeforeCompile` erweitert — so bleiben PBR, Umgebungslicht, Schatten und
 * Nebel vollständig erhalten.
 *
 * Die Maske liefert drei Kanäle:
 *   R = Dreck (1 voll, 0 sauber)
 *   G = Nässe (frisch abgespritzt, trocknet weg)
 *   B = Grime-Variation (statisch: Algen, Streifen, Flecken)
 *
 * Die Maske wird über ein eigenes UV-Attribut `aMaskUv` gelesen (die
 * eindeutige Abwicklung), während die gekachelten PBR-Karten weiter das normale
 * `uv` benutzen. Zwei getrennte UV-Sätze, kein Konflikt mit three.
 */

const DIRT_PARS = /* glsl */ `
uniform sampler2D uMask;
uniform vec3  uDirtColor;
uniform vec3  uAlgaeColor;
uniform float uDirtRoughness;
uniform float uDirtNoiseScale;
uniform float uDirtContrast;
uniform float uWetDarken;
uniform float uWetGloss;
uniform float uMaskDebug;
varying vec2 vMaskUv;

float pz_hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float pz_noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(pz_hash(i), pz_hash(i+vec2(1,0)), u.x),
             mix(pz_hash(i+vec2(0,1)), pz_hash(i+vec2(1,1)), u.x), u.y);
}
float pz_fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<4;i++){ s += a * pz_noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

/**
 * Wie viel Dreck liegt hier wirklich?
 * Der Maskenwert wird durch ein Rauschmuster geschickt, damit sich der Dreck
 * fleckig auflöst statt gleichmäßig auszublenden — das ist der Unterschied
 * zwischen "Regler wird kleiner" und "Dreck geht weg".
 */
float pz_dirtAmount(float mask, vec2 uv){
  float n = pz_fbm(uv * uDirtNoiseScale);
  float threshold = mix(0.18, 0.82, n);
  return clamp((mask - threshold) * uDirtContrast + 0.5, 0.0, 1.0) * step(0.004, mask);
}
`;

const DIRT_ALBEDO = /* glsl */ `
  vec4 pzMask = texture2D(uMask, vMaskUv);
  float pzDirtRaw = pzMask.r;
  float pzWet = pzMask.g;
  float pzVar = pzMask.b;

  float pzDirt = pz_dirtAmount(pzDirtRaw, vMapUv);

  // Grober Schmutz plus grünliche Algen in den feuchten Ecken
  float pzGrime = pz_fbm(vMapUv * uDirtNoiseScale * 0.45);
  vec3 pzDirtCol = mix(uDirtColor, uAlgaeColor, clamp(pzVar * 1.4 - 0.15, 0.0, 1.0));
  pzDirtCol *= 0.72 + 0.5 * pzGrime;

  diffuseColor.rgb = mix(diffuseColor.rgb, pzDirtCol, pzDirt * 0.86);

  // Nass: dunkler und tiefer gesättigt, wie echtes Wasser auf Stein
  diffuseColor.rgb *= mix(1.0, uWetDarken, pzWet);

  if (uMaskDebug > 0.5) diffuseColor.rgb = vec3(pzDirtRaw, pzWet, pzVar);
`;

const DIRT_ROUGH = /* glsl */ `
  roughnessFactor = mix(roughnessFactor, uDirtRoughness, pzDirt * 0.9);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * uWetGloss, pzWet);
  roughnessFactor = clamp(roughnessFactor, 0.02, 1.0);
`;

// Dreck sitzt als Kruste auf der Oberfläche — eine leichte Normalenstörung
// verkauft das deutlich besser als reine Farbänderung.
const DIRT_NORMAL = /* glsl */ `
  {
    float e = 0.0035;
    vec2 duv = vMapUv * uDirtNoiseScale * 1.7;
    float h0 = pz_fbm(duv);
    float hx = pz_fbm(duv + vec2(e * uDirtNoiseScale, 0.0));
    float hy = pz_fbm(duv + vec2(0.0, e * uDirtNoiseScale));
    vec3 crust = normalize(vec3(-(hx - h0), -(hy - h0), 0.12));
    normal = normalize(mix(normal, normalize(normal + crust * 0.55), pzDirt * 0.7));
  }
`;

export const DIRT_DEFAULTS = {
  dirtColor: 0x4a4033,
  algaeColor: 0x44502a,
  dirtRoughness: 0.96,
  dirtNoiseScale: 14,
  dirtContrast: 2.4,
  wetDarken: 0.68,
  wetGloss: 0.22,
};

/**
 * Erweitert ein Material. Gibt das Material zurück; die Uniforms hängen unter
 * `material.userData.dirtUniforms` und können pro Mesh gesetzt werden.
 */
export function makeCleanable(material, opts = {}) {
  const o = { ...DIRT_DEFAULTS, ...opts };

  const uniforms = {
    uMask: { value: opts.mask ?? null },
    uDirtColor: { value: new THREE.Color(o.dirtColor) },
    uAlgaeColor: { value: new THREE.Color(o.algaeColor) },
    uDirtRoughness: { value: o.dirtRoughness },
    uDirtNoiseScale: { value: o.dirtNoiseScale },
    uDirtContrast: { value: o.dirtContrast },
    uWetDarken: { value: o.wetDarken },
    uWetGloss: { value: o.wetGloss },
    uMaskDebug: { value: 0 },
  };

  material.userData.dirtUniforms = uniforms;
  material.userData.cleanable = true;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aMaskUv;
varying vec2 vMaskUv;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vMaskUv = aMaskUv;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DIRT_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${DIRT_ALBEDO}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${DIRT_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${DIRT_NORMAL}`);

    material.userData.shader = shader;
  };

  // Alle putzbaren Materialien teilen sich ein Programm.
  material.customProgramCacheKey = () => 'putzen-cleanable';

  return material;
}

/** Maske eines Materials setzen (nach dem Klonen pro Mesh). */
export function setMask(material, texture) {
  const u = material.userData.dirtUniforms;
  if (u) u.uMask.value = texture;
}
