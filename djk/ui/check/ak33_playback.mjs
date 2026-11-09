// AK33 M1 and M3 (reload): export equals playback, measured. TEST INSTANCE b, d or e only (never f, never the operation).
//   flock <CYPHERDJ_ECHTZEIT_SCHLOSS> node check/ak33_playback.mjs --url http://127.0.0.1:52300 --aufbau <json> --ausgabe <folder> --jam <project.json> \
//        --name <label> --spuren s1,s3,s5 [--von 64 --bis 96] [--reload none|gain] [--aenderung-ms 1875] [--marker-zug s3:20:0.012] [--fertig-nach <name>]
// What it does: copies the filtered jam project into the instance's own store (the jam is only read), opens it, exports [von, bis) with abgriff "set" (Ring behind the
// set limiter, i.e. what the master sink gets), then PLAYS the same span on the instance and records the sink monitor with pw-record (the measurement the plan names).
// --ausloeser-spur <id>: the track whose clip gain is toggled (it is put at -100 dB so the change is audio-neutral: 1e-5 of the amplitude, -100 dB relative); without it the
// first track is toggled (its sound changes by 0.01 dB, a residual of -59 dB relative that belongs to the change itself).
// With --reload gain a project change (clip gain +-0.01 dB, a change that makes the server publish a new playback, wiedergabe_rev) is sent every --aenderung-ms
// during the playback, the way the jam's regie did it once per bar; the audio is NOT changed by it, so the capture must equal the export all the same.
// With --marker-zug <spur>:<beat>:<s> a warp marker of the first clip of that track is dragged by <s> seconds (warp_marker verschiebe, neu_quell_s) BEFORE export and capture.
// Outputs: <ausgabe>/<name>-export.wav, <name>-capture.wav, <name>.json (timestamps of the changes, wiedergabe_rev before and after, load, pw-top ERR deltas).
// Evaluation: ak33_comparison.py <export> <capture> (alignment by cross-correlation, residual per 100 ms block, per-block lag).
// G2 (review F1), separating the source of a capture slip: --ring records the kern's own master ring with cypherdj-mitschnitt (no PipeWire in between),
// --capture2 records a second pw-record of the same sink monitor at the same time; ak33_evaluation/ak33_source.py compares export, ring and captures and names the source.
// Load: loadavg and the CPU and IO pressure (PSI some avg10) are sampled every second during the real-time phase and printed ("LOAD ..."); above --last-max (default
// LAST_MAX_STD; the number and its limits are in produktion-warp.md section AK33, G2) the run is labelled INVALID (FEHL Lastschranke) instead of silently differing. --last-max 0 switches the gate off.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { starte, Fehl } from './w3a_target.mjs';
import { leseWav } from './w1_wav.mjs';

const z = starte('ak33_wiedergabe', 'b1w', {
  jam: { type: 'string' }, name: { type: 'string' }, spuren: { type: 'string' }, von: { type: 'string' }, bis: { type: 'string' },
  reload: { type: 'string' }, ring: { type: 'boolean' }, capture2: { type: 'boolean' }, extra: { type: 'string' }, 'last-max': { type: 'string' }, 'ausloeser-spur': { type: 'string' }, ziel: { type: 'string' }, 'aenderung-ms': { type: 'string' }, 'marker-zug': { type: 'string' }, modus: { type: 'string' },
});
const { AUFBAU: A, CYPHER, info, instanz, ORDNER } = z;
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`ak33_wiedergabe: instance ${instanz} is not allowed: b, d or e only\n`); process.exit(2); }
const JAM = z.opt.jam ?? A.jam, NAME = z.opt.name ?? 'lauf';
const VON = Number(z.opt.von ?? 64), BIS = Number(z.opt.bis ?? 96), SPUREN = (z.opt.spuren ?? 's1,s3,s5').split(',');
const MODUS = z.opt.modus ?? null;   // override warp.modus of every audio clip (repitch | complex | beats | tones)
const RELOAD = z.opt.reload ?? 'none', MS = Number(z.opt['aenderung-ms'] ?? 1875), AUSLOESER = z.opt['ausloeser-spur'] ?? null;
const LAST_MAX_STD = 16;   // loadavg1 above the number of cores (16 here): CPU contention regime (PSI cpu some 28 to 50 percent against at most 2 at loadavg 11 or less; kern callback max up to 2.8 ms against 0.9 ms calm). It does NOT predict a capture slip (see produktion-warp.md section AK33, G2); the in-run slip detector decides that.
const LAST_MAX = Number(z.opt['last-max'] ?? LAST_MAX_STD);
const RING = z.opt.ring === true;
// extra pw-record captures of the same monitor, started with the first one: --capture2 = one more, --extra ordner,shm,... = one per word; shm writes the file to /dev/shm while
// recording (no disk write in the recorder), then copies it into the output folder
const EXTRA = [...(z.opt.capture2 === true ? ['ordner'] : []), ...(z.opt.extra ? z.opt.extra.split(',') : [])];
const lastLesen = () => {
  const la = fs.readFileSync('/proc/loadavg', 'utf8').split(' ');
  const psiLies = (was) => { try { return Number(/some avg10=([\d.]+)/.exec(fs.readFileSync(`/proc/pressure/${was}`, 'utf8'))[1]); } catch { return null; } };   // no PSI: null
  return { la1: Number(la[0]), la5: Number(la[1]), la15: Number(la[2]), psi10: psiLies('cpu'), psi_io10: psiLies('io') };
};
// pw-top ERR column (xrun counter per node) before and after: { nodeName: errCount }
const pwErr = () => {
  const r = spawnSync('pw-top', ['-b', '-n', '3'], { encoding: 'utf8', timeout: 10000 });
  const zeilen = (r.stdout ?? '').split('\n'), start = zeilen.map((x, i) => (/^S\s+ID/.test(x) ? i : -1)).filter((i) => i >= 0).at(-1) ?? 0;
  const o = {}; o.__roh = zeilen.slice(start).filter((x) => /stumm|record|-e\s*$/.test(x)).join('\n');
  for (const x of zeilen.slice(start + 1)) { const m = /^\S\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\d+)\s+(?:\S+ \d+ \d+\s+)?(?:\+\s+)?(\S+)\s*$/.exec(x); if (m) o[m[2]] = Number(m[1]); }
  return o;
};
const jam = JSON.parse(fs.readFileSync(JAM, 'utf8'));
const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');
const roh = { name: NAME, von: VON, bis: BIS, spuren: SPUREN, reload: RELOAD, aenderung_ms: MS };

async function baue() {
  await z.neuesProjekt(NAME);
  const slug = z.eigeneSlugs.at(-1), datei = path.join(wurzel, slug, 'project.json');
  const nun = JSON.parse(fs.readFileSync(datei, 'utf8'));
  const p = JSON.parse(JSON.stringify(jam));
  p.spuren = p.spuren.filter((s) => SPUREN.includes(s.id)).map((s) => ({ ...s, fader_db: s.id === AUSLOESER ? -100 : 0, mute: false, solo: false, pan: 0, clips: s.clips.map((c) => ({ ...c, gain_db: 0, ...(MODUS && c.warp ? { warp: { ...c.warp, modus: MODUS } } : {}) })) }));
  p.name = nun.name; p.loop = { an: false, von_beat: 0, bis_beat: 96 }; p.rev = nun.rev ?? 1; p.tempo_bpm = 128;
  fs.writeFileSync(datei, JSON.stringify(p));
  const o = await z.ruf('POST', '/proj/oeffnen', { slug }, CYPHER);
  if (o.code !== 200) throw new Fehl(`/proj/oeffnen ${slug} -> ${z.grundVon(o)}`);
  await z.geladen();
}

async function markerZug() {
  const [spurId, beat, s] = z.opt['marker-zug'].split(':'), proj = (await z.aktuell()).projekt;
  const clip = proj.spuren.find((x) => x.id === spurId).clips[0];
  const lage = z.erwarte200('/proj/warp', await z.ruf('GET', `/proj/warp?clip_id=${clip.id}&marker_max=4096`)).j;
  const m = lage.warp.marker.find((x) => x.beat === Number(beat));
  if (!m) throw new Fehl(`no marker at beat ${beat} in ${clip.id}`);
  const neu = m.quell_s + Number(s);
  await z.aendern('AK33 drag marker', [{ befehl: 'warp_marker', clip_id: clip.id, verschiebe: [{ beat: Number(beat), neu_quell_s: neu }] }], CYPHER);
  await z.geladen();
  roh.marker_zug = { clip: clip.id, beat: Number(beat), von_quell_s: m.quell_s, nach_quell_s: neu };
  info(`dragged marker ${clip.id} beat ${beat}: ${m.quell_s} -> ${neu} s`);
}

const aufnahme = (datei) => {
  const p = spawn('pw-record', ['--target', `cypher_stumm-${instanz}`, '-P', 'stream.capture.sink=true', '--rate', '48000', '--channels', '2', '--format', 'f32', datei], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  return { p, ende: () => new Promise((res) => { p.on('close', (rc) => res({ rc, err })); p.kill('SIGINT'); }) };
};

try {
  await baue();
  if (z.opt['marker-zug']) await markerZug();
  const rev0 = (await z.aktuell()).projekt.wiedergabe_rev;
  // abgriff "set": the ring behind the set limiter, which is what the master sink gets when playing (the default "produktion" is the output BEFORE the limiter)
  await z.geladen();
  const ex = z.erwarte200('/proj/export', await z.ruf('POST', '/proj/export', { von_beat: VON, bis_beat: BIS, abgriff: 'set' }, CYPHER)).j;
  const expDatei = path.join(ORDNER, `${NAME}-export.wav`);
  fs.copyFileSync(ex.datei, expDatei);
  const e = leseWav(expDatei);
  roh.export = { frames: e.frames, datei: expDatei, abgriff: ex.abgriff, ueber_decke: ex.ueber_decke, limiter_db_max: ex.limiter_db_max, spitze_db: ex.spitze_db };
  info(`export ${(e.frames / e.rate).toFixed(3)} s, abgriff ${ex.abgriff}, peak ${ex.spitze_db} dB, limiter max reduction ${ex.limiter_db_max} dB, over ceiling ${ex.ueber_decke}`);
  const capDatei = path.join(ORDNER, `${NAME}-capture.wav`), dauer = (BIS - VON) * 60 / 128;
  // G2: load sampling (every second), pw-top ERR before, ring tap (cypherdj-mitschnitt) and a second capture, all started before the transport
  const lastProben = [lastLesen()], lastTimer = setInterval(() => lastProben.push(lastLesen()), 1000);
  const errVor = pwErr();
  let ring = null;
  if (RING) {
    const bin = path.join(process.env.DJK ?? '', 'core/build/cypherdj-mitschnitt'), ringDatei = path.join(ORDNER, `${NAME}-ring.f32`);
    if (!fs.existsSync(bin)) throw new Fehl(`--ring: ${bin} is missing (build target cypherdj-mitschnitt)`);
    const p = spawn(bin, ['--sekunden', String(Math.ceil(dauer + 6)), '--aus', ringDatei], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CYPHERDJ_INSTANZ: instanz } });
    let aus = '', err = ''; p.stdout.on('data', (d) => { aus += d; }); p.stderr.on('data', (d) => { err += d; });
    ring = { datei: ringDatei, fertig: new Promise((res) => p.on('close', (rc) => res({ rc, aus: aus.trim(), err: err.trim() }))) };
  }
  const rec = aufnahme(capDatei);
  const extras = EXTRA.map((ort, i) => {
    const ziel = path.join(ORDNER, `${NAME}-capture${i + 2}.wav`), schreib = ort === 'shm' ? path.join('/dev/shm', `ak33-${instanz}-${NAME}-capture${i + 2}.wav`) : ziel;
    return { ort, ziel, schreib, rec: aufnahme(schreib) };
  });
  await z.warte(800);
  const t0 = Date.now();
  roh.t_start_iso = new Date(t0).toISOString();
  const st = await z.ruf('POST', '/proj/transport', { aktion: 'start', beat: VON }, CYPHER);
  if (st.code !== 200 || !st.j.ok) throw new Fehl(`transport start -> ${JSON.stringify(st.j).slice(0, 300)}`);
  roh.start_ms = Date.now() - t0;
  const aenderungen = [];
  if (RELOAD === 'gain' || RELOAD === 'laenge') {
    const proj = (await z.aktuell()).projekt;
    // gain: toggle the clip gain of the trigger track (audio-neutral at -100 dB). laenge: toggle the LENGTH of the clips of the tracks in --ziel, one clip per change in turn,
    // by 10 beats; the span under test stays inside every clip, so the audio must not change, but the playing voice of that clip is replaced (the jam did this live).
    const ziele = RELOAD === 'laenge' ? (z.opt.ziel ?? SPUREN.join(',')).split(',').map((id) => proj.spuren.find((x) => x.id === id).clips[0]) : [proj.spuren.find((x) => (AUSLOESER ? x.id === AUSLOESER : x.clips.length))?.clips[0]];
    const orig = new Map(ziele.map((c) => [c.id, c.laenge_beats]));
    const an = new Set();
    let k = 0;
    while ((Date.now() - t0) / 1000 < dauer + 1.5 - MS / 1000) {
      await z.warte(MS);
      const t = Date.now() - t0, clip = ziele[k % ziele.length];
      const befehl = RELOAD === 'gain' ? { befehl: 'clip_aendern', clip_id: clip.id, gain_db: (k % 2 ? 0 : 0.01) }
        : { befehl: 'clip_aendern', clip_id: clip.id, laenge_beats: an.has(clip.id) ? orig.get(clip.id) : orig.get(clip.id) - 10 };
      if (RELOAD === 'laenge') { if (an.has(clip.id)) an.delete(clip.id); else an.add(clip.id); }
      const r = await z.aendernRoh(`AK33 reload ${k}`, [befehl], CYPHER);
      aenderungen.push({ t_ms: t, code: r.code, rev: r.j?.rev, clip: clip.id });
      k++;
    }
  }
  while ((Date.now() - t0) / 1000 < dauer + 1.5) await z.warte(100);
  const errMitte = pwErr();   // while the recorders are still alive their nodes are in the table
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  const r = await rec.ende();
  const rExtra = [];
  for (const x of extras) { const r2 = await x.rec.ende(); if (x.schreib !== x.ziel) { fs.copyFileSync(x.schreib, x.ziel); fs.rmSync(x.schreib, { force: true }); } rExtra.push({ datei: x.ziel, ort: x.ort, rc: r2.rc }); }
  roh.t_ende_iso = new Date().toISOString();
  clearInterval(lastTimer);
  roh.capture = { datei: capDatei, rc: r.rc };
  roh.captures_extra = rExtra;
  roh.pw_top_roh = errMitte.__roh; delete errMitte.__roh;
  roh.pw_err_mitte = errMitte;
  if (ring) { const rr = await Promise.race([ring.fertig, z.warte(15000).then(() => null)]); roh.ring = { datei: ring.datei, ...(rr ?? { rc: 'timeout' }) }; if (!rr || rr.rc !== 0) z.notiere('Ring tap', false, `cypherdj-mitschnitt rc ${rr?.rc ?? 'timeout'} ${rr?.err ?? ''}`); }
  // G2 load report and gate
  const mx = (k) => Math.max(...lastProben.map((x) => x[k] ?? 0));
  roh.last = { nproc: os.cpus().length, la1_start: lastProben[0].la1, la1_ende: lastProben.at(-1).la1, la1_max: mx('la1'), la5_max: mx('la5'), psi10_max: mx('psi10'), psi_io10_max: mx('psi_io10'), proben: lastProben.length, last_max_gate: LAST_MAX };
  const errNach = errMitte;
  // all nodes whose counter changed, plus every node of this instance and of the captures (name contains the instance letter after '-', 'stumm' or 'pw-record')
  const wichtig = (k) => /stumm|pw-record|-e$/.test(k);
  roh.pw_err = Object.fromEntries(Object.keys(errNach).filter((k) => errNach[k] !== (errVor[k] ?? 0) || wichtig(k)).map((k) => [k, { vor: errVor[k] ?? null, nach: errNach[k] }]));
  info(`LOAD loadavg1 start ${roh.last.la1_start} end ${roh.last.la1_ende} max ${roh.last.la1_max} (5 min max ${roh.last.la5_max}), cpu pressure some avg10 max ${roh.last.psi10_max}, io pressure some avg10 max ${roh.last.psi_io10_max}, ${roh.last.nproc} cpus, gate ${LAST_MAX || 'off'}`);
  info(`PW-ERR nodes whose xrun counter changed during the run: ${JSON.stringify(roh.pw_err)}`);
  if (LAST_MAX > 0 && roh.last.la1_max > LAST_MAX) z.notiere('Lastschranke', false, `INVALID run: loadavg1 max ${roh.last.la1_max} > ${LAST_MAX} (CPU contention, real-time figures are not representative); repeat when the machine is calmer or pass --last-max 0 knowingly`);
  roh.gueltig_last = !(LAST_MAX > 0 && roh.last.la1_max > LAST_MAX);
  roh.aenderungen = aenderungen;
  roh.wiedergabe_rev = { vorher: rev0, nachher: (await z.aktuell()).projekt.wiedergabe_rev };
  info(`capture ${capDatei}, changes ${aenderungen.length}, wiedergabe_rev ${rev0} -> ${roh.wiedergabe_rev.nachher}`);
} catch (e) { z.notiere('Aufbau/Lauf', false, e.message); }
fs.writeFileSync(path.join(ORDNER, `${NAME}.json`), JSON.stringify(roh, null, 1));
if (roh.capture && roh.export) {   // G2: slip detector as part of the run; a slipped capture is labelled, not silently different
  const py = spawnSync(process.env.CYPHERDJ_PYTHON ?? 'python3', [path.join(path.dirname(new URL(import.meta.url).pathname), 'ak33_evaluation/ak33_source.py'), '--export', roh.export.datei,
    ...(roh.ring?.rc === 0 ? ['--ring', roh.ring.datei] : []), '--capture', roh.capture.datei, ...roh.captures_extra.map((x) => x.datei), '--orte', ['ordner', ...roh.captures_extra.map((x) => x.ort)].join(','), '--json', path.join(ORDNER, `${NAME}-quelle.json`)], { encoding: 'utf8' });
  if (py.status === 0) {
    const q = JSON.parse(py.stdout);
    for (const t of [q.ring, ...q.captures]) if (t) info(`QUELLE ${t.name}: bit-identical ${t.bit_identical}, ${t.bit_equal_frames}/${t.frames_ref} frames equal, first mismatch ${t.first_mismatch_s ?? '-'} s, slips ${JSON.stringify(t.slips)}`);
    info(`QUELLE verdict: ${q.verdict}`);
    if (q.captures[0].slipped) z.notiere('Slip', false, `capture slipped (${JSON.stringify(q.captures[0].slips)}): the run does not show "export equals playback"`);
  } else z.notiere('Quelle', false, `ak33_source.py failed: ${(py.stderr ?? '').slice(-300)}`);
}
await z.ende(`AK33 playback vs export ${NAME}`, /^b1w-/);
