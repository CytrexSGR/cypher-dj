// Sample player stage 1: roots, path safety, listing, search, decoding, root note. Temp folders only, never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sinusWav } from './support/sinus_wav.mjs';
import { dekodiereDatei, istGesperrt, grundVonDatei, ladeDatei, leseWurzeln, listeOrdner, listeWurzeln, loeseAuf, noteAusDateiname, sucheDateien, vorhoerWav } from '../sampler/file.ts';
import { ladeQuellAudio, legeSchnitt, liesSchnitt, listeSchnitte, SchnittFehler } from '../sampler/schnitt.ts';

function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-dat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = path.join(root, 'store'), lib = path.join(root, 'lib');
  fs.mkdirSync(store); fs.mkdirSync(lib);
  const o = { ordner: store, bk: path.join(root, 'bk'), loops: path.join(root, 'loops'), module: path.join(root, 'module') };
  const wurzeln = (l) => fs.writeFileSync(path.join(store, 'wurzeln.json'), JSON.stringify(l));
  wurzeln([{ name: 'Lib', pfad: lib }]);
  return { root, store, lib, o, wurzeln };
}
const refuse = (f, grund) => assert.throws(f, (e) => e instanceof SchnittFehler && e.grund === grund, grund);

test('roots file: missing and empty give none, entries are checked, at most 16', (t) => {
  const z = aufbau(t);
  fs.rmSync(path.join(z.store, 'wurzeln.json'));
  assert.deepEqual(leseWurzeln(z.o), []);
  fs.writeFileSync(path.join(z.store, 'wurzeln.json'), '');
  assert.deepEqual(leseWurzeln(z.o), []);
  fs.writeFileSync(path.join(z.store, 'wurzeln.json'), '{"a":1}');
  assert.deepEqual(leseWurzeln(z.o), []);
  z.wurzeln([{ name: 'A', pfad: '/x' }, { name: 'A', pfad: '/y' }, { name: '', pfad: '/x' }, { name: 'rel', pfad: 'x/y' }, { name: 'x'.repeat(41), pfad: '/x' }, { name: 'a/b', pfad: '/x' }, 7, { name: 'B', pfad: '/z' }]);
  assert.deepEqual(leseWurzeln(z.o), [{ name: 'A', pfad: '/x' }, { name: 'B', pfad: '/z' }]);
  z.wurzeln(Array.from({ length: 20 }, (_, i) => ({ name: `r${i}`, pfad: `/r${i}` })));
  assert.equal(leseWurzeln(z.o).length, 16);
});

test('a root that is not on disk is listed with fehlt and cannot be opened', (t) => {
  const z = aufbau(t);
  z.wurzeln([{ name: 'Lib', pfad: z.lib }, { name: 'Weg', pfad: path.join(z.root, 'nicht-da') }]);
  assert.deepEqual(listeWurzeln(z.o), [{ name: 'Lib' }, { name: 'Weg', fehlt: true }]);
  refuse(() => listeOrdner('Weg', '', z.o), 'quelle_unbekannt');
  refuse(() => listeOrdner('Unbekannt', '', z.o), 'quelle_unbekannt');
});

test('path escape is refused: .., absolute path, symlink out of the root', (t) => {
  const z = aufbau(t);
  const aussen = path.join(z.root, 'aussen');
  sinusWav(path.join(aussen, 'geheim.wav'));
  sinusWav(path.join(z.lib, 'ok.wav'));
  fs.symlinkSync(aussen, path.join(z.lib, 'raus'));
  fs.symlinkSync(path.join(aussen, 'geheim.wav'), path.join(z.lib, 'link.wav'));
  assert.equal(loeseAuf('Lib', 'ok.wav', z.o), fs.realpathSync(path.join(z.lib, 'ok.wav')));
  for (const rel of ['../aussen/geheim.wav', 'a/../../aussen', '..', aussen, path.join(aussen, 'geheim.wav'), 'raus', 'raus/geheim.wav', 'link.wav', 'fehlt.wav']) {
    refuse(() => loeseAuf('Lib', rel, z.o), 'quelle_unbekannt');
  }
  const l = listeOrdner('Lib', '', z.o);
  assert.deepEqual(l.dateien.map((d) => d.name), ['ok.wav'], 'a symlink that leaves the root is not listed');
  assert.deepEqual(l.ordner_liste, []);
  refuse(() => ladeDatei('Lib/../aussen/geheim.wav', z.o), 'quelle_unbekannt');
});

test('listing: natural order, only audio files, folders as their own list, cap', (t) => {
  const z = aufbau(t);
  for (const n of ['kick10.wav', 'Kick2.WAV', 'kick1.flac', 'a.ogg', 'b.aif', 'c.aiff', 'notes.txt', 'x.mp3', 'cover.png']) fs.writeFileSync(path.join(z.lib, n), 'x');
  for (const n of ['Zed', 'alpha', 'drums10', 'drums2', 'leer', 'nur-text', 'kette/innen/tief']) fs.mkdirSync(path.join(z.lib, n), { recursive: true });
  fs.writeFileSync(path.join(z.lib, 'alpha', 'tief.wav'), 'abc');
  for (const n of ['Zed', 'drums10', 'drums2']) fs.writeFileSync(path.join(z.lib, n, 'x.wav'), 'x');
  fs.writeFileSync(path.join(z.lib, 'nur-text', 'lies.txt'), 'x');
  for (const n of ['a.wav', 'b.wav']) fs.writeFileSync(path.join(z.lib, 'kette', 'innen', 'tief', n), 'x');
  const l = listeOrdner('Lib', '', z.o);
  assert.deepEqual(l.dateien.map((d) => d.name), ['a.ogg', 'b.aif', 'c.aiff', 'kick1.flac', 'Kick2.WAV', 'kick10.wav']);
  // folders without audio below them are left out, a chain of single folders is one entry, every entry counts its audio files
  assert.deepEqual(l.ordner_liste, ['alpha', 'drums2', 'drums10', 'kette/innen/tief', 'Zed']);
  assert.deepEqual(l.ordner_zahl, { alpha: 1, drums2: 1, drums10: 1, 'kette/innen/tief': 2, Zed: 1 });
  assert.deepEqual(l.dateien[0], { name: 'a.ogg', rel: 'a.ogg', bytes: 1 });
  assert.equal(l.mehr, undefined);
  const sub = listeOrdner('Lib', 'alpha', z.o);
  assert.deepEqual(sub.dateien, [{ name: 'tief.wav', rel: 'alpha/tief.wav', bytes: 3 }]);
  assert.equal(sub.ordner, 'alpha');
  const viele = path.join(z.lib, 'viele');
  fs.mkdirSync(viele);
  for (let i = 0; i < 2003; i++) fs.writeFileSync(path.join(viele, `s${i}.wav`), '');
  const v = listeOrdner('Lib', 'viele', z.o);
  assert.equal(v.dateien.length, 2000);
  assert.equal(v.mehr, true);
});

test('search: every word, case-insensitive, recursive, capped at 300, time limit', (t) => {
  const z = aufbau(t);
  for (const n of ['Kick Heavy 808.wav', 'kick light.wav', 'snare 808.wav']) fs.writeFileSync(path.join(z.lib, n), 'x');
  fs.mkdirSync(path.join(z.lib, 'sub', 'tief'), { recursive: true });
  fs.writeFileSync(path.join(z.lib, 'sub', 'tief', 'KICK 808 long.flac'), 'x');
  fs.writeFileSync(path.join(z.lib, 'sub', 'kick 808.txt'), 'x');
  let r = sucheDateien('Lib', '', 'kick 808', z.o);
  assert.deepEqual(r.dateien.map((d) => d.rel), ['Kick Heavy 808.wav', 'sub/tief/KICK 808 long.flac']);
  assert.equal(r.mehr, undefined);
  r = sucheDateien('Lib', 'sub', '808', z.o);
  assert.deepEqual(r.dateien.map((d) => d.rel), ['sub/tief/KICK 808 long.flac'], 'the start folder limits the search, hits keep rel from the root');
  assert.deepEqual(sucheDateien('Lib', '', 'kick snare', z.o).dateien, []);
  for (let i = 0; i < 310; i++) fs.writeFileSync(path.join(z.lib, 'sub', `hit${String(i).padStart(3, '0')}.wav`), '');
  r = sucheDateien('Lib', '', 'hit', z.o);
  assert.equal(r.dateien.length, 300);
  assert.equal(r.mehr, true);
  r = sucheDateien('Lib', '', 'hit', z.o, -1);
  assert.equal(r.mehr, true, 'the walking time is over at once');
});

test('decode: mono 44.1 kHz becomes 48 kHz stereo float32 on both sides, with the right length', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'mono.wav'), { hz: 220, sekunden: 1, rate: 44100, kanaele: 1, pegel: 0.5 });
  const d = dekodiereDatei(path.join(z.lib, 'mono.wav'), 10);
  assert.ok(d instanceof Float32Array);
  assert.ok(Math.abs(d.length / 2 - 48000) <= 8, `frames ${d.length / 2}`);
  let gleich = true, spitze = 0;
  for (let i = 0; i < d.length; i += 2) { if (d[i] !== d[i + 1]) gleich = false; spitze = Math.max(spitze, Math.abs(d[i])); }
  assert.ok(gleich, 'L = R');
  assert.ok(Math.abs(spitze - 0.5) < 0.02, `peak ${spitze} (no level loss)`);
  sinusWav(path.join(z.lib, 'st.wav'), { sekunden: 0.5, rate: 48000, kanaele: 2 });
  assert.equal(dekodiereDatei(path.join(z.lib, 'st.wav'), 10).length / 2, 24000);
});

test('ladeDatei: leading silence trimmed, tempo and beats, refusals', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'lead.wav'), { sekunden: 2, rate: 48000, kanaele: 2, stille: 0.5 });
  const q = ladeDatei('Lib/lead.wav', { ...z.o, tempo: 120 });
  assert.ok(Math.abs(q.frames - 72000) <= 4, `frames ${q.frames}`);
  assert.equal(q.daten.length, q.frames * 2);
  assert.ok(Math.abs(q.daten[2 * 40]) > 0.01 || Math.abs(q.daten[2 * 80]) > 0.01, 'the tone starts at frame 0');
  assert.equal(q.bpm, 120);
  assert.equal(q.beats, 3);   // 1.5 s at 120 BPM
  assert.equal(q.name, 'lead');
  assert.equal(ladeDatei('Lib/lead.wav', z.o).bpm, 120, 'default tempo');
  sinusWav(path.join(z.lib, 'kurz.wav'), { sekunden: 0.001, rate: 48000, kanaele: 1 });
  assert.equal(ladeDatei('Lib/kurz.wav', { ...z.o, tempo: 60 }).beats, 0.125, 'at least 1/8 beat');
  sinusWav(path.join(z.lib, 'still.wav'), { sekunden: 1, stumm: true });
  refuse(() => ladeDatei('Lib/still.wav', z.o), 'format_falsch');
  assert.throws(() => ladeDatei('Lib/still.wav', z.o), /silent/);
  fs.writeFileSync(path.join(z.lib, 'kaputt.wav'), 'not audio at all');
  refuse(() => ladeDatei('Lib/kaputt.wav', z.o), 'format_falsch');
  fs.writeFileSync(path.join(z.lib, 'x.txt'), 'x');
  refuse(() => ladeDatei('Lib/x.txt', z.o), 'format_falsch');
});

test('over the limit is refused with zu_lang, never cut off', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'zwei.wav'), { sekunden: 2, rate: 48000, kanaele: 1 });
  sinusWav(path.join(z.lib, 'lang.wav'), { sekunden: 8, rate: 8000, kanaele: 1 });
  refuse(() => ladeDatei('Lib/zwei.wav', { ...z.o, dateiMaxFrames: 48000 }), 'zu_lang');
  assert.ok(Math.abs(ladeDatei('Lib/zwei.wav', { ...z.o, dateiMaxFrames: 96000 }).frames - 96000) <= 2, 'the first sample of a sine is zero and is trimmed');
  refuse(() => ladeDatei('Lib/lang.wav', { ...z.o, dateiMaxFrames: 48000 }), 'zu_lang');   // longer than the limit plus the 2 s of slack
});

test('root note: sine at 220 Hz without a note in the name gives 57', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'sine.wav'), { hz: 220, sekunden: 1, rate: 48000, kanaele: 1 });
  const q = ladeDatei('Lib/sine.wav', z.o);
  assert.deepEqual(grundVonDatei(q.daten, 'sine.wav'), { note: 57, herkunft: 'erkannt' });
});

test('root note: the file name class wins at the octave nearest to the detection', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'sine.wav'), { hz: 220, sekunden: 1, rate: 48000, kanaele: 1 });
  const q = ladeDatei('Lib/sine.wav', z.o);
  assert.deepEqual(grundVonDatei(q.daten, 'Pad C3.wav'), { note: 60, herkunft: 'dateiname' }, 'C nearest to 57 is 60, the octave of the name is ignored');
  assert.deepEqual(grundVonDatei(q.daten, 'Pad A5.wav'), { note: 57, herkunft: 'erkannt' }, 'same class: the detection stays');
  assert.deepEqual(grundVonDatei(q.daten, 'Pad_F#1_soft.wav'), { note: 54, herkunft: 'dateiname' });
  assert.deepEqual(grundVonDatei(q.daten, 'Pad Gs1.wav'), { note: 56, herkunft: 'dateiname' });
});

test('root note: without detection the file name decides alone (C4 = 60), else 60', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'kurz.wav'), { hz: 220, sekunden: 0.05, rate: 48000, kanaele: 1 });   // too short for the detection
  const q = ladeDatei('Lib/kurz.wav', z.o);
  assert.deepEqual(grundVonDatei(q.daten, 'Bass A2.wav'), { note: 45, herkunft: 'dateiname' });
  assert.deepEqual(grundVonDatei(q.daten, 'Bass C4.wav'), { note: 60, herkunft: 'dateiname' });
  assert.deepEqual(grundVonDatei(q.daten, 'Bass Bb1.wav'), { note: 34, herkunft: 'dateiname' });
  assert.deepEqual(grundVonDatei(q.daten, 'Bass.wav'), { note: 60, herkunft: 'vorgabe' });
  assert.deepEqual(grundVonDatei(q.daten, 'Bass C9.wav'), { note: 96 - 12, herkunft: 'dateiname' }, 'C9 = 120 is moved down into the range 16..95 of the block');
});

test('note names in file names', () => {
  const k = (n) => noteAusDateiname(n)?.note ?? null;
  assert.equal(k('C3.wav'), 48);
  assert.equal(k('F#2.wav'), 42);
  assert.equal(k('Gs4 pad.wav'), 68);
  assert.equal(k('x_Bb1_y.wav'), 34);
  assert.equal(k('As_1.wav'), 10);   // A# in octave -1: 12 * 0 + 9 + 1
  assert.equal(k('C-1.wav'), 0);
  assert.equal(k('Cat3.wav'), null, 'a word is not a note');
  assert.equal(k('kickC3.wav'), null, 'not delimited');
  assert.equal(k('Bass 808.wav'), null);
  assert.equal(k('Pad.D4.wav'), 62);
});

test('the file as a source of a cut: method ganz, one slice, listed', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'Pad C3.wav'), { sekunden: 1, rate: 44100, kanaele: 1 });
  const s = legeSchnitt({ quelle: { art: 'datei', ref: 'Lib/Pad C3.wav' }, methode: 'ganz' }, { ...z.o, tempo: 120 });
  assert.deepEqual(s.quelle, { art: 'datei', ref: 'Lib/Pad C3.wav' });
  assert.equal(s.methode, 'ganz');
  assert.deepEqual(s.grenzen, [0, s.frames]);
  assert.equal(s.guete.length, 1);
  assert.equal(s.name, 'Pad C3');
  assert.equal(s.bpm, 120);
  assert.equal(s.beats, 2);
  assert.ok(liesSchnitt(s.id, z.o));
  assert.deepEqual(listeSchnitte(z.o).map((x) => x.id), [s.id]);
  assert.equal(ladeQuellAudio({ art: 'datei', ref: 'Lib/Pad C3.wav' }, z.o).frames, s.frames);
  refuse(() => legeSchnitt({ quelle: { art: 'datei', ref: 'Lib/nix.wav' } }, z.o), 'quelle_unbekannt');
  assert.equal(listeSchnitte(z.o).length, 1, 'a refusal leaves no cut behind');
});

test('preview WAV: RIFF, 16 bit stereo 48 kHz, at most 30 s', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'p.wav'), { sekunden: 40, rate: 8000, kanaele: 1 });
  const b = vorhoerWav(path.join(z.lib, 'p.wav'));
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  assert.deepEqual([b.readUInt16LE(22), b.readUInt32LE(24), b.readUInt16LE(34)], [2, 48000, 16]);
  assert.equal(b.readUInt32LE(40), 30 * 48000 * 4);
  assert.equal(b.length, 44 + 30 * 48000 * 4);
});

test('a protected Ableton pack sample (AIFF-C, compression able) is not listed, counted or found', (t) => {
  const z = aufbau(t);
  fs.mkdirSync(path.join(z.lib, 'pack'));
  const chunk = (id, rumpf) => { const k = Buffer.alloc(8); k.write(id, 0, 'latin1'); k.writeUInt32BE(rumpf.length, 4); return Buffer.concat([k, rumpf]); };
  const comm = (comp) => chunk('COMM', Buffer.concat([Buffer.alloc(18), Buffer.from(comp, 'latin1'), Buffer.alloc(16)]));
  const datei = (...teile) => Buffer.concat([Buffer.from('FORM\u0000\u0000\u0000\u0000AIFC', 'latin1'), chunk('FVER', Buffer.from('a2805140', 'hex')), ...teile]);
  const kopf = (comp) => datei(comm(comp));
  // a pack sample with a large table chunk before COMM: the chunk `able` right after FVER decides
  fs.writeFileSync(path.join(z.lib, 'pack', 'zu2.aif'), datei(chunk('able', Buffer.alloc(340)), chunk('abli', Buffer.alloc(4000)), comm('able')));
  assert.equal(istGesperrt(path.join(z.lib, 'pack', 'zu2.aif')), true);
  fs.writeFileSync(path.join(z.lib, 'pack', 'zu.aif'), kopf('able'));
  fs.writeFileSync(path.join(z.lib, 'pack', 'offen.aif'), kopf('NONE'));
  assert.equal(istGesperrt(path.join(z.lib, 'pack', 'zu.aif')), true);
  assert.equal(istGesperrt(path.join(z.lib, 'pack', 'offen.aif')), false);
  assert.deepEqual(listeOrdner('Lib', 'pack', z.o).dateien.map((d) => d.name), ['offen.aif']);
  assert.equal(listeOrdner('Lib', '', z.o).ordner_zahl.pack, 1);
  assert.deepEqual(sucheDateien('Lib', '', 'aif', z.o).dateien.map((d) => d.name), ['offen.aif']);
});
