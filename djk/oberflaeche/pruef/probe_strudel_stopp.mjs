// Probe STOP im Strudel-Feld (Andreas 2026-09-28) an einer Prüfinstanz, kopflos.
// Aufruf: node djk/oberflaeche/pruef/probe_strudel_stopp.mjs [instanz i]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { starteBrowser } from './cdp.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const I = process.argv[2] ?? 'i';
const K = 'abcdefghi'.indexOf(I) + 1;
const URL_SEITE = `http://127.0.0.1:${47300 + 1000 * K}`;
const ORDNER = `/dev/shm/cypherdj-${I}/erzeuger`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const strom = () => fs.readFileSync(path.join(ORDNER, 'strom1.js'), 'utf8').trim();
const autoDatei = () => { try { return JSON.parse(fs.readFileSync(path.join(ORDNER, 'autonom.json'), 'utf8')).an; } catch { return true; } };
const ergebnisse = [];
const pruefe = (name, ok, ist) => { ergebnisse.push(!!ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} :: ${JSON.stringify(ist)}`); };

fs.writeFileSync(path.join(ORDNER, 'autonom.json'), JSON.stringify({ an: true, zeit: Date.now() }));
const MUSTER = 's("bd*4, hh*8")';
pruefe('Gutfall vorbereitet', spawnSync(path.join(REPO, 'djk/erzeuger/djk-muster'), ['--instanz', I, '--text', MUSTER]).status === 0, strom());
const b = await starteBrowser({ breite: 1920, hoehe: 1080 });
await b.oeffne(URL_SEITE);
await warte(2500);
const feld = () => b.werte(`({ wert: document.querySelector('#muster-feld').value, fehler: document.querySelector('#muster-fehler').textContent,
  auto: document.querySelector('#muster-auto').classList.contains('an'), banner: !document.querySelector('#muster-uebernehmen').hidden,
  knopf: !!document.querySelector('#muster-stopp') })`);
let f = await feld();
pruefe('vorher: Knopf da, Feld zeigt Cyphers Muster, AUTO an', f.knopf && f.wert === MUSTER && f.auto, f);
await b.werte(`document.querySelector('#muster-stopp').click()`);
await warte(3000);
f = await feld();
pruefe('STOP: strom1 ist silence', strom() === 'silence', strom());
pruefe('STOP: AUTO aus (Seite und Datei)', !f.auto && autoDatei() === false, { seite: f.auto, datei: autoDatei() });
pruefe('STOP: Text bleibt im Feld, kein Banner', f.wert === MUSTER && !f.banner, f);
await warte(2500);
f = await feld();
pruefe('nach zwei Abfragen: Text steht noch', f.wert === MUSTER && !f.banner, f);
await b.werte(`document.querySelector('#muster-senden').click()`);
await warte(3000);
pruefe('PLAY danach: Muster läuft wieder', strom() === MUSTER, strom());
// Negativ-Kontrolle: Ctrl+Backspace stoppt, normales Backspace nicht
await b.werte(`document.querySelector('#muster-feld').focus()`);
await b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await warte(2000);
pruefe('Negativ: Backspace ohne Strg stoppt nicht', strom() === MUSTER, strom());
await b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, modifiers: 2 });
await warte(3000);
pruefe('Strg+Backspace stoppt', strom() === 'silence', strom());
const fehler = b.konsole.filter((k) => k.typ === 'error' || k.typ === 'exception');
pruefe('keine Konsolenfehler', fehler.length === 0, fehler);
await b.zu();
console.log(`${ergebnisse.filter(Boolean).length}/${ergebnisse.length}`);
process.exit(ergebnisse.every(Boolean) ? 0 : 1);
