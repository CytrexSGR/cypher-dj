// Sampler A2 task 3: cut again in place, marker edits with snap and renumbering, original order again. Pure functions plus the routes, on the stack of
// sampler_route.test.mjs (kern stand-in; the cut store, the graph folder, the loop library and the module store are temp folders, never ~/.config).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schreibeWavAusF32 } from '../project/recording.ts';
import { stapel } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { bis, ruf, warte, anKern, CYPHER } from './support/proj_stack.mjs';
import { einrasten, tonNach, umnummerBefehle } from '../sampler/marken.ts';

const DEMOS = path.resolve(import.meta.dirname, '../../instruments/modular_dsp/demos');
const MOD = '0123456789abcdef', MOD2 = 'fedcba9876543210';

// a loop of `beats` beats, frame i = (i, -i)
function schreibeLoop(loops, name, beats) {
  const frames = beats * 22500, f = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { f[2 * i] = i; f[2 * i + 1] = -i; }
  fs.mkdirSync(path.join(loops, name));
  fs.writeFileSync(path.join(loops, name, 'loop.f32'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(loops, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}
// a module with one WAV per track; `spuren` = {track name: frames}
function schreibeModul(root, module, id, { herkunft, spuren }) {
  const ordner = path.join(module, id, 'audio');
  fs.mkdirSync(ordner, { recursive: true });
  const liste = [];
  let n = 0;
  for (const [name, frames] of Object.entries(spuren)) {
    const sha = String(n++).repeat(64).slice(0, 64);
    const f = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) { f[2 * i] = i + n; f[2 * i + 1] = -i; }
    const tmp = path.join(root, `roh-${sha}.f32`);
    fs.writeFileSync(tmp, Buffer.from(f.buffer));
    schreibeWavAusF32(tmp, path.join(ordner, `${sha}.wav`));
    liste.push({ name, clips: [{ id: `c${n}`, art: 'audio', quelle: { sha256: sha, pfad_hinweis: `audio/${sha}.wav` } }] });
  }
  fs.writeFileSync(path.join(module, id, 'modul.json'), JSON.stringify({ format: 1, id, gespeichert: '2026-11-16T10:00:00Z', herkunft, gruppen: [{ id: 'g1', name: 'Mod' }], spuren: liste, audio: [] }));
}

// Sampler A2: noise bursts (decaying noise, 40 ms) make a break with hits; `still` is silence. Written into the library of a running test (read at each request).
function burstDaten(beats, bursts) {
  const frames = beats * 22500, f = new Float32Array(frames * 2);
  let z = 12345;
  const rausch = () => { z = (Math.imul(z, 1664525) + 1013904223) >>> 0; return z / 2 ** 31 - 1; };
  for (const [start, amp] of bursts) {
    for (let t = 0; t < 1920 && start + t < frames; t++) { const v = rausch() * amp * Math.exp(-t / 96); f[2 * (start + t)] += v; f[2 * (start + t) + 1] += v; }
  }
  return f;
}
function schreibeDaten(loops, name, beats, daten) {
  fs.mkdirSync(path.join(loops, name));
  fs.writeFileSync(path.join(loops, name, 'loop.f32'), Buffer.from(daten.buffer));
  fs.writeFileSync(path.join(loops, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames: beats * 22500, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}
const BRUCH = [[0, 0.8], [11000, 0.05], [22500, 0.8], [30100, 0.4], [45000, 0.8], [61000, 0.2], [75500, 0.8]];
const mitBruch = (z) => {
  schreibeDaten(z.d.loops, 'bruch', 4, burstDaten(4, BRUCH));
  schreibeDaten(z.d.loops, 'still', 4, new Float32Array(90000 * 2));
};

async function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-t4-'));
  const d = { root, loops: path.join(root, 'loops'), module: path.join(root, 'module'), sampler: path.join(root, 'sampler'), bk: path.join(root, 'bk') };
  for (const p of Object.values(d)) if (p !== root) fs.mkdirSync(p);
  fs.copyFileSync(path.join(DEMOS, 'drums-909.json'), path.join(d.bk, 'drums-909.json'));
  const alt = { bk: process.env.CYPHERDJ_BK_ORDNER, sampler: process.env.CYPHERDJ_SAMPLER };
  process.env.CYPHERDJ_BK_ORDNER = d.bk;
  process.env.CYPHERDJ_SAMPLER = d.sampler;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', alt.bk], ['CYPHERDJ_SAMPLER', alt.sampler]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  schreibeLoop(d.loops, 'l4', 4);
  schreibeLoop(d.loops, 'l8', 8);
  schreibeModul(root, d.module, MOD2, { herkunft: { bpm: 300, laenge_beats: 4, titel: 'Fast' }, spuren: { Loop: 38400 } });   // 4 beats in 38 400 frames: 300 BPM
  schreibeModul(root, d.module, MOD, { herkunft: { bpm: 127, laenge_beats: 4, titel: 'Song' }, spuren: { Loop: 90000, 'Drums original': 90000 } });
  const s = await stapel(t, { loops: d.loops });
  s.optionen.modulOrdner = d.module;      // read at each request
  s.optionen.samplerOrdner = d.sampler;
  const bkDateien = () => fs.readdirSync(d.bk).filter((n) => n.startsWith('smp-'));
  const oeffne = async (name = 'Mod', tempo) => {
    const r = await ruf(s.url, 'POST', '/proj/neu', { name, werkbank: true });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    if (tempo !== undefined) {
      const a = await ruf(s.url, 'POST', '/proj/aendern', { rev: r.j.projekt.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: tempo }] });
      assert.equal(a.code, 200, JSON.stringify(a.j));
    }
  };
  const projekt = async () => (await ruf(s.url, 'GET', '/proj/aktuell')).j.projekt;
  return { ...s, d, bkDateien, oeffne, projekt };
}
const liste = async (z) => (await ruf(z.url, 'GET', '/sampler/liste')).j.schnitte;

// ---- helpers ----
const holeSchnitt = async (z, id) => (await ruf(z.url, 'GET', `/sampler/schnitt?id=${id}`)).j.schnitt;
const bytes = (z, id) => [path.join(z.d.sampler, id, 'schnitt.json'), path.join(z.d.bk, `smp-${id}.json`), path.join(z.d.bk, 'panels', `smp-${id}.json`)].map((p) => fs.readFileSync(p, 'utf8'));
const graphGrenzen = (z, id) => JSON.parse(fs.readFileSync(path.join(z.d.bk, `smp-${id}.json`), 'utf8')).knoten.find((k) => k.art === 'sampler').grenzen;
const spurNoten = async (z, spurId) => (await z.projekt()).spuren.find((s) => s.id === spurId).clips[0].noten;
const idTon = (noten) => noten.map((n) => [n.id, n.ton]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const ladenZahl = (z) => anKern(z.log, '/k/arr/laden').length;
// counts the calls of the session's "load the live playback again" and passes them on
function ladeSpion(z) {
  const sitz = z.o.proj.sitzung, echt = sitz.ladeLiveNeuFrei.bind(sitz), s = { n: 0 };
  sitz.ladeLiveNeuFrei = () => { s.n++; return echt(); };
  return s;
}
// a module with the break cut at its hits on a track; returns the cut and the track
async function mitSpur(t, ref = 'bruch', koerper = { methode: 'anschlag' }) {
  const z = await aufbau(t);
  mitBruch(z);
  await z.oeffne('Mod', 128);
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref }, ...koerper });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  return { z, id: r.j.schnitt_id, spurId: r.j.spur_id, s: await holeSchnitt(z, r.j.schnitt_id) };
}

test('tonNach: add and remove keep each hit on its audio (review focus 3)', () => {
  assert.deepEqual([0, 4, 5, 9, 64 + 5, 64 + 9, 20].map((t) => tonNach('neu', 5, 10, t)), [0, 4, 6, 10, 64 + 6, 64 + 10, 20]);
  assert.deepEqual([0, 4, 5, 9, 64 + 5, 64 + 9, 20].map((t) => tonNach('weg', 5, 10, t)), [0, 4, 4, 8, 64 + 4, 64 + 8, 20]);
  assert.deepEqual([64 + 10, 64 + 12, 10, 11].map((t) => tonNach('neu', 5, 10, t)), [64 + 10, 64 + 12, 10, 11], 'a note no slice names stays put');
});

test('umnummerBefehle: one noten_aendern per clip with a changed note, only tracks that play the cut', () => {
  const geraet = (graph) => ({ art: 'intern', name: 'bk', graph, parameter: {} });
  const clip = (id, tone) => ({ id, art: 'midi', noten: tone.map((ton, i) => ({ id: `${id}n${i}`, beat: i, laenge: 1, ton, vel: 100 })) });
  const p = { spuren: [
    { id: 'a', geraet: geraet('smp-x1'), clips: [clip('c1', [0, 1, 5, 69]), clip('c2', [0, 1]), { id: 'au', art: 'audio' }] },
    { id: 'b', geraet: geraet('smp-other'), clips: [clip('c3', [5, 6])] },
    { id: 'c', geraet: { art: 'plugin' }, clips: [clip('c4', [7])] },
  ] };
  assert.deepEqual(umnummerBefehle(p, 'x1', 'neu', 5, 10), [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'c1n2', ton: 6 }, { id: 'c1n3', ton: 70 }] }]);
  assert.deepEqual(umnummerBefehle(p, 'x1', 'weg', 1, 10), [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'c1n1', ton: 0 }, { id: 'c1n2', ton: 4 }, { id: 'c1n3', ton: 68 }] },
    { befehl: 'noten_aendern', clip_id: 'c2', noten: [{ id: 'c2n1', ton: 0 }] }]);
  assert.deepEqual(umnummerBefehle(p, 'nix', 'neu', 1, 10), []);
});

test('snap goes to the nearest hit or 1/16 within 1/16 beat, and never without einrasten', async (t) => {
  const { z, id, s } = await mitSpur(t);
  const ganz = (f) => s.treffer.reduce((b, x) => (Math.abs(x - f) < Math.abs(b - f) ? x : b));
  const h = ganz(30400);
  assert.ok(Math.abs(h - 30100) < 300, `the detector finds the burst near 30100: ${h}`);
  assert.equal(einrasten(s, 30400), h, 'a hit within 1/16 beat (1406 frames)');
  assert.ok(s.treffer.every((x) => Math.abs(x - 28400) > 1406), 'no hit near 28400, so the grid decides');
  assert.equal(einrasten(s, 28400), 28125, 'beat 1.262 goes to the 1/16 position at beat 1.25');
  assert.equal(einrasten({ frames: 90000, beats: 4, treffer: [] }, 14000), 14000, 'nothing within 1/16 beat: the frame stays');
  // tie: the hit wins when a hit and a 1/16 position (5625) are equally near
  assert.equal(einrasten({ frames: 90000, beats: 4, treffer: [5575] }, 5600), 5575);
  assert.equal(einrasten({ frames: 90000, beats: 4, treffer: [5725] }, 5675), 5725, 'a hit 50 away beats the grid 50 away');
  // by the route: einrasten false keeps the frame, true snaps
  const g = s.grenzen;
  const lang = async (x, flag) => (await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'schieben', marke: 3, frame: x, ...(flag === undefined ? {} : { einrasten: flag }) })).j.schnitt.grenzen[3];
  assert.ok(g[3] + 900 < g[4] - 4);
  assert.equal(await lang(g[3] + 900, false), g[3] + 900);
  const mitSnap = await lang(g[3] + 900, true);
  assert.notEqual(mitSnap, g[3] + 900, 'with einrasten the marker goes to a hit or a grid position');
  assert.equal(mitSnap, einrasten(s, g[3] + 900));
  assert.equal(await lang(g[3] + 901), einrasten(s, g[3] + 901), 'einrasten defaults to true');
});

test('a moved marker changes the cut in place and leaves the pattern alone', async (t) => {
  const { z, id, spurId, s: vor } = await mitSpur(t);
  const spion = ladeSpion(z);
  const notenVor = await spurNoten(z, spurId), revVor = (await z.projekt()).rev, ladenVor = ladenZahl(z), graphVor = graphGrenzen(z, id);
  assert.deepEqual(graphVor, vor.grenzen);
  const frame = vor.grenzen[3] + 900;
  const r = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'schieben', marke: 3, frame, einrasten: false });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.schnitt.id, id);
  assert.equal(r.j.schnitt.grenzen[3], frame);
  assert.deepEqual(r.j.schnitt.grenzen.filter((_, i) => i !== 3), vor.grenzen.filter((_, i) => i !== 3));
  assert.equal(r.j.schnitt.methode, 'hand');
  assert.deepEqual(r.j.schnitt.ursprung, vor.ursprung, 'the bounds of the method are kept');
  assert.deepEqual(r.j.schnitt.treffer, vor.treffer);
  assert.equal(r.j.schnitt.guete.length, vor.guete.length);
  assert.ok(r.j.schnitt.geaendert > vor.geaendert);
  assert.deepEqual(await holeSchnitt(z, id), r.j.schnitt, 'schnitt.json holds the answer');
  assert.deepEqual(graphGrenzen(z, id), r.j.schnitt.grenzen, 'the graph follows');
  assert.equal(r.j.rev, undefined);
  assert.equal(r.j.projekt, undefined);
  assert.match(r.j.text, /moved/);
  assert.deepEqual(await spurNoten(z, spurId), notenVor, 'the pattern is as it was');
  assert.equal((await z.projekt()).rev, revVor, 'no history step');
  // the playback of the open project is loaded again, once: the graph is read at load
  assert.equal(spion.n, 1);
  assert.equal(ladenZahl(z), ladenVor + 1);
  // the same frame in beats
  const b = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'schieben', marke: 3, beat: frame * vor.beats / vor.frames, einrasten: false });
  assert.equal(b.j.schnitt.grenzen[3], frame);
});

test('a marker move under the load lock of a freeze does not load; the release does (the real-time run is not cut off)', async (t) => {
  const { z, id, s } = await mitSpur(t);
  const frei = z.o.proj.zugang.sperreLaden();
  const laden0 = ladenZahl(z);
  const r = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'schieben', marke: 3, frame: s.grenzen[3] + 900, einrasten: false });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(ladenZahl(z), laden0, 'no /k/arr/laden while the lock is held');
  assert.deepEqual(graphGrenzen(z, id), r.j.schnitt.grenzen, 'the graph is written all the same');
  const c = await ruf(z.url, 'POST', '/sampler/neu_schneiden', { id, methode: 'raster', scheiben: 8 });
  assert.equal(c.code, 200, JSON.stringify(c.j));
  assert.equal(ladenZahl(z), laden0);
  frei();
  assert.ok(await bis(() => ladenZahl(z) === laden0 + 1), 'the release loads once, for both changes');
  await warte(50);
  assert.equal(ladenZahl(z), laden0 + 1);
});

test('add and remove renumber the open project in one history step', async (t) => {
  const { z, id, spurId, s } = await mitSpur(t);
  const spion = ladeSpion(z);
  const g = s.grenzen, n = g.length - 1;
  assert.ok(n >= 6, `${n} slices`);
  // a reversed hit behind the marker (64 + 5) and a note no slice names (ton 20)
  const clipId = (await z.projekt()).spuren.find((x) => x.id === spurId).clips[0].id;
  const p0 = await z.projekt();
  const e = await ruf(z.url, 'POST', '/proj/aendern', { rev: p0.rev, label: 'Extra', befehle: [{ befehl: 'noten_neu', clip_id: clipId, noten: [{ beat: 0, laenge: 0.1, ton: 64 + 5, vel: 100 }, { beat: 0.5, laenge: 0.1, ton: 20, vel: 100 }] }] });
  assert.equal(e.code, 200, JSON.stringify(e.j));
  const vor = idTon(await spurNoten(z, spurId)), rev0 = (await z.projekt()).rev, laden0 = ladenZahl(z);
  const x = Math.round((g[4] + g[5]) / 2);
  const a = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'neu', frame: x, einrasten: false });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j.schnitt.grenzen, [...g.slice(0, 5), x, ...g.slice(5)]);
  assert.deepEqual(a.j.schnitt.methode, 'hand');
  assert.equal(a.j.rev, rev0 + 1);
  assert.equal(a.j.projekt.rev, rev0 + 1);
  const nach = idTon(await spurNoten(z, spurId));
  assert.deepEqual(nach, vor.map(([i, ton]) => [i, tonNach('neu', 5, n, ton)]));
  assert.ok(nach.some(([, ton]) => ton === 64 + 6) && !nach.some(([, ton]) => ton === 64 + 5), 'the reversed hit moved with its slice');
  assert.ok(nach.some(([, ton]) => ton === 20), 'ton 20 stays');
  assert.deepEqual(graphGrenzen(z, id), a.j.schnitt.grenzen);
  assert.match(a.j.text, /Slice 5 is split: its hits play the first part; slice 6 has no hits yet\./);
  assert.match(a.j.text, /modules that are not open/);
  assert.match(a.j.text, /Undo in PRODUCTION reverts the renumbering only/);
  let v = (await ruf(z.url, 'GET', '/proj/verlauf')).j;
  assert.equal(v.filter((q) => q.label === 'Add marker bruch').length, 1, 'one history step');
  // the step loads the playback itself (after the cut files were written): one load, no extra call
  assert.equal(spion.n, 0);
  assert.equal(ladenZahl(z), laden0 + 1);
  // remove it again: back to the first notes
  const w = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'weg', marke: 5 });
  assert.equal(w.code, 200, JSON.stringify(w.j));
  assert.deepEqual(w.j.schnitt.grenzen, g);
  assert.deepEqual(idTon(await spurNoten(z, spurId)), vor);
  assert.equal(w.j.rev, rev0 + 2);
  assert.match(w.j.text, /Slices 5 and 6 are merged into slice 5/);
  v = (await ruf(z.url, 'GET', '/proj/verlauf')).j;
  assert.equal(v.filter((q) => q.label === 'Remove marker bruch').length, 1);
  assert.equal(spion.n, 0);
  // a cut that no open track plays changes without a project step and without a load
  const lose = await ruf(z.url, 'POST', '/sampler/schnitt', { quelle: { art: 'loop', ref: 'bruch' }, methode: 'anschlag' });
  const l0 = ladenZahl(z);
  const k = await ruf(z.url, 'POST', '/sampler/marke', { id: lose.j.schnitt.id, art: 'neu', frame: Math.round((lose.j.schnitt.grenzen[1] + lose.j.schnitt.grenzen[2]) / 2), einrasten: false });
  assert.equal(k.code, 200, JSON.stringify(k.j));
  assert.deepEqual([k.j.rev, k.j.projekt, ladenZahl(z), spion.n], [undefined, undefined, l0, 0]);
});

test('refusals leave everything as it was (review focus 2 and 4)', async (t) => {
  const { z, id, spurId, s } = await mitSpur(t);
  const spion = ladeSpion(z);
  const g = s.grenzen, n = g.length - 1;
  const stand = async () => JSON.stringify([bytes(z, id), (await z.projekt()), ladenZahl(z), spion.n]);
  const vor = await stand();
  const nein = async (koerper, code, fehler, pfad = '/sampler/marke') => {
    const r = await ruf(z.url, 'POST', pfad, koerper);
    assert.deepEqual([r.code, r.j.fehler], [code, fehler], `${JSON.stringify(koerper)}: ${JSON.stringify(r.j)}`);
    assert.ok(typeof r.j.text === 'string' && r.j.text.length > 5, 'an English text');
    assert.equal(await stand(), vor, `nothing changed after ${JSON.stringify(koerper)}`);
  };
  await nein({ id, art: 'schieben', marke: 3, frame: g[2] + 2, einrasten: false }, 409, 'marke_zu_nah');
  await nein({ id, art: 'schieben', marke: 3, frame: g[2], einrasten: false }, 409, 'marke_zu_nah');
  await nein({ id, art: 'schieben', marke: 3, frame: g[4] + 5000, einrasten: false }, 409, 'marke_zu_nah');
  await nein({ id, art: 'schieben', marke: 3, frame: g[2] + 100 }, 409, 'marke_zu_nah');       // snaps onto the neighbour hit
  await nein({ id, art: 'neu', frame: g[2] + 2, einrasten: false }, 409, 'marke_zu_nah');
  await nein({ id, art: 'schieben', marke: 0, frame: 100 }, 404, 'marke_unbekannt');
  await nein({ id, art: 'schieben', marke: n, frame: 100 }, 404, 'marke_unbekannt');
  await nein({ id, art: 'weg', marke: 0 }, 404, 'marke_unbekannt');
  await nein({ id, art: 'weg', marke: n }, 404, 'marke_unbekannt');
  await nein({ id, art: 'schieben', marke: 1.5, frame: 100 }, 400, 'argument_ungueltig');
  await nein({ id, art: 'schieben', marke: 3 }, 400, 'argument_ungueltig');
  await nein({ id, art: 'schieben', marke: 3, frame: 5000, beat: 1 }, 400, 'argument_ungueltig');
  await nein({ id, art: 'schieben', marke: 3, frame: 'x' }, 400, 'argument_ungueltig');
  await nein({ id, art: 'neu', marke: 3, frame: 5000 }, 400, 'argument_ungueltig');
  await nein({ id, art: 'weg', marke: 3, frame: 5000 }, 400, 'argument_ungueltig');
  await nein({ id, art: 'schieben', marke: 3, frame: 31000, einrasten: 'ja' }, 400, 'argument_ungueltig');
  await nein({ id, art: 'quer', marke: 3 }, 400, 'argument_ungueltig');
  await nein({ id, art: 'weg', marke: 3, extra: 1 }, 400, 'argument_unbekannt');
  await nein({ id: 'nix', art: 'weg', marke: 3 }, 404, 'schnitt_unbekannt');
  await nein({ art: 'weg', marke: 3 }, 400, 'argument_ungueltig');
  // cut again: hand and mixed options are refused
  await nein({ id, methode: 'hand' }, 400, 'methode_unbekannt', '/sampler/neu_schneiden');
  await nein({ id, methode: 'anschlag', scheiben: 8 }, 400, 'argument_ungueltig', '/sampler/neu_schneiden');
  await nein({ id, methode: 'raster', empfindlichkeit: 0.5 }, 400, 'argument_ungueltig', '/sampler/neu_schneiden');
  await nein({ id, methode: 'raster', scheiben: 7 }, 400, 'argument_ungueltig', '/sampler/neu_schneiden');
  await nein({ id, methode: 'anschlag', empfindlichkeit: 2 }, 400, 'argument_ungueltig', '/sampler/neu_schneiden');
  await nein({ id, methode: 'raster', extra: 1 }, 400, 'argument_unbekannt', '/sampler/neu_schneiden');
  await nein({ id: 'nix', methode: 'raster' }, 404, 'schnitt_unbekannt', '/sampler/neu_schneiden');
  // original order
  await nein({ spur_id: 'nix' }, 404, 'spur_unbekannt', '/sampler/ursprung');
  await nein({}, 400, 'argument_ungueltig', '/sampler/ursprung');
  await nein({ spur_id: spurId, x: 1 }, 400, 'argument_unbekannt', '/sampler/ursprung');
  const rev = (await z.projekt()).rev;
  const dr = await ruf(z.url, 'POST', '/proj/aendern', { rev, label: 'Drums', befehle: [{ befehl: 'werkbank_spur_neu', name: 'Drums', geraet: { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} } }] });
  assert.equal(dr.code, 200, JSON.stringify(dr.j));
  const vor2 = await stand();
  const r = await ruf(z.url, 'POST', '/sampler/ursprung', { spur_id: dr.j.projekt.spuren.find((x) => x.name === 'Drums').id });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_schnitt_geraet']);
  assert.notEqual(vor2, vor);
  assert.equal(await stand(), vor2);
});

test('refused by the project: the cut files are written back, byte for byte (add and remove)', async (t) => {
  const { z, id, s } = await mitSpur(t);
  const spion = ladeSpion(z);
  const g = s.grenzen;
  const sitz = z.o.proj.sitzung, echt = sitz.aendern.bind(sitz);
  const vor = bytes(z, id), projektVor = JSON.stringify(await z.projekt()), laden0 = ladenZahl(z);
  const x = Math.round((g[4] + g[5]) / 2);
  // 1. the project answers with a refusal (a stale rev, as after a second write in between)
  sitz.aendern = async () => { sitz.aendern = echt; return { code: 409, j: { fehler: 'rev_veraltet', text: 'the project changed meanwhile' } }; };
  const r = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'neu', frame: x, einrasten: false });
  assert.deepEqual([r.code, r.j.fehler], [409, 'rev_veraltet']);
  assert.deepEqual(bytes(z, id), vor);
  // 2. it throws
  sitz.aendern = async () => { sitz.aendern = echt; throw Object.assign(new Error('x'), { code: 409, fehler: 'verlauf_inkonsistent', extra: {} }); };
  const r2 = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'weg', marke: 2 });
  assert.notEqual(r2.code, 200);
  assert.deepEqual(bytes(z, id), vor);
  // 3. a real stale rev: a second write between the read and the step (the session checks the rev it is given)
  sitz.aendern = async (d, q) => {
    sitz.aendern = echt;
    const p = await z.projekt();
    await echt({ rev: p.rev, label: 'Other', befehle: [{ befehl: 'tempo_setzen', bpm: 126 }] }, q);
    return echt(d, q);
  };
  const r3 = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'weg', marke: 2 });
  assert.deepEqual([r3.code, r3.j.fehler], [409, 'rev_veraltet'], JSON.stringify(r3.j));
  assert.deepEqual(bytes(z, id), vor);
  assert.equal(spion.n, 0);
  assert.equal(JSON.stringify((await z.projekt()).spuren), JSON.stringify(JSON.parse(projektVor).spuren), 'the pattern is as it was');
  assert.equal(ladenZahl(z), laden0, 'no refused step loaded a playback (the tempo change of step 3 needs none)');
});

test('64 slices: add is refused; a silent audio cannot be cut by hits again', async (t) => {
  const { z, s } = await mitSpur(t, 'still', { methode: 'raster', scheiben: 64 });
  const spion = ladeSpion(z);
  const id = s.id, vor = bytes(z, id), n = s.grenzen.length - 1;
  assert.equal(n, 64);
  const r = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'neu', frame: Math.round(s.grenzen[10] + 600), einrasten: false });
  assert.deepEqual([r.code, r.j.fehler], [409, 'zu_viele_scheiben']);
  const h = await ruf(z.url, 'POST', '/sampler/neu_schneiden', { id, methode: 'anschlag' });
  assert.deepEqual([h.code, h.j.fehler], [422, 'keine_anschlaege']);
  assert.deepEqual(bytes(z, id), vor);
  assert.equal(spion.n, 0);
  // a marker of a 2-slice cut can still go: one slice remains
  const w = await ruf(z.url, 'POST', '/sampler/neu_schneiden', { id, methode: 'raster', scheiben: 4 });
  assert.equal(w.code, 200, JSON.stringify(w.j));
});

test('cut again keeps the id and the pattern; original order rewrites the track', async (t) => {
  const { z, id, spurId, s } = await mitSpur(t);
  const spion = ladeSpion(z);
  const notenVor = await spurNoten(z, spurId), revVor = (await z.projekt()).rev, laden0 = ladenZahl(z);
  const r = await ruf(z.url, 'POST', '/sampler/neu_schneiden', { id, methode: 'raster', scheiben: 8 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.schnitt.id, id);
  assert.deepEqual([r.j.schnitt.grenzen.length, r.j.schnitt.methode, r.j.schnitt.empfindlichkeit], [9, 'raster', undefined]);
  assert.deepEqual(r.j.schnitt.ursprung, r.j.schnitt.grenzen);
  assert.deepEqual(r.j.spuren, ['bruch']);
  assert.equal(r.j.text, 'Cut again: 8 slices by grid. The patterns keep their slice numbers; WRITE ORIGINAL ORDER puts the new order on a track.');
  assert.deepEqual(await holeSchnitt(z, id), r.j.schnitt);
  assert.deepEqual(graphGrenzen(z, id), r.j.schnitt.grenzen);
  assert.deepEqual(await spurNoten(z, spurId), notenVor, 'the notes are untouched');
  assert.equal((await z.projekt()).rev, revVor);
  assert.equal(spion.n, 1, 'the open track hears the new bounds after one load');
  assert.equal(ladenZahl(z), laden0 + 1);
  // hits again, with a sensitivity
  const h = await ruf(z.url, 'POST', '/sampler/neu_schneiden', { id, methode: 'anschlag', empfindlichkeit: 0.5 });
  assert.equal(h.code, 200, JSON.stringify(h.j));
  assert.deepEqual([h.j.schnitt.methode, h.j.schnitt.empfindlichkeit, h.j.schnitt.grenzen], ['anschlag', 0.5, s.grenzen]);
  assert.match(h.j.text, /^Cut again: \d+ slices by hits\./);
  // the original order: one step, the old notes go, one note per slice come
  const rev1 = (await z.projekt()).rev;
  const o = await ruf(z.url, 'POST', '/sampler/ursprung', { spur_id: spurId });
  assert.equal(o.code, 200, JSON.stringify(o.j));
  assert.equal(o.j.rev, rev1 + 1);
  const g = h.j.schnitt;
  const noten = await spurNoten(z, spurId);
  assert.deepEqual(noten.map((x) => [x.ton, x.beat, x.laenge]), g.grenzen.slice(0, -1).map((b, i) => [i, b * g.beats / g.frames, (g.grenzen[i + 1] - b) * g.beats / g.frames]));
  assert.match(o.j.text, /^Original order: \d+ notes/);
  const v = (await ruf(z.url, 'GET', '/proj/verlauf')).j;
  assert.equal(v.filter((q) => q.label === 'Original order bruch').length, 1, 'one history step');
  // after the 8-slice cut the order has 8 notes 0..7
  await ruf(z.url, 'POST', '/sampler/neu_schneiden', { id, methode: 'raster', scheiben: 8 });
  const o8 = await ruf(z.url, 'POST', '/sampler/ursprung', { spur_id: spurId });
  assert.equal(o8.code, 200, JSON.stringify(o8.j));
  assert.deepEqual((await spurNoten(z, spurId)).map((x) => x.ton), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('Stop Cypher: the three routes refuse Cypher and change nothing', async (t) => {
  const { z, id, spurId } = await mitSpur(t);
  const ctx = z.o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(z.o).kiGestoppt));
  const vor = JSON.stringify([bytes(z, id), await z.projekt()]);
  for (const [pfad, koerper] of [['/sampler/neu_schneiden', { id, methode: 'raster', scheiben: 8 }], ['/sampler/marke', { id, art: 'weg', marke: 2 }], ['/sampler/ursprung', { spur_id: spurId }]]) {
    const r = await ruf(z.url, 'POST', pfad, koerper, CYPHER);
    assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt'], pfad);
  }
  assert.equal(JSON.stringify([bytes(z, id), await z.projekt()]), vor);
  const ok = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'weg', marke: 2 });
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
});

test('a marker moved back to the detected position gives the original method again', async (t) => {
  const { z, id, s: vor } = await mitSpur(t);
  assert.equal(vor.methode, 'anschlag');
  const weg = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'schieben', marke: 3, frame: vor.grenzen[3] + 900, einrasten: false });
  assert.equal(weg.j.schnitt.methode, 'hand');
  assert.equal(weg.j.schnitt.ursprung_methode, 'anschlag');
  const zweiter = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'schieben', marke: 2, frame: vor.grenzen[2] + 300, einrasten: false });
  assert.equal(zweiter.j.schnitt.methode, 'hand');
  const halb = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'schieben', marke: 3, frame: vor.grenzen[3], einrasten: false });
  assert.equal(halb.j.schnitt.methode, 'hand', 'one marker is still off its detected position');
  const zurueck = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'schieben', marke: 2, frame: vor.grenzen[2], einrasten: false });
  assert.equal(zurueck.code, 200, JSON.stringify(zurueck.j));
  assert.deepEqual(zurueck.j.schnitt.grenzen, vor.grenzen);
  assert.equal(zurueck.j.schnitt.methode, 'anschlag');
  assert.deepEqual((await holeSchnitt(z, id)).methode, 'anschlag', 'schnitt.json holds it');
});

test('every change of the cut tells the page by an event, so an open strip reads it', async (t) => {
  const { z, id, s: vor } = await mitSpur(t);
  const gesehen = [], echt = z.o.verteile.bind(z.o);
  z.o.verteile = (e) => { if (e.a === 'schnitt') gesehen.push(e.f); return echt(e); };
  const m = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'schieben', marke: 3, frame: vor.grenzen[3] + 900, einrasten: false });
  assert.equal(m.code, 200, JSON.stringify(m.j));
  const n = await ruf(z.url, 'POST', '/sampler/neu_schneiden', { id, methode: 'raster', scheiben: 8 });
  assert.equal(n.code, 200, JSON.stringify(n.j));
  assert.deepEqual(gesehen, [{ id, geaendert: m.j.schnitt.geaendert }, { id, geaendert: n.j.schnitt.geaendert }]);
  const refused = await ruf(z.url, 'POST', '/sampler/marke', { id, art: 'weg', marke: 99 });
  assert.equal(refused.code, 404);
  assert.equal(gesehen.length, 2, 'a refusal changes nothing and tells nothing');
});
