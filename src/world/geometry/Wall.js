import * as THREE from 'three';
import { bevelBox, mergeParts } from './shapes.js';

/**
 * Ziegelmauern mit Abdeckstein.
 *
 * Der Abdeckstein steht bewusst etwas über: er wirft eine Schattenkante auf die
 * Mauer und ist genau der Grund, warum darunter die Regenstreifen entstehen,
 * die man später wegputzt.
 */
export function buildWall({ length = 8, height = 2.6, thickness = 0.24, x = 0, z = 0, rotation = 0, id = 'wall', label = 'Mauer' } = {}) {
  const body = bevelBox(length, height, thickness, 0.01, 2);
  body.translate(0, height / 2, 0);

  const coping = bevelBox(length + 0.12, 0.09, thickness + 0.14, 0.014, 2);
  coping.translate(0, height + 0.045, 0);

  const merged = mergeParts([body]);
  const copingGeo = mergeParts([coping]);

  const wrap = (geo) => {
    geo.rotateY(rotation);
    geo.translate(x, 0, z);
    return geo;
  };

  return [
    {
      geometry: wrap(merged),
      surface: 'brick',
      label,
      id,
      cleanable: true,
      dirt: { amount: 0.95, streaks: 1.35, enclosing: true },
    },
    {
      geometry: wrap(copingGeo),
      surface: 'concrete',
      label,
      id: `${id}-coping`,
      cleanable: true,
      dirt: { amount: 1.0, streaks: 0.5, enclosing: true },
    },
  ];
}
