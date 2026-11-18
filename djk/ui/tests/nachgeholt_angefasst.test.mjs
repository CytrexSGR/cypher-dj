// Regression (audit C01): a restore held back by the 30 s guard (boxFxPlanen, guard branch) must not overwrite an FX unit that was set again
// during the wait. Server constructed in-process, never started (no port bound); kern.sende is replaced by a recorder (no UDP).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { K, TEST_INSTANZ } from './support/instance.mjs';

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

test('delayed restore after a too-fast kern restart leaves an FX unit alone that was set during the wait', async (t) => {
  const alt = process.env.CYPHERDJ_INSTANZ;
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const muster = tmp('aud-muster-');
  fs.writeFileSync(path.join(muster, 'fx_von.json'), JSON.stringify({ '1': { von: 'andreas', zeit: 1 } }));
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('aud-bestand-'), arbeitsbestand: tmp('aud-ab-'),
    mutationen: [], loops: tmp('aud-loops-'), kits: tmp('aud-kits-'), welleCache: tmp('aud-welle-'), musterOrdner: muster, hotcueOrdner: tmp('aud-hc-'),
    rasterOrdner: tmp('aud-raster-'), huellen: path.join(tmp('aud-huellen-'), 'huellen'), wirtOrdner: tmp('aud-wirt-'), sammlungen: tmp('aud-sets-'),
    musterBibliothek: tmp('aud-mb-'), musterSets: tmp('aud-ms-'), mediathek: path.join(tmp('aud-med-'), 'nix.sqlite'), katalog: path.join(tmp('aud-kat-'), 'nix.sqlite'),
    digitalout: path.join(tmp('aud-do-'), 'nix'), kernPruefmodus: true, log: () => {} });
  const gesendet = [];
  o.kern.sende = (adresse, felder) => { gesendet.push({ adresse, felder }); };
  const sperre0 = Oberflaeche.BOX_FX_SPERRE_MS;
  Oberflaeche.BOX_FX_SPERRE_MS = 1500;   // the 30 s of production, shortened
  t.after(() => {
    Oberflaeche.BOX_FX_SPERRE_MS = sperre0;
    if (o.offenerPlanTimer) clearTimeout(o.offenerPlanTimer);
    if (o.wiederTimer) clearTimeout(o.wiederTimer);
    try { o.kern.sock.close(); } catch { /* never bound */ }
    if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt;
  });
  const neustart = (generation) => o.vomKern({ adresse: '/e/neustart', felder: { generation, sample: 0 } });
  const fx1 = (art) => o.vomKern({ adresse: '/e/fx', felder: { einheit: 1, art, beats: 1, wet: 0.5, param1: 0.1, param2: 0.2, param3: 0.3, an: 1 } });
  const fxSendungen = () => gesendet.filter((s) => s.adresse === '/k/fx');

  neustart(1);
  fx1(2);                    // the old FX 1 setting
  neustart(2);               // accepted restart: restores after 500 ms
  await warte(650);
  assert.equal(fxSendungen().length, 1, 'first restore sends FX 1');
  fx1(2);                    // the kern echoes the restored unit
  await warte(100);
  neustart(3);               // too fast: the plan (FX 1 = art 2) is kept for after the guard time
  await warte(200);
  fx1(7);                    // Andreas sets FX 1 on the new kern during the wait (echo /e/fx)
  await warte(1700);         // past the delayed restore
  const spaet = fxSendungen().slice(1);
  assert.deepEqual(spaet.map((s) => s.felder.art), [], 'the delayed restore must not send the old FX 1 (art 2) over the setting made during the wait');
});
