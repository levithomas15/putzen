/**
 * Screenshot-Werkzeug zum Iterieren am Look.
 *
 * Startet den Vite-Dev-Server, öffnet das Spiel im Headless-Chromium, spielt eine
 * kleine Skriptsequenz ab (umsehen, laufen, spritzen) und legt PNGs in shots/ ab.
 *
 *   npm run shot                     -- Standardsequenz
 *   npm run shot -- --spray 6        -- 6 Sekunden spritzen
 *   npm run shot -- --quality high
 *
 * Achtung: headless läuft WebGL über SwiftShader (Software). Bilder stimmen,
 * Bildraten sind nicht aussagekräftig.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const OUT = 'shots';
const PORT = 5199;
const QUALITY = opt('quality', 'medium');
// Auf SwiftShader ist das Backen der Texturen der Flaschenhals -- fürs
// Iterieren kleiner, für Abnahmebilder auf 1 stellen.
const BAKE = opt('bake', '0.25');
const MASK = opt('mask', '0.35');
const SPRAY_SECONDS = Number(opt('spray', 4));
const WIDTH = Number(opt('w', 1280));
const HEIGHT = Number(opt('h', 720));

async function startServer() {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite startete nicht rechtzeitig')), 60000);
    const onData = (d) => {
      if (/Local:|ready in/.test(String(d))) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (c) => reject(new Error(`Vite beendet mit Code ${c}`)));
  });
  await sleep(600);
  return proc;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer();
  console.log(`▶ Vite läuft auf :${PORT}`);

  const browser = await chromium.launch({
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--disable-lcd-text',
      '--force-device-scale-factor=1',
    ],
  });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

  const logs = [];
  page.on('console', (m) => {
    const t = `[${m.type()}] ${m.text()}`;
    logs.push(t);
    if (m.type() === 'error' || m.type() === 'warning') console.log('  ' + t);
  });
  page.on('pageerror', (e) => {
    logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`);
    console.log('  ✖ ' + e.message);
  });

  await page.goto(`http://127.0.0.1:${PORT}/?q=${QUALITY}&bake=${BAKE}&mask=${MASK}&nolock=1`, { waitUntil: 'load' });

  // Auf das fertig gebaute Level warten und dabei melden, wo es gerade steht.
  const t0 = Date.now();
  const ticker = setInterval(async () => {
    try {
      const label = await page.evaluate(() => document.getElementById('boot-label')?.textContent);
      console.log(`  … ${((Date.now() - t0) / 1000).toFixed(0)}s: ${label}`);
    } catch { /* Seite gerade beschäftigt */ }
  }, 4000);
  try {
    await page.waitForFunction(() => window.__putzen?.ready === true, null, { timeout: 420000 });
  } finally {
    clearInterval(ticker);
  }
  console.log(`▶ Level bereit nach ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`  ✎ ${OUT}/${name}.png`);
  };

  // Der Screenshot-Modus umgeht PointerLock und steuert die Kamera direkt.
  const drive = (cmd) => page.evaluate((c) => window.__putzen.drive(c), cmd);

  await shot('00-menue');

  // Ins Spiel: Overlay weg, HUD an.
  // Direkt auslösen: mit dem Software-Renderer ist der Hauptthread zu
  // beschäftigt für Playwrights Stabilitätsprüfung.
  await page.evaluate(() => document.getElementById('start').click());
  await page.waitForTimeout(800);
  await drive({ frames: 5 });
  await shot('01-start');

  await drive({ look: [0, 0.12], frames: 12 });
  await shot('02-terrasse');

  await drive({ move: [0, 1], frames: 45 });
  await drive({ look: [-0.55, 0.1], frames: 12 });
  await shot('03-naeher');

  if (SPRAY_SECONDS > 0) {
    await drive({ spray: true, look: [0, 0.35], frames: 10 });
    await drive({ spray: true, sweep: SPRAY_SECONDS });
    await shot('04-geputzt');
    await drive({ spray: false, frames: 5 });
  }

  const stats = await page.evaluate(() => window.__putzen.stats());
  console.log('▶ Status:', JSON.stringify(stats, null, 2));
  await writeFile(`${OUT}/log.txt`, logs.join('\n'), 'utf8');

  await browser.close();
  server.kill('SIGTERM');

  const errors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
  if (errors.length) {
    console.log(`\n✖ ${errors.length} Fehler — siehe ${OUT}/log.txt`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ keine Fehler');
  }
  if (flag('keep')) return;
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
