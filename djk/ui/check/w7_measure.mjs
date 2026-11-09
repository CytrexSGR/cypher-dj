// Paket 1.13 Warp, Slice 7 (Merge, AK27): die Rechnung der Zielabnahme check/acceptance_w7.mjs, rein und ohne Netz. Geeicht in tests/check_w7_measure.test.mjs
// (jede Negativ-Kontrolle schlägt dort an). Vorbild pruef/w6_messen.mjs.
import { MAX_SPUREN } from '../project/model.ts';

export const SR = 48000;
export const NULL_TOR_DB = -90;                                  // AK27

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const rmsVon = (x, n = x.length) => { let s = 0; for (let i = 0; i < n; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, n)); };

// Null-Differenz zweier Exporte (Float32, je Kanal). spitze_db: größter |a − b| in dBFS (Vollaussteuerung = 1,0); rms_db: Effektivwert der Differenz in dBFS.
export function nullDifferenz(a, b) {
  if (a.length !== b.length) return { ok: false, grund: 'laenge', frames_a: a.length, frames_b: b.length };
  let spitze = 0, summe = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; spitze = Math.max(spitze, Math.abs(d)); summe += d * d; }
  return { ok: true, spitze_db: db(spitze), rms_db: db(Math.sqrt(summe / a.length)), frames: a.length };
}
export const nullOk = (r) => r.ok === true && r.spitze_db < NULL_TOR_DB;

// Diagnose (b) des Messtors: Pegelverhältnis RMS B / RMS A in dB. −3,01 heißt: das Pan-Gesetz fehlt (P2); ein anderer fester Wert: Gruppe oder PM doppelt.
export const pegelVerhaeltnisDb = (a, b) => db(rmsVon(b) / rmsVon(a));

// Diagnose (a): lag with sum a[i]*b[i-lag] maximal (B delayed by k samples gives -k) (Kreuzkorrelation im Fenster ±maxLag, direkt gerechnet auf höchstens
// `fenster` Samples)
export function versatz(a, b, { maxLag = 64, fenster = 48000, ab = 0 } = {}) {
  const n = Math.min(a.length, b.length, ab + fenster);
  let beste = 0, bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = Math.max(ab, lag); i < n && i - lag < b.length; i++) s += a[i] * b[i - lag];
    if (s > beste) { beste = s; bestLag = lag; }
  }
  return bestLag;
}

// Diagnose (c): Null-Differenz der ersten n Samples getrennt vom Rest (Blende, Einstiegsrampe), plus Spitze ab Sample n
export function anfangUndRest(a, b, n = 2000) {
  if (a.length !== b.length) return { ok: false, grund: 'laenge' };
  const m = Math.min(n, a.length);
  const spitze = (von, bis) => { let s = 0; for (let i = von; i < bis; i++) s = Math.max(s, Math.abs(a[i] - b[i])); return db(s); };
  return { ok: true, anfang_db: spitze(0, m), rest_db: spitze(m, a.length) };
}

// Regler-Datei des Solo-Exports ohne Kern-Zustand (Diagnose d, A2): die Spuren der Menge mit ihren Reglern, alle anderen stumm, Solo überall aus,
// Gruppen und PM neutral. Dieselbe Rechnung wie project/merge.ts mergeRegler, hier mit eigenem Code, damit ein Fehler dort nicht beide trifft.
export function reglerSolo(projekt, spurIds) {
  const r = {};
  for (let n = 1; n <= MAX_SPUREN; n++) { r[`spur/${n}/mute`] = 1; r[`spur/${n}/solo`] = 0; }
  for (const s of projekt.spuren.filter((x) => spurIds.includes(x.id))) {
    r[`spur/${s.nr}/fader`] = s.fader_db; r[`spur/${s.nr}/pan`] = s.pan; r[`spur/${s.nr}/mute`] = s.mute ? 1 : 0;
  }
  for (const g of projekt.gruppen ?? []) { r[`grp/${g.nr}/fader`] = 0; r[`grp/${g.nr}/pan`] = 0; r[`grp/${g.nr}/mute`] = 0; r[`grp/${g.nr}/solo`] = 0; }
  return r;
}

// Stand für den Undo-Vergleich (Schlüssel wie w6): Spurenliste, mute, solo, Clips, Gruppen
export const standSchluessel = (p) => JSON.stringify({
  spuren: p.spuren.map((s) => [s.id, !!s.mute, !!s.solo, s.fader_db, s.pan, s.ausgang?.id ?? null, s.clips.map((c) => [c.id, !!c.stumm, c.start_beat,
    c.laenge_beats, c.gain_db])]),
  gruppen: (p.gruppen ?? []).map((g) => [g.id, g.fader_db, g.pan]), master: p.master?.fader_db ?? 0 });
