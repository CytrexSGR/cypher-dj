// Media browser slice 3, task 7: kitMitKlang writes a COPY of a kit with one sound replaced or added; the old kit is never written.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KLANG_MAX_FRAMES, kitMitKlang } from '../sampler/kit.ts';
import { SchnittFehler } from '../sampler/schnitt.ts';

const wurzeln = [];
after(() => { for (const r of wurzeln) fs.rmSync(r, { recursive: true, force: true }); });

const stereo = (frames, f) => { const d = new Float32Array(frames * 2); for (let i = 0; i < frames; i++) { d[2 * i] = f(i); d[2 * i + 1] = f(i); } return d; };
// a kit `k` of two sounds at 36 (bd:0) and 37 (sd:0)
function neu(extra = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-klang-'));
  wurzeln.push(root);
  const o = { kits: path.join(root, 'kits') };
  fs.mkdirSync(path.join(o.kits, 'k'), { recursive: true });
  const klaenge = [];
  for (const [note, name, v] of [[36, 'bd:0', 0.25], [37, 'sd:0', 0.5]]) {
    fs.writeFileSync(path.join(o.kits, 'k', `${note}.f32`), Buffer.from(stereo(100, () => v).buffer));
    klaenge.push({ note, name, datei: `${note}.f32`, frames: 100, quelle: 'schnitt:x/1' });
  }
  for (let i = 0; i < extra; i++) {
    const note = 38 + i;
    fs.writeFileSync(path.join(o.kits, 'k', `${note}.f32`), Buffer.alloc(16));
    klaenge.push({ note, name: `perc:${i}`, datei: `${note}.f32`, frames: 2, quelle: 'x' });
  }
  fs.writeFileSync(path.join(o.kits, 'k', 'kit.json'), JSON.stringify({ schema: 1, name: 'k', klaenge }, null, 1));
  return { root, o };
}
const bytes = (o, kit) => Object.fromEntries(fs.readdirSync(path.join(o.kits, kit)).sort().map((n) => [n, fs.readFileSync(path.join(o.kits, kit, n)).toString('base64')]));
const wirft = (f, code, grund) => assert.throws(f, (e) => { assert.ok(e instanceof SchnittFehler, String(e)); assert.deepEqual([e.code, e.grund], [code, grund]); return true; });
const klick = stereo(2400, (i) => 0.8 * Math.sin(2 * Math.PI * 60 * i / 48000));

test('kitMitKlang replaces the sound at the note in a copy; the old kit stays byte-equal', () => {
  const { o } = neu();
  const vorher = bytes(o, 'k');
  const r = kitMitKlang({ kit: 'k', ton: 36, daten: klick, quelle: 'datei:abc' }, o);
  assert.deepEqual(r, { kit: 'k-2', name: 'bd:0', neu: false });
  assert.deepEqual(bytes(o, 'k'), vorher, 'the old kit is untouched');
  const j = JSON.parse(fs.readFileSync(path.join(o.kits, 'k-2', 'kit.json'), 'utf8'));
  assert.deepEqual([j.schema, j.name], [1, 'k-2']);
  assert.deepEqual(j.klaenge.map((k) => [k.note, k.name, k.datei, k.frames, k.quelle]), [[36, 'bd:0', '36.f32', 2400, 'datei:abc'], [37, 'sd:0', '37.f32', 100, 'schnitt:x/1']]);
  const b = fs.readFileSync(path.join(o.kits, 'k-2', '36.f32'));
  assert.equal(b.length, 2400 * 8);
  const y = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  assert.ok(Object.is(y[0], klick[0]) && Object.is(y[2000 * 2], klick[2000 * 2]), 'bit for bit before the fade');
  assert.equal(y[2399 * 2], 0, 'the 5 ms end fade ends at 0');
  assert.equal(fs.readFileSync(path.join(o.kits, 'k-2', '37.f32')).toString('base64'), vorher['37.f32'], 'the other sound is copied');
  assert.ok(!fs.existsSync(path.join(o.kits, 'k-2', '.sperre')));
  // a second and a third drop on the same kit: the counter goes on, nothing is overwritten
  assert.equal(kitMitKlang({ kit: 'k', ton: 37, daten: klick, quelle: 'datei:b' }, o).kit, 'k-3');
  assert.equal(kitMitKlang({ kit: 'k-3', ton: 36, daten: klick, quelle: 'datei:c' }, o).kit, 'k-3-2');
  assert.deepEqual(bytes(o, 'k'), vorher);
});

test('a new note gets the next name of its bank', () => {
  const { o } = neu();
  const r = kitMitKlang({ kit: 'k', ton: 60, daten: klick, quelle: 'datei:abc' }, o);
  assert.equal(r.neu, true);
  assert.match(r.name, /^(bd|sd|hh|perc):\d+$/);
  const j = JSON.parse(fs.readFileSync(path.join(o.kits, r.kit, 'kit.json'), 'utf8'));
  assert.deepEqual(j.klaenge.map((k) => k.note), [36, 37, 60]);
  assert.deepEqual([j.klaenge[2].name, j.klaenge[2].datei], [r.name, '60.f32']);
  // the bank is counted on: a second new sound of the same bank gets the next number
  const r2 = kitMitKlang({ kit: r.kit, ton: 61, daten: klick, quelle: 'datei:abd' }, o);
  const [bank, n] = r.name.split(':');
  assert.equal(r2.name, `${bank}:${Number(n) + 1}`);
});

test('a sound over 10 s is 400 klang_zu_lang and leaves no folder', () => {
  const { o } = neu();
  wirft(() => kitMitKlang({ kit: 'k', ton: 36, daten: new Float32Array((KLANG_MAX_FRAMES + 1) * 2), quelle: 'q' }, o), 400, 'klang_zu_lang');
  assert.deepEqual(fs.readdirSync(o.kits), ['k']);
  assert.equal(kitMitKlang({ kit: 'k', ton: 36, daten: stereo(KLANG_MAX_FRAMES, () => 0.1), quelle: 'q' }, o).kit, 'k-2', 'exactly 10 s is fine');
});

test('a folder without kit.json is 409 kit_fremd; a new note in a kit of 92 sounds is 409 kit_voll', () => {
  const { o } = neu();
  fs.mkdirSync(path.join(o.kits, 'leer'));
  wirft(() => kitMitKlang({ kit: 'leer', ton: 36, daten: klick, quelle: 'q' }, o), 409, 'kit_fremd');
  wirft(() => kitMitKlang({ kit: 'nix', ton: 36, daten: klick, quelle: 'q' }, o), 409, 'kit_fremd');
  fs.mkdirSync(path.join(o.kits, 'kaputt'));
  fs.writeFileSync(path.join(o.kits, 'kaputt', 'kit.json'), '{"schema": 2}');
  wirft(() => kitMitKlang({ kit: 'kaputt', ton: 36, daten: klick, quelle: 'q' }, o), 409, 'kit_fremd');
  const v = neu(90);   // 92 sounds, notes 36..127
  wirft(() => kitMitKlang({ kit: 'k', ton: 20, daten: klick, quelle: 'q' }, v.o), 409, 'kit_voll');
  assert.deepEqual(fs.readdirSync(v.o.kits), ['k'], 'no folder left');
  assert.equal(kitMitKlang({ kit: 'k', ton: 100, daten: klick, quelle: 'q' }, v.o).neu, false, 'replacing in a full kit is fine');
  for (const ton of [-1, 128, 1.5, '36']) wirft(() => kitMitKlang({ kit: 'k', ton, daten: klick, quelle: 'q' }, neu().o), 400, 'argument_ungueltig');
});
