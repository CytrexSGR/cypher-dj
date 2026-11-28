// Device faces: the limiter insert. The static curve (pure: the gain computer q = min(1, ceiling / peak) of core/dsp/include/cypherdj/dsp/channel_limiter.h in dB;
// look-ahead and release act on the time axis only) and the builder of the face: ceiling line, transfer curve and the two knobs.
// The gain-reduction meter (T8) sits in `meterPlatz` beside the display; the core sends the limiter's reduction on /e/ins_gr as `ins/lim/<n>`.
import { LIM_PARAMETER } from '../production/inserts.js';
import { baueAnzeige, baueMeter, baueSpitzenBalken } from './display.js';
import { baueReglerPlatte } from './frame.js';

export const LIM_ACHSEN = { x: { min: -60, max: 6 }, y: { min: -60, max: 6 } };
/** Fixed settings of the limiter stage: core/include/cypherdj/ins_lim.h (look-ahead 1.5 ms, latency 86 samples at 48 kHz = 74 + 12 of the true-peak interpolator). */
export const LIM_VORHALT_MS = 1.5;
export const LIM_LATENZ_SAMPLES = 86;
export const LIM_FESTZEILE = `True peak · look-ahead ${LIM_VORHALT_MS} ms (fixed) · latency ${LIM_LATENZ_SAMPLES} samples`;

/** The ceiling in dB from a stage value: missing, NaN or out of range gives the default / the clamped value of LIM_PARAMETER. */
export function limDecke(werte = {}) {
  const q = LIM_PARAMETER.find((x) => x.name === 'decke');
  const v = werte?.decke;
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(q.max, Math.max(q.min, v)) : q.vorgabe;
}

/** Static output level in dB for the input peak level x in dB: min(x, ceiling). */
export const limAusgangDb = (x, decke) => Math.min(x, decke);

/** The curve as the points where it bends: [[x, y]] from the left edge to the right edge of the display (follows the diagonal up to the ceiling, then flat). */
export function limKurve(decke) {
  const c = limDecke({ decke });
  const x0 = LIM_ACHSEN.x.min, x1 = LIM_ACHSEN.x.max;
  const xs = c > x0 && c < x1 ? [x0, c, x1] : [x0, x1];
  return xs.map((x) => [x, limAusgangDb(x, c)]);
}

/** {name: {name, label, min, max, log, einheit, vorgabe}} for the knob plate: the release is logarithmic. */
export const limParameterTabelle = (liste = LIM_PARAMETER) => Object.fromEntries(liste.map((q) => [q.name, { name: q.name, label: q.label, min: q.min, max: q.max, log: q.name === 'abklingen', einheit: q.einheit, vorgabe: q.vorgabe }]));

const LOKAL_MS = 800;   // a value the hand just set is shown for this long, before the project echoes it

/** The limiter face into `host`. quelle = {parameter, get(name), set(name, v), ende?(), gesperrt?(name), an: {get(), set(b)}}. Returns
 *  {aktualisiere(), live(), zerstoere(), meterPlatz}.
 *  quelle.pegel?(jetzt) is {ein, aus} in dBFS or null: the input and output peak bars (T9). quelle.gr?(jetzt) is the reading of the stage's gain reduction in dB (or null): it goes into the meter in `meterPlatz` (scale 0 to 12 dB). A bypassed stage shows "–"
 *  and an empty bar even when a late reading arrives (the core sends none for a bypassed stage). live(jetzt) is one frame: true when the reading changed. */
export function baueLimiterFace(host, quelle) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse) => { const e = d.createElement(tag); e.setAttribute('class', klasse); return e; };
  const wurzel = mk('div', 'fa-lim'), oben = mk('div', 'fa-lim-oben'), kurve = mk('div', 'fa-lim-kurve'), meterPlatz = mk('div', 'fa-lim-gr-platz'), pegelHost = mk('div', 'fa-lim-pegel'), platteHost = mk('div', 'fa-lim-platte');
  const fest = mk('div', 'fa-lim-fest');
  fest.textContent = LIM_FESTZEILE;
  const titelGr = mk('span', 'fa-komp-meter-titel');
  titelGr.textContent = 'GR';
  meterPlatz.append(titelGr);
  oben.append(kurve, pegelHost, meterPlatz);
  wurzel.append(oben, fest, platteHost);
  host.append(wurzel);
  const balken = baueSpitzenBalken(pegelHost, { artikel: 'the limiter' });
  const meter = baueMeter(meterPlatz, { min: 0, max: 12, label: 'Gain reduction of the limiter', einheit: 'dB' });
  const jetzt = () => globalThis.performance?.now?.() ?? Date.now();
  const lokal = new Map();
  const wert = (n) => {
    const l = lokal.get(n);
    if (l && jetzt() - l.t < LOKAL_MS) return l.v;
    return quelle.get(n);
  };
  const decke = () => limDecke({ decke: wert('decke') });

  // ---- the display: -60..+6 dB on both axes, the ceiling as a line with its number
  const ds = baueAnzeige(kurve, { breite: 340, hoehe: 340, rand: 30, x: LIM_ACHSEN.x, y: LIM_ACHSEN.y, gitterX: [-60, -48, -36, -24, -12, 0], gitterY: [-60, -48, -36, -24, -12, 0],
    titelX: 'INPUT dB', titelY: 'OUTPUT dB', label: 'Static transfer curve of the limiter' });
  ds.text('fa-unterschrift', -58, 3.2, 'STATIC CURVE', 'start');
  ds.pfad('fa-diagonale', [[-60, -60], [6, 6]]);
  const deckeLinie = ds.linieH('fa-decke', -1);
  const deckeText = ds.text('fa-marke', 5, -1, '', 'end');
  const kurvePfad = ds.pfad('fa-kurve', []);
  const zeichne = () => {
    const c = decke();
    ds.setzePfad(kurvePfad, limKurve(c));
    const y = ds.py(c).toFixed(1);
    deckeLinie.setAttribute('y1', y); deckeLinie.setAttribute('y2', y);
    deckeText.textContent = `CEILING ${c.toFixed(1).replace('-', '−')} dB`;
    // the label sits above the line, below it when the ceiling is at the top of the display
    deckeText.setAttribute('y', (ds.py(c) + (c > 0 ? 11 : -4)).toFixed(1));
  };

  // ---- the plate
  const steuer = LIM_PARAMETER.filter((q) => quelle.parameter[q.name]).map((q) => ({ param: q.name, typ: 'knob', label: quelle.parameter[q.name].label }));
  const platte = baueReglerPlatte(platteHost, {
    titel: '', abschnitte: [{ id: 'r1', cols: Math.max(1, steuer.length), steuer }], parameter: quelle.parameter, akzent: 'tuerkis', dokument: d,
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
  let gedimmt = null;
  const dimme = () => {
    const aus = quelle.an ? quelle.an.get() === false : false;
    if (aus !== gedimmt) { gedimmt = aus; wurzel.classList.toggle('fa-aus', aus); }
  };
  let zuletzt = null, pegelZuletzt = 'undefined|undefined';
  const zeigeGr = (jetztZeit) => {
    dimme();
    const gr = gedimmt ? null : (quelle.gr?.(jetztZeit) ?? null);
    const aenderung = gr !== zuletzt;
    zuletzt = gr;
    meter.setze(gr, jetztZeit);
    const pg = gedimmt ? null : (quelle.pegel?.(jetztZeit) ?? null);
    balken.setze(pg, jetztZeit);
    const pegelNeu = `${pg?.ein}|${pg?.aus}`;
    const pegelAnders = pegelNeu !== pegelZuletzt;
    pegelZuletzt = pegelNeu;
    return aenderung || pegelAnders;
  };
  zeichne(); zeigeGr(jetzt());
  return {
    meterPlatz,
    aktualisiere() { platte.aktualisiere(); zeichne(); zeigeGr(jetzt()); },
    live(jetztZeit = jetzt()) { return zeigeGr(jetztZeit); },
    zerstoere() { meter.zerstoere(); balken.zerstoere(); platte.zerstoere(); wurzel.remove?.(); },
  };
}
