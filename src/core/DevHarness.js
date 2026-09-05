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
  };

  window.__putzen = api;
  return api;
}
