// Controller presets: the store (user folder over factory folder, slugs, delete) and the pure resolver (preset + base -> learn entries, default bank, skipped entries).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ControllerPresets, slugVon } from '../areas/controller/preset_store.ts';
import { bank, loese } from '../areas/controller/preset_aufloesen.ts';

function aufbau(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-ctl-presets-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const werk = path.join(d, 'werk'), nutzer = path.join(d, 'nutzer');
  return { d, werk, nutzer, s: new ControllerPresets({ werk, nutzer }) };
}
const instrument = (graph, eintraege, extra = {}) => ({ schema: 1, name: graph, modell: 'lc3', art: 'instrument', graph, eintraege, ...extra });
const fest = (name, eintraege) => ({ schema: 1, name, modell: 'lc3', art: 'fest', eintraege });
const wirft = (f, grund, code) => assert.throws(f, (e) => e.grund === grund && (code === undefined || e.code === code), `${grund} ${code ?? ''}`);
function werkDatei(x, modell, slug, preset) {
  fs.mkdirSync(path.join(x.werk, modell), { recursive: true });
  fs.writeFileSync(path.join(x.werk, modell, `${slug}.json`), JSON.stringify(preset));
}

test('slugVon: lower case, [a-z0-9-] only, at most 48 characters, nothing left gives an empty slug', () => {
  assert.equal(slugVon('DJ filters'), 'dj-filters');
  assert.equal(slugVon('--a--b--'), 'a-b');
  assert.equal(slugVon('a'.repeat(80)).length, 48);
  assert.equal(slugVon('!!!'), '');
  assert.equal(slugVon('synth_poly'), 'synth-poly');
});

test('store: an instrument preset is saved as the user file of (model, graph), replaced by the next save, listed with its id', (t) => {
  const x = aufbau(t);
  const id = x.s.speichere(instrument('synth-poly', [{ regler: 'Enc 1', knopf: 45 }]));
  assert.equal(id, 'nutzer:lc3/synth-poly');
  assert.ok(fs.existsSync(path.join(x.nutzer, 'lc3', 'synth-poly.json')));
  assert.equal(x.s.speichere(instrument('synth-poly', [{ regler: 'Enc 2', knopf: 3 }, { regler: 'Enc 3', knopf: 4 }])), id);
  assert.deepEqual(x.s.liste(), [{ id, name: 'synth-poly', modell: 'lc3', art: 'instrument', graph: 'synth-poly', herkunft: 'nutzer', eintraege_zahl: 2 }]);
  assert.deepEqual(fs.readdirSync(path.join(x.nutzer, 'lc3')), ['synth-poly.json'], 'no temp file is left behind');
});

test('store: a fest preset goes by the slug of its name, the same name replaces; the list filters by model and carries no graph', (t) => {
  const x = aufbau(t);
  const id = x.s.speichere(fest('DJ filters', [{ regler: 'Enc 1', pfad: 'deck/1/fader' }]));
  assert.equal(id, 'nutzer:lc3/dj-filters');
  assert.equal(x.s.speichere(fest('dj  FILTERS', [{ regler: 'Enc 1', pfad: 'deck/2/fader' }])), id);
  assert.equal(x.s.lies(id).preset.eintraege[0].pfad, 'deck/2/fader');
  x.s.speichere({ ...fest('LPD set', []), modell: 'lpd8' });
  assert.deepEqual(x.s.liste('lc3').map((p) => p.id), [id]);
  assert.deepEqual(x.s.liste().map((p) => p.id).sort(), [id, 'nutzer:lpd8/lpd-set']);
  assert.equal('graph' in x.s.liste('lc3')[0], false);
  wirft(() => x.s.speichere(fest('!!!', [])), 'argument_ungueltig', 400);
});

test('store: a user instrument preset wins over the factory one of the same (model, graph); the factory one is read-only and not deletable', (t) => {
  const x = aufbau(t);
  werkDatei(x, 'lc3', 'synth-poly', instrument('synth-poly', [{ regler: 'Enc 1', knopf: 1 }]));
  assert.equal(x.s.findeInstrument('lc3', 'synth-poly').id, 'werk:lc3/synth-poly');
  x.s.speichere(instrument('synth-poly', [{ regler: 'Enc 1', knopf: 9 }]));
  const f = x.s.findeInstrument('lc3', 'synth-poly');
  assert.equal(f.id, 'nutzer:lc3/synth-poly');
  assert.equal(f.preset.eintraege[0].knopf, 9);
  assert.equal(x.s.findeInstrument('lc3', 'other'), null);
  assert.equal(x.s.findeInstrument('lpd8', 'synth-poly'), null);
  wirft(() => x.s.loesche('werk:lc3/synth-poly'), 'werk_preset', 409);
  x.s.loesche('nutzer:lc3/synth-poly');
  assert.equal(x.s.findeInstrument('lc3', 'synth-poly').id, 'werk:lc3/synth-poly', 'the factory file comes back');
  assert.ok(fs.existsSync(path.join(x.werk, 'lc3', 'synth-poly.json')));
});

test('store: delete moves the user file into the trash folder; unknown and malformed ids are preset_unbekannt, never a path', (t) => {
  const x = aufbau(t);
  const id = x.s.speichere(fest('keep me', []));
  x.s.loesche(id);
  assert.equal(fs.existsSync(path.join(x.nutzer, 'lc3', 'keep-me.json')), false);
  assert.equal(fs.readdirSync(path.join(x.nutzer, '.papierkorb')).length, 1);
  wirft(() => x.s.loesche(id), 'preset_unbekannt', 404);
  for (const schlecht of ['nutzer:lc3/../x', 'nutzer:../lc3/x', '../../etc/passwd', 'nutzer:lc3/', 'foo:lc3/x', 'nutzer:lc3/A']) wirft(() => x.s.lies(schlecht), 'preset_unbekannt', 404);
});

test('store: a damaged or foreign file is left out of the list and never repaired; a missing folder is an empty list', (t) => {
  const x = aufbau(t);
  assert.deepEqual(x.s.liste(), []);
  fs.mkdirSync(path.join(x.nutzer, 'lc3'), { recursive: true });
  fs.writeFileSync(path.join(x.nutzer, 'lc3', 'broken.json'), '{ not json');
  fs.writeFileSync(path.join(x.nutzer, 'lc3', 'wrong.json'), JSON.stringify({ schema: 2, name: 'x' }));
  x.s.speichere(fest('ok', []));
  assert.deepEqual(x.s.liste().map((p) => p.id), ['nutzer:lc3/ok']);
  assert.equal(fs.readFileSync(path.join(x.nutzer, 'lc3', 'broken.json'), 'utf8'), '{ not json');
  wirft(() => x.s.lies('nutzer:lc3/broken'), 'preset_unbekannt', 404);
});

test('resolver: an instrument preset lands on the base, the control gives channel and CC; controls and knobs that do not exist are skipped with a reason', () => {
  const p = instrument('synth-poly', [{ regler: 'Enc 1', knopf: 45 }, { regler: 'Enc 2', knopf: 52 }, { regler: 'Enc 99', knopf: 1 }, { regler: 'Enc 3', knopf: 65 }, { regler: 'Enc 1', knopf: 2 }]);
  const r = loese(p, 'erz/5/bk/');
  assert.deepEqual(r.eintraege, [{ pfad: 'erz/5/bk/45', kanal: 0, nr: 13 }, { pfad: 'erz/5/bk/52', kanal: 0, nr: 14 }]);
  assert.deepEqual(r.uebersprungen, [{ regler: 'Enc 99', grund: 'regler_unbekannt' }, { regler: 'Enc 3', grund: 'ziel_ungueltig' }, { regler: 'Enc 1', grund: 'doppelt' }]);
});

test('resolver: a project track base spur/<slot>/bk/ resolves for slots 1..8 and skips everything above', () => {
  const p = instrument('synth-poly', [{ regler: 'Enc 1', knopf: 1 }]);
  assert.deepEqual(loese(p, 'spur/8/bk/').eintraege, [{ pfad: 'spur/8/bk/1', kanal: 0, nr: 13 }]);
  const r = loese(p, 'spur/9/bk/');
  assert.deepEqual(r.eintraege, []);
  assert.deepEqual(r.uebersprungen, [{ regler: 'Enc 1', grund: 'ziel_ungueltig' }]);
});

test('resolver: a fest preset keeps its absolute targets and the art follows the target (knob absolut, button taste); an unassignable target is skipped', () => {
  const p = fest('DJ filters', [{ regler: 'Enc 1', pfad: 'deck/1/fader' }, { regler: 'Btn 1', pfad: 'deck/1/pfl' }, { regler: 'Enc 2', pfad: 'nonsense/path' }, { regler: 'Btn 2', pfad: 'deck/1/play' }]);
  const r = loese(p, null);
  assert.deepEqual(r.eintraege, [{ pfad: 'deck/1/fader', kanal: 0, nr: 13 }, { pfad: 'deck/1/pfl', kanal: 0, nr: 37, art: 'taste' }, { pfad: 'deck/1/play', kanal: 0, nr: 38, art: 'taste' }]);
  assert.deepEqual(r.uebersprungen, [{ regler: 'Enc 2', grund: 'ziel_ungueltig' }]);
});

test('resolver: a pad of the device drives a switch as a note; a note on a continuous target is skipped', () => {
  const p = { schema: 1, name: 'pads', modell: 'lpd8', art: 'fest', eintraege: [{ regler: 'Pad 1', pfad: 'deck/1/pfl' }, { regler: 'Pad 2', pfad: 'deck/1/fader' }] };
  const r = loese(p, null);
  assert.deepEqual(r.eintraege, [{ pfad: 'deck/1/pfl', kanal: 0, nr: 36, typ: 'note', art: 'taste' }]);
  assert.deepEqual(r.uebersprungen, [{ regler: 'Pad 2', grund: 'ziel_ungueltig' }]);
});

test('resolver: a target another place already got is skipped as ziel_vergeben', () => {
  const p = instrument('g', [{ regler: 'Enc 1', knopf: 1 }, { regler: 'Enc 2', knopf: 2 }]);
  const r = loese(p, 'erz/5/bk/', new Set(['erz/5/bk/1']));
  assert.deepEqual(r.eintraege.map((e) => e.pfad), ['erz/5/bk/2']);
  assert.deepEqual(r.uebersprungen, [{ regler: 'Enc 1', grund: 'ziel_vergeben' }]);
});

test('bank: the default bank is the knobs of the device in layout order on knob 1, 2, 3 ...; buttons and pads are not part of it', () => {
  const lc3 = bank('lc3', 'erz/5/bk/').eintraege;
  assert.equal(lc3.length, 16);
  assert.deepEqual(lc3[0], { pfad: 'erz/5/bk/1', kanal: 0, nr: 13 });
  assert.deepEqual(lc3[15], { pfad: 'erz/5/bk/16', kanal: 0, nr: 28 });
  assert.deepEqual(bank('lc3', 'erz/5/bk/', new Set(), true).eintraege[0], { pfad: 'erz/5/bk/1', kanal: 0, nr: 13 }, 'on the DAW port too: any channel');
  const lpd = bank('lpd8', 'spur/3/bk/').eintraege;
  assert.deepEqual(lpd.map((e) => [e.pfad, e.kanal, e.nr]), Array.from({ length: 8 }, (_, i) => [`spur/3/bk/${i + 1}`, 0, i + 1]));
  assert.deepEqual(bank('unknown', 'erz/5/bk/'), { eintraege: [], uebersprungen: [] });
  assert.deepEqual(bank('lc3', 'spur/9/bk/').eintraege, [], 'a base without rows resolves to nothing');
});

test('resolver: a button with stufen steps a knob of the synth (art taste + stufen); a button without stufen cannot drive a knob', () => {
  const p = { schema: 1, name: 'g', modell: 'lc3', art: 'instrument', graph: 'g', eintraege: [{ regler: 'Enc 1', knopf: 1 }, { regler: 'Btn 1', knopf: 14, stufen: 3 }, { regler: 'Btn 2', knopf: 15 }] };
  const r = loese(p, 'spur/1/bk/');
  assert.deepEqual(r.eintraege, [{ pfad: 'spur/1/bk/1', kanal: 0, nr: 13 }, { pfad: 'spur/1/bk/14', kanal: 0, nr: 37, art: 'taste', stufen: 3 }]);
  assert.deepEqual(r.uebersprungen, [{ regler: 'Btn 2', grund: 'ziel_ungueltig' }]);
});
