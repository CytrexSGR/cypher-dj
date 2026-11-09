// Real-core gate of 1.8 slice 4a (plan PLAN-1.8-slices2-6.md, task S4a.5, core gate 2), against a TEST INSTANCE with the freshly built core
// (instances b, d or e only, never f, never the operation; every other letter is refused). Call order:
//   1  echo '{}' > <folder>/aufbau.json
//   2  DJK=<worktree>/djk djk/start/djk-start --instanz d --ohne-pruefmodus      (silent sink; <worktree>/djk/core/build or the build under test holds the core)
//   3  flock <CYPHERDJ_ECHTZEIT_SCHLOSS> node check/acceptance_s4a_core.mjs --url http://127.0.0.1:51300 --aufbau <folder>/aufbau.json \
//        --bau <core build folder> --ausgabe <folder> [--abo-port 51190]
// What it measures: the only shared function the slice changes is the C++ Arrangement::start (new defaulted count-in parameter). A12 runs on the mock core and
// cannot see it, so this script drives the REAL core. The project is 120 BPM, metronome on, target master, 0 dB, no clips. For quant 0, 1 and 2 and the
// start beats 0, 3.5 and 7 (5 starts each, 45 in all) it sends /k/arr/start straight to the core (the page route picks the quant itself), reads receipt 2
// (status 2 "gestartet": ist_sample = the entry sample, ist_beat = the entry as CORE beat kb of Arrangement::start), records the master with
// cypherdj-mitschnitt (s0 = core sample of the first frame) and finds the first click (a1_measure.mjs einsatz). Per start it reports
//   einsatz        receipt 2 ist_sample (core sample), ist_beat
//   erster_klick   s0 + first audible frame (core sample)
//   delta          erster_klick - einsatz in samples
// Criteria (each FEHL on its own):
//   K0  the core really runs at 120 BPM: the quant 1 entries (whole core beats) are 24000 +- 1 samples per beat apart (the page tempo push does not reach
//       the core of a test instance, so the script sends /k/tempo/rampe itself; the first run of this script measured 128 BPM)
//   K1  receipt 2 arrives for every start with status 2 and an ist_sample inside the recording; a click is found
//   K2  a start on a whole project beat (start beat 0 and 7) clicks at the entry: 0 <= delta <= 480 samples (10 ms; the constant is the audio path, 84 here;
//       the count-in mutation moves it by a whole beat = 24000 samples)
//   K3  start beat 3.5: the first click is the next whole PROJECT beat, half a beat (12000 samples) after the entry: delta = on-grid delta + 12000 +-2
//   K4  quant grid of the entry (receipt ist_beat is the CORE beat kb of Arrangement::start): quant 1 a whole core beat; quant 2 core beat == start beat
//       modulo 4 (the project bar lands on the core bar grid); quant 0 has no grid (now + look-ahead), only K1 to K3 apply
//   K5  the five repeats of one (quant, start beat) give the same delta within +-2 samples
// The delta list and the receipts go to ergebnis.json; the run is compared BEFORE (core of the commit before S4a.1), AFTER (S4a head) with `diff` of the
// "gate" lines this script prints (the five deltas and the quant grid position per start; ist_sample and ist_beat are time dependent and only used inside one run).
// Return: 0 all OK, 1 at least one FEHL, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_target.mjs';
import { einsatz } from './a1_measure.mjs';
import { kanaele } from './a2_measure.mjs';
import { KernAnbindung } from '../../conductor/src/core.ts';

const SR = 48000;
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_s4a_kern: usage: --url <test instance> --aufbau <aufbau.json> --bau <core build folder> [--ausgabe <folder>] [--instanz <b|d|e>] [--abo-port <port>]\n');
  process.exit(2);
}
const z = starte('abnahme_s4a_kern', 's4a', { bau: { type: 'string' }, 'abo-port': { type: 'string' } });
const { CYPHER, notiere, info, aendern, instanz, warte } = z;
if (!z.opt.bau) { process.stderr.write('abnahme_s4a_kern: --bau <core build folder> is required (cypherdj-mitschnitt)\n'); process.exit(2); }
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`abnahme_s4a_kern: instance ${instanz} is not allowed: b, d or e only (never f)\n`); process.exit(2); }
const BAU = path.resolve(z.opt.bau);
const K = 1000 * (instanz.charCodeAt(0) - 96);
const KERN_PORT = 47100 + K, ABO_PORT = Number(z.opt['abo-port'] ?? 47190 + K);
const BPM = 120, SPB = SR * 60 / BPM;   // samples per beat
const QUANTS = [0, 1, 2], STARTS = [0, 3.5, 7], WIEDERHOLUNGEN = 5, SEKUNDEN = 5;
const roh = { quittungen: [], starts: [] };

const prog = (programm, args) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const jsonZeile = (t) => { try { return JSON.parse(t.trim().split('\n').filter(Boolean).pop()); } catch { return null; } };

// ---- own subscriber at the core: receipts /q ----
const quittungen = [];
const abo = new KernAnbindung({ kernPort: KERN_PORT, aboPort: ABO_PORT, name: 'pruefstand-s4a' }, {
  nachricht: (d) => { if (d.adresse === '/q') quittungen.push({ ...d.felder, t: Date.now() }); },
  gesendet: () => {}, zustand: () => {}, unlesbar: (g) => info(`unreadable: ${g}`),
});
await abo.starte();
let nid = 700000 + (Date.now() % 100000) * 10;
const sende = (adresse, felder) => { const id = ++nid; abo.sende(adresse, { id, quelle: 'cypher', ...felder }); return id; };
const quittung = async (id, status, ms = 6000) => {
  for (let t = 0; t < ms; t += 10) { const q = quittungen.find((x) => Number(x.id) === id && x.status === status); if (q) return q; await warte(10); }
  return null;
};

async function nimmAuf(name, sekunden, ablauf) {
  const dir = path.join(z.ORDNER, 'roh');
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, `${name}.f32`);
  const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', datei]);
  await warte(400);
  let fehler = null, ergebnis = null;
  try { ergebnis = await ablauf(); } catch (e) { fehler = e; }
  const m = await mit;
  const j = jsonZeile(m.out);
  if (m.rc !== 0 || !j) throw new Fehl(`cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}`);
  if (fehler) throw fehler;
  const b = fs.readFileSync(datei);
  const { l } = kanaele(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4))));
  fs.rmSync(datei, { force: true });   // keep the evidence folder small; the numbers are in ergebnis.json
  return { l, s0: j.s0, ergebnis };
}

try {
  // ---- project: 120 BPM, metronome on, master, 0 dB, no clips ----
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  await warte(500);
  await z.neuesProjekt('kern');
  await aendern('S4a tempo', [{ befehl: 'tempo_setzen', bpm: BPM }], CYPHER);
  await aendern('S4a metronome', [{ befehl: 'metronom_setzen', an: true, pegel_db: 0, ziel: 'master' }], CYPHER);
  await z.geladen();
  await warte(6500);   // the tempo ramp of the page is done after 4 beats
  // the core holds the same setting even if the page did not push it: set it straight, the same message the page sends
  const m0 = sende('/k/arr/metronom', { an: 1, pegel_db: 0.0, ziel: 0 });
  if (!(await quittung(m0, 3, 3000)) && !quittungen.find((x) => Number(x.id) === m0)) notiere('S4a setup: metronome message acknowledged', false, 'no receipt for /k/arr/metronom');
  // the core of a test instance starts at 128 BPM and the page push of tempo_setzen did not reach it (first run, K0): ramp it to 120 ourselves
  // (an ab_beat in the past starts the ramp now, tempo_plan.cpp rampe)
  const t0 = sende('/k/tempo/rampe', { ab_beat: 0.0, ziel_bpm: BPM, dauer_beats: 1.0 });
  await quittung(t0, 3, 3000);
  await warte(4000);
  const stopp = async () => { const id = sende('/k/arr/stopp', { quant: 0 }); await quittung(id, 3, 1500); await warte(400); };
  await stopp();

  for (const quant of QUANTS) for (const beat of STARTS) {
    const proben = [];
    for (let r = 0; r < WIEDERHOLUNGEN; r++) {
      await stopp();
      const kz = `quant ${quant} start ${beat} run ${r + 1}`;
      const a = await nimmAuf(`q${quant}-b${beat}-r${r + 1}`, SEKUNDEN, async () => {
        const id = sende('/k/arr/start', { start_beat: beat, quant });
        const q2 = await quittung(id, 2, 4000);
        return { id, q2, q1: quittungen.find((x) => Number(x.id) === id && x.status === 1) ?? null,
          abgelehnt: quittungen.find((x) => Number(x.id) === id && x.status === 6) ?? null };
      });
      await stopp();
      const { q2, id } = a.ergebnis;
      roh.quittungen.push({ kz, id, q1: a.ergebnis.q1, q2, abgelehnt: a.ergebnis.abgelehnt });
      if (!q2) { notiere(`K1 ${kz}`, false, `no receipt 2 (rejected: ${JSON.stringify(a.ergebnis.abgelehnt)})`); proben.push(null); continue; }
      const klick = einsatz(a.l);
      const erster = klick < 0 ? null : a.s0 + klick;
      const ist = Number(q2.ist_sample), delta = erster === null ? null : erster - ist;
      const imFenster = ist >= a.s0 && ist < a.s0 + a.l.length;
      notiere(`K1 ${kz}`, imFenster && klick >= 0, `entry ${ist} (core beat ${Number(q2.ist_beat).toFixed(4)}), recording ${a.s0}..${a.s0 + a.l.length}, first click `
        + `${erster ?? 'none'}, delta ${delta}`);
      const p = { quant, beat, lauf: r + 1, ist_sample: ist, ist_beat: Number(q2.ist_beat), s0: a.s0, klick_frame: klick, delta };
      proben.push(p); roh.starts.push(p);
    }
    const gut = proben.filter(Boolean);
    if (gut.length === 0) continue;
    const ds = gut.map((p) => p.delta).filter((d) => d !== null);
    const spanne = ds.length ? Math.max(...ds) - Math.min(...ds) : Infinity;
    notiere(`K5 quant ${quant} start ${beat}: five repeats agree`, gut.length === WIEDERHOLUNGEN && spanne <= 2, `deltas ${ds.join(', ')} (span ${spanne} samples)`);
    // stable text for the diff between the runs: the five deltas and the quant grid position of the entry (quant 0 has none)
    const raster = (p) => quant === 1 ? ((p.ist_beat % 1) + 1) % 1 : quant === 2 ? ((((p.ist_beat - beat) % 4) + 4) % 4) : null;
    const r0 = raster(gut[0]);
    process.stdout.write(`gate quant=${quant} start=${beat} deltas=${ds.join(',')} raster=${r0 === null ? '-' : r0.toFixed(3)}\n`);
  }

  // ---- K0, K2, K3, K4 from the collected starts ----
  const je = (quant, beat) => roh.starts.filter((p) => p.quant === quant && p.beat === beat);
  const mod = (x, m) => ((x % m) + m) % m;
  const nahe = (x, m) => Math.min(mod(x, m), m - mod(x, m)) < 1e-4;   // 1e-4 beat = 2.4 samples: the receipt beat is beat_at(sample), rounded to a sample (measured 1.1e-5)
  for (const quant of QUANTS) {
    for (const beat of [0, 7]) {
      const ps = je(quant, beat);
      // quant 1 and 2 may land on a later grid point than the start beat; the click still sits at the entry, which is what K2 checks
      notiere(`K2 quant ${quant} start ${beat}: first click at the entry`, ps.length > 0 && ps.every((p) => p.delta !== null && p.delta >= 0 && p.delta <= 480),
        `deltas ${ps.map((p) => p.delta).join(', ')} samples (window 0..480)`);
    }
    const ps = je(quant, 3.5), grund = je(quant, 0).concat(je(quant, 7)).map((p) => p.delta).filter((d) => d !== null);
    const ref = grund.length ? Math.min(...grund) : null;
    notiere(`K3 quant ${quant} start 3.5: first click is the next whole project beat (half a beat after the entry)`,
      ps.length > 0 && ref !== null && ps.every((p) => p.delta !== null && Math.abs(p.delta - (ref + SPB / 2)) <= 2),
      `deltas ${ps.map((p) => p.delta).join(', ')} against on-grid delta ${ref} + ${SPB / 2}`);
    const alle = je(quant, 0).concat(je(quant, 3.5), je(quant, 7));
    if (quant === 1) {
      notiere('K4 quant 1: the entry is a whole core beat', alle.length > 0 && alle.every((p) => nahe(p.ist_beat, 1)), alle.map((p) => p.ist_beat.toFixed(4)).join(' '));
    } else if (quant === 2) {
      notiere('K4 quant 2: entry core beat equals start beat modulo 4 (project bar on the core bar grid)', alle.length > 0 && alle.every((p) => nahe(p.ist_beat - p.beat, 4)),
        alle.map((p) => `${p.beat}->${p.ist_beat.toFixed(4)}`).join(' '));
    }
  }
  // K0: samples per beat from the quant 1 entries (whole core beats)
  const q1 = roh.starts.filter((p) => p.quant === 1);
  const spbs = [];
  for (let i = 1; i < q1.length; i++) { const db = q1[i].ist_beat - q1[0].ist_beat; if (db > 0) spbs.push((q1[i].ist_sample - q1[0].ist_sample) / db); }
  notiere('K0 the core runs at 120 BPM', spbs.length > 0 && spbs.every((x) => Math.abs(x - SPB) <= 1), `samples per beat ${spbs.map((x) => x.toFixed(2)).join(' ')} (24000 = 120 BPM)`);
} catch (e) {
  notiere('run', false, `aborted: ${e instanceof Error ? e.message : e}`);
}
fs.writeFileSync(path.join(z.ORDNER, 'ergebnis.json'), JSON.stringify(roh, null, 1));
await z.ende('S4a real-core start gate', /^s4a-/);
