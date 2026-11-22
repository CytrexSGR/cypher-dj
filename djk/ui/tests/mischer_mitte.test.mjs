// ordneMitte: the header FX row and the headphone knobs come back to the header in every view but DJ, also when the master strip is not at home (SESSION dock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordneMitte } from '../public/mischer_mitte.js';

const knoten = (id) => ({ id, eltern: null, kinder: [],
  append(k) { k.eltern?.kinder.splice(k.eltern.kinder.indexOf(k), 1); k.eltern = this; this.kinder.push(k); },
  insertBefore(k, vor) { k.eltern?.kinder.splice(k.eltern.kinder.indexOf(k), 1); k.eltern = this; this.kinder.splice(this.kinder.indexOf(vor), 0, k); } });
const baue = () => {
  const n = Object.fromEntries(['#fx', '#fxmitte', '.kopfmix', '#mischer .mitte', '#kopf', '#fx-1', '#fx-2', '#colorfx', '#remix-einheit'].map((s) => [s, knoten(s)]));
  n['#kopf'].append(n['.kopfmix']); n['#kopf'].append(n['#fx']);
  for (const s of ['#fx-1', '#fx-2', '#colorfx', '#remix-einheit']) n['#fx'].append(n[s]);
  return { n, $: (s) => n[s] ?? null };
};
const FX = ['#fx-1', '#fx-2', '#colorfx', '#remix-einheit'];

test('DJ moves the FX units to the middle column and the headphones to the master strip; SESSION brings them back', () => {
  const { n, $ } = baue();
  ordneMitte('dj', $);
  assert.deepEqual(n['#fxmitte'].kinder.map((k) => k.id), FX);
  assert.equal(n['.kopfmix'].eltern, n['#mischer .mitte']);
  ordneMitte('produktion', $);
  assert.deepEqual(n['#fx'].kinder.map((k) => k.id), FX);
  assert.equal(n['.kopfmix'].eltern, n['#kopf']);
  assert.equal(n['#fxmitte'].kinder.length, 0);
});

test('a view after DJ restores the FX row although the master strip is missing (no #mischer .mitte)', () => {
  const { n, $ } = baue();
  ordneMitte('dj', $);
  n['#mischer .mitte'].kinder.length = 0;
  const karte = knoten('karte'); karte.append(n['.kopfmix']);   // something else took the strip together with the headphones
  const ohneMaster = (s) => (s === '#mischer .mitte' ? null : $(s));
  ordneMitte('produktion', ohneMaster);
  assert.deepEqual(n['#fx'].kinder.map((k) => k.id), FX, 'the header FX row is back');
  assert.equal(n['.kopfmix'].eltern, n['#kopf']);
});
