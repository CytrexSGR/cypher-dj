// UI polish task 5: the library dock starts closed on a compact height (768 px) in the DJ view, so the desk gets the height. A stored choice always wins;
// PRODUCTION, STUDIO and TRACKER never take the default. Pure rule plus the real bindeSchublade against the DOM stand-in.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
let rahmen;

before(async () => {
  installiere({ html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] } } });
  rahmen = await import('../public/seitenrahmen.js');
});

test('bibliothekStartOffen: the five cases of the decision, and no default outside the DJ view', () => {
  const f = rahmen.bibliothekStartOffen;
  assert.equal(f(768, null, 'dj'), false);
  assert.equal(f(768, null, 'produktion'), true);
  assert.equal(f(1080, null, 'dj'), true);
  assert.equal(f(768, 'auf', 'dj'), true);
  assert.equal(f(768, 'zu', 'dj'), false);
  for (const a of ['produktion', 'werkbank', 'tracker']) assert.equal(f(700, null, a), true, a);
  assert.equal(f(820, null, 'dj'), false, '820 is still compact');
  assert.equal(f(821, null, 'dj'), true);
  assert.equal(f(1080, 'zu', 'dj'), false, 'a stored choice wins at any height');
});

const mitSpeicher = (speicher, hoch) => {
  const ls = new Map(Object.entries(speicher));
  globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  globalThis.innerHeight = hoch;
  attrappe.body.classList.remove('lib-zu');
  return ls;
};

test('a throwing localStorage at 768 px on the DJ view: the dock starts closed, and nothing is written', () => {
  globalThis.innerHeight = 768;
  attrappe.body.classList.remove('lib-zu');
  let schreib = 0;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { schreib++; throw new Error('blocked'); }, removeItem() {} };
  rahmen.bindeSchublade();
  assert.equal(attrappe.body.classList.contains('lib-zu'), true);
  assert.equal(schreib, 0, 'the default is not a choice, it is not stored');
});

test('no stored value at 768 px: closed and not stored; at 1080 px: open', () => {
  let ls = mitSpeicher({}, 768);
  rahmen.bindeSchublade();
  assert.equal(attrappe.body.classList.contains('lib-zu'), true);
  assert.equal(ls.has('djk-lib'), false);
  ls = mitSpeicher({}, 1080);
  rahmen.bindeSchublade();
  assert.equal(attrappe.body.classList.contains('lib-zu'), false);
});

test('a stored value wins on the compact height', () => {
  mitSpeicher({ 'djk-lib': 'auf' }, 768);
  rahmen.bindeSchublade();
  assert.equal(attrappe.body.classList.contains('lib-zu'), false);
  mitSpeicher({ 'djk-lib': 'zu' }, 1080);
  rahmen.bindeSchublade();
  assert.equal(attrappe.body.classList.contains('lib-zu'), true);
});

test('PRODUCTION and STUDIO remembered: the compact default never closes the dock', () => {
  for (const ansicht of ['produktion', 'werkbank', 'tracker']) {
    mitSpeicher({ 'djk-ansicht': ansicht }, 768);
    rahmen.bindeSchublade();
    assert.equal(attrappe.body.classList.contains('lib-zu'), false, ansicht);
  }
});

test('the default follows the view: DJ closed, PRODUCTION open, back in DJ closed again; a choice ends the default', () => {
  mitSpeicher({}, 768);
  rahmen.bindeSchublade();
  assert.equal(attrappe.body.classList.contains('lib-zu'), true);
  rahmen.setzeAnsicht('produktion', false);
  assert.equal(attrappe.body.classList.contains('lib-zu'), false, 'PRODUCTION shows its panel');
  rahmen.setzeAnsicht('dj', false);
  assert.equal(attrappe.body.classList.contains('lib-zu'), true);
  attrappe.body.querySelector('#schublade').click();   // the viewer opens the dock: now it is a choice
  assert.equal(attrappe.body.classList.contains('lib-zu'), false);
  rahmen.setzeAnsicht('produktion', false);
  rahmen.setzeAnsicht('dj', false);
  assert.equal(attrappe.body.classList.contains('lib-zu'), false, 'the choice stays');
});
