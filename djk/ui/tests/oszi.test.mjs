// Oscilloscope: oszi() condenses the 1 ms envelope ring records of one channel (pure function, synthetic records).
import test from 'node:test';
import assert from 'node:assert/strict';
import { oszi } from '../ear.ts';

// One record per ms; amp(i) gives the peak, bands follow the peak (band 0 = sub, band 1 = low).
function reihe(n, amp, lowAmp = (i) => amp(i) * 0.5) {
  return Array.from({ length: n }, (_, i) => ({
    sample: i * 48, beat: i / 500, quell: NaN, band: [lowAmp(i), 0, 0, 0, 0, 0], k: 0, spitze: amp(i),
  }));
}
const db = (x) => 20 * Math.log10(x);
const endlich = (o) => {   // every number anywhere in the answer is finite (JSON would turn NaN/Infinity into null)
  if (typeof o === 'number') assert.ok(Number.isFinite(o));
  else if (o && typeof o === 'object') Object.values(o).forEach(endlich);
};

test('oszi: a known onset is found with time relative to the window end and its strength in dB', () => {
  // 2000 ms quiet (0.001), then loud (0.5) from ms 1000 on: end is ms 1999, so the onset sits near -1000 ms
  const r = oszi(reihe(2000, (i) => (i < 1000 ? 0.001 : 0.5)), { sek: 2, bpm: null });
  assert.equal(r.einsaetze.length, 1);
  assert.ok(Math.abs(r.einsaetze[0].t_ms - -1000) <= 20, `t_ms ${r.einsaetze[0].t_ms}`);
  assert.ok(Math.abs(r.einsaetze[0].db - db(500)) <= 3, `db ${r.einsaetze[0].db}`);
  assert.ok(Math.abs(r.spitze_db - db(0.5)) < 0.1);
  assert.ok(r.spitze_t_ms <= 0 && r.spitze_t_ms >= -1000);
  assert.equal(r.pumptiefe_db, null);   // no tempo
  assert.deepEqual(r.klick_verdacht, []);
  endlich(r);
});

test('oszi: a 6 dB duck on every beat gives a pump depth of about 6 dB, independent of the phase', () => {
  const bpm = 120;   // 500 ms per beat; duck to half amplitude for 100 ms at each beat start
  for (const phase of [0, 130, 333]) {
    const r = oszi(reihe(4000, (i) => (((i + phase) % 500) < 100 ? 0.25 : 0.5)), { sek: 4, bpm });
    assert.ok(Math.abs(r.pumptiefe_db - 6.02) < 0.5, `phase ${phase}: ${r.pumptiefe_db}`);
  }
  // steady tone: no pumping
  const still = oszi(reihe(4000, () => 0.5), { sek: 4, bpm });
  assert.ok(Math.abs(still.pumptiefe_db) < 0.1);
});

test('oszi: pump depth is null without tempo and null with less than one beat of data', () => {
  assert.equal(oszi(reihe(4000, () => 0.5), { sek: 4, bpm: 0 }).pumptiefe_db, null);
  assert.equal(oszi(reihe(300, () => 0.5), { sek: 1, bpm: 120 }).pumptiefe_db, null);
});

test('oszi: a single-ms jump over both neighbours is a click suspect, not an onset', () => {
  const r = oszi(reihe(1000, (i) => (i === 700 ? 0.9 : 0.05)), { sek: 1, bpm: null });
  assert.deepEqual(r.klick_verdacht, [-299]);
  assert.equal(r.einsaetze.length, 0);
  // a plain step is no click
  assert.deepEqual(oszi(reihe(1000, (i) => (i < 500 ? 0.01 : 0.5)), { sek: 1, bpm: null }).klick_verdacht, []);
  // the threshold is named and settable
  assert.deepEqual(oszi(reihe(1000, (i) => (i === 700 ? 0.1 : 0.05)), { sek: 1, bpm: null, klickSchwelleDb: 3 }).klick_verdacht, [-299]);
  assert.deepEqual(oszi(reihe(1000, (i) => (i === 700 ? 0.1 : 0.05)), { sek: 1, bpm: null }).klick_verdacht, []);
});

test('oszi: the envelope has at most 600 points with min and max, short peaks survive', () => {
  const r = oszi(reihe(15000, (i) => (i === 7777 ? 0.9 : 0.01)), { sek: 15, bpm: null });
  assert.ok(r.huellkurve_max_db.length <= 600 && r.huellkurve_max_db.length > 100);
  assert.equal(r.huellkurve_min_db.length, r.huellkurve_max_db.length);
  assert.ok(Math.max(...r.huellkurve_max_db) > db(0.9) - 0.2);
  assert.ok(r.huellkurve_min_db.every((v, i) => v <= r.huellkurve_max_db[i]));
  assert.ok(r.ms_je_punkt >= 25);
});

test('oszi: silence and empty input give clean zero values', () => {
  for (const eingabe of [reihe(1000, () => 0, () => 0), []]) {
    const r = oszi(eingabe, { sek: 1, bpm: 120 });
    assert.equal(r.spitze_db, -200);
    assert.equal(r.rms_db, -200);
    assert.deepEqual(r.einsaetze, []);
    assert.deepEqual(r.klick_verdacht, []);
    assert.ok(r.pumptiefe_db === null || r.pumptiefe_db === 0);
    endlich(r);
    JSON.parse(JSON.stringify(r));
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') assert.ok(Number.isFinite(v), k);
  }
  assert.equal(oszi([], { sek: 1, bpm: null }).n, 0);
});

test('oszi: fewer records than requested use what is there and say so', () => {
  const r = oszi(reihe(500, () => 0.5), { sek: 5, bpm: null });
  assert.equal(r.n, 500);
  assert.equal(r.angefragt_ms, 5000);
  assert.equal(r.verfuegbar_ms, 500);
  assert.equal(r.vollstaendig, false);
  assert.equal(oszi(reihe(5000, () => 0.5), { sek: 5, bpm: null }).vollstaendig, true);
  // more records than requested: only the last ones count
  const j = oszi(reihe(3000, (i) => (i < 1000 ? 0.9 : 0.1)), { sek: 1, bpm: null });
  assert.ok(Math.abs(j.spitze_db - db(0.1)) < 0.1);
});
