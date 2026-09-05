import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/**
 * Himmel + Beleuchtung, komplett ohne Asset-Dateien.
 *
 * Der Rayleigh-Streuungs-Himmel wird einmal per PMREMGenerator in eine
 * Environment-Map gebacken. Damit bekommt jedes PBR-Material korrektes
 * Umgebungslicht — der eigentliche Grund, warum die Szene "teuer" aussieht.
 */
export function buildSky(scene, renderer, opts = {}) {
  const {
    // Die Sonne muss von der offenen Seite (+Z) kommen. Steht sie hinter der
    // Rückwand, wirft diese ihren Schatten über die komplette Terrasse — bei
    // 2,7 m Höhe und flachem Stand reicht der über das ganze Deck, und man
    // putzt im Dunkeln.
    elevation = 38,
    azimuth = 35,
    turbidity = 3.2,
    rayleigh = 1.35,
    mieCoefficient = 0.006,
    mieDirectionalG = 0.82,
  } = opts;

  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.turbidity.value = turbidity;
  u.rayleigh.value = rayleigh;
  u.mieCoefficient.value = mieCoefficient;
  u.mieDirectionalG.value = mieDirectionalG;

  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  u.sunPosition.value.copy(sunDir);

  scene.add(sky);

  // --- Environment-Map aus dem Himmel backen ---
  //
  // Die Sonnenscheibe muss dafür aus sein. Sie ist um Größenordnungen heller
  // als der restliche Himmel; im Half-Float-Ziel der PMREM-Kette läuft sie über
  // und die entstehenden Unendlichkeiten ziehen sich durch die
  // Beleuchtungsintegration — jede Fläche wird dann pechschwarz gerendert.
  // Das direkte Sonnenlicht kommt ohnehin aus dem DirectionalLight weiter unten.
  sky.material.uniforms.showSunDisc.value = 0;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(sky, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();

  sky.material.uniforms.showSunDisc.value = 1; // im Bild soll sie zu sehen sein

  // --- Sonne ---
  const sun = new THREE.DirectionalLight(0xfff2dc, 3.0);
  sun.position.copy(sunDir).multiplyScalar(40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  const s = 18;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 2.4;
  scene.add(sun);
  scene.add(sun.target);

  // Weiches Himmels-/Bodenlicht als Ergänzung zur Env-Map: hebt Schattenseiten
  // an, ohne dass Flächen flach werden.
  const hemi = new THREE.HemisphereLight(0xbcd8f0, 0x50412f, 0.45);
  scene.add(hemi);

  // Leichter Dunst in Sonnenrichtung — gibt Tiefe und lässt den Nebel wirken.
  scene.fog = new THREE.FogExp2(0xa9c4d6, 0.0135);

  return { sky, sun, hemi, sunDir, envRT };
}

/** Schattenkamera der Sonne auf einen Bereich der Szene zentrieren. */
export function focusSunShadow(sun, center, radius = 14) {
  const dir = sun.position.clone().normalize(); // vor dem Überschreiben sichern
  sun.target.position.copy(center);
  sun.target.updateMatrixWorld();
  sun.position.copy(center).addScaledVector(dir, 38);
  const cam = sun.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.updateProjectionMatrix();
}
