// 4.2: loop passes of a MIDI recording become take lanes (replace mode); overdub keeps the old behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { midiDurchlaufZahlen, nehmeMidiAuf } from '../project/recording.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, pruefeFehler, sucheSpur } from '../project/model.ts';

const BPM = 120, START = 1_000_000, BEAT = 24000;
const an = (beat, ton = 60) => ({ sample: START + beat * BEAT, status: 0x90, d1: ton, d2: 100 });
const aus = (beat, ton = 60) => ({ sample: START + beat * BEAT, status: 0x80, d1: ton, d2: 0 });
const LOOP = { von_beat: 0, bis_beat: 4 };
function projekt() {
  let p = fuehreListeAus(neuesProjekt('T'), [{ befehl: 'spur_neu', art: 'instrument', name: 'Keys' }]).projekt;
  return { p, sid: p.spuren[0].id };
}
function nimm(p, sid, ereignisse, extra = {}) {
  const startBeat = extra.startBeat ?? 0;
  return nehmeMidiAuf(p, { spurIds: [sid], startBeat, bpm: BPM, startSample: START + startBeat * BEAT, ereignisse, versatzSamples: 0, overdub: false,
    endeBeat: 14, name: 'Take 1', loop: LOOP, ...extra });
}
const lanes = (p, sid) => (sucheSpur(p, sid).takes ?? []).filter((t) => t.art === undefined);
const abs = (clips) => clips.flatMap((c) => c.noten.map((n) => [c.start_beat + n.beat, n.laenge, n.ton])).sort((a, b) => a[0] - b[0]);
// pass k (unrolled) has a note of pitch 60 + k at its project beat 1, length 1
const passEv = (k, L = 4) => [an(k * L + 1, 60 + k), aus(k * L + 2, 60 + k)];

test('3 full passes and a partial 4th: 4 take lanes, main = pass 3', () => {
  const { p, sid } = projekt();
  const n = nimm(p, sid, [0, 1, 2, 3].flatMap((k) => passEv(k)));
  assert.equal(lanes(n, sid).length, 4);
  assert.deepEqual(lanes(n, sid).map((t) => t.name), ['Take 1', 'Take 2', 'Take 3', 'Take 4']);
  assert.deepEqual(lanes(n, sid).map((t) => abs(t.clips)[0][2]), [60, 61, 62, 63]);
  assert.deepEqual(lanes(n, sid).map((t) => [t.clips[0].start_beat, t.clips[0].laenge_beats]), [[0, 4], [0, 4], [0, 4], [0, 2]]);
  assert.deepEqual(sucheSpur(n, sid).clips.map((c) => [c.start_beat, c.laenge_beats]), [[0, 4]]);
  assert.deepEqual(abs(sucheSpur(n, sid).clips), [[1, 1, 62]], 'main = pass 3, the last complete one');
  assert.equal(pruefeFehler(n), null);
  const ids = [...sucheSpur(n, sid).clips, ...lanes(n, sid).flatMap((t) => t.clips)].flatMap((c) => c.noten.map((x) => x.id));
  assert.equal(new Set(ids).size, ids.length, 'note ids are unique');
});

test('a note across the seam is cut at the loop end and does not continue', () => {
  const { p, sid } = projekt();
  const n = nimm(p, sid, [an(3), aus(5), ...passEv(1)], { endeBeat: 8 });
  const t1 = lanes(n, sid)[0].clips[0];
  assert.deepEqual(abs([t1]), [[3, 1, 60]]);
  assert.deepEqual(abs(lanes(n, sid)[1].clips).map((x) => x[2]), [61], 'pass 2 holds only its own note');
});

test('start outside the loop is one pass', () => {
  const { p, sid } = projekt();
  const n = nimm(p, sid, [an(5), aus(6)], { startBeat: 5, endeBeat: 9 });
  assert.equal(lanes(n, sid).length, 1);
  assert.deepEqual(abs(sucheSpur(n, sid).clips), [[5, 1, 60]]);
});

test('start inside the loop: first pass partial, then full passes at project beats', () => {
  const { p, sid } = projekt();
  const n = nimm(p, sid, [an(3), aus(3.5), an(5), aus(6, 60)], { startBeat: 3, endeBeat: 9 });
  const l = lanes(n, sid);
  assert.deepEqual(l.map((t) => [t.clips[0].start_beat, t.clips[0].laenge_beats]), [[3, 1], [0, 4], [0, 1]].slice(0, l.length));
  assert.deepEqual(abs(l[1].clips), [[1, 1, 60]]);
  assert.deepEqual(sucheSpur(n, sid).clips.map((c) => [c.start_beat, c.laenge_beats]), [[0, 4]], 'main = the last complete pass');
});

test('overdub with a loop keeps the old result, no takes', () => {
  const { p, sid } = projekt();
  const ev = [0, 1].flatMap((k) => passEv(k));
  const mit = nimm(p, sid, ev, { overdub: true, endeBeat: 8 });
  const ohne = nimm(p, sid, ev, { overdub: true, endeBeat: 8, loop: undefined });
  assert.equal(JSON.stringify(mit), JSON.stringify(ohne));
  assert.equal(sucheSpur(mit, sid).takes, undefined);
});

test('what the main pass overwrites goes to the Original lane', () => {
  let { p, sid } = projekt();
  p = fuehreListeAus(p, [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 40, vel: 90 }] }]).projekt;
  const n = nimm(p, sid, [...passEv(0), ...passEv(1)], { endeBeat: 8 });
  const o = sucheSpur(n, sid).takes.find((t) => t.art === 'original');
  assert.deepEqual(abs(o.clips), [[0, 1, 40]]);
  assert.equal(lanes(n, sid).length, 2);
});

test('33 passes: 32 lanes kept, one dropped', () => {
  const { p, sid } = projekt();
  const a = { spurIds: [sid], startBeat: 0, bpm: BPM, startSample: START, ereignisse: Array.from({ length: 33 }, (_, k) => passEv(k)).flat(),
    versatzSamples: 0, overdub: false, endeBeat: 132, name: 'T', loop: LOOP };
  const n = nehmeMidiAuf(p, a);
  const t = sucheSpur(n, sid).takes;
  assert.equal(t.length, 32);
  assert.deepEqual(midiDurchlaufZahlen(p, a, sid), { takes: 32, verworfen: 1 });
  assert.equal(abs(t[0].clips)[0][2], 61, 'the oldest pass is the one dropped');
  assert.equal(pruefeFehler(n), null);
});
