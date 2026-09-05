import * as THREE from 'three';

/**
 * Der sichtbare Wasserstrahl.
 *
 * Ein Kegel von der Düse bis zum Auftreffpunkt. Das Rauschen darin scrollt nach
 * außen und lässt den Strahl fließen statt stehen — ein statischer Kegel sieht
 * sofort nach Pappe aus.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform vec3  uColor;
uniform float uTime;
uniform float uPressure;
uniform float uOpacity;

float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float n(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y);
}

void main(){
  // Der Zylinder legt uv.y = 1 an sein +y-Ende. Dieses Ende sitzt nach der
  // Drehung an der Duese, also wird die Achse umgedreht, damit die Laufvariable
  // von 0 (Duese) bis 1 (Auftreffpunkt) geht.
  float along = 1.0 - vUv.y;

  // Strähnen, die nach außen laufen
  float flow = uTime * 5.5;
  float streak = n(vec2(vUv.x * 26.0, along * 7.0 - flow)) * 0.6
               + n(vec2(vUv.x * 60.0, along * 16.0 - flow * 1.7)) * 0.4;

  // Am Anfang dicht und hell, zum Ende hin zerstäubt
  float density = mix(1.0, 0.22, smoothstep(0.0, 0.85, along));
  float core = 1.0 - smoothstep(0.0, 0.45, abs(vUv.x - 0.5) * 2.0);

  float a = density * (0.35 + 0.85 * streak) * (0.25 + 0.75 * core);
  a *= smoothstep(0.0, 0.06, along);            // direkt an der Düse ausblenden
  a *= 1.0 - smoothstep(0.82, 1.0, along);      // am Auftreffpunkt auflösen
  a *= uOpacity * uPressure;

  vec3 col = mix(uColor, vec3(1.0), core * 0.6 + streak * 0.25);
  gl_FragColor = vec4(col, a);
}
`;

export class JetBeam {
  constructor(scene) {
    // Kegel entlang -Z mit Länge 1; wird pro Frame auf die Trefferdistanz
    // skaliert. Der schmale Radius liegt an der Düse, der weite am Auftreffpunkt.
    const geo = new THREE.CylinderGeometry(0.16, 1, 1, 18, 6, true);
    geo.translate(0, -0.5, 0);   // Düsenende in den Ursprung
    // rotateX(+90°) bildet -y auf -z ab; mit -90° zeigte der Strahl nach hinten.
    geo.rotateX(Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0xbfe6ff) },
        uTime: { value: 0 },
        uPressure: { value: 0 },
        uOpacity: { value: 0.85 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);

    this._up = new THREE.Vector3(0, 1, 0);
    this._q = new THREE.Quaternion();
    this._fwd = new THREE.Vector3(0, 0, -1);
  }

  update(dt, jet, distance) {
    this.material.uniforms.uTime.value += dt;
    this.material.uniforms.uPressure.value = jet.pressure;

    if (jet.pressure < 0.02) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    const len = Math.max(0.2, distance);
    this.mesh.position.copy(jet.origin);
    this._q.setFromUnitVectors(this._fwd, jet.dir);
    this.mesh.quaternion.copy(this._q);

    // Radius wächst mit der Streuung; Länge bis zum Auftreffpunkt
    const rFar = jet.radius + len * jet.spread;
    this.mesh.scale.set(rFar, rFar, len);

    // Ein breit gefächerter Strahl ist pro Fläche dünner und damit blasser
    this.material.uniforms.uOpacity.value = THREE.MathUtils.clamp(0.34 / Math.max(rFar, 0.02), 0.25, 0.85);
  }

  setColor(hex) {
    this.material.uniforms.uColor.value.setHex(hex);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
