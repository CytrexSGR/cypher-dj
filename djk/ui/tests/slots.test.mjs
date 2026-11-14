// DJ view places, task 13: the pure places model (layout, storage, silence rule, header text, mixer plan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_STANDARD, SCHLUESSEL, ladeLayout, speichereLayout, erlaubt, wechsel, still, wahl, kopf, mixerPlan, kanaele } from '../public/slots.js';

const speicher = (init) => { const m = new Map(init ? [[SCHLUESSEL, init]] : []); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
const wirft = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('the default layout is Track, Track, Strudel, Loops', () => {
  assert.deepEqual([...LAYOUT_STANDARD], ['track', 'track', 'strudel', 'loops']);
  assert.deepEqual(ladeLayout(speicher()), ['track', 'track', 'strudel', 'loops']);
});

test('a missing, broken or throwing storage gives the default and never throws', () => {
  for (const roh of ['not json', '{"a":1}', '["track"]', '["track","track","strudel","strudel"]', '["x","y","z","w"]', '[null,1,2,3]', '"track"', 'null']) {
    assert.deepEqual(ladeLayout(speicher(roh)), [...LAYOUT_STANDARD], roh);
  }
  assert.deepEqual(ladeLayout(wirft), [...LAYOUT_STANDARD]);
  assert.deepEqual(ladeLayout(undefined), [...LAYOUT_STANDARD]);
  assert.equal(speichereLayout(wirft, [...LAYOUT_STANDARD]), false);
});

test('a saved layout is read back', () => {
  const s = speicher();
  assert.equal(speichereLayout(s, ['track', 'track', 'track', 'loops']), true);
  assert.deepEqual(ladeLayout(s), ['track', 'track', 'track', 'loops']);
});

test('allowed types per place: any place shows Track, Strudel or Loops, nothing else', () => {
  for (const p of [1, 2, 3, 4]) for (const t of ['track', 'strudel', 'loops']) assert.equal(erlaubt(p, t), true);
  assert.equal(erlaubt(5, 'track'), false); assert.equal(erlaubt(1, 'deck'), false);
});

test('Strudel and Loops cannot appear twice (doppelt), the layout stays', () => {
  const l = [...LAYOUT_STANDARD];
  const a = wechsel(l, 1, 'strudel', true); assert.deepEqual(a, { ok: false, grund: 'doppelt' });
  const b = wechsel(l, 2, 'loops', true); assert.equal(b.grund, 'doppelt');
  assert.deepEqual(l, [...LAYOUT_STANDARD]);
  assert.equal(wahl(l, 1).find((x) => x.typ === 'strudel').frei, false);
  assert.equal(wahl(l, 3).find((x) => x.typ === 'strudel').frei, true);
  assert.equal(wahl(l, 1).find((x) => x.typ === 'track').aktuell, true);
});

test('place 3 switches Strudel -> Track -> Strudel while it is silent', () => {
  const l = [...LAYOUT_STANDARD];
  const t = wechsel(l, 3, 'track', true);
  assert.deepEqual(t, { ok: true, layout: ['track', 'track', 'track', 'loops'] });
  assert.deepEqual(wechsel(t.layout, 3, 'strudel', true).layout, l);
});

test('a place with an open channel or PFL on is refused (offen) and its layout unchanged', () => {
  const l = [...LAYOUT_STANDARD];
  const offen = still(l, 3, { 'erz/2/fader': 0, 'erz/2/trim': 0 });
  assert.equal(offen.still, false); assert.deepEqual(offen.offen, [{ kanal: 'erz/2', grund: 'open' }]);
  const r = wechsel(l, 3, 'track', offen);
  assert.equal(r.ok, false); assert.equal(r.grund, 'offen'); assert.match(r.text, /erz\/2 is open/);
  const pfl = still(l, 1, { 'deck/1/fader': -60, 'deck/1/pfl': 1 });
  assert.equal(pfl.still, false); assert.match(pfl.text, /deck\/1 has PFL on/);
  assert.equal(wechsel(['track', 'track', 'track', 'track'], 1, 'strudel', pfl).grund, 'offen');
  assert.deepEqual(l, [...LAYOUT_STANDARD]);
  assert.equal(still(l, 4, {}).still, true, 'nothing known: every channel closed, PFL off');
});

test('unknown place or type is refused (unbekannt)', () => {
  assert.equal(wechsel([...LAYOUT_STANDARD], 7, 'track', true).grund, 'unbekannt');
  assert.equal(wechsel([...LAYOUT_STANDARD], 1, 'deck', true).grund, 'unbekannt');
  assert.equal(wechsel(['x'], 1, 'track', true).grund, 'unbekannt');
});

test('the channels of a place: deck N, the three generators, the two loop channels', () => {
  assert.deepEqual(kanaele(LAYOUT_STANDARD, 2), ['deck/2']);
  assert.deepEqual(kanaele(LAYOUT_STANDARD, 3), ['erz/1', 'erz/2', 'erz/3']);
  assert.deepEqual(kanaele(LAYOUT_STANDARD, 4), ['pad/1', 'pad/2']);
});

test('the header names a loaded and an empty track in full', () => {
  assert.equal(kopf(3, { typ: 'track', titel: 'Technasia – Bastille Days', tonart: '5A', bpm: 127.6 }), 'TRACK 3 · Technasia – Bastille Days · 5A · 128');
  assert.equal(kopf(2, { typ: 'track' }), 'TRACK 2 · no track loaded');
  assert.equal(kopf(3, { typ: 'strudel' }), 'STRUDEL');
  assert.equal(kopf(4, { typ: 'loops', slots: [{ nr: 1, titel: 'from Bastille Days' }, { nr: 2 }] }), 'LOOPS · LOOP 1 · from Bastille Days');
  assert.equal(kopf(4, { typ: 'loops', slots: [] }), 'LOOPS · both slots empty');
  assert.equal(kopf(4, { typ: 'loops', slots: [{ nr: 2, titel: 'Bastille Days', tonart: '5A', takte: 4 }] }), 'LOOPS · LOOP 2 · Bastille Days · 5A · 4 bars');
  assert.equal(kopf(4, { typ: 'loops', slots: [{ nr: 1, titel: 'A', tonart: '1A', takte: 1 }, { nr: 2, titel: 'B', takte: 8 }] }), 'LOOPS · LOOP 1 · A · 1A · 1 bar · LOOP 2 · B · 8 bars');
});

test('the mixer plan of the default layout: two rows of three columns, Loops as two strips', () => {
  const p = mixerPlan([...LAYOUT_STANDARD]);
  assert.equal(p.reihen.length, 2);
  for (const r of p.reihen) assert.equal(r.length, 3);
  assert.deepEqual(p.reihen[0].map((s) => s?.kanal ?? null), ['deck/1', null, 'deck/2']);
  assert.deepEqual(p.reihen[1].map((s) => s?.art ?? null), ['erz', 'pad', 'pad']);
  assert.deepEqual(p.reihen[1].slice(1).map((s) => s.kanal), ['pad/1', 'pad/2']);
  assert.equal(p.master, 'xfader-reihe');
});

test('the mixer plan follows a layout with Loops on place 1 and one with three tracks', () => {
  const a = mixerPlan(['loops', 'track', 'strudel', 'track']);
  assert.deepEqual(a.reihen[0].map((s) => s?.kanal ?? s?.art ?? null), ['pad/1', 'pad/2', 'deck/2']);
  assert.deepEqual(a.reihen[1].map((s) => s?.art === 'erz' ? 'erz' : s?.kanal ?? null), ['erz', null, 'deck/4']);
  const b = mixerPlan(['track', 'track', 'track', 'loops']);
  assert.deepEqual(b.reihen[1].map((s) => s?.kanal ?? null), ['deck/3', 'pad/1', 'pad/2']);
});

import { knotenPlan, wendeAn, KNOTEN } from '../public/slots.js';
const knoten = () => Object.fromEntries(KNOTEN.map((k) => [k, { dataset: {}, hidden: false, classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); } } }]));

test('the node plan of the default layout: decks 1 and 2, Strudel, Loops; decks 3 and 4 are out', () => {
  const p = knotenPlan([...LAYOUT_STANDARD]);
  assert.deepEqual(p.platz, { 'deck/1': 1, 'deck/2': 2, strudel: 3, loops: 4 });
  assert.deepEqual(p.aus, ['deck/3', 'deck/4', 'remix']);
});

test('applying a layout only sets attributes: the same node objects both ways, place 3 Strudel -> deck 3 -> Strudel', () => {
  const n = knoten(), vorher = { ...n };
  wendeAn([...LAYOUT_STANDARD], (k) => n[k]);
  assert.equal(n.strudel.dataset.platz, '3'); assert.equal(n['deck/3'].hidden, true); assert.ok(n['deck/3'].classList.s.has('platz-aus'));
  assert.equal(n['deck/1'].dataset.platz, '1'); assert.equal(n.loops.dataset.platz, '4'); assert.equal(n['deck/1'].hidden, false);
  wendeAn(['track', 'track', 'track', 'loops'], (k) => n[k]);
  assert.equal(n['deck/3'].dataset.platz, '3'); assert.equal(n['deck/3'].hidden, false);
  assert.equal(n.strudel.hidden, true); assert.equal(n.strudel.dataset.platz, undefined);
  wendeAn([...LAYOUT_STANDARD], (k) => n[k]);
  assert.equal(n.strudel.dataset.platz, '3'); assert.equal(n['deck/3'].hidden, true);
  for (const k of KNOTEN) assert.equal(n[k], vorher[k], `${k} is the same object`);
});

test('a node the page does not have is skipped (finde returns null)', () => {
  assert.doesNotThrow(() => wendeAn([...LAYOUT_STANDARD], () => null));
});

import { wendeMixerAn, ZUEGE } from '../public/slots.js';
const zuege = () => Object.fromEntries(ZUEGE.map((k) => [k, { dataset: {}, hidden: false, classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); } } }]));
const lage = (z) => Object.fromEntries(Object.entries(z).filter(([, e]) => e.dataset.mixZeile).map(([k, e]) => [k, `${e.dataset.mixZeile}/${e.dataset.mixSpalte}`]));

test('the strips are placed by the mixer plan: default layout', () => {
  const z = zuege();
  wendeMixerAn([...LAYOUT_STANDARD], (k) => z[k]);
  assert.deepEqual(lage(z), { 'zug/deck/1': '1/1', 'zug/deck/2': '1/3', 'zug/erz': '2/1', 'zug/pad/1': '2/2', 'zug/pad/2': '2/3' });
  for (const k of ['zug/deck/3', 'zug/deck/4']) { assert.ok(z[k].classList.s.has('platz-aus')); assert.equal(z[k].hidden, false, 'the hidden flag is left alone (Studio view)'); }
});

test('the strips follow Track, Track, Track, Loops and Loops, Track, Strudel, Track', () => {
  const z = zuege();
  wendeMixerAn(['track', 'track', 'track', 'loops'], (k) => z[k]);
  assert.deepEqual(lage(z), { 'zug/deck/1': '1/1', 'zug/deck/2': '1/3', 'zug/deck/3': '2/1', 'zug/pad/1': '2/2', 'zug/pad/2': '2/3' });
  assert.ok(z['zug/erz'].classList.s.has('platz-aus'));
  wendeMixerAn(['loops', 'track', 'strudel', 'track'], (k) => z[k]);
  assert.deepEqual(lage(z), { 'zug/pad/1': '1/1', 'zug/pad/2': '1/2', 'zug/deck/2': '1/3', 'zug/erz': '2/1', 'zug/deck/4': '2/3' });
  assert.ok(z['zug/deck/1'].classList.s.has('platz-aus')); assert.ok(z['zug/deck/3'].classList.s.has('platz-aus')); assert.ok(!z['zug/deck/2'].classList.s.has('platz-aus'));
});

// ---------- REMIX place type ----------
import { TYPEN, streifen } from '../public/slots.js';

test('remix is a fourth type, allowed at most once, owns no channel and no mixer strip', () => {
  assert.ok(TYPEN.includes('remix'));
  assert.equal(erlaubt(2, 'remix'), true);
  const l = ['track', 'remix', 'strudel', 'loops'];
  assert.deepEqual(kanaele(l, 2), []);
  assert.deepEqual(streifen(l, 2), []);
  assert.equal(still(l, 2, { 'deck/2/fader': 0, 'deck/2/trim': 0 }).still, true, 'a place without channels is always silent');
  assert.equal(wechsel(l, 4, 'remix', true).grund, 'doppelt');
  assert.equal(wechsel(['track', 'track', 'strudel', 'loops'], 2, 'remix', true).ok, true);
  assert.deepEqual(wahl(l, 4).find((w) => w.typ === 'remix'), { typ: 'remix', aktuell: false, frei: false });
  assert.equal(wahl(l, 2).find((w) => w.typ === 'remix').frei, true);
});

test('the mixer plan with a remix place shows only the strips of the other place in that row', () => {
  const plan = mixerPlan(['remix', 'track', 'strudel', 'loops']);
  assert.deepEqual(plan.reihen[0].map((s) => s?.kanal ?? null), [null, null, 'deck/2']);
  assert.equal(plan.reihen[1].filter(Boolean).length, 3);
  assert.deepEqual(mixerPlan(['track', 'remix', 'strudel', 'loops']).reihen[0].map((s) => s?.kanal ?? null), ['deck/1', null, null]);
  // two strips next to a place without strips take the outer columns, in line with a row of two decks
  assert.deepEqual(mixerPlan(['track', 'track', 'remix', 'loops']).reihen[1].map((s) => s?.kanal ?? null), ['pad/1', null, 'pad/2']);
  assert.deepEqual(mixerPlan(['track', 'track', 'loops', 'remix']).reihen[1].map((s) => s?.kanal ?? null), ['pad/1', null, 'pad/2']);
});

test('a saved layout without remix stays valid, one with remix twice does not, one with it once does', () => {
  assert.deepEqual(ladeLayout(speicher('["track","track","strudel","loops"]')), ['track', 'track', 'strudel', 'loops']);
  assert.deepEqual(ladeLayout(speicher('["remix","track","strudel","loops"]')), ['remix', 'track', 'strudel', 'loops']);
  assert.deepEqual(ladeLayout(speicher('["remix","remix","strudel","loops"]')), [...LAYOUT_STANDARD]);
});

test('the head of a remix place names the target', () => {
  assert.equal(kopf(1, { typ: 'remix', ziel: 'master' }), 'REMIX · MASTER');
  assert.equal(kopf(1, { typ: 'remix', ziel: 'deck/2' }), 'REMIX · DECK 2');
  assert.equal(kopf(1, { typ: 'remix', ziel: null }), 'REMIX · no target');
  assert.equal(kopf(1, { typ: 'remix' }), 'REMIX · no target');
});
