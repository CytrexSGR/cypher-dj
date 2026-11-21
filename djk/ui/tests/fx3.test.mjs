// FX3, the Remix as an insert on a group (fx3.js, 2026-11-14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geladen, fremd, altlasten, ladeSchritte, entladeSchritte, kanaele, zugewieseneText, kurzName, PLATZ, GERAET } from '../public/fx3.js';

test('FX3 lives on fx/3 and carries fx-remix', () => {
  assert.equal(PLATZ, 'fx/3');
  assert.equal(GERAET, 'fx-remix');
  assert.equal(geladen({ 'fx/3': 'fx-remix' }), true);
  assert.equal(geladen({ 'deck/1': 'fx-remix' }), false);
  assert.equal(fremd({ 'fx/3': 'fx-delay-sync' }), 'fx-delay-sync');
  assert.equal(fremd({ 'fx/3': 'fx-remix' }), '');
  assert.equal(fremd({}), '');
});

test('loading takes old-style Remix inserts off first, then loads fx/3', () => {
  const g = { 'deck/1': 'fx-remix', 'erz/2': 'surge', master: 'fx-remix' };   // erz/2 is no channel any more: a graph there is not an old insert
  assert.deepEqual(altlasten(g), ['master', 'deck/1']);
  assert.deepEqual(ladeSchritte(g), [{ kanal: 'master', name: '' }, { kanal: 'deck/1', name: '' }, { kanal: 'fx/3', name: 'fx-remix' }]);
  assert.deepEqual(ladeSchritte({ 'fx/3': 'fx-remix' }), []);
  assert.deepEqual(entladeSchritte({ 'fx/3': 'fx-remix' }), [{ kanal: 'fx/3', name: '' }]);
  assert.deepEqual(entladeSchritte({}), []);
});

test('the channels offered are the four container strips', () => {
  assert.deepEqual(kanaele(), ['deck/1', 'deck/2', 'pad/1', 'pad/2']);
});

test('the FX3 unit names the channels on 3 in mixer order', () => {
  assert.equal(zugewieseneText({ 'pad/1': true, 'deck/1': true, 'deck/2': false }), 'A C');
  assert.equal(zugewieseneText({}), '–');
  assert.equal(zugewieseneText({ 'deck/4': true, 'erz/1': true }), '–');   // a path that is no container strip does not count
  assert.equal(kurzName('pad/2'), 'D');
  assert.equal(kurzName('deck/1'), 'A');
});
