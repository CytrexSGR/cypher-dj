// MVP 2 Scheibe 3 (E2): ein Loop wird zum Klang im Zusatz-Kit (rec). Namen rec0, rec1 …; eigener Name nach
// [a-z][a-z0-9_]{0,15}; kein Name, der im Basis-Kit schon eine Bank ist (Review Fund 8: sonst spielt s("bd") den
// Mitschnitt); Note = die niedrigste im Zusatz-Kit freie (F08); höchstens 10 s; kit.json atomar ersetzt.
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
  assert.deepEqual(w.auf('c-1'), { klang: 'rec0', note: 0 });
  const f32 = fs.readFileSync(path.join(w.kits, 'rec', 'rec0_0.f32'));
  assert.equal(f32.length, 90000 * 8);
  const k = ladeKits(path.join(w.kits, 'basis'), path.join(w.kits, 'rec'));
  assert.equal(noteFuer(k, { s: 'rec0' }), 128);
  assert.equal(noteFuer(k, { s: 'bd' }), 0);
  w.loop('c-2', 1000);
  assert.deepEqual(w.auf('c-2'), { klang: 'rec1', note: 1 });
  assert.deepEqual(w.auf('c-2', 'mein_loop'), { klang: 'mein_loop', note: 2 });
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
  assert.deepEqual([...aus].filter((_, i) => i % 2 === 0), [1.5, 0, 1, 1]);   // Beginn bei Frame 3; F50: Kanten 3 und 2 je halbiert
});

test('F50 (Glanz 2.5.3): Mitschnitt mit lauten Kanten bekommt Ein- und Ausblende; leise Kanten bleiben bitgleich', () => {
  const w = welt();
  const schreibLoop = (name, frames, fn) => {
    const f = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) { f[2 * i] = fn(i); f[2 * i + 1] = fn(i); }
    fs.mkdirSync(path.join(w.loops, name), { recursive: true });
    fs.writeFileSync(path.join(w.loops, name, 'loop.f32'), Buffer.from(f.buffer));
    fs.writeFileSync(path.join(w.loops, name, 'loop.json'), JSON.stringify({ schema: 1, name, bpm: 128, frames, datei: 'loop.f32' }));
    return f;
  };
  const lies = (datei) => { const b = fs.readFileSync(path.join(w.kits, 'rec', datei)); return new Float32Array(new Uint8Array(b).buffer); };
  // cos 100 Hz, 0,5: beginnt bei 0,5 und endet (Frame 4799) bei 0,49996, beide Kanten laut
  const f = schreibLoop('kante', 4800, (i) => 0.5 * Math.cos(2 * Math.PI * 100 * i / 48000));
  w.auf('kante');
  const y = lies('rec0_0.f32');
  assert.ok(y[0] !== 0 && Math.abs(y[0]) <= 0.5 / 33 + 1e-7, `Anfang ${y[0]}`);
  assert.ok(Math.abs(y[2 * 4799]) <= 0.5 / 241 + 1e-7, `Ende ${y[2 * 4799]}`);
  assert.equal(y[2 * 32], f[2 * 32]);       // nach der Einblende unverändert
  assert.equal(y[2 * 2400], f[2 * 2400]);   // Mitte unverändert
  // Negativ-Kontrolle: sin beginnt bei 0 und endet (Frame 4800 = 10 Perioden) bei 0 → Datei bitgleich zur Quelle
  schreibLoop('leise', 4801, (i) => 0.5 * Math.sin(2 * Math.PI * 100 * i / 48000));
  w.auf('leise');
  assert.equal(Buffer.compare(fs.readFileSync(path.join(w.kits, 'rec', 'rec1_0.f32')),
    fs.readFileSync(path.join(w.loops, 'leise', 'loop.f32'))), 0);
});

test('F08 (Glanz 2.4.2): Basis mit 112 Klängen, Zusatz auf denselben Noten: alle 150 erreichbar, keine Note doppelt', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-f08-'));
  const schreib = (name, n, ab, bank) => {
    fs.mkdirSync(path.join(d, name));
    fs.writeFileSync(path.join(d, name, 'kit.json'), JSON.stringify({ schema: 1, name, klaenge:
      Array.from({ length: n }, (_, i) => ({ note: ab + i, name: `${bank}${i}:0`, datei: 'x.f32', frames: 1 })) }));
  };
  schreib('battery', 112, 0, 'bat');
  schreib('rec', 38, 73, 'rec');
  const k = ladeKits(path.join(d, 'battery'), path.join(d, 'rec'));
  const noten = [...k.note.values()];
  assert.equal(noten.length, 150);
  assert.equal(new Set(noten).size, 150);
  assert.equal(noteFuer(k, { s: 'bat73' }), 73);
  assert.equal(noteFuer(k, { s: 'rec0' }), 128 + 73);
  assert.ok(noten.every((n) => n >= 0 && n <= 255));
});
