// Device faces: the three-band imager insert. A band strip (frequency 40 Hz to 12 kHz, logarithmic) shows the width of each band as the height of its block; the two
// crossovers are handles that are dragged along the frequency axis. Under the strip three width faders (Low 0..100 %, Mid and High 0..200 %) and the knobs of the
// crossovers and of "Mono below". The imager reports no meter.
import { BILD_PARAMETER } from '../production/inserts.js';
import { baueAnzeige, ziehbar } from './display.js';
import { baueReglerPlatte } from './frame.js';

export const BILD_ACHSEN = { x: { min: 40, max: 12000, log: true }, y: { min: 0, max: 2 } };
const klemme = (x, a, b) => Math.min(b, Math.max(a, x));
const bildQ = (name) => BILD_PARAMETER.find((q) => q.name === name);

/** The imager values the strip needs: a missing, NaN or out-of-range entry becomes the default of BILD_PARAMETER or is clamped into its range; the crossovers keep their order. */
export function bildEinstellung(werte = {}) {
  const aus = {};
  for (const q of BILD_PARAMETER) {
    const v = werte?.[q.name];
    aus[q.name] = typeof v === 'number' && Number.isFinite(v) ? klemme(v, q.min, q.max) : q.vorgabe;
  }
  return aus;
}

/** The strip as the points where it steps: [[hz, width]] from the left edge to the right edge (low block, mid block, high block). */
export function bildKurve(e) {
  const { grenze_tief: a, grenze_hoch: b, breite_tief: t, breite_mitte: m, breite_hoch: h } = bildEinstellung(e);
  return [[BILD_ACHSEN.x.min, t], [a, t], [a, m], [b, m], [b, h], [BILD_ACHSEN.x.max, h]];
}

/** The fader table: [{name, label, max}] (the slider runs 0..100 % or 0..200 %, as its row 0..1 or 0..2). A function: inserts.js and this file import each other, the list is not initialised at load time. */
export const bildFader = () => ['breite_tief', 'breite_mitte', 'breite_hoch'].map((n) => ({ name: n, label: bildQ(n).label, max: bildQ(n).max }));

/** {name: {name, label, min, max, log, einheit, vorgabe}} for the knob plate: the crossovers are logarithmic. */
export const bildParameterTabelle = (liste = BILD_PARAMETER) => Object.fromEntries(liste.map((q) => [q.name, { name: q.name, label: q.label, min: q.min, max: q.max, log: q.skala === 'log', einheit: q.einheit, vorgabe: q.vorgabe }]));

const LOKAL_MS = 800;   // a value the hand just set is shown for this long, before the project echoes it
const hzText = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${Math.round(hz)} Hz`);

/** The imager face into `host`. quelle = {parameter, get(name), set(name, v), ende?(), gesperrt?(name), an: {get(), set(b)}}. Returns {aktualisiere(), live(), zerstoere()}. */
export function baueImagerFace(host, quelle) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse) => { const e = d.createElement(tag); e.setAttribute('class', klasse); return e; };
  const wurzel = mk('div', 'fa-bild'), streifen = mk('div', 'fa-bild-streifen'), fader = mk('div', 'fa-bild-fader'), platteHost = mk('div', 'fa-bild-platte');
  wurzel.append(streifen, fader, platteHost);
  host.append(wurzel);
  const jetzt = () => globalThis.performance?.now?.() ?? Date.now();
  const lokal = new Map();
  const wert = (n) => {
    const l = lokal.get(n);
    if (l && jetzt() - l.t < LOKAL_MS) return l.v;
    return quelle.get(n);
  };
  const aktuell = () => bildEinstellung(Object.fromEntries(BILD_PARAMETER.map((q) => [q.name, wert(q.name)])));
  let platte = null;
  const schreibe = (n, v) => {
    const eintrag = { v, t: jetzt() };
    lokal.set(n, eintrag);
    // a refused write (the source resolves false): the control goes back to the last confirmed value
    Promise.resolve(quelle.set(n, v)).then((ok) => { if (ok === false && lokal.get(n) === eintrag) { lokal.delete(n); platte?.aktualisiere(); zeichne(); } }, () => {});
    zeichne();
  };

  // ---- the strip: widths as block heights, the two crossovers as draggable handles
  const ds = baueAnzeige(streifen, { breite: 340, hoehe: 200, rand: 26, x: BILD_ACHSEN.x, y: BILD_ACHSEN.y, gitterX: [100, 1000, 10000], gitterY: [0, 1, 2],
    titelX: 'FREQUENCY', titelY: 'WIDTH', label: 'Stereo width of the three bands', formatX: hzText, formatY: (w) => `${Math.round(w * 100)} %` });
  const flaeche = ds.pfad('fa-kurve fa-bild-baender', [], { flaeche: true });
  const griffe = [['grenze_tief', 1], ['grenze_hoch', 1]].map(([name, y]) => {
    const linie = ds.linieV('fa-bild-grenze', 100), punkt = ds.punkt('fa-bild-griff', 100, y, 6), text = ds.text('fa-marke', 100, 2, '', 'middle');
    punkt.setAttribute('role', 'slider'); punkt.setAttribute('aria-label', `${bildQ(name).label} of the imager`);
    ziehbar(punkt, { beiBewegt: (p) => {
      const q = bildQ(name);
      schreibe(name, Math.round(klemme(ds.wertX(p.x), q.min, q.max)));
    }, beiEnde: () => quelle.ende?.() });
    return { name, linie, punkt, text };
  });
  const zeichne = () => {
    const e = aktuell();
    ds.setzePfad(flaeche, bildKurve(e), { flaeche: true });
    for (const g of griffe) {
      const x = ds.px(e[g.name]).toFixed(1);
      g.linie.setAttribute('x1', x); g.linie.setAttribute('x2', x);
      g.punkt.setAttribute('cx', x); g.punkt.setAttribute('aria-valuenow', String(e[g.name]));
      g.text.setAttribute('x', x); g.text.textContent = hzText(e[g.name]);
    }
  };

  // ---- the three width faders (percent; the row is 0..1 or 0..2)
  const regler = bildFader().map((f) => {
    const zeile = mk('label', 'fa-bild-zeile'), name = mk('span', 'fa-komp-meter-titel'), el = mk('input', 'fa-bild-schieber'), aus = mk('output', 'fa-bild-wert');
    name.textContent = f.label.replace(' width', '').toUpperCase();
    el.setAttribute('type', 'range'); el.setAttribute('min', '0'); el.setAttribute('max', String(f.max * 100)); el.setAttribute('step', '1');
    el.setAttribute('aria-label', `${f.label} of the imager`);
    el.addEventListener('input', () => { if (quelle.gesperrt?.(f.name) === true) { zeige(); return; } schreibe(f.name, Number(el.value) / 100); zeige(); });
    el.addEventListener('change', () => quelle.ende?.());
    zeile.append(name, el, aus);
    fader.append(zeile);
    return { f, el, aus };
  });
  const zeige = () => {
    const e = aktuell();
    for (const r of regler) { const pct = Math.round(e[r.f.name] * 100); r.el.value = String(pct); r.aus.textContent = `${pct} %`; }
  };

  // ---- the plate: the crossovers and "Mono below" as knobs (the same rows as the handles, reachable without a pointer)
  const steuer = ['grenze_tief', 'grenze_hoch', 'mono_unter'].filter((n) => quelle.parameter[n]).map((n) => ({ param: n, typ: 'knob', label: quelle.parameter[n].label }));
  platte = baueReglerPlatte(platteHost, {
    titel: '', abschnitte: [{ id: 'r1', cols: Math.max(1, steuer.length), steuer }], parameter: quelle.parameter, akzent: 'tuerkis', dokument: d,
    adapter: { get: (n) => wert(n), set: (n, v) => { schreibe(n, v); zeige(); }, gesperrt: (n) => quelle.gesperrt?.(n) === true, ende: () => quelle.ende?.() },
  });
  let gedimmt = null;
  const dimme = () => {
    const aus = quelle.an ? quelle.an.get() === false : false;
    if (aus !== gedimmt) { gedimmt = aus; wurzel.classList.toggle('fa-aus', aus); }
  };
  zeichne(); zeige(); dimme();
  return {
    aktualisiere() { platte.aktualisiere(); zeichne(); zeige(); dimme(); },
    live() { dimme(); return false; },
    zerstoere() { platte.zerstoere(); wurzel.remove?.(); },
  };
}
