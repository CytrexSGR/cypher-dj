// Preset descriptions: closed vocabulary, version bump guard, validation of a description (presets/DECISIONS.md P-V*)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ladeVokabular, pruefeVokabular, pruefeBeschreibung, inhaltPruefsumme, kanonisch, VokabularFehler, VOKABULAR_DATEI } from '../presets/vocabulary.ts';

const vok = ladeVokabular();
const roh = () => JSON.parse(fs.readFileSync(VOKABULAR_DATEI, 'utf8'));
const gut = () => ({ art: 'reverb', unterart: 'plate', charakter: ['bright', 'wet'], genre: ['house'], einsatz: ['breakdown'], energie: 2, text: 'Short bright plate for snares and vocals.' });
const codes = (f) => f.map((e) => `${e.feld}:${e.code}`);

test('vocabulary loads: version, checksum, kinds of both families, the words the product owner named', () => {
  assert.ok(Number.isInteger(vok.version) && vok.version >= 1);
  assert.equal(vok.pruefsumme, inhaltPruefsumme(roh().inhalt));
  for (const a of ['bass', 'lead', 'pad', 'keys', 'pluck', 'drums', 'percussion', 'fx']) assert.equal(vok.familieVon.get(a), 'instrument', a);
  for (const a of ['reverb', 'delay', 'compressor', 'eq', 'saturation', 'filter', 'modulation', 'utility']) assert.equal(vok.familieVon.get(a), 'effekt', a);
  assert.deepEqual(vok.inhalt.familien.effekt.reverb.slice(0, 4), ['room', 'hall', 'plate', 'spring']);
  for (const w of ['warm', 'bright', 'dark', 'punchy', 'soft', 'wide', 'mono', 'dry', 'wet', 'clean', 'dirty', 'evolving', 'aggressive', 'smooth']) assert.ok(vok.inhalt.charakter.includes(w), w);
  for (const w of ['techno', 'house', 'trance', 'ambient', 'dnb', 'electro', 'downtempo']) assert.ok(vok.inhalt.genre.includes(w), w);
  for (const w of ['intro', 'build', 'drop', 'breakdown', 'transition', 'mixdown', 'mastering']) assert.ok(vok.inhalt.einsatz.includes(w), w);
  assert.deepEqual(vok.inhalt.energie, { min: 1, max: 5 });
});

test('vocabulary 2: unsourced and non-timbre words are gone, every character word carries a meaning, warm means low-mid fullness', () => {
  for (const w of ['loose', 'organic', 'gritty', 'glassy', 'static', 'heavy', 'analog', 'digital']) assert.ok(!vok.inhalt.charakter.includes(w), w);
  assert.ok(vok.inhalt.familien.instrument.bass.includes('analog'), 'analog stays a sub-kind');
  assert.deepEqual(Object.keys(vok.inhalt.bedeutung).sort(), [...vok.inhalt.charakter].sort());
  assert.match(vok.inhalt.bedeutung.warm.sinn, /100-200 Hz/);
  assert.match(vok.inhalt.bedeutung.warm.eingriff, /up/);
});

test('a character word without a meaning, or a meaning without a word, is refused', () => {
  const ohne = structuredClone(JSON.parse(fs.readFileSync(VOKABULAR_DATEI, 'utf8')));
  delete ohne.inhalt.bedeutung.punchy;
  ohne.pruefsumme = inhaltPruefsumme(ohne.inhalt); ohne.verlauf.push({ version: 3, pruefsumme: ohne.pruefsumme }); ohne.version = 3;
  assert.throws(() => pruefeVokabular(ohne), /punchy has no meaning/);
  const fremd = structuredClone(JSON.parse(fs.readFileSync(VOKABULAR_DATEI, 'utf8')));
  fremd.inhalt.bedeutung.heavy = { sinn: 'x', messgroesse: 'x', eingriff: 'x', beleg: 'x' };
  fremd.pruefsumme = inhaltPruefsumme(fremd.inhalt); fremd.verlauf.push({ version: 3, pruefsumme: fremd.pruefsumme }); fremd.version = 3;
  assert.throws(() => pruefeVokabular(fremd), /heavy is not a character word/);
});

test('vocabulary pinned: version 1 has exactly this checksum (changing a list needs a bump and this line)', () => {
  const v = roh();
  assert.deepEqual(v.verlauf.map((e) => [e.version, e.pruefsumme]), [[1, '78ff33768468f89f'], [2, 'e78925bea504cdb1']]);
});

test('vocabulary edited without a version bump is refused with a hint', () => {
  const v = roh();
  v.inhalt.charakter.push('fat'); v.inhalt.bedeutung.fat = { sinn: 'x', messgroesse: 'x', eingriff: 'x', beleg: 'x' };
  assert.throws(() => pruefeVokabular(v), (e) => e instanceof VokabularFehler && /without a version bump/.test(e.message) && /Raise version/.test(e.message));
});

test('the bump guard fails on a loader that trusts the recorded checksum (deliberately broken implementation)', () => {
  const pruefung = (laden) => { const v = roh(); v.inhalt.charakter.push('fat'); v.inhalt.bedeutung.fat = { sinn: 'x', messgroesse: 'x', eingriff: 'x', beleg: 'x' }; assert.throws(() => laden(v), VokabularFehler); };
  pruefung(pruefeVokabular);
  // broken: recomputes the checksum and writes it back before checking, as an editor script that "fixes" the file would
  const vertrauend = (v) => { v.pruefsumme = inhaltPruefsumme(v.inhalt); v.verlauf.at(-1).pruefsumme = v.pruefsumme; return pruefeVokabular(v); };
  assert.throws(() => pruefung(vertrauend), assert.AssertionError);
});

test('vocabulary bump done right loads; reusing an old checksum or a non-rising version is refused', () => {
  const v = roh();
  v.inhalt.charakter.push('fat');
  v.inhalt.bedeutung.fat = { sinn: 'Full body.', messgroesse: 'Low-mid energy.', eingriff: 'Low mids up.', beleg: 'test' };
  const neu = inhaltPruefsumme(v.inhalt);
  v.version = 3; v.pruefsumme = neu; v.verlauf.push({ version: 3, pruefsumme: neu, datum: '2026-11-03', aenderung: 'add fat' });
  const v2 = pruefeVokabular(structuredClone(v));
  assert.equal(v2.version, 3);
  assert.deepEqual(pruefeBeschreibung({ ...gut(), charakter: ['fat'] }, v2), []);

  const zurueck = structuredClone(v);   // content changed back to version 2 under a new version number
  zurueck.inhalt.charakter.pop(); delete zurueck.inhalt.bedeutung.fat;
  zurueck.version = 4; zurueck.pruefsumme = inhaltPruefsumme(zurueck.inhalt);
  zurueck.verlauf.push({ version: 4, pruefsumme: zurueck.pruefsumme });
  assert.throws(() => pruefeVokabular(zurueck), /appears twice/);

  const gleich = structuredClone(v);
  gleich.verlauf[2].version = 2; gleich.version = 2;
  assert.throws(() => pruefeVokabular(gleich), /rise strictly/);
});

test('vocabulary structure: a kind in two families, duplicate words, malformed words, bad opposites are refused', () => {
  const mit = (f) => { const v = roh(); f(v.inhalt); v.pruefsumme = inhaltPruefsumme(v.inhalt); v.verlauf.at(-1).pruefsumme = v.pruefsumme; return v; };
  assert.throws(() => pruefeVokabular(mit((i) => { i.familien.effekt.bass = ['sub']; })), /more than one family/);
  assert.throws(() => pruefeVokabular(mit((i) => { i.genre.push('techno'); })), /duplicate word techno/);
  assert.throws(() => pruefeVokabular(mit((i) => { i.genre.push('Deep House'); })), /malformed word/);
  assert.throws(() => pruefeVokabular(mit((i) => { i.gegensaetze.push(['warm', 'fat']); })), /gegensaetze/);
});

test('description: a valid one has no errors; effect without genre is allowed', () => {
  assert.deepEqual(pruefeBeschreibung(gut(), vok), []);
  assert.deepEqual(pruefeBeschreibung({ ...gut(), genre: [] }, vok), []);
});

test('description: unknown tags are rejected in every list, with the allowed words attached', () => {
  const f = pruefeBeschreibung({ ...gut(), art: 'reverbs', charakter: ['fat', 'bright'], genre: ['schranz'], einsatz: ['peak'] }, vok);
  assert.deepEqual(codes(f), ['art:unbekanntes_wort', 'charakter:unbekanntes_wort', 'genre:unbekanntes_wort', 'einsatz:unbekanntes_wort']);
  assert.ok(f[1].erlaubt.includes('warm'));
  assert.equal(f[1].wert, 'fat');
});

test('description: sub-kind must belong to the kind', () => {
  const f = pruefeBeschreibung({ ...gut(), unterart: 'acid' }, vok);
  assert.deepEqual(codes(f), ['unterart:unbekanntes_wort']);
  assert.deepEqual(f[0].erlaubt, vok.inhalt.familien.effekt.reverb);
  assert.deepEqual(pruefeBeschreibung({ ...gut(), art: 'bass', unterart: 'acid' }, vok), []);
});

test('description: missing and extra fields, duplicates, counts, opposites, energy range', () => {
  const { text, ...ohneText } = gut();
  assert.deepEqual(codes(pruefeBeschreibung({ ...ohneText, farbe: 'rot' }, vok)), ['farbe:unbekanntes_feld', 'text:fehlt']);
  assert.deepEqual(codes(pruefeBeschreibung({ ...gut(), charakter: ['wet', 'wet'] }, vok)), ['charakter:doppelt']);
  assert.deepEqual(codes(pruefeBeschreibung({ ...gut(), charakter: [] }, vok)), ['charakter:anzahl']);
  assert.deepEqual(codes(pruefeBeschreibung({ ...gut(), charakter: ['warm', 'wide', 'wet', 'soft', 'deep', 'airy', 'smooth'] }, vok)), ['charakter:anzahl']);
  assert.deepEqual(codes(pruefeBeschreibung({ ...gut(), charakter: ['dry', 'wet'] }, vok)), ['charakter:widerspruch']);
  for (const e of [0, 6, 2.5, '3']) assert.deepEqual(codes(pruefeBeschreibung({ ...gut(), energie: e }, vok)), ['energie:bereich'], String(e));
  assert.deepEqual(codes(pruefeBeschreibung('reverb', vok)), ['beschreibung:typ']);
  assert.deepEqual(codes(pruefeBeschreibung({ ...gut(), genre: 'house' }, vok)), ['genre:typ']);
});

test('description: text is exactly one sentence of sensible length', () => {
  const t = (text) => codes(pruefeBeschreibung({ ...gut(), text }, vok));
  assert.deepEqual(t('Short plate. Use it on snares.'), ['text:satz']);
  assert.deepEqual(t('Short plate\nfor snares.'), ['text:satz']);
  assert.deepEqual(t('Short plate for snares'), ['text:satz']);
  assert.deepEqual(t('Too short.'), []);
  assert.deepEqual(t('Short.'), ['text:laenge']);
  assert.deepEqual(t(` ${gut().text}`), ['text:laenge']);
  assert.deepEqual(t(`${'a'.repeat(vok.inhalt.text.max_zeichen)}.`), ['text:laenge']);
  assert.deepEqual(t('Plate at 1.5 s decay, e.g. for snares.'), []);
});

test('canonical JSON ignores key order', () => {
  assert.equal(kanonisch({ b: 1, a: [{ d: 2, c: 3 }] }), kanonisch({ a: [{ c: 3, d: 2 }], b: 1 }));
});
