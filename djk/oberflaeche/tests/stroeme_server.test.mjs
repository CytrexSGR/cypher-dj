// S18 task 5: the stream whitelists of the page server follow djk/vertrag/stroeme.ts. Streams 5, 6, 7, 9, 10 are accepted by the
// strudel, auto and muster routes and write into their own folder <muster>N; 4, 8 and 11 stay refused. /lage studio.stroeme lists
// a Baukasten stream only while its erzeuger heartbeat (lebt.json) is fresh.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './hilfen/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './hilfen/instanz.mjs';
import { schreibeLebt } from '../../erzeuger/src/muster_stand.mjs';

belegeTestInstanz();
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });

async function stapel(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const huellen = path.join(tmp('s18-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const alt = process.env.CYPHERDJ_INSTANZ;
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const muster = tmp('s18-muster-');
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('s18-bestand-'), arbeitsbestand: tmp('s18-ab-'),
    mutationen: [], loops: tmp('s18-loops-'), kits: tmp('s18-kits-'), welleCache: tmp('s18-welle-'), musterOrdner: muster, hotcueOrdner: tmp('s18-hc-'),
    rasterOrdner: tmp('s18-raster-'), huellen, wirtOrdner: tmp('s18-wirt-'), sammlungen: tmp('s18-sets-'), musterBibliothek: tmp('s18-mb-'), musterSets: tmp('s18-ms-'),
    mediathek: path.join(tmp('s18-med-'), 'nix.sqlite'), katalog: path.join(tmp('s18-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('s18-do-'), 'nix'),
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('s18-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('s18-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: () => {} });
  await o.starte();
  t.after(async () => { await o.stoppe(); if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt; });
  const url = `http://127.0.0.1:${47300 + K}`;
  const post = (pfad, daten, kopf = {}) => hol(`${url}${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(daten) })
    .then(async (r) => ({ code: r.status, j: await r.json() }));
  const lage = async () => (await hol(`${url}/lage`)).json();
  return { o, url, muster, post, lage };
}

test('strudel route: streams 5, 6, 7, 9, 10 write into <muster>N/strom1.js; 4, 8, 11 and 0 are refused (400)', async (t) => {
  const { post, muster } = await stapel(t);
  for (const s of [5, 6, 7, 9, 10]) {
    const r = await post('/strudel', { strom: s, text: `note("c${s % 5 + 2}")` });
    assert.equal(r.code, 200, JSON.stringify([s, r]));
    assert.match(fs.readFileSync(path.join(`${muster}${s}`, 'strom1.js'), 'utf8'), /note\("c/, `stream ${s}`);
  }
  for (const s of [4, 8, 11, 0, 17]) {
    const r = await post('/strudel', { strom: s, text: 'note("c3")' });
    assert.equal(r.code, 400, JSON.stringify([s, r]));
    assert.equal(fs.existsSync(`${muster}${s}`), false, `no folder for the refused stream ${s}`);
  }
  // negative control: the old streams are untouched
  assert.equal((await post('/strudel', { strom: 2, text: 'note("c2")' })).code, 200);
  assert.equal((await post('/strudel', { text: 's("bd")' })).code, 200);
});

test('auto route: AUTO switch and read for stream 9 and 10 (own autonom.json), refused for 8', async (t) => {
  const { post, url, muster } = await stapel(t);
  let r = await post('/strudel/autonom', { strom: 9, an: false });
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.equal(JSON.parse(fs.readFileSync(`${muster}9/autonom.json`, 'utf8')).an, false);
  const g = await (await hol(`${url}/strudel?strom=9`)).json();
  assert.equal(g.autonom, false);
  assert.equal((await (await hol(`${url}/strudel?strom=10`)).json()).autonom, true, 'stream 10 is independent of 9');
  r = await post('/strudel/autonom', { strom: 8, an: false });
  assert.equal(r.code, 400, JSON.stringify(r));
  // Cypher is refused on stream 9 while AUTO is off, andreas is not
  r = await post('/strudel', { strom: 9, text: 'note("c3")' }, { 'x-djk-quelle': 'cypher' });
  assert.equal(r.code, 409, JSON.stringify(r));
  assert.equal(r.j.fehler, 'auto_aus');
  r = await post('/strudel', { strom: 9, text: 'note("c3")' });
  assert.equal(r.code, 200, JSON.stringify(r));
});

test('/lage studio.stroeme: 3 entries without heartbeat files, a fresh lebt.json adds exactly that stream, a stale one does not', async (t) => {
  const { lage, muster } = await stapel(t);
  const strom = async () => (await lage()).studio.stroeme.map((x) => x.strom);
  assert.deepEqual(await strom(), [1, 2, 3]);
  fs.mkdirSync(`${muster}6`, { recursive: true });
  schreibeLebt(`${muster}6`, { strom: 6, ziel: 'midi:3:2' }, Date.now());
  assert.deepEqual(await strom(), [1, 2, 3, 6]);
  fs.mkdirSync(`${muster}10`, { recursive: true });
  schreibeLebt(`${muster}10`, { strom: 10, ziel: 'midi:4:2' }, Date.now() - 9000);
  assert.deepEqual(await strom(), [1, 2, 3, 6], 'a heartbeat 9 s old is dead');
  schreibeLebt(`${muster}10`, { strom: 10, ziel: 'midi:4:2' }, Date.now());
  assert.deepEqual(await strom(), [1, 2, 3, 6, 10]);
});
