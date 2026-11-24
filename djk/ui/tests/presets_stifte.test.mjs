// Kraken patch field, task 9: presets carry pins. Format `stifte: [[satz, zeile, spalte, wert], ...]` (steckfeld.ts normal form), only for device
// baukasten; applying a bk preset to a track replaces the pins (absent = graph defaults); saving from a track carries them; sound hash and
// duplicate detection see the pins, and a preset without pins keeps its old hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PresetSpeicher } from '../presets/store.ts';
import { PresetFehler } from '../presets/model.ts';
import { bauen } from '../presets/register.ts';
import { planeAnwendung, werteVonZiel } from '../presets/apply.ts';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';

function speicher(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-stifte-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  let n = 0;
  return new PresetSpeicher({ werk: path.join(d, 'werk'), nutzer: path.join(d, 'nutzer'), jetzt: () => new Date(Date.UTC(2026, 10, 19, 12, 0, n++)) });
}
const BESCHR = { art: 'bass', unterart: 'acid', charakter: ['dirty'], genre: ['acid'], einsatz: ['drop'], energie: 4, text: 'Acid line for the tests.' };
const BK = (name, extra = {}) => ({ name, geraet: 'baukasten', graph: 'kraken', werte: { knob1: 0.5 }, beschreibung: BESCHR, ...extra });
const PINS = [[0, 1, 2, 0.5], [0, 3, 4, -0.25], [1, 0, 0, 1]];
const grund = (f, code) => { try { f(); } catch (e) { assert.ok(e instanceof PresetFehler, String(e)); assert.equal(e.fehler, code); return e; } return assert.fail(`expected ${code}`); };

test('a Cypher Modular preset with valid pins is saved and read back equal', (t) => {
  const s = speicher(t);
  const r = s.speichere(BK('Pinned', { stifte: PINS }));
  assert.deepEqual(r.preset.stifte, PINS);
  assert.deepEqual(s.lies('nutzer', 'baukasten', r.slug).stifte, PINS);
  assert.equal(s.lies('nutzer', 'baukasten', s.speichere(BK('Plain')).slug).stifte, undefined, 'absent stays absent');
  assert.deepEqual(s.lies('nutzer', 'baukasten', s.speichere(BK('Empty', { stifte: [] })).slug).stifte, [], 'an empty list is a preset with no pins at all');
});

test('invalid pins are refused with stifte_ungueltig (400); on rb338 with stifte_verboten', (t) => {
  const s = speicher(t);
  for (const schlecht of [[[0, 1, 2]], [[2, 0, 0, 0.5]], [[0, 16, 0, 0.5]], [[0, 0, 0, 1.5]], [[0, 0, 0, 0]], [[0, 1, 2, 0.5], [0, 1, 2, 0.4]], [[0, 3, 4, 0.5], [0, 1, 2, 0.4]], 'x', {}]) {
    const e = grund(() => s.speichere(BK('Bad', { stifte: schlecht })), 'stifte_ungueltig');
    assert.equal(e.code, 400);
  }
  const e = grund(() => s.speichere({ name: 'Rb', geraet: 'rb338', werte: { cutoff: 1000 }, beschreibung: BESCHR, stifte: PINS }), 'stifte_verboten');
  assert.equal(e.code, 400);
});

test('a damaged file with bad pins is refused 409 and never repaired', (t) => {
  const s = speicher(t);
  const r = s.speichere(BK('Gut', { stifte: PINS }));
  const p = s.pfad('nutzer', 'baukasten', r.slug);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.stifte = [[0, 0, 0, 7]];
  fs.writeFileSync(p, JSON.stringify(j));
  const e = grund(() => s.lies('nutzer', 'baukasten', r.slug), 'preset_ungueltig');
  assert.equal(e.code, 409);
});

test('register: pins differ = other sound; identical pins = duplicate; a preset without pins keeps the old hash', (t) => {
  const s = speicher(t);
  s.speichere(BK('A', { stifte: PINS }));
  s.speichere(BK('B', { stifte: [[0, 1, 2, 0.6]] }));
  s.speichere(BK('Plain'));
  let r = bauen(s);
  assert.deepEqual(r.doppelt, []);
  const klang = Object.fromEntries(r.register.eintraege.map((e) => [e.name, e.klang]));
  s.speichere(BK('C', { stifte: PINS }));
  r = bauen(s);
  assert.deepEqual(r.doppelt.map((d) => d.ids.sort()), [['nutzer:baukasten/a', 'nutzer:baukasten/c']]);
  // the hash of a preset without stifte is what the old rule gave: sha256 of the canonical {geraet, werte, graph}
  const alt = bauen(s).register.eintraege.find((e) => e.name === 'Plain');
  assert.equal(alt.klang, klang.Plain);
  const roh = JSON.stringify({ geraet: 'baukasten', graph: 'kraken', werte: { knob1: 0.5 } });
  assert.equal(alt.klang, crypto_sha(roh));
});
import { createHash } from 'node:crypto';
const crypto_sha = (x) => createHash('sha256').update(x).digest('hex');

// project with one Kraken-like bk track (graph name only matters for the model)
function projekt(geraet) {
  let p = neuesProjekt('T');
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'instrument', name: 'K', geraet: { art: 'intern', name: 'bk', graph: 'kraken', parameter: { k1: 0.2 }, ...geraet } }], { quelle: 'andreas' }).projekt;
  return p;
}
const ZIEL = { art: 'spur', spur_id: 's1' };
const preset = (extra = {}) => ({ id: 'werk:baukasten/x', name: 'X', geraet: 'baukasten', graph: 'kraken', werte: { knob1: 0.5 }, ...extra });

test('apply with pins writes them, apply without pins drops the track pins (graph defaults), the plan runs through the model', () => {
  const p = projekt({ stifte: [[0, 9, 9, 0.9]] });
  const mit = planeAnwendung(preset({ stifte: PINS }), ZIEL, p);
  assert.deepEqual(mit.befehle[0].geraet.stifte, PINS);
  assert.deepEqual(fuehreListeAus(p, mit.befehle, {}).projekt.spuren[0].geraet.stifte, PINS);
  const ohne = planeAnwendung(preset(), ZIEL, p);
  assert.equal('stifte' in ohne.befehle[0].geraet, false, 'absent in the preset = graph defaults: the field is not written');
  assert.equal(fuehreListeAus(p, ohne.befehle, {}).projekt.spuren[0].geraet.stifte, undefined);
  const leer = planeAnwendung(preset({ stifte: [] }), ZIEL, p);
  assert.deepEqual(fuehreListeAus(p, leer.befehle, {}).projekt.spuren[0].geraet.stifte, [], 'an empty list clears every pin');
});

test('the freeze hint also fires when only the pins change', () => {
  let p = projekt({});
  p = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'intern', name: 'bk', graph: 'kraken', parameter: { k1: 0.5 } } }], {}).projekt;
  p.spuren[0].freeze = { rev: 1 };
  const gleichWerte = (x) => planeAnwendung(preset(x), ZIEL, p).hinweise;
  assert.equal(gleichWerte({}), undefined, 'same knobs, no pins both sides: nothing changes');
  assert.deepEqual(gleichWerte({ stifte: PINS }), ['freeze_geht']);
});

test('a channel target and a stage cannot carry pins: stifte is named in uebersprungen', () => {
  const pl = planeAnwendung(preset({ stifte: PINS }), { art: 'kanal', kanal: 'erz/1' }, null, 'kraken');
  assert.ok(pl.uebersprungen.includes('stifte'));
  assert.equal(planeAnwendung(preset(), { art: 'kanal', kanal: 'erz/1' }, null, 'kraken').uebersprungen.includes('stifte'), false);
});

test('save from a track carries its pins and applying it back gives an equal track', (t) => {
  const p = projekt({ stifte: PINS });
  const v = werteVonZiel(ZIEL, p);
  assert.deepEqual(v.stifte, PINS);
  const s = speicher(t);
  const r = s.speichere({ name: 'Back', geraet: v.geraet, graph: v.graph, werte: v.werte, stifte: v.stifte, beschreibung: BESCHR });
  const gelesen = s.lies('nutzer', 'baukasten', r.slug);
  const q = projekt({});
  const nach = fuehreListeAus(q, planeAnwendung({ ...gelesen, id: 'nutzer:baukasten/back' }, ZIEL, q).befehle, {}).projekt.spuren[0].geraet;
  assert.deepEqual(nach.stifte, PINS);
  assert.equal(werteVonZiel(ZIEL, projekt({})).stifte, undefined, 'a track on the graph defaults saves no pins');
});
