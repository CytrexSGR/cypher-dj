// ANALYZE window: pure helpers of the window: the log frequency axis, the dB axis, the column under the playhead, the decoded time picture,
// the source list of the selectors and number text. No DOM here (tested in tests/werkbank_analysis_zeichnen.test.mjs); analysis.js draws with them.
// UI texts English.
import { tonName } from '../production/pianoroll.js';
import { mixZuege } from './mix.js';
import { returnListe } from '../production/routing.js';

export const ANALYSE_TEXT = { knopf: 'ANALYZE', knopfTitel: 'Measure the spectrum, stereo image and loudness of a track',
  titel: 'ANALYZE', vergleich: 'COMPARE WITH', keiner: 'none', neu: 'REFRESH', misst: 'measuring…', master: 'MASTER', leer: 'n/a', live: 'LIVE OUTPUT', referenzen: 'REFERENCES', datei: 'FILE' };

export const HZ_MIN = 20, HZ_MAX = 20000;
const LOG_SPANNE = Math.log(HZ_MAX / HZ_MIN);

// log axis: 20 Hz -> 0, 20 kHz -> breite
export const hzZuX = (hz, breite) => (Math.log(hz / HZ_MIN) / LOG_SPANNE) * breite;
export const xZuHz = (x, breite) => HZ_MIN * Math.exp((x / breite) * LOG_SPANNE);
// dbMax -> 0 (top), dbMin -> hoehe (bottom), clamped
export function dbZuY(db, hoehe, dbMin = -90, dbMax = 0) {
  const t = (dbMax - db) / (dbMax - dbMin);
  return Math.min(1, Math.max(0, t)) * hoehe;
}

export const HZ_LINIEN = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
export const linienText = (hz) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

export const notenName = (hz) => tonName(Math.round(69 + 12 * Math.log2(hz / 440)));

// index of the nearest band by log distance
export function bandBei(hz, hzListe) {
  let best = 0, abstand = Infinity;
  const l = Math.log(Math.max(hz, 1e-9));
  for (let i = 0; i < hzListe.length; i++) {
    const d = Math.abs(Math.log(hzListe[i]) - l);
    if (d < abstand) { abstand = d; best = i; }
  }
  return best;
}

// The time-picture column under the playhead; null outside [von_beat, bis_beat), without a beat or without an answer.
export function spalteBei(beat, antwort) {
  const z = antwort?.quelle?.zeitbild;
  if (!z || !Number.isFinite(beat) || !(antwort.tempo_bpm > 0) || !(z.sek_je_spalte > 0)) return null;
  if (beat < antwort.von_beat || beat >= antwort.bis_beat) return null;
  const s = Math.floor(((beat - antwort.von_beat) * 60 / antwort.tempo_bpm) / z.sek_je_spalte);
  return Math.min(z.spalten - 1, Math.max(0, s));
}

export function zeitbildBytes(b64) {
  const roh = atob(b64 ?? '');
  const aus = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) aus[i] = roh.charCodeAt(i);
  return aus;
}

// Vectorscope points of the live answer: base64 of an Int8Array of (x, y) pairs; '' or invalid -> empty.
export function vektorPunkte(b64) {
  try { return new Int8Array(zeitbildBytes(b64).buffer); } catch { return new Int8Array(0); }
}

// Clears and draws the vectorscope: a faint cross, the 45 degree lines for L and R, then one small dot per point (mid up, side right).
export function zeichneVektor(g, punkte, breite, hoehe, farbe = '#5cd0ff') {
  g.fillStyle = '#0b0d11'; g.fillRect(0, 0, breite, hoehe);
  g.strokeStyle = 'rgba(255,255,255,.09)'; g.lineWidth = 1;
  g.beginPath();
  g.moveTo(breite / 2, 0); g.lineTo(breite / 2, hoehe); g.moveTo(0, hoehe / 2); g.lineTo(breite, hoehe / 2);
  g.moveTo(0, 0); g.lineTo(breite, hoehe); g.moveTo(breite, 0); g.lineTo(0, hoehe);
  g.stroke();
  g.fillStyle = farbe;
  for (let i = 0; i + 1 < punkte.length; i += 2) {
    g.fillRect(breite / 2 + (punkte[i] / 127) * (breite / 2) - 0.75, hoehe / 2 - (punkte[i + 1] / 127) * (hoehe / 2) - 0.75, 1.5, 1.5);
  }
}

// The dB values of one column (spalten x zeilen bytes, column after column); `messung` is the measurement the bytes belong to.
const entpackt = new WeakMap();   // zeitbild object -> bytes: decoded once per answer
export function spalteDb(antwort, messung, spalte) {
  const z = messung.zeitbild;
  let bytes = entpackt.get(z);
  if (!bytes) { bytes = zeitbildBytes(z.daten); entpackt.set(z, bytes); }
  const aus = new Array(z.zeilen);
  for (let i = 0; i < z.zeilen; i++) aus[i] = z.db_min + (bytes[spalte * z.zeilen + i] / 255) * (z.db_max - z.db_min);
  return aus;
}

// The strips a measurement can start from: the tracks (by letter), the returns, then MASTER.
export function quellenListe(projekt) {
  const spuren = mixZuege(projekt).map((z) => ({ wert: `spur:${z.id}`, quelle: { art: 'spur', id: z.id }, text: `${z.buchstabe} ${z.name}`, farbe: z.farbe }));
  const returns = returnListe(projekt).map((r) => ({ wert: `return:${r.id}`, quelle: { art: 'return', id: r.id }, text: `FX ${r.nr} ${r.name}`, farbe: r.farbe ?? '' }));
  return [...spuren, ...returns, { wert: 'master', quelle: { art: 'master' }, text: ANALYSE_TEXT.master, farbe: '' }];
}

export const zahlText = (x, stellen = 1) => (Number.isFinite(x) ? x.toFixed(stellen) : ANALYSE_TEXT.leer);

const schl = (q) => (q ? (q.id === undefined ? q.art : `${q.art}:${q.id}`) : '');
export const abfrageSchluessel = (q, v) => `${schl(q)}|${schl(v)}`;

// Bar lines of the time picture: the project beats in [von, bis) that are bar boundaries (a multiple of beatsProBar), also when the range does not start on one.
export function taktLinien(von, bis, beatsProTakt) {
  const aus = [];
  if (!(beatsProTakt > 0) || !(bis > von)) return aus;
  for (let b = Math.ceil(von / beatsProTakt) * beatsProTakt; b < bis; b += beatsProTakt) aus.push(b);
  return aus;
}

// Width of a stereo value: a floor value (a silent side signal) reads "mono".
export const MONO_DB = -120;
export const breiteText = (db) => (!Number.isFinite(db) ? ANALYSE_TEXT.leer : db <= MONO_DB ? 'mono' : `${db.toFixed(1)} dB`);

// Time picture colour of a byte 0..255: dark blue, cyan, yellow, white. Returns [r, g, b].
export function bildFarbe(v) {
  const t = v / 255;
  const klemme = (x) => Math.round(255 * Math.min(1, Math.max(0, x)));
  const b = 60 + 195 * Math.min(1, t * 2.4) * (1 - Math.max(0, (t - 0.6) * 2));
  return [klemme((t - 0.45) * 2.2), klemme((t - 0.1) * 1.6), Math.max(0, Math.min(255, Math.round(b)))];
}
const FARBTAFEL = Array.from({ length: 256 }, (_, v) => bildFarbe(v));

// The bytes of the time picture (spalten x zeilen, column after column, low band first) as RGBA pixels of an image spalten wide and zeilen high,
// the highest band in the top row.
export function zeitbildRgba(bytes, spalten, zeilen) {
  const aus = new Uint8ClampedArray(spalten * zeilen * 4);
  for (let x = 0; x < spalten; x++) {
    for (let y = 0; y < zeilen; y++) {
      const [r, g, b] = FARBTAFEL[bytes[x * zeilen + (zeilen - 1 - y)]];
      const o = (y * spalten + x) * 4;
      aus[o] = r; aus[o + 1] = g; aus[o + 2] = b; aus[o + 3] = 255;
    }
  }
  return aus;
}

// The share of the range width that the picture covers: spalten * sek_je_spalte of dauer_s seconds (at most 1).
export const bildAnteil = (antwort) => {
  const z = antwort?.quelle?.zeitbild;
  return z && antwort.dauer_s > 0 ? Math.min(1, (z.spalten * z.sek_je_spalte) / antwort.dauer_s) : 1;
};

// ---- slice 2: live output, references ---------------------------------------------------------------------------------------------------------------

// m:ss of a second count ('1:05'); a value that is no number reads n/a.
export function minSekText(s) {
  if (!Number.isFinite(s) || s < 0) return ANALYSE_TEXT.leer;
  const ganz = Math.floor(s);
  return `${Math.floor(ganz / 60)}:${String(ganz % 60).padStart(2, '0')}`;
}

// Display ballistics of the live spectrum: per band it rises at once and falls by `fall` dB per second. `pegel` null = nothing shown yet.
export function ballistik(pegel, neu, dt, fall = 20) {
  const s = Number.isFinite(dt) && dt > 0 ? fall * dt : 0;
  return neu.map((n, i) => (pegel && Number.isFinite(pegel[i]) ? Math.max(n, pegel[i] - s) : n));
}
// The maximum of each band since the start (max null = start).
export const maxHalten = (max, neu) => (max ? neu.map((n, i) => Math.max(n, max[i])) : [...neu]);

// The rolling picture of the live mode: spalten columns of zeilen bytes (same byte coding as the time picture: -90..0 dB -> 0..255, column after
// column, lowest band first); a new column goes in at the right edge and the rest moves left.
export const ROLL_SPALTEN = 300;
export const neuesRollbild = (zeilen = 120, spalten = ROLL_SPALTEN) => ({ spalten, zeilen, daten: new Uint8Array(spalten * zeilen) });
export function rollbildSchiebe(bild, db) {
  const { spalten, zeilen, daten } = bild;
  daten.copyWithin(0, zeilen);
  const o = (spalten - 1) * zeilen;
  for (let i = 0; i < zeilen; i++) {
    const d = Number.isFinite(db[i]) ? Math.min(0, Math.max(-90, db[i])) : -90;
    daten[o + i] = Math.round(((d + 90) / 90) * 255);
  }
  return bild;
}

// The entries of the COMPARE WITH selector: none; the strips (not for the live source, never the source itself); the REFERENCES group; the dropped file.
// An entry is { wert, text } or { gruppe, optionen: [{ wert, text }] }.
export function vergleichOptionen({ streifen, quelle, referenzen = [], datei = null }) {
  const aus = [{ wert: '', text: ANALYSE_TEXT.keiner }];
  if (quelle !== 'live') for (const x of streifen) if (x.wert !== quelle) aus.push({ wert: x.wert, text: x.text });
  if (referenzen.length) aus.push({ gruppe: ANALYSE_TEXT.referenzen, optionen: referenzen.map((r) => ({ wert: `ref:${r.id}`, text: `${String(r.rolle ?? '').toUpperCase()} \u00b7 ${r.name}` })) });
  if (datei) aus.push({ wert: 'datei', text: `${ANALYSE_TEXT.datei} \u00b7 ${datei.name}` });
  return aus;
}

// The hints of the live mode, computed on the page: the bass below 120 Hz is not mono, the true peak is too high. [{ art, text }]
export const LIVE_SCHWELLEN = { bassKorrelation: 0.5, pegelMinDb: -60, truePeakDb: -1, halteMs: 2000 };
export function liveHinweise(live) {
  const aus = [];
  if (!live || live.stumm) return aus;
  const b = live.stereo?.baender?.[0];
  if (b && b.korrelation < LIVE_SCHWELLEN.bassKorrelation && b.pegel_db > LIVE_SCHWELLEN.pegelMinDb)
    aus.push({ art: 'bass_nicht_mono', text: `Bass: the band below 120 Hz is not mono-safe (correlation ${b.korrelation.toFixed(2)}).` });
  if (Number.isFinite(live.true_peak_dbtp) && live.true_peak_dbtp > LIVE_SCHWELLEN.truePeakDb)
    aus.push({ art: 'true_peak', text: `True peak is ${live.true_peak_dbtp.toFixed(1)} dBTP, above ${LIVE_SCHWELLEN.truePeakDb} dBTP.` });
  return aus;
}
// Holds each hint for halteMs after it was last seen so the list does not flicker. gehalten: { art: { text, bis } }; returns the new map and the texts.
export function haltHinweise(gehalten, neu, jetzt, halteMs = LIVE_SCHWELLEN.halteMs) {
  const g = {};
  for (const [art, x] of Object.entries(gehalten ?? {})) if (x.bis > jetzt) g[art] = x;
  for (const h of neu) g[h.art] = { text: h.text, bis: jetzt + halteMs };
  return { gehalten: g, liste: Object.keys(g).sort().map((a) => g[a].text) };
}
