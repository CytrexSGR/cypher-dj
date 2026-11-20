// Tracker follow-up F3: Note.platz reaches the playback (slot lane geraet.k<n>) without any effect command.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { uebersetze } from '../project/playback.ts';
import { neuesProjekt } from '../project/model.ts';
import { BK, ohneFx, ohneFxEinfach, lauf, note } from './support/fx_basis.mjs';

const ROLLEN = () => ({ stufig: false, rollen: { slot: 3, start: 5, rueckwaerts: 6 } });
const GLATT = () => ({ stufig: false, rollen: {} });
const spiel = (p, gf = GLATT) => uebersetze(p, { nr: 1, audioOrdner: '@A@', frames: () => 400000, geraetFx: gf });
const sha = (w) => crypto.createHash('sha256').update(JSON.stringify(w)).digest('hex');
const spur = (w, nr) => w.spuren.find((s) => s.nr === nr);
const lane = (s, ziel) => s.auto?.find((l) => l.ziel === ziel);
const mit = (noten, clip = {}, geraet = BK) => {
  const p = lauf(neuesProjekt('P'), { befehl: 'spur_neu', art: 'instrument', name: 'B', geraet });
  return lauf(p, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten, ...clip });
};
const PL = () => [note('a', 0, 1, 60, 100, { platz: 5 }), note('b', 2, 1, 62, 100, { platz: 32 })];

test('a clip with platz notes and no fx writes the slot lane, and resets it at the clip end', () => {
  const s = spur(spiel(mit(PL()), ROLLEN), 1);
  assert.deepEqual(lane(s, 'geraet.k3').punkte, [[0, 4 / 31, 2], [2, 1, 2], [4, 0, 2]]);
});

test('notes without platz in a clip that uses platz play the track knob value (slotBasis)', () => {
  const p = mit([note('a', 0, 1, 60, 100, { platz: 5 }), note('b', 2, 1, 62)], {}, { ...BK, parameter: { k3: 0.25 } });
  const s = spur(spiel(p, ROLLEN), 1);
  assert.deepEqual(lane(s, 'geraet.k3').punkte, [[0, 4 / 31, 2], [2, 0.25, 2]]);
});

test('the same clip on a device without a slot role adds nothing', () => {
  const p = mit(PL());
  assert.equal(sha(spiel(p, GLATT)), sha(spiel(mit(PL().map(({ platz, ...n }) => n)), GLATT)));
  assert.equal(spur(spiel(p, GLATT), 1).auto, undefined);
  assert.equal(spur(spiel(p, () => ({ stufig: false, rollen: { start: 5 } })), 1).auto, undefined);
});

test('a project without platz and without fx writes the same file whatever roles the device has', () => {
  const a = sha(spiel(ohneFx(), GLATT));
  assert.equal(sha(spiel(ohneFx(), ROLLEN)), a);
  assert.equal(sha(spiel(ohneFxEinfach(), ROLLEN)), sha(spiel(ohneFxEinfach(), GLATT)));
});

test('loop copies repeat the slot points; a second clip sets its own slot at its start', () => {
  let p = mit([note('a', 0, 1, 60, 100, { platz: 2 })], { loop_beats: 2 });
  let s = spur(spiel(p, ROLLEN), 1);
  assert.deepEqual(lane(s, 'geraet.k3').punkte, [[0, 1 / 31, 2], [2, 1 / 31, 2], [4, 0, 2]]);
  p = lauf(p, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 4, laenge_beats: 4, noten: [note('z', 1, 1, 60, 100, { platz: 9 })] });
  s = spur(spiel(p, ROLLEN), 1);
  const l = lane(s, 'geraet.k3').punkte;
  assert.deepEqual(l.find((x) => x[0] === 5), [5, 8 / 31, 2]);
  assert.deepEqual(l.at(-1), [8, 0, 2]);
});

// F6: a caller that passes no geraetFx (the starter render, the export paths) still gets the device mode from the register
test('uebersetze without geraetFx reads the register: an amiga track with platz notes gets its slot lane (knob 1)', () => {
  const amiga = { art: 'intern', name: 'bk', graph: 'amiga', parameter: {} };
  const p = mit(PL(), {}, amiga);
  const s = spur(uebersetze(p, { nr: 1, audioOrdner: '@A@', frames: () => 400000 }), 1);
  assert.deepEqual(lane(s, 'geraet.k1').punkte.map((q) => q.slice(0, 2)), [[0, 4 / 31], [2, 1], [4, 0]]);
});
