// Acceptance, package 1.9 U2 (kit track, L25): AK-K1, AK-K2, AK-K6, AK-K8 and the base-project negative control, on a TEST INSTANCE with the freshly built core
// (instances b, d or e only, never f, never the operation; the script refuses every other letter). Set-up (instance d, silent sink, no --ton-frei):
//   mkdir -p <kits-d> && cp -a djk/core/tests/data/kits/. <kits-d>/            (the kit folder of the instance = a copy of the repo test kits)
//   CYPHERDJ_KATALOG=<empty catalog> DJK=<worktree>/djk djk/start/djk-start --instanz d --kit-ordner <kits-d>
//   flock <CYPHERDJ_ECHTZEIT_SCHLOSS> node check/acceptance_i19_kit.mjs --url http://127.0.0.1:51300 --bau <kern build folder> --kits <kits-d> \
//        --iso-ref <iso_ref> --grund <u0-grundprojekt.json> [--ausgabe <folder>] [--nur S,K1,K2,K6,K8,N0]
// What it states and checks first (S): the kit folder is a byte copy of the repo test kits; the running core is <bau>/cypherdj-kern; the environment of the core and of
// the page server holds CYPHERDJ_KIT_ORDNER=<kits-d> (read from /proc/<pid>/environ); GET /proj/kits lists the three test kits. A script that cannot show this refuses
// to measure, because without it the instance would read the operation's kit folder.
// Points (each with its measured value):
//   K1  AK-K1: kit_impuls, 12 notes on 16th positions at 120 BPM: in the offline export each impulse starts on the sample round(beat * 24000) (deviation 0, 12 of 12).
//   K2  AK-K2: kit_zwei, 8 bars, live ring recording against the offline render (cypherdj-nulltest, produktion tap through the isolator reference) at 120 and 127 BPM:
//       residual below -90 dBFS; negative control: the same render without the isolator is never null.
//   K6  AK-K6: (a) spur_neu with the kit nicht-da-i19 is refused kit_unbekannt (404), the revision does not move; (b) a project file written directly into the instance
//       project folder that names nicht-da-i19 opens, the core refuses the playback with `format` and the text names <kits>/nicht-da-i19.
//   K8  AK-K8: proj_export of a project with a kit track needs no freeze (no freeze field, no refusal) and the WAV equals the render of K2 (120 BPM, same beats).
//   N0  negative control of U2: the base project P0 (RB-338 only) exported on this fresh start has the sha256 and regler_quelle of u0-grundprojekt.json (U0 build 8afd2d88).
// Return: 0 all points OK, 1 at least one FEHL, 2 usage. Only own projects (slug i19k-...) are removed; nothing is written outside <ausgabe>, /dev/shm/cypherdj-<i> and the
// scratch of the points. The kit folder is only read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { leseWav } from './w1_wav.mjs';
import { erzeugeApi, baueGrundprojekt, exportiere as exportiereGrund, loescheGrundprojekt, kernExeStimmt, SLUG as GRUND_SLUG } from './i19_base_project.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..', '..');
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, bau: { type: 'string' }, kits: { type: 'string' }, 'iso-ref': { type: 'string' }, grund: { type: 'string' },
  ausgabe: { type: 'string' }, instanz: { type: 'string' }, nur: { type: 'string' } } });
const aufruf = (t) => { process.stderr.write(`abnahme_i19_kit: ${t}\n`); process.exit(2); };
if (!opt.url || !opt.bau || !opt.kits) {
  aufruf('usage: --url <http://127.0.0.1:port> --bau <kern build folder> --kits <kit folder of the instance> [--iso-ref <iso_ref>] [--grund <u0-grundprojekt.json>] '
    + '[--ausgabe <folder>] [--instanz <b|d|e>] [--nur S,K1,K2,K6,K8,N0]');
}
if (/:(47300|47100|47200)\b/.test(opt.url)) aufruf('never against the operation (47300): choose a test instance');
const port = Number(new globalThis.URL(opt.url).port), kn = (port - 47300) / 1000;
const instanz = opt.instanz ?? (Number.isInteger(kn) && kn >= 1 && kn <= 9 ? String.fromCharCode(96 + kn) : undefined);
if (!/^[bde]$/.test(instanz ?? '')) aufruf(`instance ${instanz ?? '?'} (port ${port}) is not allowed: b, d or e only (never f)`);
// real path: djk-start hands the unit the readlink -f of --kit-ordner, and the folder the core names in a refusal is that one
let KITS;
try { KITS = fs.realpathSync(path.resolve(opt.kits)); } catch (e) { aufruf(`--kits ${opt.kits}: ${e.message}`); }
const BAU = path.resolve(opt.bau);
const ISO_REF = opt['iso-ref'] ? path.resolve(opt['iso-ref']) : null;
const NUR = opt.nur ? new Set(opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-i19-kit`);
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
const fmt = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));
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
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `i19k-${name}-${zeit}` }));
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

// ---- the points ----------------------------------------------------------------------------------------------------------------------------------------------

// S: the set-up statements
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
}

// K1
const K1_BEATS = [0, 0.25, 0.5, 1, 1.75, 2.25, 2.5, 3, 4.25, 5.5, 6.75, 7];
async function k1() {
  const slug = await neuesProjekt('k1');
  await aendern('K1 tempo and track', [{ befehl: 'tempo_setzen', bpm: 120 }, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'kit_impuls' } }]);
  const p = (await aktuell()).projekt;
  const s = p.spuren[0];
  notiere('K1a', s.name === 'KIT · kit_impuls' && !('freeze' in s) && s.geraet.kit === 'kit_impuls', `track ${s.id} "${s.name}", device ${JSON.stringify(s.geraet)}, freeze field ${'freeze' in s ? 'present' : 'absent'}`);
  await aendern('K1 notes', [{ befehl: 'clip_neu', spur_id: s.id, art: 'midi', start_beat: 0, laenge_beats: 8, name: 'K1',
    noten: K1_BEATS.map((b) => ({ beat: b, laenge: 0.2, ton: 0, vel: 127 })) }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }]);
  await warteGeladen();
  const e = await exportiere(0, 8, 'produktion');
  const kopie = path.join(ORDNER, 'k1-export.wav');
  fs.copyFileSync(e.datei, kopie);
  const w = leseWav(kopie);
  let spitze = 0;
  for (let i = 0; i < w.frames; i++) spitze = Math.max(spitze, Math.abs(w.l[i]), Math.abs(w.r[i]));
  const schwelle = spitze * 0.05;
  const einsaetze = [];
  for (let i = 0; i < w.frames; i++) {
    if (Math.abs(w.l[i]) <= schwelle) continue;
    if (einsaetze.length === 0 || i - einsaetze.at(-1) > 96) einsaetze.push(i);
  }
  const soll = K1_BEATS.map((b) => Math.round(b * 24000));
  const abw = soll.map((s0, i) => (einsaetze[i] === undefined ? null : einsaetze[i] - s0));
  const treffer = abw.filter((a) => a === 0).length;
  notiere('K1', einsaetze.length === 12 && treffer === 12, `${treffer} of 12 onsets exactly on round(beat*24000), found ${einsaetze.length} onsets, deviations ${JSON.stringify(abw)}, peak ${fmt(dbfs(spitze))} dBFS, ${w.frames} frames (${kopie})`);
  // negative control: the check can fail: shift the expectation by one sample and it must not pass
  notiere('K1c', soll.map((s0, i) => (einsaetze[i] ?? -1) - (s0 + 1)).filter((a) => a === 0).length === 0, 'negative control: against the expectation shifted by one sample no onset matches');
  return { slug };
}

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

// the 8-bar kit pattern of K2: kit_zwei, impulse (note 0) and burst (note 1) with changing velocities, 16ths over 32 beats
function k2Noten() {
  const n = [];
  for (let i = 0; i < 128; i++) {
    const beat = i * 0.25;
    if (i % 4 === 0) n.push({ beat, laenge: 0.2, ton: 0, vel: 127 - (i % 8) * 6 });
    if (i % 2 === 1 || i % 16 === 8) n.push({ beat, laenge: 0.2, ton: 1, vel: 40 + ((i * 7) % 80) });
  }
  return n;
}
let k2Render120 = null;
async function k2() {
  if (!ISO_REF || !fs.existsSync(ISO_REF)) throw new Fehl(`--iso-ref ${ISO_REF ?? '(not given)'} missing: the null test cannot be judged without the isolator reference`);
  await neuesProjekt('k2');
  const bpm0 = (await ruf('GET', '/lage')).j?.uhr?.bpm;
  await aendern('K2 track and notes', [{ befehl: 'tempo_setzen', bpm: 120 }, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'kit_zwei' } }]);
  const sid = (await aktuell()).projekt.spuren[0].id;
  await aendern('K2 clip', [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 0, laenge_beats: 32, name: 'K2', noten: k2Noten() }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 32 }]);
  info(`K2 set-up: master tempo before ${bpm0} BPM, ${k2Noten().length} notes on kit_zwei over 32 beats`);
  for (const bpm of [120, 127]) {
    if (bpm !== 120) await aendern(`K2 tempo ${bpm}`, [{ befehl: 'tempo_setzen', bpm }]);
    await warteTempo(bpm);
    await warteGeladen();
    const sek = Math.ceil((32 * 60) / bpm) + 4;
    let a = await nullLive(`k2-${bpm}`, bpm, 32, sek);
    for (let v = 2; v <= 3 && a.vPI?.j?.urteil === 'ungueltig'; v++) { info(`K2 ${bpm}: attempt ${v - 1} invalid (${a.vPI.j.ursache}), once more`); a = await nullLive(`k2-${bpm}-v${v}`, bpm, 32, sek); }
    if (a.ungueltig) throw new Fehl(`K2 ${bpm} BPM invalid, not passed: ${a.ungueltig}`);
    const ok = a.vPI?.j?.urteil === 'bestanden' && a.vPI.j.rest_db < -90 && a.vPI.j.signal_db > -60 && a.vPI.j.phase_live === a.vPI.j.phase_render;
    notiere(`K2-${bpm}`, ok, `live ring recording against the render, ${nl(a.vPI)}; render ${a.p.frames} frames`);
    notiere(`K2-${bpm}c`, a.vPR?.j?.urteil === 'rot' && a.vPR.j.rest_db > -90, `negative control (render without the isolator): ${nl(a.vPR)}`);
    if (bpm === 120) k2Render120 = path.join(a.dir, 'w', 'p.wav');
  }
}

// K6
async function k6() {
  // (a) the server refuses a kit that is not in the folder
  await neuesProjekt('k6a');
  const rev0 = await holeRev();
  const nein = await ruf('POST', '/proj/aendern', { rev: rev0, label: 'K6 unknown kit', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'nicht-da-i19' } }] }, CYPHER);
  notiere('K6a', nein.code === 404 && nein.j?.fehler === 'kit_unbekannt' && (await holeRev()) === rev0, `spur_neu with nicht-da-i19 -> ${grundVon(nein)}; rev ${rev0} -> ${await holeRev()}`);
  const ja = await ruf('POST', '/proj/aendern', { rev: rev0, label: 'K6 known kit', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'kit_zwei' } }] }, CYPHER);
  notiere('K6a-c', ja.code === 200, `negative control: spur_neu with kit_zwei -> ${ja.code}`);
  // (b) a project file that names the missing kit, written directly into the instance project folder
  const vorlage = (await aktuell()).projekt;
  const sid = vorlage.spuren[0].id;
  await aendern('K6 clip', [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 0, laenge_beats: 4, name: 'K6', noten: [0, 1, 2, 3].map((b) => ({ beat: b, laenge: 0.2, ton: 0, vel: 100 })) }]);
  const slug = `i19k-k6b-${zeit}`;
  const roh = JSON.parse(fs.readFileSync(path.join(wurzel, eigeneSlugs.at(-1), 'project.json'), 'utf8'));
  roh.name = slug;
  roh.wiedergabe_rev = 0;   // the copied number is the one the core already holds (the valid kit_zwei playback): 0 forces a load of this file
  roh.spuren[0].geraet = { art: 'intern', name: 'kit', kit: 'nicht-da-i19' };
  if (!path.resolve(wurzel, slug).startsWith(path.resolve(wurzel) + path.sep)) throw new Fehl('slug leaves the project folder');
  fs.mkdirSync(path.join(wurzel, slug), { recursive: true });
  eigeneSlugs.push(slug);
  fs.writeFileSync(path.join(wurzel, slug, 'project.json'), JSON.stringify(roh));
  const seit = new Date(Date.now() - 2000).toISOString().replace('T', ' ').slice(0, 19);
  const auf = await ruf('POST', '/proj/oeffnen', { slug }, CYPHER);
  const q = auf.j?.kern?.wiedergabe;
  info(`K6b open ${slug}: ${grundVon(auf)}; playback answer ${JSON.stringify(q)}`);
  const a = await aktuell();
  info(`K6b state after open: kern ${JSON.stringify(a.kern)}, project wiedergabe_rev ${a.projekt?.wiedergabe_rev} (the core keeps the playback it held before the refused one)`);
  const st = await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  info(`K6b transport start: ${st.code} ${JSON.stringify(st.j).slice(0, 300)}`);
  await warte(1500);
  await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  // the text of a refusal is the core's log line (the acknowledgment carries the reason only): read it from the journal of the instance core
  const ziel = path.join(KITS, 'nicht-da-i19');
  let zeile = null;
  for (let i = 0; i < 20 && !zeile; i++) {
    const j = spawnSync('journalctl', ['--user', '-u', `cypherdj-kern-${instanz}`, '--since', seit, '--no-pager', '-o', 'cat'], { encoding: 'utf8' }).stdout;
    zeile = j.split('\n').find((z) => z.includes(`Wiedergabe ${q?.nr} abgelehnt (format)`)) ?? null;
    if (!zeile) await warte(500);
  }
  notiere('K6b', q?.quittung?.status === 6 && q.quittung.grund === 'format' && zeile !== null && zeile.includes(ziel),
    `core refuses the playback ${q?.nr}: acknowledgment ${JSON.stringify(q?.quittung)}; log line: ${zeile ?? 'none'} (expected the folder ${ziel})`);
  // negative control: the refusal is about the kit only: the same file with the kit that exists loads
  roh.spuren[0].geraet = { art: 'intern', name: 'kit', kit: 'kit_zwei' };
  const slug2 = `i19k-k6c-${zeit}`;
  roh.name = slug2;
  fs.mkdirSync(path.join(wurzel, slug2), { recursive: true });
  eigeneSlugs.push(slug2);
  fs.writeFileSync(path.join(wurzel, slug2, 'project.json'), JSON.stringify(roh));
  const ok = await ruf('POST', '/proj/oeffnen', { slug: slug2 }, CYPHER);
  notiere('K6b-c', ok.code === 200 && ok.j?.kern?.wiedergabe?.quittung?.status === 3, `negative control: the same file with kit_zwei -> ${ok.code} playback acknowledgment ${JSON.stringify(ok.j?.kern?.wiedergabe?.quittung)}`);
}

// K8: proj_export needs no freeze and equals the render of K2 (120 BPM)
async function k8() {
  if (!k2Render120) throw new Fehl('K8 needs the render of K2 at 120 BPM (run K2 first)');
  await neuesProjekt('k8');
  await aendern('K8 track', [{ befehl: 'tempo_setzen', bpm: 120 }, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'kit_zwei' } }]);
  const sid = (await aktuell()).projekt.spuren[0].id;
  await aendern('K8 clip', [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 0, laenge_beats: 32, name: 'K8', noten: k2Noten() }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 32 }]);
  await warteTempo(120);
  await warteGeladen();
  const spur = (await aktuell()).projekt.spuren[0];
  const e = await ruf('POST', '/proj/export', { von_beat: 0, bis_beat: 32, abgriff: 'produktion' }, CYPHER);
  notiere('K8a', e.code === 200 && !('freeze' in spur), `proj_export of the unfrozen kit track -> ${grundVon(e)}; freeze field ${'freeze' in spur ? 'present' : 'absent'}`);
  if (e.code !== 200) return;
  const kopie = path.join(ORDNER, 'k8-export.wav');
  fs.copyFileSync(e.j.datei, kopie);
  const a = leseWav(kopie), b = leseWav(k2Render120);
  let maxAbw = 0, erster = -1;
  const n = Math.min(a.frames, b.frames);
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(a.l[i] - b.l[i]), Math.abs(a.r[i] - b.r[i]));
    if (d > 0 && erster < 0) erster = i;
    maxAbw = Math.max(maxAbw, d);
  }
  const gleich = a.frames === b.frames && maxAbw === 0;
  notiere('K8b', gleich, `export ${a.frames} frames against the K2 render at 120 BPM ${b.frames} frames: max deviation ${maxAbw}${erster >= 0 ? `, first difference at frame ${erster}` : ''}; export sha256 ${sha256Datei(kopie).slice(0, 16)}, render ${sha256Datei(k2Render120).slice(0, 16)}`);
}

// N0: the base project of U0
async function n0() {
  const soll = JSON.parse(fs.readFileSync(opt.grund, 'utf8'));
  if (loescheGrundprojekt(instanz)) info(`N0 removed leftover project ${GRUND_SLUG}`);
  await baueGrundprojekt(api);
  const e = await exportiereGrund(api);
  loescheGrundprojekt(instanz);
  notiere('N0', e.sha256 === soll.sha256 && e.regler_quelle === soll.regler_quelle, `P0 export sha256 ${e.sha256.slice(0, 16)}.. regler_quelle ${e.regler_quelle} against ${soll.sha256.slice(0, 16)}.. ${soll.regler_quelle} (U0 build ${soll.base}); frames ${e.frames}, peak ${e.spitze_db} dBFS`);
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
  await abschnitt('K1', k1);
  await abschnitt('K2', k2);
  await abschnitt('K6', k6);
  await abschnitt('K8', k8);
  if (opt.grund) await abschnitt('N0', n0); else info('N0 not run: --grund not given');
}
// clean up: only own projects
for (const slug of eigeneSlugs) {
  const d = path.join(wurzel, slug);
  if (!/^i19k-/.test(slug)) { info(`slug ${slug} is not from this script, not removed`); continue; }
  try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); info(`removed ${d}`); } } catch (e) { notiere('cleanup', false, e.message); }
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# abnahme_i19_kit ${zeit} (${opt.url}, instance ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALL OK' : `${fehl} FEHL`} - report ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
