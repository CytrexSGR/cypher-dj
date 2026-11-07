// Browser probe for 1.12 Slice 3 task 5 (AK11): the page shows and ends lane overrides. Real page server + core stand-in on a probe instance (no sound,
// no JACK, headless Chrome through cdp.mjs). Checks: while playing the thumb follows the lane; a mouse grip turns the fader orange (from the server list)
// and enables RE-ENABLE AUTOMATION; the button ends it and the thumb follows again; a click while STOPPED turns nothing orange.
//   node pruef/probe_ueber.mjs [--instanz e] [--ausgabe <folder>]
import { reglerVonDb, REGLER_MAX } from '../oeffentlich/produktion/fader_kennlinie.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';
import { baueKatalog } from '../tests/hilfen/katalog.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: 'e' }, ausgabe: { type: 'string' } } });
if (!/^[e-z]$/.test(opt.instanz)) throw new Error('probes only on instance e or higher');
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const { baueMediathek } = await import('../tests/hilfen/mediathek.mjs');
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe) : path.join(HIER, 'ergebnisse', `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-ueber`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
const notiere = (k, ok, text) => { zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const SHA = 'a'.repeat(64);
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-ueber-'));
const kickWav = path.join(fix, 'kick.wav');
execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'sine=f=80:d=0.5,volume=0.9', '-ar', '44100', kickWav]);
const mt = baueMediathek(path.join(fix, 'mt'));
baueKatalog(fix, [{ typ: 'oneshot', sha: SHA, shas: SHA, name: 'Kick 1', instrument: 'kick', pack: 'Probe', dauer_s: 0.5, pfad: kickWav }]);
const proj = { wurzel: path.join(fix, 'proj'), arbeitsordner: path.join(fix, 'arr') };
const s = await starteStapel(ORDNER, opt.instanz, {}, { serverArgs: ['--katalog', path.join(fix, 'katalog.sqlite'), '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle')], proj });
const URL = s.url;
const b = await starteBrowser();
const w = (x) => b.werte(x);
const api = async (methode, weg, d) => {
  const r = await fetch(URL + weg.slice(1), methode === 'GET' ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d ?? {}) });
  return { code: r.status, j: await r.json() };
};
const aktuell = async () => (await api('GET', '/proj/aktuell')).j;
const geladen = async () => { for (let i = 0; i < 150; i++) { const a = await aktuell(); if (a.kern?.rev_geladen === a.projekt?.wiedergabe_rev && a.kern?.status === 0) return true; await warte(50); } return false; };
const SL = '.p-kopf[data-spur="s1"] .p-fader', KOPF = '.p-kopf[data-spur="s1"]', RE = '[data-p="re-enable"]';
const daumen = () => w(`Number(document.querySelector(${JSON.stringify(SL)}).value)`);
const orange = () => w(`document.querySelector(${JSON.stringify(KOPF)}).classList.contains('ueber-fader')`);
const reAn = () => w(`!document.querySelector(${JSON.stringify(RE)}).disabled`);
const farbe = (sel) => w(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).accentColor`);
const liste = async () => (await aktuell()).auto_uebersteuert ?? [];
const kernStatus = () => w('window.djkProd.arr?.status');
const orangePixel = () => w(`(() => { const c = document.querySelector('[data-p="spuren"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 255) < 14 && Math.abs(d[i + 1] - 138) < 14 && Math.abs(d[i + 2] - 31) < 14) n++; return n; })()`);
const proben = async (n, ms) => { const v = []; for (let i = 0; i < n; i++) { v.push(await daumen()); await warte(ms); } return v; };

try {
  const neu = await api('POST', '/proj/neu', { name: 'Ueber' });
  const slug = neu.j.slug;
  let r = await api('POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'setup', befehle: [
    { befehl: 'tempo_setzen', bpm: 128 }, { befehl: 'spur_neu', art: 'audio', name: 'Kick' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: SHA },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 64 }, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' },
    { befehl: 'spur_neu', art: 'audio', name: 'Pad' }, { befehl: 'auto_neu', spur_id: 's2', ziel: 'mute' }] });
  if (r.code !== 200) throw new Error(`aendern ${r.code} ${JSON.stringify(r.j)}`);
  const laneId = r.j.projekt.spuren[0].automation[0].id, muteLaneId = r.j.projekt.spuren[1].automation[0].id;
  r = await api('POST', '/proj/aendern', { rev: r.j.projekt.rev, label: 'ramp', befehle: [{ befehl: 'auto_punkte', lane_id: laneId, setze: [{ beat: 0, wert: 0 }, { beat: 64, wert: -50 }] },
    { befehl: 'auto_punkte', lane_id: muteLaneId, setze: [{ beat: 0, wert: 1, form: 'sprung' }, { beat: 64, wert: 1, form: 'sprung' }] }] });
  if (r.code !== 200) throw new Error(`auto_punkte ${r.code} ${JSON.stringify(r.j)}`);
  for (let i = 0; i < 100 && (await aktuell()).projekt.spuren[0].clips[0].dekodiert !== 'fertig'; i++) await warte(100);
  await warte(2500);
  await geladen();
  await b.oeffne(URL); await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1200);
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== slug; i++) await warte(100);
  notiere('0 setup', (await w('window.djkProd.slug')) === slug && !(await orange()) && !(await reAn()), `slug ${slug}, fader thumb ${await daumen()}, orange ${await orange()}, RE-ENABLE active ${await reAn()}`);

  // ---- negative: a click on the fader while STOPPED turns nothing orange (D5) ----
  const m0 = await b.mitte(SL);
  await b.maus('mouseMoved', m0.x, m0.y, { buttons: 0 }); await b.maus('mousePressed', m0.x, m0.y); await b.maus('mouseReleased', m0.x, m0.y); await warte(900);
  const l0 = await liste();
  notiere('N1 stopped: click on the fader turns nothing orange', (await kernStatus()) === 0 && l0.length === 0 && !(await orange()) && !(await reAn()),
    `status ${await kernStatus()}, server list ${JSON.stringify(l0)}, orange ${await orange()}, RE-ENABLE active ${await reAn()}`);
  await b.bild(path.join(ORDNER, '1-stopped-click.png'));
  // put the fader back to 0 dB for the run (the click moved the base value)
  await w(`(() => { const e = document.querySelector(${JSON.stringify(SL)}); e.value = '${reglerVonDb(0)}'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`); await warte(700);

  await b.klick(`${KOPF} .p-lane`); await warte(500);   // open the lane row: its line shows the override
  const op0 = await orangePixel();
  // ---- play: the thumb follows the lane ----
  await b.klick('[data-p="play"]');
  for (let i = 0; i < 60 && (await kernStatus()) !== 2; i++) await warte(100);
  const v = await proben(6, 400);
  notiere('P1 playing: the thumb follows the lane', (await kernStatus()) === 2 && new Set(v).size >= 4 && v.some((x) => x < -1.5),
    `status ${await kernStatus()}, thumb over 2.4 s: ${v.map((x) => x.toFixed(1)).join(' ')}`);
  await b.bild(path.join(ORDNER, '2-playing-follows.png'));

  // ---- mouse grip during play ----
  const m1 = await b.mitte(SL);
  await b.maus('mouseMoved', m1.x, m1.y, { buttons: 0 }); await b.maus('mousePressed', m1.x, m1.y);
  await warte(900);
  const l1 = await liste();
  notiere('G1 grip during play: server lists the override, fader turns orange, RE-ENABLE active', l1.length === 1 && l1[0].ziel === 'fader' && l1[0].spur_id === 's1' && (await orange()) && (await reAn()),
    `server list ${JSON.stringify(l1)}, orange ${await orange()}, accent ${await farbe(SL)}, RE-ENABLE active ${await reAn()}`);
  await b.bild(path.join(ORDNER, '3-grip-orange.png'));
  const op1 = await orangePixel();
  notiere('G1b the lane line is orange while overridden', op0 === 0 && op1 > 50, `orange pixels in the lane canvas: before ${op0}, during ${op1}`);
  await b.maus('mouseReleased', m1.x, m1.y); await warte(800);
  const vo = await proben(4, 400);
  notiere('G2 after release the thumb stays at the hand value (lane waits)', new Set(vo).size === 1 && (await orange()), `thumb ${vo.map((x) => x.toFixed(1)).join(' ')}, orange ${await orange()}`);
  const lane = await w(`getComputedStyle(document.querySelector('[data-p="re-enable"]')).backgroundColor`);

  // ---- RE-ENABLE ----
  await b.klick(RE); await warte(1200);
  const l2 = await liste();
  notiere('R1 RE-ENABLE: list empty, orange gone, button inactive', l2.length === 0 && !(await orange()) && !(await reAn()), `server list ${JSON.stringify(l2)}, orange ${await orange()}, RE-ENABLE active ${await reAn()} (button was ${lane})`);
  const op2 = await orangePixel();
  notiere('R1b the lane line is no longer orange', op2 === 0, `orange pixels ${op2}`);
  const vr = await proben(6, 400);
  const beat = await w('window.djkProd.kopfBeat'), erwartet = -50 * beat / 64, jetzt = await daumen();
  notiere('R2 the thumb follows the lane again (not the hand value -27)', new Set(vr).size >= 4 && vr.every((x, i) => i === 0 || x < vr[i - 1]) && Math.abs(jetzt - erwartet) < 2.5,
    `thumb ${vr.map((x) => x.toFixed(1)).join(' ')}, now ${jetzt.toFixed(1)}, lane at beat ${beat?.toFixed(2)} = ${erwartet.toFixed(1)}`);
  await b.bild(path.join(ORDNER, '4-reenabled-follows.png'));

  // ---- fix round 1, item 4: a real key event (ArrowUp) on the fader while playing: the thumb must not snap back to the old base value ----
  const TXT = `${KOPF} .p-faderwert`;
  const txt = () => w(`document.querySelector(${JSON.stringify(TXT)}).textContent`);
  await w(`document.querySelector(${JSON.stringify(SL)}).focus()`);
  const vorTaste = await daumen(), basisVor = (await aktuell()).projekt.spuren[0].fader_db;   // the old base value of the field (the hand value of the grip step)
  await b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
  await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
  const tv = []; for (let i = 0; i < 30; i++) { tv.push(await daumen()); await warte(50); }
  const nachTaste = tv.at(-1), l3 = await liste();
  const zurueck = tv.filter((x) => x === basisVor).length;   // samples that show the OLD base value again = a snap back
  notiere('S1 keydown ArrowUp during play: override listed, thumb stays at the key value (no snap back to the old base)', l3.length === 1 && l3[0].ziel === 'fader' && zurueck === 0 && tv.slice(2).every((x) => x === nachTaste) && nachTaste > vorTaste,
    `before ${vorTaste.toFixed(2)}, samples after key (50 ms apart, first 6) ${tv.slice(0, 6).map((x) => x.toFixed(2)).join(' ')}, last ${nachTaste.toFixed(2)}, samples at the old base ${basisVor}: ${zurueck}, list ${JSON.stringify(l3)}`);
  await w('document.activeElement?.blur()');
  await b.klick(RE); await warte(1200);

  // ---- item 2: a grip WITHOUT movement keeps thumb and text at the lane value of the grip beat ----
  const t0 = await txt(), d0 = await daumen(), beat0 = await w('window.djkProd.kopfBeat'), laneJetzt = -50 * beat0 / 64;
  await w(`document.querySelector(${JSON.stringify(SL)}).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))`);
  await warte(700);
  const tH = await txt(), dH = await daumen();
  await w(`(() => { const e = document.querySelector(${JSON.stringify(SL)}); e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await warte(900);
  const tR = await txt(), dR = await daumen(), base = (await aktuell()).projekt.spuren[0].fader_db;
  const num = (t) => Number(t.replace('−', '-'));
  notiere('F1 grip without movement: text and thumb stay at the grip lane value, not the base value', (await orange()) && Math.abs(num(tR) - laneJetzt) < 2 && num(tR) !== base && dR === dH && Math.abs(num(tH) - num(tR)) < 0.06,
    `text before ${t0}, held ${tH}, released ${tR}; thumb before ${d0.toFixed(1)}, held ${dH.toFixed(1)}, released ${dR.toFixed(1)}; lane at grip ≈ ${laneJetzt.toFixed(1)}; project base ${base}`);
  await b.bild(path.join(ORDNER, 'fix1_frozen.png'));
  await b.klick(RE); await warte(1200);
  const vf = await proben(4, 400);
  notiere('F2 after re-enable the field follows the lane again', !(await orange()) && vf.every((x, i) => i === 0 || x < vf[i - 1]), `thumb ${vf.map((x) => x.toFixed(1)).join(' ')}`);

  // ---- item 3: mute lane on track 2: M follows the lane, a click overrides (orange), re-enable clears ----
  const M = '.p-kopf[data-spur="s2"] .p-mute';
  await b.klick('.p-kopf[data-spur="s2"] .p-lane'); await warte(500);   // open the mute lane row
  const mClass = () => w(`[...document.querySelector(${JSON.stringify(M)}).classList].join(' ')`);
  const baseMute = (await aktuell()).projekt.spuren[1].mute;
  const mv = await mClass(), px0 = await orangePixel();
  notiere('M1 playing: the M button follows the mute lane (lane 1 = muted, base unmuted)', baseMute === false && /\ban\b/.test(mv), `base mute ${baseMute}, M classes "${mv}"`);
  await b.klick(M); await warte(1000);
  const l4 = await liste(), m2 = await mClass(), px1 = await orangePixel(), base2 = (await aktuell()).projekt.spuren[1].mute;
  notiere('M2 click on M: override request first, M orange, click toggles from the shown (lane) state, lane line orange', l4.length === 1 && l4[0].ziel === 'mute' && l4[0].spur_id === 's2' && /\bueber\b/.test(m2) && base2 === false && px1 > px0 + 10,
    `list ${JSON.stringify(l4)}, M classes "${m2}", base mute after click ${base2}, orange pixels ${px0} -> ${px1}`);
  await b.bild(path.join(ORDNER, 'fix1_mute_orange.png'));
  await b.klick(RE); await warte(1200);
  const l5 = await liste(), m3 = await mClass(), px2 = await orangePixel();
  notiere('M3 re-enable: list empty, M no longer orange, M follows the lane again, lane line normal', l5.length === 0 && !/\bueber\b/.test(m3) && /\ban\b/.test(m3) && px2 === px0, `list ${JSON.stringify(l5)}, M classes "${m3}", orange pixels ${px2}`);
  // the same for solo is covered by the unit tests (ueberAnfrage, knopfZustand); the probe project has no solo lane

  // ---- fix round 2 I2: the answer of the override request decides about the write (the fetch of the page is wrapped to answer /proj/auto/uebersteuern) ----
  await w(`(() => { const f = window.fetch; window.__a = []; window.__mode = null;
    window.fetch = (u, o) => { const url = String(u);
      if (url.includes('/proj/aendern')) window.__a.push({ t: Date.now(), c: JSON.parse(o.body).befehle.map((x) => x.befehl + ':' + Object.keys(x).filter((k) => k !== 'befehl' && k !== 'spur_id').join(',')) });
      if (url.includes('/proj/auto/uebersteuern') && window.__mode) { const m = window.__mode; return new Promise((ok) => setTimeout(() => ok(new Response(JSON.stringify(m.body), { status: m.status, headers: { 'content-type': 'application/json' } })), m.delay ?? 0)); }
      return f(u, o); }; })()`);
  const geschrieben = (feld) => w(`window.__a.filter((x) => x.c.some((c) => c.startsWith('spur_aendern:') && c.includes(${JSON.stringify(feld)}))).length`);
  const meldung = () => w(`document.querySelector('[data-p="meldung"]').textContent`);
  const setzeModus = (m) => w(`window.__mode = ${JSON.stringify(m)}; window.__a.length = 0`);
  // refused (409 ki_gestoppt): M writes nothing, shows the reason, stays on the lane (not orange, not frozen)
  await setzeModus({ status: 409, body: { fehler: 'ki_gestoppt' } });
  await b.klick(M); await warte(900);
  const mR = await mClass(), nM = await geschrieben('mute'), txtM = await meldung();
  notiere('I2a refused (409): M click writes no spur_aendern, shows the reason, the button stays on the lane', nM === 0 && /Stop Cypher/.test(txtM) && /\ban\b/.test(mR) && !/\bueber\b/.test(mR) && (await liste()).length === 0,
    `spur_aendern mute writes ${nM}, message "${txtM}", M classes "${mR}"`);
  // refused fader grip with a drag: nothing written, the thumb goes back to the lane
  const mf = await b.mitte(SL);
  await b.maus('mouseMoved', mf.x, mf.y, { buttons: 0 }); await b.maus('mousePressed', mf.x, mf.y);
  for (let i = 1; i <= 6; i++) await b.maus('mouseMoved', mf.x + i * 6, mf.y);
  await warte(500); await b.maus('mouseReleased', mf.x + 36, mf.y); await warte(700);
  const nF = await geschrieben('fader_db'), beatF = await w('window.djkProd.kopfBeat'), dF = await daumen(), vF = await proben(3, 300);
  notiere('I2b refused (409): a fader drag writes no spur_aendern and the thumb follows the lane again', nF === 0 && Math.abs(dF - (-50 * beatF / 64)) < 3 && vF[2] < vF[0] && !(await orange()),
    `fader writes ${nF}, thumb ${dF.toFixed(1)} (lane ${(-50 * beatF / 64).toFixed(1)}), then ${vF.map((x) => x.toFixed(1)).join(' ')}, orange ${await orange()}`);
  // no core (503 kein_kern): the base value may be edited: M writes
  await setzeModus({ status: 503, body: { fehler: 'kein_kern' } });
  await b.klick(M); await warte(900);
  const n503 = await geschrieben('mute');
  notiere('I2c no core (503): M writes spur_aendern', n503 === 1, `spur_aendern mute writes ${n503}`);
  // no answer within 2 s: written after the timeout, with a console warning
  await setzeModus({ status: 200, body: { ok: true }, delay: 3500 });
  const tKlick = await w('Date.now()');
  await b.klick(M);
  let tWrite = null; for (let i = 0; i < 60 && tWrite === null; i++) { await warte(100); tWrite = await w('window.__a.find((x) => x.c.some((c) => c.startsWith("spur_aendern:") && c.includes("mute")))?.t ?? null'); }
  const dt = tWrite === null ? null : tWrite - tKlick, warnung = b.konsole.some((k) => /no answer in 2000 ms/.test(k.text));
  notiere('I2d no answer in 2 s: spur_aendern is written after the timeout (about 2 s, not 3.5 s) and a warning is logged', dt !== null && dt >= 1900 && dt < 3000 && warnung, `written after ${dt} ms, console warning ${warnung}`);
  await setzeModus(null); await warte(3000);   // the late answer of the wrapped request is gone

  // ---- item 1: core restart during an override clears the orange without a reload ----
  await b.klick(M); await warte(900);
  const vorNeustart = [await liste(), await orange() || /\bueber\b/.test(await mClass()), await reAn()];
  const pid = execFileSync('pgrep', ['-f', 'attrappe_kern.mjs.*' + ORDNER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]).toString().trim().split('\n')[0];
  const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  process.kill(Number(pid), 'SIGTERM'); await warte(800);
  const np = spawn(cmd[0], cmd.slice(1).filter((x) => x !== '--frisch'), { env: { ...process.env, CYPHERDJ_INSTANZ: opt.instanz }, stdio: 'ignore' });
  await warte(5000);
  const nach = await liste(), seite = await w('JSON.stringify(window.djkProd.autoUeber)');
  notiere('C1 core restart during an override: the page drops orange without a reload', vorNeustart[0].length === 1 && vorNeustart[1] && vorNeustart[2] && nach.length === 0 && seite === '[]' && !/\bueber\b/.test(await mClass()) && !(await reAn()),
    `before: list ${JSON.stringify(vorNeustart[0])}, orange ${vorNeustart[1]}, RE-ENABLE ${vorNeustart[2]}; after: server list ${JSON.stringify(nach)}, page st.autoUeber ${seite}, M classes "${await mClass()}", RE-ENABLE active ${await reAn()}`);
  await b.bild(path.join(ORDNER, 'fix1_after_restart.png'));
  try { np.kill('SIGTERM'); } catch { /* gone */ }
  await b.klick('[data-p="stopp"]'); await warte(600);
  const fk = b.konsole.filter((k) => k.typ === 'exception' || k.typ === 'error');
  notiere('K console', fk.length === 0, `${fk.length} errors${fk.length ? ': ' + fk.slice(0, 3).map((k) => k.text).join(' | ') : ''}`);
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  try { await api('POST', '/proj/transport', { aktion: 'stopp' }); } catch { /* already down */ }
  await b.zu(); await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# probe_ueber instance ${opt.instanz}\n\n${zeilen.join('\n')}\n`);
const fehl = zeilen.filter((z) => z.startsWith('FEHL')).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`}\n`);
process.exit(fehl === 0 ? 0 : 1);
