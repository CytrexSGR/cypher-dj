// 1.10 slice 4a, seam S4: the request that wiedergabe.ts writes for a project with a compressor on a track, a group, a return (pre) and the production
// master is the committed fixture djk/kern/tests/daten/wiedergabe_ketten.json, and the real kern loader reads that very file
// (djk/kern/tests/test_arr_naht_seite.cpp, ctest). This test regenerates the file from the project and fails when the committed one differs, so
// the fixture cannot go stale. Rewrite it with CYPHERDJ_FIXTURE_SCHREIBEN=1 node --test tests/naht_kern_wiedergabe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuehreListeAus, setzeDekodiert } from '../projekt/befehle.ts';
import { neuesProjekt } from '../projekt/modell.ts';
import { uebersetze } from '../projekt/wiedergabe.ts';
import { reglerAusProjekt } from '../projekt/render.ts';

const DATEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kern', 'tests', 'daten');
const FIXTURE = path.join(DATEN, 'wiedergabe_ketten.json');
const FIXTURE_REGLER = path.join(DATEN, 'render_regler_ketten.json');   // the export's control file of the same project (cypherdj-render --spur-regler)
const SHA = 'c'.repeat(64);
const FRAMES = 400000;
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;

export function projekt() {
  let p = neuesProjekt('T');
  p = lauf(p, ['A', 'B', 'C'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  for (const id of ['s1', 's2', 's3']) p = lauf(p, [{ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: id }]);
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] }, { befehl: 'return_neu', name: 'Hall' },
    { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }]);
  p = lauf(p, [
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 } },   // slot 1, track
    { befehl: 'insert_setzen', strang_id: 'g1', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 } },   // slot 2, group
    { befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 } },   // slot 3, return
    { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 } },   // slot 4, production master
    { befehl: 'return_aendern', return_id: 'r1', pre: true },
    { befehl: 'insert_an', insert_id: 'i1', an: false },                                                      // the track stage starts in bypass
  ]);
  setzeDekodiert(p, () => 'fertig');
  return p;
}
export const ketten = () => uebersetze(projekt(), { nr: 1, audioOrdner: '@AUDIO@', frames: () => FRAMES });

test('naht_kern: the fixture of the kern loader test is what wiedergabe.ts writes today', () => {
  const text = JSON.stringify(ketten(), null, 1) + '\n';
  if (process.env.CYPHERDJ_FIXTURE_SCHREIBEN === '1') fs.writeFileSync(FIXTURE, text);
  assert.equal(fs.readFileSync(FIXTURE, 'utf8'), text,
    'djk/kern/tests/daten/wiedergabe_ketten.json is stale: rerun with CYPHERDJ_FIXTURE_SCHREIBEN=1 and run the kern test test_arr_naht_seite');
});

test('naht_kern: the export control file of the kern render test is what reglerAusProjekt writes today', () => {
  const r = reglerAusProjekt(projekt());
  const text = JSON.stringify(r, null, 1) + '\n';
  if (process.env.CYPHERDJ_FIXTURE_SCHREIBEN === '1') fs.writeFileSync(FIXTURE_REGLER, text);
  assert.equal(fs.readFileSync(FIXTURE_REGLER, 'utf8'), text, 'djk/kern/tests/daten/render_regler_ketten.json is stale: rerun with CYPHERDJ_FIXTURE_SCHREIBEN=1');
  assert.equal(Object.keys(r).filter((k) => k.startsWith('ins/komp/')).length, 40, '4 stages x 10 rows');
  assert.equal(r['ins/komp/4/an'], 1, 'the PM stage is on');
  assert.equal(r['ins/komp/1/an'], 0, 'the bypassed track stage is a row, not a missing stage');
});

test('naht_kern: the four chains sit under the keys the kern loader reads', () => {
  const w = ketten();
  assert.deepEqual(Object.keys(w).sort(), ['format', 'gruppen', 'nr', 'pm', 'returns', 'spuren']);
  assert.deepEqual(w.spuren[0].chain, [{ art: 'komp', slot: 1, an: true }], 'a bypassed stage is still a built stage: the bypass is the row');
  assert.deepEqual(w.gruppen[0].chain, [{ art: 'komp', slot: 2, an: true }]);
  assert.deepEqual(w.returns[0].chain, [{ art: 'komp', slot: 3, an: true }]);
  assert.equal(w.returns[0].pre, true);
  assert.deepEqual(w.pm.chain, [{ art: 'komp', slot: 4, an: true }]);
  assert.match(w.spuren[0].clips[0].datei, /^@AUDIO@\//);
});

// ---- slice 4c T15: the same seam for the rack. One track with a compressor and a rack (macro 1 drives the threshold from 0 to -60 dB). The kern tests
// test_arr_naht_seite (loader) and test_render_rack (export) read these two committed files.
const FIXTURE_RACK = path.join(DATEN, 'wiedergabe_rack.json');
const FIXTURE_RACK_REGLER = path.join(DATEN, 'render_regler_rack.json');
export function rackProjekt() {
  let p = neuesProjekt('T');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'A' }]);
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: 's1' }]);
  p = lauf(p, [
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { schwelle: -18, ratio: 20, knie: 0, attack: 1, release: 50 } },
    { befehl: 'rack_setzen', strang_id: 's1', makros: [{ name: 'Squeeze', ziel: [{ insert: 'i1', param: 'schwelle', von: 0, bis: -60 }] }] },
  ]);
  setzeDekodiert(p, () => 'fertig');
  return p;
}
test('naht_kern rack: the fixtures of the kern loader and export tests are what wiedergabe.ts and render.ts write today', () => {
  const w = JSON.stringify(uebersetze(rackProjekt(), { nr: 1, audioOrdner: '@AUDIO@', frames: () => FRAMES }), null, 1) + '\n';
  const r = JSON.stringify(reglerAusProjekt(rackProjekt()), null, 1) + '\n';
  if (process.env.CYPHERDJ_FIXTURE_SCHREIBEN === '1') { fs.writeFileSync(FIXTURE_RACK, w); fs.writeFileSync(FIXTURE_RACK_REGLER, r); }
  assert.equal(fs.readFileSync(FIXTURE_RACK, 'utf8'), w, 'djk/kern/tests/daten/wiedergabe_rack.json is stale: rerun with CYPHERDJ_FIXTURE_SCHREIBEN=1');
  assert.equal(fs.readFileSync(FIXTURE_RACK_REGLER, 'utf8'), r, 'djk/kern/tests/daten/render_regler_rack.json is stale: rerun with CYPHERDJ_FIXTURE_SCHREIBEN=1');
  const j = JSON.parse(w);
  assert.deepEqual(j.spuren[0].rack, { slot: 1, ziele: [{ makro: 0, stufe: 0, param: 1, von: 0, bis: -60 }] });
  const regler = JSON.parse(r);
  assert.equal(regler['rack/1/m1'], 0, 'the macro row of the project travels in the export file');
  assert.equal(Object.keys(regler).filter((k) => k.startsWith('rack/')).length, 4, 'the four macro rows of the used rack');
});
