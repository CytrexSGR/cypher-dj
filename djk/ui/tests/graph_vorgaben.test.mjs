// Graph defaults on every load path (plan 2026-11-11-synth-ausbau, task 8). A knob a graph defines starts at the graph's `vorgabe` (0.5 without one), whichever way
// the graph arrives: project open (fill), preset apply (absent knobs), POST /graph (a batch of rows BEFORE the load message, only for a changed name), the
// project restore (saved rows first, no push after the load), Cypher's hand load. 54 shipped graphs plus a fixture graph with `vorgabe` values.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';
import { vorgabenVon, reglerVonGraph, listeGraphen } from '../graphs.ts';
import { bkReglerAuffuellen, bkReglerKanonisch, BK_REGLER_ZAHL } from '../project/modular.ts';
import { planeAnwendung } from '../presets/apply.ts';
import { vorgaben as panelVorgaben } from '../public/panel.js';

belegeTestInstanz();
const HIER = path.dirname(fileURLToPath(import.meta.url));
const BK = path.resolve(HIER, '..', '..', 'instruments', 'modular_dsp');
const WERK = path.resolve(HIER, '..', 'presets', 'werk', 'baukasten');
const KATEGORIEN = JSON.parse(fs.readFileSync(path.join(BK, 'kategorien.json'), 'utf8'));
const NAMEN = Object.keys(KATEGORIEN);
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 3000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };

// ---- the graph folder of this file: the 54 shipped graphs and fixtures ----
const FIX_INST = { format: 'baukasten/2', name: 'fix-inst', stimmen: 1, regler_namen: { 1: 'A', 2: 'B', 40: 'C', 64: 'D' },
  knoten: [{ id: 'n', art: 'note' }, { id: 'o', art: 'ausgang' },
    { id: 'k1', art: 'regler', nr: 1, min: 0, max: 1, vorgabe: 0.2 }, { id: 'k2', art: 'regler', nr: 2, min: 0, max: 1 },
    { id: 'k40', art: 'regler', nr: 40, min: 0, max: 1, vorgabe: 0.9 }, { id: 'k64', art: 'regler', nr: 64, min: 0, max: 1, vorgabe: 0 },
    { id: 'k1b', art: 'regler', nr: 1, min: 0, max: 1, vorgabe: 0.7 }], kanten: [] };   // the second node of knob 1 does not count
const FIX_INST2 = { ...FIX_INST, name: 'fix-inst2', regler_namen: { 3: 'E' }, knoten: [{ id: 'n', art: 'note' }, { id: 'o', art: 'ausgang' }, { id: 'k3', art: 'regler', nr: 3, min: 0, max: 1, vorgabe: 0.6 }] };
const FIX_EFF = { format: 'baukasten/2', name: 'fix-eff', stimmen: 1, regler_namen: { 1: 'A' }, knoten: [{ id: 'e', art: 'eingang' }, { id: 'o', art: 'ausgang' }, { id: 'k1', art: 'regler', nr: 1, min: 0, max: 1, vorgabe: 0.35 }], kanten: [] };
const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'bkvg-'));
for (const n of NAMEN) fs.copyFileSync(path.join(BK, 'demos', `${n}.json`), path.join(ORDNER, `${n}.json`));
for (const g of [FIX_INST, FIX_INST2, FIX_EFF]) fs.writeFileSync(path.join(ORDNER, `${g.name}.json`), JSON.stringify(g));
fs.mkdirSync(path.join(ORDNER, 'samples'), { recursive: true });
process.env.CYPHERDJ_BK_ORDNER = ORDNER;   // vorgabenVon, findeGraph and the preset plan read this folder
process.on('exit', () => { try { fs.rmSync(ORDNER, { recursive: true, force: true }); } catch { /* gone */ } });
// an instrument with all 64 knobs, for the batch time on the stub
const FIX_64 = { format: 'baukasten/2', name: 'fix-64', stimmen: 1, regler_namen: {}, knoten: [{ id: 'n', art: 'note' }, { id: 'o', art: 'ausgang' },
  ...Array.from({ length: 64 }, (_, i) => ({ id: `k${i + 1}`, art: 'regler', nr: i + 1, min: 0, max: 1, vorgabe: (i % 8) / 8 }))], kanten: [] };
fs.writeFileSync(path.join(ORDNER, 'fix-64.json'), JSON.stringify(FIX_64));
const ALLE = [...NAMEN, 'fix-inst', 'fix-inst2', 'fix-eff', 'fix-64'];

/** The expected rows, computed from the JSON itself (not through the code under test): first node of a number wins, `vorgabe` or 0.5. */
function erwartet(name) {
  const g = JSON.parse(fs.readFileSync(path.join(ORDNER, `${name}.json`), 'utf8'));
  const aus = {};
  for (const k of g.knoten) if (k.art === 'regler' && Number.isInteger(k.nr) && k.nr >= 1 && k.nr <= 64 && !(k.nr in aus)) aus[k.nr] = typeof k.vorgabe === 'number' ? k.vorgabe : 0.5;
  return aus;
}
const art = (name) => (JSON.parse(fs.readFileSync(path.join(ORDNER, `${name}.json`), 'utf8')).knoten.some((k) => k.art === 'eingang') ? 'effekt' : 'instrument');

test('the walk covers 54 shipped graphs and the three fixtures', () => {
  assert.equal(NAMEN.length, 54);
  assert.equal(BK_REGLER_ZAHL, 64);
  assert.equal(listeGraphen(ORDNER).graphen.length, 58);
});

// ---- (h) Drift ----
test('Drift: vorgabenVon gives 0.25 for synth-poly knob 28 and synth-mono knob 32, and the walk includes them', () => {
  assert.equal(vorgabenVon('synth-poly')[27], 0.25);
  assert.equal(vorgabenVon('synth-mono')[31], 0.25);
  assert.equal(erwartet('synth-poly')[28], 0.25); assert.equal(erwartet('synth-mono')[32], 0.25);
  assert.ok(NAMEN.includes('synth-poly') && NAMEN.includes('synth-mono'));
  // the knobs that start away from 0.5: Drift, plus (synth-poly build-out) the free parameters and gates at their off positions: Mod env A, D, R (31, 32, 34),
  // LFO 2 rate, shape, sync, target (39..42), Osc 2 level, wave, sync (46, 47, 51) and Glide (54);
  // synth-mono build-out: Mod env A, D, R (36, 37, 39), LFO 2 (43..46), chorus, delay and reverb (53..57, 59) and ping-pong (60)
  const abweichend = { 'synth-poly': [28, 31, 32, 34, 39, 40, 41, 42, 46, 47, 51, 54], 'synth-mono': [32, 36, 37, 39, 43, 44, 45, 46, 53, 54, 55, 56, 57, 59, 60] };
  for (const n of ['synth-poly', 'synth-mono']) {
    const andere = Object.entries(erwartet(n)).filter(([nr, v]) => v !== 0.5).map(([nr]) => Number(nr));
    assert.deepEqual(andere, abweichend[n], `${n}: the knobs that start away from 0.5`);
  }
});

test('vorgabenVon: unknown graph and bad names give null; the first node of a number wins', () => {
  assert.equal(vorgabenVon('gibt-es-nicht'), null);
  assert.equal(vorgabenVon('../x'), null);
  const v = vorgabenVon('fix-inst');
  assert.equal(v.length, 64);
  assert.deepEqual([v[0], v[1], v[39], v[63], v[2]], [0.2, 0.5, 0.9, 0, 0.5]);
});

// ---- (a) project open: fill and trim against the graph ----
test('(a) project fill: an empty and an 8-number regler array come out as the graph vorgabe on every graph', () => {
  for (const n of ALLE) {
    const v = vorgabenVon(n);
    const e = erwartet(n);
    for (let i = 0; i < 64; i++) assert.equal(v[i], e[i + 1] ?? 0.5, `${n} knob ${i + 1}`);
    assert.deepEqual(bkReglerAuffuellen([], v), v, `${n}: empty`);
    const acht = bkReglerAuffuellen(Array(8).fill(0.5), v);
    assert.deepEqual(acht.slice(0, 8), Array(8).fill(0.5), `${n}: the stored eight stay as stored`);
    assert.deepEqual(acht.slice(8), v.slice(8), `${n}: 9..64 from the graph`);
    // canonical writing trims against the graph's own value, never against 0.5 (a stored 0.5 on a vorgabe-0 knob must survive)
    const voll = bkReglerKanonisch(bkReglerAuffuellen([], v), v);
    assert.equal(voll.length, 8, `${n}: untouched writes as 8`);
    const beruehrt = v.slice(); beruehrt[63] = beruehrt[63] === 0.5 ? 0.4 : 0.5;
    assert.equal(bkReglerKanonisch(beruehrt, v).length, 64, `${n}: a knob 64 away from its vorgabe is written`);
  }
  const v = vorgabenVon('fix-inst'); const r = v.slice(); r[39] = 0.5;   // a stored 0.5 on a knob whose vorgabe is 0.9
  assert.equal(bkReglerKanonisch(r, v)[39], 0.5);
  assert.equal(bkReglerKanonisch(r, v).length, 40, 'trimmed after the last knob that differs from its vorgabe');
});

// ---- (b), (f) preset apply ----
test('(b) preset apply with empty werte writes the graph vorgabe on every graph (all 64 rows, knob order)', () => {
  for (const n of ALLE) {
    const plan = planeAnwendung({ id: 'x', name: 'x', geraet: 'baukasten', graph: n, werte: {} }, { art: 'kanal', kanal: 'erz/6' }, null, n);
    assert.equal(plan.weg, 'regler');
    assert.deepEqual(plan.anfragen.map((a) => a.pfad), Array.from({ length: 64 }, (_, i) => `erz/6/bk/${i + 1}`), n);
    const e = erwartet(n);
    assert.deepEqual(plan.anfragen.map((a) => a.nach), Array.from({ length: 64 }, (_, i) => e[i + 1] ?? 0.5), n);
  }
  // a knob the preset carries wins over the graph
  const p = planeAnwendung({ id: 'x', name: 'x', geraet: 'baukasten', graph: 'fix-inst', werte: { knob40: 0.1 } }, { art: 'kanal', kanal: 'erz/6' }, null, 'fix-inst');
  assert.deepEqual([p.anfragen[39].nach, p.anfragen[0].nach], [0.1, 0.2]);
  // unknown graph file: 0.5
  const u = planeAnwendung({ id: 'x', name: 'x', geraet: 'baukasten', graph: 'gibt-es-nicht', werte: {} }, { art: 'kanal', kanal: 'erz/6' }, null, 'gibt-es-nicht');
  assert.ok(u.anfragen.every((a) => a.nach === 0.5));
});

test('(f) load a graph, then apply each factory preset: all 64 rows, the preset values where it has them, the graph vorgabe elsewhere', () => {
  const dateien = fs.readdirSync(WERK).filter((f) => f.endsWith('.preset.json'));
  assert.ok(dateien.length >= 30, `factory presets found (${dateien.length})`);
  let geprueft = 0;
  for (const f of dateien) {
    const pre = JSON.parse(fs.readFileSync(path.join(WERK, f), 'utf8'));
    if (pre.geraet !== 'baukasten' || !pre.graph || !ALLE.includes(pre.graph)) continue;
    const plan = planeAnwendung(pre, { art: 'kanal', kanal: 'erz/6' }, null, pre.graph);
    assert.equal(plan.anfragen.length, 64, f);
    const e = erwartet(pre.graph);
    plan.anfragen.forEach((a, i) => {
      const w = pre.werte[`knob${i + 1}`];
      assert.equal(a.nach, typeof w === 'number' ? w : (e[i + 1] ?? 0.5), `${f} knob ${i + 1}`);
    });
    geprueft++;
  }
  assert.ok(geprueft >= 30, `presets checked: ${geprueft}`);
});

// ---- insert graphs carry no vorgabe ----
test('no graph usable as an insert stage (every graph with an eingang node among the shipped examples) carries a vorgabe', () => {
  // kategorien.json lists the 53 instruments only; the insert-capable graphs are the ones with an `eingang` node
  const dateien = fs.readdirSync(path.join(BK, 'demos')).filter((f) => f.endsWith('.json'));
  const effekte = dateien.filter((f) => JSON.parse(fs.readFileSync(path.join(BK, 'demos', f), 'utf8')).knoten?.some((k) => k.art === 'eingang'));
  assert.ok(effekte.length >= 10, `effect graphs found: ${effekte.length}`);
  for (const f of effekte) {
    const roh = JSON.parse(fs.readFileSync(path.join(BK, 'demos', f), 'utf8'));
    const mit = roh.knoten.filter((k) => k.art === 'regler' && 'vorgabe' in k).map((k) => k.id);
    assert.deepEqual(mit, [], `${f}: stage values keep the 0.5 fill`);
    assert.ok(vorgabenVon(f.replace(/\.json$/, ''), path.join(BK, 'demos')).every((v) => v === 0.5), f);
  }
  // none of the 53 instruments is insert-capable (the two sets do not mix)
  assert.ok(NAMEN.every((n) => art(n) === 'instrument'));
  // positive control: the fixture effect with a vorgabe would be caught by the same check
  assert.ok(FIX_EFF.knoten.some((k) => k.art === 'regler' && 'vorgabe' in k));
});

// ---- panel defaults ----
// Panels that push a default other than 0.5 on a knob whose graph keeps 0.5: the page pushes it on load; the graph keeps 0.5 so old projects and playbacks do not change.
// Written once from the first run (9 pairs on 3 panels), plus fx-crunch and fx-polaritaet (2 pairs).
const PANEL_ERLAUBT = [
  ['fx-filter-regler', 1], ['fx-filter-regler', 2],
  ['fx-filterbox', 1], ['fx-filterbox', 2], ['fx-filterbox', 3], ['fx-filterbox', 5], ['fx-filterbox', 7], ['fx-filterbox', 8],
  ['granular-drone', 4],
  ['fx-crunch', 8], ['fx-polaritaet', 1],   // Mix 100 % on load; the polarity selector's Off stop (index 2 of 4 = 2/3) while the 0.5 fill is Off too (zone 2)
  // fx-labor: the switches Delay 1, Delay 2 and Cycle start on and the filter selectors start on LP; the 0.5 fill reads the same (on, on, on, LP, LP)
  ['fx-labor', 3], ['fx-labor', 7], ['fx-labor', 15], ['fx-labor', 19], ['fx-labor', 25],
];
// where the plan's own knobs start: from this number on (and the Drift knob) the panel default must EQUAL the graph's vorgabe
const ERWEITERT = { 'synth-mono': { ab: 33, extra: [32] }, 'synth-poly': { ab: 29, extra: [28] }, 'synth-neuro': { ab: 25, extra: [] } };

test('panel defaults: every shipped panel control bound to a knob equals the graph vorgabe, except the 16 listed pairs of knobs that keep 0.5', () => {
  assert.equal(PANEL_ERLAUBT.length, 16);
  const benutzt = new Set();
  let geprueft = 0;
  for (const f of fs.readdirSync(path.join(BK, 'paneele')).filter((x) => x.endsWith('.json'))) {
    const graph = f.replace(/\.json$/, '');
    const panel = JSON.parse(fs.readFileSync(path.join(BK, 'paneele', f), 'utf8'));
    const v = vorgabenVon(graph, path.join(BK, 'demos'));
    if (v === null) continue;   // rb338 and surge: fixed parameter tables, no graph file
    const soll = reglerVonGraph(graph, path.join(BK, 'demos'));
    for (const [param, wert] of Object.entries(panelVorgaben(panel))) {
      const m = /^k(\d+)$/.exec(param);
      if (!m || !(m[1] in soll)) continue;   // not a knob the graph defines
      const nr = Number(m[1]), graphWert = v[nr - 1];
      geprueft++;
      const erw = ERWEITERT[graph];
      const planKnopf = erw && (nr >= erw.ab || erw.extra.includes(nr));
      if (Math.abs(wert - graphWert) <= 1e-6) continue;
      const i = PANEL_ERLAUBT.findIndex(([p, k]) => p === graph && k === nr);
      assert.ok(i >= 0 && !planKnopf && graphWert === 0.5, `${graph} k${nr}: panel default ${wert} but graph vorgabe ${graphWert}${planKnopf ? ' (a knob of this plan: must be equal)' : ''}`);
      benutzt.add(i);
    }
  }
  assert.ok(geprueft > 100, `controls compared: ${geprueft}`);
  assert.equal(benutzt.size, PANEL_ERLAUBT.length, 'every allow-list pair is still needed');
  // Drift: the panel and the graph agree
  const poly = JSON.parse(fs.readFileSync(path.join(BK, 'paneele', 'synth-poly.json'), 'utf8'));
  assert.equal(panelVorgaben(poly).k28, 0.25);
  const mono = JSON.parse(fs.readFileSync(path.join(BK, 'paneele', 'synth-mono.json'), 'utf8'));
  assert.equal(panelVorgaben(mono).k32, 0.25);
});

// ---- (c) (d) (e) (g): the server ----
async function stapel(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const huellen = path.join(tmp('bkvg-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = process.env.CYPHERDJ_INSTANZ;
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const o = new Oberflaeche({ port: 47360 + K, kernPort: 47160 + K, aboPort: 47210 + K, leitstandWs: 47260 + K, bestand: tmp('bkvg-bestand-'), arbeitsbestand: tmp('bkvg-ab-'),
    mutationen: [], loops: tmp('bkvg-loops-'), kits: tmp('bkvg-kits-'), welleCache: tmp('bkvg-welle-'), musterOrdner: tmp('bkvg-muster-'), hotcueOrdner: tmp('bkvg-hc-'),
    rasterOrdner: tmp('bkvg-raster-'), huellen, wirtOrdner: tmp('bkvg-wirt-'), sammlungen: tmp('bkvg-sets-'), musterBibliothek: tmp('bkvg-mb-'), musterSets: tmp('bkvg-ms-'),
    mediathek: path.join(tmp('bkvg-med-'), 'nix.sqlite'), katalog: path.join(tmp('bkvg-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('bkvg-do-'), 'nix'),
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('bkvg-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('bkvg-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => {
      if (z.typ === 'an_kern') z = { ...z, t: performance.now() };
      log.push(z);
      // the stub core: every /k/teil row is acknowledged 20 ms later (status 1, then the end status 3)
      if (z.typ === 'an_kern' && z.adresse === '/k/teil') setTimeout(() => {
        for (const status of [1, 3]) o.vomKern({ adresse: '/q', felder: { id: z.felder.id, quelle: z.felder.quelle, status, ist_sample: 0, ist_beat: 0, grund: '' } });
        antworten.push({ id: z.felder.id, t: performance.now() });
      }, 20);
    } });
  const antworten = [];
  Object.defineProperty(o.kern, 'zustand', { get: () => 'verbunden', configurable: true });   // the push needs a kern; the stub answers for it
  await o.starte();
  t.after(async () => { await o.stoppe(); if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt; });
  const url = `http://127.0.0.1:${47360 + K}`;
  const post = (daten, kopf = {}) => hol(`${url}/graph`, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
  const LADEN = new Set(['/erz/strom', '/k/kanal/graph']);
  const meldungen = () => log.filter((z) => z.typ === 'an_kern' && (z.adresse === '/k/teil' || LADEN.has(z.adresse)));
  /** POST and answer the load message (status 1, then `status`; null = no answer). Returns the messages sent for this call in order. */
  async function lade(daten, status = 3, kopf = {}) {
    const n0 = meldungen().length;
    const p = post(daten, kopf);
    if (status !== null) {
      assert.ok(await bis(() => meldungen().slice(n0).some((z) => LADEN.has(z.adresse))), 'the load message reaches the kern');
      const s = meldungen().slice(n0).find((z) => LADEN.has(z.adresse));
      o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 1, ist_sample: 0, ist_beat: 0, grund: '' } });
      o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status, ist_sample: 0, ist_beat: 0, grund: '' } });
    }
    const r = await p;
    return { ...r, gesendet: meldungen().slice(n0) };
  }
  const reglerSetzen = (pfad, wert) => o.vomKern({ adresse: '/e/regler', felder: { pfad, wert } });
  return { o, url, log, post, lade, meldungen, reglerSetzen, antworten };
}
const zeilen = (gesendet) => Object.fromEntries(gesendet.filter((z) => z.adresse === '/k/teil').map((z) => [z.felder.pfad, z.felder.nach]));
const ladeIndex = (gesendet) => gesendet.findIndex((z) => LADEN_ADR.has(z.adresse));
const LADEN_ADR = new Set(['/erz/strom', '/k/kanal/graph']);

test('(c) POST /graph on the 53 graphs and the fixtures: one batch of /k/teil with the graph vorgabe for every knob the graph defines, all before the load message', async (t) => {
  const { lade } = await stapel(t);
  let letzteArt = { instrument: null, effekt: null };
  for (const n of ALLE) {
    const a = art(n);
    const kanal = a === 'instrument' ? 'erz/3' : 'deck/1';
    const r = await lade({ kanal, name: n });
    assert.equal(r.code, 200, `${n}: ${JSON.stringify(r.j)}`);
    const i = ladeIndex(r.gesendet);
    assert.ok(i >= 0, `${n}: load message sent`);
    assert.ok(r.gesendet.slice(i + 1).every((z) => z.adresse !== '/k/teil'), `${n}: no row after the load message (accepted load)`);
    const teile = r.gesendet.slice(0, i);
    assert.ok(teile.every((z) => z.adresse === '/k/teil'));
    const e = erwartet(n);
    const soll = Object.fromEntries(Object.entries(e).map(([nr, v]) => [`${kanal}/bk/${nr}`, v]));
    assert.deepEqual(zeilen(teile), soll, `${n}: rows = the graph's vorgabe for the knobs it defines`);
    assert.equal(teile.length, Object.keys(e).length, `${n}: one row per knob, once`);
    assert.ok(teile.every((z) => z.felder.dauer_beats === 0 && z.felder.politik === 1), `${n}: set at once, late means now`);
    letzteArt[a] = n;
  }
  assert.ok(letzteArt.instrument && letzteArt.effekt);
});

test('(c) the push happens only when the graph name changes: the same graph again, an unload and a refused name push nothing', async (t) => {
  const { lade, post, meldungen } = await stapel(t);
  const a = await lade({ kanal: 'erz/3', name: 'fix-inst' });
  assert.equal(Object.keys(zeilen(a.gesendet)).length, 4);
  const b = await lade({ kanal: 'erz/3', name: 'fix-inst' });   // Cypher reloading the same graph
  assert.equal(b.code, 200); assert.equal(b.gesendet.filter((z) => z.adresse === '/k/teil').length, 0, 'same name: no row');
  assert.equal(b.gesendet.filter((z) => LADEN_ADR.has(z.adresse)).length, 1, 'the load itself still goes out');
  const c = await lade({ kanal: 'erz/3', name: '' });
  assert.equal(c.gesendet.filter((z) => z.adresse === '/k/teil').length, 0, 'an unload pushes nothing');
  const d = await lade({ kanal: 'erz/3', name: 'fix-inst' });   // after an unload the name differs from the (empty) loaded one: pushes again
  assert.equal(d.gesendet.filter((z) => z.adresse === '/k/teil').length, 4);
  const n0 = meldungen().length;
  for (const bad of [{ kanal: 'erz/3', name: 'nix-da' }, { kanal: 'erz/3', name: 'Gross' }, { kanal: 'erz/4', name: 'fix-inst' }, { kanal: 'erz/1', name: 'fix-inst' }, { kanal: 'deck/1', name: 'fix-inst' }]) {
    const r = await post(bad);
    assert.ok(r.code >= 400, JSON.stringify(bad));
  }
  assert.equal(meldungen().length, n0, 'a refused request sends nothing: the pre-checks run before the push');
});

test('(c) vorgaben must be a boolean when given', async (t) => {
  const { post, meldungen } = await stapel(t);
  const r = await post({ kanal: 'erz/3', name: 'fix-inst', vorgaben: 'nein' });
  assert.deepEqual([r.code, r.j.fehler], [400, 'vorgaben']);
  assert.equal(meldungen().length, 0);
});

test('(d) vorgaben:false skips the push (POST /graph and the bridge of the project restore); the bridge without the option pushes', async (t) => {
  const { o, lade, meldungen } = await stapel(t);
  const a = await lade({ kanal: 'erz/3', name: 'fix-inst', vorgaben: false });
  assert.equal(a.code, 200);
  assert.equal(a.gesendet.filter((z) => z.adresse === '/k/teil').length, 0, 'POST with vorgaben false: only the load message');
  assert.equal(a.gesendet.length, 1);
  // the bridge, as the project restore calls it: same graph name differs from the loaded one (fix-inst2), still no push
  const bruecke = o.bereichKontext().baukasten;
  const antwort = async (aufruf) => {
    const n0 = meldungen().length;
    const p = aufruf();
    assert.ok(await bis(() => meldungen().slice(n0).some((z) => LADEN_ADR.has(z.adresse))));
    const s = meldungen().slice(n0).find((z) => LADEN_ADR.has(z.adresse));
    o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 3, ist_sample: 0, ist_beat: 0, grund: '' } });
    await p;
    return meldungen().slice(n0);
  };
  const ohne = await antwort(() => bruecke.setzeGraph('erz/3', 'fix-inst2', 'andreas', { vorgaben: false }));
  assert.deepEqual(ohne.map((z) => z.adresse), ['/erz/strom'], 'restore path: the load message and nothing else, the saved rows stay');
  const mit = await antwort(() => bruecke.setzeGraph('erz/3', 'fix-inst', 'andreas'));
  assert.equal(mit.filter((z) => z.adresse === '/k/teil').length, 4, 'without the option the bridge pushes like POST /graph');
  assert.equal(mit.at(-1).adresse, '/erz/strom');
});

test('(e) Cypher: a hand load of a different graph pushes, reloading the same graph pushes nothing and leaves a changed knob where it was', async (t) => {
  const { lade, reglerSetzen, o } = await stapel(t);
  const CYPHER = { 'x-djk-quelle': 'cypher' };
  const a = await lade({ kanal: 'deck/1', name: 'fix-eff' }, 3, CYPHER);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(zeilen(a.gesendet), { 'deck/1/bk/1': 0.35 });
  assert.ok(a.gesendet.filter((z) => z.adresse === '/k/teil').every((z) => z.felder.quelle === 'cypher' && z.felder.plan === 'cypher'), 'the rows carry the source of the call');
  reglerSetzen('deck/1/bk/1', 0.8);   // Andreas (or Cypher) moved the knob; the kern reports it
  const b = await lade({ kanal: 'deck/1', name: 'fix-eff' }, 3, CYPHER);
  assert.equal(b.gesendet.filter((z) => z.adresse === '/k/teil').length, 0, 'same graph again: the knob stays at 0.8');
  assert.equal(o.stand.regler['deck/1/bk/1'], 0.8);
});

test('(g) a load refused with status 6 sends the previous row values back; the pushed rows stay for an accepted load', async (t) => {
  const { lade, reglerSetzen } = await stapel(t);
  await lade({ kanal: 'erz/3', name: 'fix-inst' });                    // loaded: rows at the vorgabe
  reglerSetzen('erz/3/bk/3', 0.77);                                    // the running graph has its own value on knob 3
  const r = await lade({ kanal: 'erz/3', name: 'fix-inst2' }, 6);     // fix-inst2 defines knob 3 at 0.6; the kern refuses the load
  assert.equal(r.code, 200);
  const i = ladeIndex(r.gesendet);
  const davor = r.gesendet.slice(0, i), danach = r.gesendet.slice(i + 1);
  assert.deepEqual(zeilen(davor), { 'erz/3/bk/3': 0.6 });
  assert.deepEqual(zeilen(danach), { 'erz/3/bk/3': 0.77 }, 'rollback: the value before the push goes back');
  // positive control: an accepted load sends nothing after the load message
  const ok = await lade({ kanal: 'erz/3', name: 'fix-inst2' }, 3);
  assert.equal(ok.gesendet.slice(ladeIndex(ok.gesendet) + 1).length, 0);
});

test('(g) a refused load whose knob the page never heard of rolls back to the kern table default 0.5; status 2, 3 and 5 are positive answers', async (t) => {
  const { lade } = await stapel(t);
  const r = await lade({ kanal: 'deck/1', name: 'fix-eff' }, 6);
  assert.deepEqual(zeilen(r.gesendet.slice(ladeIndex(r.gesendet) + 1)), { 'deck/1/bk/1': 0.5 });
  for (const status of [2, 3, 5]) {
    const x = await lade({ kanal: 'deck/1', name: status === 2 ? 'fix-eff' : 'fix-eff' }, status);
    assert.equal(x.gesendet.slice(ladeIndex(x.gesendet) + 1).length, 0, `status ${status}: no rollback`);
    await lade({ kanal: 'deck/1', name: '' }, 3);   // unload so that the next round is a changed name again
  }
});

test('(g) a load without any answer keeps the pushed rows (no rollback); an unload pushes nothing', { timeout: 20000 }, async (t) => {
  const { lade } = await stapel(t);
  const r = await lade({ kanal: 'erz/3', name: 'fix-inst' }, null);   // the wait ends after 4 s without an answer
  assert.equal(r.code, 200); assert.equal(r.j.quittung, null);
  const i = ladeIndex(r.gesendet);
  assert.equal(r.gesendet.slice(0, i).length, 4, 'pushed');
  assert.equal(r.gesendet.slice(i + 1).length, 0, 'and kept: the load may still happen');
  const u = await lade({ kanal: 'erz/3', name: '' }, 3);
  assert.equal(u.gesendet.filter((z) => z.adresse === '/k/teil').length, 0);
});

test('(c) the load message leaves only after the end status of the LAST row; 64 rows on the stub, time noted', async (t) => {
  const { lade, antworten } = await stapel(t);
  const t0 = performance.now();
  const r = await lade({ kanal: 'erz/3', name: 'fix-64' });
  const dauer = performance.now() - t0;
  const i = ladeIndex(r.gesendet);
  const zeilenAus = r.gesendet.slice(0, i);
  assert.equal(zeilenAus.length, 64);
  assert.deepEqual(Object.values(zeilen(zeilenAus)).slice(0, 9), [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0], 'vorgabe per knob');
  const ids = new Set(zeilenAus.map((z) => z.felder.id));
  const spaetesteAntwort = Math.max(...antworten.filter((a) => ids.has(a.id)).map((a) => a.t));
  assert.equal(antworten.filter((a) => ids.has(a.id)).length, 64, 'every row was answered before the load went out');
  assert.ok(r.gesendet[i].t >= spaetesteAntwort, `load message at ${r.gesendet[i].t.toFixed(1)} ms, last row answered at ${spaetesteAntwort.toFixed(1)} ms`);
  console.log(`# 64 rows on the stub: POST /graph answered after ${dauer.toFixed(0)} ms (rows acknowledged 20 ms after sending; includes the 64 sends, the wait and the load)`);
  assert.ok(dauer < 2000, `batch of 64 rows took ${dauer} ms`);
});

test('(g) the rollback of a refused load is waited for as well (rows acknowledged before the call returns)', async (t) => {
  const { lade, reglerSetzen, antworten } = await stapel(t);
  await lade({ kanal: 'erz/3', name: 'fix-inst' });
  reglerSetzen('erz/3/bk/3', 0.77);
  const n0 = antworten.length;
  const r = await lade({ kanal: 'erz/3', name: 'fix-inst2' }, 6);
  const danach = r.gesendet.slice(ladeIndex(r.gesendet) + 1);
  assert.equal(danach.length, 1);
  assert.ok(antworten.length >= n0 + 2 && antworten.some((a) => a.id === danach[0].felder.id), 'the rollback row has its answer when POST /graph returns');
});
