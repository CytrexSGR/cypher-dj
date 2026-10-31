import test from 'node:test';
import assert from 'node:assert/strict';
import { tempoSkalieren, markerAendern, abHierGerade, einsHier, fensterTempo, abHierStart, WarpFehler } from '../projekt/warp.ts';

const warp = (marker, extra = {}) => ({ an: true, modus: 'complex', marker, versatz_beats: 0, quelle: 'werkstatt', transpose_st: 0, detune_ct: 0, ...extra });
const gerade = () => warp([[0, 0], [30, 64]]);                 // 128 BPM
const fehler = (f, grund) => assert.throws(f, (e) => e instanceof WarpFehler && e.grund === grund, `erwartet ${grund}`);

test('tempoSkalieren: Beats und Versatz mal Faktor, Quellzeiten bleiben, quelle hand; Original unverändert; falscher Faktor lehnt ab', () => {
  const w = warp([[0, 0], [2, 4], [4, 8]], { versatz_beats: 3, eins_unsicher: true });
  const z = tempoSkalieren(w, 2);
  assert.deepEqual(z.marker, [[0, 0], [2, 8], [4, 16]]); assert.equal(z.versatz_beats, 6); assert.equal(z.quelle, 'hand'); assert.equal(z.eins_unsicher, true);
  assert.deepEqual(w.marker, [[0, 0], [2, 4], [4, 8]], 'das Argument bleibt unberührt'); assert.equal(w.quelle, 'werkstatt');
  assert.deepEqual(tempoSkalieren(z, 0.5).marker, w.marker, ':2 nach ×2 ist exakt der Ausgangszustand');
  for (const f of [1, 3, 0, -2, '2', NaN]) fehler(() => tempoSkalieren(w, f), 'argument_ungueltig');
});

test('markerAendern: setzen (mit und ohne beat), löschen, verschieben (beat bleibt / quelle bleibt); Reihenfolge löschen → verschieben → setzen', () => {
  const m = [[0, 0], [2, 4], [4, 8]];
  assert.deepEqual(markerAendern(m, { setze: [{ quell_s: 1, beat: 2 }] }), [[0, 0], [1, 2], [2, 4], [4, 8]]);
  assert.deepEqual(markerAendern(m, { setze: [{ quell_s: 1 }] }), [[0, 0], [1, 2], [2, 4], [4, 8]], 'ohne beat: der Beat, den das Raster dort hat (Klang unverändert)');
  assert.deepEqual(markerAendern(m, { setze: [{ quell_s: 3 }] }), [[0, 0], [2, 4], [3, 6], [4, 8]]);
  assert.deepEqual(markerAendern(m, { loesche: [4] }), [[0, 0], [4, 8]]);
  assert.deepEqual(markerAendern(m, { verschiebe: [{ beat: 4, neu_quell_s: 2.5 }] }), [[0, 0], [2.5, 4], [4, 8]], 'Beat bleibt, Quellzeit wandert');
  assert.deepEqual(markerAendern(m, { verschiebe: [{ beat: 4, neu_beat: 5 }] }), [[0, 0], [2, 5], [4, 8]], 'Quellzeit bleibt, Beat wandert');
  assert.deepEqual(markerAendern(m, { loesche: [4], setze: [{ quell_s: 2.5, beat: 4 }] }), [[0, 0], [2.5, 4], [4, 8]]);
  assert.deepEqual(m, [[0, 0], [2, 4], [4, 8]], 'das Argument bleibt unberührt');
});

test('markerAendern: unbekannter Beat, löschen und verschieben desselben Markers, beide oder keins von neu_beat/neu_quell_s lehnen ab', () => {
  const m = [[0, 0], [2, 4], [4, 8]];
  fehler(() => markerAendern(m, { loesche: [5] }), 'marker_unbekannt');
  fehler(() => markerAendern(m, { verschiebe: [{ beat: 5, neu_beat: 6 }] }), 'marker_unbekannt');
  fehler(() => markerAendern(m, { loesche: [4], verschiebe: [{ beat: 4, neu_beat: 5 }] }), 'marker_unbekannt');
  fehler(() => markerAendern(m, { verschiebe: [{ beat: 4 }] }), 'argument_ungueltig');
  fehler(() => markerAendern(m, { verschiebe: [{ beat: 4, neu_beat: 5, neu_quell_s: 3 }] }), 'argument_ungueltig');
  assert.deepEqual(markerAendern(m, { loesche: [4 + 1e-7] }), [[0, 0], [4, 8]], 'Positivkontrolle: 1e-7 daneben gilt noch als derselbe Beat');
});

test('abHierGerade: ab dem Beat ein Segment mit dem Tempo dort bis zur letzten Quellzeit; hinter dem letzten Marker null', () => {
  const m = [[0, 0], [1, 2], [2, 3], [3, 5]];                  // Segmente: 120, 60, 120 BPM
  const g = abHierGerade(m, 2);                                // Marker 1 liegt auf Beat 2; das Segment, das dort beginnt, hat 60 BPM
  assert.deepEqual(g, [[0, 0], [1, 2], [3, 2 + 2 * 60 / 60]], 'Tempo des Segments, das bei Beat 2 beginnt: 60');
  const mitte = abHierGerade(m, 2.5);                          // zwischen Marker (1,2) und (2,3): Tempo 60 BPM; Quellzeit dort 1,5
  assert.deepEqual(mitte, [[0, 0], [1, 2], [1.5, 2.5], [3, 2.5 + 1.5 * 60 / 60]]);
  assert.equal(abHierGerade(m, 5), null); assert.equal(abHierGerade(m, 9), null);
  assert.deepEqual(abHierGerade(m, 0), [[0, 0], [3, 3 * 120 / 60]], 'ab Beat 0: alles gerade (Segment 0 hat 120 BPM)');
});

test('einsHier: die Stelle wird Beat 0, der Klang bleibt (W vorher = W nachher bei verschobenem Beat), eins_unsicher false, quelle hand', () => {
  const w = warp([[0.5, -2], [1, -1], [1.5, 0], [2, 1]], { eins_unsicher: true });
  const e = einsHier(w, 2);
  assert.equal(e.verschoben, 1); assert.deepEqual(e.warp.marker, [[0.5, -3], [1, -2], [1.5, -1], [2, 0]]);
  assert.equal(e.warp.eins_unsicher, false); assert.equal(e.warp.quelle, 'hand');
  const mitte = einsHier(w, 1.75);                             // zwischen Schlägen: Beat 0,5 (Stelle exakt), kein Runden auf den Schlag
  assert.equal(mitte.verschoben, 0.5);
  const nah = einsHier(w, 2 + 1e-8);                           // 1e-8 s daneben: gilt als der Schlag
  assert.equal(nah.verschoben, 1);
  assert.deepEqual(w.marker, [[0.5, -2], [1, -1], [1.5, 0], [2, 1]], 'das Argument bleibt unberührt');
});

test('fensterTempo: Gerade = ihr Tempo; Karte mit Schwankung = Mittel über das gespielte Fenster, nicht das Segment am Anfang', () => {
  assert.equal(fensterTempo(gerade(), 64), 128);
  const w = warp([[0, 0], [1, 2], [2, 3], [3, 5]]);           // 120, 60, 120: 5 Beats in 3 s = 100 BPM
  assert.equal(fensterTempo(w, 5), 100);
  assert.equal(fensterTempo(w, 2), 120, 'Fenster Beat 0..2 ist die erste Sekunde: 2 Beats in 1 s');
  assert.equal(fensterTempo({ ...w, versatz_beats: 2 }, 3), 90, 'Fenster Beat 2..5: 3 Beats in 2 s');
});

test('abHierStart: links bleibt, rechts der Auto-Warp mit dem Beat des Clips an der Anschlussstelle; ohne Auto-Marker dahinter null', () => {
  const m = [[0, 0], [1, 2], [2, 4]];                          // 120 BPM
  const auto = [[0.5, 0], [1.5, 2], [2.5, 4], [3.5, 6]];       // 120 BPM, Phase 0,5 s später
  const r = abHierStart(m, 2, auto);                           // Beat 2 = Quellzeit 1,0; auto hat dort Beat 1; Verschiebung d = 1
  assert.deepEqual(r, [[0, 0], [1, 2], [1.5, 3], [2.5, 5], [3.5, 7]]);
  assert.equal(abHierStart(m, 2, [[0, 0], [0.5, 1]]), null);
  assert.equal(abHierStart(m, 2, [[3, 0]]), null, 'weniger als zwei Auto-Marker');
});

test('EPS_BEAT: ein Beat 2e-6 daneben ist kein Marker mehr (Negativkontrolle); einsHier knapp unter einem ganzen Beat (2 − 1e-8 s) rundet auf ihn', () => {
  const m = [[0, 0], [2, 4], [4, 8]];
  fehler(() => markerAendern(m, { loesche: [4 + 2e-6] }), 'marker_unbekannt');
  const w = warp([[0.5, -2], [1, -1], [1.5, 0], [2, 1]]);
  assert.equal(einsHier(w, 2 - 1e-8).verschoben, 1, 'knapp darunter gilt als der Schlag (Math.round, nicht floor)');
  assert.notEqual(einsHier(w, 2 - 1e-5).verschoben, 1, 'Negativkontrolle: 1e-5 s darunter (2e-5 Beat) ist kein Schlag mehr');
});
