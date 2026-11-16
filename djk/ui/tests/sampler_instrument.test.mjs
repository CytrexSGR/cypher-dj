// Sample player stage 2, strand S: the instrument store, the pack, the generated device graph and panel, the octave convention by pitch detection.
// Sine files in temp folders; every folder (roots, store, graph folder) is injected, never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sinusWav } from './support/sinus_wav.mjs';
import { baueInstrument, instrumentGraph, instrumentPanel, instrumentLauf, liesInstrument, listeInstrumente, loescheInstrument, speichereInstrument, entscheideVersatz, zonenFlach, mitteVon, PACK_MAX_BYTES } from '../sampler/instrument.ts';
import { listeGraphen } from '../graphs.ts';
import { dekodiereDatei, ersterTon, dekodiereDateiAsync } from '../sampler/file.ts';

const HZ = { C: 261.6256, E: 329.6276, G: 391.9954, A: 440, B: 493.8833, D: 293.6648 };

function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-ins-'));
  const o = { ordner: path.join(root, 'sampler'), bk: path.join(root, 'bk') };
  const lib = path.join(root, 'lib');
  fs.mkdirSync(o.ordner); fs.mkdirSync(o.bk); fs.mkdirSync(lib);
  fs.writeFileSync(path.join(o.ordner, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: lib }]));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bkDateien = () => { const aus = []; const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? geh(path.join(d, e.name)) : aus.push(path.relative(root, path.join(d, e.name))); }; geh(o.bk); geh(o.ordner); return aus.filter((x) => !x.endsWith('wurzeln.json')); };
  return { root, o, lib, bkDateien };
}
const sinus = (lib, rel, hz, sekunden) => sinusWav(path.join(lib, rel), { hz, sekunden, rate: 48000, kanaele: 1 });

test('octave convention: the pitch detection decides, sine files named in both conventions', async (t) => {
  const z = aufbau(t);
  for (const [ordner, oktave] of [['sci', 4], ['live', 3]]) {   // the same three pitches: C4/E4/G4 (C4 = 60) or C3/E3/G3 (C3 = 60)
    for (const n of ['C', 'E', 'G']) sinus(z.lib, `${ordner}/Pia ${n}${oktave} f.wav`, HZ[n], 1.6);
  }
  const a = await baueInstrument({ wurzel: 'Lib', ordner: 'sci' }, z.o);
  const b = await baueInstrument({ wurzel: 'Lib', ordner: 'live' }, z.o);
  assert.deepEqual(a.instrument.zonen.map((x) => x.grund), [60, 64, 67]);
  assert.deepEqual(b.instrument.zonen.map((x) => x.grund), [60, 64, 67]);
  assert.equal(a.instrument.konvention, 'C4=60');
  assert.equal(b.instrument.konvention, 'C3=60');
});

test('entscheideVersatz: nothing usable or a tie gives C4 = 60', () => {
  assert.equal(entscheideVersatz([]), 1);
  assert.equal(entscheideVersatz([{ klasse: 0, oktave: 3, midi: null, konfidenz: 0 }]), 1);
  assert.equal(entscheideVersatz([{ klasse: 0, oktave: 3, midi: 60.2, konfidenz: 0.1 }]), 1);   // not confident
  assert.equal(entscheideVersatz([{ klasse: 0, oktave: 3, midi: 60.2, konfidenz: 0.9 }, { klasse: 4, oktave: 3, midi: 63.9, konfidenz: 0.9 }]), 2);
  assert.equal(entscheideVersatz([{ klasse: 0, oktave: 4, midi: 60.2, konfidenz: 0.9 }]), 1);
});

test('the pack: offsets match the decoded lengths, total frames, layers and takes', async (t) => {
  const z = aufbau(t);
  const dauer = { 'Pia C3 p.wav': 0.7, 'Pia C3 f.wav': 0.8, 'Pia E3 p rr1.wav': 0.9, 'Pia E3 p rr2.wav': 1.0, 'Pia G3 p.wav': 1.1 };
  for (const [n, s] of Object.entries(dauer)) sinus(z.lib, `k/${n}`, HZ[n.split(' ')[1][0]], s);
  const { instrument: i } = await baueInstrument({ wurzel: 'Lib', ordner: 'k', name: 'Test Pia' }, z.o);
  assert.equal(i.zonen.length, 5);
  let summe = 0;
  for (const zo of i.zonen) {
    const roh = dekodiereDatei(path.join(z.lib, zo.datei), 10);
    const n = roh.length / 2 - ersterTon(roh);
    assert.equal(zo.a, summe, zo.datei);
    assert.equal(zo.b - zo.a, n, zo.datei);
    summe += n;
  }
  assert.equal(i.frames, summe);
  const pack = path.join(z.o.bk, 'samples', `ins-${i.id}.f32`);
  assert.equal(fs.statSync(pack).size, summe * 8);
  // the samples in the pack are the decoded samples of the file
  const roh = dekodiereDatei(path.join(z.lib, i.zonen[2].datei), 10), s0 = ersterTon(roh);
  const buf = fs.readFileSync(pack), f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  assert.deepEqual(Array.from(f.subarray(i.zonen[2].a * 2, i.zonen[2].a * 2 + 64)), Array.from(roh.subarray(s0 * 2, s0 * 2 + 64)));
  // ranges: C has two layers, E two takes of one layer
  assert.deepEqual(i.zonen.map((x) => [x.grund, x.vlo, x.vhi, x.lage, x.rr]), [[60, 1, 63, 'p', undefined], [60, 64, 127, 'f', undefined], [64, 1, 127, 'p', 1], [64, 1, 127, 'p', 2], [67, 1, 127, 'p', undefined]]);
  assert.deepEqual(i.zonen.map((x) => x.datei).slice(0, 2), ['k/Pia C3 p.wav', 'k/Pia C3 f.wav']);
  assert.equal(i.quelle.wurzel, 'Lib'); assert.equal(i.quelle.ordner, 'k');
  assert.equal(mitteVon(i), Math.round((48 + 79) / 2));
  // files: pack, graph, panel, entry; the lauf is idle again
  assert.deepEqual(z.bkDateien().sort(), [`bk/ins-${i.id}.json`, `bk/panels/ins-${i.id}.json`, `bk/samples/ins-${i.id}.f32`, `sampler/instrumente/${i.id}/instrument.json`]);
  assert.deepEqual(instrumentLauf(), { laeuft: false, name: '', fertig: 0, von: 0 });
  assert.deepEqual(listeInstrumente(z.o).map((x) => x.id), [i.id]);
  assert.deepEqual(liesInstrument(i.id, z.o), JSON.parse(JSON.stringify(i)));
});

test('a pack over the limit is refused before anything is written, with its size', async (t) => {
  const z = aufbau(t);
  for (const n of ['C', 'D', 'E', 'G']) sinus(z.lib, `big/Pia ${n}3.wav`, HZ[n], 1);   // 4 x 48000 frames x 8 bytes = 1.5 MiB
  await assert.rejects(baueInstrument({ wurzel: 'Lib', ordner: 'big' }, { ...z.o, packMaxBytes: 1_000_000 }), (e) => e.grund === 'pack_zu_gross' && e.code === 422 && /1\.5 MiB/.test(e.text) && /1\.0 MiB/.test(e.text));
  assert.deepEqual(z.bkDateien(), []);
  assert.equal(fs.existsSync(path.join(z.o.ordner, 'instrumente')), false);
  assert.equal(PACK_MAX_BYTES, 2 * 1024 ** 3);
  const ok = await baueInstrument({ wurzel: 'Lib', ordner: 'big' }, { ...z.o, packMaxBytes: 2_000_000 });
  assert.equal(ok.instrument.zonen.length, 4);
});

test('fewer than three notes is refused as kein_instrument; nothing is left', async (t) => {
  const z = aufbau(t);
  sinus(z.lib, 'dre/Pia C3.wav', HZ.C, 1); sinus(z.lib, 'dre/Pia E3.wav', HZ.E, 1); sinus(z.lib, 'dre/Kick.wav', 100, 1);
  await assert.rejects(baueInstrument({ wurzel: 'Lib', ordner: 'dre' }, z.o), (e) => e.grund === 'kein_instrument' && e.code === 422 && /2 different notes/.test(e.text) && /at least 3/.test(e.text));
  await assert.rejects(baueInstrument({ wurzel: 'Lib', ordner: '' }, z.o), (e) => e.grund === 'kein_instrument');
  assert.deepEqual(z.bkDateien(), []);
  await assert.rejects(baueInstrument({ wurzel: 'Nix', ordner: '' }, z.o), (e) => e.grund === 'quelle_unbekannt');
  await assert.rejects(baueInstrument({ wurzel: 'Lib', ordner: '../x' }, z.o), (e) => e.grund === 'quelle_unbekannt');
});

test('a failed build leaves nothing behind (unreadable file, silent file)', async (t) => {
  const z = aufbau(t);
  for (const n of ['C', 'D', 'E']) sinus(z.lib, `bad/Pia ${n}3.wav`, HZ[n], 1);
  fs.writeFileSync(path.join(z.lib, 'bad', 'Pia G3.wav'), 'this is not audio');
  await assert.rejects(baueInstrument({ wurzel: 'Lib', ordner: 'bad' }, z.o), (e) => e.grund === 'format_falsch');
  assert.deepEqual(z.bkDateien(), []);
  assert.equal(instrumentLauf().laeuft, false);
  fs.rmSync(path.join(z.lib, 'bad', 'Pia G3.wav'));
  sinusWav(path.join(z.lib, 'bad', 'Pia G3.wav'), { sekunden: 1, rate: 48000, stumm: true });
  await assert.rejects(baueInstrument({ wurzel: 'Lib', ordner: 'bad' }, z.o), (e) => e.grund === 'format_falsch' && /silent/.test(e.text));
  assert.deepEqual(z.bkDateien(), []);
});

test('a second build at the same time is refused; the progress is reported', async (t) => {
  const z = aufbau(t);
  for (const n of ['C', 'D', 'E', 'G', 'A', 'B']) sinus(z.lib, `par/Pia ${n}3.wav`, HZ[n], 1);
  const erste = baueInstrument({ wurzel: 'Lib', ordner: 'par', name: 'Erste' }, z.o);
  assert.deepEqual(instrumentLauf(), { laeuft: true, name: 'Erste', fertig: 0, von: 0 });
  await assert.rejects(baueInstrument({ wurzel: 'Lib', ordner: 'par' }, z.o), (e) => e.grund === 'laeuft_schon' && e.code === 409);
  const g = await erste;
  assert.equal(g.instrument.zonen.length, 6);
  assert.deepEqual(instrumentLauf(), { laeuft: false, name: '', fertig: 0, von: 0 });
});

test('the async decoder does not block the event loop', async (t) => {
  const z = aufbau(t);
  for (let k = 0; k < 10; k++) sinus(z.lib, `a${k}.wav`, 200 + k, 0.5);
  let ticks = 0;
  const uhr = setInterval(() => { ticks++; }, 5);
  const alle = await Promise.all(Array.from({ length: 10 }, (_, k) => dekodiereDateiAsync(path.join(z.lib, `a${k}.wav`), 5)));
  clearInterval(uhr);
  assert.ok(alle.every((x) => x.length === 48000));
  assert.ok(ticks >= 1, 'the event loop kept running during decoding');
});

test('graph: zone mode, 12 numbers per zone, vel edge, 16 voices, no forbidden fields', () => {
  const zonen = [
    { datei: 'a C3.wav', a: 0, b: 1000, grund: 60, lo: 48, hi: 62, vlo: 1, vhi: 63, gain_db: 0, pan: 0 },
    { datei: 'a C3 f.wav', a: 1000, b: 2500, grund: 60, lo: 48, hi: 62, vlo: 64, vhi: 127, gain_db: -6, pan: 0.5 },
  ];
  const g = instrumentGraph({ id: 'test-1234', zonen });
  assert.equal(g.format, 'baukasten/2');
  assert.equal(g.name, 'ins-test-1234');
  assert.equal(g.stimmen, 16);
  const smp = g.knoten.find((n) => n.id === 'smp');
  assert.equal(smp.art, 'sampler');
  assert.equal(smp.datei, 'ins-test-1234.f32');
  assert.equal(smp.zonen.length, 24);
  assert.deepEqual(smp.zonen.slice(0, 12), [0, 1000, 60, 48, 62, 1, 63, 1, 0, 0, 0, 0]);
  assert.deepEqual(smp.zonen.slice(12, 24), [1000, 2500, 60, 48, 62, 64, 127, 0.501187, 0.5, 0, 0, 0]);
  for (const f of ['grund', 'scheiben', 'grenzen', 'noten_wahl', 'schleife']) assert.equal(f in smp, false, f);
  assert.deepEqual(zonenFlach(zonen), smp.zonen);
  assert.ok(g.kanten.some((k) => k.von === 'note.vel' && k.nach === 'smp.vel'));
  assert.ok(g.kanten.some((k) => k.von === 'tr.aus' && k.nach === 'smp.hz'));
  const ids = new Set(g.knoten.map((n) => n.id));
  assert.equal(ids.size, g.knoten.length);
  for (const k of g.kanten) for (const e of [k.von, k.nach]) assert.ok(ids.has(e.split('.')[0]), e);
  assert.deepEqual(Object.keys(g.regler_namen), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.equal(g.regler_namen['9'], 'Velocity');
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);   // plain JSON
});

test('graph: the velocity curve is 1 - Velocity + Velocity * vel', () => {
  const g = instrumentGraph({ id: 'x', zonen: [] });
  const n = Object.fromEntries(g.knoten.map((k) => [k.id, k]));
  const ein = (nach) => g.kanten.filter((k) => k.nach.startsWith(`${nach}.`)).map((k) => [k.nach.split('.')[1], k.von.split('.')[0]]);
  const wert = (id, vel, V) => {
    const k = n[id];
    const arg = (port) => { const q = ein(id).find((e) => e[0] === port); return q ? wert(q[1], vel, V) : (k[port] ?? 0); };
    if (id === 'note') return vel;
    if (k.art === 'regler') { assert.equal(id, 'vlc'); return V; }
    if (k.art === 'add') return arg('a') + arg('b');
    if (k.art === 'mul') return arg('a') * arg('b');
    throw new Error(id);
  };
  for (const V of [0, 0.5, 1]) for (const vel of [0.1, 0.5, 100 / 127, 1]) assert.ok(Math.abs(wert('vkurve', vel, V) - (1 - V + V * vel)) < 1e-12, `${V} ${vel}`);
  // gain = env x Level x curve
  assert.deepEqual(ein('g1').sort(), [['a', 'lvl'], ['b', 'vkurve']]);
  assert.deepEqual(ein('gain').sort(), [['a', 'g1'], ['b', 'env']]);
});

test('panel: front knobs and the nine knobs of the graph', () => {
  const p = instrumentPanel({ id: 'x', name: 'Grand Piano' });
  assert.equal(p.format, 'cypherdj-panel/2');
  assert.deepEqual(p.geraet, { art: 'bk', graph: 'ins-x' });
  assert.deepEqual(p.front, ['k2', 'k5', 'k6', 'k7', 'k9', 'k8']);
  const labels = Object.fromEntries(p.sections[0].controls.map((c) => [c.bind.param, c.label]));
  assert.deepEqual(p.front.map((k) => labels[k]), ['Attack', 'Release', 'Cutoff', 'Reso', 'Velocity', 'Level']);
  assert.equal(p.sections[0].controls.length, 9);
  assert.ok(instrumentPanel({ id: 'x', name: 'N'.repeat(80) }).title.length <= 40);
  const g = instrumentGraph({ id: 'x', zonen: [] });
  assert.deepEqual(p.sections[0].controls.map((c) => c.bind.param).sort(), g.knoten.filter((k) => k.art === 'regler').map((k) => `k${k.nr}`).sort());
});

test('the store entry keeps unknown fields on rewrite', async (t) => {
  const z = aufbau(t);
  for (const n of ['C', 'D', 'E']) sinus(z.lib, `s/Pia ${n}3.wav`, HZ[n], 0.5);
  const { instrument: i } = await baueInstrument({ wurzel: 'Lib', ordner: 's' }, z.o);
  const datei = path.join(z.o.ordner, 'instrumente', i.id, 'instrument.json');
  const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
  roh.spaeteres_feld = { x: [1, 2] };
  fs.writeFileSync(datei, JSON.stringify(roh));
  speichereInstrument({ ...i, name: 'Umbenannt' }, z.o);
  const neu = JSON.parse(fs.readFileSync(datei, 'utf8'));
  assert.deepEqual(neu.spaeteres_feld, { x: [1, 2] });
  assert.equal(neu.name, 'Umbenannt');
  assert.equal(neu.konvention, i.konvention);
});

test('the device list files the instrument under sampler with its name', async (t) => {
  const z = aufbau(t);
  for (const n of ['C', 'D', 'E']) sinus(z.lib, `g/Pia ${n}3.wav`, HZ[n], 0.5);
  const { instrument: i } = await baueInstrument({ wurzel: 'Lib', ordner: 'g', name: 'Mein Klavier' }, z.o);
  const alt = process.env.CYPHERDJ_SAMPLER;
  process.env.CYPHERDJ_SAMPLER = z.o.ordner;
  try {
    const g = listeGraphen(z.o.bk).graphen.find((x) => x.name === `ins-${i.id}`);
    assert.deepEqual([g.art, g.kategorie, g.text, g.regler_namen['9']], ['instrument', 'sampler', 'Instrument · Mein Klavier', 'Velocity']);
  } finally { if (alt === undefined) delete process.env.CYPHERDJ_SAMPLER; else process.env.CYPHERDJ_SAMPLER = alt; }
});

test('delete removes pack, graph, panel and entry; an unknown id is 404', async (t) => {
  const z = aufbau(t);
  for (const n of ['C', 'D', 'E']) sinus(z.lib, `d/Pia ${n}3.wav`, HZ[n], 0.5);
  const { instrument: i } = await baueInstrument({ wurzel: 'Lib', ordner: 'd' }, z.o);
  loescheInstrument(i.id, z.o);
  assert.deepEqual(z.bkDateien(), []);
  assert.equal(liesInstrument(i.id, z.o), null);
  assert.throws(() => loescheInstrument(i.id, z.o), (e) => e.grund === 'instrument_unbekannt' && e.code === 404);
  assert.equal(liesInstrument('../x', z.o), null);
});
