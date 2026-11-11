// 1.10 slice 4a, seam S4: the request that playback.ts writes for a project with a compressor on a track, a group, a return (pre) and the production
// master is the committed fixture djk/core/tests/data/wiedergabe_ketten.json, and the real kern loader reads that very file
// (djk/core/tests/test_arr_seam_page.cpp, ctest). This test regenerates the file from the project and fails when the committed one differs, so
// the fixture cannot go stale. Rewrite it with CYPHERDJ_FIXTURE_SCHREIBEN=1 node --test tests/seam_core_playback.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuehreListeAus, setzeDekodiert } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { uebersetze } from '../project/playback.ts';
import { reglerAusProjekt } from '../project/render.ts';

const DATEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'tests', 'data');
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

test('naht_kern: the fixture of the kern loader test is what playback.ts writes today', () => {
  const text = JSON.stringify(ketten(), null, 1) + '\n';
  if (process.env.CYPHERDJ_FIXTURE_SCHREIBEN === '1') fs.writeFileSync(FIXTURE, text);
  assert.equal(fs.readFileSync(FIXTURE, 'utf8'), text,
    'djk/core/tests/data/wiedergabe_ketten.json is stale: rerun with CYPHERDJ_FIXTURE_SCHREIBEN=1 and run the kern test test_arr_naht_seite');
});

test('naht_kern: the export control file of the kern render test is what reglerAusProjekt writes today', () => {
  const r = reglerAusProjekt(projekt());
  const text = JSON.stringify(r, null, 1) + '\n';
  if (process.env.CYPHERDJ_FIXTURE_SCHREIBEN === '1') fs.writeFileSync(FIXTURE_REGLER, text);
  assert.equal(fs.readFileSync(FIXTURE_REGLER, 'utf8'), text, 'djk/core/tests/data/render_regler_ketten.json is stale: rerun with CYPHERDJ_FIXTURE_SCHREIBEN=1');
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
test('naht_kern rack: the fixtures of the kern loader and export tests are what playback.ts and render.ts write today', () => {
  const w = JSON.stringify(uebersetze(rackProjekt(), { nr: 1, audioOrdner: '@AUDIO@', frames: () => FRAMES }), null, 1) + '\n';
  const r = JSON.stringify(reglerAusProjekt(rackProjekt()), null, 1) + '\n';
  if (process.env.CYPHERDJ_FIXTURE_SCHREIBEN === '1') { fs.writeFileSync(FIXTURE_RACK, w); fs.writeFileSync(FIXTURE_RACK_REGLER, r); }
  assert.equal(fs.readFileSync(FIXTURE_RACK, 'utf8'), w, 'djk/core/tests/data/wiedergabe_rack.json is stale: rerun with CYPHERDJ_FIXTURE_SCHREIBEN=1');
  assert.equal(fs.readFileSync(FIXTURE_RACK_REGLER, 'utf8'), r, 'djk/core/tests/data/render_regler_rack.json is stale: rerun with CYPHERDJ_FIXTURE_SCHREIBEN=1');
  const j = JSON.parse(w);
  assert.deepEqual(j.spuren[0].rack, { slot: 1, ziele: [{ makro: 0, stufe: 0, param: 1, von: 0, bis: -60 }] });
  const regler = JSON.parse(r);
  assert.equal(regler['rack/1/m1'], 0, 'the macro row of the project travels in the export file');
  assert.equal(Object.keys(regler).filter((k) => k.startsWith('rack/')).length, 4, 'the four macro rows of the used rack');
});

// ---- 1.9 U8 T7 seam: member targets. One rack track (RB-338, Baukasten graph `t`, kit `kit_rack`) with a compressor; the table maps one target per member kind plus
// one insert target. The kern test test_arr_naht_seite reads this committed file with the real loader.
const FIXTURE_GLIEDER = path.join(DATEN, 'wiedergabe_rack_glieder.json');
export function gliederProjekt() {
  let p = neuesProjekt('T');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'instrument', name: 'Rack', geraet: { art: 'rack', glieder: [
    { id: 'g1', geraet: { art: 'intern', name: 'rb338', parameter: {} } },
    { id: 'g2', geraet: { art: 'intern', name: 'bk', graph: 't', parameter: {} } },
    { id: 'g3', geraet: { art: 'intern', name: 'kit', kit: 'kit_rack' } }], kette: 0 } }]);
  p = lauf(p, [
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { schwelle: -18, ratio: 4 } },
    { befehl: 'rack_setzen', strang_id: 's1', makros: [
      { ziel: [{ insert: 'i1', param: 'schwelle', von: 0, bis: -60 }, { glied: 'g1', param: 'cutoff', von: 0.1, bis: 0.9 }] },
      { ziel: [{ glied: 'g2', param: 'k1', von: 0, bis: 1 }, { glied: 'g3', param: 'gain_db', von: -12, bis: 0 }] }] },
  ]);
  return p;
}
test('naht_kern glieder: the fixture of the kern loader test is what playback.ts writes today, in the core index space', () => {
  const w = JSON.stringify(uebersetze(gliederProjekt(), { nr: 1, audioOrdner: '@AUDIO@', frames: () => FRAMES }), null, 1) + '\n';
  if (process.env.CYPHERDJ_FIXTURE_SCHREIBEN === '1') fs.writeFileSync(FIXTURE_GLIEDER, w);
  assert.equal(fs.readFileSync(FIXTURE_GLIEDER, 'utf8'), w,
    'djk/core/tests/data/wiedergabe_rack_glieder.json is stale: rerun with CYPHERDJ_FIXTURE_SCHREIBEN=1 and run the kern test test_arr_naht_seite');
  assert.deepEqual(JSON.parse(w).spuren[0].rack.ziele.filter((z) => 'glied' in z).map((z) => [z.makro, z.glied, z.param]), [[0, 0, 1], [1, 1, 8], [1, 2, 16]]);
});

// review fix: the same project frozen (Surge member): the output is an audio strip with its chain, no member target; the real loader accepts it
const FIXTURE_EINGEFROREN = path.join(DATEN, 'wiedergabe_rack_eingefroren.json');
export function eingefrorenProjekt() {
  let p = lauf(neuesProjekt('T'), [{ befehl: 'spur_neu', art: 'instrument', name: 'Rack', geraet: { art: 'rack', glieder: [
    { id: 'g1', geraet: { art: 'intern', name: 'rb338', parameter: {} } }, { id: 'g2', geraet: { art: 'wirt' } }], kette: 0 } }]);
  p = lauf(p, [
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { schwelle: -18, ratio: 4 } },
    { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'schwelle', von: 0, bis: -60 }, { glied: 'g1', param: 'cutoff', von: 0.1, bis: 0.9 }] }] },
  ]);
  p.spuren[0].freeze = { datei: `audio/${SHA}.f32`, sha256: SHA, frames: FRAMES, von_beat: 0 };
  return p;
}
test('naht_kern eingefroren: the fixture of the kern loader test is what playback.ts writes today, without member targets', () => {
  const w = JSON.stringify(uebersetze(eingefrorenProjekt(), { nr: 1, audioOrdner: '@ARBEIT@/audio', arbeitsordner: '@ARBEIT@', existiert: () => true }), null, 1) + '\n';
  if (process.env.CYPHERDJ_FIXTURE_SCHREIBEN === '1') fs.writeFileSync(FIXTURE_EINGEFROREN, w);
  assert.equal(fs.readFileSync(FIXTURE_EINGEFROREN, 'utf8'), w, 'wiedergabe_rack_eingefroren.json is stale: rerun with CYPHERDJ_FIXTURE_SCHREIBEN=1');
  const s = JSON.parse(w).spuren[0];
  assert.equal(s.art, 'audio');
  assert.deepEqual(s.rack.ziele.map((z) => 'stufe' in z), [true]);
});
