// Strand 2 task 2.2: the knob field `regler` of a host stage (knob m drives plugin parameter index regler[m-1]) and the command plugin_regler_setzen.
// Pure calculation plus one save/load round trip in a temp folder: no server, no core, no host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { pruefeProjekt, kanonisch, alleInserts, MAX_PLUGIN_REGLER } from '../project/model.ts';
import { Projekte } from '../project/storage.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { FEHLER_TEXT } from '../public/production/production.js';
import { tmpOrdner } from './support/project.mjs';
import { basisProjekt } from './support/inserts_scenario.mjs';

const PLUGIN = { format: 'vst3', pfad: '/opt/plugins/Fake EQ.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const lehntAb = (p, b, grund) => assert.throws(() => fuehreListeAus(p, [b]), (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const host = (p) => alleInserts(p).find((x) => x.insert.art === 'host').insert;
const knopf = (insert_id, k, index) => ({ befehl: 'plugin_regler_setzen', insert_id, knopf: k, index });

function mitHost() {
  const p = fuehreAus(basisProjekt(), { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin: PLUGIN }).projekt;
  return { p, id: host(p).id };
}

test('the cap is 16 knobs per host stage', () => assert.equal(MAX_PLUGIN_REGLER, 16));

test('set, replace and clear a knob; trailing nulls are trimmed and an empty list removes the key', () => {
  const { p, id } = mitHost();
  let q = fuehreAus(p, knopf(id, 3, 7)).projekt;
  assert.deepEqual(host(q).regler, [null, null, 7]);
  assert.equal(pruefeProjekt(q).fehler, undefined);
  q = fuehreAus(q, knopf(id, 1, 0)).projekt;
  assert.deepEqual(host(q).regler, [0, null, 7]);
  q = fuehreAus(q, knopf(id, 3, 12)).projekt;   // replace: knob 3 now drives 12
  assert.deepEqual(host(q).regler, [0, null, 12]);
  q = fuehreAus(q, knopf(id, 3, null)).projekt;  // clear the last knob: the trailing nulls go
  assert.deepEqual(host(q).regler, [0]);
  q = fuehreAus(q, knopf(id, 1, null)).projekt;
  assert.equal('regler' in host(q), false);
  assert.equal(kanonisch(q), kanonisch(p), 'an untouched stage is byte for byte as before');
  q = fuehreAus(q, knopf(id, 16, 99999)).projekt;
  assert.equal(host(q).regler.length, 16);
});

test('refusals: unknown stage, not a host stage, knob or index out of range, an index twice', () => {
  const { p, id } = mitHost();
  lehntAb(p, knopf('i99', 1, 0), 'insert_unbekannt');
  for (const k of [0, 17, 1.5, '1', undefined]) lehntAb(p, knopf(id, k, 0), 'argument_ungueltig');
  for (const i of [-1, 100000, 2.5, '3', undefined]) lehntAb(p, knopf(id, 1, i), 'argument_ungueltig');
  lehntAb(p, { ...knopf(id, 1, 0), extra: 1 }, 'argument_unbekannt');
  const q = fuehreAus(p, knopf(id, 2, 5)).projekt;
  lehntAb(q, knopf(id, 4, 5), 'index_doppelt');
  assert.deepEqual(host(fuehreAus(q, knopf(id, 2, 5)).projekt).regler, [null, 5], 'the same knob on its own index is no duplicate');
  const komp = fuehreAus(basisProjekt(), { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }).projekt;
  lehntAb(komp, knopf(alleInserts(komp)[0].insert.id, 1, 0), 'argument_ungueltig');
});

test('index_doppelt is a 409 with an English server and page text', () => {
  assert.equal(grundCode('index_doppelt'), 409);
  assert.match(GRUND_TEXT.index_doppelt ?? '', /^[\x20-\x7e]+$/);
  assert.match(FEHLER_TEXT.index_doppelt ?? '', /^[\x20-\x7e]+$/);
});

test('replacing the plugin of a stage clears its knobs', () => {
  const { p, id } = mitHost();
  const q = fuehreAus(p, knopf(id, 1, 4)).projekt;
  const r = fuehreAus(q, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin: PLUGIN, ersetzen: true }).projekt;
  assert.equal('regler' in host(r), false);
});

test('the project check: integers 0..99999, no index twice, at most 16, canonical, only on host stages', () => {
  const { p } = mitHost();
  const mit = (regler) => { const q = structuredClone(p); host(q).regler = regler; return pruefeProjekt(q).fehler; };
  assert.equal(mit([null, 3, 0]), undefined);
  for (const bad of [[], [1, null], [1, 1], [-1], [100000], [1.5], ['2'], Array.from({ length: 17 }, (_, i) => i), {}]) {
    assert.match(String(mit(bad)), /regler/, JSON.stringify(bad));
  }
  const komp = fuehreAus(basisProjekt(), { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }).projekt;
  alleInserts(komp)[0].insert.regler = [1];
  assert.match(String(pruefeProjekt(komp).fehler), /regler/);
});

test('round trip: the knobs survive save and load; a stage without knobs is saved without the key', (t) => {
  const pr = new Projekte(tmpOrdner(t));
  const { slug } = pr.lege('Knobs');
  const { p, id } = mitHost();
  pr.speichere(slug, p);
  assert.equal('regler' in host(pr.lies(slug)), false);
  const q = fuehreListeAus(p, [knopf(id, 2, 9), knopf(id, 5, 40)]).projekt;
  pr.speichere(slug, q);
  const zurueck = pr.lies(slug);
  assert.deepEqual(host(zurueck).regler, [null, 9, null, null, 40]);
  assert.equal(kanonisch(zurueck), kanonisch(q));
});
