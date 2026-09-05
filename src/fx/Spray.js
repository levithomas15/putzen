import * as THREE from 'three';

/**
 * Wasserspritzer und Nebel am Auftreffpunkt.
 *
 * Zwei Punktwolken mit unterschiedlichem Charakter:
 *  - Tropfen: schnell, klein, additiv, folgen der Reflexion des Strahls
 *  - Nebel: langsam, groß, halbtransparent, steigt auf und driftet
 *
 * Die Partikel laufen auf der CPU. Bei ein paar hundert Stück ist das billiger
 * als der Verwaltungsaufwand einer GPU-Simulation, und es lässt sich exakt an
 * Oberflächennormale und Druck koppeln.
 */

const VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute float aSeed;
varying float vLife;
varying float vSeed;
uniform float uPixelRatio;
uniform float uViewportHeight;

void main(){
  vLife = aLife;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  // aSize ist ein Durchmesser in Metern. projectionMatrix[1][1] ist
  // 1/tan(fov/2), damit ergibt sich die perspektivisch korrekte Pixelgröße.
  // Die Obergrenze verhindert, dass ein Tropfen direkt vor der Linse den
  // halben Bildschirm füllt und die Füllrate sprengt.
  float px = aSize * uViewportHeight * 0.5 * projectionMatrix[1][1] / max(-mv.z, 0.05);
  gl_PointSize = clamp(px * uPixelRatio, 1.0, 220.0);
}
`;

const DROP_FRAG = /* glsl */ `
precision highp float;
varying float vLife;
varying float vSeed;
uniform vec3 uColor;

void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  // Harter Kern mit weichem Hof -- wirkt wie ein Tropfen, nicht wie Watte
  float core = 1.0 - smoothstep(0.0, 0.55, r);
  float halo = 1.0 - smoothstep(0.3, 1.0, r);
  float a = (core * 0.85 + halo * 0.3) * vLife;
  gl_FragColor = vec4(uColor * (0.7 + 0.6 * core), a);
}
`;

const MIST_FRAG = /* glsl */ `
precision highp float;
varying float vLife;
varying float vSeed;
uniform vec3 uColor;

float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }

void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float soft = 1.0 - smoothstep(0.0, 1.0, r);
  soft *= soft;
  // Etwas Struktur, damit die Wolke nicht wie ein Farbklecks aussieht
  float grain = 0.75 + 0.5 * h(gl_PointCoord * 7.0 + vSeed);
  gl_FragColor = vec4(uColor, soft * vLife * 0.32 * grain);
}
`;

class ParticlePool {
  constructor(scene, count, material) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.size = new Float32Array(count);
    this.seed = new Float32Array(count);
    this.cursor = 0;

    // Ungenutzte Partikel weit weg parken statt zu verstecken
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -9999;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.geometry = geo;
  }

  spawn(x, y, z, vx, vy, vz, life, size) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = 1;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.seed[i] = Math.random() * 10;
  }

  step(dt, gravity, drag) {
    const damping = Math.max(0, 1 - drag * dt);
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      alive++;
      this.life[i] -= dt / this.maxLife[i];
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        this.pos[i * 3 + 1] = -9999;
        continue;
      }
      this.vel[i * 3] *= damping;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damping + gravity * dt;
      this.vel[i * 3 + 2] *= damping;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aLife.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aSeed.needsUpdate = true;
    return alive;
  }

  dispose() {
    this.geometry.dispose();
  }
}

export class SprayFX {
  constructor(scene, settings, pixelRatio = 1) {
    this.dropMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: DROP_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0xd8f0ff) },
        uPixelRatio: { value: pixelRatio },
        uViewportHeight: { value: 720 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mistMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: MIST_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0xeaf6ff) },
        uPixelRatio: { value: pixelRatio },
        uViewportHeight: { value: 720 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.drops = new ParticlePool(scene, settings.sprayParticles, this.dropMaterial);
    this.mist = new ParticlePool(scene, settings.mistParticles, this.mistMaterial);

    this._reflect = new THREE.Vector3();
    this._tangent = new THREE.Vector3();
    this._bitangent = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this._spawnAcc = 0;
    this._mistAcc = 0;
  }

  setPixelRatio(r) {
    this.dropMaterial.uniforms.uPixelRatio.value = r;
    this.mistMaterial.uniforms.uPixelRatio.value = r;
  }

  setViewportHeight(h) {
    this.dropMaterial.uniforms.uViewportHeight.value = h;
    this.mistMaterial.uniforms.uViewportHeight.value = h;
  }

  /**
   * @param {object} hit  { point, normal } oder null
   */
  update(dt, jet, hit) {
    if (hit && jet.pressure > 0.05) {
      this._emit(dt, jet, hit);
    }
    this.drops.step(dt, -9.5, 1.4);
    this.mist.step(dt, 0.55, 0.9); // Nebel steigt leicht auf
  }

  _emit(dt, jet, hit) {
    const p = hit.point;
    const n = hit.normal;
    const pressure = jet.pressure;

    // Reflexion des Strahls an der Oberfläche
    this._reflect.copy(jet.dir).reflect(n);

    // Zwei Achsen in der Oberflächenebene, um den Fächer aufzuspannen.
    // Die Hilfsachse wird so gewählt, dass sie möglichst quer zur Normalen
    // liegt — bei einer fast parallelen Achse wäre das Kreuzprodukt null und
    // die Partikel bekämen NaN-Positionen.
    this._axis.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0);
    this._tangent.crossVectors(this._axis, n).normalize();
    this._bitangent.crossVectors(n, this._tangent).normalize();

    // --- Tropfen ---
    const dropRate = 190 * pressure * (jet.nozzle?.wetGain ?? 2) * 0.4;
    this._spawnAcc += dropRate * dt;
    const dropCount = Math.min(Math.floor(this._spawnAcc), 40);
    this._spawnAcc -= dropCount;

    const speed = 3.4 + 5.0 * pressure;
    const radius = jet.radius + 0.35 * jet.spread;

    for (let i = 0; i < dropCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const ox = Math.cos(a) * r;
      const oy = Math.sin(a) * r;

      // Startpunkt leicht über der Oberfläche, damit nichts einsinkt
      const px = p.x + this._tangent.x * ox + this._bitangent.x * oy + n.x * 0.012;
      const py = p.y + this._tangent.y * ox + this._bitangent.y * oy + n.y * 0.012;
      const pz = p.z + this._tangent.z * ox + this._bitangent.z * oy + n.z * 0.012;

      // Fächer um die Reflexionsrichtung, kräftig gestreut
      const spreadA = Math.random() * Math.PI * 2;
      const spreadR = Math.random() * 0.85;
      const vx = this._reflect.x + n.x * 0.55 + Math.cos(spreadA) * spreadR * this._tangent.x + Math.sin(spreadA) * spreadR * this._bitangent.x;
      const vy = this._reflect.y + n.y * 0.55 + Math.cos(spreadA) * spreadR * this._tangent.y + Math.sin(spreadA) * spreadR * this._bitangent.y;
      const vz = this._reflect.z + n.z * 0.55 + Math.cos(spreadA) * spreadR * this._tangent.z + Math.sin(spreadA) * spreadR * this._bitangent.z;

      const s = speed * (0.55 + Math.random() * 0.9);
      // Tropfendurchmesser in Metern: 4 bis 16 Millimeter
      this.drops.spawn(px, py, pz, vx * s, vy * s, vz * s, 0.25 + Math.random() * 0.5, 0.004 + Math.random() * 0.012);
    }

    // --- Nebel ---
    this._mistAcc += 34 * pressure * dt;
    const mistCount = Math.min(Math.floor(this._mistAcc), 8);
    this._mistAcc -= mistCount;

    for (let i = 0; i < mistCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (radius + 0.06);
      const px = p.x + this._tangent.x * r * Math.cos(a) + this._bitangent.x * r * Math.sin(a) + n.x * 0.05;
      const py = p.y + this._tangent.y * r * Math.cos(a) + this._bitangent.y * r * Math.sin(a) + n.y * 0.05;
      const pz = p.z + this._tangent.z * r * Math.cos(a) + this._bitangent.z * r * Math.sin(a) + n.z * 0.05;

      this.mist.spawn(
        px, py, pz,
        this._reflect.x * 0.5 + (Math.random() - 0.5) * 0.7,
        this._reflect.y * 0.35 + 0.35 + Math.random() * 0.4,
        this._reflect.z * 0.5 + (Math.random() - 0.5) * 0.7,
        0.9 + Math.random() * 1.1,
        0.18 + Math.random() * 0.35, // Nebelschwaden, gut zwei Handbreit
      );
    }
  }

  dispose() {
    this.drops.dispose();
    this.mist.dispose();
    this.dropMaterial.dispose();
    this.mistMaterial.dispose();
  }
}
