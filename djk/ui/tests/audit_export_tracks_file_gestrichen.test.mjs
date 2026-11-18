// Audit U05: a per-track export that fails after its first file removes the whole folder. The error must then not claim that an export file was written
// and not build the clause ' and undefined were saved as their own undo steps' from an empty step list.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { alsAntwort, LaufFehler } from '../areas/proj/output.ts';
import { aufbau, RENDER_ATTRAPPE } from './support/output_setup.mjs';

const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('export_spuren: the second render fails, the folder is gone, the answer names no written file and no "undefined"', async (t) => {
  let n = 0;
  const a = await aufbau(t, { opt: { render: () => (++n === 1 ? RENDER_ATTRAPPE : [process.execPath, '-e', 'process.exit(3)']) } });
  let r;
  try { r = { code: 200, body: await mitUmgebung({ RENDER_ATTRAPPE_MISCHUNG: '1', TMPDIR: a.tmp }, () => a.ausgabe.exportiereSpuren({ von_beat: 0, bis_beat: 8 })) }; }
  catch (e) { r = alsAntwort(e); }
  assert.ok(r.code >= 400, JSON.stringify(r));
  assert.ok(n >= 2, 'the first render ran, the second failed');
  const text = JSON.stringify(r.body);
  assert.ok(!/undefined/.test(text), text);
  assert.ok(!/export file .* was written/.test(text), text);
});

test('LaufFehler.stand with no undo step has no "were saved" clause', () => {
  const e = new LaufFehler(new Error('x'), [], 'export', null);
  assert.ok(!/undefined|were saved/.test(e.stand()), e.stand());
  const f = new LaufFehler(new Error('x'), [], 'export', path.join('/a', 'mix.wav'));
  assert.ok(!/undefined|were saved/.test(f.stand()), f.stand());
  assert.match(f.stand(), /export file mix\.wav was written/);
});
