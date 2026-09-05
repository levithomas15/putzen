import * as THREE from 'three';

/**
 * Der Hochdruckreiniger: Ansichtsmodell, Düsen und Strahlparameter.
 *
 * Das Gerät liegt in einer eigenen Szene mit eigener Kamera (siehe Stage), damit
 * es nie in Wänden steckt. Die eigentliche Wirkung im Level wird über einen
 * Strahl berechnet, der aus der Hauptkamera kommt — das Ansichtsmodell ist
 * reine Darstellung.
 *
 * Das Nachschwingen (Sway) ist mehr als Zierde: die kleine Verzögerung zwischen
 * Mausbewegung und Gerät ist der Unterschied zwischen "Textur klebt am
 * Bildschirm" und "ich halte etwas in der Hand".
 */

/**
 * `power` ist der Dreckabtrag je Sekunde bei senkrechtem Auftreffen auf kurze
 * Distanz. Bei 3.4 braucht die Flächendüse gut eine Viertelsekunde je Fleck —
 * langsam genug, dass man wischen muss, schnell genug, dass die Spur sofort
 * sichtbar wird. Deutlich niedrigere Werte fühlen sich zäh an.
 */
export const NOZZLES = [
  {
    name: 'Punkt',
    angle: '0°',
    radius: 0.014,
    spread: 0.0075,
    power: 8.5,
    range: 11,
    wetGain: 1.5,
    recoil: 1.0,
    tint: 0xff5544,
    sound: { cutoff: 3400, q: 7.5, noise: 0.9, body: 0.35 },
  },
  {
    name: 'Meißel',
    angle: '15°',
    radius: 0.024,
    spread: 0.022,
    power: 5.8,
    range: 10,
    wetGain: 1.9,
    recoil: 0.78,
    tint: 0xffd24a,
    sound: { cutoff: 2600, q: 4.5, noise: 1.0, body: 0.5 },
  },
  {
    name: 'Fläche',
    angle: '40°',
    radius: 0.052,
    spread: 0.058,
    power: 3.4,
    range: 8.2,
    wetGain: 2.6,
    recoil: 0.5,
    tint: 0x63d0ff,
    sound: { cutoff: 1750, q: 2.6, noise: 1.0, body: 0.72 },
  },
  {
    name: 'Turbo',
    angle: 'rot.',
    radius: 0.038,
    spread: 0.03,
    power: 7.2,
    range: 9.5,
    wetGain: 2.2,
    recoil: 1.15,
    rotating: true,
    tint: 0xb98cff,
    sound: { cutoff: 2200, q: 5.5, noise: 1.0, body: 0.6, warble: 26 },
  },
];

export class PressureWasher {
  constructor(stage) {
    this.stage = stage;
    this.nozzleIndex = 2; // Flächendüse als Standard: der Arbeitspferd-Aufsatz
    this.trigger = false;
    this.pressure = 0; // 0..1, läuft an und ab
    this.turboPhase = 0;

    this.swayTarget = new THREE.Vector2();
    this.sway = new THREE.Vector2();
    this.bobPhase = 0;

    this.root = new THREE.Group();
    this.model = this._buildModel();
    this.root.add(this.model);
    stage.viewScene.add(this.root);

    // Eigenes Licht für das Ansichtsmodell, damit es nicht flach wirkt
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-0.6, 1.0, 0.8);
    stage.viewScene.add(key);
    const fill = new THREE.HemisphereLight(0xb9d6ea, 0x2a2620, 1.5);
    stage.viewScene.add(fill);

    this._tmpDir = new THREE.Vector3();
    this._tmpOrigin = new THREE.Vector3();
  }

  get nozzle() {
    return NOZZLES[this.nozzleIndex];
  }

  _buildModel() {
    const g = new THREE.Group();

    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0c6, roughness: 0.32, metalness: 0.92 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.62, metalness: 0.15 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xf0b024, roughness: 0.45, metalness: 0.05 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.92, metalness: 0.0 });

    // Griff, leicht nach hinten geneigt
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.11, 4, 12), rubber);
    grip.rotation.x = 0.42;
    grip.position.set(0, -0.075, 0.055);
    g.add(grip);

    // Gehäuse
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.062, 0.17), accent);
    body.position.set(0, 0.005, 0.02);
    g.add(body);

    const bodyCap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.062, 16), dark);
    bodyCap.rotation.z = Math.PI / 2;
    bodyCap.position.set(0, 0.005, -0.055);
    g.add(bodyCap);

    // Abzug und Bügel
    this.triggerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.042, 0.014), steel);
    this.triggerMesh.position.set(0, -0.038, 0.028);
    g.add(this.triggerMesh);

    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.005, 6, 16, Math.PI * 1.15), dark);
    guard.rotation.set(0, Math.PI / 2, -0.5);
    guard.position.set(0, -0.032, 0.03);
    g.add(guard);

    // Lanze
    const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.012, 0.52, 14), steel);
    lance.rotation.x = Math.PI / 2;
    lance.position.set(0, 0.006, -0.32);
    g.add(lance);

    // Düsenkopf — färbt sich je nach gewähltem Aufsatz
    this.nozzleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.013, 0.052, 14), dark.clone());
    this.nozzleMesh.rotation.x = Math.PI / 2;
    this.nozzleMesh.position.set(0, 0.006, -0.6);
    g.add(this.nozzleMesh);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.0165, 0.0045, 6, 16), steel);
    collar.rotation.y = 0;
    collar.position.set(0, 0.006, -0.575);
    g.add(collar);

    // Schlauch: sackt aus dem Gehäuse nach unten aus dem Bild
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.02, 0.1),
      new THREE.Vector3(0.02, -0.12, 0.2),
      new THREE.Vector3(0.06, -0.3, 0.24),
      new THREE.Vector3(0.02, -0.5, 0.16),
    ]);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 18, 0.014, 8, false), rubber);
    g.add(hose);

    // Ruhelage: unten rechts, leicht eingedreht
    g.position.set(0.16, -0.14, -0.16);
    g.rotation.set(0.02, -0.09, 0.03);

    this.restPosition = g.position.clone();
    this.restRotation = g.rotation.clone();
    return g;
  }

  setNozzle(index) {
    const n = ((index % NOZZLES.length) + NOZZLES.length) % NOZZLES.length;
    if (n === this.nozzleIndex) return false;
    this.nozzleIndex = n;
    this.nozzleMesh.material.color.setHex(this.nozzle.tint);
    this.nozzleMesh.material.emissive?.setHex(0x000000);
    return true;
  }

  cycleNozzle(delta) {
    return this.setNozzle(this.nozzleIndex + Math.sign(delta));
  }

  /**
   * @param {number} dt
   * @param {boolean} firing
   * @param {object} motion  { lookX, lookY, speed, bobPhase }
   */
  update(dt, firing, motion = {}) {
    this.trigger = firing;

    // Druck läuft an und wieder ab — kein harter Ein-/Ausschalter
    const target = firing ? 1 : 0;
    const rate = firing ? 7 : 5;
    this.pressure = THREE.MathUtils.damp(this.pressure, target, rate, dt);

    if (this.nozzle.rotating) this.turboPhase += dt * 22;

    // Nachschwingen: das Gerät hinkt der Mausbewegung leicht hinterher
    this.swayTarget.set(
      THREE.MathUtils.clamp((motion.lookX ?? 0) * 2.6, -0.06, 0.06),
      THREE.MathUtils.clamp((motion.lookY ?? 0) * 2.6, -0.05, 0.05),
    );
    this.sway.x = THREE.MathUtils.damp(this.sway.x, this.swayTarget.x, 9, dt);
    this.sway.y = THREE.MathUtils.damp(this.sway.y, this.swayTarget.y, 9, dt);

    const speed = motion.speed ?? 0;
    this.bobPhase += dt * 9 * speed;
    const bobY = Math.sin(this.bobPhase * 2) * 0.011 * speed;
    const bobX = Math.cos(this.bobPhase) * 0.014 * speed;

    // Rückstoß: schiebt das Gerät nach hinten und kippt die Nase hoch
    const kick = this.pressure * this.nozzle.recoil;
    const jitter = this.nozzle.rotating
      ? Math.sin(this.turboPhase) * 0.004 * this.pressure
      : (Math.sin(performance.now() * 0.037) + Math.sin(performance.now() * 0.061)) * 0.0015 * this.pressure;

    this.model.position.set(
      this.restPosition.x + this.sway.x + bobX + jitter,
      this.restPosition.y + this.sway.y + bobY - kick * 0.006,
      this.restPosition.z + kick * 0.022,
    );
    this.model.rotation.set(
      this.restRotation.x - this.sway.y * 1.2 - kick * 0.045 + jitter * 2.0,
      this.restRotation.y - this.sway.x * 1.4,
      this.restRotation.z + this.sway.x * 0.9,
    );

    // Abzug sichtbar durchgedrückt
    this.triggerMesh.position.z = 0.028 - this.pressure * 0.008;
  }

  /**
   * Strahlparameter im Weltraum. Der Ursprung sitzt leicht unterhalb und rechts
   * der Blickachse, damit Strahl und Ansichtsmodell zusammenpassen.
   */
  getJet(camera) {
    const n = this.nozzle;
    this._tmpDir.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    this._tmpOrigin
      .set(0.11, -0.1, -0.35)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);

    // Turbodüse pulsiert im Radius — daher der typische Fräs-Klang und -Look
    const pulse = n.rotating ? 1 + Math.sin(this.turboPhase) * 0.35 : 1;

    return {
      origin: this._tmpOrigin,
      dir: this._tmpDir,
      range: n.range,
      radius: n.radius * pulse,
      spread: n.spread * pulse,
      power: n.power * this.pressure,
      wetGain: n.wetGain * this.pressure,
      pressure: this.pressure,
      nozzle: n,
    };
  }
}
