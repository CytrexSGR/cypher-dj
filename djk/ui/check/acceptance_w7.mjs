// Target acceptance for Paket 1.13 Warp, slice 7 (Merge, AK27) against a TEST INSTANCE with a real catalog and the real cypherdj-render:
//   echo '{"sha":"<sha256 of the catalog track>","von_beat":16,"bis_beat":48,"bpm":124}' > /dev/shm/w7-ziel/aufbau.json
//   node check/acceptance_w7.mjs --url <test instance> --aufbau /dev/shm/w7-ziel/aufbau.json [--ausgabe <dir>] [--instanz <a..f>] [--wav-behalten] [--nur-n1]
// Take the real-time lock first; the caller starts and cleans the instance. Set-up: real POST /proj/stems (four stem tracks in the group "Stems: <name>").
//   N0  instrument of the measurement: the same solo export twice, peak below -90 dBFS (otherwise no later value means anything)
//   N1  AK27: four stems solo, export A over the range, POST /proj/zusammenfuehren, export B (sources muted, the new track inherited solo): peak < -90 dBFS
//   N2  mixer not neutral: faders -4.5/+2/-12/0 dB, pans -0.6/0.3/1/-1, group fader -3 dB, group balance 0.4, PM fader -2 dB; same gate
//   N3  master target (stems out of the group), faders and pans as N2; same gate
//   N4  whole export without solo, merge of TWO of the four stems (group, group fader, PM fader, faders and pans as N2): A before, B after; same gate
//   N5  start inside the source clips (beat 20): NO gate, measured: peak overall and in the first 2000 samples
//   U   one undo after N1 restores tracks, mute, solo and clips exactly; the WAV stays on disk
//   G   two stems plus one track at the master: merge_gruppen, rev unchanged
//   NK1 measuring-instrument controls: B shifted by one sample and B at -3.0103 dB are above -90
//   RB  side probe (not a gate): an internal instrument track rendered twice, peak of the difference
// Every case records regler_quelle of both exports and the core state. Raw data rohdaten.json, report bericht.md; WAVs only with --wav-behalten.
// Exit: 0 all OK, 1 FEHL, 2 usage. Cleans only own projects (slug w7-...).
import fs from 'node:fs';
import path from 'node:path';
import { starte, Fehl } from './w3a_target.mjs';
import { leseWav } from './w1_wav.mjs';
import { NULL_TOR_DB, nullDifferenz, nullOk, pegelVerhaeltnisDb, versatz, anfangUndRest, standSchluessel } from './w7_measure.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_w7: usage: --url <test instance> --aufbau <aufbau.json> [--ausgabe <dir>] [--instanz <a..f>] [--wav-behalten] [--nur-n1]\n'
    + '  aufbau.json: {"sha":"<sha256>","von_beat":16,"bis_beat":48,"bpm":124}\n');
  process.exit(2);
}
const z = starte('abnahme_w7', 'w7', { 'wav-behalten': { type: 'boolean' }, 'nur-n1': { type: 'boolean' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell } = z;
const roh = { faelle: {}, exporte: [] };
const ms = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const FRIST_MS = 15 * 60_000;
const exportNamen = [];
const sp = (p, id) => p.spuren.find((s) => s.id === id);

async function export_(von, bis, name) {
  await z.geladen();
  const r = z.erwarte200('/proj/export', await z.ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis }, CYPHER)).j;
  fs.copyFileSync(r.datei, path.join(z.ORDNER, `${name}.wav`));
  exportNamen.push(`${name}.wav`);
  roh.exporte.push({ name, regler_quelle: r.regler_quelle, frames: r.frames, spitze_db: r.spitze_db, abgriff: r.abgriff });
  return { ...leseWav(r.datei), regler_quelle: r.regler_quelle, spitze_db: r.spitze_db };
}
const ids = (p) => p.spuren.map((s) => s.id);
const rueck = async (n) => { for (let i = 0; i < n; i++) z.erwarte200('/proj/undo', await z.ruf('POST', '/proj/undo', { rev: await z.holeRev() })); };
const soloAn = (stems, an = true) => stems.map((id) => ({ befehl: 'spur_aendern', spur_id: id, solo: an }));
const MISCH = [[-4.5, -0.6], [2, 0.3], [-12, 1], [0, -1]];                       // N2: fader/pan per stem
const mischung = (stems) => stems.map((id, i) => ({ befehl: 'spur_aendern', spur_id: id, fader_db: MISCH[i][0], pan: MISCH[i][1] }));

// one case: set-up steps (count them), A, merge, B, gate, undo of everything with a comparison of the state
async function fall(kz, { vorher = [], nachherSolo = true, merge, von = A.von_beat, bis = A.bis_beat, tor = true, text }) {
  z.punkt = kz;
  const p0 = (await aktuell()).projekt, key0 = standSchluessel(p0);
  let schritte = 0;
  for (const [label, befehle] of vorher) { await aendern(`W7 ${kz} ${label}`, befehle, CYPHER); schritte++; }
  const pa = (await aktuell()).projekt;
  const a = await export_(von, bis, `${kz}-A`);
  const m = z.erwarte200('POST /proj/zusammenfuehren', await z.ruf('POST', '/proj/zusammenfuehren?antwort=kurz',
    { spur_ids: merge, von_beat: von, bis_beat: bis }, CYPHER)).j;
  await z.geladen();
  const pb = (await aktuell()).projekt;
  const neu = sp(pb, m.spur_id);
  const b = await export_(von, bis, `${kz}-B`);
  const dl = nullDifferenz(a.l, b.l), dr = nullDifferenz(a.r, b.r);
  const lage = { regler_quelle_A: a.regler_quelle, regler_quelle_B: b.regler_quelle, merge_datei: m.datei, hinweis: m.hinweis ?? null,
    neu_solo: neu?.solo, neu_ausgang: neu?.ausgang ?? null, clip_gain_db: neu?.clips[0]?.gain_db };
  roh.faelle[kz] = { ...lage, l: dl, r: dr, pegel_db: [pegelVerhaeltnisDb(a.l, b.l), pegelVerhaeltnisDb(a.r, b.r)],
    versatz: [versatz(a.l, b.l), versatz(a.r, b.r)], anfang_rest_l: anfangUndRest(a.l, b.l), anfang_rest_r: anfangUndRest(a.r, b.r) };
  const kanaele = `L ${ms(dl.spitze_db)} dBFS (rms ${ms(dl.rms_db)}), R ${ms(dr.spitze_db)} dBFS (rms ${ms(dr.rms_db)})`;
  const quellen = `regler_quelle A ${a.regler_quelle}, B ${b.regler_quelle}, kern ${JSON.stringify(roh.kern ?? null)}`;
  if (tor) {
    notiere(`${kz} ${text}`, nullOk(dl) && nullOk(dr),
      `${kanaele}; ${quellen}; level B/A ${ms(roh.faelle[kz].pegel_db[0])} dB; lag ${roh.faelle[kz].versatz.join('/')} samples;`
      + ` first 2000 samples L ${ms(roh.faelle[kz].anfang_rest_l.anfang_db)} dBFS`);
  } else {
    const ar = roh.faelle[kz].anfang_rest_l;
    info(`${kz} ${text} (measurement, no gate): ${kanaele}; first 2000 samples L ${ms(ar.anfang_db)} dBFS, rest L ${ms(ar.rest_db)} dBFS;`
      + ` ${quellen}`);
  }
  void nachherSolo;
  return { a, b, m, key0, schritte, pb, pa, p0 };
}
async function zurueck(kz, f) {
  await rueck(f.schritte + 1);
  const k = standSchluessel((await aktuell()).projekt);
  notiere(`${kz} undo of the case restores the state exactly (${f.schritte} set-up steps + 1 merge)`, k === f.key0,
    `tracks ${(await aktuell()).projekt.spuren.length}`);
}

async function lauf() {
  for (const k of ['sha', 'von_beat', 'bis_beat', 'bpm']) if (A[k] === undefined) throw new Fehl(`aufbau.json: ${k} missing`);
  const vor = await aktuell();
  roh.kern = vor.kern ?? null;
  info(`core of the instance: ${JSON.stringify(roh.kern)}`);
  info(`Z0 render program: ${path.resolve(import.meta.dirname, '..', '..', 'core', 'build', 'cypherdj-render')} (ninja -n, report of the caller)`);
  z.punkt = 'Aufbau';
  await z.neuesProjekt('merge');
  await z.setzeTempo(A.bpm);
  await aendern('W7 set-up', [{ befehl: 'spur_neu', art: 'audio', name: 'Quelle' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 64, sha256: A.sha, warp: 'auto' }], CYPHER);
  await z.geladen();
  const clip0 = sp((await aktuell()).projekt, 's1').clips[0];
  z.punkt = 'Stems';
  const start = z.erwarte200('POST /proj/stems', await z.ruf('POST', '/proj/stems', { clip_id: clip0.id, von_beat: A.von_beat, bis_beat: A.bis_beat },
    CYPHER)).j;
  info(`stems: job ${start.auftrag_id}, ${start.frames} frames`);
  let ende = null;
  for (let t = 0; t < FRIST_MS; t += 1000) {
    const st = (await aktuell()).stems;
    if (st?.auftrag_id === start.auftrag_id && st.zustand !== 'laeuft') { ende = st; break; }
    await z.warte(1000);
  }
  if (!ende || ende.zustand !== 'fertig') throw new Fehl(`stems did not finish: ${JSON.stringify(ende)}`);
  await z.geladen();
  const stems = ende.spuren;
  if (stems.length !== 4) throw new Fehl(`expected four stem tracks: ${JSON.stringify(stems)}`);
  const p1 = (await aktuell()).projekt;
  const gruppe = sp(p1, stems[0]).ausgang?.id ?? null;
  info(`set-up: four stem tracks ${stems.join(',')} in group ${gruppe}`);
  // the original stays muted in the range (stems: middle piece), solo is set only on the stems

  // N0: measuring instrument
  z.punkt = 'N0';
  await aendern('W7 N0 solo', soloAn(stems), CYPHER);
  const n0a = await export_(A.von_beat, A.bis_beat, 'N0-A1'), n0b = await export_(A.von_beat, A.bis_beat, 'N0-A2');
  const n0l = nullDifferenz(n0a.l, n0b.l), n0r = nullDifferenz(n0a.r, n0b.r);
  roh.n0 = { l: n0l, r: n0r, regler_quelle: [n0a.regler_quelle, n0b.regler_quelle] };
  notiere('N0 the same solo export twice is repeatable (peak < -90 dBFS)', nullOk(n0l) && nullOk(n0r),
    `L ${ms(n0l.spitze_db)} dBFS, R ${ms(n0r.spitze_db)} dBFS, regler_quelle ${n0a.regler_quelle}/${n0b.regler_quelle}`);
  await rueck(1);
  if (!(nullOk(n0l) && nullOk(n0r))) throw new Fehl('N0 failed: the render is not repeatable, no later value says anything (report to the main instance)');

  // N1 (AK27)
  const f1 = await fall('N1', { vorher: [['solo', soloAn(stems)]], merge: stems,
    text: 'AK27: merge of four stems vs. export of the sources solo: peak < -90 dBFS' });
  // U: one undo of the merge alone
  z.punkt = 'U';
  const dateiNeu = f1.m.datei, mergeSchluessel = standSchluessel(f1.pb);
  await rueck(1);
  const k1 = standSchluessel((await aktuell()).projekt);
  const vorMerge = standSchluessel(f1.pa);
  notiere('U one undo after the merge restores tracks, mute, solo and clips exactly; the WAV stays on disk',
    k1 === vorMerge && k1 !== mergeSchluessel && fs.existsSync(dateiNeu),
    `equal to the state before the merge: ${k1 === vorMerge}, differs from merged: ${k1 !== mergeSchluessel}, WAV exists: ${fs.existsSync(dateiNeu)}`);
  await rueck(f1.schritte);
  notiere('N1 set-up undone, state as before the case', standSchluessel((await aktuell()).projekt) === f1.key0, 'exact');
  // NK1: controls of the measuring instrument on the data of N1
  z.punkt = 'NK1';
  const a1 = leseWav(path.join(z.ORDNER, 'N1-A.wav'));
  const versch = new Float32Array(a1.l.length); versch.set(a1.l.subarray(0, a1.l.length - 1), 1);
  const g = 10 ** (-3.0102999566398 / 20);
  const nk1a = nullDifferenz(a1.l, versch), nk1b = nullDifferenz(a1.l, a1.l.map((x) => x * g));
  roh.nk1 = { verschoben: nk1a, minus3dB: nk1b };
  notiere('NK1 control of the instrument: B shifted by one sample and B at -3.0103 dB are above -90 dBFS', !nullOk(nk1a) && !nullOk(nk1b),
    `shifted ${ms(nk1a.spitze_db)} dBFS, -3.01 dB ${ms(nk1b.spitze_db)} dBFS`);
  if (A.nur_n1 || z.opt['nur-n1']) return;

  // N2
  const sets = (mitGruppe) => [['solo', soloAn(stems)], ['mixer', mischung(stems)],
    ['group+pm', [...(mitGruppe && gruppe ? [{ befehl: 'gruppenspur_aendern', gruppe_id: gruppe, fader_db: -3, pan: 0.4 }] : []),
      { befehl: 'master_aendern', fader_db: -2 }]]];
  const f2 = await fall('N2', { vorher: sets(true), merge: stems,
    text: 'mixer not neutral (faders, pans, group fader and balance, PM fader): peak < -90 dBFS' });
  await zurueck('N2', f2);
  // N3
  const f3 = await fall('N3', { vorher: [...sets(false), ['master target', stems.map((id) => ({ befehl: 'ziel_setzen', strang_id: id,
    ausgang: 'master' }))]], merge: stems,
    text: 'master target (stems out of the group): peak < -90 dBFS' });
  await zurueck('N3', f3);
  // N4: whole export without solo, merge of two stems
  const zwei = stems.slice(0, 2);
  const f4 = await fall('N4', { vorher: [['mixer', mischung(stems)], ['group+pm', [...(gruppe ? [{ befehl: 'gruppenspur_aendern', gruppe_id: gruppe,
    fader_db: -3 }] : []),
    { befehl: 'master_aendern',
      fader_db: -2 }]]], merge: zwei, text: 'whole export without solo, merge of two of the four stems (before vs. after): peak < -90 dBFS' });
  await zurueck('N4', f4);
  // N5: start inside the source clips, measurement only
  const f5 = await fall('N5', { vorher: [['solo', soloAn(stems)]], merge: stems, von: A.von_beat + 4, tor: false,
    text: `start inside the source clips (beat ${A.von_beat + 4})` });
  await zurueck('N5', f5);
  // G: merge_gruppen
  z.punkt = 'G';
  await aendern('W7 G extra track', [{ befehl: 'spur_neu', art: 'audio', name: 'Extra' }], CYPHER);
  const extra = (await aktuell()).projekt.spuren.at(-1).id;
  await aendern('W7 G extra to master', [{ befehl: 'ziel_setzen', strang_id: extra, ausgang: 'master' }], CYPHER);
  const revG = await z.holeRev();
  const g1 = await z.ruf('POST', '/proj/zusammenfuehren', { spur_ids: [stems[0], stems[1], extra], von_beat: A.von_beat, bis_beat: A.bis_beat }, CYPHER);
  notiere('G two stems plus a track at the master: merge_gruppen, rev unchanged', g1.code === 409 && g1.j?.fehler === 'merge_gruppen'
    && (await z.holeRev()) === revG,
    `${z.grundVon(g1)}, rev ${revG} -> ${await z.holeRev()}`);
  await rueck(2);
  // RB: side probe, instrument track
  z.punkt = 'RB';
  await aendern('W7 RB track', [{ befehl: 'spur_neu', art: 'instrument', name: 'RB', geraet: { art: 'intern' } }], CYPHER);
  const rbId = (await aktuell()).projekt.spuren.at(-1).id;
  await aendern('W7 RB clip', [
    { befehl: 'clip_neu', spur_id: rbId, art: 'midi', start_beat: A.von_beat, laenge_beats: 8,
      noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }, { beat: 2, laenge: 1, ton: 43, vel: 100 }, { beat: 4, laenge: 1, ton: 36, vel: 100 }] },
    { befehl: 'spur_aendern', spur_id: 's1', mute: true }, ...soloAn([rbId])], CYPHER);
  const r1 = await export_(A.von_beat, A.von_beat + 8, 'RB-1'), r2 = await export_(A.von_beat, A.von_beat + 8, 'RB-2');
  const rb = nullDifferenz(r1.l, r2.l);
  roh.rb = rb;
  info(`RB side probe (not a gate): internal instrument track rendered twice: peak of the difference L ${ms(rb.spitze_db)} dBFS,`
    + ` regler_quelle ${r1.regler_quelle}/${r2.regler_quelle}`);
}

try {
  await lauf();
} catch (e) {
  if (z.punkt === 'RB') info(`RB side probe not completed (not a gate): ${e.message ?? e}`);
  else if (e instanceof Fehl) notiere(z.punkt, false, e.message); else notiere('ABORT', false, `${z.punkt}: ${e.stack ?? String(e)}`);
}
const wurzel = path.join('/dev/shm', `cypherdj-${z.instanz}`, 'projekte');
for (const slug of z.eigeneSlugs) {
  const d = path.join(wurzel, slug);
  if (!/^w7-[a-z0-9-]+-\d{8}t\d{6}/i.test(slug)) { z.info(`slug ${slug} is not from this script, not deleted`); continue; }
  try {
    if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); z.info(`project ${d} deleted`); } else z.info(`project ${d} not found`);
  } catch (e) { z.notiere('cleanup', false, e.message); }
}
fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'),
  `${JSON.stringify({ zeit: z.zeit, url: z.URL, instanz: z.instanz, aufbau: A, schwelle_db: NULL_TOR_DB, roh }, null, 1)}\n`);
if (!z.opt['wav-behalten']) for (const f of exportNamen) fs.rmSync(path.join(z.ORDNER, f), { force: true });
const schluss = z.fehl === 0 ? 'ALLES OK' : `FEHL ${z.fehl}`;
fs.writeFileSync(path.join(z.ORDNER, 'bericht.md'),
  `# Acceptance W7 slice 7 merge ${z.zeit} (${z.URL}, instance ${z.instanz})\n\n${z.zeilen.join('\n')}\n\n${schluss}\n`);
process.stdout.write(`\n${schluss}\n`);
process.exit(z.fehl === 0 ? 0 : 1);
