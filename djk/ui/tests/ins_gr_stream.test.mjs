// 1.10 slice 4a seam S2: /e/ins_gr (§5.5f, ,sf kanal + gr_db, 20 Hz per running insert stage) goes to /strom (DURCHREICHEN), throttled to 100 ms per stage
// (key address + kanal), and the last reading of every stage that ran in the last 500 ms is in /lage as `ins_gr {"ins/komp/<n>": dB}` (the hand's view).
// Mutants: entry out of DURCHREICHEN; entry out of DROSSEL_MS; the throttle key without the channel; /lage without the 500 ms rule.
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

test('Strom: /e/ins_gr is passed on per stage; inside 100 ms one stage is condensed to the last message', async (t) => {
  const { i, treffer } = await oeffneStrom(t);
  i.vomKern('/e/ins_gr', { kanal: 'ins/komp/1', gr_db: 1 });
  i.vomKern('/e/ins_gr', { kanal: 'ins/komp/2', gr_db: 2 });
  i.vomKern('/e/ins_gr', { kanal: 'ins/komp/12', gr_db: 3 });
  for (let n = 0; n < 50 && treffer('/e/ins_gr').length < 3; n++) await warte(20);
  assert.deepEqual(treffer('/e/ins_gr').map((x) => x.f.kanal).sort(), ['ins/komp/1', 'ins/komp/12', 'ins/komp/2'], 'three stages in the same millisecond: all three');
  assert.ok(treffer('/e/ins_gr').some((x) => x.f.kanal === 'ins/komp/2' && x.f.gr_db === 2), 'fields arrive as the contract names them');
  i.vomKern('/e/ins_gr', { kanal: 'ins/komp/1', gr_db: 20 });
  i.vomKern('/e/ins_gr', { kanal: 'ins/komp/1', gr_db: 30 });
  await warte(40);
  assert.equal(treffer('/e/ins_gr').filter((x) => x.f.kanal === 'ins/komp/1').length, 1, 'throttle: nothing more from this stage inside 100 ms');
  for (let n = 0; n < 50 && treffer('/e/ins_gr').filter((x) => x.f.kanal === 'ins/komp/1').length < 2; n++) await warte(20);
  const s1 = treffer('/e/ins_gr').filter((x) => x.f.kanal === 'ins/komp/1');
  assert.equal(s1.length, 2, 'then exactly one condensed message');
  assert.equal(s1[1].f.gr_db, 30, 'the last one counts');
});

test('lage: ins_gr holds the fresh readings per stage, is absent without any, and a stage that stopped sending falls out after 500 ms', async (t) => {
  const { i, lage } = await oeffneStrom(t);
  assert.equal('ins_gr' in await lage(), false, 'absent while no stage ran');
  i.vomKern('/e/ins_gr', { kanal: 'ins/komp/3', gr_db: 4.46 });
  i.vomKern('/e/ins_gr', { kanal: 'ins/komp/5', gr_db: 0 });
  assert.deepEqual((await lage()).ins_gr, { 'ins/komp/3': 4.5, 'ins/komp/5': 0 });
  await warte(350);
  i.vomKern('/e/ins_gr', { kanal: 'ins/komp/5', gr_db: 2 });   // stage 5 keeps running, stage 3 stopped
  await warte(250);
  assert.deepEqual((await lage()).ins_gr, { 'ins/komp/5': 2 });
  await warte(600);
  assert.equal('ins_gr' in await lage(), false, 'everything expired');
});
