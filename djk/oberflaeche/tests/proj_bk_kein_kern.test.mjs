// S17 bk17 task 1: opening a project that holds a sound snapshot while the page server has no kern.
// K1 measures the real in-process server (kern port without a listener, as proj_bk_bruecke.test.mjs) and asserts the acceptance;
// K2/K3 use the stub context.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './hilfen/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './hilfen/instanz.mjs';
import { pruefKontext, sitzung } from './hilfen/proj_kontext.mjs';
import { Projekte } from '../projekt/ablage.ts';

belegeTestInstanz();
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });
const INST = { format: 'baukasten/2', name: 'inst', stimmen: 1, regler_namen: { 1: 'Rate' }, knoten: [{ id: 'n', art: 'note' }, { id: 'o', art: 'ausgang' }], kanten: [] };

async function realerServer(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const bkOrdner = tmp('bk17-graphen-');
  fs.writeFileSync(path.join(bkOrdner, 'inst.json'), JSON.stringify(INST));
  fs.mkdirSync(path.join(bkOrdner, 'samples'));
  const huellen = path.join(tmp('bk17-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = { inst: process.env.CYPHERDJ_INSTANZ, bk: process.env.CYPHERDJ_BK_ORDNER };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  process.env.CYPHERDJ_BK_ORDNER = bkOrdner;
  const o = new Oberflaeche({ port: 47340 + K, kernPort: 47140 + K, aboPort: 47190 + K, leitstandWs: 47240 + K, bestand: tmp('bk17-bestand-'), arbeitsbestand: tmp('bk17-ab-'),
    mutationen: [], loops: tmp('bk17-loops-'), kits: tmp('bk17-kits-'), welleCache: tmp('bk17-welle-'), musterOrdner: tmp('bk17-muster-'), hotcueOrdner: tmp('bk17-hc-'),
    rasterOrdner: tmp('bk17-raster-'), huellen, wirtOrdner: tmp('bk17-wirt-'), sammlungen: tmp('bk17-sets-'), musterBibliothek: tmp('bk17-mb-'), musterSets: tmp('bk17-ms-'),
    mediathek: path.join(tmp('bk17-med-'), 'nix.sqlite'), katalog: path.join(tmp('bk17-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('bk17-do-'), 'nix'),
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('bk17-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('bk17-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => log.push(z) });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
    if (alt.bk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt.bk;
  });
  const url = `http://127.0.0.1:${47340 + K}`;
  const post = (pfad, daten) => hol(`${url}${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
  return { o, log, post };
}

test('S17 K1 measure: open without a kern, with and without a snapshot', { timeout: 60000 }, async (t) => {
  const { log, post } = await realerServer(t);
  const a = await post('/proj/neu', { name: 'ohne bk' });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const b = await post('/proj/neu', { name: 'mit bk' });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  const s = await post('/proj/aendern', { rev: b.j.projekt.rev, label: 'Sound', befehle: [{ befehl: 'bk_setzen', kanal: 'erz/3', graph: 'inst' }] });
  assert.equal(s.code, 200, JSON.stringify(s.j));
  log.length = 0;
  const t0 = Date.now();
  const ra = await post('/proj/oeffnen', { slug: a.j.slug });
  const ohne = Date.now() - t0;
  assert.equal(ra.code, 200, JSON.stringify(ra.j));
  const t1 = Date.now();
  const rb = await post('/proj/oeffnen', { slug: b.j.slug });
  const mit = Date.now() - t1;
  assert.equal(rb.code, 200, JSON.stringify(rb.j));
  const bk = rb.j.kern.baukasten;
  const gesendet = log.filter((z) => z.typ === 'an_kern' && (z.adresse === '/erz/strom' || (z.adresse === '/k/teil' && /\/bk\//.test(String(z.felder?.pfad ?? '')))));
  console.log(`MESS oeffnen_ohne_kern ohne_bk=${ohne} mit_bk=${mit} grund=${bk?.[0]?.grund} gesendet_strom_und_bk_teile=${gesendet.length}`);
  // acceptance: the snapshot adds no wait of its own, says why, and sends nothing. The remaining ~4 s are the control
  // synchronisation of the same open (warteQuittung hard cap without a /uhr), not the snapshot.
  assert.equal(bk?.[0]?.grund, 'kein_kern');
  assert.equal(gesendet.length, 0, 'no /erz/strom and no */bk/* part left for the kern');
  assert.ok(mit - ohne <= 100, `the snapshot added ${mit - ohne} ms`);
});

// stub context: a project with two snapshot entries, the bridge stub reports whether the kern is there
const HASH = 'b'.repeat(64);
const K9 = [0.1, 0.2, 0.9, 0.4, 0.5, 0.6, 0.7, 0.8];
const eintrag = (id, graph) => ({ id, graph, regler: [...K9], sha256: HASH });
function aufbau(t, { kernDa }) {
  const k = pruefKontext({ baukasten: true });
  const e = sitzung(t, { arrFristMs: 30 }, k);   // default bkFristMs (5000): a slow wait would show
  const pr = new Projekte(e.wurzel);
  const { slug, projekt } = pr.lege('Kein Kern');
  projekt.baukasten = [eintrag('erz3', 'sampler-fairlight'), eintrag('deck1', 'sampler-fairlight')];
  pr.speichere(slug, projekt);
  Object.assign(k.bk.hash, { 'sampler-fairlight': HASH });
  k.bk.kernDa = kernDa;
  k.bk.antwort = () => new Promise(() => {});   // the kern never answers (as T3.16)
  return { ...e, k, slug };
}

test('S17 K2 without a kern the restore sends nothing and returns at once with kein_kern', async (t) => {
  const { s, k, slug } = aufbau(t, { kernDa: false });
  const t0 = Date.now();
  const r = await s.oeffnen(slug, 'andreas');
  const dauer = Date.now() - t0;
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.ok(dauer < 300, `open returned after ${dauer} ms`);
  assert.equal(k.bk.aufrufe.length, 0);
  assert.equal(k.teile(/\/bk\//).length, 0);
  assert.deepEqual(r.j.kern.baukasten.map((x) => [x.kanal, x.ok, x.grund, x.text]),
    [['erz/3', false, 'kein_kern', 'the core is not running'], ['deck/1', false, 'kein_kern', 'the core is not running']]);
  // the explicit load answers the same, at once
  const t1 = Date.now();
  const l = await s.bkLaden({}, 'andreas');
  assert.ok(Date.now() - t1 < 300, `bkLaden returned after ${Date.now() - t1} ms`);
  assert.equal(k.bk.aufrufe.length, 0);
  assert.equal(k.teile(/\/bk\//).length, 0);
  assert.deepEqual(l.j.baukasten.map((x) => [x.kanal, x.ok, x.grund, x.text]),
    [['erz/3', false, 'kein_kern', 'the core is not running'], ['deck/1', false, 'kein_kern', 'the core is not running']]);
});

test('S17 K3 negative control: with a kern the restore still sends the knobs and then the graph', async (t) => {
  const { s, k, slug } = aufbau(t, { kernDa: true });
  k.bk.antwort = () => ({ code: 200, j: { ok: true, quittung: { status: 3, grund: '' } } });
  const r = await s.oeffnen(slug, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(k.teile(/^erz\/3\/bk\//).length, 8);
  assert.equal(k.teile(/^deck\/1\/bk\//).length, 8);
  assert.deepEqual(k.bk.aufrufe.map((x) => x.kanal).sort(), ['deck/1', 'erz/3']);
  assert.deepEqual(r.j.kern.baukasten.map((x) => x.ok), [true, true]);
});
