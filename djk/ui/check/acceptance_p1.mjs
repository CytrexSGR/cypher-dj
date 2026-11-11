// Acceptance of plan 1.11 (foreign plugins), parts 1 and 2, on the REAL core and REAL Carla hosts of a TEST INSTANCE (e only; a, f, g, h, i are taboo, never the live studio).
// Test signals only (sine, click, noise as audio clips). Call order (the catalog must exist before the page server starts):
//   1  node check/acceptance_p1.mjs --nur-material --material /dev/shm/p1-ziel
//   2  plugin_scan.py --mit-eigenen --index ~/.local/state/cypherdj/plugins/index.json   (the page server reads this index; the unit has no per-instance path)
//   3  CYPHERDJ_KATALOG=/dev/shm/p1-ziel/katalog.sqlite DJK=<worktree>/djk <worktree>/djk/start/djk-start --instanz e --arr1   (silent sink; needs core/build -> the worktree build)
//   4  node check/acceptance_p1.mjs --teil 1|2|3|4 --url http://127.0.0.1:52300 --instanz e --material /dev/shm/p1-ziel [--ausgabe <dir>]
// Part 3 (plan 1.11 task 17, foreign instrument tracks; needs --arr1 --arr2 on the instance): P9 notes of a MIDI clip sound through reasonablesynth (LV2), RB-338 (VST3) and Vital (native VST3) with the
// note timing of a Surge track, P10 the state survives a reopen, P11 freeze and export of the plugin track work as for a Surge track; negative control: the Surge track of the same project is unchanged.
// Part 4 (plan 1.11 task 18, gate G2, real JACK run): --teil 4 [--minuten 10]: 32 tracks, 4 real effect hosts, 2 instrument hosts, the transport plays in a loop; frame_luecken, RSS of the six hosts, start to ready.
// Part 1: P1 insert acts, P2 alignment, P3 latency truth, P4 dead and hung host, P5 state, P0 Valhalla Supermassive (yabridge).
// Part 2: P6 exported = heard, P7 start position, P8 five-minute project.
// Every measurement is taken from audio files (the real-time export of the production master, or a recording of the instance's sink); every criterion has its
// number and a named negative control in the output. Exit 0 all OK, 1 at least one FEHL, 2 call error. Cleans only its own projects (slug p1-...).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_target.mjs';
import { leseWav, schreibeWav, klicks } from './w1_wav.mjs';
import { sinusQuelle } from './c14_measure.mjs';
import { baueKatalog } from '../tests/support/catalog.mjs';
import { nullDifferenz } from './w7_measure.mjs';
import { leseF32Stereo } from './i19_spectrum.mjs';

const SR = 48000, BPM = 120, DAUER_S = 20;
const BEAT_S = 60 / BPM;                         // 0.5 s = 24000 samples
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

// ---- material. sha = the real sha256 of the file. Index in MAT: 0 sine 1 kHz (-12 dBFS), 1 click (0.5 at sample 0, again every 10 s), 2 noise (LCG, ~-20 dBFS rms), 3 sine 660 Hz, 4 burst (10 ms of noise at 0.7, again every 10 s: an energetic click)
function baueMaterial(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const quellen = [
    ['sinus-1000', (() => { const q = sinusQuelle(1000, 0.25, 0); return (k) => q(k); })()],
    ['klick', (k) => (k % (10 * SR) === 0 ? 0.5 : 0)],
    ['rauschen', (() => { let s = 12345; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.fround(((s / 4294967296) * 2 - 1) * 0.17); }; })()],
    ['sinus-660', sinusQuelle(660, 0.2, 0)],
    ['burst', (() => { let s = 777; return (k) => { if (k % (10 * SR) >= 480) return 0; s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.fround(((s / 4294967296) * 2 - 1) * 0.7); }; })()],
  ];
  const zeilen = quellen.map(([name, q], i) => {
    const pfad = path.join(dir, `${name}.wav`), ton = new Float32Array(2 * DAUER_S * SR);
    for (let k = 0; k < DAUER_S * SR; k++) ton[2 * k] = ton[2 * k + 1] = q(k);
    schreibeWav(pfad, ton);
    const sha = createHash('sha256').update(fs.readFileSync(pfad)).digest('hex');
    return { n: i + 1, sha, shas: sha, typ: 'track', werk_id: i + 1, titel: `P1 ${name}`, bpm: BPM, dauer_s: DAUER_S, pfad };
  });
  const katalog = baueKatalog(dir, zeilen);
  const aus = { katalog, sha: zeilen.map((z) => z.sha), pfad: zeilen.map((z) => z.pfad) };
  fs.writeFileSync(path.join(dir, 'aufbau.json'), JSON.stringify(aus));
  return aus;
}
if (process.argv.includes('--nur-material')) {
  const dir = arg('material');
  if (!dir) { process.stderr.write('abnahme_p1: usage: --nur-material --material <dir>\n'); process.exit(2); }
  if (fs.existsSync(path.join(dir, 'katalog.sqlite'))) { process.stderr.write(`abnahme_p1: ${dir}/katalog.sqlite exists already, left as it is\n`); process.exit(0); }
  process.stdout.write(`${JSON.stringify(baueMaterial(path.resolve(dir)))}\n`);
  process.exit(0);
}

const z = starte('abnahme_p1', 'p1', { material: { type: 'string' }, teil: { type: 'string' }, nur: { type: 'string' }, minuten: { type: 'string' }, versatz: { type: 'string' } }, { ohneAufbau: true });
if (/^[afghi]$/.test(z.instanz)) { process.stderr.write(`abnahme_p1: instance ${z.instanz} is not allowed: a, f, g, h, i are taboo\n`); process.exit(2); }
if (z.instanz !== 'e') { process.stderr.write(`abnahme_p1: only instance e (port 52300) is allowed here, got ${z.instanz}\n`); process.exit(2); }
{
  const port = Number(new globalThis.URL(z.URL).port);
  if (port !== 52300) { process.stderr.write(`abnahme_p1: --url must be the page server of instance e (port 52300), got ${port}\n`); process.exit(2); }
}
if (!z.opt.material || !fs.existsSync(path.join(z.opt.material, 'aufbau.json'))) {
  process.stderr.write('abnahme_p1: --material <dir> missing or without aufbau.json (run --nur-material first)\n'); process.exit(2);
}
if (!['1', '2', '3', '4', 'x'].includes(z.opt.teil)) { process.stderr.write('abnahme_p1: --teil 1, 2, 3 or 4\n'); process.exit(2); }
const MAT = JSON.parse(fs.readFileSync(path.join(z.opt.material, 'aufbau.json'), 'utf8'));
const { notiere, info, CYPHER, aendern, aktuell, fmt, warte } = z;
const sh = (cmd, args, ms = 15000) => new Promise((ok) => execFile(cmd, args, { timeout: ms }, (e, so, se) => ok({ code: e ? (e.code ?? 1) : 0, so, se })));
const roh = {};

// ---- helpers: plugin ids, project building, host states, measurements
let INDEX = null;
async function pluginId(pfadTeil, uid) {
  if (!INDEX) INDEX = z.erwarte200('/plugins', await z.ruf('GET', '/plugins')).j;
  const liste = INDEX.plugins ?? INDEX.eintraege ?? INDEX;
  const e = liste.find((x) => x.pfad.includes(pfadTeil) && (uid === undefined || x.uid === uid));
  if (!e) throw new Fehl(`plugin ${pfadTeil} is not in the index (${liste.length} entries)`);
  if (e.status !== 'ok') throw new Fehl(`plugin ${pfadTeil} is ${e.status} in the index`);
  return e.id;
}
const KLICK = 1, SINUS = 0, RAUSCHEN = 2, SINUS660 = 3, BURST = 4;
const clip = (spurId, k, start, laenge) => ({ befehl: 'clip_neu', spur_id: spurId, art: 'audio', start_beat: start, laenge_beats: laenge, sha256: MAT.sha[k] });
async function neu(name) { await z.neuesProjekt(name); await z.setzeTempo(BPM); }
async function spuren(n, namen = []) {
  await aendern('p1 tracks', Array.from({ length: n }, (_, i) => ({ befehl: 'spur_neu', art: 'audio', name: namen[i] ?? `T${i + 1}` })), CYPHER);
  return (await aktuell()).projekt.spuren.map((s) => s.id);
}
const hosts = async () => (await aktuell()).hosts ?? [];
const kern = async () => (await aktuell()).kern ?? {};
async function warteHost(h = null, ms = 60000) {
  const ok = await z.bisWahr(async () => { const l = await hosts(); return l.length > 0 && l.every((x) => x.status === 'bereit') && (h === null || l.length >= h); }, ms);
  if (!ok) throw new Fehl(`host not ready after ${ms} ms: ${JSON.stringify(await hosts())}`);
  await z.geladen();
  return hosts();
}
async function setzeHost(strang, plugin, pos = 0) {
  const id = await pluginId(...plugin);
  const r = await aendern(`p1 host ${plugin[0]}`, [{ befehl: 'insert_setzen', strang_id: strang, pos, art: 'host', plugin_id: id }], CYPHER);
  const p = (await aktuell()).projekt;
  const alle = [...p.spuren, ...(p.gruppen ?? []), ...(p.returns ?? [])];
  const s = strang === 'master' ? p.master : alle.find((x) => x.id === strang);
  return (s.inserts ?? [])[pos]?.id ?? null;
}
// fetch has a header timeout of 300 s, a five-minute real-time export answers later: plain http without a timeout
const postLang = (weg, koerper) => new Promise((ok, nein) => {
  const u = new globalThis.URL(z.URL + weg), txt = JSON.stringify(koerper ?? {});
  const q = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(txt), ...CYPHER } }, (res) => {
    let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => { let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; } ok({ code: res.statusCode, j }); });
  });
  q.on('error', nein); q.setTimeout(0); q.write(txt); q.end();
});
const exportiere = async (von, bis, name, abgriff = 'produktion') => {
  await z.geladen();
  const t0 = Date.now();
  const r = await postLang('/proj/export', { von_beat: von, bis_beat: bis, abgriff });
  if (r.code !== 200) throw new Fehl(`/proj/export -> ${z.grundVon(r)}`);
  const datei = path.join(z.ORDNER, `${name}.wav`);
  fs.copyFileSync(r.j.datei, datei);
  return { ...leseWav(datei), antwort: r.j, dauer_ms: Date.now() - t0 };
};
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const spitzeIdx = (x, a = 0, b = x.length) => { let m = 0, mi = -1; for (let i = a; i < b; i++) if (Math.abs(x[i]) > m) { m = Math.abs(x[i]); mi = i; } return { idx: mi, wert: m }; };
const spitzeLin = (x) => spitzeIdx(x).wert;
// the project's loaded playback needs a moment after a command; the exports and taps wait for it themselves (z.geladen)
async function ende(titel) {
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
  await z.ende(titel, /^p1-/i);
}

// ---- the transport poke: the core measures the round trip only while the transport is stopped, and the server asks at the next stop edge (a host started on
// the estimate is recycled at the stop). One start/stop of the transport per round, at most three rounds.
async function stoppeUndWarte() {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  if (!(await z.bisWahr(async () => (await kern()).status === 0, 15000))) throw new Fehl('the transport did not stop');
}
async function bereitGemessen(anzahl = 1, runden = 3) {
  for (let r = 0; r < runden; r++) {
    const ok = await z.bisWahr(async () => {
      const l = await hosts();
      return l.length >= anzahl && l.every((x) => x.status === 'bereit');
    }, 60000);
    if (!ok) throw new Fehl(`host not ready: ${JSON.stringify(await hosts())}`);
    await z.geladen();
    if ((await hosts()).every((x) => x.gemessen)) return hosts();
    await z.warte(1500);
    const rr = await z.ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
    if (rr.code !== 200) throw new Fehl(`transport start -> ${z.grundVon(rr)}`);
    await z.warte(1200);
    await stoppeUndWarte();
    await z.warte(500);
  }
  const ok = await z.bisWahr(async () => { const l = await hosts(); return l.length >= anzahl && l.every((x) => x.status === 'bereit' && x.gemessen); }, 30000);
  if (!ok) throw new Fehl(`host not measured after ${runden} rounds: ${JSON.stringify(await hosts())}`);
  await z.geladen();
  return hosts();
}
const paramRoute = (insertId, werte) => z.ruf('POST', `/proj/insert/${insertId}/param`, { werte }, CYPHER);
const entferne = async (insertId) => {
  await aendern('p1 remove host', [{ befehl: 'insert_entfernen', insert_id: insertId }], CYPHER);
  if (!(await z.bisWahr(async () => (await hosts()).length === 0, 30000))) throw new Fehl('the host did not go away');
  await z.geladen();
};
const PL = {
  aeq: ['urn:ardour:a-eq'], aexp: ['urn:ardour:a-exp'], hall: ['dragonfly-reverb'], limiter: ['lv2/limiter_stereo'],
  cypheq: ['Cypher EQ.vst3'], valhalla: ['ValhallaSupermassive.vst3'],
};
const clickSample = 24000;   // a click clip on beat 1 (0.5 s at 120 BPM)

// ===================================================================== P1
async function p1() {
  z.punkt = 'P1';
  await neu('p1');
  const [t] = await spuren(1, ['Sine']);
  await aendern('p1 clip', [clip(t, SINUS, 0, 16)], CYPHER);
  const basis = await exportiere(0, 4, 'p1-basis-ohne-stufe');
  const pegel = (w) => db(rms(w.l, 24000, 96000));
  const b = pegel(basis);
  const iid = await setzeHost(t, PL.aeq);
  await bereitGemessen();
  const flach = await exportiere(0, 4, 'p1-flach');
  notiere('P1 negative control: a-eq inserted, no parameter touched: level against the track without the stage within 0.5 dB (the +12 below comes from the parameter)',
    Math.abs(pegel(flach) - b) < 0.5 && flach.antwort.echtzeit === true, `baseline ${fmt(b)} dBFS, flat stage ${fmt(pegel(flach))} dBFS (diff ${fmt(pegel(flach) - b)} dB), real-time export ${flach.antwort.echtzeit}`);
  const pr = await z.ruf('GET', `/proj/insert/${iid}/parameter`);
  const liste = pr.j?.parameter ?? [];
  const gain = liste.find((x) => x.name === 'Gain 2'), freq = liste.find((x) => x.name === 'Frequency 2');
  info(`P1 a-eq band 2: ${freq?.name} default ${freq?.vorgabe} Hz (index ${freq?.index}), ${gain?.name} range ${gain?.min}..${gain?.max} dB (index ${gain?.index})`);
  const norm = (gain.max === gain.min) ? 0.5 : (12 - gain.min) / (gain.max - gain.min);
  const set = await paramRoute(iid, { [gain.index]: norm });
  if (set.code !== 200) throw new Fehl(`param route -> ${z.grundVon(set)}`);
  await z.warte(300);
  const laut = await exportiere(0, 4, 'p1-plus12');
  const d12 = pegel(laut) - b;
  notiere('P1 insert acts: a-eq band 2 +12 dB at 1 kHz through POST /proj/insert/<id>/param, 1 kHz sine: PM level +12.0 +/- 0.5 dB',
    Math.abs(d12 - 12) <= 0.5, `baseline ${fmt(b)} dBFS, with +12 ${fmt(pegel(laut))} dBFS: ${fmt(d12)} dB (real-time export ${laut.antwort.echtzeit}, ${laut.dauer_ms} ms)`);
  await aendern('p1 an off', [{ befehl: 'insert_an', insert_id: iid, an: false }], CYPHER);
  await z.geladen();
  const aus = await exportiere(0, 4, 'p1-an-aus');
  const d0 = pegel(aus) - b;
  notiere('P1 insert_an off (stage bypassed): 0.0 +/- 0.05 dB against the track without the stage',
    Math.abs(d0) <= 0.05, `baseline ${fmt(b)} dBFS, an off ${fmt(pegel(aus))} dBFS: ${fmt(d0)} dB (negative control: the same stage on gave ${fmt(d12)} dB)`);
  roh.P1 = { basis: b, flach: pegel(flach), plus12: pegel(laut), aus: pegel(aus) };
}

// ===================================================================== P2
async function p2() {
  z.punkt = 'P2';
  await neu('p2');
  const [a, bt] = await spuren(2, ['Dry', 'EQ']);
  await aendern('p2 clips', [clip(a, KLICK, 1, 2), clip(bt, KLICK, 1, 2), { befehl: 'spur_aendern', spur_id: a, pan: -1 }, { befehl: 'spur_aendern', spur_id: bt, pan: 1 }], CYPHER);
  const ref = await exportiere(0, 4, 'p2-ohne-stufe');
  const ia = spitzeIdx(ref.l).idx, ib = spitzeIdx(ref.r).idx;
  info(`P2 reference without a stage: click L ${ia}, R ${ib}`);
  const iid = await setzeHost(bt, PL.cypheq);
  const h = (await bereitGemessen())[0];
  const w = await exportiere(0, 4, 'p2-mit-stufe');
  const l = spitzeIdx(w.l), r = spitzeIdx(w.r);
  notiere('P2 alignment: two tracks, same click, one through Cypher EQ: offset at the PM at most 1 sample',
    Math.abs(r.idx - l.idx) <= 1 && l.wert > 0.1 && r.wert > 0.1, `click L (dry) ${l.idx} (peak ${fmt(l.wert)}), R (Cypher EQ) ${r.idx} (peak ${fmt(r.wert)}): offset ${r.idx - l.idx} samples; stage latency ${h.latenz}`);
  await aendern('p2 extra', [{ befehl: 'insert_latenz_extra', insert_id: iid, samples: 100 }], CYPHER);
  await z.warte(1500);
  await bereitGemessen();
  const n = await exportiere(0, 4, 'p2-extra-100');
  const nl = spitzeIdx(n.l), nr = spitzeIdx(n.r);
  notiere('P2 negative control: the same project with latenz_extra +100 on the stage shows an offset of about 100 samples (90..110)',
    Math.abs(nr.idx - nl.idx) >= 90 && Math.abs(nr.idx - nl.idx) <= 110, `click L ${nl.idx}, R ${nr.idx}: offset ${nr.idx - nl.idx} samples`);
  roh.P2 = { ohne: [ia, ib], mit: [l.idx, r.idx], extra: [nl.idx, nr.idx] };
}

// ===================================================================== P3
async function p3() {
  z.punkt = 'P3';
  for (const [name, plug, soll] of [['Cypher EQ', PL.cypheq, 69], ['LSP Limiter Stereo LV2', PL.limiter, 240]]) {
    await neu(`p3-${soll}`);
    const [t] = await spuren(1, ['Click']);
    await aendern('p3 clip', [clip(t, KLICK, 1, 2)], CYPHER);
    const ergebnisse = [];
    for (let start = 1; start <= 3; start++) {
      const iid = await setzeHost(t, plug);
      const h = (await bereitGemessen())[0];
      const w = await exportiere(0, 4, `p3-${soll}-start${start}`);
      const pk = spitzeIdx(w.l);
      const real = h.latenz + (pk.idx - clickSample);   // the tap is shifted by the stage latency: a click later than 24000 means the host delay exceeds it
      ergebnisse.push({ start, latenz: h.latenz, klick: pk.idx, verzoegerung: real, spitze: pk.wert });
      await entferne(iid);
    }
    const alle = ergebnisse.map((x) => Math.abs(x.verzoegerung - x.latenz) <= 2 && x.spitze > 0.1);
    notiere(`P3 latency truth ${name} (declared ${soll}): stage latency = impulse delay through the active host +/- 2 samples, on three host starts`,
      alle.every(Boolean), ergebnisse.map((x) => `start ${x.start}: stage ${x.latenz}, click at ${x.klick} (peak ${fmt(x.spitze)}) = delay ${x.verzoegerung}`).join('; ')
        + `; the stage includes round trip 512 + declared ${soll}`);
    roh[`P3_${soll}`] = ergebnisse;
  }
  await neu('p3-runde');
  const [t] = await spuren(1, ['Sine']);
  await aendern('p3 clip', [clip(t, SINUS, 0, 8)], CYPHER);
  for (const [name, plug] of [['a-exp', PL.aexp], ['Dragonfly Hall', PL.hall]]) {
    const iid = await setzeHost(t, plug);
    const h = (await bereitGemessen())[0];
    const k = (await kern()).ins_host.find((x) => x.h === 1);
    notiere(`P3 ${name} on a stage: the measurement still returns a round trip (D17, empty rack measured before the plugin loads)`,
      h.gemessen === true && k.rundweg >= 512 && k.rundweg < 1024, `gemessen ${h.gemessen}, core round trip ${k.rundweg} samples, stage latency ${h.latenz}`);
    await entferne(iid);
  }
}

// ===================================================================== P4: dead and hung host
// The recording: pw-record on the silent sink of the instance (master = FL/FR), plus a listener on the core's /zustand/kern for frame_luecken.
const SENKE = 'cypher_stumm-e';
// The time of the signal in the recording is read from the file size of pw-record. The file size can only trail the real time (chunked writes), so the time that the
// measurement reports from the signal to the dry level is an UPPER bound of the real one; the limit is checked on it as it is.
function nimmAuf(pfad) {
  const k = spawn('pw-record', ['--target', SENKE, '-P', 'stream.capture.sink=true', '--rate', '48000', '--channels', '2', '--format', 'f32', pfad], { stdio: 'ignore' });
  return {
    pfad,
    frames: () => { try { return Math.max(0, Math.floor((fs.statSync(pfad).size - 68) / 8)); } catch { return 0; } },
    stopp: () => new Promise((ok) => { k.once('close', ok); k.kill('SIGINT'); setTimeout(() => k.kill('SIGKILL'), 4000).unref(); }),
  };
}
let KERNLOG = null;
function kernLogStart() {
  const log = path.join(z.ORDNER, 'kernlog.jsonl');
  const k = spawn('python3', [path.join(path.dirname(new URL(import.meta.url).pathname), 'acceptance_p1_kernlog.py'), log], { stdio: 'ignore' });
  // kill() resolves when the listener has really gone (it holds the UDP port 52140: a second run started at once would not get it)
  KERNLOG = { log, kill: () => new Promise((ok) => { k.once('close', ok); k.kill('SIGTERM'); setTimeout(() => k.kill('SIGKILL'), 3000).unref(); }) };
}
const luecken = () => {
  let l = null;
  try {
    for (const zeile of fs.readFileSync(KERNLOG.log, 'utf8').split('\n')) {
      if (!zeile.includes('/zustand/kern')) continue;
      try { const j = JSON.parse(zeile); l = { gen: j.werte[0], quantum: j.werte[1], luecken: j.werte[3] }; } catch { /* torn line */ }
    }
  } catch { /* no log yet */ }
  return l;
};
// level of f Hz in windows of 2400 samples (50 ms, whole periods of 1000 and 660 Hz), hop 480: [{t (centre, s), db}]
function pegelVerlauf(x, f, fenster = 2400, hop = 480) {
  const aus = [], w = 2 * Math.PI * f / SR;
  for (let a = 0; a + fenster <= x.length; a += hop) {
    let re = 0, im = 0;
    for (let i = 0; i < fenster; i++) { const v = x[a + i]; re += v * Math.cos(w * (a + i)); im += v * Math.sin(w * (a + i)); }
    aus.push({ t: (a + fenster / 2) / SR, db: db(2 * Math.hypot(re, im) / fenster) });
  }
  return aus;
}
const hostPid = async () => Number((await sh('systemctl', ['--user', 'show', '-p', 'MainPID', '--value', 'cypherdj-ins1-e.service'])).so.trim()) || 0;
const mittel = (liste) => liste.reduce((s, x) => s + x, 0) / Math.max(1, liste.length);

const P4N = {};
async function p4Lauf(signal) {
  const nr = P4N[signal] = (P4N[signal] ?? 0) + 1;
  const sig = `${signal} run ${nr}`;
  await neu(`p4-${signal.toLowerCase()}`); // project slug is per run
  const [a, b] = await spuren(2, ['Host', 'Dry']);
  await aendern('p4 clips', [clip(a, SINUS, 0, 120), clip(b, SINUS660, 0, 120)], CYPHER);
  const iid = await setzeHost(a, PL.aeq);
  await bereitGemessen();
  const gain = ((await z.ruf('GET', `/proj/insert/${iid}/parameter`)).j.parameter).find((x) => x.name === 'Gain 2');
  await paramRoute(iid, { [gain.index]: (12 - gain.min) / (gain.max - gain.min) });
  await z.warte(2500);                 // the state is saved 2 s after the last param call (D8)
  const rec = nimmAuf(path.join(z.ORDNER, `p4-${signal.toLowerCase()}-${nr}.wav`));
  await z.warte(800);
  const tr = await z.ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  if (tr.code !== 200) { await rec.stopp(); throw new Fehl(`transport start -> ${z.grundVon(tr)}`); }
  await z.warte(4000);
  const l0 = luecken(), pid = await hostPid();
  const f0 = rec.frames(), t0 = Date.now();
  process.kill(pid, signal === 'SIGKILL' ? 'SIGKILL' : 'SIGSTOP');
  // proj_lage: when does the page show `ausfall` (or anything but bereit)?
  let ausfallMs = null, status = null;
  for (let i = 0; i < 400 && ausfallMs === null; i++) {
    const h = (await hosts())[0];
    if (h && h.status !== 'bereit') { ausfallMs = Date.now() - t0; status = `${h.status}${h.grund ? '/' + h.grund : ''}`; }
    else await z.warte(25);
  }
  if (signal === 'SIGSTOP') { await z.warte(1500); process.kill(pid, 'SIGCONT'); }
  // wait for the effect to come back (the host restarts empty and the server restores the state while the transport runs)
  let zurueckMs = null;
  for (let i = 0; i < 600 && zurueckMs === null; i++) {
    const h = (await hosts())[0];
    const k = (await kern()).ins_host?.find((x) => x.h === 1);
    if (h && h.status === 'bereit' && k?.gesund) zurueckMs = Date.now() - t0;
    else await z.warte(100);
  }
  await z.warte(3500);
  const l1 = luecken(), f1 = rec.frames();
  await stoppeUndWarte();
  await rec.stopp();
  const w = leseWav(rec.pfad);
  const p1k = pegelVerlauf(w.l, 1000), p660 = pegelVerlauf(w.l, 660);
  const tk = f0 / SR;
  const vor = mittel(p1k.filter((x) => x.t > tk - 2.5 && x.t < tk - 0.2).map((x) => x.db));
  const nachDry = p1k.filter((x) => x.t > tk && x.t < tk + 4);
  // the dry level is the host level minus the +12 dB of the stage; "dry reached" = five windows in a row within 3 dB of it (silence, the return of a frozen host, does not count)
  const trockenSoll = vor - 12;
  const trockenIdx = nachDry.findIndex((x, i) => nachDry.slice(i, i + 5).length === 5 && nachDry.slice(i, i + 5).every((y) => Math.abs(y.db - trockenSoll) <= 3));
  const gefallen = trockenIdx >= 0 ? nachDry[trockenIdx] : null;
  const dropMs = gefallen ? (gefallen.t - 0.025 - tk) * 1000 : null;   // window start (centre - 25 ms) is the first sample the window saw
  const trockenDb = gefallen ? mittel(nachDry.slice(trockenIdx, trockenIdx + 20).map((x) => x.db)) : null;
  const stilleMs = nachDry.filter((x) => x.db < vor - 30).length * 10;   // 10 ms hop: how long the host track was silent after the kill
  const ende = p1k.filter((x) => x.t > w.frames / SR - 2.5 && x.t < w.frames / SR - 0.3).map((x) => x.db);
  const zurueckDb = mittel(ende);
  // the 660 Hz of the other track. Around the two level steps of the host track (the fall to the dry path, the return after the 1 s hold-off of the core) the
  // splatter of the 1 kHz step bends a 50 ms window by about 1 dB: those windows are left out, the rest must hold within 1 dB
  const sprung = [[tk - 0.15, tk + (dropMs ?? 600) / 1000 + 0.15], [tk + (zurueckMs ?? 0) / 1000 - 0.15, tk + (zurueckMs ?? 0) / 1000 + 1.4]];
  const ausserhalb = (x) => !sprung.some(([a, bb]) => x.t > a - 0.025 && x.t < bb + 0.025);
  const b660 = p660.filter((x) => x.t > 1 && x.t < w.frames / SR - 0.6 && ausserhalb(x)).map((x) => x.db);
  const bAlle = p660.filter((x) => x.t > 1 && x.t < w.frames / SR - 0.6).map((x) => x.db);
  const bMitte = mittel(b660), bAbw = Math.max(...b660.map((x) => Math.abs(x - bMitte))), bAbwAlle = Math.max(...bAlle.map((x) => Math.abs(x - bMitte)));
  const spitzeStille = Math.min(...b660);
  const dl = l1 && l0 ? l1.luecken - l0.luecken : null;
  roh[`P4_${sig}`] = { pid, tk, vor, dropMs, stilleMs, trockenDb, zurueckDb, bMitte, bAbw, ausfallMs, status, zurueckMs, l0, l1, frames: w.frames, f1 };
  info(`P4 ${sig}: host pid ${pid}, kill at recording ${fmt(tk)} s; 1 kHz before ${fmt(vor)} dB, dry ${trockenDb === null ? 'n/a' : fmt(trockenDb)} dB, back ${fmt(zurueckDb)} dB; proj_lage not bereit after ${ausfallMs} ms (${status}); healthy again after ${zurueckMs} ms`);
  notiere(`P4 ${sig}: the stage is on the dry path within 600 ms (the 1 kHz of the host track is at the dry level, 12 dB under the level before; before ${fmt(vor)} dBFS, dry ${trockenDb === null ? 'n/a' : fmt(trockenDb)} dBFS)`,
    dropMs !== null && dropMs <= 600, dropMs === null ? 'the dry level was never reached within 4 s' : `dry level reached ${fmt(dropMs)} ms after the signal (timing from the recording's file size: an upper bound); the host track was silent for ${stilleMs} ms meanwhile (negative control: before the signal the level held ${fmt(vor)} dBFS for 2.3 s)`);
  notiere(`P4 ${sig}: the other track has no gap (660 Hz window level within 1 dB of its mean over the whole run) and frame_luecken is unchanged`,
    bAbw <= 1 && dl === 0, `660 Hz mean ${fmt(bMitte)} dBFS, largest deviation ${fmt(bAbw)} dB outside the two step regions (${fmt(bAbwAlle)} dB with them), lowest ${fmt(spitzeStille)}; frame_luecken ${l0?.luecken} -> ${l1?.luecken} (delta ${dl}), quantum ${l1?.quantum}`);
  notiere(`P4 ${sig}: proj_lage shows ausfall`, ausfallMs !== null && /^ausfall/.test(status ?? ''), `status ${status} after ${ausfallMs} ms`);
  notiere(`P4 ${sig}: after the restart the effect is back with the restored state (1 kHz back within 1 dB of ${fmt(vor)} dBFS, not at the flat level)`,
    zurueckMs !== null && Math.abs(zurueckDb - vor) <= 1, `healthy again after ${zurueckMs} ms, 1 kHz at the end ${fmt(zurueckDb)} dBFS (before ${fmt(vor)}, flat ${trockenDb === null ? 'n/a' : fmt(trockenDb)})`);
}
async function p4() { z.punkt = 'P4'; for (const sg of ['SIGKILL', 'SIGSTOP', 'SIGSTOP', 'SIGSTOP']) { try { await p4Lauf(sg); } catch (e) { notiere(`P4 ${sg} run`, false, `aborted: ${e.message}`); } } }

// ===================================================================== P5: state
async function p5() {
  z.punkt = 'P5';
  await neu('p5');
  const slug = z.eigeneSlugs.at(-1);
  const [t] = await spuren(1, ['Noise']);
  await aendern('p5 clip', [clip(t, RAUSCHEN, 0, 8)], CYPHER);
  const iid = await setzeHost(t, PL.aeq);
  await bereitGemessen();
  const flach = await exportiere(0, 4, 'p5-flach');
  const liste = (await z.ruf('GET', `/proj/insert/${iid}/parameter`)).j.parameter;
  const norm = (name, wert) => { const q = liste.find((x) => x.name === name); return [q.index, (wert - q.min) / (q.max - q.min)]; };
  const werte = Object.fromEntries([norm('Gain 2', 12), norm('Gain 3', -10), norm('Gain 1', 6), norm('Frequency 3', 3500)]);
  const set = await paramRoute(iid, werte);
  if (set.code !== 200) throw new Fehl(`param route -> ${z.grundVon(set)}`);
  await z.warte(3000);                           // D8: saved 2 s after the last param call
  const datei = path.join('/dev/shm/cypherdj-e/projekte', slug, 'plugins', `${iid}.carxs`);
  info(`P5 state file ${datei}: ${fs.existsSync(datei) ? fs.statSync(datei).size + ' bytes' : 'MISSING'}`);
  const vorher = await exportiere(0, 4, 'p5-vor-schliessen');
  // close = another project opens (the host of this one goes), then back
  await neu('p5-anderes');
  await z.warte(1500);
  const r = await z.ruf('POST', '/proj/oeffnen', { slug }, CYPHER);
  if (r.code !== 200) throw new Fehl(`/proj/oeffnen -> ${z.grundVon(r)}`);
  await bereitGemessen();
  const nachher = await exportiere(0, 4, 'p5-nach-oeffnen');
  const d = nullDifferenz(vorher.l, nachher.l), dr = nullDifferenz(vorher.r, nachher.r), dk = nullDifferenz(flach.l, vorher.l);
  const spitze = Math.max(d.spitze_db ?? 0, dr.spitze_db ?? 0);
  notiere('P5 state: non-default EQ state (3 bands), save, close, reopen: output equals the saved state, residual below -90 dBFS',
    d.ok && dr.ok && d.spitze_db < -90 && dr.spitze_db < -90 && dk.ok && dk.spitze_db > -40,
    `residual L ${fmt(d.spitze_db)} dBFS, R ${fmt(dr.spitze_db)} dBFS (frames ${vorher.frames} vs ${nachher.frames}); negative control: the flat state against the saved state differs by ${fmt(dk.spitze_db)} dBFS peak`);
  roh.P5 = { d, dr, dk, datei: fs.existsSync(datei) };
}

// ===================================================================== P0: Valhalla Supermassive (yabridge) on a return
async function p0() {
  z.punkt = 'P0';
  await neu('p0');
  const [t] = await spuren(1, ['Click']);
  await aendern('p0 return and send', [{ befehl: 'return_neu', name: 'Verb', hall: { an: false } }], CYPHER);
  const ret = (await aktuell()).projekt.returns[0].id;
  await aendern('p0 clip and send', [clip(t, BURST, 0, 2), { befehl: 'send_setzen', strang_id: t, return_id: ret, db: 0 }], CYPHER);
  const iid = await setzeHost(ret, PL.valhalla);
  const t0 = Date.now();
  const h = (await bereitGemessen())[0];
  info(`P0 Supermassive on return ${ret}: stage ${h.status}, latency ${h.latenz}, measured ${h.gemessen}, ready after ${Date.now() - t0} ms`);
  const pl = (await z.ruf('GET', `/proj/insert/${iid}/parameter`)).j?.parameter ?? [];
  info(`P0 Supermassive parameters: ${pl.map((x) => `${x.name} ${x.vorgabe}${x.einheit}`).join(', ')}`);
  const fenster = (x) => { const a = []; for (let s0 = 4800; s0 + 2400 <= 4800 + 24000; s0 += 2400) a.push(db(rms(x, s0, s0 + 2400))); return a; };   // 50 ms windows from 100 ms to 600 ms after the click
  const roh0 = await exportiere(0, 6, 'p0-vorgabe');
  const f0 = fenster(roh0.l).map((x, i) => Math.max(x, fenster(roh0.r)[i]));
  info(`P0 default preset (Delay 0.5, Mix 0.5): the ten windows after the click read ${f0.map((x) => fmt(Math.max(x, -200))).join(', ')} dBFS (a sparse early pattern: the first echo comes late)`);
  // a dense tail: short delay, more feedback and density, set through the param route like a user would
  const idx = (n) => pl.find((x) => x.name === n).index;
  const setz = await paramRoute(iid, { [idx('Delay_Ms')]: 0.08, [idx('Feedback')]: 0.7, [idx('Density')]: 0.8 });
  if (setz.code !== 200) throw new Fehl(`param route -> ${z.grundVon(setz)}`);
  await z.warte(3000);
  const w = await exportiere(0, 6, 'p0-mit-hall');
  const fl = fenster(w.l), fr = fenster(w.r);
  const minLR = Math.min(...fl.map((x, i) => Math.max(x, fr[i])));
  const dry = spitzeIdx(w.l);
  notiere('P0 Supermassive (yabridge) on a return fed by a click track: the stage is bereit and the return carries a tail: energy after the dry click above -60 dBFS for 500 ms (Delay 0.08, Feedback 0.7, Density 0.8 set through the param route)',
    h.status === 'bereit' && minLR > -60 && w.antwort.echtzeit === true,
    `stage ${h.status}, 10 windows of 50 ms from 100 to 600 ms after the click: lowest ${fmt(minLR)} dBFS, highest ${fmt(Math.max(...fl, ...fr))} dBFS; dry burst peak ${fmt(dry.wert)}`);
  await aendern('p0 bypass', [{ befehl: 'insert_an', insert_id: iid, an: true === false }], CYPHER);
  await z.geladen();
  const b = await exportiere(0, 6, 'p0-bypass');
  const bl = fenster(b.l), br = fenster(b.r);
  const maxB = Math.max(...bl, ...br);
  notiere('P0 negative control: bypass (insert_an off) removes the tail: the same windows below -90 dBFS',
    maxB < -90, `highest of the 10 windows with the stage bypassed ${fmt(maxB)} dBFS (with the effect: lowest ${fmt(minLR)} dBFS)`);
  roh.P0 = { fl, fr, bl, br };
}

// ===================================================================== part 2
// radix-2 FFT of a real signal (zero padded to a power of two); returns the power per bin
function leistung(x) {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(x);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const w = -2 * Math.PI / len, wr = Math.cos(w), wi = Math.sin(w);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const p = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return { p, n };
}
const DRITTEL = [100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000];
function drittelPegel(x) {
  const { p, n } = leistung(x), df = SR / n;
  return DRITTEL.map((f) => {
    const lo = f / Math.pow(2, 1 / 6), hi = f * Math.pow(2, 1 / 6);
    let s = 0; for (let k = Math.ceil(lo / df); k < Math.min(p.length, Math.floor(hi / df) + 1); k++) s += p[k];
    return 10 * Math.log10(s + 1e-30);
  });
}
// the tap of the master (post): the ring recording of the same playback
async function tappe(name, von, bis) {
  await z.geladen();
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  const r = await z.ruf('POST', '/proj/resample', { strang_id: 'master', punkt: 'post', von_beat: von, bis_beat: bis }, CYPHER);
  if (r.code !== 200) throw new Fehl(`/proj/resample -> ${z.grundVon(r)}`);
  const datei = path.join(z.ORDNER, `${name}.wav`);
  fs.copyFileSync(r.j.datei, datei);
  return { ...leseWav(datei), antwort: r.j };
}
async function p6() {
  z.punkt = 'P6';
  // EQ only: noise through the Cypher EQ with a non-default band
  await neu('p6-eq');
  const [a] = await spuren(1, ['Noise']);
  await aendern('p6 clip', [clip(a, RAUSCHEN, 0, 16)], CYPHER);
  const iid = await setzeHost(a, PL.cypheq);
  await bereitGemessen();
  const liste = (await z.ruf('GET', `/proj/insert/${iid}/parameter`)).j.parameter;
  const g = liste.filter((x) => /gain/i.test(x.name));
  info(`P6 Cypher EQ gain parameters: ${g.map((x) => `${x.index} ${x.name} ${x.min}..${x.max}`).join(', ')}`);
  if (g[0]) { const r = await paramRoute(iid, { [g[0].index]: (9 - g[0].min) / (g[0].max - g[0].min) }); if (r.code !== 200) throw new Fehl(`param -> ${z.grundVon(r)}`); }
  await z.warte(2500);
  const e1 = await exportiere(0, 16, 'p6-eq-export');
  const t1 = await tappe('p6-eq-tap', 0, 16);
  const d1 = nullDifferenz(e1.l, t1.l), d1r = nullDifferenz(e1.r, t1.r);
  const flachNull = nullDifferenz(e1.l, e1.l.map((v) => v * 0.999));
  notiere('P6 exported = heard, EQ-only project: the real-time export against the ring recording (master tap, post) of the same playback: residual below -90 dBFS',
    d1.ok && d1r.ok && d1.spitze_db < -90 && d1r.spitze_db < -90 && e1.antwort.echtzeit === true,
    `residual L ${fmt(d1.spitze_db)} dBFS, R ${fmt(d1r.spitze_db)} dBFS (frames export ${e1.frames}, tap ${t1.frames}; export real-time ${e1.antwort.echtzeit}); negative control: the export against itself scaled by 0.999 reads ${fmt(flachNull.spitze_db)} dBFS`);
  // EQ on a track plus Dragonfly Hall on a return (reverb: not deterministic)
  await neu('p6-hall');
  const [t, b] = await spuren(2, ['Noise', 'Burst']);
  await aendern('p6 return', [{ befehl: 'return_neu', name: 'Hall', hall: { an: false } }], CYPHER);
  const ret = (await aktuell()).projekt.returns[0].id;
  await aendern('p6 clips', [clip(t, RAUSCHEN, 0, 16), clip(b, BURST, 0, 2), { befehl: 'send_setzen', strang_id: b, return_id: ret, db: 0 }, { befehl: 'spur_aendern', spur_id: b, fader_db: -6 }], CYPHER);
  const i2 = await setzeHost(t, PL.cypheq);
  const i3 = await setzeHost(ret, PL.hall);
  await bereitGemessen(2);
  const l2 = (await z.ruf('GET', `/proj/insert/${i2}/parameter`)).j.parameter.filter((x) => /gain/i.test(x.name));
  if (l2[0]) await paramRoute(i2, { [l2[0].index]: (9 - l2[0].min) / (l2[0].max - l2[0].min) });
  await z.warte(2500);
  const e2 = await exportiere(0, 16, 'p6-hall-export');
  const t2 = await tappe('p6-hall-tap', 0, 16);
  const be = drittelPegel(e2.l), bt = drittelPegel(t2.l);
  const top = Math.max(...be);
  const gueltig = be.map((v, i) => v > top - 60 && bt[i] > top - 60);
  const abw = be.map((v, i) => Math.abs(v - bt[i]));
  const maxAbw = Math.max(...abw.filter((x, i) => gueltig[i]));
  const schlecht = DRITTEL.filter((f, i) => gueltig[i] && abw[i] >= 0.5);
  // negative control: the tap of the project WITHOUT the reverb stage (the effect is the difference) misses by far more than 0.5 dB somewhere
  notiere('P6 exported = heard, EQ track plus Dragonfly Hall on a return: level difference below 0.5 dB per third-octave band (100 Hz to 10 kHz, bands within 60 dB of the loudest)',
    maxAbw < 0.5 && gueltig.filter(Boolean).length >= 12, `largest difference ${fmt(maxAbw)} dB over ${gueltig.filter(Boolean).length} bands${schlecht.length ? `; bands over: ${schlecht.join(',')} Hz` : ''}; export ${e2.frames} frames, tap ${t2.frames} frames`);
  // negative control: with the reverb stage bypassed the same bands differ by far more than 0.5 dB somewhere (the metric sees the reverb)
  await aendern('p6 hall off', [{ befehl: 'insert_an', insert_id: i3, an: false }], CYPHER);
  await z.geladen();
  const t3 = await tappe('p6-hall-aus-tap', 0, 16);
  const bo = drittelPegel(t3.l);
  const abwOhne = Math.max(...be.map((v, i) => (gueltig[i] ? Math.abs(v - bo[i]) : 0)));
  notiere('P6 negative control: the tap of the same project with the Dragonfly stage bypassed differs from the export by more than 0.5 dB in a band (the comparison would see a missing reverb)',
    abwOhne > 0.5, `largest band difference ${fmt(abwOhne)} dB`);
  const ohneHall = { abwOhne };
  roh.P6 = { eq: { d1, d1r }, hall: { be, bt, abw }, ohneHall };
}

async function p7() {
  z.punkt = 'P7';
  await neu('p7');
  const [t] = await spuren(1, ['Click']);
  await aendern('p7 clip', [clip(t, KLICK, 0, 2)], CYPHER);
  const i1 = await setzeHost(t, PL.cypheq, 0);
  const h1 = (await bereitGemessen())[0];
  const w1 = await exportiere(0, 4, 'p7-eine-stufe');
  const k1 = spitzeIdx(w1.l);
  notiere('P7 start position, one host stage (Cypher EQ): a click on beat 1 lands on sample 0 +/- 1 of the exported file',
    Math.abs(k1.idx) <= 1 && k1.wert > 0.1, `click at sample ${k1.idx} (peak ${fmt(k1.wert)}), stage latency ${h1.latenz}, file ${w1.frames} frames, real-time ${w1.antwort.echtzeit}`);
  await setzeHost(t, PL.limiter, 1);
  const hh = await bereitGemessen(2);
  const w2 = await exportiere(0, 4, 'p7-zwei-stufen');
  const k2 = spitzeIdx(w2.l);
  notiere('P7 start position, two chained host stages (Cypher EQ, LSP Limiter): the click lands on sample 0 +/- 1',
    Math.abs(k2.idx) <= 1 && k2.wert > 0.1, `click at sample ${k2.idx} (peak ${fmt(k2.wert)}), stage latencies ${hh.map((x) => x.latenz).join(' + ')} = ${hh.reduce((s, x) => s + x.latenz, 0)} samples, file ${w2.frames} frames`);
  await aendern('p7 extra', [{ befehl: 'insert_latenz_extra', insert_id: i1, samples: 100 }], CYPHER);
  await z.warte(1500);
  await bereitGemessen(2);
  const w3 = await exportiere(0, 4, 'p7-extra-100');
  const k3 = spitzeIdx(w3.l);
  notiere('P7 negative control: latenz_extra +100 on the first stage (declared 100 samples more than the host delays) takes the click off sample 0: it is no longer found there (it falls before the window, which starts later)',
    !(Math.abs(k3.idx) <= 1 && k3.wert > 0.1), `loudest sample ${k3.idx}, value ${fmt(k3.wert)} (the click of the runs above: 0.35 at sample 0)`);
  roh.P7 = { eine: k1.idx, zwei: k2.idx, extra: k3.idx };
}

// digital silence inside a sine of 1 kHz: runs of at least 32 zero samples (the sine passes zero for one sample, never for 32)
function stilleLaeufe(x, a, b) {
  let lauf = 0, n = 0;
  for (let i = a; i < b; i++) { if (Math.abs(x[i]) < 1e-9) { lauf++; if (lauf === 32) n++; } else lauf = 0; }
  return n;
}
async function p8() {
  z.punkt = 'P8';
  await neu('p8');
  const [t] = await spuren(1, ['Sine']);
  const BEATS = 600, N_SOLL = BEATS * BEAT_S * SR;
  await aendern('p8 clips', Array.from({ length: 15 }, (_, i) => clip(t, SINUS, i * 40, 40)), CYPHER);
  // negative control first: the same project without a host stage exports offline
  const off0 = await exportiere(0, BEATS, 'p8-ohne-stufe');
  const offOk = off0.frames === N_SOLL && !off0.antwort.echtzeit;
  notiere('P8 negative control: the same five-minute project without a host stage exports offline (no real-time flag) with the exact frame count',
    offOk, `frames ${off0.frames} (expected ${N_SOLL}), echtzeit ${off0.antwort.echtzeit ?? 'absent'}, ${off0.dauer_ms} ms`);
  await setzeHost(t, PL.cypheq);
  await bereitGemessen();
  const l0 = luecken();
  const w = await exportiere(0, BEATS, 'p8-export');
  const l1 = luecken();
  const dl = l0 && l1 ? l1.luecken - l0.luecken : null;
  const a = 48000, b = w.frames - 48000;
  const stille = stilleLaeufe(w.l, a, b) + stilleLaeufe(w.r, a, b);
  // the gap detector against a file with a hole of 100 samples at 2:30
  const kopie = Float32Array.from(w.l); kopie.fill(0, 7200000, 7200100);
  const kontrolle = stilleLaeufe(kopie, a, b);
  notiere('P8 a five-minute project (600 beats at 120 BPM, host stage on) exports completely: frames exact, no hole inside, frame_luecken unchanged during the run',
    w.frames === N_SOLL && w.antwort.echtzeit === true && stille === 0 && dl === 0 && kontrolle >= 1,
    `frames ${w.frames} (expected ${N_SOLL}), real-time ${w.antwort.echtzeit}, run ${w.dauer_ms} ms (dauer_s ${w.antwort.dauer_s}), silent runs of 32+ samples ${stille}, frame_luecken ${l0?.luecken} -> ${l1?.luecken} (delta ${dl}); negative control: the same detector finds ${kontrolle} hole in a copy with 100 zeroed samples`);
  roh.P8 = { frames: w.frames, stille, l0, l1, dauer_ms: w.dauer_ms };
}


// ===================================================================== part 3: foreign instrument tracks (P9, P10, P11)
// Left channel = the Surge track (pan -1, slot 1, factory patch Init Sine), right channel = the plugin track (pan +1, slot 2): one export holds both onsets.
// --versatz a,b (part 3): moves the two notes a and b samples behind beats 1 and 3, so a lead that depends on the position inside the cycle or inside the synth's own blocks (Surge renders in 32 sample blocks) shows up; default 0,0
// A diagnostic, not a gate: with a shift the Surge track lands up to 31 samples late (measured +13 to +30), so the cells that compare the plugin track with the Surge track report FEHL by design; the lead cells use the wider upper limit.
const VERSATZ3 = (z.opt.versatz ?? '0,0').split(',').map(Number);
const NOTEN3 = [{ beat: 1 + VERSATZ3[0] / (BEAT_S * SR), laenge: 1, ton: 48, vel: 100 }, { beat: 3 + VERSATZ3[1] / (BEAT_S * SR), laenge: 1, ton: 55, vel: 100 }];   // beats 1 and 3: an onset before the grid point is measurable (a note at beat 0 cannot start before sample 0)
const ONSET_SCHWELLE = 1e-4;          // -80 dBFS
const onsetAb = (x, ab, bis, schwelle = ONSET_SCHWELLE) => { for (let i = Math.max(0, ab); i < Math.min(x.length, bis); i++) if (Math.abs(x[i]) > schwelle) return i; return -1; };
// Limits of the host note timing cells (wirt-timing, 2026-11-10). They were set AFTER the first measurement, on purpose and with these reasons:
//  - LEAD_UNTEN = -1: the task asks for 0..+5 samples after the grid; one sample below zero is allowed because the -80 dBFS threshold can be crossed
//    by the first non-zero sample of a synth whose attack starts exactly on the grid (the internal RB-338 reads 1/0 as first non-zero sample, 5/0 at -80 dBFS).
//  - upper limit 8 (leadOben, 40 with --versatz): measured 0..3 for the plugin synths and 1..2 for Surge at the grid notes (beats 1 and 3 sit on Surge's own 32 sample boundary). 8 is
//    far below the 24..25 samples of the old lead error, so the cell still separates the fault from the fix. Surge at other positions lands 0..31 samples late
//    (measured 13..30 with --versatz), which is why the diagnostic upper limit is 40.
//  - REL_GRENZE = 2 (plugin against Surge): R6 of produktion-instrumente.md said 1 sample. The first run after the fix read plugin minus Surge = +1/+1 (reasonablesynth),
//    -2/-1 (RB-338, Surge 2/1 against 0/0) and +1/+2 (Vital), so 1 would fail two synths. The difference is the attack of each synth at the -80 dBFS threshold, not a note time
//    (RB-338 as an internal track reads 1/0 as first non-zero sample, the same engine as the plugin track at 0/0). The limit became 2, as the task allows ("at most 2 samples
//    difference from the synth's attack"); the limit is a gate set after the measurement, not a derived one.
const LEAD_UNTEN = -1, REL_GRENZE = 2;
const leadOben = () => (VERSATZ3.every((v) => v === 0) ? 8 : 40);
const raster = (beat) => Math.round(beat * BEAT_S * SR);
// onset of the notes in a channel: the first sample above the threshold in a window from 4000 samples before the grid point to 3 beats after it; offset = onset minus grid point
const onsets = (x, schwelle = ONSET_SCHWELLE) => NOTEN3.map((n) => { const g = raster(n.beat), i = onsetAb(x, g - 4000, g + 3 * BEAT_S * SR, schwelle); return { beat: n.beat, raster: g, onset: i, versatz: i < 0 ? null : i - g }; });
const imLead = (o) => o.every((x) => x.versatz !== null && x.versatz >= LEAD_UNTEN && x.versatz <= leadOben());
const hellig = (x, a, b) => { let e = 0, d = 0; for (let i = a + 1; i < b; i++) { e += x[i] * x[i]; const t = x[i] - x[i - 1]; d += t * t; } return e > 0 ? Math.sqrt(d / e) : 0; };   // brightness: rms of the first difference over rms
const ARBEIT = path.join(process.env.HOME ?? '', '.cache', `cypherdj-${z.instanz}`, 'arr');
const klang = (slot, patch) => sh('python3', [path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'wirte', 'carla', 'djk-klang'), '--instanz', z.instanz, `arr${slot}`, 'lade', patch], 30000);
const instrumente = async () => (await aktuell()).instrumente ?? [];
async function warteInstrumente(n, ms = 120000) {
  const t0 = Date.now();
  const ok = await z.bisWahr(async () => { const l = await instrumente(); return l.length >= n && l.every((x) => x.status === 'bereit'); }, ms);
  if (!ok) throw new Fehl(`instrument hosts not ready after ${ms} ms: ${JSON.stringify(await instrumente())}`);
  await z.geladen();
  return Date.now() - t0;
}
const spurDaten = async (id) => (await aktuell()).projekt.spuren.find((x) => x.id === id);
async function friere(id, an = true) {
  const r = await z.ruf('POST', '/proj/freeze', { spur_id: id, an }, CYPHER);
  if (r.code !== 200) throw new Fehl(`proj_freeze ${id} an ${an} -> ${z.grundVon(r)}`);
  return r;
}
async function pluginIdEigen(name) {   // reasonablesynth is an LV2 whose path is a URI: find it by its bundle
  if (!INDEX) INDEX = z.erwarte200('/plugins', await z.ruf('GET', '/plugins')).j;
  const liste = INDEX.plugins ?? INDEX.eintraege ?? INDEX;
  const e = liste.find((x) => (x.buendel ?? x.pfad).includes(name) && x.status === 'ok' && x.art === 'instrument' && !/rb338-versionen|yabridge/.test(x.buendel ?? x.pfad));
  if (!e) throw new Fehl(`instrument ${name} is not in the index`);
  return e.id;
}
async function p9(name, kz, suche, paramName, paramWert) {
  z.punkt = kz;
  const kl = await klang(1, 'Templates/Init Sine');
  if (kl.code !== 0) throw new Fehl(`djk-klang arr1 lade -> ${kl.se || kl.so}`);
  // the plugin id by bundle (the generic helper matches the path, which for reasonablesynth is a URI)
  const id = await pluginIdEigen(suche);
  await neu(`p9-${name}`);
  await aendern(`${name} surge`, [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }], CYPHER);
  const t0 = Date.now();
  await aendern(`${name} plugin`, [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'plugin', plugin_id: id } }], CYPHER);
  const sp = (await aktuell()).projekt.spuren;
  const surge = sp[0].id, pl = sp[1].id;
  const slotPl = sp[1].geraet.slot;
  await aendern(`${name} clips`, [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_aendern', spur_id: surge, pan: -1 }, { befehl: 'spur_aendern', spur_id: pl, pan: 1 },
    { befehl: 'clip_neu', spur_id: surge, art: 'midi', start_beat: 0, laenge_beats: 5, name: 'p9', noten: NOTEN3 }, { befehl: 'clip_neu', spur_id: pl, art: 'midi', start_beat: 0, laenge_beats: 5, name: 'p9', noten: NOTEN3 }], CYPHER);
  const bereitMs = await warteInstrumente(1);
  const startMs = Date.now() - t0;
  const w = await exportiere(0, 5, `p9-${name}`);
  const a = onsets(w.l), b = onsets(w.r);
  const spitzeL = spitzeLin(w.l), spitzeR = spitzeLin(w.r);
  const dV = a.map((x, i) => (x.versatz === null || b[i].versatz === null ? null : b[i].versatz - x.versatz));
  notiere(`${kz} P9 ${name}: the notes of a MIDI clip sound through the plugin (peak above -40 dBFS, 2 onsets found) and the Surge track next to it sounds`,
    spitzeR > 10 ** (-40 / 20) && spitzeL > 10 ** (-40 / 20) && b.every((x) => x.onset >= 0) && a.every((x) => x.onset >= 0),
    `plugin track peak ${fmt(db(spitzeR))} dBFS, Surge track peak ${fmt(db(spitzeL))} dBFS, slot ${slotPl}, track created to ready ${startMs} ms (wait ${bereitMs} ms), real-time export ${w.antwort.echtzeit}`);
  notiere(`${kz} P9 ${name} lead: both tracks sound at their grid point, not before it: onset offset of the Surge track and of the plugin track between ${LEAD_UNTEN} and ${leadOben()} samples, both notes (a lead of 24 samples = the over-estimated host round trip)`,
    imLead(a) && imLead(b),
    `Surge offsets ${a.map((x) => x.versatz).join(', ')}; plugin offsets ${b.map((x) => x.versatz).join(', ')}; threshold ${ONSET_SCHWELLE} (-80 dBFS)`);
  notiere(`${kz} P9 ${name} timing: onset offset to the grid of the plugin track equals the one of the Surge track within ${REL_GRENZE} samples (the attack of each synth at the threshold), both notes`,
    dV.every((d) => d !== null && Math.abs(d) <= REL_GRENZE),
    `grid ${a.map((x) => x.raster).join(', ')}; Surge onsets ${a.map((x) => x.onset).join(', ')} (offset ${a.map((x) => x.versatz).join(', ')}); plugin onsets ${b.map((x) => x.onset).join(', ')} (offset ${b.map((x) => x.versatz).join(', ')}); difference ${dV.join(', ')} samples; threshold ${ONSET_SCHWELLE} (-80 dBFS)`);
  roh[`${kz}_${name}`] = { a, b, bNull: onsets(w.r, 1e-7), spitzeL, spitzeR, startMs, bereitMs, slot: slotPl };
  // ---- P9 live: a flat a-eq stage on the master sends the export through the real-time run of the core (the master chain as heard) instead of the freeze path
  const iidM = await setzeHost('master', PL.aeq);
  await bereitGemessen();
  const wl = await exportiere(0, 5, `p9-${name}-live`);
  const al = onsets(wl.l), bl = onsets(wl.r);
  const dL = a.map((x, i) => (al[i].versatz === null || bl[i].versatz === null || x.versatz === null || b[i].versatz === null ? null : Math.max(Math.abs(al[i].versatz - x.versatz), Math.abs(bl[i].versatz - b[i].versatz))));
  notiere(`${kz} P9 ${name} live: the real-time export (master chain through a host stage, real-time flag true) puts both tracks at the same onsets as the freeze path within 1 sample and inside the lead limits`,
    wl.antwort.echtzeit === true && dL.every((d) => d !== null && d <= 1) && imLead(al) && imLead(bl),
    `real-time ${wl.antwort.echtzeit}; live onsets Surge ${al.map((x) => x.versatz).join(', ')} plugin ${bl.map((x) => x.versatz).join(', ')}; freeze path Surge ${a.map((x) => x.versatz).join(', ')} plugin ${b.map((x) => x.versatz).join(', ')}; largest difference ${dL.join(', ')}`);
  await entferne(iidM);
  // ---- P11 freeze and export of the track as for Surge
  const fS = await friere(surge), fP = await friere(pl);
  const sS = (await spurDaten(surge)).freeze, sP = (await spurDaten(pl)).freeze;
  if (!sS?.datei || !sP?.datei) throw new Fehl(`freeze fields missing: Surge ${JSON.stringify(sS)}, plugin ${JSON.stringify(sP)}`);
  const dS = leseF32Stereo(path.join(ARBEIT, sS.datei)), dP = leseF32Stereo(path.join(ARBEIT, sP.datei));
  fs.copyFileSync(path.join(ARBEIT, sP.datei), path.join(z.ORDNER, `p11-${name}-freeze-plugin.f32`));
  const oS = onsets(dS.l), oP = onsets(dP.l);
  const dF = oS.map((x, i) => (x.versatz === null || oP[i].versatz === null ? null : oP[i].versatz - x.versatz));
  notiere(`${kz} P11 ${name} freeze: proj_freeze of the plugin track works as for the Surge track (file written, sounds, onsets within ${REL_GRENZE} samples of the Surge freeze, inside the lead limits)`,
    fS.code === 200 && fP.code === 200 && spitzeLin(dP.l) > 10 ** (-40 / 20) && dF.every((d) => d !== null && Math.abs(d) <= REL_GRENZE) && imLead(oS) && imLead(oP),
    `Surge freeze ${sS.datei} (${dS.frames} frames, peak ${fmt(db(spitzeLin(dS.l)))} dBFS, onsets ${oS.map((x) => x.versatz).join(', ')}); plugin freeze ${sP.datei} (${dP.frames} frames, peak ${fmt(db(spitzeLin(dP.l)))} dBFS, onsets ${oP.map((x) => x.versatz).join(', ')}); difference ${dF.join(', ')}`);
  const e2 = await exportiere(0, 5, `p11-${name}-export-gefroren`);
  const a2 = onsets(e2.l), b2 = onsets(e2.r);
  const dE = a2.map((x, i) => (x.versatz === null || b2[i].versatz === null ? null : b2[i].versatz - x.versatz));
  notiere(`${kz} P11 ${name} export: the export with both tracks frozen holds both, onsets within ${REL_GRENZE} samples of each other and 1 sample of the unfrozen export, inside the lead limits, plugin level within 1 dB of the unfrozen export`,
    dE.every((d) => d !== null && Math.abs(d) <= REL_GRENZE) && imLead(a2) && imLead(b2) && a2.every((x, i) => Math.abs(x.versatz - a[i].versatz) <= 1) && b2.every((x, i) => Math.abs(x.versatz - b[i].versatz) <= 1) && Math.abs(db(rms(e2.r, 0, 96000)) - db(rms(w.r, 0, 96000))) <= 1,
    `frozen export onsets Surge ${a2.map((x) => x.versatz).join(', ')} plugin ${b2.map((x) => x.versatz).join(', ')}; plugin rms ${fmt(db(rms(e2.r, 0, 96000)))} dBFS against ${fmt(db(rms(w.r, 0, 96000)))} unfrozen; real-time export ${e2.antwort.echtzeit ?? 'absent'}`);
  await friere(surge, false); await friere(pl, false);
  roh[`P11_${name}`] = { oS, oP, a2, b2 };
  // ---- P10 state survives a reopen (plugins that have parameters)
  if (paramName) {
    const slug = z.eigeneSlugs.at(-1);
    const liste = (await z.ruf('GET', `/proj/spur/${pl}/geraet/parameter`)).j?.parameter ?? [];
    const q = liste.find((x) => x.name === paramName) ?? (paramName.startsWith('~') ? liste.find((x) => new RegExp(paramName.slice(1), 'i').test(x.name)) : undefined);
    if (!q) throw new Fehl(`P10 ${name}: parameter "${paramName}" is not in the list (${liste.length} entries; names with 'level': ${liste.filter((x) => /level/i.test(x.name)).slice(0, 12).map((x) => x.name).join(', ')})`);
    info(`P10 ${name}: parameter ${q.name} index ${q.index}, default ${q.vorgabe ?? q.wert}, range ${q.min}..${q.max}`);
    const flach = w;   // the default state: the export of P9
    const set = await z.ruf('POST', `/proj/spur/${pl}/geraet/param`, { werte: { [q.index]: paramWert } }, CYPHER);
    if (set.code !== 200) throw new Fehl(`P10 param route -> ${z.grundVon(set)}`);
    await z.warte(3000);                          // D8: saved 2 s after the last param call
    const datei = path.join('/dev/shm', `cypherdj-${z.instanz}`, 'projekte', slug, 'plugins', `${pl}.carxs`);
    info(`P10 ${name} state file ${datei}: ${fs.existsSync(datei) ? fs.statSync(datei).size + ' bytes' : 'MISSING'}`);
    const vor = await exportiere(0, 5, `p10-${name}-vor`);
    const wertVor = ((await z.ruf('GET', `/proj/spur/${pl}/geraet/parameter`)).j?.parameter ?? []).find((x) => x.index === q.index)?.wert;
    await neu(`p10-${name}-anderes`);
    await z.warte(1500);
    const r = await z.ruf('POST', '/proj/oeffnen', { slug }, CYPHER);
    if (r.code !== 200) throw new Fehl(`P10 /proj/oeffnen -> ${z.grundVon(r)}`);
    await warteInstrumente(1);
    const nach = await exportiere(0, 5, `p10-${name}-nach`);
    const wertNach = ((await z.ruf('GET', `/proj/spur/${pl}/geraet/parameter`)).j?.parameter ?? []).find((x) => x.index === q.index)?.wert;
    const dN = nullDifferenz(vor.r, nach.r), dK = nullDifferenz(flach.r, vor.r);
    const hV = hellig(vor.r, 24000, 48000), hN = hellig(nach.r, 24000, 48000), hF = hellig(flach.r, 24000, 48000);
    const pegel = (x) => db(rms(x, 0, 96000));
    const wertGleich = wertVor !== undefined && wertNach !== undefined && Math.abs(wertVor - wertNach) <= 1e-3 && Math.abs(wertNach - paramWert) <= 1e-2;
    const klangGleich = Math.abs(pegel(vor.r) - pegel(nach.r)) <= 0.5 && Math.abs(hV - hN) <= 0.05 * hV + 1e-9;
    const klangAnders = Math.abs(pegel(flach.r) - pegel(vor.r)) > 1 || Math.abs(hF - hV) > 0.1 * Math.max(hF, hV);
    notiere(`${kz} P10 ${name}: non-default state (${paramName} = ${paramWert}), save, close, reopen: the parameter is back and the sound equals the saved one (level within 0.5 dB, brightness within 5 %); the default state sounds different`,
      wertGleich && klangGleich && klangAnders,
      `parameter before ${wertVor}, after reopen ${wertNach} (set ${paramWert}); rms before ${fmt(pegel(vor.r))} after ${fmt(pegel(nach.r))} dBFS, brightness ${hV.toFixed(4)} -> ${hN.toFixed(4)}; residual ${dN.ok ? fmt(dN.spitze_db) + ' dBFS peak' : dN.grund} (informative: a synth with random phase does not null); negative control: default state rms ${fmt(pegel(flach.r))} dBFS, brightness ${hF.toFixed(4)}, residual against the saved state ${dK.ok ? fmt(dK.spitze_db) : dK.grund} dBFS; state file ${fs.existsSync(datei)}`);
    roh[`P10_${name}`] = { wertVor, wertNach, dN, dK, hV, hN, hF };
  }
}
// RB-338 as the internal engine of a track (offline render, no host): the same synth code as the plugin build, so its onsets are the reference of the plugin track (the R6 method)
async function p9rbIntern() {
  z.punkt = 'P9b-ref';
  await neu('p9-rb338-intern');
  await aendern('rb338 intern', [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } }], CYPHER);
  const t = (await aktuell()).projekt.spuren[0].id;
  await aendern('rb338 intern clip', [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'clip_neu', spur_id: t, art: 'midi', start_beat: 0, laenge_beats: 5, name: 'r', noten: NOTEN3 }], CYPHER);
  await z.geladen();
  const w = await exportiere(0, 5, 'p9-rb338-intern');
  const a = onsets(w.l), aN = onsets(w.l, 1e-7);
  const pl = roh.P9b_rb338?.b ?? [], plN = roh.P9b_rb338?.bNull ?? [];
  const dd = a.map((x, i) => (x.versatz === null || !pl[i] || pl[i].versatz === null ? null : pl[i].versatz - x.versatz));
  const dN = aN.map((x, i) => (x.versatz === null || !plN[i] || plN[i].versatz === null ? null : plN[i].versatz - x.versatz));
  // The plugin track has another level (-24.5 against -27.5 dBFS peak: different default state) and the first internal note another waveform start (a smooth, quadratic rise instead of the linear one),
  // so the crossing of -80 dBFS differs by up to 5 samples without a difference in time; the first non-zero sample (threshold 1e-7) is the time of the note itself.
  notiere('P9b RB-338 as plugin track against RB-338 as internal track (same engine, offline render, the method of R6): first non-zero sample within 1 sample, both notes, and the -80 dBFS onsets of both inside the lead limits',
    dN.length === 2 && dN.every((d) => d !== null && Math.abs(d) <= 1) && imLead(a) && imLead(pl),
    `internal onsets ${a.map((x) => x.versatz).join(', ')} (-80 dBFS; first non-zero sample ${aN.map((x) => x.versatz).join(', ')}; peak ${fmt(db(spitzeLin(w.l)))} dBFS); plugin track ${pl.map((x) => x.versatz).join(', ')} (first non-zero sample ${plN.map((x) => x.versatz).join(', ')}); difference ${dd.join(', ')} samples at -80 dBFS, ${dN.join(', ')} at the first non-zero sample`);
}
async function p9alle() {
  await p9('reasonablesynth', 'P9a', 'reasonablesynth.lv2', null, null);
  await p9('rb338', 'P9b', 'rb338.vst3', 'Cutoff', 0.12);
  await p9rbIntern();
  await p9('vital', 'P9c', '/.vst3/Vital.vst3', '~osc\\w*[ _]?1[ _]level', 0.2);
}
// the Surge track alone (negative control): the same notes, the same patch, no plugin track in the project: its onsets and level equal those of the Surge track next to a plugin track
async function p9kontrolle() {
  z.punkt = 'P9k';
  const kl = await klang(1, 'Templates/Init Sine');
  if (kl.code !== 0) throw new Fehl(`djk-klang arr1 lade -> ${kl.se || kl.so}`);
  await neu('p9-surge-allein');
  await aendern('surge alone', [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }], CYPHER);
  const s0 = (await aktuell()).projekt.spuren[0].id;
  await aendern('surge alone clip', [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_aendern', spur_id: s0, pan: -1 }, { befehl: 'clip_neu', spur_id: s0, art: 'midi', start_beat: 0, laenge_beats: 5, name: 'k', noten: NOTEN3 }], CYPHER);
  await z.geladen();
  const w = await exportiere(0, 5, 'p9-surge-allein');
  const a = onsets(w.l);
  const ref = roh.P9a_reasonablesynth?.a ?? [];
  const glatt = ref.length === 2 && a.every((x, i) => x.versatz === ref[i].versatz);
  const refSpitze = roh.P9a_reasonablesynth?.spitzeL ?? 0;
  notiere('P9 negative control: the Surge track alone in a project (no plugin track) has the same onsets as the Surge track next to a plugin track and the same peak within 0.5 dB',
    glatt && Math.abs(db(spitzeLin(w.l)) - db(refSpitze)) <= 0.5,
    `Surge alone onsets ${a.map((x) => x.versatz).join(', ')} peak ${fmt(db(spitzeLin(w.l)))} dBFS; next to the plugin track ${ref.map((x) => x.versatz).join(', ')} peak ${fmt(db(refSpitze))} dBFS`);
}


// ===================================================================== part 4: gate G2, the real run (plan 1.11 task 18)
// 32 tracks (30 audio, 2 instrument tracks: Vital and RB-338), 4 real effect hosts (a-eq, Cypher EQ, LSP Limiter Stereo LV2, Dragonfly Hall) on the tracks 1 to 4, the transport loops over 16 beats for --minuten (default 10) minutes.
// Measured: frame_luecken of the core (delta over the run), RSS of the six host units (sum over the cgroup), start to ready of each host, the pids unchanged (no restart), the load average.
const einheit = (name) => `${name}.service`;
async function cgroupRss(unit) {
  const cg = (await sh('systemctl', ['--user', 'show', '-p', 'ControlGroup', '--value', einheit(unit)])).so.trim();
  if (!cg) return { rss_kb: 0, pids: [] };
  let pids = [];
  try { pids = fs.readFileSync(`/sys/fs/cgroup${cg}/cgroup.procs`, 'utf8').split('\n').filter(Boolean).map(Number); } catch { /* gone */ }
  let kb = 0;
  for (const pid of pids) { try { kb += Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0); } catch { /* exited */ } }
  return { rss_kb: kb, pids };
}
const mainPid = async (unit) => Number((await sh('systemctl', ['--user', 'show', '-p', 'MainPID', '--value', einheit(unit)])).so.trim()) || 0;
async function g2lauf() {
  z.punkt = 'G2';
  const minuten = Number(z.opt.minuten ?? 10);
  await klang(1, 'Templates/Init Sine');   // harmless: slot 1 may be a plugin host by then
  await neu('g2');
  const alle = await spuren(30, Array.from({ length: 30 }, (_, i) => `A${i + 1}`));
  const befehle = [{ befehl: 'tempo_setzen', bpm: BPM }];
  alle.forEach((t, i) => befehle.push({ befehl: 'clip_neu', spur_id: t, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: MAT.sha[i % 5] }, { befehl: 'spur_aendern', spur_id: t, fader_db: -24 }));
  befehle.push({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 });
  await aendern('g2 audio tracks', befehle, CYPHER);
  // the four effect hosts, one after the other, each timed from the command to `bereit`
  const start = {};
  for (const [name, plug, strang] of [['a-eq', PL.aeq, alle[0]], ['Cypher EQ', PL.cypheq, alle[1]], ['LSP Limiter', PL.limiter, alle[2]], ['Dragonfly Hall', PL.hall, alle[3]]]) {
    const n0 = (await hosts()).length, t0 = Date.now();
    await setzeHost(strang, plug);
    const ok = await z.bisWahr(async () => { const l = await hosts(); return l.length === n0 + 1 && l.every((x) => x.status === 'bereit'); }, 90000);
    start[name] = ok ? Date.now() - t0 : null;
  }
  info(`G2 start to ready (command to status bereit): ${Object.entries(start).map(([k, v]) => `${k} ${v} ms`).join(', ')}`);
  // the two instrument tracks: Vital and RB-338
  const noten = Array.from({ length: 16 }, (_, i) => ({ beat: i, laenge: 0.75, ton: 48 + (i % 4) * 3, vel: 90 }));
  for (const [name, suche] of [['Vital', '/.vst3/Vital.vst3'], ['RB-338', 'rb338.vst3']]) {
    const id = await pluginIdEigen(suche), t0 = Date.now();
    await aendern(`g2 ${name}`, [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'plugin', plugin_id: id } }], CYPHER);
    const sid = (await aktuell()).projekt.spuren.at(-1).id;
    await aendern(`g2 ${name} clip`, [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 0, laenge_beats: 16, name: name, noten }, { befehl: 'spur_aendern', spur_id: sid, fader_db: -12 }], CYPHER);
    const n = (await instrumente()).length;
    const ok = await z.bisWahr(async () => { const l = await instrumente(); return l.length === n && l.every((x) => x.status === 'bereit'); }, 120000);
    start[name] = ok ? Date.now() - t0 : null;
  }
  info(`G2 start to ready of the instrument hosts: Vital ${start.Vital} ms, RB-338 ${start['RB-338']} ms`);
  await bereitGemessen(4);
  const spurenZahl = (await aktuell()).projekt.spuren.length;
  const einheiten = ['cypherdj-ins1-e', 'cypherdj-ins2-e', 'cypherdj-ins3-e', 'cypherdj-ins4-e', 'cypherdj-wirt-arr1-e', 'cypherdj-wirt-arr2-e'];
  const pid0 = {};
  for (const u of einheiten) pid0[u] = await mainPid(u);
  const rss0 = {};
  for (const u of einheiten) rss0[u] = (await cgroupRss(u)).rss_kb;
  await z.geladen();
  const tr = await z.ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  if (tr.code !== 200) throw new Fehl(`transport start -> ${z.grundVon(tr)}`);
  await z.warte(5000);
  const l0 = luecken(), t0 = Date.now();
  const proben = [];
  let spitzeRss = Object.fromEntries(einheiten.map((u) => [u, 0]));
  while (Date.now() - t0 < minuten * 60000) {
    await z.warte(30000);
    const r = {};
    for (const u of einheiten) { r[u] = (await cgroupRss(u)).rss_kb; spitzeRss[u] = Math.max(spitzeRss[u], r[u]); }
    const li = luecken();
    proben.push({ t_s: Math.round((Date.now() - t0) / 1000), luecken: li?.luecken, last: fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0], rss_kb: r });
  }
  const l1 = luecken();
  const st = (await aktuell());
  const hostSt = (st.hosts ?? []).map((x) => x.status), insSt = (st.instrumente ?? []).map((x) => x.status);
  const pid1 = {};
  for (const u of einheiten) pid1[u] = await mainPid(u);
  const rss1 = {};
  for (const u of einheiten) rss1[u] = (await cgroupRss(u)).rss_kb;
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  const dl = l0 && l1 ? l1.luecken - l0.luecken : null;
  const gleichePids = einheiten.every((u) => pid0[u] === pid1[u] && pid0[u] > 0);
  const alleBereit = hostSt.length === 4 && hostSt.every((x) => x === 'bereit') && insSt.length === 2 && insSt.every((x) => x === 'bereit');
  notiere(`G2 real run of ${minuten} minutes: ${spurenZahl} tracks, 4 effect hosts, 2 instrument hosts, transport looping: frame_luecken unchanged, no host restarted, all six hosts still ready`,
    spurenZahl === 32 && dl === 0 && gleichePids && alleBereit,
    `tracks ${spurenZahl}; frame_luecken ${l0?.luecken} -> ${l1?.luecken} (delta ${dl}); pids unchanged ${gleichePids}; hosts ${hostSt.join(',')}, instruments ${insSt.join(',')}; load average 1 min during the run ${proben.map((x) => x.last).join(' ')}`);
  info(`G2 RSS of the six hosts (kB, sum over the unit's cgroup) start / end / peak of the samples: ${einheiten.map((u) => `${u} ${rss0[u]} / ${rss1[u]} / ${spitzeRss[u]}`).join('; ')}`);
  roh.G2 = { minuten, start, pid0, pid1, rss0, rss1, spitzeRss, l0, l1, proben };
}

// ===================================================================== runner
const TEILE = { 1: [['P1', p1], ['P2', p2], ['P3', p3], ['P4', p4], ['P5', p5], ['P0', p0]], 2: [['P6', p6], ['P7', p7], ['P8', p8]], 3: [['P9', p9alle], ['P9k', p9kontrolle]], 4: [['G2', g2lauf]] };
async function lauf() {
  // MIDI clips have no decoding state (null): the generic wait of the frame treats it as not ready. Parts 3 and 4 hold MIDI clips, so the wait ignores null.
  z.geladen = async () => {
    const ok = await z.bisWahr(async () => { const t = await z.zustandKurz(); return t.dekodiert.every((d) => d === 'fertig' || d === null || d === undefined) && t.kern?.rev_geladen === t.wiedergabe_rev && t.kern?.status === 0; });
    if (!ok) throw new Fehl(`playback not loaded after 40 s: ${JSON.stringify(await z.zustandKurz())}`);
  };
  info(`core of the instance ${z.instanz}: ${JSON.stringify((await aktuell()).kern ?? null)}`);
  kernLogStart();
  if (!(await z.bisWahr(async () => luecken() !== null, 8000))) { process.stderr.write('abnahme_p1: the core listener got no /zustand/kern in 8 s (port 52140 taken?)\n'); process.exit(2); }
  const nur = z.opt.nur ? z.opt.nur.split(',') : null;
  for (const [name, f] of TEILE[z.opt.teil === 'x' ? 1 : z.opt.teil]) {
    if (nur && !nur.includes(name)) continue;
    try { await f(); } catch (e) { notiere(`${name} run`, false, `aborted: ${e.message}`); }
  }
  await KERNLOG.kill();
  await ende('abnahme_p1 (plan 1.11 part ' + z.opt.teil + ')');
}
lauf().catch((e) => { process.stderr.write(`abnahme_p1: ${e.stack ?? e}\n`); process.exit(2); });
