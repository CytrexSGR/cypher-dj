// mehrkern Task 5: /lage carries the state of the kern's Hall pool, as the kern said it with /zustand/hall_pool (the real runtime state, nothing derived from the
// config). Absent while no message came (a kern without a pool, or an old kern); after it {an: boolean, faeden, spaet, zurueck}; the latest message wins, so a
// switch-off of the pool (an 0) shows up as an: false. Runs the real in-process server without a kern (pattern of kanal_limiter_lage.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './hilfen/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './hilfen/instanz.mjs';

belegeTestInstanz();
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });

async function realerServer(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const bkOrdner = tmp('hp5-graphen-');
  fs.mkdirSync(path.join(bkOrdner, 'samples'));
  const huellen = path.join(tmp('hp5-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = { inst: process.env.CYPHERDJ_INSTANZ, bk: process.env.CYPHERDJ_BK_ORDNER };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  process.env.CYPHERDJ_BK_ORDNER = bkOrdner;
  const o = new Oberflaeche({ port: 47340 + K, kernPort: 47140 + K, aboPort: 47190 + K, leitstandWs: 47240 + K, bestand: tmp('hp5-bestand-'), arbeitsbestand: tmp('hp5-ab-'),
    mutationen: [], loops: tmp('hp5-loops-'), kits: tmp('hp5-kits-'), welleCache: tmp('hp5-welle-'), musterOrdner: tmp('hp5-muster-'), hotcueOrdner: tmp('hp5-hc-'),
    rasterOrdner: tmp('hp5-raster-'), huellen, wirtOrdner: tmp('hp5-wirt-'), sammlungen: tmp('hp5-sets-'), musterBibliothek: tmp('hp5-mb-'), musterSets: tmp('hp5-ms-'),
    mediathek: path.join(tmp('hp5-med-'), 'nix.sqlite'), katalog: path.join(tmp('hp5-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('hp5-do-'), 'nix'),
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('hp5-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('hp5-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => log.push(z) });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
    if (alt.bk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt.bk;
  });
  return { o, url: `http://127.0.0.1:${47340 + K}` };
}

test('Task 5: /lage has no hall_pool before the kern said anything; /zustand/hall_pool 1 3 0 0 gives {an: true, faeden: 3, spaet: 0, zurueck: 0}; the switch-off (an 0, counters) shows an: false', { timeout: 60000 }, async (t) => {
  const { o, url } = await realerServer(t);
  const lage = async () => (await hol(`${url}/lage`)).json();
  let l = await lage();
  assert.equal('hall_pool' in l, false, `absent before any message: ${JSON.stringify(l.hall_pool)}`);
  o.vomKern({ adresse: '/zustand/hall_pool', felder: { an: 1, faeden: 3, spaet: 0, zurueck: 0 } });
  l = await lage();
  assert.deepEqual(l.hall_pool, { an: true, faeden: 3, spaet: 0, zurueck: 0 });
  assert.equal(typeof l.hall_pool.an, 'boolean');
  o.vomKern({ adresse: '/zustand/hall_pool', felder: { an: 0, faeden: 3, spaet: 5, zurueck: 5 } });   // the pool switched itself off; the latest message wins
  l = await lage();
  assert.deepEqual(l.hall_pool, { an: false, faeden: 3, spaet: 5, zurueck: 5 });
  o.vomKern({ adresse: '/zustand/hall_pool', felder: { an: 0, faeden: 0, spaet: 0, zurueck: 0 } });
  l = await lage();
  assert.deepEqual(l.hall_pool, { an: false, faeden: 0, spaet: 0, zurueck: 0 });
});
