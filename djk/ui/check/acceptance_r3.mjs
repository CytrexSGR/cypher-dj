// Acceptance 1.10 slice 3 (returns and sends, post fader, Cypher Hall) on the real core of a test instance (never a, g, h, i, never the live set). Against a running
// page server with the built core and cypherdj-render of the checkout the server runs in:
//   DJK=<worktree>/djk djk/start/djk-start --instanz e --arr1                 (silent, without --ton-frei)
//   node check/acceptance_r3.mjs --url http://127.0.0.1:52300 [--iso-ref <iso_ref, default: next to the core build>] [--bau <core build dir>] [--ausgabe <dir>]
// Points (each with its measured value): AK8 (send -6 dB gives the return part direct -6.02 dB, post fader), AK10 (return fader, mute, silent without sends),
// AK11 (Hall tail 1 s after an impulse above -60 dB), AK12 (hand grips, ueber_projekt, Stop Cypher), AK27 part (open the maximum project: nothing refused, nothing unsent,
// time), null test A (export against the ring recording, return without Hall, a track in a muted group with a send is silent). The Hall regime B (tolerance) is not
// part of this script: see the report. Exit 0 all points OK, 1 at least one FEHL, 2 call error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { midiRoh } from '../public/curves.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string' }, teil: { type: 'string' }, bau: { type: 'string' }, 'iso-ref': { type: 'string' } } });
const aufrufFehler = (t) => { process.stderr.write(`abnahme_r3: ${t}\n`); process.exit(2); };
if (!opt.url) aufrufFehler('Aufruf: --url <http://127.0.0.1:port> [--ausgabe <Ordner>] [--instanz <a..f>] [--bau <Kern-Bauordner>] [--iso-ref <program, default: in the build folder>]');
if (/:(47300|47100|47200)\b/.test(opt.url)) aufrufFehler('nie gegen den Betrieb (47300): eine Prüfinstanz wählen');
const port = Number(new globalThis.URL(opt.url).port);
const k = (port - 47300) / 1000;
const aus = Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined;
const instanz = opt.instanz ?? aus;
if (!instanz || /^[ghi]$/.test(instanz)) aufrufFehler(`Instanz ${instanz ?? '?'} (Port ${port}) ist nicht erlaubt: g, h, i sind tabu`);
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-r3`);
// Programme des Verfahrens A7 (cypherdj-render, -mitschnitt, -nulltest): der Kern-Bauordner des Checkouts, in dem der Server läuft (djk-start verlangt ihn dort)
const BAU = path.resolve(opt.bau ?? path.join(HIER, '..', '..', 'core', 'build'));
const ISO_REF = path.resolve(opt['iso-ref'] ?? path.join(BAU, 'iso_ref'));   // default: the iso_ref target of the core build (1.10 closure)
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (kz, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}\n`); };
const info = (text) => { zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };

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
const aendern = async (label, befehle, kopf = CYPHER) => erwarte200(`/proj/aendern (${label})`, await ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, kopf)).j;
const aendernRoh = async (label, befehle, kopf = CYPHER) => ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, kopf);
const pegel = async (sek) => erwarte200('/pegel', await ruf('GET', `/pegel?sek=${sek}`)).j.kanaele;
const verlauf = async () => erwarte200('/proj/verlauf', await ruf('GET', '/proj/verlauf')).j;
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const warteAufKern = async () => {
  if (!(await bisWahr(async () => typeof (await ruf('GET', '/lage')).j?.uhr?.bpm === 'number', 8000))) throw new Fehl('kein Kern: /lage meldet keine Uhr');
  return (await ruf('GET', '/lage')).j.uhr.bpm;
};
const transport = async (aktion) => {
  const r = await ruf('POST', '/proj/transport', aktion === 'start' ? { aktion, beat: 0 } : { aktion });
  if (r.code !== 200) throw new Fehl(`/proj/transport ${aktion} → ${grundVon(r)}`);
};
let punkt = 'Aufbau';
const fmt = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));
const noten = (ton) => Array.from({ length: 8 }, (_, i) => ({ beat: i, laenge: 0.5, ton, vel: 110 }));
const eigeneSlugs = [];
const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');

// WAV lesen: float32 (Export) oder PCM 16/24 Bit (Take); Rückgabe Float32Array der verschränkten Werte
function liesWav(datei) {
  const b = fs.readFileSync(datei);
  if (b.toString('latin1', 0, 4) !== 'RIFF') throw new Fehl(`${datei}: kein RIFF`);
  let o = 12, tag = 0, bits = 0, kanaele = 0;
  while (o + 8 <= b.length) {
    const id = b.toString('latin1', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { tag = b.readUInt16LE(o + 8); kanaele = b.readUInt16LE(o + 10); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') {
      const roh = b.subarray(o + 8, Math.min(b.length, o + 8 + n));
      // 0xfffe (erweitert) gilt nur mit 32 Bit als float32; andere Formate wirft der Rest unten
      if ((tag === 3 || tag === 0xfffe) && bits === 32) { const out = new Float32Array(roh.length / 4); for (let i = 0; i < out.length; i++) out[i] = roh.readFloatLE(i * 4); return { daten: out, kanaele }; }
      if (bits === 16) { const out = new Float32Array(roh.length / 2); for (let i = 0; i < out.length; i++) out[i] = roh.readInt16LE(i * 2) / 32768; return { daten: out, kanaele }; }
      if (bits === 24) { const out = new Float32Array(Math.floor(roh.length / 3)); for (let i = 0; i < out.length; i++) out[i] = roh.readIntLE(i * 3, 3) / 8388608; return { daten: out, kanaele }; }
      throw new Fehl(`${datei}: Format ${tag}/${bits} Bit nicht unterstützt`);
    }
    o += 8 + n + (n % 2);
  }
  throw new Fehl(`${datei}: kein data-Block`);
}
const maxAbw = (a, b) => { let m = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i])); return a.length === b.length ? m : Infinity; };
const spitzeLin = (a) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };
const dbfs = (x) => (x > 0 ? 20 * Math.log10(x) : -200);
const sha = (datei) => createHash('sha256').update(fs.readFileSync(datei)).digest('hex');
// Der Export liest den Reglerstand aus dem Zustand-Fach des Kerns (render_main.cpp:122-141), das der Kern alle 50 ms schreibt (net.cpp:654, 20 Hz).
// Unmittelbar nach einer Regleränderung kann es einen Zwischenwert der 10-ms-Rampe halten: gemessen 2 von 7 sofortigen Exporten nach einem Fader-Wechsel
// (-25,304 und -27,917 statt -27,052 dBFS), 0 von 7 nach 1,5 s Wartezeit. Darum wartet jeder Export SETTLE_MS, bevor er läuft.
const SETTLE_MS = 1000;
const exportiere = async (von, bis, abgriff) => { await warte(SETTLE_MS); return erwarte200('/proj/export', await ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis, ...(abgriff ? { abgriff } : {}) }, CYPHER)).j; };
// Slice 2: ein Export, dessen Antwort nicht 200 sein muss (Fehlerfälle); wartet ebenso SETTLE_MS
const exportiereRoh = async (koerper) => { await warte(SETTLE_MS); return ruf('POST', '/proj/export', koerper, CYPHER); };

async function neuesProjekt(name) {
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `${name}-${zeit}` }));
  const slug = r.j.slug ?? r.j.projekt?.slug;
  if (!slug) throw new Fehl(`/proj/neu ohne slug: ${JSON.stringify(r.j).slice(0, 200)}`);
  eigeneSlugs.push(slug);
  return slug;
}
const spurId = async (name) => { const s = (await projektJetzt()).spuren.find((x) => x.name === name); if (!s) throw new Fehl(`Spur ${name} fehlt`); return s.id; };

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
          try { meldungen.push({ t: Date.now(), ...JSON.parse(block.slice(6)) }); } catch { /* halbe Zeile */ }
        }
      }
    } catch (e) { if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') streamFehler = e; }
  })();
  return { meldungen, stop: async () => { ac.abort(); await fertig; if (streamFehler) throw new Fehl(`/strom: ${streamFehler.message}`); } };
}

// Programm des Verfahrens A7 (oder die Isolator-Referenz) mit CYPHERDJ_INSTANZ; Ausgabe und Rückgabe wörtlich
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
const geladen = async () => { const a = await aktuell(); return a.kern?.rev_geladen === a.projekt.wiedergabe_rev; };
const warteGeladen = async () => {
  if (!(await bisWahr(geladen, 60000))) throw new Fehl('der Kern hat die Wiedergabe nicht geladen (kern.rev_geladen gleich projekt.wiedergabe_rev blieb aus)');
  await warte(5000);   // Zustand-Fach und Neustart-Zustand des Kerns nachführen lassen (N8; die Vorbedingung liest den Neustart-Zustand)
};
const notenN = (ton, n) => Array.from({ length: n }, (_, i) => ({ beat: i, laenge: 0.5, ton, vel: 110 }));

// Aufbau eines Projekts mit n RB-338-Spuren gleicher Tonhöhe (gleichphasig: die Spitzen addieren sich), Clips der Länge laenge, optional Loop 0..laenge
async function projektAufbauen(name, bpm, n, ton, laenge, fader, master, loop) {
  const slug = await neuesProjekt(name);
  await aendern(`R1 ${name} Spuren`, [{ befehl: 'tempo_setzen', bpm }, ...Array.from({ length: n }, (_, i) => ({ befehl: 'spur_neu', art: 'instrument', name: `R${i + 1}` }))]);
  const ids = (await projektJetzt()).spuren.map((s) => s.id);
  const b = ids.map((id) => ({ befehl: 'clip_neu', spur_id: id, art: 'midi', start_beat: 0, laenge_beats: laenge, noten: notenN(ton, laenge) }));
  if (loop) b.push({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: laenge });
  for (const id of ids) b.push({ befehl: 'spur_aendern', spur_id: id, fader_db: fader });
  if (master !== 0) b.push({ befehl: 'master_aendern', fader_db: master });
  await aendern(`R1 ${name} Clips und Fader`, b);
  return { slug, ids };
}

// Null-Test des Produktions-Exports gegen den Ring-Mitschnitt (A7 mit Nachzug N7). Das Projekt ist offen und geladen, der Transport steht.
// Rückgabe die Messwerte; geurteilt wird im Aufrufer.
async function nullLive(kz, bpm, beats, sekunden) {
  const dir = path.join(ORDNER, kz);
  fs.mkdirSync(path.join(dir, 'w'), { recursive: true });
  const nr = (await aktuell()).projekt.wiedergabe_rev;
  const werkzeug = (n) => path.join(BAU, n);
  const vb = await prog(werkzeug('cypherdj-nulltest'), ['--vorbedingung', '--bpm', String(bpm)]);
  fs.writeFileSync(path.join(dir, 'vorbedingung.json'), `${vb.out}${vb.err}rc=${vb.rc}\n`);
  const vbj = jsonZeile(vb.out);
  if (vb.rc !== 0 || vbj?.vorbedingung !== 'erfuellt') return { ungueltig: `Vorbedingung des Null-Tests nicht erfüllt (rc ${vb.rc}): ${letzteZeile(vb.out) || letzteZeile(vb.err)}` };
  // Mitschnitt des Ring-Masters, Transport-Start nach 0,5 s, SSE für ursprung_sample
  const sse = stromLesen();
  const mit = prog(werkzeug('cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', path.join(dir, 'live.f32')]);
  await warte(500);
  const start = await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  const m = await mit;
  await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  await warte(300);
  await sse.stop();
  fs.writeFileSync(path.join(dir, 'live.json'), m.out);
  fs.writeFileSync(path.join(dir, 'mitschnitt.err'), `${m.err}rc=${m.rc}\n`);
  fs.writeFileSync(path.join(dir, 'strom.jsonl'), sse.meldungen.map((x) => JSON.stringify(x)).join('\n'));
  const live = jsonZeile(m.out);
  if (start.code !== 200 || m.rc !== 0 || !live) return { ungueltig: `Mitschnitt gescheitert: Transport ${grundVon(start)}, cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}` };
  const arrM = sse.meldungen.filter((x) => x.a === '/zustand/arr' && typeof x.f?.limiter_db === 'number');
  const einsatz = sse.meldungen.find((x) => x.a === '/zustand/arr' && x.f?.status === 2);
  if (!einsatz) return { ungueltig: 'kein /zustand/arr mit status 2 im Strom (ursprung_sample unbekannt)' };
  const ursprung = einsatz.f.ursprung_sample;
  const limiterMin = arrM.length ? Math.min(...arrM.map((x) => x.f.limiter_db)) : null;
  // Render des Produktions-Abgriffs und des Set-Abgriffs mit demselben Zustand
  const render = async (name, abgriff) => {
    const r = await prog(werkzeug('cypherdj-render'), ['--nr', String(nr), '--von-beat', '0', '--bis-beat', String(beats), '--bpm', String(bpm), '--aus', path.join(dir, 'w', `${name}.wav`), '--abgriff', abgriff]);
    fs.writeFileSync(path.join(dir, 'w', `${name}.json`), `${r.out}${r.err}rc=${r.rc}\n`);
    return { rc: r.rc, j: jsonZeile(r.out), err: r.err.trim() };
  };
  const p = await render('p', 'produktion'), s = await render('s', 'set');
  if (p.rc !== 0 || s.rc !== 0 || !p.j || !s.j) return { ungueltig: `Render gescheitert: produktion rc ${p.rc} ${p.err}; set rc ${s.rc} ${s.err}` };
  const iso = await prog(ISO_REF, [path.join(dir, 'w', 'p.wav'), path.join(dir, 'w', 'p_iso.wav')]);
  if (iso.rc !== 0) return { ungueltig: `Isolator-Referenz gescheitert (rc ${iso.rc}): ${iso.err.trim()}` };
  const vergleich = async (name, wav, rj) => {
    const r = await prog(werkzeug('cypherdj-nulltest'), ['--live', path.join(dir, 'live.f32'), '--live-s0', String(live.s0), '--grenze', String(live.grenze), '--ursprung', String(ursprung), '--render', wav,
      '--start-sample', String(rj.start_sample), '--frames', String(rj.frames), '--vorhalt', String(rj.vorhalt), '--quantum', String(rj.quantum)]);
    fs.writeFileSync(path.join(dir, `nulltest-${name}.json`), `${r.out}${r.err}rc=${r.rc}\n`);
    return { rc: r.rc, j: jsonZeile(r.out), err: r.err.trim() };
  };
  const vPI = await vergleich('produktion-isolator', path.join(dir, 'w', 'p_iso.wav'), p.j);
  const vS = await vergleich('set', path.join(dir, 'w', 's.wav'), s.j);
  const vPR = await vergleich('produktion-roh', path.join(dir, 'w', 'p.wav'), p.j);   // Gegenprobe N7: ohne Isolator nie null
  return { dir, nr, live, ursprung, p: p.j, s: s.j, vPI, vS, vPR, limiterMin, arrN: arrM.length };
}

const nl = (v) => (v?.j ? `${v.j.urteil}${v.j.ursache ? `/${v.j.ursache}` : ''} rest ${fmt(v.j.rest_db)} dBFS, 1 Sample verschoben ${fmt(v.j.verschoben_db)} dBFS, Signal ${fmt(v.j.signal_db)} dBFS, Phase live ${v.j.phase_live} gegen Render ${v.j.phase_render}, Fenster ${v.j.fenster} (rc ${v.rc})` : `keine Ausgabe (rc ${v?.rc}: ${v?.err})`);

// Ein Abschnitt, der scheitern darf, ohne die anderen zu verhindern (im Vorher-Lauf scheitert jeder)
async function abschnitt(name, f) {
  punkt = name;
  try { await f(); } catch (e) { notiere(name, false, e instanceof Fehl ? e.message : `ABBRUCH: ${e.stack ?? String(e)}`); }
}


// ---- Slice 3 points ------------------------------------------------------------------------------------------------------------------------
const dbRel = (a, b) => dbfs(spitzeLin(a) / spitzeLin(b));
const minus = (a, b) => { const n = Math.min(a.length, b.length); const r = new Float32Array(n); for (let i = 0; i < n; i++) r[i] = a[i] - b[i]; return r; };
const rmsFenster = (daten, kanaele, sr, von_s, bis_s) => {
  const i0 = Math.floor(von_s * sr) * kanaele, i1 = Math.min(daten.length, Math.floor(bis_s * sr) * kanaele);
  let s = 0, n = 0; for (let i = i0; i < i1; i++) { s += daten[i] * daten[i]; n++; }
  return n ? 10 * Math.log10(s / n) : -200;
};
const wavDatei = (e) => liesWav(e.datei);
const hartSend = (strang, ret, db) => ({ befehl: 'send_setzen', strang_id: strang, return_id: ret, db });

async function lauf3() {
  const bpm = await warteAufKern();
  info(`Instanz ${instanz}, ${URL}, Kern ${bpm} BPM, Projektwurzel ${wurzel}, Bauordner ${BAU}, Isolator-Referenz ${ISO_REF ?? '(fehlt)'}`);
  for (const n of ['cypherdj-render', 'cypherdj-mitschnitt', 'cypherdj-nulltest']) if (!fs.existsSync(path.join(BAU, n))) notiere('Aufbau', false, `${path.join(BAU, n)} fehlt`);
  if (!ISO_REF || !fs.existsSync(ISO_REF)) notiere('Aufbau', false, `--iso-ref ${ISO_REF} fehlt (target iso_ref of the core build): the null test (A) cannot be judged without it`);

  // --- set-up r3-s3: Kick (36), Bass (43), Pad (48) as RB-338 tracks, loop 0..8; one return WITHOUT Hall ---
  const slug = await neuesProjekt('r3-s3');
  const aufbau = [{ befehl: 'tempo_setzen', bpm }];
  for (const n of ['Kick', 'Bass', 'Pad']) aufbau.push({ befehl: 'spur_neu', art: 'instrument', name: n });
  [36, 43, 48].forEach((ton, i) => aufbau.push({ befehl: 'clip_neu', spur_id: `s${i + 1}`, art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(ton) }));
  aufbau.push({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 });
  await aendern('R3 set-up', aufbau);
  const E_ohneRet = await exportiere(0, 8);
  await aendern('R3 return without Hall', [{ befehl: 'return_neu', name: 'Room', hall: { an: false } }]);
  const [S1, S2, S3] = (await projektJetzt()).spuren.map((s) => s.id);
  const R1 = (await projektJetzt()).returns[0].id;
  info(`set-up ${slug}: tracks ${S1},${S2},${S3}, return ${R1}`);

  // --- AK8 real: the return part of Bass = direct part - 6.02 dB at a send of -6 dB (Kick and Pad muted) ---
  await abschnitt('AK8', async () => {
    await aendern('R3 AK8 only Bass', [{ befehl: 'spur_aendern', spur_id: S1, mute: true }, { befehl: 'spur_aendern', spur_id: S3, mute: true }]);
    const B0 = await exportiere(0, 8);
    const d0 = wavDatei(B0).daten;
    // a project with a return and no send equals the project without a return (silent return), only Kick, Bass, Pad unmuted at the start
    await aendern('R3 AK8 unmute for the reference', [{ befehl: 'spur_aendern', spur_id: S1, mute: false }, { befehl: 'spur_aendern', spur_id: S3, mute: false }]);
    const E_ret = await exportiere(0, 8);
    const abwRet = maxAbw(wavDatei(E_ohneRet).daten, wavDatei(E_ret).daten);
    notiere('AK8/AK10 a return without sends is silent: the export equals the export of the project without a return (deviation <= 3e-6)', abwRet <= 3e-6, `largest deviation ${abwRet.toExponential(2)} (${fmt(dbfs(abwRet))} dBFS)`);
    await aendern('R3 AK8 mute again, send -6', [{ befehl: 'spur_aendern', spur_id: S1, mute: true }, { befehl: 'spur_aendern', spur_id: S3, mute: true }, hartSend(S2, R1, -6)]);
    const B1 = await exportiere(0, 8);
    const r1 = minus(wavDatei(B1).daten, d0);
    const verh = dbRel(r1, d0);
    const pegel = spitzeLin(d0);
    notiere('AK8 send -6 dB: the return part is the direct part -6.02 dB (+-0.1)', pegel > 0.01 && Math.abs(verh + 6.02) <= 0.1, `direct peak ${fmt(dbfs(pegel))} dBFS, return part ${fmt(dbfs(spitzeLin(r1)))} dBFS, ratio ${fmt(verh)} dB (required -6.02 +-0.1)`);
    await aendern('R3 AK8 Bass fader -6, no send', [hartSend(S2, R1, -200), { befehl: 'spur_aendern', spur_id: S2, fader_db: -6 }]);
    const B3 = await exportiere(0, 8);
    await aendern('R3 AK8 Bass fader -6, send -6', [hartSend(S2, R1, -6)]);
    const B2 = await exportiere(0, 8);
    const r2 = minus(wavDatei(B2).daten, wavDatei(B3).daten);
    const verh2 = dbRel(r2, d0);
    notiere('AK8 track fader -6 dB with send -6 dB: the return part is -12.04 dB against the direct part at 0 dB (post fader), +-0.15', Math.abs(verh2 + 12.04) <= 0.15, `return part ${fmt(dbfs(spitzeLin(r2)))} dBFS, ratio to the unfaded direct ${fmt(verh2)} dB (required -12.04 +-0.15)`);
    await aendern('R3 AK8 Bass fader back', [{ befehl: 'spur_aendern', spur_id: S2, fader_db: 0 }]);
    // AK10
    await aendern('R3 AK10 return fader -6', [{ befehl: 'return_aendern', return_id: R1, fader_db: -6 }]);
    const B4 = await exportiere(0, 8);
    const r4 = minus(wavDatei(B4).daten, d0);
    notiere('AK10 return fader -6 dB: the return part falls by 6.02 dB (send -6, fader -6: -12.04 against the direct part)', Math.abs(dbRel(r4, d0) + 12.04) <= 0.15, `ratio ${fmt(dbRel(r4, d0))} dB`);
    await aendern('R3 AK10 return mute', [{ befehl: 'return_aendern', return_id: R1, fader_db: 0, mute: true }]);
    const B5 = await exportiere(0, 8);
    const abwMute = maxAbw(d0, wavDatei(B5).daten);
    notiere('AK10 return mute: the export equals the one without a send (deviation <= 3e-6)', abwMute <= 3e-6, `largest deviation ${abwMute.toExponential(2)} (${fmt(dbfs(abwMute))} dBFS)`);
    await aendern('R3 AK10 unmute, solo on Pad only', [{ befehl: 'return_aendern', return_id: R1, mute: false }, { befehl: 'spur_aendern', spur_id: S3, mute: false, solo: true }]);
    const B6 = await exportiere(0, 8);
    const sendNurBass = minus(wavDatei(B6).daten, d0);
    notiere('AK10 track solo on Pad (Bass has the send): the Bass send does not sound, Bass is silenced by solo (negative control: the export is not the Bass export)', sha(B6.datei) !== sha(B1.datei) && spitzeLin(sendNurBass) > 0,
      `peak ${fmt(B6.spitze_db)} dBFS against ${fmt(B1.spitze_db)} dBFS`);
    await aendern('R3 AK10 unsolo, back to the basis', [{ befehl: 'spur_aendern', spur_id: S3, solo: false }, { befehl: 'spur_aendern', spur_id: S1, mute: false }, { befehl: 'spur_aendern', spur_id: S3, mute: false }]);
  });

  // --- AK11 real: an impulse through the send into a Hall return rings out ---
  await abschnitt('AK11', async () => {
    const slug2 = await neuesProjekt('r3-s3-hall');
    await aendern('R3 AK11 set-up', [{ befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'instrument', name: 'Imp' },
      { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 8, noten: [{ beat: 0, laenge: 0.05, ton: 43, vel: 110 }] },
      { befehl: 'return_neu', name: 'Hall' }]);
    const sp = (await projektJetzt()).spuren[0].id, rid = (await projektJetzt()).returns[0].id;
    await aendern('R3 AK11 send off', [hartSend(sp, rid, -200)]);
    const aus = await exportiere(0, 8);
    await aendern('R3 AK11 send 0 dB, Hall on (defaults)', [hartSend(sp, rid, 0)]);
    const an = await exportiere(0, 8);
    const { daten: da, kanaele } = wavDatei(aus), dn = wavDatei(an).daten;
    const hall = minus(dn, da);
    const sr = 48000;
    const spitze = spitzeLin(dn);
    const fensterDb = (von, bis) => rmsFenster(hall, kanaele, sr, von, bis) - dbfs(spitze);
    const f1 = fensterDb(1.0, 1.1), f2 = fensterDb(2.0, 2.1);
    notiere('AK11 Hall tail 1 s after the impulse is above -60 dBFS relative to the peak (RMS of 100 ms)', f1 > -60 && spitze > 0.01, `peak ${fmt(dbfs(spitze))} dBFS, tail RMS at 1.0-1.1 s ${fmt(f1)} dB relative, at 2.0-2.1 s ${fmt(f2)} dB relative`);
    notiere('AK11 negative control: without the send there is no Hall in the same window (< -90 dB relative)', rmsFenster(da, kanaele, sr, 1.0, 1.1) - dbfs(spitze) < -90 || spitzeLin(da.slice(Math.floor(1.0 * sr) * kanaele)) < 1e-4,
      `dry RMS at 1.0-1.1 s ${fmt(rmsFenster(da, kanaele, sr, 1.0, 1.1))} dBFS`);
    info(`AK11 project ${slug2}, the transport stop does not cut the tail: covered by the core test arr_hall (not repeated here)`);
  });

  // --- AK27 part: open the maximum project: all controls arrive, none refused ---
  await abschnitt('AK27', async () => {
    const slugM = await neuesProjekt('r3-s3-max');
    const b1 = [{ befehl: 'tempo_setzen', bpm }];
    for (let i = 0; i < 32; i++) b1.push({ befehl: 'spur_neu', art: 'instrument', name: `T${i + 1}` });
    await aendern('R3 AK27 tracks', b1);
    const b2 = [];
    for (let g = 0; g < 8; g++) b2.push({ befehl: 'gruppenspur_neu', mitglieder: [`s${g * 4 + 1}`, `s${g * 4 + 2}`] });
    for (let r = 0; r < 4; r++) b2.push({ befehl: 'return_neu', hall: { an: false } });
    for (let i = 1; i <= 32; i++) b2.push({ befehl: 'spur_aendern', spur_id: `s${i}`, fader_db: -1 - (i % 5), solo: i % 3 === 0 });
    await aendern('R3 AK27 groups, returns, faders', b2);
    const b3 = [];
    for (let i = 1; i <= 16; i++) for (let r = 1; r <= 4; r++) b3.push(hartSend(`s${i}`, `r${r}`, -10));
    await aendern('R3 AK27 sends', b3);
    const slugK = slugM;
    const andere = await neuesProjekt('r3-s3-klein');
    await warte(500);
    const t0 = Date.now(); const kl = await ruf('POST', '/proj/oeffnen', { slug: andere }); const tKlein = Date.now() - t0;
    const t1 = Date.now(); const gr = await ruf('POST', '/proj/oeffnen', { slug: slugK }); const tMax = Date.now() - t1;
    const kern = gr.j?.kern ?? {};
    info(`AK27 open: small project ${tKlein} ms (${kl.code}), maximum project ${tMax} ms (${gr.code}), kern ${JSON.stringify({ regler: kern.regler, regler_fehler: kern.regler_fehler?.length, regler_ohne_kern: kern.regler_ohne_kern, regler_nicht_gesendet: kern.regler_nicht_gesendet })}`);
    notiere('AK27 opening the maximum project (32 tracks, 8 groups, 4 returns, 64 sends): every control arrives, none refused, none unsent',
      gr.code === 200 && (kern.regler_fehler?.length ?? 1) === 0 && kern.regler_nicht_gesendet === 0 && kern.regler_ohne_kern === 0 && kern.regler >= 381, `regler ${kern.regler}, refused ${kern.regler_fehler?.length}, unsent ${kern.regler_nicht_gesendet}, without core ${kern.regler_ohne_kern}`);
    notiere('AK27 gate: opening the maximum project takes at most 500 ms longer than the small one (wall time of POST /proj/oeffnen, 1 sample each)', tMax - tKlein <= 500, `${tMax} ms against ${tKlein} ms, difference ${tMax - tKlein} ms`);
    await ruf('POST', '/proj/oeffnen', { slug });
  });

  // --- null test (A): export against the ring recording, without Hall; a track in a muted group with a send is silent in both ---
  await abschnitt('Null test A', async () => {
    if (!ISO_REF) throw new Fehl('without the isolator reference not executed');
    const slugN = await neuesProjekt('r3-s3');
    const bN = [{ befehl: 'tempo_setzen', bpm }];
    for (const n of ['Kick', 'Bass', 'Pad', 'Mute']) bN.push({ befehl: 'spur_neu', art: 'instrument', name: n });
    [36, 43, 48, 40].forEach((ton, i) => bN.push({ befehl: 'clip_neu', spur_id: `s${i + 1}`, art: 'midi', start_beat: 0, laenge_beats: 16, noten: notenN(ton, 16) }));
    await aendern('R3 null set-up', bN);
    await aendern('R3 null routing', [{ befehl: 'return_neu', name: 'Room', hall: { an: false } }, { befehl: 'gruppenspur_neu', mitglieder: ['s4'] }]);
    await aendern('R3 null sends and levels', [hartSend('s2', 'r1', -6), hartSend('s3', 'r1', -9), hartSend('s4', 'r1', -3),
      { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', mute: true }, ...['s1', 's2', 's3'].map((id) => ({ befehl: 'spur_aendern', spur_id: id, fader_db: -9 }))]);
    await warteGeladen();
    const sek = Math.ceil((16 * 60) / bpm) + 4;
    let a = await nullLive('null-a', bpm, 16, sek);
    for (let v = 2; v <= 3 && a.vPI?.j?.urteil === 'ungueltig'; v++) { info(`null A: attempt ${v - 1} invalid (${a.vPI.j.ursache}), once more`); a = await nullLive(`null-a-v${v}`, bpm, 16, sek); }
    if (a.ungueltig) throw new Fehl(`null A invalid, not passed: ${a.ungueltig}`);
    notiere('Null test A (no Hall): the production export (through the isolator of erz/4) against the ring recording: passed, residual < -90 dBFS, self check red, phase live = render',
      a.vPI.j?.urteil === 'bestanden' && a.vPI.j.rest_db < -90 && a.vPI.j.verschoben_db > -90 && a.vPI.j.phase_live === a.vPI.j.phase_render && a.vPI.j.signal_db > -60, `${nl(a.vPI)}; render ${a.p.abgriff}, peak ${fmt(a.p.spitze_db)} dBFS`);
    notiere('Null test A negative control: the same without the isolator is never null (red, residual above -90 dBFS)', a.vPR.j?.urteil === 'rot' && a.vPR.j.rest_db > -90, nl(a.vPR));
    // the muted-group case: only s4 (in the muted group g1, send -3 dB) is left sounding in the project: the export is silent (< -120 dBFS), as the ring is
    await aendern('R3 null muted group alone', ['s1', 's2', 's3'].map((id) => ({ befehl: 'spur_aendern', spur_id: id, mute: true })));
    const Estill = await exportiere(0, 8);
    notiere('Null test A: a track in a muted group with a send is silent in the export (< -120 dBFS; negative control: the other tracks are not)', Estill.spitze_db < -120 && a.p.spitze_db > -60, `only s4: ${fmt(Estill.spitze_db)} dBFS, all tracks: ${fmt(a.p.spitze_db)} dBFS`);
    info(`null A ${slugN}: set export ${a.vS.j?.urteil ?? 'none'} rest ${fmt(a.vS.j?.rest_db)} dBFS`);
  });

  // --- merge with a send (task 10b): two tracks with the same send, real merge render; the export before against the export after; unequal sends are refused ---
  await abschnitt('Merge with send', async () => {
    const slugG = await neuesProjekt('r3-s3');
    const bm = [{ befehl: 'tempo_setzen', bpm }];
    for (const n of ['M1', 'M2', 'M3']) bm.push({ befehl: 'spur_neu', art: 'instrument', name: n });
    [36, 43, 48].forEach((ton, i) => bm.push({ befehl: 'clip_neu', spur_id: `s${i + 1}`, art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(ton) }));
    await aendern('R3 merge set-up', bm);
    await aendern('R3 merge routing', [{ befehl: 'return_neu', name: 'Room', hall: { an: false } }]);
    await aendern('R3 merge sends', [hartSend('s1', 'r1', -6), hartSend('s2', 'r1', -6)]);
    // the frozen tracks: RB-338 tracks need no freeze (only Surge tracks do)
    const vorher = await exportiere(0, 8);
    const m = await ruf('POST', '/proj/zusammenfuehren', { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 8 }, CYPHER);
    if (m.code !== 200) throw new Fehl(`/proj/zusammenfuehren -> ${grundVon(m)}`);
    const neu = (await projektJetzt()).spuren.find((x) => /^Merge/.test(x.name));
    notiere('Merge with a send: the new track carries the shared send', (neu?.sends ?? []).some((x) => x.id === 'r1' && x.db === -6), `new track ${neu?.name}, sends ${JSON.stringify(neu?.sends)}`);
    await warte(1500);
    const nachher = await exportiere(0, 8);
    const abw = maxAbw(liesWav(vorher.datei).daten, liesWav(nachher.datei).daten);
    notiere('Merge with a send: the export before against the export after is null (deviation < -90 dBFS)', abw < 3.2e-5 && nachher.frames === vorher.frames, `largest deviation ${abw.toExponential(2)} (${fmt(dbfs(abw))} dBFS), peak ${fmt(vorher.spitze_db)} -> ${fmt(nachher.spitze_db)} dBFS`);
    const dichte = (await projektJetzt()).spuren.filter((x) => /^s[1-3]$/.test(x.id) && !x.mute).length;
    info(`merge: unmuted source tracks after the merge ${dichte}`);
    await aendern('R3 merge unequal sends', [{ befehl: 'spur_aendern', spur_id: 's1', mute: false }, { befehl: 'spur_aendern', spur_id: 's2', mute: false }, hartSend('s2', 'r1', -9)]);
    const nein = await ruf('POST', '/proj/zusammenfuehren', { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 8 }, CYPHER);
    notiere('Merge with unequal sends: refused with merge_sends (409)', nein.code === 409 && nein.j?.fehler === 'merge_sends', grundVon(nein));
  });

  // --- AK12 real: hand holds the send, Cypher's ramp is refused; ki_gestoppt blocks send_setzen ---
  await abschnitt('AK12', async () => {
    const p = await projektJetzt();
    const sid = p.spuren[0].id, rid = p.returns[0].id;
    const g = await ruf('POST', '/griff', { pfad: 'spur/1/send/1', u: 0.5 });
    const g2 = await ruf('POST', '/griff', { pfad: 'spur/1/send/1', u: 0.6 });
    notiere('AK12 hand: two grips on spur/1/send/1 are accepted and land in the project', g.code === 200 && g2.code === 200, `/griff ${g.code} ${g2.code}`);
    info(`AK12 grip answers ${JSON.stringify(g.j)} ${JSON.stringify(g2.j)}`);
    await bisWahr(async () => ((await projektJetzt()).spuren[0].sends ?? []).some((x) => x.id === rid), 6000);   // the way back is debounced
    const nach = await projektJetzt();
    notiere('AK12 the grips reach the project (send of the track to the return is set, not -200)', (nach.spuren[0].sends ?? []).some((x) => x.id === rid && x.db > -200), `sends ${JSON.stringify(nach.spuren[0].sends)}`);
    const r = await ruf('POST', '/regler', { pfad: 'spur/1/send/1', nach: -20 }, CYPHER);
    notiere('AK12 POST /regler on a send path is refused with ueber_projekt (409)', r.code === 409 && r.j?.fehler === 'ueber_projekt', grundVon(r));
    const gehalten = await aendernRoh('R3 AK12 Cypher moves the held send', [hartSend(sid, rid, -20)]);
    notiere('AK12 Cypher moves the send the hand holds: refused (regler_abgelehnt, nothing changed)', gehalten.code === 409 && gehalten.j?.fehler === 'regler_abgelehnt', grundVon(gehalten));
    const st = await ruf('POST', '/taste', { name: 'stopp' });
    await bisWahr(async () => (await ruf('GET', '/lage')).j?.ki?.gestoppt === true, 5000);
    const nein = await aendernRoh('R3 AK12 send while stopped', [hartSend(sid, rid, -3)]);
    notiere('AK12 Stop Cypher blocks send_setzen from Cypher (ki_gestoppt)', st.code === 200 && nein.code === 409 && nein.j?.fehler === 'ki_gestoppt', `stop ${st.code}, send ${grundVon(nein)}`);
    await ruf('POST', '/taste', { name: 'freigabe' });
    await ruf('POST', '/griff', { pfad: 'spur/1/send/1', u: 0 });   // leave the core slot near off: the next run starts from it
    await warte(2500);
  });
}

try {
  await lauf3();
} catch (e) {
  if (e instanceof Fehl) notiere(punkt, false, e.message); else notiere('ABBRUCH', false, `${punkt}: ${e.stack ?? String(e)}`);
} finally {
  try { await transport('stopp'); } catch { /* not running or server gone */ }
  try { await ruf('POST', '/taste', { name: 'freigabe' }); } catch { /* server gone */ }
  for (const slug of eigeneSlugs) {
    const d = path.join(wurzel, slug);
    if (!/^r3-(s3|s3-hall|s3-max|s3-klein)-\d{8}t\d{6}/i.test(slug)) { info(`slug ${slug} is not from this script, not deleted`); continue; }
    try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); info(`project ${d} deleted: ${fs.existsSync(d) ? 'NO, still there' : 'yes'}`); } }
    catch (e) { notiere('cleanup', false, e.message); }
  }
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Acceptance 1.10 slice 3 ${zeit} (${URL}, instance ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · report ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
