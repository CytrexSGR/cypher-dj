// The browser tag client against a fake fetch, and the resolver against the real vocabulary of the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ladeVokabular, loeseTag, tagsVon, setzen, suche, verwandt, gespeichert, merke, vergiss } from '../public/browser/tags_client.js';
import { vokabularAntwort } from '../tags/vocabulary_item.ts';

const V = JSON.parse(JSON.stringify(vokabularAntwort()));

function mitFetch(antwort) {
  const gesehen = [];
  const alt = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    gesehen.push({ url, methode: opt.method ?? 'GET', koerper: opt.body ? JSON.parse(opt.body) : null, typ: opt.headers?.['content-type'] });
    const [code, j] = typeof antwort === 'function' ? antwort(url) : antwort;
    return { ok: code < 400, status: code, json: async () => j };
  };
  return { gesehen, ende: () => { globalThis.fetch = alt; } };
}

test('loeseTag follows the rules of the plan', () => {
  const l = (x) => loeseTag(x, V);
  assert.equal(l(' Kick '), 'typ:kick');
  assert.equal(l('dark'), 'charakter:dark');
  assert.equal(l('techno'), 'genre:techno');
  assert.equal(l('8A'), 'tonart:8A');
  assert.equal(l('8a'), 'tonart:8A');
  assert.equal(l('128'), 'tempo:128');
  assert.equal(l('my own tag'), 'frei:my own tag');
  assert.equal(l('Größe'), null);
  assert.equal(l('x'.repeat(25)), null);
  assert.equal(l('x'.repeat(24)), `frei:${'x'.repeat(24)}`);
  assert.equal(l(''), null);
  assert.equal(l('   '), null);
  // full forms
  assert.equal(l('typ:kick'), 'typ:kick');
  assert.equal(l('FREI:Favorites'), 'frei:favorites');
  assert.equal(l('tempo:128'), 'tempo:128');
  assert.equal(l('tempo:300'), null);
  assert.equal(l('typ:nope'), null);
  assert.equal(l('nope:kick'), null);
  assert.equal(l('deep house'), 'genre:deep_house');
  assert.equal(l('3'), 'energie:3');
  assert.equal(l('039'), 'frei:039', 'a number with a leading zero is not a tempo; it fits the free rule');
});

test('a bare word that exists in several arts is null so the UI asks', () => {
  const v = { arten: [{ art: 'typ', woerter: [{ wort: 'pad' }, { wort: 'kick' }] }, { art: 'einsatz', woerter: [{ wort: 'pad' }] }, { art: 'frei', frei: true, woerter: [] }] };
  assert.equal(loeseTag('pad', v), null);
  assert.equal(loeseTag('kick', v), 'typ:kick');
  assert.equal(loeseTag('typ:pad', v), 'typ:pad');
  assert.equal(loeseTag('einsatz:pad', v), 'einsatz:pad');
});

test('every function sends the route method and path and returns the parsed answer', async () => {
  const f = mitFetch([200, { ok: true, z: 1 }]);
  try {
    await ladeVokabular(); await tagsVon('datei:ab'); await setzen(['a', 'b'], ['typ:kick'], true); await verwandt('loop:x y');
    await gespeichert(); await merke({ name: 'n', tags: ['typ:kick'], text: 't', art: 'loop' }); await vergiss('n');
    await suche({ tags: ['typ:kick', 'frei:a b'], text: 'dark kick', art: 'loop' }); await suche({});
    assert.deepEqual(f.gesehen.map((g) => [g.methode, g.url]), [
      ['GET', '/tags/vokabular'], ['GET', '/tags?item=datei%3Aab'], ['POST', '/tags/setzen'], ['GET', '/tags/verwandt?item=loop%3Ax%20y'],
      ['GET', '/tags/gespeichert'], ['POST', '/tags/gespeichert'], ['POST', '/tags/gespeichert/weg'],
      ['GET', '/tags/suche?tags=typ%3Akick,frei%3Aa%20b&text=dark%20kick&art=loop'], ['GET', '/tags/suche']]);
    assert.deepEqual(f.gesehen[2].koerper, { items: ['a', 'b'], tags: ['typ:kick'], an: true });
    assert.equal(f.gesehen[2].typ, 'application/json');
    assert.deepEqual(f.gesehen[5].koerper, { name: 'n', tags: ['typ:kick'], text: 't', art: 'loop' });
    assert.deepEqual(f.gesehen[6].koerper, { name: 'n' });
    assert.deepEqual(await tagsVon('x'), { ok: true, z: 1 });
  } finally { f.ende(); }
});

test('an error answer becomes an Error with grund and text; a dead server too', async () => {
  let f = mitFetch([400, { ok: false, grund: 'tag_ungueltig', fehler: 'tag_ungueltig', text: 'that is not a valid tag', betroffen: 'typ:x' }]);
  try {
    await assert.rejects(setzen(['a'], ['typ:x'], true), (e) => e instanceof Error && e.grund === 'tag_ungueltig' && e.text === 'that is not a valid tag' && e.message === e.text && e.betroffen === 'typ:x' && e.code === 400);
  } finally { f.ende(); }
  f = mitFetch([404, { fehler: 'keine_route', text: 'nope' }]);
  try { await assert.rejects(tagsVon('x'), (e) => e.grund === 'keine_route' && e.text === 'nope'); } finally { f.ende(); }
  f = mitFetch([500, null]);
  try { await assert.rejects(tagsVon('x'), (e) => e.grund === 'http_500' && typeof e.text === 'string'); } finally { f.ende(); }
  const alt = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try { await assert.rejects(tagsVon('x'), (e) => e.grund === 'netz' && /fetch failed/.test(e.text)); } finally { globalThis.fetch = alt; }
});
