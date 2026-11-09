// Acceptance, package 1.9 U7 T1 and T2 (instrument rack, spec E9, E11, AK-R1 to AK-R5 and the error case of a gap in the zones) on a TEST INSTANCE with the freshly built
// core (instances b, d or e only, never f, never the operation; the script refuses every other letter). Set-up (instance d, silent sink, no --ton-frei; E1 needs the 1.8 fixture and the proof client instead, see E1 below and t3-lauf.sh of the evidence folder):
//   mkdir -p <kits-d> && cp -a djk/core/tests/data/kits/. <kits-d>/            (the kit folder of the instance = a copy of the repo test kits)
//   CYPHERDJ_KATALOG=<empty catalog> DJK=<worktree>/djk djk/start/djk-start --instanz d --kit-ordner <kits-d>
//   flock <CYPHERDJ_ECHTZEIT_SCHLOSS> node check/acceptance_i19_rack.mjs --url http://127.0.0.1:51300 --bau <kern build folder> --kit-ordner <kits-d> \
//        --iso-ref <iso_ref> [--ausgabe <folder>] [--nur S,R1,R2,R3,RE,R4,R5,E1]
// What it states first (S): the kit folder is a byte copy of the repo test kits; the running core is <bau>/cypherdj-kern; the environment of the core and of
// the page server holds CYPHERDJ_KIT_ORDNER=<kits-d> (read from /proc/<pid>/environ); GET /proj/kits lists the three test kits. Without it the instance would
// read the operation's kit folder, so a script that cannot show this refuses to measure.
// The device is kit_rack (note 59 an impulse, note 60 a 1 kHz burst) in every member; members differ by zone and gain (A 0 dB, B -6 dB), so the offline
// renders of single-member racks tell which member sounded. Each point writes a rack project through /proj/aendern (spur_neu with the rack device):
//   R1  AK-R1: A ton 0..59, B ton 60..127: note 59 sounds only A, note 60 only B (the render equals the single-member render of A in the first half and of B in the
//       second half, 0 samples differ; the other member alone is silent there); live ring recording against the offline render below -90 dBFS.
//   R2  AK-R2: A vel 1..63, B vel 64..127: vel 63 sounds only A, vel 64 only B (same method); live against the render below -90 dBFS.
//   R3  AK-R3: both members over the whole range: the render equals the sum of the two single-member renders bit for bit (and differs from each); live below -90 dBFS.
//   RE  error case: A ton 0..59, B ton 61..127, note 60 (in no zone) sounds nothing (peak below -90 dBFS), note 59 in the same project sounds (control).
//   R4  AK-R4 chain select, live: A = RB-338 (chain 0..63) holds a long note and plays an impulse note every beat, B = kit_rack (chain 64..127, -12 dB); the chain
//       value goes 0 -> 100 (rack_kette) while the transport plays. A live swap lands on a block, not on a beat: the beat from which B sounds is read from the
//       recording (a one-sample step of the height of B's impulse). Then the recording must equal, through the isolator, the sum of two offline renders: A alone with the
//       long note and the impulse notes before the swap, B alone with the impulse notes after it (residual below -90 dB over the whole recording). That is: every note after
//       the swap sounds only B, the note held over the swap finishes on A (its tail is present), the impulse notes before it did not sound on B. Negative control: the sum
//       with A playing the later notes too differs by far. At the swap the A part has no step above 0.01 (and none above its own input's).
//   R5  AK-R5 gain (spec E11): offline, -6 dB on member B (rack_glied_setzen replaces it) lowers its share by 6.00 dB +- 0.01 (the plan says 6.02: that is the ratio 2; the core's gain_db -6 is 10^(-6/20), as its test R5 states) (the share = rack render minus the render
//       of A alone, made with rack_glied_entfernen); live, a rack_glied_setzen that lowers the gain of a sounding member from 0 to -6 dB while the transport plays ramps:
//       the recording equals the render of the old gain before the ramp and of the new gain after it, the ramp is longer than one sample, and the largest step of the
//       sample values around the change stays below the largest step of the input (the render of the old gain) plus a tenth of what a hard gain step adds to it (a ramp
//       adds the sample value times the gain slope, about 1 % here; a hard step as a control adds far more).
//   R6  AK-R6 (T4, only with --nur ...R6; needs the production host arr1: the instance started with djk-start --arr1): a rack of an RB-338 member and a Surge
//       member (slot 1, factory patch "Templates/Init Sine") with ONE common note is frozen (proj_freeze). Its RB-338 part (the frozen rack minus a freeze of the
//       same rack with the Surge member alone) starts within 1 sample of the offline render of the RB-338 member alone (onset = first sample above 1e-4); the Surge
//       member sounds in the frozen file; info: the Surge member frozen as a rack member equals the same Surge frozen as a plain track (largest sample difference).
//       Error case: the same project with the host stopped (systemctl stop) -> freeze refused 409 wirt_fehlt naming `djk-instrumente --arr1`, nothing stored; the
//       host is started again afterwards (djk-instrumente --arr1) and the freeze then goes through. Set-up: djk-start --instanz d --arr1 --kit-ordner <kits-d>.
//   E1  (only with --nur ...E1) T3 live MIDI on a rack track (1.8 routing, only checked): needs the 1.8 test MIDI source (core/check/in_check.cpp as acceptance_rec5.mjs runs it: the instance started with
//       --ohne-pruefmodus and ~/.config/cypherdj-d/geraete.json naming the proof client as input 1 and midi.port cypherdj-pruef-ein:m). The rack track is armed (eingang midi,
//       arm), the client sends ONE note 59 (velocity 100) and the master is recorded. A = kit_rack ton 0..59, B = kit_rack ton 60..127 at -6 dB. Peak of the master: with A alone
//       (reference), with A and B (B must be silent, same peak within 0.1 %), and with B widened to the whole range (control: 1.5 times the peak). Then a recording run
//       (/proj/aufnahme) with the full rack: the take holds one note, pitch 59.
//   M1, M2, M3 (T11, only with --makros or --nur ...M1,M2,M3; spec E12, E13, AK-M1 to AK-M3): macros on rack members and variations, through the API.
//       M1  an RB-338 member `cutoff` as macro target (von 0.2, bis 0.8, the member's own value 0.5 is ignored while mapped): offline the render at macro 0 equals the render of
//           a plain member with cutoff 0.2 and at macro 1 the one with 0.8 (0 samples differ), and differs from the unmapped member at 0.5 (the control); live, a macro move 0 -> 1
//           while the transport plays raises the spectral centroid (256-frame windows of the master recording): from the first window that rises, the centroid is at least 1.5 times
//           the one before, and in a control run (the same move on an unmapped macro) it stays within 15 %; the 17th mapping is refused makro_voll (16 are accepted).
//       M2  a Surge member parameter as macro target is refused makro_ziel_wirt (control: the same table on the RB-338 member is accepted; nothing changes on a refusal).
//       M3  save a variation, move the macros, load it: the four values come back exactly (a control change, no new playback), the undo of the load restores the moved values,
//           a ninth variation is refused variation_voll (replacing a name is not), an unknown name variation_unbekannt.
// Return: 0 all points OK, 1 at least one FEHL, 2 usage. Only own projects (slug i19r-...) are removed; nothing is written outside <ausgabe>, /dev/shm/cypherdj-<i>
// and the scratch of the points. The kit folder is only read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { leseWav } from './w1_wav.mjs';
import { leseMidiDatei } from '../project/recording.ts';
import { erzeugeApi, kernExeStimmt } from './i19_base_project.mjs';
import { leseF32Stereo, spektrum } from './i19_spectrum.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..', '..');
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, bau: { type: 'string' }, 'kit-ordner': { type: 'string' }, 'iso-ref': { type: 'string' },
  ausgabe: { type: 'string' }, instanz: { type: 'string' }, nur: { type: 'string' }, makros: { type: 'boolean' } } });
const aufruf = (t) => { process.stderr.write(`abnahme_i19_rack: ${t}\n`); process.exit(2); };
if (!opt.url || !opt.bau || !opt['kit-ordner']) {
  aufruf('usage: --url <http://127.0.0.1:port> --bau <kern build folder> --kit-ordner <kit folder of the instance> --iso-ref <iso_ref> [--ausgabe <folder>] '
    + '[--instanz <b|d|e>] [--nur S,R1,R2,R3,RE,R4,R5,R6,E1,M1,M2,M3] [--makros]');
}
if (/:(47300|47100|47200)\b/.test(opt.url)) aufruf('never against the operation (47300): choose a test instance');
const port = Number(new globalThis.URL(opt.url).port), kn = (port - 47300) / 1000;
const instanz = opt.instanz ?? (Number.isInteger(kn) && kn >= 1 && kn <= 9 ? String.fromCharCode(96 + kn) : undefined);
if (!/^[bde]$/.test(instanz ?? '')) aufruf(`instance ${instanz ?? '?'} (port ${port}) is not allowed: b, d or e only (never f)`);
// real path: djk-start hands the unit the readlink -f of --kit-ordner
let KITS;
try { KITS = fs.realpathSync(path.resolve(opt['kit-ordner'])); } catch (e) { aufruf(`--kit-ordner ${opt['kit-ordner']}: ${e.message}`); }
const BAU = path.resolve(opt.bau);
const ISO_REF = opt['iso-ref'] ? path.resolve(opt['iso-ref']) : null;
const NUR = opt.nur ? new Set(opt.nur.split(',').map((x) => x.trim().toUpperCase())) : opt.makros ? new Set(['S', 'M1', 'M2', 'M3']) : null;
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-i19-rack`);
fs.mkdirSync(ORDNER, { recursive: true });

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (kz, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}\n`); };
const info = (text) => { zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };

const CYPHER = { 'x-djk-quelle': 'cypher' };
const api = erzeugeApi(opt.url);
const ruf = api.ruf;
class Fehl extends Error {}
const grundVon = (r) => `${r.code} ${r.j?.fehler ?? r.j?.grund ?? ''}${r.j?.text ? `: ${r.j.text}` : ''}`.trim();
const erwarte200 = (weg, r) => { if (r.code !== 200) throw new Fehl(`${weg} -> ${grundVon(r)}`); return r; };
const holeRev = async () => erwarte200('/proj/aktuell?nur=rev', await ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
const aktuell = async () => erwarte200('/proj/aktuell', await ruf('GET', '/proj/aktuell')).j;
const aendern = async (label, befehle) => erwarte200(`/proj/aendern (${label})`, await ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, CYPHER)).j;
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');
const eigeneSlugs = [];
const fmt = (x, n = 3) => (typeof x === 'number' ? x.toFixed(n) : String(x));
const dbfs = (x) => (x > 0 ? 20 * Math.log10(x) : -200);
const sha256Datei = (d) => crypto.createHash('sha256').update(fs.readFileSync(d)).digest('hex');
const prog = (programm, args) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz, CYPHERDJ_KIT_ORDNER: KITS } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const letzteZeile = (t) => t.trim().split('\n').filter(Boolean).pop() ?? '';
const jsonZeile = (t) => { try { return JSON.parse(letzteZeile(t)); } catch { return null; } };

async function neuesProjekt(name) {
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `i19r-${name}-${zeit}` }));
  const slug = r.j.slug ?? r.j.projekt?.slug;
  if (!slug) throw new Fehl(`/proj/neu without slug: ${JSON.stringify(r.j).slice(0, 200)}`);
  eigeneSlugs.push(slug);
  await warte(1500);
  return slug;
}
const geladen = async () => { const a = await aktuell(); return a.kern?.rev_geladen === a.projekt.wiedergabe_rev; };
const warteGeladen = async () => {
  if (!(await bisWahr(geladen, 60000))) throw new Fehl('the core did not load the playback (kern.rev_geladen = projekt.wiedergabe_rev never came)');
  await warte(5000);   // let the state file and the restart state catch up (the null test precondition reads the restart state)
};
// The master tempo follows the project tempo only while the arrangement transport runs (the start ramps it over one bar): bring the master to `bpm` with a
// warm-up run of the transport, then stop; the null test precondition reads the master tempo of the core.
const masterBpm = async () => (await ruf('GET', '/lage')).j?.uhr?.bpm ?? 0;
const warteTempo = async (bpm) => {
  if (Math.abs((await masterBpm()) - bpm) < 0.01) return;
  const st = await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  if (st.code !== 200) throw new Fehl(`warm-up transport start -> ${grundVon(st)}`);
  const da = await bisWahr(async () => Math.abs((await masterBpm()) - bpm) < 0.01, 40000);
  const jetzt = await masterBpm();
  await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  await warte(1500);
  if (!da) throw new Fehl(`the master tempo did not reach ${bpm} BPM (lage uhr.bpm ${jetzt})`);
  info(`master tempo brought to ${bpm} BPM by a warm-up run of the transport`);
};
// The export reads the controller state from the core's state file, written every 50 ms: wait before the export (as abnahme_r3 does).
const SETTLE_MS = 1000;
const exportiere = async (von, bis, abgriff) => { await warte(SETTLE_MS); return erwarte200('/proj/export', await ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis, ...(abgriff ? { abgriff } : {}) }, CYPHER)).j; };


// the live ring recording against the offline render (abnahme_r3 nullLive, the produktion tap through the isolator reference)
function stromLesen() {
  const ac = new AbortController();
  const meldungen = [];
  let streamFehler = null;
  const fertig = (async () => {
    try {
      const r = await fetch(opt.url + '/strom', { signal: ac.signal });
      const dec = new globalThis.TextDecoder();
      let puf = '';
      for await (const stueck of r.body) {
        puf += dec.decode(stueck, { stream: true });
        let i;
        while ((i = puf.indexOf('\n\n')) >= 0) {
          const block = puf.slice(0, i);
          puf = puf.slice(i + 2);
          if (!block.startsWith('data: ')) continue;
          try { meldungen.push({ t: Date.now(), ...JSON.parse(block.slice(6)) }); } catch { /* half line */ }
        }
      }
    } catch (e) { if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') streamFehler = e; }
  })();
  return { meldungen, stop: async () => { ac.abort(); await fertig; if (streamFehler) throw new Fehl(`/strom: ${streamFehler.message}`); } };
}
async function nullLive(kz, bpm, beats, sekunden) {
  const dir = path.join(ORDNER, kz);
  fs.mkdirSync(path.join(dir, 'w'), { recursive: true });
  const nr = (await aktuell()).projekt.wiedergabe_rev;
  const werkzeug = (n) => path.join(BAU, n);
  const vb = await prog(werkzeug('cypherdj-nulltest'), ['--vorbedingung', '--bpm', String(bpm)]);
  fs.writeFileSync(path.join(dir, 'vorbedingung.json'), `${vb.out}${vb.err}rc=${vb.rc}\n`);
  const vbj = jsonZeile(vb.out);
  if (vb.rc !== 0 || vbj?.vorbedingung !== 'erfuellt') return { ungueltig: `precondition of the null test not met (rc ${vb.rc}): ${letzteZeile(vb.out) || letzteZeile(vb.err)}` };
  const sse = stromLesen();
  const mit = prog(werkzeug('cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', path.join(dir, 'live.f32')]);
  await warte(500);
  const start = await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  const m = await mit;
  await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  await warte(300);
  await sse.stop();
  fs.writeFileSync(path.join(dir, 'live.json'), m.out);
  fs.writeFileSync(path.join(dir, 'mitschnitt.err'), `${m.err}rc=${m.rc}\n`);
  const live = jsonZeile(m.out);
  if (start.code !== 200 || m.rc !== 0 || !live) return { ungueltig: `recording failed: transport ${grundVon(start)}, cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}` };
  const einsatz = sse.meldungen.find((x) => x.a === '/zustand/arr' && x.f?.status === 2);
  if (!einsatz) return { ungueltig: 'no /zustand/arr with status 2 in the stream (ursprung_sample unknown)' };
  const ursprung = einsatz.f.ursprung_sample;
  const render = async (name, abgriff) => {
    const r = await prog(werkzeug('cypherdj-render'), ['--nr', String(nr), '--von-beat', '0', '--bis-beat', String(beats), '--bpm', String(bpm), '--aus', path.join(dir, 'w', `${name}.wav`),
      '--abgriff', abgriff, '--kit-ordner', KITS]);
    fs.writeFileSync(path.join(dir, 'w', `${name}.json`), `${r.out}${r.err}rc=${r.rc}\n`);
    return { rc: r.rc, j: jsonZeile(r.out), err: r.err.trim() };
  };
  const p = await render('p', 'produktion');
  if (p.rc !== 0 || !p.j) return { ungueltig: `render failed: rc ${p.rc} ${p.err}` };
  const iso = await prog(ISO_REF, [path.join(dir, 'w', 'p.wav'), path.join(dir, 'w', 'p_iso.wav')]);
  if (iso.rc !== 0) return { ungueltig: `isolator reference failed (rc ${iso.rc}): ${iso.err.trim()}` };
  const vergleich = async (name, wav, rj) => {
    const r = await prog(werkzeug('cypherdj-nulltest'), ['--live', path.join(dir, 'live.f32'), '--live-s0', String(live.s0), '--grenze', String(live.grenze), '--ursprung', String(ursprung), '--render', wav,
      '--start-sample', String(rj.start_sample), '--frames', String(rj.frames), '--vorhalt', String(rj.vorhalt), '--quantum', String(rj.quantum)]);
    fs.writeFileSync(path.join(dir, `nulltest-${name}.json`), `${r.out}${r.err}rc=${r.rc}\n`);
    return { rc: r.rc, j: jsonZeile(r.out), err: r.err.trim() };
  };
  const vPI = await vergleich('produktion-isolator', path.join(dir, 'w', 'p_iso.wav'), p.j);
  const vPR = await vergleich('produktion-roh', path.join(dir, 'w', 'p.wav'), p.j);
  return { dir, nr, live, ursprung, p: p.j, vPI, vPR };
}
const nl = (v) => (v?.j ? `${v.j.urteil}${v.j.ursache ? `/${v.j.ursache}` : ''} residual ${fmt(v.j.rest_db)} dBFS, shifted by one sample ${fmt(v.j.verschoben_db)} dBFS, signal ${fmt(v.j.signal_db)} dBFS, phase live ${v.j.phase_live} against render ${v.j.phase_render} (rc ${v.rc})`
  : `no output (rc ${v?.rc}: ${v?.err})`);

// ---- the points ----------------------------------------------------------------------------------------------------------------------------------------------

async function aufbau() {
  const quelle = path.join(REPO, 'djk', 'core', 'tests', 'data', 'kits');
  const dateien = (d) => fs.readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(d, path.join(e.parentPath ?? e.path, e.name))).sort();
  const a = dateien(quelle), b = dateien(KITS);
  const gleich = JSON.stringify(a) === JSON.stringify(b) && a.every((f) => sha256Datei(path.join(quelle, f)) === sha256Datei(path.join(KITS, f)));
  notiere('S1', gleich, `kit folder ${KITS} is a byte copy of ${quelle} (${a.length} files${gleich ? '' : `; repo ${a.join(',')} vs instance ${b.join(',')}`})`);
  notiere('S1b', path.resolve(KITS) !== path.join(os.homedir(), '.config', 'cypherdj', 'kits'), 'the instance kit folder is not the operation kit folder');
  const exe = kernExeStimmt(BAU, instanz);
  notiere('S2', exe.ok, exe.text);
  for (const [kz, unit] of [['S3', `cypherdj-kern-${instanz}`], ['S4', `cypherdj-oberflaeche-${instanz}`]]) {
    const pid = spawnSync('systemctl', ['--user', 'show', '-p', 'MainPID', '--value', unit], { encoding: 'utf8' }).stdout.trim();
    let wert = null;
    if (/^[1-9][0-9]*$/.test(pid)) {
      try { wert = fs.readFileSync(`/proc/${pid}/environ`, 'latin1').split('\0').find((z) => z.startsWith('CYPHERDJ_KIT_ORDNER=')) ?? null; } catch (e) { wert = `unreadable: ${e.message}`; }
    }
    notiere(kz, wert === `CYPHERDJ_KIT_ORDNER=${KITS}`, `${unit} pid ${pid || '-'} environment: ${wert ?? 'no CYPHERDJ_KIT_ORDNER'} (expected ${KITS})`);
  }
  const l = await ruf('GET', '/proj/kits');
  const namen = (l.j?.kits ?? []).map((k) => k.name);
  notiere('S5', l.code === 200 && ['kit_impuls', 'kit_rack', 'kit_zwei'].every((n) => namen.includes(n)) && namen.length === 3, `GET /proj/kits -> ${l.code} ${JSON.stringify(l.j)}`);
  for (const n of ['cypherdj-render', 'cypherdj-mitschnitt', 'cypherdj-nulltest']) if (!fs.existsSync(path.join(BAU, n))) notiere('S6', false, `${path.join(BAU, n)} missing`);
  if (!ISO_REF || !fs.existsSync(ISO_REF)) notiere('S7', false, `--iso-ref ${ISO_REF ?? '(not given)'} missing: the null test cannot be judged without the isolator reference`);
}

// ---- rack helpers: a project with one rack track at 120 BPM (24000 samples per beat at 48 kHz), notes at beat 0 and beat 2, 4 beats long
const BPM = 120, HALB = 48000, GANZ = 96000;
const kitGlied = (id, extra = {}) => ({ id, geraet: { art: 'intern', name: 'kit', kit: 'kit_rack' }, ...extra });
const rackGeraet = (glieder) => ({ art: 'rack', kette: 0, glieder });
// the two members of the three points; B is 6 dB lower, so the single-member renders tell the members apart
const mitGlieder = {
  R1: [kitGlied('g1', { ton: [0, 59] }), kitGlied('g2', { ton: [60, 127], gain_db: -6 })],
  R2: [kitGlied('g1', { vel: [1, 63] }), kitGlied('g2', { vel: [64, 127], gain_db: -6 })],
  R3: [kitGlied('g1'), kitGlied('g2', { gain_db: -6 })],
  RE: [kitGlied('g1', { ton: [0, 59] }), kitGlied('g2', { ton: [61, 127], gain_db: -6 })],
};
const NOTEN = {
  R1: [{ beat: 0, laenge: 0.5, ton: 59, vel: 100 }, { beat: 2, laenge: 0.5, ton: 60, vel: 100 }],
  R2: [{ beat: 0, laenge: 0.5, ton: 59, vel: 63 }, { beat: 2, laenge: 0.5, ton: 59, vel: 64 }],
  // R3 plays softly: with the pan hard left the sum of both members would pass full scale and the live path (a limiter) would no longer be linear
  R3: [{ beat: 0, laenge: 0.5, ton: 59, vel: 40 }, { beat: 2, laenge: 0.5, ton: 60, vel: 40 }],
  RE: [{ beat: 0, laenge: 0.5, ton: 59, vel: 100 }, { beat: 2, laenge: 0.5, ton: 60, vel: 100 }],
};
async function rackProjekt(kz) {
  await neuesProjekt(kz.toLowerCase());
  await aendern(`${kz} tempo and rack track`, [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'instrument', geraet: rackGeraet(mitGlieder[kz]) }]);
  const s = (await aktuell()).projekt.spuren[0];
  notiere(`${kz}a`, s.name === 'Rack' && s.geraet.art === 'rack' && s.geraet.glieder.length === 2 && !('freeze' in s),
    `track ${s.id} "${s.name}", device art ${s.geraet?.art}, ${s.geraet?.glieder?.length} members, freeze field ${'freeze' in s ? 'present' : 'absent'}`);
  await aendern(`${kz} notes`, [{ befehl: 'clip_neu', spur_id: s.id, art: 'midi', start_beat: 0, laenge_beats: 4, name: kz, noten: NOTEN[kz] }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 4 }]);
  return s.id;
}
// the offline export of the current project (beats 0..4, produktion tap) as float samples; `datei` is kept under <ausgabe>/<name>.wav
async function exportWav(name) {
  await warteTempo(BPM);
  await warteGeladen();
  const e = await exportiere(0, 4, 'produktion');
  const kopie = path.join(ORDNER, `${name}.wav`);
  fs.copyFileSync(e.datei, kopie);
  return leseWav(kopie);
}
const spitze = (w, von, bis) => { let m = 0; for (let i = von; i < Math.min(bis, w.frames); i++) m = Math.max(m, Math.abs(w.l[i]), Math.abs(w.r[i])); return m; };
const unterschiede = (a, b, von, bis) => {   // number of samples (both channels) that differ bit for bit in [von, bis)
  let n = 0;
  for (let i = von; i < bis; i++) { if (a.l[i] !== b.l[i]) n++; if (a.r[i] !== b.r[i]) n++; }
  return n;
};
const summe = (a, b) => { const l = new Float32Array(a.frames), r = new Float32Array(a.frames); for (let i = 0; i < a.frames; i++) { l[i] = a.l[i] + b.l[i]; r[i] = a.r[i] + b.r[i]; } return { l, r, frames: a.frames }; };
// the project holds the full rack: render it, then each member alone (same zones and gains in a one-member rack), then the full rack again for the live comparison
async function einzelRenders(kz, sid) {
  const voll = await exportWav(`${kz.toLowerCase()}-voll`);
  const einzel = [];
  for (const i of [0, 1]) {
    await aendern(`${kz} member ${i + 1} alone`, [{ befehl: 'spur_aendern', spur_id: sid, geraet: rackGeraet([mitGlieder[kz][i]]) }]);
    einzel.push(await exportWav(`${kz.toLowerCase()}-nur-g${i + 1}`));
  }
  await aendern(`${kz} full rack again`, [{ befehl: 'spur_aendern', spur_id: sid, geraet: rackGeraet(mitGlieder[kz]) }]);
  return { voll, a: einzel[0], b: einzel[1] };
}
async function live(kz) {
  await warteTempo(BPM);
  await warteGeladen();
  let a = await nullLive(`${kz.toLowerCase()}-live`, BPM, 4, 8);
  for (let v = 2; v <= 3 && a.vPI?.j?.urteil === 'ungueltig'; v++) { info(`${kz}: attempt ${v - 1} invalid (${a.vPI.j.ursache}), once more`); a = await nullLive(`${kz.toLowerCase()}-live-v${v}`, BPM, 4, 8); }
  if (a.ungueltig) throw new Fehl(`${kz} live comparison invalid, not passed: ${a.ungueltig}`);
  const ok = a.vPI?.j?.urteil === 'bestanden' && a.vPI.j.rest_db < -90 && a.vPI.j.signal_db > -60 && a.vPI.j.phase_live === a.vPI.j.phase_render;
  notiere(`${kz}-live`, ok, `live ring recording against the offline render, ${nl(a.vPI)}`);
  notiere(`${kz}-live-c`, a.vPR?.j?.urteil === 'rot' && a.vPR.j.rest_db > -90, `negative control (render without the isolator): ${nl(a.vPR)}`);
}
// R1 and R2: in the first half only member A sounds, in the second half only member B
async function einsEntweder(kz, text) {
  const sid = await rackProjekt(kz);
  const r = await einzelRenders(kz, sid);
  const sp = [spitze(r.voll, 0, HALB), spitze(r.voll, HALB, GANZ)];
  const dA = unterschiede(r.voll, r.a, 0, HALB), dB = unterschiede(r.voll, r.b, HALB, GANZ);
  const stummB = spitze(r.b, 0, HALB), stummA = spitze(r.a, HALB, GANZ);
  notiere(kz, dA === 0 && dB === 0 && stummB === 0 && stummA === 0 && sp[0] > 0.01 && sp[1] > 0.01,
    `${text}: first half equals the render of A alone (${dA} samples differ), second half the render of B alone (${dB} differ); B alone in the first half peak ${stummB}, `
    + `A alone in the second half peak ${stummA}; peaks of the rack ${fmt(dbfs(sp[0]))} / ${fmt(dbfs(sp[1]))} dBFS (A 0 dB, B -6 dB)`);
  notiere(`${kz}-c`, unterschiede(r.voll, r.b, 0, HALB) > 0 && unterschiede(r.voll, r.a, HALB, GANZ) > 0,
    'negative control: the first half differs from B alone and the second half from A alone (the comparison can tell the members apart)');
  await live(kz);
}
async function r1() { await einsEntweder('R1', 'AK-R1 note 59 only A, note 60 only B'); }
async function r2() { await einsEntweder('R2', 'AK-R2 vel 63 only A, vel 64 only B'); }
// The track gain (fader and pan law) multiplies the SUM of the members: with the pan in the middle that gain is not 1, and (x + y) * g differs from x * g + y * g
// by one float rounding. So the verdict "bit for bit" is taken with the pan hard left (the left gain of the pan law is exactly 1, the right channel is silent);
// the centred pan is measured too and reported with its largest deviation (one rounding step expected).
const maxAbw = (a, b) => { let m = 0; for (let i = 0; i < a.frames; i++) m = Math.max(m, Math.abs(a.l[i] - b.l[i]), Math.abs(a.r[i] - b.r[i])); return m; };
async function r3() {
  const sid = await rackProjekt('R3');
  const mitte = await einzelRenders('R3', sid);
  const sm = summe(mitte.a, mitte.b);
  info(`R3 pan centred: ${unterschiede(mitte.voll, sm, 0, mitte.voll.frames)} samples differ from the float sum, largest deviation ${maxAbw(mitte.voll, sm)} (peak ${fmt(spitze(mitte.voll, 0, GANZ))}; one float rounding of the track gain expected)`);
  await aendern('R3 pan hard left', [{ befehl: 'spur_aendern', spur_id: sid, pan: -1 }]);
  const r = await einzelRenders('R3', sid);
  const s = summe(r.a, r.b);
  const d = unterschiede(r.voll, s, 0, r.voll.frames);
  const sp = spitze(r.voll, 0, GANZ);
  notiere('R3', r.voll.frames === r.a.frames && r.voll.frames === r.b.frames && d === 0 && sp > 0.01,
    `AK-R3 overlap (pan hard left, track gain exactly 1): rack render ${r.voll.frames} frames equals the float sum of the two single-member renders, ${d} samples differ; peak ${fmt(dbfs(sp))} dBFS`);
  notiere('R3-c', unterschiede(r.voll, r.a, 0, GANZ) > 0 && unterschiede(r.voll, r.b, 0, GANZ) > 0,
    'negative control: the rack render differs from each single-member render (both members sound)');
  await live('R3');
}
async function re() {
  const sid = await rackProjekt('RE');
  const w = await exportWav('re-voll');
  const s59 = spitze(w, 0, HALB), s60 = spitze(w, HALB, GANZ);
  notiere('RE', s60 < 10 ** (-90 / 20) && s59 > 0.01, `note 60 in no zone (A 0..59, B 61..127): peak ${fmt(dbfs(s60))} dBFS (below -90); control note 59 in the same project peak ${fmt(dbfs(s59))} dBFS`);
  void sid;
}

// ---- R4 and R5 (T2): live swaps of a running rack. The helpers build a rack project of free members and notes, render it, and run a command while the transport plays.
const rbGlied = (id, extra = {}) => ({ id, geraet: { art: 'intern', name: 'rb338', parameter: {} }, ...extra });
const SPB = 24000;   // samples per beat at 120 BPM
// a project with one rack track (pan hard left: the track gain is exactly 1, the members add linearly), one MIDI clip of 16 beats, the loop over it
async function baueRackProjekt(name, glieder, noten, kette = 0) {
  await neuesProjekt(name);
  await aendern(`${name} tempo and rack track`, [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'rack', kette, glieder } }]);
  const sid = (await aktuell()).projekt.spuren[0].id;
  await aendern(`${name} pan`, [{ befehl: 'spur_aendern', spur_id: sid, pan: -1 }]);
  await aendern(`${name} notes`, [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 0, laenge_beats: 16, name, noten }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }]);
  return sid;
}
// export beats 0..16 of the loaded project through the production tap, then through the isolator (the live path), as {l, r, frames}
async function exportIso(name) {
  await warteTempo(BPM);
  await warteGeladen();
  const e = await exportiere(0, 16, 'produktion');
  const roh = path.join(ORDNER, 'w'); fs.mkdirSync(roh, { recursive: true });
  const a = path.join(roh, `${name}.wav`), b = path.join(roh, `${name}-iso.wav`);
  fs.copyFileSync(e.datei, a);
  const iso = await prog(ISO_REF, [a, b]);
  if (iso.rc !== 0) throw new Fehl(`${name}: isolator reference failed (rc ${iso.rc}): ${iso.err.trim()}`);
  return leseWav(b);
}
const f32Datei = (pfad) => { const b = fs.readFileSync(pfad); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const erster = (x, schwelle = 1e-6) => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > schwelle) return i; return -1; };
const maxStufe = (x, von, bis) => { let m = 0; for (let i = Math.max(1, von); i < Math.min(bis, x.length); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
const effektiv = (x, von, bis) => { let s = 0, n = 0; for (let i = Math.max(0, von); i < Math.min(bis, x.length); i++) { s += x[i] * x[i]; n++; } return n ? Math.sqrt(s / n) : 0; };
// the live recording while a command runs: `befehle` is sent `nach` ms after the transport start; returns the left channel of the recording and where the render's frame 0 lies in it
async function liveMitBefehl(kz, befehle, nach, sekunden) {
  const dir = path.join(ORDNER, kz);
  fs.mkdirSync(dir, { recursive: true });
  await warteTempo(BPM);
  await warteGeladen();
  const vb = await prog(path.join(BAU, 'cypherdj-nulltest'), ['--vorbedingung', '--bpm', String(BPM)]);
  const vbj = jsonZeile(vb.out);
  if (vb.rc !== 0 || vbj?.vorbedingung !== 'erfuellt') throw new Fehl(`precondition of the null test not met (rc ${vb.rc}): ${letzteZeile(vb.out) || letzteZeile(vb.err)}`);
  const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', path.join(dir, 'live.f32')]);
  await warte(500);
  const start = await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  const t0 = Date.now();
  await warte(nach);
  const rev = await holeRev();
  const tSende = Date.now();
  const r = await ruf('POST', '/proj/aendern', { rev, label: `${kz} live change`, befehle }, CYPHER);
  const t1 = Date.now();
  const m = await mit;
  await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  await warte(300);
  if (start.code !== 200 || r.code !== 200 || m.rc !== 0) throw new Fehl(`live run failed: transport ${grundVon(start)}, change ${grundVon(r)}, mitschnitt rc ${m.rc} ${m.err.trim()}`);
  info(`${kz}: the change was sent ${t1 - t0} ms after the transport start and answered in ${Date.now() - t1} ms (betrifft_wiedergabe ${r.j?.betrifft_wiedergabe})`);
  const f = f32Datei(path.join(dir, 'live.f32'));
  const l = new Float32Array(f.length / 2);
  for (let i = 0; i < l.length; i++) l[i] = f[2 * i];
  l.sendeMs = tSende - t0;   // wall clock of the send after the transport start (M1 places the macro move in the recording with it)
  return l;
}
async function r4() {
  const gA = rbGlied('g1', { kette: [0, 63] });
  const gB = kitGlied('g2', { kette: [64, 127], gain_db: -12 });
  const impulse = (von, bis) => Array.from({ length: bis - von }, (_, i) => ({ beat: von + i, laenge: 0.5, ton: 59, vel: 100 }));
  const gehalten = { beat: 0, laenge: 14, ton: 40, vel: 100 };
  // references of the full run: A alone with every note (its onset marks frame 0 of the render), B alone with every impulse (the height of its impulse)
  await baueRackProjekt('r4a', [gA], [gehalten, ...impulse(0, 14)], 0);
  const afull = await exportIso('r4-a-voll');
  await baueRackProjekt('r4b', [gB], impulse(0, 14), 100);
  const bvoll = await exportIso('r4-b-voll');
  // the live run: both members, chain 0, the chain value goes to 100 while the transport plays
  const sid = await baueRackProjekt('r4', [gA, gB], [gehalten, ...impulse(0, 14)], 0);
  const l = await liveMitBefehl('r4-live', [{ befehl: 'rack_kette', spur_id: sid, kette: 100 }], 3000, 9);
  const r0 = erster(afull.l), l0 = erster(l);
  if (r0 < 0 || l0 < 0) throw new Fehl(`no onset found (render ${r0}, recording ${l0})`);
  const lag = l0 - r0;   // recording frame = render frame + lag
  let pB = 0;
  for (let i = 0; i < bvoll.frames; i++) pB = Math.max(pB, Math.abs(bvoll.l[i]));
  // which beat is the first one B plays: B's impulse is a one-sample step of the height pB, A's own onset is not that high
  const stufeBei = (x, o) => { let m = 0; for (let i = o - 2; i <= o + 4; i++) if (i >= 1) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  const messA = [], messL = [];
  for (let k = 0; k < 14; k++) { messA.push(stufeBei(afull.l, r0 + k * SPB)); messL.push(stufeBei(l, lag + r0 + k * SPB)); }
  const istB = messL.map((m, k) => m > messA[k] + pB / 2);
  const kB = istB.indexOf(true);
  info(`R4: height of B's impulse ${fmt(pB)}; step at each beat in the recording ${messL.map(fmt).join(' ')}; A's own step in its render ${messA.map(fmt).join(' ')}`);
  if (kB <= 0 || istB.slice(kB).some((x) => !x)) throw new Fehl(`R4: the beats cannot be split into A before and B after (B at beats ${istB.map((x, k) => (x ? k : '-')).join(' ')})`);
  info(`R4: B plays from beat ${kB} on (the swap came after beat ${kB - 1}, recording lag ${lag} samples)`);
  // the two parts the recording must be made of
  await baueRackProjekt('r4ea', [gA], [gehalten, ...impulse(0, kB)], 0);
  const ea = await exportIso('r4-erwartet-a');
  await baueRackProjekt('r4eb', [gB], impulse(kB, 14), 100);
  const eb = await exportIso('r4-erwartet-b');
  const n = Math.min(ea.frames, l.length - lag);
  const rest = (xa, xb) => { let e = 0, sg = 0; for (let i = 0; i < n; i++) { const d = l[i + lag] - (xa[i] + xb[i]); e += d * d; sg += l[i + lag] * l[i + lag]; } return { rest_db: dbfs(Math.sqrt(e / n)), signal_db: dbfs(Math.sqrt(sg / n)) }; };
  const ist = rest(ea.l, eb.l);
  // control: A plays the later notes too (what a swap that keeps the old routing for new notes would give)
  const falsch = rest(afull.l, eb.l);
  const swapVon = r0 + (kB - 1) * SPB, swapBis = r0 + kB * SPB;   // the swap lies between the last A impulse and the first B impulse
  const teilA = new Float32Array(n);   // the part of A in the recording: recording minus B's expected part
  for (let i = 0; i < n; i++) teilA[i] = l[i + lag] - eb.l[i];
  const stufeLive = maxStufe(teilA, swapVon + 2000, swapBis - 2000), stufeA = maxStufe(ea.l, swapVon + 2000, swapBis - 2000);
  const schwanz = effektiv(ea.l, swapBis, swapBis + SPB);
  notiere('R4', ist.rest_db < -90 && ist.signal_db > -60 && schwanz > 10 ** (-60 / 20),
    `AK-R4 chain 0 -> 100 while playing: B plays from beat ${kB} on; the recording equals the isolator-filtered sum of A alone (long note, impulse notes of beats 0..${kB - 1}) and B alone `
    + `(impulse notes of beats ${kB}..13): residual ${fmt(ist.rest_db)} dBFS against a signal of ${fmt(ist.signal_db)} dBFS (below -90 required); the long note's tail after the swap `
    + `(rms of A's render in the beat after beat ${kB - 1}) ${fmt(dbfs(schwanz))} dBFS`);
  notiere('R4-c', falsch.rest_db > -60,
    `negative control: the sum in which A also plays the notes after the swap differs from the recording, residual ${fmt(falsch.rest_db)} dBFS (above -60 required)`);
  notiere('R4-s', stufeLive <= Math.max(0.01, stufeA * 1.01),
    `no step at the swap: largest sample step of A's part in the beats around it (recording minus B's part, between the last A and the first B impulse) ${fmt(stufeLive)}, `
    + `of A's own render there ${fmt(stufeA)} (at most 0.01 or the input's own required)`);
}
// R5 offline: B's share = rack render minus the render of A alone; -6 dB lowers it by 6.02 dB +- 0.01
async function r5Offline() {
  const gA = rbGlied('g1', { ton: [0, 58] });
  const gB = (db) => kitGlied('g2', { ton: [59, 127], gain_db: db });
  const noten = [{ beat: 0, laenge: 3, ton: 40, vel: 100 }, ...[0, 1, 2, 3].map((k) => ({ beat: k, laenge: 0.5, ton: 59, vel: 100 }))];
  const sid = await baueRackProjekt('r5o', [gA, gB(0)], noten, 0);
  const voll0 = await exportIso('r5-b0');
  await aendern('R5 gain -6 on B', [{ befehl: 'rack_glied_setzen', spur_id: sid, glied: gB(-6) }]);
  const g = (await aktuell()).projekt.spuren[0].geraet.glieder;
  const voll6 = await exportIso('r5-b6');
  await aendern('R5 B out', [{ befehl: 'rack_glied_entfernen', spur_id: sid, glied_id: 'g2' }]);
  const nurA = await exportIso('r5-a');
  const teil = (v) => { let m = 0; for (let i = 0; i < v.frames; i++) m = Math.max(m, Math.abs(v.l[i] - nurA.l[i])); return m; };
  const p0 = teil(voll0), p6 = teil(voll6), db = 20 * Math.log10(p0 / p6);
  notiere('R5', g.length === 2 && g[1].gain_db === -6 && p0 > 0.01 && Math.abs(db - 6) <= 0.01,
    `AK-R5 gain offline: the share of B (rack render minus A alone, largest sample) is ${fmt(p0)} at 0 dB and ${fmt(p6)} at -6 dB: ${db.toFixed(4)} dB lower (6.00 +- 0.01 required: gain_db -6 is the factor 10^(-6/20), the plan's 6.02 is the amplitude ratio 2)`);
}
// R5 live: the gain of a sounding member goes 0 -> -6 dB while the transport plays
async function r5Live() {
  const gA = (db) => rbGlied('g1', { gain_db: db });
  const gehalten = [{ beat: 0, laenge: 14, ton: 40, vel: 100 }];
  await baueRackProjekt('r5a', [gA(0)], gehalten, 0);
  const ref0 = await exportIso('r5-live-ref0');
  await baueRackProjekt('r5b', [gA(-6)], gehalten, 0);
  const ref6 = await exportIso('r5-live-ref6');
  const sid = await baueRackProjekt('r5l', [gA(0)], gehalten, 0);
  const l = await liveMitBefehl('r5-live', [{ befehl: 'rack_glied_setzen', spur_id: sid, glied: gA(-6) }], 3000, 9);
  const r0 = erster(ref0.l), l0 = erster(l);
  if (r0 < 0 || l0 < 0) throw new Fehl(`no onset found (render ${r0}, recording ${l0})`);
  const lag = l0 - r0, n = Math.min(ref0.frames, l.length - lag);
  // the ramp: from the first frame the recording leaves the render of 0 dB to the last frame before it settles on the render of -6 dB
  const tol = 1e-6;
  const mitte = r0 + 2 * SPB;   // the change comes about 3 s after the start, well after this
  let von = -1;
  for (let i = mitte; i < n; i++) if (Math.abs(l[i + lag] - ref0.l[i]) > tol) { von = i; break; }
  let bis = -1;
  if (von >= 0) for (let i = von; i < n; i++) { let ok = true; for (let j = i; j < Math.min(n, i + 2000); j++) if (Math.abs(l[j + lag] - ref6.l[j]) > tol) { ok = false; break; } if (ok) { bis = i; break; } }
  if (von < 0 || bis < 0) throw new Fehl(`R5 live: no ramp found in the recording (leaves 0 dB at ${von}, settles on -6 dB at ${bis})`);
  const restDb = (a, vb, vl, bv) => { let e = 0, sg = 0; for (let i = a; i < vb; i++) { const d = l[i + lag] - bv.l[i]; e += d * d; sg += bv.l[i] * bv.l[i]; } return dbfs(Math.sqrt(e / Math.max(1, vb - a))) - dbfs(Math.sqrt(sg / Math.max(1, vb - a))); };
  void restDb;
  const vorher = effektiv(l.map((x, i) => x - (i >= lag ? ref0.l[i - lag] : 0)), r0 + lag, von + lag);
  const nachher = (() => { let e = 0; for (let i = bis; i < n; i++) { const d = l[i + lag] - ref6.l[i]; e += d * d; } return Math.sqrt(e / Math.max(1, n - bis)); })();
  const eingang = maxStufe(ref0.l, von - 300, bis + 300);
  const ausgang = maxStufe(Float32Array.from({ length: n }, (_, i) => l[i + lag]), von - 300, bis + 300);
  const g = ref6.l.length ? 10 ** (-6 / 20) : 1;
  const hart = Float32Array.from({ length: n }, (_, i) => (i < von ? ref0.l[i] : ref0.l[i] * g));
  const stufeHart = maxStufe(hart, von - 300, bis + 300);
  notiere('R5-live', bis - von >= 16 && bis - von <= 2048 && dbfs(vorher) < -90 && dbfs(nachher) < -90 && ausgang < eingang + 0.1 * (stufeHart - eingang),
    `AK-R5 gain live: the recording leaves the render of 0 dB at frame ${von} and settles on the render of -6 dB at ${bis} (a ramp of ${bis - von} samples; 16 to 2048 required), `
    + `residual before ${fmt(dbfs(vorher))} dBFS, after ${fmt(dbfs(nachher))} dBFS (below -90 required); largest sample step around the change ${fmt(ausgang, 6)} against the input's ${fmt(eingang, 6)} plus a tenth of the hard step's excess (${fmt(eingang + 0.1 * (stufeHart - eingang), 6)}; below required)`);
  notiere('R5-live-c', stufeHart > eingang,
    `negative control: a hard gain step in the same place gives a largest step of ${fmt(stufeHart)}, above the input's ${fmt(eingang)}`);
}
async function r5() { await r5Offline(); await r5Live(); }

// ---- E1 (T3): live MIDI on an armed rack track, through the 1.8 proof client (one note 59)
const PW = { PIPEWIRE_PROPS: `{ node.group = cypherdj-${instanz} node.lock-quantum = true }` };
function startKlient(args) {
  const p = spawn('pw-jack', [path.join(BAU, 'cypherdj-pruef-ein'), ...args], { env: { ...process.env, ...PW }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  let bereit, ende;
  const bereitP = new Promise((r) => { bereit = r; }), endeP = new Promise((r) => { ende = r; });
  p.stdout.on('data', (d) => { out += d; if (/ready:/.test(out)) bereit(true); });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => { err += e.message; bereit(false); ende({ rc: -1, out, err }); });
  p.on('close', (rc) => { bereit(false); ende({ rc, out, err }); });
  return { bereit: bereitP, ende: endeP, los: () => p.stdin.write('go\n'), kill: () => { try { p.kill('SIGTERM'); } catch { /* gone */ } } };
}
const geraeteLage = async () => erwarte200('/geraete', await ruf('GET', '/geraete')).j;
async function e1Geladen() {
  const ok = await bisWahr(async () => { const a = await aktuell(); return a.kern?.status === 0 && (!(a.projekt.wiedergabe_rev > 0) || a.kern?.rev_geladen === a.projekt.wiedergabe_rev); }, 40000);
  if (!ok) throw new Fehl('E1: the playback was not loaded after 40 s');
  await warte(2500);   // the core has the arm a few cycles after the server sent it
}
// the client sends one note 59 (held 12000 frames) while the master is recorded; `mitAufnahme` runs the recording of the project around it
async function e1Note(kz, mitAufnahme) {
  const dir = path.join(ORDNER, kz);
  fs.mkdirSync(dir, { recursive: true });
  const k = startKlient(['1', '--offsets', '100', '--pitches', '59', '--period', '1', '--wait-go', '--linger', '0.5', '--off-after', '12000']);
  const r = {};
  try {
    if (!(await k.bereit)) throw new Fehl(`the proof client did not start: ${JSON.stringify(await k.ende)}`);
    if (!(await bisWahr(async () => (await geraeteLage()).midi?.verbunden === true, 8000))) throw new Fehl('midi_ein_1 is not connected (fixture and --ohne-pruefmodus start of the instance missing?)');
    await warte(500);
    const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', '5', '--aus', path.join(dir, 'live.f32')]);
    await warte(600);
    if (mitAufnahme) {
      const st = await ruf('POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
      if (st.code !== 200) throw new Fehl(`/proj/aufnahme start -> ${grundVon(st)}`);
      r.start = st.j;
    }
    k.los();
    r.klient = await Promise.race([k.ende, warte(15000).then(() => null)]);
    if (!r.klient) throw new Fehl('the proof client did not finish');
    if (mitAufnahme) {
      await warte(1200);
      const sp = await ruf('POST', '/proj/aufnahme', { aktion: 'stopp' });
      if (sp.code !== 200) throw new Fehl(`/proj/aufnahme stopp -> ${grundVon(sp)}`);
      r.stopp = sp.j;
    }
    const m = await mit;
    if (m.rc !== 0) throw new Fehl(`cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}`);
    const f = f32Datei(path.join(dir, 'live.f32'));
    let spitzeMaster = 0, onsets = 0, letzte = -1e9;
    for (let i = 0; i < f.length; i += 2) {
      const v = Math.max(Math.abs(f[i]), Math.abs(f[i + 1]));
      spitzeMaster = Math.max(spitzeMaster, v);
      if (v > 0.001) { if (i / 2 - letzte > 12000) onsets++; letzte = i / 2; }   // an onset = sound after at least 250 ms of quiet
    }
    r.spitze = spitzeMaster; r.onsets = onsets;
  } finally { k.kill(); }
  return r;
}
async function e1() {
  const gA = kitGlied('g1', { ton: [0, 59] });
  const gB = (ton) => kitGlied('g2', { ton, gain_db: -6 });
  await neuesProjekt('e1');
  await aendern('E1 tempo and rack track', [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'instrument', geraet: rackGeraet([gA]) }]);
  const sid = (await aktuell()).projekt.spuren[0].id;
  await aendern('E1 arm', [{ befehl: 'spur_aendern', spur_id: sid, eingang: { art: 'midi' }, arm: true }]);
  const a0 = (await aktuell()).projekt.spuren[0];
  notiere('E1a', a0.geraet.art === 'rack' && a0.aufnahme?.scharf === true && a0.aufnahme?.eingang?.art === 'midi', `rack track ${sid} armed on midi_ein_1: ${JSON.stringify(a0.aufnahme)}`);
  await e1Geladen();
  const ref = await e1Note('e1-a-allein', false);
  info(`E1 member A alone: peak ${fmt(dbfs(ref.spitze))} dBFS, ${ref.onsets} onset(s)`);
  notiere('E1-ref', ref.spitze > 10 ** (-60 / 20) && ref.onsets === 1, `the note 59 from midi_ein_1 sounds on the armed rack track (A alone): master peak ${fmt(dbfs(ref.spitze))} dBFS (above -60 required), ${ref.onsets} onset`);
  await aendern('E1 add B at 60..127', [{ befehl: 'rack_glied_setzen', spur_id: sid, glied: { geraet: gB([60, 127]).geraet, ton: [60, 127], gain_db: -6 } }]);   // no id: B takes the lowest free one (g2)
  await e1Geladen();
  const voll = await e1Note('e1-a-und-b', false);
  const quot = voll.spitze / ref.spitze;
  notiere('E1', ref.spitze > 0 && Math.abs(quot - 1) < 0.001 && voll.onsets === 1,
    `note 59 with members A (ton 0..59) and B (ton 60..127, -6 dB): master peak ${fmt(dbfs(voll.spitze))} dBFS = ${quot.toFixed(5)} times the peak of A alone (B silent: 1.000 +- 0.001 required), ${voll.onsets} onset`);
  await aendern('E1 control: B over the whole range', [{ befehl: 'rack_glied_setzen', spur_id: sid, glied: { ...gB([0, 127]), id: 'g2' } }]);
  await e1Geladen();
  const beide = await e1Note('e1-kontrolle', false);
  const qb = beide.spitze / ref.spitze;
  notiere('E1-c', qb > 1.4 && qb < 1.6, `negative control: with B over the whole range the same note peaks at ${qb.toFixed(4)} times (1.5 expected: A 1 + B 0.5), so the peak tells B's share`);
  // the take: the recording run with the full rack
  await aendern('E1 B back to 60..127', [{ befehl: 'rack_glied_setzen', spur_id: sid, glied: { ...gB([60, 127]), id: 'g2' } }]);
  await e1Geladen();
  const take = await e1Note('e1-take', true);
  const e = (take.stopp?.takes ?? []).filter((t) => t.art === 'midi')[0];
  if (!e || e.fehler) { notiere('E1-take', false, `no MIDI take placed: ${JSON.stringify(e ?? take.stopp)}`); return; }
  const ereignisse = leseMidiDatei(fs.readFileSync(e.datei));
  const sp = (await aktuell()).projekt.spuren[0];
  const noten = sp.clips.filter((c) => c.art === 'midi').flatMap((c) => c.noten ?? []);
  fs.copyFileSync(e.datei, path.join(ORDNER, 'e1-take.bin'));
  notiere('E1-take', ereignisse.length === 2 && ereignisse[0].d1 === 59 && noten.length === 1 && noten[0].ton === 59 && e.noten === 1,
    `with record on the take holds the note: file ${ereignisse.length} records (on ${ereignisse[0]?.d1}, off ${ereignisse[1]?.d1}), placed ${noten.length} note(s) of pitch ${noten.map((n) => n.ton).join(',')}, answer noten ${e.noten}; `
    + `the master peak in the same run ${fmt(dbfs(take.spitze))} dBFS (${fmt(take.spitze / ref.spitze, 5)} times A alone)`);
}

// ---- R6 (T4): a Surge member in a rack, frozen; needs the host arr1
const ARBEIT = path.join(os.homedir(), '.cache', `cypherdj-${instanz}`, 'arr');
const sc = (...a) => spawnSync('systemctl', ['--user', ...a], { encoding: 'utf8' });
const wirtUnit = `cypherdj-wirt-arr1-${instanz}`;
const wirtAktiv = () => sc('is-active', `${wirtUnit}.service`).stdout.trim() === 'active';
const freezeRuf = async (spurId, an = true) => ruf('POST', '/proj/freeze', { spur_id: spurId, an }, CYPHER);
const einsatz = (w, schwelle = 1e-4) => { for (let i = 0; i < w.frames; i++) if (Math.abs(w.l[i]) > schwelle || Math.abs(w.r[i]) > schwelle) return i; return -1; };
async function r6Projekt(name, glieder) {
  await neuesProjekt(name);
  await aendern(`${name} tempo and rack track`, [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'instrument', geraet: rackGeraet(glieder) }]);
  const sid = (await aktuell()).projekt.spuren[0].id;
  await aendern(`${name} note`, [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 0, laenge_beats: 4, name, noten: [{ beat: 0, laenge: 1, ton: 48, vel: 100 }] },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 4 }]);
  return sid;
}
async function r6() {
  const l = await ruf('GET', '/proj/aktuell?noten=zahl');
  const w = l.j?.wirte;
  notiere('R6s', wirtAktiv() && w?.['1']?.laeuft === true, `${wirtUnit}.service is ${sc('is-active', `${wirtUnit}.service`).stdout.trim()}; proj_lage wirte ${JSON.stringify(w)}`);
  if (!(wirtAktiv() && w?.['1']?.laeuft === true)) throw new Fehl('R6 needs the production host arr1 (djk-start --arr1)');
  const kl = await prog('python3', [path.join(REPO, 'djk', 'hosts', 'carla', 'djk-klang'), '--instanz', instanz, 'arr1', 'lade', 'Templates/Init Sine']);
  if (kl.rc !== 0) throw new Fehl(`djk-klang arr1 lade -> rc ${kl.rc} ${kl.err.trim() || kl.out.trim()}`);
  const surgeGlied = (id) => ({ id, geraet: { art: 'wirt', name: 'surge', slot: 1 } });
  // reference: the RB-338 member alone, offline
  await r6Projekt('r6rb', [rbGlied('g1')]);
  await warteTempo(BPM); await warteGeladen();
  const e = await exportiere(0, 4, 'produktion');
  const refPfad = path.join(ORDNER, 'r6-rb338-alleine.wav'); fs.copyFileSync(e.datei, refPfad);
  const ref = leseWav(refPfad);
  const einRef = einsatz(ref);
  notiere('R6a', einRef >= 0, `RB-338 member alone (offline render, ${ref.frames} frames): onset at sample ${einRef}, peak ${fmt(spitze(ref, 0, ref.frames))}`);
  // the rack under test: both members, then (same project) the Surge member alone, then the Surge as a plain track
  const sid = await r6Projekt('r6', [rbGlied('g1'), surgeGlied('g2')]);
  const s0 = (await aktuell()).projekt.spuren[0];
  notiere('R6b', s0.freeze === null && s0.geraet.glieder[1].geraet.slot === 1, `rack track ${sid}: freeze field ${JSON.stringify(s0.freeze)}, Surge member slot ${s0.geraet.glieder[1].geraet.slot}`);
  const friere = async (kz, text) => {
    await warteTempo(BPM); await warteGeladen();
    const fr = await freezeRuf(sid);
    notiere(kz, fr.code === 200, `proj_freeze (${text}) -> ${grundVon(fr)}`);
    if (fr.code !== 200) throw new Fehl(`${text}: freeze refused`);
    const f = (await aktuell()).projekt.spuren[0].freeze;
    const datei = path.join(ARBEIT, f.datei);
    if (!fs.existsSync(datei)) throw new Fehl(`frozen file ${datei} missing`);
    fs.copyFileSync(datei, path.join(ORDNER, `r6-${kz}-${f.datei}`));
    erwarte200('unfreeze', await freezeRuf(sid, false));
    return leseF32Stereo(datei);
  };
  const beide = await friere('R6c', 'rack with RB-338 and Surge member');
  await aendern('r6 only Surge', [{ befehl: 'rack_glied_entfernen', spur_id: sid, glied_id: 'g1' }]);
  const nurSurge = await friere('R6d', 'rack with the Surge member alone');
  // the RB-338 part of the frozen rack = both minus the Surge part; it is the RB-338 member alone, so its onset is the one of the offline render
  const n = Math.min(beide.frames, nurSurge.frames, ref.frames);
  const rest = { l: new Float32Array(n), r: new Float32Array(n), frames: n };
  for (let i = 0; i < n; i++) { rest.l[i] = beide.l[i] - nurSurge.l[i]; rest.r[i] = beide.r[i] - nurSurge.r[i]; }
  const einRest = einsatz(rest);
  const diff = einRest - einRef;
  notiere('R6e', einRest >= 0 && Math.abs(diff) <= 1,
    `AK-R6: onset of the RB-338 part of the frozen rack (frozen rack minus the Surge-only freeze, ${n} frames) at sample ${einRest}, of the RB-338 render alone at ${einRef}: difference ${diff} sample(s) (limit 1)`);
  let dMax = 0; const bis = Math.min(n, 8192 + einRef);
  for (let i = 0; i < bis; i++) dMax = Math.max(dMax, Math.abs(rest.l[i] - ref.l[i]), Math.abs(rest.r[i] - ref.r[i]));
  info(`R6 info: largest sample difference between the RB-338 part and its offline render in the first ${bis} frames: ${dMax.toExponential(3)} (render peak ${fmt(spitze(ref, 0, ref.frames))})`);
  const einBeide = einsatz(beide), einSurge = einsatz(nurSurge);
  notiere('R6f', einSurge >= 0 && Math.abs(einBeide - einSurge) <= 1 && spitze(nurSurge, 0, nurSurge.frames) > 0.01,
    `the Surge member sounds in the frozen rack: Surge-only freeze onset at sample ${einSurge}, peak ${fmt(spitze(nurSurge, 0, nurSurge.frames))}; the rack with both starts at ${einBeide}`);
  // the Surge as a member equals the Surge as a track (same note, same host patch): convert the track to a plain Surge track and freeze again
  await aendern('r6 Surge track', [{ befehl: 'spur_aendern', spur_id: sid, geraet: { art: 'wirt', name: 'surge', slot: 1 } }]);
  const alsSpur = await friere('R6g', 'the same Surge as a plain track');
  const m = Math.min(alsSpur.frames, nurSurge.frames);
  let dS = 0; for (let i = 0; i < m; i++) dS = Math.max(dS, Math.abs(alsSpur.l[i] - nurSurge.l[i]), Math.abs(alsSpur.r[i] - nurSurge.r[i]));
  info(`R6 info: Surge as member vs as track: onset ${einSurge} vs ${einsatz(alsSpur)}, ${nurSurge.frames} vs ${alsSpur.frames} frames, largest sample difference ${dS.toExponential(3)}`);
  // back to the rack for the error case
  await aendern('r6 rack again', [{ befehl: 'spur_aendern', spur_id: sid, geraet: rackGeraet([rbGlied('g1'), surgeGlied('g2')]) }]);
  await warteGeladen();
  const stop = sc('stop', `${wirtUnit}.service`);
  await bisWahr(() => !wirtAktiv(), 15000);
  const revVor = await holeRev();
  const f3 = await freezeRuf(sid);
  const t = (await aktuell()).projekt.spuren[0];
  notiere('R6h', !wirtAktiv() && f3.code === 409 && f3.j?.fehler === 'wirt_fehlt' && /djk-instrumente --arr1/.test(f3.j?.text ?? '') && t.freeze === null && (await holeRev()) === revVor,
    `error case: ${wirtUnit} stopped (rc ${stop.status}, active ${wirtAktiv()}); freeze of the rack -> ${grundVon(f3)}; freeze field ${JSON.stringify(t.freeze)}`);
  // host back: the freeze goes through (negative control of the refusal)
  const neu = await prog(path.join(REPO, 'djk', 'start', 'djk-instrumente'), ['--instanz', instanz, '--arr1']);
  const da = await bisWahr(() => wirtAktiv(), 30000);
  info(`djk-instrumente --arr1 rc ${neu.rc}, unit active ${da}`);
  await bisWahr(async () => (await ruf('GET', '/proj/aktuell?noten=zahl')).j?.wirte?.['1']?.laeuft === true, 30000);
  const f4 = await freezeRuf(sid);
  notiere('R6i', f4.code === 200, `negative control: host started again -> freeze of the same project -> ${grundVon(f4)}`);
}

// ---- M1 to M3 (T11, spec E12, E13): macros on rack members and variations
const rbMit = (id, parameter = {}) => ({ id, geraet: { art: 'intern', name: 'rb338', parameter } });
const ziel = (glied, param, von, bis) => ({ glied, param, von, bis });
const rackSetzen = (sid, makros) => ({ befehl: 'rack_setzen', strang_id: sid, makros });
const rackStrang = async (sid) => (await aktuell()).projekt.spuren.find((x) => x.id === sid);
const werteVon = async (sid) => (await rackStrang(sid)).rack?.werte;
const refusal = async (label, befehle) => { const rev = await holeRev(); return { r: await ruf('POST', '/proj/aendern', { rev, label, befehle }, CYPHER), rev }; };
const grundIst = (r, grund) => r.code !== 200 && [r.j?.fehler, r.j?.grund, r.j?.text].some((x) => typeof x === 'string' && x.includes(grund));
// a held note, a filter without envelope movement: the spectrum of a mapped cutoff is steady
const HALTE = [{ beat: 0, laenge: 14, ton: 57, vel: 100 }];
const STILL = { env_mod: 0, resonanz: 0.3 };
async function exportKurz(name) {
  await warteTempo(BPM);
  await warteGeladen();
  const e = await exportiere(0, 4, 'produktion');
  const kopie = path.join(ORDNER, `${name}.wav`);
  fs.copyFileSync(e.datei, kopie);
  return leseWav(kopie);
}
// spectral centroid (Hz) of one 256-frame window: the magnitude-weighted mean of the bins of the Hann-windowed FFT
const schwerpunkt = (x, von) => {
  const m = spektrum(x.subarray(von, von + 256));
  let a = 0, b = 0;
  for (let k = 1; k < m.length; k++) { a += k * m[k]; b += m[k]; }
  return b > 0 ? (a / b) * (48000 / 256) : 0;
};
const mittel = (z) => z.reduce((a, b) => a + b, 0) / Math.max(1, z.length);
async function m1() {
  // offline: macro 0 = von, macro 1 = bis, the member's own value (0.5) is ignored while mapped
  const abgebildet = async (name, wert, eigen = 0.5) => {
    const sid = await baueRackProjekt(name, [rbMit('g1', { ...STILL, cutoff: eigen })], HALTE, 0);
    await aendern(`${name} macro`, [rackSetzen(sid, [{ ziel: [ziel('g1', 'cutoff', 0.2, 0.8)] }, { ziel: [] }, { ziel: [] }, { ziel: [] }])]);
    if (wert !== 0) await aendern(`${name} macro value`, [{ befehl: 'rack_makro', strang_id: sid, nr: 1, wert }]);
    return exportKurz(name);
  };
  const einfach = async (name, cutoff) => { await baueRackProjekt(name, [rbMit('g1', { ...STILL, cutoff })], HALTE, 0); return exportKurz(name); };
  const m0 = await abgebildet('m1-makro0', 0), m1w = await abgebildet('m1-makro1', 1);
  const von = await einfach('m1-von', 0.2), bis = await einfach('m1-bis', 0.8), mitte = await einfach('m1-eigen', 0.5);
  const m0gleich = await abgebildet('m1-makro0-eigen-gleich', 0, 0.2);
  // a mapped member starts on its mapped value at the transport start (no glide): the comparison runs from frame 0
  const d = (a, b, ab = 0) => unterschiede(a, b, ab, Math.min(a.frames, b.frames));
  const sp = spitze(m0, 0, HALB);   // signal present: the held note at cutoff 0.2 is quiet (-47.7 dBFS), only silence would pass the equality by itself
  notiere('M1-o', sp > 1e-3 && d(m0, von) === 0 && d(m1w, bis) === 0,
    `AK-M1 offline: macro 0 equals the plain member at cutoff 0.2 from frame 0 (${d(m0, von)} samples differ), macro 1 the plain member at 0.8 (${d(m1w, bis)} differ); `
    + `the member's own 0.5 is not what sounds; peak ${fmt(dbfs(sp))} dBFS`);
  notiere('M1-o-g', d(m0gleich, von) === 0,
    `with the own value equal to von (0.2) the macro 0 render equals the plain member over all ${m0gleich.frames} frames (${d(m0gleich, von)} samples differ)`);
  notiere('M1-o-c', d(m0, mitte) > 0 && d(m1w, mitte) > 0 && d(von, bis) > 0,
    `negative control: both macro renders differ from the unmapped member at 0.5 (${d(m0, mitte)}, ${d(m1w, mitte)} samples) and the two ends differ from each other (${d(von, bis)})`);
  // live: the macro moves 0 -> 1 while the transport plays; the control moves an unmapped macro
  const lauf = async (name, nr) => {
    const sid = await baueRackProjekt(name, [rbMit('g1', { ...STILL, cutoff: 0.5 })], HALTE, 0);
    await aendern(`${name} macro`, [rackSetzen(sid, [{ ziel: [ziel('g1', 'cutoff', 0.2, 0.8)] }, { ziel: [] }, { ziel: [] }, { ziel: [] }])]);
    const l = await liveMitBefehl(name, [{ befehl: 'rack_makro', strang_id: sid, nr, wert: 1 }], 3000, 9);
    const o = erster(l, 1e-4);
    if (o < 0) throw new Fehl(`${name}: no onset in the recording`);
    const e = o + Math.round(l.sendeMs * 48);   // where the move should be (the send's wall clock after the transport start; the jitter is some tens of ms)
    const reihe = [];
    for (let i = o + 4800; i + 256 <= l.length && i < o + 7 * 48000; i += 256) reihe.push({ i, c: schwerpunkt(l, i) });
    return { l, o, e, reihe };
  };
  const live = await lauf('m1-live', 1), kontrolle = await lauf('m1-live-kontrolle', 2);
  const vor = (z, e, bis = 14400) => mittel(z.reihe.filter((w) => w.i < e - bis).map((w) => w.c));
  const bevor = vor(live, live.e), danach = mittel(live.reihe.filter((w) => w.i > live.e + 2 * 48000).map((w) => w.c));
  const schwelle = bevor * 1.25;
  let hoch = live.reihe.findIndex((w, k) => w.i >= live.e - 48000 * 0.3 && live.reihe.slice(k, k + 4).every((x) => x.c > schwelle));
  const lat = hoch < 0 ? null : ((live.reihe[hoch].i - live.e) / 48);
  const kB = vor(kontrolle, kontrolle.e), kD = mittel(kontrolle.reihe.filter((w) => w.i > kontrolle.e + 2 * 48000).map((w) => w.c));
  info(`M1 live: centroid before ${fmt(bevor, 0)} Hz, after ${fmt(danach, 0)} Hz; first 256-frame window of the rise at ${hoch < 0 ? '-' : `${fmt(live.reihe[hoch].c, 0)} Hz, ${fmt(lat, 0)} ms after the send's expected place (the send was ${fmt(live.l.sendeMs, 0)} ms after the transport start)`}; control before ${fmt(kB, 0)} Hz, after ${fmt(kD, 0)} Hz`);
  notiere('M1-live', bevor > 100 && danach >= 1.5 * bevor && hoch >= 0 && lat > -200 && lat < 500,
    `AK-M1 live: a macro move 0 -> 1 on the RB-338 member cutoff raises the centroid of the master recording from ${fmt(bevor, 0)} to ${fmt(danach, 0)} Hz (factor ${fmt(danach / bevor, 2)}, 1.5 required); `
    + `the rise starts ${lat === null ? 'nowhere' : `${fmt(lat, 0)} ms`} from where the move was sent (-200 to 500 ms required: some tens of ms of timing jitter plus the smoothing)`);
  notiere('M1-live-c', kB > 100 && Math.abs(kD / kB - 1) < 0.15,
    `negative control: the same move on an unmapped macro leaves the centroid (${fmt(kB, 0)} to ${fmt(kD, 0)} Hz, factor ${fmt(kD / kB, 3)}; within 15 % required)`);
  // the 17th mapping
  const sid = await baueRackProjekt('m1-17', [rbMit('g1'), rbMit('g2'), rbMit('g3'), rbMit('g4')], HALTE, 0);
  const alle = ['g1', 'g2', 'g3', 'g4'].flatMap((g) => ['lautstaerke', 'cutoff', 'resonanz', 'env_mod', 'gain_db'].map((p) => ziel(g, p, p === 'gain_db' ? -12 : 0.1, p === 'gain_db' ? 0 : 0.9)));
  const tab = (n) => [0, 1, 2, 3].map((m) => ({ ziel: alle.slice(0, n).filter((_, k) => k % 4 === m) }));
  const sechzehn = await refusal('16 mappings', [rackSetzen(sid, tab(16))]);
  const n16 = (await rackStrang(sid)).rack?.makros.reduce((a, m) => a + m.ziel.length, 0);
  const siebzehn = await refusal('17 mappings', [rackSetzen(sid, tab(17))]);
  const nach = (await rackStrang(sid)).rack?.makros.reduce((a, m) => a + m.ziel.length, 0);
  notiere('M1-17', sechzehn.r.code === 200 && n16 === 16 && grundIst(siebzehn.r, 'makro_voll') && nach === 16 && (await holeRev()) === siebzehn.rev,
    `AK-M1 the 17th mapping: 16 member targets accepted (${grundVon(sechzehn.r)}, ${n16} in the project); 17 refused ${grundVon(siebzehn.r)}, still ${nach} mappings, project revision unchanged`);
}
async function m2() {
  const sid = await baueRackProjekt('m2', [rbMit('g1'), { id: 'g2', geraet: { art: 'wirt', name: 'surge' } }], HALTE, 0);
  const rev = await holeRev();
  const a = await refusal('surge gain', [rackSetzen(sid, [{ ziel: [ziel('g2', 'gain_db', -12, 0)] }, { ziel: [] }, { ziel: [] }, { ziel: [] }])]);
  const b = await refusal('surge cutoff', [rackSetzen(sid, [{ ziel: [ziel('g2', 'cutoff', 0, 1)] }, { ziel: [] }, { ziel: [] }, { ziel: [] }])]);
  const keins = (await rackStrang(sid)).rack === undefined;
  const ok = await refusal('rb gain', [rackSetzen(sid, [{ ziel: [ziel('g1', 'gain_db', -12, 0)] }, { ziel: [] }, { ziel: [] }, { ziel: [] }])]);
  notiere('M2', grundIst(a.r, 'makro_ziel_wirt') && grundIst(b.r, 'makro_ziel_wirt') && keins && a.rev === rev && b.rev === rev,
    `AK-M2 a Surge member parameter as macro target: gain_db -> ${grundVon(a.r)}, cutoff -> ${grundVon(b.r)}; no rack was created, project revision unchanged`);
  notiere('M2-c', ok.r.code === 200 && (await rackStrang(sid)).rack?.makros[0].ziel[0]?.glied === 'g1',
    `negative control: the same table on the RB-338 member g1 is accepted (${grundVon(ok.r)})`);
}
async function m3() {
  const sid = await baueRackProjekt('m3', [rbMit('g1', STILL)], HALTE, 0);
  await aendern('M3 mapping', [rackSetzen(sid, [{ ziel: [ziel('g1', 'cutoff', 0.2, 0.8)] }, { ziel: [ziel('g1', 'gain_db', -24, 0)] }, { ziel: [] }, { ziel: [] }])]);
  const setze = (w) => w.map((wert, k) => ({ befehl: 'rack_makro', strang_id: sid, nr: k + 1, wert }));
  const A = [0.1, 0.2, 0.3, 0.4], B = [0.9, 0.8, 0.7, 0.6];
  await aendern('M3 values A', setze(A));
  const sp = await aendern('M3 save', [{ befehl: 'makro_variation_speichern', strang_id: sid, name: 'warm' }]);
  await aendern('M3 values B', setze(B));
  const bewegt = await werteVon(sid);
  const wiedergabeRev = (await aktuell()).projekt.wiedergabe_rev;
  const ld = await aendern('M3 load', [{ befehl: 'makro_variation_laden', strang_id: sid, name: 'warm' }]);
  const geladen = await werteVon(sid), ohneNeu = (await aktuell()).projekt.wiedergabe_rev === wiedergabeRev;
  void sp; void ld;
  notiere('M3', JSON.stringify(bewegt) === JSON.stringify(B) && JSON.stringify(geladen) === JSON.stringify(A) && ohneNeu,
    `AK-M3 save, move, load: moved ${JSON.stringify(bewegt)}, after the load ${JSON.stringify(geladen)} (exactly ${JSON.stringify(A)} required); save, move and load are no new playback (wiedergabe_rev stays ${wiedergabeRev}: ${ohneNeu})`);
  erwarte200('/proj/undo', await ruf('POST', '/proj/undo', { rev: await holeRev() }, CYPHER));
  const zurueck = await werteVon(sid);
  notiere('M3-undo', JSON.stringify(zurueck) === JSON.stringify(B), `the undo of the load restores the moved values: ${JSON.stringify(zurueck)} (${JSON.stringify(B)} required)`);
  // 8 variations fit (warm + 7), the ninth is refused, replacing a name is not a ninth
  const namen = Array.from({ length: 7 }, (_, k) => `v${k + 2}`);
  await aendern('M3 seven more', namen.map((name) => ({ befehl: 'makro_variation_speichern', strang_id: sid, name })));
  const n8 = (await rackStrang(sid)).rack.variationen.length;
  const neunte = await refusal('ninth variation', [{ befehl: 'makro_variation_speichern', strang_id: sid, name: 'v9' }]);
  const n8b = (await rackStrang(sid)).rack.variationen.length, revNeunte = await holeRev();
  const ersetzt = await refusal('replace a name', [{ befehl: 'makro_variation_speichern', strang_id: sid, name: 'v2' }]);
  const n8c = (await rackStrang(sid)).rack.variationen.length;
  notiere('M3-voll', n8 === 8 && grundIst(neunte.r, 'variation_voll') && n8b === 8 && neunte.rev === revNeunte && ersetzt.r.code === 200 && n8c === 8,
    `AK-M3 the ninth variation: 8 stored (${n8}), the ninth refused ${grundVon(neunte.r)} (still ${n8b}, project revision unchanged); replacing the name v2 is accepted (${grundVon(ersetzt.r)}, still ${n8c})`);
  const unbekannt = await refusal('unknown', [{ befehl: 'makro_variation_laden', strang_id: sid, name: 'nope' }]);
  notiere('M3-unbekannt', grundIst(unbekannt.r, 'variation_unbekannt'), `error case: loading a name that does not exist -> ${grundVon(unbekannt.r)}`);
}

async function abschnitt(name, f) {
  if (NUR && !NUR.has(name)) return;
  try { await f(); } catch (e) { notiere(name, false, e instanceof Fehl ? e.message : `ABORT: ${e.stack ?? String(e)}`); }
}

info(`instance ${instanz}, ${opt.url}, build ${BAU}, kit folder ${KITS}, output ${ORDNER}`);
await abschnitt('S', aufbau);
if (fehl > 0 && (!NUR || NUR.has('S'))) {
  process.stdout.write('\nset-up statements failed: not measuring (the instance could read the wrong kit folder)\n');
} else {
  await abschnitt('R1', r1);
  await abschnitt('R2', r2);
  await abschnitt('R3', r3);
  await abschnitt('RE', re);
  await abschnitt('R4', r4);
  await abschnitt('R5', r5);
  if (NUR?.has('M1') || NUR?.has('M2') || NUR?.has('M3')) { await abschnitt('M1', m1); await abschnitt('M2', m2); await abschnitt('M3', m3); }
  if (NUR?.has('R6')) await abschnitt('R6', r6);   // only on request: it needs the production host arr1
  if (NUR?.has('E1')) await abschnitt('E1', e1);   // only on request: it needs the 1.8 fixture and the proof client
}
// clean up: only own projects
for (const slug of eigeneSlugs) {
  const d = path.join(wurzel, slug);
  if (!/^i19r-/.test(slug)) { info(`slug ${slug} is not from this script, not removed`); continue; }
  try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); info(`removed ${d}`); } } catch (e) { notiere('cleanup', false, e.message); }
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# abnahme_i19_rack ${zeit} (${opt.url}, instance ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALL OK' : `${fehl} FEHL`} - report ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
