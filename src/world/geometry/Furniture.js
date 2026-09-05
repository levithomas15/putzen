import * as THREE from 'three';
import { bevelBox, mergeParts } from './shapes.js';

/** Rohrbein mit leichter Verjüngung — sieht gebaut aus statt extrudiert. */
function tubeLeg(height, radius = 0.022) {
  const g = new THREE.CylinderGeometry(radius * 0.86, radius, height, 12, 1);
  g.translate(0, height / 2, 0);
  return g;
}

/** Gartentisch: Rahmen, Lattenplatte, vier Beine. */
export function buildTable({ x = 0, z = 0, rotation = 0, w = 1.5, d = 0.85, h = 0.74 } = {}) {
  const frame = [];
  const top = [];

  // Lattenplatte
  const slats = 9;
  const slatW = (d - 0.06) / slats;
  for (let i = 0; i < slats; i++) {
    const g = bevelBox(w - 0.05, 0.022, slatW * 0.82, 0.004, 2);
    g.translate(0, h, -d / 2 + 0.03 + slatW * (i + 0.5));
    top.push(g);
  }
  // Zarge
  for (const [bw, bd, bx, bz] of [
    [w - 0.02, 0.05, 0, -d / 2 + 0.04],
    [w - 0.02, 0.05, 0, d / 2 - 0.04],
  ]) {
    const g = bevelBox(bw, 0.05, bd, 0.005, 2);
    g.translate(bx, h - 0.05, bz);
    frame.push(g);
  }
  // Beine
  for (const [lx, lz] of [
    [-w / 2 + 0.07, -d / 2 + 0.07],
    [w / 2 - 0.07, -d / 2 + 0.07],
    [-w / 2 + 0.07, d / 2 - 0.07],
    [w / 2 - 0.07, d / 2 - 0.07],
  ]) {
    const g = tubeLeg(h - 0.06, 0.024);
    g.translate(lx, 0, lz);
    frame.push(g);
  }

  const place = (geo) => {
    geo.rotateY(rotation);
    geo.translate(x, 0, z);
    return geo;
  };

  return [
    {
      geometry: place(mergeParts(top)),
      surface: 'deckWood',
      label: 'Gartentisch',
      id: 'table-top',
      cleanable: true,
      dirt: { amount: 0.85, streaks: 0.3 },
    },
    {
      geometry: place(mergeParts(frame)),
      surface: 'paintedMetal',
      label: 'Gartentisch',
      id: 'table-frame',
      cleanable: true,
      dirt: { amount: 0.8, streaks: 0.5 },
    },
  ];
}

/** Stuhl: Rohrrahmen plus Sitzfläche und Lehne aus Gewebe. */
export function buildChair({ x = 0, z = 0, rotation = 0, index = 0 } = {}) {
  const w = 0.46;
  const d = 0.48;
  const seatH = 0.44;
  const backH = 0.46;

  const frame = [];
  const soft = [];

  for (const [lx, lz] of [
    [-w / 2 + 0.04, -d / 2 + 0.04],
    [w / 2 - 0.04, -d / 2 + 0.04],
    [-w / 2 + 0.04, d / 2 - 0.04],
    [w / 2 - 0.04, d / 2 - 0.04],
  ]) {
    const g = tubeLeg(seatH, 0.019);
    g.translate(lx, 0, lz);
    frame.push(g);
  }

  // Lehnenholme laufen aus den hinteren Beinen weiter
  for (const lx of [-w / 2 + 0.04, w / 2 - 0.04]) {
    const g = tubeLeg(backH, 0.018);
    g.translate(lx, seatH, -d / 2 + 0.04);
    frame.push(g);
  }

  const seat = bevelBox(w - 0.02, 0.05, d - 0.02, 0.014, 2);
  seat.translate(0, seatH + 0.025, 0);
  soft.push(seat);

  const back = bevelBox(w - 0.04, backH - 0.1, 0.05, 0.014, 2);
  back.rotateX(-0.12);
  back.translate(0, seatH + backH / 2, -d / 2 + 0.06);
  soft.push(back);

  const place = (geo) => {
    geo.rotateY(rotation);
    geo.translate(x, 0, z);
    return geo;
  };

  return [
    {
      geometry: place(mergeParts(frame)),
      surface: 'paintedMetal',
      label: `Stuhl ${index + 1}`,
      id: `chair-${index}-frame`,
      cleanable: true,
      dirt: { amount: 0.82, streaks: 0.5 },
    },
    {
      geometry: place(mergeParts(soft)),
      surface: 'fabric',
      label: `Stuhl ${index + 1}`,
      id: `chair-${index}-soft`,
      cleanable: true,
      dirt: { amount: 0.95, streaks: 0.7 },
    },
  ];
}
