export default ({ command }) => ({
  // Relative Pfade im Build: damit läuft die Seite unter jedem Unterpfad —
  // github.io/putzen/, eine eigene Domain oder ein umbenanntes Repo, ohne dass
  // hier etwas angepasst werden muss. Im Entwicklungsserver bleibt es bei '/'.
  base: command === 'build' ? './' : '/',
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    target: 'es2022',
    // three.js ist der mit Abstand größte Brocken und ändert sich nie —
    // als eigenes Bündel bleibt es über Updates hinweg im Browser-Cache.
    // Rolldown (ab Vite 8) verlangt hier eine Funktion, die Objektform kennt
    // es nicht mehr.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
});
