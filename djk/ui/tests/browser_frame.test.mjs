// Browser component frame (browser plan 2, task 3): open/closed state per view, remembered in localStorage and never fatal without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_SCHLUESSEL, liesOffen, merkeOffen, tasteB, drawerBreite, schalte } from '../public/browser/frame.js';

const speicher = (start = {}) => { const m = new Map(Object.entries(start)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const kaputt = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

test('keys differ per view', () => {
  assert.equal(BROWSER_SCHLUESSEL('produktion'), 'djk-browser-offen-produktion');
  assert.notEqual(BROWSER_SCHLUESSEL('dj'), BROWSER_SCHLUESSEL('tracker'));
});

test('liesOffen: defaults are open in PRODUCTION and closed elsewhere; a throwing storage gives the default', () => {
  assert.equal(liesOffen(speicher(), 'produktion'), true);
  for (const a of ['dj', 'werkbank', 'tracker']) assert.equal(liesOffen(speicher(), a), false);
  assert.equal(liesOffen(kaputt, 'produktion'), true);
  assert.equal(liesOffen(kaputt, 'dj'), false);
  assert.equal(liesOffen(undefined, 'produktion'), true);
});

test('merkeOffen round trip per view; no throw without storage', () => {
  const s = speicher();
  merkeOffen(s, 'dj', true);
  assert.equal(liesOffen(s, 'dj'), true);
  assert.equal(liesOffen(s, 'tracker'), false);
  merkeOffen(s, 'produktion', false);
  assert.equal(liesOffen(s, 'produktion'), false);
  merkeOffen(kaputt, 'dj', true);
  merkeOffen(undefined, 'dj', true);
});

// ---- task 5: the drawer, the key B, the width ----
const ziel = (tag, extra = {}) => ({ closest: (sel) => (sel.split(',').map((s) => s.trim()).includes(tag) || (extra.contenteditable && sel.includes('contenteditable')) ? {} : null) });

test('tasteB: a plain b or B outside text fields only', () => {
  assert.equal(tasteB({ key: 'b', target: ziel('div') }), true);
  assert.equal(tasteB({ key: 'B', target: ziel('div') }), true);
  assert.equal(tasteB({ key: 'b', ctrlKey: true, target: ziel('div') }), false);
  assert.equal(tasteB({ key: 'b', metaKey: true, target: ziel('div') }), false);
  assert.equal(tasteB({ key: 'b', altKey: true, target: ziel('div') }), false);
  assert.equal(tasteB({ key: 'B', target: ziel('input') }), false);
  assert.equal(tasteB({ key: 'B', target: ziel('textarea') }), false);
  assert.equal(tasteB({ key: 'B', target: ziel('x', { contenteditable: true }) }), false);
  assert.equal(tasteB({ key: 'c', target: ziel('div') }), false);
});

test('drawerBreite: 360 by default, narrower to stay left of what must stay free, never under 280', () => {
  assert.equal(drawerBreite({ fenster: 1366, sperrLinks: [420, 900] }), 360);
  assert.equal(drawerBreite({ fenster: 1366, sperrLinks: [300] }), 292);
  assert.equal(drawerBreite({ fenster: 1366, sperrLinks: [200] }), 280);
  assert.equal(drawerBreite({ fenster: 1366, sperrLinks: [] }), 360);
  assert.equal(drawerBreite({ fenster: 1366, sperrLinks: [500], max: 320 }), 320);
});

test('schalte sets the class and remembers; a throwing storage does not stop it', () => {
  const klassen = new Set();
  globalThis.document = { body: { classList: { toggle: (k, an) => { if (an) klassen.add(k); else klassen.delete(k); } } } };
  const s = speicher();
  schalte('dj', true, kaputt);
  assert.ok(klassen.has('browser-offen'));
  schalte('dj', false, s);
  assert.ok(!klassen.has('browser-offen'));
  assert.equal(liesOffen(s, 'dj'), false);
  schalte('produktion', false, s);
  assert.ok(klassen.has('browser-zu'));
  schalte('produktion', true, s);
  assert.ok(!klassen.has('browser-zu'));
  delete globalThis.document;
});
