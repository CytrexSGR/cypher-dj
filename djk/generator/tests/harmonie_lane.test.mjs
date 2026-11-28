// Strand 7 task 2.2: the generator follows the harmony lane (.harm(), .akkordton(), re-plan on a lane change, clash count, lane file).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KIT } from './fixtures/taktart_4_korpus.mjs';
import { kompiliere } from '../src/compile.mjs';
import { setzeLane } from '../src/strudel.mjs';
import { Planer } from '../src/planner.mjs';
import { leseHarmonie } from '../src/harmonie_file.mjs';
import { folgeLesen, laneEintrag } from '../../ui/public/harmonie.js';
import { dekodiere } from '../../contract/mock_core/osc.mjs';

const eintrag = (text, ab, takte = 1, tonart) => laneEintrag({ folge: folgeLesen(text), takte_je_akkord: takte, ab_zyklus: ab, tonart });
const A_MOLL = { grundton: 9, skala: 'minor' };
const D_MOLL = { grundton: 2, skala: 'minor' };
const noten = (muster, von, bis) => muster.queryArc(von, bis).filter((h) => h.hasOnset()).map((h) => h.value.note);
const m = (t) => kompiliere(t).muster;
const dekodiereBundle = (buf) => dekodiere(buf).elemente;

test('.harm(): degrees of the lane key per cycle (A minor from 0, D minor from 8)', () => {
  const lane = [eintrag('Am', 0, 1, A_MOLL), eintrag('Dm', 8, 1, D_MOLL)];
  const p = m('n("0 2 4").harm()');
  setzeLane(lane);
  assert.deepEqual(noten(p, 0, 1), [57, 60, 64]);
  assert.deepEqual(noten(p, 8, 9), [50, 53, 57]);
  setzeLane([]);
});

test('.harm(): octave argument, negative and fractional degrees wrap over the scale', () => {
  setzeLane([eintrag('Am', 0, 1, A_MOLL)]);
  assert.deepEqual(noten(m('n("7 -1 2.7").harm(4)'), 0, 1), [81, 67, 72]);
  setzeLane([]);
});

test('.harm() without a lane is C minor; values with note keep it', () => {
  setzeLane([]);
  assert.deepEqual(noten(m('n("0 2 4").harm()'), 0, 1), [48, 51, 55]);
  assert.deepEqual(noten(m('note("c3 e3").harm()'), 0, 1), ['c3', 'e3']);
});

test('.akkordton(): tones of the lane chord, one chord per cycle (Am7 | Fmaj7)', () => {
  setzeLane([eintrag('Am7 | Fmaj7', 0, 1, A_MOLL)]);
  const p = m('n("0 1 2 3 4").akkordton()');
  assert.deepEqual(noten(p, 0, 1).slice(0, 5), [57, 60, 64, 67, 69]);   // A C E G, then A one octave up
  assert.deepEqual(noten(m('n("0 1 2 3").akkordton()'), 1, 2), [53, 57, 60, 64]);   // F A C E
  setzeLane([]);
});

test('the lane of a stream is set by its planer: two planers with different lanes in one process', () => {
  const a = new Planer({ strom: 2, kit: { midi: true }, sende: () => {}, lane: [eintrag('Am', 0, 1, A_MOLL)] });
  const b = new Planer({ strom: 3, kit: { midi: true }, sende: () => {}, lane: [eintrag('Dm', 0, 1, D_MOLL)] });
  a.setze(m('n("0").harm()'), -Infinity);
  b.setze(m('n("0").harm()'), -Infinity);
  const gesendet = [];
  for (const [p, n] of [[a, 57], [b, 50]]) {
    p.sende = (buf) => gesendet.push(dekodiereBundle(buf));
    p.schicke(0, 4);
    const ev = gesendet.at(-1).find((x) => x.adresse === '/erz/ev');
    assert.equal(ev.werte[3], n);
  }
});

test('planner: a lane change at cycle 10 after the window up to bar 12 was sent re-sends from cycle 10', () => {
  const gesendet = [];
  const p = new Planer({ strom: 2, kit: { midi: true }, sende: (buf) => gesendet.push(dekodiereBundle(buf)), lane: [eintrag('Am', 0, 1, A_MOLL)] });
  p.setze(m('n("0").harm()'), -Infinity);
  p.takt(10);   // sends [44, 52): cycles 11 and 12 (horizon 52)
  gesendet.length = 0;
  p.setzeLane([eintrag('Am', 0, 1, A_MOLL), eintrag('Dm', 10, 1, D_MOLL)]);
  const fenster = gesendet.flatMap((b) => b.filter((x) => x.adresse === '/erz/fenster'));
  assert.equal(fenster.length, 1);
  assert.equal(fenster[0].werte[4], 40);   // ab = cycle 10 (beat 40)
  assert.equal(fenster[0].werte[5], 52);   // bis = old horizon
  const evs = gesendet.flatMap((b) => b.filter((x) => x.adresse === '/erz/ev')).map((x) => x.werte[3]);
  assert.deepEqual(evs, [50, 50, 50]);   // cycles 10, 11, 12 in D minor (n 0 -> D3)
  // the same lane again changes nothing
  gesendet.length = 0;
  p.setzeLane([eintrag('Am', 0, 1, A_MOLL), eintrag('Dm', 10, 1, D_MOLL)]);
  assert.equal(gesendet.length, 0);
  // never before the next bar line when `jetzt` is known: change at cycle 0 while beat 21 plays -> from beat 24
  p.setzeLane([eintrag('Gm', 0, 1, { grundton: 7, skala: 'minor' })], 21);
  const f2 = gesendet.flatMap((b) => b.filter((x) => x.adresse === '/erz/fenster'));
  assert.equal(f2[0].werte[4], 24);
});

test('clash count: note("f#3") in A minor is foreign every time, status fields', () => {
  const p = new Planer({ strom: 2, kit: { midi: true }, sende: () => {}, lane: [eintrag('Am', 0, 1, A_MOLL)] });
  p.setze(m('note("f#3")'), -Infinity);
  p.schicke(0, 8);
  assert.deepEqual(p.harmonie, { von_zyklus: 0, bis_zyklus: 2, noten: 2, fremd: 2, fremd_toene: ['F#'] });
  p.setze(m('note("a3 c4")'), -Infinity);
  p.schicke(0, 4);
  assert.deepEqual(p.harmonie, { von_zyklus: 0, bis_zyklus: 1, noten: 2, fremd: 0, fremd_toene: [] });
});

test('clash count is absent without a lane and for kit streams', () => {
  const p = new Planer({ strom: 2, kit: { midi: true }, sende: () => {} });
  p.setze(m('note("f#3")'), -Infinity);
  p.schicke(0, 4);
  assert.equal(p.harmonie, null);
  const k = new Planer({ strom: 1, kit: KIT, sende: () => {}, lane: [eintrag('Am', 0, 1, A_MOLL)] });
  k.setze(m('s("bd")'), -Infinity);
  k.schicke(0, 4);
  assert.equal(k.harmonie, null);
});

test('harmonie.json: ENOENT = no lane, broken JSON or bad shape keeps the last lane', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'harm-'));
  try {
    const lane = [eintrag('Am', 0, 1, A_MOLL)];
    assert.deepEqual(leseHarmonie(ordner, lane), []);
    fs.writeFileSync(path.join(ordner, 'harmonie.json'), JSON.stringify({ eintraege: lane }));
    assert.deepEqual(leseHarmonie(ordner, []), lane);
    fs.writeFileSync(path.join(ordner, 'harmonie.json'), '{ broken');
    assert.deepEqual(leseHarmonie(ordner, lane), lane);
    fs.writeFileSync(path.join(ordner, 'harmonie.json'), JSON.stringify({ eintraege: [{ ab_zyklus: -1 }] }));
    assert.deepEqual(leseHarmonie(ordner, lane), lane);
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});
