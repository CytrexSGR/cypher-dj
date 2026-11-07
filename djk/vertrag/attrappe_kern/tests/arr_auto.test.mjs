// node --test tests/arr_auto.test.mjs: /k/arr/auto and /e/auto in the stand-in (INTERFACES 4.11, 5.13; 1.12 slice 3).
// Like the core: override only while the transport plays (D5), re-enable also while stopped (D6), `spur 0` with `an 1` releases all,
// refusals format / auto_ziel_unbekannt / nur_andreas (D9), one /e/auto per change.
// Lane-aware like the core: the stand-in reads the lanes of `wiedergabe-<nr>.json` in cfg.arr_ordner at /k/arr/laden (spuren[].nr, spuren[].auto[].ziel), or takes them from the
// test hook K.arrLanen([[spur, ziel], ...]). Without a lane for the field `an 0` is acknowledged and nothing happens; a load that removes a lane reports /e/auto 0 for
// every field of it that was overridden (D6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fahre } from '../folgen_schnell.mjs';
import { neuerKern } from '../module.mjs';
import { kodiere } from '../osc.mjs';
import { AUTO_ZIELE } from '../vertrag.mjs';
import { arbeitsbestand, sende, erwarte, q } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
// a playback file with the lanes `lanen` = {spur: [ziele]}; the tracks 1..32 all exist
function datei(ordner, nr, lanen) {
  const spuren = Object.entries(lanen).map(([spur, ziele]) => ({ nr: Number(spur), auto: ziele.map((ziel) => ({ ziel, punkte: [[0, 0, 0], [16, -30, 0]] })) }));
  fs.writeFileSync(path.join(ordner, `wiedergabe-${nr}.json`), JSON.stringify({ format: 'cypherdj-arr/2', nr, spuren }));
}
const ALLE = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i + 1, AUTO_ZIELE]));   // every field of every track has a lane
const ordnerMit = (nr, lanen) => { const o = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-auto-')); datei(o, nr, lanen); return o; };
const cfg = { arbeitsbestand: arbeitsbestand(), arr_ordner: ordnerMit(1, ALLE) };
const laden = (id, nr) => ['/k/arr/laden', 'hsi', id, 'andreas', nr];
const start = (id) => ['/k/arr/start', 'hsdi', id, 'andreas', 0.0, 0];
const auto = (id, spur, ziel, an, quelle = 'andreas') => ['/k/arr/auto', 'hsisi', id, quelle, spur, ziel, an];
const ereignisse = (r) => r.log.filter((m) => m.adresse === '/e/auto');

const spielt = [sende(0, laden(1, 1)), sende(512, start(2)), erwarte(20000, q(2, 'andreas', 2))];

test('arr_auto: an 0 overrides while playing (q 1, 3, one /e/auto 1), an 1 gives the lane back (/e/auto 0)', () => {
  const r = fahre([
    ...spielt,
    sende(30000, auto(10, 3, 'pan', 0)),
    erwarte(32000, q(10, 'andreas', 1)),
    erwarte(32000, q(10, 'andreas', 3)),
    erwarte(32000, ['/e/auto', 'isi', 3, 'pan', 1]),
    sende(32000, auto(11, 3, 'pan', 0)),   // no change: acknowledged, no second event
    erwarte(34000, q(11, 'andreas', 3)),
    sende(36000, auto(12, 3, 'pan', 1)),
    erwarte(38000, q(12, 'andreas', 3)),
    erwarte(38000, ['/e/auto', 'isi', 3, 'pan', 0]),
  ], { cfg });
  gruen(r);
  assert.equal(ereignisse(r).length, 2);
});

test('arr_auto: spur 0 with an 1 releases every overridden field, one event each; a single re-enable leaves the others', () => {
  const r = fahre([
    ...spielt,
    sende(30000, auto(10, 1, 'fader', 0)),
    sende(30000, auto(11, 2, 'mute', 0)),
    sende(30000, auto(12, 2, 'solo', 0)),
    sende(34000, auto(13, 2, 'solo', 1)),
    erwarte(36000, ['/e/auto', 'isi', 2, 'solo', 0]),
    sende(38000, auto(14, 0, 'fader', 1)),
    erwarte(40000, q(14, 'andreas', 3)),
    erwarte(40000, ['/e/auto', 'isi', 1, 'fader', 0]),
    erwarte(40000, ['/e/auto', 'isi', 2, 'mute', 0]),
  ], { cfg });
  gruen(r);
  const e = ereignisse(r).map((m) => `${m.werte[0]}/${m.werte[1]}/${m.werte[2]}`);
  assert.deepEqual(e, ['1/fader/1', '2/mute/1', '2/solo/1', '2/solo/0', '1/fader/0', '2/mute/0']);
});

test('arr_auto: refusals format, auto_ziel_unbekannt, nur_andreas; cypher may re-enable', () => {
  const r = fahre([
    ...spielt,
    sende(30000, auto(10, 33, 'fader', 0)),
    erwarte(32000, q(10, 'andreas', 6, null, 'format')),
    sende(32000, auto(11, 1, 'fader', 2)),
    erwarte(34000, q(11, 'andreas', 6, null, 'format')),
    sende(34000, auto(12, 0, 'fader', 0)),
    erwarte(36000, q(12, 'andreas', 6, null, 'format')),
    sende(36000, auto(13, 1, 'geraet.cutoff', 0)),
    erwarte(38000, q(13, 'andreas', 6, null, 'auto_ziel_unbekannt')),
    sende(38000, auto(14, 1, 'fader', 0, 'cypher')),
    erwarte(40000, q(14, 'cypher', 6, null, 'nur_andreas')),
    sende(40000, auto(15, 1, 'fader', 0)),   // negative control: the same command from andreas works
    erwarte(42000, ['/e/auto', 'isi', 1, 'fader', 1]),
    sende(42000, auto(16, 1, 'fader', 1, 'cypher')),
    erwarte(44000, q(16, 'cypher', 3)),
    erwarte(44000, ['/e/auto', 'isi', 1, 'fader', 0]),
  ], { cfg });
  gruen(r);
  assert.equal(ereignisse(r).length, 2);   // the refusals produced none
});

test('arr_auto: D5 an 0 while stopped is acknowledged, nothing changes, no /e/auto; D6 an 1 while stopped clears and reports 0', () => {
  const r = fahre([
    sende(0, laden(1, 1)),
    sende(4000, auto(10, 1, 'fader', 0)),   // never started
    erwarte(6000, q(10, 'andreas', 1)),
    erwarte(6000, q(10, 'andreas', 3)),
    sende(8000, start(2)),
    erwarte(20000, q(2, 'andreas', 2)),
    sende(30000, auto(11, 1, 'fader', 0)),
    erwarte(32000, ['/e/auto', 'isi', 1, 'fader', 1]),
    sende(34000, ['/k/arr/stopp', 'hsi', 12, 'andreas', 0]),
    sende(40000, auto(13, 1, 'fader', 1)),
    erwarte(42000, ['/e/auto', 'isi', 1, 'fader', 0]),
  ], { cfg });
  gruen(r);
  const e = ereignisse(r);
  assert.equal(e.length, 2);
  assert.ok(e[0].s > 29000, 'the stopped command made no event');
});

test('arr_auto: the name list of the stand-in is the generated list auto_ziel of osc.json, in order and length', () => {
  const osc = JSON.parse(fs.readFileSync(new URL('../../osc.json', import.meta.url), 'utf8'));
  assert.deepEqual([...AUTO_ZIELE], osc.werte.auto_ziel.liste);
});

test('arr_auto: without a lane an 0 is acknowledged and nothing happens (no event); a field with a lane in the same playback does', () => {
  const ordner = ordnerMit(1, { 1: ['fader'] });   // track 1 has only a fader lane
  const r = fahre([
    sende(0, laden(1, 1)),
    sende(512, start(2)),
    erwarte(20000, q(2, 'andreas', 2)),
    sende(30000, auto(10, 1, 'pan', 0)),     // no pan lane
    erwarte(32000, q(10, 'andreas', 3)),
    sende(32000, auto(11, 2, 'fader', 0)),   // track 2 has no lane at all
    erwarte(34000, q(11, 'andreas', 3)),
    sende(34000, auto(12, 1, 'fader', 0)),   // the one lane
    erwarte(36000, ['/e/auto', 'isi', 1, 'fader', 1]),
    sende(36000, auto(13, 2, 'fader', 1)),   // re-enable without a lane and without an override: nothing
    erwarte(38000, q(13, 'andreas', 3)),
  ], { cfg: { ...cfg, arr_ordner: ordner } });
  gruen(r);
  assert.equal(ereignisse(r).length, 1);
});

test('arr_auto: a load that removes a lane reports /e/auto 0 for every overridden field of it (D6); a load that keeps it reports nothing; an overridden field survives stop and start', () => {
  const ordner = ordnerMit(1, { 1: ['fader', 'mute'], 2: ['fader'] });
  datei(ordner, 2, { 1: ['mute'], 2: ['fader'] });   // track 1 loses its fader lane
  datei(ordner, 3, { 1: ['mute'], 2: ['fader'] });   // the same lanes again
  const r = fahre([
    sende(0, laden(1, 1)),
    sende(512, start(2)),
    erwarte(20000, q(2, 'andreas', 2)),
    sende(30000, auto(10, 1, 'fader', 0)),
    sende(30000, auto(11, 1, 'mute', 0)),
    sende(30000, auto(12, 2, 'fader', 0)),
    erwarte(32000, ['/e/auto', 'isi', 2, 'fader', 1]),
    sende(34000, ['/k/arr/stopp', 'hsi', 13, 'andreas', 0]),
    sende(36000, start(14)),
    erwarte(60000, q(14, 'andreas', 2)),
    sende(62000, laden(15, 2)),
    erwarte(64000, q(15, 'andreas', 3)),
    erwarte(64000, ['/e/auto', 'isi', 1, 'fader', 0]),
    sende(66000, laden(16, 3)),
    erwarte(68000, q(16, 'andreas', 3)),
  ], { cfg: { ...cfg, arr_ordner: ordner } });
  gruen(r);
  const e = ereignisse(r).map((m) => `${m.werte[0]}/${m.werte[1]}/${m.werte[2]}`);
  assert.deepEqual(e, ['1/fader/1', '1/mute/1', '2/fader/1', '1/fader/0']);   // mute and track 2 stay overridden, the same lanes again change nothing
});

test('arr_auto: the test hook K.arrLanen declares the lanes and reports the lanes that go (stopped: the state goes without a blend, the event is the same)', () => {
  const log = [];
  const K = neuerKern({ cfg: { arbeitsbestand: arbeitsbestand() }, sende: (m) => { if (m.ports.includes(1)) log.push(m); } });
  K.empfange(kodiere('/k/hallo', 'sii', ['t', 1, 1]), { port: 1 });
  const bis = (s) => { while (K.jetzt <= s) K.block(); };
  const cmd = (adr, typen, werte) => K.empfange(kodiere(adr, typen, werte), { port: 1 });
  K.arrLanen([[3, 'solo'], [4, 'pan']]);
  cmd('/k/arr/laden', 'hsi', [1n, 'andreas', 1]);
  bis(1000);
  cmd('/k/arr/start', 'hsdi', [2n, 'andreas', 0.0, 0]);
  bis(20000);
  cmd('/k/arr/auto', 'hsisi', [3n, 'andreas', 3, 'solo', 0]);
  cmd('/k/arr/auto', 'hsisi', [4n, 'andreas', 3, 'fader', 0]);   // no lane
  bis(22000);
  K.arrLanen([[4, 'pan']]);   // the solo lane of track 3 goes
  bis(24000);
  const e = log.filter((m) => m.adresse === '/e/auto').map((m) => `${m.werte[0]}/${m.werte[1]}/${m.werte[2]}`);
  assert.deepEqual(e, ['3/solo/1', '3/solo/0']);
});

// 1.12 slice 5 U9 (D9): a playback lane with `relativ: true` is a summand of the value stack, not a second absolute lane. The core has no override for a field that carries only a
// relative lane (nothing absolute to take over), and with both an absolute and a relative lane the override takes the whole stack. `gain_hk` (clip gain envelopes) is ignored by the
// stand-in: it does not model clip gain.
function dateiRel(ordner, nr) {
  const l = (ziel, relativ) => ({ ziel, punkte: [[0, -6, 0], [16, -6, 0]], ...(relativ ? { relativ: true } : {}) });
  const spuren = [
    { nr: 1, auto: [l('fader', false), l('fader', true)] },   // absolute and relative fader lane: the field can be overridden
    { nr: 2, auto: [l('fader', true)] },                       // relative fader lane only: nothing to override
    { nr: 3, auto: [l('pan', true), l('pan', false)] },        // relative first, then the absolute one
    { nr: 4, auto: [l('pan', true)], clips: [{ id: 'c1', gain_hk: [[0, -6, 0], [4, 0, 0]] }] },   // relative pan only, a clip with a gain envelope
  ];
  fs.writeFileSync(path.join(ordner, `wiedergabe-${nr}.json`), JSON.stringify({ format: 'cypherdj-arr/2', nr, spuren }));
}

test('arr_auto: a relative lane is no absolute lane (the field of a relative-only lane has no override), absolute + relative overrides as one', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-auto-rel-'));
  dateiRel(ordner, 1);
  const r = fahre([
    sende(0, laden(1, 1)),
    sende(512, start(2)),
    erwarte(20000, q(2, 'andreas', 2)),
    sende(30000, auto(10, 2, 'fader', 0)),   // relative fader lane only: acknowledged, nothing happens
    erwarte(32000, q(10, 'andreas', 3)),
    sende(32000, auto(11, 4, 'pan', 0)),     // relative pan lane only (the clip carries a gain_hk the stand-in ignores)
    erwarte(34000, q(11, 'andreas', 3)),
    sende(34000, auto(12, 1, 'fader', 0)),   // absolute + relative: the field is overridden
    erwarte(36000, ['/e/auto', 'isi', 1, 'fader', 1]),
    sende(36000, auto(13, 3, 'pan', 0)),     // relative lane in front of the absolute one: the field is overridden
    erwarte(38000, ['/e/auto', 'isi', 3, 'pan', 1]),
  ], { cfg: { ...cfg, arr_ordner: ordner } });
  gruen(r);
  assert.deepEqual(ereignisse(r).map((m) => `${m.werte[0]}/${m.werte[1]}/${m.werte[2]}`), ['1/fader/1', '3/pan/1']);
});
