// The CTL mark on the track head the controllers drive (public/ctl_track_marker.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ctlMarkeStil, ctlMarkeSpur } from '../public/ctl_track_marker.js';

test('ctlMarkeSpur: the focused track while a place follows, else none', () => {
  assert.equal(ctlMarkeSpur({ fokus: { spur_id: 's2' }, plaetze: [{ folgen: false }, { folgen: true }] }), 's2');
  assert.equal(ctlMarkeSpur({ fokus: { spur_id: 's2' }, plaetze: [{ folgen: false }] }), null, 'no place follows: the controllers do not drive it');
  assert.equal(ctlMarkeSpur({ fokus: { kanal: 'erz/5' }, plaetze: [{ folgen: true }] }), null, 'a live channel is no track head');
  assert.equal(ctlMarkeSpur(null), null);
});

test('ctlMarkeStil: one rule on the track id, nothing for a strange id', () => {
  const css = ctlMarkeStil('s2');
  assert.match(css, /\.p-kopf\[data-spur="s2"\] \{ box-shadow/);
  assert.match(css, /\.p-kopf\[data-spur="s2"\]::after \{ content: "CTL"/);
  assert.equal(ctlMarkeStil(null), '');
  assert.equal(ctlMarkeStil('s2"] , body { x'), '', 'nothing but a plain id goes into the selector');
});

test('ctlMarkeStil: the dock card of the track gets the same outline and CTL badge', () => {
  const css = ctlMarkeStil('s3');
  assert.match(css, /\[data-w="karte-spur"\]\[data-spur-id="s3"\] \{ box-shadow/);
  assert.match(css, /\[data-w="karte-spur"\]\[data-spur-id="s3"\]::after \{ content: "CTL"/);
  assert.doesNotMatch(ctlMarkeStil('s3"] , body { x'), /karte-spur/, 'a bad id adds nothing for the card either');
});
