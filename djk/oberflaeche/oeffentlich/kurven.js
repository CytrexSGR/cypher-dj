// Griffe der Oberfläche (Scheibe 60m): welche Ziele die Seite greifen darf, wie ein Regler in der Hand liegt
// (Griff-Kurve, Stellung 0..1 → Wert) und wie der Wert als midi_roh an /test/hand (§19.0) geht (Ziel-Kurve des Kerns).
// Läuft im Browser und in node (Tests, Server-Riegel).
//
// Ziel-Kurve: der Kern macht aus midi_roh (Stellung 0..1) mit der Standard-Kurve des Reglers den Wert
// (djk/kern/stellwerk/src/regler.cpp: aus_x/zu_x; K_FADER fader_db, K_EQ linear -26..+6 mit Kill, Rest linear).
// Die Seite schickt deshalb die Stellung des Griffs so, dass die ANGEZEIGTE Zahl die WIRKLICHE Kern-Zahl ist
// (Plan M-1 Blocker 4). 'attrappe_linear' ist die Wahl für die Attrappe (13), die ohne Mapping linear
// über den §1.5-Bereich rechnet (djk/vertrag/attrappe_kern/hand.mjs, Kopf). Für die Seite wählt der Server:
// server.ts --ziel-kurve (Vorgabe kern) meldet sie in /konfig, app.js ruft setzeZielKurve (live binding).
export let ZIEL_KURVE = 'kern';
export const ZIEL_KURVEN = ['kern', 'attrappe_linear'];
export function setzeZielKurve(k) {
  if (!ZIEL_KURVEN.includes(k)) throw new Error(`ziel_kurve ${k}: erlaubt sind ${ZIEL_KURVEN.join(', ')}`);
  ZIEL_KURVE = k;
}

export const DECKS = [1, 2];
export const ERZEUGER = ['erz/1', 'erz/2', 'erz/3'];  // Strudel-Kanäle: Drums, Bass, Melodie (Studio S1)
export const LOOPBOXEN = ['pad/1', 'pad/2'];  // Loop-Boxen L1, L2 (MVP 2, ADR 025)
const KANALZUG = ['fader', 'trim', 'eq/hoch', 'eq/mitte', 'eq/tief', 'kill/hoch', 'kill/mitte', 'kill/tief', 'filter', 'pfl'];
const DECK_TASTEN = ['play', 'cue'];
const DECK_ZUWEISUNG = ['xseite'];  // Crossfader-Seite A/THRU/B, §1.5 „nur Hand“ (2026-09-27)

// Jeder Pfad, den die Seite greifen darf; alles andere lehnt der Server ab (unbekanntes_ziel), ohne zu senden.
// 60m-Nachtrag: PFL je Deck, Master-Pegel, Kopfhörer (cue/mix, cue/pegel), alle §1.5 „nur Hand“.
export const ZIELE = new Set([
  ...DECKS.flatMap((n) => [...KANALZUG, ...DECK_TASTEN, ...DECK_ZUWEISUNG].map((p) => `deck/${n}/${p}`)),
  ...ERZEUGER.flatMap((k) => [...KANALZUG, ...DECK_ZUWEISUNG].map((p) => `${k}/${p}`)),  // ohne Tasten
  ...LOOPBOXEN.flatMap((k) => [...KANALZUG, ...DECK_ZUWEISUNG].map((p) => `${k}/${p}`)),  // ohne Tasten
  'xfader', 'master/pegel', 'master/kleber', 'cue/mix', 'cue/pegel',   // kleber (K2): Schwelle des Summen-Kompressors, nur Hand
]);

// §1.5-Bereich je Regler-Art (Einheit wie im Vertrag)
const BEREICH = {
  fader: [-200, 0], trim: [-24, 24], eq: [-200, 6], kill: [0, 1], filter: [-1, 1], xfader: [-1, 1],
  pfl: [0, 1], pegel: [-200, 0], mix: [-1, 1], xseite: [0, 2], kleber: [0, 1],
};

export function art(pfad) {
  if (pfad === 'xfader') return 'xfader';
  if (pfad === 'master/pegel' || pfad === 'cue/pegel') return 'pegel';
  if (pfad === 'cue/mix') return 'mix';
  if (pfad === 'master/kleber') return 'kleber';
  const m = /^(?:deck\/[12]|erz\/[1-3]|pad\/[12])\/(fader|trim|eq|kill|filter|pfl|xseite|play|cue)(\/|$)/.exec(pfad);
  if (!m) return null;
  return m[1] === 'play' || m[1] === 'cue' ? 'taste' : m[1];
}

// Standard-Kurven des Kerns je Reglerart, Zeile für Zeile aus regler.cpp (Float32 wie dort).
const f = Math.fround;
const STUMM = -200;                        // §1.2
const STUMM_GRENZE = -120;                 // §1.2: jeder Wert <= -120 gilt als stumm
const KERN = {
  fader: { typ: 'fader_db', min: -200, max: 0, kill: false },     // K_FADER (Fader, Master, Cue)
  eq: { typ: 'linear', min: -26, max: 6, kill: true },            // K_EQ: unter dem Minimum Kill
  trim: { typ: 'linear', min: -24, max: 24, kill: false },
  filter: { typ: 'linear', min: -1, max: 1, kill: false },
  xfader: { typ: 'linear', min: -1, max: 1, kill: false },
  mix: { typ: 'linear', min: -1, max: 1, kill: false },
  kleber: { typ: 'linear', min: 0, max: 1, kill: false },         // K2: master/kleber 0..1, u = Wert
};
KERN.pegel = KERN.fader;
const klemme = (x) => Math.min(1, Math.max(0, x));

// ReglerTabelle::zu_x: Wert → Stellung
export function kernZuX(k, w) {
  let x;
  if (k.typ === 'fader_db') x = w <= STUMM_GRENZE ? 0 : f(Math.pow(10, (w - k.max) / 20));
  else if (k.kill && w < k.min) x = 0;
  else x = f((w - k.min) / (k.max - k.min));
  return klemme(x);
}
// ReglerTabelle::aus_x: Stellung → Wert
export function kernAusX(k, x) {
  x = f(klemme(x));                          // der Kern sieht x als float32; die Schwellen (0,001, Kill bei 0) entscheiden dort
  if (k.typ === 'fader_db') return x < f(0.001) ? STUMM : f(k.max + 20 * Math.log10(x));   // §7.2: unter −60 dB stumm
  if (k.kill && x <= 0) return STUMM;
  return f(k.min + x * (k.max - k.min));
}

// Griff-Kurven: Stellung 0..1 in der Hand ↔ Wert, den der Kern daraus macht (Anzeige = Kern-Wert)
export const GRIFF = {};
for (const a of ['fader', 'pegel', 'eq', 'trim', 'filter', 'xfader', 'mix', 'kleber']) {
  GRIFF[a] = { wert: (x) => kernAusX(KERN[a], x), stellung: (w) => kernZuX(KERN[a], w) };
}
// EQ-Griff geteilt wie am Pioneer (Andreas 2026-09-28: „die eq an den kanälen sollten grundsätzlich alle immer erstmal
// mitte ausgerichtet sein.“): Mitte = 0 dB, linke Hälfte −26..0, rechte 0..+6, ganz links Kill. Der Kern rechnet weiter
// linear (K_EQ); griffZuMidi schickt ihm die Kern-Stellung des Werts, Anzeige = Kern-Zahl bleibt.
const EQ = KERN.eq;
GRIFF.eq = {
  wert: (x) => { x = f(klemme(x)); if (x <= 0) return STUMM; return x < 0.5 ? f(EQ.min * (1 - 2 * x)) : f(EQ.max * (2 * x - 1)); },
  stellung: (w) => (w < EQ.min ? 0 : w < 0 ? 0.5 * (1 - w / EQ.min) : klemme(0.5 + 0.5 * w / EQ.max)),
};
GRIFF.kill = schalter();
GRIFF.pfl = schalter();
GRIFF.xseite = { wert: (x) => Math.round(2 * x), stellung: (w) => w / 2 };  // FORMAT 22 g: xseite = round(2·midi_roh)

function schalter() {
  return { wert: (x) => (x >= 0.5 ? 1 : 0), stellung: (w) => (w >= 0.5 ? 1 : 0) };
}

export function midiRoh(pfad, wert, kurve = ZIEL_KURVE) {
  const a = art(pfad);
  if (kurve === 'kern' && KERN[a]) return kernZuX(KERN[a], wert);
  const [lo, hi] = BEREICH[a];
  return Math.max(0, Math.min(1, (wert - lo) / (hi - lo)));
}
export function wertAusMidi(pfad, u, kurve = ZIEL_KURVE) {
  const a = art(pfad);
  if (a === 'kill' || a === 'pfl') return u >= 0.5 ? 1 : 0;
  if (a === 'xseite') return Math.round(2 * u);
  if (kurve === 'kern' && KERN[a]) return kernAusX(KERN[a], u);
  const [lo, hi] = BEREICH[a];
  return lo + u * (hi - lo);
}

// Stellung in der Hand → midi_roh an den Kern
export function griffZuMidi(pfad, x) {
  const a = art(pfad);
  if (a === 'taste') return x >= 0.5 ? 1 : 0;
  if (ZIEL_KURVE === 'kern' && a === 'eq') return kernZuX(KERN.eq, GRIFF.eq.wert(x));   // geteilter Griff, linearer Kern
  if (ZIEL_KURVE === 'kern' && KERN[a]) return klemme(x);   // die Stellung der Hand IST midi_roh; der Kern rechnet den Wert
  return midiRoh(pfad, GRIFF[a].wert(x));
}

// Vorgaben aus §1.5 (Fader nach dem Laden −200; cue/mix −1, cue/pegel −12, master/pegel 0)
export const VORGABE = { fader: -200, trim: 0, eq: 0, kill: 0, filter: 0, xfader: 0, pfl: 0, mix: -1, pegel: 0, xseite: 1, kleber: 0 };
export function vorgabe(pfad) {
  if (pfad === 'cue/pegel') return -12;
  return VORGABE[art(pfad)];
}

export function formatiere(pfad, w) {
  const a = art(pfad);
  if (w === undefined || w === null || Number.isNaN(w)) return '–';
  if (a === 'kill') return w >= 0.5 ? 'KILL' : '';
  if (a === 'pfl') return w >= 0.5 ? 'PFL' : '';
  if (a === 'xseite') return ['A', 'THRU', 'B'][Math.round(w)] ?? '–';
  if (a === 'mix') {
    if (w <= -0.995) return 'CUE';
    if (w >= 0.995) return 'MASTER';
    if (Math.abs(w) < 0.005) return 'MIX';
    return w < 0 ? `CUE ${Math.round(((1 - w) / 2) * 100)}%` : `MST ${Math.round(((1 + w) / 2) * 100)}%`;
  }
  if (a === 'kleber') return w < 0.005 ? 'OFF' : `${Math.round(w * 100)}%`;
  if (a === 'filter') return Math.abs(w) < 0.005 ? 'OFF' : `${w < 0 ? 'LP' : 'HP'} ${Math.round(Math.abs(w) * 100)}`;
  if (a === 'xfader') return Math.abs(w) < 0.005 ? 'CENTER' : `${w < 0 ? 'A' : 'B'} ${Math.round(Math.abs(w) * 100)}`;
  if (w <= -199.5) return '−∞ dB';
  const s = w > 0.05 ? '+' : '';
  return `${s}${w.toFixed(1).replace('-', '−')} dB`;
}
