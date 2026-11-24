// Layout audit script (check/layout_check.js): evaluated in a vm against fake elements, the way Chrome runs it against a page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const QUELLE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'check', 'layout_check.js'), 'utf8');

const rect = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });
function el(tag, o = {}) {
  const attr = { ...(o.attr ?? {}) };
  return {
    tagName: tag.toUpperCase(), id: o.id ?? '', className: o.cls ?? '', hidden: !!o.hidden,
    children: [], textContent: o.text ?? '', scrollWidth: o.scroll ?? 0, clientWidth: o.client ?? 0,
    getBoundingClientRect: () => o.rect ?? rect(0, 0, 100, 30),
    getAttribute: (n) => (n in attr ? attr[n] : null),
    closest: () => null,
  };
}
function docVon(elemente) {
  return {
    defaultView: { innerWidth: 1366, innerHeight: 768, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    querySelectorAll: () => elemente,
    querySelector: (s) => elemente.find((e) => e.id && s === `#${e.id}`) ?? null,
  };
}
function lauf(elemente, opt) {
  const ctx = vm.createContext({});
  vm.runInContext(QUELLE, ctx);
  assert.equal(typeof ctx.layoutPruefung, 'function');
  return JSON.parse(JSON.stringify(ctx.layoutPruefung(docVon(elemente), opt)));   // plain objects: the vm realm has its own Array prototype
}

test('a button of 14x14 is in klein with its size', () => {
  const r = lauf([el('button', { id: 'k', rect: rect(10, 10, 14, 14), text: 'K' })]);
  assert.deepEqual(r.klein.map((k) => [k.w, k.h]), [[14, 14]]);
  assert.equal(r.viewport.w, 1366);
  assert.equal(r.viewport.h, 768);
});

test('cut text: no title is a finding, a full title with 12 visible characters is none, with 3 it is one', () => {
  const text = 'TRACK 2 · no track loaded';
  assert.equal(text.length, 25);
  let r = lauf([el('span', { text, client: 40, scroll: 170 })]);
  assert.equal(r.abgeschnitten.length, 1);
  assert.equal(r.abgeschnitten[0].mitTitel, false);
  r = lauf([el('span', { text, client: 48, scroll: 100, attr: { title: text } })]);
  assert.equal(r.abgeschnitten.length, 0);
  r = lauf([el('span', { text, client: 12, scroll: 100, attr: { title: text } })]);
  assert.equal(r.abgeschnitten.length, 1);
  assert.equal(r.abgeschnitten[0].sichtbar, 3);
  assert.equal(r.abgeschnitten[0].mitTitel, true);
});

test('two buttons overlapping by 10 px give one ueberlappt, a button inside a role=button container does not', () => {
  let r = lauf([el('button', { id: 'a', rect: rect(0, 0, 40, 30) }), el('button', { id: 'b', rect: rect(30, 0, 40, 30) })]);
  assert.equal(r.ueberlappt.length, 1);
  r = lauf([el('div', { id: 'bar', attr: { role: 'button' }, rect: rect(0, 0, 200, 40) }), el('button', { id: 'in', rect: rect(10, 5, 40, 30) })]);
  assert.equal(r.ueberlappt.length, 0);
  r = lauf([el('button', { id: 'a', rect: rect(0, 0, 40, 30) }), el('button', { id: 'b', rect: rect(100, 0, 40, 30) })]);
  assert.equal(r.ueberlappt.length, 0);
});

test('opt.paare reports overlapping plain elements', () => {
  const r = lauf([el('div', { id: 'mischer', rect: rect(0, 0, 100, 100) }), el('div', { id: 'deck-c', rect: rect(50, 50, 100, 100) })], { paare: [['#mischer', '#deck-c']] });
  assert.deepEqual(r.ueberlappt, [{ a: '#mischer', b: '#deck-c' }]);
});

test('ausserhalb: an interactive element leaving the viewport', () => {
  const r = lauf([el('button', { id: 'loop', rect: rect(1300, 10, 100, 30) }), el('button', { id: 'ok', rect: rect(10, 10, 100, 30) })]);
  assert.deepEqual(r.ausserhalb.map((x) => x.sel), ['button#loop']);
});

test('ohneName: an input without any name, with aria-label it is named', () => {
  let r = lauf([el('input')]);
  assert.equal(r.ohneName.length, 1);
  r = lauf([el('input', { attr: { 'aria-label': 'Name' } })]);
  assert.equal(r.ohneName.length, 0);
});

test('deutsch: the word "leer" is found as a whole word, "empty" is not, in text and title', () => {
  let r = lauf([el('span', { text: 'Show leer here' })]);
  assert.deepEqual(r.deutsch.map((d) => d.wort), ['leer']);
  r = lauf([el('span', { text: 'Show empty here' })]);
  assert.equal(r.deutsch.length, 0);
  r = lauf([el('span', { text: 'Cypher Comp', attr: { title: 'Cypher Saett' } })]);
  assert.deepEqual(r.deutsch.map((d) => d.wort), ['Saett']);
});

test('hidden and zero-size elements are never reported', () => {
  const r = lauf([el('button', { hidden: true, rect: rect(0, 0, 10, 10) }), el('button', { rect: rect(0, 0, 0, 0) })]);
  assert.equal(r.klein.length, 0);
});
