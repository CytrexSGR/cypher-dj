// Paket 1.13 Warp, Slice 1: der Übersetzer schreibt cypherdj-arr/2 (das /2 von 1.10), wenn Routing ODER ein gewarpter Audio-Clip (an) vorkommt;
// sonst bleibt die Wiedergabe /1 Zeichen für Zeichen die bisherige. Marker: Clip-Beat der Kopie (Marker-Beat minus versatz_beats) und Quell-Frame (48 kHz).
import test from 'node:test';
import assert from 'node:assert/strict';
import { uebersetze, WiedergabeFehler, zaehleWarpMarker, MAX_WARP_PUNKTE } from '../projekt/wiedergabe.ts';
import { specProjekt, kopie, SHA_A } from './hilfen/projekt.mjs';

const opt = (extra = {}) => ({ nr: 1, audioOrdner: '/arbeit/arr/audio', frames: (sha) => (sha === SHA_A ? 2_000_000 : null), ...extra });
const warp = (extra = {}) => ({ an: true, modus: 'repitch', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0, ...extra });
const projekt = (w, clipExtra = {}) => {
  const p = kopie(specProjekt()); p.format = 'cypherdj-projekt/2';
  Object.assign(p.spuren[0].clips[0], { laenge_beats: 8, ...clipExtra }, w === null ? {} : { warp: w });
  return p;
};

test('ohne Warp bleibt die Wiedergabe /1 und identisch; mit Warp an wird sie /2 mit w in Clip-Beats und Quell-Frames', () => {
  const ohne = uebersetze(projekt(null), opt());
  assert.equal(ohne.format, 'cypherdj-arr/1'); assert.equal(JSON.stringify(ohne).includes('warp'), false);
  // N4-4: kein Vergleich mit sich selbst. Das bisherige /1-Projekt (ohne Warp-Feld, nur die Länge wie oben) ergibt dieselbe Wiedergabe,
  // und ein `warp: null` im /2-Projekt (kein Warp) ändert nichts an ihr: weiter /1, kein warp-Schlüssel.
  const alt = kopie(specProjekt()); alt.spuren[0].clips[0].laenge_beats = 8;
  assert.deepEqual(ohne, uebersetze(alt, opt()), 'Form unverändert: wie das Projekt ohne Warp-Feld');
  assert.deepEqual(uebersetze(projekt(null, { warp: null }), opt()), ohne, 'warp null = ohne Warp: weiter /1, gleiche Datei');
  const w = uebersetze(projekt(warp()), opt());
  assert.equal(w.format, 'cypherdj-arr/2');
  assert.deepEqual(w.gruppen, [], 'nur Warp, kein Routing: /2 mit leerer Gruppen-Liste');
  assert.equal('ausgang' in w.spuren[0], false);
  const c = w.spuren[0].clips[0];
  assert.deepEqual(c.warp, { modus: 0, w: [[0, 0], [8, 184320]] }, '3,84 s · 48 000 = 184 320 Frames');
  assert.equal(c.offset_frames, 0, 'gewarpt liest der Kern nicht über offset_frames');
  // Schärfung (Mutation 'offset immer aus offset_s' überlebte sonst): mit offset_s 0,5 bleibt offset_frames 0, die Quelle steht in den Markern
  assert.equal(uebersetze(projekt(warp(), { offset_s: 0.5 }), opt()).spuren[0].clips[0].offset_frames, 0);
  // Gegenprobe: derselbe Clip mit Warp aus ist /1 und liest über offset_s
  const aus = uebersetze(projekt(warp({ an: false }), { offset_s: 0.5 }), opt());
  assert.equal(aus.format, 'cypherdj-arr/1'); assert.equal(aus.spuren[0].clips[0].offset_frames, 24000); assert.equal('warp' in aus.spuren[0].clips[0], false);
});

test('Slice 2: complex wird Modus 2, tones Modus 3, repitch bleibt 0; ein gewarpter Clip in COMPLEX macht die Wiedergabe /2 wie RE-PITCH', () => {
  for (const [modus, nr] of [['repitch', 0], ['complex', 2], ['tones', 3]]) {
    const w = uebersetze(projekt(warp({ modus })), opt());
    assert.equal(w.format, 'cypherdj-arr/2'); assert.equal(w.spuren[0].clips[0].warp.modus, nr, modus);
    assert.deepEqual(w.spuren[0].clips[0].warp.w, [[0, 0], [8, 184320]], 'die Marker sind in jedem Modus dieselben');
  }
  const aus = uebersetze(projekt(warp({ modus: 'complex', an: false })), opt());
  assert.equal(aus.format, 'cypherdj-arr/1', 'Warp aus: weiter /1, auch bei COMPLEX');
});

test('versatz_beats verschiebt die Marker-Beats; jede Loop-Kopie beginnt wieder beim Versatz und trägt ihre eigene Liste', () => {
  const w = uebersetze(projekt(warp({ versatz_beats: 2 }), { laenge_beats: 6, loop_beats: 2 }), opt());
  const cs = w.spuren[0].clips;
  assert.equal(cs.length, 3);
  for (const c of cs) assert.deepEqual(c.warp.w, [[-2, 0], [6, 184320]], 'Beat 0 der Quelle liegt 2 Beats vor dem Kopienanfang');
  assert.deepEqual(cs.map((c) => c.start_beat), [0, 2, 4]);
  assert.notEqual(cs[0].warp.w, cs[1].warp.w, 'eigene Listen, kein gemeinsames Objekt');
});

test('Marker-Gesamtgrenze: zaehleWarpMarker zählt Kopien · Marker, der Übersetzer lehnt darüber ab (zu_gross)', () => {
  const viele = [...Array(4096)].map((_, i) => [i * 0.5, i]);
  const p = projekt(warp({ marker: viele }), { laenge_beats: 64, loop_beats: 1 });
  assert.equal(zaehleWarpMarker(p), 64 * 4096); assert.equal(MAX_WARP_PUNKTE, 262144);
  assert.equal(uebersetze(p, opt()).spuren[0].clips.length, 64, '64 · 4096 = genau die Grenze');
  const zu = projekt(warp({ marker: viele }), { laenge_beats: 65, loop_beats: 1 });
  assert.throws(() => uebersetze(zu, opt()), (e) => e instanceof WiedergabeFehler && e.grund === 'zu_gross');
  assert.equal(zaehleWarpMarker(projekt(warp({ an: false, marker: viele }), { laenge_beats: 65, loop_beats: 1 })), 0, 'aus zählt nicht');
});

test('Routing (1.10) und Warp in derselben /2-Datei: ausgang und gruppen wie bei 1.10, warp am Clip', () => {
  const p = projekt(warp());
  p.gruppen = [{ id: 'g1', nr: 3, name: 'Bus', farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false }];
  p.master = { fader_db: 0 };
  p.spuren[0].ausgang = { art: 'gruppe', id: 'g1' };
  const w = uebersetze(p, opt());
  assert.equal(w.format, 'cypherdj-arr/2');
  assert.deepEqual(w.gruppen, [{ nr: 3, ausgang: { art: 'master' } }]);
  assert.deepEqual(w.spuren[0].ausgang, { art: 'gruppe', nr: 3 });
  assert.deepEqual(w.spuren[0].clips[0].warp, { modus: 0, w: [[0, 0], [8, 184320]] });
  // Gegenprobe: dasselbe Routing mit Warp aus ist weiter /2 (wegen des Routings), der Clip ohne warp
  p.spuren[0].clips[0].warp.an = false;
  const aus = uebersetze(p, opt());
  assert.equal(aus.format, 'cypherdj-arr/2'); assert.equal('warp' in aus.spuren[0].clips[0], false);
});

test('Slice 4: beats-Clip trägt modus 1, e (um versatz verschoben, Frames), loop, huelle', () => {
  const p = projekt(warp({ modus: 'beats', versatz_beats: 1, beats: { raster: '1/4', loop: 'vor_zurueck', huelle: 60 } }), { laenge_beats: 3 });
  const c = uebersetze(p, opt()).spuren[0].clips[0];
  assert.equal(c.warp.modus, 1);
  assert.deepEqual(c.warp.e.map((x) => x[0]), [0, 1, 2]);                  // Beats 1, 2, 3 minus versatz 1
  assert.equal(c.warp.e[0][1], 23040);                                    // Beat 1 bei 125 BPM = 0,48 s
  assert.equal(c.warp.loop, 2);
  assert.equal(c.warp.huelle, 60);
});
test('Slice 4: Einheiten zählen in MAX_WARP_PUNKTE', () => {
  const p = projekt(warp({ modus: 'beats', beats: { raster: '1/4', loop: 'aus', huelle: 100 } }), { laenge_beats: 4 });
  assert.equal(zaehleWarpMarker(p), 2 + 4);
});
test('Negativ-Kontrolle: complex-Clip hat kein e', () => {
  const c = uebersetze(projekt(warp({ modus: 'complex' })), opt()).spuren[0].clips[0];
  assert.equal('e' in c.warp, false);
  assert.equal('loop' in c.warp, false);
  assert.equal('huelle' in c.warp, false);
});
test('Slice 4 D9: zu viele Einheiten lehnt uebersetze mit beats_einheiten ab, zaehleWarpMarker wirft nie', () => {
  const p = projekt(warp({ modus: 'beats', beats: { raster: '1/32', loop: 'aus', huelle: 100 } }), { laenge_beats: 4200 });
  assert.ok(zaehleWarpMarker(p) > 2);
  assert.throws(() => uebersetze(p, opt()), (e) => e instanceof WiedergabeFehler && e.grund === 'beats_einheiten');
});

// --- Fix nach Review (T1 bis T3) ---
const beatsClip = (beats, extra = {}, w = {}) => projekt(warp({ modus: 'beats', beats, ...w }), extra);
const B4 = { raster: '1/4', loop: 'aus', huelle: 100 };

test('Review 5: Loop-Clip rechnet die Einheiten über loop_beats, nicht über laenge_beats', () => {
  const c = uebersetze(beatsClip(B4, { laenge_beats: 8, loop_beats: 2 }), opt()).spuren[0].clips;
  assert.equal(c.length, 4);
  assert.deepEqual(c[0].warp.e.map((x) => x[0]), [0, 1]);
});
test('Review 5: zaehleWarpMarker zählt die Kopien (k > 1)', () => {
  assert.equal(zaehleWarpMarker(beatsClip(B4, { laenge_beats: 8, loop_beats: 2 })), (2 + 2) * 4);
});
test('Review 5: Transienten kommen über die Option in e', () => {
  const o = opt({ transienten: (sha) => (sha === SHA_A ? [0.48, 0.96] : null) });
  const c = uebersetze(beatsClip({ raster: 'transienten', loop: 'aus', huelle: 100 }, { laenge_beats: 4 }), o).spuren[0].clips[0];
  // D12 umgerechnet: Quelle s − 0,003 s: 0,477 s = 22 896 Frames, 0,957 s = 45 936 Frames; Beat = s / 0,48 (125 BPM): 0,99375 und 1,99375 (vorher 1/23 040 und 2/46 080)
  assert.deepEqual(c.warp.e.map((x) => x[1]), [0, 22896, 45936]);
  [0, 0.99375, 1.99375].forEach((b, i) => assert.ok(Math.abs(c.warp.e[i][0] - b) < 1e-9, `Beat ${i}: ${c.warp.e[i][0]}`));
  assert.equal(zaehleWarpMarker(beatsClip({ raster: 'transienten', loop: 'aus', huelle: 100 }, { laenge_beats: 4 }), o), 2 + 3);
});
test('Review 5: loop aus, vor, vor_zurueck werden 0, 1, 2', () => {
  for (const [name, nr] of [['aus', 0], ['vor', 1], ['vor_zurueck', 2]]) {
    assert.equal(uebersetze(beatsClip({ raster: '1/4', loop: name, huelle: 100 }, { laenge_beats: 2 }), opt()).spuren[0].clips[0].warp.loop, nr, name);
  }
});
test('Review 5: Grenze genau: 32 768 Einheiten gehen, 32 769 lehnen ab', () => {
  const gross = opt({ frames: () => 4_000_000_000 });
  const b = { raster: '1/32', loop: 'aus', huelle: 100 };
  const ok = uebersetze(beatsClip(b, { laenge_beats: 4096 }), gross).spuren[0].clips[0];
  assert.equal(ok.warp.e.length, 32768);
  assert.throws(() => uebersetze(beatsClip(b, { laenge_beats: 4096.125 }), gross), (e) => e instanceof WiedergabeFehler && e.grund === 'beats_einheiten');
});
test('Review 2: nahe Transienten ergeben nach dem Runden streng steigende Frames', () => {
  const o = opt({ transienten: () => [0.5, 0.500001, 0.96] });
  const e = uebersetze(beatsClip({ raster: 'transienten', loop: 'aus', huelle: 100 }, { laenge_beats: 4 }), o).spuren[0].clips[0].warp.e;
  // D12 umgerechnet: 0,5 s → 0,497 s = 23 856 Frames; 0,500001 s liegt 1 µs dahinter, sein Vorlauf ist die Hälfte (0,5 µs) → 0,5000005 s = 24 000 Frames; 0,96 s → 45 936
  assert.deepEqual(e.map((x) => x[1]), [0, 23856, 24000, 45936]);
  for (let i = 1; i < e.length; i++) assert.ok(e[i][1] > e[i - 1][1] && e[i][0] > e[i - 1][0]);
  // zwei Einheiten, die nach dem Runden auf demselben Frame landen, werden eine (vorher stand das im Fall oben)
  const e2 = uebersetze(beatsClip({ raster: 'transienten', loop: 'aus', huelle: 100 }, { laenge_beats: 4 }), opt({ transienten: () => [1e-7, 0.96] })).spuren[0].clips[0].warp.e;
  assert.deepEqual(e2.map((x) => x[1]), [0, 45936]);
});
test('Review 2: Einheiten ab dem Quellende fallen weg, mindestens eine bleibt', () => {
  const kurz = opt({ frames: () => 30_000 });   // 0,625 s
  const e = uebersetze(beatsClip(B4, { laenge_beats: 4 }), kurz).spuren[0].clips[0].warp.e;
  assert.deepEqual(e, [[0, 0], [1, 23040]]);
  const winzig = opt({ frames: () => 10 });
  const e2 = uebersetze(beatsClip(B4, { laenge_beats: 4 }, { versatz_beats: 2 }), winzig).spuren[0].clips[0].warp.e;
  assert.equal(e2.length, 1);
  assert.ok(e2[0][1] < 10);
});
