// Package 1.9 U0: the base project P0 of check/i19_base_project.mjs is a valid project for the command layer (the same steps the script sends over
// the API, applied in-process), and the note list is the fixed 8-bar bass of 16th notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { grundNoten, signalOk, BPM, BEATS, SLUG, NAME } from '../check/i19_base_project.mjs';
import { slugVon } from '../collection.ts';

test('P0 notes: 128 sixteenths over 32 beats, tones from the fixed pattern, all inside the clip', () => {
  const n = grundNoten();
  assert.equal(n.length, 128);
  assert.equal(n[0].beat, 0);
  assert.equal(n[127].beat, 31.75);
  assert.ok(n.every((x) => x.laenge === 0.2 && x.beat + x.laenge <= BEATS && x.ton >= 36 && x.ton <= 48 && x.vel >= 70 && x.vel <= 110));
  assert.deepEqual(n.slice(0, 16).map((x) => x.ton), n.slice(16, 32).map((x) => x.ton));   // the pattern repeats every bar
});

test('P0 steps are accepted by the command layer and give a valid project with one RB-338 track and 128 notes', () => {
  let p = neuesProjekt(NAME);
  p = fuehreListeAus(p, [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: BEATS }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern', name: 'rb338' } }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: BEATS, name: 'Bass 8 bars', noten: grundNoten() }]).projekt;
  assert.doesNotThrow(() => pruefeProjekt(p));
  assert.equal(p.spuren.length, 1);
  assert.deepEqual(p.spuren[0].geraet.name, 'rb338');
  assert.equal(p.spuren[0].clips[0].noten.length, 128);
  assert.equal(p.tempo_bpm, 120);
  assert.deepEqual(p.loop, { an: true, von_beat: 0, bis_beat: 32 });
});

test('the slug the script expects is the slug the server derives', () => {
  assert.equal(slugVon(NAME), SLUG);
});

test('negative control: a note with tone 200 is refused by the command layer (the test would not accept anything)', () => {
  let p = neuesProjekt(NAME);
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338' } }]).projekt;
  assert.throws(() => fuehreListeAus(p, [{ befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 1, noten: [{ beat: 0, laenge: 0.2, ton: 200, vel: 100 }] }]));
});

test('the export signal gate: a quiet or missing peak is refused, a normal one passes (positive and negative control)', () => {
  assert.equal(signalOk(-12.3), true);
  assert.equal(signalOk(-59.9), true);
  assert.equal(signalOk(-60), false);
  assert.equal(signalOk(-Infinity), false);
  assert.equal(signalOk(undefined), false);
});
