#!/usr/bin/env node
// Stand-in of `cypherdj-noten` for the tests of the note editor (contract djk/contract/notes.md). It obeys the command line of the contract:
//   version
//   analyse <quelle.f32> <aus.json> [--sha <hex>]            sidecar without `mono`, three notes
//   segment <quelle.f32> <roh.json> <aus.json> [--sha <hex>] sidecar of the network curve (notes cut from that curve), curve id <detektor_version>.<segmenter>
//   pruefe <quelle.f32> <kurve.json>                          adds `mono` (rewrites the file atomically)
//   render <quelle.f32> <kurve.json> <auftrag.json> <aus.f32> [--vorher <f32> --nur <id,id,...>]
//                                                             copies the source and halves the samples inside every note that carries a target;
//                                                             with --vorher/--nur the listed notes are recomputed from the source (reset = source again)
// One JSON line on stdout, progress as `@@fortschritt {...}` on stderr, outputs written as <aus>.tmp and renamed (nothing partial after a failure).
// The numbers of the detector, segmenter and engine come from notes_contract.ts, so a bump of a version does not break the stand-in.
// Behaviour by environment:
//   NOTEN_ATTRAPPE_FALL = ok (default) | leer (no notes) | mehrstimmig (pruefe finds more than one note at a time) | fehler (exit 1, datei_kaputt)
//                       | langsam (sleeps 30 s with progress, ends on SIGTERM with 143) | taub (like langsam, ignores SIGTERM) | kaputt (exit 0 without a result line)
//                       | ueber_ende (the last note ends 4 ms after the source: the sidecar check allows it, the server must refuse it)
//                       | wenig (like ok, but the sidecar says stimmhaft_anteil 0.05, as a full mix does: three notes, little pitched sound)
//   NOTEN_ATTRAPPE_SCHLAF_MS = <n>   sleep before the work (any case), with progress lines, so a test can change the project meanwhile
//   NOTEN_ATTRAPPE_MESSUNG = 1       the render line carries `messung` (every note with a target ton)
//   NOTEN_ATTRAPPE_TIEF = 1          the notes are bass notes (MIDI 28 to 30, about 41 to 46 Hz)
//   NOTEN_ATTRAPPE_PROTOKOLL = <file> appends one JSON line per call: the arguments, the case, OMP_NUM_THREADS and the nice value
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DETEKTOR_VERSION, MASCHINE_VERSION, SEGMENTIERER_VERSION, frameZahl, NOTEN_HOP, NOTEN_SR, MONO_ANTEIL_MAX } from '../../project/notes_contract.ts';

const FALL = process.env.NOTEN_ATTRAPPE_FALL || 'ok';
const argv = process.argv.slice(2);
const befehl = argv[0];
const SHA = /^[0-9a-f]{64}$/;

if (process.env.NOTEN_ATTRAPPE_PROTOKOLL) {
  fs.appendFileSync(process.env.NOTEN_ATTRAPPE_PROTOKOLL, `${JSON.stringify({ befehl, argv, fall: FALL, omp: process.env.OMP_NUM_THREADS ?? null, nice: os.getPriority() })}\n`);
}

const sekunden = () => { const u = process.cpuUsage(); return Math.round((u.user + u.system) / 1e3) / 1e6; };
// synchronous on purpose: nothing may run after the end (the first version let a failed call go on and write a result line behind the error)
const schreibeFd = (fd, text) => { for (let b = Buffer.from(text); b.length > 0;) { try { b = b.subarray(fs.writeSync(fd, b)); } catch (e) { if (e.code !== 'EAGAIN') throw e; } } };
const ende = (rc, zeile) => { if (zeile !== null) schreibeFd(1, `${JSON.stringify(zeile)}\n`); process.exit(rc); };
const fehler = (code, text, rc = 1) => ende(rc, { status: 'fehler', fehler: code, text });
const fortschritt = (stufe, von, name, prozent) => schreibeFd(2, `@@fortschritt ${JSON.stringify({ stufe, von, name, prozent })}\n`);
const schlafe = (ms) => new Promise((r) => setTimeout(r, ms));
const rundeS = (x) => Math.round(x * 1e6) / 1e6;
const schreibe = (pfad, text) => { fs.writeFileSync(`${pfad}.tmp`, text); fs.renameSync(`${pfad}.tmp`, pfad); };
const lies = (pfad) => { try { return JSON.parse(fs.readFileSync(pfad, 'utf8')); } catch { return fehler('datei_kaputt', `${pfad} cannot be read`); } };
const wert = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

function quelleFrames(pfad) {
  if (!pfad || !fs.existsSync(pfad)) return fehler('datei_fehlt', `${pfad} does not exist`);
  const n = fs.statSync(pfad).size;
  if (n % 8 !== 0) return fehler('datei_kaputt', `${pfad}: size is not a multiple of 8`);
  return n / 8;
}
function quelleSha(pfad) {
  const stamm = path.basename(pfad).replace(/\.f32$/, '');
  if (SHA.test(stamm)) return stamm;
  const s = wert('--sha');
  return s && SHA.test(s) ? s : ende(2, { status: 'fehler', fehler: 'argument', text: 'the source sha is missing' });
}

// Three notes at fixed fractions of the source (none when it is shorter than 0.1 s or the case is `leer`), the curve carries their pitch
function bauKurve(frames, sha, detektor, kurve) {
  const n = frameZahl(frames), dauer = frames / NOTEN_SR;
  const tief = process.env.NOTEN_ATTRAPPE_TIEF === '1';
  const ton = tief ? [28, 30, 28] : [60, 62, 64];
  const noten = [];
  if (FALL !== 'leer' && dauer >= 0.1) {
    for (let i = 0; i < 3; i++) noten.push({ qa: rundeS((0.05 + 0.3 * i) * dauer), qe: rundeS((0.05 + 0.3 * i + 0.25) * dauer), qton: ton[i], p: 0.9 });
    if (FALL === 'ueber_ende') noten[2].qe = rundeS(dauer + 0.004);
  }
  const stimmhaftAnteil = (n2) => (FALL === 'wenig' ? 0.05 : n2);
  const f0 = [], konf = [];
  for (let k = 0; k < n; k++) {
    const t = k * NOTEN_HOP / NOTEN_SR;
    const i = noten.findIndex((x) => t >= x.qa && t < x.qe);
    f0.push(i >= 0 ? Math.round(noten[i].qton * 1e4) / 100 : 0);
    konf.push(i >= 0 ? 0.9 : 0.1);
  }
  const stimmhaft = f0.filter((v) => v > 0).length;
  return { format: 'cdj-noten-kurve/1', quelle: sha, frames, sr: NOTEN_SR, hop: NOTEN_HOP, detektor, kurve, f0_ct: f0, konf,
    noten, stimmhaft_anteil: stimmhaftAnteil(Math.round(stimmhaft / n * 1e4) / 1e4) };
}

// Notes cut from a given curve: one note per run of voiced frames (shorter than 11 ms dropped), pitch = mean of the run
function schneideNoten(f0, konf, frames) {
  const noten = [];
  const dauer = frames / NOTEN_SR;
  for (let k = 0; k < f0.length;) {
    if (f0[k] <= 0) { k++; continue; }
    let j = k;
    while (j + 1 < f0.length && f0[j + 1] > 0) j++;
    const qa = rundeS(k * NOTEN_HOP / NOTEN_SR), qe = rundeS(Math.min((j + 1) * NOTEN_HOP / NOTEN_SR, dauer));
    const lauf = f0.slice(k, j + 1), kf = konf.slice(k, j + 1);
    if (qe > qa + 0.011) {
      noten.push({ qa, qe, qton: Math.round(lauf.reduce((a, b) => a + b, 0) / lauf.length) / 100,
        p: Math.round(kf.reduce((a, b) => a + b, 0) / kf.length * 1e3) / 1e3 });
    }
    k = j + 1;
  }
  return noten;
}

// the slow cases and the sleep before the work: progress lines while waiting; `langsam` and `taub` never come back on their own
async function warten(von, name) {
  if (FALL === 'taub') process.on('SIGTERM', () => {});
  else process.on('SIGTERM', () => process.exit(143));
  const ms = FALL === 'langsam' || FALL === 'taub' ? 30000 : Number(process.env.NOTEN_ATTRAPPE_SCHLAF_MS || 0);
  if (ms <= 0) return;
  const schritte = Math.max(1, Math.round(ms / 100));
  for (let i = 0; i < schritte; i++) {
    fortschritt(1, von, name, Math.min(99, Math.round(i / schritte * 100)));
    await schlafe(100);
  }
}

function pruefeFall() {
  if (FALL === 'fehler') fehler('datei_kaputt', 'the stand-in is set to fail');
  if (FALL === 'kaputt') ende(0, null);
}

async function main() {
  if (befehl === 'version') {
    return ende(0, { status: 'ok', programm: 'cypherdj-noten', vertrag: 1, detektor: DETEKTOR_VERSION, segmentierer: SEGMENTIERER_VERSION, maschine: MASCHINE_VERSION });
  }
  if (befehl === 'analyse') {
    const [, quelle, aus] = argv;
    const frames = quelleFrames(quelle); const sha = quelleSha(quelle);
    await warten(3, 'tonhoehe');
    pruefeFall();
    fortschritt(1, 3, 'laden', 100); fortschritt(2, 3, 'tonhoehe', 100); fortschritt(3, 3, 'noten', 100);
    const sd = bauKurve(frames, sha, 'pyin', `${DETEKTOR_VERSION}.${SEGMENTIERER_VERSION}`);
    schreibe(aus, `${JSON.stringify(sd)}\n`);
    return ende(0, { status: 'ok', datei: aus, noten: sd.noten.length, stimmhaft: sd.stimmhaft_anteil, sekunden: sekunden() });
  }
  if (befehl === 'segment') {
    const [, quelle, rohPfad, aus] = argv;
    const frames = quelleFrames(quelle); const sha = quelleSha(quelle);
    const roh = lies(rohPfad);
    await warten(2, 'noten');
    pruefeFall();
    if (roh.frames !== frames) return fehler('kurve_passt_nicht', `the curve has ${roh.frames} frames, the source has ${frames}`);
    fortschritt(1, 2, 'laden', 100); fortschritt(2, 2, 'noten', 100);
    const sd = { format: 'cdj-noten-kurve/1', quelle: sha, frames, sr: NOTEN_SR, hop: NOTEN_HOP, detektor: 'netz', kurve: `${roh.detektor_version}.${SEGMENTIERER_VERSION}`,
      f0_ct: roh.f0_ct, konf: roh.konf, noten: schneideNoten(roh.f0_ct, roh.konf, frames),
      stimmhaft_anteil: Math.round(roh.f0_ct.filter((v) => v > 0).length / roh.f0_ct.length * 1e4) / 1e4 };
    schreibe(aus, `${JSON.stringify(sd)}\n`);
    return ende(0, { status: 'ok', datei: aus, noten: sd.noten.length, stimmhaft: sd.stimmhaft_anteil, sekunden: sekunden() });
  }
  if (befehl === 'pruefe') {
    const [, quelle, kurvePfad] = argv;
    const frames = quelleFrames(quelle);
    const sd = lies(kurvePfad);
    await warten(1, 'pruefen');
    pruefeFall();
    if (sd.frames !== frames) return fehler('kurve_passt_nicht', `the curve has ${sd.frames} frames, the source has ${frames}`);
    fortschritt(1, 1, 'pruefen', 100);
    const geprueft = sd.f0_ct.filter((v) => v > 0).length;
    const anteil = geprueft === 0 ? 0 : FALL === 'mehrstimmig' ? 0.6 : 0.05;
    const mehrstimmig = anteil > MONO_ANTEIL_MAX;
    schreibe(kurvePfad, `${JSON.stringify({ ...sd, mono: { geprueft_frames: geprueft, anteil, mehrstimmig, hrr_db_schwelle: 6, periode_schwelle: 0.5 } })}\n`);
    return ende(0, { status: 'ok', mehrstimmig, anteil, sekunden: sekunden() });
  }
  if (befehl === 'render') {
    const [, quelle, kurvePfad, auftragPfad, aus] = argv;
    const frames = quelleFrames(quelle);
    const sd = lies(kurvePfad); const auftrag = lies(auftragPfad);
    await warten(1, 'rendern');
    pruefeFall();
    if (auftrag.kurve !== sd.kurve) return fehler('kurve_passt_nicht', `the order is for curve ${auftrag.kurve}, the sidecar holds ${sd.kurve}`);
    const ziele = ['a', 'e', 'vib', 'drift', 'formant', 'gain_db'];
    if (auftrag.liste.some((n) => ziele.some((z) => n[z] !== undefined))) return fehler('nicht_unterstuetzt', 'slice 1 renders the target pitch only');
    const nur = wert('--nur'), vorher = wert('--vorher');
    if (nur !== undefined && vorher === undefined) return ende(2, { status: 'fehler', fehler: 'argument', text: '--nur needs --vorher' });
    const quellDaten = fs.readFileSync(quelle);
    let daten = Buffer.from(vorher === undefined ? quellDaten : fs.readFileSync(vorher));
    if (daten.length !== frames * 8) return fehler('vorher_passt_nicht', '--vorher has another length than the source');
    const ids = nur === undefined ? null : new Set(nur.split(','));
    const bereiche = [];
    for (const n of auftrag.liste) {
      // a full render rewrites the notes with a target; an incremental one recomputes the listed notes FROM THE SOURCE, so a note whose target was
      // reset goes back to the source sound (the contract: every frame outside the notes with a target is the source)
      if (ids ? !ids.has(n.id) : n.ton === undefined) continue;
      const s0 = Math.min(frames, Math.floor(n.qa * NOTEN_SR)), s1 = Math.min(frames, Math.floor(n.qe * NOTEN_SR));
      if (s1 <= s0) continue;
      quellDaten.copy(daten, s0 * 8, s0 * 8, s1 * 8);
      if (n.ton !== undefined) for (let s = s0 * 2; s < s1 * 2; s++) daten.writeFloatLE(daten.readFloatLE(s * 4) / 2, s * 4);   // both channels: two floats a frame
      bereiche.push([s0, s1]);
    }
    fortschritt(1, 1, 'rendern', 100);
    fs.writeFileSync(`${aus}.tmp`, daten); fs.renameSync(`${aus}.tmp`, aus);
    // NOTEN_ATTRAPPE_MESSUNG=1: a measurement of every note with a target ton (the output is the halved source: the stand-in reports ton - 0.5 ct)
    const messung = process.env.NOTEN_ATTRAPPE_MESSUNG === '1'
      ? auftrag.liste.filter((n) => n.ton !== undefined).map((n) => ({ id: n.id, ton_ist: Math.round(n.ton * 1000) / 1000, fehler_ct: -0.5 })) : null;
    return ende(0, { status: 'ok', datei: aus, bereiche, ...(messung ? { messung } : {}), sekunden: sekunden() });
  }
  return ende(2, { status: 'fehler', fehler: 'argument', text: `unknown command ${befehl}` });
}
main();
