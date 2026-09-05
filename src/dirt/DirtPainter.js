import * as THREE from 'three';

/**
 * Malt in die Dreckmasken.
 *
 * Kernidee: Das Mesh wird in seine eigene Maske gerendert, wobei **die UVs als
 * Bildschirmposition** dienen und der Fragment-Shader die **Weltposition**
 * interpoliert bekommt. Damit rechnet jedes Texel seinen echten Abstand zum
 * Wasserstrahl aus.
 *
 * Der Umweg lohnt sich: Ein einzelner Raycast-Treffer würde nur einen Punkt
 * setzen — der Strahl zöge eine dünne Linie, die an jeder UV-Naht und jeder
 * Kante abreißt. Über die Weltposition entsteht der korrekte, unverzerrte
 * Fußabdruck, auch über Nähte und um Ecken herum.
 */

// Gemeinsamer Vertex-Shader für alle Durchgänge im UV-Raum.
const UV_VERT = /* glsl */ `
attribute vec2 aMaskUv;
attribute vec2 aUvCentroid;

uniform vec2  uTexel;
uniform float uExpand;   // Aufweitung in Texeln gegen Nahtlinien

varying vec3 vWorld;
varying vec3 vNormalW;

void main(){
  vec2 muv = aMaskUv;

  // Dreieck um wenige Texel aufweiten. Ohne das bleiben an jeder Atlasnaht
  // feine Dreckstreifen stehen, weil die Randtexel nie getroffen werden.
  vec2 dir = muv - aUvCentroid;
  float len = length(dir);
  if (len > 1e-6) muv += (dir / len) * uTexel * uExpand;

  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);

  gl_Position = vec4(muv * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Startdreck.
 * Dreck sammelt sich nicht gleichmäßig: waagerechte Flächen fangen mehr ab,
 * Bodennähe bringt Algen, unter Kanten laufen Streifen herunter.
 */
const SEED_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormalW;

uniform float uAmount;
uniform float uSeed;
uniform float uGroundY;
uniform float uStreaks;
uniform vec3  uCenter;
uniform float uCullCenter;

float h13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

float n3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = mix(mix(h13(i+vec3(0,0,0)), h13(i+vec3(1,0,0)), f.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), f.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}

/**
 * Eine einzige Oktavkette, aus der alle Anteile gezogen werden.
 * Getrennte fbm-Aufrufe je Effekt wären deutlich teurer — beim Laden auf
 * schwacher Hardware macht das den Unterschied zwischen einer halben Sekunde
 * und mehreren Sekunden pro Fläche.
 *   x = grobe Struktur, y = feine Struktur
 */
vec2 fbmSplit(vec3 p){
  float low = 0.0, high = 0.0, a = 0.5;
  for(int i=0;i<5;i++){
    float v = a * n3(p);
    if (i < 2) low += v; else high += v;
    p *= 2.03; a *= 0.5;
  }
  return vec2(low * 1.35, high * 3.1);
}

void main(){
  vec3 p = vWorld + uSeed;

  vec2 f = fbmSplit(p * 1.7);
  float base = f.x;
  float fine = f.y;

  // Waagerechte Flächen setzen deutlich mehr an
  float up = clamp(vNormalW.y, 0.0, 1.0);
  float horizontal = mix(0.35, 1.0, pow(up, 0.7));

  // Bodennähe: Algen und Erdspritzer
  float low = 1.0 - smoothstep(0.0, 0.85, vWorld.y - uGroundY);
  float splash = smoothstep(0.42, 0.8, n3(vec3(p.x * 4.0, p.y * 12.0, p.z * 4.0))) * low;

  // Regenstreifen an senkrechten Flächen: in der Höhe gestreckt,
  // damit sie wie herunterlaufendes Wasser aussehen
  float vertical = 1.0 - abs(vNormalW.y);
  float streak = n3(vec3(p.x * 7.0, p.y * 0.55, p.z * 7.0)) * 0.65
               + n3(vec3(p.x * 15.0, p.y * 1.1, p.z * 15.0)) * 0.35;
  streak = smoothstep(0.44, 0.72, streak) * vertical * uStreaks;

  float dirt = base * 0.62 + fine * 0.30;
  dirt = dirt * horizontal + streak * 0.45 + splash * 0.5 + low * 0.22;
  dirt = clamp(dirt * uAmount, 0.0, 1.0);

  // Unerreichbare Flächen bekommen keinen Dreck.
  //
  // Sonst säße Schmutz dort, wo der Strahl nie hinkommt, und die Anzeige bliebe
  // für immer unter 100 % hängen. Weil der Fortschritt gegen den Startwert
  // normiert wird, fallen solche Flächen so sauber aus der Rechnung heraus.
  vec3 n = normalize(vNormalW);

  // Gilt immer: was nach unten zeigt, steht auf dem Boden.
  float reach = smoothstep(-0.55, -0.15, n.y);

  // Nur für umschließende Flächen — Mauern, Deck, Weg, Zaun. Deren Rückseite
  // ist von innen nie zu sehen. Bei freistehenden Gegenständen darf diese Regel
  // nicht greifen: ein Blumentopf am Rand verlöre sonst ausgerechnet die Seite,
  // die dem Spieler zugewandt ist, weil sie vom Szenenmittelpunkt wegzeigt.
  if (uCullCenter > 0.5) {
    vec3 toCenter = normalize(uCenter - vWorld);
    reach = min(reach, smoothstep(-0.3, 0.1, dot(n, toCenter)));
  }

  dirt *= reach;

  // Variationskanal: steuert später Algengrün gegen braunen Schmutz
  float variation = clamp(low * 0.75 + base * 0.75 - 0.12, 0.0, 1.0);

  gl_FragColor = vec4(dirt, variation, 0.0, 0.0);
}
`;

/** Der eigentliche Wasserstrahl. */
const PAINT_FRAG = /* glsl */ `
precision highp float;
#include <packing>

varying vec3 vWorld;
varying vec3 vNormalW;

uniform vec3  uOrigin;
uniform vec3  uDir;
uniform float uRange;
uniform float uRadius;     // Strahlradius an der Düse
uniform float uSpread;     // Zuwachs je Meter
uniform float uPower;      // Abtrag je Sekunde bei voller Wirkung
uniform float uWetGain;
uniform float uDt;

uniform sampler2D uJetDepth;
uniform mat4 uJetMatrix;
uniform float uUseDepth;

void main(){
  vec3 toP = vWorld - uOrigin;
  float t = dot(toP, uDir);
  if (t < 0.04 || t > uRange) discard;

  float dist = length(toP - uDir * t);
  float radius = uRadius + t * uSpread;
  if (dist > radius) discard;

  // Weiches Strahlprofil: innen voll, zum Rand auslaufend
  float profile = 1.0 - smoothstep(radius * 0.22, radius, dist);
  profile = pow(profile, 1.4);

  // Streifender Auftreffwinkel trägt weniger ab
  float incidence = max(dot(-uDir, normalize(vNormalW)), 0.0);
  incidence = pow(incidence, 0.65);
  if (incidence <= 0.001) discard;

  // Druckverlust über die Entfernung
  float atten = 1.0 - 0.75 * smoothstep(uRange * 0.35, uRange, t);

  // Verdeckung: liegt etwas zwischen Düse und diesem Punkt?
  if (uUseDepth > 0.5) {
    vec4 clip = uJetMatrix * vec4(vWorld, 1.0);
    if (clip.w > 0.0) {
      vec3 ndc = clip.xyz / clip.w;
      vec2 duv = ndc.xy * 0.5 + 0.5;
      if (all(greaterThanEqual(duv, vec2(0.0))) && all(lessThanEqual(duv, vec2(1.0)))) {
        float sceneDist = unpackRGBAToDepth(texture2D(uJetDepth, duv)) * uRange;
        if (length(toP) > sceneDist + 0.09) discard;
      }
    }
  }

  float strength = uPower * profile * incidence * atten * uDt;

  // RGB wird abgezogen (Dreck geht weg), Alpha addiert (Nässe kommt dazu).
  gl_FragColor = vec4(strength, 0.0, 0.0, uWetGain * profile * uDt);
}
`;

/** Abtrocknen: zieht Nässe ab, lässt RGB unangetastet. */
const DECAY_FRAG = /* glsl */ `
precision highp float;
uniform float uAmount;
void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, uAmount); }
`;

/** Entfernung zur Düse, für die Verdeckungsprüfung. */
const JETDEPTH_VERT = /* glsl */ `
varying float vDist;
uniform vec3 uOrigin;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDist = length(wp.xyz - uOrigin);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const JETDEPTH_FRAG = /* glsl */ `
#include <packing>
varying float vDist;
uniform float uRange;
void main(){ gl_FragColor = packDepthToRGBA(clamp(vDist / uRange, 0.0, 1.0)); }
`;

const DEPTH_SIZE = 512;

export class DirtPainter {
  constructor(renderer) {
    this.renderer = renderer;
    this.dummyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const common = {
      uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      uExpand: { value: 1.6 },
    };

    this.seedMaterial = new THREE.ShaderMaterial({
      vertexShader: UV_VERT,
      fragmentShader: SEED_FRAG,
      uniforms: {
        ...common,
        uAmount: { value: 1.0 },
        uSeed: { value: 0.0 },
        uGroundY: { value: 0.0 },
        uStreaks: { value: 1.0 },
        uCenter: { value: new THREE.Vector3(0, 1.2, 0) },
        uCullCenter: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.paintMaterial = new THREE.ShaderMaterial({
      vertexShader: UV_VERT,
      fragmentShader: PAINT_FRAG,
      uniforms: {
        ...common,
        uOrigin: { value: new THREE.Vector3() },
        uDir: { value: new THREE.Vector3(0, 0, -1) },
        uRange: { value: 9 },
        uRadius: { value: 0.02 },
        uSpread: { value: 0.035 },
        uPower: { value: 1.6 },
        uWetGain: { value: 2.4 },
        uDt: { value: 0.016 },
        uJetDepth: { value: null },
        uJetMatrix: { value: new THREE.Matrix4() },
        uUseDepth: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.CustomBlending,
      // RGB: Ziel minus Quelle -> Dreck wird abgetragen
      blendEquation: THREE.ReverseSubtractEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      // Alpha: Ziel plus Quelle -> Nässe sammelt sich an
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });

    this.decayMaterial = new THREE.ShaderMaterial({
      vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: DECAY_FRAG,
      uniforms: { uAmount: { value: 0.01 } },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.ReverseSubtractEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.ReverseSubtractEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.decayQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.decayMaterial);
    this.decayQuad.frustumCulled = false;

    // --- Tiefenkarte aus Sicht der Düse ---
    this.jetCamera = new THREE.PerspectiveCamera(50, 1, 0.05, 20);
    this.jetDepthTarget = new THREE.WebGLRenderTarget(DEPTH_SIZE, DEPTH_SIZE, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      colorSpace: THREE.NoColorSpace,
    });
    this.jetDepthMaterial = new THREE.ShaderMaterial({
      vertexShader: JETDEPTH_VERT,
      fragmentShader: JETDEPTH_FRAG,
      uniforms: { uOrigin: { value: new THREE.Vector3() }, uRange: { value: 9 } },
      side: THREE.DoubleSide,
    });

    // Eigene Szene für den Tiefendurchgang.
    //
    // three wertet `overrideMaterial` ausschließlich auf einer echten Scene aus
    // (`scene.isScene === true`). Setzt man es auf eine Group, wird es
    // stillschweigend ignoriert — die Tiefenkarte enthielte dann die normalen
    // Farbmaterialien, und die Entfernungen, die der Malshader daraus liest,
    // wären Unsinn. Genau daran ist das Putzen zuvor gescheitert.
    this.depthScene = new THREE.Scene();
    this.depthScene.overrideMaterial = this.jetDepthMaterial;
    this.paintMaterial.uniforms.uJetDepth.value = this.jetDepthTarget.texture;

    // Rechenvektoren, die je Frame wiederverwendet werden. Der Erreichbarkeits-
    // test läuft für jede Maske in jedem Frame; frisch angelegte Vektoren wären
    // hier tausende Wegwerfobjekte pro Sekunde.
    this._toCenter = new THREE.Vector3();
    this._radial = new THREE.Vector3();
  }

  /** Startdreck in eine Maske säen. */
  seed(mask, opts = {}) {
    const u = this.seedMaterial.uniforms;
    u.uAmount.value = opts.amount ?? 1.0;
    u.uSeed.value = opts.seed ?? 0.0;
    u.uGroundY.value = opts.groundY ?? 0.0;
    u.uStreaks.value = opts.streaks ?? 1.0;
    if (opts.center) u.uCenter.value.copy(opts.center);
    u.uCullCenter.value = opts.enclosing ? 1 : 0;
    u.uTexel.value.set(1 / mask.size, 1 / mask.size);
    u.uExpand.value = 2.0;

    const r = this.renderer;
    const prev = r.getRenderTarget();
    // Löschfarbe sichern: sie ist globaler Rendererzustand, und ein hier
    // vergessener Wert färbt später den Hintergrund der ganzen Szene.
    const prevClear = new THREE.Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();

    r.setRenderTarget(mask.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);   // hier ist Löschen gewollt: Maske neu säen
    this._renderMeshWith(mask.mesh, this.seedMaterial);

    r.setRenderTarget(prev);
    r.setClearColor(prevClear, prevAlpha);
  }

  /**
   * Tiefenkarte aus Sicht der Düse aufnehmen. `scene` sollte alles enthalten,
   * was den Strahl blockieren kann.
   */
  captureJetDepth(scene, origin, dir, range) {
    this.jetCamera.position.copy(origin);
    this.jetCamera.lookAt(origin.clone().add(dir));
    this.jetCamera.far = range;
    this.jetCamera.fov = 60;
    this.jetCamera.updateProjectionMatrix();
    this.jetCamera.updateMatrixWorld(true);

    this.jetDepthMaterial.uniforms.uOrigin.value.copy(origin);
    this.jetDepthMaterial.uniforms.uRange.value = range;

    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevClear = new THREE.Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();

    // Den Levelknoten leihweise in die Tiefenszene hängen. `children` wird
    // direkt gesetzt statt add() zu benutzen: so bleibt `parent` unangetastet
    // und die Weltmatrizen stimmen weiterhin.
    this.depthScene.children = [scene];
    r.setRenderTarget(this.jetDepthTarget);
    // Weiß heißt "unendlich weit weg" — dort, wo nichts steht, darf der Strahl
    // ungehindert durch.
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    r.render(this.depthScene, this.jetCamera);
    this.depthScene.children = [];

    r.setRenderTarget(prev);
    r.setClearColor(prevClear, prevAlpha);

    this.paintMaterial.uniforms.uJetMatrix.value.multiplyMatrices(
      this.jetCamera.projectionMatrix,
      this.jetCamera.matrixWorldInverse,
    );
  }

  /**
   * Den Strahl auf alle erreichbaren Masken anwenden.
   * @returns {number} Anzahl bemalter Masken
   */
  paint(masks, jet, dt) {
    const u = this.paintMaterial.uniforms;
    u.uOrigin.value.copy(jet.origin);
    u.uDir.value.copy(jet.dir).normalize();
    u.uRange.value = jet.range;
    u.uRadius.value = jet.radius;
    u.uSpread.value = jet.spread;
    u.uPower.value = jet.power;
    u.uWetGain.value = jet.wetGain ?? 2.4;
    u.uDt.value = Math.min(dt, 0.05);

    const r = this.renderer;
    const prev = r.getRenderTarget();
    let painted = 0;

    for (const mask of masks) {
      if (mask.done) continue;
      if (!this._reachable(mask, jet)) continue;

      u.uTexel.value.set(1 / mask.size, 1 / mask.size);
      u.uExpand.value = 1.6; // das Säen teilt sich diesen Uniform und stellt ihn um
      r.setRenderTarget(mask.target);
      this._renderMeshWith(mask.mesh, this.paintMaterial);
      mask.wetUntil = performance.now() + 6000;
      painted++;
    }

    r.setRenderTarget(prev);
    return painted;
  }

  /** Grobtest: Liegt die Hülle des Objekts überhaupt im Strahlkegel? */
  _reachable(mask, jet) {
    mask.updateBounds();
    const s = mask.boundingSphere;
    const toC = this._toCenter.subVectors(s.center, jet.origin);
    const t = toC.dot(jet.dir);
    if (t < -s.radius || t > jet.range + s.radius) return false;
    const radial = this._radial.copy(toC).addScaledVector(jet.dir, -t).length();
    const coneR = jet.radius + Math.max(t, 0) * jet.spread;
    return radial <= coneR + s.radius;
  }

  /** Nässe abtrocknen lassen. */
  dry(masks, dt) {
    const now = performance.now();
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const amount = Math.min(dt * 0.16, 0.08);
    this.decayMaterial.uniforms.uAmount.value = amount;

    // Auch hier gilt: ohne autoClear = false würde das Abtrocknen die Maske
    // löschen statt nur Nässe abzuziehen.
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    for (const mask of masks) {
      if (mask.wetUntil < now) continue;
      r.setRenderTarget(mask.target);
      r.render(this.decayQuad, this.dummyCamera);
    }
    r.autoClear = prevAutoClear;
    r.setRenderTarget(prev);
  }

  /**
   * Ein einzelnes Mesh mit einem Ersatzmaterial in das aktuelle Ziel rendern.
   *
   * `autoClear` MUSS dabei aus sein. Sonst löscht three das Render-Target vor
   * dem Zeichnen — und da das Ziel hier die Dreckmaske ist, wäre jedes Objekt
   * beim ersten Streifen des Strahls schlagartig komplett sauber, statt nur
   * dort, wo der Strahl auftrifft.
   */
  _renderMeshWith(mesh, material) {
    const r = this.renderer;
    const original = mesh.material;
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    mesh.material = material;
    r.render(mesh, this.dummyCamera);
    mesh.material = original;
    r.autoClear = prevAutoClear;
  }

  dispose() {
    this.seedMaterial.dispose();
    this.paintMaterial.dispose();
    this.decayMaterial.dispose();
    this.jetDepthMaterial.dispose();
    this.jetDepthTarget.dispose();
    this.decayQuad.geometry.dispose();
  }
}
