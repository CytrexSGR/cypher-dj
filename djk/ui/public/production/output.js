// PRODUCTION (D1 V2): Bedienung von FREEZE (Spurkopf einer Wirt-Spur) und EXPORT (Transportleiste), Spec 2.5, 3.4
// /proj/freeze und /proj/export (Paket S3). Reine Funktionen für Texte und Zustände, Browser und node.
// Fortschritt ohne eigenes Ereignis (Spec 3.4 kennt keins): ein Freeze ist ein Echtzeit-Durchlauf, /zustand/arr meldet ihn mit
// status 3 und projekt_beat (Spec 3.1); den Render danach sieht die Seite nicht, sie zählt die Sekunden.
import { positionText } from './timeline.js';

// Gründe, die S3 nennt (Plan d1-export-api 2026-10-15-d1-s3-export-api.md: areas/proj/output.ts STATUS und fehl(…), project/freeze.ts
// FreezeFehler, project/render.ts RenderFehler). Alle übrigen Gründe (kein_projekt, ki_gestoppt, nicht_geladen, spur_unbekannt,
// argument_ungueltig, die S2-Gründe aus alsAntwort, intern) nimmt die Wurzel (production.js FEHLER_TEXT).
// Eigene Texte hier, weil dieselben Gründe beim Bearbeiten etwas anderes heißen (beschaeftigt: „A freeze is running“, zu_gross: Änderung).
// Spec 6.34: beschaeftigt und zu_gross sind mehrdeutig (ein Lauf, ein Öffnen, eine Tempo-Rampe; Länge des Freeze oder Grenzen des Kerns). Die
// Seite zeigt dort den text der Antwort, wenn er da ist (ausgabeFehler), sonst diesen neutralen Text, der keine Ursache behauptet.
export const AUSGABE_FEHLER = {
  transport_laeuft: 'Stop the transport first',
  beschaeftigt: 'The server is busy: try again in a moment',
  keine_wirtspur: 'Only tracks that use a Surge (a Surge track or a rack with a Surge member) can be frozen',
  spur_leer: 'The track has no notes to freeze',
  zu_gross: 'Too big for the server',
  veraltet: 'The project changed during the run: nothing was saved, please repeat',
  audio_fehlt: 'An audio clip is still being prepared: try again in a moment',
  kein_kernstand: 'The core has not reported its state yet: try again in a moment',
  deck_laeuft: 'A deck is playing: stop it first (freezing needs the project tempo on the master)',
  freeze_noetig: 'A track with unfrozen notes has to be frozen first: freeze it or measure with the tool',
  freeze_fehler: 'Freezing failed in the core',
  keine_runde: 'No sound round is running: start one first',
  platz_leer: 'That place has no sound yet: wait until it is measured',
  runde_veraltet: 'The project changed since this round was measured: start a new round',
  vergleich_steht: 'COMPARE needs a running transport: start playback first',
  kein_stammbaum: 'There is no family tree step to go back to on this track',
  spur_still: 'The track is silent in the measured range',
  wirt_fehlt: 'The Surge host for this track is not running: start it with djk-instrumente --arr1 or --arr2',
  wirt_fehler: 'The Surge host for this track stopped with an error: start it again with djk-instrumente --arr1 or --arr2',
  wirt_spiegel_fehler: 'The Surge host did not take the track\'s parameter map, so a freeze would sound different from the project: check the Surge host and try again',
  render_fehler: 'The export render failed',
  messung_fehler: 'Measuring the reference failed',
  format_falsch: 'The file cannot be read as audio',
  referenz_unbekannt: 'There is no such stored reference',
  speichern_fehler: 'The reference could not be saved',
  quelle_unbekannt: 'The audio file of the reference was not found',
  export_bereich: 'The export range must be 1 to 1024 beats long',
  export_leer: 'No unmuted instrument track has a note in this range',
  keine_arbeitsflaeche: 'The server has no desktop session to open a folder in',
  pfad_fehlt: 'There is no such folder',
  pfad_ausserhalb: 'That folder is outside your home folder and the mounted drives, or hidden',
  pfad_nicht_lesbar: 'That folder cannot be read',
  ordner_nicht_schreibbar: 'That folder is not writable',
};
export const MEHRDEUTIG = new Set(['beschaeftigt', 'zu_gross']);
const satz = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Text eines mehrdeutigen Grunds aus der Antwort (als Satz), sonst null; gilt auch für den Schreibweg (production.js fehlerText, V2 Fix-Runde 2 H7)
export function mehrdeutigText(r) {
  const code = r?.j?.fehler ?? r?.j?.grund, text = typeof r?.j?.text === 'string' ? r.j.text.trim() : '';
  return MEHRDEUTIG.has(code) && text ? satz(text) : null;
}
// argument_ungueltig of an export carries the entry at fault as `detail` next to its English `text` (abgabe, ziel): the message shows both
function detailText(r) {
  const j = r?.j;
  return j?.fehler === 'argument_ungueltig' && typeof j.text === 'string' && j.text.trim() && typeof j.detail === 'string' && j.detail.trim()
    ? `${j.text.trim()} (${j.detail.trim()})` : null;
}
export function ausgabeFehler(r, sonst) {
  return mehrdeutigText(r) ?? detailText(r) ?? AUSGABE_FEHLER[r?.j?.fehler ?? r?.j?.grund] ?? sonst(r);
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
// plan 1.11 task 13: a project with an active host stage (foreign plugin) exports in real time. The page tells the length up front and shows a progress bar.
const zwei = (n) => String(n).padStart(2, '0');
export const mmss = (s) => `${zwei(Math.floor(Math.max(0, s) / 60))}:${zwei(Math.round(Math.max(0, s)) % 60)}`;
export function hatHostStufe(p) {
  const traeger = [...(p?.spuren ?? []), ...(p?.gruppen ?? []), ...(p?.returns ?? []), ...(p?.master ? [p.master] : [])];
  return traeger.some((t) => (t.inserts ?? []).some((i) => i.art === 'host' && i.an));
}
// the range of a default export (loop bracket when on, else the whole song) as seconds at the project tempo
export function exportDauerS(p) {
  let bis = 0, von = 0;
  if (p?.loop?.an) { von = p.loop.von_beat; bis = p.loop.bis_beat; } else for (const s of p?.spuren ?? []) for (const c of s.clips ?? []) bis = Math.max(bis, c.start_beat + c.laenge_beats);
  return Math.max(0, bis - von) * 60 / (p?.tempo_bpm || 120);
}
export const echtzeitHinweis = (p) => (hatHostStufe(p) ? `Real-time export (foreign plugins): about ${mmss(exportDauerS(p))}` : '');
// progress of a real-time run 0..1 from ausgabe_lauf {start_ms, dauer_s}; null when unknown
export const echtzeitFortschritt = (lauf, jetztMs = Date.now()) =>
  (lauf?.echtzeit && typeof lauf.start_ms === 'number' && lauf.dauer_s > 0 ? Math.min(1, Math.max(0, (jetztMs - lauf.start_ms) / 1000 / lauf.dauer_s)) : null);
export function laufText(lauf, arr, jetzt) {
  if (lauf.art === 'export' && lauf.echtzeit && typeof lauf.start_ms === 'number') {
    return `Real-time export (foreign plugins): ${mmss((Date.now() - lauf.start_ms) / 1000)} of ${mmss(lauf.dauer_s)}`;
  }
  const sek = typeof lauf.seit === 'number' ? ` · ${Math.max(0, Math.floor((jetzt - lauf.seit) / 1000))} s` : '';
  const wo = arr?.status === 3 && Number.isFinite(arr.projekt_beat) ? ` · bar ${positionText(arr.projekt_beat)}` : '';
  if (lauf.art === 'freeze') return lauf.an ? `Freezing ${lauf.name}${wo}${sek}` : `Unfreezing ${lauf.name}…`;
  if (lauf.art === 'lautheit') return `Measuring loudness${sek}`;   // Paket 1.18 E-b: ein Lauf von proj_lautheit (Cypher), ausgabe_lauf {art: 'lautheit'}
  if (lauf.art === 'analyse') return `Analysing${sek}`;   // ANALYZE window / proj_analyse: ausgabe_lauf {art: 'analyse'}
  if (lauf.art === 'merge') return `Merging tracks${sek}`;   // Slice 7: a merge run (own page or Cypher), ausgabe_lauf {art: 'merge'}
  if (lauf.art === 'bounce') return `Bouncing${sek}`;        // 1.14 slice 4: a bounce run (own page or Cypher), ausgabe_lauf {art: 'bounce'}
  if (lauf.art === 'resample') return `Resampling ${lauf.name}${sek}`;   // 1.10 slice 7: a resample run (own page or Cypher), ausgabe_lauf {art: 'resample'}
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
// COLLECT (storage layout A5): the report of POST /proj/einsammeln as one line for the output next to the buttons
export function einsammelText(j) {
  const mb = Math.round((Number(j.bytes) || 0) / 1048576), n = (x) => (Array.isArray(x) ? x.length : 0);
  const teile = [`Collected ${j.kopiert} file${j.kopiert === 1 ? '' : 's'}${j.kopiert ? ` (${mb} MB)` : ''}`, `${j.schon_da} already in the project`];
  if (n(j.fehlt)) teile.push(`${n(j.fehlt)} missing (disk not mounted?)`);
  if (n(j.abweichend)) teile.push(`${n(j.abweichend)} copied wrongly and removed`);
  return { text: teile.join(' · '), titel: '', warnung: n(j.fehlt) + n(j.abweichend) > 0 };
}
// Delivery files of an export (answer key abgaben): the tag is the part of the file name between the master name and the extension
// (`16bit-44k`); a failed entry (datei null) has no file, its tag is built like the server builds it (djk/ui/project/abgabe.ts abgabeName)
function abgabeTag(a, masterName) {
  if (typeof a.datei === 'string') {
    const n = dateiName(a.datei), basis = masterName.replace(/\.wav$/i, '');
    if (n.startsWith(`${basis}.`) && n.lastIndexOf('.') > basis.length) return n.slice(basis.length + 1, n.lastIndexOf('.'));
  }
  const k = zahl(a.rate_hz) ? `${Math.floor(a.rate_hz / 1000)}k` : '';
  const t = a.format === 'mp3' ? `${a.kbps}kbps` : a.bits === 32 ? '32float' : `${a.bits}bit`;
  return k ? `${t}-${k}` : String(a.format ?? 'file');
}
function abgabenText(j) {
  const liste = Array.isArray(j.abgaben) ? j.abgaben : [], master = dateiName(j.datei);
  let text = '', fehlgeschlagen = false;
  for (const a of liste) {
    const tag = abgabeTag(a, master);
    if (typeof a.datei === 'string') text += ` · ${tag} TP ${zahl(a.true_peak_dbtp) ? dbText(a.true_peak_dbtp) : 'not measured'}`;
    else { text += ` · ${tag} FAILED`; fehlgeschlagen = true; }
  }
  // the reason of a failed delivery is shown nowhere else: one tooltip line each (`<tag> failed: <fehler>`)
  const gescheitert = liste.filter((a) => typeof a.datei !== 'string')
    .map((a) => `${abgabeTag(a, master)} failed${typeof a.fehler === 'string' && a.fehler.trim() ? `: ${a.fehler.trim()}` : ''}`);
  return { text, fehlgeschlagen, dateien: liste.filter((a) => typeof a.datei === 'string').map((a) => a.datei), gescheitert };
}
// the target check: how far the master is from the target loudness, and whether a true peak is above the ceiling (ziel_ok false) or was not measured (null)
function zielText(j) {
  let text = '';
  const d = j.ziel_pruefung?.lufs_abstand;
  if (zahl(d) && Math.abs(d) >= 0.5) text += d > 0 ? ` · +${d.toFixed(1)} LU above target` : ` · ${(-d).toFixed(1)} LU under target`;
  if (j.ziel_ok === false) text += ` · TRUE PEAK ABOVE ${zahl(j.ziel?.true_peak_dbtp) ? `${dbText(j.ziel.true_peak_dbtp)} dBTP` : 'the target'}`;
  if (j.ziel_ok === null) text += ' · TARGET NOT MEASURED';
  return text;
}
export function ergebnisText(j) {
  const ueber = j.spitze_db > 0, decke = j.ueber_decke === true;   // 1.10 Slice 2: ueber_decke nur vom Produktions-Abgriff (Server, P10); ältere Antworten haben das Feld nicht
  const limiter = decke && zahl(j.limiter_db_max) && j.limiter_db_max > 0 ? ` (set limiter would take ${j.limiter_db_max.toFixed(1)} dB)` : '';
  const ab = abgabenText(j);
  return {
    text: `Exported ${dateiName(j.datei)} · ${dauerText(j.frames)} · peak ${dbText(j.spitze_db)} dBFS${lautheitText(j)}${ueber ? ' · CLIPPING' : ''}${decke ? ` · ABOVE SET LIMITER CEILING${limiter}` : ''}${ab.text}${zielText(j)}`,
    titel: [j.datei, ...ab.dateien, ...ab.gescheitert].join('\n'),
    pfad: `Saved to ${j.datei}`,   // the full path in visible text (the server answers with the absolute file path)
    warnung: ueber || decke || ab.fehlgeschlagen || j.ziel_ok === false || j.ziel_ok === null,
  };
}

// Answer of POST /proj/export_spuren {ordner, dateien: [{art, name, datei, spitze_db, stumm}], abgabe?}: the files of the set. A muted entry (datei null)
// has no file and is not counted. The tooltip lists the file names, the visible path line is the folder.
export function spurenErgebnisText(j) {
  const namen = (Array.isArray(j.dateien) ? j.dateien : []).filter((x) => typeof x.datei === 'string').map((x) => x.datei);
  const ordner = String(j.ordner).replace(/\/+$/, '');
  return { text: `Exported ${namen.length} file${namen.length === 1 ? '' : 's'} to ${ordner.split('/').pop()}`, titel: namen.join('\n'), pfad: `Saved to ${j.ordner}`, warnung: false };
}
// the answer a request of the export dialog must carry: the mix has `datei`, the per-track set has `ordner` and `dateien`
export const istExportAntwort = (weg, j) => (weg === '/proj/export_spuren' ? typeof j?.ordner === 'string' && Array.isArray(j.dateien) : typeof j?.datei === 'string');
// the folder the last export answer lives in (what SHOW FOLDER opens): the mix file's directory, or the track set's own folder; null when unknown
export function ergebnisOrdner(j) {
  if (typeof j?.datei === 'string') { const i = j.datei.lastIndexOf('/'); return i < 0 ? null : i === 0 ? '/' : j.datei.slice(0, i); }
  if (typeof j?.ordner === 'string') return j.ordner.replace(/\/+$/, '') || null;
  return null;
}
// the text line of the last export answer, whichever route it came from
export const exportErgebnisText = (j) => (typeof j.datei === 'string' ? ergebnisText(j) : spurenErgebnisText(j));
