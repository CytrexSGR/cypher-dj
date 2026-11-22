// Waveform thumbnails and the animation loop of the session columns (lane P2). Fake fetch and rAF, no studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

installiere({ html: '<body></body>' });
const { daumen, starteTakt, wellenEinstellung, leereWellen } = await import('../public/session/waves.js');

// a DJKW v1 file: 16 byte head, `n` columns of 4 bytes
const djkw = (n = 64) => {
  const b = new ArrayBuffer(16 + n * 4), v = new DataView(b);
  'DJKW'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint32(4, 1, true); v.setUint32(8, 512, true); v.setUint32(12, n, true);
  new Uint8Array(b, 16).fill(100);
  return b;
};
const fetchMit = (antwort) => { const urls = []; globalThis.fetch = async (u) => { urls.push(String(u)); return antwort(); }; return urls; };

test('two daumen calls for the same sha and size fetch /welle once and return separate canvases', async () => {
  const urls = fetchMit(() => ({ ok: true, status: 200, arrayBuffer: async () => djkw() }));
  const [a, b] = await Promise.all([daumen('shaA', 40, 12), daumen('shaA', 40, 12)]);
  assert.equal(urls.length, 1);
  assert.equal(urls[0], '/welle?sha=shaA');
  assert.ok(a && b && a !== b);
  assert.equal(a.width, 40); assert.equal(a.height, 12);
  await daumen('shaA', 80, 12);
  assert.equal(urls.length, 1, 'another size: drawn again, not fetched again');
});

test('a failed fetch resolves null, draws nothing and is asked again next time', async () => {
  let n = 0, leinwaende = 0;
  const alt = document.createElement; document.createElement = (t) => { if (t === 'canvas') leinwaende++; return alt(t); };
  const urls = fetchMit(() => (++n === 1 ? { ok: false, status: 500 } : { ok: true, status: 200, arrayBuffer: async () => djkw() }));
  assert.equal(await daumen('shaB', 40, 12), null);
  assert.equal(leinwaende, 0);
  assert.ok(await daumen('shaB', 40, 12));
  assert.equal(urls.length, 2);
  fetchMit(() => { throw new Error('offline'); });
  assert.equal(await daumen('shaC', 40, 12), null);
  assert.equal(await daumen('', 40, 12), null, 'no sha: no request');
  document.createElement = alt;
});

test('ten subscribers of starteTakt run one rAF loop that stops with the last one', () => {
  const rahmen = []; let aufrufe = 0;
  globalThis.requestAnimationFrame = (f) => { aufrufe++; rahmen.push(f); return aufrufe; };
  const gesehen = Array(10).fill(0);
  const ab = gesehen.map((_, i) => starteTakt(() => { gesehen[i]++; }));
  assert.equal(aufrufe, 1);
  rahmen.shift()(16);
  assert.deepEqual(gesehen, Array(10).fill(1));
  assert.equal(aufrufe, 2, 'one request per frame, not one per subscriber');
  ab.forEach((f) => f());
  rahmen.shift()(32);
  assert.deepEqual(gesehen, Array(10).fill(1));
  assert.equal(aufrufe, 2, 'loop stopped');
  ab[0] = starteTakt(() => {});
  assert.equal(aufrufe, 3, 'a new subscriber starts it again');
  ab[0]();
});

test('thumbnail fetches run one at a time, the playing strip first; a 429 is retried until it arrives', async () => {
  leereWellen(); wellenEinstellung.backoffMs = 1;
  let laeuft = 0, hoechstens = 0, verdraengt = 1;
  const reihenfolge = [];
  globalThis.fetch = async (u) => {
    const sha = String(u).split('=')[1];
    laeuft++; hoechstens = Math.max(hoechstens, laeuft);
    await new Promise((ok) => setImmediate(ok));
    laeuft--;
    // a server with one decode slot: a concurrent call is displaced; sha 'q3' is displaced once even when alone
    if (hoechstens > 1) return { ok: false, status: 429 };
    if (sha === 'q3' && verdraengt-- > 0) return { ok: false, status: 429 };
    reihenfolge.push(sha);
    return { ok: true, status: 200, arrayBuffer: async () => djkw() };
  };
  const shas = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];
  const alle = shas.map((s) => daumen(s, 40, 12));
  const streifen = daumen('q6', 240, 14, true);   // the strip of the playing cell: wanted first
  const ergebnis = await Promise.all([...alle, streifen]);
  assert.ok(ergebnis.every((k) => k), 'every thumbnail arrives eventually');
  assert.equal(hoechstens, 1, 'never more than one request in flight');
  assert.equal(reihenfolge[0], 'q1', 'the first request had already started');
  assert.equal(reihenfolge[1], 'q6', 'the strip jumps the queue');
  assert.deepEqual([...reihenfolge].sort(), shas);
  wellenEinstellung.backoffMs = 400;
});

test('a 429 that never ends gives up with null and the next call asks again', async () => {
  leereWellen(); wellenEinstellung.backoffMs = 1; wellenEinstellung.versuche = 2;
  let n = 0;
  globalThis.fetch = async () => { n++; return { ok: false, status: 429 }; };
  assert.equal(await daumen('z1', 40, 12), null);
  assert.equal(n, 3, 'first try plus two retries');
  globalThis.fetch = async () => { n++; return { ok: true, status: 200, arrayBuffer: async () => djkw() }; };
  assert.ok(await daumen('z1', 40, 12));
  wellenEinstellung.backoffMs = 400; wellenEinstellung.versuche = 6;
});
