// Sample player stage 2, strand S: the routes /sampler/instrument*, /sampler/instrumente and the `instrument` field of /sampler/dateien. Server with the kern
// stand-in (stack of support/media_library.mjs); roots, store and graph folder are temp folders, never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';
import { sinusWav } from './support/sinus_wav.mjs';
import { instrumentRouten } from '../areas/sampler/instrument_routes.ts';

const WERKS_SAMPLES = ['amiga-dreieck', 'amiga-quadrat', 'amiga-rauschen', 'amiga-saege'].map((n) => `bk/samples/${n}.f32`);
const HZ = { C: 261.6256, D: 293.6648, E: 329.6276, G: 391.9954 };

async function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-insr-'));
  const d = { root, loops: path.join(root, 'loops'), module: path.join(root, 'module'), sampler: path.join(root, 'sampler'), bk: path.join(root, 'bk'), lib: path.join(root, 'lib') };
  for (const p of Object.values(d)) if (p !== root) fs.mkdirSync(p);
  fs.writeFileSync(path.join(d.sampler, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: d.lib }]));
  const alt = { bk: process.env.CYPHERDJ_BK_ORDNER, sampler: process.env.CYPHERDJ_SAMPLER };
  process.env.CYPHERDJ_BK_ORDNER = d.bk;
  process.env.CYPHERDJ_SAMPLER = d.sampler;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', alt.bk], ['CYPHERDJ_SAMPLER', alt.sampler]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const n of ['C', 'D', 'E', 'G']) sinusWav(path.join(d.lib, 'Piano', `Pia ${n}3 f.wav`), { hz: HZ[n], sekunden: 0.6, rate: 48000, kanaele: 1 });
  sinusWav(path.join(d.lib, 'Piano', 'Pia G3 p.wav'), { hz: HZ.G, sekunden: 0.5, rate: 48000, kanaele: 1 });
  sinusWav(path.join(d.lib, 'Piano', 'Pia G3 f Alt.wav'), { hz: HZ.G, sekunden: 0.5, rate: 48000, kanaele: 1 });
  sinusWav(path.join(d.lib, 'Piano', 'Pia G3 f Alt2.wav'), { hz: HZ.G, sekunden: 0.5, rate: 48000, kanaele: 1 });
  sinusWav(path.join(d.lib, 'Zwei', 'Pia C3.wav'), { hz: HZ.C, sekunden: 0.5, rate: 48000, kanaele: 1 });
  sinusWav(path.join(d.lib, 'Zwei', 'Pia E3.wav'), { hz: HZ.E, sekunden: 0.5, rate: 48000, kanaele: 1 });
  const s = await stapel(t, { loops: d.loops });
  s.optionen.modulOrdner = d.module;
  s.optionen.samplerOrdner = d.sampler;
  const oeffne = async (name = 'Mod', tempo) => {
    const r = await ruf(s.url, 'POST', '/proj/neu', { name, werkbank: true });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    if (tempo !== undefined) assert.equal((await ruf(s.url, 'POST', '/proj/aendern', { rev: r.j.projekt.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: tempo }] })).code, 200);
  };
  const projekt = async () => (await ruf(s.url, 'GET', '/proj/aktuell')).j.projekt;
  const verlauf = async () => (await ruf(s.url, 'GET', '/proj/verlauf')).j;
  const spuren = async () => (await projekt()).spuren;
  const alleDateien = () => { const aus = []; const geh = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) e.isDirectory() ? geh(path.join(p, e.name)) : aus.push(path.relative(root, path.join(p, e.name))); }; geh(d.bk); geh(d.sampler); return aus.filter((x) => !x.endsWith('wurzeln.json') && !WERKS_SAMPLES.includes(x)).sort(); };   // the server installs the four factory samples at start (sichereWerksProben); they are not part of what a route leaves behind
  return { ...s, d, oeffne, projekt, verlauf, spuren, alleDateien };
}

test('the routes of the instrument part', () => {
  const r = instrumentRouten({ log() {}, quelle: () => 'andreas', kiGestoppt: () => false }, { sitzung: {}, zugang: {}, loops: '', module: '' });
  assert.deepEqual(r.map((x) => `${x.methode} ${x.pfad}`), ['POST /sampler/instrument', 'GET /sampler/instrument/lauf', 'GET /sampler/instrumente', 'POST /sampler/instrument/spur', 'POST /sampler/instrument/loeschen']);
  assert.deepEqual(r.map((x) => x.schutz), ['fremdePost', 'offen', 'offen', 'fremdePost', 'fremdePost']);
});

test('GET /sampler/dateien: the instrument field of a folder that reads as an instrument', async (t) => {
  const z = await aufbau(t);
  let r = await ruf(z.url, 'GET', '/sampler/dateien?wurzel=Lib&ordner=Piano');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.instrument, { noten: 4, lagen: 2, takes: 1, dateien: 5, varianten: ['Alt', 'Alt2'] });
  r = await ruf(z.url, 'GET', '/sampler/dateien?wurzel=Lib&ordner=Zwei');
  assert.equal('instrument' in r.j, false);
  r = await ruf(z.url, 'GET', '/sampler/dateien?wurzel=Lib');
  assert.equal('instrument' in r.j, false);
  r = await ruf(z.url, 'GET', '/sampler/dateien?wurzel=Lib&suche=pia');
  assert.equal('instrument' in r.j, false);
});

test('POST /sampler/instrument without a track, the list and the progress', async (t) => {
  const z = await aufbau(t);
  assert.deepEqual((await ruf(z.url, 'GET', '/sampler/instrumente')).j, { instrumente: [] });
  assert.deepEqual((await ruf(z.url, 'GET', '/sampler/instrument/lauf')).j, { laeuft: false, name: '', fertig: 0, von: 0 });
  const r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', name: 'Test Piano' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const i = r.j.instrument;
  assert.deepEqual(Object.keys(i).sort(), ['bytes', 'erstellt', 'graph', 'id', 'name', 'noten', 'varianten', 'zonen']);
  assert.deepEqual([i.name, i.noten, i.zonen, i.graph, i.varianten], ['Test Piano', 4, 5, `ins-${i.id}`, ['Alt', 'Alt2']]);
  assert.ok(i.bytes > 5 * 0.4 * 48000 * 8 && i.bytes < 5 * 0.7 * 48000 * 8);
  assert.equal(typeof r.j.text, 'string');
  assert.equal('spur_id' in r.j, false);
  const l = await ruf(z.url, 'GET', '/sampler/instrumente');
  assert.deepEqual(l.j.instrumente, [{ id: i.id, name: 'Test Piano', noten: 4, zonen: 5, bytes: i.bytes, erstellt: i.erstellt }]);
  assert.deepEqual(z.alleDateien(), [`bk/ins-${i.id}.json`, `bk/panels/ins-${i.id}.json`, `bk/samples/ins-${i.id}.f32`, `sampler/instrumente/${i.id}/instrument.json`]);
  const g = JSON.parse(fs.readFileSync(path.join(z.d.bk, `ins-${i.id}.json`), 'utf8'));
  assert.equal(g.knoten.find((n) => n.id === 'smp').zonen.length, 60);
});

test('POST /sampler/instrument: refusals leave nothing behind', async (t) => {
  const z = await aufbau(t);
  let r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Zwei' });
  assert.deepEqual([r.code, r.j.fehler], [422, 'kein_instrument']);
  r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Nix', ordner: '' });
  assert.deepEqual([r.code, r.j.fehler], [404, 'quelle_unbekannt']);
  r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: '../x' });
  assert.deepEqual([r.code, r.j.fehler], [404, 'quelle_unbekannt']);
  r = await ruf(z.url, 'POST', '/sampler/instrument', { ordner: 'Piano' });
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig']);
  r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', spur: 'ja' });
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig']);
  r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', name: '' });
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig']);
  r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', andere: 1 });
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_unbekannt']);
  // with `spur` and no open project: refused before anything is made
  r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', spur: true });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_projekt']);
  assert.deepEqual(z.alleDateien(), []);
});

test('POST /sampler/instrument with spur: one history step, one note at the middle of the range', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 120);
  const v0 = (await z.verlauf()).length;
  const r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', name: 'Piano Spur', spur: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const p = await z.projekt();
  const spur = p.spuren.find((x) => x.id === r.j.spur_id);
  assert.ok(spur, 'the track exists');
  assert.equal(spur.name, 'Piano Spur');
  assert.equal(spur.geraet.graph, r.j.instrument.graph);
  assert.deepEqual([r.j.rev, r.j.projekt.rev], [p.rev, p.rev]);
  assert.deepEqual(spur.clips[0].noten.map((n) => [n.beat, n.laenge, n.ton, n.vel]), [[0, 2, 64, 100]]);   // keys 48..79 under C3 = 60, the middle 63.5 rounds up
  const v = await z.verlauf();
  assert.equal(v.length, v0 + 1, 'one history step');
  assert.equal(v[v.length - 1].label, 'Instrument Piano Spur');
});

test('a refusal of the project removes the instrument again (workbench full)', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 120);
  const ids = [];
  for (let k = 0; k < 40; k++) {
    const r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', name: `P${k}`, spur: true });
    if (r.code !== 200) { assert.equal(r.j.fehler, 'werkbank_voll', JSON.stringify(r.j)); break; }
    ids.push(r.j.instrument.id);
  }
  const l = (await ruf(z.url, 'GET', '/sampler/instrumente')).j.instrumente;
  assert.equal(l.length, ids.length, 'the refused build left no instrument');
  assert.ok(ids.length >= 1 && ids.length < 40);
  assert.equal(z.alleDateien().length, ids.length * 4);
});

test('POST /sampler/instrument/spur: a stored instrument on a new track, repeatedly', async (t) => {
  const z = await aufbau(t);
  const b = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', name: 'Stored' });
  let r = await ruf(z.url, 'POST', '/sampler/instrument/spur', { id: b.j.instrument.id });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_projekt']);
  await z.oeffne('Mod', 120);
  const v0 = (await z.verlauf()).length;
  r = await ruf(z.url, 'POST', '/sampler/instrument/spur', { id: b.j.instrument.id });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const r2 = await ruf(z.url, 'POST', '/sampler/instrument/spur', { id: b.j.instrument.id });
  assert.equal(r2.code, 200);
  const sp = await z.spuren();
  assert.deepEqual(sp.filter((x) => x.geraet?.graph === `ins-${b.j.instrument.id}`).map((x) => x.name), ['Stored', 'Stored 2']);
  assert.equal(r.j.instrument.id, b.j.instrument.id);
  assert.equal((await z.verlauf()).length, v0 + 2);
  for (const k of [{ id: 'nix' }, { id: '../x' }]) { const e = await ruf(z.url, 'POST', '/sampler/instrument/spur', k); assert.deepEqual([e.code, e.j.fehler], [404, 'instrument_unbekannt']); }
  const e = await ruf(z.url, 'POST', '/sampler/instrument/spur', {});
  assert.deepEqual([e.code, e.j.fehler], [400, 'argument_ungueltig']);
});

test('POST /sampler/instrument/loeschen: refused while played, else everything goes', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Alpha', 120);
  const a = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', name: 'In Use', spur: true });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const frei = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', name: 'Free' });
  const vorher = z.alleDateien();
  let d = await ruf(z.url, 'POST', '/sampler/instrument/loeschen', { id: a.j.instrument.id });
  assert.deepEqual([d.code, d.j.fehler], [409, 'instrument_in_gebrauch'], JSON.stringify(d.j));
  assert.deepEqual(d.j.spuren, ['In Use']);
  assert.ok(d.j.text.includes('In Use'), d.j.text);
  assert.deepEqual(z.alleDateien(), vorher, 'nothing removed');
  // a stored project plays it
  await z.oeffne('Beta', 120);
  d = await ruf(z.url, 'POST', '/sampler/instrument/loeschen', { id: a.j.instrument.id });
  assert.deepEqual([d.code, d.j.fehler], [409, 'instrument_in_gebrauch']);
  assert.ok(d.j.text.includes('Alpha'), d.j.text);
  // a module of the store plays the free one
  const mid = 'abcdabcdabcdabcd';
  fs.mkdirSync(path.join(z.d.module, mid), { recursive: true });
  const spur = { id: 's1', nr: 1, name: 'Played', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: frei.j.instrument.graph, parameter: {} }, clips: [] };
  fs.writeFileSync(path.join(z.d.module, mid, 'modul.json'), JSON.stringify({ format: 1, id: mid, gespeichert: '2026-11-16T10:00:00Z', herkunft: { titel: 'Mod One' }, gruppen: [{ id: 'g1', name: 'Mod One' }], spuren: [spur], audio: [] }));
  d = await ruf(z.url, 'POST', '/sampler/instrument/loeschen', { id: frei.j.instrument.id });
  assert.deepEqual([d.code, d.j.fehler], [409, 'instrument_in_gebrauch']);
  assert.ok(d.j.text.includes('Mod One'), d.j.text);
  fs.rmSync(path.join(z.d.module, mid), { recursive: true });
  // free now
  d = await ruf(z.url, 'POST', '/sampler/instrument/loeschen', { id: frei.j.instrument.id });
  assert.deepEqual([d.code, d.j], [200, { ok: true }]);
  assert.deepEqual((await ruf(z.url, 'GET', '/sampler/instrumente')).j.instrumente.map((x) => x.name), ['In Use']);
  assert.equal(z.alleDateien().length, 4);
  d = await ruf(z.url, 'POST', '/sampler/instrument/loeschen', { id: frei.j.instrument.id });
  assert.deepEqual([d.code, d.j.fehler], [404, 'instrument_unbekannt']);
  d = await ruf(z.url, 'POST', '/sampler/instrument/loeschen', { id: a.j.instrument.id, x: 1 });
  assert.equal(d.code, 400);
});

test('a second build at the same time answers laeuft_schon and the progress names the build', async (t) => {
  const z = await aufbau(t);
  const erste = ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', name: 'Langsam' });
  let lauf = null, zweite = null;
  for (let k = 0; k < 400 && zweite === null; k++) {
    const l = await ruf(z.url, 'GET', '/sampler/instrument/lauf');
    if (l.j.laeuft) { lauf = l.j; zweite = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Piano', name: 'Zweite' }); }
  }
  const fertig = await erste;
  assert.equal(fertig.code, 200, JSON.stringify(fertig.j));
  assert.ok(lauf && lauf.name === 'Langsam' && lauf.von >= 0 && lauf.fertig <= 5, JSON.stringify(lauf));
  assert.deepEqual([zweite.code, zweite.j.fehler], [409, 'laeuft_schon']);
  assert.deepEqual((await ruf(z.url, 'GET', '/sampler/instrument/lauf')).j, { laeuft: false, name: '', fertig: 0, von: 0 });
  assert.equal((await ruf(z.url, 'GET', '/sampler/instrumente')).j.instrumente.length, 1);
});
