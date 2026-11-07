// Target acceptance, package 1.12 automation slice 5 (clip envelopes and the value stack), against a TEST INSTANCE with the freshly built core
// (instances b, d or e only, never the operation, never f; the script refuses every other letter). Call order:
//   1  node pruef/a2_aufbau.mjs --ziel /dev/shm/a5-ziel --instanz b > /dev/shm/a5-ziel/aufbau.json      (two steady sines and a catalog; slice 2 material, reused)
//   2  CYPHERDJ_KATALOG=/dev/shm/a5-ziel/katalog.sqlite DJK=<worktree>/djk djk/start/djk-start --instanz b
//      (silent sink, no --ton-frei; kern/build holds the fresh binaries; notbahn/build must exist: link it to any built notbahn folder)
//   3  flock <CYPHERDJ_ECHTZEIT_SCHLOSS> node pruef/abnahme_a5.mjs --url http://127.0.0.1:49300 --aufbau /dev/shm/a5-ziel/aufbau.json \
//        --bau <kernel build folder> [--ausgabe <folder>] [--nur Z1,Z3]
// Material: a steady sine (440 Hz, amplitude 0.3, identical in both channels) on an audio track, or RB-338 notes. The level of the track is then a pure function
// of fader, pan and the envelopes. Every level comes from the master recording of the core (cypherdj-mitschnitt, sample accurate): the gain in dB is
// sqrt(L^2 + R^2) of the 440 Hz amplitudes against the track amplitude (constant power pan law, pruef/a5_messen.mjs pegelDb, calibrated in
// tests/pruef_a5_messen.test.mjs). The line a value is compared with is computed by the same pure functions the server and the page use (laneWert, hkWert).
// Criteria (plan docs/b1-plaene/PLAN-1.12-slices4-5-7.md, U11 T11.2, spec AK18 to AK21 and AK24):
//   Z1  AK18 gain envelope -12 -> 0 dB over a 16-beat clip: the output follows the line within 0.05 dB at five beats (2, 5, 8, 11, 14); with clip loop 8 every loop
//       copy repeats the envelope (beats 2, 6, 10, 14); the clip moved to beat 4 takes the envelope along (the same line from the new start).
//       Controls: the same clip without an envelope reads 0 dB at the same beats (the plain line); a non-repeating envelope would read 0 dB in copy 2 (the expected
//       values there differ from 0 by more than 3 dB, so the copy check cannot pass by holding the last value).
//   Z2  AK19 unlinked envelope with loop_beats 2 on an 8-beat clip: the value at clip beat t is envelope(t mod 2), ten beats within 0.05 dB.
//       Controls: the same points linked (no repetition) hold their last value from beat 2 on (0 dB), three of the ten beats are checked on that.
//   Z3  AK20 transpose envelope 0 -> +7 (jump at beat 8) on a MIDI clip of an RB-338 track, one note per beat: the notes from beat 8 sound 7 semitones higher
//       (fundamental of every note, +-0.15 semitone), the notes before beat 8 equal the control; the notes in the project stay unchanged; a long note open at the stop
//       leaves no hanging tone (silent tail after the stop; the core counter offene_noten is not exposed outside the process, the sound after the stop is what is
//       measured); the gaps after the transposed notes are as quiet as in the control (the note-off hits the sounding pitch).
//       Controls: the same clip without the envelope has all notes at one pitch; the same long note without a stop is loud in the tail.
//   Z4  AK21 stack: absolute fader lane 0 -> -30 dB over 16 beats plus a relative spur_fader envelope of -6 dB: level = lane - 6 dB within 0.05 dB at five beats;
//       relative only (no lane, base fader -3 dB, spur_fader -6): -9 dB. Controls: without the envelope the level is the lane (or -3 dB).
//   Z5  null test export = playing (cypherdj-render of the playback file against the master recording) with a gain envelope with a jump, a relative fader envelope
//       with two jumps and an absolute fader lane; rest below -90 dBFS. Controls: the gain jump one sample late in the render, and the relative jump one sample late,
//       each must NOT be below -90 dBFS.
//   Z6  AK24 Cypher builds a fader lane and a clip gain envelope over the hand MCP (djk-hand over stdio), reads both back with proj_auto (points equal what was sent,
//       proj_lage lists the envelope without points, bei_beat of the lane plus bei_beat of the envelope equals the core level at three beats within 0.05 dB), the
//       history shows source cypher, with Stop Cypher set every write is a tool error ki_gestoppt while reading goes on. Controls: the project without envelope has no
//       huellkurven field and proj_auto clip_id answers huellkurve_unbekannt.
// Return: 0 all OK (NICHT_PRUEFBAR does not count), 1 at least one FEHL, 2 usage. Raw data go to rohdaten.json, listening samples to hoerproben/. Only the own
// projects (slug a5-...) are removed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_ziel.mjs';
import { schreibeWav } from './w1_wav.mjs';
import { SR, einsatz } from './a1_messen.mjs';
import { kanaele } from './a2_messen.mjs';
import { pegelDb, grundfrequenz, rmsDbfs, halbtoene } from './a5_messen.mjs';
import { laneWert } from '../projekt/lane.ts';
import { hkWert } from '../projekt/huellkurve.ts';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_a5: usage: --url <test instance> --aufbau <aufbau.json> --bau <core build folder> [--ausgabe <folder>] [--instanz <b|d|e>] [--nur Z1,Z3,...]\n');
  process.exit(2);
}
const z = starte('abnahme_a5', 'a5', { bau: { type: 'string' }, nur: { type: 'string' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, instanz } = z;
if (!z.opt.bau) { process.stderr.write('abnahme_a5: --bau <core build folder> is required (cypherdj-mitschnitt, -render, -nulltest)\n'); process.exit(2); }
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`abnahme_a5: instance ${instanz} is not allowed: b, d or e only (never f)\n`); process.exit(2); }
const BAU = path.resolve(z.opt.bau);
const NUR = z.opt.nur ? new Set(z.opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const BPM = 120, SCHLAG = 60 * SR / BPM;   // 24000 frames per beat
const FA = A.freq_a ?? 440, AMP = A.amplitude ?? 0.3;
const roh = {};
const db = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const warte = z.warte;
const HIER = path.dirname(fileURLToPath(import.meta.url));
const nichtPruefbar = [];
const npb = (kz, grund) => { nichtPruefbar.push(`${kz}: ${grund}`); info(`NICHT_PRUEFBAR ${kz}: ${grund}`); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const gewollt = (n) => !NUR || NUR.has(n);
let punktName = 'setup';
const punkt = (n) => { punktName = n; };

const prog = (programm, args) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const letzteZeile = (t) => t.trim().split('\n').filter(Boolean).pop() ?? '';
const jsonZeile = (t) => { try { return JSON.parse(letzteZeile(t)); } catch { return null; } };

// SSE of the server: /zustand/arr carries ursprung_sample and status (the null test needs both)
function stromLesen() {
  const ac = new AbortController(), meldungen = [];
  const fertig = (async () => {
    try {
      const r = await fetch(z.URL + '/strom', { signal: ac.signal });
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
    } catch { /* aborted or server gone */ }
  })();
  return { meldungen, stop: async () => { ac.abort(); await fertig; } };
}

const transport = async (aktion, beat = 0) => {
  const r = await z.ruf('POST', '/proj/transport', aktion === 'start' ? { aktion, beat } : { aktion }, CYPHER);
  if (r.code !== 200) throw new Fehl(`/proj/transport ${aktion} -> ${z.grundVon(r)}`);
};

// Master recording of `sekunden`; `ablauf` runs 0.5 s after the recorder started (it starts the transport and may stop it or change the project while it plays).
async function nimmAuf(name, sekunden, ablauf, { strom = false } = {}) {
  const dir = path.join(z.ORDNER, 'roh');
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, `${name}.f32`);
  const sse = strom ? stromLesen() : null;
  const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', datei]);
  await warte(500);
  let ablaufErgebnis;
  try { ablaufErgebnis = await ablauf(sse); } finally { /* the recording is awaited below either way */ }
  const m = await mit;
  if (sse) await sse.stop();
  const j = jsonZeile(m.out);
  if (m.rc !== 0 || !j) throw new Fehl(`cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}`);
  fs.writeFileSync(path.join(dir, `${name}.json`), m.out);
  const b = fs.readFileSync(datei);
  const st = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
  const { l, r } = kanaele(st);
  return { l, r, st, mit: j, sse: sse?.meldungen ?? [], ablaufErgebnis };
}
// plays from `ab` for the length of the recording; stops afterwards
const aufnahme = async (name, sekunden, ab = 0, opt = {}) => {
  const r = await nimmAuf(name, sekunden, () => transport('start', ab), opt);
  await transport('stopp');
  return r;
};

// ---- project building ----
const projekt = async () => (await aktuell()).projekt;
// like z.geladen, but a MIDI clip carries no decode state (null): only audio clips are waited for
async function geladen() {
  const ok = await z.bisWahr(async () => { const s = await z.zustandKurz(); return s.dekodiert.every((d) => d === 'fertig' || d === null || d === undefined) && s.kern?.rev_geladen === s.wiedergabe_rev && s.kern?.status === 0; });
  if (!ok) throw new Fehl(`playback not loaded after 40 s: ${JSON.stringify(await z.zustandKurz())}`);
}
async function neuesProjekt(name) {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  await warte(800);
  await z.neuesProjekt(name);
  await aendern(`A5 ${name} tempo`, [{ befehl: 'tempo_setzen', bpm: BPM }], CYPHER);
}
// one audio track with a clip of the sine: returns {spurId, clipId}
async function baueAudio(label, { laenge = 16, start = 0, loop = null } = {}) {
  await aendern(`${label} track`, [{ befehl: 'spur_neu', art: 'audio', name: 'A' }], CYPHER);
  const spurId = (await projekt()).spuren.at(-1).id;
  await aendern(`${label} clip`, [{ befehl: 'clip_neu', spur_id: spurId, art: 'audio', start_beat: start, laenge_beats: laenge, sha256: A.sha_a, ...(loop ? { loop_beats: loop } : {}) }], CYPHER);
  await geladen();
  await warte(3000);   // restart state of the core
  await aufwaermen();
  const clip = (await projekt()).spuren.find((s) => s.id === spurId).clips[0];
  return { spurId, clipId: clip.id };
}
// The first start after a project was loaded can begin seconds late (measured in the first run: the onset of the first control recording lay at 4.3 s, every later
// recording at the expected 0.5 s). A throwaway start and stop warms the playback up, so every measured recording starts when the transport does.
async function aufwaermen() {
  await nimmAuf('aufwaermen', 3, () => transport('start', 0));
  await transport('stopp');
  await warte(800);
}
async function aendereGeladen(label, befehle, wartMs = 1500) {
  await aendern(label, befehle, CYPHER);
  await geladen();
  await warte(wartMs);
}
const huelle = (label, clipId, ziel, punkte, extra = {}) => aendereGeladen(label, [{ befehl: 'huellkurve_setzen', clip_id: clipId, ziel, punkte, ...extra }]);
const huelleWeg = (label, clipId, ziel) => aendereGeladen(label, [{ befehl: 'huellkurve_loeschen', clip_id: clipId, ziel }]);

// gain at a project beat from the recording: e = frame of the first audible sample = frame of `startBeat`
const pegelBei = (m, e, startBeat, beat) => pegelDb(m.l, m.r, e + Math.round((beat - startBeat) * SCHLAG), 960, AMP, FA);
// compares the measured gain at `beats` with `soll(beat)`; returns {zeilen, abw}
function pruefeLinie(m, e, startBeat, beats, soll) {
  const zeilen = beats.map((b) => { const ist = pegelBei(m, e, startBeat, b), s = soll(b); return { beat: b, ist_db: ist, soll_db: s, abw_db: ist - s }; });
  return { zeilen, abw: Math.max(...zeilen.map((x) => Math.abs(x.abw_db))) };
}
const zeilenText = (zeilen) => zeilen.map((x) => `beat ${x.beat}: ${db(x.ist_db)} dB (line ${db(x.soll_db)}, dev ${db(x.abw_db)})`).join('; ');

// =============================================================================================================
// Z1 AK18 gain envelope
async function z1() {
  punkt('Z1');
  await neuesProjekt('gain');
  const { clipId } = await baueAudio('A5 Z1', { laenge: 16 });
  const BEATS = [2, 5, 8, 11, 14];
  const kon = await aufnahme('z1-kontrolle', 10);
  const kE = einsatz(kon.l);
  const k = pruefeLinie(kon, kE, 0, BEATS, () => 0);
  roh.z1_kontrolle = { einsatz: kE, ...k };
  notiere('Z1/NK no envelope: the plain line, 0 dB at the five beats', k.abw <= 0.05, `${zeilenText(k.zeilen)}; largest deviation ${db(k.abw)} dB (limit 0.05), onset at frame ${kE}`);

  const PK = [{ beat: 0, wert: -12 }, { beat: 16, wert: 0 }];
  await huelle('A5 Z1 gain -12 to 0', clipId, 'gain', PK);
  const hk = { ziel: 'gain', punkte: PK };
  const m = await aufnahme('z1', 10);
  const e = einsatz(m.l);
  const r = pruefeLinie(m, e, 0, BEATS, (b) => hkWert(hk, b, null));
  roh.z1 = { einsatz: e, ...r };
  notiere('Z1 AK18 gain -12 -> 0 dB over the clip: output on the line at five beats', r.abw <= 0.05, `${zeilenText(r.zeilen)}; largest deviation ${db(r.abw)} dB (limit 0.05)`);
  const weit = Math.min(...r.zeilen.map((x) => Math.abs(x.ist_db - 0)));
  notiere('Z1/NK the envelope acts: no beat reads the plain line', weit > 0.5 || r.zeilen.filter((x) => x.beat < 14).every((x) => Math.abs(x.ist_db) > 0.5), `distance to 0 dB: ${r.zeilen.map((x) => `${x.beat}: ${db(x.ist_db)}`).join(', ')}`);
  schreibeWav(path.join(z.ORDNER, 'hoerproben', 'gain-minus12-bis-0.wav'), m.st);

  // loop copies: clip loop 8, the linked envelope [0, 8) repeats with every copy
  const PL = [{ beat: 0, wert: -12 }, { beat: 8, wert: 0 }];
  await aendereGeladen('A5 Z1 clip loop 8', [{ befehl: 'clip_aendern', clip_id: clipId, loop_beats: 8 }]);
  await huelle('A5 Z1 gain per loop copy', clipId, 'gain', PL);
  const hkL = { ziel: 'gain', punkte: PL };
  const ml = await aufnahme('z1-loop', 10);
  const el = einsatz(ml.l);
  const LB = [2, 6, 10, 14];
  const rl = pruefeLinie(ml, el, 0, LB, (b) => hkWert(hkL, b, 8));
  const haltenWare = LB.map((b) => 0 - hkWert(hkL, b, 8));   // what a non-repeating envelope (last value 0 dB held) would differ by
  roh.z1_loop = { einsatz: el, ...rl };
  notiere('Z1 AK18 clip loop 8: every copy repeats the envelope (beats 2, 6, 10, 14)', rl.abw <= 0.05, `${zeilenText(rl.zeilen)}; largest deviation ${db(rl.abw)} dB (limit 0.05)`);
  notiere('Z1/NK copy 2 is not the held last value', LB.slice(2).every((b, i) => Math.abs(rl.zeilen[2 + i].ist_db) > 3) && haltenWare[2] > 3,
    `beats 10 and 14 read ${db(rl.zeilen[2].ist_db)} and ${db(rl.zeilen[3].ist_db)} dB; a held 0 dB would be ${db(haltenWare[2])} and ${db(haltenWare[3])} dB away from the line`);

  // the clip moved to beat 4 takes the envelope along: play from beat 4, the line starts at the new start
  await aendereGeladen('A5 Z1 clip moved to beat 4', [{ befehl: 'clip_aendern', clip_id: clipId, start_beat: 4 }]);
  const mv = await aufnahme('z1-verschoben', 10, 4);
  const ev = einsatz(mv.l);
  const MB = [6, 10, 14, 18];
  const rv = pruefeLinie(mv, ev, 4, MB, (b) => hkWert(hkL, b - 4, 8));
  roh.z1_verschoben = { einsatz: ev, ...rv };
  notiere('Z1 AK18 the clip moved to beat 4 takes the envelope along', rv.abw <= 0.05, `${zeilenText(rv.zeilen)}; largest deviation ${db(rv.abw)} dB (limit 0.05); the envelope stored on the clip is unchanged: ${JSON.stringify((await projekt()).spuren[0].clips[0].huellkurven)}`);
}

// =============================================================================================================
// Z2 AK19 unlinked envelope
async function z2() {
  punkt('Z2');
  await neuesProjekt('unlinked');
  const { clipId } = await baueAudio('A5 Z2', { laenge: 8 });
  const P = [{ beat: 0, wert: -12 }, { beat: 2, wert: 0 }];
  await huelle('A5 Z2 unlinked loop 2', clipId, 'gain', P, { verknuepft: false, loop_beats: 2 });
  const hk = { ziel: 'gain', verknuepft: false, loop_beats: 2, punkte: P };
  const TEN = [0.5, 1, 1.5, 2.5, 3, 3.5, 4.5, 5, 6.5, 7.5];
  const m = await aufnahme('z2', 6);
  const e = einsatz(m.l);
  const r = pruefeLinie(m, e, 0, TEN, (b) => hkWert(hk, b, null));
  roh.z2 = { einsatz: e, ...r };
  notiere('Z2 AK19 unlinked, loop_beats 2 on an 8-beat clip: value(t) = envelope(t mod 2) at ten beats', r.abw <= 0.05, `${zeilenText(r.zeilen)}; largest deviation ${db(r.abw)} dB (limit 0.05)`);
  // control: the same points linked, no clip loop: no repetition, the last value (0 dB) holds from beat 2 on
  await huelle('A5 Z2 linked control', clipId, 'gain', P);
  const hkK = { ziel: 'gain', punkte: P };
  const k = await aufnahme('z2-verknuepft', 6);
  const ke = einsatz(k.l);
  const kr = pruefeLinie(k, ke, 0, [2.5, 3.5, 5], (b) => hkWert(hkK, b, null));
  const unterschied = [2.5, 3.5, 5].map((b) => Math.abs(hkWert(hk, b, null) - hkWert(hkK, b, null)));
  roh.z2_kontrolle = { einsatz: ke, ...kr, unterschied };
  notiere('Z2/NK linked without a clip loop: no repetition, 0 dB held from beat 2 on (differs from the unlinked line)', kr.abw <= 0.05 && Math.min(...unterschied) >= 3 - 1e-9,
    `${zeilenText(kr.zeilen)}; the unlinked line differs there by ${unterschied.map(db).join(', ')} dB (must be at least 3)`);
}

// =============================================================================================================
// Z3 AK20 transpose envelope on an RB-338 track
const RB = { art: 'intern', name: 'rb338', parameter: { cutoff: 0.6, resonanz: 0.3, env_mod: 0.2 } };
async function baueRb(label, noten, laenge) {
  await aendern(`${label} track`, [{ befehl: 'spur_neu', art: 'instrument', name: 'RB', geraet: RB }], CYPHER);
  const spurId = (await projekt()).spuren.at(-1).id;
  await aendern(`${label} clip`, [{ befehl: 'clip_neu', spur_id: spurId, art: 'midi', start_beat: 0, laenge_beats: laenge, noten }], CYPHER);
  await geladen();
  await warte(3000);
  await aufwaermen();
  return { spurId, clipId: (await projekt()).spuren.find((s) => s.id === spurId).clips[0].id };
}
const tonhoehen = (m, e, anzahl) => Array.from({ length: anzahl }, (_, k) => grundfrequenz(m.l, e + Math.round((k + 0.12) * SCHLAG), Math.round(0.3 * SCHLAG), 60, 400));
const luecke = (m, e, k) => rmsDbfs(m.l, e + Math.round((k + 0.8) * SCHLAG), e + Math.round((k + 0.97) * SCHLAG));
async function z3() {
  punkt('Z3');
  await neuesProjekt('transpose');
  const NOTEN = Array.from({ length: 16 }, (_, k) => ({ beat: k, laenge: 0.5, ton: 45, vel: 100 }));
  const { clipId } = await baueRb('A5 Z3', NOTEN, 16);
  const notenVor = JSON.stringify((await projekt()).spuren[0].clips[0].noten);
  const kon = await aufnahme('z3-kontrolle', 11);
  const kE = einsatz(kon.l);
  const kf = tonhoehen(kon, kE, 16);
  const kMed = median(kf);
  const kAbw = Math.max(...kf.map((f) => Math.abs(halbtoene(kMed, f))));
  roh.z3_kontrolle = { einsatz: kE, frequenzen: kf };
  notiere('Z3/NK no envelope: all 16 notes at one pitch', kAbw <= 0.15 && kMed > 90 && kMed < 130, `fundamentals ${kf.map((f) => f.toFixed(1)).join(' ')} Hz, median ${kMed.toFixed(2)} Hz (A2 = 110), largest spread ${db(kAbw)} semitone (limit 0.15)`);

  const PT = [{ beat: 0, wert: 0 }, { beat: 8, wert: 0 }, { beat: 8, wert: 7 }];
  await huelle('A5 Z3 transpose 0 to +7 at beat 8', clipId, 'transpose', PT);
  const m = await aufnahme('z3', 11);
  const e = einsatz(m.l);
  const f = tonhoehen(m, e, 16);
  const vorher = f.slice(0, 8).map((x) => halbtoene(kMed, x)), nachher = f.slice(8).map((x) => halbtoene(kMed, x));
  roh.z3 = { einsatz: e, frequenzen: f, halbtoene_gegen_kontrolle: [...vorher, ...nachher] };
  notiere('Z3 AK20 notes before beat 8 are unchanged', Math.max(...vorher.map(Math.abs)) <= 0.15, `notes 0 to 7 against the control: ${vorher.map((x) => x.toFixed(2)).join(' ')} semitones (limit +-0.15)`);
  notiere('Z3 AK20 notes from beat 8 sound 7 semitones higher', Math.max(...nachher.map((x) => Math.abs(x - 7))) <= 0.15, `notes 8 to 15 against the control: ${nachher.map((x) => x.toFixed(2)).join(' ')} semitones (limit 7 +-0.15); fundamentals ${f.slice(8).map((x) => x.toFixed(1)).join(' ')} Hz`);
  const notenNach = JSON.stringify((await projekt()).spuren[0].clips[0].noten);
  notiere('Z3 AK20 the notes in the project stay unchanged', notenNach === notenVor && !/"ton":52/.test(notenNach), `notes before and after the envelope equal: ${notenNach === notenVor}, all ton 45: ${JSON.parse(notenNach).every((n) => n.ton === 45)}`);
  const lueckeK = Math.max(...[8, 9, 10, 11, 12, 13, 14, 15].map((k) => luecke(kon, kE, k))), lueckeM = Math.max(...[8, 9, 10, 11, 12, 13, 14, 15].map((k) => luecke(m, e, k)));
  const noteM = Math.min(...[8, 9, 10, 11, 12, 13, 14, 15].map((k) => rmsDbfs(m.l, e + Math.round((k + 0.15) * SCHLAG), e + Math.round((k + 0.4) * SCHLAG))));
  roh.z3_luecken = { kontrolle_db: lueckeK, transponiert_db: lueckeM, note_min_db: noteM };
  notiere('Z3 AK20 the note-off hits the sounding pitch: the gaps after transposed notes are as quiet as in the control', lueckeM <= Math.max(lueckeK + 3, -90) && noteM - lueckeM > 15,   // below -90 dBFS both are silence (the tails measure -300 dBFS and lower, numerically meaningless)
    `loudest gap at notes 8 to 15: ${db(lueckeM)} dBFS (control ${db(lueckeK)}; limit control + 3 dB or -90 dBFS, whichever is higher), quietest note ${db(noteM)} dBFS (more than 15 dB above the gap)`);
  schreibeWav(path.join(z.ORDNER, 'hoerproben', 'rb338-transpose-0-bis-7.wav'), m.st);

  // a long note open at the stop: no hanging tone. The note starts at beat 8 (transposed), the stop falls 1.2 s into it.
  await neuesProjekt('transpose-stop');
  const LANG = [{ beat: 8, laenge: 12, ton: 45, vel: 100 }];
  const { clipId: c2 } = await baueRb('A5 Z3 stop', LANG, 24);
  await huelle('A5 Z3 stop transpose', c2, 'transpose', PT);
  const haengt = await nimmAuf('z3-ohne-stopp', 6, () => transport('start', 7));
  await transport('stopp');
  const eh = einsatz(haengt.l);
  const kopfH = rmsDbfs(haengt.l, eh + Math.round(0.3 * SR), eh + Math.round(1.2 * SR)), schwanzH = rmsDbfs(haengt.l, 4 * SR, 5.8 * SR);
  roh.z3_ohne_stopp = { einsatz: eh, kopf_db: kopfH, schwanz_db: schwanzH };
  notiere('Z3/NK the long note without a stop is loud in the tail window', kopfH > -40 && schwanzH > -40, `head (1 s after the onset) ${db(kopfH)} dBFS, tail (4.0 to 5.8 s) ${db(schwanzH)} dBFS (both above -40)`);
  const stopp = await nimmAuf('z3-stopp', 6, async () => { await transport('start', 7); await warte(2200); await transport('stopp'); });
  const es = einsatz(stopp.l);
  const kopfS = rmsDbfs(stopp.l, es + Math.round(0.3 * SR), es + Math.round(1.2 * SR)), schwanzS = rmsDbfs(stopp.l, 4 * SR, 5.8 * SR);
  roh.z3_stopp = { einsatz: es, kopf_db: kopfS, schwanz_db: schwanzS };
  notiere('Z3 AK20 stop inside a transposed note: silent tail, no hanging tone (offene_noten 0)', kopfS > -40 && schwanzS < -70, `head ${db(kopfS)} dBFS (sounding), tail (4.0 to 5.8 s, about 1.8 s after the stop) ${db(schwanzS)} dBFS (limit below -70)`);
}

// =============================================================================================================
// Z4 AK21 value stack
async function z4() {
  punkt('Z4');
  await neuesProjekt('stack');
  const { spurId, clipId } = await baueAudio('A5 Z4', { laenge: 16 });
  const BEATS = [2, 5, 8, 11, 14];
  const LP = [{ beat: 0, wert: 0 }, { beat: 16, wert: -30 }];
  await aendereGeladen('A5 Z4 fader lane 0 to -30', [{ befehl: 'auto_neu', spur_id: spurId, ziel: 'fader', punkte: LP }]);
  const kon = await aufnahme('z4-kontrolle', 10);
  const kE = einsatz(kon.l);
  const k = pruefeLinie(kon, kE, 0, BEATS, (b) => laneWert(LP, b, 'fader'));
  roh.z4_kontrolle = { einsatz: kE, ...k };
  notiere('Z4/NK lane only (no envelope): the level is the lane', k.abw <= 0.05, `${zeilenText(k.zeilen)}; largest deviation ${db(k.abw)} dB (limit 0.05)`);

  await huelle('A5 Z4 spur_fader -6', clipId, 'spur_fader', [{ beat: 0, wert: -6 }]);
  const m = await aufnahme('z4', 10);
  const e = einsatz(m.l);
  const r = pruefeLinie(m, e, 0, BEATS, (b) => laneWert(LP, b, 'fader') - 6);
  roh.z4 = { einsatz: e, ...r };
  notiere('Z4 AK21 absolute fader lane plus relative -6 dB: level = lane - 6 dB at five beats', r.abw <= 0.05, `${zeilenText(r.zeilen)}; largest deviation ${db(r.abw)} dB (limit 0.05)`);
  const dK = r.zeilen.map((x, i) => x.ist_db - k.zeilen[i].ist_db);
  notiere('Z4/NK the relative envelope acts: -6 dB against the lane-only control at every beat', dK.every((d) => Math.abs(d + 6) <= 0.05), `difference to the control: ${dK.map(db).join(', ')} dB (must be -6.000 +-0.05)`);

  // relative only: no lane, base fader -3 dB, envelope -6 dB: -9 dB; the control without the envelope: -3 dB
  const lane = (await projekt()).spuren.find((s) => s.id === spurId).automation[0].id;
  await aendereGeladen('A5 Z4 drop the lane, base fader -3', [{ befehl: 'auto_loeschen', lane_id: lane }, { befehl: 'spur_aendern', spur_id: spurId, fader_db: -3 }]);
  const ro = await aufnahme('z4-nur-relativ', 6);
  const reo = einsatz(ro.l);
  const rr = pruefeLinie(ro, reo, 0, [1, 4, 7], () => -9);
  roh.z4_nur_relativ = { einsatz: reo, ...rr };
  notiere('Z4 AK21 relative only: base fader -3 dB plus -6 dB = -9 dB', rr.abw <= 0.05, `${zeilenText(rr.zeilen)}; largest deviation ${db(rr.abw)} dB (limit 0.05)`);
  await huelleWeg('A5 Z4 drop the envelope', clipId, 'spur_fader');
  const rk = await aufnahme('z4-nur-basis', 6);
  const rke = einsatz(rk.l);
  const rkr = pruefeLinie(rk, rke, 0, [1, 4, 7], () => -3);
  notiere('Z4/NK base fader only (no lane, no envelope): -3 dB', rkr.abw <= 0.05, `${zeilenText(rkr.zeilen)}; largest deviation ${db(rkr.abw)} dB (limit 0.05)`);
}

// =============================================================================================================
// Z5 null test export = playing
async function z5() {
  punkt('Z5');
  await neuesProjekt('null');
  const { spurId, clipId } = await baueAudio('A5 Z5', { laenge: 16 });
  // the jumps lie 27 frames after a beat: a quarter period of the 440 Hz sine, so the sine is near its crest and a one-sample error shows (on the beat it crosses zero)
  const SPR = 27 / SCHLAG;
  const gainP = (v = 0) => [{ beat: 0, wert: -12 }, { beat: 8 + SPR + v, wert: -3 }, { beat: 8 + SPR + v, wert: 0 }, { beat: 16, wert: 0 }];
  const relP = (v = 0) => [{ beat: 0, wert: 0 }, { beat: 4 + SPR + v, wert: 0 }, { beat: 4 + SPR + v, wert: -6 }, { beat: 12 + SPR, wert: -6 }, { beat: 12 + SPR, wert: 0 }, { beat: 16, wert: 0 }];
  await aendereGeladen('A5 Z5 fader lane', [{ befehl: 'auto_neu', spur_id: spurId, ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 16, wert: -10 }] }]);
  await huelle('A5 Z5 gain', clipId, 'gain', gainP());
  await huelle('A5 Z5 rel fader', clipId, 'spur_fader', relP());
  const dir = path.join(z.ORDNER, 'z5');
  fs.mkdirSync(path.join(dir, 'w'), { recursive: true });
  const nr = (await aktuell()).projekt.wiedergabe_rev;
  const vb = await prog(path.join(BAU, 'cypherdj-nulltest'), ['--vorbedingung', '--bpm', String(BPM)]);
  fs.writeFileSync(path.join(dir, 'vorbedingung.json'), `${vb.out}${vb.err}rc=${vb.rc}\n`);
  if (vb.rc !== 0 || jsonZeile(vb.out)?.vorbedingung !== 'erfuellt') { notiere('Z5 precondition', false, `null test precondition not met (rc ${vb.rc}): ${letzteZeile(vb.out) || letzteZeile(vb.err)}`); return; }
  const live = await nimmAuf('z5-live', 17, () => transport('start', 0), { strom: true });
  await transport('stopp');
  const ein = live.sse.find((x) => x.a === '/zustand/arr' && x.f?.status === 2);
  if (!ein) { notiere('Z5 live recording', false, 'no /zustand/arr with status 2 in the stream (ursprung_sample unknown)'); return; }
  const ursprung = ein.f.ursprung_sample;
  const render = async (name, nrx) => {
    const r = await prog(path.join(BAU, 'cypherdj-render'), ['--nr', String(nrx), '--von-beat', '0', '--bis-beat', '16', '--bpm', String(BPM), '--aus', path.join(dir, 'w', `${name}.wav`), '--abgriff', 'set']);
    fs.writeFileSync(path.join(dir, 'w', `${name}.json`), `${r.out}${r.err}rc=${r.rc}\n`);
    return { rc: r.rc, j: jsonZeile(r.out), err: r.err.trim() };
  };
  const vergleich = async (name, wav, rj) => {
    const r = await prog(path.join(BAU, 'cypherdj-nulltest'), ['--live', path.join(z.ORDNER, 'roh', 'z5-live.f32'), '--live-s0', String(live.mit.s0), '--grenze', String(live.mit.grenze), '--ursprung', String(ursprung),
      '--render', wav, '--start-sample', String(rj.start_sample), '--frames', String(rj.frames), '--vorhalt', String(rj.vorhalt), '--quantum', String(rj.quantum)]);
    fs.writeFileSync(path.join(dir, `nulltest-${name}.json`), `${r.out}${r.err}rc=${r.rc}\n`);
    return { rc: r.rc, j: jsonZeile(r.out), err: r.err.trim() };
  };
  const rend = await render('huelle', nr);
  if (rend.rc !== 0 || !rend.j) { notiere('Z5 render', false, `cypherdj-render rc ${rend.rc} ${rend.err}`); return; }
  const v = await vergleich('huelle', path.join(dir, 'w', 'huelle.wav'), rend.j);
  roh.z5 = { nr, ursprung, render: rend.j, nulltest: v.j, rc: v.rc };
  notiere('Z5 export = playing (gain envelope with a jump, relative fader envelope with two jumps, absolute fader lane)', v.j?.urteil === 'bestanden' && v.j.rest_db < -90,
    `${v.j?.urteil ?? 'no verdict'}${v.j?.ursache ? `/${v.j.ursache}` : ''} rest ${db(v.j?.rest_db)} dBFS (limit -90), signal ${db(v.j?.signal_db)} dBFS, shifted by 1 sample ${db(v.j?.verschoben_db)} dBFS, rc ${v.rc} ${v.err}`);
  // negative controls: one jump one sample late (1/24000 beat at 120 BPM) in a new playback file, rendered against the same recording
  const kontrollen = [['gain', () => huelle('A5 Z5 NK gain', clipId, 'gain', gainP(1 / SCHLAG), {})], ['rel', () => huelle('A5 Z5 NK rel', clipId, 'spur_fader', relP(1 / SCHLAG))]];
  for (const [name, bau] of kontrollen) {
    await huelle('A5 Z5 reset gain', clipId, 'gain', gainP());
    await huelle('A5 Z5 reset rel', clipId, 'spur_fader', relP());
    await bau();
    const nr2 = (await aktuell()).projekt.wiedergabe_rev;
    const rend2 = await render(`${name}-versetzt`, nr2);
    if (rend2.rc !== 0 || !rend2.j) { notiere(`Z5/NK ${name} render`, false, `cypherdj-render rc ${rend2.rc} ${rend2.err}`); continue; }
    const v2 = await vergleich(`${name}-versetzt`, path.join(dir, 'w', `${name}-versetzt.wav`), rend2.j);
    roh[`z5_nk_${name}`] = { nr: nr2, nulltest: v2.j, rc: v2.rc };
    notiere(`Z5/NK the ${name} jump one sample late turns the null test red`, v2.j?.urteil === 'rot' || (typeof v2.j?.rest_db === 'number' && v2.j.rest_db >= -90),
      `${v2.j?.urteil ?? 'no verdict'}${v2.j?.ursache ? `/${v2.j.ursache}` : ''} rest ${db(v2.j?.rest_db)} dBFS (must not be below -90), rc ${v2.rc}`);
  }
}

// =============================================================================================================
// Z6 AK24 Cypher over the hand MCP
async function z6() {
  punkt('Z6');
  await neuesProjekt('mcp');
  const { spurId, clipId } = await baueAudio('A5 Z6', { laenge: 16 });
  const req = createRequire(path.join(HIER, '..', '..', 'hand', 'hand.ts'));
  const esm = (name) => pathToFileURL(req.resolve(`@modelcontextprotocol/sdk/client/${name}.js`).replace('/dist/cjs/', '/dist/esm/')).href;
  const { Client } = await import(esm('index'));
  const { StdioClientTransport } = await import(esm('stdio'));
  const c = new Client({ name: 'abnahme_a5', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(HIER, '..', '..', 'hand', 'hand.ts'), '--seite', z.URL], env: { ...process.env } }));
  const ruf = async (name, args) => { const r = await c.callTool({ name, arguments: args }); let j = null; try { j = JSON.parse(r.content?.[0]?.text ?? ''); } catch { /* text */ } return { fehler: !!r.isError, text: r.content?.[0]?.text ?? '', j }; };
  try {
    const clipVon = async () => (await ruf('proj_lage', {})).j.projekt.spuren.find((s) => s.id === spurId).clips[0];
    const vorLage = await clipVon();
    const kontrolle = await ruf('proj_auto', { clip_id: clipId, ziel: 'gain' });
    notiere('Z6/NK before the envelope: proj_lage has no huellkurven field and proj_auto clip_id answers huellkurve_unbekannt', !('huellkurven' in vorLage) && kontrolle.fehler && /huellkurve_unbekannt/.test(kontrolle.text),
      `huellkurven in proj_lage: ${'huellkurven' in vorLage}, proj_auto: ${kontrolle.fehler ? 'ERROR' : 'accepted'} "${kontrolle.text.slice(0, 120)}"`);
    const LP = [{ beat: 0, wert: 0 }, { beat: 16, wert: -18 }], GP = [{ beat: 0, wert: -12 }, { beat: 16, wert: 0 }];
    const a1 = await ruf('proj_aendern', { label: 'A5 Z6 lane via MCP', befehle: [{ befehl: 'auto_neu', spur_id: spurId, ziel: 'fader', punkte: LP }] });
    const a2 = await ruf('proj_aendern', { label: 'A5 Z6 gain envelope via MCP', befehle: [{ befehl: 'huellkurve_setzen', clip_id: clipId, ziel: 'gain', punkte: GP }] });
    notiere('Z6 AK24 Cypher builds the lane and the clip gain envelope over MCP', !a1.fehler && !a2.fehler, `auto_neu ${a1.fehler ? 'ERROR ' + a1.text.slice(0, 140) : 'ok'}, huellkurve_setzen ${a2.fehler ? 'ERROR ' + a2.text.slice(0, 140) : 'ok'}`);
    await geladen();
    await warte(1500);
    const lage = await clipVon();
    notiere('Z6 AK24 proj_lage lists the envelope without points', JSON.stringify(lage.huellkurven) === JSON.stringify([{ ziel: 'gain', punkte_zahl: 2 }]), `huellkurven ${JSON.stringify(lage.huellkurven)}`);
    const laneId = (await ruf('proj_lage', {})).j.projekt.spuren.find((s) => s.id === spurId).lanes[0].id;
    const lauto = await ruf('proj_auto', { lane_id: laneId, bei_beat: 8 }), hauto = await ruf('proj_auto', { clip_id: clipId, ziel: 'gain', bei_beat: 8 });
    const gleich = (ist, soll) => JSON.stringify(ist.map((p) => [p.beat, p.wert])) === JSON.stringify(soll.map((p) => [p.beat, p.wert]));
    notiere('Z6 AK24 proj_auto reads back what was sent (lane and envelope)', gleich(lauto.j?.punkte ?? [], LP) && gleich(hauto.j?.punkte ?? [], GP) && hauto.j.clip_id === clipId && hauto.j.verknuepft === true,
      `lane ${JSON.stringify(lauto.j?.punkte)}, envelope ${JSON.stringify(hauto.j?.punkte)}, verknuepft ${hauto.j?.verknuepft}`);
    roh.z6_proj_auto = { lane: lauto.j, huelle: hauto.j };
    // bei_beat of the lane plus bei_beat of the envelope against the core level
    const m = await aufnahme('z6', 10);
    const e = einsatz(m.l);
    const zeilen = [];
    for (const b of [4, 8, 12]) {
      const l = (await ruf('proj_auto', { lane_id: laneId, bei_beat: b })).j.bei.wert, h = (await ruf('proj_auto', { clip_id: clipId, ziel: 'gain', bei_beat: b })).j.bei.wert;
      const ist = pegelBei(m, e, 0, b);
      zeilen.push({ beat: b, lane_bei: l, huelle_bei: h, summe: l + h, ist_db: ist, abw_db: ist - (l + h) });
    }
    roh.z6_pegel = { einsatz: e, zeilen };
    const abw = Math.max(...zeilen.map((x) => Math.abs(x.abw_db)));
    notiere('Z6 AK24 proj_auto bei_beat (lane + envelope) equals the core level', abw <= 0.05, `${zeilen.map((x) => `beat ${x.beat}: lane ${db(x.lane_bei)} + envelope ${db(x.huelle_bei)} = ${db(x.summe)} dB, core ${db(x.ist_db)} dB (dev ${db(x.abw_db)})`).join('; ')}; largest deviation ${db(abw)} (limit 0.05)`);
    const verlauf = await ruf('proj_verlauf', {});
    const eintraege = (Array.isArray(verlauf.j) ? verlauf.j : verlauf.j?.verlauf ?? verlauf.j?.eintraege ?? []);
    const meine = eintraege.filter((x) => /^A5 Z6 (lane|gain envelope) via MCP$/.test(x.label ?? ''));
    notiere('Z6 AK24 the history shows source cypher for both changes', meine.length === 2 && meine.every((x) => x.quelle === 'cypher'), `entries ${JSON.stringify(meine.map((x) => [x.label, x.quelle]))}`);
    // Stop Cypher: every write is a tool error, reading goes on
    const stopp = await z.ruf('POST', '/taste', { name: 'stopp' });
    await warte(800);
    try {
      const s1 = await ruf('proj_aendern', { label: 'A5 Z6 blocked envelope', befehle: [{ befehl: 'huellkurve_setzen', clip_id: clipId, ziel: 'gain', punkte: [{ beat: 0, wert: -3 }] }] });
      const s2 = await ruf('proj_aendern', { label: 'A5 Z6 blocked delete', befehle: [{ befehl: 'huellkurve_loeschen', clip_id: clipId, ziel: 'gain' }] });
      const s3 = await ruf('proj_auto', { clip_id: clipId, ziel: 'gain' });
      notiere('Z6 AK24 Stop Cypher: huellkurve_setzen and huellkurve_loeschen are tool errors ki_gestoppt, reading goes on', stopp.code === 200 && s1.fehler && /ki_gestoppt/.test(s1.text) && s2.fehler && /ki_gestoppt/.test(s2.text) && !s3.fehler && gleich(s3.j.punkte, GP),
        `taste stopp ${stopp.code}; setzen: ${s1.fehler ? 'ERROR' : 'accepted'} "${s1.text.slice(0, 90)}"; loeschen: ${s2.fehler ? 'ERROR' : 'accepted'} "${s2.text.slice(0, 90)}"; proj_auto: ${s3.fehler ? 'ERROR' : 'ok'}, envelope unchanged ${gleich(s3.j?.punkte ?? [], GP)}`);
    } finally {
      const fr = await z.ruf('POST', '/taste', { name: 'freigabe' });
      info(`Stop Cypher released: taste freigabe ${fr.code}`);
    }
    await warte(500);
    const frei = await ruf('proj_aendern', { label: 'A5 Z6 after release', befehle: [{ befehl: 'huellkurve_loeschen', clip_id: clipId, ziel: 'gain' }] });
    notiere('Z6/NK released: the same kind of command goes through again', !frei.fehler, `huellkurve_loeschen ${frei.fehler ? 'ERROR ' + frei.text.slice(0, 120) : 'ok'}`);
  } finally {
    await c.close();
  }
}

// =============================================================================================================
async function lauf() {
  const bpm = (await z.ruf('GET', '/lage')).j?.uhr?.bpm;
  fs.mkdirSync(path.join(z.ORDNER, 'hoerproben'), { recursive: true });
  info(`instance ${instanz}, ${z.URL}, core ${bpm} BPM, build folder ${BAU}`);
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);   // an earlier run may have left the transport running
  await warte(1500);
  for (const [n, f] of [['Z1', z1], ['Z2', z2], ['Z3', z3], ['Z4', z4], ['Z5', z5], ['Z6', z6]]) {
    if (!gewollt(n)) continue;
    try { await f(); } catch (e) { notiere(`${n} ABORT`, false, e instanceof Fehl ? e.message : `${e.stack ?? String(e)}`); }
    await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
    await z.ruf('POST', '/taste', { name: 'freigabe' }).catch(() => null);
  }
}

async function ende() {
  roh.nicht_pruefbar = nichtPruefbar;
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
  if (z.fehl === 0) process.stdout.write(`\nALLES OK (core ${instanz})\n`);
  await z.ende('Automation slice 5 target acceptance', /^a5-/);
}

lauf().then(ende).catch(async (e) => {
  notiere(punktName, false, e instanceof Fehl ? e.message : `ABORT: ${e.stack ?? String(e)}`);
  await ende();
});
