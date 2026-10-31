// PRODUCTION V2 Nachzug (Slice 0b, Punkt 7a): FEHLER_TEXT kennt JEDEN Grund, der über /proj/* zur Seite kommen kann. Die Gründe
// stehen nicht als Hand-Liste hier, sondern werden aus dem Server-Code IM SELBEN BAUM gelesen (Konstruktoraufrufe, nicht jedes
// Zeichenketten-Literal): BefehlFehler über ab('…') in projekt/befehle.ts; new AblageFehler/VerlaufFehler/DekodierFehler/PatchFehler/
// WiedergabeFehler in projekt/*.ts, new ProjFehler und die Gründe-Literale {fehler|grund: '…'} (Tempo-Weg, intern, verlauf_inkonsistent)
// in bereiche/proj/*.ts, new KatalogFehler in katalog.ts, dazu BEREICH_GRUENDE (bereiche/proj/abbildung.ts) und die drei Gründe, die
// der Auftrag ausdrücklich nennt ('intern', 'slot_belegt', 'ueber_projekt'; je nachgewiesen im Code). Ändert der Server einen Grund,
// wird dieser Test rot, bevor die Seite „Rejected: <code>“ zeigt.
// D1 V2 Slice 3: dazu die Gründe von S3 (Freeze/Export, Plan d1-export-api): new AusgabeFehler/FreezeFehler/StandFehler, fehl('…') in
// bereiche/proj/*.ts und `readonly grund = '…'` (RenderFehler) in projekt/*.ts. Sie kommen nur über /proj/freeze und /proj/export zur Seite;
// dort zeigt freeze_export.js ausgabeFehler(r, fehlerText), also genügt ein Text in AUSGABE_FEHLER (ausgabe.js) oder FEHLER_TEXT. Solange S3
// nicht im Baum ist, findet die Extraktion sie nicht; die Positiv-Kontrolle prüft die Muster an wörtlichen Zeilen aus dem S3-Plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEHLER_TEXT, fehlerText } from '../oeffentlich/produktion/produktion.js';
import { AUSGABE_FEHLER, ausgabeFehler } from '../oeffentlich/produktion/ausgabe.js';

import { gruendeAusDatei, gruendeAusDemCode, S3_QUELLE } from './hilfen/gruende.mjs';
export { gruendeAusDatei, gruendeAusDemCode };

test('V2 Gründe: die Extraktion findet bekannte Gründe aus jeder Quelle (Positiv-Kontrolle)', () => {
  const g = gruendeAusDemCode();
  const wo = (x) => [...(g.get(x) ?? [])].join(' | ');
  for (const [x, quelle] of [['clip_unbekannt', 'ab projekt/befehle.ts'], ['slot_belegt', 'ab projekt/befehle.ts'], ['projekt_busy', 'AblageFehler'],
    ['nichts_zu_tun', 'VerlaufFehler'], ['quelle_ungueltig', 'DekodierFehler'], ['op_unbekannt', 'PatchFehler'], ['beschaeftigt', 'ProjFehler'],
    ['koerper_zu_gross', 'ProjFehler'], ['katalog_kaputt', 'KatalogFehler'], ['datei_fehlt', 'WiedergabeFehler'], ['tempo_abgelehnt', 'literal bereiche/proj/sitzung.ts'],
    ['rampe_haengt', 'literal'], ['marker_unbekannt', 'WarpFehler'], ['intern', 'literal bereiche/proj/bereich.ts'], ['kein_kern', 'BEREICH_GRUENDE'], ['ueber_projekt', 'genannt server.ts'],
    ['nur_json', 'literal http/transport.ts'], ['fremde_herkunft', 'literal http/transport.ts'], ['stems_loop', 'ab projekt/stems.ts']]) {
    assert.ok(wo(x).includes(quelle), `${x} aus ${quelle} gefunden (gefunden: ${wo(x) || 'nichts'})`);
  }
  assert.ok(g.size >= 60, `mindestens 60 Gründe (gefunden ${g.size})`);
  assert.equal(g.has('gibt_es_nicht'), false, 'Negativ-Kontrolle: kein erfundener Grund');
});

test('V2 Gründe: die S3-Muster finden die Gründe in wörtlichen Zeilen des S3-Plans (Positiv-Kontrolle, S3 noch nicht im Baum)', () => {
  // je eine Zeile aus d1-export-api docs/superpowers/plans/2026-10-15-d1-s3-export-api.md (Tasks 1.1, 1.2, 2.1, 2.2), unverändert
  const PROBE = [
    ['bereiche/proj/ausgabe.ts', "    if (this.lauf) fehl('beschaeftigt', `${this.lauf.art === 'freeze' ? 'ein Freeze' : 'ein Export'} läuft`);"],
    ['bereiche/proj/ausgabe.ts', "    if (fehlt.length) fehl('audio_fehlt', `noch nicht dekodiert: ${fehlt.join(', ')}`);"],
    ['bereiche/proj/ausgabe.ts', "  try { return await koerper(q); } catch (e) { throw new AusgabeFehler('argument_ungueltig', `Körper: ${(e as Error).message}`); }"],
    ['projekt/freeze.ts', "  try { groesse = (await fs.promises.stat(datei)).size; } catch { throw new FreezeFehler('freeze_fehler', `Datei ${freezeDateiName(nr, kennung)} fehlt`); }"],
    ['projekt/stand.ts', "  if (fehler !== null) throw new StandFehler('projekt_ungueltig', fehler);"],
    ['projekt/render.ts', "  readonly grund = 'render_fehler';"],
  ];
  const g = new Map();
  for (const [d, t] of PROBE) gruendeAusDatei(d, t, (x, wo) => g.set(x, wo));
  assert.deepEqual([...g.keys()].sort(), ['argument_ungueltig', 'audio_fehlt', 'beschaeftigt', 'freeze_fehler', 'projekt_ungueltig', 'render_fehler']);
  assert.match(g.get('render_fehler'), S3_QUELLE); assert.match(g.get('beschaeftigt'), S3_QUELLE);
  const leer = new Map();
  gruendeAusDatei('katalog.ts', "fehl('nicht_hier'); readonly grund = 'auch_nicht';", (x) => leer.set(x, 1));
  assert.equal(leer.size, 0, 'Negativ-Kontrolle: fehl(…) zählt nur in bereiche/, das grund-Feld nur in projekt/');
});

test('V2 Gründe: jeder Grund des Servers hat einen englischen Text, nie „Rejected: <code>“', () => {
  const ohne = [];
  for (const [x, wo] of gruendeAusDemCode()) {
    if ([...wo].every((f) => S3_QUELLE.test(f))) {   // nur aus S3: Text in AUSGABE_FEHLER oder FEHLER_TEXT
      if (typeof (AUSGABE_FEHLER[x] ?? FEHLER_TEXT[x]) !== 'string') { ohne.push(`${x} (${[...wo].join(' | ')})`); continue; }
      for (const status of [400, 409, 502]) assert.doesNotMatch(ausgabeFehler({ status, j: { fehler: x } }, fehlerText), /^Rejected/, `${x} bei ${status}`);
      continue;
    }
    if (typeof FEHLER_TEXT[x] !== 'string') { ohne.push(`${x} (${[...wo].join(' | ')})`); continue; }
    assert.ok(FEHLER_TEXT[x].length > 3, x);
    assert.doesNotMatch(FEHLER_TEXT[x], /[äöüÄÖÜß]/, `${x}: Oberfläche englisch`);
    for (const status of [400, 404, 409, 503]) assert.doesNotMatch(fehlerText({ status, j: { fehler: x } }), /^Rejected/, `${x} bei ${status}`);
  }
  assert.deepEqual(ohne, [], 'Gründe ohne Text');
});

test('V2 Gründe: die Wortlaute aus Spec 6.28 und 6.34 (ein Surge-Slot; beschaeftigt ohne text neutral, Fix-Runde 2 H7)', () => {
  assert.equal(FEHLER_TEXT.slot_belegt, 'D1 has one Surge slot');
  assert.equal(fehlerText({ status: 409, j: { fehler: 'beschaeftigt' } }), 'The server is busy: try again in a moment');
});

// V2 Fix-Runde F9: das Ternär-Muster nimmt nur die Zweige, nicht den Vergleich davor, und kein Literal außerhalb von fehler:/grund:
test('V2 Gründe F9: Ternär-Literale in fehler:, Negativ-Kontrolle ohne fehler:', () => {
  const g = new Map();
  gruendeAusDatei('http/x.ts', "json(a, 415, { fehler: abweisung === 415 ? 'nur_json' : 'fremde_herkunft' });", (x) => g.set(x, 1));
  gruendeAusDatei('http/x.ts', "const art = q.method === 'post' ? 'schreiben' : 'lesen';", (x) => g.set(x, 1));
  gruendeAusDatei('http/x.ts', "return { grund: modus === 'streng' ? 'abgelehnt' : 'ok', text: 'kein_grund' };", (x) => g.set(x, 1));
  assert.deepEqual([...g.keys()].sort(), ['abgelehnt', 'fremde_herkunft', 'nur_json', 'ok']);
});

// D1 S3 (Auftrag 14 d): S3 ist jetzt im Baum. Die Extraktion muss die Gründe von /proj/freeze und /proj/export aus dem echten Code ziehen
// (nicht nur aus den Plan-Zeilen oben), und jeder davon hat einen Seitentext. Fehlt hier einer, lief der Test oben gegen einen Baum ohne S3.
test('V2 Gründe: S3 im Baum, die Extraktion findet die Gründe von Freeze und Export im Code und die Seite hat für jeden einen Text', () => {
  const g = gruendeAusDemCode();
  const s3 = (x) => [...(g.get(x) ?? [])].filter((w) => S3_QUELLE.test(w));
  const S3 = ['veraltet', 'audio_fehlt', 'kein_kernstand', 'zu_gross', 'beschaeftigt', 'freeze_fehler', 'spur_leer', 'render_fehler', 'export_bereich',
    'keine_wirtspur', 'nicht_geladen', 'transport_laeuft', 'ki_gestoppt', 'kein_projekt', 'spur_unbekannt', 'argument_ungueltig', 'projekt_ungueltig'];
  for (const x of S3) assert.ok(s3(x).length > 0, `${x}: aus bereiche/proj/ausgabe.ts, projekt/freeze.ts, stand.ts oder render.ts gezogen`);
  assert.ok(s3('render_fehler').some((w) => w.includes('projekt/render.ts')), 'render_fehler aus dem grund-Feld von RenderFehler');
  for (const x of [...S3, 'deck_laeuft']) assert.equal(typeof (AUSGABE_FEHLER[x] ?? FEHLER_TEXT[x]), 'string', `${x}: Text auf der Seite`);
});

// Fix-Runde Slice 4, Punkt 6: ein Schlüssel zweimal im Objektliteral gilt still der letzte und fällt in keinem Test auf (produktion.js hatte transienten_fehlen und
// keine_transienten doppelt). Die Schlüssel stehen am Zeilenanfang oder nach einem Komma, vor einem Zeichenkettenliteral.
const doppelte = (quelltext, objekt) => {
  const a = quelltext.indexOf(`${objekt} = {`), b = quelltext.indexOf('\n};', a);
  const zaehl = new Map();
  for (const m of quelltext.slice(a, b).matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*):\s*['"`]/gm)) zaehl.set(m[1], (zaehl.get(m[1]) ?? 0) + 1);
  return [...zaehl].filter(([, n]) => n > 1).map(([k]) => k);
};
test('FEHLER_TEXT in produktion.js: kein Schlüssel doppelt (Positiv-Kontrolle am Muster, dann am Quelltext)', () => {
  const probe = "const X = {\n  a: 'eins', b: 'zwei',\n  c: 'drei', a: 'vier: noch einmal',\n  d: 'Tempo: 60'\n};";
  assert.deepEqual(doppelte(probe, 'const X'), ['a'], 'das Muster findet einen doppelten Schlüssel und lässt "Tempo: 60" im Text in Ruhe');
  const q = readFileSync(new URL('../oeffentlich/produktion/produktion.js', import.meta.url), 'utf8');
  assert.ok(q.includes('export const FEHLER_TEXT = {'));
  assert.deepEqual(doppelte(q, 'export const FEHLER_TEXT'), []);
});
