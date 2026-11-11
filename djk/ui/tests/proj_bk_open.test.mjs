// S17 task 3: restore the sound snapshot when a project is opened (knobs first, then the graph). Failures never block opening.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pruefKontext, sitzung, ist, arrNr } from './support/proj_context.mjs';
import { Projekte } from '../project/storage.ts';
// the knob rows of a Baukasten INSTRUMENT or effect channel (erz/3/bk/1, deck/1/bk/2, ...); the insert rows ins/bk/<n>/.. (arr-bk) are a different thing and are sent on open
const BK_KANAL_ZEILEN = /^(deck|erz|pad|fx)\/\d+\/bk\//;

const HASH = 'b'.repeat(64);
const acht = (x) => Array(8).fill(x);
const K9 = [0.1, 0.2, 0.9, 0.4, 0.5, 0.6, 0.7, 0.8];
const eintrag = (id, graph, extra = {}) => ({ id, graph, regler: [...K9], sha256: HASH, ...extra });
// A project file with a snapshot, a session on the same folders; the bridge stub knows the hash of every graph by default
function aufbau(t, liste, { baukasten = true, opt = {}, hash = { 'juno-pad-dyn': HASH, 'fx-bandecho': HASH, 'sampler-fairlight': HASH, inst: HASH } } = {}) {
  const k = pruefKontext({ baukasten });
  const e = sitzung(t, { arrFristMs: 30, ...opt }, k);
  const pr = new Projekte(e.wurzel);
  const { slug, projekt } = pr.lege('Snap');
  if (liste) projekt.baukasten = liste;
  pr.speichere(slug, projekt);
  if (k.bk) Object.assign(k.bk.hash, hash);
  return { ...e, slug, pr };
}
const bkTeile = (k, kanal) => k.teile(new RegExp(`^${kanal}/bk/`));

test('S17 T3.9 open restores the knobs, then the graph', async (t) => {
  const { s, k, slug } = aufbau(t, [eintrag('erz2', 'juno-pad-dyn')]);
  const r = await s.oeffnen(slug, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const teile = bkTeile(k, 'erz/2');
  assert.deepEqual(teile.map((x) => [x.felder.pfad, x.felder.nach]), K9.map((w, i) => [`erz/2/bk/${i + 1}`, w]));
  assert.deepEqual(k.bk.aufrufe.map(({ kanal, name, quelle }) => ({ kanal, name, quelle })), [{ kanal: 'erz/2', name: 'juno-pad-dyn', quelle: 'andreas' }]);
  assert.ok(teile.every((x) => x.id <= k.bk.aufrufe[0].nach_id), 'all knob parts left before the graph call');
  assert.deepEqual(r.j.kern.baukasten[0], { kanal: 'erz/2', graph: 'juno-pad-dyn', ok: true, regler_gesendet: 8 });
});

test('S17 T3.10 negative control: a project without a snapshot sends nothing; channels not in the project are untouched', async (t) => {
  const a = aufbau(t, null);
  a.k.bk.geladen['deck/1'] = 'fx-bandecho';
  const r = await a.s.oeffnen(a.slug, 'andreas');
  assert.equal(r.code, 200);
  assert.equal(a.k.teile(BK_KANAL_ZEILEN).length, 0); assert.equal(a.k.bk.aufrufe.length, 0);
  assert.equal('baukasten' in r.j.kern, false);
  // a snapshot with erz2 only: deck/1 stays, no call for it
  const b = aufbau(t, [eintrag('erz2', 'juno-pad-dyn')]);
  b.k.bk.geladen['deck/1'] = 'fx-bandecho';
  await b.s.oeffnen(b.slug, 'andreas');
  assert.deepEqual(b.k.bk.aufrufe.map((x) => x.kanal), ['erz/2']);
  assert.equal(b.k.bk.geladen['deck/1'], 'fx-bandecho');
  assert.equal(bkTeile(b.k, 'deck/1').length, 0);
});

test('S17 T3.11 fx/3 entry: the graph is loaded, but no fx/3/bk/* part is sent (the kern has no such controls)', async (t) => {
  const { s, k, slug } = aufbau(t, [eintrag('fx3', 'fx-bandecho')]);
  const r = await s.oeffnen(slug, 'andreas');
  assert.deepEqual(k.bk.aufrufe.map((x) => x.kanal), ['fx/3']);
  assert.equal(k.teile(/^fx\/3\/bk\//).length, 0);
  assert.equal(r.j.kern.baukasten[0].regler_gesendet, 0);
});

test('S17 T3.12 erz/5 entry: the kern refuses the graph channel, the knobs are sent, opening answers 200 and the file is unchanged', async (t) => {
  const { s, k, slug, wurzel } = aufbau(t, [eintrag('erz5', 'inst')]);
  k.bk.antwort = () => ({ code: 400, j: { fehler: 'ausserhalb_bereich' } });
  const datei = path.join(wurzel, slug, 'project.json');
  const vor = JSON.parse(fs.readFileSync(datei, 'utf8'));
  const r = await s.oeffnen(slug, 'andreas');
  assert.equal(r.code, 200);
  assert.equal(r.j.kern.baukasten[0].ok, false); assert.equal(r.j.kern.baukasten[0].grund, 'ausserhalb_bereich');
  assert.equal(bkTeile(k, 'erz/5').length, 8);
  await s.schliesse();
  // opening itself writes wiedergabe_rev (measured without any snapshot); the failed entry changes nothing else
  const nach = JSON.parse(fs.readFileSync(datei, 'utf8'));
  assert.deepEqual(nach.baukasten, vor.baukasten); assert.equal(nach.rev, vor.rev);
});

test('S17 T3.13 Cypher and AUTO off: skipped; positive control AUTO on restores', async (t) => {
  const a = aufbau(t, [eintrag('erz2', 'juno-pad-dyn')]);
  a.k.bk.auto['erz/2'] = true;
  const r = await a.s.oeffnen(a.slug, 'cypher');
  assert.equal(r.code, 200);
  assert.equal(bkTeile(a.k, 'erz/2').length, 0); assert.equal(a.k.bk.aufrufe.length, 0);
  assert.deepEqual([r.j.kern.baukasten[0].ok, r.j.kern.baukasten[0].grund], [false, 'auto_aus']);
  const b = aufbau(t, [eintrag('erz2', 'juno-pad-dyn')]);
  const r2 = await b.s.oeffnen(b.slug, 'cypher');
  assert.equal(r2.j.kern.baukasten[0].ok, true);
  assert.equal(b.k.bk.aufrufe[0].quelle, 'cypher');
  // Andreas is never held back by AUTO
  const c = aufbau(t, [eintrag('erz2', 'juno-pad-dyn')]);
  c.k.bk.auto['erz/2'] = true;
  assert.equal((await c.s.oeffnen(c.slug, 'andreas')).j.kern.baukasten[0].ok, true);
});

test('S17 T3.14 graph file missing or changed gives a hint', async (t) => {
  const a = aufbau(t, [eintrag('erz2', 'juno-pad-dyn')], { hash: {} });   // the file is gone
  const r = await a.s.oeffnen(a.slug, 'andreas');
  assert.equal(r.j.kern.baukasten[0].hinweis, 'bk_graph_fehlt'); assert.equal(r.j.kern.baukasten[0].ok, false);
  assert.equal(a.k.bk.aufrufe.length, 0); assert.equal(bkTeile(a.k, 'erz/2').length, 0, 'no knobs without the graph');
  const b = aufbau(t, [eintrag('erz2', 'juno-pad-dyn')], { hash: { 'juno-pad-dyn': 'c'.repeat(64) } });
  const r2 = await b.s.oeffnen(b.slug, 'andreas');
  assert.equal(r2.j.kern.baukasten[0].hinweis, 'bk_graph_geaendert'); assert.equal(r2.j.kern.baukasten[0].ok, true);
  assert.equal(b.k.bk.aufrufe.length, 1, 'loaded anyway');
  // an entry without a stored hash never reports a change
  const c = aufbau(t, [{ id: 'erz2', graph: 'juno-pad-dyn', regler: acht(0.5) }], { hash: { 'juno-pad-dyn': 'd'.repeat(64) } });
  assert.equal((await c.s.oeffnen(c.slug, 'andreas')).j.kern.baukasten[0].hinweis, undefined);
});

test('S17 T3.15 a graph that is already loaded is not sent again on open (knobs still go out); bkLaden always sends', async (t) => {
  const { s, k, slug } = aufbau(t, [eintrag('erz2', 'juno-pad-dyn')]);
  k.bk.geladen['erz/2'] = 'juno-pad-dyn';
  const r = await s.oeffnen(slug, 'andreas');
  assert.equal(k.bk.aufrufe.length, 0);
  assert.equal(bkTeile(k, 'erz/2').length, 8);
  assert.deepEqual([r.j.kern.baukasten[0].graph, r.j.kern.baukasten[0].schon_geladen, r.j.kern.baukasten[0].ok], ['juno-pad-dyn', true, true]);
  const l = await s.bkLaden({}, 'andreas');
  assert.equal(l.code, 200);
  assert.equal(k.bk.aufrufe.length, 1, 'an explicit load always sends');
  assert.equal(l.j.baukasten[0].graph, 'juno-pad-dyn');
  const nur = await s.bkLaden({ kanaele: ['deck/1'] }, 'andreas');
  assert.deepEqual(nur.j.baukasten, [], 'a channel without an entry is not touched');
});

test('S17 T3.16 a slow graph: open returns within the cap and reports bk_frist', async (t) => {
  const { s, k, slug } = aufbau(t, [eintrag('erz2', 'juno-pad-dyn')], { opt: { bkFristMs: 50 } });
  k.bk.antwort = () => new Promise(() => {});   // never answers
  const t0 = Date.now();
  const r = await s.oeffnen(slug, 'andreas');
  assert.ok(Date.now() - t0 < 1000, `returned after ${Date.now() - t0} ms`);
  assert.equal(r.code, 200);
  assert.deepEqual([r.j.kern.baukasten[0].ok, r.j.kern.baukasten[0].grund], [false, 'bk_frist']);
  assert.match(r.j.kern.baukasten[0].text, /time limit/, 'every reason carries its English text');
});

test('S17 T3.17 a restart of the page server in front of a running kern (wiederanlauf) sends nothing', async (t) => {
  const k = pruefKontext({ baukasten: true });
  const e = sitzung(t, {}, k);
  const pr = new Projekte(e.wurzel);
  const { slug, projekt } = pr.lege('Wa');
  projekt.wiedergabe_rev = 7; projekt.baukasten = [eintrag('erz2', 'juno-pad-dyn')];
  pr.speichere(slug, projekt);
  fs.mkdirSync(e.arr, { recursive: true }); fs.writeFileSync(path.join(e.arr, 'wiedergabe-7.json'), '{}');
  const z = sitzung(t, { wurzel: e.wurzel, arbeitsordner: e.arr, arrFristMs: 30 }, k);
  k.bk.hash['juno-pad-dyn'] = HASH;
  z.s.ereignis('/zustand/arr', arrNr(7));
  const r = await z.s.oeffnen(slug, 'andreas');
  assert.equal(r.j.kern.wiederanlauf, true);
  assert.equal(k.teile(BK_KANAL_ZEILEN).length, 0); assert.equal(k.bk.aufrufe.length, 0);
  assert.equal(r.j.kern.baukasten.uebersprungen, 'wiederanlauf');
  z.s.schliesse();   // releases the project lock
  // negative control: another playback number is a real open
  const k2 = pruefKontext({ baukasten: true }); k2.bk.hash['juno-pad-dyn'] = HASH;
  const y = sitzung(t, { wurzel: e.wurzel, arbeitsordner: e.arr, arrFristMs: 30 }, k2);
  y.s.ereignis('/zustand/arr', arrNr(8));
  const r2 = await y.s.oeffnen(slug, 'andreas');
  assert.equal(r2.j.kern.baukasten[0].ok, true);
});
