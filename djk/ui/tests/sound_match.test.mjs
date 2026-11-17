import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abgleich, terzAus12, terzHz, abweichungText } from '../public/sound_match.js';
import { terzVon, TERZ_HZ, pruefeAntwort, quellenSchluessel } from '../project/sound_contract.ts';
import { readFileSync } from 'node:fs';

const flach = (db) => new Array(120).fill(db);

test('the third-octave reduction equals the one of the contract', () => {
  const a = Array.from({ length: 120 }, (_, i) => -20 - (i % 7) * 3);
  assert.deepEqual(terzAus12(a), terzVon(a));
  for (let m = 0; m < 30; m++) assert.ok(Math.abs(terzHz(m) - TERZ_HZ[m]) < 1e-9);
});

test('a louder copy of the same curve differs nowhere: the offset is the level difference', () => {
  const r = abgleich(flach(-30), flach(-18));
  assert.ok(Math.abs(r.versatz_db - -12) < 1e-9);
  assert.equal(r.baender.length, 30);
  assert.ok(r.baender.every((b) => Math.abs(b.diff_db) < 1e-9));
  assert.deepEqual(r.abweichungen, []);
});

test('a bass bump and missing highs are named, strongest first, and silent bands carry null', () => {
  const q = flach(-30), v = flach(-30);
  for (let i = 8; i < 20; i++) q[i] = -22;        // +8 dB in three low third-octave bands (bands 2..4)
  for (let i = 100; i < 120; i++) q[i] = -34;     // -4 dB in the top five
  for (let i = 60; i < 64; i++) v[i] = -200;      // the reference carries nothing in band 15
  const r = abgleich(q, v);
  assert.ok(Math.abs(r.versatz_db) < 1e-9);
  assert.equal(r.baender[15].diff_db, null);
  assert.equal(r.abweichungen.length, 2);
  assert.ok(Math.abs(r.abweichungen[0].diff_db - 8) < 1e-9);
  assert.ok(Math.abs(r.abweichungen[1].diff_db - -4) < 1e-9);
  assert.match(abweichungText(r.abweichungen[0]), /^\+8\.0 dB \d+ Hz to \d+ Hz$/);
  assert.match(abweichungText(r.abweichungen[1]), /^-4\.0 dB above /);
});

test('the contract accepts a reference as the comparison: no time picture, an abgleich, its own source key', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/analyse_antwort.json', import.meta.url), 'utf8'));
  const { zeitbild: _z, ...ref } = f.vergleich;
  f.vergleich = { ...ref, quelle: { art: 'datei', sha: 'a'.repeat(64) }, bereich: { von_s: 10, bis_s: 25, datei_s: 300, wahl: 'laut' } };
  delete f.ueberdeckung;
  f.hinweise = f.hinweise.filter((h) => h.art !== 'ueberdeckung_tief');
  f.abgleich = abgleich(f.quelle.spektrum.mittel_db, f.vergleich.spektrum.mittel_db);
  assert.deepEqual(pruefeAntwort(f), []);
  f.vergleich.zeitbild = f.quelle.zeitbild;
  assert.ok(pruefeAntwort(f).some((m) => m.includes('vergleich.zeitbild')));
  delete f.vergleich.zeitbild; f.vergleich.quelle = { art: 'referenz' };
  assert.ok(pruefeAntwort(f).some((m) => m.includes('vergleich.quelle')));
  f.vergleich.quelle = { art: 'referenz', id: 'kick-1' }; f.abgleich.baender.pop();
  assert.ok(pruefeAntwort(f).some((m) => m.includes('abgleich.baender')));
  assert.equal(quellenSchluessel({ art: 'referenz', id: 'kick-1' }), 'referenz:kick-1');
  assert.equal(quellenSchluessel({ art: 'datei', pfad: '/a/b.wav', von_s: 1, bis_s: 9 }), 'datei:/a/b.wav@1-9');
});
