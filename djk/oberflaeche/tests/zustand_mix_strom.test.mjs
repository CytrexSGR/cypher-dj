// 1.15 A6: /zustand/mix (§5.5d, 10 Hz per channel) and /zustand/spektrum (§5.5e, 25 Hz) go to /strom (DURCHREICHEN).
// /zustand/mix is throttled to 100 ms PER CHANNEL (key address + kanal, like /zustand/komp): three channels in the same millisecond all arrive,
// a second message of one channel inside 100 ms is condensed to the last, and 10 Hz passes without loss. /zustand/spektrum (A7b: throttled to 40 ms
// per source) is covered by spektrum_strom.test.mjs.
// Mutants: entry out of DURCHREICHEN; entry out of DROSSEL_MS; the throttle key without the channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel, warte } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';

const mix = (kanal, n) => ({ kanal, gate_db: 0, mb_tief_db: n, mb_mitte_db: 0, mb_hoch_db: 0, lim_db: 0 });

async function oeffneStrom(t) {
  const { o, url } = await stapel(t);
  const zeilen = [];
  const ac = new AbortController();
  t.after(() => ac.abort());
  (async () => { const s = await fetch(`${url}/strom`, { signal: ac.signal }); for await (const teil of s.body) zeilen.push(new TextDecoder().decode(teil)); })().catch(() => {});
  for (let n = 0; n < 50 && zeilen.length === 0; n++) await warte(20);
  const treffer = (adresse) => zeilen.join('').split('\n').filter((z) => z.includes(`"a":"${adresse}"`)).map((z) => JSON.parse(z.slice(6)));
  return { i: innen(o), zeilen, treffer };
}

test('Strom: /zustand/mix is passed on per channel; inside 100 ms one channel is condensed to the last message', async (t) => {
  const { i, treffer } = await oeffneStrom(t);
  i.vomKern('/zustand/mix', mix('erz/1', 1));
  i.vomKern('/zustand/mix', mix('bus/1', 2));
  i.vomKern('/zustand/mix', mix('bus/2', 3));
  for (let n = 0; n < 50 && treffer('/zustand/mix').length < 3; n++) await warte(20);
  assert.deepEqual(treffer('/zustand/mix').map((x) => x.f.kanal).sort(), ['bus/1', 'bus/2', 'erz/1'], 'three channels in the same millisecond: all three at once');
  assert.equal(treffer('/zustand/mix')[0].f.gate_db, 0);
  assert.ok(treffer('/zustand/mix').some((x) => x.f.kanal === 'bus/1' && x.f.mb_tief_db === 2), 'fields arrive as the contract names them');
  i.vomKern('/zustand/mix', mix('bus/1', 20));
  i.vomKern('/zustand/mix', mix('bus/1', 30));
  await warte(40);
  assert.equal(treffer('/zustand/mix').filter((x) => x.f.kanal === 'bus/1').length, 1, 'throttle: nothing more from bus/1 inside 100 ms');
  for (let n = 0; n < 50 && treffer('/zustand/mix').filter((x) => x.f.kanal === 'bus/1').length < 2; n++) await warte(20);
  const b1 = treffer('/zustand/mix').filter((x) => x.f.kanal === 'bus/1');
  assert.equal(b1.length, 2, 'then exactly one condensed message');
  assert.equal(b1[1].f.mb_tief_db, 30, 'the last one counts');
});

test('Strom: 10 Hz per channel passes without loss (positive control for the throttle)', async (t) => {
  const { i, treffer } = await oeffneStrom(t);
  for (let k = 1; k <= 6; k++) {
    i.vomKern('/zustand/mix', mix('bus/3', k));
    await warte(110);
  }
  await warte(120);
  assert.deepEqual(treffer('/zustand/mix').map((x) => x.f.mb_tief_db), [1, 2, 3, 4, 5, 6]);
});

test('Strom: /zustand/box (no entry) stays out of the stream', async (t) => {
  const { i, zeilen } = await oeffneStrom(t);
  i.vomKern('/zustand/box', { box: 1, belegt: 0 });
  await warte(100);
  assert.ok(!zeilen.join('').includes('/zustand/box'));
});
