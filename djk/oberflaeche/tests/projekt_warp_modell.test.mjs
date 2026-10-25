// Paket 1.13 Warp, Slice 1: Warp im Projektformat /2 von 1.10 (AK1 Server) und Prüfung des Warps (AK2). Ein /1-Projekt öffnet als /2 ohne Warp;
// in einer /1-Datei ist ein warp ein unbekanntes Feld; jede Regelverletzung hat ihren Grund (der Grund, den der Befehl später meldet) und ihre
// Positivkontrolle (der gültige Warp geht durch). Routing (1.10) und Warp stehen im selben /2 nebeneinander.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMAT, FORMAT_ALT, MAX_MARKER, neuesProjekt, pruefeFehler, pruefeProjekt, warpPruefung } from '../projekt/modell.ts';
import { specProjekt, kopie } from './hilfen/projekt.mjs';

const gut = () => ({ an: true, modus: 'repitch', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0 });
// specProjekt() ist /1; als /2 braucht es gruppen und master (1.10)
const mitWarp = (w, format = FORMAT) => {
  const p = kopie(specProjekt()); p.format = format; p.spuren[0].clips[0].warp = w;
  if (format === FORMAT) { p.gruppen = []; p.master = { fader_db: 0 }; }
  return p;
};

test('Format: neue Projekte sind /2, /1 bleibt lesbar und öffnet als /2 ohne ein Warp-Feld', () => {
  assert.equal(FORMAT, 'cypherdj-projekt/2'); assert.equal(FORMAT_ALT, 'cypherdj-projekt/1');   // die Nummern von 1.10, Warp ändert sie nicht
  assert.equal(neuesProjekt('x').format, FORMAT);
  const alt = specProjekt();
  assert.equal(alt.format, FORMAT_ALT);
  assert.equal(pruefeFehler(alt), null, 'die /1-Datei ist gültig');
  const r = pruefeProjekt(alt);
  assert.equal(r.projekt.format, FORMAT, 'geöffnet ist es /2');
  const audio = r.projekt.spuren.flatMap((s) => s.clips).filter((c) => c.art === 'audio');
  assert.ok(audio.length > 0, 'die Vorlage hat Audio-Clips (sonst prüfte die Schleife nichts)');
  for (const c of audio) assert.equal(c.warp, undefined, `Clip ${c.id}: kein Warp beim Öffnen`);
  assert.equal(JSON.stringify(r.projekt).includes('warp'), false, 'und trägt von sich aus kein Warp-Feld (kein Auto-Warp beim Öffnen)');
  assert.equal(alt.format, FORMAT_ALT, 'die Eingabe bleibt unberührt');
});

test('Warp in /1 ist ein unbekanntes Feld (auch null), in /2 gültig; warp null = ohne', () => {
  assert.match(pruefeFehler(mitWarp(gut(), FORMAT_ALT)), /warp.*unbekanntes Feld/);
  assert.match(pruefeFehler(mitWarp(null, FORMAT_ALT)) ?? '', /warp.*unbekanntes Feld/, 'N4-6: auch warp null ist in /1 ein unbekanntes Feld');
  assert.equal(pruefeFehler(mitWarp(gut())), null);
  assert.equal(pruefeFehler(mitWarp(null)), null);
  assert.equal(pruefeProjekt(mitWarp(gut())).projekt.spuren[0].clips[0].warp.marker[1][1], 8, 'der Warp übersteht das Öffnen');
});

test('Routing (1.10) und Warp im selben /2-Projekt; die Hebung von /1 bringt gruppen und master, aber keinen Warp', () => {
  const p = mitWarp(gut());
  p.gruppen = [{ id: 'g1', nr: 1, name: 'Bus', farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false }];
  p.spuren[0].ausgang = { art: 'gruppe', id: 'g1' };
  assert.equal(pruefeFehler(p), null, 'beides zusammen ist gültig');
  const q = pruefeProjekt(p).projekt;
  assert.equal(q.spuren[0].ausgang.id, 'g1'); assert.equal(q.spuren[0].clips[0].warp.an, true);
  const h = pruefeProjekt(specProjekt()).projekt;
  assert.deepEqual(h.gruppen, []); assert.deepEqual(h.master, { fader_db: 0 });
  assert.equal(JSON.stringify(h).includes('warp'), false);
});

const viele = (n) => Array.from({ length: n }, (_, i) => [i * 0.5, i * 0.5 * 2]);   // 120 BPM je Segment
const ABLEHNUNGEN = [
  ['ein Marker', (w) => { w.marker = [[0, 0]]; }, 'warp_marker'],
  ['kein Marker', (w) => { w.marker = []; }, 'warp_marker'],
  ['kein Paar', (w) => { w.marker = [[0, 0], [1]]; }, 'warp_marker'],
  ['quell_s fällt', (w) => { w.marker = [[0, 0], [2, 4], [1, 8]]; }, 'warp_marker'],
  ['beat fällt', (w) => { w.marker = [[0, 0], [2, 8], [4, 4]]; }, 'warp_marker'],
  ['quell_s gleich', (w) => { w.marker = [[0, 0], [0, 4]]; }, 'warp_marker'],
  ['beat gleich', (w) => { w.marker = [[0, 0], [2, 0]]; }, 'warp_marker'],
  ['Frames gleich nach mal 48 000', (w) => { w.marker = [[0, 0], [1.5000000000000002, 4], [1.5000000000000004, 8]]; }, 'warp_marker'],
  ['Beat gleich nach dem Versatz', (w) => { w.marker = [[0, 0.1], [2, 0.1 + 1e-12]]; w.versatz_beats = 1e5; }, 'warp_marker'],
  ['quell_s negativ', (w) => { w.marker = [[-1, 0], [2, 4]]; }, 'warp_marker'],
  ['beat außerhalb', (w) => { w.marker = [[0, 0], [2, 1e9]]; }, 'warp_marker'],
  ['Marker keine Zahl', (w) => { w.marker = [[0, 0], [2, 'x']]; }, 'warp_marker'],
  ['4097 Marker', (w) => { w.marker = viele(MAX_MARKER + 1); }, 'warp_marker'],
  ['Segment zu langsam (10 BPM)', (w) => { w.marker = [[0, 0], [6, 1]]; }, 'warp_faktor'],
  ['Segment zu schnell (900 BPM)', (w) => { w.marker = [[0, 0], [1, 15]]; }, 'warp_faktor'],
  ['Segment knapp über 800 BPM (800,02)', (w) => { w.marker = [[0, 0], [0.3, 4.0001]]; }, 'warp_faktor'],
  ['Segment knapp unter 15 BPM (14,9985)', (w) => { w.marker = [[0, 0], [4, 0.9999]]; }, 'warp_faktor'],
  ['Modus unbekannt', (w) => { w.modus = 'turbo'; }, 'warp_modus'],
  ['Modus noch nicht gebaut (complex)', (w) => { w.modus = 'complex'; }, 'warp_modus'],
  ['Transpose bei RE-PITCH', (w) => { w.transpose_st = 2; }, 'transpose_repitch'],
  ['Detune bei RE-PITCH', (w) => { w.detune_ct = 10; }, 'transpose_repitch'],
  ['Transpose nicht ganz', (w) => { w.transpose_st = 0.5; }, 'argument_ungueltig'],
  ['Transpose außerhalb ±48', (w) => { w.transpose_st = 49; }, 'argument_ungueltig'],
  ['Detune außerhalb ±50', (w) => { w.detune_ct = 51; }, 'argument_ungueltig'],
  ['Quelle unbekannt', (w) => { w.quelle = 'raten'; }, 'argument_ungueltig'],
  ['an kein Boolean', (w) => { w.an = 1; }, 'argument_ungueltig'],
  ['versatz keine Zahl', (w) => { w.versatz_beats = Number.NaN; }, 'argument_ungueltig'],
  ['unbekanntes Feld', (w) => { w.farbe = 'rot'; }, 'argument_unbekannt'],
  ['Pflichtfeld fehlt', (w) => { delete w.quelle; }, 'argument_ungueltig'],
];
test('AK2: jede Verletzung hat ihren Grund, im Modell und im Befehls-Prüfer; der gültige Warp geht durch', () => {
  assert.equal(warpPruefung(gut()), null, 'Positivkontrolle');
  for (const [name, f, grund] of ABLEHNUNGEN) {
    const w = gut(); f(w);
    const e = warpPruefung(w);
    assert.equal(e?.grund, grund, `${name}: Grund ${e?.grund ?? 'keiner (angenommen)'}`);
    assert.match(pruefeFehler(mitWarp(w)) ?? '', /warp/, `${name}: das Projekt mit diesem Warp ist ungültig`);
  }
  assert.equal(warpPruefung(null).grund, 'argument_ungueltig'); assert.equal(warpPruefung([]).grund, 'argument_ungueltig');
});

test('Grenzen, die noch gelten: 4096 Marker, genau 15 und genau 800 BPM, Transpose ±48 bei einem Modus mit Transpose gibt es noch keinen', () => {
  const w = gut(); w.marker = viele(MAX_MARKER); assert.equal(warpPruefung(w), null, '4096 Marker');
  const langsam = gut(); langsam.marker = [[0, 0], [4, 1]]; assert.equal(warpPruefung(langsam), null, '15 BPM');
  const schnell = gut(); schnell.marker = [[0, 0], [0.3, 4]]; assert.equal(Math.round(60 * 4 / 0.3), 800); assert.equal(warpPruefung(schnell), null, '800 BPM');
  const lang = gut(); lang.marker = [[0, 0], [1e7, 20_000_000 / 60 * 120]]; assert.equal(warpPruefung(lang)?.grund, 'warp_marker', 'beat über MAX_BEAT');
});
