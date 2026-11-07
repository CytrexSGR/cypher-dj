// Preset register over the preset store: rebuild, drift detection (missing, orphaned, duplicate, changed, invalid), query, tool
// schema, command line (presets/ENTSCHEIDUNGEN.md P-R*). Works on a copy of tests/fixtures/presets/register in a temp folder; that
// copy is a real store layout (<herkunft root>/<geraet>/<slug>.preset.json). One test runs the drift checks against a deliberately
// broken implementation and requires them to fail there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ladeVokabular } from '../presets/vokabular.ts';
import { PresetSpeicher } from '../presets/speicher.ts';
import { bauen, pruefe, frage, frageSchema, pruefeAnfrage, liesRegister, schreibeRegister, FrageFehler } from '../presets/register.ts';
import { GERAET_IDS } from '../presets/geraete.ts';
import { hauptprogramm } from '../presets/werkzeug.ts';

const vok = ladeVokabular();
const FIX = path.join(import.meta.dirname, 'fixtures', 'presets', 'register');
function kopie(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-r-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.cpSync(FIX, d, { recursive: true });
  const werk = path.join(d, 'werk'), nutzer = path.join(d, 'nutzer');
  return { d, werk, nutzer, s: new PresetSpeicher({ werk, nutzer, vok }) };
}
const aendere = (f, fn) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); fn(j); fs.writeFileSync(f, JSON.stringify(j)); };

test('rebuild: exactly what the store holds, stable ids from origin, device and slug, description fields, hashes, sorted', (t) => {
  const { s, werk } = kopie(t);
  const { register, ungueltig, doppelt } = bauen(s);
  assert.deepEqual(register.eintraege.map((e) => e.id), ['nutzer:baukasten/mein-lead', 'nutzer:rb338/acid-kopie', 'werk:baukasten/warm-pad', 'werk:hall/big-hall', 'werk:rb338/acid-bass']);
  assert.deepEqual(register.eintraege.map((e) => `${e.herkunft}/${e.geraet}/${e.slug}`), s.liste().map((e) => `${e.herkunft}/${e.geraet}/${e.slug}`).sort());
  assert.deepEqual(ungueltig, []);
  assert.deepEqual(register.vokabular, { version: vok.version, pruefsumme: vok.pruefsumme });
  const h = register.eintraege.find((e) => e.id === 'werk:hall/big-hall');
  assert.deepEqual({ ...h, hash: h.hash.length, klang: h.klang.length }, {
    id: 'werk:hall/big-hall', herkunft: 'werk', geraet: 'hall', slug: 'big-hall', name: 'Big Hall', pfad: 'hall/big-hall.preset.json', tags: [], familie: 'effekt',
    art: 'reverb', unterart: 'hall', charakter: ['wide', 'wet', 'airy'], genre: ['trance', 'ambient'], einsatz: ['breakdown', 'transition'],
    energie: 2, text: 'Long bright hall tail for washing out a lead before the next drop.', hash: 64, klang: 64,
  });
  // the user copy of the acid bass has the same sound: reported, both stay in the register
  assert.deepEqual(doppelt, [{ art: 'klang', ids: ['nutzer:rb338/acid-kopie', 'werk:rb338/acid-bass'] }]);
  // same content → same register (key order and whitespace do not matter)
  const f = path.join(werk, 'baukasten', 'warm-pad.preset.json');
  fs.writeFileSync(f, JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(f, 'utf8'))).reverse())));
  assert.deepEqual(bauen(s).register, register);
  // origins: only the ones asked for, each once
  assert.deepEqual(bauen(s, ['werk']).register.eintraege.map((e) => e.herkunft), ['werk', 'werk', 'werk']);
  assert.throws(() => bauen(s, ['werk', 'werk']), /given twice/);
  assert.throws(() => bauen(s, ['plugin']), /unknown preset origin/);
});

test('rebuild: a preset with an invented tag is left out and reported, with the allowed words', (t) => {
  const { d } = kopie(t);
  const s = new PresetSpeicher({ werk: path.join(d, 'leer'), nutzer: path.join(d, 'kaputt'), vok });
  const { register, ungueltig } = bauen(s);
  assert.deepEqual(register.eintraege, []);
  assert.equal(ungueltig.length, 1);
  assert.equal(ungueltig[0].id, 'nutzer:rb338/erfundenes-wort');
  assert.deepEqual(ungueltig[0].fehler.map((e) => [e.feld, e.code, e.wert]), [['charakter', 'unbekanntes_wort', 'fat']]);
  assert.ok(ungueltig[0].fehler[0].erlaubt.includes('thick'));
});

test('rebuild: damaged files are invalid with the store reason; names the store does not accept are not presets at all', (t) => {
  const { werk, s } = kopie(t);
  const pad = path.join(werk, 'baukasten', 'warm-pad.preset.json');
  fs.copyFileSync(pad, path.join(werk, 'baukasten', 'Warm Pad.preset.json'));   // not a slug: not a preset
  fs.copyFileSync(pad, path.join(werk, 'lose.preset.json'));                       // not in a device folder
  fs.mkdirSync(path.join(werk, 'hall2'));
  fs.copyFileSync(pad, path.join(werk, 'hall2', 'falsch.preset.json'));            // unknown device folder
  fs.writeFileSync(path.join(werk, 'baukasten', 'notiz.json'), '{}');              // not a preset file
  fs.copyFileSync(pad, path.join(werk, 'hall', 'falscher-ordner.preset.json'));    // a modular preset in the hall folder
  fs.writeFileSync(path.join(werk, 'baukasten', 'kaputt.preset.json'), '{"schema": 1,');
  aendere(path.join(werk, 'hall', 'big-hall.preset.json'), (j) => { j.schema = 2; });
  aendere(path.join(werk, 'rb338', 'acid-bass.preset.json'), (j) => { j.beschreibung.art = 'compressor'; j.beschreibung.unterart = 'bus'; });
  const { ungueltig, register } = bauen(s, ['werk']);
  assert.deepEqual(ungueltig.map((u) => [u.id, u.fehler.map((e) => e.code).join()]), [
    ['werk:baukasten/kaputt', 'json_kaputt'],
    ['werk:hall/big-hall', 'schema_unbekannt'],
    ['werk:hall/falscher-ordner', 'preset_ungueltig'],
    ['werk:rb338/acid-bass', 'familie'],
  ]);
  assert.deepEqual(register.eintraege.map((e) => e.id), ['werk:baukasten/warm-pad']);
});

test('verify: a fresh register against an unchanged store is clean apart from the known duplicate sound', (t) => {
  const { s, nutzer } = kopie(t);
  const { register } = bauen(s);
  assert.deepEqual(pruefe(register, s), {
    sauber: false, fehlend: [], verwaist: [], geaendert: [], ungueltig: [], vokabular_veraltet: false,
    doppelt: [{ art: 'klang', ids: ['nutzer:rb338/acid-kopie', 'werk:rb338/acid-bass'] }],
  });
  fs.rmSync(path.join(nutzer, 'rb338', 'acid-kopie.preset.json'));
  assert.equal(pruefe(bauen(s).register, s).sauber, true);
});

// The drift scenario as one function, so the same assertions can run against a broken check below
function driftSzenario(t, pruefeFn) {
  const { s, werk, nutzer } = kopie(t);
  fs.rmSync(path.join(nutzer, 'rb338', 'acid-kopie.preset.json'));
  const { register } = bauen(s);
  fs.rmSync(path.join(werk, 'hall', 'big-hall.preset.json'));                                                                  // missing
  fs.copyFileSync(path.join(nutzer, 'baukasten', 'mein-lead.preset.json'), path.join(nutzer, 'baukasten', 'mein-lead-2.preset.json'));   // orphaned
  aendere(path.join(werk, 'rb338', 'acid-bass.preset.json'), (j) => { j.werte.cutoff = 350; });                                // sound changed
  aendere(path.join(werk, 'baukasten', 'warm-pad.preset.json'), (j) => { j.beschreibung.energie = 2; j.name = 'Warmer Pad'; });
  aendere(path.join(nutzer, 'baukasten', 'mein-lead.preset.json'), (j) => { j.beschreibung.genre = ['schranz']; });            // now invalid
  const d = pruefeFn(register, s);
  assert.equal(d.sauber, false);
  assert.deepEqual(d.fehlend, ['werk:hall/big-hall']);
  assert.deepEqual(d.verwaist, ['nutzer:baukasten/mein-lead-2']);
  assert.deepEqual(d.geaendert, [{ id: 'werk:baukasten/warm-pad', teile: ['beschreibung', 'name'] }, { id: 'werk:rb338/acid-bass', teile: ['klang'] }]);
  assert.deepEqual(d.ungueltig.map((u) => [u.id, u.fehler[0].feld, u.fehler[0].code]), [['nutzer:baukasten/mein-lead', 'genre', 'unbekanntes_wort']]);
  assert.deepEqual(d.doppelt, []);   // mein-lead is invalid now, so its copy has no valid twin
  // a change that touches neither sound, description nor name still shows
  const { register: r2 } = bauen(s, ['werk']);
  aendere(path.join(werk, 'rb338', 'acid-bass.preset.json'), (j) => { j.notiz = 'x'; });
  assert.deepEqual(pruefeFn(r2, s, ['werk']).geaendert, [{ id: 'werk:rb338/acid-bass', teile: ['sonstiges'] }]);
}

test('verify: register drift — missing, orphaned, changed (sound, description, name, other), invalid', (t) => {
  driftSzenario(t, pruefe);
});

test('the drift test fails on a check that compares ids only (deliberately broken implementation)', (t) => {
  const nurIds = (reg, s, h) => ({ ...pruefe(reg, s, h), geaendert: [] });
  assert.throws(() => driftSzenario(t, nurIds), assert.AssertionError);
});

test('verify: duplicate ids in a stored register, stale vocabulary, other origins untouched', (t) => {
  const { s, nutzer } = kopie(t);
  fs.rmSync(path.join(nutzer, 'rb338', 'acid-kopie.preset.json'));
  const { register } = bauen(s);
  const doppelt = { ...register, eintraege: [...register.eintraege, register.eintraege[0]] };
  assert.deepEqual(pruefe(doppelt, s).doppelt, [{ art: 'id', ids: [register.eintraege[0].id, register.eintraege[0].id] }]);
  const d = pruefe({ ...register, vokabular: { version: vok.version - 1, pruefsumme: 'alt' } }, s);
  assert.deepEqual([d.vokabular_veraltet, d.sauber], [true, false]);
  // checking only the factory origin does not report the user entries as missing
  assert.equal(pruefe(register, s, ['werk']).sauber, true);
});

test('the register follows the store: a preset saved, renamed or deleted through the store shows as drift', (t) => {
  const { s, nutzer } = kopie(t);
  fs.rmSync(path.join(nutzer, 'rb338', 'acid-kopie.preset.json'));
  const { register } = bauen(s);
  s.speichere({ name: 'New Bass', geraet: 'rb338', werte: { cutoff: 900 }, beschreibung: { art: 'bass', unterart: 'sub', charakter: ['deep'], genre: [], einsatz: ['drop'], energie: 3, text: 'Deep sub for the tests.' } });
  s.benenne('baukasten', 'mein-lead', 'Your Lead');
  const d = pruefe(register, s);
  assert.deepEqual(d.verwaist, ['nutzer:baukasten/your-lead', 'nutzer:rb338/new-bass']);
  assert.deepEqual(d.fehlend, ['nutzer:baukasten/mein-lead']);
  s.loesche('rb338', 'new-bass');
  assert.deepEqual(pruefe(register, s).verwaist, ['nutzer:baukasten/your-lead']);
});

test('register file: written and read back identically, one entry per line, atomic', (t) => {
  const { d, s } = kopie(t);
  const { register } = bauen(s);
  const f = path.join(d, 'register.json');
  schreibeRegister(f, register);
  assert.deepEqual(liesRegister(f), register);
  assert.equal(fs.readFileSync(f, 'utf8').split('\n').filter((z) => z.includes('"id":')).length, register.eintraege.length);
  assert.deepEqual(fs.readdirSync(d).filter((x) => x.endsWith('.tmp')), []);
  fs.writeFileSync(f, '{"format": 9, "eintraege": []}');
  assert.throws(() => liesRegister(f), /not a preset register/);
});

test('query: filters by family, kind, sub-kind, character (all), genre and use (any), energy, device, origin', (t) => {
  const { s } = kopie(t);
  const { register } = bauen(s);
  const ids = (a) => frage(register, a, vok).treffer.map((e) => e.id);
  assert.equal(ids({}).length, 5);
  assert.deepEqual(ids({ familie: 'effekt' }), ['werk:hall/big-hall']);
  assert.deepEqual(ids({ art: ['bass'] }), ['werk:rb338/acid-bass', 'nutzer:rb338/acid-kopie']);   // by name: Acid Bass, Acid Kopie
  assert.deepEqual(ids({ art: ['reverb'], unterart: ['hall'] }), ['werk:hall/big-hall']);
  assert.deepEqual(ids({ charakter: ['wide'] }), ['werk:hall/big-hall', 'nutzer:baukasten/mein-lead', 'werk:baukasten/warm-pad']);
  assert.deepEqual(ids({ charakter: ['wide', 'warm'] }), ['werk:baukasten/warm-pad']);
  assert.deepEqual(ids({ genre: ['ambient', 'progressive'] }), ['werk:hall/big-hall', 'nutzer:baukasten/mein-lead', 'werk:baukasten/warm-pad']);
  assert.deepEqual(ids({ einsatz: ['intro'] }), ['werk:baukasten/warm-pad']);
  assert.deepEqual(ids({ energie: 5 }), ['werk:rb338/acid-bass']);
  assert.deepEqual(ids({ energie: { min: 4 } }), ['werk:rb338/acid-bass', 'nutzer:rb338/acid-kopie', 'nutzer:baukasten/mein-lead']);
  assert.deepEqual(ids({ energie: { max: 2 } }), ['werk:hall/big-hall', 'werk:baukasten/warm-pad']);
  assert.deepEqual(ids({ geraet: ['hall'] }), ['werk:hall/big-hall']);
  assert.deepEqual(ids({ herkunft: ['nutzer'], art: ['lead'] }), ['nutzer:baukasten/mein-lead']);
  assert.deepEqual(ids({ genre: ['dnb'] }), []);
});

test('query: free text over name, sentence, id, device and tags, all words, case and accents folded', (t) => {
  const { s } = kopie(t);
  const { register } = bauen(s);
  const ids = (text) => frage(register, { text }, vok).treffer.map((e) => e.id);
  assert.deepEqual(ids('303'), ['werk:rb338/acid-bass']);
  assert.deepEqual(ids('TRANCE drop'), ['werk:hall/big-hall', 'nutzer:baukasten/mein-lead']);
  assert.deepEqual(ids('trance drop soars'), ['nutzer:baukasten/mein-lead']);
  assert.deepEqual(ids('deep_house'), ['werk:baukasten/warm-pad']);
  assert.deepEqual(ids('deep house'), ['werk:baukasten/warm-pad']);
  assert.deepEqual(ids('Stéreo'), ['werk:baukasten/warm-pad']);
  assert.deepEqual(ids('modular'), ['nutzer:baukasten/mein-lead', 'werk:baukasten/warm-pad'], 'device title');
  assert.deepEqual(ids('hall supersaw'), []);
});

test('query: limit and total; unknown fields, invented tags, bad ranges are rejected, never ignored', (t) => {
  const { s } = kopie(t);
  const { register } = bauen(s);
  const a = frage(register, { grenze: 2 }, vok);
  assert.deepEqual([a.gesamt, a.treffer.length], [5, 2]);
  const fehler = (q) => { try { frage(register, q, vok); return null; } catch (e) { assert.ok(e instanceof FrageFehler); return e.fehler.map((x) => `${x.feld}:${x.code}`); } };
  assert.deepEqual(fehler({ charakter: ['fat'] }), ['charakter:unbekanntes_wort']);
  assert.deepEqual(fehler({ genre: ['schranz'], art: ['synth'] }), ['art:unbekanntes_wort', 'genre:unbekanntes_wort']);
  assert.deepEqual(fehler({ stimmung: 'dark' }), ['stimmung:unbekanntes_feld']);
  assert.deepEqual(fehler({ quelle: ['werk'] }), ['quelle:unbekanntes_feld']);
  assert.deepEqual(fehler({ charakter: 'warm' }), ['charakter:typ']);
  assert.deepEqual(fehler({ charakter: [] }), ['charakter:typ']);
  assert.deepEqual(fehler({ familie: 'synth' }), ['familie:unbekanntes_wort']);
  assert.deepEqual(fehler({ herkunft: ['plugin'] }), ['herkunft:unbekanntes_wort']);
  assert.deepEqual(fehler({ geraet: ['../etc'] }), ['geraet:unbekanntes_wort']);
  for (const e of [0, 6, { min: 4, max: 2 }, { min: 1, bis: 3 }, [1, 2]]) assert.deepEqual(fehler({ energie: e }), ['energie:bereich'], JSON.stringify(e));
  assert.deepEqual(fehler({ text: 'a b c d e f g h i j k l m' }), ['text:anzahl']);
  assert.deepEqual(fehler({ grenze: 0 }), ['grenze:bereich']);
  assert.deepEqual(fehler(null), ['anfrage:typ']);
  assert.ok(pruefeAnfrage({ charakter: ['fat'] }, vok)[0].erlaubt.includes('warm'));
  assert.deepEqual(pruefeAnfrage({ geraet: ['x'] }, vok)[0].erlaubt, [...GERAET_IDS]);
});

test('tool schema: enums come from the vocabulary and the device catalogue, every field described, no extra fields', () => {
  const s = frageSchema(vok);
  assert.equal(s.name, 'presets_suchen');
  assert.match(s.description, new RegExp(`Vocabulary version ${vok.version}`));
  const p = s.input_schema.properties;
  assert.equal(s.input_schema.additionalProperties, false);
  assert.deepEqual(Object.keys(p), ['familie', 'art', 'unterart', 'charakter', 'genre', 'einsatz', 'energie', 'geraet', 'herkunft', 'text', 'grenze']);
  assert.deepEqual(p.charakter.items.enum, vok.inhalt.charakter);
  assert.deepEqual(p.genre.items.enum, vok.inhalt.genre);
  assert.deepEqual(p.einsatz.items.enum, vok.inhalt.einsatz);
  assert.deepEqual(p.art.items.enum, [...vok.familieVon.keys()]);
  assert.deepEqual(p.geraet.items.enum, [...GERAET_IDS]);
  assert.deepEqual(p.herkunft.items.enum, ['werk', 'nutzer']);
  assert.ok(p.unterart.items.enum.includes('plate') && p.unterart.items.enum.includes('acid'));
  assert.equal(new Set(p.unterart.items.enum).size, p.unterart.items.enum.length);
  for (const [k, v] of Object.entries(p)) assert.ok(typeof v.description === 'string' && v.description.length > 3, k);
});

test('command line: bauen writes, pruefen reports drift with exit 1, frage rejects invented tags with exit 2', (t) => {
  const { d, werk, nutzer } = kopie(t);
  const f = path.join(d, 'reg.json');
  const opt = ['--werk', werk, '--register', f];
  const aus = [];
  assert.equal(hauptprogramm(['bauen', ...opt], (s) => aus.push(s)), 0);
  assert.match(aus[0], /^3 presets written/);
  assert.equal(hauptprogramm(['pruefen', ...opt], () => {}), 0);
  fs.rmSync(path.join(werk, 'hall', 'big-hall.preset.json'));
  const p = [];
  assert.equal(hauptprogramm(['pruefen', ...opt], (s) => p.push(s)), 1);
  assert.deepEqual(JSON.parse(p[0]).fehlend, ['werk:hall/big-hall']);
  const q = [];
  assert.equal(hauptprogramm(['frage', '{"charakter":["fat"]}', ...opt], (s) => q.push(s)), 2);
  assert.equal(JSON.parse(q[0]).fehler[0].wert, 'fat');
  const r = [];
  assert.equal(hauptprogramm(['frage', '{"art":["pad"]}', ...opt], (s) => r.push(s)), 0);
  assert.deepEqual(JSON.parse(r[0]).treffer.map((e) => e.name), ['Warm Pad']);
  assert.equal(hauptprogramm(['unsinn'], () => {}), 2);
  // with --nutzer the register covers both origins
  const both = [];
  assert.equal(hauptprogramm(['bauen', ...opt, '--nutzer', nutzer], (s) => both.push(s)), 0);
  assert.match(both[0], /^4 presets written/);
  assert.match(both[1], /^same sound: nutzer:rb338\/acid-kopie, werk:rb338\/acid-bass$/);
  // an invalid preset makes bauen fail (exit 1), so a broken factory file cannot slip into the register
  const k = [];
  assert.equal(hauptprogramm(['bauen', '--werk', path.join(d, 'kaputt'), '--register', f], (s) => k.push(s)), 1);
  assert.match(k[1], /^invalid werk:rb338\/erfundenes-wort: charakter: unbekanntes_wort \("fat"\)/);
});

// ---------- package 1.16 rest, U1 ----------
test('preset id: PRESET_ID (zero-import file, re-exported) matches every register id and refuses malformed ids', async (t) => {
  const { PRESET_ID } = await import('../presets/preset_id.ts');
  const ausModell = (await import('../presets/modell.ts')).PRESET_ID, ausRegister = (await import('../presets/register.ts')).PRESET_ID;
  assert.equal(ausModell, PRESET_ID); assert.equal(ausRegister, PRESET_ID);
  assert.doesNotMatch(fs.readFileSync(path.join(import.meta.dirname, '..', 'presets', 'preset_id.ts'), 'utf8'), /^\s*import\b/m, 'no imports');
  const { s } = kopie(t);
  const werk = liesRegister(path.join(import.meta.dirname, '..', 'presets', 'register.json'));
  for (const e of [...bauen(s).register.eintraege, ...werk.eintraege]) assert.match(e.id, PRESET_ID, e.id);
  for (const id of ['werk:komp', 'x:komp/a', 'werk:komp/', 'werk:komp/-a', 'nutzer:KOMP/a', 'werk:komp/a/b', ` werk:komp/a`, `werk:komp/${'a'.repeat(49)}`]) assert.doesNotMatch(id, PRESET_ID, id);
});

test('klang: two baukasten presets with equal values and different graphs are no duplicate; equal graph is', (t) => {
  const { s, nutzer } = kopie(t);
  const f = path.join(nutzer, 'baukasten', 'mein-lead.preset.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.writeFileSync(path.join(nutzer, 'baukasten', 'anderer-graph.preset.json'), JSON.stringify({ ...j, name: 'Anderer Graph', graph: 'zweiter' }));
  assert.deepEqual(bauen(s).doppelt.filter((d) => d.ids.some((i) => i.includes('baukasten'))), []);
  fs.writeFileSync(path.join(nutzer, 'baukasten', 'gleicher-graph.preset.json'), JSON.stringify({ ...j, name: 'Gleicher Graph' }));
  assert.deepEqual(bauen(s).doppelt.filter((d) => d.ids.some((i) => i.includes('baukasten'))),
    [{ art: 'klang', ids: ['nutzer:baukasten/gleicher-graph', 'nutzer:baukasten/mein-lead'] }]);
});

test('author mark in the register: entry carries autor only when present; factory register lines unchanged', (t) => {
  const { s, nutzer } = kopie(t);
  const f = path.join(nutzer, 'rb338', 'acid-kopie.preset.json');
  aendere(f, (j) => { j.autor = 'cypher'; });
  const e = bauen(s).register.eintraege;
  assert.equal(e.find((x) => x.id === 'nutzer:rb338/acid-kopie').autor, 'cypher');
  assert.ok(e.filter((x) => x.id !== 'nutzer:rb338/acid-kopie').every((x) => !('autor' in x)));
  const kl = e.find((x) => x.id === 'nutzer:rb338/acid-kopie').klang;
  assert.equal(kl, e.find((x) => x.id === 'werk:rb338/acid-bass').klang, 'autor is not part of klang');
  const werk = new PresetSpeicher({ vok });
  const neu = bauen(werk, ['werk']).register;
  const alt = liesRegister(path.join(import.meta.dirname, '..', 'presets', 'register.json'));
  assert.deepEqual(neu.eintraege, alt.eintraege, 'the 48 factory entries are unchanged');
  assert.equal(alt.eintraege.length, 48);
});
