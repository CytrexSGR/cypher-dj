// B11 probe: a recording survives a kill -9 of the page server. Real core, real kill, ffmpeg cross-check of the frame count. It is a measurement, not part of the unit suite.
//   node check/rettung_kill9.mjs [--instanz d] [--ausgabe <folder>]
// The script brings up the TEST INSTANCE itself (djk/start/djk-start --instanz <i> with DJK = the djk folder this script lives in, so the page server under test is this tree's),
// and always takes it down again (djk-stop --instanz <i>), even after a FAIL. Letters a to f only; the live studio (no letter) and g, h, i are refused. No unit is ever named,
// no process is ever found by pattern: the page server is the process that listens on the port of the instance (ss -ltnp), the core is stopped through its own command port.
// Stages (each printed):
//   1 start the instance, a throwaway project with one armed audio track (input erz/1), REC, 3 s of recording
//   2 kill -9 the page server of the instance
//   3 the core keeps recording (the f32 grows), the recording is stopped at the core (/k/rec/stopp), the sidecar becomes fertig
//   4 djk-stop and djk-start of the instance, open the same project
//   5 checks: run file existed after the kill and is gone after the open; the recovered WAV exists; WAV frames = f32 size / 8; ffmpeg agrees (+-1 frame); the record is listed;
//     POST /proj/gerettet_platzieren answers a clip_id; proj/aktuell shows the clip on the track at the recorded start beat
//   6 second scenario: a leftover .wav.tmp and a WAV without its record (run file back), open again: exactly one correct entry
// Return: 0 all PASS, 1 at least one FAIL, 2 usage, 3 the live studio is not quiet, 4 SKIP input (the core recorded nothing: no usable input).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { KernAnbindung } from '../../conductor/src/core.ts';

const { values: opt } = parseArgs({ options: { instanz: { type: 'string' }, ausgabe: { type: 'string' }, help: { type: 'boolean' } } });
if (opt.help) { process.stderr.write('rettung_kill9: usage: [--instanz a..f] [--ausgabe <folder>]\n'); process.exit(2); }
const INSTANZ = opt.instanz ?? 'a';
if (!/^[a-f]$/.test(INSTANZ)) { process.stderr.write(`rettung_kill9: instance '${INSTANZ}' is not allowed: one letter a to f (never the live studio, never g, h, i)\n`); process.exit(2); }
const K = 1000 * (INSTANZ.charCodeAt(0) - 96);
const PORT = 47300 + K, KERN_PORT = 47100 + K, ABO_PORT = 47190 + K + 7;
const URL = `http://127.0.0.1:${PORT}`;
const DJK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORDNER = path.resolve((opt.ausgabe ?? '~/messungen/2026-11-23-browser-4').replace(/^~(?=\/|$)/, os.homedir()));
fs.mkdirSync(ORDNER, { recursive: true });
const WURZEL = path.join('/dev/shm', `cypherdj-${INSTANZ}`, 'projekte');
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const sag = (t) => { zeilen.push(t); process.stdout.write(`${t}\n`); };
const pruefe = (name, ok, detail) => { if (!ok) fehl++; sag(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); };
class Skip extends Error {}

const prog = (programm, args, env = {}) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, DJK, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const ruf = async (methode, weg, koerper) => {
  const r = await fetch(URL + weg, methode === 'GET' ? { headers: CYPHER } : { method: 'POST', headers: { 'content-type': 'application/json', ...CYPHER }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};
const ok200 = (weg, r) => { if (r.code !== 200) throw new Error(`${weg} -> ${r.code} ${JSON.stringify(r.j).slice(0, 200)}`); return r.j; };
const bis = async (f, ms) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const aendern = async (label, befehle) => ok200(`/proj/aendern (${label})`, await ruf('POST', '/proj/aendern', { rev: ok200('rev', await ruf('GET', '/proj/aktuell?nur=rev')).rev, label, befehle }));

// WAV: frames from the data chunk (any sample format), the way a reader that does not trust the writer would count
function wavFrames(datei) {
  const b = fs.readFileSync(datei);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error(`${datei} is not a WAV`);
  let o = 12, kan = 0, bits = 0, daten = -1;
  while (o + 8 <= b.length) {
    const id = b.toString('latin1', o, o + 4);
    let n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { kan = b.readUInt16LE(o + 10); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') { daten = Math.min(n, b.length - o - 8); break; }
    o += 8 + n + (n % 2);
  }
  if (daten < 0 || !kan || !bits) throw new Error(`${datei}: no fmt or data chunk`);
  return daten / (kan * (bits / 8));
}
// ffmpeg decodes the raw f32 and writes s16le to a pipe; the byte count of the pipe / 4 is the frame count (the progress time of the null muxer is only exact to a 1024 sample block)
const ffmpegFrames = (f32) => new Promise((res, rej) => {
  const p = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', f32, '-f', 's16le', 'pipe:1']);
  let n = 0, err = '';
  p.stdout.on('data', (d) => { n += d.length; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', rej);
  p.on('close', (rc) => (rc === 0 ? res(n / 4) : rej(new Error(`ffmpeg rc ${rc} ${err.trim().slice(0, 200)}`))));
});
async function seitenPid() {
  const r = await prog('ss', ['-ltnpH', `sport = :${PORT}`]);
  const m = /pid=(\d+)/.exec(r.out);
  return m ? Number(m[1]) : null;
}
const djkStart = () => prog(path.join(DJK, 'start', 'djk-start'), ['--instanz', INSTANZ]);
const djkStop = () => prog(path.join(DJK, 'start', 'djk-stop'), ['--instanz', INSTANZ, '--still']);
const laufDatei = (ordner) => fs.readdirSync(path.join(ordner, 'aufnahmen')).filter((n) => /^\.laufend-\d+\.json$/.test(n));
const gerettetDateien = (ordner) => fs.existsSync(path.join(ordner, 'aufnahmen')) ? fs.readdirSync(path.join(ordner, 'aufnahmen')).filter((n) => /^\.gerettet-\d+-\d+\.json$/.test(n)) : [];
const groesse = (f) => { try { return fs.statSync(f).size; } catch { return -1; } };

let slug = null, roh = null, abo = null, hochgefahren = false;
try {
  // the live studio must be quiet (read-only look at its level meter), the probe never touches it
  const peg = await fetch('http://127.0.0.1:47300/pegel?sek=1').then((r) => r.json()).catch(() => null);
  const m = peg?.kanaele?.master?.max_db;
  sag(`INFO live studio master max ${m} dB`);
  if (typeof m === 'number' && m > -60) { sag('SKIP the live studio is not quiet (master above -60 dB), nothing started'); process.exitCode = 3; throw new Skip('live'); }

  sag(`INFO stage 1: start instance ${INSTANZ} (page ${PORT}, core ${KERN_PORT}), DJK=${DJK}`);
  const st = await djkStart();
  hochgefahren = true;
  if (st.rc !== 0) throw new Error(`djk-start rc ${st.rc}: ${(st.err || st.out).trim().slice(-400)}`);
  if (!(await bis(async () => (await ruf('GET', '/proj/aktuell?nur=rev').catch(() => ({ code: 0 }))).code === 200 || (await ruf('GET', '/proj/liste').catch(() => ({ code: 0 }))).code === 200, 30000))) throw new Error('page server does not answer');
  const name = `rettung-kill9-${Date.now().toString(36)}`;
  const neu = ok200('/proj/neu', await ruf('POST', '/proj/neu', { name }));
  slug = neu.slug ?? neu.projekt?.slug;
  if (!slug) throw new Error(`/proj/neu without slug: ${JSON.stringify(neu).slice(0, 200)}`);
  await warte(1500);
  const ordner = path.join(WURZEL, slug);
  await aendern('kill9 tempo', [{ befehl: 'tempo_setzen', bpm: 120 }]);
  await aendern('kill9 track', [{ befehl: 'spur_neu', art: 'audio', name: 'Take' }]);
  const spurId = ok200('aktuell', await ruf('GET', '/proj/aktuell')).projekt.spuren.at(-1).id;
  await aendern('kill9 arm', [{ befehl: 'spur_aendern', spur_id: spurId, eingang: { art: 'intern', name: 'erz/1' }, arm: true }]);
  await warte(2500);   // the core has the arm a few cycles after the page server sent it
  const start = await ruf('POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  if (start.code !== 200) throw new Error(`REC start -> ${start.code} ${JSON.stringify(start.j).slice(0, 300)}`);
  sag(`INFO REC started: ${JSON.stringify(start.j).slice(0, 200)}`);
  await warte(3000);

  const laeufe = laufDatei(ordner);
  const lauf = laeufe.length === 1 ? JSON.parse(fs.readFileSync(path.join(ordner, 'aufnahmen', laeufe[0]), 'utf8')) : null;
  pruefe('run file exists while recording', lauf !== null, `${laeufe.join(',') || 'none'}`);
  if (!lauf) throw new Error('no run file, the rest cannot be measured');
  const f32 = lauf.spuren[0].f32;
  const sidecar = f32.replace(/\.f32$/, '.json');
  const laufKopie = fs.readFileSync(path.join(ordner, 'aufnahmen', laeufe[0]), 'utf8');

  sag('INFO stage 2: kill -9 the page server');
  const pid = await seitenPid();
  if (!pid) throw new Error(`no process listens on port ${PORT}`);
  process.kill(pid, 'SIGKILL');
  await warte(500);
  pruefe('page server is dead', (await ruf('GET', '/proj/aktuell?nur=rev').catch(() => ({ code: 0 }))).code === 0, `pid ${pid} killed`);

  sag('INFO stage 3: the core keeps recording');
  const g1 = groesse(f32); await warte(1000); const g2 = groesse(f32);
  if (g1 <= 0 && g2 <= 0) throw new Skip(`input: the core wrote nothing to ${f32}`);
  pruefe('the f32 grows after the kill', g2 > g1, `${g1} -> ${g2} bytes in 1 s`);
  abo = new KernAnbindung({ kernPort: KERN_PORT, aboPort: ABO_PORT, name: 'rettung-kill9' }, { nachricht: () => {}, gesendet: () => {}, zustand: () => {}, unlesbar: () => {} });
  await abo.starte();
  abo.sende('/k/rec/stopp', { id: 900000 + (Date.now() % 90000), quelle: 'cypher' });
  const fertig = await bis(async () => { try { return JSON.parse(fs.readFileSync(sidecar, 'utf8')).status === 'fertig'; } catch { return false; } }, 8000);
  const status = (() => { try { return JSON.parse(fs.readFileSync(sidecar, 'utf8')).status; } catch { return 'missing'; } })();
  pruefe('sidecar becomes fertig after /k/rec/stopp at the core', fertig, `status ${status}`);
  const bytes = groesse(f32);
  roh = { f32, bytes, frames: bytes / 8 };
  pruefe('the run file stayed after the kill', fs.existsSync(path.join(ordner, 'aufnahmen', laeufe[0])), laeufe[0]);
  await abo.stoppe(); abo = null;

  sag('INFO stage 4: djk-stop, djk-start, open the project');
  await djkStop();
  const st2 = await djkStart();
  if (st2.rc !== 0) throw new Error(`djk-start (second) rc ${st2.rc}: ${(st2.err || st2.out).trim().slice(-400)}`);
  if (!(await bis(async () => (await ruf('GET', '/proj/liste').catch(() => ({ code: 0 }))).code === 200, 30000))) throw new Error('page server does not answer after the restart');
  const op = await ruf('POST', '/proj/oeffnen', { slug });
  if (op.code !== 200) throw new Error(`/proj/oeffnen -> ${op.code} ${JSON.stringify(op.j).slice(0, 300)}`);
  const rec = await bis(async () => gerettetDateien(ordner).length > 0 && laufDatei(ordner).length === 0, 20000);
  pruefe('run file is gone after the open and one record exists', rec, `run files ${laufDatei(ordner).length}, records ${gerettetDateien(ordner).length}`);

  sag('INFO stage 5: checks');
  const rn = gerettetDateien(ordner)[0];
  const r = rn ? JSON.parse(fs.readFileSync(path.join(ordner, 'aufnahmen', rn), 'utf8')) : null;
  const wav = r ? path.join(ordner, 'aufnahmen', r.datei) : null;
  pruefe('recovered WAV exists', !!wav && fs.existsSync(wav), wav ?? 'no record');
  const wf = wav && fs.existsSync(wav) ? wavFrames(wav) : -1;
  pruefe('WAV frames = f32 size / 8', wf === roh.frames, `wav ${wf}, f32 ${roh.frames} (${roh.bytes} bytes)`);
  pruefe('record frames = f32 size / 8', r?.frames === roh.frames, `record ${r?.frames}`);
  const ff = await ffmpegFrames(f32).catch((e) => { sag(`INFO ${e.message}`); return -1; });
  pruefe('independent ffmpeg measurement agrees (+-1 frame)', ff >= 0 && Math.abs(ff - wf) <= 1, `ffmpeg ${ff}, wav ${wf}`);
  pruefe('start beat in the record', r?.start_beat === lauf.start_beat, `${r?.start_beat} vs run file ${lauf.start_beat}`);
  const sha = wav && fs.existsSync(wav) ? crypto.createHash('sha256').update(fs.readFileSync(wav)).digest('hex') : null;
  pruefe('record sha256 is the sha256 of the WAV', !!sha && r?.sha256 === sha, `${(r?.sha256 ?? '').slice(0, 12)} vs ${(sha ?? '').slice(0, 12)}`);

  sag('INFO stage 6: leftover .wav.tmp and a WAV without its record, run file back, open again');
  await ruf('POST', '/proj/schliessen', { bestaetigt: true });
  const nameWav = r.datei;
  fs.rmSync(path.join(ordner, 'aufnahmen', rn), { force: true });   // WAV stays without its record (crash between rename and record)
  fs.writeFileSync(path.join(ordner, 'aufnahmen', `${nameWav}.tmp`), Buffer.alloc(1000, 7));   // a half-written file of an earlier try
  fs.writeFileSync(path.join(ordner, 'aufnahmen', laeufe[0]), laufKopie);
  const op2 = await ruf('POST', '/proj/oeffnen', { slug });
  if (op2.code !== 200) throw new Error(`/proj/oeffnen (second) -> ${op2.code} ${JSON.stringify(op2.j).slice(0, 300)}`);
  await bis(async () => gerettetDateien(ordner).length > 0 && laufDatei(ordner).length === 0, 20000);
  const rn2 = gerettetDateien(ordner);
  const wavs = fs.readdirSync(path.join(ordner, 'aufnahmen')).filter((n) => /-gerettet\.wav/.test(n));
  pruefe('exactly one record, one WAV, no .tmp', rn2.length === 1 && wavs.length === 1 && wavs[0] === nameWav, `records ${rn2.join(',')} files ${wavs.join(',')}`);
  const r2 = rn2[0] ? JSON.parse(fs.readFileSync(path.join(ordner, 'aufnahmen', rn2[0]), 'utf8')) : null;
  pruefe('the entry is still correct (frames, sha256)', r2?.frames === roh.frames && r2?.sha256 === sha && wavFrames(path.join(ordner, 'aufnahmen', nameWav)) === roh.frames, `frames ${r2?.frames}`);

  sag('INFO stage 5b: place');
  const pl = await ruf('POST', '/proj/gerettet_platzieren', { datei: nameWav });
  pruefe('PLACE answers a clip_id', pl.code === 200 && typeof pl.j?.clip_id === 'string', `${pl.code} ${JSON.stringify(pl.j).slice(0, 160)}`);
  const sp = ok200('aktuell', await ruf('GET', '/proj/aktuell')).projekt.spuren.find((s) => s.id === spurId);
  const clip = sp?.clips.find((c) => c.id === pl.j?.clip_id);
  pruefe('proj/aktuell shows the clip on the track at the recorded start beat', !!clip && clip.start_beat === lauf.start_beat, `clip ${clip?.id} start_beat ${clip?.start_beat}, laenge ${clip?.laenge_beats}`);
  pruefe('the record is gone after PLACE', gerettetDateien(ordner).length === 0, `${gerettetDateien(ordner).length} left`);
} catch (e) {
  if (e instanceof Skip) { sag(`SKIP ${e.message}`); process.exitCode ||= 4; }
  else { fehl++; sag(`FAIL probe aborted: ${e.stack ?? e.message}`); }
} finally {
  if (abo) { try { await abo.stoppe(); } catch { /* the probe ends anyway */ } }
  if (hochgefahren) { const s = await djkStop(); sag(`INFO djk-stop --instanz ${INSTANZ} rc ${s.rc}`); }
  if (slug && /^rettung-kill9-/.test(slug)) {
    try { fs.rmSync(path.join(WURZEL, slug), { recursive: true, force: true }); sag(`INFO project ${slug} removed`); } catch (e) { sag(`INFO could not remove the project: ${e.message}`); }
  }
  if (roh?.f32) for (const f of [roh.f32, roh.f32.replace(/\.f32$/, '.json')]) { try { fs.rmSync(f, { force: true }); } catch { /* temp file */ } }
  fs.writeFileSync(path.join(ORDNER, 'rettung_kill9.txt'), `${zeilen.join('\n')}\n`);
  sag(`${fehl === 0 && !process.exitCode ? 'ALL PASS' : `${fehl} FAIL, exit ${process.exitCode ?? 1}`} (report ${path.join(ORDNER, 'rettung_kill9.txt')})`);
  if (fehl > 0) process.exitCode = 1;
}
