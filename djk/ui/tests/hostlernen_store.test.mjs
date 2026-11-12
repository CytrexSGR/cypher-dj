// Host learn: host_ziele.json round trip, damaged file, slot allocation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HostSpeicher, freierSlot, slotKanal, slotNr } from '../areas/hostlernen/store.ts';

const ordner = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-hostlernen-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('speicher: no file reads as fehlt; set and remove round-trip through host_ziele.json next to lernen.json', (t) => {
  const d = ordner(t), s = new HostSpeicher(d);
  assert.equal(s.datei, path.join(d, 'host_ziele.json'));
  assert.deepEqual(s.lies(), { datei: 'fehlt', ziele: {} });
  s.setze('erz/2/bk/1', { gruppe: 'bass', art: 'surge', name: 'a_filter1_cutoff' });
  s.setze('erz/3/bk/10', { gruppe: 'melodie', art: 'rb338', name: 'Volume' });
  s.setze('erz/2/bk/2', { gruppe: 'bass', art: 'vst3', name: 'Knob 3' });
  const nochmal = new HostSpeicher(d).lies();
  assert.equal(nochmal.datei, 'ok');
  assert.deepEqual(nochmal.ziele, {
    'erz/2/bk/1': { gruppe: 'bass', art: 'surge', name: 'a_filter1_cutoff' },
    'erz/2/bk/2': { gruppe: 'bass', art: 'vst3', name: 'Knob 3' },
    'erz/3/bk/10': { gruppe: 'melodie', art: 'rb338', name: 'Volume' } });
  assert.equal(s.entferne('erz/2/bk/1'), true);
  assert.equal(s.entferne('erz/2/bk/1'), false);
  assert.deepEqual(Object.keys(s.lies().ziele), ['erz/2/bk/2', 'erz/3/bk/10']);
});

test('speicher: a damaged file is reported and never overwritten; bad slots and shapes are refused', (t) => {
  const d = ordner(t), s = new HostSpeicher(d);
  fs.writeFileSync(s.datei, '{nicht json');
  assert.equal(s.lies().datei, 'kaputt');
  assert.throws(() => s.setze('erz/2/bk/1', { gruppe: 'bass', art: 'surge', name: 'x' }), (e) => e.grund === 'host_ziele_kaputt' && e.code === 409);
  assert.equal(fs.readFileSync(s.datei, 'utf8'), '{nicht json');
  fs.writeFileSync(s.datei, JSON.stringify({ version: 1, ziele: { 'erz/2/bk/1': { gruppe: 'bass', art: 'zzz', name: 'x' } } }));
  assert.equal(s.lies().datei, 'kaputt');
  fs.rmSync(s.datei);
  assert.throws(() => s.setze('erz/4/bk/1', { gruppe: 'bass', art: 'surge', name: 'x' }), (e) => e.grund === 'argument_ungueltig');
});

test('slot helpers and allocation: lowest free, null when 64 are used', () => {
  assert.equal(slotKanal('erz/2/bk/5'), 'erz/2');
  assert.equal(slotKanal('erz/5/bk/5'), null);
  assert.equal(slotNr('erz/3/bk/32'), 32);
  assert.equal(slotNr('erz/3/bk/64'), 64);
  assert.equal(slotNr('erz/3/bk/65'), null);
  assert.equal(freierSlot(new Set()), 1);
  assert.equal(freierSlot(new Set([1, 2, 4])), 3);
  assert.equal(freierSlot(new Set(Array.from({ length: 63 }, (_, i) => i + 1))), 64);
  assert.equal(freierSlot(new Set(Array.from({ length: 64 }, (_, i) => i + 1))), null);
});
