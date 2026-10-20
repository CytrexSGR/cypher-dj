// PRODUCTION (D1 V2): Bedienung von FREEZE (Spurkopf einer Wirt-Spur) und EXPORT (Transportleiste), Spec 2.5, 3.4
// /proj/freeze und /proj/export (Paket S3). Reine Funktionen für Texte und Zustände, Browser und node.
// Fortschritt ohne eigenes Ereignis (Spec 3.4 kennt keins): ein Freeze ist ein Echtzeit-Durchlauf, /zustand/arr meldet ihn mit
// status 3 und projekt_beat (Spec 3.1); den Render danach sieht die Seite nicht, sie zählt die Sekunden.
import { positionText } from './zeitachse.js';

// Gründe, die S3 nennt (Plan d1-export-api 2026-10-15-d1-s3-export-api.md: bereiche/proj/ausgabe.ts STATUS und fehl(…), projekt/freeze.ts
// FreezeFehler, projekt/render.ts RenderFehler). Alle übrigen Gründe (kein_projekt, ki_gestoppt, nicht_geladen, spur_unbekannt,
// argument_ungueltig, die S2-Gründe aus alsAntwort, intern) nimmt die Wurzel (produktion.js FEHLER_TEXT).
// Eigene Texte hier, weil dieselben Gründe beim Bearbeiten etwas anderes heißen (beschaeftigt: „A freeze is running“, zu_gross: Änderung).
// Spec 6.34: beschaeftigt und zu_gross sind mehrdeutig (ein Lauf, ein Öffnen, eine Tempo-Rampe; Länge des Freeze oder Grenzen des Kerns). Die
// Seite zeigt dort den text der Antwort, wenn er da ist (ausgabeFehler), sonst diesen neutralen Text, der keine Ursache behauptet.
export const AUSGABE_FEHLER = {
  transport_laeuft: 'Stop the transport first',
  beschaeftigt: 'The server is busy: try again in a moment',
  keine_wirtspur: 'Only Surge tracks can be frozen',
  spur_leer: 'The track has no notes to freeze',
  zu_gross: 'Too big for the server',
  veraltet: 'The project changed during the run: nothing was saved, please repeat',
  audio_fehlt: 'An audio clip is still being prepared: try again in a moment',
  kein_kernstand: 'The core has not reported its state yet: try again in a moment',
  deck_laeuft: 'A deck is playing: stop it first (freezing needs the project tempo on the master)',
  freeze_fehler: 'Freezing failed in the core',
  render_fehler: 'The export render failed',
  export_bereich: 'The export range must be 1 to 1024 beats long',
};
export const MEHRDEUTIG = new Set(['beschaeftigt', 'zu_gross']);
const satz = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Text eines mehrdeutigen Grunds aus der Antwort (als Satz), sonst null; gilt auch für den Schreibweg (produktion.js fehlerText, V2 Fix-Runde 2 H7)
export function mehrdeutigText(r) {
  const code = r?.j?.fehler ?? r?.j?.grund, text = typeof r?.j?.text === 'string' ? r.j.text.trim() : '';
  return MEHRDEUTIG.has(code) && text ? satz(text) : null;
}
export function ausgabeFehler(r, sonst) {
  return mehrdeutigText(r) ?? AUSGABE_FEHLER[r?.j?.fehler ?? r?.j?.grund] ?? sonst(r);
}

// Zustand des FREEZE-Schalters einer Spur: an (eingefroren), laeuft (dieser Lauf), gesperrt (ein anderer Lauf oder kein Projekt)
export function freezeKnopf(spur, lauf) {
  const an = !!spur.freeze, laeuft = lauf?.art === 'freeze' && lauf.spur_id === spur.id;
  return {
    an, laeuft, gesperrt: !!lauf,
    label: `${an ? 'Unfreeze' : 'Freeze'} ${spur.name}`,
    titel: laeuft ? 'Running…' : an ? 'Frozen: plays as audio. Click to unfreeze (editing notes unfreezes too)' : 'Freeze: render this track to audio (needed for EXPORT)',
  };
}

// Text während eines Laufs (jede Bildschleife): Phase, Takt des Durchlaufs, Sekunden. V2 Fix-Runde 2 H3: ein fremder Lauf (ausgabe_lauf nach
// einem Reload, Spec 6.34 ohne Startfeld) hat kein seit; dann keine Sekunden, statt die Zeit seit dem Reload als Laufzeit zu zeigen.
export function laufText(lauf, arr, jetzt) {
  const sek = typeof lauf.seit === 'number' ? ` · ${Math.max(0, Math.floor((jetzt - lauf.seit) / 1000))} s` : '';
  const wo = arr?.status === 3 && Number.isFinite(arr.projekt_beat) ? ` · bar ${positionText(arr.projekt_beat)}` : '';
  if (lauf.art === 'freeze') return lauf.an ? `Freezing ${lauf.name}${wo}${sek}` : `Unfreezing ${lauf.name}…`;
  return `${arr?.status === 3 ? `Exporting: freezing${wo}` : 'Exporting: rendering'}${sek}`;
}

export const dauerText = (frames, sr = 48000) => `${(frames / sr).toFixed(1)} s`;
export const dbText = (db) => (db <= -199 ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`.replace('-', '−'));
export const dateiName = (p) => String(p).split('/').pop();

// Ergebnis von /proj/export {datei, frames, spitze_db, lufs_i?, true_peak_dbtp?, …}: Zeile in der Transportleiste, voller Pfad im Titel,
// Warnung über 0 dBFS. Spec 6.34: die Lautheit (LUFS-I, True Peak) steht dabei, wenn S3 sie liefert (Zahlen; null bei loudness_fehler)
const zahl = (x) => typeof x === 'number' && Number.isFinite(x);
export function lautheitText(j) {
  return zahl(j.lufs_i) && zahl(j.true_peak_dbtp) ? ` · ${dbText(j.lufs_i)} LUFS, true peak ${dbText(j.true_peak_dbtp)} dBTP` : '';
}
export function ergebnisText(j) {
  const ueber = j.spitze_db > 0;
  return {
    text: `Exported ${dateiName(j.datei)} · ${dauerText(j.frames)} · peak ${dbText(j.spitze_db)} dBFS${lautheitText(j)}${ueber ? ' · CLIPPING' : ''}`,
    titel: j.datei,
    warnung: ueber,
  };
}
