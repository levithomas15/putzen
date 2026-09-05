/**
 * Fernsteuerung für Screenshots und Tests.
 *
 * Hängt sich an `window.__putzen` und treibt dasselbe Input-Objekt an, das auch
 * der Mensch benutzt — es gibt also keinen zweiten Steuerungspfad, der auseinander
 * laufen könnte.
 */
export function installDevHarness(game) {
  const api = {
    ready: false,
    game,

    /** Wartet, bis n Frames gerendert wurden. */
    frames(n = 1) {
      return new Promise((resolve) => game.waitFrames(n, resolve));
    },

    /**
     * Ein Steuerbefehl:
     *   { look: [dx, dy] }   Blickrichtung ändern (Radiant)
     *   { move: [x, z] }     Bewegungsachsen halten
     *   { spray: true }      Abzug ziehen
     *   { frames: n }        n Frames laufen lassen
     *   { sweep: sekunden }  langsam über die Fläche schwenken und dabei putzen
     */
    async drive(cmd = {}) {
      const input = game.input;
      input.setScripted(true);

      if (cmd.look) input.scriptLook(cmd.look[0], cmd.look[1]);
      if (cmd.move) input.scriptMove(cmd.move[0], cmd.move[1]);
      if (cmd.spray !== undefined) input.scriptFire(!!cmd.spray);

      if (cmd.sweep) {
        // Achterförmiger Schwenk, damit eine sichtbare Fläche frei wird.
        const total = Math.round(cmd.sweep * 30);
        for (let i = 0; i < total; i++) {
          const t = (i / total) * Math.PI * 4;
          input.scriptLook(Math.cos(t) * 0.022, Math.sin(t * 2) * 0.009);
          await api.frames(1);
        }
      }

      if (cmd.frames) await api.frames(cmd.frames);
      if (cmd.move) input.scriptMove(0, 0);
      return api.stats();
    },

    stats: () => game.stats(),

    /**
     * Bildhelligkeit messen.
     *
     * Der Umweg über ein 2D-Canvas ist nötig: `gl.readPixels` auf dem
     * Standard-Framebuffer liefert in dieser Umgebung Nullen, sobald der
     * Compositor den Puffer übernommen hat. `drawImage` holt dagegen genau das
     * Bild, das auch auf dem Schirm steht.
     *
     * @param {object} region  Anteile 0..1: { x, y, w, h }
     */
    sample(region = {}) {
      const canvas = game.canvas;
      const scratch = document.createElement('canvas');
      const w = (scratch.width = Math.min(canvas.width, 480));
      const h = (scratch.height = Math.min(canvas.height, 300));
      const ctx = scratch.getContext('2d', { willReadFrequently: true });

      game.stage.render();
      ctx.drawImage(canvas, 0, 0, w, h);

      const x0 = Math.floor((region.x ?? 0) * w);
      const y0 = Math.floor((region.y ?? 0) * h);
      const rw = Math.max(1, Math.floor((region.w ?? 1) * w));
      const rh = Math.max(1, Math.floor((region.h ?? 1) * h));
      const data = ctx.getImageData(x0, y0, rw, rh).data;

      let r = 0, g2 = 0, b = 0, max = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g2 += data[i + 1]; b += data[i + 2];
        const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (v > max) max = v;
      }
      const n = data.length / 4;
      return {
        mean: +(((r + g2 + b) / 3) / n).toFixed(1),
        rgb: [Math.round(r / n), Math.round(g2 / n), Math.round(b / n)],
        max: Math.round(max),
      };
    },
  };

  window.__putzen = api;
  return api;
}
