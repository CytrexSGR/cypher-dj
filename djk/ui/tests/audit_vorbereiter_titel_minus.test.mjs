// Audit U02: a title that starts with '-' and has no space must not be read as an option by argparse of werkstatt.einzeln.
// The stand-in module uses the same argparse definition as djk/workshop/werkstatt/single.py (main(), lines 58-64) and reports parse success.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Vorbereiter } from '../media_library.ts';

const MID = '0123456789abcdef';
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 8000) => { const t0 = Date.now(); for (;;) { const r = f(); if (r) return r; if (Date.now() - t0 > ms) assert.fail('condition not met'); await warte(20); } };

for (const titel of ['-ZIQ-', '-intro-', '--x', 'Gamma – y']) {
  test(`Vorbereiter: title ${JSON.stringify(titel)} reaches argparse as the title`, async (t) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vt-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
    fs.mkdirSync(path.join(d, 'attrappe'));
    fs.writeFileSync(path.join(d, 'attrappe', '__init__.py'), '');
    fs.writeFileSync(path.join(d, 'attrappe', 'standin.py'), [
      'import argparse, json',
      'ap = argparse.ArgumentParser()',
      'ap.add_argument("--quelle", required=True)',
      'ap.add_argument("--titel", default=None)',
      'ap.add_argument("--bestand", default=None)',
      'ap.add_argument("--nur-analyse", action="store_true")',
      'a = ap.parse_args()',
      'print(json.dumps({"status": "vorhanden" if a.titel is not None else "fehler", "material_id": "x", "titel": a.titel}))',
    ].join('\n'));
    const enden = [];
    const v = new Vorbereiter({ python: 'python3', cwd: d, modul: 'attrappe.standin', bestand: d, bei: (mid, st) => enden.push(st) });
    t.after(() => v.stoppe());
    assert.equal(v.starte(MID, '/q.wav', titel), 'gestartet');
    await bis(() => enden.length === 1);
    assert.deepEqual(enden[0], { status: 'vorhanden' }, JSON.stringify(enden[0]));
  });
}
