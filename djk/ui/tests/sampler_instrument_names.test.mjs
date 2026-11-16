// Sample player stage 2, strand S: the file name reader, the variants, key and velocity ranges (pure, no files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { leseInstrumentDateiname as lies, analysiereDateien, baueZonenTabelle, geteilteAnschlaege, ordnerAlsInstrumentKurz, noteVon } from '../sampler/instrument_names.ts';

const pf = (names) => names.map((n) => ({ name: n, rel: `d/${n}` }));

test('file names: note, layer, take', () => {
  let r = lies('JHPiano_Sus_Close_A#0_vl2_rr1.wav');
  assert.deepEqual([r.klasse, r.oktave, r.lage.text, r.take, r.rest], [10, 0, 'vl2', 1, ['JHPiano', 'Sus', 'Close']]);
  r = lies('GrandPiano C3 mf.aif');
  assert.deepEqual([r.klasse, r.oktave, r.lage.text, r.take, r.rest], [0, 3, 'mf', null, ['GrandPiano']]);
  r = lies('GrandPiano A# 1 p.aif');
  assert.deepEqual([r.klasse, r.oktave, r.lage.text], [10, 1, 'p']);
  r = lies('GPiano_sus_A#-1_v2_rr1_Player.wav');
  assert.deepEqual([r.klasse, r.oktave, r.lage.text, r.take], [10, -1, 'v2', 1]);
  r = lies('Harp_Gs4_v3.wav');
  assert.deepEqual([r.klasse, r.oktave], [8, 4]);
  r = lies('Bass Bb1 ff.wav');
  assert.deepEqual([r.klasse, r.oktave, r.lage.text], [10, 1, 'ff']);
  r = lies('b2_mf_1.wav');
  assert.deepEqual([r.klasse, r.oktave, r.lage.text], [11, 2, 'mf']);
  r = lies('Kick.wav');
  assert.equal(r.klasse, null);
});

test('layers are ordered soft to loud, v and vl numbers and dynamic marks', () => {
  const lage = (n) => lies(n).lage.schluessel;
  assert.ok(lage('x C3 p.wav') < lage('x C3 mf.wav') && lage('x C3 mf.wav') < lage('x C3 f.wav') && lage('x C3 f.wav') < lage('x C3 ff.wav'));
  assert.ok(lage('x_C3_v1.wav') < lage('x_C3_v2.wav') && lage('x_C3_vl2.wav') < lage('x_C3_vl10.wav'));
  assert.equal(lies('x C3.wav').lage, null);
});

test('the largest variant is chosen and the others are named', () => {
  const dat = [];
  for (const n of ['C3', 'D3', 'E3', 'F3']) dat.push(`Pi_Close_${n}_vl1.wav`);
  for (const n of ['C3', 'D3']) dat.push(`Pi_Main_${n}_vl1.wav`);
  dat.push('Pi_Mid_C3_vl1.wav', 'Drum.wav');
  const a = analysiereDateien(pf(dat));
  assert.equal(a.dateien, 4);
  assert.ok(a.eintraege.every((e) => e.name.includes('Close')));
  assert.deepEqual(a.varianten.sort(), ['Main', 'Mid']);
  assert.deepEqual([a.noten, a.lagen, a.takes], [4, 1, 1]);
  const k = ordnerAlsInstrumentKurz(pf(dat));
  assert.deepEqual(k, { noten: 4, lagen: 1, takes: 1, dateien: 4, varianten: ['Main', 'Mid'] });
});

test('fewer than three notes is no instrument', () => {
  assert.equal(ordnerAlsInstrumentKurz(pf(['a C3.wav', 'a D3.wav', 'a D3 x.wav', 'b.wav'])), null);
  assert.equal(ordnerAlsInstrumentKurz(pf(['a C3.wav', 'a D3.wav', 'a E3.wav']))?.noten, 3);
});

test('octave convention: the same files give notes 12 apart', () => {
  assert.equal(noteVon(0, 3, 1), 48);
  assert.equal(noteVon(0, 3, 2), 60);
  assert.equal(noteVon(9, 4, 1), 69);
});

test('key ranges: midpoints, the lower note takes the middle key, 12 keys at both ends', () => {
  const a = analysiereDateien(pf(['p C3.wav', 'p E3.wav', 'p F3.wav', 'p A3.wav']));   // under C3 = 60: 60 64 65 69
  const z = baueZonenTabelle(a, 2);
  assert.deepEqual(z.map((x) => [x.grund, x.lo, x.hi]), [[60, 48, 62], [64, 63, 64], [65, 65, 67], [69, 68, 81]]);
  const z1 = baueZonenTabelle(a, 1);
  assert.deepEqual(z1.map((x) => x.grund), [48, 52, 53, 57]);
  const rand = baueZonenTabelle(analysiereDateien(pf(['p C-1.wav', 'p D-1.wav', 'p G8.wav'])), 1);
  assert.equal(rand[0].lo, 0);
  assert.equal(rand.at(-1).hi, 127);
});

test('velocity ranges split 1..127 evenly over the layers of a note', () => {
  assert.deepEqual([0, 1, 2].map((i) => geteilteAnschlaege(3, i)), [[1, 42], [43, 84], [85, 127]]);
  assert.deepEqual(geteilteAnschlaege(1, 0), [1, 127]);
  assert.deepEqual([0, 1].map((i) => geteilteAnschlaege(2, i)), [[1, 63], [64, 127]]);
  const names = ['x C3 p.wav', 'x C3 f.wav', 'x D3 p.wav', 'x D3 mf.wav', 'x D3 f.wav', 'x E3 f.wav'];
  const z = baueZonenTabelle(analysiereDateien(pf(names)), 2);
  assert.deepEqual(z.map((x) => [x.grund, x.lage, x.vlo, x.vhi]), [[60, 'p', 1, 63], [60, 'f', 64, 127], [62, 'p', 1, 42], [62, 'mf', 43, 84], [62, 'f', 85, 127], [64, 'f', 1, 127]]);
});

test('takes share the ranges and keep their take number', () => {
  const names = ['x C3 f rr2.wav', 'x C3 f rr1.wav', 'x D3 f rr1.wav', 'x E3 f rr1.wav', 'x E3 f rr2.wav', 'x E3 f rr3.wav'];
  const a = analysiereDateien(pf(names));
  assert.equal(a.takes, 3);
  const z = baueZonenTabelle(a, 2);
  assert.deepEqual(z.filter((x) => x.grund === 60).map((x) => [x.rr, x.lo, x.hi, x.vlo, x.vhi]), [[1, 48, 61, 1, 127], [2, 48, 61, 1, 127]]);
  assert.deepEqual(z.filter((x) => x.grund === 64).map((x) => x.rr), [1, 2, 3]);
});
