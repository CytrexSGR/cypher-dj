// Target acceptance, package 1.12 automation slice 2 (pan, mute, solo, geraet.* lanes, lock, isolation), against a TEST INSTANCE with the freshly built core
// (never the operation, never instance a, c, d, g, h or i):
//   DJK=<worktree>/djk CYPHERDJ_KATALOG=<aufbau.katalog> djk/start/djk-start --instanz e        (silent sink, no --ton-frei; kern/build and notbahn/build hold the fresh binaries)
//   node pruef/a2_aufbau.mjs --ziel /dev/shm/a2-ziel --instanz e > /dev/shm/a2-ziel/aufbau.json
//   flock <CYPHERDJ_ECHTZEIT_SCHLOSS> node pruef/abnahme_a2.mjs --url http://127.0.0.1:52300 --aufbau /dev/shm/a2-ziel/aufbau.json --bau <kernel build folder> [--ausgabe <folder>] [--nur Z1,Z3]
// Material: two steady sines (track A 440 Hz, track B 660 Hz, amplitude 0.3, identical in both channels). The level of a track is then a pure function of fader, pan, mute and
// solo. Every level comes from the master recording of the core (cypherdj-mitschnitt, sample accurate, both channels), amplitudes are least-squares fits of a*sin + b*cos at the known
// frequencies (pruef/a2_messen.mjs, calibrated in tests/pruef_a2_messen.test.mjs). At pan 0 the pan law gives 0.3 * cos(pi/4) = 0.2121 per channel; the first control checks that.
// Acceptance criteria, word for word from the plan (docs/superpowers/plans/2026-11-01-automation-slice2.md, "Acceptance"):
//   "pan lane -1 -> 1 over 16 beats, L/R level against the pan law within 0.1 dB at beats 4, 8, 12;
//    mute lane jump at beat 8 falls over 10 ms +-2;
//    solo lane silences the other track;
//    `geraet.cutoff` lane changes the spectral centroid monotonically;
//    export equals playing (null test) with pan and mute lanes;
//    lock rejects through page and MCP;
//    `proj_lautheit` of track A unchanged by track B's lanes."
//   Z1  pan lane: L and R against the pan law at beats 4, 8, 12 within 0.1 dB. Controls: no lane keeps L = R and the level of pan 0 (0.2121); the linear law would be more than 1 dB away.
//   Z2  mute lane: the jump to 1 at beat 8 (gain 1 -> 0) lasts 10 ms +-2 (width of a straight line fitted to the 20 % to 80 % part, a1_messen.blendeBreite); the unmute jump at beat 12 likewise.
//       Controls: without the lane nothing falls at beat 8, with the lane the signal after the jump is silent.
//   Z3  solo lane on track B: from beat 8 track A (440 Hz) is silent (below -60 dB), track B (660 Hz) stays within 0.1 dB; after the solo ends (beat 12) A is back within 0.1 dB.
//       Controls: without the lane both tones stay at the control level.
//   Z4  geraet.cutoff lane on an RB-338 track (one C2 note per beat): spectral centroid of each beat, 16 beats, strictly rising for a lane 0.45 -> 0.95. The range is chosen
//       above the point where the filter (40 + 4960 * n^4 Hz, kern rb_dsp mapping) falls below the 65 Hz fundamental: a first run with 0.1 -> 0.9 read 74 75 80 72 85 ... Hz,
//       flat within the +-3 % scatter of the instrument at the closed end, which is a property of the sound, not of the lane. Controls: no lane = flat series (not rising),
//       the reversed lane 0.95 -> 0.45 gives a strictly falling series.
//   Z5  export = playing (cypherdj-render of the playback file against the master recording, null test) with a pan lane and a mute lane, both with a jump; rest below -90 dBFS.
//       Controls: the mute jump one sample late in the render, and the pan jump one sample late, each must NOT be below -90 dBFS.
//   Z6  lock through the page (browser on the instance: lock button, click on a locked lane sends nothing, the page's own POST is rejected with lane_gesperrt) and through the hand
//       MCP (proj_aendern on a locked lane is a tool error lane_gesperrt). Controls: the same actions on an unlocked lane go through.
//   Z7  proj_lautheit of track A with and without lanes (fader, pan, mute, solo) on track B: LUFS of A identical. Controls: B's own loudness changes with its lanes (the lanes act).
// Return: 0 all OK, 1 at least one FEHL, 2 usage. Raw data go to rohdaten.json, listening samples to hoerproben/. Only the own projects (slug a2-...) are removed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_ziel.mjs';
import { schreibeWav } from './w1_wav.mjs';
import { SR, amplitude, einsatz, beatSample, verstaerkungsSpur, blendeBreite } from './a1_messen.mjs';
import { panGesetz, panLinear, amplituden, dbVon, einsatzStereo, kanaele, schwerpunkt, kleinsterSchritt } from './a2_messen.mjs';
import { starteBrowser } from './cdp.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_a2: usage: --url <test instance> --aufbau <aufbau.json> --bau <core build folder> [--ausgabe <folder>] [--instanz <a..f>] [--nur Z1,Z3,...]\n');
  process.exit(2);
}
const z = starte('abnahme_a2', 'a2', { bau: { type: 'string' }, nur: { type: 'string' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, instanz } = z;
if (!z.opt.bau) { process.stderr.write('abnahme_a2: --bau <core build folder> is required (cypherdj-mitschnitt, -render, -nulltest)\n'); process.exit(2); }
if (/^[acd]$/.test(instanz)) { process.stderr.write(`abnahme_a2: instance ${instanz} is not for this script: a is the live instance, c and d belong to other sessions\n`); process.exit(2); }
const BAU = path.resolve(z.opt.bau);
const NUR = z.opt.nur ? new Set(z.opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const BPM = 120, SCHLAG = 60 * SR / BPM;   // 24000 frames per beat
const FA = A.freq_a ?? 440, FB = A.freq_b ?? 660, AMP = A.amplitude ?? 0.3;
const roh = {};
const db = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const warte = z.warte;
const HIER = path.dirname(fileURLToPath(import.meta.url));

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
  if (r.code !== 200) throw new Fehl(`/proj/transport ${aktion} → ${z.grundVon(r)}`);
};

// Master recording of `sekunden`; `ablauf` runs 0.5 s after the recorder started (it starts the transport and may change the project while it plays).
// Returns both channels as Float32Array, the interleaved recording and the SSE messages.
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
const spielen = async (aktion) => { await transport('start', 0); if (aktion) await aktion(); };
const aufnahme = async (name, sekunden, opt = {}) => { const r = await nimmAuf(name, sekunden, () => spielen(), opt); await transport('stopp'); return r; };

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
  await aendern(`A2 ${name} tempo`, [{ befehl: 'tempo_setzen', bpm: BPM }], CYPHER);
}
// tracks: [{name, art: 'audio'|'instrument', sha?, geraet?, noten?, pan?, fader_db?}] → ids, clips of 64 beats (audio) or `laengeBeats` (midi)
async function spuren(label, defs) {
  await aendern(`${label} tracks`, defs.map((d) => ({ befehl: 'spur_neu', art: d.art ?? 'audio', name: d.name, ...(d.geraet ? { geraet: d.geraet } : {}) })), CYPHER);
  const p = await projekt();
  const ids = p.spuren.map((s) => s.id);
  const cmds = [];
  defs.forEach((d, i) => {
    if (d.pan !== undefined || d.fader_db !== undefined) cmds.push({ befehl: 'spur_aendern', spur_id: ids[i], ...(d.pan !== undefined ? { pan: d.pan } : {}), ...(d.fader_db !== undefined ? { fader_db: d.fader_db } : {}) });
    if ((d.art ?? 'audio') === 'audio') cmds.push({ befehl: 'clip_neu', spur_id: ids[i], art: 'audio', start_beat: 0, laenge_beats: 64, sha256: d.sha });
    else cmds.push({ befehl: 'clip_neu', spur_id: ids[i], art: 'midi', start_beat: 0, laenge_beats: d.laenge ?? 16, noten: d.noten });
  });
  await aendern(`${label} clips`, cmds, CYPHER);
  await geladen();
  await warte(3000);   // restart state of the core
  return ids;
}
// one lane per call; returns its id. punkte replace all points of an existing lane.
const lanen = {};
async function laneSetzen(label, spurId, ziel, punkte) {
  const schluessel = `${spurId}/${ziel}`;
  if (!lanen[schluessel]) {
    await aendern(`${label} lane`, [{ befehl: 'auto_neu', spur_id: spurId, ziel }], CYPHER);
    const s = (await projekt()).spuren.find((x) => x.id === spurId);
    const id = s.automation?.find((l) => l.ziel === ziel)?.id;
    if (!id) throw new Fehl(`auto_neu left no ${ziel} lane on ${spurId}`);
    lanen[schluessel] = id;
  }
  await aendern(`${label} points`, [{ befehl: 'auto_punkte', lane_id: lanen[schluessel], loesche_von: 0, loesche_bis: 100000, setze: punkte }], CYPHER);
  await geladen();
  await warte(1200);
  return lanen[schluessel];
}
async function laneLoeschen(label, spurId, ziel) {
  const schluessel = `${spurId}/${ziel}`;
  if (!lanen[schluessel]) return;
  await aendern(`${label} delete lane`, [{ befehl: 'auto_loeschen', lane_id: lanen[schluessel] }], CYPHER);
  delete lanen[schluessel];
  await geladen();
  await warte(1200);
}
const alleLanenWeg = () => { for (const k of Object.keys(lanen)) delete lanen[k]; };
const gewollt = (n) => !NUR || NUR.has(n);
let punktName = 'setup';
const punkt = (n) => { punktName = n; };

// =============================================================================================================
// Z1 pan lane
async function z1() {
  punkt('Z1');
  alleLanenWeg();
  await neuesProjekt('pan');
  const [a] = await spuren('A2 Z1', [{ name: 'A', sha: A.sha_a }]);
  const lo = path.join(z.ORDNER, 'hoerproben');
  fs.mkdirSync(lo, { recursive: true });
  // control: no lane, pan 0 (the base value): L = R = AMP * cos(pi/4)
  const k = await aufnahme('z1-kontrolle', 14);
  const kEin = einsatzStereo(k.l, k.r);
  const beats = [4, 8, 12];
  const soll0 = AMP * panGesetz(0).l;
  const kLR = beats.map((b) => ({ l: amplituden(k.l, kEin + beatSample(b, SCHLAG), 1200, [FA])[0], r: amplituden(k.r, kEin + beatSample(b, SCHLAG), 1200, [FA])[0] }));
  const kAbwLR = Math.max(...kLR.map((x) => Math.abs(dbVon(x.l, x.r))));
  const kAbwSoll = Math.max(...kLR.flatMap((x) => [Math.abs(dbVon(x.l, soll0)), Math.abs(dbVon(x.r, soll0))]));
  roh.z1_kontrolle = { einsatz: kEin, kLR, abweichung_lr_db: kAbwLR, abweichung_soll_db: kAbwSoll, soll_amplitude: soll0 };
  notiere('Z1/NK no pan lane: L = R at the level of pan 0', kAbwLR <= 0.05 && kAbwSoll <= 0.1,
    `beats 4, 8, 12: L/R difference at most ${db(kAbwLR)} dB (limit 0.05), level against ${AMP} * cos(pi/4) = ${soll0.toFixed(4)} at most ${db(kAbwSoll)} dB (limit 0.1), onset at frame ${kEin}`);

  await laneSetzen('A2 Z1', a, 'pan', [{ beat: 0, wert: -1 }, { beat: 16, wert: 1 }]);
  const m = await aufnahme('z1', 14);
  const e = einsatzStereo(m.l, m.r);
  const zeilen = [];
  const abw = [];
  const diff = [];
  for (const b of beats) {
    const pan = -1 + 2 * b / 16;
    const g = panGesetz(pan), lin = panLinear(pan);
    const aL = amplituden(m.l, e + beatSample(b, SCHLAG), 1200, [FA])[0], aR = amplituden(m.r, e + beatSample(b, SCHLAG), 1200, [FA])[0];
    const dl = dbVon(aL, AMP * g.l), dr = dbVon(aR, AMP * g.r);
    abw.push(Math.abs(dl), Math.abs(dr));
    // the linear law must be far from the measurement (calibration: a core with the mutated pan law could not pass)
    diff.push(Math.abs(dbVon(aL, AMP * lin.l)), Math.abs(dbVon(aR, AMP * lin.r)));
    zeilen.push({ beat: b, pan, l_amp: aL, r_amp: aR, l_db: dbVon(aL, AMP), r_db: dbVon(aR, AMP), soll_l_db: dbVon(AMP * g.l, AMP), soll_r_db: dbVon(AMP * g.r, AMP), abw_l_db: dl, abw_r_db: dr });
  }
  // additional beats for the report (not in the verdict): the extremes of the sweep
  const extra = [1, 2, 6, 10, 14, 15].map((b) => {
    const pan = -1 + 2 * b / 16, g = panGesetz(pan);
    const aL = amplituden(m.l, e + beatSample(b, SCHLAG), 1200, [FA])[0], aR = amplituden(m.r, e + beatSample(b, SCHLAG), 1200, [FA])[0];
    return { beat: b, pan, abw_l_db: dbVon(aL, AMP * g.l), abw_r_db: dbVon(aR, AMP * g.r) };
  });
  roh.z1 = { einsatz: e, zeilen, extra };
  notiere('Z1 pan law at beats 4, 8, 12', Math.max(...abw) <= 0.1, zeilen.map((x) => `beat ${x.beat} (pan ${x.pan.toFixed(2)}): L ${db(x.l_db)} dB (law ${db(x.soll_l_db)}, dev ${db(x.abw_l_db)}), R ${db(x.r_db)} dB (law ${db(x.soll_r_db)}, dev ${db(x.abw_r_db)})`).join('; ')
    + `; largest deviation ${db(Math.max(...abw))} dB, limit 0.1 (levels relative to the track amplitude ${AMP})`);
  info(`Z1 further beats (INFO, no verdict): ${extra.map((x) => `beat ${x.beat}: L ${db(x.abw_l_db)}, R ${db(x.abw_r_db)}`).join('; ')}`);
  // the lane is audible: left and right differ strongly at beat 4 (a core that ignores the lane would read L = R)
  const z4 = zeilen[0];
  notiere('Z1/NK the lane moves the image', Math.abs(z4.l_db - z4.r_db) > 3 && z4.l_db > z4.r_db && zeilen[2].r_db > zeilen[2].l_db,
    `beat 4: L ${db(z4.l_db)} against R ${db(z4.r_db)} dB, beat 12: L ${db(zeilen[2].l_db)} against R ${db(zeilen[2].r_db)} dB (the control without lane stayed within ${db(kAbwLR)} dB)`);
  notiere('Z1/NK the linear pan law is not what the core plays', Math.min(...diff) > 1, `measurement against the linear law at beats 4, 8, 12: smallest distance ${db(Math.min(...diff))} dB (must be above 1; a core with the linear law would be within 0.1 of it, not 0.1 of the constant-power law)`);
  schreibeWav(path.join(lo, 'pan-fahrt-440.wav'), m.st);
}

// =============================================================================================================
// Z2 mute lane
async function z2() {
  punkt('Z2');
  alleLanenWeg();
  await neuesProjekt('mute');
  const [a] = await spuren('A2 Z2', [{ name: 'A', sha: A.sha_a }]);
  const kontrolle = await aufnahme('z2-kontrolle', 14);
  const kEin = einsatz(kontrolle.l);
  const ref = AMP * panGesetz(0).l;
  const kSpur = verstaerkungsSpur(kontrolle.l, kEin + beatSample(7.6, SCHLAG), kEin + beatSample(8.4, SCHLAG), 48, 109, ref);
  const kAbw = Math.max(...kSpur.map((s) => Math.abs(s.db)));
  roh.z2_kontrolle = { einsatz: kEin, grösste_abweichung_db: kAbw };
  notiere('Z2/NK no mute lane: nothing falls at beat 8', kAbw <= 0.05, `level over beats 7.6 to 8.4 within ${db(kAbw)} dB of the reference ${ref.toFixed(4)} (limit 0.05)`);

  // lane: muted from beat 8 to beat 12 (jump to 1, jump back to 0)
  await laneSetzen('A2 Z2', a, 'mute', [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }, { beat: 12, wert: 0 }]);
  const p = (await projekt()).spuren[0].automation[0].punkte;
  roh.z2_punkte = p;
  const m = await aufnahme('z2', 14);
  const e = einsatz(m.l);
  const von = e + beatSample(7.8, SCHLAG);
  const fall = verstaerkungsSpur(m.l, von, e + beatSample(8.2, SCHLAG), 48, 109, ref);
  const g0 = 1, g1 = 0;
  const bf = blendeBreite(fall, g0, g1);
  const dauerMs = bf ? bf.frames / SR * 1000 : NaN;
  const mitteBeat = bf ? (bf.mitte - e) / SCHLAG : NaN;
  const anstieg = verstaerkungsSpur(m.l, e + beatSample(11.8, SCHLAG), e + beatSample(12.2, SCHLAG), 48, 109, ref);
  const bs = blendeBreite(anstieg, 0, 1);
  const dauerHoch = bs ? bs.frames / SR * 1000 : NaN;
  const stille = amplitude(m.l, e + beatSample(10, SCHLAG), 1200) / ref, davor = amplitude(m.l, e + beatSample(6, SCHLAG), 1200) / ref, danach = amplitude(m.l, e + beatSample(14, SCHLAG), 1200) / ref;
  roh.z2 = { einsatz: e, fall_ms: dauerMs, fall_mitte_beat: mitteBeat, anstieg_ms: dauerHoch, anstieg_mitte_beat: bs ? (bs.mitte - e) / SCHLAG : null, stille_db: 20 * Math.log10(Math.max(stille, 1e-9)), davor_db: 20 * Math.log10(davor), danach_db: 20 * Math.log10(danach) };
  notiere('Z2 mute jump at beat 8 falls over 10 ms +-2', Math.abs(dauerMs - 10) <= 2, `fitted width of the gain fall ${db(dauerMs)} ms (expected 10 ms +-2: 480 frames; the 109-frame window stretches it by about 2 %, calibrated in tests/pruef_a1_messen.test.mjs), midpoint of the fall at beat ${mitteBeat.toFixed(4)} (jump at beat 8: ${db((mitteBeat - 8) * 500)} ms after it)`);
  notiere('Z2 unmute jump at beat 12 rises over 10 ms +-2', Math.abs(dauerHoch - 10) <= 2, `fitted width of the gain rise ${db(dauerHoch)} ms, midpoint at beat ${bs ? ((bs.mitte - e) / SCHLAG).toFixed(4) : '?'}`);
  notiere('Z2/NK the lane mutes between 8 and 12 and nowhere else', 20 * Math.log10(Math.max(stille, 1e-9)) < -60 && Math.abs(20 * Math.log10(davor)) <= 0.05 && Math.abs(20 * Math.log10(danach)) <= 0.05,
    `beat 6 ${db(20 * Math.log10(davor))} dB, beat 10 ${db(20 * Math.log10(Math.max(stille, 1e-9)))} dB (must be below -60), beat 14 ${db(20 * Math.log10(danach))} dB, relative to the reference`);
  schreibeWav(path.join(z.ORDNER, 'hoerproben', 'mute-8-bis-12-440.wav'), m.st);
}

// =============================================================================================================
// Z3 solo lane
async function z3() {
  punkt('Z3');
  alleLanenWeg();
  await neuesProjekt('solo');
  const [, b] = await spuren('A2 Z3', [{ name: 'A', sha: A.sha_a }, { name: 'B', sha: A.sha_b }]);
  const beats = [4, 10, 14];
  const ref = AMP * panGesetz(0).l;
  const messen = (m, e, bt) => amplituden(m.l, e + beatSample(bt, SCHLAG), 2400, [FA, FB]);
  const k = await aufnahme('z3-kontrolle', 14);
  const kE = einsatz(k.l);
  const kA = beats.map((bt) => messen(k, kE, bt));
  const kAbw = Math.max(...kA.flatMap((x) => [Math.abs(dbVon(x[0], ref)), Math.abs(dbVon(x[1], ref))]));
  roh.z3_kontrolle = { einsatz: kE, amplituden: kA, abweichung_db: kAbw };
  notiere('Z3/NK no solo lane: both tones keep the control level', kAbw <= 0.1, `440 and 660 Hz at beats 4, 10, 14 within ${db(kAbw)} dB of ${ref.toFixed(4)} (limit 0.1)`);

  await laneSetzen('A2 Z3', b, 'solo', [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }, { beat: 12, wert: 0 }]);
  const m = await aufnahme('z3', 14);
  const e = einsatz(m.l);
  const [vorA, vorB] = messen(m, e, 4), [mitA, mitB] = messen(m, e, 10), [nachA, nachB] = messen(m, e, 14);
  const dA = { vor: dbVon(vorA, ref), mit: dbVon(mitA, ref), nach: dbVon(nachA, ref) }, dB = { vor: dbVon(vorB, ref), mit: dbVon(mitB, ref), nach: dbVon(nachB, ref) };
  roh.z3 = { einsatz: e, a: dA, b: dB };
  notiere('Z3 solo on B: A is silent while B solos', dA.mit < -60, `beat 10: track A (440 Hz) ${db(dA.mit)} dB against its level before (beat 4: ${db(dA.vor)} dB), limit below -60 dB`);
  notiere('Z3 solo on B: B keeps its level', Math.abs(dB.mit - dB.vor) <= 0.1 && Math.abs(dB.vor) <= 0.1, `track B (660 Hz): beat 4 ${db(dB.vor)} dB, beat 10 ${db(dB.mit)} dB against ${ref.toFixed(4)} (limit 0.1)`);
  notiere('Z3 the solo ends at beat 12: A returns', Math.abs(dA.nach) <= 0.1 && Math.abs(dB.nach) <= 0.1, `beat 14: A ${db(dA.nach)} dB, B ${db(dB.nach)} dB (limit 0.1)`);
  schreibeWav(path.join(z.ORDNER, 'hoerproben', 'solo-b-8-bis-12.wav'), m.st);
}

// =============================================================================================================
// Z4 geraet.cutoff lane: spectral centroid per beat
const RB_NOTEN = Array.from({ length: 16 }, (_, i) => ({ beat: i, laenge: 0.5, ton: 36, vel: 100 }));
async function z4() {
  punkt('Z4');
  alleLanenWeg();
  await neuesProjekt('cutoff');
  const [a] = await spuren('A2 Z4', [{ name: 'RB', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.5, resonanz: 0.3, env_mod: 0.2 } }, noten: RB_NOTEN, laenge: 16 }]);
  const reihe = (m, e) => Array.from({ length: 16 }, (_, i) => schwerpunkt(m.l, e + beatSample(i, SCHLAG), 16384));
  const lauf = async (name) => {
    const m = await aufnahme(name, 14);
    const e = einsatzRel(m.l);
    return { m, e, c: reihe(m, e) };
  };
  const hz = (c) => c.map((x) => Math.round(x)).join(' ');
  const k = await lauf('z4-kontrolle');
  const kSchritt = kleinsterSchritt(k.c, 1), kStreu = (Math.max(...k.c) - Math.min(...k.c)) / (k.c.reduce((s, x) => s + x, 0) / k.c.length);
  roh.z4_kontrolle = { einsatz: k.e, schwerpunkte_hz: k.c, kleinster_schritt: kSchritt, streuung: kStreu };
  info(`Z4 control without lane: centroid per beat ${hz(k.c)} Hz, spread ${(kStreu * 100).toFixed(2)} % of the mean`);

  await laneSetzen('A2 Z4 rising', a, 'geraet.cutoff', [{ beat: 0, wert: 0.45 }, { beat: 16, wert: 0.95 }]);
  const auf = await lauf('z4-steigend');
  const sAuf = kleinsterSchritt(auf.c, 1);
  roh.z4_steigend = { einsatz: auf.e, schwerpunkte_hz: auf.c, kleinster_schritt: sAuf };
  notiere('Z4 geraet.cutoff 0.45 to 0.95: centroid rises monotonically', sAuf > 0 && auf.c[15] > 2 * auf.c[0], `centroid per beat (Hz): ${hz(auf.c)}; smallest step ${(sAuf * 100).toFixed(3)} % of the mean (must be above 0, strictly rising); beat 15 over beat 0: x${(auf.c[15] / auf.c[0]).toFixed(2)} (must be above 2)`);
  notiere('Z4/NK no lane: the centroid does not rise', !(kSchritt > 0 && k.c[15] > 1.5 * k.c[0]), `control series ${hz(k.c)} Hz: smallest step ${(kSchritt * 100).toFixed(3)} %, beat 15 over beat 0 x${(k.c[15] / k.c[0]).toFixed(2)} (a rising series would be strictly rising and at least x1.5)`);

  await laneSetzen('A2 Z4 falling', a, 'geraet.cutoff', [{ beat: 0, wert: 0.95 }, { beat: 16, wert: 0.45 }]);
  const ab = await lauf('z4-fallend');
  const sAb = kleinsterSchritt(ab.c, -1);
  roh.z4_fallend = { einsatz: ab.e, schwerpunkte_hz: ab.c, kleinster_schritt: sAb };
  notiere('Z4/NK reversed lane 0.95 to 0.45: centroid falls monotonically', sAb > 0 && ab.c[0] > 2 * ab.c[15], `centroid per beat (Hz): ${hz(ab.c)}; smallest falling step ${(sAb * 100).toFixed(3)} % (must be above 0)`);
  schreibeWav(path.join(z.ORDNER, 'hoerproben', 'rb338-cutoff-0.45-bis-0.95.wav'), auf.m.st);
}
// onset for sources of any level: 4 % of the peak of the first 20000 frames after the first non-zero sample
function einsatzRel(l) {
  let i0 = 0;
  while (i0 < l.length && Math.abs(l[i0]) < 1e-7) i0++;
  let mx = 0;
  for (let i = i0; i < Math.min(l.length, i0 + 20000); i++) mx = Math.max(mx, Math.abs(l[i]));
  for (let i = i0; i < l.length; i++) if (Math.abs(l[i]) > 0.04 * mx) return i;
  return -1;
}

// =============================================================================================================
// Z5 null test: export = playing with a pan lane and a mute lane (both with a jump)
async function z5() {
  punkt('Z5');
  alleLanenWeg();
  await neuesProjekt('null');
  const [a] = await spuren('A2 Z5', [{ name: 'A', sha: A.sha_a }]);
  // the jumps lie 27 frames after a beat: a quarter period of the 440 Hz sine, so the sine is near its crest and a one-sample error shows (on the beat it crosses zero)
  const SPR = 27 / SCHLAG;
  const panPunkte = (v = 0) => [{ beat: 0, wert: -1 }, { beat: 6 + SPR + v, wert: 0.2 }, { beat: 6 + SPR + v, wert: -0.6 }, { beat: 16, wert: 1 }];
  const mutePunkte = (v = 0) => [{ beat: 0, wert: 0 }, { beat: 8 + SPR + v, wert: 1 }, { beat: 12 + SPR + v, wert: 0 }];
  await laneSetzen('A2 Z5 pan', a, 'pan', panPunkte());
  await laneSetzen('A2 Z5 mute', a, 'mute', mutePunkte());
  const dir = path.join(z.ORDNER, 'z5');
  fs.mkdirSync(path.join(dir, 'w'), { recursive: true });
  const nr = (await aktuell()).projekt.wiedergabe_rev;
  const vb = await prog(path.join(BAU, 'cypherdj-nulltest'), ['--vorbedingung', '--bpm', String(BPM)]);
  fs.writeFileSync(path.join(dir, 'vorbedingung.json'), `${vb.out}${vb.err}rc=${vb.rc}\n`);
  if (vb.rc !== 0 || jsonZeile(vb.out)?.vorbedingung !== 'erfuellt') { notiere('Z5 precondition', false, `null test precondition not met (rc ${vb.rc}): ${letzteZeile(vb.out) || letzteZeile(vb.err)}`); return; }
  const live = await nimmAuf('z5-live', 17, () => spielen(), { strom: true });
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
  const rend = await render('lane', nr);
  if (rend.rc !== 0 || !rend.j) { notiere('Z5 render', false, `cypherdj-render rc ${rend.rc} ${rend.err}`); return; }
  const v = await vergleich('lane', path.join(dir, 'w', 'lane.wav'), rend.j);
  roh.z5 = { nr, ursprung, render: rend.j, nulltest: v.j, rc: v.rc };
  notiere('Z5 export = playing (pan lane with a jump and mute lane with two jumps)', v.j?.urteil === 'bestanden' && v.j.rest_db < -90,
    `${v.j?.urteil ?? 'no verdict'}${v.j?.ursache ? `/${v.j.ursache}` : ''} rest ${db(v.j?.rest_db)} dBFS (limit -90), signal ${db(v.j?.signal_db)} dBFS, shifted by 1 sample ${db(v.j?.verschoben_db)} dBFS, rc ${v.rc} ${v.err}`);
  // negative controls: one lane shifted by one sample (1/24000 beat at 120 BPM) in a new playback file, rendered against the same recording
  for (const [name, bau] of [['mute', async () => laneSetzen('A2 Z5 NK mute', a, 'mute', mutePunkte(1 / SCHLAG))], ['pan', async () => laneSetzen('A2 Z5 NK pan', a, 'pan', panPunkte(1 / SCHLAG))]]) {
    await laneSetzen(`A2 Z5 reset`, a, 'mute', mutePunkte());
    await laneSetzen(`A2 Z5 reset`, a, 'pan', panPunkte());
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
// Z6 lock: page (browser on the instance) and hand MCP
const meldungZaehler = (b) => b.werte(`document.querySelector('[data-p="meldung"]')?.textContent ?? ''`);
async function z6() {
  punkt('Z6');
  alleLanenWeg();
  await neuesProjekt('lock');
  const [a] = await spuren('A2 Z6', [{ name: 'A', sha: A.sha_a }]);
  const laneId = await laneSetzen('A2 Z6', a, 'pan', [{ beat: 0, wert: -1 }, { beat: 16, wert: 1 }]);
  const lage = async () => (await projekt()).spuren[0].automation.find((l) => l.id === laneId);
  const b = await starteBrowser();
  const w = (x) => b.werte(x);
  try {
    await b.oeffne(z.URL);
    await warte(1500);
    await b.klick('[data-ansicht="produktion"]'); await warte(1500);
    let sichtbar = await w(`!!document.querySelector('.p-kopf[data-spur="${a}"]')`);
    if (!sichtbar) { await w(`(() => { const sel = document.querySelector('[data-p="oeffnen"]'); if (sel) sel.dispatchEvent(new Event('focus')); })()`); await warte(1500); sichtbar = await w(`!!document.querySelector('.p-kopf[data-spur="${a}"]')`); }
    if (!sichtbar) throw new Fehl(`the page does not show track ${a} of the open project`);
    // log of the page's own requests
    await w(`(() => { window.__req = []; const f = window.fetch.bind(window); window.fetch = (u, o) => { try { window.__req.push({ u: String(u), b: o && o.body ? String(o.body) : '' }); } catch (e) { /* log only */ } return f(u, o); }; })()`);
    const anfragen = async () => (await w('window.__req')).filter((q) => q.u.includes('/proj/aendern')).map((q) => { try { return JSON.parse(q.b).befehle.map((x) => x.befehl); } catch { return ['?']; } });
    await b.klick(`.p-kopf[data-spur="${a}"] .p-lane`); await warte(500);   // open the lane row
    const f = await w(`(() => { const r = document.querySelector('[data-p="flaeche"]').getBoundingClientRect(); return { l: r.left, t: r.top }; })()`);
    const an = await w('window.djkProd.ansicht');
    const xb = (beat) => f.l + (beat - an.beat0) * an.pxProBeat;
    const yp = (v) => f.t + 64 + 3 + (1 - (Math.min(1, Math.max(-1, v)) + 1) / 2) * 42;   // lane row of track 0 starts below its 64 px head
    const klickLane = async (beat, wert) => { await b.maus('mouseMoved', xb(beat), yp(wert), { buttons: 0 }); await b.maus('mousePressed', xb(beat), yp(wert)); await b.maus('mouseReleased', xb(beat), yp(wert)); await warte(800); };
    // control first: unlocked, a click on the lane changes it (one auto_punkte)
    let n = (await anfragen()).length, punkte0 = (await lage()).punkte.length;
    await klickLane(6, 0.5);
    const kontrolleAnfr = (await anfragen()).slice(n), kontrollePunkte = (await lage()).punkte.length;
    notiere('Z6/NK page, lane not locked: the click goes through', JSON.stringify(kontrolleAnfr) === '[["auto_punkte"]]' && kontrollePunkte === punkte0 + 1, `requests ${JSON.stringify(kontrolleAnfr)}, points ${punkte0} -> ${kontrollePunkte}`);
    // lock with the button
    n = (await anfragen()).length;
    await b.klick(`.p-lanenkopf .p-lane-sperre`); await warte(900);
    const sperreAnfr = (await anfragen()).slice(n);
    const gesperrt = (await lage()).gesperrt === true;
    notiere('Z6 page: the lock button sets the lock on the server', JSON.stringify(sperreAnfr) === '[["auto_aendern"]]' && gesperrt, `requests ${JSON.stringify(sperreAnfr)}, lane gesperrt on the server: ${gesperrt}`);
    // locked: click, drag and Del send nothing, the server state stays
    const revVor = await z.holeRev(), punkteVor = JSON.stringify((await lage()).punkte);
    n = (await anfragen()).length;
    await klickLane(10, -0.5);
    await b.maus('mouseMoved', xb(6), yp(0.5), { buttons: 0 }); await b.maus('mousePressed', xb(6), yp(0.5));
    for (let i = 1; i <= 6; i++) await b.maus('mouseMoved', xb(6) + 6 * i, yp(0.5) + 3 * i);
    await b.maus('mouseReleased', xb(6) + 36, yp(0.5) + 18); await warte(600);
    const gesperrtAnfr = (await anfragen()).slice(n).filter((x) => x.some((c) => c.startsWith('auto_')));
    const meldung = await meldungZaehler(b);
    notiere('Z6 page: a locked lane takes no click or drag, the page says why', gesperrtAnfr.length === 0 && (await z.holeRev()) === revVor && JSON.stringify((await lage()).punkte) === punkteVor && /locked/i.test(meldung),
      `lane requests after click and drag: ${gesperrtAnfr.length}, project rev ${revVor} -> ${await z.holeRev()}, points unchanged ${JSON.stringify((await lage()).punkte) === punkteVor}, message "${meldung}"`);
    // the page's own POST bypassing its gesture code: the server rejects it
    const roh1 = await w(`(async () => { const rev = (await (await fetch('/proj/aktuell?nur=rev')).json()).rev; const r = await fetch('/proj/aendern', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rev, label: 'A2 lock probe from the page', befehle: [{ befehl: 'auto_punkte', lane_id: ${JSON.stringify(laneId)}, loesche_von: 0, loesche_bis: 100000, setze: [{ beat: 0, wert: 0 }] }] }) });
      return { code: r.status, text: await r.text() }; })()`);
    let g1 = null; try { g1 = JSON.parse(roh1.text); } catch { /* text */ }
    notiere('Z6 page: a request from the page itself on the locked lane is rejected', roh1.code >= 400 && /lane_gesperrt/.test(roh1.text) && JSON.stringify((await lage()).punkte) === punkteVor, `HTTP ${roh1.code} ${g1?.fehler ?? g1?.grund ?? roh1.text.slice(0, 120)}, points unchanged ${JSON.stringify((await lage()).punkte) === punkteVor}`);
    // unlock with the button, the same click goes through again
    n = (await anfragen()).length;
    await b.klick(`.p-lanenkopf .p-lane-sperre`); await warte(900);
    await klickLane(10, -0.5);
    const entsperrtAnfr = (await anfragen()).slice(n);
    notiere('Z6/NK page: unlocked again, the same click goes through', JSON.stringify(entsperrtAnfr) === '[["auto_aendern"],["auto_punkte"]]' && !(await lage()).gesperrt && (await lage()).punkte.length === punkte0 + 2,
      `requests ${JSON.stringify(entsperrtAnfr)}, gesperrt ${(await lage()).gesperrt ?? false}, points ${(await lage()).punkte.length}`);
    await b.bild(path.join(z.ORDNER, 'lock-seite.png'));
  } finally {
    await b.zu();
  }

  // ---- hand MCP (djk-hand over stdio against this instance) ----
  const req = createRequire(path.join(HIER, '..', '..', 'hand', 'hand.ts'));
  const esm = (name) => pathToFileURL(req.resolve(`@modelcontextprotocol/sdk/client/${name}.js`).replace('/dist/cjs/', '/dist/esm/')).href;
  const { Client } = await import(esm('index'));
  const { StdioClientTransport } = await import(esm('stdio'));
  const c = new Client({ name: 'abnahme_a2', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(HIER, '..', '..', 'hand', 'hand.ts'), '--seite', z.URL], env: { ...process.env } }));
  try {
    const ruf = async (name, args) => { const r = await c.callTool({ name, arguments: args }); return { fehler: !!r.isError, text: r.content?.[0]?.text ?? '' }; };
    const punktAend = (beat) => ({ label: 'A2 lock probe from MCP', befehle: [{ befehl: 'auto_punkte', lane_id: laneId, loesche_von: 0, loesche_bis: 100000, setze: [{ beat, wert: 0.25 }] }] });
    const vor = JSON.stringify((await lage()).punkte);
    const sperre = await ruf('proj_aendern', { label: 'A2 lock via MCP', befehle: [{ befehl: 'auto_aendern', lane_id: laneId, gesperrt: true }] });
    const auto = await ruf('proj_auto', { lane_id: laneId });
    const ja = !sperre.fehler && /"gesperrt":\s*true/.test(auto.text);
    notiere('Z6 MCP: proj_aendern auto_aendern locks the lane, proj_auto reports it', ja, `lock call ${sperre.fehler ? 'ERROR ' + sperre.text.slice(0, 120) : 'ok'}, proj_auto gesperrt: ${/"gesperrt":\s*true/.test(auto.text)}`);
    const abgelehnt = await ruf('proj_aendern', punktAend(3));
    const abgelehnt2 = await ruf('proj_aendern', { label: 'A2 lock probe delete', befehle: [{ befehl: 'auto_loeschen', lane_id: laneId }] });
    notiere('Z6 MCP: a change on the locked lane is a tool error lane_gesperrt', abgelehnt.fehler && /lane_gesperrt/.test(abgelehnt.text) && abgelehnt2.fehler && /lane_gesperrt/.test(abgelehnt2.text) && JSON.stringify((await lage()).punkte) === vor,
      `auto_punkte: ${abgelehnt.fehler ? 'ERROR' : 'accepted'} "${abgelehnt.text.slice(0, 110)}"; auto_loeschen: ${abgelehnt2.fehler ? 'ERROR' : 'accepted'} "${abgelehnt2.text.slice(0, 110)}"; points unchanged ${JSON.stringify((await lage()).punkte) === vor}`);
    const auf = await ruf('proj_aendern', { label: 'A2 unlock via MCP', befehle: [{ befehl: 'auto_aendern', lane_id: laneId, gesperrt: false }] });
    const frei = await ruf('proj_aendern', punktAend(3));
    const punkteNach = (await lage()).punkte;
    notiere('Z6/NK MCP: unlocked, the same change goes through', !auf.fehler && !frei.fehler && punkteNach.length === 1 && punkteNach[0].beat === 3, `unlock ${auf.fehler ? 'ERROR ' + auf.text.slice(0, 100) : 'ok'}, auto_punkte ${frei.fehler ? 'ERROR ' + frei.text.slice(0, 100) : 'ok'}, points now ${JSON.stringify(punkteNach)}`);
  } finally {
    await c.close();
  }
}

// =============================================================================================================
// Z7 isolation: proj_lautheit of track A does not depend on the lanes of track B
async function z7() {
  punkt('Z7');
  alleLanenWeg();
  await neuesProjekt('lautheit');
  const [a, b] = await spuren('A2 Z7', [{ name: 'A', sha: A.sha_a }, { name: 'B', sha: A.sha_b }]);
  const messe = async (name) => {
    const r = await z.ruf('POST', '/proj/lautheit', { von_beat: 0, bis_beat: 16 }, CYPHER);
    if (r.code !== 200) throw new Fehl(`/proj/lautheit (${name}) → ${z.grundVon(r)}`);
    fs.writeFileSync(path.join(z.ORDNER, `lautheit-${name}.json`), JSON.stringify(r.j, null, 1));
    const sa = r.j.spuren.find((s) => s.spur_id === a), sb = r.j.spuren.find((s) => s.spur_id === b);
    if (!sa || !sb) throw new Fehl(`/proj/lautheit (${name}): track not in the answer ${JSON.stringify(r.j.spuren.map((s) => s.spur_id))}`);
    return { a: sa, b: sb, summe: r.j.summe };
  };
  const ohne = await messe('ohne-lanen');
  const ohne2 = await messe('ohne-lanen-wiederholt');
  await laneSetzen('A2 Z7 fader', b, 'fader', [{ beat: 0, wert: 0 }, { beat: 16, wert: -18 }]);
  await laneSetzen('A2 Z7 pan', b, 'pan', [{ beat: 0, wert: -1 }, { beat: 16, wert: 1 }]);
  await laneSetzen('A2 Z7 mute', b, 'mute', [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }, { beat: 12, wert: 0 }]);
  await laneSetzen('A2 Z7 solo', b, 'solo', [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }, { beat: 12, wert: 0 }]);   // the hardest case: a solo lane on B must not silence A in A's own isolated render
  const mit = await messe('mit-lanen-b');
  roh.z7 = { ohne, ohne2, mit };
  const dWdh = Math.abs(ohne.a.lufs_i - ohne2.a.lufs_i), dA = Math.abs(mit.a.lufs_i - ohne.a.lufs_i), dB = Math.abs(mit.b.lufs_i - ohne.b.lufs_i);
  notiere('Z7/NK repeating the measurement gives the same value (the instrument is steady)', dWdh <= 0.01, `track A ${db(ohne.a.lufs_i)} then ${db(ohne2.a.lufs_i)} LUFS, difference ${db(dWdh)} LU (limit 0.01)`);
  notiere('Z7 proj_lautheit of track A is unchanged by the lanes of track B', dA <= 0.01 && Math.abs(mit.a.true_peak_dbtp - ohne.a.true_peak_dbtp) <= 0.01, `track A without lanes on B ${db(ohne.a.lufs_i)} LUFS (true peak ${db(ohne.a.true_peak_dbtp)}), with fader, pan, mute and solo lanes on B ${db(mit.a.lufs_i)} LUFS (true peak ${db(mit.a.true_peak_dbtp)}): difference ${db(dA)} LU (limit 0.01)`);
  notiere('Z7/NK the lanes of track B do act on B itself and on the sum', dB > 1 && Math.abs(mit.summe.lufs_i - ohne.summe.lufs_i) > 0.5, `track B ${db(ohne.b.lufs_i)} -> ${db(mit.b.lufs_i)} LUFS (change ${db(dB)} LU, must be above 1), sum ${db(ohne.summe.lufs_i)} -> ${db(mit.summe.lufs_i)} LUFS (must differ by more than 0.5)`);
}

// =============================================================================================================
async function lauf() {
  const bpm = (await z.ruf('GET', '/lage')).j?.uhr?.bpm;
  fs.mkdirSync(path.join(z.ORDNER, 'hoerproben'), { recursive: true });
  info(`instance ${instanz}, ${z.URL}, core ${bpm} BPM, build folder ${BAU}`);
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);   // an earlier run may have left the transport running
  await warte(1500);
  for (const [n, f] of [['Z1', z1], ['Z2', z2], ['Z3', z3], ['Z4', z4], ['Z5', z5], ['Z6', z6], ['Z7', z7]]) {
    if (!gewollt(n)) continue;
    try { await f(); } catch (e) { notiere(`${n} ABORT`, false, e instanceof Fehl ? e.message : `${e.stack ?? String(e)}`); }
    await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  }
}

async function ende() {
  await z.ende('Automation slice 2 target acceptance', /^a2-/);
}

lauf().then(() => { fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1)); return ende(); }).catch(async (e) => {
  notiere(punktName, false, e instanceof Fehl ? e.message : `ABORT: ${e.stack ?? String(e)}`);
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
  await ende();
});
