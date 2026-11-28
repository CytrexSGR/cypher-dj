// Device faces: the transient shaper insert. Two big knobs (Attack, Sustain in dB), Speed, Output and Mix on the plate, and one live number: the largest gain
// change the shaper made (/e/ins_gr `ins/trans/<n>`, signed text, same store and 500 ms rule as the other readings).
import { TRANS_PARAMETER } from '../production/inserts.js';
import { baueReglerPlatte } from './frame.js';

/** {name: {name, label, min, max, log, einheit, vorgabe}} for the knob plate (all linear). */
export const transParameterTabelle = (liste = TRANS_PARAMETER) => Object.fromEntries(liste.map((q) => [q.name, { name: q.name, label: q.label, min: q.min, max: q.max, log: false, einheit: q.einheit, vorgabe: q.vorgabe }]));

/** The text of the live readout: "–" without a reading, else the gain change in dB with its sign ("+3.2 dB"). */
export const transGrText = (db) => (typeof db === 'number' && Number.isFinite(db) ? `${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB` : '–');

const LOKAL_MS = 800;   // a value the hand just set is shown for this long, before the project echoes it

/** The transient shaper face into `host`. quelle = {parameter, get(name), set(name, v), ende?(), gesperrt?(name), an: {get(), set(b)}, gr?(jetzt)}. Returns
 *  {aktualisiere(), live(), zerstoere()}. live(jetzt) is one frame: true when the readout changed. A bypassed stage shows "–". */
export function baueTransientFace(host, quelle) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse) => { const e = d.createElement(tag); e.setAttribute('class', klasse); return e; };
  const wurzel = mk('div', 'fa-trans'), anzeige = mk('div', 'fa-trans-gr'), titel = mk('span', 'fa-komp-meter-titel'), zahl = mk('output', 'fa-trans-gr-text'), platteHost = mk('div', 'fa-trans-platte');
  titel.textContent = 'GAIN CHANGE';
  zahl.textContent = '–';
  zahl.setAttribute('aria-label', 'Largest gain change of the transient shaper');
  anzeige.append(titel, zahl);
  wurzel.append(platteHost, anzeige);
  host.append(wurzel);
  const jetzt = () => globalThis.performance?.now?.() ?? Date.now();
  const lokal = new Map();
  const wert = (n) => {
    const l = lokal.get(n);
    if (l && jetzt() - l.t < LOKAL_MS) return l.v;
    return quelle.get(n);
  };
  const stell = (n) => ({ param: n, typ: 'knob', label: quelle.parameter[n].label });
  const vorhanden = (l) => l.filter((n) => quelle.parameter[n]);
  const abschnitte = [
    { id: 'gross', cols: 2, steuer: vorhanden(['angriff', 'halten']).map(stell) },
    { id: 'klein', cols: 3, steuer: vorhanden(['tempo', 'out', 'mix']).map(stell) },
  ].filter((a) => a.steuer.length);
  const platte = baueReglerPlatte(platteHost, {
    titel: '', abschnitte, parameter: quelle.parameter, akzent: 'gruen', dokument: d,
    adapter: {
      get: (n) => wert(n),
      set: (n, v) => {
        const eintrag = { v, t: jetzt() };
        lokal.set(n, eintrag);
        // a refused write (the source resolves false): the knob goes back to the last confirmed value
        Promise.resolve(quelle.set(n, v)).then((ok) => { if (ok === false && lokal.get(n) === eintrag) { lokal.delete(n); platte.aktualisiere(); } }, () => {});
      },
      gesperrt: (n) => quelle.gesperrt?.(n) === true,
      ende: () => quelle.ende?.(),
    },
  });
  let gedimmt = null, zuletzt = '–';
  const dimme = () => {
    const aus = quelle.an ? quelle.an.get() === false : false;
    if (aus !== gedimmt) { gedimmt = aus; wurzel.classList.toggle('fa-aus', aus); }
  };
  const zeigeGr = (jetztZeit) => {
    dimme();
    const t = transGrText(gedimmt ? null : (quelle.gr?.(jetztZeit) ?? null));
    const anders = t !== zuletzt;
    zuletzt = t;
    zahl.textContent = t;
    return anders;
  };
  zeigeGr(jetzt());
  return {
    aktualisiere() { platte.aktualisiere(); zeigeGr(jetzt()); },
    live(jetztZeit = jetzt()) { return zeigeGr(jetztZeit); },
    zerstoere() { platte.zerstoere(); wurzel.remove?.(); },
  };
}
