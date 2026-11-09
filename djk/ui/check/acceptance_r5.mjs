// Acceptance 1.10 slices 5 and 6, the debt of AK13 to AK15 (sidechain), on the real core of a test instance (never a, f, g, h, i, never the live set).
// Two steps (the click, sine and silence material is generated; the page server finds the clips through a catalog it is started with):
//   1  node check/acceptance_r5.mjs --material /dev/shm/r5-ziel --instanz e          (writes the WAVs, the catalog, aufbau.json and the DJ fixture material of the instance)
//   2  CYPHERDJ_KATALOG=/dev/shm/r5-ziel/katalog.sqlite DJK=<worktree>/djk djk/start/djk-start --instanz e --arr1        (silent)
//   3  node check/acceptance_r5.mjs --url http://127.0.0.1:52300 --instanz e --aufbau /dev/shm/r5-ziel/aufbau.json [--ausgabe <dir>]
// Points, each with its measured value and its counter-case (the counter-case is the negative control of the point: the same project with the key signal silent, or the other point):
//   AK13  bass 100 Hz keyed by a kick (track pre, a click on every beat at 120 BPM): the bass level in the 50 ms after each click at least 6 dB below the level between the clicks;
//         counter-cases: the stage on its own signal (below 1 dB), the kick replaced by a silent track (below 1 dB)
//   AK14  kick fader -200: `pre` keeps the reduction within 1 dB of the one at fader 0, `post` is below 1 dB
//   AK15  (scope of the addendum) track `post` on a track stage, a group `post` key on a return stage, a return `post` key on the PM stage: each at least 6 dB (counter-case: the silent kick, below 1 dB);
//         a group key on a track stage is refused sidechain_spaet, the PM as key sidechain_zyklus (HTTP status and reason);
//         the picker chain without a browser (the page module is served, the server's options, the command the page builds, the project holds the key);
//         deck/1 live (a deck plays a click file, a production stage keyed deck/1: reduction above 3 dB in /e/ins_gr within the next 2 reports after the click, 0 dB without the click),
//         the export of that project answers dj_schluessel true and does not reduce; duck_durch_kick is one undo step.
// The level is measured at 100 Hz with a Goertzel filter over whole cycles (the click has no energy there), on the left channel of the production export (settle time as in abnahme_r3).
// Exit 0 all points OK, 1 at least one FEHL, 2 call error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { schreibeWav, leseWav } from './w1_wav.mjs';
import { sinusQuelle } from './c14_measure.mjs';
import { baueKatalog, ksha } from '../tests/support/catalog.mjs';
import { kodiere } from '../../conductor/src/osc.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string' }, aufbau: { type: 'string' }, material: { type: 'string' }, nur: { type: 'string' } } });
const aufrufFehler = (t) => { process.stderr.write(`abnahme_r5: ${t}\n`); process.exit(2); };
const BEATS_HZ = 100, SR = 48000, BPM = 120, SCHLAG = 60 * SR / BPM;   // 24000 frames per beat
const KLICK_DAUER = 480, SINUS_AMP = 0.2;

// ---- step 1: the material -------------------------------------------------------------------------------------------------------------------
if (opt.material) {
  if (!opt.instanz || !/^[bde]$/.test(opt.instanz)) aufrufFehler('--material needs --instanz b, d or e');
  const ziel = path.resolve(opt.material);
  fs.mkdirSync(ziel, { recursive: true });
  const FRAMES = 40 * SR;
  const wav = (name, quelle) => {
    const pfad = path.join(ziel, name), ton = new Float32Array(2 * FRAMES);
    for (let i = 0; i < FRAMES; i++) ton[2 * i] = ton[2 * i + 1] = quelle(i);
    schreibeWav(pfad, ton);
    return pfad;
  };
  // the kick: a decaying 1 kHz burst of 10 ms on every beat (its energy at 100 Hz is far below the bass, see the report line of the level)
  const klick = (i) => { const j = i % SCHLAG; return j < KLICK_DAUER ? Math.fround(0.6 * Math.sin(2 * Math.PI * 1000 * j / SR) * Math.exp(-j / 120)) : 0; };
  const MATERIAL = [['klick-r5.wav', klick, 'R5 click 120'], ['sinus-100.wav', sinusQuelle(BEATS_HZ, SINUS_AMP, 0.7), 'R5 sine 100'], ['stille-r5.wav', () => 0, 'R5 silence']];
  const wavs = {};
  MATERIAL.forEach(([name, q], i) => { wavs[name.replace(/\.wav$/, '')] = { pfad: wav(name, q), sha: ksha(20 + i), n: 20 + i }; });
  const katalog = baueKatalog(ziel, MATERIAL.map(([name, , titel], i) => ({ n: 20 + i, typ: 'track', werk_id: 20 + i, titel, bpm: BPM, dauer_s: 40, pfad: path.join(ziel, name) })));
  const cache = path.join(os.homedir(), '.cache', `cypherdj-${opt.instanz}`, 'arr', 'audio');
  for (let n = 20; n < 20 + MATERIAL.length; n++) fs.rmSync(path.join(cache, `${ksha(n)}.f32`), { force: true });
  // the DJ fixture material (click on every beat at 128 BPM, 64 beats) in the working stock of the instance: only the fixture folders are written
  const ab = path.join('/dev/shm', `cypherdj-${opt.instanz}`, 'material');
  const py = spawnSync('python3', [path.join(HIER, '..', '..', 'contract', 'generate_material.py'), '--ziel', ab], { encoding: 'utf8' });
  fs.writeFileSync(path.join(ziel, 'aufbau.json'), `${JSON.stringify({ katalog, bpm: BPM, schlag_frames: SCHLAG, instanz: opt.instanz, cache, wavs, deck_material: { id: 'f0000000000000c3', basis_bpm: 128, fassung: 1, ordner: ab, rc: py.status } })}\n`);
  process.stdout.write(`material written to ${ziel} (katalog ${katalog}); DJ fixture material rc ${py.status} ${py.stderr.trim().slice(0, 200)}\n`);
  process.exit(0);
}

// ---- step 3: the points --------------------------------------------------------------------------------------------------------------------
if (!opt.url || !opt.aufbau || !opt.instanz) aufrufFehler('usage: --url <http://127.0.0.1:port> --instanz <b|c|d|e> --aufbau <aufbau.json> [--ausgabe <dir>] [--nur AK13,AK14,AK15,...]   (material first: --material <dir> --instanz e)');
if (/:(47300|47100|47200)\b/.test(opt.url)) aufrufFehler('never against the live studio (47300): pick a test instance');
const port = Number(new globalThis.URL(opt.url).port);
const k = (port - 47300) / 1000;
const aus = Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined;
const instanz = opt.instanz;
// the lock: the instance letter comes from the port and from --instanz, and both must agree (a, f, g, h, i are never allowed)
if (!aus || aus !== instanz) aufrufFehler(`--instanz ${instanz} does not match the port ${port} (instance ${aus ?? '?'})`);
if (!/^[bcde]$/.test(instanz)) aufrufFehler(`Instanz ${instanz} is not allowed: only b, c, d, e (a, f, g, h, i are taboo)`);
const AUFBAU = JSON.parse(fs.readFileSync(opt.aufbau, 'utf8'));
if (AUFBAU.instanz !== instanz) aufrufFehler(`aufbau.json is for instance ${AUFBAU.instanz}, not ${instanz}`);
const SHA = Object.fromEntries(Object.entries(AUFBAU.wavs).map(([n, v]) => [n, v.sha]));
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-r5`);
fs.mkdirSync(ORDNER, { recursive: true });
const NUR = opt.nur ? new Set(opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (kz, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}\n`); };
const info = (text) => { zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };
const fmt = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : String(x));

const URL = opt.url;
const CYPHER = { 'x-djk-quelle': 'cypher' };
const ruf = async (methode, weg, koerper, kopf = {}) => {
  const r = await fetch(URL + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j, text: t };
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
  if (!(await bisWahr(async () => typeof (await ruf('GET', '/lage')).j?.uhr?.bpm === 'number', 8000))) throw new Fehl('kein Kern: /lage meldet keine Uhr');
};
const eigeneSlugs = [];
const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');
async function neuesProjekt(kz) {
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `r5-${kz}-${zeit}` }));
  const slug = r.j.slug ?? r.j.projekt?.slug;
  if (!slug) throw new Fehl(`/proj/neu ohne slug: ${JSON.stringify(r.j).slice(0, 200)}`);
  eigeneSlugs.push(slug);
  return slug;
}
// the playback is loaded in the core and every audio clip is decoded (an export before that would render the old state)
const geladen = async () => {
  const ok = await bisWahr(async () => {
    const a = await aktuell();
    return a.projekt.spuren.flatMap((s) => s.clips ?? []).filter((c) => c.art === 'audio').every((c) => c.dekodiert === 'fertig') && a.kern?.rev_geladen === a.projekt.wiedergabe_rev && a.kern?.status === 0;
  }, 40000);
  if (!ok) throw new Fehl('the playback is not loaded after 40 s');
};
const SETTLE_MS = 1000;   // the export reads the controls from the core's state compartment (20 Hz), see abnahme_r3
const exportiere = async (von, bis) => {
  await geladen();
  await warte(SETTLE_MS);
  return erwarte200('/proj/export', await ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis }, CYPHER)).j;
};

// ---- level measurement -------------------------------------------------------------------------------------------------------------------------
// the amplitude of the 100 Hz component over [i0, i0 + n) (a Goertzel filter, n a whole number of cycles: 4800 samples = 10 cycles)
function pegel100(x, i0, n) {
  let re = 0, im = 0;
  const w = 2 * Math.PI * BEATS_HZ / SR;
  for (let i = 0; i < n; i++) { const v = x[i0 + i] ?? 0; re += v * Math.cos(w * (i0 + i)); im += v * Math.sin(w * (i0 + i)); }
  return (2 * Math.hypot(re, im)) / n;
}
const db = (a) => (a > 1e-9 ? 20 * Math.log10(a) : -180);
// the reduction of the bass: level between the clicks minus level in the 50 ms after each click (dB), over the clicks 2..13 of a 16-beat export
function reduktion(datei) {
  const x = leseWav(datei).l;
  const je = [];
  for (let c = 2; c <= 13; c++) {
    const f = c * SCHLAG;
    const nach = pegel100(x, f, 2400), zwischen = pegel100(x, f + 14400, 4800);   // 50 ms after the click; 300..400 ms after it (the release is 150 ms)
    je.push({ c, nach_db: db(nach), zwischen_db: db(zwischen), r: db(zwischen) - db(nach) });
  }
  const r = je.map((e) => e.r).sort((a, b) => a - b);
  return { median: r[Math.floor(r.length / 2)], min: r[0], max: r[r.length - 1], zwischen_db: je[0].zwischen_db, je };
}

// ---- the projects -------------------------------------------------------------------------------------------------------------------------------
const DUCK = { schwelle: -30, ratio: 8, knie: 0, attack: 1, release: 150, makeup: 0, mix: 1, schp: 0 };   // the values of "Duck by Kick" (DUCK_DURCH_KICK_WERTE)
const audio = (spur_id, sha, name) => ({ befehl: 'clip_neu', spur_id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: sha, name });
const komp = (strang_id, extra = {}) => ({ befehl: 'insert_setzen', strang_id, pos: 0, art: 'komp', werte: { ...DUCK }, ...extra });
// topo: spur (the bass track s2 keyed by the kick track s1), grp (the bass reaches the master only through the return r1 (pre send, fader -200); the kick sits in the group g1;
// the stage on r1 is keyed by g1 post), pm (the kick is also sent to r1; the stage on the PM is keyed by r1 post; the bass is direct). `kick`: klick-r5 or stille-r5.
async function baue(kz, o) {
  const slug = await neuesProjekt(kz);
  await aendern(`R5 ${kz} tracks`, [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'audio', name: 'Kick' }, { befehl: 'spur_neu', art: 'audio', name: 'Bass' },
    { befehl: 'spur_neu', art: 'audio', name: 'Stille' }]);
  await aendern(`R5 ${kz} clips`, [audio('s1', SHA[o.kick ?? 'klick-r5'], 'kick'), audio('s2', SHA['sinus-100'], 'bass'), audio('s3', SHA['stille-r5'], 'stille')]);
  const topo = o.topo ?? 'spur';
  if (topo === 'spur') {
    await aendern(`R5 ${kz} stage`, [komp('s2', o.key ?? {})]);
  } else if (topo === 'grp') {
    await aendern(`R5 ${kz} routing`, [{ befehl: 'gruppenspur_neu', mitglieder: ['s1'] }, { befehl: 'return_neu', name: 'Bass return', hall: { an: false } }]);
    await aendern(`R5 ${kz} return`, [{ befehl: 'return_aendern', return_id: 'r1', pre: true }, { befehl: 'spur_aendern', spur_id: 's2', fader_db: -200 }, { befehl: 'send_setzen', strang_id: 's2', return_id: 'r1', db: 0 }]);
    await aendern(`R5 ${kz} stage`, [komp('r1', o.key)]);
  } else if (topo === 'pm') {
    await aendern(`R5 ${kz} routing`, [{ befehl: 'return_neu', name: 'Kick return', hall: { an: false } }]);
    await aendern(`R5 ${kz} send`, [{ befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: 0 }]);
    await aendern(`R5 ${kz} stage`, [komp('master', o.key)]);
  }
  if (o.kickFader !== undefined) await aendern(`R5 ${kz} kick fader`, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: o.kickFader }]);
  return slug;
}
// one cell: build, export, measure; the export is kept in the output folder
async function zelle(kz, o) {
  await baue(kz, o);
  const e = await exportiere(0, 16);
  const ziel = path.join(ORDNER, `${kz}.wav`);
  fs.copyFileSync(e.datei, ziel);
  const r = reduktion(ziel);
  info(`${kz}: reduction median ${fmt(r.median)} dB, min ${fmt(r.min)}, max ${fmt(r.max)} (level between the clicks ${fmt(r.zwischen_db)} dBFS at 100 Hz, ${r.je.length} clicks); export peak ${fmt(e.spitze_db)} dBFS${e.dj_schluessel ? ', dj_schluessel' : ''}`);
  return { ...r, export: e };
}
// the options of one stage sit in the strip's stufen entry (GET /proj/routing?optionen=<insert_id>)
const optionenVon = (j, insertId) => (j?.straenge ?? []).flatMap((x) => x.stufen ?? []).find((x) => x.insert_id === insertId)?.optionen ?? [];
const sachlich = (r) => `reduction median ${fmt(r.median)} dB (min ${fmt(r.min)}, max ${fmt(r.max)})`;
const will = (kz) => !NUR || NUR.has(kz);
let punkt = 'Aufbau';
async function abschnitt(name, f) {
  punkt = name;
  try { await f(); } catch (e) { notiere(name, false, e instanceof Fehl ? e.message : `ABBRUCH: ${e.stack ?? String(e)}`); }
}

// ---- AK13, AK14 -----------------------------------------------------------------------------------------------------------------------------------
const R = {};
async function lauf() {
  await warteAufKern();
  info(`instance ${instanz}, ${URL}, material ${opt.aufbau}, load average ${fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]}`);
  const lage = await ruf('GET', '/proj/routing');
  info(`GET /proj/routing: ${lage.code}`);

  if (will('AK13')) await abschnitt('AK13', async () => {
    R.pre = await zelle('ak13-pre', { key: { sc: 1 } });
    notiere('AK13 bass keyed by the kick track (pre): the bass is at least 6 dB lower in the 50 ms after each click than between the clicks', R.pre.median >= 6, sachlich(R.pre));
    const eigen = await zelle('ak13-eigen', {});
    notiere('AK13 counter-case: the stage on its own signal (no key): below 1 dB', Math.abs(eigen.median) < 1 && Math.abs(eigen.max) < 1, sachlich(eigen));
    const still = await zelle('ak13-stille', { kick: 'stille-r5', key: { sc: 1 } });
    notiere('AK13 counter-case: the key track is silent (the kick replaced by silence): below 1 dB', Math.abs(still.median) < 1 && Math.abs(still.max) < 1, sachlich(still));
    const falsch = await zelle('ak13-falsche-spur', { key: { sc: 3 } });
    notiere('AK13 mutation: the key points to the silent track instead of the kick: below 1 dB (the point turns red)', Math.abs(falsch.median) < 1 && Math.abs(falsch.max) < 1, sachlich(falsch));
  });

  if (will('AK14')) await abschnitt('AK14', async () => {
    if (!R.pre) R.pre = await zelle('ak13-pre', { key: { sc: 1 } });
    const pre = await zelle('ak14-pre', { key: { sc: 1 }, kickFader: -200 });
    notiere('AK14 kick fader -200 with a pre key: the reduction stays within 1 dB of the one at fader 0', Math.abs(pre.median - R.pre.median) <= 1 && pre.median >= 6, `${sachlich(pre)} against ${fmt(R.pre.median)} dB at fader 0`);
    const post = await zelle('ak14-post', { key: { key: { quelle: 'spur', nr: 1, punkt: 'post' } }, kickFader: -200 });
    notiere('AK14 kick fader -200 with a post key: the reduction disappears (below 1 dB)', Math.abs(post.median) < 1 && Math.abs(post.max) < 1, sachlich(post));
    const post0 = await zelle('ak14-post-fader0', { key: { key: { quelle: 'spur', nr: 1, punkt: 'post' } } });
    notiere('AK14 counter-case: the same post key at fader 0 reduces at least 6 dB (the post cell above is silent because of the fader, not because the key is broken)', post0.median >= 6, sachlich(post0));
  });

  // ---- AK15 ----
  if (will('AK15')) await abschnitt('AK15 sources', async () => {
    const cell = async (kz, text, o, stilleO) => {
      const a = await zelle(kz, o);
      notiere(`AK15 ${text}: at least 6 dB`, a.median >= 6, sachlich(a));
      const s = await zelle(`${kz}-stille`, { ...o, kick: 'stille-r5' });
      notiere(`AK15 counter-case ${text}, the kick silent: below 1 dB`, Math.abs(s.median) < 1 && Math.abs(s.max) < 1, sachlich(s));
    };
    await cell('ak15-spur-post', 'track post key on a track stage', { key: { key: { quelle: 'spur', nr: 1, punkt: 'post' } } });
    await cell('ak15-grp-post', 'group post key on a return stage', { topo: 'grp', key: { key: { quelle: 'grp', nr: 1, punkt: 'post' } } });
    await cell('ak15-ret-post', 'return post key on the PM stage', { topo: 'pm', key: { key: { quelle: 'ret', nr: 1, punkt: 'post' } } });
  });

  if (will('AK15')) await abschnitt('AK15 refusals', async () => {
    await neuesProjekt('refuse');
    await aendern('R5 refuse set-up', [{ befehl: 'spur_neu', art: 'audio', name: 'K' }, { befehl: 'spur_neu', art: 'audio', name: 'B' }, { befehl: 'gruppenspur_neu', mitglieder: ['s1'] },
      { befehl: 'return_neu', name: 'R', hall: { an: false } }]);
    const spaet = await aendernRoh('R5 group key on a track stage', [komp('s2', { key: { quelle: 'grp', nr: 1, punkt: 'post' } })]);
    notiere('AK15 a group key on a track stage is refused sidechain_spaet', spaet.code === 400 && spaet.j?.fehler === 'sidechain_spaet', grundVon(spaet));
    const spaetRet = await aendernRoh('R5 return key on a track stage', [komp('s2', { key: { quelle: 'ret', nr: 1, punkt: 'post' } })]);
    notiere('AK15 a return key on a track stage is refused sidechain_spaet', spaetRet.code === 400 && spaetRet.j?.fehler === 'sidechain_spaet', grundVon(spaetRet));
    // the PM as key: the syntax comes from the server's own option list when there is one
    let pmKey = { quelle: 'pm', nr: 0, punkt: 'post' };
    await aendern('R5 refuse own stage', [komp('s2')]);
    const st = (await projektJetzt()).spuren.find((s) => s.id === 's2').inserts[0].id;
    const opt1 = await ruf('GET', `/proj/routing?optionen=${encodeURIComponent(st)}`);
    const pmOpt = optionenVon(opt1.j, st).find((x) => x.quelle === 'pm');
    if (pmOpt) pmKey = { quelle: 'pm', nr: pmOpt.nr, punkt: pmOpt.punkt };
    info(`the PM as key is named ${JSON.stringify(pmKey)} (${pmOpt ? 'from the option list' : 'literal: no option list or no pm entry'}, routing answer ${opt1.code})`);
    const zyk = await aendernRoh('R5 PM as key on a track stage', [{ befehl: 'insert_param_setzen', insert_id: st, param: 'key', wert: pmKey }]);
    notiere('AK15 the PM as key on a track stage is refused sidechain_zyklus', zyk.code === 400 && zyk.j?.fehler === 'sidechain_zyklus', grundVon(zyk));
    await aendern('R5 PM stage', [komp('master')]);
    const pmSt = (await projektJetzt()).master.inserts[0].id;
    const zyk2 = await aendernRoh('R5 PM as key on the PM stage', [{ befehl: 'insert_param_setzen', insert_id: pmSt, param: 'key', wert: pmKey }]);
    notiere('AK15 the PM as key on the PM stage is refused sidechain_zyklus', zyk2.code === 400 && zyk2.j?.fehler === 'sidechain_zyklus', grundVon(zyk2));
    const gut = await aendernRoh('R5 allowed key (control)', [{ befehl: 'insert_param_setzen', insert_id: st, param: 'key', wert: { quelle: 'spur', nr: 1, punkt: 'post' } }]);
    notiere('AK15 control: a track post key on a track stage is accepted (the refusals above are not a broken route)', gut.code === 200, grundVon(gut));
  });

  if (will('AK15')) await abschnitt('AK15 picker', async () => {
    // the picker chain without a browser: the page module is served, the server lists the options, the module builds the command, the project holds the key
    const seite = await ruf('GET', '/production/key_choice.js');
    notiere('AK15 picker: the page serves the key-choice module', seite.code === 200 && /export function schluesselBefehl/.test(seite.text), `GET /production/key_choice.js → ${seite.code}`);
    if (seite.code !== 200) return;
    const modul = path.join(ORDNER, 'schluessel_wahl.served.mjs');
    fs.writeFileSync(modul, seite.text);
    const M = await import(modul);
    await neuesProjekt('picker');
    await aendern('R5 picker set-up', [{ befehl: 'spur_neu', art: 'audio', name: 'K' }, { befehl: 'spur_neu', art: 'audio', name: 'B' }, { befehl: 'gruppenspur_neu', mitglieder: ['s1'] },
      { befehl: 'return_neu', name: 'R', hall: { an: false } }, komp('s2'), komp('r1'), komp('master')]);
    const p = await projektJetzt();
    const ids = { track: p.spuren.find((s) => s.id === 's2').inserts[0].id, ret: p.returns[0].inserts[0].id, pm: p.master.inserts[0].id };
    const faelle = [['track pre', ids.track, 'spur:1:pre'], ['track post', ids.track, 'spur:1:post'], ['group post on the return stage', ids.ret, 'grp:1:post'], ['return post on the PM stage', ids.pm, 'ret:1:post'],
      ['deck 1 on the track stage', ids.track, 'deck:1'], ['erz 1 on the track stage', ids.track, 'erz:1'], ['own (removes the key)', ids.track, 'own']];
    for (const [text, insertId, wert] of faelle) {
      const o = await ruf('GET', `/proj/routing?optionen=${encodeURIComponent(insertId)}`);
      const vorhanden = wert === 'own' || optionenVon(o.j, insertId).some((x) => M.wertVon(x.quelle, x.nr, x.punkt) === wert && x.erlaubt);
      const befehl = M.schluesselBefehl(insertId, wert);
      const r = await aendernRoh(`R5 picker ${text}`, [befehl]);
      const x = (await projektJetzt());
      const insert = [...x.spuren, ...(x.returns ?? []), x.master].flatMap((s) => s.inserts ?? []).find((i) => i.id === insertId);
      const haelt = M.schluesselWert(insert);
      notiere(`AK15 picker ${text}: offered by the server, the command the page builds is accepted, the project holds the choice`, vorhanden && r.code === 200 && haelt === wert, `option ${vorhanden ? 'offered' : 'NOT offered'} (routing ${o.code}), command ${JSON.stringify(befehl)} → ${grundVon(r)}, the stage holds ${haelt}`);
    }
    const gesperrt = M.schluesselGruppen(optionenVon((await ruf('GET', `/proj/routing?optionen=${encodeURIComponent(ids.track)}`)).j, ids.track), await projektJetzt()).flatMap((g) => g.eintraege).filter((e) => e.gesperrt);
    notiere('AK15 picker: a refused option carries the server\'s reason (group and return keys on a track stage)', gesperrt.length > 0 && gesperrt.every((e) => e.text), `${gesperrt.length} refused options, e.g. ${gesperrt[0]?.label}: ${gesperrt[0]?.text}`);
  });

  if (will('AK15')) await abschnitt('AK15 duck', async () => {
    await neuesProjekt('duck');
    await aendern('R5 duck set-up', [{ befehl: 'spur_neu', art: 'audio', name: 'K' }, { befehl: 'spur_neu', art: 'audio', name: 'B' }]);
    const v0 = (await ruf('GET', '/proj/verlauf')).j;
    const n0 = (v0.eintraege ?? v0).length;
    await aendern('R5 duck_durch_kick', [{ befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's1' }]);
    const v1 = (await ruf('GET', '/proj/verlauf')).j;
    const n1 = (v1.eintraege ?? v1).length;
    const stufen = async () => (await projektJetzt()).spuren.find((s) => s.id === 's2').inserts?.length ?? 0;
    const hat = await stufen();
    const stage = (await projektJetzt()).spuren.find((s) => s.id === 's2').inserts?.[0];
    await erwarte200('/proj/undo', await ruf('POST', '/proj/undo', { rev: await holeRev() }, CYPHER));
    const nachUndo = await stufen();
    notiere('AK15 duck_durch_kick is one history entry and one undo step: one compressor stage keyed by the kick (sc 1) with the Kick Sidechain values, undo removes it', n1 === n0 + 1 && hat === 1 && stage?.sc === 1 && stage?.art === 'komp' && stage?.werte?.schwelle === -30 && nachUndo === 0,
      `history ${n0} → ${n1}, stages ${hat} (sc ${stage?.sc}, schwelle ${stage?.werte?.schwelle}), after one undo ${nachUndo}`);
    await ruf('POST', '/proj/redo', { rev: await holeRev() }, CYPHER);
  });

  if (will('AK15')) await abschnitt('AK15 deck', async () => { await deckLive(); });
}

// ---- deck/1 live and in the export ---------------------------------------------------------------------------------------------------
function stromLesen() {
  const ac = new AbortController();
  const meldungen = [];
  let streamFehler = null;
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
          try { meldungen.push({ t: Date.now(), ...JSON.parse(block.slice(6)) }); } catch { /* half a line */ }
        }
      }
    } catch (e) { if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') streamFehler = e; }
  })();
  return { meldungen, stop: async () => { ac.abort(); await fertig; if (streamFehler) throw new Fehl(`/strom: ${streamFehler.message}`); } };
}
const udp = dgram.createSocket('udp4');
const kernPort = 47100 + 1000 * (instanz.charCodeAt(0) - 96);
const kernSende = (adresse, typen, werte) => new Promise((ok, nein) => udp.send(kodiere(adresse, typen, werte), kernPort, '127.0.0.1', (e) => (e ? nein(e) : ok())));
let osId = 900000 + (Date.now() % 90000);

async function deckLive() {
  const dm = AUFBAU.deck_material;
  await neuesProjekt('deck');
  await aendern('R5 deck set-up', [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'audio', name: 'Bass' }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }]);
  await aendern('R5 deck clip', [audio('s1', SHA['sinus-100'], 'bass')]);
  await aendern('R5 deck stage', [komp('s1', { key: { quelle: 'deck', nr: 1 } })]);
  const slot = (await projektJetzt()).spuren[0].inserts[0].slot;
  const kanal = `ins/komp/${slot}`;
  await geladen();
  // 1. the export of the project: dj_schluessel true, no reduction (no deck plays in a render)
  const e = await exportiere(0, 16);
  fs.copyFileSync(e.datei, path.join(ORDNER, 'ak15-deck-export.wav'));
  const x = leseWav(e.datei).l;
  const stetig = [];
  for (let c = 2; c <= 13; c++) stetig.push(db(pegel100(x, c * SCHLAG + 7200, 4800)) - db(pegel100(x, c * SCHLAG, 2400)));
  const maxAbw = Math.max(...stetig.map(Math.abs));
  notiere('AK15 deck/1 key, export: the answer carries dj_schluessel true and the stage does not reduce (bass level steady within 1 dB)', e.dj_schluessel === true && maxAbw < 1, `dj_schluessel ${e.dj_schluessel}, largest level swing ${fmt(maxAbw)} dB`);
  // 2. live: the transport runs, the deck is loaded and started
  const grWerte = (ms, ab) => ms.filter((m) => m.a === '/e/ins_gr' && m.f?.kanal === kanal && m.t >= ab).map((m) => ({ t: m.t, gr: Math.abs(m.f.gr_db) }));
  const sse = stromLesen();
  await warte(500);
  erwarte200('/proj/transport start', await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER));
  await warte(3000);
  const ohne = grWerte(sse.meldungen, 0);
  const maxOhne = ohne.length ? Math.max(...ohne.map((g) => g.gr)) : null;
  const tDeck = Date.now();
  await kernSende('/k/deck/laden', 'hsisdii', [BigInt(++osId), 'andreas', 1, dm.id, dm.basis_bpm, dm.fassung, 0]).catch((e) => info(`OSC send failed: ${e.message}`));
  await warte(2500);
  const lg = (await ruf('GET', '/lage')).j;
  info(`deck 1 after the load: ${JSON.stringify(lg.decks?.[0])}`);
  const st = await ruf('POST', '/deck/start', { deck: 1, ab: 'jetzt' });
  info(`POST /deck/start → ${grundVon(st)}`);
  await warte(6000);
  const lg2 = (await ruf('GET', '/lage')).j;
  info(`deck 1 playing: ${JSON.stringify(lg2.decks?.[0])}`);
  const mit = grWerte(sse.meldungen, tDeck + 2500);
  const maxMit = mit.length ? Math.max(...mit.map((g) => g.gr)) : null;
  await ruf('POST', '/deck/stopp', { deck: 1, ab: 'jetzt' });
  await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  await warte(300);
  await sse.stop();
  fs.writeFileSync(path.join(ORDNER, 'deck-ins-gr.jsonl'), sse.meldungen.filter((m) => m.a === '/e/ins_gr' || m.a === '/zustand/deck').map((m) => JSON.stringify(m)).join('\n'));
  // the clicks: every rise of the reported reduction across 3 dB is one click response; the first report above 3 dB after a report below it
  const kanten = [];
  mit.forEach((g, i) => { if (g.gr > 3 && (i === 0 || mit[i - 1].gr <= 3)) kanten.push(i); });
  info(`reports: ${ohne.length} without the deck (largest ${fmt(maxOhne)} dB), ${mit.length} with it (largest ${fmt(maxMit)} dB), rises above 3 dB: ${kanten.length}`);
  // "within the next 2 reports after the click": the click times come from the deck position reports (/zustand/deck quell_beat, a click on every integer source beat),
  // fitted to a straight line over the arrival times (the arrival jitter of single reports is far above the click spacing otherwise)
  const dk = sse.meldungen.filter((m) => m.a === '/zustand/deck' && m.f?.deck === 1 && m.f?.status === 2 && m.t >= tDeck + 3000).map((m) => ({ t: m.t, b: m.f.quell_beat }));
  let klickZeiten = [], rate = 0;
  if (dk.length > 10) {
    const n = dk.length, mt = dk.reduce((a, d) => a + d.t, 0) / n, mb = dk.reduce((a, d) => a + d.b, 0) / n;
    rate = dk.reduce((a, d) => a + (d.t - mt) * (d.b - mb), 0) / dk.reduce((a, d) => a + (d.t - mt) ** 2, 0);   // beats per ms
    for (let b = Math.ceil(dk[2].b); b <= Math.floor(dk[n - 3].b); b++) klickZeiten.push(mt + (b - mb) / rate);
  }
  const alle = sse.meldungen.filter((m) => m.a === '/e/ins_gr' && m.f?.kanal === kanal).map((m) => ({ t: m.t, gr: Math.abs(m.f.gr_db) }));
  const treffer = klickZeiten.map((tc) => { const naechste = alle.filter((g) => g.t >= tc).slice(0, 2); return naechste.some((g) => g.gr > 3); });
  info(`deck click rate ${fmt(rate * 1000)} beats/s, ${klickZeiten.length} clicks; reduction above 3 dB within the next 2 reports after ${treffer.filter(Boolean).length} of them`);
  notiere('AK15 deck/1 live: for every click of the deck the reduction above 3 dB is reported within the next 2 reports (the report rate is that of the page stream)', klickZeiten.length >= 8 && treffer.every(Boolean), `${treffer.filter(Boolean).length} of ${klickZeiten.length} clicks, reports at ${fmt(alle.length / ((alle.at(-1)?.t - alle[0]?.t) / 1000))} per second`);
  notiere('AK15 deck/1 live: a deck plays the click file, the stage keyed deck/1 reports a reduction above 3 dB in /e/ins_gr', maxMit !== null && maxMit > 3, `largest reduction ${fmt(maxMit)} dB in ${mit.length} reports, ${kanten.length} rises above 3 dB in 6 s`);
  notiere('AK15 deck/1 live, counter-case: without the click (no deck plays) 0 dB', ohne.length > 0 && maxOhne !== null && maxOhne < 0.5, `largest reduction ${fmt(maxOhne)} dB in ${ohne.length} reports`);
}

try {
  await lauf();
} catch (e) {
  if (e instanceof Fehl) notiere(punkt, false, e.message); else notiere('ABBRUCH', false, `${punkt}: ${e.stack ?? String(e)}`);
} finally {
  try { await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER); } catch { /* server gone */ }
  try { udp.close(); } catch { /* closed */ }
  for (const slug of eigeneSlugs) {
    const d = path.join(wurzel, slug);
    if (!/^r5-[a-z0-9-]+-\d{8}t\d{6}/i.test(slug)) { info(`slug ${slug} is not from this script, not deleted`); continue; }
    try { if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true }); }
    catch (e) { notiere('cleanup', false, e.message); }
  }
  info(`${eigeneSlugs.length} own projects deleted from ${wurzel}`);
}
fs.writeFileSync(path.join(ORDNER, 'bericht-r5.md'), `# Acceptance 1.10 AK13 to AK15 ${zeit} (${URL}, instance ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · report ${path.join(ORDNER, 'bericht-r5.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
