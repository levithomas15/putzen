/**
 * Gemeinsame GLSL-Bausteine für die prozeduralen Texturen.
 * Alles hash-basiert — keine Rauschtexturen, keine Dateien.
 *
 * Aufrufkonvention: die Frequenz wird als **Zellenzahl je Kachel** angegeben
 * und zweimal übergeben — einmal zum Skalieren der Koordinate, einmal als
 * Kachelperiode:
 *
 *     float n = fbm(uv * F, F, 3);      // F = vec2(24.0, 24.0)
 *
 * Beides muss übereinstimmen, sonst kachelt das Rauschen nicht nahtlos. Die
 * Periode ist ein vec2, damit auch stark gestreckte Muster (Holzmaserung,
 * Schleifspuren) sauber umlaufen.
 *
 * Faustregel gegen Flimmern: die höchste Oktave, also `F * 2^(oktaven-1)`,
 * sollte höchstens ein Viertel der Texturauflösung erreichen. Darüber liegt
 * das Muster unter der Abtastgrenze und wird zu weißem Rauschen.
 */
export const NOISE_GLSL = /* glsl */ `
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2  hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }

/** Kachelndes Wertrauschen. period ist die Zellenzahl, ueber die es umlaeuft. */
float vnoise(vec2 p, vec2 period){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  vec2 a = mod(i, period);
  vec2 b = mod(i + vec2(1.0, 0.0), period);
  vec2 c = mod(i + vec2(0.0, 1.0), period);
  vec2 d = mod(i + vec2(1.0, 1.0), period);
  return mix(mix(hash12(a), hash12(b), u.x),
             mix(hash12(c), hash12(d), u.x), u.y);
}

float fbm(vec2 p, vec2 period, int octaves){
  float sum = 0.0, amp = 0.5, norm = 0.0;
  vec2 per = period;
  for(int i=0;i<6;i++){
    if(i>=octaves) break;
    sum += amp * vnoise(p, per);
    norm += amp;
    p *= 2.0; per *= 2.0; amp *= 0.5;
  }
  return sum / max(norm, 1e-5);
}

/** Gratrauschen — für Kratzer und Fasern. */
float ridged(vec2 p, vec2 period, int octaves){
  float sum = 0.0, amp = 0.5, norm = 0.0;
  vec2 per = period;
  for(int i=0;i<6;i++){
    if(i>=octaves) break;
    sum += amp * (1.0 - abs(vnoise(p, per) * 2.0 - 1.0));
    norm += amp;
    p *= 2.0; per *= 2.0; amp *= 0.5;
  }
  return sum / max(norm, 1e-5);
}

/** Voronoi: x = Abstand zur nächsten Zelle, y = Zell-Zufallswert, z = Kantennähe */
vec3 voronoi(vec2 p, vec2 period){
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i), float(j));
    vec2 cell = mod(n + g, period);
    vec2 o = hash22(cell);
    float d = length(g + o - f);
    if(d < d1){ d2 = d1; d1 = d; id = hash12(cell); }
    else if(d < d2){ d2 = d; }
  }
  return vec3(d1, id, d2 - d1);
}

vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz)*6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

/** Weiche Stufenkante mit fester Breite in UV-Einheiten */
float band(float x, float lo, float hi, float soft){
  return smoothstep(lo-soft, lo+soft, x) * (1.0 - smoothstep(hi-soft, hi+soft, x));
}
`;
