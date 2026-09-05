import * as THREE from 'three';

/**
 * Die Dreckmaske eines Objekts.
 *
 * Kanalbelegung (bewusst so gewählt, damit ein einziger Malvorgang genügt):
 *   R = Dreck      wird beim Putzen abgezogen  (ReverseSubtract auf RGB)
 *   G = Variation  statisch, steuert Algen und Fleckenfarbe
 *   B = frei
 *   A = Nässe      wird beim Putzen addiert    (Add auf Alpha)
 *
 * Weil RGB und Alpha in WebGL getrennte Blend-Gleichungen haben dürfen, lassen
 * sich Dreck-Abtrag und Nässe-Auftrag in einem Durchgang erledigen.
 */

/** Texel je Meter — bestimmt, wie fein der Strahl zeichnen kann. */
const TEXELS_PER_METER = 190;

export class DirtMask {
  /**
   * @param {THREE.Mesh} mesh      Objekt mit aMaskUv-Attribut
   * @param {number} qualityScale  aus der Qualitätsstufe
   */
  constructor(mesh, qualityScale = 1) {
    this.mesh = mesh;
    const area = mesh.geometry.userData.surfaceArea ?? 1;

    // Auflösung an der tatsächlichen Fläche ausrichten: ein Blumentopf braucht
    // keine 1024er Maske, das Deck schon.
    const ideal = Math.sqrt(area) * TEXELS_PER_METER * qualityScale;
    const size = THREE.MathUtils.clamp(2 ** Math.round(Math.log2(Math.max(ideal, 1))), 128, 1024);
    this.size = size;

    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      colorSpace: THREE.NoColorSpace,
    });

    this.texture = this.target.texture;
    this.area = area;

    // Für die Fortschrittsmessung
    this.initialDirt = 1; // wird nach dem Säen gesetzt
    this.currentDirt = 1;
    this.progress = 0;
    this.done = false;

    // Nässe: nur solange abtrocknen lassen, wie es etwas zu trocknen gibt
    this.wetUntil = 0;

    // Weltraum-Hülle, um weit entfernte Objekte beim Malen zu überspringen
    mesh.geometry.computeBoundingSphere();
    this.boundingSphere = new THREE.Sphere();
  }

  updateBounds() {
    this.boundingSphere.copy(this.mesh.geometry.boundingSphere).applyMatrix4(this.mesh.matrixWorld);
  }

  dispose() {
    this.target.dispose();
  }
}
