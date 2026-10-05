import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kodiere, lies } from '../src/osc.ts';

test('kodiert /k/hallo byte-genau (Adresse 12, Typen 8, Name 12, zwei int32)', () => {
  const b = kodiere('/k/hallo', 'sii', ['leitstand', 47110, 1]);
  assert.equal(b.length, 40);
  assert.equal(b.toString('hex'),
    '2f6b2f68616c6c6f00000000' + '2c73696900000000' + '6c6569747374616e64000000' + '0000b806' + '00000001');
});

test('gleiche Bytes wie absender.mjs der Probe 02 für i, d, h', () => {
  // proben/02-uhr-sync-planer/kern/absender.mjs: osc('/klick', 'idh', [41, 40.25, 123456789012])
  const b = kodiere('/klick', 'idh', [41, 40.25, 123456789012n]);
  assert.equal(b.toString('hex'),
    '2f6b6c69636b0000' + '2c69646800000000' + '00000029' + '4044200000000000' + '0000001cbe991a14');
});

test('liest, was es schreibt: i h d f s', () => {
  const b = kodiere('/q', 'hsihds', [1727000000000000000n, 'pruefstand', 2, 1440000n, 64.0, '']);
  const n = lies(b);
  assert.deepEqual(n, { adresse: '/q', typen: 'hsihds', werte: [1727000000000000000n, 'pruefstand', 2, 1440000n, 64, ''] });
  const p = lies(kodiere('/pegel', 'sfffffff', ['master', -6.5, -6.25, -14, -14.5, -30, -20, -25]));
  assert.equal(p.werte[0], 'master');
  assert.equal(p.werte[1], -6.5);
});

test('Fehlerfall: abgeschnittene Nachricht und fehlendes Komma werfen', () => {
  const b = kodiere('/uhr', 'hhddd', [0n, 0n, 0, 128, 0]);
  assert.throws(() => lies(b.subarray(0, b.length - 4)), /zu kurz/);
  assert.throws(() => lies(Buffer.from('/uhr\0\0\0\0hhddd\0\0\0')), /Komma/);
});

test('Fehlerfall: Zeichenkette über 47 Bytes oder nicht ASCII wird nicht gesendet (§1.4)', () => {
  assert.throws(() => kodiere('/k/hallo', 'sii', ['x'.repeat(48), 1, 1]), /47 Bytes/);
  assert.throws(() => kodiere('/k/hallo', 'sii', ['Übung', 1, 1]), /ASCII/);
  assert.doesNotThrow(() => kodiere('/k/hallo', 'sii', ['x'.repeat(47), 1, 1]));
});
