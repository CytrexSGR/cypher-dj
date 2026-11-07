// 1.15 A7b: the spectrum view (D11). The kern sends /zustand/spektrum ,sis at 25 Hz while the selector spektrum/kanal is not 0: kanal (the source),
// rahmen (running number since the last source change) and pegel (29 integers in 0.1 dB, three bands per octave, centres 1000 Hz x 2^(i/3),
// i = -16 .. 12, i.e. 24.8 Hz .. 16 kHz). This file holds the pure parts (parsing, bar geometry, labels, the tag rule) and the canvas view.
// The pure parts are tested without a DOM (tests/spektrum.test.mjs); the view is executed against the DOM stand-in (tests/seite_spektrum.test.mjs).

export const SPEKTRUM_BAENDER = 29;
export const SPEKTRUM_ERSTES_I = -16;
export const SPEKTRUM_MIN_DB = -90;      // bottom of the plot
export const SPEKTRUM_MAX_DB = 6;        // top of the plot (a full-scale sine reads 0 dB)
export const SPEKTRUM_FRIST_MS = 500;    // a reading older than this counts as "no reading" (25 Hz expected)

// The selector values of spektrum/kanal: 0 off, 1..18 the mixer channels (index + 1), 19 the master sum (INTERFACES section 1.5, osc.json).
export const SPEKTRUM_QUELLEN = [
  'off', 'deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'erz/4', 'erz/5', 'erz/6', 'erz/7', 'erz/8',
  'pad/1', 'pad/2', 'bus/1', 'bus/2', 'bus/3', 'bus/4', 'master',
];
const SCHOENE_NAMEN = { 'deck/1': 'DECK 1', 'deck/2': 'DECK 2', 'deck/3': 'DECK 3', 'deck/4': 'DECK 4', 'pad/1': 'PAD 1', 'pad/2': 'PAD 2',
  'bus/1': 'BUS 1', 'bus/2': 'BUS 2', 'bus/3': 'BUS 3', 'bus/4': 'BUS 4', master: 'MASTER', off: 'OFF' };
export function quellenText(wert) {
  const n = SPEKTRUM_QUELLEN[wert];
  if (n === undefined) return '';
  return SCHOENE_NAMEN[n] ?? n.toUpperCase().replace('/', ' ');
}

export function bandMitteHz(i) { return 1000 * 2 ** ((i + SPEKTRUM_ERSTES_I) / 3); }
export function bandText(i) {
  const f = bandMitteHz(i);
  return f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`;
}
// The axis labels: one octave apart (every third band), 39 Hz .. 10 kHz, then the last band (16 kHz) at the right edge.
export const SPEKTRUM_MARKEN = [2, 5, 8, 11, 14, 17, 20, 23, 26, 28];
export const SPEKTRUM_LABELBAND = 14;    // px below the bars that belong to the axis labels (the bars never reach into it)
export const SPEKTRUM_LABELLUECKE = 4;   // px of clear space between two labels
// Where the axis labels go on a canvas of the given width. messe(text) -> width in px (ctx.measureText). A label starts at its band, is
// pushed left so that it ends inside the canvas, and is dropped if it would come closer than SPEKTRUM_LABELLUECKE to the one before it
// (left to right, so at narrow widths the right-most labels, 16 kHz first, are the ones that go).
export function markenLage(breite, messe) {
  const slot = breite / SPEKTRUM_BAENDER;
  const aus = [];
  let ende = -Infinity;
  for (const i of SPEKTRUM_MARKEN) {
    const text = bandText(i), w = messe(text);
    const x = Math.max(0, Math.min(i * slot, breite - w - 2));
    if (x < ende + SPEKTRUM_LABELLUECKE) continue;
    aus.push({ i, text, x, w });
    ende = x + w;
  }
  return aus;
}
// Below the plot bottom no bar is visible: a peak at or under this level is "no signal" (a silent source reads -200 dB).
export const SPEKTRUM_STILLE_DB = SPEKTRUM_MIN_DB;

// "-300,-310,..." -> 29 numbers in dB; null if the text is not exactly 29 integers.
export function pegelParsen(text) {
  if (typeof text !== 'string' || !/^-?\d+(,-?\d+){28}$/.test(text)) return null;
  return text.split(',').map((s) => Number(s) / 10);
}
export function spitzenBand(db) {
  let best = 0;
  for (let i = 1; i < db.length; i++) if (db[i] > db[best]) best = i;
  return best;
}
// Bar geometry for a canvas of breite x hoehe: one bar per band, height from -90 dB (0) to +6 dB (hoehe), a small gap between bars.
export function balken(db, breite, hoehe) {
  const n = db.length;
  const slot = breite / n;
  return db.map((d, i) => {
    const v = Math.min(SPEKTRUM_MAX_DB, Math.max(SPEKTRUM_MIN_DB, Number.isFinite(d) ? d : SPEKTRUM_MIN_DB));
    const h = ((v - SPEKTRUM_MIN_DB) / (SPEKTRUM_MAX_DB - SPEKTRUM_MIN_DB)) * hoehe;
    return { i, x: i * slot + 1, y: hoehe - h, b: Math.max(1, slot - 2), h };
  });
}
// The tag rule: a frame is shown only for the source the page selected (a late frame of the previous source is ignored).
export function rahmenGilt(f, wahl) {
  return wahl > 0 && !!f && f.kanal === SPEKTRUM_QUELLEN[wahl];
}

export class SpektrumAnsicht {
  // leinwand: the canvas, wahl: the select, info: a text element, sende: async (pfad, nach) => void (POST /regler)
  constructor({ leinwand, wahl, info, sende, jetzt = () => performance.now() }) {
    this.l = leinwand;
    this.w = wahl;
    this.info = info;
    this.sende = sende;
    this.jetzt = jetzt;
    this.quelle = 0;
    this.db = null;
    this.rahmen = 0;
    this.t = 0;
    this.gezeichnet = [];   // the bars of the last drawing (for tests and for the info line)
    if (wahl) {
      wahl.innerHTML = SPEKTRUM_QUELLEN.map((n, v) => `<option value="${v}">${quellenText(v)}</option>`).join('');
      wahl.value = '0';
      wahl.addEventListener('change', () => this.waehle(Number(wahl.value)));
    }
    this.zeichne();
  }
  // the user picks a source: send it to the kern, forget the old reading at once (the echo of /e/regler confirms)
  waehle(wert) {
    this.setzeQuelle(wert);
    return this.sende?.('spektrum/kanal', wert);
  }
  // the kern's value (echo of /e/regler, stream snapshot)
  setzeQuelle(wert) {
    const w = Number(wert);
    if (!(w >= 0 && w < SPEKTRUM_QUELLEN.length)) return;
    if (w !== this.quelle) { this.db = null; this.rahmen = 0; }
    this.quelle = w;
    if (this.w) this.w.value = String(w);
    this.zeichne();
  }
  aufnehmen(f) {
    if (!rahmenGilt(f, this.quelle)) return false;
    const db = pegelParsen(f.pegel);
    if (!db) return false;
    this.db = db;
    this.rahmen = Number(f.rahmen);
    this.t = this.jetzt();
    this.zeichne();
    return true;
  }
  frisch() { return this.db !== null && this.jetzt() - this.t <= SPEKTRUM_FRIST_MS; }
  // redraws; with no fresh reading the plot is empty and the info says why. Called by every frame and by a timer that notices the end of a stream.
  zeichne() {
    const sicht = this.quelle > 0 && this.frisch();
    this.gezeichnet = sicht ? balken(this.db, this.l?.width || 600, (this.l?.height || 160) - SPEKTRUM_LABELBAND) : [];
    if (this.info) {
      if (this.quelle === 0) this.info.textContent = 'Pick a source to see its spectrum';
      else if (!sicht) this.info.textContent = `${quellenText(this.quelle)}: no reading`;
      else {
        const p = spitzenBand(this.db);
        this.info.textContent = this.db[p] <= SPEKTRUM_STILLE_DB ? `${quellenText(this.quelle)}: no signal · frame ${this.rahmen}`
          : `${quellenText(this.quelle)}: peak ${bandText(p)} at ${this.db[p].toFixed(1)} dB · frame ${this.rahmen}`;
      }
    }
    const ctx = this.l?.getContext?.('2d');
    if (!ctx) return;
    const B = this.l.width, H = this.l.height, P = H - SPEKTRUM_LABELBAND;   // P: height of the plot above the label band
    ctx.clearRect(0, 0, B, H);
    ctx.fillStyle = '#16181e';
    ctx.fillRect(0, 0, B, H);
    ctx.strokeStyle = '#2a2d36';
    ctx.fillStyle = '#8a8d98';
    ctx.font = '10px system-ui, sans-serif';
    ctx.lineWidth = 1;
    for (const d of [0, -20, -40, -60, -80]) {   // level grid
      const y = Math.round(P - ((d - SPEKTRUM_MIN_DB) / (SPEKTRUM_MAX_DB - SPEKTRUM_MIN_DB)) * P) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(B, y); ctx.stroke();
      ctx.fillText(`${d}`, 2, y - 2);
    }
    if (sicht) {
      const spitze = spitzenBand(this.db);
      for (const s of this.gezeichnet) {
        ctx.fillStyle = s.i === spitze ? '#e0a33e' : '#2fd6c3';
        ctx.fillRect(s.x, s.y, s.b, s.h);
      }
    }
    // the axis labels live in their own band under the plot, so no bar can cover them
    ctx.fillStyle = '#8a8d98';
    for (const m of markenLage(B, (t) => ctx.measureText(t)?.width ?? 0)) ctx.fillText(m.text, m.x, H - 3);
  }
}
