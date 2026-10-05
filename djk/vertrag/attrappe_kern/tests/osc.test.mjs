// node --test tests/osc.test.mjs: OSC-Kodierung gegen die Vorlage absender.mjs und Fehlerfälle
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kodiere, dekodiere, kodiereBundle } from '../osc.mjs';

test('Rundreise aller Typen, int64 als BigInt ohne Genauigkeitsverlust', () => {
  const id = 1758600000123456789n;                           // größer als 2^53
  const b = kodiere('/k/teil', 'hssisddfiiss', [id, 'cypher', 'p17', 3, 'deck/2/fader', 448, 32, -15, 0, 0, 'b_rein', 'h12']);
  const m = dekodiere(b);
  assert.equal(m.adresse, '/k/teil');
  assert.equal(m.typen, 'hssisddfiiss');
  assert.deepEqual(m.werte, [id, 'cypher', 'p17', 3, 'deck/2/fader', 448, 32, -15, 0, 0, 'b_rein', 'h12']);
});

// Referenz: die Kodierfunktion osc() aus proben/02-uhr-sync-planer/kern/absender.mjs Z. 19-31, wörtlich
const pad4 = (n) => (n + 4) & ~3;
function vorlage(addr, tags, args) {
  const parts = [];
  const str = (s) => { const b = Buffer.alloc(pad4(Buffer.byteLength(s))); b.write(s); parts.push(b); };
  str(addr); str(',' + tags);
  tags.split('').forEach((t, i) => {
    const v = args[i];
    if (t === 'i') { const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); }
    else if (t === 'h') { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); parts.push(b); }
    else if (t === 'd') { const b = Buffer.alloc(8); b.writeDoubleBE(v); parts.push(b); }
  });
  return Buffer.concat(parts);
}

test('Bytes gleich der Vorlage absender.mjs für i, h, d', () => {
  for (const [a, t, w] of [['/rampe', 'iddd', [7000, 32, 132, 32]], ['/klick', 'idh', [41, 40.25, 123456789012]], ['/k/tempo/rampe', 'hsddd'.replace('s', ''), [5, 128, 132, 32]]]) {
    assert.equal(kodiere(a, t, w).toString('hex'), vorlage(a, t, w).toString('hex'));
  }
});

test('Fehlerfälle: abgeschnitten, Überhang, fremder Typ werfen', () => {
  const b = kodiere('/k/hallo', 'sii', ['leitstand', 47110, 1]);
  assert.throws(() => dekodiere(b.subarray(0, b.length - 2)), /abgeschnitten/);
  assert.throws(() => dekodiere(Buffer.concat([b, Buffer.alloc(4)])), /Überhang/);
  const fremd = Buffer.from(b); fremd[13] = 'x'.charCodeAt(0);        // '/k/hallo' belegt 12 Bytes, Byte 12 ist das Komma
  assert.throws(() => dekodiere(fremd), /Typ x unbekannt/);
});

test('Bundle mit Fenster und Ereignis wird gelesen', () => {
  const b = kodiereBundle([['/erz/fenster', 'iiiiddh', [1, 7, 66, 0, 32, 36, 123n]], ['/erz/ev', 'iiiiddf', [1, 2, 1, 60, 32.5, 0.25, 0.8]]]);
  const m = dekodiere(b);
  assert.equal(m.bundle, true);
  assert.equal(m.elemente.length, 2);
  assert.equal(m.elemente[1].werte[4], 32.5);
});
