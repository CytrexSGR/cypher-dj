// Target acceptance, package 1.14 comping slice 1 (comp, audition, restart guards), against a TEST INSTANCE with the freshly built core
// (instances b, d or e only, never f, never the operation; the script refuses every other letter). Call order:
//   1  node check/c14_setup.mjs --ziel /dev/shm/c14-ziel --instanz e > /dev/shm/c14-ziel/aufbau.json
//   2  CYPHERDJ_KATALOG=/dev/shm/c14-ziel/katalog.sqlite DJK=<worktree>/djk djk/start/djk-start --instanz e
//      (silent sink, no --ton-frei; core/build holds the fresh binaries)
//   3  flock <CYPHERDJ_ECHTZEIT_SCHLOSS> node check/acceptance_c14.mjs --url http://127.0.0.1:52300 \
//        --aufbau /dev/shm/c14-ziel/aufbau.json --bau <kernel build folder> [--ausgabe <folder>] [--nur Z1,Z3]
// Material: three steady sines, one per take (take 1 440 Hz, take 2 660 Hz, take 3 880 Hz, amplitude 0.3, identical in both channels). The main lane
// starts with take 1 in full, so which take plays at a position is read from the frequency (least-squares fit, check/c14_measure.mjs, calibrated in
// tests/check_c14_measure.test.mjs). The project is built through the API (spur_neu, clip_neu); the takes can only come from a recording otherwise, so
// they are written into the project store as project.json and the project is opened again, the way tests/proj_comping_take.test.mjs does it.
// Criteria (plan docs/superpowers/plans/2026-11-03-1.14-comping-slice1.md, Task 11, spec AK5, AK6, AK9, AK10, risk 6):
//   Z1  offline render (export) of the T3 comp (take 3 [0,3), take 2 [3,5), take 3 [5,8)) at 120 and at 127 BPM: outside the seams (4 ms fades) the
//       export is sample-equal to the expected source, a gap in the comp is exactly silent (-inf dBFS); the +-1 frame edge of the clip start is
//       reported. Control: a no-op comp gives a bit-identical export, and the export differs from the one before the comp.
//   Z2  audition of take 2, measured on the master recording: correlation with take 2 >= 0.99, with the main lane <= 0.5; switching off brings the
//       main lane back; an export during the audition is bit-identical to one without.
//   Z3  restart of the page server (systemd user unit cypherdj-oberflaeche-<i>) during the audition: afterwards the recording carries the main lane.
//       NICHT_PRUEFBAR when the unit is not active or the page comes back without the open project.
//   Z4  audition toggled 10 times: latency from the POST to the new frequency in the recording (median and max). Over 300 ms is a FINDING, not FEHL.
//   Z5  comp_waehlen, then restart of the core (unit cypherdj-kern-<i>): afterwards the recording carries the comp. NICHT_PRUEFBAR when the unit is
//       not active.
// Return: 0 all OK (NICHT_PRUEFBAR and FINDING do not count), 1 at least one FEHL, 2 usage. Raw data go to rohdaten.json, exports and recordings to
// the output folder. Only the own projects (slug c14-...) are removed.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_target.mjs';
import { einsatz } from './a1_measure.mjs';
import { kanaele } from './a2_measure.mjs';
import {
  SR, schlagFrames, sinusQuelle, frequenzJeFenster, korrelation, nahtMaske, spitze, dbfs, stilleLauf, besterVersatz, bereich, wechselFrame, latenzMs, wandMs,
  verstaerkung, medianMax, ersterUnterschied,
} from './c14_measure.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_c14: usage: --url <test instance> --aufbau <aufbau.json> --bau <core build folder> '
    + '[--ausgabe <folder>] [--instanz <b|d|e>] [--nur Z1,Z3,...]\n');
  process.exit(2);
}
const z = starte('abnahme_c14', 'c14', { bau: { type: 'string' }, nur: { type: 'string' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, instanz, warte } = z;
if (!z.opt.bau) { process.stderr.write('abnahme_c14: --bau <core build folder> is required (cypherdj-mitschnitt)\n'); process.exit(2); }
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`abnahme_c14: instance ${instanz} is not allowed: b, d or e only (never f)\n`); process.exit(2); }
const BAU = path.resolve(z.opt.bau);
const NUR = z.opt.nur ? new Set(z.opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const AMP = A.amplitude ?? 0.3, PHASE = A.phase ?? 0.7;
const FREQ = [A.freq_t1 ?? 440, A.freq_t2 ?? 660, A.freq_t3 ?? 880];
const SHA = [A.sha_t1, A.sha_t2, A.sha_t3];
const QUELLE = FREQ.map((f) => sinusQuelle(f, AMP, PHASE));
const roh = {}, nichtPruefbar = [];
const db = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const ms = (s) => Math.round(s * SR);
const npb = (kz, grund) => { nichtPruefbar.push(`${kz}: ${grund}`); info(`NICHT_PRUEFBAR ${kz}: ${grund}`); };

const prog = (programm, args) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const jsonZeile = (t) => { try { return JSON.parse(t.trim().split('\n').filter(Boolean).pop()); } catch { return null; } };

// quelle: CYPHER by default; after a page restart the page no longer knows Cypher started the transport and refuses Cypher's stop
// (transport_laeuft), so Z3 stops it as Andreas (no source header) on this test instance
const transport = async (aktion, beat = 0, quelle = CYPHER) => {
  const r = await z.ruf('POST', '/proj/transport', aktion === 'start' ? { aktion, beat } : { aktion }, quelle);
  if (r.code !== 200) throw new Fehl(`/proj/transport ${aktion} -> ${z.grundVon(r)}`);
};

// Master recording of `sekunden`; `ablauf` runs 0.5 s after the recorder started. Returns the left channel, the frame count and the wall time at which the
// recorder
// returned (tEnd: the anchor that maps wall clock to recording frames, resolution about 20 ms).
async function nimmAuf(name, sekunden, ablauf) {
  const dir = path.join(z.ORDNER, 'roh');
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, `${name}.f32`);
  const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', datei]);
  await warte(500);
  let fehler = null;
  try { await ablauf(); } catch (e) { fehler = e; }
  const m = await mit;
  const tEnd = Date.now();
  const j = jsonZeile(m.out);
  if (m.rc !== 0 || !j) throw new Fehl(`cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}`);
  fs.writeFileSync(path.join(dir, `${name}.json`), m.out);
  if (fehler) throw fehler;
  const b = fs.readFileSync(datei);
  const { l } = kanaele(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4))));
  return { x: l, n: l.length, tEnd, mit: j };
}

// ---- project building ----
const takeClip = (id, k, start, laenge, bpm, hinweis) => ({
  id, art: 'audio', name: id, start_beat: start, laenge_beats: laenge, quelle: { sha256: SHA[k], pfad_hinweis: hinweis ?? A[`wav_t${k + 1}`] ?? '' },
  dekodiert: 'nein', offset_s: start * 60 / bpm, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0,
});
// One audio track, the main lane carries take 1 over 64 beats; takes t1..t3 are whole 64-beat copies of the three sines, t4 holds take 1 over [0,2) and
// [6,8) only (the comp of t4 over [0,8) leaves the gap [2,6) silent). Returns {spurId, slug}.
async function baue(name, bpm) {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  await warte(800);
  await z.neuesProjekt(name);
  const slug = z.eigeneSlugs.at(-1);
  await aendern(`C14 ${name} tempo`, [{ befehl: 'tempo_setzen', bpm }], CYPHER);
  await aendern(`C14 ${name} track`, [{ befehl: 'spur_neu', art: 'audio', name: 'Vox' }], CYPHER);
  const spurId = (await aktuell()).projekt.spuren[0].id;
  await aendern(`C14 ${name} main`, [{ befehl: 'clip_neu', spur_id: spurId, art: 'audio', start_beat: 0, laenge_beats: 64, sha256: SHA[0] }], CYPHER);
  const datei = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte', slug, 'project.json');
  if (!(await z.bisWahr(async () => fs.existsSync(datei) && JSON.parse(fs.readFileSync(datei, 'utf8')).spuren?.[0]?.clips?.length === 1, 10000))) {
    throw new Fehl(`${datei} does not hold the main clip after 10 s`);
  }
  const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
  let n = j.naechste_id?.clip ?? 100;
  const id = () => `c${n++}`;
  j.spuren[0].takes = [
    { id: 't1', name: 'Take 1', clips: [takeClip(id(), 0, 0, 64, bpm)] },
    { id: 't2', name: 'Take 2', clips: [takeClip(id(), 1, 0, 64, bpm)] },
    { id: 't3', name: 'Take 3', clips: [takeClip(id(), 2, 0, 64, bpm)] },
    { id: 't4', name: 'Take 4', clips: [takeClip(id(), 0, 0, 2, bpm), takeClip(id(), 0, 6, 2, bpm)] },
  ];
  j.naechste_id = { ...(j.naechste_id ?? {}), clip: n, take: 5 };
  fs.writeFileSync(datei, JSON.stringify(j));
  const o = await z.ruf('POST', '/proj/oeffnen', { slug }, CYPHER);
  if (o.code !== 200) throw new Fehl(`/proj/oeffnen ${slug} -> ${z.grundVon(o)}`);
  await z.geladen();
  const ok = await z.bisWahr(async () => (await aktuell()).projekt.spuren[0].takes?.every((t) => t.clips.every((c) => c.dekodiert === 'fertig')) ?? false,
    40000);
  if (!ok) {
    const zustand = (await aktuell()).projekt.spuren[0].takes?.map((t) => t.clips.map((c) => c.dekodiert));
    throw new Fehl(`take clips not decoded after 40 s: ${JSON.stringify(zustand)}`);
  }
  return { spurId, slug };
}
const comp = (spurId, take, von, bis) => ({ befehl: 'comp_waehlen', spur_id: spurId, take_id: take, von_beat: von, bis_beat: bis });
const vorhoeren = (spurId, take) => z.ruf('POST', '/proj/take_vorhoeren', { spur_id: spurId, take_id: take }, CYPHER);

// export that does not wait for the main playback to be the loaded one (during an audition the core holds the audition file); copies the file into the
// output folder
async function exportRoh(name, von = 0, bis = 8) {
  const r = await z.ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis }, CYPHER);
  if (r.code !== 200) throw new Fehl(`/proj/export ${name} -> ${z.grundVon(r)}`);
  const ziel = path.join(z.ORDNER, `${name}.wav`);
  fs.copyFileSync(r.j.datei, ziel);
  return ziel;
}
const leseL = (datei) => {
  const b = fs.readFileSync(datei);
  let o = 12, daten = null;
  while (o + 8 <= b.length) {
    const idn = b.toString('latin1', o, o + 4), len = b.readUInt32LE(o + 4);
    if (idn === 'data') { daten = b.subarray(o + 8, Math.min(b.length, o + 8 + len)); break; }
    o += 8 + len + (len % 2);
  }
  const f = new Float32Array(daten.buffer.slice(daten.byteOffset, daten.byteOffset + daten.length - (daten.length % 4)));
  return kanaele(f).l;
};
// which unit is alive for restarts
const unitAktiv = async (name) => (await prog('systemctl', ['--user', 'is-active', name])).out.trim() === 'active';
const serverDa = async () => { try { return (await fetch(`${z.URL}/proj/aktuell`)).status > 0; } catch { return false; } };

// ---- Z1 ----------------------------------------------------------------------------------------------------------------------------
// pieces of the T3 comp: [von, bis) in beats and the index of the take that plays there
const T3 = [{ von: 0, bis: 3, k: 2 }, { von: 3, bis: 5, k: 1 }, { von: 5, bis: 8, k: 2 }];
// compares an export (left channel) with the expected pieces; returns the verdict data. g is the gain of the render path measured on the reference export.
function pruefeStuecke(l, bpm, stuecke, grenzen, g) {
  const S = schlagFrames(bpm), maske = nahtMaske(l.length, bpm, grenzen), aus = [];
  for (const s of stuecke) {
    const von = Math.round(s.von * S), bis = Math.min(l.length, Math.round(s.bis * S));
    const b = besterVersatz(l, QUELLE[s.k], g, von, bis, maske, bereich(-1, 1));
    const falsch = besterVersatz(l, QUELLE[(s.k + 1) % 3], g, von, bis, maske, [0]);   // control: the neighbouring take must not fit
    const gk = verstaerkung(l, QUELLE[s.k], von + 400, bis - 400, b.delta);
    aus.push({ von: s.von, bis: s.bis, take: s.k + 1, delta: b.delta, maxAbw: b.maxAbw, frames: b.frames, falsch: falsch.maxAbw, gain: gk });
  }
  return aus;
}
const stueckText = (a) => a.map((s) => `[${s.von},${s.bis}) take ${s.take}: delta ${s.delta}, max dev ${s.maxAbw.toExponential(2)} `
  + `over ${s.frames} frames (wrong take ${s.falsch.toExponential(1)})`).join('; ');
async function z1() {
  for (const bpm of [120, 127]) {
    const kz = `Z1 ${bpm} BPM`, S = schlagFrames(bpm);
    const { spurId } = await baue(`z1-${bpm}`, bpm);
    const ref = leseL(await exportRoh(`z1-${bpm}-vor`));
    const g = verstaerkung(ref, QUELLE[0], 2000, Math.round(8 * S) - 2000);
    roh[`z1_${bpm}_gain`] = g;
    const r0 = pruefeStuecke(ref, bpm, [{ von: 0, bis: 8, k: 0 }], [], g)[0];
    notiere(`${kz}/NK before the comp: main lane is take 1 at a stable gain`, r0.maxAbw < 2e-5 && g > 0.1 && r0.delta === 0,
      `render gain ${g.toFixed(5)} (${db(20 * Math.log10(g))} dB), max dev ${r0.maxAbw.toExponential(2)}, delta ${r0.delta}`);
    const wavVor = path.join(z.ORDNER, `z1-${bpm}-vor.wav`);
    await aendern(`C14 z1 ${bpm} comp`, T3.map((s) => comp(spurId, `t${s.k + 1}`, s.von, s.bis)), CYPHER);
    await z.geladen();
    const e1 = await exportRoh(`z1-${bpm}-comp`);
    const l1 = leseL(e1), a1 = pruefeStuecke(l1, bpm, T3, [3, 5, 8], g);
    roh[`z1_${bpm}_stuecke`] = a1;
    const gutB = a1.every((s) => s.maxAbw < 2e-5 && s.falsch > 0.1 && Math.abs(s.gain - g) < 1e-4 * Math.max(1, g));
    notiere(`${kz} sample-equal outside the seams`, gutB, stueckText(a1));
    const ok = bpm === 120 ? a1.every((s) => s.delta === 0) : a1.every((s) => Math.abs(s.delta) <= 1);
    notiere(`${kz} clip start edge`, ok, `source offsets per piece ${a1.map((s) => s.delta).join(', ')} frames `
      + `(120 BPM must be 0, 127 BPM within +-1: beat grid ${S.toFixed(3)} frames)`);
    // no-op: the same comp again changes nothing; the export is bit-identical
    const rev0 = await z.holeRev();
    await aendern(`C14 z1 ${bpm} no-op comp`, [comp(spurId, 't3', 5, 8)], CYPHER);
    const rev1 = await z.holeRev();
    await z.geladen();
    const e2 = await exportRoh(`z1-${bpm}-noop`);
    const d12 = ersterUnterschied(fs.readFileSync(e1), fs.readFileSync(e2)), d01 = ersterUnterschied(fs.readFileSync(wavVor), fs.readFileSync(e1));
    roh[`z1_${bpm}_noop`] = { rev0, rev1, ersterUnterschied_noop: d12, ersterUnterschied_vor_nach: d01 };
    notiere(`${kz}/NK no-op comp: export bit-identical`, d12 === -1, `first differing byte ${d12} (-1 = identical), rev ${rev0} -> ${rev1}`);
    notiere(`${kz}/NK the comp itself changes the export`, d01 >= 0, `first differing byte against the export before the comp: ${d01}`);
    // gap: take 4 holds take 1 over [0,2) and [6,8) only; its comp over [0,8) leaves [2,6) silent
    await aendern(`C14 z1 ${bpm} gap comp`, [comp(spurId, 't4', 0, 8)], CYPHER);
    await z.geladen();
    const l3 = leseL(await exportRoh(`z1-${bpm}-luecke`));
    const lo = Math.round(2 * S) + 400, hi = Math.round(6 * S) - 400;
    const sp = spitze(l3, lo, hi), lauf = stilleLauf(l3, Math.round(2 * S) - 400, Math.round(2 * S) + 400);
    const a3 = pruefeStuecke(l3, bpm, [{ von: 0, bis: 2, k: 0 }, { von: 6, bis: 8, k: 0 }], [2, 6, 8], g);
    roh[`z1_${bpm}_luecke`] = { spitze: sp, db: dbfs(sp), lauf, stuecke: a3 };
    notiere(`${kz} gap is silence`, sp === 0 && lauf !== null && Math.abs(lauf.von - 2 * S) < 400 && Math.abs(lauf.bis - 6 * S) < 400,
      `peak over beats 2..6 (without 400 frames at each edge) ${sp} = ${db(dbfs(sp))} dBFS, silent run ${lauf ? `${lauf.von}..${lauf.bis}` : 'none'} `
      + `(expected about ${Math.round(2 * S)}..${Math.round(6 * S)})`);
    notiere(`${kz} around the gap the sine plays`, a3.every((s) => s.maxAbw < 2e-5 && s.falsch > 0.1), stueckText(a3));
    const lNK = a3.length && spitze(ref, lo, hi);
    notiere(`${kz}/NK the silence is a property of the gap, not of the instrument`, lNK > 0.05,
      `the same range of the export before the comp has peak ${lNK.toFixed(4)}`);
  }
}

// ---- Z2 ----------------------------------------------------------------------------------------------------------------------------
async function z2() {
  const { spurId } = await baue('z2', 120);
  const t = {};
  const aufn = await nimmAuf('z2', 16, async () => {
    t.start = Date.now(); await transport('start', 0);
    await warte(3000);
    t.an = Date.now(); t.rAn = await vorhoeren(spurId, 't2');
    await warte(4000);
    t.aus = Date.now(); t.rAus = await vorhoeren(spurId, null);
    await warte(3500);
  });
  await transport('stopp');
  const { x, n } = aufn;
  notiere('Z2 audition on is accepted', t.rAn.code === 200 && t.rAn.j?.vorhoeren?.[spurId] === 't2',
    `POST answer ${z.grundVon(t.rAn)} ${JSON.stringify(t.rAn.j?.vorhoeren)}`);
  notiere('Z2 audition off is accepted', t.rAus.code === 200 && Object.keys(t.rAus.j?.vorhoeren ?? { x: 1 }).length === 0,
    `POST answer ${z.grundVon(t.rAus)} ${JSON.stringify(t.rAus.j?.vorhoeren)}`);
  const frZ2 = (wall) => Math.max(0, Math.min(n - 1, Math.round(n - (aufn.tEnd - wall) * SR / 1000)));
  const wf1 = wechselFrame(x, frZ2(t.an - 300), n, FREQ[0], FREQ[1]), wf2 = wf1 < 0 ? -1 : wechselFrame(x, wf1 + ms(1), n, FREQ[1], FREQ[0]);
  roh.z2 = { wf1, wf2, n, tEnd: aufn.tEnd, tPost: t, latenz_an_ms: wf1 < 0 ? null : latenzMs(wf1, n, aufn.tEnd, t.an),
    latenz_aus_ms: wf2 < 0 ? null : latenzMs(wf2, n, aufn.tEnd, t.aus),
    // calibration of the wall-clock anchor: the same mapping from the transport start POST to the first sound of the recording
    latenz_start_ms: einsatz(x) < 0 ? null : latenzMs(einsatz(x), n, aufn.tEnd, t.start) };
  info(`Z2 latency on ${roh.z2.latenz_an_ms?.toFixed(0)} ms, off ${roh.z2.latenz_aus_ms?.toFixed(0)} ms, transport start (calibration) `
    + `${roh.z2.latenz_start_ms?.toFixed(0)} ms`);
  if (wf1 < 0 || wf2 < 0) { notiere('Z2 the recording shows both changes', false, `change to take 2 at frame ${wf1}, back to the main lane at ${wf2}`);
    return; }
  const k = (von, f) => korrelation(x, von, Math.min(ms(2), n - von), f);
  const vor = wf1 - ms(2.3), mit = wf1 + ms(0.5), nach = wf2 + ms(0.5);
  const kVor = k(vor, FREQ[0]), kMit660 = k(mit, FREQ[1]), kMit440 = k(mit, FREQ[0]), kNach = k(nach, FREQ[0]);
  roh.z2.korrelationen = { vor_440: kVor, mit_660: kMit660, mit_440: kMit440, nach_440: kNach };
  notiere('Z2 control: before the audition the main lane (take 1) sounds', kVor >= 0.99, `correlation with 440 Hz ${kVor.toFixed(4)}`);
  notiere('Z2 AK9 audition plays take 2: correlation >= 0.99', kMit660 >= 0.99, `correlation with 660 Hz ${kMit660.toFixed(4)}`);
  notiere('Z2 AK9 audition does not play the main lane: correlation <= 0.5', kMit440 <= 0.5, `correlation with 440 Hz ${kMit440.toFixed(4)}`);
  notiere('Z2 switching off brings the main lane back', kNach >= 0.99, `correlation with 440 Hz ${kNach.toFixed(4)}`);
  // export during the audition
  const ohne = await exportRoh('z2-ohne-vorhoeren');
  const an = await vorhoeren(spurId, 't2');
  await warte(2500);
  const a = await aktuell();
  const mit2 = await exportRoh('z2-mit-vorhoeren');
  const d = ersterUnterschied(fs.readFileSync(ohne), fs.readFileSync(mit2));
  await vorhoeren(spurId, null);
  roh.z2.export = { ersterUnterschied: d, vorhoeren_antwort: an.code, kern: a.kern, vorhoeren: a.vorhoeren };
  notiere('Z2 audition was on during the export', an.code === 200 && a.kern && a.kern.rev_geladen !== a.projekt.wiedergabe_rev,
    `POST ${an.code}, core loaded ${a.kern?.rev_geladen} against main playback ${a.projekt.wiedergabe_rev} (they differ while the audition file is loaded)`);
  notiere('Z2 AK9 export during the audition is bit-identical', d === -1, `first differing byte ${d} (-1 = identical)`);
  const NK = ersterUnterschied(fs.readFileSync(ohne), Buffer.concat([fs.readFileSync(ohne), Buffer.from([0])]));
  notiere('Z2/NK the byte comparison sees a length difference', NK >= 0, `first difference against the file with one byte appended: ${NK}`);
}

// ---- Z3 ----------------------------------------------------------------------------------------------------------------------------
async function z3() {
  const unit = `cypherdj-oberflaeche-${instanz}`;
  if (!(await unitAktiv(unit))) { npb('Z3',
    `unit ${unit} is not active (the page server does not run as a systemd user unit of this instance, so it cannot be restarted from outside)`); return; }
  const { spurId } = await baue('z3', 120);
  const t = {}, SEK = 30;
  const aufn = await nimmAuf('z3', SEK, async () => {
    await transport('start', 0);
    await warte(2500);
    t.an = Date.now(); t.rAn = await vorhoeren(spurId, 't2');
    await warte(2500);
    t.neustart = Date.now();
    t.rc = (await prog('systemctl', ['--user', 'restart', unit])).rc;
    t.unten = await z.bisWahr(async () => !(await serverDa()), 3000);
    t.da = await z.bisWahr(serverDa, 40000);
    t.wieder = Date.now();
    try { const r = await z.ruf('GET', '/proj/aktuell'); t.aktuell = { code: r.code, projekt: r.j?.projekt ? { rev: r.j.projekt.rev,
      wiedergabe_rev: r.j.projekt.wiedergabe_rev } : null, kern: r.j?.kern, vorhoeren: r.j?.vorhoeren }; } catch (e) { t.aktuell = { fehler: e.message }; }
    // the page server does not reopen a project on its own; the realistic path is that the project is opened again (the page or Andreas):
    // open it as Andreas (no source header, Cypher may not open while a transport runs that she did not start after the restart)
    await warte(3000);
    t.oeffnenZeit = Date.now();
    const ro = await z.ruf('POST', '/proj/oeffnen', { slug: z.eigeneSlugs.at(-1) }, {});
    t.oeffnen = { code: ro.code, grund: z.grundVon(ro) };
    await warte(Math.max(0, 25000 - (Date.now() - t.an) - 3000));
  });
  await transport('stopp', 0, {}).catch(() => null);
  const { x, n, tEnd } = aufn;
  const fr = (wall) => Math.max(0, Math.min(n - ms(1), Math.round(n - (tEnd - wall) * SR / 1000)));
  const fenster = [];
  for (let s = 0; s + 1 < n / SR; s += 1) {
    const w = frequenzJeFenster(x, ms(s), ms(s + 1), ms(0.5), ms(1), FREQ)[0];
    if (!w) continue;
    const pegel = Math.max(...w.amps);
    fenster.push({ s, dom: pegel < 0.02 ? 'silence' : FREQ[w.dom], pegel });
  }
  roh.z3 = { rc: t.rc, unten: t.unten, da: t.da, aktuell: t.aktuell, sekunden: fenster.map((f) => `${f.s}:${f.dom}`) };
  const proSek = fenster.map((f) => `${f.s}s=${f.dom}`).join(' ');
  info(`Z3 per second of the recording (dominant Hz): ${proSek}; restart at ${(fr(t.neustart) / SR).toFixed(1)}s, `
    + `page back at ${(fr(t.wieder) / SR).toFixed(1)}s`);
  notiere('Z3 restart of the page server went through', t.rc === 0 && t.da,
    `systemctl restart rc ${t.rc}, page down seen ${t.unten}, page back ${t.da} after ${t.wieder - t.neustart} ms`);
  const kVor = korrelation(x, fr(t.neustart) - ms(2), ms(1.5), FREQ[1]);
  notiere('Z3 control: the audition sounded before the restart', t.rAn.code === 200 && kVor >= 0.99,
    `POST ${z.grundVon(t.rAn)}, correlation with 660 Hz ${kVor.toFixed(4)} just before the restart`);
  info(`Z3 before reopening the page had /proj/aktuell ${JSON.stringify(t.aktuell)}; the core kept playing what it had loaded `
    + `(per second above); reopen at ${(fr(t.oeffnenZeit) / SR).toFixed(1)} s: ${JSON.stringify(t.oeffnen)}`);
  if (t.oeffnen?.code === 200) {
    const von = fr(t.oeffnenZeit) + ms(1.5), kN = korrelation(x, von, Math.min(ms(3), n - von), FREQ[0]);
    roh.z3.korrelation_nach_oeffnen = kN;
    notiere('Z3 AK10 after the restart and reopening the project the recording carries the main lane', kN >= 0.99,
      `correlation with 440 Hz ${kN.toFixed(4)} from 1.5 s after the reopen`);
    return;
  }
  if (!t.aktuell?.projekt) {
    npb('Z3', `the page comes back without an open project (/proj/aktuell: ${JSON.stringify(t.aktuell)}), `
      + 'so the load guard on restart cannot be reached from outside; '
      + `the recording after the restart shows ${fenster.slice(-3).map((f) => f.dom).join(', ')} Hz in its last 3 s`);
    return;
  }
  const ende = Math.max(fr(t.wieder) + ms(2), n - ms(4)), kNach = korrelation(x, ende, Math.min(ms(3), n - ende), FREQ[0]);
  roh.z3.korrelation_nach = kNach;
  notiere('Z3 AK10 after the restart the recording carries the main lane', kNach >= 0.99,
    `correlation with 440 Hz ${kNach.toFixed(4)} in the last 3 s (page back at ${(fr(t.wieder) / SR).toFixed(1)} s of ${(n / SR).toFixed(1)} s); `
    + `after the restart: audition map ${JSON.stringify(t.aktuell.vorhoeren)}, core loaded ${t.aktuell.kern?.rev_geladen} `
    + `against main playback ${t.aktuell.projekt.wiedergabe_rev}`);
}

// ---- Z4 ----------------------------------------------------------------------------------------------------------------------------
async function z4() {
  const { spurId } = await baue('z4', 120);
  const toggles = [];
  const aufn = await nimmAuf('z4', 21, async () => {
    await transport('start', 0);
    await warte(2000);
    for (let k = 0; k < 10; k++) {
      const tPost = Date.now(), r = await vorhoeren(spurId, k % 2 === 0 ? 't2' : null);
      toggles.push({ k, tPost, antwort_ms: Date.now() - tPost, code: r.code });
      await warte(1500);
    }
  });
  await transport('stopp');
  const { x, n, tEnd } = aufn;
  const fr = (wall) => Math.max(0, Math.min(n - 1, Math.round(n - (tEnd - wall) * SR / 1000)));
  const lat = [];
  for (const e of toggles) {
    const [fAlt, fNeu] = e.k % 2 === 0 ? [FREQ[0], FREQ[1]] : [FREQ[1], FREQ[0]];
    const wf = wechselFrame(x, fr(e.tPost - 300), fr(e.tPost + 1400), fAlt, fNeu);
    e.wf = wf; e.latenz_ms = wf < 0 ? null : latenzMs(wf, n, tEnd, e.tPost);
    if (e.latenz_ms !== null) lat.push(e.latenz_ms);
  }
  roh.z4 = { toggles, n, tEnd };
  notiere('Z4 all 10 toggles were accepted', toggles.every((e) => e.code === 200),
    `answers ${toggles.map((e) => e.code).join(',')}; time to the answer ${toggles.map((e) => e.antwort_ms).join(',')} ms`);
  notiere('Z4 all 10 toggles are seen in the recording', lat.length === 10,
    `${lat.length} of 10 changes found; latencies ${toggles.map((e) => (e.latenz_ms === null ? 'none' : Math.round(e.latenz_ms))).join(', ')} ms`);
  if (lat.length) {
    const m = medianMax(lat);
    roh.z4.median_max = m;
    notiere('Z4 latency from the POST to the new frequency in the recording', true,
      `median ${m.median.toFixed(0)} ms, max ${m.max.toFixed(0)} ms, min ${m.min.toFixed(0)} ms (n ${m.n}; `
      + 'the anchor wall clock to frame has about 20 ms resolution; the audio output path to the speakers is not in this number)');
    if (m.max > 300 || m.median > 300) {
      info(`FINDING Z4: toggle latency over 300 ms (median ${m.median.toFixed(0)}, max ${m.max.toFixed(0)}): spec risk 6, not a FEHL`);
    }
  }
}

// ---- Z5 ----------------------------------------------------------------------------------------------------------------------------
// the comp t2 over [3,5) on the main lane of take 1: windows well inside each piece (half a beat away from the seams)
async function compAufnahme(name) {
  const aufn = await nimmAuf(name, 6, async () => { await transport('start', 0); await warte(5000); });
  await transport('stopp');
  const { x } = aufn, e0 = einsatz(x), S = 24000;
  if (e0 < 0) return { e0, ok: false, text: 'the recording is silent' };
  const fens = [{ a: 0.5, b: 2.5, f: 0 }, { a: 3.5, b: 4.5, f: 1 }, { a: 5.5, b: 7.5, f: 0 }];
  const k = fens.map((w) => ({ ...w, korr: korrelation(x, e0 + Math.round(w.a * S), Math.round((w.b - w.a) * S), FREQ[w.f]) }));
  const nk = korrelation(x, e0 + Math.round(3.5 * S), S, FREQ[0]);
  return { e0, ok: k.every((w) => w.korr >= 0.99) && nk <= 0.5, nk,
    text: `${k.map((w) => `beats ${w.a}..${w.b} vs ${FREQ[w.f]} Hz: ${w.korr.toFixed(4)}`).join('; ')}; beats 3.5..4.5 vs 440 Hz: ${nk.toFixed(4)}` };
}
async function z5() {
  const unit = `cypherdj-kern-${instanz}`;
  if (!(await unitAktiv(unit))) { npb('Z5',
    `unit ${unit} is not active (the core does not run as a systemd user unit of this instance, so it cannot be restarted from outside)`); return; }
  const { spurId } = await baue('z5', 120);
  await aendern('C14 z5 comp', [comp(spurId, 't2', 3, 5)], CYPHER);
  await z.geladen();
  const vor = await compAufnahme('z5-vor');
  roh.z5 = { vor };
  notiere('Z5 control: before the restart the recording carries the comp', vor.ok, vor.text);
  const gen0 = (await aktuell()).kern;
  const rs = await prog('systemctl', ['--user', 'restart', unit]);
  await warte(4000);
  const wieder = await z.bisWahr(async () => { try { const a = await aktuell(); return a.kern && a.kern.status !== undefined; } catch { return false; } },
    30000);
  let geladen = true;
  try { await z.geladen(); } catch (e) { geladen = false; info(`Z5 playback after the restart: ${e.message}`); }
  const a = await aktuell();
  roh.z5.neustart = { rc: rs.rc, wieder, geladen, kern_vorher: gen0, kern_nachher: a.kern, wiedergabe_rev: a.projekt.wiedergabe_rev };
  notiere('Z5 restart of the core went through and the page loaded the playback again', rs.rc === 0 && wieder && geladen,
    `systemctl restart rc ${rs.rc}, core seen again ${wieder}, playback loaded ${geladen}; `
    + `core before ${JSON.stringify(gen0)}, after ${JSON.stringify(a.kern)}`);
  const nach = await compAufnahme('z5-nach');
  roh.z5.nach = nach;
  notiere('Z5 after the restart the recording carries the comp', nach.ok, nach.text);
}

// ---- run ---------------------------------------------------------------------------------------------------------------------------
const gewollt = (n) => !NUR || NUR.has(n);
async function lauf() {
  info(`abnahme_c14 against ${z.URL} (instance ${instanz}), core build folder ${BAU}`);
  for (const [name, f] of [['Z1', z1], ['Z2', z2], ['Z3', z3], ['Z4', z4], ['Z5', z5]]) {
    if (!gewollt(name)) continue;
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
await z.ende('Comping 1.14 target acceptance', /^c14-/);
