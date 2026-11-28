import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, rasterVon, StreifenAnalysator, maskierungPaare, resonanzVorschlag, resonanzBefehle, hinweiseQuelle } from '../project/sound_measurement.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';

const RATE = 48000;
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 * 2 - 1; }; }
// interleaved stereo from per-channel generators f(i)
function stereo(frames, fl, fr) {
  const a = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { a[2 * i] = fl(i); a[2 * i + 1] = fr(i); }
  return a;
}
const sine = (hz, amp) => (i) => amp * Math.sin(2 * Math.PI * hz * i / RATE);
function messen(a, block = a.length) {
  const an = new StreifenAnalysator(a.length / 2);
  for (let o = 0; o < a.length; o += block) an.schiebe(a.subarray(o, Math.min(a.length, o + block)));
  return an.ende();
}
const noise = (seed, amp = 0.3) => { const r = prng(seed); return () => amp * r(); };

test('fft of a unit impulse is flat and of a bin-centred cosine has one bin', () => {
  const re = new Float64Array(16), im = new Float64Array(16);
  re[0] = 1; fft(re, im);
  for (let k = 0; k < 16; k++) { assert.ok(Math.abs(re[k] - 1) < 1e-12); assert.ok(Math.abs(im[k]) < 1e-12); }
  const r2 = new Float64Array(16), i2 = new Float64Array(16);
  for (let n = 0; n < 16; n++) r2[n] = Math.cos(2 * Math.PI * 3 * n / 16);
  fft(r2, i2);
  for (let k = 0; k < 16; k++) {
    const m = Math.hypot(r2[k], i2[k]);
    if (k === 3 || k === 13) assert.ok(Math.abs(m - 8) < 1e-9); else assert.ok(m < 1e-9);
  }
});

test('rasterVon: short, normal and very long ranges', () => {
  assert.equal(rasterVon(6000).spalten, 1);
  assert.equal(rasterVon(8192).spalten, 1);
  assert.deepEqual(rasterVon(354462), { hop: 2048, spalten: 170 });
  const l = rasterVon(49152000);
  assert.ok(l.spalten <= 2048 && l.spalten >= 2040 && l.hop > 2048);
});

test('a 1 kHz sine at -6.02 dBFS reads -6.02 dB in its band', () => {
  const t = messen(stereo(2 * RATE, sine(1000, 0.5), sine(1000, 0.5)));
  const n = 67; // k = 14
  assert.ok(Math.abs(t.spektrum.mittel_db[n] - -6.02) < 0.3, String(t.spektrum.mittel_db[n]));
  assert.ok(Math.abs(t.spektrum.max_db[n] - -6.02) < 0.3);
  for (const o of [63, 71]) assert.ok(t.spektrum.mittel_db[o] < t.spektrum.mittel_db[n] - 30);
  const z = Buffer.from(t.zeitbild.daten, 'base64');
  assert.equal(z.length, t.zeitbild.spalten * 120);
  assert.ok(Math.abs(z[n] - 238) <= 2, String(z[n]));
  assert.equal(t.spalten * 30, t.spaltenTerz.length);
});

test('a full-scale sine: peak 0, rms -3.01, crest 3.01', () => {
  const t = messen(stereo(RATE, sine(997, 1), sine(997, 1)));
  assert.ok(Math.abs(t.spitze_db) < 0.05);
  assert.ok(Math.abs(t.rms_db - -3.01) < 0.05);
  assert.ok(Math.abs(t.crest_db - 3.01) < 0.05);
});

test('mono noise correlates 1 and has no width', () => {
  const g = noise(1);
  const m = new Float32Array(RATE); for (let i = 0; i < RATE; i++) m[i] = g();
  const t = messen(stereo(RATE, (i) => m[i], (i) => m[i]));
  assert.ok(t.stereo.korrelation >= 0.999);
  assert.equal(t.stereo.breite_db, -200);
  for (const b of t.stereo.baender) assert.ok(b.korrelation >= 0.99);
});

test('L = -R correlates -1', () => {
  const m = new Float32Array(RATE); const g = noise(2); for (let i = 0; i < RATE; i++) m[i] = g();
  const t = messen(stereo(RATE, (i) => m[i], (i) => -m[i]));
  assert.ok(t.stereo.korrelation <= -0.999);
  assert.ok(t.stereo.korrelation_min <= -0.999);
});

test('independent noise correlates near 0 and has 0 dB width', () => {
  const t = messen(stereo(2 * RATE, noise(3), noise(4)));
  assert.ok(Math.abs(t.stereo.korrelation) < 0.05);
  assert.ok(Math.abs(t.stereo.breite_db) < 0.5);
});

test('korrelation_min finds the cancelling half', () => {
  const m = new Float32Array(2 * RATE); const g = noise(5); for (let i = 0; i < m.length; i++) m[i] = g();
  const t = messen(stereo(2 * RATE, (i) => m[i], (i) => (i < RATE ? m[i] : -m[i])));
  assert.ok(t.stereo.korrelation_min <= -0.99);
  assert.ok(Math.abs(t.stereo.korrelation) < 0.1);
});

test('silence is stumm with the floor everywhere', () => {
  const t = messen(new Float32Array(RATE * 2));
  assert.equal(t.stumm, true);
  assert.equal(t.stereo.korrelation, 0);
  assert.equal(t.stereo.korrelation_min, 0);
  assert.equal(t.stereo.breite_db, -200);
  assert.ok(t.spektrum.mittel_db.every((v) => v === -200));
  assert.ok(t.spektrum.max_db.every((v) => v === -200));
  assert.ok(Buffer.from(t.zeitbild.daten, 'base64').every((v) => v === 0));
});

test('a range shorter than one window gives one column', () => {
  const t = messen(stereo(4800, sine(1000, 0.5), sine(1000, 0.5)));
  assert.equal(t.spalten, 1);
  const mx = Math.max(...t.spektrum.mittel_db);
  assert.equal(t.spektrum.mittel_db[67], mx);
  assert.ok(mx > -20);
  assert.equal(t.stereo.korrelation_min, t.stereo.korrelation);
});

test('0.3 s (one beat at 200 BPM) is longer than one window: four columns, whole-range correlation', () => {
  const t = messen(stereo(14400, sine(1000, 0.5), sine(1000, 0.5)));
  assert.equal(t.spalten, 4);
  assert.equal(t.stereo.korrelation_min, t.stereo.korrelation);
});

test('feeding in blocks gives the same result as one block', () => {
  const a = stereo(RATE, noise(6), sine(300, 0.4));
  assert.deepEqual(messen(a, 999 * 2), messen(a));
});

test('pegel_db: power of L plus R per stereo band', () => {
  const mono = messen(stereo(RATE, sine(60, 0.5), sine(60, 0.5)));
  assert.ok(Math.abs(mono.stereo.baender[0].pegel_db - -6.02) < 0.5, String(mono.stereo.baender[0].pegel_db));
  assert.ok(mono.stereo.baender[2].pegel_db < -60);
  const anti = messen(stereo(RATE, sine(60, 0.25), (i) => -sine(60, 0.25)(i)));
  assert.ok(Math.abs(anti.stereo.baender[0].pegel_db - -12.04) < 0.5, String(anti.stereo.baender[0].pegel_db));
  const still = messen(new Float32Array(RATE));
  assert.ok(still.stereo.baender.every((b) => b.pegel_db === -200 && b.korrelation === 0));
});

// The 1/12 bands are band integrals, not line levels. Below 400 Hz the mean spectrum comes from the long window (32768 frames), so a low note on the
// A440 grid reads close to its level in its own band; a range shorter than that window keeps the short one, whose main lobe is wider than a low band.
test('a full-scale low sine reads its level in its 1/12 band with the long window, and the band powers add up to 0 dB', async () => {
  const { terzVon } = await import('../project/sound_contract.ts');
  const t = messen(stereo(RATE * 2, sine(55, 1), sine(55, 1)));
  const n = 17;   // k = round(12 log2(55 / 440)) = -36, band index k + 53
  assert.ok(Math.abs(t.spektrum.hz[n] - 55) < 1, `band ${n} is ${t.spektrum.hz[n]} Hz`);
  assert.ok(Math.abs(t.spektrum.mittel_db[n]) <= 0.4, `${t.spektrum.mittel_db[n]} dB`);
  assert.ok(Math.abs(t.spektrum.max_db[n]) <= 0.4, `max ${t.spektrum.max_db[n]} dB`);
  const summe = 10 * Math.log10(t.spektrum.mittel_db.reduce((s, d) => s + 10 ** (d / 10), 0));
  assert.ok(Math.abs(summe) <= 0.1, `sum of the bands ${summe} dB`);
  assert.ok(Math.abs(Math.max(...terzVon(t.spektrum.mittel_db))) <= 0.3);
  assert.ok(Math.abs(t.spitze_db) < 0.01);
  const e1 = messen(stereo(RATE * 2, sine(41.2, 1), sine(41.2, 1)));   // E1: the band is 2.4 Hz wide
  assert.ok(e1.spektrum.mittel_db[12] > -1.5 && e1.spektrum.mittel_db[12] <= 0.1, `E1 ${e1.spektrum.mittel_db[12]} dB`);
  const a4 = messen(stereo(RATE * 2, sine(440, 1), sine(440, 1)));     // above 400 Hz the short window decides, as before
  assert.ok(Math.abs(a4.spektrum.mittel_db[53]) <= 0.1);
});

test('a range shorter than the long window keeps the short one: 55 Hz reads about -5.5 dB in its 1/12 band, -0.5 dB in its 1/3 octave band', async () => {
  const { terzVon } = await import('../project/sound_contract.ts');
  const t = messen(stereo(24000, sine(55, 1), sine(55, 1)));   // 0.5 s
  assert.ok(Math.abs(t.spektrum.mittel_db[17] - -5.5) <= 0.4, `${t.spektrum.mittel_db[17]} dB`);
  assert.ok(Math.abs(Math.max(...terzVon(t.spektrum.mittel_db)) - -0.5) <= 0.3);
});

test('the long window keeps the level of a mix: noise carries the same power below 400 Hz as with the short window, within 1 dB', () => {
  const tief = (t) => 10 * Math.log10(t.spektrum.mittel_db.slice(0, 51).reduce((s, d) => s + 10 ** (d / 10), 0));
  const lang = messen(stereo(RATE * 3, noise(5), noise(5)));
  const kurz = messen(stereo(30000, noise(5), noise(5)));
  assert.ok(Math.abs(tief(lang) - tief(kurz)) <= 1, `${tief(lang)} against ${tief(kurz)} dB`);
  assert.equal(lang.zeitbild.zeilen, 120);
});

test('the lowest stereo band counts only bins from 20 Hz', () => {
  const dc = messen(stereo(RATE, () => 0.5, () => 0.5));   // pure DC: nothing above 20 Hz
  assert.ok(dc.stereo.baender[0].pegel_db <= -100, `${dc.stereo.baender[0].pegel_db}`);
  const b = messen(stereo(RATE, sine(60, 0.5), sine(60, 0.5)));
  assert.ok(b.stereo.baender[0].pegel_db > -20 && b.stereo.baender[0].korrelation > 0.99);
});

// ---- strand 5 slice 6: masking over all pairs ----
const teilVon = (hz, amp, sek = 1.5) => { const m = messen(stereo(RATE * sek, sine(hz, amp), sine(hz, amp))); return { m, pegel_db: m.rms_db }; };

test('maskierungPaare: only the pair that shares a band is listed, the cut goes on the quieter strip', () => {
  const a = teilVon(100, 0.5), b = teilVon(100, 0.2), c = teilVon(3000, 0.3);
  const r = maskierungPaare([{ id: 'S1', ...a }, { id: 'S2', ...b }, { id: 'S3', ...c }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].a, 'S1'); assert.equal(r[0].b, 'S2'); assert.equal(r[0].leiser, 'S2');
  assert.ok(r[0].hz_von < 100 && r[0].hz_bis > 100 && r[0].anteil >= 0.5);
  const v = r[0].vorschlag;
  assert.equal(v.strang_id, 'S2'); assert.equal(v.gain_db, -3);
  assert.ok(Math.abs(v.hz - 100) < 15, `centre ${v.hz}`);
  assert.ok(v.q >= 0.7 && v.q <= 6);
  assert.deepEqual(v.befehle, [{ befehl: 'insert_setzen', strang_id: 'S2', pos: 0, art: 'eq',
    werte: { 'b4/an': 1, 'b4/typ': 0, 'b4/freq': v.hz, 'b4/q': v.q, 'b4/gain': -3 } }]);
});

test('maskierungPaare: fewer than two sounding strips and silent strips give an empty list', () => {
  const a = teilVon(100, 0.5);
  assert.deepEqual(maskierungPaare([]), []);
  assert.deepEqual(maskierungPaare([{ id: 'S1', ...a }]), []);
  const stumm = { m: messen(new Float32Array(RATE * 2)), pegel_db: -200 };
  assert.equal(stumm.m.stumm, true);
  assert.deepEqual(maskierungPaare([{ id: 'S1', ...a }, { id: 'S2', ...stumm }]), []);
});

test('maskierungPaare: a full chain lists the conflict without a proposal, the dynamic variant adds the d-rows, the position is taken over', () => {
  const a = teilVon(100, 0.5), b = teilVon(100, 0.2);
  const voll = maskierungPaare([{ id: 'S1', ...a }, { id: 'S2', ...b, pos: null }]);
  assert.equal(voll.length, 1); assert.equal(voll[0].vorschlag, null);
  const dyn = maskierungPaare([{ id: 'S1', ...a }, { id: 'S2', ...b, pos: 2 }], 5, { dynamisch: true, band: 5 });
  const w = dyn[0].vorschlag.befehle[0];
  assert.equal(w.pos, 2); assert.equal(w.werte['b5/gain'], -3); assert.equal(w.werte['d5/dyn'], 1);
  assert.ok(Number.isFinite(w.werte['d5/schwelle']) && w.werte['d5/schwelle'] < 0);
});

test('maskierungPaare: at most `max` pairs, best score first, and the 24 loudest strips only', () => {
  const laut = teilVon(100, 0.5), leise = teilVon(100, 0.2);
  const teile = [];
  for (let i = 0; i < 26; i++) teile.push({ id: `L${i}`, ...laut });
  teile.push({ id: 'ZZ', ...leise });
  const r = maskierungPaare(teile, 5);
  assert.equal(r.length, 5);
  assert.ok(r.every((x) => x.a !== 'ZZ' && x.b !== 'ZZ'), 'the 27th, quiet strip is outside the 24 loudest');
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  assert.equal(maskierungPaare(teile, 0).length, 0);
});

// ---- strand 5 slice 5: tame resonances ----
function alsMessung(t, name) {
  return { quelle: { art: 'spur', id: 's1' }, name, stumm: t.stumm,
    lautheit: { lufs_i: null, lufs_s_max: null, lufs_m_max: null, lra: null, true_peak_dbtp: null, spitze_db: null, rms_db: null, crest_db: null },
    stereo: t.stereo, spektrum: t.spektrum, zeitbild: t.zeitbild };
}
// noise with up to `freqs.length` strong sines on top, 4 s
function rauschMitTonen(freqs, seed = 11) {
  const r1 = prng(seed), r2 = prng(seed + 1), n1 = new Float32Array(4 * RATE), n2 = new Float32Array(4 * RATE);
  for (let i = 0; i < n1.length; i++) { n1[i] = 0.1 * r1(); n2[i] = 0.1 * r2(); }
  const basis = messen(stereo(4 * RATE, (i) => n1[i], (i) => n2[i]));
  const amp = 10 ** ((basis.spektrum.mittel_db[87] + 20) / 20);
  return messen(stereo(4 * RATE, (i) => n1[i] + freqs.reduce((a, f) => a + sine(f, amp)(i), 0), (i) => n2[i] + freqs.reduce((a, f) => a + sine(f, amp)(i), 0)));
}
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
const projektMitSpur = () => lauf(neuesProjekt('Tame'), [{ befehl: 'spur_neu', art: 'audio', name: 'Pad' }]);

test('resonanzVorschlag: up to three dynamic Bell bands from the resonance hints, threshold = band level minus 3 dB', () => {
  const m = alsMessung(rauschMitTonen([500, 1200, 3000, 7000]), 'Pad');
  const v = resonanzVorschlag(m);
  assert.equal(v.length, 3, JSON.stringify(v));
  const hinweise = hinweiseQuelle(m).filter((h) => h.art === 'resonanz');
  assert.deepEqual(v.map((x) => x.hz), hinweise.map((h) => Math.round(h.hz * 10) / 10), 'the same resonances, strongest first');
  for (const b of v) {
    assert.equal(b.q, 8); assert.equal(b.bereich_db, -6);
    const n = m.spektrum.hz.findIndex((hz) => Math.abs(hz - b.hz) < 1e-6 * hz + 0.06);
    assert.ok(n >= 0, `band of ${b.hz} Hz`);
    assert.ok(Math.abs(b.schwelle_db - (m.spektrum.mittel_db[n] - 3)) <= 0.05, `${b.schwelle_db} vs ${m.spektrum.mittel_db[n] - 3}`);
    assert.ok(b.schwelle_db >= -60 && b.schwelle_db <= 0);
  }
});

test('resonanzVorschlag: noise without a peak and a silent source give nothing', () => {
  assert.deepEqual(resonanzVorschlag(alsMessung(rauschMitTonen([]), 'Pad')), []);
  const stumm = alsMessung(messen(new Float32Array(RATE * 2)), 'Mute');
  assert.equal(stumm.stumm, true);
  assert.deepEqual(resonanzVorschlag(stumm), []);
});

test('resonanzBefehle: a strip without an EQ gets one new EQ stage with the bands as Bell and dyn 1, accepted by the project model', () => {
  const v = resonanzVorschlag(alsMessung(rauschMitTonen([500, 1200, 3000]), 'Pad'));
  assert.equal(v.length, 3);
  const b = resonanzBefehle(v, { id: 's1', kette: 0, eq: null });
  assert.equal(b.length, 1);
  assert.equal(b[0].befehl, 'insert_setzen'); assert.equal(b[0].art, 'eq'); assert.equal(b[0].pos, 0);
  const w = lauf(projektMitSpur(), b).spuren[0].inserts[0].werte;
  v.forEach((x, i) => {
    const k = i + 1;
    assert.deepEqual([w[`b${k}/an`], w[`b${k}/typ`], w[`b${k}/freq`], w[`b${k}/gain`], w[`b${k}/q`], w[`d${k}/dyn`], w[`d${k}/schwelle`], w[`d${k}/bereich`]],
      [1, 0, x.hz, 0, 8, 1, x.schwelle_db, -6]);
  });
  assert.equal(w['b4/an'], 0, 'the other bands stay off');
});

test('resonanzBefehle: the first EQ with enough free bands takes them, as one command list the model applies', () => {
  let p = projektMitSpur();
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: { 'b1/an': 1, 'b1/freq': 100, 'b3/an': 1, 'b3/freq': 900 } }]);
  const v = resonanzVorschlag(alsMessung(rauschMitTonen([500, 1200, 3000]), 'Pad'));
  const b = resonanzBefehle(v, { id: 's1', kette: 1, eq: { insert_id: 'i1', frei: [2, 4, 5, 6, 7, 8] } });
  assert.ok(b.every((x) => x.befehl === 'insert_param_setzen' && x.insert_id === 'i1'));
  const r = fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
  const w = r.spuren[0].inserts[0].werte;
  assert.equal(r.spuren[0].inserts.length, 1, 'no new stage');
  assert.deepEqual([w['b1/freq'], w['b3/freq']], [100, 900], 'the used bands are untouched');
  [2, 4, 5].forEach((k, i) => assert.deepEqual([w[`b${k}/an`], w[`b${k}/freq`], w[`d${k}/dyn`], w[`d${k}/schwelle`], w[`d${k}/bereich`]], [1, v[i].hz, 1, v[i].schwelle_db, -6]));
});

test('resonanzBefehle: too few free bands -> a new stage if the chain has room; chain full -> the free bands as far as they go; nothing fits -> null', () => {
  const v = resonanzVorschlag(alsMessung(rauschMitTonen([500, 1200, 3000]), 'Pad'));
  assert.equal(resonanzBefehle([], { id: 's1', kette: 0, eq: null }), null);
  const eng = { insert_id: 'i1', frei: [7, 8] };
  const neu = resonanzBefehle(v, { id: 's1', kette: 4, eq: eng });
  assert.deepEqual(neu.map((x) => x.befehl), ['insert_setzen']);
  const voll = resonanzBefehle(v, { id: 's1', kette: 5, eq: eng });
  assert.ok(voll.every((x) => x.befehl === 'insert_param_setzen'));
  assert.deepEqual([...new Set(voll.map((x) => x.param.match(/^[bd](\d)/)[1]))], ['7', '8'], 'only the two free bands');
  assert.equal(resonanzBefehle(v, { id: 's1', kette: 5, eq: null }), null);
  assert.equal(resonanzBefehle(v, { id: 's1', kette: 5, eq: { insert_id: 'i1', frei: [] } }), null);
  // a full chain on the model: the one-stage list is refused, the param list is accepted
  let p = projektMitSpur();
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap((k) => [[`b${k}/an`, 1]])) },
    ...['komp', 'saett', 'lim', 'gate'].map((art) => ({ befehl: 'insert_setzen', strang_id: 's1', pos: 1, art }))]);
  assert.equal(p.spuren[0].inserts.length, 5);
  const geht = resonanzBefehle(v, { id: 's1', kette: 5, eq: { insert_id: p.spuren[0].inserts.find((i) => i.art === 'eq').id, frei: [7, 8] } });
  const w = lauf(p, geht).spuren[0].inserts.find((i) => i.art === 'eq').werte;
  assert.deepEqual([w['b7/an'], w['b8/an'], w['d7/dyn'], w['d8/dyn']], [1, 1, 1, 1]);
});
