// Device faces: the compressor. The maths of the drawn transfer curve (pure, pinned to comp_dsp by the golden table djk/instruments/comp_dsp/tests/data/kennlinie.csv)
// and the builder of the face: the curve display and the knob plate. Used for the insert compressor (production/insert_face.js) and, later, the channel compressor.
import { kennlinie } from '../effects.js';
import { KOMP_PARAMETER, GLUE_RATIO, GLUE_ATTACK, GLUE_RELEASE, GLUE_VORLAGEN, glueStufe } from '../production/inserts.js';
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
const REIHEN_GLUE = [['schwelle', 'makeup', 'mix', 'schp']];   // glue mode: ratio, attack and release are the selectors, the knee comes with the style
const GLUE_GR_MAX = 20;   // the needle meter of the glue face: 0..20 dB
const GLUE_SKALA = [0, 3, 6, 10, 20];
const GLUE_WINKEL = 55;   // the needle swings from -55 to +55 degrees

/** The needle position (degrees, -55..55) for a gain reduction in dB; null (no reading) rests at 0 dB. */
export const glueNadelWinkel = (gr) => -GLUE_WINKEL + 2 * GLUE_WINKEL * Math.min(1, Math.max(0, Number.isFinite(gr) ? gr : 0) / GLUE_GR_MAX);

/** The needle meter (SVG) of the glue face: role meter, aria-valuenow while a reading is fresh. Returns {setze(gr | null), zerstoere()}. */
function baueNadel(host) {
  const d = host.ownerDocument ?? globalThis.document, NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attr, text) => { const e = d.createElementNS(NS, tag); for (const [k, v] of Object.entries(attr)) e.setAttribute(k, String(v)); if (text !== undefined) e.textContent = text; return e; };
  const wurzel = d.createElement('div');
  wurzel.setAttribute('class', 'fa-glue-nadel'); wurzel.setAttribute('role', 'meter'); wurzel.setAttribute('aria-label', 'Gain reduction of the glue compressor');
  wurzel.setAttribute('aria-valuemin', '0'); wurzel.setAttribute('aria-valuemax', String(GLUE_GR_MAX));
  const svg = el('svg', { viewBox: '0 0 120 80', width: 120, height: 80 });
  const cx = 60, cy = 70, r = 56, pol = (w, rr) => [cx + rr * Math.sin(w * Math.PI / 180), cy - rr * Math.cos(w * Math.PI / 180)];
  const [x0, y0] = pol(-GLUE_WINKEL, r), [x1, y1] = pol(GLUE_WINKEL, r);
  svg.append(el('path', { class: 'fa-glue-bogen', d: `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`, fill: 'none' }));
  for (const t of GLUE_SKALA) {
    const w = glueNadelWinkel(t), [a, b] = pol(w, r), [c, e] = pol(w, r - 6), [tx, ty] = pol(w, r - 14);
    svg.append(el('line', { class: 'fa-glue-strich', x1: a.toFixed(1), y1: b.toFixed(1), x2: c.toFixed(1), y2: e.toFixed(1) }), el('text', { class: 'fa-glue-zahl', x: tx.toFixed(1), y: (ty + 3).toFixed(1), 'text-anchor': 'middle' }, String(t)));
  }
  const nadel = el('line', { class: 'fa-glue-zeiger', x1: cx, y1: cy, x2: cx, y2: cy - r + 4 });
  svg.append(nadel, el('circle', { class: 'fa-glue-nabe', cx, cy, r: 3 }));
  const text = d.createElement('output');
  text.setAttribute('class', 'fa-glue-text'); text.textContent = '–';
  wurzel.append(svg, text);
  host.append(wurzel);
  return {
    setze(gr) {
      const da = typeof gr === 'number' && Number.isFinite(gr);
      nadel.setAttribute('transform', `rotate(${glueNadelWinkel(da ? gr : 0).toFixed(1)} ${cx} ${cy})`);
      text.textContent = da ? `${Math.min(GLUE_GR_MAX, Math.max(0, gr)).toFixed(1)} dB` : '–';
      if (da) wurzel.setAttribute('aria-valuenow', Math.min(GLUE_GR_MAX, Math.max(0, gr)).toFixed(1)); else wurzel.removeAttribute('aria-valuenow');
    },
    zerstoere() { wurzel.remove?.(); },
  };
}
const LOKAL_MS = 800;   // a value the hand just set is shown for this long, before the project echoes it

/** The compressor face into `host`: the curve display above the knob plate. quelle = {parameter, get(name), set(name, v), ende?(), gesperrt?(name),
 *  knie: 'regler' | {fest: number}, an: {get(), set(b)}, schluessel, gr?(jetzt), pegel?(jetzt) -> {ein, aus} in dBFS or null}. Returns {aktualisiere(), verwerfe(name?), live(jetzt) -> boolean, zerstoere()}. */
export function baueKompFace(host, quelle) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse) => { const e = d.createElement(tag); e.setAttribute('class', klasse); return e; };
  const wurzel = mk('div', 'fa-komp');
  const oben = mk('div', 'fa-komp-oben'), kurve = mk('div', 'fa-komp-kurve'), platteHost = mk('div', 'fa-komp-platte'), meterHost = mk('div', 'fa-komp-meter'), pegelHost = mk('div', 'fa-komp-pegel');
  const schluesselZeile = mk('div', 'fa-komp-schluessel'), glueHost = mk('div', 'fa-komp-glue'), nadelHost = mk('div', 'fa-komp-nadel');
  const titelGr = mk('span', 'fa-komp-meter-titel');
  titelGr.textContent = 'GR';
  meterHost.append(titelGr);
  glueHost.hidden = true; nadelHost.hidden = true;
  oben.append(kurve, pegelHost, meterHost, nadelHost);
  wurzel.append(schluesselZeile, glueHost, oben, platteHost);
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
  // glue mode (strand 13): the stage has the glue row and it is on; the DSP snaps ratio, attack and release, so the curve uses the snapped ratio
  const glueAn = () => !!quelle.parameter.glue && wert('glue') >= 0.5;
  const einstellung = () => {
    const e = kompEinstellung(Object.fromEntries(['schwelle', 'ratio', 'knie', 'makeup', 'mix'].map((n) => [n, wert(n)])));
    return glueAn() ? { ...e, ratio: glueStufe(GLUE_RATIO, e.ratio) } : e;
  };

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
  const abschnitteVon = (reihen) => reihen.map((reihe, i) => {
    const steuer = reihe.filter((n) => quelle.parameter[n] && !(n === 'knie' && fest !== null)).map((n) => ({ param: n, typ: 'knob', label: quelle.parameter[n].label }));
    return { id: `r${i + 1}`, cols: Math.max(1, Math.min(4, steuer.length)), steuer };
  }).filter((a) => a.steuer.length);
  const baueGlatte = (reihen) => baueReglerPlatte(platteHost, {
    titel: '', abschnitte: abschnitteVon(reihen), parameter: quelle.parameter, akzent: 'orange', dokument: d,
    adapter: {
      get: (n) => wert(n),
      set: (n, v) => { lokal.set(n, { v, t: jetzt() }); quelle.set(n, v); zeichne(); },
      gesperrt: (n) => quelle.gesperrt?.(n) === true,
      ...(quelle.modKnopf ? { modKnopf: (n) => quelle.modKnopf(n) } : {}),
      ende: () => quelle.ende?.(),
    },
  });
  let modus = glueAn(), platte = baueGlatte(modus ? REIHEN_GLUE : REIHEN);

  // ---- glue mode: title, stepped selectors, AUTO, STYLE and the needle meter; built when the stage is a glue stage, removed when it is not
  const glue = { titel: null, wahl: {}, auto: null, stil: null, nadel: null };
  const schreibe = (n, v) => { lokal.set(n, { v, t: jetzt() }); quelle.set(n, v); zeichne(); zeigeGlue(); quelle.ende?.(); };
  const baueGlueKopf = () => {
    glue.titel = mk('b', 'fa-komp-titel'); glue.titel.textContent = 'Cypher Glue';
    glueHost.append(glue.titel);
    for (const [n, label, liste, text] of [['ratio', 'Ratio', GLUE_RATIO, (v) => `${v}:1`], ['attack', 'Attack', GLUE_ATTACK, (v) => `${v} ms`], ['release', 'Release', GLUE_RELEASE, (v) => `${v} ms`]]) {
      const w = d.createElement('select');
      w.setAttribute('class', `fa-glue-wahl fa-glue-${n}`); w.setAttribute('aria-label', label);
      for (const v of liste) { const o = d.createElement('option'); o.value = String(v); o.textContent = text(v); w.append(o); }
      if (n === 'release') { const o = d.createElement('option'); o.value = 'auto'; o.textContent = 'Auto'; w.append(o); }
      w.addEventListener('change', () => { if (w.value !== 'auto') schreibe(n, Number(w.value)); });
      glue.wahl[n] = w;
      const lab = mk('label', 'fa-glue-feld'), t = mk('span', 'fa-glue-name'); t.textContent = label;
      lab.append(t, w); glueHost.append(lab);
    }
    glue.auto = mk('button', 'fa-glue-auto'); glue.auto.setAttribute('type', 'button'); glue.auto.textContent = 'AUTO'; glue.auto.title = 'Auto release: fast after a transient, slow after sustained reduction';
    glue.auto.addEventListener('click', () => schreibe('auto', wert('auto') >= 0.5 ? 0 : 1));
    glue.stil = d.createElement('select');
    glue.stil.setAttribute('class', 'fa-glue-stil'); glue.stil.setAttribute('aria-label', 'Style');
    const o0 = d.createElement('option'); o0.value = ''; o0.textContent = 'STYLE'; glue.stil.append(o0);
    for (const [k, v] of Object.entries(GLUE_VORLAGEN)) { const o = d.createElement('option'); o.value = k; o.textContent = v.text; glue.stil.append(o); }
    glue.stil.addEventListener('change', () => {
      const v = GLUE_VORLAGEN[glue.stil.value];
      glue.stil.value = '';
      if (!v) return;
      // one write with all the values of the recipe (one undo step)
      const paare = Object.entries(v.werte).filter(([n]) => quelle.parameter[n]);
      for (const [n, x] of paare) lokal.set(n, { v: x, t: jetzt() });
      if (quelle.setzeViele) quelle.setzeViele(paare, `Glue style ${v.text}`); else for (const [n, x] of paare) quelle.set(n, x);
      zeichne(); zeigeGlue(); quelle.ende?.();
    });
    glueHost.append(glue.auto, glue.stil);
    glue.nadel = baueNadel(nadelHost);
  };
  const zeigeGlue = () => {
    if (!modus) return;
    const auto = wert('auto') >= 0.5;
    for (const [n, liste] of [['ratio', GLUE_RATIO], ['attack', GLUE_ATTACK], ['release', GLUE_RELEASE]]) {
      const w = glue.wahl[n], g = n === 'release' && auto ? 'auto' : String(glueStufe(liste, wert(n)));
      if (w.value !== g) w.value = g;
      w.disabled = quelle.gesperrt?.(n) === true || (n === 'release' && auto);
    }
    glue.auto.setAttribute('aria-pressed', String(auto)); glue.auto.classList.toggle('an', auto);
  };
  const setzeModus = () => {
    const neu = glueAn();
    if (neu === modus) return;
    modus = neu;
    platte.zerstoere(); platte = baueGlatte(modus ? REIHEN_GLUE : REIHEN);
    if (modus) baueGlueKopf(); else abbauGlueKopf();
    glueHost.hidden = !modus; nadelHost.hidden = !modus; meterHost.hidden = modus;
  };
  const abbauGlueKopf = () => { glue.nadel?.zerstoere(); glue.nadel = null; glueHost.textContent = ''; glue.wahl = {}; };
  if (modus) { baueGlueKopf(); glueHost.hidden = false; nadelHost.hidden = false; meterHost.hidden = true; }
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
    const signatur = `${gr}|${ein}|${ausgang}|${modus}`;
    const aenderung = signatur !== zuletzt;
    zuletzt = signatur;
    meter.setze(gr, jetztZeit);
    glue.nadel?.setze(gr);
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
  zeichne(); zeigeSchluessel(); zeigeGlue(); zeigeGr(jetzt());
  return {
    aktualisiere(erzwingen = false) { setzeModus(); platte.aktualisiere(erzwingen); zeichne(); zeigeSchluessel(); zeigeGlue(); zeigeGr(jetzt()); },
    /** Forgets the values the hand just set (all, or one name) and redraws from the source: a refused write puts the knob back to the last confirmed value. */
    verwerfe(name) { if (name === undefined) lokal.clear(); else lokal.delete(name); this.aktualisiere(true); },
    /** one frame: the gain-reduction reading into the meter; true when the reading changed */
    live(jetztZeit = jetzt()) { return zeigeGr(jetztZeit); },
    zerstoere() { meter.zerstoere(); balken.zerstoere(); glue.nadel?.zerstoere(); platte.zerstoere(); wurzel.remove?.(); },
  };
}
