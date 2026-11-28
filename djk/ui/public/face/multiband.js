// Device faces: the three-band compressor insert. A band strip (20 Hz to 20 kHz, logarithmic) draws each band's threshold as a stepped line; the two crossovers
// are handles that are dragged along the frequency axis (never closer than 1/3 octave). Under the strip one column per band: its gain-reduction bar and the knobs
// of the band (threshold, ratio, attack, release, knee, makeup) with the bypass switch.
//
// A band column is built from the GRUPPEN list below, one plate section per group whose parameters exist in the source's table. Strand 13 slice 4 added the
// upward group `u` (`u<m>/schwelle`, `ratio`, `bereich`: ratio 1 = off) and the per-band readings `mb<n>/b<m>` of the /e/ins_gr store, SIGNED: positive = gain
// reduction (the bar grows downward from the top), negative = lift (a second, small bar grows upward). The key of the stage is the KEY button of the face head.
import { MB_KOPF_PARAMETER, MB_BAND_PARAMETER, MB_UP_PARAMETER, MB_BAENDER, MB_BAND_NAMEN } from '../production/inserts.js';
import { baueAnzeige, baueMeter, ziehbar } from './display.js';
import { baueReglerPlatte } from './frame.js';

export const MB_ACHSEN = { x: { min: 20, max: 20000, log: true }, y: { min: -60, max: 0 } };
export const MB_MIN_ABSTAND = 2 ** (1 / 3);   // the crossovers keep at least a third of an octave between them (ratio of the two frequencies)
export const MB_GR_MAX = 24;                   // scale of the gain-reduction bars in dB
const klemme = (x, a, b) => Math.min(b, Math.max(a, x));
const kopfQ = (name) => MB_KOPF_PARAMETER.find((q) => q.name === name);

/** The parameter groups of one band column, in order: {praefix, spalten, knoepfe: [names], schalter?: name}. A function: inserts.js and this file import each other,
 *  the lists are not initialised at load time. */
export const mbGruppen = () => [
  { praefix: 'b', spalten: 2, knoepfe: ['schwelle', 'ratio', 'attack', 'release', 'knie', 'makeup'], schalter: 'umgehen', liste: MB_BAND_PARAMETER },
  { praefix: 'u', spalten: 3, knoepfe: ['schwelle', 'ratio', 'bereich'], titel: 'UPWARD', kurz: { schwelle: 'Threshold', ratio: 'Ratio', bereich: 'Range' }, liste: MB_UP_PARAMETER },
];

/** The flat parameter list of the stage as the project knows it: the two crossovers, then every group of every band under its full name (`b2/ratio`). Labels carry
 *  the band ("Low band Threshold") as the INSERTS rows and the undo steps say it. */
export function mbParameterListe() {
  const baender = [];
  for (const g of mbGruppen()) for (let m = 1; m <= MB_BAENDER; m++) for (const q of g.liste) baender.push({ ...q, name: `${g.praefix}${m}/${q.name}`, label: `${MB_BAND_NAMEN[m - 1]} band ${q.label}` });   // contract order: every b row, then every u row
  return [...MB_KOPF_PARAMETER, ...baender];
}

/** {name: {name, label, min, max, log, einheit, vorgabe}} for the knob plates: the crossovers, attack and release are logarithmic. */
export const mbParameterTabelle = (liste = mbParameterListe()) => Object.fromEntries(liste.map((q) => [q.name, {
  name: q.name, label: q.label, min: q.min, max: q.max, log: q.skala === 'log' || /\/(attack|release)$/.test(q.name), einheit: q.einheit, vorgabe: q.vorgabe,
}]));

/** The stage values the strip needs: a missing, NaN or out-of-range entry becomes the default or is clamped; the crossovers keep their order and distance
 *  (the low one yields to the high one). */
export function mbEinstellung(werte = {}) {
  const aus = {};
  const lies = (name, q) => { const v = werte?.[name]; return typeof v === 'number' && Number.isFinite(v) ? klemme(v, q.min, q.max) : q.vorgabe; };
  for (const q of MB_KOPF_PARAMETER) aus[q.name] = lies(q.name, q);
  for (let m = 1; m <= MB_BAENDER; m++) for (const q of MB_BAND_PARAMETER) aus[`b${m}/${q.name}`] = lies(`b${m}/${q.name}`, q);
  for (let m = 1; m <= MB_BAENDER; m++) for (const q of MB_UP_PARAMETER) aus[`u${m}/${q.name}`] = lies(`u${m}/${q.name}`, q);
  if (aus.grenze_hoch < aus.grenze_tief * MB_MIN_ABSTAND) aus.grenze_tief = Math.max(kopfQ('grenze_tief').min, aus.grenze_hoch / MB_MIN_ABSTAND);
  return aus;
}

/** Where a dragged crossover may go: `name` is 'grenze_tief' or 'grenze_hoch', `hz` the wanted frequency, `andere` the other crossover. Clamped to its range and to
 *  1/3 octave from the other one. */
export function mbGrenzeKlemmen(name, hz, andere) {
  const q = kopfQ(name);
  const lo = name === 'grenze_hoch' ? Math.max(q.min, andere * MB_MIN_ABSTAND) : q.min;
  const hi = name === 'grenze_tief' ? Math.min(q.max, andere / MB_MIN_ABSTAND) : q.max;
  const v = klemme(Number.isFinite(hz) ? hz : q.vorgabe, lo, hi);
  return v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
}

/** The threshold line as the points where it steps: [[hz, dB]] from the left edge to the right edge (low band, mid band, high band). */
export function mbKurve(e) {
  const { grenze_tief: a, grenze_hoch: b } = mbEinstellung(e);
  const t = [1, 2, 3].map((m) => mbEinstellung(e)[`b${m}/schwelle`]);
  return [[MB_ACHSEN.x.min, t[0]], [a, t[0]], [a, t[1]], [b, t[1]], [b, t[2]], [MB_ACHSEN.x.max, t[2]]];
}

const LOKAL_MS = 800;   // a value the hand just set is shown for this long, before the project echoes it
const hzText = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${Math.round(hz)} Hz`);

/** The multiband face into `host`. quelle = {parameter, get(name), set(name, v), ende?(), gesperrt?(name), an: {get(), set(b)}, gr?(jetzt), grBand?(m, jetzt)}.
 *  gr(jetzt) is the stage's gain reduction in dB (the deepest band) or null; grBand(m, jetzt) the reading of band m (1..3) or null. As long as no band has a reading the
 *  three bars show the stage value, dimmed, with the tooltip "deepest band". A stage at `an` 0 dims the face and shows no readings. Returns {aktualisiere(), live(), zerstoere()}.
 *  live(jetzt) is one frame: true when a reading changed. */
export function baueMultibandFace(host, quelle) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse) => { const e = d.createElement(tag); e.setAttribute('class', klasse); return e; };
  const wurzel = mk('div', 'fa-mb'), streifen = mk('div', 'fa-mb-streifen'), spalten = mk('div', 'fa-mb-baender');
  wurzel.append(streifen, spalten);
  host.append(wurzel);
  const jetzt = () => globalThis.performance?.now?.() ?? Date.now();
  const lokal = new Map();
  const wert = (n) => {
    const l = lokal.get(n);
    if (l && jetzt() - l.t < LOKAL_MS) return l.v;
    return quelle.get(n);
  };
  const aktuell = () => mbEinstellung(Object.fromEntries(Object.keys(quelle.parameter).map((n) => [n, wert(n)])));
  const platten = [];
  const schreibe = (n, v) => {
    const eintrag = { v, t: jetzt() };
    lokal.set(n, eintrag);
    // a refused write (the source resolves false): the control goes back to the last confirmed value
    Promise.resolve(quelle.set(n, v)).then((ok) => { if (ok === false && lokal.get(n) === eintrag) { lokal.delete(n); for (const p of platten) p.aktualisiere(); zeichne(); } }, () => {});
    zeichne();
  };
  // a crossover write (handle or knob) is clamped to 1/3 octave from the other one and goes out only when the value changed
  const schreibeGrenze = (name, hz) => {
    const andere = aktuell()[name === 'grenze_tief' ? 'grenze_hoch' : 'grenze_tief'];
    const v = mbGrenzeKlemmen(name, hz, andere);
    if (v === aktuell()[name]) return v;
    schreibe(name, v);
    return v;
  };

  // ---- the strip: the thresholds as a stepped line, the two crossovers as draggable handles
  const ds = baueAnzeige(streifen, { breite: 340, hoehe: 170, rand: 30, x: MB_ACHSEN.x, y: MB_ACHSEN.y, gitterX: [100, 1000, 10000], gitterY: [-60, -40, -20, 0],
    titelX: 'FREQUENCY', titelY: 'THRESHOLD dB', label: 'Thresholds of the three bands and their crossovers', formatX: hzText });
  const linie = ds.pfad('fa-kurve fa-mb-schwellen', []);
  const griffe = ['grenze_tief', 'grenze_hoch'].map((name) => {
    const strich = ds.linieV('fa-mb-grenze', 100), punkt = ds.punkt('fa-mb-griff', 100, -30, 6), text = ds.text('fa-marke', 100, -57, '', 'middle');
    punkt.setAttribute('role', 'slider'); punkt.setAttribute('aria-label', `${kopfQ(name).label} of the multiband`);
    ziehbar(punkt, { beiBewegt: (p) => { schreibeGrenze(name, ds.wertX(p.x)); }, beiEnde: () => quelle.ende?.() });
    return { name, strich, punkt, text };
  });
  const zeichne = () => {
    const e = aktuell();
    ds.setzePfad(linie, mbKurve(e));
    for (const g of griffe) {
      const x = ds.px(e[g.name]).toFixed(1);
      g.strich.setAttribute('x1', x); g.strich.setAttribute('x2', x);
      g.punkt.setAttribute('cx', x); g.punkt.setAttribute('aria-valuenow', String(e[g.name]));
      g.text.setAttribute('x', x); g.text.textContent = hzText(e[g.name]);
    }
  };

  // ---- the crossovers as two knobs under the strip (reachable without a pointer), then one column per band: its GR bar and its plate (one section per parameter group)
  const gesperrt = (n) => quelle.gesperrt?.(n) === true;
  const adapter = (set) => ({
    get: (n) => wert(n),
    set,
    gesperrt,
    ...(quelle.modKnopf ? { modKnopf: (n) => quelle.modKnopf(n) } : {}),
    ende: () => quelle.ende?.(),
  });
  const grenzHost = mk('div', 'fa-mb-grenzen');
  streifen.after(grenzHost);
  const grenzSteuer = ['grenze_tief', 'grenze_hoch'].filter((n) => quelle.parameter[n]).map((n) => ({ param: n, typ: 'knob', label: quelle.parameter[n].label }));
  if (grenzSteuer.length) {
    const p = baueReglerPlatte(grenzHost, {
      titel: '', abschnitte: [{ id: 'x', cols: grenzSteuer.length, steuer: grenzSteuer }], parameter: quelle.parameter, akzent: 'orange', dokument: d,
      adapter: adapter((n, v) => { const ok = schreibeGrenze(n, v); if (ok !== v) p.aktualisiere(); }),
    });
    platten.push(p);
  }
  const baender = [];
  for (let m = 1; m <= MB_BAENDER; m++) {
    const spalte = mk('div', 'fa-mb-band'), kopf = mk('span', 'fa-komp-meter-titel'), meterHost = mk('div', 'fa-mb-gr'), platteHost = mk('div', 'fa-mb-platte');
    kopf.textContent = MB_BAND_NAMEN[m - 1].toUpperCase();
    spalte.setAttribute('data-band', String(m));
    const meter = baueMeter(meterHost, { min: 0, max: MB_GR_MAX, label: `Gain reduction of the ${MB_BAND_NAMEN[m - 1]} band`, einheit: 'dB' });
    const hatUp = !!quelle.parameter[`u${m}/ratio`];
    const lift = hatUp ? baueMeter(meterHost, { min: 0, max: MB_GR_MAX, label: `Upward lift of the ${MB_BAND_NAMEN[m - 1]} band`, einheit: 'dB', von: 'unten' }) : null;
    if (lift) meterHost.classList.add('fa-mb-gr-zwei');
    const abschnitte = mbGruppen().map((g) => {
      const voll = (n) => `${g.praefix}${m}/${n}`;
      const steuer = [
        ...g.knoepfe.filter((n) => quelle.parameter[voll(n)]).map((n) => ({ param: voll(n), typ: 'knob', label: g.kurz?.[n] ?? g.liste.find((q) => q.name === n)?.label ?? quelle.parameter[voll(n)].label })),
        ...(g.schalter && quelle.parameter[voll(g.schalter)] ? [{ param: voll(g.schalter), typ: 'switch', label: 'Bypass' }] : []),
      ];
      return { id: `${g.praefix}${m}`, ...(g.titel ? { titel: g.titel } : {}), cols: g.spalten, steuer };
    }).filter((a) => a.steuer.length);
    spalte.append(kopf, meterHost, platteHost);
    spalten.append(spalte);
    if (abschnitte.length) platten.push(baueReglerPlatte(platteHost, { titel: '', abschnitte, parameter: quelle.parameter, akzent: 'orange', dokument: d, adapter: adapter((n, v) => schreibe(n, v)) }));
    baender.push({ m, spalte, meter, lift, meterHost });
  }

  // ---- state: a stage at `an` 0 dims the face, a bypassed band dims its column, the bars show per-band readings or the stage value
  let gedimmt = null, zuletzt = '';
  const dimme = () => {
    const aus = quelle.an ? quelle.an.get() === false : false;
    if (aus !== gedimmt) { gedimmt = aus; wurzel.classList.toggle('fa-aus', aus); }
    for (const b of baender) b.spalte.classList.toggle('fa-aus-band', Number(wert(`b${b.m}/umgehen`)) >= 0.5);
  };
  const zeigeGr = (zeit) => {
    dimme();
    const band = baender.map((b) => (gedimmt ? null : (quelle.grBand?.(b.m, zeit) ?? null)));
    const stufe = band.every((x) => x === null);
    const gesamt = gedimmt ? null : (quelle.gr?.(zeit) ?? null);
    baender.forEach((b, i) => {
      const w = stufe ? gesamt : band[i];   // signed: positive = reduction, negative = lift
      b.meter.setze(w === null ? null : Math.max(0, w), zeit);
      b.lift?.setze(stufe || w === null || w >= 0 ? null : -w, zeit);   // a dash while the band does not lift
      b.meterHost.classList.toggle('fa-mb-gr-stufe', stufe && gesamt !== null);
      if (stufe) b.meterHost.setAttribute('title', 'deepest band'); else b.meterHost.removeAttribute('title');
    });
    const t = `${stufe ? 's' : 'b'}|${stufe ? gesamt : band.join(',')}`;
    const anders = t !== zuletzt;
    zuletzt = t;
    return anders;
  };
  zeichne(); zeigeGr(jetzt());
  return {
    aktualisiere() { for (const p of platten) p.aktualisiere(); zeichne(); zeigeGr(jetzt()); },
    live(zeit = jetzt()) { return zeigeGr(zeit); },
    zerstoere() { for (const p of platten) p.zerstoere(); wurzel.remove?.(); },
  };
}
