// Acceptance, package 1.9 U3 (two Surge production hosts, L10): AK-W1 to AK-W5 on a TEST INSTANCE with the freshly built core and BOTH hosts running
// (instances b, d or e only, never f, never the operation; the script refuses every other letter). Set-up (instance d, silent sink, no --ton-frei):
//   CYPHERDJ_KATALOG=<empty catalog> DJK=<worktree>/djk djk/start/djk-start --instanz d --arr1 --arr2
//   node check/acceptance_i19_hosts.mjs --url http://127.0.0.1:51300 --bau <kern build folder> [--ausgabe <folder>] [--nur S,W3,W1,W2,W4,W5] [--bpm 90]
// Both hosts play the factory patch "Templates/Init Sine" (loaded with djk-klang; the instance keeps it in ~/.config/cypherdj-<i>/klang-arr<s>.fxp).
// What it states first (S): the running core is <bau>/cypherdj-kern; the units cypherdj-wirt-arr1-<i> and -arr2-<i> are active and GET /proj/aktuell?noten=zahl
// shows wirte 1 and 2 as running. A script that cannot show this refuses to measure.
// Points (each with its measured value):
//   W3  AK-W3: the body of the page command `neu-surge` (read from public/production/track_heads.js, without slot) sent twice gives slots 1 and 2, a third one is
//       refused slot_belegt (409) with a text naming both slots; nothing is stored by the refusal.
//   W1  AK-W1: slot 1 plays note 60, slot 2 note 72; both are frozen; the peak bin of each frozen file is within 1 % of 261.6 Hz and 523.3 Hz, and the other
//       track's fundamental is below -40 dB relative to the own one.
//   W2  AK-W2: proj_lautheit lists both tracks with finite lufs_i; after unfreezing both, proj_export freezes both first (both carry a freeze field afterwards).
//   W4  AK-W4: with the slot-2 unit stopped, freeze of the slot-2 track is refused wirt_fehlt naming --arr2 while the slot-1 track still freezes; with the status file
//       of the dead host holding `add_plugin: x` the refusal is wirt_fehler quoting it; proj_lage shows the slot as not running; after djk-instrumente --arr2 the
//       slot-2 track freezes again, and a live host whose fehler holds only `aktiv-klang: x` is not refused (negative controls).
//   W5  AK-W5: the slot-1 track plays ONE sustained 32-beat note, slot 2 plays notes; the master is recorded with cypherdj-mitschnitt across the whole window; the
//       host process of slot 2 is killed with SIGKILL; systemd restarts it (NRestarts +1, new pid); the master holds no run of digital silence longer than 48
//       frames inside the note; the slot-2 level shows a gap after the kill and sounds again afterwards (the gap proves that the kill reached the sound).
// Return: 0 all points OK, 1 at least one FEHL, 2 usage. Only own projects (slug i19w-...) are removed; nothing is written outside <ausgabe>, /dev/shm/cypherdj-<i>
// and the instance's own arrangement folder (freeze files of own projects).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { erzeugeApi, kernExeStimmt } from './i19_base_project.mjs';
import { peakFrequenz, hannPegel, pegelBei, laengsterStillstand, leseF32Stereo, mono } from './i19_spectrum.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..', '..');
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, bau: { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string' }, nur: { type: 'string' },
  bpm: { type: 'string' } } });
const aufruf = (t) => { process.stderr.write(`abnahme_i19_wirte: ${t}\n`); process.exit(2); };
if (!opt.url || !opt.bau) aufruf('usage: --url <http://127.0.0.1:port> --bau <kern build folder> [--ausgabe <folder>] [--instanz <b|d|e>] [--nur S,W3,W1,W2,W4,W5] [--bpm 90]');
if (/:(47300|47100|47200)\b/.test(opt.url)) aufruf('never against the operation (47300): choose a test instance');
const port = Number(new globalThis.URL(opt.url).port), kn = (port - 47300) / 1000;
const instanz = opt.instanz ?? (Number.isInteger(kn) && kn >= 1 && kn <= 9 ? String.fromCharCode(96 + kn) : undefined);
if (!/^[bde]$/.test(instanz ?? '')) aufruf(`instance ${instanz ?? '?'} (port ${port}) is not allowed: b, d or e only (never f)`);
const BAU = path.resolve(opt.bau);
const BPM = Number(opt.bpm ?? 90);
if (!(BPM >= 60 && BPM <= 200)) aufruf('--bpm 60..200');
const NUR = opt.nur ? new Set(opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-i19-wirte`);
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
const aktuell = async () => erwarte200('/proj/aktuell?noten=zahl', await ruf('GET', '/proj/aktuell?noten=zahl')).j;
const aendernRoh = async (label, befehle) => ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, CYPHER);
const aendern = async (label, befehle) => erwarte200(`/proj/aendern (${label})`, await aendernRoh(label, befehle)).j;
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');
const SHM = path.join('/dev/shm', `cypherdj-${instanz}`);
const ARBEIT = path.join(os.homedir(), '.cache', `cypherdj-${instanz}`, 'arr');
const eigeneSlugs = [];
const fmt = (x) => (typeof x === 'number' ? x.toFixed(2) : String(x));
const prog = (programm, args, env = {}) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const sc = (...a) => spawnSync('systemctl', ['--user', ...a], { encoding: 'utf8' });
const unit = (n) => `cypherdj-wirt-arr${n}-${instanz}`;
const unitAktiv = (n) => sc('is-active', `${unit(n)}.service`).stdout.trim() === 'active';
const mainPid = (n) => Number(sc('show', '-p', 'MainPID', '--value', `${unit(n)}.service`).stdout.trim()) || 0;
const nRestarts = (n) => Number(sc('show', '-p', 'NRestarts', '--value', `${unit(n)}.service`).stdout.trim());
const statusDatei = (n) => path.join(SHM, `wirt-arr${n}.json`);
const status = (n) => { try { return JSON.parse(fs.readFileSync(statusDatei(n), 'utf8')); } catch { return null; } };
const klang = path.join(REPO, 'djk', 'hosts', 'carla', 'djk-klang');
const ladeKlang = async (n, name) => {
  const r = await prog('python3', [klang, '--instanz', instanz, `arr${n}`, 'lade', name]);
  if (r.rc !== 0) throw new Fehl(`djk-klang arr${n} lade ${name} -> rc ${r.rc} ${r.err.trim() || r.out.trim()}`);
};
const SOUND = 'Templates/Init Sine';

async function neuesProjekt(name) {
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `i19w-${name}-${zeit}` }));
  const slug = r.j.slug ?? r.j.projekt?.slug;
  if (!slug) throw new Fehl(`/proj/neu without slug: ${JSON.stringify(r.j).slice(0, 200)}`);
  eigeneSlugs.push(slug);
  await warte(1500);
  return slug;
}
const geladen = async () => { const a = await aktuell(); return a.kern?.rev_geladen === a.projekt.wiedergabe_rev; };
const warteGeladen = async () => {
  if (!(await bisWahr(geladen, 60000))) throw new Fehl('the core did not load the playback (kern.rev_geladen = projekt.wiedergabe_rev never came)');
  await warte(1500);
};
const spuren = async () => (await aktuell()).projekt.spuren;
const freeze = async (spurId, an = true) => ruf('POST', '/proj/freeze', { spur_id: spurId, an }, CYPHER);
const freezeDatei = (spur) => path.join(ARBEIT, spur.freeze?.datei ?? 'none');

// the body of the page command `neu-surge`: read from the page source, so that the script runs the command the page really sends
function neuSurgeBody() {
  const q = fs.readFileSync(path.join(HIER, '..', 'public', 'production', 'track_heads.js'), 'utf8');
  const m = q.match(/'neu-surge':\s*\[\s*'[^']*',\s*(\{[^\n]*\})\s*\]/);
  if (!m) throw new Fehl("the `'neu-surge'` entry of the NEU table was not found in track_heads.js");
  return new Function(`return (${m[1]});`)();
}

// ---- the points ----------------------------------------------------------------------------------------------------------------------------------------------

async function aufbau() {
  const exe = kernExeStimmt(BAU, instanz);
  notiere('S1', exe.ok, exe.text);
  for (const n of [1, 2]) notiere(`S${n + 1}`, unitAktiv(n), `${unit(n)}.service is ${sc('is-active', `${unit(n)}.service`).stdout.trim()}`);
  const a = await ruf('GET', '/proj/aktuell?noten=zahl');
  const w = a.j?.wirte;
  notiere('S4', a.code === 200 && w?.['1']?.laeuft === true && w?.['2']?.laeuft === true, `proj_lage wirte ${JSON.stringify(w)}`);
  for (const n of ['cypherdj-mitschnitt']) if (!fs.existsSync(path.join(BAU, n))) notiere('S5', false, `${path.join(BAU, n)} missing`);
  notiere('S6', fs.existsSync(ARBEIT), `arrangement folder ${ARBEIT} exists`);
}

// W3 + the project of W1/W2/W4
let ids = null;
async function w3() {
  await neuesProjekt('w');
  await aendern('W set tempo', [{ befehl: 'tempo_setzen', bpm: 120 }]);
  const body = neuSurgeBody();
  notiere('W3a', body.geraet?.art === 'wirt' && !('slot' in body.geraet), `the page command neu-surge sends ${JSON.stringify(body)} (no slot)`);
  const a1 = await aendern('W3 Surge 1', [body]);
  const a2 = await aendern('W3 Surge 2', [body]);
  const sp = await spuren();
  const slots = sp.filter((s) => s.geraet?.art === 'wirt').map((s) => s.geraet.slot);
  notiere('W3b', JSON.stringify(slots) === '[1,2]', `two page commands give slots ${JSON.stringify(slots)} (revs ${a1.rev}, ${a2.rev})`);
  const rev = await holeRev();
  const dritte = await aendernRoh('W3 Surge 3', [body]);
  const nach = await holeRev();
  notiere('W3c', dritte.code === 409 && dritte.j?.fehler === 'slot_belegt' && /1, 2/.test(dritte.j?.text ?? '') && nach === rev,
    `the third neu-surge -> ${grundVon(dritte)}; rev ${rev} -> ${nach}; tracks ${(await spuren()).length}`);
  ids = { s1: sp.find((s) => s.geraet?.slot === 1).id, s2: sp.find((s) => s.geraet?.slot === 2).id };
}

// W1
const NOTE1 = 60, NOTE2 = 72, F1 = 261.63, F2 = 523.25;
async function w1() {
  if (!ids) throw new Fehl('W1 needs the two Surge tracks of W3');
  await ladeKlang(1, SOUND); await ladeKlang(2, SOUND);
  await aendern('W1 notes', [
    { befehl: 'clip_neu', spur_id: ids.s1, art: 'midi', start_beat: 0, laenge_beats: 4, name: 'W1 slot 1', noten: [{ beat: 0, laenge: 4, ton: NOTE1, vel: 100 }] },
    { befehl: 'clip_neu', spur_id: ids.s2, art: 'midi', start_beat: 0, laenge_beats: 4, name: 'W1 slot 2', noten: [{ beat: 0, laenge: 4, ton: NOTE2, vel: 100 }] },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 4 }]);
  await warteGeladen();
  const f1 = await freeze(ids.s1), f2 = await freeze(ids.s2);
  notiere('W1a', f1.code === 200 && f2.code === 200, `proj_freeze slot-1 track -> ${grundVon(f1)}, slot-2 track -> ${grundVon(f2)}`);
  if (f1.code !== 200 || f2.code !== 200) return;
  const sp = await spuren();
  const s1 = sp.find((s) => s.id === ids.s1), s2 = sp.find((s) => s.id === ids.s2);
  const N = 65536, VON = 12000;
  const messe = (kz, s, own, other, ownName, otherName) => {
    const datei = freezeDatei(s);
    if (!fs.existsSync(datei)) { notiere(kz, false, `frozen file ${datei} missing`); return; }
    fs.copyFileSync(datei, path.join(ORDNER, `${kz.toLowerCase()}-${s.freeze.datei}`));
    const w = leseF32Stereo(datei);
    if (w.frames < VON + N) { notiere(kz, false, `${s.freeze.datei}: ${w.frames} frames, need ${VON + N}`); return; }
    const x = mono(w.l, w.r, VON, N);
    const f = peakFrequenz(x, 48000);
    const pOwn = hannPegel(x, 48000, own * 0.99, own * 1.01), pOther = hannPegel(x, 48000, other * 0.99, other * 1.01);
    notiere(kz, Math.abs(f / own - 1) < 0.01 && pOther - pOwn < -40 && pOwn > -60,
      `${ownName} (${s.freeze.datei}, ${w.frames} frames): peak bin ${fmt(f)} Hz (expected ${own}, deviation ${fmt(100 * (f / own - 1))} %), own level ${fmt(pOwn)} dB, ${otherName} fundamental ${fmt(pOther)} dB = ${fmt(pOther - pOwn)} dB relative`);
    // negative control: the same measurement against the other track's frequency must fail
    notiere(`${kz}c`, Math.abs(f / other - 1) >= 0.01, `negative control: the peak ${fmt(f)} Hz is not within 1 % of ${other} Hz`);
  };
  messe('W1b', s1, F1, F2, 'slot 1 note 60', '523.3 Hz');
  messe('W1d', s2, F2, F1, 'slot 2 note 72', '261.6 Hz');
}

// W2
async function w2() {
  if (!ids) throw new Fehl('W2 needs the two Surge tracks of W3');
  let sp = await spuren();
  if (!sp.every((s) => !s.geraet || s.freeze)) throw new Fehl('W2 expects both tracks frozen (W1)');
  const l = await ruf('POST', '/proj/lautheit', { von_beat: 0, bis_beat: 4 }, CYPHER);
  const liste = l.j?.spuren ?? [];
  const werte = [ids.s1, ids.s2].map((id) => liste.find((x) => x.spur_id === id)?.lufs_i);
  notiere('W2a', l.code === 200 && werte.every((v) => typeof v === 'number' && Number.isFinite(v)), `proj_lautheit -> ${l.code}, lufs_i slot 1 ${werte[0]}, slot 2 ${werte[1]}, sum ${l.j?.summe?.lufs_i}`);
  for (const id of [ids.s1, ids.s2]) erwarte200(`unfreeze ${id}`, await freeze(id, false));
  sp = await spuren();
  notiere('W2b', sp.filter((s) => s.geraet?.art === 'wirt').every((s) => !s.freeze), 'both tracks unfrozen (precondition of the export)');
  const e = await ruf('POST', '/proj/export', { von_beat: 0, bis_beat: 4, abgriff: 'produktion' }, CYPHER);
  sp = await spuren();
  const beide = sp.filter((s) => s.geraet?.art === 'wirt').every((s) => s.freeze);
  notiere('W2c', e.code === 200 && beide, `proj_export of the unfrozen project -> ${grundVon(e)}; both tracks frozen afterwards: ${beide}; ${e.j?.frames} frames`);
}

// W4
async function w4() {
  if (!ids) throw new Fehl('W4 needs the two Surge tracks of W3');
  for (const id of [ids.s1, ids.s2]) erwarte200(`unfreeze ${id}`, await freeze(id, false));
  // negative control first: both hosts healthy -> no refusal
  const g1 = await freeze(ids.s1);
  const g2 = await freeze(ids.s2);
  notiere('W4a', g1.code === 200 && g2.code === 200, `negative control, both hosts healthy: freeze slot 1 ${grundVon(g1)}, slot 2 ${grundVon(g2)}`);
  for (const id of [ids.s1, ids.s2]) erwarte200(`unfreeze ${id}`, await freeze(id, false));
  // stop the slot-2 host
  const stop = sc('stop', `${unit(2)}.service`);
  await bisWahr(() => !unitAktiv(2), 15000);
  notiere('W4b', !unitAktiv(2), `systemctl stop ${unit(2)}.service rc ${stop.status}, unit active: ${unitAktiv(2)}`);
  const r2 = await freeze(ids.s2);
  notiere('W4c', r2.code === 409 && r2.j?.fehler === 'wirt_fehlt' && /--arr2/.test(r2.j?.text ?? ''), `freeze of the slot-2 track with arr2 stopped -> ${grundVon(r2)}`);
  const r1 = await freeze(ids.s1);
  notiere('W4d', r1.code === 200, `freeze of the slot-1 track with arr2 stopped still works -> ${grundVon(r1)}`);
  erwarte200('unfreeze slot 1', await freeze(ids.s1, false));
  // the dead host leaves a status file with a fatal entry
  const alt = status(2);
  fs.writeFileSync(statusDatei(2), JSON.stringify({ ...(alt ?? {}), bereit: false, fehler: ['add_plugin: x'] }));
  const r3 = await freeze(ids.s2);
  notiere('W4e', r3.code === 409 && r3.j?.fehler === 'wirt_fehler' && /add_plugin: x/.test(r3.j?.text ?? '') && /--arr2/.test(r3.j?.text ?? ''), `dead host with add_plugin: x -> ${grundVon(r3)}`);
  const lage = (await ruf('GET', '/proj/aktuell?noten=zahl')).j?.wirte;
  notiere('W4f', lage?.['2']?.laeuft === false && lage['2'].fehler.includes('add_plugin: x') && lage['1'].laeuft === true, `proj_lage wirte ${JSON.stringify(lage)}`);
  // start slot 2 again
  const neu = await prog(path.join(REPO, 'djk', 'start', 'djk-instrumente'), ['--instanz', instanz, '--arr2']);
  info(`djk-instrumente --arr2 rc ${neu.rc}: ${neu.out.trim().split('\n').pop()}${neu.err.trim() ? ` | ${neu.err.trim().slice(0, 200)}` : ''}`);
  const da = await bisWahr(() => unitAktiv(2) && status(2)?.bereit === true, 30000);
  notiere('W4g', neu.rc === 0 && da, `slot 2 started again: unit active ${unitAktiv(2)}, status bereit ${status(2)?.bereit}`);
  await ladeKlang(2, SOUND);
  // negative control: a live host whose fehler holds only a non-fatal entry is not refused
  const st = status(2);
  fs.writeFileSync(statusDatei(2), JSON.stringify({ ...st, fehler: ['aktiv-klang: x'] }));
  const r4 = await freeze(ids.s2);
  notiere('W4h', r4.code === 200, `negative control: live host with fehler ["aktiv-klang: x"] -> ${grundVon(r4)}`);
  const r5 = await freeze(ids.s1);
  notiere('W4i', r5.code === 200, `slot 1 freezes again -> ${grundVon(r5)}`);
}

// W5
const SEG_S = 1.0;
async function w5() {
  if (!ids) throw new Fehl('W5 needs the two Surge tracks of W3');
  for (const id of [ids.s1, ids.s2]) { const s = (await spuren()).find((x) => x.id === id); if (s?.freeze) erwarte200(`unfreeze ${id}`, await freeze(id, false)); }
  await ladeKlang(1, SOUND); await ladeKlang(2, SOUND);
  // replace the clips: slot 1 one note of 32 beats on 60, slot 2 eight notes of 3.8 beats on 67 (392 Hz, no common partial with 261.6 Hz up to the third)
  const sp = await spuren();
  const alte = sp.flatMap((s) => s.clips.map((c) => c.id));
  await aendern('W5 clips', [...alte.map((id) => ({ befehl: 'clip_loeschen', clip_id: id })),
    { befehl: 'tempo_setzen', bpm: BPM },
    { befehl: 'clip_neu', spur_id: ids.s1, art: 'midi', start_beat: 0, laenge_beats: 32, name: 'W5 sustained', noten: [{ beat: 0, laenge: 32, ton: 60, vel: 100 }] },
    { befehl: 'clip_neu', spur_id: ids.s2, art: 'midi', start_beat: 0, laenge_beats: 32, name: 'W5 notes',
      noten: Array.from({ length: 8 }, (_, i) => ({ beat: i * 4, laenge: 3.8, ton: 67, vel: 100 })) },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 32 }]);
  await warteGeladen();
  const sek = Math.ceil((32 * 60) / BPM) + 10;
  const dir = path.join(ORDNER, 'w5');
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, 'master.f32');
  const pid0 = mainPid(2), n0 = nRestarts(2), status0 = status(2)?.pid;
  const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', String(sek), '--aus', datei]);
  await warte(800);
  const start = await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  if (start.code !== 200) { await mit; throw new Fehl(`transport start -> ${grundVon(start)}`); }
  const tStart = Date.now();
  await warte(Math.round(7000 + (60 / BPM) * 1000));   // let both tracks sound, then kill the slot-2 host
  const pid = status(2)?.pid;
  let kill = null;
  if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); kill = Date.now(); } catch (e) { info(`kill ${pid}: ${e.message}`); } }
  info(`W5: transport started, SIGKILL to the slot-2 host pid ${pid} (unit main pid ${pid0}, status pid ${status0}) ${kill ? `${((kill - tStart) / 1000).toFixed(1)} s after the start` : 'NOT sent'}`);
  const restartet = await bisWahr(() => nRestarts(2) > n0 && unitAktiv(2) && status(2)?.bereit === true && status(2)?.pid !== pid, 40000);
  const tBereit = Date.now();
  const m = await mit;
  await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  fs.writeFileSync(path.join(dir, 'mitschnitt.txt'), `${m.out}${m.err}rc=${m.rc}\n`);
  const n1 = nRestarts(2), pid1 = status(2)?.pid;
  notiere('W5a', kill !== null && restartet && n1 === n0 + 1 && pid1 !== pid,
    `kill sent ${kill !== null}; NRestarts ${n0} -> ${n1}; host pid ${pid} -> ${pid1}; ready again ${restartet} (${((tBereit - kill) / 1000).toFixed(1)} s after the kill)`);
  if (m.rc !== 0) throw new Fehl(`cypherdj-mitschnitt rc ${m.rc}: ${m.err.trim()}`);
  const w = leseF32Stereo(datei);
  const R = 48000, seg = Math.round(SEG_S * R);
  // the note: from the first frame above -80 dBFS on; its end is not read from the signal (a hole would end it early) but taken from the length
  let on = -1;
  for (let i = 0; i < w.frames; i++) if (Math.abs(w.l[i]) > 1e-4 || Math.abs(w.r[i]) > 1e-4) { on = i; break; }
  if (on < 0) throw new Fehl('the master recording is silent');
  const dauer = Math.round((32 * 60 / BPM) * R);
  const bis = Math.min(w.frames, on + Math.round(dauer * 0.9));
  const still = laengsterStillstand(w.l, w.r, on, bis, 1e-7);
  notiere('W5b', still <= 48 && bis - on > 0.8 * dauer, `longest run of digital silence between onset (frame ${on}) and 90 % of the note (frame ${bis}, ${((bis - on) / R).toFixed(1)} s): ${still} frames (limit 48)`);
  // per segment level of the two fundamentals
  const N = 32768;
  const pegel = [];
  for (let s0 = on; s0 + seg <= bis; s0 += seg) {
    const x = mono(w.l, w.r, s0 + Math.round(seg / 2) - N / 2, N);
    pegel.push({ t: (s0 - on) / R, p1: pegelBei(x, R, 261.63), p2: pegelBei(x, R, 392.0) });
  }
  fs.writeFileSync(path.join(dir, 'pegel.json'), JSON.stringify(pegel));
  info(`W5 per second [slot 1 dB, slot 2 dB]: ${pegel.map((p) => `${fmt(p.p1)}/${fmt(p.p2)}`).join('  ')}`);
  const SCHWELLE = -50;
  const ein1 = pegel.every((p) => p.p1 > SCHWELLE);
  notiere('W5c', ein1, `slot 1 level above ${SCHWELLE} dB in all ${pegel.length} one-second segments (minimum ${fmt(Math.min(...pegel.map((p) => p.p1)))} dB, maximum ${fmt(Math.max(...pegel.map((p) => p.p1)))} dB)`);
  const klingt = pegel.map((p) => p.p2 > SCHWELLE);
  const erste = klingt.indexOf(true);
  const luecke = klingt.indexOf(false, erste);
  const danach = luecke < 0 ? -1 : klingt.indexOf(true, luecke);
  notiere('W5d', erste === 0 && luecke > 0 && danach > luecke,
    `slot 2: sounds from segment ${erste}, gap from segment ${luecke} (${klingt.slice(luecke).filter((v) => !v).length} segments below ${SCHWELLE} dB in total), sounds again from segment ${danach} (${danach >= 0 ? `${pegel[danach].t.toFixed(0)} s into the note` : 'never'})`);
  // negative control of the silence measurement: slot 2 alone WOULD show gaps: the same measurement on its own band is below the limit in the gap
  const rest = luecke >= 0 ? Math.max(...pegel.slice(luecke, danach > 0 ? danach : undefined).map((p) => p.p2)) : 0;
  notiere('W5e', luecke >= 0 && rest <= SCHWELLE, `negative control: the slot-2 band in its gap reads at most ${fmt(rest)} dB, so the gap is real (not hidden by slot 1)`);
}

async function abschnitt(name, f) {
  if (NUR && !NUR.has(name)) return;
  try { await f(); } catch (e) { notiere(name, false, e instanceof Fehl ? e.message : `ABORT: ${e.stack ?? String(e)}`); }
}

info(`instance ${instanz}, ${opt.url}, build ${BAU}, output ${ORDNER}, W5 tempo ${BPM}`);
await abschnitt('S', aufbau);
if (fehl > 0 && (!NUR || NUR.has('S'))) {
  process.stdout.write('\nset-up statements failed: not measuring (the instance is not running both hosts)\n');
} else {
  await abschnitt('W3', w3);
  await abschnitt('W1', w1);
  await abschnitt('W2', w2);
  await abschnitt('W4', w4);
  await abschnitt('W5', w5);
}
// clean up: only own projects (their freeze files stay in the instance's own arrangement folder, which djk-stop does not touch)
for (const slug of eigeneSlugs) {
  const d = path.join(wurzel, slug);
  if (!/^i19w-/.test(slug)) { info(`slug ${slug} is not from this script, not removed`); continue; }
  try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); info(`removed ${d}`); } } catch (e) { notiere('cleanup', false, e.message); }
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# abnahme_i19_wirte ${zeit} (${opt.url}, instance ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALL OK' : `${fehl} FEHL`} - report ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
