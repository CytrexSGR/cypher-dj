// One search across the shelf (media browser B4): the engine of GET /suche (suche.ts) and its route (areas/suche/area.ts).
// The engine gets its sources injected, the catalogue source runs on a fixture catalogue; no server, no port, nothing of the owner's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARTEN, JE_MAX, JE_VORGABE, baueQuellen, camelotVon, suche, tempoBereiche, trifftAlle } from '../suche.ts';
import { sucheBereich } from '../areas/suche/area.ts';
import { Katalog } from '../catalog.ts';
import { baueKatalog } from './support/catalog.mjs';

const leereGruppe = () => ({ zahl: 0, treffer: [] });
const attrappen = (ueber = {}) => Object.fromEntries(ARTEN.map((a) => [a, ueber[a] ?? leereGruppe]));
const ohneRang = () => ({ tabelle: new Map(), favorit: () => false, rang: () => 1000 });
const antwort = async (b, pfad) => {   // calls the route like the router does and captures the answer
  const route = b.routen().find((r) => r.pfad === '/suche');
  let code = 0, text = '';
  await route.handler({}, { writeHead: (c) => { code = c; }, end: (t) => { text = t; } }, new URL(pfad, 'http://x'));
  return { code, j: JSON.parse(text) };
};
const bereich = (opt = {}) => sucheBereich({ log: () => {} }, { quellen: attrappen(), projekt: () => null, ...opt });

function katalogFixture(t, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-suche-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const da = path.join(dir, 'da'); fs.mkdirSync(da);
  const f = (n) => { const p = path.join(da, n); fs.writeFileSync(p, 'x'); return p; };
  const zeilen = [
    { n: 1, typ: 'oneshot', name: 'Kick 909', instrument: 'kick', pfad: f('Kick 909.wav') },
    { n: 2, typ: 'oneshot', name: 'kick_100%', instrument: 'kick', pfad: f('kick_100%.wav') },
    { n: 3, typ: 'oneshot', name: 'Snare (tight) [v2]', instrument: 'snare', pfad: f('Snare (tight) [v2].wav') },
    { n: 4, typ: 'oneshot', name: 'Kick locked', instrument: 'kick', schutz: 'ableton', pfad: f('Kick locked.wav') },
    { n: 5, typ: 'oneshot', name: 'Kick gone', instrument: 'kick', pfad: path.join(dir, 'weg', 'Kick gone.wav'), ordner: path.join(dir, 'weg') },
    { n: 11, typ: 'loop', name: 'Groove 126', bpm: 126, camelot: '8A', pack: 'Deep', pfad: f('Groove 126.wav') },
    { n: 12, typ: 'loop', name: 'Groove 64', bpm: 64, camelot: '8A', pack: 'Deep', pfad: f('Groove 64.wav') },
    { n: 13, typ: 'loop', name: 'Groove 250', bpm: 250, camelot: '3B', pack: 'Deep', pfad: f('Groove 250.wav') },
    { n: 14, typ: 'loop', name: 'Groove 140', bpm: 140, camelot: '8A', pack: 'Deep', pfad: f('Groove 140.wav') },
    { n: 15, typ: 'loop', name: 'Groove none', bpm: null, camelot: null, pack: 'Deep', pfad: f('Groove none.wav') },
    { n: 16, typ: 'loop', name: 'Groove 128 far key', bpm: 128, camelot: '3B', pack: 'Deep', pfad: f('Groove 128 far key.wav') },
    { n: 17, typ: 'loop', name: 'Groove 124 next key', bpm: 124, camelot: '9A', pack: 'Deep', pfad: f('Groove 124 next key.wav') },
    ...extra,
  ];
  return { datei: baueKatalog(path.join(dir, 'kat'), zeilen), dir };
}
const katalogQuellen = (datei, ueber = {}) => baueQuellen({
  katalog: new Katalog(datei), fehlend: () => [], rang: ohneRang, zeile: (z, favorit) => ({ sha: z.sha, name: z.name, bpm: z.bpm, camelot: z.camelot, favorit }),
  graphen: () => [], instrumente: () => [], schnitte: () => [], presets: () => [], module: () => [], ...ueber,
});
const namen = (g) => g.treffer.map((x) => x.name);

test('the answer carries every asked kind in the fixed order, with the total and at most je hits', async () => {
  const viele = (n) => ({ zahl: n, treffer: Array.from({ length: n }, (_, i) => ({ name: `x${i}` })) });
  const r = await suche(attrappen({ samples: (a) => ({ zahl: 12, treffer: viele(12).treffer.slice(0, a.je) }) }), { q: 'x', je: JE_VORGABE, passt: null }, ['module', 'samples']);
  assert.equal(r.q, 'x');
  assert.deepEqual(r.gruppen.map((g) => g.art), ['samples', 'module'], 'canonical order, not the order of the request');
  assert.equal(r.gruppen[0].zahl, 12);
  assert.equal(r.gruppen[0].treffer.length, 5, 'default 5');
  assert.equal(typeof r.gruppen[0].name, 'string');
  assert.equal(JE_VORGABE, 5); assert.equal(JE_MAX, 50);
});

test('a source that throws gives an empty group with fehler; the other groups still answer', async () => {
  const q = attrappen({ presets: () => { throw new Error('boom'); }, module: async () => { throw new Error('async boom'); }, geraete: () => ({ zahl: 1, treffer: [{ name: 'Hall' }] }) });
  const r = await suche(q, { q: 'a', je: 5, passt: null }, [...ARTEN]);
  assert.equal(r.gruppen.length, ARTEN.length);
  for (const art of ['presets', 'module']) {
    const g = r.gruppen.find((x) => x.art === art);
    assert.deepEqual([g.zahl, g.treffer], [0, []]);
    assert.equal(typeof g.fehler, 'string'); assert.ok(g.fehler.length > 0);
    assert.ok(!g.fehler.includes('boom'), 'the message of an internal error is not handed out');
  }
  assert.deepEqual(namen(r.gruppen.find((x) => x.art === 'geraete')), ['Hall']);
  assert.equal(r.gruppen.find((x) => x.art === 'geraete').fehler, undefined);
});

test('the catalogue file is missing: samples and loops carry fehler katalog_fehlt, the small lists answer', async () => {
  const q = katalogQuellen('/nonexistent/djk-suche/katalog.sqlite', { graphen: () => [{ name: 'hall', art: 'effekt' }] });
  const r = await suche(q, { q: 'hall', je: 5, passt: null }, [...ARTEN]);
  for (const art of ['samples', 'loops']) assert.equal(r.gruppen.find((g) => g.art === art).fehler, 'katalog_fehlt');
  assert.deepEqual(namen(r.gruppen.find((g) => g.art === 'geraete')), ['hall']);
});

test('characters of SQL LIKE and of regular expressions are plain text: no error, no false hits', async (t) => {
  const { datei } = katalogFixture(t);
  const lokal = (n) => ({ name: n, art: 'effekt' });
  const q = katalogQuellen(datei, {
    graphen: () => [lokal('a%b'), lokal('a_b'), lokal('(x'), lokal('[y'), lokal('axb'), lokal('a.b')],
    presets: (w) => (w === 'x' ? [] : []), module: () => [], schnitte: () => [{ id: 's1', name: 'cut [1]' }, { id: 's2', name: 'cut 1' }], instrumente: () => [{ id: 'i1', name: 'a_b' }],
  });
  const frage = async (text) => suche(q, { q: text, je: 5, passt: null }, [...ARTEN]);
  for (const text of ['%', '_', '(', '[', '\\', '.*', '[a-', '"', "'", '*', '100%', 'kick_']) {
    const r = await frage(text);
    assert.equal(r.gruppen.filter((g) => g.fehler !== undefined).length, 0, `no group fails for ${JSON.stringify(text)}: ${JSON.stringify(r.gruppen.map((g) => g.fehler))}`);
  }
  assert.deepEqual(namen((await frage('%')).gruppen.find((g) => g.art === 'geraete')), ['a%b'], '% is a character, not a wildcard');
  assert.deepEqual(namen((await frage('_')).gruppen.find((g) => g.art === 'geraete')), ['a_b']);
  assert.deepEqual(namen((await frage('(')).gruppen.find((g) => g.art === 'geraete')), ['(x']);
  assert.deepEqual(namen((await frage('[')).gruppen.find((g) => g.art === 'geraete')), ['[y']);
  assert.deepEqual(namen((await frage('a.b')).gruppen.find((g) => g.art === 'geraete')), ['a.b'], '. is not a regular expression wildcard');
  assert.deepEqual((await frage('[1]')).gruppen.find((g) => g.art === 'schnitte').treffer.map((x) => x.id), ['s1']);
  assert.equal((await frage('%')).gruppen.find((g) => g.art === 'samples').zahl, 0, 'a catalogue query of only symbols finds nothing instead of everything');
  assert.equal((await frage('_')).gruppen.find((g) => g.art === 'loops').zahl, 0);
  assert.deepEqual(namen((await frage('100%')).gruppen.find((g) => g.art === 'samples')), ['kick_100%'], 'a symbol next to letters still searches the catalogue');
});

test('every word must match, ignoring case', async () => {
  assert.equal(trifftAlle('Kick Drum Hall', ['kick', 'hall']), true);
  assert.equal(trifftAlle('Kick Drum', ['kick', 'hall']), false);
  const q = attrappen({ schnitte: undefined });
  const r = await suche(baueQuellen({ ...katalogQuellenDeps(), schnitte: () => [{ id: 'a', name: 'Big KICK loop' }, { id: 'b', name: 'kick only' }] }), { q: 'LOOP kick', je: 5, passt: null }, ['schnitte']);
  assert.deepEqual(r.gruppen[0].treffer.map((x) => x.id), ['a']);
  void q;
});
function katalogQuellenDeps() {
  return { katalog: new Katalog('/nonexistent'), fehlend: () => [], rang: ohneRang, zeile: (z) => z, graphen: () => [], instrumente: () => [], schnitte: () => [], presets: () => [], module: () => [] };
}

test('the catalogue source: unprotected rows only, reachable first, total counts all, at most je hits', async (t) => {
  const { datei, dir } = katalogFixture(t);
  const q = katalogQuellen(datei, { fehlend: () => [path.join(dir, 'weg')] });
  const g = (await suche(q, { q: 'kick', je: 2, passt: null }, ['samples'])).gruppen[0];
  assert.equal(g.fehler, undefined);
  assert.equal(g.zahl, 3, 'Kick 909, kick_100% and Kick gone; the protected one is never counted');
  assert.equal(g.treffer.length, 2);
  assert.ok(!namen(g).includes('Kick locked') && !namen(g).includes('Kick gone'), 'the unreachable file comes last');
  const alle = (await suche(q, { q: 'kick', je: 50, passt: null }, ['samples'])).gruppen[0];
  assert.deepEqual(namen(alle).at(-1), 'Kick gone');
});

test('a hit is the row of the shelf: the same fields as GET /stoebern gives (the server builds them)', async (t) => {
  const { datei } = katalogFixture(t);
  const q = katalogQuellen(datei, { zeile: (z, favorit) => ({ sha: z.sha, name: z.name, pfad_da: true, favorit }) });
  const g = (await suche(q, { q: 'snare', je: 5, passt: null }, ['samples'])).gruppen[0];
  assert.deepEqual(Object.keys(g.treffer[0]).sort(), ['favorit', 'name', 'pfad_da', 'sha']);
});

test('FITS: the tempo within 6 percent of the project tempo, of half or of double; rows without a tempo are dropped', async (t) => {
  const { datei } = katalogFixture(t);
  const q = katalogQuellen(datei);
  const mit = async (passt) => (await suche(q, { q: 'groove', je: 50, passt }, ['loops'])).gruppen[0];
  const ohne = await mit(null);
  assert.equal(ohne.zahl, 7);
  const g = await mit({ bpm: 126, camelot: null });
  assert.deepEqual(namen(g).sort(), ['Groove 126', 'Groove 124 next key', 'Groove 128 far key', 'Groove 250', 'Groove 64'].sort(), 'x1, x0.5 (64) and x2 (250); 140 and none are out');
  assert.equal(g.zahl, 5);
  assert.deepEqual(tempoBereiche(100).map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]), [[94, 106], [47, 53], [188, 212]]);
});

test('FITS with a key: equal or adjacent on the Camelot wheel; a row without a key is kept (almost no catalog loop carries one)', async (t) => {
  const { datei } = katalogFixture(t, [
    { n: 18, typ: 'loop', name: 'Groove 127 no key', bpm: 127, camelot: null, pack: 'Deep' },
    { n: 19, typ: 'loop', name: 'Groove 125 blank key', bpm: 125, camelot: '', pack: 'Deep' },
  ]);
  const q = katalogQuellen(datei);
  const g = (await suche(q, { q: 'groove', je: 50, passt: { bpm: 126, camelot: '8A' } }, ['loops'])).gruppen[0];
  assert.deepEqual(namen(g).sort(), ['Groove 124 next key', 'Groove 126', 'Groove 64', 'Groove 127 no key', 'Groove 125 blank key'].sort(),
    '3B is far from 8A (128 far key and 250 are out); rows without a key stay, rows without a tempo do not');
  assert.equal(g.zahl, 5);
});

test('FITS merges the three tempo ranges in the order of the shelf (SQLite NOCASE: ASCII folded, then by code point)', async (t) => {
  // rows without a file have no folder and sort after the reachable ones, as in the shelf; among them NOCASE puts 'b' and 'c' before 'Ä'
  const { datei } = katalogFixture(t, [
    { n: 20, typ: 'loop', name: 'Ätna 126', bpm: 126, camelot: null, pack: 'Deep' },
    { n: 21, typ: 'loop', name: 'b 63', bpm: 63, camelot: null, pack: 'Deep' },
    { n: 22, typ: 'loop', name: 'c 252', bpm: 252, camelot: null, pack: 'Deep' },
  ]);
  const q = katalogQuellen(datei);
  const fits = async (je) => namen((await suche(q, { q: 'deep', je, passt: { bpm: 126, camelot: null } }, ['loops'])).gruppen[0]);
  const ganz = ['Groove 124 next key', 'Groove 126', 'Groove 128 far key', 'Groove 250', 'Groove 64', 'b 63', 'c 252', 'Ätna 126'];
  assert.deepEqual(await fits(50), ganz);
  assert.deepEqual(await fits(7), ganz.slice(0, 7), 'the first rows of each range merge to the first rows of the whole order');
});

test('FITS drops samples without tempo and key (the one-shots carry none)', async (t) => {
  const { datei } = katalogFixture(t);
  const g = (await suche(katalogQuellen(datei), { q: 'kick', je: 5, passt: { bpm: 126, camelot: null } }, ['samples'])).gruppen[0];
  assert.equal(g.zahl, 0);
});

test('FITS leaves the small lists as they are', async () => {
  const q = baueQuellen({ ...katalogQuellenDeps(), graphen: () => [{ name: 'hall', art: 'effekt' }] });
  const g = (await suche(q, { q: 'hall', je: 5, passt: { bpm: 126, camelot: null } }, ['geraete'])).gruppen[0];
  assert.deepEqual(namen(g), ['hall']);
});

test('camelotVon: major and minor keys of the project on the wheel, other scales have none', () => {
  assert.equal(camelotVon({ grundton: 9, skala: 'minor' }), '8A');
  assert.equal(camelotVon({ grundton: 0, skala: 'major' }), '8B');
  assert.equal(camelotVon({ grundton: 8, skala: 'minor' }), '1A');
  assert.equal(camelotVon({ grundton: 11, skala: 'major' }), '1B');
  assert.equal(camelotVon({ grundton: 0, skala: 'minor' }), '5A');
  assert.equal(camelotVon({ grundton: 3, skala: 'major' }), '5B');
  assert.equal(camelotVon({ grundton: 2, skala: 'dorian' }), null);
  assert.equal(camelotVon(undefined), null);
});

test('the small lists: graphs split into instruments and devices, generated graphs stay out, presets come filtered, modules by name', async () => {
  const q = baueQuellen({ ...katalogQuellenDeps(),
    graphen: () => [{ name: 'bass-a', art: 'instrument', kategorie: 'bass', text: 'Deep' }, { name: 'hall-a', art: 'effekt' }, { name: 'ins-abc', art: 'instrument' },
      { name: 'smp-abc', art: 'instrument' }, { name: 'ton-abc-1', art: 'instrument' }],
    instrumente: () => [{ id: 'abc', name: 'Piano a', noten: 3 }],
    presets: (w) => [{ slug: 'p1', name: `preset for ${w}` }],
    module: () => [{ slug: 'm1', name: 'Alpha Mix', werkbank: true }, { slug: 'm2', name: 'Alpha Live' }, { slug: 'm3', name: 'broken alpha', fehler: 'json_kaputt' }],
  });
  const r = await suche(q, { q: 'a', je: 50, passt: null }, ['instrumente', 'geraete', 'presets', 'module']);
  const gr = (art) => r.gruppen.find((g) => g.art === art);
  assert.deepEqual(gr('instrumente').treffer.map((x) => x.name).sort(), ['Piano a', 'bass-a']);
  assert.deepEqual(namen(gr('geraete')), ['hall-a']);
  assert.equal(gr('presets').zahl, 1);
  assert.deepEqual(gr('module').treffer.map((x) => x.slug), ['m1', 'm3'], 'only workbench modules (and broken entries, like the shelf lists them)');
});

test('route: an empty or blank q is refused as argument_ungueltig', async () => {
  for (const p of ['/suche', '/suche?q=', '/suche?q=%20%20']) {
    const r = await antwort(bereich(), p);
    assert.equal(r.code, 400, p); assert.equal(r.j.fehler, 'argument_ungueltig'); assert.equal(typeof r.j.text, 'string');
  }
});

test('route: arten, je and passt are checked; je above 50 is 50', async () => {
  const b = bereich();
  for (const p of ['/suche?q=a&arten=samples,nope', '/suche?q=a&je=0', '/suche?q=a&je=x', '/suche?q=a&je=1.5', '/suche?q=a&passt=2', '/suche?q=a&passt=']) {
    const r = await antwort(b, p);
    assert.equal(r.code, 400, p); assert.equal(r.j.fehler, 'argument_ungueltig', p);
  }
  let gesehen = null;
  const b2 = bereich({ quellen: attrappen({ geraete: (a) => { gesehen = a; return leereGruppe(); } }) });
  const r = await antwort(b2, '/suche?q=Hall%20X&arten=geraete&je=999');
  assert.equal(r.code, 200); assert.equal(gesehen.je, 50);
  assert.deepEqual(r.j.gruppen.map((g) => g.art), ['geraete']);
  assert.equal(r.j.q, 'Hall X');
  const alle = await antwort(b2, '/suche?q=a');
  assert.deepEqual(alle.j.gruppen.map((g) => g.art), [...ARTEN]);
  assert.equal(gesehen.je, 5);
});

test('route: passt=1 uses the open project (tempo and Camelot key); without a project it is not applied and the answer says so', async () => {
  let gesehen = null;
  const quellen = attrappen({ loops: (a) => { gesehen = a.passt; return leereGruppe(); } });
  const mit = bereich({ quellen, projekt: () => ({ tempo_bpm: 120, tonart: { grundton: 9, skala: 'minor' } }) });
  const r = await antwort(mit, '/suche?q=a&arten=loops&passt=1');
  assert.deepEqual(gesehen, { bpm: 120, camelot: '8A' });
  assert.deepEqual(r.j.passt, { bpm: 120, camelot: '8A' });
  const ohneTon = bereich({ quellen, projekt: () => ({ tempo_bpm: 100 }) });
  assert.deepEqual((await antwort(ohneTon, '/suche?q=a&arten=loops&passt=1')).j.passt, { bpm: 100, camelot: null });
  gesehen = 'unset';
  const keins = await antwort(bereich({ quellen }), '/suche?q=a&arten=loops&passt=1');
  assert.equal(gesehen, null); assert.equal(keins.j.passt, null);
  const aus = await antwort(mit, '/suche?q=a&arten=loops&passt=0');
  assert.equal(aus.j.passt, null);
});

test('route: the answer is never a failed search because one source failed', async () => {
  const b = bereich({ quellen: attrappen({ samples: () => { throw new Error('x'); } }) });
  const r = await antwort(b, '/suche?q=a');
  assert.equal(r.code, 200);
  assert.equal(r.j.gruppen.find((g) => g.art === 'samples').fehler.length > 0, true);
});
