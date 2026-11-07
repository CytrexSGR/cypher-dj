// Package 1.16 rest U6 (S3, layout decision of the spec): the PRODUCTION browser mode switch (LIBRARY · DEVICES · PRESETS · COLLECTIONS),
// the DEVICES list and the pure drop builders for a device. Node only: CSS text checks, a body/storage stand-in, pure functions.
// The computed-style check and the real drags are the browser probe pruef/probe_b116_browser.mjs (not part of this file).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BROWSER_MODI, BROWSER_SCHLUESSEL, MODUS_AKTIV, liesModus, merkeModus, setzeKlassen, wahlHtml, waehle } from '../oeffentlich/produktion/browserwahl.js';
import { geraeteHtml } from '../oeffentlich/produktion/geraete_browser.js';
import { GERAET_TYP, geraetNutzlast, instrumentBefehl, effektBefehl, geraetAblage, GERAET_TEXT } from '../oeffentlich/produktion/ziehen.js';
import { katalog } from '../presets/bereich.ts';
import { neuesProjekt } from '../projekt/modell.ts';
import { fuehreListeAus } from '../projekt/befehle.ts';

const KATALOG = katalog([{ name: 'juno-pad', art: 'instrument' }, { name: 'fx', art: 'effekt' }]);
const speicher = (start = {}) => { const m = new Map(Object.entries(start)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const koerper = () => { const k = new Set(['produktion']); return { k, classList: { toggle: (n, an) => { if (an) k.add(n); else k.delete(n); }, contains: (n) => k.has(n) } }; };

// ---- T6.1 mode switch ----
test('mode switch: four modes, remembered per viewer under djk-prod-browser; default and unknown give LIBRARY; DJ key djk-bereich never written', () => {
  assert.deepEqual(BROWSER_MODI, ['library', 'geraete', 'presets', 'kollektionen']);
  assert.equal(BROWSER_SCHLUESSEL, 'djk-prod-browser');
  assert.equal(liesModus(speicher()), 'library');
  assert.equal(liesModus(speicher({ 'djk-prod-browser': 'geraete' })), 'geraete');
  assert.equal(liesModus(speicher({ 'djk-prod-browser': 'quatsch' })), 'library');
  assert.equal(liesModus({ getItem: () => { throw new Error('blocked'); } }), 'library', 'storage that throws');
  assert.equal(liesModus(undefined), 'library');
  for (const m of BROWSER_MODI) if (!MODUS_AKTIV[m]) assert.equal(liesModus(speicher({ 'djk-prod-browser': m })), 'library', `${m} disabled until U8`);
  const s = speicher({ 'djk-bereich': 'effekte' });
  merkeModus(s, 'geraete');
  assert.deepEqual([...s.m], [['djk-bereich', 'effekte'], ['djk-prod-browser', 'geraete']]);
  merkeModus({ setItem: () => { throw new Error('blocked'); } }, 'geraete');   // no throw
});

test('mode switch: exactly one b-<mode> class on body while PRODUCTION is visible, none when hidden; disabled modes are not taken', () => {
  const b = koerper();
  setzeKlassen(b, 'geraete', true);
  assert.deepEqual([...b.k].sort(), ['b-geraete', 'produktion']);
  setzeKlassen(b, 'library', true);
  assert.deepEqual([...b.k].sort(), ['b-library', 'produktion']);
  setzeKlassen(b, 'library', false);
  assert.deepEqual([...b.k], ['produktion'], 'hidden: no mode class (the DJ view stays as it was)');
  const s = speicher();
  assert.equal(waehle(s, 'quatsch', 'library'), 'library', 'an unknown mode is not taken');
  assert.equal(s.m.size, 0);
  assert.equal(waehle(s, 'kollektionen', 'library'), 'kollektionen', 'COLLECTIONS is on since U8');
  s.m.clear();
  assert.equal(waehle(s, 'presets', 'library'), 'presets', 'PRESETS is on since U7');
  assert.equal(s.m.get('djk-prod-browser'), 'presets');
  s.m.clear();
  assert.equal(waehle(s, 'geraete', 'library'), 'geraete');
  assert.equal(s.m.get('djk-prod-browser'), 'geraete');
  const h = wahlHtml('geraete');
  assert.equal((h.match(/data-browser-modus=/g) ?? []).length, 4);
  assert.match(h, /data-browser-modus="geraete"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(h, /disabled/, 'every mode can be clicked since U8');
  assert.doesNotMatch(h, /data-browser-modus="presets"[^>]*disabled/, 'PRESETS can be clicked since U7');
  assert.match(h, />LIBRARY<.*>DEVICES<.*>PRESETS<.*>COLLECTIONS</s);
});

test('CSS: the mode rules come after the PRODUCTION library block, with !important, and keep the DJ view untouched', () => {
  const css = fs.readFileSync(new URL('../oeffentlich/produktion/produktion.css', import.meta.url), 'utf8');
  const block = css.indexOf('body.produktion #bestand .tabelle:not([data-tabelle="library"]) { display: none !important; }');
  assert.ok(block > 0, 'the line-24 rule is there');
  const regeln = [
    'body.produktion:not(.b-library) #bestand .tabelle[data-tabelle="library"] { display: none !important; }',
    'body.produktion.b-geraete #geraete-browser { display: block !important; }',
    'body.produktion.b-presets #presets { display: block !important; }',
    'body.produktion.b-kollektionen #kollektionen { display: block !important; }',
    'body.produktion #geraete-browser, body.produktion #presets, body.produktion #kollektionen { display: none !important; }',
    'body.produktion .p-browserwahl { display: flex; }',
  ];
  for (const r of regeln) { const i = css.indexOf(r); assert.ok(i > block, `after the library block: ${r}`); }
  assert.ok(css.indexOf(regeln[4]) < css.indexOf(regeln[1]), 'the hide-all rule comes before the per-mode rules');
  const html = fs.readFileSync(new URL('../oeffentlich/index.html', import.meta.url), 'utf8');
  assert.match(html, /<div class="kopfzeile">[\s\S]*?<div class="p-browserwahl" id="p-browserwahl"[^>]*><\/div>[\s\S]*?<\/div>\s*<div class="effekte"/);
  assert.match(html, /<div class="geraete-browser" id="geraete-browser" hidden aria-label="Devices"><\/div>/);
  const stil = fs.readFileSync(new URL('../oeffentlich/style.css', import.meta.url), 'utf8') + css;
  assert.match(stil, /\.p-browserwahl \{ display: none; \}/, 'outside PRODUCTION the switch is not shown');
});

// ---- T6.2 DEVICES list ----
test('DEVICES list: two groups from GET /presets/katalog; disabled entries are greyed with their reason (a drop shows it, T6.5)', () => {
  const h = geraeteHtml(KATALOG);
  assert.match(h, /INSTRUMENTS[\s\S]*RB-338[\s\S]*Surge[\s\S]*juno-pad[\s\S]*EFFECTS[\s\S]*Compressor[\s\S]*EQ[\s\S]*Saett[\s\S]*Hall/);
  assert.equal((h.match(/draggable="true"/g) ?? []).length, 7);
  // integration with 1.10 slice 4b: eq and saett are active kinds (INSERT_ARTEN_AKTIV), only the return hall stays greyed
  assert.equal((h.match(/class="geraete-zeile aus"/g) ?? []).length, 1, 'only Hall greyed');
  assert.doesNotMatch(h, /data-geraet-i="5"[^>]*class="[^"]*aus[^"]*"/, 'EQ is draggable');
  assert.doesNotMatch(h, /comes with slice 4b/);
  assert.match(h, /title="the return hall lives on returns"/);
  assert.doesNotMatch(h, /fx<\/|>fx</, 'effect graphs are not instruments');
  assert.match(geraeteHtml(null), /Loading/);
  assert.match(geraeteHtml({ instrumente: [{ geraet: 'bk', titel: '<b>', ziel: 'spur_neu', graph: 'x' }], effekte: [] }), /&lt;b&gt;/);
});

// ---- T6.3 pure drop builders ----
function projekt() {
  let p = neuesProjekt('T');
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Drums' }, { befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern', name: 'rb338', parameter: {} } }]).projekt;
  return p;
}
const E = (geraet, extra = {}) => [...KATALOG.instrumente, ...KATALOG.effekte].find((x) => x.geraet === geraet && (extra.graph ? x.graph === extra.graph : true));

test('drop builders: instrument → spur_neu (rb338 as NEU, surge slot 1, bk graph); effect on a strip → insert_setzen at the end; inactive → reason', () => {
  assert.equal(GERAET_TYP, 'application/x-djk-geraet');
  assert.deepEqual(instrumentBefehl(geraetNutzlast(E('rb338'))), { label: 'Add RB-338 track',
    befehl: { befehl: 'spur_neu', art: 'instrument', name: 'RB-338', geraet: { art: 'intern', name: 'rb338', parameter: {} } } });
  assert.deepEqual(instrumentBefehl(geraetNutzlast(E('surge'))).befehl, { befehl: 'spur_neu', art: 'instrument', name: 'Surge', geraet: { art: 'wirt', name: 'surge', slot: 1 } });
  assert.deepEqual(instrumentBefehl(geraetNutzlast(E('bk', { graph: 'juno-pad' }))).befehl,
    { befehl: 'spur_neu', art: 'instrument', name: 'juno-pad', geraet: { art: 'intern', name: 'bk', graph: 'juno-pad', parameter: {} } });
  const p = projekt();
  assert.deepEqual(effektBefehl(p, 's1', geraetNutzlast(E('komp'))), { label: 'Add Compressor to Drums', befehl: { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' } });
  assert.deepEqual(effektBefehl(p, 'master', geraetNutzlast(E('komp'))).befehl.pos, 0);
  // eq and saett became active kinds with 1.10 slice 4b: a stage at the end of the chain, like the compressor
  assert.deepEqual(effektBefehl(p, 's1', geraetNutzlast(E('eq'))), { label: 'Add EQ to Drums', befehl: { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq' } });
  assert.equal(effektBefehl(p, 's1', geraetNutzlast(E('saett'))).befehl.art, 'saett');
  assert.equal(effektBefehl(p, 's1', geraetNutzlast(E('hall'))).text, 'the return hall lives on returns');
  assert.equal(effektBefehl(p, 'x9', geraetNutzlast(E('komp'))).fehler, 'keine_spur');
  // the commands run on the project
  assert.equal(fuehreListeAus(p, [effektBefehl(p, 's1', geraetNutzlast(E('komp'))).befehl]).projekt.spuren[0].inserts.length, 1);
  assert.equal(fuehreListeAus(p, [instrumentBefehl(geraetNutzlast(E('rb338'))).befehl]).projekt.spuren.length, 3);
  // invalid payloads are not offered
  for (const x of [null, {}, { geraet: 'piano', ziel: 'spur_neu' }, { geraet: 'bk', ziel: 'spur_neu' }, { geraet: 'komp', ziel: 'spur_neu' }]) assert.equal(geraetNutzlast(x), null, JSON.stringify(x));
});

test('drop builders: full chain and empty pool refuse with text; an instrument anywhere makes a new track, an effect needs a track row', () => {
  let p = projekt();
  for (let i = 0; i < 4; i++) p = fuehreListeAus(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: i, art: 'komp' }]).projekt;
  assert.deepEqual(effektBefehl(p, 's1', geraetNutzlast(E('komp'))), { fehler: 'kette_voll', text: GERAET_TEXT.kette_voll });
  for (const s of ['s2', 'master']) for (let i = 0; i < 4; i++) p = fuehreListeAus(p, [{ befehl: 'insert_setzen', strang_id: s, pos: i, art: 'komp' }]).projekt;
  let q = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio' }]).projekt;
  assert.deepEqual(effektBefehl(q, 's3', geraetNutzlast(E('komp'))), { fehler: 'ins_voll', text: GERAET_TEXT.ins_voll });
  q = projekt();
  assert.deepEqual(geraetAblage(q, geraetNutzlast(E('rb338')), -1).befehle[0].befehl, 'spur_neu', 'an instrument dropped outside the rows: new track');
  assert.deepEqual(geraetAblage(q, geraetNutzlast(E('rb338')), 1).befehle[0].befehl, 'spur_neu', 'on a track row: still a new track (S3)');
  assert.deepEqual(geraetAblage(q, geraetNutzlast(E('komp')), 0), { label: 'Add Compressor to Drums', befehle: [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }] });
  assert.equal(geraetAblage(q, geraetNutzlast(E('komp')), 7).fehler, 'keine_spur');
  for (const t of Object.values(GERAET_TEXT)) assert.match(t, /^[\x20-\x7e]+$/);
});

// ---- T6.4 drop wiring (ablage.js) with stand-in elements: no browser, the handlers are called directly ----
test('drop wiring: a device dropped on the arrangement sends one write; an effect on an INSERTS strip row too; refusals only show their text', async () => {
  const { bindeAblage } = await import('../oeffentlich/produktion/ablage.js');
  const { GERAET_TYP: TYP, ZIEH_TYP } = await import('../oeffentlich/produktion/ziehen.js');
  const el = () => ({ h: {}, addEventListener(n, f) { this.h[n] = f; } });
  const ueber = el(), liste = el();
  const alt = globalThis.document;
  globalThis.document = { querySelector: () => null };
  try {
    const gesendet = [], gemeldet = [];
    const p = projekt();
    const ctx = { st: { projekt: p, sichtbar: true }, $: (n) => ({ ueber, 'inserts-liste': liste })[n], stoebern: () => null, beimSichtwechsel: [],
      zeilen: () => [{ art: 'spur', spur: 0, y: 0, h: 40 }, { art: 'spur', spur: 1, y: 40, h: 40 }],
      aendere: (label, befehle) => gesendet.push([label, befehle]), aendereAus: () => {}, melde: (t, f) => gemeldet.push([t, f]) };
    bindeAblage(ctx);
    const dt = (typ, n) => ({ types: [typ], getData: (t) => (t === typ ? JSON.stringify(n) : ''), dropEffect: '' });
    const ev = (typ, n, extra = {}) => ({ dataTransfer: dt(typ, n), offsetX: 10, offsetY: 50, preventDefault() { this.verhindert = true; }, ...extra });
    const over = ev(TYP, geraetNutzlast(E('rb338')));
    ueber.h.dragover(over);
    assert.equal(over.verhindert, true, 'the arrangement accepts a device');
    ueber.h.drop(ev(TYP, geraetNutzlast(E('rb338'))));
    ueber.h.drop(ev(TYP, geraetNutzlast(E('komp'))));
    ueber.h.drop(ev(TYP, geraetNutzlast(E('eq'))));
    ueber.h.drop(ev(TYP, geraetNutzlast(E('hall'))));
    assert.deepEqual(gesendet.map(([l, b]) => [l, b[0].befehl, b[0].strang_id ?? null]), [['Add RB-338 track', 'spur_neu', null], ['Add Compressor to Bass', 'insert_setzen', 's2'], ['Add EQ to Bass', 'insert_setzen', 's2']]);
    assert.deepEqual(gemeldet, [['the return hall lives on returns', true]], 'only the inactive kind (hall) is refused with its reason');
    // a strip row of the INSERTS block (group, return, master rows too)
    const zeile = { dataset: { strang: 'master' } };
    const auf = ev(TYP, geraetNutzlast(E('komp')), { target: { closest: (s) => (s === '.p-kette[data-strang]' ? zeile : null) } });
    liste.h.dragover(auf);
    assert.equal(auf.verhindert, true);
    liste.h.drop(auf);
    assert.deepEqual(gesendet.at(-1)[1], [{ befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'komp' }]);
    liste.h.drop(ev(TYP, geraetNutzlast(E('rb338')), { target: { closest: () => zeile } }));
    assert.equal(gesendet.length, 4, 'an instrument on a strip row sends nothing');
    assert.equal(gemeldet.at(-1)[0], 'Drop instruments on the arrangement');
    // negative control: a clip drag over a strip row is not taken
    const clip = ev(ZIEH_TYP, { sha: 'a'.repeat(64), dauer_s: 1 }, { target: { closest: () => zeile } });
    liste.h.dragover(clip);
    assert.equal(clip.verhindert, undefined);
  } finally { globalThis.document = alt; }
});

// ======== package 1.16 rest U7 (S4, F8, F4): PRESETS in PRODUCTION: drag, apply, save current, origin mark ========
// T7.1 drop target rules (pure). The projects below are built with the real S2 commands; the module is imported inside each test so a missing
// module fails these tests only.
const PZ = '../oeffentlich/produktion/preset_ziel.js';
const eintragVon = (geraet, slug = 'x', herkunft = 'werk', extra = {}) => ({ herkunft, geraet, slug, name: slug.toUpperCase(), ...extra });
function presetProjekt() {
  let p = neuesProjekt('P');
  p = fuehreListeAus(p, [
    { befehl: 'spur_neu', art: 'audio', name: 'Drums' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern', name: 'rb338', parameter: {} } },
    { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: { art: 'intern', name: 'bk', graph: 'juno-pad', parameter: {} } },
    { befehl: 'spur_neu', art: 'instrument', name: 'Pad', geraet: { art: 'wirt', name: 'surge', slot: 1 } },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' },
    { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'komp' },
  ]).projekt;
  return p;
}

test('T7.1 presetNutzlast: register id, device and name of a list row; a damaged row and a malformed one are not offered', async () => {
  const { PRESET_TYP, presetNutzlast } = await import(PZ);
  assert.equal(PRESET_TYP, 'application/x-djk-preset');
  assert.deepEqual(presetNutzlast(eintragVon('komp', 'drum-bus')), { id: 'werk:komp/drum-bus', geraet: 'komp', name: 'DRUM-BUS' });
  assert.deepEqual(presetNutzlast(eintragVon('kanal-limiter', 'glue', 'nutzer')), { id: 'nutzer:kanal-limiter/glue', geraet: 'kanal-limiter', name: 'GLUE' });
  assert.equal(presetNutzlast(eintragVon('komp', 'kaputt', 'nutzer', { fehler: 'json_kaputt' })), null, 'a damaged file cannot be applied');
  for (const x of [null, {}, eintragVon('komp', 'A B'), eintragVon('komp', '../x'), eintragVon('komp', 'x', 'fremd'), eintragVon('', 'x')]) assert.equal(presetNutzlast(x), null, JSON.stringify(x));
});

test('T7.1 presetZiel on a track row: instrument preset -> that track (kind must match); effect preset -> the first stage of that kind, else a new stage', async () => {
  const { presetZiel, presetNutzlast } = await import(PZ);
  const p = presetProjekt();
  const n = (g) => presetNutzlast(eintragVon(g));
  const auf = (g, i) => presetZiel(p, { spurIndex: i }, n(g));
  assert.deepEqual(auf('rb338', 1), { ziel: { art: 'spur', spur_id: 's2' } }, 'rb338 preset on the rb338 track');
  assert.deepEqual(auf('baukasten', 2), { ziel: { art: 'spur', spur_id: 's3' } }, 'baukasten preset on the bk track');
  assert.equal(auf('rb338', 0).fehler, 'keine_instrumentspur', 'an audio track has no device');
  for (const [g, i] of [['rb338', 2], ['rb338', 3], ['baukasten', 1], ['baukasten', 3]]) assert.equal(auf(g, i).fehler, 'geraet_passt_nicht', `${g} on track ${i}`);
  assert.deepEqual(auf('komp', 0), { ziel: { art: 'insert', insert_id: 'i1' } }, 'the first compressor stage of the track');
  assert.deepEqual(auf('komp', 1), { ziel: { art: 'insert_neu', strang_id: 's2' } }, 'no stage of that kind: a new one at the end');
  assert.deepEqual(auf('eq', 0), { ziel: { art: 'insert_neu', strang_id: 's1' } }, 'a new stage of an active kind at the end of the chain');
  assert.deepEqual(auf('hall', 1), { ziel: { art: 'insert_neu', strang_id: 's2' } });
  for (const i of [-1, 4, 99, undefined]) assert.equal(auf('komp', i).fehler, 'keine_spur', `row ${i}`);
  assert.equal(presetZiel(null, { spurIndex: 0 }, n('komp')).fehler, 'keine_spur');
  assert.equal(auf('gate', 1).fehler, 'nur_kanal', 'a kern mix tool lives on a DJ channel');
  // the first stage OF THAT KIND, not the first stage
  const q = JSON.parse(JSON.stringify(p));
  q.spuren[1].inserts = [{ id: 'i8', art: 'eq', an: true, werte: {} }, { id: 'i9', art: 'komp', an: true, werte: {} }];
  assert.deepEqual(presetZiel(q, { spurIndex: 1 }, n('komp')), { ziel: { art: 'insert', insert_id: 'i9' } });
});

test('T7.1 presetZiel: a full chain or an empty pool refuse a NEW stage with text; an existing stage is still applied to', async () => {
  const { presetZiel, presetNutzlast, PRESET_ZIEL_TEXT } = await import(PZ);
  const n = presetNutzlast(eintragVon('komp'));
  let p = presetProjekt();
  p = JSON.parse(JSON.stringify(p));
  p.spuren[1].inserts = [1, 2, 3, 4].map((i) => ({ id: `e${i}`, art: 'eq', an: true, werte: {} }));
  assert.deepEqual(presetZiel(p, { spurIndex: 1 }, n), { fehler: 'kette_voll', text: PRESET_ZIEL_TEXT.kette_voll });
  p.spuren[1].inserts = [1, 2, 3, 4].map((i) => ({ id: `k${i}`, art: 'komp', an: true, werte: {} }));
  assert.deepEqual(presetZiel(p, { spurIndex: 1 }, n), { ziel: { art: 'insert', insert_id: 'k1' } }, 'four compressors: the preset goes to the first one');
  // 12 compressors in the project, none on the Lead track: no new one
  p.spuren[1].inserts = [1, 2, 3, 4].map((i) => ({ id: `a${i}`, art: 'komp', an: true, werte: {} }));
  p.spuren[0].inserts = [1, 2, 3, 4].map((i) => ({ id: `b${i}`, art: 'komp', an: true, werte: {} }));
  p.master.inserts = [1, 2, 3, 4].map((i) => ({ id: `c${i}`, art: 'komp', an: true, werte: {} }));
  assert.deepEqual(presetZiel(p, { spurIndex: 2 }, n), { fehler: 'ins_voll', text: PRESET_ZIEL_TEXT.ins_voll });
  assert.deepEqual(presetZiel(p, { spurIndex: 1 }, n), { ziel: { art: 'insert', insert_id: 'a1' } }, 'a track that has a compressor still takes the preset');
});

test('T7.1 presetZiel on a stage or a strip row of the INSERTS block: a stage takes its own kind only; a strip row gets a new stage', async () => {
  const { presetZiel, presetNutzlast } = await import(PZ);
  const p = presetProjekt();
  const n = (g) => presetNutzlast(eintragVon(g));
  assert.deepEqual(presetZiel(p, { stufe: 'i1' }, n('komp')), { ziel: { art: 'insert', insert_id: 'i1' } });
  assert.deepEqual(presetZiel(p, { stufe: 'i2' }, n('komp')), { ziel: { art: 'insert', insert_id: 'i2' } }, 'a stage on the master');
  assert.equal(presetZiel(p, { stufe: 'i1' }, n('eq')).fehler, 'geraet_passt_nicht', 'an eq preset on a compressor stage');
  assert.equal(presetZiel(p, { stufe: 'i1' }, n('rb338')).fehler, 'geraet_passt_nicht', 'an instrument preset on a stage');
  assert.equal(presetZiel(p, { stufe: 'i77' }, n('komp')).fehler, 'keine_stufe');
  assert.deepEqual(presetZiel(p, { strang: 'master' }, n('komp')), { ziel: { art: 'insert_neu', strang_id: 'master' } });
  assert.deepEqual(presetZiel(p, { strang: 's2' }, n('komp')), { ziel: { art: 'insert_neu', strang_id: 's2' } });
  assert.equal(presetZiel(p, { strang: 'master' }, n('rb338')).fehler, 'nur_spur', 'an instrument preset does not go on a strip');
  assert.equal(presetZiel(p, { strang: 'x9' }, n('komp')).fehler, 'keine_spur');
  assert.equal(presetZiel(p, {}, n('komp')).fehler, 'keine_spur');
});

test('T7.1 presetZiel texts are English ASCII and every refusal carries one', async () => {
  const { PRESET_ZIEL_TEXT } = await import(PZ);
  for (const [k, t] of Object.entries(PRESET_ZIEL_TEXT)) assert.match(t, /^[\x20-\x7e]+$/, k);
  for (const k of ['keine_spur', 'keine_stufe', 'keine_instrumentspur', 'geraet_passt_nicht', 'nur_spur', 'nur_kanal', 'kette_voll', 'ins_voll']) assert.ok(PRESET_ZIEL_TEXT[k], k);
});

// ---- T7.2 apply path: drop -> POST /presets/anwenden -> ctx.aendere (one write, one undo step) ----
const PA = '../oeffentlich/produktion/preset_anwenden.js';
const PLAN_INSERT = { weg: 'proj', befehle: [{ befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -18, ratio: 4 }, preset: 'werk:komp/drum-bus' }], label: 'Preset Drum Bus', uebersprungen: ['extsc'] };

test('T7.2 planAktion: a proj plan gives label and commands plus the notes to show before the write; a refusal gives the server text, never commands', async () => {
  const { planAktion, PLAN_TEXT } = await import(PA);
  const ok = planAktion({ status: 200, j: PLAN_INSERT });
  assert.deepEqual([ok.label, ok.befehle, ok.fehler], ['Preset Drum Bus', PLAN_INSERT.befehle, undefined]);
  assert.deepEqual(ok.hinweise, ['not in the table: extsc']);
  const frost = planAktion({ status: 200, j: { ...PLAN_INSERT, hinweise: ['freeze_geht'] } });
  assert.deepEqual(frost.hinweise, [PLAN_TEXT.freeze_geht, 'not in the table: extsc']);
  assert.match(PLAN_TEXT.freeze_geht, /freeze/);
  assert.deepEqual(planAktion({ status: 200, j: { ...PLAN_INSERT, uebersprungen: [] } }).hinweise, [], 'nothing skipped, nothing to say');
  // refusals: the server's text wins
  const hall = planAktion({ status: 409, j: { fehler: 'kein_ziel', text: 'this device has no running instance in PRODUCTION' } });
  assert.deepEqual([hall.befehle, hall.fehler, hall.text], [undefined, true, 'this device has no running instance in PRODUCTION']);
  assert.equal(planAktion({ status: 409, j: { fehler: 'kein_ziel' } }).text, 'Not applied: kein_ziel', 'no text: the reason code, never silent');
  assert.equal(planAktion({ status: 0, j: { fehler: 'netz', text: 'down' } }).fehler, true);
  // a channel plan has no place in the arrangement; an empty plan is no plan
  assert.equal(planAktion({ status: 200, j: { weg: 'regler', anfragen: [{ pfad: 'deck/1/komp/ratio', nach: 4 }], uebersprungen: [] } }).fehler, true);
  assert.equal(planAktion({ status: 200, j: { weg: 'proj', befehle: [], label: 'x', uebersprungen: [] } }).fehler, true);
  assert.equal(planAktion(null).fehler, true);
});

test('T7.2 wendePresetAn: one plan request, then exactly one ctx.aendere; a hint is shown BEFORE the write; a refusal writes nothing', async () => {
  const { wendePresetAn } = await import(PA);
  const spur = (antwort) => {
    const log = [];
    const ctx = { holeJson: async (weg, k) => { log.push(['post', weg, k]); return antwort; }, melde: (t, f) => log.push(['melde', t, f]), aendere: async (l, b) => { log.push(['aendere', l, b]); return true; } };
    return { ctx, log };
  };
  const n = { id: 'werk:komp/drum-bus', geraet: 'komp', name: 'Drum Bus' };
  const ziel = { art: 'insert', insert_id: 'i1' };
  let s = spur({ status: 200, j: { ...PLAN_INSERT, hinweise: ['freeze_geht'] } });
  assert.equal(await wendePresetAn(s.ctx, n, ziel), true);
  assert.deepEqual(s.log.map((x) => x[0]), ['post', 'melde', 'aendere'], 'plan request, hint, write: in that order');
  assert.deepEqual(s.log[0], ['post', '/presets/anwenden', { id: 'werk:komp/drum-bus', ziel }]);
  assert.deepEqual(s.log[2], ['aendere', 'Preset Drum Bus', PLAN_INSERT.befehle]);
  // negative control: a plan without notes shows nothing before the write
  s = spur({ status: 200, j: { ...PLAN_INSERT, uebersprungen: [] } });
  await wendePresetAn(s.ctx, n, ziel);
  assert.deepEqual(s.log.map((x) => x[0]), ['post', 'aendere']);
  // refusal: the text is shown as an error, nothing is written
  s = spur({ status: 409, j: { fehler: 'kein_ziel', text: 'no running instance' } });
  assert.equal(await wendePresetAn(s.ctx, { ...n, geraet: 'hall', id: 'werk:hall/x' }, { art: 'insert_neu', strang_id: 's1' }), false);
  assert.deepEqual(s.log.map((x) => x[0]), ['post', 'melde']);
  assert.deepEqual(s.log[1], ['melde', 'no running instance', true]);
  // a failed write is reported by the writer itself: the function returns what the writer said
  s = spur({ status: 200, j: PLAN_INSERT }); s.ctx.aendere = async () => false;
  assert.equal(await wendePresetAn(s.ctx, n, ziel), false);
});

// ---- T7.1/T7.2 drop wiring (ablage.js) with stand-in elements ----
test('T7.2 drop wiring: a preset on a track row, a stage or a strip row asks the server for the plan and writes once; refusals only show text', async () => {
  const { bindeAblage } = await import('../oeffentlich/produktion/ablage.js');
  const { PRESET_TYP } = await import(PZ);
  const el = () => ({ h: {}, addEventListener(n, f) { this.h[n] = f; } });
  const ueber = el(), liste = el();
  const alt = globalThis.document;
  globalThis.document = { querySelector: () => null };
  try {
    const log = [];
    const p = presetProjekt();
    const ctx = { st: { projekt: p, sichtbar: true }, $: (n) => ({ ueber, 'inserts-liste': liste })[n], stoebern: () => null, beimSichtwechsel: [],
      zeilen: () => [0, 1, 2, 3].map((i) => ({ art: 'spur', spur: i, y: i * 40, h: 40 })),
      holeJson: async (weg, k) => { log.push(['post', weg, k]); return { status: 200, j: { weg: 'proj', befehle: [{ befehl: 'insert_werte_setzen', insert_id: 'i1', werte: {}, preset: k.id }], label: 'Preset X', uebersprungen: [] } }; },
      aendere: async (l, b) => { log.push(['aendere', l, b[0].befehl]); return true; }, aendereAus: () => {}, melde: (t, f) => log.push(['melde', t, f]) };
    bindeAblage(ctx);
    const dt = (n) => ({ types: [PRESET_TYP], getData: (t) => (t === PRESET_TYP ? JSON.stringify(n) : ''), dropEffect: '' });
    const ev = (n, extra = {}) => ({ dataTransfer: dt(n), offsetX: 10, offsetY: 5, preventDefault() { this.verhindert = true; }, ...extra });
    const nutzlast = (g, slug = 'x') => ({ id: `werk:${g}/${slug}`, geraet: g, name: slug });
    const over = ev(nutzlast('komp'));
    ueber.h.dragover(over);
    assert.equal(over.verhindert, true, 'the arrangement accepts a preset');
    // komp preset on the Drums row (offsetY 5 = row 0): the plan is asked with the existing stage as target
    ueber.h.drop(ev(nutzlast('komp', 'drum-bus')));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log.splice(0), [['post', '/presets/anwenden', { id: 'werk:komp/drum-bus', ziel: { art: 'insert', insert_id: 'i1' } }], ['aendere', 'Preset X', 'insert_werte_setzen']]);
    // rb338 preset on the Bass row (offsetY 45 = row 1)
    ueber.h.drop(ev(nutzlast('rb338'), { offsetY: 45 }));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log.splice(0)[0], ['post', '/presets/anwenden', { id: 'werk:rb338/x', ziel: { art: 'spur', spur_id: 's2' } }]);
    // an instrument preset on the audio row: no request at all, only the reason
    ueber.h.drop(ev(nutzlast('rb338')));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log.splice(0), [['melde', 'Instrument presets go on instrument tracks', true]]);
    // beside the rows: nothing sent
    ueber.h.drop(ev(nutzlast('komp'), { offsetY: 500 }));
    ueber.h.drop(ev(nutzlast('gate'), { offsetY: 45 }));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log.splice(0).map((x) => x[0]), ['melde', 'melde'], 'no row and a DJ-channel device: reasons only');
    // INSERTS block: a stage, a strip row
    const stufe = { dataset: { insert: 'i2' } }, zeile = { dataset: { strang: 'master' } };
    const auf = (n, stufeEl) => ev(n, { target: { closest: (s) => (s === '.p-stufe[data-insert]' ? stufeEl : s === '.p-kette[data-strang]' ? zeile : null) } });
    const dstufe = auf(nutzlast('komp'), stufe);
    liste.h.dragover(dstufe);
    assert.equal(dstufe.verhindert, true);
    liste.h.drop(dstufe);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log.splice(0)[0], ['post', '/presets/anwenden', { id: 'werk:komp/x', ziel: { art: 'insert', insert_id: 'i2' } }]);
    liste.h.drop(auf(nutzlast('komp'), null));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log.splice(0)[0], ['post', '/presets/anwenden', { id: 'werk:komp/x', ziel: { art: 'insert_neu', strang_id: 'master' } }]);
    liste.h.drop(auf(nutzlast('eq'), stufe));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log.splice(0), [['melde', 'This preset belongs to another device than the target', true]], 'an eq preset on a compressor stage is refused before any request');
    // negative control: a clip drag over the stage is not taken
    const clip = ev({ sha: 'a'.repeat(64) }); clip.dataTransfer.types = ['application/x-djk-clip'];
    const klar = { ...clip, target: { closest: () => zeile } };
    liste.h.dragover(klar);
    assert.equal(klar.verhindert, undefined, 'a clip over a strip row is not accepted');
    const preset = auf(nutzlast('komp'), null);
    liste.h.dragover(preset);
    assert.equal(preset.verhindert, true, 'positive control: the same event shape with a preset is accepted');
  } finally { globalThis.document = alt; }
});

// ---- T7.3 SAVE CURRENT targets of the open project ----
test('T7.3 speicherZiele: the tracks and stages that carry a device the panel can save, as targets of POST /presets/von_ziel', async () => {
  const { speicherZiele } = await import(PZ);
  const p = presetProjekt();
  assert.deepEqual(speicherZiele(p, 'rb338'), [{ wert: 'spur:s2', text: 'Track 2 Bass', ziel: { art: 'spur', spur_id: 's2' } }]);
  assert.deepEqual(speicherZiele(p, 'baukasten'), [{ wert: 'spur:s3', text: 'Track 3 Lead (juno-pad)', ziel: { art: 'spur', spur_id: 's3' } }]);
  assert.deepEqual(speicherZiele(p, 'komp'), [
    { wert: 'insert:i1', text: 'Drums, compressor 1', ziel: { art: 'insert', insert_id: 'i1' } },
    { wert: 'insert:i2', text: 'Master, compressor 1', ziel: { art: 'insert', insert_id: 'i2' } }]);
  for (const g of ['eq', 'hall', 'saett', 'gate', 'kanal-limiter', '', undefined]) assert.deepEqual(speicherZiele(p, g), [], `${g}: nothing the server can read from a project`);
  assert.deepEqual(speicherZiele(null, 'komp'), [], 'no project open');
  assert.deepEqual(speicherZiele(neuesProjekt('E'), 'rb338'), [], 'negative control: a project without such a device has no target');
});

// ---- T7.3 wiring: the mode switch builds the PRESETS panel, the production host feeds it ----
test('T7.3 browserwahl: choosing PRESETS (or opening PRODUCTION in that mode) asks app.js to build the panel; other modes and a hidden view do not', async () => {
  const { bindeBrowserwahl } = await import('../oeffentlich/produktion/browserwahl.js');
  const wurzel = { innerHTML: '', h: {}, addEventListener(n, f) { this.h[n] = f; } };
  const alt = globalThis.document;
  const b = koerper();
  globalThis.document = { getElementById: () => wurzel, body: b };
  try {
    let n = 0;
    let k = 0;
    const ctx = { st: { sichtbar: true }, beimSichtwechsel: [], presetsZeigen: () => { n++; }, kollektionenZeigen: () => { k++; } };
    bindeBrowserwahl(ctx, speicher({ 'djk-prod-browser': 'geraete' }));
    assert.equal(n, 0, 'DEVICES: no panel');
    const klick = (m) => wurzel.h.click({ target: { closest: () => ({ dataset: { browserModus: m }, disabled: false }) } });
    klick('presets');
    assert.deepEqual([n, b.k.has('b-presets')], [1, true]);
    klick('kollektionen');
    assert.deepEqual([n, b.k.has('b-kollektionen'), k], [1, true, 1], 'U8: COLLECTIONS asks app.js-side binder to load the collections, not the presets panel');
    klick('presets');
    ctx.st.sichtbar = false; ctx.beimSichtwechsel[0](false);
    assert.equal(n, 2, 'a hidden PRODUCTION builds nothing');
    ctx.st.sichtbar = true; ctx.beimSichtwechsel[0](true);
    assert.equal(n, 3, 'opening PRODUCTION in PRESETS mode builds the panel');
    // the mode is kept: a reload in PRESETS mode comes back to it
    const ctx2 = { st: { sichtbar: true }, beimSichtwechsel: [], presetsZeigen: () => { n++; } };
    bindeBrowserwahl(ctx2, speicher({ 'djk-prod-browser': 'presets' }));
    assert.equal(n, 4);
  } finally { globalThis.document = alt; }
});

test('T7.3 preset host: save targets follow the open project; the panel is redrawn only when they change', async () => {
  const { bindePresetHost } = await import('../oeffentlich/produktion/preset_host.js');
  const { PresetPanel } = await import('../oeffentlich/presets.js');
  const ctx = { st: { projekt: presetProjekt() }, beimProjekt: [], beimSichtwechsel: [], presetsNeu: () => {} };
  bindePresetHost(ctx);
  const h = ctx.presetHost;
  assert.deepEqual([h.ziehbar(), h.aktuell('komp'), h.kannAnwenden('komp')], [true, null, false]);
  assert.equal(h.ziele('komp').length, 2);
  assert.equal((await h.anwenden()).ok, false);
  assert.equal(ctx.beimProjekt.length + ctx.beimSichtwechsel.length, 2, 'both hooks are registered');
  // the panel redraws only when what it shows of the host changed
  const w = { innerHTML: '', addEventListener() {}, querySelector: () => null };
  let draw = 0;
  const panel = new PresetPanel(w, { ...h, holen: async () => ({ code: 404, j: {} }) });
  panel.z.filter.geraet = 'komp';
  const zeige = panel.zeige.bind(panel); panel.zeige = () => { draw++; zeige(); };
  panel.zeige();
  assert.equal(draw, 1);
  assert.equal(panel.aktualisiereZiele(), false, 'same targets: no redraw'); assert.equal(draw, 1);
  ctx.st.projekt = fuehreListeAus(ctx.st.projekt, [{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp' }]).projekt;
  assert.equal(panel.aktualisiereZiele(), true, 'a new compressor stage is a new target'); assert.equal(draw, 2);
  assert.equal(panel.aktualisiereZiele(), false); assert.equal(draw, 2);
});

// ---- T7.4 origin mark: preset name, and "modified" when the values differ from the mapped preset values (the plan, no write) ----
const PM = '../oeffentlich/produktion/preset_marke.js';
// a project whose compressor stage on Drums (i1) and whose rb338 track (s2) were set by a preset
function markeProjekt() {
  let p = presetProjekt();
  p = JSON.parse(JSON.stringify(p));
  p.spuren[0].inserts[0].preset = 'werk:komp/drum-bus';
  p.spuren[0].inserts[0].werte = { ...p.spuren[0].inserts[0].werte, schwelle: -18, ratio: 4 };
  p.spuren[1].geraet = { art: 'intern', name: 'rb338', parameter: { cutoff: 0.4, res: 0.2 }, preset: 'werk:rb338/classic-acid' };
  return p;
}
const PLAN_KOMP = (werte) => ({ status: 200, j: { weg: 'proj', befehle: [{ befehl: 'insert_werte_setzen', insert_id: 'i1', werte, preset: 'werk:komp/drum-bus' }], label: 'Preset Drum Bus', uebersprungen: [] } });
const PLAN_RB = (parameter) => ({ status: 200, j: { weg: 'proj', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'intern', name: 'rb338', parameter, preset: 'werk:rb338/classic-acid' } }], label: 'Preset Classic Acid', uebersprungen: [] } });

test('T7.4 markenZiele: only a stage or an instrument track with a preset is a target; a project without any preset has none', async () => {
  const { markenZiele } = await import(PM);
  const z = markenZiele(markeProjekt());
  assert.deepEqual(z.map((x) => [x.schluessel, x.preset, x.ziel]), [
    ['insert:i1', 'werk:komp/drum-bus', { art: 'insert', insert_id: 'i1' }],
    ['spur:s2', 'werk:rb338/classic-acid', { art: 'spur', spur_id: 's2' }]]);
  assert.deepEqual(markenZiele(presetProjekt()), [], 'negative control: no preset field anywhere');
  assert.deepEqual(markenZiele(null), []);
  const q = markeProjekt(); q.spuren[1].geraet.preset = 'kaputt';
  assert.deepEqual(markenZiele(q).map((x) => x.schluessel), ['insert:i1'], 'a malformed id is no mark');
});

test('T7.4 istGeaendert: current values against the plan; equal -> not modified; one value, a missing key, an extra key -> modified', async () => {
  const { markenZiele, istGeaendert, markeText } = await import(PM);
  const [ins, spur] = markenZiele(markeProjekt());
  assert.equal(istGeaendert(ins, PLAN_KOMP({ schwelle: -18, ratio: 4 }).j), false, 'equal values: no mark of change');
  assert.equal(istGeaendert(ins, PLAN_KOMP({ schwelle: -18, ratio: 4.5 }).j), true);
  assert.equal(istGeaendert(ins, PLAN_KOMP({ schwelle: -18, ratio: 4 + 1e-12 }).j), false, 'float noise below 1e-9 is not a change');
  assert.equal(istGeaendert(ins, PLAN_KOMP({ schwelle: -18, ratio: 4, knie: 6 }).j), false, 'a mapped row at the stage default (knee 6) equals');
  assert.equal(istGeaendert(ins, PLAN_KOMP({ schwelle: -18, ratio: 4, knie: 7 }).j), true, 'a mapped row with another value');
  assert.equal(istGeaendert({ ...ins, ist: { schwelle: -18 } }, PLAN_KOMP({ schwelle: -18, ratio: 4 }).j), true, 'a mapped row the stage does not have');
  assert.equal(istGeaendert(ins, PLAN_KOMP({}).j), false, 'an empty mapping changes nothing');
  assert.equal(istGeaendert(spur, PLAN_RB({ cutoff: 0.4, res: 0.2 }).j), false);
  assert.equal(istGeaendert(spur, PLAN_RB({ cutoff: 0.5, res: 0.2 }).j), true);
  assert.equal(istGeaendert(spur, PLAN_RB({ cutoff: 0.4, res: 0.2, decay: 0.1 }).j), true);
  assert.equal(istGeaendert(spur, { weg: 'regler' }), null, 'not a project plan: cannot compare');
  assert.equal(markeText('Drum Bus', false), 'Drum Bus');
  assert.equal(markeText('Drum Bus', true), 'Drum Bus · modified');
});

test('T7.4 binder: name and modified from the plan and the preset file; cached per state; a deleted preset or a refused plan clears the mark; no preset, no request', async () => {
  const { bindePresetMarken } = await import(PM);
  const log = [];
  let plan = { i1: PLAN_KOMP({ schwelle: -18, ratio: 4 }), s2: PLAN_RB({ cutoff: 0.4, res: 0.2 }) };
  let preset = { status: 200, j: { name: 'Drum Bus' } };
  const ctx = { st: { projekt: markeProjekt() }, beimProjekt: [], beimMarken: [], antwortText: () => '',
    holeJson: async (weg, k) => { log.push(['plan', k.id]); return plan[k.ziel.insert_id ?? k.ziel.spur_id]; },
    holeGet: async (weg) => { log.push(['get', weg]); return weg.includes('classic-acid') ? { status: 200, j: { name: 'Classic Acid' } } : preset; } };
  let neu = 0; ctx.beimMarken.push(() => { neu++; });
  bindePresetMarken(ctx, { verzoegerung: 0 });
  const lauf = async () => { ctx.beimProjekt[0](ctx.st.projekt); await new Promise((r) => setTimeout(r, 15)); };
  await lauf();
  assert.deepEqual(ctx.presetMarke('insert', 'i1'), { text: 'Drum Bus', geaendert: false, titel: 'Preset: Drum Bus' });
  assert.deepEqual(ctx.presetMarke('spur', 's2'), { text: 'Classic Acid', geaendert: false, titel: 'Preset: Classic Acid' });
  assert.equal(ctx.presetMarke('insert', 'i9'), null);
  assert.deepEqual(log.map((x) => x[0]).sort(), ['get', 'get', 'plan', 'plan']);
  assert.ok(log.some((x) => x[1] === '/presets/werk/komp/drum-bus'), 'the preset file is read by its page path');
  assert.equal(neu, 1, 'the views were told once');
  // the same state again: nothing is asked
  log.length = 0; await lauf();
  assert.deepEqual(log, [], 'cached per target state');
  // a value of the stage changes: asked again, now modified
  ctx.st.projekt = JSON.parse(JSON.stringify(ctx.st.projekt)); ctx.st.projekt.spuren[0].inserts[0].werte.ratio = 6;
  await lauf();
  assert.equal(ctx.presetMarke('insert', 'i1').text, 'Drum Bus · modified');
  assert.equal(ctx.presetMarke('insert', 'i1').geaendert, true);
  assert.equal(ctx.presetMarke('spur', 's2').geaendert, false, 'the other target is untouched');
  assert.equal(log.filter((x) => x[0] === 'plan').length, 1, 'only the changed target is asked again');
  // set back by hand: the mark of change goes
  ctx.st.projekt = JSON.parse(JSON.stringify(ctx.st.projekt)); ctx.st.projekt.spuren[0].inserts[0].werte.ratio = 4;
  await lauf();
  assert.equal(ctx.presetMarke('insert', 'i1').geaendert, false);
  // the preset file is gone (404): the mark is cleared, nothing else
  preset = { status: 404, j: { fehler: 'nicht_gefunden' } };
  ctx.st.projekt = JSON.parse(JSON.stringify(ctx.st.projekt)); ctx.st.projekt.spuren[0].inserts[0].werte.ratio = 5;
  await lauf();
  assert.equal(ctx.presetMarke('insert', 'i1'), null, 'a deleted preset only clears the mark');
  assert.equal(ctx.presetMarke('spur', 's2').text, 'Classic Acid');
  // a refused plan (e.g. the stage is no compressor any more) clears it too
  plan = { ...plan, s2: { status: 409, j: { fehler: 'geraet_passt_nicht', text: 'x' } } };
  ctx.st.projekt = JSON.parse(JSON.stringify(ctx.st.projekt)); ctx.st.projekt.spuren[1].geraet.parameter.cutoff = 0.9;
  await lauf();
  assert.equal(ctx.presetMarke('spur', 's2'), null);
  // a target that is gone loses its mark; a project without presets asks nothing
  ctx.st.projekt = presetProjekt(); log.length = 0;
  await lauf();
  assert.equal(ctx.presetMarke('insert', 'i1'), null);
  assert.deepEqual(log, [], 'negative control: no preset in the project, no request');
});

// ---- U7 review finding R1: a preset renamed, overwritten or deleted in the panel must not leave a stale origin mark (F8: "a changed or deleted
// preset only clears the mark"). The binder cached the answer per target state, so a mark kept the old name until the target's values changed.
test('R1 binder: presetMarkenNeu asks every marked target again (a deleted preset clears the mark, a renamed one shows the new name); without it nothing is asked', async () => {
  const { bindePresetMarken } = await import(PM);
  const log = [];
  let datei = { status: 200, j: { name: 'Drum Bus' } };
  const ctx = { st: { projekt: markeProjekt() }, beimProjekt: [], beimMarken: [],
    holeJson: async (weg, k) => { log.push(['plan', k.id]); return k.ziel.insert_id ? PLAN_KOMP({ schwelle: -18, ratio: 4 }) : PLAN_RB({ cutoff: 0.4, res: 0.2 }); },
    holeGet: async (weg) => { log.push(['get', weg]); return weg.includes('classic-acid') ? { status: 200, j: { name: 'Classic Acid' } } : datei; } };
  bindePresetMarken(ctx, { verzoegerung: 0 });
  const warte = () => new Promise((r) => setTimeout(r, 15));
  ctx.beimProjekt[0](ctx.st.projekt); await warte();
  assert.equal(ctx.presetMarke('insert', 'i1').text, 'Drum Bus');
  // negative control: the same project state again asks nothing (the cache stays for project updates)
  log.length = 0; ctx.beimProjekt[0](ctx.st.projekt); await warte();
  assert.deepEqual(log, []);
  assert.equal(typeof ctx.presetMarkenNeu, 'function', 'the binder offers a refresh for a changed preset store');
  datei = { status: 200, j: { name: 'Drum Bus Hard' } };
  ctx.presetMarkenNeu(); await warte();
  assert.equal(ctx.presetMarke('insert', 'i1').text, 'Drum Bus Hard', 'an overwritten preset shows its new name');
  assert.equal(log.filter((x) => x[0] === 'plan').length, 2, 'every marked target is asked again');
  datei = { status: 404, j: { fehler: 'unbekannt' } };
  ctx.presetMarkenNeu(); await warte();
  assert.equal(ctx.presetMarke('insert', 'i1'), null, 'a deleted preset clears the mark');
  assert.equal(ctx.presetMarke('spur', 's2').text, 'Classic Acid', 'the other mark stays');
});

test('R1 panel: a successful save, rename or delete tells the host (geaendert); a refused one does not; hostWechsel passes it to the PRODUCTION host in both views', async () => {
  const { PresetPanel, hostWechsel } = await import('../oeffentlich/presets.js');
  let n = 0, antwort = { code: 200, j: { ok: true, herkunft: 'nutzer', geraet: 'komp', slug: 'b', name: 'B' } };
  const w = { innerHTML: '', addEventListener() {}, querySelector: () => null };
  const p = new PresetPanel(w, { holen: async () => ({ code: 404, j: {} }), senden: async () => antwort, bestaetige: () => true, frage: () => 'B', geaendert: () => { n++; } });
  const eintrag = { herkunft: 'nutzer', geraet: 'komp', slug: 'a', name: 'A' };
  p.z.liste = [eintrag];
  await p.loesche('nutzer/komp/a');
  assert.equal(n, 1, 'a delete tells the host');
  p.z.liste = [eintrag];
  await p.umbenennen('nutzer/komp/a');
  assert.equal(n, 2, 'a rename tells the host');
  antwort = { code: 403, j: { fehler: 'nur_andreas_preset', text: 'no' } };
  p.z.liste = [eintrag];
  await p.loesche('nutzer/komp/a'); await p.umbenennen('nutzer/komp/a');
  assert.equal(n, 2, 'negative control: refusals change nothing, the host is not told');
  let prod = 0, dj = 0, aktiv = false;
  const h = hostWechsel({ geaendert: () => { dj++; } }, () => ({ geaendert: () => { prod++; } }), () => aktiv);
  h.geaendert(); aktiv = true; h.geaendert();
  assert.deepEqual([prod, dj], [2, 2], 'marks live in PRODUCTION; a change made in the DJ view reaches them too');
});

// ---- U8 wiring: the COLLECTIONS mode is on, the panel element and its style exist, PRODUCTION binds the panel ----
test('U8 wiring: COLLECTIONS enabled; #kollektionen in index.html with kollektionen.css; produktion.js binds bindeKollektionen and hands over the preset rows', async () => {
  assert.equal(MODUS_AKTIV.kollektionen, true);
  assert.equal(liesModus(speicher({ 'djk-prod-browser': 'kollektionen' })), 'kollektionen', 'a reload in COLLECTIONS mode comes back to it');
  const seite = fs.readFileSync(new URL('../oeffentlich/index.html', import.meta.url), 'utf8');
  assert.match(seite, /<div class="kollektionen" id="kollektionen" hidden aria-label="Collections"><\/div>/);
  assert.match(seite, /<link rel="stylesheet" href="kollektionen.css">/);
  assert.ok(fs.existsSync(new URL('../oeffentlich/kollektionen.css', import.meta.url)));
  const prod = fs.readFileSync(new URL('../oeffentlich/produktion/produktion.js', import.meta.url), 'utf8');
  assert.match(prod, /import \{ bindeKollektionen \} from '\.\.\/kollektionen\.js'/);
  assert.match(prod, /bindePresetHost, bindePresetMarken, bindeKollektionen\]/);
  assert.match(prod, /presetListe/);
  const app = fs.readFileSync(new URL('../oeffentlich/app.js', import.meta.url), 'utf8');
  assert.match(app, /presetListe: \(\) => presetPanel\?\.z\.liste \?\? \[\]/);
});
