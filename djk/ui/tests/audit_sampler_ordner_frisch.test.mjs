// Audit U14: the folder listing must not hide a folder that was created or filled after the cached whole-root count (10 minutes), and a symlinked folder
// inside the root (which the listing admits) must show with its count.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sinusWav } from './support/sinus_wav.mjs';
import { listeOrdner } from '../sampler/file.ts';

function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-fr-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = path.join(root, 'store'), lib = path.join(root, 'lib');
  fs.mkdirSync(store); fs.mkdirSync(lib);
  fs.writeFileSync(path.join(store, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: lib }]));
  return { root, lib, o: { ordner: store, bk: path.join(root, 'bk'), loops: path.join(root, 'loops'), module: path.join(root, 'module') } };
}

test('a pack copied in after the first listing shows at once; an empty folder that got a file shows too', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'Alt', 'a.wav'));
  fs.mkdirSync(path.join(z.lib, 'Leer'));
  assert.deepEqual(listeOrdner('Lib', '', z.o).ordner_liste, ['Alt'], 'first listing: the empty folder is left out');
  sinusWav(path.join(z.lib, 'Neu', 'n1.wav')); sinusWav(path.join(z.lib, 'Neu', 'n2.wav'));
  sinusWav(path.join(z.lib, 'Leer', 'jetzt.wav'));
  const l = listeOrdner('Lib', '', z.o);
  assert.deepEqual(l.ordner_liste, ['Alt', 'Leer', 'Neu']);
  assert.deepEqual(l.ordner_zahl, { Alt: 1, Leer: 1, Neu: 2 });
});

test('a new sub folder of a known folder shows and its chain collapses', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'Pack', 'x.wav'));
  listeOrdner('Lib', '', z.o);
  sinusWav(path.join(z.lib, 'Pack', 'Neu', 'Tief', 'y.wav'));
  const l = listeOrdner('Lib', 'Pack', z.o);
  assert.deepEqual(l.ordner_liste, ['Neu/Tief']);
  assert.equal(listeOrdner('Lib', '', z.o).ordner_zahl.Pack, 2, 'the count of the parent follows');
});

test('a symlinked folder inside the root is listed with its count', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'Archive', 'Drums', 'k.wav')); sinusWav(path.join(z.lib, 'Archive', 'Drums', 's.wav'));
  fs.symlinkSync(path.join(z.lib, 'Archive', 'Drums'), path.join(z.lib, 'Drums'));
  const l = listeOrdner('Lib', '', z.o);
  assert.ok(l.ordner_liste.includes('Drums'), JSON.stringify(l.ordner_liste));
  assert.equal(l.ordner_zahl.Drums, 2);
});

test('negative control: a folder without any audio file stays out, also when it is new', (t) => {
  const z = aufbau(t);
  sinusWav(path.join(z.lib, 'A', 'a.wav'));
  listeOrdner('Lib', '', z.o);
  fs.mkdirSync(path.join(z.lib, 'Doku', 'Bilder'), { recursive: true });
  fs.writeFileSync(path.join(z.lib, 'Doku', 'Bilder', 'x.txt'), 'x');
  assert.deepEqual(listeOrdner('Lib', '', z.o).ordner_liste, ['A']);
});
