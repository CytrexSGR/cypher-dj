// Target acceptance, package 1.12 automation slice 3, WAVE A (hand grip overrides a lane, re-enable gives it back) and WAVE B (record a take into a lane: AK12, AK13, AK14 reference, AK15, AK17), against the REAL C++ core on test instance e
// (never the operation, never instance a, c, d; the stand-in mode takes f to i). Until now every probe of this slice ran against the stand-in djk/contract/attrappe_kern.mjs.
// The script builds nothing: it takes the fresh binaries from two build folders, starts instance e with djk-start (silent sink, NO --ton-frei, test mode so /griff works),
// runs the steps below and stops the instance again (also on failure). It prints one OK/FEHL line per step and ends ALLES OK, or exits 1.
//   cmake -S djk/core -B <b>/kern -G Ninja && ninja -C <b>/kern -j8 cypherdj-kern cypherdj-mitschnitt
//   cmake -S djk/fallback -B <b>/notbahn -G Ninja && ninja -C <b>/notbahn -j8
//   flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" node djk/ui/check/acceptance_a3.mjs --bau <b>/kern --bau-notbahn <b>/notbahn [--ausgabe <folder>] [--instanz e]
// djk-start expects the binaries at $DJK/core/build and $DJK/fallback/build: when those do not exist the script links them to the build folders and removes the links at the end.
// Material: one steady sine (440 Hz, amplitude 0.3, identical in both channels) on track s1. The level of s1 is then a pure function of fader and pan. The pan law is constant
// power, so sqrt(L^2 + R^2) of the 440 Hz amplitudes is the fader gain whatever the pan is; the blend of the fader is measured on that (a1_messen amplitude, 48-frame windows).
// Steps (S1 .. S14, numbering of the plan's acceptance list; where the code made a step different the line says so):
//   S1  contract check check_osc.py is GRUEN
//   S2  instance e up: silent sink, test mode, core answers
//   S3  project: 128 BPM, s1 with a clip, loop 0..64, fader lane 0 dB -> -50 dB, pan lane (constant 0), s2 with a mute lane
//   S4  negative: /proj/oeffnen stopped and playing sets no override (no /e/auto zustand 1, kern.regler_fehler empty, list empty)
//   S5  start the transport, wait for status 2
//   S6  /griff on spur/1/fader: the first absolute value is swallowed (D2, no event), the second one gives /e/auto spur 1 fader zustand 1, /proj/aktuell lists {s1, fader};
//       on the master recording the hand value holds (flat while the lane would fall)
//   S7  the same for spur/1/pan and spur/2/mute
//   S8  the same value again: no new event
//   S9  re-enable {alle: true}: zustand 0 per field, list empty; on the master recording the transition to the lane takes about 480 samples without a step
//   S10 a second grip after the re-enable overrides again (blend of the grip measured as well)
//   S11 stopped: /proj/auto/uebersteuern is 200 and sets nothing
//   S12 source cypher: uebersteuern is 403 nur_andreas; re_enable (the route of the MCP tool proj_auto_zustand) works; with Stop Cypher set it is 409 ki_gestoppt, Andreas' works
//   S13 a core restart during an override: the list is empty afterwards
//   S14 instance stopped, links removed (done in finally)
// WAVE B (function welleB, after S13; its own project with five empty audio tracks s1..s5, lanes on s2..s5; all by /griff, the hand path, and by HTTP; no audio measurement):
//   B1  negative: nothing armed, gestures on s1 and s5 while playing: lanes unchanged, no Record entry, every grip accepted
//   B2  AK12: touch take, hand 0 -> low -> 0 in two bars plus a steep one-beat dip: lane within 0.5 dB of the core's own /e/hand references after ONE global shift of at most 1/16 beat,
//       lowest point <= -9 dB, <= 40 points, ONE "Record" entry, undo removes the lane, redo brings it back; B2e: the /e/hand beat field is the CORE beat (Spec R2): its steps follow the sample steps within 1/16
//   B3  AK13 latch holds up to the REAL stop beat (last playing /zustand/arr), controls: the old lane and a latch released 3 beats early fail     B4 AK13 write fills to the real stop, same two controls
//   B5  AK13 touch: lane outside the gesture untouched, the unarmed s5 byte-identical; B5c/B5d (D16): a write take with two armed tracks is ONE entry "Record 2 fields", one undo reverts both, s4/s5 identical
//   B6  AK15: Cypher arm / mode / all / gesture / override are 403 nur_andreas (the override one through the core: status 6), state unchanged; Andreas arm works (control)
//   B7  AK17: a locked lane refuses points (Cypher route too) and a take (lane_gesperrt, lane byte-identical); unlocked, both work again
//   B8  AK14 is NOT measured here: reported as NICHT GEMESSEN (neither OK nor FEHL); the stand-in number is printed for information only. The real-core repeat is the page probe of the main instance
// The last line names the mode: ALLES OK (core e) or ALLES OK (stand-in), and counts the NOT MEASURED lines. Cleanup also runs on SIGINT and SIGTERM.
// --attrappe <instance f..i>: wave B only, against the stand-in core of check/stack.mjs (no real core, no sound, no master recording): proves the script runs. The verdict for the product is the run on instance e.
// Instrument controls: a synthetic hard step and a synthetic 480-sample ramp are run through the same measurement first (CTL lines); the step must be flagged, the ramp not.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SR, amplitude, blendeBreite } from './a1_measure.mjs';
import { laneWert } from '../project/lane.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const DJK = path.resolve(HIER, '..', '..');
const REPO = path.resolve(DJK, '..');
const { values: opt } = parseArgs({ options: { bau: { type: 'string' }, 'bau-notbahn': { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string', default: 'e' }, attrappe: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
const ATT = opt.attrappe ?? null;   // stand-in mode: wave B only against check/stack.mjs on this instance
if (opt.help || (!ATT && (!opt.bau || !opt['bau-notbahn']))) { process.stderr.write('abnahme_a3: usage: --bau <core build folder> --bau-notbahn <notbahn build folder> [--ausgabe <folder>] [--instanz e]  |  --attrappe <instance f..i> [--ausgabe <folder>]\n'); process.exit(2); }
if (ATT && !/^[f-i]$/.test(ATT)) { process.stderr.write(`abnahme_a3: --attrappe ${ATT} refused: instances f to i only (e is the real core run)\n`); process.exit(2); }
if (!ATT && opt.instanz !== 'e') { process.stderr.write(`abnahme_a3: instance ${opt.instanz} refused: this script runs on instance e only\n`); process.exit(2); }
const I = ATT ?? opt.instanz, BAU = ATT ? '' : path.resolve(opt.bau), BAU_NB = ATT ? '' : path.resolve(opt['bau-notbahn']);
if (ATT) process.env.CYPHERDJ_TEST_INSTANZ = ATT;
const zwei = (n) => String(n).padStart(2, '0'), d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = path.resolve((opt.ausgabe ?? path.join(os.homedir(), 'messungen/2026-11-01-automation-slice3/abnahme', zeit)).replace(/^~(?=\/|$)/, os.homedir()));
fs.mkdirSync(path.join(ORDNER, 'roh'), { recursive: true });
let URL_ = `http://127.0.0.1:${52300}`;   // page of instance e: 47300 + 1000 * 5 (stand-in mode: the url of the stack)
const ZIEL = '/dev/shm/a3-ziel';
const AMP = 0.3, FREQ = 440;
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

let fehl = 0;
const zeilen = [];
const notiere = (k, ok, text) => { if (!ok) fehl++; const z = `${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`; zeilen.push(z); process.stdout.write(`${z}\n`); };
const MODUS = ATT ? 'stand-in' : 'core e';
let nichtGem = 0;
// a criterion this run does not measure: reported on its own line, never as OK and never as FEHL
const nichtGemessen = (k, text) => { nichtGem++; const z = `NICHT GEMESSEN ${k}: ${text}`; zeilen.push(z); process.stdout.write(`${z}\n`); };
const info = (text) => { zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };
const roh = {};

const prog = (programm, args, env = {}) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: I, DJK, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const ruf = async (methode, weg, koerper, kopf = {}) => {
  const r = await fetch(URL_ + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};
const aktuell = async () => (await ruf('GET', '/proj/aktuell')).j;
const liste = async () => (await aktuell()).auto_uebersteuert ?? [];
// the lane flag `uebersteuert: true` lives in the noten=zahl view (the tool's view), not in the full view of /proj/aktuell: S4 reads it there, S6e proves that this read can see it
const laneFlag = async () => kurz((await ruf('GET', '/proj/aktuell?noten=zahl')).j.projekt).includes('"uebersteuert":true');
const kurz = (x) => JSON.stringify(x);
const bisWahr = async (f, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await f()) return true; await warte(50); } return false; };

// ---- SSE of the page: every /e/auto message with the time it arrived ----
function stromLesen() {
  const ac = new AbortController(), m = [];
  const fertig = (async () => {
    try {
      const r = await fetch(URL_ + '/strom', { signal: ac.signal });
      const dec = new globalThis.TextDecoder();
      let puf = '';
      for await (const stueck of r.body) {
        puf += dec.decode(stueck, { stream: true });
        let i;
        while ((i = puf.indexOf('\n\n')) >= 0) {
          const block = puf.slice(0, i);
          puf = puf.slice(i + 2);
          if (!block.startsWith('data: ')) continue;
          try { m.push({ t: Date.now(), ...JSON.parse(block.slice(6)) }); } catch { /* half line */ }
        }
      }
    } catch { /* aborted or server gone */ }
  })();
  return { m, stop: async () => { ac.abort(); await fertig; } };
}
let SSE = null;
const autoAb = (n0) => SSE.m.slice(n0).filter((x) => x.a === '/e/auto').map((x) => x.f);
const marke = () => SSE.m.length;
const eineAn = (n0, spur, ziel) => autoAb(n0).filter((f) => Number(f.spur) === spur && f.ziel === ziel && Number(f.zustand) === 1);
const eineAus = (n0, spur, ziel) => autoAb(n0).filter((f) => Number(f.spur) === spur && f.ziel === ziel && Number(f.zustand) === 0);
const hatListe = (l, spur, ziel) => l.some((e) => e.spur_id === spur && e.ziel === ziel);

// ---- measurement ----
const FEN = 48, SCHRITT = 8;
const verstaerkung = (l, r, f) => Math.hypot(amplitude(l, f, FEN), amplitude(r, f, FEN)) / AMP;   // sqrt(L^2 + R^2) / 0.3: the fader gain whatever the pan is
function spurVon(l, r, von, bis) { const s = []; for (let f = von; f < bis; f += SCHRITT) s.push({ frame: f, lin: verstaerkung(l, r, f) }); return s; }
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const dbV = (x) => 20 * Math.log10(Math.max(x, 1e-12));
// largest sample-to-sample jump of both channels in [von, bis)
function sprungMax(l, r, von, bis) { let m = 0; for (let i = Math.max(1, von); i < Math.min(l.length, bis); i++) m = Math.max(m, Math.abs(l[i] - l[i - 1]), Math.abs(r[i] - r[i - 1])); return m; }
// Transitions of the gain trace: clusters of points where the gain moved by more than 1.5 dB within 480 frames. Returns [{von, bis}] in frames.
function uebergaenge(l, r) {
  const grob = 32, n = Math.floor((l.length - 2 * FEN) / grob), g = new Float64Array(n);
  for (let k = 0; k < n; k++) g[k] = verstaerkung(l, r, FEN + k * grob);
  const gdb = Array.from(g, (x) => Math.max(dbV(x), -100)), span = Math.round(480 / grob), aus = [];
  let offen = null;
  for (let k = 0; k + span < n; k++) {
    const bewegt = Math.abs(gdb[k + span] - gdb[k]) > 1.5;   // 1.5 dB within 480 frames
    if (bewegt) { if (!offen) offen = { von: k, bis: k + span }; else offen.bis = k + span; }
    else if (offen && k - offen.bis > 40) { aus.push(offen); offen = null; }
  }
  if (offen) aus.push(offen);
  return aus.map((o) => ({ von: FEN + o.von * grob, bis: FEN + o.bis * grob }));
}
// One transition judged: width of the linear blend (frames), step ratio (largest sample jump inside / largest sample jump of the steady parts around)
function beurteile(l, r, ue) {
  const vor = median(spurVon(l, r, ue.von - 4000, ue.von - 1500).map((e) => e.lin)), nach = median(spurVon(l, r, ue.bis + 1500, ue.bis + 4000).map((e) => e.lin));
  const spur = spurVon(l, r, ue.von - 300, ue.bis + 300);
  const breite = blendeBreite(spur, vor, nach);
  const innen = sprungMax(l, r, ue.von - 100, ue.bis + 100);
  const aussen = Math.max(sprungMax(l, r, ue.von - 3000, ue.von - 1000), sprungMax(l, r, ue.bis + 1000, ue.bis + 3000));
  return { vor, nach, vor_db: dbV(vor), nach_db: dbV(nach), breite: breite?.frames ?? null, mitte: breite?.mitte ?? null, sprung_verhaeltnis: innen / aussen, innen, aussen };
}
const BLENDE_MIN = 432, BLENDE_MAX = 528, SPRUNG_MAX = 1.15;   // 480 +-10 %; a gain blend must not exceed the steady sine slope by more than 15 %
const blendeOk = (b) => b.breite !== null && b.breite >= BLENDE_MIN && b.breite <= BLENDE_MAX && b.sprung_verhaeltnis <= SPRUNG_MAX;

// Instrument controls: synthetic signals through the same functions
function kontrollen() {
  const n = 20 * SR / 10, i0 = 48027, g0 = 1.0, g1 = 0.16;   // 2 s
  const sig = (breite) => {
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = breite === 0 ? (i < i0 ? 0 : 1) : Math.min(1, Math.max(0, (i - i0) / breite));
      l[i] = AMP * (g0 + (g1 - g0) * t) * Math.cos(Math.PI / 4) * Math.sin(2 * Math.PI * FREQ * i / SR);
    }
    return l;
  };
  const gefunden = (l) => { const u = uebergaenge(l, l); return u.length === 1 ? beurteile(l, l, u[0]) : null; };
  const stufe = gefunden(sig(0)), rampe = gefunden(sig(480));
  notiere('CTL1 a hard step is flagged', stufe !== null && stufe.sprung_verhaeltnis > 2 * SPRUNG_MAX, `step ratio ${stufe?.sprung_verhaeltnis?.toFixed(2)} (limit ${SPRUNG_MAX}), width ${stufe?.breite?.toFixed(0) ?? 'n/a'}`);
  notiere('CTL2 a 480-sample ramp passes and reads 480', rampe !== null && blendeOk(rampe) && Math.abs(rampe.breite - 480) < 20, `step ratio ${rampe?.sprung_verhaeltnis?.toFixed(3)}, width ${rampe?.breite?.toFixed(1)} (synthetic 480)`);
}

// ---- recording ----
const jsonZeile = (t) => { try { return JSON.parse(t.trim().split('\n').filter(Boolean).pop()); } catch { return null; } };
function lies(datei) {
  const b = fs.readFileSync(datei), st = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
  const l = new Float32Array(st.length >> 1), r = new Float32Array(st.length >> 1);
  for (let i = 0; i < l.length; i++) { l[i] = st[2 * i]; r[i] = st[2 * i + 1]; }
  return { l, r };
}

// ---- instance ----
const links = [];
function verlinke() {
  for (const [ziel, quelle] of [[path.join(DJK, 'core/build'), BAU], [path.join(DJK, 'fallback/build'), BAU_NB]]) {
    if (fs.existsSync(ziel)) { info(`${ziel} exists, left as it is`); continue; }
    fs.symlinkSync(quelle, ziel);
    links.push(ziel);
  }
}
const entlinke = () => { for (const l of links.splice(0)) try { fs.unlinkSync(l); } catch { /* gone */ } };
let aufgebaut = false;
async function stoppeInstanz() {
  if (!aufgebaut) return;
  aufgebaut = false;
  const r = await prog(path.join(DJK, 'start/djk-stop'), ['--instanz', I]);
  info(`djk-stop rc ${r.rc} ${r.err.trim().split('\n').pop() ?? ''}`);
}

const SPUR_NR = { s1: 1, s2: 2 };
let slug = null;
const rev = async () => (await ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
const aendern = async (label, befehle, kopf = {}) => {
  const r = await ruf('POST', '/proj/aendern', { rev: await rev(), label, befehle }, kopf);
  if (r.code !== 200) throw new Error(`/proj/aendern (${label}) ${r.code} ${kurz(r.j).slice(0, 300)}`);
  return r.j;
};
const geladen = async () => {
  const ok = await bisWahr(async () => { const a = await aktuell(); return a.projekt && a.projekt.spuren.flatMap((s) => s.clips).every((c) => c.dekodiert === 'fertig' || c.dekodiert === null || c.dekodiert === undefined) && a.kern?.rev_geladen === a.projekt.wiedergabe_rev && a.kern?.status === 0; }, 40000);
  if (!ok) throw new Error(`playback not loaded after 40 s: ${kurz((await aktuell()).kern)}`);
};
const status = async () => (await aktuell()).kern?.status;
const transport = async (aktion) => { const r = await ruf('POST', '/proj/transport', aktion === 'start' ? { aktion, beat: 0 } : { aktion }); if (r.code !== 200) throw new Error(`transport ${aktion} ${r.code} ${kurz(r.j)}`); return r; };
const stoppeTransport = async () => { await transport('stopp').catch(() => null); await bisWahr(async () => (await status()) === 0, 8000); };
const starteTransport = async () => { await transport('start'); if (!(await bisWahr(async () => (await status()) === 2, 12000))) throw new Error(`status 2 not reached: ${await status()}`); };
const griff = (pfad, u) => ruf('POST', '/griff', { pfad, u });

async function haupt() {
  // ---- S1 contract check ----
  const v = await prog('python3', [path.join(DJK, 'contract/check_osc.py')], {});
  notiere('S1 contract check', v.rc === 0 && /ERGEBNIS: GR(Ü|U)(N)/.test(v.out), v.out.trim().split('\n').pop() + (v.rc ? ` rc ${v.rc}` : ''));
  kontrollen();
  if (ATT) { await attrappeStart(); if (await halterWarten()) await welleB(); return; }

  // ---- S2 instance ----
  fs.rmSync(ZIEL, { recursive: true, force: true });
  const au = await prog('node', [path.join(HIER, 'a2_setup.mjs'), '--ziel', ZIEL, '--instanz', I], {});
  const aufbau = jsonZeile(au.out);
  if (au.rc !== 0 || !aufbau) throw new Error(`a2_aufbau rc ${au.rc} ${au.err.slice(0, 300)}`);
  verlinke();
  const st = await prog(path.join(DJK, 'start/djk-start'), ['--instanz', I], { CYPHERDJ_KATALOG: aufbau.katalog });
  aufgebaut = true;
  fs.writeFileSync(path.join(ORDNER, 'djk-start.txt'), st.out + st.err);
  const z = await prog(path.join(DJK, 'start/djk-start'), ['--zustand', '--instanz', I], {});
  const stumm = /cypher_stumm-e:playback_FL/.test(z.out), pruef = /test mode/.test(z.out);
  const kernDa = await bisWahr(async () => { try { const a = await aktuell(); return a && a.kern !== undefined && (await ruf('GET', '/lage')).code === 200; } catch { return false; } }, 30000);
  // the core's hello reaches the page: kern.status is a number once the core answered
  const kernAntwortet = await bisWahr(async () => { try { return typeof (await ruf('POST', '/proj/neu', { name: `a3-probe-${zeit}` })).j?.slug === 'string'; } catch { return false; } }, 30000);
  slug = (await aktuell()).slug;
  notiere('S2 real core on instance e', st.rc === 0 && stumm && pruef && kernDa && kernAntwortet, `djk-start rc ${st.rc}; sink ${stumm ? 'cypher_stumm-e (silent, no --ton-frei)' : 'NOT the silent sink'}; ${pruef ? 'test mode' : 'NO test mode'}; page ${kernDa}; core binary ${path.join(BAU, 'cypherdj-kern')}`);
  if (st.rc !== 0 || !stumm || !pruef) throw new Error('instance not usable');
  SSE = stromLesen();
  await warte(1500);

  // ---- S3 project ----
  const neu = await ruf('POST', '/proj/neu', { name: `a3-abnahme-${zeit}` });
  slug = neu.j.slug;
  await aendern('a3 setup', [
    { befehl: 'tempo_setzen', bpm: 128 }, { befehl: 'spur_neu', art: 'audio', name: 'S1' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 64, sha256: aufbau.sha_a },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 64 },
    { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }, { befehl: 'auto_neu', spur_id: 's1', ziel: 'pan' },
    { befehl: 'spur_neu', art: 'audio', name: 'S2' }, { befehl: 'auto_neu', spur_id: 's2', ziel: 'mute' }]);
  const p0 = (await aktuell()).projekt;
  const lane = (sid, ziel) => p0.spuren.find((s) => s.id === sid)?.automation?.find((x) => x.ziel === ziel)?.id;
  await aendern('a3 lanes', [
    { befehl: 'auto_punkte', lane_id: lane('s1', 'fader'), setze: [{ beat: 0, wert: 0 }, { beat: 64, wert: -50 }] },
    { befehl: 'auto_punkte', lane_id: lane('s1', 'pan'), setze: [{ beat: 0, wert: 0 }, { beat: 64, wert: 0 }] },
    { befehl: 'auto_punkte', lane_id: lane('s2', 'mute'), setze: [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 64, wert: 0, form: 'sprung' }] }]);
  await geladen();
  await warte(3000);
  const p1 = (await aktuell()).projekt;
  notiere('S3 project', p1.tempo_bpm === 128 && p1.spuren.length === 2 && p1.spuren[0].automation?.length === 2 && p1.spuren[1].automation?.length === 1, `slug ${slug}, tracks ${p1.spuren.map((s) => `${s.id}:${(s.automation ?? []).map((x) => x.ziel).join('+')}`).join(' ')}, loop ${kurz(p1.loop)}`);

  // ---- S4 negative: opening sets no override ----
  {
    const n0 = marke();
    const o1 = await ruf('POST', '/proj/oeffnen', { slug });
    await warte(2500);
    const a1 = await aktuell();
    const ok1 = o1.code === 200 && eineAn(n0, 1, 'fader').length + eineAn(n0, 1, 'pan').length + eineAn(n0, 2, 'mute').length === 0 && (a1.kern?.regler_fehler?.length ?? o1.j?.kern?.regler_fehler?.length ?? 0) === 0 && !a1.auto_uebersteuert && !(await laneFlag());
    notiere('S4a open while stopped sets no override', ok1, `oeffnen ${o1.code}, /e/auto zustand 1 events ${autoAb(n0).filter((f) => Number(f.zustand) === 1).length}, regler_fehler ${kurz(o1.j?.kern?.regler_fehler ?? null)}, list ${kurz(a1.auto_uebersteuert ?? [])}, regler ${o1.j?.kern?.regler}`);
    await geladen();
    await starteTransport();
    await warte(800);
    const n1 = marke();
    const o2 = await ruf('POST', '/proj/oeffnen', { slug });
    const st2 = await status();
    await warte(2500);
    const a2 = await aktuell();
    const ok2 = o2.code === 200 && eineAn(n1, 1, 'fader').length + eineAn(n1, 1, 'pan').length + eineAn(n1, 2, 'mute').length === 0 && (o2.j?.kern?.regler_fehler?.length ?? 0) === 0 && !a2.auto_uebersteuert && !(await laneFlag());
    notiere('S4b open while playing sets no override', ok2, `oeffnen ${o2.code} (status right after ${st2}, then ${a2.kern?.status}), /e/auto zustand 1 events ${autoAb(n1).filter((f) => Number(f.zustand) === 1).length}, regler_fehler ${kurz(o2.j?.kern?.regler_fehler ?? null)}, list ${kurz(a2.auto_uebersteuert ?? [])}`);
    await stoppeTransport();
    await geladen();
  }

  // ---- S5 .. S10 on one master recording ----
  const rec = { ereignisse: {} };
  const zeitpunkt = (n) => { rec.ereignisse[n] = Date.now(); };
  const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', '26', '--aus', path.join(ORDNER, 'roh', 'lauf.f32')]);
  await warte(700);
  const ergebnis = {};
  try {
    // S5
    zeitpunkt('start');
    await starteTransport();
    notiere('S5 transport playing', (await status()) === 2, `kern.status ${await status()}`);
    await warte(3500);   // lane plays: beat ~7 at 128 BPM

    // S6 fader grip: u 0.2 first (position only), then u 0.5; the takeover is scaled from the lane value (about -6.9 dB now), so the reading is about +0.2 dB (see S10c)
    let n = marke();
    const g1 = await griff('spur/1/fader', 0.2);
    await warte(700);
    const frueh = eineAn(n, 1, 'fader').length, listeFrueh = await liste();
    notiere('S6a first absolute value is swallowed (D2)', g1.code === 200 && frueh === 0 && !hatListe(listeFrueh, 's1', 'fader'), `/griff ${g1.code}, zustand 1 events ${frueh}, list ${kurz(listeFrueh)}`);
    zeitpunkt('griff1');
    const g2 = await griff('spur/1/fader', 0.5);
    const ev = await bisWahr(() => eineAn(n, 1, 'fader').length > 0, 3000);
    await warte(300);
    const l1 = await liste();
    ergebnis.s6 = { ev: eineAn(n, 1, 'fader'), liste: l1 };
    notiere('S6b second value overrides: /e/auto spur 1 fader zustand 1, list {s1, fader}', g2.code === 200 && ev && eineAn(n, 1, 'fader').length === 1 && hatListe(l1, 's1', 'fader') && l1.length === 1, `/griff ${g2.code}, events ${kurz(eineAn(n, 1, 'fader'))}, list ${kurz(l1)}`);
    notiere('S6e an overridden lane carries uebersteuert:true in the noten=zahl view (the control for the S4 text check, which reads the same view)', await laneFlag(), `flag seen ${await laneFlag()}`);
    await warte(1000);

    // S7 pan and mute
    for (const [pfad, spur, ziel, erst, zweit, sid] of [['spur/1/pan', 1, 'pan', 0.2, 0.8, 's1'], ['spur/2/mute', 2, 'mute', 0.0, 1.0, 's2']]) {
      n = marke();
      const a = await griff(pfad, erst);
      await warte(600);
      const f1 = eineAn(n, spur, ziel).length;
      const b = await griff(pfad, zweit);
      const evb = await bisWahr(() => eineAn(n, spur, ziel).length > 0, 3000);
      await warte(300);
      const l = await liste();
      notiere(`S7 ${ziel} of ${sid}: first value swallowed, second overrides`, a.code === 200 && b.code === 200 && f1 === 0 && evb && eineAn(n, spur, ziel).length === 1 && hatListe(l, sid, ziel), `/griff ${a.code}/${b.code}, events after first ${f1}, after second ${kurz(eineAn(n, spur, ziel))}, list ${kurz(l)}`);
      await warte(500);
    }
    await warte(800);

    // S8 the same value again: no new event
    n = marke();
    await griff('spur/1/fader', 0.5); await griff('spur/1/pan', 0.8); await griff('spur/2/mute', 1.0);
    await warte(1200);
    const lw = await liste();
    notiere('S8 identical value again: no new event', autoAb(n).filter((f) => Number(f.zustand) === 1).length === 0 && lw.length === 3, `new zustand 1 events ${autoAb(n).filter((f) => Number(f.zustand) === 1).length}, list size ${lw.length}`);
    await warte(1200);

    // S9 re-enable all
    n = marke();
    zeitpunkt('reenable');
    const re = await ruf('POST', '/proj/auto/re_enable', { alle: true });
    const alle0 = await bisWahr(() => eineAus(n, 1, 'fader').length > 0 && eineAus(n, 1, 'pan').length > 0 && eineAus(n, 2, 'mute').length > 0, 3000);
    await warte(300);
    const l9 = await liste();
    notiere('S9a re-enable {alle:true}: zustand 0 per field, list empty', re.code === 200 && alle0 && l9.length === 0, `re_enable ${re.code} ${kurz(re.j?.alle)}, zustand 0 events ${kurz(autoAb(n).filter((f) => Number(f.zustand) === 0).map((f) => `${f.spur}/${f.ziel}`))}, list ${kurz(l9)}`);
    await warte(3500);

    // S10 second grip: the pickup position is known now; u 0.2 might already override, so send until an event comes
    n = marke();
    zeitpunkt('griff2');
    const h1 = await griff('spur/1/fader', 0.2);
    await warte(600);
    const erster = eineAn(n, 1, 'fader').length;
    const ev10 = await bisWahr(() => eineAn(n, 1, 'fader').length > 0, 3000);
    await warte(1800);   // hold the first value: its level is measured on the recording (scaled takeover from the lane value, see S10c)
    zeitpunkt('griff2b');
    await griff('spur/1/fader', 0.5);
    await warte(1000);
    const l10 = await liste();
    notiere('S10 second grip after re-enable overrides again', h1.code === 200 && ev10 && hatListe(l10, 's1', 'fader'), `first value ${erster ? 'overrode at once (position known)' : 'swallowed again'}, events ${kurz(eineAn(n, 1, 'fader'))}, list ${kurz(l10)}`);
    await warte(2500);
  } finally {
    await stoppeTransport();
  }
  const m = await mit;
  const j = jsonZeile(m.out);
  if (m.rc !== 0 || !j) throw new Error(`cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}`);
  fs.writeFileSync(path.join(ORDNER, 'roh', 'lauf.json'), m.out);

  // ---- measurement on the recording ----
  const { l, r } = lies(path.join(ORDNER, 'roh', 'lauf.f32'));
  roh.verlauf_db = []; for (let f = 2 * SR / 4; f < l.length - FEN; f += SR / 4) roh.verlauf_db.push([+(f / SR).toFixed(2), +dbV(verstaerkung(l, r, f)).toFixed(2)]);
  // onset out of silence and the fall into silence at the stop (the recorder runs before and after the transport) are not lane events
  const ue = uebergaenge(l, r).filter((u) => dbV(verstaerkung(l, r, Math.max(FEN, u.von - 2000))) > -100 && dbV(verstaerkung(l, r, Math.min(l.length - FEN, u.bis + 2000))) > -100);
  roh.uebergaenge = ue;
  info(`recording ${(l.length / SR).toFixed(2)} s, gain transitions found: ${ue.length} at frames ${ue.map((u) => `${u.von}..${u.bis}`).join(', ')}`);
  if (ue.length !== 4) {
    notiere('S9b blend on the master recording', false, `expected 4 gain transitions (grip, re-enable, second grip with 0.2, then with 0.5), found ${ue.length}`);
  } else {
    const [e1, e2, e3, e4] = ue.map((u) => beurteile(l, r, u));
    roh.e1 = e1; roh.e2 = e2; roh.e3 = e3; roh.e4 = e4;
    const f = (b) => `${b.vor_db.toFixed(2)} dB -> ${b.nach_db.toFixed(2)} dB over ${b.breite?.toFixed(0) ?? 'n/a'} samples, largest sample jump ${b.innen.toFixed(5)} inside vs ${b.aussen.toFixed(5)} steady (ratio ${b.sprung_verhaeltnis.toFixed(3)})`;
    // hand value holds between grip and re-enable: flat while the lane would fall (about 0.78 dB per beat)
    const plateau = spurVon(l, r, ue[0].bis + 2000, ue[1].von - 2000).map((e) => dbV(e.lin));
    const drift = Math.max(...plateau) - Math.min(...plateau);
    notiere('S6c hand value holds on the master (flat while the lane falls)', drift < 0.1, `level between the grip and the re-enable: ${Math.min(...plateau).toFixed(3)} .. ${Math.max(...plateau).toFixed(3)} dB (spread ${drift.toFixed(3)} dB, limit 0.1); the lane fell from ${e1.vor_db.toFixed(1)} dB to ${e2.nach_db.toFixed(1)} dB meanwhile`);
    notiere('S6d grip blends into the hand value, no step', blendeOk(e1), f(e1) + ` (limits ${BLENDE_MIN}..${BLENDE_MAX} samples, ratio <= ${SPRUNG_MAX})`);
    notiere('S9b re-enable blends back to the lane in about 480 samples, no step (no click)', blendeOk(e2), f(e2) + ` (limits ${BLENDE_MIN}..${BLENDE_MAX} samples, ratio <= ${SPRUNG_MAX})`);
    const laneErwartet = e2.nach_db;   // the lane value is read from the recording after the blend; it must be far from the hand value
    notiere('S9c re-enable lands on the lane, not on the hand value', e2.vor_db - laneErwartet > 6, `hand ${e2.vor_db.toFixed(2)} dB, lane after ${laneErwartet.toFixed(2)} dB`);
    notiere('S10b second grip blends, no step', blendeOk(e3), f(e3) + ` (limits ${BLENDE_MIN}..${BLENDE_MAX} samples, ratio <= ${SPRUNG_MAX})`);
    // The takeover of the hand is SCALED (INTERFACES 7.3 point 3, "Uebernahme skaliert ... ohne Sprung"): the value starts at the lane value x and moves with the knob
    // from the known knob position, up towards 1 or down towards 0 in proportion. It is NOT the absolute curve value of the knob. dB = 6 + 20 log10(x) (K_SPUR_FADER).
    const xAusDb = (db) => 10 ** ((db - 6) / 20), dbAusX = (x) => 6 + 20 * Math.log10(x);
    const skaliert = (x, phys, p) => (Math.abs(x - phys) < 1 / 256 ? p : p > phys ? x + (p - phys) * (1 - x) / (1 - phys) : x - (phys - p) * x / phys);
    const erw1 = dbAusX(skaliert(xAusDb(e1.vor_db), 0.2, 0.5));   // first grip: knob 0.2 (swallowed) -> 0.5, the lane stood at e1.vor_db
    const erw3 = dbAusX(skaliert(xAusDb(e3.vor_db), 0.5, 0.2));   // second grip: knob stood at 0.5 (S8), the lane at e3.vor_db, the knob goes to 0.2: BELOW the lane
    const erw4 = dbAusX(skaliert(xAusDb(e3.nach_db), 0.2, 0.5));  // then 0.5
    const w = (b) => b.breite !== null && b.breite >= 100 && b.breite <= BLENDE_MAX;   // hand to hand is the 10 ms fader ramp of the mixer, not the 480-sample source blend
    notiere('S10c second grip: scaled takeover from the lane value, not the absolute knob curve', Math.abs(e1.nach_db - erw1) < 0.5 && Math.abs(e3.nach_db - erw3) < 0.5 && e3.nach_db < e3.vor_db && Math.abs(e4.nach_db - erw4) < 0.5 && w(e4),
      `first grip ${e1.nach_db.toFixed(2)} dB (expected ${erw1.toFixed(2)}), second grip 0.2 reads ${e3.nach_db.toFixed(2)} dB (expected ${erw3.toFixed(2)}; lane ${e3.vor_db.toFixed(2)} dB, the absolute curve would give ${dbAusX(0.2).toFixed(2)}), then 0.5 reads ${e4.nach_db.toFixed(2)} dB (expected ${erw4.toFixed(2)}); hand-to-hand ramp ${e4.breite?.toFixed(0) ?? 'n/a'} samples`);
    // excerpt (<= 10 s) of the recording around the re-enable for listening and re-measuring
    const von = Math.max(0, ue[1].von - 3 * SR), bis = Math.min(l.length, ue[1].bis + 3 * SR);
    const ex = new Float32Array(2 * (bis - von));
    for (let i = von; i < bis; i++) { ex[2 * (i - von)] = l[i]; ex[2 * (i - von) + 1] = r[i]; }
    const { schreibeWav } = await import('./w1_wav.mjs');
    schreibeWav(path.join(ORDNER, 'roh', 'reenable-ausschnitt.wav'), ex);
  }
  fs.rmSync(path.join(ORDNER, 'roh', 'lauf.f32'), { force: true });   // 23 s of raw floats stay out of the folder; the excerpt and the numbers remain

  // ---- S11 stopped ----
  {
    await ruf('POST', '/proj/auto/re_enable', { alle: true });   // overrides survive a stop (plan D6): start from a clean list
    await stoppeTransport();
    const n = marke();
    const u = await ruf('POST', '/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'fader' });
    await warte(1000);
    const lz = await liste();
    notiere('S11 stopped: uebersteuern is 200 and sets nothing', u.code === 200 && eineAn(n, 1, 'fader').length === 0 && lz.length === 0, `uebersteuern ${u.code} ${kurz(u.j?.ok)}, zustand 1 events ${eineAn(n, 1, 'fader').length}, list ${kurz(lz)}`);
  }

  // ---- S12 sources and Stop Cypher ----
  {
    await geladen();
    await starteTransport();
    await warte(1500);
    const grabbe = async () => { await griff('spur/1/fader', 0.2); await warte(500); await griff('spur/1/fader', 0.5); return bisWahr(async () => hatListe(await liste(), 's1', 'fader'), 3000); };
    const ueber = await grabbe();
    const uc = await ruf('POST', '/proj/auto/uebersteuern', { spur_id: 's2', ziel: 'mute' }, CYPHER);
    const nachUc = await liste();
    notiere('S12a cypher uebersteuern is 403 nur_andreas, nothing changes', ueber && uc.code === 403 && uc.j?.fehler === 'nur_andreas' && !hatListe(nachUc, 's2', 'mute'), `override of s1 fader set ${ueber}; cypher uebersteuern s2 mute ${uc.code} ${uc.j?.fehler}; list ${kurz(nachUc)}`);
    const n = marke();
    const rc = await ruf('POST', '/proj/auto/re_enable', { alle: true }, CYPHER);
    await warte(800);
    const nachRc = await liste();
    notiere('S12b cypher re_enable works (route of proj_auto_zustand)', rc.code === 200 && nachRc.length === 0 && eineAus(n, 1, 'fader').length > 0, `re_enable ${rc.code}, zustand 0 events ${kurz(eineAus(n, 1, 'fader'))}, list ${kurz(nachRc)}`);
    const ueber2 = await grabbe();
    const stopp = await ruf('POST', '/taste', { name: 'stopp' });
    await warte(800);
    const sperre = await ruf('POST', '/proj/auto/re_enable', { alle: true }, CYPHER);
    const sperreEinzeln = await ruf('POST', '/proj/auto/re_enable', { spur_id: 's1', ziel: 'fader' }, CYPHER);
    const nachSperre = await liste();
    notiere('S12c Stop Cypher set: cypher re_enable is 409 ki_gestoppt, override stays', ueber2 && stopp.code === 200 && sperre.code === 409 && sperre.j?.fehler === 'ki_gestoppt' && sperreEinzeln.code === 409 && hatListe(nachSperre, 's1', 'fader'), `taste stopp ${stopp.code}; re_enable alle ${sperre.code} ${sperre.j?.fehler}, single ${sperreEinzeln.code} ${sperreEinzeln.j?.fehler}; list ${kurz(nachSperre)}`);
    const na = await ruf('POST', '/proj/auto/re_enable', { alle: true });
    await warte(800);
    const nachA = await liste();
    notiere('S12d Stop Cypher set: Andreas re_enable still works', na.code === 200 && nachA.length === 0, `re_enable ${na.code}, list ${kurz(nachA)}`);
    const fr = await ruf('POST', '/taste', { name: 'freigabe' });
    info(`Stop Cypher released: taste freigabe ${fr.code}`);
    await stoppeTransport();
  }

  // ---- S13 core restart during an override ----
  {
    await geladen();
    await starteTransport();
    await warte(1200);
    await griff('spur/1/fader', 0.2); await warte(500); await griff('spur/1/fader', 0.5);
    const da = await bisWahr(async () => hatListe(await liste(), 's1', 'fader'), 3000);
    const gen0 = (await aktuell()).kern;
    const rs = await prog('systemctl', ['--user', 'restart', `cypherdj-kern-${I}`], {});
    // the page sees the new core: the mirror is cleared on the new generation; wait for a hello, then read
    await warte(4000);
    const nach = await bisWahr(async () => { try { const a = await aktuell(); return a.kern && a.kern.status !== undefined; } catch { return false; } }, 20000);
    await warte(1500);
    const lr = await liste();
    const ak = await aktuell();
    notiere('S13 core restart during an override: list empty afterwards', da && rs.rc === 0 && nach && lr.length === 0, `override set before ${da}, systemctl restart rc ${rs.rc}, list after ${kurz(lr)}, kern before ${kurz(gen0)} after ${kurz(ak.kern)}`);
    await stoppeTransport().catch(() => null);
  }

  if (!(await halterWarten())) return;

  await welleB();
}

// =====================================================================================================================================================
// WAVE B: record a take into a lane
// =====================================================================================================================================================
let STAPEL = null, ATT_DIR = null, SLUG_B = null;
async function attrappeStart() {
  const { starteStapel } = await import('./stack.mjs');
  ATT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-a3b-'));
  const proj = { wurzel: path.join(ATT_DIR, 'proj'), arbeitsordner: path.join(ATT_DIR, 'arr') };
  STAPEL = await starteStapel(path.join(ORDNER, 'stapel'), ATT, {}, { proj });
  URL_ = STAPEL.url.replace(/\/$/, '');
  const da = await bisWahr(async () => { try { return (await ruf('GET', '/proj/aktuell')).code === 200; } catch { return false; } }, 30000);
  notiere('S2 stand-in stack on instance ' + ATT, da, `${URL_} (stand-in core: wave B only, NOT the product verdict)`);
  if (!da) throw new Error('stack not up');
  SSE = stromLesen();
  await warte(800);
}

const BPM = 128, BEAT_MS = 60000 / BPM, SPB = 48000 * 60 / BPM;
// Tolerances, each with its reason:
const TOL_DB = 0.5, TOL_BEAT = 1 / 16;   // AK12 as the spec states it (+-0.5 dB and +-1/16 beat)
const TOL_STOPP = 0.15;                  // beats between the real stop and a lane edge: one /zustand/arr state every 20 ms is 0.043 beat at 128 BPM, the stop lands in a 256-sample block (0.02 beat); 0.15 is far below the 3-beat early-release controls
const TOL_HALT = 0.5;                    // dB a held or base value may differ from the reference (the same 0.5 dB as AK12)
const TOL_LETZTE = 2.5;                  // dB between the last /e/hand reference and the held value: the throttled last message can lag the last grip by 0.1 beat under load, 1.2 dB at 12 dB per beat (seen once in 12 loaded runs); 2.5 stays below the 4.8 dB to the old lane that the control relies on
const TOL_AUSSEN = 0.2;                  // dB a touch take may change the lane outside its gesture: the edge points the server adds are exact, so only float noise is expected
const TIEFE_MIN = 9;                     // dB: the 0 -> -12 -> 0 gesture must reach at least -9 dB, else the band test proves nothing
// hand positions: real core = physical knob positions with the scaled takeover (the lane value is the start, INTERFACES 7.3); stand-in = linear over -200..6 dB
const POS = ATT ? { p0: 200 / 206, tief: 188 / 206 } : { p0: 0.5, tief: 0.1 };
const lageB = () => aktuell().then((a) => a.projekt);
const laneVon = async (sid, ziel = 'fader') => {
  const l = (await lageB()).spuren.find((x) => x.id === sid)?.automation?.find((x) => x.ziel === ziel);
  if (!l) return null;
  const r = await ruf('GET', `/proj/auto?lane_id=${l.id}&punkte_max=8192`);
  return { id: l.id, gesperrt: !!l.gesperrt, punkte: r.j.punkte };
};
const laneJson = async (sid) => kurz((await lageB()).spuren.find((x) => x.id === sid)?.automation ?? []);
const verlaufB = async () => (await ruf('GET', '/proj/verlauf')).j;
const nRecord = async () => (await verlaufB()).filter((e) => /^Record/.test(e.label)).length;
const laneAt = (punkte, b) => laneWert(punkte, b, 'fader');
const abgelehnteGriffe = [];
const griffB = async (pfad, u) => { const r = await griff(pfad, u); if (r.code !== 200) abgelehnteGriffe.push(`${pfad} ${r.code}`); return r; };

// a gesture on the fader of track nr by /griff (the hand path): the position first (swallowed), then fn(b) for b = 0..beats, a message every 12 ms
async function fahre(nr, beats, fn) {
  const t0 = Date.now();
  for (;;) {
    const b = (Date.now() - t0) / BEAT_MS;
    if (b > beats) break;
    await griffB(`spur/${nr}/fader`, fn(b));
    await warte(12);
  }
}
const dreieckFn = (beats, tief) => (b) => POS.p0 + (tief - POS.p0) * (1 - Math.abs(b - beats / 2) / (beats / 2));
async function dreieck(nr, beats, tief = POS.tief) {
  await griffB(`spur/${nr}/fader`, POS.p0);
  await warte(250);
  await fahre(nr, beats, dreieckFn(beats, tief));
  await griffB(`spur/${nr}/fader`, POS.p0);
}
// the AK12 gesture: 0 -> low -> 0 in two bars (the spec), then a steep dip of one beat (24 dB per beat), so that a lag of 0.1 beat shows as more than 0.5 dB
async function ak12Geste(nr) {
  await griffB(`spur/${nr}/fader`, POS.p0);
  await warte(250);
  await fahre(nr, 8, dreieckFn(8, POS.tief));
  await fahre(nr, 1, dreieckFn(1, POS.tief));
  await griffB(`spur/${nr}/fader`, POS.p0);
}
// to `tief` within one beat, then silence (latch: the release is the end of the messages)
async function schiebe(nr, tief = POS.tief) {
  await griffB(`spur/${nr}/fader`, POS.p0);
  await warte(250);
  await fahre(nr, 1, (b) => POS.p0 + (tief - POS.p0) * b);
  await griffB(`spur/${nr}/fader`, tief);
}
// the core's own references: /e/hand of the field. The beat comes from the grip sample and the transport state of the core (no tempo ramp, no loop seam in these takes);
// the /e/hand beat field (feldBeat) is the CORE beat, not the project beat (Spec R2, INTERFACES 5.8): B2e checks its internal consistency, not equality with the derived project beat
function referenzen(n0, nr) {
  const ev = SSE.m.slice(n0).filter((x) => x.a === '/e/hand' && x.f.pfad === `spur/${nr}/fader`);
  const arr = SSE.m.slice(n0).filter((x) => x.a === '/zustand/arr' && Number(x.f.status) === 2).at(-1)?.f;
  return ev.map((e) => {
    const b = Number(e.f.beat), ausSample = arr ? Number(arr.start_beat) + (Number(e.f.sample) - Number(arr.ursprung_sample)) / SPB : NaN;
    return { beat: ausSample, sample: Number(e.f.sample), feldBeat: Number.isFinite(b) && b > 0 ? b : NaN, db: Number(e.f.wert) };
  }).filter((r) => Number.isFinite(r.beat) && r.beat > 0);
}
// consistency of the core beat field: between consecutive references the field beat advances by (sample difference / samples per beat), within 1/16 beat
const feldKonsistenz = (refs) => {
  const r = refs.filter((x) => Number.isFinite(x.feldBeat) && Number.isFinite(x.sample)).sort((a, b) => a.sample - b.sample);
  let m = NaN; for (let i = 1; i < r.length; i++) { const d = Math.abs((r[i].feldBeat - r[i - 1].feldBeat) - (r[i].sample - r[i - 1].sample) / SPB); m = Number.isFinite(m) ? Math.max(m, d) : d; }
  return m;
};
// the transport stop of a take: the beat of the last playing /zustand/arr state after n0
const stoppBeatVon = (n0) => { const z = SSE.m.slice(n0).filter((x) => x.a === '/zustand/arr' && Number(x.f.status) === 2).at(-1); return z ? Number(z.f.projekt_beat) : NaN; };
// the end of the first run of lane points within TOL_HALT of `wert` at or after beat `von` (a jump into the run, e.g. a write take at beat 0, may precede it)
const laufEnde = (punkte, wert, von) => { let ende = NaN, drin = false; for (const q of punkte) { if (q.beat < von) continue; const nah = Math.abs(q.wert - wert) <= TOL_HALT; if (nah) { drin = true; ende = q.beat; } else if (drin) break; } return ende; };
// the run has to reach the real stop beat (a run that ends early OR late is wrong)
const reichtBisStopp = (punkte, wert, von, stopp) => Number.isFinite(stopp) && Math.abs(laufEnde(punkte, wert, von) - stopp) <= TOL_STOPP;
// control material: the same lane with its hold cut short at `schnitt` (the old value comes back there)
const gekuerzt = (punkte, wert, schnitt, rest) => [...punkte.filter((q) => q.beat <= schnitt), { beat: schnitt + 0.01, wert: rest }, ...punkte.filter((q) => q.beat > schnitt && Math.abs(q.wert - wert) > TOL_HALT)];
// AK12 band test with ONE shift for the whole take (within +-1/16 beat): the largest deviation in dB left after the best shift
function abweichung(punkte, refs) {
  let best = Infinity;
  for (let d = -TOL_BEAT; d <= TOL_BEAT + 1e-9; d += 1 / 64) {
    let m = 0;
    for (const r of refs) m = Math.max(m, Math.abs(laneAt(punkte, r.beat + d) - r.db));
    best = Math.min(best, m);
  }
  return best;
}
// The Stellwerk keeps a human holder on a gripped path for 32 beats (INTERFACES 7.3 point 4); the clock runs while stopped
// (128 BPM: free after 15.9 s), and a core restart restores the holder with 32 fresh beats. Wave B's first mixer write would be
// refused with regler_beim_menschen, so wait until a harmless mixer write goes through (bounded; never run wave B blind).
async function halterWarten() {
  const t0 = Date.now();
  // a write to the CURRENT value changes nothing, sends no /k/teil and always answers 200 (vacuous): the probe writes a real change
  // (-0.5 dB) and counts it only if the answer is 200 and the regulator acknowledgement, where present, is ok
  const schreibe = async (sp, wert, label) => {
    const r = await ruf('POST', '/proj/aendern', { rev: await rev(), label, befehle: [{ befehl: 'spur_aendern', spur_id: sp, fader_db: wert }] });
    const reg = r.j?.kern?.regler;
    return { code: r.code, j: r.j, ok: r.code === 200 && (reg === undefined || reg === 'ok' || reg === 'kein_kern'), reg };
  };
  let r = null, orig = null, erste = true;
  while (Date.now() - t0 < 40000) {
    const sp = ((await lageB())?.spuren ?? []).find((x) => x.id === 's1');
    if (!sp) { info('human holder wait: no track s1 in the current project, no holder possible'); return true; }
    orig = sp.fader_db;
    r = await schreibe('s1', orig - 0.5, 'holder probe');
    if (erste) { erste = false; info(`holder probe, first answer: ${r.code} kern ${kurz(r.j?.kern)} ${r.code === 200 ? "" : kurz(r.j).slice(0, 300)}`); }
    if (r.ok || r.code !== 409) break;
    await warte(1500);
  }
  info(`human holder wait before wave B: ${((Date.now() - t0) / 1000).toFixed(1)} s (last probe ${r?.code}, regulator ${r?.reg ?? 'absent'})`);
  if (!r?.ok) { notiere('S13b human holder expired before wave B', false, `no real mixer write went through within 40 s (last ${r?.code} ${kurz(r?.j).slice(0, 200)}); wave B not run`); return false; }
  const z = await schreibe('s1', orig, 'holder probe restore');
  if (!z.ok) { notiere('S13b human holder expired before wave B', false, `the probe write went through but restoring ${orig} dB failed (${z.code} ${kurz(z.j).slice(0, 200)}); wave B not run`); return false; }
  return true;
}

// one take: arm the tracks (Andreas), play from 0, run `geste`, stop, wait for the write, disarm
async function nimm(ids, modus, geste) {
  ids = [].concat(ids);
  const n0 = marke(), r0 = await nRecord();
  for (const id of ids) {
    const ar = await ruf('POST', '/proj/auto/arm', { spur_id: id, an: true, modus });
    if (ar.code !== 200) throw new Error(`arm ${id} ${modus}: ${ar.code} ${kurz(ar.j).slice(0, 200)}`);
  }
  await geladen();
  await starteTransport();
  await geste();
  await stoppeTransport();
  const stoppBeat = stoppBeatVon(n0);
  const geschrieben = await bisWahr(async () => (await nRecord()) > r0 || SSE.m.slice(n0).some((x) => x.a === 'proj' && x.f?.auto_aufnahme?.fehler), 6000);
  await warte(500);
  const frei = await ruf('POST', '/proj/auto/arm', { alle: true });
  if (frei.code !== 200) throw new Error(`disarm ${frei.code} ${kurz(frei.j).slice(0, 200)}`);
  const aufn = SSE.m.slice(n0).filter((x) => x.a === 'proj' && x.f?.auto_aufnahme).map((x) => x.f.auto_aufnahme);
  return { n0, r0, geschrieben, aufn, stoppBeat, neu: (await nRecord()) - r0 };
}
const aufnText = (t) => `auto_aufnahme ${kurz(t.aufn.map((a) => a.fehler ? `${a.spur_id}/${a.ziel}:${a.fehler}` : `${a.spur_id}/${a.ziel}:ok`))}`;

async function welleB() {
  info('---- wave B: record a take into a lane ----');
  // ---- B0 project ----
  const neu = await ruf('POST', '/proj/neu', { name: `a3b-abnahme-${zeit}` });
  SLUG_B = slug = neu.j.slug;
  const lanes = [['s2', [{ beat: 0, wert: -6 }, { beat: 64, wert: -6 }]], ['s3', [{ beat: 0, wert: -10 }, { beat: 64, wert: -40 }]], ['s4', [{ beat: 0, wert: -3 }, { beat: 64, wert: -3 }]], ['s5', [{ beat: 0, wert: -4 }, { beat: 64, wert: -4 }]]];
  await aendern('a3b setup', [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 64 },
    ...[1, 2, 3, 4, 5].map((i) => ({ befehl: 'spur_neu', art: 'audio', name: `T${i}` })),
    ...lanes.map(([sid, punkte]) => ({ befehl: 'auto_neu', spur_id: sid, ziel: 'fader', punkte }))]);
  await geladen();
  await warte(1500);
  const p0 = await lageB();
  notiere('B0 project', p0.spuren.length === 5 && lanes.every(([sid]) => p0.spuren.find((x) => x.id === sid)?.automation?.length === 1) && !p0.spuren[0].automation?.length,
    `tracks ${p0.spuren.map((x) => `${x.id}:${(x.automation ?? []).length}`).join(' ')}, 128 BPM, loop 0..64, no clips`);

  // ---- B1 negative: nothing armed ----
  {
    const sp0 = (await lageB()).spuren, vorher = kurz(sp0.map((x) => x.automation ?? [])), h0 = (await verlaufB()).length, r0 = await nRecord(), n0 = marke(), g0 = abgelehnteGriffe.length;
    await starteTransport();
    await dreieck(1, 4);
    await dreieck(5, 4);
    await stoppeTransport();
    await warte(1500);
    const nachher = kurz((await lageB()).spuren.map((x) => x.automation ?? [])), aufn = SSE.m.slice(n0).filter((x) => x.a === 'proj' && x.f?.auto_aufnahme).length;
    const sp1 = (await lageB()).spuren;
    info(`B1 the hand moves the base fader of the tracks it touches (that is the product, not a take): ${sp1.map((x, i) => (x.fader_db === sp0[i].fader_db ? null : `${x.id} ${sp0[i].fader_db} -> ${x.fader_db.toFixed(3)}`)).filter(Boolean).join(', ') || 'none'}; new history entries ${kurz((await verlaufB()).slice(h0).map((e) => e.label))}`);
    notiere('B1 nothing armed: gestures change no lane and write no take (no Record entry, no auto_aufnahme event); every grip was accepted', vorher === nachher && (await nRecord()) === r0 && aufn === 0 && abgelehnteGriffe.length === g0,
      `lanes of all tracks byte-identical ${vorher === nachher}, Record entries ${r0} -> ${await nRecord()}, auto_aufnahme events ${aufn}, refused grips ${abgelehnteGriffe.length - g0}`);
    await ruf('POST', '/proj/auto/re_enable', { alle: true });   // the grips overrode the lanes of s1/s5 (wave A): give them back
    await geladen();
  }

  // ---- B2 AK12 touch take ----
  const unberuehrt = { s2: await laneJson('s2'), s3: await laneJson('s3'), s5: await laneJson('s5') };
  {
    const t = await nimm('s1', 'touch', async () => { await warte(1000); await ak12Geste(1); await warte(700); });
    const lane = await laneVon('s1');
    const refs = referenzen(t.n0, 1).filter((r) => r.db < 6 && r.db > -200);
    fs.writeFileSync(path.join(ORDNER, 'roh', 'ak12_referenzen.json'), kurz({ refs: refs.map((r) => [+r.beat.toFixed(3), +r.db.toFixed(2)]), punkte: lane?.punkte ?? null }));
    const max = lane && refs.length ? abweichung(lane.punkte, refs) : NaN;
    const refTief = refs.length ? Math.min(...refs.map((r) => r.db)) : NaN, laneTief = lane ? Math.min(...lane.punkte.map((q) => q.wert)) : NaN;
    const verl = await verlaufB();
    notiere('B2a AK12 a lane exists with <= 40 points, one Record entry', !!lane && lane.punkte.length <= 40 && t.neu === 1 && /^Record/.test(verl.at(-1)?.label ?? ''), `points ${lane?.punkte.length ?? 'no lane'}, new Record entries ${t.neu}, last entry "${verl.at(-1)?.label}", ${aufnText(t)}`);
    notiere('B2b AK12 lane within 0.5 dB and 1/16 beat (one shift for the whole take) of the core references; the gesture was deep enough', !!lane && refs.length > 40 && max <= TOL_DB && refTief <= -TIEFE_MIN && laneTief <= -TIEFE_MIN,
      `${refs.length} references (beat from the grip sample and the transport state), lowest reference ${refTief.toFixed(1)} dB, lowest lane point ${laneTief.toFixed(1)} dB (needs <= -${TIEFE_MIN}), max deviation after the best shift ${max.toFixed(3)} dB (limit ${TOL_DB})`);
    if (lane && refs.length) {   // controls: the SAME function must fire on a lane 1 dB off and on lanes 0.1, 0.2 and 0.5 beat late
      const falsch = lane.punkte.map((q) => ({ ...q, wert: q.wert + 1 })), spaet = (d) => lane.punkte.map((q) => ({ ...q, beat: q.beat + d }));
      const a = [abweichung(falsch, refs), abweichung(spaet(0.1), refs), abweichung(spaet(0.2), refs), abweichung(spaet(0.5), refs)];
      notiere('CTL3 the AK12 band test fires on a lane 1 dB off and on lanes 0.1, 0.2 and 0.5 beat late', a.every((x) => x > TOL_DB), `1 dB off ${a[0].toFixed(2)} dB, 0.1 beat late ${a[1].toFixed(2)}, 0.2 late ${a[2].toFixed(2)}, 0.5 late ${a[3].toFixed(2)} (limit ${TOL_DB})`);
    }
    {   // B2e: the field beat is the core beat (Spec R2): its steps follow the sample steps; the control is one reference shifted by 0.1 beat
      const fa = feldKonsistenz(refs);
      const mitSprung = refs.map((r, i) => (i === Math.floor(refs.length / 2) ? { ...r, feldBeat: r.feldBeat + 0.1 } : r));
      const fk = feldKonsistenz(mitSprung);
      notiere('B2e the /e/hand core beat field advances with the sample clock between references (within 1/16 beat); the control with a 0.1 beat jump fires', Number.isFinite(fa) && fa <= TOL_BEAT && fk > TOL_BEAT,
        `largest step deviation ${Number.isFinite(fa) ? fa.toFixed(4) : 'no field beat'} beats over ${refs.length} references (limit ${TOL_BEAT}); control with a 0.1 beat jump in one reference ${Number.isFinite(fk) ? fk.toFixed(4) : 'n/a'}`);
    }
    const ud = await ruf('POST', '/proj/undo', { rev: await rev() });
    const nach = await laneVon('s1');
    const andere = (await laneJson('s2')) === unberuehrt.s2 && (await laneJson('s3')) === unberuehrt.s3 && (await laneJson('s5')) === unberuehrt.s5;
    notiere('B2c AK12 undo removes the whole take', ud.code === 200 && nach === null && andere, `undo ${ud.code}, lane of s1 after undo ${nach === null ? 'gone' : 'still there'}, the lanes s2, s3, s5 unchanged ${andere}`);
    const redo = await ruf('POST', '/proj/redo', { rev: await rev() });
    notiere('B2d AK12 redo brings it back (control for the undo)', redo.code === 200 && (await laneVon('s1')) !== null, `redo ${redo.code}, lane ${(await laneVon('s1')) ? 'back' : 'missing'}`);
  }

  // ---- B3 AK13 latch ----
  {
    const vorLane = (await laneVon('s2')).punkte;
    const t = await nimm('s2', 'latch', async () => { await warte(1000); await schiebe(2); await warte(5.5 * BEAT_MS); });
    const lane = await laneVon('s2');
    const refs = referenzen(t.n0, 2).filter((r) => r.db < 6 && r.db > -200);
    const letzter = refs.at(-1), stopp = t.stoppBeat;
    // the held value is read from the lane 1.5 beats after the last reference; it must match that reference within TOL_LETZTE (/e/hand is throttled, its last message may lie before the last grip), stay flat (0.5 dB) and reach the real stop
    const haelt = (pk) => { if (!letzter || !Number.isFinite(stopp)) return false; const h = laneAt(pk, letzter.beat + 1.5); return Math.abs(h - letzter.db) <= TOL_LETZTE && reichtBisStopp(pk, h, letzter.beat, stopp) && [letzter.beat + 1.5, stopp - 0.3].every((b) => b > letzter.beat && Math.abs(laneAt(pk, b) - h) <= TOL_HALT); };
    const weg = letzter ? Math.abs(letzter.db - (-6)) : 0;
    notiere('B3a AK13 latch holds the last value up to the real stop', !!lane && refs.length > 5 && haelt(lane.punkte) && weg > 1.5, `last reference ${letzter?.db.toFixed(2)} dB at beat ${letzter?.beat.toFixed(2)}, real stop beat ${stopp.toFixed(2)} (last playing /zustand/arr), hold run ends at ${lane && letzter ? laufEnde(lane.punkte, laneAt(lane.punkte, letzter.beat + 1.5), letzter.beat).toFixed(2) : 'n/a'} (limit +-${TOL_STOPP}), lane at stop-0.3: ${lane ? laneAt(lane.punkte, stopp - 0.3).toFixed(2) : 'n/a'} dB, the value is ${weg.toFixed(1)} dB away from the lane before, ${aufnText(t)}`);
    notiere('CTL4 the same hold test fails on the lane before the take', !haelt(vorLane), 'lane before: flat -6 dB');
    if (lane && letzter) notiere('CTL4b the same hold test fails on a latch released 3 beats early', !haelt(gekuerzt(lane.punkte, letzter.db, stopp - 3, -6)), `the take's lane cut at beat ${(stopp - 3).toFixed(2)}`);
    const n1 = lane?.punkte ?? [];
    notiere('B3b AK13 latch leaves the lane before the grip alone', n1.length > 0 && Math.abs(laneAt(n1, 0.5) - laneAt(vorLane, 0.5)) <= TOL_HALT, `beat 0.5: before ${laneAt(vorLane, 0.5).toFixed(2)} dB, after ${n1.length ? laneAt(n1, 0.5).toFixed(2) : 'n/a'} dB`);
  }

  // ---- B4 AK13 write ----
  {
    const vorLane = (await laneVon('s3')).punkte;
    const basis = (await lageB()).spuren.find((x) => x.id === 's3').fader_db;
    const t = await nimm('s3', 'write', async () => { await warte(6 * BEAT_MS); });
    const lane = await laneVon('s3');
    const stopp = t.stoppBeat;
    const gefuellt = (pk) => Number.isFinite(stopp) && reichtBisStopp(pk, basis, 0, stopp) && [1, 3, stopp - 0.5].filter((b) => b > 0.5 && b < stopp).every((b) => Math.abs(laneAt(pk, b) - basis) <= TOL_HALT);
    const beats = [1, 3, stopp - 0.5].filter((b) => b > 0.5 && b < stopp);
    notiere('B4a AK13 write fills start to the real stop with the base value without a touch', !!lane && t.neu === 1 && gefuellt(lane.punkte), `base ${basis} dB, real stop beat ${stopp.toFixed(2)}, fill run ends at ${lane ? laufEnde(lane.punkte, basis, 0).toFixed(2) : 'n/a'} (limit +-${TOL_STOPP}), lane at ${beats.map((b) => `${b.toFixed(1)}:${lane ? laneAt(lane.punkte, b).toFixed(2) : 'n/a'}`).join(' ')} (before the take ${beats.map((b) => laneAt(vorLane, b).toFixed(2)).join(' ')}), new Record entries ${t.neu}, ${aufnText(t)}`);
    notiere('CTL5 the same fill test fails on the lane before the take', !gefuellt(vorLane), `before: ${beats.map((b) => `${b.toFixed(1)}:${laneAt(vorLane, b).toFixed(2)}`).join(' ')}`);
    if (lane) notiere('CTL5b the same fill test fails on a write cut short 3 beats before the stop', !gefuellt(gekuerzt(lane.punkte, basis, stopp - 3, -20)), `the take's lane cut at beat ${(stopp - 3).toFixed(2)}`);
  }

  // ---- B5 AK13 touch outside the gesture ----
  {
    const vorLane = (await laneVon('s4')).punkte;
    const t = await nimm('s4', 'touch', async () => { await warte(1000); await dreieck(4, 4); await warte(700); });
    const lane = await laneVon('s4');
    const refs = referenzen(t.n0, 4).filter((r) => r.db < 6 && r.db > -200);
    const tief = refs.length ? refs.reduce((a, b) => (b.db < a.db ? b : a)) : null;
    const gestenEnde = lane && tief ? (lane.punkte.find((q) => q.beat > tief.beat && Math.abs(q.wert - laneAt(vorLane, q.beat)) <= TOL_AUSSEN)?.beat ?? NaN) : NaN;   // the first point after the trough that is back on the old lane
    const aussen = lane ? [0.3, 40].map((b) => Math.abs(laneAt(lane.punkte, b) - laneAt(vorLane, b))) : [NaN];
    notiere('B5a AK13 touch leaves the lane outside the gesture alone, the gesture span differs', !!lane && aussen.every((d) => d <= TOL_AUSSEN) && !!tief && Number.isFinite(gestenEnde) && Math.abs(laneAt(lane.punkte, tief.beat) - laneAt(vorLane, tief.beat)) > 1.5,
      `outside (beat 0.3, 40) changed by ${aussen.map((d) => d.toFixed(3)).join(' / ')} dB (limit ${TOL_AUSSEN}); at the trough beat ${tief?.beat.toFixed(2)} the lane is ${lane && tief ? laneAt(lane.punkte, tief.beat).toFixed(2) : 'n/a'} dB, before ${tief ? laneAt(vorLane, tief.beat).toFixed(2) : 'n/a'} dB; gesture span ends at beat ${gestenEnde.toFixed(2)}, ${aufnText(t)}`);
    const jetzt = { s2: await laneJson('s2'), s3: await laneJson('s3'), s5: await laneJson('s5') };
    notiere('B5b AK13/negative: the unarmed s5 keeps its lane byte-identical', jetzt.s5 === unberuehrt.s5, `s5 identical ${jetzt.s5 === unberuehrt.s5} (s2 and s3 were recorded in B3/B4 on purpose: changed ${jetzt.s2 !== unberuehrt.s2} / ${jetzt.s3 !== unberuehrt.s3})`);
    notiere('CTL6 the identity test fires on a lane that was recorded', jetzt.s2 !== unberuehrt.s2 && jetzt.s3 !== unberuehrt.s3, 's2 (latch) and s3 (write) differ from before the takes');
  }

  // ---- B5c AK13 batch: one write take with two armed tracks and two unarmed ones (D16: ONE aendern, label "Record N fields") ----
  {
    const vor = { s2: await laneJson('s2'), s3: await laneJson('s3'), s4: await laneJson('s4'), s5: await laneJson('s5') };
    const t = await nimm(['s2', 's3'], 'write', async () => { await warte(4 * BEAT_MS); });
    const verl = await verlaufB();
    const nach = { s2: await laneJson('s2'), s3: await laneJson('s3'), s4: await laneJson('s4'), s5: await laneJson('s5') };
    notiere('B5c AK13/D16 a write take with two armed tracks is ONE history entry "Record 2 fields"; both lanes change; the unarmed s4 and s5 stay byte-identical', t.neu === 1 && verl.at(-1)?.label === 'Record 2 fields' && nach.s2 !== vor.s2 && nach.s3 !== vor.s3 && nach.s4 === vor.s4 && nach.s5 === vor.s5,
      `new Record entries ${t.neu}, last entry "${verl.at(-1)?.label}", s2 changed ${nach.s2 !== vor.s2}, s3 changed ${nach.s3 !== vor.s3}, s4 identical ${nach.s4 === vor.s4}, s5 identical ${nach.s5 === vor.s5}, ${aufnText(t)}`);
    const ud = await ruf('POST', '/proj/undo', { rev: await rev() });
    const zurueck = { s2: await laneJson('s2'), s3: await laneJson('s3'), s4: await laneJson('s4'), s5: await laneJson('s5') };
    notiere('B5d AK13/D16 one undo reverts both tracks together; the unarmed ones are still byte-identical', ud.code === 200 && zurueck.s2 === vor.s2 && zurueck.s3 === vor.s3 && zurueck.s4 === vor.s4 && zurueck.s5 === vor.s5, `undo ${ud.code}, s2 back ${zurueck.s2 === vor.s2}, s3 back ${zurueck.s3 === vor.s3}, s4 identical ${zurueck.s4 === vor.s4}, s5 identical ${zurueck.s5 === vor.s5}`);
  }

  // ---- B6 AK15 ----
  {
    const arm0 = (await aktuell()).auto_arm;
    const faelle = [['/proj/auto/arm', { spur_id: 's1', an: true, modus: 'touch' }], ['/proj/auto/arm', { modus: 'write' }], ['/proj/auto/arm', { alle: true }],
      ['/proj/auto/geste', { spur_id: 's1', ziel: 'fader', wert: -3 }], ['/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'fader' }]];
    const erg = [];
    for (const [weg, k] of faelle) { const r = await ruf('POST', weg, k, CYPHER); erg.push([weg, r.code, r.j?.fehler, r.j?.kern?.grund]); }
    const arm1 = (await aktuell()).auto_arm;
    notiere('B6a AK15 Cypher arm, mode, disarm-all, gesture and override are 403 nur_andreas, no state changes', erg.every((e) => e[1] === 403 && e[2] === 'nur_andreas') && kurz(arm0) === kurz(arm1) && (await liste()).length === 0,
      `${erg.map((e) => `${e[0].replace('/proj/auto/', '')} ${e[1]} ${e[2]}${e[3] ? ` (core ${e[3]})` : ''}`).join('; ')}; arm state before ${kurz(arm0)} after ${kurz(arm1)}`);
    const ok = await ruf('POST', '/proj/auto/arm', { spur_id: 's1', an: true, modus: 'touch' });
    const gegen = await ruf('POST', '/proj/auto/arm', { spur_id: 's2', an: true, modus: 'write' }, CYPHER);
    const arm2 = (await aktuell()).auto_arm;
    notiere('B6b AK15 control: Andreas arms (200); Cypher against an armed track is still refused and changes neither track nor mode', ok.code === 200 && gegen.code === 403 && gegen.j?.fehler === 'nur_andreas' && kurz(arm2) === kurz({ modus: 'touch', spuren: ['s1'] }), `Andreas ${ok.code}, Cypher ${gegen.code} ${gegen.j?.fehler}, arm state ${kurz(arm2)}`);
    await ruf('POST', '/proj/auto/arm', { alle: true });
  }

  // ---- B7 AK17 ----
  {
    const l5 = await laneVon('s5');
    await aendern('lock', [{ befehl: 'auto_aendern', lane_id: l5.id, gesperrt: true }]);
    const vorSperre = await laneJson('s5');
    const rev0 = await rev();
    const punkt = (kopf = {}) => ruf('POST', '/proj/aendern', { rev: rev0, label: 'points', befehle: [{ befehl: 'auto_punkte', lane_id: l5.id, setze: [{ beat: 8, wert: -9 }] }] }, kopf);
    const pa = await punkt(), pc = await punkt(CYPHER);
    notiere('B7a AK17 a locked lane refuses points (page route and Cypher)', pa.code === 409 && pa.j?.fehler === 'lane_gesperrt' && pc.code === 409 && pc.j?.fehler === 'lane_gesperrt' && (await laneJson('s5')) === vorSperre, `Andreas ${pa.code} ${pa.j?.fehler}, Cypher ${pc.code} ${pc.j?.fehler}, lane byte-identical ${(await laneJson('s5')) === vorSperre}`);
    const t = await nimm('s5', 'touch', async () => { await warte(1000); await dreieck(5, 4); await warte(700); });
    notiere('B7b AK17 a take on a locked lane writes nothing and says lane_gesperrt', t.neu === 0 && t.aufn.some((a) => a.fehler === 'lane_gesperrt' && a.spur_id === 's5') && (await laneJson('s5')) === vorSperre, `new Record entries ${t.neu}, ${aufnText(t)}, lane byte-identical ${(await laneJson('s5')) === vorSperre}`);
    await aendern('unlock', [{ befehl: 'auto_aendern', lane_id: l5.id, gesperrt: false }]);
    const t2 = await nimm('s5', 'touch', async () => { await warte(1000); await dreieck(5, 4); await warte(700); });
    const pu = await ruf('POST', '/proj/aendern', { rev: await rev(), label: 'points', befehle: [{ befehl: 'auto_punkte', lane_id: l5.id, setze: [{ beat: 20, wert: -9 }] }] });
    notiere('B7c AK17 control: unlocked, a take writes (1 Record entry, lane changed) and points are accepted', t2.neu === 1 && (await laneJson('s5')) !== vorSperre && pu.code === 200, `new Record entries ${t2.neu}, lane changed ${(await laneJson('s5')) !== vorSperre}, points ${pu.code}, ${aufnText(t2)}`);
  }

  // ---- B8 AK14: NOT measured by this script ----
  {
    const wurzel = path.join(os.homedir(), 'messungen/2026-11-01-automation-slice3/ak14');
    let letzte = null;
    try { for (const d of fs.readdirSync(wurzel).sort((x, y) => Number(x.replace(/\D/g, '')) - Number(y.replace(/\D/g, '')))) { const f = path.join(wurzel, d, 'ak14_ergebnis.json'); if (fs.existsSync(f)) letzte = { d, j: JSON.parse(fs.readFileSync(f, 'utf-8')) }; } } catch { /* none */ }
    nichtGemessen('B8 AK14 on the real core', `this script does not measure the mouse offset (it needs the page in Chrome: check/listening_sample_a3.mjs style probe, main instance). Stand-in value only, for information, NOT a verdict: ${letzte ? `${letzte.d} max ${Number(letzte.j.max_abs_ms).toFixed(1)} ms, median ${Number(letzte.j.median_abs_ms).toFixed(1)} ms, n ${letzte.j.n}` : 'no stand-in result found'}`);
  }
  if (abgelehnteGriffe.length) info(`refused hand grips during wave B (informational, B1 asserts its own): ${abgelehnteGriffe.length}`);
}

// cleanup, once, from the normal end and from SIGINT / SIGTERM
let aufgeraeumt = false;
async function aufraeumen() {
  if (aufgeraeumt) return;
  aufgeraeumt = true;
  try { await SSE?.stop(); } catch { /* done */ }
  try { await stoppeTransport(); } catch { /* done */ }
  for (const sl of [slug, SLUG_B]) if (sl && !ATT) { try { fs.rmSync(path.join('/dev/shm', `cypherdj-${I}`, 'projekte', sl), { recursive: true, force: true }); } catch { /* done */ } }
  await stoppeInstanz();
  try { await STAPEL?.stoppe(); } catch { /* done */ }
  if (ATT_DIR) fs.rmSync(ATT_DIR, { recursive: true, force: true });
  entlinke();
  fs.rmSync(ZIEL, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { process.stderr.write(`abnahme_a3: ${sig}, cleaning up\n`); aufraeumen().finally(() => process.exit(130)); });

let rc = 0;
try {
  await haupt();
} catch (e) {
  notiere('ABBRUCH', false, `${e.message}`);
  process.stderr.write(`${e.stack}\n`);
} finally {
  await aufraeumen();
  notiere('S14 instance stopped, links removed', !aufgebaut && links.length === 0, ATT ? `stand-in stack on ${I} stopped` : `instance ${I} down`);
  fs.writeFileSync(path.join(ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
  fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# abnahme_a3 ${zeit} (instance ${I}, ${ATT ? 'STAND-IN stack, not the product core' : `real core ${BAU}`})\n\n${zeilen.join('\n')}\n`);
  process.stdout.write(`\n${fehl === 0 ? `ALLES OK (${MODUS})` : `${fehl} FEHL (${MODUS})`}${nichtGem ? ` · ${nichtGem} NOT MEASURED (see NICHT GEMESSEN lines)` : ''} · report ${path.join(ORDNER, 'bericht.md')}\n`);
  rc = fehl === 0 ? 0 : 1;
}
process.exit(rc);
