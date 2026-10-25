// Paket 1.13 Warp, Slice 1: die Abbildung W(b) in TypeScript (Server) und JavaScript (Seite) gegen die gemeinsame Referenzdatei
// vertrag/warp_referenz.json (1000 Fälle, exakt gerechnet von vertrag/erzeuge_warp_referenz.py). Dazu die Umkehrung, das Segment-Tempo
// und der Auto-Warp. Das C++-Gegenstück ist kern/tests/test_warp_abbildung.cpp (dieselbe Datei).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from '../projekt/warp.ts';
import * as js from '../oeffentlich/produktion/warp.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(fs.readFileSync(path.join(HIER, '..', '..', 'vertrag', 'warp_referenz.json'), 'utf8'));
const nah = (ist, soll, rel) => Math.abs(ist - soll) <= rel * Math.max(1, Math.abs(soll));

test('Referenzdatei: 1000 Fälle, TS und JS rechnen W(b) auf 1e-12 gleich', () => {
  assert.equal(REF.faelle.length, 1000);
  let aussen = 0, auf = 0;
  for (const f of REF.faelle) {
    for (const impl of [ts, js]) assert.ok(nah(impl.quellSekunde(f.marker, f.beat), f.quell_s, REF.toleranz_relativ), `${f.beat}`);
    if (f.beat < f.marker[0][1] || f.beat > f.marker.at(-1)[1]) aussen++;
    if (f.marker.some((m) => m[1] === f.beat)) auf++;
  }
  assert.ok(aussen > 100 && auf > 100, `die Datei trägt Randsegment- (${aussen}) und Marker-Fälle (${auf})`);
});

test('Gegenprobe der Messung: eine falsche Abbildung fällt an der Datei durch (konstantes Tempo statt Marker)', () => {
  const grob = (marker, b) => marker[0][0] + (b - marker[0][1]) * (marker.at(-1)[0] - marker[0][0]) / (marker.at(-1)[1] - marker[0][1]);
  const daneben = REF.faelle.filter((f) => !nah(grob(f.marker, f.beat), f.quell_s, REF.toleranz_relativ)).length;
  assert.ok(daneben > 300, `${daneben} Fälle sind von der Geraden verschieden`);
});

test('W: zwei Marker, Randsegmente, Umkehrung, Segment-Tempo', () => {
  const m = [[0, 0], [3.84, 8]];                       // 125 BPM: 8 Beats in 3,84 s
  for (const impl of [ts, js]) {
    assert.equal(impl.quellSekunde(m, 0), 0);
    assert.equal(impl.quellSekunde(m, 8), 3.84);
    assert.ok(nah(impl.quellSekunde(m, 4), 1.92, 1e-15));
    assert.ok(nah(impl.quellSekunde(m, -2), -0.96, 1e-15), 'vor dem ersten Marker gilt das Randtempo');
    assert.ok(nah(impl.quellSekunde(m, 10), 4.8, 1e-15), 'hinter dem letzten auch');
    assert.ok(nah(impl.beatBeiQuelle(m, 1.92), 4, 1e-15));
    assert.ok(nah(impl.segmentBpm(m, 0), 125, 1e-12));
    const drei = [[0, 0], [2, 4], [3, 8]];             // 120 BPM, dann 240 BPM
    assert.ok(nah(impl.segmentBpm(drei, 0), 120, 1e-12) && nah(impl.segmentBpm(drei, 1), 240, 1e-12));
    assert.ok(nah(impl.quellSekunde(drei, 6), 2.5, 1e-15));
    assert.ok(nah(impl.beatBeiQuelle(drei, 2.5), 6, 1e-15));
    for (let b = -3; b <= 11; b += 0.37) assert.ok(nah(impl.beatBeiQuelle(drei, impl.quellSekunde(drei, b)), b, 1e-12), `Umkehrung bei ${b}`);
  }
});

const loop = (extra = {}) => ({ typ: 'loop', bpm: null, takte: null, dauer_s: null, ...extra });
test('Auto-Warp: Loop mit Takten, Track mit BPM, One-Shot nie, ohne Tempo ein Hinweis', () => {
  const l = ts.autoWarp(loop({ takte: 2, dauer_s: 3.84, bpm: 125 }));
  assert.deepEqual(l, { warp: { an: true, modus: 'repitch', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0 }, laenge_beats: 8 });
  const t = ts.autoWarp({ typ: 'track', bpm: 128, takte: null, dauer_s: 300 });
  assert.equal(t.warp.quelle, 'mediathek'); assert.equal(t.warp.eins_unsicher, true);
  assert.deepEqual(t.warp.marker, [[0, 0], [300, 640]]); assert.equal(t.laenge_beats, 640);
  const lb = ts.autoWarp(loop({ bpm: 120, dauer_s: 8 }));                          // Loop nur mit BPM: Anfang = Eins, nicht unsicher
  assert.equal(lb.warp.quelle, 'mediathek'); assert.equal('eins_unsicher' in lb.warp, false); assert.equal(lb.laenge_beats, 16);
  assert.equal(ts.autoWarp({ typ: 'oneshot', bpm: 100, takte: null, dauer_s: 0.4 }), null, 'One-Shot: nie');
  assert.equal(ts.autoWarp({ typ: 'impuls', bpm: 100, takte: null, dauer_s: 0.4 }), null);
  assert.deepEqual(ts.autoWarp(loop({ dauer_s: 4 })), { hinweis: 'kein_tempo' });
  assert.deepEqual(ts.autoWarp(loop({ bpm: 120 })), { hinweis: 'kein_tempo' }, 'ohne Dauer nicht rechenbar');
  assert.deepEqual(ts.autoWarp(loop({ bpm: 5, dauer_s: 10 })), { hinweis: 'kein_tempo' }, 'Segment-Tempo unter 15 BPM');
  assert.deepEqual(ts.autoWarp(loop({ bpm: 900, dauer_s: 10 })), { hinweis: 'kein_tempo' }, 'über 800 BPM');
  // takte und BPM passen nicht zur Dauer (Anhang am Ende): die BPM gewinnt, die Länge folgt der Dauer
  const anhang = ts.autoWarp(loop({ takte: 2, bpm: 125, dauer_s: 5.0 }));
  assert.equal(anhang.warp.quelle, 'mediathek'); assert.ok(nah(anhang.laenge_beats, 5.0 * 125 / 60, 1e-12));
  // Grenze der Halb-Beat-Toleranz (Zusatz gegenüber dem Plan, schließt die Mutation 0,5 → 0,01 und 0,5 → 0,9): 8,125 Beats gegen 8 → takte, 8,54 → mediathek
  assert.equal(ts.autoWarp(loop({ takte: 2, bpm: 125, dauer_s: 3.9 })).warp.quelle, 'takte', 'Abstand 0,125 Beat: Takte gelten');
  assert.equal(ts.autoWarp(loop({ takte: 2, bpm: 125, dauer_s: 4.1 })).warp.quelle, 'mediathek', 'Abstand 0,54 Beat: BPM gilt');
  // takte ohne BPM: Takte gelten
  assert.equal(ts.autoWarp(loop({ takte: 4, dauer_s: 7.5 })).warp.quelle, 'takte');
});

test('warpAnzeige: Schalter, Herkunft, downbeat?, Tempo des ersten Segments', () => {
  const clip = { art: 'audio', warp: { an: true, modus: 'repitch', quelle: 'mediathek', eins_unsicher: true, marker: [[0, 0], [3.84, 8]] } };
  assert.deepEqual(js.warpAnzeige(clip), { vorhanden: true, an: true, modus: 'RE-PITCH', herkunft: 'from library BPM', downbeatFrage: true, bpm: 125 });
  assert.deepEqual(js.warpAnzeige({ art: 'audio' }), { vorhanden: false, an: false, modus: '', herkunft: '', downbeatFrage: false, bpm: null });
  assert.equal(js.warpAn(clip), true); assert.equal(js.warpAn({ art: 'audio', warp: { ...clip.warp, an: false } }), false); assert.equal(js.warpAn({ art: 'midi' }), false);
});
