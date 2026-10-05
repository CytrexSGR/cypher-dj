// MVP 2 Scheibe 3 (E2): ein Loop wird zum Klang im Zusatz-Kit (rec). Namen rec0, rec1 …; eigener Name nach
// [a-z][a-z0-9_]{0,15}; kein Name, der im Basis-Kit schon eine Bank ist (Review Fund 8: sonst spielt s("bd") den
// Mitschnitt); Note = die niedrigste in beiden Kits freie; höchstens 10 s; kit.json atomar ersetzt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loopZuKlang } from '../kit_schreiben.mjs';
import { ladeKits, noteFuer } from '../../erzeuger/src/kit.mjs';

function welt() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-schreiben-'));
  const kits = path.join(d, 'kits'), loops = path.join(d, 'loops');
  fs.mkdirSync(path.join(kits, 'basis'), { recursive: true });
  fs.writeFileSync(path.join(kits, 'basis', 'kit.json'), JSON.stringify({ schema: 1, name: 'basis', klaenge: [
    { note: 0, name: 'bd:0', datei: 'bd_0.f32', frames: 1 }, { note: 1, name: 'hh:0', datei: 'hh_0.f32', frames: 1 }] }));
  const loop = (name, frames, extra = {}) => {
    fs.mkdirSync(path.join(loops, name), { recursive: true });
    fs.writeFileSync(path.join(loops, name, 'loop.f32'), Buffer.alloc(frames * 8, 1));
    fs.writeFileSync(path.join(loops, name, 'loop.json'),
      JSON.stringify({ schema: 1, name, bpm: 128, frames, datei: 'loop.f32', ...extra }));
  };
  const auf = (loopName, klang) => loopZuKlang({ loopOrdner: loops, kitsOrdner: kits, basis: 'basis', zusatz: 'rec', loop: loopName, klang });
  return { d, kits, loops, loop, auf };
}

test('erster Klang heißt rec0, bekommt die erste freie Note und ist per s("rec0") erreichbar', () => {
  const w = welt();
  w.loop('c-1', 90000, { takte: 1 });          // altes Format mit takte: gelesen wird nur frames
  assert.deepEqual(w.auf('c-1'), { klang: 'rec0', note: 2 });
  const f32 = fs.readFileSync(path.join(w.kits, 'rec', 'rec0_0.f32'));
  assert.equal(f32.length, 90000 * 8);
  const k = ladeKits(path.join(w.kits, 'basis'), path.join(w.kits, 'rec'));
  assert.equal(noteFuer(k, { s: 'rec0' }), 2);
  assert.equal(noteFuer(k, { s: 'bd' }), 0);
  w.loop('c-2', 1000);
  assert.deepEqual(w.auf('c-2'), { klang: 'rec1', note: 3 });
  assert.deepEqual(w.auf('c-2', 'mein_loop'), { klang: 'mein_loop', note: 4 });
  const j = JSON.parse(fs.readFileSync(path.join(w.kits, 'rec', 'kit.json'), 'utf8'));
  assert.deepEqual(j.klaenge.map((x) => x.name), ['rec0:0', 'rec1:0', 'mein_loop:0']);
  assert.ok(!fs.readdirSync(path.join(w.kits, 'rec')).some((n) => n.includes('.neu')));
});

test('Negativ: Bankname aus dem Basis-Kit, doppelter Name, falscher Name, zu lang, Loop fehlt', () => {
  const w = welt();
  w.loop('c-1', 1000);
  w.loop('lang', 480001);
  assert.throws(() => w.auf('c-1', 'bd'), /bd ist im Kit basis schon ein Klang/);
  w.auf('c-1', 'x1');
  assert.throws(() => w.auf('c-1', 'x1'), /x1 gibt es im Kit rec schon/);
  assert.throws(() => w.auf('c-1', 'Gross'), /Name Gross/);
  assert.throws(() => w.auf('lang'), /länger als 10 s/);
  assert.throws(() => w.auf('fehlt'), /Loop fehlt/);
});

test('ladeKits: fehlt das Zusatz-Kit, gilt nur das Basis-Kit', () => {
  const w = welt();
  const k = ladeKits(path.join(w.kits, 'basis'), path.join(w.kits, 'rec'));
  assert.equal(noteFuer(k, { s: 'hh' }), 1);
  assert.equal(noteFuer(k, { s: 'rec0' }), null);
});

// Abschluss-Review Scheibe 3 Fund 3: CLI und Seite gleichzeitig verloren in 40/40 Läufen einen Eintrag. Acht Prozesse
// zugleich: acht Klänge, jede .f32 passt zu frames.
test('gleichzeitige Schreiber verlieren nichts', async () => {
  const { spawn } = await import('node:child_process');
  const w = welt();
  w.loop('c-1', 1000);
  const modul = new URL('../kit_schreiben.mjs', import.meta.url).href;
  const eins = () => new Promise((ok) => {
    const code = `import('${modul}').then(({ loopZuKlang }) => loopZuKlang({ loopOrdner: '${w.loops}', kitsOrdner: '${w.kits}', basis: 'basis', zusatz: 'rec', loop: 'c-1' }))`;
    spawn(process.execPath, ['-e', code], { stdio: 'ignore' }).on('exit', ok);
  });
  await Promise.all(Array.from({ length: 8 }, eins));
  const j = JSON.parse(fs.readFileSync(path.join(w.kits, 'rec', 'kit.json'), 'utf8'));
  assert.equal(j.klaenge.length, 8, JSON.stringify(j.klaenge.map((k) => k.name)));
  assert.equal(new Set(j.klaenge.map((k) => k.note)).size, 8);
  for (const k of j.klaenge) assert.equal(fs.statSync(path.join(w.kits, 'rec', k.datei)).size, k.frames * 8);
});

test('Plan Grid: Loop mit versatz_frames wird gedreht geschrieben (Beginn beim Versatz)', () => {
  const w = welt();
  fs.mkdirSync(path.join(w.loops, 'dreh'), { recursive: true });
  const f = new Float32Array(8);                 // 4 Frames Stereo: Frame i trägt links i, rechts −i
  for (let i = 0; i < 4; i++) { f[2 * i] = i; f[2 * i + 1] = -i; }
  fs.writeFileSync(path.join(w.loops, 'dreh', 'loop.f32'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(w.loops, 'dreh', 'loop.json'), JSON.stringify({ schema: 1, name: 'dreh', bpm: 128, frames: 4, datei: 'loop.f32', versatz_frames: -1 }));
  w.auf('dreh');
  const roh = fs.readFileSync(path.join(w.kits, 'rec', 'rec0_0.f32'));
  console.log('GRID buffer.byteLength', roh.buffer.byteLength, 'length', roh.length, 'byteOffset', roh.byteOffset);
  const aus = new Float32Array(roh.buffer, roh.byteOffset, roh.length / 4);
  assert.deepEqual([...aus].filter((_, i) => i % 2 === 0), [3, 0, 1, 2]);   // Beginn bei (−1 mod 4) = Frame 3
});
