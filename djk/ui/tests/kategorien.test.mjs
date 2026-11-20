// kategorien.json: category and one-line description of every instrument graph; served on GET /graphen entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listeGraphen, ladeKategorien, pruefeKategorien, KATEGORIE_IDS, PRINZIP_IDS } from '../graphs.ts';
import { pfadeVon } from '../devices_parameter.ts';
import { REPO } from '../paths.ts';

const P = pfadeVon(REPO);
const kat = JSON.parse(fs.readFileSync(P.kategorien, 'utf8'));

test('kategorien.json covers every instrument graph of beispiele/ and of beispiele/recipes/ with a valid category and a text of at most 90 characters', () => {
  const inst = [...listeGraphen(P.beispiele).graphen, ...listeGraphen(P.rezepte).graphen].filter((g) => g.art === 'instrument').map((g) => g.name);
  assert.ok(inst.length >= 100, `${inst.length} instrument graphs`);
  for (const n of inst) {
    assert.ok(kat[n], `${n} has no entry`);
    assert.ok(KATEGORIE_IDS.includes(kat[n].kategorie), `${n}: ${kat[n].kategorie}`);
    assert.ok(typeof kat[n].text === 'string' && kat[n].text.length > 0 && kat[n].text.length <= 90, `${n}: text length ${kat[n].text?.length}`);
    assert.ok(!kat[n].text.includes('—'), `${n}: no em dash`);
  }
  assert.deepEqual(Object.keys(kat).filter((n) => !inst.includes(n)), [], 'no entry for a graph that is not an instrument');
  assert.deepEqual(pruefeKategorien(kat).fehler, []);
});

test('GET /graphen entries carry kategorie and text for instruments from <graph folder>/panels/kategorien.json; none without the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kat-'));
  try {
    const inst = { knoten: [{ id: 'a', art: 'note' }] }, fx = { knoten: [{ id: 'e', art: 'eingang' }] };
    fs.writeFileSync(path.join(dir, 'x-inst.json'), JSON.stringify(inst));
    fs.writeFileSync(path.join(dir, 'x-fx.json'), JSON.stringify(fx));
    fs.writeFileSync(path.join(dir, 'y-inst.json'), JSON.stringify(inst));
    assert.deepEqual(listeGraphen(dir).graphen.map((g) => Object.keys(g)), [['name', 'art', 'regler_namen', 'latenz'], ['name', 'art', 'regler_namen', 'latenz'], ['name', 'art', 'regler_namen', 'latenz']]);
    fs.mkdirSync(path.join(dir, 'panels'));
    fs.writeFileSync(path.join(dir, 'panels', 'kategorien.json'), JSON.stringify({ 'x-inst': { kategorie: 'bass', text: 'A bass.' }, 'x-fx': { kategorie: 'bass', text: 'ignored for effects' }, 'y-inst': { kategorie: 'nope', text: 'bad category' } }));
    const g = Object.fromEntries(listeGraphen(dir).graphen.map((e) => [e.name, e]));
    assert.equal(g['x-inst'].kategorie, 'bass');
    assert.equal(g['x-inst'].text, 'A bass.');
    assert.equal(g['x-fx'].kategorie, undefined, 'effects have no category');
    assert.equal(g['y-inst'].kategorie, undefined, 'an invalid entry is left out');
    assert.deepEqual(Object.keys(ladeKategorien(dir)), ['x-inst', 'x-fx']);
    fs.writeFileSync(path.join(dir, 'panels', 'kategorien.json'), '{kaputt');
    assert.deepEqual(ladeKategorien(dir), {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('djk-start installs kategorien.json into the panels folder with the cmp rule', () => {
  const sh = fs.readFileSync(path.join(REPO, 'djk', 'start', 'djk-start'), 'utf8');
  assert.match(sh, /kategorien\.json/);
  assert.match(sh, /installiere "\$kat" "\$BK_ORDNER\/panels\/kategorien\.json"/);
  assert.match(sh, /cmp -s -- "\$quelle" "\$ziel" && return 0/);   // the cmp rule lives in installiere() (a test instance never overwrites: audit C23)
});

test('recipe graphs: the category follows the name prefix (bass, lead, pad, keys; pluck is keys; drums and percussion are drums; fx is textur)', () => {
  const soll = { bass: 'bass', lead: 'lead', pad: 'pad', keys: 'keys', pluck: 'keys', drums: 'drums', percussion: 'drums', fx: 'textur' };
  const namen = listeGraphen(P.rezepte).graphen.map((g) => g.name);
  assert.equal(namen.length, 46);
  for (const n of namen) assert.equal(kat[n].kategorie, soll[n.split('-')[0]], n);
});

test('djk-start installs the recipe graphs of demos/recipes/ (MANIFEST.json) under their own names with the cmp rule', () => {
  const sh = fs.readFileSync(path.join(REPO, 'djk', 'start', 'djk-start'), 'utf8');
  assert.match(sh, /demos\/recipes/);
  assert.match(sh, /MANIFEST\.json/);
  assert.match(sh, /installiere "\$quelle" "\$BK_ORDNER\/\$g\.json"/);
});

// ---- prinzip: the synthesis type of an instrument (the picker groups by it as well as by role) ----

// The decided values of the 63 instrument demos (57 of the picker plan plus amiga, the three chip voices of the tracker work, Kraken and the Drum Synth) (plan 2026-11-18-instrument-picker-by-type, Task 1), written out so a change is a visible edit.
const DEMO_PRINZIP = {
  analog: ['bassmusik', 'diode-acid-bass', 'diode-goa-linie', 'ms20-bass', 'ms20-goa-lead', 'goa-blubber-lead', 'roehre-lead', 'saege-ladder', 'lead', 'hartsync-bass',
    'hartsync-lead', 'hartsync-pad', 'juno-pad', 'juno-pad-dyn', 'juno-pad-echo', 'juno-pad-hall', 'sem-pad', 'sem-house-akkord', 'synth-mono', 'synth-poly', 'synth-neuro', 'synth-kraken',
    'formant-neuro-bass', 'mseg-neuro-bass', 'falter-demo', 'chip-puls', 'chip-dreieck', 'chip-rauschen'],
  wavetable: ['wavetable-chor', 'wavetable-reese', 'wavetable-supersaw', 'synth-greif', 'synth-greif2', 'bass-banddrive'],
  fm: ['fm-bass', 'fm-epiano', 'fm-glocke', 'fm-lead'],
  physik: ['saite', 'saite-gitarre', 'saite-harfe', 'saite-klavier', 'saite-karplus', 'resonator-glocke', 'resonator-marimba', 'resonator-metall', 'kamm-goa-zupf'],
  granular: ['granular-pad', 'granular-textur', 'granular-drone'],
  sampler: ['sampler-fairlight', 'amiga'],
  drums: ['drums-808', 'drums-909', 'drum-synth', 'kick-synth', 'gated-hall-snare', 'metall-hihat', 'metall-crash', 'metall-ride', 'resonator-conga'],
  feedback: ['labor', 'rueckkopplung'],
};

test('PRINZIP_IDS lists the eight synthesis types', () => {
  assert.deepEqual([...PRINZIP_IDS], ['analog', 'wavetable', 'fm', 'physik', 'granular', 'sampler', 'drums', 'feedback']);
});

test('every instrument graph of beispiele/ and beispiele/recipes/ has a prinzip from PRINZIP_IDS, and a clean kategorien.json reports no error', () => {
  const inst = [...listeGraphen(P.beispiele).graphen, ...listeGraphen(P.rezepte).graphen].filter((g) => g.art === 'instrument').map((g) => g.name);
  for (const n of inst) assert.ok(PRINZIP_IDS.includes(kat[n].prinzip), `${n}: prinzip ${kat[n].prinzip}`);
  assert.deepEqual(pruefeKategorien(kat).fehler, []);
});

test('the 63 demo instruments carry the decided prinzip values', () => {
  const soll = Object.fromEntries(Object.entries(DEMO_PRINZIP).flatMap(([p, namen]) => namen.map((n) => [n, p])));
  assert.equal(Object.keys(soll).length, 63);
  const demos = listeGraphen(P.beispiele).graphen.filter((g) => g.art === 'instrument').map((g) => g.name).sort();
  assert.deepEqual(demos, Object.keys(soll).sort(), 'the table covers exactly the demo instruments');
  for (const n of demos) assert.equal(kat[n].prinzip, soll[n], n);
});

test('recipe graphs: drums category is drums, a wavetable node is wavetable, the rest is analog; bass-fm and lead-fm (FM from sine operators) are decided fm by hand', () => {
  const fest = { 'bass-fm': 'fm', 'lead-fm': 'fm' };
  const quellen = new Set(['fm', 'granular', 'sampler', 'saite', 'resonator', 'kamm']);
  for (const g of listeGraphen(P.rezepte).graphen) {
    const arten = new Set(JSON.parse(fs.readFileSync(path.join(P.rezepte, `${g.name}.json`), 'utf8')).knoten.map((k) => k.art));
    assert.ok(![...arten].some((a) => quellen.has(a)), `${g.name}: the rule of the plan has a node type this test does not cover`);
    const soll = fest[g.name] ?? (kat[g.name].kategorie === 'drums' ? 'drums' : arten.has('wavetable') ? 'wavetable' : 'analog');
    assert.equal(kat[g.name].prinzip, soll, g.name);
  }
});

test('GET /graphen entries carry prinzip; a file without it gives entries without it; an invalid one keeps the entry and reports the error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prinzip-'));
  try {
    const inst = { knoten: [{ id: 'a', art: 'note' }] }, fx = { knoten: [{ id: 'e', art: 'eingang' }] };
    for (const n of ['a-inst', 'b-inst', 'c-inst', 'smp-x', 'ton-x-1', 'ins-x', 'u-sonst']) fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify(inst));
    fs.writeFileSync(path.join(dir, 'fx-x.json'), JSON.stringify(fx));
    fs.mkdirSync(path.join(dir, 'panels'));
    const schreibe = (o) => fs.writeFileSync(path.join(dir, 'panels', 'kategorien.json'), JSON.stringify(o));
    schreibe({ 'a-inst': { kategorie: 'bass', prinzip: 'fm', text: 'A.' }, 'b-inst': { kategorie: 'lead', text: 'Old install, no prinzip.' }, 'c-inst': { kategorie: 'pad', prinzip: 'laser', text: 'Bad prinzip.' }, 'fx-x': { kategorie: 'bass', prinzip: 'fm', text: 'ignored' } });
    const g = Object.fromEntries(listeGraphen(dir).graphen.map((e) => [e.name, e]));
    assert.equal(g['a-inst'].prinzip, 'fm');
    assert.equal(g['b-inst'].prinzip, undefined);
    assert.equal(g['b-inst'].kategorie, 'lead', 'the old entry still loads');
    assert.ok(!('prinzip' in g['b-inst']), 'no key without a value');
    assert.equal(g['c-inst'].prinzip, undefined, 'an invalid prinzip is dropped');
    assert.equal(g['c-inst'].kategorie, 'pad', 'but the entry stays');
    assert.equal(g['c-inst'].text, 'Bad prinzip.');
    assert.equal(g['fx-x'].prinzip, undefined, 'effects have none');
    assert.equal(g['u-sonst'].prinzip, undefined, 'a graph without any entry has none (the page files it under Other)');
    for (const n of ['smp-x', 'ton-x-1', 'ins-x']) assert.equal(g[n].prinzip, 'sampler', n);
    const k = ladeKategorien(dir);
    assert.deepEqual(Object.keys(k).sort(), ['a-inst', 'b-inst', 'c-inst', 'fx-x']);
    assert.equal(k['c-inst'].prinzip, undefined);
    assert.deepEqual(pruefeKategorien({ 'c-inst': { kategorie: 'pad', prinzip: 'laser', text: 'x.' } }).fehler, [`c-inst: prinzip must be one of ${PRINZIP_IDS.join(', ')}`]);
    assert.deepEqual(pruefeKategorien({ 'b-inst': { kategorie: 'lead', text: 'x.' } }).fehler, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verborgen: optional flag; true is carried, false or absent is not hidden, a non-boolean keeps the entry without the flag and reports', () => {
  const e = (extra) => ({ kategorie: 'lead', text: 'x.', ...extra });
  const r = pruefeKategorien({ a: e({ verborgen: true }), b: e({ verborgen: false }), c: e({}), d: e({ verborgen: 'yes' }), f: e({ verborgen: 1 }) });
  assert.equal(r.gueltig.a.verborgen, true);
  for (const n of ['b', 'c', 'd', 'f']) assert.ok(!('verborgen' in r.gueltig[n]), n);
  assert.deepEqual(r.fehler, ['d: verborgen must be true or false', 'f: verborgen must be true or false']);
  assert.ok(r.gueltig.d && r.gueltig.f, 'the entries stay');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verborgen-'));
  try {
    for (const n of ['h-inst', 'v-inst']) fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify({ knoten: [{ id: 'a', art: 'note' }] }));
    fs.mkdirSync(path.join(dir, 'panels'));
    fs.writeFileSync(path.join(dir, 'panels', 'kategorien.json'), JSON.stringify({ 'h-inst': e({ verborgen: true }), 'v-inst': e({}) }));
    const g = Object.fromEntries(listeGraphen(dir).graphen.map((x) => [x.name, x]));
    assert.equal(g['h-inst'].verborgen, true);
    assert.ok(!('verborgen' in g['v-inst']));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('kategorien.json hides exactly the five duplicates and nothing else', () => {
  const versteckt = Object.entries(kat).filter(([, v]) => v.verborgen !== undefined).map(([n, v]) => [n, v.verborgen]);
  assert.deepEqual(versteckt.sort(), ['juno-pad-dyn', 'juno-pad-echo', 'juno-pad-hall', 'lead', 'synth-greif2'].map((n) => [n, true]));
  assert.deepEqual(pruefeKategorien(kat).fehler, []);
});
