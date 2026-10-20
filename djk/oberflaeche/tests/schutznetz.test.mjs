// S0 Schutznetz (Plan 2026-10-01-server-umbau): Lücken, die die Mutationsproben der Karte gefunden haben.
// Jeder Test hier wird rot, wenn die benannte Stelle in server.ts fehlt (Mutanten-Belege: ~/messungen/2026-10-01-server-umbau/s0/).
// Zugriff auf Innereien NUR über hilfen/innen.mjs. Instanz aus CYPHERDJ_TEST_INSTANZ (hilfen/instanz.mjs, Vorgabe h), synthetischer Bestand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './hilfen/ring.mjs';
import { innen } from './hilfen/innen.mjs';
import { baueBestand } from './hilfen/bestand.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './hilfen/instanz.mjs';
belegeTestInstanz();

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..', '..');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
// Synthetischer Bestand wie server.test.mjs (baueSynthetisch): NIGHTSHIFT 100 s trägt /deck/loop/sichern; der lebende bestand/ liegt nicht im Repo
const BESTAND = baueBestand(tmp('djk-s0-bestand-'), [{ material_id: '1ac28792d355a38b', titel: 'nightshift', frames: 48000 * 100 }]);
process.on('exit', () => fs.rmSync(BESTAND, { recursive: true, force: true }));

// Verkürzte Fassung des stapel() aus server.test.mjs (die Datei exportiert nichts): Attrappe + Oberflaeche, alle Ordner in tmp.
async function stapel(t, { loops, musterOrdner, wirtOrdner, klangBefehl, hotcueOrdner } = {}) {
  const t1 = tmp('djk-s0-');
  const ab = path.join(fs.mkdtempSync('/dev/shm/djk60m-test-'), 'material');
  fs.mkdirSync(ab, { recursive: true });
  // Paket S3 (Auftrag 16 a, Muster der Leitstand-Tests aus K3): eigene kern.toml im tmp-Ordner, sonst liest die Attrappe die echte
  // ~/.config/cypherdj-<i>/kern.toml (ein unbekannter Schlüssel dort ließe jeden Stapel mit rc 2 scheitern); arr_ordner bleibt im tmp-Ordner.
  const konfig = path.join(t1, 'kern.toml');
  fs.writeFileSync(konfig, `arr_ordner = ${JSON.stringify(path.join(t1, 'arr'))}\n`);
  const att = spawn(process.execPath, [path.join(REPO, 'djk/vertrag/attrappe_kern.mjs'), '--frisch', '--arbeitsbestand', ab, '--konfig', konfig,
    '--zustand', path.join(t1, 'zustand.json')], { env: { ...process.env, CYPHERDJ_INSTANZ: TEST_INSTANZ }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, f) => { att.stdout.once('data', ok); att.once('exit', (c) => f(new Error(`attrappe rc ${c}`))); });
  let laufend = null;   // Plan d1-s1 Task 1: erst nach gelungenem starte() gesetzt; Attrappe und Ordner räumen auch, wenn der Start scheitert
  t.after(async () => {
    if (laufend) await laufend.stoppe();
    if (att.exitCode === null && att.signalCode === null) { const zu = new Promise((r) => att.once('exit', r)); att.kill('SIGTERM'); await zu; }
    fs.rmSync(t1, { recursive: true, force: true }); fs.rmSync(path.dirname(ab), { recursive: true, force: true });
  });
  const log = [];
  const huellen = path.join(tmp('djk-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: BESTAND, arbeitsbestand: ab,
    mutationen: [], loops: loops ?? tmp('djk-loops-'), kits: tmp('djk-kits-'), welleCache: tmp('djk-welle-'), musterOrdner: musterOrdner ?? tmp('djk-muster-'),
    hotcueOrdner: hotcueOrdner ?? tmp('djk-hc-'), rasterOrdner: tmp('djk-raster-'), huellen, wirtOrdner: wirtOrdner ?? tmp('djk-wirt-'), klangBefehl, log: (z) => log.push(z) });
  await o.starte();
  laufend = o;
  const i = innen(o);
  for (let n = 0; n < 100 && i.kern.zustand !== 'verbunden'; n++) await warte(20);
  assert.equal(i.kern.zustand, 'verbunden');
  const empfange = i.kern.empfange.bind(i.kern);   // wie server.test.mjs: echte Begrüßungen nach dem Verbinden fallen weg
  i.kern.empfange = (buf) => { if (buf.includes('/k/willkommen')) return; return empfange(buf); };
  return { o, i, log, url: `http://127.0.0.1:${47300 + K}` };
}

const CYPHER = { 'x-djk-quelle': 'cypher' };
const postJson = (url, pfad, daten, kopf = {}) => fetch(url + pfad, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf },
  body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
const postRoh = (url, pfad, daten, kopf = {}) => fetch(url + pfad, { method: 'POST', headers: kopf, body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));

// ---------------------------------------------------------------------------------------------------------------------
// 1. fremdePost an den sieben Routen, an denen kein Test 415/403 auslöste (Karte, Mutant M12)
// ---------------------------------------------------------------------------------------------------------------------
const FREMD_ROUTEN = [
  ['/deck/start', { deck: 1, ab: 'takt' }],
  ['/deck/stopp', { deck: 1, ab: 'jetzt' }],
  ['/abbruch', {}],
  ['/spur', { spur: { name: 'x', fahrten: [] } }],
  ['/spur/stopp', { name: 'x' }],
  ['/regler', { pfad: 'deck/1/fader', wert: 0 }],
  ['/tempo', { bpm: 128 }],
  ['/fx/routing', { routing: 'insert' }],
];
for (const [pfad, body] of FREMD_ROUTEN) {
  test(`S0 fremdePost ${pfad}: kein JSON 415 nur_json, fremde Herkunft 403 fremde_herkunft, nichts an den Kern; eigene Herkunft und localhost passieren`, async (t) => {
    const { i, url } = await stapel(t);
    const n0 = i.gesendet;
    const roh = await postRoh(url, pfad, body);   // fetch mit String-Körper sendet text/plain
    assert.deepEqual([roh.code, roh.j.fehler], [415, 'nur_json'], JSON.stringify(roh));
    const falscherTyp = await postRoh(url, pfad, body, { 'content-type': 'application/x-www-form-urlencoded' });
    assert.deepEqual([falscherTyp.code, falscherTyp.j.fehler], [415, 'nur_json']);
    const fremd = await postJson(url, pfad, body, { origin: 'https://boese.example' });
    assert.deepEqual([fremd.code, fremd.j.fehler], [403, 'fremde_herkunft'], JSON.stringify(fremd));
    const fremderPort = await postJson(url, pfad, body, { origin: 'http://127.0.0.1:1' });
    assert.deepEqual([fremderPort.code, fremderPort.j.fehler], [403, 'fremde_herkunft'], 'gleicher Host, anderer Port ist fremd');
    const beides = await postRoh(url, pfad, body, { origin: 'https://boese.example' });
    assert.equal(beides.code, 415, 'Rangfolge: erst Content-Type, dann Herkunft');
    assert.equal(i.gesendet, n0, 'abgewiesene Aufrufe senden nichts an den Kern');
    // Negativ-Kontrolle: dieselbe Anfrage mit eigener Herkunft und mit localhost kommt an der Prüfung vorbei (andere Antwort als nur_json/fremde_herkunft)
    for (const origin of [url, undefined, `http://localhost:${47300 + K}`]) {
      const ok = await postJson(url, pfad, body, origin ? { origin } : {});
      assert.ok(!['nur_json', 'fremde_herkunft'].includes(ok.j.fehler), `${origin}: ${JSON.stringify(ok)}`);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. ki_gestoppt-Riegel an /strudel, /spur, /klang (Karte, Mutanten M9, M10, M11)
// ---------------------------------------------------------------------------------------------------------------------
// Plan d1-s1 Task 4 (Abweichung von be656f02): Stop Cypher läuft über die Attrappe (/k/ki/stopp, /k/ki/frei von Andreas), nicht als
// eingespeistes /e/ki. Die Attrappe meldet ihren Zustand alle 50 ms in /zustand/kern (ki_gestoppt) und setzte einen nur
// eingespeisten Stopp sofort zurück: ohne diese Zeile waren die Stop-Tests in 5 von 12 Läufen rot (gemessen 15.10., Instanz c).
const stoppCypher = async (i, an) => {
  i.kern.sende(an ? '/k/ki/stopp' : '/k/ki/frei', { id: i.naechsteId(), quelle: 'andreas' });
  for (let t = 0; t < 2000 && i.kiGestoppt !== an; t += 20) await warte(20);
  assert.equal(i.kiGestoppt, an, `Stop Cypher ${an ? 'gesetzt' : 'gelöst'}: Rückmeldung der Attrappe fehlt`);
};

test('S0 /strudel: Stop Cypher lehnt Cypher mit 409 ki_gestoppt ab und schreibt nichts; Andreas und der Normalfall gehen', async (t) => {
  const d = tmp('djk-muster-');
  const { i, url } = await stapel(t, { musterOrdner: d });
  const text = { text: 's("bd*4")' };
  assert.equal((await postJson(url, '/strudel', text, CYPHER)).code, 200, 'Kontrolle: ohne Stop darf Cypher');
  fs.rmSync(d, { recursive: true, force: true });
  await stoppCypher(i, true);
  const r = await postJson(url, '/strudel', { text: 's("hh*8")' }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt'], JSON.stringify(r));
  assert.ok(!fs.existsSync(path.join(d, 'strom1.js')), 'bei Ablehnung wird nichts geschrieben');
  assert.equal((await postJson(url, '/strudel', { text: 's("cp")' })).code, 200, 'Andreas ist von Stop Cypher nicht betroffen');
  await stoppCypher(i, false);
  assert.equal((await postJson(url, '/strudel', text, CYPHER)).code, 200, 'nach der Freigabe geht Cypher wieder');
});

test('S0 /spur: Stop Cypher lehnt Cypher mit 409 ki_gestoppt ab, nichts an den Kern; Andreas und der Normalfall gehen', async (t) => {
  const { i, url, log } = await stapel(t);
  const spur = (name) => ({ spur: { name, fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 2, nach: -0.6 }] } });
  assert.equal((await postJson(url, '/spur', spur('s0-frei'), CYPHER)).code, 200, 'Kontrolle: ohne Stop darf Cypher');
  await stoppCypher(i, true);
  const n0 = log.filter((z) => z.typ === 'an_kern').length;
  const r = await postJson(url, '/spur', spur('s0-gestoppt'), CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt'], JSON.stringify(r));
  assert.equal(log.filter((z) => z.typ === 'an_kern').length, n0, 'nichts an den Kern');
  assert.equal((await postJson(url, '/spur', spur('s0-andreas'))).code, 200, 'Andreas ist von Stop Cypher nicht betroffen');
  await stoppCypher(i, false);
  assert.equal((await postJson(url, '/spur', spur('s0-danach'), CYPHER)).code, 200, 'nach der Freigabe geht Cypher wieder');
});

function klangStub() {
  const d = tmp('djk-klangstub-');
  const f = path.join(d, 'stub');
  fs.writeFileSync(f, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`);
  fs.chmodSync(f, 0o755);
  return f;
}
test('S0 /klang: Stop Cypher lehnt schreibende Aktion von Cypher mit 409 ki_gestoppt ab; lesend, Andreas und der Normalfall gehen', async (t) => {
  const { i, url } = await stapel(t, { klangBefehl: klangStub() });
  const lade = { gruppe: 'bass', aktion: 'lade', name: 'x' };
  assert.equal((await postJson(url, '/klang', lade, CYPHER)).code, 200, 'Kontrolle: ohne Stop darf Cypher');
  await stoppCypher(i, true);
  const r = await postJson(url, '/klang', lade, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt'], JSON.stringify(r));
  assert.equal((await postJson(url, '/klang', lade)).code, 200, 'Andreas ist von Stop Cypher nicht betroffen');
  assert.equal((await postJson(url, '/klang', { gruppe: 'bass', aktion: 'zeige' }, CYPHER)).code, 200, 'lesend bleibt frei');
  await stoppCypher(i, false);
  assert.equal((await postJson(url, '/klang', lade, CYPHER)).code, 200, 'nach der Freigabe geht Cypher wieder');
});

// ---------------------------------------------------------------------------------------------------------------------
// 3. angefasst: je Schreibstelle ein Ereignis im 500-ms-Fenster nach /e/neustart (Karte, Mutanten M1 bis M5)
// ---------------------------------------------------------------------------------------------------------------------
function schreibeLoop(dir, name, beats) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'loop.json'), JSON.stringify({ schema: 1, name, beats, bpm: 128, frames: beats * 22500, datei: 'loop.f32', quelle: 'test', erstellt: '2026-09-27 15:00' }));
  fs.writeFileSync(path.join(dir, name, 'loop.f32'), Buffer.alloc(beats * 22500 * 8));
}
async function boxAn(i, url, loops, box, name, { raster } = {}) {
  schreibeLoop(loops, name, 4);
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box, name })).code, 200);
  i.vomKern('/e/loop', { box, status: 3, name, beats: 4 });
  if (raster !== undefined) assert.equal((await postJson(url, '/loop', { aktion: 'raster', box, versatz_frames: raster })).code, 200);
}
const fxFelder = (e) => ({ einheit: e, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 });
const kernBefehle = (log, ab = 0) => log.filter((z) => z.typ === 'an_kern' && /^\/k\/(loop|fx)/.test(z.adresse)).slice(ab);
const form = (z) => `${z.adresse}|${z.felder.box !== undefined ? 'b' + z.felder.box : 'e' + z.felder.einheit}|${z.felder.quelle}`;
// Neustart einspeisen, den Inhalt des Fensters laufen lassen, danach die Wiederherstellung (500 ms) abwarten
async function neustartMitFenster(i, log, generation, imFenster) {
  const n0 = kernBefehle(log).length;
  i.vomKern('/e/neustart', { generation, sample: 0 });
  await imFenster();
  await warte(900);
  return kernBefehle(log, n0).map(form);
}
const ausgelassen = (log, typ, feld, wert) => log.filter((z) => z.typ === typ && z[feld] === wert).map((z) => z.grund);

async function zweiBoxen(t, extra) {
  const loops = tmp('djk-loops-');
  const s = await stapel(t, { loops });
  await boxAn(s.i, s.url, loops, 1, 'pruef-a', extra);
  await boxAn(s.i, s.url, loops, 2, 'pruef-b', extra);
  return { ...s, loops };
}
async function zweiFx(t) {
  const d = tmp('djk-muster-');
  const s = await stapel(t, { musterOrdner: d });
  fs.writeFileSync(path.join(d, 'fx_von.json'), JSON.stringify({ '1': { von: 'andreas', zeit: 1 }, '2': { von: 'andreas', zeit: 1 } }));
  s.i.vomKern('/e/fx', fxFelder(1));
  s.i.vomKern('/e/fx', fxFelder(2));
  return s;
}

test('S0 angefasst (Echo /e/loop): ein Echo für Box 1 im Fenster hält die Wiederherstellung von Box 1 zurück, Box 2 kommt', async (t) => {
  const { i, log } = await zweiBoxen(t);
  const b = await neustartMitFenster(i, log, 201, async () => { i.vomKern('/e/loop', { box: 1, status: 3, name: 'pruef-a', beats: 4 }); });
  assert.deepEqual(ausgelassen(log, 'box_wieder_ausgelassen', 'box', 1), ['neu_gesetzt'], JSON.stringify(log.filter((z) => /wieder/.test(z.typ))));
  assert.deepEqual(b.filter((x) => x.includes('|b1|')), [], `Box 1: nichts erneut gesendet: ${b}`);
  assert.deepEqual(b.filter((x) => x.includes('|b2|')).sort(), ['/k/loop/laden|b2|andreas', '/k/loop/start|b2|andreas'], `Kontrolle Box 2: ${b}`);
});

test('S0 angefasst (Echo /e/fx): ein Echo für FX 1 im Fenster hält die Wiederherstellung von FX 1 zurück, FX 2 kommt', async (t) => {
  const { i, log } = await zweiFx(t);
  const b = await neustartMitFenster(i, log, 202, async () => { i.vomKern('/e/fx', fxFelder(1)); });
  assert.deepEqual(ausgelassen(log, 'fx_wieder_ausgelassen', 'einheit', 1), ['neu_gesetzt'], JSON.stringify(log.filter((z) => /wieder/.test(z.typ))));
  assert.deepEqual(b, ['/k/fx|e2|andreas'], 'FX 1 nicht, FX 2 (Kontrolle) schon');
});

test('S0 angefasst (/fx/zuweisung): eine Zuweisung im Fenster hält die Wiederherstellung dieser FX-Einheit zurück, die andere kommt', async (t) => {
  const { i, log, url } = await zweiFx(t);
  let antwort;
  const b = await neustartMitFenster(i, log, 203, async () => { antwort = await postJson(url, '/fx/zuweisung', { einheit: 1, kanal: 'master', an: true }); });
  assert.equal(antwort.code, 200, JSON.stringify(antwort));
  assert.deepEqual(ausgelassen(log, 'fx_wieder_ausgelassen', 'einheit', 1), ['neu_gesetzt'], JSON.stringify(log.filter((z) => /wieder/.test(z.typ))));
  assert.deepEqual(b.sort(), ['/k/fx/zuweisung|e1|andreas', '/k/fx|e2|andreas'].sort(), 'von FX 1 nur die eigene Zuweisung, FX 2 (Kontrolle) kommt');
});

test('S0 angefasst (/deck/loop/sichern mit box): das Sichern in Box 1 im Fenster hält die Wiederherstellung von Box 1 zurück, Box 2 kommt', async (t) => {
  const loops = tmp('djk-loops-');
  const { i, log, url } = await stapel(t, { loops });
  assert.equal((await postJson(url, '/laden', { deck: 1, material_id: '1ac28792d355a38b' })).code, 200);
  for (let n = 0; n < 50 && !i.stand.decks['1']; n++) await warte(20);
  await boxAn(i, url, loops, 1, 'pruef-a');
  await boxAn(i, url, loops, 2, 'pruef-b');
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 2, raster: 4 })).code, 200);
  for (let n = 0; n < 100; n++) { const z = i.stand.decks['1']; if (z && (z.beats_bis_ende === null || z.beats_bis_ende === Infinity)) break; await warte(20); }
  let antwort;
  const b = await neustartMitFenster(i, log, 204, async () => { antwort = await postJson(url, '/deck/loop/sichern', { deck: 1, box: 1 }); });
  assert.equal(antwort.code, 200, JSON.stringify(antwort));
  assert.deepEqual(ausgelassen(log, 'box_wieder_ausgelassen', 'box', 1), ['neu_gesetzt'], JSON.stringify(log.filter((z) => /wieder/.test(z.typ))));
  assert.deepEqual(b.filter((x) => x.includes('|b1|')), ['/k/loop/laden|b1|andreas'], `Box 1: nur das Laden des gesicherten Loops: ${b}`);
  assert.ok(log.some((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/laden' && z.felder.box === 1 && /^a-\d{6}-2b$/.test(z.felder.name)), 'das Laden trägt den gesicherten Namen, nicht pruef-a');
  assert.ok(b.some((x) => x.startsWith('/k/loop/laden|b2|')), `Kontrolle Box 2 kommt: ${b}`);
});

test('S0 angefasst (/loop raster): ein Raster-Versatz im Fenster hält den alten Live-Versatz aus der Wiederherstellung zurück, Box 2 bekommt seinen', async (t) => {
  const { i, log, url } = await zweiBoxen(t, { raster: 96 });
  const rasterBefehle = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/raster').map((z) => [z.felder.box, z.felder.versatz_frames]);
  const r0 = rasterBefehle().length;
  let antwort;
  await neustartMitFenster(i, log, 205, async () => {
    // nach dem Neustart ist stand.loops leer; Andreas' Raster-Griff braucht die Box, also steht sie hier ein (wie ein früher Echo, ohne ihn: der setzte box:1)
    i.stand.loops['1'] = { box: 1, status: 3, name: 'pruef-a', beats: 4 };
    antwort = await postJson(url, '/loop', { aktion: 'raster', box: 1, versatz_frames: 200 });
  });
  assert.equal(antwort.code, 200, JSON.stringify(antwort));
  assert.deepEqual(rasterBefehle().slice(r0), [[1, 200], [2, 96]], 'Box 1: nur Andreas\' neuer Versatz, nicht der alte 96; Box 2 (Kontrolle): der gemerkte 96');
  assert.deepEqual(log.filter((z) => z.typ === 'box_wieder' && z.box === 1).map((z) => z.versatz_frames), [96], 'Box 1 kam zurück (nicht angefasst), nur ohne zweiten Raster-Befehl');
});
