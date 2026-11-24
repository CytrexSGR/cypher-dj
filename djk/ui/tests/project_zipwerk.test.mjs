// Browser plan 5, task 1: the Node wrapper around zipwerk.py, temp folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { entpacke, packe, zipGroesse, ZipFehler } from '../project/zipwerk.ts';

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zipwerk-w-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
const baum = (w, o) => { for (const [n, b] of Object.entries(o)) { const p = path.join(w, n); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, b); } };
const lies = (w) => Object.fromEntries(fs.readdirSync(w, { recursive: true }).filter((n) => fs.statSync(path.join(w, n)).isFile()).sort().map((n) => [n, fs.readFileSync(path.join(w, n)).toString('hex')]));

test('packe then entpacke through the wrapper restores the tree', async (t) => {
  const d = tmp(t);
  baum(path.join(d, 'q'), { 'project.json': '{}', 'audio/a.f32': Buffer.from([1, 2, 3]), '.versionen/x.json': '1' });
  const r = await packe(path.join(d, 'q'), path.join(d, 'o.zip'), { ohne: ['.versionen/'] });
  assert.equal(r.eintraege, 2);
  assert.deepEqual(r.ausgelassen, ['.versionen/']);
  const e = await entpacke(path.join(d, 'o.zip'), path.join(d, 'aus'));
  assert.equal(e.eintraege, 2);
  assert.deepEqual(lies(path.join(d, 'aus')), { 'project.json': Buffer.from('{}').toString('hex'), 'audio/a.f32': '010203' });
});

test('a zip with a ../ entry makes entpacke throw ZipFehler with a non-empty grund and leaves no target folder', async (t) => {
  const d = tmp(t);
  execFileSync('python3', ['-I', '-c', 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w")\nz.writestr("../x.txt","x")\nz.close()', path.join(d, 'b.zip')]);
  await assert.rejects(entpacke(path.join(d, 'b.zip'), path.join(d, 'aus')), (e) => e instanceof ZipFehler && e.grund.length > 0);
  assert.equal(fs.existsSync(path.join(d, 'aus')), false);
  assert.deepEqual(fs.readdirSync(d), ['b.zip']);
});

test('packe with the entry cap throws ZipFehler zu_viele_eintraege', async (t) => {
  const d = tmp(t);
  baum(path.join(d, 'q'), { a: '1', b: '2', c: '3', e: '4' });
  await assert.rejects(packe(path.join(d, 'q'), path.join(d, 'o.zip'), { maxEintraege: 3 }), (e) => e instanceof ZipFehler && e.grund === 'zu_viele_eintraege');
  assert.equal(fs.existsSync(path.join(d, 'o.zip')), false);
});

test('zipGroesse returns entries and bytes of a packed tree', async (t) => {
  const d = tmp(t);
  baum(path.join(d, 'q'), { a: 'x'.repeat(10), 'd/b': 'y'.repeat(5) });
  await packe(path.join(d, 'q'), path.join(d, 'o.zip'));
  assert.deepEqual(await zipGroesse(path.join(d, 'o.zip')), { eintraege: 2, bytes: 15 });
});
