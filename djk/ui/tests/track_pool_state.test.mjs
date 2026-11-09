// mehrkern slice 3.2 Task 8: /lage carries the state of the kern's track-phase pool, as the kern said it with /zustand/spur_pool (the real runtime state, nothing derived from the
// config). Absent while no message came (a kern without a pool, or an old kern); after it {an: boolean, modus: 'aus'|'an'|'auto', blocks_parallel, einheiten_worker, einheiten_caller, seriell, haengt, spaet, zurueck}; the latest message wins, so a
// switch-off of the pool (an 0) shows up as an: false. Runs the real in-process server without a kern (pattern of channel_limiter_state.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';

belegeTestInstanz();
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });

async function realerServer(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const bkOrdner = tmp('sp8-graphen-');
  fs.mkdirSync(path.join(bkOrdner, 'samples'));
  const huellen = path.join(tmp('sp8-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = { inst: process.env.CYPHERDJ_INSTANZ, bk: process.env.CYPHERDJ_BK_ORDNER };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  process.env.CYPHERDJ_BK_ORDNER = bkOrdner;
  const o = new Oberflaeche({ port: 47340 + K, kernPort: 47140 + K, aboPort: 47190 + K, leitstandWs: 47240 + K, bestand: tmp('sp8-bestand-'), arbeitsbestand: tmp('sp8-ab-'),
    mutationen: [], loops: tmp('sp8-loops-'), kits: tmp('sp8-kits-'), welleCache: tmp('sp8-welle-'), musterOrdner: tmp('sp8-muster-'), hotcueOrdner: tmp('sp8-hc-'),
    rasterOrdner: tmp('sp8-raster-'), huellen, wirtOrdner: tmp('sp8-wirt-'), sammlungen: tmp('sp8-sets-'), musterBibliothek: tmp('sp8-mb-'), musterSets: tmp('sp8-ms-'),
    mediathek: path.join(tmp('sp8-med-'), 'nix.sqlite'), katalog: path.join(tmp('sp8-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('sp8-do-'), 'nix'),
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('sp8-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('sp8-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => log.push(z) });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
    if (alt.bk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt.bk;
  });
  return { o, url: `http://127.0.0.1:${47340 + K}` };
}

const F = (an, modus, bp, ew, ec, ss, h, sp, z) => ({ an, modus, blocks_parallel: bp, einheiten_worker: ew, einheiten_caller: ec, seriell_summe: ss, haengt: h, spaet: sp, zurueck: z });

test('Task 8: /lage has no spur_pool before the kern said anything; /zustand/spur_pool gives the object with a real boolean; the switch-off shows an: false; modus 0/1/2 is aus/an/auto', { timeout: 60000 }, async (t) => {
  const { o, url } = await realerServer(t);
  const lage = async () => (await hol(`${url}/lage`)).json();
  let l = await lage();
  assert.equal('spur_pool' in l, false, `absent before any message: ${JSON.stringify(l.spur_pool)}`);
  o.vomKern({ adresse: '/zustand/spur_pool', felder: F(1, 1, 10, 20, 30, 40, 0, 1, 2) });
  l = await lage();
  assert.deepEqual(l.spur_pool, { an: true, modus: 'an', blocks_parallel: 10, einheiten_worker: 20, einheiten_caller: 30, seriell: 40, haengt: 0, spaet: 1, zurueck: 2 });
  assert.equal(typeof l.spur_pool.an, 'boolean');
  o.vomKern({ adresse: '/zustand/spur_pool', felder: F(0, 2, 10, 20, 30, 41, 1, 5, 5) });   // the pool switched itself off (auto); the latest message wins
  l = await lage();
  assert.deepEqual(l.spur_pool, { an: false, modus: 'auto', blocks_parallel: 10, einheiten_worker: 20, einheiten_caller: 30, seriell: 41, haengt: 1, spaet: 5, zurueck: 5 });
  o.vomKern({ adresse: '/zustand/spur_pool', felder: F(0, 0, 0, 0, 0, 0, 0, 0, 0) });
  l = await lage();
  assert.deepEqual(l.spur_pool, { an: false, modus: 'aus', blocks_parallel: 0, einheiten_worker: 0, einheiten_caller: 0, seriell: 0, haengt: 0, spaet: 0, zurueck: 0 });
});
