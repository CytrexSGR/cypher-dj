// Device faces: the Hall of a return. The maths of the two drawn displays (pure, pinned to hall_dsp by the golden table
// djk/instruments/reverb_dsp/tests/data/hall_kurven.csv) and the builder of the face: display A (the decay envelope over time), display B (decay time and wet
// tone over frequency) and the six knobs the return has. Only what the DSP has is drawn: t60_kurve and fahnen_pegel of hall_dsp, the pre-delay and the start
// of the tail as times. There is no impulse response here and none is invented.
import { HALL_TABELLE, hallEinheit } from '../production/routing.js';
import { entskaliere } from '../panel_skala.js';
import { baueAnzeige } from './display.js';
import { baueReglerPlatte } from './frame.js';

/** The six Hall fields of a return, in the order of the knobs: [field, label]. */
export const HALL_KNOEPFE = [['pre', 'Pre-delay'], ['groesse', 'Size'], ['decay', 'Decay'], ['tief', 'Low decay'], ['highcut', 'High cut'], ['fahne', 'Level']];
/** What the core fixes for every return (djk/core/src/arr_returns.cpp arr_hall_einstellung); a test pins these lines to the source. */
export const HALL_FEST = { frueh: 0.5, hoch_faktor: 0.6, lowcut_hz: 80 };
/** The defaults of a new return in norm 0..1 (project/model.ts HALL_VORGABE; a test pins them to that file). */
export const HALL_NORM_VORGABE = { pre: 0.04, decay: 0.5252, groesse: 0.282, tief: 0.5658, highcut: 0.8039, fahne: 0.66667 };
/** The anchors of the decay curve (hall_dsp t60_kurve): 150 Hz, 1 kHz, 8 kHz. */
export const HALL_ANKER = [150, 1000, 8000];

const klemme01 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null);
const bereichVon = (feld) => { const t = HALL_TABELLE[feld]; return { min: t.y0, max: t.y1, log: t.kurve === 'log' }; };

/** The Hall values the drawing needs: the page values 0..1 (missing, NaN or out of range: the default or clamped) in the units of the core, plus the fixed values. */
export function hallEinstellung(h = {}) {
  const e = (feld) => hallEinheit(feld, klemme01(h?.[feld]) ?? HALL_NORM_VORGABE[feld]);
  return { pre_ms: e('pre'), decay_s: e('decay'), groesse_ms: e('groesse'), tief_faktor: e('tief'), hoch_faktor: HALL_FEST.hoch_faktor, lowcut_hz: HALL_FEST.lowcut_hz,
    highcut_hz: e('highcut'), fahne_db: e('fahne'), frueh: HALL_FEST.frueh };
}

/** {field: {name, label, min, max, log, einheit, vorgabe}} in real units for baueReglerPlatte: HALL_TABELLE's {y0, y1, kurve} as {min, max, log} (kurve is 'linear' or 'log'). */
export function hallParameterTabelle() {
  return Object.fromEntries(HALL_KNOEPFE.map(([feld, label]) => {
    const t = HALL_TABELLE[feld], b = bereichVon(feld);
    return [feld, { name: feld, label, ...b, einheit: t.einheit, vorgabe: hallEinheit(feld, HALL_NORM_VORGABE[feld]) }];
  }));
}

/** The norm 0..1 of a Hall field for a value in its unit: the inverse of hallEinheit. */
export const hallNormVon = (feld, wert) => {
  if (!HALL_TABELLE[feld]) throw new Error(`unknown Hall field ${feld}`);
  return entskaliere(wert, bereichVon(feld));
};

/** Decay time T60 in seconds at f Hz: hall_dsp::t60_kurve (linear in log2 f between the anchors, constant outside; the factors are floored at 0.05). */
export function hallT60(e, f) {
  const [lt, lm, lh] = HALL_ANKER.map(Math.log2);
  const x = Math.log2(Math.max(f, 1));
  const ft = Math.max(e.tief_faktor, 0.05), fh = Math.max(e.hoch_faktor, 0.05);
  const log = x <= lt ? Math.log2(ft) : x <= lm ? Math.log2(ft) * (lm - x) / (lm - lt) : x <= lh ? Math.log2(fh) * (x - lm) / (lh - lm) : Math.log2(fh);
  return e.decay_s * 2 ** log;
}

/** The tone of the tail in dB at f Hz: 20 log10 of hall_dsp::fahnen_pegel (two Butterworth-form 2nd-order filters times the level). */
export function hallFahneDb(e, f) {
  const ff = Math.max(f, 1);
  const hp = 1 / Math.sqrt(1 + (e.lowcut_hz / ff) ** 4), tp = 1 / Math.sqrt(1 + (ff / e.highcut_hz) ** 4);
  return 20 * Math.log10(10 ** (e.fahne_db / 20) * hp * tp);
}

/** The times of display A in seconds: the pre-delay, the end of the early region (pre + size), the start of the tail (pre + size / 2, hall_dsp lib.rs) and the
 *  decay time at the three anchors. */
export function hallZeit(e) {
  return { preS: e.pre_ms / 1000, erEndeS: (e.pre_ms + e.groesse_ms) / 1000, fahneStartS: (e.pre_ms + e.groesse_ms / 2) / 1000,
    linien: HALL_ANKER.map((f) => ({ f, t60: hallT60(e, f) })) };
}

/** The time axis end of display A: tail start + 1.1 x the longest decay time, rounded up to a value from a short list (1 1.2 1.6 2 2.4 3 4 5 6 8 10 x 10^n). */
export function hallZeitEnde(z) {
  const roh = z.fahneStartS + 1.1 * Math.max(...z.linien.map((l) => l.t60));
  const zehn = 10 ** Math.floor(Math.log10(roh));
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) if (m * zehn >= roh * (1 - 1e-12)) return m * zehn;
  return 10 * zehn;
}

export const HALL_FEST_TEXT = `Fixed in the return: early ${HALL_FEST.frueh.toFixed(2)} · high decay x${HALL_FEST.hoch_faktor.toFixed(2)} · low cut ${HALL_FEST.lowcut_hz} Hz · diffusion full · frame 1024`;
export const HALL_MODELL_TEXT = 'Envelope model: what the parameters mean, not the impulse response';
const DB_MIN = -60, DB_MAX = 12;
const T60_ACHSE = { min: 0.05, max: 120, log: true };
const F_ACHSE = { min: 20, max: 20000, log: true };
const zahl3 = (v) => String(Number(v.toPrecision(3)));
const fText = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));
const sek = (s) => (s >= 10 ? s.toFixed(0) : s.toFixed(s >= 1 ? 1 : 2));

/** The Hall face into `host`: display A (decay over time) and display B (decay and tone over frequency) above the six knobs. quelle = {get(field) -> norm 0..1,
 *  set(field, norm) -> promise of the write (true = confirmed), an: {get(), set(b)}, ende?()}. There is nothing live to show (the DSP sends no reading), so the face
 *  has no frame function. Returns {aktualisiere(), zerstoere()}. */
export function baueHallFace(host, quelle) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse, text) => { const e = d.createElement(tag); e.setAttribute('class', klasse); if (text !== undefined) e.textContent = text; return e; };
  const wurzel = mk('div', 'fa-hall');
  const oben = mk('div', 'fa-hall-oben'), zelleA = mk('div', 'fa-hall-zelle'), zelleB = mk('div', 'fa-hall-zelle'), platteHost = mk('div', 'fa-hall-platte');
  const kopfA = mk('div', 'fa-hall-titel', 'TAIL DECAY OVER TIME'), kopfB = mk('div', 'fa-hall-titel', 'DECAY AND TONE OVER FREQUENCY');
  const rumpfA = mk('div', 'fa-hall-bild'), rumpfB = mk('div', 'fa-hall-bild');
  // the time marks as a row of chips under the display: at the real scale (a tail of many seconds) pre-delay and early region are a few pixels wide and a label would lie on the lines
  const marken = mk('div', 'fa-hall-hinweis fa-hall-marken');
  const markePre = mk('span', 'fa-hall-marke-pre'), markeEr = mk('span', 'fa-hall-marke-er'), markeFahne = mk('span', 'fa-hall-marke-start');
  marken.append(markePre, markeEr, markeFahne);
  zelleA.append(kopfA, rumpfA, marken, mk('div', 'fa-hall-hinweis', HALL_MODELL_TEXT));
  const legendeB = mk('div', 'fa-hall-hinweis');
  for (const [klasse, text] of [['fa-hall-schl-t60', 'DECAY TIME T60'], ['fa-hall-schl-ton', 'WET TONE (dashed, right scale)']]) legendeB.append(mk('span', klasse, text));
  zelleB.append(kopfB, rumpfB, legendeB);
  oben.append(zelleA, zelleB);
  wurzel.append(oben, platteHost, mk('div', 'fa-hall-fest', HALL_FEST_TEXT));
  host.append(wurzel);

  const lokal = new Map();   // field -> {v}: the value of a write that is in flight (the project shows only the answer of the server)
  const norm = (feld) => lokal.get(feld)?.v ?? quelle.get(feld);
  const einstellung = () => hallEinstellung(Object.fromEntries(HALL_KNOEPFE.map(([feld]) => [feld, norm(feld)])));

  // ---- display A: the time axis follows the decay, so the display is rebuilt when its rounded end changes
  let a = null;
  const baueA = (ende) => {
    if (a) a.ds.svg.remove();
    const ds = baueAnzeige(rumpfA, { breite: 420, hoehe: 250, rand: 34, x: { min: 0, max: ende }, y: { min: DB_MIN, max: 0 }, gitterX: [0, 1, 2, 3, 4].map((i) => ende * i / 4), gitterY: [0, -12, -24, -36, -48, -60],
      titelX: 'TIME s', titelY: 'LEVEL dB', formatX: zahl3, label: 'Decay envelope of the Hall tail over time', formatY: (v) => String(v).replace('-', '−') });
    a = { ds, ende, frueh: ds.pfad('fa-hall-frueh', [[0, 0], [0, 0]], { flaeche: true }), pre: ds.pfad('fa-hall-pre', []), preLinie: ds.linieV('fa-hall-prelinie', 0),
      start: ds.linieV('fa-hall-start', 0), linien: HALL_ANKER.map((f, i) => ds.pfad(`fa-hall-l${i}`, [])),
      legende: HALL_ANKER.map((f, i) => ds.text(`fa-hall-text fa-hall-t${i}`, ende, -4 - 5.5 * i, '', 'end')) };
    return a;
  };
  const zeichneA = (e) => {
    const z = hallZeit(e), ende = hallZeitEnde(z);
    if (!a || a.ende !== ende) baueA(ende);
    const { ds } = a;
    ds.setzePfad(a.frueh, [[z.preS, 0], [z.erEndeS, 0]], { flaeche: true });
    ds.setzePfad(a.pre, [[0, -2], [z.preS, -2]]);
    const setzeX = (l, xw) => { l.setAttribute('x1', ds.px(xw).toFixed(1)); l.setAttribute('x2', ds.px(xw).toFixed(1)); };
    setzeX(a.preLinie, z.preS); setzeX(a.start, z.fahneStartS);
    z.linien.forEach((l, i) => ds.setzePfad(a.linien[i], [[z.fahneStartS, 0], [z.fahneStartS + l.t60, DB_MIN]]));
    const ms = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
    markePre.textContent = `PRE ${ms(e.pre_ms)} ms`;
    markeEr.textContent = `EARLY (24 taps) ${ms(e.pre_ms)} to ${ms(e.pre_ms + e.groesse_ms)} ms`;
    markeFahne.textContent = `TAIL from ${ms(e.pre_ms + e.groesse_ms / 2)} ms`;
    z.linien.forEach((l, i) => { a.legende[i].textContent = `${fText(l.f)}Hz  ${sek(l.t60)} s`; });
  };

  // ---- display B: decay time over frequency (log axis on the left) and the wet tone (dB axis on the right)
  const dsB = baueAnzeige(rumpfB, { breite: 420, hoehe: 250, rand: 34, randR: 40, x: F_ACHSE, y: T60_ACHSE, gitterX: [20, 100, 1000, 10000, 20000], gitterY: [0.1, 1, 10, 100],
    titelX: 'FREQUENCY Hz', titelY: 'T60 s', formatX: fText, formatY: String, label: 'Decay time and wet tone of the Hall over frequency' });
  const dbY = (db) => dsB.innen.y0 + (1 - (Math.min(DB_MAX, Math.max(DB_MIN, db)) - DB_MIN) / (DB_MAX - DB_MIN)) * (dsB.innen.y1 - dsB.innen.y0);   // the right axis in pixels
  const svgB = dsB.svg;
  const textB = (klasse, x, y, s, anker) => {
    const t = d.createElementNS ? d.createElementNS('http://www.w3.org/2000/svg', 'text') : d.createElement('text');
    t.setAttribute('class', klasse); t.setAttribute('x', x.toFixed(1)); t.setAttribute('y', y.toFixed(1)); t.setAttribute('text-anchor', anker); t.textContent = s;
    svgB.append(t);
    return t;
  };
  for (const db of [-48, -24, 0, 12]) textB('fa-skala fa-hall-skala-r', dsB.innen.x1 + 4, dbY(db) + 3, String(db).replace('-', '−'), 'start');
  const mitteY = (dsB.innen.y0 + dsB.innen.y1) / 2;
  textB('fa-titel fa-hall-titel-r', 412, mitteY, 'WET TONE dB', 'middle').setAttribute('transform', `rotate(90 412 ${mitteY.toFixed(1)})`);
  for (const f of HALL_ANKER) dsB.linieV('fa-hall-ankerlinie', f);
  const tonPfad = dsB.pfad('fa-hall-ton', []);
  const t60Pfad = dsB.pfad('fa-hall-t60', []);
  const anker = HALL_ANKER.map((f, i) => dsB.punkt(`fa-hall-anker fa-hall-t${i}`, f, 1, 3.5));
  const frequenzen = Array.from({ length: 121 }, (_, i) => 20 * 1000 ** (i / 120));   // 20 Hz .. 20 kHz, log spaced
  const zeichneB = (e) => {
    dsB.setzePfad(t60Pfad, frequenzen.map((f) => [f, hallT60(e, f)]));
    dsB.setzePfad(tonPfad, frequenzen.map((f) => [f, dsB.wertY(dbY(hallFahneDb(e, f)))]));
    HALL_ANKER.forEach((f, i) => { anker[i].setAttribute('cx', dsB.px(f).toFixed(1)); anker[i].setAttribute('cy', dsB.py(hallT60(e, f)).toFixed(1)); });
  };
  const zeichne = () => { const e = einstellung(); zeichneA(e); zeichneB(e); };

  // ---- the plate: six knobs in real units; a refused write puts the knob back to the confirmed value
  let platte = null;
  const platteTab = hallParameterTabelle();
  platte = baueReglerPlatte(platteHost, {
    titel: '', abschnitte: [{ id: 'r1', cols: 6, steuer: HALL_KNOEPFE.map(([feld, label]) => ({ param: feld, typ: 'knob', label })) }], parameter: platteTab, akzent: 'tuerkis', dokument: d,
    adapter: {
      get: (feld) => hallEinheit(feld, norm(feld)),
      set: (feld, wert) => {
        const eintrag = { v: hallNormVon(feld, wert) };
        lokal.set(feld, eintrag);
        zeichne();
        const fertig = () => { if (lokal.get(feld) !== eintrag) return; lokal.delete(feld); zeichne(); platte?.aktualisiere(true); };   // the answer is in: the project's value counts again
        Promise.resolve(quelle.set(feld, eintrag.v)).then(fertig, fertig);
      },
      ende: () => quelle.ende?.(),
    },
  });
  let gedimmt = null;
  const dimme = () => { const aus = quelle.an ? quelle.an.get() === false : false; if (aus !== gedimmt) { gedimmt = aus; wurzel.classList.toggle('fa-aus', aus); } };
  zeichne(); dimme();
  return {
    aktualisiere() { platte.aktualisiere(); zeichne(); dimme(); },
    zerstoere() { lokal.clear(); platte.zerstoere(); wurzel.remove?.(); },
  };
}
