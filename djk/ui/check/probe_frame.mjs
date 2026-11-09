// Frame cost probe for 1.12 Slice 3 task 5 (fix round 2, I1): 32 tracks, each with a lane on fader, pan, mute and solo, while the transport plays. Reads the
// ring window.djkProdSpurBild (ms of the track_heads.js beimBild hook per frame) and counts the value-setter calls of the range inputs. Real page server and
// core stand-in on a probe instance (no sound). node check/probe_frame.mjs [--instanz e] [--ausgabe <folder>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stack.mjs';
import { starteBrowser } from './cdp.mjs';
import { baueKatalog } from '../tests/support/catalog.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: 'e' }, ausgabe: { type: 'string' } } });
if (!/^[e-z]$/.test(opt.instanz)) throw new Error('probes only on instance e or higher');
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const { baueMediathek } = await import('../tests/support/media_library.mjs');
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe) : path.join(HIER, 'ergebnisse', `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-rahmen`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
const notiere = (k, ok, text) => { zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-rahmen-'));
const SHA = 'a'.repeat(64);
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
const geladen = async () => { for (let i = 0; i < 300; i++) { const a = await aktuell(); if (a.kern?.rev_geladen === a.projekt?.wiedergabe_rev && a.kern?.status === 0) return true; await warte(100); } return false; };
const stat = (a) => { const v = [...a].sort((x, y) => x - y); return { n: v.length, mean: v.reduce((x, y) => x + y, 0) / v.length, p95: v[Math.floor(v.length * 0.95)], max: v.at(-1) }; };
try {
  const neu = await api('POST', '/proj/neu', { name: 'Rahmen' });
  const slug = neu.j.slug, N = 32, ZIELE = ['fader', 'pan', 'mute', 'solo'];
  let r = await api('POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'tracks', befehle: [{ befehl: 'tempo_setzen', bpm: 128 }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 64 },
    ...Array.from({ length: N }, (_, i) => ({ befehl: 'spur_neu', art: 'audio', name: `T${i + 1}` }))] });
  if (r.code !== 200) throw new Error(`tracks ${r.code} ${JSON.stringify(r.j)}`);
  const ids = r.j.projekt.spuren.map((x) => x.id);
  r = await api('POST', '/proj/aendern', { rev: r.j.projekt.rev, label: 'lanes', befehle: ids.flatMap((id) => ZIELE.map((ziel) => ({ befehl: 'auto_neu', spur_id: id, ziel }))) });
  if (r.code !== 200) throw new Error(`lanes ${r.code} ${JSON.stringify(r.j)}`);
  const punkte = (ziel, k) => (ziel === 'fader' ? [{ beat: 0, wert: 0 }, { beat: 64, wert: -20 - k }] : ziel === 'pan' ? [{ beat: 0, wert: -1 }, { beat: 64, wert: 1 }]
    : [{ beat: 0, wert: ziel === 'mute' ? 1 : 0, form: 'sprung' }, { beat: 64, wert: ziel === 'mute' ? 1 : 0, form: 'sprung' }]);
  r = await api('POST', '/proj/aendern', { rev: r.j.projekt.rev, label: 'ramps', befehle: r.j.projekt.spuren.flatMap((sp, k) => sp.automation.map((l) => ({ befehl: 'auto_punkte', lane_id: l.id, setze: punkte(l.ziel, k) }))) });
  if (r.code !== 200) throw new Error(`ramps ${r.code} ${JSON.stringify(r.j)}`);
  await warte(2500); await geladen();
  await b.oeffne(URL); await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1500);
  for (let i = 0; i < 60 && (await w('window.djkProd.slug')) !== slug; i++) await warte(100);
  await b.klick('[data-p="play"]');
  for (let i = 0; i < 80 && (await w('window.djkProd.arr?.status')) !== 2; i++) await warte(100);
  await warte(800);
  await w(`(() => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); window.__sets = 0;
    Object.defineProperty(HTMLInputElement.prototype, 'value', { configurable: true, get() { return d.get.call(this); }, set(v) { if (this.type === 'range') window.__sets++; d.set.call(this, v); } }); })()`);
  await w('(window.djkProdSpurBild ??= []).length = 0; window.djkProdBild.length = 0');
  const f0 = await w('window.djkProdBild.length');
  await warte(4000);
  const spur = stat(await w('window.djkProdSpurBild')), voll = stat(await w('window.djkProdBild')), sets = await w('window.__sets');
  const heads = await w(`document.querySelectorAll('.p-kopf').length`);
  notiere('F32 32 tracks with 4 lanes each, playing', heads === 32, `heads ${heads}, frames ${voll.n}`);
  notiere('F32a beimBild of track_heads.js', true, `mean ${spur.mean.toFixed(3)} ms, p95 ${spur.p95.toFixed(3)} ms, max ${spur.max.toFixed(2)} ms over ${spur.n} frames`);
  notiere('F32b whole frame (bild)', true, `mean ${voll.mean.toFixed(3)} ms, p95 ${voll.p95.toFixed(3)} ms`);
  notiere('F32c range value setter calls', true, `${sets} calls in ${voll.n} frames = ${(sets / voll.n).toFixed(2)} per frame (64 followed regulators)`);
  await b.klick('[data-p="stopp"]'); await warte(600);
  const fk = b.konsole.filter((k) => k.typ === 'exception' || k.typ === 'error');
  notiere('K console', fk.length === 0, `${fk.length} errors`);
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  try { await api('POST', '/proj/transport', { aktion: 'stopp' }); } catch { /* down */ }
  await b.zu(); await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# probe_rahmen instance ${opt.instanz}\n\n${zeilen.join('\n')}\n`);
process.exit(zeilen.some((z) => z.startsWith('FEHL')) ? 1 : 0);
