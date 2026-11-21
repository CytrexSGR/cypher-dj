// Container core, lane U, U2: the pure place model reads the live project (lage.plaetze) and knows nothing about browser layouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATZ_TYPEN, EINMALIG, plaetzeAusLage, typVon, gruppeVon, erlaubt, still, wechselKoerper, zugKopf } from '../public/slots.js';

const LAGE = [{ typ: 'track' }, { typ: 'seq', gruppe: 'g2' }, { typ: 'strudel', gruppe: 'g3' }, { typ: 'leer' }];

test('PLATZ_TYPEN is the order of F5 and only strudel is single', () => {
  assert.deepEqual([...PLATZ_TYPEN], ['leer', 'track', 'strudel', 'seq', 'loops', 'stems']);
  assert.deepEqual([...EINMALIG], ['strudel']);
});

test('plaetzeAusLage reads lage.plaetze and answers null when no live project is open', () => {
  assert.deepEqual(plaetzeAusLage({ plaetze: LAGE }), LAGE);
  assert.equal(plaetzeAusLage({}), null);
  assert.equal(plaetzeAusLage({ plaetze: null }), null);
  assert.equal(plaetzeAusLage({ plaetze: LAGE.slice(0, 3) }), null);
  assert.equal(plaetzeAusLage(null), null);
  assert.equal(plaetzeAusLage(undefined), null);
});

test('typVon and gruppeVon read one entry; gruppeVon is null for leer and track', () => {
  assert.equal(typVon(LAGE, 1), 'track');
  assert.equal(typVon(LAGE, 3), 'strudel');
  assert.equal(typVon(LAGE, 4), 'leer');
  assert.equal(typVon(null, 2), 'leer', 'no live project: empty');
  assert.equal(gruppeVon(LAGE, 2), 'g2');
  assert.equal(gruppeVon(LAGE, 3), 'g3');
  assert.equal(gruppeVon(LAGE, 1), null);
  assert.equal(gruppeVon(LAGE, 4), null);
  assert.equal(gruppeVon(null, 2), null);
});

test('erlaubt refuses a second strudel place and accepts any other type, including a second seq and track', () => {
  assert.equal(erlaubt(LAGE, 1, 'strudel'), false, 'strudel already sits on place 3');
  assert.equal(erlaubt(LAGE, 3, 'strudel'), true, 'the place that holds it may say strudel again');
  assert.equal(erlaubt(LAGE, 1, 'seq'), true, 'a second seq');
  assert.equal(erlaubt(LAGE, 4, 'track'), true, 'a second track');
  assert.equal(erlaubt(LAGE, 4, 'loops'), true, 'loops is limited by the server (C1), not here');
  assert.equal(erlaubt(LAGE, 4, 'stems'), true);
  assert.equal(erlaubt(LAGE, 4, 'leer'), true);
  assert.equal(erlaubt(LAGE, 4, 'loops2'), false, 'loops2 is no type any more');
  assert.equal(erlaubt(null, 4, 'track'), false, 'no live project: nothing is offered');
});

test('still names the container strip of the place', () => {
  const a = still(LAGE, 3, { 'pad/1/trim': 0, 'pad/1/fader': -20 });
  assert.equal(a.still, false);
  assert.deepEqual(a.offen[0], { kanal: 'pad/1', grund: 'open' });
  assert.equal(a.text, 'C is open');
  const b = still(LAGE, 3, { 'pad/1/trim': 0, 'pad/1/fader': -30, 'pad/1/pfl': 1 });
  assert.equal(b.still, false);
  assert.deepEqual(b.offen, [{ kanal: 'pad/1', grund: 'pfl' }]);
  assert.equal(b.text, 'C has PFL on');
  const c = still(LAGE, 3, { 'pad/1/trim': 0 });
  assert.equal(c.still, true, 'an unknown fader counts -200');
  assert.equal(c.text, '');
  assert.equal(still(LAGE, 1, { 'pad/1/fader': 0 }).still, true, 'another place strip does not count');
  assert.deepEqual(still(LAGE, 1, { 'deck/1/fader': 0 }).offen, [{ kanal: 'deck/1', grund: 'open' }], 'place 1 owns deck/1');
});

test('still of an empty place and of a place in a project without a live set is still', () => {
  assert.equal(still(LAGE, 4, { 'pad/2/fader': 0 }).still, true, 'an empty place has no sound');
  assert.equal(still(null, 3, { 'pad/1/fader': 0 }).still, true, 'no live project');
  assert.deepEqual(still(null, 3, { 'pad/1/fader': 0 }).offen, []);
});

test('wechselKoerper(3, strudel) deep-equals {platz:3, typ:strudel} and throws for platz 0 and 5 and for an unknown type', () => {
  assert.deepEqual(wechselKoerper(3, 'strudel'), { platz: 3, typ: 'strudel' });
  assert.throws(() => wechselKoerper(0, 'strudel'), RangeError);
  assert.throws(() => wechselKoerper(5, 'strudel'), RangeError);
  assert.throws(() => wechselKoerper(1.5, 'strudel'), RangeError);
  assert.throws(() => wechselKoerper(3, 'loops2'), RangeError);
  assert.throws(() => wechselKoerper(3, undefined), RangeError);
});

test('zugKopf names the letter and the type', () => {
  assert.equal(zugKopf(LAGE, 3), 'C strudel');
  assert.equal(zugKopf(LAGE, 1), 'A track');
  assert.equal(zugKopf(LAGE, 4), 'D empty');
  assert.equal(zugKopf([{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }], 2), 'B empty');
  assert.equal(zugKopf(null, 2), 'B empty');
});

test('slots.js is pure: no storage, no fetch, no DOM, no channel literal', async () => {
  const fs = await import('node:fs');
  const text = fs.readFileSync(new URL('../public/slots.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(text, /localStorage|sessionStorage|fetch\(|document\.|loops2|'(pad|deck|erz)\//);
});
