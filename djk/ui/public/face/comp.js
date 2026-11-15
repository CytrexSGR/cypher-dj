// Device faces: the compressor. The maths of the drawn transfer curve (pure, pinned to comp_dsp by the golden table djk/instruments/comp_dsp/tests/data/kennlinie.csv)
// and the builder of the face: the curve display and the knob plate. Used for the insert compressor (production/insert_face.js) and, later, the channel compressor.
import { kennlinie } from '../effects.js';
import { KOMP_PARAMETER } from '../production/inserts.js';
import { baueAnzeige, baueMeter, baueSpitzenBalken, pegelAnzeigbar } from './display.js';
import { baueReglerPlatte } from './frame.js';

export const KOMP_ACHSEN = { x: { min: -60, max: 0 }, y: { min: -60, max: 24 } };

/** The compressor values the curve needs: a missing, NaN or out-of-range entry becomes the default of KOMP_PARAMETER or is clamped into its range. */
export function kompEinstellung(werte = {}) {
  const aus = {};
  for (const [feld, name] of [['schwelle', 'schwelle'], ['ratio', 'ratio'], ['knie', 'knie'], ['makeup', 'makeup'], ['mix', 'mix']]) {
    const q = KOMP_PARAMETER.find((x) => x.name === name);
    const v = werte?.[name];
    aus[feld] = typeof v === 'number' && Number.isFinite(v) ? Math.min(q.max, Math.max(q.min, v)) : q.vorgabe;
  }
  return aus;
}

/** Gain reduction in dB (>= 0) at input level x: x - kennlinie(x). */
export const kompGrDb = (x, e) => Math.max(0, x - kennlinie(x, e.schwelle, e.ratio, e.knie));

/** Steady-state output level for the input level x: the block of comp_dsp/src/lib.rs (mix, makeup) at rest. */
export function kompAusgangDb(x, e) {
  const abs = x - kennlinie(x, e.schwelle, e.ratio, e.knie);
  return x + 20 * Math.log10(e.mix * 10 ** ((e.makeup - abs) / 20) + 1 - e.mix);
}

/** The curve from -60 to 0 dB input, both ends included: [[x, y]]. */
export function kompKurve(e, schritt = 0.5) {
  const n = Math.round(60 / schritt), aus = [];
  for (let i = 0; i <= n; i++) { const x = -60 + i * schritt; aus.push([x, kompAusgangDb(x, e)]); }
  return aus;
}

/** The channel compressor's level report (/e/stufe_pegel, kanal `komp/<channel>`) into the store {channel: {ein, aus, t}}; false for a report that is not for a channel or has a non-finite level. */
export function kompPegelAufnehmen(stand, f, jetzt) {
  const m = /^komp\/((?:deck|erz|pad)\/[0-9]+)$/.exec(typeof f?.kanal === 'string' ? f.kanal : '');
  if (!m || typeof f.ein_db !== 'number' || typeof f.aus_db !== 'number' || !Number.isFinite(f.ein_db) || !Number.isFinite(f.aus_db)) return false;
  stand[m[1]] = { ein: f.ein_db, aus: f.aus_db, t: jetzt };
  return true;
}

/** Whether the display is dimmed: a bypassed stage (an false) or a stage at mix 0 does nothing to the signal. */
export const kompDimmung = (an, mix) => !an || !(mix > 0);

/** The knob scales of the compressor: ratio, attack and release are logarithmic (the table of the page lists them linear for its sliders). */
const KOMP_LOG = new Set(['ratio', 'attack', 'release']);
/** {name: {name, label, min, max, log, einheit, vorgabe}} for the knob plate from a KOMP_PARAMETER style list. */
export function kompParameterTabelle(liste) {
  return Object.fromEntries(liste.map((q) => [q.name, { name: q.name, label: q.label, min: q.min, max: q.max, log: KOMP_LOG.has(q.name), einheit: q.name === 'ratio' ? ':1' : q.einheit, vorgabe: q.vorgabe }]));
}

const REIHEN = [['schwelle', 'ratio', 'knie', 'attack'], ['release', 'makeup', 'mix', 'schp']];
const LOKAL_MS = 800;   // a value the hand just set is shown for this long, before the project echoes it

/** The compressor face into `host`: the curve display above the knob plate. quelle = {parameter, get(name), set(name, v), ende?(), gesperrt?(name),
 *  knie: 'regler' | {fest: number}, an: {get(), set(b)}, schluessel, gr?(jetzt), pegel?(jetzt) -> {ein, aus} in dBFS or null}. Returns {aktualisiere(), verwerfe(name?), live(jetzt) -> boolean, zerstoere()}. */
export function baueKompFace(host, quelle) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse) => { const e = d.createElement(tag); e.setAttribute('class', klasse); return e; };
  const wurzel = mk('div', 'fa-komp');
  const oben = mk('div', 'fa-komp-oben'), kurve = mk('div', 'fa-komp-kurve'), platteHost = mk('div', 'fa-komp-platte'), meterHost = mk('div', 'fa-komp-meter'), pegelHost = mk('div', 'fa-komp-pegel');
  const schluesselZeile = mk('div', 'fa-komp-schluessel');
  const titelGr = mk('span', 'fa-komp-meter-titel');
  titelGr.textContent = 'GR';
  meterHost.append(titelGr);
  oben.append(kurve, pegelHost, meterHost);
  wurzel.append(schluesselZeile, oben, platteHost);
  host.append(wurzel);
  const meter = baueMeter(meterHost, { min: 0, max: 24, label: 'Gain reduction of the compressor', einheit: 'dB' });
  const balken = baueSpitzenBalken(pegelHost, { artikel: 'the compressor' });
  // the key: a read-only chip with the source (the insert compressor: it is changed in the parameter list), or a select when the source object offers the options
  const sl = quelle.schluessel ?? { text: () => '' };
  let schluesselEl;
  if (Array.isArray(sl.optionen)) {
    schluesselEl = mk('select', 'fa-komp-schluessel-wahl');
    schluesselEl.setAttribute('aria-label', 'Sidechain key of the compressor');
    for (const [w, text] of sl.optionen) { const o = d.createElement('option'); o.value = String(w); o.textContent = text; schluesselEl.append(o); }
    schluesselEl.addEventListener('change', () => sl.set(schluesselEl.value));
  } else { schluesselEl = mk('span', 'fa-komp-schluessel-chip'); schluesselEl.title = 'Sidechain key source (change it in the parameter list of the stage)'; }
  schluesselZeile.append(schluesselEl);
  const zeigeSchluessel = () => {
    if (Array.isArray(sl.optionen)) { const g = String(sl.get()); if (schluesselEl.value !== g) schluesselEl.value = g; }
    else { const t = sl.text(); if (schluesselEl.textContent !== t) schluesselEl.textContent = t; }
    schluesselZeile.hidden = !Array.isArray(sl.optionen) && !sl.text();
  };
  const fest = typeof quelle.knie === 'object' && quelle.knie ? quelle.knie.fest : null;
  const jetzt = () => globalThis.performance?.now?.() ?? Date.now();
  const lokal = new Map();
  const wert = (n) => {
    if (n === 'knie' && fest !== null) return fest;
    const l = lokal.get(n);
    if (l && jetzt() - l.t < LOKAL_MS) return l.v;
    return quelle.get(n);
  };
  const einstellung = () => kompEinstellung(Object.fromEntries(['schwelle', 'ratio', 'knie', 'makeup', 'mix'].map((n) => [n, wert(n)])));

  // ---- the display
  const ds = baueAnzeige(kurve, { breite: 400, hoehe: 252, rand: 30, x: KOMP_ACHSEN.x, y: KOMP_ACHSEN.y, gitterX: [-60, -48, -36, -24, -12, 0], gitterY: [-60, -48, -36, -24, -12, 0, 12, 24],
    titelX: 'INPUT dB', titelY: 'OUTPUT dB', label: 'Transfer curve of the compressor' });
  const kniePfad = ds.pfad('fa-knie', [[-60, 24], [-60, 24]], { flaeche: true });
  ds.pfad('fa-diagonale', [[-60, -60], [0, 0]]);
  const kurvePfad = ds.pfad('fa-kurve', []);
  const schwelleLinie = ds.linieV('fa-schwelle', -18);
  const knick = ds.punkt('fa-knick', -18, -18, 3.5);
  const marke = ds.text('fa-marke', -18, 22, 'THR', 'middle');
  // the operating point NOW (T9): the peak of the last level report, input against output, on the plane of the curve; hidden without a fresh reading
  const jetztPunkt = ds.punkt('fa-jetzt', -60, -60, 4.5);
  const jetztText = ds.text('fa-jetzt-text', -60, -60, 'NOW', 'start');
  jetztPunkt.setAttribute('visibility', 'hidden'); jetztText.setAttribute('visibility', 'hidden');
  const jetztTitel = d.createElementNS('http://www.w3.org/2000/svg', 'title');
  jetztTitel.textContent = 'NOW: the input and output peak of the last report (about 50 ms), not the steady state the curve describes';
  jetztPunkt.append(jetztTitel);
  const setzeX = (l, xw) => { l.setAttribute('x1', ds.px(xw).toFixed(1)); l.setAttribute('x2', ds.px(xw).toFixed(1)); };
  if (fest !== null) {
    const t = mk('div', 'fa-komp-fest');
    t.textContent = `Knee ${fest} dB (fixed)`;
    kurve.append(t);
  }
  const zeichne = () => {
    const e = einstellung();
    ds.setzePfad(kurvePfad, kompKurve(e));
    ds.setzePfad(kniePfad, [[e.schwelle - e.knie / 2, 24], [e.schwelle + e.knie / 2, 24]], { flaeche: true });
    setzeX(schwelleLinie, e.schwelle);
    knick.setAttribute('cx', ds.px(e.schwelle).toFixed(1)); knick.setAttribute('cy', ds.py(kompAusgangDb(e.schwelle, e)).toFixed(1));
    marke.setAttribute('x', ds.px(e.schwelle).toFixed(1));
  };

  // ---- the plate
  const abschnitte = REIHEN.map((reihe, i) => {
    const steuer = reihe.filter((n) => quelle.parameter[n] && !(n === 'knie' && fest !== null)).map((n) => ({ param: n, typ: 'knob', label: quelle.parameter[n].label }));
    return { id: `r${i + 1}`, cols: Math.max(1, Math.min(4, steuer.length)), steuer };
  }).filter((a) => a.steuer.length);
  const platte = baueReglerPlatte(platteHost, {
    titel: '', abschnitte, parameter: quelle.parameter, akzent: 'orange', dokument: d,
    adapter: {
      get: (n) => wert(n),
      set: (n, v) => { lokal.set(n, { v, t: jetzt() }); quelle.set(n, v); zeichne(); },
      gesperrt: (n) => quelle.gesperrt?.(n) === true,
      ende: () => quelle.ende?.(),
    },
  });
  // dimming and the meter: a bypassed stage or mix 0 shows "-" and an empty bar, even when a reading arrives (the core sends none for them, a late one is stale)
  let gedimmt = null, zuletzt = null;
  const dimme = () => {
    const aus = kompDimmung(quelle.an ? quelle.an.get() !== false : true, einstellung().mix);
    if (aus !== gedimmt) { gedimmt = aus; wurzel.classList.toggle('fa-aus', aus); }
    return aus;
  };
  const zeigeGr = (jetztZeit) => {
    const aus = dimme();
    const gr = aus ? null : (quelle.gr?.(jetztZeit) ?? null);
    const pg = aus ? null : (quelle.pegel?.(jetztZeit) ?? null);
    const ein = pegelAnzeigbar(pg?.ein) ? pg.ein : null, ausgang = pegelAnzeigbar(pg?.aus) ? pg.aus : null;
    const signatur = `${gr}|${ein}|${ausgang}`;
    const aenderung = signatur !== zuletzt;
    zuletzt = signatur;
    meter.setze(gr, jetztZeit);
    balken.setze(ein === null && ausgang === null ? null : { ein, aus: ausgang }, jetztZeit);
    const da = ein !== null && ausgang !== null;
    for (const e of [jetztPunkt, jetztText]) e.setAttribute('visibility', da ? 'visible' : 'hidden');
    if (da) {
      const x = ds.px(ein), y = ds.py(ausgang), rechts = x > ds.innen.x1 - 40;   // the label goes to the left of the dot near the right edge
      jetztPunkt.setAttribute('cx', x.toFixed(1)); jetztPunkt.setAttribute('cy', y.toFixed(1));
      jetztText.setAttribute('x', (x + (rechts ? -8 : 8)).toFixed(1)); jetztText.setAttribute('y', (y + 3).toFixed(1)); jetztText.setAttribute('text-anchor', rechts ? 'end' : 'start');
    }
    return aenderung;
  };
  zeichne(); zeigeSchluessel(); zeigeGr(jetzt());
  return {
    aktualisiere(erzwingen = false) { platte.aktualisiere(erzwingen); zeichne(); zeigeSchluessel(); zeigeGr(jetzt()); },
    /** Forgets the values the hand just set (all, or one name) and redraws from the source: a refused write puts the knob back to the last confirmed value. */
    verwerfe(name) { if (name === undefined) lokal.clear(); else lokal.delete(name); this.aktualisiere(true); },
    /** one frame: the gain-reduction reading into the meter; true when the reading changed */
    live(jetztZeit = jetzt()) { return zeigeGr(jetztZeit); },
    zerstoere() { meter.zerstoere(); balken.zerstoere(); platte.zerstoere(); wurzel.remove?.(); },
  };
}
