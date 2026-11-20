// A role lane of the effect commands must not silently replace a lane the track holds for the same device knob: the command list is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { ohneFxEinfach, lauf } from './support/fx_basis.mjs';

const ROLLEN = () => ({ stufig: false, rollen: { slot: 3, start: 5, rueckwaerts: 6 } });
const mit = (p, ...b) => fuehreListeAus(p, b, { quelle: 'andreas', geraetFx: ROLLEN });
const ofs = { befehl: 'fx_setzen', clip_id: 'c1', eintraege: [{ beat: 0, spalte: 0, code: 'OFS', wert: 128 }] };
const lane = (ziel) => ({ befehl: 'auto_neu', strang_id: 's1', ziel, punkte: [{ beat: 0, wert: 0.2 }, { beat: 2, wert: 0.6 }] });
const grund = (f) => { try { f(); } catch (e) { assert.ok(e instanceof BefehlFehler); return e; } return assert.fail('no refusal'); };

test('OFS onto a track that holds a lane for the start knob is refused with the reason', () => {
  const p = mit(ohneFxEinfach(), lane('geraet.k5')).projekt;
  const e = grund(() => mit(p, ofs));
  assert.equal(e.grund, 'fx_lane_kollision');
  assert.match(e.message, /s1: .*geraet\.k5/);
});

test('a lane for the knob that the effect commands already drive is refused too', () => {
  const p = mit(ohneFxEinfach(), ofs).projekt;
  assert.equal(grund(() => mit(p, lane('geraet.k5'))).grund, 'fx_lane_kollision');
});

test('another knob, or no effect commands, or a clash that was already there: accepted', () => {
  const p = mit(ohneFxEinfach(), lane('geraet.k4')).projekt;
  assert.ok(mit(p, ofs).projekt, 'a lane for another knob');
  assert.ok(mit(ohneFxEinfach(), lane('geraet.k5')).projekt, 'a lane without effect commands');
  const alt = lauf(ohneFxEinfach(), ofs);
  alt.spuren[0].automation = [{ ziel: 'geraet.k5', punkte: [{ beat: 0, wert: 0.3 }] }];   // a clash from before this check
  assert.ok(mit(alt, { befehl: 'tempo_setzen', bpm: 121 }).projekt, 'an unrelated edit of such a project is not blocked');
});
