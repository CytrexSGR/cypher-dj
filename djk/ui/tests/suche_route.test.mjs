// GET /suche on the real server wiring (own catalogue, own folders): every group answers, none fails, the hits are the shelf's rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel, hole } from './support/media_library.mjs';
import { baueKatalog } from './support/catalog.mjs';

test('/suche: all kinds answer on the wired server; samples are the rows of /stoebern', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-suche-route-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lib = path.join(dir, 'lib'), sampler = path.join(dir, 'sampler');
  fs.mkdirSync(lib); fs.mkdirSync(sampler);
  const f = (n) => { const p = path.join(lib, n); fs.writeFileSync(p, 'x'); return p; };
  const datei = baueKatalog(path.join(dir, 'kat'), [
    { n: 1, typ: 'oneshot', name: 'kick1', instrument: 'kick', pfad: f('kick1.wav') },
    { n: 2, typ: 'loop', name: 'loop1', bpm: 126, camelot: '8A', pfad: f('loop1.wav') },
  ]);
  const s = await stapel(t, { katalog: datei });
  s.optionen.samplerOrdner = sampler;
  const r = await hole(s.url, '/suche?q=kick');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.gruppen.map((g) => g.art), ['samples', 'loops', 'instrumente', 'geraete', 'presets', 'module', 'schnitte']);
  assert.deepEqual(r.j.gruppen.filter((g) => g.fehler !== undefined), [], 'no group fails');
  const alt = await hole(s.url, '/stoebern?typ=oneshot&schutz=aus&vorrang=1&text=kick');
  assert.deepEqual(r.j.gruppen[0].treffer, alt.j.treffer, 'the hit is the row of the shelf');
  assert.equal(r.j.gruppen[0].zahl, alt.j.gesamt);
  const loops = await hole(s.url, '/suche?q=loop1&arten=loops&passt=1');
  assert.equal(loops.j.passt, null, 'no module is open: nothing to fit');
  assert.equal(loops.j.gruppen[0].zahl, 1);
});
