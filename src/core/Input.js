/**
 * Eingabe: PointerLock-Maus, Tastatur, Mausrad.
 *
 * Kennt zusätzlich einen Skript-Modus (`scripted`), in dem die Werte von außen
 * gesetzt werden. Damit lässt sich das Spiel headless fernsteuern, ohne dass es
 * eine zweite Steuerungslogik braucht.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.locked = false;
    this.scripted = false;

    // Pro Frame konsumierte Maus-Deltas.
    this.lookX = 0;
    this.lookY = 0;
    this.firing = false;
    this.wheel = 0;

    this.sensitivity = 0.0022;
    this.invertY = false;

    this.onNozzle = null; // (index) => void
    this.onPause = null; // () => void
    this.onToggleList = null; // () => void

    this._bind();
  }

  _bind() {
    const el = this.canvas;

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) {
        this.keys.clear();
        this.firing = false;
        this.onPause?.();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.scripted) return;
      this.lookX += e.movementX * this.sensitivity;
      this.lookY += e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
    });

    el.addEventListener('mousedown', (e) => {
      if (this.scripted) return;
      if (e.button === 0 && this.locked) this.firing = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (this.scripted) return;
      if (e.button === 0) this.firing = false;
    });

    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked || this.scripted) return;
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const c = e.code;
      this.keys.add(c);

      if (c === 'Tab') {
        e.preventDefault();
        this.onToggleList?.();
      }
      if (c.startsWith('Digit')) {
        const n = Number(c.slice(5));
        if (n >= 1 && n <= 4) this.onNozzle?.(n - 1);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.firing = false;
    });
  }

  requestLock() {
    if (this.scripted) return;
    this.canvas.requestPointerLock?.();
  }

  exitLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Bewegungsachsen aus der Tastatur, als {x: rechts, z: vorwärts}. */
  moveAxis() {
    if (this.scripted) return { x: this._sx ?? 0, z: this._sz ?? 0 };
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const z = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    return { x, z };
  }

  get running() {
    return this.scripted ? false : this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  get jumping() {
    return this.scripted ? false : this.keys.has('Space');
  }

  /** Maus-Delta abholen und zurücksetzen. */
  consumeLook() {
    const x = this.lookX;
    const y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return { x, y };
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  // --- Skript-Modus (Screenshots / Tests) ---
  setScripted(on) {
    this.scripted = on;
    if (on) {
      this.keys.clear();
      this._sx = 0;
      this._sz = 0;
    }
  }

  scriptMove(x, z) {
    this._sx = x;
    this._sz = z;
  }

  scriptLook(x, y) {
    this.lookX += x;
    this.lookY += y;
  }

  scriptFire(on) {
    this.firing = on;
  }
}
