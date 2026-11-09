// Browser probe of the recording functions (1.8 T10, AK30, AK31 without the hand key). Pattern of probe_production.mjs / ak14_a3.mjs: the REAL page server
// (check/stack.mjs with the `proj` option) in front of the stand-in core, a counting relay between them, headless Chrome through cdp.mjs with real mouse and key
// events. No sound, no window, no real core, no hardware. The stand-in writes the take files (rec.mjs: audio test pattern and a deterministic MIDI file), so the
// whole path "click REC, click STOP, the take sits in the project" runs through the real server code.
//   node check/probe_recording.mjs [--instanz d] [--ausgabe <folder>] [--mutation ohne-arm]
// Instance d only (it is the instance this task may bind; under `flock -w 1800 /dev/shm/cypherdj-instanz-d.flock`). The server runs with its own HOME (a tmp folder
// holding the device file of this probe) so the real ~/.config/cypherdj-d/geraete.json is neither read nor written; the edge file of the instance
// (/dev/shm/cypherdj-d/eingaenge-kanten) is put back as found.
// What is checked (each operation twice: in GET /proj/aktuell and in what the stand-in core received, /k/rec/spur and /k/rec/start at the relay):
//   input select, arm, recording mode, monitor IN/AUTO/OFF, count-in, punch in/out, punch bars, overdub, the MIDI arm of an instrument track, by mouse and by keyboard
//   (a native select cannot be clicked in headless Chrome: selects are operated with the arrow keys); English accessible names, distinct per track; REC with nothing
//   armed (the server's reason, shown by the page as "No track is armed"); REC shows the run in GET /proj/aufnahme; reload during a recording shows it again;
//   a take lands in the project (audio clip and MIDI notes); Ctrl+Z after a take removes it in one step; no console errors.
// Negative controls: REC with nothing armed; `--mutation ohne-arm` (the arm clicks are swallowed before they reach the page's handler) must exit non-zero.
// Exit 0: every point OK; 1: at least one FEHL; 2: usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stack.mjs';
import { starteBrowser } from './cdp.mjs';
import { baueKatalog } from '../tests/support/catalog.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: 'd' }, ausgabe: { type: 'string' }, mutation: { type: 'string' } } });
if (!/^[bde]$/.test(opt.instanz)) { process.stderr.write(`probe_aufnahme: instance ${opt.instanz} is not allowed: b, d or e only (never f)\n`); process.exit(2); }
if (opt.mutation !== undefined && opt.mutation !== 'ohne-arm') { process.stderr.write(`probe_aufnahme: unknown --mutation ${opt.mutation} (ohne-arm)\n`); process.exit(2); }
// tests/support/media_library.mjs takes the test instance lock at import: this probe's own letter, set before the dynamic import
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const { baueMediathek } = await import('../tests/support/media_library.mjs');
const { GeraeteSpeicher, standard } = await import('../areas/devices/store.ts');

const zeit = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-aufnahme${opt.mutation ? `-${opt.mutation}` : ''}`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (pruef, ms = 4000) => { for (let t = 0; t < ms; t += 40) { const v = await pruef(); if (v) return v; await warte(40); } return await pruef(); };
const ergebnis = { zeit, instanz: opt.instanz, mutation: opt.mutation ?? null, punkte: {} };
const zeilen = [];
const notiere = (k, ok, text) => { ergebnis.punkte[k] = { ok, text }; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)) : []);

// ---------- fixtures: an own HOME with the device file (input 1 with a device, not released for Cypher; no MIDI device), an empty catalogue ----------
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-aufprobe-'));
const heim = path.join(fix, 'heim');
const geraeteDatei = path.join(heim, '.config', `cypherdj-${opt.instanz}`, 'geraete.json');
fs.mkdirSync(path.dirname(geraeteDatei), { recursive: true });
{
  const k = standard();
  const e = k.eingaenge[0];
  e.profil = 'pc-eingang';
  e.audio = { knoten: 'probe-knoten', ports: ['probe:in_1_L', 'probe:in_1_R'] };
  e.latenz = { samples: 256, streuung: 0, min: 256, max: 256, laeufe: 20, quantum: 256, rate: 48000, art: 'software', gemessen_am: '2026-11-08' };
  e.name = 'Probe interface';
  new GeraeteSpeicher(geraeteDatei).schreibe(k);
}
const KANTEN = `/dev/shm/cypherdj-${opt.instanz}/eingaenge-kanten`;
const kantenVorher = fs.existsSync(KANTEN) ? fs.readFileSync(KANTEN) : null;
const mt = baueMediathek(path.join(fix, 'mt'));
baueKatalog(fix, []);
const proj = { wurzel: path.join(fix, 'proj'), arbeitsordner: path.join(fix, 'arr') };

let s = null, b = null, URL = '';
const w = (x) => b.werte(x);
const api = async (methode, weg, d, kopf = {}) => {
  const r = await fetch(URL + weg.slice(1), methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(d ?? {}) });
  return { code: r.status, j: await r.json() };
};
const projekt = async () => (await api('GET', '/proj/aktuell')).j.projekt;
const relais = () => jsonl(path.join(ORDNER, 'relais.jsonl'));
const kernSpur = (nr) => relais().filter((z) => z.adresse === '/k/rec/spur' && Number(z.felder.spur) === nr).at(-1)?.felder ?? null;
const kernStart = () => relais().filter((z) => z.adresse === '/k/rec/start').at(-1)?.felder ?? null;
const spurVon = (p, name) => p.spuren.find((x) => x.name === name);
const j = (x) => JSON.stringify(x);

// ---------- operations by mouse and by keyboard ----------
const SP = (name) => `.p-kopf[data-spur="${name}"]`;   // set below once the ids are known
const taste = async (key, code, vk, extra = {}) => {
  await b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...extra });
  await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: extra.modifiers });
};
const fokus = (sel) => w(`document.querySelector(${j(sel)}).focus()`);
// Space on a focused button is a click (the keyboard way of operating a button)
const tasteKlick = async (sel) => { await fokus(sel); await taste(' ', 'Space', 32, { text: ' ' }); };
const wertVon = (sel) => w(`document.querySelector(${j(sel)}).value`);
// a select operated with the arrow keys until it shows `wert` (the browser fires `change` on each step, like a user going through the list)
async function waehleTaste(sel, wert) {
  await fokus(sel);
  const opts = await w(`[...document.querySelector(${j(sel)}).options].map((o) => o.value)`);
  const ziel = opts.indexOf(wert);
  if (ziel < 0) return false;
  for (let i = 0; i < opts.length + 2; i++) {
    const jetzt = opts.indexOf(await wertVon(sel));
    if (jetzt === ziel) return true;
    if (jetzt < ziel) await taste('ArrowDown', 'ArrowDown', 40); else await taste('ArrowUp', 'ArrowUp', 38);
    await warte(60);
  }
  return (await wertVon(sel)) === wert;
}
const tippe = async (sel, text) => {
  await w(`(() => { const e = document.querySelector(${j(sel)}); e.focus(); e.select(); })()`);
  for (const c of text) await b.sende('Input.dispatchKeyEvent', { type: 'char', text: c });
  await b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};
const meldung = () => w(`document.querySelector('[data-p="meldung"]')?.textContent ?? ''`);
const recStatus = () => w(`document.querySelector('[data-p="rec-status"]').textContent`);
const recKnopf = () => w(`(() => { const e = document.querySelector('[data-p="rec"]'); return { text: e.textContent, disabled: e.disabled, pressed: e.getAttribute('aria-pressed'), titel: e.title }; })()`);
// accessible name as a screen reader gets it: aria-label, else the label element, else the text, else the title
const NAME_JS = `(el) => el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].textContent.trim()) || el.textContent.trim() || el.title || ''`;
const namen = (sel) => w(`[...document.querySelectorAll(${j(sel)})].map((${NAME_JS}))`);
const sichtbar = (sel) => w(`(() => { const e = document.querySelector(${j(sel)}); return !!e && !e.hidden && e.getClientRects().length > 0; })()`);

// arm clicks swallowed before the page's handler (mutation): the capture listener on the document runs first and stops the event
const MUTATION_OHNE_ARM = `document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.p-arm')) e.stopImmediatePropagation(); }, true);`;
const oeffne = async () => {
  await b.oeffne(URL);
  await warte(1500);
  if (opt.mutation === 'ohne-arm') await w(MUTATION_OHNE_ARM);
};

// each block is its own try: a failing step is a FEHL and the probe goes on with what it can still check, so the report is complete and the exit code is the sum
const schritt = async (name, f) => { try { await f(); } catch (e) { notiere(`${name} (aborted)`, false, e.message ?? String(e)); } };

try {
  s = await starteStapel(ORDNER, opt.instanz, { HOME: heim }, { serverArgs: ['--katalog', path.join(fix, 'katalog.sqlite'), '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle')], proj });
  URL = s.url;
  b = await starteBrowser();

  // ---------- project through the real server (Andreas): an audio track, an instrument track, 120 BPM ----------
  const neu = await api('POST', '/proj/neu', { name: 'Rec probe' });
  if (neu.code !== 200) throw new Error(`proj/neu ${neu.code} ${j(neu.j)}`);
  const st = await api('POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'setup', befehle: [{ befehl: 'tempo_setzen', bpm: 120 }, { befehl: 'spur_neu', art: 'audio', name: 'Vox' }, { befehl: 'spur_neu', art: 'instrument', name: 'Keys' }] });
  if (st.code !== 200) throw new Error(`setup ${st.code} ${j(st.j)}`);
  const p0 = await projekt();
  const vox = spurVon(p0, 'Vox'), keys = spurVon(p0, 'Keys');
  const V = `.p-kopf[data-spur="${vox.id}"]`, K = `.p-kopf[data-spur="${keys.id}"]`;
  await oeffne();
  await b.klick('[data-ansicht="produktion"]');
  await warte(1200);
  const onClean = await w(`!!document.querySelector(${j(V + ' .p-arm')}) && !!document.querySelector(${j(K + ' .p-arm')})`);
  notiere('0 setup', onClean, `page open, heads of Vox (${vox.id}) and Keys (${keys.id}) present; mutation ${opt.mutation ?? 'none'}`);

  // ---------- 1 input, arm, mode, monitor of the audio track ----------
  await schritt('1', async () => {
    const arm0 = await w(`document.querySelector(${j(V + ' .p-arm')}).disabled`);
    notiere('1.1 arm needs an input', arm0 === true, `arm button disabled before an input is chosen: ${arm0}`);
    const opts = await w(`[...document.querySelector(${j(V + ' .p-eingang')}).options].map((o) => o.value + '=' + o.textContent)`);
    notiere('1.2 the input select lists the device input by its name', opts.includes('ein/1=Probe interface') && opts.some((o) => o.startsWith('erz/1=')), `options ${j(opts)}`);
    const ok = await waehleTaste(`${V} .p-eingang`, 'ein/1');
    const p = await bis(async () => { const x = await projekt(); return spurVon(x, 'Vox').aufnahme?.eingang ? x : null; });
    const e = p && spurVon(p, 'Vox').aufnahme;
    notiere('1.3 input by keyboard (arrow keys) is in the project', ok && e?.eingang?.art === 'extern' && e.eingang.paar === 1 && e.eingang.modus === 'stereo' && e.scharf === false, `select ${ok}, project ${j(e)}`);
    const arm1 = await w(`document.querySelector(${j(V + ' .p-arm')}).disabled`);
    notiere('1.4 the input enables the arm button', arm1 === false, `disabled ${arm1}`);
    await b.klick(`${V} .p-arm`);
    const pa = await bis(async () => { const x = await projekt(); return spurVon(x, 'Vox').aufnahme?.scharf ? x : null; });
    const k = await bis(() => kernSpur(vox.nr)?.scharf === 1 ? kernSpur(vox.nr) : null);
    notiere('1.5 arm by mouse: project armed, the core got /k/rec/spur scharf 1 on ein_1, mode 0, monitor auto', !!pa && k?.eingang === 1 && k.modus === 0 && k.monitor === 1, `project ${j(pa && spurVon(pa, 'Vox').aufnahme)}, core ${j(k)}`);
    const pr = await w(`document.querySelector(${j(V + ' .p-arm')}).getAttribute('aria-pressed')`);
    notiere('1.6 the arm button shows the state (aria-pressed)', pr === 'true' && !!pa, `aria-pressed ${pr}`);
    // mode (an external input only)
    const msicht = await sichtbar(`${V} .p-modus`);
    const mok = await waehleTaste(`${V} .p-modus`, 'links');
    const pm = await bis(async () => { const x = await projekt(); return spurVon(x, 'Vox').aufnahme?.eingang?.modus === 'links' ? x : null; });
    const km = await bis(() => kernSpur(vox.nr)?.modus === 1 ? kernSpur(vox.nr) : null);
    notiere('1.7 recording mode L by keyboard: project modus links, core modus 1', msicht && mok && !!pm && km?.modus === 1, `mode select visible ${msicht}, project ${j(pm && spurVon(pm, 'Vox').aufnahme.eingang)}, core ${j(km)}`);
    // monitor: IN by mouse, OFF by keyboard, AUTO by mouse (absent key in the project = auto)
    const mon = async (was, via) => {
      const sel = `${V} .p-mon[data-mon="${was}"]`;
      if (via === 'maus') await b.klick(sel); else await tasteKlick(sel);
      const code = { aus: 0, auto: 1, ein: 2 }[was];
      const k = await bis(() => (kernSpur(vox.nr)?.monitor === code ? kernSpur(vox.nr) : null));
      const pj = await bis(async () => { const x = await projekt(); const m = spurVon(x, 'Vox').aufnahme?.monitor; return (was === 'auto' ? m === undefined : m === was) ? x : null; });
      const pr = await w(`document.querySelector(${j(sel)}).getAttribute('aria-pressed')`);
      return { ok: !!k && !!pj && pr === 'true', k, m: pj && (spurVon(pj, 'Vox').aufnahme.monitor ?? 'auto') };
    };
    for (const [was, via] of [['ein', 'maus'], ['aus', 'tastatur'], ['auto', 'maus']]) {
      const r = await mon(was, via);
      notiere(`1.8 monitor ${was.toUpperCase()} by ${via === 'maus' ? 'mouse' : 'keyboard'}: project and core agree, the button is pressed`, r.ok, `project ${r.m}, core ${j(r.k)}`);
    }
    // back to an internal input for the take: the select by keyboard, the core gets the new input
    const iok = await waehleTaste(`${V} .p-eingang`, 'erz/1');
    const ki = await bis(() => (kernSpur(vox.nr)?.eingang === 11 ? kernSpur(vox.nr) : null));
    const pi = await bis(async () => { const x = await projekt(); const e = spurVon(x, 'Vox').aufnahme; return e?.eingang?.art === 'intern' && e.eingang.name === 'erz/1' && e.scharf ? x : null; });
    notiere('1.9 input back to the internal tap erz/1 by keyboard: still armed, mode and monitor of an external input gone from the head', iok && !!pi && !!ki && !(await sichtbar(`${V} .p-modus`)) && !(await sichtbar(`${V} .p-monitor`)),
      `core ${j(ki)}, project ${j(pi && spurVon(pi, 'Vox').aufnahme)}`);
  });

  // ---------- 2 the MIDI arm of an instrument track ----------
  await schritt('2', async () => {
    const opts = await w(`[...document.querySelector(${j(K + ' .p-eingang')}).options].map((o) => o.value + '=' + o.textContent)`);
    notiere('2.1 an instrument track offers MIDI in and nothing else (plus the empty entry)', j(opts) === j(['=input', 'midi/1=MIDI in']), `options ${j(opts)}`);
    const ok = await waehleTaste(`${K} .p-eingang`, 'midi/1');
    const p = await bis(async () => { const x = await projekt(); return spurVon(x, 'Keys').aufnahme?.eingang?.art === 'midi' ? x : null; });
    notiere('2.2 MIDI in by keyboard is in the project', ok && !!p, `project ${j(p && spurVon(p, 'Keys').aufnahme)}`);
    await tasteKlick(`${K} .p-arm`);   // the keyboard way for the arm of this track
    const pa = await bis(async () => { const x = await projekt(); return spurVon(x, 'Keys').aufnahme?.scharf ? x : null; });
    const k = await bis(() => (kernSpur(keys.nr)?.scharf === 1 ? kernSpur(keys.nr) : null));
    notiere('2.3 MIDI arm by keyboard: project armed, the core got /k/rec/spur scharf 1 on eingang 30 (midi_ein_1)', !!pa && k?.eingang === 30 && k.modus === 0, `project ${j(pa && spurVon(pa, 'Keys').aufnahme)}, core ${j(k)}`);
    notiere('2.4 no mode, monitor or input level bar on an instrument track', !(await sichtbar(`${K} .p-modus`)) && !(await sichtbar(`${K} .p-monitor`)) && !(await sichtbar(`${K} .p-eingpegel`)), 'hidden');
  });

  // ---------- 3 project settings: count-in, punch, bars, overdub ----------
  await schritt('3', async () => {
    const aufn = async (f, ms = 3000) => bis(async () => { const a = (await projekt()).aufnahme; return f(a ?? {}) ? a : null; }, ms);
    const z = await waehleTaste('[data-p="vorzaehler"]', '1');
    const a1 = await aufn((a) => a.vorzaehler_takte === 1);
    notiere('3.1 count-in 1 bar by keyboard: project vorzaehler_takte 1', z && !!a1, `project ${j(a1)}`);
    await b.klick('[data-p="punch-ein"]');
    const a2 = await aufn((a) => a.punch?.ein === true);
    const pressed = (sel, wert) => bis(async () => (await w(`document.querySelector('[data-p="${sel}"]').getAttribute('aria-pressed')`)) === wert);   // the page repaints after the server's echo
    notiere('3.2 PUNCH IN by mouse: project punch.ein, aria-pressed', !!a2 && !!(await pressed('punch-ein', 'true')), `punch ${j(a2?.punch)}`);
    await tasteKlick('[data-p="punch-aus"]');
    const a3 = await aufn((a) => a.punch?.aus === true);
    notiere('3.3 PUNCH OUT by keyboard: project punch.aus', !!a3, `punch ${j(a3?.punch)}`);
    await tippe('[data-p="punch-bis"]', '3'); await warte(300);
    await tippe('[data-p="punch-von"]', '2');
    const a4 = await aufn((a) => a.punch?.von_beat === 4 && a.punch?.bis_beat === 12);
    notiere('3.4 punch bars 2 to 3 typed with the keyboard: project von_beat 4, bis_beat 12', !!a4, `punch ${j(a4?.punch)}; fields ${j(await w(`[(document.querySelector('[data-p="punch-von"]').value), document.querySelector('[data-p="punch-bis"]').value]`))}`);
    notiere('3.5 the punch range is drawn as a band while a punch is on', await w(`!!window.djkProd && document.querySelectorAll('[data-p="flaeche"]').length > 0`), 'area present (the band itself is a pure-function test, T5)');
    // the punch switches off again: the take of the probe is the whole pass
    await b.klick('[data-p="punch-ein"]'); await tasteKlick('[data-p="punch-aus"]');
    const a5 = await aufn((a) => a.punch?.ein === false && a.punch?.aus === false);
    notiere('3.6 PUNCH IN and OUT off again (mouse, keyboard)', !!a5, `punch ${j(a5?.punch)}`);
    await b.klick('[data-p="overdub"]');
    const a6 = await aufn((a) => a.overdub === true);
    notiere('3.7 OVERDUB by mouse: project overdub true, aria-pressed', !!a6 && !!(await pressed('overdub', 'true')), `overdub ${a6?.overdub}`);
    await b.klick('[data-p="overdub"]');
    const a7 = await aufn((a) => a.overdub === false);
    notiere('3.8 OVERDUB off again', !!a7, `overdub ${a7?.overdub}`);
    const zz = await waehleTaste('[data-p="vorzaehler"]', '0');
    const a8 = await aufn((a) => a.vorzaehler_takte === 0);
    notiere('3.9 count-in off again', zz && !!a8, `project ${j(a8)}`);
  });

  // ---------- 4 English labels and accessible names ----------
  await schritt('4', async () => {
    const feste = ['[data-p="rec"]', '[data-p="vorzaehler"]', '[data-p="punch-ein"]', '[data-p="punch-aus"]', '[data-p="punch-von"]', '[data-p="punch-bis"]', '[data-p="overdub"]'];
    const alle = [];
    for (const sel of feste) alle.push([sel, (await namen(sel))[0]]);
    for (const [kopf, wer] of [[V, 'Vox'], [K, 'Keys']]) for (const k of ['.p-arm', '.p-eingang']) alle.push([`${wer} ${k}`, (await namen(`${kopf} ${k}`))[0]]);
    for (const k of ['.p-modus', '.p-mon[data-mon="ein"]', '.p-mon[data-mon="auto"]', '.p-mon[data-mon="aus"]']) alle.push([`Vox ${k}`, (await namen(`${V} ${k}`))[0]]);
    const leer = alle.filter(([, n]) => !n);
    const deutsch = alle.filter(([, n]) => n && (/[äöüßÄÖÜ]/.test(n) || /\b(Spur|Aufnahme|Eingang|scharf|Wiedergabe|Überspielen)\b/i.test(n)));
    notiere('4.1 every recording control has an accessible name', leer.length === 0, `${alle.length} controls${leer.length ? `, without a name: ${j(leer.map((x) => x[0]))}` : ''}`);
    notiere('4.2 the names are English', deutsch.length === 0, deutsch.length ? j(deutsch) : alle.map(([, n]) => n).join(' | '));
    const proSpur = (k) => [alle.find(([x]) => x === `Vox ${k}`)?.[1], alle.find(([x]) => x === `Keys ${k}`)?.[1]];
    const verschieden = ['.p-arm', '.p-eingang'].map((k) => proSpur(k)).every(([a, c]) => a && c && a !== c && a.includes('Vox') && c.includes('Keys'));
    notiere('4.3 arm and input names carry the track name (two tracks, two different names)', verschieden, `${j(proSpur('.p-arm'))} ${j(proSpur('.p-eingang'))}`);
  });

  // ---------- 5 REC: nothing armed, the run, reload during it, the take, Ctrl+Z ----------
  const laufNoten = async (spur) => { const x = await projekt(); const c = spurVon(x, spur).clips; return { clips: c.length, noten: c.reduce((n, q) => n + (q.noten?.length ?? 0), 0), ids: c.flatMap((q) => (q.noten ?? []).map((n) => n.id)) }; };
  await schritt('5a', async () => {
    // negative control: disarm both tracks. The REC button is then disabled (title says why); forced enabled, a click reaches the server, which refuses with nichts_scharf
    await b.klick(`${V} .p-arm`); await tasteKlick(`${K} .p-arm`);
    const aus = await bis(async () => { const x = await projekt(); return !spurVon(x, 'Vox').aufnahme?.scharf && !spurVon(x, 'Keys').aufnahme?.scharf ? x : null; });
    const rk = await recKnopf();
    notiere('5.1 negative control: nothing armed, REC is disabled and says why', !!aus && rk.disabled === true && /Arm a track/.test(rk.titel), `disabled ${rk.disabled}, title "${rk.titel}"`);
    const vor = relais().filter((z) => z.adresse === '/k/rec/start').length;
    await w(`document.querySelector('[data-p="rec"]').disabled = false`);
    await b.klick('[data-p="rec"]');
    const text = await bis(async () => { const m = await meldung(); return m || null; });
    notiere('5.2 negative control: REC with nothing armed gives "No track is armed" and starts nothing', text === 'No track is armed' && relais().filter((z) => z.adresse === '/k/rec/start').length === vor, `message "${text}", /k/rec/start before ${vor}, after ${relais().filter((z) => z.adresse === '/k/rec/start').length}`);
    // arm again for the takes
    await b.klick(`${V} .p-arm`); await b.klick(`${K} .p-arm`);
    await bis(async () => { const x = await projekt(); return spurVon(x, 'Vox').aufnahme?.scharf && spurVon(x, 'Keys').aufnahme?.scharf; });
  });

  let erster = null;
  await schritt('5b', async () => {
    const rk0 = await recKnopf();
    notiere('5.3 REC is enabled with both tracks armed', rk0.disabled === false && /REC/.test(rk0.text), j(rk0));
    await b.klick('[data-p="rec"]');
    const lauf = await bis(async () => { const r = await api('GET', '/proj/aufnahme'); return r.j.lauf ?? null; }, 6000);
    const ks = relais().filter((z) => z.adresse === '/k/rec/start').at(-1)?.felder;
    notiere('5.4 REC shows the run in GET /proj/aufnahme and the core got /k/rec/start (count-in 0)', !!lauf && ks && Number(ks.vorzaehler_takte ?? 0) === 0, `lauf ${j(lauf)?.slice(0, 300)}, start ${j(ks)}`);
    const rk = await bis(async () => { const x = await recKnopf(); return x.pressed === 'true' ? x : null; });
    const st = await bis(async () => { const t = await recStatus(); return /Recording/.test(t) ? t : null; });
    notiere('5.5 the button turns into STOP REC (pressed) and the status says Recording', !!rk && /STOP REC/.test(rk.text) && !!st, `button ${j(rk)}, status "${st}"`);
    await warte(1500);
    // reload during the recording: the page finds the run again
    await oeffne();
    await b.klick('[data-ansicht="produktion"]'); await warte(1200);
    const rk2 = await bis(async () => { const x = await recKnopf(); return x.pressed === 'true' ? x : null; }, 5000);
    notiere('5.6 reload during a recording shows it again (STOP REC, pressed)', !!rk2 && /STOP REC/.test(rk2.text), `button ${j(rk2)}, status "${await recStatus()}"`);
    // STOP by the key R (keyboard), focus on the page
    await w('document.activeElement && document.activeElement.blur()');
    await taste('r', 'KeyR', 82, { text: 'r' });
    const ende = await bis(async () => { const r = await api('GET', '/proj/aufnahme'); return r.j.lauf === null ? r.j : null; }, 15000);
    const gemeldet = await bis(async () => { const m = await meldung(); return /Take saved|Recording ended|but:/.test(m) ? m : null; }, 6000);
    notiere('5.7 STOP by the key R ends the run; the page says "Take saved"', !!ende && gemeldet === 'Take saved', `message "${gemeldet}", letzte ${j(ende?.letzte)?.slice(0, 300)}`);
    const a = await bis(async () => { const x = await laufNoten('Keys'); const v = spurVon(await projekt(), 'Vox'); return x.clips >= 1 && v.clips.length >= 1 ? { keys: x, vox: v.clips.length, art: v.clips[0].art } : null; }, 8000);
    erster = { keys: a?.keys };
    notiere('5.8 the take is in the project: an audio clip on Vox and a MIDI clip with notes on Keys', !!a && a.art === 'audio' && a.keys.noten >= 1, `Vox clips ${a?.vox}, Keys ${j(a && { clips: a.keys.clips, noten: a.keys.noten })}`);
    const verlauf = (await api('GET', '/proj/verlauf')).j;
    const letzter = verlauf.at(-1);
    notiere('5.9 one history entry for audio and MIDI together', /take|record/i.test(letzter?.label ?? '') && letzter?.quelle === 'andreas', `last entry ${j(letzter)}`);
    // Ctrl+Z right after the take (the open slice-1 hand test): one step removes the audio clip and the MIDI clip together; Ctrl+Shift+Z brings both back
    await w('document.activeElement && document.activeElement.blur()');
    await taste('z', 'KeyZ', 90, { modifiers: 2 });
    const weg = await bis(async () => { const x = await laufNoten('Keys'); const v = spurVon(await projekt(), 'Vox'); return x.clips === 0 && v.clips.length === 0 ? x : null; }, 5000);
    const pv = await projekt();
    notiere('5.9a Ctrl+Z after the take removes it in ONE step: no clip on Vox, none on Keys', !!weg, `Vox clips ${spurVon(pv, 'Vox').clips.length}, Keys clips ${spurVon(pv, 'Keys').clips.length}`);
    await taste('Z', 'KeyZ', 90, { modifiers: 10 });
    const da = await bis(async () => { const x = await laufNoten('Keys'); const v = spurVon(await projekt(), 'Vox'); return x.clips >= 1 && v.clips.length >= 1 ? x : null; }, 5000);
    notiere('5.9b Ctrl+Shift+Z brings the take back (same note ids)', !!da && !!erster && da.ids.join() === erster.keys.ids.join(), `notes ${da?.noten}, ids equal ${!!da && da.ids.join() === erster?.keys.ids.join()}`);
  });

  // ---------- 5c count-in 1 bar and overdub: the second take adds MIDI notes ----------
  await schritt('5c', async () => {
    await waehleTaste('[data-p="vorzaehler"]', '1');
    await b.klick('[data-p="overdub"]');
    await bis(async () => { const a = (await projekt()).aufnahme; return a?.vorzaehler_takte === 1 && a?.overdub === true; });
    const vorher = await laufNoten('Keys');
    await b.klick('[data-p="rec"]');
    const zaehl = await bis(async () => { const t = await recStatus(); return /Counting in/.test(t) ? t : null; }, 5000);
    const ks = await bis(() => { const f = relais().filter((z) => z.adresse === '/k/rec/start').at(-1)?.felder; return Number(f?.vorzaehler_takte) === 1 ? f : null; });
    notiere('5.10 count-in 1 bar: the status says Counting in and the core got vorzaehler_takte 1', !!zaehl && !!ks, `status "${zaehl}", start ${j(ks)}`);
    const rec = await bis(async () => { const t = await recStatus(); return /Recording/.test(t) ? t : null; }, 8000);
    await warte(1200);
    await b.klick('[data-p="rec"]');
    await bis(async () => (await api('GET', '/proj/aufnahme')).j.lauf === null, 15000);
    const nachher = await bis(async () => { const x = await laufNoten('Keys'); return x.noten > vorher.noten ? x : null; }, 8000);
    notiere('5.11 overdub on: the second take adds notes to Keys, the ids of the first take stay', !!rec && !!nachher && vorher.ids.every((id) => nachher.ids.includes(id)),
      `status after the count-in "${rec}", notes ${vorher.noten} -> ${nachher?.noten}, clips ${vorher.clips} -> ${nachher?.clips}, first ids kept ${vorher.ids.every((id) => nachher?.ids.includes(id))}`);
    // Ctrl+Z after the take: one step back to the first take, a second one to the empty tracks
    await w('document.activeElement && document.activeElement.blur()');
    await taste('z', 'KeyZ', 90, { modifiers: 2 });
    const z1 = await bis(async () => { const x = await laufNoten('Keys'); return x.noten === vorher.noten ? x : null; }, 5000);
    notiere('5.12 Ctrl+Z after the second take removes it in one step (back to the first take)', !!z1, `notes ${nachher?.noten} -> ${z1?.noten ?? (await laufNoten('Keys')).noten} (first take had ${vorher.noten})`);
  });

  const fk = b.konsole.filter((k) => (k.typ === 'exception' || k.typ === 'error') && !/^Failed to load resource: the server responded with a status of 409/.test(k.text));
  notiere('9 console', fk.length === 0, `errors or exceptions ${fk.length}${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text).join(' | ')}` : ''} (the 409 of the negative control is not counted)`);
} catch (e) {
  notiere('ABORT', false, e.stack ?? String(e));
} finally {
  try { await b?.zu(); } catch { /* browser gone */ }
  try { await s?.stoppe(); } catch { /* stack gone */ }
  // the edge file of the instance as found
  try { if (kantenVorher === null) fs.rmSync(KANTEN, { force: true }); else fs.writeFileSync(KANTEN, kantenVorher); } catch { /* the folder is not there */ }
  fs.rmSync(fix, { recursive: true, force: true });
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Recording probe ${zeit} (instance ${opt.instanz}, mutation ${opt.mutation ?? 'none'})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} - report ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
