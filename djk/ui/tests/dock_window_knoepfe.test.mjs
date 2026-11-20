// The WINDOW ↗ buttons (stage 2, task 6): the switch stufenFenster of the host decides; PRODUCTION has it on, STUDIO (werkbank) off.
// Pinned on the sources (the buttons themselves are exercised in headless Chrome by target_window_acceptance.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lies = (p) => fs.readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');

test('the host switch: PRODUCTION on, STUDIO off', () => {
  assert.match(lies('production/dock_host.js'), /stufenFenster: true/);
  assert.match(lies('werkbank/dock.js'), /stufenFenster: false/);
});

test('the cards of a return, a group and the master carry WINDOW ↗ behind the switch', () => {
  const k = lies('dock/karten.js');
  for (const z of ["`grp:${g.id}`", "`ret:${r.id}`", "'master'"]) assert.ok(k.includes(`...zielKnopf(werk, ${z})`), z);
  assert.match(k, /if \(!host\.schalter\?\.stufenFenster \|\| host\.einzel\) return \[\]/);
});

test('the stage window bar and the native face bar offer WINDOW ↗ except where the window already is the page', () => {
  assert.match(lies('dock/window.js'), /if \(!voll && teil !== 'hall' && host\.schalter\?\.stufenFenster/);
  assert.match(lies('production/insert_face.js'), /ctx\.dockHost\?\.schalter\?\.stufenFenster && !ctx\.faceEinbettung/);
});
