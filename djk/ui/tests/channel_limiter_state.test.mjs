// 1.15 A5c: /lage carries the kern's channel limiter state, as the kern said it with /e/kanal_limiter (way B: the real runtime state, nothing
// derived from the config). Absent while no message came (the page treats absent as "disabled", effects.js limiterZustand); a real boolean after.
// Runs the real in-process server without a kern (the pattern of proj_bk_no_core.test.mjs): server.test.mjs is red at its start assertion on this
// branch (the stapel helper counts 2 commands instead of 1), so it cannot carry this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';
import { limiterZustand } from '../public/effects.js';

belegeTestInstanz();
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });

async function realerServer(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const bkOrdner = tmp('kl5c-graphen-');
  fs.mkdirSync(path.join(bkOrdner, 'samples'));
  const huellen = path.join(tmp('kl5c-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = { inst: process.env.CYPHERDJ_INSTANZ, bk: process.env.CYPHERDJ_BK_ORDNER };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  process.env.CYPHERDJ_BK_ORDNER = bkOrdner;
  const o = new Oberflaeche({ port: 47340 + K, kernPort: 47140 + K, aboPort: 47190 + K, leitstandWs: 47240 + K, bestand: tmp('kl5c-bestand-'), arbeitsbestand: tmp('kl5c-ab-'),
    mutationen: [], loops: tmp('kl5c-loops-'), kits: tmp('kl5c-kits-'), welleCache: tmp('kl5c-welle-'), musterOrdner: tmp('kl5c-muster-'), hotcueOrdner: tmp('kl5c-hc-'),
    rasterOrdner: tmp('kl5c-raster-'), huellen, wirtOrdner: tmp('kl5c-wirt-'), sammlungen: tmp('kl5c-sets-'), musterBibliothek: tmp('kl5c-mb-'), musterSets: tmp('kl5c-ms-'),
    mediathek: path.join(tmp('kl5c-med-'), 'nix.sqlite'), katalog: path.join(tmp('kl5c-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('kl5c-do-'), 'nix'),
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('kl5c-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('kl5c-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => log.push(z) });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
    if (alt.bk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt.bk;
  });
  const url = `http://127.0.0.1:${47340 + K}`;
  return { o, url };
}


test('A5c: /lage has no kanal_limiter before the kern said anything; after /e/kanal_limiter 1 26 it is {gebaut: true, latenz_samples: 26}; 0 0 gives {gebaut: false, latenz_samples: 0}', { timeout: 60000 }, async (t) => {
  const { o, url } = await realerServer(t);
  const lage = async () => (await hol(`${url}/lage`)).json();
  let l = await lage();
  assert.equal('kanal_limiter' in l, false, `absent before any message: ${JSON.stringify(l.kanal_limiter)}`);
  assert.equal(limiterZustand(l).gebaut, false, 'the page treats absent as disabled');
  o.vomKern({ adresse: '/e/kanal_limiter', felder: { gebaut: 1, latenz_samples: 26 } });
  l = await lage();
  assert.deepEqual(l.kanal_limiter, { gebaut: true, latenz_samples: 26 });
  assert.equal(typeof l.kanal_limiter.gebaut, 'boolean');
  assert.equal(limiterZustand(l).gebaut, true, 'the page enables the limiter controls on gebaut === true');
  o.vomKern({ adresse: '/e/kanal_limiter', felder: { gebaut: 0, latenz_samples: 0 } });   // a kern restart says it again; the latest wins
  l = await lage();
  assert.deepEqual(l.kanal_limiter, { gebaut: false, latenz_samples: 0 });
  assert.equal(limiterZustand(l).gebaut, false);
});
