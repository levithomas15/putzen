import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { MaterialLibrary } from './materials/MaterialLibrary.js';
import { setMask } from './materials/CleanableMaterial.js';
import { prepareCleanable, applyWorldUV } from './geometry/shapes.js';
import { DirtMask } from '../dirt/DirtMask.js';
import { buildDeck } from './geometry/Deck.js';
import { buildWall } from './geometry/Wall.js';
import { buildTable, buildChair } from './geometry/Furniture.js';
import { buildPot, buildBin, buildGrill, buildFence, buildPath } from './geometry/Props.js';

// Beschleunigte Raycasts — der Aufprallpunkt des Strahls wird jeden Frame
// gebraucht, und die Szene hat ein paar tausend Dreiecke.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const DECK_W = 6.4;
const DECK_D = 4.8;
const DECK_Y = 0.1;

/**
 * Hebt Bauteile auf die Deckoberfläche.
 *
 * Die Bauteil-Bauer setzen ihren Fußpunkt auf y = 0. Das Deck liegt aber bei
 * DECK_Y — ohne diese Verschiebung stecken Tisch, Stühle, Töpfe und Tonne
 * zehn Zentimeter tief in den Dielen.
 */
function onDeck(parts, y = DECK_Y) {
  for (const part of parts) part.geometry.translate(0, y, 0);
  return parts;
}

/** Alle Bauteile der Terrasse. */
function levelParts() {
  return [
    ...buildDeck({ width: DECK_W, depth: DECK_D, y: DECK_Y, strips: 3 }),
    ...buildPath({ width: 9, depth: 2.4, z: DECK_D / 2 + 1.35, y: 0.02 }),

    ...buildWall({ length: 8.2, height: 2.7, x: 0, z: -DECK_D / 2 - 0.4, id: 'wall-back', label: 'Rückwand' }),
    ...buildWall({
      length: 5.6, height: 2.2, thickness: 0.2,
      x: -DECK_W / 2 - 0.5, z: 0.2, rotation: Math.PI / 2,
      id: 'wall-side', label: 'Seitenmauer',
    }),

    ...buildFence({ length: 5.6, x: DECK_W / 2 + 0.55, z: 0.2, rotation: Math.PI / 2, id: 'fence-right' }),

    ...onDeck(buildTable({ x: 0.35, z: 0.15, rotation: 0.14 })),
    ...onDeck(buildChair({ x: -0.05, z: 1.0, rotation: Math.PI + 0.2, index: 0 })),
    ...onDeck(buildChair({ x: 0.75, z: -0.75, rotation: 0.1, index: 1 })),

    ...onDeck(buildPot({ x: -2.5, z: -1.85, scale: 1.15, index: 0 })),
    ...onDeck(buildPot({ x: -2.0, z: -2.0, scale: 0.8, index: 1 })),
    ...onDeck(buildPot({ x: 2.9, z: 1.6, scale: 1.0, index: 2 })),

    ...onDeck(buildBin({ x: -2.75, z: 1.5, rotation: -0.25 })),
    ...onDeck(buildGrill({ x: 2.35, z: -1.75, rotation: 0.5 })),
  ];
}

export async function buildLevel(stage, sky, opts = {}) {
  const { scene, renderer } = stage;
  const onProgress = opts.onProgress ?? (() => {});
  const maskScale = opts.maskScale ?? stage.settings.maskScale;

  const lib = new MaterialLibrary(renderer, opts.bakeScale ?? stage.settings.bakeScale ?? 1);
  await lib.bakeAll((p, name) => onProgress(0.35 + p * 0.3, `Material: ${name}`));

  // Wichtig: putzbare Objekte hängen direkt unter einer Gruppe ohne eigene
  // Transformation. Der Maler rendert jedes Mesh einzeln, und dabei muss die
  // Weltmatrix ohne Umwege stimmen.
  const root = new THREE.Group();
  root.name = 'level';
  scene.add(root);

  // --- Boden ringsum ---
  const groundGeo = new THREE.PlaneGeometry(60, 60);
  groundGeo.rotateX(-Math.PI / 2);
  applyWorldUV(groundGeo, lib.worldSize('soil'));
  const ground = new THREE.Mesh(groundGeo, lib.base('soil'));
  ground.receiveShadow = true;
  ground.position.y = -0.005;
  root.add(ground);

  // --- Putzbare Bauteile ---
  const parts = levelParts();
  const cleanables = [];
  const obstacles = [];
  const raycastTargets = [ground];
  const maskByMesh = new Map(); // Treffer -> Maske, für Klang und Rückmeldung

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const worldSize = lib.worldSize(part.surface);
    const geo = prepareCleanable(part.geometry, worldSize);
    geo.computeBoundsTree();

    const material = lib.cleanable(part.surface, { dirt: part.dirtMaterial ?? {} });
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = part.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Der Maler rendert das Mesh mit einer Dummy-Kamera; ohne das würde es
    // beim Malen weggecullt.
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.updateMatrixWorld(true);

    const mask = new DirtMask(mesh, maskScale);
    mask.label = part.label;
    mask.id = part.id;
    mask.surface = part.surface; // bestimmt den Aufprall-Klang
    mask.seedOptions = { groundY: 0, ...(part.dirt ?? {}) };
    setMask(material, mask.texture);
    mask.updateBounds();

    cleanables.push(mask);
    maskByMesh.set(mesh, mask);
    raycastTargets.push(mesh);

    // Hindernisse für die Spielerkollision
    geo.computeBoundingBox();
    const box = geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    if (box.max.y > 0.25) obstacles.push(box.expandByScalar(0.05));

    onProgress(0.65 + ((i + 1) / parts.length) * 0.2, 'Objekte werden aufgestellt');
  }

  return {
    root,
    ground,
    library: lib,
    cleanables,
    maskByMesh,
    obstacles,
    raycastTargets,
    center: new THREE.Vector3(0, 0.8, -0.4),
    shadowRadius: 8.5,
    spawn: new THREE.Vector3(0.2, 0, DECK_D / 2 + 1.6),
    spawnYaw: 0, // Blick nach -Z, also auf die Terrasse
    bounds: { minX: -4.4, maxX: 4.4, minZ: -3.0, maxZ: 4.4 },
    deck: { width: DECK_W, depth: DECK_D, y: DECK_Y },
  };
}
