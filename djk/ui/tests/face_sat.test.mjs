// Device faces, saturator: the curve maths is pinned to saett_dsp by the golden table (the same CSV the Rust test sat_dsp/tests/kennlinie.rs recomputes: the table equals the formula, and the real DSP's wet curve
// follows that formula (fundamental of 200 Hz sines at several drives and amplitudes within 0.1 dB; a constant input shows only the dry share since the 5 Hz DC blocker)), the drawing equals the curve, and a closed face costs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SAETT_ACHSEN, saettEinstellung, saettAusgang, saettKurve, saettParameterTabelle, baueSaettFace } from '../public/face/sat.js';
import { baueAnzeige } from '../public/face/display.js';
import { oeffneFace } from '../public/face/frame.js';
import { SAETT_PARAMETER } from '../public/production/inserts.js';
import { neuesDokument } from './support/face_dom.mjs';

const CSV = new URL('../../instruments/sat_dsp/tests/data/saett_kennlinie.csv', import.meta.url);
const zeilen = () => {
  const [kopf, ...rest] = fs.readFileSync(CSV, 'utf8').trim().split('\n');
  assert.equal(kopf, 'drive_db,out_db,mix,x,y');
  return rest.map((z) => z.split(',').map(Number));
};
const einst = (v) => ({ drive: v[0], out: v[1], mix: v[2] });

test('face/sat.js: every row of the golden table (Rust side) equals saettAusgang within 1e-9', () => {
  const rows = zeilen();
  assert.ok(rows.length >= 20, `only ${rows.length} rows`);
  for (const v of rows) assert.ok(Math.abs(saettAusgang(v[3], einst(v)) - v[4]) < 1e-9, `row ${v.join(',')}`);
});

test('face/sat.js: named values, mix 0, odd symmetry, defaults', () => {
  const a = { drive: 12, out: -6, mix: 1 };
  assert.ok(Math.abs(saettAusgang(0.5, a) - 0.48282) < 1e-4);
  assert.ok(Math.abs(saettAusgang(0.1, a) - 0.18961) < 1e-4);
  assert.ok(Math.abs(saettAusgang(0.5, { drive: 0, out: 0, mix: 1 }) - 0.46212) < 1e-4);
  assert.ok(Math.abs(saettAusgang(0.5, { drive: 12, out: -6, mix: 0.5 }) - 0.49141) < 1e-4);
  for (const x of [-1, -0.3, 0, 0.7, 1]) assert.equal(saettAusgang(x, { drive: 24, out: 3, mix: 0 }), x, 'mix 0 gives x');
  for (const x of [0.05, 0.4, 1]) assert.ok(Math.abs(saettAusgang(-x, a) + saettAusgang(x, a)) < 1e-12, `odd at ${x}`);
  assert.deepEqual(saettEinstellung({}), { drive: 12, out: -6, mix: 1, kurve: 0, decke: 0 });
  assert.deepEqual(saettEinstellung({ drive: NaN, out: 99, mix: -1, kurve: 7, decke: 5 }), { drive: 12, out: 12, mix: 0, kurve: 2, decke: 0 });
  assert.equal(saettAusgang(0.5, {}), saettAusgang(0.5, a), 'a missing value is the default');
});

test('face/sat.js: saettKurve covers -1..1, all finite, junk in an old project never gives NaN', () => {
  const k = saettKurve({});
  assert.equal(k.length, 201); assert.equal(k[0][0], -1); assert.equal(k.at(-1)[0], 1);
  assert.ok(k.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  assert.ok(saettKurve({ drive: 'x', out: Infinity, mix: {} }).every(([, y]) => Number.isFinite(y)));
});

test('face/display.js: drawn equals DSP: the path of saettKurve converts back to the CSV output within 0.01', () => {
  const dok = neuesDokument(), host = dok.createElement('div');
  const ds = baueAnzeige(host, { breite: 340, hoehe: 340, rand: 30, x: SAETT_ACHSEN.x, y: SAETT_ACHSEN.y, gitterX: [-1, 0, 1], gitterY: [-1, 0, 1] });
  let geprueft = 0;
  for (const v of zeilen().filter((r) => Math.abs(r[4]) <= 1.2)) {
    const pfad = ds.pfad('fa-kurve', saettKurve(einst(v)));
    const punkte = pfad.getAttribute('d').split(/ ?[ML]/).filter(Boolean).map((p) => p.split(',').map(Number));
    assert.equal(punkte.length, 201);
    const i = Math.round(((v[3] + 1) / 2) * 200);
    assert.ok(Math.abs(ds.wertX(punkte[i][0]) - v[3]) < 0.01, `x of ${v}`);
    assert.ok(Math.abs(ds.wertY(punkte[i][1]) - v[4]) < 0.01, `y of ${v}: ${ds.wertY(punkte[i][1])}`);
    pfad.remove(); geprueft++;
  }
  assert.ok(geprueft >= 100, `${geprueft} rows drawn`);
});

const zaehlTakt = () => { const t = { an: [], aus: [] }; return { t, takt: { an: (fn) => { t.an.push(fn); return t.an.length; }, aus: (h) => t.aus.push(h) } }; };
const quelleDouble = (stand) => {
  const werte = Object.fromEntries(SAETT_PARAMETER.map((q) => [q.name, q.vorgabe]));
  return { parameter: saettParameterTabelle(SAETT_PARAMETER), get: (n) => werte[n], set: (n, v) => { stand.gesetzt.push([n, v]); return stand.antwort; }, werte, an: { get: () => stand.an, set() {} } };
};

test('face/sat.js: four knobs in one row, a face built writes nothing, and it costs nothing: no frame callback while open, no listener left after close', () => {
  const dok = neuesDokument(), { t, takt } = zaehlTakt(), stand = { an: true, gesetzt: [], antwort: true };
  const q = quelleDouble(stand);
  const f = oeffneFace({ id: 's', titel: 'SATURATOR', wurzel: dok, takt, an: q.an, bauen: (inhalt) => baueSaettFace(inhalt, q) });
  assert.deepEqual(f.el.alles().filter((e) => e.klassen.has('fp-name')).map((e) => e.textContent), ['Drive', 'Output', 'Mix', 'Ceiling']);
  assert.equal(stand.gesetzt.length, 0);
  assert.equal(t.an.length, 0, 'no frame loop: the saturator has no live value');
  stand.an = false; f.aktualisiere();
  assert.equal(f.el.alles().find((e) => e.klassen.has('fa-saett')).klassen.has('fa-aus'), true, 'bypassed: dimmed');
  f.schliesse();
  assert.equal(t.an.length, 0); assert.equal(t.aus.length, 0);
  assert.equal(dok.zaehler.add.keydown, dok.zaehler.remove.keydown); assert.equal(dok.hoerer.length, 0);
});
