// FIND SOUND rework, task 1: the audibility measure D (hoerDiff) weights a change by where the sound has energy; calibration on the listening
// verdict of 2026-11-18 (fixture tests/fixtures/klang_runde_hoerurteil.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hoerDiff, wirkung } from '../project/sound_runde.ts';
import { HOER, ZIELE, STUFEN_NAME, UEBERSCHUSS } from '../project/sound_runde_contract.ts';

const NULL = { hell: 0, sub: 0, hoehen: 0, bewegung: 0, fuelle: 0, breite: 0, punch: 0, pegel: 0 };
const mess = (bild, m = {}) => ({ m: { ...NULL, pegel: -12, ...m }, bild });
const baender = (f) => Array.from({ length: 30 }, (_, i) => f(i));
const A = mess(baender((i) => (i < 15 ? 0 : -45)));
const D = (v) => hoerDiff(A, v, 1);   // k = 1: the tests compare ratios, independent of the calibrated k

test('the measure weights a change by where the sound has energy', () => {
  const quiet = mess(baender((i) => (i < 15 ? 0 : -45) + (i >= 20 ? 6 : 0)));   // +6 dB where the sound has no energy
  const loud = mess(baender((i) => (i < 15 ? 0 : -45) + (i >= 5 && i <= 9 ? 6 : 0)));   // +6 dB in loud bands
  assert.ok(D(quiet).d < 0.25 * D(loud).d, `${D(quiet).d} vs ${D(loud).d}`);
  assert.ok(D(loud).d > 0);
});

test('a pure level difference is matched away and only the weak level term remains', () => {
  const loud = mess(baender((i) => (i < 15 ? 0 : -45) + (i >= 5 && i <= 9 ? 6 : 0)));
  const lauter = mess(A.bild.map((x) => x + 6), { pegel: -6 });
  const r = D(lauter);
  assert.ok(Math.abs(r.teile.spek) < 1e-9);
  assert.ok(r.teile.pegel > 0);
  assert.ok(r.d < 0.5 * D(loud).d);
});

test('identical sounds give 0; silent sounds are handled', () => {
  assert.equal(D(A).d, 0);
  const still = { m: { ...NULL, pegel: -200 }, bild: baender(() => -200) };
  assert.equal(D(still).d, 0, 'silent v: the level rule of taugt refuses it');
  assert.equal(hoerDiff(still, A, 1).d, 0);
  assert.equal(hoerDiff(still, still, 1).d, 0);
});

test('D grows with a length change and with the crest', () => {
  assert.ok(D(mess(A.bild, { fuelle: -2 })).d > 1);
  assert.ok(D(mess(A.bild, { punch: 2 })).d > 0.3);
  assert.ok(D(mess(A.bild, { fuelle: -2 })).teile.fuelle < 0);
});

const F = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'klang_runde_hoerurteil.json'), 'utf8'));
const von = (c) => ({ m: c.merkmale, bild: c.bild30 });

test('levels: three increasing targets with the names subtle, clear, strong', () => {
  assert.ok(ZIELE.fein < ZIELE.normal && ZIELE.normal < ZIELE.grob);
  assert.deepEqual(STUFEN_NAME, { fein: 'subtle', normal: 'clear', grob: 'strong' });
});

test('calibration on the verdict of 2026-11-18', () => {
  const norm = F.kandidaten.filter((c) => c.schritt === 'normal'), grob = F.kandidaten.filter((c) => c.schritt === 'grob');
  const d1 = (c) => hoerDiff(von(F.a), von(c), 1).d, dk = (c) => hoerDiff(von(F.a), von(c)).d;
  const tabelle = F.kandidaten.map((c) => `${c.schritt} ${c.name} (k${c.param.slice(1)}=${c.wert}): D ${dk(c).toFixed(2)}`);
  console.log(`# D of the six verdict candidates (k ${HOER.k}):\n# ${tabelle.join('\n# ')}`);
  const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  // (c) k is pinned: the median D of the coarse candidates is 1.0 (the subtle level)
  assert.ok(Math.abs(median(grob.map(dk)) - 1) < 0.05, `median coarse ${median(grob.map(dk))}`);
  assert.ok(Math.abs(HOER.k * median(grob.map(d1)) - 1) < 0.05);
  // today's normal places ("hardly audible") are not offered at ANY level, not even the lowest; today's coarse ones ("yes, a little") lie at the lowest
  // level or just below it (median 0.8 to 1.0 x the subtle target), and the default level is clearly above the strongest of them (at least 1.4 x)
  const alleNorm = Math.max(...norm.map(dk)), alleGrob = Math.max(...grob.map(dk));
  assert.ok(alleNorm < ZIELE.fein, `strongest old normal step ${alleNorm} must stay under the subtle target ${ZIELE.fein}`);
  const rel = median(grob.map(dk)) / ZIELE.fein;
  assert.ok(rel >= 0.8 && rel <= 1, `median old coarse step = ${rel.toFixed(2)} x the subtle target`);
  assert.ok(ZIELE.normal >= 1.4 * alleGrob, `clear target ${ZIELE.normal} against the strongest old coarse step ${alleGrob}`);
  // the bands of the three levels (target to UEBERSCHUSS x target) do not overlap, so the three levels give three different places
  assert.ok(UEBERSCHUSS * ZIELE.fein < ZIELE.normal && UEBERSCHUSS * ZIELE.normal < ZIELE.grob, 'the bands of the levels overlap');
  // per knob the coarse step is the larger difference (the owner heard the normal ones as hardly audible, the coarse ones as a little)
  for (const p of ['k1', 'k3', 'k4']) {
    assert.ok(dk(norm.find((c) => c.param === p)) < dk(grob.find((c) => c.param === p)), `${p}: normal below coarse`);
  }
  // the old measure counted the normal Brightness step as strong (e.hoehen 1.5 units); the new one puts it below the clear level
  const alt = wirkung(F.a.merkmale, norm[0].merkmale);
  assert.ok(alt.staerke >= 1 && dk(norm[0]) < ZIELE.normal, `old strength ${alt.staerke}`);
  // The positive control of the recording (highs of the normal Brightness step +6.0 dB +-1.5, levels of Drive normal, Brightness coarse, Drive coarse
  // -1.0, +1.4, +1.3 dB +-0.7) passes on the real module; while it fails the constants are PROVISIONAL and the contract must say so.
  // KNOWN LIMIT (not asserted away): the normal Brightness step measures above the coarse Drive step, see the contract.
  assert.ok(F.kontrolle && typeof F.kontrolle.ok === 'boolean');
  const vertrag = fs.readFileSync(path.join(import.meta.dirname, '..', 'project', 'sound_runde_contract.ts'), 'utf8');
  if (!F.kontrolle.ok) assert.match(vertrag, /PROVISIONAL/, 'the calibration is not validated: the contract must say so');
  else assert.doesNotMatch(vertrag, /PROVISIONAL/, 'the controls pass: no provisional marking');
});
