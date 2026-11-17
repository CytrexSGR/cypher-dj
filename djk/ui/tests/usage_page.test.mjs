// Page helpers for favourites and recently used (stubbed post).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

installiere();
const { setzeFavorit, merkeBenutzt, sternKnopf, FAVORITEN_SLUG, ZULETZT_SLUG } = await import('../public/usage.js');
const ruhe = async () => { for (let i = 0; i < 6; i++) await new Promise((ok) => setImmediate(ok)); };

test('setzeFavorit posts hinzu, or weg, of {art:sample, sha} to /kollektionen/favourites/posten', async () => {
  const an = [];
  const post = async (u, k) => { an.push([u, k]); return { status: 200, j: {} }; };
  assert.deepEqual(await setzeFavorit(post, 'aaa', true), { ok: true });
  assert.deepEqual(await setzeFavorit(post, 'aaa', false), { ok: true });
  assert.equal(FAVORITEN_SLUG, 'favourites');
  assert.deepEqual(an, [['/kollektionen/favourites/posten', { hinzu: [{ art: 'sample', sha: 'aaa' }] }], ['/kollektionen/favourites/posten', { weg: [{ art: 'sample', sha: 'aaa' }] }]]);
});

test('setzeFavorit answers a refusal with its text', async () => {
  const r = await setzeFavorit(async () => ({ status: 409, j: { fehler: 'x', text: 'fixed collection is full' } }), 'aaa', true);
  assert.deepEqual(r, { ok: false, text: 'Fixed collection is full' });
  assert.equal((await setzeFavorit(async () => { throw new Error('net'); }, 'aaa', true)).ok, false);
});

test('merkeBenutzt posts {weg:[p], hinzu:[p]} to /kollektionen/recently-used/posten and resolves on a 409', async () => {
  const an = [];
  await merkeBenutzt(async (u, k) => { an.push([u, k]); return { status: 409, j: {} }; }, 'bbb');
  const p = { art: 'sample', sha: 'bbb' };
  assert.equal(ZULETZT_SLUG, 'recently-used');
  assert.deepEqual(an, [['/kollektionen/recently-used/posten', { weg: [p], hinzu: [p] }]]);
  await merkeBenutzt(async () => { throw new Error('net'); }, 'bbb');
});

test('sternKnopf flips at once and flips back on a refusal', async () => {
  const meldungen = [];
  let tor;
  const post = () => new Promise((ok) => { tor = ok; });
  const t = { sha: 'aaa', favorit: false };
  const b = sternKnopf(t, post, (x, f) => meldungen.push([x, f]));
  assert.equal(b.getAttribute('data-w'), 'stern');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.equal(b.getAttribute('title'), 'Mark as favourite');
  b.dispatch('click');
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.equal(b.textContent, '★');
  tor({ status: 409, j: { text: 'refused' } }); await ruhe();
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.equal(t.favorit, false);
  assert.deepEqual(meldungen, [['Refused', true]]);
});
