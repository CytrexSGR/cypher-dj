// Plan 1.11 task 7: the host insert in the project model, the commands and the translator. Pure calculation: no server, no core, no host.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { pruefeProjekt, kanonisch, wiedergabeSicht, alleInserts } from '../project/model.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { uebersetze } from '../project/playback.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { tmpOrdner } from './support/project.mjs';
import { basisProjekt } from './support/inserts_scenario.mjs';
import { szenarioMitInserts } from './support/host_scenario.mjs';

const W = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = { format: 'vst3', pfad: '/opt/plugins/Fake EQ.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const setzeHost = (strang, extra = {}) => ({ befehl: 'insert_setzen', strang_id: strang, pos: 0, art: 'host', plugin: PLUGIN, ...extra });
const lehntAb = (p, b, grund) => assert.throws(() => fuehreListeAus(p, Array.isArray(b) ? b : [b]),
  (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const stufenVon = (p) => alleInserts(p).filter((x) => x.insert.art === 'host');

test('golden: a project with native stages and no host stage keeps its playback file and its project bytes', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(W, 'tests', 'support', 'inserts_mit_golden.json'), 'utf8'));
  const s = szenarioMitInserts();
  assert.equal(s.wiedergabe, golden.wiedergabe);
  assert.equal(s.kanonisch, golden.kanonisch);
  assert.ok(!s.wiedergabe.includes('latenz'), 'no latenz key on a native stage');
});

test('insert_setzen host: identity, state path fixed at creation, lowest free slot, valid project', () => {
  const p = basisProjekt();
  const r = fuehreAus(p, setzeHost('s1'));
  const [x] = stufenVon(r.projekt);
  assert.equal(x.insert.art, 'host');
  assert.equal(x.insert.slot, 1);
  assert.equal(x.insert.an, true);
  assert.deepEqual(x.insert.plugin, { ...PLUGIN, name: 'Fake EQ' });
  assert.equal(x.insert.zustand, `plugins/${x.insert.id}.carxs`);
  assert.equal(x.insert.latenz_extra, undefined);
  assert.equal(pruefeProjekt(r.projekt).fehler, undefined);
  assert.equal(r.betrifft_wiedergabe, true);
  const zwei = fuehreAus(r.projekt, setzeHost('s2'));
  assert.deepEqual(stufenVon(zwei.projekt).map((y) => y.insert.slot), [1, 2]);
});

test('insert_setzen host: argument checks name the field', () => {
  const p = basisProjekt();
  lehntAb(p, setzeHost('s1', { plugin: { ...PLUGIN, format: 'au' } }), 'argument_ungueltig');
  lehntAb(p, setzeHost('s1', { plugin: { format: 'vst3', uid: 'x' } }), 'argument_ungueltig');
  lehntAb(p, setzeHost('s1', { plugin: { ...PLUGIN, extra: 1 } }), 'argument_unbekannt');
  lehntAb(p, setzeHost('s1', { plugin: undefined }), 'argument_ungueltig');
  lehntAb(p, setzeHost('s1', { plugin: { ...PLUGIN, pfad: 'a\nb' } }), 'argument_ungueltig');
  lehntAb(p, { ...setzeHost('s1'), werte: { x: 1 } }, 'argument_unbekannt');
  const lv2 = fuehreAus(p, setzeHost('s1', { plugin: { format: 'lv2', pfad: 'http://lsp-plug.in/plugins/lv2/comp_stereo', uid: '' } }));
  assert.equal(stufenVon(lv2.projekt)[0].insert.plugin.name, 'comp_stereo');
});

test('the fifth host insert is host_grenze and nothing is half applied; a freed slot is used again', () => {
  let p = basisProjekt();
  p = fuehreListeAus(p, [setzeHost('s1'), setzeHost('s2'), setzeHost('s3'), setzeHost('master')]).projekt;
  assert.equal(stufenVon(p).length, 4);
  const vor = kanonisch(p);
  lehntAb(p, setzeHost('s1', { pos: 1 }), 'host_grenze');
  assert.equal(kanonisch(p), vor, 'the input project is untouched');
  assert.throws(() => fuehreListeAus(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'komp' }, setzeHost('s1', { pos: 1 })]),
    (e) => e.grund === 'host_grenze' && e.index === 1);
  const id = stufenVon(p)[1].insert.id;
  const frei = fuehreListeAus(p, [{ befehl: 'insert_entfernen', insert_id: id }, setzeHost('s3', { pos: 1 })]).projekt;
  assert.deepEqual(stufenVon(frei).map((y) => y.insert.slot).sort(), [1, 2, 3, 4]);
  assert.ok(GRUND_TEXT.host_grenze && grundCode('host_grenze') === 409);
});

test('set, change and remove are one undo step each, with the source', (t) => {
  const uhr = { t: 1_000_000 };
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  let q = basisProjekt();
  const a = (b, quelle, label) => { uhr.t += 5000; const w = aendere(v, q, [b], { quelle, label }); q = w.projekt; return w; };
  const w1 = a(setzeHost('s1'), 'andreas', 'Add plugin');
  const id = stufenVon(q)[0].insert.id;
  const w2 = a({ befehl: 'insert_latenz_extra', insert_id: id, samples: 128 }, 'cypher', 'Extra latency');
  const w3 = a({ befehl: 'insert_entfernen', insert_id: id }, 'andreas', 'Remove plugin');
  for (const w of [w1, w2, w3]) assert.ok(w.eintrag, 'an entry');
  assert.deepEqual([w1.eintrag.quelle, w2.eintrag.quelle, w3.eintrag.quelle], ['andreas', 'cypher', 'andreas']);
  assert.equal(stufenVon(q).length, 0);
  q = rueckgaengig(v, q, { quelle: 'andreas' }).projekt;                 // remove undone: the stage is back with its extra latency
  assert.equal(stufenVon(q)[0].insert.latenz_extra, 128);
  q = rueckgaengig(v, q, { quelle: 'andreas' }).projekt;                 // extra latency undone
  assert.equal(stufenVon(q)[0].insert.latenz_extra, undefined);
  q = rueckgaengig(v, q, { quelle: 'andreas' }).projekt;                 // set undone
  assert.equal(stufenVon(q).length, 0);
  q = wiederholen(v, q, { quelle: 'andreas' }).projekt;                  // redo: the same slot and the same state path
  assert.equal(stufenVon(q)[0].insert.id, id);
  assert.equal(stufenVon(q)[0].insert.zustand, `plugins/${id}.carxs`);
});

test('insert_latenz_extra: range, kind check, the value is playback structure', () => {
  let p = fuehreAus(basisProjekt(), setzeHost('s1')).projekt;
  const id = stufenVon(p)[0].insert.id;
  for (const samples of [-1, 4097, 1.5, 'x', undefined]) lehntAb(p, { befehl: 'insert_latenz_extra', insert_id: id, samples }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_latenz_extra', insert_id: 'i99', samples: 1 }, 'insert_unbekannt');
  const komp = fuehreAus(basisProjekt(), { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }).projekt;
  lehntAb(komp, { befehl: 'insert_latenz_extra', insert_id: alleInserts(komp)[0].insert.id, samples: 1 }, 'argument_ungueltig');
  const r = fuehreAus(p, { befehl: 'insert_latenz_extra', insert_id: id, samples: 4096 });
  assert.equal(r.betrifft_wiedergabe, true);
  assert.notEqual(kanonisch(wiedergabeSicht(r.projekt)), kanonisch(wiedergabeSicht(p)));
  p = r.projekt;
  assert.equal(pruefeProjekt(p).fehler, undefined);
});

test('negative control: insert_latenz_extra with the stored value creates no history entry and no reload', (t) => {
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 1, zeitgeber: false });
  let p = fuehreAus(basisProjekt(), setzeHost('s1')).projekt;
  const id = stufenVon(p)[0].insert.id;
  p = fuehreAus(p, { befehl: 'insert_latenz_extra', insert_id: id, samples: 100 }).projekt;
  const gleich = fuehreAus(p, { befehl: 'insert_latenz_extra', insert_id: id, samples: 100 });
  assert.equal(gleich.vor.length, 0);
  assert.equal(gleich.betrifft_wiedergabe, false);
  assert.equal(aendere(v, p, [{ befehl: 'insert_latenz_extra', insert_id: id, samples: 100 }], { quelle: 'andreas', label: 'same' }).eintrag, null);
  // 0 on a stage without the field is also the stored value: absent = 0
  const nulle = fuehreAus(fuehreAus(basisProjekt(), setzeHost('s1')).projekt, { befehl: 'insert_latenz_extra', insert_id: id, samples: 0 });
  assert.equal(nulle.vor.length, 0);
});

test('insert_an on a host stage is a light command: row only, no reload; the value has no parameters', () => {
  const p = fuehreAus(basisProjekt(), setzeHost('s1')).projekt;
  const id = stufenVon(p)[0].insert.id;
  const r = fuehreAus(p, { befehl: 'insert_an', insert_id: id, an: false });
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'ins/host/1/an', wert: 0 }]);
  const auf = fuehreAus(p, setzeHost('s2'));
  assert.deepEqual(auf.regler_aenderungen, [{ pfad: 'ins/host/2/an', wert: 1 }]);
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: id, param: 'x', wert: 1 }, 'argument_unbekannt');
});

test('translator: a host stage is {art, slot, an, latenz} from the host hook; no hook = off; a native stage never carries latenz', () => {
  const p = fuehreListeAus(basisProjekt(), [setzeHost('s1'), { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'komp' }]).projekt;
  const o = { nr: 1, audioOrdner: '/x/audio', frames: () => 96000 };
  const aus = uebersetze(p, o);
  assert.equal(aus.format, 'cypherdj-arr/2');
  const kette = aus.spuren.find((s) => s.nr === 1).chain;
  assert.deepEqual(kette[0], { art: 'host', slot: 1, an: false, latenz: 0 });
  assert.deepEqual(Object.keys(kette[1]).sort(), ['an', 'art', 'slot']);
  const mit = uebersetze(p, { ...o, host: (slot) => (slot === 1 ? { an: true, latenz: 602 } : { an: false, latenz: 0 }) });
  assert.deepEqual(mit.spuren.find((s) => s.nr === 1).chain[0], { art: 'host', slot: 1, an: true, latenz: 602 });
  const ohne = uebersetze(p, { ...o, host: () => ({ an: true, latenz: 5 }), ohneHost: new Set([1]) });
  assert.deepEqual(ohne.spuren.find((s) => s.nr === 1).chain.map((x) => x.art), ['komp']);
});

test('model: a host stage needs its plugin and its state path; a native stage has neither', () => {
  const p = fuehreAus(basisProjekt(), setzeHost('s1')).projekt;
  const kopie = () => JSON.parse(JSON.stringify(p));
  const a = kopie(); delete a.spuren[0].inserts[0].plugin;
  assert.ok(pruefeProjekt(a).fehler);
  const b = kopie(); b.spuren[0].inserts[0].zustand = 'plugins/other.carxs';
  assert.ok(pruefeProjekt(b).fehler);
  const c = kopie(); c.spuren[0].inserts[0].latenz_extra = 5000;
  assert.ok(pruefeProjekt(c).fehler);
  const d = fuehreAus(basisProjekt(), { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }).projekt;
  const dk = JSON.parse(JSON.stringify(d)); dk.spuren[0].inserts[0].plugin = { ...PLUGIN, name: 'x' };
  assert.ok(pruefeProjekt(dk).fehler);
  assert.equal(pruefeProjekt(kopie()).fehler, undefined);
});

test('reasons: every new reason has an English text and a code', () => {
  for (const g of ['host_grenze', 'host_fehlt', 'plugin_nicht_ladbar', 'zustand_passt_nicht', 'param_unbekannt', 'host_insert_echtzeit']) {
    assert.ok(typeof GRUND_TEXT[g] === 'string' && GRUND_TEXT[g].length > 8, g);
  }
  assert.equal(grundCode('param_unbekannt'), 404);
});
