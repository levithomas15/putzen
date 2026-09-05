import * as THREE from 'three';

/**
 * Spieler in der ersten Person.
 *
 * Bodenhöhe kommt aus einem Raycast nach unten statt aus fest verdrahteten
 * Höhen — dadurch steigt man ohne Sonderbehandlung auf das Deck und wieder
 * herunter. Hindernisse werden als Kreis gegen Rechteck aufgelöst, was für
 * einen Hinterhof völlig reicht und nie hakt.
 */

const EYE_HEIGHT = 1.68;
const RADIUS = 0.32;
const WALK = 2.7;
const RUN = 4.4;
const GRAVITY = 18;
const JUMP = 5.2;

export class Player {
  constructor(camera, level) {
    this.camera = camera;
    this.level = level;

    this.position = level.spawn.clone();
    this.velocityY = 0;
    this.grounded = true;
    this.floorY = 0;

    this.yaw = level.spawnYaw ?? 0;
    this.pitch = -0.08;

    this.bobPhase = 0;
    this.bobAmount = 0;
    this.speedSmoothed = 0;

    this._ray = new THREE.Raycaster();
    this._ray.far = 4;
    this._down = new THREE.Vector3(0, -1, 0);
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._shake = 0;
  }

  /** Rückstoß des Reinigers auf die Kamera geben. */
  addShake(amount) {
    this._shake = Math.min(this._shake + amount, 1);
  }

  update(dt, input) {
    const look = input.consumeLook();
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y, -1.4, 1.4);

    // --- Bewegung in Blickrichtung ---
    const axis = input.moveAxis();
    const len = Math.hypot(axis.x, axis.z);
    const speed = input.running ? RUN : WALK;

    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3();
    if (len > 0) {
      move
        .addScaledVector(this._forward, axis.z / len)
        .addScaledVector(this._right, axis.x / len)
        .multiplyScalar(speed * dt);
    }

    this.position.x += move.x;
    this.position.z += move.z;

    this._resolveCollisions();
    this._clampToBounds();

    // --- Boden und Schwerkraft ---
    this.floorY = this._sampleFloor();
    const feet = this.position.y;

    if (!this.grounded || this.velocityY > 0) {
      this.velocityY -= GRAVITY * dt;
      this.position.y += this.velocityY * dt;
      if (this.position.y <= this.floorY) {
        this.position.y = this.floorY;
        this.velocityY = 0;
        this.grounded = true;
      }
    } else {
      // Sanft an Stufen anpassen, damit die Kamera nicht springt
      this.position.y = THREE.MathUtils.damp(feet, this.floorY, 14, dt);
      if (input.jumping) {
        this.velocityY = JUMP;
        this.grounded = false;
      }
    }

    // --- Kopfbewegung beim Gehen ---
    const moving = len > 0 && this.grounded;
    this.speedSmoothed = THREE.MathUtils.damp(this.speedSmoothed, moving ? speed / RUN : 0, 8, dt);
    this.bobPhase += dt * (input.running ? 13 : 9.5) * this.speedSmoothed;
    this.bobAmount = this.speedSmoothed;

    this._shake = THREE.MathUtils.damp(this._shake, 0, 6, dt);

    this._applyCamera(dt);
  }

  _applyCamera(dt) {
    const cam = this.camera;
    const bobY = Math.sin(this.bobPhase * 2) * 0.032 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.026 * this.bobAmount;

    const shake = this._shake;
    const t = performance.now() * 0.001;
    const shakeX = (Math.sin(t * 47.3) + Math.sin(t * 31.7)) * 0.0032 * shake;
    const shakeY = (Math.cos(t * 41.1) + Math.sin(t * 23.9)) * 0.0032 * shake;

    cam.position.set(
      this.position.x + bobX,
      this.position.y + EYE_HEIGHT + bobY,
      this.position.z,
    );

    this._euler.set(this.pitch + shakeY, this.yaw + shakeX, Math.cos(this.bobPhase) * 0.008 * this.bobAmount);
    cam.quaternion.setFromEuler(this._euler);
  }

  /** Bodenhöhe unter dem Spieler. */
  _sampleFloor() {
    this._ray.set(
      new THREE.Vector3(this.position.x, this.position.y + 1.2, this.position.z),
      this._down,
    );
    const hits = this._ray.intersectObjects(this.level.raycastTargets, false);
    for (const h of hits) {
      if (h.face && h.face.normal.y < 0.35) continue; // Wände ignorieren
      return h.point.y;
    }
    return 0;
  }

  /** Kreis gegen Rechteck: den Spieler aus Hindernissen herausschieben. */
  _resolveCollisions() {
    for (const box of this.level.obstacles) {
      // Nur was auf Körperhöhe im Weg steht
      if (box.min.y > this.position.y + 1.5) continue;
      if (box.max.y < this.position.y + 0.25) continue;

      const cx = THREE.MathUtils.clamp(this.position.x, box.min.x, box.max.x);
      const cz = THREE.MathUtils.clamp(this.position.z, box.min.z, box.max.z);
      const dx = this.position.x - cx;
      const dz = this.position.z - cz;
      const d2 = dx * dx + dz * dz;

      if (d2 >= RADIUS * RADIUS) continue;

      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (RADIUS - d) / d;
        this.position.x += dx * push;
        this.position.z += dz * push;
      } else {
        // Mittendrin: zur nächsten Kante hinausschieben
        const toMinX = this.position.x - box.min.x;
        const toMaxX = box.max.x - this.position.x;
        const toMinZ = this.position.z - box.min.z;
        const toMaxZ = box.max.z - this.position.z;
        const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
        if (m === toMinX) this.position.x = box.min.x - RADIUS;
        else if (m === toMaxX) this.position.x = box.max.x + RADIUS;
        else if (m === toMinZ) this.position.z = box.min.z - RADIUS;
        else this.position.z = box.max.z + RADIUS;
      }
    }
  }

  _clampToBounds() {
    const b = this.level.bounds;
    this.position.x = THREE.MathUtils.clamp(this.position.x, b.minX, b.maxX);
    this.position.z = THREE.MathUtils.clamp(this.position.z, b.minZ, b.maxZ);
  }
}
