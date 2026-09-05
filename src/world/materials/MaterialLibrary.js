import * as THREE from 'three';
import { TextureBaker } from './ProcTextures.js';
import { SURFACES } from './surfaces.js';
import { makeCleanable } from './CleanableMaterial.js';

/**
 * Backt die prozeduralen Oberflächen einmal beim Laden und gibt daraus
 * Materialien aus.
 *
 * Zwei Sorten:
 *  - `base(name)` teilt sich ein Material für alles, was nicht dreckig wird.
 *  - `cleanable(name)` gibt einen eigenen Klon je Mesh — jedes putzbare Objekt
 *    braucht seine eigene Maske und damit sein eigenes Material.
 *
 * Die gebackenen Karten werden dabei geteilt, geklont wird nur die dünne
 * Materialhülle.
 */
export class MaterialLibrary {
  constructor(renderer, bakeScale = 1) {
    this.baker = new TextureBaker(renderer);
    this.maps = new Map();
    this.bases = new Map();
    this.bakeScale = bakeScale;
  }

  /** Alle Oberflächen backen. `onStep` meldet den Fortschritt. */
  async bakeAll(onStep = () => {}) {
    const names = Object.keys(SURFACES);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      this._bake(name);
      onStep((i + 1) / names.length, name);
      // Dem Browser zwischen den Backvorgängen Luft lassen, damit der
      // Ladebalken nicht einfriert.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  _bake(name) {
    if (this.maps.has(name)) return this.maps.get(name);
    const def = SURFACES[name];
    if (!def) throw new Error(`Unbekannte Oberfläche: ${name}`);

    const uniforms = {};
    for (const [k, v] of Object.entries(def.uniforms ?? {})) {
      uniforms[k] = Array.isArray(v) ? new THREE.Vector3(...v) : v;
    }

    const size = THREE.MathUtils.clamp(
      2 ** Math.round(Math.log2((def.size ?? 512) * this.bakeScale)), 64, 2048,
    );
    const maps = this.baker.bake(def.glsl, {
      size,
      normalStrength: def.normalStrength ?? 1,
      uniforms,
    });
    maps.worldSize = def.worldSize ?? 1;
    this.maps.set(name, maps);
    return maps;
  }

  /** Weltmaß einer Kachel — die Geometrie skaliert ihre UVs danach. */
  worldSize(name) {
    return SURFACES[name]?.worldSize ?? 1;
  }

  _makeMaterial(name, opts = {}) {
    const maps = this._bake(name);
    return new THREE.MeshStandardMaterial({
      map: maps.albedo,
      normalMap: maps.normal,
      roughnessMap: maps.orm, // three liest den Grünkanal
      metalnessMap: maps.orm, // ... und den Blaukanal
      roughness: 1,
      metalness: 1,
      normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
      envMapIntensity: opts.envMapIntensity ?? 1,
      color: opts.color ?? 0xffffff,
      side: opts.side ?? THREE.FrontSide,
    });
  }

  /** Geteiltes Material für nicht putzbare Flächen. */
  base(name, opts = {}) {
    const key = `${name}|${JSON.stringify(opts)}`;
    if (!this.bases.has(key)) this.bases.set(key, this._makeMaterial(name, opts));
    return this.bases.get(key);
  }

  /** Eigenes, putzbares Material — je Mesh eines. */
  cleanable(name, opts = {}) {
    const mat = this._makeMaterial(name, opts);
    return makeCleanable(mat, opts.dirt ?? {});
  }

  dispose() {
    for (const m of this.maps.values()) for (const t of m._targets) t.dispose();
    for (const m of this.bases.values()) m.dispose();
  }
}
