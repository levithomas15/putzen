import * as THREE from 'three';
import { Stage, QUALITY } from './core/Renderer.js';
import { Input } from './core/Input.js';
import { installDevHarness } from './core/DevHarness.js';
import { buildSky, focusSunShadow } from './world/Sky.js';
import { buildLevel } from './world/Scene.js';
import { DirtPainter } from './dirt/DirtPainter.js';
import { ProgressTracker } from './dirt/ProgressTracker.js';
import { Player } from './player/Player.js';
import { PressureWasher, NOZZLES } from './player/PressureWasher.js';
import { JetBeam } from './fx/JetBeam.js';
import { SprayFX } from './fx/Spray.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { JetSound } from './audio/JetSound.js';
import { PumpSound } from './audio/PumpSound.js';
import { Chimes } from './audio/Chimes.js';
import { Ambience } from './audio/Ambience.js';
import { HUD } from './ui/HUD.js';

const params = new URLSearchParams(location.search);
const MILESTONES = [0.25, 0.5, 0.75];

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    const q = params.get('q');
    this.stage = new Stage(this.canvas, QUALITY[q] ? q : 'medium', params.get('post') !== '0', {
      ...(params.get('ao') === '0' ? { ao: false } : {}),
      ...(params.get('bloom') === '0' ? { bloom: false } : {}),
      ...(params.get('smaa') === '0' ? { smaa: false } : {}),
    });
    this.input = new Input(this.canvas);

    this._lastTime = 0; // eigene Zeitmessung; THREE.Clock ist veraltet
    this.frame = 0;
    this._waiters = [];
    this.running = false;
    this.state = 'loading';
    this.THREE = THREE;

    this.totalProgress = 0;
    this.elapsed = 0;
    this._milestone = 0;

    this._ray = new THREE.Raycaster();
    this._hit = null;
    this._hitNormal = new THREE.Vector3();
    this._camFwd = new THREE.Vector3();
    // Rechenobjekte für den Spiel-Loop, damit dort nichts angelegt wird
    this._localHit = new THREE.Vector3();
    this._invCam = new THREE.Quaternion();
  }

  // -------------------------------------------------------------- Aufbau

  async build(onProgress = () => {}) {
    const { scene, renderer } = this.stage;

    onProgress(0.08, 'Himmel und Licht');
    this.sky = buildSky(scene, renderer);
    // Das Ansichtsmodell hat eine eigene Szene und braucht dieselbe
    // Umgebungskarte: die Lanze ist Metall, und Metall ohne Umgebung ist
    // schlicht schwarz — es hat keine diffuse Komponente zum Beleuchten.
    this.stage.viewScene.environment = scene.environment;
    this.stage.viewScene.environmentIntensity = 0.7;

    onProgress(0.2, 'Terrasse wird gebaut');
    this.level = await buildLevel(this.stage, this.sky, {
      onProgress,
      // Fürs schnelle Iterieren im Software-Renderer herunterschaltbar
      bakeScale: params.has('bake') ? Number(params.get('bake')) : undefined,
      maskScale: params.has('mask') ? Number(params.get('mask')) : undefined,
    });
    focusSunShadow(this.sky.sun, this.level.center, this.level.shadowRadius);

    onProgress(0.86, 'Dreck wird verteilt');
    this.painter = new DirtPainter(renderer);
    this.progress = new ProgressTracker(renderer);
    this._seedDirt();

    onProgress(0.93, 'Wird gemessen');
    await this.progress.captureInitial(this.level.cleanables);

    onProgress(0.96, 'Gerät wird angeschlossen');
    this.player = new Player(this.stage.camera, this.level);
    this.washer = new PressureWasher(this.stage);
    this.beam = new JetBeam(scene);
    this.spray = new SprayFX(scene, this.stage.settings, this.stage.renderer.getPixelRatio());
    this.spray.setViewportHeight(this.stage.renderer.domElement.height);
    window.addEventListener('resize', () => {
      this.spray.setViewportHeight(this.stage.renderer.domElement.height);
      this.spray.setPixelRatio(this.stage.renderer.getPixelRatio());
    });

    this.audio = new AudioEngine();
    this.jetSound = new JetSound(this.audio);
    this.pump = new PumpSound(this.audio);
    this.chimes = new Chimes(this.audio);
    this.ambience = new Ambience(this.audio);

    this.hud = new HUD(this.level.cleanables);
    this.hud.setNozzle(this.washer.nozzleIndex);

    this._bindInput();
    onProgress(1, 'Fertig');
  }

  _seedDirt() {
    let i = 0;
    for (const mask of this.level.cleanables) {
      this.painter.seed(mask, { seed: i * 3.77, center: this.level.center, ...mask.seedOptions });
      this.progress.register(mask);
      i++;
    }
  }

  _bindInput() {
    this.input.onNozzle = (i) => this._selectNozzle(i);
    this.input.onToggleList = () => this.hud.toggleChecklist();
    this.input.onPause = () => {
      if (this.state === 'playing') this.setState('paused');
    };
  }

  _selectNozzle(index) {
    if (this.washer.setNozzle(index)) {
      this.hud.setNozzle(this.washer.nozzleIndex);
      this.chimes.clack();
      this.beam.setColor(this.washer.nozzle.tint);
    }
  }

  // -------------------------------------------------------------- Ablauf

  setState(next) {
    if (this.state === next) return;
    this.state = next;

    const menu = document.getElementById('menu');
    const pause = document.getElementById('pause');
    const finish = document.getElementById('finish');

    menu.classList.toggle('hidden', next !== 'menu');
    pause.classList.toggle('hidden', next !== 'paused');
    finish.classList.toggle('hidden', next !== 'finished');
    this.hud.root.classList.toggle('hidden', next !== 'playing');

    if (next === 'playing') {
      this.audio.resume();
    } else if (next === 'paused') {
      this.input.exitLock();
      this.audio.suspend();
    } else if (next === 'finished') {
      this.input.exitLock();
      this.chimes.fanfare();
    }
  }

  async begin() {
    await this.audio.start();
    this.jetSound.start();
    this.pump.start();
    this.ambience.start();
    this.setState('playing');
    if (!params.has('nolock')) this.input.requestLock();
    this.hud.showHint('Linke Maustaste hält den Abzug — halte drauf, bis der Dreck weg ist.', 6);
  }

  waitFrames(n, cb) {
    this._waiters.push({ left: n, cb });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._lastTime = performance.now();
    this.stage.renderer.setAnimationLoop(() => this.tick());
  }

  tick() {
    const now = performance.now();
    // Nach oben begrenzt: nach einem langen Bild soll nicht plötzlich eine
    // halbe Sekunde Spielzeit auf einmal verrechnet werden.
    const dt = Math.min((now - this._lastTime) / 1000, 0.05);
    this._lastTime = now;
    this.frame++;

    if (this.state === 'playing') {
      this.elapsed += dt;
      this.update(dt);
    } else {
      // Auch im Menü weiterlaufen lassen, damit die Szene lebt
      this.washer?.update(dt, false, {});
      this.beam?.update(dt, { pressure: 0, origin: this.stage.camera.position, dir: this._camFwd, radius: 0.01, spread: 0.01 }, 1);
      this.spray?.update(dt, { pressure: 0 }, null);
    }

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
    const wheel = this.input.consumeWheel();
    if (wheel) this._selectNozzle(this.washer.nozzleIndex + Math.sign(wheel));

    // Blickdelta wird vom Spieler verbraucht — vorher für das Nachschwingen merken
    const lookX = this.input.lookX;
    const lookY = this.input.lookY;

    this.player.update(dt, this.input);

    const firing = this.input.firing;
    this.washer.update(dt, firing, {
      lookX,
      lookY,
      speed: this.player.speedSmoothed,
    });

    this._updateJet(dt);
    this._updateProgress(dt);
  }

  /** Strahl auswerten: Treffer suchen, malen, Effekte und Klang setzen. */
  _updateJet(dt) {
    const cam = this.stage.camera;
    const jet = this.washer.getJet(cam);
    const active = jet.pressure > 0.02;

    // --- Auftreffpunkt ---
    let hit = null;
    if (active) {
      this._ray.set(jet.origin, jet.dir);
      this._ray.far = jet.range;
      const hits = this._ray.intersectObjects(this.level.raycastTargets, false);
      if (hits.length) {
        const h = hits[0];
        this._hitNormal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
        const mask = this.level.maskByMesh.get(h.object);
        hit = {
          point: h.point,
          normal: this._hitNormal,
          distance: h.distance,
          object: h.object,
          surface: mask?.surface ?? 'soil',
        };
      }
    }
    this._hit = hit;

    // --- Dreck abtragen ---
    if (active) {
      this.painter.captureJetDepth(this.level.root, jet.origin, jet.dir, jet.range);
      this.painter.paint(this.level.cleanables, jet, dt);
      this.player.addShake(dt * 2.4 * jet.pressure * jet.nozzle.recoil);
    }
    this.painter.dry(this.level.cleanables, dt);

    // --- Bild ---
    this.beam.update(dt, jet, hit ? hit.distance : jet.range);
    this.spray.update(dt, jet, hit);
    this.hud.setFiring(active);

    // --- Ton ---
    let pan = 0;
    if (hit) {
      // Wie weit liegt der Auftreffpunkt seitlich der Blickachse?
      const local = this._localHit
        .subVectors(hit.point, cam.position)
        .applyQuaternion(this._invCam.copy(cam.quaternion).invert());
      pan = THREE.MathUtils.clamp(local.x / Math.max(Math.abs(local.z), 0.5), -1, 1) * 0.7;
    }
    this.jetSound.update({
      pressure: jet.pressure,
      nozzle: jet.nozzle,
      hit: hit ? { distance: hit.distance, surface: hit.surface } : null,
      pan,
    });
    this.pump.update(true, jet.pressure);
  }

  _updateProgress(dt) {
    this.progress.update(this.level.cleanables, 2, (mask) => {
      this.chimes.surfaceDone();
    });
    this.totalProgress = this.progress.total(this.level.cleanables);
    this.hud.update(this.totalProgress);

    while (this._milestone < MILESTONES.length && this.totalProgress >= MILESTONES[this._milestone]) {
      this.chimes.tick(this._milestone);
      this._milestone++;
    }

    if (this.totalProgress >= 0.999 && this.state === 'playing') {
      this._finish();
    }
  }

  _finish() {
    const mins = Math.floor(this.elapsed / 60);
    const secs = Math.floor(this.elapsed % 60);
    document.getElementById('finish-sub').textContent =
      `Alles sauber in ${mins}:${String(secs).padStart(2, '0')} Minuten.`;
    this.setState('finished');
  }

  restart() {
    this._seedDirt();
    this.progress.captureInitial(this.level.cleanables).then(() => {
      this.totalProgress = 0;
      this._milestone = 0;
      this.elapsed = 0;
      this.chimes.reset();
      for (const g of this.hud.groups.values()) {
        g.done = false;
        g._last = -1;
        g.el.classList.remove('done');
      }
      this.player.position.copy(this.level.spawn);
      this.player.yaw = this.level.spawnYaw;
      this.player.pitch = -0.08;
      this.begin();
    });
  }

  stats() {
    return {
      frame: this.frame,
      zustand: this.state,
      qualitaet: this.stage.quality,
      fortschritt: +(this.totalProgress ?? 0).toFixed(4),
      duese: this.washer?.nozzle.name,
      kamera: this.stage.camera.position.toArray().map((v) => +v.toFixed(2)),
      treffer: this._hit ? { material: this._hit.surface, abstand: +this._hit.distance.toFixed(2) } : null,
      zeichenaufrufe: this.stage.renderer.info.render.calls,
      dreiecke: this.stage.renderer.info.render.triangles,
      texturen: this.stage.renderer.info.memory.textures,
      objekte: this.level?.cleanables.map((m) => ({
        id: m.id,
        pct: +(m.progress * 100).toFixed(1),
        maske: m.size,
      })),
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
    game.setState('menu');
    harness.ready = true;
  } catch (err) {
    bootLabel.textContent = 'Fehler beim Laden — siehe Konsole';
    console.error(err);
    throw err;
  }
})();

// --- Bedienelemente ---
document.getElementById('start').addEventListener('click', () => game.begin());
document.getElementById('resume').addEventListener('click', () => game.begin());
document.getElementById('again').addEventListener('click', () => game.restart());

document.getElementById('mute').addEventListener('change', (e) => {
  game.audio.setMuted(e.target.checked);
});

for (const btn of document.querySelectorAll('.quality button')) {
  btn.addEventListener('click', () => {
    const q = btn.dataset.q;
    if (game.stage.setQuality(q)) {
      game.spray?.setPixelRatio(game.stage.renderer.getPixelRatio());
      game.spray?.setViewportHeight(game.stage.renderer.domElement.height);
    }
    for (const b of document.querySelectorAll('.quality button')) {
      b.classList.toggle('on', b.dataset.q === q);
    }
  });
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game.state === 'playing') game.setState('paused');
});
