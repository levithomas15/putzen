import * as THREE from 'three';
import { bevelBox, mergeParts } from './shapes.js';

/** Blumentopf über ein Profil gedreht — mit Wulst am Rand. */
export function buildPot({ x = 0, z = 0, scale = 1, index = 0 } = {}) {
  const pts = [];
  const h = 0.34 * scale;
  const rTop = 0.19 * scale;
  const rBot = 0.13 * scale;

  pts.push(new THREE.Vector2(0.001, 0));
  pts.push(new THREE.Vector2(rBot, 0));
  pts.push(new THREE.Vector2(rBot * 1.02, 0.02 * scale));
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2(THREE.MathUtils.lerp(rBot, rTop, t), 0.02 * scale + t * (h - 0.08 * scale)));
  }
  // Wulst
  pts.push(new THREE.Vector2(rTop * 1.09, h - 0.05 * scale));
  pts.push(new THREE.Vector2(rTop * 1.1, h - 0.012 * scale));
  pts.push(new THREE.Vector2(rTop * 0.95, h));
  pts.push(new THREE.Vector2(rTop * 0.9, h - 0.03 * scale));
  pts.push(new THREE.Vector2(0.001, h - 0.05 * scale)); // Erdoberfläche

  const geo = new THREE.LatheGeometry(pts, 28);
  geo.translate(x, 0, z);

  return [
    {
      geometry: geo,
      surface: 'terracotta',
      label: `Blumentopf ${index + 1}`,
      id: `pot-${index}`,
      cleanable: true,
      dirt: { amount: 1.0, streaks: 1.1 },
    },
  ];
}

/** Mülltonne: Korpus, Deckel, Räder. */
export function buildBin({ x = 0, z = 0, rotation = 0 } = {}) {
  const w = 0.58;
  const d = 0.52;
  const h = 0.95;

  const body = bevelBox(w, h, d, 0.02, 2);
  body.translate(0, h / 2 + 0.07, 0);

  const lid = bevelBox(w + 0.04, 0.06, d + 0.04, 0.018, 2);
  lid.rotateX(-0.03);
  lid.translate(0, h + 0.11, 0);

  const parts = [body, lid];
  for (const sx of [-1, 1]) {
    const wheel = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 14);
    wheel.rotateZ(Math.PI / 2);
    wheel.translate(sx * (w / 2 - 0.03), 0.07, -d / 2 + 0.08);
    parts.push(wheel);
  }

  const geo = mergeParts(parts);
  geo.rotateY(rotation);
  geo.translate(x, 0, z);

  return [
    {
      geometry: geo,
      surface: 'plastic',
      label: 'Mülltonne',
      id: 'bin',
      cleanable: true,
      dirt: { amount: 1.0, streaks: 1.2 },
    },
  ];
}

/** Kugelgrill auf drei Beinen. */
export function buildGrill({ x = 0, z = 0, rotation = 0 } = {}) {
  const parts = [];

  const bowl = new THREE.SphereGeometry(0.28, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bowl.scale(1, 0.8, 1);
  bowl.translate(0, 0.62, 0);
  parts.push(bowl);

  const rim = new THREE.TorusGeometry(0.28, 0.016, 8, 28);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.62, 0);
  parts.push(rim);

  const lid = new THREE.SphereGeometry(0.285, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  lid.scale(1, 0.62, 1);
  lid.translate(0, 0.63, 0);
  parts.push(lid);

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const leg = new THREE.CylinderGeometry(0.012, 0.016, 0.62, 8);
    leg.rotateX(Math.sin(a) * 0.13);
    leg.rotateZ(-Math.cos(a) * 0.13);
    leg.translate(Math.cos(a) * 0.2, 0.31, Math.sin(a) * 0.2);
    parts.push(leg);
  }

  const geo = mergeParts(parts);
  geo.rotateY(rotation);
  geo.translate(x, 0, z);

  return [
    {
      geometry: geo,
      surface: 'paintedMetal',
      label: 'Grill',
      id: 'grill',
      cleanable: true,
      dirt: { amount: 1.0, streaks: 0.8 },
    },
  ];
}

/** Lattenzaun. */
export function buildFence({ length = 6, x = 0, z = 0, rotation = 0, id = 'fence' } = {}) {
  const parts = [];
  const h = 1.5;
  const pitch = 0.14;
  const count = Math.floor(length / pitch);

  for (let i = 0; i < count; i++) {
    const wobble = Math.sin(i * 1.7) * 0.5 + Math.sin(i * 0.6) * 0.5;
    const board = bevelBox(0.1, h + wobble * 0.02, 0.022, 0.004, 1);
    board.translate(-length / 2 + pitch * (i + 0.5), (h + wobble * 0.02) / 2, 0);
    board.rotateY(wobble * 0.004);
    parts.push(board);
  }
  for (const ry of [0.35, 1.18]) {
    const rail = bevelBox(length, 0.07, 0.03, 0.005, 1);
    rail.translate(0, ry, -0.026);
    parts.push(rail);
  }

  const geo = mergeParts(parts);
  geo.rotateY(rotation);
  geo.translate(x, 0, z);

  return [
    {
      geometry: geo,
      surface: 'fenceWood',
      label: 'Zaun',
      id,
      cleanable: true,
      dirt: { amount: 1.0, streaks: 1.0, enclosing: true },
    },
  ];
}

/** Betonweg vor der Terrasse. */
export function buildPath({ width = 8, depth = 2.2, x = 0, z = 0, y = 0.01 } = {}) {
  const geo = bevelBox(width, 0.08, depth, 0.008, 1);
  geo.translate(x, y - 0.04, z);
  return [
    {
      geometry: geo,
      surface: 'concrete',
      label: 'Gehweg',
      id: 'path',
      cleanable: true,
      dirt: { amount: 1.0, streaks: 0.4, enclosing: true },
    },
  ];
}
