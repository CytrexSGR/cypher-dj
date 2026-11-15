// Device faces: the saturator. The maths of the drawn transfer curve (pure, pinned to saett_dsp by the golden table
// djk/instruments/sat_dsp/tests/data/saett_kennlinie.csv, which the Rust test sat_dsp/tests/kennlinie.rs recomputes from the real DSP) and the builder of the face.
// The curve is the STEADY-STATE one: tanh of the driven input, scaled by the output gain, mixed against the dry path (sat_dsp/src/lib.rs, Saett::block). It is not
// the audible harmonics, only the shape; there is no live value for the saturator, so the face has no frame loop.
import { SAETT_PARAMETER } from '../production/inserts.js';
import { baueAnzeige } from './display.js';
import { baueReglerPlatte } from './frame.js';

export const SAETT_ACHSEN = { x: { min: -1, max: 1 }, y: { min: -1.25, max: 1.25 } };

/** The saturator values the curve needs: a missing, NaN or out-of-range entry becomes the default of SAETT_PARAMETER or is clamped into its range. */
export function saettEinstellung(werte = {}) {
  const aus = {};
  for (const q of SAETT_PARAMETER) {
    const v = werte?.[q.name];
    aus[q.name] = typeof v === 'number' && Number.isFinite(v) ? Math.min(q.max, Math.max(q.min, v)) : q.vorgabe;
  }
  return aus;
}

/** Steady-state output for the input amplitude x (linear, 1 = full scale): x + mix * (out_lin * tanh(drive_lin * x) - x). */
export function saettAusgang(x, e) {
  const { drive, out, mix } = saettEinstellung(e);
  return x + mix * (10 ** (out / 20) * Math.tanh(10 ** (drive / 20) * x) - x);
}

/** The curve from -1 to 1, both ends included: [[x, y]] with n points. */
export function saettKurve(e, n = 201) {
  const aus = [];
  for (let i = 0; i < n; i++) { const x = -1 + (2 * i) / (n - 1); aus.push([x, saettAusgang(x, e)]); }
  return aus;
}

/** {name: {name, label, min, max, log, einheit, vorgabe}} for the knob plate (all three knobs are linear). */
export const saettParameterTabelle = (liste = SAETT_PARAMETER) => Object.fromEntries(liste.map((q) => [q.name, { name: q.name, label: q.label, min: q.min, max: q.max, log: false, einheit: q.einheit, vorgabe: q.vorgabe }]));

const LOKAL_MS = 800;   // a value the hand just set is shown for this long, before the project echoes it

/** The saturator face into `host`: the curve display above the three knobs. quelle = {parameter, get(name), set(name, v), ende?(), gesperrt?(name), an: {get(), set(b)}}.
 *  Returns {aktualisiere(), live(), zerstoere()}; live does nothing (no frame loop is wanted for this device). */
export function baueSaettFace(host, quelle) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse) => { const e = d.createElement(tag); e.setAttribute('class', klasse); return e; };
  const wurzel = mk('div', 'fa-saett'), kurve = mk('div', 'fa-saett-kurve'), platteHost = mk('div', 'fa-saett-platte');
  wurzel.append(kurve, platteHost);
  host.append(wurzel);
  const jetzt = () => globalThis.performance?.now?.() ?? Date.now();
  const lokal = new Map();
  const wert = (n) => {
    const l = lokal.get(n);
    if (l && jetzt() - l.t < LOKAL_MS) return l.v;
    return quelle.get(n);
  };
  const einstellung = () => saettEinstellung(Object.fromEntries(['drive', 'out', 'mix'].map((n) => [n, wert(n)])));

  // ---- the display: x -1..1, y -1.25..1.25, the curve is clipped at the frame
  const ds = baueAnzeige(kurve, { breite: 340, hoehe: 340, rand: 30, x: SAETT_ACHSEN.x, y: SAETT_ACHSEN.y, gitterX: [-1, -0.5, 0, 0.5, 1], gitterY: [-1, -0.5, 0, 0.5, 1],
    titelX: 'INPUT (LINEAR)', titelY: 'OUTPUT (LINEAR)', label: 'Static transfer curve of the saturator' });
  ds.linieH('fa-vollaussteuerung', 1); ds.linieH('fa-vollaussteuerung', -1);
  ds.text('fa-marke', 0.96, 1.07, 'FULL SCALE 0 dBFS', 'end');
  ds.text('fa-unterschrift', -0.96, 1.16, 'STATIC CURVE (steady input)', 'start');
  ds.pfad('fa-diagonale', [[-1, -1], [1, 1]]);
  const kurvePfad = ds.pfad('fa-kurve', []);
  const zeichne = () => ds.setzePfad(kurvePfad, saettKurve(einstellung()));

  // ---- the plate
  const steuer = SAETT_PARAMETER.filter((q) => quelle.parameter[q.name]).map((q) => ({ param: q.name, typ: 'knob', label: quelle.parameter[q.name].label }));
  const platte = baueReglerPlatte(platteHost, {
    titel: '', abschnitte: [{ id: 'r1', cols: Math.max(1, steuer.length), steuer }], parameter: quelle.parameter, akzent: 'rot', dokument: d,
    adapter: {
      get: (n) => wert(n),
      set: (n, v) => {
        const eintrag = { v, t: jetzt() };
        lokal.set(n, eintrag);
        // a refused write (the source resolves false): the knob goes back to the last confirmed value
        Promise.resolve(quelle.set(n, v)).then((ok) => { if (ok === false && lokal.get(n) === eintrag) { lokal.delete(n); platte.aktualisiere(); zeichne(); } }, () => {});
        zeichne();
      },
      gesperrt: (n) => quelle.gesperrt?.(n) === true,
      ende: () => quelle.ende?.(),
    },
  });
  // a bypassed stage does nothing to the signal: the drawing is dimmed
  let gedimmt = null;
  const dimme = () => {
    const aus = quelle.an ? quelle.an.get() === false : false;
    if (aus !== gedimmt) { gedimmt = aus; wurzel.classList.toggle('fa-aus', aus); }
  };
  zeichne(); dimme();
  return {
    aktualisiere() { platte.aktualisiere(); zeichne(); dimme(); },
    live() { return false; },
    zerstoere() { platte.zerstoere(); wurzel.remove?.(); },
  };
}
