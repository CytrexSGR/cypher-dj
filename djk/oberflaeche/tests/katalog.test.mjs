// Katalog-Leser (Plan 2026-10-10-mediathek-browser, Task 1.3): Seite, Zählung, Sortierung, Fehlerfälle
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { leseWelle } from '../oeffentlich/welle.js';
import { Katalog, KatalogFehler, SORT_VORGABE, camelotNachbarn } from '../katalog.ts';
import { standardKatalog, baueKatalog } from './hilfen/katalog.mjs';

const namen = (r) => r.zeilen.map((z) => z.titel ?? z.name);

test('Katalog: Seite je Typ, gesamt genau, Vorgabe-Sortierung', (t) => {
  const k = new Katalog(standardKatalog(t).datei);
  const tr = k.seite('track', {}, SORT_VORGABE.track, false, 0, 100);
  assert.deepEqual(namen(tr), ['Acid Rain', 'House Thing', 'Tech Wolf']);
  assert.equal(tr.gesamt, 3);
  assert.equal(tr.gebaut_am, '2026-10-10T17:00:00+00:00');
  assert.equal(k.seite('loop', {}, 'name', false, 0, 100).gesamt, 3);
  assert.deepEqual(namen(k.seite('oneshot', {}, 'name', false, 0, 100)), ['Kick 01', 'Kick 02', 'Riser', 'Snare Tight']);
});

test('Katalog: Sortierung auf/ab, NULL zuletzt, Seiten', (t) => {
  const k = new Katalog(standardKatalog(t).datei);
  assert.deepEqual(namen(k.seite('track', {}, 'bpm', true, 0, 100)), ['Acid Rain', 'Tech Wolf', 'House Thing']);
  assert.deepEqual(namen(k.seite('loop', {}, 'bpm', false, 0, 100)), ['DT_126_Groove', 'VEC_128_Bass', 'Break'], 'ohne BPM zuletzt');
  assert.deepEqual(namen(k.seite('loop', {}, 'bpm', true, 0, 100)), ['VEC_128_Bass', 'DT_126_Groove', 'Break'], 'auch absteigend zuletzt');
  const s0 = k.seite('oneshot', {}, 'dauer', false, 0, 2), s1 = k.seite('oneshot', {}, 'dauer', false, 1, 2);
  assert.deepEqual([...namen(s0), ...namen(s1)], ['Snare Tight', 'Kick 01', 'Kick 02', 'Riser']);
  assert.equal(s1.gesamt, 4, 'gesamt unabhängig von der Seite');
  assert.deepEqual(namen(k.seite('oneshot', {}, 'dauer', false, 5, 2)), [], 'hinter dem Ende: leer, kein Fehler');
});

test('Katalog: Fehlerfälle — Datei fehlt 503, Schema fremd 503, Sortierung unbekannt 400', (t) => {
  assert.throws(() => new Katalog('/nicht/da/katalog.sqlite').seite('track', {}, 'titel', false, 0, 10), (e) => e instanceof KatalogFehler && e.code === 503 && e.fehler === 'katalog_fehlt');
  const dir = fs.mkdtempSync(path.join(path.dirname(standardKatalog(t).datei), 'alt-'));
  const alt = baueKatalog(dir, [], { schema: '0' });
  assert.throws(() => new Katalog(alt).seite('track', {}, 'titel', false, 0, 10), (e) => e.code === 503 && e.fehler === 'katalog_schema');
  const k = new Katalog(standardKatalog(t).datei);
  assert.throws(() => k.seite('track', {}, 'pack', false, 0, 10), (e) => e.code === 400 && e.fehler === 'sort_ungueltig', 'pack ist keine Track-Spalte');
  assert.throws(() => k.seite('track', {}, 'titel; DROP', false, 0, 10), (e) => e.code === 400);
});

test('Katalog: eintrag(sha) findet die Zeile, unbekannt null, Unsinn 400', (t) => {
  const k = new Katalog(standardKatalog(t).datei);
  const z = k.seite('oneshot', {}, 'name', false, 0, 1).zeilen[0];
  assert.equal(k.eintrag(z.sha).name, 'Kick 01');
  assert.equal(k.eintrag('0'.repeat(64)), null);
  assert.throws(() => k.eintrag('abc'), (e) => e.code === 400 && e.fehler === 'sha_ungueltig');
});
test('Katalog.baum: Ordner mit Zählern je Typ, Facetten je Typ (leer als „")', (t) => {
  const kat = standardKatalog(t);
  const k = new Katalog(kat.datei);
  const b = k.baum('oneshot');
  assert.deepEqual(b.ordner.map((o) => [o.pfad.slice(kat.daten.length), o.n]), [['/Drums/Kick', 2], ['/Drums/Snare', 1], ['/FX', 1]]);
  assert.deepEqual(b.facetten.instrument, [{ wert: 'kick', n: 2 }, { wert: '', n: 1 }, { wert: 'snare', n: 1 }]);
  assert.deepEqual(b.facetten.pack.map((x) => x.wert), ['Battery 4', '', 'Maschine 2']);
  assert.deepEqual(Object.keys(k.baum('track').facetten), ['genre']);
  assert.deepEqual(Object.keys(k.baum('loop').facetten), ['pack']);
});

test('Katalog: Ordner-Filter schließt Unterordner ein, Nachbarn mit gleichem Präfix nicht; Facette filtert, leer = NULL', (t) => {
  const kat = standardKatalog(t);
  const k = new Katalog(kat.datei);
  const n = (f) => k.seite('oneshot', f, 'name', false, 0, 100).zeilen.map((z) => z.name);
  assert.deepEqual(n({ ordner: `${kat.daten}/Drums` }), ['Kick 01', 'Kick 02', 'Snare Tight']);
  assert.deepEqual(n({ ordner: `${kat.daten}/Drums/Kick` }), ['Kick 01', 'Kick 02']);
  assert.deepEqual(n({ ordner: `${kat.daten}/Dru` }), [], 'kein Präfix-Treffer mitten im Namen');
  assert.deepEqual(n({ ordner: `${kat.daten}/Drums%` }), [], '% ist kein Platzhalter');
  assert.deepEqual(n({ facette: { feld: 'instrument', wert: 'kick' } }), ['Kick 01', 'Kick 02']);
  assert.deepEqual(n({ facette: { feld: 'instrument', wert: '' } }), ['Riser']);
  assert.throws(() => n({ facette: { feld: 'genre', wert: 'x' } }), (e) => e.code === 400 && e.fehler === 'facette_ungueltig');
});

import { stapel, hole } from './hilfen/mediathek.mjs';
import { baueBestand } from './hilfen/bestand.mjs';

test('GET /stoebern: Typ, Sortierung, Seite; Tracks mit Status, Loops/Samples mit pfad_da und nur_live', async (t) => {
  const kat = standardKatalog(t);
  const s = await stapel(t, { katalog: kat.datei });
  const tr = await hole(s.url, '/stoebern?typ=track');
  assert.equal(tr.code, 200);
  assert.deepEqual(tr.j.treffer.map((x) => x.titel), ['Acid Rain', 'House Thing', 'Tech Wolf']);
  assert.equal(tr.j.gesamt, 3); assert.equal(tr.j.sort, 'titel'); assert.equal(tr.j.seite, 0); assert.equal(tr.j.limit, 100);
  const haus = tr.j.treffer.find((x) => x.titel === 'House Thing'), wolf = tr.j.treffer.find((x) => x.titel === 'Tech Wolf');
  assert.equal(haus.status, 'missing'); assert.equal(haus.pfad_da, false);
  assert.equal(wolf.status, 'prepare'); assert.equal(wolf.pfad_da, true); assert.equal(wolf.material_id, wolf.sha.slice(0, 16));
  assert.equal('shas' in wolf || 'pfad' in wolf || 'alle' in wolf, false, 'Pfad, Werk-Liste und Volltext bleiben im Server');
  const lo = await hole(s.url, '/stoebern?typ=loop&sort=bpm&richtung=ab');
  assert.deepEqual(lo.j.treffer.map((x) => x.name), ['VEC_128_Bass', 'DT_126_Groove', 'Break']);
  assert.equal(lo.j.treffer[2].nur_live, true); assert.equal(lo.j.treffer[0].nur_live, false);
  const sa = await hole(s.url, '/stoebern?typ=oneshot&limit=2&seite=1');
  assert.deepEqual(sa.j.treffer.map((x) => x.name), ['Riser', 'Snare Tight']); assert.equal(sa.j.gesamt, 4);
  assert.equal((await hole(s.url, '/stoebern?typ=midi')).code, 400);
  assert.equal((await hole(s.url, '/stoebern?typ=track&sort=pack')).code, 400);
  assert.equal((await hole(s.url, '/stoebern?typ=oneshot&limit=999')).j.limit, 200, 'limit gekappt');
});

test('GET /stoebern: Track im Bestand → ready mit laden_mid (auch über ein Geschwister-Objekt des Werks)', async (t) => {
  const { ksha } = await import('./hilfen/katalog.mjs');
  const dir = fs.mkdtempSync(path.join(path.dirname(standardKatalog(t).datei), 'w-'));
  const geschw = ksha(99);
  const datei = baueKatalog(dir, [{ n: 1, typ: 'track', titel: 'Wolf', shas: `${ksha(1)} ${geschw}`, pfad: '/nicht/da.mp3' }]);
  const bestand = baueBestand(path.join(dir, 'bestand'), [{ material_id: geschw.slice(0, 16), titel: 'Wolf' }]);
  const s = await stapel(t, { katalog: datei, bestand });
  const [w] = (await hole(s.url, '/stoebern?typ=track')).j.treffer;
  assert.equal(w.status, 'ready'); assert.equal(w.laden_mid, geschw.slice(0, 16));
});

test('GET /stoebern: Katalog fehlt → 503 katalog_fehlt, der Rest lebt', async (t) => {
  const s = await stapel(t, { katalog: '/nicht/da/katalog.sqlite' });
  assert.deepEqual(await hole(s.url, '/stoebern?typ=track'), { code: 503, j: { fehler: 'katalog_fehlt' } });
  assert.equal((await hole(s.url, '/bestand')).code, 200);
});

// ---- Code-Review S1 (QUALITY-REVIEW.md) ----
test('Katalog: Key-Sortierung numerisch 1A, 1B, 2A … 12B (Review MINOR 2), ohne Key zuletzt', (t) => {
  const dir = fs.mkdtempSync(path.join(path.dirname(standardKatalog(t).datei), 'k-'));
  const keys = ['10A', '2A', '12B', '1A', '9B', '1B', null];
  const k = new Katalog(baueKatalog(dir, keys.map((c, i) => ({ n: 100 + i, typ: 'track', titel: `T${c}`, camelot: c, pfad: null }))));
  assert.deepEqual(namen(k.seite('track', {}, 'camelot', false, 0, 100)), ['T1A', 'T1B', 'T2A', 'T9B', 'T10A', 'T12B', 'Tnull']);
  assert.deepEqual(namen(k.seite('track', {}, 'camelot', true, 0, 100)), ['T12B', 'T10A', 'T9B', 'T2A', 'T1B', 'T1A', 'Tnull']);
});

test('GET /stoebern: seite absurd groß → 400, kein 500 (Review MINOR 5); große aber sichere Seite → 200 leer', async (t) => {
  const s = await stapel(t, { katalog: standardKatalog(t).datei });
  assert.deepEqual(await hole(s.url, '/stoebern?typ=oneshot&seite=1e300'), { code: 400, j: { fehler: 'seite_ungueltig' } });
  const r = await hole(s.url, '/stoebern?typ=oneshot&seite=99999');
  assert.equal(r.code, 200); assert.deepEqual(r.j.treffer, []);
});

test('GET /stoebern/baum und Filter ordner/feld/wert in /stoebern', async (t) => {
  const kat = standardKatalog(t);
  const s = await stapel(t, { katalog: kat.datei });
  const b = await hole(s.url, '/stoebern/baum?typ=loop');
  assert.equal(b.code, 200);
  assert.equal(b.j.ordner.length, 3); assert.deepEqual(b.j.facetten.pack.map((x) => x.wert).sort(), ['Deep Tech', 'Live Pack', 'Vengeance']);
  const o = await hole(s.url, `/stoebern?typ=oneshot&ordner=${encodeURIComponent(kat.daten + '/Drums')}`);
  assert.equal(o.j.gesamt, 3);
  const f = await hole(s.url, '/stoebern?typ=oneshot&feld=instrument&wert=kick');
  assert.equal(f.j.gesamt, 2);
  assert.equal((await hole(s.url, '/stoebern?typ=oneshot&feld=genre&wert=x')).code, 400);
  assert.equal((await hole(s.url, '/stoebern/baum?typ=x')).code, 400);
});

// ---------- S3 Task 3.1: Filter Key (+Nachbarn), BPM, Energie ----------
test('camelotNachbarn: gleich, ±1 mit Umlauf, Paralleltonart', () => {
  assert.deepEqual(camelotNachbarn('8a'), ['8A', '7A', '9A', '8B']);
  assert.deepEqual(camelotNachbarn('12B'), ['12B', '11B', '1B', '12A']);
  assert.deepEqual(camelotNachbarn('1A'), ['1A', '12A', '2A', '1B']);
  assert.throws(() => camelotNachbarn('13A'), (e) => e.code === 400 && e.fehler === 'camelot_ungueltig');
});

test('Katalog: Key exakt oder mit Nachbarn, BPM-Bereich, Energie-Klasse (0 ≤5, 1 6–7, 2 >7), verknüpft', (t) => {
  const k = new Katalog(standardKatalog(t).datei);
  const n = (f) => k.seite('track', f, 'titel', false, 0, 100).zeilen.map((z) => z.titel);
  assert.deepEqual(n({ camelot: '8a' }), ['Tech Wolf']);
  assert.deepEqual(n({ camelot: '8A', nachbarn: true }), ['Acid Rain', 'Tech Wolf'], '9A ist Nachbar');
  assert.deepEqual(n({ bpm: [120, 130] }), ['House Thing', 'Tech Wolf']);
  assert.deepEqual(n({ energie: 0 }), ['House Thing']); assert.deepEqual(n({ energie: 1 }), ['Tech Wolf']); assert.deepEqual(n({ energie: 2 }), ['Acid Rain']);
  assert.deepEqual(n({ camelot: '8A', nachbarn: true, bpm: [125, 135] }), ['Tech Wolf']);
  assert.deepEqual(k.seite('loop', { bpm: [127, 129] }, 'name', false, 0, 100).zeilen.map((z) => z.name), ['VEC_128_Bass'], 'BPM auch für Loops');
});

test('GET /stoebern: camelot, nachbarn=1, bpm, energie aus der URL; Unsinn 400', async (t) => {
  const s = await stapel(t, { katalog: standardKatalog(t).datei });
  assert.equal((await hole(s.url, '/stoebern?typ=track&camelot=8A&nachbarn=1&bpm=125-145')).j.gesamt, 2);
  assert.equal((await hole(s.url, '/stoebern?typ=track&energie=2')).j.gesamt, 1);
  for (const q of ['camelot=13A', 'bpm=abc', 'energie=3']) assert.equal((await hole(s.url, `/stoebern?typ=track&${q}`)).code, 400, q);
});

// ---------- S2-Review B1/B2: Ordner-Filter exakt in der Schreibweise, NULL und '' einheitlich ----------
test('Katalog: Ordner-Filter unterscheidet Groß-/Kleinschreibung wie der Baum (Review B1)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-katalog-case-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const k = new Katalog(baueKatalog(dir, [
    { n: 1, typ: 'oneshot', pfad: '/x/Drums/a.wav' }, { n: 2, typ: 'oneshot', pfad: '/x/drums/sub/b.wav' }, { n: 3, typ: 'oneshot', pfad: '/x/Drums/sub/c.wav' },
  ]));
  const n = (o) => k.seite('oneshot', { ordner: o }, 'name', false, 0, 100).zeilen.map((z) => z.name);
  const baum = Object.fromEntries(k.baum('oneshot').ordner.map((o) => [o.pfad, o.n]));
  assert.deepEqual(baum, { '/x/Drums': 1, '/x/drums/sub': 1, '/x/Drums/sub': 1 });
  assert.deepEqual(n('/x/Drums'), ['a', 'c'], 'nur /x/Drums und sein Unterordner, nicht /x/drums/sub');
  assert.deepEqual(n('/x/drums'), ['b']);
  assert.deepEqual(n('/x/DRUMS'), [], 'es gibt keinen Ordner in dieser Schreibweise');
  assert.deepEqual(n('/x/Drums/sub'), ['c']);
});

test("Katalog: NULL, '' und Leerraum sind im Baum und im Filter derselbe Wert (Review B2)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-katalog-null-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const k = new Katalog(baueKatalog(dir, [
    { n: 1, typ: 'oneshot', instrument: 'kick', pfad: '/x/a.wav' }, { n: 2, typ: 'oneshot', instrument: null, pfad: '/x/b.wav' },
    { n: 3, typ: 'oneshot', instrument: '', pfad: '/x/c.wav' }, { n: 4, typ: 'oneshot', instrument: '  ', pfad: '/x/d.wav' },
  ]));
  assert.deepEqual(k.baum('oneshot').facetten.instrument, [{ wert: '', n: 3 }, { wert: 'kick', n: 1 }], 'ein Eintrag „leer“, nicht drei');
  assert.deepEqual(k.seite('oneshot', { facette: { feld: 'instrument', wert: '' } }, 'name', false, 0, 100).zeilen.map((z) => z.name), ['b', 'c', 'd']);
  assert.deepEqual(k.seite('oneshot', { facette: { feld: 'instrument', wert: 'kick' } }, 'name', false, 0, 100).zeilen.map((z) => z.name), ['a']);
});

// S3-Review B3: die BPM-Grenzen gehören dazu (BETWEEN). Eine Mutation auf > / < muss diesen Test rot machen.
test('Katalog: BPM-Bereich ist inklusiv an beiden Grenzen, ein einzelner Wert trifft genau ihn', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-bpm-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const k = new Katalog(baueKatalog(dir, [123.99, 124, 127, 130, 130.01].map((bpm, i) => ({ n: 100 + i, typ: 'track', werk_id: 100 + i, titel: `T${bpm}`, bpm }))));
  const n = (f) => k.seite('track', f, 'bpm', false, 0, 100).zeilen.map((z) => z.titel);
  assert.deepEqual(n({ bpm: [124, 130] }), ['T124', 'T127', 'T130'], 'beide Grenzen drin, 123.99 und 130.01 draußen');
  assert.deepEqual(n({ bpm: [127, 127] }), ['T127'], 'einzelner Wert');
  assert.deepEqual(n({ bpm: [124.0001, 129.9999] }), ['T127'], 'knapp innerhalb: Grenzen sind nicht aufgeweicht');
});

// S3-Review B1: ein Filter, den der Typ nicht hat, wird mit 400 abgelehnt, nie still ignoriert (passt zur Filterleiste je Typ)
test('GET /stoebern: nicht anwendbare Filter je Typ → 400 filter_nicht_anwendbar, anwendbare gehen', async (t) => {
  const s = await stapel(t, { katalog: standardKatalog(t).datei });
  const code = async (q) => { const r = await hole(s.url, `/stoebern?${q}`); return [r.code, r.j.fehler]; };
  for (const q of ['typ=oneshot&bpm=120', 'typ=oneshot&camelot=8A', 'typ=oneshot&energie=1', 'typ=loop&energie=1', 'typ=strudel&camelot=8A', 'typ=strudel&energie=1'])
    assert.deepEqual(await code(q), [400, 'filter_nicht_anwendbar'], q);
  for (const q of ['typ=loop&bpm=127-129', 'typ=loop&camelot=8A&nachbarn=1', 'typ=track&energie=2&camelot=8A&bpm=120-140', 'typ=oneshot&feld=instrument&wert=kick', 'typ=strudel&bpm=120-150'])
    assert.equal((await code(q))[0], 200, `Negativkontrolle: ${q}`);
  assert.equal((await hole(s.url, '/stoebern?typ=oneshot&bpm=&camelot=&energie=')).code, 200, 'leere Werte sind kein Filter');
});

test('Katalog: Text über FTS (Präfix, Feld, Ordner-LIKE), verknüpft mit Filtern und Sortierung', (t) => {
  const kat = standardKatalog(t);
  const k = new Katalog(kat.datei);
  const n = (typ, text, f = {}) => k.seite(typ, { ...f, text }, typ === 'track' ? 'titel' : 'name', false, 0, 100).zeilen.map((z) => z.titel ?? z.name);
  assert.deepEqual(n('oneshot', 'kick'), ['Kick 01', 'Kick 02'], 'Name');
  assert.deepEqual(n('oneshot', 'batt'), ['Kick 01', 'Kick 02'], 'Pack, Präfix');
  assert.deepEqual(n('oneshot', 'snare'), ['Snare Tight'], 'Ordner und Instrument');
  assert.deepEqual(n('track', 'label:drum'), ['Tech Wolf']);
  assert.deepEqual(n('track', 'artist:gamma'), ['Acid Rain']);
  assert.deepEqual(n('track', 'folder:elektro'), ['Acid Rain'], 'Ordner per LIKE, ohne Groß/Klein');
  assert.deepEqual(n('track', 'techno', { bpm: [130, 150] }), ['Acid Rain'], 'Text + Filter');
  assert.deepEqual(n('loop', 'kick'), [], 'Typ bleibt Filter');
  assert.equal(k.seite('oneshot', { text: 'kick' }, 'name', false, 0, 100).gesamt, 2, 'gesamt mit Text');
  assert.deepEqual(n('oneshot', 'zzz'), []);
  assert.deepEqual(n('track', 'collective'), ['Tech Wolf'], 'Wort nur aus einer unterlegenen Quelle (Spalte alle)');
  assert.deepEqual(n('track', 'artist:collective'), [], 'Feld-Präfix sucht nur den Gewinner');
  assert.deepEqual(n('track', 'release:wolf catalog:dc3'), ['Tech Wolf']);
});

test('Katalog: Text-Randfälle: nur Ordner-Filter, LIKE-Zeichen im Ordner sind Text, Text ohne Inhalt ist kein Filter, Sortierung bleibt', (t) => {
  const k = new Katalog(standardKatalog(t).datei);
  const n = (typ, text, sort = 'name', ab = false) => k.seite(typ, { text }, sort, ab, 0, 100).zeilen.map((z) => z.titel ?? z.name);
  assert.deepEqual(n('oneshot', 'folder:kick'), ['Kick 01', 'Kick 02'], 'nur Ordner, kein FTS');
  assert.deepEqual(n('oneshot', 'folder:%'), [], '% ist ein Zeichen, kein Muster');
  assert.deepEqual(n('oneshot', 'folder:_ick'), [], '_ ist ein Zeichen, kein Muster');
  assert.equal(n('oneshot', ' - * ').length, 4, 'Text ohne Buchstaben filtert nichts');
  assert.deepEqual(n('oneshot', 'kick', 'name', true), ['Kick 02', 'Kick 01'], 'Sortierung ab mit Text');
  assert.deepEqual(n('oneshot', 'kick OR snare NOT x'), [], 'FTS-Wörter in der Eingabe sind Wörter, keine Syntax');
  assert.deepEqual(n('oneshot', '"kick'), ['Kick 01', 'Kick 02'], 'offenes Anführungszeichen wirft nicht');
});

test('GET /stoebern: text, Feld-Präfix und folder: gehen durch; Unsinn gibt 0 Zeilen und 200, nie 500; FTS-Syntax ist Text', async (t) => {
  const s = await stapel(t, { katalog: standardKatalog(t).datei });
  const q = (typ, text) => hole(s.url, `/stoebern?typ=${typ}&text=${encodeURIComponent(text)}`);
  let r = await q('oneshot', 'kick'); assert.deepEqual([r.code, r.j.gesamt, r.j.treffer.map((z) => z.name)], [200, 2, ['Kick 01', 'Kick 02']]);
  r = await q('track', 'label:drumcode'); assert.deepEqual([r.code, r.j.treffer.map((z) => z.titel)], [200, ['Tech Wolf']]);
  assert.equal(r.j.treffer[0].status, 'prepare', 'Status wird auch für Treffer gerechnet');
  r = await q('track', 'folder:elektro'); assert.deepEqual(r.j.treffer.map((z) => z.titel), ['Acid Rain']);
  r = await q('oneshot', 'zzqxnichtda'); assert.deepEqual([r.code, r.j.gesamt, r.j.treffer], [200, 0, []], 'Negativ: Unsinn');
  for (const text of ['"', '* AND', 'NEAR(', 'a:b:c', "'; DROP TABLE katalog; --"]) assert.equal((await q('oneshot', text)).code, 200, `Text ${text}`);
  assert.equal((await q('oneshot', '')).j.gesamt, 4, 'leerer Text ist kein Filter');
  assert.equal((await hole(s.url, '/stoebern?typ=oneshot&text=kick&feld=instrument&wert=kick')).j.gesamt, 2, 'Text + Facette');
  assert.equal((await hole(s.url, '/stoebern?typ=oneshot&text=snare&feld=instrument&wert=kick')).j.gesamt, 0, 'Text + Facette schneiden sich');
});

// ---- S5 Task 5.1: GET /stoebern/detail ----
import { sha as msha, tmpMt } from './hilfen/mediathek.mjs';
const hex = (c) => c.repeat(64);

test('GET /stoebern/detail: Eintrag + alle gültigen Angaben der Werk-Objekte mit Quelle, Gewinner markiert', async (t) => {
  const m = tmpMt(t);
  const dir = fs.mkdtempSync(path.join(m.dir, 'k-'));
  const kat = baueKatalog(dir, [{ typ: 'track', werk_id: 1, sha: msha(2), shas: `${msha(1)} ${msha(2)}`, titel: 'Tech Wolf (Edit)', pfad: '/x/wolf.mp3' }]);
  const s = await stapel(t, { mediathek: m.db, katalog: kat });
  const d = await hole(s.url, `/stoebern/detail?sha=${msha(2)}`);
  assert.equal(d.code, 200);
  assert.equal(d.j.eintrag.titel, 'Tech Wolf (Edit)');
  assert.equal(d.j.pfad, '/x/wolf.mp3', 'der volle Pfad geht im Detail an die (lokale) Seite');
  assert.equal(d.j.eintrag.pfad, undefined, 'in der Trefferzeile bleibt er draußen');
  const titel = d.j.angaben.filter((x) => x.feld === 'titel');
  assert.deepEqual(titel.map((x) => [x.wert, x.quelle, x.gilt]), [['Tech Wolf (Edit)', 'andreas', true], ['Techno Wolf', 'beatport', false]], 'Gewinner zuerst');
  assert.equal((await hole(s.url, `/stoebern/detail?sha=${hex('0')}`)).code, 404, 'unbekannt');
  assert.equal((await hole(s.url, '/stoebern/detail?sha=xyz')).code, 400, 'Unsinn');
  assert.equal((await hole(s.url, '/stoebern/detail')).code, 400, 'ohne sha');
});

test('GET /stoebern/detail?mid=: Listen-Zeilen kennen nur die material_id (16), auch die eines unterlegenen Objekts des Werks', async (t) => {
  const m = tmpMt(t);
  const dir = fs.mkdtempSync(path.join(m.dir, 'k-'));
  const kat = baueKatalog(dir, [{ typ: 'track', werk_id: 1, sha: msha(2), shas: `${msha(1)} ${msha(2)}`, titel: 'Tech Wolf (Edit)', pfad: '/x/wolf.mp3' },
    { typ: 'oneshot', sha: hex('c'), shas: hex('c'), name: '1 F1', pack: 'P', pfad: '/x/a/1 F1.wav' }]);
  const s = await stapel(t, { mediathek: m.db, katalog: kat });
  for (const sh of [msha(1), msha(2)]) {
    const d = await hole(s.url, `/stoebern/detail?mid=${sh.slice(0, 16)}`);
    assert.equal(d.j.eintrag?.titel, 'Tech Wolf (Edit)', `mid ${sh.slice(0, 4)}`);
  }
  assert.equal((await hole(s.url, `/stoebern/detail?mid=${hex('c').slice(0, 16)}`)).j.eintrag.name, '1 F1', 'ein Sample über sein sha-Präfix');
  assert.equal((await hole(s.url, `/stoebern/detail?mid=${hex('9').slice(0, 16)}`)).code, 404);
  assert.equal((await hole(s.url, '/stoebern/detail?mid=zz')).code, 400);
});

test('GET /stoebern/detail: Sample ohne Mediathek-Angaben, Ableton-geschützt und fehlende Datei — Detail kommt trotzdem, ordner/pack/pfad_da stimmen', async (t) => {
  const m = tmpMt(t);
  const dir = fs.mkdtempSync(path.join(m.dir, 'k-'));
  const da = path.join(dir, 'A/1 F1.wav'); fs.mkdirSync(path.dirname(da)); fs.writeFileSync(da, 'x');
  const kat = baueKatalog(dir, [
    { typ: 'oneshot', sha: hex('a'), shas: hex('a'), pack: 'Pack A', dauer_s: 0.5, pfad: da },
    { typ: 'oneshot', sha: hex('b'), shas: hex('b'), pack: 'Pack B', dauer_s: 0.7, pfad: path.join(dir, 'B/1 F1.aif'), schutz: 'ableton' },
    { typ: 'oneshot', sha: hex('d'), shas: hex('d'), pack: 'Pack D', pfad: path.join(dir, 'D/fehlt.wav') }]);
  const s = await stapel(t, { mediathek: m.db, katalog: kat });
  const a = (await hole(s.url, `/stoebern/detail?sha=${hex('a')}`)).j, b = (await hole(s.url, `/stoebern/detail?sha=${hex('b')}`)).j, d = (await hole(s.url, `/stoebern/detail?sha=${hex('d')}`)).j;
  assert.deepEqual([a.eintrag.name, a.eintrag.ordner, a.eintrag.pack, a.eintrag.pfad_da, a.eintrag.nur_live], ['1 F1', path.join(dir, 'A'), 'Pack A', true, false]);
  assert.deepEqual([b.eintrag.ordner, b.eintrag.pack, b.eintrag.nur_live, b.eintrag.pfad_da], [path.join(dir, 'B'), 'Pack B', true, false]);
  assert.equal(d.eintrag.pfad_da, false);
  assert.deepEqual(a.angaben, [], 'Objekt nicht in der Mediathek: keine Angaben, kein Fehler');
  assert.notEqual(a.pfad, b.pfad, 'zwei gleichnamige Samples sind am Pfad zu unterscheiden');
});

test('GET /stoebern/detail: ohne Mediathek nur der Eintrag', async (t) => {
  const kat = standardKatalog(t);
  const s = await stapel(t, { katalog: kat.datei, mediathek: '/nicht/da/mediathek.sqlite' });
  const z = new Katalog(kat.datei).seite('oneshot', {}, 'name', false, 0, 1).zeilen[0];
  const r = await hole(s.url, `/stoebern/detail?sha=${z.sha}`);
  assert.deepEqual([r.code, r.j.eintrag.name, r.j.angaben], [200, 'Kick 01', []]);
});

test('GET /stoebern/detail: ohne Katalog-Datei 503 katalog_fehlt', async (t) => {
  const s = await stapel(t, { katalog: '/nicht/da/katalog.sqlite' });
  const r = await hole(s.url, `/stoebern/detail?sha=${hex('a')}`);
  assert.deepEqual([r.code, r.j.fehler], [503, 'katalog_fehlt']);
});

// ---------- S4-Review 1, 2, 3 ----------
test('Review S4-1: NUL im Text ist 200 (Wörter getrennt), nie 500; ein SQLite-Fehler aus der Textsuche wird 400', async (t) => {
  const s = await stapel(t, { katalog: standardKatalog(t).datei });
  for (const text of ['kick\u0000snare', 'kick\u0000', 'artist:a\u0000b']) {
    const r = await hole(s.url, `/stoebern?typ=oneshot&text=${encodeURIComponent(text)}`);
    assert.equal(r.code, 200, `${JSON.stringify(text)} → ${r.code} ${JSON.stringify(r.j)}`);
  }
  assert.equal((await hole(s.url, `/stoebern?typ=oneshot&text=${encodeURIComponent('kick\u0000snare')}`)).j.gesamt, 0, 'kick UND snare: kein Sample hat beides');
  assert.equal((await hole(s.url, '/stoebern?typ=oneshot&text=kick')).j.gesamt, 2, 'Gegenprobe: kick allein trifft');
});

test('Review S4-2: Ordner-Filter vergleicht Unicode-gefaltet (klein() = NFC + toLowerCase), nicht nur ASCII', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-uni-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nfd = 'Gro\u0308nemeier';
  const k = new Katalog(baueKatalog(dir, [
    { n: 1, typ: 'oneshot', name: 'A', ordner: '/x/Ölmühle' }, { n: 2, typ: 'oneshot', name: 'B', ordner: '/x/Gr\u00f6nemeier' },
    { n: 3, typ: 'oneshot', name: 'C', ordner: '/x/Drums_50%' }, { n: 4, typ: 'oneshot', name: 'D', ordner: '/x/Drums 50' },
    { n: 5, typ: 'oneshot', name: 'E', ordner: `/x/${nfd}` }]));
  const n = (text) => k.seite('oneshot', { text }, 'name', false, 0, 100).zeilen.map((z) => z.name);
  for (const q of ['folder:Ölmühle', 'folder:ölmühle', 'folder:ÖLMÜHLE']) assert.deepEqual(n(q), ['A'], q);
  assert.deepEqual(n('folder:Grönemeier'), ['B', 'E'], 'NFC-Eingabe findet auch den zerlegt gespeicherten Ordner');
  assert.deepEqual(n(`folder:${nfd}`), ['B', 'E'], 'NFD-Eingabe findet auch den zusammengesetzten');
  assert.deepEqual(n('folder:50%'), ['C'], 'Negativkontrolle: % bleibt ein Zeichen');
  assert.deepEqual(n('folder:nichtda'), []);
});

test('Review S4-3: zu viele Suchwörter → 400 zu_viele_suchwoerter an Katalog und Route; ein Satz von 12 Wörtern geht', async (t) => {
  const s = await stapel(t, { katalog: standardKatalog(t).datei });
  const w = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const q = (typ, text) => hole(s.url, `/stoebern?typ=${typ}&text=${encodeURIComponent(text)}`);
  for (const typ of ['oneshot', 'track', 'strudel']) {
    const r = await q(typ, w(50)); assert.deepEqual([r.code, r.j.fehler], [400, 'zu_viele_suchwoerter'], `${typ} mit 50 Wörtern`);
    assert.equal((await q(typ, w(12))).code, 200, `Negativkontrolle ${typ}: 12 Wörter gehen`);
  }
  assert.equal((await q('oneshot', Array(50).fill('kick').join(' '))).j.gesamt, 2, '50 gleiche Wörter sind ein Term und treffen');
  assert.throws(() => new Katalog(standardKatalog(t).datei).seite('oneshot', { text: w(50) }, 'name', false, 0, 10), (e) => e.code === 400 && e.fehler === 'zu_viele_suchwoerter');
});

// ---- S5-Review B6: Listen-Posten auf ein unterlegenes Objekt zeigen DESSEN Datei ----
import { DatabaseSync } from 'node:sqlite';
import { HOST } from './hilfen/mediathek.mjs';

test('Katalog.eintrag: findet auch ein unterlegenes Objekt des Werks (shas), nur bei Tracks', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k-b6-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const k = new Katalog(baueKatalog(dir, [{ typ: 'track', sha: hex('2'), shas: `${hex('1')} ${hex('2')}`, titel: 'W', pfad: '/x/w.mp3' },
    { typ: 'oneshot', sha: hex('5'), shas: `${hex('5')} ${hex('6')}`, name: 'S', pfad: '/x/s.wav' }]));
  assert.equal(k.eintrag(hex('2')).titel, 'W');
  assert.equal(k.eintrag(hex('1')).titel, 'W', 'unterlegenes Objekt → das Werk');
  assert.equal(k.eintrag(hex('6')), null, 'bei Samples gilt nur das sha der Zeile');
  assert.equal(k.eintrag(hex('9')), null);
});

test('GET /stoebern/detail und /welle: ein Listen-Posten auf das unterlegene Objekt zeigt und rechnet SEINE Datei, nicht die des Gewinners', async (t) => {
  const m = tmpMt(t);
  const gewinner = path.join(m.dir, 'gewinner.wav'), anderes = path.join(m.dir, 'anderes.wav');
  execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=1', '-ar', '44100', gewinner]);
  execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'sine=f=330:d=3', '-ar', '44100', anderes]);
  const db = new DatabaseSync(m.db); db.prepare('UPDATE fundort SET pfad = ? WHERE inhalt_sha256 = ? AND host = ?').run(anderes, msha(1), HOST); db.close();
  const dir = fs.mkdtempSync(path.join(m.dir, 'k-'));
  const kat = baueKatalog(dir, [{ typ: 'track', werk_id: 1, sha: msha(2), shas: `${msha(1)} ${msha(2)}`, titel: 'Tech Wolf (Edit)', pfad: gewinner, dauer_s: 1 }]);
  const s = await stapel(t, { mediathek: m.db, katalog: kat });
  const g = (await hole(s.url, `/stoebern/detail?sha=${msha(2)}`)).j, u = (await hole(s.url, `/stoebern/detail?mid=${msha(1).slice(0, 16)}`)).j, u2 = (await hole(s.url, `/stoebern/detail?sha=${msha(1)}`)).j;
  assert.deepEqual([g.pfad, g.objekt_sha, g.eintrag.pfad_da], [gewinner, msha(2), true], 'Gewinner: seine Datei');
  assert.deepEqual([u.pfad, u.objekt_sha, u.eintrag.pfad_da], [anderes, msha(1), true], 'unterlegenes Objekt über mid: die Datei dieses Objekts');
  assert.deepEqual([u2.pfad, u2.objekt_sha], [anderes, msha(1)], 'auch über sha');
  assert.equal(u.eintrag.titel, 'Tech Wolf (Edit)', 'Titel bleibt der des Werks');
  const w = async (sha) => leseWelle(await (await fetch(`${s.url}/welle?sha=${sha}`)).arrayBuffer());
  assert.equal((await w(msha(2))).spalten, Math.floor(48000 / 256), 'Gewinner: 1 s');
  assert.equal((await w(msha(1))).spalten, Math.floor(144000 / 256), 'unterlegenes Objekt: seine Datei (3 s), nicht die des Gewinners');
  const db2 = new DatabaseSync(m.db); db2.prepare('DELETE FROM fundort WHERE inhalt_sha256 = ? AND host = ?').run(msha(1), HOST); db2.close();
  assert.equal((await fetch(`${s.url}/welle?sha=${msha(1)}`)).status, 404, 'kein Fundort auf diesem Host: 404, nicht die Datei des Gewinners');
});
