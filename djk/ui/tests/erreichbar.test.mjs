// Reachability of folders and sources (media browser slice 1, task 1)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Erreichbarkeit, quelleVon, quellenLage, aufWechselplatte, ERREICHBAR_TTL_MS } from '../erreichbar.ts';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-erreichbar-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('quelleVon: a sampler root wins over the mount rule', () => {
  assert.deepEqual(quelleVon('/mnt/store/Audio/vcsl/x', [{ name: 'VCSL', pfad: '/mnt/store/Audio/vcsl' }]), { name: 'VCSL', pfad: '/mnt/store/Audio/vcsl' });
  assert.deepEqual(quelleVon('/mnt/store/Audio/vcsl', [{ name: 'VCSL', pfad: '/mnt/store/Audio/vcsl' }]), { name: 'VCSL', pfad: '/mnt/store/Audio/vcsl' });
  assert.deepEqual(quelleVon('/mnt/store/Audio/vcsl/x', [{ name: 'V', pfad: '/mnt/store/Audio/vc' }]), { name: 'store', pfad: '/mnt/store' }, 'a root that is only a text prefix does not match');
  const lang = quelleVon('/r/a/b/c', [{ name: 'Kurz', pfad: '/r/a' }, { name: 'Lang', pfad: '/r/a/b' }]);
  assert.equal(lang.name, 'Lang', 'the longest root wins');
});

test('quelleVon: the disk of /media, /run/media and /mnt; everything else is the system disk', () => {
  assert.deepEqual(quelleVon('/media/user/DiskA/01 MP3/a', []), { name: 'DiskA', pfad: '/media/user/DiskA' });
  assert.deepEqual(quelleVon('/run/media/u/X/a', []), { name: 'X', pfad: '/run/media/u/X' });
  assert.deepEqual(quelleVon('/mnt/store/Audio/inst/a', []), { name: 'store', pfad: '/mnt/store' });
  assert.deepEqual(quelleVon('/home/user/x', []), { name: 'System disk', pfad: '/' });
});

test('Erreichbarkeit: an empty mount folder is a missing disk', (t) => {
  const d = tmp(t);
  const leer = path.join(d, 'leer'); fs.mkdirSync(leer);
  assert.equal(new Erreichbarkeit().quelleDa(leer), false);
  fs.writeFileSync(path.join(leer, 'a.wav'), 'x');
  assert.equal(new Erreichbarkeit().quelleDa(leer), true);
  assert.equal(new Erreichbarkeit().quelleDa(path.join(d, 'nix')), false);
  assert.equal(new Erreichbarkeit().quelleDa(path.join(leer, 'a.wav')), false, 'a file is not a mount folder');
  assert.equal(new Erreichbarkeit().quelleDa('/'), true);
});

test('Erreichbarkeit: ordnerDa is existsSync, null is false', (t) => {
  const d = tmp(t);
  const e = new Erreichbarkeit();
  assert.equal(e.ordnerDa(d), true);
  assert.equal(e.ordnerDa(path.join(d, 'nix')), false);
  assert.equal(e.ordnerDa(null), false);
});

test('Erreichbarkeit: answers are kept ttlMs', (t) => {
  const d = tmp(t);
  const ord = path.join(d, 'o'); fs.mkdirSync(ord);
  let jetzt = 1000;
  const e = new Erreichbarkeit({ jetzt: () => jetzt });
  assert.equal(ERREICHBAR_TTL_MS, 10_000);
  assert.equal(e.ordnerDa(ord), true);
  fs.rmdirSync(ord);
  jetzt += 10_000;
  assert.equal(e.ordnerDa(ord), true, 'still cached at +10 000 ms');
  jetzt += 1;
  assert.equal(e.ordnerDa(ord), false, 'fresh at +10 001 ms');
});

test('quellenLage: sums per source, missing sources da false, sorted by n', (t) => {
  const d = tmp(t);
  const a = path.join(d, 'A'), b = path.join(d, 'B');
  fs.mkdirSync(path.join(a, 'x'), { recursive: true }); fs.mkdirSync(path.join(a, 'y'), { recursive: true });
  fs.writeFileSync(path.join(a, 'x', 'f.wav'), 'x');
  fs.mkdirSync(b);   // an empty mount folder
  const r = quellenLage(
    [{ pfad: path.join(a, 'x'), n: 3 }, { pfad: path.join(a, 'y'), n: 4 }, { pfad: path.join(b, 'z'), n: 2 }],
    [{ name: 'A', pfad: a }, { name: 'B', pfad: b }], new Erreichbarkeit());
  assert.deepEqual(r, [{ name: 'A', pfad: a, n: 7, da: true }, { name: 'B', pfad: b, n: 2, da: false, grund: 'ordner' }]);
});

test('quellenLage: grund platte when the disk is gone, ordner when the disk is there but the sampler folder is not', (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, 'x'), 'x');
  const e = new Erreichbarkeit();
  // a mounted-looking disk is only decided by the mount rule on the path: these folders are neither mounted nor present
  const r = quellenLage([{ pfad: '/media/user/DiskGone/a', n: 1 }, { pfad: path.join(d, 'nix', 'a'), n: 2 }], [{ name: 'Lib', pfad: path.join(d, 'nix') }], e);
  assert.deepEqual(r.map((x) => [x.name, x.da, x.grund]), [['Lib', false, 'ordner'], ['DiskGone', false, 'platte']]);
});

test('/media/u/HomeLW/01 MP3/a.mp3 is on a removable disk', () => {
  assert.equal(aufWechselplatte('/media/u/HomeLW/01 MP3/a.mp3'), true);
  assert.equal(aufWechselplatte('/run/media/u/Disk/x.wav'), true);
  assert.equal(aufWechselplatte('/media/u'), false, 'a user folder alone is no disk');
});

test('a path on a fixed disk below /mnt is not', () => {
  assert.equal(aufWechselplatte('/mnt/data/library/a.wav'), false);
  assert.equal(aufWechselplatte('/home/u/a.wav'), false);
  assert.equal(aufWechselplatte('/medium/u/d/a.wav'), false, 'only the exact prefixes count');
});
