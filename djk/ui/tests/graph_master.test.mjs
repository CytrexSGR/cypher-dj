// Master insert graph: POST /graph {kanal: "master", name} loads an effect graph on the DJ master sum (/k/kanal/graph kanal master), name ""
// takes it off, the knob defaults go to master/bk/<n> before the load, a kern restart brings it back, and the graph knobs master/bk/1..64 pass
// the regler route. Server in-process without a kern; sends are read from the log (typ 'an_kern'). Stand-in setup as in graph_restart.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';
import { setzeAutonom } from '../../generator/src/pattern_state.mjs';
import { graphenNachNeustart } from '../graphs.ts';

belegeTestInstanz();
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 3000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };

// both graphs define knob 1 with a vorgabe: a normal load pushes that row before the load message (positive control for "no default rows")
const INST = { format: 'baukasten/2', name: 'inst', stimmen: 1, regler_namen: { 1: 'Rate' },
  knoten: [{ id: 'n', art: 'note' }, { id: 'o', art: 'ausgang' }, { id: 'k1', art: 'regler', nr: 1, min: 0, max: 1, vorgabe: 0.2 }], kanten: [] };
const INST2 = { ...INST, name: 'inst2' };
const EFF = { format: 'baukasten/2', name: 'eff', stimmen: 1, regler_namen: { 1: 'Mix' },
  knoten: [{ id: 'e', art: 'eingang' }, { id: 'o', art: 'ausgang' }, { id: 'k1', art: 'regler', nr: 1, min: 0, max: 1, vorgabe: 0.35 }], kanten: [] };

async function stapel(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const bkOrdner = tmp('bkn-');
  for (const g of [INST, INST2, EFF]) fs.writeFileSync(path.join(bkOrdner, `${g.name}.json`), JSON.stringify(g));
  fs.mkdirSync(path.join(bkOrdner, 'samples'));
  const huellen = path.join(tmp('bkn-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = { inst: process.env.CYPHERDJ_INSTANZ, bk: process.env.CYPHERDJ_BK_ORDNER };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  process.env.CYPHERDJ_BK_ORDNER = bkOrdner;
  const muster = tmp('bkn-muster-');
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('bkn-bestand-'), arbeitsbestand: tmp('bkn-ab-'),
    mutationen: [], loops: tmp('bkn-loops-'), kits: tmp('bkn-kits-'), welleCache: tmp('bkn-welle-'), musterOrdner: muster, hotcueOrdner: tmp('bkn-hc-'),
    rasterOrdner: tmp('bkn-raster-'), huellen, wirtOrdner: tmp('bkn-wirt-'), sammlungen: tmp('bkn-sets-'), musterBibliothek: tmp('bkn-mb-'), musterSets: tmp('bkn-ms-'),
    mediathek: path.join(tmp('bkn-med-'), 'nix.sqlite'), katalog: path.join(tmp('bkn-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('bkn-do-'), 'nix'),
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('bkn-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('bkn-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => log.push(z) });
  Object.defineProperty(o.kern, 'zustand', { get: () => 'verbunden', configurable: true });   // the default rows need a kern; the pump below answers for it
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
    if (alt.bk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt.bk;
  });
  const url = `http://127.0.0.1:${47300 + K}`;
  const istLaden = (z) => z.typ === 'an_kern' && (z.adresse === '/erz/strom' || z.adresse === '/k/kanal/graph');
  const sendungen = () => log.filter(istLaden);
  const bkZeilen = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil' && /\/bk\/\d+$/.test(String(z.felder.pfad)));
  const quittiere = (s, status = 3) => {
    o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 1, ist_sample: 0, ist_beat: 0, grund: '' } });
    o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status, ist_sample: 0, ist_beat: 0, grund: '' } });
  };
  // the kern stand-in of this file: every knob row is acknowledged at once (the batch waits for the end status of each row)
  let zeilenQuittiert = 0;
  const pumpe = setInterval(() => { const z = bkZeilen(); for (; zeilenQuittiert < z.length; zeilenQuittiert++) quittiere(z[zeilenQuittiert]); }, 5);
  t.after(() => clearInterval(pumpe));
  const post = (daten, kopf = {}) => hol(`${url}/graph`, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
  async function lade(daten, kopf = {}) {
    const n0 = sendungen().length;
    const p = post(daten, kopf);
    assert.ok(await bis(() => sendungen().length > n0), 'the command reaches the kern');
    quittiere(sendungen().at(-1));
    const r = await p;
    assert.equal(r.code, 200, JSON.stringify(r.j));
    return r;
  }
  const geladen = async () => (await (await hol(`${url}/graphen`)).json()).geladen;
  const neustart = (generation) => o.vomKern({ adresse: '/e/neustart', felder: { generation, sample: 0 } });
  const wieder = () => log.filter((z) => typeof z.typ === 'string' && z.typ.startsWith('graph_wieder'));
  return { o, log, muster, post, lade, sendungen, bkZeilen, quittiere, geladen, neustart, wieder };
}
const kurz = (s) => s.map((z) => [z.adresse, z.felder.kanal, z.adresse === '/erz/strom' ? z.felder.ziel : z.felder.name, z.felder.quelle]);

const kurz2 = (s) => s.map((z) => [z.adresse, z.felder.kanal, z.felder.name, z.felder.quelle]);

test('POST /graph master: loads an effect graph, pushes its defaults to master/bk/1 first, name "" takes it off', async (t) => {
  const { lade, sendungen, bkZeilen, geladen } = await stapel(t);
  await lade({ kanal: 'master', name: 'eff' });
  assert.deepEqual(kurz2(sendungen()), [['/k/kanal/graph', 'master', 'eff', 'andreas']]);
  const z = bkZeilen();
  assert.deepEqual(z.map((x) => [x.felder.pfad, Math.round(x.felder.nach * 100) / 100]), [['master/bk/1', 0.35]], 'default row of the graph goes to master/bk/1');
  assert.deepEqual(await geladen(), { master: 'eff' });
  await lade({ kanal: 'master', name: '' });
  assert.deepEqual(sendungen().at(-1).felder.name, '');
  assert.deepEqual(await geladen(), {});
});

test('POST /graph master: an instrument graph is refused (falsche_art), an unknown channel stays refused', async (t) => {
  const { post, sendungen } = await stapel(t);
  const a = await post({ kanal: 'master', name: 'inst' });
  assert.deepEqual([a.code, a.j.fehler], [400, 'falsche_art']);
  const b = await post({ kanal: 'masterx', name: 'eff' });
  assert.deepEqual([b.code, b.j.fehler], [400, 'ausserhalb_bereich']);
  assert.equal(sendungen().length, 0, 'nothing reached the kern');
});

test('POST /graph master: Stop Cypher refuses Cypher, not Andreas', async (t) => {
  const { o, post, sendungen, quittiere } = await stapel(t);
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1 } });
  const r = await post({ kanal: 'master', name: 'eff' }, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt']);
  assert.equal(sendungen().length, 0);
  const n0 = sendungen().length;
  const p = post({ kanal: 'master', name: 'eff' });
  assert.ok(await bis(() => sendungen().length > n0));
  quittiere(sendungen().at(-1));
  assert.equal((await p).code, 200);
});

test('kern restart: the master graph comes back with the source of its last load', async (t) => {
  const { lade, sendungen, quittiere, geladen, neustart } = await stapel(t);
  neustart(1);
  await lade({ kanal: 'master', name: 'eff' }, { 'x-djk-quelle': 'cypher' });
  const n0 = sendungen().length;
  neustart(2);
  assert.deepEqual(await geladen(), {});
  assert.ok(await bis(() => sendungen().length === n0 + 1));
  assert.deepEqual(kurz2(sendungen().slice(n0)), [['/k/kanal/graph', 'master', 'eff', 'cypher']]);
  quittiere(sendungen().at(-1));
  assert.ok(await bis(async () => (await geladen()).master === 'eff'));
});

test('graphenNachNeustart takes the master channel along', () => {
  assert.deepEqual(graphenNachNeustart({ master: 'eff', 'deck/1': '' }, { master: 'cypher' }, []), [{ kanal: 'master', name: 'eff', besitzer: 'cypher' }]);
  assert.deepEqual(graphenNachNeustart({ master: 'eff' }, {}, ['master']), [], 'a channel of the project snapshot belongs to the project restore');
});

test('regler route: master/bk/1..64 are hand paths, 0 and 65 are not', async (t) => {
  const { PFAD } = await import('../hand_operation.ts');
  for (const n of [1, 9, 33, 64]) assert.ok(PFAD.test(`master/bk/${n}`), `master/bk/${n}`);
  for (const p of ['master/bk/0', 'master/bk/65', 'master/bk/033', 'master/bk/', 'master/bk/1/x']) assert.ok(!PFAD.test(p), p);
  assert.ok(PFAD.test('master/pegel'), 'the master pegel stays a hand path');
});
