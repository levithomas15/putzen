import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BloomPass } from './BloomPass.js';

/**
 * Qualitätsstufen. Sie steuern nicht nur das Postprocessing, sondern auch die
 * Auflösung der Dreckmasken — dort liegt der größte Speicher- und Füllratenposten.
 */
export const QUALITY = {
  low: {
    pixelRatio: 1,
    shadowMap: 1024,
    ao: false,
    bloom: true,
    bloomStrength: 0.14,
    smaa: false,
    maskScale: 0.5,
    bakeScale: 0.5,
    sprayParticles: 220,
    mistParticles: 90,
  },
  medium: {
    pixelRatio: 1.5,
    shadowMap: 2048,
    ao: true,
    aoSamples: 8,
    bloom: true,
    bloomStrength: 0.17,
    smaa: true,
    maskScale: 1,
    bakeScale: 1,
    sprayParticles: 480,
    mistParticles: 200,
  },
  high: {
    pixelRatio: 2,
    shadowMap: 4096,
    ao: true,
    aoSamples: 16,
    bloom: true,
    bloomStrength: 0.2,
    smaa: true,
    maskScale: 1.5,
    bakeScale: 2,
    sprayParticles: 900,
    mistParticles: 380,
  },
};

export class Stage {
  constructor(canvas, quality = 'medium', usePost = true, overrides = {}) {
    this.canvas = canvas;
    this.quality = QUALITY[quality] ? quality : 'medium';
    this.usePost = usePost; // zum Eingrenzen von Fehlern abschaltbar
    this.overrides = overrides; // einzelne Pässe gezielt abschalten

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // SMAA übernimmt das im Composer
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Empirisch eingestellt (siehe Belichtungsreihe): der Himmel aus dem
    // Streuungsmodell liefert Strahldichten weit über 1, bei Belichtung 1.0
    // brennt jede Fläche aus. 0.55 ergibt Mitteltöne um 120 bei einem Himmel
    // um 190 — also Reserve nach oben für nasse Glanzlichter und Bloom.
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft ist in three 185 veraltet

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 220);
    this.camera.position.set(0, 1.65, 5);

    // Der Reiniger wird in einer eigenen Szene über dem Bild gerendert, damit er
    // nie in Wänden steckt und eine eigene, engere Brennweite haben kann.
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(52, 1, 0.01, 5);

    this._buildComposer();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  get settings() {
    return { ...QUALITY[this.quality], ...this.overrides };
  }

  _buildComposer() {
    const q = this.settings;
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const w = Math.max(2, size.x);
    const h = Math.max(2, size.y);

    if (this.composer) this.composer.dispose();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    if (q.ao) {
      this.gtao = new GTAOPass(this.scene, this.camera, w, h);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.55;
      this.gtao.updateGtaoMaterial({
        // Kleiner Radius: die Verdeckung soll Kanten und Fugen andeuten,
        // nicht ganze Spalten auf Schwarz ziehen.
        radius: 0.25,
        distanceExponent: 1.2,
        thickness: 0.3,
        scale: 1.0,
        samples: q.aoSamples ?? 8,
        screenSpaceRadius: false,
      });
      this.composer.addPass(this.gtao);
    } else {
      this.gtao = null;
    }

    if (q.bloom) {
      // Feiner Bloom: er soll nasse Glanzlichter und Wassernebel adeln,
      // nicht das ganze Bild in Watte packen.
      this.bloom = new BloomPass(w, h, {
        strength: q.bloomStrength,
        // Der Himmel aus dem Streuungsmodell liegt im Linearraum bei
        // Werten weit über 1. Eine Schwelle knapp unter 1 lässt ihn
        // vollständig durch, und die breite Unschärfe legt daraufhin einen
        // milchigen Schleier über das ganze Bild. Höhere Schwelle plus enge
        // Deckelung lassen nur noch echte Glanzlichter leuchten.
        threshold: 2.2,
        knee: 0.7,
        radius: 1.0,
        clamp: 5.0,
        levels: this.quality === 'low' ? 4 : 5,
      });
      this.composer.addPass(this.bloom);
    } else {
      this.bloom = null;
    }

    if (q.smaa) this.composer.addPass(new SMAAPass());

    this.composer.addPass(new OutputPass());
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.quality) return false;
    this.quality = name;
    this._buildComposer();
    this.resize();
    return true;
  }

  resize() {
    const w = window.innerWidth || 1280;
    const h = window.innerHeight || 720;
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.pixelRatio);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
  }

  render() {
    if (this.usePost) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    // Viewmodel obendrauf, mit frischem Tiefenpuffer.
    const r = this.renderer;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.viewScene, this.viewCamera);
    r.autoClear = true;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
