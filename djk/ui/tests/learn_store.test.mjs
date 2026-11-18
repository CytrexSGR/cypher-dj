// S19 (MIDI learn): the store of lernen.json. Mapping-v1 shape, one entry per line, no "kurve", 1:1 (one CC <-> one knob), .bak of the previous
// file, a file that does not parse is "kaputt" and never overwritten, entries the server did not write survive every change.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LernSpeicher, LernFehler } from '../areas/learn/store.ts';

const ordner = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-lernen-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const lies = (d) => fs.readFileSync(path.join(d, 'lernen.json'), 'utf8');
const grund = (f) => { try { f(); } catch (e) { return e instanceof LernFehler ? `${e.grund}/${e.code}` : String(e); } return null; };

test('S19 speicher: a missing file reads as empty; the first assignment writes a Mapping-v1 file, one absolute entry per line, no kurve', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  assert.deepEqual(s.lies(), { datei: 'fehlt', eintraege: [], zuordnungen: [] });
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  const j = JSON.parse(lies(d));
  assert.deepEqual([j.version, j.geraet, j.quelle_port], [1, 'lernen', 'midi_ein_1']);
  assert.deepEqual(j.eintraege, [{ nachricht: { typ: 'cc', kanal: 1, nr: 74 }, ziel: 'erz/5/bk/3', art: 'absolut' }]);
  assert.ok(!('kurve' in j.eintraege[0]));
  assert.equal(lies(d).split('\n').filter((z) => z.includes('"ziel"')).length, 1, 'one entry per line');
  assert.deepEqual(s.lies().zuordnungen, [{ pfad: 'erz/5/bk/3', kanal: 1, nr: 74, platz: 1 }]);
});

test('S19 speicher: one CC <-> one knob: assigning 75 to a knob that has 74 removes 74; assigning a CC that drives another knob moves it', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  s.zuordne({ pfad: 'deck/1/bk/1', kanal: 1, nr: 75 });
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 75 });   // 75 now drives erz/5/bk/3: deck/1/bk/1 loses its CC, and the old 74 entry of this knob goes
  assert.deepEqual(s.lies().zuordnungen, [{ pfad: 'erz/5/bk/3', kanal: 1, nr: 75, platz: 1 }]);
});

test('S19 speicher: the previous file is kept as .bak; stelleWiederHer puts it back; a first file that is refused is removed again', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  const erste = lies(d);
  assert.ok(!fs.existsSync(path.join(d, 'lernen.json.bak')), 'no previous file, no .bak');
  s.stelleWiederHer();
  assert.ok(!fs.existsSync(path.join(d, 'lernen.json')), 'the refused first file is removed again');
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  assert.equal(lies(d), erste);
  s.zuordne({ pfad: 'deck/1/bk/2', kanal: 2, nr: 10 });
  assert.equal(fs.readFileSync(path.join(d, 'lernen.json.bak'), 'utf8'), erste, '.bak equals the previous file');
  assert.notEqual(lies(d), erste);
  s.stelleWiederHer();
  assert.equal(lies(d), erste, 'restored');
});

test('S19 speicher: a file that does not parse is kaputt and is never overwritten (byte-identical afterwards)', (t) => {
  const d = ordner(t);
  fs.writeFileSync(path.join(d, 'lernen.json'), '{"version":1,');
  const s = new LernSpeicher(d);
  assert.equal(s.lies().datei, 'kaputt');
  assert.equal(grund(() => s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 })), 'lernen_datei_kaputt/409');
  assert.equal(grund(() => s.loesche('erz/5/bk/3')), 'lernen_datei_kaputt/409');
  assert.equal(lies(d), '{"version":1,');
  fs.writeFileSync(path.join(d, 'lernen.json'), JSON.stringify({ version: 2, geraet: 'lernen', quelle_port: 'x', eintraege: [] }));
  assert.equal(s.lies().datei, 'kaputt', 'wrong shape (version 2) is kaputt as well');
});

test('S19 speicher: entries the server did not write (a hand-written note entry) survive an assignment of another CC unchanged', (t) => {
  const d = ordner(t);
  const hand = { nachricht: { typ: 'note', kanal: 1, nr: 36 }, ziel: 'deck/1/play', art: 'taste' };
  fs.writeFileSync(path.join(d, 'lernen.json'), JSON.stringify({ version: 1, geraet: 'lernen', quelle_port: 'midi_ein_1', eintraege: [hand] }));
  const s = new LernSpeicher(d);
  assert.deepEqual(s.lies().zuordnungen, [{ pfad: 'deck/1/play', kanal: 1, nr: 36, platz: 1, typ: 'note', art: 'taste' }], 'a note "taste" entry reads as a pad assignment');
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  assert.deepEqual(JSON.parse(lies(d)).eintraege[0], hand);
  s.loesche('erz/5/bk/3');
  assert.deepEqual(JSON.parse(lies(d)).eintraege, [hand]);
  // entries that are none of ours (a relative encoder, a touch) stay out of the list and survive as well
  const fremd = [{ nachricht: { typ: 'cc', kanal: 1, nr: 20 }, ziel: 'deck/1/filter', art: 'relativ', kodierung: 'versatz64' }, hand];
  fs.writeFileSync(path.join(d, 'lernen.json'), JSON.stringify({ version: 1, geraet: 'lernen', quelle_port: 'midi_ein_1', eintraege: fremd }));
  assert.deepEqual(s.lies().zuordnungen.map((z) => z.pfad), ['deck/1/play']);
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  assert.deepEqual(JSON.parse(lies(d)).eintraege.slice(0, 2), fremd);
});

test('S19 speicher: loesche removes the entry of a knob; without an entry it is 404 keine_zuordnung and writes nothing', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  const vorher = lies(d);
  assert.equal(grund(() => s.loesche('deck/1/bk/2')), 'keine_zuordnung/404');
  assert.equal(lies(d), vorher);
  s.loesche('erz/5/bk/3');
  assert.deepEqual(s.lies().zuordnungen, []);
  assert.equal(JSON.parse(lies(d)).eintraege.length, 0);
});

test('S19 speicher: lies() lists an absolute CC entry on any continuous target (not only bk) as an assignment', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  s.zuordne({ pfad: 'deck/1/fader', kanal: 2, nr: 21 });
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  assert.deepEqual(s.lies().zuordnungen, [{ pfad: 'deck/1/fader', kanal: 2, nr: 21, platz: 1 }, { pfad: 'erz/5/bk/3', kanal: 1, nr: 74, platz: 1 }]);
});

test('controller places: a CC learned on place 2 goes to lernen-2.json with device name lernen-2 and raw input midi_ein_2; the same CC on place 1 stays', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  assert.deepEqual(s.zuordne({ pfad: 'deck/1/fader', kanal: 1, nr: 7 }), [1]);
  assert.deepEqual(s.zuordne({ pfad: 'deck/2/fader', kanal: 1, nr: 7, platz: 2 }), [2], 'only the file of place 2 changed');
  const j = JSON.parse(fs.readFileSync(path.join(d, 'lernen-2.json'), 'utf8'));
  assert.deepEqual([j.version, j.geraet, j.quelle_port], [1, 'lernen-2', 'midi_ein_2']);
  assert.deepEqual(s.lies().zuordnungen, [{ pfad: 'deck/1/fader', kanal: 1, nr: 7, platz: 1 }, { pfad: 'deck/2/fader', kanal: 1, nr: 7, platz: 2 }]);
});

test('controller places: one target has one source over all places; deleting names the changed places; a restore covers every changed place', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  s.zuordne({ pfad: 'deck/1/fader', kanal: 1, nr: 7 });
  const vorher = lies(d);
  assert.deepEqual(s.zuordne({ pfad: 'deck/1/fader', kanal: 3, nr: 20, platz: 2 }), [1, 2], 'the knob moves from place 1 to place 2: both files change');
  assert.deepEqual(s.lies().zuordnungen, [{ pfad: 'deck/1/fader', kanal: 3, nr: 20, platz: 2 }]);
  s.stelleWiederHer([1, 2]);
  assert.equal(lies(d), vorher, 'place 1 is back');
  assert.ok(!fs.existsSync(path.join(d, 'lernen-2.json')), 'the first file of place 2 is removed again');
  s.zuordne({ pfad: 'deck/1/fader', kanal: 3, nr: 20, platz: 2 });
  assert.deepEqual(s.loesche('deck/1/fader'), [2]);
  assert.equal(grund(() => s.loesche('deck/1/fader')), 'keine_zuordnung/404');
});

test('controller places: a damaged file of any place makes the state kaputt and refuses writes; no file is touched', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  s.zuordne({ pfad: 'deck/1/fader', kanal: 1, nr: 7 });
  fs.writeFileSync(path.join(d, 'lernen-3.json'), '{"version":1,"geraet":"lernen","quelle_port":"midi_ein_3","eintraege":[]}');   // wrong device name for place 3
  assert.equal(s.lies().datei, 'kaputt');
  assert.equal(grund(() => s.zuordne({ pfad: 'deck/2/fader', kanal: 1, nr: 8 })), 'lernen_datei_kaputt/409');
});

test('S19 speicher: a button or pad is written with typ and art and read back; the default (a CC absolut) keeps the old shape without typ and art', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  s.zuordne({ pfad: 'deck/1/pfl', kanal: 1, nr: 36, typ: 'note', art: 'taste' });
  s.zuordne({ pfad: 'deck/1/kill/tief', kanal: 16, nr: 37, art: 'taste' });
  s.zuordne({ pfad: 'deck/1/filter', kanal: 16, nr: 13 });
  assert.deepEqual(JSON.parse(lies(d)).eintraege, [
    { nachricht: { typ: 'note', kanal: 1, nr: 36 }, ziel: 'deck/1/pfl', art: 'taste' },
    { nachricht: { typ: 'cc', kanal: 16, nr: 37 }, ziel: 'deck/1/kill/tief', art: 'taste' },
    { nachricht: { typ: 'cc', kanal: 16, nr: 13 }, ziel: 'deck/1/filter', art: 'absolut' }]);
  assert.deepEqual(s.lies().zuordnungen, [
    { pfad: 'deck/1/pfl', kanal: 1, nr: 36, platz: 1, typ: 'note', art: 'taste' },
    { pfad: 'deck/1/kill/tief', kanal: 16, nr: 37, platz: 1, art: 'taste' },
    { pfad: 'deck/1/filter', kanal: 16, nr: 13, platz: 1 }]);
  assert.equal(lies(d).split('\n').filter((z) => z.includes('"ziel"')).length, 3, 'one entry per line');
});

test('S19 speicher: one source drives one target: a note and a CC with the same number are two sources, the same note on a second target replaces the first', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  s.zuordne({ pfad: 'deck/1/pfl', kanal: 1, nr: 36, typ: 'note', art: 'taste' });
  s.zuordne({ pfad: 'deck/1/filter', kanal: 1, nr: 36 });
  assert.deepEqual(s.lies().zuordnungen.map((z) => [z.pfad, z.typ ?? 'cc']), [['deck/1/pfl', 'note'], ['deck/1/filter', 'cc']]);
  s.zuordne({ pfad: 'deck/2/pfl', kanal: 1, nr: 36, typ: 'note', art: 'taste' });
  assert.deepEqual(s.lies().zuordnungen.map((z) => [z.pfad, z.typ ?? 'cc']), [['deck/1/filter', 'cc'], ['deck/2/pfl', 'note']], 'deck/1/pfl lost its pad');
  s.zuordne({ pfad: 'deck/2/pfl', kanal: 1, nr: 37, typ: 'note', art: 'taste' });
  assert.deepEqual(s.lies().zuordnungen.filter((z) => z.typ === 'note').map((z) => z.nr), [37], 'the target moved to the new pad');
  s.zuordne({ pfad: 'deck/3/pfl', kanal: 1, nr: 37, typ: 'note', art: 'taste' });
  assert.deepEqual(s.lies().zuordnungen.filter((z) => z.typ === 'note').map((z) => z.pfad), ['deck/3/pfl']);
  // the same pad number on another place is another device's pad: not replaced
  s.zuordne({ pfad: 'deck/4/pfl', kanal: 1, nr: 37, platz: 2, typ: 'note', art: 'taste' });
  assert.deepEqual(s.lies().zuordnungen.filter((z) => z.typ === 'note').map((z) => [z.platz, z.pfad]), [[1, 'deck/3/pfl'], [2, 'deck/4/pfl']]);
  assert.equal(grund(() => s.zuordne({ pfad: 'deck/1/fader', kanal: 1, nr: 40, typ: 'note' })), 'argument_ungueltig/400', 'a note cannot be absolut: the loader would refuse the file');
});
