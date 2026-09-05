import * as THREE from 'three';
import { bevelBox, mergeParts } from './shapes.js';

/**
 * Terrassendeck aus einzelnen Dielen.
 *
 * Die Dielen werden zu wenigen Streifen verschmolzen statt zu einem einzigen
 * Mesh: jeder Streifen bekommt seine eigene Maske, und damit ist die Auflösung
 * unter dem Strahl gut viermal so fein wie bei einem Deck am Stück.
 */
export function buildDeck({
  width = 6.4,
  depth = 4.8,
  y = 0.1,
  plankWidth = 0.19,
  // Schmale Fuge. Bei 1,4 cm sieht man aus flachem Blickwinkel fast nur noch
  // die verschatteten Dielenflanken, und das Deck wird zum Streifenmuster aus
  // schwarzen Balken statt zu einer Holzfläche.
  gap = 0.006,
  strips = 3,
} = {}) {
  const pitch = plankWidth + gap;
  const count = Math.floor(depth / pitch);
  const z0 = -depth / 2 + pitch / 2;

  const buckets = Array.from({ length: strips }, () => []);

  for (let i = 0; i < count; i++) {
    // Jede Diele leicht anders: Dicke, Höhe und ein Hauch Verzug.
    const wobble = Math.sin(i * 2.7) * 0.5 + Math.sin(i * 0.9) * 0.5;
    const thickness = 0.042 + wobble * 0.003;
    const geo = bevelBox(width, thickness, plankWidth, 0.005, 2);
    geo.translate(0, y - thickness / 2, z0 + i * pitch);
    geo.rotateY(wobble * 0.0016); // minimal verzogen, fällt nur unbewusst auf
    buckets[Math.min(strips - 1, Math.floor((i / count) * strips))].push(geo);
  }

  const parts = buckets.map((geos, i) => ({
    geometry: mergeParts(geos),
    surface: 'deckWood',
    label: 'Terrassendeck',
    id: `deck-${i}`,
    cleanable: true,
    dirt: { amount: 0.72, streaks: 0.25, enclosing: true },
  }));

  // Umlaufende Blende, die die Dielenenden verdeckt.
  const skirt = [];
  const sh = 0.16;
  for (const [w, d, x, z, rot] of [
    [width + 0.1, 0.06, 0, depth / 2 + 0.03, 0],
    [width + 0.1, 0.06, 0, -depth / 2 - 0.03, 0],
    [depth + 0.16, 0.06, -width / 2 - 0.03, 0, Math.PI / 2],
    [depth + 0.16, 0.06, width / 2 + 0.03, 0, Math.PI / 2],
  ]) {
    const g = bevelBox(w, sh, d, 0.006, 2);
    g.rotateY(rot);
    g.translate(x, y - sh / 2 - 0.01, z);
    skirt.push(g);
  }
  parts.push({
    geometry: mergeParts(skirt),
    surface: 'deckWood',
    label: 'Blende',
    id: 'deck-skirt',
    cleanable: true,
    dirt: { amount: 1.0, streaks: 0.9, enclosing: true },
  });

  return parts;
}
