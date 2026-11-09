// Mutation probe of the insert page (slice 4a T7): the named test must turn red, then the file is put back. Each mutant must find its old text exactly once,
// otherwise the probe itself fails. At the end the unmutated test file runs green.
// Usage: node check/mutation_inserts_page.mjs [--nur stub_ohne_pre]
// Do not run in parallel with other runs in this folder (the sources are patched in place and restored in a finally block).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = 'tests/production_inserts.test.mjs';
const P = 'check/proj_mock.mjs';

export const MUTANTEN = [
  { name: 'stub_ohne_pre', erwartet: 'pre_schalter_sendet_return_aendern', datei: P, alt: 'try { return fuehreAus(p, b).projekt; }',
    neu: 'try { return fuehreAus(p, (({ pre, ...rest }) => rest)(b)).projekt; }', was: 'the stub drops the pre flag of return_aendern' },
];

function laufe() {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', TEST], { cwd: WURZEL, encoding: 'utf8', timeout: 300_000 });
  const rot = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  const gruen = [...r.stdout.matchAll(/^ok \d+ - /gm)].length;
  return { rot, gruen };
}

const nur = process.argv.includes('--nur') ? process.argv[process.argv.indexOf('--nur') + 1].split(',') : null;
let fehler = 0;
for (const m of MUTANTEN) {
  if (nur && !nur.includes(m.name)) continue;
  const pfad = path.join(WURZEL, m.datei);
  const alt = fs.readFileSync(pfad, 'utf8');
  const n = alt.split(m.alt).length - 1;
  if (n !== 1) { console.log(`PROBE-FEHLER ${m.name}: old text found ${n} times in ${m.datei}`); fehler++; continue; }
  try {
    fs.writeFileSync(pfad, alt.replace(m.alt, () => m.neu));
    const e = laufe();
    const trifft = e.rot.some((t) => t.includes(m.erwartet));
    console.log(`${trifft ? 'ROT   ' : 'FEHLER'} ${m.name}: ${m.was}\n         red tests (${e.rot.length}): ${e.rot.join(' | ') || '-'}`);
    if (!trifft) fehler++;
  } finally {
    fs.writeFileSync(pfad, alt);
  }
}
const ende = laufe();
console.log(`unmutated: ${ende.gruen} green, ${ende.rot.length} red${ende.rot.length ? ` (${ende.rot.join(' | ')})` : ''}`);
if (ende.rot.length) fehler++;
process.exit(fehler ? 1 : 0);
