// R9: LAB marks. The table, the DOM function (with a small fake), the selectors against the page sources and the docs blocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAB_ZEILEN } from '../public/lab_marken_table.js';
import { markiere, LAB_TEXT } from '../public/lab_marken.js';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(UI, '..', '..');
const SCOPE = path.join(REPO, 'docs', 'masterplan', 'SCOPE-1.0.md');

function element() {
  const e = { dataset: {}, kinder: [], append(k) { e.kinder.push(k); } };
  return e;
}
// a root that answers only the selectors it was given elements for
function wurzel(karte) {
  return {
    ownerDocument: { createElement: () => ({ className: '', title: '', textContent: '' }) },
    querySelectorAll(sel) { if (sel === '!!bad') throw new SyntaxError('bad selector'); return karte[sel] ?? []; },
  };
}

test('table and SCOPE-1.0.md list the same labs rows', (t) => {
  if (!fs.existsSync(SCOPE)) return t.skip('docs/masterplan is absent (public export)');
  const zeilen = fs.readFileSync(SCOPE, 'utf8').split('\n').filter((l) => l.startsWith('|'))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())).filter((c) => c[1] === 'labs').map((c) => c[0]);
  assert.equal(zeilen.length, 54);
  assert.deepEqual([...LAB_ZEILEN.map((z) => z.zeile)].sort(), [...zeilen].sort());
});

test('markiere adds one mark with the exact tooltip to every matched element', () => {
  const a = element(), b = element(), c = element();
  const tabelle = [{ zeile: 'x', seite: ['.a', '#b'] }, { zeile: 'y', seite: ['.c'] }, { zeile: 'z', seite: null }];
  const n = markiere(wurzel({ '.a': [a], '#b': [b], '.c': [c] }), tabelle);
  assert.equal(n, 3);
  for (const e of [a, b, c]) {
    assert.equal(e.kinder.length, 1);
    assert.equal(e.kinder[0].title, 'experimental, may change');
    assert.equal(e.kinder[0].title, LAB_TEXT);
    assert.equal(e.kinder[0].textContent, 'LAB');
    assert.equal(e.kinder[0].className, 'lab-marke');
    assert.notEqual(e.dataset.lab, undefined);
  }
});

test('markiere is idempotent', () => {
  const a = element();
  const w = wurzel({ '.a': [a] });
  const tabelle = [{ zeile: 'x', seite: ['.a'] }];
  assert.equal(markiere(w, tabelle), 1);
  assert.equal(markiere(w, tabelle), 0);
  assert.equal(a.kinder.length, 1);
});

test('a row with `text` marks only the elements whose text matches', () => {
  const lc = { ...element(), textContent: 'Launch Control 3' }, lpd = { ...element(), textContent: 'LPD8' };
  lc.kinder = []; lpd.kinder = [];
  lc.append = (k) => lc.kinder.push(k); lpd.append = (k) => lpd.kinder.push(k);
  const n = markiere(wurzel({ '.n': [lc, lpd] }), [{ zeile: 'x', seite: ['.n'], text: /Launch Control 3/i }]);
  assert.equal(n, 1);
  assert.equal(lc.kinder.length, 1);
  assert.equal(lpd.kinder.length, 0);
});

test('Launch Control 3 has a mark in the CONTROLLERS device list', () => {
  const z = LAB_ZEILEN.find((x) => x.zeile === 'Novation Launch Control 3');
  assert.deepEqual(z.seite, ['.reg-geraet-name']);
  assert.ok(z.text.test('Launch Control 3') && !z.text.test('LPD8'));
});

test('an unmatched or invalid selector does not throw', () => {
  const a = element();
  const n = markiere(wurzel({ '.a': [a] }), [{ zeile: 'x', seite: ['.nothing', '!!bad', '.a'] }]);
  assert.equal(n, 1);
});

function quellen(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? quellen(path.join(dir, d.name))
    : /\.(js|html)$/.test(d.name) && !/lab_marken/.test(d.name) ? [fs.readFileSync(path.join(dir, d.name), 'utf8')] : []));
}

test('every selector of the table occurs in the page sources', () => {
  const text = quellen(path.join(UI, 'public')).join('\n');
  for (const z of LAB_ZEILEN) for (const sel of z.seite ?? []) {
    // class and id names, attribute names and quoted attribute values of a selector; tag names are ignored
    const worte = [...sel.matchAll(/[.#]([\w-]+)/g)].map((m) => m[1])
      .concat([...sel.matchAll(/\[([\w-]+)/g)].map((m) => m[1]))
      .concat([...sel.matchAll(/="([^"]*)"/g)].map((m) => m[1]));
    assert.ok(worte.length > 0, `${z.zeile}: ${sel} has no class, id or attribute`);
    for (const wort of worte) assert.ok(text.includes(wort), `${z.zeile}: ${sel} (${wort}) is not in public/`);
  }
});

test('rows without a page element are named in README and manual', () => {
  const dateien = ['README.md', path.join('docs', 'features.md')].map((f) => path.join(REPO, 'docs', 'veroeffentlichung', 'public', f));
  for (const f of dateien) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(text.includes('experimental, may change'), `${f}: tooltip text`);
    for (const z of LAB_ZEILEN.filter((x) => x.seite === null)) assert.ok(text.includes(z.zeile), `${path.basename(f)} lacks: ${z.zeile}`);
  }
});

test('the LAB mark sits inside the right edge of its host and above the text line (no overflow, no scroll width)', () => {
  const css = fs.readFileSync(path.join(UI, 'public', 'lab_marken.css'), 'utf8');
  const regel = css.split('\n').find((z) => z.includes('position: absolute'));
  assert.match(regel, /right: 0;/);
  assert.match(regel, /top: -10px;/);
  assert.ok(!/right: -\d/.test(css), 'a negative right makes the host scroll wider than it is');
});
