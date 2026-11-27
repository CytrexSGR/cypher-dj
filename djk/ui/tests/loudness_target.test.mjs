// Export delivery plan, task 3: the loudness target check (leseZiel, pruefeZiel). The route tests are in proj_export_abgabe.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leseZiel, pruefeZiel } from '../project/loudness.ts';
import { pruefeAntwortZiel } from '../areas/proj/output.ts';

test('pruefeZiel: distances and the ceiling', () => {
  const l = { lufs_i: -9.3, lra: 4, true_peak_dbtp: -0.4 };
  assert.deepEqual(pruefeZiel(l, { lufs_i: -14, true_peak_dbtp: -1 }), { lufs_abstand: 4.7, tp_abstand: 0.6, tp_ueber: true });
  assert.deepEqual(pruefeZiel(l, { lufs_i: -14 }), { lufs_abstand: 4.7, tp_abstand: null, tp_ueber: false });
  assert.deepEqual(pruefeZiel({ lufs_i: null, lra: null, true_peak_dbtp: null }, { lufs_i: -14, true_peak_dbtp: -1 }), { lufs_abstand: null, tp_abstand: null, tp_ueber: null });
  assert.deepEqual(pruefeZiel({ lufs_i: -14, lra: 3, true_peak_dbtp: -1 }, { true_peak_dbtp: -1 }), { lufs_abstand: null, tp_abstand: 0, tp_ueber: false });
});

test('pruefeZiel: a loudness target alone with no measurement leaves tp_ueber false, rounding is to 0.1', () => {
  const n = { lufs_i: null, lra: null, true_peak_dbtp: null };
  assert.deepEqual(pruefeZiel(n, { lufs_i: -14 }), { lufs_abstand: null, tp_abstand: null, tp_ueber: false });
  assert.deepEqual(pruefeZiel({ lufs_i: -13.96, lra: 1, true_peak_dbtp: -1.04 }, { lufs_i: -14, true_peak_dbtp: -1 }), { lufs_abstand: 0, tp_abstand: 0, tp_ueber: false });
});

test('leseZiel accepts one or both fields', () => {
  assert.deepEqual(leseZiel({ lufs_i: -14 }), { lufs_i: -14 });
  assert.deepEqual(leseZiel({ lufs_i: -40, true_peak_dbtp: 0 }), { lufs_i: -40, true_peak_dbtp: 0 });
  assert.deepEqual(leseZiel({ true_peak_dbtp: -20 }), { true_peak_dbtp: -20 });
});

test('leseZiel refuses an empty target, text values and values outside the ranges', () => {
  const faelle = [[{}, 'ziel'], [{ lufs_i: '−14' }, 'ziel.lufs_i'], [{ lufs_i: 1 }, 'ziel.lufs_i'], [{ lufs_i: -41 }, 'ziel.lufs_i'],
    [{ true_peak_dbtp: -21 }, 'ziel.true_peak_dbtp'], [{ true_peak_dbtp: 0.5 }, 'ziel.true_peak_dbtp'], [{ true_peak_dbtp: NaN }, 'ziel.true_peak_dbtp'],
    [{ farbe: 1 }, 'ziel.farbe'], [null, 'ziel'], [[], 'ziel'], ['x', 'ziel']];
  for (const [v, feld] of faelle) {
    assert.throws(() => leseZiel(v), (e) => e instanceof Error && e.message.includes(feld), JSON.stringify(v));
  }
});

test('pruefeZiel: a distance of -0.04 rounds to 0, never to -0', () => {
  const r = pruefeZiel({ lufs_i: -14.04, lra: 1, true_peak_dbtp: -1.04 }, { lufs_i: -14, true_peak_dbtp: -1 });
  assert.ok(Object.is(r.lufs_abstand, 0), `lufs_abstand ${Object.is(r.lufs_abstand, -0) ? '-0' : r.lufs_abstand}`);
  assert.ok(Object.is(r.tp_abstand, 0), `tp_abstand ${Object.is(r.tp_abstand, -0) ? '-0' : r.tp_abstand}`);
});

// ziel_ok is formed in pruefeAntwortZiel: false (a true peak above the ceiling) wins over null (a measurement a target needs is missing), else true
const mess = (lufs_i, tp) => ({ lufs_i, lra: lufs_i === null ? null : 3, true_peak_dbtp: tp });
const antwort = (master, abgaben) => ({ datei: '/x.wav', ...master, ...(abgaben ? { abgaben } : {}) });
const abg = (m, datei = '/x.16bit-44k.wav') => ({ format: 'wav', rate_hz: 44100, bits: 16, dither: 'tpdf', datei, ...m });
const okVon = (a, z) => { pruefeAntwortZiel(a, z); return a.ziel_ok; };

test('ziel_ok: a lufs target without a loudness measurement is null, with it true', () => {
  assert.equal(okVon(antwort(mess(null, null)), { lufs_i: -14 }), null);
  assert.equal(okVon(antwort(mess(null, -3)), { lufs_i: -14 }), null, 'a true peak alone does not measure the loudness');
  assert.equal(okVon(antwort(mess(-14, null)), { lufs_i: -14 }), true, 'a lufs target needs no true peak');
  assert.equal(okVon(antwort(mess(null, -3)), { true_peak_dbtp: -1 }), true, 'a true peak target needs no loudness');
  assert.equal(okVon(antwort(mess(-9, null)), { true_peak_dbtp: -1 }), null);
});

test('ziel_ok: one unmeasured delivery makes it null, a delivery without a file does not count, a file above the ceiling wins', () => {
  const z = { lufs_i: -14, true_peak_dbtp: -1 };
  const gut = mess(-14, -3);
  assert.equal(okVon(antwort(gut, [abg(gut), abg(mess(null, null))]), z), null);
  assert.equal(okVon(antwort(gut, [abg(gut), abg(mess(null, null), null)]), z), true, 'datei null is not a written file');
  assert.equal(okVon(antwort(gut, [abg(mess(-14, 0.5)), abg(mess(null, null))]), z), false);
  assert.equal(okVon(antwort(mess(null, null), [abg(mess(-14, 0.5))]), z), false, 'also with an unmeasured master');
  assert.equal(okVon(antwort(gut, [abg(gut), abg(gut)]), z), true);
});
