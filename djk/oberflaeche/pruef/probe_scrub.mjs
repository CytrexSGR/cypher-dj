// Probe Hörbares Ziehen (2026-10-17): Seite + Seiten-Server + Kern-Attrappe (kein Ton, kein echter Kern), Prüfinstanz i, kopfloser Chrome.
// Startet seinen Stapel selbst (wie tests/server.test.mjs stapel) und räumt ihn ab. Prüft die Verdrahtung in app.js: Ziehen im Zoomfenster
// sendet Griff, gedrosselte Züge, Lebenszeichen und Los an /deck/scrub statt eines Sprungs; Klick ohne Zug sendet nichts; laufendes Deck
// wird um die Strecke versetzt; mit aktivem Loop bleibt es beim Sprung. Gefunden hat sie: setInterval mit fremdem this („Illegal
// invocation“ im Browser, unter Node unsichtbar). Aufruf: node djk/oberflaeche/pruef/probe_scrub.mjs
// Grenze: der Leitstand-WebSocket läuft hier nicht (erwartete Konsolenmeldung ERR_CONNECTION_REFUSED).
process.env.CYPHERDJ_INSTANZ = 'i';
process.env.CYPHERDJ_TEST_INSTANZ = 'i';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const { Oberflaeche } = await import(`${R}/oberflaeche/server.ts`);
const { baueBestand } = await import(`${R}/oberflaeche/tests/hilfen/bestand.mjs`);
const { schreibeLeerenRing } = await import(`${R}/oberflaeche/tests/hilfen/ring.mjs`);
const { starteBrowser } = await import(`${R}/oberflaeche/pruef/cdp.mjs`);
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const K = 9000, warte = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
const tmpd = (n) => fs.mkdtempSync(path.join(tmp, `${n}-`));
const NIGHT = '1ac28792d355a38b';
const bestand = baueBestand(tmpd('bestand'), [{ material_id: NIGHT, titel: 'nightshift', frames: 48000 * 100 }]);
const ab = path.join(fs.mkdtempSync('/dev/shm/smoke-'), 'material'); fs.mkdirSync(ab, { recursive: true });
const konfig = path.join(tmp, 'kern.toml'); fs.writeFileSync(konfig, `arr_ordner = ${JSON.stringify(path.join(tmp, 'arr'))}\n`);
const att = spawn(process.execPath, [`${R}/vertrag/attrappe_kern.mjs`, '--frisch', '--arbeitsbestand', ab, '--konfig', konfig, '--zustand', path.join(tmp, 'z.json')],
  { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((ok, f) => { att.stdout.once('data', ok); att.once('exit', (c) => f(new Error('attrappe rc ' + c))); });
const huellen = path.join(tmpd('huellen'), 'huellen'); schreibeLeerenRing(huellen);
const log = [];
const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand, arbeitsbestand: ab, mutationen: [],
  loops: tmpd('loops'), kits: tmpd('kits'), welleCache: tmpd('welle'), musterOrdner: tmpd('muster'), hotcueOrdner: tmpd('hc'), rasterOrdner: tmpd('raster'),
  huellen, wirtOrdner: tmpd('wirt'), kernPruefmodus: true, log: (z) => log.push(z) });
await o.starte();
for (let i = 0; i < 100 && o.kern.zustand !== 'verbunden'; i++) await warte(20);
const gesendet = [];
const sende = o.kern.sende.bind(o.kern);
o.kern.sende = (adr, f) => { gesendet.push({ adr, ...f }); return sende(adr, f); };
const SEITE = `http://127.0.0.1:${47300 + K}`;
const ergebnis = [];
const pruefe = (n, ok, ist) => { ergebnis.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} :: ${JSON.stringify(ist)}`); };
const post = (p, d) => fetch(SEITE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => r.json());
const b = await starteBrowser({ breite: 1920, hoehe: 1080 });
try {
  await b.oeffne(`${SEITE}/`);
  await warte(800);
  await post('/laden', { deck: 1, material_id: NIGHT });
  for (let i = 0; i < 100 && !(o.stand.decks['1']?.status === 1); i++) await warte(50);
  await warte(2000);
  const q0 = o.stand.decks['1'].quell_beat;
  const lauf = await b.mitte('.deck[data-deck="1"] [data-lauf]');
  console.log('lauf', JSON.stringify(lauf), 'q0', q0);
  // Ziehen nach links (Welle folgt der Hand): Hand 1/4 Breite nach links = Position + 1/4 Fenster
  gesendet.length = 0;
  await b.ziehe('.deck[data-deck="1"] [data-lauf]', -lauf.w / 4, 0, 30);
  await warte(1200);
  const s = gesendet.filter((g) => g.adr === '/k/deck/scrub');
  const sp = gesendet.filter((g) => g.adr === '/k/deck/sprung');
  console.log('scrub-Meldungen:', s.length, JSON.stringify(s.map((g) => [g.phase, +g.delta_beats.toFixed(3)])));
  pruefe('Griff zuerst (phase 1, Strecke 0)', s[0]?.phase === 1 && s[0]?.delta_beats === 0, s[0]);
  pruefe('Los zuletzt (phase 0)', s.at(-1)?.phase === 0, s.at(-1));
  pruefe('dazwischen Züge (phase 2)', s.slice(1, -1).length >= 1 && s.slice(1, -1).every((g) => g.phase === 2), s.length);
  pruefe('Los trägt die Endstrecke > 0 (links ziehen = vorwärts)', s.at(-1)?.delta_beats > 1, s.at(-1)?.delta_beats);
  pruefe('kein Sprung zusätzlich', sp.length === 0, sp.length);
  const z = o.stand.decks['1'];
  pruefe('Attrappe: Kopf bleibt an der Zugstelle', Math.abs(z.quell_beat - (q0 + s.at(-1).delta_beats)) < 0.05, { q: z.quell_beat, erwartet: q0 + s.at(-1).delta_beats });
  // Klick ohne Zug: nichts
  gesendet.length = 0;
  await b.klick('.deck[data-deck="1"] [data-lauf]');
  await warte(500);
  pruefe('Klick ohne Zug sendet nichts', gesendet.filter((g) => g.adr === '/k/deck/scrub' || g.adr === '/k/deck/sprung').length === 0, gesendet.length);
  // Anzeige: nach dem Los verschwindet die Zugstrecke (a.zieh) wieder
  await warte(1200);
  // Hand hält still: Lebenszeichen
  gesendet.length = 0;
  const m = await b.mitte('.deck[data-deck="1"] [data-lauf]');
  await b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
  await b.maus('mousePressed', m.x, m.y);
  for (let i = 1; i <= 5; i++) await b.maus('mouseMoved', m.x + 4 * i, m.y);
  await warte(800);
  const halte = gesendet.filter((g) => g.adr === '/k/deck/scrub' && g.phase === 2);
  pruefe('Hand hält: Lebenszeichen (mind. 3 Züge in 800 ms)', halte.length >= 3, halte.length);
  await b.maus('mouseReleased', m.x + 20, m.y);
  await warte(500);
  pruefe('Los nach dem Halten', gesendet.at(-1)?.phase === 0, gesendet.at(-1));
  // laufendes Deck: Play, ziehen, Phase um die Strecke versetzt, kein Sprung
  await b.klick('.deck[data-deck="1"] .taste.play');
  for (let i = 0; i < 60 && !(o.stand.decks['1']?.status >= 2); i++) await warte(50);
  await warte(600);
  const ph0 = o.stand.decks['1'].quell_beat - o.kern.uhr.beat;
  gesendet.length = 0;
  await b.ziehe('.deck[data-deck="1"] [data-lauf]', -lauf.w / 8, 0, 20);
  await warte(1500);
  const sl = gesendet.filter((g) => g.adr === '/k/deck/scrub');
  const ph1 = o.stand.decks['1'].quell_beat - o.kern.uhr.beat;
  pruefe('laufend: Scrub gesendet, kein Sprung', sl.length >= 3 && gesendet.filter((g) => g.adr === '/k/deck/sprung').length === 0, sl.length);
  pruefe('laufend: Phase um die Endstrecke versetzt', Math.abs((ph1 - ph0) - sl.at(-1).delta_beats) < 0.3, { dph: ph1 - ph0, delta: sl.at(-1).delta_beats });
  // Loop aktiv: Rückfall auf den Sprung beim Loslassen
  await b.klick('.deck[data-deck="1"] [data-loopan]');
  for (let i = 0; i < 60 && !(o.stand.decks['1']?.status === 3); i++) await warte(50);
  await warte(300);
  gesendet.length = 0;
  await b.ziehe('.deck[data-deck="1"] [data-lauf]', -lauf.w / 16, 0, 10);
  await warte(800);
  pruefe('Loop aktiv: kein Scrub, ein Sprung (wie bisher)', gesendet.filter((g) => g.adr === '/k/deck/scrub').length === 0 && gesendet.filter((g) => g.adr === '/k/deck/sprung').length === 1,
    gesendet.map((g) => g.adr));
  const fehler = (b.konsole ?? []).filter((k) => (k.typ === 'error' || k.typ === 'exception') && !/ERR_CONNECTION_REFUSED/.test(k.text));
  pruefe('Konsole ohne Fehler (ohne den Leitstand-WebSocket, der in dieser Probe nicht läuft)', fehler.length === 0, fehler);
} finally {
  await b.zu();
  await o.stoppe();
  att.kill('SIGTERM');
  fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.dirname(ab), { recursive: true, force: true });
}
const n = ergebnis.filter((x) => !x).length;
console.log(`${ergebnis.length - n}/${ergebnis.length} OK`);
process.exit(n ? 1 : 0);
