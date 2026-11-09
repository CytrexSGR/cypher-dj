// Target acceptance, package 1.14 slice 4 (bounce, N08, U5b), against a TEST INSTANCE with the real core and the real cypherdj-render (instances b, d or e
// only; the script refuses every other letter with exit 2). The plan's call order, inside the wrapper that holds the locks and starts the instance:
//   1  node check/b14_setup.mjs --ziel /dev/shm/b14-ziel --instanz e > /dev/shm/b14-ziel/aufbau.json
//   2  CYPHERDJ_KATALOG=/dev/shm/b14-ziel/katalog.sqlite DJK=<worktree>/djk djk/start/djk-start --instanz e
//   3  . djk/config/realtime_lock.sh; flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" node check/acceptance_b14.mjs --instanz e --aufbau /dev/shm/b14-ziel/aufbau.json \
//        --bau <core build folder> [--ausgabe <folder>] [--nur B1,N1,...] [--wav-behalten]
// The URL defaults to http://127.0.0.1:<47300 + 1000 * (letter - 96)> (port() of check/b14_measure.mjs); --url only overrides it.
// Every null test uses the gate of w7 (peak of the difference below -90 dBFS; the 1.13 merge reached -138 dBFS). Every export records its regler_quelle,
// every case the core state. Cases (the B-AK it serves in brackets, the same table is written into bericht.md):
//   N0  the same full export twice is below -90 (B-AK11)            NK1  B shifted by one sample and B at -3.0103 dB are above -90 (B-AK11)
//   B1  in place at 120 BPM: structure (B-AK2) and null (B-AK4)       B2  the same at 127 BPM in a fresh project (B-AK4)
//   U   undo/redo keys (B-AK3), R restore through "Use Whole Lane" (B-AK7), L reload (B-AK9), TE tempo limit (B-AK13, reported)
//   N1  to new track with one source (B-AK5)                          N2  to new track with gruppe_id (B-AK5)
//   P   paste (B-AK6)                                                  T   take lanes untouched and auditionable (B-AK8)
//   V   freshness (B-AK12)                                             NK2..NK6  refusals leave the rev unchanged (B-AK10)
//   K   cost (B-AK14, reported)
// Exit: 0 unless a FEHL exists (NICHT_PRUEFBAR and FINDING do not count as FEHL, but the headline then reads 'OK, ABER NICHT ALLES ERFUELLT: ...', never 'ALLES OK'), 1 at least one FEHL, 2 usage.
// The verdict logic (worst line per case wins, headline, table) lives in check/b14_verdict.mjs and is tested there. Raw data go to rohdaten.json, the report to bericht.md; WAVs
// only with --wav-behalten. Only the own projects (slug b14-...) are removed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { starte, Fehl } from './w3a_target.mjs';
import { leseWav } from './w1_wav.mjs';
import { kanaele } from './a2_measure.mjs';
import { NULL_TOR_DB, nullDifferenz, nullOk, versatz, projektSchluessel, klickOnsets, onsetsVergleich, port } from './b14_measure.mjs';
import { pegelVerhaeltnisDb } from './w7_measure.mjs';
import { urteil, schluss, tabelle, sensZuordnung, wiederholbarkeit } from './b14_verdict.mjs';
import { SR, wechselFrame, latenzMs, korrelation } from './c14_measure.mjs';
import { kanonisch } from '../project/model.ts';
import { PAN_MITTE_DB } from '../project/merge.ts';

// ---- usage and instance check, before anything else (no network, no file) ----
const HILFE = 'abnahme_b14: usage: --instanz <b|d|e> --aufbau <aufbau.json> --bau <core build folder> [--url <test instance>] [--ausgabe <folder>] '
  + '[--nur B1,B2,N1,N2,REP,P,T,V,NK,K] [--wav-behalten]\n';
if (process.argv.includes('--help') || process.argv.includes('-h')) { process.stderr.write(HILFE); process.exit(2); }
const vor = parseArgs({ options: { instanz: { type: 'string' }, url: { type: 'string' }, ausgabe: { type: 'string' } }, strict: false, args: process.argv.slice(2) }).values;
const instanzAus = (u) => { try { const k = (Number(new globalThis.URL(u).port) - 47300) / 1000; return Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined; } catch { return undefined; } };
const INSTANZ = vor.instanz ?? (typeof vor.url === 'string' ? instanzAus(vor.url) : undefined);
if (!INSTANZ) { process.stderr.write(HILFE); process.exit(2); }
if (!/^[bde]$/.test(INSTANZ)) { process.stderr.write(`abnahme_b14: instance '${INSTANZ}' is not allowed: only b, d or e (never c, f, g, h, i)\n`); process.exit(2); }
const zwei = (n) => String(n).padStart(2, '0'), d0 = new Date();
const ZEIT = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const argv2 = [...process.argv];
if (typeof vor.url !== 'string') argv2.push('--url', `http://127.0.0.1:${port(INSTANZ)}`);
if (vor.instanz === undefined) argv2.push('--instanz', INSTANZ);
if (typeof vor.ausgabe !== 'string') argv2.push('--ausgabe', path.join(os.homedir(), 'messungen', '2026-11-05-b14', `${ZEIT}-abnahme_b14`));
process.argv = argv2;

const z = starte('abnahme_b14', 'b14', { bau: { type: 'string' }, nur: { type: 'string' }, 'wav-behalten': { type: 'boolean' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, warte, instanz } = z;
// z.geladen of the frame waits for every clip to be decoded; a MIDI clip has no dekodiert state (null), so only audio clips count here
z.geladen = async () => {
  const ok = await z.bisWahr(async () => {
    const a = await z.aktuell();
    return a.projekt.spuren.flatMap((s) => s.clips).filter((c) => c.art === 'audio').every((c) => c.dekodiert === 'fertig')
      && a.kern?.rev_geladen === a.projekt.wiedergabe_rev && a.kern?.status === 0;
  });
  if (!ok) throw new Fehl(`playback not loaded after 40 s: ${JSON.stringify(await z.zustandKurz())}`);
};
if (!z.opt.bau) { process.stderr.write('abnahme_b14: --bau <core build folder> is required (cypherdj-mitschnitt)\n'); process.exit(2); }
const BAU = path.resolve(z.opt.bau);
const NUR = z.opt.nur ? new Set(z.opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const SHA = Object.fromEntries(Object.entries(A.wavs ?? {}).map(([k, v]) => [k, v.sha]));
const roh = { faelle: {}, exporte: [] };
const ms2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const projektOrdner = (slug) => path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte', slug);
const sp = (p, id) => p.spuren.find((s) => s.id === id);
const projekt = async () => (await aktuell()).projekt;
const sha256Datei = (pfad) => crypto.createHash('sha256').update(fs.readFileSync(pfad)).digest('hex');
const ohneDek = (c) => { const q = structuredClone(c); delete q.dekodiert; return q; };
const gleich = (x, y) => kanonisch(x) === kanonisch(y);
const ohneClips = (s) => { const q = structuredClone(s); delete q.clips; delete q.takes; return q; };
// verdicts: the worst line of a case id wins (FEHL > FINDING > NICHT_PRUEFBAR > OK), see check/b14_verdict.mjs
const { ergebnis, nichtPruefbar, findings, pr, gut, npb, finding: findingBasis } = urteil({ notiere, info });
// what the headline of the report says about a case whose gate is reported, not met
const FINDING_KURZ = {
  N2S: 'the plan-literal N2 gate (S = steady sine, both with a send to the Hall) is NOT met; case N2 was substituted by click material for S',
  N2B: 'diagnosis: S alone with its send to the Hall misses the null gate by the same amount as N2S',
  REP: 'the sine + Hall-send mix is NOT repeatable: render-to-render difference on untouched exports, so the SENS/SENSS steps are not evidence of a sensitivity of the Hall',
  TE: 'the bounced clicks do not stay at their 120-BPM seconds when the tempo changes to 127 BPM',
};
const finding = (kz, text, kurz = FINDING_KURZ[kz]) => findingBasis(kz, text, kurz);
// ---- helpers: transport, recorder, exports ----
const prog = (programm, args) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const jsonZeile = (t) => { try { return JSON.parse(t.trim().split('\n').filter(Boolean).pop()); } catch { return null; } };
const stoppTransport = () => z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
const transport = async (aktion, beat = 0) => {
  const r = await z.ruf('POST', '/proj/transport', aktion === 'start' ? { aktion, beat } : { aktion }, CYPHER);
  if (r.code !== 200) throw new Fehl(`/proj/transport ${aktion} -> ${z.grundVon(r)}`);
};
async function nimmAuf(name, sekunden, ablauf) {
  const dir = path.join(z.ORDNER, 'roh');
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, `${name}.f32`);
  const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', datei]);
  await warte(500);
  let fehler = null;
  try { await ablauf(); } catch (e) { fehler = e; }
  const m = await mit;
  const tEnd = Date.now(), j = jsonZeile(m.out);
  if (m.rc !== 0 || !j) throw new Fehl(`cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}`);
  fs.writeFileSync(path.join(dir, `${name}.json`), m.out);
  if (fehler) throw fehler;
  const b = fs.readFileSync(datei);
  const { l } = kanaele(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4))));
  return { x: l, n: l.length, tEnd, mit: j };
}
const exportNamen = [];
async function export_(von, bis, name) {
  await z.geladen();
  const r = z.erwarte200('/proj/export', await z.ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis }, CYPHER)).j;
  fs.copyFileSync(r.datei, path.join(z.ORDNER, `${name}.wav`));
  exportNamen.push(`${name}.wav`);
  roh.exporte.push({ name, von, bis, regler_quelle: r.regler_quelle, frames: r.frames, spitze_db: r.spitze_db, abgriff: r.abgriff, kern: (await aktuell()).kern ?? null });
  return { ...leseWav(r.datei), regler_quelle: r.regler_quelle, spitze_db: r.spitze_db };
}
// the null gate on both channels; returns the verdict and records the numbers
function tor(kz, text, a, b, extra = '', weich = false) {
  const dl = nullDifferenz(a.l, b.l), dr = nullDifferenz(a.r, b.r), ok = nullOk(dl) && nullOk(dr);
  const pegel = [pegelVerhaeltnisDb(a.l, b.l), pegelVerhaeltnisDb(a.r, b.r)], lag = [versatz(a.l, b.l), versatz(a.r, b.r)];
  roh.faelle[kz] = { ...(roh.faelle[kz] ?? {}), [text]: { l: dl, r: dr, pegel_db: pegel, versatz: lag, regler_quelle: [a.regler_quelle, b.regler_quelle] } };
  const zeile = `${text}: L ${ms2(dl.spitze_db)} dBFS (rms ${ms2(dl.rms_db)}), R ${ms2(dr.spitze_db)} dBFS (rms ${ms2(dr.rms_db)}), gate ${NULL_TOR_DB} dBFS `
    + `(merge precedent -138); level B/A ${ms2(pegel[0])}/${ms2(pegel[1])} dB; lag ${lag.join('/')} samples; regler_quelle A ${a.regler_quelle}, B ${b.regler_quelle}${extra}`;
  if (weich && !ok) finding(kz, zeile); else pr(kz, ok, zeile);
  return ok;
}
const umkehr = async (art) => {
  const r = z.erwarte200(`/proj/${art}`, await z.ruf('POST', `/proj/${art}`, { rev: await z.holeRev() }, CYPHER));
  await z.geladen();
  return r.j;
};
// the sha256 of every bounce WAV this run writes goes into the file the wrapper names in B14_SHAS: the wrapper removes exactly those decode-cache files
// (plus the ones of the aufbau material) and nothing else (review U5b finding 3)
const merkeSha = (sha) => { if (process.env.B14_SHAS) fs.appendFileSync(process.env.B14_SHAS, `${sha}\n`); };
const bounce = async (koerper, kopf = CYPHER) => {
  const r = await z.ruf('POST', '/proj/bounce?antwort=kurz', koerper, kopf);
  if (r.code === 200 && typeof r.j?.datei === 'string') { try { merkeSha(sha256Datei(r.j.datei)); } catch (e) { info(`bounce WAV sha not recorded: ${e.message}`); } }
  return r;
};
const bounceDateien = (slug) => { try { return fs.readdirSync(path.join(projektOrdner(slug), 'bounce')).sort(); } catch { return []; } };
const cacheOrdner = path.join(os.homedir(), '.cache', `cypherdj-${instanz}`, 'arr', 'audio');
// name -> size of every file of the shared decode cache (a file that vanishes between readdir and stat is skipped)
const cacheListe = () => {
  const m = new Map();
  try { for (const f of fs.readdirSync(cacheOrdner)) { try { m.set(f, fs.statSync(path.join(cacheOrdner, f)).size); } catch { /* removed meanwhile */ } } } catch { /* no cache folder */ }
  return m;
};

// ---- the mix of the plan (B1): K = click track, S = sine track ----
// K: click clips [0,8) gain -4 dB, [10,16) fades in/out 1 beat, [20,28) offset 0.5 s; fader -4.5, pan -0.6, a fader lane; a send of -6 dB to a return
// with Cypher Hall; target group G (fader -3 dB). S: a 220 Hz sine over [0,32), untouched. Options: send/gruppe (default true), sInGruppe (S joins G with the
// same send, case N2), sKlick (S plays the click material with a 0.25 s offset instead of the sine: the Hall does not null on a steady sine, see SENS), lang (K is one clip over [0,64), the cost case), z (an empty audio track Z, case P).
async function stelleMix(name, bpm, o = {}) {
  await stoppTransport();
  await z.neuesProjekt(name);
  const slug = z.eigeneSlugs.at(-1), p = (t) => `B14 ${name} ${t}`;
  await aendern(p('tempo'), [{ befehl: 'tempo_setzen', bpm }], CYPHER);
  await aendern(p('tracks'), [{ befehl: 'spur_neu', art: 'audio', name: 'K' }, { befehl: 'spur_neu', art: 'audio', name: 'S' },
    ...(o.z ? [{ befehl: 'spur_neu', art: 'audio', name: 'Z' }] : [])], CYPHER);
  const p1 = await projekt(), K = p1.spuren[0].id, S = p1.spuren[1].id, Z = o.z ? p1.spuren[2].id : null;
  const klick = (start, laenge) => ({ befehl: 'clip_neu', spur_id: K, art: 'audio', start_beat: start, laenge_beats: laenge, sha256: SHA['klick-120'], name: 'klick' });
  await aendern(p('clips'), [...(o.lang ? [klick(0, 64)] : [klick(0, 8), klick(10, 6), klick(20, 8)]),
    { befehl: 'clip_neu', spur_id: S, art: 'audio', start_beat: 0, laenge_beats: 32, sha256: o.sKlick ? SHA['klick-120'] : SHA['sinus-220'], name: o.sKlick ? 'klick2' : 'sinus' }], CYPHER);
  const kc = sp(await projekt(), K).clips.map((c) => c.id);
  if (!o.lang) {
    await aendern(p('clip fields'), [{ befehl: 'clip_aendern', clip_id: kc[0], gain_db: -4 },
      { befehl: 'clip_aendern', clip_id: kc[1], fade_ein_beats: 1, fade_aus_beats: 1 }, { befehl: 'clip_aendern', clip_id: kc[2], offset_s: 0.5 }], CYPHER);
  }
  if (o.sKlick) await aendern(p('S clicks between the clicks of K'), [{ befehl: 'clip_aendern', clip_id: sp(await projekt(), S).clips[0].id, offset_s: 0.25 }], CYPHER);
  let G = null, R = null;
  if (o.send !== false) {
    await aendern(p('return'), [{ befehl: 'return_neu', name: 'Cypher Hall' }], CYPHER);
    R = (await projekt()).returns[0].id;
    await aendern(p('sends'), [{ befehl: 'send_setzen', strang_id: K, return_id: R, db: -6 },
      ...(o.sInGruppe ? [{ befehl: 'send_setzen', strang_id: S, return_id: R, db: -6 }] : [])], CYPHER);
  }
  if (o.gruppe !== false) {
    await aendern(p('group'), [{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: o.sInGruppe ? [K, S] : [K] }], CYPHER);
    G = (await projekt()).gruppen[0].id;
    await aendern(p('group fader'), [{ befehl: 'gruppenspur_aendern', gruppe_id: G, fader_db: -3 }], CYPHER);
  }
  const ende = o.lang ? 64 : 28;
  await aendern(p('mixer'), [{ befehl: 'spur_aendern', spur_id: K, fader_db: -4.5, pan: -0.6 },
    { befehl: 'auto_neu', spur_id: K, ziel: 'fader', punkte: [{ beat: 0, wert: -4.5 }, { beat: Math.round(ende / 2), wert: -7 }, { beat: ende, wert: -4.5 }] }], CYPHER);
  await z.geladen();
  return { slug, K, S, Z, G, R, kc };
}
const alleClipIds = (p) => p.spuren.flatMap((s) => [...s.clips, ...(s.takes ?? []).flatMap((t) => t.clips)].map((c) => c.id));
const keinDoppelt = (p) => { const ids = alleClipIds(p); return new Set(ids).size === ids.length; };
const zaehlerOk = (nach, vorher) => Object.keys(nach ?? {}).every((k) => (nach[k] ?? 0) >= (vorher?.[k] ?? 0));

// the structure of B-AK2 on a project pair
function pruefeInPlace(kz, pVor, pNach, m, r) {
  const vorK = sp(pVor, m.K), nachK = sp(pNach, m.K), lane = (nachK.takes ?? []).find((t) => t.name === 'Before bounce'), c = nachK.clips[0];
  pr(kz, nachK.clips.length === 1 && c.art === 'audio' && c.start_beat === 0 && c.laenge_beats === 28 && Math.abs(c.gain_db - PAN_MITTE_DB) < 1e-6 && c.name === 'Bounce: K',
    `B-AK2 the track plays one audio clip over the hull [0,28) with gain_db ${c.gain_db} (expected ${PAN_MITTE_DB}), name '${c.name}', ${nachK.clips.length} main clip(s)`);
  pr(kz, !!lane && lane.id === r.take_id && gleich(lane.clips.map(ohneDek), vorK.clips.map(ohneDek)),
    `B-AK2 lane 'Before bounce' (${lane?.id}, answer take_id ${r.take_id}) holds the former main clips deep-equal (ids and every field), ${lane?.clips.length} clips`);
  pr(kz, gleich(ohneClips(nachK), ohneClips(vorK)) && gleich((nachK.takes ?? []).slice(0, -1), vorK.takes ?? []),
    'B-AK2 fader, pan, mute, solo, target, sends, automation and the other take lanes are deep-equal to before');
  pr(kz, gleich(sp(pNach, m.S), sp(pVor, m.S)) && gleich({ g: pNach.gruppen, r: pNach.returns, m: pNach.master, t: pNach.tempo_bpm },
    { g: pVor.gruppen, r: pVor.returns, m: pVor.master, t: pVor.tempo_bpm }), 'B-AK2 the untouched track S, groups, returns, master and tempo are deep-equal to before');
  pr(kz, keinDoppelt(pNach) && !lane?.clips.some((k) => k.id === c.id), `B-AK2 no clip id is used twice (main clip ${c.id} is new)`);
}

// ---- B1 / B2 ----
async function fallB1() {
  const m = await stelleMix('b1-120', 120);
  roh.kern = (await aktuell()).kern ?? null;
  info(`core of the instance: ${JSON.stringify(roh.kern)}`);
  z.punkt = 'N0';
  const a = await export_(0, 32, 'B1-A'), a2 = await export_(0, 32, 'N0-A2');
  if (!tor('N0', 'N0 the same full export twice is repeatable', a, a2)) throw new Fehl('N0 failed: the render is not repeatable, no later value says anything');
  z.punkt = 'NK1';
  const versch = new Float32Array(a.l.length); versch.set(a.l.subarray(0, a.l.length - 1), 1);
  const g = 10 ** (-3.0102999566398 / 20);
  const k1 = nullDifferenz(a.l, versch), k2 = nullDifferenz(a.l, a.l.map((x) => x * g));
  roh.faelle.NK1 = { verschoben: k1, minus3dB: k2 };
  pr('NK1', !nullOk(k1) && !nullOk(k2), `B shifted by one sample ${ms2(k1.spitze_db)} dBFS and B at -3.0103 dB ${ms2(k2.spitze_db)} dBFS are both above ${NULL_TOR_DB} dBFS`);
  z.punkt = 'B1';
  const pVor = await projekt(), keyVor = projektSchluessel(pVor);
  const t0 = Date.now();
  const rb = await bounce({ art: 'an_ort', spur_id: m.K });
  z.erwarte200('B1 POST /proj/bounce an_ort', rb);
  const r = rb.j;
  await z.geladen();
  const pNach = await projekt(), keyNach = projektSchluessel(pNach);
  info(`B1 bounce answered after ${Date.now() - t0} ms: ${JSON.stringify({ ...r, projekt: undefined })}`);
  pruefeInPlace('B1', pVor, pNach, m, r);
  const b = await export_(0, 32, 'B1-B');
  tor('B1', 'B-AK4 in place at 120 BPM, whole mix before vs after', a, b);
  // U: one undo gives the key before (counters excluded), the export equals A; redo gives the key after
  z.punkt = 'U';
  await umkehr('undo');
  const pU = await projekt();
  pr('U', projektSchluessel(pU) === keyVor, `B-AK3 one undo: projektSchluessel equals the key before the bounce (${projektSchluessel(pU) === keyVor})`);
  pr('U', zaehlerOk(pU.naechste_id, pNach.naechste_id) && zaehlerOk(pU.naechste_id, pVor.naechste_id) && (pU.naechste_noten_id ?? 0) >= (pNach.naechste_noten_id ?? 0),
    `B-AK3 naechste_id after undo ${JSON.stringify(pU.naechste_id)} is at least the value before the bounce ${JSON.stringify(pVor.naechste_id)} and after it ${JSON.stringify(pNach.naechste_id)}`);
  tor('U', 'B-AK3 export after the undo equals export A', a, await export_(0, 32, 'U-A'));
  await umkehr('redo');
  pr('U', projektSchluessel(await projekt()) === keyNach, 'B-AK3 redo: projektSchluessel equals the key after the bounce');
  // R: Use Whole Lane = comp_waehlen of 'Before bounce' over its hull
  z.punkt = 'R';
  await aendern('B14 R comp_waehlen', [{ befehl: 'comp_waehlen', spur_id: m.K, take_id: r.take_id, von_beat: 0, bis_beat: 28 }], CYPHER);
  await z.geladen();
  tor('R', 'B-AK7 after comp_waehlen of Before bounce over [0,28) the export equals A', a, await export_(0, 32, 'R-B'));
  await umkehr('undo');
  pr('R', projektSchluessel(await projekt()) === keyNach, 'one undo of the comp returns to the bounced state');
  // L: another project, then reopen
  z.punkt = 'L';
  const datei = r.datei, shaDatei = sha256Datei(datei), clip = sp(await projekt(), m.K).clips[0];
  await z.neuesProjekt('b1-andere');
  const o = await z.ruf('POST', '/proj/oeffnen', { slug: m.slug }, CYPHER);
  if (o.code !== 200) throw new Fehl(`/proj/oeffnen ${m.slug} -> ${z.grundVon(o)}`);
  await z.geladen();
  const clip2 = sp(await projekt(), m.K).clips[0];
  tor('L', 'B-AK9 after opening another project and reopening, the export equals export B', b, await export_(0, 32, 'L-B'));
  pr('L', clip2.quelle.sha256 === shaDatei && clip.quelle.sha256 === shaDatei && /bounce\/bounce-[^/]+\.wav$/.test(datei) && datei.includes(m.slug),
    `B-AK9 clip quelle.sha256 ${clip2.quelle.sha256.slice(0, 12)} equals the sha256 of ${path.relative(projektOrdner(m.slug), datei)} on disk (${shaDatei.slice(0, 12)})`);
  // TE: tempo limit, reported (K alone: S muted, no send)
  z.punkt = 'TE';
  await aendern('B14 TE prepare', [{ befehl: 'spur_aendern', spur_id: m.S, mute: true }, { befehl: 'send_setzen', strang_id: m.K, return_id: m.R, db: -200 }], CYPHER);
  const e120 = await export_(0, 8, 'TE-120');
  const spitze = e120.l.reduce((s, x) => Math.max(s, Math.abs(x)), 0), schwelle = 0.5 * spitze, grenze = Math.round(3.6 * SR);
  const on120 = klickOnsets(e120.l, schwelle).filter((f) => f < grenze);
  await aendern('B14 TE tempo 127', [{ befehl: 'tempo_setzen', bpm: 127 }], CYPHER);
  await warte(1500);
  const e127 = await export_(0, 8, 'TE-127');
  const on127 = klickOnsets(e127.l, schwelle).filter((f) => f < grenze);
  const v = onsetsVergleich(on120, on127, 1);
  roh.faelle.TE = { schwelle, on120, on127, vergleich: v };
  if (v.gleich) { gut('TE'); info(`TE tempo limit: the bounced clicks stay at their 120-BPM seconds at 127 BPM: ${v.n_a} onsets, largest deviation ${v.max_abw} sample(s) (expected within +-1)`); }
  else finding('TE', `onsets at 120 ${JSON.stringify(on120)} vs at 127 ${JSON.stringify(on127)}: ${JSON.stringify(v)}`);
}

async function fallB2() {
  const m = await stelleMix('b2-127', 127);
  z.punkt = 'B2';
  const a = await export_(0, 32, 'B2-A'), pVor = await projekt();
  const rb = await bounce({ art: 'an_ort', spur_id: m.K });
  z.erwarte200('B2 POST /proj/bounce an_ort', rb);
  await z.geladen();
  pruefeInPlace('B2', pVor, await projekt(), m, rb.j);
  tor('B2', 'B-AK4 in place at 127 BPM, whole mix before vs after', a, await export_(0, 32, 'B2-B'));
}

// ---- N1 / N2: to new track ----
async function fallNeu(kz, name, o, koerper, text, pruefe, weich = false) {
  const m = await stelleMix(name, 120, o);
  z.punkt = kz;
  const a = await export_(0, 32, `${kz}-A`), pVor = await projekt(), keyVor = projektSchluessel(pVor);
  const rb = await bounce(koerper(m));
  z.erwarte200(`${kz} POST /proj/bounce neue_spur`, rb);
  await z.geladen();
  const pNach = await projekt(), keyNach = projektSchluessel(pNach), neu = sp(pNach, rb.j.spur_id);
  pruefe(m, pVor, pNach, neu, rb.j);
  tor(kz, text, a, await export_(0, 32, `${kz}-B`), '', weich);
  await umkehr('undo');
  pr(kz, projektSchluessel(await projekt()) === keyVor, 'B-AK3 one undo: projektSchluessel equals the key before the bounce');
  await umkehr('redo');
  pr(kz, projektSchluessel(await projekt()) === keyNach, 'B-AK3 redo: projektSchluessel equals the key after the bounce');
}
const fallN1 = () => fallNeu('N1', 'n1', {}, (m) => ({ art: 'neue_spur', spur_ids: [m.K] }), 'B-AK5 to new track with one source, whole mix before vs after',
  (m, pVor, pNach, neu, r) => {
    const k = sp(pNach, m.K), iK = pNach.spuren.findIndex((s) => s.id === m.K);
    pr('N1', k.mute === true && pNach.spuren[iK + 1]?.id === r.spur_id && neu.ausgang?.id === m.G && gleich(neu.sends, k.sends) && neu.clips.length === 1,
      `K is muted (${k.mute}), the new track ${r.spur_id} '${neu.name}' sits right below K (index ${iK + 1}), feeds group ${neu.ausgang?.id} (G ${m.G}), `
      + `has the sends ${JSON.stringify(neu.sends)} (K: ${JSON.stringify(k.sends)}), lanes_verworfen ${r.lanes_verworfen}, hinweis ${r.hinweis ?? 'none'}`);
    pr('N1', Math.abs(neu.clips[0].gain_db - PAN_MITTE_DB) < 1e-6 && neu.fader_db === 0 && neu.pan === 0, `the new clip carries gain_db ${neu.clips[0].gain_db}, fader ${neu.fader_db}, pan ${neu.pan}`);
  });
const pruefeN2 = (kz) => (m, pVor, pNach, neu, r) => {
    pr(kz, sp(pNach, m.K).mute === true && sp(pNach, m.S).mute === true && neu.ausgang?.id === m.G && r.quellen.length === 2 && neu.clips.length === 1,
      `both members are muted, the new track ${r.spur_id} '${neu.name}' feeds group ${neu.ausgang?.id}, sources ${JSON.stringify(r.quellen)}, `
      + `range ${neu.clips[0].start_beat}..${neu.clips[0].start_beat + neu.clips[0].laenge_beats}`);
  };
// N2: S plays clicks (deviation from the plan, whose S is the sine: the sine through the Hall steps to -57 dBFS, cases SENS and SENSS; the plan-literal variant is N2S)
const fallN2 = () => fallNeu('N2', 'n2', { sInGruppe: true, sKlick: true }, (m) => ({ art: 'neue_spur', gruppe_id: m.G }),
  'B-AK5 to new track with gruppe_id of the group with K and S (S plays clicks), whole mix before vs after', pruefeN2('N2'));
// N2S: the plan's own N2 (S = the sine, sends to the Hall): reported against the instrument floor of SENS, not gated
const fallN2S = () => fallNeu('N2S', 'n2s', { sInGruppe: true }, (m) => ({ art: 'neue_spur', gruppe_id: m.G }),
  'N2 with the sine as S (reported, not gated: S steps only through the send to the Hall, see SENSS), whole mix before vs after', pruefeN2('N2S'), true);

// ---- P: paste ----
async function fallP() {
  const m = await stelleMix('p', 120, { send: false, gruppe: false, z: true });
  z.punkt = 'P';
  await aendern('B14 P solo sources', [{ befehl: 'spur_aendern', spur_id: m.K, solo: true }, { befehl: 'spur_aendern', spur_id: m.S, solo: true }], CYPHER);
  const a = await export_(8, 16, 'P-A'), pVor = await projekt(), keyVor = projektSchluessel(pVor);
  const rb = await bounce({ art: 'einfuegen', spur_ids: [m.K, m.S], von_beat: 8, bis_beat: 16, ziel_spur_id: m.Z, ziel_beat: 32 });
  z.erwarte200('P POST /proj/bounce einfuegen', rb);
  await z.geladen();
  const pNach = await projekt(), keyNach = projektSchluessel(pNach), zs = sp(pNach, m.Z), c = zs.clips[0];
  pr('P', zs.clips.length === 1 && c.start_beat === 32 && c.laenge_beats === 8 && Math.abs(c.gain_db - PAN_MITTE_DB) < 1e-6 && zs.fader_db === 0 && zs.pan === 0
    && !zs.ausgang && gleich(sp(pNach, m.K), sp(pVor, m.K)) && gleich(sp(pNach, m.S), sp(pVor, m.S)),
  `Z holds one clip '${c.name}' at beat ${c.start_beat} length ${c.laenge_beats}, gain_db ${c.gain_db}; the sources are unchanged`);
  await umkehr('undo');
  pr('P', projektSchluessel(await projekt()) === keyVor, 'B-AK3 one undo: projektSchluessel equals the key before the paste');
  await umkehr('redo');
  pr('P', projektSchluessel(await projekt()) === keyNach, 'B-AK3 redo: projektSchluessel equals the key after the paste');
  await aendern('B14 P solo target', [{ befehl: 'spur_aendern', spur_id: m.K, solo: false }, { befehl: 'spur_aendern', spur_id: m.S, solo: false },
    { befehl: 'spur_aendern', spur_id: m.Z, solo: true }], CYPHER);
  tor('P', 'B-AK6 solo export of K+S over [8,16) vs solo export of Z over [32,40) after the paste', a, await export_(32, 40, 'P-B'));
}

// ---- T: take lanes untouched and auditionable ----
const takeClip = (id, sha, hinweis, start, laenge, bpm) => ({ id, art: 'audio', name: id, start_beat: start, laenge_beats: laenge, quelle: { sha256: sha, pfad_hinweis: hinweis },
  dekodiert: 'nein', offset_s: start * 60 / bpm, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
async function baueT(bpm) {
  await stoppTransport();
  await z.neuesProjekt('t');
  const slug = z.eigeneSlugs.at(-1);
  await aendern('B14 t tempo', [{ befehl: 'tempo_setzen', bpm }], CYPHER);
  await aendern('B14 t track', [{ befehl: 'spur_neu', art: 'audio', name: 'Vox' }], CYPHER);
  const spurId = (await projekt()).spuren[0].id;
  await aendern('B14 t main', [{ befehl: 'clip_neu', spur_id: spurId, art: 'audio', start_beat: 0, laenge_beats: 64, sha256: SHA['sinus-440'] }], CYPHER);
  const datei = path.join(projektOrdner(slug), 'project.json');
  if (!(await z.bisWahr(async () => fs.existsSync(datei) && JSON.parse(fs.readFileSync(datei, 'utf8')).spuren?.[0]?.clips?.length === 1, 10000))) {
    throw new Fehl(`${datei} does not hold the main clip after 10 s`);
  }
  const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
  let n = j.naechste_id?.clip ?? 100;
  const id = () => `c${n++}`, w = (k) => A.wavs[k];
  j.spuren[0].takes = [
    { id: 't1', name: 'Take 1', clips: [takeClip(id(), w('sinus-440').sha, w('sinus-440').pfad, 0, 64, bpm)] },
    { id: 't2', name: 'Take 2', clips: [takeClip(id(), w('sinus-660').sha, w('sinus-660').pfad, 0, 64, bpm)] },
    { id: 't3', name: 'Take 3', clips: [takeClip(id(), w('sinus-880').sha, w('sinus-880').pfad, 0, 64, bpm)] },
  ];
  j.naechste_id = { ...(j.naechste_id ?? {}), clip: n, take: 4 };
  fs.writeFileSync(datei, JSON.stringify(j));
  const o = await z.ruf('POST', '/proj/oeffnen', { slug }, CYPHER);
  if (o.code !== 200) throw new Fehl(`/proj/oeffnen ${slug} -> ${z.grundVon(o)}`);
  await z.geladen();
  if (!(await z.bisWahr(async () => (await projekt()).spuren[0].takes?.every((t) => t.clips.every((c) => c.dekodiert === 'fertig')) ?? false, 40000))) {
    throw new Fehl(`take clips not decoded after 40 s: ${JSON.stringify((await projekt()).spuren[0].takes?.map((t) => t.clips.map((c) => c.dekodiert)))}`);
  }
  return { spurId, slug };
}
async function fallT() {
  z.punkt = 'T';
  const { spurId } = await baueT(120);
  const pVor = await projekt(), vorTakes = sp(pVor, spurId).takes.map((t) => ({ ...t, clips: t.clips.map(ohneDek) }));
  const rb = await bounce({ art: 'an_ort', spur_id: spurId });
  z.erwarte200('T POST /proj/bounce an_ort', rb);
  await z.geladen();
  const pNach = await projekt(), s = sp(pNach, spurId), nachTakes = s.takes.map((t) => ({ ...t, clips: t.clips.map(ohneDek) }));
  pr('T', s.takes.length === 4 && gleich(nachTakes.slice(0, 3), vorTakes) && s.takes[3].name === 'Before bounce' && s.clips.length === 1,
    `B-AK8 the three takes are deep-equal after the in-place bounce (${s.takes.length} lanes now: ${s.takes.map((t) => t.name).join(', ')})`);
  const mitschnitt = path.join(BAU, 'cypherdj-mitschnitt');
  if (!fs.existsSync(mitschnitt)) { npb('T/Gehoer', `${mitschnitt} does not exist (no recorder)`); return; }
  const FREQ = [440, 660], t = {};
  const aufn = await nimmAuf('t', 14, async () => {
    t.start = Date.now(); await transport('start', 0);
    await warte(3000);
    t.an = Date.now(); t.rAn = await z.ruf('POST', '/proj/take_vorhoeren', { spur_id: spurId, take_id: 't2' }, CYPHER);
    await warte(4000);
    t.aus = Date.now(); t.rAus = await z.ruf('POST', '/proj/take_vorhoeren', { spur_id: spurId, take_id: null }, CYPHER);
    await warte(3000);
  });
  await transport('stopp');
  const { x, n } = aufn, ms = (sek) => Math.round(sek * SR);
  pr('T', t.rAn.code === 200 && t.rAus.code === 200, `audition on/off accepted: ${z.grundVon(t.rAn)} / ${z.grundVon(t.rAus)}`);
  const frT = (wall) => Math.max(0, Math.min(n - 1, Math.round(n - (aufn.tEnd - wall) * SR / 1000)));
  const wf1 = wechselFrame(x, frT(t.an - 300), n, FREQ[0], FREQ[1]), wf2 = wf1 < 0 ? -1 : wechselFrame(x, wf1 + ms(1), n, FREQ[1], FREQ[0]);
  roh.faelle.T = { wf1, wf2, n, latenz_an_ms: wf1 < 0 ? null : latenzMs(wf1, n, aufn.tEnd, t.an), latenz_aus_ms: wf2 < 0 ? null : latenzMs(wf2, n, aufn.tEnd, t.aus) };
  if (wf1 < 0 || wf2 < 0) { pr('T', false, `the recording shows both changes: to take 2 at frame ${wf1}, back to the main lane at ${wf2}`); return; }
  const k = (von, f) => korrelation(x, von, Math.min(ms(2), n - von), f);
  const kVor = k(wf1 - ms(2.3), FREQ[0]), k660 = k(wf1 + ms(0.5), FREQ[1]), k440 = k(wf1 + ms(0.5), FREQ[0]), kNach = k(wf2 + ms(0.5), FREQ[0]);
  Object.assign(roh.faelle.T, { kor_vor_440: kVor, kor_mit_660: k660, kor_mit_440: k440, kor_nach_440: kNach });
  pr('T', kVor >= 0.99, `control: before the audition the bounced main lane sounds (correlation with 440 Hz ${kVor.toFixed(4)})`);
  pr('T', k660 >= 0.99, `B-AK8 the audition of take 2 plays 660 Hz: correlation ${k660.toFixed(4)} (>= 0.99)`);
  pr('T', k440 <= 0.5, `B-AK8 the audition does not play the main lane: correlation with 440 Hz ${k440.toFixed(4)} (<= 0.5)`);
  pr('T', kNach >= 0.99, `after switching the audition off the bounced main lane is back (correlation with 440 Hz ${kNach.toFixed(4)})`);
}

// ---- V: freshness ----
async function fallV() {
  z.punkt = 'V';
  await stoppTransport();
  await z.neuesProjekt('v');
  const slug = z.eigeneSlugs.at(-1);
  await aendern('B14 v tempo', [{ befehl: 'tempo_setzen', bpm: 120 }], CYPHER);
  await aendern('B14 v track', [{ befehl: 'spur_neu', art: 'audio', name: 'V' }], CYPHER);
  const V = (await projekt()).spuren[0].id;
  await aendern('B14 v clip', [{ befehl: 'clip_neu', spur_id: V, art: 'audio', start_beat: 0, laenge_beats: 512, sha256: SHA['sinus-220'], name: 'lang' }], CYPHER);
  await z.geladen();
  const clipId = sp(await projekt(), V).clips[0].id, vorher = bounceDateien(slug).length;
  const t0 = Date.now();
  const lauf = bounce({ art: 'an_ort', spur_id: V });
  await warte(300);
  const c = await z.aendernRoh('B14 V change during the bounce', [{ befehl: 'clip_aendern', clip_id: clipId, gain_db: -1 }], CYPHER);
  const rb = await lauf, dt = Date.now() - t0;
  roh.faelle.V = { aendern_code: c.code, bounce_code: rb.code, bounce_fehler: rb.j?.fehler ?? null, ms: dt };
  if (rb.code === 200) { npb('V', `the 512-beat bounce answered 200 after ${dt} ms, before the change could land (change answered ${c.code}); not a freshness proof`); return; }
  pr('V', c.code === 200 && rb.code === 409 && rb.j?.fehler === 'veraltet' && bounceDateien(slug).length === vorher,
    `B-AK12 clip_aendern 300 ms after the POST (answered ${c.code}): bounce ${z.grundVon(rb)} after ${dt} ms, files in bounce/ ${vorher} -> ${bounceDateien(slug).length} (${bounceDateien(slug).join(',') || 'none'})`);
  const pn = await projekt();
  pr('V', sp(pn, V).clips.length === 1 && sp(pn, V).clips[0].gain_db === -1 && !sp(pn, V).takes?.length, 'the project holds the change and no Before bounce lane');
}

// ---- NK2..NK6: refusals ----
async function fallNK() {
  z.punkt = 'NK';
  await stoppTransport();
  await z.neuesProjekt('nk');
  const slug = z.eigeneSlugs.at(-1);
  await aendern('B14 nk tempo', [{ befehl: 'tempo_setzen', bpm: 120 }], CYPHER);
  await aendern('B14 nk track by Andreas', [{ befehl: 'spur_neu', art: 'audio', name: 'AND' }], {});          // no source header: a track of Andreas
  await aendern('B14 nk tracks', [{ befehl: 'spur_neu', art: 'audio', name: 'Q' }, { befehl: 'spur_neu', art: 'audio', name: 'SIL' },
    { befehl: 'spur_neu', art: 'instrument', name: 'RB', geraet: { art: 'intern' } }], CYPHER);
  const p1 = await projekt(), id = (n) => p1.spuren.find((s) => s.name === n).id, AND = id('AND'), Q = id('Q'), SIL = id('SIL'), RB = id('RB');
  pr('NK3', p1.spuren.find((s) => s.name === 'AND').von === 'andreas' && p1.spuren.find((s) => s.name === 'Q').von === 'cypher',
    `set-up: track AND is 'von: ${p1.spuren.find((s) => s.name === 'AND').von}', Q is '${p1.spuren.find((s) => s.name === 'Q').von}'`);
  const clip = (spur_id, sha, name) => ({ befehl: 'clip_neu', spur_id, art: 'audio', start_beat: 0, laenge_beats: 8, sha256: sha, name });
  await aendern('B14 nk clip AND (Andreas)', [clip(AND, SHA['sinus-220'], 'and')], {});
  await aendern('B14 nk clips', [clip(Q, SHA['sinus-220'], 'q'), clip(SIL, SHA.stille, 'stille'),
    { befehl: 'clip_neu', spur_id: RB, art: 'midi', start_beat: 0, laenge_beats: 8, noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }, { beat: 2, laenge: 1, ton: 43, vel: 100 }] }], CYPHER);
  await z.geladen();
  // a refusal: the answer, the rev and the files of bounce/ stay as they were
  const verweigert = async (kz, text, koerper, fehler) => {
    const rev0 = await z.holeRev(), dat0 = bounceDateien(slug).join(','), r = await bounce(koerper), rev1 = await z.holeRev(), dat1 = bounceDateien(slug).join(',');
    pr(kz, r.code === 409 && r.j?.fehler === fehler && rev0 === rev1 && dat0 === dat1,
      `${text}: ${z.grundVon(r)} (expected 409 ${fehler}), rev ${rev0} -> ${rev1}, bounce/ ${dat0 || 'empty'} -> ${dat1 || 'empty'}`);
  };
  await verweigert('NK2', 'B-AK10 a silent range (only clip is stille.wav), an_ort', { art: 'an_ort', spur_id: SIL }, 'merge_leer');
  await verweigert('NK3', 'B-AK10 Cypher on a track of Andreas, an_ort', { art: 'an_ort', spur_id: AND }, 'merge_andreas_spur');
  await verweigert('NK5', 'B-AK10 an_ort on the RB-338 instrument track', { art: 'an_ort', spur_id: RB }, 'bounce_nur_audio');
  await verweigert('NK6', 'B-AK10 einfuegen onto the instrument track', { art: 'einfuegen', spur_ids: [Q], von_beat: 0, bis_beat: 8, ziel_spur_id: RB, ziel_beat: 0 }, 'bounce_ziel_art');
  await transport('start', 0);
  await warte(500);
  await verweigert('NK4', 'B-AK10 transport running, an_ort', { art: 'an_ort', spur_id: Q }, 'transport_laeuft');
  await transport('stopp');
  await warte(500);
  // controls with harmless input: the same calls without the fault succeed
  const rq = await bounce({ art: 'an_ort', spur_id: Q });
  pr('NK2', rq.code === 200, `control: an_ort on the track Q with a sine and the transport stopped answers ${z.grundVon(rq)} (so NK2, NK4, NK5 were refused for their reason)`);
  const ra = await bounce({ art: 'an_ort', spur_id: AND }, {});
  pr('NK3', ra.code === 200, `control: the same bounce of the track of Andreas without the Cypher header (as Andreas) answers ${z.grundVon(ra)}`);
  const rp = await bounce({ art: 'einfuegen', spur_ids: [Q], von_beat: 0, bis_beat: 8, ziel_spur_id: SIL, ziel_beat: 16 });
  pr('NK6', rp.code === 200, `control: einfuegen onto the audio track SIL answers ${z.grundVon(rp)}`);
}

// ---- K: cost ----
async function fallK() {
  z.punkt = 'K';
  const m = await stelleMix('k', 120, { lang: true });
  const vor = cacheListe(), t0 = Date.now();
  const rb = await bounce({ art: 'an_ort', spur_id: m.K });
  const dt = Date.now() - t0;
  z.erwarte200('K POST /proj/bounce an_ort', rb);
  await z.geladen();
  const wav = fs.statSync(rb.j.datei).size, sha = sha256Datei(rb.j.datei), nach = cacheListe();
  // growth = the files that are new AND named after this bounce WAV; any other new file belongs to a foreign test on the shared cache and is only listed
  const neu = [...nach.keys()].filter((f) => !vor.has(f)), eigene = neu.filter((f) => f.startsWith(sha)), fremd = neu.filter((f) => !f.startsWith(sha));
  const zuwachs = eigene.reduce((x, f) => x + nach.get(f), 0);
  roh.faelle.K = { render_ms: dt, sha: sha, cache_eigene_dateien: eigene, cache_zuwachs: zuwachs, cache_fremde_neue_dateien: fremd, wav_bytes: wav, frames: rb.j.frames, beats: 64 };
  info(`K cost (reported, no gate): a 64-beat in-place bounce took ${dt} ms wall time (POST to answer), ${rb.j.frames} frames; the WAV is ${wav} bytes; `
    + `the decode cache ${cacheOrdner} grew by ${zuwachs} bytes in ${eigene.length} file(s) named after the bounce sha ${sha.slice(0, 12)} (${eigene.join(', ') || 'none'}); `
    + `${fremd.length} other new file(s) from foreign writers not counted${fremd.length ? ` (${fremd.join(', ')})` : ''}`);
  if (eigene.length) gut('K'); else npb('K', `no new decode-cache file named after the bounce sha ${sha.slice(0, 12)} appeared; the cache growth figure is not available (the wall time is)`);
}

// ---- run ----
// N2D (diagnosis, not in the plan): N2 without the return and its sends, to tell a send/Hall effect from a group-sum effect
const fallN2D = () => fallNeu('N2D', 'n2d', { sInGruppe: true, send: false }, (m) => ({ art: 'neue_spur', gruppe_id: m.G }),
  'diagnosis: to new track with gruppe_id, K and S in G, no return and no sends, whole mix before vs after', () => {});
// N2B (diagnosis, review U5b finding 2): S alone with its send to the Hall, to new track. Reported like N2S, not gated.
const fallN2B = () => fallNeu('N2B', 'n2b', { sInGruppe: true }, (m) => ({ art: 'neue_spur', spur_ids: [m.S] }),
  'diagnosis: S (the sine) alone, in G, with its send, to new track, whole mix before vs after', () => {}, true);
// REP (review U6 finding 1, control for SENS/SENSS): is the mix "sine S with a send to the Hall" (the mix of SENS, N2S) repeatable at all? The SENS mix is exported
// three times without any change (2 and 3 are nulled against 1), then S gets +1e-2 dB and the exact base value back (the same two aendern calls a SENS step
// makes, but ending at the original state) and is exported a fourth time. Only if all three differences are below the gate can the -57 dBFS of SENS be called
// a sensitivity of the Hall; if untouched exports already differ, it is render-to-render non-determinism and the SENS steps say nothing about eps.
async function fallRep() {
  const m = await stelleMix('rep', 120, { sInGruppe: true });
  const sc = sp(await projekt(), m.S).clips[0].id;
  const a = await export_(0, 32, 'REP-A'), a2 = await export_(0, 32, 'REP-A2'), a3 = await export_(0, 32, 'REP-A3');
  await aendern('B14 rep S +eps', [{ befehl: 'clip_aendern', clip_id: sc, gain_db: 1e-2 }], CYPHER);
  await aendern('B14 rep S back to base', [{ befehl: 'clip_aendern', clip_id: sc, gain_db: 0 }], CYPHER);
  const a4 = await export_(0, 32, 'REP-REVERT');
  const d2 = nullDifferenz(a.l, a2.l), d3 = nullDifferenz(a.l, a3.l), d4 = nullDifferenz(a.l, a4.l);
  const d2r = nullDifferenz(a.r, a2.r), d3r = nullDifferenz(a.r, a3.r), d4r = nullDifferenz(a.r, a4.r);
  const peaks = { zweiter: Math.max(d2.spitze_db, d2r.spitze_db), dritter: Math.max(d3.spitze_db, d3r.spitze_db), hinUndZurueck: Math.max(d4.spitze_db, d4r.spitze_db) };
  const zu = wiederholbarkeit(peaks, NULL_TOR_DB);
  roh.faelle.REP = { l: { zweiter: d2, dritter: d3, hinUndZurueck: d4 }, r: { zweiter: d2r, dritter: d3r, hinUndZurueck: d4r }, peaks_db: peaks, zuordnung: zu, regler_quelle: [a.regler_quelle, a2.regler_quelle, a3.regler_quelle, a4.regler_quelle] };
  info(`REP sine + send mix, no change: export 2 vs 1 L ${ms2(d2.spitze_db)} / R ${ms2(d2r.spitze_db)} dBFS, export 3 vs 1 L ${ms2(d3.spitze_db)} / R ${ms2(d3r.spitze_db)} dBFS, `
    + `change-and-revert vs 1 L ${ms2(d4.spitze_db)} / R ${ms2(d4r.spitze_db)} dBFS (gate ${NULL_TOR_DB}): ${zu.urteil}`);
  if (zu.urteil === 'WIEDERHOLBAR') gut('REP');
  else if (zu.urteil === 'NICHT_GEMESSEN') npb('REP', zu.grund);
  else finding('REP', `${zu.urteil}: ${zu.grund}`, zu.urteil === 'NICHT_WIEDERHOLBAR' ? undefined : `the sine + Hall-send mix differs after a change-and-revert of S: ${zu.grund}`);
}
// SENS (diagnosis, not in the plan): how far does the Hall amplify a tiny change of the input? S (or K) gets a clip gain of a few micro-dB, the export is compared with
// the unchanged one. If 1e-6 dB already gives a peak far above -90 dBFS, a null test through this Hall cannot reach the gate for that material, whatever the bounce does.
async function fallSens() {
  const m = await stelleMix('sens', 120, { sInGruppe: true });
  const sc = sp(await projekt(), m.S).clips[0].id, kc0 = m.kc[0], g0k = -4;
  const a = await export_(0, 32, 'SENS-A');
  for (const [wer, id, basis] of [['S', sc, 0], ['K', kc0, g0k]]) {
    for (const eps of [1e-6, 1e-4, 1e-2]) {
      await aendern(`B14 sens ${wer} ${eps}`, [{ befehl: 'clip_aendern', clip_id: id, gain_db: basis + eps }], CYPHER);
      const b = await export_(0, 32, `SENS-${wer}-${eps}`);
      const dl = nullDifferenz(a.l, b.l);
      info(`SENS ${wer} clip gain + ${eps} dB: peak of the difference L ${ms2(dl.spitze_db)} dBFS (rms ${ms2(dl.rms_db)})`);
      roh.faelle.SENS = { ...(roh.faelle.SENS ?? {}), [`${wer}_${eps}`]: dl };
    }
    await aendern(`B14 sens ${wer} reset`, [{ befehl: 'clip_aendern', clip_id: id, gain_db: basis }], CYPHER);
  }
  gut('SENS');
}
// SENSS (review U5b finding 2): is the -57 dBFS step of S the Hall or the gain path of the clip? S gets +eps dB on top of a base gain, in four set-ups:
// with / without the return and its sends (the Hall), base gain 0 dB / -1 dB (a discontinuity at exactly 0 dB would not follow the base). The attribution
// is decided by sensZuordnung() from the 1e-6 dB step: HALL only if S without a send stays smooth and S with the send steps, at both bases.
async function fallSensS() {
  const peaks = {}, alle = {};
  for (const [send, sendName] of [[false, 'ohneSend'], [true, 'mitSend']]) {
    for (const basis of [0, -1]) {
      const kz = `${sendName}Basis${basis === 0 ? '0' : 'M1'}`;
      const m = await stelleMix(`senss-${send ? 's' : 'o'}${basis === 0 ? '0' : 'm1'}`, 120, { sInGruppe: true, send });
      const id = sp(await projekt(), m.S).clips[0].id;
      if (basis !== 0) await aendern(`B14 senss ${kz} base`, [{ befehl: 'clip_aendern', clip_id: id, gain_db: basis }], CYPHER);
      const a = await export_(0, 32, `SENSS-${kz}-A`);
      for (const eps of [1e-6, 1e-4, 1e-2]) {
        await aendern(`B14 senss ${kz} ${eps}`, [{ befehl: 'clip_aendern', clip_id: id, gain_db: basis + eps }], CYPHER);
        const dl = nullDifferenz(a.l, (await export_(0, 32, `SENSS-${kz}-${eps}`)).l);
        info(`SENSS S ${send ? 'with' : 'without'} send, base ${basis} dB, +${eps} dB: peak of the difference L ${ms2(dl.spitze_db)} dBFS (rms ${ms2(dl.rms_db)})`);
        (alle[kz] ??= {})[eps] = dl;
        if (eps === 1e-6) peaks[kz] = dl.spitze_db;
      }
    }
  }
  const zu = sensZuordnung(peaks, NULL_TOR_DB);
  roh.faelle.SENSS = { peaks_1e6_db: peaks, alle, zuordnung: zu };
  if (zu.urteil === 'HALL') { gut('SENSS'); info(`SENSS attributed to the Hall (S steps only through the send, at base 0 and -1 dB): ${zu.grund}`); }
  else if (zu.urteil === 'GAIN_PFAD') finding('SENSS', `gain-path suspect: ${zu.grund}`, `S steps without any send: a gain-path finding that goes back to the owning unit (${zu.grund})`);
  else finding('SENSS', `not isolated: ${zu.grund}`, `the S step could not be attributed to the Hall (${zu.grund})`);
}
const FAELLE = [['B1', fallB1], ['B2', fallB2], ['N1', fallN1], ['N2', fallN2], ['N2D', fallN2D], ['N2S', fallN2S], ['N2B', fallN2B], ['REP', fallRep], ['SENS', fallSens], ['SENSS', fallSensS], ['P', fallP], ['T', fallT], ['V', fallV], ['NK', fallNK], ['K', fallK]];
async function lauf() {
  for (const k of ['klick-120', 'sinus-220', 'sinus-440', 'sinus-660', 'sinus-880', 'stille']) if (!A.wavs?.[k]) throw new Fehl(`aufbau.json: wavs.${k} missing`);
  for (const [name, f] of FAELLE) {
    if (NUR && !NUR.has(name)) continue;
    z.punkt = name;
    info(`==== case ${name} ====`);
    try { await f(); } catch (e) {
      await stoppTransport();
      if (e instanceof Fehl) pr(z.punkt, false, e.message); else pr(z.punkt, false, `ABORT: ${e.stack ?? String(e)}`);
    }
  }
}
const t0 = Date.now();
await lauf();
await stoppTransport();
// own projects out (only slugs of this script), report
const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');
for (const slug of z.eigeneSlugs) {
  const d = path.join(wurzel, slug);
  if (!/^b14-[a-z0-9-]+-\d{8}t\d{6}/i.test(slug)) { info(`slug ${slug} is not from this script, not deleted`); continue; }
  try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); info(`project ${d} deleted`); } else info(`project ${d} not found`); } catch (e) { notiere('cleanup', false, e.message); }
}
const TABELLE = [['N0', 'B-AK11', 'the same full export twice'], ['NK1', 'B-AK11', 'B shifted by one sample / B at -3.0103 dB'], ['B1', 'B-AK2, B-AK4', 'in place at 120 BPM'],
  ['B2', 'B-AK4', 'in place at 127 BPM'], ['U', 'B-AK3', 'undo and redo'], ['R', 'B-AK7', 'restore through Use Whole Lane'], ['L', 'B-AK9', 'reload'],
  ['N1', 'B-AK5', 'to new track, one source'], ['N2', 'B-AK5', 'to new track, gruppe_id (S = clicks, SUBSTITUTED for the plan sine)'], ['N2D', 'B-AK5', 'diagnosis: gruppe_id without sends'],
  ['N2S', 'B-AK5', 'PLAN-LITERAL N2 (S = sine, sends to the Hall), gate not met if FINDING'], ['N2B', 'B-AK5', 'diagnosis: S alone with its send'],
  ['REP', 'B-AK11', 'control: sine + Hall-send mix exported repeatedly without change'], ['SENS', 'B-AK11', 'Hall sensitivity (instrument)'], ['SENSS', 'B-AK11', 'diagnosis: S step with / without send, base 0 / -1 dB'],
  ['P', 'B-AK6', 'paste'], ['T', 'B-AK8', 'take lanes and audition'],
  ['V', 'B-AK12', 'freshness'], ['NK2', 'B-AK10', 'silent range'], ['NK3', 'B-AK10', 'track of Andreas'], ['NK4', 'B-AK10', 'transport running'],
  ['NK5', 'B-AK10', 'an_ort on an instrument track'], ['NK6', 'B-AK10', 'einfuegen onto an instrument track'], ['TE', 'B-AK13', 'tempo limit (reported)'], ['K', 'B-AK14', 'cost (reported)']];
const ende = schluss(ergebnis, z.fehl, findings);
fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), `${JSON.stringify({ zeit: z.zeit, url: z.URL, instanz, aufbau: A, schwelle_db: NULL_TOR_DB, lock_wait_s: process.env.B14_LOCK_WAIT_S ?? null,
  kopfzeile: ende.text, nicht_pruefbar: nichtPruefbar, findings, ergebnis, roh }, null, 1)}\n`);
if (!z.opt['wav-behalten']) for (const f of exportNamen) fs.rmSync(path.join(z.ORDNER, f), { force: true });
const kopf = `# Acceptance B14 slice 4 bounce ${z.zeit} (${z.URL}, instance ${instanz})\n\n**Result: ${ende.text}**\n\n`
  + `Lock wait of the wrapper: ${process.env.B14_LOCK_WAIT_S ?? 'unknown (not started through the wrapper)'} s; `
  + `script duration ${Math.round((Date.now() - t0) / 1000)} s; core ${JSON.stringify(roh.kern ?? null)}.\n\n${tabelle(TABELLE, ergebnis)}\n`;
fs.writeFileSync(path.join(z.ORDNER, 'bericht.md'), `${kopf}${z.zeilen.join('\n')}\n\n${ende.text}\n`);
process.stdout.write(`\n${ende.text}\nreport ${path.join(z.ORDNER, 'bericht.md')}\n`);
process.exit(ende.exit);
