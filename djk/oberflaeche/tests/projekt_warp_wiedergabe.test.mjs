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
