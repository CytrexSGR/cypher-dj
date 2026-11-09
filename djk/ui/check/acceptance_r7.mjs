// Acceptance 1.10 slice 7 (resample, AK16, and AK18 in full form) on the real core of a TEST INSTANCE (never a, f, g, h, i, never the live studio).
// Test signals only: sine audio clips, no instrument. Call order (the catalog must exist before the page server starts):
//   1  node check/acceptance_r7.mjs --nur-material --material /dev/shm/r7-ziel
//   2  CYPHERDJ_KATALOG=/dev/shm/r7-ziel/katalog.sqlite DJK=<worktree>/djk <worktree>/djk/start/djk-start --instanz e --arr1      (silent)
//   3  node check/acceptance_r7.mjs --url http://127.0.0.1:52300 --material /dev/shm/r7-ziel --bau <core build dir> [--ausgabe <dir>]
// AK16  a group of two sines (no sends, PM 0 dB), loop 8 bars at 120 BPM:
//   A1  resample of the group, point post: frames == 768000 exactly, the new track sits in the project
//   A2  the WAV equals the offline export (abgriff produktion) of the same project below -90 dBFS (no iso_ref: the group has no sends and PM 0 dB, so the PM
//       tap IS the group signal and the isolator of erz/4 is not in the path)
//   A3  counter-check: the same WAV one sample late is above -90 dBFS (the instrument resolves one sample)
//   A4  the new track alone (sources muted) exports within the null threshold of the merge acceptance (acceptance_w7.mjs, NULL_TOR_DB), the number is reported
//   A5  one undo removes track and clip, the WAV stays on disk
//   A6  error case: a muted source gives 409 resample_leer, no track, no file left behind
// AK18 full  hot project (8 tracks at +6 dB, master +6 dB):
//   B1  limiter_db of proj_lage (kern.limiter_db) is below 0 during hot playback; negative control: 0 with quiet material
//   B2  export produktion: ueber_decke true; export set: ueber_decke false and the peak at or below limiter_dbtp
//   B3  resample of the master (strang_id master, tap kind pm) post: peak above 0 dBFS, equals the produktion export below -90 dBFS
//   B4  counter-check: the same WAV one sample late is above -90 dBFS, and the WAV does NOT equal the set export (a tap behind the limiter would)
// Exit 0 all OK, 1 at least one FEHL, 2 call error. Cleans only its own projects (slug r7-...).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { starte, Fehl } from './w3a_target.mjs';
import { leseWav, schreibeWav } from './w1_wav.mjs';
import { sinusQuelle } from './c14_measure.mjs';
import { baueKatalog } from '../tests/support/catalog.mjs';
import { NULL_TOR_DB, nullDifferenz, nullOk, standSchluessel } from './w7_measure.mjs';

const SR = 48000, FREQ = [440, 660], AMPLITUDE = 0.3, PHASE = 0.7, DAUER_S = 20, BPM = 120, LOOP_BEATS = 32;
const FRAMES_SOLL = LOOP_BEATS * 60 / BPM * SR;                    // 768000
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

// ---- material: two sines (amplitude 0.3, start phase 0.7 rad, identical in both channels) and a catalog; sha = the real sha256 of the file
function baueMaterial(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const zeilen = FREQ.map((f, i) => {
    const pfad = path.join(dir, `sinus-${f}.wav`), q = sinusQuelle(f, AMPLITUDE, PHASE), ton = new Float32Array(2 * DAUER_S * SR);
    for (let k = 0; k < DAUER_S * SR; k++) ton[2 * k] = ton[2 * k + 1] = q(k);
    schreibeWav(pfad, ton);
    const sha = createHash('sha256').update(fs.readFileSync(pfad)).digest('hex');
    return { n: i + 1, sha, shas: sha, typ: 'track', werk_id: i + 1, titel: `R7 sine ${f}`, bpm: BPM, dauer_s: DAUER_S, pfad };
  });
  const katalog = baueKatalog(dir, zeilen);
  const aus = { katalog, sha: zeilen.map((z) => z.sha), pfad: zeilen.map((z) => z.pfad), freq: FREQ };
  fs.writeFileSync(path.join(dir, 'aufbau.json'), JSON.stringify(aus));
  return aus;
}
if (process.argv.includes('--nur-material')) {
  const dir = arg('material');
  if (!dir) { process.stderr.write('abnahme_r7: usage: --nur-material --material <dir>\n'); process.exit(2); }
  if (fs.existsSync(path.join(dir, 'katalog.sqlite'))) { process.stderr.write(`abnahme_r7: ${dir}/katalog.sqlite exists already, left as it is\n`); process.exit(0); }
  process.stdout.write(`${JSON.stringify(baueMaterial(path.resolve(dir)))}\n`);
  process.exit(0);
}

const z = starte('abnahme_r7', 'r7', { material: { type: 'string' }, bau: { type: 'string' } }, { ohneAufbau: true });
if (/^[afghi]$/.test(z.instanz)) { process.stderr.write(`abnahme_r7: instance ${z.instanz} is not allowed: a, f, g, h, i are taboo\n`); process.exit(2); }
// the lock as in abnahme_r5: the instance letter of --instanz must agree with the letter of the --url port (47300 + 1000 x k)
{
  const port = Number(new globalThis.URL(z.URL).port), k = (port - 47300) / 1000;
  const aus = Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined;
  if (!aus || aus !== z.instanz) { process.stderr.write(`abnahme_r7: --instanz ${z.instanz} does not match the port ${port} (instance ${aus ?? '?'})\n`); process.exit(2); }
}
if (!z.opt.material || !fs.existsSync(path.join(z.opt.material, 'aufbau.json'))) {
  process.stderr.write('abnahme_r7: --material <dir> missing or without aufbau.json (run --nur-material first, then start the instance with CYPHERDJ_KATALOG)\n');
  process.exit(2);
}
const MAT = JSON.parse(fs.readFileSync(path.join(z.opt.material, 'aufbau.json'), 'utf8'));
const BAU = z.opt.bau ? path.resolve(z.opt.bau) : null;
const { notiere, info, CYPHER, aendern, aktuell, fmt } = z;
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const spitzeLin = (x) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; };
const spaet = (x, n = 1) => { const y = new Float32Array(x.length); y.set(x.subarray(0, x.length - n), n); return y; };   // delayed by n samples
const nd = (a, b) => ({ l: nullDifferenz(a.l, b.l), r: nullDifferenz(a.r, b.r) });
const nullText = (d) => (d.l.ok && d.r.ok ? `L ${fmt(d.l.spitze_db)} dBFS, R ${fmt(d.r.spitze_db)} dBFS` : `length differs (${d.l.frames_a} vs ${d.l.frames_b} frames)`);
const ok2 = (d) => nullOk(d.l) && nullOk(d.r);
const gross2 = (d) => d.l.ok && d.r.ok && d.l.spitze_db > NULL_TOR_DB && d.r.spitze_db > NULL_TOR_DB;
const roh = { punkte: {} };

async function exportiere(von, bis, abgriff, name) {
  await z.geladen();
  const r = z.erwarte200('/proj/export', await z.ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis, abgriff }, CYPHER)).j;
  const datei = path.join(z.ORDNER, `${name}.wav`);
  fs.copyFileSync(r.datei, datei);
  return { ...leseWav(datei), antwort: r };
}
const resample = (koerper) => z.ruf('POST', '/proj/resample', koerper, CYPHER);
const stoppeUndWarte = async () => {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  if (!(await z.bisWahr(async () => (await aktuell()).kern?.status === 0, 15000))) throw new Fehl('the transport did not stop');
};
// limiter_db of proj_lage (GET /proj/aktuell kern.limiter_db) while the project plays: 2 s to settle, then 30 reads over 3 s
async function limiterWerte() {
  const r = await z.ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  if (r.code !== 200) throw new Fehl(`/proj/transport start -> ${z.grundVon(r)}`);
  try {
    await z.warte(2000);
    const w = [];
    for (let i = 0; i < 30; i++) { w.push((await aktuell()).kern?.limiter_db); await z.warte(100); }
    return w;
  } finally { await stoppeUndWarte(); }
}
const sineClip = (spurId, k) => ({ befehl: 'clip_neu', spur_id: spurId, art: 'audio', start_beat: 0, laenge_beats: LOOP_BEATS, sha256: MAT.sha[k] });

async function ak16() {
  z.punkt = 'AK16';
  await z.neuesProjekt('ak16');
  await z.setzeTempo(BPM);
  await aendern('R7 ak16 tracks', [{ befehl: 'spur_neu', art: 'audio', name: 'Sine 440' }, { befehl: 'spur_neu', art: 'audio', name: 'Sine 660' }], CYPHER);
  const [t1, t2] = (await aktuell()).projekt.spuren.map((s) => s.id);
  await aendern('R7 ak16 clips, group, loop', [sineClip(t1, 0), sineClip(t2, 1), { befehl: 'gruppenspur_neu', name: 'Pair', mitglieder: [t1, t2] },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: LOOP_BEATS }], CYPHER);
  const g = (await aktuell()).projekt.gruppen[0].id;
  info(`AK16 set-up: tracks ${t1}, ${t2} in group ${g}, loop 0..${LOOP_BEATS} at ${BPM} BPM, no sends, group and PM fader 0 dB`);
  const A = await exportiere(0, LOOP_BEATS, 'produktion', 'ak16-export-produktion');
  const p0 = (await aktuell()).projekt, key0 = standSchluessel(p0), rev0 = p0.rev;

  // A1, A2, A3: resample of the group over the loop bracket (no range given: the default is the loop)
  const r1 = await resample({ strang_id: g, punkt: 'post' });
  const rj = r1.j;
  notiere('A1 resample of the group, post: exactly 768000 frames, new track and clip in the project',
    r1.code === 200 && rj.frames === FRAMES_SOLL && fs.existsSync(rj.datei ?? '') && !!rj.spur_id && !!rj.clip_id,
    r1.code === 200 ? `frames ${rj.frames} (expected ${FRAMES_SOLL}), track ${rj.spur_id}, clip ${rj.clip_id}, file ${rj.datei}` : `refused: ${z.grundVon(r1)}`);
  let R = null;
  if (r1.code === 200) {
    const kopie = path.join(z.ORDNER, 'ak16-resample-gruppe.wav');
    fs.copyFileSync(rj.datei, kopie);
    R = leseWav(kopie);
    const d = nd(A, R);
    notiere('A2 the resample WAV equals the offline export (produktion) below -90 dBFS', ok2(d), `${nullText(d)}; frames export ${A.frames}, WAV ${R.frames}`);
    const ds = nd(A, { l: spaet(R.l), r: spaet(R.r) });
    notiere('A3 counter-check: the WAV one sample late is above -90 dBFS', gross2(ds), nullText(ds));
    roh.punkte.A2 = { d, ds };
  } else {
    notiere('A2 the resample WAV equals the offline export (produktion) below -90 dBFS', false, 'not run: no resample');
    notiere('A3 counter-check: the WAV one sample late is above -90 dBFS', false, 'not run: no resample');
  }

  // A5: one undo removes track and clip; the WAV stays
  if (r1.code === 200) {
    z.erwarte200('/proj/undo', await z.ruf('POST', '/proj/undo', { rev: await z.holeRev() }));
    const p1 = (await aktuell()).projekt;
    notiere('A5 one undo removes track and clip (state as before the resample), the WAV stays on disk',
      standSchluessel(p1) === key0 && !p1.spuren.some((s) => s.id === rj.spur_id) && fs.existsSync(rj.datei),
      `tracks ${p1.spuren.length} (before ${p0.spuren.length}), WAV exists ${fs.existsSync(rj.datei)}`);
  } else notiere('A5 one undo removes track and clip (state as before the resample), the WAV stays on disk', false, 'not run: no resample');

  // A4: the new track alone. Sources muted, export produktion against the export of the full project
  const r2 = await resample({ strang_id: g, punkt: 'post' });
  if (r2.code === 200) {
    await aendern('R7 ak16 mute sources', [t1, t2].map((id) => ({ befehl: 'spur_aendern', spur_id: id, mute: true })), CYPHER);
    const B = await exportiere(0, LOOP_BEATS, 'produktion', 'ak16-export-neue-spur-allein');
    const d = nd(A, B);
    notiere(`A4 the new track alone (sources muted) exports within the null threshold of the merge acceptance (abnahme_w7, ${NULL_TOR_DB} dBFS)`, ok2(d),
      `${nullText(d)}; threshold ${NULL_TOR_DB} dBFS; frames export ${A.frames}, new track ${B.frames}`);
    roh.punkte.A4 = d;
  } else notiere('A4 the new track alone (sources muted) exports within the null threshold of the merge acceptance (abnahme_w7)', false, `not run: second resample refused: ${z.grundVon(r2)}`);

  // A6: all sources muted -> resample_leer, nothing added, no file left
  const ordner = path.join('/dev/shm', `cypherdj-${z.instanz}`, 'projekte', z.eigeneSlugs.at(-1), 'resample');
  const dateien = () => (fs.existsSync(ordner) ? fs.readdirSync(ordner).sort() : []);
  const vorher = dateien(), pv = (await aktuell()).projekt;
  const r3 = await resample({ strang_id: g, punkt: 'post' });
  const pn = (await aktuell()).projekt;
  notiere('A6 error case: a muted source gives 409 resample_leer, no track, no file left behind',
    r3.code === 409 && r3.j?.fehler === 'resample_leer' && pn.rev === pv.rev && pn.spuren.length === pv.spuren.length && dateien().join() === vorher.join(),
    `${r3.code} ${r3.j?.fehler ?? ''}; rev ${pv.rev} -> ${pn.rev}; tracks ${pv.spuren.length} -> ${pn.spuren.length}; files ${vorher.length} -> ${dateien().length}`);
}

async function ak18() {
  z.punkt = 'AK18';
  // negative control first: quiet material (one sine at -12 dB)
  await z.neuesProjekt('ak18-leise');
  await z.setzeTempo(BPM);
  await aendern('R7 ak18 quiet track', [{ befehl: 'spur_neu', art: 'audio', name: 'Quiet' }], CYPHER);
  const q = (await aktuell()).projekt.spuren[0].id;
  await aendern('R7 ak18 quiet clip', [sineClip(q, 0), { befehl: 'spur_aendern', spur_id: q, fader_db: -12 }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: LOOP_BEATS }], CYPHER);
  await z.geladen();
  const wl = await limiterWerte();
  const endlich = (w) => w.every((x) => Number.isFinite(x));
  notiere('B1 negative control: quiet material gives limiter_db 0 in proj_lage during playback', endlich(wl) && Math.min(...wl) > -0.05,
    endlich(wl) ? `30 reads, min ${fmt(Math.min(...wl))} dB, max ${fmt(Math.max(...wl))} dB` : `limiter_db missing in proj_lage (kern.limiter_db: ${JSON.stringify(wl.slice(0, 3))} ...)`);

  // hot project: 8 tracks at +6 dB (the same sine, in phase), master +6 dB
  await z.neuesProjekt('ak18-heiss');
  await z.setzeTempo(BPM);
  await aendern('R7 ak18 hot tracks', Array.from({ length: 8 }, (_, i) => ({ befehl: 'spur_neu', art: 'audio', name: `Hot ${i + 1}` })), CYPHER);
  const ids = (await aktuell()).projekt.spuren.map((s) => s.id);
  await aendern('R7 ak18 hot clips and faders', [...ids.map((id) => sineClip(id, 0)), ...ids.map((id) => ({ befehl: 'spur_aendern', spur_id: id, fader_db: 6 })),
    { befehl: 'master_aendern', fader_db: 6 }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: LOOP_BEATS }], CYPHER);
  info(`AK18 set-up: ${ids.length} tracks (sine ${FREQ[0]} Hz, +6 dB), master +6 dB, loop 0..${LOOP_BEATS} at ${BPM} BPM`);
  const P = await exportiere(0, LOOP_BEATS, 'produktion', 'ak18-export-produktion');
  const S = await exportiere(0, LOOP_BEATS, 'set', 'ak18-export-set');
  let dbtp = -1.0;                                                   // kern.toml limiter_dbtp of the instance, default -1.0
  try {
    const m = /^\s*limiter_dbtp\s*=\s*(-?[\d.]+)/m.exec(fs.readFileSync(path.join(process.env.HOME, '.config', `cypherdj-${z.instanz}`, 'kern.toml'), 'utf8'));
    if (m) dbtp = Number(m[1]);
  } catch { /* no instance config: the core default */ }
  const pa = P.antwort, sa = S.antwort;
  notiere('B2 export produktion: ueber_decke true; export set: ueber_decke false and the peak at or below limiter_dbtp',
    pa.abgriff === 'produktion' && pa.ueber_decke === true && sa.abgriff === 'set' && sa.ueber_decke === false && sa.spitze_db <= dbtp,
    `produktion abgriff ${pa.abgriff} ueber_decke ${pa.ueber_decke} peak ${fmt(pa.spitze_db)} dBFS; set abgriff ${sa.abgriff} ueber_decke ${sa.ueber_decke} peak ${fmt(sa.spitze_db)} dBFS (limiter_dbtp ${dbtp}), limiter_db_max ${fmt(sa.limiter_db_max)}`);
  const wh = await limiterWerte();
  notiere('B1 limiter_db of proj_lage is below 0 during hot playback', endlich(wh) && Math.min(...wh) < -0.5,
    endlich(wh) ? `30 reads, min ${fmt(Math.min(...wh))} dB, max ${fmt(Math.max(...wh))} dB (quiet control min ${fmt(Math.min(...wl.filter(Number.isFinite)))} dB)` : `limiter_db missing in proj_lage (kern.limiter_db: ${JSON.stringify(wh.slice(0, 3))} ...)`);
  roh.punkte.B1 = { leise: wl, heiss: wh };

  const r = await resample({ strang_id: 'master', punkt: 'post' });
  if (r.code !== 200) {
    notiere('B3 resample of the master (tap kind pm) post: peak above 0 dBFS, equals the produktion export below -90 dBFS', false, `refused: ${z.grundVon(r)}`);
    notiere('B4 counter-check: one sample late is above -90 dBFS; the WAV is not the set export', false, 'not run: no resample');
    return;
  }
  const kopie = path.join(z.ORDNER, 'ak18-resample-master.wav');
  fs.copyFileSync(r.j.datei, kopie);
  const R = leseWav(kopie), spitze = db(Math.max(spitzeLin(R.l), spitzeLin(R.r)));
  const d = nd(P, R);
  notiere('B3 resample of the master (tap kind pm) post: peak above 0 dBFS, equals the produktion export below -90 dBFS',
    r.j.frames === FRAMES_SOLL && spitze > 0 && ok2(d), `frames ${r.j.frames}; WAV peak ${fmt(spitze)} dBFS; ${nullText(d)}`);
  const ds = nd(P, { l: spaet(R.l), r: spaet(R.r) }), dset = nd(S, R);
  notiere('B4 counter-check: one sample late is above -90 dBFS; the WAV is not the set export (a tap behind the limiter would be)',
    gross2(ds) && gross2(dset), `one sample late ${nullText(ds)}; against the set export ${nullText(dset)}`);
  roh.punkte.B3 = { d, ds, dset, spitze };
}

async function lauf() {
  const vor = await aktuell();
  info(`core of the instance ${z.instanz}: ${JSON.stringify(vor.kern ?? null)}; core build dir ${BAU ?? '(not given)'}`);
  for (const [name, f] of [['AK16', ak16], ['AK18', ak18]]) {
    try { await f(); } catch (e) { notiere(`${name} run`, false, `aborted: ${e.message}`); }
  }
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
  await z.ende('abnahme_r7 (1.10 slice 7)', /^r7-/i);
}
lauf().catch((e) => { process.stderr.write(`abnahme_r7: ${e.stack ?? e}\n`); process.exit(2); });
