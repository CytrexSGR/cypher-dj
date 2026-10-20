// PRODUCTION V1: Fehlertexte der Wurzel (produktion.js). Die Gründe sind die der Projekt-API: djk/oberflaeche/projekt/befehle.ts
// und verlauf.ts (Zweig d1-projekt, S2-Kern, Stand 2026-10-15) plus die HTTP-Gründe aus Spec 3.4. Jeder braucht einen Text,
// sonst zeigt die Seite „Rejected: <code>“.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEHLER_TEXT, fehlerText } from '../oeffentlich/produktion/produktion.js';

// Je Quelle alle Gründe, die der Code der Projekt-API wirft (Stand d1-projekt, 2026-10-15). Gemessen mit
//   git show d1-projekt:djk/oberflaeche/projekt/<datei> | grep -oE "<Klasse>\(('[a-z_]+'|[0-9]+, '[a-z_]+')"
// je Klasse (BefehlFehler über den Wurf ab('…'), AblageFehler, VerlaufFehler, DekodierFehler): Konstruktoraufrufe zählen, nicht jedes
// Zeichenketten-Literal. PatchFehler (patch.ts) erreicht die Seite nur als verlauf_inkonsistent, WiedergabeFehler geht an den Kern.
const GRUENDE_BEFEHLE = ['argument_unbekannt', 'argument_ungueltig', 'art_passt_nicht', 'beat_ausserhalb', 'befehl_unbekannt', 'clip_nicht_midi',
  'clip_unbekannt', 'fade_zu_lang', 'feld_nur_audio', 'id_belegt', 'index_bereich', 'loop_bereich', 'noten_unbekannt', 'projekt_ungueltig',
  'sha_ungueltig', 'slot_belegt', 'spur_bereich', 'spur_unbekannt', 'tempo_bereich', 'zu_gross'];            // befehle.ts: ab('…')
const GRUENDE_ABLAGE = ['json_kaputt', 'log_voraus', 'name_ungueltig', 'projekt_busy', 'projekt_ungueltig', 'slug_ungueltig', 'unbekannt'];   // ablage.ts: AblageFehler
const GRUENDE_VERLAUF = ['label_ungueltig', 'nichts_zu_tun', 'quelle_ungueltig', 'rev_nicht_steigend', 'verlauf_geschlossen', 'verlauf_inkonsistent', 'verlauf_kaputt'];   // verlauf.ts: VerlaufFehler
const GRUENDE_DEKODIER = ['quelle_ungueltig', 'sha_ungueltig'];                                              // dekodier.ts: DekodierFehler
// Gründe der HTTP-Schicht der Seite und des Servers (Spec 3.4), nicht aus der Projekt-API
const GRUENDE_API = ['rev_veraltet', 'regler_abgelehnt', 'kein_projekt', 'ki_gestoppt', 'deck_laeuft', 'nicht_geladen', 'netz', 'keine_antwort', 'server_fehler'];

test('V1 Fehlertexte: jeder Grund der Projekt-API hat einen englischen Text', () => {
  const alle = { befehle: GRUENDE_BEFEHLE, ablage: GRUENDE_ABLAGE, verlauf: GRUENDE_VERLAUF, dekodier: GRUENDE_DEKODIER, api: GRUENDE_API };
  for (const [quelle, liste] of Object.entries(alle)) for (const g of liste) {
    assert.ok(g in FEHLER_TEXT, `${quelle}: Text für ${g}`);
  }
  for (const g of new Set(Object.values(alle).flat())) {
    assert.ok(typeof FEHLER_TEXT[g] === 'string' && FEHLER_TEXT[g].length > 3, `Text für ${g}`);
    assert.doesNotMatch(FEHLER_TEXT[g], /[äöüÄÖÜß]/, `${g}: Oberfläche englisch`);
    assert.equal(fehlerText({ status: 400, j: { fehler: g } }), FEHLER_TEXT[g]);
  }
});

test('V1 Fehlertexte: Kern ohne Antwort (quittung null) ist nie stiller Erfolg; unbekannter Grund zeigt den Code', () => {
  assert.equal(fehlerText({ status: 200, j: { ok: true, quittung: null } }), 'No answer from the core');
  // Negativ-Kontrolle: eine Quittung mit Inhalt ist kein „keine Antwort“
  assert.notEqual(fehlerText({ status: 200, j: { ok: true, quittung: { status: 3, grund: '' } } }), 'No answer from the core');
  assert.equal(fehlerText({ status: 400, j: { fehler: 'gibt_es_nicht' } }), 'Rejected: gibt_es_nicht');
  assert.equal(fehlerText({ status: 502, j: null }), 'Rejected: HTTP 502');
  assert.equal(fehlerText({ status: 0, j: { fehler: 'netz', text: 'x' } }), 'Page server unreachable');
});

// V2 Fix-Runde 2 H7 (Spec 6.34): auch im Schreibweg (POST /proj/aendern, undo/redo, Transport, Öffnen) sind beschaeftigt und zu_gross mehrdeutig
// (ein Freeze, ein Öffnen, eine Tempo-Rampe; Grenzen des Kerns). Die Seite zeigt den text der Antwort, wenn er da ist, sonst neutral; vorher
// stand fest „A freeze is running“ bzw. „The change is too big“, auch wenn der Server etwas anderes sagte.
import { antwortText } from '../oeffentlich/produktion/produktion.js';
test('V2 Fix-Runde 2 H7: beschaeftigt und zu_gross im Schreibweg mit dem text der Antwort, ohne text neutral', () => {
  assert.equal(fehlerText({ status: 409, j: { fehler: 'beschaeftigt', text: 'a project is being opened; a freeze waits until it is open' } }), 'A project is being opened; a freeze waits until it is open');
  assert.equal(antwortText({ status: 409, j: { fehler: 'beschaeftigt', text: 'a freeze is running; changes to the playback wait until it is done' } }), 'A freeze is running; changes to the playback wait until it is done');
  // der S2-Text zu zu_gross ist heute deutsch (projekt/befehle.ts:531); S3 stellt die Server-Texte auf Englisch um, V2 ändert keinen Server-Code
  assert.equal(fehlerText({ status: 400, j: { fehler: 'zu_gross', text: 'ausgerollt 700 Clips, 3 Noten (höchstens 512, 65536)' } }), 'Ausgerollt 700 Clips, 3 Noten (höchstens 512, 65536)');
  for (const [r, wie] of [[{ status: 409, j: { fehler: 'beschaeftigt' } }, 'ohne text'], [{ status: 409, j: { fehler: 'beschaeftigt', text: '  ' } }, 'leerer text'],
    [{ status: 400, j: { fehler: 'zu_gross' } }, 'ohne text'], [{ status: 400, j: { fehler: 'zu_gross', text: 7 } }, 'text keine Zeichenkette']]) {
    const t = fehlerText(r);
    assert.equal(t, FEHLER_TEXT[r.j.fehler], `${r.j.fehler} ${wie}: neutral`);
    assert.doesNotMatch(t, /freeze|change|open|tempo/i, `${r.j.fehler} ${wie}: neutral nennt keine Ursache („${t}“)`);
  }
  // Negativ-Kontrolle: ein eindeutiger Grund behält seinen festen Text, auch wenn die Antwort einen text trägt
  assert.equal(fehlerText({ status: 409, j: { fehler: 'ki_gestoppt', text: 'stop cypher is set by andreas' } }), 'Stop Cypher is set');
  assert.equal(fehlerText({ status: 409, j: { fehler: 'rev_veraltet', text: 'rev 3, server has 5' } }), FEHLER_TEXT.rev_veraltet);
});
