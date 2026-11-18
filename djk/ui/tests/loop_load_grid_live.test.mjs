// Regression (audit U01): POST /loop laden must forget the live grid offset of the box only when the load is accepted. An unknown name
// (400) or a refusal by the kern (status 6) leaves the old loop playing, so its offset has to stay. Server in-process, never started
// (no port bound); kern.sende is a recorder, the kern's receipts come in as /q through vomKern.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { K, TEST_INSTANZ } from './support/instance.mjs';

test('loop laden: the live grid offset survives a 400 and a refusal, and is dropped by an accepted load', async (t) => {
  const alt = process.env.CYPHERDJ_INSTANZ;
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const loops = tmp('lr-loops-');
  fs.mkdirSync(path.join(loops, 'y'));
  fs.writeFileSync(path.join(loops, 'y', 'loop.json'), JSON.stringify({ schema: 1, name: 'y', beats: 4, bpm: 128, frames: 90000, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-17 10:00' }));
  fs.writeFileSync(path.join(loops, 'y', 'loop.f32'), Buffer.alloc(90000 * 8));
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('lr-bestand-'), arbeitsbestand: tmp('lr-ab-'),
    mutationen: [], loops, kits: tmp('lr-kits-'), welleCache: tmp('lr-welle-'), musterOrdner: tmp('lr-muster-'), hotcueOrdner: tmp('lr-hc-'),
    rasterOrdner: tmp('lr-raster-'), huellen: path.join(tmp('lr-huellen-'), 'huellen'), wirtOrdner: tmp('lr-wirt-'), sammlungen: tmp('lr-sets-'),
    musterBibliothek: tmp('lr-mb-'), musterSets: tmp('lr-ms-'), mediathek: path.join(tmp('lr-med-'), 'nix.sqlite'), katalog: path.join(tmp('lr-kat-'), 'nix.sqlite'),
    digitalout: path.join(tmp('lr-do-'), 'nix'), kernPruefmodus: true, log: () => {} });
  const gesendet = [];
  o.kern.sende = (adresse, felder) => { gesendet.push({ adresse, felder }); };
  const antworten = [];
  o.json = (a, code, daten) => { antworten.push({ code, daten }); };
  t.after(() => {
    try { o.kern.sock.close(); } catch { /* never bound */ }
    if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt;
  });
  const live = () => o.loopRasterLive['1'];
  o.stand.loops = { 1: { box: 1, name: 'x', status: 3 } };
  o.loopRasterLive = { 1: { name: 'x', v: 480 } };

  await o.loop({ aktion: 'laden', box: 1, name: 'tippfehler' }, {});
  assert.equal(antworten.at(-1).code, 400, 'unknown loop name');
  assert.deepEqual(live(), { name: 'x', v: 480 }, 'a 400 leaves the live offset alone');

  const nr = gesendet.length;
  const refused = o.loop({ aktion: 'laden', box: 1, name: 'y' }, {});
  const id = gesendet[nr].felder.id;
  o.vomKern({ adresse: '/q', felder: { id, status: 6, grund: 'ki_gestoppt' } });
  await refused;
  assert.deepEqual(live(), { name: 'x', v: 480 }, 'a refusal by the kern leaves the live offset alone');

  const nr2 = gesendet.length;
  const ok = o.loop({ aktion: 'laden', box: 1, name: 'y' }, {});
  o.vomKern({ adresse: '/q', felder: { id: gesendet[nr2].felder.id, status: 2 } });
  await ok;
  assert.equal(live(), undefined, 'an accepted load takes the offset from the file: the live offset is gone');
});
