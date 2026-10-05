// Probe Plan 2 T4/T5 (Strudel-Feld, AUTO-Schalter) am laufenden Stapel einer Prüfinstanz, kopflos.
// Aufruf: node djk/oberflaeche/pruef/probe_strudel_feld.mjs [instanz i] [bildordner]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { starteBrowser } from './cdp.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const I = process.argv[2] ?? 'i';
const BILDER = process.argv[3] ?? '/tmp';
const K = 'abcdefghi'.indexOf(I) + 1;
const URL_SEITE = `http://127.0.0.1:${47300 + 1000 * K}`;
const ORDNER = `/dev/shm/cypherdj-${I}/erzeuger`;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const muster = (text) => spawnSync(path.join(REPO, 'djk/erzeuger/djk-muster'), ['--instanz', I, '--text', text], { encoding: 'utf8' });
const strom = () => fs.readFileSync(path.join(ORDNER, 'strom1.js'), 'utf8').trim();
const ergebnisse = [];
const pruefe = (name, ok, ist) => { ergebnisse.push({ name, ok: !!ok, ist }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} :: ${JSON.stringify(ist)}`); };

const b = await starteBrowser({ breite: 1920, hoehe: 1080 });
const feld = () => b.werte(`({ wert: document.querySelector('#muster-feld').value, stand: document.querySelector('#muster-stand').textContent,
  fehler: document.querySelector('#muster-fehler').textContent, fehlerKlasse: ['fehler', 'ok'].find((k) => document.querySelector('#muster-fehler').classList.contains(k)) ?? '',
  auto: document.querySelector('#muster-auto').classList.contains('an'), banner: document.querySelector('#muster-uebernehmen').hidden ? null : document.querySelector('#muster-uebernehmen').textContent })`);
const tippe = async (text, ersetzen = true) => {
  await b.werte(`(() => { const f = document.querySelector('#muster-feld'); f.focus(); ${ersetzen ? 'f.select();' : ''} })()`);
  await b.sende('Input.insertText', { text });
};
const strgEnter = () => b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 });

try {
  // Ausgangslage: AUTO an, Cypher-Muster liegt
  execFileSync('curl', ['-s', '-X', 'POST', `${URL_SEITE}/strudel/autonom`, '-H', 'content-type: application/json', '-d', '{"an":true}']);
  pruefe('Start: djk-muster als Cypher', muster('s("bd*4, hh*8")').status === 0, strom());
  await b.oeffne(`${URL_SEITE}/`);
  await warte(1500);
  await b.bild(path.join(BILDER, 'feld-1-start.png'));
  let f = await feld();
  pruefe('T4.4 Feld zeigt laufenden Text, by cypher, AUTO an', f.wert === 's("bd*4, hh*8")' && /by cypher/.test(f.stand) && f.auto, f);

  // T5.1 Cypher schreibt, Feld sauber → binnen 1,5 s im Feld
  const t0 = Date.now();
  pruefe('T5.1 djk-muster rc 0', muster('s("hh*16")').status === 0, strom());
  let bis = null;
  for (let i = 0; i < 30; i++) { f = await feld(); if (f.wert === 's("hh*16")') { bis = Date.now() - t0; break; } await warte(50); }
  pruefe('T5.1 Feld folgt ≤ 1,5 s, by cypher', bis !== null && bis <= 1500 && /by cypher/.test(f.stand), { ms: bis, ...f });
  await warte(4000);   // T6: status.json vom Erzeuger (nach dem Übernehmen am Takt)
  f = await feld();
  const st = JSON.parse(fs.readFileSync(path.join(ORDNER, 'status.json'), 'utf8'));
  pruefe('T6 status.json ab_beat auf Takt-Eins, Feld „since bar n“', st.ab_beat % 4 === 0 && st.fehler === null
    && f.stand === `pattern ${st.nr} by cypher · since bar ${Math.floor(st.ab_beat / 4) + 1}`, { st, stand: f.stand });

  // Andreas tippt bei AUTO an → AUTO aus, djk-muster weist ab
  await tippe('s("bd*2")');
  await warte(600);
  const serverAuto = JSON.parse(execFileSync('curl', ['-s', `${URL_SEITE}/strudel`], { encoding: 'utf8' })).autonom;
  f = await feld();
  pruefe('Tippen legt AUTO aus (Seite und Server)', !f.auto && serverAuto === false, { serverAuto, ...f });
  const r4 = muster('s("cp")');
  f = await feld();
  pruefe('T5.2 AUTO aus: djk-muster rc 4, strom1 und Feld unverändert', r4.status === 4 && strom() === 's("hh*16")' && f.wert === 's("bd*2")',
    { rc: r4.status, stderr: r4.stderr.trim().split('\n').pop(), strom: strom(), wert: f.wert });

  // T4.5 Fehlerfall: Zeile genannt, strom1 unverändert
  await tippe('s("bd"');
  await strgEnter();
  await warte(2500);
  f = await feld();
  pruefe('T4.5 Fehler rot mit Zeile, strom1 unverändert', /^Zeile 1: /.test(f.fehler) && f.fehlerKlasse === 'fehler' && strom() === 's("hh*16")', { strom: strom(), ...f });
  await b.bild(path.join(BILDER, 'feld-2-fehler.png'));

  // T4.6 Gutfall
  await tippe('s("bd*4, hh*8")');
  await strgEnter();
  await warte(2500);
  f = await feld();
  const von = JSON.parse(fs.readFileSync(path.join(ORDNER, 'strom1.von.json'), 'utf8')).von;
  pruefe('T4.6 Gutfall: from the next bar, von andreas, strom1 neu', f.fehler === 'from the next bar' && von === 'andreas' && strom() === 's("bd*4, hh*8")' && /by you/.test(f.stand), { von, strom: strom(), ...f });

  // T5.3 fremdes Muster bei schmutzigem Feld → Banner, Klick übernimmt
  await tippe('s("sd*3")');
  execFileSync('curl', ['-s', '-X', 'POST', `${URL_SEITE}/strudel`, '-H', 'content-type: application/json', '-d', '{"text":"s(\\"cp*2\\")"}']);
  await warte(1500);
  f = await feld();
  pruefe('T5.3 Banner bei schmutzigem Feld, Text bleibt', f.banner === 'andreas changed it · take over' && f.wert === 's("sd*3")', f);
  await b.bild(path.join(BILDER, 'feld-3-banner.png'));
  await b.klick('#muster-uebernehmen');
  await warte(300);
  f = await feld();
  pruefe('T5.3 take over zeigt fremdes Muster', f.wert === 's("cp*2")' && f.banner === null, f);

  // T5.4 Negativ-Kontrolle: AUTO wieder an → djk-muster rc 0, Feld folgt
  await b.klick('#muster-auto');
  await warte(600);
  const r0 = muster('s("hh*8")');
  await warte(1500);
  f = await feld();
  pruefe('T5.4 AUTO an: djk-muster rc 0, Feld folgt', r0.status === 0 && f.auto && f.wert === 's("hh*8")', { rc: r0.status, ...f });
  await b.bild(path.join(BILDER, 'feld-4-auto.png'));

  // Review F9: ein Erzeuger-Fehler (Datei direkt kaputt geschrieben) steht rot, und verschwindet mit dem nächsten guten Muster
  fs.writeFileSync(path.join(ORDNER, 'strom1.js.neu'), 's("bd"\n');
  fs.renameSync(path.join(ORDNER, 'strom1.js.neu'), path.join(ORDNER, 'strom1.js'));
  await warte(5000);
  f = await feld();
  pruefe('F9 Erzeuger-Fehler rot sichtbar', /^Zeile 1: /.test(f.fehler) && f.fehlerKlasse === 'fehler', f);
  muster('s("hh*8, bd*2")');
  await warte(5000);
  f = await feld();
  pruefe('F9 Fehler weg nach gutem Muster', f.fehler === '', f);
  // Review F10: Server nicht erreichbar → PLAY meldet es sichtbar
  await b.werte(`window.__fetch = window.fetch; window.fetch = () => Promise.reject(new TypeError('Failed to fetch'))`);
  await b.klick('#muster-senden');
  await warte(300);
  f = await feld();
  pruefe('F10 unerreichbarer Server sichtbar', /unreachable/.test(f.fehler), f);
  await b.werte(`window.fetch = window.__fetch`);

  // die 400 aus T4.5 ist gewollt; der Browser meldet jede 4xx-Antwort als Konsolenfehler
  const fehlerKonsole = b.konsole?.filter((k) => (k.typ === 'error' || k.typ === 'exception') && !(k.url === `${URL_SEITE}/strudel` && /status of 400/.test(k.text))) ?? [];
  pruefe('Konsole ohne Fehler', fehlerKonsole.length === 0, fehlerKonsole);
} finally {
  await b.zu();
}
const n = ergebnisse.filter((e) => !e.ok).length;
console.log(`\n${ergebnisse.length - n}/${ergebnisse.length} OK`);
process.exit(n ? 1 : 0);
