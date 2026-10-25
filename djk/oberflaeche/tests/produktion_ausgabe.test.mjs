// PRODUCTION V2: Texte und Zustände von FREEZE und EXPORT (ausgabe.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUSGABE_FEHLER, ausgabeFehler, freezeKnopf, laufText, ergebnisText, dauerText, dbText } from '../oeffentlich/produktion/ausgabe.js';

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

test('V2 Ausgabe: Ergebnis mit Dauer, Spitze, Dateiname; über 0 dBFS warnt', () => {
  assert.equal(dauerText(768000), '16.0 s'); assert.equal(dbText(-3.21), '−3.2'); assert.equal(dbText(0.5), '+0.5');
  // Dateiname nach dem S3-Plan (Abweichung 2): <slug>-<JJJJMMTT-hhmmss>.wav im Ordner export/ des Projekts
  const e = ergebnisText({ datei: '/home/x/cypherdj-projekte/first-track/export/first-track-20261016-142233.wav', frames: 768000, spitze_db: -3.21, regler_quelle: 'kern', lufs_i: -14.2, lra: 5.1, true_peak_dbtp: -1.0 });
  assert.deepEqual(e, { text: 'Exported first-track-20261016-142233.wav · 16.0 s · peak −3.2 dBFS · −14.2 LUFS, true peak −1.0 dBTP', titel: '/home/x/cypherdj-projekte/first-track/export/first-track-20261016-142233.wav', warnung: false });
  assert.equal(ergebnisText({ datei: 'a.wav', frames: 48000, spitze_db: 0.3 }).warnung, true);
});

test('V2 Ausgabe: Gründe von S3 mit eigenem Text, alle anderen über die Wurzel', () => {
  // Gründe aus dem S3-Plan (d1-export-api, bereiche/proj/ausgabe.ts STATUS und fehl(…), projekt/freeze.ts FreezeFehler, render.ts RenderFehler)
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

// V2 Fix-Runde F3: FREEZE und EXPORT nehmen für Antworten ohne eigenen Grund denselben Weg wie der Schreibweg (produktion.js antwortText):
// 503 ohne Körper und 502 nur mit text heißen „der Server antwortet nicht“, nie „Rejected: HTTP 5xx“. Die Verdrahtung prüft probe_clips 6.8.
test('V2 Ausgabe F3: 5xx ohne Grund über antwortText, 5xx mit Grund behält seinen Text', async () => {
  const { antwortText, FEHLER_TEXT } = await import('../oeffentlich/produktion/produktion.js');
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
