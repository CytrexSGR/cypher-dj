// 1.8 S2b.1 (D9): the latency offset in the take placement. One run has ONE tail (nachlauf_lauf = the largest offset of the armed tracks); every raw file
// carries it. Each clip gets its own offset_s (versatz / 48000) and the pass length T = (frames - nachlauf_lauf) / 48000 s in beats, so all clips of a
// run cover exactly the pass whatever their own offset. A take that ended early has no tail: its length is (frames - own versatz).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nehmeTakeAuf, schreibeWavAusF32 } from '../project/recording.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';

const RATE = 48000;
const BPM = 120;
const projekt3 = () => {
  let p = neuesProjekt('V');
  p = fuehreListeAus(p, [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'audio', name: 'A' }, { befehl: 'spur_neu', art: 'audio', name: 'B' },
    { befehl: 'spur_neu', art: 'audio', name: 'C' }]).projekt;
  return { p, ids: p.spuren.map((s) => s.id) };
};
const beats = (frames) => (frames / RATE) * (BPM / 60);
const roh = (frames) => beats(frames);   // the raw length of the take in beats, as the server computes it from the file
const nehme = (p, id, o) => nehmeTakeAuf(p, { spurId: id, startBeat: 0, laengeBeats: o.laenge, sha256: o.sha ?? 'a'.repeat(64), pfadHinweis: '/x/take.wav', name: 'Take 1',
  ...(o.rest ?? {}) });
const haupt = (p, id) => p.spuren.find((s) => s.id === id).clips[0];
const lane = (p, id) => p.spuren.find((s) => s.id === id).takes.find((t) => t.art === undefined).clips[0];
const nah = (a, b, wo) => assert.ok(Math.abs(a - b) < 1e-9, `${wo}: ${a} vs ${b}`);

test('S2b.1 D9: one run, tail 600, versatz 256 / 600 / 0: every clip covers the pass T (48000 frames), own offsets, same start beats, lane copy alike', () => {
  const { p, ids } = projekt3();
  const T = beats(48000), versatz = [256, 600, 0], nachlauf = 600;
  let n = p;
  ids.forEach((id, i) => { n = nehme(n, id, { laenge: roh(48000 + nachlauf), rest: { versatzSamples: versatz[i], nachlaufSamples: nachlauf } }); });
  ids.forEach((id, i) => {
    const c = haupt(n, id), l = lane(n, id);
    nah(c.laenge_beats, T, `clip ${i} length`);
    assert.equal(c.offset_s, versatz[i] / RATE, `clip ${i} offset`);
    assert.equal(c.start_beat, 0, `clip ${i} start`);
    assert.deepEqual([l.laenge_beats, l.offset_s, l.start_beat], [c.laenge_beats, c.offset_s, c.start_beat], `take lane copy ${i} carries the same`);
  });
  assert.equal(haupt(n, ids[0]).laenge_beats, haupt(n, ids[1]).laenge_beats, 'B and A: identical length (not derived from the own versatz)');
  assert.equal(haupt(n, ids[1]).laenge_beats, haupt(n, ids[2]).laenge_beats, 'internal C ends exactly where B ends');
  assert.deepEqual(haupt(n, ids[2]).quelle, { sha256: 'a'.repeat(64), pfad_hinweis: '/x/take.wav' }, 'quelle stays {sha256, pfad_hinweis}');
});

test('S2b.1 D9: a take that ended early (abgebrochen, 30000 frames, versatz 256) has no tail: length (30000 - 256) / 48000 s in beats', () => {
  const { p, ids } = projekt3();
  const n = nehme(p, ids[0], { laenge: roh(30000), rest: { versatzSamples: 256, nachlaufSamples: 600, abgebrochen: true } });
  nah(haupt(n, ids[0]).laenge_beats, beats(30000 - 256), 'early-ended length');
  assert.equal(haupt(n, ids[0]).offset_s, 256 / RATE);
  // negative control: the same numbers as a complete take use the run tail, not the own versatz
  const m = nehme(p, ids[0], { laenge: roh(30000), rest: { versatzSamples: 256, nachlaufSamples: 600 } });
  nah(haupt(m, ids[0]).laenge_beats, beats(30000 - 600), 'complete take length');
  // an early-ended take that is shorter than its versatz holds nothing
  assert.throws(() => nehme(p, ids[0], { laenge: roh(200), rest: { versatzSamples: 256, abgebrochen: true } }), (e) => e.grund === 'leer');
});

test('S2b.1 negative control: nachlauf 0 and versatz 0 are deep-equal to the slice 1 placement (no new fields at all)', () => {
  const { p, ids } = projekt3();
  const alt = nehme(p, ids[0], { laenge: roh(48000) });
  const neu = nehme(p, ids[0], { laenge: roh(48000), rest: { versatzSamples: 0, nachlaufSamples: 0, abgebrochen: false } });
  assert.deepEqual(neu, alt);
  assert.equal(haupt(alt, ids[0]).offset_s, 0);
  assert.equal(haupt(alt, ids[0]).laenge_beats, beats(48000), 'bit equal, no rounding artefact');
});

test('S2b.1 AK14: clip_aendern offset_s afterwards shifts the clip and leaves the WAV (file and sha) unchanged', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-versatz-'));
  try {
    const f32 = path.join(d, 'r.f32'), wav = path.join(d, 'take.wav');
    const b = Buffer.alloc(1000 * 8);
    for (let i = 0; i < 1000; i++) { b.writeFloatLE(i / 1000, i * 8); b.writeFloatLE(-i / 1000, i * 8 + 4); }
    fs.writeFileSync(f32, b);
    const w = schreibeWavAusF32(f32, wav);
    const shaDatei = () => crypto.createHash('sha256').update(fs.readFileSync(wav)).digest('hex');
    assert.equal(w.sha256, shaDatei());
    const { p, ids } = projekt3();
    const n = nehme(p, ids[0], { laenge: roh(1000), sha: w.sha256, rest: { versatzSamples: 256, nachlaufSamples: 256 } });
    const c = haupt(n, ids[0]);
    assert.equal(c.offset_s, 256 / RATE);
    const m = fuehreListeAus(n, [{ befehl: 'clip_aendern', clip_id: c.id, offset_s: 0.01 }]).projekt;
    assert.equal(haupt(m, ids[0]).offset_s, 0.01, 'the position follows the new offset');
    assert.equal(haupt(m, ids[0]).quelle.sha256, w.sha256, 'the source sha stays');
    assert.equal(shaDatei(), w.sha256, 'the WAV on disk is unchanged');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
