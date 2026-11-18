// Regression (audit U00): command ids start from the monotonic clock in ns. Above 2^53 (104 days of uptime) Number(++id) rounds
// neighbouring ids to the same double, so receipts of different commands share one list. The ids must stay exact integers.
// The server is constructed in-process and never started (no port bound); the clock is stubbed to a host that has been up 105 days.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { K, TEST_INSTANZ } from './support/instance.mjs';

test('command ids stay distinct exact integers when the monotonic clock is past 2^53 ns', (t) => {
  const alt = process.env.CYPHERDJ_INSTANZ;
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const hr = process.hrtime.bigint;
  process.hrtime.bigint = () => 9_100_000_000_000_001n;   // 105 days in ns
  let o;
  try {
    o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('id-bestand-'), arbeitsbestand: tmp('id-ab-'),
      mutationen: [], loops: tmp('id-loops-'), kits: tmp('id-kits-'), welleCache: tmp('id-welle-'), musterOrdner: tmp('id-muster-'), hotcueOrdner: tmp('id-hc-'),
      rasterOrdner: tmp('id-raster-'), huellen: path.join(tmp('id-huellen-'), 'huellen'), wirtOrdner: tmp('id-wirt-'), sammlungen: tmp('id-sets-'),
      musterBibliothek: tmp('id-mb-'), musterSets: tmp('id-ms-'), mediathek: path.join(tmp('id-med-'), 'nix.sqlite'), katalog: path.join(tmp('id-kat-'), 'nix.sqlite'),
      digitalout: path.join(tmp('id-do-'), 'nix'), kernPruefmodus: true, log: () => {} });
  } finally { process.hrtime.bigint = hr; }
  t.after(() => {
    try { o.kern.sock.close(); } catch { /* never bound */ }
    if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt;
  });
  const ids = Array.from({ length: 1000 }, () => Number(++o.id));
  assert.ok(ids.every(Number.isSafeInteger), 'every id is a safe integer');
  assert.equal(new Set(ids).size, ids.length, 'no two commands share an id');
});
