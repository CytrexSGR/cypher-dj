// 1.12 Automation slice 3 task 9: page arm, mouse recording, and the measurement AK14 (offset between a mouse gesture and the beat the server recorded).
// Real page server + core stand-in on a probe instance (no sound, headless Chrome through cdp.mjs, --mute-audio). NOT the real C++ core.
//   node pruef/ak14_a3.mjs [--instanz e] [--ausgabe <folder>] [--n 20]
// Steps: A arm and mode through the buttons; B n mouse gestures on the fader of the armed track: per gesture the epoch time of the first `input` event of the
// page, the beat the server answered for that value, and the transport clock at that time (fit of the /zustand/arr states: slope = tempo, intercept = median
// of beat - rate * arrival time); offset = (recorded - clock) in ms; C the take is written (lane points) and one undo step; D refusal visible (lane locked);
// E window blur ends a gesture; F an unarmed track sends nothing; G reload keeps the arm state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';
import { baueKatalog } from '../tests/hilfen/katalog.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: 'e' }, ausgabe: { type: 'string' }, n: { type: 'string', default: '20' } } });
if (!/^[e-z]$/.test(opt.instanz)) throw new Error('probes only on instance e or higher');
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const N = Number(opt.n), BPM = 120;
const { baueMediathek } = await import('../tests/hilfen/mediathek.mjs');
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-ak14`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
const notiere = (k, ok, text) => { zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const SHA = 'a'.repeat(64);
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-ak14-'));
const kickWav = path.join(fix, 'kick.wav');
execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'sine=f=80:d=0.5,volume=0.9', '-ar', '44100', kickWav]);
const mt = baueMediathek(path.join(fix, 'mt'));
baueKatalog(fix, [{ typ: 'oneshot', sha: SHA, shas: SHA, name: 'Kick 1', instrument: 'kick', pack: 'Probe', dauer_s: 0.5, pfad: kickWav }]);
const proj = { wurzel: path.join(fix, 'proj'), arbeitsordner: path.join(fix, 'arr') };
let s = null, b = null, URL = '';   // started inside the try below: whatever failed to start, the finally cleans up what did
const w = (x) => b.werte(x);
const api = async (methode, weg, d, kopf = {}) => {
  const r = await fetch(URL + weg.slice(1), methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(d ?? {}) });
  return { code: r.status, j: await r.json() };
};
const aktuell = async () => (await api('GET', '/proj/aktuell')).j;
const geladen = async () => { for (let i = 0; i < 150; i++) { const a = await aktuell(); if (a.kern?.rev_geladen === a.projekt?.wiedergabe_rev && a.kern?.status === 0) return true; await warte(50); } return false; };
const SL = '.p-kopf[data-spur="s1"] .p-fader', ARM1 = '.p-kopf[data-spur="s1"] .p-autoarm', ARM2 = '.p-kopf[data-spur="s2"] .p-autoarm', SL2 = '.p-kopf[data-spur="s2"] .p-fader';
const kernStatus = () => w('window.djkProd.arr?.status');
const median = (a) => { const t = [...a].sort((x, y) => x - y); const m = t.length >> 1; return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
const pct = (a, p) => { const t = [...a].sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.ceil(p * t.length) - 1)]; };

// the SSE of the server read by this script: every /zustand/arr state with the arrival time (the transport clock of the measurement)
const arrStaende = [], projEreignisse = [], strom = new AbortController();
let stromLauf = Promise.resolve();
const starteStrom = () => { stromLauf = (async () => {
  try {
    const r = await fetch(URL + 'strom', { signal: strom.signal });
    const dec = new globalThis.TextDecoder();
    let puf = '';
    for await (const stueck of r.body) {
      puf += dec.decode(stueck, { stream: true });
      let i;
      while ((i = puf.indexOf('\n\n')) >= 0) {
        const block = puf.slice(0, i); puf = puf.slice(i + 2);
        if (!block.startsWith('data: ')) continue;
        try { const m = JSON.parse(block.slice(6)); if (m.a === 'proj' && m.f?.rev !== undefined) projEreignisse.push({ t: Date.now(), rev: m.f.rev, label: m.f.label ?? null }); if (m.a === '/zustand/arr') arrStaende.push({ t: Date.now(), status: Number(m.f.status), beat: Number(m.f.projekt_beat) }); } catch { /* half line */ }
      }
    }
  } catch { /* aborted */ }
})(); };

try {
  s = await starteStapel(ORDNER, opt.instanz, {}, { serverArgs: ['--katalog', path.join(fix, 'katalog.sqlite'), '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle')], proj });
  URL = s.url;
  b = await starteBrowser();
  starteStrom();
  const neu = await api('POST', '/proj/neu', { name: 'AK14' });
  let r = await api('POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'setup', befehle: [
    { befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'audio', name: 'Kick' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: SHA },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 256 }, { befehl: 'spur_neu', art: 'audio', name: 'Pad' }] });
  if (r.code !== 200) throw new Error(`aendern ${r.code} ${JSON.stringify(r.j)}`);
  for (let i = 0; i < 100 && (await aktuell()).projekt.spuren[0].clips[0].dekodiert !== 'fertig'; i++) await warte(100);
  await warte(2500); await geladen();
  await b.oeffne(URL); await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1200);
  for (let i = 0; i < 40 && !(await w('window.djkProd?.slug')); i++) await warte(100);

  // ---- page probes: every geste request with the epoch times and the answer; the first input event of every mouse sequence on the fader ----
  await w(`(() => { window.__g = []; window.__seq = null; window.__f = window.fetch;
    document.addEventListener('pointerdown', (e) => { if (e.target.matches?.('.p-fader')) window.__seq = { down: performance.timeOrigin + e.timeStamp, input: null, sent: null, beat: null, wert: null }; }, true);
    for (const typ of ['pointerup', 'lostpointercapture', 'change', 'input']) document.addEventListener(typ, (e) => { if (e.target.matches?.('.p-fader')) window.__ablauf.push({ t: Date.now(), art: 'ereignis', typ }); }, true);
    document.addEventListener('input', (e) => { if (window.__seq && window.__seq.input === null && e.target.matches?.('.p-fader')) window.__seq.input = performance.timeOrigin + e.timeStamp; }, true);
    window.__409 = []; window.__ablauf = [];
    window.fetch = (u, o) => { if (String(u).includes('/proj/aendern')) { const cmd = JSON.parse(o.body), t0 = Date.now(); return window.__f(u, o).then((resp) => { resp.clone().json().then((j) => { window.__ablauf.push({ t: t0, t1: Date.now(), art: 'aendern', label: cmd.label, rev: cmd.rev, status: resp.status, antwort_rev: j.rev ?? null, fehler: j.fehler ?? null }); if (resp.status === 409) window.__409.push({ t: Date.now(), label: cmd.label, fehler: j.fehler, rev: cmd.rev }); }); return resp; }); }
      if (!String(u).includes('/proj/auto/geste')) return window.__f(u, o);
      const body = JSON.parse(o.body), q = window.__seq; window.__ablauf.push({ t: Date.now(), art: 'geste', ende: body.ende === true, wert: body.wert ?? null, ziel: body.ziel }); const erste = body.wert !== undefined && q && q.sent === null;
      if (erste) { q.sent = Date.now(); q.wert = body.wert; window.__g.push(q); }
      return window.__f(u, o).then((resp) => { if (erste) resp.clone().json().then((j) => { q.beat = j.beat; q.aufgenommen = j.aufgenommen; q.code = resp.status; }); return resp; }); }; })()`);

  // ---- A: arm and mode through the buttons ----
  const armAn = (sel) => w(`document.querySelector(${JSON.stringify(sel)}).classList.contains('an')`);
  const modusAn = () => w(`['touch','latch','write'].filter((m) => document.querySelector('[data-p="auto-' + m + '"]').classList.contains('an'))`);
  const a0 = [await armAn(ARM1), await modusAn()];
  await b.klick(ARM1); await warte(500);
  const a1 = [await armAn(ARM1), (await aktuell()).auto_arm];
  notiere('A1 AUTO ● arms the track: the server lists it, the head shows it', a0[0] === false && a1[0] === true && JSON.stringify(a1[1]) === '{"modus":"touch","spuren":["s1"]}', `before ${JSON.stringify(a0)}, after ${JSON.stringify(a1)}`);
  await b.klick('[data-p="auto-latch"]'); await warte(500);
  const m1 = [await modusAn(), (await aktuell()).auto_arm?.modus];
  await b.klick('[data-p="auto-touch"]'); await warte(500);
  const m2 = [await modusAn(), (await aktuell()).auto_arm?.modus];
  notiere('A2 TOUCH / LATCH / WRITE: the mode button and the server follow', JSON.stringify(m1) === '[["latch"],"latch"]' && JSON.stringify(m2) === '[["touch"],"touch"]', `latch ${JSON.stringify(m1)}, touch ${JSON.stringify(m2)}`);
  const passt = await w(`(() => { const e = document.querySelector(${JSON.stringify(ARM1)}); return { sw: e.scrollWidth, cw: e.clientWidth, loeschen: document.querySelector('.p-kopf[data-spur="s1"] .p-loeschen').getBoundingClientRect().right, kopf: document.querySelector('.p-kopf[data-spur="s1"]').getBoundingClientRect().right }; })()`);
  notiere('A3 "AUTO ●" fits its button and the delete button sits at the right edge', passt.sw <= passt.cw && passt.kopf - passt.loeschen < 12, `scrollWidth ${passt.sw} <= clientWidth ${passt.cw}; delete button right ${passt.loeschen.toFixed(1)}, head right ${passt.kopf.toFixed(1)}`);
  await b.bild(path.join(ORDNER, 'a-armed.png'));

  // ---- B: play, then N mouse gestures ----
  await b.klick('[data-p="play"]');
  for (let i = 0; i < 60 && (await kernStatus()) !== 2; i++) await warte(100);
  await warte(1200);
  const m0 = await b.mitte(SL);
  const laneVorher = !!(await aktuell()).projekt.spuren[0].automation?.length;   // before the first gesture: touch writes the take of every gesture at its release
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const dx = i % 2 ? -26 : 26;
    await b.maus('mouseMoved', m0.x, m0.y, { buttons: 0 });
    await b.maus('mousePressed', m0.x, m0.y);
    await warte(20 + (i * 37) % 60);                       // the press-to-move gap varies so the gestures meet different phases of the 50 Hz state clock
    for (let k = 1; k <= 3; k++) { await b.maus('mouseMoved', m0.x + (dx * k) / 3, m0.y); await warte(25); }
    await b.maus('mouseReleased', m0.x + dx, m0.y);
    await warte(150 + (i * 53) % 170);   // 150 to 320 ms: a quick human; the next press can still meet the take of the previous gesture (rev_veraltet, K3)
  }
  await warte(800);
  const g = await w('JSON.parse(JSON.stringify(window.__g))');
  // transport clock: fit over the states while playing (no loop wrap in this run: loop 0..256 beats)
  const spielt = arrStaende.filter((x) => x.status === 2 && x.t >= t0 - 500);
  const rate = BPM / 60000;
  const achse = median(spielt.map((x) => x.beat - rate * x.t));
  const rest = spielt.map((x) => x.beat - (achse + rate * x.t));
  const rmsMs = Math.sqrt(rest.reduce((a, x) => a + x * x, 0) / rest.length) / rate;
  const uhr = (t) => achse + rate * t;
  const roh = g.map((q, i) => ({ i, down: q.down, input: q.input, sent: q.sent, wert: q.wert, aufgenommen: q.aufgenommen, code: q.code, beat_server: q.beat,
    beat_uhr_input: q.input === null ? null : uhr(q.input), versatz_ms: q.beat === null || q.input === null ? null : (q.beat - uhr(q.input)) / rate, sende_ms: q.sent === null || q.input === null ? null : q.sent - q.input }));
  const gut = roh.filter((x) => x.versatz_ms !== null && x.aufgenommen === true);
  const ab = gut.map((x) => Math.abs(x.versatz_ms)), sg = gut.map((x) => x.versatz_ms);
  fs.writeFileSync(path.join(ORDNER, 'ak14_roh.json'), JSON.stringify({ bpm: BPM, n: N, stationen: spielt.length, achse, rest_rms_ms: rmsMs, gesten: roh }, null, 1));
  const stat = { n: gut.length, median_signiert_ms: median(sg), median_abs_ms: median(ab), p95_abs_ms: pct(ab, 0.95), max_abs_ms: Math.max(...ab), min_signiert_ms: Math.min(...sg), max_signiert_ms: Math.max(...sg), uhr_rest_rms_ms: rmsMs, zustaende: spielt.length, bpm: BPM };
  fs.writeFileSync(path.join(ORDNER, 'ak14_ergebnis.json'), JSON.stringify(stat, null, 1));
  const toastB = await w(`document.querySelector('[data-p="meldung"]').textContent`);
  notiere('B3 no "changed elsewhere" notice while recording', !/elsewhere|reloaded/i.test(toastB), `notice "${toastB}"`);
  notiere('B1 gestures recorded', gut.length === N, `${gut.length} of ${N} gestures with an answered beat (first value of each, aufgenommen true)`);
  notiere('B2 AK14 offset (recorded beat minus transport clock at the first input event)', gut.length === N,
    `n ${gut.length}: median ${stat.median_signiert_ms.toFixed(1)} ms signed, |median| ${stat.median_abs_ms.toFixed(1)}, p95 ${stat.p95_abs_ms.toFixed(1)}, max ${stat.max_abs_ms.toFixed(1)} ms (range ${stat.min_signiert_ms.toFixed(1)}..${stat.max_signiert_ms.toFixed(1)}), guide value 50 ms; clock fit rms ${rmsMs.toFixed(2)} ms over ${spielt.length} states`);

  // ---- C: stop: the take is written, one undo step ----
  await b.klick('[data-p="stopp"]');
  let lane = null; for (let i = 0; i < 60 && !lane; i++) { await warte(100); lane = (await aktuell()).projekt.spuren[0].automation?.find((l) => l.ziel === 'fader') ?? null; }
  const pts = lane?.punkte ?? [];
  const hist = (await aktuell()).projekt;
  notiere('C1 stop writes the take: a fader lane with points exists', !!lane && pts.length >= 2 && !laneVorher, `lane ${lane?.id}, ${pts.length} points, beats ${pts.slice(0, 4).map((p) => p.beat.toFixed(2)).join(' ')}.., lane existed before the gestures: ${laneVorher}, rev ${hist.rev}`);

  // ---- D: refusal visible: lock the lane, record again ----
  if (lane) {
    const au = await aktuell();
    const lr = await api('POST', '/proj/aendern', { rev: au.projekt.rev, label: 'lock', befehle: [{ befehl: 'auto_aendern', lane_id: lane.id, gesperrt: true }] });
    notiere('D0 lane locked', lr.code === 200, `code ${lr.code}`);
    await warte(600);
    await w('window.__g.length = 0');
    await b.klick('[data-p="play"]');
    for (let i = 0; i < 60 && (await kernStatus()) !== 2; i++) await warte(100);
    await warte(500);
    await b.ziehe(SL, 24, 0, 3);
    await warte(300);
    await b.klick('[data-p="stopp"]'); await warte(1500);
    const txt = await w(`document.querySelector('[data-p="meldung"]').textContent`);
    notiere('D1 the refusal of a take on a locked lane is shown on the page', /locked/i.test(txt), `notice "${txt}"`);
    await b.bild(path.join(ORDNER, 'd-refusal.png'));
  }

  // ---- F: an unarmed track sends nothing ----
  await b.klick('[data-p="play"]');
  for (let i = 0; i < 60 && (await kernStatus()) !== 2; i++) await warte(100);
  await w('window.__g.length = 0; window.__n = 0; (() => { const f = window.fetch; window.fetch = (u, o) => { if (String(u).includes("/proj/auto/geste")) window.__n++; return f(u, o); }; })()');
  await b.ziehe(SL2, 24, 0, 3); await warte(500);
  const nGeste = await w('window.__n');
  notiere('F1 negative control: a gesture on an unarmed track sends no /proj/auto/geste', nGeste === 0, `geste requests ${nGeste}`);

  // ---- E: window blur ends an armed gesture (s1 is armed, the lane is locked: use an armed s2 instead) ----
  await b.klick(ARM2); await warte(500);
  await w('window.__n = 0; window.__ende = 0; (() => { const f = window.fetch; window.fetch = (u, o) => { if (String(u).includes("/proj/auto/geste") && JSON.parse(o.body).ende) window.__ende++; return f(u, o); }; })()');
  const mb = await b.mitte(SL2);
  await b.maus('mouseMoved', mb.x, mb.y, { buttons: 0 }); await b.maus('mousePressed', mb.x, mb.y);
  await b.maus('mouseMoved', mb.x + 10, mb.y); await warte(200);
  const e0 = await w('window.__ende');
  await w(`window.dispatchEvent(new Event('blur'))`); await warte(400);
  const e1 = await w('window.__ende');
  await b.maus('mouseReleased', mb.x + 10, mb.y); await warte(300);
  const e2 = await w('window.__ende');
  notiere('E1 window blur sends the end of the open gesture once', e0 === 0 && e1 === 1 && e2 === 1, `end requests: before blur ${e0}, after blur ${e1}, after the later pointerup ${e2}`);
  await b.klick('[data-p="stopp"]'); await warte(800);

  const n409 = await w('window.__409');
  fs.writeFileSync(path.join(ORDNER, 'ak14_ablauf.json'), JSON.stringify({ seite: await w('window.__ablauf'), sse_proj: projEreignisse }, null, 1));
  const abl = (await w('window.__ablauf')).filter((x) => x.art === 'aendern').sort((x, y) => x.t - y.t);
  const bad = abl.map((x, i) => [x, i]).filter(([x]) => x.status !== 200 && x.label.startsWith('Volume'));
  const ohneWiederholung = bad.filter(([x, i]) => !(abl[i + 1] && abl[i + 1].status === 200 && abl[i + 1].label === x.label));
  notiere('K3 every Volume write that met rev_veraltet was written again', bad.length > 0 && ohneWiederholung.length === 0, `${bad.length === 0 ? 'NOT EXERCISED: no rev_veraltet occurred in this run, so the repeat was not tested; ' : ''}${bad.length} first attempts refused, ${ohneWiederholung.length} without a successful repeat (of ${abl.length} writes)`);
  notiere('K2 409 on /proj/aendern', true, `${n409.length} x: ${JSON.stringify(n409.map((x) => [x.fehler, x.rev]))}`);

  // ---- G: reload keeps the arm state ----
  await b.oeffne(URL); await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1500);
  const g1 = [await armAn(ARM1), await armAn(ARM2), await modusAn()];
  notiere('G1 reload: armed tracks and the mode come back from the server', g1[0] && g1[1] && JSON.stringify(g1[2]) === '["touch"]', JSON.stringify(g1));
  await api('POST', '/proj/auto/arm', { alle: true, an: false });
  const fk = b.konsole.filter((k) => (k.typ === 'exception' || k.typ === 'error') && !/status of 409/.test(k.text));   // the 409s are listed by K2 with their reasons
  notiere('K console', fk.length === 0, `${fk.length} errors${fk.length ? ': ' + fk.slice(0, 3).map((k) => k.text + ' ' + (k.url ?? '')).join(' | ') : ''}`);
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  try { await api('POST', '/proj/transport', { aktion: 'stopp' }); } catch { /* already down */ }
  strom.abort(); await stromLauf;
  if (b) await b.zu();
  if (s) await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# ak14_a3 instance ${opt.instanz}\n\n${zeilen.join('\n')}\n`);
const fehl = zeilen.filter((z) => z.startsWith('FEHL')).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`}\n`);
process.exit(fehl === 0 ? 0 : 1);
