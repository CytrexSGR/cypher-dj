// Acceptance 1.12 slice 6: automation lanes on insert stage parameters and rack macros, on the real core of a test instance (never the live set).
// Two steps (a 1 kHz sine is generated; the page server finds the clip through a catalog it is started with):
//   1  node check/acceptance_lanes_chain.mjs --material /dev/shm/lk-ziel --instanz g
//   2  CYPHERDJ_KATALOG=/dev/shm/lk-ziel/katalog.sqlite DJK=<worktree>/djk djk/start/djk-start --instanz g       (silent sink, no Surge host)
//   3  node check/acceptance_lanes_chain.mjs --url http://127.0.0.1:54300 --instanz g --aufbau /dev/shm/lk-ziel/aufbau.json --bau <kern build folder> --ausgabe <dir>
// Points, each with its measured value and its counter-case:
//   L1 slice   one lane on eq b1/gain of a track (0 dB at beat 0, +12 dB at beat 8): accepted (HTTP 200), plays, the offline export carries it: the level of the 1 kHz
//              sine (the band is a bell at 1 kHz, so its gain at the centre is the gain) rises along the lane: at beats 1..14 within 0.3 dB of the lane value.
//              Counter-cases: the same project without the lane is flat (within 0.1 dB); the lane with the opposite slope falls (so the curve follows the lane, not the clock).
//   L2 live    the live run of the L1 project and its export null against each other (cypherdj-nulltest, same quantum, through the isolator of erz/4 as in abnahme_r3);
//              counter-case: without the isolator it is never null.
//   L3 macro   a lane on rack.m1 drives the mapped compressor threshold: the level at beats 2, 4, 6 equals the level of the same project with the macro row set to the lane value by hand
//              (within 0.5 dB); counter-case: the row value the lane replaces (0) gives a level at least 3 dB lower than the lane at beat 2.
//   L4 strips  the same EQ lane on a group, on a return (the track is only sent, fader -200) and on the master: each follows its lane within 0.3 dB.
//   L5 reload  the project with its lanes closes and opens again: the project JSON is the same and the export is bit-equal.
//   L6 writer  one writer per parameter over HTTP: a lane on a mapped parameter is 4xx param_gemappt, a mapping onto a lane 4xx param_hat_lane; the old reason lane_ziel_spaeter is gone;
//              the controls: an unmapped parameter takes a lane, another parameter maps.
//   L7 knobs   1.12 slice 7: a lane on a Baukasten knob (geraet.k7 of a bk track playing a held note of the graph lead, knobs 3 and 6 at 0 so that nothing else moves):
//              the level (rms) at beats 3, 6, 9 equals the level of the same project with the knob set statically to the lane value (within 0.5 dB); counter-cases: the static
//              knob at 0 and at 1 differ by at least 1 dB (the knob does something), the project without the lane is flat; the live run and the export null against each other
//              (no insert, so no latency to add); a clip envelope on the same knob (relative lane) shifts the level like the equivalent static knob.
// Exit 0 all points OK, 1 at least one FEHL, 2 call error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { schreibeWav, leseWav } from './w1_wav.mjs';
import { sinusQuelle } from './c14_measure.mjs';
import { baueKatalog, ksha } from '../tests/support/catalog.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string' }, aufbau: { type: 'string' }, material: { type: 'string' }, bau: { type: 'string' }, nur: { type: 'string' } } });
const aufrufFehler = (t) => { process.stderr.write(`abnahme_lanen_kette: ${t}\n`); process.exit(2); };
const EQ_PDC = 69;   // samples, ins_latenz(eq)
const SR = 48000, BPM = 128, SCHLAG = 60 * SR / BPM, HZ = 1000, AMP = 0.5;   // 22500 frames per beat (the kern runs at 128 BPM, the null test needs the same tempo)

// ---- step 1: the material -----------------------------------------------------------------------------------------------------------------------
if (opt.material) {
  if (!opt.instanz || !/^[gj]$/.test(opt.instanz)) aufrufFehler('--material needs --instanz g or j');
  const ziel = path.resolve(opt.material);
  fs.mkdirSync(ziel, { recursive: true });
  const FRAMES = 40 * SR, q = sinusQuelle(HZ, AMP, 0);
  const ton = new Float32Array(2 * FRAMES);
  for (let i = 0; i < FRAMES; i++) ton[2 * i] = ton[2 * i + 1] = q(i);
  const pfad = path.join(ziel, 'sinus-1k.wav');
  schreibeWav(pfad, ton);
  const katalog = baueKatalog(ziel, [{ n: 30, typ: 'track', werk_id: 30, titel: 'LK sine 1k', bpm: BPM, dauer_s: 40, pfad }]);
  const cache = path.join(os.homedir(), '.cache', `cypherdj-${opt.instanz}`, 'arr', 'audio');
  fs.rmSync(path.join(cache, `${ksha(30)}.f32`), { force: true });
  fs.writeFileSync(path.join(ziel, 'aufbau.json'), `${JSON.stringify({ katalog, bpm: BPM, instanz: opt.instanz, sha: ksha(30) }, null, 1)}\n`);
  process.stdout.write(`material written to ${ziel} (katalog ${katalog})\n`);
  process.exit(0);
}

// ---- step 3 -------------------------------------------------------------------------------------------------------------------------------------
if (!opt.url || !opt.aufbau || !opt.instanz || !opt.bau) aufrufFehler('usage: --url <http://127.0.0.1:port> --instanz <g|j> --aufbau <aufbau.json> --bau <kern build folder> [--ausgabe <dir>] [--nur L1,L2,...]');
if (/:(47300|47100|47200)\b/.test(opt.url)) aufrufFehler('never against the live studio (47300): pick a test instance');
const port = Number(new globalThis.URL(opt.url).port);
const k = (port - 47300) / 1000;
const aus = Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined;
const instanz = opt.instanz;
if (!aus || aus !== instanz) aufrufFehler(`--instanz ${instanz} does not match the port ${port} (instance ${aus ?? '?'})`);
if (!/^[gj]$/.test(instanz)) aufrufFehler(`instance ${instanz} is not allowed: only g or j`);
const AUFBAU = JSON.parse(fs.readFileSync(opt.aufbau, 'utf8'));
if (AUFBAU.instanz !== instanz) aufrufFehler(`aufbau.json is for instance ${AUFBAU.instanz}, not ${instanz}`);
const SHA = AUFBAU.sha;
const BAU = path.resolve(opt.bau);
const ISO_REF = path.join(BAU, 'iso_ref');
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-lanen-kette`);
fs.mkdirSync(ORDNER, { recursive: true });
const NUR = opt.nur ? new Set(opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const will = (kz) => !NUR || NUR.has(kz);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (kz, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}\n`); };
const info = (text) => { zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };
const fmt = (x, n = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(n) : String(x));

const URL = opt.url;
const CYPHER = { 'x-djk-quelle': 'cypher' };
const ruf = async (methode, weg, koerper, kopf = {}) => {
  const r = await fetch(URL + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};
class Fehl extends Error {}
const grundVon = (r) => `${r.code} ${r.j?.fehler ?? r.j?.grund ?? ''}${r.j?.text ? `: ${r.j.text}` : ''}`.trim();
const erwarte200 = (weg, r) => { if (r.code !== 200) throw new Fehl(`${weg} → ${grundVon(r)}`); return r; };
const holeRev = async () => erwarte200('/proj/aktuell?nur=rev', await ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
const aktuell = async () => erwarte200('/proj/aktuell', await ruf('GET', '/proj/aktuell')).j;
const projektJetzt = async () => (await aktuell()).projekt;
const aendern = async (label, befehle) => erwarte200(`/proj/aendern (${label})`, await ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, CYPHER)).j;
const aendernRoh = async (label, befehle) => ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, CYPHER);
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const warteAufKern = async () => {
  if (!(await bisWahr(async () => typeof (await ruf('GET', '/lage')).j?.uhr?.bpm === 'number', 8000))) throw new Fehl('no core: /lage reports no clock');
};
const eigeneSlugs = [];
async function neuesProjekt(kz) {
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `lk-${kz}-${zeit}` }));
  const slug = r.j.slug ?? r.j.projekt?.slug;
  if (!slug) throw new Fehl(`/proj/neu without slug: ${JSON.stringify(r.j).slice(0, 200)}`);
  eigeneSlugs.push(slug);
  return slug;
}
const geladen = async () => {
  const ok = await bisWahr(async () => {
    const a = await aktuell();
    return a.projekt.spuren.flatMap((s) => s.clips ?? []).filter((c) => c.art === 'audio').every((c) => c.dekodiert === 'fertig') && a.kern?.rev_geladen === a.projekt.wiedergabe_rev && a.kern?.status === 0;
  }, 40000);
  if (!ok) throw new Fehl('the playback is not loaded after 40 s');
};
const SETTLE_MS = 1000;   // the export reads the controls from the core's state compartment (20 Hz), see abnahme_r3
const exportiere = async (von, bis) => { await geladen(); await warte(SETTLE_MS); return erwarte200('/proj/export', await ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis }, CYPHER)).j; };
const sha = (datei) => createHash('sha256').update(fs.readFileSync(datei)).digest('hex');

// ---- measurement ----------------------------------------------------------------------------------------------------------------------------------
// the amplitude of the 1 kHz component over [i0, i0 + n) (Goertzel, n a whole number of cycles: 4800 samples = 100 cycles)
function pegel(x, i0, n = 4800) {
  let re = 0, im = 0;
  const w = 2 * Math.PI * HZ / SR;
  for (let i = 0; i < n; i++) { const v = x[i0 + i] ?? 0; re += v * Math.cos(w * (i0 + i)); im += v * Math.sin(w * (i0 + i)); }
  return (2 * Math.hypot(re, im)) / n;
}
const db = (a) => (a > 1e-9 ? 20 * Math.log10(a) : -180);
// the level in dBFS of the window centred on `beat`
const pegelBei = (x, beat) => db(pegel(x, Math.round(beat * SCHLAG) - 2400));
const laneEq = (beat) => 12 * Math.min(beat, 8) / 8;   // the lane of L1: 0 dB at beat 0, +12 dB at beat 8, then it holds
const BEATS_MESS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14];

// ---- projects -------------------------------------------------------------------------------------------------------------------------------------
const audio = (spur_id) => ({ befehl: 'clip_neu', spur_id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: 'sine' });
const EQ_BAND = { 'b1/an': 1, 'b1/typ': 0, 'b1/freq': 1000, 'b1/q': 0.707, 'b1/gain': 0 };   // a bell at 1 kHz: its gain at the centre is the gain
const eqStufe = (strang_id) => ({ befehl: 'insert_setzen', strang_id, pos: 0, art: 'eq', werte: { ...EQ_BAND } });
const KOMP = { schwelle: 0, ratio: 8, knie: 0, attack: 1, release: 80, makeup: 0, mix: 1, schp: 0 };
const insertId = async (strang) => {
  const p = await projektJetzt();
  const st = strang === 'master' ? p.master : [...p.spuren, ...p.gruppen, ...(p.returns ?? [])].find((s) => s.id === strang);
  return st.inserts[0].id;
};
// topo: spur (the EQ on the track), grp (on the group the track is in), ret (on a return, the track only sends), master (on the PM chain)
async function baue(kz, o = {}) {
  await neuesProjekt(kz);
  await aendern(`LK ${kz} tracks`, [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'audio', name: 'Sine' }]);
  await aendern(`LK ${kz} clip`, [audio('s1')]);
  const topo = o.topo ?? 'spur';
  let strang = 's1';
  // an EQ lane reaches +12 dB on a 0.5 sine (peak 2.0): the track fader takes 14 dB off after the chain, so that the master limiter of the live path never acts (the offline tap has none)
  if (!o.komp && topo !== 'ret') await aendern(`LK ${kz} fader`, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -14 }]);
  if (topo === 'grp') { await aendern(`LK ${kz} group`, [{ befehl: 'gruppenspur_neu', mitglieder: ['s1'] }]); strang = 'g1'; }
  if (topo === 'ret') {
    await aendern(`LK ${kz} return`, [{ befehl: 'return_neu', name: 'R', hall: { an: false } }]);
    // the EQ lanes reach +12 dB on a 0.5 sine: the send is lowered by 14 dB so that the master limiter of the live path never acts (it is not in the offline tap)
    await aendern(`LK ${kz} send`, [{ befehl: 'return_aendern', return_id: 'r1', pre: true }, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -200 }, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: o.komp ? 0 : -14 }]);
    strang = 'r1';
  }
  if (topo === 'master') strang = 'master';
  if (o.komp) {
    await aendern(`LK ${kz} komp`, [{ befehl: 'insert_setzen', strang_id: strang, pos: 0, art: 'komp', werte: { ...KOMP } }]);
  } else if (!o.ohneInsert) {
    await aendern(`LK ${kz} eq`, [eqStufe(strang)]);
  }
  if (o.ohneInsert) return { strang, id: null, lane: null };
  const id = await insertId(strang);
  if (o.eqGain !== undefined) await aendern(`LK ${kz} static gain`, [{ befehl: 'insert_param_setzen', insert_id: id, param: 'b1/gain', wert: o.eqGain }]);
  if (o.makro) {   // a rack on the strip: macro 1 drives the compressor threshold (-60 dB at 0, 0 dB at 1)
    await aendern(`LK ${kz} rack`, [{ befehl: 'rack_setzen', strang_id: strang, makros: [{ ziel: [{ insert: id, param: 'schwelle', von: -60, bis: 0 }] }] }]);
    if (o.makroRow !== undefined) await aendern(`LK ${kz} macro row`, [{ befehl: 'rack_makro', strang_id: strang, nr: 1, wert: o.makroRow }]);
  }
  let lane = null;
  if (o.lane) {
    const r = await aendern(`LK ${kz} lane`, [{ befehl: 'auto_neu', ...(strang === 's1' ? { spur_id: 's1' } : { strang_id: strang }), ziel: o.lane.ziel.replace('<id>', id), punkte: o.lane.punkte }]);
    lane = r;
  }
  return { strang, id, lane };
}
// one cell: build, export (beats 0..16), keep the file, return the samples
async function zelle(kz, o) {
  const b = await baue(kz, o);
  const e = await exportiere(0, 16);
  const ziel = path.join(ORDNER, `${kz}.wav`);
  fs.copyFileSync(e.datei, ziel);
  const x = leseWav(ziel).l;
  return { ...b, x, datei: ziel, export: e, proj: await projektJetzt() };
}
const abweichung = (x, ref, erwartet) => BEATS_MESS.map((b) => ({ b, ist: pegelBei(x, b) - pegelBei(ref, b), soll: erwartet(b) }));
const maxAbw = (reihe) => Math.max(...reihe.map((r) => Math.abs(r.ist - r.soll)));
const zeigeReihe = (reihe) => reihe.map((r) => `${r.b}:${fmt(r.ist, 2)}/${fmt(r.soll, 2)}`).join(' ');

// ---- live against export (the procedure of abnahme_r3, A7 with N7) ---------------------------------------------------------------------------------
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
function stromLesen() {
  const ac = new AbortController();
  const meldungen = [];
  const fertig = (async () => {
    try {
      const r = await fetch(URL + '/strom', { signal: ac.signal });
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
    } catch { /* abort */ }
  })();
  return { meldungen, stop: async () => { ac.abort(); await fertig; } };
}
// pdc: the latency of the insert chain in samples (the EQ stage reports 69 at 48 kHz): the export file starts that many samples after the transport (T13), the live capture does not skip them,
// so the null test is told the same number on top of the render's vorhalt (cypherdj-nulltest itself only knows the limiter's vorhalt)
async function nullLive(kz, beats, sekunden, pdc = 0) {
  const dir = path.join(ORDNER, kz);
  fs.mkdirSync(path.join(dir, 'w'), { recursive: true });
  await geladen();
  await warte(5000);
  const nr = (await aktuell()).projekt.wiedergabe_rev;
  const werkzeug = (n) => path.join(BAU, n);
  const vb = await prog(werkzeug('cypherdj-nulltest'), ['--vorbedingung', '--bpm', String(BPM)]);
  fs.writeFileSync(path.join(dir, 'vorbedingung.json'), `${vb.out}${vb.err}rc=${vb.rc}\n`);
  if (vb.rc !== 0 || jsonZeile(vb.out)?.vorbedingung !== 'erfuellt') return { ungueltig: `precondition not met (rc ${vb.rc}): ${letzteZeile(vb.out) || letzteZeile(vb.err)}` };
  const sse = stromLesen();
  const mit = prog(werkzeug('cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', path.join(dir, 'live.f32')]);
  await warte(500);
  const start = await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  const m = await mit;
  await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  await warte(300);
  await sse.stop();
  fs.writeFileSync(path.join(dir, 'live.json'), m.out);
  const live = jsonZeile(m.out);
  if (start.code !== 200 || m.rc !== 0 || !live) return { ungueltig: `recording failed: transport ${grundVon(start)}, mitschnitt rc ${m.rc} ${m.err.trim()}` };
  const einsatz = sse.meldungen.find((x) => x.a === '/zustand/arr' && x.f?.status === 2);
  if (!einsatz) return { ungueltig: 'no /zustand/arr with status 2 in the stream (ursprung_sample unknown)' };
  fs.writeFileSync(path.join(dir, 'strom.jsonl'), sse.meldungen.map((x) => JSON.stringify(x)).join('\n'));
  const r = await prog(werkzeug('cypherdj-render'), ['--nr', String(nr), '--von-beat', '0', '--bis-beat', String(beats), '--bpm', String(BPM), '--aus', path.join(dir, 'w', 'p.wav'), '--abgriff', 'produktion']);
  fs.writeFileSync(path.join(dir, 'w', 'p.json'), `${r.out}${r.err}rc=${r.rc}\n`);
  const pj = jsonZeile(r.out);
  if (r.rc !== 0 || !pj) return { ungueltig: `render failed (rc ${r.rc}) ${r.err.trim()}` };
  const iso = await prog(ISO_REF, [path.join(dir, 'w', 'p.wav'), path.join(dir, 'w', 'p_iso.wav')]);
  if (iso.rc !== 0) return { ungueltig: `isolator reference failed (rc ${iso.rc}): ${iso.err.trim()}` };
  const vergleich = async (name, wav) => {
    const v = await prog(werkzeug('cypherdj-nulltest'), ['--live', path.join(dir, 'live.f32'), '--live-s0', String(live.s0), '--grenze', String(live.grenze), '--ursprung', String(einsatz.f.ursprung_sample), '--render', wav,
      '--start-sample', String(pj.start_sample), '--frames', String(pj.frames), '--vorhalt', String(pj.vorhalt + pdc), '--quantum', String(pj.quantum)]);
    fs.writeFileSync(path.join(dir, `nulltest-${name}.json`), `${v.out}${v.err}rc=${v.rc}\n`);
    return { rc: v.rc, j: jsonZeile(v.out), err: v.err.trim() };
  };
  return { quantum: pj.quantum, mitIso: await vergleich('isolator', path.join(dir, 'w', 'p_iso.wav')), ohneIso: await vergleich('roh', path.join(dir, 'w', 'p.wav')) };
}
const nl = (v) => (v?.j ? `${v.j.urteil}${v.j.ursache ? `/${v.j.ursache}` : ''} residual ${fmt(v.j.rest_db)} dBFS, shifted by 1 sample ${fmt(v.j.verschoben_db)} dBFS, signal ${fmt(v.j.signal_db)} dBFS, window ${v.j.fenster} (rc ${v.rc})` : `no output (rc ${v?.rc}: ${v?.err})`);

// ---- the points -----------------------------------------------------------------------------------------------------------------------------------
let punkt = 'set-up';
async function abschnitt(name, f) {
  punkt = name;
  try { await f(); } catch (e) { notiere(name, false, e instanceof Fehl ? e.message : `ABORT: ${e.stack ?? String(e)}`); }
}
const R = {};
const LANE_EQ = { ziel: 'insert.<id>.b1/gain', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: 12 }] };
async function lauf() {
  await warteAufKern();
  info(`instance ${instanz}, ${URL}, load average ${fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]}`);

  if (will('L1') || will('L2') || will('L5')) await abschnitt('L1', async () => {
    R.ohne = await zelle('l1-ohne-lane', { eqGain: 0 });
    R.l1 = await zelle('l1-lane', { lane: LANE_EQ });
    const lane = R.l1.proj.spuren[0].automation?.[0];
    notiere('L1 the lane on eq b1/gain is accepted (no lane_ziel_spaeter) and stored on the track', lane?.ziel === `insert.${R.l1.id}.b1/gain` && lane.punkte.length === 2, JSON.stringify(lane));
    const reihe = abweichung(R.l1.x, R.ohne.x, laneEq);
    notiere('L1 the export carries the lane: the level at beats 1..14 follows the lane within 0.3 dB (bell gain at its centre)', maxAbw(reihe) <= 0.3, `max deviation ${fmt(maxAbw(reihe), 3)} dB; beat:measured/lane ${zeigeReihe(reihe)}`);
    const flach = BEATS_MESS.map((b) => pegelBei(R.ohne.x, b)), spanne = Math.max(...flach) - Math.min(...flach);
    notiere('L1 counter-case: without the lane the level is flat (within 0.1 dB over beats 1..14)', spanne <= 0.1, `spread ${fmt(spanne, 3)} dB`);
    const umgekehrt = await zelle('l1-lane-fallend', { lane: { ziel: LANE_EQ.ziel, punkte: [{ beat: 0, wert: 12 }, { beat: 8, wert: 0 }] } });
    const rev = abweichung(umgekehrt.x, R.ohne.x, (b) => 12 - laneEq(b));
    notiere('L1 counter-case: the lane with the opposite slope falls along 12 - lane within 0.3 dB (the curve follows the lane, not the clock)', maxAbw(rev) <= 0.3, `max deviation ${fmt(maxAbw(rev), 3)} dB; ${zeigeReihe(rev)}`);
    // the projection back: the track's own mixer lane list holds no device lane, the playback has the chain lane
    const wiedergabe = fs.readdirSync(path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte')).length;   // only to note the instance is the one we think
    info(`instance stock holds ${wiedergabe} project folders`);
  });

  if (will('L2')) await abschnitt('L2', async () => {
    if (!R.l1) throw new Fehl('L2 needs the L1 cell');
    // the L1 project is the open one? the last cell of L1 was the falling lane: rebuild the rising one
    await baue('l2-live', { lane: LANE_EQ });
    const n = await nullLive('l2-live', 16, 11, EQ_PDC);
    if (n.ungueltig) { notiere('L2 live against export', false, n.ungueltig); return; }
    notiere('L2 the live run and the export null against each other (same quantum, through the isolator): passed, residual < -90 dBFS',
      n.mitIso.j?.urteil === 'bestanden' && n.mitIso.j.rest_db < -90 && n.mitIso.j.signal_db > -30, `quantum ${n.quantum}; ${nl(n.mitIso)}`);
    notiere('L2 counter-case: without the isolator it is never null (the check is not blind)', n.ohneIso.j?.urteil !== 'bestanden', nl(n.ohneIso));
    if (process.env.LK_L2_KONTROLLE) {   // diagnosis: the same pipeline without a lane (a static EQ), to tell a set-up fault from a lane fault
      await baue('l2-statisch', { eqGain: 6 });
      if (process.env.LK_L2_KONTROLLE === '2') await baue('l2-statisch', { ohneInsert: true });
      const k = await nullLive('l2-statisch', 16, 11, EQ_PDC);
      notiere('L2 control: the static EQ project nulls too', k.mitIso?.j?.urteil === 'bestanden', k.ungueltig ?? nl(k.mitIso));
    }
  });

  if (will('L3')) await abschnitt('L3', async () => {
    const lane = await zelle('l3-lane', { komp: true, makro: true, makroRow: 0, lane: { ziel: 'rack.m1', punkte: [{ beat: 0, wert: 1 }, { beat: 8, wert: 0 }] } });
    const L = (b) => Math.max(0, 1 - Math.min(b, 8) / 8);   // the macro lane value at a beat
    const statisch = {};
    for (const b of [2, 4, 6]) statisch[b] = await zelle(`l3-statisch-${L(b)}`, { komp: true, makro: true, makroRow: L(b) });
    const reihe = [2, 4, 6].map((b) => ({ b, ist: pegelBei(lane.x, b) - pegelBei(statisch[b].x, b), soll: 0 }));
    notiere('L3 a lane on rack.m1 (compressor threshold through the macro) equals the same project with the macro row set by hand to the lane value, at beats 2, 4, 6 (within 0.5 dB)',
      maxAbw(reihe) <= 0.5, `deviation lane - static row ${zeigeReihe(reihe)} dB (lane values ${[2, 4, 6].map(L).join(', ')})`);
    const gegen = pegelBei(lane.x, 2) - pegelBei(statisch[6].x, 2);   // the lane at beat 2 (macro 0.75) against the row value 0.25
    notiere('L3 counter-case: the lane at beat 2 (macro 0.75) sounds at least 3 dB louder than the macro row 0.25 (the row the lane replaces would be much more compressed)', gegen >= 3, `${fmt(gegen)} dB`);
    const spanne = [2, 4, 6].map((b) => pegelBei(statisch[b].x, b));
    notiere('L3 the three levels differ (the macro does something): at least 3 dB between the loudest and the quietest', Math.max(...spanne) - Math.min(...spanne) >= 3, spanne.map((s) => fmt(s)).join(' / '));
  });

  if (will('L4')) await abschnitt('L4', async () => {
    for (const topo of ['grp', 'ret', 'master']) {
      const ohne = await zelle(`l4-${topo}-ohne`, { topo, eqGain: 0 });
      const mit = await zelle(`l4-${topo}`, { topo, lane: LANE_EQ });
      const lane = topo === 'master' ? mit.proj.master.automation?.[0] : [...mit.proj.gruppen, ...(mit.proj.returns ?? [])].find((s) => s.id === mit.strang)?.automation?.[0];
      const reihe = abweichung(mit.x, ohne.x, laneEq);
      notiere(`L4 the lane on a ${topo === 'grp' ? 'group' : topo === 'ret' ? 'return' : 'master'} stage follows its lane within 0.3 dB`, !!lane && maxAbw(reihe) <= 0.3, `lane on ${mit.strang}: ${lane?.ziel}; max deviation ${fmt(maxAbw(reihe), 3)} dB; ${zeigeReihe(reihe)}`);
      const flach = BEATS_MESS.map((b) => pegelBei(ohne.x, b)), spanne = Math.max(...flach) - Math.min(...flach);
      notiere(`L4 counter-case ${topo}: without the lane the level is flat (within 0.1 dB)`, spanne <= 0.1, `spread ${fmt(spanne, 3)} dB`);
    }
  });

  if (will('L5')) await abschnitt('L5', async () => {
    if (!R.l1) throw new Fehl('L5 needs the L1 cell');
    const b = await baue('l5-reload', { lane: LANE_EQ });
    const vorher = await projektJetzt();
    const e1 = await exportiere(0, 16);
    const h1 = sha(e1.datei);
    const slug = eigeneSlugs[eigeneSlugs.length - 1];
    await neuesProjekt('l5-anderes');   // closes the first (autosaved), then open it again
    erwarte200('/proj/oeffnen', await ruf('POST', '/proj/oeffnen', { slug }, CYPHER));
    const nachher = await projektJetzt();
    // field for field, independent of key order (the file is written in canonical key order, the live object may not be)
    const unterschiede = [];
    const geh = (x, y, pfad) => {
      if (unterschiede.length > 20) return;
      if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) { if (x !== y) unterschiede.push(`${pfad}: ${JSON.stringify(x)} / ${JSON.stringify(y)}`); return; }
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) geh(x[k], y[k], `${pfad}.${k}`);
    };
    geh({ s: vorher.spuren, m: vorher.master }, { s: nachher.spuren, m: nachher.master }, '');
    const gleich = unterschiede.length === 0;
    if (!gleich) fs.writeFileSync(path.join(ORDNER, 'l5-unterschiede.txt'), `${unterschiede.join('\n')}\n`);
    notiere('L5 the saved project with its lane opens the same: tracks and master are equal field for field', gleich && nachher.spuren[0].automation?.[0]?.ziel === `insert.${b.id}.b1/gain`, `lane ${nachher.spuren[0].automation?.[0]?.ziel}; revs ${vorher.rev}/${nachher.rev}; ${unterschiede.slice(0, 4).join(' | ')}`);
    const e2 = await exportiere(0, 16);
    notiere('L5 the export after the reopen is bit-equal to the one before', sha(e2.datei) === h1, `${h1.slice(0, 12)} / ${sha(e2.datei).slice(0, 12)}`);
  });

  if (will('L6')) await abschnitt('L6', async () => {
    const b = await baue('l6-schreiber', { komp: true, makro: true });
    const gemappt = await aendernRoh('LK lane on a mapped parameter', [{ befehl: 'auto_neu', spur_id: 's1', ziel: `insert.${b.id}.schwelle` }]);
    notiere('L6 a lane on a parameter a macro drives is refused param_gemappt', gemappt.code >= 400 && gemappt.code < 500 && gemappt.j?.fehler === 'param_gemappt', grundVon(gemappt));
    const frei = await aendernRoh('LK lane on an unmapped parameter', [{ befehl: 'auto_neu', spur_id: 's1', ziel: `insert.${b.id}.ratio` }]);
    notiere('L6 control: a lane on an unmapped parameter of the same stage is accepted', frei.code === 200, grundVon(frei));
    const umgekehrt = await aendernRoh('LK mapping onto a lane', [{ befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: b.id, param: 'ratio', von: 1, bis: 20 }] }] }]);
    notiere('L6 a mapping onto a parameter that has a lane is refused param_hat_lane', umgekehrt.code >= 400 && umgekehrt.code < 500 && umgekehrt.j?.fehler === 'param_hat_lane', grundVon(umgekehrt));
    const andere = await aendernRoh('LK mapping onto another parameter', [{ befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: b.id, param: 'schwelle', von: -60, bis: 0 }, { insert: b.id, param: 'knie', von: 0, bis: 24 }] }] }]);
    notiere('L6 control: a mapping onto a parameter without a lane is accepted', andere.code === 200, grundVon(andere));
    const alt = await aendernRoh('LK old reason', [{ befehl: 'auto_neu', spur_id: 's1', ziel: 'ins/komp/1/schwelle' }]);
    notiere('L6 an old row path is ziel_unbekannt, never lane_ziel_spaeter', alt.j?.fehler === 'ziel_unbekannt', grundVon(alt));
    const unbekannt = await aendernRoh('LK unknown stage', [{ befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i99.schwelle' }]);
    notiere('L6 a lane on a stage that is not in the chain is insert_unbekannt (a 4xx)', unbekannt.code >= 400 && unbekannt.code < 500 && unbekannt.j?.fehler === 'insert_unbekannt', grundVon(unbekannt));
  });

  if (will('L7')) await abschnitt('L7', async () => {
    const rms = (x, beat, n = 12000) => { let q = 0; const i0 = Math.round(beat * SCHLAG) - n / 2; for (let i = 0; i < n; i++) { const v = x[i0 + i] ?? 0; q += v * v; } return db(Math.sqrt(q / n)); };
    const bkZelle = async (kz, o = {}) => {
      await neuesProjekt(kz);
      await aendern(`LK ${kz} tracks`, [{ befehl: 'tempo_setzen', bpm: BPM },
        { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'lead', parameter: { k3: 0, k6: 0, k7: o.k7 ?? 0.5 } } }]);
      await aendern(`LK ${kz} clip`, [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 16, name: 'held' }]);
      const cid = (await projektJetzt()).spuren[0].clips[0].id;
      await aendern(`LK ${kz} note`, [{ befehl: 'noten_neu', clip_id: cid, noten: [{ beat: 0, laenge: 15.5, ton: 57, vel: 100 }] }]);
      if (o.lane) await aendern(`LK ${kz} lane`, [{ befehl: 'auto_neu', spur_id: 's1', ziel: 'geraet.k7', punkte: o.lane }]);
      if (o.huelle) await aendern(`LK ${kz} envelope`, [{ befehl: 'huellkurve_setzen', clip_id: cid, ziel: 'geraet.k7', punkte: o.huelle }]);
      return cid;
    };
    const exportBk = async (kz, o) => {
      await bkZelle(kz, o);
      const e = await exportiere(0, 16);
      const ziel = path.join(ORDNER, `${kz}.wav`);
      fs.copyFileSync(e.datei, ziel);
      return leseWav(ziel).l;
    };
    const LANE = [{ beat: 0, wert: 0 }, { beat: 12, wert: 1 }];   // k7: 0.25 at beat 3, 0.5 at beat 6, 0.75 at beat 9
    const lane = await exportBk('bk-lane', { lane: LANE });
    const stat = {};
    for (const k of [0, 0.25, 0.5, 0.75, 1]) stat[k] = await exportBk(`bk-statisch-${String(k).replace('.', '')}`, { k7: k });
    const reihe = [[3, 0.25], [6, 0.5], [9, 0.75]].map(([b, k]) => ({ b, k, lane: rms(lane, b), statisch: rms(stat[k], b) }));
    const abw = Math.max(...reihe.map((r) => Math.abs(r.lane - r.statisch)));
    notiere('L7 the lane on geraet.k7 plays: the level at beats 3, 6, 9 equals the static knob at the lane value (within 0.5 dB)', abw <= 0.5,
      `max deviation ${fmt(abw, 3)} dB; ${reihe.map((r) => `beat ${r.b} knob ${r.k}: lane ${fmt(r.lane, 2)} static ${fmt(r.statisch, 2)}`).join('; ')}`);
    const l0 = rms(stat[0], 6), l1 = rms(stat[1], 6);
    notiere('L7 counter-case: the knob does something: static 0 and static 1 differ by at least 1 dB', Math.abs(l1 - l0) >= 1, `static 0: ${fmt(l0, 2)} dB, static 1: ${fmt(l1, 2)} dB`);
    const spreizung = Math.abs(rms(stat[0.75], 6) - rms(stat[0.25], 6));
    notiere('L7 counter-case: the lane is not the static default: the level at beat 3 differs from the static 0.5 knob by at least as much as the knob range says (>= 0.3 dB, else the check is blind)',
      Math.abs(rms(lane, 3) - rms(stat[0.5], 3)) >= 0.3 || spreizung < 0.6, `lane beat 3 ${fmt(rms(lane, 3), 2)} dB, static 0.5 ${fmt(rms(stat[0.5], 3), 2)} dB`);
    const flach = [3, 6, 9].map((b) => rms(stat[0.5], b)), sp = Math.max(...flach) - Math.min(...flach);
    notiere('L7 counter-case: without a lane the level is flat (within 0.3 dB at beats 3, 6, 9)', sp <= 0.3, `spread ${fmt(sp, 3)} dB`);
    // the clip envelope on the same knob: summand -0.5..+0.5 over 12 beats on a static knob 0.5 = the same 0..1 sweep as the lane (clamped)
    const hk = await exportBk('bk-huelle', { k7: 0.5, huelle: [{ beat: 0, wert: -0.5 }, { beat: 12, wert: 0.5 }] });
    const rh = [[3, 0.25], [6, 0.5], [9, 0.75]].map(([b, k]) => ({ b, k, hk: rms(hk, b), statisch: rms(stat[k], b) }));
    const ah = Math.max(...rh.map((r) => Math.abs(r.hk - r.statisch)));
    notiere('L7 a clip envelope on geraet.k7 (relative lane, knob 0.5 + summand) sounds like the static knob at the sum (within 0.5 dB)', ah <= 0.5,
      `max deviation ${fmt(ah, 3)} dB; ${rh.map((r) => `beat ${r.b}: envelope ${fmt(r.hk, 2)} static ${fmt(r.statisch, 2)}`).join('; ')}`);
    // live against export, the lane project (no insert: no latency to add)
    await bkZelle('bk-live', { lane: LANE });
    const n = await nullLive('bk-live', 16, 11, 0);
    if (n.ungueltig) { notiere('L7 live against export', false, n.ungueltig); return; }
    notiere('L7 the live run and the export of the knob lane null against each other (same quantum, through the isolator): residual < -90 dBFS',
      n.mitIso.j?.urteil === 'bestanden' && n.mitIso.j.rest_db < -90 && n.mitIso.j.signal_db > -40, `quantum ${n.quantum}; ${nl(n.mitIso)}`);
    notiere('L7 counter-case: without the isolator it is never null (the check is not blind)', n.ohneIso.j?.urteil !== 'bestanden', nl(n.ohneIso));
  });
}

// ---- run ------------------------------------------------------------------------------------------------------------------------------------------
try { await lauf(); } catch (e) { notiere(punkt, false, e instanceof Fehl ? e.message : `ABORT: ${e.stack ?? String(e)}`); }
for (const s of eigeneSlugs) {   // the instance's own test projects are removed when the server allows it (never mind a refusal)
  try { await ruf('POST', '/proj/loeschen', { slug: s }, CYPHER); } catch { /* ignore */ }
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.txt'), `${zeilen.join('\n')}\n\n${fehl === 0 ? 'ALL OK' : `${fehl} FEHL`}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALL OK' : `${fehl} FEHL`}; output ${ORDNER}\n`);
process.exit(fehl === 0 ? 0 : 1);
