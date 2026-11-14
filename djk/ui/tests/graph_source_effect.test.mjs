// Effect inserts on source channels (remix targets L1, L2, DRUMS, BASS, MELODY): POST /graph puts an effect graph on pad/1, pad/2, erz/1..3 through
// /k/kanal/graph; a channel holds one graph (an instrument and an effect on the same stream channel: belegt); removal takes the way of the graph that is
// loaded; a kern restart brings the insert back. Server in-process without a kern, setup copied from graph_master.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';
import { setzeAutonom } from '../../generator/src/pattern_state.mjs';

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

test('an effect goes on pad/1 as an insert; an instrument there is then refused (belegt); "" takes the effect off the same way', async (t) => {
  const { lade, post, sendungen, geladen } = await stapel(t);
  await lade({ kanal: 'pad/1', name: 'eff' });
  assert.deepEqual(kurz(sendungen()), [['/k/kanal/graph', 'pad/1', 'eff', 'andreas']]);
  assert.deepEqual(await geladen(), { 'pad/1': 'eff' });
  const b = await post({ kanal: 'pad/1', name: 'inst' });
  assert.deepEqual([b.code, b.j.fehler, b.j.graph], [409, 'belegt', 'eff']);
  assert.equal(sendungen().length, 1, 'the refused instrument never reached the kern');
  await lade({ kanal: 'pad/1', name: '' });
  assert.deepEqual(kurz(sendungen().slice(1)), [['/k/kanal/graph', 'pad/1', '', 'andreas']]);
  assert.deepEqual(await geladen(), {});
});

test('erz/1 (drums) takes an effect; an instrument there stays kein_midi_strom', async (t) => {
  const { lade, post, sendungen } = await stapel(t);
  await lade({ kanal: 'erz/1', name: 'eff' });
  assert.deepEqual(kurz(sendungen()), [['/k/kanal/graph', 'erz/1', 'eff', 'andreas']]);
  const b = await post({ kanal: 'erz/1', name: 'inst' });
  assert.deepEqual([b.code, b.j.fehler], [400, 'kein_midi_strom']);
});

test('an instrument on erz/2 blocks an effect there (belegt); "" takes the instrument off through its stream', async (t) => {
  const { lade, post, sendungen, geladen } = await stapel(t);
  await lade({ kanal: 'erz/2', name: 'inst' });
  assert.deepEqual(kurz(sendungen()), [['/erz/strom', 'erz/2', 'bk:inst', 'andreas']]);
  const b = await post({ kanal: 'erz/2', name: 'eff' });
  assert.deepEqual([b.code, b.j.fehler, b.j.graph], [409, 'belegt', 'inst']);
  await lade({ kanal: 'erz/2', name: '' });
  assert.deepEqual(kurz(sendungen().slice(1)), [['/erz/strom', 'erz/2', 'bk:', 'andreas']]);
  assert.deepEqual(await geladen(), {});
  await lade({ kanal: 'erz/2', name: 'eff' });
  assert.deepEqual(kurz(sendungen().slice(2)), [['/k/kanal/graph', 'erz/2', 'eff', 'andreas']], 'free again: the effect goes on');
});

test('channels outside stay refused: erz/4, bus/1', async (t) => {
  const { post, sendungen } = await stapel(t);
  for (const kanal of ['erz/4', 'bus/1']) {
    const r = await post({ kanal, name: 'eff' });
    assert.deepEqual([r.code, r.j.fehler], [400, 'ausserhalb_bereich'], kanal);
  }
  assert.equal(sendungen().length, 0);
});

test('kern restart: an effect on pad/2 comes back as an insert', async (t) => {
  const { lade, sendungen, quittiere, geladen, neustart } = await stapel(t);
  neustart(1);
  await lade({ kanal: 'pad/2', name: 'eff' });
  const n0 = sendungen().length;
  neustart(2);
  assert.ok(await bis(() => sendungen().length === n0 + 1));
  assert.deepEqual(kurz(sendungen().slice(n0)), [['/k/kanal/graph', 'pad/2', 'eff', 'andreas']]);
  quittiere(sendungen().at(-1));
  assert.ok(await bis(async () => (await geladen())['pad/2'] === 'eff'));
});
