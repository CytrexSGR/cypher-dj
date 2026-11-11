// node --test tests/arr_export_run.test.mjs: /k/arr/export_lauf and /e/export_lauf in the stand-in (INTERFACES 4.11, 5.13; plan 1.11 T12).
// The stand-in plays no audio: a run is answered at once with a file of zeros of the exact range length (never replacing) and the numbers K.arr.export holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { neuerKern } from '../module.mjs';
import { kodiere } from '../osc.mjs';
import { arbeitsbestand } from './help.mjs';

const cfg = { arbeitsbestand: arbeitsbestand() };
function kern() {
  const log = [];
  const K = neuerKern({ cfg, mutationen: [], sende: (m) => { if (m.ports.includes(1)) log.push(m); } });
  K.empfange(kodiere('/k/hallo', 'sii', ['t', 1, 1]), { port: 1 });
  const bis = (s) => { while (K.jetzt <= s) K.block(); };
  const cmd = (adr, typen, werte) => K.empfange(kodiere(adr, typen, werte), { port: 1 });
  return { K, log, bis, cmd };
}
const e = (log, adr) => log.filter((m) => m.adresse === adr).map((m) => m.werte);
const q6 = (log) => log.filter((m) => m.adresse === '/q' && m.werte[2] === 6).map((m) => m.werte[5]);

test('export_lauf: refusals carry their reason', () => {
  const { log, bis, cmd } = kern();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exl-'));
  cmd('/k/arr/export_lauf', 'hssdd', [1n, 'leitstand', path.join(d, 'a.f32'), 0.0, 8.0]);          // no playback
  cmd('/k/arr/laden', 'hsi', [2n, 'leitstand', 1]);
  bis(1000);
  cmd('/k/arr/export_lauf', 'hssdd', [3n, 'leitstand', path.join(d, 'a.wav'), 0.0, 8.0]);          // not .f32
  cmd('/k/arr/export_lauf', 'hssdd', [4n, 'leitstand', path.join(d, 'a.f32'), 0.0, 3601.0]);       // too long
  bis(2000);
  assert.deepEqual(q6(log), ['nicht_geladen', 'ausserhalb_bereich', 'zu_gross']);
  fs.rmSync(d, { recursive: true });
});

test('export_lauf: a run writes the exact frames, answers once, and never replaces a file', () => {
  const { K, log, bis, cmd } = kern();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exl-'));
  const f = path.join(d, 'a.f32');
  cmd('/k/arr/laden', 'hsi', [1n, 'leitstand', 1]);
  bis(1000);
  K.arr.export = { ungesund: 12, luecken: 1 };
  cmd('/k/arr/export_lauf', 'hssdd', [2n, 'leitstand', f, 0.0, 8.0]);
  bis(4000);
  const a = e(log, '/e/export_lauf');
  assert.equal(a.length, 1);
  assert.equal(a[0][0], BigInt(fs.statSync(f).size / 8));
  assert.ok(a[0][0] > 0n);
  assert.deepEqual(a[0].slice(2), [1, 12, '']);
  cmd('/k/arr/export_lauf', 'hssdd', [3n, 'leitstand', f, 0.0, 8.0]);                              // the file is there now
  bis(8000);
  assert.deepEqual(e(log, '/e/export_lauf').at(-1), [0n, 0, 1, 12, 'datei_fehlt']);
  fs.rmSync(d, { recursive: true });
});
