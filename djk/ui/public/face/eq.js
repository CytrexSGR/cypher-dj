// Device faces: the EQ. The maths of the drawn response (pure, pinned to eq_dsp by the golden table djk/instruments/eq_dsp/tests/data/eq_soll.csv) and the builder of
// the face: the response display with one draggable handle per band above the knob plate of the selected band.
//
// What is drawn is the TARGET response of the DSP (what eq_dsp's tests call `soll_db`: the RBJ analogue prototypes, cuts as Butterworth cascades). eq_dsp designs its
// digital filters by least squares and its own test requires them to follow this target within 0.5 dB up to 20 kHz; the face says so on the display.
import { EQ_TYPEN, EQ_STEIL, EQ_PLATZ, EQ_BAENDER, EQ_BAND_PARAMETER, EQ_KOPF_PARAMETER, EQ_BAND_TYP_VORGABE, EQ_BAND_FREQ_VORGABE, eqBandName, parameterVon } from '../production/inserts.js';
import { baueAnzeige, ziehbar } from './display.js';
import { baueReglerPlatte } from './frame.js';

export const EQ_ACHSEN = { x: { min: 10, max: 22000, log: true }, y: { min: -30, max: 30 } };
export const EQ_BODEN_DB = -120;   // a notch at exactly its centre is minus infinity in the formula
// the clamps of band.rs (FREQ_MIN/MAX, GAIN_MAX, Q_MIN/MAX)
const FREQ = [10, 22000], GAIN = 24, Q = [0.1, 18];
const WURZEL_HALBE = Math.SQRT1_2;   // Rust FRAC_1_SQRT_2: the Q of the last cut section is scaled by q / this (0.707 typed gives -3.0116 instead of -3.0103 at the cut)
const endlich = (x) => typeof x === 'number' && Number.isFinite(x);
const klemme = (x, a, b) => Math.min(b, Math.max(a, x));
const oder = (x, vorgabe) => (endlich(x) ? x : vorgabe);

/** comp. band.rs proportional_q: a bell gets narrower the more it cuts or boosts: q at 12 dB, half of it at 0 dB, one and a half times at 24 dB. */
export const eqProportionalQ = (q, gain) => klemme(q * (0.5 + Math.abs(gain) / 24), Q[0], Q[1]);

/** |H(jx)|^2 of the analogue prototype n/d (coefficients [c2, c1, c0]) at x = f / f0. */
const betrag2 = (n, d, x) => {
  const qu = (c) => { const re = c[2] - c[0] * x * x, im = c[1] * x; return re * re + im * im; };
  return qu(n) / qu(d);
};
const proto = (art, gain, q) => {
  const a = 10 ** (gain / 40), sa = Math.sqrt(a);
  switch (art) {
    case 'glocke': return { n: [1, a / q, 1], d: [1, 1 / (a * q), 1] };
    case 'lowshelf': return { n: [a, a * sa / q, a * a], d: [a, sa / q, 1] };
    case 'highshelf': return { n: [a * a, a * sa / q, a], d: [1, sa / q, a] };
    case 'tiefpass': return { n: [0, 0, 1], d: [1, 1 / q, 1] };
    case 'hochpass': return { n: [1, 0, 0], d: [1, 1 / q, 1] };
    case 'kerbe': return { n: [1, 0, 1], d: [1, 1 / q, 1] };
    default: return { n: [0, 1 / q, 0], d: [1, 1 / q, 1] };   // band pass
  }
};
const db = (art, gain, q, x) => { const p = proto(art, gain, q); return 10 * Math.log10(betrag2(p.n, p.d, x)); };
const ART = ['glocke', 'lowshelf', 'highshelf', 'hochpass', 'tiefpass', 'kerbe', 'bandpass'];   // EQ_TYPEN order = the core's type index

/** A band as the DSP sees it: a missing or non-finite entry becomes the default, the rest is clamped as band.rs does. b = {typ, freq, gain, q, steil}. */
export function eqBand(b = {}) {
  return {
    typ: klemme(Math.round(oder(b.typ, 0)), 0, 6),
    freq: klemme(oder(b.freq, 1000), FREQ[0], FREQ[1]),
    gain: klemme(oder(b.gain, 0), -GAIN, GAIN),
    q: klemme(oder(b.q, WURZEL_HALBE), Q[0], Q[1]),
    steil: klemme(Math.round(oder(b.steil, 0)), 0, 3),
  };
}

/** The target response of ONE band in dB at f Hz (the `soll_db` of eq_dsp/tests/eq.rs), floored at -120 dB. propQ: a bell's Q goes through proportional_q first. */
export function eqBandDb(band, f, propQ = false) {
  const b = eqBand(band), x = f / b.freq, art = ART[b.typ];
  let v;
  if (art === 'hochpass' || art === 'tiefpass') {
    const n = b.steil + 1;
    if (n === 1) v = db(art, 0, b.q, x);
    else {
      v = 0;
      for (let i = 0; i < n; i++) {
        let qi = 1 / (2 * Math.cos(Math.PI * (2 * i + 1) / (4 * n)));
        if (i === n - 1) qi *= b.q / WURZEL_HALBE;
        v += db(art, 0, klemme(qi, Q[0], Q[1]), x);   // the DSP clamps a section's Q (band.rs, entwirf)
      }
    }
  } else if (art === 'kerbe' || art === 'bandpass') v = db(art, 0, b.q, x);
  else v = db(art, b.gain, art === 'glocke' && propQ ? eqProportionalQ(b.q, b.gain) : b.q, x);
  if (Number.isNaN(v)) return 0;
  return Math.max(EQ_BODEN_DB, v);
}

/** The band m (1..8) from the flat values of a stage ('b3/freq' ...): defaults of the plug-in for what is missing. */
export function eqBandWerte(werte, m) {
  const w = (n, vorgabe) => oder(werte?.[eqBandName(m, n)], vorgabe);
  return { an: w('an', 0) >= 0.5, typ: w('typ', EQ_BAND_TYP_VORGABE[m - 1]), freq: w('freq', EQ_BAND_FREQ_VORGABE[m - 1]), gain: w('gain', 0), q: w('q', WURZEL_HALBE), steil: w('steil', 0), platz: Math.round(w('platz', 0)) };
}

/** The response of the whole stage in dB at f: the bands that are on and whose placement applies (`mitte`: Stereo and Mid; `seite`: Stereo and Side), plus the output gain. */
export function eqSummeDb(werte, f, platz = 'mitte') {
  const prop = oder(werte?.propq, 0) >= 0.5;
  let s = klemme(oder(werte?.out, 0), -24, 24);
  for (let m = 1; m <= EQ_BAENDER; m++) {
    const b = eqBandWerte(werte, m);
    if (!b.an) continue;
    const gilt = b.platz === 0 || b.platz === (platz === 'seite' ? 2 : 1);
    if (gilt) s += eqBandDb(b, f, prop);
  }
  return s;
}

/** The response curve, n points log-spaced from 10 Hz to 22 kHz, both ends included: [[f, dB]]. */
export function eqKurve(werte, platz = 'mitte', n = 256) {
  const lo = Math.log(EQ_ACHSEN.x.min), hi = Math.log(EQ_ACHSEN.x.max), aus = [];
  for (let i = 0; i < n; i++) { const f = Math.exp(lo + (hi - lo) * i / (n - 1)); aus.push([f, eqSummeDb(werte, f, platz)]); }
  return aus;
}

const MIT_GAIN = new Set([0, 1, 2]);   // bell, low shelf, high shelf: the gain applies; cuts, notch and band pass have none
/** The handle position of band m: its frequency and, for types with a gain, the gain; `gainFrei` false when it sits on 0 dB and moves sideways only. */
export function eqGriffLage(werte, m) {
  const b = eqBand(eqBandWerte(werte, m));
  const frei = MIT_GAIN.has(b.typ);
  return { freq: b.freq, db: frei ? b.gain : 0, gainFrei: frei };
}

/** The values a drag to {freq, db} sets: {'b<m>/freq', 'b<m>/gain'?}, clamped (gain to 0.1 dB, frequency to 0.01 Hz); no gain for a type without one. */
export function eqGriffZiehen(werte, m, { freq, db: ziel }) {
  const aus = { [eqBandName(m, 'freq')]: Math.round(klemme(oder(freq, 1000), FREQ[0], FREQ[1]) * 100) / 100 };
  if (eqGriffLage(werte, m).gainFrei) aus[eqBandName(m, 'gain')] = Math.round(klemme(oder(ziel, 0), -GAIN, GAIN) * 10) / 10;
  return aus;
}

// ---- the face

const bandParam = (name) => EQ_BAND_PARAMETER.find((x) => x.name === name);
const LOG = new Set(['freq', 'q']);
/** The knob table of a face for the band m (parameter names with the 'b<m>/' prefix) plus the stage's own knobs. */
function parameterTabelle(m) {
  const t = {};
  for (const q of EQ_BAND_PARAMETER) { const v = parameterVon('eq', eqBandName(m, q.name)); t[eqBandName(m, q.name)] = { name: eqBandName(m, q.name), label: q.label, min: q.min, max: q.max, log: LOG.has(q.name), einheit: q.einheit, vorgabe: v.vorgabe }; }
  for (const q of EQ_KOPF_PARAMETER) t[q.name] = { name: q.name, label: q.label, min: q.min, max: q.max, log: false, einheit: q.einheit, vorgabe: q.vorgabe };
  return t;
}
const LOKAL_MS = 800;   // a value the hand just set is shown for this long, before the project echoes it
const RADIUS = 9, KLICK_PX = 3;

/** The EQ face into `host`. quelle = {get(name), gesperrt?(name), set(name, v) -> Promise<boolean>|void, ende?(), an: {get(), set(b)},
 *  griff(m, werte {name: value}, einschalten) -> Promise<boolean>|void, waehleBand?(m), band?() -> m}. Returns {aktualisiere(), live: undefined, zerstoere()}.
 *  The curve and the handle follow the hand while it drags (the values the hand sets are shown at once); a write the project refuses gives the handle back. */
export function baueEqFace(host, quelle) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse) => { const e = d.createElement(tag); e.setAttribute('class', klasse); return e; };
  const wurzel = mk('div', 'fa-eq');
  const anzeigeHost = mk('div', 'fa-eq-anzeige'), reiter = mk('div', 'fa-eq-reiter'), platten = mk('div', 'fa-eq-platten'), bandHost = mk('div', 'fa-eq-band'), wahlHost = mk('div', 'fa-eq-wahl'), stufeHost = mk('div', 'fa-eq-stufe');
  reiter.setAttribute('role', 'tablist'); reiter.setAttribute('aria-label', 'EQ bands');
  platten.append(bandHost, wahlHost, stufeHost);
  wurzel.append(anzeigeHost, reiter, platten);
  host.append(wurzel);
  const jetzt = () => globalThis.performance?.now?.() ?? Date.now();

  // what the hand has set and the project has not echoed yet: {name: {v, t}} for knobs, `zug` for a running handle drag
  const lokal = new Map();
  let zug = null;   // {m, werte: {name: v}}
  let gewaehlt = Math.min(EQ_BAENDER, Math.max(1, quelle.band?.() ?? 1));
  const wert = (n) => {
    if (zug && n in zug.werte) return zug.werte[n];
    const l = lokal.get(n);
    if (l && jetzt() - l.t < LOKAL_MS) return l.v;
    return quelle.get(n);
  };
  const alleWerte = () => {
    const w = {};
    for (const n of ['out', 'propq']) w[n] = wert(n);
    for (let m = 1; m <= EQ_BAENDER; m++) for (const q of EQ_BAND_PARAMETER) w[eqBandName(m, q.name)] = wert(eqBandName(m, q.name));
    return w;
  };

  // ---- the display
  const ds = baueAnzeige(anzeigeHost, { breite: 720, hoehe: 320, rand: 30, x: EQ_ACHSEN.x, y: EQ_ACHSEN.y, gitterX: [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000],
    gitterY: [-24, -18, -12, -6, 0, 6, 12, 18, 24], titelX: 'FREQUENCY Hz', titelY: 'GAIN dB', label: 'Response of the EQ' });
  ds.linieH('fa-eq-null', 0);
  const seitePfad = ds.pfad('fa-eq-seite', []);
  const kurvePfad = ds.pfad('fa-eq-kurve', []);
  const hinweis = ds.text('fa-marke fa-eq-hinweis', 12, 27, 'TARGET RESPONSE (the filter follows it within 0.5 dB)', 'start');
  const griffe = [];
  for (let m = 1; m <= EQ_BAENDER; m++) {
    const ring = ds.punkt('fa-griff', 1000, 0, RADIUS), nr = ds.text('fa-griff-nr', 1000, 0, String(m), 'middle');
    ring.dataset.band = String(m);
    ring.setAttribute('role', 'slider'); ring.setAttribute('aria-label', `EQ band ${m}`);
    griffe.push({ ring, nr });
  }
  const setzeGriff = (m, werte) => {
    const g = griffe[m - 1], l = eqGriffLage(werte, m), an = eqBandWerte(werte, m).an;
    const cx = ds.px(l.freq), cy = ds.py(l.db);
    g.ring.setAttribute('cx', cx.toFixed(1)); g.ring.setAttribute('cy', cy.toFixed(1));
    g.nr.setAttribute('x', cx.toFixed(1)); g.nr.setAttribute('y', (cy + 3.2).toFixed(1));
    g.ring.classList.toggle('aus', !an); g.nr.classList.toggle('aus', !an);
    g.ring.classList.toggle('sel', m === gewaehlt); g.nr.classList.toggle('sel', m === gewaehlt);
    g.ring.setAttribute('aria-valuetext', `${Math.round(l.freq)} Hz${l.gainFrei ? `, ${l.db.toFixed(1)} dB` : ''}${an ? '' : ', off'}`);
  };
  const zeichne = () => {
    const w = alleWerte();
    ds.setzePfad(kurvePfad, eqKurve(w, 'mitte'));
    const seite = Array.from({ length: EQ_BAENDER }, (_, i) => eqBandWerte(w, i + 1)).some((b) => b.an && b.platz !== 0);
    seitePfad.setAttribute('class', `fa-eq-seite${seite ? '' : ' fa-eq-leer'}`);
    ds.setzePfad(seitePfad, seite ? eqKurve(w, 'seite') : []);
    for (let m = 1; m <= EQ_BAENDER; m++) setzeGriff(m, w);
  };
  // the selected handle lies on top. Only a change of the selection moves elements: moving the element under a pressed pointer would end its drag
  const nachOben = (m) => ds.svg.append(griffe[m - 1].ring, griffe[m - 1].nr);

  // ---- dragging a handle
  let plattenBand = null, bandPlatte = null, stufePlatte = null;
  let schreibNr = 0, letzte = null, verweigert = false;   // verweigert: the project refused a write of the running drag, the rest of it is ignored
  for (let m = 1; m <= EQ_BAENDER; m++) {
    const g = griffe[m - 1];
    let start = null;
    g.ring.addEventListener('pointerdown', () => waehle(m));   // before ziehbar's own listener: the selection (and its z-order change) is settled before the capture
    ziehbar(g.ring, {
      beiStart: (p) => {
        verweigert = false;
        const w = alleWerte(), l = eqGriffLage(w, m);
        start = { x: ds.px(l.freq), y: ds.py(l.db), an: eqBandWerte(w, m).an, bewegt: false, sperreF: quelle.gesperrt?.(eqBandName(m, 'freq')) === true, sperreG: quelle.gesperrt?.(eqBandName(m, 'gain')) === true, p };
      },
      beiBewegt: (p, dx, dy) => {
        if (!start || verweigert) return;
        if (!start.bewegt && Math.hypot(dx, dy) < KLICK_PX) return;   // a click selects, it does not write
        start.bewegt = true;
        const w = alleWerte();
        const neu = eqGriffZiehen(w, m, { freq: ds.wertX(start.x + dx), db: ds.wertY(start.y + dy) });
        // a parameter a rack macro drives does not move; the other axis does
        const fn = eqBandName(m, 'freq'), gn = eqBandName(m, 'gain');
        if (start.sperreF) delete neu[fn];
        if (start.sperreG) delete neu[gn];
        if (!Object.keys(neu).length) return;
        zug = { m, werte: neu };
        zeichne(); if (plattenBand === m) bandPlatte?.aktualisiere();
        const nr = ++schreibNr;
        // a band that was off is switched on by the same batch, in every batch of the drag (a queued batch is replaced by the next one, the switch must not get lost)
        const p2 = Promise.resolve(quelle.griff(m, { ...neu }, !start.an));
        letzte = p2;
        p2.then((ok) => { if (ok === false) { verweigert = true; zurueck(nr); } }, () => { verweigert = true; zurueck(nr); });
      },
      beiEnde: () => {
        const war = start?.bewegt; start = null;
        if (!war) return;
        const nr = schreibNr;
        // the hand lets go: the project's value is the truth again once the last write is answered (the echo may take a moment)
        Promise.resolve(letzte).catch(() => {}).finally(() => {
          if (zug && schreibNr === nr) {
            for (const [n, v] of Object.entries(zug.werte)) lokal.set(n, { v, t: jetzt() });
            zug = null;
            zeichne(); bandPlatte?.aktualisiere();
          }
        });
      },
    });
  }
  // a write was refused (or failed): everything the hand set but the project did not take goes back to the project's values
  const zurueck = () => { zug = null; lokal.clear(); zeichne(); bandPlatte?.aktualisiere(); stufePlatte?.aktualisiere(); };

  // ---- the band tabs and the plates
  const tabs = [];
  for (let m = 1; m <= EQ_BAENDER; m++) {
    const b = mk('button', 'fa-eq-tab');
    b.type = 'button'; b.textContent = String(m); b.setAttribute('role', 'tab'); b.setAttribute('aria-label', `EQ band ${m}`);
    b.addEventListener('click', () => waehle(m));
    reiter.append(b); tabs.push(b);
  }
  const adapter = {
    get: (n) => wert(n),
    set: (n, v) => {
      lokal.set(n, { v, t: jetzt() });
      const nr = ++schreibNr;
      Promise.resolve(quelle.set(n, v)).then((ok) => { if (ok === false) zurueck(nr); }, () => zurueck(nr));
      zeichne();
    },
    gesperrt: (n) => quelle.gesperrt?.(n) === true,
    ende: () => quelle.ende?.(),
  };
  const baueBandPlatte = () => {
    bandPlatte?.zerstoere?.();
    const m = gewaehlt, n = (x) => eqBandName(m, x);
    plattenBand = m;
    const gemeinsam = { titel: '', akzent: 'orange', dokument: d, parameter: parameterTabelle(m), adapter };
    const knoepfe = baueReglerPlatte(bandHost, { ...gemeinsam, abschnitte: [
      { id: 'r1', cols: 3, steuer: [{ param: n('freq'), typ: 'knob', label: 'Frequency' }, { param: n('gain'), typ: 'knob', label: 'Gain' }, { param: n('q'), typ: 'knob', label: 'Q' }] },
      { id: 'r2', cols: 1, steuer: [{ param: n('an'), typ: 'switch', label: `Band ${m} on` }] },
    ] });
    const wahl = baueReglerPlatte(wahlHost, { ...gemeinsam, abschnitte: [
      { id: 'w1', cols: 1, steuer: [{ param: n('typ'), typ: 'selector', label: 'Type', optionen: EQ_TYPEN }] },
      { id: 'w2', cols: 2, steuer: [{ param: n('steil'), typ: 'selector', label: 'Slope dB/oct', optionen: EQ_STEIL.map((t) => t.split(' ')[0]) }, { param: n('platz'), typ: 'selector', label: 'Placement', optionen: EQ_PLATZ }] },
    ] });
    bandPlatte = { aktualisiere() { knoepfe.aktualisiere(); wahl.aktualisiere(); }, zerstoere() { knoepfe.zerstoere?.(); wahl.zerstoere?.(); } };
  };
  const baueStufePlatte = () => {
    stufePlatte = baueReglerPlatte(stufeHost, {
      titel: '', akzent: 'orange', dokument: d, parameter: parameterTabelle(1), adapter,
      abschnitte: [{ id: 's1', cols: 1, steuer: [{ param: 'out', typ: 'knob', label: 'Output' }, { param: 'propq', typ: 'switch', label: 'Prop. Q' }] }],
    });
  };
  function waehle(m) {
    if (m === gewaehlt && bandPlatte) return;
    gewaehlt = m;
    quelle.waehleBand?.(m);
    baueBandPlatte();
    nachOben(m); zeigeReiter(); zeichne();
  }
  const zeigeReiter = () => {
    const w = alleWerte();
    tabs.forEach((b, i) => {
      b.classList.toggle('sel', i + 1 === gewaehlt); b.setAttribute('aria-selected', String(i + 1 === gewaehlt));
      b.classList.toggle('aus', !eqBandWerte(w, i + 1).an);
    });
  };
  let gedimmt = null;
  const dimme = () => {
    const aus = quelle.an ? quelle.an.get() === false : false;
    if (aus !== gedimmt) { gedimmt = aus; wurzel.classList.toggle('fa-aus', aus); }
  };
  baueBandPlatte(); baueStufePlatte(); nachOben(gewaehlt); zeigeReiter(); zeichne(); dimme();
  return {
    aktualisiere() { bandPlatte?.aktualisiere(); stufePlatte?.aktualisiere(); zeigeReiter(); zeichne(); dimme(); },
    live: undefined,
    zerstoere() { bandPlatte?.zerstoere?.(); stufePlatte?.zerstoere?.(); wurzel.remove?.(); },
  };
}
