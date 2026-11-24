// UI polish T7 (Nr. 2): the compact default of the folded panels under the arrangement; a stored choice always wins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { standardZu, bindeEinklappen } from '../public/production/einklappen.js';

const VIER = ['dock-spuren', 'dock-gruppen', 'dock-fx', 'detail'];

test('standardZu: the four panels at 768, none at 1080, the stored choice wins, an empty choice means all open', () => {
  assert.deepEqual([...standardZu(768, null)].sort(), [...VIER].sort());
  assert.deepEqual([...standardZu(820, null)].sort(), [...VIER].sort());
  assert.equal(standardZu(821, null).size, 0);
  assert.equal(standardZu(1080, null).size, 0);
  assert.deepEqual(standardZu(768, new Set(['detail'])), new Set(['detail']));
  assert.equal(standardZu(768, new Set()).size, 0);
});

// a panel part as the stand-in: a class set and a title with attributes
function teil() {
  const klassen = new Set(), tk = new Set(), attr = {};
  const titel = { classList: { add: (k) => tk.add(k) }, setAttribute: (k, v) => { attr[k] = v; }, addEventListener() {}, tabIndex: 0 };
  const el = { classList: { toggle: (k, an) => { if (an) klassen.add(k); else klassen.delete(k); }, contains: (k) => klassen.has(k) }, querySelector: (s) => (s === '[data-d="leer"]' ? null : titel) };
  return { klassen, el };
}
function ctxMit() {
  const t = { 'dock-spuren': teil(), 'dock-gruppen': teil(), 'dock-fx': teil(), detail: teil() };
  const reihe = { '[data-w="dock-synths"]': 'dock-spuren', '[data-w="dock-grp"]': 'dock-gruppen', '[data-w="dock-fx"]': 'dock-fx' };
  const dock = { querySelector: (s) => ({ parentElement: t[reihe[s]].el }) };
  return { t, ctx: { $: (n) => (n === 'dock-wurzel' ? dock : n === 'detail' ? t.detail.el : null) } };
}
function mitUmgebung(hoch, speicher, f) {
  const altW = globalThis.window, altL = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  globalThis.window = { innerHeight: hoch };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: speicher });
  try { f(); } finally {
    globalThis.window = altW;
    if (altL) Object.defineProperty(globalThis, 'localStorage', altL); else delete globalThis.localStorage;
  }
}
const zu = (a) => Object.keys(a.t).filter((k) => a.t[k].klassen.has('p-zu')).sort();

test('bindeEinklappen at 768 without a stored choice folds the four panels; at 1080 none', () => {
  const leer = { getItem: () => null, setItem() {} };
  let a = ctxMit();
  mitUmgebung(768, leer, () => bindeEinklappen(a.ctx));
  assert.deepEqual(zu(a), [...VIER].sort());
  a = ctxMit();
  mitUmgebung(1080, leer, () => bindeEinklappen(a.ctx));
  assert.deepEqual(zu(a), []);
});

test('a stored choice wins at 768; a throwing localStorage gives the compact default', () => {
  let a = ctxMit();
  mitUmgebung(768, { getItem: () => JSON.stringify(['detail']), setItem() {} }, () => bindeEinklappen(a.ctx));
  assert.deepEqual(zu(a), ['detail']);
  a = ctxMit();
  mitUmgebung(768, { getItem: () => { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, () => bindeEinklappen(a.ctx));
  assert.deepEqual(zu(a), [...VIER].sort());
});

test('the stylesheet gives the arrangement 300 px at compact height and lets CLIP unfold to clamp(220px, 34vh, 360px)', () => {
  const css = fs.readFileSync(new URL('../public/production/production.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-height: 820px\) \{[^}]*grid-template-rows: auto minmax\(300px, 1fr\) auto auto auto auto; overflow-y: auto/);
  assert.match(css, /\.p-detail:not\(\.p-zu\) \{ height: clamp\(220px, 34vh, 360px\); \}/);
  assert.match(css, /\.p-roll-leiste input \{ width: 7ch;/);
  assert.match(css, /\.p-transport \[data-p="neu-name"\] \{ min-width: 18ch; flex: 1 1 18ch; \}/);
});
