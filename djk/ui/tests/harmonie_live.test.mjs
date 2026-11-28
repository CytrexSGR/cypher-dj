// Strand 7 task 2.3: the live harmony lane state (areas/live/harmonie.ts). Pure state machine with temp folders; no server, no clock, no instance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveHarmonie, HarmonieFehler, tonartLesen, tonartName, HARMONIE_DATEI } from '../areas/live/harmonie.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harm-'));
const lege = () => { const ordner = [path.join(tmp(), 'm1'), path.join(tmp(), 'm2')]; return { ordner, h: new LiveHarmonie({ ordner: () => ordner }) }; };
const datei = (o) => JSON.parse(fs.readFileSync(path.join(o, HARMONIE_DATEI), 'utf8'));
// Clock at beat 20 with 4 beats per bar: bar 6 is playing, the next bar is 7, the next phrase bar (1 mod 8) is 9.
const T = { takt: 7, phrase: 9, jetzt: 6 };
const fehler = (f) => { try { f(); } catch (e) { assert.ok(e instanceof HarmonieFehler, String(e)); return e; } assert.fail('no error'); };

test('anchors at the next bar by default and at the next phrase with ab phrase; the answer names key, chords, current and next change', () => {
  const { h } = lege();
  let r = h.setze({ folge: 'Am7 | Fmaj7 G', takte_je_akkord: 2 }, T);
  assert.deepEqual([r.ab_takt, r.tonart, r.folge, r.takte_je_akkord], [7, 'A minor', ['Am7', 'Fmaj7', 'G'], 2]);
  assert.deepEqual(r.jetzt, { takt: 6, akkord: null });
  assert.equal(r.naechster_wechsel_takt, 7, 'nothing plays yet: the lane starts at the anchor');
  r = h.setze({ folge: 'C F G', ab: 'phrase' }, T);
  assert.equal(r.ab_takt, 9);
  assert.equal(r.tonart, 'C major');
  assert.deepEqual(r.jetzt, { takt: 6, akkord: null }, 'the first entry starts at bar 7');
  assert.equal(r.naechster_wechsel_takt, 7);
  assert.deepEqual(h.lesen({ takt: 8, phrase: 9, jetzt: 7 }).jetzt, { takt: 7, akkord: 'Am7' });
  assert.equal(h.lesen({ takt: 8, phrase: 9, jetzt: 7 }).naechster_wechsel_takt, 9, 'Am7 holds two bars from bar 7');
  assert.equal(h.lesen({ takt: 10, phrase: 17, jetzt: 9 }).tonart, 'C major');
  r = h.setze({ folge: 'Dm', anker_takt: 12 }, T);
  assert.equal(r.ab_takt, 12);
});

test('a new entry at the same cycle replaces the earlier one', () => {
  const { h, ordner } = lege();
  h.setze({ folge: 'Am', anker_takt: 10 }, T);
  h.setze({ folge: 'Em G', anker_takt: 10, takte_je_akkord: 4 }, T);
  const e = datei(ordner[0]).eintraege;
  assert.equal(e.length, 1);
  assert.deepEqual([e[0].ab_zyklus, e[0].takte_je_akkord, e[0].folge.map((a) => a.name)], [9, 4, ['Em', 'G']]);
});

test('aus appends an entry with an empty folge', () => {
  const { h, ordner } = lege();
  h.setze({ folge: 'Am | F', anker_takt: 7 }, T);
  const r = h.setze({ aus: true, anker_takt: 11 }, { takt: 7, phrase: 9, jetzt: 6 });
  assert.equal(r.aus, true);
  const e = datei(ordner[1]).eintraege;
  assert.deepEqual(e.map((x) => [x.ab_zyklus, x.folge.length]), [[6, 2], [10, 0]]);
  assert.equal(h.lesen({ takt: 12, phrase: 17, jetzt: 11 }).jetzt.akkord, null, 'after the off entry: no lane');
});

test('probe validates and answers but writes nothing and keeps the state', () => {
  const { h, ordner } = lege();
  const r = h.setze({ folge: 'Am7 Dm7', probe: true }, T);
  assert.equal(r.probe, true);
  assert.equal(r.ab_takt, 7);
  for (const o of ordner) assert.equal(fs.existsSync(path.join(o, HARMONIE_DATEI)), false);
  assert.equal(h.lesen(T), null);
  assert.equal(fehler(() => h.setze({ folge: 'Am7 Hm', probe: true }, T)).fehler, 'argument_ungueltig');
});

test('the file lands in every stream folder, atomically written and complete', () => {
  const { h, ordner } = lege();
  h.setze({ folge: 'Am7 Fmaj7', takte_je_akkord: 2 }, T);
  const [a, b] = ordner.map(datei);
  assert.deepEqual(a, b);
  assert.deepEqual(a.eintraege[0].tonart, { grundton: 9, stufen: [0, 2, 3, 5, 7, 8, 10] });
  assert.deepEqual(a.eintraege[0].folge[0], { name: 'Am7', grundton: 9, toene: [9, 0, 4, 7] });
  assert.deepEqual(fs.readdirSync(ordner[0]), [HARMONIE_DATEI], 'no temp file left behind');
});

test('read-back at start: the state comes from the folder of stream 2; a broken file means no lane', () => {
  const { h, ordner } = lege();
  h.setze({ folge: 'Am7 Fmaj7 G', takte_je_akkord: 2 }, T);
  const neu = new LiveHarmonie({ ordner: () => ordner });
  neu.lade();
  assert.deepEqual(neu.lesen({ takt: 8, phrase: 9, jetzt: 7 }), h.lesen({ takt: 8, phrase: 9, jetzt: 7 }));
  fs.writeFileSync(path.join(ordner[1], HARMONIE_DATEI), '{kaputt');
  const leer = new LiveHarmonie({ ordner: () => ordner });
  leer.lade();
  assert.equal(leer.lesen(T), null);
});

test('errors: bad symbol is named, anchor in the past is 409 with the earliest bar, ab and anker exclude each other, unknown argument', () => {
  const { h } = lege();
  let e = fehler(() => h.setze({ folge: 'Am7 Xm' }, T));
  assert.deepEqual([e.code, e.fehler], [400, 'argument_ungueltig']);
  assert.match(e.message, /Xm/);
  e = fehler(() => h.setze({ folge: 'Am', anker_takt: 6 }, T));
  assert.deepEqual([e.code, e.fehler, e.extra.fruehester_takt], [409, 'anker_vorbei', 7]);
  assert.equal(fehler(() => h.setze({ folge: 'Am', anker_takt: 9, ab: 'takt' }, T)).fehler, 'ab_und_anker');
  assert.equal(fehler(() => h.setze({ folge: 'Am', anker_takt: 7 + 257 }, T)).code, 400);
  assert.equal(fehler(() => h.setze({ folge: 'Am', bogus: 1 }, T)).fehler, 'argument_unbekannt');
  assert.equal(fehler(() => h.setze({}, T)).code, 400, 'folge missing');
  assert.equal(fehler(() => h.setze({ folge: 'Am', takte_je_akkord: 0 }, T)).code, 400);
  assert.equal(h.setze({ folge: 'Am', anker_takt: 7 }, T).ab_takt, 7, 'the earliest bar itself is allowed');
});

test('old entries are dropped 64 bars after they ended; the last one always stays', () => {
  const { h, ordner } = lege();
  h.setze({ folge: 'Am', anker_takt: 7 }, T);
  h.setze({ folge: 'Dm', anker_takt: 20 }, T);
  h.setze({ folge: 'Em', anker_takt: 30 }, T);
  h.setze({ folge: 'Fm', anker_takt: 210 }, { takt: 200, phrase: 201, jetzt: 199 });
  assert.deepEqual(datei(ordner[0]).eintraege.map((e) => e.folge[0].name), ['Em', 'Fm'], 'Am ended at bar 20 and Dm at bar 30, both before bar 199 - 64; Em ended at 210');
});

test('explicit key: given text wins over the chord-derived key; bad key text is 400', () => {
  const { h } = lege();
  assert.equal(h.setze({ folge: 'Am7 Fmaj7 G', tonart: 'D dorian' }, T).tonart, 'D dorian');
  assert.equal(fehler(() => h.setze({ folge: 'Am', tonart: 'Q minor' }, T)).code, 400);
  assert.equal(fehler(() => h.setze({ folge: 'Am', tonart: 'A weird' }, T)).code, 400);
  assert.deepEqual(tonartLesen('Bb major pentatonic'), { grundton: 10, skala: 'major_pentatonic' });
  assert.equal(tonartName({ grundton: 6, stufen: [0, 2, 3, 5, 7, 8, 10] }), 'F# minor');
});

test('a folder that cannot be written is reported and does not stop the others', () => {
  const ordner = [path.join(tmp(), 'a'), path.join(tmp(), 'b')];
  const gemeldet = [];
  const h = new LiveHarmonie({ ordner: () => ordner, fehler: (o) => gemeldet.push(o),
    schreibe: (d, t) => { if (d.startsWith(ordner[0])) throw new Error('voll'); fs.writeFileSync(d, t); } });
  h.setze({ folge: 'Am' }, T);
  assert.deepEqual(gemeldet, [ordner[0]]);
  assert.equal(fs.existsSync(path.join(ordner[1], HARMONIE_DATEI)), true);
});
