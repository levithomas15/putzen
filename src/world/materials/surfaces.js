/**
 * Oberflächen-Definitionen. Jede liefert
 *   void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height)
 *
 * `albedo` wird direkt in sRGB geschrieben (Farben also so wählen, wie man sie
 * im Farbwähler sehen würde). `height` treibt die Normal-Map.
 *
 * `worldSize` sagt, wie viele Meter eine Kachel abdeckt — die Geometrie skaliert
 * ihre UVs danach, damit die Texeldichte überall gleich ist.
 */

export const SURFACES = {
  /** Terrassendielen: Maserung, Aststellen, Fugen, verschraubte Enden. */
  deckWood: {
    worldSize: 2.0,
    tile: 8,
    normalStrength: 0.55,
    size: 1024,
    glsl: /* glsl */ `
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  float plankW = 1.0 / 7.0;                 // 7 Dielen je Kachel -> ~28 cm
  float row = floor(uv.y / plankW);
  float inRow = fract(uv.y / plankW);

  // Jede Diele bekommt eigenen Versatz und eigene Tönung
  float pid = hash11(row * 13.7);
  float uShift = pid * 0.37;
  vec2 p = vec2(uv.x + uShift, inRow);

  // Maserung: stark in Faserrichtung gestreckt
  float grain = fbm(vec2(p.x * 5.0, p.y * 34.0) * uRepeat, 5, uRepeat);
  float rings = sin((p.y * 9.0 + grain * 3.4) * 6.28318) * 0.5 + 0.5;
  rings = pow(rings, 1.8);

  // Aststellen
  vec3 vor = voronoi(vec2(p.x * 3.0, p.y * 1.2) * uRepeat, uRepeat * 3.0);
  float knot = smoothstep(0.24, 0.0, vor.x) * step(0.82, vor.y);

  vec3 light = vec3(0.62, 0.46, 0.31);
  vec3 dark  = vec3(0.38, 0.26, 0.16);
  vec3 base = mix(dark, light, 0.35 + 0.5 * rings + 0.22 * grain);
  base *= 0.86 + 0.28 * pid;                 // Diele zu Diele unterschiedlich
  base = mix(base, vec3(0.20, 0.13, 0.08), knot * 0.85);

  // Fuge zwischen den Dielen
  float gap = 1.0 - band(inRow, 0.045, 0.955, 0.012);
  base = mix(base, vec3(0.09, 0.07, 0.05), gap * 0.92);

  // Schraubenköpfe an den Dielenenden
  float sx = fract(uv.x * 4.0);
  float screwR = length(vec2((sx - 0.5) * 1.6, (inRow - 0.5) * 0.62));
  float screw = smoothstep(0.09, 0.055, screwR);
  base = mix(base, vec3(0.30, 0.29, 0.28), screw * 0.8);

  albedo = base;
  rough = clamp(0.62 + 0.22 * grain + 0.16 * gap - 0.1 * knot, 0.35, 0.95);
  metal = 0.0;
  height = 0.55 + 0.16 * rings + 0.1 * grain - gap * 0.85 - screw * 0.28 - knot * 0.12;
}`,
  },

  /** Ziegelmauer mit versetzten Reihen und zurückliegender Fuge. */
  brick: {
    worldSize: 2.0,
    tile: 8,
    normalStrength: 1.0,
    size: 1024,
    glsl: /* glsl */ `
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  float rows = 12.0;                          // ~16 cm je Schicht
  float ry = uv.y * rows;
  float row = floor(ry);
  float inY = fract(ry);

  float offset = mod(row, 2.0) * 0.5;         // Läuferverband
  float cols = 4.0;
  float rx = uv.x * cols + offset;
  float col = floor(rx);
  float inX = fract(rx);

  float bid = hash12(vec2(col, row));

  // Fugenbreite in Ziegel-Einheiten
  float mortar = 1.0 - band(inX, 0.028, 0.972, 0.011) * band(inY, 0.06, 0.94, 0.022);

  // Ziegelfarbe streut kräftig — das macht den Unterschied zur Tapete
  vec3 c1 = vec3(0.55, 0.24, 0.17);
  vec3 c2 = vec3(0.42, 0.19, 0.15);
  vec3 c3 = vec3(0.61, 0.35, 0.24);
  vec3 brickCol = mix(c1, c2, hash11(bid * 7.1));
  brickCol = mix(brickCol, c3, step(0.78, bid) * 0.7);

  // Oberflächenstruktur des Ziegels
  float grit = fbm(uv * 28.0 * uRepeat, 4, uRepeat * 28.0);
  brickCol *= 0.82 + 0.32 * grit;

  // Absplitterungen an den Kanten
  float edge = 1.0 - band(inX, 0.06, 0.94, 0.05) * band(inY, 0.12, 0.88, 0.09);
  float chip = smoothstep(0.55, 0.85, fbm(uv * 60.0 * uRepeat, 3, uRepeat * 60.0)) * edge;

  vec3 mortarCol = vec3(0.63, 0.61, 0.56) * (0.82 + 0.3 * fbm(uv * 45.0 * uRepeat, 3, uRepeat * 45.0));

  albedo = mix(brickCol, mortarCol, mortar);
  albedo = mix(albedo, mortarCol * 0.9, chip * 0.6);
  rough = mix(0.78 + 0.15 * grit, 0.94, mortar);
  metal = 0.0;
  height = mix(0.72 + 0.09 * grit, 0.3, mortar) - chip * 0.14;
}`,
  },

  /** Betonplatten mit Zuschlagkorn und Fugen. */
  concrete: {
    worldSize: 2.0,
    tile: 6,
    normalStrength: 0.7,
    size: 1024,
    glsl: /* glsl */ `
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  float slabs = 4.0;                           // 50-cm-Platten
  vec2 g = uv * slabs;
  vec2 cell = floor(g);
  vec2 inC = fract(g);
  float sid = hash12(cell);

  float joint = 1.0 - band(inC.x, 0.02, 0.98, 0.009) * band(inC.y, 0.02, 0.98, 0.009);

  float grain = fbm(uv * 40.0 * uRepeat, 5, uRepeat * 40.0);
  vec3 vor = voronoi(uv * 90.0 * uRepeat, uRepeat * 90.0);
  float aggregate = smoothstep(0.14, 0.02, vor.x) * step(0.55, vor.y);

  vec3 base = vec3(0.52, 0.51, 0.48) * (0.86 + 0.24 * grain);
  base *= 0.93 + 0.14 * sid;                   // Platte zu Platte leicht anders
  base = mix(base, vec3(0.42, 0.41, 0.38), aggregate * 0.55);

  // Lufteinschlüsse
  float pores = smoothstep(0.74, 0.9, fbm(uv * 130.0 * uRepeat, 3, uRepeat * 130.0));

  vec3 jointCol = vec3(0.34, 0.33, 0.30);
  albedo = mix(base, jointCol, joint);
  albedo = mix(albedo, base * 0.6, pores * 0.5);

  rough = clamp(0.84 + 0.1 * grain - 0.05 * aggregate, 0.6, 0.99);
  metal = 0.0;
  height = mix(0.7 + 0.08 * grain + 0.05 * aggregate, 0.28, joint) - pores * 0.12;
}`,
  },

  /** Pulverbeschichtetes Metall für Gartenmöbel: Orangenhaut plus feine Kratzer. */
  paintedMetal: {
    worldSize: 0.6,
    tile: 4,
    normalStrength: 0.28,
    size: 512,
    uniforms: { uTint: [0.16, 0.20, 0.22] },
    glsl: /* glsl */ `
uniform vec3 uTint;
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  float peel = fbm(uv * 70.0 * uRepeat, 4, uRepeat * 70.0);      // Orangenhaut
  float scratch = smoothstep(0.62, 0.98, ridged(vec2(uv.x * 130.0, uv.y * 6.0) * uRepeat, 3, uRepeat * 130.0));

  vec3 base = uTint * (0.9 + 0.18 * peel);
  base = mix(base, base * 1.9 + 0.12, scratch * 0.4);            // blanke Stellen

  albedo = base;
  rough = clamp(0.42 + 0.16 * peel - 0.22 * scratch, 0.12, 0.8);
  metal = mix(0.05, 0.75, scratch);
  height = 0.6 + 0.16 * peel - scratch * 0.06;
}`,
  },

  /** Kunststoff für Tonnen und Töpfe: matt, leicht genarbt. */
  plastic: {
    worldSize: 0.8,
    tile: 4,
    normalStrength: 0.3,
    size: 512,
    uniforms: { uTint: [0.18, 0.30, 0.22] },
    glsl: /* glsl */ `
uniform vec3 uTint;
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  float grain = fbm(uv * 110.0 * uRepeat, 3, uRepeat * 110.0);
  vec3 vor = voronoi(uv * 60.0 * uRepeat, uRepeat * 60.0);
  float pebble = smoothstep(0.3, 0.05, vor.x) * 0.5;             // Narbung

  albedo = uTint * (0.88 + 0.2 * grain + 0.12 * pebble);
  rough = clamp(0.55 + 0.2 * grain - 0.1 * pebble, 0.3, 0.85);
  metal = 0.0;
  height = 0.6 + 0.14 * pebble + 0.08 * grain;
}`,
  },

  /** Terrakotta für Blumentöpfe: körnig, mit Drehrillen. */
  terracotta: {
    worldSize: 0.5,
    tile: 4,
    normalStrength: 0.5,
    size: 512,
    glsl: /* glsl */ `
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  float ribs = sin(uv.y * 48.0 * 6.28318) * 0.5 + 0.5;           // Drehrillen
  float grit = fbm(uv * 80.0 * uRepeat, 4, uRepeat * 80.0);
  vec3 base = vec3(0.62, 0.34, 0.22) * (0.82 + 0.3 * grit);
  base = mix(base, vec3(0.70, 0.44, 0.30), ribs * 0.16);

  // Kalkschleier vom Gießen
  float bloom = smoothstep(0.55, 0.9, fbm(uv * 12.0 * uRepeat, 4, uRepeat * 12.0));
  base = mix(base, vec3(0.78, 0.75, 0.70), bloom * 0.35);

  albedo = base;
  rough = clamp(0.8 + 0.14 * grit, 0.6, 0.98);
  metal = 0.0;
  height = 0.6 + 0.1 * grit + ribs * 0.05;
}`,
  },

  /** Gewebe für Sitzflächen. */
  fabric: {
    worldSize: 0.4,
    tile: 4,
    normalStrength: 0.45,
    size: 512,
    uniforms: { uTint: [0.22, 0.26, 0.32] },
    glsl: /* glsl */ `
uniform vec3 uTint;
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  // Leinwandbindung: zwei versetzte Rippenrichtungen
  float wx = sin(uv.x * 160.0 * 6.28318) * 0.5 + 0.5;
  float wy = sin(uv.y * 160.0 * 6.28318) * 0.5 + 0.5;
  float weave = mix(wx, wy, step(0.5, fract(uv.x * 80.0 + uv.y * 80.0)));
  float fuzz = fbm(uv * 200.0 * uRepeat, 3, uRepeat * 200.0);

  albedo = uTint * (0.8 + 0.3 * weave + 0.18 * fuzz);
  rough = clamp(0.88 + 0.08 * fuzz - 0.06 * weave, 0.7, 0.99);
  metal = 0.0;
  height = 0.5 + 0.3 * weave + 0.1 * fuzz;
}`,
  },

  /** Erde/Kies rund um die Terrasse. */
  soil: {
    worldSize: 2.0,
    tile: 6,
    normalStrength: 0.8,
    size: 512,
    glsl: /* glsl */ `
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  vec3 vor = voronoi(uv * 55.0 * uRepeat, uRepeat * 55.0);
  float stones = smoothstep(0.26, 0.04, vor.x);
  float coarse = fbm(uv * 14.0 * uRepeat, 5, uRepeat * 14.0);

  vec3 earth = mix(vec3(0.24, 0.18, 0.12), vec3(0.34, 0.27, 0.19), coarse);
  vec3 stone = mix(vec3(0.44, 0.42, 0.39), vec3(0.30, 0.29, 0.27), hash11(vor.y * 5.0));
  albedo = mix(earth, stone, stones * 0.8);

  rough = clamp(0.92 - 0.12 * stones, 0.7, 1.0);
  metal = 0.0;
  height = 0.45 + 0.25 * coarse + stones * 0.22;
}`,
  },
};
