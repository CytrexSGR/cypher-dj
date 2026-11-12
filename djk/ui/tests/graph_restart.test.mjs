// Kanban t_e998388c: the kern keeps no Baukasten graph over a restart (S12). The page server remembers what was loaded BEFORE it clears its map and
// loads it again 500 ms after the new kern said hello, the same way it brings back loop boxes and FX units (boxFxPlanen). The knob rows are in the kern's
// restart state, so the reload sends no default rows. Server in-process without a kern; sends are read from the log (typ 'an_kern').
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

test('kern restart: what was loaded comes back after 500 ms, with the source of the last load and without default rows', async (t) => {
  const { lade, sendungen, bkZeilen, quittiere, geladen, neustart, wieder } = await stapel(t);
  neustart(1);
  await lade({ kanal: 'erz/3', name: 'inst' });
  await lade({ kanal: 'deck/2', name: 'eff' }, { 'x-djk-quelle': 'cypher' });
  assert.ok(bkZeilen().length >= 2, 'positive control: a normal load pushes the default rows of the graph');
  assert.deepEqual(await geladen(), { 'erz/3': 'inst', 'deck/2': 'eff' });
  const n0 = sendungen().length, z0 = bkZeilen().length;
  neustart(2);
  assert.deepEqual(await geladen(), {}, 'the map is cleared at once: the new kern has no graph');
  await warte(300);
  assert.equal(sendungen().length, n0, 'nothing is sent before the 500 ms are over');
  assert.ok(await bis(() => sendungen().length === n0 + 2), `both graphs are loaded again: ${JSON.stringify(kurz(sendungen().slice(n0)))}`);
  const neu = sendungen().slice(n0);
  assert.deepEqual(kurz(neu).sort(), [['/erz/strom', 'erz/3', 'bk:inst', 'andreas'], ['/k/kanal/graph', 'deck/2', 'eff', 'cypher']].sort());
  for (const s of neu) quittiere(s);
  assert.ok(await bis(async () => Object.keys(await geladen()).length === 2));
  assert.deepEqual(await geladen(), { 'erz/3': 'inst', 'deck/2': 'eff' });
  assert.equal(bkZeilen().length, z0, 'no default rows: the knob values are in the restart state of the kern');
  assert.deepEqual(wieder().map((z) => z.typ), ['graph_wieder', 'graph_wieder']);
  // negative control: the same generation again restores nothing
  neustart(2);
  await warte(700);
  assert.equal(sendungen().length, n0 + 2);
});

test('kern restart: a braked start (smaller generation, only /k/willkommen) restores no graph', async (t) => {
  const { o, lade, sendungen, geladen, neustart } = await stapel(t);
  neustart(5);
  await lade({ kanal: 'erz/3', name: 'inst' });
  const n0 = sendungen().length;
  o.vomKern({ adresse: '/k/willkommen', felder: { generation: 0, sample: 0 } });
  assert.deepEqual(await geladen(), {});
  await warte(700);
  assert.equal(sendungen().length, n0, 'the brake discarded the state on purpose');
});

test('kern restart with Stop Cypher: Cypher\'s graph stays away, Andreas\'s comes back', async (t) => {
  const { o, lade, sendungen, quittiere, geladen, neustart, wieder } = await stapel(t);
  neustart(1);
  await lade({ kanal: 'erz/3', name: 'inst' });
  await lade({ kanal: 'deck/2', name: 'eff' }, { 'x-djk-quelle': 'cypher' });
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1 } });
  const n0 = sendungen().length;
  neustart(2);
  assert.ok(await bis(() => sendungen().length > n0));
  await warte(200);
  assert.deepEqual(kurz(sendungen().slice(n0)), [['/erz/strom', 'erz/3', 'bk:inst', 'andreas']]);
  assert.ok(wieder().some((z) => z.typ === 'graph_wieder_ausgelassen' && z.kanal === 'deck/2' && z.grund === 'ki_gestoppt'));
  quittiere(sendungen().at(-1));
  assert.ok(await bis(async () => (await geladen())['erz/3'] === 'inst'));
});

test('kern restart with AUTO off: a graph Cypher loaded while AUTO was on was sounding and comes back', async (t) => {
  const { post, lade, sendungen, neustart, muster } = await stapel(t);
  neustart(1);
  await lade({ kanal: 'erz/2', name: 'inst2' }, { 'x-djk-quelle': 'cypher' });
  setzeAutonom(`${muster}2`, false);   // Andreas holds stream 2 from here on
  const r = await post({ kanal: 'erz/2', name: 'inst' }, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'auto_aus'], 'positive control: a fresh load by Cypher is refused');
  const n0 = sendungen().length;
  neustart(2);
  assert.ok(await bis(() => sendungen().length === n0 + 1));
  assert.deepEqual(kurz(sendungen().slice(n0)), [['/erz/strom', 'erz/2', 'bk:inst2', 'cypher']]);
});

test('kern restart: a channel that was set again before the 500 ms are over is left alone', async (t) => {
  const { lade, sendungen, geladen, neustart, wieder } = await stapel(t);
  neustart(1);
  await lade({ kanal: 'erz/3', name: 'inst' });
  neustart(2);
  await lade({ kanal: 'erz/3', name: 'inst2' });   // Andreas loads another graph on the new kern right away
  const n0 = sendungen().length;
  await warte(700);
  assert.equal(sendungen().length, n0, 'the restore does not overwrite the new choice');
  assert.deepEqual(await geladen(), { 'erz/3': 'inst2' });
  assert.ok(wieder().some((z) => z.typ === 'graph_wieder_ausgelassen' && z.kanal === 'erz/3' && z.grund === 'neu_gesetzt'));
});

test('kern restart: a second restart within 30 s restores nothing (a crash loop must not pump sound into a falling kern)', async (t) => {
  const { lade, sendungen, quittiere, geladen, neustart, log } = await stapel(t);
  neustart(1);
  await lade({ kanal: 'erz/3', name: 'inst' });
  let n0 = sendungen().length;
  neustart(2);
  assert.ok(await bis(() => sendungen().length === n0 + 1));
  quittiere(sendungen().at(-1));
  assert.ok(await bis(async () => (await geladen())['erz/3'] === 'inst'));
  n0 = sendungen().length;
  neustart(3);
  await warte(700);
  assert.equal(sendungen().length, n0);
  assert.ok(log.some((z) => z.typ === 'wiederherstellung_uebersprungen' && z.grund === 'zu_schnell'));
});

test('graphenNachNeustart: project channels belong to the project restore, empty names and unknown owners are handled', () => {
  const vorher = { 'erz/3': 'inst', 'deck/2': 'eff', 'pad/1': 'inst2', 'fx/3': '' };
  assert.deepEqual(graphenNachNeustart(vorher, { 'erz/3': 'cypher' }, ['deck/2']),
    [{ kanal: 'erz/3', name: 'inst', besitzer: 'cypher' }, { kanal: 'pad/1', name: 'inst2', besitzer: 'andreas' }]);
  assert.deepEqual(graphenNachNeustart({}, {}, []), []);
});
