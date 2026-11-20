// The decision "does this click clear the track selection?" (production/choice_click.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { klickDaneben } from '../public/production/choice_click.js';

const ziel = (treffer, verbunden = true) => ({ isConnected: verbunden, closest: (sel) => (treffer.some((t) => sel.includes(t)) ? {} : null) });

test('a click on a free spot clears the selection', () => {
  assert.equal(klickDaneben(ziel([])), true);
});
test('a click in the dock, a window, a face, a menu or a floating parameter popover keeps it', () => {
  for (const k of ['.p-dock', '.w-fenster-flaeche', '.p-face', '.p-menue', '.p-ins-schwebend']) assert.equal(klickDaneben(ziel([k])), false, k);
});
test('a click on a track head keeps it', () => {
  assert.equal(klickDaneben(ziel(['.p-kopf[data-spur]'])), false);
});
test('a detached target (X of a window or popover, a menu entry) keeps it', () => {
  assert.equal(klickDaneben(ziel([], false)), false);
  assert.equal(klickDaneben(null), false);
});
