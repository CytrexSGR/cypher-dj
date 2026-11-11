// Browser probe of the MIDI import on the page (spec docs/superpowers/specs/2026-11-10-midi-import.md): the real page server with a real project
// store (check/stack.mjs, proj), headless Chrome over cdp.mjs (no window, no sound, no studio). The file goes in through the file input (CDP
// DOM.setFileInputFiles), the clicks are real mouse events.
// Call: node check/probe_midi_import.mjs [--instanz g] [--ausgabe <folder>] [--bolero <path to a big .mid, optional>]
// Points: 1 small file: preview shows parts, tempo and hints and changes nothing; 2 IMPORT creates the tracks and the tempo, one history entry;
//   3 UNDO takes it all back; 4 a part left unticked is not imported; 5 a refused file shows its reason text; 6 (with --bolero) the large case:
//   preview time, import time, 26 tracks, frame time of the page before and after, the preview panel fits the window; 7 console clean.
// Result: ergebnis.json and bild-*.png in the output folder (default /dev/shm/midi-probe-<time>); exit 1 on any FEHL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { starteStapel } from './stack.mjs';
import { starteBrowser } from './cdp.mjs';
import { smf, spur, nameMeta, tempoMeta, taktMeta, programm, note } from '../tests/helpers/smf_build.mjs';

const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: 'g' }, ausgabe: { type: 'string', default: `/dev/shm/midi-probe-${Date.now()}` }, bolero: { type: 'string', default: '' }, kits: { type: 'string', default: '' } } });
fs.mkdirSync(opt.ausgabe, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnis = { instanz: opt.instanz, punkte: {} };
let fehl = 0;
const notiere = (k, ok, text) => { ergebnis.punkte[k] = { ok, text }; if (!ok) fehl++; process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

// kit folder of its own: `techno` copied from a given folder (--kits), `gm` is built by the import
const kitWurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-midi-kits-'));
if (opt.kits) execFileSync('cp', ['-r', path.join(opt.kits, 'techno'), path.join(kitWurzel, 'techno')]);
const proj = { wurzel: fs.mkdtempSync(path.join(os.tmpdir(), 'djk-midi-proj-')), arbeitsordner: fs.mkdtempSync(path.join(os.tmpdir(), 'djk-midi-arr-')) };
const klein = path.join(os.tmpdir(), `djk-midi-probe-${process.pid}.mid`);
fs.writeFileSync(klein, smf([
  spur([nameMeta('conductor'), tempoMeta(90), taktMeta(3, 2)]),
  spur([nameMeta('Lead'), programm(0, 80), ...note(0, 60, 100, 96), ...note(0, 64, 100, 96), ...note(0, 67, 100, 96)]),
  spur([nameMeta('Kit'), ...note(9, 36, 110, 48), ...note(9, 38, 100, 48, 48), ...note(9, 42, 90, 24, 48)]),
]));
const kaputt = path.join(os.tmpdir(), `djk-midi-probe-${process.pid}-x.mid`);
fs.writeFileSync(kaputt, Buffer.from('this is not a midi file at all'));

const s = await starteStapel(opt.ausgabe, opt.instanz, { CYPHERDJ_KIT_ORDNER: kitWurzel }, { proj });
const b = await starteBrowser();
const w = (x) => b.werte(x);
const meldung = () => w(`document.querySelector('[data-p="meldung"]').textContent`);
const projekt = () => w('window.djkProd.projekt');
const panel = () => w(`(() => { const e = document.querySelector('[data-p="midi-vorschau"]'); if (!e || e.hidden) return null; const r = e.getBoundingClientRect();
  return { kopf: e.querySelector('.p-midi-kopf').textContent, zeilen: [...e.querySelectorAll('.p-midi-spuren li')].map((l) => l.textContent), hinweise: [...e.querySelectorAll('.p-midi-hinweise li')].map((l) => l.textContent),
    rect: { l: r.left, r: r.right, t: r.top, b: r.bottom }, fenster: { w: innerWidth, h: innerHeight } }; })()`);
const waehleDatei = async (pfad) => {
  const doc = await b.sende('DOM.getDocument', { depth: 1 });
  const k = await b.sende('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-p="midi-datei"]' });
  await b.sende('DOM.setFileInputFiles', { nodeId: k.nodeId, files: [pfad] });
};
const bisWahr = async (ausdruck, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await w(ausdruck)) return Date.now() - t0; await warte(50); } return -1; };
const bildMs = async () => { const r = await w('window.djkProdBild.slice(-120)'); r.sort((a, c) => a - c); return { median: r[Math.floor(r.length / 2)], p95: r[Math.floor(r.length * 0.95)], n: r.length }; };
const AUSFALL = /^Failed to load resource: the server responded with a status of (409|400|404)/;
// the probe stack has no catalogue: the library browser's /stoebern answers 503 (not part of the import)
const OHNE_KATALOG = /\/stoebern/;
const fehlerKonsole = () => b.konsole.filter((k) => (k.typ === 'exception' || k.typ === 'error') && !AUSFALL.test(k.text) && !(k.url && OHNE_KATALOG.test(k.url)));
const verlaufLabels = async () => (await (await fetch(`${s.url}proj/verlauf`)).json());

try {
  await b.oeffne(s.url);
  await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1200);
  // a project through the page itself: NEW, the name, Enter
  await b.klick('[data-p="neu"]');
  await b.sende('Input.insertText', { text: 'MIDI probe' });
  await b.sende('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  notiere('0 Setup', (await bisWahr('window.djkProd.projekt !== null')) >= 0, 'a project is open through NEW');
  const rev0 = (await projekt()).rev;
  const knopfAn = await w(`!document.querySelector('[data-p="midi-import"]').disabled`);
  notiere('0 Button', knopfAn, 'IMPORT MIDI is enabled once a project is open');

  // ---- 1 preview of the small file
  await waehleDatei(klein);
  const t1 = await bisWahr(`document.querySelector('[data-p="midi-vorschau"]') && !document.querySelector('[data-p="midi-vorschau"]').hidden`, 10000);
  const p1 = await panel();
  notiere('1 Preview', t1 >= 0 && p1?.zeilen.length === 2 && /90 BPM/.test(p1.kopf) && /3\/4/.test(p1.kopf) && (await projekt()).rev === rev0 && (await projekt()).spuren.length === 0,
    `panel after ${t1} ms: "${p1?.kopf}"; rows ${JSON.stringify(p1?.zeilen)}; hints ${p1?.hinweise.length}; project untouched (rev ${(await projekt()).rev})`);
  await b.bild(path.join(opt.ausgabe, 'bild-vorschau-klein.png'));

  // ---- 4 unticked part (before the import so the import below is the real one): untick the drums, import, then undo, then again with all
  await w(`document.querySelectorAll('[data-p="midi-vorschau"] input')[1].click()`);
  await b.klick('[data-p="midi-los"]');
  await bisWahr('window.djkProd.projekt.spuren.length > 0', 15000);
  const p4 = await projekt();
  notiere('4 Unticked part', p4.spuren.length === 1 && p4.spuren[0].name === 'Lead', `tracks ${JSON.stringify(p4.spuren.map((x) => x.name))}`);
  await b.klick('[data-p="undo"]');
  await bisWahr('window.djkProd.projekt.spuren.length === 0', 10000);

  // ---- 2 the full import
  await waehleDatei(klein);
  await bisWahr(`document.querySelector('[data-p="midi-vorschau"]') && !document.querySelector('[data-p="midi-vorschau"]').hidden`, 10000);
  await b.klick('[data-p="midi-los"]');
  const t2 = await bisWahr(`window.djkProd.projekt.spuren.length === 2 && document.querySelector('[data-p="midi-vorschau"]').hidden`, 15000);   // the SSE shows the tracks before the answer arrives: wait for the panel to close
  const p2 = await projekt();
  const clips = p2.spuren.map((x) => [x.name, x.clips.length, x.clips[0]?.noten?.length ?? x.clips[0]?.noten_zahl]);
  const bildHidden = await w(`document.querySelector('[data-p="midi-vorschau"]').hidden`);
  const meld = await meldung();
  notiere('2 Import', t2 >= 0 && p2.tempo_bpm === 90 && bildHidden && /one undo step/.test(meld),
    `after ${t2} ms: tracks ${JSON.stringify(clips)}, tempo ${p2.tempo_bpm}, panel closed ${bildHidden}, message "${meld}"`);
  const vl = await verlaufLabels();
  const labels = (vl.eintraege ?? vl).map?.((e) => e.label ?? e[1]) ?? [];
  notiere('2 One step', labels.filter((l) => /MIDI import/.test(l)).length >= 1 && p2.rev > rev0, `history labels ${JSON.stringify(labels)}`);

  // ---- 3 undo
  await b.klick('[data-p="undo"]');
  const t3 = await bisWahr('window.djkProd.projekt.spuren.length === 0', 10000);
  notiere('3 Undo', t3 >= 0, `one UNDO removed both tracks (${t3} ms)`);

  // ---- 5 refused file
  await waehleDatei(kaputt);
  await bisWahr(`/Standard MIDI/.test(document.querySelector('[data-p="meldung"]').textContent)`, 5000);
  const m5 = await meldung();
  notiere('5 Refusal', /not a Standard MIDI file/.test(m5) && (await panel()) === null, `message "${m5}"`);

  // ---- 6 the large case
  if (opt.bolero && fs.existsSync(opt.bolero)) {
    const vor = await bildMs();
    const t0 = Date.now();
    await waehleDatei(opt.bolero);
    const tp = await bisWahr(`document.querySelector('[data-p="midi-vorschau"]') && !document.querySelector('[data-p="midi-vorschau"]').hidden`, 60000);
    const pb = await panel();
    const innen = pb && pb.rect.t >= 0 && pb.rect.b <= pb.fenster.h && pb.rect.r <= pb.fenster.w && pb.rect.l >= 0;
    notiere('6 Preview', tp >= 0 && pb.zeilen.length === 26, `${pb?.zeilen.length} rows after ${tp} ms (file read, base64, server); head "${pb?.kopf}"; panel inside the window ${innen}; hints ${JSON.stringify(pb?.hinweise)}`);
    await b.bild(path.join(opt.ausgabe, 'bild-vorschau-bolero.png'));
    const t1b = Date.now();
    await b.klick('[data-p="midi-los"]');
    const ti = await bisWahr(`window.djkProd.projekt.spuren.length === 26 && document.querySelector('[data-p="midi-vorschau"]').hidden`, 120000);
    const dauerImport = Date.now() - t1b;
    await warte(1500);
    const nach = await bildMs();
    const pj = await projekt();
    const noten = pj.spuren.reduce((a, x) => a + x.clips.reduce((c, y) => c + (y.noten?.length ?? y.noten_zahl ?? 0), 0), 0);
    notiere('6 Import', ti >= 0 && pj.tempo_bpm === 72, `26 tracks after ${dauerImport} ms (click until the panel closed and the page shows them); tempo ${pj.tempo_bpm}; notes counted on the page ${noten}; total from file choice ${Date.now() - t0} ms`);
    notiere('6 Frame time', nach.p95 < 50, `page frame time before: median ${vor.median?.toFixed?.(2)} ms, p95 ${vor.p95?.toFixed?.(2)} ms (n ${vor.n}); after: median ${nach.median?.toFixed?.(2)} ms, p95 ${nach.p95?.toFixed?.(2)} ms (n ${nach.n})`);
    await b.bild(path.join(opt.ausgabe, 'bild-bolero-importiert.png'));
    const sp = await w(`(() => { const e = document.querySelector('[data-p="koepfe"]'); return { koepfe: e.children.length, scrollHoehe: document.querySelector('[data-p="koerper"]').scrollHeight, sichtbar: document.querySelector('[data-p="koerper"]').clientHeight }; })()`);
    ergebnis.bolero = { vorschau_ms: tp, import_ms: dauerImport, vor, nach, spuren: pj.spuren.length, noten, koerper: sp };
  } else notiere('6 Large case', true, 'skipped (no --bolero file)');

  const fk = fehlerKonsole();
  notiere('7 Console', fk.length === 0, fk.length ? JSON.stringify(fk.slice(0, 5)) : 'no errors or exceptions');
} catch (e) {
  notiere('99 Probe', false, `${e.stack ?? e}`);
} finally {
  fs.writeFileSync(path.join(opt.ausgabe, 'ergebnis.json'), JSON.stringify(ergebnis, null, 1));
  await b.zu();
  await s.stoppe();
  for (const d of [kitWurzel, proj.wurzel, proj.arbeitsordner, klein, kaputt]) fs.rmSync(d, { recursive: true, force: true });
}
process.stdout.write(`${fehl === 0 ? 'ALL OK' : `${fehl} FAILED`}; output ${opt.ausgabe}\n`);
process.exit(fehl === 0 ? 0 : 1);
