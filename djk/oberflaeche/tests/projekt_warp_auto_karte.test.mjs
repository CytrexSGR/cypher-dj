// Paket 1.13 Warp, Slice 3a (Task 2): autoWarp mit Werkstatt-Karte. Alle Schläge als Marker, Beat 0 = erste Eins, Länge aus der Karte (Eins bis Dateiende),
// eins_unsicher durchgereicht; unbrauchbare Karten (zu viele Marker, Segment außerhalb 15..800 BPM, nicht steigend) fallen auf die nächste Quelle mit einem
// karten_hinweis zurück; One-Shot nie; die Karte schlägt takte und mediathek.
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoWarp, beatBeiQuelle } from '../projekt/warp.ts';
import { warpPruefung, MAX_MARKER } from '../projekt/modell.ts';
import { karteLinear } from './hilfen/karte.mjs';

const mk = (marker, unsicher = false) => ({ marker, eins_unsicher: unsicher });
const track = (karte, extra = {}) => ({ typ: 'track', bpm: 120, takte: null, dauer_s: 25, karte, ...extra });
const eins2 = karteLinear(40).map(([s, b]) => [s, b - 2]);   // Karte von 0,5 s an, Eins bei Karten-Beat 2 (= 1,5 s)

test('Karte: alle Schläge werden Marker, quelle werkstatt, COMPLEX, versatz 0; Länge = Eins bis Dateiende (Randsegment), die Prüfung des Modells nimmt es an', () => {
  const r = autoWarp(track(mk(eins2, true)));
  assert.equal('warp' in r, true);
  assert.equal(r.warp.quelle, 'werkstatt'); assert.equal(r.warp.modus, 'complex'); assert.equal(r.warp.versatz_beats, 0);
  assert.equal(r.warp.eins_unsicher, true);
  assert.equal(r.warp.marker.length, 40); assert.deepEqual(r.warp.marker[2], [1.5, 0]);
  assert.equal(r.laenge_beats, beatBeiQuelle(eins2, 25));
  assert.equal(r.laenge_beats, 47);   // letzter Marker (20 s, Beat 37), dahinter 2 Beats je Sekunde: 37 + 5 · 2
  assert.equal(r.karten_hinweis, undefined);
  assert.equal(warpPruefung(r.warp), null, 'was autoWarp baut, nimmt das Modell an');
  assert.equal('eins_unsicher' in autoWarp(track(mk(eins2, false))).warp, false, 'sicher: das Feld fehlt (wie bei den anderen Quellen)');
});

test('Die Karte schlägt takte und mediathek; ohne Karte gilt wieder die alte Reihenfolge (Negativ-Kontrolle)', () => {
  assert.equal(autoWarp(track(mk(eins2), { takte: 12 })).warp.quelle, 'werkstatt');
  assert.equal(autoWarp(track(null, { takte: null })).warp.quelle, 'mediathek');
  assert.equal(autoWarp({ typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, karte: null }).warp.quelle, 'takte');
});

test('One-Shot nie, auch mit Karte; Dauer fehlt: kein_tempo', () => {
  assert.equal(autoWarp({ typ: 'oneshot', bpm: null, takte: null, dauer_s: 0.5, karte: mk(eins2) }), null);
  assert.deepEqual(autoWarp(track(mk(eins2), { dauer_s: null })), { hinweis: 'kein_tempo' });
});

test('Unbrauchbare Karte fällt auf die nächste Quelle zurück, mit Grund (nie still kürzen)', () => {
  const zuViele = karteLinear(MAX_MARKER + 1, { t0: 0, bpm: 600 });                 // 4097 Marker, Segment 600 BPM (gültig)
  const a = autoWarp(track(mk(zuViele), { dauer_s: 500 }));
  assert.equal(a.warp.quelle, 'mediathek'); assert.equal(a.karten_hinweis, 'karte_zu_gross');
  const genau = autoWarp(track(mk(karteLinear(MAX_MARKER, { t0: 0, bpm: 600 })), { dauer_s: 500 }));
  assert.equal(genau.warp.quelle, 'werkstatt', 'Positivkontrolle: genau 4096 Marker gelten');
  const ausreisser = karteLinear(40);
  ausreisser[20][0] = ausreisser[19][0] + 0.0501;                                          // ein Ausreißer-Schlag: Segment 19→20 mit 1197 BPM, danach wieder 63 BPM
  const b = autoWarp(track(mk(ausreisser)));
  assert.equal(b.warp.quelle, 'mediathek'); assert.equal(b.karten_hinweis, 'karte_unbrauchbar');
  const fallend = karteLinear(40); fallend[10][0] = fallend[9][0];
  assert.equal(autoWarp(track(mk(fallend))).karten_hinweis, 'karte_unbrauchbar');
  const ohneAlt = autoWarp(track(mk(fallend), { bpm: null }));
  assert.deepEqual(ohneAlt, { hinweis: 'kein_tempo' }, 'keine andere Quelle: kein Tempo');
});

test('Segment-Tempo der Karte: 15,5 und 799 BPM gelten, 14,5 und 801 BPM nicht (die Karte ist die einzige Quelle: kein_tempo)', () => {
  // die Kanten 15 und 800 selbst prüft projekt_warp_modell.test.mjs am Modell; hier zählt die Seite des Auto-Warps (Zahlen aus 1e-6-gerundeten Zeiten, darum nicht exakt auf der Kante)
  assert.equal('warp' in autoWarp(track(mk(karteLinear(30, { t0: 0, bpm: 799 })), { dauer_s: 20, bpm: null })), true);
  assert.equal('warp' in autoWarp(track(mk(karteLinear(30, { t0: 0, bpm: 15.5 })), { dauer_s: 200, bpm: null })), true);
  assert.equal(autoWarp(track(mk(karteLinear(30, { t0: 0, bpm: 801 })), { dauer_s: 20, bpm: null })).hinweis, 'kein_tempo');
  assert.equal(autoWarp(track(mk(karteLinear(30, { t0: 0, bpm: 14.5 })), { dauer_s: 200, bpm: null })).hinweis, 'kein_tempo');
});

test('tempo_vielfaches 2 (Beats 0, 2, 4 …, Segment 140 BPM): geht als Karte durch, die Länge zählt in Karten-Beats', () => {
  const k = karteLinear(30, { t0: 0.2, bpm: 140, schritt: 2 }).map(([s, b]) => [s, b - 2]);
  const r = autoWarp(track(mk(k), { dauer_s: 30 }));
  assert.equal(r.warp.quelle, 'werkstatt'); assert.equal(r.warp.marker[1][1], 0);
});

const traktor = (anker_s, bpm) => ({ anker_s, bpm });
test('Traktor: zwei Marker, Beat 0 am Anker, n volle Beats bis zur Dateilänge, immer eins_unsicher; schlägt takte und mediathek, verliert gegen die Karte', () => {
  const r = autoWarp({ typ: 'track', bpm: 124, takte: null, dauer_s: 300, traktor: traktor(0.0575918, 128) });
  assert.equal(r.warp.quelle, 'traktor'); assert.equal(r.warp.eins_unsicher, true); assert.equal(r.warp.modus, 'complex');
  const n = Math.floor((300 - 0.0575918) * 128 / 60);
  assert.deepEqual(r.warp.marker, [[0.0575918, 0], [0.0575918 + n * 60 / 128, n]]);
  assert.equal(r.laenge_beats, beatBeiQuelle(r.warp.marker, 300)); assert.ok(r.laenge_beats >= n && r.laenge_beats < n + 1);
  assert.equal(warpPruefung(r.warp), null);
  assert.equal(autoWarp({ typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, traktor: traktor(0, 125) }).warp.quelle, 'traktor', 'Traktor vor takte');
  assert.equal(autoWarp({ typ: 'track', bpm: 124, takte: null, dauer_s: 300, traktor: traktor(0.1, 128), karte: mk(karteLinear(40)) }).warp.quelle, 'werkstatt', 'Karte vor Traktor');
  assert.equal(autoWarp({ typ: 'track', bpm: 124, takte: null, dauer_s: 300, traktor: null }).warp.quelle, 'mediathek', 'Negativ-Kontrolle: ohne Raster gilt die BPM');
});
test('Traktor unbrauchbar (Anker hinter der Datei, BPM außerhalb 15..800, weniger als ein Beat) fällt auf die nächste Quelle; Drum-Loop bleibt RE-PITCH', () => {
  for (const t of [traktor(400, 128), traktor(-1, 128), traktor(0, 900), traktor(0, 10), traktor(299.9, 128), traktor(Number.NaN, 128)]) {
    assert.equal(autoWarp({ typ: 'track', bpm: 124, takte: null, dauer_s: 300, traktor: t }).warp.quelle, 'mediathek', JSON.stringify(t));
  }
  assert.equal(autoWarp({ typ: 'loop', instrument: 'kick', bpm: null, takte: null, dauer_s: 3.84, traktor: traktor(0, 125) }).warp.modus, 'repitch');
  const mitHinweis = autoWarp({ typ: 'track', bpm: null, takte: null, dauer_s: 300, karte: mk(karteLinear(40).map(([s, b]) => [s, b === 10 ? 9 : b])), traktor: traktor(0.1, 128) });
  assert.equal(mitHinweis.warp.quelle, 'traktor'); assert.equal(mitHinweis.karten_hinweis, 'karte_unbrauchbar');
});

test('D5 (Slice 3b): ein Clip mit Auto-Warp aus der Karte bekommt COMPLEX, auch ein Drum-Loop; ohne Karte bleibt es bei D10 (Drum-Loop RE-PITCH); eine unbrauchbare Karte fällt auf die Regel der nächsten Quelle', () => {
  const loop = (extra = {}) => ({ typ: 'loop', instrument: 'kick', bpm: 125, takte: 2, dauer_s: 3.84, ...extra });
  assert.equal(autoWarp(loop({ karte: mk(eins2) })).warp.modus, 'complex', 'Fehlerfall von vorher: ein Drum-Loop mit Karte landete in repitch');
  assert.equal(autoWarp(loop()).warp.modus, 'repitch', 'Negativkontrolle: ohne Karte gilt D10 unverändert');
  assert.equal(autoWarp(track(mk(eins2))).warp.modus, 'complex');
  const kaputt = autoWarp(loop({ karte: mk([[0, 0], [0, 1]]) }));
  assert.deepEqual([kaputt.warp.quelle, kaputt.warp.modus, kaputt.karten_hinweis], ['takte', 'repitch', 'karte_unbrauchbar'], 'unbrauchbare Karte: die nächste Quelle mit ihrer Regel');
});
