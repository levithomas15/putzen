/**
 * Syntaxprüfung über alle Quelldateien.
 *
 * Klingt banal, fängt aber genau den Fehler, der beim Bauen dieses Projekts
 * zweimal zugeschlagen hat: ein Backtick in einem Kommentar innerhalb eines
 * Shader-Template-Literals beendet den String, und der Rest des Shaders wird
 * plötzlich als JavaScript gelesen. Der Fehler zeigt sich erst zur Laufzeit im
 * Browser — hier fällt er in einer Sekunde auf.
 */
import { readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const roots = ['src', 'scripts'];
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(name)) files.push(p);
  }
}
for (const r of roots) walk(r);

let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.log(`✖ ${f}\n${String(e.stderr).split('\n').slice(0, 4).join('\n')}`);
  }
}
console.log(bad === 0 ? `✓ ${files.length} Dateien, keine Syntaxfehler` : `✖ ${bad} Datei(en) fehlerhaft`);
process.exit(bad === 0 ? 0 : 1);
