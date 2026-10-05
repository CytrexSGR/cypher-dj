// Leitstand-Neustart ohne --set-id: das laufende Set wird fortgesetzt, ein altes nicht.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FORTSETZEN_S, fortsetzbar, merkeAktuell } from '../src/fortsetzen.ts';

test('aktuell mit frischem Journal wird fortgesetzt; zu altes, fehlendes oder kaputtes nicht', () => {
  const sets = fs.mkdtempSync(path.join(os.tmpdir(), 'sets-'));
  assert.equal(fortsetzbar(sets), null);                                  // nichts da
  merkeAktuell(sets, '2026-09-24_2100');
  assert.equal(fortsetzbar(sets), null);                                  // Journal fehlt
  fs.mkdirSync(path.join(sets, '2026-09-24_2100'));
  const j = path.join(sets, '2026-09-24_2100', 'journal.jsonl');
  fs.writeFileSync(j, '{}\n');
  assert.equal(fortsetzbar(sets), '2026-09-24_2100');
  const alt = (Date.now() - (FORTSETZEN_S + 60) * 1000) / 1000;
  fs.utimesSync(j, alt, alt);
  assert.equal(fortsetzbar(sets), null);                                  // Negativ-Kontrolle: älter als 600 s
  fs.writeFileSync(path.join(sets, 'aktuell'), '../../etc\n');
  assert.equal(fortsetzbar(sets), null);                                  // nur die Form JJJJ-MM-TT_hhmm
});
