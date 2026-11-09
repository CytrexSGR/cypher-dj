// Mutation probe of the insert chain model (slice 4a T6, paths from project to core): one mutant per rule in the source; the named test must turn red, then the file
// is put back. Each mutant must find its old text exactly once, otherwise the probe itself fails. At the end the unmutated test file runs green.
// Usage: node check/mutation_inserts_paths.mjs [--nur ohne_ins_409,routing_ohne_inserts]
// Do not run in parallel with other runs in this folder (the sources are patched in place and restored in a finally block).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = 'tests/project_inserts_paths.test.mjs';
const S = 'server.ts', R = 'project/render.ts', A = 'areas/proj/mapping.ts';

export const MUTANTEN = [
  { name: 'ohne_ins_409', erwartet: 'server.insert_409', datei: S, alt: "pfad.startsWith('ret/') || pfad.startsWith('ins/') ||", neu: "pfad.startsWith('ret/') ||",
    was: 'ueberProjekt without ins/: POST /regler on an insert row reaches the core' },
  { name: 'routing_ohne_inserts', erwartet: 'render.routing_inserts', datei: R, alt: 'if (!opt.trocken) Object.assign(r, insertRegler(p, nur));', neu: '',
    was: 'routingRegler without inserts: the export is the no-insert file' },
  { name: 'inserts_nach_returns_abbruch', erwartet: 'render.routing_inserts', datei: R,
    alt: 'if (!opt.trocken) Object.assign(r, insertRegler(p, nur));   // 1.10 slice 4a: before the early return, a project may have inserts and no return\n  if (returns.length === 0) return r;',
    neu: 'if (returns.length === 0) return r;\n  if (!opt.trocken) Object.assign(r, insertRegler(p, nur));',
    was: 'inserts only behind the early return of the send block: a project without returns loses them' },
  { name: 'an_zuerst', erwartet: 'render.routing_inserts', datei: 'project/model.ts', alt: "  r[`ins/${i.art}/${i.slot}/an`] = i.an ? 1 : 0;\n  return r;",
    neu: "  r[`ins/${i.art}/${i.slot}/an`] = i.an ? 1 : 0;\n  return Object.fromEntries(Object.entries(r).reverse());", was: 'the switch is set first, the stage sounds half set' },
  { name: 'nur_alle_spuren', erwartet: 'render.routing_inserts', datei: R, alt: 'if (nur) {\n    const g = nur.ausgang', neu: 'if (false as boolean) {\n    const g = nur.ausgang',
    was: 'the render of one track carries the chains of all tracks' },
  { name: 'trocken_mit_inserts', erwartet: 'render.routing_inserts', datei: R, alt: 'if (!opt.trocken) Object.assign(r, insertRegler(p, nur));',
    neu: 'Object.assign(r, insertRegler(p, nur));', was: 'the dry merge render carries inserts' },
  { name: 'oeffnen_ohne_inserts', erwartet: 'sitzung.setzt_alle_ins', datei: A, alt: '...alleRetRegler(p), ...alleInsertRegler(p)];', neu: '...alleRetRegler(p)];',
    was: 'opening a project does not set the insert rows' },
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
