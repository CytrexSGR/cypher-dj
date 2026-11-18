// Studio follows the time signature n/4, T0: the meter file beside strom1.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leseTaktart, schreibeTaktart, TAKTART_DATEI } from '../src/taktart_file.mjs';

const ordner = () => fs.mkdtempSync(path.join(os.tmpdir(), 'taktart-'));

test('leseTaktart: no file gives 4', () => {
  assert.equal(leseTaktart(ordner()), 4);
});

test("leseTaktart: file '3' gives 3", () => {
  const o = ordner();
  fs.writeFileSync(path.join(o, TAKTART_DATEI), '3');
  assert.equal(leseTaktart(o), 3);
});

test('leseTaktart: file removed after 3 gives 4 (ENOENT means 4)', () => {
  const o = ordner();
  fs.writeFileSync(path.join(o, TAKTART_DATEI), '3');
  assert.equal(leseTaktart(o), 3);
  fs.unlinkSync(path.join(o, TAKTART_DATEI));
  assert.equal(leseTaktart(o, 3), 4);
});

test('leseTaktart: garbage keeps letzter and never throws', () => {
  const o = ordner();
  for (const text of ['x', '', '13', '3x', '1', '3.5']) {
    fs.writeFileSync(path.join(o, TAKTART_DATEI), text);
    assert.equal(leseTaktart(o, 5), 5, JSON.stringify(text));
  }
  fs.writeFileSync(path.join(o, TAKTART_DATEI), '3\n');
  assert.equal(leseTaktart(o, 5), 3);
});

test('leseTaktart: a directory in place of the file (EISDIR) keeps letzter', () => {
  const o = ordner();
  fs.mkdirSync(path.join(o, TAKTART_DATEI));
  assert.equal(leseTaktart(o, 6), 6);
});

test('schreibeTaktart(4) with no file creates nothing (listing identical, folder may be missing)', () => {
  const o = ordner();
  fs.writeFileSync(path.join(o, 'strom1.js'), 'x');
  const vorher = fs.readdirSync(o);
  schreibeTaktart(o, 4);
  assert.deepEqual(fs.readdirSync(o), vorher);
  const fehlt = path.join(o, 'gibts-nicht');
  schreibeTaktart(fehlt, 4);
  assert.equal(fs.existsSync(fehlt), false);
});

test("schreibeTaktart(3) writes '3' atomically (no *.neu left), then (4) removes it", () => {
  const o = path.join(ordner(), 'neu');
  schreibeTaktart(o, 3);
  assert.equal(fs.readFileSync(path.join(o, TAKTART_DATEI), 'utf8'), '3');
  assert.deepEqual(fs.readdirSync(o).filter((f) => f.endsWith('.neu')), []);
  schreibeTaktart(o, 4);
  assert.deepEqual(fs.readdirSync(o), []);
});
