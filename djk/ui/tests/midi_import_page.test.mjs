// MIDI import on the page (public/production/midi_import.js): the pure parts. The real clicks, the file input and the large file are the browser
// probe pruef/probe_midi_import.mjs. Fixtures are built from bytes; the report comes from the real planner, not from a hand-written object.
import test from 'node:test';
import assert from 'node:assert/strict';
import { base64Von, vorschauModell, importFehlerText, importKoerper, MIDI_FEHLER } from '../public/production/midi_import.js';
import { FEHLER_TEXT, fehlerText } from '../public/production/production.js';
import { leseSmf } from '../project/smf.ts';
import { planeImport } from '../project/midi_import.ts';
import { neuesProjekt } from '../project/model.ts';
import { smf, spur, nameMeta, tempoMeta, taktMeta, programm, note, an, aus } from './helpers/smf_build.mjs';

const GM = { name: 'gm', noten: new Set([36, 38, 42]) };
const ctx = { gmKit: GM, kitDa: (n) => n === 'gm', graphArt: () => null };
const datei = () => leseSmf(smf([
  spur([nameMeta('conductor'), tempoMeta(96), taktMeta(3, 2)]),
  spur([nameMeta('Lead'), programm(0, 80), an(0, 60, 100), an(0, 64, 100), aus(0, 60, 96), aus(0, 64, 0), ...note(0, 67, 100, 96, 96)]),   // a two-note chord, then one note
  spur([nameMeta('Kit'), ...note(9, 36, 110, 48)]),
]));
const antwort = (p = neuesProjekt('t')) => ({ vorschau: true, offen: true, bericht: { ...planeImport(datei(), p, {}, ctx).bericht, datei_name: 'song' } });

test('base64Von matches Buffer for sizes around the chunk limit', () => {
  for (const n of [0, 1, 2, 3, 0x7fff, 0x8000, 0x8001, 70000]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
    assert.equal(base64Von(b), Buffer.from(b).toString('base64'), `n=${n}`);
  }
});

test('the preview model names tracks, notes, tempo and the 3/4 hint, and one row per part with its instrument', () => {
  const m = vorschauModell(antwort(), true);
  assert.equal(m.name, 'song');
  assert.match(m.kopf.join(' | '), /2 of 3 MIDI tracks have notes/);
  assert.match(m.kopf.join(' | '), /96 BPM \(taken over\)/);
  assert.match(m.kopf.join(' | '), /time signature 3\/4 in the file, the project is 4\/4/);
  assert.deepEqual(m.zeilen.map((z) => [z.schluessel, z.name, z.noten, z.schlagzeug]), [['1.1', 'Lead', 3, false], ['2.10', 'Kit', 1, true]]);
  assert.match(m.zeilen[0].text, /RB-338/); assert.match(m.zeilen[1].text, /kit gm/);
  assert.equal(m.zeilen[0].mono, true, 'a chord part on the monophonic RB-338 is marked');
  assert.equal(m.anlegbar, true);
});

test('no open project: the model says so and the import stays off; a non-empty project keeps its tempo and says so', () => {
  const m = vorschauModell(antwort(), false);
  assert.equal(m.anlegbar, false);
  assert.match(m.hinweise[0], /No project is open/);
  const voll = neuesProjekt('t');
  voll.spuren.push({ id: 's1', nr: 1, name: 'x', art: 'audio', clips: [] });
  assert.match(vorschauModell(antwort(voll), true).kopf.join(' | '), /96 BPM in the file \(project tempo kept\)/);
});

test('a null report gives no model; a not-fitting report is not importable and carries the reason', () => {
  assert.equal(vorschauModell({}, true), null);
  const a = antwort();
  a.bericht.anlegbar = false; a.bericht.grund = 'midi_zu_viele_spuren'; a.bericht.grund_text = '33 parts need 33 tracks but 2 are free';
  const m = vorschauModell(a, true);
  assert.equal(m.anlegbar, false);
  assert.equal(m.hinweise[0], '33 parts need 33 tracks but 2 are free');
});

test('every reason the import can answer has a page text (FEHLER_TEXT), never "Rejected: <code>"', () => {
  for (const [k, t] of Object.entries(MIDI_FEHLER)) {
    assert.equal(FEHLER_TEXT[k], t, k);
    assert.ok(!/Rejected/.test(fehlerText({ status: 409, j: { fehler: k } })), k);
  }
  for (const k of ['smf_kein_smf', 'smf_format2', 'smf_smpte', 'smf_beschaedigt', 'smf_leer', 'midi_keine_noten', 'midi_schluessel_unbekannt', 'midi_zu_viele_spuren', 'midi_zu_lang', 'midi_datei_zu_gross', 'midi_datei_fehlt']) {
    assert.ok(MIDI_FEHLER[k], `${k} has a text`);
  }
});

test('importFehlerText adds the server detail to a known reason and falls back to the generic text for others', () => {
  assert.equal(importFehlerText({ status: 409, j: { fehler: 'midi_zu_viele_spuren', detail: '33 needed, 2 free' } }, fehlerText), `${MIDI_FEHLER.midi_zu_viele_spuren} (33 needed, 2 free)`);
  assert.equal(importFehlerText({ status: 409, j: { fehler: 'kein_projekt' } }, fehlerText), 'No project open');
  assert.equal(importFehlerText({ status: 409, j: { fehler: 'kein_projekt', detail: 'x' } }, fehlerText), 'No project open', 'detail only follows the import reasons');
  assert.equal(importFehlerText({ status: 400, j: { fehler: 'smf_kein_smf', detail: 'not a Standard MIDI File (no MThd header)' } }, fehlerText), MIDI_FEHLER.smf_kein_smf, 'no doubled text');
  assert.match(importFehlerText({ status: 400, j: { fehler: 'smf_beschaedigt', detail: 'header length 7 is invalid' } }, fehlerText), /\(header length 7 is invalid\)$/);
});

test('importKoerper sends the selection only when a part is unticked; extra fields (rev) are kept', () => {
  assert.deepEqual(importKoerper('QQ==', 'song', ['1.1', '2.10'], ['a', 'b'], { rev: 4 }), { daten_b64: 'QQ==', name: 'song', rev: 4 });
  assert.deepEqual(importKoerper('QQ==', 'song', ['2.10'], ['a', 'b']), { daten_b64: 'QQ==', name: 'song', auswahl: ['2.10'] });
});
