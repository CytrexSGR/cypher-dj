// The page's QR encoder against an independent encoder (the `qrcode` npm package, when installed on this machine), module by module for every mask,
// plus structural checks that need no reference (size, finder patterns, capacity, the pairing link fits).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { qrMatrix, qrSvg, QR_MAX_BYTES } from '../public/qr.js';

const LINK = `http://${['192', '168', '100', '200'].join('.')}:47301/koppeln?t=${'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe'.slice(0, 43)}`;
// Where the reference encoder is looked for: CYPHERDJ_QR_MODULES (colon-separated node_modules directories), the normal module resolution,
// the usual global directories, and the node_modules of each package installed there (a globally installed tool often brings qrcode along).
const referenz = (() => {
  const wurzeln = (process.env.CYPHERDJ_QR_MODULES ?? '').split(':').filter(Boolean);
  for (const global of ['/usr/lib/node_modules', '/usr/local/lib/node_modules']) {
    wurzeln.push(global);
    try { for (const paket of fs.readdirSync(global)) wurzeln.push(`${global}/${paket}/node_modules`); } catch { /* not there */ }
  }
  try { return createRequire(import.meta.url)('qrcode'); } catch { /* try the directories */ }
  for (const wurzel of wurzeln) {
    try { if (fs.existsSync(`${wurzel}/qrcode`)) return createRequire(`${wurzel}/`)('qrcode'); } catch { /* next */ }
  }
  return null;
})();

test('qr: the pairing link (85 bytes) fits version 5 and has the structure of a QR symbol', () => {
  assert.ok(new TextEncoder().encode(LINK).length <= 100);
  const m = qrMatrix(LINK);
  assert.equal(m.length, 37, 'version 5 is 37 x 37');
  for (const [x0, y0] of [[0, 0], [m.length - 7, 0], [0, m.length - 7]]) {
    for (let i = 0; i < 7; i++) for (const [x, y] of [[x0 + i, y0], [x0 + i, y0 + 6], [x0, y0 + i], [x0 + 6, y0 + i]]) assert.equal(m[y][x], true, 'finder ring');
    assert.equal(m[y0 + 3][x0 + 3], true);
    assert.equal(m[y0 + 1][x0 + 1], false);
  }
  assert.equal(m[m.length - 8][8], true, 'dark module');
  assert.equal(qrMatrix('x').length, 21);
  assert.equal(qrMatrix('x'.repeat(QR_MAX_BYTES)).length, 41);
  assert.throws(() => qrMatrix('x'.repeat(QR_MAX_BYTES + 1)), /do not fit/);
});

test('qr: svg has quiet zone and one path', () => {
  const s = qrSvg(LINK, { modul: 4, rand: 4 });
  assert.match(s, /^<svg [^>]*viewBox="0 0 180 180"/);
  assert.equal((s.match(/<path /g) ?? []).length, 1);
});

test('qr: the matrix equals the reference encoder for every mask, for links of several lengths', { skip: referenz === null ? 'the qrcode package was not found: install it or set CYPHERDJ_QR_MODULES to a node_modules directory that contains it' : false }, () => {
  const texte = ['a', 'http://10.0.0.5:47301/koppeln?t=x', LINK, LINK + 'x'.repeat(40), 'ä€ unicode', 'x'.repeat(QR_MAX_BYTES), 'x'.repeat(60), 'x'.repeat(100)];
  let n = 0;
  for (const t of texte) for (let k = 0; k < 8; k++) {
    const ref = referenz.create([{ data: Buffer.from(t, 'utf8'), mode: 'byte' }], { errorCorrectionLevel: 'L', maskPattern: k });
    const mein = qrMatrix(t, k);
    assert.equal(ref.modules.size, mein.length, `size of "${t.slice(0, 20)}" mask ${k}`);
    for (let y = 0; y < mein.length; y++) for (let x = 0; x < mein.length; x++) assert.equal(mein[y][x], ref.modules.get(y, x) === 1, `"${t.slice(0, 20)}" mask ${k} module ${x},${y}`);
    n++;
  }
  assert.equal(n, texte.length * 8);
});
