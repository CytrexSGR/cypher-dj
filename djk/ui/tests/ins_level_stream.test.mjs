// Device faces T9 seam: /e/stufe_pegel (§5.5g, ,sff kanal + ein_db + aus_db, 20 Hz per running compressor or limiter stage) goes to /strom (DURCHREICHEN), throttled to
// 100 ms per stage (key address + kanal). It is not kept for /lage (a meter, no state).
// Mutants: entry out of DURCHREICHEN; entry out of DROSSEL_MS; the throttle key without the channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel, warte } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';

async function oeffneStrom(t) {
  const { o, url } = await stapel(t);
  const zeilen = [];
  const ac = new AbortController();
  t.after(() => ac.abort());
  (async () => { const s = await fetch(`${url}/strom`, { signal: ac.signal }); for await (const teil of s.body) zeilen.push(new TextDecoder().decode(teil)); })().catch(() => {});
  for (let n = 0; n < 50 && zeilen.length === 0; n++) await warte(20);
  const treffer = (adresse) => zeilen.join('').split('\n').filter((z) => z.includes(`"a":"${adresse}"`)).map((z) => JSON.parse(z.slice(6)));
  const lage = async () => (await fetch(`${url}/lage`, { headers: { connection: 'close' } })).json();
  return { i: innen(o), treffer, lage };
}

test('Strom: /e/stufe_pegel is passed on per stage with the contract field names; inside 100 ms one stage is condensed to the last message', async (t) => {
  const { i, treffer } = await oeffneStrom(t);
  i.vomKern('/e/stufe_pegel', { kanal: 'ins/komp/1', ein_db: -12, aus_db: -15.2 });
  i.vomKern('/e/stufe_pegel', { kanal: 'ins/lim/2', ein_db: -3, aus_db: -6 });
  i.vomKern('/e/stufe_pegel', { kanal: 'komp/erz/1', ein_db: -200, aus_db: -200 });
  for (let n = 0; n < 50 && treffer('/e/stufe_pegel').length < 3; n++) await warte(20);
  assert.deepEqual(treffer('/e/stufe_pegel').map((x) => x.f.kanal).sort(), ['ins/komp/1', 'ins/lim/2', 'komp/erz/1'], 'three stages in the same millisecond: all three');
  assert.ok(treffer('/e/stufe_pegel').some((x) => x.f.kanal === 'ins/komp/1' && x.f.ein_db === -12 && x.f.aus_db === -15.2), 'fields arrive as the contract names them');
  i.vomKern('/e/stufe_pegel', { kanal: 'ins/komp/1', ein_db: -10, aus_db: -11 });
  i.vomKern('/e/stufe_pegel', { kanal: 'ins/komp/1', ein_db: -9, aus_db: -10 });
  await warte(40);
  assert.equal(treffer('/e/stufe_pegel').filter((x) => x.f.kanal === 'ins/komp/1').length, 1, 'throttle: nothing more from this stage inside 100 ms');
  for (let n = 0; n < 50 && treffer('/e/stufe_pegel').filter((x) => x.f.kanal === 'ins/komp/1').length < 2; n++) await warte(20);
  const s1 = treffer('/e/stufe_pegel').filter((x) => x.f.kanal === 'ins/komp/1');
  assert.equal(s1.length, 2, 'then exactly one condensed message');
  assert.equal(s1[1].f.ein_db, -9, 'the last one counts');
});

test('lage does not carry the stage levels (a meter, no state)', async (t) => {
  const { i, lage } = await oeffneStrom(t);
  i.vomKern('/e/stufe_pegel', { kanal: 'ins/komp/3', ein_db: -12, aus_db: -14 });
  const l = await lage();
  assert.equal('stufe_pegel' in l, false);
});
