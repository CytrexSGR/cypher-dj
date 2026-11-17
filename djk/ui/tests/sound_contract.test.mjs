import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ZWOELFTEL_HZ, TERZ_HZ, zwoelftelKanten, terzKanten, terzVon, quellenSchluessel, hzText, pruefeAntwort, fuerHand, DB_BODEN,
} from '../project/sound_contract.ts';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/analyse_antwort.json', import.meta.url), 'utf8'));

test('band grid: 120 semitone bands from 20.6 Hz to 19.9 kHz, A4 = 440 Hz, edges touch', () => {
  assert.equal(ZWOELFTEL_HZ.length, 120);
  assert.ok(Math.abs(ZWOELFTEL_HZ[0] - 20.60) < 0.01);
  assert.ok(Math.abs(ZWOELFTEL_HZ[119] - 19912) < 1);
  assert.equal(ZWOELFTEL_HZ[53], 440);
  for (let n = 0; n < 119; n++) assert.equal(zwoelftelKanten(n)[1], zwoelftelKanten(n + 1)[0]);
});

test('third-octave grid: 30 bands, each exactly four semitone bands', () => {
  assert.equal(TERZ_HZ.length, 30);
  for (let m = 0; m < 30; m++) {
    assert.equal(terzKanten(m)[0], zwoelftelKanten(4 * m)[0]);
    assert.equal(terzKanten(m)[1], zwoelftelKanten(4 * m + 3)[1]);
  }
});

test('terzVon keeps a single band level and adds four equal bands by +6.02 dB', () => {
  const a = new Array(120).fill(DB_BODEN);
  a[5] = -6;
  assert.ok(Math.abs(terzVon(a)[1] - -6) < 1e-9);
  assert.equal(terzVon(a)[0], DB_BODEN);
  const b = new Array(120).fill(DB_BODEN);
  for (let i = 8; i < 12; i++) b[i] = -20;
  assert.ok(Math.abs(terzVon(b)[2] - -13.98) < 0.01);
  assert.deepEqual(terzVon(new Array(120).fill(DB_BODEN)), new Array(30).fill(DB_BODEN));
});

test('the fixture is a valid answer', () => {
  assert.deepEqual(pruefeAntwort(fixture()), []);
});

test('pruefeAntwort names what is wrong', () => {
  let f = fixture(); f.quelle.zeitbild.zeilen = 119;
  assert.ok(pruefeAntwort(f).some((m) => m.includes('zeilen')));
  f = fixture(); f.quelle.stereo.korrelation = 1.5;
  assert.ok(pruefeAntwort(f).some((m) => m.includes('korrelation')));
  f = fixture(); f.hinweise[0].art = 'x';
  assert.ok(pruefeAntwort(f).some((m) => m.includes('art')));
  f = fixture(); f.quelle.zeitbild.daten = Buffer.alloc(10).toString('base64');
  assert.ok(pruefeAntwort(f).some((m) => m.includes('daten')));
  assert.ok(pruefeAntwort(null).length > 0);
});

test('fuerHand drops the time picture and reduces the spectrum unless fein', () => {
  const f = fixture();
  const before = JSON.stringify(f);
  const h = fuerHand(f, false);
  assert.ok(!('zeitbild' in h.quelle));
  assert.ok(!('zeitbild' in h.vergleich));
  assert.equal(h.quelle.spektrum.hz.length, 30);
  assert.deepEqual(h.quelle.spektrum.hz, [...TERZ_HZ]);
  assert.equal(h.quelle.spektrum.mittel_db.length, 30);
  assert.equal(h.vergleich.spektrum.max_db.length, 30);
  assert.deepEqual(h.ueberdeckung, f.ueberdeckung);
  assert.deepEqual(h.hinweise, f.hinweise);
  assert.equal(fuerHand(f, true).quelle.spektrum.hz.length, 120);
  assert.ok(!('zeitbild' in fuerHand(f, true).quelle));
  assert.equal(JSON.stringify(f), before);
});

test('quellenSchluessel and hzText', () => {
  assert.equal(quellenSchluessel({ art: 'spur', id: 's1' }), 'spur:s1');
  assert.equal(quellenSchluessel({ art: 'master' }), 'master');
  assert.equal(quellenSchluessel(undefined), '');
  assert.equal(hzText(62), '62 Hz');
  assert.equal(hzText(3000), '3.0 kHz');
  assert.equal(hzText(16000), '16 kHz');
});

test('pruefeAntwort demands pegel_db in every stereo band', () => {
  assert.deepEqual(pruefeAntwort(fixture()), []);
  const f = fixture(); delete f.vergleich.stereo.baender[2].pegel_db;
  assert.ok(pruefeAntwort(f).some((m) => m.includes('vergleich.stereo.baender[2].pegel_db')));
  const g = fixture(); g.quelle.stereo.baender[0].pegel_db = '-3';
  assert.ok(pruefeAntwort(g).some((m) => m.includes('quelle.stereo.baender[0].pegel_db')));
});
