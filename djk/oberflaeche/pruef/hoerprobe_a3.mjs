// Hearing probe, package 1.12 automation slice 3 WAVE A, THROUGH THE PAGE on the REAL C++ core (test instance e only, silent sink, Chrome muted).
// What Andreas would listen for, measured: a real mouse (CDP Input.dispatchMouseEvent) on the s1 fader thumb of the production page in a VISIBLE Chrome on the
// right monitor (output DP-4, 2560,0, 2560x1440); not /griff, no direct API calls for the actions under test (only project set-up and measuring reads use the API).
//   cmake -S djk/kern -B <b>/kern -G Ninja && ninja -C <b>/kern -j8 cypherdj-kern cypherdj-mitschnitt
//   cmake -S djk/notbahn -B <b>/notbahn -G Ninja && ninja -C <b>/notbahn -j8
//   flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" node djk/oberflaeche/pruef/hoerprobe_a3.mjs --bau <b>/kern --bau-notbahn <b>/notbahn [--ausgabe <folder>] [--instanz e]
// Project: 128 BPM, s1 with a steady 440 Hz clip, loop 0..64, fader lane 0 dB -> -50 dB, s2 with a mute lane. One master recording covers all steps.
//   H6 negative: 4 s of play, nothing orange, server list empty        H1 grab + small move: list {s1,fader}, orange, RE-ENABLE active, blend without click
//   H2 release: hand value holds while the lane falls (flat)           H3 click RE-ENABLE AUTOMATION: list empty, orange gone, blend back ~480 samples, no click
//   H4 second grab: overrides again, orange, no click                  H5 click M on s2 while playing: orange M; re-enable clears it
// The takeover of the hand is SCALED from the lane value (INTERFACES.md 7.3): the judgement is "no jump", not "reaches the knob dB".
// Same instrument as abnahme_a3.mjs (gain trace, transition finder, step ratio, controls CTL1/CTL2). Closes Chrome and stops the instance also on failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SR, amplitude, blendeBreite } from './a1_messen.mjs';
import { schreibeWav } from './w1_wav.mjs';
import { starteBrowser } from './cdp.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const DJK = path.resolve(HIER, '..', '..');
const { values: opt } = parseArgs({ options: { bau: { type: 'string' }, 'bau-notbahn': { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string', default: 'e' }, help: { type: 'boolean', short: 'h' } } });
if (opt.help || !opt.bau || !opt['bau-notbahn']) { process.stderr.write('hoerprobe_a3: usage: --bau <core build folder> --bau-notbahn <notbahn build folder> [--ausgabe <folder>] [--instanz e]\n'); process.exit(2); }
if (opt.instanz !== 'e') { process.stderr.write(`hoerprobe_a3: instance ${opt.instanz} refused: this script runs on instance e only\n`); process.exit(2); }
const I = opt.instanz, BAU = path.resolve(opt.bau), BAU_NB = path.resolve(opt['bau-notbahn']);
const ORDNER = path.resolve((opt.ausgabe ?? path.join(os.homedir(), 'messungen/2026-11-01-automation-slice3/hoerprobe')).replace(/^~(?=\/|$)/, os.homedir()));
fs.mkdirSync(path.join(ORDNER, 'roh'), { recursive: true });
const URL_ = 'http://127.0.0.1:52300';   // page of instance e: 47300 + 1000 * 5
const ZIEL = '/dev/shm/a3-hp-ziel';
const AMP = 0.3, FREQ = 440;
const FENSTER = { x: 2560, y: 0, w: 2560, h: 1440 };   // DP-4 only
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let fehl = 0;
const zeilen = [];
const notiere = (k, ok, text) => { if (!ok) fehl++; const z = `${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`; zeilen.push(z); process.stdout.write(`${z}\n`); };
const info = (text) => { zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };
const kurz = (x) => JSON.stringify(x);
const jsonZeile = (t) => { try { return JSON.parse(t.trim().split('\n').filter(Boolean).pop()); } catch { return null; } };
const prog = (programm, args, env = {}) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: I, DJK, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const ruf = async (methode, weg, koerper) => {
  const r = await fetch(URL_ + weg, methode === 'GET' ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};
const aktuell = async () => (await ruf('GET', '/proj/aktuell')).j;
const liste = async () => (await aktuell()).auto_uebersteuert ?? [];
const hatListe = (l, spur, ziel) => l.some((e) => e.spur_id === spur && e.ziel === ziel);
const bisWahr = async (f, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await f()) return true; await warte(50); } return false; };

// ---- measurement (same as abnahme_a3.mjs) ----
const FEN = 48, SCHRITT = 8;
const verstaerkung = (l, r, f) => Math.hypot(amplitude(l, f, FEN), amplitude(r, f, FEN)) / AMP;
function spurVon(l, r, von, bis) { const s = []; for (let f = von; f < bis; f += SCHRITT) s.push({ frame: f, lin: verstaerkung(l, r, f) }); return s; }
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const dbV = (x) => 20 * Math.log10(Math.max(x, 1e-12));
function sprungMax(l, r, von, bis) { let m = 0; for (let i = Math.max(1, von); i < Math.min(l.length, bis); i++) m = Math.max(m, Math.abs(l[i] - l[i - 1]), Math.abs(r[i] - r[i - 1])); return m; }
function uebergaenge(l, r) {
  const grob = 32, n = Math.floor((l.length - 2 * FEN) / grob), g = new Float64Array(n);
  for (let k = 0; k < n; k++) g[k] = verstaerkung(l, r, FEN + k * grob);
  const gdb = Array.from(g, (x) => Math.max(dbV(x), -100)), span = Math.round(480 / grob), aus = [];
  let offen = null;
  for (let k = 0; k + span < n; k++) {
    const bewegt = Math.abs(gdb[k + span] - gdb[k]) > 1.5;
    if (bewegt) { if (!offen) offen = { von: k, bis: k + span }; else offen.bis = k + span; }
    else if (offen && k - offen.bis > 40) { aus.push(offen); offen = null; }
  }
  if (offen) aus.push(offen);
  return aus.map((o) => ({ von: FEN + o.von * grob, bis: FEN + o.bis * grob }));
}
function beurteile(l, r, ue) {
  const vor = median(spurVon(l, r, ue.von - 4000, ue.von - 1500).map((e) => e.lin)), nach = median(spurVon(l, r, ue.bis + 1500, ue.bis + 4000).map((e) => e.lin));
  const spur = spurVon(l, r, ue.von - 300, ue.bis + 300);
  const breite = blendeBreite(spur, vor, nach);
  const innen = sprungMax(l, r, ue.von - 100, ue.bis + 100);
  const aussen = Math.max(sprungMax(l, r, ue.von - 3000, ue.von - 1000), sprungMax(l, r, ue.bis + 1000, ue.bis + 3000));
  return { vor, nach, vor_db: dbV(vor), nach_db: dbV(nach), breite: breite?.frames ?? null, sprung_verhaeltnis: innen / aussen, innen, aussen };
}
const BLENDE_MIN = 432, BLENDE_MAX = 528, SPRUNG_MAX = 1.15;
function kontrollen() {
  const n = 2 * SR, i0 = 48027, g0 = 1.0, g1 = 0.16;
  const sig = (breite) => { const l = new Float32Array(n); for (let i = 0; i < n; i++) { const t = breite === 0 ? (i < i0 ? 0 : 1) : Math.min(1, Math.max(0, (i - i0) / breite)); l[i] = AMP * (g0 + (g1 - g0) * t) * Math.cos(Math.PI / 4) * Math.sin(2 * Math.PI * FREQ * i / SR); } return l; };
  const gefunden = (l) => { const u = uebergaenge(l, l); return u.length === 1 ? beurteile(l, l, u[0]) : null; };
  const stufe = gefunden(sig(0)), rampe = gefunden(sig(480));
  notiere('CTL1 a hard step is flagged', stufe !== null && stufe.sprung_verhaeltnis > 2 * SPRUNG_MAX, `step ratio ${stufe?.sprung_verhaeltnis?.toFixed(2)} (limit ${SPRUNG_MAX})`);
  notiere('CTL2 a 480-sample ramp passes and reads 480', rampe !== null && rampe.sprung_verhaeltnis <= SPRUNG_MAX && Math.abs(rampe.breite - 480) < 20, `step ratio ${rampe?.sprung_verhaeltnis?.toFixed(3)}, width ${rampe?.breite?.toFixed(1)}`);
}
function lies(datei) {
  const b = fs.readFileSync(datei), st = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
  const l = new Float32Array(st.length >> 1), r = new Float32Array(st.length >> 1);
  for (let i = 0; i < l.length; i++) { l[i] = st[2 * i]; r[i] = st[2 * i + 1]; }
  return { l, r };
}

// ---- instance ----
const links = [];
function verlinke() {
  for (const [ziel, quelle] of [[path.join(DJK, 'kern/build'), BAU], [path.join(DJK, 'notbahn/build'), BAU_NB]]) {
    if (fs.existsSync(ziel)) { info(`${ziel} exists, left as it is`); continue; }
    fs.symlinkSync(quelle, ziel); links.push(ziel);
  }
}
const entlinke = () => { for (const l of links.splice(0)) try { fs.unlinkSync(l); } catch { /* gone */ } };
let aufgebaut = false, browser = null, slug = null;
async function stoppeInstanz() {
  if (!aufgebaut) return;
  aufgebaut = false;
  const r = await prog(path.join(DJK, 'start/djk-stop'), ['--instanz', I]);
  info(`djk-stop rc ${r.rc} ${r.err.trim().split('\n').pop() ?? ''}`);
}
const rev = async () => (await ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
const aendern = async (label, befehle) => {
  const r = await ruf('POST', '/proj/aendern', { rev: await rev(), label, befehle });
  if (r.code !== 200) throw new Error(`/proj/aendern (${label}) ${r.code} ${kurz(r.j).slice(0, 300)}`);
  return r.j;
};
const status = async () => (await aktuell()).kern?.status;
const geladen = async () => {
  const ok = await bisWahr(async () => { const a = await aktuell(); return a.projekt && a.projekt.spuren.flatMap((s) => s.clips).every((c) => c.dekodiert === 'fertig' || c.dekodiert == null) && a.kern?.rev_geladen === a.projekt.wiedergabe_rev && a.kern?.status === 0; }, 40000);
  if (!ok) throw new Error(`playback not loaded after 40 s: ${kurz((await aktuell()).kern)}`);
};

// ---- page helpers (all real input goes through CDP mouse events) ----
const KOPF = '.p-kopf[data-spur="s1"]', SL = `${KOPF} .p-fader`, RE = '[data-p="re-enable"]', M2 = '.p-kopf[data-spur="s2"] .p-mute';
let b = null;
const w = (x) => b.werte(x);
const orangeFader = () => w(`document.querySelector(${kurz(KOPF)}).classList.contains('ueber-fader')`);
const orangeM = () => w(`/\\bueber\\b/.test(document.querySelector(${kurz(M2)}).className)`);
const reAn = () => w(`!document.querySelector(${kurz(RE)}).disabled`);
const daumen = () => w(`Number(document.querySelector(${kurz(SL)}).value)`);
const orangePixel = () => w(`(() => { const c = document.querySelector('[data-p="spuren"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 255) < 14 && Math.abs(d[i + 1] - 138) < 14 && Math.abs(d[i + 2] - 31) < 14) n++; return n; })()`);
// centre of the slider THUMB (not of the track): the range is horizontal, the thumb is 16 px wide
const daumenMitte = () => w(`(() => { const e = document.querySelector(${kurz(SL)}), r = e.getBoundingClientRect(), mn = Number(e.min), mx = Number(e.max), v = Number(e.value), tw = 16;
  return { x: r.left + tw / 2 + (v - mn) / (mx - mn) * (r.width - tw), y: r.top + r.height / 2, breite: r.width, db_je_px: (mx - mn) / (r.width - tw), v, mn, mx }; })()`);
async function bild(name) { const f = path.join(ORDNER, name); await b.bild(f); return f; }

async function haupt() {
  const v = await prog('python3', [path.join(DJK, 'vertrag/pruefe_osc.py')], {});
  notiere('S1 contract check', v.rc === 0 && /ERGEBNIS: GR(Ü|U)(N)/.test(v.out), v.out.trim().split('\n').pop());
  kontrollen();

  fs.rmSync(ZIEL, { recursive: true, force: true });
  const au = await prog('node', [path.join(HIER, 'a2_aufbau.mjs'), '--ziel', ZIEL, '--instanz', I], {});
  const aufbau = jsonZeile(au.out);
  if (au.rc !== 0 || !aufbau) throw new Error(`a2_aufbau rc ${au.rc} ${au.err.slice(0, 300)}`);
  verlinke();
  const st = await prog(path.join(DJK, 'start/djk-start'), ['--instanz', I], { CYPHERDJ_KATALOG: aufbau.katalog });
  aufgebaut = true;
  const z = await prog(path.join(DJK, 'start/djk-start'), ['--zustand', '--instanz', I], {});
  const stumm = /cypher_stumm-e:playback_FL/.test(z.out), pruef = /test mode/.test(z.out);
  const kernDa = await bisWahr(async () => { try { const a = await aktuell(); return a && a.kern !== undefined && (await ruf('GET', '/lage')).code === 200; } catch { return false; } }, 30000);
  const neu = await bisWahr(async () => { try { return typeof (await ruf('POST', '/proj/neu', { name: `a3-hoerprobe` })).j?.slug === 'string'; } catch { return false; } }, 30000);
  notiere('S2 real core on instance e, silent sink', st.rc === 0 && stumm && pruef && kernDa && neu, `djk-start rc ${st.rc}; sink ${stumm ? 'cypher_stumm-e (silent)' : 'NOT the silent sink'}; ${pruef ? 'test mode' : 'NO test mode'}; core ${path.join(BAU, 'cypherdj-kern')}`);
  if (st.rc !== 0 || !stumm) throw new Error('instance not usable');
  await warte(1500);

  const n1 = await ruf('POST', '/proj/neu', { name: 'a3-hoerprobe' });
  slug = n1.j.slug;
  await aendern('hp setup', [
    { befehl: 'tempo_setzen', bpm: 128 }, { befehl: 'spur_neu', art: 'audio', name: 'S1' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 64, sha256: aufbau.sha_a },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 64 }, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' },
    { befehl: 'spur_neu', art: 'audio', name: 'S2' }, { befehl: 'auto_neu', spur_id: 's2', ziel: 'mute' }]);
  const p0 = (await aktuell()).projekt;
  const lane = (sid, ziel) => p0.spuren.find((s) => s.id === sid)?.automation?.find((x) => x.ziel === ziel)?.id;
  await aendern('hp lanes', [
    { befehl: 'auto_punkte', lane_id: lane('s1', 'fader'), setze: [{ beat: 0, wert: 0 }, { beat: 64, wert: -50 }] },
    { befehl: 'auto_punkte', lane_id: lane('s2', 'mute'), setze: [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 64, wert: 0, form: 'sprung' }] }]);
  await geladen();
  await warte(2500);

  // visible Chrome on DP-4 only
  b = await starteBrowser({ sichtbar: FENSTER });
  await b.oeffne(URL_); await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1200);
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== slug; i++) await warte(100);
  const geo = await w('({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight, iw: innerWidth, ih: innerHeight })');
  notiere('S3 page open in the visible window on DP-4', (await w('window.djkProd.slug')) === slug && geo.x === FENSTER.x && geo.y === FENSTER.y, `slug ${slug}, window at ${geo.x},${geo.y} size ${geo.w}x${geo.h} (viewport ${geo.iw}x${geo.ih})`);
  await b.klick(`${KOPF} .p-lane`); await warte(500);                    // open the s1 fader lane row: its line shows the override
  await b.klick('.p-kopf[data-spur="s2"] .p-lane'); await warte(500);    // and the mute lane row
  await bild('0-ready.png');

  // ---- one master recording over everything ----
  const mit = prog(path.join(BAU, 'cypherdj-mitschnitt'), ['--sekunden', '36', '--aus', path.join(ORDNER, 'roh', 'lauf.f32')]);
  await warte(700);
  const zeiten = {};
  let hand = null;
  try {
    await b.klick('[data-p="play"]');
    if (!(await bisWahr(async () => (await status()) === 2, 12000))) throw new Error(`status 2 not reached: ${await status()}`);
    zeiten.play = Date.now();

    // H6 negative: before any grab, 4 s of play: nothing orange, list empty
    const px0 = await orangePixel();
    let maxPx = px0, laeuft = true;
    const so = [];
    for (let i = 0; i < 8; i++) { await warte(500); so.push([await orangeFader(), await orangeM(), await reAn(), (await liste()).length]); maxPx = Math.max(maxPx, await orangePixel()); }
    const d0 = await daumen();
    const unberuehrt = so.every((s) => !s[0] && !s[1] && !s[2] && s[3] === 0);
    notiere('H6 negative: 4 s of play without a grab, nothing orange, list empty', unberuehrt && maxPx === 0 && d0 < -2 && (await status()) === 2, `8 samples [orange fader, orange M, RE-ENABLE active, list size] ${kurz(so.slice(0, 2))}.. all clean ${unberuehrt}; orange pixels in lane canvas max ${maxPx}; thumb followed the lane to ${d0.toFixed(1)} dB; status ${await status()}`);
    await bild('1-H6-playing-clean.png');

    // H1 grab the thumb and move it a little (real mouse: press, 6 small moves, hold)
    const m = await daumenMitte();
    info(`fader thumb at x ${m.x.toFixed(0)} y ${m.y.toFixed(0)}, track ${m.breite.toFixed(0)} px = ${m.mn}..${m.mx} dB (${m.db_je_px.toFixed(3)} dB/px), value ${m.v.toFixed(2)}`);
    hand = m;
    zeiten.h1 = Date.now();
    await b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
    await b.maus('mousePressed', m.x, m.y);
    await warte(500);
    const vPress = await daumen(), lPress = await liste();
    for (let i = 1; i <= 6; i++) { await b.maus('mouseMoved', m.x + i * 3, m.y); await warte(15); }   // 18 px to the right (about 11 dB) = louder, in about 90 ms
    await warte(900);
    const l1 = await liste(), vH = await daumen();
    notiere('H1 grab + small move: server list {s1,fader}, fader and lane line orange, RE-ENABLE active', l1.length === 1 && hatListe(l1, 's1', 'fader') && (await orangeFader()) && (await reAn()) && (await orangePixel()) > 50,
      `thumb at press ${vPress.toFixed(2)} dB (lane value, thumb was ${m.v.toFixed(2)}), list at press ${kurz(lPress)}, list after move ${kurz(l1)}, thumb now ${vH.toFixed(2)} dB, orange fader ${await orangeFader()}, orange pixels ${await orangePixel()}, RE-ENABLE active ${await reAn()}`);
    await bild('2-H1-grabbed-orange.png');
    await b.maus('mouseReleased', m.x + 18, m.y);
    zeiten.h2 = Date.now();
    await warte(800);
    const vR = await daumen();
    await warte(3500);
    const vR2 = await daumen(), lR = await liste();
    notiere('H2 release: the thumb and the override stay at the hand value (lane keeps falling)', Math.abs(vR2 - vR) < 0.01 && hatListe(lR, 's1', 'fader') && (await orangeFader()), `thumb 0.8 s after release ${vR.toFixed(2)} dB, 4.3 s after ${vR2.toFixed(2)} dB, list ${kurz(lR)}, orange ${await orangeFader()}`);
    await bild('3-H2-released-holds.png');

    // H3 click RE-ENABLE AUTOMATION
    zeiten.h3 = Date.now();
    await b.klick(RE);
    await warte(1000);
    const l3 = await liste();
    notiere('H3 RE-ENABLE AUTOMATION: list empty, orange gone, button inactive', l3.length === 0 && !(await orangeFader()) && !(await reAn()) && (await orangePixel()) === 0, `list ${kurz(l3)}, orange fader ${await orangeFader()}, orange pixels ${await orangePixel()}, RE-ENABLE active ${await reAn()}`);
    await bild('4-H3-reenabled.png');
    await warte(2500);
    const vF = await daumen(), beatF = await w('window.djkProd.kopfBeat');
    info(`after H3 the thumb follows the lane again: ${vF.toFixed(2)} dB at beat ${beatF?.toFixed(2)} (lane ${(-50 * beatF / 64).toFixed(2)} dB)`);

    // H4 grab a second time: the thumb is at the lane value now; press on it and move a little
    const m4 = await daumenMitte();
    zeiten.h4 = Date.now();
    await b.maus('mouseMoved', m4.x, m4.y, { buttons: 0 });
    await b.maus('mousePressed', m4.x, m4.y);
    await warte(500);
    for (let i = 1; i <= 6; i++) { await b.maus('mouseMoved', m4.x - i * 3, m4.y); await warte(15); }   // 18 px to the left = quieter
    await warte(900);
    const l4 = await liste();
    notiere('H4 second grab: overrides again, orange', l4.length === 1 && hatListe(l4, 's1', 'fader') && (await orangeFader()) && (await reAn()), `thumb before ${m4.v.toFixed(2)} dB, now ${(await daumen()).toFixed(2)} dB, list ${kurz(l4)}, orange ${await orangeFader()}, RE-ENABLE active ${await reAn()}`);
    await bild('5-H4-second-grab.png');
    await b.maus('mouseReleased', m4.x - 18, m4.y);
    await warte(2000);

    // H5 click M on s2 (mute lane) while playing
    const mc0 = await w(`document.querySelector(${kurz(M2)}).className`);
    await b.klick(M2);
    await warte(1000);
    const l5 = await liste(), mc1 = await w(`document.querySelector(${kurz(M2)}).className`);
    notiere('H5a click M on s2: orange M, mute listed', hatListe(l5, 's2', 'mute') && (await orangeM()), `M classes "${mc0}" -> "${mc1}", list ${kurz(l5)}`);
    await bild('6-H5-mute-orange.png');
    await b.klick(RE); await warte(1000);
    const l6 = await liste();
    notiere('H5b re-enable clears M and the fader override', l6.length === 0 && !(await orangeM()) && !(await orangeFader()) && !(await reAn()), `list ${kurz(l6)}, orange M ${await orangeM()}, orange fader ${await orangeFader()}, RE-ENABLE active ${await reAn()}`);
    await bild('7-H5-all-reenabled.png');
    await warte(2500);
  } finally {
    try { await b.klick('[data-p="stopp"]'); } catch { /* page gone */ }
    await ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);
  }
  const mm = await mit;
  const j = jsonZeile(mm.out);
  if (mm.rc !== 0 || !j) throw new Error(`cypherdj-mitschnitt rc ${mm.rc} ${mm.err.trim()}`);
  fs.writeFileSync(path.join(ORDNER, 'roh', 'lauf.json'), mm.out);

  // ---- measurement on the master ----
  const { l, r } = lies(path.join(ORDNER, 'roh', 'lauf.f32'));
  const roheUe = uebergaenge(l, r).filter((u) => dbV(verstaerkung(l, r, Math.max(FEN, u.von - 2000))) > -100 && dbV(verstaerkung(l, r, Math.min(l.length - FEN, u.bis + 2000))) > -100);
  // a hand move is several mouse events, each one a 10 ms ramp of the mixer: clusters closer than 0.3 s are ONE gesture
  const ue = []; for (const u of roheUe) { const letzte = ue.at(-1); if (letzte && u.von - letzte.bis < 0.3 * SR) letzte.bis = u.bis; else ue.push({ ...u }); }
  const verlauf = []; for (let f = SR / 4; f < l.length - FEN; f += SR / 4) verlauf.push([+(f / SR).toFixed(2), +dbV(verstaerkung(l, r, f)).toFixed(2)]);
  fs.writeFileSync(path.join(ORDNER, 'roh', 'verlauf_db.json'), kurz({ ue, verlauf }));
  info(`recording ${(l.length / SR).toFixed(2)} s, gain transitions: ${roheUe.length} raw, ${ue.length} gestures, at ${ue.map((u) => `${(u.von / SR).toFixed(2)}..${(u.bis / SR).toFixed(2)} s`).join(', ')}`);
  if (ue.length !== 4) { notiere('M0 four gain gestures (H1 grab, H3 re-enable, H4 grab, H5b re-enable) on the recording', false, `found ${ue.length}; level trace ${kurz(verlauf.filter((_, i) => i % 4 === 0))}`); }
  else {
    const [e1, e3, e4, e5] = ue.map((u) => beurteile(l, r, u));
    const f = (x) => `${x.vor_db.toFixed(2)} dB -> ${x.nach_db.toFixed(2)} dB over ${x.breite?.toFixed(0) ?? 'n/a'} samples, largest sample jump ${x.innen.toFixed(5)} inside vs ${x.aussen.toFixed(5)} steady (ratio ${x.sprung_verhaeltnis.toFixed(3)})`;
    notiere('H1m grab: blend into the hand value, no click', e1.sprung_verhaeltnis <= SPRUNG_MAX && e1.nach_db > e1.vor_db, `${f(e1)} (ratio <= ${SPRUNG_MAX}; takeover scaled from the lane value, so judged as "no jump", the knob moved up)`);
    const plateau = spurVon(l, r, ue[0].bis + 2000, ue[1].von - 2000).map((e) => dbV(e.lin));
    const drift = Math.max(...plateau) - Math.min(...plateau);
    notiere('H2m release: flat on the recording while the lane falls', drift < 0.1, `level between H1 and H3: ${Math.min(...plateau).toFixed(3)} .. ${Math.max(...plateau).toFixed(3)} dB (spread ${drift.toFixed(3)} dB, limit 0.1); ${((ue[1].von - ue[0].bis) / SR).toFixed(1)} s long`);
    notiere('H3m re-enable: blend back to the lane in about 480 samples, no click', e3.breite !== null && e3.breite >= BLENDE_MIN && e3.breite <= BLENDE_MAX && e3.sprung_verhaeltnis <= SPRUNG_MAX && e3.vor_db - e3.nach_db > 3, `${f(e3)} (limits ${BLENDE_MIN}..${BLENDE_MAX} samples, ratio <= ${SPRUNG_MAX}, lane lower than the hand value by more than 3 dB)`);
    notiere('H4m second grab: blend, no click', e4.sprung_verhaeltnis <= SPRUNG_MAX && e4.nach_db < e4.vor_db, `${f(e4)} (ratio <= ${SPRUNG_MAX}; the knob moved down)`);
    notiere('H5m final re-enable (fader back to the lane): blend ~480 samples, no click', e5.breite !== null && e5.breite >= BLENDE_MIN && e5.breite <= BLENDE_MAX && e5.sprung_verhaeltnis <= SPRUNG_MAX && e5.nach_db > e5.vor_db, `${f(e5)} (the hand value of H4 was below the lane)`);
    roh_ = { e1, e3, e4, e5, ue };
    const ausschnitt = (name, u) => { const von = Math.max(0, u.von - 2 * SR), bis = Math.min(l.length, u.bis + 2 * SR), ex = new Float32Array(2 * (bis - von)); for (let i = von; i < bis; i++) { ex[2 * (i - von)] = l[i]; ex[2 * (i - von) + 1] = r[i]; } schreibeWav(path.join(ORDNER, name), ex); info(`${name}: ${((bis - von) / SR).toFixed(2)} s`); };
    ausschnitt('H1-grab-ausschnitt.wav', ue[0]); ausschnitt('H3-reenable-ausschnitt.wav', ue[1]); ausschnitt('H4-grab2-ausschnitt.wav', ue[2]);
  }
  fs.rmSync(path.join(ORDNER, 'roh', 'lauf.f32'), { force: true });
}
let roh_ = null;

let rc = 0;
try {
  await haupt();
} catch (e) {
  notiere('ABBRUCH', false, `${e.message}`);
  process.stderr.write(`${e.stack}\n`);
} finally {
  try { if (b) await bild('9-end.png').catch(() => null); } catch { /* done */ }
  try { await ruf('POST', '/proj/transport', { aktion: 'stopp' }); } catch { /* done */ }
  try { if (b) await b.zu(); } catch { /* done */ }
  if (slug) { try { fs.rmSync(path.join('/dev/shm', `cypherdj-${I}`, 'projekte', slug), { recursive: true, force: true }); } catch { /* done */ } }
  await stoppeInstanz();
  entlinke();
  fs.rmSync(ZIEL, { recursive: true, force: true });
  notiere('S14 Chrome closed, instance stopped, links removed', !aufgebaut && links.length === 0, `instance ${I} down`);
  fs.writeFileSync(path.join(ORDNER, 'rohdaten.json'), JSON.stringify(roh_ ?? {}, null, 1));
  fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# hoerprobe_a3 (instance ${I}, core ${BAU})\n\n${zeilen.join('\n')}\n`);
  process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · report ${path.join(ORDNER, 'bericht.md')}\n`);
  rc = fehl === 0 ? 0 : 1;
}
process.exit(rc);
