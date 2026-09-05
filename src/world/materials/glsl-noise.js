/**
 * Gemeinsame GLSL-Bausteine für die prozeduralen Texturen.
 * Alles hash-basiert — keine Rauschtexturen, keine Dateien.
 */
export const NOISE_GLSL = /* glsl */ `
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2  hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }

// Wertrauschen mit weicher Interpolation
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x),
             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
}

// Kachelbares Wertrauschen: die Gitterzellen werden modulo period gelesen.
float vnoiseTiled(vec2 p, float period){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  vec2 a = mod(i, period), b = mod(i+vec2(1,0), period);
  vec2 c = mod(i+vec2(0,1), period), d = mod(i+vec2(1,1), period);
  return mix(mix(hash12(a), hash12(b), u.x), mix(hash12(c), hash12(d), u.x), u.y);
}

float fbm(vec2 p, int octaves, float period){
  float sum = 0.0, amp = 0.5, per = period;
  for(int i=0;i<8;i++){
    if(i>=octaves) break;
    sum += amp * vnoiseTiled(p, per);
    p *= 2.0; per *= 2.0; amp *= 0.5;
  }
  return sum;
}

float ridged(vec2 p, int octaves, float period){
  float sum = 0.0, amp = 0.5, per = period;
  for(int i=0;i<8;i++){
    if(i>=octaves) break;
    sum += amp * (1.0 - abs(vnoiseTiled(p, per)*2.0-1.0));
    p *= 2.0; per *= 2.0; amp *= 0.5;
  }
  return sum;
}

// Voronoi: x = Abstand zur nächsten Zelle, y = Zell-Zufallswert, z = Kantennähe
vec3 voronoi(vec2 p, float period){
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(mod(n+g, period));
    float d = length(g + o - f);
    if(d < d1){ d2 = d1; d1 = d; id = hash12(mod(n+g, period)); }
    else if(d < d2){ d2 = d; }
  }
  return vec3(d1, id, d2-d1);
}

vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz)*6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Weiche Stufenkante mit fester Breite in UV-Einheiten
float band(float x, float lo, float hi, float soft){
  return smoothstep(lo-soft, lo+soft, x) * (1.0 - smoothstep(hi-soft, hi+soft, x));
}
`;
