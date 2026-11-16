// Sampler C task 4: the routes /sampler/ton*, TO TONE as one history step, the ROOT reload, deleting a tone and the cut-delete hook. Server with the kern
// stand-in (stack of support/media_library.mjs); the cut store, the graph folder, the loop library and the module store are temp folders, never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { bis, ruf, CYPHER } from './support/proj_stack.mjs';
import { tonRouten } from '../areas/sampler/tone_routes.ts';
import { noteHz } from '../sampler/tone.ts';

// a loop of `beats` beats, frame i = (i, -i)
function schreibeLoop(loops, name, beats) {
  const frames = beats * 22500, f = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { f[2 * i] = i; f[2 * i + 1] = -i; }
  fs.mkdirSync(path.join(loops, name));
  fs.writeFileSync(path.join(loops, name, 'loop.f32'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(loops, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}

async function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-c4-'));
  const d = { root, loops: path.join(root, 'loops'), module: path.join(root, 'module'), sampler: path.join(root, 'sampler'), bk: path.join(root, 'bk') };
  for (const p of Object.values(d)) if (p !== root) fs.mkdirSync(p);
  const alt = { bk: process.env.CYPHERDJ_BK_ORDNER, sampler: process.env.CYPHERDJ_SAMPLER };
  process.env.CYPHERDJ_BK_ORDNER = d.bk;
  process.env.CYPHERDJ_SAMPLER = d.sampler;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', alt.bk], ['CYPHERDJ_SAMPLER', alt.sampler]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  schreibeLoop(d.loops, 'l4', 4);
  const s = await stapel(t, { loops: d.loops });
  s.optionen.modulOrdner = d.module;      // read at each request
  s.optionen.samplerOrdner = d.sampler;
  const bkTon = () => fs.readdirSync(d.bk).filter((n) => n.startsWith('ton-')).concat(fs.existsSync(path.join(d.bk, 'panels')) ? fs.readdirSync(path.join(d.bk, 'panels')).filter((n) => n.startsWith('ton-')) : []);
  const oeffne = async (name = 'Mod', tempo) => {
    const r = await ruf(s.url, 'POST', '/proj/neu', { name, werkbank: true });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    if (tempo !== undefined) {
      const a = await ruf(s.url, 'POST', '/proj/aendern', { rev: r.j.projekt.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: tempo }] });
      assert.equal(a.code, 200, JSON.stringify(a.j));
    }
  };
  const schnitt = async () => (await ruf(s.url, 'POST', '/sampler/schnitt', { quelle: { art: 'loop', ref: 'l4' } })).j.schnitt;
  const projekt = async () => (await ruf(s.url, 'GET', '/proj/aktuell')).j.projekt;
  return { ...s, d, bkTon, oeffne, schnitt, projekt };
}
const noten = (spur) => spur.clips[0].noten.map((n) => ({ beat: n.beat, laenge: n.laenge, ton: n.ton, vel: n.vel }));
const graphText = (z, graph) => fs.readFileSync(path.join(z.d.bk, `${graph}.json`), 'utf8');
const bkGeraet = (graph) => ({ art: 'intern', name: 'bk', graph, parameter: {} });

test('the routes of the tone part', () => {
  const r = tonRouten({ log() {}, quelle: () => 'andreas', kiGestoppt: () => false }, { sitzung: {}, zugang: {}, loops: '', module: '' });
  assert.deepEqual(r.map((x) => `${x.methode} ${x.pfad}`), ['POST /sampler/ton', 'GET /sampler/ton', 'POST /sampler/ton/grund', 'POST /sampler/ton/loeschen']);
  assert.deepEqual(r.map((x) => x.schutz), ['fremdePost', 'offen', 'fremdePost', 'fremdePost']);
});

test('TO TONE writes one step: a NOTE track with one note at the root', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 128);
  const s = await z.schnitt();
  const r = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 2, bis: 3, spur: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const p = await z.projekt();
  const spur = p.spuren.find((x) => x.id === r.j.spur_id);
  assert.ok(spur, 'the track exists');
  assert.equal(spur.geraet.graph, r.j.ton.graph);
  assert.deepEqual([spur.geraet.art, spur.geraet.name], ['intern', 'bk']);
  assert.deepEqual(noten(spur), [{ beat: 0, laenge: 0.5, ton: r.j.ton.grund, vel: 100 }]);   // 11 250 frames at 128 BPM = 0.5 beat
  assert.equal(spur.name, r.j.ton.name);
  assert.deepEqual([r.j.rev, r.j.projekt.rev], [p.rev, p.rev]);
  assert.ok(r.j.text.startsWith(`tone ${r.j.ton.graph} `), r.j.text);
  assert.deepEqual([r.j.ton.scheiben, r.j.ton.a, r.j.ton.b], [[2, 3], 11250, 22500]);
  const v = (await ruf(z.url, 'GET', '/proj/verlauf')).j;
  assert.equal(v[v.length - 1].label, `Tone ${r.j.ton.name}`);
  assert.equal(v.filter((e) => e.label.startsWith('Tone ')).length, 1, 'one history step');
  const g = await ruf(z.url, 'GET', `/seq/geraet?spur_id=${spur.id}`);
  assert.equal(g.code, 200, JSON.stringify(g.j));
  assert.deepEqual([g.j.klaenge, g.j.schnitt], [[], undefined], 'the NOTE grid: no named sounds, no cut strip');
  // a second tone of the same slices: the track name is taken, " 2"; a long region is clamped to 4 beats, a very short one to 0.25
  const r2 = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 2, bis: 3, spur: true, name: r.j.ton.name });
  assert.equal(r2.code, 200, JSON.stringify(r2.j));
  assert.equal((await z.projekt()).spuren.find((x) => x.id === r2.j.spur_id).name, `${r.j.ton.name} 2`);
  const r3 = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 0, bis: 15, spur: true });
  assert.equal(noten((await z.projekt()).spuren.find((x) => x.id === r3.j.spur_id))[0].laenge, 4);
  await z.oeffne('Fast', 60);                                              // 5 625 frames at 60 BPM = 0.117 beat
  const r4 = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 1, spur: true });
  assert.equal(noten((await z.projekt()).spuren.find((x) => x.id === r4.j.spur_id))[0].laenge, 0.25);
});

test('TO TONE without a track: the tone only, nothing in the project; the root by hand', async (t) => {
  const z = await aufbau(t);
  const s = await z.schnitt();
  const r = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 4, grund: 57 });          // no project is open: a tone alone needs none
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.ton.grund, r.j.ton.grund_quelle, r.j.spur_id, r.j.rev], [57, 'hand', undefined, undefined]);
  assert.ok(r.j.text.includes('root A2 (note 57, set by hand)'), r.j.text);
  const g = await ruf(z.url, 'GET', `/sampler/ton?graph=${r.j.ton.graph}`);
  assert.deepEqual([g.code, g.j.ton.graph, g.j.text], [200, r.j.ton.graph, r.j.text]);
  const u = await ruf(z.url, 'GET', '/sampler/ton?graph=ton-nix-1');
  assert.deepEqual([u.code, u.j.fehler], [404, 'ton_unbekannt']);
  assert.equal((await ruf(z.url, 'GET', '/sampler/ton')).code, 400);
});

test('TO TONE refusals create nothing', async (t) => {
  const z = await aufbau(t);
  const s = await z.schnitt();
  const gleich = async (f) => {
    const vorher = [z.bkTon(), fs.readdirSync(path.join(z.d.sampler, s.id))];
    const r = await f();
    assert.deepEqual([z.bkTon(), fs.readdirSync(path.join(z.d.sampler, s.id))], vorher, 'no tone file left');
    return r;
  };
  const tonSpur = (extra = {}) => ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 1, spur: true, ...extra });
  let r = await gleich(() => tonSpur());
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_projekt']);
  await ruf(z.url, 'POST', '/proj/neu', { name: 'Plain' });
  r = await gleich(() => tonSpur());
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_werkbank']);
  await z.oeffne('Full');
  const befehle = Array.from({ length: 8 }, (_, i) => ({ befehl: 'werkbank_spur_neu', name: `T${i}`, geraet: bkGeraet('drums-909') }));
  fs.copyFileSync(path.resolve(import.meta.dirname, '../../instruments/modular_dsp/demos/drums-909.json'), path.join(z.d.bk, 'drums-909.json'));
  const f = await ruf(z.url, 'POST', '/proj/aendern', { rev: (await z.projekt()).rev, label: 'Fill', befehle });
  assert.equal(f.code, 200, JSON.stringify(f.j));
  const projektVor = JSON.stringify(await z.projekt());
  r = await gleich(() => tonSpur());
  assert.deepEqual([r.code, r.j.fehler], [409, 'werkbank_voll']);
  assert.equal(JSON.stringify(await z.projekt()), projektVor, 'the project is unchanged');
  await z.oeffne('Fresh');
  for (const [koerper, code, fehler] of [
    [{ von: 16 }, 400, 'argument_ungueltig'], [{ von: -1 }, 400, 'argument_ungueltig'], [{ von: 1.5 }, 400, 'argument_ungueltig'],
    [{ von: 3, bis: 2 }, 400, 'argument_ungueltig'], [{ grund: 96 }, 400, 'argument_ungueltig'], [{ grund: 15 }, 400, 'argument_ungueltig'],
    [{ name: '' }, 400, 'argument_ungueltig'], [{ spur: 'yes' }, 400, 'argument_ungueltig'], [{ nix: 1 }, 400, 'argument_unbekannt'],
  ]) {
    r = await gleich(() => tonSpur(koerper));
    assert.deepEqual([r.code, r.j.fehler], [code, fehler], JSON.stringify(koerper));
    assert.ok(typeof r.j.text === 'string' && r.j.text.length > 5, 'an English text');
  }
  r = await gleich(() => ruf(z.url, 'POST', '/sampler/ton', { id: 'nix-0000', von: 0, spur: true }));
  assert.deepEqual([r.code, r.j.fehler], [404, 'schnitt_unbekannt']);
  r = await gleich(() => ruf(z.url, 'POST', '/sampler/ton', { von: 0 }));
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig']);
});

test('a project write that is refused removes the tone this call made', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 128);
  const s = await z.schnitt();
  const sitz = z.o.proj.sitzung, echt = sitz.aendern.bind(sitz);
  sitz.aendern = async () => { sitz.aendern = echt; return { code: 409, j: { fehler: 'rev_veraltet', text: 'the project changed meanwhile' } }; };
  const r = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 1, spur: true });
  assert.deepEqual([r.code, r.j.fehler], [409, 'rev_veraltet']);
  assert.deepEqual(z.bkTon(), [], 'graph and panel are gone');
  assert.deepEqual(fs.readdirSync(path.join(z.d.sampler, s.id)).filter((n) => n.startsWith('ton-')), [], 'the tone file is gone');
  sitz.aendern = async () => { sitz.aendern = echt; throw Object.assign(new Error('x'), { code: 409, fehler: 'verlauf_inkonsistent', extra: {} }); };
  const r2 = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 1, spur: true });
  assert.notEqual(r2.code, 200);
  assert.deepEqual(z.bkTon(), []);
  // the tone of an earlier call is not touched by a later refusal
  const ok = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 2 });
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  sitz.aendern = async () => { sitz.aendern = echt; return { code: 409, j: { fehler: 'rev_veraltet' } }; };
  const r3 = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 1, spur: true });
  assert.equal(r3.code, 409);
  assert.deepEqual(z.bkTon().sort(), [`${ok.j.ton.graph}.json`, `${ok.j.ton.graph}.json`], 'only the tone of the first call is left (graph and panel)');
});

test('a ROOT change reloads the playback only when a track plays the tone (review focus 3)', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 128);
  const s = await z.schnitt();
  const sitz = z.o.proj.sitzung;
  let zahl = 0;
  sitz.ladeLiveNeuFrei = async () => { zahl++; return true; };
  const a = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 2, bis: 3, spur: true });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const graph = a.j.ton.graph;
  const vorher = graphText(z, graph);
  const rev = (await z.projekt()).rev;
  const notenVor = JSON.stringify(noten((await z.projekt()).spuren.find((x) => x.id === a.j.spur_id)));
  const g = await ruf(z.url, 'POST', '/sampler/ton/grund', { graph, grund: 64 });
  assert.equal(g.code, 200, JSON.stringify(g.j));
  assert.deepEqual([g.j.neu_geladen, zahl, g.j.ton.grund, g.j.ton.grund_quelle], [true, 1, 64, 'hand']);
  assert.ok(g.j.text.includes('root E3 (note 64, set by hand)'), g.j.text);
  assert.notEqual(graphText(z, graph), vorher, 'the graph text changed');
  assert.ok(Math.abs(JSON.parse(graphText(z, graph)).knoten.find((k) => k.id === 'smp').grund - noteHz(64)) < 1e-9);
  assert.equal((await z.projekt()).rev, rev, 'no history step');
  assert.equal(JSON.stringify(noten((await z.projekt()).spuren.find((x) => x.id === a.j.spur_id))), notenVor, 'the notes of the track are untouched');
  // a tone no track plays: written, not reloaded
  const b = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 5 });
  const g2 = await ruf(z.url, 'POST', '/sampler/ton/grund', { graph: b.j.ton.graph, grund: 50 });
  assert.deepEqual([g2.code, g2.j.neu_geladen, zahl, g2.j.ton.grund], [200, false, 1, 50]);
  // a reload that fails: the root is changed, the answer says so
  sitz.ladeLiveNeuFrei = async () => { throw new Error('the core said no'); };
  const g3 = await ruf(z.url, 'POST', '/sampler/ton/grund', { graph, grund: 65 });
  assert.deepEqual([g3.code, g3.j.neu_geladen, g3.j.ton.grund], [200, false, 65]);
  assert.ok(typeof g3.j.neu_laden_fehler === 'string' && g3.j.neu_laden_fehler.length > 5);
  // a load that the lock of a freeze defers: the answer says so, and the real session loads at the release
  sitz.ladeLiveNeuFrei = async () => false;
  const g4 = await ruf(z.url, 'POST', '/sampler/ton/grund', { graph, grund: 66 });
  assert.deepEqual([g4.code, g4.j.neu_geladen, g4.j.neu_laden_aufgeschoben, g4.j.neu_laden_fehler], [200, false, true, undefined]);
  // refusals write nothing
  const text = graphText(z, graph);
  for (const [koerper, code, fehler] of [[{ graph, grund: 96 }, 400, 'argument_ungueltig'], [{ graph, grund: 60.5 }, 400, 'argument_ungueltig'], [{ graph: 'ton-nix-1', grund: 60 }, 404, 'ton_unbekannt'],
    [{ grund: 60 }, 400, 'argument_ungueltig'], [{ graph, grund: 60, x: 1 }, 400, 'argument_unbekannt']]) {
    const r = await ruf(z.url, 'POST', '/sampler/ton/grund', koerper);
    assert.deepEqual([r.code, r.j.fehler], [code, fehler], JSON.stringify(koerper));
  }
  assert.equal(graphText(z, graph), text);
});

test('deleting: a tone in use is refused; a cut takes its free tones with it (review focus 4)', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 128);
  const s = await z.schnitt();
  const a = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 2, spur: true });
  const frei = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 3 });
  const sl = await ruf(z.url, 'POST', '/sampler/spur', { id: s.id });
  assert.ok(a.code === 200 && frei.code === 200 && sl.code === 200);
  const dateien = () => ({ ton: fs.readdirSync(z.d.bk).filter((n) => n.startsWith('ton-')).sort(), smp: fs.readdirSync(z.d.bk).filter((n) => n.startsWith('smp-')).sort() });
  const alle = dateien();
  assert.equal(alle.ton.length, 2);
  const trackName = (await z.projekt()).spuren.find((x) => x.id === a.j.spur_id).name;
  // a tone in use
  const d1 = await ruf(z.url, 'POST', '/sampler/ton/loeschen', { graph: a.j.ton.graph });
  assert.deepEqual([d1.code, d1.j.fehler, d1.j.spuren], [409, 'ton_in_gebrauch', [trackName]], JSON.stringify(d1.j));
  assert.ok(d1.j.text.includes(trackName), d1.j.text);
  assert.deepEqual(dateien(), alle, 'nothing removed');
  // the cut: refused while the slice track exists (A1's refusal comes first), and nothing is removed
  const c1 = await ruf(z.url, 'POST', '/sampler/loeschen', { id: s.id });
  assert.deepEqual([c1.code, c1.j.fehler], [409, 'schnitt_in_gebrauch']);
  assert.deepEqual(dateien(), alle);
  // remove the slice track: now the tone track refuses
  let rev = (await z.projekt()).rev;
  let lo = await ruf(z.url, 'POST', '/proj/aendern', { rev, label: 'Remove', befehle: [{ befehl: 'spur_loeschen', spur_id: sl.j.spur_id }] });
  assert.equal(lo.code, 200, JSON.stringify(lo.j));
  const c2 = await ruf(z.url, 'POST', '/sampler/loeschen', { id: s.id });
  assert.deepEqual([c2.code, c2.j.fehler, c2.j.spuren], [409, 'ton_in_gebrauch', [trackName]], JSON.stringify(c2.j));
  assert.deepEqual(dateien().ton, alle.ton, 'no tone removed, the free one neither');
  assert.ok(fs.existsSync(path.join(z.d.sampler, s.id)), 'the cut is still there');
  assert.equal(dateien().smp.length, alle.smp.length);
  // the free tone can go on its own
  const d2 = await ruf(z.url, 'POST', '/sampler/ton/loeschen', { graph: frei.j.ton.graph });
  assert.deepEqual([d2.code, d2.j], [200, { ok: true }]);
  assert.deepEqual(dateien().ton, alle.ton.filter((n) => n !== `${frei.j.ton.graph}.json`));
  assert.ok(!fs.existsSync(path.join(z.d.bk, 'panels', `${frei.j.ton.graph}.json`)) && !fs.existsSync(path.join(z.d.sampler, s.id, `ton-${frei.j.ton.nr}.json`)));
  assert.deepEqual([(await ruf(z.url, 'POST', '/sampler/ton/loeschen', { graph: frei.j.ton.graph })).code, (await ruf(z.url, 'POST', '/sampler/ton/loeschen', {})).code], [404, 400]);
  // another tone, free again, and remove the track: the cut now goes with everything
  const frei2 = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 6, bis: 7 });
  assert.equal(frei2.code, 200, JSON.stringify(frei2.j));
  rev = (await z.projekt()).rev;
  lo = await ruf(z.url, 'POST', '/proj/aendern', { rev, label: 'Remove', befehle: [{ befehl: 'spur_loeschen', spur_id: a.j.spur_id }] });
  assert.equal(lo.code, 200, JSON.stringify(lo.j));
  const c3 = await ruf(z.url, 'POST', '/sampler/loeschen', { id: s.id });
  assert.deepEqual([c3.code, c3.j], [200, { ok: true }]);
  assert.deepEqual(dateien(), { ton: [], smp: [] }, 'no ton-* and no smp-* file of the cut in bk');
  assert.deepEqual(fs.readdirSync(path.join(z.d.bk, 'panels')), []);
  assert.ok(!fs.existsSync(path.join(z.d.sampler, s.id)));
});

test('a tone is also in use by a stored project and by a module of the store; the text names them', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Alpha', 128);
  const s = await z.schnitt();
  const a = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 2, spur: true });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  await z.oeffne('Beta', 128);                                             // Alpha is saved and closed
  const d1 = await ruf(z.url, 'POST', '/sampler/ton/loeschen', { graph: a.j.ton.graph });
  assert.deepEqual([d1.code, d1.j.fehler], [409, 'ton_in_gebrauch'], JSON.stringify(d1.j));
  assert.ok(d1.j.text.includes('Alpha') && !d1.j.text.includes('Beta'), d1.j.text);
  const c1 = await ruf(z.url, 'POST', '/sampler/loeschen', { id: s.id });
  assert.equal(c1.code, 409, 'the cut refuses too: its tone is played in Alpha');
  assert.equal(c1.j.fehler, 'ton_in_gebrauch');
  assert.ok(c1.j.text.includes('Alpha'), c1.j.text);
  assert.ok(fs.existsSync(path.join(z.d.sampler, s.id, `ton-${a.j.ton.nr}.json`)), 'nothing removed');
  // a module of the store that plays the graph of a free tone
  const b = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 5 });
  const mid = 'abcdabcdabcdabcd';
  fs.mkdirSync(path.join(z.d.module, mid), { recursive: true });
  const spur = { id: 's1', nr: 1, name: 'Played', art: 'instrument', geraet: bkGeraet(b.j.ton.graph), clips: [] };
  fs.writeFileSync(path.join(z.d.module, mid, 'modul.json'), JSON.stringify({ format: 1, id: mid, gespeichert: '2026-11-16T10:00:00Z', herkunft: { titel: 'Mod One' }, gruppen: [{ id: 'g1', name: 'Mod One' }], spuren: [spur], audio: [] }));
  const d2 = await ruf(z.url, 'POST', '/sampler/ton/loeschen', { graph: b.j.ton.graph });
  assert.deepEqual([d2.code, d2.j.fehler], [409, 'ton_in_gebrauch']);
  assert.ok(d2.j.text.includes('Mod One'), d2.j.text);
  assert.ok(fs.existsSync(path.join(z.d.bk, `${b.j.ton.graph}.json`)));
});

test('Stop Cypher refuses the writes, Andreas goes on, reading stays open', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 128);
  const s = await z.schnitt();
  const a = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 2 }, CYPHER);                // before Stop Cypher Cypher may write
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const ctx = z.o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(z.o).kiGestoppt));
  const vorher = z.bkTon();
  for (const [pfad, koerper] of [['/sampler/ton', { id: s.id, von: 1 }], ['/sampler/ton', { id: s.id, von: 1, spur: true }],
    ['/sampler/ton/grund', { graph: a.j.ton.graph, grund: 60 }], ['/sampler/ton/loeschen', { graph: a.j.ton.graph }]]) {
    const c = await ruf(z.url, 'POST', pfad, koerper, CYPHER);
    assert.deepEqual([c.code, c.j.fehler], [409, 'ki_gestoppt'], pfad);
  }
  assert.deepEqual(z.bkTon(), vorher, 'nothing was made or removed');
  assert.equal((await ruf(z.url, 'GET', `/sampler/ton?graph=${a.j.ton.graph}`, undefined, CYPHER)).code, 200);
  assert.equal((await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 1 })).code, 200, 'Andreas still can');
});

test('the answers carry the key of the cut when it has one (the page names it beside a root taken from the key)', async (t) => {
  const z = await aufbau(t);
  const s = await z.schnitt();
  const a = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 1 });
  assert.equal(a.j.tonart, undefined, 'library loops have no key');
  assert.equal(a.j.ton.grund_quelle, 'vorgabe', 'the ramp is silent as a mono sum: no detection, no key');
  const datei = path.join(z.d.sampler, s.id, 'schnitt.json');
  fs.writeFileSync(datei, JSON.stringify({ ...JSON.parse(fs.readFileSync(datei, 'utf8')), tonart: '8A' }));
  const b = await ruf(z.url, 'POST', '/sampler/ton', { id: s.id, von: 1 });
  assert.deepEqual([b.code, b.j.tonart, b.j.ton.grund, b.j.ton.grund_quelle], [200, '8A', 69, 'tonart'], JSON.stringify(b.j));   // 8A = A minor: tonic A
  assert.ok(b.j.text.includes('from the key 8A'), b.j.text);
  const g = await ruf(z.url, 'GET', `/sampler/ton?graph=${b.j.ton.graph}`);
  assert.equal(g.j.tonart, '8A');
});
