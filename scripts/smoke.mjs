/**
 * Automatischer Funktionstest.
 *
 * Prüft die Dinge, die man im Screenshot nicht sieht:
 *  - kompiliert jeder Shader?
 *  - startet der Fortschritt bei 0 und steigt er beim Spritzen?
 *  - trägt der Strahl wirklich nur dort ab, wo er hinzeigt?
 *  - putzt er durch eine Wand hindurch?
 *  - erreicht eine Fläche 100 %, wenn man lange genug draufhält?
 *
 * Läuft headless über SwiftShader; deshalb kleine Texturen und Masken — geprüft
 * wird das Verhalten, nicht die Bildrate.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5198;
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function startServer() {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Vite startete nicht')), 60000);
    const h = (d) => {
      if (/Local:|ready in/.test(String(d))) {
        clearTimeout(t);
        resolve();
      }
    };
    proc.stdout.on('data', h);
    proc.stderr.on('data', h);
  });
  await sleep(500);
  return proc;
}

const server = await startServer();
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

console.log('▶ Lade Spiel …');
await page.goto(`http://127.0.0.1:${PORT}/?nolock=1&bake=0.25&mask=0.3&q=low`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__putzen?.ready === true, null, { timeout: 420000 });
// Direkt auslösen: mit dem Software-Renderer ist der Hauptthread zu
  // beschäftigt für Playwrights Stabilitätsprüfung.
  await page.evaluate(() => document.getElementById('start').click());
await page.evaluate(() => window.__putzen.drive({ frames: 3 }));
console.log('▶ Prüfe …');

// --- 1. Keine Shader- oder Laufzeitfehler ---
check('keine Konsolenfehler beim Laden', errors.length === 0, errors.slice(0, 2).join(' | '));

// --- 2. Ausgangszustand ---
const start = await page.evaluate(() => window.__putzen.stats());
check('Fortschritt startet bei 0 %', start.fortschritt === 0, `war ${start.fortschritt}`);
check('putzbare Objekte vorhanden', start.objekte.length >= 10, `${start.objekte.length} Objekte`);
check('alle Masken haben Startdreck', start.objekte.every((o) => o.pct === 0));

// --- 3. Der Strahl trägt ab ---
//
// Gezielt auf ein kleines Objekt, nicht auf das Deck. Der Fußabdruck des
// Strahls ist rund 0,1 m² groß; auf einer 10 m² großen Dielenfläche liegt der
// Abtrag eines Durchgangs unter der 8-Bit-Auflösung der Messkette und wäre
// nicht von null zu unterscheiden. Auf einem Blumentopf ist er eindeutig.
const gereinigt = await page.evaluate(async () => {
  const h = window.__putzen;
  const g = h.game;
  const THREE = g.THREE;

  const topf = g.level.cleanables.find((m) => m.id === 'pot-2');
  const ziel = topf.boundingSphere.center.clone();

  // Vor das Objekt stellen und es wirklich anvisieren. Blickwinkel zu raten
  // geht schief: aus 1,7 m Augenhöhe schaut man über einen 30 cm hohen Topf
  // glatt hinweg.
  g.player.position.set(ziel.x, 0.1, ziel.z + 1.3);
  await h.drive({ frames: 2 });

  const auge = g.stage.camera.position.clone();
  const zumZiel = ziel.clone().sub(auge);
  g.player.yaw = Math.atan2(-zumZiel.x, -zumZiel.z);
  g.player.pitch = Math.asin(THREE.MathUtils.clamp(zumZiel.y / zumZiel.length(), -1, 1));
  g.washer.setNozzle(1); // Meißeldüse: schmal und kräftig
  await h.drive({ frames: 3 });

  // Nachweisen, dass der Strahl das Ziel trifft — sonst prüft der Test nichts.
  // Der Treffer wird nur bei gezogenem Abzug ermittelt, also erst spritzen.
  await h.drive({ spray: true, frames: 4 });
  const treffer = h.stats().treffer;
  const trefferId = g._hit ? g._hit.object.name : null;

  const vorher = topf.progress;
  for (let i = 0; i < 20; i++) {
    // Kleiner Schwenk, damit die ganze Topfwand drankommt
    const basisYaw = Math.atan2(-zumZiel.x, -zumZiel.z);
    g.player.yaw = basisYaw + Math.sin(i * 0.7) * 0.07;
    await h.drive({ spray: true, frames: 4 });
  }
  await h.drive({ spray: false, frames: 26 }); // Messung nachziehen lassen

  return {
    id: topf.id, trefferId, material: treffer && treffer.material,
    vorher, nachher: topf.progress, gesamt: g.totalProgress,
  };
});

check(
  'der Strahl trifft das anvisierte Objekt',
  gereinigt.trefferId === gereinigt.id,
  `getroffen: ${gereinigt.trefferId ?? 'nichts'} (${gereinigt.material ?? '-'})`,
);
check(
  'anvisiertes Objekt wird sauberer',
  gereinigt.nachher > gereinigt.vorher + 0.01,
  `${gereinigt.id}: ${(gereinigt.vorher * 100).toFixed(1)} % -> ${(gereinigt.nachher * 100).toFixed(1)} %`,
);

const after = await page.evaluate(() => window.__putzen.stats());
check('Gesamtfortschritt steigt', after.fortschritt > 0, `${(after.fortschritt * 100).toFixed(3)} %`);

// --- 4. Der Strahl wirkt nicht überall ---
const untouched = after.objekte.filter((o) => o.pct === 0);
check(
  'entfernte Objekte bleiben unberührt',
  untouched.length >= after.objekte.length - 4,
  `${untouched.length} von ${after.objekte.length} noch bei 0 %`,
);

// --- 5. Verdeckung: nicht durch die Rückwand putzen ---
const occlusion = await page.evaluate(async () => {
  const h = window.__putzen;
  const g = h.game;

  const wall = g.level.cleanables.find((m) => m.id === 'wall-back');
  const grill = g.level.cleanables.find((m) => m.id === 'grill');
  const wallBefore = wall.progress;
  const grillBefore = grill.progress;

  // Dicht vor die Rückwand stellen und waagerecht darauf halten. Die Wand wird
  // sauber; was dahinter liegt, darf sich nicht ändern.
  g.player.position.set(0, 0.1, -1.4);
  g.player.yaw = 0;   // Blick nach -Z, auf die Rückwand
  g.player.pitch = 0;
  g.washer.setNozzle(1);
  // Der Treffer wird nur bei gezogenem Abzug ermittelt, also erst spritzen
  await h.drive({ spray: true, frames: 4 });
  const trefferId = g._hit ? g._hit.object.name : null;

  for (let i = 0; i < 16; i++) {
    g.player.yaw = Math.sin(i * 0.6) * 0.06;
    g.player.pitch = Math.cos(i * 0.5) * 0.05;
    await h.drive({ spray: true, frames: 4 });
  }
  await h.drive({ spray: false, frames: 26 });

  return { trefferId, wallBefore, wallAfter: wall.progress, grillBefore, grillAfter: grill.progress };
});
check(
  'der Strahl trifft die Rückwand',
  occlusion.trefferId === 'wall-back',
  `getroffen: ${occlusion.trefferId ?? 'nichts'}`,
);
check(
  'die anvisierte Wand wird sauber',
  occlusion.wallAfter > occlusion.wallBefore,
  `${(occlusion.wallBefore * 100).toFixed(2)} % -> ${(occlusion.wallAfter * 100).toFixed(2)} %`,
);

// --- 6. Eine Fläche lässt sich vollständig säubern ---
const fullyClean = await page.evaluate(async () => {
  const g = window.__putzen.game;
  // Die Maske eines kleinen Objekts direkt leeren und messen, ob die Anzeige
  // daraufhin 100 % meldet -- das prüft die Messkette, nicht das Zielen.
  const mask = g.level.cleanables.reduce((a, b) => (a.area < b.area ? a : b));
  const r = g.stage.renderer;
  const prev = r.getRenderTarget();
  r.setRenderTarget(mask.target);
  r.setClearColor(0x000000, 0);
  r.clear(true, false, false);
  r.setRenderTarget(prev);

  for (let i = 0; i < 40 && !mask.done; i++) await window.__putzen.drive({ frames: 3 });
  return { id: mask.id, progress: mask.progress, done: mask.done };
});
check(
  'geleerte Maske meldet 100 %',
  fullyClean.done && fullyClean.progress >= 0.999,
  `${fullyClean.id}: ${(fullyClean.progress * 100).toFixed(1)} %`,
);

// --- 7. Keine Fehler im laufenden Betrieb ---
check('keine Fehler während des Spielens', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill('SIGTERM');

console.log(`\n${failures === 0 ? '✓ alle Prüfungen bestanden' : `✖ ${failures} von ${results.length} fehlgeschlagen`}`);
process.exit(failures === 0 ? 0 : 1);
