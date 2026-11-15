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
  const g = { 'deck/1': 'fx-remix', 'erz/2': 'surge', master: 'fx-remix' };
  assert.deepEqual(altlasten(g), ['master', 'deck/1']);
  assert.deepEqual(ladeSchritte(g), [{ kanal: 'master', name: '' }, { kanal: 'deck/1', name: '' }, { kanal: 'fx/3', name: 'fx-remix' }]);
  assert.deepEqual(ladeSchritte({ 'fx/3': 'fx-remix' }), []);
  assert.deepEqual(entladeSchritte({ 'fx/3': 'fx-remix' }), [{ kanal: 'fx/3', name: '' }]);
  assert.deepEqual(entladeSchritte({}), []);
});

test('the channels offered follow the places', () => {
  assert.deepEqual(kanaele(['track', 'track', 'strudel', 'loops']), ['deck/1', 'deck/2', 'pad/1', 'pad/2', 'erz/1', 'erz/2', 'erz/3']);
  // decks 3 and 4 have no channel strip on the page (d3268f8b, deleted on purpose), so a Track place 3 or 4 offers no channel
  assert.deepEqual(kanaele(['track', 'track', 'track', 'track']), ['deck/1', 'deck/2']);
});

test('the FX3 unit names the channels on 3 in mixer order', () => {
  const layout = ['track', 'track', 'strudel', 'loops'];
  assert.equal(zugewieseneText({ 'pad/1': true, 'deck/1': true, 'deck/2': false }, layout), 'A L1');
  assert.equal(zugewieseneText({}, layout), '–');
  assert.equal(zugewieseneText({ 'deck/4': true }, layout), '–');   // a channel no place shows does not count
  assert.equal(kurzName('erz/1'), 'DR');
  assert.equal(kurzName('deck/3'), 'D3');
});
