// UI polish fix: the PHONES key of the header (kopf_phones.js) and the REC OPTIONS fold of the transport (einklappen.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindePhonesKnopf } from '../public/kopf_phones.js';
import { bindeRecOptionen } from '../public/production/einklappen.js';

function klassen() {
  const s = new Set();
  return { toggle: (k, an) => { if (an === undefined ? !s.has(k) : an) s.add(k); else s.delete(k); }, contains: (k) => s.has(k), add: (k) => s.add(k), remove: (k) => s.delete(k) };
}

test('PHONES key: opens and closes the pop-over, Escape and a click outside close it, aria-expanded follows', () => {
  const box = { classList: klassen(), contains: (t) => t === box || t === knopfEl };
  const attr = {};
  const knopfEl = { setAttribute: (k, v) => { attr[k] = v; }, closest: () => box, handler: null, addEventListener(t, f) { this.handler = f; } };
  const reg = {};
  const doc = { querySelector: () => knopfEl, addEventListener: (t, f) => { reg[t] = f; } };
  assert.ok(bindePhonesKnopf(doc));
  knopfEl.handler({ stopPropagation() {} });
  assert.equal(box.classList.contains('offen'), true);
  assert.equal(attr['aria-expanded'], 'true');
  reg.click({ target: knopfEl });                       // inside: stays open
  assert.equal(box.classList.contains('offen'), true);
  reg.click({ target: {} });                            // outside: closes
  assert.equal(box.classList.contains('offen'), false);
  assert.equal(attr['aria-expanded'], 'false');
  knopfEl.handler({ stopPropagation() {} });
  reg.keydown({ key: 'Escape' });
  assert.equal(box.classList.contains('offen'), false);
  assert.equal(bindePhonesKnopf({ querySelector: () => null, addEventListener() {} }), null, 'no key in the page: nothing is bound');
});

test('REC OPTIONS key: folded by default, a click unfolds the transport options and remembers the choice', () => {
  const alt = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const speicher = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => speicher.get(k) ?? null, setItem: (k, v) => speicher.set(k, v) } });
  try {
    const leiste = { classList: klassen() };
    const attr = {};
    const knopf = { classList: klassen(), textContent: '', closest: () => leiste, setAttribute: (k, v) => { attr[k] = v; }, handler: null, addEventListener(t, f) { this.handler = f; } };
    bindeRecOptionen({ $: () => knopf });
    assert.equal(leiste.classList.contains('p-recopt-auf'), false);
    assert.equal(knopf.textContent, 'REC OPTIONS ▾');
    knopf.handler();
    assert.equal(leiste.classList.contains('p-recopt-auf'), true);
    assert.equal(attr['aria-expanded'], 'true');
    assert.equal(knopf.textContent, 'REC OPTIONS ▴');
    assert.equal(speicher.get('djk.produktion.recopt'), '1');
    // a new page load with the stored choice starts unfolded
    const leiste2 = { classList: klassen() };
    const knopf2 = { classList: klassen(), textContent: '', closest: () => leiste2, setAttribute() {}, addEventListener() {} };
    bindeRecOptionen({ $: () => knopf2 });
    assert.equal(leiste2.classList.contains('p-recopt-auf'), true);
  } finally {
    if (alt) Object.defineProperty(globalThis, 'localStorage', alt); else delete globalThis.localStorage;
  }
});
