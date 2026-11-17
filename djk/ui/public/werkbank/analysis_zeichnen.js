// ANALYZE window: pure helpers of the window: the log frequency axis, the dB axis, the column under the playhead, the decoded time picture,
// the source list of the selectors and number text. No DOM here (tested in tests/werkbank_analysis_zeichnen.test.mjs); analysis.js draws with them.
// UI texts English.
import { tonName } from '../production/pianoroll.js';
import { mixZuege } from './mix.js';
import { returnListe } from '../production/routing.js';

export const ANALYSE_TEXT = { knopf: 'ANALYZE', knopfTitel: 'Measure the spectrum, stereo image and loudness of a track',
  titel: 'ANALYZE', vergleich: 'COMPARE WITH', keiner: 'none', neu: 'REFRESH', misst: 'measuring…', master: 'MASTER', leer: 'n/a' };

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
