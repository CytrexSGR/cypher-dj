// Mutation probe of the insert chain model (slice 4a T5): one mutant per rule in the source; the named test must turn red, then the file
// is put back. Each mutant must find its old text exactly once, otherwise the probe itself fails. At the end the unmutated test file runs green.
// Usage: node pruef/mutation_inserts.mjs [--nur slot_doppelt,merge_ignoriert_kette]
// Do not run in parallel with other runs in this folder (the sources are patched in place and restored in a finally block).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = 'tests/projekt_inserts.test.mjs';
const B = 'projekt/befehle.ts', M = 'projekt/modell.ts', W = 'projekt/wiedergabe.ts', Z = 'projekt/zusammenfuehren.ts';

export const MUTANTEN = [
  { name: 'slot_doppelt', erwartet: 'slot_eindeutig', datei: B, alt: '.filter((x) => x.insert.art === art &&', neu: '.filter((x) => false &&',
    was: 'two stages get the same slot (the pool is ignored)' },
  { name: 'undo_ohne_werte', erwartet: 'undo of insert_entfernen restores slot and values', datei: B,
    alt: "for (const k of geaendert) if (k !== 'an') aus.push(pfad(k));", neu: "for (const k of geaendert) if (k !== 'an' && a.has(slot)) aus.push(pfad(k));",
    was: 'values of a stage that comes back (new slot occupant) are not sent to the pool row' },
  { name: 'merge_ignoriert_kette', erwartet: 'merge_inserts', datei: Z, alt: 'if (spuren.some((s) => (s.inserts ?? []).length > 0)) {', neu: 'if (false) {',
    was: 'the merge does not look at the chain' },
  { name: 'an_in_sicht', erwartet: 'wiedergabe_traegt_kette', datei: M, alt: 'liste.map((i) => ({ art: i.art, slot: i.slot }))', neu: 'liste.map((i) => ({ art: i.art, slot: i.slot, an: i.an }))',
    was: 'bypass counts as playback structure (would swap on every bypass click)' },
  { name: 'pre_nicht_in_sicht', erwartet: 'return_aendern pre', datei: M, alt: '...(r.pre ? { pre: true } : {}), ', neu: '',
    was: 'pre/post is not part of the playback view (no new playback on the switch)' },
  { name: 'kette_nicht_in_anfrage', erwartet: 'wiedergabe_traegt_kette', datei: W, alt: 'return { ...w, ...kette(s.inserts) };', neu: 'return w;',
    was: 'the track chain is missing from the playback request' },
  // package 1.16 rest U2 (optional per-mutant `test`, default TEST)
  { name: 'werte_setzen_bereich', erwartet: 'insert_werte_setzen: partial values', datei: B,
    alt: 'neu[q.name] = zahl(werte, q.name, q.min, q.max)!;', neu: 'neu[q.name] = werte[q.name] as number;',
    was: 'insert_werte_setzen skips the range check' },
  { name: 'preset_in_sicht', erwartet: 'preset_nicht_in_sicht', datei: M, alt: 'geraet: ohnePreset(s.geraet) ?? null', neu: 'geraet: s.geraet ?? null',
    was: 'the device preset counts as playback (a new playback on every apply of equal values)' },
  { name: 'befehl_ohne_preset', test: 'tests/projekt_preset_herkunft.test.mjs', erwartet: 'commands: spur_neu and spur_aendern carry geraet.preset', datei: B,
    alt: "erlaube(g, 'art', 'name', 'parameter', 'preset');", neu: "erlaube(g, 'art', 'name', 'parameter');",
    was: 'the intern rb338 branch of baueGeraet refuses geraet.preset' },
];

function laufe(test = TEST) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', test], { cwd: WURZEL, encoding: 'utf8', timeout: 300_000 });
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
    const e = laufe(m.test ?? TEST);
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
