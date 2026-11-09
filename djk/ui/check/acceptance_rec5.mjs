// Target acceptance, 1.8 recording slice 5 (MIDI recording, AK22 to AK25), against a TEST INSTANCE with the freshly built core (instances b, d or e only, never
// f, never the operation; the script refuses every other letter). The caller (one locked shell command)
//   * holds flock /dev/shm/cypherdj-instanz-<i>.flock and, nested inside, flock "$CYPHERDJ_ECHTZEIT_SCHLOSS",
//   * writes the fixture ~/.config/cypherdj-<i>/geraete.json (input 1: the probe client cypherdj-pruef-ein:a_L, frei_fuer_cypher false; midi.port
//     cypherdj-pruef-ein:m, no versatz_samples), records the unit states and the sha of that file,
//   * starts the instance (DJK=<worktree>/djk djk/start/djk-start --instanz <i> --ohne-pruefmodus, silent sink), runs this script, stops it, restores file and units.
//   node check/acceptance_rec5.mjs --url http://127.0.0.1:5<port> --bau <core build folder> [--ausgabe <folder>] [--instanz d] [--nur Z1,Z2,Z3,Z4,NK]
//        [--bruch overdub] [--demo-versatz <frames>]
// The proof client (core/check/in_check.cpp) sends, every 2 s, an impulse on ein_1_L and a note on midi_ein_1 in the SAME frame (note off after K frames,
// a pitch list, several offsets; the held variant for Z3). The core reports the sample of the last impulse flank (/zustand/ein, polled through /geraete),
// so every note of a take has its impulse in the core time line.
// Criteria:
//   Z1  AK22 an instrument-only run (no audio track armed), 16 pairs: the take file has the layout the server reads (12-byte records, sidecar), the notes are
//       placed with the pitches of the list and the length of the note off, and each placed note lies on its impulse within +-2 samples after the MIDI offset.
//       A constant offset with spread <= 2 is reported as FINDING midi_versatz=<mean>, written ONLY into the fixture (midi.versatz_samples), and the run
//       is repeated ONCE (the value for Andreas' own device file is his, D4, D15).
//   Z2  AK23 live play: 8 notes on an RB-338 track with the MIDI bit set, transport stopped, nothing recording. After each note the master rises above
//       -60 dBFS out of quiet; the onset delay against the stamp is reported. Negative control: the track disarmed gives no tone. The Surge part runs only if
//       djk-instrumente --arr1 starts for this instance, else NICHT_PRUEFBAR.
//   Z3  AK24 a held note: the key is still down when the recording stops. The master falls below -90 dBFS within 100 ms after the stop, the take closes the
//       note at its end. live_offene_noten() is not visible outside the process (test_kern_live K5 holds it): NICHT_PRUEFBAR here. Negative control: the
//       same measurement on a tone that is NOT stopped reports a hanging note.
//   Z4  AK25 overdub: with the project setting overdub a second run doubles the notes, the first ids and their content unchanged, no id used twice.
//       --bruch overdub leaves the setting off: the second run replaces, and the cell must say FEHL.
//   NK  negative control and its positive partner: a run with an audio track and an instrument track armed. With the MIDI edge in place both are placed; with the
//       edge removed the instrument track gets keine_noten and no note, the audio take is still placed with its impulses and the core saw no MIDI event.
//   --demo-versatz N: the client puts every note N frames after its impulse (a known constant offset); Z1 must then say FINDING midi_versatz=N, write it
//       and pass on the rerun (the positive control of the offset handling).
// Return: 0 all OK (NICHT_PRUEFBAR and INFO/FINDING do not count), 1 at least one FEHL, 2 usage. Raw data go to rohdaten.json, the take files to the output
// folder. Only the own projects (slug rec5-...) are removed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_target.mjs';
import { leseWav } from './w1_wav.mjs';
import { kanaele } from './a2_measure.mjs';
import { klickOrte } from './rec_measure.mjs';
import { leseMidiDatei } from '../project/recording.ts';
import {
  RATE, noteOnStempel, noteLaengen, frischeFlanken, platziertAbw, urteilVersatz, versatzFinding, endePruefung, onsetsNach, tonAb, verdoppelt,
} from './rec5_measure.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_rec5: usage: --url <test instance> --bau <core build folder> [--ausgabe <folder>] [--instanz <b|d|e>] [--nur Z1,Z2,Z3,Z4,NK] '
    + '[--bruch overdub] [--demo-versatz <frames>]\n');
  process.exit(2);
}
const z = starte('abnahme_rec5', 'rec5', { bau: { type: 'string' }, nur: { type: 'string' }, bruch: { type: 'string' }, 'demo-versatz': { type: 'string' } }, { ohneAufbau: true });
const { notiere, info, instanz, warte } = z;
if (!z.opt.bau) { process.stderr.write('abnahme_rec5: --bau <core build folder> is required (cypherdj-pruef-ein, cypherdj-mitschnitt)\n'); process.exit(2); }
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`abnahme_rec5: instance ${instanz} is not allowed: b, d or e only (never f)\n`); process.exit(2); }
if (z.opt.bruch !== undefined && z.opt.bruch !== 'overdub') { process.stderr.write('abnahme_rec5: --bruch knows only "overdub"\n'); process.exit(2); }
const DEMO = z.opt['demo-versatz'] === undefined ? 0 : Number(z.opt['demo-versatz']);
if (!Number.isInteger(DEMO) || DEMO < 0 || DEMO > 55) { process.stderr.write('abnahme_rec5: --demo-versatz is an integer of 0 to 55 frames (offset + N must stay inside a cycle of 256)\n'); process.exit(2); }
const BAU = path.resolve(z.opt.bau);
const NUR = z.opt.nur ? new Set(z.opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const SHM = `/dev/shm/cypherdj-${instanz}`;
const KANTEN = path.join(SHM, 'eingaenge-kanten');
const GERAETE = path.join(os.homedir(), '.config', `cypherdj-${instanz}`, 'geraete.json');
const PW = { PIPEWIRE_PROPS: `{ node.group = cypherdj-${instanz} node.lock-quantum = true }` };
const BPM = 120;
const RB = { art: 'intern', name: 'rb338', parameter: { cutoff: 0.6, resonanz: 0.3, env_mod: 0.2 } };
const LAUT = 10 ** (-60 / 20);
const roh = {}, nichtPruefbar = [];
const npb = (kz, grund) => { nichtPruefbar.push(`${kz}: ${grund}`); info(`NICHT_PRUEFBAR ${kz}: ${grund}`); };
const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'absent');
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x));
const dbOf = (v) => (v > 1e-10 ? 20 * Math.log10(v) : -200);
const maxAbs = (x, a, b) => { let m = 0; for (let i = Math.max(0, a); i < Math.min(b, x.length); i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const lebendig = new Set();   // child processes of this script: killed by PID at the end

const prog = (programm, args, env = {}) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz, ...env } });
  lebendig.add(p);
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => { lebendig.delete(p); res({ rc: -1, out, err: `${err}${e.message}` }); });
  p.on('close', (rc) => { lebendig.delete(p); res({ rc, out, err }); });
});
const jsonZeile = (t) => { try { return JSON.parse(t.trim().split('\n').filter(Boolean).pop()); } catch { return null; } };

// ---- fixture and edge file ----
const leseKonfig = () => JSON.parse(fs.readFileSync(GERAETE, 'utf8'));
const geraeteOriginal = fs.existsSync(GERAETE) ? fs.readFileSync(GERAETE, 'utf8') : null;
function schreibeVersatz(v) {   // only the fixture of this instance; atomic like the page server
  const k = leseKonfig();
  if (v === null) delete k.midi.versatz_samples; else k.midi.versatz_samples = v;
  const t = `${GERAETE}.rec5.teil`;
  fs.writeFileSync(t, JSON.stringify(k, null, 1) + '\n');
  fs.renameSync(t, GERAETE);
}
const schreibeKanten = (text) => { const t = `${KANTEN}.rec5.teil`; fs.writeFileSync(t, text); fs.renameSync(t, KANTEN); };
const geraete = async () => z.erwarte200('/geraete', await z.ruf('GET', '/geraete')).j;
async function bisMidi(soll, ms = 8000) { return z.bisWahr(async () => (await geraete()).midi.verbunden === soll, ms); }

async function ereignis(adresse, ms = 8000) {   // first event of /strom with this address
  const ac = new AbortController(), uhr = setTimeout(() => ac.abort(), ms);
  let fund = null;
  try {
    const r = await fetch(z.URL + '/strom', { signal: ac.signal });
    const dec = new globalThis.TextDecoder();
    let puf = '';
    suche: for await (const stueck of r.body) {
      puf += dec.decode(stueck, { stream: true });
      let i;
      while ((i = puf.indexOf('\n\n')) >= 0) {
        const block = puf.slice(0, i); puf = puf.slice(i + 2);
        if (!block.startsWith('data: ')) continue;
        try { const m = JSON.parse(block.slice(6)); if (m.a === adresse) { fund = m.f; break suche; } } catch { /* half line */ }
      }
    }
  } catch { /* aborted by the timer */ } finally { clearTimeout(uhr); ac.abort(); }
  return fund;
}

// ---- project ----
async function geladen() {   // like z.geladen, but a MIDI clip carries no decode state and a project without a clip may have no playback revision
  const ok = await z.bisWahr(async () => {
    const s = await z.zustandKurz();
    return s.dekodiert.every((d) => d === 'fertig' || d === null || d === undefined) && s.kern?.status === 0 && (!(s.wiedergabe_rev > 0) || s.kern?.rev_geladen === s.wiedergabe_rev);
  });
  if (!ok) throw new Fehl(`playback not loaded after 40 s: ${JSON.stringify(await z.zustandKurz())}`);
}
const projekt = async () => (await z.aktuell()).projekt;
async function baueProjekt(name, { audio = false, arm = true, geraet = RB } = {}) {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);
  await warte(500);
  await z.neuesProjekt(name);
  await z.aendern(`rec5 ${name} tempo`, [{ befehl: 'tempo_setzen', bpm: BPM }]);
  let audioId = null;
  if (audio) {
    await z.aendern(`rec5 ${name} audio track`, [{ befehl: 'spur_neu', art: 'audio', name: 'In' }]);
    audioId = (await projekt()).spuren.at(-1).id;
    await z.aendern(`rec5 ${name} audio arm`, [{ befehl: 'spur_aendern', spur_id: audioId, eingang: { art: 'extern', paar: 1, modus: 'stereo' }, arm: true }]);
  }
  await z.aendern(`rec5 ${name} instrument track`, [{ befehl: 'spur_neu', art: 'instrument', name: geraet === RB ? 'RB' : 'Surge', geraet }]);
  const instrId = (await projekt()).spuren.at(-1).id;
  await z.aendern(`rec5 ${name} instrument arm`, [{ befehl: 'spur_aendern', spur_id: instrId, eingang: { art: 'midi' }, arm }]);
  await geladen();
  await warte(2500);   // the core has the arm a few cycles after the server sent it, and the rack of the track is built
  return { instrId, audioId };
}
const spurVon = async (id) => (await projekt()).spuren.find((s) => s.id === id);
// all notes of a track with absolute beats (notes are relative to their clip), in time order
async function notenVon(id) {
  const s = await spurVon(id);
  return s.clips.filter((c) => c.art === 'midi').flatMap((c) => (c.noten ?? []).map((n) => ({ ...n, beat: Math.round((c.start_beat + n.beat) * 1e9) / 1e9 })))
    .sort((a, b) => a.beat - b.beat || a.ton - b.ton);
}

// ---- proof client and observation ----
function startClient(args) {
  const p = spawn('pw-jack', [path.join(BAU, 'cypherdj-pruef-ein'), ...args], { env: { ...process.env, ...PW }, stdio: ['pipe', 'pipe', 'pipe'] });
  lebendig.add(p);
  let out = '', err = '';
  let bereit, ende;
  const bereitP = new Promise((r) => { bereit = r; }), endeP = new Promise((r) => { ende = r; });
  p.stdout.on('data', (d) => { out += d; if (/ready:/.test(out)) bereit(true); });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => { err += e.message; bereit(false); ende({ rc: -1, out, err }); });
  p.on('close', (rc) => { lebendig.delete(p); bereit(false); ende({ rc, out, err }); });
  return {
    bereit: bereitP, ende: endeP, pid: p.pid,
    los: () => p.stdin.write('go\n'),
    kill: () => { try { p.kill('SIGTERM'); } catch { /* gone */ } },
  };
}
// polls /geraete (the core reports /zustand/ein at 20 Hz): flank sample, last MIDI sample and the count of MIDI events seen
function beobachte() {
  const w = { flanken: [], midi: [], gesehen: [], letzte: null };
  let an = true;
  const schleife = (async () => {
    while (an) {
      try {
        const e = (await geraete()).kern?.ein;
        if (e) { w.flanken.push(e.flanke_sample); w.midi.push(e.midi_sample); w.gesehen.push(e.midi_gesehen); w.letzte = e; }
      } catch { /* the page restarts or is slow: the next poll */ }
      await warte(40);
    }
  })();
  return { w, stop: async () => { an = false; await schleife; } };
}
async function bisFlanken(obs, n, ms) { return z.bisWahr(async () => frischeFlanken(obs.w.flanken, 0).length >= n, ms); }

// one run of the client against the open project; `waehrend` runs between the start of the series and the stop. Returns what the run left.
async function lauf({ paare, offsets = [100], toene = [60], ausNach = null, periode = 2, spaet = 0, nachSek = 1.2, haeltSek = 0.3, ohneMidiKante = false, ohneStopp = false, ohneAufnahme = false,
  aufMitschnitt = null, waehrend = null }) {
  await geladen();
  const obs = beobachte();
  const args = [String(paare), '--offsets', offsets.join(','), '--pitches', toene.join(','), '--period', String(periode), '--wait-go', '--linger', String(haeltSek)];
  if (ausNach !== null) args.push('--off-after', String(ausNach));
  if (spaet > 0) args.push('--midi-late', String(spaet));
  const klient = startClient(args);
  const r = { args };
  try {
    if (!(await klient.bereit)) throw new Fehl(`the proof client did not start: ${JSON.stringify(await klient.ende)}`);
    if (!(await z.bisWahr(async () => (await geraete()).eingaenge[0].verbunden === true, 8000))) throw new Fehl('input 1 (the impulse) is not connected');
    if (!ohneMidiKante && !(await bisMidi(true))) throw new Fehl('midi_ein_1 is not connected');
    await warte(500);
    r.gesehen0 = obs.w.letzte?.midi_gesehen ?? 0;
    if (aufMitschnitt) r.lesen = await mitschnitt(aufMitschnitt.name, aufMitschnitt.sek);   // the master recording runs from here, the series starts 0.6 s later
    if (!ohneAufnahme) {
      const st = await z.ruf('POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
      if (st.code !== 200) throw new Fehl(`/proj/aufnahme start -> ${z.grundVon(st)}`);
      r.start = st.j;
    }
    klient.los();
    if (waehrend) r.waehrend = await waehrend(klient, obs);
    const ende = await Promise.race([klient.ende, warte((paare * periode + 20) * 1000).then(() => null)]);
    if (!ende) throw new Fehl('the proof client did not finish');
    r.klient = { rc: ende.rc, out: ende.out.trim() };
    if (!ohneStopp && !ohneAufnahme) {
      await warte(nachSek * 1000);
      const sp = await z.ruf('POST', '/proj/aufnahme', { aktion: 'stopp' });
      if (sp.code !== 200) throw new Fehl(`/proj/aufnahme stopp -> ${z.grundVon(sp)}`);
      r.stopp = sp.j;
    }
    r.gesehen1 = obs.w.letzte?.midi_gesehen ?? 0;
  } finally { klient.kill(); await obs.stop(); }
  r.beob = obs.w;
  return r;
}
// the MIDI take of a run: the stop answer entry, the file, the sidecar
function midiTake(r, nr = 0) {
  const e = (r.stopp?.takes ?? []).filter((t) => t.art === 'midi')[nr];
  if (!e) return { eintrag: null };
  if (e.fehler) return { eintrag: e };
  const roh = fs.readFileSync(e.datei);
  let seite = null;
  try { seite = JSON.parse(fs.readFileSync(e.datei.replace(/\.bin$/, '.json'), 'utf8')); } catch { /* no sidecar */ }
  return { eintrag: e, roh, ereignisse: leseMidiDatei(roh), seite };
}
const kopiere = (quelle, name) => { try { fs.copyFileSync(quelle, path.join(z.ORDNER, name)); } catch { /* the take may be missing */ } };

// ---- Z1 ----
const Z1 = { paare: 16, offsets: [100, 37, 200, 129], toene: [45, 48, 52, 57], ausNach: 12000 };
async function auswertenZ1(bp, r, label, mVorher) {
  const t = midiTake(r);
  const n = Z1.paare;
  notiere(`Z1 ${label} the run is an instrument-only run: the start answer lists one instrument track and no audio track`,
    r.start.spuren.length === 1 && r.start.spuren[0].art === 'instrument', JSON.stringify(r.start.spuren));
  if (!t.eintrag || t.eintrag.fehler) { notiere(`Z1 ${label} the MIDI take is placed`, false, JSON.stringify(t.eintrag ?? r.stopp)); return null; }
  kopiere(t.eintrag.datei, `z1-${label.replace(/\W+/g, '-')}.bin`);
  const proSampleBeat = BPM / (60 * RATE);
  // the layout of the real core file against what the server reads
  const e = t.ereignisse, nEv = 2 * n;
  notiere(`Z1 ${label} the file has the layout the server reads: 12-byte records, the sidecar agrees (events, start, end, nothing refused)`,
    t.roh.length === 12 * e.length && e.length === nEv && t.seite?.ereignisse === e.length && t.seite?.abgelehnt === 0 && t.seite?.eingang === 30
    && t.seite?.start_sample <= e[0].sample && t.seite?.ende_sample >= e[e.length - 1].sample && t.eintrag.ereignisse === e.length,
    `${t.roh.length} bytes, ${e.length} events (expected ${nEv}), sidecar ${JSON.stringify(t.seite)}, answer ereignisse ${t.eintrag.ereignisse}`);
  // the client: pitches in turn, note off after K frames, offsets in turn
  const ons = noteOnStempel(e), laengen = noteLaengen(e);
  const tonOk = ons.length === n && ons.every((o, i) => o.ton === Z1.toene[i % Z1.toene.length]);
  const laengeOk = laengen.length === n && laengen.every((l) => l.laenge === Z1.ausNach && l.kanal === 0);
  notiere(`Z1 ${label} the client sent ${n} notes with the pitch list in turn and every note off ${Z1.ausNach} frames after its on`, tonOk && laengeOk,
    `pitches ${ons.map((o) => o.ton).join(',')}; lengths ${[...new Set(laengen.map((l) => l.laenge))].join(',')} frames`);
  const flanken = frischeFlanken(r.beob.flanken, t.seite.start_sample);
  const dEin = ons.map((o, i) => o.sample - flanken[i]);
  roh[`z1_${label}_kern`] = { stempel: ons.map((o) => o.sample), flanken, abstand: dEin };
  notiere(`Z1 ${label} the core saw ${n} impulse flanks in the take, one per note`, flanken.length === n, `${flanken.length} flanks`);
  info(`Z1 ${label} core level: note stamp minus impulse flank ${dEin.join(",")} (the client puts the note ${DEMO} frames after its impulse)`);
  // the placed notes
  const noten = await notenVon(bp.instrId);
  const am = r.start.spuren[0];
  const mFix = mVorher, vorhalt = am.versatz_samples - mFix;
  notiere(`Z1 ${label} ${n} notes are placed on the track, the take answer counts ${t.eintrag.noten}`, noten.length === n && t.eintrag.noten === n, `${noten.length} placed`);
  notiere(`Z1 ${label} the placed notes have the pitches of the list and the length of K = ${Z1.ausNach} frames (${(Z1.ausNach * proSampleBeat).toFixed(6)} beats)`,
    noten.length === n && noten.every((x, i) => x.ton === Z1.toene[i % Z1.toene.length] && Math.abs(x.laenge - Z1.ausNach * proSampleBeat) < 1e-8),
    `lengths ${[...new Set(noten.map((x) => x.laenge))].join(',')} beats`);
  if (flanken.length !== noten.length || noten.length === 0) return { u: urteilVersatz([]), noten, vorhalt };
  const abw = noten.map((x, i) => platziertAbw(x.beat, flanken[i], { startBeat: r.start.start_beat, bpm: BPM, startSample: t.seite.start_sample, vorhalt }));
  const u = urteilVersatz(abw, 2);
  roh[`z1_${label}`] = { abw, u, vorhalt, m: mFix, startSample: t.seite.start_sample, startBeat: r.start.start_beat };
  info(`Z1 ${label} placed note minus impulse (samples, midi.versatz_samples ${mFix}): ${abw.map(f1).join(' ')}; mean ${f1(u.mittel)}, spread ${f1(u.streuung)}`);
  return { u, noten, vorhalt };
}
async function z1() {
  const bp = await baueProjekt('z1');
  state.z1 = bp;
  const m = leseKonfig().midi.versatz_samples ?? 0;
  const r1 = await lauf({ ...Z1, spaet: DEMO });
  const a1 = await auswertenZ1(bp, r1, 'run 1', m);
  if (!a1) return;
  if (a1.u.art === 'ok') {
    notiere('Z1 AK22 every placed note lies on its impulse within +-2 samples after the MIDI offset', true, `deviation ${f1(a1.u.min)} to ${f1(a1.u.max)}, mean ${f1(a1.u.mittel)}`);
    return;
  }
  if (a1.u.art === 'finding') {
    const fw = versatzFinding({ ...a1.u, versatz: m + a1.u.versatz });
    info(`FINDING midi_versatz=${fw.schreibe ?? m + a1.u.versatz} (${a1.u.grund}; the fixture held ${m}); ${fw.schreibe !== null ? 'written into the fixture only, rerun once' : `not written (${fw.grund})`}`);
    roh.z1_finding = { mittel: a1.u.mittel, versatz: m + a1.u.versatz, geschrieben: fw.schreibe };
    if (fw.schreibe !== null) {
      schreibeVersatz(fw.schreibe);
      const bp2 = await baueProjekt('z1-rerun');
      state.z1 = bp2;
      const r2 = await lauf({ ...Z1, spaet: DEMO });
      const a2 = await auswertenZ1(bp2, r2, 'rerun', fw.schreibe);
      notiere('Z1 AK22 rerun with the finding in the fixture: every placed note lies on its impulse within +-2 samples', !!a2 && a2.u.art === 'ok',
        a2 ? `deviation ${f1(a2.u.min)} to ${f1(a2.u.max)}, mean ${f1(a2.u.mittel)}` : 'no evaluation');
      return;
    }
  }
  notiere('Z1 AK22 every placed note lies on its impulse within +-2 samples after the MIDI offset', false, a1.u.grund);
}

// ---- Z4 (continues on the Z1 project) ----
async function z4() {
  let bp = state.z1;
  if (!bp) {   // alone: a first run of its own
    bp = await baueProjekt('z4');
    const r0 = await lauf({ ...Z1 });
    if (!midiTake(r0).eintrag || midiTake(r0).eintrag.fehler) throw new Fehl(`Z4: the first run placed no notes: ${JSON.stringify(r0.stopp)}`);
  }
  const alt = await notenVon(bp.instrId);
  const klipsVor = (await spurVon(bp.instrId)).clips.length;
  notiere('Z4 the first run left 16 notes on the track', alt.length === 16, `${alt.length} notes, ${klipsVor} clip(s)`);
  if (z.opt.bruch === 'overdub') info('Z4 BRUCH overdub: the setting stays off, the second run must replace and the cell must say FEHL');
  else await z.aendern('rec5 z4 overdub', [{ befehl: 'aufnahme_setzen', overdub: true }]);
  await geladen();
  const r = await lauf({ ...Z1 });
  const t = midiTake(r);
  if (!t.eintrag || t.eintrag.fehler) { notiere('Z4 the second take is placed', false, JSON.stringify(t.eintrag ?? r.stopp)); return; }
  const neu = await notenVon(bp.instrId);
  const v = verdoppelt(alt, neu, t.eintrag.noten);
  roh.z4 = { alt: alt.length, neu: neu.length, klips: (await spurVon(bp.instrId)).clips.length, eintrag: t.eintrag, urteil: v, bruch: z.opt.bruch ?? null };
  notiere('Z4 AK25 overdub doubles the notes: the first ids and their content are unchanged, the new ones are fresh', v.ok && neu.length === 2 * alt.length,
    `${alt.length} -> ${neu.length} notes (${t.eintrag.noten} added), clips ${klipsVor} -> ${roh.z4.klips}${v.ok ? '' : `; ${v.grund}`}`);
}

// ---- NK ----
async function mischlauf(name, ohneKante) {
  const bp = await baueProjekt(name, { audio: true });
  const r = await lauf({ paare: 3, offsets: [100], toene: [45, 48, 52], ausNach: 12000, nachSek: 1.5, ohneMidiKante: ohneKante });
  const takes = r.stopp.takes;
  const a = takes.find((x) => x.spur_id === bp.audioId), m = takes.find((x) => x.spur_id === bp.instrId);
  const w = a && a.datei && !a.fehler ? leseWav(a.datei) : null;
  const impulse = w ? klickOrte(w.l, 0.5, 20000).length : -1;
  return { bp, r, a, m, w, impulse, noten: await notenVon(bp.instrId), takes };
}
async function nk() {
  const kantenVor = fs.existsSync(KANTEN) ? fs.readFileSync(KANTEN, 'utf8') : null;
  try {
    const p = await mischlauf('nk-plus', false);
    roh.nk_plus = { takes: p.takes, impulse: p.impulse, noten: p.noten.length, gesehen: [p.r.gesehen0, p.r.gesehen1] };
    notiere('NK positive partner: with the MIDI edge in place the instrument track gets its 3 notes and the audio take holds the 3 impulses',
      p.noten.length === 3 && p.impulse === 3 && !p.m?.fehler && p.r.gesehen1 - p.r.gesehen0 >= 6,
      `${p.noten.length} notes, ${p.impulse} impulses in the audio take, the core saw ${p.r.gesehen1 - p.r.gesehen0} MIDI events (3 on + 3 off); takes ${JSON.stringify(p.takes.map((x) => x.fehler ?? x.art ?? 'audio'))}`);
    if (!kantenVor || !kantenVor.includes('\tmidi_ein_1')) throw new Fehl(`the edge file has no midi_ein_1 line to remove: ${JSON.stringify(kantenVor)}`);
    schreibeKanten(kantenVor.split('\n').filter((l) => l && !l.endsWith('\tmidi_ein_1')).join('\n') + '\n');
    notiere('NK the MIDI edge removed: midi_ein_1 is no longer connected', await bisMidi(false), `edge file now ${JSON.stringify(fs.readFileSync(KANTEN, 'utf8'))}`);
    const n = await mischlauf('nk-minus', true);
    roh.nk_minus = { takes: n.takes, impulse: n.impulse, noten: n.noten.length, gesehen: [n.r.gesehen0, n.r.gesehen1] };
    notiere('NK negative control: without the MIDI edge the instrument track gets no note and the answer says keine_noten',
      n.noten.length === 0 && n.m?.fehler === 'keine_noten', `${n.noten.length} notes; MIDI take ${JSON.stringify(n.m)}`);
    notiere('NK the audio take is still placed with its 3 impulses (the impulse edge was untouched)', !!n.a && !n.a.fehler && n.impulse === 3 && (await spurVon(n.bp.audioId)).clips.length === 1,
      `audio take ${JSON.stringify(n.a && { frames: n.a.frames, fehler: n.a.fehler })}, ${n.impulse} impulses, ${(await spurVon(n.bp.audioId)).clips.length} clip(s)`);
    notiere('NK the core saw no MIDI event during the run without the edge', n.r.gesehen1 === n.r.gesehen0, `midi_gesehen ${n.r.gesehen0} -> ${n.r.gesehen1}`);
  } finally {
    if (kantenVor !== null) schreibeKanten(kantenVor); else fs.rmSync(KANTEN, { force: true });
    info(`NK edge file restored: ${kantenVor !== null && fs.existsSync(KANTEN) && fs.readFileSync(KANTEN, 'utf8') === kantenVor}`);
  }
}

// ---- master recording ----
async function mitschnitt(name, sekunden) {
  const dir = path.join(z.ORDNER, 'roh');
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, `${name}.f32`);
  const p = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', datei]);
  await warte(600);
  return async () => {
    const m = await p;
    const j = jsonZeile(m.out);
    if (m.rc !== 0 || !j) throw new Fehl(`cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}`);
    const b = fs.readFileSync(datei);
    const st = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
    return { ...kanaele(st), s0: j.s0, meta: j };
  };
}

// ---- Z2 ----
async function z2() {
  const bp = await baueProjekt('z2');
  const P = { paare: 8, offsets: [100], toene: [45, 48, 52, 57], ausNach: 12000 };
  const r = await lauf({ ...P, ohneAufnahme: true, aufMitschnitt: { name: 'z2-rb', sek: 20 } });
  const m = await r.lesen();
  // no recording run: the transport stayed stopped, the notes came through the live path only
  const st = (await z.aktuell()).kern?.status;
  const flanken = frischeFlanken(r.beob.flanken, m.s0);
  const tone = flanken.map((f) => tonAb(m.l, m.s0, f, LAUT));
  const spitzen = flanken.map((f) => maxAbs(m.l, f - m.s0, f - m.s0 + 12000));
  const onsets = onsetsNach(m.l, LAUT);
  roh.z2 = { s0: m.s0, flanken, tone, spitzen_db: spitzen.map(dbOf), onsets };
  notiere('Z2 the transport is stopped and nothing records while the notes are played', st === 0, `kern.status ${st}`);
  notiere('Z2 AK23 after each of the 8 notes the master rises above -60 dBFS out of quiet (RB-338, live path)',
    flanken.length === 8 && tone.every((t) => t.laut && t.spitzeDavorDb < -60), `${flanken.length} notes, ${tone.filter((t) => t.laut).length} audible; quiet before each: ${tone.map((t) => f1(t.spitzeDavorDb)).join(' ')} dBFS; peaks ${spitzen.map((s) => f1(dbOf(s))).join(' ')} dBFS`);
  notiere('Z2 the master holds exactly 8 onsets (a tone that never ends would be one, a doubled note two)', onsets.length === 8, `${onsets.length} onsets`);
  info(`Z2 onset delay against the stamp (first sample >= -60 dBFS): ${tone.map((t) => t.verzug).join(' ')} samples, median ${median(tone.map((t) => t.verzug))}`);
  // negative control: the track disarmed (the MIDI bit goes), the same notes give no tone
  await z.aendern('rec5 z2 disarm', [{ befehl: 'spur_aendern', spur_id: bp.instrId, arm: false }]);
  await warte(1500);
  const r2 = await lauf({ ...P, paare: 3, ohneAufnahme: true, aufMitschnitt: { name: 'z2-aus', sek: 9 } });
  const m2 = await r2.lesen();
  const f2 = frischeFlanken(r2.beob.flanken, m2.s0);
  const sp2 = maxAbs(m2.l, 0, m2.l.length);
  notiere('Z2 negative control: the track disarmed, 3 notes arrive (the core sees them) and the master stays below -60 dBFS',
    f2.length === 3 && sp2 < LAUT && r2.gesehen1 - r2.gesehen0 >= 6, `${f2.length} notes, the core saw ${r2.gesehen1 - r2.gesehen0} MIDI events, master peak ${f1(dbOf(sp2))} dBFS`);
  await z2Surge();
}
// The wirt sink puts a live note at offset 0 of the cycle (ledger T7 minor 7), and the Surge host answers two cycles and 25 samples later (spec 9.4): the
// sound begins at cycle start + 2n + 25, so delay (sound minus stamp) + offset in the cycle = 2n + 25 for every offset. The offsets differ on purpose.
async function z2Surge() {
  const j = await prog(path.join(path.dirname(path.dirname(BAU)), 'start', 'djk-instrumente'), ['--instanz', instanz, '--arr1']);
  roh.z2_surge_start = { rc: j.rc, out: j.out.trim().split('\n').slice(-3), err: j.err.trim().split('\n').slice(-3) };
  if (j.rc !== 0) { npb('Z2 Surge part', `djk-instrumente --instanz ${instanz} --arr1 does not run (rc ${j.rc}: ${(j.err || j.out).trim().split('\n').pop()})`); return; }
  const rec = await ereignis('/zustand/rec');
  const n = rec?.quantum;
  if (!(n > 0)) throw new Fehl('Z2 Surge: no /zustand/rec with a quantum');
  const bp = await baueProjekt('z2-surge', { geraet: { art: 'wirt' } });
  await warte(4000);   // the host loads its sound
  const P = { paare: 8, offsets: [100, 37, 200, 129], toene: [60, 64, 67, 72], ausNach: 12000 };
  const r = await lauf({ ...P, ohneAufnahme: true, aufMitschnitt: { name: 'z2-surge', sek: 20 } });
  const m = await r.lesen();
  const flanken = frischeFlanken(r.beob.flanken, m.s0);
  const tone = flanken.map((f) => tonAb(m.l, m.s0, f, LAUT, 12000));
  const summen = tone.map((t, i) => (t.laut ? t.verzug + P.offsets[i % P.offsets.length] : NaN));
  const soll = 2 * n + 25;
  roh.z2_surge = { quantum: n, soll, flanken, tone, summen, spuren: bp };
  notiere('Z2 Surge: after each of the 8 notes the master rises above -60 dBFS (live path through the wirt host)', flanken.length === 8 && tone.every((t) => t.laut),
    `${flanken.length} notes, ${tone.filter((t) => t.laut).length} audible; delays ${tone.map((t) => t.verzug).join(' ')} samples; level before each ${tone.map((t) => f1(t.spitzeDavorDb)).join(' ')} dBFS`);
  // delay + offset is the same for every note (the wirt sink drops the offset in the cycle: measured against the offsets of the notes), it cannot be shorter
  // than the round trip, and it exceeds it only by the rise of the patch to -60 dBFS (the spec measures with an impulse patch, A4; this is the default patch):
  // that rise stays within one cycle. The excess is reported, not corrected.
  const gueltig = summen.filter(Number.isFinite), spreiz = gueltig.length ? Math.max(...gueltig) - Math.min(...gueltig) : NaN;
  const mittel = gueltig.length ? gueltig.reduce((a, b) => a + b, 0) / gueltig.length : NaN;
  notiere('Z2 Surge: delay + offset in the cycle is the same for every note (spread <= 2): the wirt sink puts a live note at the cycle start', gueltig.length === 8 && spreiz <= 2,
    `delay + offset: ${summen.join(' ')}; spread ${spreiz}`);
  notiere(`Z2 Surge: the sound is not earlier than the round trip 2n + 25 = ${soll} samples (n = ${n}) and not later than one cycle after it`,
    gueltig.length === 8 && Math.min(...gueltig) >= soll - 2 && Math.max(...gueltig) <= soll + n,
    `delay + offset ${Math.min(...gueltig)} to ${Math.max(...gueltig)}; excess over 2n + 25: ${f1(mittel - soll)} samples (${f1((mittel - soll) / 48)} ms)`);
}

// ---- Z3 ----
async function z3() {
  const bp = await baueProjekt('z3');
  const halten = { paare: 1, offsets: [100], toene: [45], periode: 1, haeltSek: 8, nachSek: 0 };
  const r = await lauf({ ...halten, ohneStopp: true, aufMitschnitt: { name: 'z3', sek: 10 }, waehrend: async (_k, obs) => {
    await bisFlanken(obs, 1, 6000);
    await warte(1700);                      // the key is held and sounds
    const sp = await z.ruf('POST', '/proj/aufnahme', { aktion: 'stopp' });
    if (sp.code !== 200) throw new Fehl(`/proj/aufnahme stopp -> ${z.grundVon(sp)}`);
    return sp.j;
  } });
  r.stopp = r.waehrend;
  const m = await r.lesen();
  const t = midiTake(r);
  if (!t.eintrag || t.eintrag.fehler) { notiere('Z3 the take is placed', false, JSON.stringify(t.eintrag ?? r.stopp)); return; }
  const stopIdx = t.seite.ende_sample - r.start.nachlauf_samples - m.s0;
  const e = endePruefung(m.l, { stopIdx });
  roh.z3 = { s0: m.s0, stopIdx, urteil: e, seite: t.seite, ende_ereignis: t.ereignisse.at(-1) };
  notiere('Z3 AK24 the held note ends at the stop: the master falls below -90 dBFS within 100 ms after it and was loud right before it', e.ok,
    `stop at index ${stopIdx} (take end ${t.seite.ende_sample} minus the tail ${r.start.nachlauf_samples}); last loud sample ${e.letzteLaut} (${((e.letzteLaut - stopIdx) / RATE * 1000).toFixed(1)} ms against the stop); level from stop + 100 ms ${f1(e.spitzeNachDb)} dBFS${e.ok ? '' : `; ${e.grund}`}`);
  const letzte = t.ereignisse.at(-1);
  notiere('Z3 the take closes the held note at its end: the last record is the note off of pitch 45 at the end sample of the sidecar',
    t.ereignisse.length === 2 && letzte.status === 0x80 && letzte.d1 === 45 && letzte.sample === t.seite.ende_sample, `${t.ereignisse.length} records, last ${JSON.stringify(letzte)}, sidecar end ${t.seite.ende_sample}`);
  const noten = await notenVon(bp.instrId);
  notiere('Z3 the held note is placed as one note of pitch 45 that reaches the end of the take', noten.length === 1 && noten[0].ton === 45 && noten[0].laenge > 0.5, JSON.stringify(noten));
  npb('Z3 live_offene_noten() == 0', 'the live table is not exposed outside the core process (no OSC field); test_kern_live K5 (transport stop) and K4 (run end) assert it; here the sound after the stop is what is measured');
  // negative control: the same measurement on a tone that is not stopped (the key stays down while the recording ends) must say "hanging note"
  const r2 = await lauf({ ...halten, haeltSek: 4, ohneAufnahme: true, aufMitschnitt: { name: 'z3-haengt', sek: 5 } });
  const m2 = await r2.lesen();
  const e2 = endePruefung(m2.l, { stopIdx: 2 * RATE });
  roh.z3_kontrolle = e2;
  notiere('Z3 negative control: a held tone that is not stopped is reported as a hanging note', !e2.ok && /hanging/.test(e2.grund), `${e2.grund}; last loud sample ${e2.letzteLaut} of ${m2.l.length}`);
}

// ---- run ----
const state = { z1: null };
const gewollt = (n) => !NUR || NUR.has(n);
async function laufAlles() {
  info(`abnahme_rec5 against ${z.URL} (instance ${instanz}), core build folder ${BAU}, fixture ${GERAETE} sha ${sha(GERAETE).slice(0, 12)}`
    + `${z.opt.bruch ? `, BRUCH ${z.opt.bruch}` : ''}${DEMO ? `, client --midi-late ${DEMO}` : ''}`);
  const zellen = [['Z1', z1], ['Z4', z4], ['NK', nk], ['Z3', z3], ['Z2', z2]];   // Z2 last: its Surge part starts a wirt unit
  for (const [name, f] of zellen) {
    if (!gewollt(name)) continue;
    z.punkt = name;
    info(`--- ${name} ---`);
    try { await f(); } catch (e) { notiere(`${name} ABORT`, false, e instanceof Fehl ? e.message : (e.stack ?? String(e))); }
    await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);
    await warte(500);
  }
}
try { await laufAlles(); } finally {
  for (const p of lebendig) { try { p.kill('SIGTERM'); } catch { /* gone */ } }
  if (geraeteOriginal !== null) { fs.writeFileSync(GERAETE, geraeteOriginal); }   // the fixture as the caller wrote it (the caller restores the real file)
  roh.nicht_pruefbar = nichtPruefbar;
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
  if (nichtPruefbar.length) info(`NICHT_PRUEFBAR (${nichtPruefbar.length}): ${nichtPruefbar.join(' | ')}`);
}
await z.ende('Recording slice 5 target acceptance (AK22 to AK25)', /^rec5-/);
