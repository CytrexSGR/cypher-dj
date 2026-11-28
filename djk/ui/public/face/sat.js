// Device faces: the saturator. The maths of the drawn transfer curve (pure, pinned to saett_dsp by the golden table
// djk/instruments/sat_dsp/tests/data/saett_kennlinie.csv, which the Rust test sat_dsp/tests/kennlinie.rs recomputes from the real DSP) and the builder of the face.
// The curve is the STEADY-STATE one: c * f(drive * x / c) * out with c = the ceiling (linear) and f = tanh, a soft clip or a hard clip, mixed against the dry path
// (sat_dsp/src/lib.rs, Saett::block). It is not the audible harmonics, only the shape. The one live value is the clip readout (the stage's /e/ins_gr).
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

export const SAETT_KURVEN = ['Tanh', 'Soft clip', 'Hard clip'];
/** The shape f of a curve (0 tanh, 1 soft clip 1.5u - 0.5u^3 inside |u| <= 1, 2 hard clip), unit ceiling. */
const form = (kurve, u) => (kurve === 1 ? (Math.abs(u) <= 1 ? 1.5 * u - 0.5 * u * u * u : Math.sign(u)) : kurve === 2 ? Math.min(1, Math.max(-1, u)) : Math.tanh(u));
/** The face title of the stage: the clip curves are the Cypher Clipper. */
export const saettTitel = (kurve) => (kurve > 0 ? 'Cypher Clipper' : 'Cypher Saturation');

/** Steady-state output for the input amplitude x (linear, 1 = full scale): x + mix * (out_lin * c * f(drive_lin * x / c) - x), c = 10^(ceiling / 20). */
export function saettAusgang(x, e) {
  const { drive, out, mix, kurve, decke } = saettEinstellung(e);
  const c = 10 ** (decke / 20);
  return x + mix * (10 ** (out / 20) * c * form(Math.round(kurve), 10 ** (drive / 20) * x / c) - x);
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

/** The clip readout text: "clip 3.2 dB", or "clip -" without a fresh reading. */
export const klippText = (gr) => (typeof gr === 'number' && Number.isFinite(gr) ? `clip ${gr.toFixed(1)} dB` : 'clip -');

/** The saturator face into `host`: the title and the CURVE selector, the curve display and the knobs (drive, output, mix, ceiling).
 *  quelle = {parameter, get(name), set(name, v), ende?(), gesperrt?(name), gr?(jetzt), an: {get(), set(b)}}; gr is the stage's clip amount in dB (or null).
 *  Returns {aktualisiere(), live(jetzt), zerstoere()}; live is one frame: true when the readout changed. */
export function baueSaettFace(host, quelle) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse) => { const e = d.createElement(tag); e.setAttribute('class', klasse); return e; };
  const wurzel = mk('div', 'fa-saett'), kopf = mk('div', 'fa-saett-kopf'), titelEl = mk('b', 'fa-saett-titel'), wahlEl = d.createElement('select');
  const kurve = mk('div', 'fa-saett-kurve'), platteHost = mk('div', 'fa-saett-platte'), klippEl = mk('output', 'fa-saett-klipp');
  wahlEl.setAttribute('class', 'fa-saett-wahl'); wahlEl.setAttribute('aria-label', 'Curve');
  SAETT_KURVEN.forEach((n, k) => { const o = d.createElement('option'); o.value = String(k); o.textContent = n; wahlEl.append(o); });
  kopf.append(titelEl, wahlEl, klippEl);
  wurzel.append(kopf, kurve, platteHost);
  host.append(wurzel);
  const jetzt = () => globalThis.performance?.now?.() ?? Date.now();
  const lokal = new Map();
  const wert = (n) => {
    const l = lokal.get(n);
    if (l && jetzt() - l.t < LOKAL_MS) return l.v;
    return quelle.get(n);
  };
  const einstellung = () => saettEinstellung(Object.fromEntries(['drive', 'out', 'mix', 'kurve', 'decke'].map((n) => [n, wert(n)])));

  // ---- the display: x -1..1, y -1.25..1.25, the curve is clipped at the frame
  const ds = baueAnzeige(kurve, { breite: 340, hoehe: 340, rand: 30, x: SAETT_ACHSEN.x, y: SAETT_ACHSEN.y, gitterX: [-1, -0.5, 0, 0.5, 1], gitterY: [-1, -0.5, 0, 0.5, 1],
    titelX: 'INPUT (LINEAR)', titelY: 'OUTPUT (LINEAR)', label: 'Static transfer curve of the saturator' });
  ds.linieH('fa-vollaussteuerung', 1); ds.linieH('fa-vollaussteuerung', -1);
  ds.text('fa-marke', 0.96, 1.07, 'FULL SCALE 0 dBFS', 'end');
  ds.text('fa-unterschrift', -0.96, 1.16, 'STATIC CURVE (steady input)', 'start');
  ds.pfad('fa-diagonale', [[-1, -1], [1, 1]]);
  const kurvePfad = ds.pfad('fa-kurve', []);
  const zeichne = () => {
    const e = einstellung();
    ds.setzePfad(kurvePfad, saettKurve(e));
    titelEl.textContent = saettTitel(e.kurve);
    if (wahlEl.value !== String(e.kurve)) wahlEl.value = String(e.kurve);
    wahlEl.disabled = quelle.gesperrt?.('kurve') === true;
  };

  // ---- the plate
  const steuer = SAETT_PARAMETER.filter((q) => q.typ !== 'wahl' && quelle.parameter[q.name]).map((q) => ({ param: q.name, typ: 'knob', label: quelle.parameter[q.name].label }));
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
      ...(quelle.modKnopf ? { modKnopf: (n) => quelle.modKnopf(n) } : {}),
      ende: () => quelle.ende?.(),
    },
  });
  // a bypassed stage does nothing to the signal: the drawing is dimmed
  let gedimmt = null;
  const dimme = () => {
    const aus = quelle.an ? quelle.an.get() === false : false;
    if (aus !== gedimmt) { gedimmt = aus; wurzel.classList.toggle('fa-aus', aus); }
  };
  // the curve selector: a refused write goes back like a knob's
  wahlEl.addEventListener('change', () => {
    const v = Number(wahlEl.value), eintrag = { v, t: jetzt() };
    lokal.set('kurve', eintrag);
    Promise.resolve(quelle.set('kurve', v)).then((ok) => { if (ok === false && lokal.get('kurve') === eintrag) { lokal.delete('kurve'); zeichne(); } }, () => {});
    zeichne(); quelle.ende?.();
  });
  // the clip readout: the stage's clip amount from /e/ins_gr; a bypassed stage shows none
  let zuletzt;
  const zeigeKlipp = (zeit) => {
    const gr = gedimmt ? null : (quelle.gr?.(zeit) ?? null);
    const neu = klippText(gr);
    const anders = neu !== zuletzt;
    if (anders) { zuletzt = neu; klippEl.textContent = neu; }
    return anders;
  };
  zeichne(); dimme(); zeigeKlipp(jetzt());
  return {
    aktualisiere() { platte.aktualisiere(); zeichne(); dimme(); zeigeKlipp(jetzt()); },
    live(zeit = jetzt()) { dimme(); return zeigeKlipp(zeit); },
    zerstoere() { platte.zerstoere(); wurzel.remove?.(); },
  };
}
