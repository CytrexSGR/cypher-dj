// Sample player stage 2b, strand S: sustain loops and release samples in the instrument build, the store entry, the text and the device graph and panel.
// Files are small generated WAVs (hand-written `smpl` chunks); every folder is injected, never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sinusWav } from './support/sinus_wav.mjs';
import { wavMitSchleife } from './support/schleifen_files.mjs';
import { baueInstrument, instrumentGraph, instrumentPanel, instrumentText, zeileVon, zonenFlach, ordnerInstrumentFeld } from '../sampler/instrument.ts';
import { dekodiereDatei, ersterTon } from '../sampler/file.ts';

function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-ins2b-'));
  const o = { ordner: path.join(root, 'sampler'), bk: path.join(root, 'bk') };
  const lib = path.join(root, 'lib');
  fs.mkdirSync(o.ordner); fs.mkdirSync(o.bk); fs.mkdirSync(lib);
  fs.writeFileSync(path.join(o.ordner, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: lib }]));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, o, lib };
}
const HZ = { C: 261.6256, E: 329.6276, G: 391.9954 };
/** Three played notes at 44.1 kHz with 0.1 s of leading silence; C and E carry a loop, G has none. */
function horn(z, { relOrdner = 'Rel' } = {}) {
  const loop = { C: [[22050, 33074]], E: [[20000, 30000]] };
  for (const n of ['C', 'E', 'G']) wavMitSchleife(path.join(z.lib, 'Horn', 'Sus', `Hrn ${n}3 f.wav`), { rate: 44100, frames: 44100, hz: HZ[n], stille: 4410, schleifen: loop[n] ?? null });
  for (const [n, extra] of [['C3', ''], ['E3', ' p'], ['E3', ' f'], ['G3', '']]) sinusWav(path.join(z.lib, 'Horn', relOrdner, `Hrn ${n}${extra} rel.wav`), { hz: HZ[n[0]], sekunden: 0.3, rate: 48000, kanaele: 1 });
}
const bau = (z, extra = {}) => baueInstrument({ wurzel: 'Lib', ordner: 'Horn/Sus', ...extra }, z.o);

test('a loop is scaled to 48 kHz, moved by the trimmed silence and put in pack frames', async (t) => {
  const z = aufbau(t); horn(z);
  const { instrument: i } = await bau(z, { release: false });
  const spiel = i.zonen.filter((x) => x.art === undefined);
  assert.equal(spiel.length, 3);
  for (const [k, n] of [[0, 'C'], [1, 'E']]) {
    const roh = dekodiereDatei(path.join(z.lib, spiel[k].datei), 10);
    const weg = ersterTon(roh);
    const [s, e] = n === 'C' ? [22050, 33075] : [20000, 30001];
    assert.deepEqual(spiel[k].loop, [spiel[k].a + Math.round(s * 48000 / 44100) - weg, spiel[k].a + Math.round(e * 48000 / 44100) - weg], n);
    assert.ok(spiel[k].loop[0] >= spiel[k].a && spiel[k].loop[1] <= spiel[k].b);
  }
  assert.equal('loop' in spiel[2], false);
  assert.ok(i.zonen.every((x) => x.art === undefined), 'release: false leaves the release folder out');
});

test('a loop outside the zone or inside the trimmed silence is dropped', async (t) => {
  const z = aufbau(t);
  const f = (n, schleifen) => wavMitSchleife(path.join(z.lib, 'K', `K ${n}3.wav`), { rate: 48000, frames: 20000, stille: 1000, hz: HZ[n], schleifen });
  f('C', [[5000, 30000]]);    // ends behind the file
  f('E', [[200, 9000]]);      // starts inside the trimmed silence
  f('G', [[5000, 5030]]);     // 31 frames long
  const { instrument: i } = await baueInstrument({ wurzel: 'Lib', ordner: 'K' }, z.o);
  assert.equal(i.zonen.length, 3);
  assert.ok(i.zonen.every((x) => !('loop' in x)));
  assert.deepEqual(zonenFlach(i.zonen).filter((_, k) => k % 12 === 9 || k % 12 === 10), new Array(6).fill(0));
});

test('the release folder becomes art-1 zones after the played zones, with their own ranges and the octave convention', async (t) => {
  const z = aufbau(t); horn(z);
  const g = await bau(z);
  const i = g.instrument;
  assert.equal(i.zonen.length, 7);
  assert.deepEqual(i.zonen.slice(0, 3).map((x) => x.art), [undefined, undefined, undefined]);
  const rel = i.zonen.slice(3);
  assert.ok(rel.every((x) => x.art === 'release' && !('loop' in x)));
  assert.deepEqual(rel.map((x) => [x.grund, x.lo, x.hi, x.vlo, x.vhi]), [[60, 48, 62, 1, 127], [64, 63, 65, 1, 63], [64, 63, 65, 64, 127], [67, 66, 79, 1, 127]]);
  assert.deepEqual(i.zonen.slice(0, 3).map((x) => x.grund), [60, 64, 67]);   // the same convention as the played zones
  assert.ok(rel.every((x) => x.datei.startsWith('Horn/Rel/')));
  // contiguous in the pack, after the played zones
  for (let k = 1; k < i.zonen.length; k++) assert.equal(i.zonen[k].a, i.zonen[k - 1].b);
  assert.equal(i.frames, i.zonen.at(-1).b);
  // the flat table: art 1 on the last four, no loop numbers
  const flach = zonenFlach(i.zonen);
  assert.deepEqual(i.zonen.map((_, k) => flach[k * 12 + 11]), [0, 0, 0, 1, 1, 1, 1]);
  assert.deepEqual(flach.slice(9, 12), [i.zonen[0].loop[0], i.zonen[0].loop[1], 0]);
  assert.deepEqual([flach[3 * 12 + 9], flach[3 * 12 + 10]], [0, 0]);
  // the counts: list row, text, build answer
  assert.deepEqual([zeileVon(i).schleifen, zeileVon(i).release, zeileVon(i).zonen, zeileVon(i).noten], [2, 4, 3, 3]);
  assert.match(instrumentText(i), /2 looped zones/);
  assert.match(instrumentText(i), /4 release zones/);
  assert.match(instrumentText(i), /3 zones/);
});

test('the sibling folder may be named Rel, release or RELEASES, and must carry note names', async (t) => {
  for (const name of ['release', 'RELEASES', 'Rel']) {
    const z = aufbau(t); horn(z, { relOrdner: name });
    assert.equal((await bau(z)).instrument.zonen.filter((x) => x.art === 'release').length, 4, name);
  }
  const z = aufbau(t); horn(z, { relOrdner: 'Noise' });
  assert.equal((await bau(z)).instrument.zonen.length, 3);
  const y = aufbau(t); horn(y);
  for (const f of fs.readdirSync(path.join(y.lib, 'Horn', 'Rel'))) fs.renameSync(path.join(y.lib, 'Horn', 'Rel', f), path.join(y.lib, 'Horn', 'Rel', f.replace(/[CEG]\d/, 'x')));
  assert.equal((await bau(y)).instrument.zonen.length, 3, 'files without note names are no release samples');
});

test('the 2 GiB limit and the zone limit count played and release zones together', async (t) => {
  const z = aufbau(t); horn(z);
  // played zones: 3 x 1 s x 8 bytes x 48000; release: 4 x 0.3 s
  const nur = await bau(z, { release: false });
  assert.equal(nur.instrument.zonen.length, 3);
  await assert.rejects(baueInstrument({ wurzel: 'Lib', ordner: 'Horn/Sus' }, { ...z.o, zonenMax: 6 }), (e) => e.grund === 'zu_viele_zonen' && e.code === 422 && /7 zones/.test(e.text) && /at most 6/.test(e.text));
  const played = 3 * 48000 * 8;
  await assert.rejects(baueInstrument({ wurzel: 'Lib', ordner: 'Horn/Sus' }, { ...z.o, packMaxBytes: Math.round(played + 100_000) }), (e) => e.grund === 'pack_zu_gross' && e.code === 422);
  const ok = await baueInstrument({ wurzel: 'Lib', ordner: 'Horn/Sus', release: false }, { ...z.o, packMaxBytes: Math.round(played + 100_000) });
  assert.equal(ok.instrument.zonen.length, 3);
});

test('the listing field: release files and looped files, only when there are any', async (t) => {
  const z = aufbau(t); horn(z);
  const dateien = (rel) => fs.readdirSync(path.join(z.lib, rel)).map((n) => ({ name: n, rel: `${rel}/${n}`, bytes: 1 }));
  const f = ordnerInstrumentFeld('Lib', 'Horn/Sus', dateien('Horn/Sus'), z.o);
  assert.deepEqual([f.noten, f.dateien, f.release, f.schleifen], [3, 3, 4, 2]);
  const ohne = aufbau(t);
  for (const n of ['C', 'E', 'G']) sinusWav(path.join(ohne.lib, 'P', `P ${n}3.wav`), { hz: HZ[n], sekunden: 0.3, rate: 48000, kanaele: 1 });
  const g = ordnerInstrumentFeld('Lib', 'P', fs.readdirSync(path.join(ohne.lib, 'P')).map((n) => ({ name: n, rel: `P/${n}`, bytes: 1 })), ohne.o);
  assert.equal('release' in g, false);
  assert.equal('schleifen' in g, false);
  assert.equal(ordnerInstrumentFeld('Lib', 'Q', [{ name: 'x.wav', rel: 'Q/x.wav', bytes: 1 }], ohne.o), null);
  // more than 400 files: the loop count is left out (headers are not read for every file of a huge folder)
  const viele = Array.from({ length: 401 }, (_, k) => ({ name: `V C3 v${k}.wav`, rel: `V/V C3 v${k}.wav`, bytes: 1 }))
    .concat(['E3', 'G3'].map((n) => ({ name: `V ${n}.wav`, rel: `V/V ${n}.wav`, bytes: 1 })));
  const h = ordnerInstrumentFeld('Lib', 'V', viele, ohne.o);
  assert.equal(h.noten, 3);
  assert.equal('schleifen' in h, false);
});

// ---- the device graph and the panel ----

const spiel = { datei: 'a C3.wav', a: 0, b: 1000, grund: 60, lo: 48, hi: 62, vlo: 1, vhi: 127, gain_db: 0, pan: 0 };
const mitLoop = { ...spiel, datei: 'a E3.wav', a: 1000, b: 3000, grund: 64, lo: 63, hi: 79, loop: [1200, 2500] };
const relZ = { datei: 'r/a C3.wav', a: 3000, b: 3500, grund: 60, lo: 48, hi: 79, vlo: 1, vhi: 127, gain_db: -3, pan: 0, art: 'release' };

test('graph without release zones is exactly the stage 2a graph (nine knobs, no rl/rr), loops only in the zone numbers', () => {
  const g = instrumentGraph({ id: 'x', zonen: [spiel, mitLoop] });
  assert.deepEqual(Object.keys(g.regler_namen), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(g.knoten.filter((k) => k.art === 'regler').map((k) => k.nr), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(g.kanten.some((k) => /\.(rl|rr)$/.test(k.von)), false);
  const smp = g.knoten.find((k) => k.id === 'smp');
  assert.deepEqual(smp.zonen.slice(12, 24), [1000, 3000, 64, 63, 79, 1, 127, 1, 0, 1200, 2500, 0]);
  assert.equal('loop_blende' in smp, false);
  const alt = instrumentGraph({ id: 'x', zonen: [spiel] });
  assert.deepEqual(alt.knoten.map((k) => k.id), g.knoten.map((k) => k.id));
  assert.deepEqual(alt.kanten, g.kanten);
});

test('graph with release zones: knob 10 Rel smp, smp.rl/rr x level x velocity curve added behind the envelope gain', () => {
  const g = instrumentGraph({ id: 'x', zonen: [spiel, mitLoop, relZ] });
  assert.equal(g.regler_namen['10'], 'Rel smp');
  const k10 = g.knoten.find((k) => k.art === 'regler' && k.nr === 10);
  assert.deepEqual([k10.min, k10.max, k10.mitte, k10.vorgabe], [0, 2, 1, 0.5]);
  const smp = g.knoten.find((k) => k.id === 'smp');
  assert.deepEqual(smp.zonen.slice(24, 36), [3000, 3500, 60, 48, 79, 1, 127, 0.707946, 0, 0, 0, 1]);
  const ids = new Set(g.knoten.map((n) => n.id));
  assert.equal(ids.size, g.knoten.length);
  for (const k of g.kanten) for (const e of [k.von, k.nach]) assert.ok(ids.has(e.split('.')[0]), e);
  const ein = (nach) => g.kanten.filter((k) => k.nach.startsWith(`${nach}.`)).map((k) => `${k.nach.split('.')[1]}<-${k.von}`).sort();
  for (const s of ['l', 'r']) {
    // the output is: amp_<s> (low-pass x envelope gain) + rel_<s> (smp.r<s> x level x curve)
    assert.deepEqual(ein(`aus`).filter((e) => e.startsWith(`${s}<-`)), [`${s}<-sum_${s}.aus`]);
    assert.deepEqual(ein(`sum_${s}`), [`a<-amp_${s}.aus`, `b<-rm_${s}.aus`]);
    assert.deepEqual(ein(`rm_${s}`), [`a<-smp.r${s}`, 'b<-rg.aus']);
  }
  assert.deepEqual(ein('rg'), ['a<-rls.aus', 'b<-vkurve.aus']);
  assert.deepEqual(ein('gain'), ['a<-g1.aus', 'b<-env.aus']);                  // the envelope gain does not touch the release samples
  assert.deepEqual(ein('amp_l'), ['a<-lp_l.tp', 'b<-gain.aus']);
  for (const n of g.knoten) { if (n.art === 'add') assert.ok(Object.keys(n).every((x) => ['id', 'art', 'a', 'b', 'c', 'd'].includes(x))); }
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
});

test('graph arithmetic of the release path: rl x Rel smp x (1 - Velocity + Velocity * vel), summed with the played path', () => {
  const g = instrumentGraph({ id: 'x', zonen: [spiel, relZ] });
  const n = Object.fromEntries(g.knoten.map((k) => [k.id, k]));
  const ein = (id) => g.kanten.filter((k) => k.nach.startsWith(`${id}.`)).map((k) => [k.nach.split('.')[1], k.von]);
  const wert = (von, w) => {
    const [id, port] = von.split('.');
    const k = n[id], arg = (p) => { const e = ein(id).find((x) => x[0] === p); return e ? wert(e[1], w) : (k[p] ?? 0); };
    if (id === 'note') return w.vel;
    if (von in w) return w[von];
    if (k.art === 'regler') return w[id];
    if (k.art === 'add') return arg('a') + arg('b') + arg('c') + arg('d');
    if (k.art === 'mul') return arg('a') * arg('b');
    throw new Error(von);
  };
  const w = { vel: 0.5, vlc: 0.5, rls: 1.5, lvl: 0.8, 'smp.rl': 0.3, 'smp.rr': -0.2, 'lp_l.tp': 1, 'lp_r.tp': 1, 'env.aus': 0.25 };
  const kurve = 1 - 0.5 + 0.5 * 0.5;
  assert.ok(Math.abs(wert('sum_l.aus', w) - (1 * 0.8 * kurve * 0.25 + 0.3 * 1.5 * kurve)) < 1e-12);
  assert.ok(Math.abs(wert('sum_r.aus', w) - (1 * 0.8 * kurve * 0.25 + -0.2 * 1.5 * kurve)) < 1e-12);
});

test('panel: the Rel smp knob only with release zones, on the front, bound to k10', () => {
  const a = instrumentPanel({ id: 'x', name: 'Horn' });
  assert.equal(a.sections[0].controls.length, 9);
  assert.deepEqual(a.front, ['k2', 'k5', 'k6', 'k7', 'k9', 'k8']);
  const b = instrumentPanel({ id: 'x', name: 'Horn', zonen: [spiel, relZ] });
  assert.equal(b.sections[0].controls.length, 10);
  const c = b.sections[0].controls.find((x) => x.bind.param === 'k10');
  assert.deepEqual([c.label, c.type, c.default], ['Rel smp', 'knob', 0.5]);
  assert.deepEqual(b.front, ['k2', 'k5', 'k6', 'k7', 'k9', 'k8', 'k10']);
  const g = instrumentGraph({ id: 'x', zonen: [spiel, relZ] });
  assert.deepEqual(b.sections[0].controls.map((x) => x.bind.param).sort(), g.knoten.filter((k) => k.art === 'regler').map((k) => `k${k.nr}`).sort());
});
