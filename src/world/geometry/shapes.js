import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Geometrie-Werkzeuge.
 *
 * Zwei Dinge machen den optischen Unterschied und stecken hier drin:
 *  - Gefaste Kanten statt messerscharfer Würfel. Eine Fase fängt ein Glanzlicht
 *    und lässt ein Objekt sofort gebaut statt generiert aussehen.
 *  - Eine flächentreue Abwicklung für die Dreckmaske, damit "50 % sauber" auch
 *    wirklich der halben Oberfläche entspricht.
 */

/**
 * Geometrien zusammenfassen.
 *
 * three's mergeGeometries verlangt, dass alle Teile entweder indiziert oder
 * alle nicht-indiziert sind — RoundedBoxGeometry ist nicht indiziert,
 * Cylinder, Lathe, Sphere und Torus sind es. Hier wird deshalb alles auf
 * nicht-indiziert vereinheitlicht und auf die drei Attribute beschränkt, die
 * für den Merge zählen. Die Abwicklung trennt die Geometrie ohnehin wieder auf.
 */
export function mergeParts(geometries) {
  const prepared = geometries.map((g) => {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    }
    geo.clearGroups();
    return geo;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error('mergeParts: Geometrien passen nicht zusammen');
  for (const g of prepared) g.dispose();
  return merged;
}

/** Quader mit gefasten Kanten. */
export function bevelBox(w, h, d, bevel = 0.012, segments = 2) {
  const r = Math.min(bevel, w / 2.05, h / 2.05, d / 2.05);
  return new RoundedBoxGeometry(w, h, d, segments, r);
}

/** Dominante Achse einer Normalen: 0/1 = ±X, 2/3 = ±Y, 4/5 = ±Z */
function dominantAxis(nx, ny, nz) {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ax >= ay && ax >= az) return nx >= 0 ? 0 : 1;
  if (ay >= az) return ny >= 0 ? 2 : 3;
  return nz >= 0 ? 4 : 5;
}

/** Die beiden Achsen, auf die bei gegebener Hauptachse projiziert wird. */
const PROJ = [
  [2, 1], // +X -> (z, y)
  [2, 1], // -X
  [0, 2], // +Y -> (x, z)
  [0, 2], // -Y
  [0, 1], // +Z -> (x, y)
  [0, 1], // -Z
];

/**
 * Gekachelte UVs in Weltmaß: die Textur deckt immer `worldSize` Meter ab,
 * egal wie groß das Objekt ist. Dadurch ist die Texeldichte über die ganze
 * Szene gleich — unterschiedlich fein aufgelöste Nachbarflächen sind eines der
 * auffälligsten Amateur-Merkmale.
 */
export function applyWorldUV(geometry, worldSize = 1, offset = [0, 0]) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const uv = new Float32Array(pos.count * 2);

  const project = (i, axis) => {
    const [a, b] = PROJ[axis];
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    uv[i * 2] = (p[a] + offset[0]) / worldSize;
    uv[i * 2 + 1] = (p[b] + offset[1]) / worldSize;
  };

  if (!geometry.index) {
    // Nicht-indiziert: Projektionsebene je Dreieck aus der Flächennormalen.
    //
    // Über die weichen Vertexnormalen zu gehen wäre naheliegend, geht aber
    // schief: an einem Zylinder wechselt die dominante Achse mitten in einem
    // Dreieck, dessen drei Ecken dann aus verschiedenen Ebenen projiziert
    // werden — die Textur wird dort quer gezogen. Pro Dreieck entschieden
    // kann das nicht passieren.
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const fn = new THREE.Vector3();
    const tris = pos.count / 3;

    for (let t = 0; t < tris; t++) {
      a.fromBufferAttribute(pos, t * 3);
      b.fromBufferAttribute(pos, t * 3 + 1);
      c.fromBufferAttribute(pos, t * 3 + 2);
      fn.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
      const axis = dominantAxis(fn.x, fn.y, fn.z);
      project(t * 3, axis);
      project(t * 3 + 1, axis);
      project(t * 3 + 2, axis);
    }
  } else {
    for (let i = 0; i < pos.count; i++) {
      project(i, dominantAxis(nor.getX(i), nor.getY(i), nor.getZ(i)));
    }
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * Abwicklung für die Dreckmaske.
 *
 * Dreiecke werden nach ihrer Flächennormalen in sechs Gruppen sortiert und je
 * Gruppe in ein eigenes Rechteck im Atlas gelegt. Alle Rechtecke benutzen
 * denselben Maßstab (Texel pro Meter), also ist der Mittelwert über die Maske
 * gleich dem flächengewichteten Mittel — genau das, was die Fortschrittsanzeige
 * braucht.
 *
 * Die Geometrie wird dafür aufgetrennt (non-indexed): so liegt jedes Dreieck
 * vollständig in einer Gruppe und es gibt keine über den Atlas gezogenen
 * Dreiecke an den Kanten.
 *
 * Zusätzlich wird pro Vertex der UV-Schwerpunkt seines Dreiecks abgelegt. Der
 * Maler weitet die Dreiecke damit um wenige Texel auf und verhindert die feinen
 * Schmutzlinien, die sonst an jeder Atlasnaht stehen bleiben.
 */
export function applyMaskUV(geometry, padding = 0.004) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;
  const triCount = pos.count / 3;

  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const fn = new THREE.Vector3();

  // 1. Dreiecke gruppieren und je Gruppe die Ausdehnung messen
  const groups = Array.from({ length: 6 }, () => ({
    tris: [],
    min: [Infinity, Infinity],
    max: [-Infinity, -Infinity],
  }));

  const triAxis = new Uint8Array(triCount);

  for (let t = 0; t < triCount; t++) {
    va.fromBufferAttribute(pos, t * 3);
    vb.fromBufferAttribute(pos, t * 3 + 1);
    vc.fromBufferAttribute(pos, t * 3 + 2);
    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    fn.crossVectors(ab, ac).normalize();

    const axis = dominantAxis(fn.x, fn.y, fn.z);
    triAxis[t] = axis;
    const g = groups[axis];
    g.tris.push(t);

    const [ia, ib] = PROJ[axis];
    for (const v of [va, vb, vc]) {
      const c = [v.x, v.y, v.z];
      if (c[ia] < g.min[0]) g.min[0] = c[ia];
      if (c[ia] > g.max[0]) g.max[0] = c[ia];
      if (c[ib] < g.min[1]) g.min[1] = c[ib];
      if (c[ib] > g.max[1]) g.max[1] = c[ib];
    }
  }

  // 2. Rechtecke in Weltmaß mit gemeinsamem Maßstab packen (Regalpackung)
  const rects = groups.map((g, i) => ({
    i,
    w: g.tris.length ? Math.max(g.max[0] - g.min[0], 1e-4) : 0,
    h: g.tris.length ? Math.max(g.max[1] - g.min[1], 1e-4) : 0,
  }));
  const used = rects.filter((r) => r.w > 0).sort((a, b) => b.h - a.h);

  // Maßstab so wählen, dass alles in das Einheitsquadrat passt
  let scale = 1;
  for (let attempt = 0; attempt < 40; attempt++) {
    let x = padding;
    let y = padding;
    let shelfH = 0;
    let ok = true;
    for (const r of used) {
      const rw = r.w * scale;
      const rh = r.h * scale;
      if (rw > 1 - padding * 2 || rh > 1 - padding * 2) { ok = false; break; }
      if (x + rw + padding > 1) {
        x = padding;
        y += shelfH + padding;
        shelfH = 0;
      }
      if (y + rh + padding > 1) { ok = false; break; }
      r.x = x;
      r.y = y;
      x += rw + padding;
      shelfH = Math.max(shelfH, rh);
    }
    if (ok) break;
    scale *= 0.82;
  }

  const place = new Map();
  for (const r of used) place.set(r.i, r);

  // 3. UVs setzen
  const uvArr = new Float32Array(pos.count * 2);
  const cenArr = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const axis = triAxis[t];
    const g = groups[axis];
    const r = place.get(axis);
    const [ia, ib] = PROJ[axis];

    let cu = 0;
    let cv = 0;
    for (let k = 0; k < 3; k++) {
      const idx = t * 3 + k;
      v.fromBufferAttribute(pos, idx);
      const c = [v.x, v.y, v.z];
      const u = r.x + (c[ia] - g.min[0]) * scale;
      const w = r.y + (c[ib] - g.min[1]) * scale;
      uvArr[idx * 2] = u;
      uvArr[idx * 2 + 1] = w;
      cu += u;
      cv += w;
    }
    cu /= 3;
    cv /= 3;
    for (let k = 0; k < 3; k++) {
      cenArr[(t * 3 + k) * 2] = cu;
      cenArr[(t * 3 + k) * 2 + 1] = cv;
    }
  }

  geo.setAttribute('aMaskUv', new THREE.BufferAttribute(uvArr, 2));
  geo.setAttribute('aUvCentroid', new THREE.BufferAttribute(cenArr, 2));

  // Wie viele Texel entsprechen einem Meter? Der Maler skaliert damit die
  // Aufweitung, und die Maskengröße richtet sich danach.
  geo.userData.maskScale = scale;
  geo.userData.surfaceArea = surfaceArea(geo);
  return geo;
}

/** Gesamtfläche in m² — bestimmt die sinnvolle Maskenauflösung. */
export function surfaceArea(geometry) {
  const pos = geometry.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let area = 0;
  const tris = geometry.index ? geometry.index.count / 3 : pos.count / 3;
  for (let t = 0; t < tris; t++) {
    const i0 = geometry.index ? geometry.index.getX(t * 3) : t * 3;
    const i1 = geometry.index ? geometry.index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = geometry.index ? geometry.index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
  }
  return area;
}

/** Geometrie für eine putzbare Fläche fertigmachen: Welt-UVs + Masken-Atlas. */
export function prepareCleanable(geometry, worldSize) {
  const geo = applyMaskUV(geometry);
  applyWorldUV(geo, worldSize);
  // Bewusst kein computeVertexNormals(): die Geometrie ist hier bereits
  // aufgetrennt, ein Neuberechnen würde jede Fläche flach schattieren und
  // aus Töpfen und Rohren Vielflächner machen. Die Normalen der
  // Ausgangsgeometrie sind korrekt und werden mitgeführt.
  return geo;
}
