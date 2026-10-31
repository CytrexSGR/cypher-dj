// Paket 1.13 Warp, Slice 3a (Task 1): leseKarte. Schlüssel sha[:16] mit Gegenprobe quelle.sha256, Marker-Beat = Karten-Beat minus erste Eins,
// eins_unsicher aus dem Feld (fehlt es: wahr), jede Ablehnung mit Positivkontrolle (derselbe Aufbau mit gültigem Dokument liest).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { leseKarte, leseTraktor, rundeGerade } from '../bereiche/proj/quellen.ts';
import { ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';
import { karteLinear, schreibeKarte, schreibeBestand, baueMarken } from './hilfen/karte.mjs';

const SHA = ksha(6);
const karte = karteLinear(40, { t0: 0.5, bpm: 120 });   // Beat i bei 0,5 + 0,5·i Sekunden

test('Karte: Eins 2 verschiebt die Beats (erster Marker −2, Beat 0 bei 1,5 s), Dauer aus dem Dokument, unsicher aus dem Feld', (t) => {
  const a = tmpOrdner(t, 'djk-q-');
  schreibeKarte(a, SHA, { karte, eins: 2, unsicher: true, dauer_s: 368.718 });
  const r = leseKarte(a, SHA);
  assert.equal(r.karte.marker.length, 40);
  assert.deepEqual(r.karte.marker[0], [0.5, -2]);
  assert.deepEqual(r.karte.marker[2], [1.5, 0]);
  assert.deepEqual(r.karte.marker[39], [20, 37]);
  assert.equal(r.karte.eins_unsicher, true);
  assert.equal(r.dauer_s, 368.718);
  schreibeKarte(a, ksha(7), { karte, eins: 0, unsicher: false });
  const s = leseKarte(a, ksha(7));
  assert.deepEqual(s.karte.marker[0], [0.5, 0]);
  assert.equal(s.karte.eins_unsicher, false, 'Gegenprobe: das Feld false gilt als false');
});

test('Karte aus der Zeit vor dem Eins-Feld (kein erste_eins_unsicher): unsicher', (t) => {
  const a = tmpOrdner(t, 'djk-q-');
  schreibeKarte(a, SHA, { karte, ohneUnsicherFeld: true });
  assert.equal(leseKarte(a, SHA).karte.eins_unsicher, true);
});

test('tempo_vielfaches 2: die Beats der Karte (0, 2, 4, …) bleiben wie gespeichert', (t) => {
  const a = tmpOrdner(t, 'djk-q-');
  schreibeKarte(a, SHA, { karte: karteLinear(20, { t0: 0.2, bpm: 140, schritt: 2 }), eins: 2 });
  const m = leseKarte(a, SHA).karte.marker;
  assert.deepEqual([m[0][1], m[1][1], m[2][1]], [-2, 0, 2]);
});

test('Ablehnungen (je mit Positivkontrolle): keine Ablage, falsche Länge der sha, kein Ordner, fremde sha im Dokument, Schema 2, kaputtes JSON, Eins 5, zu kurz', (t) => {
  const a = tmpOrdner(t, 'djk-q-');
  schreibeKarte(a, SHA, { karte });
  assert.ok(leseKarte(a, SHA), 'Positivkontrolle');
  assert.equal(leseKarte(null, SHA), null);
  assert.equal(leseKarte(undefined, SHA), null);
  assert.equal(leseKarte(a, SHA.slice(0, 16)), null, 'nur die volle sha schlüsselt');
  assert.equal(leseKarte(a, 'f'.repeat(64)), null, 'kein Ordner');
  schreibeKarte(a, ksha(8), { karte, quellSha: ksha(9) });
  assert.equal(leseKarte(a, ksha(8)), null, 'Gegenprobe quelle.sha256: der Ordner passt, das Dokument gehört einer anderen Datei');
  schreibeKarte(a, ksha(10), { karte, schema: 2 });
  assert.equal(leseKarte(a, ksha(10)), null);
  schreibeKarte(a, ksha(11), { karte, eins: 5 });
  assert.equal(leseKarte(a, ksha(11)), null);
  schreibeKarte(a, ksha(12), { karte: [[0.5, 0]] });
  assert.equal(leseKarte(a, ksha(12)), null);
  schreibeKarte(a, ksha(13), { karte: [[0.5, 0], [1, 'x']] });
  assert.equal(leseKarte(a, ksha(13)), null);
  fs.writeFileSync(path.join(a, ksha(14).slice(0, 16)) + '.json', '{'); fs.mkdirSync(path.join(a, ksha(14).slice(0, 16)));
  fs.writeFileSync(path.join(a, ksha(14).slice(0, 16), 'material.json'), '{kaputt');
  assert.equal(leseKarte(a, ksha(14)), null);
});

test('Traktor: früheste Raster-Zeile des Tracks, jede nummer; andere Quelle, andere Art, fremder Track, ohne bpm zählen nicht', (t) => {
  const d = tmpOrdner(t, 'djk-q-');
  const db = baueMarken(path.join(d, 'mediathek.sqlite'), [
    { sha: SHA, nummer: 4, start_s: 225.645, bpm: 128, name: 'Beat Marker' },       // späterer Anker desselben Tracks
    { sha: SHA, nummer: 0, start_s: 0.0575918, bpm: 128, name: 'AutoGrid' },        // der erste Schlag: gilt (nummer 0, nicht −1)
    { sha: SHA, nummer: -1, start_s: 0.0001, bpm: 128, quelle: 'werkstatt' },       // Werkstatt-Marke „erster Schlag“: nie
    { sha: SHA, nummer: 1, start_s: 0.0002, bpm: 128, art: 'cue' },                 // Hotcue: nie
    { sha: ksha(8), nummer: 0, start_s: 1, bpm: null },                             // ohne BPM: nie
    { sha: ksha(9), nummer: 0, start_s: 2.5, bpm: 70.8 },
  ]);
  assert.deepEqual(leseTraktor(db, SHA), { anker_s: 0.0575918, bpm: 128 });
  assert.equal(leseTraktor(db, ksha(8)), null);
  assert.deepEqual(leseTraktor(db, ksha(9)), { anker_s: 2.5, bpm: 70.8 });
  assert.equal(leseTraktor(db, ksha(10)), null, 'fremder Track');
  assert.equal(leseTraktor(path.join(d, 'gibts-nicht.sqlite'), SHA), null);
  assert.equal(leseTraktor(null, SHA), null);
  assert.equal(leseTraktor(db, SHA.slice(0, 16)), null);
  fs.writeFileSync(path.join(d, 'kaputt.sqlite'), 'kein sqlite');
  assert.equal(leseTraktor(path.join(d, 'kaputt.sqlite'), SHA), null, 'eine Datei ohne Datenbank: kein Raster, kein Absturz');
});

// Slice 3b Nachbesserung: korrekturen.jsonl Zeile für Zeile, laut bei Defekt; Rundung wie Python round()
const gut = (ab, von = 'andreas') => JSON.stringify({ zeit: '2026-10-09T20:33:30', von, art: 'eins', fassung: '128000_r1', ab_quell_beat: ab, bis_quell_beat: null, versatz_ms: null, nr: null, text: 'T' });
function mitKorrekturen(t, zeilen) {
  const a = tmpOrdner(t, 'djk-q-'), b = path.join(a, 'bestand');
  schreibeKarte(a, SHA, { karte, eins: 2, unsicher: true });
  const dir = schreibeBestand(b, SHA, { karte, eins: 2, unsicher: true });
  fs.writeFileSync(path.join(dir, 'korrekturen.jsonl'), zeilen.join('\n') + '\n');
  const gemeldet = [], alt = console.error;
  console.error = (m) => gemeldet.push(String(m));
  try { return { r: leseKarte(a, SHA, b), gemeldet }; } finally { console.error = alt; }
}
test('korrekturen.jsonl: abgeschnittene Zeile plus gültige Zeile → die gültige gilt, die kaputte wird gemeldet', (t) => {
  const { r, gemeldet } = mitKorrekturen(t, ['{"zeit":"2026-10-09T20:33:30","von":"andr', gut(1)]);
  assert.deepEqual([r.karte.marker[0][1], r.karte.eins_unsicher], [-1, false], 'Lage 1 von andreas');
  assert.equal(gemeldet.length, 1); assert.match(gemeldet[0], /Zeile 1 übersprungen/);
});
test('korrekturen.jsonl: Müll vor gültiger Zeile, gültige Zeile davor und danach bleiben', (t) => {
  const { r, gemeldet } = mitKorrekturen(t, [gut(3), 'müll{{', gut(1)]);
  assert.equal(r.karte.marker[0][1], -1, 'die letzte gültige Zeile gilt');
  assert.equal(gemeldet.length, 1); assert.match(gemeldet[0], /Zeile 2/);
  const { r: r2 } = mitKorrekturen(t, [gut(3), 'müll{{']);
  assert.equal(r2.karte.marker[0][1], -3, 'gültige Zeile davor gilt weiter: Lage 3, erster Marker −3');
});
test('korrekturen.jsonl: Zeile ohne von, mit falscher fassung oder ab_quell_beat als Text fällt laut weg; Negativkontrolle: gültig wirkt', (t) => {
  const roh = JSON.parse(gut(1));
  const ohneVon = JSON.stringify({ ...roh, von: undefined }), fass = JSON.stringify({ ...roh, fassung: '128_x' }), text = JSON.stringify({ ...roh, ab_quell_beat: '1' });
  const { r, gemeldet } = mitKorrekturen(t, [ohneVon, fass, text]);
  assert.deepEqual([r.karte.marker[0][1], r.karte.eins_unsicher], [-2, true], 'nichts davon zählt');
  assert.equal(gemeldet.length, 3);
  assert.equal(mitKorrekturen(t, [gut(1)]).r.karte.marker[0][1], -1);
});
test('rundeGerade wie Python round(): Halbe zur geraden Zahl', () => {
  assert.deepEqual([2.5, 3.5, -2.5, 0.5, 1.5, 2.4, 2.6, -0.4].map(rundeGerade).map((x) => x + 0), [2, 4, -2, 0, 2, 2, 3, 0]);
  assert.deepEqual([rundeGerade(133), rundeGerade(-3)], [133, -3]);
});
