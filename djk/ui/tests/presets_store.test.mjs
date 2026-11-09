// Presets (package 1.16): the on-disk store. Save, list, search, rename, delete, factory vs user, and the failure cases: invalid
// names, path traversal, corrupt file, schema mismatch, invalid description, symlinks, concurrent saves from several processes. Three
// tests run the same checks against a deliberately broken implementation and require them to FAIL there (the checks have teeth).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PresetSpeicher, WERK_VORGABE } from '../presets/store.ts';
import { PresetFehler, pruefeDatei } from '../presets/model.ts';
import { geraetVon } from '../presets/devices.ts';
import { ladeVokabular } from '../presets/vocabulary.ts';

const FIX = path.join(import.meta.dirname, 'fixtures', 'presets');
function tmp(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; }
function speicher(t, jetzt) {
  const d = tmp(t);
  const werk = path.join(d, 'factory'), nutzer = path.join(d, 'user');
  fs.mkdirSync(path.join(werk, 'comp'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'gueltig.json'), path.join(werk, 'komp', 'test-glue.preset.json'));
  let n = 0;
  const s = new PresetSpeicher({ werk, nutzer, jetzt: jetzt ?? (() => new Date(Date.UTC(2026, 10, 2, 12, 0, n++))) });
  // Most tests are about storage, not descriptions: a save without beschreibung gets a valid one for the device type. The tests
  // under "description" call the real method (s.speichereRoh) to prove that a missing or invalid description is refused.
  s.speichereRoh = s.speichere.bind(s);
  s.speichere = (e, o) => s.speichereRoh('beschreibung' in e ? e : { ...e, beschreibung: BESCHR[geraetVon(e.geraet)?.typ ?? 'effekt'] }, o);
  return { s, werk, nutzer, d };
}
const BESCHR = {
  effekt: { art: 'compressor', unterart: 'peak', charakter: ['clean'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'Setting for the storage tests.' },
  instrument: { art: 'bass', unterart: 'acid', charakter: ['dirty'], genre: ['acid'], einsatz: ['drop'], energie: 4, text: 'Acid line for the tests.' },
};
const fehlerIst = (code, fehler) => (e) => e instanceof PresetFehler && e.code === code && e.fehler === fehler;
const KOMP = { thresh: -20, ratio: 4, attack: 10, extsc: false };

test('save a user preset: file layout, schema, timestamps, values by parameter name', (t) => {
  const { s, nutzer } = speicher(t);
  const r = s.speichere({ name: '  Kick  Glue ', geraet: 'komp', werte: KOMP, tags: ['Drums', 'drums', 'Bus'], notiz: 'n' });
  assert.deepEqual([r.slug, r.neu], ['kick-glue', true]);
  const datei = fs.readFileSync(path.join(nutzer, 'komp', 'kick-glue.preset.json'), 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(datei)), ['schema', 'name', 'geraet_typ', 'geraet', 'werte', 'beschreibung', 'tags', 'notiz', 'angelegt', 'geaendert']);
  assert.deepEqual(JSON.parse(datei), { schema: 1, name: 'Kick Glue', geraet_typ: 'effekt', geraet: 'komp', werte: KOMP, beschreibung: BESCHR.effekt,
    tags: ['drums', 'bus'], notiz: 'n', angelegt: '2026-11-02T12:00:00.000Z', geaendert: '2026-11-02T12:00:00.000Z' });
  assert.deepEqual(fs.readdirSync(path.join(nutzer, 'comp')), ['kick-glue.preset.json'], 'no temp file or lock left behind');
});

test('list: user first, then factory; search by name, tag, device; filter by origin', (t) => {
  const { s } = speicher(t);
  s.speichere({ name: 'Acid Line', geraet: 'rb338', werte: { cutoff: 600, resonanz: 0.8, wellenform: true }, tags: ['acid'] });
  s.speichere({ name: 'Big Room', geraet: 'hall', werte: { decay: 4.5, fft: '4096' }, tags: ['space'] });
  s.speichere({ name: 'Glue Würze', geraet: 'komp', werte: KOMP, notiz: 'for the drum bus' });
  const alle = s.liste();
  assert.deepEqual(alle.map((e) => `${e.herkunft}:${e.geraet}/${e.slug}`),
    ['nutzer:hall/big-room', 'nutzer:komp/glue-wuerze', 'nutzer:rb338/acid-line', 'werk:komp/test-glue']);
  assert.deepEqual(s.liste({ q: 'glue' }).map((e) => e.slug), ['glue-wuerze', 'test-glue']);
  assert.deepEqual(s.liste({ q: 'wurze' }), [], 'an umlaut is spelled out (ue), not dropped');
  assert.deepEqual(s.liste({ q: 'wuerze' }).map((e) => e.slug), ['glue-wuerze']);
  assert.deepEqual(s.liste({ q: 'drum bus' }).map((e) => e.slug), ['glue-wuerze'], 'all words, also from the note');
  assert.deepEqual(s.liste({ tag: 'ACID' }).map((e) => e.slug), ['acid-line']);
  assert.deepEqual(s.liste({ geraet: 'komp' }).map((e) => e.slug), ['glue-wuerze', 'test-glue']);
  assert.deepEqual(s.liste({ q: 'rb-338' }).map((e) => e.slug), ['acid-line'], 'device title is searchable');
  assert.deepEqual(s.liste({ geraet_typ: 'instrument' }).map((e) => e.slug), ['acid-line']);
  assert.deepEqual(s.liste({ herkunft: 'werk' }).map((e) => e.slug), ['test-glue']);
  assert.deepEqual(s.liste({ geraet: '../komp' }), []);
  assert.deepEqual(s.liste({ q: 'synthetic compressor' }).map((e) => e.slug), ['test-glue'], 'the description sentence is searchable');
  assert.deepEqual(s.liste({ q: 'dirty' }).map((e) => e.slug), ['acid-line'], 'description words are searchable');
});

test('list: filter by description (kind, character all, genre and use any, energy), entries carry the description', (t) => {
  const { s } = speicher(t);
  s.speichere({ name: 'Acid Line', geraet: 'rb338', werte: { cutoff: 600 } });
  s.speichere({ name: 'Plate', geraet: 'hall', werte: { decay: 1.2 }, beschreibung: { art: 'reverb', unterart: 'plate', charakter: ['bright', 'wet'], genre: ['house'], einsatz: ['breakdown'], energie: 2, text: 'Short bright plate.' } });
  const e = s.liste({ geraet: 'hall' })[0];
  assert.deepEqual([e.familie, e.beschreibung.art, e.beschreibung.charakter], ['effekt', 'reverb', ['bright', 'wet']]);
  const slugs = (f) => s.liste(f).map((x) => x.slug);
  assert.deepEqual(slugs({ art: ['reverb', 'bass'] }), ['plate', 'acid-line']);
  assert.deepEqual(slugs({ familie: 'instrument' }), ['acid-line']);
  assert.deepEqual(slugs({ charakter: ['bright', 'wet'] }), ['plate']);
  assert.deepEqual(slugs({ charakter: ['bright', 'smooth'] }), [], 'character: all must be present');
  assert.deepEqual(slugs({ genre: ['techno', 'house'] }), ['plate'], 'genre: any');
  assert.deepEqual(slugs({ einsatz: ['mixdown', 'drop'] }), ['acid-line', 'test-glue'], 'use: any');
  assert.deepEqual(slugs({ energie: { min: 3 } }), ['acid-line']);
  assert.deepEqual(slugs({ energie: 2 }), ['plate', 'test-glue']);
});

test('description: required on save, checked against the vocabulary, family must match the device type; nothing written', (t) => {
  const { s } = speicher(t);
  const ein = { name: 'D', geraet: 'komp', werte: KOMP };
  const fehler = (e) => { try { s.speichereRoh(e); return null; } catch (x) { assert.ok(x instanceof PresetFehler && x.code === 400 && x.fehler === 'beschreibung_ungueltig', x.message); return x; } };
  assert.equal(fehler(ein).details[0].feld, 'beschreibung');
  const x = fehler({ ...ein, beschreibung: { ...BESCHR.effekt, charakter: ['fat'], genre: ['schranz'] } });
  assert.deepEqual(x.details.map((d) => `${d.feld}:${d.code}:${d.wert}`), ['charakter:unbekanntes_wort:fat', 'genre:unbekanntes_wort:schranz']);
  assert.ok(x.details[0].erlaubt.includes('thick'), 'the allowed words come with the error');
  assert.match(x.text, /charakter: unbekanntes_wort \("fat"\) allowed: warm/);
  const f = fehler({ ...ein, beschreibung: BESCHR.instrument });
  assert.deepEqual(f.details.map((d) => `${d.feld}:${d.code}`), ['art:familie']);
  assert.ok(f.details[0].erlaubt.includes('compressor') && !f.details[0].erlaubt.includes('bass'));
  assert.equal(fehler({ ...ein, beschreibung: { ...BESCHR.effekt, text: 'Two sentences. Not allowed.' } }).details[0].code, 'satz');
  assert.deepEqual(s.liste({ herkunft: 'nutzer' }), [], 'nothing was written');
  // the stored description is a clean copy in field order, whatever order the caller used
  const umgekehrt = Object.fromEntries(Object.entries(BESCHR.effekt).reverse());
  s.speichereRoh({ ...ein, beschreibung: umgekehrt });
  assert.deepEqual(Object.keys(s.lies('nutzer', 'komp', 'd').beschreibung), ['art', 'unterart', 'charakter', 'genre', 'einsatz', 'energie', 'text']);
});

test('a file whose description fails the vocabulary: listed with its reason, 409 with details on read, bytes untouched', (t) => {
  const { s, nutzer } = speicher(t);
  const p = legeDatei(nutzer, 'komp', 'fat-glue', 'beschreibung_falsch.json');
  const vorher = fs.readFileSync(p);
  assert.deepEqual(s.liste({ herkunft: 'nutzer' }).map((e) => `${e.slug}:${e.fehler}`), ['fat-glue:beschreibung_ungueltig']);
  assert.throws(() => s.lies('nutzer', 'komp', 'fat-glue'), (e) => fehlerIst(409, 'beschreibung_ungueltig')(e) && e.details[0].wert === 'fat');
  assert.deepEqual(fs.readFileSync(p), vorher);
  assert.deepEqual(s.liste({ herkunft: 'nutzer', art: ['compressor'] }), [], 'a description filter never returns an undescribed preset');
});

test('the description test fails on a store that skips the vocabulary (deliberately broken implementation)', () => {
  const vok = ladeVokabular();
  const roh = JSON.parse(fs.readFileSync(path.join(FIX, 'beschreibung_falsch.json'), 'utf8'));
  const pruefung = (lese) => assert.throws(() => lese(roh), fehlerIst(409, 'beschreibung_ungueltig'));
  pruefung((j) => pruefeDatei(j, 'komp', vok));
  // broken: a vocabulary whose character list admits every word, as if the check were skipped
  const offen = { ...vok, inhalt: { ...vok.inhalt, charakter: new Proxy(vok.inhalt.charakter, { get: (z, k) => (k === 'includes' ? () => true : Reflect.get(z, k)) }) } };
  assert.throws(() => pruefung((j) => pruefeDatei(j, 'komp', offen)), assert.AssertionError);
});

test('read one preset; factory presets shipped in the repository are valid', (t) => {
  const { s } = speicher(t);
  const p = s.lies('werk', 'komp', 'test-glue');
  assert.equal(p.name, 'Test Glue'); assert.equal(p.herkunft, 'werk'); assert.deepEqual(p.verworfen, []);
  const echt = new PresetSpeicher({ werk: WERK_VORGABE, nutzer: tmp(t) });
  const werk = echt.liste();
  assert.equal(werk.length, 48);
  assert.ok(werk.every((e) => e.herkunft === 'werk' && !e.fehler && e.beschreibung));
  assert.ok(werk.filter((e) => e.geraet === 'komp').every((e) => e.beschreibung.art === 'compressor'));
  for (const g of fs.readdirSync(WERK_VORGABE)) {
    assert.deepEqual(fs.readdirSync(path.join(WERK_VORGABE, g)).filter((f) => !/^[a-z0-9-]+\.preset\.json$/.test(f)), [], `one naming scheme (${g})`);
  }
});

test('invalid names and input are refused with a reason', (t) => {
  const { s } = speicher(t);
  for (const name of ['', '   ', '!!!', 'x'.repeat(65), 'a\u0000b', 'tab\there', 42, null])
    assert.throws(() => s.speichere({ name, geraet: 'komp', werte: KOMP }), fehlerIst(400, 'name_ungueltig'), String(name));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'vst-x', werte: KOMP }), fehlerIst(400, 'geraet_unbekannt'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', geraet_typ: 'instrument', werte: KOMP }), fehlerIst(400, 'geraet_typ_falsch'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', werte: {} }), fehlerIst(400, 'werte_ungueltig'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', werte: [1] }), fehlerIst(400, 'werte_ungueltig'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', werte: { thresh_0: 1 } }), fehlerIst(400, 'parameter_unbekannt'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', werte: { thresh: 3 } }), fehlerIst(400, 'wert_ungueltig'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', werte: { thresh: '-3' } }), fehlerIst(400, 'wert_ungueltig'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', werte: { thresh: Number.NaN } }), fehlerIst(400, 'wert_ungueltig'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', werte: { extsc: 1 } }), fehlerIst(400, 'wert_ungueltig'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'hall', werte: { fft: '2047' } }), fehlerIst(400, 'wert_ungueltig'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', werte: KOMP, tags: ['a/b'] }), fehlerIst(400, 'tags_ungueltig'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', werte: KOMP, tags: 'drums' }), fehlerIst(400, 'tags_ungueltig'));
  assert.throws(() => s.speichere({ name: 'A', geraet: 'komp', werte: KOMP, notiz: 'n'.repeat(501) }), fehlerIst(400, 'notiz_ungueltig'));
  assert.deepEqual(s.liste({ herkunft: 'nutzer' }), [], 'nothing was written');
});

test('same name twice: refused, unless overwriting; overwriting keeps angelegt and checks the stamp the caller saw', (t) => {
  const { s, nutzer } = speicher(t);
  const a = s.speichere({ name: 'Lead', geraet: 'komp', werte: KOMP });
  assert.throws(() => s.speichere({ name: 'LEAD', geraet: 'komp', werte: KOMP }), fehlerIst(409, 'name_vergeben'), 'names differing only in case share a slug');
  assert.equal(s.speichere({ name: 'Lead', geraet: 'saett', werte: { drive: 3 } }).neu, true, 'the same name on another device is fine');
  const b = s.speichere({ name: 'Lead', geraet: 'komp', werte: { thresh: -5 } }, { ueberschreiben: true, erwartet: a.preset.geaendert });
  assert.equal(b.neu, false);
  const p = s.lies('nutzer', 'komp', 'lead');
  assert.deepEqual(p.werte, { thresh: -5 }); assert.equal(p.angelegt, a.preset.angelegt); assert.notEqual(p.geaendert, a.preset.geaendert);
  assert.throws(() => s.speichere({ name: 'Lead', geraet: 'komp', werte: { thresh: -1 } }, { ueberschreiben: true, erwartet: a.preset.geaendert }), fehlerIst(409, 'veraltet'));
  assert.deepEqual(s.lies('nutzer', 'komp', 'lead').werte, { thresh: -5 });
  assert.deepEqual(fs.readdirSync(path.join(nutzer, 'comp')).sort(), ['lead.preset.json']);
});

test('rename moves the file to the new slug, refuses a taken name, keeps values; factory presets are never touched', (t) => {
  const { s, nutzer, werk } = speicher(t);
  s.speichere({ name: 'One', geraet: 'komp', werte: KOMP });
  s.speichere({ name: 'Two', geraet: 'komp', werte: { thresh: -1 } });
  assert.deepEqual(s.benenne('komp', 'one', 'Three'), { slug: 'three' });
  assert.equal(fs.existsSync(path.join(nutzer, 'komp', 'one.preset.json')), false);
  assert.deepEqual(s.lies('nutzer', 'komp', 'three').werte, KOMP);
  assert.throws(() => s.benenne('komp', 'three', 'two'), fehlerIst(409, 'name_vergeben'));
  assert.deepEqual(s.lies('nutzer', 'komp', 'three').werte, KOMP, 'the refused rename left the file in place');
  assert.deepEqual(s.benenne('komp', 'three', 'THREE'), { slug: 'three' }, 'a change of case stays in the same file');
  assert.equal(s.lies('nutzer', 'komp', 'three').name, 'THREE');
  assert.throws(() => s.benenne('komp', 'nix', 'Four'), fehlerIst(404, 'unbekannt'));
  assert.throws(() => s.benenne('komp', 'test-glue', 'Mine'), fehlerIst(404, 'unbekannt'), 'rename only looks at user presets');
  assert.ok(fs.existsSync(path.join(werk, 'komp', 'test-glue.preset.json')));
});

test('delete moves the preset into the trash folder', (t) => {
  const { s, nutzer } = speicher(t);
  s.speichere({ name: 'Gone', geraet: 'eq', werte: { on_1: true, type_1: 'Low Cut', freq_1: 30 } });
  s.loesche('eq', 'gone');
  assert.equal(fs.existsSync(path.join(nutzer, 'eq', 'gone.preset.json')), false);
  const korb = fs.readdirSync(path.join(nutzer, '.papierkorb'));
  assert.equal(korb.length, 1); assert.match(korb[0], /^eq-gone-\d+-[0-9a-f]{4}\.json$/);
  assert.throws(() => s.loesche('eq', 'gone'), fehlerIst(404, 'unbekannt'));
  assert.throws(() => s.lies('nutzer', 'eq', 'gone'), fehlerIst(404, 'unbekannt'));
});

// The traversal check as one function, so the same assertions can run against a broken store below
function pruefeTraversal(s, d) {
  fs.writeFileSync(path.join(d, 'geheim.preset.json'), fs.readFileSync(path.join(FIX, 'gueltig.json')));
  const boese = ['..', '../geheim', '../../geheim', '..%2Fgeheim', 'a/../../geheim', '/etc/passwd', 'geheim\u0000', 'Geheim', '.sperre', '-x', ''];
  for (const slug of boese) {
    assert.throws(() => s.lies('nutzer', 'komp', slug), fehlerIst(400, 'slug_ungueltig'), `lies ${JSON.stringify(slug)}`);
    assert.throws(() => s.loesche('komp', slug), fehlerIst(400, 'slug_ungueltig'), `loesche ${JSON.stringify(slug)}`);
    assert.throws(() => s.benenne('komp', slug, 'x'), fehlerIst(400, 'slug_ungueltig'), `benenne ${JSON.stringify(slug)}`);
  }
  for (const geraet of ['..', '../..', 'komp/..', '', 'KOMP']) assert.throws(() => s.lies('nutzer', geraet, 'geheim'), fehlerIst(400, 'geraet_unbekannt'), `geraet ${geraet}`);
  for (const h of ['..', 'nutzer/..', 'werk/../nutzer', '']) assert.throws(() => s.lies(h, 'komp', 'geheim'), fehlerIst(400, 'herkunft_ungueltig'), `herkunft ${h}`);
  assert.ok(fs.existsSync(path.join(d, 'geheim.preset.json')), 'the file outside the store is still there');
}

test('path traversal: no slug, device or origin from outside reaches the file system', (t) => {
  const { s, d } = speicher(t);
  pruefeTraversal(s, d);
});

test('the traversal test fails on a store that joins the slug without checking it (deliberately broken implementation)', (t) => {
  const { s, d } = speicher(t);
  // broken: herkunft and geraet still checked, the slug goes straight into path.join
  s.pfad = (herkunft, geraet, slug) => path.join(herkunft === 'factory' ? s.werk : s.nutzer, geraet, `${slug}.preset.json`);
  assert.throws(() => pruefeTraversal(s, d), assert.AssertionError);
});

test('symlinks in the store are not presets and are never followed', (t) => {
  const { s, nutzer, d } = speicher(t);
  fs.mkdirSync(path.join(nutzer, 'comp'), { recursive: true });
  fs.writeFileSync(path.join(d, 'draussen.json'), fs.readFileSync(path.join(FIX, 'gueltig.json')));
  fs.symlinkSync(path.join(d, 'draussen.json'), path.join(nutzer, 'komp', 'link.preset.json'));
  assert.throws(() => s.lies('nutzer', 'komp', 'link'), fehlerIst(404, 'unbekannt'));
  assert.deepEqual(s.liste({ herkunft: 'nutzer' }), []);
  assert.throws(() => s.loesche('komp', 'link'), fehlerIst(404, 'unbekannt'));
  assert.ok(fs.existsSync(path.join(d, 'draussen.json')));
});

function legeDatei(nutzer, geraet, slug, fixture) {
  fs.mkdirSync(path.join(nutzer, geraet), { recursive: true });
  const p = path.join(nutzer, geraet, `${slug}.preset.json`);
  fs.copyFileSync(path.join(FIX, fixture), p);
  return p;
}

test('corrupt file: listed with its reason, refused on read, bytes left untouched, may be overwritten on purpose', (t) => {
  const { s, nutzer } = speicher(t);
  const p = legeDatei(nutzer, 'komp', 'kaputt', 'kaputt.json');
  const vorher = fs.readFileSync(p);
  assert.deepEqual(s.liste({ herkunft: 'nutzer' }), [{ herkunft: 'nutzer', geraet: 'komp', geraet_typ: null, slug: 'kaputt', name: 'kaputt', tags: [], geaendert: null,
    beschreibung: null, familie: null, notiz: '', fehler: 'json_kaputt' }]);
  assert.equal(s.liste({ herkunft: 'nutzer', geraet_typ: 'effekt' }).length, 1, 'the device type filter keeps damaged files (they have no type)');
  assert.throws(() => s.lies('nutzer', 'komp', 'kaputt'), fehlerIst(409, 'json_kaputt'));
  assert.throws(() => s.speichere({ name: 'Kaputt', geraet: 'komp', werte: KOMP }), fehlerIst(409, 'name_vergeben'));
  assert.deepEqual(fs.readFileSync(p), vorher);
  assert.equal(s.liste({ q: 'kaputt' }).length, 0, 'a search does not show damaged files (they have no searchable content)');
  s.speichere({ name: 'Kaputt', geraet: 'komp', werte: KOMP }, { ueberschreiben: true });
  assert.deepEqual(s.lies('nutzer', 'komp', 'kaputt').werte, KOMP);
});

test('schema mismatch and invalid content: 409 with a reason, never repaired', (t) => {
  const { s, nutzer } = speicher(t);
  const p2 = legeDatei(nutzer, 'komp', 'zukunft', 'schema2.json');
  legeDatei(nutzer, 'komp', 'ohne', 'ohne_schema.json');
  legeDatei(nutzer, 'komp', 'laut', 'wert_ausserhalb.json');
  legeDatei(nutzer, 'hall', 'falscher-ordner', 'gueltig.json');   // a komp preset in the hall folder
  assert.throws(() => s.lies('nutzer', 'komp', 'zukunft'), fehlerIst(409, 'schema_unbekannt'));
  assert.throws(() => s.lies('nutzer', 'komp', 'ohne'), fehlerIst(409, 'schema_unbekannt'));
  assert.throws(() => s.lies('nutzer', 'komp', 'laut'), fehlerIst(409, 'preset_ungueltig'));
  assert.throws(() => s.lies('nutzer', 'hall', 'falscher-ordner'), fehlerIst(409, 'preset_ungueltig'));
  assert.deepEqual(s.liste({ herkunft: 'nutzer' }).map((e) => `${e.slug}:${e.fehler}`).sort(),
    ['falscher-ordner:preset_ungueltig', 'laut:preset_ungueltig', 'ohne:schema_unbekannt', 'zukunft:schema_unbekannt']);
  assert.equal(JSON.parse(fs.readFileSync(p2, 'utf8')).schema, 2);
  const gross = path.join(nutzer, 'komp', 'gross.preset.json');
  fs.writeFileSync(gross, ' '.repeat(300 * 1024));
  assert.throws(() => s.lies('nutzer', 'komp', 'gross'), fehlerIst(409, 'zu_gross'));
});

test('the schema test fails on a reader that skips the schema check (deliberately broken implementation)', () => {
  const zukunft = JSON.parse(fs.readFileSync(path.join(FIX, 'schema2.json'), 'utf8'));
  const pruefung = (lese) => assert.throws(() => lese(zukunft), fehlerIst(409, 'schema_unbekannt'));
  const vok = ladeVokabular();
  pruefung((j) => pruefeDatei(j, 'komp', vok));
  const kaputt = (j) => pruefeDatei({ ...j, schema: 1 }, 'komp', vok);   // broken: treats any schema as 1
  assert.throws(() => pruefung(kaputt), assert.AssertionError);
});

test('a parameter the plugin no longer has is dropped on read and reported, the rest still loads', (t) => {
  const { s, nutzer } = speicher(t);
  legeDatei(nutzer, 'komp', 'alt', 'alter_parameter.json');
  const p = s.lies('nutzer', 'komp', 'alt');
  assert.deepEqual(p.werte, { thresh: -20 }); assert.deepEqual(p.verworfen, ['lookahead']);
});

test('timestamps come from the injected clock', (t) => {
  const { s } = speicher(t, () => new Date('2030-05-06T07:08:09.000Z'));
  assert.equal(s.speichere({ name: 'Clock', geraet: 'saett', werte: { drive: 1 } }).preset.geaendert, '2030-05-06T07:08:09.000Z');
});

// Several processes save at the same moment. Without the exclusive create (link) or the lock, two of them would both report a new
// preset, or a reader would see a half-written file.
async function rennen(nutzer, d, auftraege) {
  const start = path.join(d, 'los');
  const skript = path.join(FIX, 'writer.mjs');
  const kinder = auftraege.map(([name, thresh, ueber]) => new Promise((ok, nein) => {
    const k = spawn(process.execPath, [skript, nutzer, start, name, String(thresh), ueber ? '1' : '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let aus = '';
    k.stdout.on('data', (b) => { aus += b; });
    k.on('error', nein);
    k.on('close', () => { try { ok(JSON.parse(aus.trim())); } catch { nein(new Error(`child output: ${aus}`)); } });
  }));
  await new Promise((ok) => setTimeout(ok, 400));   // let every child reach its busy wait
  fs.writeFileSync(start, '');
  return Promise.all(kinder);
}

test('concurrent create of the same name from 6 processes: exactly one wins, the file is whole', async (t) => {
  const { nutzer, d, s } = speicher(t);
  const r = await rennen(nutzer, d, [1, 2, 3, 4, 5, 6].map((i) => ['Race', -i, false]));
  const gewonnen = r.filter((x) => x.ok);
  assert.equal(gewonnen.length, 1, JSON.stringify(r));
  assert.ok(r.filter((x) => !x.ok).every((x) => x.fehler === 'name_vergeben' || x.fehler === 'preset_busy'), JSON.stringify(r));
  const p = s.lies('nutzer', 'komp', 'race');
  assert.ok(p.werte.thresh <= -1 && p.werte.thresh >= -6);
  assert.deepEqual(fs.readdirSync(path.join(nutzer, 'comp')).sort(), ['race.preset.json'], 'no temp file or lock left behind');
});

test('concurrent overwrite from 6 processes: every result is ok or busy, the final file is one complete write', async (t) => {
  const { nutzer, d, s } = speicher(t);
  s.speichere({ name: 'Shared', geraet: 'komp', werte: { thresh: -30 } });
  const r = await rennen(nutzer, d, [1, 2, 3, 4, 5, 6].map((i) => ['Shared', -i, true]));
  assert.ok(r.every((x) => x.ok || x.fehler === 'preset_busy'), JSON.stringify(r));
  assert.ok(r.some((x) => x.ok));
  const p = s.lies('nutzer', 'komp', 'shared');
  assert.ok([-1, -2, -3, -4, -5, -6].includes(p.werte.thresh), `thresh ${p.werte.thresh}`);
  assert.deepEqual(fs.readdirSync(path.join(nutzer, 'comp')).sort(), ['shared.preset.json']);
});

// ---------- package 1.16 rest, U1: Baukasten graph (F2) and author mark (F4/F13) ----------
const PAD = { art: 'pad', unterart: 'analog', charakter: ['warm'], genre: [], einsatz: ['intro'], energie: 1, text: 'Pad for the graph tests.' };

test('baukasten graph: required for baukasten, refused for every other device, same name rule as the project (BK_GRAPH_NAME)', async (t) => {
  const { s, nutzer } = speicher(t);
  const bk = { name: 'Pad', geraet: 'baukasten', werte: { knob1: 0.5 }, beschreibung: PAD };
  assert.throws(() => s.speichere(bk), fehlerIst(400, 'graph_fehlt'));
  assert.throws(() => s.speichere({ ...bk, graph: 'Gross' }), fehlerIst(400, 'graph_ungueltig'));
  assert.throws(() => s.speichere({ ...bk, graph: 'a'.repeat(33) }), fehlerIst(400, 'graph_ungueltig'));
  assert.throws(() => s.speichere({ name: 'Komp', geraet: 'komp', werte: KOMP, graph: 'pad' }), fehlerIst(400, 'graph_verboten'));
  assert.equal(fs.existsSync(path.join(nutzer, 'modular')), false, 'nothing written by a refused save');
  s.speichere({ ...bk, graph: 'warm_pad-2' });
  const datei = JSON.parse(fs.readFileSync(path.join(nutzer, 'baukasten', 'pad.preset.json'), 'utf8'));
  assert.equal(datei.graph, 'warm_pad-2');
  assert.equal(s.lies('nutzer', 'baukasten', 'pad').graph, 'warm_pad-2');
  // negative control: a komp preset without graph still saves and its file has no graph key
  s.speichere({ name: 'Komp', geraet: 'komp', werte: KOMP });
  assert.equal('graph' in JSON.parse(fs.readFileSync(path.join(nutzer, 'komp', 'komp.preset.json'), 'utf8')), false);
  // a file is checked the same way: graph missing on baukasten or present elsewhere → 409 preset_ungueltig
  const ohne = { ...datei }; delete ohne.graph;
  fs.writeFileSync(path.join(nutzer, 'baukasten', 'ohne.preset.json'), JSON.stringify(ohne));
  assert.throws(() => s.lies('nutzer', 'baukasten', 'ohne'), fehlerIst(409, 'preset_ungueltig'));
  const komp = JSON.parse(fs.readFileSync(path.join(nutzer, 'komp', 'komp.preset.json'), 'utf8'));
  fs.writeFileSync(path.join(nutzer, 'komp', 'mit.preset.json'), JSON.stringify({ ...komp, graph: 'pad' }));
  assert.throws(() => s.lies('nutzer', 'komp', 'mit'), fehlerIst(409, 'preset_ungueltig'));
  // the copied rule equals the project rule
  const { BK_GRAPH_NAME } = await import('../project/model.ts');
  const { GRAPH_NAME } = await import('../presets/model.ts');
  assert.equal(GRAPH_NAME.source, BK_GRAPH_NAME.source);
  assert.equal(GRAPH_NAME.flags, BK_GRAPH_NAME.flags);
});

test('author mark: a save by Cypher writes autor cypher, a save by Andreas never; an overwrite by Andreas removes it; the list carries it', (t) => {
  const { s, nutzer } = speicher(t);
  const datei = (slug) => JSON.parse(fs.readFileSync(path.join(nutzer, 'comp', `${slug}.preset.json`), 'utf8'));
  s.speichere({ name: 'Hers', geraet: 'komp', werte: KOMP }, { quelle: 'cypher' });
  s.speichere({ name: 'His', geraet: 'komp', werte: KOMP }, { quelle: 'andreas' });
  s.speichere({ name: 'Plain', geraet: 'komp', werte: KOMP });
  assert.equal(datei('hers').autor, 'cypher');
  assert.equal('autor' in datei('his'), false);
  assert.equal('autor' in datei('plain'), false, 'no source given = Andreas');
  assert.equal(s.lies('nutzer', 'komp', 'hers').autor, 'cypher');
  assert.deepEqual(s.liste({ herkunft: 'nutzer' }).map((e) => [e.slug, e.autor ?? null]), [['hers', 'cypher'], ['his', null], ['plain', null]]);
  s.speichere({ name: 'Hers', geraet: 'komp', werte: { thresh: -3 } }, { quelle: 'cypher', ueberschreiben: true });
  assert.equal(datei('hers').autor, 'cypher', 'Cypher overwriting her own keeps the mark');
  s.speichere({ name: 'Hers', geraet: 'komp', werte: { thresh: -4 } }, { quelle: 'andreas', ueberschreiben: true });
  assert.equal('autor' in datei('hers'), false, 'Andreas overwriting makes it his');
  // a file with another author word is damaged
  fs.writeFileSync(path.join(nutzer, 'komp', 'fremd.preset.json'), JSON.stringify({ ...datei('his'), autor: 'andreas' }));
  assert.throws(() => s.lies('nutzer', 'komp', 'fremd'), fehlerIst(409, 'preset_ungueltig'));
});

test('rights in the store: Cypher changes only readable presets marked as hers; damaged or unmarked files stay Andreas\' (nur_andreas_preset)', (t) => {
  const { s, nutzer } = speicher(t);
  const p = (slug) => path.join(nutzer, 'comp', `${slug}.preset.json`);
  s.speichere({ name: 'His', geraet: 'komp', werte: KOMP });
  legeDatei(nutzer, 'komp', 'kaputt', 'kaputt.json');
  const vorher = { his: fs.readFileSync(p('his')), kaputt: fs.readFileSync(p('kaputt')) };
  for (const slug of ['his', 'kaputt']) {
    assert.throws(() => s.speichere({ name: slug, geraet: 'komp', werte: { thresh: -1 } }, { quelle: 'cypher', ueberschreiben: true }), fehlerIst(403, 'nur_andreas_preset'), slug);
    assert.throws(() => s.loesche('komp', slug, 'cypher'), fehlerIst(403, 'nur_andreas_preset'), slug);
  }
  assert.throws(() => s.benenne('komp', 'his', 'Other', 'cypher'), fehlerIst(403, 'nur_andreas_preset'));
  assert.deepEqual(fs.readFileSync(p('his')), vorher.his);
  assert.deepEqual(fs.readFileSync(p('kaputt')), vorher.kaputt);
  assert.equal(fs.existsSync(path.join(nutzer, '.papierkorb')), false);
  // negative controls: Cypher on her own, Andreas on everything
  s.speichere({ name: 'Hers', geraet: 'komp', werte: KOMP }, { quelle: 'cypher' });
  s.speichere({ name: 'Hers', geraet: 'komp', werte: { thresh: -2 } }, { quelle: 'cypher', ueberschreiben: true });
  assert.deepEqual(s.benenne('komp', 'hers', 'Hers Two', 'cypher'), { slug: 'hers-two' });
  assert.equal(s.lies('nutzer', 'komp', 'hers-two').autor, 'cypher', 'a rename keeps the mark');
  s.loesche('komp', 'hers-two', 'cypher');
  assert.equal(fs.existsSync(p('hers-two')), false);
  s.loesche('komp', 'kaputt', 'andreas');
  assert.equal(fs.existsSync(p('kaputt')), false, 'Andreas may delete a damaged file');
});

test('rename by Andreas takes the Cypher mark (D27): the item becomes his; Cypher renaming her own keeps it and her delete right', (t) => {
  const { s, nutzer } = speicher(t);
  const p = (slug) => path.join(nutzer, 'comp', `${slug}.preset.json`);
  s.speichere({ name: 'Mine', geraet: 'komp', werte: KOMP }, { quelle: 'cypher' });
  assert.equal(s.lies('nutzer', 'komp', 'mine').autor, 'cypher');
  assert.deepEqual(s.benenne('komp', 'mine', 'Andreas Name', 'andreas'), { slug: 'andreas-name' });
  assert.equal(s.lies('nutzer', 'komp', 'andreas-name').autor, undefined, 'Andreas renaming a marked preset removes the mark');
  assert.equal('autor' in JSON.parse(fs.readFileSync(p('andreas-name'), 'utf8')), false, 'also on disk');
  assert.throws(() => s.loesche('komp', 'andreas-name', 'cypher'), fehlerIst(403, 'nur_andreas_preset'));
  assert.equal(fs.existsSync(p('andreas-name')), true);
  // same slug (case change only): the in-place write drops the mark too
  s.speichere({ name: 'Same', geraet: 'komp', werte: KOMP }, { quelle: 'cypher' });
  s.benenne('komp', 'same', 'SAME', 'andreas');
  assert.equal(s.lies('nutzer', 'komp', 'same').autor, undefined);
  // negative control: Cypher renames her own, the mark stays and she may still delete it
  s.speichere({ name: 'Hers', geraet: 'komp', werte: KOMP }, { quelle: 'cypher' });
  s.benenne('komp', 'hers', 'Hers Renamed', 'cypher');
  assert.equal(s.lies('nutzer', 'komp', 'hers-renamed').autor, 'cypher');
  s.loesche('komp', 'hers-renamed', 'cypher');
  assert.equal(fs.existsSync(p('hers-renamed')), false);
  // negative control: Andreas renaming his own unmarked preset stays unmarked
  s.speichere({ name: 'His', geraet: 'komp', werte: KOMP });
  s.benenne('komp', 'his', 'His Two', 'andreas');
  assert.equal(s.lies('nutzer', 'komp', 'his-two').autor, undefined);
});
