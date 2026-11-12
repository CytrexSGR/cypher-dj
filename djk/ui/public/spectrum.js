// 1.15 A7b: the spectrum view (D11). The kern sends /zustand/spektrum ,sis at 25 Hz while the selector spektrum/kanal is not 0: kanal (the source),
// rahmen (running number since the last source change) and pegel (29 integers in 0.1 dB, three bands per octave, centres 1000 Hz x 2^(i/3),
// i = -16 .. 12, i.e. 24.8 Hz .. 16 kHz). This file holds the pure parts (parsing, bar geometry, labels, the tag rule) and the canvas view.
// The pure parts are tested without a DOM (tests/spectrum.test.mjs); the view is executed against the DOM stand-in (tests/page_spectrum.test.mjs).

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

// ---- Device page (Decision 7 of the surfaces plan): the spectrum source is one global core row, so the page only borrows it. ----
export const SPEKTRUM_VORHER = 'djk-spektrum-vorher';   // sessionStorage: the value to put back (survives a reload of the page while it is open)
/** The selector value of a channel name ('erz/5' -> 9); 0 (off) for a name that is no source. */
export function spektrumIndex(kanal) { const i = SPEKTRUM_QUELLEN.indexOf(kanal); return i > 0 ? i : 0; }

/** Borrows the row spektrum/kanal while the device page is open. speicher: sessionStorage (may throw or be absent), kanaele: the instrument channel names,
 *  aktuell(): the row's value as the page knows it, sende(pfad, wert): writes the row, beacon(pfad, wert): the same for a page that is going away (sendBeacon),
 *  id: this page life (the stored key reads "id|old value", so a duplicated tab, which inherits sessionStorage, can tell it is not the holder),
 *  neuGeladen: this page life started by a reload (a duplicated tab does not). Every close path of the page goes through schliessen(). */
export class SpektrumLeihe {
  constructor({ speicher, kanaele, aktuell, sende, beacon, id = Math.random().toString(36).slice(2), neuGeladen = true }) {
    Object.assign(this, { sp: speicher, kanaele, aktuell, sende, beacon, id, neuGeladen });
    this.offen = false; this.speicherLos = null; this.index = 0;
  }
  lies() {
    let t = null;
    try { t = this.sp?.getItem(SPEKTRUM_VORHER); } catch { /* memory below */ }
    if (t === null || t === undefined) t = this.speicherLos;
    if (t === null || t === undefined) return null;
    const m = /^(?:([a-z0-9]+)\|)?(-?\d+)$/.exec(String(t));
    return m ? { id: m[1] ?? null, v: Number(m[2]) } : null;
  }
  merke(v) { this.speicherLos = `${this.id}|${v}`; try { this.sp?.setItem(SPEKTRUM_VORHER, this.speicherLos); } catch { /* memory only */ } }
  vergiss() { this.speicherLos = null; try { this.sp?.removeItem(SPEKTRUM_VORHER); } catch { /* memory only */ } }
  /** The device page is open for `kanal` (also a switch to another channel): select it; the first old value stays stored. */
  oeffnen(kanal) {
    const i = spektrumIndex(kanal);
    if (!i) return;
    if (!this.offen) { const alt = Number(this.aktuell?.() ?? 0); this.merke(Number.isFinite(alt) ? alt : 0); this.offen = true; }
    this.index = i;
    return this.sende('spektrum/kanal', i);
  }
  /** The page closes: put the first value back. Only when this page life opened it (a key of an earlier life is beimLaden's). */
  schliessen() {
    if (!this.offen) return;
    this.offen = false; this.index = 0;
    const k = this.lies();
    this.vergiss();
    if (k && k.id === this.id) return this.sende('spektrum/kanal', k.v);
  }
  /** pagehide (tab closed, reload, navigation): the page cannot await anything, so the restore goes out as a beacon. */
  seiteVerlassen() {
    if (!this.offen) return;
    this.offen = false; this.index = 0;
    const k = this.lies();
    this.vergiss();
    if (k && k.id === this.id) (this.beacon ?? this.sende)('spektrum/kanal', k.v);
  }
  /** Every state snapshot (page load, reconnect, core restart). Held lease: the row must still point at the open channel, else set it again.
   *  No lease: a key of an earlier page life of this tab (a reload whose beacon was lost) is restored when the row still shows an instrument channel,
   *  else only cleared; a key of a foreign id in a tab that was not reloaded (a duplicate) is left alone. */
  beiStand(wert) {
    const w = Number(wert);
    if (this.offen) { if (this.index && w !== this.index) return this.sende('spektrum/kanal', this.index); return; }
    const k = this.lies();
    if (!k || !this.neuGeladen) return;
    this.vergiss();
    if (this.kanaele.some((x) => spektrumIndex(x) === w)) return this.sende('spektrum/kanal', k.v);
  }
}

/** A view of the open channel's spectrum without a selector (used by a plate cell and by the strip under the plate). d: document.
 *  Returns { wurzel, ansicht }; the caller registers `ansicht` for frames and sets its source. */
export function spektrumFlaeche(d) {
  const wurzel = d.createElement('div');
  wurzel.setAttribute('class', 'fp-spektrum');
  const leinwand = d.createElement('canvas');
  leinwand.width = 1000; leinwand.height = 140;
  leinwand.setAttribute('aria-label', 'Level per third octave of this channel, 25 Hz to 16 kHz');
  const info = d.createElement('div');
  info.setAttribute('class', 'fp-spektrum-info');
  info.setAttribute('role', 'status');
  wurzel.append(leinwand, info);
  return { wurzel, ansicht: new SpektrumAnsicht({ leinwand, wahl: null, info, sende: null }) };
}
