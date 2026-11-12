// INSTRUMENTS area: tab markup (pure) and the binding with a tiny fake DOM (rebuild deferred while a pointer is down).
import test from 'node:test';
import assert from 'node:assert/strict';
import { instrumentReiterHtml, instrumentLabel, bindeInstrumente, lernPfadVon } from '../public/instruments_view.js';
import { GRAPH_KANAL_ART } from '../public/effects.js';

test('tabs: label and graph per channel, selected tab, picker and knob area in the body', () => {
  const h = instrumentReiterHtml(['erz/5', 'erz/6', 'pad/1'], 'erz/6', { 'erz/6': 'synth-mono' });
  assert.match(h, /<button[^>]*data-instrument="erz\/6"[^>]*aria-selected="true"[^>]*>I6 · synth-mono<\/button>/);
  assert.match(h, /<button[^>]*data-instrument="erz\/5"[^>]*aria-selected="false"[^>]*>I5 · empty<\/button>/);
  assert.match(h, />P1 · empty<\/button>/);
  assert.match(h, /<div class="graphplatz" data-graphplatz="erz\/6">/);
  assert.match(h, /<div class="bkliste">/);
  assert.ok(!h.includes('—'));
});

test('graph names are escaped', () => {
  const h = instrumentReiterHtml(['erz/5'], 'erz/5', { 'erz/5': '<img src=x onerror=1>' });
  assert.ok(!h.includes('<img'));
  assert.match(h, /&lt;img/);
});

test('labels cover every instrument channel of the picker', () => {
  for (const [k, art] of Object.entries(GRAPH_KANAL_ART)) if (art === 'instrument') assert.match(instrumentLabel(k), /^[IP]\d$/, k);
});

function fakeWurzel() {
  const ls = {};
  const w = { innerHTML: '', koerper: { id: 'k' }, addEventListener(t, f) { (ls[t] ??= []).push(f); }, querySelector() { return this.koerper; }, ls };
  return w;
}
test('graph change while a pointer is down in the knob area: rebuild only after pointerup', () => {
  const w = fakeWurzel();
  const dok = { ls: {}, addEventListener(t, f) { (this.ls[t] ??= []).push(f); } };
  let baut = 0;
  const a = bindeInstrumente({ kanaele: ['erz/5', 'erz/6'], wurzel: w, dokument: dok, graphVon: () => null, bindeKnobs: () => { baut++; }, zeigeGraphWahl: () => {}, speicher: null });
  a.baue(); assert.equal(baut, 1);
  w.ls.pointerdown[0]({ target: { closest: (sel) => (sel === '.bkliste' ? {} : null) } }); a.neuBauen(); assert.equal(baut, 1);
  dok.ls.pointerup[0]({}); assert.equal(baut, 2);
  a.neuBauen(); assert.equal(baut, 3);
});

test('tab switch reports the channel left (beiWechsel(alt, neu)); the same tab again does not; lernPfadVon matches only the channel own knob paths', () => {
  const w = fakeWurzel();
  const dok = { addEventListener() {} };
  const wechsel = [];
  const a = bindeInstrumente({ kanaele: ['erz/5', 'erz/6'], wurzel: w, dokument: dok, graphVon: () => null, bindeKnobs: () => {}, zeigeGraphWahl: () => {}, speicher: null, beiWechsel: (x, y) => wechsel.push([x, y]) });
  a.waehle('erz/6'); a.waehle('erz/6'); a.waehle('erz/5');
  assert.deepEqual(wechsel, [['erz/5', 'erz/6'], ['erz/6', 'erz/5']]);
  assert.equal(lernPfadVon('erz/6/bk/3', 'erz/6'), true);
  assert.equal(lernPfadVon('erz/6/bk/3', 'erz/5'), false);
  assert.equal(lernPfadVon(null, 'erz/6'), false);
  assert.equal(lernPfadVon('erz/60/bk/3', 'erz/6'), false);
});

test('picker: a press on the select does not defer the rebuild (a native popup swallows the pointerup), change releases a deferred one', () => {
  const w = fakeWurzel();
  const dok = { ls: {}, addEventListener(t, f) { (this.ls[t] ??= []).push(f); } };
  let baut = 0;
  const a = bindeInstrumente({ kanaele: ['erz/5', 'erz/6'], wurzel: w, dokument: dok, graphVon: () => null, bindeKnobs: () => { baut++; }, zeigeGraphWahl: () => {}, speicher: null });
  a.baue(); assert.equal(baut, 1);
  const select = { closest: (sel) => (sel === 'select' ? {} : null) };
  w.ls.pointerdown[0]({ target: select });
  a.neuBauen(); assert.equal(baut, 2, 'rebuilt at once, no pointerup needed');
  // a rebuild that was deferred by a knob press is released by a select change as well
  w.ls.pointerdown[0]({ target: { closest: (sel) => (sel === '.bkliste' ? {} : null) } });
  a.neuBauen(); assert.equal(baut, 2);
  w.ls.change[0]({ target: select }); assert.equal(baut, 3);
  // a focusout of a select must not end a knob gesture that has just started
  w.ls.pointerdown[0]({ target: { closest: (sel) => (sel === '.bkliste' ? {} : null) } });
  assert.equal(w.ls.focusout, undefined);
  a.neuBauen(); assert.equal(baut, 3, 'still guarded until pointerup');
  dok.ls.pointerup[0]({}); assert.equal(baut, 4);
});
