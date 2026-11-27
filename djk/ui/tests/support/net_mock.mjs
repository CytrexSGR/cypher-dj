#!/usr/bin/env node
// Stand-in of `python -m werkstatt.notes_net` for the tests of the note editor (contract djk/contract/notes.md, "The external curve").
// The job runs it as <program> [args...] --pruefen  and  <program> [args...] --quelle <f32> --aus <roh.json>, so a test passes
// `[node, <this file>]` as the network command.
//   --pruefen                    {"status":"ok","netz":true,"version":"netz-1"} exit 0 (case `fehlt`: {"status":"fehler","grund":"netz_fehlt"} exit 1)
//   --quelle <f32> --aus <json>  writes a raw curve (one voiced stretch at 6500 cents over the middle of the source, so it differs from the notes of
//                                the own stand-in) and prints {"status":"ok","frames":n,"stimmhaft":x}
// Behaviour by environment:
//   NETZ_ATTRAPPE_FALL = ok (default) | fehlt (--pruefen fails) | absturz (--pruefen ok, the curve run exits 1 with {"status":"fehler","grund":"netz_fehlt"})
//                      | kaputt (the curve run exits 0 without a result line) | langsam (the curve run sleeps 30 s with progress, ends on SIGTERM with 143)
//   NETZ_ATTRAPPE_STIMME = <cents>   pitch of the voiced stretch (default 6500; a test sets 3000 for a bass source)
//   NETZ_ATTRAPPE_PROTOKOLL = <file> appends one JSON line per call: the arguments, the case and OMP_NUM_THREADS
import fs from 'node:fs';
import { NETZ_VERSION, ROH_FORMAT, NOTEN_HOP, NOTEN_SR, frameZahl } from '../../project/notes_contract.ts';

const FALL = process.env.NETZ_ATTRAPPE_FALL || 'ok';
const argv = process.argv.slice(2);
if (process.env.NETZ_ATTRAPPE_PROTOKOLL) {
  fs.appendFileSync(process.env.NETZ_ATTRAPPE_PROTOKOLL, `${JSON.stringify({ argv, fall: FALL, omp: process.env.OMP_NUM_THREADS ?? null })}\n`);
}
const wert = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const ende = (rc, zeile) => { process.stdout.write(zeile === null ? '' : `${JSON.stringify(zeile)}\n`, () => process.exit(rc)); };
const fortschritt = (stufe, name, prozent) => process.stderr.write(`@@fortschritt ${JSON.stringify({ stufe, von: 3, name, prozent })}\n`);

async function main() {
  if (argv.includes('--pruefen')) {
    if (FALL === 'fehlt') return ende(1, { status: 'fehler', grund: 'netz_fehlt' });
    return ende(0, { status: 'ok', netz: true, version: NETZ_VERSION });
  }
  const quelle = wert('--quelle'), aus = wert('--aus');
  if (!quelle || !aus) return ende(2, { status: 'fehler', grund: 'datei_fehlt' });
  if (!fs.existsSync(quelle)) return ende(1, { status: 'fehler', grund: 'datei_fehlt' });
  const groesse = fs.statSync(quelle).size;
  if (groesse % 8 !== 0) return ende(1, { status: 'fehler', grund: 'datei_kaputt' });
  if (FALL === 'langsam') {
    process.on('SIGTERM', () => process.exit(143));
    for (let i = 0; i < 300; i++) { fortschritt(2, 'tonhoehe', Math.min(99, i)); await new Promise((r) => setTimeout(r, 100)); }
  }
  fortschritt(1, 'laden', 0); fortschritt(1, 'laden', 100); fortschritt(2, 'tonhoehe', 0);
  if (FALL === 'absturz') return ende(1, { status: 'fehler', grund: 'netz_fehlt' });
  if (FALL === 'kaputt') return ende(0, null);
  const frames = groesse / 8, n = frameZahl(frames);
  const ct = Number(process.env.NETZ_ATTRAPPE_STIMME || 6500);
  const f0 = [], konf = [];
  for (let k = 0; k < n; k++) {
    const stimmhaft = frames >= 0.1 * NOTEN_SR && k >= Math.floor(n * 0.2) && k < Math.floor(n * 0.8);
    f0.push(stimmhaft ? ct : 0);
    konf.push(stimmhaft ? 0.95 : 0.05);
  }
  fortschritt(2, 'tonhoehe', 100); fortschritt(3, 'schreiben', 0);
  const roh = { format: ROH_FORMAT, frames, sr: NOTEN_SR, hop: NOTEN_HOP, detektor: 'netz', detektor_version: NETZ_VERSION, f0_ct: f0, konf };
  fs.writeFileSync(`${aus}.tmp`, `${JSON.stringify(roh)}\n`); fs.renameSync(`${aus}.tmp`, aus);
  fortschritt(3, 'schreiben', 100);
  return ende(0, { status: 'ok', frames, stimmhaft: Math.round(f0.filter((v) => v > 0).length / n * 1e4) / 1e4 });
}
main();
