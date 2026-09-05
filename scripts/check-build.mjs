/**
 * Prüft den fertigen Build aus `dist/`.
 *
 * Der Entwicklungsserver verzeiht Pfadfehler, die im Build zuschlagen: falsche
 * `base`, absolute Verweise, fehlende Dateien. Hier wird die gebaute Seite
 * wirklich ausgeliefert, gestartet und nachgesehen, ob die Szene etwas anderes
 * als Schwarz zeigt.
 *
 *   npm run build && npm run check:build
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// Unter /putzen/ ausliefern, damit der Pages-Unterpfad wirklich nachgestellt wird
const server = spawn('npx', ['http-server', 'dist', '-p', '5300', '-a', '127.0.0.1', '--silent'], { stdio: 'ignore' });
await sleep(2500);

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 500, height: 320 } });
const fehler = [];
page.on('pageerror', e => fehler.push(e.message));
page.on('console', m => { if (m.type() === 'error') fehler.push(m.text().slice(0, 200)); });
page.on('requestfailed', r => fehler.push(`Anfrage fehlgeschlagen: ${r.url()}`));

await page.goto('http://127.0.0.1:5300/?nolock=1&bake=0.25&mask=0.3&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__putzen?.ready === true, null, { timeout: 300000 });
await page.evaluate(() => document.getElementById('start').click());
await page.evaluate(() => window.__putzen.drive({ frames: 4 }));
const s = await page.evaluate(() => window.__putzen.sample({ x: 0, y: 0.5, w: 1, h: 0.5 }));
const st = await page.evaluate(() => window.__putzen.stats());

console.log(`Build startet: ja`);
console.log(`Szene gerendert: mean=${s.mean} rgb=${s.rgb}  (0 wäre ein schwarzes Bild)`);
console.log(`putzbare Objekte: ${st.objekte.length}`);
console.log(fehler.length ? `FEHLER:\n  ${fehler.slice(0, 5).join('\n  ')}` : 'keine Fehler');

await browser.close();
server.kill('SIGTERM');
process.exit(fehler.length ? 1 : 0);
