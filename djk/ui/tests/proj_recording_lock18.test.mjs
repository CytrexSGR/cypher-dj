// 1.8 T9 (AK26, AK2 case 4): during a recording the routes that touch the playback or the project refuse with 409; the mixer and other tracks stay operable.
// Real server with the core mock (rec.mjs), one table row per route.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { projBereich } from '../areas/proj/area.ts';
import { aufnahmeBereich } from '../areas/proj/recording.ts';
import { pruefKontext, warteBis } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';
import { ruf, anKern, warte } from './support/proj_stack.mjs';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-recsp18-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const aktuell = async (url) => (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
const g = async (url, pfad, b) => { const r = await ruf(url, 'POST', pfad, b); return [r.code, r.j?.fehler]; };

// Project with an audio track "Gitarre" armed on erz/1, an instrument track with one note (host device), a second audio track that is not armed.
async function aufbau(url) {
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Sperre18' })).code, 200);
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Aufbau', befehle: [{ befehl: 'tempo_setzen', bpm },
    { befehl: 'spur_neu', art: 'audio', name: 'Gitarre' }, { befehl: 'spur_neu', art: 'audio', name: 'Andere' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: { art: 'wirt' } }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const p = await aktuell(url);
  const [gitarre, andere, lead] = p.spuren;
  const b = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Arm', befehle: [
    { befehl: 'spur_aendern', spur_id: gitarre.id, eingang: { art: 'intern', name: 'erz/1' }, arm: true },
    { befehl: 'clip_neu', spur_id: lead.id, art: 'midi', start_beat: 0, laenge_beats: 1, noten: [{ beat: 0, laenge: 0.5, ton: 60, vel: 90 }] }] });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  return { gitarre: gitarre.id, andere: andere.id, lead: lead.id };
}

test('AK26: during a recording every route that touches the playback or the project is refused with 409, mixer and other tracks stay operable', async (t) => {
  const d = tmp(t);
  const { url, log } = await stapel(t, { proj: { arbeitsordner: path.join(d, 'arr') } });
  const s = await aufbau(url);
  const st = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  assert.equal(st.code, 200, JSON.stringify(st.j));
  const slug = (await ruf(url, 'GET', '/proj/liste')).j[0].slug;
  const p = await aktuell(url);
  const n0 = log.length;
  const tabelle = [
    ['tempo_setzen', () => g(url, '/proj/aendern', { rev: p.rev, label: 'T', befehle: [{ befehl: 'tempo_setzen', bpm: p.tempo_bpm }] }), [409, 'beschaeftigt']],
    ['open', () => g(url, '/proj/oeffnen', { slug }), [409, 'beschaeftigt']],
    ['new', () => g(url, '/proj/neu', { name: 'Zwei' }), [409, 'beschaeftigt']],
    ['freeze', () => g(url, '/proj/freeze', { spur_id: s.lead, an: true }), [409, 'beschaeftigt']],
    ['export', () => g(url, '/proj/export', { von_beat: 0, bis_beat: 4 }), [409, 'beschaeftigt']],
    ['loudness', () => g(url, '/proj/lautheit', { von_beat: 0, bis_beat: 4 }), [409, 'beschaeftigt']],
  ];
  const ist = [];
  for (const [name, f] of tabelle) ist.push([name, ...(await f())]);
  assert.deepEqual(ist, tabelle.map(([name, , soll]) => [name, ...soll]));
  assert.equal(anKern(log, '/k/arr/laden').length, anKern(log.slice(0, n0), '/k/arr/laden').length, 'a refused route sends no load to the core');
  assert.equal((await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: s.gitarre, fader_db: -3 }] })).code, 200, 'mixer');
  const q = await aktuell(url);
  assert.equal((await ruf(url, 'POST', '/proj/aendern', { rev: q.rev, label: 'Mute', befehle: [{ befehl: 'spur_aendern', spur_id: s.andere, mute: true }] })).code, 200, 'other track');
  // AK2, fourth case: input of the recording track refused before any message, monitor passes, the same input again passes
  const n1 = anKern(log, '/k/rec/spur').length;
  const eingang = async (e) => ruf(url, 'POST', '/proj/aendern', { rev: (await aktuell(url)).rev, label: 'Eingang', befehle: [{ befehl: 'spur_aendern', spur_id: s.gitarre, ...e }] });
  const r1 = await eingang({ eingang: { art: 'intern', name: 'erz/2' } });
  assert.deepEqual([r1.code, r1.j.fehler], [409, 'aufnahme_laeuft'], JSON.stringify(r1.j));
  assert.match(r1.j.text, /Gitarre is recording/);
  assert.equal(anKern(log, '/k/rec/spur').length, n1, 'nothing went to the core');
  assert.deepEqual((await aktuell(url)).spuren[0].aufnahme.eingang, { art: 'intern', name: 'erz/1' }, 'the project keeps the old input');
  assert.equal((await eingang({ monitor: 'ein' })).code, 200, 'monitor passes (D12)');
  assert.equal((await eingang({ eingang: { art: 'intern', name: 'erz/1' } })).code, 200, 'the same input again is no change');
  assert.equal((await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'stopp' })).code, 200);
  const nach = await aktuell(url);
  assert.equal((await ruf(url, 'POST', '/proj/aendern', { rev: nach.rev, label: 'Eingang', befehle: [{ befehl: 'spur_aendern', spur_id: s.gitarre, eingang: { art: 'intern', name: 'erz/2' } }] })).code, 200, 'after the run it goes again');
});

// The lock is held from before the start until the take is placed (start window: no run set yet): the input and the mode (part of the input) of an armed track cannot change.
test('AK2 fourth case: start window under the recording lock (no run set yet): input and mode of the armed track are refused, monitor passes', async (t) => {
  const k = pruefKontext();
  const d = tmpOrdner(t, 'djk-recsp18b-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const s = b.sitzung;
  await s.neu('Fenster', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 120 });
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'X' }] }, 'andreas');
  const spur = s.aktuell().j.projekt.spuren[0];
  const aendere = (befehl) => s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'x', befehle: [{ befehl: 'spur_aendern', spur_id: spur.id, ...befehl }] }, 'andreas');
  await aendere({ eingang: { art: 'extern', paar: 1, modus: 'stereo' }, arm: true });
  const frei = b.zugang.sperreLaden('aufnahme');
  const fehl = async (p) => { try { await p; return null; } catch (x) { return [x.code, x.fehler]; } };
  assert.deepEqual(await fehl(aendere({ eingang: { art: 'extern', paar: 1, modus: 'links' } })), [409, 'aufnahme_laeuft'], 'mode');
  assert.deepEqual(await fehl(aendere({ eingang: { art: 'extern', paar: 2, modus: 'stereo' } })), [409, 'aufnahme_laeuft'], 'input');
  assert.equal(await fehl(aendere({ monitor: 'ein' })), null, 'monitor passes');
  frei();
  assert.equal(await fehl(aendere({ eingang: { art: 'extern', paar: 1, modus: 'links' } })), null, 'after the lock it goes again');
});

// --- AK28: space (D19) ---------------------------------------------------------------------------------------------------------------------------------------
// statfs is injected: `frei(ordner)` gives the free bytes of a folder, the test decides per folder.
async function platzBereit(t, frei, opt = {}) {
  const k = pruefKontext();
  const roh = k.warteQuittung.bind(k);
  k.warteQuittung = async (id, ...rest) => (k.gesendet.find((x) => x.id === id)?.adresse === '/k/rec/start' ? { status: 2, grund: '' } : roh(id, ...rest));
  const d = tmpOrdner(t, 'djk-recplatz-');
  const arr = path.join(d, 'arr');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: arr, arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const aufgerufen = [];
  const statfs = (ordner) => { aufgerufen.push(ordner); return { bsize: 4096, bavail: Math.floor(frei(ordner) / 4096) }; };
  const br = aufnahmeBereich(k, b.zugang, { fristMs: 60, statfs, ...opt });
  t.after(() => br.aufnahme.schliesse());
  const s = b.sitzung;
  await s.neu('Platz', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 120 });
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'G' }] }, 'andreas');
  const pr = s.aktuell().j.projekt;
  await s.aendern({ rev: pr.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: pr.spuren[0].id, eingang: { art: 'intern', name: 'erz/1' }, arm: true }] }, 'andreas');
  k.leere();
  aufgerufen.length = 0;
  return { k, b, s, a: br.aufnahme, arr, projekt: b.zugang.offen().ordner, aufgerufen, nr: pr.spuren[0].nr,
    kern: (adr, f) => { b.ereignis(adr, f); br.aufnahme.ereignis(adr, f); } };
}
const GIB = 2 ** 30;
const start = async (e, quelle = 'andreas') => { try { const r = await e.a.start({ von_beat: 0 }, quelle); return { code: r.code, j: r.j }; } catch (x) { return { code: x.code, fehler: x.fehler, text: x.extra?.text }; } };

test('AK28: less than the minimum free on the work folder or on the project folder: 409 kein_platz, nothing goes to the core, no lock; enough on both starts', async (t) => {
  const knapp = { arbeit: false, projekt: false };
  let arr = '';
  const e = await platzBereit(t, (ordner) => ((ordner.startsWith(arr) ? knapp.arbeit : knapp.projekt) ? GIB - 4096 : GIB + 4096));
  arr = e.arr;
  for (const [name, schalter] of [['work folder', 'arbeit'], ['project folder', 'projekt']]) {
    knapp[schalter] = true;
    const r = await start(e);
    assert.deepEqual([r.code, r.fehler], [409, 'kein_platz'], name);
    assert.match(r.text, /MiB free on .*recording needs at least 1024 MiB/, name);
    assert.deepEqual(e.k.gesendet.map((m) => m.adresse), [], `${name}: no message to the core`);
    assert.equal(e.b.sitzung.ladenGesperrt(), false, `${name}: no lock left behind`);
    knapp[schalter] = false;
  }
  assert.ok(e.aufgerufen.some((o) => o.startsWith(e.arr)) && e.aufgerufen.some((o) => o.startsWith(e.projekt)), 'both folders were asked');
  const ok = await start(e);                       // negative control: exactly the minimum (1 GiB) on both is enough
  assert.equal(ok.code, 200, JSON.stringify(ok));
  assert.equal(e.k.an('/k/rec/start').length, 1);
});

test('AK28: the minimum is an option (minFreiBytes); an unreadable volume does not block; a folder that does not exist yet is asked by its parent', async (t) => {
  const e = await platzBereit(t, () => 5 * 2 ** 20, { minFreiBytes: 4 * 2 ** 20 });
  assert.equal((await start(e)).code, 200, '5 MiB free, 4 MiB asked');
  const f = await platzBereit(t, () => 3 * 2 ** 20, { minFreiBytes: 4 * 2 ** 20 });
  assert.deepEqual((await start(f)).fehler, 'kein_platz');
  const g = await platzBereit(t, () => 0, { statfs: () => { throw new Error('ENOSYS'); } });
  assert.equal((await start(g)).code, 200, 'statfs fails: the recording is not blocked');
  assert.equal(e.aufgerufen.every((o) => fs.existsSync(o)), true, 'only existing folders are asked (the work folder is made later)');
});

test('AK28: disk full during the take (status 3): the take is placed with what was saved, its name carries (disk full)', async (t) => {
  const e = await platzBereit(t, () => 2 * GIB);
  const r = await start(e);
  assert.equal(r.code, 200, JSON.stringify(r));
  const kennung = r.j.kennung;
  fs.mkdirSync(e.arr, { recursive: true });
  fs.writeFileSync(path.join(e.arr, `aufnahme-${e.nr}-${kennung}.f32`), Buffer.alloc(4800 * 8, 1));
  e.kern('/e/aufnahme', { spur: e.nr, kennung, status: 3, frames: 4800, start_sample: 0n, luecken: 0 });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 1500), 'the run is over');
  const x = e.a.lage().j.letzte.takes[0];
  assert.deepEqual([x.fehler, x.frames, x.status], [undefined, 4800, 3], JSON.stringify(x));
  assert.deepEqual(e.s.aktuell().j.projekt.spuren[0].clips.map((c) => c.name), [`Take ${kennung} (disk full)`]);
  assert.ok(fs.existsSync(x.datei), 'the WAV of what was saved stays');
});
