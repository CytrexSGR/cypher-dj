// Probe Plan Grid am laufenden Stapel einer Prüfinstanz, kopflos: GRID ◀ ▶ an Deck 1 (Anzeige, Server, Linie, Quell-Beat
// bleibt), FIX (Datei), ungespeichert neu laden (gespeicherter Wert kommt), Rechtsklick 0; L1 ◀ und FIX in loop.json.
// Aufruf: node djk/oberflaeche/pruef/probe_grid.mjs [instanz i] [bildordner]
import fs from 'node:fs';
import path from 'node:path';
import { starteBrowser } from './cdp.mjs';

const I = process.argv[2] ?? 'i';
const BILDER = process.argv[3] ?? '/tmp';
const K = 'abcdefghi'.indexOf(I) + 1;
const URL_SEITE = `http://127.0.0.1:${47300 + 1000 * K}`;
const NIGHTSHIFT = '1ac28792d355a38b';
if (!I) throw new Error('Probe nur gegen eine Prüfinstanz');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnisse = [];
const pruefe = (name, ok, ist) => { ergebnisse.push({ name, ok: !!ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} :: ${JSON.stringify(ist)}`); };

// Kern-Stand über den Ereignisstrom der Seite (/strom): letzter /zustand/deck von Deck 1 und letzte /uhr
const stand = { deck: null, uhr: null };
const ac = new AbortController();
(async () => {
  const r = await fetch(`${URL_SEITE}/strom`, { signal: ac.signal });
  const dec = new TextDecoder();
  let puffer = '';
  for await (const teil of r.body) {
    puffer += dec.decode(teil, { stream: true });
    let i;
    while ((i = puffer.indexOf('\n\n')) >= 0) {
      const n = JSON.parse(puffer.slice(6, i)); puffer = puffer.slice(i + 2);
      if (n.a === '/zustand/deck' && n.f.deck === 1) stand.deck = n.f;
      if (n.a === '/uhr') stand.uhr = n.f;
    }
  }
})().catch(() => {});
const bis = async (pruef, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { if (stand.deck && pruef(stand.deck)) return true; await warte(50); } return false; };
const phase = () => stand.deck.quell_beat - stand.uhr.beat;   // läuft das Deck, ist das konstant bis auf Sprünge
// /zustand/deck und /uhr kommen über den Server getrennt gedrosselt (100/50 ms): ein Paar rauscht bis ~0,2 Beat. Median aus 20.
const phaseMedian = async () => {
  const w = [];
  for (let k = 0; k < 20; k++) { w.push(phase()); await warte(55); }
  w.sort((x, y) => x - y);
  return (w[9] + w[10]) / 2;
};
const post = (p, d) => fetch(URL_SEITE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => r.json());

// Plan Grid: die Prüfinstanz hat eigene Ordner (/dev/shm/cypherdj-<i>/raster, /loops), die Probe fasst den Betrieb nie an
const RASTER = path.join(`/dev/shm/cypherdj-${I}/raster`, `${NIGHTSHIFT}_128000_r1.json`);
const LOOPS = `/dev/shm/cypherdj-${I}/loops`, LOOP = 'grid-probe';
try { fs.rmSync(RASTER); } catch { /* frisch */ }
// Prüf-Loop: 4 Beats Stille mit einem Klick auf Frame 0 (nur für Datei und Anzeige; die Instanz ist stumm)
fs.rmSync(path.join(LOOPS, LOOP), { recursive: true, force: true });
fs.mkdirSync(path.join(LOOPS, LOOP), { recursive: true });
const daten = new Float32Array(4 * 22500 * 2); daten[0] = daten[1] = 0.5;
fs.writeFileSync(path.join(LOOPS, LOOP, 'loop.f32'), Buffer.from(daten.buffer));
fs.writeFileSync(path.join(LOOPS, LOOP, 'loop.json'), JSON.stringify({ schema: 1, name: LOOP, beats: 4, bpm: 128, frames: 90000, datei: 'loop.f32', quelle: 'test', erstellt: '2026-09-28 16:00' }));

const b = await starteBrowser({ breite: 1920, hoehe: 1080 });
const sel = (x) => JSON.stringify(x);
const text = (s) => b.werte(`document.querySelector(${sel(s)}).textContent`);
const hatKlasse = (s, k) => b.werte(`document.querySelector(${sel(s)}).classList.contains(${sel(k)})`);
const shiftKlick = async (s) => {
  const m = await b.mitte(s);
  await b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
  await b.maus('mousePressed', m.x, m.y, { modifiers: 8 });
  await b.maus('mouseReleased', m.x, m.y, { modifiers: 8 });
};
const rechtsklick = async (s) => {
  const m = await b.mitte(s);
  await b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
  await b.maus('mousePressed', m.x, m.y, { button: 'right', buttons: 2 });
  await b.maus('mouseReleased', m.x, m.y, { button: 'right', buttons: 0 });
};
const WERT = '.deck[data-deck="1"] [data-gridwert]', FIX = '.deck[data-deck="1"] [data-gridfix]';
const LWERT = '.box[data-box="1"] [data-gridwert]', LFIX = '.box[data-box="1"] [data-gridfix]';
const wert = () => text(WERT);
try {
  await b.oeffne(`${URL_SEITE}/`);
  await warte(800);
  await post('/laden', { deck: 1, material_id: NIGHTSHIFT });
  pruefe('Laden: Deck 1 geladen', await bis((z) => z.status === 1 && z.material_id === NIGHTSHIFT), stand.deck?.status);
  await warte(1500);
  pruefe('Nach Laden: 0.0 ms, FIX aus', (await wert()) === '0.0 ms' && !(await hatKlasse(FIX, 'offen')), await wert());
  const q0 = stand.deck.quell_beat;
  await b.klick('.deck[data-deck="1"] [data-gridschritt="1"]');
  await warte(400);
  pruefe('▶: +5.0 ms angezeigt, FIX leuchtet', (await wert()) === '+5.0 ms' && await hatKlasse(FIX, 'offen'), await wert());
  pruefe('▶: Quell-Beat unverändert (stehend)', Math.abs(stand.deck.quell_beat - q0) < 1e-6, stand.deck.quell_beat);
  const j = await (await fetch(`${URL_SEITE}/deck/raster?deck=1`)).json();
  pruefe('Server: 240 Frames live, 0 gespeichert', j.versatz_frames === 240 && j.gespeichert_frames === 0, j);
  const linie = await b.werte('window.djkRaster?.[1]');
  pruefe('Seite: Linie 240 Frames später', linie === 240, linie);
  await b.bild(path.join(BILDER, 'grid-deck-1.png'));
  await b.klick(FIX);
  await warte(400);
  const datei = JSON.parse(fs.readFileSync(RASTER, 'utf8'));
  pruefe('FIX: Datei trägt 240, FIX aus', datei.versatz_frames === 240 && !(await hatKlasse(FIX, 'offen')), datei);
  // Fehlerfall vorher/nachher am selben Fall: ungespeichert +1 ms, neu laden → wieder 240 (nicht 288)
  await shiftKlick('.deck[data-deck="1"] [data-gridschritt="1"]');
  await warte(400);
  pruefe('Shift+▶: +6.0 ms', (await wert()) === '+6.0 ms', await wert());
  await post('/laden', { deck: 1, material_id: NIGHTSHIFT });
  await warte(2000);
  pruefe('Neu geladen: gespeicherte +5.0 ms, FIX aus', (await wert()) === '+5.0 ms' && !(await hatKlasse(FIX, 'offen')), await wert());
  await rechtsklick(WERT);
  await warte(400);
  pruefe('Rechtsklick: 0.0 ms, FIX leuchtet', (await wert()) === '0.0 ms' && await hatKlasse(FIX, 'offen'), await wert());
  await b.klick(FIX);   // aufräumen: 0 fixieren
  await warte(400);

  // Loop-Box L1
  await fetch(URL_SEITE + '/loop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aktion: 'laden', box: 1, name: LOOP }) });
  await warte(1500);
  await b.klick('.box[data-box="1"] [data-gridschritt="-1"]');
  await warte(400);
  pruefe('L1 ◀: −5.0 ms, FIX leuchtet, Seite −240', (await text(LWERT)) === '−5.0 ms' && await hatKlasse(LFIX, 'offen') && (await b.werte('window.djkLoopRaster?.[1]')) === -240, await text(LWERT));
  await b.klick(LFIX);
  await warte(400);
  const lj = JSON.parse(fs.readFileSync(path.join(LOOPS, LOOP, 'loop.json'), 'utf8'));
  pruefe('L1 FIX: loop.json versatz_frames −240, andere Felder da', lj.versatz_frames === -240 && lj.beats === 4 && lj.frames === 90000, lj);
  await b.bild(path.join(BILDER, 'grid-loop-1.png'));
} finally {
  await b.zu();
  ac.abort();
  // der Prüf-Loop bleibt im Loop-Ordner der Prüfinstanz (/dev/shm): L1 hält ihn noch, eine spätere Seite fragt seine Welle ab
}
const rot = ergebnisse.filter((e) => !e.ok);
console.log(`ERGEBNIS ${ergebnisse.length - rot.length} OK, ${rot.length} FEHL`);
process.exit(rot.length ? 1 : 0);
