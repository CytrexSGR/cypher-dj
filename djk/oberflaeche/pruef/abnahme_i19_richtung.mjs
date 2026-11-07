// Acceptance, package 1.9 U4 (description to sound on the RB-338, O28): AK-O1, AK-O2, AK-O3, AK-O4, AK-O6 and the base-project negative control, on a TEST INSTANCE with the
// freshly built core (instances b, d or e only, never f, never the operation; the script refuses every other letter). Set-up (instance e, silent sink, no --ton-frei):
//   CYPHERDJ_KATALOG=<empty catalog> DJK=<worktree>/djk djk/start/djk-start --instanz e --kit-ordner <kits>
//   flock <CYPHERDJ_ECHTZEIT_SCHLOSS> node pruef/abnahme_i19_richtung.mjs --url http://127.0.0.1:52300 --bau <kern build folder> [--grund <u0-grundprojekt.json>] [--ausgabe <folder>] \
//        [--nur S,N0,O1,O2,O4,O6]
// The fixed 8-bar bass is the base project P0 of U0 (pruef/i19_grundprojekt.mjs: one RB-338 track, 128 sixteenth notes, 120 BPM, default parameters). Every export is the offline render of
// /proj/export (abgriff produktion, beats 0..32), measured by pruef/richtung_messen.mjs.
// Points (each with its measured value):
//   S   set-up: the running core is <bau>/cypherdj-kern; GET /presets/suche/schema answers.
//   N0  negative control: P0 exported on this build has the sha256 and regler_quelle recorded in u0-grundprojekt.json (U0, main 8afd2d88).
//   O1  AK-O1: for each word of the table with staerke 1 the render after geraet_richtung moves the measured quantity of the word in its direction by at least the minimum of spec 4.3
//       (bright/dark centroid +-10 %, aggressive/soft share 1-5 kHz +-1.5 dB, tight late-half share of the energy above 1 kHz -0.3 dB (ledger D57), deep share below 120 Hz +1 dB (ledger D58)). staerke 2 and 3 are measured too
//       (information, with the same undo check). Negative control: an unchanged project exported twice reads a move of exactly 0, which no gate accepts.
//   O3  AK-O3: after proj_undo the render is bit-equal to the render before (every word, every staerke).
//   O2  AK-O2: an unknown word is refused richtung_unbekannt (404) with the list of the words, staerke 0 and 4 are refused (400), rev and render stay unchanged.
//   O4  AK-O4: bright with staerke 3 repeated until it answers richtung_grenze (409): every state stays within 0..1, the refused call changes nothing, then all steps undone give the base render.
//   O6  AK-O6: POST /presets/suche {art: [bass], charakter: [dark]} lists werk:rb338/dark-dub; preset_anwenden puts its values on the track; the cutoff of the playback file the core loaded,
//       mapped by the inverse of rb_dsp Def::wert (pinned against the Rust crate by tests/projekt_rb_abbildung.test.mjs), is 200 Hz within 0.5 %; the render is darker than the default.
// --surge (1.9 U5, O28 on Surge): the same words on a Surge track of slot 1 (needs the host: djk-start --instanz <i> --arr1). Points SS (set-up: the host plays the test sound
//   Templates/Init Saw with cutoff 24, resonance 0.5, sustain 0.3, loaded and set with djk-klang), SW (--sweep: the measured sweeps behind the step sizes, information only), S1 (AK-O1: per word the move of the
//   quantity on the frozen render, staerke 1 gated, 2 and 3 information; the host value read back with `ist`), S3 (AK-O3: undo brings the project and the HOST back; a fresh freeze of the undone project measures
//   like the base), S2 (AK-O2), S4 (AK-O4 on the Surge range), S5 (AK-O5: out of band the host is moved away; reopening the project brings the project values back, read with `zustand`).
//   node pruef/abnahme_i19_richtung.mjs --surge --url ... --bau ... [--ausgabe <folder>] [--nur SS,SW,S1,S2,S3,S4,S5] [--sweep]
// Return: 0 all points OK, 1 at least one FEHL, 2 usage. Only the project slug i19-grund is removed; nothing is written outside <ausgabe>, /dev/shm/cypherdj-<i> and the scratch of the points.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { erzeugeApi, baueGrundprojekt, exportiere, loescheGrundprojekt, kernExeStimmt, SLUG, BPM } from './i19_grundprojekt.mjs';
import { messeDatei, bewegung, MESSUNG, MESSUNG_SURGE } from './richtung_messen.mjs';
import { grundNoten } from './i19_grundprojekt.mjs';
import { wirtRuf } from '../spur.ts';
import { wirtDatei, wirtLebt } from '../bereiche/proj/wirt.ts';
import { SURGE_RICHTUNGEN } from '../projekt/richtung.ts';
import { normZuWert } from '../projekt/rb_abbildung.ts';
import { RICHTUNGEN } from '../projekt/richtung.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, bau: { type: 'string' }, grund: { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string' }, nur: { type: 'string' }, surge: { type: 'boolean' }, sweep: { type: 'boolean' } } });
const aufruf = (t) => { process.stderr.write(`abnahme_i19_richtung: ${t}\n`); process.exit(2); };
if (!opt.url || !opt.bau) {
  aufruf('usage: --url <http://127.0.0.1:port> --bau <kern build folder> [--grund <u0-grundprojekt.json>] [--ausgabe <folder>] [--instanz <b|d|e>] [--nur S,N0,O1,O2,O4,O6] [--surge [--sweep]]');
}
if (opt.sweep && !opt.surge) aufruf('--sweep needs --surge');
if (/:(47300|47100|47200)\b/.test(opt.url)) aufruf('never against the operation (47300): choose a test instance');
const port = Number(new globalThis.URL(opt.url).port), kn = (port - 47300) / 1000;
const instanz = opt.instanz ?? (Number.isInteger(kn) && kn >= 1 && kn <= 9 ? String.fromCharCode(96 + kn) : undefined);
if (!/^[bde]$/.test(instanz ?? '')) aufruf(`instance ${instanz ?? '?'} (port ${port}) is not allowed: b, d or e only (never f)`);
const BAU = path.resolve(opt.bau);
const NUR = opt.nur ? new Set(opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-i19-richtung`);
fs.mkdirSync(ORDNER, { recursive: true });
const ARBEIT = path.join(os.homedir(), '.cache', `cypherdj-${instanz}`, 'arr');

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
const aendernRoh = async (label, befehle) => ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, CYPHER);
const aendern = async (label, befehle) => erwarte200(`/proj/aendern (${label})`, await aendernRoh(label, befehle)).j;
const undo = async () => erwarte200('/proj/undo', await ruf('POST', '/proj/undo', { rev: await holeRev() }, CYPHER)).j;
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const fmt = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));
const sha256Datei = (d) => crypto.createHash('sha256').update(fs.readFileSync(d)).digest('hex');
const geladen = async () => { const a = await aktuell(); return a.kern?.rev_geladen === a.projekt.wiedergabe_rev; };
const warteGeladen = async () => {
  if (!(await bisWahr(geladen, 60000))) throw new Fehl('the core did not load the playback (kern.rev_geladen = projekt.wiedergabe_rev never came)');
};
const spur = async () => (await aktuell()).projekt.spuren.find((s) => s.art === 'instrument');
const parameter = async () => structuredClone((await spur()).geraet.parameter);

// one offline render of P0 as it is now: copy of the WAV into the report folder, its sha256 and its measurement
let zaehler = 0;
async function rendere(kz) {
  const e = await exportiere(api);
  const kopie = path.join(ORDNER, `${String(++zaehler).padStart(2, '0')}-${kz}.wav`);
  fs.copyFileSync(e.datei, kopie);
  const m = messeDatei(kopie, BPM);
  return { sha: e.sha256, m, kopie, datei: e.datei };
}
const kurz = (m) => `centroid ${fmt(m.schwerpunkt_hz)} Hz, 1-5 kHz ${fmt(m.band_1_5k_db)} dB, <120 Hz ${fmt(m.band_unter_120_db)} dB, late-half ${fmt(m.abkling_db)} dB`;

let spurId = null;
let basis = null;      // the render of P0 before any direction command
const WORTE = Object.keys(RICHTUNGEN.rb338);

// ---- the points ----------------------------------------------------------------------------------------------------------------------------------------------

async function aufbau() {
  const exe = kernExeStimmt(BAU, instanz);
  notiere('S1', exe.ok, exe.text);
  const s = await ruf('GET', '/presets/suche/schema');
  notiere('S2', s.code === 200 && s.j?.name === 'presets_suchen', `GET /presets/suche/schema -> ${s.code} ${s.j?.name}`);
  if (loescheGrundprojekt(instanz)) info(`removed leftover project ${SLUG}`);
  await baueGrundprojekt(api);
  await warteGeladen();
  spurId = (await spur()).id;
  basis = await rendere('basis');
  info(`P0 base render (sha256 ${basis.sha}, spitze via export): ${kurz(basis.m)}`);
  notiere('S3', Object.keys(await parameter()).length === 0, `P0 holds default parameters (${JSON.stringify(await parameter())}) on track ${spurId}`);
}

async function n0() {
  if (!opt.grund) { info('N0 not run: no --grund file'); return; }
  const g = JSON.parse(fs.readFileSync(path.resolve(opt.grund), 'utf8'));
  notiere('N0', basis.sha === g.sha256, `P0 export on this build sha256 ${basis.sha.slice(0, 16)}.. vs U0 record ${g.sha256.slice(0, 16)}.. (${g.base})`);
}

async function o1() {
  const tabelle = [];
  for (const wort of WORTE) {
    const zeile = { wort };
    for (const staerke of [1, 2, 3]) {
      const rev0 = await holeRev();
      const r = await aendernRoh(`${wort} Bass`, [{ befehl: 'geraet_richtung', spur_id: spurId, wort, staerke }]);
      if (r.code !== 200) { notiere(`O1 ${wort} ${staerke}`, false, `geraet_richtung -> ${grundVon(r)}`); continue; }
      const rev1 = await holeRev();
      await warteGeladen();
      const nach = await rendere(`${wort}-${staerke}`);
      const b = bewegung(wort, basis.m, nach.m);
      zeile[`s${staerke}`] = b.wert;
      const p = await parameter();
      const kz = `O1 ${wort} staerke ${staerke}`;
      const text = `${wort} (${Object.entries(p).map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}): ${b.feld} moves ${fmt(b.wert)} ${b.einheit} (gate ${MESSUNG[wort].vorzeichen > 0 ? '+' : '-'}${b.min} ${b.einheit}); rev ${rev0} -> ${rev1}; ${kurz(nach.m)}`;
      if (staerke === 1) notiere(kz, b.ok && rev1 === rev0 + 1, text); else info(`${kz}: ${text}${b.ok ? '' : ' (below the gate of staerke 1)'}`);
      await undo();
      await warteGeladen();
      const zurueck = await rendere(`${wort}-${staerke}-undo`);
      notiere(`O3 ${wort} staerke ${staerke}`, zurueck.sha === basis.sha && (await holeRev()) === rev1 + 1,
        `after proj_undo the render sha256 ${zurueck.sha.slice(0, 16)}.. ${zurueck.sha === basis.sha ? 'equals' : 'DIFFERS from'} the base ${basis.sha.slice(0, 16)}..; parameters ${JSON.stringify(await parameter())}`);
    }
    tabelle.push(zeile);
  }
  info(`O1 measured move per word [staerke 1, 2, 3]: ${tabelle.map((z) => `${z.wort} ${[z.s1, z.s2, z.s3].map((v) => (v === undefined ? '-' : fmt(v))).join(' / ')} ${MESSUNG[z.wort].einheit === 'prozent' ? '%' : 'dB'}`).join('; ')}`);
  // negative control: two renders of the unchanged project move nothing
  const nochmal = await rendere('basis-nochmal');
  const nullBewegung = WORTE.map((w) => bewegung(w, basis.m, nochmal.m));
  notiere('O1c', nochmal.sha === basis.sha && nullBewegung.every((b) => b.wert === 0 && !b.ok),
    `negative control: the unchanged project rendered again has sha256 ${nochmal.sha === basis.sha ? 'equal' : 'DIFFERENT'} and a move of 0 for every word (no gate accepts it)`);
}

async function o2() {
  const rev0 = await holeRev();
  const p0 = await parameter();
  const unbekannt = await aendernRoh('warm Bass', [{ befehl: 'geraet_richtung', spur_id: spurId, wort: 'warm' }]);
  const liste = String(unbekannt.j?.detail ?? '');
  notiere('O2a', unbekannt.code === 404 && unbekannt.j?.fehler === 'richtung_unbekannt' && WORTE.every((w) => liste.includes(w)) && (await holeRev()) === rev0,
    `unknown word "warm" -> ${unbekannt.code} ${unbekannt.j?.fehler}; detail "${liste}"; rev ${rev0} -> ${await holeRev()}`);
  const schlecht = [];
  for (const staerke of [0, 4]) {
    const r = await aendernRoh('dark Bass', [{ befehl: 'geraet_richtung', spur_id: spurId, wort: 'dark', staerke }]);
    schlecht.push(`staerke ${staerke} -> ${r.code} ${r.j?.fehler}`);
    if (r.code !== 400 || r.j?.fehler !== 'argument_ungueltig') notiere(`O2b staerke ${staerke}`, false, grundVon(r));
  }
  notiere('O2b', (await holeRev()) === rev0 && JSON.stringify(await parameter()) === JSON.stringify(p0), `bad staerke: ${schlecht.join(', ')}; rev and parameters unchanged`);
  const nach = await rendere('nach-ablehnung');
  notiere('O2c', nach.sha === basis.sha, `the render after the refusals is bit-equal to the base (${nach.sha.slice(0, 16)}..)`);
  // negative control: a harmless word right after is accepted (the refusals did not lock anything)
  const ok = await aendernRoh('dark Bass', [{ befehl: 'geraet_richtung', spur_id: spurId, wort: 'dark' }]);
  notiere('O2d', ok.code === 200, `negative control: "dark" right after the refusals -> ${ok.code}`);
  await undo();
}

async function o4() {
  const wort = 'bright';
  let n = 0, letzte = null, ok = true, schlechtesWert = null;
  const revVor = [];
  for (let i = 0; i < 40; i += 1) {
    const rev0 = await holeRev();
    const r = await aendernRoh(`${wort} Bass`, [{ befehl: 'geraet_richtung', spur_id: spurId, wort, staerke: 3 }]);
    if (r.code !== 200) { letzte = { r, rev0 }; break; }
    n += 1;
    revVor.push(rev0);
    for (const [k, v] of Object.entries(await parameter())) if (!(v >= 0 && v <= 1)) { ok = false; schlechtesWert = `${k}=${v}`; }
  }
  const p = await parameter();
  notiere('O4a', letzte !== null && letzte.r.code === 409 && letzte.r.j?.fehler === 'richtung_grenze' && (await holeRev()) === letzte.rev0,
    `${n} calls with staerke 3 were accepted, the next one -> ${letzte ? grundVon(letzte.r) : 'never refused'}; rev stays ${await holeRev()}`);
  notiere('O4b', ok && p.cutoff === 1 && p.env_mod === 1, `every state stayed within 0..1${schlechtesWert ? ` (violated: ${schlechtesWert})` : ''}; at the bound ${JSON.stringify(p)}`);
  await warteGeladen();
  const amGrenze = await rendere('grenze');
  info(`O4 render at the bound: ${kurz(amGrenze.m)}`);
  for (let i = 0; i < n; i += 1) await undo();
  await warteGeladen();
  const zurueck = await rendere('grenze-undo');
  notiere('O4c', zurueck.sha === basis.sha && Object.keys(await parameter()).length === 0, `${n} undo steps give the base render again (sha256 ${zurueck.sha.slice(0, 16)}.. ${zurueck.sha === basis.sha ? 'equal' : 'DIFFERENT'}), parameters ${JSON.stringify(await parameter())}`);
}

async function o6() {
  const s = await ruf('POST', '/presets/suche', { art: ['bass'], charakter: ['dark'] }, CYPHER);
  const ids = (s.j?.treffer ?? []).map((t) => t.id);
  notiere('O6a', s.code === 200 && ids.includes('werk:rb338/dark-dub'), `POST /presets/suche {art: [bass], charakter: [dark]} -> ${s.code}, ${s.j?.gesamt} hits: ${ids.join(', ')}`);
  // negative control: a character word that no bass preset has (and one that is not in the vocabulary) does not list it
  const anders = await ruf('POST', '/presets/suche', { art: ['bass'], charakter: ['bright'] }, CYPHER);
  notiere('O6b', anders.code === 200 && !(anders.j?.treffer ?? []).some((t) => t.id === 'werk:rb338/dark-dub'), `negative control: charakter [bright] -> ${anders.code}, ${anders.j?.gesamt} hits, dark-dub not among them`);
  const rev0 = await holeRev();
  await aendern('Apply preset dark-dub', [{ befehl: 'preset_anwenden', spur_id: spurId, preset: 'werk:rb338/dark-dub' }]);
  await warteGeladen();
  const a = await aktuell();
  const sp = a.projekt.spuren.find((x) => x.id === spurId);
  const norm = sp.geraet.parameter.cutoff;
  const hz = normZuWert('cutoff', norm);
  const dat = path.join(ARBEIT, `wiedergabe-${a.kern.rev_geladen}.json`);
  let imKern = null;
  try { imKern = JSON.parse(fs.readFileSync(dat, 'utf8')).spuren.find((x) => x.geraet === 'rb338')?.parameter?.cutoff; } catch (e) { info(`playback file ${dat}: ${e.message}`); }
  notiere('O6c', Math.abs(hz / 200 - 1) <= 0.005 && imKern === norm,
    `cutoff in the project ${fmt(norm)} -> ${fmt(hz)} Hz (deviation ${fmt(100 * (hz / 200 - 1))} %, gate 0.5 %); the playback file the core loaded (${path.basename(dat)}, rev_geladen ${a.kern.rev_geladen}) holds ${imKern}; all parameters ${JSON.stringify(sp.geraet.parameter)}`);
  const mit = await rendere('preset');
  const b = bewegung('dark', basis.m, mit.m);
  notiere('O6d', b.ok, `the preset render is darker than the default: centroid ${fmt(basis.m.schwerpunkt_hz)} -> ${fmt(mit.m.schwerpunkt_hz)} Hz (${fmt(b.wert)} %)`);
  await undo();
  await warteGeladen();
  const zurueck = await rendere('preset-undo');
  notiere('O6e', zurueck.sha === basis.sha && (await holeRev()) >= rev0, `proj_undo of preset_anwenden gives the base render again (sha256 ${zurueck.sha.slice(0, 16)}.. ${zurueck.sha === basis.sha ? 'equal' : 'DIFFERENT'})`);
  // refusals leave the project alone
  const rev1 = await holeRev();
  const unbekanntes = await aendernRoh('x', [{ befehl: 'preset_anwenden', spur_id: spurId, preset: 'werk:rb338/gibt-es-nicht' }]);
  notiere('O6f', unbekanntes.code === 404 && unbekanntes.j?.fehler === 'preset_unbekannt' && (await holeRev()) === rev1, `unknown preset -> ${grundVon(unbekanntes)}; rev ${rev1} -> ${await holeRev()}`);
}


// ---- Surge (1.9 U5) ---------------------------------------------------------------------------------------------------------------------------------------------

const SURGE_SLUG = 'i19-surge';
const KLANG = path.resolve(HIER, '..', '..', 'wirte', 'carla', 'djk-klang');
const SHM = path.join('/dev/shm', `cypherdj-${instanz}`);
const WIRT_SOCK = path.join(SHM, 'wirt-arr1.sock');
// the test sound: the factory patch Init Saw (one saw voice, low-pass 12 dB) with the values the words move FROM. Cutoff 24 semitones (about 1.7 kHz) puts the filter
// where the 1-5 kHz share and the centroid react, resonance 0.5 lets `soft` move down as well as `aggressive` up, sustain 0.3 and a slow decay (-1 = 0.5 s; measured 2026-11-05: at decay -2 the late-half share does not fall with a shorter decay, the envelope is already at sustain)
// leave the tail long, so `tight` has a tail to shorten.
const KLANG_AUSGANG = { a_filter1_cutoff: 24, a_filter1_resonance: 0.5, a_env1_sustain: 0.3, a_env1_decay: -1, a_env1_release: -4 };
const klangBefehl = (...args) => spawnSync('python3', [KLANG, '--instanz', instanz, ...args], { encoding: 'utf8' });
const wirtIst = async (namen) => {
  const r = await wirtRuf(WIRT_SOCK, { befehl: 'ist', namen });
  if (!r.ok) throw new Fehl(`host ist ${namen.join(',')} -> ${r.fehler}`);
  return r.werte;
};
// the value in the plugin state (what Surge really plays), read with `zustand`: the XML of the state
const wirtZustand = async (name) => {
  const r = await wirtRuf(WIRT_SOCK, { befehl: 'zustand' }, 10000);
  if (!r.ok) throw new Fehl(`host zustand -> ${r.fehler}`);
  const m = new RegExp(`<${name}\\s[^>]*?value="([^"]*)"`).exec(String(r.xml));
  if (!m) throw new Fehl(`zustand: ${name} not in the state XML`);
  return Number(m[1]);
};
// the plugin state is the host's own float: Carla steps the normalised value, so a state read differs from the driven display value by up to about 0.03 (cutoff 24 reads 23.98)
const fast = (a, b, eps = 0.1) => Math.abs(a - b) <= eps;
let surgeId = null;
let sBasis = null;           // the render of the Surge project before any word
let sSpuren = null;          // canonical tracks of the base project (the state an undo must restore)
const sWorte = Object.keys(SURGE_RICHTUNGEN);
const kanonSpuren = async () => JSON.stringify((await aktuell()).projekt.spuren.map((x) => ({ ...x, freeze: undefined })));

async function surgeAufbau() {
  const exe = kernExeStimmt(BAU, instanz);
  notiere('SS1', exe.ok, exe.text);
  if (!exe.ok) throw new Fehl(`the core on ${opt.url} is not the build under test: nothing is touched`);   // before any command reaches a host
  notiere('SS2', wirtLebt(wirtDatei(SHM, 1)), `the Surge host of slot 1 is alive (${wirtDatei(SHM, 1)})`);
  const l = klangBefehl('arr1', 'lade', 'Templates/Init Saw');
  if (l.status !== 0) throw new Fehl(`djk-klang lade -> ${l.stderr || l.stdout}`);
  // Init Saw ships with filter 1 OFF (type 0, measured 2026-11-05: cutoff -40..70 renders identically); type 1 is the low-pass the words move
  const t = klangBefehl('arr1', 'setze', 'a_filter1_type=1');
  if (t.status !== 0) throw new Fehl(`djk-klang setze a_filter1_type -> ${t.stderr || t.stdout}`);
  for (const [n, v] of Object.entries(KLANG_AUSGANG)) {
    const f = klangBefehl('arr1', 'fahre', n, String(v), '0');
    if (f.status !== 0) throw new Fehl(`djk-klang fahre ${n} -> ${f.stderr || f.stdout}`);
  }
  await warte(1500);
  const ist = await wirtIst(Object.keys(KLANG_AUSGANG));
  notiere('SS3', Object.entries(KLANG_AUSGANG).every(([n, v]) => fast(ist[n], v)), `the host plays the test sound: ${JSON.stringify(ist)}`);
  const zust = await wirtZustand('a_filter1_cutoff');
  notiere('SS4', fast(zust, 24), `negative control for the reader: the plugin state (zustand) shows cutoff ${zust}, not only the driven cache`);
  const dir = path.join(SHM, 'projekte', SURGE_SLUG);
  if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); info(`removed leftover project ${SURGE_SLUG}`); }
  const neu = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: 'i19 surge' }));
  if ((neu.j.slug ?? neu.j.projekt?.slug) !== SURGE_SLUG) throw new Fehl(`/proj/neu gave another slug than ${SURGE_SLUG}`);
  await warte(1500);
  await aendern('I19 surge tempo', [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 32 }]);
  await aendern('I19 surge track', [{ befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: { art: 'wirt', name: 'surge' } }]);
  surgeId = (await aktuell()).projekt.spuren[0].id;
  await aendern('I19 surge clip', [{ befehl: 'clip_neu', spur_id: surgeId, art: 'midi', start_beat: 0, laenge_beats: 32, name: 'Lead 8 bars', noten: grundNoten() }]);
  await warteGeladen();
  sBasis = await rendere('surge-basis');
  info(`Surge base render (sha256 ${sBasis.sha.slice(0, 16)}..): ${kurz(sBasis.m)}`);
  sSpuren = await kanonSpuren();
}

const mapVon = async () => structuredClone((await aktuell()).projekt.spuren.find((x) => x.id === surgeId).geraet.parameter ?? {});
// undo until the tracks equal the base again (a render in between adds a freeze step, which is undone first); returns the number of steps
async function zurueckZuBasis(max = 6) {
  let n = 0;
  while ((await kanonSpuren()) !== sSpuren && n < max) { await undo(); n += 1; }
  return n;
}
async function wartePegel(namen, soll, ms = 4000) {
  let ist = {};
  for (let t = 0; t < ms; t += 100) {
    ist = await wirtIst(namen);
    if (namen.every((n) => fast(ist[n], soll[n], 1e-4))) return { ok: true, ist };   // `ist` is the driven value: exact
    await warte(100);
  }
  return { ok: false, ist };
}

async function surgeSweep() {
  const lauf = async (kz, parameter) => {
    erwarte200(`sweep ${kz}`, await aendernRoh(`sweep ${kz}`, [{ befehl: 'spur_aendern', spur_id: surgeId, geraet: { art: 'wirt', name: 'surge', parameter } }]));
    await warteGeladen();
    const r = await rendere(`sweep-${kz}`);
    info(`SW ${kz} ${JSON.stringify(parameter)}: ${kurz(r.m)}; vs base: centroid ${fmt((r.m.schwerpunkt_hz / sBasis.m.schwerpunkt_hz - 1) * 100)} %, 1-5 kHz ${fmt(r.m.band_1_5k_db - sBasis.m.band_1_5k_db)} dB, late-half all ${fmt(r.m.abkling_db - sBasis.m.abkling_db)} dB`);
  };
      for (const d of [0.5, 1, 1.5, 2, 3]) await lauf(`tight-${d}`, { a_env1_decay: -1 - d, a_env1_release: -4 - d });
  for (const d of [1, 2]) await lauf(`decay-${d}`, { a_env1_decay: -1 - d });
  for (const d of [1, 2]) await lauf(`release-${d}`, { a_env1_release: -4 - d });
  for (const v of [0.15, 0.1]) await lauf(`sustain-${v}`, { a_env1_sustain: v });
  erwarte200('sweep end', await aendernRoh('sweep end', [{ befehl: 'spur_aendern', spur_id: surgeId, geraet: { art: 'wirt', name: 'surge' } }]));
  await warteGeladen();
}

async function s1() {
  const tabelle = [];
  for (const wort of sWorte) {
    const zeile = { wort };
    for (const staerke of [1, 3]) {
      const rev0 = await holeRev();
      const r = await aendernRoh(`${wort} Lead`, [{ befehl: 'geraet_richtung', spur_id: surgeId, wort, staerke }]);
      if (r.code !== 200) { notiere(`S1 ${wort} ${staerke}`, false, `geraet_richtung -> ${grundVon(r)}`); continue; }
      const map = await mapVon();
      await warteGeladen();
      const host = await wartePegel(Object.keys(map), map);
      const nach = await rendere(`surge-${wort}-${staerke}`);
      const b = bewegung(wort, sBasis.m, nach.m, MESSUNG_SURGE);
      zeile[`s${staerke}`] = b.wert;
      const text = `${wort} (${Object.entries(map).map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}): ${b.feld} moves ${fmt(b.wert)} ${b.einheit} (gate ${MESSUNG_SURGE[wort].vorzeichen > 0 ? '+' : '-'}${b.min} ${b.einheit}); host ${host.ok ? 'plays the map' : `DOES NOT play the map (${JSON.stringify(host.ist)})`}; ${kurz(nach.m)}`;
      if (staerke === 1) notiere(`S1 ${wort}`, b.ok && host.ok && (await holeRev()) > rev0, text); else info(`S1 ${wort} staerke ${staerke}: ${text}${b.ok ? '' : ' (below the gate of staerke 1)'}`);
      const schritte = await zurueckZuBasis();
      const hostNach = await wartePegel(Object.keys(KLANG_AUSGANG), KLANG_AUSGANG);
      notiere(`S3 ${wort} staerke ${staerke}`, schritte >= 1 && hostNach.ok && Object.keys(await mapVon()).length === 0,
        `${schritte} undo steps give the base project again; the host plays its own values again: ${JSON.stringify(hostNach.ist)}`);
    }
    tabelle.push(zeile);
  }
  info(`S1 measured move per word [staerke 1, 3]: ${tabelle.map((z) => `${z.wort} ${[z.s1, z.s3].map((v) => (v === undefined ? '-' : fmt(v))).join(' / ')} ${MESSUNG_SURGE[z.wort].einheit === 'prozent' ? '%' : 'dB'}`).join('; ')}`);
  // negative control: the unchanged project exported twice moves nothing
  const nochmal = await rendere('surge-basis-nochmal');
  notiere('S1c', sWorte.every((w) => !bewegung(w, sBasis.m, nochmal.m, MESSUNG_SURGE).ok),
    `negative control: the unchanged project rendered again passes no gate (centroid ${fmt((nochmal.m.schwerpunkt_hz / sBasis.m.schwerpunkt_hz - 1) * 100)} %, 1-5 kHz ${fmt(nochmal.m.band_1_5k_db - sBasis.m.band_1_5k_db)} dB, late-half ${fmt(nochmal.m.abkling_db - sBasis.m.abkling_db)} dB; sha256 ${nochmal.sha === sBasis.sha ? 'equal' : 'differs'})`);
}

// AK-O3 on the render: after the undo the freeze of the base is back; unfreeze it, so the next export freezes anew, and measure again
async function s3() {
  for (const wort of sWorte) {
    erwarte200(`${wort}`, await aendernRoh(`${wort} Lead`, [{ befehl: 'geraet_richtung', spur_id: surgeId, wort }]));
    await warteGeladen();
    await rendere(`surge-${wort}-fuer-undo`);
    const schritte = await zurueckZuBasis();
    const f = await ruf('POST', '/proj/freeze', { spur_id: surgeId, an: false }, CYPHER);
    if (f.code !== 200) { notiere(`S3r ${wort}`, false, `unfreeze -> ${grundVon(f)}`); continue; }
    await warteGeladen();
    const frisch = await rendere(`surge-${wort}-undo-frisch`);
    const dz = (frisch.m.schwerpunkt_hz / sBasis.m.schwerpunkt_hz - 1) * 100, db = frisch.m.band_1_5k_db - sBasis.m.band_1_5k_db, dl = frisch.m.abkling_db - sBasis.m.abkling_db;
    notiere(`S3r ${wort}`, Math.abs(dz) < 0.5 && Math.abs(db) < 0.1 && Math.abs(dl) < 0.1,
      `after ${schritte} undo steps and a FRESH freeze the render measures like the base: centroid ${fmt(dz)} %, 1-5 kHz ${fmt(db)} dB, late-half ${fmt(dl)} dB; sha256 ${frisch.sha === sBasis.sha ? 'equal' : 'differs'} (information)`);
    sSpuren = await kanonSpuren();      // the unfreeze is a step of its own: the base for the next word is the project as it is now
  }
}

async function s2() {
  const rev0 = await holeRev();
  const vor = await wirtIst(Object.keys(KLANG_AUSGANG));
  const unbekannt = await aendernRoh('deep Lead', [{ befehl: 'geraet_richtung', spur_id: surgeId, wort: 'deep' }]);
  const liste = String(unbekannt.j?.detail ?? '');
  notiere('S2a', unbekannt.code === 404 && unbekannt.j?.fehler === 'richtung_unbekannt' && sWorte.every((w) => liste.includes(w)) && (await holeRev()) === rev0,
    `"deep" (an RB-338 word) on a Surge track -> ${unbekannt.code} ${unbekannt.j?.fehler}; detail "${liste}"; rev ${rev0} -> ${await holeRev()}`);
  const nach = await wirtIst(Object.keys(KLANG_AUSGANG));
  notiere('S2b', JSON.stringify(nach) === JSON.stringify(vor), `the refusals left the host alone: ${JSON.stringify(nach)}`);
  const schlecht = [];
  for (const staerke of [0, 4]) {
    const r = await aendernRoh('dark Lead', [{ befehl: 'geraet_richtung', spur_id: surgeId, wort: 'dark', staerke }]);
    schlecht.push(`staerke ${staerke} -> ${r.code} ${r.j?.fehler}`);
    if (r.code !== 400) notiere(`S2c staerke ${staerke}`, false, grundVon(r));
  }
  notiere('S2c', (await holeRev()) === rev0, `bad staerke: ${schlecht.join(', ')}; rev unchanged`);
  const ok = await aendernRoh('dark Lead', [{ befehl: 'geraet_richtung', spur_id: surgeId, wort: 'dark' }]);
  notiere('S2d', ok.code === 200, `negative control: "dark" right after the refusals -> ${ok.code}`);
  await zurueckZuBasis();
}

async function s4() {
  const wort = 'bright';
  let n = 0, letzte = null, ok = true;
  for (let i = 0; i < 40; i += 1) {
    const rev0 = await holeRev();
    const r = await aendernRoh(`${wort} Lead`, [{ befehl: 'geraet_richtung', spur_id: surgeId, wort, staerke: 3 }]);
    if (r.code !== 200) { letzte = { r, rev0 }; break; }
    n += 1;
    const c = (await mapVon()).a_filter1_cutoff;
    if (!(c >= -60 && c <= 70)) ok = false;
  }
  const c = (await mapVon()).a_filter1_cutoff;
  notiere('S4a', letzte !== null && letzte.r.code === 409 && letzte.r.j?.fehler === 'richtung_grenze' && (await holeRev()) === letzte.rev0,
    `${n} calls with staerke 3 were accepted, the next one -> ${letzte ? grundVon(letzte.r) : 'never refused'}; rev stays ${await holeRev()}`);
  notiere('S4b', ok && c === 70, `every state stayed within the Surge range -60..70; at the bound ${c}`);
  const h = await wartePegel(['a_filter1_cutoff'], { a_filter1_cutoff: 70 });
  notiere('S4c', h.ok, `the host plays the bound: ${JSON.stringify(h.ist)}`);
  const schritte = await zurueckZuBasis(n + 2);
  const hb = await wartePegel(Object.keys(KLANG_AUSGANG), KLANG_AUSGANG);
  notiere('S4d', schritte === n && hb.ok, `${schritte} undo steps (${n} words) give the base project; the host plays its own values again: ${JSON.stringify(hb.ist)}`);
}

async function s5() {
  const rev0 = await holeRev();
  erwarte200('dark', await aendernRoh('dark Lead', [{ befehl: 'geraet_richtung', spur_id: surgeId, wort: 'dark', staerke: 2 }]));
  const soll = (await mapVon()).a_filter1_cutoff;
  const h = await wartePegel(['a_filter1_cutoff'], { a_filter1_cutoff: soll });
  notiere('S5a', h.ok, `the word reached the host: project ${soll}, host ist ${JSON.stringify(h.ist)}`);
  // the host drifts away out of band (another hand, a restart of the host with an older sound)
  const f = klangBefehl('arr1', 'fahre', 'a_filter1_cutoff', '60', '0');
  if (f.status !== 0) throw new Fehl(`djk-klang fahre -> ${f.stderr || f.stdout}`);
  await warte(1000);
  const weg = await wirtZustand('a_filter1_cutoff');
  notiere('S5b', fast(weg, 60) && !fast(weg, soll), `negative control: the plugin state (zustand) shows the drifted value ${weg}, not the project's ${soll}`);
  // reopen the project: all entries go to the host again
  const slug = (await aktuell()).projekt.slug ?? SURGE_SLUG;
  erwarte200('/proj/oeffnen', await ruf('POST', '/proj/oeffnen', { slug }, CYPHER));
  await warteGeladen();
  let zust = NaN;
  for (let t = 0; t < 6000; t += 250) { zust = await wirtZustand('a_filter1_cutoff'); if (fast(zust, soll)) break; await warte(250); }
  notiere('S5c', fast(zust, soll), `after reopening the project the plugin state (zustand) shows cutoff ${zust}, the project holds ${soll}`);
  await zurueckZuBasis();
  const hb = await wartePegel(Object.keys(KLANG_AUSGANG), KLANG_AUSGANG);
  notiere('S5d', hb.ok && (await holeRev()) > rev0, `undone: the host plays its own values again ${JSON.stringify(hb.ist)}`);
}

async function abschnitt(name, f) {
  if (NUR && !NUR.has(name)) return;
  try { await f(); } catch (e) { notiere(name, false, e instanceof Fehl ? e.message : `ABORT: ${e.stack ?? String(e)}`); }
}

info(`instance ${instanz}, ${opt.url}, build ${BAU}, output ${ORDNER}, tempo ${BPM}, words ${(opt.surge ? sWorte : WORTE).join(', ')}${opt.surge ? ' (Surge)' : ''}`);
if (opt.surge) {
  await abschnitt('SS', surgeAufbau);
  if (sBasis === null || (fehl > 0 && (!NUR || NUR.has('SS')))) {
    process.stdout.write('\nset-up statements failed: not measuring\n');
  } else {
    if (opt.sweep) await abschnitt('SW', surgeSweep);
    await abschnitt('S1', s1);
    await abschnitt('S3', s3);
    await abschnitt('S2', s2);
    await abschnitt('S4', s4);
    await abschnitt('S5', s5);
  }
  try { const dir = path.join(SHM, 'projekte', SURGE_SLUG); if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); info(`removed project ${SURGE_SLUG}`); } } catch (e) { notiere('cleanup', false, e.message); }
} else {
await abschnitt('S', aufbau);
if (basis === null || (fehl > 0 && (!NUR || NUR.has('S')))) {
  process.stdout.write('\nset-up statements failed: not measuring\n');
} else {
  await abschnitt('N0', n0);
  await abschnitt('O1', o1);
  await abschnitt('O2', o2);
  await abschnitt('O4', o4);
  await abschnitt('O6', o6);
}
try { if (loescheGrundprojekt(instanz)) info(`removed project ${SLUG}`); } catch (e) { notiere('cleanup', false, e.message); }
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# abnahme_i19_richtung ${zeit} (${opt.url}, instance ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALL OK' : `${fehl} FEHL`} - report ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
