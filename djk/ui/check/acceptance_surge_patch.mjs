// Acceptance, a Surge track stores its sound in the project (geraet.patch), on a TEST INSTANCE with the host of slot 1 (djk-start --instanz <b..i> --arr1; never the
// operation on 47300). Set-up (instance e): DJK=<worktree>/djk djk/start/djk-start --instanz e --arr1 ; then
//   node check/acceptance_surge_patch.mjs --url http://127.0.0.1:52300 --bau <kern build folder> [--ausgabe <folder>] [--patch "Pads/MKS-70 Warm Pad"]
// Points: P1 the host plays the factory Init Saw (no patch in the project) and the render of the track is the base. P2 a project whose track carries the patch: the host
// reports that patch in `zustand`, and the render differs from the base measurably (centroid, 1-5 kHz share, peak). P3 the project is closed and another patch
// is loaded into the host by hand, then the project is opened again: the host reports the patch again and the render equals the P2 render (same measures). P4 the patch
// is changed by command and undone: the host follows both ways. P5 negative control: a project without patch leaves a hand-loaded patch alone (no lade).
// Return: 0 all points OK, 1 at least one FEHL, 2 usage. Removes only its own project slugs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { erzeugeApi, exportiere, kernExeStimmt, grundNoten, BPM, BEATS } from './i19_base_project.mjs';
import { messeDatei } from './direction_measure.mjs';
import { wirtRuf } from '../track.ts';
import { wirtDatei, wirtLebt } from '../areas/proj/instrument_host.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, bau: { type: 'string' }, ausgabe: { type: 'string' }, patch: { type: 'string' }, andere: { type: 'string' } } });
const aufruf = (t) => { process.stderr.write(`abnahme_surge_patch: ${t}\n`); process.exit(2); };
if (!opt.url || !opt.bau) aufruf('usage: --url <http://127.0.0.1:port> --bau <kern build folder> [--ausgabe <folder>] [--patch <library name>] [--andere <library name>]');
if (/:(47300|47100|47200)\b/.test(opt.url)) aufruf('never against the operation (47300): choose a test instance');
const port = Number(new globalThis.URL(opt.url).port), kn = (port - 47300) / 1000;
const instanz = Number.isInteger(kn) && kn >= 1 && kn <= 9 ? String.fromCharCode(96 + kn) : undefined;
if (!/^[b-i]$/.test(instanz ?? '')) aufruf(`port ${port} is not a test instance (b..i)`);
const PATCH = opt.patch ?? 'Pads/MKS-70 Warm Pad', ANDERE = opt.andere ?? 'Templates/Init Saw';
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}-abnahme-surge-patch`);
fs.mkdirSync(ORDNER, { recursive: true });
const SHM = path.join('/dev/shm', `cypherdj-${instanz}`), WIRT_SOCK = path.join(SHM, 'wirt-arr1.sock');
const KLANG = path.resolve(HIER, '..', '..', 'hosts', 'carla', 'djk-klang');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let fehl = 0;
const notiere = (kz, ok, text) => { if (!ok) fehl++; process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}\n`); };
const CYPHER = { 'x-djk-quelle': 'cypher' };
const api = erzeugeApi(opt.url), ruf = api.ruf;
class Fehl extends Error {}
const grundVon = (r) => `${r.code} ${r.j?.fehler ?? ''}${r.j?.text ? `: ${r.j.text}` : ''}`.trim();
const erwarte200 = (weg, r) => { if (r.code !== 200) throw new Fehl(`${weg} -> ${grundVon(r)}`); return r; };
const aktuell = async () => erwarte200('/proj/aktuell', await ruf('GET', '/proj/aktuell')).j;
const holeRev = async () => (await aktuell()).projekt.rev;
const aendernRoh = async (label, befehle) => ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, CYPHER);
const aendern = async (label, befehle) => erwarte200(`aendern (${label})`, await aendernRoh(label, befehle)).j;
const bisWahr = async (f, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (await f()) return true; await warte(200); } return false; };
const warteGeladen = async () => { if (!(await bisWahr(async () => { const a = await aktuell(); return a.kern?.rev_geladen === a.projekt.wiedergabe_rev; }, 60000))) throw new Fehl('the core did not load the playback'); };
const klang = (...a) => spawnSync('python3', [KLANG, '--instanz', instanz, 'arr1', ...a], { encoding: 'utf8' });
// the patch name the host plays, from the state XML (<meta name="...">); null when it does not answer
const wirtName = async () => {
  const r = await wirtRuf(WIRT_SOCK, { befehl: 'zustand' }, 10000);
  if (!r.ok) return null;
  const m = /<meta\b[^>]*\bname="([^"]*)"/.exec(String(r.xml));
  return m ? m[1] : '?';
};
const wirtNameBis = (name) => bisWahr(async () => (await wirtName()) === name, 12000);
// the name a patch file carries inside (<meta name="...">): not always the file's stem (the factory file "Pads/MKS-70 Warm Pad" says "Buggy Brass")
const WERK = process.env.CYPHERDJ_SURGE_PATCHES ?? path.join(os.homedir(), '.local/share/cypherdj/surge-daten/usr/share/surge-xt/patches_factory');
const mkName = (lib) => {
  const d = fs.readFileSync(path.join(WERK, `${lib}.fxp`)).toString('latin1');
  const m = /<meta\b[^>]*\bname="([^"]*)"/.exec(d);
  if (!m) throw new Fehl(`no <meta name> in ${lib}`);
  return m[1];
};
const mess = { };
let zaehler = 0;
async function rendere(kz) {
  const spuren = (await aktuell()).projekt.spuren;
  const s = spuren.find((x) => x.geraet?.art === 'wirt');
  if (s.freeze) erwarte200('unfreeze', await ruf('POST', '/proj/freeze', { spur_id: s.id, an: false }, CYPHER));   // render the host as it is now, not an old freeze
  const e = await exportiere(api);
  const kopie = path.join(ORDNER, `${zwei(++zaehler)}-${kz}.wav`);
  fs.copyFileSync(e.datei, kopie);
  const m = messeDatei(kopie, BPM);
  mess[kz] = { sha: e.sha256, ...m };
  process.stdout.write(`INFO ${kz}: peak ${m.spitze.toFixed(4)}, centroid ${m.schwerpunkt_hz.toFixed(1)} Hz, 1-5 kHz ${m.band_1_5k_db.toFixed(2)} dB, <120 Hz ${m.band_unter_120_db.toFixed(2)} dB, sha ${e.sha256.slice(0, 12)}\n`);
  return mess[kz];
}
const neuesProjekt = async (name, geraet) => {
  const neu = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name }));
  await warte(1000);
  await aendern(`${name} tempo`, [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: BEATS }]);
  await aendern(`${name} track`, [{ befehl: 'spur_neu', art: 'instrument', name: 'Pad', geraet }]);
  const id = (await aktuell()).projekt.spuren[0].id;
  await aendern(`${name} clip`, [{ befehl: 'clip_neu', spur_id: id, art: 'midi', start_beat: 0, laenge_beats: BEATS, name: 'Pad 8 bars', noten: grundNoten() }]);
  await warteGeladen();
  return { id, slug: neu.j.slug ?? neu.j.projekt?.slug };
};
const rel = (a, b) => 100 * (a - b) / b;

async function lauf() {
  const exe = kernExeStimmt(path.resolve(opt.bau), instanz);
  notiere('P0a', exe.ok, exe.text);
  if (!exe.ok) throw new Fehl('not the build under test');
  notiere('P0b', wirtLebt(wirtDatei(SHM, 1)), `the Surge host of slot 1 is alive (${wirtDatei(SHM, 1)})`);
  for (const s of ['pad-ohne', 'pad-mit']) fs.rmSync(path.join(SHM, 'projekte', s), { recursive: true, force: true });
  // P1: the factory state, a track without patch
  const l = klang('lade', 'Templates/Init Saw');
  if (l.status !== 0) throw new Fehl(`klang lade -> ${l.stderr || l.stdout}`);
  notiere('P1a', await wirtNameBis(mkName('Templates/Init Saw')), `the host plays the factory Init Saw (state name ${await wirtName()})`);
  const ohne = await neuesProjekt('pad-ohne', { art: 'wirt', name: 'surge', slot: 1 });
  const rInit = await rendere('init-saw-ohne-patch');
  notiere('P1b', (await wirtName()) === mkName('Templates/Init Saw'), `a track without patch leaves the host alone: it still plays ${await wirtName()}`);
  // P2: a project that carries the patch
  const mit = await neuesProjekt('pad-mit', { art: 'wirt', name: 'surge', slot: 1, patch: PATCH });
  notiere('P2a', await wirtNameBis(mkName(PATCH)), `the host reports ${JSON.stringify(await wirtName())} after the track with patch "${PATCH}" was made`);
  const rMit = await rendere('mit-patch');
  const dz = rel(rMit.schwerpunkt_hz, rInit.schwerpunkt_hz), db15 = rMit.band_1_5k_db - rInit.band_1_5k_db, dsp = rel(rMit.spitze, rInit.spitze);
  notiere('P2b', rMit.sha !== rInit.sha && (Math.abs(dz) >= 10 || Math.abs(db15) >= 1.5),
    `the render differs from the Init Saw render: centroid ${rInit.schwerpunkt_hz.toFixed(1)} -> ${rMit.schwerpunkt_hz.toFixed(1)} Hz (${dz.toFixed(1)} %), 1-5 kHz share ${db15.toFixed(2)} dB, peak ${dsp.toFixed(1)} %`);
  // the host does not render bit for bit the same twice (unison and voice phases): the same state rendered again gives the noise floor of the comparison in P3c
  const rNoch = await rendere('mit-patch-nochmal');
  const rauschen = { dz: Math.abs(rel(rNoch.schwerpunkt_hz, rMit.schwerpunkt_hz)), db: Math.abs(rNoch.band_1_5k_db - rMit.band_1_5k_db) };
  notiere('P2c', rauschen.dz < 3 && rauschen.db < 0.5 && rNoch.sha !== rInit.sha, `control: the same state rendered twice differs by centroid ${rauschen.dz.toFixed(2)} %, 1-5 kHz ${rauschen.db.toFixed(2)} dB (the noise floor of P3c)`);
  // P3: close (open the other project), load another patch into the host by hand, open the project again
  erwarte200('/proj/oeffnen ohne', await ruf('POST', '/proj/oeffnen', { slug: ohne.slug }, CYPHER));
  await warte(1500);
  const a = klang('lade', ANDERE);
  if (a.status !== 0) throw new Fehl(`klang lade ${ANDERE} -> ${a.stderr || a.stdout}`);
  const nameAndere = mkName(ANDERE);
  notiere('P3a', (await wirtNameBis(nameAndere)) && (await wirtName()) !== mkName(PATCH), `after the close and a hand load the host plays ${JSON.stringify(await wirtName())}`);
  erwarte200('/proj/oeffnen mit', await ruf('POST', '/proj/oeffnen', { slug: mit.slug }, CYPHER));
  await warteGeladen();
  notiere('P3b', await wirtNameBis(mkName(PATCH)), `after opening the project the host reports ${JSON.stringify(await wirtName())} again`);
  const rNeu = await rendere('wieder-geoeffnet');
  const gleich = Math.abs(rel(rNeu.schwerpunkt_hz, rMit.schwerpunkt_hz)) < 3 && Math.abs(rNeu.band_1_5k_db - rMit.band_1_5k_db) < 0.5;
  const vonInit = Math.abs(rel(rNeu.schwerpunkt_hz, rInit.schwerpunkt_hz)) >= 10 || Math.abs(rNeu.band_1_5k_db - rInit.band_1_5k_db) >= 1.5;
  notiere('P3c', gleich && vonInit, `the reopened render equals the P2 render within the noise floor (centroid ${rNeu.schwerpunkt_hz.toFixed(1)} vs ${rMit.schwerpunkt_hz.toFixed(1)} Hz, 1-5 kHz ${rNeu.band_1_5k_db.toFixed(2)} vs ${rMit.band_1_5k_db.toFixed(2)} dB) and not the Init Saw one`);
  // P4: change the patch by command, undo
  const s = (await aktuell()).projekt.spuren[0];
  await aendern('patch Init', [{ befehl: 'spur_aendern', spur_id: s.id, geraet: { ...s.geraet, patch: 'Templates/Init Saw' } }]);
  notiere('P4a', await wirtNameBis(mkName('Templates/Init Saw')), `the patch command loads it: the host reports ${JSON.stringify(await wirtName())}`);
  erwarte200('/proj/undo', await ruf('POST', '/proj/undo', { rev: await holeRev() }, CYPHER));
  notiere('P4b', await wirtNameBis(mkName(PATCH)), `undo brings the old patch back: the host reports ${JSON.stringify(await wirtName())}`);
  const nix = await aendernRoh('patch nope', [{ befehl: 'spur_aendern', spur_id: s.id, geraet: { ...s.geraet, patch: 'Pads/Nope' } }]);
  notiere('P4c', nix.code === 404 && nix.j?.fehler === 'patch_unbekannt', `an unknown patch -> ${grundVon(nix)}`);
  // P5: negative control, a project without patch does not touch a hand-loaded patch
  erwarte200('/proj/oeffnen ohne', await ruf('POST', '/proj/oeffnen', { slug: ohne.slug }, CYPHER));
  await warte(1500);
  klang('lade', ANDERE);
  await wirtNameBis(nameAndere);
  await aendern('touch', [{ befehl: 'spur_aendern', spur_id: ohne.id, name: 'Pad 2' }]);
  await warte(1500);
  notiere('P5', (await wirtName()) === nameAndere, `a project without patch left the hand-loaded ${JSON.stringify(await wirtName())} alone`);
  klang('lade', 'Templates/Init Saw');
}
try { await lauf(); } catch (e) { notiere('ABORT', false, e instanceof Fehl ? e.message : (e.stack ?? String(e))); }
for (const sl of ['pad-ohne', 'pad-mit']) fs.rmSync(path.join(SHM, 'projekte', sl), { recursive: true, force: true });
fs.writeFileSync(path.join(ORDNER, 'messung.json'), JSON.stringify(mess, null, 2));
process.stdout.write(`\n${fehl === 0 ? 'ALL OK' : `${fehl} FEHL`}\n`);
process.exit(fehl === 0 ? 0 : 1);
