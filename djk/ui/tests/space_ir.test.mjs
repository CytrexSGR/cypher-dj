// Cypher Space: POST /sampler/space_ir writes a copy of the fx-space graph with the user's impulse response. Server with the kern stand-in; sample root, graph
// folder and sampler store are temp folders, never ~/.config. Needs ffmpeg and ffprobe (skipped with a message when they are absent).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';
import { raumTauschBefehle } from '../public/panel_kopf.js';
import { bereiteIrVor, raumText, spaceGraph, spacePanel, IR_NAME } from '../sampler/space_ir.ts';

const OHNE_FFMPEG = ['ffmpeg', 'ffprobe'].some((b) => spawnSync(b, ['-version']).status !== 0) ? 'ffmpeg/ffprobe are not installed' : false;
const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const BK = path.join(REPO, 'djk', 'instruments', 'modular_dsp');

/** 16 bit PCM WAV, mono or stereo: `stille` s of silence, then `s` s of decaying noise (a fixed generator, so every run is the same). */
function rauschWav(pfad, { s = 1, stille = 0.1, rate = 48000, kanaele = 1 } = {}) {
  const n = Math.round(s * rate), s0 = Math.round(stille * rate), bytes = (n + s0) * kanaele * 2;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(kanaele, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * kanaele * 2, 28); b.writeUInt16LE(kanaele * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(bytes, 40);
  let z = 12345;
  for (let i = 0; i < n + s0; i++) for (let c = 0; c < kanaele; c++) {
    z = (z * 1103515245 + 12345) >>> 0;
    const v = i < s0 ? 0 : Math.round(((z / 4294967296) * 2 - 1) * Math.exp(-4 * (i - s0) / rate) * (c === 0 ? 0.8 : 0.5) * 32767);
    b.writeInt16LE(v, 44 + (i * kanaele + c) * 2);
  }
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  fs.writeFileSync(pfad, b);
}

async function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'space-ir-'));
  const d = { root, loops: path.join(root, 'loops'), module: path.join(root, 'module'), sampler: path.join(root, 'sampler'), bk: path.join(root, 'bk'), lib: path.join(root, 'lib') };
  for (const p of Object.values(d)) if (p !== root) fs.mkdirSync(p);
  fs.mkdirSync(path.join(d.bk, 'panels'));
  fs.copyFileSync(path.join(BK, 'demos', 'fx-space.json'), path.join(d.bk, 'fx-space.json'));
  fs.copyFileSync(path.join(BK, 'paneele', 'fx-space.json'), path.join(d.bk, 'panels', 'fx-space.json'));
  fs.writeFileSync(path.join(d.sampler, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: d.lib }]));
  const alt = { bk: process.env.CYPHERDJ_BK_ORDNER, sampler: process.env.CYPHERDJ_SAMPLER };
  process.env.CYPHERDJ_BK_ORDNER = d.bk;
  process.env.CYPHERDJ_SAMPLER = d.sampler;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', alt.bk], ['CYPHERDJ_SAMPLER', alt.sampler]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  rauschWav(path.join(d.lib, 'Church Hall Long Name Of A Room.wav'), { s: 1, stille: 0.1, kanaele: 1 });
  rauschWav(path.join(d.lib, 'lang.wav'), { s: 3, stille: 0, kanaele: 2 });
  rauschWav(path.join(d.lib, 'kurz.wav'), { s: 30 / 48000, stille: 0 });
  fs.writeFileSync(path.join(d.lib, 'notiz.txt'), 'this is not audio\n');
  const s = await stapel(t, { loops: d.loops });
  s.optionen.modulOrdner = d.module;
  s.optionen.samplerOrdner = d.sampler;
  return { ...s, d };
}

// the page server also puts the factory files of the amiga device into the sample folder: only the impulse response files count here
const irDateien = (z) => fs.readdirSync(path.join(z.d.bk, 'samples')).filter((n) => n.startsWith('space-ir-'));
const energie = (datei) => {
  const f = new Float32Array(fs.readFileSync(datei).buffer.slice(0));
  const e = [0, 0];
  for (let i = 0; i < f.length / 2; i++) { e[0] += f[2 * i] ** 2; e[1] += f[2 * i + 1] ** 2; }
  return { frames: f.length / 2, e };
};

test('bereiteIrVor: leading silence cut, 2 s cap with a fade, 0.5 per side, short and silent files refused', () => {
  const roh = new Float32Array(2 * 120000);
  for (let i = 4800; i < 120000; i++) { roh[2 * i] = Math.sin(i * 0.1) * 0.3; roh[2 * i + 1] = i % 7 === 0 ? 0.2 : 0; }
  const ir = bereiteIrVor(roh);
  assert.equal(ir.length, 2 * 96000);                                      // 4800 frames of silence dropped, then cut to 2 s
  assert.ok(Math.abs(ir[2 * 95999]) < Math.abs(ir[2 * 80000]) * 0.01 + 1e-3, 'the end fades out');
  for (const c of [0, 1]) { let e = 0; for (let i = 0; i < 96000; i++) e += ir[2 * i + c] ** 2; assert.ok(Math.abs(e - 0.5) < 1e-3, `side ${c}: ${e}`); }
  const einseitig = new Float32Array(2 * 1000);
  for (let i = 0; i < 1000; i++) einseitig[2 * i] = Math.sin(i) * 0.5;
  const e1 = bereiteIrVor(einseitig);
  assert.deepEqual([...e1.slice(0, 20)].filter((_, i) => i % 2 === 0), [...e1.slice(0, 20)].filter((_, i) => i % 2 === 1), 'a silent side copies the other');
  assert.throws(() => bereiteIrVor(new Float32Array(2 * 63).fill(0.5)), (e) => e.code === 422 && e.grund === 'ir_zu_kurz');
  assert.throws(() => bereiteIrVor(new Float32Array(2 * 1000)), (e) => e.code === 422 && e.grund === 'format_falsch');
});

test('spaceGraph and spacePanel change only name, datei, graph and the room label', () => {
  const g = JSON.parse(fs.readFileSync(path.join(BK, 'demos', 'fx-space.json'), 'utf8'));
  const k = spaceGraph(g, 'space-ir-00000000.f32', 'space-abcdef');
  const a = JSON.parse(JSON.stringify(g)), b = JSON.parse(JSON.stringify(k));
  assert.equal(b.name, 'space-abcdef');
  assert.equal(b.knoten.find((x) => x.id === 'raum').datei, 'space-ir-00000000.f32');
  a.name = b.name; a.knoten.find((x) => x.id === 'raum').datei = b.knoten.find((x) => x.id === 'raum').datei;
  assert.deepEqual(b, a);
  assert.equal(g.knoten.find((x) => x.id === 'raum').datei, 'space-halle.f32', 'the base is not changed');
  assert.throws(() => spaceGraph({ knoten: [] }, 'x.f32', 'space-abcdef'));
  const p = spacePanel(JSON.parse(fs.readFileSync(path.join(BK, 'paneele', 'fx-space.json'), 'utf8')), 'space-abcdef', 'x'.repeat(50));
  assert.deepEqual([p.geraet.graph, p.geraet.art, p.title], ['space-abcdef', 'bk', 'Cypher Space']);
  assert.equal(p.sections[0].controls[0].text, `Room: ${'x'.repeat(30)}`);
  assert.equal(raumText('  Hall  '), 'Room: Hall');
});

test('POST /sampler/space_ir writes one graph, one panel, one .f32 and answers {graph, titel}', { skip: OHNE_FFMPEG }, async (t) => {
  const z = await aufbau(t);
  const rev0 = (await ruf(z.url, 'GET', '/proj/aktuell')).j?.projekt?.rev;
  const r = await ruf(z.url, 'POST', '/sampler/space_ir', { wurzel: 'Lib', rel: 'Church Hall Long Name Of A Room.wav' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.ok(IR_NAME.test(r.j.graph), r.j.graph);
  assert.equal(r.j.titel, 'Church Hall Long Name Of A Room'.slice(0, 30).trim());
  const graphen = fs.readdirSync(z.d.bk).filter((n) => n.endsWith('.json')).sort();
  assert.deepEqual(graphen, ['fx-space.json', `${r.j.graph}.json`].sort());
  assert.deepEqual(fs.readdirSync(path.join(z.d.bk, 'panels')).sort(), ['fx-space.json', `${r.j.graph}.json`].sort());
  const samples = irDateien(z);
  assert.equal(samples.length, 1);
  assert.match(samples[0], /^space-ir-[0-9a-f]{8}\.f32$/);
  const g = JSON.parse(fs.readFileSync(path.join(z.d.bk, `${r.j.graph}.json`), 'utf8')), basis = JSON.parse(fs.readFileSync(path.join(z.d.bk, 'fx-space.json'), 'utf8'));
  assert.equal(g.knoten.find((x) => x.id === 'raum').datei, samples[0]);
  g.name = basis.name; g.knoten.find((x) => x.id === 'raum').datei = basis.knoten.find((x) => x.id === 'raum').datei;
  assert.deepEqual(g, basis, 'the copy differs from fx-space only in name and the file of the node raum');
  const p = JSON.parse(fs.readFileSync(path.join(z.d.bk, 'panels', `${r.j.graph}.json`), 'utf8'));
  assert.deepEqual([p.geraet.graph, p.title, p.sections[0].controls[0].text], [r.j.graph, 'Cypher Space', `Room: ${r.j.titel}`]);
  const { frames, e } = energie(path.join(z.d.bk, 'samples', samples[0]));
  assert.ok(frames >= 47000 && frames <= 48000, `1 s of noise after the silence: ${frames} frames`);
  for (const x of e) assert.ok(Math.abs(x - 0.5) < 1e-3, `energy ${x}`);
  assert.equal((await ruf(z.url, 'GET', '/proj/aktuell')).j?.projekt?.rev, rev0, 'the route does not touch the project');
});

test('a file longer than 2 s is cut to 2 s; refusals: text file 422, too short 422, unknown file 404, bad arguments 400; nothing is left behind', { skip: OHNE_FFMPEG }, async (t) => {
  const z = await aufbau(t);
  let r = await ruf(z.url, 'POST', '/sampler/space_ir', { wurzel: 'Lib', rel: 'lang.wav' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(irDateien(z).length, 1);
  const f = path.join(z.d.bk, 'samples', irDateien(z)[0]);
  const { frames, e } = energie(f);
  assert.equal(frames, 96000);
  for (const x of e) assert.ok(Math.abs(x - 0.5) < 1e-3, `energy ${x}`);
  const vorher = [fs.readdirSync(z.d.bk).length, irDateien(z).length];
  r = await ruf(z.url, 'POST', '/sampler/space_ir', { wurzel: 'Lib', rel: 'notiz.txt' });
  assert.deepEqual([r.code, r.j.fehler], [422, 'format_falsch'], JSON.stringify(r.j));
  r = await ruf(z.url, 'POST', '/sampler/space_ir', { wurzel: 'Lib', rel: 'kurz.wav' });
  assert.deepEqual([r.code, r.j.fehler], [422, 'ir_zu_kurz'], JSON.stringify(r.j));
  r = await ruf(z.url, 'POST', '/sampler/space_ir', { wurzel: 'Lib', rel: 'gibtsnicht.wav' });
  assert.deepEqual([r.code, r.j.fehler], [404, 'quelle_unbekannt']);
  r = await ruf(z.url, 'POST', '/sampler/space_ir', { wurzel: 'Lib' });
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig']);
  r = await ruf(z.url, 'POST', '/sampler/space_ir', { wurzel: 'Lib', rel: 'lang.wav', x: 1 });
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_unbekannt']);
  assert.deepEqual([fs.readdirSync(z.d.bk).length, irDateien(z).length], vorher);
});

test('the swap command list replaces the stage with the copy, keeps the six knob values and is ONE undo step', { skip: OHNE_FFMPEG }, async (t) => {
  const z = await aufbau(t);
  assert.equal((await ruf(z.url, 'POST', '/proj/neu', { name: 'Raum' })).code, 200);
  const kopie = await ruf(z.url, 'POST', '/sampler/space_ir', { wurzel: 'Lib', rel: 'lang.wav' });
  assert.equal(kopie.code, 200, JSON.stringify(kopie.j));
  const akt = (await ruf(z.url, 'GET', '/proj/aktuell')).j;
  let p = akt.projekt;
  let r = await ruf(z.url, 'POST', '/proj/aendern', { rev: akt.rev ?? p.rev, label: 'Space', befehle: [{ befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'bk', graph: 'fx-space',
    werte: { k1: 0.31, k2: 0.2, k3: 0.4, k4: 0.6, k5: 0.7, k6: 0.15 } }] });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  p = r.j.projekt;
  const rev = r.j.rev;
  const alt = p.master.inserts[0];
  r = await ruf(z.url, 'POST', '/proj/aendern', { rev, label: 'Room', befehle: raumTauschBefehle({ strangId: 'master', pos: 0, graph: kopie.j.graph, werte: alt.werte }) });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const neu = r.j.projekt.master.inserts[0];
  assert.equal(r.j.projekt.master.inserts.length, 1);
  assert.equal(neu.graph, kopie.j.graph);
  assert.notEqual(neu.id, alt.id);
  for (const k of ['k1', 'k2', 'k3', 'k4', 'k5', 'k6']) assert.equal(neu.werte[k], alt.werte[k], k);
  const u = await ruf(z.url, 'POST', '/proj/undo', { rev: r.j.rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  const zurueck = (await ruf(z.url, 'GET', '/proj/aktuell')).j.projekt.master.inserts[0];
  assert.deepEqual([zurueck.graph, zurueck.id, zurueck.werte.k1], ['fx-space', alt.id, 0.31]);
});
