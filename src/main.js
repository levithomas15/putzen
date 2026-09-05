import * as THREE from 'three';
import { Stage, QUALITY } from './core/Renderer.js';
import { Input } from './core/Input.js';
import { installDevHarness } from './core/DevHarness.js';
import { buildSky, focusSunShadow } from './world/Sky.js';
import { buildLevel } from './world/Scene.js';

const params = new URLSearchParams(location.search);

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    const q = params.get('q');
    this.stage = new Stage(this.canvas, QUALITY[q] ? q : 'medium', params.get('post') !== '0', {
      ...(params.get('ao') === '0' ? { ao: false } : {}),
      ...(params.get('bloom') === '0' ? { bloom: false } : {}),
      ...(params.get('smaa') === '0' ? { smaa: false } : {}),
      ...(params.has('bstr') ? { bloomStrength: Number(params.get('bstr')) } : {}),
    });
    this.input = new Input(this.canvas);

    this.clock = new THREE.Clock();
    this.frame = 0;
    this._waiters = [];
    this.running = false;
    this.THREE = THREE; // für Diagnosewerkzeuge
  }

  async build(onProgress = () => {}) {
    const { scene, renderer } = this.stage;

    onProgress(0.1, 'Himmel und Licht');
    this.sky = buildSky(scene, renderer);

    onProgress(0.35, 'Terrasse wird gebaut');
    this.level = await buildLevel(this.stage, this.sky);

    focusSunShadow(this.sky.sun, this.level.center, this.level.shadowRadius);

    onProgress(1, 'Fertig');
  }

  waitFrames(n, cb) {
    this._waiters.push({ left: n, cb });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.stage.renderer.setAnimationLoop(() => this.tick());
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.frame++;
    this.update(dt);
    this.stage.render();

    for (let i = this._waiters.length - 1; i >= 0; i--) {
      const w = this._waiters[i];
      if (--w.left <= 0) {
        this._waiters.splice(i, 1);
        w.cb();
      }
    }
  }

  update(dt) {
    // Vorläufig: Kamera per Eingabe drehen und bewegen, damit die Pipeline
    // überprüfbar ist. Wird in Schritt 5 durch den echten Spieler ersetzt.
    const look = this.input.consumeLook();
    this._yaw = (this._yaw ?? 0) - look.x;
    this._pitch = THREE.MathUtils.clamp((this._pitch ?? 0) - look.y, -1.35, 1.35);

    const cam = this.stage.camera;
    cam.quaternion.setFromEuler(new THREE.Euler(this._pitch, this._yaw, 0, 'YXZ'));

    const axis = this.input.moveAxis();
    if (axis.x || axis.z) {
      const speed = 3.2 * dt;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
      cam.position.addScaledVector(fwd, axis.z * speed).addScaledVector(right, axis.x * speed);
    }
  }

  stats() {
    return {
      frame: this.frame,
      quality: this.stage.quality,
      camera: this.stage.camera.position.toArray().map((v) => +v.toFixed(2)),
      drawCalls: this.stage.renderer.info.render.calls,
      triangles: this.stage.renderer.info.render.triangles,
      textures: this.stage.renderer.info.memory.textures,
    };
  }
}

// ---------------------------------------------------------------------------

const game = new Game();
const harness = installDevHarness(game);

const bootFill = document.getElementById('boot-fill');
const bootLabel = document.getElementById('boot-label');

(async () => {
  try {
    await game.build((p, label) => {
      bootFill.style.width = `${Math.round(p * 100)}%`;
      if (label) bootLabel.textContent = label;
    });

    game.start();

    document.getElementById('boot').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    harness.ready = true;
  } catch (err) {
    bootLabel.textContent = 'Fehler beim Laden — siehe Konsole';
    console.error(err);
    throw err;
  }
})();

document.getElementById('start').addEventListener('click', () => {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  if (!params.has('nolock')) game.input.requestLock();
});

for (const btn of document.querySelectorAll('.quality button')) {
  btn.addEventListener('click', () => {
    const q = btn.dataset.q;
    game.stage.setQuality(q);
    for (const b of document.querySelectorAll('.quality button')) b.classList.toggle('on', b.dataset.q === q);
  });
}
