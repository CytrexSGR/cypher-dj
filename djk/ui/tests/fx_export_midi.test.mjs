// Tracker task 14: pitch bend and level (controller 11) in the MIDI file export.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schreibeSmf, SMF_BEND_BEREICH } from '../project/smf.ts';
import { midiTeile } from '../project/export_midi.ts';
import { ohneFxEinfach, lauf } from './support/fx_basis.mjs';

// minimal walker: the channel events [{ tick, art, kanal, d1, d2 }] of every track chunk (meta events skipped)
function ereignisse(roh) {
  const dv = new DataView(roh.buffer, roh.byteOffset, roh.byteLength);
  const spuren = [];
  let o = 14;
  while (o < roh.length) {
    const ende = o + 8 + dv.getUint32(o + 4);
    let q = o + 8, tick = 0, status = 0;
    const liste = [];
    while (q < ende) {
      let dt = 0, b;
      do { b = roh[q++]; dt = (dt << 7) | (b & 127); } while (b & 128);
      tick += dt;
      if (roh[q] === 0xff) {
        q += 2;
        let l = 0;
        do { b = roh[q++]; l = (l << 7) | (b & 127); } while (b & 128);
        q += l;
        continue;
      }
      if (roh[q] & 128) status = roh[q++];
      const art = status & 0xf0;
      const d1 = roh[q++], d2 = art === 0xc0 || art === 0xd0 ? 0 : roh[q++];
      liste.push({ tick, art, kanal: status & 15, d1, d2 });
    }
    spuren.push(liste);
    o = ende;
  }
  return spuren;
}
const opt = (teil) => ({ titel: 'T', tempo_bpm: 120, taktart: [4, 4], teile: [{ name: 'A', noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }], ...teil }] });
const bend14 = (x) => x.d1 | (x.d2 << 7);

test('no bend and no level: the track bytes stay as before (no controller, no pitch bend)', () => {
  const sp = ereignisse(schreibeSmf(opt({})));
  assert.deepEqual(sp[1].map((x) => x.art), [0x90, 0x80]);
  assert.deepEqual(schreibeSmf(opt({ bend: [], pegel: [] })), schreibeSmf(opt({})));
});

test('a bend writes RPN 0 (range 12 semitones) once at tick 0 and the pitch bend events at their ticks', () => {
  assert.equal(SMF_BEND_BEREICH, 12);
  const sp = ereignisse(schreibeSmf(opt({ bend: [{ beat: 1, st: 0 }, { beat: 1, st: 12 }, { beat: 2, st: -12 }, { beat: 2.5, st: 0 }, { beat: 3, st: 6 }] })));
  const t = sp[1];
  const rpn = t.filter((x) => x.art === 0xb0);
  assert.deepEqual(rpn.map((x) => [x.tick, x.d1, x.d2]), [[0, 101, 0], [0, 100, 0], [0, 6, 12], [0, 38, 0]], 'RPN 0 once, data entry 12 semitones');
  const pb = t.filter((x) => x.art === 0xe0);
  // st 0 at beat 1 equals the start value (centre): skipped; then up, down, centre, half up
  assert.deepEqual(pb.map((x) => [x.tick, bend14(x)]), [[480, 16383], [960, 0], [1200, 8192], [1440, 12288]]);
  assert.ok(pb.every((x) => x.kanal === 0));
  assert.ok(t.indexOf(rpn[0]) < t.indexOf(pb[0]), 'the range is set before the first bend');
  // the note is still there
  assert.equal(t.filter((x) => x.art === 0x90).length, 1);
});

test('a level writes controller 11 = round(factor * 127); equal consecutive values are written once', () => {
  const sp = ereignisse(schreibeSmf(opt({ pegel: [{ beat: 0.5, faktor: 0.5 }, { beat: 1, faktor: 0.5 }, { beat: 2, faktor: 1 }, { beat: 3, faktor: 0 }] })));
  const cc = sp[1].filter((x) => x.art === 0xb0 && x.d1 === 11);
  assert.deepEqual(cc.map((x) => [x.tick, x.d2]), [[240, 64], [960, 127], [1440, 0]]);
  assert.ok(!sp[1].some((x) => x.art === 0xb0 && x.d1 === 101), 'no bend: no RPN');
});

test('midiTeile: a glide becomes steps of one effect tick inside the range; a project without fx has no bend field', () => {
  const ohne = midiTeile(ohneFxEinfach(), 0, 4);
  assert.ok(ohne.every((t) => !('bend' in t) && !('pegel' in t)));
  const p = lauf(ohneFxEinfach(), { befehl: 'fx_setzen', clip_id: 'c1', eintraege: [
    { beat: 1, spalte: 0, code: 'SLU', wert: 0x20 }, { beat: 2, spalte: 0, code: 'LVL', wert: 128 }] });
  const t = midiTeile(p, 0, 4, () => ({ stufig: false, rollen: {} }));
  assert.equal(t.length, 1);
  const b = t[0].bend, l = t[0].pegel;
  assert.ok(b.length >= 6, `glide steps: ${b.length}`);
  assert.ok(b.every((x, i) => i === 0 || b[i - 1].beat <= x.beat));
  assert.ok(Math.abs(b.find((x) => x.beat > 1).beat - 1) <= 0.25 + 1e-9);
  assert.ok(Math.abs(Math.max(...b.map((x) => x.st)) - 12) < 1e-9, 'the glide reaches 12 semitones');
  assert.equal(midiTeile(p, 0, 8, () => ({ stufig: false, rollen: {} }))[0].bend.at(-1).st, 0, 'neutral at the clip end (beat 4), inside a longer range');
  assert.ok(Math.abs(l.find((x) => x.beat === 2).faktor - 128 / 255) < 1e-12);
  // a range window cuts the lists and keeps the value in force at the start as a point at 0
  const q = structuredClone(p);
  q.spuren[0].clips[0].noten.push({ id: 'e7', beat: 3, laenge: 1, ton: 62, vel: 100 });
  const w = midiTeile(q, 2, 4, () => ({ stufig: false, rollen: {} }))[0];
  assert.ok(w.bend.every((x) => x.beat >= 0 && x.beat < 2));
  assert.equal(w.bend[0].beat, 0);
  assert.ok(Math.abs(w.bend[0].st - 12) < 1e-9, 'the pitch in force at beat 2 is the end of the glide');
  // the whole thing goes through the writer
  const sp = ereignisse(schreibeSmf({ titel: 'x', tempo_bpm: 120, taktart: [4, 4], teile: [{ name: 'A', noten: t[0].noten, bend: b, pegel: l }] }));
  assert.ok(sp[1].some((x) => x.art === 0xe0));
  assert.ok(sp[1].some((x) => x.art === 0xb0 && x.d1 === 11));
});
