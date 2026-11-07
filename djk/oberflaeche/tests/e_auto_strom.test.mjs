// 1.12 Automation slice 3 task 3: /e/auto (INTERFACES 5.13) goes to /strom (DURCHREICHEN), every change at once (no throttle: the last of two quick
// changes must not swallow the first). Kern stand-in, no sound. Mutant: remove '/e/auto' from DURCHREICHEN.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel, warte } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';

test('Strom: /e/auto is passed through, every change arrives (no throttle); /e/auto_punkt-like unknown addresses still do not', async (t) => {
  const { o, url } = await stapel(t);
  const zeilen = [];
  const ac = new AbortController();
  t.after(() => ac.abort());
  (async () => { const s = await fetch(`${url}/strom`, { signal: ac.signal }); for await (const teil of s.body) zeilen.push(new TextDecoder().decode(teil)); })().catch(() => {});
  for (let n = 0; n < 50 && zeilen.length === 0; n++) await warte(20);
  const treffer = () => zeilen.join('').split('\n').filter((z) => z.includes('"a":"/e/auto"')).map((z) => JSON.parse(z.slice(6)));
  const i = innen(o);
  i.vomKern('/e/auto', { spur: 3, ziel: 'fader', zustand: 1 });
  i.vomKern('/e/auto', { spur: 3, ziel: 'fader', zustand: 0 });
  for (let n = 0; n < 50 && treffer().length < 2; n++) await warte(20);
  assert.equal(treffer().length, 2, 'both changes arrive');
  assert.deepEqual(treffer().map((e) => e.f.zustand), [1, 0]);
  assert.equal(treffer()[0].f.spur, 3);
  assert.equal(treffer()[0].f.ziel, 'fader');
  i.vomKern('/e/gibtsnicht', { x: 1 });   // negative control
  await warte(100);
  assert.ok(!zeilen.join('').includes('/e/gibtsnicht'));
});
