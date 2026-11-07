// Package 1.9 instruments, U0 (AK-R9, API level): the base project P0 and its export hash.
// P0 is built through the page API only (/proj/neu, /proj/aendern): one RB-338 track with an 8-bar bass of 16th notes (128 notes, ten steps of a
// fixed pattern), tempo 120, loop 0..32 beats. exportiere() runs /proj/export (abgriff production, beats 0..32) and returns the sha256 of the WAV
// together with the answer's regler_quelle. U0 records both on the build of main 8afd2d88 (two fresh starts of instance d, equal); U2 repeats the
// same steps on its own build and compares: a kit track or rack feature must not change what a project without them exports.
//
// Importable: baueGrundprojekt(api), exportiere(api), loescheGrundprojekt(instanz), kernExeStimmt(bau, instanz). `api` is erzeugeApi(url) or any
// object with ruf(methode, weg, koerper, kopf) -> {code, j} and warte(ms).
// CLI (instances b, d, e only, never f, never the operation):
//   node pruef/i19_grundprojekt.mjs --url http://127.0.0.1:51300 --bau <core build folder> [--instanz d] [--ausgabe result.json]
// prints one JSON line {sha256, regler_quelle, frames, abgriff, bytes, spitze_db, slug}; exit 0 ok, 1 failure, 2 usage.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const NAME = 'i19 grund';
export const SLUG = 'i19-grund';
export const BPM = 120;
export const BEATS = 32;
const CYPHER = { 'x-djk-quelle': 'cypher' };

// 16 steps of the bass line (tone, velocity), repeated over 8 bars of 16th notes; the last note of every bar is shortened by the step grid, not by a rest
const MUSTER = [[36, 110], [36, 70], [48, 90], [36, 100], [43, 80], [36, 70], [46, 95], [48, 85], [36, 110], [39, 75], [48, 90], [36, 100], [43, 80], [41, 70], [46, 95], [48, 85]];

export function grundNoten() {
  const noten = [];
  for (let i = 0; i < BEATS * 4; i++) {
    const [ton, vel] = MUSTER[i % MUSTER.length];
    noten.push({ beat: i * 0.25, laenge: 0.2, ton, vel });
  }
  return noten;
}

export class Fehl extends Error {}

export function erzeugeApi(url) {
  return {
    url,
    warte: (ms) => new Promise((r) => setTimeout(r, ms)),
    ruf: async (methode, weg, koerper, kopf = {}) => {
      const r = await fetch(url + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
      const t = await r.text();
      let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
      return { code: r.status, j };
    },
  };
}

const erwarte200 = (weg, r) => {
  if (r.code !== 200) throw new Fehl(`${weg} -> ${r.code} ${r.j?.fehler ?? r.j?.grund ?? ''} ${r.j?.text ?? ''}`.trim());
  return r;
};

// Builds P0 in a new project named NAME (the slug must be free: loescheGrundprojekt() clears a leftover of an earlier run). Returns the slug.
export async function baueGrundprojekt(api) {
  const neu = erwarte200('/proj/neu', await api.ruf('POST', '/proj/neu', { name: NAME }));
  const slug = neu.j.slug ?? neu.j.projekt?.slug;
  if (slug !== SLUG) throw new Fehl(`/proj/neu gave slug ${slug}, expected ${SLUG}`);
  await api.warte(1500);
  const rev = async () => erwarte200('/proj/aktuell?nur=rev', await api.ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
  const aendern = async (label, befehle) => erwarte200(`/proj/aendern (${label})`, await api.ruf('POST', '/proj/aendern', { rev: await rev(), label, befehle }, CYPHER)).j;
  await aendern('I19 base tempo', [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: BEATS }]);
  await aendern('I19 base track', [{ befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern', name: 'rb338' } }]);
  const spurId = erwarte200('/proj/aktuell', await api.ruf('GET', '/proj/aktuell')).j.projekt.spuren[0].id;
  await aendern('I19 base clip', [{ befehl: 'clip_neu', spur_id: spurId, art: 'midi', start_beat: 0, laenge_beats: BEATS, name: 'Bass 8 bars', noten: grundNoten() }]);
  return slug;
}

// A hash over silence pins nothing: the export of P0 must carry signal (peak above -60 dBFS).
export const signalOk = (spitzeDb) => Number.isFinite(spitzeDb) && spitzeDb > -60;

// /proj/export of beats 0..32, abgriff production. Returns {sha256, regler_quelle, frames, abgriff, bytes, spitze_db, datei}.
export async function exportiere(api) {
  const r = erwarte200('/proj/export', await api.ruf('POST', '/proj/export', { von_beat: 0, bis_beat: BEATS, abgriff: 'produktion' }, CYPHER));
  if (!signalOk(r.j.spitze_db)) throw new Fehl(`export is silent or too quiet: spitze_db ${r.j.spitze_db}`);
  const bytes = fs.readFileSync(r.j.datei);
  return { spitze_db: r.j.spitze_db, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), regler_quelle: r.j.regler_quelle, frames: r.j.frames, abgriff: r.j.abgriff, bytes: bytes.length, datei: r.j.datei };
}

// Removes the project folder of an earlier run (only the exact slug of this script) from the shm tree of the instance.
export function loescheGrundprojekt(instanz) {
  if (!/^[bde]$/.test(instanz)) throw new Fehl(`instance ${instanz}: b, d or e only`);
  const d = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte', SLUG);
  if (!fs.existsSync(d)) return false;
  fs.rmSync(d, { recursive: true, force: true });
  return true;
}

// True when the running core of the instance was started from <bau>/cypherdj-kern (its /proc exe), so a hash recorded here belongs to that build.
export function kernExeStimmt(bau, instanz) {
  const pid = spawnSync('systemctl', ['--user', 'show', '-p', 'MainPID', '--value', `cypherdj-kern-${instanz}`], { encoding: 'utf8' }).stdout.trim();
  if (!/^[1-9][0-9]*$/.test(pid)) return { ok: false, text: `unit cypherdj-kern-${instanz} has no main pid` };
  let ist;
  try { ist = fs.realpathSync(`/proc/${pid}/exe`); } catch (e) { return { ok: false, text: `/proc/${pid}/exe: ${e.message}` }; }
  const soll = fs.realpathSync(path.join(bau, 'cypherdj-kern'));
  return { ok: ist === soll, text: ist === soll ? `core pid ${pid} runs ${ist}` : `core pid ${pid} runs ${ist}, expected ${soll}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: opt } = parseArgs({ options: { url: { type: 'string' }, bau: { type: 'string' }, instanz: { type: 'string' }, ausgabe: { type: 'string' } } });
  const aufruf = (t) => { process.stderr.write(`i19_grundprojekt: ${t}\n`); process.exit(2); };
  if (!opt.url || !opt.bau) aufruf('usage: --url <http://127.0.0.1:port> --bau <core build folder> [--instanz <b|d|e>] [--ausgabe <file.json>]');
  if (/:(47300|47100|47200)\b/.test(opt.url)) aufruf('never against the operation: choose a test instance');
  const port = Number(new globalThis.URL(opt.url).port), k = (port - 47300) / 1000;
  const instanz = opt.instanz ?? (Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined);
  if (!/^[bde]$/.test(instanz ?? '')) aufruf(`instance ${instanz ?? '?'} is not allowed: b, d or e only (never f)`);
  const api = erzeugeApi(opt.url);
  try {
    const exe = kernExeStimmt(path.resolve(opt.bau), instanz);
    if (!exe.ok) throw new Fehl(exe.text);
    process.stderr.write(`${exe.text}\n`);
    if (loescheGrundprojekt(instanz)) process.stderr.write(`removed leftover project ${SLUG}\n`);
    const slug = await baueGrundprojekt(api);
    const e = await exportiere(api);
    const aus = { sha256: e.sha256, regler_quelle: e.regler_quelle, frames: e.frames, abgriff: e.abgriff, bytes: e.bytes, spitze_db: e.spitze_db, slug };
    if (opt.ausgabe) fs.writeFileSync(opt.ausgabe, JSON.stringify(aus, null, 2) + '\n');
    process.stdout.write(JSON.stringify(aus) + '\n');
    loescheGrundprojekt(instanz);
    process.exit(0);
  } catch (e) {
    process.stderr.write(`i19_grundprojekt: FAIL ${e.message}\n`);
    process.exit(1);
  }
}
