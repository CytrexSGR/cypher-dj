// 1.15 A7b: /zustand/spektrum (§5.5e) on the page server. (1) the stream: throttled to 40 ms (25 Hz) per source (key address + kanal), the last frame
// of a burst wins, a switch of the source is not delayed by the old source's key, 25 Hz passes without loss. (2) GET /spektrum: the last frame, or
// {leer:true} while the selector is 0 (known from the /e/regler echo of spektrum/kanal), before the first frame, and for a late frame of the
// previous source; the stored frame is dropped when the selector changes.
// Mutants (run, each red): entry out of DROSSEL_MS (S1 burst); key without the source (S1 two sources); GET without the source check (S6 late frame);
// no drop of the stored frame on a selector change (S6 X -> 0 -> X: only this test sees it, the source check cannot).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel, warte } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';

const rahmen = (kanal, n) => ({ kanal, rahmen: n, pegel: '-300,-310,-320' });

async function oeffneStrom(t) {
  const { o, url } = await stapel(t);
  const zeilen = [];
  const ac = new AbortController();
  t.after(() => ac.abort());
  (async () => { const s = await fetch(`${url}/strom`, { signal: ac.signal }); for await (const teil of s.body) zeilen.push(new TextDecoder().decode(teil)); })().catch(() => {});
  for (let n = 0; n < 50 && zeilen.length === 0; n++) await warte(20);
  const treffer = () => zeilen.join('').split('\n').filter((z) => z.includes('"a":"/zustand/spektrum"')).map((z) => JSON.parse(z.slice(6)).f);
  const lies = async () => (await fetch(`${url}/spektrum`)).json();
  return { i: innen(o), treffer, lies };
}

test('S1 stream: a burst inside 40 ms is condensed to the last frame; the first passes at once', async (t) => {
  const { i, treffer } = await oeffneStrom(t);
  i.vomKern('/zustand/spektrum', rahmen('erz/1', 1));
  i.vomKern('/zustand/spektrum', rahmen('erz/1', 2));
  i.vomKern('/zustand/spektrum', rahmen('erz/1', 3));
  await warte(15);
  assert.deepEqual(treffer().map((f) => f.rahmen), [1], 'the first at once, nothing more inside 40 ms');
  for (let n = 0; n < 50 && treffer().length < 2; n++) await warte(10);
  assert.deepEqual(treffer().map((f) => f.rahmen), [1, 3], 'then exactly one condensed frame, the last one counts');
  assert.equal(treffer()[0].pegel, '-300,-310,-320', 'fields arrive as the contract names them');
});

test('S1 stream: two sources in the same millisecond both pass (key per source); 25 Hz passes without loss', async (t) => {
  const { i, treffer } = await oeffneStrom(t);
  i.vomKern('/zustand/spektrum', rahmen('erz/1', 7));
  i.vomKern('/zustand/spektrum', rahmen('erz/2', 1));
  await warte(15);
  assert.deepEqual(treffer().map((f) => f.kanal).sort(), ['erz/1', 'erz/2'], 'a source change is not held back by the old key');
  for (let r = 2; r <= 6; r++) {
    await warte(45);
    i.vomKern('/zustand/spektrum', rahmen('erz/2', r));
  }
  await warte(60);
  assert.deepEqual(treffer().filter((f) => f.kanal === 'erz/2').map((f) => f.rahmen), [1, 2, 3, 4, 5, 6], 'positive control: frames 45 ms apart all pass');
});

test('S6 GET /spektrum: the last frame, or {leer:true}', async (t) => {
  const { i, lies } = await oeffneStrom(t);
  assert.deepEqual(await lies(), { leer: true }, 'no frame yet');
  i.vomKern('/e/regler', { pfad: 'spektrum/kanal', wert: 0, halter: 'frei', sample: 0, beat: 0 });
  i.vomKern('/zustand/spektrum', rahmen('erz/1', 4));   // a late frame while the selector is 0
  assert.deepEqual(await lies(), { leer: true }, 'selector 0: empty even though a frame is stored');
  i.vomKern('/e/regler', { pfad: 'spektrum/kanal', wert: 6, halter: 'frei', sample: 0, beat: 0 });   // erz/2
  assert.deepEqual(await lies(), { leer: true }, 'the switch dropped the stored frame');
  i.vomKern('/zustand/spektrum', rahmen('erz/1', 5));   // the old source arrives late
  assert.deepEqual(await lies(), { leer: true }, 'a late frame of the previous source is not served');
  i.vomKern('/zustand/spektrum', rahmen('erz/2', 1));
  const r = await lies();
  assert.equal(r.leer, false);
  assert.equal(r.kanal, 'erz/2');
  assert.equal(r.rahmen, 1);
  assert.equal(r.pegel, '-300,-310,-320');
  assert.ok(r.alter_ms >= 0 && r.alter_ms < 1000);
  i.vomKern('/e/regler', { pfad: 'spektrum/kanal', wert: 19, halter: 'frei', sample: 0, beat: 0 });
  i.vomKern('/zustand/spektrum', rahmen('master', 2));
  assert.equal((await lies()).kanal, 'master', 'selector 19 is master');
  i.vomKern('/e/regler', { pfad: 'spektrum/kanal', wert: 0, halter: 'frei', sample: 0, beat: 0 });
  assert.deepEqual(await lies(), { leer: true }, 'back to 0: empty again');
});

test('S6 GET /spektrum: a server that missed the selector echo still serves the frames it sees', async (t) => {
  const { i, lies } = await oeffneStrom(t);
  i.vomKern('/zustand/spektrum', rahmen('bus/2', 9));
  const r = await lies();
  assert.equal(r.leer, false);
  assert.equal(r.kanal, 'bus/2');
});

test('S6 GET /spektrum: X -> 0 -> X does not serve the frame from before the stop', async (t) => {
  const { i, lies } = await oeffneStrom(t);
  i.vomKern('/e/regler', { pfad: 'spektrum/kanal', wert: 6, halter: 'frei', sample: 0, beat: 0 });
  i.vomKern('/zustand/spektrum', rahmen('erz/2', 41));
  assert.equal((await lies()).leer, false, 'control: the frame is served');
  i.vomKern('/e/regler', { pfad: 'spektrum/kanal', wert: 0, halter: 'frei', sample: 0, beat: 0 });
  await warte(300);
  i.vomKern('/e/regler', { pfad: 'spektrum/kanal', wert: 6, halter: 'frei', sample: 0, beat: 0 });
  const r = await lies();
  assert.deepEqual(r, { leer: true }, 'back on erz/2 without a new frame: empty, not the old frame: ' + JSON.stringify(r));
  i.vomKern('/zustand/spektrum', rahmen('erz/2', 1));
  assert.equal((await lies()).rahmen, 1, 'positive control: a new frame is served');
});
