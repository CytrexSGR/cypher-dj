// S17 task 2: the graph bridge BereichKontext.baukasten (graphSetzen shared with POST /graph, graphHash).
// Helpers copied from graphs.test.mjs (own port offset); server in-process without a kern, sends are read from the log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';
import { setzeAutonom } from '../../generator/src/pattern_state.mjs';
import crypto from 'node:crypto';

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
  const o = new Oberflaeche({ port: 47330 + K, kernPort: 47130 + K, aboPort: 47180 + K, leitstandWs: 47230 + K, bestand: tmp('bk12-bestand-'), arbeitsbestand: tmp('bk12-ab-'),
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
  const url = `http://127.0.0.1:${47330 + K}`;
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


// the bridge call returns after the kern acknowledgement; answer it as postMitQuittung does
async function bruecke(o, sendungen, aufruf, status = 3, grund = '') {
  const n0 = sendungen().length;
  const p = aufruf();
  assert.ok(await bis(() => sendungen().length > n0), 'the command reaches the kern');
  const s = sendungen().at(-1);
  o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 1, ist_sample: 0, ist_beat: 0, grund: '' } });
  o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status, ist_sample: 0, ist_beat: 0, grund } });
  return { ...(await p), gesendet: s };
}

test('S17 T2.1 the bridge exists with its four functions', async (t) => {
  const { o } = await stapel(t);
  const b = o.bereichKontext().baukasten;
  for (const f of ['geladen', 'setzeGraph', 'autoAus', 'graphHash']) assert.equal(typeof b?.[f], 'function', f);
});

test('S17 T2.2 setzeGraph sends the stream target, answers 200 and records geladen; the page stream gets a graphen event', async (t) => {
  const { o, url, sendungen } = await stapel(t);
  const b = o.bereichKontext().baukasten;
  const ac = new AbortController();
  const sse = await hol(`${url}/strom`, { signal: ac.signal });
  const leser = sse.body.getReader(), dek = new TextDecoder();
  await leser.read();   // the start message
  const r = await bruecke(o, sendungen, () => b.setzeGraph('erz/3', 'inst', 'andreas'));
  assert.equal(r.code, 200); assert.equal(r.j.ok, true);
  assert.deepEqual([r.gesendet.adresse, r.gesendet.felder.strom, r.gesendet.felder.ziel, r.gesendet.felder.kanal, r.gesendet.felder.quelle], ['/erz/strom', 3, 'bk:inst', 'erz/3', 'andreas']);
  assert.deepEqual(b.geladen(), { 'erz/3': 'inst' });
  let text = '';
  for (let i = 0; i < 20 && !text.includes('"a":"graphen"'); i++) { const { value: v } = await Promise.race([leser.read(), warte(500).then(() => ({ value: undefined }))]); if (v) text += dek.decode(v); }
  ac.abort();
  assert.ok(text.includes('"a":"graphen"') && text.includes('erz/3'), `the page stream got the event: ${text.slice(0, 200)}`);
});

test('S17 T2.3 the same pre-checks as POST /graph, nothing sent', async (t) => {
  const { o, sendungen } = await stapel(t);
  const b = o.bereichKontext().baukasten;
  const faelle = [['erz/1', 'inst', 400, 'kein_midi_strom'], ['deck/1', 'inst', 400, 'falsche_art'], ['erz/4', 'inst', 400, 'ausserhalb_bereich'], ['erz/5', 'inst', 409, 'kein_erzeuger'],   // S18: erz/5 takes instruments, but only with a live erzeuger
   
    ['deck/1', 'nix', 404, 'unbekannt'], ['deck/1', 'Gross', 400, 'name']];
  for (const [kanal, name, code, fehler] of faelle) {
    const r = await b.setzeGraph(kanal, name, 'andreas');
    assert.deepEqual([r.code, r.j.fehler], [code, fehler], `${kanal} ${name}`);
  }
  assert.equal(sendungen().length, 0);
  assert.deepEqual(b.geladen(), {});
});

test('S17 T2.4 quelle cypher is honoured: AUTO off gives 409 auto_aus, nothing sent; AUTO on sends with quelle cypher', async (t) => {
  const { o, sendungen, muster } = await stapel(t);
  const b = o.bereichKontext().baukasten;
  setzeAutonom(`${muster}3`, false);
  const r = await b.setzeGraph('erz/3', 'inst', 'cypher');
  assert.deepEqual([r.code, r.j.fehler], [409, 'auto_aus']);
  assert.equal(sendungen().length, 0);
  assert.equal(b.autoAus('erz/3'), true);
  setzeAutonom(`${muster}3`, true);
  assert.equal(b.autoAus('erz/3'), false, 'positive control: AUTO on');
  assert.equal(b.autoAus('deck/1'), false, 'effects have no AUTO');
  const ok = await bruecke(o, sendungen, () => b.setzeGraph('erz/3', 'inst', 'cypher'));
  assert.equal(ok.gesendet.felder.quelle, 'cypher'); assert.equal(ok.code, 200);
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1 } });
  assert.equal((await b.setzeGraph('erz/3', 'inst', 'cypher')).j.fehler, 'ki_gestoppt');
});

test('S17 T2.5 graphHash is the sha256 of the file bytes; unknown and hostile names give null', async (t) => {
  const { o, bkOrdner } = await stapel(t);
  const b = o.bereichKontext().baukasten;
  const soll = crypto.createHash('sha256').update(fs.readFileSync(path.join(bkOrdner, 'inst.json'))).digest('hex');
  assert.equal(b.graphHash('inst'), soll);
  assert.notEqual(b.graphHash('eff'), soll, 'different file, different hash');
  assert.equal(b.graphHash('nix'), null); assert.equal(b.graphHash('../x'), null); assert.equal(b.graphHash(''), null);
});

test('S17 T2.6 POST /graph is unchanged: one load and one refusal through HTTP', async (t) => {
  const { postMitQuittung, post, geladen, sendungen } = await stapel(t);
  const r = await postMitQuittung({ kanal: 'deck/1', name: 'eff' });
  assert.equal(r.code, 200); assert.equal(r.j.ok, true); assert.equal(r.j.kanal, 'deck/1'); assert.equal(r.j.quittung.status, 3);
  assert.deepEqual(await geladen(), { 'deck/1': 'eff' });
  const n = sendungen().length;
  const f = await post({ kanal: 'deck/1', name: 'inst' });
  assert.deepEqual([f.code, f.j.fehler], [400, 'falsche_art']);
  assert.equal(sendungen().length, n);
});
