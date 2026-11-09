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
  assert.deepEqual(s.lies().zuordnungen, [{ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 }]);
});

test('S19 speicher: one CC <-> one knob: assigning 75 to a knob that has 74 removes 74; assigning a CC that drives another knob moves it', (t) => {
  const d = ordner(t);
  const s = new LernSpeicher(d);
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  s.zuordne({ pfad: 'deck/1/bk/1', kanal: 1, nr: 75 });
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 75 });   // 75 now drives erz/5/bk/3: deck/1/bk/1 loses its CC, and the old 74 entry of this knob goes
  assert.deepEqual(s.lies().zuordnungen, [{ pfad: 'erz/5/bk/3', kanal: 1, nr: 75 }]);
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
  assert.deepEqual(s.lies().zuordnungen, [], 'a note entry is not a knob assignment');
  s.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  assert.deepEqual(JSON.parse(lies(d)).eintraege[0], hand);
  s.loesche('erz/5/bk/3');
  assert.deepEqual(JSON.parse(lies(d)).eintraege, [hand]);
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
