// Device faces, Hall: the curve maths is pinned to hall_dsp by the golden table (the same CSV the Rust test reverb_dsp/tests/hall.rs::kurven_golden_tabelle recomputes
// from the real DSP functions), the fixed values equal the core, the conversion to the knob scales round-trips, and a closed Hall face costs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hallEinstellung, hallParameterTabelle, hallNormVon, hallT60, hallFahneDb, hallZeit, hallZeitEnde, baueHallFace, HALL_FEST, HALL_KNOEPFE, HALL_NORM_VORGABE } from '../public/face/reverb.js';
import { HALL_TABELLE, hallEinheit } from '../public/production/routing.js';
import { oeffneFace } from '../public/face/frame.js';
import { neuesDokument } from './support/face_dom.mjs';

const CSV = new URL('../../instruments/reverb_dsp/tests/data/hall_kurven.csv', import.meta.url);
const zeilen = () => {
  const [kopf, ...rest] = fs.readFileSync(CSV, 'utf8').trim().split('\n');
  assert.equal(kopf, 'decay_s,tief,hoch,lowcut_hz,highcut_hz,fahne_db,f_hz,t60_s,fahne_db_out');
  return rest.map((z) => z.split(',').map(Number));
};
const einst = (v) => ({ decay_s: v[0], tief_faktor: v[1], hoch_faktor: v[2], lowcut_hz: v[3], highcut_hz: v[4], fahne_db: v[5] });
const FELDER = ['pre', 'decay', 'groesse', 'tief', 'highcut', 'fahne'];

test('face/reverb.js: every row of the golden table (Rust side) equals hallT60 and hallFahneDb within 1e-9', () => {
  const rows = zeilen();
  assert.ok(rows.length >= 30, `only ${rows.length} rows`);
  for (const v of rows) {
    assert.ok(Math.abs(hallT60(einst(v), v[6]) - v[7]) < 1e-9, `t60 row ${v.join(',')}`);
    assert.ok(Math.abs(hallFahneDb(einst(v), v[6]) - v[8]) < 1e-9, `tone row ${v.join(',')}`);
  }
});

test('face/reverb.js: named values: decay 2 s, low 1.2, high 0.6 gives T60 2.4 / 2.0 / 1.2 s at 150 Hz / 1 kHz / 8 kHz; the time marks of pre 10 ms, size 60 ms', () => {
  const e = { decay_s: 2, tief_faktor: 1.2, hoch_faktor: 0.6, lowcut_hz: 80, highcut_hz: 12000, fahne_db: 0, pre_ms: 10, groesse_ms: 60 };
  assert.ok(Math.abs(hallT60(e, 150) - 2.4) < 1e-9); assert.ok(Math.abs(hallT60(e, 1000) - 2.0) < 1e-9); assert.ok(Math.abs(hallT60(e, 8000) - 1.2) < 1e-9);
  assert.ok(Math.abs(hallT60(e, 20) - 2.4) < 1e-9, 'constant below the first anchor'); assert.ok(Math.abs(hallT60(e, 20000) - 1.2) < 1e-9, 'constant above the last');
  const z = hallZeit(e);
  assert.ok(Math.abs(z.fahneStartS - 0.040) < 1e-12); assert.ok(Math.abs(z.erEndeS - 0.070) < 1e-12); assert.ok(Math.abs(z.preS - 0.010) < 1e-12);
  assert.deepEqual(z.linien.map((l) => l.f), [150, 1000, 8000]);
  assert.ok(Math.abs(hallFahneDb({ ...e, lowcut_hz: 80 }, 80) - (-3.0103)) < 1e-3, 'the low cut is 3 dB down at its corner');
  const ende = hallZeitEnde(z);
  assert.ok(ende >= z.fahneStartS + 1.1 * 2.4 && ende < 1.7 * (z.fahneStartS + 1.1 * 2.4), `axis end ${ende}`);
});

test('face/reverb.js: the fixed values equal the core (source pin) and the defaults equal the project model', () => {
  const kern = fs.readFileSync(new URL('../../core/src/arr_returns.cpp', import.meta.url), 'utf8');
  for (const zeile of ['e.frueh = 0.5;', 'e.hoch_faktor = 0.6;', 'e.lowcut_hz = 80.0;']) assert.ok(kern.includes(zeile), `arr_returns.cpp lost "${zeile}": update HALL_FEST in face/reverb.js`);
  assert.deepEqual(HALL_FEST, { frueh: 0.5, hoch_faktor: 0.6, lowcut_hz: 80 });
  const modell = fs.readFileSync(new URL('../project/model.ts', import.meta.url), 'utf8');
  const m = /HALL_VORGABE[^=]*= \{([^}]*)\}/.exec(modell)[1];
  for (const f of FELDER) assert.equal(Number(new RegExp(`${f}: ([0-9.]+)`).exec(m)[1]), HALL_NORM_VORGABE[f], `default of ${f}`);
});

test('face/reverb.js: the six knobs, HALL_TABELLE read as {min, max, log} (only linear and log curves exist), the round trip norm -> unit -> norm', () => {
  assert.deepEqual(Object.values(HALL_TABELLE).map((t) => t.kurve).sort(), ['linear', 'linear', 'linear', 'log', 'log', 'log'].sort());
  assert.deepEqual(HALL_KNOEPFE.map((k) => k[1]), ['Pre-delay', 'Size', 'Decay', 'Low decay', 'High cut', 'Level']);
  const t = hallParameterTabelle();
  assert.deepEqual(Object.keys(t).sort(), [...FELDER].sort());
  for (const f of FELDER) {
    assert.deepEqual([t[f].min, t[f].max, t[f].log], [HALL_TABELLE[f].y0, HALL_TABELLE[f].y1, HALL_TABELLE[f].kurve === 'log'], f);
    assert.ok(Math.abs(hallNormVon(f, t[f].vorgabe) - HALL_NORM_VORGABE[f]) < 1e-9, `default of ${f}`);
    for (const x of [0, 0.2, 0.5, 0.77, 1]) assert.ok(Math.abs(hallNormVon(f, hallEinheit(f, x)) - x) < 1e-9, `round trip ${f} ${x}`);
  }
  assert.throws(() => hallNormVon('mix', 1));
});

test('face/reverb.js: a norm of 1.5, a missing field and junk clamp or default, and no path holds NaN', async () => {
  const e = hallEinstellung({ pre: 1.5, decay: -3, groesse: NaN, tief: 'x', highcut: Infinity });
  assert.equal(e.pre_ms, 250); assert.ok(Math.abs(e.decay_s - 0.1) < 1e-12);
  assert.ok(Math.abs(e.groesse_ms - hallEinheit('groesse', HALL_NORM_VORGABE.groesse)) < 1e-12, 'NaN gives the default');
  assert.ok(Math.abs(e.tief_faktor - hallEinheit('tief', HALL_NORM_VORGABE.tief)) < 1e-12);
  assert.ok(Number.isFinite(e.highcut_hz) && Math.abs(e.highcut_hz - hallEinheit('highcut', HALL_NORM_VORGABE.highcut)) < 1e-9);
  assert.deepEqual(hallEinstellung(), hallEinstellung({}));
  const dok = neuesDokument(), host = dok.createElement('div');
  for (const h of [{}, { pre: 1.5, decay: 9, groesse: 2, tief: -1, highcut: 7, fahne: 3 }, { pre: 'x', decay: NaN }]) {
    host.kinder = [];
    baueHallFace(host, { get: (f) => h[f], set() {}, an: { get: () => true, set() {} } });
    const ds = host.alles().filter((x) => x.tag === 'path').map((p) => p.getAttribute('d'));
    assert.ok(ds.length >= 6, 'paths drawn');
    for (const d of ds) assert.ok(!/NaN|Infinity/.test(d), `bad path: ${d}`);
  }
});

test('face/reverb.js: display B draws the DSP: the T60 path converts back to hallT60 and the tone path to hallFahneDb', () => {
  const dok = neuesDokument(), host = dok.createElement('div');
  const h = { pre: 0.3, decay: 0.6, groesse: 0.5, tief: 0.7, highcut: 0.5, fahne: 0.4 };
  baueHallFace(host, { get: (f) => h[f], set() {}, an: { get: () => true, set() {} } });
  const pfade = host.alles().filter((x) => x.tag === 'path');
  const t60 = pfade.find((p) => p.klassen.has('fa-hall-t60')), ton = pfade.find((p) => p.klassen.has('fa-hall-ton'));
  const punkte = (p) => p.getAttribute('d').split(/ ?[ML]/).filter(Boolean).map((q) => q.split(',').map(Number));
  const e = hallEinstellung(h);
  const pt = punkte(t60), pn = punkte(ton);
  assert.equal(pt.length, 121); assert.equal(pn.length, 121);
  // the plot is 420 x 250 user units, left 34, right margin 40, top 10, bottom 34: 346 x 206 px
  const x0 = 34, w = 346, y0 = 10, hh = 206;
  for (const i of [0, 20, 40, 60, 80, 100, 120]) {
    const f = 20 * 1000 ** (i / 120);
    assert.ok(Math.abs(pt[i][0] - (x0 + w * Math.log(f / 20) / Math.log(1000))) < 0.06, `x at ${f}`);
    const soll = hallT60(e, f), py = y0 + hh * (1 - Math.log(Math.min(120, Math.max(0.05, soll)) / 0.05) / Math.log(120 / 0.05));
    assert.ok(Math.abs(pt[i][1] - py) < 0.06, `T60 at ${f} Hz: ${pt[i][1]} vs ${py}`);
    const db = Math.min(12, Math.max(-60, hallFahneDb(e, f))), pdb = y0 + hh * (1 - (db + 60) / 72);
    assert.ok(Math.abs(pn[i][1] - pdb) < 0.3, `tone at ${f} Hz: ${pn[i][1]} vs ${pdb}`);
  }
});

test('face/reverb.js: a knob moves the drawing and goes out as a norm; a refused write puts the knob and the drawing back', async () => {
  const dok = neuesDokument(), host = dok.createElement('div');
  const h = { pre: 0.04, decay: 0.5, groesse: 0.3, tief: 0.5, highcut: 0.8, fahne: 0.6 };
  const gesendet = []; let antwort = true;
  const f = baueHallFace(host, { get: (n) => h[n], set: (n, v) => { gesendet.push([n, v]); return Promise.resolve(antwort); }, an: { get: () => true, set() {} } });
  assert.equal(host.finde('fp-knopf').length, 6, 'six knobs');
  assert.deepEqual(host.finde('fp-name').map((x) => x.textContent), ['Pre-delay', 'Size', 'Decay', 'Low decay', 'High cut', 'Level']);
  const knopf = host.finde('fp-knopf')[2];   // Decay
  const wert = () => host.finde('fp-wert')[2].textContent;
  const vorher = wert();
  antwort = false;
  knopf.feuere('keydown', { key: 'ArrowUp', shiftKey: false });
  assert.equal(gesendet.length, 1); assert.equal(gesendet[0][0], 'decay');
  assert.ok(Math.abs(gesendet[0][1] - 0.51) < 1e-6, `norm ${gesendet[0][1]}`);
  assert.notEqual(wert(), vorher, 'the knob moved');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(wert(), vorher, 'refused: back to the confirmed value');
  assert.equal(typeof f.zerstoere, 'function');
});

test('face/reverb.js through the frame: no scheduled frame at all (no live value), one document listener added and the same one removed on close', () => {
  const dok = neuesDokument(), t = { an: 0, aus: 0 };
  const takt = { an: () => { t.an++; return 1; }, aus: () => { t.aus++; } };
  const h = Object.fromEntries(FELDER.map((n) => [n, 0.5]));
  const f = oeffneFace({ id: 'hall:r1', titel: 'HALL', wurzel: dok, takt, bauen: (inhalt) => baueHallFace(inhalt, { get: (n) => h[n], set() {}, an: { get: () => true, set() {} } }) });
  assert.ok(f, 'opens'); assert.equal(t.an, 0, 'no takt.an call while open'); assert.equal(dok.zaehler.add.keydown, 1);
  f.aktualisiere();
  assert.equal(t.an, 0);
  f.schliesse();
  assert.equal(t.an, 0); assert.equal(t.aus, 0); assert.equal(dok.zaehler.remove.keydown, 1); assert.equal(dok.hoerer.length, 0);
});
