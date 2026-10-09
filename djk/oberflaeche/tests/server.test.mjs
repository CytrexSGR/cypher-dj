// Scheibe 60m, Task 2: Server gegen die Kern-Attrappe aus 13 (Instanz h, Arbeitsbestand = bestand/, kein Ton)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Oberflaeche, leseBestand } from '../server.ts';
import { baueBestand } from './hilfen/bestand.mjs';
import { midiRoh, vorgabe } from '../oeffentlich/kurven.js';
import { KOPIE_TEXT, HAND_PRUEFMODUS_TEXT } from '../oeffentlich/meldungen.js';
import { kodiere } from '../../vertrag/attrappe_kern/osc.mjs';
import { schreibeLeerenRing, schreibeRing } from './hilfen/ring.mjs';
import { K as OHR_K } from '../ohr.ts';
const K1 = OHR_K.deck1, K2 = OHR_K.deck2, KMASTER = OHR_K.master;

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..', '..');
// Prüfbestand: standardmäßig synthetisch (baueBestand), damit die Suite auf jedem Rechner ohne den lebenden
// Arbeitsbestand läuft (der gehört nicht ins Repo). CYPHERDJ_BESTAND=<ordner> lenkt auf einen echten Bestand um
// (muss die Material-ID NIGHTSHIFT und >= 14 Fassungen mit basis_bpm 128 enthalten).
const NIGHTSHIFT = '1ac28792d355a38b';
const LEBEND = process.env.CYPHERDJ_BESTAND || path.join(REPO, 'bestand');
function baueSynthetisch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-prueftbestand-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  // NIGHTSHIFT trägt die Deck-Tests (Sprünge bis ~40 Beats, Loops, Welle): 100 s; die übrigen sind kurz.
  const eintraege = [{ material_id: NIGHTSHIFT, titel: 'nightshift', frames: 48000 * 100 }];
  for (let i = 1; i < 14; i++) eintraege.push({ material_id: `5e${String(i).padStart(14, '0')}`, titel: `synthetisch-${i}`, frames: 48000 * 2 });
  return baueBestand(dir, eintraege);
}
// /strudel und die Muster-Fahrten starten djk/erzeuger/djk-muster, das die Strudel-Pakete aus ~/strudel/packages lädt
// (INSTALL §5, optional; STRUDEL_PAKETE lenkt um). Ohne sie scheitern diese Tests mit ERR_MODULE_NOT_FOUND: übersprungen.
const STRUDEL_PAKETE = process.env.STRUDEL_PAKETE ?? path.join(os.homedir(), 'strudel', 'packages');
const OHNE_STRUDEL = fs.existsSync(path.join(STRUDEL_PAKETE, 'core')) ? false : `Strudel-Pakete fehlen (${STRUDEL_PAKETE}/core; INSTALL §5, optional)`;
const BESTAND = process.env.CYPHERDJ_BESTAND ? LEBEND : baueSynthetisch();
const K = 8000; // Instanz h
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// Arbeitsbestand je Lauf in tmpfs wie im Betrieb (/dev/shm), die Attrappe liest nur dort (wie der echte Kern)
async function stapel(t, mutationen = [], { bestand = BESTAND, vorher, kernPruefmodus, zielKurve, loops, kits, welleCache, musterOrdner, hotcueOrdner, rasterOrdner, huellen, wirtOrdner, klangBefehl, echteBegruessung, digitalout } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk60m-'));
  const ab = path.join(fs.mkdtempSync('/dev/shm/djk60m-test-'), 'material');
  fs.mkdirSync(ab, { recursive: true });
  vorher?.(ab);
  const att = spawn(process.execPath, [path.join(REPO, 'djk/vertrag/attrappe_kern.mjs'), '--frisch', '--arbeitsbestand', ab,
    '--zustand', path.join(tmp, 'zustand.json')], { env: { ...process.env, CYPHERDJ_INSTANZ: 'h' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, f) => { att.stdout.once('data', ok); att.once('exit', (c) => f(new Error(`attrappe rc ${c}`))); });
  const log = [];
  const huellenPfad = huellen ?? (() => { const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-huellen-')), 'huellen'); schreibeLeerenRing(p); return p; })();
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand, arbeitsbestand: ab, mutationen, kernPruefmodus, zielKurve, loops: loops ?? fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-')), kits: kits ?? fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kits-')), welleCache: welleCache ?? fs.mkdtempSync(path.join(os.tmpdir(), 'djk-welle-')), musterOrdner: musterOrdner ?? fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-')), hotcueOrdner: hotcueOrdner ?? fs.mkdtempSync(path.join(os.tmpdir(), 'djk-hc-')), rasterOrdner: rasterOrdner ?? fs.mkdtempSync(path.join(os.tmpdir(), 'djk-raster-')), huellen: huellenPfad, wirtOrdner: wirtOrdner ?? fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wirt-')), klangBefehl, digitalout, log: (z) => log.push(z) });
  await o.starte();
  for (let i = 0; i < 100 && o.kern.zustand !== 'verbunden'; i++) await warte(20);
  assert.equal(o.kern.zustand, 'verbunden');
  // Die Attrappe steht auf Generation 0 und antwortet auf jedes erneute /k/hallo mit /k/willkommen 0. Tests, die einen
  // Kern-Neustart mit höherer Generation einspeisen (o.vomKern), würden das seit dem Final-Review als gebremsten Kern lesen.
  // Darum fallen echte Begrüßungen nach dem Verbinden weg; Tests speisen /k/willkommen selbst ein.
  const empfange = o.kern.empfange.bind(o.kern);
  if (!echteBegruessung) o.kern.empfange = (buf) => { if (buf.includes('/k/willkommen')) return; return empfange(buf); };
  t.after(async () => { await o.stoppe(); const zu = new Promise((r) => att.once('exit', r)); att.kill('SIGTERM'); await zu; fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.dirname(ab), { recursive: true, force: true }); });
  return { o, log, ab, url: `http://127.0.0.1:${47300 + K}` };
}

function sse(url) {
  const ereignisse = [];
  const ac = new AbortController();
  (async () => {
    const r = await fetch(`${url}/strom`, { signal: ac.signal });
    const dec = new TextDecoder();
    let puffer = '';
    for await (const teil of r.body) {
      puffer += dec.decode(teil, { stream: true });
      let i;
      while ((i = puffer.indexOf('\n\n')) >= 0) { ereignisse.push(JSON.parse(puffer.slice(6, i))); puffer = puffer.slice(i + 2); }
    }
  })().catch(() => {});
  return { ereignisse, zu: () => ac.abort() };
}

const post = (url, pfad, daten) => fetch(url + pfad, { method: 'POST', body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));

// bestand/ ist der lebende Arbeitsbestand (nicht in Git) und wächst: gezählt wird gegen seinen index.sqlite, nicht gegen eine feste Zahl
function indexZahlen(dir) {
  const db = new DatabaseSync(path.join(dir, 'index.sqlite'), { readOnly: true });
  const z = db.prepare('SELECT count(*) AS f, count(DISTINCT material_id) AS m FROM fassung').get();
  db.close();
  return z;
}

test('Prüfbestand: Fassungen und Materialien gleich index.sqlite, Länge aus fassung.json', () => {
  const b = leseBestand(BESTAND);
  const z = indexZahlen(BESTAND);
  assert.ok(z.f >= 14, `Index hat ${z.f} Fassungen, mindestens die 14 aus Werkstatt 15 erwartet`);
  assert.equal(b.length, z.f);
  assert.equal(new Set(b.map((e) => e.material_id)).size, z.m);
  assert.ok(b.every((e) => e.basis_bpm === 128 && e.beats > 0));
});

const lebendDa = fs.existsSync(path.join(LEBEND, 'index.sqlite'));
test('Bestand wie Index 15 (lebender Arbeitsbestand): Fassungen und Materialien gleich index.sqlite, Länge aus fassung.json',
  { skip: lebendDa ? false : `kein lebender Arbeitsbestand (${path.join(LEBEND, 'index.sqlite')} fehlt; CYPHERDJ_BESTAND setzen)` }, () => {
  const b = leseBestand(LEBEND);
  const z = indexZahlen(LEBEND);
  assert.ok(z.f >= 14, `Index hat ${z.f} Fassungen, mindestens die 14 aus Werkstatt 15 erwartet`);
  assert.equal(b.length, z.f);
  assert.equal(new Set(b.map((e) => e.material_id)).size, z.m);
  assert.ok(b.every((e) => e.basis_bpm === 128 && e.beats > 0));
});

test('/konfig meldet die Ziel-Kurve: Vorgabe kern, --ziel-kurve attrappe_linear für den Prüfstapel', async (t) => {
  const { url } = await stapel(t);
  assert.equal((await (await fetch(url + '/konfig')).json()).ziel_kurve, 'kern');
});

test('/konfig mit zielKurve attrappe_linear meldet sie (Negativ-Kontrolle zur Vorgabe)', async (t) => {
  const { url } = await stapel(t, [], { zielKurve: 'attrappe_linear' });
  assert.equal((await (await fetch(url + '/konfig')).json()).ziel_kurve, 'attrappe_linear');
});

test('Öffnen sendet nichts; Laden und Griff kommen am Kern an; falsches Ziel 400', async (t) => {
  const { o, log, ab, url } = await stapel(t);
  const s = sse(url);
  const seite = await fetch(url + '/');
  assert.equal(seite.status, 200);
  assert.equal((await (await fetch(url + '/bestand')).json()).length, indexZahlen(BESTAND).f);
  await fetch(url + '/konfig');
  await warte(300);
  assert.equal(o.gesendet, 0, 'Öffnen, /strom, /bestand, /konfig: 0 Befehle');
  assert.deepEqual(fs.readdirSync(ab), [], 'Öffnen kopiert nichts');
  assert.equal(s.ereignisse[0].a, 'stand');

  const nightshift = '1ac28792d355a38b';
  const l = await postJson(url, '/laden', { deck: 1, material_id: nightshift });
  assert.equal(l.code, 200);
  await warte(200);
  const geladen = s.ereignisse.find((e) => e.a === '/e/geladen');
  assert.ok(geladen, 'geladen im Strom');
  assert.equal(geladen.f.material_id, nightshift);
  const ordner = path.join(ab, nightshift, 'fassungen', '128000_r1');
  assert.ok(fs.readFileSync(path.join(ordner, 'fassung.json')).equals(fs.readFileSync(path.join(BESTAND, nightshift, 'fassungen', '128000_r1', 'fassung.json'))));
  assert.equal(fs.statSync(path.join(ordner, 'basis.f32')).size, fs.statSync(path.join(BESTAND, nightshift, 'fassungen', '128000_r1', 'basis.f32')).size);
  assert.deepEqual(fs.readdirSync(ab), [nightshift], 'keine .kopie-Reste');
  const kopie = log.find((z) => z.typ === 'kopie');
  assert.equal(kopie?.kopiert, true);
  assert.equal(l.j.kopie.kopiert, true);

  assert.equal((await postJson(url, '/griff', { pfad: 'deck/1/fader', u: 0.5 })).code, 200); // Stellung
  assert.equal((await postJson(url, '/griff', { pfad: 'deck/1/fader', u: 1 })).code, 200);
  await warte(200);
  const r = s.ereignisse.filter((e) => e.a === '/e/regler' && e.f.pfad === 'deck/1/fader').at(-1);
  assert.ok(r, '/e/regler deck/1/fader');
  assert.ok(Math.abs(r.f.wert - 0) < 1e-6, String(r.f.wert));

  const vorher = o.gesendet;
  for (const pfad of ['deck/3/fader', 'cue/split', 'deck/1/bogus']) {
    const x = await postJson(url, '/griff', { pfad, u: 0.5 });
    assert.equal(x.code, 400);
    assert.equal(x.j.fehler, 'unbekanntes_ziel');
  }
  assert.equal((await postJson(url, '/griff', { pfad: 'deck/1/fader', u: 2 })).code, 400);
  assert.equal(o.gesendet, vorher, 'abgelehnte Griffe senden nichts');
  assert.equal(log.filter((z) => z.typ === 'abgelehnt').length, 4);
  s.zu();
});

function schreibeLoop(dir, name, beats, alt = false, quelle = 'test') {  // alt: Datei wie bis Scheibe 2 (takte statt beats)
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  const laenge = alt ? { takte: beats / 4 } : { beats };
  fs.writeFileSync(path.join(dir, name, 'loop.json'), JSON.stringify({ schema: 1, name, ...laenge, bpm: 128,
    frames: beats * 22500, datei: 'loop.f32', quelle, erstellt: '2026-09-27 15:00' }));
  fs.writeFileSync(path.join(dir, name, 'loop.f32'), Buffer.alloc(beats * 22500 * 8));
}

test('Plan Tempo-Folge: /loops markiert defekte Loops (frames, bpm, Dateigröße), /loop laden lehnt sie mit Grund ab', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const schreibe = (name, json, bytes) => {
    fs.mkdirSync(path.join(loops, name), { recursive: true });
    fs.writeFileSync(path.join(loops, name, 'loop.json'), JSON.stringify({ schema: 1, name, datei: 'loop.f32', quelle: 'test', ...json }));
    fs.writeFileSync(path.join(loops, name, 'loop.f32'), Buffer.alloc(bytes));
  };
  schreibe('gut', { beats: 1, bpm: 128, frames: 22500 }, 22500 * 8);
  schreibe('kurz', { beats: 1, bpm: 128, frames: 20160 }, 20160 * 8);     // wie jam-boom am 2026-09-30
  schreibe('tempo', { beats: 1, bpm: 130, frames: 22500 }, 22500 * 8);
  schreibe('datei', { beats: 1, bpm: 128, frames: 22500 }, 100);
  const { o, url } = await stapel(t, [], { loops });
  const liste = await (await fetch(url + '/loops')).json();
  assert.deepEqual(liste.map((l) => [l.name, l.ladbar, l.grund]), [
    ['datei', false, 'loop.f32 has 100 bytes, expected 180000'],
    ['gut', true, ''],
    ['kurz', false, 'frames 20160, expected 22500 for 1 beat(s)'],
    ['tempo', false, 'bpm 130, expected 128']]);
  const vorher = o.gesendet;
  const r = await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'kurz' });
  assert.equal(r.code, 400);
  assert.equal(r.j.fehler, 'loop_defekt');
  assert.equal(r.j.grund, 'frames 20160, expected 22500 for 1 beat(s)');
  assert.equal(r.j.text, 'frames 20160, expected 22500 for 1 beat(s)');
  assert.equal(o.gesendet, vorher, 'ein defekter Loop geht nicht an den Kern');
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'gut' })).code, 200);   // Negativ-Kontrolle
});

test('Loop-Boxen: /loops listet, /loop schickt laden, start, stopp an den Kern, /e/loop kommt durch (MVP 2)', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  schreibeLoop(loops, 'pruef-a', 4);
  schreibeLoop(loops, 'pruef-b', 1);
  schreibeLoop(loops, 'hoertest-alt', 8, true);  // Scheibe 3 (E3): alte takte-Datei bleibt in der Liste, als 8 Beats
  fs.mkdirSync(path.join(loops, '.halb.neu'));
  const { o, log, url } = await stapel(t, [], { loops });
  const s = sse(url);
  const liste = await (await fetch(url + '/loops')).json();
  assert.deepEqual(liste.map((l) => [l.name, l.beats, l.quelle]), [['hoertest-alt', 8, 'test'], ['pruef-a', 4, 'test'], ['pruef-b', 1, 'test']]);
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'pruef-a' })).code, 200);
  assert.equal((await postJson(url, '/loop', { aktion: 'start', box: 1 })).code, 200);
  assert.equal((await postJson(url, '/loop', { aktion: 'stopp', box: 2 })).code, 200);
  const an = log.filter((z) => z.typ === 'an_kern' && String(z.adresse).startsWith('/k/loop/'))
    .map((z) => [z.adresse, z.felder.quelle, z.felder.box, z.felder.name ?? '']);
  assert.deepEqual(an, [['/k/loop/laden', 'andreas', 1, 'pruef-a'], ['/k/loop/start', 'andreas', 1, ''], ['/k/loop/stopp', 'andreas', 2, '']]);
  const vorher = o.gesendet;
  for (const body of [{ aktion: 'laden', box: 1, name: 'gibt-es-nicht' }, { aktion: 'start', box: 3 }, { aktion: 'bogus', box: 1 }]) {
    assert.equal((await postJson(url, '/loop', body)).code, 400, JSON.stringify(body));
  }
  assert.equal(o.gesendet, vorher, 'Abgelehntes geht nicht an den Kern');
  const udp = dgram.createSocket('udp4');
  await new Promise((ok) => udp.send(kodiere('/e/loop', 'iisiidf', [1, 3, 'pruef-a', 1, 0, 1, 0]), 47150 + K, '127.0.0.1', ok));
  udp.close();
  await warte(200);
  assert.ok(s.ereignisse.some((e) => e.a === '/e/loop' && e.f.box === 1 && e.f.status === 3 && e.f.name === 'pruef-a'));
  const s2 = sse(url);
  await warte(200);
  assert.equal(s2.ereignisse[0].f.loops['1'].name, 'pruef-a', 'eine neue Seite bekommt den Stand der Boxen');
  s.zu();
  s2.zu();
});

test('Mitschnitt (MVP 2 Scheibe 2): /loop rec schickt an den Kern, /e/mitschnitt kommt durch', async (t) => {
  const { o, log, url } = await stapel(t);
  const s = sse(url);
  assert.equal((await postJson(url, '/loop', { aktion: 'rec', beats: 1, name: 'c-143012-1b' })).code, 200);
  const an = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/rec')
    .map((z) => [z.adresse, z.felder.quelle, z.felder.beats, z.felder.name]);
  assert.deepEqual(an, [['/k/loop/rec', 'andreas', 1, 'c-143012-1b']]);
  const vorher = o.gesendet;
  for (const body of [{ aktion: 'rec', beats: 3, name: 'x' }, { aktion: 'rec', beats: 1, name: 'Gross' },
    { aktion: 'rec', beats: 1 }, { aktion: 'rec', takte: 1, name: 'alt' }]) {
    assert.equal((await postJson(url, '/loop', body)).code, 400, JSON.stringify(body));
  }
  assert.equal(o.gesendet, vorher, 'Abgelehntes geht nicht an den Kern');
  const udp = dgram.createSocket('udp4');
  await new Promise((ok) => udp.send(kodiere('/e/mitschnitt', 'siid', ['c-143012-1b', 1, 0, 4]), 47150 + K, '127.0.0.1', ok));
  udp.close();
  await warte(200);
  assert.ok(s.ereignisse.some((e) => e.a === '/e/mitschnitt' && e.f.name === 'c-143012-1b' && e.f.status === 0 &&
    e.f.ab_beat === 4));
  s.zu();
});

test('Griff an erz/1/fader kommt am Kern an (Strudel-Kanal, Plan 2026-09-27)', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url);
  assert.equal((await postJson(url, '/griff', { pfad: 'erz/1/fader', u: 0.5 })).code, 200);
  assert.equal((await postJson(url, '/griff', { pfad: 'erz/1/fader', u: 1 })).code, 200);
  await warte(200);
  assert.ok(s.ereignisse.some((e) => e.a === '/e/regler' && e.f.pfad === 'erz/1/fader'));
  s.zu();
});

test('Crossfader-Zuweisung: deck/1/xseite auf A kommt am Kern an (Stellung zuerst, dann Wert)', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url);
  assert.equal((await postJson(url, '/griff', { pfad: 'deck/1/xseite', u: 0.5 })).code, 200);   // Stellung = THRU
  assert.equal((await postJson(url, '/griff', { pfad: 'deck/1/xseite', u: 0 })).code, 200);     // A
  await warte(200);
  const r = s.ereignisse.filter((e) => e.a === '/e/regler' && e.f.pfad === 'deck/1/xseite').at(-1);
  assert.ok(r, '/e/regler deck/1/xseite');
  assert.equal(r.f.wert, 0);
  s.zu();
});

test('Mutation riegel_aus: der Kern lehnt das falsche Ziel selbst ab (/e/protokollfehler unbekannter_regler)', async (t) => {
  const { url } = await stapel(t, ['riegel_aus']);
  const s = sse(url);
  await warte(100);
  assert.equal((await postJson(url, '/griff', { pfad: 'deck/1/bogus', u: 0.5 })).code, 200);
  await warte(200);
  const p = s.ereignisse.find((e) => e.a === '/e/protokollfehler');
  assert.ok(p, 'protokollfehler im Strom');
  assert.equal(p.f.grund, 'unbekannter_regler');
  s.zu();
});

test('Nachtrag: Kopie vor dem Laden, Fehlerfall kaputte und fehlende Fassung abgewiesen, keine halbe Kopie, 0 Befehle', async (t) => {
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'djk60n-b-'));
  t.after(() => fs.rmSync(tmpB, { recursive: true, force: true }));
  const GUT = 'f0000000000000a1', SHA = 'f0000000000000b1', OHNE = 'f0000000000000b3', KURZ = 'f0000000000000b2';
  baueBestand(tmpB, [{ material_id: GUT, titel: 'Alpha' }, { material_id: SHA, titel: 'Bad sum', kaputt: 'sha' },
    { material_id: OHNE, titel: 'No audio', kaputt: 'ohne_audio' }, { material_id: KURZ, titel: 'Short', kaputt: 'kurz' }]);
  const { o, log, ab, url } = await stapel(t, [], { bestand: tmpB });
  const s = sse(url);
  await warte(100);
  for (const [mid, fehler] of [[SHA, 'pruefung'], [OHNE, 'material_fehlt'], [KURZ, 'pruefung'], ['f0000000000000ee', 'nicht_im_index']]) {
    const r = await postJson(url, '/laden', { deck: 1, material_id: mid });
    assert.equal(r.code, 400, mid);
    assert.equal(r.j.fehler, fehler, mid);
  }
  assert.equal(o.gesendet, 0, 'abgewiesene Fassungen senden nichts an den Kern');
  assert.deepEqual(fs.readdirSync(ab), [], 'keine halbe Kopie, kein Zielordner');
  assert.equal(log.filter((z) => z.typ === 'kopie_abgewiesen').length, 3);
  const g = await postJson(url, '/laden', { deck: 2, material_id: GUT });   // Positiv-Kontrolle im selben Stapel
  assert.equal(g.code, 200);
  await warte(200);
  assert.ok(s.ereignisse.find((e) => e.a === '/e/geladen' && e.f.material_id === GUT), 'die gute Fassung lädt');
  assert.deepEqual(fs.readdirSync(ab), [GUT]);
  s.zu();
});

test('Nachtrag: Start räumt Reste toter Kopien weg', async (t) => {
  const { ab, log } = await stapel(t, [], { vorher: (ab) => fs.mkdirSync(path.join(ab, '.kopie-999999999-3'), { recursive: true }) });
  assert.deepEqual(fs.readdirSync(ab), []);
  assert.equal(log.find((z) => z.typ === 'aufgeraeumt')?.anzahl, 1);
});

test('Nachtrag: PFL, Master-Pegel, Kopfhörer kommen am Kern an', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url);
  await warte(100);
  for (const [pfad, u, wert] of [['deck/1/pfl', 1, 1], ['deck/2/pfl', 1, 1], ['master/pegel', 0.5, -100], ['cue/mix', 1, 1], ['cue/pegel', 0.25, -150]]) {
    // Stellung an der Vorgabe (§7.3: erster Wert nur Stellung, danach skalierte Übernahme ab dort); die Attrappe rechnet linear
    assert.equal((await postJson(url, '/griff', { pfad, u: midiRoh(pfad, vorgabe(pfad), 'attrappe_linear') })).code, 200, pfad);
    assert.equal((await postJson(url, '/griff', { pfad, u })).code, 200, pfad);
    await warte(150);
    const r = s.ereignisse.filter((e) => e.a === '/e/regler' && e.f.pfad === pfad).at(-1);
    assert.ok(r, `/e/regler ${pfad}`);
    assert.ok(Math.abs(r.f.wert - wert) < 1e-3, `${pfad} ${r.f.wert}`);
  }
  s.zu();
});

// K2 Task 3.6: master/kleber (Schwelle des Summen-Kompressors, 0..1, 0 = aus) ist eine Hand der Seite, nur Andreas
test('K2 Kleber: /griff master/kleber u 0,55 kommt am Kern an; cypher 403; falsches u 400; /lage zeigt den Wert', async (t) => {
  const { url, log } = await stapel(t);
  const s = sse(url);
  await warte(100);
  const l0 = await (await fetch(`${url}/lage`)).json();
  assert.ok(!('master/kleber' in l0.regler), 'Vorgabe 0: nicht in der Lage');
  assert.equal((await postJson(url, '/griff', { pfad: 'master/kleber', u: midiRoh('master/kleber', vorgabe('master/kleber'), 'attrappe_linear') })).code, 200);
  const n0 = log.filter((z) => z.typ === 'an_kern').length;
  const g = await postJson(url, '/griff', { pfad: 'master/kleber', u: 0.55 });
  assert.equal(g.code, 200, JSON.stringify(g.j));
  assert.equal(g.j.felder.pfad, 'master/kleber');
  assert.equal(g.j.felder.midi_roh, 0.55);
  await warte(150);
  const an = log.filter((z) => z.typ === 'an_kern').slice(n0);
  assert.ok(an.some((z) => z.adresse === '/test/hand'), JSON.stringify(an));
  const r = s.ereignisse.filter((e) => e.a === '/e/regler' && e.f.pfad === 'master/kleber').at(-1);
  assert.ok(r && Math.abs(r.f.wert - 0.55) < 1e-3, JSON.stringify(r));
  const l = await (await fetch(`${url}/lage`)).json();
  assert.ok(Math.abs(l.regler['master/kleber'] - 0.55) < 0.06, JSON.stringify(l.regler));   // Lage rundet
  // Fehlerfälle: nichts geht an den Kern
  const n1 = log.filter((z) => z.typ === 'an_kern').length;
  const c = await postJson(url, '/griff', { pfad: 'master/kleber', u: 0.55 }, CYPHER);
  assert.equal(c.code, 403); assert.equal(c.j.fehler, 'nur_hand');
  for (const u of [1.01, -0.01, 'x', null]) assert.equal((await postJson(url, '/griff', { pfad: 'master/kleber', u })).code, 400, String(u));
  assert.equal(log.filter((z) => z.typ === 'an_kern').length, n1);
  s.zu();
});

// K2 Review: /lage zeigt duck/tiefe, duck/release, fx/2/rueckweg und <kanal>/send/2, wenn sie von der Vorgabe abweichen
// (Vorgaben 0, 200, 0, −200), sonst nicht: Cypher sieht, ob Duck, Hall-Send und Rückweg an sind
test('K2 Lage: duck/tiefe, duck/release, fx/2/rueckweg und erz/3/send/2 erscheinen nur abweichend von der Vorgabe', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url);
  await warte(100);
  const l0 = await (await fetch(`${url}/lage`)).json();
  for (const p of ['duck/tiefe', 'duck/release', 'fx/2/rueckweg', 'erz/3/send/2'])
    assert.ok(!(p in l0.regler), `Vorgabe: ${p} nicht in der Lage`);
  for (const [pfad, nach] of [['duck/tiefe', -9], ['erz/3/send/2', -9], ['duck/release', 400], ['fx/2/rueckweg', -6]]) {
    const r = await postJson(url, '/regler', { pfad, nach }, CYPHER);
    assert.equal(r.code, 200, JSON.stringify(r.j));
  }
  await warte(300);
  const l = await (await fetch(`${url}/lage`)).json();
  assert.equal(l.regler['duck/tiefe'], -9, JSON.stringify(l.regler));
  assert.equal(l.regler['erz/3/send/2'], -9);
  assert.equal(l.regler['duck/release'], 400);
  assert.equal(l.regler['fx/2/rueckweg'], -6);
  // zurück auf die Vorgabe: wieder unsichtbar
  for (const [pfad, nach] of [['duck/tiefe', 0], ['erz/3/send/2', -200], ['duck/release', 200], ['fx/2/rueckweg', 0]])
    assert.equal((await postJson(url, '/regler', { pfad, nach }, CYPHER)).code, 200);
  await warte(300);
  const l2 = await (await fetch(`${url}/lage`)).json();
  for (const p of ['duck/tiefe', 'duck/release', 'fx/2/rueckweg', 'erz/3/send/2']) assert.ok(!(p in l2.regler), `zurück: ${p} weg`);
  s.zu();
});

// Befund 4: „Fassung fehlt im Index“ und „Audiodatei fehlt“ sind zwei Fälle mit zwei Codes und zwei englischen Texten
test('Befund 4: nicht im Index und fehlende Audiodatei: eigene Codes, eigene englische Meldungen', async (t) => {
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'djk60n-b4-'));
  t.after(() => fs.rmSync(tmpB, { recursive: true, force: true }));
  const OHNE = 'f0000000000000b3';
  baueBestand(tmpB, [{ material_id: OHNE, titel: 'No audio', kaputt: 'ohne_audio' }]);
  const { o, url } = await stapel(t, [], { bestand: tmpB });
  const a = await postJson(url, '/laden', { deck: 1, material_id: 'f0000000000000ee' });
  const b = await postJson(url, '/laden', { deck: 1, material_id: OHNE });
  assert.equal(a.code, 400);
  assert.equal(b.code, 400);
  assert.equal(a.j.fehler, 'nicht_im_index');
  assert.equal(b.j.fehler, 'material_fehlt');
  assert.match(KOPIE_TEXT.nicht_im_index, /index/);
  assert.match(KOPIE_TEXT.material_fehlt, /audio/);
  assert.notEqual(KOPIE_TEXT.nicht_im_index, KOPIE_TEXT.material_fehlt);
  for (const v of Object.values(KOPIE_TEXT)) assert.doesNotMatch(v, /[äöüß]/i, 'englisch');
  assert.equal(o.gesendet, 0);
});

// Befund 5: der Kern verwirft /test/hand außerhalb des Prüfmodus (§19.0, netz.cpp: unbekannte_adresse). Die Seite
// meldet das sichtbar statt 200 ok, bis 35 hand_osc bringt. Zustand aus der Konfig (--kern-pruefmodus) oder, ohne
// Angabe, aus der Antwort des Kerns: /e/protokollfehler (/test/hand, unbekannte_adresse) an alle Abonnenten.
const GRIFF = { pfad: 'deck/1/fader', u: 0.5 };
test('Befund 5: Konfig sagt Kern ohne Prüfmodus → /griff 409 mit englischem Text, nichts an den Kern', async (t) => {
  const { o, log, url } = await stapel(t, [], { kernPruefmodus: false });
  assert.equal(HAND_PRUEFMODUS_TEXT, 'hand input needs test mode until slice 35');
  assert.equal((await (await fetch(url + '/konfig')).json()).kern_pruefmodus, 'aus');
  const r = await postJson(url, '/griff', GRIFF);
  assert.equal(r.code, 409);
  assert.equal(r.j.fehler, 'pruefmodus_aus');
  assert.equal(r.j.text, HAND_PRUEFMODUS_TEXT);
  assert.equal(o.gesendet, 0, 'nichts an den Kern');
  assert.ok(log.find((z) => z.typ === 'abgelehnt' && z.grund === 'pruefmodus_aus'));
  // Riegel bleibt vorne: falsches Ziel ist weiter 400
  assert.equal((await postJson(url, '/griff', { pfad: 'deck/3/fader', u: 0.5 })).code, 400);
});

test('Befund 5: Konfig sagt Prüfmodus an → /griff 200 wie bisher (Gegenprobe)', async (t) => {
  const { o, url } = await stapel(t, [], { kernPruefmodus: true });
  assert.equal((await (await fetch(url + '/konfig')).json()).kern_pruefmodus, 'an');
  assert.equal((await postJson(url, '/griff', GRIFF)).code, 200);
  assert.equal(o.gesendet, 1);
});

test('Befund 5: ohne Konfig lernt der Server es vom Kern (/e/protokollfehler /test/hand unbekannte_adresse), neue Generation setzt zurück', async (t) => {
  const { o, log, url } = await stapel(t, [], { echteBegruessung: true });
  const s = sse(url);
  await warte(100);
  assert.equal(s.ereignisse[0].f.pruefmodus, 'unbekannt');
  assert.equal((await (await fetch(url + '/konfig')).json()).kern_pruefmodus, 'unbekannt');
  assert.equal((await postJson(url, '/griff', GRIFF)).code, 200, 'unbekannt: senden');
  const udp = dgram.createSocket('udp4');
  t.after(() => udp.close());
  const an = (buf) => new Promise((ok) => udp.send(buf, 47150 + K, '127.0.0.1', ok));
  // Gegenprobe: derselbe Absender mit anderem Grund (Prüfmodus an, falsches Ziel) schaltet nichts um
  await an(kodiere('/e/protokollfehler', 'ss', ['/test/hand', 'unbekannter_regler']));
  await warte(100);
  assert.equal((await postJson(url, '/griff', GRIFF)).code, 200);
  // So antwortet der echte Kern ohne Prüfmodus (netz.cpp paket(): an alle Abonnenten)
  await an(kodiere('/e/protokollfehler', 'ss', ['/test/hand', 'unbekannte_adresse']));
  await warte(100);
  const e = s.ereignisse.find((x) => x.a === 'pruefmodus');
  assert.ok(e, 'SSE pruefmodus');
  assert.equal(e.f.stand, 'aus');
  assert.equal(e.f.text, HAND_PRUEFMODUS_TEXT);
  const vorher = o.gesendet;
  const r = await postJson(url, '/griff', GRIFF);
  assert.equal(r.code, 409);
  assert.equal(r.j.text, HAND_PRUEFMODUS_TEXT);
  assert.equal(o.gesendet, vorher);
  assert.ok(log.find((z) => z.typ === 'pruefmodus' && z.stand === 'aus'));
  // Kern-Neustart (neue Generation): Zustand wieder aus der Konfig (hier: unbekannt), die Hand geht wieder hinaus
  const gen = o.kern.generation;
  await an(kodiere('/k/willkommen', 'iihdds', [1, gen + 1, 0n, 0, 128, 'test']));
  await warte(100);
  assert.equal(s.ereignisse.filter((x) => x.a === 'pruefmodus').at(-1).f.stand, 'unbekannt');
  assert.equal((await postJson(url, '/griff', GRIFF)).code, 200);
  s.zu();
});

// Plan M-1 Annahme-Weg: Andreas drückt „annehmen“ auf der Seite; der Kern (hier die Attrappe, dieselbe Adresse wie der echte
// Kern in 35: /test/hand taste/<name>) meldet daraus /e/taste, worauf der Leitstand den Vorschlag annimmt.
test('Annahme-Weg: POST /taste annehmen geht als /test/hand taste/annehmen an den Kern, /e/taste kommt zurück', async (t) => {
  const { o, url } = await stapel(t);
  const s = sse(url);
  await warte(200);
  const r = await postJson(url, '/taste', { name: 'annehmen' });
  assert.equal(r.code, 200);
  assert.equal(r.j.felder.pfad, 'taste/annehmen');
  assert.equal(r.j.felder.midi_roh, 1);
  assert.equal(o.gesendet, 1);
  await warte(300);
  // /e/taste geht an den Leitstand, nicht an die Seite (nicht in DURCHREICHEN); dass der Kern die Taste ANGENOMMEN hat,
  // zeigt das Ausbleiben von /e/protokollfehler (Gegenstück: Test mit Mutation, dort meldet er unbekannter_regler).
  for (const n of ['verwerfen', 'stopp', 'freigabe']) assert.equal((await postJson(url, '/taste', { name: n })).code, 200, n);
  await warte(300);
  assert.equal(o.gesendet, 5);   // 4 Tasten + /k/ki/frei bei freigabe (Review Hand B2)
  assert.deepEqual(s.ereignisse.filter((x) => x.a === '/e/protokollfehler'), [], 'der Kern hat keine der vier Tasten abgewiesen');
  s.zu();
});

test('Annahme-Weg: unbekannte Taste 400, nichts an den Kern; Mutation taste_riegel_aus lässt sie durch (Fehlerfall)', async (t) => {
  const { o, log, url } = await stapel(t);
  for (const name of ['bogus', 'autonomie', '', 42, undefined]) {
    assert.equal((await postJson(url, '/taste', { name })).code, 400, String(name));
  }
  assert.equal(o.gesendet, 0, 'nichts an den Kern');
  assert.ok(log.find((z) => z.typ === 'abgelehnt' && z.grund === 'unbekannte_taste'));
});
test('Annahme-Weg, Mutation taste_riegel_aus: die Seite lässt „bogus“ durch, der Kern lehnt selbst ab', async (t) => {
  const { o, url } = await stapel(t, ['taste_riegel_aus']);
  const s = sse(url);
  await warte(200);
  assert.equal((await postJson(url, '/taste', { name: 'bogus' })).code, 200, 'ohne Riegel geht es raus');
  assert.equal(o.gesendet, 1);
  await warte(300);
  assert.ok(s.ereignisse.find((x) => x.a === '/e/protokollfehler' && x.f.grund === 'unbekannter_regler'), 'Kern lehnt selbst ab');
  s.zu();
});

test('Annahme-Weg: Kern ohne Prüfmodus und ohne hand_osc → /taste 409 wie /griff', async (t) => {
  const { o, url } = await stapel(t, [], { kernPruefmodus: false });
  const r = await postJson(url, '/taste', { name: 'annehmen' });
  assert.equal(r.code, 409);
  assert.equal(r.j.fehler, 'pruefmodus_aus');
  assert.equal(o.gesendet, 0);
});

test('→ STRUDEL (MVP 2 Scheibe 3): /loop kit macht den Loop zum Klang rec0 im Zusatz-Kit, nichts an den Kern', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const kits = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kits-'));
  fs.mkdirSync(path.join(kits, 'battery'));
  fs.writeFileSync(path.join(kits, 'battery/kit.json'), JSON.stringify({ schema: 1, name: 'battery',
    klaenge: [{ note: 0, name: 'bd:0', datei: 'bd_0.f32', frames: 1 }] }));
  fs.mkdirSync(path.join(loops, 'c-1'));
  fs.writeFileSync(path.join(loops, 'c-1/loop.f32'), Buffer.alloc(80));
  fs.writeFileSync(path.join(loops, 'c-1/loop.json'), JSON.stringify({ schema: 1, name: 'c-1', takte: 1, frames: 10, datei: 'loop.f32' }));
  const { o, url } = await stapel(t, [], { loops, kits });
  const vorher = o.gesendet;
  const r = await postJson(url, '/loop', { aktion: 'kit', name: 'c-1' });
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.equal(r.j.klang, 'rec0');
  assert.ok(fs.existsSync(path.join(kits, 'rec/kit.json')), 'ohne CYPHERDJ_INSTANZ im Server-Prozess: Kit rec');
  assert.equal((await postJson(url, '/loop', { aktion: 'kit', name: 'gibts-nicht' })).code, 400);
  assert.equal((await postJson(url, '/loop', { aktion: 'kit', name: 'c-1', klang: 'bd' })).code, 400);
  assert.equal(o.gesendet, vorher, 'kit schickt nichts an den Kern');
});

test('/welle (Plan Oberfläche T2): Loop-Welle gerechnet, zweiter Abruf aus dem Cache, falscher Name 400', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-welle-'));
  const d = path.join(loops, 'w1');
  fs.mkdirSync(d);
  const frames = 90000, x = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) x[2 * i] = x[2 * i + 1] = 0.5 * Math.sin(2 * Math.PI * 80 * i / 48000);
  fs.writeFileSync(path.join(d, 'loop.f32'), Buffer.from(x.buffer));
  fs.writeFileSync(path.join(d, 'loop.json'), JSON.stringify({ schema: 1, name: 'w1', beats: 4, bpm: 128, frames, datei: 'loop.f32', quelle: 'test' }));
  const { url, log } = await stapel(t, [], { loops, welleCache: cache });
  const r1 = await fetch(`${url}/welle?loop=w1`);
  assert.equal(r1.status, 200);
  const b = Buffer.from(await r1.arrayBuffer());
  assert.equal(b.subarray(0, 4).toString(), 'DJKW');
  assert.equal(b.readUInt32LE(12), Math.floor(frames / 256));
  const r2 = await fetch(`${url}/welle?loop=w1`);
  assert.equal(r2.status, 200);
  assert.equal(log.filter((z) => z.typ === 'welle_gerechnet').length, 1, 'zweiter Abruf muss aus dem Cache kommen');
  assert.equal((await fetch(`${url}/welle?loop=..%2Fetc`)).status, 400);
  assert.equal((await fetch(`${url}/welle?loop=fehlt`)).status, 404);
  assert.equal((await fetch(`${url}/welle`)).status, 400);
});

test('/fassung (Plan Oberfläche T5): liefert erster_schlag_frame der Fassung, falsche id 400', async (t) => {
  const { url } = await stapel(t);
  const e = leseBestand(BESTAND)[0];
  const r = await fetch(`${url}/fassung?material=${e.material_id}&bpm=${e.basis_bpm}&fassung=${e.fassung}`);
  assert.equal(r.status, 200);
  assert.equal(typeof (await r.json()).erster_schlag_frame, 'number');
  assert.equal((await fetch(`${url}/fassung?material=zz&bpm=128&fassung=1`)).status, 400);
});

test('/welle?material= (Review F7): Deck-Weg liefert die Welle der Fassung, unbekannte Fassung 404', async (t) => {
  const { url } = await stapel(t);
  const e = leseBestand(BESTAND)[0];
  const r = await fetch(`${url}/welle?material=${e.material_id}&bpm=${e.basis_bpm}&fassung=${e.fassung}`);
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), 'DJKW');
  assert.equal((await fetch(`${url}/welle?material=${e.material_id}&bpm=${e.basis_bpm}&fassung=99`)).status, 404);
});

// Plan 2: JSON-Post wie die Seite (content-type json, gleiche Herkunft oder ohne Origin)
const postJson = (url, pfad, daten, kopf = {}) => fetch(url + pfad, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf },
  body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));

test('/strudel (Plan 2): lesen, schreiben mit von andreas, Fehler mit Zeile, AUTO-Schalter', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { url } = await stapel(t, [], { musterOrdner: d });
  assert.deepEqual(await (await fetch(`${url}/strudel`)).json(), { text: '', von: null, zeit: null, status: null, autonom: true });
  const ok = await postJson(url, '/strudel', { text: 's("bd*4")' });
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  const st = await (await fetch(`${url}/strudel`)).json();
  assert.equal(st.text, 's("bd*4")'); assert.equal(st.von, 'andreas');
  const f = await postJson(url, '/strudel', { text: 's("bd*4")\n  .gain(' });
  assert.equal(f.code, 400); assert.match(f.j.fehler, /^Zeile 2: /);
  assert.equal((await (await fetch(`${url}/strudel`)).json()).text, 's("bd*4")', 'Fehler ändert nichts');
  assert.equal((await postJson(url, '/strudel/autonom', { an: false })).code, 200);
  assert.equal((await (await fetch(`${url}/strudel`)).json()).autonom, false);
  assert.equal((await postJson(url, '/strudel/autonom', { an: 'nein' })).code, 400);
  assert.equal((await postJson(url, '/strudel', { text: 42 })).code, 400);
  // AUTO ist aus, trotzdem schreibt das Feld (das ist Andreas)
  assert.equal((await postJson(url, '/strudel', { text: 's("hh*8")' })).code, 200);
});

test('/strudel (Plan-Review M3): ohne json 415, fremde Herkunft 403, eigene Herkunft 200; nichts geschrieben bei Abweisung', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { url } = await stapel(t, [], { musterOrdner: d });
  assert.equal((await post(url, '/strudel', { text: 's("bd")' })).code, 415);
  assert.equal((await post(url, '/strudel/autonom', { an: false })).code, 415);
  assert.equal((await postJson(url, '/strudel', { text: 's("bd")' }, { origin: 'https://boese.example' })).code, 403);
  assert.equal((await postJson(url, '/strudel/autonom', { an: false }, { origin: 'http://127.0.0.1:1' })).code, 403);
  assert.deepEqual(fs.readdirSync(d), [], 'Abweisungen schreiben nichts');
  assert.equal((await postJson(url, '/strudel', { text: 's("bd")' }, { origin: url })).code, 200);   // Negativ-Kontrolle
});

test('/strudel (Plan-Review M3): Muster läuft ohne Schreibrecht und mit Zeitlimit, Server bleibt bedienbar', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const opfer = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-opfer-')), 'geschrieben');
  const { url } = await stapel(t, [], { musterOrdner: d });
  const boese = `s("bd").gain((process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(opfer)}, 'x'), 1))`;
  const b = await postJson(url, '/strudel', { text: boese });
  assert.equal(b.code, 400, JSON.stringify(b.j));
  assert.equal(fs.existsSync(opfer), false, 'ein Muster darf keine Datei schreiben');
  const t0 = Date.now();
  const schwer = postJson(url, '/strudel', { text: 's("bd*1000000")' });
  await warte(200);
  const g0 = Date.now(); const g = await fetch(`${url}/strudel`); const dauerGet = Date.now() - g0;
  assert.equal(g.status, 200); assert.ok(dauerGet < 300, `GET während der Prüfung ${dauerGet} ms`);
  const s = await schwer;
  assert.equal(s.code, 400); assert.match(s.j.fehler, /Zeitlimit/);
  assert.ok(Date.now() - t0 < 3500, `Zeitlimit griff nach ${Date.now() - t0} ms`);
});

test('/strudel (Review F1–F4, F11): Reihenfolge, localhost, Endlosschleife, langer Körper, fehlender Ordner', { skip: OHNE_STRUDEL }, async (t) => {
  const eltern = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const d = path.join(eltern, 'erzeuger');   // F4: existiert noch nicht
  const { url } = await stapel(t, [], { musterOrdner: d });
  // F4: erster POST in einen fehlenden Ordner geht
  assert.equal((await postJson(url, '/strudel', { text: 's("bd")' })).code, 200);
  // F1: erst ein schweres, dann ein leichtes Muster → am Ende steht das zuletzt gesendete
  const schwer = postJson(url, '/strudel', { text: 's("bd*200000")' });
  await warte(100);
  const leicht = postJson(url, '/strudel', { text: 's("cp*2")' });
  await Promise.all([schwer, leicht]);
  assert.equal((await (await fetch(`${url}/strudel`)).json()).text, 's("cp*2")');
  // F2: die Seite unter localhost:<port> darf auch
  const port = new URL(url).port;
  assert.equal((await postJson(url, '/strudel/autonom', { an: true }, { origin: `http://localhost:${port}` })).code, 200);
  // F11a: Endlosschleife → Zeitlimit greift (ohne SIGKILL käme keine Antwort)
  const t0 = Date.now();
  const e = await postJson(url, '/strudel', { text: 's("bd").gain((() => { for (;;) {} })())' });
  assert.equal(e.code, 400); assert.match(e.j.fehler, /Zeitlimit/); assert.ok(Date.now() - t0 < 4000);
  // F11c: ein Muster über 4 096 Zeichen wird angenommen
  const lang = `s("bd")${'.gain(1)'.repeat(700)}`;
  assert.ok(lang.length > 5000);
  assert.equal((await postJson(url, '/strudel', { text: lang })).code, 200);
  // F3: stürzt der Kindprozess ab (Strudel fehlt), nennt die Meldung den Fehler, nicht die Node-Version
  const alt = process.env.STRUDEL_PAKETE;
  process.env.STRUDEL_PAKETE = path.join(eltern, 'gibt-es-nicht', 'packages');
  try {
    const r = await postJson(url, '/strudel', { text: 's("bd")' });
    assert.equal(r.code, 400);
    assert.doesNotMatch(r.j.fehler, /Node\.js v/);
    assert.match(r.j.fehler, /ERR_|Cannot find|not found|gibt-es-nicht/i);
  } finally {
    if (alt === undefined) delete process.env.STRUDEL_PAKETE; else process.env.STRUDEL_PAKETE = alt;
  }
});

// ---------- Plan E9: Deck-Bedienung gegen die Attrappe (sie setzt sprung, hotcue, loop nach Vertrag um) ----------
async function geladenesDeck(t, extra = {}) {
  const hc = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-hc-'));
  const st = await stapel(t, [], { hotcueOrdner: hc, ...extra });
  const s = sse(st.url);
  t.after(() => s.zu());
  assert.equal((await postJson(st.url, '/laden', { deck: 1, material_id: NIGHTSHIFT })).code, 200);
  for (let i = 0; i < 50 && !st.o.stand.decks['1']; i++) await warte(20);
  return { ...st, s, hc };
}
const zustand = async (o, pruef, ms = 3000) => {
  for (let i = 0; i < ms / 20; i++) { const z = o.stand.decks['1']; if (z && pruef(z)) return z; await warte(20); }
  return o.stand.decks['1'];
};
const eins = () => JSON.parse(fs.readFileSync(path.join(BESTAND, NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json'), 'utf8')).erste_eins_quell_beat;

test('/deck/sprung (Plan E9): stehendes Deck rastet ab der Takt-Eins ein, Attrappe steht danach dort', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  const r = await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 33.2, raster: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.felder.politik, 1); assert.equal(r.j.felder.raster_beats, 0);   // stehend: sofort (Review E9 F1)
  const z = await zustand(o, (x) => Math.abs(x.quell_beat - (e + 32)) < 1e-6);
  assert.ok(Math.abs(z.quell_beat - (e + 32)) < 1e-6, `quell_beat ${z.quell_beat}, erwartet ${e + 32}`);
  // Raster aus: exakt
  const r2 = await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 10.3, raster: 0 });
  assert.equal(r2.j.felder.politik, 1);
  const z2 = await zustand(o, (x) => Math.abs(x.quell_beat - (e + 10.3)) < 1e-6);
  assert.ok(Math.abs(z2.quell_beat - (e + 10.3)) < 1e-6);
  // Ablehnungen
  assert.equal((await postJson(url, '/deck/sprung', { deck: 3, ziel: 1, raster: 1 })).code, 400);
  assert.equal((await postJson(url, '/deck/sprung', { deck: 1, ziel: 1, raster: 3 })).code, 400);
  assert.equal((await post(url, '/deck/sprung', { deck: 1, ziel: 1, raster: 1 })).code, 415);
});

test('/deck/hotcue (Plan E9): setzen ab Takt-Eins gerundet und gespeichert, /e/hotcue, spielen, löschen, nach Laden wieder da', async (t) => {
  const { o, url, s, hc, log } = await geladenesDeck(t);
  const e = eins();
  const r = await postJson(url, '/deck/hotcue', { deck: 1, nr: 1, aktion: 'setzen', quell_beat: e + 12.4, raster: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const datei = path.join(hc, `${NIGHTSHIFT}_128000_r1.json`);
  assert.deepEqual(JSON.parse(fs.readFileSync(datei, 'utf8')), { 1: { quell_beat: e + 12, art: 'shot' } });
  await warte(200);
  assert.ok(s.ereignisse.some((x) => x.a === '/e/hotcue' && x.f.nr === 1 && x.f.quell_beat === e + 12), '/e/hotcue im Strom');
  assert.deepEqual((await (await fetch(`${url}/deck/hotcues?deck=1`)).json()), { 1: { quell_beat: e + 12, art: 'shot' } });
  // spielen: stehendes Deck steht danach am Hotcue (Phase der Position 0 → genau dort)
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 1, aktion: 'spielen', raster: 1 })).code, 200);
  const z = await zustand(o, (x) => Math.abs(x.quell_beat - (e + 12)) < 1e-6);
  assert.ok(Math.abs(z.quell_beat - (e + 12)) < 1e-6, `quell_beat ${z.quell_beat}`);
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 2, aktion: 'spielen', raster: 1 })).code, 400, 'leerer Platz');
  // nach neuem Laden stellt der Server Platz 1 wieder her
  assert.equal((await postJson(url, '/laden', { deck: 1, material_id: NIGHTSHIFT })).code, 200);
  for (let i = 0; i < 100 && !log.some((z) => z.typ === 'hotcues_wieder'); i++) await warte(20);
  assert.deepEqual(log.find((z) => z.typ === 'hotcues_wieder'), { typ: 'hotcues_wieder', deck: 1, anzahl: 1 });
  // löschen
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 1, aktion: 'loeschen' })).code, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(datei, 'utf8')), {});
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 9, aktion: 'setzen', quell_beat: 1, raster: 1 })).code, 400);
});

test('/deck/loop (Plan E9): an → Status 3, aus → 2, falsche Länge 400; Hotcue LOOP schickt Hotcue und Loop', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const e = eins();
  o.kern.sende('/k/deck/start', { id: 900, quelle: 'andreas', plan: '', gruppe: '', hoerschein: '', deck: 1,
    ab_beat: Math.ceil(o.kern.uhr.beat) + 1, quell_beat: e, politik: 1 });
  await zustand(o, (x) => x.status === 2);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 1 })).code, 200);
  assert.equal((await zustand(o, (x) => x.status === 3)).status, 3);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 1 })).code, 200);
  assert.equal((await zustand(o, (x) => x.status === 2)).status, 2);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 3, raster: 1 })).code, 400);
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 2, aktion: 'setzen', quell_beat: e + 8, art: 'loop', laenge: 2, raster: 1 })).code, 200);
  const n0 = log.filter((z) => z.typ === 'an_kern').length;
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 2, aktion: 'spielen', raster: 1 })).code, 200);
  const neu = log.filter((z) => z.typ === 'an_kern').slice(n0);
  const hot = neu.find((z) => z.adresse === '/k/deck/hotcue'), lp = neu.find((z) => z.adresse === '/k/deck/loop');
  assert.ok(hot && lp, JSON.stringify(neu.map((z) => z.adresse)));
  assert.equal(hot.felder.ab_beat, lp.felder.ab_beat);
  assert.ok(Number(lp.felder.id) > Number(hot.felder.id));
  assert.equal(lp.felder.laenge_beats, 2);
  assert.equal((await zustand(o, (x) => x.status === 3)).status, 3);
});

test('/fx: gültig → /k/fx mit Quelle andreas, einheit und drei Parametern, falsche Werte 400, ohne json 415', async (t) => {
  const { url, log } = await stapel(t);
  const n0 = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx').length;
  const r = await postJson(url, '/fx', { einheit: 1, art: 1, beats: 0.5, wet: 0.8, param1: 0.3, param2: 0.2, param3: 0.1, an: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const f = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx').slice(n0);
  assert.equal(f.length, 1);
  assert.deepEqual({ ...f[0].felder, id: 0 }, { id: 0, quelle: 'andreas', einheit: 1, art: 1, beats: 0.5, wet: 0.8, param1: 0.3, param2: 0.2, param3: 0.1, an: 1 });
  const basis = { einheit: 2, art: 2, beats: 4, wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5, an: false };
  for (const falsch of [{ einheit: 3 }, { art: 5 }, { beats: 3 }, { wet: 1.2 }, { param1: -0.1 }, { param2: 1.1 }, { param3: -0.1 }, { an: 'ja' }]) {
    const x = await postJson(url, '/fx', { ...basis, ...falsch });
    assert.equal(x.code, 400, JSON.stringify(falsch));
  }
  assert.equal((await post(url, '/fx', basis)).code, 415);
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx').length, n0 + 1, 'Abweisungen senden nichts');
  assert.deepEqual(await (await fetch(`${url}/fx`)).json(), [null, null], 'GET /fx ohne /e/fx: [null, null]');
});

test('/fx/zuweisung: gültig → /k/fx/zuweisung, falsche Werte 400', async (t) => {
  const { url, log } = await stapel(t);
  const n0 = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx/zuweisung').length;
  const r = await postJson(url, '/fx/zuweisung', { einheit: 1, kanal: 'deck/1', an: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const f = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx/zuweisung').slice(n0);
  assert.deepEqual({ ...f[0].felder, id: 0 }, { id: 0, quelle: 'andreas', einheit: 1, kanal: 'deck/1', an: 1 });
  for (const falsch of [{ einheit: 0 }, { kanal: 'deck/3' }, { an: 1 }]) {
    const x = await postJson(url, '/fx/zuweisung', { einheit: 2, kanal: 'pad/1', an: false, ...falsch });
    assert.equal(x.code, 400, JSON.stringify(falsch));
  }
  assert.equal((await postJson(url, '/fx/zuweisung', { einheit: 2, kanal: 'master', an: true })).code, 200);   // Master hat eigene Tasten
});

test('Review E9 F1/F9: stehendes Deck springt sofort (Politik 1, kein Warten aufs Raster), Hotcues nach /e/neustart wieder da', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const e = eins();
  const r = await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 33.2, raster: 16 });
  assert.equal(r.code, 200);
  assert.equal(r.j.felder.politik, 1, 'stehend: sofort');
  assert.ok(r.j.felder.ab_beat < o.kern.uhr.beat + 1, `ab_beat ${r.j.felder.ab_beat}, Uhr ${o.kern.uhr.beat}`);
  const z = await zustand(o, (x) => Math.abs(x.quell_beat - (e + 32)) < 1e-6);   // das Ziel rastet trotzdem ein (16 ab eins)
  assert.ok(Math.abs(z.quell_beat - (e + 32)) < 1e-6, `quell_beat ${z.quell_beat}`);
  // F9: gespeicherter Hotcue, dann /e/neustart → der Server schickt ihn nach 500 ms wieder
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 3, aktion: 'setzen', quell_beat: e + 8, raster: 1 })).code, 200);
  const n0 = log.filter((x) => x.typ === 'hotcues_wieder').length;
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 7, sample: 0 } });
  for (let i = 0; i < 60 && log.filter((x) => x.typ === 'hotcues_wieder').length === n0; i++) await warte(20);
  assert.equal(log.filter((x) => x.typ === 'hotcues_wieder').length, n0 + 1);
});

test('AUTO aus, zwei Einheiten unabhängig: Cyphers laufender Effekt je Einheit klingt aus, Andreas\' bleibt', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { o, url, log } = await stapel(t, [], { musterOrdner: d });
  const fx1 = { einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 };
  const fx2 = { einheit: 2, art: 1, beats: 0.5, wet: 0.7, param1: 0.2, param2: 0.5, param3: 0.5, an: 1 };
  const aus = (einheit) => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx' && z.felder.an === 0 && z.felder.einheit === einheit);
  // FX1 von Cypher gesetzt, FX2 von Andreas: AUTO aus lässt nur FX1 auslaufen
  fs.writeFileSync(path.join(d, 'fx_von.json'), JSON.stringify({ '1': { von: 'cypher', zeit: Date.now() }, '2': { von: 'andreas', zeit: Date.now() } }));
  o.vomKern({ adresse: '/e/fx', felder: fx1 });
  o.vomKern({ adresse: '/e/fx', felder: fx2 });
  assert.equal((await postJson(url, '/strudel/autonom', { an: false })).code, 200);
  assert.equal(aus(1).length, 1);
  assert.deepEqual({ ...aus(1)[0].felder, id: 0 }, { id: 0, quelle: 'andreas', einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 0 });
  assert.equal(aus(2).length, 0, 'FX2 ist von Andreas, AUTO aus fasst sie nicht an');
  // Negativ: FX1 danach auch von Andreas gesetzt → zweites AUTO aus fasst sie nicht mehr an
  assert.equal((await postJson(url, '/strudel/autonom', { an: true })).code, 200);
  assert.equal((await postJson(url, '/fx', { ...fx1, an: true })).code, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'fx_von.json'), 'utf8'))['1'].von, 'andreas');
  o.vomKern({ adresse: '/e/fx', felder: fx1 });
  assert.equal((await postJson(url, '/strudel/autonom', { an: false })).code, 200);
  assert.equal(aus(1).length, 1, 'kein zweites Aus');
});

test('/deck/hotcue aus_loop: leeres Pad bei laufendem Loop speichert DIESEN Loop (Start, Länge); ohne Loop 409', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  // ohne aktiven Loop: 409, nichts gespeichert
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 3, aktion: 'setzen', aus_loop: true, raster: 1 })).code, 409);
  o.kern.sende('/k/deck/start', { id: 901, quelle: 'andreas', plan: '', gruppe: '', hoerschein: '', deck: 1,
    ab_beat: Math.ceil(o.kern.uhr.beat) + 1, quell_beat: e, politik: 1 });
  await zustand(o, (x) => x.status === 2);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 1, raster: 1 })).code, 200);
  await zustand(o, (x) => x.status === 3);
  const r = await postJson(url, '/deck/hotcue', { deck: 1, nr: 3, aktion: 'setzen', aus_loop: true, raster: 1 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.hotcue.art, 'loop'); assert.equal(r.j.hotcue.laenge, 1);
  // der Kern kreist im Loop: jeder gemeldete Quell-Beat liegt in [Start, Start + 1] des gespeicherten Pads
  const q = [];
  for (let i = 0; i < 60; i++) { q.push(Number(o.stand.decks['1'].quell_beat)); await warte(20); }
  const s0 = r.j.hotcue.quell_beat;
  assert.ok(q.every((x) => x >= s0 - 0.02 && x <= s0 + 1.02), `Start ${s0}, gesehen ${Math.min(...q)}..${Math.max(...q)}`);
  assert.ok(Math.max(...q) - Math.min(...q) > 0.5, 'Loop kreist');
  // aus: danach wieder 409
  await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 1 });
  await zustand(o, (x) => x.status === 2);   // aus wirkt erst auf dem nächsten Beat
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 4, aktion: 'setzen', aus_loop: true, raster: 1 })).code, 409);
});

test('/deck/hotcue aus_loop bei STEHENDEM Deck: scharfer Loop (beats_bis_ende null) wird Loop-Cue ab dem Kopf', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 2, raster: 4 })).code, 200);
  const z = await zustand(o, (x) => !Number.isFinite(x.beats_bis_ende));
  assert.ok(!Number.isFinite(z.beats_bis_ende), `beats_bis_ende ${z.beats_bis_ende}`);
  const r = await postJson(url, '/deck/hotcue', { deck: 1, nr: 5, aktion: 'setzen', aus_loop: true, raster: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.hotcue, { quell_beat: e + 8, art: 'loop', laenge: 2 });
});

test('/deck/loop GET: aktiver Loop (Start, Länge) für die Anzeige; aus_loop ohne gemerkten Loop (Server neu) nimmt Kopf und Länge', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), {});
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 });
  await zustand(o, (x) => !Number.isFinite(x.beats_bis_ende));
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), { start: e + 8, laenge: 4 });
  // Server-Neustart simuliert: gemerkter Loop weg, der Kern hält ihn noch scharf
  o.aktiverLoop = {};
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), {});
  const r = await postJson(url, '/deck/hotcue', { deck: 1, nr: 6, aktion: 'setzen', aus_loop: true, laenge: 4, raster: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.hotcue, { quell_beat: e + 8, art: 'loop', laenge: 4 });
  // aus → wieder leer
  await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 4 });
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), {});
});

test('/deck/loop/sichern: aktiver Deck-Loop wird sample-genau (mit Grid-Versatz) ein Loop der Bibliothek, optional gleich in L1', async (t) => {
  const lo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, url, log } = await geladenesDeck(t, { loops: lo });
  const e = eins();
  const fj = JSON.parse(fs.readFileSync(path.join(BESTAND, NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json'), 'utf8'));
  // ohne Loop: 409
  assert.equal((await postJson(url, '/deck/loop/sichern', { deck: 1 })).code, 409);
  await postJson(url, '/deck/raster', { deck: 1, versatz_frames: -480 });
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  await postJson(url, '/deck/loop', { deck: 1, laenge: 2, raster: 4 });
  await zustand(o, (x) => x.beats_bis_ende === null || x.beats_bis_ende === Infinity);
  const r = await postJson(url, '/deck/loop/sichern', { deck: 1, box: 1 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.match(r.j.name, /^a-\d{6}-2b$/);
  const j = JSON.parse(fs.readFileSync(path.join(lo, r.j.name, 'loop.json'), 'utf8'));
  assert.deepEqual([j.schema, j.beats, j.bpm, j.frames, j.datei, j.quelle], [1, 2, 128, 45000, 'loop.f32', 'deck']);
  assert.ok((await (await fetch(`${url}/loops`)).json()).some((l) => l.name === r.j.name && l.beats === 2));
  // Inhalt = Ausschnitt der Fassung ab erster_schlag_frame + Versatz + (e + 8)·22500
  const start = fj.erster_schlag_frame - 480 + (e + 8) * 22500;
  const basis = fs.readFileSync(path.join(BESTAND, NIGHTSHIFT, 'fassungen', '128000_r1', fj.datei));
  const soll = basis.subarray(start * 8, (start + 45000) * 8);
  const ist = fs.readFileSync(path.join(lo, r.j.name, 'loop.f32'));
  assert.equal(ist.length, 45000 * 8);
  assert.ok(ist.equals(soll), 'Loop-Bytes = Ausschnitt der Fassung');
  // Negativ-Kontrolle: um einen Frame daneben ist es NICHT gleich
  assert.ok(!ist.equals(basis.subarray((start + 1) * 8, (start + 45001) * 8)));
  const ld = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/laden').at(-1);
  assert.deepEqual([ld.felder.box, ld.felder.name], [1, r.j.name]);
});

test('aktiver Deck-Loop überlebt den Neustart des Seiten-Servers (Datei neben den Hotcues)', async (t) => {
  const { o, url, hc } = await geladenesDeck(t);
  const e = eins();
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 });
  await zustand(o, (x) => x.beats_bis_ende === null || x.beats_bis_ende === Infinity);
  const datei = path.join(hc, 'aktive_loops.json');
  assert.ok(fs.existsSync(datei), 'Datei geschrieben');
  o.aktiverLoop = {};                       // Speicher weg wie nach einem Neustart
  o.ladeAktiveLoops();
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), { start: e + 8, laenge: 4 });
  await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 4 });
  assert.deepEqual(JSON.parse(fs.readFileSync(datei, 'utf8')), {});
});

test('/deck/raster (Plan Grid): Schritt und absolut gehen als /k/deck/raster an den Kern, /e/raster kommt durch, Quell-Beat bleibt', async (t) => {
  const { o, url, s, log } = await geladenesDeck(t);
  const q0 = Number(o.stand.decks['1'].quell_beat);
  const r = await postJson(url, '/deck/raster', { deck: 1, schritt_ms: 5 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.versatz_frames, r.j.gespeichert_frames], [240, 0]);
  const r2 = await postJson(url, '/deck/raster', { deck: 1, schritt_ms: -1 });
  assert.equal(r2.j.versatz_frames, 192);
  const an = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/raster').map((z) => z.felder);
  assert.deepEqual(an.map((f) => [f.quelle, f.deck, f.material_id, f.basis_bpm, f.fassung, f.versatz_frames]),
    [['andreas', 1, NIGHTSHIFT, 128, 1, 240], ['andreas', 1, NIGHTSHIFT, 128, 1, 192]]);
  for (let i = 0; i < 50 && s.ereignisse.filter((x) => x.a === '/e/raster').length < 2; i++) await warte(20);
  const ev = s.ereignisse.filter((x) => x.a === '/e/raster').map((x) => x.f.versatz_ms);
  assert.deepEqual(ev, [5, -1]);
  const z = await zustand(o, () => true);
  assert.ok(Math.abs(Number(z.quell_beat) - q0) < 1e-6, `quell_beat ${z.quell_beat} statt ${q0}`);
  assert.deepEqual(await (await fetch(`${url}/deck/raster?deck=1`)).json(), { versatz_frames: 192, gespeichert_frames: 0 });
  assert.equal((await postJson(url, '/deck/raster', { deck: 1, versatz_frames: 0 })).j.versatz_frames, 0);
  // Ablehnungen, nichts an den Kern
  const vorher = o.gesendet;
  assert.equal((await postJson(url, '/deck/raster', { deck: 3, schritt_ms: 5 })).code, 400);
  assert.equal((await postJson(url, '/deck/raster', { deck: 1, schritt_ms: 500 })).code, 400);
  assert.equal((await postJson(url, '/deck/raster', { deck: 1, versatz_frames: 1.5 })).code, 400);
  assert.equal((await postJson(url, '/deck/raster', { deck: 1 })).code, 400);
  assert.equal((await post(url, '/deck/raster', { deck: 1, schritt_ms: 5 })).code, 415);
  assert.equal(o.gesendet, vorher);
});

test('/deck/raster SET: stehendes Deck, Eins auf den Beat unter dem Kopf und auf die erste Eins im Track, Kopf bleibt; laufend 409', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const e = eins();
  const erster = JSON.parse(fs.readFileSync(path.join(BESTAND, NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json'), 'utf8')).erster_schlag_frame;
  // Kopf auf e + 5 (eine Eins + 1 Beat): dieser Schlag wird Eins. Erste Eins im Track dann e + 1 (Quell-Beat alt);
  // der Versatz legt den Quell-Beat e dorthin: k = +1, sofern e + 1 noch im Track ist (Lage < 3,5 Beats), sonst k = −3.
  const k = (erster / 22500 + e + 1) < 3.5 ? 1 : -3;
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 5, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 5)) < 1e-6);
  const r = await postJson(url, '/deck/raster', { deck: 1, set: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.k, k); assert.equal(r.j.versatz_frames, 22500 * k);
  const an = log.filter((z) => z.typ === 'an_kern').map((z) => [z.adresse, z.felder]);
  assert.equal(an.filter(([a]) => a === '/k/deck/raster').at(-1)[1].versatz_frames, 22500 * k);
  assert.equal(an.filter(([a]) => a === '/k/deck/sprung').at(-1)[1].delta_beats, -k);
  // Label unter dem Kopf ist e + 5 − k: eine Takt-Eins, physisch derselbe Schlag
  const z = await zustand(o, (x) => Math.abs(x.quell_beat - (e + 5 - k)) < 1e-6);
  assert.ok(Math.abs(z.quell_beat - (e + 5 - k)) < 1e-6, `quell_beat ${z.quell_beat}, erwartet ${e + 5 - k}`);
  // Negativ: schon auf der Eins → k 0, weder Raster noch Sprung an den Kern
  const vorher = o.gesendet;
  const r2 = await postJson(url, '/deck/raster', { deck: 1, set: true });
  assert.equal(r2.code, 200); assert.equal(r2.j.k, 0); assert.equal(o.gesendet, vorher);
  // laufend: 409, nichts an den Kern. Das Deck läuft wirklich (Attrappe): ein nur lokal gesetzter Status wurde vom
  // nächsten /zustand/deck der Attrappe wieder auf 'steht' überschrieben (Wackler ~1/8, 06.10., wie Hand T7).
  o.kern.sende('/k/deck/start', { id: 901, quelle: 'andreas', plan: '', gruppe: '', hoerschein: '', deck: 1,
    ab_beat: Math.ceil(o.kern.uhr.beat) + 1, quell_beat: e, politik: 1 });
  await zustand(o, (x) => x.status === 2);
  const vorher2 = o.gesendet;
  assert.equal((await postJson(url, '/deck/raster', { deck: 1, set: true })).code, 409);
  assert.equal(o.gesendet, vorher2);
});

test('/deck/raster/fix (Plan Grid): speichert je Fassung, nach Laden und nach /e/neustart schickt der Server den Versatz', async (t) => {
  const ro = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-raster-'));
  const { o, url, log } = await geladenesDeck(t, { rasterOrdner: ro });
  await postJson(url, '/deck/raster', { deck: 1, schritt_ms: 5 });
  await postJson(url, '/deck/raster', { deck: 1, schritt_ms: 5 });
  const r = await postJson(url, '/deck/raster/fix', { deck: 1 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.versatz_frames, r.j.gespeichert_frames], [480, 480]);
  const datei = path.join(ro, `${NIGHTSHIFT}_128000_r1.json`);
  assert.deepEqual(JSON.parse(fs.readFileSync(datei, 'utf8')), { versatz_frames: 480 });
  // ohne FIX verschoben, dann neu laden: gespeicherter Wert kommt, nicht der ungespeicherte
  await postJson(url, '/deck/raster', { deck: 1, schritt_ms: 1 });
  const n0 = log.filter((z) => z.typ === 'raster_wieder').length;
  assert.equal((await postJson(url, '/laden', { deck: 1, material_id: NIGHTSHIFT })).code, 200);
  for (let i = 0; i < 100 && log.filter((z) => z.typ === 'raster_wieder').length === n0; i++) await warte(20);
  assert.deepEqual(log.filter((z) => z.typ === 'raster_wieder').at(-1), { typ: 'raster_wieder', deck: 1, versatz_frames: 480 });
  const an = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/raster').at(-1).felder;
  assert.equal(an.versatz_frames, 480);
  assert.deepEqual(await (await fetch(`${url}/deck/raster?deck=1`)).json(), { versatz_frames: 480, gespeichert_frames: 480 });
  // Kern-Neustart: 500 ms später noch einmal
  const n1 = log.filter((z) => z.typ === 'raster_wieder').length;
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 8, sample: 0 } });
  for (let i = 0; i < 60 && log.filter((z) => z.typ === 'raster_wieder').length === n1; i++) await warte(20);
  assert.equal(log.filter((z) => z.typ === 'raster_wieder').length, n1 + 1);
  // Negativ-Kontrolle: Versatz 0 gespeichert → nach Laden wird NICHTS geschickt
  await postJson(url, '/deck/raster', { deck: 1, versatz_frames: 0 });
  await postJson(url, '/deck/raster/fix', { deck: 1 });
  const k0 = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/raster').length;
  assert.equal((await postJson(url, '/laden', { deck: 1, material_id: NIGHTSHIFT })).code, 200);
  await warte(600);
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/raster').length, k0);
  assert.equal((await postJson(url, '/deck/raster/fix', { deck: 3 })).code, 400);
});

test('/loop raster (Plan Grid): Schritt an den Kern, raster_fix schreibt versatz_frames in loop.json, andere Felder bleiben', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  schreibeLoop(loops, 'pruef-a', 4);
  const { o, log, url } = await stapel(t, [], { loops });
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 1, name: 'pruef-a', beats: 4 } });
  const r = await postJson(url, '/loop', { aktion: 'raster', box: 1, schritt_ms: -5 });
  assert.equal(r.code, 200);
  const an = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/raster').map((z) => [z.felder.box, z.felder.versatz_frames]);
  assert.deepEqual(an, [[1, -240]]);
  assert.deepEqual(await (await fetch(`${url}/loop/raster?box=1`)).json(), { versatz_frames: -240, gespeichert_frames: 0 });
  const vorher = JSON.parse(fs.readFileSync(path.join(loops, 'pruef-a', 'loop.json'), 'utf8'));
  assert.equal((await postJson(url, '/loop', { aktion: 'raster_fix', box: 1 })).code, 200);
  const nachher = JSON.parse(fs.readFileSync(path.join(loops, 'pruef-a', 'loop.json'), 'utf8'));
  assert.deepEqual(nachher, { ...vorher, versatz_frames: -240 });
  assert.deepEqual(await (await fetch(`${url}/loop/raster?box=1`)).json(), { versatz_frames: -240, gespeichert_frames: -240 });
  // Box leer: 409; über frames: wird in (−frames, frames) gefaltet; falsche Box 400
  assert.equal((await postJson(url, '/loop', { aktion: 'raster', box: 2, schritt_ms: 5 })).code, 409);
  assert.equal((await postJson(url, '/loop', { aktion: 'raster', box: 3, schritt_ms: 5 })).code, 400);
  assert.equal((await postJson(url, '/loop', { aktion: 'raster', box: 1, versatz_frames: 90000 + 100 })).j.versatz_frames, 100);   // Review F10
});

test('Review F5 (Plan Grid): Loop neu geladen ohne FIX → Server meldet den Datei-Wert, wie der Kern ihn spielt', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  schreibeLoop(loops, 'pruef-a', 4);
  const { o, url } = await stapel(t, [], { loops });
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 1, name: 'pruef-a', beats: 4 } });
  assert.equal((await postJson(url, '/loop', { aktion: 'raster', box: 1, schritt_ms: -5 })).code, 200);
  // derselbe Loop erneut in Box 1 geladen: der Kern nimmt versatz aus loop.json (0), LoopBoxen::laden
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'pruef-a' })).code, 200);
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 1, name: 'pruef-a', beats: 4 } });
  const j = await (await fetch(`${url}/loop/raster?box=1`)).json();
  assert.deepEqual(j, { versatz_frames: 0, gespeichert_frames: 0 });
});

// Plan Hand (2026-09-28): Quelle je Anfrage. Kopf x-djk-quelle: cypher → jeder Kern-Befehl dieser Anfrage trägt cypher;
// ohne Kopf andreas; die Hand (/griff, /taste) bleibt Andreas.
const CYPHER = { 'x-djk-quelle': 'cypher' };
test('Hand T1: Kopf x-djk-quelle cypher → Kern-Befehle mit Quelle cypher; ohne Kopf andreas; /griff und /taste 403', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const letzte = (adr) => log.filter((z) => z.typ === 'an_kern' && z.adresse === adr).at(-1)?.felder;
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 }, CYPHER)).code, 200);
  assert.equal(letzte('/k/deck/loop').quelle, 'cypher');
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 4 })).code, 200);
  assert.equal(letzte('/k/deck/loop').quelle, 'andreas');
  // async Weg (await in laden): Quelle trägt über await
  assert.equal((await postJson(url, '/laden', { deck: 2, material_id: NIGHTSHIFT }, CYPHER)).code, 200);
  assert.equal(letzte('/k/deck/laden').quelle, 'cypher');
  const vorher = o.gesendet;
  assert.equal((await postJson(url, '/griff', { pfad: 'deck/1/fader', u: 100 }, CYPHER)).code, 403);
  assert.equal((await postJson(url, '/taste', { name: 'freigabe' }, CYPHER)).code, 403);
  assert.equal(o.gesendet, vorher, 'nichts an den Kern');
  // Negativ-Kontrolle: Wiederherstellen nach /e/geladen (ausgelöst durch das cypher-Laden oben) bleibt andreas
  for (let i = 0; i < 50 && !o.stand.geladen['2']; i++) await warte(20);
  const hs = log.filter((z) => z.typ === 'an_kern' && (z.adresse === '/k/deck/hotcue_setzen' || z.adresse === '/k/deck/raster'));
  assert.ok(hs.every((z) => z.felder.quelle === 'andreas'), JSON.stringify(hs.map((z) => [z.adresse, z.felder.quelle])));
});

test('Hand T2: /regler → /k/teil (Rampe über Takte, Start auf Takt), Quittung zurück; nur_hand; Öffnen-Sperre D8', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil');
  // Rampe auf einem EQ (öffnet nichts)
  const r = await postJson(url, '/regler', { pfad: 'deck/1/eq/tief', nach: -12, takte: 1, ab: 'takt' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.felder.quelle, 'cypher'); assert.equal(r.j.felder.dauer_beats, 4); assert.equal(r.j.felder.ab_beat % 4, 0);
  assert.ok([1, 2].includes(r.j.quittung.status), JSON.stringify(r.j.quittung));
  for (let i = 0; i < 200 && o.stand.regler['deck/1/eq/tief'] !== -12; i++) await warte(20);
  assert.equal(o.stand.regler['deck/1/eq/tief'], -12);
  // nur Hand: Kern lehnt ab, Server meldet es
  const x = await postJson(url, '/regler', { pfad: 'xfader', nach: 0.5 }, CYPHER);
  assert.equal(x.code, 200); assert.equal(x.j.quittung.status, 6); assert.equal(x.j.quittung.grund, 'nur_hand');
  // D8: geschlossenen Kanal öffnen → 409 vom Server, nichts an den Kern
  const n0 = teile().length;
  const f = await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: 0 }, CYPHER);
  assert.equal(f.code, 409); assert.equal(f.j.fehler, 'kein_hoerschein'); assert.equal(teile().length, n0);
  // Negativ-Kontrolle: offen (Hand −6) → leiser geht durch; andreas wird nie gesperrt
  o.stand.regler['deck/1/fader'] = -6;
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: -10 }, CYPHER)).code, 200);
  o.stand.regler['deck/1/fader'] = -200;
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: -3 })).code, 200);
  // Form
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/9/x', nach: 0 }, CYPHER)).code, 400);
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/1/eq/tief', nach: 0, ab: 'bald' }, CYPHER)).code, 400);
});

test('Hand Rev2 B2: Taste freigabe schickt /k/ki/frei (sonst bleibt Stop Cypher eine Einbahnstraße)', async (t) => {
  const { url, log } = await geladenesDeck(t);
  assert.equal((await postJson(url, '/taste', { name: 'freigabe' })).code, 200);
  const frei = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/ki/frei');
  assert.equal(frei.length, 1); assert.equal(frei[0].felder.quelle, 'andreas');
  // Negativ-Kontrolle: stopp schickt kein /k/ki/frei
  assert.equal((await postJson(url, '/taste', { name: 'stopp' })).code, 200);
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/ki/frei').length, 1);
});

test('Hand Rev2 B1: Öffnen nach §1.6 (Trim + Fader > −26) und I3d (Sprung/Hotcue/Start auf offenem Deck) gesperrt für cypher', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const n = () => log.filter((z) => z.typ === 'an_kern').length;
  o.stand.regler['deck/1/trim'] = 0; o.stand.regler['deck/1/fader'] = -40;
  let n0 = n();
  let r = await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: 0 }, CYPHER);        // −40 → 0: öffnet
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'kein_hoerschein');
  r = await postJson(url, '/regler', { pfad: 'deck/1/trim', nach: 24 }, CYPHER);           // Trim hebt −40 auf −16: öffnet
  assert.equal(r.code, 409);
  r = await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: -30 }, CYPHER);         // bleibt zu: erlaubt
  assert.equal(r.code, 200);
  assert.equal(n(), n0 + 1);
  // offenes Deck: Sprung, Hotcue spielen, Start mit cypher → 409 ziel_ungehoert; andreas geht
  o.stand.regler['deck/1/fader'] = -6;
  n0 = n();
  r = await postJson(url, '/deck/sprung', { deck: 1, delta: 4, raster: 0 }, CYPHER);
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'ziel_ungehoert');
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 1, aktion: 'setzen', quell_beat: 8, art: 'shot', raster: 1 }, CYPHER)).code, 200);
  n0 = n();
  r = await postJson(url, '/deck/hotcue', { deck: 1, nr: 1, aktion: 'spielen', raster: 1 }, CYPHER);
  assert.equal(r.code, 409); assert.equal(n(), n0);
  assert.equal((await postJson(url, '/deck/sprung', { deck: 1, delta: 4, raster: 0 })).code, 200);
  // Loop auf offenem Deck ist frei (wiederholt Gehörtes)
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 }, CYPHER)).code, 200);
});

test('Hand T4/T5: GET /lage verdichtet; /deck/start synchron auf den Takt ab der Eins, /deck/stopp; Start auf offenem Deck gesperrt', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const e = eins();
  const r = await postJson(url, '/deck/start', { deck: 1, ab: 'takt' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const f = r.j.felder;
  assert.deepEqual([f.quelle, f.plan, f.deck, f.quell_beat, f.politik, f.ab_beat % 4], ['cypher', 'cypher', 1, e, 0, 0]);
  assert.ok([2, 5].includes(r.j.quittung.status), JSON.stringify(r.j.quittung));
  const z = await zustand(o, (x) => x.status === 2);
  assert.equal(z.status, 2);
  // Lage
  const l = await (await fetch(`${url}/lage`)).json();
  assert.ok(Number.isFinite(l.uhr.beat) && l.uhr.takt >= 1 && l.uhr.schlag >= 1 && l.uhr.schlag <= 4);
  assert.equal(l.ki.gestoppt, false);
  const d1 = l.decks.find((d) => d.deck === 1);
  assert.equal(d1.status, 2); assert.equal(d1.material_id, NIGHTSHIFT); assert.equal(d1.offen, false); assert.equal(typeof d1.titel, 'string');
  assert.ok(l.quittungen.some((q) => q.id === f.id), 'eigene Quittung in der Lage');
  assert.ok(l.quittungen.every((q) => q.quelle === 'cypher'));
  // Stopp
  assert.equal((await postJson(url, '/deck/stopp', { deck: 1, ab: 'jetzt' }, CYPHER)).code, 200);
  assert.equal((await zustand(o, (x) => x.status === 1)).status, 1);
  // offenes Deck: Start mit cypher gesperrt, nichts an den Kern
  o.stand.regler['deck/1/fader'] = -6;
  const n0 = log.filter((x) => x.typ === 'an_kern').length;
  const s = await postJson(url, '/deck/start', { deck: 1, ab: 'takt' }, CYPHER);
  assert.equal(s.code, 409); assert.equal(s.j.fehler, 'ziel_ungehoert');
  assert.equal(log.filter((x) => x.typ === 'an_kern').length, n0);
});

test('Hand T7: cypher darf FX/Strudel nur bei AUTO an und ohne Stop Cypher; Andreas-Schalter 403; offene Box gesperrt', { skip: OHNE_STRUDEL }, async (t) => {
  const mo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { o, url, log } = await geladenesDeck(t, { musterOrdner: mo });
  const fx1 = { einheit: 1, art: 1, beats: 1, wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5, an: true };
  // AUTO an (Vorgabe ohne Datei): FX mit cypher geht, Quelle cypher
  let r = await postJson(url, '/fx', fx1, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j)); assert.equal(r.j.felder.quelle, 'cypher');
  r = await postJson(url, '/strudel', { text: 's("bd*4")' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(JSON.parse(fs.readFileSync(path.join(mo, 'strom1.von.json'), 'utf8')).von, 'cypher');
  // AUTO aus (Andreas): cypher → 409 auto_aus, Andreas geht weiter
  assert.equal((await postJson(url, '/strudel/autonom', { an: false })).code, 200);
  assert.equal((await postJson(url, '/fx', fx1, CYPHER)).j.fehler, 'auto_aus');
  r = await postJson(url, '/strudel', { text: 's("hh*8")' }, CYPHER);
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'auto_aus');
  assert.equal((await postJson(url, '/strudel', { text: 's("cp")' })).code, 200);
  assert.equal((await postJson(url, '/strudel/autonom', { an: true })).code, 200);
  // Stop Cypher: FX mit cypher → 409 ki_gestoppt
  // Über die echte Taste, nicht per vomKern: die Attrappe meldet alle 50 ms /zustand/kern mit IHREM ki_gestoppt und
  // überschrieb einen nur eingespielten Stopp vor dem nächsten POST (Wackler im Gesamtlauf 06.10., intern).
  assert.equal((await postJson(url, '/taste', { name: 'stopp' })).code, 200);
  for (let i = 0; i < 100 && !o.kiGestoppt; i++) await warte(10);
  assert.equal((await postJson(url, '/fx', fx1, CYPHER)).j.fehler, 'ki_gestoppt');
  assert.equal((await postJson(url, '/taste', { name: 'freigabe' })).code, 200);
  for (let i = 0; i < 100 && o.kiGestoppt; i++) await warte(10);
  // Andreas' Schalter
  for (const [p, d] of [['/strudel/autonom', { an: true }], ['/deck/raster', { deck: 1, schritt_ms: 5 }], ['/deck/raster/fix', { deck: 1 }]]) {
    assert.equal((await postJson(url, p, d, CYPHER)).code, 403, p);
  }
  // offene Box: laden/start mit cypher → 409, stopp frei
  o.stand.regler['pad/1/fader'] = -6;
  assert.equal((await postJson(url, '/loop', { aktion: 'start', box: 1 }, CYPHER)).code, 409);
  assert.equal((await postJson(url, '/loop', { aktion: 'stopp', box: 1 }, CYPHER)).code, 200);
});

test('Hand T8: /abbruch bricht Cyphers eigene Teile ab (Quittung 7 abbruch), nur mit Kopf cypher', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const r = await postJson(url, '/regler', { pfad: 'deck/1/eq/hoch', nach: -26, takte: 8, ab: 'takt' }, CYPHER);
  assert.equal(r.code, 200);
  assert.equal(r.j.felder.plan, 'cypher');
  assert.equal((await postJson(url, '/abbruch', {})).code, 403);   // Andreas hat Stop Cypher
  const a = await postJson(url, '/abbruch', {}, CYPHER);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual([a.j.felder.quelle, a.j.felder.plan, a.j.felder.teile], ['cypher', 'cypher', '*']);
  let q = null;
  for (let i = 0; i < 100 && !q; i++) { q = (o.quittungen.get(r.j.felder.id) ?? []).find((x) => Number(x.status) === 7); await warte(20); }
  assert.ok(q, 'Quittung 7 für die Rampe'); assert.equal(q.grund, 'abbruch');
});

test('Ohr T5: GET /hoeren -> 400 unbekanntes Deck, 409 ohne geladenes Deck', async (t) => {
  const { url } = await stapel(t);
  const rDeck = await fetch(url + '/hoeren?deck=3');
  assert.equal(rDeck.status, 400);
  assert.equal((await rDeck.json()).fehler, 'deck');

  const rLeer = await fetch(url + '/hoeren?deck=2');
  assert.equal(rLeer.status, 409);
  assert.equal((await rLeer.json()).fehler, 'kein_kernstand');
});

// Ohr T8 (Plan Rev. 4): /hoeren trägt zusätzlich sync (sync_ms, deck_gegen_deck_ms, n), fest validiert:false
// (Befund Slice 2: anschlagPhase instabil an Mischungen, geht nicht ins Urteil). Eigene Ring-Datei je Fall, mit
// dem live gemeldeten Beat/BPM der Attrappe zentriert (schreibeRing importiert aus hilfen/ring.mjs). Periodischer
// Bandsprung je Schlag (wie ohr.test.mjs genSaetze), sonst findet anschlagPhase keinen Anschlag (NaN).
function saetzeMitSchlag(von, bis, bpm, { offsetMs = 5, decayMs = 20, amplitude = 0.3, baseline = 1e-4 } = {}) {
  const beatMs = 60000 / bpm;
  const n = Math.round((bis - von) * beatMs);
  return Array.from({ length: n }, (_, i) => {
    const beat = von + i / beatMs;
    const phaseMs = (beat - Math.round(beat)) * beatMs;
    const dt = ((phaseMs - offsetMs) % beatMs + beatMs) % beatMs;
    const v = baseline + amplitude * Math.exp(-dt / decayMs);
    return { sample: i, beat, quell: NaN, band: [v, v, v, v, v, v], k: 1e-3, spitze: 0.2 };
  });
}

test('Ohr T8: GET /hoeren?deck=1 trägt sync mit validiert:false, ohne Partner deck_gegen_deck_ms null', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-huellen-t8-')), 'huellen');
  const { o, url } = await geladenesDeck(t, { huellen: ringPfad });
  const u = o.kern.uhr;
  assert.ok(u, 'kern.uhr gesetzt');
  const mitte = u.beat;
  const daten = saetzeMitSchlag(mitte - 8, mitte + 8, u.bpm);
  schreibeRing(ringPfad, { [K1]: daten, [KMASTER]: daten });
  await warte(200);   // ohrTakt liest alle 100 ms neu

  const r = await fetch(url + '/hoeren?deck=1&takte=1');
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  assert.equal(j.sync.validiert, false);
  assert.equal(typeof j.sync.sync_ms, 'number', `sync_ms=${JSON.stringify(j.sync.sync_ms)}`);
  assert.ok(!Number.isNaN(j.sync.sync_ms) && j.sync.sync_ms !== null, `sync_ms=${j.sync.sync_ms}`);
  assert.equal(typeof j.sync.n, 'number');
  assert.equal(j.sync.deck_gegen_deck_ms, null, 'kein Partner (Deck 2 nicht offen) -> NaN -> null im JSON');
});

test('Ohr T8: mit laufendem, offenem Partner (Deck 2) ist deck_gegen_deck_ms eine endliche Zahl', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-huellen-t8b-')), 'huellen');
  // I3a (Kern-Riegel, Ohr T14) nimmt Quelle andreas aus (§17 „die Hand wird nie blockiert"); dieser Test öffnet ohne
  // x-djk-quelle = andreas über /regler, braucht also keine Mutation mehr (Befund Slice 2, hoerschein.mjs).
  const { o, url, log } = await geladenesDeck(t, { huellen: ringPfad });
  assert.equal((await postJson(url, '/laden', { deck: 2, material_id: NIGHTSHIFT })).code, 200);
  for (let i = 0; i < 50 && !o.stand.decks['2']; i++) await warte(20);
  assert.equal((await postJson(url, '/deck/start', { deck: 2 })).code, 200);
  const rRegler = await postJson(url, '/regler', { pfad: 'deck/2/fader', nach: 0, ab: 'jetzt' });   // ohne x-djk-quelle = andreas, öffnet
  assert.equal(rRegler.code, 200, JSON.stringify(rRegler.j));
  for (let i = 0; i < 50 && !(o.stand.decks['2'] && Number(o.stand.decks['2'].status) >= 2 && o.stand.regler['deck/2/fader'] === 0); i++) await warte(20);
  assert.equal(o.stand.regler['deck/2/fader'], 0, `Fader 2 offen (Regler-Zustand angekommen); regler=${JSON.stringify(o.stand.regler)}; log(an_kern)=${JSON.stringify(log.filter((x) => x.typ === 'an_kern' && x.adresse === '/k/teil'))}`);
  assert.ok(Number(o.stand.decks['2']?.status) >= 2, `Deck 2 läuft (status=${o.stand.decks['2']?.status})`);

  const u = o.kern.uhr;
  const mitte = u.beat;
  const daten = saetzeMitSchlag(mitte - 8, mitte + 8, u.bpm);
  schreibeRing(ringPfad, { [K1]: daten, [KMASTER]: daten, [K2]: daten });
  await warte(200);

  const r = await fetch(url + '/hoeren?deck=1&takte=1');
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  assert.equal(j.sync.validiert, false);
  assert.ok(Number.isFinite(j.sync.deck_gegen_deck_ms), `deck_gegen_deck_ms=${j.sync.deck_gegen_deck_ms}, sync=${JSON.stringify(j.sync)}`);
});

// Task 1.5: Trim-Vorschlag relativ zum aktuellen Trim (der Mess-Abgriff liegt NACH dem Trim, live.md Posten 5)
test('Ohr 1.5: /hoeren trägt vergleich.trim_vorschlag_db = round1(trim_alt − pegel_diff_db), relativ zum gemessenen Wert', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-huellen-t15-')), 'huellen');
  const { o, url } = await geladenesDeck(t, { huellen: ringPfad });
  o.stand.regler['deck/1/trim'] = -3;
  const u = o.kern.uhr;
  const mitte = u.beat;
  // LUFS kommt aus Satz.k (ohr.ts miss): Deck ~6 dB lauter als der Master
  const deck = saetzeMitSchlag(mitte - 8, mitte + 8, u.bpm).map((x) => ({ ...x, k: 4e-3 }));
  const master = saetzeMitSchlag(mitte - 8, mitte + 8, u.bpm);
  schreibeRing(ringPfad, { [K1]: deck, [KMASTER]: master });
  await warte(200);
  const r = await fetch(url + '/hoeren?deck=1&takte=1');
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  const diff = j.vergleich.pegel_diff_db;
  assert.ok(Number.isFinite(diff) && Math.abs(diff) > 1, `Deck lauter als Master gemessen (pegel_diff_db=${diff})`);
  assert.equal(j.vergleich.trim_vorschlag_db, Math.round((-3 - diff) * 10) / 10, JSON.stringify(j.vergleich));
  // Trim unbekannt (Seiten-Neustart, stand.regler leer): KEIN Vorschlag, dafür trim_unbekannt
  delete o.stand.regler['deck/1/trim'];
  const j0 = await (await fetch(url + '/hoeren?deck=1&takte=1')).json();
  assert.ok(!('trim_vorschlag_db' in j0.vergleich), JSON.stringify(j0.vergleich));
  assert.equal(j0.vergleich.trim_unbekannt, true);
});

async function hoerenMitK(t, kDeck, kMaster, trim = -3) {
  const ringPfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-huellen-t15k-')), 'huellen');
  const { o, url } = await geladenesDeck(t, { huellen: ringPfad });
  o.stand.regler['deck/1/trim'] = trim;
  const u = o.kern.uhr;
  const mitte = u.beat;
  const mk = (k) => saetzeMitSchlag(mitte - 8, mitte + 8, u.bpm).map((x) => ({ ...x, k }));
  schreibeRing(ringPfad, { [K1]: mk(kDeck), [KMASTER]: mk(kMaster) });
  await warte(200);
  const r = await fetch(url + '/hoeren?deck=1&takte=1');
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return (await r.json()).vergleich;
}

test('Ohr 1.5: Vorschlag wird auf [-24, +24] geklemmt (Deck ~40 dB lauter, Trim -3)', async (t) => {
  const v = await hoerenMitK(t, 10, 1e-3);
  assert.ok(v.pegel_diff_db > 30, `pegel_diff_db=${v.pegel_diff_db}`);
  assert.equal(v.trim_vorschlag_db, -24);
});

test('Ohr 1.5: stummes Deck (db10 -200, pegel_diff ~ -186) -> kein Vorschlag', async (t) => {
  const v = await hoerenMitK(t, 0, 1e-3);
  assert.ok(v.neu.lufs <= -200 && v.pegel_diff_db < -100, JSON.stringify(v));
  assert.ok(!('trim_vorschlag_db' in v) && !('trim_unbekannt' in v), JSON.stringify(v));
});

test('Ohr 1.5: pegel_diff_db keine Zahl (JSON null) -> kein Vorschlag', async (t) => {
  const v = await hoerenMitK(t, Infinity, 1e-3);
  assert.ok(typeof v.pegel_diff_db !== 'number' || !Number.isFinite(v.pegel_diff_db), JSON.stringify(v));
  assert.ok(!('trim_vorschlag_db' in v), JSON.stringify(v));
});

test('Ohr 1.5: ohne vergleich (nichts gehört) kein trim_vorschlag_db', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-huellen-t15n-')), 'huellen');
  const { o, url } = await geladenesDeck(t, { huellen: ringPfad });
  o.stand.regler['deck/1/trim'] = -3;
  const r = await fetch(url + '/hoeren?deck=1&takte=1');
  const j = await r.json();
  assert.equal(r.status, 409, JSON.stringify(j));
  assert.ok(!('vergleich' in j) && !('trim_vorschlag_db' in j), JSON.stringify(j));
});

// ---------- Ohr T10: Hörschein je Takt an den Kern, Öffnen mit Hörschein ----------
test('Ohr T10: /regler öffnet ohne Hörschein weiter 409 kein_hoerschein, jetzt MIT urteil im Körper', async (t) => {
  const { url } = await geladenesDeck(t);
  const f = await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: 0 }, CYPHER);
  assert.equal(f.code, 409);
  assert.equal(f.j.fehler, 'kein_hoerschein');
  assert.ok('urteil' in f.j, JSON.stringify(f.j));
});

test('Ohr T10: /regler öffnet MIT gültigem Hörschein (in o.hoerscheine gesetzt) -> /k/teil trägt hoerschein: hs_id', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  // Deck 1 ist über NIGHTSHIFT geladen (geladenesDeck); Inhalt-Schlüssel wie §4.5 bauen
  const inhalt = `${NIGHTSHIFT}/128000_r1`;
  // Test setzt den Schein über die Hoerscheinstelle-API (o.hoerscheine ist dieselbe Referenz wie hoerscheinstelle.scheine)
  o.hoerscheine['deck/1'] = {
    hs_id: 'ohr-1-testschein', kanal: 'deck/1', inhalt, deck: 1, bpm: 128,
    gemessen_von_beat: 0, gemessen_bis_beat: 16, gueltig_bis_beat: 1e9, quell_von: 0, quell_bis: 16, erneuerung: 0,
    sync_ms: 0, deck_gegen_deck_ms: 0, lufs_kurz: -20, pegel_diff_db: 0, baender_db: [-20, -20, -20, -20, -20, -20],
    urteil: 'ok', gruende: [], laufend_baender_db: [-20, -20, -20, -20, -20, -20],
    ueberdeckung: { sub: 0, tief: 0, tiefmitte: 0, mitte: 0, praesenz: 0, hoch: 0 },
    summe_spitze_db: -6, clip_anteil: 0, eq_vorschlag: { tief: 0, mitte: 0, hoch: 0 },
  };
  const f = await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: 0 }, CYPHER);
  assert.equal(f.code, 200, JSON.stringify(f.j));
  const teil = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').at(-1);
  assert.equal(teil.felder.hoerschein, 'ohr-1-testschein', JSON.stringify(teil.felder));
});

// ---------- Ohr T18: FX-Routing (Post Fader / Insert), Andreas' Taste ----------
const routingSendungen = (log) => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx/routing');
const bis = async (f, ms = 2000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); };

test('Ohr T18 /fx/routing: Andreas schaltet, Antwort mit Quittung, GET und /lage folgen /e/fx/routing', async (t) => {
  const { url, log } = await stapel(t);
  assert.deepEqual(await (await fetch(`${url}/fx/routing`)).json(), { routing: 'post_fader' });   // Vorgabe
  assert.equal((await (await fetch(`${url}/lage`)).json()).fx_routing, 'post_fader');
  const r = await postJson(url, '/fx/routing', { routing: 'insert' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.quittung.status, 2, JSON.stringify(r.j));   // die Attrappe nimmt an (1), startet (2), fertig (3)
  const f = routingSendungen(log);
  assert.equal(f.length, 1);
  assert.deepEqual({ ...f[0].felder, id: 0 }, { id: 0, quelle: 'andreas', routing: 1 });
  await bis(async () => (await (await fetch(`${url}/fx/routing`)).json()).routing === 'insert');
  assert.deepEqual(await (await fetch(`${url}/fx/routing`)).json(), { routing: 'insert' });   // aus /e/fx/routing des Kerns
  assert.equal((await (await fetch(`${url}/lage`)).json()).fx_routing, 'insert');
  assert.equal((await postJson(url, '/fx/routing', { routing: 'post_fader' })).code, 200);
  await bis(async () => (await (await fetch(`${url}/fx/routing`)).json()).routing === 'post_fader');
  assert.equal((await (await fetch(`${url}/lage`)).json()).fx_routing, 'post_fader');
});

test('Ohr T18 /fx/routing: Quelle cypher bekommt 403 nur_andreas und der Kern nichts; falsche Werte 400', async (t) => {
  const { url, log } = await stapel(t);
  const r = await postJson(url, '/fx/routing', { routing: 'insert' }, { 'x-djk-quelle': 'cypher' });
  assert.equal(r.code, 403);
  assert.equal(r.j.fehler, 'nur_andreas');
  assert.equal(routingSendungen(log).length, 0, 'Cyphers Anfrage geht nicht an den Kern');
  for (const falsch of [{ routing: 'pre' }, { routing: 1 }, {}, { routing: null }]) {
    const x = await postJson(url, '/fx/routing', falsch);
    assert.equal(x.code, 400, JSON.stringify(falsch));
  }
  assert.equal(routingSendungen(log).length, 0, 'Abweisungen senden nichts');
  assert.deepEqual(await (await fetch(`${url}/fx/routing`)).json(), { routing: 'post_fader' }, 'der Stand blieb');
  // Negativ-Kontrolle: Andreas' Anfrage danach geht durch
  assert.equal((await postJson(url, '/fx/routing', { routing: 'insert' })).code, 200);
  assert.equal(routingSendungen(log).length, 1);
});

test('Ohr T18 /fx/routing: der Wunsch überlebt den Kern-Neustart (insert wird nach /e/neustart erneut gesendet, post_fader nicht)', async (t) => {
  const { o, url, log } = await stapel(t);
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 2, sample: 0 } });   // Vorgabe im Wunsch: nichts zu senden
  await warte(300);
  assert.equal(routingSendungen(log).length, 0, 'Negativ-Kontrolle: bei der Vorgabe wird nichts erneut gesendet');
  assert.equal((await postJson(url, '/fx/routing', { routing: 'insert' })).code, 200);
  assert.equal(routingSendungen(log).length, 1);
  await bis(async () => (await (await fetch(`${url}/fx/routing`)).json()).routing === 'insert');
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 3, sample: 0 } });   // der Kern ist neu: Vorgabe 0, alles aus
  assert.deepEqual(await (await fetch(`${url}/fx/routing`)).json(), { routing: 'post_fader' }, 'nach dem Neustart steht der Kern auf der Vorgabe');
  await bis(() => routingSendungen(log).length === 2);
  assert.equal(routingSendungen(log).length, 2, 'insert geht erneut raus');
  assert.deepEqual({ ...routingSendungen(log)[1].felder, id: 0 }, { id: 0, quelle: 'andreas', routing: 1 });
  await bis(async () => (await (await fetch(`${url}/fx/routing`)).json()).routing === 'insert');
  assert.equal((await postJson(url, '/fx/routing', { routing: 'post_fader' })).code, 200);   // Wunsch zurück auf die Vorgabe
  const n = routingSendungen(log).length;
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 4, sample: 0 } });
  await warte(300);
  assert.equal(routingSendungen(log).length, n, 'post_fader ist die Vorgabe des Kerns, nichts erneut');
});

test('Ohr T18 /fx/routing: /e/fx/routing geht an jeden Strom (zweites Fenster) und in den Stand des Stroms', async (t) => {
  const { o, url } = await stapel(t);
  const s1 = sse(url);
  await bis(() => s1.ereignisse.length > 0);
  assert.equal(s1.ereignisse[0].f.fxRouting, 'post_fader', 'Anfangsstand trägt das Routing');
  o.vomKern({ adresse: '/e/fx/routing', felder: { routing: 1 } });   // etwa aus einem anderen Fenster geschaltet
  await bis(() => s1.ereignisse.some((e) => e.a === '/e/fx/routing'));
  const e = s1.ereignisse.find((x) => x.a === '/e/fx/routing');
  assert.ok(e, 'Ereignis im Strom');
  assert.equal(e.f.routing, 1);
  const s2 = sse(url);   // ein zweites, später geöffnetes Fenster sieht den Stand sofort
  await bis(() => s2.ereignisse.length > 0);
  assert.equal(s2.ereignisse[0].f.fxRouting, 'insert');
  s1.zu(); s2.zu();
});

test('Studio S1: /strudel mit strom 2 schreibt in <ordner>2, strom 1 unberührt; AUTO je Strom; strom 4 → 400', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { url } = await stapel(t, [], { musterOrdner: d });
  assert.equal((await postJson(url, '/strudel', { text: 's("bat_synth*4")', strom: 2 })).code, 200);
  assert.equal(fs.readFileSync(`${d}2/strom1.js`, 'utf8'), 's("bat_synth*4")\n');
  assert.equal((await (await fetch(`${url}/strudel?strom=2`)).json()).text, 's("bat_synth*4")');
  assert.equal((await (await fetch(`${url}/strudel`)).json()).text, '', 'Strom 1 leer');
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 3 })).code, 200);
  assert.equal((await (await fetch(`${url}/strudel?strom=3`)).json()).autonom, false);
  assert.equal((await (await fetch(`${url}/strudel`)).json()).autonom, true, 'AUTO von Strom 1 unberührt');
  assert.equal((await postJson(url, '/strudel', { text: 's("bd")', strom: 4 })).code, 400);
  assert.equal((await fetch(`${url}/strudel?strom=0`)).status, 400);
});

test('Studio S1: /fx/zuweisung nimmt erz/2 und erz/3, nicht erz/4', async (t) => {
  const { url } = await stapel(t);
  for (const kanal of ['erz/2', 'erz/3']) assert.equal((await postJson(url, '/fx/zuweisung', { einheit: 1, kanal, an: true })).code, 200, kanal);
  assert.equal((await postJson(url, '/fx/zuweisung', { einheit: 1, kanal: 'erz/4', an: true })).code, 400);
});

test('Studio S6 T2: /spur schickt Kanalzug-Fahrten als /k/teil ab der Takt-Eins, /spur/stopp bricht ab, D8 für cypher', async (t) => {
  const { url, log } = await stapel(t);
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil');
  const spur = { name: 'aus-2', fahrten: [
    { ziel: 'erz/2/filter', ab_takt: 1, takte: 2, nach: -0.6 },
    { ziel: 'erz/2/fader', ab_takt: 3, takte: 1, nach: -200 },
  ] };
  const r = await postJson(url, '/spur', { spur, ab: 'takt' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.anker_beat % 4, 0); assert.equal(r.j.teile, 2);
  assert.deepEqual(teile().slice(-2).map((z) => [z.felder.pfad, z.felder.ab_beat - r.j.anker_beat, z.felder.dauer_beats, z.felder.politik, z.felder.form, z.felder.plan, z.felder.quelle]),
    [['erz/2/filter', 0, 8, 0, 1, 'spur:aus-2', 'cypher'], ['erz/2/fader', 8, 4, 1, 1, 'spur:aus-2', 'cypher']]);
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((s) => [s.name, s.quelle, s.anker_beat]), [['aus-2', 'cypher', r.j.anker_beat]]);
  assert.equal((await postJson(url, '/spur', { spur }, CYPHER)).j.fehler, 'laeuft');
  // Stopp: /k/abbruch mit dem Plan der Spur, danach keine laufende Spur
  const s = await postJson(url, '/spur/stopp', { name: 'aus-2' }, CYPHER);
  assert.equal(s.code, 200, JSON.stringify(s.j));
  const ab = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').at(-1);
  assert.equal(ab.felder.plan, 'spur:aus-2'); assert.equal(ab.felder.teile, '*'); assert.equal(ab.felder.quelle, 'cypher');
  assert.deepEqual(await (await fetch(`${url}/spur`)).json(), []);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'aus-2' }, CYPHER)).code, 404);
  // D8: Cyphers Spur zieht ein geschlossenes Deck auf → 409, nichts an den Kern; Andreas' Spur geht durch
  const n0 = teile().length;
  const auf = { name: 'auf-1', fahrten: [{ ziel: 'deck/1/fader', ab_takt: 1, takte: 4, nach: 0 }] };
  const x = await postJson(url, '/spur', { spur: auf }, CYPHER);
  assert.equal(x.code, 409); assert.equal(x.j.fehler, 'kein_hoerschein'); assert.equal(x.j.pfad, 'deck/1/fader'); assert.equal(teile().length, n0);
  const y = await postJson(url, '/spur', { spur: auf });
  assert.equal(y.code, 200, JSON.stringify(y.j)); assert.equal(teile().at(-1).felder.quelle, 'andreas');
  // Strudel-Kanal (Andreas 2026-09-29): Cypher darf ihn aufziehen
  const erz = await postJson(url, '/spur', { spur: { name: 'auf-2', fahrten: [{ ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: 0 }] } }, CYPHER);
  assert.equal(erz.code, 200, JSON.stringify(erz.j)); assert.equal(teile().at(-1).felder.pfad, 'erz/2/fader');
  assert.notEqual(erz.j.quittung?.status, 6, `Kern lehnt ab: ${JSON.stringify(erz.j.quittung)}`);   // Final-Review F6: auch die Kern-Quittung, nicht nur HTTP 200
  // Form
  assert.equal((await postJson(url, '/spur', { spur: { name: 'X', fahrten: [] } })).code, 400);
  assert.equal((await postJson(url, '/spur', { spur: { ...spur, name: 'b' }, ab: 'jetzt' })).code, 400);
  assert.equal((await postJson(url, '/spur/stopp', { name: '../x' })).code, 400);
});

test('Studio S6 Review: Ablehnung eines Spurteils sichtbar in GET /spur (abgelehnt), Negativ-Kontrolle ohne', async (t) => {
  const { url } = await stapel(t);
  const gut = { name: 'gut', fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 }] };
  const g = await postJson(url, '/spur', { spur: gut }, CYPHER);
  assert.equal(g.code, 200, JSON.stringify(g.j));
  assert.deepEqual((await (await fetch(`${url}/spur`)).json())[0].abgelehnt, []);
  await postJson(url, '/spur/stopp', { name: 'gut' }, CYPHER);
  const schlecht = { name: 'schlecht', fahrten: [
    { ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 },
    { ziel: 'xfader', ab_takt: 1, takte: 1, nach: 0.5 },
  ] };
  const s = await postJson(url, '/spur', { spur: schlecht }, CYPHER);
  assert.equal(s.code, 200, JSON.stringify(s.j));
  const l = (await (await fetch(`${url}/spur`)).json()).find((x) => x.name === 'schlecht');
  assert.deepEqual(l.abgelehnt.map((x) => [x.teil, x.pfad, x.status, x.grund]), [[1, 'xfader', 6, 'nur_hand']], JSON.stringify(l));
});

test('Studio S6 Review: kurze Spur verschwindet nach ihrem Ende im Kern-Beat, nicht nach Wanduhr', async (t) => {
  const { url } = await stapel(t);
  const s = { name: 'kurz', fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 }] };
  assert.equal((await postJson(url, '/spur', { spur: s }, CYPHER)).code, 200);
  assert.equal((await (await fetch(`${url}/spur`)).json()).length, 1);
  let n = 1;
  for (let i = 0; i < 200 && n > 0; i++) { await warte(100); n = (await (await fetch(`${url}/spur`)).json()).length; }
  assert.equal(n, 0, 'Spur nach Ende + 1 Beat aufgeräumt');
});

test('Studio S6 Review: POST /abbruch (cypher) bricht Cyphers Spuren ab, Andreas\' Spur bleibt', async (t) => {
  const { url, log } = await stapel(t);
  const mk = (name) => ({ name, fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 8, nach: -0.6 }] });
  const mk3 = (name) => ({ name, fahrten: [{ ziel: 'erz/3/filter', ab_takt: 1, takte: 8, nach: -0.6 }] });
  assert.equal((await postJson(url, '/spur', { spur: mk('von-cypher') }, CYPHER)).code, 200);
  assert.equal((await postJson(url, '/spur', { spur: mk3('von-andreas') })).code, 200);
  const ab = await postJson(url, '/abbruch', {}, CYPHER);
  assert.equal(ab.code, 200, JSON.stringify(ab.j));
  const plaene = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').map((z) => z.felder.plan);
  assert.ok(plaene.includes('spur:von-cypher'), JSON.stringify(plaene));
  assert.ok(!plaene.includes('spur:von-andreas'), JSON.stringify(plaene));
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name), ['von-andreas']);
});

async function fakeWirt(t, ordner, gruppe, antwort = { ok: true }) {
  const zeilen = [];
  const srv = net.createServer((c) => {
    let d = '';
    c.on('data', (b) => { d += b; if (d.endsWith('\n')) { zeilen.push(JSON.parse(d)); c.end(JSON.stringify(antwort) + '\n'); } });
  });
  await new Promise((ok) => srv.listen(path.join(ordner, `wirt-${gruppe}.sock`), ok));
  t.after(() => srv.close());
  return zeilen;
}

test('Studio S6 T6: Surge-Fahrten gehen mit Startzeit aus der Kern-Uhr an den Wirt, Stopp hält sie an', async (t) => {
  const wo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wirt-'));
  const { o, url } = await stapel(t, [], { wirtOrdner: wo });
  const bass = await fakeWirt(t, wo, 'bass');
  const spur = { name: 'bass-auf', fahrten: [{ ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 2, takte: 4, nach: -15, von: -45 }] };
  const r = await postJson(url, '/spur', { spur }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j)); assert.equal(r.j.wirt, 1);
  const u = o.kern.uhr, f = bass[0];
  assert.deepEqual([f.befehl, f.name, f.bis, f.von, f.spur], ['fahre', 'a_filter1_cutoff', -15, -45, 'bass-auf']);
  assert.ok(Math.abs(f.dauer - 16 * 60 / u.bpm) < 1e-9, `dauer ${f.dauer}`);
  const soll = Number(u.mono_ns) / 1e9 + (r.j.anker_beat + 4 - u.beat) * 60 / u.bpm;   // dieselbe Gerade, spätere Uhr
  assert.ok(Math.abs(f.ab - soll) < 0.005, `ab ${f.ab}, soll ${soll}`);
  assert.ok(f.ab > Number(process.hrtime.bigint()) / 1e9, 'Start liegt in der Zukunft');
  assert.equal((await postJson(url, '/spur/stopp', { name: 'bass-auf' }, CYPHER)).code, 200);
  assert.deepEqual(bass.at(-1), { befehl: 'halte', spur: 'bass-auf' });
  // Wirt fehlt: 409 mit Grund, keine Spur bleibt laufend stehen
  const x = await postJson(url, '/spur', { spur: { name: 'mel', fahrten: [{ ziel: 'wirt:melodie/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0 }] } }, CYPHER);
  assert.equal(x.code, 409); assert.equal(x.j.fehler, 'wirt'); assert.equal(x.j.gruppe, 'melodie');
  assert.deepEqual(await (await fetch(`${url}/spur`)).json(), []);
  // Negativ-Kontrolle: nicht fahrbarer Parameter wird beim Prüfen abgewiesen, der Wirt sieht nichts
  const n = bass.length;
  assert.equal((await postJson(url, '/spur', { spur: { name: 'b2', fahrten: [{ ziel: 'wirt:bass/a_filter1_type', ab_takt: 1, nach: 2 }] } }, CYPHER)).code, 400);
  assert.equal(bass.length, n);
});

test('Studio S6 T7: Muster-Fahrt schreibt den Strom zwei Beats vor ihrer Takt-Eins, als cypher', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { url, log } = await stapel(t, [], { musterOrdner: d });
  const r = await postJson(url, '/spur', { spur: { name: 'still-2', fahrten: [{ ziel: 'strom:2', ab_takt: 2, muster: 'silence' }] } }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j)); assert.equal(r.j.muster, 1);
  let z;
  for (let i = 0; i < 400 && !(z = log.find((x) => x.typ === 'spur_muster')); i++) await warte(20);
  assert.ok(z, 'spur_muster kam nicht');
  assert.equal(z.code, 200, JSON.stringify(z));
  assert.equal(z.ziel_beat, r.j.anker_beat + 4);
  assert.ok(z.beat_vorher >= z.ziel_beat - 2 - 0.1, `zu früh: ${z.beat_vorher}`);
  assert.ok(z.beat_nachher < z.ziel_beat, `geschrieben erst bei ${z.beat_nachher}, Ziel ${z.ziel_beat}`);
  const st = await (await fetch(`${url}/strudel?strom=2`)).json();
  assert.equal(st.text, 'silence'); assert.equal(st.von, 'cypher');
  // Stopp vor dem Zeitpunkt: kein Schreiben
  await postJson(url, '/spur', { spur: { name: 'still-3', fahrten: [{ ziel: 'strom:3', ab_takt: 3, muster: 'silence' }] } }, CYPHER);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'still-3' }, CYPHER)).code, 200);
  await warte(3000);
  assert.equal(log.filter((x) => x.typ === 'spur_muster' && x.name === 'still-3').length, 0);
});

test('Studio S6 Final-Review F1: Stop Cypher bricht Cyphers Spuren ab (Kern, Wirt halte, Muster), Andreas\' Spur bleibt', async (t) => {
  const wo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wirt-'));
  const { o, url, log } = await stapel(t, [], { wirtOrdner: wo });
  const bass = await fakeWirt(t, wo, 'bass');
  const spur = { name: 'sp', fahrten: [
    { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 8, nach: -15, von: -45 },
    { ziel: 'erz/2/filter', ab_takt: 1, takte: 8, nach: -0.6 },
    { ziel: 'strom:2', ab_takt: 3, muster: 'silence' }] };
  const r = await postJson(url, '/spur', { spur }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal((await postJson(url, '/spur', { spur: { name: 'von-andreas', fahrten: [{ ziel: 'erz/3/filter', ab_takt: 1, takte: 8, nach: -0.6 }] } })).code, 200);
  o.kern.sende('/k/ki/stopp', { id: Number(++o.id), quelle: 'andreas' });
  await warte(600);
  assert.deepEqual(bass.filter((z) => z.befehl === 'halte'), [{ befehl: 'halte', spur: 'sp' }, { befehl: 'halte', spur: 'klang-bass' }], JSON.stringify(bass));
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name), ['von-andreas']);
  const plaene = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').map((z) => z.felder.plan);
  assert.ok(plaene.includes('spur:sp') && !plaene.includes('spur:von-andreas'), JSON.stringify(plaene));
  o.kern.sende('/k/ki/frei', { id: Number(++o.id), quelle: 'andreas' });
  await warte(300);
  const ziel = r.j.anker_beat + 8;
  for (let i = 0; i < 1000 && (o.kern.uhr?.beat ?? 0) < ziel + 1; i++) await warte(25);
  assert.equal(log.filter((z) => z.typ === 'spur_muster').length, 0, 'kein Muster nach Freigabe');
});

test('Studio S6 Final-Review F9: /spur/stopp als cypher auf Andreas\' Spur 403 nur_andreas, Negativ-Kontrolle eigene Spur', async (t) => {
  const { url, log } = await stapel(t);
  const mk = (name, z) => ({ name, fahrten: [{ ziel: z, ab_takt: 1, takte: 8, nach: -0.6 }] });
  assert.equal((await postJson(url, '/spur', { spur: mk('a-spur', 'erz/3/filter') })).code, 200);
  assert.equal((await postJson(url, '/spur', { spur: mk('c-spur', 'erz/2/filter') }, CYPHER)).code, 200);
  const n = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').length;
  const x = await postJson(url, '/spur/stopp', { name: 'a-spur' }, CYPHER);
  assert.equal(x.code, 403, JSON.stringify(x.j)); assert.equal(x.j.fehler, 'nur_andreas');
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').length, n, 'nichts an den Kern');
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((s) => s.name).sort(), ['a-spur', 'c-spur']);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'c-spur' }, CYPHER)).code, 200);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'a-spur' })).code, 200, 'Andreas stoppt seine eigene');
});

test('Studio S6 Final-Review F4: AUTO aus hält Cyphers Spuren und /regler auf dem Strom, Andreas nie, andere Ströme frei', async (t) => {
  const wo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wirt-'));
  const { url, log } = await stapel(t, [], { wirtOrdner: wo });
  const bass = await fakeWirt(t, wo, 'bass');
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').length;
  const mk = (name, ziel, extra = {}) => ({ name, fahrten: [{ ziel, ab_takt: 1, takte: 1, nach: -0.6, ...extra }] });
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 2 })).code, 200);
  const n0 = teile();
  for (const [name, f] of [['e2', mk('e2', 'erz/2/filter')], ['w2', mk('w2', 'wirt:bass/a_filter1_cutoff', { von: -45 })],
    ['s2', { name: 's2', fahrten: [{ ziel: 'strom:2', ab_takt: 2, muster: 'silence' }] }]]) {
    const x = await postJson(url, '/spur', { spur: f }, CYPHER);
    assert.equal(x.code, 409, `${name} ${JSON.stringify(x.j)}`); assert.equal(x.j.fehler, 'auto_aus', name);
  }
  assert.equal(teile(), n0, 'nichts an den Kern'); assert.equal(bass.length, 0, 'nichts an den Wirt');
  assert.deepEqual(await (await fetch(`${url}/spur`)).json(), [], 'keine Spur liegt herum');
  const reg = await postJson(url, '/regler', { pfad: 'erz/2/filter', nach: -0.6 }, CYPHER);
  assert.equal(reg.code, 409); assert.equal(reg.j.fehler, 'auto_aus');
  // Negativ-Kontrollen: Andreas darf, Cypher auf Strom 3 darf, Cypher auf Strom 2 nach AUTO an darf
  assert.equal((await postJson(url, '/spur', { spur: mk('a2', 'erz/2/filter') })).code, 200);
  assert.equal((await postJson(url, '/regler', { pfad: 'erz/2/filter', nach: -0.5 })).code, 200);
  const c3 = await postJson(url, '/spur', { spur: mk('c3', 'erz/3/filter') }, CYPHER);
  assert.equal(c3.code, 200, JSON.stringify(c3.j));
  assert.equal((await postJson(url, '/strudel/autonom', { an: true, strom: 2 })).code, 200);
  assert.equal((await postJson(url, '/spur', { spur: mk('e2', 'erz/2/filter') }, CYPHER)).code, 200, 'AUTO wieder an');
});

test('Studio S6 Final-Review F3: POST /spur meldet abgelehnte Teile wie GET /spur, Negativ-Kontrolle leer', async (t) => {
  const { url } = await stapel(t);
  const s = await postJson(url, '/spur', { spur: { name: 'nurx', fahrten: [{ ziel: 'xfader', ab_takt: 1, takte: 1, nach: 0.5 }] } }, CYPHER);
  assert.equal(s.code, 200, JSON.stringify(s.j));
  assert.deepEqual(s.j.abgelehnt.map((x) => [x.teil, x.pfad, x.status, x.grund]), [[0, 'xfader', 6, 'nur_hand']], JSON.stringify(s.j));
  assert.deepEqual(s.j.abgelehnt, (await (await fetch(`${url}/spur`)).json()).find((x) => x.name === 'nurx').abgelehnt);
  const g = await postJson(url, '/spur', { spur: { name: 'gut', fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 }] } }, CYPHER);
  assert.deepEqual(g.j.abgelehnt, []);
});

test('Studio S6 Final-Review F8: der Server loggt spur_wirt_ersetzt, wenn der Wirt wartende Fahrten verworfen hat; sonst nicht', async (t) => {
  const wo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wirt-'));
  const { url, log } = await stapel(t, [], { wirtOrdner: wo });
  await fakeWirt(t, wo, 'bass', { ok: true, ersetzt: 2 });
  await fakeWirt(t, wo, 'melodie');
  const mk = (name, gruppe) => ({ name, fahrten: [{ ziel: `wirt:${gruppe}/a_filter1_cutoff`, ab_takt: 2, takte: 1, nach: -15, von: -45 }] });
  assert.equal((await postJson(url, '/spur', { spur: mk('b', 'bass') }, CYPHER)).code, 200);
  const z = log.filter((x) => x.typ === 'spur_wirt_ersetzt');
  assert.deepEqual(z.map((x) => [x.name, x.gruppe, x.parameter, x.ersetzt]), [['b', 'bass', 'a_filter1_cutoff', 2]], JSON.stringify(z));
  assert.equal((await postJson(url, '/spur', { spur: mk('m', 'melodie') }, CYPHER)).code, 200);
  assert.equal(log.filter((x) => x.typ === 'spur_wirt_ersetzt').length, 1, 'Wirt ohne ersetzt: kein Log');
});

test('Studio S6 Final-Review F5: Tempowechsel nach dem Start verschiebt den Muster-Zeitpunkt nicht (Beat statt Wanduhr)', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { o, url, log } = await stapel(t, [], { musterOrdner: d });
  const r = await postJson(url, '/spur', { spur: { name: 'mt', fahrten: [{ ziel: 'strom:2', ab_takt: 7, muster: 'silence' }] } }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  o.kern.sende('/k/tempo/rampe', { id: Number(++o.id), quelle: 'andreas', ab_beat: o.kern.uhr.beat + 0.5, ziel_bpm: 140, dauer_beats: 1 });
  let z;
  for (let i = 0; i < 1000 && !(z = log.find((x) => x.typ === 'spur_muster')); i++) await warte(20);
  assert.ok(z, 'spur_muster kam nicht');
  assert.equal(z.code, 200, JSON.stringify(z));
  assert.ok(o.kern.uhr.bpm > 135, `Tempo ${o.kern.uhr.bpm}: der Wechsel kam nicht an`);
  assert.equal(z.ziel_beat, r.j.anker_beat + 24);
  assert.ok(z.beat_vorher >= z.ziel_beat - 2 - 0.1, `zu früh: ${z.beat_vorher}`);
  assert.ok(z.beat_nachher < z.ziel_beat, `geschrieben erst bei ${z.beat_nachher}, Ziel ${z.ziel_beat}`);
});

// Final-Review F2: zweiter Seiten-Server mit denselben Optionen (Ordner) nach dem Stopp des ersten
async function neustart(t, o) {
  await o.stoppe();
  const log = [];
  const o2 = new Oberflaeche({ ...o.opt, log: (z) => log.push(z) });
  await o2.starte();
  for (let i = 0; i < 100 && o2.kern.zustand !== 'verbunden'; i++) await warte(20);
  assert.equal(o2.kern.zustand, 'verbunden');
  for (let i = 0; i < 100 && !o2.kern.uhr; i++) await warte(20);
  t.after(() => o2.stoppe());
  return { o2, log };
}

test('Studio S6 Final-Review F2: laufende Spuren überstehen den Neustart des Seiten-Servers (Liste, /spur/stopp, /abbruch, Stop Cypher)', async (t) => {
  const wo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wirt-'));
  const { o, url } = await stapel(t, [], { wirtOrdner: wo });
  const bass = await fakeWirt(t, wo, 'bass');
  const start = async (name, ziel, kopf) => { const r = await postJson(url, '/spur', { spur: { name, fahrten: [{ ziel, ab_takt: 1, takte: 8, nach: ziel.startsWith('wirt') ? -15 : -0.6, ...(ziel.startsWith('wirt') ? { von: -45 } : {}) }] } }, kopf); assert.equal(r.code, 200, JSON.stringify(r.j)); return r.j; };
  await start('lang', 'wirt:bass/a_filter1_cutoff', CYPHER);
  await start('lang2', 'erz/2/filter', CYPHER);
  await start('lang3', 'erz/3/filter', CYPHER);
  await start('mensch', 'erz/1/filter', {});
  assert.ok(fs.existsSync(path.join(wo, 'spuren.json')), 'spuren.json geschrieben');
  const { o2, log } = await neustart(t, o);
  const liste = await (await fetch(`${url}/spur`)).json();
  assert.deepEqual(liste.map((x) => [x.name, x.quelle]).sort(), [['lang', 'cypher'], ['lang2', 'cypher'], ['lang3', 'cypher'], ['mensch', 'andreas']]);
  // Stopp einer Spur nach dem Neustart: /k/abbruch mit ihrem Plan, Wirt halte
  const s = await postJson(url, '/spur/stopp', { name: 'lang' }, CYPHER);
  assert.equal(s.code, 200, JSON.stringify(s.j));
  assert.deepEqual(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').map((z) => z.felder.plan), ['spur:lang']);
  assert.deepEqual(bass.filter((z) => z.befehl === 'halte'), [{ befehl: 'halte', spur: 'lang' }]);
  // Cyphers /abbruch: nur ihre Spuren; Stop Cypher nach dem Neustart genauso
  assert.equal((await postJson(url, '/abbruch', {}, CYPHER)).code, 200);
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name), ['mensch']);
  // eine neue Spur überlebt einen zweiten Neustart nicht, wenn sie vorher gestoppt wurde (Datei folgt jeder Änderung)
  const c = await start('kurz-weg', 'erz/2/filter', CYPHER);
  o2.kern.sende('/k/ki/stopp', { id: Number(++o2.id), quelle: 'andreas' });
  await warte(400);
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name), ['mensch'], 'Stop Cypher nach Neustart');
  const { log: log3 } = await neustart(t, o2);
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name), ['mensch'], `gestoppte Spuren bleiben weg (${JSON.stringify(c)})`);
  assert.equal(log3.length >= 0, true);
});

test('Studio S6 Final-Review F2: abgelaufene Spuren fallen beim Laden weg, Muster-Fahrten werden neu eingeplant', { skip: OHNE_STRUDEL }, async (t) => {
  const wo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wirt-'));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { o, url } = await stapel(t, [], { wirtOrdner: wo, musterOrdner: d });
  const kurz = await postJson(url, '/spur', { spur: { name: 'kurz', fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 }] } }, CYPHER);
  const mus = await postJson(url, '/spur', { spur: { name: 'mus', fahrten: [{ ziel: 'strom:2', ab_takt: 4, muster: 'silence' }] } }, CYPHER);
  assert.equal(kurz.code, 200); assert.equal(mus.code, 200, JSON.stringify(mus.j));
  const { o2, log } = await neustart(t, o);
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name).sort(), ['kurz', 'mus'], 'direkt nach dem Neustart noch beide');
  // 'kurz' endet nach Kern-Beat; danach ist sie weg, 'mus' schreibt ihr Muster im neuen Server
  let z;
  for (let i = 0; i < 1000 && !(z = log.find((x) => x.typ === 'spur_muster')); i++) await warte(25);
  assert.ok(z, 'spur_muster im neuen Server kam nicht');
  assert.equal(z.code, 200, JSON.stringify(z)); assert.equal(z.ziel_beat, mus.j.anker_beat + 12);
  assert.ok(z.beat_nachher < z.ziel_beat, `zu spät: ${z.beat_nachher} vs ${z.ziel_beat}`);
  for (let i = 0; i < 400 && (o2.kern.uhr?.beat ?? 0) < kurz.j.ende_beat + 1.5; i++) await warte(25);
  const namen = (await (await fetch(`${url}/spur`)).json()).map((x) => x.name);
  assert.ok(!namen.includes('kurz'), `abgelaufene Spur noch da: ${namen}`);
  // Datei folgt: ein dritter Server sieht 'kurz' auch nicht mehr
  const dat = JSON.parse(fs.readFileSync(path.join(wo, 'spuren.json'), 'utf8'));
  assert.ok(!JSON.stringify(dat).includes('"kurz"'), 'spuren.json ohne abgelaufene Spur');
});

test('S7 T11: GET /spur liefert die Fahrten der laufenden Spur, auch nach dem Neustart des Seiten-Servers', async (t) => {
  const wo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wirt-'));
  const { o, url } = await stapel(t, [], { wirtOrdner: wo });
  const spur = { name: 'band-2-fader', fahrten: [
    { ziel: 'erz/2/fader', ab_takt: 1, nach: 0 }, { ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: -30, form: 'linear' }] };
  assert.equal((await postJson(url, '/spur', { spur })).code, 200);
  const [s] = await (await fetch(`${url}/spur`)).json();
  assert.deepEqual(s.fahrten, spur.fahrten);
  await neustart(t, o);
  const [s2] = await (await fetch(`${url}/spur`)).json();
  assert.equal(s2.name, 'band-2-fader');
  assert.deepEqual(s2.fahrten, spur.fahrten, 'die Fahrten überstehen den Neustart (spuren.json)');
});

// Plan djk-hand-mcp-studio T1 (Review): /loop rec wartet auf die Kern-Quittung; Status 6 (Tempo ≠ 128, Stop Cypher,
// Überlappung) steht in der Antwort, damit der MCP daraus einen Werkzeugfehler machen kann.
test('/loop rec wartet auf die Kern-Quittung: Status 6 kommt in der Antwort an, Status 2 bleibt Erfolg', async (t) => {
  const { o, log, url } = await stapel(t);
  // Fehlerfall: der Kern lehnt REC ab (Attrappe sendet für /k/loop/rec nichts, die Quittung wird eingespeist)
  const p = postJson(url, '/loop', { aktion: 'rec', beats: 4, name: 'q6' }, CYPHER);
  let id;
  for (let i = 0; i < 100 && id === undefined; i++) { id = log.find((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/rec' && z.felder.name === 'q6')?.felder.id; await warte(10); }
  assert.ok(id !== undefined, 'REC ging an den Kern');
  o.vomKern({ adresse: '/q', felder: { id, status: 6, grund: 'ausserhalb_bereich', quelle: 'cypher' } });
  const r = await p;
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.quittung.status, 6, JSON.stringify(r.j));
  assert.equal(r.j.quittung.grund, 'ausserhalb_bereich');
  assert.equal(r.j.felder.name, 'q6');
  // Negativ-Kontrolle: Quittung 2 (läuft) → Status 2 in der Antwort, kein Fehlerstatus
  const p2 = postJson(url, '/loop', { aktion: 'rec', beats: 4, name: 'q2' }, CYPHER);
  let id2;
  for (let i = 0; i < 100 && id2 === undefined; i++) { id2 = log.find((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/rec' && z.felder.name === 'q2')?.felder.id; await warte(10); }
  o.vomKern({ adresse: '/q', felder: { id: id2, status: 2, grund: '', quelle: 'cypher' } });
  const r2 = await p2;
  assert.equal(r2.j.quittung.status, 2, JSON.stringify(r2.j));
});

test('Plan Tempo-Folge: /loop laden und start warten auf die Kern-Quittung, Status 6 steht in der Antwort', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  schreibeLoop(loops, 'pruef-a', 4);
  const { o, log, url } = await stapel(t, [], { loops });
  const p = postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'pruef-a' });
  let id;
  for (let i = 0; i < 100 && id === undefined; i++) { id = log.find((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/laden')?.felder.id; await warte(10); }
  assert.ok(id !== undefined, 'laden ging an den Kern');
  o.vomKern({ adresse: '/q', felder: { id, status: 6, grund: 'pruefung', quelle: 'andreas' } });
  const r = await p;
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.quittung.status, 6);
  assert.equal(r.j.quittung.grund, 'pruefung');
  // Negativ-Kontrolle: keine Ablehnung → die Antwort kommt trotzdem (nach höchstens 400 ms), ohne Status 6
  const r2 = await postJson(url, '/loop', { aktion: 'start', box: 1 });
  assert.equal(r2.code, 200);
  assert.notEqual(r2.j.quittung?.status, 6);
});

// Plan djk-hand-mcp-studio T1 (Review): loopKit-Riegel für Quelle cypher: Stop Cypher und AUTO Strom 1 aus (der Zusatz-Kit rec
// hängt am Drums-Erzeuger). Andreas' Hand bleibt frei.
test('/loop kit: cypher bei Stop Cypher → 409 ki_gestoppt, bei AUTO Strom 1 aus → 409 auto_aus; andreas und Normalfall frei', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const kits = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kits-'));
  fs.mkdirSync(path.join(kits, 'battery'));
  fs.writeFileSync(path.join(kits, 'battery/kit.json'), JSON.stringify({ schema: 1, name: 'battery',
    klaenge: [{ note: 0, name: 'bd:0', datei: 'bd_0.f32', frames: 1 }] }));
  fs.mkdirSync(path.join(loops, 'c-1'));
  fs.writeFileSync(path.join(loops, 'c-1/loop.f32'), Buffer.alloc(80));
  fs.writeFileSync(path.join(loops, 'c-1/loop.json'), JSON.stringify({ schema: 1, name: 'c-1', takte: 1, frames: 10, datei: 'loop.f32' }));
  const { o, url } = await stapel(t, [], { loops, kits });
  const kit = { aktion: 'kit', name: 'c-1' };
  // Negativ-Kontrolle: alles frei, cypher darf
  assert.equal((await postJson(url, '/loop', kit, CYPHER)).code, 200);
  // Stop Cypher
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1, grund: 'hand', sample: 0 } });
  let r = await postJson(url, '/loop', kit, CYPHER);
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'ki_gestoppt');
  assert.equal((await postJson(url, '/loop', kit)).code, 200, 'andreas ist von Stop Cypher nicht betroffen');
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 0, grund: '', sample: 0 } });
  // AUTO Strom 1 aus
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 1 })).code, 200);
  r = await postJson(url, '/loop', kit, CYPHER);
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'auto_aus');
  assert.equal((await postJson(url, '/loop', kit)).code, 200, 'andreas hält den Strom selbst');
  // AUTO Strom 2 aus berührt den Drums-Kit nicht
  assert.equal((await postJson(url, '/strudel/autonom', { an: true, strom: 1 })).code, 200);
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 2 })).code, 200);
  assert.equal((await postJson(url, '/loop', kit, CYPHER)).code, 200);
});

test('GET /pegel: ungedrosselter Puffer liefert Spitze und Median je Kanal, sek außerhalb 1..10 ist 400', async (t) => {
  const { o, url } = await stapel(t);
  // 10 Ereignisse in Folge (weit über der 10-Hz-Drossel der SSE): die Spitze -7,5 darf nicht verloren gehen
  for (const db of [-20, -20, -7.5, -20, -20, -20, -20, -20, -20, -20]) o.vomKern({ adresse: '/pegel', felder: { kanal: 'master', spitze_db: db, lufs_s: -200 } });
  o.vomKern({ adresse: '/pegel', felder: { kanal: 'cue', spitze_db: -200, lufs_s: -200 } });
  const r = await fetch(`${url}/pegel?sek=2`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.sek, 2);
  assert.equal(j.kanaele.master.max_db, -7.5); assert.equal(j.kanaele.master.n, 10);
  assert.equal(j.kanaele.master.median_db, -20);
  assert.equal(j.kanaele.cue.max_db, -200); assert.equal(j.kanaele.cue.median_db, null);
  assert.equal('lufs_s' in j.kanaele.master, false, 'lufs_s wird nicht ausgegeben (Kern liefert immer -200)');
  // Vorgabe 3 s (Negativ-Kontrolle: ohne Parameter kein Fehler)
  assert.equal((await (await fetch(`${url}/pegel`)).json()).sek, 3);
  for (const schlecht of ['0', '11', 'x', '1.5']) {
    const f = await fetch(`${url}/pegel?sek=${schlecht}`);
    assert.equal(f.status, 400, schlecht); assert.equal((await f.json()).fehler, 'sek');
  }
});

// Task 3 (djk-hand-Nachrüstung): POST/GET /klang. JEDER Test hier läuft über ein Stub-Skript (opt.klangBefehl), nie über den
// echten djk-klang: der träfe den laufenden Surge unter /dev/shm/cypherdj/wirt-*.sock.
function klangStub() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-klangstub-'));
  const f = path.join(d, 'stub');
  fs.writeFileSync(f, `#!${process.execPath}
const a = process.argv.slice(2);
if (a.includes('kaputt')) { process.stderr.write('djk-klang: irgendwas\\nerror: x\\n\\n'); process.exit(1); }
if (a.includes('gross')) { process.stdout.write('x'.repeat(100000)); process.exit(0); }
process.stdout.write(JSON.stringify(a));
`);
  fs.chmodSync(f, 0o755);
  return f;
}
async function klangStapel(t, extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const wo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wirt-'));
  const s = await stapel(t, [], { musterOrdner: d, wirtOrdner: wo, klangBefehl: klangStub(), ...extra });
  return { ...s, d, wo };
}

test('T3 /klang: AUTO des Stroms aus sperrt Cypher (409 auto_aus), Andreas nicht; zeige und liste sind frei', async (t) => {
  const { url } = await klangStapel(t);
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 2 })).code, 200);
  const r = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'lade', name: 'x' }, CYPHER);
  assert.equal(r.code, 409, JSON.stringify(r.j)); assert.equal(r.j.fehler, 'auto_aus');
  assert.match(r.j.text, /AUTO is off/);
  // Negativ-Kontrolle: Andreas (ohne Kopf) ist nicht gesperrt; Melodie (Strom 3, AUTO an) auch nicht
  const a = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'lade', name: 'x' });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal((await postJson(url, '/klang', { gruppe: 'melodie', aktion: 'lade', name: 'x' }, CYPHER)).code, 200);
  // lesend: frei trotz AUTO aus
  assert.equal((await postJson(url, '/klang', { gruppe: 'bass', aktion: 'zeige' }, CYPHER)).code, 200);
  assert.equal((await postJson(url, '/klang', { aktion: 'liste', filter: 'Lead' }, CYPHER)).code, 200);
});

test('T3 /klang: fremde Herkunft und falscher content-type wie bei /strudel (403, 415)', async (t) => {
  const { url } = await klangStapel(t);
  const f = await fetch(`${url}/klang`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://boese.example' }, body: JSON.stringify({ gruppe: 'bass', aktion: 'zeige' }) });
  assert.equal(f.status, 403);
  const g = await fetch(`${url}/klang`, { method: 'POST', body: JSON.stringify({ gruppe: 'bass', aktion: 'zeige' }) });
  assert.equal(g.status, 415);
});

test('T3 /klang: unbekannte Gruppe oder Aktion, setze mit Nicht-Zahl, Name außerhalb der Regel, Wert mit - vorne → 400', async (t) => {
  const { url } = await klangStapel(t);
  const p = (d) => postJson(url, '/klang', d, CYPHER);
  assert.equal((await p({ gruppe: 'drums', aktion: 'zeige' })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'loesche' })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'setze', werte: { a_x: 'laut' } })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'setze', werte: {} })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'speichere', name: 'Gross Name!' })).code, 400);
  for (const d of [{ aktion: 'lade', name: '--instanz' }, { aktion: 'zeige', filter: '-h' }, { aktion: 'setze', werte: { '-x': 1 } }, { aktion: 'fahre', parameter: '-h', ziel: 0, sekunden: 1 }]) {
    const r = await p({ gruppe: 'bass', ...d });
    assert.equal(r.code, 400, JSON.stringify(d)); assert.equal(r.j.fehler, 'argument', JSON.stringify(d));
  }
  const l = await p({ aktion: 'liste', filter: '-h' });
  assert.equal(l.code, 400); assert.equal(l.j.fehler, 'argument');
});

test('T3 /klang: argv geht ohne Shell durch, ein Name mit Leerzeichen bleibt EIN Element; Instanz vorne; liste ohne Gruppe', async (t) => {
  const { url } = await klangStapel(t);
  const p = (d) => postJson(url, '/klang', d, CYPHER);
  const lade = await p({ gruppe: 'bass', aktion: 'lade', name: 'Chords/Minor Chord Retro Stab' });
  assert.equal(lade.code, 200, JSON.stringify(lade.j)); assert.equal(lade.j.ok, true);
  assert.deepEqual(JSON.parse(lade.j.text).slice(-3), ['bass', 'lade', 'Chords/Minor Chord Retro Stab']);
  const setze = JSON.parse((await p({ gruppe: 'melodie', aktion: 'setze', werte: { a_filter1_type: 2, b_x: -3.5 } })).j.text);
  assert.deepEqual(setze.slice(-4), ['melodie', 'setze', 'a_filter1_type=2', 'b_x=-3.5'], JSON.stringify(setze));
  const liste = JSON.parse((await p({ aktion: 'liste', filter: 'Leads/Acid' })).j.text);
  assert.deepEqual(liste.slice(-2), ['liste', 'Leads/Acid']); assert.ok(!liste.includes('bass') && !liste.includes('melodie'), JSON.stringify(liste));
  const hoere = JSON.parse((await p({ gruppe: 'bass', aktion: 'hoere', note: 40, dauer: 2 })).j.text);
  assert.deepEqual(hoere.slice(-4), ['bass', 'hoere', '40', '2']);
  const zeige = JSON.parse((await p({ gruppe: 'bass', aktion: 'zeige', filter: 'cutoff' })).j.text);
  assert.deepEqual(zeige.slice(-3), ['bass', 'zeige', 'cutoff']);
  const sp = JSON.parse((await p({ gruppe: 'bass', aktion: 'speichere', name: 'mein-bass_1' })).j.text);
  assert.deepEqual(sp.slice(-3), ['bass', 'speichere', 'mein-bass_1']);
});

test('T3 /klang: Exit 1 → 400 mit letzter nicht-leerer stderr-Zeile; Ausgabe über 32 KB wird gekappt (abgeschnitten)', async (t) => {
  const { url } = await klangStapel(t);
  const k = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'lade', name: 'kaputt' }, CYPHER);
  assert.equal(k.code, 400, JSON.stringify(k.j)); assert.equal(k.j.fehler, 'error: x');
  const g = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'lade', name: 'gross' }, CYPHER);
  assert.equal(g.code, 200); assert.equal(g.j.abgeschnitten, true); assert.ok(g.j.text.length <= 32768, String(g.j.text.length));
  // Negativ-Kontrolle: kleine Ausgabe trägt kein abgeschnitten
  const n = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'lade', name: 'x' }, CYPHER);
  assert.ok(!n.j.abgeschnitten);
});

test('T3 /klang fahre: geht als Wirt-Befehl an den Socket (spur klang-<gruppe>, linear), Parameter gegen fahrbar, AUTO-Riegel', async (t) => {
  const { url, wo } = await klangStapel(t);
  const bass = await fakeWirt(t, wo, 'bass');
  const p = (d) => postJson(url, '/klang', d, CYPHER);
  const r = await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: -12, sekunden: 15, von: -40 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(bass.at(-1), { befehl: 'fahre', name: 'volume', bis: -12, dauer: 15, spur: 'klang-bass', form: 'linear', von: -40 });
  await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: 0, sekunden: 2 });
  assert.deepEqual(bass.at(-1), { befehl: 'fahre', name: 'volume', bis: 0, dauer: 2, spur: 'klang-bass', form: 'linear' });   // ohne von, ohne ab
  const n = bass.length;
  const nf = await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'a_filter1_type', ziel: 1, sekunden: 2 });
  assert.equal(nf.code, 400); assert.equal(nf.j.fehler, 'nicht_fahrbar');
  assert.equal((await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: 'x', sekunden: 2 })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: 0, sekunden: 601 })).code, 400);
  assert.equal(bass.length, n, 'abgewiesenes erreicht den Wirt nicht');
  // Wirt fehlt: 409 wirt (melodie hat keinen Socket)
  const m = await p({ gruppe: 'melodie', aktion: 'fahre', parameter: 'volume', ziel: 0, sekunden: 2 });
  assert.equal(m.code, 409); assert.equal(m.j.fehler, 'wirt');
  // AUTO aus → 409, Andreas frei
  await postJson(url, '/strudel/autonom', { an: false, strom: 2 });
  assert.equal((await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: 0, sekunden: 2 })).j.fehler, 'auto_aus');
  assert.equal((await postJson(url, '/klang', { gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: 0, sekunden: 2 })).code, 200);
});

test('T3 /abbruch als cypher und Stop Cypher schicken halte klang-bass / klang-melodie an die Wirte', async (t) => {
  const { o, url, wo } = await klangStapel(t);
  const bass = await fakeWirt(t, wo, 'bass');
  const mel = await fakeWirt(t, wo, 'melodie');
  assert.equal((await postJson(url, '/abbruch', {}, CYPHER)).code, 200);
  assert.deepEqual(bass.filter((z) => z.befehl === 'halte'), [{ befehl: 'halte', spur: 'klang-bass' }]);
  assert.deepEqual(mel.filter((z) => z.befehl === 'halte'), [{ befehl: 'halte', spur: 'klang-melodie' }]);
  o.kern.sende('/k/ki/stopp', { id: Number(++o.id), quelle: 'andreas' });
  for (let i = 0; i < 200 && bass.filter((z) => z.befehl === 'halte').length < 2; i++) await warte(20);
  assert.equal(bass.filter((z) => z.befehl === 'halte' && z.spur === 'klang-bass').length, 2, JSON.stringify(bass));
  // Negativ-Kontrolle: Andreas' /abbruch ist 403 und hält nichts
  const n = bass.length;
  assert.equal((await postJson(url, '/abbruch', {})).code, 403);
  assert.equal(bass.length, n);
});

test('T3 GET /klang: liest wirt-<gruppe>.json aus dem Wirt-Ordner, fehlende Datei → null', async (t) => {
  const { url, wo } = await klangStapel(t);
  fs.writeFileSync(path.join(wo, 'wirt-bass.json'), JSON.stringify({ klang: 'Leads/X', pid: 1 }));
  const r = await (await fetch(`${url}/klang`)).json();
  assert.deepEqual(r, { bass: { klang: 'Leads/X', pid: 1 }, melodie: null });
});

// Task 4 (djk-hand-Nachrüstung): /lage trägt den Studio-Zustand (AUTO/Muster je Strom, geladener Surge-Klang).
test('T4 /lage.studio: 3 Ströme mit autonom/von/text_kurz (200 Zeichen), klang aus wirt-<g>.json, alte Schlüssel bleiben', { skip: OHNE_STRUDEL }, async (t) => {
  const { url, wo } = await klangStapel(t);
  const l0 = await (await fetch(`${url}/lage`)).json();
  for (const k of ['uhr', 'ki', 'decks', 'regler', 'boxen', 'fx', 'fx_routing', 'quittungen']) assert.ok(k in l0, `alter Schlüssel ${k}`);
  assert.equal(l0.studio.stroeme.length, 3);
  assert.deepEqual(l0.studio.stroeme.map((s) => s.strom), [1, 2, 3]);
  assert.ok(l0.studio.stroeme.every((s) => s.autonom === true && s.text_kurz === '' && s.von === null));
  assert.deepEqual(l0.studio.klang, { bass: null, melodie: null }, 'ohne Wirt-Datei null');
  // Fehlerfall/Wirkung: AUTO von Strom 2 aus, langes Muster in Strom 3, Klang im Bass
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 2 })).code, 200);
  const lang = 's("bd*4")' + ' // ' + 'x'.repeat(300);
  assert.equal((await postJson(url, '/strudel', { text: lang, strom: 3 })).code, 200);
  fs.writeFileSync(path.join(wo, 'wirt-bass.json'), JSON.stringify({ klang: 'Leads/X (edited)', pid: 1 }));
  const l = await (await fetch(`${url}/lage`)).json();
  assert.equal(l.studio.stroeme[1].autonom, false);
  assert.equal(l.studio.stroeme[0].autonom, true, 'Negativ-Kontrolle: Strom 1 unberührt');
  assert.equal(l.studio.stroeme[2].text_kurz, lang.slice(0, 200));
  assert.equal(l.studio.stroeme[2].von, 'andreas');
  assert.deepEqual(l.studio.klang, { bass: 'Leads/X (edited)', melodie: null });
});

test('Riegel 2026-09-30: /griff /taste /laden /loop ohne json 415, fremde Herkunft 403, nichts an den Kern', async (t) => {
  const { url, log } = await geladenesDeck(t);
  const vorher = log.filter((l) => l.typ === 'an_kern').length;
  const faelle = [['/griff', { pfad: 'deck/1/fader', u: 0.5 }], ['/taste', { name: 'play/1' }], ['/laden', { deck: 1, material_id: 'x' }],
    ['/loop', { aktion: 'stopp', box: 1 }]];
  for (const [p, d] of faelle) {
    const r = await post(url, p, d);
    assert.equal(r.code, 415, p); assert.equal(r.j.fehler, 'nur_json', p);
    const f = await postJson(url, p, d, { origin: 'https://boese.example' });
    assert.equal(f.code, 403, p); assert.equal(f.j.fehler, 'fremde_herkunft', p);
  }
  assert.equal(log.filter((l) => l.typ === 'an_kern').length, vorher, 'Abweisungen senden nichts an den Kern');
  // Negativ-Kontrolle: mit json und eigener Herkunft kommt die Anfrage an (Griff auf ein gültiges Ziel)
  const g = await postJson(url, '/griff', { pfad: 'deck/1/fader', u: 0.5 }, { origin: url });
  assert.notEqual(g.code, 415); assert.notEqual(g.code, 403);
});

test('Riegel 2026-09-30: Stop Cypher überlebt einen Server-Neustart über /zustand/kern (ki_gestoppt)', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const fx1 = { einheit: 1, art: 1, beats: 1, wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5, an: true };
  // frischer Server: nie ein /e/ki gesehen, der Kern meldet aber periodisch ki_gestoppt 1
  o.vomKern({ adresse: '/zustand/kern', felder: { generation: 1, ki_gestoppt: 1 } });
  assert.equal((await postJson(url, '/fx', fx1, CYPHER)).j.fehler, 'ki_gestoppt');
  assert.equal((await (await fetch(`${url}/lage`)).json()).ki.gestoppt, true);
  // Freigabe kommt ebenfalls über den Zustand an
  o.vomKern({ adresse: '/zustand/kern', felder: { generation: 1, ki_gestoppt: 0 } });
  assert.equal((await postJson(url, '/fx', fx1, CYPHER)).code, 200);
});

test('Welle 3 (ADR 028): POST /tempo bei laufendem Deck nimmt der Kern an (bis Welle 2 Quittung 6 kein_stretcher)', async (t) => {
  const { o, url } = await geladenesDeck(t);
  assert.equal((await postJson(url, '/deck/start', { deck: 1 })).code, 200);
  for (let i = 0; i < 100 && !(Number(o.stand.decks['1']?.status) >= 2); i++) await warte(20);
  assert.ok(Number(o.stand.decks['1']?.status) >= 2, `Deck 1 läuft (status=${o.stand.decks['1']?.status})`);
  const r = await postJson(url, '/tempo', { bpm: 132 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.ok([1, 2].includes(r.j.quittung?.status), `angenommen oder laufend, nicht 6: ${JSON.stringify(r.j.quittung)}`);
});

test('Keylock 3 (Fassung 4): EIN Knopf keylock für alle Quellen: POST /regler keylock 0 → 200, /k/teil, /lage zeigt ihn; Render-und-Tausch ist aus (kein /k/deck/basis_tausch bei Tempo 132)', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  assert.equal((await postJson(url, '/deck/start', { deck: 1 })).code, 200);
  for (let i = 0; i < 100 && !(Number(o.stand.decks['1']?.status) >= 2); i++) await warte(20);
  // 3b: /lage zeigt den Knopf immer (der Kern, hier die Attrappe, meldet ihn dem neuen Abonnenten beim ersten /k/hallo: 1),
  // kein Feld keylock je Deck mehr
  for (let i = 0; i < 100 && o.stand.regler.keylock === undefined; i++) await warte(20);
  let lage = await (await fetch(url + '/lage')).json();
  assert.equal(lage.regler.keylock, 1, JSON.stringify(lage.regler));
  assert.equal('keylock' in lage.decks[0], false, JSON.stringify(lage.decks[0]));
  assert.equal(lage.decks[0].hoerweg, 0, JSON.stringify(lage.decks[0]));   // 3b: Hörweg aus /zustand/deck (Attrappe: 0)
  const r = await postJson(url, '/regler', { pfad: 'keylock', nach: 0, ab: 'jetzt' }, CYPHER);   // Quelle cypher darf
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.felder.pfad, 'keylock'); assert.equal(r.j.felder.quelle, 'cypher'); assert.equal(r.j.felder.dauer_beats, 0);
  assert.equal(r.j.felder.politik, 1);   // 3b: zu spät heißt sofort, nicht verworfen
  assert.ok([1, 2, 3].includes(r.j.quittung?.status), JSON.stringify(r.j.quittung));
  for (let i = 0; i < 200 && o.stand.regler.keylock !== 0; i++) await warte(20);
  assert.equal(o.stand.regler.keylock, 0);
  lage = await (await fetch(url + '/lage')).json();
  assert.equal(lage.regler.keylock, 0, JSON.stringify(lage.regler));
  // kein Deck-Pfad
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/1/keylock', nach: 0 }, CYPHER)).code, 400);
  // Render-und-Tausch (Welle 3 Task 6) ist ausgebaut: Tempo 132 bei laufendem Deck schickt keinen Tausch, rendert nichts
  const tp = await postJson(url, '/tempo', { bpm: 132 });
  assert.ok([1, 2].includes(tp.j.quittung?.status), JSON.stringify(tp.j));
  await warte(1500);
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/basis_tausch').length, 0);
  assert.equal(log.filter((z) => String(z.typ).startsWith('keylock')).length, 0, JSON.stringify(log.filter((z) => String(z.typ).startsWith('keylock'))));
  // wieder an
  assert.equal((await postJson(url, '/regler', { pfad: 'keylock', nach: 1, ab: 'jetzt' })).code, 200);
  for (let i = 0; i < 200 && o.stand.regler.keylock !== 1; i++) await warte(20);
  lage = await (await fetch(url + '/lage')).json();
  assert.equal(lage.regler.keylock, 1, JSON.stringify(lage.regler));
  // unbekannt (kein /e/regler keylock gesehen): ausdrücklich null, nicht stillschweigend an
  delete o.stand.regler.keylock;
  lage = await (await fetch(url + '/lage')).json();
  assert.equal(lage.regler.keylock, null, JSON.stringify(lage.regler));
});

test('Plan Tempo-Folge: POST /tempo schickt /k/tempo/rampe über einen Takt ab der nächsten Eins; cypher darf, bei Stop Cypher 409 ki_gestoppt; falsche Werte 400', async (t) => {
  const { o, log, url } = await stapel(t);
  const vorher = o.gesendet;
  for (const body of [{ bpm: 59.99 }, { bpm: 200.01 }, { bpm: 'schnell' }, {}]) {
    assert.equal((await postJson(url, '/tempo', body)).code, 400, JSON.stringify(body));
  }
  o.vomKern({ adresse: '/zustand/kern', felder: { generation: 1, ki_gestoppt: 1 } });
  const c = await postJson(url, '/tempo', { bpm: 130 }, CYPHER);
  assert.equal(c.code, 409);
  assert.equal(c.j.fehler, 'ki_gestoppt');
  assert.equal(o.gesendet, vorher, 'Abgelehntes geht nicht an den Kern');
  o.vomKern({ adresse: '/zustand/kern', felder: { generation: 1, ki_gestoppt: 0 } });
  const cy = await postJson(url, '/tempo', { bpm: 131 }, CYPHER);
  assert.equal(cy.code, 200, JSON.stringify(cy.j));
  const anC = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/tempo/rampe').map((z) => z.felder);
  assert.equal(anC.length, 1);
  assert.equal(anC[0].quelle, 'cypher');
  assert.equal(anC[0].ziel_bpm, 131);
  const r = await postJson(url, '/tempo', { bpm: 130.456 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const an = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/tempo/rampe').map((z) => z.felder);
  assert.equal(an.length, 2);
  an.shift();
  assert.equal(an[0].quelle, 'andreas');
  assert.equal(an[0].ziel_bpm, 130.46, 'auf 0,01 BPM gerundet');
  assert.equal(an[0].dauer_beats, 4);
  assert.equal(an[0].ab_beat % 4, 0, 'ab der nächsten Takt-Eins');
  assert.notEqual(r.j.quittung?.status, 6);
});

// Paket 2 Slice 5 (F07): Loop-Boxen und FX nach einem Kern-Neustart wiederherstellen. Der Neustart-Zustand des Kerns trägt
// keine Boxen und keine FX-Einheiten; der Server merkt sie vor dem Leeren und schickt sie 500 ms nach /e/neustart erneut.
async function boxAn(o, url, loops, box, name, kopf, { status = 3, raster } = {}) {
  if (!fs.existsSync(path.join(loops, name))) schreibeLoop(loops, name, 4);
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box, name }, kopf)).code, 200);
  o.vomKern({ adresse: '/e/loop', felder: { box, status, name, beats: 4 } });
  if (raster !== undefined) assert.equal((await postJson(url, '/loop', { aktion: 'raster', box, versatz_frames: raster })).code, 200);
}
const kernBefehle = (log, ab = 0) => log.filter((z) => z.typ === 'an_kern' && /^\/k\/(loop|fx)/.test(z.adresse)).slice(ab);
async function nachNeustart(o, log, generation, vorher, erwartet) {
  o.vomKern({ adresse: '/e/neustart', felder: { generation, sample: 0 } });
  await warte(erwartet === 0 ? 900 : 600);
  for (let i = 0; i < 100 && kernBefehle(log, vorher).length < erwartet; i++) await warte(20);
  await warte(100);
  return kernBefehle(log, vorher);
}

test('Slice 5 F07: laufende Box kommt mit Name, Besitzer, Live-Raster und start zurück; bereite/endende ohne start, leere gar nicht', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log, url } = await stapel(t, [], { loops });
  await boxAn(o, url, loops, 1, 'pruef-a', CYPHER, { status: 3 });
  await boxAn(o, url, loops, 2, 'pruef-b', {}, { status: 1, raster: 96 });   // Raster nur von Andreas; Box bereit
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 3, name: 'pruef-a', beats: 4 } });
  assert.equal((await postJson(url, '/loop', { aktion: 'raster', box: 1, versatz_frames: -480 })).code, 200);
  const n0 = kernBefehle(log).length;
  const b = await nachNeustart(o, log, 21, n0, 5);
  const form = (z) => `${z.adresse}|b${z.felder.box}|${z.felder.quelle}${z.felder.name ? '|' + z.felder.name : ''}${z.felder.versatz_frames !== undefined ? '|' + z.felder.versatz_frames : ''}`;
  assert.deepEqual(b.map(form), [
    '/k/loop/laden|b1|cypher|pruef-a', '/k/loop/raster|b1|andreas|-480', '/k/loop/start|b1|cypher',
    '/k/loop/laden|b2|andreas|pruef-b', '/k/loop/raster|b2|andreas|96']);
  assert.deepEqual(o.loopRasterLive['1'], { name: 'pruef-a', v: -480 }, 'Live-Versatz wieder gefüllt (B15)');
  assert.deepEqual(o.loopRasterLive['2'], { name: 'pruef-b', v: 96 });
  // endet (4): laden, kein start; leere Box (0): nichts. Zweiter Neustart erst nach Ablauf der Sperre (Uhr zurückgestellt)
  o.letzteBoxFxWieder = 0;
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 4, name: 'pruef-a', beats: 4 } });
  o.vomKern({ adresse: '/e/loop', felder: { box: 2, status: 0, name: '', beats: 0 } });
  const n1 = kernBefehle(log).length;
  const c = await nachNeustart(o, log, 22, n1, 2);
  assert.deepEqual(c.map(form), ['/k/loop/laden|b1|cypher|pruef-a', '/k/loop/raster|b1|andreas|-480']);
  // Negativ-Kontrolle: alles leer, nichts zu senden
  o.letzteBoxFxWieder = 0;
  for (const bx of [1, 2]) o.vomKern({ adresse: '/e/loop', felder: { box: bx, status: 0, name: '', beats: 0 } });
  const n2 = kernBefehle(log).length;
  assert.deepEqual(await nachNeustart(o, log, 23, n2, 0), []);
});

test('Slice 5 F07 B12: bei Stop Cypher kommen Cyphers Boxen und FX nicht zurück, Andreas\' schon', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { o, log, url } = await stapel(t, [], { loops, musterOrdner: d });
  await boxAn(o, url, loops, 1, 'pruef-a', CYPHER);
  await boxAn(o, url, loops, 2, 'pruef-b', {});
  fs.writeFileSync(path.join(d, 'fx_von.json'), JSON.stringify({ '1': { von: 'cypher', zeit: 1 }, '2': { von: 'andreas', zeit: 1 } }));
  o.vomKern({ adresse: '/e/fx', felder: { einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 } });
  o.vomKern({ adresse: '/e/fx', felder: { einheit: 2, art: 1, beats: 0.5, wet: 0.7, param1: 0.2, param2: 0.5, param3: 0.5, an: 1 } });
  o.kern.sende('/k/ki/stopp', { id: Number(++o.id), quelle: 'andreas' });   // echter Stopp: die Attrappe meldet ki_gestoppt auch in /zustand/kern
  for (let i = 0; i < 100 && !o.kiGestoppt; i++) await warte(20);
  assert.equal(o.kiGestoppt, true);
  const n0 = kernBefehle(log).length;
  const b = await nachNeustart(o, log, 31, n0, 3);
  assert.deepEqual(b.map((z) => [z.adresse, z.felder.box ?? z.felder.einheit, z.felder.quelle]),
    [['/k/loop/laden', 2, 'andreas'], ['/k/loop/start', 2, 'andreas'], ['/k/fx', 2, 'andreas']]);
});

test('Slice 5 F07 B13: höchstens eine Wiederherstellung je 30 s, die zweite wird gemeldet', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log, url } = await stapel(t, [], { loops });
  await boxAn(o, url, loops, 1, 'pruef-a', {});
  const n0 = kernBefehle(log).length;
  assert.equal((await nachNeustart(o, log, 41, n0, 2)).length, 2, 'erste Wiederherstellung: laden + start');
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 3, name: 'pruef-a', beats: 4 } });   // der Kern meldet die Box wieder
  const n1 = kernBefehle(log).length;
  assert.deepEqual(await nachNeustart(o, log, 42, n1, 0), [], 'zweiter Neustart innerhalb von 30 s: nichts');
  assert.ok(log.some((z) => z.typ === 'wiederherstellung_uebersprungen' && z.grund === 'zu_schnell'), JSON.stringify(log.slice(-5)));
});

test('Slice 5 F07: FX-Einheiten und Zuweisungen kommen mit Werten und Besitzer zurück, fx_von.json bleibt', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { o, log } = await stapel(t, [], { musterOrdner: d });
  const von = JSON.stringify({ '1': { von: 'cypher', zeit: 1 }, '2': { von: 'andreas', zeit: 2 } });
  fs.writeFileSync(path.join(d, 'fx_von.json'), von);
  o.vomKern({ adresse: '/e/fx', felder: { einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 } });
  o.vomKern({ adresse: '/e/fx', felder: { einheit: 2, art: 3, beats: 4, wet: 0.3, param1: 0.1, param2: 0.2, param3: 0.9, an: 0 } });   // aus, ohne Zuweisung: nichts
  o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/1', an: 1 } });
  o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'master', an: 1 } });
  o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/2', an: 0 } });
  const n0 = kernBefehle(log).length;
  const b = await nachNeustart(o, log, 51, n0, 3);
  assert.deepEqual(b.map((z) => ({ ...z.felder, id: 0 })), [
    { id: 0, quelle: 'cypher', einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 },
    { id: 0, quelle: 'cypher', einheit: 1, kanal: 'deck/1', an: 1 },
    { id: 0, quelle: 'cypher', einheit: 1, kanal: 'master', an: 1 }]);
  assert.equal(fs.readFileSync(path.join(d, 'fx_von.json'), 'utf8'), von, 'fx_von.json unverändert (Besitzer bleibt)');
});

// Slice 5 Review-Nacharbeit (F1 bis F7)
const formS5 = (z) => `${z.adresse}|${z.felder.box !== undefined ? 'b' + z.felder.box : 'e' + z.felder.einheit}|${z.felder.quelle}${z.felder.name ? '|' + z.felder.name : ''}`;
async function stoppCypherS5(o) {
  o.kern.sende('/k/ki/stopp', { id: Number(++o.id), quelle: 'andreas' });
  for (let i = 0; i < 100 && !o.kiGestoppt; i++) await warte(20);
  assert.equal(o.kiGestoppt, true);
}

test('Slice 5 Review F1: der Besitzer wechselt erst mit bestätigter Ladung, nicht beim Versuch', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  // (a) Andreas' Box, Cyphers Versuch scheitert mit 400: die Box bleibt Andreas', auch bei Stop Cypher
  const s1 = await stapel(t, [], { loops });
  await boxAn(s1.o, s1.url, loops, 1, 'pruef-a', {});
  assert.equal((await postJson(s1.url, '/loop', { aktion: 'laden', box: 1, name: 'gibtsnicht' }, CYPHER)).code, 400);
  await stoppCypherS5(s1.o);
  const a = await nachNeustart(s1.o, s1.log, 71, kernBefehle(s1.log).length, 2);
  assert.deepEqual(a.map(formS5), ['/k/loop/laden|b1|andreas|pruef-a', '/k/loop/start|b1|andreas']);
});
test('Slice 5 Review F1: Andreas\' 400 auf Cyphers Box macht sie nicht zu seiner (bei Stop Cypher bleibt sie weg)', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log, url } = await stapel(t, [], { loops });
  await boxAn(o, url, loops, 1, 'pruef-a', CYPHER);
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'gibtsnicht' }, {})).code, 400);
  await stoppCypherS5(o);
  assert.deepEqual(await nachNeustart(o, log, 72, kernBefehle(log).length, 0), []);
});
test('Slice 5 Review F1: Cyphers vom Kern abgelehnte Ladung (Stop Cypher) auf Andreas\' Box ändert den Besitzer nicht', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log, url } = await stapel(t, [], { loops });
  await boxAn(o, url, loops, 1, 'pruef-a', {});
  schreibeLoop(loops, 'pruef-c', 4);
  await stoppCypherS5(o);
  await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'pruef-c' }, CYPHER);   // der Kern lehnt ab, kein /e/loop mit pruef-c
  assert.deepEqual((await nachNeustart(o, log, 73, kernBefehle(log).length, 2)).map(formS5), ['/k/loop/laden|b1|andreas|pruef-a', '/k/loop/start|b1|andreas']);
});

test('Slice 5 Review F2: unbekannter Besitzer gilt als cypher (bei Stop Cypher nichts, sonst Quelle cypher)', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log } = await stapel(t, [], { loops });
  schreibeLoop(loops, 'pruef-a', 4);
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 1, name: 'pruef-a', beats: 4 } });   // geladen am Server vorbei (djk-loop)
  const b = await nachNeustart(o, log, 81, kernBefehle(log).length, 1);
  assert.deepEqual(b.map(formS5), ['/k/loop/laden|b1|cypher|pruef-a']);
  o.letzteBoxFxWieder = 0;
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 1, name: 'pruef-a', beats: 4 } });
  await stoppCypherS5(o);
  assert.deepEqual(await nachNeustart(o, log, 82, kernBefehle(log).length, 0), []);
});

test('Slice 5 Review F3: was in den 500 ms neu geladen oder gesetzt wird, bleibt von der Wiederherstellung unberührt', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { o, log, url } = await stapel(t, [], { loops, musterOrdner: d });
  await boxAn(o, url, loops, 1, 'pruef-a', {});
  await boxAn(o, url, loops, 2, 'pruef-b', {});
  schreibeLoop(loops, 'pruef-neu', 4);
  fs.writeFileSync(path.join(d, 'fx_von.json'), JSON.stringify({ '1': { von: 'andreas', zeit: 1 }, '2': { von: 'andreas', zeit: 1 } }));
  const fx = (e) => ({ einheit: e, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 });
  o.vomKern({ adresse: '/e/fx', felder: fx(1) });
  o.vomKern({ adresse: '/e/fx', felder: fx(2) });
  const n0 = kernBefehle(log).length;
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 91, sample: 0 } });
  await warte(100);
  const antworten = await Promise.all([postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'pruef-neu' }, {}), postJson(url, '/loop', { aktion: 'stopp', box: 2 }, {}),
    postJson(url, '/fx', { ...fx(1), an: false })]);   // gleichzeitig: alle drei treffen das 500-ms-Fenster
  assert.deepEqual(antworten.map((x) => x.code), [200, 200, 200]);
  await warte(900);
  const b = kernBefehle(log, n0).map(formS5);
  assert.deepEqual(b.filter((x) => /\|b1\|/.test(x) || /\|e1\|/.test(x)).sort(), ['/k/fx|e1|andreas', '/k/loop/laden|b1|andreas|pruef-neu'], `Box 1 und FX 1 nur Andreas' neuer Stand: ${b}`);
  assert.ok(!b.includes('/k/loop/start|b2|andreas'), 'gestoppte Box 2 wird nicht gestartet');
  assert.ok(b.includes('/k/fx|e2|andreas'), 'FX 2 (unberührt) kommt zurück');
});

test('Slice 5 Review F4: /e/neustart mit unveränderter Generation (Neuanmeldung, Kern lief weiter) sendet nichts', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log, url } = await stapel(t, [], { loops });
  await boxAn(o, url, loops, 1, 'pruef-a', {});
  assert.notEqual(o.generation, null);
  assert.deepEqual(await nachNeustart(o, log, o.generation, kernBefehle(log).length, 0), []);
  assert.equal(o.letzteBoxFxWieder, 0, 'die 30-s-Sperre wurde nicht verbraucht');
  assert.equal((await nachNeustart(o, log, o.generation + 1, kernBefehle(log).length, 2)).length, 2, 'Gegenprobe: neue Generation stellt wieder her');
});

test('Slice 5 Review F5: ein nicht mehr ladbarer Loop wird nicht gesendet, gemeldet und nicht als Stück gezählt', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log, url } = await stapel(t, [], { loops });
  await boxAn(o, url, loops, 1, 'pruef-a', {});
  fs.rmSync(path.join(loops, 'pruef-a'), { recursive: true, force: true });
  assert.deepEqual(await nachNeustart(o, log, 101, kernBefehle(log).length, 0), []);
  assert.deepEqual(log.filter((z) => z.typ === 'box_wieder_ausgelassen').map((z) => [z.box, z.grund]), [[1, 'nicht_ladbar']]);
  assert.equal(log.filter((z) => z.typ === 'wiederherstellung').at(-1).stuecke, 0);
});

test('Slice 5 Review F6 (B14): wartet (2), läuft (3) und tempo (5) bekommen start, bereit (1) und endet (4) nicht', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log, url } = await stapel(t, [], { loops });
  await boxAn(o, url, loops, 1, 'pruef-a', {});
  let g = 110;
  for (const [status, start] of [[2, true], [3, true], [5, true], [1, false], [4, false]]) {
    o.letzteBoxFxWieder = 0;
    o.vomKern({ adresse: '/e/loop', felder: { box: 1, status, name: 'pruef-a', beats: 4 } });
    const b = await nachNeustart(o, log, ++g, kernBefehle(log).length, start ? 2 : 1);
    assert.deepEqual(b.map((z) => z.adresse), start ? ['/k/loop/laden', '/k/loop/start'] : ['/k/loop/laden'], `Status ${status}`);
  }
});

test('Slice 5 Review F7: Cyphers FX kommen bei AUTO aus nicht zurück, Andreas\' schon', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-muster-'));
  const { o, log, url } = await stapel(t, [], { musterOrdner: d });
  fs.writeFileSync(path.join(d, 'fx_von.json'), JSON.stringify({ '1': { von: 'cypher', zeit: 1 }, '2': { von: 'andreas', zeit: 1 } }));
  const fx = (e) => ({ einheit: e, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 });
  o.vomKern({ adresse: '/e/fx', felder: fx(1) });
  o.vomKern({ adresse: '/e/fx', felder: fx(2) });
  assert.equal((await postJson(url, '/strudel/autonom', { an: false })).code, 200);
  const n0 = kernBefehle(log).length;
  const b = await nachNeustart(o, log, 121, n0, 1);
  assert.deepEqual(b.map(formS5), ['/k/fx|e2|andreas']);
  assert.ok(log.some((z) => z.typ === 'fx_wieder_ausgelassen' && z.einheit === 1 && z.grund === 'auto_aus'));
});

// Slice 5 Nacharbeit 2: /e/neustart mit GLEICHER Generation (Abonnent hat sich nur neu gemeldet, der Kern lief weiter) lässt den Stand stehen
test('Slice 5 F4: gleiche Generation leert den Stand nicht und sendet nichts; neue Generation leert wie bisher', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log, url } = await stapel(t, [], { loops });
  await boxAn(o, url, loops, 1, 'pruef-a', {}, { raster: 96 });
  o.vomKern({ adresse: '/e/fx', felder: { einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 } });
  o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/1', an: 1 } });
  assert.equal((await postJson(url, '/fx/routing', { routing: 'insert' })).code, 200);
  o.vomKern({ adresse: '/e/fx/routing', felder: { routing: 1 } });
  const alle = () => log.filter((z) => z.typ === 'an_kern' && z.adresse !== '/k/hallo').length;
  const g = o.generation, a0 = alle();
  o.vomKern({ adresse: '/e/neustart', felder: { generation: g, sample: 0 } });
  await warte(900);
  assert.deepEqual(log.filter((z) => z.typ === 'an_kern' && z.adresse !== '/k/hallo').slice(a0).map((z) => z.adresse), [], 'gleiche Generation: keine Befehle (auch kein Routing-Wunsch)');
  assert.equal(o.stand.loops['1'].name, 'pruef-a');
  assert.equal(o.stand.fx[0].art, 2);
  assert.equal(o.stand.fxZuweisung[0]['deck/1'], true);
  assert.deepEqual(o.loopRasterLive['1'], { name: 'pruef-a', v: 96 });
  assert.equal(o.stand.fxRouting, 'insert');
  // neue Generation: wie bisher (Stand leer, Routing zurück auf Post Fader und Wunsch erneut gesendet)
  o.vomKern({ adresse: '/e/neustart', felder: { generation: g + 1, sample: 0 } });
  assert.deepEqual([o.stand.loops, o.stand.fx, o.stand.fxZuweisung, o.loopRasterLive], [{}, [null, null], [{}, {}], {}]);
  assert.equal(o.stand.fxRouting, 'post_fader');
  assert.ok(log.some((z, i) => z.typ === 'an_kern' && z.adresse === '/k/fx/routing' && z.felder.routing === 1 && i > 0 && log.slice(0, i).filter((y) => y.typ === 'an_kern').length >= a0), 'Routing-Wunsch geht erneut hin');
  await warte(900);   // die Wiederherstellung (500 ms) soll vor dem Ende des Tests laufen, nicht in den abgebauten Server
});

// Final-Review MAJOR-1/MINOR-2: ein gebremster Kern (Bremse F20) startet mit Generation 0 und sendet nur /k/willkommen
const willkommen = (generation) => ({ adresse: '/k/willkommen', felder: { vertrag: 1, generation, sample: 0, beat: 0, bpm: 128, version: 'x' } });
const ohneRouting = (b) => b.filter((z) => z.adresse !== '/k/fx/routing');
test('Final-Review FR1: /k/willkommen mit KLEINERER Generation (gebremster Kern) leert den Stand, sendet den Routing-Wunsch, stellt nichts wieder her', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log, url } = await stapel(t, [], { loops });
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 5, sample: 0 } });
  await warte(700);
  o.letzteBoxFxWieder = 0;
  await boxAn(o, url, loops, 1, 'pruef-a', {}, { status: 3 });
  o.vomKern({ adresse: '/e/fx', felder: { einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 } });
  assert.equal((await postJson(url, '/fx/routing', { routing: 'insert' })).code, 200);
  o.vomKern({ adresse: '/e/fx/routing', felder: { routing: 1 } });
  // Gegenprobe: gleiche Generation (Neuanmeldung) lässt alles stehen und sendet nichts
  let a0 = kernBefehle(log).length;
  o.vomKern(willkommen(5));
  await warte(700);
  assert.deepEqual(kernBefehle(log, a0), []);
  assert.equal(o.stand.loops['1'].status, 3);
  // gebremst: Generation 0 < 5
  a0 = kernBefehle(log).length;
  o.vomKern(willkommen(0));
  await warte(900);
  const b = kernBefehle(log, a0);
  assert.deepEqual(ohneRouting(b), [], 'nichts wiederhergestellt (kein laden, kein start, kein fx)');
  assert.deepEqual(b.map((z) => [z.adresse, z.felder.routing, z.felder.quelle]), [['/k/fx/routing', 1, 'andreas']], 'Routing-Wunsch geht erneut hin');
  assert.deepEqual([o.stand.loops, o.stand.fx, o.stand.fxZuweisung, o.loopRasterLive], [{}, [null, null], [{}, {}], {}]);
  assert.equal(o.generation, 0, 'gemerkte Generation ist die neue');
  assert.ok(log.some((z) => z.typ === 'wiederherstellung_uebersprungen' && z.grund === 'gebremster_start'));
  // der folgende gewöhnliche Neustart (Generation 0 → 1) stellt nichts Veraltetes her
  o.letzteBoxFxWieder = 0;
  const b2 = await nachNeustart(o, log, 1, kernBefehle(log).length, 0);
  assert.deepEqual(ohneRouting(b2), []);
});

test('Final-Review FR2: ein geplanter Plan feuert nicht in einen inzwischen gebremsten Kern (Generation hat sich geändert)', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  const { o, log, url } = await stapel(t, [], { loops });
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 5, sample: 0 } });
  await warte(700);
  o.letzteBoxFxWieder = 0;
  await boxAn(o, url, loops, 1, 'pruef-a', {}, { status: 3 });
  const a0 = kernBefehle(log).length;
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 6, sample: 0 } });   // plant
  await warte(150);
  o.vomKern(willkommen(0));   // der Kern ist inzwischen gebremst neu gestartet
  await warte(800);
  assert.deepEqual(ohneRouting(kernBefehle(log, a0)), []);
  assert.ok(log.some((z) => z.typ === 'wiederherstellung_verworfen'), 'Log wiederherstellung_verworfen');
  assert.ok(!log.some((z) => z.typ === 'wiederherstellung'), 'nicht als wiederhergestellt gezählt');
});

// Plan Glanz 1.2: Cyphers neuer Teil auf demselben Pfad wartet auf das Ende der eigenen laufenden Fahrt (der Kern lehnt
// sonst ab, einsortieren.cpp). Andreas' Teile werden nie verschoben. Phantom-Ende: eine abgelehnte oder abgebrochene Fahrt
// zählt nicht.
const teilFelder = (log) => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').map((z) => z.felder);
async function fahrtStarten(url, o, log, pfad, body, kopf, status) {
  const p = postJson(url, '/regler', { pfad, ab: 'jetzt', ...body }, kopf);
  if (status === undefined) return p;
  let id;
  for (let i = 0; i < 100 && id === undefined; i++) { id = teilFelder(log).findLast((f) => f.pfad === pfad)?.id; await warte(10); }
  assert.ok(id !== undefined, 'Teil ging an den Kern');
  o.vomKern({ adresse: '/q', felder: { id, status, grund: status === 6 ? 'ausserhalb_bereich' : '', quelle: 'cypher' } });
  return p;
}

import { ueberlappt, ersterFreierBeat } from '../hand_bedienung.ts';
test('Glanz 1.2: Regler wartet auf die eigene laufende Fahrt desselben Pfads (verschoben_auf), Andreas und andere Pfade nie', async (t) => {
  const { o, url, log } = await stapel(t);
  const r1 = await postJson(url, '/regler', { pfad: 'erz/2/filter', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  assert.equal(r1.code, 200, JSON.stringify(r1.j));
  const b0 = r1.j.felder.ab_beat;
  assert.equal(r1.j.felder.dauer_beats, 32); assert.equal(r1.j.verschoben_auf, undefined);
  // 2. gleicher Pfad, sofort: landet am Ende der Fahrt
  const r2 = await postJson(url, '/regler', { pfad: 'erz/2/filter', nach: 0, takte: 0, ab: 'jetzt' }, CYPHER);
  assert.equal(r2.j.felder.ab_beat, b0 + 32, JSON.stringify(r2.j)); assert.equal(r2.j.verschoben_auf, b0 + 32);
  // 3. Negativ-Kontrolle: gleicher Ablauf auf ANDEREM Pfad (erz/3/send/2) ist für sich unverschoben
  const s1 = await postJson(url, '/regler', { pfad: 'erz/3/send/2', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  assert.equal(s1.j.verschoben_auf, undefined); assert.ok(s1.j.felder.ab_beat < b0 + 31, 'erz/2/filter wirkt nicht auf erz/3/send/2');
  // 4. Negativ-Kontrolle: Andreas auf DEMSELBEN Pfad mit laufender Cypher-Fahrt wird nie verschoben
  const r4 = await postJson(url, '/regler', { pfad: 'erz/2/filter', nach: 0, takte: 0, ab: 'jetzt' });
  assert.equal(r4.j.verschoben_auf, undefined); assert.ok(r4.j.felder.ab_beat < b0 + 31, `ab_beat ${r4.j.felder.ab_beat}`);
  // verschoben: nur das kurze Fenster, nicht bis zum Startbeat (30 Beat = ~14 s); keine Fehlerquittung ohne Konflikt
  assert.ok(r2.j.quittung === null || ![4, 6, 7, 8].includes(r2.j.quittung.status), JSON.stringify(r2.j.quittung));
});

test('Glanz 1.2: Phantom-Ende (Review M1): Quittung 6, 7, 4 oder 8 löscht das Ende; zweiter Aufruf bleibt unverschoben', async (t) => {
  const { o, url, log } = await stapel(t);
  for (const [i, status] of [6, 7, 4, 8].entries()) {
    const pfad = `erz/${i + 1}/filter`;
    const r1 = await fahrtStarten(url, o, log, pfad, { nach: -1, takte: 8 }, CYPHER, status);
    assert.equal(r1.j.quittung.status, status, JSON.stringify(r1.j));
    const r2 = await postJson(url, '/regler', { pfad, nach: 0, takte: 0, ab: 'jetzt' }, CYPHER);
    assert.equal(r2.j.verschoben_auf, undefined, `Status ${status}: ${JSON.stringify(r2.j)}`);
    assert.ok(r2.j.felder.ab_beat < r1.j.felder.ab_beat + 31, `Status ${status}`);
  }
  // Negativ-Kontrolle: Status 2 (läuft) lässt das Ende stehen
  const r1 = await fahrtStarten(url, o, log, 'erz/5/filter', { nach: -1, takte: 8 }, CYPHER, 2);
  const r2 = await postJson(url, '/regler', { pfad: 'erz/5/filter', nach: 0, takte: 0, ab: 'jetzt' }, CYPHER);
  assert.equal(r2.j.verschoben_auf, r1.j.felder.ab_beat + 32);
});

test('Glanz 1.2: Phantom-Ende nach Stop Cypher, /abbruch und neuem Kern', async (t) => {
  const { o, url, log } = await stapel(t);
  const nachher = async (pfad) => (await postJson(url, '/regler', { pfad, nach: 0, takte: 0, ab: 'jetzt' }, CYPHER)).j;
  // Stop Cypher
  await postJson(url, '/regler', { pfad: 'erz/1/filter', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1 } });
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 0 } });
  assert.equal((await nachher('erz/1/filter')).verschoben_auf, undefined, 'nach Stop Cypher');
  // /abbruch
  await postJson(url, '/regler', { pfad: 'erz/2/filter', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  assert.equal((await postJson(url, '/abbruch', {}, CYPHER)).code, 200);
  assert.equal((await nachher('erz/2/filter')).verschoben_auf, undefined, 'nach /abbruch');
  // neuer Kern (andere Generation)
  await postJson(url, '/regler', { pfad: 'erz/3/filter', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 9, sample: 0 } });
  assert.equal((await nachher('erz/3/filter')).verschoben_auf, undefined, 'nach neuem Kern');
  // Negativ-Kontrolle: gleiche Generation (nur neu gemeldet) lässt das Ende stehen
  const a = await postJson(url, '/regler', { pfad: 'erz/4/filter', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 9, sample: 0 } });
  assert.equal((await nachher('erz/4/filter')).verschoben_auf, a.j.felder.ab_beat + 32);
});

const grundVon = async (o, id) => { await warte(200); return o.quittungen.get(id)?.find((q) => Number(q.status) !== 1)?.grund ?? null; };
const cy = (url, pfad, nach, takte, ab) => postJson(url, '/regler', { pfad, nach, takte, ab }, CYPHER).then((r) => r.j);

test('Glanz 1.2 ueberlappt(): die Regel des Kerns (einsortieren.cpp:17-27) für Cyphers Teile', () => {
  const R = (ab, dauer) => ({ ab, dauer });
  assert.equal(ueberlappt(R(10, 0), R(10, 0)), true, 'zwei Setzen am selben Beat');
  assert.equal(ueberlappt(R(10, 0), R(11, 0)), false);
  assert.equal(ueberlappt(R(10, 8), R(12, 0)), true, 'Setzen in der Rampe');
  assert.equal(ueberlappt(R(10, 8), R(10, 0)), false, 'Setzen am Rampenstart (gleiche Nummer)');
  assert.equal(ueberlappt(R(10, 8), R(18, 0)), false, 'Setzen am Rampenende');
  assert.equal(ueberlappt(R(10, 0), R(8, 8)), true, 'Rampe über ein Setzen');
  assert.equal(ueberlappt(R(10, 0), R(10, 8)), false, 'Rampe startet auf dem Setzen');
  assert.equal(ueberlappt(R(10, 8), R(14, 8)), true); assert.equal(ueberlappt(R(10, 8), R(18, 8)), false);
  assert.equal(ersterFreierBeat([R(10, 0), R(11, 0), R(12, 0)], 10, 0), 13, 'drei feste auf einem Beat');
  assert.equal(ersterFreierBeat([R(10, 8)], 20, 0), 20, 'hinter der Rampe frei');
});

test('Glanz 1.2: feste Werte und Rampen (Review): Fälle A, B, D und Anfang statt nur Ende; der Kern lehnt nichts ab', async (t) => {
  const { o, url } = await stapel(t);
  const beat = () => o.kern.uhr.beat;
  // Positiv-Gegenprobe des Instruments: zwei Setzen auf demselben Beat direkt an den Kern → die Attrappe quittiert ueberlappung
  const roh = (n) => ({ id: Number(++o.id), quelle: 'cypher', plan: 'cypher', teil: 0, pfad: 'erz/8/filter', ab_beat: 250, dauer_beats: 0, nach: n, form: 1, politik: 0, gruppe: '', hoerschein: '' });
  const r1 = roh(-1), r2 = roh(0);
  o.kern.sende('/k/teil', r1); o.kern.sende('/k/teil', r2);
  assert.equal(await grundVon(o, r2.id), 'ueberlappung'); assert.notEqual(await grundVon(o, r1.id), 'ueberlappung');
  // D: drei feste auf einem Beat (Uhr eingefroren) → b, b+1, b+2
  o.abVon = () => 200;
  const d = [await cy(url, 'erz/1/filter', -1, 0, 'jetzt'), await cy(url, 'erz/1/filter', -0.5, 0, 'jetzt'), await cy(url, 'erz/1/filter', 0, 0, 'jetzt')];
  assert.deepEqual(d.map((x) => x.felder.ab_beat), [200, 201, 202]);
  assert.deepEqual(d.map((x) => x.verschoben_auf), [undefined, 201, 202]);
  for (const x of d) assert.notEqual(await grundVon(o, x.felder.id), 'ueberlappung');
  // A: Rampe 300..308, fest 'jetzt' 302 → 308, fest 'jetzt' 302 → 309 (nicht auf den zweiten)
  const ab = [300, 302, 302]; let i = 0; o.abVon = () => ab[i++];
  const ra = [await cy(url, 'erz/2/filter', -1, 2, 'jetzt'), await cy(url, 'erz/2/filter', 0, 0, 'jetzt'), await cy(url, 'erz/2/filter', 0.5, 0, 'jetzt')];
  assert.deepEqual(ra.map((x) => x.felder.ab_beat), [300, 308, 309]);
  for (const x of ra) assert.notEqual(await grundVon(o, x.felder.id), 'ueberlappung');
  // B: fest auf 400 (takt), dann fest 'jetzt' 397 → bleibt auf 397 (kein Konflikt, vorher fälschlich auf 400)
  const bb = [400, 397]; i = 0; o.abVon = () => bb[i++];
  const fb = [await cy(url, 'erz/3/filter', -1, 0, 'takt'), await cy(url, 'erz/3/filter', 0, 0, 'jetzt')];
  assert.deepEqual(fb.map((x) => x.felder.ab_beat), [400, 397]); assert.equal(fb[1].verschoben_auf, undefined);
  for (const x of fb) assert.notEqual(await grundVon(o, x.felder.id), 'ueberlappung');
  // Anfang statt nur Ende: Rampe 128..160 (phrase), fest 'jetzt' 101 liegt davor → unverschoben
  const ph = [128, 101]; i = 0; o.abVon = () => ph[i++];
  const fp = [await cy(url, 'erz/4/filter', -1, 8, 'phrase'), await cy(url, 'erz/4/filter', 0, 0, 'jetzt')];
  assert.deepEqual(fp.map((x) => x.felder.ab_beat), [128, 101]); assert.equal(fp[1].verschoben_auf, undefined);
  for (const x of fp) assert.notEqual(await grundVon(o, x.felder.id), 'ueberlappung');
  void beat;
});

test('Glanz 1.2: verschobener Teil, den der Kern sofort ablehnt (Andreas-Teil am Zielbeat), trägt die Ablehnung in der Antwort', async (t) => {
  const { o, url } = await stapel(t);
  const t0 = Date.now();
  const x = await cy(url, 'erz/2/filter', -1, 8, 'jetzt');
  const ziel = x.felder.ab_beat + 32;
  // Andreas' fester Wert genau auf dem Beat, auf den Cyphers zweiter Teil geschoben wird
  o.kern.sende('/k/teil', { id: Number(++o.id), quelle: 'andreas', plan: '', teil: 0, pfad: 'erz/2/filter', ab_beat: ziel, dauer_beats: 0, nach: 0.1, form: 1, politik: 0, gruppe: '', hoerschein: '' });
  await warte(100);
  const y = await cy(url, 'erz/2/filter', 0, 0, 'jetzt');
  assert.equal(y.verschoben_auf, ziel);
  assert.equal(y.quittung?.status, 6, JSON.stringify(y)); assert.equal(y.quittung.grund, 'ueberlappung');
  assert.ok(Date.now() - t0 < 3000, 'wartet nicht bis zum Startbeat');
  // Negativ-Kontrolle: verschoben ohne Konflikt (anderer Pfad, nur Cypher) → kein Fehlerstatus
  await cy(url, 'erz/3/filter', -1, 8, 'jetzt');
  const z = await cy(url, 'erz/3/filter', 0, 0, 'jetzt');
  assert.ok(z.verschoben_auf !== undefined && (z.quittung === null || ![4, 6, 7, 8].includes(z.quittung.status)), JSON.stringify(z));
});

// Plan Glanz 1.3 (Server-Teil, Review-Befunde 1-3): Kern lässt pad/* für Cypher ohne Hörschein öffnen; die Herkunft des
// Box-Inhalts prüft die Seite, und zwar bei der Anfrage UND bei jedem Inhaltswechsel danach (offene Box, offene Rampe).
async function padStapel(t, extra = {}) {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-'));
  schreibeLoop(loops, 'c-eigen', 4, false, 'mitschnitt');
  schreibeLoop(loops, 'c-eigen2', 4, false, 'mitschnitt');
  schreibeLoop(loops, 'a-fremd', 4, false, 'deck');
  const st = await geladenesDeck(t, { loops, ...extra });
  const teile = () => st.log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil');
  const laden_ = () => st.log.filter((z) => z.typ === 'an_kern' && /^\/k\/loop\/(laden|start)$/.test(z.adresse));
  return { ...st, loops, teile, laden: laden_ };
}
const ablaufen = (o, pfad) => { for (const e of o.fahrtEnde.get(pfad) ?? []) { e.ab = -10; e.dauer = 0; } };   // Rampe ist abgelaufen

test('Glanz 1.3 (i)(ii): pad/1/fader öffnet für Cypher mit eigenem Mitschnitt ohne Hörschein; fremder Loop bleibt kein_hoerschein', async (t) => {
  const { o, url, loops, teile } = await padStapel(t);
  await boxAn(o, url, loops, 1, 'c-eigen', CYPHER, { status: 1 });
  const r = await postJson(url, '/regler', { pfad: 'pad/1/fader', nach: -6, takte: 0 }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(teile().at(-1).felder.pfad, 'pad/1/fader'); assert.equal(teile().at(-1).felder.quelle, 'cypher'); assert.equal(teile().at(-1).felder.hoerschein, '');
  // fremder Loop (Deck-Schnitt) in Box 2: gesperrt, nichts an den Kern; Andreas' Hand geht (Negativ-Kontrolle)
  await boxAn(o, url, loops, 2, 'a-fremd', {}, { status: 1 });
  const n0 = teile().length;
  const f = await postJson(url, '/regler', { pfad: 'pad/2/fader', nach: -6, takte: 0 }, CYPHER);
  assert.equal(f.code, 409); assert.equal(f.j.fehler, 'kein_hoerschein'); assert.equal(teile().length, n0);
  const tr = await postJson(url, '/regler', { pfad: 'pad/2/trim', nach: 0, takte: 0 }, CYPHER);   // Trim wie Fader: 0 + (-200) bleibt zu, aber Fader-Wert unbekannt
  assert.equal(tr.code, 200);   // öffnet nichts (Fader zu): kein Fall für die Wache
  assert.equal((await postJson(url, '/regler', { pfad: 'pad/2/fader', nach: -6, takte: 0 })).code, 200);
});

test('Glanz 1.3 (iii): deck/loop/sichern mit box lädt für Cypher nichts in eine offene Box oder unter laufende Rampe', async (t) => {
  const { o, url, loops, teile, laden } = await padStapel(t);
  const e = eins();
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  await postJson(url, '/deck/loop', { deck: 1, laenge: 2, raster: 4 });
  await zustand(o, (x) => x.beats_bis_ende === null || x.beats_bis_ende === Infinity);
  await boxAn(o, url, loops, 1, 'c-eigen', CYPHER, { status: 1 });
  // (b) Rampe auf Box 1 (Eq öffnet nichts, die Box ist zu) und die Befund-Rampe auf dem Fader
  assert.equal((await postJson(url, '/regler', { pfad: 'pad/1/fader', nach: -6, takte: 4 }, CYPHER)).code, 200);
  const n0 = laden().length;
  const x = await postJson(url, '/deck/loop/sichern', { deck: 1, box: 1 }, CYPHER);
  assert.equal(x.code, 409, JSON.stringify(x.j)); assert.equal(x.j.fehler, 'box_offen_oder_faehrt');
  assert.equal(laden().length, n0, 'nichts an /k/loop/laden');
  assert.deepEqual(fs.readdirSync(loops).sort(), ['c-eigen', 'c-eigen2', 'a-fremd'].sort(), 'auch keine Datei geschrieben');
  // andere Box ohne Rampe: frei; ohne box (nur sichern): frei; Andreas: nie gesperrt
  assert.equal((await postJson(url, '/deck/loop/sichern', { deck: 1, box: 2 }, CYPHER)).code, 200);
  await warte(1100);   // der Name trägt HHMMSS
  assert.equal((await postJson(url, '/deck/loop/sichern', { deck: 1 }, CYPHER)).code, 200);
  await warte(1100);   // der Name trägt HHMMSS
  assert.equal((await postJson(url, '/deck/loop/sichern', { deck: 1, box: 1 })).code, 200, 'Andreas');
  // nach Rampenende: Cypher darf wieder (Negativ-Kontrolle)
  ablaufen(o, 'pad/1/fader');
  await warte(1100);   // der Name trägt HHMMSS
  assert.equal((await postJson(url, '/deck/loop/sichern', { deck: 1, box: 1 }, CYPHER)).code, 200);
  // (a) offene Box: gesperrt. Erst die laufende Rampe vom Anfang abbrechen: ihr Echo /e/regler überschrieb sonst den
  // gesetzten Wert, die Box galt als zu, und der Schnitt in derselben Sekunde scheiterte am Namen (500, Wackler 06.10.).
  assert.equal((await postJson(url, '/abbruch', {}, CYPHER)).code, 200);
  await warte(300);
  o.stand.regler['pad/1/fader'] = -6;
  o.stand.regler['pad/1/trim'] = 0;
  await warte(1100);   // der Name trägt HHMMSS
  const n1 = laden().length;
  const y = await postJson(url, '/deck/loop/sichern', { deck: 1, box: 1 }, CYPHER);
  assert.equal(y.code, 409); assert.equal(y.j.fehler, 'box_offen_oder_faehrt'); assert.equal(laden().length, n1);
});

test('Glanz 1.3 (iv)(v): /loop laden und start fremden Inhalts sind unter laufender Rampe gesperrt; eigener Mitschnitt, Andreas, Rampenende nicht', async (t) => {
  const { o, url, loops, teile, laden } = await padStapel(t);
  await boxAn(o, url, loops, 1, 'c-eigen', CYPHER, { status: 1 });
  assert.equal((await postJson(url, '/regler', { pfad: 'pad/1/fader', nach: -6, takte: 4 }, CYPHER)).code, 200);
  const n0 = laden().length;
  const x = await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'a-fremd' }, CYPHER);
  assert.equal(x.code, 409, JSON.stringify(x.j)); assert.equal(x.j.fehler, 'box_offen_oder_faehrt');
  assert.equal(laden().length, n0, 'nichts an den Kern');
  assert.equal(o.loopLadung['1']?.name ?? 'c-eigen', 'c-eigen', 'Besitzerbuchführung unberührt');
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'c-eigen2' }, CYPHER)).code, 200, 'eigener Mitschnitt darf');
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'a-fremd' })).code, 200, 'Andreas nie gesperrt');
  // /loop start: der geladene Loop ist jetzt fremd (Andreas lud ihn), Rampe läuft noch
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 1, name: 'a-fremd', beats: 4 } });
  const s = await postJson(url, '/loop', { aktion: 'start', box: 1 }, CYPHER);
  assert.equal(s.code, 409); assert.equal(s.j.fehler, 'box_offen_oder_faehrt');
  assert.equal((await postJson(url, '/loop', { aktion: 'start', box: 1 })).code, 200, 'Andreas');
  // Rampenende: Cypher darf fremd laden (Negativ-Kontrolle)
  ablaufen(o, 'pad/1/fader');
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'a-fremd' }, CYPHER)).code, 200);
  assert.equal((await postJson(url, '/loop', { aktion: 'start', box: 1 }, CYPHER)).code, 200);
  // andere Box: nie betroffen
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 2, name: 'a-fremd' }, CYPHER)).code, 200);
});

test('Glanz 1.3 Re-Review 1: ausstehende Ladung eines Deck-Schnitts (kein Echo) zählt als fremd; nach Echo eines eigenen Mitschnitts frei', async (t) => {
  const { o, url, loops, teile } = await padStapel(t);
  const e = eins();
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  await postJson(url, '/deck/loop', { deck: 1, laenge: 2, raster: 4 });
  await zustand(o, (x) => x.beats_bis_ende === null || x.beats_bis_ende === Infinity);
  await boxAn(o, url, loops, 1, 'c-eigen', CYPHER, { status: 1 });
  const s = await postJson(url, '/deck/loop/sichern', { deck: 1, box: 1 }, CYPHER);   // geschlossen, ruhend: erlaubt; Echo fehlt
  assert.equal(s.code, 200, JSON.stringify(s.j));
  const n0 = teile().length;
  const f = await postJson(url, '/regler', { pfad: 'pad/1/fader', nach: -6, takte: 0 }, CYPHER);
  assert.equal(f.code, 409); assert.equal(f.j.fehler, 'kein_hoerschein'); assert.equal(teile().length, n0);
  // Negativ-Kontrolle: Echo eines EIGENEN Mitschnitts löst die Ladung ab
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 2, name: 'c-eigen2' }, CYPHER)).code, 200);
  o.vomKern({ adresse: '/e/loop', felder: { box: 2, status: 1, name: 'c-eigen2', beats: 4 } });
  assert.equal((await postJson(url, '/regler', { pfad: 'pad/2/fader', nach: -6, takte: 0 }, CYPHER)).code, 200);
});

test('Glanz 1.3 Re-Review 2: nur fader/trim-Rampen sperren das Nachladen; eq-Rampe nicht', async (t) => {
  const { o, url, loops } = await padStapel(t);
  await boxAn(o, url, loops, 1, 'c-eigen', CYPHER, { status: 1 });
  assert.equal((await postJson(url, '/regler', { pfad: 'pad/1/eq/tief', nach: -12, takte: 4 }, CYPHER)).code, 200);
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'a-fremd' }, CYPHER)).code, 200, 'eq-Rampe sperrt nicht');
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 1, name: 'a-fremd', beats: 4 } });
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'c-eigen' }, CYPHER)).code, 200);
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 1, name: 'c-eigen', beats: 4 } });
  assert.equal((await postJson(url, '/regler', { pfad: 'pad/1/trim', nach: -3, takte: 4 }, CYPHER)).code, 200);
  const x = await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'a-fremd' }, CYPHER);
  assert.equal(x.code, 409); assert.equal(x.j.fehler, 'box_offen_oder_faehrt', 'trim-Rampe sperrt');
});

async function ausstehendeLadung(t, neustart) {
  {
    const { o, log, url, loops, teile } = await padStapel(t);
    await boxAn(o, url, loops, 1, 'a-fremd', {}, { status: 3 });   // Andreas' fremder Loop läuft in Box 1
    assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'c-eigen' }, CYPHER)).code, 200);   // eigene Ladung, Echo steht aus
    if (neustart) {
      const n0 = kernBefehle(log).length;
      const b = await nachNeustart(o, log, 31, n0, 2);   // laden a-fremd, start
      assert.equal(b[0].felder.name, 'a-fremd');
      o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 3, name: 'a-fremd', beats: 4 } });
    }
    // Naht F13: ohne Neustart erst nach der Übernahme (Echo mit dem eigenen Namen) eigen; vorher klingt noch a-fremd.
    if (!neustart) o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 3, name: 'c-eigen', beats: 4 } });
    const n1 = teile().length;
    const r = await postJson(url, '/regler', { pfad: 'pad/1/fader', nach: -6, takte: 0 }, CYPHER);
    if (neustart) { assert.equal(r.code, 409); assert.equal(r.j.fehler, 'kein_hoerschein'); assert.equal(teile().length, n1); }
    else { assert.equal(r.code, 200, 'Negativ-Kontrolle: ohne Neustart ist die Box nach der Übernahme der eigenen Ladung eigen'); }
  }
}
test('Glanz 1.3 Gesamt-Review: eine beim Kern-Neustart ausstehende eigene Ladung macht die wiederhergestellte fremde Box nicht zum eigenen Mitschnitt', (t) => ausstehendeLadung(t, true));
test('Glanz 1.3 Gesamt-Review (Negativ-Kontrolle): ohne Neustart zählt die ausstehende eigene Ladung weiter', (t) => ausstehendeLadung(t, false));

test('Glanz 2.1 F22: /ausgang und /lage.ausgang zeigen den Stand der Wache, ohne Datei unbewacht', async (t) => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-do-')), 'digitalout.json');
  fs.writeFileSync(p, JSON.stringify({ version: 1, karte: 2, zustand: 'aus', faelle: 0, letzter: null, lebenszeichen: new Date().toISOString() }));
  const { url } = await stapel(t, [], { digitalout: p });
  assert.equal((await (await fetch(`${url}/ausgang`)).json()).zustand, 'aus');
  assert.equal((await (await fetch(`${url}/lage`)).json()).ausgang.zustand, 'aus');
  fs.rmSync(p);
  assert.equal((await (await fetch(`${url}/ausgang`)).json()).zustand, 'unbewacht');   // Negativ: Datei weg
});

// Naht Klickfrei (F13) × Welle 1 (pad/*): der Kern lässt einen in eine klingende Box geladenen Loop bis zu 4 s warten
// (/e/loop meldet erst den alten Namen) und verwirft bei Stop Cypher wartende cypher-Loops ohne Echo. Eigen ist eine
// Box für Cyphers Fader nur, wenn der laufende UND der wartende Inhalt Cyphers Mitschnitt sind.
test('Naht F13: eigener Loop wartet in einer Box, in der noch ein fremder klingt → pad-Fader bleibt kein_hoerschein, nach Übernahme frei', async (t) => {
  const { o, url, loops, teile } = await padStapel(t);
  await boxAn(o, url, loops, 1, 'a-fremd', {}, { status: 3 });                       // Andreas' Deck-Schnitt klingt
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'c-eigen' }, CYPHER)).code, 200);
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 3, name: 'a-fremd', beats: 4 } });   // F13: erst der alte Name
  const n0 = teile().length;
  const r = await postJson(url, '/regler', { pfad: 'pad/1/fader', nach: -6, takte: 0 }, CYPHER);
  assert.equal(r.code, 409, JSON.stringify(r.j)); assert.equal(r.j.fehler, 'kein_hoerschein'); assert.equal(teile().length, n0);
  o.vomKern({ adresse: '/e/loop', felder: { box: 1, status: 3, name: 'c-eigen', beats: 4 } });   // Übernahme
  assert.equal((await postJson(url, '/regler', { pfad: 'pad/1/fader', nach: -6, takte: 0 }, CYPHER)).code, 200, 'Negativ-Kontrolle: nach Übernahme eigen');
});

test('Naht F13: Stop Cypher verwirft Cyphers wartende Ladung → nach der Freigabe gilt wieder der klingende fremde Inhalt', async (t) => {
  const { o, url, loops, teile } = await padStapel(t);
  await boxAn(o, url, loops, 1, 'a-fremd', {}, { status: 3 });
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 1, name: 'c-eigen' }, CYPHER)).code, 200);
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1 } });
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 0 } });
  assert.equal(o.loopLadung['1'], undefined, 'wartende cypher-Ladung ist geräumt');
  const r = await postJson(url, '/regler', { pfad: 'pad/1/fader', nach: -6, takte: 0 }, CYPHER);
  assert.equal(r.code, 409, JSON.stringify(r.j)); assert.equal(teile().filter((z) => z.felder.pfad === 'pad/1/fader').length, 0);
  // Negativ-Kontrolle: Andreas' wartende Ladung bleibt (Stop Cypher betrifft nur Cyphers)
  assert.equal((await postJson(url, '/loop', { aktion: 'laden', box: 2, name: 'a-fremd' })).code, 200);
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1 } });
  assert.equal(o.loopLadung['2']?.name, 'a-fremd');
});
