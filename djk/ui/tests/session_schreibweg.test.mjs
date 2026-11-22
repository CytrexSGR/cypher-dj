import test from 'node:test';
import assert from 'node:assert/strict';
import { neuerSessionSchreiber } from '../public/session/schreibweg.js';

const bau = (antwort, start = 5) => {
  const aufrufe = []; let stand = start, geladen = 0;
  const s = neuerSessionSchreiber({
    holeJson: async (weg, k) => { aufrufe.push(k); return antwort(k, aufrufe.length); },
    rev: () => stand,
    laden: async () => { geladen++; stand = 20; },
    melde: () => {},
  });
  return { s, aufrufe, geladen: () => geladen };
};

test('two quick writes: the second carries the revision the first one made', async () => {
  const { s, aufrufe } = bau((k) => ({ status: 200, j: { ok: true, rev: k.rev + 1 } }));
  const a = s.aendere('Solo', [{ befehl: 'x' }]), b = s.aendere('Arm', [{ befehl: 'y' }]);
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.deepEqual(aufrufe.map((k) => k.rev), [5, 6]);
});

test('a stale revision reloads and writes the same value again', async () => {
  const { s, aufrufe, geladen } = bau((k) => (k.rev < 20 ? { status: 409, j: { fehler: 'rev_veraltet' } } : { status: 200, j: { ok: true, rev: 21 } }));
  assert.equal(await s.aendere('Solo', [{ befehl: 'x' }]), true);
  assert.deepEqual(aufrufe.map((k) => k.rev), [5, 20]);
  assert.equal(geladen(), 1);
});

test('a refusal resolves false and the next write still goes out', async () => {
  const { s } = bau((k, n) => (n === 1 ? { status: 400, j: { text: 'no' } } : { status: 200, j: { ok: true, rev: 9 } }));
  assert.equal(await s.aendere('a', [{}]), false);
  assert.equal(await s.aendere('b', [{}]), true);
});

test('review: a stale revision whose reload is only scheduled (rev() does not move) still retries with the current revision, after a pause, at most 1+3 times', async () => {
  const zeiten = [], aufrufe = [];
  let nachlesen = 0;
  const s = neuerSessionSchreiber({
    holeJson: async (weg, k) => { aufrufe.push(k.rev); zeiten.push(Date.now()); return k.rev < 20 ? { status: 409, j: { fehler: 'rev_veraltet' } } : { status: 200, j: { ok: true, rev: 21 } }; },
    rev: () => 5,                                  // pruefeLive returned early: the page's own rev stays stale
    laden: async () => {},
    aktuelleRev: async () => { nachlesen++; return 20; },
    melde: () => {},
  });
  assert.equal(await s.aendere('Solo', [{ befehl: 'x' }]), true);
  assert.deepEqual(aufrufe, [5, 20]);
  assert.equal(nachlesen, 1);
  assert.ok(zeiten[1] - zeiten[0] >= 70, `pause ${zeiten[1] - zeiten[0]} ms`);
  // a revision that never catches up: 1 + 3 attempts, then refused
  const alle = [];
  const t = neuerSessionSchreiber({ holeJson: async (w, k) => { alle.push(k.rev); return { status: 409, j: { fehler: 'rev_veraltet' } }; }, rev: () => 5, aktuelleRev: async () => 5, melde: () => {} });
  assert.equal(await t.aendere('Arm', [{ befehl: 'y' }]), false);
  assert.equal(alle.length, 4);
});
