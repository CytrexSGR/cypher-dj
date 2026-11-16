// MIDI file export: the SMF writer (round trip through the reader) and the pure part builder (project/export_midi.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { leseSmf, schreibeSmf } from '../project/smf.ts';
import { midiTeile, sicherName } from '../project/export_midi.ts';

const klar = (x) => JSON.parse(JSON.stringify(x));

test('writer: format 1, 480 PPQ, conductor with tempo and time signature, parts round-trip through the reader', () => {
  const roh = schreibeSmf({ titel: 'Song', tempo_bpm: 128, taktart: [3, 4], teile: [
    { name: 'Bass', noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }, { beat: 1, laenge: 0.5, ton: 36, vel: 90 }, { beat: 2.25, laenge: 2, ton: 43, vel: 80 }] },
    { name: 'Pad ä', noten: [{ beat: 0, laenge: 4, ton: 60, vel: 70 }] },
  ] });
  assert.ok(roh instanceof Uint8Array);
  const d = leseSmf(roh);
  assert.equal(d.format, 1);
  assert.equal(d.ticksProViertel, 480);
  assert.deepEqual(d.spurNamen, ['Song', 'Bass', 'Pad ä']);
  assert.equal(d.tempi.length, 1);
  assert.ok(Math.abs(d.tempi[0].bpm - 128) < 0.01);
  assert.deepEqual(d.taktarten, [{ tick: 0, zaehler: 3, nenner: 4 }]);
  assert.deepEqual(d.teile.map((t) => t.name), ['Bass', 'Pad ä']);
  assert.deepEqual(d.teile[0].noten, [{ tick: 0, dauer: 480, ton: 36, vel: 100 }, { tick: 480, dauer: 240, ton: 36, vel: 90 }, { tick: 1080, dauer: 960, ton: 43, vel: 80 }]);
  assert.deepEqual(d.teile[1].noten, [{ tick: 0, dauer: 1920, ton: 60, vel: 70 }]);
  assert.equal(d.hinweise.length, 0);
});

test('writer: a note-off before a note-on at the same tick keeps repeated notes apart; long gaps use multi-byte delta times', () => {
  const d = leseSmf(schreibeSmf({ titel: 'x', tempo_bpm: 120, taktart: [4, 4], teile: [
    { name: 'T', noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }, { beat: 1, laenge: 1, ton: 60, vel: 100 }, { beat: 400, laenge: 1, ton: 61, vel: 100 }] }] }));
  assert.deepEqual(d.teile[0].noten.map((n) => [n.tick, n.dauer, n.ton]), [[0, 480, 60], [480, 480, 60], [192000, 480, 61]]);
});

const klip = (o) => ({ id: 'c', art: 'midi', name: 'c', start_beat: 0, laenge_beats: 4, noten: [], ...o });
const n = (id, beat, laenge, ton, vel = 100) => ({ id, beat, laenge, ton, vel });
const spur = (o) => ({ id: 's1', nr: 1, name: 'A', art: 'instrument', mute: false, solo: false, clips: [], ...o });

test('parts: loop unrolled like the playback, notes at or after loop_beats silent, cut to the range, relative to von', () => {
  const p = { spuren: [spur({ clips: [klip({ start_beat: 4, laenge_beats: 6, loop_beats: 2, noten: [n('a', 0, 1, 60), n('b', 1, 1, 62), n('c', 2, 1, 64)] })] })] };
  const t = midiTeile(p, 0, 100);
  assert.deepEqual(t[0].noten.map((x) => [x.beat, x.laenge, x.ton]), [[4, 1, 60], [5, 1, 62], [6, 1, 60], [7, 1, 62], [8, 1, 60], [9, 1, 62]]);
  const r = midiTeile(p, 5, 8.5);
  assert.deepEqual(r[0].noten.map((x) => [x.beat, x.laenge, x.ton]), [[0, 1, 62], [1, 1, 60], [2, 1, 62], [3, 0.5, 60]], 'relative to von, the last note shortened to bis');
});

test('parts: a note already sounding at von starts at 0; muted tracks, empty ranges and audio tracks are left out; transpose envelope applies', () => {
  const hk = { ziel: 'transpose', verknuepft: true, punkte: [{ beat: 0, wert: 12 }] };
  const p = { spuren: [
    spur({ id: 'a', nr: 1, name: 'A', clips: [klip({ noten: [n('x', 0, 4, 60)], huellkurven: [hk] })] }),
    spur({ id: 'm', nr: 2, name: 'M', mute: true, clips: [klip({ noten: [n('x', 0, 1, 60)] })] }),
    spur({ id: 'l', nr: 3, name: 'L', clips: [klip({ noten: [n('x', 0, 1, 60)] })] }),
    spur({ id: 'au', nr: 4, name: 'Au', art: 'audio', clips: [{ id: 'q', art: 'audio', start_beat: 0, laenge_beats: 4 }] }),
  ] };
  const t = midiTeile(klar(p), 2, 3);
  assert.deepEqual(t.map((x) => x.spur_id), ['a'], 'M muted, L has nothing in 2..3, Au is audio');
  assert.deepEqual(t[0].noten, [{ beat: 0, laenge: 1, ton: 72, vel: 100 }]);
});

test('sicherName: lower case, [a-z0-9-], umlauts folded, empty becomes track', () => {
  assert.equal(sicherName('Lead Synth #2'), 'lead-synth-2');
  assert.equal(sicherName('Bässe / Sub'), 'basse-sub');
  assert.equal(sicherName('★★'), 'track');
});
