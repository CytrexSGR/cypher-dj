// Target acceptance, 1.8 recording slice 2 (external input, latency profile, compensation; spec AK10 to AK14), against a TEST INSTANCE with the freshly
// built core (instances b, d or e only, never f, never the operation; the script refuses every other letter). The caller (one locked shell command)
//   * holds flock /dev/shm/cypherdj-instanz-<i>.flock and, nested inside, flock "$CYPHERDJ_ECHTZEIT_SCHLOSS",
//   * writes the fixture ~/.config/cypherdj-<i>/geraete.json (input 1: profile pc-eingang on cypher_stumm-<i>:monitor_FL/FR, frei_fuer_cypher false;
//     input 2: the probe client cypherdj-pruef-ein:a_L for Z3), records the unit states and the sha of that file,
//   * starts the instance (DJK=<worktree>/djk djk/start/djk-start --instanz <i>, silent sink), runs this script, stops it, restores file and units.
//   node check/acceptance_rec2.mjs --url http://127.0.0.1:5<port> --bau <core build folder> [--ausgabe <folder>] [--instanz d]
//        [--nur Z0,Z1,...] [--versatz-null | --ohne-vorhalt] [--inserts eq,saett,lim [--inserts-spur <n>]]
//   --inserts: an insert chain on a track that is not the armed one, in every project the script builds (see rec_inserts.mjs); without it no insert.
//   The script builds its own projects, so there is no --aufbau (a value handed over is reported and ignored).
// Criteria:
//   Z0  core output delay: ausgang_vorhalt from /zustand/rec (SSE), cross-checked with the start log line of the core (limiter look-ahead + channel latency).
//       Since 1.8 T2 ausgang_vorhalt also holds the latency compensation (PDC) of the playback loaded in the core. Z0 reads before the script has a project, where
//       no playback is loaded (PDC 0): the log sum must equal it. If a playback is loaded anyway, the difference to the log sum is the PDC part and is reported.
//   Z1  profile (AK12): cypherdj-latenz on the software loop (null sink playback_FL -> monitor_FL), entered with latency_enter.mjs; quantum 256 expected.
//       Negative: monitor_RL as source gives keine_schleife, no value written (sha of geraete.json before and after).
//   Z2  level (AK10): /geraete lists input 1 verbunden with pegel_db > -40 while the metronome plays; the edge file emptied: verbunden false, -200.
//   Z3  modes (AK11): the probe impulse into ein_2_L only (run a) and into ein_2_R only (run b), 8 s per mode; a silent result counts only together with
//       its partner run where the same mode carried the impulse.
//   Z4  compensation (AK13; 1.8 T2: ausgang_vorhalt is read again after the load of the project under test, so a chain of inserts counts): project 120 BPM, metronome on, master 0 dB, audio track on input 1 stereo, record 4 bars from beat 0: each click of the placed
//       clip (WAV with offset_s applied) lies on beat * 24000 frames within max(48, 2 * spread). Cypher is refused with eingang_nicht_frei (input not released).
//       Mutations on the PLACED clip through the real clip_aendern: versatz 0 (offset_s = 0) must fail; profile only (offset without the core delay) must fail,
//       or the run says NICHT_TRENNSCHARF with the value when the core delay is within the tolerance. Negative control: the edge removed gives a silent take,
//       and the measurement says FEHL "no click".
//   --versatz-null / --ohne-vorhalt: the primary Z4 evaluation itself uses the mutated offset (the run must then return 1).
// Return: 0 all OK (NICHT_PRUEFBAR, NICHT_TRENNSCHARF and INFO do not count), 1 at least one FEHL, 2 usage. Raw data go to rohdaten.json, the takes to the
// output folder. Only the own projects (slug rec2-...) are removed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { starte, Fehl } from './w3a_target.mjs';
import { leseWav } from './w1_wav.mjs';
import { klickOrte, urteilKlicks } from './rec_measure.mjs';
import { INSERT_OPTIONEN, INSERT_HILFE, inserts, baueInserts } from './rec_inserts.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_rec2: usage: --url <test instance> --bau <core build folder> [--ausgabe <folder>] [--instanz <b|d|e>] '
    + '[--nur Z0,Z1,Z2,Z3,Z4] [--versatz-null | --ohne-vorhalt] ' + INSERT_HILFE + '\n');
  process.exit(2);
}
const z = starte('abnahme_rec2', 'rec2', { bau: { type: 'string' }, nur: { type: 'string' }, 'versatz-null': { type: 'boolean' }, 'ohne-vorhalt': { type: 'boolean' }, ...INSERT_OPTIONEN }, { ohneAufbau: true });
const INS = inserts('abnahme_rec2', z.opt);
const { CYPHER, notiere, info, instanz, warte } = z;
if (!z.opt.bau) { process.stderr.write('abnahme_rec2: --bau <core build folder> is required (cypherdj-latenz, cypherdj-pruef-ein)\n'); process.exit(2); }
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`abnahme_rec2: instance ${instanz} is not allowed: b, d or e only (never f)\n`); process.exit(2); }
if (z.opt['versatz-null'] && z.opt['ohne-vorhalt']) { process.stderr.write('abnahme_rec2: --versatz-null and --ohne-vorhalt exclude each other\n'); process.exit(2); }
const HIER = path.dirname(fileURLToPath(import.meta.url));
const BAU = path.resolve(z.opt.bau);
const NUR = z.opt.nur ? new Set(z.opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const PORT = Number(new globalThis.URL(z.URL).port);
const SHM = `/dev/shm/cypherdj-${instanz}`;
const KANTEN = path.join(SHM, 'eingaenge-kanten');
const GERAETE = path.join(os.homedir(), '.config', `cypherdj-${instanz}`, 'geraete.json');
const STUMM = `cypher_stumm-${instanz}`;
const RATE = 48000, BEAT = 24000;   // 120 BPM: a beat is 0.5 s
const roh = {}, nichtPruefbar = [];
const npb = (kz, grund) => { nichtPruefbar.push(`${kz}: ${grund}`); info(`NICHT_PRUEFBAR ${kz}: ${grund}`); };
const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'absent');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));

const prog = (programm, args, env = {}) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}`, p: null }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const PW = { PIPEWIRE_PROPS: `{ node.group = cypherdj-${instanz} node.lock-quantum = true }` };

// ---- helpers: SSE, edge file, recording ----
async function ereignis(adresse, ms = 8000) {   // first event of /strom with this address (the abort happens after the loop: aborting inside it would turn the result into an AbortError)
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
const schreibeKanten = (text) => { const t = `${KANTEN}.rec2.teil`; fs.writeFileSync(t, text); fs.renameSync(t, KANTEN); };   // atomic like the page server
const geraete = async () => z.erwarte200('/geraete', await z.ruf('GET', '/geraete')).j;
// The input level is the core's momentary peak and the metronome click lasts 2 ms per beat: one reading can fall between two clicks (-200 although the edge
// carries the click). The window therefore keeps the maximum of repeated readings; the edge state is the last reading.
async function pegelFenster(k, ms = 2500) {
  const ende = Date.now() + ms;
  let max = -Infinity, l = null;
  do { l = await geraete(); max = Math.max(max, l.eingaenge[k - 1].pegel_db); await warte(150); } while (Date.now() < ende);
  return { eingaenge: [{ ...l.eingaenge[k - 1], pegel_db: max }], kern: l.kern };
}
async function bisVerbunden(k, soll, ms = 8000) {
  let l = null;
  const ok = await z.bisWahr(async () => { l = await geraete(); return l.eingaenge[k - 1].verbunden === soll; }, ms);
  return { ok, l };
}

// One recording on the open project: start (as Andreas), `waehrend` runs `nach` ms after the start, stop after `sekunden`. Returns the stop result of
// the first track, its decoded WAV and the placed clip.
async function nimmAuf(sekunden, waehrend = null, nach = 0) {
  await z.geladen();
  const st = await z.ruf('POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  if (st.code !== 200) throw new Fehl(`/proj/aufnahme start -> ${z.grundVon(st)}`);
  let fehler = null, mess = null;
  const t0 = Date.now();
  if (waehrend) { await warte(nach); try { mess = await waehrend(); } catch (e) { fehler = e; } }
  await warte(Math.max(0, sekunden * 1000 - (Date.now() - t0)));
  const sp = await z.ruf('POST', '/proj/aufnahme', { aktion: 'stopp' });
  if (sp.code !== 200) throw new Fehl(`/proj/aufnahme stopp -> ${z.grundVon(sp)}`);
  if (fehler) throw fehler;
  const take = sp.j.takes?.[0];
  if (!take || take.fehler) throw new Fehl(`take: ${JSON.stringify(take)}`);
  const w = leseWav(take.datei);
  const clip = (await z.aktuell()).projekt.spuren.flatMap((s) => s.clips).at(-1);
  return { start: st.j, stopp: sp.j, take, w, clip, mess };
}
const spur1 = async () => (await z.aktuell()).projekt.spuren[0];
async function projektMitSpur(name, bpm, eingang) {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  await warte(500);
  await z.neuesProjekt(name);
  await z.aendern(`rec2 ${name} tempo`, [{ befehl: 'tempo_setzen', bpm }]);
  await z.aendern(`rec2 ${name} track`, [{ befehl: 'spur_neu', art: 'audio', name: 'In' }]);
  const id = (await spur1()).id;
  await z.aendern(`rec2 ${name} arm`, [{ befehl: 'spur_aendern', spur_id: id, eingang, arm: true }]);
  roh.inserts = { ...roh.inserts, [name]: await baueInserts(z, INS, id, `rec2 ${name}`) };
  return id;
}

// ---- Z0 ----
async function z0() {
  const f = await ereignis('/zustand/rec');
  if (!f) throw new Fehl('no /zustand/rec within 8 s');
  roh.z0 = { zustand_rec: { ausgang_vorhalt: f.ausgang_vorhalt, quantum: f.quantum, status: f.status } };
  roh.vorhalt = f.ausgang_vorhalt; roh.quantum = f.quantum;
  notiere('Z0 /zustand/rec reports ausgang_vorhalt and quantum', Number.isInteger(f.ausgang_vorhalt) && f.ausgang_vorhalt >= 0 && f.quantum > 0,
    `ausgang_vorhalt ${f.ausgang_vorhalt} samples, quantum ${f.quantum}`);
  const kernStand = (await z.ruf('GET', '/proj/aktuell')).j?.kern;
  const ohneWiedergabe = !(kernStand?.rev_geladen > 0);   // null or -1: the core plays no playback, so the PDC part is 0
  roh.z0.rev_geladen = kernStand?.rev_geladen ?? null;
  const j = await prog('journalctl', ['--user', '-u', `cypherdj-kern-${instanz}`, '--no-pager', '-o', 'cat', '-n', '400']);
  const lim = [...j.out.matchAll(/Vorhalt (\d+) Samples/g)].at(-1), kan = [...j.out.matchAll(/latency account L = (\d+) samples/g)].at(-1);
  if (j.rc !== 0 || !lim || !kan) { npb('Z0 start log cross-check', `no core start lines in the journal (rc ${j.rc})`); return; }
  const summe = Number(lim[1]) + Number(kan[1]);
  roh.z0.log = { limiter_vorhalt: Number(lim[1]), kanal_latenz: Number(kan[1]), summe };
  roh.z0.pdc_teil = f.ausgang_vorhalt - summe;
  if (ohneWiedergabe) {
    notiere('Z0 the start log line of the core agrees with /zustand/rec (no playback loaded, PDC part 0)', summe === f.ausgang_vorhalt,
      `log: limiter ${lim[1]} + channel latency ${kan[1]} = ${summe}; /zustand/rec: ${f.ausgang_vorhalt}`);
  } else {
    notiere('Z0 /zustand/rec is the start log sum plus a non-negative PDC part (a playback is loaded)', f.ausgang_vorhalt >= summe,
      `log: limiter ${lim[1]} + channel latency ${kan[1]} = ${summe}; /zustand/rec: ${f.ausgang_vorhalt}; PDC part ${f.ausgang_vorhalt - summe} (playback ${kernStand?.rev_geladen})`);
  }
}

// ---- Z1 ----
async function z1() {
  const aus = path.join(z.ORDNER, 'latenz-eingang1.json'), alt = path.join(z.ORDNER, 'latenz-schleife-fehlt.json');
  const m = await prog('pw-jack', [path.join(BAU, 'cypherdj-latenz'), `${STUMM}:playback_FL`, `${STUMM}:monitor_FL`, '20', aus], PW);
  roh.z1 = { messung: jsonZeile(m.out), rc: m.rc };
  const mj = roh.z1.messung;
  notiere('Z1 the software loop is measured (cypherdj-latenz, >= 20 runs)', m.rc === 0 && mj?.ok === true && mj.laeufe >= 20,
    `rc ${m.rc}: ${m.out.trim().split('\n').pop()}`);
  if (!mj?.ok) return;
  const e = await prog('node', [path.join(HIER, '..', '..', 'testbench', 'input', 'latency_enter.mjs'), aus, String(PORT), '1', 'software', 'andreas']);
  roh.z1.eintragen = { rc: e.rc, out: e.out.trim() };
  const prof = (await geraete()).eingaenge[0].latenz;
  roh.z1.profil = prof; roh.profil = prof;
  notiere('Z1 the profile of input 1 holds the measurement, quantum and date', e.rc === 0 && prof && prof.samples === mj.samples && prof.quantum === mj.quantum && !!prof.gemessen_am,
    `entered rc ${e.rc}; profile ${JSON.stringify(prof)}`);
  notiere('Z1 spread of the software loop is reported (AK12: > 1 sample would widen the AK13 tolerance)', true,
    `samples ${mj.samples}, spread ${mj.streuung}, min ${mj.min}, max ${mj.max}, runs ${mj.laeufe}, quantum ${mj.quantum}`);
  if (roh.quantum !== undefined) notiere('Z1 the quantum of the measurement equals the quantum the core runs at', mj.quantum === roh.quantum, `measured ${mj.quantum}, core ${roh.quantum}`);
  // negative: a source that is not the loop (monitor_RL carries nothing of playback_FL)
  const v1 = sha(GERAETE);
  const n = await prog('pw-jack', [path.join(BAU, 'cypherdj-latenz'), `${STUMM}:playback_FL`, `${STUMM}:monitor_RL`, '20', alt], PW);
  const nj = jsonZeile(n.out);
  roh.z1.negativ = { rc: n.rc, ausgabe: nj, sha_vorher: v1, sha_nachher: sha(GERAETE), datei_da: fs.existsSync(alt) };
  notiere('Z1 negative: monitor_RL as the source gives keine_schleife and writes no value', n.rc !== 0 && nj?.grund === 'keine_schleife' && !fs.existsSync(alt) && sha(GERAETE) === v1,
    `rc ${n.rc}, ${n.out.trim().split('\n').pop()}; geraete.json sha before ${v1.slice(0, 12)} after ${sha(GERAETE).slice(0, 12)}; output file present ${fs.existsSync(alt)}`);
}
const jsonZeile = (t) => { try { return JSON.parse(t.trim().split('\n').filter(Boolean).pop()); } catch { return null; } };

// ---- Z4 (with Z2 inside: the metronome plays during the take) ----
const KLICK_SCHWELLE = (l) => Math.max(0.25 * spitzeAbs(l), 0.01);   // a quarter of the loudest click, never below noise
const spitzeAbs = (x) => { let m = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
function messeKlicks(w, offsetS, clipFrames, toleranz) {
  const off = Math.round(offsetS * RATE);
  const orte = klickOrte(w.l, KLICK_SCHWELLE(w.l)).map((o) => o - off);   // the position in the clip: WAV frame minus the clip offset
  const beats = [];
  for (let b = 0; b * BEAT + 2000 <= clipFrames; b++) beats.push(b * BEAT);
  return { off, orte, beats, urteil: urteilKlicks(orte, beats, toleranz) };
}
async function z4() {
  const profil = (await geraete()).eingaenge[0].latenz;
  roh.z4 = { profil };
  const streuung = profil?.streuung ?? 0, toleranz = Math.max(48, 2 * streuung);
  const id = await projektMitSpur('z4', 120, { art: 'extern', paar: 1, modus: 'stereo' });
  await z.aendern('rec2 z4 metronome', [{ befehl: 'metronom_setzen', an: true, pegel_db: 0, ziel: 'master' }]);
  // Cypher is refused: input 1 is not released (D4; the fixture keeps frei_fuer_cypher false)
  await z.geladen();
  const ki = await z.ruf('POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 }, CYPHER);
  roh.z4.cypher = { code: ki.code, fehler: ki.j?.fehler };
  notiere('Z4 Cypher is refused with eingang_nicht_frei on the unreleased input and nothing starts', ki.code === 409 && ki.j?.fehler === 'eingang_nicht_frei' && (await z.ruf('GET', '/proj/aufnahme')).j.lauf === null,
    z.grundVon(ki));
  // 1.8 T2: ausgang_vorhalt holds the PDC of the playback in the core, so it is read after the load of THIS project (with its chain of inserts), not at Z0.
  // The core reports at 2 Hz when idle: the wait makes sure that the report is younger than the load (a cached one on the SSE connect is at most 0.5 s old).
  await z.geladen();
  await warte(900);
  const fz = await ereignis('/zustand/rec');
  if (!fz || !Number.isInteger(fz.ausgang_vorhalt)) throw new Fehl('Z4: no /zustand/rec after the load of the project');
  roh.z4.vorhalt = fz.ausgang_vorhalt;
  const vorhalt = fz.ausgang_vorhalt;
  info(`Z4 ausgang_vorhalt after the load: ${vorhalt}${roh.z0?.log ? ` (log sum ${roh.z0.log.summe}, PDC part ${vorhalt - roh.z0.log.summe})` : ''}`);
  // the take; from 1.5 s into it the level (Z2) is read over a window while the metronome plays
  const t = await nimmAuf(8.6, async () => pegelFenster(1), 1500);
  roh.z4.start = t.start; roh.z4.take = { ...t.take, wav_sha: sha(t.take.datei) };
  fs.copyFileSync(t.take.datei, path.join(z.ORDNER, 'z4-take.wav'));
  const e1 = t.mess.eingaenge[0];
  roh.z2 = { verbunden: e1.verbunden, pegel_db: e1.pegel_db, kern: t.mess.kern };
  notiere('Z2 input 1 is connected and carries a level above -40 dB while the metronome plays (AK10)', e1.verbunden === true && typeof e1.pegel_db === 'number' && e1.pegel_db > -40,
    `verbunden ${e1.verbunden}, pegel_db ${e1.pegel_db}`);
  info(`Z4 start answer: versatz_samples ${JSON.stringify(t.start.spuren.map((s) => s.versatz_samples))}, nachlauf_samples ${t.start.nachlauf_samples}, hinweise ${JSON.stringify(t.start.hinweise ?? [])}`);
  const clipFrames = Math.round(t.clip.laenge_beats * BEAT);
  const erwVersatz = (profil?.samples ?? 0) + vorhalt;
  notiere('Z4 the server applied versatz = profile + ausgang_vorhalt, and the clip carries it as offset_s',
    t.take.versatz_samples === erwVersatz && Math.abs(t.clip.offset_s * RATE - erwVersatz) < 0.5,
    `take versatz ${t.take.versatz_samples} (profile ${profil?.samples} + vorhalt ${vorhalt} = ${erwVersatz}); clip offset_s ${t.clip.offset_s} = ${f2(t.clip.offset_s * RATE)} frames`);
  // the primary evaluation (the mutation flags change the clip as the server placed it, through the real clip_aendern)
  const setzeOffset = async (offsetS, label) => {
    await z.aendern(label, [{ befehl: 'clip_aendern', clip_id: t.clip.id, offset_s: offsetS }]);
    return (await spur1()).clips.find((c) => c.id === t.clip.id).offset_s;
  };
  let offsetPrimaer = t.clip.offset_s;
  if (z.opt['versatz-null']) offsetPrimaer = await setzeOffset(0, 'rec2 z4 mutation versatz null');
  if (z.opt['ohne-vorhalt']) offsetPrimaer = await setzeOffset((profil?.samples ?? 0) / RATE, 'rec2 z4 mutation ohne vorhalt');
  const m = messeKlicks(t.w, offsetPrimaer, clipFrames, toleranz);
  roh.z4.primaer = { offset_s: offsetPrimaer, offset_frames: m.off, orte: m.orte, beats: m.beats, urteil: m.urteil, toleranz };
  notiere('Z4 every click of the placed clip lies on its beat within max(48, 2 * spread) frames (AK13)', m.urteil.ok,
    `${m.beats.length} beats, offset ${m.off} frames, tolerance ${toleranz}; deviation min ${m.urteil.min}, max ${m.urteil.max}, mean ${f2(m.urteil.mittel)}, spread ${f2(m.urteil.streuung)}`
    + `${m.urteil.ok ? '' : ` -> ${m.urteil.grund}`}`);
  if (z.opt['versatz-null'] || z.opt['ohne-vorhalt']) return;
  // AK14 live: moving the clip offset leaves the WAV (file and source sha) as recorded
  const shaClip = (await spur1()).clips.find((c) => c.id === t.clip.id).quelle.sha256;
  notiere('Z4 AK14: changing offset_s does not touch the WAV on disk or the source sha', sha(t.take.datei) === roh.z4.take.wav_sha && shaClip === roh.z4.take.wav_sha,
    `wav ${sha(t.take.datei).slice(0, 12)}, recorded ${roh.z4.take.wav_sha.slice(0, 12)}, clip source ${shaClip.slice(0, 12)}`);
  // mutation 1: versatz 0 placed
  const o1 = await setzeOffset(0, 'rec2 z4 mutation versatz null');
  const m1 = messeKlicks(t.w, o1, clipFrames, toleranz);
  roh.z4.mutation_versatz_null = { offset_s: o1, urteil: m1.urteil };
  notiere('Z4 mutation versatz = 0 placed: the measurement says FEHL (deviation about the profile plus the core delay)',
    !m1.urteil.ok && Math.abs(m1.urteil.mittel - erwVersatz) <= toleranz,
    `deviation mean ${f2(m1.urteil.mittel)} (expected about ${erwVersatz}); verdict ${m1.urteil.ok ? 'OK (the mutation survived)' : `FEHL: ${m1.urteil.grund}`}`);
  // mutation 2: profile only, without the core delay
  const o2 = await setzeOffset((profil?.samples ?? 0) / RATE, 'rec2 z4 mutation ohne vorhalt');
  const m2 = messeKlicks(t.w, o2, clipFrames, toleranz);
  roh.z4.mutation_ohne_vorhalt = { offset_s: o2, urteil: m2.urteil };
  if (vorhalt <= toleranz) {
    info(`NICHT_TRENNSCHARF Z4 mutation without the core delay: ausgang_vorhalt ${vorhalt} is within the tolerance ${toleranz}; the deviation ${f2(m2.urteil.mittel)} is a measurement, not a pass`);
    roh.z4.mutation_ohne_vorhalt.nicht_trennscharf = true;
  } else {
    notiere('Z4 mutation profile only (no core delay): the measurement says FEHL', !m2.urteil.ok && Math.abs(m2.urteil.mittel - vorhalt) <= toleranz,
      `deviation mean ${f2(m2.urteil.mittel)} (expected about ${vorhalt}); verdict ${m2.urteil.ok ? 'OK (the mutation survived)' : `FEHL: ${m2.urteil.grund}`}`);
  }
  await setzeOffset(t.clip.offset_s, 'rec2 z4 restore');   // the placed value again (not needed for the verdict, keeps the project honest)
  // negative control and Z2 second half: the edge of input 1 removed -> not connected, level -200, silent take, FEHL "no click"
  const kantenVor = fs.existsSync(KANTEN) ? fs.readFileSync(KANTEN, 'utf8') : null;
  roh.z4.kanten_vorher = kantenVor;
  try {
    schreibeKanten('');
    const v = await bisVerbunden(1, false);
    notiere('Z2 the edge file emptied: input 1 is no longer connected', v.ok, `verbunden ${v.l?.eingaenge[0].verbunden}`);
    const id2 = await projektMitSpur('z4-leer', 120, { art: 'extern', paar: 1, modus: 'stereo' });
    await z.aendern('rec2 z4-leer metronome', [{ befehl: 'metronom_setzen', an: true, pegel_db: 0, ziel: 'master' }]);
    void id2;
    const s = await nimmAuf(3.2, async () => pegelFenster(1), 1200);
    const e2 = s.mess.eingaenge[0];
    roh.z2.getrennt = { verbunden: e2.verbunden, pegel_db: e2.pegel_db };
    notiere('Z2 with the edge removed the level is -200 (AK10)', e2.verbunden === false && e2.pegel_db === -200, `verbunden ${e2.verbunden}, pegel_db ${e2.pegel_db}`);
    const cf = Math.round(s.clip.laenge_beats * BEAT);
    const ms = messeKlicks(s.w, s.clip.offset_s, cf, toleranz);
    roh.z4.negativ = { peak: spitzeAbs(s.w.l), urteil: ms.urteil, frames: s.take.frames };
    notiere('Z4 negative control: a take without the edge is silent and the measurement says FEHL "no click"',
      spitzeAbs(s.w.l) === 0 && ms.orte.length === 0 && !ms.urteil.ok && /no click/.test(ms.urteil.grund),
      `${s.take.frames} frames, peak ${spitzeAbs(s.w.l)}, ${ms.orte.length} clicks, verdict: ${ms.urteil.grund}`);
  } finally {
    if (kantenVor !== null) schreibeKanten(kantenVor); else fs.rmSync(KANTEN, { force: true });
    await bisVerbunden(1, true, 8000).then((v) => info(`Z4 edge file restored, input 1 connected again: ${v.ok}`));
  }
  void id;
}

// ---- Z3 ----
async function z3() {
  const kantenVor = fs.existsSync(KANTEN) ? fs.readFileSync(KANTEN, 'utf8') : '';
  const cfg = JSON.parse(fs.readFileSync(GERAETE, 'utf8'));
  if (!cfg.eingaenge[1].audio) throw new Fehl('the fixture has no device on input 2 (the probe client); Z3 needs it');
  const quelle = cfg.eingaenge[1].audio.ports[0];
  const basis = kantenVor.split('\n').filter((l) => l && !/\tein_2_[LR]$/.test(l)).join('\n');
  const mitKante = (seite) => schreibeKanten(`${basis ? `${basis}\n` : ''}${quelle}\tein_2_${seite}\n`);
  const modi = ['stereo', 'links', 'rechts', 'summe'];
  // expected peaks (L, R) per mode for an impulse of 1.0 on L only (a) and on R only (b)
  const erwartet = { a: { stereo: [1, 0], links: [1, 1], rechts: [0, 0], summe: [0.5, 0.5] }, b: { stereo: [0, 1], links: [0, 0], rechts: [1, 1], summe: [0.5, 0.5] } };
  const id = await projektMitSpur('z3', 120, { art: 'extern', paar: 2, modus: 'stereo' });
  const client = spawn('pw-jack', [path.join(BAU, 'cypherdj-pruef-ein'), '70'], { env: { ...process.env, ...PW }, stdio: 'ignore' });   // an impulse every 2 s for 140 s
  const klient = new Promise((res) => client.on('close', res));
  roh.z3 = { lauf: [] };
  try {
    await warte(2000);
    for (const [lauf, seite] of [['a', 'L'], ['b', 'R']]) {
      mitKante(seite);
      await warte(2500);
      for (const modus of modi) {
        await z.aendern(`rec2 z3 ${lauf} ${modus}`, [{ befehl: 'spur_aendern', spur_id: id, eingang: { art: 'extern', paar: 2, modus } }]);
        const t = await nimmAuf(8.2);
        const pl = spitzeAbs(t.w.l), pr = spitzeAbs(t.w.r);
        roh.z3.lauf.push({ lauf, seite, modus, frames: t.take.frames, spitze_l: pl, spitze_r: pr, erwartet: erwartet[lauf][modus] });
        fs.copyFileSync(t.take.datei, path.join(z.ORDNER, `z3-${lauf}-${modus}.wav`));
      }
    }
  } finally { client.kill('SIGTERM'); await klient; if (kantenVor) schreibeKanten(kantenVor); else fs.rmSync(KANTEN, { force: true }); }
  const nah = (x, y) => Math.abs(x - y) <= 1e-6;
  for (const modus of modi) {
    const a = roh.z3.lauf.find((r) => r.lauf === 'a' && r.modus === modus), b = roh.z3.lauf.find((r) => r.lauf === 'b' && r.modus === modus);
    for (const r of [a, b]) {
      const [el, er] = r.erwartet;
      const traf = nah(r.spitze_l, el) && nah(r.spitze_r, er);
      // a silent channel counts only when the partner run carried the impulse in the same mode (a dead capture fails both)
      const partner = r === a ? b : a;
      const partnerLaut = nah(partner.spitze_l, partner.erwartet[0]) && nah(partner.spitze_r, partner.erwartet[1]) && Math.max(...partner.erwartet) > 0;
      const stumm = el === 0 || er === 0;
      const ok = traf && (!stumm || partnerLaut);
      notiere(`Z3 mode ${modus}, impulse on ${r.seite} only: peaks L ${f2(r.spitze_l)} R ${f2(r.spitze_r)} (expected ${el} / ${er})`, ok,
        `${traf ? 'as expected' : 'MISMATCH'}${stumm ? `; silent side counts with partner run ${partner.lauf}: ${partnerLaut ? 'partner carried the impulse' : 'partner did not'}` : ''}; ${r.frames} frames`);
    }
  }
}

// ---- run ----
const gewollt = (n) => !NUR || NUR.has(n);
async function lauf() {
  info(`abnahme_rec2 against ${z.URL} (instance ${instanz}), core build folder ${BAU}, fixture ${GERAETE} sha ${sha(GERAETE).slice(0, 12)}`
    + `${z.opt['versatz-null'] ? ', MUTATION --versatz-null' : ''}${z.opt['ohne-vorhalt'] ? ', MUTATION --ohne-vorhalt' : ''}`);
  for (const [name, f] of [['Z0', z0], ['Z1', z1], ['Z3', z3], ['Z4', z4]]) {
    if (!gewollt(name) && !(name === 'Z0' && gewollt('Z4'))) continue;
    z.punkt = name;
    info(`--- ${name} ---`);
    try { await f(); } catch (e) { notiere(`${name} ABORT`, false, e instanceof Fehl ? e.message : (e.stack ?? String(e))); }
    await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  }
}
try { await lauf(); } finally {
  roh.nicht_pruefbar = nichtPruefbar;
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
  if (nichtPruefbar.length) info(`NICHT_PRUEFBAR (${nichtPruefbar.length}): ${nichtPruefbar.join(' | ')}`);
}
await z.ende('Recording slice 2 target acceptance (AK10 to AK13)', /^rec2-/);
