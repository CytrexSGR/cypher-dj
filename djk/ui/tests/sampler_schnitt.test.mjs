// Sampler A1 task 2: cut store, grid cut, generated device and panel, cut text. Temp folders only: the store, the graph folder, the loop
// library and the module store are all passed in (or set through CYPHERDJ_SAMPLER for the one test that lists graphs).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schreibeWavAusF32 } from '../project/recording.ts';
import { findeAnschlaege, findeTransienten } from '../project/transients.ts';
import { graphenOrdner, listeGraphen, normalisierePanel, pruefePanel, reglerBereiche } from '../graphs.ts';
import {
  EMPFINDLICHKEIT_VORGABE, MAX_SCHEIBEN, MAX_SCHNITT_FRAMES, MESS_FENSTER_S, RASTER_NAH_BEATS, RASTER_ZAHLEN, SCHNITT_ID, SCHNITT_METHODEN, SchnittFehler, ladeQuellAudio, legeSchnitt, liesSchnitt, listeSchnitte, loescheSchnitt,
  guete, samplerOrdner, sprungDbVon, standardZahl,
} from '../sampler/schnitt.ts';
import { fitWert, geraetGraph, geraetName, geraetPanel, speedVon, spurBefehl } from '../sampler/device.ts';
import { schnittText } from '../sampler/text.ts';
import { leseWavF32 } from '../sampler/wav.ts';

const wurzeln = [];
function neueDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-t2-'));
  wurzeln.push(root);
  const d = { root, ordner: path.join(root, 'sampler'), bk: path.join(root, 'bk'), loops: path.join(root, 'loops'), module: path.join(root, 'module') };
  for (const p of [d.ordner, d.bk, d.loops, d.module]) fs.mkdirSync(p);
  return d;
}
after(() => { for (const r of wurzeln) fs.rmSync(r, { recursive: true, force: true }); });

// a loop of `beats` beats: left channel = frame number, right = minus frame number (exact in float32 for these sizes)
function schreibeLoop(d, name, beats, versatz) {
  const frames = beats * 22500, f = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { f[2 * i] = i; f[2 * i + 1] = -i; }
  fs.mkdirSync(path.join(d.loops, name));
  fs.writeFileSync(path.join(d.loops, name, 'loop.f32'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(d.loops, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z', ...(versatz === undefined ? {} : { versatz_frames: versatz }) }));
}
// a module with one WAV per track name; `spuren` = {trackName: frames}; the WAV holds frame numbers as in schreibeLoop
function schreibeModul(d, id, { herkunft, spuren = { Loop: 90000 }, roh } = {}) {
  const ordner = path.join(d.module, id, 'audio');
  fs.mkdirSync(ordner, { recursive: true });
  const liste = [];
  let n = 0;
  for (const [name, frames] of Object.entries(spuren)) {
    const sha = String(n++).repeat(64).slice(0, 64);
    const wav = path.join(ordner, `${sha}.wav`);
    if (roh) { fs.writeFileSync(wav, roh); } else {
      const f = new Float32Array(frames * 2);
      for (let i = 0; i < frames; i++) { f[2 * i] = i + n; f[2 * i + 1] = -i; }
      const tmp = path.join(d.root, `roh-${sha}.f32`);
      fs.writeFileSync(tmp, Buffer.from(f.buffer));
      schreibeWavAusF32(tmp, wav);
      fs.rmSync(tmp);
    }
    liste.push({ name, clips: [{ id: `c${n}`, art: 'audio', quelle: { sha256: sha, pfad_hinweis: `audio/${sha}.wav` } }] });
  }
  const j = { format: 1, id, gespeichert: '2026-11-16T10:00:00Z', herkunft, gruppen: [{ id: 'g1', name: 'Mod' }], spuren: liste, audio: [] };
  fs.writeFileSync(path.join(d.module, id, 'modul.json'), JSON.stringify(j));
}
function baum(p) {
  const aus = [];
  const geh = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const q = path.join(x, e.name); aus.push(path.relative(p, q)); if (e.isDirectory()) geh(q); } };
  geh(p);
  return aus.sort();
}
const MOD = '0123456789abcdef';

test('a grid cut of a 4-beat loop: 16 slices of 5625 frames, files in order, graph and panel valid', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, d);
  assert.deepEqual([s.bpm, s.beats, s.frames, s.grenzen.length, s.grenzen[1], s.methode], [128, 4, 90000, 17, 5625, 'raster']);
  assert.ok(SCHNITT_ID.test(s.id) && `smp-${s.id}`.length <= 32);
  assert.equal(s.guete.length, 16);
  assert.deepEqual(s.guete[0], { staerke: 0, raster_abstand_beats: 0 });   // A2: measured; this ramp loop has no hits
  const g = JSON.parse(fs.readFileSync(path.join(d.bk, `smp-${s.id}.json`), 'utf8'));
  assert.deepEqual(g.knoten.find((k) => k.art === 'sampler').grenzen, s.grenzen);
  assert.equal(g.stimmen, 4);
  assert.deepEqual(pruefePanel(normalisierePanel(geraetPanel(s)), `smp-${s.id}`, reglerBereiche(g)), []);
  assert.deepEqual(pruefePanel(JSON.parse(fs.readFileSync(path.join(d.bk, 'panels', `smp-${s.id}.json`), 'utf8')), `smp-${s.id}`, reglerBereiche(g)), []);
  assert.equal(fs.statSync(path.join(d.bk, 'samples', `smp-${s.id}.f32`)).size, 90000 * 8);
  const j = JSON.parse(fs.readFileSync(path.join(d.ordner, s.id, 'schnitt.json'), 'utf8'));
  assert.deepEqual(j, JSON.parse(JSON.stringify(s)));
  assert.deepEqual([j.schema, j.name, j.quelle], [1, 'l4', { art: 'loop', ref: 'l4' }]);
  const saved = process.env.CYPHERDJ_SAMPLER;
  process.env.CYPHERDJ_SAMPLER = d.ordner;
  try {
    const e = listeGraphen(d.bk).graphen.find((x) => x.name === `smp-${s.id}`);
    assert.deepEqual([e.art, e.kategorie, e.text], ['instrument', 'sampler', 'Slices of l4']);
    assert.equal(e.regler_namen['1'], 'Level');
    assert.equal(e.regler_namen['8'], 'Crush');
  } finally { if (saved === undefined) delete process.env.CYPHERDJ_SAMPLER; else process.env.CYPHERDJ_SAMPLER = saved; }
});

test('an instrument graph that is not a cut keeps its category entry; a cut graph without its cut file is "Sliced sample"', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, d);
  fs.rmSync(path.join(d.ordner, s.id, 'schnitt.json'));
  fs.writeFileSync(path.join(d.bk, 'andere.json'), JSON.stringify({ format: 'baukasten/2', name: 'andere', knoten: [{ id: 'n', art: 'note' }], kanten: [] }));
  const saved = process.env.CYPHERDJ_SAMPLER;
  process.env.CYPHERDJ_SAMPLER = d.ordner;
  try {
    const l = listeGraphen(d.bk).graphen;
    assert.deepEqual([l.find((x) => x.name === `smp-${s.id}`).kategorie, l.find((x) => x.name === `smp-${s.id}`).text], ['sampler', 'Sliced sample']);
    assert.equal(l.find((x) => x.name === 'andere').kategorie, undefined);
  } finally { if (saved === undefined) delete process.env.CYPHERDJ_SAMPLER; else process.env.CYPHERDJ_SAMPLER = saved; }
});

test('the store folder follows CYPHERDJ_SAMPLER; the id rule and the names of the other files', () => {
  const saved = process.env.CYPHERDJ_SAMPLER;
  process.env.CYPHERDJ_SAMPLER = '/x/y';
  try { assert.equal(samplerOrdner(), '/x/y'); } finally { if (saved === undefined) delete process.env.CYPHERDJ_SAMPLER; else process.env.CYPHERDJ_SAMPLER = saved; }
  assert.ok(SCHNITT_ID.test('a-1b2c') && SCHNITT_ID.test('x'.repeat(28)));
  assert.ok(!SCHNITT_ID.test('x'.repeat(29)) && !SCHNITT_ID.test('-ab') && !SCHNITT_ID.test('A') && !SCHNITT_ID.test('../x') && !SCHNITT_ID.test(''));
  assert.deepEqual([geraetName('l4-0a1b'), MAX_SCHNITT_FRAMES, RASTER_ZAHLEN], ['smp-l4-0a1b', 2880000, [4, 8, 16, 32, 64]]);
});

test('the id is a slug of the name (at most 23 characters) plus four hex digits and always fits the graph name rule', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  const q = { art: 'loop', ref: 'l4' };
  const a = legeSchnitt({ quelle: q, name: 'Ärger mit Ümlauten & Sonderzeichen, sehr sehr lang' }, d);
  assert.ok(/^[a-z0-9][a-z0-9-]{0,22}-[0-9a-f]{4}$/.test(a.id), a.id);
  const b = legeSchnitt({ quelle: q, name: '!!!' }, d);
  assert.ok(SCHNITT_ID.test(b.id) && /-[0-9a-f]{4}$/.test(b.id), b.id);
  assert.notEqual(a.id, b.id);
  for (const s of [a, b]) assert.ok(/^[a-z0-9_-]{1,32}$/.test(`smp-${s.id}`));
  assert.throws(() => legeSchnitt({ quelle: q, name: 'x'.repeat(61) }, d), (e) => e instanceof SchnittFehler && e.grund === 'argument_ungueltig');
  assert.throws(() => legeSchnitt({ quelle: q, name: '  ' }, d), (e) => e instanceof SchnittFehler && e.grund === 'argument_ungueltig');
});

for (const v of [100, -100, 0, 22500]) {
  test(`versatz_frames ${v} rotates the cut so frame 0 is the loop's beat 1 (review focus 1)`, () => {
    const d = neueDirs();
    schreibeLoop(d, 'l4', 4, v);
    const s = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, d);
    const roh = fs.readFileSync(path.join(d.bk, 'samples', `smp-${s.id}.f32`));
    const f = new Float32Array(roh.buffer, roh.byteOffset, roh.length / 4);
    const start = ((v % 90000) + 90000) % 90000;
    assert.equal(f[0], start);
    assert.equal(f[1], -start);
    assert.equal(f[2 * 5625], (start + 5625) % 90000);             // the start of slice 2 (index 1)
    assert.equal(f[2 * 89999], (start + 89999) % 90000);           // the last frame is the one before beat 1
    const q = ladeQuellAudio({ art: 'loop', ref: 'l4' }, d);
    assert.deepEqual([q.frames, q.bpm, q.beats, q.daten.length, q.name], [90000, 128, 4, 180000, 'l4']);
    assert.equal(q.daten[0], start);
  });
}

test('standardZahl and the explicit counts', () => {
  assert.deepEqual([1, 2, 4, 8, 16, 32, 6].map(standardZahl), [4, 8, 16, 32, 64, 64, 24]);
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  const q = { art: 'loop', ref: 'l4' };
  assert.throws(() => legeSchnitt({ quelle: q, optionen: { scheiben: 12 } }, d), (e) => e instanceof SchnittFehler && e.grund === 'argument_ungueltig');
  assert.throws(() => legeSchnitt({ quelle: q, optionen: { scheiben: '8' } }, d), (e) => e.grund === 'argument_ungueltig');
  for (const n of RASTER_ZAHLEN) {
    const s = legeSchnitt({ quelle: q, optionen: { scheiben: n } }, d);
    assert.equal(s.grenzen.length, n + 1);
    assert.equal(s.grenzen[0], 0);
    assert.equal(s.grenzen[n], 90000);
    assert.equal(s.guete.length, n);
  }
  assert.deepEqual(legeSchnitt({ quelle: q, optionen: { scheiben: 8 } }, d).grenzen.slice(0, 3), [0, 11250, 22500]);
});

test('the grid method rounds the bounds k * frames / count and keeps them strictly rising', () => {
  const r = SCHNITT_METHODEN.raster({ frames: 100001, beats: 4, daten: new Float32Array(0) }, { scheiben: 16 });
  assert.deepEqual(r.grenzen.slice(0, 4), [0, Math.round(100001 / 16), Math.round(200002 / 16), Math.round(300003 / 16)]);
  assert.equal(r.grenzen[16], 100001);
  assert.ok(r.grenzen.every((x, i) => i === 0 || x > r.grenzen[i - 1]));
  assert.equal(r.guete.length, 16);
  assert.deepEqual(Object.keys(SCHNITT_METHODEN), ['raster', 'anschlag', 'hand', 'ganz']);
});

test('spurBefehl: the original order, FIT on k2, out-of-range FIT is null', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, d);
  const { befehl, fit } = spurBefehl(s, { projektBpm: 128 });
  assert.deepEqual(befehl.noten.slice(0, 2), [{ beat: 0, laenge: 0.25, ton: 0, vel: 100 }, { beat: 0.25, laenge: 0.25, ton: 1, vel: 100 }]);
  assert.deepEqual([befehl.befehl, befehl.loop_beats, befehl.geraet.graph, fit], ['werkbank_spur_neu', 4, `smp-${s.id}`, 0.5]);
  assert.equal(befehl.noten.length, 16);
  assert.ok(befehl.noten.every((n, i) => n.ton === i && n.vel === 100));
  assert.deepEqual(befehl.geraet, { art: 'intern', name: 'bk', graph: `smp-${s.id}`, parameter: { k2: 0.5 } });
  assert.equal(befehl.name, 'l4');
  assert.equal(spurBefehl(s, { projektBpm: 128, name: 'Hits' }).befehl.name, 'Hits');
  const aus = spurBefehl(s, { projektBpm: 20 });
  assert.equal(aus.fit, null);
  assert.equal(aus.befehl.geraet.parameter.k2, undefined);
  assert.deepEqual(Object.keys(aus.befehl.geraet.parameter), []);
  for (const r of [0.25, 0.8, 1, 1.3, 4]) assert.ok(Math.abs(speedVon(fitWert(128 * r, 128)) - r) < 1e-9);
  assert.equal(fitWert(128 * 4.001, 128), null);
  assert.equal(fitWert(128 * 0.249, 128), null);
  assert.equal(fitWert(Number.NaN, 128), null);
  assert.equal(fitWert(128, 0), null);
  assert.deepEqual([fitWert(256, 128), fitWert(32, 128), speedVon(0), speedVon(0.5), speedVon(1)], [0.75, 0, 0.25, 1, 4]);
});

test('spurBefehl of a grid cut writes exact beats k * beats / n, not the beats of the rounded frame bounds; hits and hand cuts keep theirs', () => {
  const frames = 111663, n = 16;   // 6978.9 frames a slice: the bounds are rounded
  const grenzen = Array.from({ length: n + 1 }, (_, k) => Math.round(k * frames / n));
  const guete = grenzen.slice(0, n).map(() => ({ staerke: null, raster_abstand_beats: 0 }));
  const schnitt = (methode) => ({ schema: 1, id: 'x-0000', name: 'x', quelle: { art: 'loop', ref: 'x' }, bpm: 128, beats: 4, frames, methode, grenzen, guete, erstellt: 'x' });
  // the rounded bounds do put hits in front of their step (what this rule undoes)
  assert.ok(grenzen.slice(0, n).some((g, k) => g * 4 / frames < k * 0.25 - 1e-9));
  const raster = spurBefehl(schnitt('raster'), { projektBpm: 128 }).befehl.noten;
  assert.deepEqual(raster.map((x) => x.beat), Array.from({ length: n }, (_, k) => k * 0.25));
  assert.ok(raster.every((x) => x.laenge === 0.25));
  assert.ok(raster.every((x, k) => x.ton === k && x.vel === 100));
  for (const methode of ['anschlag', 'hand']) {
    const noten = spurBefehl(schnitt(methode), { projektBpm: 128 }).befehl.noten;
    assert.deepEqual(noten.map((x) => x.beat), grenzen.slice(0, n).map((g) => g * 4 / frames), `${methode}: not quantised`);
    assert.ok(noten.some((x, k) => Math.abs(x.beat - k * 0.25) > 1e-6));
  }
  // a library loop of 8 beats cut in 64 (2812.5 frames a slice)
  const f8 = 180000, g64 = Array.from({ length: 65 }, (_, k) => Math.round(k * f8 / 64));
  const n64 = spurBefehl({ ...schnitt('raster'), beats: 8, frames: f8, grenzen: g64, guete: g64.slice(0, 64).map(() => ({ staerke: null, raster_abstand_beats: 0 })) }, { projektBpm: 128 }).befehl.noten;
  assert.deepEqual(n64.map((x) => x.beat), Array.from({ length: 64 }, (_, k) => k * 0.125));
  assert.ok(n64.every((x) => x.laenge === 0.125));
});

test('spurBefehl keeps a non-grid slice start unquantised and the end of the last slice on the loop length', () => {
  const s = { schema: 1, id: 'x-0000', name: 'x', quelle: { art: 'loop', ref: 'x' }, bpm: 128, beats: 4, frames: 90000, methode: 'hand',
    grenzen: [0, 1000, 30000, 90000], guete: [{ staerke: null, raster_abstand_beats: 0 }, { staerke: null, raster_abstand_beats: 0 }, { staerke: null, raster_abstand_beats: 0 }], erstellt: 'x' };
  const { befehl } = spurBefehl(s, { projektBpm: 128 });
  assert.deepEqual(befehl.noten.map((n) => n.beat), [0, 1000 * 4 / 90000, 30000 * 4 / 90000]);
  assert.equal(befehl.noten[2].beat + befehl.noten[2].laenge, 4);
  assert.deepEqual(befehl.noten.map((n) => n.ton), [0, 1, 2]);
});

test('the device graph: block values, knobs with their ranges, gain chain, valid edges (D1 to D3)', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, d);
  const g = geraetGraph(s);
  assert.deepEqual([g.format, g.name, g.stimmen], ['baukasten/2', `smp-${s.id}`, 4]);
  assert.deepEqual(Object.keys(g).sort(), ['format', 'kanten', 'knoten', 'name', 'regler_namen', 'stimmen']);
  const smp = g.knoten.find((k) => k.art === 'sampler');
  assert.deepEqual([smp.datei, smp.noten_wahl, smp.schleife, smp.scheiben], [`smp-${s.id}.f32`, 1, 0, undefined]);
  assert.deepEqual(g.regler_namen, { 1: 'Level', 2: 'Speed', 3: 'Pitch', 4: 'Hold', 5: 'Release', 6: 'Cutoff', 7: 'Reso', 8: 'Crush' });
  const b = reglerBereiche(g);
  assert.deepEqual(b['1'], { min: 0, max: 2, log: false, mitte: 1, vorgabe: 0.5 });
  assert.deepEqual(b['2'], { min: 0.25, max: 4, log: true, mitte: 1, vorgabe: 0.5 });
  assert.deepEqual(b['3'], { min: -12, max: 12, log: false, vorgabe: 0.5 });
  assert.deepEqual(b['4'], { min: 0, max: 1, log: false, vorgabe: 0 });
  assert.deepEqual(b['5'], { min: 1, max: 2000, log: true, vorgabe: 0.3 });
  assert.deepEqual(b['6'], { min: 40, max: 20000, log: true, vorgabe: 1 });
  assert.deepEqual(b['7'], { min: 0, max: 1, log: false, vorgabe: 0 });
  assert.deepEqual(b['8'], { min: 24, max: 4, log: false, vorgabe: 0 });
  assert.deepEqual(Object.keys(b), ['1', '2', '3', '4', '5', '6', '7', '8']);
  // every edge joins existing nodes; every sampler input is fed as D3 says
  const ids = new Set(g.knoten.map((k) => k.id));
  assert.equal(ids.size, g.knoten.length);
  for (const e of g.kanten) { assert.ok(ids.has(e.von.split('.')[0]), e.von); assert.ok(ids.has(e.nach.split('.')[0]), e.nach); }
  const quelleVon = (nach) => g.kanten.filter((e) => e.nach === nach).map((e) => e.von);
  const reglerId = (nr) => g.knoten.find((k) => k.art === 'regler' && k.nr === nr).id;
  assert.deepEqual(quelleVon(`${smp.id}.hz`), ['note.hz']);
  assert.deepEqual(quelleVon(`${smp.id}.trig`), ['note.trig']);
  assert.deepEqual(quelleVon(`${smp.id}.tempo`), [`${reglerId(2)}.aus`]);
  assert.deepEqual(quelleVon(`${smp.id}.halb`), [`${reglerId(3)}.aus`]);
  assert.deepEqual(quelleVon(`${smp.id}.ausklang`), [`${reglerId(5)}.aus`]);
  const gate = g.knoten.find((k) => k.id === quelleVon(`${smp.id}.gate`)[0].split('.')[0]);
  assert.equal(gate.art, 'add');
  assert.deepEqual(g.kanten.filter((e) => e.nach.startsWith(`${gate.id}.`)).map((e) => e.von).sort(), ['note.gate', `${reglerId(4)}.aus`].sort());
  // per side: sampler -> krume (bits from Crush, 48000 Hz) -> svf (2 poles, Cutoff, Reso) -> gain
  const knotenVon = (nach) => g.knoten.find((k) => k.id === quelleVon(nach)[0].split('.')[0]);
  for (const seite of ['l', 'r']) {
    const kr = knotenVon(`${g.knoten.filter((k) => k.art === 'svf').find((f) => quelleVon(`${knotenVon(`${f.id}.x`).id}.x`)[0] === `${smp.id}.${seite}`).id}.x`);
    assert.equal(kr.art, 'krume');
    assert.equal(kr.rate, 48000);
    assert.deepEqual(quelleVon(`${kr.id}.bits`), [`${reglerId(8)}.aus`]);
  }
  const svfs = g.knoten.filter((k) => k.art === 'svf');
  assert.equal(svfs.length, 2);
  for (const f of svfs) {
    assert.equal(f.pole, 2);
    assert.deepEqual(quelleVon(`${f.id}.cutoff`), [`${reglerId(6)}.aus`]);
    assert.deepEqual(quelleVon(`${f.id}.reso`), [`${reglerId(7)}.aus`]);
  }
  const aus = g.knoten.find((k) => k.art === 'ausgang');
  assert.equal(quelleVon(`${aus.id}.l`).length, 1);
  assert.equal(quelleVon(`${aus.id}.r`).length, 1);
  // gain = vel * 1.27 * Level: vel 100 (100/127 on the wire) at Level 1 is unity
  const gain = g.knoten.find((k) => k.id === g.kanten.find((e) => e.nach === `${g.knoten.find((n) => n.id === quelleVon(`${aus.id}.l`)[0].split('.')[0]).id}.b`).von.split('.')[0]);
  assert.equal(gain.art, 'mul');
  assert.ok(quelleVon(`${gain.id}.b`).includes(`${reglerId(1)}.aus`));
  const velMul = g.knoten.find((k) => k.id === quelleVon(`${gain.id}.a`)[0].split('.')[0]);
  assert.deepEqual([velMul.art, velMul.b, quelleVon(`${velMul.id}.a`)], ['mul', 1.27, ['note.vel']]);
  assert.ok(Math.abs(100 / 127 * 1.27 - 1) < 1e-12);
});

test('the slice device latches Speed and Pitch only', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, d);
  const g = geraetGraph(s);
  assert.deepEqual(g.knoten.filter((k) => k.art === 'regler' && k.rastet === 1).map((k) => k.nr), [2, 3]);
  // the other six knobs carry no `rastet` key at all (graphs without it stay bit-equal in the engine)
  assert.deepEqual(g.knoten.filter((k) => k.art === 'regler' && !('rastet' in k)).map((k) => k.nr), [1, 4, 5, 6, 7, 8]);
  // the graph on disk says the same
  const text = JSON.parse(fs.readFileSync(path.join(d.bk, `smp-${s.id}.json`), 'utf8'));
  assert.deepEqual(text.knoten.filter((k) => k.art === 'regler' && k.rastet === 1).map((k) => [k.nr, k.id]), [[2, 'spd'], [3, 'pit']]);
});

test('the panel: one section SLICES with the eight knobs bound k1..k8, title with the cut name', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, d);
  const p = geraetPanel(s);
  assert.deepEqual([p.format, p.geraet, p.title], ['cypherdj-panel/2', { art: 'bk', graph: `smp-${s.id}` }, 'Slices · l4']);
  assert.equal(p.sections.length, 1);
  assert.deepEqual([p.sections[0].id, p.sections[0].title], ['slices', 'SLICES']);
  assert.deepEqual(p.sections[0].controls.map((c) => c.bind.param), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
  assert.deepEqual(p.sections[0].controls.map((c) => c.label), ['Level', 'Speed', 'Pitch', 'Hold', 'Release', 'Cutoff', 'Reso', 'Crush']);
  assert.deepEqual(p.sections[0].controls.map((c) => c.default), [0.5, 0.5, 0.5, 0, 0.3, 1, 0, 0]);
  // a long cut name does not break the 40-character panel title
  const lang = { ...s, name: 'n'.repeat(60) };
  const pl = geraetPanel(lang);
  assert.ok(pl.title.length <= 40 && pl.title.startsWith('Slices · n'));
  assert.deepEqual(pruefePanel(pl, `smp-${s.id}`, reglerBereiche(geraetGraph(s))), []);
});

test('refusals write nothing (zu_lang, kein_raster, format_falsch, quelle_unbekannt, methode_unbekannt)', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  schreibeModul(d, MOD, { herkunft: { titel: 'T', laenge_beats: 4, bpm: 128 } });
  const gross = 'aaaaaaaaaaaaaaaa';
  schreibeModul(d, gross, { herkunft: { titel: 'Gross', laenge_beats: 64, bpm: 64 }, spuren: { Loop: MAX_SCHNITT_FRAMES + 1 } });
  const ohne = 'bbbbbbbbbbbbbbbb', krumm = 'cccccccccccccccc', hoch = 'dddddddddddddddd', langsam = 'eeeeeeeeeeeeeeee', sechzehn = 'ffffffffffffffff';
  schreibeModul(d, ohne, { herkunft: { titel: 'Ohne', bpm: 128 } });
  schreibeModul(d, krumm, { herkunft: { titel: 'Krumm', laenge_beats: 4.1, bpm: 128 } });
  schreibeModul(d, hoch, { herkunft: { titel: 'Hoch', laenge_beats: 65, bpm: 128 }, spuren: { Loop: 100000 } });
  schreibeModul(d, langsam, { herkunft: { titel: 'Langsam', laenge_beats: 4, bpm: 28 } });   // 4 beats in 90000 frames = 128 BPM: fine
  fs.rmSync(path.join(d.module, langsam), { recursive: true });
  schreibeModul(d, langsam, { herkunft: { titel: 'Langsam', laenge_beats: 4, bpm: 28 }, spuren: { Loop: 400000 } });   // 4 beats in 400000 frames = 28.8 BPM
  // a 16-bit PCM WAV
  const k = Buffer.alloc(44);
  k.write('RIFF', 0); k.writeUInt32LE(36 + 400, 4); k.write('WAVEfmt ', 8); k.writeUInt32LE(16, 16); k.writeUInt16LE(1, 20); k.writeUInt16LE(2, 22);
  k.writeUInt32LE(48000, 24); k.writeUInt32LE(192000, 28); k.writeUInt16LE(4, 32); k.writeUInt16LE(16, 34); k.write('data', 36); k.writeUInt32LE(400, 40);
  schreibeModul(d, sechzehn, { herkunft: { titel: 'Alt', laenge_beats: 4, bpm: 128 }, roh: Buffer.concat([k, Buffer.alloc(400)]) });
  const vorher = baum(d.root);
  const fall = (quelle, grund, extra = {}) => {
    assert.throws(() => legeSchnitt({ quelle, ...extra }, d), (e) => e instanceof SchnittFehler && e.grund === grund && typeof e.text === 'string' && e.text.length > 0 && Number.isInteger(e.code), `${grund} ${JSON.stringify(quelle)}`);
    assert.deepEqual(baum(d.root), vorher, `${grund}: nothing written`);
  };
  fall({ art: 'modul', ref: gross }, 'zu_lang');
  fall({ art: 'modul', ref: ohne }, 'kein_raster');
  fall({ art: 'modul', ref: krumm }, 'kein_raster');
  fall({ art: 'modul', ref: hoch }, 'kein_raster');
  fall({ art: 'modul', ref: langsam }, 'kein_raster');
  fall({ art: 'modul', ref: sechzehn }, 'format_falsch');
  fall({ art: 'datei', ref: '/etc/passwd' }, 'quelle_unbekannt');
  fall({ art: 'loop', ref: 'gibt-es-nicht' }, 'quelle_unbekannt');
  fall({ art: 'loop', ref: '../l4' }, 'quelle_unbekannt');
  fall({ art: 'modul', ref: 'ffffffffffffff00' }, 'quelle_unbekannt');
  fall({ art: 'modul', ref: MOD, stem: 'drums' }, 'quelle_unbekannt');   // no Drums track in this module
  fall({ art: 'modul', ref: MOD, stem: 'kazoo' }, 'argument_ungueltig');
  fall({ art: 'wellen', ref: 'x' }, 'argument_ungueltig');
  fall({ art: 'loop', ref: 'l4' }, 'methode_unbekannt', { methode: '__proto__' });
  fall({ art: 'loop', ref: 'l4' }, 'argument_ungueltig', { optionen: { scheiben: 3 } });
});

test('a module cut: bpm comes from the frames, not from herkunft.bpm (review focus 2); stems; name; tonart', () => {
  const d = neueDirs();
  schreibeModul(d, MOD, { herkunft: { titel: 'Pure & Simple', laenge_beats: 4, bpm: 127, basis_bpm: 128, tonart: '4A' }, spuren: { Loop: 90000, 'Drums original': 90000, 'Bass original': 90000 } });
  const s = legeSchnitt({ quelle: { art: 'modul', ref: MOD } }, d);
  assert.deepEqual([s.bpm, s.beats, s.frames, s.tonart, s.name], [128, 4, 90000, '4A', 'Pure & Simple · Loop']);
  assert.deepEqual(s.quelle, { art: 'modul', ref: MOD });
  const drums = legeSchnitt({ quelle: { art: 'modul', ref: MOD, stem: 'drums' } }, d);
  assert.equal(drums.name, 'Pure & Simple · Drums');
  assert.deepEqual(drums.quelle, { art: 'modul', ref: MOD, stem: 'drums' });
  const q = ladeQuellAudio({ art: 'modul', ref: MOD, stem: 'bass' }, d);
  assert.deepEqual([q.frames, q.bpm, q.beats, q.tonart, q.daten.length], [90000, 128, 4, '4A', 180000]);
  const qloop = ladeQuellAudio({ art: 'modul', ref: MOD }, d);
  assert.notEqual(q.daten[0], qloop.daten[0]);                   // the tracks hold different audio
  assert.ok(schnittText(drums).split('\n')[0].includes(`source modul ${MOD} drums`));
  // a module whose audio is not at 128 BPM: 6 beats in 100000 frames
  const m2 = '1111111111111111';
  schreibeModul(d, m2, { herkunft: { titel: 'Odd', laenge_beats: 6, bpm: 130 }, spuren: { Loop: 100000 } });
  const o = ladeQuellAudio({ art: 'modul', ref: m2 }, d);
  assert.ok(Math.abs(o.bpm - 6 * 2880000 / 100000) < 1e-9);
  assert.equal(standardZahl(o.beats), 24);
  const s2 = legeSchnitt({ quelle: { art: 'modul', ref: m2 } }, d);
  assert.equal(s2.grenzen.length, 25);
  assert.equal(s2.grenzen[24], 100000);
});

test('store: read, list newest first, delete removes the four files; bad ids are unknown', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  const a = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' }, name: 'erster' }, d);
  const b = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' }, name: 'zweiter' }, d);
  const setze = (s, t) => { const f = path.join(d.ordner, s.id, 'schnitt.json'); fs.writeFileSync(f, JSON.stringify({ ...s, erstellt: t })); };
  setze(a, '2026-11-16T10:00:00.000Z');
  setze(b, '2026-11-16T11:00:00.000Z');
  assert.deepEqual(liesSchnitt(a.id, d)?.name, 'erster');
  assert.deepEqual(listeSchnitte(d).map((s) => s.name), ['zweiter', 'erster']);
  assert.equal(liesSchnitt('gibt-es-nicht', d), null);
  assert.equal(liesSchnitt('../x', d), null);
  assert.equal(liesSchnitt('', d), null);
  fs.mkdirSync(path.join(d.ordner, 'kaputt-0000'));
  fs.writeFileSync(path.join(d.ordner, 'kaputt-0000', 'schnitt.json'), '{ nein');
  assert.deepEqual(listeSchnitte(d).map((s) => s.name), ['zweiter', 'erster']);   // an unreadable cut is left out
  loescheSchnitt(a.id, d);
  assert.equal(liesSchnitt(a.id, d), null);
  assert.ok(!fs.existsSync(path.join(d.ordner, a.id)));
  assert.ok(!fs.existsSync(path.join(d.bk, `smp-${a.id}.json`)));
  assert.ok(!fs.existsSync(path.join(d.bk, 'panels', `smp-${a.id}.json`)));
  assert.ok(!fs.existsSync(path.join(d.bk, 'samples', `smp-${a.id}.f32`)));
  assert.ok(fs.existsSync(path.join(d.bk, `smp-${b.id}.json`)));            // the other cut is untouched
  assert.throws(() => loescheSchnitt(a.id, d), (e) => e instanceof SchnittFehler && e.grund === 'schnitt_unbekannt');
  assert.throws(() => loescheSchnitt('../..', d), (e) => e instanceof SchnittFehler && e.grund === 'schnitt_unbekannt');
});

test('a write that fails midway leaves no file and no cut folder behind (the cut exists only with its schnitt.json)', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  fs.writeFileSync(path.join(d.bk, 'panels'), 'a file where the panel folder should be');
  assert.throws(() => legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, d));
  assert.deepEqual(baum(d.ordner), []);
  assert.deepEqual(baum(d.bk).filter((p) => p.includes('smp-')), []);
  fs.rmSync(path.join(d.bk, 'panels'));
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, d);          // and the same call works afterwards
  assert.ok(fs.existsSync(path.join(d.ordner, s.id, 'schnitt.json')));
  assert.deepEqual(baum(d.bk).filter((p) => p.includes('.tmp') || p.endsWith('.neu')), []);
});

test('schnittText', () => {
  const d = neueDirs();
  schreibeLoop(d, 'l4', 4);
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, d);
  const z = schnittText(s).split('\n');
  assert.ok(z[0].startsWith(`cut ${s.id} "l4"`), z[0]);
  assert.equal(z[0], `cut ${s.id} "l4"  source loop l4  128 BPM  4 beats  method raster  16 slices`);
  assert.deepEqual(z[1].split(/\s+/), ['slice', 'start', 'length', 'strength', 'grid']);
  assert.equal(z.length, 2 + 16);
  assert.deepEqual(z[3].split(/\s+/), ['2', '0.250', '0.250', '0.00', '0.000']);
  assert.deepEqual(z[2].split(/\s+/), ['1', '0.000', '0.250', '0.00', '0.000']);
  const mit = { ...s, quelle: { art: 'modul', ref: MOD, stem: 'bass' }, guete: s.guete.map((g, i) => (i === 1 ? { staerke: 0.5, raster_abstand_beats: -0.0125 } : g)) };
  const zz = schnittText(mit).split('\n');
  assert.ok(zz[0].includes(`source modul ${MOD} bass`));
  assert.deepEqual(zz[3].split(/\s+/), ['2', '0.250', '0.250', '0.50', '-0.013']);   // toFixed(3) of -0.0125
});

test('leseWavF32: frames of a float WAV; a truncated or odd file is format_falsch, a missing one quelle_unbekannt', () => {
  const d = neueDirs();
  const roh = path.join(d.root, 'r.f32'), wav = path.join(d.root, 'r.wav');
  const f = new Float32Array(2000);
  for (let i = 0; i < 2000; i++) f[i] = i / 2000;
  fs.writeFileSync(roh, Buffer.from(f.buffer));
  schreibeWavAusF32(roh, wav);
  const w = leseWavF32(wav);
  assert.equal(w.frames, 1000);
  assert.deepEqual(Array.from(w.daten.slice(0, 4)), Array.from(f.slice(0, 4)));
  assert.equal(w.daten.length, 2000);
  const ganz = fs.readFileSync(wav);
  fs.writeFileSync(path.join(d.root, 'abgeschnitten.wav'), ganz.subarray(0, ganz.length - 100));
  assert.throws(() => leseWavF32(path.join(d.root, 'abgeschnitten.wav')), (e) => e instanceof SchnittFehler && e.grund === 'format_falsch');
  fs.writeFileSync(path.join(d.root, 'text.wav'), 'kein wav');
  assert.throws(() => leseWavF32(path.join(d.root, 'text.wav')), (e) => e.grund === 'format_falsch');
  assert.throws(() => leseWavF32(path.join(d.root, 'fehlt.wav')), (e) => e.grund === 'quelle_unbekannt');
  assert.throws(() => leseWavF32(wav, 999), (e) => e.grund === 'zu_lang');
  assert.equal(leseWavF32(wav, 1000).frames, 1000);
});

// ---- Sampler A2 task 1: hits with strength, methods anschlag and hand, quality for every method ----

// a loop of `beats` beats made of noise bursts (decaying noise, exp(-t / 2 ms), 40 ms long, the same on both channels); bursts = [frame, amplitude]
function burstDaten(beats, bursts) {
  const frames = beats * 22500, f = new Float32Array(frames * 2);
  let z = 12345;
  const rausch = () => { z = (Math.imul(z, 1664525) + 1013904223) >>> 0; return z / 2 ** 31 - 1; };
  for (const [start, amp] of bursts) {
    for (let t = 0; t < 1920 && start + t < frames; t++) { const v = rausch() * amp * Math.exp(-t / 96); f[2 * (start + t)] += v; f[2 * (start + t) + 1] += v; }
  }
  return f;
}
function schreibeDaten(d, name, beats, daten) {
  fs.mkdirSync(path.join(d.loops, name));
  fs.writeFileSync(path.join(d.loops, name, 'loop.f32'), Buffer.from(daten.buffer));
  fs.writeFileSync(path.join(d.loops, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames: beats * 22500, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}
const BRUCH = [[0, 0.8], [11000, 0.05], [22500, 0.8], [30100, 0.4], [45000, 0.8], [61000, 0.2], [75500, 0.8]];
const bruch = (d) => schreibeDaten(d, 'bruch', 4, burstDaten(4, BRUCH));

test('findeAnschlaege: the frames of findeTransienten, strength in 0..1, louder is stronger', () => {
  const daten = burstDaten(4, BRUCH);
  const a = findeAnschlaege(daten);
  assert.deepEqual(a.map((x) => x.frame), findeTransienten(daten));
  assert.ok(a.length >= 6);
  assert.ok(a.every((x) => x.staerke >= 0 && x.staerke <= 1 && Math.round(x.staerke * 1000) === x.staerke * 1000));
  // the detector needs 8 blocks of run-in, so the burst at frame 0 is not a hit; the first hit is the quiet one at 11000
  const bei = (f) => a.find((x) => Math.abs(x.frame - f) <= 64);
  assert.ok(!a.some((x) => x.frame < 512));
  assert.ok(bei(22500).staerke > bei(11000).staerke + 0.3, `${bei(22500).staerke} vs ${bei(11000).staerke}`);
  assert.ok(bei(22500).staerke > bei(30100).staerke && bei(30100).staerke > bei(61000).staerke);
  assert.deepEqual(findeAnschlaege(daten, 48000, { sprungDb: 5 }), a);
  assert.ok(findeAnschlaege(daten, 48000, { sprungDb: 40 }).length <= a.length);
  assert.deepEqual(findeAnschlaege(new Float32Array(96000 * 2)), []);
  assert.deepEqual([sprungDbVon(0), sprungDbVon(0.5), sprungDbVon(1), EMPFINDLICHKEIT_VORGABE, MAX_SCHEIBEN, MESS_FENSTER_S, RASTER_NAH_BEATS], [9, 5, 1, 0.5, 64, 0.01, 0.01]);
});

test('a cut at the hits: bounds on the bursts, the ends, quality, original order', () => {
  const d = neueDirs();
  bruch(d);
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'bruch' }, methode: 'anschlag' }, d);
  assert.equal(s.grenzen.length, 8);   // 0, six hits, 90000 (the burst at 0 is no hit: the detector needs a run-in)
  assert.equal(s.grenzen[0], 0);
  assert.equal(s.grenzen[7], 90000);
  for (const [i, f] of [11000, 22500, 30100, 45000, 61000, 75500].entries()) assert.ok(Math.abs(s.grenzen[i + 1] - f) <= 64, `${i}: ${s.grenzen[i + 1]}`);
  assert.equal(s.guete.length, 7);
  assert.equal(s.guete[2].raster_abstand_beats, 0);   // 22500 is beat 1: under RASTER_NAH_BEATS
  assert.ok(Math.abs(s.guete[3].raster_abstand_beats - (30100 / 22500 - 1.25)) < 0.003, String(s.guete[3].raster_abstand_beats));
  assert.ok(s.guete[2].staerke > 0.5 && s.guete[1].staerke > 0 && s.guete[2].staerke > s.guete[1].staerke);
  assert.equal(s.guete[0].staerke, 0);   // nothing detected near frame 0
  assert.deepEqual([s.methode, s.empfindlichkeit, s.ursprung], ['anschlag', 0.5, s.grenzen]);
  assert.ok(s.treffer.length >= 6 && s.treffer.every((f, i) => i === 0 || f > s.treffer[i - 1]));
  assert.equal(s.geaendert, s.erstellt);
  assert.deepEqual(spurBefehl(s, { projektBpm: 128 }).befehl.noten.map((n) => n.ton), [0, 1, 2, 3, 4, 5, 6]);
  const g = JSON.parse(fs.readFileSync(path.join(d.bk, `smp-${s.id}.json`), 'utf8'));
  assert.deepEqual(g.knoten.find((k) => k.art === 'sampler').grenzen, s.grenzen);
  const j = JSON.parse(fs.readFileSync(path.join(d.ordner, s.id, 'schnitt.json'), 'utf8'));
  assert.deepEqual([j.ursprung, j.treffer, j.empfindlichkeit, j.geaendert], [s.ursprung, s.treffer, 0.5, s.erstellt]);
  assert.ok(schnittText(s).split('\n')[0].endsWith('method anschlag 0.50  7 slices'), schnittText(s).split('\n')[0]);
  // sensitivity: a higher value never finds fewer hits; the value is kept and shown
  const hoch = legeSchnitt({ quelle: { art: 'loop', ref: 'bruch' }, methode: 'anschlag', optionen: { empfindlichkeit: 1 } }, d);
  const tief = legeSchnitt({ quelle: { art: 'loop', ref: 'bruch' }, methode: 'anschlag', optionen: { empfindlichkeit: 0 } }, d);
  assert.ok(hoch.grenzen.length >= s.grenzen.length && s.grenzen.length >= tief.grenzen.length);
  assert.deepEqual([hoch.empfindlichkeit, tief.empfindlichkeit], [1, 0]);
  assert.ok(schnittText(hoch).split('\n')[0].includes('method anschlag 1.00'));
});

test('a hit within 4 frames of the end merges into it, a hit further in keeps its bound', () => {
  // 16 beats = 360000 frames, a multiple of the 64-frame block, so a click on frame 359998 is seen by the detector (single-sample clicks keep their frame)
  const frames = 360000, daten = new Float32Array(frames * 2);
  for (const f of [100000, 359998]) { daten[2 * f] = 0.8; daten[2 * f + 1] = 0.8; }
  const r = SCHNITT_METHODEN.anschlag({ frames, beats: 16, daten }, {});
  assert.deepEqual(r.treffer, [100000, 359998]);
  assert.deepEqual(r.grenzen, [0, 100000, 360000]);   // 359998 is 2 frames from the end: merged
  assert.equal(r.guete.length, 2);
  // the same click 6 frames from the end keeps its own bound
  const d2 = new Float32Array(frames * 2);
  for (const f of [100000, 359994]) { d2[2 * f] = 0.8; d2[2 * f + 1] = 0.8; }
  assert.deepEqual(SCHNITT_METHODEN.anschlag({ frames, beats: 16, daten: d2 }, {}).grenzen, [0, 100000, 359994, 360000]);
  // only an end hit: nothing interior, so no cut
  const d3 = new Float32Array(frames * 2);
  d3[2 * 359998] = 0.8; d3[2 * 359998 + 1] = 0.8;
  assert.throws(() => SCHNITT_METHODEN.anschlag({ frames, beats: 16, daten: d3 }, {}), (e) => e instanceof SchnittFehler && e.grund === 'keine_anschlaege');
});

test('more than 63 hits keep the 63 strongest (review focus 1)', () => {
  const d = neueDirs();
  const bursts = Array.from({ length: 96 }, (_, i) => [i * 1875, 0.8 * 10 ** (-(i % 12) * 2 / 20)]);
  const daten = burstDaten(8, bursts);
  schreibeDaten(d, 'dicht', 8, daten);
  const alle = findeAnschlaege(daten, 48000, { sprungDb: 5 });
  assert.ok(alle.length > 63, `the test needs more than 63 hits, found ${alle.length}`);
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'dicht' }, methode: 'anschlag' }, d);
  const erwartet = [...alle].filter((x) => x.frame > 4).sort((p, q) => q.staerke - p.staerke || p.frame - q.frame).slice(0, 63).map((x) => x.frame).sort((p, q) => p - q);
  assert.deepEqual(s.grenzen, [0, ...erwartet, 180000]);
  assert.equal(s.grenzen.length, 65);
  assert.equal(s.guete.length, 64);
  assert.equal(s.treffer.length, alle.length);   // every detected hit serves snapping, also the thinned ones
  const noten = spurBefehl(s, { projektBpm: 128 }).befehl.noten;
  assert.deepEqual(noten.map((n) => n.ton), Array.from({ length: 64 }, (_, i) => i));   // the original order: 64 slices from frame 0 to the end
  assert.ok(s.grenzen.every((g, i) => i === 0 || g > s.grenzen[i - 1]));
});

test('grid cuts measure their markers; hand takes given bounds', () => {
  const d = neueDirs();
  bruch(d);
  const r = legeSchnitt({ quelle: { art: 'loop', ref: 'bruch' }, optionen: { scheiben: 16 } }, d);
  assert.equal(r.methode, 'raster');
  assert.ok(r.guete[4].staerke >= 0.3, String(r.guete[4].staerke));   // marker 22500
  assert.equal(r.guete[1].staerke, 0);                                  // 5625: silence
  assert.ok(r.guete.every((g) => g.raster_abstand_beats === 0));
  assert.deepEqual([r.ursprung, r.empfindlichkeit], [r.grenzen, undefined]);
  assert.ok(r.treffer.length >= 6);
  // a grid finer than 1/16 is measured against itself: a grid marker has 0
  const fein = legeSchnitt({ quelle: { art: 'loop', ref: 'bruch' }, optionen: { scheiben: 64 } }, d);
  assert.ok(fein.guete.every((g) => g.raster_abstand_beats === 0));
  const h = legeSchnitt({ quelle: { art: 'loop', ref: 'bruch' }, methode: 'hand', optionen: { grenzen: [0, 30000, 90000] } }, d);
  assert.deepEqual([h.methode, h.grenzen, h.ursprung, h.guete.length, h.empfindlichkeit], ['hand', [0, 30000, 90000], [0, 30000, 90000], 2, undefined]);
  assert.ok(Math.abs(h.guete[1].raster_abstand_beats - 0.0833333) < 1e-6, String(h.guete[1].raster_abstand_beats));
  assert.equal(h.guete[0].raster_abstand_beats, 0);
  assert.ok(h.guete[1].staerke >= 0.3, String(h.guete[1].staerke));   // a hit at 30100 is 100 frames from the marker
  const g = JSON.parse(fs.readFileSync(path.join(d.bk, `smp-${h.id}.json`), 'utf8'));
  assert.deepEqual(g.knoten.find((k) => k.art === 'sampler').grenzen, [0, 30000, 90000]);
  assert.ok(schnittText(h).split('\n')[0].includes('method hand  2 slices'));
});

test('guete: the nearest hit inside the window, the signed rounded distance, under 0.01 beat is 0', () => {
  const a = { frames: 90000, beats: 4 };
  const t = [{ frame: 1000, staerke: 0.4 }, { frame: 1300, staerke: 0.9 }, { frame: 40000, staerke: 0.7 }];
  const g = guete(a, [0, 100, 1100, 1200, 1700, 40400, 44000, 90000], t);
  assert.equal(g.length, 7);
  assert.deepEqual(g.map((x) => x.staerke), [0, 0, 0.4, 0.9, 0.9, 0.7, 0]);   // 1700 is 400 from 1300; 100 is 900 from 1000; 44000 is 4000 from 40000
  assert.deepEqual(g.map((x) => x.raster_abstand_beats), [0, 0, 0.048889, 0.053333, 0.075556, 0.045556, -0.044444]);
  assert.equal(g[1].raster_abstand_beats, 0);   // frame 100 is 0.0044 beat from beat 0
  assert.equal(guete(a, [0, 40480, 90000], [{ frame: 40000, staerke: 0.5 }])[1].staerke, 0.5);   // exactly 480 frames away is inside
  assert.equal(guete(a, [0, 40481, 90000], [{ frame: 40000, staerke: 0.5 }])[1].staerke, 0);
  assert.equal(guete(a, [0, 5625, 90000], [], 0.25)[1].raster_abstand_beats, 0);
  assert.equal(guete(a, [0, 5625, 90000], [], 0.0625)[1].raster_abstand_beats, 0);
});

test('anschlag and hand refusals write nothing', () => {
  const d = neueDirs();
  schreibeDaten(d, 'still', 4, new Float32Array(90000 * 2));
  bruch(d);
  const vorher = baum(d.root);
  const fall = (quelle, grund, extra) => {
    assert.throws(() => legeSchnitt({ quelle, ...extra }, d), (e) => e instanceof SchnittFehler && e.grund === grund && e.text.length > 0, `${grund} ${JSON.stringify(extra)}`);
    assert.deepEqual(baum(d.root), vorher, `${grund}: nothing written`);
  };
  const still = { art: 'loop', ref: 'still' }, b = { art: 'loop', ref: 'bruch' };
  assert.throws(() => legeSchnitt({ quelle: still, methode: 'anschlag' }, d), (e) => e instanceof SchnittFehler && e.grund === 'keine_anschlaege' && e.code === 422
    && e.text === 'no hits found at sensitivity 0.50; raise it or cut by grid');
  fall(still, 'keine_anschlaege', { methode: 'anschlag' });
  fall(still, 'keine_anschlaege', { methode: 'anschlag', optionen: { empfindlichkeit: 1 } });
  for (const e of [1.5, -0.1, '0.5', Number.NaN, null]) fall(b, 'argument_ungueltig', { methode: 'anschlag', optionen: { empfindlichkeit: e } });
  for (const grenzen of [[0, 3, 90000], [5, 90000], [0, 89999], [0, 30000, 30000, 90000], [0, 50000, 40000, 90000], [0, 1.5, 90000], [0, '3', 90000], [90000], [],
    Array.from({ length: 66 }, (_, i) => i * 1000).map((x, i, all) => (i === all.length - 1 ? 90000 : x)), 'x', null]) {
    fall(b, 'argument_ungueltig', { methode: 'hand', optionen: { grenzen } });
  }
  fall(b, 'argument_ungueltig', { methode: 'hand' });
  assert.equal(legeSchnitt({ quelle: b, methode: 'hand', optionen: { grenzen: [0, 90000] } }, d).guete.length, 1);   // one slice is allowed by hand
  assert.equal(legeSchnitt({ quelle: b, methode: 'hand', optionen: { grenzen: Array.from({ length: 65 }, (_, i) => i * 1000).map((x, i) => (i === 64 ? 90000 : x)) } }, d).guete.length, 64);
});

test('graphenOrdner is not touched by this suite (every write went into temp folders)', () => {
  assert.ok(!wurzeln.some((r) => r === graphenOrdner()));
  assert.ok(wurzeln.length > 0 && wurzeln.every((r) => r.startsWith(os.tmpdir())));
});
