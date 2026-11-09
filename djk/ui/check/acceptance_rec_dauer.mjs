// Target acceptance, 1.8 T11 (AK6, the long run): 8 armed external audio tracks and one MIDI-armed instrument track record for many minutes on the software loop
// of a TEST INSTANCE with the freshly built core (instances b, d or e only, never f, never the operation; the script refuses every other letter). The caller (one locked
// shell command) holds flock /dev/shm/cypherdj-instanz-<i>.flock and, nested inside, flock "$CYPHERDJ_ECHTZEIT_SCHLOSS", writes the fixture
// ~/.config/cypherdj-<i>/geraete.json (input 1: the probe client cypherdj-pruef-ein:a_L, frei_fuer_cypher false; midi.port cypherdj-pruef-ein:m), records the unit states
// and the sha of that file, starts the instance (DJK=<worktree>/djk djk/start/djk-start --instanz <i> --ohne-pruefmodus, silent sink), runs this script, stops it and restores
// file and units (the wrappers of the T11 evidence folder do all of that).
//   node check/acceptance_rec_dauer.mjs --url http://127.0.0.1:5<port> --bau <core build folder> [--ausgabe <folder>] [--instanz d] [--sekunden 600] [--kontrolle]
// The proof client (core/check/in_check.cpp) sends every 0.5 s an impulse on ein_1_L and a note on midi_ein_1 (note off after 6000 frames) for the whole run. The 8 audio
// tracks sit on pair 1 in the four channel modes (stereo, links, rechts, summe, twice), monitors ein/auto/aus mixed like the cost lane; the instrument track is armed on
// midi_ein_1. REC starts through /proj/aufnahme (the take of the whole run is placed on the tracks), the client runs to its end, STOP.
// Criteria (normal run):
//   D1  per audio take (8): the writer counted no gap (luecken 0), status 0, and the take is as long as the window the core recorded (the MIDI sidecar's end sample minus start
//       sample, the same window for all takes) within one cycle: frames == elapsed time +-1 cycle
//   D2  per audio take: its impulse train (read from the placed WAV) has as many impulses as the client sent on both channels (the profile feeds the one source port to L and R,
//       so every channel mode gives the impulse at full height) and a constant spacing within one sample: a dropped or doubled stretch of audio that the writer did not count shows here
//   D3  the MIDI take: 2 events per pair (note on and off), nothing refused, one take of art midi, and its start sample equals the start sample of every audio take
//   D4  the window is as long as the wall clock between the start answer and the stop answer, within 8 s (a sanity bound, not a timing gate)
// --kontrolle (the negative control, against a core built with REC_FADEN_BREMSE, normally --sekunden 30): the criteria above are evaluated and reported as INFO; the cell is OK
// only if D1 says "gaps" for at least one take (luecken > 0): the checker must be able to see what the stalled record thread does.
// Return: 0 all OK, 1 at least one FEHL, 2 usage. Raw data go to rohdaten.json. Only the own project (slug recd-...) is removed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_target.mjs';
import { ImpulsZaehler, urteilTake, urteilImpulse, erwartung, KANAL_MODI } from './rec_dauer_measure.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_rec_dauer: usage: --url <test instance> --bau <core build folder> [--ausgabe <folder>] [--instanz <b|d|e>] [--sekunden 600] [--kontrolle]\n');
  process.exit(2);
}
const z = starte('abnahme_rec_dauer', 'recd', { bau: { type: 'string' }, sekunden: { type: 'string' }, kontrolle: { type: 'boolean' } }, { ohneAufbau: true });
const { notiere, info, instanz, warte } = z;
if (!z.opt.bau) { process.stderr.write('abnahme_rec_dauer: --bau <core build folder> is required (cypherdj-pruef-ein)\n'); process.exit(2); }
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`abnahme_rec_dauer: instance ${instanz} is not allowed: b, d or e only (never f)\n`); process.exit(2); }
const SEK = z.opt.sekunden === undefined ? 600 : Number(z.opt.sekunden);
if (!Number.isInteger(SEK) || SEK < 10 || SEK > 3600) { process.stderr.write('abnahme_rec_dauer: --sekunden is an integer of 10 to 3600\n'); process.exit(2); }
const KONTROLLE = z.opt.kontrolle === true;
const BAU = path.resolve(z.opt.bau);
const GERAETE = path.join(os.homedir(), '.config', `cypherdj-${instanz}`, 'geraete.json');
const PW = { PIPEWIRE_PROPS: `{ node.group = cypherdj-${instanz} node.lock-quantum = true }` };
const RATE = 48000, PERIODE = 0.5, BPM = 120;
const PAARE = Math.round(SEK / PERIODE);
const RB = { art: 'intern', name: 'rb338', parameter: { cutoff: 0.6, resonanz: 0.3, env_mod: 0.2 } };
const MONITOR = ['ein', 'ein', 'ein', 'ein', 'ein', 'auto', 'auto', 'aus'];
const roh = {};
const lebendig = new Set();   // child processes of this script: killed by PID at the end
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x));
const geraeteOriginal = fs.existsSync(GERAETE) ? fs.readFileSync(GERAETE, 'utf8') : null;
const geraete = async () => z.erwarte200('/geraete', await z.ruf('GET', '/geraete')).j;
const projekt = async () => (await z.aktuell()).projekt;

async function geladen() {   // like abnahme_rec5: a project without a clip may have no playback revision
  const ok = await z.bisWahr(async () => {
    const s = await z.zustandKurz();
    return s.dekodiert.every((d) => d === 'fertig' || d === null || d === undefined) && s.kern?.status === 0 && (!(s.wiedergabe_rev > 0) || s.kern?.rev_geladen === s.wiedergabe_rev);
  });
  if (!ok) throw new Fehl(`playback not loaded after 40 s: ${JSON.stringify(await z.zustandKurz())}`);
}

async function baueProjekt() {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);
  await warte(500);
  await z.neuesProjekt('lauf');
  await z.aendern('recd tempo', [{ befehl: 'tempo_setzen', bpm: BPM }]);
  const ids = [];
  for (let k = 0; k < 8; k++) {
    await z.aendern(`recd audio track ${k + 1}`, [{ befehl: 'spur_neu', art: 'audio', name: `In ${k + 1}` }]);
    const id = (await projekt()).spuren.at(-1).id;
    ids.push(id);
    await z.aendern(`recd audio arm ${k + 1}`, [{ befehl: 'spur_aendern', spur_id: id, eingang: { art: 'extern', paar: 1, modus: KANAL_MODI[k % 4] }, arm: true, monitor: MONITOR[k] }]);
  }
  await z.aendern('recd instrument track', [{ befehl: 'spur_neu', art: 'instrument', name: 'RB', geraet: RB }]);
  const instrId = (await projekt()).spuren.at(-1).id;
  await z.aendern('recd instrument arm', [{ befehl: 'spur_aendern', spur_id: instrId, eingang: { art: 'midi' }, arm: true }]);
  await geladen();
  await warte(2500);   // the core has the arms a few cycles after the server sent them
  return { ids, instrId };
}

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
  return { bereit: bereitP, ende: endeP, los: () => p.stdin.write('go\n'), kill: () => { try { p.kill('SIGTERM'); } catch { /* gone */ } } };
}

// the WAV the server placed: header found by its chunks, then the frames in chunks of 1 MiB (a 10-minute take is 230 MB)
async function zaehleImpulse(wav) {
  const kopf = Buffer.alloc(512), fd = fs.openSync(wav, 'r');
  fs.readSync(fd, kopf, 0, 512, 0); fs.closeSync(fd);
  let start = -1;
  for (let o = 12; o + 8 <= kopf.length;) {
    const id = kopf.toString('latin1', o, o + 4), n = kopf.readUInt32LE(o + 4);
    if (id === 'data') { start = o + 8; break; }
    o += 8 + n + (n % 2);
  }
  if (start < 0) throw new Fehl(`${wav}: no data chunk in the first 512 bytes`);
  const zaehler = new ImpulsZaehler();
  for await (const stueck of fs.createReadStream(wav, { start, highWaterMark: 1 << 20 })) {
    const frames = stueck.length >> 3;   // 8 bytes per frame; the chunk size is a multiple of 8 and the read starts at the data
    const kopie = new Uint8Array(frames * 8);
    kopie.set(stueck.subarray(0, frames * 8));
    zaehler.fuettere(new Float32Array(kopie.buffer));
  }
  return zaehler;
}
const lies = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

async function lauf() {
  info(`abnahme_rec_dauer against ${z.URL} (instance ${instanz}), core build folder ${BAU}, ${SEK} s = ${PAARE} pairs of impulse and note, ${KONTROLLE ? 'NEGATIVE CONTROL (core built with REC_FADEN_BREMSE)' : 'normal run'}`);
  const bp = await baueProjekt();
  await geladen();
  const args = [String(PAARE), '--offsets', '100', '--pitches', '48,52,55,60', '--period', String(PERIODE), '--off-after', '6000', '--wait-go', '--linger', '0.3'];
  const klient = startClient(args);
  const r = { args };
  const zustand = [];
  try {
    if (!(await klient.bereit)) throw new Fehl(`the proof client did not start: ${JSON.stringify(await klient.ende)}`);
    if (!(await z.bisWahr(async () => (await geraete()).eingaenge[0].verbunden === true, 8000))) throw new Fehl('input 1 (the impulse) is not connected');
    if (!(await z.bisWahr(async () => (await geraete()).midi.verbunden === true, 8000))) throw new Fehl('midi_ein_1 is not connected');
    await warte(500);
    const st = await z.ruf('POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
    if (st.code !== 200) throw new Fehl(`/proj/aufnahme start -> ${z.grundVon(st)}`);
    r.start = st.j;
    r.tStart = Date.now();
    const audio = st.j.spuren.filter((s) => s.art !== 'instrument').length, instr = st.j.spuren.filter((s) => s.art === 'instrument').length;
    notiere('D0 the run starts with 8 audio tracks and 1 instrument track armed', audio === 8 && instr === 1, `${audio} audio, ${instr} instrument: ${JSON.stringify(st.j.spuren.map((s) => s.art))}`);
    klient.los();
    // watch the run: every 30 s one line (GET /proj/aufnahme), and stop waiting early when the run is gone before the client is done
    let fertig = false;
    const wachen = (async () => {
      let t = 0;
      while (!fertig) {
        await warte(1000);
        if (++t % 30 !== 0) continue;
        try {
          const a = (await z.ruf('GET', '/proj/aufnahme')).j;
          zustand.push({ t, lauf: a?.lauf ?? null });
          info(`t=${t} s run ${a?.lauf ? `${a.lauf.kennung} laufend ${a.lauf.laufend} seit ${a.lauf.seit_ms} ms` : 'GONE'}`);
          if (!a?.lauf) { info(`the run ended at t=${t} s, before the client finished`); fertig = true; klient.kill(); }
        } catch { /* the page is slow: the next poll */ }
      }
    })();
    const ende = await Promise.race([klient.ende, warte((SEK + 60) * 1000).then(() => null)]);
    fertig = true; await wachen;
    if (!ende) throw new Fehl('the proof client did not finish');
    r.klient = { rc: ende.rc, out: ende.out.trim() };
    await warte(1200);
    const sp = await z.ruf('POST', '/proj/aufnahme', { aktion: 'stopp' });
    r.tStopp = Date.now();
    if (sp.code !== 200) throw new Fehl(`/proj/aufnahme stopp -> ${z.grundVon(sp)}`);
    r.stopp = sp.j;
  } finally { klient.kill(); }
  r.zustand = zustand;
  roh.lauf = { start: r.start, stopp: r.stopp, klient: r.klient, args, zustand };
  await auswerten(bp, r);
}

async function auswerten(bp, r) {
  const takes = r.stopp.takes ?? [];
  const audio = takes.filter((t) => t.art !== 'midi'), midi = takes.filter((t) => t.art === 'midi');
  const verdicts = [];   // { kz, ok, text } of the normal criteria; in the control they are reported as INFO
  const urteil = (kz, ok, text) => { verdicts.push({ kz, ok, text }); if (!KONTROLLE) notiere(kz, ok, text); else info(`${ok ? 'OK  ' : 'FEHL'} (evaluated, control run) ${kz}: ${text}`); };
  const fehler = takes.filter((t) => t.fehler);
  notiere('D0 the stop answer holds 8 audio takes and 1 MIDI take, none with an error', audio.length === 8 && midi.length === 1 && fehler.length === 0, `${audio.length} audio, ${midi.length} midi, errors ${JSON.stringify(fehler)}`);
  if (midi.length !== 1) return;
  const mSeite = lies(midi[0].datei.replace(/\.bin$/, '.json'));
  const ordner = path.dirname(midi[0].datei);
  roh.midi = { eintrag: midi[0], seite: mSeite };
  const fenster = mSeite ? mSeite.ende_sample - mSeite.start_sample : NaN;
  const quantum = 256;   // pw-jack -p 256 of the unit and node.lock-quantum
  info(`the recorded window: ${fenster} frames = ${f1(fenster / RATE)} s (start ${mSeite?.start_sample}, end ${mSeite?.ende_sample}); wall clock between the start answer and the stop answer ${f1((r.tStopp - r.tStart) / 1000)} s; cycle ${quantum}`);
  roh.audio = [];
  for (const t of audio) {
    const nr = Number(/take-\d+-(\d+)\.wav$/.exec(t.datei)?.[1]), kennung = Number(/take-(\d+)-\d+\.wav$/.exec(t.datei)?.[1]);
    const spurIdx = bp.ids.indexOf(t.spur_id), modus = KANAL_MODI[spurIdx % 4], name = `track ${spurIdx + 1} (${modus}, monitor ${MONITOR[spurIdx]})`;
    const seite = lies(path.join(ordner, `aufnahme-${nr}-${kennung}.json`));
    const u = urteilTake({ frames: t.frames, luecken: t.luecken, status: t.status }, { fenster, zyklus: quantum });
    urteil(`D1 ${name}: no gaps, status 0, frames == window +-1 cycle`, u.ok, `${u.grund}; sidecar ${JSON.stringify(seite)}`);
    urteil(`D3 ${name}: starts on the sample of the MIDI take`, !!seite && seite.start_sample === mSeite.start_sample, `${seite?.start_sample} against ${mSeite.start_sample}`);
    const z0 = await zaehleImpulse(t.datei);
    const e = erwartung(modus, PAARE);
    const ul = urteilImpulse(z0.l, e.l), ur = urteilImpulse(z0.r, e.r);
    urteil(`D2 ${name}: impulses on L: ${ul.grund}`, ul.ok && Math.abs(z0.spitzeL - e.ampL) < 0.05, `${ul.grund}; peak ${z0.spitzeL.toFixed(3)}, expected ${e.ampL}`);
    urteil(`D2 ${name}: impulses on R: ${ur.grund}`, ur.ok && Math.abs(z0.spitzeR - e.ampR) < 0.05, `${ur.grund}; peak ${z0.spitzeR.toFixed(3)}, expected ${e.ampR}`);
    roh.audio.push({ nr, kennung, modus, eintrag: t, seite, frames: z0.frames, impulseL: z0.l.length, impulseR: z0.r.length, spitze: [z0.spitzeL, z0.spitzeR] });
  }
  urteil('D3 the MIDI take: 2 events per pair, nothing refused, sidecar and answer agree',
    midi[0].ereignisse === 2 * PAARE && midi[0].luecken === 0 && mSeite?.ereignisse === 2 * PAARE && mSeite?.abgelehnt === 0 && mSeite?.eingang === 30,
    `answer ${midi[0].ereignisse} events (expected ${2 * PAARE}), refused ${midi[0].luecken}, sidecar ${JSON.stringify(mSeite)}`);
  const wand = (r.tStopp - r.tStart) / 1000;
  urteil('D4 the recorded window is as long as the wall clock between the start and the stop answer (within 8 s)', Math.abs(fenster / RATE - wand) <= 8, `window ${f1(fenster / RATE)} s, wall clock ${f1(wand)} s`);
  if (KONTROLLE) {
    const luecken = audio.map((t) => t.luecken), mit = luecken.filter((n) => n > 0).length;
    const gaps = verdicts.filter((v) => /^D1 .*no gaps/.test(v.kz) && !v.ok && /gaps counted/.test(v.text)).length;
    notiere('KONTROLLE with the record thread stalled (REC_FADEN_BREMSE) the checker reports gaps: luecken > 0 on at least one take and D1 says FEHL for it', mit > 0 && gaps === mit,
      `luecken per take ${luecken.join(',')}; D1 red for ${gaps} of ${mit} takes with gaps; other criteria red: ${verdicts.filter((v) => !v.ok).length} of ${verdicts.length}`);
  }
}

try {
  try { await lauf(); } catch (e) { notiere('ABORT', false, e instanceof Fehl ? e.message : (e.stack ?? String(e))); }
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);
} finally {
  for (const p of lebendig) { try { p.kill('SIGTERM'); } catch { /* gone */ } }
  if (geraeteOriginal !== null) fs.writeFileSync(GERAETE, geraeteOriginal);   // the fixture as the caller wrote it (the caller restores the real file)
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
}
await z.ende('Recording long run (AK6)', /^recd-/);
