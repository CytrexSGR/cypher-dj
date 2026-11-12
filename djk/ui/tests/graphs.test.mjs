// Baukasten S12 task 2: load and remove Baukasten graphs from the page server (GET /graphen, POST /graph).
// Server in-process without a kern; sends are read from the log (typ 'an_kern'), kern acknowledgements are fed through vomKern.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';
import { setzeAutonom, schreibeLebt, schreibeStatus } from '../../generator/src/pattern_state.mjs';
import { listeGraphen, graphenOrdner, normalisierePanel } from '../graphs.ts';
import { stromVonZiel } from '../track.ts';

belegeTestInstanz();
// fresh connection per request: servers of earlier tests sit on the same port and a pooled keep-alive socket would be dead
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 3000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };
const NAME_33 = 'a'.repeat(33);

function graphDatei(dir, datei, inhalt) { fs.writeFileSync(path.join(dir, datei), typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt)); }
const INST = { format: 'baukasten/2', name: 'inst', stimmen: 1, regler_namen: { 1: 'Rate' }, knoten: [{ id: 'n', art: 'note' }, { id: 'o', art: 'ausgang' }], kanten: [] };
const EFF = { format: 'baukasten/2', name: 'eff', stimmen: 1, knoten: [{ id: 'e', art: 'eingang' }, { id: 'o', art: 'ausgang' }], kanten: [] };

function baueOrdner() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk12-'));
  graphDatei(dir, 'inst.json', INST);
  graphDatei(dir, 'eff.json', EFF);
  graphDatei(dir, 'kaputt.json', '{ nicht json');
  graphDatei(dir, 'böse name.json', INST);
  graphDatei(dir, 'Lead.json', INST);                                 // upper case: the kern name rule is [a-z0-9_-]
  graphDatei(dir, `${NAME_33}.json`, INST);                           // 33 characters
  graphDatei(dir, 'lead.json', { ...INST, name: 'sync-lead' });       // JSON name differs from the file name: the file name counts
  fs.mkdirSync(path.join(dir, 'samples'));
  return dir;
}

async function stapel(t, { bkOrdner = baueOrdner() } = {}) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const huellen = path.join(tmp('bk12-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = { inst: process.env.CYPHERDJ_INSTANZ, bk: process.env.CYPHERDJ_BK_ORDNER };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  process.env.CYPHERDJ_BK_ORDNER = bkOrdner;
  const muster = tmp('bk12-muster-');
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('bk12-bestand-'), arbeitsbestand: tmp('bk12-ab-'),
    mutationen: [], loops: tmp('bk12-loops-'), kits: tmp('bk12-kits-'), welleCache: tmp('bk12-welle-'), musterOrdner: muster, hotcueOrdner: tmp('bk12-hc-'),
    rasterOrdner: tmp('bk12-raster-'), huellen, wirtOrdner: tmp('bk12-wirt-'), sammlungen: tmp('bk12-sets-'), musterBibliothek: tmp('bk12-mb-'), musterSets: tmp('bk12-ms-'),
    mediathek: path.join(tmp('bk12-med-'), 'nix.sqlite'), katalog: path.join(tmp('bk12-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('bk12-do-'), 'nix'),
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('bk12-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('bk12-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => log.push(z) });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
    if (alt.bk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt.bk;
  });
  const url = `http://127.0.0.1:${47300 + K}`;
  const sendungen = () => log.filter((z) => z.typ === 'an_kern' && (z.adresse === '/erz/strom' || z.adresse === '/k/kanal/graph'));
  const post = (daten, kopf = {}) => hol(`${url}/graph`, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
  // POST and answer the kern's acknowledgement (status 1 then `status`, grund) as soon as the command left for the kern
  async function postMitQuittung(daten, status = 3, grund = '', kopf = {}) {
    const n0 = sendungen().length;
    const p = post(daten, kopf);
    assert.ok(await bis(() => sendungen().length > n0), 'the command reaches the kern');
    const s = sendungen().at(-1);
    o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 1, ist_sample: 0, ist_beat: 0, grund: '' } });
    o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status, ist_sample: 0, ist_beat: 0, grund } });
    return { ...(await p), gesendet: s };
  }
  const geladen = async () => (await (await hol(`${url}/graphen`)).json()).geladen;
  return { o, url, log, muster, post, postMitQuittung, sendungen, geladen, bkOrdner };
}

test('list: instruments and effects with regler_namen, file name counts, bad names and broken JSON are skipped and named', async (t) => {
  const { url } = await stapel(t);
  const r = await (await hol(`${url}/graphen`)).json();
  assert.deepEqual(r.graphen, [
    { name: 'eff', art: 'effekt', regler_namen: {} },
    { name: 'inst', art: 'instrument', regler_namen: { 1: 'Rate' } },
    { name: 'lead', art: 'instrument', regler_namen: { 1: 'Rate' } },
  ]);
  assert.deepEqual([...r.uebersprungen].sort(), ['Lead', NAME_33, 'böse name', 'kaputt'].sort());
  assert.deepEqual(r.geladen, {});
});

test('64 knobs list: regler_namen keys 1..64 are kept (9, 32, 33 and 64 included), 0, 65 and 01 are dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk32-l-'));
  graphDatei(dir, 'viele.json', { ...INST, regler_namen: { 1: 'a', 9: 'nine', 10: 'ten', 32: 'last', 33: 'upper', 64: 'top', 0: 'zero', 65: 'over', '01': 'padded', x: 'no' } });
  assert.deepEqual(listeGraphen(dir).graphen, [{ name: 'viele', art: 'instrument', regler_namen: { 1: 'a', 9: 'nine', 10: 'ten', 32: 'last', 33: 'upper', 64: 'top' } }]);
});

test('list: pure function and folder override (positive control: a folder with one graph lists exactly it)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk12-l-'));
  graphDatei(dir, 'ein-graph.json', EFF);
  assert.deepEqual(listeGraphen(dir).graphen.map((g) => g.name), ['ein-graph']);
  assert.deepEqual(listeGraphen(path.join(dir, 'gibt-es-nicht')), { graphen: [], uebersprungen: [] });
  process.env.CYPHERDJ_BK_ORDNER = dir;
  try { assert.equal(graphenOrdner(), dir); } finally { delete process.env.CYPHERDJ_BK_ORDNER; }
});

test('load on erz/3: /erz/strom strom 3, ziel bk:inst, kanal erz/3; geladen set on quittung 3', async (t) => {
  const { postMitQuittung, geladen } = await stapel(t);
  const r = await postMitQuittung({ kanal: 'erz/3', name: 'inst' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.ok, true);
  assert.equal(r.j.quittung.status, 3);
  assert.equal(r.gesendet.adresse, '/erz/strom');
  assert.deepEqual({ ...r.gesendet.felder, id: 0 }, { id: 0, quelle: 'andreas', strom: 3, ziel: 'bk:inst', kanal: 'erz/3' });
  assert.deepEqual(await geladen(), { 'erz/3': 'inst' });
});

test('load on deck/2 and fx/3: /k/kanal/graph with kanal and name', async (t) => {
  const { postMitQuittung, geladen } = await stapel(t);
  const a = await postMitQuittung({ kanal: 'deck/2', name: 'eff' });
  assert.equal(a.gesendet.adresse, '/k/kanal/graph');
  assert.deepEqual({ ...a.gesendet.felder, id: 0 }, { id: 0, quelle: 'andreas', kanal: 'deck/2', name: 'eff' });
  const b = await postMitQuittung({ kanal: 'fx/3', name: 'eff' });
  assert.deepEqual({ ...b.gesendet.felder, id: 0 }, { id: 0, quelle: 'andreas', kanal: 'fx/3', name: 'eff' });
  assert.deepEqual(await geladen(), { 'deck/2': 'eff', 'fx/3': 'eff' });
});

test('remove: erz/3 "" sends ziel bk:, deck/2 "" sends name ""; geladen entries gone (and the other stays)', async (t) => {
  const { postMitQuittung, geladen } = await stapel(t);
  await postMitQuittung({ kanal: 'erz/3', name: 'inst' });
  await postMitQuittung({ kanal: 'deck/2', name: 'eff' });
  await postMitQuittung({ kanal: 'deck/1', name: 'eff' });
  const e = await postMitQuittung({ kanal: 'erz/3', name: '' });
  assert.equal(e.gesendet.adresse, '/erz/strom');
  assert.deepEqual({ ...e.gesendet.felder, id: 0 }, { id: 0, quelle: 'andreas', strom: 3, ziel: 'bk:', kanal: 'erz/3' });
  const d = await postMitQuittung({ kanal: 'deck/2', name: '' });
  assert.deepEqual({ ...d.gesendet.felder, id: 0 }, { id: 0, quelle: 'andreas', kanal: 'deck/2', name: '' });
  assert.deepEqual(await geladen(), { 'deck/1': 'eff' });
});

test('refusals before the kern: falsche_art, kein_midi_strom, unbekannt, ausserhalb_bereich, name rule; nothing is sent', async (t) => {
  const { post, sendungen } = await stapel(t);
  const falle = [
    [{ kanal: 'erz/2', name: 'eff' }, 400, 'falsche_art'],
    [{ kanal: 'deck/1', name: 'inst' }, 400, 'falsche_art'],
    [{ kanal: 'fx/4', name: 'inst' }, 400, 'falsche_art'],
    [{ kanal: 'erz/1', name: 'inst' }, 400, 'kein_midi_strom'],   // stream 1 runs in kit mode: notes are kit indices (C10)
    [{ kanal: 'erz/3', name: 'nix' }, 404, 'unbekannt'],
    [{ kanal: 'erz/4', name: 'inst' }, 400, 'ausserhalb_bereich'],   // S18: erz/4 is the production, erz/8 the cue input; erz/5..7 are instrument channels now
    [{ kanal: 'erz/8', name: 'inst' }, 400, 'ausserhalb_bereich'],
    [{ kanal: 'erz/6', name: 'eff' }, 400, 'falsche_art'],
    [{ kanal: 'pad/1', name: 'eff' }, 400, 'falsche_art'],
    [{ kanal: 'deck/5', name: 'eff' }, 400, 'ausserhalb_bereich'],
    [{ kanal: 'erz/3', name: '../x' }, 400, 'name'],
    [{ kanal: 'erz/3', name: 'Lead' }, 400, 'name'],
    [{ kanal: 'erz/3', name: NAME_33 }, 400, 'name'],
    [{ kanal: 'erz/3', name: 7 }, 400, 'name'],
    [{ kanal: 3, name: 'inst' }, 400, 'ausserhalb_bereich'],
  ];
  for (const [daten, code, fehler] of falle) {
    const r = await post(daten);
    assert.equal(r.code, code, JSON.stringify([daten, r]));
    assert.equal(r.j.fehler, fehler, JSON.stringify([daten, r]));
  }
  assert.equal(sendungen().length, 0, 'none of the refusals reached the kern');
  // negative control: a harmless request does reach the kern
  const n0 = sendungen().length;
  void post({ kanal: 'erz/3', name: 'inst' });
  assert.ok(await bis(() => sendungen().length > n0));
});

test('kern refusal: quittung 6 pruefung answers 200 with the quittung, geladen unchanged', async (t) => {
  const { postMitQuittung, geladen } = await stapel(t);
  await postMitQuittung({ kanal: 'erz/3', name: 'inst' });
  const r = await postMitQuittung({ kanal: 'erz/3', name: 'lead' }, 6, 'pruefung');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.quittung.status, 6);
  assert.equal(r.j.quittung.grund, 'pruefung');
  assert.deepEqual(await geladen(), { 'erz/3': 'inst' }, 'a refused load leaves the loaded graph as it was');
});

test('no quittung within the wait: ok with quittung null, geladen NOT set (C11)', async (t) => {
  const { post, geladen } = await stapel(t);
  const t0 = Date.now();
  const r = await post({ kanal: 'erz/3', name: 'inst' });
  assert.equal(r.code, 200);
  assert.equal(r.j.ok, true);
  assert.equal(r.j.quittung, null);
  assert.ok(Date.now() - t0 >= 3500, `waits up to 4 s for a slow load (took ${Date.now() - t0} ms)`);
  assert.deepEqual(await geladen(), {});
});

test('kern restart clears geladen (generation 1, load, generation 2) and pushes it to the page stream', async (t) => {
  const { o, url, postMitQuittung, geladen } = await stapel(t);
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 1, sample: 0 } });
  await postMitQuittung({ kanal: 'erz/3', name: 'inst' });
  assert.deepEqual(await geladen(), { 'erz/3': 'inst' });
  const lage = await (await hol(`${url}/lage`)).json();
  assert.ok(lage, 'lage readable');
  // a new SSE connection gets the state with the start message
  const ac = new AbortController();
  const r = await hol(`${url}/strom`, { signal: ac.signal });
  const { value } = await r.body.getReader().read(); ac.abort();
  const start = JSON.parse(new TextDecoder().decode(value).replace(/^data: /, ''));
  assert.deepEqual(start.f.graphen_geladen, { 'erz/3': 'inst' });
  // events pushed live
  const ac2 = new AbortController();
  const r2 = await hol(`${url}/strom`, { signal: ac2.signal });
  const leser = r2.body.getReader(), dek = new TextDecoder();
  await leser.read();
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 2, sample: 0 } });
  let text = '';
  for (let i = 0; i < 20 && !text.includes('"a":"graphen"'); i++) { const { value: v } = await Promise.race([leser.read(), warte(500).then(() => ({ value: undefined }))]); if (v) text += dek.decode(v); }
  ac2.abort();
  assert.ok(text.includes('"a":"graphen"') && text.includes('"geladen":{}'), `the clearing is pushed: ${text}`);
  assert.deepEqual(await geladen(), {}, 'generation 2 is a new kern: nothing is loaded');
  // negative control: the same generation again does not clear
  await postMitQuittung({ kanal: 'deck/1', name: 'eff' });
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 2, sample: 0 } });
  assert.deepEqual(await geladen(), { 'deck/1': 'eff' });
});

test('Cypher: stop Cypher gives 409 ki_gestoppt, AUTO off on the stream gives 409 auto_aus; nothing sent; AUTO on passes', async (t) => {
  const { o, post, sendungen, muster } = await stapel(t);
  const cypher = { 'x-djk-quelle': 'cypher' };
  // AUTO off on stream 3 (folder muster3)
  setzeAutonom(`${muster}3`, false);
  let r = await post({ kanal: 'erz/3', name: 'inst' }, cypher);
  assert.deepEqual([r.code, r.j.fehler], [409, 'auto_aus']);
  setzeAutonom(`${muster}3`, true);
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1 } });
  r = await post({ kanal: 'erz/3', name: 'inst' }, cypher);
  assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt']);
  r = await post({ kanal: 'deck/1', name: 'eff' }, cypher);
  assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt'], 'also for effects');
  assert.equal(sendungen().length, 0);
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 0 } });
  const n0 = sendungen().length;
  void post({ kanal: 'erz/3', name: 'inst' }, cypher);
  assert.ok(await bis(() => sendungen().length > n0), 'with AUTO on and no stop the load goes through');
  assert.equal(sendungen().at(-1).felder.quelle, 'cypher');
});

test('effect loads answer 1, 2, 3 at once and the wait can return on the 2 (measured on instance d): geladen is set on 2 as well, not on 6', async (t) => {
  const { postMitQuittung, geladen } = await stapel(t);
  const r = await postMitQuittung({ kanal: 'deck/1', name: 'eff' }, 2);
  assert.equal(r.j.quittung.status, 2);
  assert.deepEqual(await geladen(), { 'deck/1': 'eff' });
  await postMitQuittung({ kanal: 'deck/2', name: 'eff' }, 6, 'kein_eingang');
  assert.deepEqual(await geladen(), { 'deck/1': 'eff' }, 'negative control: a refusal sets nothing');
});

// ---- Baukasten S16: the kern reports which graph sits on each channel (/e/graph), the server asks (/k/graph/frage) ----
const LEER_PUSH = '"a":"graphen","f":{"geladen":{}}';   // the push of an empty map (the start message also carries other "geladen" keys)
const fragen = (log) => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/graph/frage');
const eg = (o, kanal, name) => o.vomKern({ adresse: '/e/graph', felder: { kanal, name } });
// reads the page stream in the background; text() is everything received so far
async function seitenStrom(t, url) {
  const ac = new AbortController();
  const r = await hol(`${url}/strom`, { signal: ac.signal });
  const leser = r.body.getReader(), dek = new TextDecoder();
  let text = '';
  (async () => { try { for (;;) { const { value, done } = await leser.read(); if (done) break; text += dek.decode(value); } } catch { /* aborted */ } })();
  t.after(() => ac.abort());
  await bis(() => text.length > 0);   // the start message
  return { text: () => text, zaehle: (muster) => text.split(muster).length - 1 };
}

test('S16 Fehlerfall: a stale name is replaced by the kern\'s /e/graph and pushed to the page exactly once', async (t) => {
  const { o, url, log, postMitQuittung, geladen } = await stapel(t);
  const strom = await seitenStrom(t, url);
  await postMitQuittung({ kanal: 'erz/3', name: 'inst' });
  assert.deepEqual(await geladen(), { 'erz/3': 'inst' });
  assert.equal(strom.zaehle(LEER_PUSH), 0);
  eg(o, 'erz/3', '');   // the erzeuger re-announced a kit target: the kern has no graph there any more
  assert.deepEqual(await geladen(), {}, 'the server follows the kern, not its own record');
  await bis(() => strom.zaehle(LEER_PUSH) >= 1);
  assert.equal(strom.zaehle(LEER_PUSH), 1);
  eg(o, 'erz/3', '');   // the same word again changes nothing
  await warte(100);
  assert.equal(strom.zaehle(LEER_PUSH), 1, 'no further push for an unchanged value');
  assert.deepEqual(log.filter((z) => z.typ === 'graph_vom_kern'), [{ typ: 'graph_vom_kern', kanal: 'erz/3', vorher: 'inst', name: '' }]);
});

test('S16: a POST that timed out without quittung is closed by the kern\'s own /e/graph', async (t) => {
  const { o, post, geladen } = await stapel(t);
  const r = await post({ kanal: 'erz/3', name: 'inst' });
  assert.equal(r.j.quittung, null);
  assert.deepEqual(await geladen(), {});
  eg(o, 'erz/3', 'inst');
  assert.deepEqual(await geladen(), { 'erz/3': 'inst' });
});

test('S16 negative control: /e/graph of an empty slot with nothing loaded changes nothing and pushes nothing', async (t) => {
  const { o, url, log, postMitQuittung, geladen } = await stapel(t);
  await postMitQuittung({ kanal: 'erz/3', name: 'inst' });
  const strom = await seitenStrom(t, url);
  const vorher = strom.zaehle('"a":"graphen"');
  eg(o, 'deck/2', '');
  await warte(100);
  assert.deepEqual(await geladen(), { 'erz/3': 'inst' });
  assert.equal(strom.zaehle('"a":"graphen"'), vorher);
  assert.equal(log.filter((z) => z.typ === 'graph_vom_kern').length, 0);
});

test('S16: the server asks at the first willkommen, after a kern restart, and reports how fresh its knowledge is', async (t) => {
  const { o, url, log } = await stapel(t);
  const alter = async () => (await (await hol(`${url}/graphen`)).json()).geladen_geprueft_vor_ms;
  assert.equal(fragen(log).length, 0, 'nothing asked before the kern spoke');
  assert.equal(await alter(), null, 'unknown before the first /e/graph');
  o.vomKern({ adresse: '/k/willkommen', felder: { generation: 1, sample: 0 } });
  assert.equal(fragen(log).length, 1);
  assert.equal(fragen(log)[0].felder.quelle, 'andreas');
  o.vomKern({ adresse: '/k/willkommen', felder: { generation: 1, sample: 0 } });
  assert.equal(fragen(log).length, 1, 'the same generation again is not a new contact');
  eg(o, 'erz/3', '');
  const a = await alter();
  assert.ok(typeof a === 'number' && a >= 0, `age is a number after the first /e/graph, got ${a}`);
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 2, sample: 0 } });
  assert.equal(fragen(log).length, 2);
  assert.equal(await alter(), null, 'a new kern: what was reported before no longer counts');
});

test('S16: a fresh server (restarted alone) is filled by the kern\'s answer', async (t) => {
  const { o, geladen } = await stapel(t);
  assert.deepEqual(await geladen(), {});
  eg(o, 'deck/1', 'eff');
  assert.deepEqual(await geladen(), { 'deck/1': 'eff' });
});

test('S16: stoppe() clears the ask timer', async (t) => {
  const { o } = await stapel(t);
  assert.notEqual(o.graphTakt, null, 'the 30 s ask timer runs while the server runs');
  await o.stoppe();
  assert.equal(o.graphTakt, null);
});

// ---- S18: instruments on erz/5..7 and pad/1..2 (streams 5, 6, 7, 9, 10), served by the multi-stream erzeuger --------------
const NEU = [['erz/5', 5, 'midi:3:1'], ['erz/6', 6, 'midi:3:2'], ['erz/7', 7, 'midi:3:3'], ['pad/1', 9, 'midi:4:1'], ['pad/2', 10, 'midi:4:2']];
const lebt = (muster, strom, zeit = Date.now()) => { fs.mkdirSync(`${muster}${strom}`, { recursive: true }); schreibeLebt(`${muster}${strom}`, { strom, ziel: 'x' }, zeit); };

test('S18 load and remove on erz/5..7 and pad/1..2: /erz/strom with the stream of the table, ziel bk:inst, then bk:', async (t) => {
  const { postMitQuittung, geladen, muster } = await stapel(t);
  for (const [kanal, strom] of NEU) lebt(muster, strom);
  for (const [kanal, strom] of NEU) {
    const r = await postMitQuittung({ kanal, name: 'inst' });
    assert.equal(r.code, 200, JSON.stringify([kanal, r.j]));
    assert.equal(r.gesendet.adresse, '/erz/strom');
    assert.deepEqual({ ...r.gesendet.felder, id: 0 }, { id: 0, quelle: 'andreas', strom, ziel: 'bk:inst', kanal }, kanal);
  }
  assert.deepEqual(await geladen(), { 'erz/5': 'inst', 'erz/6': 'inst', 'erz/7': 'inst', 'pad/1': 'inst', 'pad/2': 'inst' });
  const e = await postMitQuittung({ kanal: 'erz/6', name: '' });
  assert.deepEqual({ ...e.gesendet.felder, id: 0 }, { id: 0, quelle: 'andreas', strom: 6, ziel: 'bk:', kanal: 'erz/6' });
  const p = await postMitQuittung({ kanal: 'pad/1', name: '' });
  assert.deepEqual({ ...p.gesendet.felder, id: 0 }, { id: 0, quelle: 'andreas', strom: 9, ziel: 'bk:', kanal: 'pad/1' });
  assert.deepEqual(Object.keys(await geladen()).sort(), ['erz/5', 'erz/7', 'pad/2']);
});

test('S18 kein_erzeuger: no lebt.json or one older than 6 s gives 409 and nothing is sent; a fresh one passes; removal never needs the process', async (t) => {
  const { post, postMitQuittung, sendungen, muster } = await stapel(t);
  let r = await post({ kanal: 'erz/6', name: 'inst' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_erzeuger'], JSON.stringify(r));
  assert.match(r.j.text, /djk-stroeme/);
  lebt(muster, 6, Date.now() - 7000);
  r = await post({ kanal: 'erz/6', name: 'inst' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_erzeuger'], 'a heartbeat 7 s old counts as dead');
  r = await post({ kanal: 'pad/2', name: 'inst' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_erzeuger'], 'pad/2 is stream 10: its own folder, no heartbeat');
  assert.equal(sendungen().length, 0, 'nothing reached the kern');
  lebt(muster, 6, Date.now() - 4000);   // negative control: 4 s old is still alive
  const ok = await postMitQuittung({ kanal: 'erz/6', name: 'inst' });
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  // taking a graph off must always work: the process may have died after the graph was loaded
  fs.rmSync(`${muster}6/lebt.json`);
  const weg = await postMitQuittung({ kanal: 'erz/6', name: '' });
  assert.equal(weg.code, 200, JSON.stringify(weg.j));
  assert.equal(weg.gesendet.felder.ziel, 'bk:');
  // streams 2 and 3 never need the process (negative control for the new check)
  const e3 = await postMitQuittung({ kanal: 'erz/3', name: 'inst' });
  assert.equal(e3.code, 200, JSON.stringify(e3.j));
});

test('S18 Cypher on a new stream: AUTO off for stream 6 gives 409 auto_aus, then the heartbeat check; AUTO on passes', async (t) => {
  const { post, sendungen, muster } = await stapel(t);
  const cypher = { 'x-djk-quelle': 'cypher' };
  lebt(muster, 6);
  setzeAutonom(`${muster}6`, false);
  let r = await post({ kanal: 'erz/6', name: 'inst' }, cypher);
  assert.deepEqual([r.code, r.j.fehler, r.j.strom], [409, 'auto_aus', 6], JSON.stringify(r));
  assert.equal(sendungen().length, 0);
  setzeAutonom(`${muster}6`, true);
  const n0 = sendungen().length;
  void post({ kanal: 'erz/6', name: 'inst' }, cypher);
  assert.ok(await bis(() => sendungen().length > n0), 'AUTO on and a live process: the load goes through');
  assert.equal(sendungen().at(-1).felder.strom, 6);
});

test('S18 pad fader for Cypher: with an instrument graph on an empty box pad/1/fader opens without a hearing check; no graph, a foreign loop or the other box stay 409 kein_hoerschein', async (t) => {
  const { o, url, postMitQuittung, muster, log } = await stapel(t);
  const cypher = { 'x-djk-quelle': 'cypher' };
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil' && /^pad\//.test(z.felder.pfad));
  const regler = (pfad) => hol(`${url}/regler`, { method: 'POST', headers: { 'content-type': 'application/json', ...cypher }, body: JSON.stringify({ pfad, nach: -6, takte: 0 }) });
  // negative controls first: nothing on the box
  let r = await regler('pad/1/fader');
  assert.deepEqual([r.status, (await r.json()).fehler], [409, 'kein_hoerschein'], 'an empty box with no graph stays closed for Cypher');
  assert.equal(teile().length, 0);
  // an instrument graph on pad/1 (live stream 9)
  lebt(muster, 9);
  assert.equal((await postMitQuittung({ kanal: 'pad/1', name: 'inst' }, 3, '', cypher)).code, 200);
  // the other box is not affected
  r = await regler('pad/2/fader');
  assert.deepEqual([r.status, (await r.json()).fehler], [409, 'kein_hoerschein'], 'pad/2 has no graph');
  // a foreign loop in the box keeps the check even with a graph on it
  o.stand.loops['1'] = { name: 'fremd-loop' };
  r = await regler('pad/1/fader');
  assert.deepEqual([r.status, (await r.json()).fehler], [409, 'kein_hoerschein'], 'foreign loop plus graph: still closed');
  delete o.stand.loops['1'];
  assert.equal(teile().length, 0);
  // the case: graph on an empty box -> the move goes to the kern
  const p = regler('pad/1/fader');
  assert.ok(await bis(() => teile().length === 1), 'the fader move reaches the kern');
  const s = teile()[0];
  o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 2, ist_sample: 0, ist_beat: 0, grund: '' } });
  assert.equal((await p).status, 200);
  // removing the graph closes the gate again
  assert.equal((await postMitQuittung({ kanal: 'pad/1', name: '' }, 3, '', cypher)).code, 200);
  r = await regler('pad/1/fader');
  assert.deepEqual([r.status, (await r.json()).fehler], [409, 'kein_hoerschein'], 'graph removed: closed again');
});

test('S18 review fix: AUTO off holds the new streams for /regler and /spur (stream 9 = pad/1, stream 6 = erz/6); AUTO on and the other streams pass', async (t) => {
  const { o, url, postMitQuittung, muster, log } = await stapel(t);
  const cypher = { 'x-djk-quelle': 'cypher' };
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil');
  const post = (weg, daten) => hol(`${url}${weg}`, { method: 'POST', headers: { 'content-type': 'application/json', ...cypher }, body: JSON.stringify(daten) });
  const regler = (pfad) => post('/regler', { pfad, nach: -6, takte: 0 });
  const spur = async (ziel) => {   // /spur wants a clock before it looks at the targets; /regler runs without one (no wait for a bar)
    o.kern.uhr = { beat: 8, bpm: 128, mono_ns: 0 };
    try { return await post('/spur', { spur: { name: 'sperre', fahrten: [{ ziel, ab_takt: 1, nach: -6 }] } }); } finally { o.kern.uhr = null; }
  };
  // graph on pad/1 (stream 9) opens the box for Cypher; then Andreas takes AUTO off for stream 9
  lebt(muster, 9);
  assert.equal((await postMitQuittung({ kanal: 'pad/1', name: 'inst' }, 3, '', cypher)).code, 200);
  setzeAutonom(`${muster}9`, false);
  let r = await regler('pad/1/fader');
  let j = await r.json();
  assert.deepEqual([r.status, j.fehler, j.strom], [409, 'auto_aus', 9], 'pad/1 fader: AUTO off for stream 9 is refused');
  assert.equal(teile().length, 0, 'nothing reached the kern');
  r = await spur('pad/1/fader');
  j = await r.json();
  assert.deepEqual([r.status, j.fehler, j.strom], [409, 'auto_aus', 9], '/spur with a pad/1 target is refused too');
  // the other streams are held by their own switch: erz/6 (stream 6) and pad/2 (stream 10)
  setzeAutonom(`${muster}6`, false);
  r = await regler('erz/6/fader'); j = await r.json();
  assert.deepEqual([r.status, j.fehler, j.strom], [409, 'auto_aus', 6], 'erz/6');
  setzeAutonom(`${muster}10`, false);
  r = await regler('pad/2/trim'); j = await r.json();
  assert.deepEqual([r.status, j.fehler, j.strom], [409, 'auto_aus', 10], 'pad/2');
  // negative controls: erz/4 and erz/8 are no stream (no auto_aus), the AUTO state of one stream does not hold another
  setzeAutonom(`${muster}9`, true);
  r = await regler('pad/2/fader'); j = await r.json();
  assert.equal(j.fehler, 'auto_aus', 'pad/2 still held by stream 10');
  // control: AUTO on for stream 9 -> the pad/1 fader goes to the kern with 200
  const p = regler('pad/1/fader');
  assert.ok(await bis(() => teile().length === 1), 'AUTO on: the fader move reaches the kern');
  const s = teile()[0];
  o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 2, ist_sample: 0, ist_beat: 0, grund: '' } });
  assert.equal((await p).status, 200, 'AUTO on: 200');
});

test('S18 review fix: stromVonZiel follows the shared table; erz/4, erz/8, decks and unknown pads are no stream', () => {
  const erwartet = { 'erz/1/fader': 1, 'erz/3/trim': 3, 'erz/5/fader': 5, 'erz/6/eq/low': 6, 'erz/7/fader': 7, 'pad/1/fader': 9, 'pad/2/trim': 10,
    'erz/4/fader': null, 'erz/8/fader': null, 'pad/3/fader': null, 'deck/1/fader': null, 'master/fader': null, 'wirt:bass/cutoff': 2, 'wirt:melodie/cutoff': 3, 'strom:2': 2 };
  for (const [ziel, strom] of Object.entries(erwartet)) assert.equal(stromVonZiel(ziel), strom, ziel);
});

test('S18 review fix: a pending foreign loop load keeps the pad check even with a graph on the box (boxNurGraph loopLadung clause)', async (t) => {
  const { o, url, postMitQuittung, muster } = await stapel(t);
  const cypher = { 'x-djk-quelle': 'cypher' };
  lebt(muster, 9);
  assert.equal((await postMitQuittung({ kanal: 'pad/1', name: 'inst' }, 3, '', cypher)).code, 200);
  o.loopLadung['1'] = { name: 'fremd', quelle: 'andreas' };   // a foreign load was sent, no echo yet
  const r = await hol(`${url}/regler`, { method: 'POST', headers: { 'content-type': 'application/json', ...cypher }, body: JSON.stringify({ pfad: 'pad/1/fader', nach: -6, takte: 0 }) });
  assert.deepEqual([r.status, (await r.json()).fehler], [409, 'kein_hoerschein'], 'pending foreign load plus graph: still closed');
});

// Baukasten S15 task 2 (break 7): an instrument on a stream whose erzeuger runs in kit mode is refused (its notes are kit
// indices: note() values are dropped, s() values arrive as MIDI notes 0..N). The erzeuger reports the mode as
// status.json "noten". An unknown mode passes; removing a graph is never refused.
for (const [wer, kopf] of [['cypher', { 'x-djk-quelle': 'cypher' }]]) {
  test(`instrument on a kit-mode stream (${wer}): 400 kein_midi_strom, nothing sent; midi stream and unknown mode pass; removal always passes`, async (t) => {
    const { muster, post, postMitQuittung, sendungen } = await stapel(t);
    fs.mkdirSync(`${muster}3`, { recursive: true });
    schreibeStatus(`${muster}3`, { nr: 1, noten: 'kit' });
    const r = await post({ kanal: 'erz/3', name: 'inst' }, kopf);
    assert.deepEqual([r.code, r.j.fehler], [400, 'kein_midi_strom'], JSON.stringify([kopf, r]));
    assert.equal(r.j.strom, 3);
    assert.match(r.j.text, /kit mode/);
    assert.match(r.j.text, /instrumente/);
    assert.equal(sendungen().filter((z) => z.adresse === '/erz/strom').length, 0, 'the refusal never reached the kern');
    // negative control 1: the same stream in midi mode passes and sends ziel bk:inst
    schreibeStatus(`${muster}3`, { nr: 1, noten: 'midi' });
    const ok = await postMitQuittung({ kanal: 'erz/3', name: 'inst' }, 3, '', kopf);
    assert.equal(ok.code, 200, JSON.stringify(ok.j));
    assert.equal(ok.gesendet.felder.ziel, 'bk:inst');
    // negative control 2: no status.json on stream 2 (old erzeuger, nothing written yet) is unknown and passes
    assert.equal(fs.existsSync(path.join(`${muster}2`, 'status.json')), false);
    const unbekannt = await postMitQuittung({ kanal: 'erz/2', name: 'inst' }, 3, '', kopf);
    assert.equal(unbekannt.code, 200, JSON.stringify(unbekannt.j));
    assert.equal(unbekannt.gesendet.felder.ziel, 'bk:inst');
    // a status file without the field (written by an old erzeuger) is unknown as well
    schreibeStatus(`${muster}3`, { nr: 1 });
    assert.equal((await postMitQuittung({ kanal: 'erz/3', name: 'lead' }, 3, '', kopf)).code, 200);
    // removal is never refused, also on a kit stream
    schreibeStatus(`${muster}3`, { nr: 1, noten: 'kit' });
    const weg = await postMitQuittung({ kanal: 'erz/3', name: '' }, 3, '', kopf);
    assert.equal(weg.code, 200, JSON.stringify(weg.j));
    assert.equal(weg.gesendet.felder.ziel, 'bk:');
  });
}

// Review round 2 (bk15), MINOR: Andreas's own page gets a warning, not a lock (memory keine-bevormundung): the graph is loaded, the answer says why it may sound wrong.
test('instrument on a kit-mode stream (andreas): loaded as before, with a warnung; a midi stream has none', async (t) => {
  const { muster, postMitQuittung, sendungen, geladen } = await stapel(t);
  fs.mkdirSync(`${muster}3`, { recursive: true });
  schreibeStatus(`${muster}3`, { nr: 1, noten: 'kit' });
  const r = await postMitQuittung({ kanal: 'erz/3', name: 'inst' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.ok, true);
  assert.match(String(r.j.warnung), /kit mode/);
  assert.match(String(r.j.warnung), /instrumente/);
  assert.equal(r.gesendet.felder.ziel, 'bk:inst', 'the command reached the kern');
  assert.deepEqual(await geladen(), { 'erz/3': 'inst' });
  // negative control: the same stream in midi mode answers without a warnung
  schreibeStatus(`${muster}3`, { nr: 1, noten: 'midi' });
  const ok = await postMitQuittung({ kanal: 'erz/3', name: 'lead' });
  assert.equal(ok.code, 200);
  assert.equal(ok.j.warnung, undefined);
  assert.ok(sendungen().filter((z) => z.adresse === '/erz/strom').length >= 2);
});

test('GET /graphen/panel: ranges of the regler nodes and a valid sidecar; refused sidecar named; unknown graph 404; the list stays as before', async (t) => {
  const dir = baueOrdner();
  graphDatei(dir, 'filt.json', { ...EFF, name: 'filt', knoten: [...EFF.knoten, { id: 'k', art: 'regler', nr: 2, min: 200, max: 8000, log: 1 }] });
  fs.mkdirSync(path.join(dir, 'panels'));
  const panel = { format: 'baukasten-panel/1', graph: 'filt', sections: [{ id: 's', controls: [{ id: 'c', type: 'knob', bind: { regler: 2 }, format: 'hz' }] }] };
  fs.writeFileSync(path.join(dir, 'panels', 'filt.json'), JSON.stringify(panel));
  fs.writeFileSync(path.join(dir, 'panels', 'eff.json'), JSON.stringify({ ...panel, graph: 'eff' }));
  const { url } = await stapel(t, { bkOrdner: dir });
  const r = await hol(`${url}/graphen/panel?name=filt`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { name: 'filt', art: 'effekt', regler: { 2: { min: 200, max: 8000, log: true, vorgabe: 0.5 } }, panel: normalisierePanel(panel), fehler: [] });
  assert.equal((await (await hol(`${url}/graphen/panel?name=filt`)).json()).panel.geraet.art, 'bk', 'the answer carries the panel read as v2');
  const e = await (await hol(`${url}/graphen/panel?name=eff`)).json();
  assert.equal(e.panel, null);
  assert.match(e.fehler[0], /parameter k2 is not defined by the device/);
  assert.deepEqual(await (await hol(`${url}/graphen/panel?name=inst`)).json(), { name: 'inst', art: 'instrument', regler: {}, panel: null, fehler: [] });
  assert.equal((await hol(`${url}/graphen/panel?name=gibt-es-nicht`)).status, 404);
  assert.equal((await hol(`${url}/graphen/panel`)).status, 404);
  const liste = await (await hol(`${url}/graphen`)).json();
  assert.ok(liste.graphen.every((g) => Object.keys(g).sort().join() === 'art,name,regler_namen'), 'the list entries keep their shape');
});

test('GET /geraete/panel and the automatic panel on /graphen/panel: auto without a file, auto with the problems of a broken file, rb338 and surge tables', async (t) => {
  const dir = baueOrdner();
  const knoten = (n) => Array.from({ length: n }, (_, i) => ({ id: `k${i + 1}`, art: 'regler', nr: i + 1, min: 0, max: 1 }));
  graphDatei(dir, 'ohne.json', { ...INST, name: 'ohne', knoten: [...INST.knoten, ...knoten(10)] });
  graphDatei(dir, 'kaputtp.json', { ...INST, name: 'kaputtp', knoten: [...INST.knoten, ...knoten(2)] });
  fs.mkdirSync(path.join(dir, 'panels'));
  fs.writeFileSync(path.join(dir, 'panels', 'kaputtp.json'), '{ kaputt');
  const { url } = await stapel(t, { bkOrdner: dir });
  const g = await (await hol(`${url}/geraete/panel?art=bk&graph=ohne`)).json();
  assert.equal(g.quelle, 'auto');
  assert.deepEqual(g.geraet, { art: 'bk', graph: 'ohne' });
  assert.equal(g.parameter.length, 10);
  assert.deepEqual(g.panel.sections.map((s) => s.controls.length), [8, 2]);
  assert.deepEqual(g.fehler, []);
  const k = await (await hol(`${url}/geraete/panel?art=bk&graph=kaputtp`)).json();
  assert.equal(k.quelle, 'auto');
  assert.match(k.fehler[0], /not valid JSON/);
  const viaGraphen = await (await hol(`${url}/graphen/panel?name=kaputtp`)).json();
  assert.equal(viaGraphen.panel.format, 'cypherdj-panel/2', '/graphen/panel answers the automatic panel');
  assert.match(viaGraphen.fehler[0], /not valid JSON/);
  assert.equal((await (await hol(`${url}/geraete/panel?art=rb338`)).json()).parameter.length, 7);
  assert.equal((await (await hol(`${url}/geraete/panel?art=surge`)).json()).parameter.length, 359);
  assert.equal((await hol(`${url}/geraete/panel?art=bk&graph=gibt-es-nicht`)).status, 404);
  assert.equal((await hol(`${url}/geraete/panel?art=xx`)).status, 400);
});
