// Package 1.16 rest U8 (K1, K2): the COLLECTIONS panel of the PRODUCTION browser and "Add to collection". Node only: pure functions, a stand-in
// root element, a stub ctx; the server side is the real kollektionen Bereich behind a real HTTP server (tests/support style), so the page talks to
// the routes of U4. The real drags are the browser probe check/probe_b116_browser.mjs (not part of this file).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { kollektionenBereich } from '../collections/area.ts';
import { ZIEH_TYP, GERAET_TYP } from '../public/production/drag.js';
import { PRESET_TYP } from '../public/production/preset_target.js';
import { katalog } from '../presets/area.ts';

const K = '../public/collections.js';
const SHA = 'a'.repeat(64), SHA2 = 'b'.repeat(64);
const KATALOG = katalog([{ name: 'juno-pad', art: 'instrument' }, { name: 'fx', art: 'effekt' }]);
const SAMPLE = { typ: 'oneshot', sha: SHA, name: 'Kick 1', pfad_da: true, dauer_s: 0.5 };

// a real server with the kollektionen Bereich (source andreas, the page sends no source header)
async function server(t) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'b116-kollseite-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const b = kollektionenBereich({ log: () => {}, quelle: () => 'andreas' }, { ordner });
  const [route] = b.routen();
  const srv = http.createServer((q, a) => route.handler(q, a, new URL(q.url, 'http://x')));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  t.after(() => srv.close());
  const basis = `http://127.0.0.1:${srv.address().port}`;
  const log = [];
  const holeGet = async (weg) => {
    log.push(['GET', weg]);
    if (weg === '/presets/katalog') return { status: 200, j: KATALOG };
    if (weg.startsWith('/stoebern/detail?sha=')) return weg.endsWith(SHA) ? { status: 200, j: { eintrag: SAMPLE } } : { status: 404, j: { fehler: 'unbekannt' } };
    if (weg === '/presets/werk/komp/drum-bus') return { status: 200, j: { herkunft: 'werk', geraet: 'komp', slug: 'drum-bus', name: 'Drum Bus' } };
    if (weg.startsWith('/presets/')) return { status: 404, j: { fehler: 'unbekannt' } };
    const r = await fetch(basis + weg); return { status: r.status, j: await r.json() };
  };
  const holeJson = async (weg, k) => {
    log.push(['POST', weg, k]);
    const r = await fetch(basis + weg, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(k ?? {}) });
    return { status: r.status, j: await r.json() };
  };
  return { ordner, log, holeGet, holeJson, speicher: b.speicher };
}
const wurzel = () => ({ innerHTML: '', h: {}, addEventListener(n, f) { (this.h[n] ??= []).push(f); }, feuer(n, e) { for (const f of this.h[n] ?? []) f(e); } });
const ruhe = () => new Promise((r) => setTimeout(r, 60));

// ---- T8.3 items from the three browser lists ----
test('T8.3 postenVon: a LIBRARY row, a preset row and a device row become the K1 items; what the server would refuse is no item', async () => {
  const { postenVonSample, postenVonPreset, postenVonGeraet } = await import(K);
  assert.deepEqual(postenVonSample(SAMPLE), { art: 'sample', sha: SHA });
  for (const x of [null, {}, { sha: 'xyz' }, { sha: SHA.toUpperCase() }]) assert.equal(postenVonSample(x), null, JSON.stringify(x));
  assert.deepEqual(postenVonPreset({ herkunft: 'werk', geraet: 'komp', slug: 'drum-bus', name: 'Drum Bus' }), { art: 'preset', id: 'werk:komp/drum-bus' });
  assert.equal(postenVonPreset({ herkunft: 'nutzer', geraet: 'komp', slug: 'x', fehler: 'json_kaputt' }), null, 'a damaged preset file is no item');
  const e = (g) => [...KATALOG.instrumente, ...KATALOG.effekte].find((x) => x.geraet === g);
  assert.deepEqual(postenVonGeraet(e('rb338')), { art: 'geraet', geraet: 'rb338' });
  assert.deepEqual(postenVonGeraet(e('surge')), { art: 'geraet', geraet: 'surge' });
  assert.deepEqual(postenVonGeraet(e('bk')), { art: 'geraet', geraet: 'bk:juno-pad' });
  for (const g of ['komp', 'eq', 'saett']) assert.deepEqual(postenVonGeraet(e(g)), { art: 'geraet', geraet: g });
  assert.equal(postenVonGeraet(e('hall')), null, 'negative control: the hall is no device of a collection (K1 list)');
});

// ---- T8.1 resolving an item on the page ----
test('T8.1 loesePosten: sample, preset and device resolve to their drag type and payload; a dangling reference is "missing", never dropped, never draggable', async (t) => {
  const { loesePosten } = await import(K);
  const s = await server(t);
  const q = { holeGet: s.holeGet, katalog: KATALOG };
  const a = await loesePosten({ art: 'sample', sha: SHA }, q);
  assert.deepEqual([a.typ, a.nutzlast, a.fehlt, a.text], [ZIEH_TYP, { sha: SHA, dauer_s: 0.5, name: 'Kick 1' }, false, 'Kick 1']);
  const p = await loesePosten({ art: 'preset', id: 'werk:komp/drum-bus' }, q);
  assert.deepEqual([p.typ, p.nutzlast, p.fehlt], [PRESET_TYP, { id: 'werk:komp/drum-bus', geraet: 'komp', name: 'Drum Bus' }, false]);
  const g = await loesePosten({ art: 'geraet', geraet: 'bk:juno-pad' }, q);
  assert.deepEqual([g.typ, g.nutzlast.geraet, g.nutzlast.graph, g.fehlt], [GERAET_TYP, 'bk', 'juno-pad', false]);
  const k = await loesePosten({ art: 'geraet', geraet: 'komp' }, q);
  assert.deepEqual([k.typ, k.nutzlast.ziel, k.text], [GERAET_TYP, 'insert', 'Compressor']);
  // dangling references
  for (const x of [{ art: 'sample', sha: SHA2 }, { art: 'preset', id: 'nutzer:komp/gone' }, { art: 'geraet', geraet: 'bk:old-graph' }]) {
    const r = await loesePosten(x, q);
    assert.deepEqual([r.fehlt, r.typ, r.nutzlast], [true, null, null], JSON.stringify(x));
    assert.deepEqual(r.posten, x, 'the item is kept so it can be removed');
    assert.match(r.text, /missing/);
  }
  // a known sample whose file is not there is shown but not offered for dragging
  const ohne = await loesePosten({ art: 'sample', sha: SHA }, { ...q, holeGet: async () => ({ status: 200, j: { eintrag: { ...SAMPLE, pfad_da: false } } }) });
  assert.deepEqual([ohne.fehlt, ohne.typ], [false, null]);
  // the server is away: missing too, not an exception
  const weg = await loesePosten({ art: 'sample', sha: SHA }, { ...q, holeGet: async () => ({ status: 0, j: { fehler: 'netz' } }) });
  assert.equal(weg.fehlt, true);
});

// ---- T8.1/T8.4 panel HTML ----
test('T8.1/T8.4 panel HTML: the list of collections with count; an open one with its items, a remove button on each, rename and delete; missing rows not draggable', async () => {
  const { kollektionenHtml } = await import(K);
  const liste = kollektionenHtml({ liste: [{ slug: 'techno', name: 'Techno <b>', anzahl: 3, geaendert: 'x' }, { slug: 'kaputt', name: 'kaputt', anzahl: 0, fehler: 'json_kaputt' }], offen: null });
  assert.match(liste, /data-koll-oeffnen="techno"/);
  assert.match(liste, /Techno &lt;b&gt;/, 'names are escaped');
  assert.match(liste, /3 items/);
  assert.match(liste, /data-koll-aktion="neu"/);
  const offen = kollektionenHtml({ liste: [], offen: { slug: 'techno', name: 'Techno', autor: 'cypher', geaendert: 'g1', zeilen: [
    { posten: { art: 'sample', sha: SHA }, text: 'Kick 1', typ: ZIEH_TYP, nutzlast: {}, fehlt: false },
    { posten: { art: 'preset', id: 'nutzer:komp/gone' }, text: 'nutzer:komp/gone (missing)', typ: null, nutzlast: null, fehlt: true }] } });
  assert.match(offen, /data-koll-i="0"[^>]*draggable="true"/);
  assert.match(offen, /data-koll-i="1"[^>]*draggable="false"/, 'a missing row is not offered for dragging');
  assert.match(offen, /class="koll-zeile fehlt"/);
  assert.equal((offen.match(/data-koll-aktion="weg"/g) ?? []).length, 2, 'every row, missing ones too, has a remove button');
  for (const a of ['zurueck', 'umbenennen', 'loeschen']) assert.match(offen, new RegExp(`data-koll-aktion="${a}"`));
  assert.match(offen, /by Cypher/);
  assert.match(liste + offen, /^[\x09\x0a\x20-\x7e]+$/, 'English ASCII only');
});

// ---- T8.3 context menu points ----
test('T8.3 menuePunkte: "Add to <name>" per collection and "New collection…"; a collection that holds the item is shown disabled', async () => {
  const { menuePunkte } = await import(K);
  const log = [];
  const pk = menuePunkte([{ slug: 'a', name: 'Alpha' }, { slug: 'b', name: 'Beta', enthaelt: true }, { slug: 'c', name: 'C', fehler: 'json_kaputt' }],
    { hinzu: (slug) => log.push(['hinzu', slug]), neu: () => log.push(['neu']) });
  assert.deepEqual(pk.map((p) => [p.text, !!p.aus]), [['Add to Alpha', false], ['Add to Beta', true], ['New collection…', false]], 'a damaged collection is not offered');
  pk[0].aktion(); pk[2].aktion();
  assert.deepEqual(log, [['hinzu', 'a'], ['neu']]);
});

// ---- T8.1 to T8.4 binder against the real routes ----
test('T8.1-T8.4 binder: create, add one item of each kind, open, drag each with its type, remove one, rename, delete; state lives on the server', async (t) => {
  const { bindeKollektionen } = await import(K);
  const s = await server(t);
  const w = wurzel(), lib = wurzel(), pre = wurzel(), ger = wurzel();
  const alt = globalThis.document;
  globalThis.document = { getElementById: (id) => ({ kollektionen: w, 'geraete-browser': ger, presets: pre })[id] ?? null, querySelector: (q) => (q === '#libliste' ? lib : null) };
  const gemeldet = [], menues = [];
  let antwort = 'Techno';
  try {
    const ctx = { st: { sichtbar: true }, beimSichtwechsel: [], holeGet: s.holeGet, holeJson: s.holeJson, melde: (tx, f) => gemeldet.push([tx, !!f]),
      stoebern: () => ({ treffer: [SAMPLE] }), presetListe: () => [{ herkunft: 'werk', geraet: 'komp', slug: 'drum-bus', name: 'Drum Bus' }] };
    bindeKollektionen(ctx, { frage: () => antwort, bestaetige: () => true, menue: (punkte, x, y) => menues.push(punkte) });
    await ctx.kollektionenZeigen(); await ruhe();
    assert.match(w.innerHTML, /data-koll-aktion="neu"/);
    // New collection
    w.feuer('click', { target: { closest: (q) => (q === '[data-koll-aktion]' ? { dataset: { kollAktion: 'neu' } } : null) } }); await ruhe();
    assert.deepEqual(s.speicher.liste().map((x) => x.name), ['Techno']);
    // right click on a LIBRARY row, a preset row and a device row: "Add to Techno"
    const rechts = (el, sel, ds) => { const e = { clientX: 1, clientY: 2, preventDefault() { this.verhindert = true; }, target: { closest: (q) => (q === sel ? { dataset: ds } : null) } }; el.feuer('contextmenu', e); return e; };
    const e1 = rechts(lib, 'tr', { i: '0' }); await ruhe();
    assert.equal(e1.verhindert, true);
    menues.at(-1)[0].aktion(); await ruhe();
    rechts(pre, '[data-preset-id]', { presetId: 'werk/komp/drum-bus' }); await ruhe();
    menues.at(-1)[0].aktion(); await ruhe();
    rechts(ger, '[data-geraet-i]', { geraetI: '0' }); await ruhe();
    assert.equal(menues.at(-1)[0].text, 'Add to Techno');
    menues.at(-1)[0].aktion(); await ruhe();
    const datei = () => JSON.parse(fs.readFileSync(path.join(s.ordner, 'techno.json'), 'utf8'));
    assert.deepEqual(datei().posten, [{ art: 'sample', sha: SHA }, { art: 'preset', id: 'werk:komp/drum-bus' }, { art: 'geraet', geraet: 'rb338' }]);
    // the same item again: the menu shows it disabled (it is already there)
    rechts(lib, 'tr', { i: '0' }); await ruhe();
    assert.equal(menues.at(-1)[0].aus, true, 'already in Techno');
    // open the collection: three rows, each dragged with its own type
    w.feuer('click', { target: { closest: (q) => (q === '[data-koll-oeffnen]' ? { dataset: { kollOeffnen: 'techno' } } : null) } }); await ruhe();
    const typen = [];
    for (const i of [0, 1, 2]) {
      const dt = { setData: (ty, d) => typen.push([ty, JSON.parse(d)]), effectAllowed: '' };
      w.feuer('dragstart', { dataTransfer: dt, preventDefault() {}, target: { closest: (q) => (q === '[data-koll-i]' ? { dataset: { kollI: String(i) } } : null) } });
    }
    assert.deepEqual(typen.map((x) => x[0]), [ZIEH_TYP, PRESET_TYP, GERAET_TYP]);
    assert.deepEqual(typen[0][1], { sha: SHA, dauer_s: 0.5, name: 'Kick 1' }, 'the sample payload is the one of drag.js nutzlast');
    // remove the preset row
    w.feuer('click', { target: { closest: (q) => (q === '[data-koll-aktion]' ? { dataset: { kollAktion: 'weg', kollI: '1' } } : null) } }); await ruhe();
    assert.deepEqual(datei().posten.map((p) => p.art), ['sample', 'geraet']);
    assert.ok(s.log.some((x) => x[0] === 'POST' && x[1] === '/kollektionen/techno/posten' && x[2].weg && x[2].erwartet), 'a remove carries erwartet (no lost update)');
    // rename, then delete
    antwort = 'Techno Tools';
    w.feuer('click', { target: { closest: (q) => (q === '[data-koll-aktion]' ? { dataset: { kollAktion: 'umbenennen' } } : null) } }); await ruhe();
    assert.deepEqual(s.speicher.liste().map((x) => [x.slug, x.name]), [['techno-tools', 'Techno Tools']]);
    w.feuer('click', { target: { closest: (q) => (q === '[data-koll-aktion]' ? { dataset: { kollAktion: 'loeschen' } } : null) } }); await ruhe();
    assert.deepEqual(s.speicher.liste(), []);
    assert.ok(fs.readdirSync(path.join(s.ordner, '.papierkorb')).length >= 1, 'deleted into the trash folder');
    assert.deepEqual(gemeldet.filter((x) => x[1]), [], 'no error was shown');
  } finally { globalThis.document = alt; }
});

test('T8.3 negative controls: no context menu outside PRODUCTION, on a row that is no item, or for the hall; a server refusal is shown, nothing else', async (t) => {
  const { bindeKollektionen } = await import(K);
  const s = await server(t);
  const w = wurzel(), lib = wurzel(), pre = wurzel(), ger = wurzel();
  const alt = globalThis.document;
  globalThis.document = { getElementById: (id) => ({ kollektionen: w, 'geraete-browser': ger, presets: pre })[id] ?? null, querySelector: (q) => (q === '#libliste' ? lib : null) };
  const menues = [], gemeldet = [];
  try {
    const ctx = { st: { sichtbar: false }, beimSichtwechsel: [], holeGet: s.holeGet, holeJson: s.holeJson, melde: (tx, f) => gemeldet.push([tx, !!f]),
      stoebern: () => ({ treffer: [SAMPLE, { typ: 'track', sha: 'kein-sha' }] }), presetListe: () => [] };
    bindeKollektionen(ctx, { frage: () => 'X', bestaetige: () => true, menue: (p) => menues.push(p) });
    const rechts = (el, sel, ds) => { const e = { clientX: 1, clientY: 2, preventDefault() { this.verhindert = true; }, target: { closest: (q) => (q === sel ? { dataset: ds } : null) } }; el.feuer('contextmenu', e); return e; };
    const dj = rechts(lib, 'tr', { i: '0' }); await ruhe();
    assert.deepEqual([dj.verhindert, menues.length], [undefined, 0], 'the DJ view keeps the browser context menu');
    ctx.st.sichtbar = true; for (const f of ctx.beimSichtwechsel) f(true); await ruhe();
    rechts(lib, 'tr', { i: '1' }); await ruhe();
    assert.equal(menues.length, 0, 'a row without a catalogue sha is no item');
    const hall = [...KATALOG.instrumente, ...KATALOG.effekte].findIndex((x) => x.geraet === 'hall');
    rechts(ger, '[data-geraet-i]', { geraetI: String(hall) }); await ruhe();
    assert.equal(menues.length, 0, 'the hall is no device of a collection');
    rechts(lib, 'tr', { i: '0' }); await ruhe();
    assert.equal(menues.length, 1, 'positive control: a LIBRARY row in PRODUCTION');
    // the collection is gone on the server meanwhile: the refusal text is shown
    s.speicher.lege('Weg', 'andreas');
    rechts(lib, 'tr', { i: '0' }); await ruhe();
    s.speicher.loesche('weg', 'andreas');
    menues.at(-1)[0].aktion(); await ruhe();
    assert.equal(gemeldet.at(-1)[1], true);
    assert.match(gemeldet.at(-1)[0], /^Not added: /);
  } finally { globalThis.document = alt; }
});
