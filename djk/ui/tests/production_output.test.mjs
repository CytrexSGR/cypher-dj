// PRODUCTION V2: Texte und Zustände von FREEZE und EXPORT (output.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUSGABE_FEHLER, ausgabeFehler, freezeKnopf, laufText, ergebnisText, dauerText, dbText, spurenErgebnisText, istExportAntwort, ergebnisOrdner } from '../public/production/output.js';

test('V2 Ausgabe: FREEZE-Schalter je Zustand', () => {
  const s = { id: 's3', name: 'Lead', freeze: null };
  assert.deepEqual(freezeKnopf(s, null), { an: false, laeuft: false, gesperrt: false, label: 'Freeze Lead', titel: 'Freeze: render this track to audio (needed for EXPORT)' });
  assert.equal(freezeKnopf({ ...s, freeze: { kennung: 1 } }, null).an, true);
  assert.equal(freezeKnopf(s, { art: 'freeze', spur_id: 's3' }).laeuft, true);
  const fremd = freezeKnopf(s, { art: 'export' });
  assert.equal(fremd.laeuft, false); assert.equal(fremd.gesperrt, true, 'während eines Exports gesperrt');
});

test('V2 Ausgabe: Fortschritt aus /zustand/arr status 3, sonst Render mit Sekunden', () => {
  const t0 = 1000;
  assert.equal(laufText({ art: 'freeze', an: true, name: 'Lead', seit: t0 }, { status: 3, projekt_beat: 5 }, t0 + 2500), 'Freezing Lead · bar 2.2.1 · 2 s');
  assert.equal(laufText({ art: 'freeze', an: false, name: 'Lead', seit: t0 }, null, t0), 'Unfreezing Lead…');
  assert.equal(laufText({ art: 'export', seit: t0 }, { status: 3, projekt_beat: 0 }, t0 + 999), 'Exporting: freezing · bar 1.1.1 · 0 s');
  assert.equal(laufText({ art: 'export', seit: t0 }, { status: 0, projekt_beat: 0 }, t0 + 4000), 'Exporting: rendering · 4 s', 'Negativ-Kontrolle: status 0 ist kein Freeze');
});

test('laufText names an analysis run', () => {
  assert.equal(laufText({ art: 'analyse' }, null, 0), 'Analysing');
  assert.equal(laufText({ art: 'analyse', seit: 1000 }, null, 4500), 'Analysing · 3 s');
});

test('V2 Ausgabe: Ergebnis mit Dauer, Spitze, Dateiname; über 0 dBFS warnt', () => {
  assert.equal(dauerText(768000), '16.0 s'); assert.equal(dbText(-3.21), '−3.2'); assert.equal(dbText(0.5), '+0.5');
  // Dateiname nach dem S3-Plan (Abweichung 2): <slug>-<JJJJMMTT-hhmmss>.wav im Ordner export/ des Projekts
  const e = ergebnisText({ datei: '/home/x/cypherdj-projekte/first-track/export/first-track-20261016-142233.wav', frames: 768000, spitze_db: -3.21, regler_quelle: 'kern', lufs_i: -14.2, lra: 5.1, true_peak_dbtp: -1.0 });
  assert.deepEqual(e, { text: 'Exported first-track-20261016-142233.wav · 16.0 s · peak −3.2 dBFS · −14.2 LUFS, true peak −1.0 dBTP', titel: '/home/x/cypherdj-projekte/first-track/export/first-track-20261016-142233.wav', pfad: 'Saved to /home/x/cypherdj-projekte/first-track/export/first-track-20261016-142233.wav', warnung: false });
  assert.equal(ergebnisText({ datei: 'a.wav', frames: 48000, spitze_db: 0.3 }).warnung, true);
});

test('V2 Ausgabe: Gründe von S3 mit eigenem Text, alle anderen über die Wurzel', () => {
  // Gründe aus dem S3-Plan (d1-export-api, areas/proj/output.ts STATUS und fehl(…), project/freeze.ts FreezeFehler, render.ts RenderFehler)
  for (const k of ['transport_laeuft', 'beschaeftigt', 'keine_wirtspur', 'spur_leer', 'zu_gross', 'veraltet', 'audio_fehlt', 'kein_kernstand', 'deck_laeuft',
    'freeze_fehler', 'render_fehler', 'export_bereich']) assert.equal(typeof AUSGABE_FEHLER[k], 'string', `${k} hat einen Text`);
  for (const [k, t] of Object.entries(AUSGABE_FEHLER)) { assert.doesNotMatch(t, /[äöüÄÖÜß]/, k); assert.equal(ausgabeFehler({ j: { fehler: k } }, () => 'x'), t); }
  assert.equal(ausgabeFehler({ status: 409, j: { fehler: 'ki_gestoppt' } }, (r) => `Wurzel ${r.j.fehler}`), 'Wurzel ki_gestoppt');
  assert.equal(ausgabeFehler({ status: 502, j: { fehler: 'freeze_fehler', text: 'Kern: abbruch' } }, () => 'x'), 'Freezing failed in the core');
});

// V2 Fix-Runde F15 (Spec 6.34): das Export-Ergebnis zeigt neben Datei, Dauer und Spitze die Lautheit, wenn S3 sie liefert (lufs_i, true_peak_dbtp);
// fehlen die Felder oder sind sie null (loudness_fehler), bleibt die Zeile wie bisher.
test('V2 Ausgabe F15: Lautheit (LUFS-I, True Peak) im Export-Ergebnis, ohne die Felder wie bisher', () => {
  const basis = { datei: '/p/export/x-20261016-142233.wav', frames: 768000, spitze_db: -3.21 };
  assert.equal(ergebnisText({ ...basis, lufs_i: -14.2, lra: 5.1, true_peak_dbtp: -1.0 }).text, 'Exported x-20261016-142233.wav · 16.0 s · peak −3.2 dBFS · −14.2 LUFS, true peak −1.0 dBTP');
  assert.equal(ergebnisText({ ...basis, lufs_i: -70, true_peak_dbtp: -200 }).text, 'Exported x-20261016-142233.wav · 16.0 s · peak −3.2 dBFS · −70.0 LUFS, true peak −∞ dBTP', 'Stille: Gate-Boden und −∞');
  assert.equal(ergebnisText({ ...basis, lufs_i: -9.04, true_peak_dbtp: 0.4, spitze_db: 0.3 }).text, 'Exported x-20261016-142233.wav · 16.0 s · peak +0.3 dBFS · −9.0 LUFS, true peak +0.4 dBTP · CLIPPING');
  assert.equal(ergebnisText(basis).text, 'Exported x-20261016-142233.wav · 16.0 s · peak −3.2 dBFS', 'Negativ-Kontrolle: ohne Lautheit wie bisher');
  assert.equal(ergebnisText({ ...basis, lufs_i: null, lra: null, true_peak_dbtp: null, loudness_fehler: 'ffmpeg_fehlt' }).text, 'Exported x-20261016-142233.wav · 16.0 s · peak −3.2 dBFS', 'loudness_fehler: wie bisher');
});

// V2 Fix-Runde F3: FREEZE und EXPORT nehmen für Antworten ohne eigenen Grund denselben Weg wie der Schreibweg (production.js antwortText):
// 503 ohne Körper und 502 nur mit text heißen „der Server antwortet nicht“, nie „Rejected: HTTP 5xx“. Die Verdrahtung prüft probe_clips 6.8.
test('V2 Ausgabe F3: 5xx ohne Grund über antwortText, 5xx mit Grund behält seinen Text', async () => {
  const { antwortText, FEHLER_TEXT } = await import('../public/production/production.js');
  assert.equal(ausgabeFehler({ status: 503, j: null }, antwortText), FEHLER_TEXT.server_fehler, '503 ohne Körper');
  assert.equal(ausgabeFehler({ status: 502, j: { text: 'bad gateway' } }, antwortText), FEHLER_TEXT.server_fehler, '502 nur mit text');
  assert.equal(ausgabeFehler({ status: 502, j: { fehler: 'render_fehler', text: 'rc 4' } }, antwortText), 'The export render failed', 'Negativ-Kontrolle: Grund von S3');
  assert.equal(ausgabeFehler({ status: 503, j: { fehler: 'kein_kern' } }, antwortText), FEHLER_TEXT.kein_kern, 'Negativ-Kontrolle: 503 mit Grund ist eine Antwort');
  assert.equal(ausgabeFehler({ status: 0, j: { fehler: 'netz' } }, antwortText), FEHLER_TEXT.netz, 'Status 0: Seiten-Server weg');
});

// V2 Fix-Runde F12 (Spec 6.34): mehrdeutige Gründe (beschaeftigt, zu_gross) zeigt die Seite mit dem text der Antwort, wenn er da ist, sonst neutral.
// Alle anderen Gründe behalten ihren eigenen Text, auch wenn die Antwort einen text trägt.
test('V2 Ausgabe F12: beschaeftigt und zu_gross mit dem text der Antwort, ohne text neutral', () => {
  const x = () => 'Wurzel';
  assert.equal(ausgabeFehler({ status: 409, j: { fehler: 'beschaeftigt', text: 'a project is being opened; a freeze waits until it is open' } }, x), 'A project is being opened; a freeze waits until it is open');
  assert.equal(ausgabeFehler({ status: 409, j: { fehler: 'beschaeftigt', text: 'the core is still ramping the tempo; a freeze waits until the ramp is done' } }, x), 'The core is still ramping the tempo; a freeze waits until the ramp is done');
  assert.equal(ausgabeFehler({ status: 400, j: { fehler: 'zu_gross', text: 'freeze at most 256 beats (Lead: 0 to 308)' } }, x), 'Freeze at most 256 beats (Lead: 0 to 308)');
  assert.equal(ausgabeFehler({ status: 409, j: { fehler: 'beschaeftigt' } }, x), AUSGABE_FEHLER.beschaeftigt, 'ohne text: neutral');
  assert.equal(ausgabeFehler({ status: 400, j: { fehler: 'zu_gross', text: '  ' } }, x), AUSGABE_FEHLER.zu_gross, 'leerer text: neutral');
  assert.doesNotMatch(AUSGABE_FEHLER.beschaeftigt, /freeze/i, 'neutral nennt keine Ursache');
  assert.doesNotMatch(AUSGABE_FEHLER.zu_gross, /256|freeze/i, 'neutral nennt keine Ursache');
  assert.equal(ausgabeFehler({ status: 409, j: { fehler: 'transport_laeuft', text: 'transport läuft' } }, x), 'Stop the transport first', 'Negativ-Kontrolle: eindeutiger Grund behält seinen Text');
});

// V2 Fix-Runde 2 H3 (Spec 6.34): ein fremder Lauf (nach Reload aus GET /proj/aktuell ausgabe_lauf, das kein Startfeld trägt) hat keine Startzeit;
// die Seite zeigt dann keine Sekunden, statt die Sekunden seit dem Reload als Laufzeit auszugeben. Der eigene Lauf behält sie.
test('V2 Ausgabe H3: fremder Lauf ohne Sekunden, eigener mit', () => {
  const t0 = 1000;
  assert.equal(laufText({ art: 'freeze', an: true, name: 'Lead', seit: null }, { status: 3, projekt_beat: 5 }, t0 + 2500), 'Freezing Lead · bar 2.2.1');
  assert.equal(laufText({ art: 'freeze', an: true, name: 'Lead' }, null, t0), 'Freezing Lead');
  assert.equal(laufText({ art: 'export', seit: null }, { status: 3, projekt_beat: 0 }, t0), 'Exporting: freezing · bar 1.1.1');
  assert.equal(laufText({ art: 'export', seit: null }, { status: 0, projekt_beat: 0 }, t0), 'Exporting: rendering');
  // Negativ-Kontrolle: der eigene Lauf (seit gesetzt) zeigt die Sekunden weiter
  assert.equal(laufText({ art: 'freeze', an: true, name: 'Lead', seit: t0 }, { status: 3, projekt_beat: 5 }, t0 + 2500), 'Freezing Lead · bar 2.2.1 · 2 s');
  assert.equal(laufText({ art: 'export', seit: t0 }, { status: 0 }, t0 + 4000), 'Exporting: rendering · 4 s');
});

test('1.10 Slice 2: ergebnisText nennt, dass der Export über der Decke des Set-Limiters liegt, nur dann', () => {
  const j = { datei: '/p/export/x.wav', frames: 96000, spitze_db: 2.4, lufs_i: -9.1, true_peak_dbtp: 2.6, abgriff: 'produktion', ueber_decke: true, limiter_db_max: 3.4 };
  const e = ergebnisText(j);
  assert.match(e.text, /ABOVE SET LIMITER CEILING \(set limiter would take 3\.4 dB\)/); assert.equal(e.warnung, true); assert.equal(e.titel, j.datei);
  const still = ergebnisText({ ...j, spitze_db: -4, ueber_decke: false, limiter_db_max: 0 });
  assert.doesNotMatch(still.text, /SET LIMITER/); assert.equal(still.warnung, false);
  assert.doesNotMatch(ergebnisText({ datei: '/x.wav', frames: 48000, spitze_db: -6 }).text, /SET LIMITER/, 'alte Antwort ohne Felder: unverändert');
});

// Export delivery (task 5): deliveries, the target check and refusals with a detail
const MASTER = '/p/export/song-20261126-101500.wav';
const basis = { datei: MASTER, frames: 768000, spitze_db: -3.21, lufs_i: -12.0, lra: 5.1, true_peak_dbtp: -0.4 };
const heute = 'Exported song-20261126-101500.wav · 16.0 s · peak −3.2 dBFS · −12.0 LUFS, true peak −0.4 dBTP';
const ab16 = { format: 'wav', rate_hz: 44100, bits: 16, dither: 'tpdf', datei: '/p/export/song-20261126-101500.16bit-44k.wav', lufs_i: -12, lra: 5, true_peak_dbtp: -0.2 };
const abMp3 = { format: 'mp3', rate_hz: 44100, kbps: 320, datei: '/p/export/song-20261126-101500.320kbps-44k.mp3', lufs_i: -12, lra: 5, true_peak_dbtp: 0.3 };

test('ergebnisText: unchanged for an answer without abgaben or ziel', () => {
  assert.deepEqual(ergebnisText(basis), { text: heute, titel: MASTER, pfad: `Saved to ${MASTER}`, warnung: false });
  assert.deepEqual(ergebnisText({ ...basis, abgaben: [] }), ergebnisText(basis), 'an empty list changes nothing');
});

test('ergebnisText: deliveries, a failed one, the target lines and the warning flag', () => {
  const zwei = ergebnisText({ ...basis, abgaben: [ab16, abMp3] });
  assert.equal(zwei.text, `${heute} · 16bit-44k TP −0.2 · 320kbps-44k TP +0.3`);
  assert.equal(zwei.titel, [MASTER, ab16.datei, abMp3.datei].join('\n'), 'every written file, one per line');
  assert.equal(zwei.warnung, false);
  assert.equal(zwei.pfad, `Saved to ${MASTER}`);
  // a failed delivery
  const kaputt = ergebnisText({ ...basis, abgaben: [ab16, { format: 'mp3', rate_hz: 44100, kbps: 320, datei: null, fehler: 'ffmpeg was not found' }] });
  assert.equal(kaputt.text, `${heute} · 16bit-44k TP −0.2 · 320kbps-44k FAILED`);
  assert.equal(kaputt.warnung, true);
  assert.equal(kaputt.titel, [MASTER, ab16.datei, '320kbps-44k failed: ffmpeg was not found'].join('\n'), 'written files, then one line per failed delivery with its reason');
  // target: louder than the target, quieter, within 0.5, true peak above the ceiling
  const ziel = { lufs_i: -14, true_peak_dbtp: -1 };
  const laut = ergebnisText({ ...basis, abgaben: [ab16], ziel, ziel_pruefung: { lufs_abstand: 4.7, tp_abstand: 0.6, tp_ueber: true }, ziel_ok: false });
  assert.equal(laut.text, `${heute} · 16bit-44k TP −0.2 · +4.7 LU above target · TRUE PEAK ABOVE −1.0 dBTP`);
  assert.equal(laut.warnung, true);
  const leise = ergebnisText({ ...basis, ziel, ziel_pruefung: { lufs_abstand: -1.2, tp_abstand: -2, tp_ueber: false }, ziel_ok: true });
  assert.equal(leise.text, `${heute} · 1.2 LU under target`);
  assert.equal(leise.warnung, false);
  assert.equal(ergebnisText({ ...basis, ziel, ziel_pruefung: { lufs_abstand: 0.4, tp_abstand: -2, tp_ueber: false }, ziel_ok: true }).text, heute, 'within 0.5 LU: nothing');
  assert.equal(ergebnisText({ ...basis, ziel, ziel_pruefung: { lufs_abstand: -0.5, tp_abstand: -2, tp_ueber: false }, ziel_ok: true }).text, `${heute} · 0.5 LU under target`, '0.5 itself is shown');
  // not measured: never TRUE PEAK ABOVE
  const nicht = ergebnisText({ datei: MASTER, frames: 768000, spitze_db: -3.21, lufs_i: null, lra: null, true_peak_dbtp: null, loudness_fehler: 'ffmpeg_fehlt', ziel, ziel_pruefung: { lufs_abstand: null, tp_abstand: null, tp_ueber: null }, ziel_ok: null });
  assert.equal(nicht.text, 'Exported song-20261126-101500.wav · 16.0 s · peak −3.2 dBFS · TARGET NOT MEASURED');
  assert.doesNotMatch(nicht.text, /TRUE PEAK ABOVE/);
  assert.equal(nicht.warnung, true);
  // a target that is met without a true peak target has no extra text
  assert.equal(ergebnisText({ ...basis, ziel: { lufs_i: -12 }, ziel_pruefung: { lufs_abstand: 0, tp_abstand: null, tp_ueber: false }, ziel_ok: true }).text, heute);
});

test('ausgabeFehler: a refusal with a detail shows text and detail', () => {
  const x = () => 'Wurzel';
  const r = { status: 400, j: { fehler: 'argument_ungueltig', text: 'abgabe: not a valid list of delivery formats', detail: 'abgabe[1].kbps applies to mp3 only' } };
  assert.equal(ausgabeFehler(r, x), 'abgabe: not a valid list of delivery formats (abgabe[1].kbps applies to mp3 only)');
  assert.equal(ausgabeFehler({ status: 400, j: { fehler: 'argument_ungueltig', text: 'ziel: not valid', detail: 'ziel.lufs_i: a number from -70 to 0 is required' } }, x), 'ziel: not valid (ziel.lufs_i: a number from -70 to 0 is required)');
  assert.equal(ausgabeFehler({ status: 400, j: { fehler: 'argument_ungueltig' } }, x), 'Wurzel', 'without a detail the root text stays');
  assert.equal(ausgabeFehler({ status: 400, j: { fehler: 'argument_ungueltig', detail: 'x' } }, x), 'Wurzel', 'a detail without text is not shown alone');
  assert.equal(ausgabeFehler({ status: 502, j: { fehler: 'freeze_fehler', text: 'Kern: abbruch', detail: 'rc 4' } }, x), 'Freezing failed in the core', 'other reasons keep their text');
});

test('ergebnisText: the tooltip names the reason of every failed delivery, one line each, after the files', () => {
  const f1 = { format: 'mp3', rate_hz: 44100, kbps: 320, datei: null, fehler: 'ffmpeg was not found' };
  const f2 = { format: 'flac', rate_hz: 96000, bits: 24, datei: null, fehler: 'ffmpeg failed (exit 1): boom' };
  const e = ergebnisText({ ...basis, abgaben: [f1, ab16, f2] });
  assert.equal(e.titel, [MASTER, ab16.datei, '320kbps-44k failed: ffmpeg was not found', '24bit-96k failed: ffmpeg failed (exit 1): boom'].join('\n'));
  assert.equal(ergebnisText({ ...basis, abgaben: [{ ...f1, fehler: undefined }] }).titel, `${MASTER}\n320kbps-44k failed`, 'no reason in the answer: the line still says it failed');
  assert.equal(ergebnisText({ ...basis, abgaben: [ab16] }).titel, [MASTER, ab16.datei].join('\n'), 'nothing failed: no extra line');
});

// the per-track set (task 6)
const SET = { ordner: '/p/export/song-20261126-101500', von_beat: 0, bis_beat: 8, dateien: [
  { art: 'mix', name: 'Song', datei: 'mix.flac', spitze_db: -3, stumm: false }, { art: 'spur', spur_id: 's1', nr: 1, name: 'Kick', datei: '01-kick.flac', spitze_db: -6, stumm: false },
  { art: 'spur', spur_id: 's2', nr: 2, name: 'Bass', datei: null, spitze_db: -200, stumm: true }, { art: 'return', return_id: 'r1', nr: 1, name: 'Hall', datei: 'fx1-hall.flac', spitze_db: -9, stumm: false }] };

test('spurenErgebnisText: count of written files, folder name, path and the file names in the tooltip', () => {
  assert.deepEqual(spurenErgebnisText(SET), { text: 'Exported 3 files to song-20261126-101500', titel: 'mix.flac\n01-kick.flac\nfx1-hall.flac',
    pfad: 'Saved to /p/export/song-20261126-101500', warnung: false });
  assert.equal(spurenErgebnisText({ ...SET, dateien: [SET.dateien[0]] }).text, 'Exported 1 file to song-20261126-101500');
  assert.equal(spurenErgebnisText({ ...SET, ordner: '/p/export/song-20261126-101500/' }).text, 'Exported 3 files to song-20261126-101500', 'a trailing slash does not empty the name');
});

test('istExportAntwort: the answer of the set has ordner and dateien, the answer of the mix has datei', () => {
  assert.equal(istExportAntwort('/proj/export_spuren', SET), true);
  assert.equal(istExportAntwort('/proj/export_spuren', { datei: '/x.wav' }), false);
  assert.equal(istExportAntwort('/proj/export_spuren', null), false);
  assert.equal(istExportAntwort('/proj/export', { datei: '/x.wav' }), true);
  assert.equal(istExportAntwort('/proj/export', SET), false);
});

test('ergebnisOrdner: the folder of a mix file, the folder of a track set, otherwise null', () => {
  assert.equal(ergebnisOrdner({ datei: '/p/song/export/song-1.wav' }), '/p/song/export');
  assert.equal(ergebnisOrdner({ ordner: '/p/song/export/song-1' }), '/p/song/export/song-1');
  assert.equal(ergebnisOrdner({ ordner: '/p/song/export/song-1///' }), '/p/song/export/song-1', 'trailing slashes are dropped');
  assert.equal(ergebnisOrdner({ datei: '/song-1.wav' }), '/', 'a file in the root');
  for (const x of [null, undefined, {}, { datei: 'song.wav' }, { datei: '' }, { ordner: '' }, { ordner: 3 }]) assert.equal(ergebnisOrdner(x), null, JSON.stringify(x));
});
