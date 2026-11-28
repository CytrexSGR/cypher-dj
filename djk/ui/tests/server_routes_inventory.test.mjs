// Page server against the core stand-in: stack start, inventory, config, hand and grip routes, Cypher source gate, strudel and effect routes. Moved from server.test.mjs.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { leseBestand } from '../server.ts';
import { baueBestand } from './support/inventory.mjs';
import { midiRoh, vorgabe } from '../public/curves.js';
import { KOPIE_TEXT, HAND_PRUEFMODUS_TEXT } from '../public/messages.js';
import { kodiere } from '../../contract/mock_core/osc.mjs';
import { K, TEST_INSTANZ } from './support/instance.mjs';
import { TMP, NIGHTSHIFT, LEBEND, STRUDEL_PAKETE, OHNE_STRUDEL, BESTAND, warte, stapel, sse, post, postJson, geladenesDeck, zustand, eins, CYPHER, bis, neustart, K2 } from './server_test_help.mjs';
// Own temp folder of this file (created in the helper module, one process per file), removed at the end.
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// bestand/ ist der lebende Arbeitsbestand (nicht in Git) und wächst: gezählt wird gegen seinen index.sqlite, nicht gegen eine feste Zahl
function indexZahlen(dir) {
  const db = new DatabaseSync(path.join(dir, 'index.sqlite'), { readOnly: true });
  const z = db.prepare('SELECT count(*) AS f, count(DISTINCT material_id) AS m FROM fassung').get();
  db.close();
  return z;
}

// Plan d1-s1 Task 3: „wie Index“ heißt je Fassung dasselbe (material_id, basis_bpm, fassung) wie index.sqlite und eine Länge aus
// fassung.json; KEIN festes Grundtempo (der lebende Bestand hat seit Oktober eine Fassung mit 132 BPM, Erhebung u4 15.10.).
function pruefeWieIndex(dir, mindestens = 14) {
  const b = leseBestand(dir);
  const z = indexZahlen(dir);
  assert.ok(z.f >= mindestens, `Index hat ${z.f} Fassungen, mindestens ${mindestens} erwartet`);
  const db = new DatabaseSync(path.join(dir, 'index.sqlite'), { readOnly: true });
  const zeilen = db.prepare('SELECT material_id, basis_bpm, fassung FROM fassung').all();
  db.close();
  const schluessel = (e) => `${e.material_id}|${Number(e.basis_bpm)}|${Number(e.fassung)}`;
  assert.deepEqual(b.map(schluessel).sort(), zeilen.map(schluessel).sort(), 'jede Fassung des Index genau einmal, mit ihrem Grundtempo');
  assert.equal(new Set(b.map((e) => e.material_id)).size, z.m);
  assert.deepEqual(b.filter((e) => !(e.beats > 0)).map(schluessel), [], 'Länge aus fassung.json');
  return b;
}

test('Prüfbestand: Fassungen und Materialien gleich index.sqlite, Länge aus fassung.json; mindestens 14 Fassungen mit 128 BPM für die Deck-Tests', () => {
  const b = pruefeWieIndex(BESTAND);
  assert.ok(b.filter((e) => e.basis_bpm === 128).length >= 14, 'die Deck-Tests brauchen 14 Fassungen mit basis_bpm 128');
});

test('pruefeWieIndex: eine Fassung mit 132 BPM ist kein Fehler, ein falsch gelesenes Grundtempo schon (Regression Test 104, Negativ-Kontrolle)', () => {
  const dir = baueBestand(fs.mkdtempSync(path.join(TMP, 'djk-bestand132-')), [
    { material_id: '5f00000000000001', titel: 'eins', basis_bpm: 132 }, { material_id: '5f00000000000002', titel: 'zwei' }]);
  try {
    assert.deepEqual(pruefeWieIndex(dir, 2).map((e) => e.basis_bpm).sort(), [128, 132]);
    const db = new DatabaseSync(path.join(dir, 'index.sqlite'));
    db.exec(`UPDATE fassung SET basis_bpm = 130 WHERE material_id = '5f00000000000001'`);   // Index sagt 130, Ordner und fassung.json 132
    db.close();
    assert.throws(() => pruefeWieIndex(dir, 2), /Länge aus fassung.json/, 'ohne passende fassung.json fehlt die Länge');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const lebendDa = fs.existsSync(path.join(LEBEND, 'index.sqlite'));
test('Bestand wie Index 15 (lebender Arbeitsbestand): Fassungen und Materialien gleich index.sqlite, Länge aus fassung.json',
  { skip: lebendDa ? false : `kein lebender Arbeitsbestand (${path.join(LEBEND, 'index.sqlite')} fehlt; CYPHERDJ_BESTAND setzen)` }, () => {
  pruefeWieIndex(LEBEND);
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
  for (const pfad of ['deck/5/fader', 'cue/split', 'deck/1/bogus']) {
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

test('Plan Tempo-Folge: /loops markiert defekte Loops (frames, bpm, Dateigröße)', async (t) => {
  const loops = fs.mkdtempSync(path.join(TMP, 'djk-loops-'));
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
  assert.equal(o.gesendet, 0, 'listing sends nothing to the kern');
});

test('Loops: /loops lists the library, a half-written folder is not in it, the loop boxes are gone (MVP 2, container core)', async (t) => {
  const loops = fs.mkdtempSync(path.join(TMP, 'djk-loops-'));
  schreibeLoop(loops, 'pruef-a', 4);
  schreibeLoop(loops, 'pruef-b', 1);
  schreibeLoop(loops, 'hoertest-alt', 8, true);  // Scheibe 3 (E3): alte takte-Datei bleibt in der Liste, als 8 Beats
  fs.mkdirSync(path.join(loops, '.halb.neu'));
  const { o, url } = await stapel(t, [], { loops });
  const liste = await (await fetch(url + '/loops')).json();
  assert.deepEqual(liste.map((l) => [l.name, l.beats, l.quelle]), [['hoertest-alt', 8, 'test'], ['pruef-a', 4, 'test'], ['pruef-b', 1, 'test']]);
  const vorher = o.gesendet;
  for (const body of [{ aktion: 'laden', box: 1, name: 'pruef-a' }, { aktion: 'start', box: 1 }, { aktion: 'stopp', box: 2 }, { aktion: 'bogus', box: 1 }]) {
    const r = await postJson(url, '/loop', body);
    assert.deepEqual([r.code, r.j.fehler], [400, 'unbekannte_aktion'], JSON.stringify(body));
  }
  assert.equal(o.gesendet, vorher, 'nothing went to the kern');
});

test('Mitschnitt (MVP 2 Scheibe 2): /loop rec schickt an den Kern, /e/mitschnitt kommt durch', async (t) => {
  const { o, log, url } = await stapel(t);
  const s = sse(url);
  assert.equal((await postJson(url, '/loop', { aktion: 'rec', beats: 1, name: 'c-143012-1b' })).code, 200);
  const an = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/rec')
    .map((z) => [z.adresse, z.felder.quelle, z.felder.beats, z.felder.name, z.felder.summe]);
  assert.deepEqual(an, [['/k/loop/rec', 'andreas', 1, 'c-143012-1b', 0]]);
  // summe: the Strudel sum (erz/1+2+3) instead of erz/1; anything but 0/1/true/false is refused before the kern
  assert.equal((await postJson(url, '/loop', { aktion: 'rec', beats: 1, name: 'c-143012-1s', summe: 1 })).code, 200);
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/rec').at(-1).felder.summe, 1);
  assert.equal((await postJson(url, '/loop', { aktion: 'rec', beats: 1, name: 'x', summe: 2 })).code, 400);
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

test('Griff an pad/1/fader kommt am Kern an (container strip pad/1)', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url);
  assert.equal((await postJson(url, '/griff', { pfad: 'pad/1/fader', u: 0.5 })).code, 200);
  assert.equal((await postJson(url, '/griff', { pfad: 'pad/1/fader', u: 1 })).code, 200);
  await warte(200);
  assert.ok(s.ereignisse.some((e) => e.a === '/e/regler' && e.f.pfad === 'pad/1/fader'));
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
  const tmpB = fs.mkdtempSync(path.join(TMP, 'djk60n-b-'));
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

// Effekt-Sektion Schritt 4: Automation je Loop über /loop/automation; bei laufender Box plant der Server die Durchgänge als
// /k/teil (Plan loopauto:<box>, Quelle andreas) und bricht sie ab, wenn die Box nicht mehr läuft
// Effekt-Sektion (2026-10-11): <k>/komp/* über /regler, in /lage nur abweichend von der Vorgabe; Busse haben keinen Kompressor
test('Kompressor: pad/1/komp/* setzen, Lage nur abweichend, bus abgelehnt', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url);
  await warte(100);
  const l0 = await (await fetch(`${url}/lage`)).json();
  assert.ok(!Object.keys(l0.regler).some((p) => p.includes('/komp/')), 'Vorgabe: kein komp in der Lage');
  for (const [pfad, nach] of [['pad/1/komp/an', 1], ['pad/1/komp/schwelle', -30], ['pad/2/komp/mix', 0.5]]) {
    const r = await postJson(url, '/regler', { pfad, nach, ab: 'jetzt' }, CYPHER);
    assert.equal(r.code, 200, JSON.stringify(r.j));
  }
  assert.equal((await postJson(url, '/regler', { pfad: 'bus/1/komp/an', nach: 1 }, CYPHER)).code, 400);   // Negativkontrolle
  await warte(300);
  const l = await (await fetch(`${url}/lage`)).json();
  assert.equal(l.regler['pad/1/komp/an'], 1, JSON.stringify(l.regler));
  assert.equal(l.regler['pad/1/komp/schwelle'], -30);
  assert.equal(l.regler['pad/2/komp/mix'], 0.5);
  assert.ok(!('pad/1/komp/ratio' in l.regler), 'unverändertes Feld bleibt unsichtbar');
  s.zu();
});

// 1.15 A2 (mix tools): tool controls travel through /regler and show in /lage only once they differ from their default (like komp/*);
// erz/8 and bus-only tools on a source channel are refused (400). lim/decke defaults to -0.3, which is not exact in float32: it must still
// count as the default after the OSC round trip.
test('1.15 A2 /regler + /lage: gate, util, mb, lim, spektrum show in lage only after leaving the default; erz/8 and wrong-kind paths are 400', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url);
  await warte(100);
  const werkzeug = (l) => Object.keys(l.regler).filter((p) => /\/(gate|util|mb|lim)\/|^spektrum\//.test(p));
  const l0 = await (await fetch(`${url}/lage`)).json();
  assert.deepEqual(werkzeug(l0), [], 'default: no tool control in lage');
  for (const [pfad, nach] of [['deck/1/gate/an', 1], ['pad/1/gate/schwelle', -55], ['pad/2/util/breite', 150], ['bus/3/mb/tief/makeup', 6],
    ['bus/1/lim/decke', -6], ['spektrum/kanal', 9], ['deck/2/gate/ratio', 100], ['bus/2/lim/decke', -0.3], ['bus/4/util/dc', 0]]) {
    const r = await postJson(url, '/regler', { pfad, nach, ab: 'jetzt' }, CYPHER);
    assert.equal(r.code, 200, `${pfad}: ${JSON.stringify(r.j)}`);
  }
  for (const pfad of ['erz/8/gate/an', 'erz/7/gate/schwelle', 'deck/3/gate/an', 'bus/1/gate/an', 'deck/1/mb/an', 'deck/1/lim/an', 'bus/1/mb/tief/solo', 'bus/1/util/gain_db', 'spektrum/kanal/1']) {
    assert.equal((await postJson(url, '/regler', { pfad, nach: 1 }, CYPHER)).code, 400, pfad);   // negative controls
  }
  await warte(300);
  const l = await (await fetch(`${url}/lage`)).json();
  const soll = { 'deck/1/gate/an': 1, 'pad/1/gate/schwelle': -55, 'pad/2/util/breite': 150, 'bus/3/mb/tief/makeup': 6, 'bus/1/lim/decke': -6, 'spektrum/kanal': 9 };
  assert.deepEqual(Object.fromEntries(werkzeug(l).map((p) => [p, l.regler[p]])), soll, JSON.stringify(l.regler));
  assert.ok(!('deck/2/gate/ratio' in l.regler) && !('bus/2/lim/decke' in l.regler) && !('bus/4/util/dc' in l.regler),
    'a value set to its default stays invisible (lim/decke -0.3 after the float32 round trip too)');
  s.zu();
});

// S5r Task 4: graph knobs <channel>/bk/1..8 travel through /regler like every other control
test('S5r /regler: deck/1/bk/3 reaches the kernel as /k/teil, lage shows it once it differs from 0.5, bk/65 and erz/4/bk/1 are 400, knobs 9..64 pass', async (t) => {
  const { url, log } = await stapel(t);
  const s = sse(url);
  await warte(100);
  const l0 = await (await fetch(`${url}/lage`)).json();
  assert.ok(!Object.keys(l0.regler).some((p) => p.includes('/bk/')), 'default 0.5: no bk in lage');
  const n0 = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').length;
  const r = await postJson(url, '/regler', { pfad: 'deck/1/bk/3', nach: 0.8, ab: 'jetzt' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.felder.pfad, 'deck/1/bk/3');
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').length, n0 + 1, 'exactly one /k/teil to the kernel');
  assert.equal((await postJson(url, '/regler', { pfad: 'pad/1/bk/8', nach: 0.25, ab: 'jetzt' }, CYPHER)).code, 200);
  await warte(300);
  const l = await (await fetch(`${url}/lage`)).json();
  assert.equal(l.regler['deck/1/bk/3'], 0.8, JSON.stringify(l.regler));
  assert.equal(l.regler['pad/1/bk/8'], 0.25);
  assert.ok(!('deck/1/bk/1' in l.regler), 'untouched knob stays invisible');
  // 32 knobs: knobs 9, 17 and 32 pass; bk/17 is its own path (not bk/1 and not bk/7)
  for (const [pfad, w] of [['deck/1/bk/9', 0.1], ['pad/2/bk/17', 0.6], ['pad/1/bk/32', 0.9], ['deck/2/bk/33', 0.33], ['pad/1/bk/48', 0.48], ['pad/2/bk/64', 0.64]]) {
    assert.equal((await postJson(url, '/regler', { pfad, nach: w, ab: 'jetzt' }, CYPHER)).code, 200, pfad);
  }
  await warte(300);
  const l2 = await (await fetch(`${url}/lage`)).json();
  assert.equal(l2.regler['deck/1/bk/9'], 0.1); assert.equal(l2.regler['pad/2/bk/17'], 0.6); assert.equal(l2.regler['pad/1/bk/32'], 0.9);
  assert.equal(l2.regler['deck/2/bk/33'], 0.33); assert.equal(l2.regler['pad/1/bk/48'], 0.48); assert.equal(l2.regler['pad/2/bk/64'], 0.64);
  assert.ok(!('deck/2/bk/1' in l2.regler) && !('deck/2/bk/3' in l2.regler) && !('pad/1/bk/4' in l2.regler) && !('pad/2/bk/6' in l2.regler), 'bk/33 is not bk/1 or bk/3, bk/48 is not bk/4, bk/64 is not bk/6');
  assert.ok(!('pad/2/bk/1' in l2.regler) && !('pad/2/bk/7' in l2.regler), 'bk/17 does not show as bk/1 or bk/7');
  for (const pfad of ['deck/1/bk/65', 'deck/1/bk/0', 'deck/1/bk/00', 'deck/1/bk/01', 'deck/1/bk/033', 'deck/1/bk/100', 'erz/4/bk/1', 'erz/4/bk/9', 'erz/8/bk/1', 'bus/1/bk/1']) {   // negative controls
    assert.equal((await postJson(url, '/regler', { pfad, nach: 0.5 }, CYPHER)).code, 400, pfad);
  }
  s.zu();
});

// S14: graph knobs of the send returns fx/3, fx/4 travel through /regler as global controls
test('S14 /regler: fx/3/bk/2 reaches the kernel as /k/teil, lage shows it once it differs from 0.5; fx/5, fx/2, bk/65 are 400, bk/9, bk/32 and bk/64 pass', async (t) => {
  const { url, log } = await stapel(t);
  const s = sse(url);
  await warte(100);
  const n0 = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').length;
  const r = await postJson(url, '/regler', { pfad: 'fx/3/bk/2', nach: 0.8, ab: 'jetzt' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.felder.pfad, 'fx/3/bk/2');
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').length, n0 + 1, 'exactly one /k/teil to the kernel');
  await warte(300);
  const l = await (await fetch(`${url}/lage`)).json();
  assert.equal(l.regler['fx/3/bk/2'], 0.8, JSON.stringify(l.regler));
  assert.ok(!('fx/3/bk/1' in l.regler), 'untouched knob stays invisible');
  for (const [pfad, w] of [['fx/3/bk/9', 0.2], ['fx/4/bk/32', 0.7], ['fx/3/bk/64', 0.4]]) assert.equal((await postJson(url, '/regler', { pfad, nach: w, ab: 'jetzt' }, CYPHER)).code, 200, pfad);
  for (const pfad of ['fx/5/bk/1', 'fx/2/bk/1', 'fx/1/bk/1', 'fx/3/bk/65', 'fx/3/bk/0']) {   // negative controls
    assert.equal((await postJson(url, '/regler', { pfad, nach: 0.5 }, CYPHER)).code, 400, pfad);
  }
  s.zu();
});

// S5r Task 4 (D10, K13): the AUTO lock of a stream also covers its graph knobs
test('S5r AUTO off on stream 2 refuses cypher on erz/2/fader (409 auto_aus, nothing to the kernel); andreas, erz/5 and AUTO on pass', async (t) => {
  const { url, log } = await stapel(t, [], { live: true });
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').length;
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 2 })).code, 200);
  const n0 = teile();
  const x = await postJson(url, '/regler', { pfad: 'erz/2/fader', nach: -6, ab: 'jetzt' }, CYPHER);
  assert.equal(x.code, 409, JSON.stringify(x.j)); assert.equal(x.j.fehler, 'auto_aus'); assert.equal(x.j.strom, 2);
  assert.equal(teile(), n0, 'nothing reached the kernel');
  // negative controls
  assert.equal((await postJson(url, '/regler', { pfad: 'erz/2/fader', nach: -6, ab: 'jetzt' })).code, 200, 'andreas may');
  assert.equal((await postJson(url, '/regler', { pfad: 'erz/5/fader', nach: -6, ab: 'jetzt' }, CYPHER)).code, 200, 'erz/5 has no stream lock');
  assert.equal((await postJson(url, '/regler', { pfad: 'erz/3/fader', nach: -6, ab: 'jetzt' }, CYPHER)).code, 200, 'stream 3 AUTO on');
  assert.equal((await postJson(url, '/strudel/autonom', { an: true, strom: 2 })).code, 200);
  assert.equal((await postJson(url, '/regler', { pfad: 'erz/2/fader', nach: -6, ab: 'jetzt' }, CYPHER)).code, 200, 'AUTO back on');
});

// SOUND COLOR FX (2026-10-11): color/art und color/param über /regler, Art sofort (Politik 1 wie keylock), in /lage nur
// abweichend von der Vorgabe (0 FILTER, 0,5)
test('Color FX: color/art und color/param setzen, Art mit Politik 1, Lage nur abweichend', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url);
  await warte(100);
  const l0 = await (await fetch(`${url}/lage`)).json();
  for (const p of ['color/art', 'color/param']) assert.ok(!(p in l0.regler), `Vorgabe: ${p} nicht in der Lage`);
  const ra = await postJson(url, '/regler', { pfad: 'color/art', nach: 1, ab: 'jetzt' }, CYPHER);
  assert.equal(ra.code, 200, JSON.stringify(ra.j));
  assert.equal(ra.j.felder.politik, 1);
  const rp = await postJson(url, '/regler', { pfad: 'color/param', nach: 0.8, ab: 'jetzt' }, CYPHER);
  assert.equal(rp.code, 200, JSON.stringify(rp.j));
  assert.equal(rp.j.felder.politik, 0);
  await warte(300);
  const l = await (await fetch(`${url}/lage`)).json();
  assert.equal(l.regler['color/art'], 1, JSON.stringify(l.regler));
  assert.equal(l.regler['color/param'], 0.8);
  assert.equal((await postJson(url, '/regler', { pfad: 'color/kaputt', nach: 1 }, CYPHER)).code, 400);   // Negativkontrolle
  for (const [pfad, nach] of [['color/art', 0], ['color/param', 0.5]])
    assert.equal((await postJson(url, '/regler', { pfad, nach, ab: 'jetzt' }, CYPHER)).code, 200);
  await warte(300);
  const l2 = await (await fetch(`${url}/lage`)).json();
  for (const p of ['color/art', 'color/param']) assert.ok(!(p in l2.regler), `zurück: ${p} weg`);
  s.zu();
});

// K2 Review: /lage zeigt duck/tiefe, duck/release, fx/2/rueckweg und <kanal>/send/2, wenn sie von der Vorgabe abweichen
// (Vorgaben 0, 200, 0, −200), sonst nicht: Cypher sieht, ob Duck, Hall-Send und Rückweg an sind
test('K2 Lage: duck/tiefe, duck/release, fx/2/rueckweg und pad/1/send/2 erscheinen nur abweichend von der Vorgabe', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url);
  await warte(100);
  const l0 = await (await fetch(`${url}/lage`)).json();
  for (const p of ['duck/tiefe', 'duck/release', 'fx/2/rueckweg', 'pad/1/send/2'])
    assert.ok(!(p in l0.regler), `Vorgabe: ${p} nicht in der Lage`);
  for (const [pfad, nach] of [['duck/tiefe', -9], ['pad/1/send/2', -9], ['duck/release', 400], ['fx/2/rueckweg', -6]]) {
    const r = await postJson(url, '/regler', { pfad, nach }, CYPHER);
    assert.equal(r.code, 200, JSON.stringify(r.j));
  }
  await warte(300);
  const l = await (await fetch(`${url}/lage`)).json();
  assert.equal(l.regler['duck/tiefe'], -9, JSON.stringify(l.regler));
  assert.equal(l.regler['pad/1/send/2'], -9);
  assert.equal(l.regler['duck/release'], 400);
  assert.equal(l.regler['fx/2/rueckweg'], -6);
  // zurück auf die Vorgabe: wieder unsichtbar
  for (const [pfad, nach] of [['duck/tiefe', 0], ['pad/1/send/2', -200], ['duck/release', 200], ['fx/2/rueckweg', 0]])
    assert.equal((await postJson(url, '/regler', { pfad, nach }, CYPHER)).code, 200);
  await warte(300);
  const l2 = await (await fetch(`${url}/lage`)).json();
  for (const p of ['duck/tiefe', 'duck/release', 'fx/2/rueckweg', 'pad/1/send/2']) assert.ok(!(p in l2.regler), `zurück: ${p} weg`);
  s.zu();
});

// Befund 4: „Fassung fehlt im Index“ und „Audiodatei fehlt“ sind zwei Fälle mit zwei Codes und zwei englischen Texten
test('Befund 4: nicht im Index und fehlende Audiodatei: eigene Codes, eigene englische Meldungen', async (t) => {
  const tmpB = fs.mkdtempSync(path.join(TMP, 'djk60n-b4-'));
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

// Befund 5: der Kern verwirft /test/hand außerhalb des Prüfmodus (§19.0, net.cpp: unbekannte_adresse). Die Seite
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
  assert.equal((await postJson(url, '/griff', { pfad: 'deck/5/fader', u: 0.5 })).code, 400);
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
  // So antwortet der echte Kern ohne Prüfmodus (net.cpp paket(): an alle Abonnenten)
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
  const loops = fs.mkdtempSync(path.join(TMP, 'djk-loops-'));
  const kits = fs.mkdtempSync(path.join(TMP, 'djk-kits-'));
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
  assert.ok(fs.existsSync(path.join(kits, `rec-${TEST_INSTANZ}/kit.json`)), `Server mit Testinstanz ${TEST_INSTANZ} (I08 Nachzug R2, m4): Zusatz-Kit rec-<instanz>, nicht rec des Betriebs`);
  assert.ok(!fs.existsSync(path.join(kits, 'rec')), 'das Kit des Betriebs (rec) entsteht nicht');
  assert.equal((await postJson(url, '/loop', { aktion: 'kit', name: 'gibts-nicht' })).code, 400);
  assert.equal((await postJson(url, '/loop', { aktion: 'kit', name: 'c-1', klang: 'bd' })).code, 400);
  assert.equal(o.gesendet, vorher, 'kit schickt nichts an den Kern');
});

test('/welle (Plan Oberfläche T2): Loop-Welle gerechnet, zweiter Abruf aus dem Cache, falscher Name 400', async (t) => {
  const loops = fs.mkdtempSync(path.join(TMP, 'djk-loops-'));
  const cache = fs.mkdtempSync(path.join(TMP, 'djk-welle-'));
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


test('/strudel (Plan 2): lesen, schreiben mit von andreas, Fehler mit Zeile, AUTO-Schalter', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { url } = await stapel(t, [], { musterOrdner: d, live: true });
  assert.deepEqual(await (await fetch(`${url}/strudel`)).json(), { text: '', von: null, zeit: null, bezeichnung: null, status: null, autonom: true });
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
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { url } = await stapel(t, [], { musterOrdner: d, live: true });
  assert.equal((await post(url, '/strudel', { text: 's("bd")' })).code, 415);
  assert.equal((await post(url, '/strudel/autonom', { an: false })).code, 415);
  assert.equal((await postJson(url, '/strudel', { text: 's("bd")' }, { origin: 'https://boese.example' })).code, 403);
  assert.equal((await postJson(url, '/strudel/autonom', { an: false }, { origin: 'http://127.0.0.1:1' })).code, 403);
  assert.deepEqual(fs.readdirSync(d), [], 'Abweisungen schreiben nichts');
  assert.equal((await postJson(url, '/strudel', { text: 's("bd")' }, { origin: url })).code, 200);   // Negativ-Kontrolle
});

test('/strudel (Plan-Review M3): Muster läuft ohne Schreibrecht und mit Zeitlimit, Server bleibt bedienbar', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const opfer = path.join(fs.mkdtempSync(path.join(TMP, 'djk-opfer-')), 'geschrieben');
  const { url } = await stapel(t, [], { musterOrdner: d, live: true });
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
  const eltern = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const d = path.join(eltern, 'erzeuger');   // F4: existiert noch nicht
  const { url } = await stapel(t, [], { musterOrdner: d, live: true });
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
  assert.equal((await postJson(url, '/deck/sprung', { deck: 5, ziel: 1, raster: 1 })).code, 400);
  assert.equal((await postJson(url, '/deck/sprung', { deck: 1, ziel: 1, raster: 3 })).code, 400);
  assert.equal((await post(url, '/deck/sprung', { deck: 1, ziel: 1, raster: 1 })).code, 415);
});

test('/deck/scrub (Hörbares Ziehen): Griff, Zug, Los gehen als /k/deck/scrub an den Kern, das stehende Deck folgt der Hand und bleibt dort', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const gesendet = [];
  const sende = o.kern.sende.bind(o.kern);
  o.kern.sende = (adr, f) => { gesendet.push({ adr, ...f }); return sende(adr, f); };
  const q0 = o.stand.decks['1'].quell_beat;
  assert.equal((await postJson(url, '/deck/scrub', { deck: 1, phase: 1, delta: 0 })).code, 200);
  assert.equal((await postJson(url, '/deck/scrub', { deck: 1, phase: 2, delta: 2.5 })).code, 200);
  const z = await zustand(o, (x) => Math.abs(x.quell_beat - (q0 + 2.5)) < 1e-6);
  assert.ok(Math.abs(z.quell_beat - (q0 + 2.5)) < 1e-6, `quell_beat ${z.quell_beat}, erwartet ${q0 + 2.5}`);   // folgt der Hand
  assert.equal((await postJson(url, '/deck/scrub', { deck: 1, phase: 0, delta: 3 })).code, 200);
  const z2 = await zustand(o, (x) => Math.abs(x.quell_beat - (q0 + 3)) < 1e-6);
  assert.ok(Math.abs(z2.quell_beat - (q0 + 3)) < 1e-6);   // Los: der Kopf bleibt an der letzten Stelle
  const s3 = gesendet.filter((g) => g.adr === '/k/deck/scrub');
  assert.deepEqual(s3.map((g) => [g.deck, g.phase, g.delta_beats, g.quelle]), [[1, 1, 0, 'andreas'], [1, 2, 2.5, 'andreas'], [1, 0, 3, 'andreas']]);
  // Ablehnungen: nichts geht an den Kern
  const n0 = gesendet.length;
  assert.equal((await postJson(url, '/deck/scrub', { deck: 5, phase: 1, delta: 0 })).code, 400);
  assert.equal((await postJson(url, '/deck/scrub', { deck: 1, phase: 3, delta: 0 })).code, 400);
  assert.equal((await postJson(url, '/deck/scrub', { deck: 1, phase: 1, delta: 'x' })).code, 400);
  assert.equal((await postJson(url, '/deck/scrub', { deck: 1, phase: 1, delta: 1e9 })).code, 400);
  assert.equal((await postJson(url, '/deck/scrub', { deck: 1, phase: 1 })).code, 400);
  assert.equal((await post(url, '/deck/scrub', { deck: 1, phase: 1, delta: 0 })).code, 415);
  assert.equal(gesendet.length, n0);
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
  for (const falsch of [{ einheit: 3 }, { art: 13 }, { art: 2.5 }, { beats: 3 }, { wet: 1.2 }, { param1: -0.1 }, { param2: 1.1 }, { param3: -0.1 }, { an: 'ja' }]) {
    const x = await postJson(url, '/fx', { ...basis, ...falsch });
    assert.equal(x.code, 400, JSON.stringify(falsch));
  }
  assert.equal((await post(url, '/fx', basis)).code, 415);
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx').length, n0 + 1, 'Abweisungen senden nichts');
  for (const art of [5, 6, 7, 8, 9, 10, 11, 12]) {   // REVERB bis SPIRAL (2026-10-11)
    const rv = await postJson(url, '/fx', { ...basis, art, beats: 2 });
    assert.equal(rv.code, 200, JSON.stringify(rv.j));
    assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx').at(-1).felder.art, art);
  }
  assert.deepEqual(await (await fetch(`${url}/fx`)).json(), [null, null], 'GET /fx ohne /e/fx: [null, null]');
});

test('/fx/zuweisung: gültig → /k/fx/zuweisung, falsche Werte 400', async (t) => {
  const { url, log } = await stapel(t);
  const n0 = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx/zuweisung').length;
  const r = await postJson(url, '/fx/zuweisung', { einheit: 1, kanal: 'deck/1', an: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const f = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx/zuweisung').slice(n0);
  assert.deepEqual({ ...f[0].felder, id: 0 }, { id: 0, quelle: 'andreas', einheit: 1, kanal: 'deck/1', an: 1 });
  for (const falsch of [{ einheit: 0 }, { einheit: 4 }, { kanal: 'erz/5' }, { kanal: 'bus/1' }, { an: 1 }]) {
    const x = await postJson(url, '/fx/zuweisung', { einheit: 2, kanal: 'pad/1', an: false, ...falsch });
    assert.equal(x.code, 400, JSON.stringify(falsch));
  }
  assert.equal((await postJson(url, '/fx/zuweisung', { einheit: 2, kanal: 'master', an: true })).code, 200);   // Master hat eigene Tasten
  assert.equal((await postJson(url, '/fx/zuweisung', { einheit: 2, kanal: 'deck/3', an: true })).code, 200);   // deck/3 and deck/4 take FX1 and FX2
  assert.equal((await postJson(url, '/fx/zuweisung', { einheit: 1, kanal: 'deck/4', an: true })).code, 200);
});

test('/fx/zuweisung unit 3 (FX3, insert on fx/3): every source channel, never master; the core report lands in the third slot of the state', async (t) => {
  const { o, url, log } = await stapel(t);
  const n0 = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx/zuweisung').length;
  for (const kanal of ['deck/1', 'deck/4', 'erz/1', 'erz/8', 'pad/2']) {
    const r = await postJson(url, '/fx/zuweisung', { einheit: 3, kanal, an: true });
    assert.equal(r.code, 200, `${kanal} ${JSON.stringify(r.j)}`);
  }
  const f = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx/zuweisung').slice(n0);
  assert.deepEqual({ ...f[1].felder, id: 0 }, { id: 0, quelle: 'andreas', einheit: 3, kanal: 'deck/4', an: 1 });
  for (const falsch of [{ kanal: 'master' }, { kanal: 'bus/1' }, { kanal: 'erz/9' }, { an: 1 }]) {
    const x = await postJson(url, '/fx/zuweisung', { einheit: 3, kanal: 'deck/1', an: false, ...falsch });
    assert.equal(x.code, 400, JSON.stringify(falsch));
  }
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx/zuweisung').length, n0 + 5, 'rejections send nothing');
  const lies = async () => (await fetch(`${url}/fx/zuweisung`)).json();
  let g = await lies();
  for (let i = 0; i < 60 && g[2]['pad/2'] !== true; i++) { await warte(20); g = await lies(); }   // the fake core reports each assignment back
  assert.equal(g.length, 3);
  assert.deepEqual(g[2], { 'deck/1': true, 'pad/2': true }, 'the core keeps the container sources only (deck/4, erz/1 and erz/8 are forwarded and not reported back)');
  assert.deepEqual([g[0], g[1]], [{}, {}], 'FX1 and FX2 untouched');
  o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 3, kanal: 'deck/4', an: 0 } });
  g = await lies();
  assert.equal(g[2]['deck/4'], false);
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 99, sample: 0 } });
  assert.deepEqual(await (await fetch(`${url}/fx/zuweisung`)).json(), [{}, {}, {}], 'a new kern starts with every unit off');
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
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
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
