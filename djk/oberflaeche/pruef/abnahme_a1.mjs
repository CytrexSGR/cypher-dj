// Target acceptance, package 1.12 automation slice 1 (fader lane), against a TEST INSTANCE with the freshly built core (never the operation, never instance a, g, h or i):
//   DJK=<worktree>/djk CYPHERDJ_KATALOG=<aufbau.katalog> djk/start/djk-start --instanz e        (silent sink, no --ton-frei)
//   node pruef/a1_aufbau.mjs --ziel /dev/shm/a1-ziel --instanz e > /dev/shm/a1-ziel/aufbau.json
//   flock <CYPHERDJ_ECHTZEIT_SCHLOSS> node pruef/abnahme_a1.mjs --url http://127.0.0.1:52300 --aufbau /dev/shm/a1-ziel/aufbau.json --bau <kernel build folder> [--ausgabe <folder>]
// The material is a steady 440 Hz sine, so the level of the track is a pure function of the fader. Every level comes from the master recording of the core
// (cypherdj-mitschnitt, sample accurate), not from the 20 Hz track meter: its window of 50 ms and the server clock would blur a ramp of 3 dB per second by 0.15 dB.
// The amplitude of a window is a least-squares fit of a*sin + b*cos at 440 Hz (exact for a pure sine of any window length, see pruef/a1_messen.mjs).
//   Z1  lane 0 dB at beat 0 to -30 dB at beat 16 (120 BPM, project made through the Cypher path): level at beat 4, 8, 12, 16, 20 against the line within 0.1 dB, the
//       level drop at beat 20 proves that the binary knows the lane (version skew A1). Negative control: the same track without a lane stays within 0.05 dB.
//   Z2  loop 0..16 with that lane: level in the 10 ms after the wrap against lane(from) within 0.2 dB, no window before the wrap with a step above 0.5 dB.
//       Negative control: a lane that starts at -12 dB reads more than 1 dB away from the expectation of the 0 dB lane.
//   Z3  export (cypherdj-render of the playback file) against the master recording of the same range, null test: rest below -90 dBFS with a lane with a jump.
//       Negative control: the lane shifted by one sample in the render must not be below -90 dBFS.
//   Z4  stop in the middle of the lane. The plan asks for the level to reach the base value within 10 ms. With an audio clip the sound ends at the stop, so the
//       gain behind it cannot be observed at the output: reported as INFO (level before the stop against the line, silence after), not as a pass.
//   Z5  delete the lane while the clip plays: the gain goes from the line value to the base value; the end of the transition (last sample more than 0.1 dB away from the
//       base value) lies 10 ms +-2 ms after its start. Negative control: deleting a lane in the quiet (before the run) leaves the level at the base value.
//   Z6  the page server dies (SIGTERM) while the lane plays: the level keeps following the line within 0.1 dB over 4 s. Control: the same run with a living server.
//   Z7  proj_auto (bei.wert) against the level of the core at the same beat within 0.1 dB; beyond the last point the value holds (-30 dB, level equal).
// Return: 0 all OK, 1 at least one FEHL, 2 usage. Raw data go to rohdaten.json, listening samples to hoerproben/. Only the own project (slug a1-...) is removed.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_ziel.mjs';
import { schreibeWav } from './w1_wav.mjs';
import { SR, amplitude, amplitudeDb, verstaerkungsSpur, blendeBreite, einsatz, beatSample, linie, schrittMax } from './a1_messen.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_a1: usage: --url <test instance> --aufbau <aufbau.json> --bau <core build folder> [--ausgabe <folder>] [--instanz <a..f>]\n');
  process.exit(2);
}
const z = starte('abnahme_a1', 'a1', { bau: { type: 'string' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, instanz } = z;
if (!z.opt.bau) { process.stderr.write('abnahme_a1: --bau <core build folder> is required (cypherdj-mitschnitt, -render, -nulltest)\n'); process.exit(2); }
const BAU = path.resolve(z.opt.bau);
const BPM = 120, SCHLAG = 60 * SR / BPM;   // 24000 frames per beat
const roh = {};
const db = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const warte = z.warte;

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

// Waits until the core reports a project beat of at least `beat` (SSE /zustand/arr, field projekt_beat); the start of the playback is quantised and its delay varies
async function warteBeat(sse, beat, maxMs = 20000) {
  for (let t = 0; t < maxMs; t += 20) {
    const arr = [...sse.meldungen].reverse().find((x) => x.a === '/zustand/arr' && x.f?.status === 2);
    if (arr && Number(arr.f.projekt_beat) >= beat) return Number(arr.f.projekt_beat);
    await warte(20);
  }
  throw new Fehl(`the core did not reach project beat ${beat} within ${maxMs} ms`);
}

// Master recording of `sekunden`; `ablauf` runs 0.5 s after the recorder started (it starts the transport and may change the project while it plays).
// Returns the left channel as Float32Array and the SSE messages.
async function nimmAuf(name, sekunden, ablauf, { strom = false } = {}) {
  const dir = path.join(z.ORDNER, 'roh');
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, `${name}.f32`);
  const sse = strom ? stromLesen() : null;
  const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', datei]);
  await warte(500);
  const t0 = Date.now();
  let ablaufErgebnis;
  try { ablaufErgebnis = await ablauf(sse); } finally { /* the recording is awaited below either way */ }
  const m = await mit;
  if (sse) await sse.stop();
  const j = jsonZeile(m.out);
  if (m.rc !== 0 || !j) throw new Fehl(`cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}`);
  fs.writeFileSync(path.join(dir, `${name}.json`), m.out);
  const b = fs.readFileSync(datei);
  const st = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
  const l = new Float32Array(st.length >> 1);
  for (let i = 0; i < l.length; i++) l[i] = st[2 * i];
  return { l, st, mit: j, sse: sse?.meldungen ?? [], ablaufErgebnis, ablaufSeit: Date.now() - t0 };
}

const spielen = async (aktion) => { await transport('start', 0); if (aktion) await aktion(); };

// ---- project ----
let spurId = null, laneId = null;
const projekt = async () => (await aktuell()).projekt;
async function aufbauen() {
  await z.neuesProjekt('abnahme');
  await aendern('A1 tempo and track', [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'audio', name: 'A1' }], CYPHER);
  const p = await projekt();
  spurId = p.spuren[0].id;
  await aendern('A1 clip', [{ befehl: 'clip_neu', spur_id: spurId, art: 'audio', start_beat: 0, laenge_beats: 64, sha256: A.sha }], CYPHER);
  await z.geladen();
  await warte(3000);   // restart state of the core
}
const laneSetzen = async (label, punkte) => {
  if (laneId === null) {
    const r = await aendern(`${label} lane`, [{ befehl: 'auto_neu', spur_id: spurId, ziel: 'fader' }], CYPHER);
    laneId = (await projekt()).spuren[0].automation?.[0]?.id ?? null;
    if (!laneId) throw new Fehl(`auto_neu left no lane: ${JSON.stringify(r).slice(0, 200)}`);
  }
  await aendern(`${label} points`, [{ befehl: 'auto_punkte', lane_id: laneId, loesche_von: 0, loesche_bis: 100000, setze: punkte }], CYPHER);
  await z.geladen();
  await warte(1200);
};
const LINIE = [{ beat: 0, wert: 0 }, { beat: 16, wert: -30 }];
const erwartet = (beat, punkte = LINIE) => linie(punkte, beat);
const R = { ref: null };   // reference amplitude of the unattenuated track, from the control

async function lauf() {
  const bpm = (await z.ruf('GET', '/lage')).j?.uhr?.bpm;
  info(`instance ${instanz}, ${z.URL}, core ${bpm} BPM, build folder ${BAU}`);
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);   // an earlier run may have left the transport running
  await warte(1500);
  await aufbauen();
  const lo = path.join(z.ORDNER, 'hoerproben');
  fs.mkdirSync(lo, { recursive: true });

  // ---- control without a lane (Z1 negative control, and the reference amplitude) ----
  punkt('Z1 negative control');
  const kontrolle = await nimmAuf('z1-kontrolle', 17, () => spielen());
  await transport('stopp');
  const kEin = einsatz(kontrolle.l);
  const kAmp = [2, 4, 6, 8, 10].map((b) => amplitude(kontrolle.l, kEin + beatSample(b, SCHLAG), 1200));
  R.ref = kAmp.reduce((s, x) => s + x, 0) / kAmp.length;
  const kAbw = Math.max(...kAmp.map((a) => Math.abs(20 * Math.log10(a / R.ref))));
  roh.z1_kontrolle = { einsatz: kEin, amplituden: kAmp, ref: R.ref, abweichung_db: kAbw };
  notiere('Z1/NK no lane: constant', kAbw <= 0.05 && R.ref > 0.05, `reference amplitude ${R.ref.toFixed(4)}, largest deviation over beats 2, 4, 6, 8, 10 ${db(kAbw)} dB (limit 0.05), onset at frame ${kEin}`);

  // ---- Z2 control: the same loop 0..16 without a lane. The loop seam of the clip itself (restart of the source) has its own signature in the first milliseconds;
  // Z2 judges the lane against this control, so a seam artifact of the clip is not charged to the lane (and is reported).
  punkt('Z2 control');
  await aendern('A1 Z2 control loop', [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }], CYPHER);
  await z.geladen(); await warte(1200);
  const z2k = await nimmAuf('z2-kontrolle', 17, () => spielen());
  await transport('stopp');
  const e2k = einsatz(z2k.l), wrapK = e2k + beatSample(16, SCHLAG);
  const nachK = amplitudeDb(z2k.l, wrapK + 240, 480, R.ref), nachK2 = amplitudeDb(z2k.l, wrapK + 720, 480, R.ref), vorK = amplitudeDb(z2k.l, wrapK - 240, 480, R.ref);
  roh.z2_kontrolle = { wrap_frame: wrapK, vor_db: vorK, nach_db: nachK, nach_zweites_fenster_db: nachK2 };
  info(`Z2 control (no lane, loop 0..16): 10 ms before the wrap ${db(vorK)} dB, 10 ms after ${db(nachK)} dB, next 10 ms ${db(nachK2)} dB (the clip's own seam signature)`);
  schreibeWav(path.join(lo, 'schleifen-naht-ohne-lane.wav'), z2k.st);
  await aendern('A1 Z2 control loop off', [{ befehl: 'loop_setzen', an: false, von_beat: 0, bis_beat: 16 }], CYPHER);

  // ---- Z1 + Z7 ----
  await laneSetzen('A1 Z1', LINIE);
  punkt('Z1');
  const z1 = await nimmAuf('z1', 17, () => spielen());
  await transport('stopp');
  const e1 = einsatz(z1.l);
  const beats = [4, 8, 12, 16, 20];
  const gemessen = beats.map((b) => amplitudeDb(z1.l, e1 + beatSample(b, SCHLAG), 1200, R.ref));
  const abw = gemessen.map((g, i) => g - erwartet(beats[i]));
  roh.z1 = { einsatz: e1, beats, gemessen_db: gemessen, erwartet_db: beats.map((b) => erwartet(b)), abweichung_db: abw };
  notiere('Z1 level on the line', abw.every((x) => Math.abs(x) <= 0.1), beats.map((b, i) => `beat ${b}: ${db(gemessen[i])} dB (line ${db(erwartet(b))}, dev ${db(abw[i])})`).join('; ') + '; limit 0.1 dB');
  notiere('Z1 the binary knows the lane', gemessen[4] < -25 && gemessen[0] > -9, `beat 4 ${db(gemessen[0])} dB, beat 20 ${db(gemessen[4])} dB (a core without lane would stay at 0 dB; control stayed within ${db(kAbw)} dB)`);

  // Z7: proj_auto bei.wert against the core level at the same beat
  punkt('Z7');
  const z7 = [];
  for (const b of [2, 6, 10, 14, 20, 24]) {
    const r = z.erwarte200('/proj/auto', await z.ruf('GET', `/proj/auto?lane_id=${laneId}&bei_beat=${b}`));
    const bei = r.j?.bei ?? r.j?.lanes?.[0]?.bei;
    z7.push({ beat: b, antwort: bei });
  }
  roh.z7 = z7;
  const z7ok = z7.every((e) => typeof (e.antwort?.wert) === 'number');
  if (!z7ok) notiere('Z7 proj_auto answer', false, `no bei.wert in the answer: ${JSON.stringify(z7[0]).slice(0, 300)}`);
  else {
    const mess = z7.map((e) => amplitudeDb(z1.l, e1 + beatSample(e.beat, SCHLAG), 1200, R.ref));
    const d7 = z7.map((e, i) => mess[i] - e.antwort.wert);
    roh.z7_abweichung = d7;
    notiere('Z7 proj_auto against the core level', d7.every((x) => Math.abs(x) <= 0.1), z7.map((e, i) => `beat ${e.beat}: bei.wert ${db(e.antwort.wert)}, core ${db(mess[i])}`).join('; ') + '; limit 0.1 dB');
    const aus = z7.filter((e) => e.beat >= 16);
    notiere('Z7/NK beyond the last point', aus.every((e) => Math.abs(e.antwort.wert - -30) <= 1e-9) && aus.every((e, i) => Math.abs(mess[z7.indexOf(e)] - -30) <= 0.1), aus.map((e) => `beat ${e.beat}: ${db(e.antwort.wert)}`).join('; ') + ' (the last point holds: -30 dB, core level equal within 0.1)');
  }

  // ---- Z2 loop seam ----
  punkt('Z2');
  await aendern('A1 Z2 loop', [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }], CYPHER);
  await z.geladen(); await warte(1200);
  const z2 = await nimmAuf('z2', 17, () => spielen());
  await transport('stopp');
  const e2 = einsatz(z2.l), wrap = e2 + beatSample(16, SCHLAG);
  const nach = amplitudeDb(z2.l, wrap + 240, 480, R.ref), nach2 = amplitudeDb(z2.l, wrap + 720, 480, R.ref);
  const sprung = schrittMax(z2.l, e2 + beatSample(1, SCHLAG), wrap, 480, R.ref);
  roh.z2 = { einsatz: e2, wrap_frame: wrap, nach_db: nach, nach_zweites_fenster_db: nach2, groesster_schritt_vor_wrap_db: sprung };
  notiere('Z2 seam: level after the wrap = lane(from)', Math.abs(nach - nachK - erwartet(0)) <= 0.2, `10 ms after the wrap ${db(nach)} dB, control without lane ${db(nachK)} dB, lane(from) ${db(erwartet(0))} dB: difference ${db(nach - nachK - erwartet(0))} (limit 0.2); the next 10 ms ${db(nach2)} dB against ${db(nachK2)} in the control`);
  notiere('Z2 seam: no step before the wrap', sprung <= 0.5, `largest step between neighbouring 10 ms windows from beat 1 to the wrap ${db(sprung)} dB (limit 0.5)`);
  schreibeWav(path.join(lo, 'schleifen-naht-0-bis--30.wav'), z2.st);
  // negative control: lane starts at -12 dB
  await laneSetzen('A1 Z2 NK', [{ beat: 0, wert: -12 }, { beat: 16, wert: -30 }]);
  const z2n = await nimmAuf('z2-nk', 17, () => spielen());
  await transport('stopp');
  const e2n = einsatz(z2n.l), wrapN = e2n + beatSample(16, SCHLAG);
  const nachN = amplitudeDb(z2n.l, wrapN + 240, 480, R.ref);
  roh.z2_nk = { nach_db: nachN };
  notiere('Z2/NK a lane that starts at -12 dB is visible', Math.abs(nachN - nachK - erwartet(0)) > 1, `10 ms after the wrap ${db(nachN)} dB against the 0 dB expectation (control ${db(nachK)}): ${db(Math.abs(nachN - nachK - erwartet(0)))} dB apart (must be above 1)`);
  schreibeWav(path.join(lo, 'schleifen-naht--12-bis--30.wav'), z2n.st);
  // diagnosis of a Z2 deviation (INFO, no verdict): constant lanes, so that the wrap carries no gain step. 0 dB must read like the control, -30 dB like the control minus 30 dB.
  const diag = {};
  for (const [name, w] of [['konstant-0', 0], ['konstant-30', -30]]) {
    await laneSetzen(`A1 Z2 diag ${name}`, [{ beat: 0, wert: w }, { beat: 16, wert: w }]);
    const d = await nimmAuf(`z2-diag-${name}`, 17, () => spielen());
    await transport('stopp');
    const ed = einsatz(d.l), wd = ed + beatSample(16, SCHLAG);
    diag[name] = { vor: amplitudeDb(d.l, wd - 240, 480, R.ref), nach: amplitudeDb(d.l, wd + 240, 480, R.ref), nach2: amplitudeDb(d.l, wd + 720, 480, R.ref) };
    info(`Z2 diagnosis, constant lane ${w} dB: 10 ms before the wrap ${db(diag[name].vor)}, after ${db(diag[name].nach)}, next ${db(diag[name].nach2)} dB (control without lane: ${db(vorK)}, ${db(nachK)}, ${db(nachK2)})`);
  }
  // the same level without any lane: base value -30 dB (the non-lane path) with the loop on
  await aendern('A1 Z2 diag delete lane', [{ befehl: 'auto_loeschen', lane_id: laneId }], CYPHER);
  laneId = null;
  await aendern('A1 Z2 diag base -30', [{ befehl: 'spur_aendern', spur_id: spurId, fader_db: -30 }], CYPHER);
  await z.geladen(); await warte(1200);
  const dg = await nimmAuf('z2-diag-grund-30', 17, () => spielen());
  await transport('stopp');
  const edg = einsatz(dg.l), wdg = edg + beatSample(16, SCHLAG);
  diag.grund30 = { vor: amplitudeDb(dg.l, wdg - 240, 480, R.ref), nach: amplitudeDb(dg.l, wdg + 240, 480, R.ref), nach2: amplitudeDb(dg.l, wdg + 720, 480, R.ref) };
  info(`Z2 diagnosis, base value -30 dB, no lane: 10 ms before the wrap ${db(diag.grund30.vor)}, after ${db(diag.grund30.nach)}, next ${db(diag.grund30.nach2)} dB`);
  await aendern('A1 Z2 diag base 0', [{ befehl: 'spur_aendern', spur_id: spurId, fader_db: 0 }], CYPHER);
  roh.z2_diagnose = diag;
  await aendern('A1 Z2 loop off', [{ befehl: 'loop_setzen', an: false, von_beat: 0, bis_beat: 16 }], CYPHER);

  // ---- Z3 null test: export against recording, lane with a jump ----
  await z3();

  // ---- Z4 stop in the middle ----
  await laneSetzen('A1 Z4', LINIE);
  punkt('Z4');
  const z4 = await nimmAuf('z4', 12, async (sse) => { await transport('start', 0); await warteBeat(sse, 4); await transport('stopp'); }, { strom: true });
  const e4 = einsatz(z4.l);
  const letzte = letzterTon(z4.l, R.ref);
  const amStopp = amplitudeDb(z4.l, letzte - 600, 1200, R.ref);
  const beatStopp = (letzte - e4) / SCHLAG;
  const stille = z4.l.slice(letzte + 960, letzte + 9600).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  roh.z4 = { einsatz: e4, letzter_ton_frame: letzte, stopp_beat: beatStopp, pegel_vor_stopp_db: amStopp, linie_db: erwartet(beatStopp - 0.025), spitze_nach_20ms: stille };
  info(`Z4 INFO: stop at beat ${beatStopp.toFixed(3)}, level in the last 25 ms ${db(amStopp)} dB (line ${db(erwartet(beatStopp - 0.025))}); peak 20..200 ms after the last sound ${stille.toExponential(2)}. `
    + 'The plan asks for the gain to reach the base value within 10 ms; with an audio clip the sound ends at the stop and the gain behind it is not observable at the output. NOT passed or failed here, see the report.');

  // ---- Z5 delete the lane in the run ----
  await z5();

  // ---- Z6 the page server dies ----
  await z6();

  roh.R = R;
}

// last frame with a sound above 5 % of the reference amplitude
function letzterTon(l, ref) { for (let i = l.length - 1; i >= 0; i--) if (Math.abs(l[i]) > 0.05 * ref) return i; return -1; }
let punktName = 'setup';
function punkt(n) { punktName = n; }

async function z3() {
  punkt('Z3');
  // the jump lies 27 frames after beat 8: a quarter period (109.09 frames) of the 440 Hz sine, so the sine is near its crest and a one-sample error shows (on the beat the sine crosses zero)
  const SPR = 8 + 27 / SCHLAG;
  const SPRUNG = [{ beat: 0, wert: 0 }, { beat: SPR, wert: -12 }, { beat: SPR, wert: -3 }, { beat: 16, wert: -20 }];
  await laneSetzen('A1 Z3', SPRUNG);
  const dir = path.join(z.ORDNER, 'z3');
  fs.mkdirSync(path.join(dir, 'w'), { recursive: true });
  const nr = (await aktuell()).projekt.wiedergabe_rev;
  const vb = await prog(path.join(BAU, 'cypherdj-nulltest'), ['--vorbedingung', '--bpm', String(BPM)]);
  fs.writeFileSync(path.join(dir, 'vorbedingung.json'), `${vb.out}${vb.err}rc=${vb.rc}\n`);
  if (vb.rc !== 0 || jsonZeile(vb.out)?.vorbedingung !== 'erfuellt') { notiere('Z3 precondition', false, `null test precondition not met (rc ${vb.rc}): ${letzteZeile(vb.out) || letzteZeile(vb.err)}`); return; }
  const live = await nimmAuf('z3-live', 17, () => spielen(), { strom: true });
  await transport('stopp');
  const ein = live.sse.find((x) => x.a === '/zustand/arr' && x.f?.status === 2);
  if (!ein) { notiere('Z3 live recording', false, 'no /zustand/arr with status 2 in the stream (ursprung_sample unknown)'); return; }
  const ursprung = ein.f.ursprung_sample;
  const render = async (name, nrx) => {
    const r = await prog(path.join(BAU, 'cypherdj-render'), ['--nr', String(nrx), '--von-beat', '0', '--bis-beat', '16', '--bpm', String(BPM), '--aus', path.join(dir, 'w', `${name}.wav`), '--abgriff', 'set']);
    fs.writeFileSync(path.join(dir, 'w', `${name}.json`), `${r.out}${r.err}rc=${r.rc}\n`);
    return { rc: r.rc, j: jsonZeile(r.out), err: r.err.trim() };
  };
  const vergleich = async (name, wav, rj) => {
    const r = await prog(path.join(BAU, 'cypherdj-nulltest'), ['--live', path.join(z.ORDNER, 'roh', 'z3-live.f32'), '--live-s0', String(live.mit.s0), '--grenze', String(live.mit.grenze), '--ursprung', String(ursprung),
      '--render', wav, '--start-sample', String(rj.start_sample), '--frames', String(rj.frames), '--vorhalt', String(rj.vorhalt), '--quantum', String(rj.quantum)]);
    fs.writeFileSync(path.join(dir, `nulltest-${name}.json`), `${r.out}${r.err}rc=${r.rc}\n`);
    return { rc: r.rc, j: jsonZeile(r.out), err: r.err.trim() };
  };
  const rend = await render('lane', nr);
  if (rend.rc !== 0 || !rend.j) { notiere('Z3 render', false, `cypherdj-render rc ${rend.rc} ${rend.err}`); return; }
  const v = await vergleich('lane', path.join(dir, 'w', 'lane.wav'), rend.j);
  roh.z3 = { nr, ursprung, render: rend.j, nulltest: v.j, rc: v.rc };
  notiere('Z3 export = playing (lane with a jump)', v.j?.urteil === 'bestanden' && v.j.rest_db < -90,
    `${v.j?.urteil ?? 'no verdict'}${v.j?.ursache ? `/${v.j.ursache}` : ''} rest ${db(v.j?.rest_db)} dBFS (limit -90), signal ${db(v.j?.signal_db)} dBFS, shifted by 1 sample ${db(v.j?.verschoben_db)} dBFS, rc ${v.rc} ${v.err}`);
  // negative control: the jump one sample late (1/24000 beat at 120 BPM) in a new playback file, rendered against the same recording
  await laneSetzen('A1 Z3 NK', SPRUNG.map((q) => ({ beat: q.beat + 1 / SCHLAG, wert: q.wert })));
  const nr2 = (await aktuell()).projekt.wiedergabe_rev;
  const rend2 = await render('lane-versetzt', nr2);
  if (rend2.rc !== 0 || !rend2.j) { notiere('Z3/NK render', false, `cypherdj-render rc ${rend2.rc} ${rend2.err}`); return; }
  const v2 = await vergleich('lane-versetzt', path.join(dir, 'w', 'lane-versetzt.wav'), rend2.j);
  roh.z3_nk = { nr: nr2, nulltest: v2.j, rc: v2.rc };
  notiere('Z3/NK the lane shifted by one sample turns the null test red', v2.j?.urteil === 'rot' || (typeof v2.j?.rest_db === 'number' && v2.j.rest_db >= -90),
    `${v2.j?.urteil ?? 'no verdict'}${v2.j?.ursache ? `/${v2.j.ursache}` : ''} rest ${db(v2.j?.rest_db)} dBFS (must not be below -90), rc ${v2.rc}`);
}

async function z5() {
  punkt('Z5');
  await laneSetzen('A1 Z5', LINIE);
  const z5 = await nimmAuf('z5', 17, async (sse) => {
    await transport('start', 0);
    await warteBeat(sse, 6);
    const r = await z.aendernRoh('A1 Z5 delete the lane', [{ befehl: 'auto_loeschen', lane_id: laneId }], CYPHER);
    if (r.code !== 200) throw new Fehl(`auto_loeschen → ${z.grundVon(r)}`);
  }, { strom: true });
  await transport('stopp');
  laneId = null;
  const e = einsatz(z5.l);
  // gain trace in steps of 48 frames (1 ms), windows of one period (109 frames). The blend length is the width of a straight line fitted to the 20 % to 80 % part of the
  // transition (a1_messen.blendeBreite): the window smear is symmetric around the middle, so the width stays right where first/last point thresholds would be too wide.
  const spur = verstaerkungsSpur(z5.l, e, z5.l.length - 2400, 48, 109, R.ref);
  const basis = 0;
  let i0 = -1;
  for (let i = 1; i < spur.length; i++) {
    const beatI = (spur[i].frame - e) / SCHLAG;
    if (beatI > 4 && spur[i].db - erwartet(beatI) > 0.3) { i0 = i; break; }
  }
  const endwerte = spur.slice(-20).map((s) => s.lin).sort((x, y) => x - y), g1 = endwerte[10];
  const g0 = i0 >= 6 ? spur[i0 - 6].lin : NaN;
  const br = i0 >= 6 ? blendeBreite(spur.slice(i0 - 6, i0 + 40), g0, g1) : null;
  const dauerMs = br ? br.frames / SR * 1000 : NaN;
  roh.z5 = { einsatz: e, erster_abweichender_punkt_frame: i0 >= 0 ? spur[i0].frame : null, g0_lin: g0, g1_lin: g1, breite_frames: br?.frames ?? null, mitte_frame: br?.mitte ?? null, dauer_ms: dauerMs, pegel_ende_db: spur[spur.length - 1].db, loesch_beat: br ? (br.mitte - e) / SCHLAG : null };
  notiere('Z5 lane deleted in the run: gain back at the base value', Math.abs(spur[spur.length - 1].db - basis) <= 0.1 && Math.abs(20 * Math.log10(g1) - basis) <= 0.1,
    `last point ${db(spur[spur.length - 1].db)} dB, median of the last 20 ${db(20 * Math.log10(g1))} dB against the base value ${basis} dB (limit 0.1); the lane was deleted at about beat ${br ? ((br.mitte - e) / SCHLAG).toFixed(2) : '?'}`);
  notiere('Z5 transition time', Math.abs(dauerMs - 10) <= 2, `fitted width of the gain transition ${db(dauerMs)} ms from ${db(20 * Math.log10(g0))} dB to ${db(20 * Math.log10(g1))} dB (expected 10 ms +-2: 480 frames; the 109-frame window stretches it by about 2 %, calibrated in tests/pruef_a1_messen.test.mjs)`);
  // negative control: delete in the quiet (not playing), then the level stays at the base value
  await laneSetzen('A1 Z5 NK', LINIE);
  await aendern('A1 Z5 NK delete', [{ befehl: 'auto_loeschen', lane_id: laneId }], CYPHER);
  laneId = null;
  await z.geladen(); await warte(1200);
  const nk = await nimmAuf('z5-nk', 12, () => spielen());
  await transport('stopp');
  const en = einsatz(nk.l);
  const am = [2, 4, 6].map((b) => amplitudeDb(nk.l, en + beatSample(b, SCHLAG), 1200, R.ref));
  notiere('Z5/NK deleting a lane that is not playing leaves the level', am.every((x) => Math.abs(x - basis) <= 0.05), `beats 2, 4, 6: ${am.map(db).join(', ')} dB (limit 0.05 around the base value)`);
}

async function z6() {
  punkt('Z6');
  await laneSetzen('A1 Z6', LINIE);
  const messen = async (name, tot) => {
    const r = await nimmAuf(name, 17, async (sse) => {
      await transport('start', 0);
      await warteBeat(sse, 3);
      if (tot) await prog('/usr/bin/systemctl', ['--user', 'stop', `cypherdj-oberflaeche-${instanz}.service`]);   // stop = SIGTERM to the server, and systemd does not start it again
    }, { strom: true });
    const e = einsatz(r.l);
    const bs = [4, 5, 6, 7, 8, 9, 10, 11, 12];   // 2 s to 6 s after the start; the server is killed at about beat 3 (1.5 s)
    const g = bs.map((b) => amplitudeDb(r.l, e + beatSample(b, SCHLAG), 1200, R.ref));
    return { e, bs, g, abw: g.map((x, i) => x - erwartet(bs[i])), st: r.st };
  };
  const lebend = await messen('z6-kontrolle', false);
  await transport('stopp');
  await warte(1500);
  const tot = await messen('z6', true);
  roh.z6 = { kontrolle: { g: lebend.g, abw: lebend.abw }, ohne_server: { g: tot.g, abw: tot.abw } };
  const serverWeg = (await z.ruf('GET', '/lage').catch(() => ({ code: 0 }))).code !== 200;   // measured after the recording: the server was down for the whole window
  // the page server unit is transient: `systemctl stop` removes it, so the instance has to be restarted (djk-stop, djk-start) for any further run; the core keeps playing until then
  notiere('Z6/NK living server: curve on the line', lebend.abw.every((x) => Math.abs(x) <= 0.1), `largest deviation ${db(Math.max(...lebend.abw.map(Math.abs)))} dB over beats 4..12 (limit 0.1)`);
  notiere('Z6 server dead: curve on the line', serverWeg && tot.abw.every((x) => Math.abs(x) <= 0.1),
    `server down after the recording: ${serverWeg}; largest deviation ${db(Math.max(...tot.abw.map(Math.abs)))} dB over beats 4..12 = 2 s..6 s after the start, the server was killed at about beat 3 = 1.5 s (limit 0.1)`);
}

async function ende() {
  // the server may be dead after Z6: nothing to delete over HTTP then; the project folder is removed directly (own slug only)
  await z.ende('Automation slice 1 target acceptance', /^a1-/);
}

lauf().then(() => { fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1)); return ende(); }).catch(async (e) => {
  notiere(punktName, false, e instanceof Fehl ? e.message : `ABORT: ${e.stack ?? String(e)}`);
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
  await ende();
});
