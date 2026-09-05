/**
 * Oberflächen-Definitionen. Jede liefert
 *   void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height)
 *
 * `albedo` wird direkt in sRGB geschrieben (Farben also so wählen, wie man sie
 * im Farbwähler sehen würde). `height` treibt die Normal-Map.
 *
 * `worldSize` sagt, wie viele Meter eine Kachel abdeckt — die Geometrie skaliert
 * ihre UVs danach, damit die Texeldichte überall gleich ist.
 *
 * Alle Frequenzen sind Zellenzahlen je Kachel und werden dem Rauschen zweimal
 * übergeben (Skalierung und Kachelperiode, siehe glsl-noise.js). Die höchste
 * Oktave bleibt überall unter einem Viertel der Texturauflösung — darüber wird
 * jedes Muster zu weißem Flimmern.
 */

const WOOD_BODY = /* glsl */ `
// Gemeinsamer Holzkoerper. Der Parameter g ist die Texturkoordinate so gedreht,
// dass die Faser entlang g.x laeuft. Deck und Zaun benutzen denselben Code mit
// vertauschten Achsen.
//
// Bewusst OHNE Dielenfugen: die Dielen sind echte Geometrie. Ein zweites
// Fugenmuster in der Textur legt sich sonst quer ueber die echten Fugen und
// erzeugt ein Streifenmuster, das zu nichts in der Szene passt.
void woodBody(vec2 g, out vec3 albedo, out float rough, out float metal, out float height){
  const vec2 F_GRAIN = vec2(3.0, 40.0);
  const vec2 F_TONE  = vec2(1.0, 8.0);
  const vec2 F_KNOT  = vec2(2.0, 6.0);
  const vec2 F_CRACK = vec2(2.0, 56.0);

  float grain = fbm(g * F_GRAIN, F_GRAIN, 3);

  // Jahresringe: quer zur Faser, vom Rauschen leicht verzogen
  float rings = sin((g.y * 22.0 + grain * 3.0) * 6.28318) * 0.5 + 0.5;
  rings = pow(rings, 1.7);

  // Aststellen
  vec3 vor = voronoi(g * F_KNOT, F_KNOT);
  float knot = smoothstep(0.22, 0.0, vor.x) * step(0.84, vor.y);

  // Langwellige Toenung quer zur Faser: benachbarte Bretter fallen dadurch
  // unterschiedlich aus, ohne dass die Textur wuesste, wo ein Brett endet.
  float tone = fbm(g * F_TONE, F_TONE, 2);

  vec3 light = vec3(0.58, 0.43, 0.28);
  vec3 dark  = vec3(0.31, 0.21, 0.12);
  vec3 base = mix(dark, light, 0.28 + 0.46 * rings + 0.26 * grain);
  base *= 0.82 + 0.36 * tone;
  base = mix(base, vec3(0.18, 0.11, 0.06), knot * 0.85);

  // Trockenrisse in Faserrichtung
  float crack = smoothstep(0.62, 0.86, fbm(g * F_CRACK, F_CRACK, 2));
  base = mix(base, base * 0.5, crack * 0.65);

  albedo = base;
  rough = clamp(0.58 + 0.26 * grain + 0.1 * crack - 0.08 * knot, 0.4, 0.96);
  metal = 0.0;
  height = 0.55 + 0.16 * rings + 0.1 * grain - crack * 0.26 - knot * 0.1;
}
`;

export const SURFACES = {
  /**
   * Terrassendielen. Faser entlang u — die Dielen liegen in X-Richtung und
   * werden über (x, z) projiziert.
   */
  deckWood: {
    worldSize: 2.0,
    normalStrength: 0.45,
    size: 1024,
    glsl: `${WOOD_BODY}
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  woodBody(uv, albedo, rough, metal, height);
}`,
  },

  /**
   * Zaunlatten. Dieselbe Maserung um 90 Grad gedreht: die Latten stehen
   * senkrecht und werden über (x, y) projiziert, die Faser läuft also entlang v.
   * Ohne die Drehung liefe die Maserung quer über jedes Brett.
   */
  fenceWood: {
    worldSize: 2.0,
    normalStrength: 0.45,
    size: 512,
    glsl: `${WOOD_BODY}
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  woodBody(uv.yx, albedo, rough, metal, height);
}`,
  },

  /** Ziegelmauer mit versetzten Reihen und zurückliegender Fuge. */
  brick: {
    worldSize: 2.0,
    normalStrength: 0.9,
    size: 1024,
    glsl: /* glsl */ `
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  const vec2 F_GRIT   = vec2(26.0);
  const vec2 F_MORTAR = vec2(40.0);
  const vec2 F_CHIP   = vec2(48.0);

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

  float mortar = 1.0 - band(inX, 0.028, 0.972, 0.011) * band(inY, 0.06, 0.94, 0.022);

  // Ziegelfarbe streut kräftig — das macht den Unterschied zur Tapete
  vec3 c1 = vec3(0.44, 0.23, 0.17);
  vec3 c2 = vec3(0.34, 0.18, 0.14);
  vec3 c3 = vec3(0.50, 0.31, 0.23);
  vec3 brickCol = mix(c1, c2, hash11(bid * 7.1));
  brickCol = mix(brickCol, c3, step(0.78, bid) * 0.7);

  float grit = fbm(uv * F_GRIT, F_GRIT, 3);
  brickCol *= 0.84 + 0.28 * grit;

  // Absplitterungen an den Kanten
  float edge = 1.0 - band(inX, 0.06, 0.94, 0.05) * band(inY, 0.12, 0.88, 0.09);
  float chip = smoothstep(0.58, 0.82, fbm(uv * F_CHIP, F_CHIP, 2)) * edge;

  vec3 mortarCol = vec3(0.52, 0.50, 0.46) * (0.86 + 0.26 * fbm(uv * F_MORTAR, F_MORTAR, 2));

  albedo = mix(brickCol, mortarCol, mortar);
  albedo = mix(albedo, mortarCol * 0.9, chip * 0.6);
  rough = mix(0.8 + 0.14 * grit, 0.94, mortar);
  metal = 0.0;
  height = mix(0.74 + 0.08 * grit, 0.3, mortar) - chip * 0.14;
}`,
  },

  /** Betonplatten mit Zuschlagkorn und Fugen. */
  concrete: {
    worldSize: 2.0,
    normalStrength: 0.6,
    size: 1024,
    glsl: /* glsl */ `
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  const vec2 F_GRAIN = vec2(30.0);
  const vec2 F_AGG   = vec2(56.0);
  const vec2 F_PORE  = vec2(64.0);

  float slabs = 4.0;                           // 50-cm-Platten
  vec2 g = uv * slabs;
  vec2 cell = floor(g);
  vec2 inC = fract(g);
  float sid = hash12(cell);

  float joint = 1.0 - band(inC.x, 0.02, 0.98, 0.009) * band(inC.y, 0.02, 0.98, 0.009);

  float grain = fbm(uv * F_GRAIN, F_GRAIN, 3);
  vec3 vor = voronoi(uv * F_AGG, F_AGG);
  float aggregate = smoothstep(0.16, 0.03, vor.x) * step(0.55, vor.y);

  vec3 base = vec3(0.50, 0.49, 0.46) * (0.86 + 0.24 * grain);
  base *= 0.93 + 0.14 * sid;                   // Platte zu Platte leicht anders
  base = mix(base, vec3(0.40, 0.39, 0.36), aggregate * 0.55);

  float pores = smoothstep(0.62, 0.84, fbm(uv * F_PORE, F_PORE, 2));

  vec3 jointCol = vec3(0.32, 0.31, 0.29);
  albedo = mix(base, jointCol, joint);
  albedo = mix(albedo, base * 0.62, pores * 0.5);

  rough = clamp(0.85 + 0.1 * grain - 0.05 * aggregate, 0.6, 0.99);
  metal = 0.0;
  height = mix(0.7 + 0.08 * grain + 0.06 * aggregate, 0.28, joint) - pores * 0.12;
}`,
  },

  /** Pulverbeschichtetes Metall für Gartenmöbel: Orangenhaut plus feine Kratzer. */
  paintedMetal: {
    worldSize: 0.6,
    normalStrength: 0.22,
    size: 512,
    uniforms: { uTint: [0.16, 0.20, 0.22] },
    glsl: /* glsl */ `
uniform vec3 uTint;
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  const vec2 F_PEEL    = vec2(24.0);
  const vec2 F_SCRATCH = vec2(56.0, 4.0);

  float peel = fbm(uv * F_PEEL, F_PEEL, 3);                    // Orangenhaut
  float scratch = smoothstep(0.72, 0.96, ridged(uv * F_SCRATCH, F_SCRATCH, 2));

  vec3 base = uTint * (0.9 + 0.2 * peel);
  base = mix(base, base * 2.1 + 0.1, scratch * 0.45);          // blanke Stellen

  albedo = base;
  rough = clamp(0.4 + 0.18 * peel - 0.22 * scratch, 0.12, 0.8);
  metal = mix(0.05, 0.8, scratch);
  height = 0.6 + 0.14 * peel - scratch * 0.06;
}`,
  },

  /** Kunststoff für Tonnen und Töpfe: matt, leicht genarbt. */
  plastic: {
    worldSize: 0.8,
    normalStrength: 0.26,
    size: 512,
    uniforms: { uTint: [0.13, 0.22, 0.16] },
    glsl: /* glsl */ `
uniform vec3 uTint;
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  const vec2 F_GRAIN  = vec2(36.0);
  const vec2 F_PEBBLE = vec2(28.0);

  float grain = fbm(uv * F_GRAIN, F_GRAIN, 2);
  vec3 vor = voronoi(uv * F_PEBBLE, F_PEBBLE);
  float pebble = smoothstep(0.34, 0.06, vor.x) * 0.5;          // Narbung

  albedo = uTint * (0.88 + 0.24 * grain + 0.14 * pebble);
  rough = clamp(0.52 + 0.2 * grain - 0.1 * pebble, 0.3, 0.85);
  metal = 0.0;
  height = 0.6 + 0.14 * pebble + 0.08 * grain;
}`,
  },

  /** Terrakotta für Blumentöpfe: körnig, mit Drehrillen. */
  terracotta: {
    worldSize: 0.5,
    normalStrength: 0.42,
    size: 512,
    glsl: /* glsl */ `
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  const vec2 F_GRIT  = vec2(24.0);
  const vec2 F_BLOOM = vec2(7.0);

  float ribs = sin(uv.y * 34.0 * 6.28318) * 0.5 + 0.5;         // Drehrillen
  float grit = fbm(uv * F_GRIT, F_GRIT, 3);

  vec3 base = vec3(0.56, 0.31, 0.20) * (0.84 + 0.26 * grit);
  base = mix(base, vec3(0.64, 0.40, 0.27), ribs * 0.16);

  // Kalkschleier vom Gießen
  float bloom = smoothstep(0.55, 0.85, fbm(uv * F_BLOOM, F_BLOOM, 3));
  base = mix(base, vec3(0.72, 0.69, 0.64), bloom * 0.35);

  albedo = base;
  rough = clamp(0.82 + 0.12 * grit, 0.6, 0.98);
  metal = 0.0;
  height = 0.6 + 0.1 * grit + ribs * 0.05;
}`,
  },

  /** Gewebe für Sitzflächen. */
  fabric: {
    worldSize: 0.4,
    normalStrength: 0.35,
    size: 512,
    uniforms: { uTint: [0.13, 0.16, 0.21] },
    glsl: /* glsl */ `
uniform vec3 uTint;
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  const vec2 F_FUZZ = vec2(40.0);

  // Leinwandbindung: zwei versetzte Rippenrichtungen
  float threads = 44.0;
  float wx = sin(uv.x * threads * 6.28318) * 0.5 + 0.5;
  float wy = sin(uv.y * threads * 6.28318) * 0.5 + 0.5;
  float weave = mix(wx, wy, step(0.5, fract((uv.x + uv.y) * threads * 0.5)));
  float fuzz = fbm(uv * F_FUZZ, F_FUZZ, 2);

  albedo = uTint * (0.82 + 0.3 * weave + 0.2 * fuzz);
  rough = clamp(0.88 + 0.08 * fuzz - 0.06 * weave, 0.7, 0.99);
  metal = 0.0;
  height = 0.5 + 0.3 * weave + 0.1 * fuzz;
}`,
  },

  /** Erde/Kies rund um die Terrasse. */
  soil: {
    worldSize: 2.0,
    normalStrength: 0.7,
    size: 512,
    glsl: /* glsl */ `
void surface(vec2 uv, out vec3 albedo, out float rough, out float metal, out float height){
  const vec2 F_STONE  = vec2(30.0);
  const vec2 F_COARSE = vec2(9.0);

  vec3 vor = voronoi(uv * F_STONE, F_STONE);
  float stones = smoothstep(0.3, 0.05, vor.x);
  float coarse = fbm(uv * F_COARSE, F_COARSE, 3);

  vec3 earth = mix(vec3(0.22, 0.17, 0.11), vec3(0.32, 0.25, 0.17), coarse);
  vec3 stone = mix(vec3(0.42, 0.40, 0.37), vec3(0.28, 0.27, 0.25), hash11(vor.y * 5.0));
  albedo = mix(earth, stone, stones * 0.75);

  rough = clamp(0.92 - 0.12 * stones, 0.7, 1.0);
  metal = 0.0;
  height = 0.45 + 0.25 * coarse + stones * 0.22;
}`,
  },
};
