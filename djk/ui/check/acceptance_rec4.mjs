// Target acceptance, 1.8 slice 4 (count-in, punch, seams, start in a running transport; spec AK18 to AK21), against a TEST INSTANCE with the freshly built core
// (instances b, d or e only, never f, never the operation; the script refuses every other letter). Same locked call as acceptance_rec2.mjs:
//   * the caller holds flock /dev/shm/cypherdj-instanz-<i>.flock and, nested inside, flock "$CYPHERDJ_ECHTZEIT_SCHLOSS",
//   * writes the fixture ~/.config/cypherdj-<i>/geraete.json (input 1: profile pc-eingang on cypher_stumm-<i>:monitor_FL/FR, frei_fuer_cypher false),
//     records the unit states and the sha of that file, starts the instance (silent sink), runs this script, stops it, restores file and units.
//   node check/acceptance_rec4.mjs --url http://127.0.0.1:5<port> --bau <core build folder> [--ausgabe <folder>] [--instanz d]
//        [--nur Z1,Z2,Z3,Z4] [--ohne-blende] [--inserts eq,saett,lim [--inserts-spur <n>]]
//   --inserts: an insert chain on a track that is not the armed one, in the N = 2 count-in cell only (see rec_inserts.mjs); every other cell builds no chain.
//   --ohne-blende: mutation of Z3, the 96-sample seam fades are taken off the four clips through the real clip_aendern before the export; Z3 must then say FEHL.
// How it measures (software loop of the fixture: the null sink playback -> monitor is input 1, the profile of input 1 is measured here with cypherdj-latenz):
//   * Reference frame of the count-in and the entry: the core's sample counter. cypherdj-mitschnitt records the master from the audio ring of the core and says the
//     core sample of its first frame (s0); the entry is receipt 2 of the recording start (/q on /strom, status 2, ist_sample). The take itself starts at the entry,
//     so the count-in clicks lie before its first frame and cannot be indexed in it. The ring holds the master after the limiter, so a click generated at core
//     sample s sits at s + ausgang_vorhalt in it (limiter + channel latency + PDC since 1.8 T2). The start answer reports versatz = profile + ausgang_vorhalt (PDC
//     already inside, never added again); the part the ring sees is versatz - profile.
//   * The take is the loop capture of input 1 (the metronome through the loop), frame 0 = the entry; there the click of the entry beat sits at frame versatz.
// Criteria:
//   Z1  count-in (AK18): N = 1 and 4 at 120 BPM without inserts, N = 2 once with the chain: exactly 4N clicks before the entry, click i on
//       sample_at(entry - (4N - i) beats) + vorhalt, +-0, and the running clicks after the entry too; the take holds nothing of the count-in and its first click is at
//       frame versatz (+- the spread of the profile). N = 4 lasts 8 s: the start call must outlast the old 4 s receipt cap and still answer 200.
//       Negative: count-in off in a stopped transport gives no click before the entry (the slice 1 path).
//   Z2  punch (AK19): [4, 8) at 127 BPM over a first pass: the clip starts on beat 4 = sample(4), the click of beat 4 in /proj/export sits on sample(4) +-0, the
//       audio before and after (outside the seam fades) is bit-equal to the first pass (sha256 over the export windows) and the pieces keep the source of the first
//       take. Negative: punch off gives the whole pass (no clip edge on 4 or 8).
//   Z3  seams (AK20): a cosine of 440 Hz is the first pass, the same inverted the punched one (so the cut is a real jump); the largest step across beat 4 and
//       beat 8 in /proj/export is <= the largest step of the material. --ohne-blende must give FEHL.
//   Z4  running start (AK21): five runs, Andreas' transport running, REC at a random position: start_beat is the next bar (the position at the request is read from
//       /zustand/arr, positions within one beat of a bar line are not used), the core says start_sample = ursprung + (bar - start_beat) beats, the take's first
//       click is the accent at frame versatz, the transport keeps playing after the stop. Negative: transport stopped = the slice 1 path (no `laufend`, start_beat 0).
// Return: 0 all OK (NICHT_PRUEFBAR and INFO do not count), 1 at least one FEHL, 2 usage. Raw data go to rohdaten.json, the takes and exports to the output folder.
// Only the own projects (slug rec4-...) are removed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { starte, Fehl } from './w3a_target.mjs';
import { leseWav, schreibeWav } from './w1_wav.mjs';
import { kanaele } from './a2_measure.mjs';
import { klickOrte, urteilKlicks } from './rec_measure.mjs';
import { INSERT_OPTIONEN, INSERT_HILFE, inserts, baueInserts } from './rec_inserts.mjs';
import {
  RATE, samplesProBeat, sampleBei, zaehlSoll, klicksVorEinsatz, groessterSchritt, urteilNaht, shaFenster, naechsterTakt, weitVonTaktlinie, istAkzent, sinus,
} from './rec4_measure.mjs';
import { baueKatalog } from '../tests/support/catalog.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_rec4: usage: --url <test instance> --bau <core build folder> [--ausgabe <folder>] [--instanz <b|d|e>] '
    + '[--nur Z1,Z2,Z3,Z4] [--ohne-blende] ' + INSERT_HILFE + '\n');
  process.exit(2);
}
const z = starte('abnahme_rec4', 'rec4', { bau: { type: 'string' }, nur: { type: 'string' }, 'ohne-blende': { type: 'boolean' }, ...INSERT_OPTIONEN }, { ohneAufbau: true });
const INS = inserts('abnahme_rec4', z.opt);
const { CYPHER, notiere, info, instanz, warte } = z;
if (!z.opt.bau) { process.stderr.write('abnahme_rec4: --bau <core build folder> is required (cypherdj-latenz, cypherdj-mitschnitt)\n'); process.exit(2); }
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`abnahme_rec4: instance ${instanz} is not allowed: b, d or e only (never f)\n`); process.exit(2); }
const HIER = path.dirname(fileURLToPath(import.meta.url));
const BAU = path.resolve(z.opt.bau);
const NUR = z.opt.nur ? new Set(z.opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const PORT = Number(new globalThis.URL(z.URL).port);
const SHM = `/dev/shm/cypherdj-${instanz}`;
const GERAETE = path.join(os.homedir(), '.config', `cypherdj-${instanz}`, 'geraete.json');
const STUMM = `cypher_stumm-${instanz}`;
const PW = { PIPEWIRE_PROPS: `{ node.group = cypherdj-${instanz} node.lock-quantum = true }` };
const roh = {}, nichtPruefbar = [];
const npb = (kz, grund) => { nichtPruefbar.push(`${kz}: ${grund}`); info(`NICHT_PRUEFBAR ${kz}: ${grund}`); };
const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'absent');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const EING = { art: 'extern', paar: 1, modus: 'stereo' };

const prog = (programm, args, env = {}) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const jsonZeile = (t) => { try { return JSON.parse(t.trim().split('\n').filter(Boolean).pop()); } catch { return null; } };
const spitzeAbs = (x, von = 0, bis = x.length) => { let m = 0; for (let i = Math.max(0, von); i < Math.min(x.length, bis); i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };

// ---- /strom: every event of the page stream with its arrival time (receipts /q, /e/aufnahme, /zustand/arr) ----
const strom = { ereignisse: [], offen: new AbortController() };
async function stromStart() {
  const r = await fetch(z.URL + '/strom', { signal: strom.offen.signal });
  const dec = new globalThis.TextDecoder();
  void (async () => {
    let puf = '';
    try {
      for await (const stueck of r.body) {
        puf += dec.decode(stueck, { stream: true });
        let i;
        while ((i = puf.indexOf('\n\n')) >= 0) {
          const block = puf.slice(0, i); puf = puf.slice(i + 2);
          if (!block.startsWith('data: ')) continue;
          try {
            const m = JSON.parse(block.slice(6));
            if (['/q', '/e/aufnahme', '/zustand/arr', '/zustand/rec'].includes(m.a)) {
              strom.ereignisse.push({ t: Date.now(), a: m.a, f: m.f });
              if (strom.ereignisse.length > 20000) strom.ereignisse.splice(0, 5000);
            }
          } catch { /* half line */ }
        }
      }
    } catch { /* closed at the end */ }
  })();
}
const seit = (t0, a) => strom.ereignisse.filter((e) => e.t >= t0 && e.a === a);
const letztes = (a) => strom.ereignisse.findLast((e) => e.a === a)?.f ?? null;

// ---- setup: the profile of input 1 (software loop), as abnahme_rec2 Z1 ----
async function profilSetzen() {
  const aus = path.join(z.ORDNER, 'latenz-eingang1.json');
  const m = await prog('pw-jack', [path.join(BAU, 'cypherdj-latenz'), `${STUMM}:playback_FL`, `${STUMM}:monitor_FL`, '20', aus], PW);
  const mj = jsonZeile(m.out);
  roh.profil_messung = mj;
  notiere('setup: the software loop is measured (cypherdj-latenz, >= 20 runs)', m.rc === 0 && mj?.ok === true && mj.laeufe >= 20, `rc ${m.rc}: ${m.out.trim().split('\n').pop()}`);
  if (!mj?.ok) throw new Fehl('no latency profile, the take cells cannot be judged');
  const e = await prog('node', [path.join(HIER, '..', '..', 'testbench', 'input', 'latency_enter.mjs'), aus, String(PORT), '1', 'software', 'andreas']);
  const prof = (await z.erwarte200('/geraete', await z.ruf('GET', '/geraete')).j).eingaenge[0].latenz;
  roh.profil = prof;
  notiere('setup: the profile of input 1 holds the measurement', e.rc === 0 && prof && prof.samples === mj.samples, `entered rc ${e.rc}; profile ${JSON.stringify(prof)}`);
  if (!prof) throw new Fehl('profile not entered');
  return prof;
}

// ---- projects ----
const spurenListe = async () => (await z.aktuell()).projekt.spuren;
async function projekt(name, bpm, { vorzaehler = 0, metronom = true, mitInserts = false } = {}) {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  await warte(500);
  await z.neuesProjekt(name);
  await z.aendern(`rec4 ${name} tempo`, [{ befehl: 'tempo_setzen', bpm }]);
  await z.aendern(`rec4 ${name} track`, [{ befehl: 'spur_neu', art: 'audio', name: 'In' }]);
  const id = (await spurenListe())[0].id;
  await z.aendern(`rec4 ${name} arm`, [{ befehl: 'spur_aendern', spur_id: id, eingang: EING, arm: true }]);
  await z.aendern(`rec4 ${name} metronome`, [{ befehl: 'metronom_setzen', an: metronom, pegel_db: 0, ziel: 'master' }]);
  await z.aendern(`rec4 ${name} count-in`, [{ befehl: 'aufnahme_setzen', vorzaehler_takte: vorzaehler }]);
  const p = (await z.aktuell()).projekt;
  notiere(`${name}: the project holds ${bpm} BPM, the metronome on target master (the capture is the master), count-in ${vorzaehler}`,
    p.tempo_bpm === bpm && p.metronom.ziel === 'master' && p.metronom.an === metronom && (p.aufnahme?.vorzaehler_takte ?? 0) === vorzaehler,
    `tempo ${p.tempo_bpm}, metronome ${JSON.stringify(p.metronom)}, aufnahme ${JSON.stringify(p.aufnahme ?? null)}`);
  if (mitInserts) roh.inserts = { ...roh.inserts, [name]: await baueInserts(z, INS, id, `rec4 ${name}`) };
  await z.geladen();
  return id;
}
const projektSlug = () => z.eigeneSlugs.at(-1);
const projektOrdner = () => path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte', projektSlug());

// A start of the recording on the open project (Andreas). Returns the answer, how long the call took and the time before it.
async function start(von = 0) {
  const t0 = Date.now();
  const r = await z.ruf('POST', '/proj/aufnahme', { aktion: 'start', von_beat: von });
  return { r, ms: Date.now() - t0, t0 };
}
async function stopp() {
  const sp = await z.ruf('POST', '/proj/aufnahme', { aktion: 'stopp' });
  if (sp.code !== 200) throw new Fehl(`/proj/aufnahme stopp -> ${z.grundVon(sp)}`);
  const take = sp.j.takes?.[0];
  if (!take || take.fehler) throw new Fehl(`take: ${JSON.stringify(take)}`);
  return { sp, take, w: leseWav(take.datei) };
}
// The entry of a start: the receipt 2 of the recording id (the id that also got receipt 1 while the count-in ran, or the only status 2 with a beat).
function einsatzVon(t0) {
  const qs = seit(t0, '/q').map((e) => e.f);
  const stat2 = qs.filter((q) => Number(q.status) === 2 && Number(q.ist_sample) > 0);
  const mitEins = stat2.filter((q) => qs.some((o) => String(o.id) === String(q.id) && Number(o.status) === 1));
  return { rec: (mitEins.at(-1) ?? stat2.at(-1)) ?? null, alle: qs };
}
// Records the master with cypherdj-mitschnitt in the background; resolves with { l, s0 } when the seconds are over.
function mitschnitt(sekunden, name) {
  const dir = path.join(z.ORDNER, 'roh');
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, `${name}.f32`);
  const lauf = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', datei]).then((m) => {
    const j = jsonZeile(m.out);
    if (m.rc !== 0 || !j) throw new Fehl(`cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}`);
    const b = fs.readFileSync(datei);
    const { l } = kanaele(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4))));
    fs.rmSync(datei, { force: true });
    return { l, s0: j.s0 };
  });
  return lauf;
}
const schwelle = (x) => Math.max(0.25 * spitzeAbs(x), 0.01);

// ---- Z1 ----
async function zaehlZelle(takte, mitKette, prof) {
  const kz = `Z1 N=${takte}${mitKette ? ' with inserts' : ''}`, bpm = 120;
  await projekt(`z1-n${takte}${mitKette ? 'i' : ''}`, bpm, { vorzaehler: takte, mitInserts: mitKette });
  const sek = 4 * takte * 0.5 + 12;
  const cap = mitschnitt(sek, `z1-n${takte}${mitKette ? 'i' : ''}`);
  await warte(700);
  const s = await start(0);
  if (s.r.code !== 200) { await cap.catch(() => null); throw new Fehl(`${kz}: start -> ${z.grundVon(s.r)}`); }
  const V = s.r.j.spuren[0].versatz_samples;
  await warte(2300);
  const t = await stopp();
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  const c = await cap;
  const e = einsatzVon(s.t0);
  const entry = e.rec ? Number(e.rec.ist_sample) : null;
  const meld = seit(s.t0, '/e/aufnahme').map((x) => x.f).at(-1);
  roh[kz] = { versatz: V, profil: prof.samples, ms: s.ms, entry, ist_beat: e.rec ? Number(e.rec.ist_beat) : null, quittungen: e.alle, aufnahme: meld, s0: c.s0, frames: c.l.length };
  if (entry === null) { notiere(`${kz} the entry (receipt 2 of the start)`, false, `no receipt 2 on /strom: ${JSON.stringify(e.alle)}`); return; }
  const vorhalt = V - prof.samples;   // what the ring sees: limiter + channel + PDC
  info(`${kz}: versatz ${V} = profile ${prof.samples} + ausgang_vorhalt ${vorhalt}; entry core sample ${entry} (beat ${f2(roh[kz].ist_beat)}); capture from ${c.s0}, ${c.l.length} frames; the start call took ${s.ms} ms`);
  const orte = klickOrte(c.l, schwelle(c.l)).map((o) => c.s0 + o);
  const danach = 3, soll = zaehlSoll(entry, takte, bpm, vorhalt, danach);
  const u = urteilKlicks(orte, soll, 0);
  const vor = klicksVorEinsatz(orte, entry, vorhalt, bpm);
  roh[kz].orte = orte; roh[kz].soll = soll;
  notiere(`${kz} (AK18): exactly 4N = ${4 * takte} clicks before the entry`, vor === 4 * takte, `${vor} clicks before the entry, ${orte.length} in the capture`);
  notiere(`${kz} (AK18): click i on sample_at(entry - (4N - i) beats) + ausgang_vorhalt ${vorhalt}, the running clicks after the entry too, +-0`, u.ok,
    `${soll.length} clicks, deviation min ${u.min}, max ${u.max}${u.ok ? '' : ` -> ${u.grund}`}; first wanted ${soll[0]}, found ${orte[0]}`);
  const sp = (o) => { const i = o - c.s0; return spitzeAbs(c.l, i, i + 96); };
  const ref = Math.max(...orte.map(sp));
  const akzente = soll.slice(0, 4 * takte).map((o, i) => (i % 4 === 0) === istAkzent(sp(o), ref));
  notiere(`${kz} (AK18): the first click of each count-in bar is the accent`, akzente.every(Boolean), `levels ${soll.slice(0, 4 * takte).map((o) => f2(sp(o))).join(' ')}`);
  if (takte === 4) {
    notiere(`${kz}: the start call outlasts the old 4 s receipt cap and answers 200 (quittungsFristMs)`, s.ms > 4000 && s.r.code === 200, `${s.ms} ms, code ${s.r.code}`);
  }
  // the take: starts at the entry, nothing of the count-in in it, the click of the entry beat at frame versatz
  if (meld) notiere(`${kz}: the take starts at the entry`, Number(meld.start_sample) === entry, `/e/aufnahme start_sample ${meld.start_sample}, entry ${entry}`);
  const tol = Math.max(0, prof.streuung ?? 0);
  const to = klickOrte(t.w.l, schwelle(t.w.l));
  const still = spitzeAbs(t.w.l, 0, V - tol - 1);   // the loop leaves a residue of about 4e-9 (-168 dBFS) where nothing plays; a click is above 0.4
  notiere(`${kz}: the take holds nothing of the count-in (silent before the click of the entry beat, below 1e-6) and that click sits at frame versatz ${V} (+-${tol})`,
    to.length > 0 && still < 1e-6 && Math.abs(to[0] - V) <= tol, `first click in the take at ${to[0]}, peak before ${still.toExponential(2)}`);
  fs.copyFileSync(t.take.datei, path.join(z.ORDNER, `z1-n${takte}${mitKette ? 'i' : ''}-take.wav`));
}
async function z1(prof) {
  for (const [n, kette] of [[1, false], [2, !!INS], [4, false]]) {
    try { await zaehlZelle(n, kette, prof); } catch (e) { notiere(`Z1 N=${n} ABORT`, false, e instanceof Fehl ? e.message : (e.stack ?? String(e))); }
  }
  // negative control: count-in off, transport stopped = the slice 1 path: no click before the entry, the take begins at the transport start
  await projekt('z1-null', 120, { vorzaehler: 0 });
  const cap = mitschnitt(8, 'z1-null');
  await warte(700);
  const s = await start(0);
  if (s.r.code !== 200) throw new Fehl(`Z1 negative: start -> ${z.grundVon(s.r)}`);
  const V = s.r.j.spuren[0].versatz_samples;
  await warte(2300);
  const t = await stopp();
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  const c = await cap;
  const e = einsatzVon(s.t0), entry = e.rec ? Number(e.rec.ist_sample) : null;
  const meld = seit(s.t0, '/e/aufnahme').map((x) => x.f).at(-1);
  const start0 = entry ?? (meld ? Number(meld.start_sample) : null);
  const vorhalt = V - prof.samples;
  const orte = klickOrte(c.l, schwelle(c.l)).map((o) => c.s0 + o);
  roh.z1_null = { versatz: V, entry, start0, orte, quittungen: e.alle };
  if (start0 === null) { notiere('Z1 negative control: count-in off', false, 'no entry known'); return; }
  const u = urteilKlicks(orte, zaehlSoll(start0, 0, 120, vorhalt, 3), 0);
  notiere('Z1 negative control: count-in off, transport stopped: no click before the entry, the running clicks on the entry beat + ausgang_vorhalt +-0 (slice 1 path)',
    klicksVorEinsatz(orte, start0, vorhalt, 120) === 0 && u.ok && !('laufend' in s.r.j),
    `${klicksVorEinsatz(orte, start0, vorhalt, 120)} clicks before the entry, ${orte.length} in all; deviation min ${u.min} max ${u.max}${u.ok ? '' : ` -> ${u.grund}`}`);
  void t;
}

// ---- Z2 ----
async function z2() {
  const bpm = 127, beat = (b) => sampleBei(b, bpm);
  const id = await projekt('z2', bpm, { vorzaehler: 0 });
  const nimm = async (sek) => {
    const s = await start(0);
    if (s.r.code !== 200) throw new Fehl(`Z2: start -> ${z.grundVon(s.r)}`);
    await warte(sek * 1000);
    const t = await stopp();
    await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
    return { s, t };
  };
  const haupt = async () => (await spurenListe()).find((x) => x.id === id).clips.slice().sort((a, b) => a.start_beat - b.start_beat);
  const stumm = (an) => z.aendern(`rec4 z2 mute ${an}`, [{ befehl: 'spur_aendern', spur_id: id, mute: an }]);   // an earlier pass must not play into the loop of the next one
  // pass 1: 13 beats, no punch
  const p1 = await nimm(13 * 60 / bpm + 0.3);
  const c1 = await haupt();
  fs.copyFileSync(p1.t.take.datei, path.join(z.ORDNER, 'z2-pass1.wav'));
  const e1 = await z.exportiere(0, 12, 'z2-export-pass1');
  roh.z2 = { pass1: { clips: c1.map((c) => ({ start: c.start_beat, laenge: c.laenge_beats, sha: c.quelle.sha256 })), versatz: p1.s.r.j.spuren[0].versatz_samples } };
  info(`Z2 pass 1: ${c1.length} clip(s) ${JSON.stringify(c1.map((c) => [c.start_beat, c.laenge_beats]))}, take ${p1.t.take.frames} frames`);
  const quelle1 = c1[0].quelle.sha256;
  // pass 2 with the punch [4, 8)
  await z.aendern('rec4 z2 punch', [{ befehl: 'aufnahme_setzen', punch: { ein: true, aus: true, von_beat: 4, bis_beat: 8 } }]);
  await stumm(true);
  const p2 = await nimm(9 * 60 / bpm + 0.3);
  await stumm(false);
  const c2 = await haupt();
  roh.z2.pass2 = { clips: c2.map((c) => ({ start: c.start_beat, laenge: c.laenge_beats, offset_s: c.offset_s, fade_ein: c.fade_ein_beats, fade_aus: c.fade_aus_beats, sha: c.quelle.sha256 })), punch: p2.t.take.punch ?? null };
  info(`Z2 pass 2 (punch 4..8): clips ${JSON.stringify(c2.map((c) => [c.start_beat, c.laenge_beats]))}, answer punch ${JSON.stringify(p2.t.take.punch ?? null)}`);
  const punchClip = c2.find((c) => Math.abs(c.start_beat - 4) < 1e-9);
  notiere('Z2 (AK19): the punched take is one clip [4, 8) on the track and the first pass is cut around it',
    c2.length === 3 && !!punchClip && Math.abs(punchClip.laenge_beats - 4) < 1e-9 && c2[0].start_beat === 0 && Math.abs(c2[0].laenge_beats - 4) < 1e-9
    && Math.abs(c2[2].start_beat - 8) < 1e-9,
    `clips ${JSON.stringify(c2.map((c) => [c.start_beat, c.laenge_beats]))}`);
  if (!punchClip) throw new Fehl('Z2: no clip at beat 4, the rest cannot be judged');
  notiere('Z2 (AK19): the clip starts on sample(4) of the project', sampleBei(punchClip.start_beat, bpm) === beat(4), `start_beat ${punchClip.start_beat} = sample ${sampleBei(punchClip.start_beat, bpm)}, sample(4) ${beat(4)}`);
  notiere('Z2 (AK19): the pieces around the punch keep the source of the first take', c2[0].quelle.sha256 === quelle1 && c2[2].quelle.sha256 === quelle1 && punchClip.quelle.sha256 !== quelle1,
    `outer ${c2[0].quelle.sha256.slice(0, 12)} / ${c2[2].quelle.sha256.slice(0, 12)}, first take ${quelle1.slice(0, 12)}, punch ${punchClip.quelle.sha256.slice(0, 12)}`);
  const e2 = await z.exportiere(0, 12, 'z2-export-punch');
  // outside parts bit-equal to the first pass (outside the 96-sample fades, 200 samples margin)
  const RAND = 200, s4 = beat(4), s8 = beat(8), s12 = beat(12);
  const h = (w, a, b) => shaFenster(w.l, a, b);
  const vorn = [h(e1, 0, s4 - RAND), h(e2, 0, s4 - RAND)], hinten = [h(e1, s8 + RAND, s12), h(e2, s8 + RAND, s12)];
  notiere('Z2 (AK19): the audio before the punch-in is bit-equal to the first pass (sha256 of the export)', vorn[0] === vorn[1], `[0, ${s4 - RAND}) ${vorn[0].slice(0, 12)} / ${vorn[1].slice(0, 12)}`);
  notiere('Z2 (AK19): the audio after the punch-out is bit-equal to the first pass (sha256 of the export)', hinten[0] === hinten[1], `[${s8 + RAND}, ${s12}) ${hinten[0].slice(0, 12)} / ${hinten[1].slice(0, 12)}`);
  roh.z2.hashes = { vorn, hinten };
  // The click of beat 4 is the first thing of the punched clip and of beat 8 the first of the right piece: the seam fades of 96 samples would hide the onset of
  // exactly these two clicks. So the fades are taken off the three clips (the real clip_aendern) and the export is measured again; the audio is the same otherwise.
  await z.aendern('rec4 z2 no fades', c2.map((c) => ({ befehl: 'clip_aendern', clip_id: c.id, fade_ein_beats: 0, fade_aus_beats: 0 })));
  const e2n = await z.exportiere(0, 12, 'z2-export-punch-ohne-blende');
  const orte = klickOrte(e2n.l, schwelle(e2n.l));
  const nahe = (sm) => orte.filter((o) => Math.abs(o - sm) <= 1000).sort((a, b) => Math.abs(a - sm) - Math.abs(b - sm))[0];
  const abw = [];
  for (let b = 0; b < 12; b++) { const o = nahe(beat(b)); abw.push(o === undefined ? null : o - beat(b)); }
  roh.z2.klicks_export = { orte, abweichung_je_beat: abw };
  notiere('Z2 (AK19): the click of beat 4 in /proj/export sits on sample(4) +-0 (the clip start with the offset applied), and so does the click of beat 8',
    nahe(beat(4)) === beat(4) && nahe(beat(8)) === beat(8), `beat 4: found ${nahe(beat(4))}, sample(4) ${beat(4)}; beat 8: found ${nahe(beat(8))}, sample(8) ${beat(8)}`);
  notiere('Z2 (AK19): every click of beats 0..11 in the export sits on its sample +-0 (127 BPM: samples per beat 22677.165)', abw.every((a) => a === 0), `deviations ${abw.map((a) => (a === null ? 'none' : a)).join(' ')}`);
  // negative control: punch off gives the whole pass
  await z.aendern('rec4 z2 punch off', [{ befehl: 'aufnahme_setzen', punch: { ein: false, aus: false } }]);
  await stumm(true);
  const p3 = await nimm(9 * 60 / bpm + 0.3);
  await stumm(false);
  const c3 = await haupt();
  roh.z2.ohne_punch = { clips: c3.map((c) => ({ start: c.start_beat, laenge: c.laenge_beats })), punch: p3.t.take.punch ?? null };
  const kante = c3.some((c) => [4, 8].some((b) => Math.abs(c.start_beat - b) < 1e-9 || Math.abs(c.start_beat + c.laenge_beats - b) < 1e-9));
  notiere('Z2 negative control: punch off gives the whole pass (the new clip starts on 0 and no clip edge sits on beat 4 or 8)',
    !kante && Math.abs(c3[0].start_beat) < 1e-9 && c3[0].laenge_beats > 8.5 && p3.t.take.punch === undefined,
    `clips ${JSON.stringify(c3.map((c) => [c.start_beat, c.laenge_beats]))}, punch in the answer ${JSON.stringify(p3.t.take.punch ?? null)}`);
}

// ---- Z3 ----
async function z3() {
  const bpm = 120, beat = (b) => sampleBei(b, bpm);
  const KAT = process.env.CYPHERDJ_KATALOG;
  if (!KAT) { npb('Z3', 'CYPHERDJ_KATALOG is not set: the sine material needs a catalogue the instance reads (the caller sets it, see run.sh)'); return; }
  await projekt('z3', bpm, { vorzaehler: 0, metronom: false });
  const inId = (await spurenListe())[0].id;
  await z.aendern('rec4 z3 source track', [{ befehl: 'spur_neu', art: 'audio', name: 'Src' }]);
  const srcId = (await spurenListe()).find((s) => s.id !== inId).id;
  // The material: a cosine of 440 Hz (stereo, 10 s) and the same inverted, with a catalogue holding both, in the folder of the catalogue of the instance (the caller
  // removes it). At 120 BPM bar 4 and bar 8 are whole periods, so the cosine is at its peak there and the inverted one at the opposite peak: the cut is a jump of
  // twice the peak. A sine would be 0 at both bars and the cut would be no jump at all. The jump stays large when the recorded sines sit a few dozen samples
  // off the bar grid (measured: the phase of a recorded sine differs from run context to run context, the clicks do not), the fades still stay below the
  // largest step of a 440 Hz sine.
  const dir = path.dirname(KAT);
  fs.mkdirSync(dir, { recursive: true });
  const wavDatei = (name, amp) => {
    const mono = sinus(RATE * 10, 440, amp, Math.PI / 2), st = new Float32Array(mono.length * 2);
    for (let i = 0; i < mono.length; i++) { st[2 * i] = mono[i]; st[2 * i + 1] = mono[i]; }
    const pfad = path.join(dir, `${name}.wav`);
    schreibeWav(pfad, st);
    return { pfad, sha: sha(pfad) };
  };
  const A = wavDatei('rec4-kosinus', 0.5), B = wavDatei('rec4-kosinus-invers', -0.5);
  baueKatalog(dir, [{ n: 1, sha: A.sha, typ: 'track', werk_id: 1, titel: 'rec4 cosine 440', bpm, dauer_s: 10, pfad: A.pfad }, { n: 2, sha: B.sha, typ: 'track', werk_id: 2, titel: 'rec4 cosine 440 inverted', bpm, dauer_s: 10, pfad: B.pfad }]);
  const setzeQuelle = async (q, name) => {
    const alt = (await spurenListe()).find((s) => s.id === srcId).clips.map((c) => c.id);
    await z.aendern(`rec4 z3 source ${name}`, [...alt.map((clip_id) => ({ befehl: 'clip_loeschen', clip_id })),
      { befehl: 'clip_neu', spur_id: srcId, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: q.sha, name }]);
    await z.geladen();
  };
  const nimm = async (sek) => {
    const s = await start(0);
    if (s.r.code !== 200) throw new Fehl(`Z3: start -> ${z.grundVon(s.r)}`);
    await warte(sek * 1000);
    const t = await stopp();
    await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
    return t;
  };
  await setzeQuelle(A, 'cosine 440');
  const t1 = await nimm(5.3);
  notiere('Z3 setup: the first pass carries the 440 Hz cosine (peak above 0.3 in the take)', spitzeAbs(t1.w.l) > 0.3, `${t1.take.frames} frames, peak ${f2(spitzeAbs(t1.w.l))}`);
  const quellStumm = (an) => z.aendern(`rec4 z3 mute source ${an}`, [{ befehl: 'spur_aendern', spur_id: srcId, mute: an }]);   // the exports hold the recorded clips only
  await quellStumm(true);
  const e1 = await z.exportiere(0, 10, 'z3-export-pass1');
  await quellStumm(false);
  await setzeQuelle(B, 'cosine 440 inverted');
  await z.aendern('rec4 z3 mute In', [{ befehl: 'spur_aendern', spur_id: inId, mute: true }]);   // the first take must not play into the loop again
  await z.aendern('rec4 z3 punch', [{ befehl: 'aufnahme_setzen', punch: { ein: true, aus: true, von_beat: 4, bis_beat: 8 } }]);
  const t2 = await nimm(4.8);
  await z.aendern('rec4 z3 unmute In', [{ befehl: 'spur_aendern', spur_id: inId, mute: false }]);
  const clips = (await spurenListe()).find((s) => s.id === inId).clips.slice().sort((a, b) => a.start_beat - b.start_beat);
  roh.z3 = { clips: clips.map((c) => ({ start: c.start_beat, laenge: c.laenge_beats, fade_ein: c.fade_ein_beats, fade_aus: c.fade_aus_beats })), take2: t2.take.frames };
  info(`Z3 clips after the punch: ${JSON.stringify(clips.map((c) => [c.start_beat, c.laenge_beats, c.fade_ein_beats, c.fade_aus_beats]))}`);
  if (z.opt['ohne-blende']) {
    info('Z3 MUTATION --ohne-blende: the seam fades are taken off the clips');
    await z.aendern('rec4 z3 mutation no fades', clips.map((c) => ({ befehl: 'clip_aendern', clip_id: c.id, fade_ein_beats: 0, fade_aus_beats: 0 })));
  } else {
    const fade = 96 / RATE * bpm / 60;   // 96 samples in beats
    const mitte = clips.find((c) => Math.abs(c.start_beat - 4) < 1e-9);
    notiere('Z3 (AK20): the punched clip carries the 96-sample fades on both edges and the first pass the matching ones', clips.length === 3 && !!mitte && Math.abs(mitte.fade_ein_beats - fade) < 1e-9
      && Math.abs(mitte.fade_aus_beats - fade) < 1e-9 && Math.abs(clips[0].fade_aus_beats - fade) < 1e-9 && Math.abs(clips[2].fade_ein_beats - fade) < 1e-9,
    `fade ${fade} beats; ${JSON.stringify(clips.map((c) => [c.fade_ein_beats, c.fade_aus_beats]))}`);
  }
  await quellStumm(true);
  const e2 = await z.exportiere(0, 10, 'z3-export-punch');
  const s4 = beat(4), s8 = beat(8), W = 64, M = 200;
  // the first 4000 samples hold the start-up of the source (the cosine starts at its peak, the playback runs in; measured: a step of 0.055 at sample 1277), no part of the steady material: from 4000 on
  const material = Math.max(groessterSchritt(e1.l, 4000, e1.l.length), groessterSchritt(e2.l, 4000, s4 - M), groessterSchritt(e2.l, s4 + M, s8 - M), groessterSchritt(e2.l, s8 + M, e2.l.length));
  const naht = (sm) => groessterSchritt(e2.l, sm - W, sm + W);
  roh.z3.schritte = { material, naht4: naht(s4), naht8: naht(s8), material_pass1: groessterSchritt(e1.l, 4000, e1.l.length) };
  for (const [name, sm] of [['4', s4], ['8', s8]]) {
    const u = urteilNaht(naht(sm), material);
    notiere(`Z3 (AK20): the largest step across beat ${name} (+-${W} samples) is not larger than the largest step of the material${z.opt['ohne-blende'] ? ' [mutation: no fades]' : ''}`, u.ok,
      `seam ${u.schrittNaht.toFixed(4)} against material ${u.schrittMaterial.toFixed(4)} (ratio ${f2(u.verhaeltnis)})`);
  }
}

// ---- Z4 ----
async function z4(prof) {
  const bpm = 120;
  const inId = await projekt('z4', bpm, { vorzaehler: 0 });
  await z.aendern('rec4 z4 mute In', [{ befehl: 'spur_aendern', spur_id: inId, mute: true }]);   // the takes of earlier runs must not play into the loop again
  await z.geladen();
  const zufall = () => 1.2 + Math.random() * 3.4;
  const tol = Math.max(0, prof.streuung ?? 0);
  roh.z4 = [];
  for (let lauf = 1; lauf <= 5; lauf++) {
    const kz = `Z4 run ${lauf}`;
    const tr = await z.ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 });
    if (tr.code !== 200) throw new Fehl(`${kz}: transport start -> ${z.grundVon(tr)}`);
    await warte(zufall() * 1000);
    let p0 = null;
    for (let i = 0; i < 12; i++) {   // a position at least one beat from the bar lines (the request and the start take a while: half a beat was too close, a false FEHL), else wait a little (the stream is at most 50 ms old)
      p0 = letztes('/zustand/arr');
      if (p0 && Number(p0.status) === 2 && weitVonTaktlinie(Number(p0.projekt_beat), 1)) break;
      await warte(300);
    }
    if (!p0 || Number(p0.status) !== 2) throw new Fehl(`${kz}: the transport does not play (${JSON.stringify(p0)})`);
    const pos = Number(p0.projekt_beat), erw = naechsterTakt(pos);
    const s = await start(0);
    if (s.r.code !== 200) throw new Fehl(`${kz}: start -> ${z.grundVon(s.r)}`);
    const V = s.r.j.spuren[0].versatz_samples;
    await warte(2600);
    const t = await stopp();
    const arrNach = letztes('/zustand/arr');
    await warte(300);
    const arrSpaeter = letztes('/zustand/arr');
    const meld = seit(s.t0, '/e/aufnahme').map((x) => x.f).at(-1);
    const arrBei = seit(s.t0, '/zustand/arr').map((x) => x.f).find((f) => Number(f.status) === 2 && Number(f.ursprung_sample) > 0) ?? p0;
    const erwSample = Number(arrBei.ursprung_sample) + Math.round((erw - Number(arrBei.start_beat)) * samplesProBeat(bpm));
    await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
    await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);
    const to = klickOrte(t.w.l, schwelle(t.w.l));
    const ref = Math.max(...to.slice(0, 6).map((o) => spitzeAbs(t.w.l, o, o + 96)));
    const akz = to.length > 0 && istAkzent(spitzeAbs(t.w.l, to[0], to[0] + 96), ref) && (to.length < 2 || !istAkzent(spitzeAbs(t.w.l, to[1], to[1] + 96), ref));
    roh.z4.push({ lauf, pos, erw, start_beat: s.r.j.start_beat, laufend: s.r.j.laufend, versatz: V, start_sample: meld ? Number(meld.start_sample) : null, erwSample, erster_klick: to[0] });
    notiere(`${kz} (AK21): started at beat ${f2(pos)} of the running transport, the take begins on the next bar ${erw}`, s.r.j.laufend === true && Math.abs(s.r.j.start_beat - erw) < 1e-6,
      `start_beat ${s.r.j.start_beat}, laufend ${s.r.j.laufend}`);
    notiere(`${kz} (AK21): the core says the take starts on the bar sample +-0`, !!meld && Number(meld.start_sample) === erwSample, `start_sample ${meld?.start_sample}, ursprung ${arrBei.ursprung_sample} + (${erw} - ${arrBei.start_beat}) beats = ${erwSample}`);
    notiere(`${kz} (AK21): the first click of the take is the accent of the bar at frame versatz ${V} (+-${tol})`, akz && Math.abs(to[0] - V) <= tol, `first click ${to[0]}, ${to.length} clicks, accent ${akz}`);
    notiere(`${kz}: stopping the recording leaves the transport playing`, Number(arrNach?.status) === 2 && Number(arrSpaeter?.status) === 2, `status after the stop ${arrNach?.status}, 300 ms later ${arrSpaeter?.status}`);
  }
  // negative control: transport stopped = the slice 1 path
  const s = await start(0);
  if (s.r.code !== 200) throw new Fehl(`Z4 negative: start -> ${z.grundVon(s.r)}`);
  const V = s.r.j.spuren[0].versatz_samples;
  await warte(2600);
  const t = await stopp();
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  const to = klickOrte(t.w.l, schwelle(t.w.l));
  roh.z4_negativ = { antwort: s.r.j, erster_klick: to[0], versatz: V };
  notiere('Z4 negative control: transport stopped is the slice 1 path (no `laufend`, start_beat 0, the first click of the take at frame versatz)',
    !('laufend' in s.r.j) && s.r.j.start_beat === 0 && to.length > 0 && Math.abs(to[0] - V) <= tol, `answer ${JSON.stringify({ start_beat: s.r.j.start_beat, laufend: s.r.j.laufend })}, first click ${to[0]}, versatz ${V}`);
}

// ---- run ----
const gewollt = (n) => !NUR || NUR.has(n);
async function lauf() {
  info(`abnahme_rec4 against ${z.URL} (instance ${instanz}), core build folder ${BAU}, fixture ${GERAETE} sha ${sha(GERAETE).slice(0, 12)}${z.opt['ohne-blende'] ? ', MUTATION --ohne-blende' : ''}`
    + `${INS ? `, chain ${INS.namen.join(',')} in the N = 2 cell` : ''}`);
  await stromStart();
  let prof = null;
  if (['Z1', 'Z4'].some(gewollt)) {
    z.punkt = 'setup';
    try { prof = await profilSetzen(); } catch (e) { notiere('setup ABORT', false, e instanceof Fehl ? e.message : (e.stack ?? String(e))); return; }
  }
  for (const [name, f] of [['Z1', z1], ['Z2', z2], ['Z3', z3], ['Z4', z4]]) {
    if (!gewollt(name)) continue;
    z.punkt = name;
    info(`--- ${name} ---`);
    try { await f(prof); } catch (e) { notiere(`${name} ABORT`, false, e instanceof Fehl ? e.message : (e.stack ?? String(e))); }
    await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  }
}
try { await lauf(); } finally {
  strom.offen.abort();
  roh.nicht_pruefbar = nichtPruefbar;
  fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
  if (nichtPruefbar.length) info(`NICHT_PRUEFBAR (${nichtPruefbar.length}): ${nichtPruefbar.join(' | ')}`);
}
await z.ende('Recording slice 4 target acceptance (AK18 to AK21)', /^rec4-/);
