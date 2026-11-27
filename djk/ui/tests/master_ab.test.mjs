// Pure rules of the loudness-matched A/B of the master chain (project/master_ab.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { AB_MAX_DB, abAusgleich, abSperre, abZeilen } from '../project/master_ab.ts';

const stufe = (art, slot, an) => ({ id: `i${art}${slot}`, art, slot, an, werte: {} });
const projekt = (master) => ({ master });

test('abAusgleich: the louder side is named, the cut is the measured difference', () => {
  assert.deepEqual(abAusgleich(-9, -14), { leiser: 'a', db: 5 });
  assert.deepEqual(abAusgleich(-14, -9), { leiser: 'b', db: 5 });
  assert.deepEqual(abAusgleich(-9, -9.1), { leiser: null, db: 0 });
  assert.deepEqual(abAusgleich(-9, -40), { leiser: 'a', db: AB_MAX_DB });
  assert.equal(AB_MAX_DB, 24);
  assert.deepEqual(abAusgleich(null, -9), { leiser: null, db: 0 });
  assert.deepEqual(abAusgleich(-9, null), { leiser: null, db: 0 });
  assert.deepEqual(abAusgleich(-9, -13.84), { leiser: 'a', db: 4.8 });
});

test('abZeilen: side A keeps the project switches, side B switches every stage off, the `an` rows come before the fader', () => {
  const p = projekt({ fader_db: -3, inserts: [stufe('eq', 1, true), stufe('lim', 2, false)] });
  const sohne = { leiser: null, db: 0 };
  assert.deepEqual(abZeilen(p, 'a', sohne), [
    { pfad: 'ins/eq/1/an', wert: 1 }, { pfad: 'ins/lim/2/an', wert: 0 }, { pfad: 'pm/fader', wert: -3 }]);
  assert.deepEqual(abZeilen(p, 'b', sohne), [
    { pfad: 'ins/eq/1/an', wert: 0 }, { pfad: 'ins/lim/2/an', wert: 0 }, { pfad: 'pm/fader', wert: -3 }]);
  // the cut goes to the side it names only
  assert.equal(abZeilen(p, 'a', { leiser: 'a', db: 4.8 }).at(-1).wert, -7.8);
  assert.equal(abZeilen(p, 'b', { leiser: 'a', db: 4.8 }).at(-1).wert, -3);
  assert.equal(abZeilen(p, 'b', { leiser: 'b', db: 4.8 }).at(-1).wert, -7.8);
});

test('abZeilen: the fader row is clamped to the fader range, a project without a master gives the fader at 0', () => {
  const p = projekt({ fader_db: -190, inserts: [stufe('eq', 1, true)] });
  assert.equal(abZeilen(p, 'a', { leiser: 'a', db: 24 }).at(-1).wert, -200);
  assert.deepEqual(abZeilen({}, 'b', { leiser: null, db: 0 }), [{ pfad: 'pm/fader', wert: 0 }]);
});

test('abSperre: no stage, a master fader lane, ok', () => {
  assert.equal(abSperre(projekt({ fader_db: 0 })), 'keine_stufe');
  assert.equal(abSperre(projekt({ fader_db: 0, inserts: [] })), 'keine_stufe');
  assert.equal(abSperre({}), 'keine_stufe');
  const mit = [stufe('eq', 1, true)];
  assert.equal(abSperre(projekt({ fader_db: 0, inserts: mit, automation: [{ id: 'l1', ziel: 'fader', punkte: [] }] })), 'master_lane');
  assert.equal(abSperre(projekt({ fader_db: 0, inserts: mit, automation: [{ id: 'l2', ziel: 'insert.ieq1.gain', punkte: [] }] })), null);
  assert.equal(abSperre(projekt({ fader_db: 0, inserts: mit })), null);
});
