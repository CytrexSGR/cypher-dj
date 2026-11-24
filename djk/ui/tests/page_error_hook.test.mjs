// R7: the page hook (classic script) with a stubbed window, document and fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { element } from './support/dom_mock.mjs';

let zaehler = 0;
async function lade(fetchStub) {
  const ereignisse = {};
  const knopf = element('button'); knopf.dataset.ansicht = 'produktion';
  const alt = { addEventListener: globalThis.addEventListener, fetch: globalThis.fetch, document: globalThis.document };
  globalThis.addEventListener = (n, f) => { ereignisse[n] = f; };
  globalThis.document = { querySelector: (sel) => (sel === '#kopf [data-ansicht].an' ? knopf : null) };
  const posts = [];
  globalThis.fetch = (u, o) => { posts.push({ u, o, j: JSON.parse(o.body) }); return fetchStub ? fetchStub() : Promise.resolve({ ok: true }); };
  await import(`../public/page_error.js?v=${++zaehler}`);
  return { ereignisse, posts, ende: () => Object.assign(globalThis, alt) };
}

test('an error event posts message, file, line, column, view and time', async (t) => {
  const h = await lade(); t.after(h.ende);
  h.ereignisse.error({ message: 'boom', filename: 'http://x/app.js', lineno: 7, colno: 9 });
  assert.equal(h.posts.length, 1);
  const { u, o, j } = h.posts[0];
  assert.equal(u, '/seite/fehler'); assert.equal(o.method, 'POST'); assert.equal(o.keepalive, true);
  assert.deepEqual([j.meldung, j.datei, j.zeile, j.spalte, j.ansicht], ['boom', 'http://x/app.js', 7, 9, 'produktion']);
  assert.ok(j.zeit);
});

test('odd values each post one request and never throw', async (t) => {
  const h = await lade(); t.after(h.ende);
  assert.doesNotThrow(() => h.ereignisse.error({ message: '', error: 'text' }));
  assert.doesNotThrow(() => h.ereignisse.unhandledrejection({ reason: undefined }));
  assert.doesNotThrow(() => h.ereignisse.error({ message: 'Script error.', filename: '', lineno: 0, colno: 0 }));
  assert.doesNotThrow(() => h.ereignisse.error({ message: 'm'.repeat(1 << 20) }));
  assert.doesNotThrow(() => h.ereignisse.unhandledrejection(undefined));
  assert.doesNotThrow(() => h.ereignisse.error(null));
  assert.equal(h.posts.length, 6);
  assert.equal(h.posts[0].j.meldung, 'text');
  assert.equal(h.posts[3].j.meldung.length, 500);
});

test('the 51st error within a minute posts nothing', async (t) => {
  const h = await lade(); t.after(h.ende);
  for (let i = 0; i < 60; i++) h.ereignisse.error({ message: 'e' + i });
  assert.equal(h.posts.length, 50);
});

test('a fetch that rejects, throws or answers 500 raises no new error', async () => {
  for (const stub of [() => Promise.reject(new Error('net')), () => { throw new Error('sync'); }, () => Promise.resolve({ ok: false, status: 500 })]) {
    const h = await lade(stub);
    try {
      assert.doesNotThrow(() => h.ereignisse.error({ message: 'x' }));
      await new Promise((r) => setImmediate(r));
      assert.equal(h.posts.length, 1);
    } finally { h.ende(); }
  }
});
