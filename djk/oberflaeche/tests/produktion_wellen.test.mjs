// PRODUCTION V1: Wellen-Cache (je sha ein Abruf, Fehler bleibt sichtbar)
import test from 'node:test';
import assert from 'node:assert/strict';
import { neueWellen } from '../oeffentlich/produktion/wellen.js';

function djkw(spalten) {
  const b = new ArrayBuffer(16 + spalten * 4), v = new DataView(b);
  [...'DJKW'].forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint32(4, 1, true); v.setUint32(8, 256, true); v.setUint32(12, spalten, true);
  for (let i = 0; i < spalten * 4; i++) v.setUint8(16 + i, 100);
  return b;
}

test('V1 Wellen: ein Abruf je sha, Welle kommt nach wenn()', async () => {
  const urls = [];
  const w = neueWellen(async (u) => { urls.push(u); return { ok: true, status: 200, arrayBuffer: async () => djkw(10) }; });
  let gerufen = 0;
  const fertig = new Promise((r) => { w.hole('ab', () => { gerufen++; r(); }); });
  const e2 = w.hole('ab');
  await fertig;
  assert.deepEqual(urls, ['/welle?sha=ab']);
  assert.equal(e2.welle.spalten, 10);
  assert.equal(e2.welle.hop, 256);
  assert.equal(gerufen, 1);
  assert.equal(w.groesse, 1);
});

test('V1 Wellen: HTTP-Fehler bleibt als fehler stehen und wird nicht neu geholt', async () => {
  let n = 0;
  const w = neueWellen(async () => { n++; return { ok: false, status: 422 }; });
  await new Promise((r) => w.hole('cd', r));
  assert.equal(w.hole('cd').fehler, 'HTTP 422');
  assert.equal(w.hole('cd').welle, null);
  assert.equal(n, 1);
  // Negativ-Kontrolle: ein anderer sha ist ein eigener Eintrag
  await new Promise((r) => w.hole('ef', r));
  assert.equal(n, 2);
});
