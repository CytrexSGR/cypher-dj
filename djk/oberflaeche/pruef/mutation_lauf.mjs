// Shared runner for the mutation tables of package 1.16 rest (pruef/mutation_presets_rechte.mjs, mutation_presets_anwenden.mjs,
// mutation_kollektionen.mjs). Pattern of pruef/mutation_inserts.mjs, plus the house rule of the 1.16 rest plan:
//   - every mutant carries its own `test` (the test file it runs) and `erwartet` (text of a test title that must turn red);
//   - before mutating, the unmutated test file runs and the probe fails with PROBE-FEHLER when no test title contains `erwartet`
//     (a mutant naming a test that does not exist could never be caught) or when the file is not green;
//   - the old text must occur exactly once; the file is restored in a finally block.
// Do not run in parallel with other runs in this folder (the sources are patched in place).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function laufe(test) {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', test], { cwd: WURZEL, encoding: 'utf8', timeout: 300_000 });
  const rot = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  const gruen = [...r.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map((m) => m[1]);
  return { rot, gruen };
}

export function fuehreAus(mutanten, argv = process.argv) {
  const nur = argv.includes('--nur') ? argv[argv.indexOf('--nur') + 1].split(',') : null;
  let fehler = 0;
  const vorlauf = new Map();
  for (const m of mutanten) {
    if (nur && !nur.includes(m.name)) continue;
    if (!m.test || !m.erwartet) { console.log(`PROBE-FEHLER ${m.name}: test and erwartet are required`); fehler++; continue; }
    if (!vorlauf.has(m.test)) vorlauf.set(m.test, laufe(m.test));
    const v = vorlauf.get(m.test);
    if (v.rot.length) { console.log(`PROBE-FEHLER ${m.name}: ${m.test} is not green without mutation (${v.rot.join(' | ')})`); fehler++; continue; }
    if (!v.gruen.some((t) => t.includes(m.erwartet))) { console.log(`PROBE-FEHLER ${m.name}: no test title in ${m.test} contains "${m.erwartet}"`); fehler++; continue; }
    const pfad = path.join(WURZEL, m.datei);
    const alt = fs.readFileSync(pfad, 'utf8');
    const n = alt.split(m.alt).length - 1;
    if (n !== 1) { console.log(`PROBE-FEHLER ${m.name}: old text found ${n} times in ${m.datei}`); fehler++; continue; }
    try {
      fs.writeFileSync(pfad, alt.replace(m.alt, () => m.neu));
      const e = laufe(m.test);
      const trifft = e.rot.some((t) => t.includes(m.erwartet));
      console.log(`${trifft ? 'ROT   ' : 'FEHLER'} ${m.name}: ${m.was}\n         red tests (${e.rot.length}): ${e.rot.join(' | ') || '-'}`);
      if (!trifft) fehler++;
    } finally {
      fs.writeFileSync(pfad, alt);
    }
  }
  for (const test of vorlauf.keys()) {
    const ende = laufe(test);
    console.log(`unmutated ${test}: ${ende.gruen.length} green, ${ende.rot.length} red${ende.rot.length ? ` (${ende.rot.join(' | ')})` : ''}`);
    if (ende.rot.length) fehler++;
  }
  return fehler;
}
