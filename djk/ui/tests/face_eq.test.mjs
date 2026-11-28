// Device faces, EQ: the target response is pinned to eq_dsp by the golden table (the same CSV the Rust test eq_dsp/tests/eq.rs::soll_tabelle_golden recomputes from
// soll_db and proportional_q and measures the real DSP against), the drawing equals the target, the handle drag writes the rows' commands, and a closed face costs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EQ_ACHSEN, eqBandDb, eqSummeDb, eqKurve, eqGriffLage, eqGriffZiehen, eqProportionalQ, baueEqFace } from '../public/face/eq.js';
import { baueAnzeige } from '../public/face/display.js';
import { oeffneFace } from '../public/face/frame.js';
import { neuesDokument } from './support/face_dom.mjs';

const CSV = new URL('../../instruments/eq_dsp/tests/data/eq_soll.csv', import.meta.url);
const zeilen = () => {
  const [kopf, ...rest] = fs.readFileSync(CSV, 'utf8').trim().split('\n');
  assert.equal(kopf, 'typ,freq,gain,q,steil,prop_q,f_hz,db');
  return rest.map((z) => z.split(',').map(Number));
};
const bandVon = (v) => ({ typ: v[0], freq: v[1], gain: v[2], q: v[3], steil: v[4] });
const nah = (a, b, tol, text) => assert.ok(Math.abs(a - b) < tol, `${text}: ${a} vs ${b}`);

test('face/eq.js: every row of the golden table (Rust side) equals eqBandDb within 1e-9', () => {
  const rows = zeilen();
  assert.ok(rows.length >= 60, `only ${rows.length} rows`);
  assert.deepEqual([...new Set(rows.map((r) => r[0]))].sort(), [0, 1, 2, 3, 4, 5, 6], 'all seven types');
  assert.deepEqual([...new Set(rows.filter((r) => r[0] >= 3 && r[0] <= 4).map((r) => r[4]))].sort(), [0, 1, 2, 3], 'all slopes of the cuts');
  assert.deepEqual([...new Set(rows.filter((r) => r[0] === 0).map((r) => r[5]))].sort(), [0, 1], 'proportional Q on and off for the bell');
  for (const v of rows) nah(eqBandDb(bandVon(v), v[6], v[5] === 1), v[7], 1e-9, `row ${v.join(',')}`);
});

test('face/eq.js: named values of the target (the Q of the cut is exactly Math.SQRT1_2, the Rust FRAC_1_SQRT_2)', () => {
  assert.equal(eqBandDb({ typ: 0, freq: 1000, gain: 12, q: 1, steil: 0 }, 1000).toFixed(3), '12.000');
  assert.equal(eqBandDb({ typ: 0, freq: 1000, gain: -6, q: 2, steil: 0 }, 1000).toFixed(3), '-6.000');
  const cut = (q) => eqBandDb({ typ: 3, freq: 80, gain: 0, q, steil: 1 }, 80);
  nah(cut(Math.SQRT1_2), -3.0103, 1e-4, 'low cut 24 dB/oct at its frequency');
  assert.ok(Math.abs(cut(0.707) - -3.0103) > 5e-4, 'the typed literal 0.707 is not the DSP value (it gives -3.0116)');
  nah(eqBandDb({ typ: 2, freq: 1000, gain: 9, q: Math.SQRT1_2, steil: 0 }, 22000), 9, 0.3, 'high shelf plateau');
  nah(eqBandDb({ typ: 1, freq: 1000, gain: 9, q: Math.SQRT1_2, steil: 0 }, 10), 9, 0.3, 'low shelf plateau');
  // proportional Q: q at 12 dB, half at 0 dB, one and a half at 24 dB, clamped 0.1..18
  assert.equal(eqProportionalQ(2, 12), 2); assert.equal(eqProportionalQ(2, 0), 1); assert.equal(eqProportionalQ(2, -24), 3); assert.equal(eqProportionalQ(18, 24), 18); assert.equal(eqProportionalQ(0.1, 0), 0.1);
  const b = { typ: 0, freq: 1000, gain: 6, q: 2, steil: 0 };
  assert.ok(eqBandDb(b, 700, true) !== eqBandDb(b, 700, false), 'the proportional switch changes a bell');
  assert.equal(eqBandDb({ ...b, typ: 1 }, 700, true), eqBandDb({ ...b, typ: 1 }, 700, false), 'and only a bell');
});

const leer = () => ({});
const band = (m, o) => Object.fromEntries(Object.entries({ an: 1, ...o }).map(([k, v]) => [`b${m}/${k}`, v]));

test('face/eq.js eqSummeDb: all bands off is the output gain, two bands add, placement decides what the curve shows', () => {
  assert.equal(eqSummeDb(leer(), 1000), 0);
  assert.equal(eqSummeDb({ out: -3, ...band(1, { an: 0, typ: 0, gain: 12 }) }, 1000), -3);
  const eins = band(1, { typ: 0, freq: 1000, gain: 6, q: 1 }), zwei = band(2, { typ: 0, freq: 1000, gain: -2, q: 1 });
  nah(eqSummeDb({ ...eins, ...zwei }, 1000), 4, 1e-9, 'two bands at one frequency add in dB');
  nah(eqSummeDb({ ...eins, ...zwei, out: 1.5 }, 1000), 5.5, 1e-9, 'plus the output');
  const mid = band(1, { typ: 0, freq: 1000, gain: 6, q: 1, platz: 1 }), side = band(2, { typ: 0, freq: 1000, gain: 9, q: 1, platz: 2 });
  nah(eqSummeDb({ ...mid, ...side }, 1000, 'mitte'), 6, 1e-9, 'centred: Stereo and Mid');
  nah(eqSummeDb({ ...mid, ...side }, 1000, 'seite'), 9, 1e-9, 'side: Stereo and Side');
  assert.equal(eqSummeDb({ propq: 1, ...band(1, { typ: 0, freq: 1000, gain: 12, q: 1 }) }, 700).toFixed(6), eqBandDb({ typ: 0, freq: 1000, gain: 12, q: 1 }, 700, true).toFixed(6), 'propq reads the stage switch');
});

test('face/eq.js: a notch at its exact centre is the floor, no NaN or Infinity anywhere in a path, junk in an old project is clamped', () => {
  assert.equal(eqBandDb({ typ: 5, freq: 1000, gain: 0, q: 1, steil: 0 }, 1000), -120);
  const dok = neuesDokument(), host = dok.createElement('div');
  const ds = baueAnzeige(host, { breite: 720, hoehe: 320, rand: 30, x: EQ_ACHSEN.x, y: EQ_ACHSEN.y, gitterX: [100], gitterY: [0] });
  const werte = { ...band(1, { typ: 5, freq: 10, q: 18 }), ...band(2, { typ: 5, freq: 22000, q: 0.1 }), ...band(3, { typ: 6, freq: 30000, q: 99 }), ...band(4, { typ: 'x', freq: NaN, gain: Infinity, q: -5, steil: 9 }), out: NaN, propq: 'y' };
  for (const platz of ['mitte', 'seite']) {
    const k = eqKurve(werte, platz);
    assert.ok(k.every(([f, y]) => Number.isFinite(f) && Number.isFinite(y)), 'finite points');
    const d = ds.pfad('fa-eq-kurve', k).getAttribute('d');
    assert.ok(d.length > 100 && !/NaN|Infinity/.test(d), d.slice(0, 80));
  }
  // exactly at the notch centre as a point of the curve
  const n = eqKurve(band(1, { typ: 5, freq: 10, q: 1 }), 'mitte', 5);
  assert.ok(n.every(([, y]) => Number.isFinite(y)) && n[0][1] === -120);
  const lage = eqGriffLage(band(3, { typ: 0, freq: 30000, gain: 99 }), 3);
  assert.deepEqual([lage.freq, lage.db], [22000, 24]);
});

test('face/eq.js: handle position and drag values (clamped, gain to 0.1 dB, none for types without a gain)', () => {
  const w = { ...band(2, { typ: 0, freq: 500, gain: 4.5 }), ...band(3, { typ: 3, freq: 80, gain: 7 }), ...band(4, { typ: 5, freq: 3000 }), ...band(5, { typ: 6, freq: 3000 }), ...band(6, { typ: 4, freq: 9000 }) };
  assert.deepEqual(eqGriffLage(w, 2), { freq: 500, db: 4.5, gainFrei: true });
  for (const m of [3, 4, 5, 6]) { const l = eqGriffLage(w, m); assert.equal(l.gainFrei, false, `band ${m}`); assert.equal(l.db, 0, `band ${m} sits on 0 dB`); }
  assert.deepEqual(eqGriffZiehen(w, 2, { freq: 1234.5678, db: 3.14159 }), { 'b2/freq': 1234.57, 'b2/gain': 3.1 });
  assert.deepEqual(eqGriffZiehen(w, 2, { freq: 3, db: -40 }), { 'b2/freq': 10, 'b2/gain': -24 });
  assert.deepEqual(eqGriffZiehen(w, 2, { freq: 99999, db: 40 }), { 'b2/freq': 22000, 'b2/gain': 24 });
  assert.deepEqual(eqGriffZiehen(w, 3, { freq: 100, db: 12 }), { 'b3/freq': 100 }, 'a cut has no gain');
  for (const m of [4, 5, 6]) assert.equal('b' + m + '/gain' in eqGriffZiehen(w, m, { freq: 100, db: 5 }), false);
});

test('face/eq.js drawn equals DSP: path points convert back to the target of the stage within 0.05 dB (the filter itself follows the target within 0.5 dB, eq_dsp soll_tabelle_golden)', () => {
  const dok = neuesDokument(), host = dok.createElement('div');
  const ds = baueAnzeige(host, { breite: 720, hoehe: 320, rand: 30, x: EQ_ACHSEN.x, y: EQ_ACHSEN.y, gitterX: [100], gitterY: [0] });
  const rows = zeilen().filter((r) => r[7] > -28 && r[7] < 28 && r[0] !== 5 && r[0] !== 6);
  let n = 0;
  for (const v of rows.filter((_, i) => i % 9 === 0)) {
    const werte = band(1, { typ: v[0], freq: v[1], gain: v[2], q: v[3], steil: v[4] });
    werte.propq = v[5];
    const kurve = eqKurve(werte, 'mitte', 400);
    const pfad = ds.pfad('fa-eq-kurve', kurve);
    const punkte = pfad.getAttribute('d').split(/ ?[ML]/).filter(Boolean).map((p) => p.split(',').map(Number));
    assert.equal(punkte.length, 400);
    // the path point nearest to the row's frequency: its frequency (from x) and its level (from y) against the target at that frequency
    let i = 0;
    for (let k = 0; k < 400; k++) if (Math.abs(Math.log(kurve[k][0] / v[6])) < Math.abs(Math.log(kurve[i][0] / v[6]))) i = k;
    const f = ds.wertX(punkte[i][0]), y = ds.wertY(punkte[i][1]);
    const soll = eqBandDb(bandVon(v), kurve[i][0], v[5] === 1);
    if (Math.abs(soll) < 30) nah(y, soll, 0.05, `row ${v.join(',')}`);
    assert.ok(Math.abs(Math.log(f / kurve[i][0])) < 0.01, `x of ${v}`);
    pfad.remove(); n++;
  }
  assert.ok(n >= 8, `${n} rows checked`);
});

// ---- the face with the fake DOM: the drag, a refused write, the cost of a closed face
function quelleDouble() {
  const werte = { ...band(2, { typ: 0, freq: 1000, gain: 6, q: 1 }), ...band(3, { an: 0, typ: 0, freq: 4000, gain: 0, q: 1 }), ...band(4, { typ: 3, freq: 80 }) };
  const q = { werte, gesendet: [], antwort: true, gesperrt: new Set(),
    get: (n) => q.werte[n], gesperrt_: undefined,
    set: (n, v) => { q.gesendet.push(['set', n, v]); return Promise.resolve(q.antwort); },
    griff: (m, w, ein) => { q.gesendet.push(['griff', m, { ...w }, ein]); return Promise.resolve(q.antwort); },
    an: { get: () => true, set() {} } };
  q.gesperrt = (n) => q.sperren?.has(n) === true;
  return q;
}
const baue = () => {
  const dok = neuesDokument(), host = dok.createElement('div'), q = quelleDouble();
  const f = baueEqFace(host, q);
  const griff = (m) => host.finde('fa-griff').find((e) => e.dataset.band === String(m));
  const pfad = () => host.finde('fa-eq-kurve')[0].getAttribute('d');
  const lage = (m) => ({ x: Number(griff(m).getAttribute('cx')), y: Number(griff(m).getAttribute('cy')) });
  const zieh = (m, dx, dy, ende = true) => {
    const g = griff(m), p = lage(m);
    g.feuere('pointerdown', { pointerId: 1, clientX: p.x, clientY: p.y });
    g.feuere('pointermove', { pointerId: 1, clientX: p.x + dx, clientY: p.y + dy });
    if (ende) g.feuere('pointerup', { pointerId: 1 });
  };
  return { dok, host, q, f, griff, pfad, lage, zieh };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

test('face/eq.js: eight handles; a band that is off is a hollow ring; the selected one is marked', () => {
  const { host, griff } = baue();
  assert.equal(new Set(host.finde('fa-griff')).size, 8);   // (the fake DOM keeps a re-appended element twice)
  assert.equal(griff(3).klassen.has('aus'), true, 'band 3 is off');
  assert.equal(griff(2).klassen.has('aus'), false);
  assert.equal(griff(1).klassen.has('sel'), true, 'band 1 is selected at the start');
  griff(2).feuere('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }); griff(2).feuere('pointerup', { pointerId: 1 });
  assert.equal(griff(2).klassen.has('sel'), true); assert.equal(griff(1).klassen.has('sel'), false, 'a click selects and writes nothing');
});

test('face/eq.js: a drag writes ONE batch of the same parameters as the rows, the curve follows at once, a click writes nothing', async () => {
  const { q, griff, pfad, lage, zieh } = baue();
  const vorher = pfad();
  zieh(2, 0, 0);   // a click
  assert.equal(q.gesendet.length, 0);
  const p = lage(2);
  zieh(2, 30, -20, false);
  assert.equal(q.gesendet.length, 1);
  const [art, m, werte, ein] = q.gesendet[0];
  assert.deepEqual([art, m, ein], ['griff', 2, false], 'band 2 is on already: no switch in the batch');
  assert.deepEqual(Object.keys(werte).sort(), ['b2/freq', 'b2/gain']);
  assert.ok(werte['b2/freq'] > 1000 && werte['b2/gain'] > 6, JSON.stringify(werte));
  assert.notEqual(pfad(), vorher, 'the curve moved with the handle before any echo');
  assert.ok(Number(griff(2).getAttribute('cx')) > p.x - 1 && Number(griff(2).getAttribute('cy')) < p.y, 'the handle follows the hand');
  griff(2).feuere('pointerup', { pointerId: 1 });
  await tick(); await tick();
});

test('face/eq.js: a hollow handle drag switches the band on in the batch; a cut moves sideways only', () => {
  const { q, zieh } = baue();
  zieh(3, 40, -30);
  assert.deepEqual(q.gesendet[0].slice(0, 2), ['griff', 3]); assert.equal(q.gesendet[0][3], true, 'the batch switches band 3 on');
  zieh(4, 40, -30);
  assert.deepEqual(Object.keys(q.gesendet[1][2]), ['b4/freq'], 'no gain for a low cut');
});

test('face/eq.js: a refused write puts the handle and the curve back to the last confirmed value, the rest of that drag is ignored', async () => {
  const { q, griff, pfad, lage, zieh } = baue();
  const p0 = lage(2), k0 = pfad();
  q.antwort = false;
  const g = griff(2);
  g.feuere('pointerdown', { pointerId: 1, clientX: p0.x, clientY: p0.y });
  g.feuere('pointermove', { pointerId: 1, clientX: p0.x + 50, clientY: p0.y - 30 });
  assert.notEqual(pfad(), k0, 'moved first');
  await tick(); await tick();
  assert.deepEqual(lage(2), p0, 'the handle is back');
  assert.equal(pfad(), k0, 'the curve is back');
  g.feuere('pointermove', { pointerId: 1, clientX: p0.x + 80, clientY: p0.y - 40 });
  assert.equal(q.gesendet.length, 1, 'no further write in the refused drag');
  g.feuere('pointerup', { pointerId: 1 });
  await tick(); await tick();
  assert.deepEqual(lage(2), p0);
});

test('face/eq.js: a macro-driven parameter does not move and sends nothing; the other axis does', () => {
  const { q, zieh } = baue();
  q.sperren = new Set(['b2/freq']);
  zieh(2, 40, -30);
  assert.deepEqual(Object.keys(q.gesendet[0][2]), ['b2/gain']);
  q.sperren = new Set(['b2/freq', 'b2/gain']);
  zieh(2, 40, -30);
  assert.equal(q.gesendet.length, 1, 'both locked: nothing');
});

test('face/eq.js: a stage that is bypassed dims the display; aktualisiere follows the stage', () => {
  const dok = neuesDokument(), host = dok.createElement('div'), q = quelleDouble();
  let an = true; q.an = { get: () => an, set() {} };
  const f = baueEqFace(host, q);
  const wurzel = host.finde('fa-eq')[0];
  assert.equal(wurzel.klassen.has('fa-aus'), false);
  an = false; f.aktualisiere();
  assert.equal(wurzel.klassen.has('fa-aus'), true);
  const k0 = host.finde('fa-eq-kurve')[0].getAttribute('d');
  q.werte['b2/gain'] = -12; f.aktualisiere();
  assert.notEqual(host.finde('fa-eq-kurve')[0].getAttribute('d'), k0, 'the project changed: the curve follows');
});

test('face/eq.js: through the frame: opening schedules no frame callback, closing removes every document listener, building writes nothing', () => {
  const dok = neuesDokument(), q = quelleDouble(), t = { an: 0, aus: 0 };
  const takt = { an: () => { t.an++; return 1; }, aus: () => { t.aus++; } };
  const f = oeffneFace({ id: 'e', titel: 'EQ', wurzel: dok, takt, bauen: (inhalt) => baueEqFace(inhalt, q) });
  assert.equal(t.an, 0, 'the EQ has no live reading: no frame is scheduled');
  assert.ok(dok.hoerer.some((h) => h.t === 'keydown' && h.o), 'the frame registered its Esc listener (the knob plates register their own, they are counted below)');
  f.el.finde('fa-eq-tab')[2].feuere('click'); f.el.finde('fa-eq-tab')[5].feuere('click');   // switching the band rebuilds its plate
  assert.equal(q.gesendet.length, 0, 'building and selecting write nothing');
  f.schliesse();
  assert.equal(dok.hoerer.length, 0, 'no listener left on the document');
  assert.equal(dok.zaehler.remove.keydown, dok.zaehler.add.keydown, 'every listener added was removed');
});

test('face/eq.js: a source with modKnopf gives the knobs a ring path (fp-mod), one without gives none', () => {
  const mit = neuesDokument(), h1 = mit.createElement('div'), q = quelleDouble();
  q.modKnopf = () => undefined;
  baueEqFace(h1, q);
  assert.ok(h1.finde('fp-mod').length > 0, 'ring paths exist');
  const ohne = neuesDokument(), h2 = ohne.createElement('div');
  baueEqFace(h2, quelleDouble());
  assert.equal(h2.finde('fp-mod').length, 0);
});
