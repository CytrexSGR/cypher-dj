// DJ view places, task 13: the pure places model (layout, storage, silence rule, header text, mixer plan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_STANDARD, SCHLUESSEL, ladeLayout, speichereLayout, erlaubt, wechsel, still, wahl, kopf, mixerPlan, kanaele, folgeServer } from '../public/slots.js';

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

test('allowed types per place: any place shows Track, Strudel, Loops or SEQ, nothing else', () => {
  for (const p of [1, 2, 3, 4]) for (const t of ['track', 'strudel', 'loops', 'seq']) assert.equal(erlaubt(p, t), true);
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

test('the mixer plan of the default layout: two rows of four slots around the middle column, Loops as two strips', () => {
  const p = mixerPlan([...LAYOUT_STANDARD]);
  assert.equal(p.reihen.length, 2);
  for (const r of p.reihen) assert.equal(r.length, 4);
  assert.deepEqual(p.reihen[0].map((s) => s?.kanal ?? null), [null, 'deck/1', 'deck/2', null]);
  // Strudel has no mixer strip (its faders sit in its place): the two loop strips sit around the middle, under the deck strips
  assert.deepEqual(p.reihen[1].map((s) => s?.kanal ?? null), [null, 'pad/1', 'pad/2', null]);
  assert.equal(p.master, 'mitte');
  assert.deepEqual(p.spalten, { slots: [null, 2, 4, null], mitte: 3, aussen: '' });
});

test('the mixer plan follows a layout with Loops on place 1 and one with three tracks', () => {
  const a = mixerPlan(['loops', 'track', 'strudel', 'track']);
  assert.deepEqual(a.reihen[0].map((s) => s?.kanal ?? s?.art ?? null), ['pad/1', 'pad/2', 'deck/2', null]);
  assert.deepEqual(a.reihen[1].map((s) => s?.kanal ?? null), [null, null, null, null], 'a deck in place 4 has no strip: the main mixer has four channels');
  assert.deepEqual(a.spalten, { slots: [2, 3, 5, null], mitte: 4, aussen: 'l' });
  const b = mixerPlan(['track', 'track', 'track', 'loops']);
  assert.deepEqual(b.reihen[1].map((s) => s?.kanal ?? null), [null, 'pad/1', 'pad/2', null], 'no strip for deck 3: the two loop strips sit around the middle');
  assert.deepEqual(mixerPlan(['track', 'track', 'track', 'strudel']).spalten, { slots: [null, 2, 4, null], mitte: 3, aussen: '' });
});

import { knotenPlan, wendeAn, KNOTEN } from '../public/slots.js';
const knoten = () => Object.fromEntries(KNOTEN.map((k) => [k, { dataset: {}, hidden: false, classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); } } }]));

test('the node plan of the default layout: decks 1 and 2, Strudel, Loops; decks 3 and 4 are out', () => {
  const p = knotenPlan([...LAYOUT_STANDARD]);
  assert.deepEqual(p.platz, { 'deck/1': 1, 'deck/2': 2, strudel: 3, loops: 4 });
  assert.deepEqual(p.aus, ['deck/3', 'deck/4', 'remix', 'seq/1', 'seq/2', 'seq/3', 'seq/4']);
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
  assert.deepEqual(lage(z), { 'zug/deck/1': '1/2', 'zug/deck/2': '1/4', 'zug/pad/1': '2/2', 'zug/pad/2': '2/4' });
  assert.deepEqual(Object.keys(z), ['zug/deck/1', 'zug/deck/2', 'zug/pad/1', 'zug/pad/2'], 'four channels: decks 3 and 4 have no strip');
});

test('the strips follow Track, Track, Track, Loops and Loops, Track, Strudel, Track', () => {
  const z = zuege();
  wendeMixerAn(['track', 'track', 'track', 'loops'], (k) => z[k]);
  assert.deepEqual(lage(z), { 'zug/deck/1': '1/2', 'zug/deck/2': '1/4', 'zug/pad/1': '2/2', 'zug/pad/2': '2/4' });
  wendeMixerAn(['loops', 'track', 'strudel', 'track'], (k) => z[k]);
  assert.deepEqual(lage(z), { 'zug/pad/1': '1/2', 'zug/pad/2': '1/3', 'zug/deck/2': '1/5' });
  assert.ok(z['zug/deck/1'].classList.s.has('platz-aus')); assert.ok(!z['zug/deck/2'].classList.s.has('platz-aus'));
});

// ---------- REMIX place type ----------
import { TYPEN, streifen } from '../public/slots.js';

test('remix is no place type any more: it is an effect with its own window (#remix)', () => {
  assert.deepEqual(TYPEN, ['track', 'strudel', 'loops', 'seq']);
  assert.equal(erlaubt(2, 'remix'), false);
  assert.equal(wechsel(['track', 'track', 'strudel', 'loops'], 2, 'remix', true).ok, false);
  assert.equal(wahl(['track', 'track', 'strudel', 'loops'], 2).some((w) => w.typ === 'remix'), false);
  assert.deepEqual(streifen(['track', 'remix', 'strudel', 'loops'], 2), [], 'an unknown type owns no strip');
});

test('the mixer plan with a remix place shows only the strips of the other place in that row', () => {
  const plan = mixerPlan(['remix', 'track', 'strudel', 'loops']);
  assert.deepEqual(plan.reihen[0].map((s) => s?.kanal ?? null), [null, null, 'deck/2', null]);
  assert.equal(plan.reihen[1].filter(Boolean).length, 2);
  assert.deepEqual(mixerPlan(['track', 'remix', 'strudel', 'loops']).reihen[0].map((s) => s?.kanal ?? null), [null, 'deck/1', null, null]);
  // two strips next to a place without strips sit around the middle column, in line with a row of two decks; no outer column is needed
  for (const l of [['track', 'track', 'remix', 'loops'], ['track', 'track', 'loops', 'remix']]) {
    const p = mixerPlan(l);
    assert.deepEqual(p.reihen[1].map((s) => s?.kanal ?? null), [null, 'pad/1', 'pad/2', null]);
    assert.equal(p.spalten.aussen, '');
  }
});

test('a saved layout with a REMIX place loads with Strudel there, or Track when Strudel is already on another place', () => {
  assert.deepEqual(ladeLayout(speicher('["track","track","strudel","loops"]')), ['track', 'track', 'strudel', 'loops']);
  assert.deepEqual(ladeLayout(speicher('["track","track","remix","loops"]')), ['track', 'track', 'strudel', 'loops']);
  assert.deepEqual(ladeLayout(speicher('["remix","track","strudel","loops"]')), ['track', 'track', 'strudel', 'loops']);
});

test('the head of a remix place names the target', () => {
  assert.equal(kopf(1, { typ: 'remix', ziel: 'master' }), 'REMIX · MASTER');
  assert.equal(kopf(1, { typ: 'remix', ziel: 'deck/2' }), 'REMIX · DECK 2');
  assert.equal(kopf(1, { typ: 'remix', ziel: null }), 'REMIX · no target');
  assert.equal(kopf(1, { typ: 'remix' }), 'REMIX · no target');
});

// ---------- SEQ place type (plan 2026-11-14 seq-deck-s1, task 7) ----------
import { gueltig } from '../public/slots.js';

test('a layout with SEQ in two places is valid (SEQ may appear more than once)', () => {
  assert.equal(gueltig(['seq', 'seq', 'strudel', 'loops']), true);
  assert.equal(gueltig(['seq', 'seq', 'seq', 'seq']), true);
  assert.deepEqual(ladeLayout(speicher('["seq","track","seq","loops"]')), ['seq', 'track', 'seq', 'loops']);
  assert.equal(wahl(['seq', 'track', 'strudel', 'loops'], 2).find((w) => w.typ === 'seq').frei, true, 'a second SEQ place is allowed');
});

test('the channel and the mixer strip of a SEQ place N are the deck strip of N', () => {
  const l = ['track', 'seq', 'strudel', 'loops'];
  assert.deepEqual(kanaele(l, 2), ['deck/2']);
  assert.deepEqual(streifen(l, 2), [{ art: 'deck', platz: 2, nr: 2, kanal: 'deck/2' }]);
  assert.deepEqual(mixerPlan(l).reihen[0].map((s) => s?.kanal ?? null), [null, 'deck/1', 'deck/2', null], 'the strip sits where a Track place has it');
  assert.equal(still(l, 2, { 'deck/2/fader': 0, 'deck/2/trim': 0 }).still, false, 'an open deck strip blocks the switch like a track');
});

test('the node plan places seq/N for a SEQ place N and keeps the others out', () => {
  const p = knotenPlan(['track', 'seq', 'strudel', 'seq']);
  assert.deepEqual(p.platz, { 'deck/1': 1, 'seq/2': 2, strudel: 3, 'seq/4': 4 });
  assert.deepEqual(p.aus, ['deck/2', 'deck/3', 'deck/4', 'loops', 'remix', 'seq/1', 'seq/3']);
});

test('the header of a SEQ place says how many patterns it has, or that it is empty', () => {
  assert.equal(kopf(2, { typ: 'seq', folgen: 3 }), 'SEQ 2 · 3 patterns');
  assert.equal(kopf(2, { typ: 'seq', folgen: 1 }), 'SEQ 2 · 1 pattern');
  assert.equal(kopf(2, { typ: 'seq', folgen: 0 }), 'SEQ 2 · 0 patterns', 'a deck without a pattern yet');
  assert.equal(kopf(2, { typ: 'seq' }), 'SEQ 2 · empty');
  assert.equal(kopf(2, { typ: 'seq', folgen: undefined }), 'SEQ 2 · empty');
});

test('a place leaves SEQ only while it holds no deck (belegt); an empty SEQ place switches like any other', () => {
  const l = ['track', 'seq', 'strudel', 'loops'];
  assert.deepEqual(wechsel(l, 2, 'track', true, true), { ok: false, grund: 'belegt' });
  assert.deepEqual(wechsel(l, 2, 'track', true, false), { ok: true, layout: ['track', 'track', 'strudel', 'loops'] });
  assert.deepEqual(wechsel(l, 2, 'track', true), { ok: true, layout: ['track', 'track', 'strudel', 'loops'] }, 'seqDa defaults to false');
  assert.equal(wechsel(l, 2, 'track', true, true).grund, 'belegt', 'belegt wins over a silent place');
  assert.equal(wechsel(l, 2, 'seq', true, true).ok, true, 'staying on SEQ is no switch away');
  assert.deepEqual(l, ['track', 'seq', 'strudel', 'loops']);
  // a switch TO seq asks the silence rule like any other
  assert.equal(wechsel(['track', 'track', 'strudel', 'loops'], 2, 'seq', { still: false, text: 'deck/2 is open' }).grund, 'offen');
  assert.deepEqual(wechsel(['track', 'track', 'strudel', 'loops'], 2, 'seq', true), { ok: true, layout: ['track', 'seq', 'strudel', 'loops'] });
});

test('a stored layout without seq loads unchanged', () => {
  assert.deepEqual(ladeLayout(speicher('["track","track","strudel","loops"]')), ['track', 'track', 'strudel', 'loops']);
  assert.deepEqual(ladeLayout(speicher('["loops","track","track","strudel"]')), ['loops', 'track', 'track', 'strudel']);
});

// ---------- the strip of a SEQ deck in the Studio view (follow-up of task 7) ----------
import { studioZuege, wendeStudioZuegeAn, STUDIO_ZUEGE } from '../public/slots.js';
const deckZuege = () => Object.fromEntries([1, 2].map((n) => [`zug/deck/${n}`, { dataset: {}, hidden: false }]));   // decks 3 and 4 have no strip

test('the Studio strips: the five fixed ones, plus the deck strip of a SEQ place 1 or 2 after them', () => {
  assert.deepEqual(STUDIO_ZUEGE, ['zug/erz/1', 'zug/erz/2', 'zug/erz/3', 'zug/pad/1', 'zug/pad/2']);
  assert.deepEqual(studioZuege([...LAYOUT_STANDARD]), STUDIO_ZUEGE, 'without SEQ the five strips as before');
  assert.deepEqual(studioZuege(['track', 'seq', 'strudel', 'loops']), [...STUDIO_ZUEGE, 'zug/deck/2']);
  assert.deepEqual(studioZuege(['seq', 'track', 'seq', 'seq']), [...STUDIO_ZUEGE, 'zug/deck/1'], 'a SEQ deck in place 3 or 4 has no strip');
  assert.deepEqual(studioZuege(['seq', 'seq', 'seq', 'seq']).slice(5), ['zug/deck/1', 'zug/deck/2'], 'in the order of the places');
});

test('applying the Studio strips marks only the deck strips of SEQ places 1 and 2', () => {
  const z = deckZuege(), vorher = { ...z };
  const reihe = wendeStudioZuegeAn(['track', 'seq', 'seq', 'loops'], (k) => z[k]);
  assert.deepEqual(reihe, ['zug/deck/2'], 'the SEQ deck of place 3 has no strip');
  assert.equal(z['zug/deck/2'].dataset.studioZug, '1'); assert.equal(z['zug/deck/1'].dataset.studioZug, undefined);
  wendeStudioZuegeAn([...LAYOUT_STANDARD], (k) => z[k]);   // back to no SEQ
  for (const n of [1, 2]) { assert.equal(z[`zug/deck/${n}`].dataset.studioZug, undefined, `deck ${n}`); assert.equal(z[`zug/deck/${n}`].hidden, false, 'the hidden flag is not touched'); }
  for (const k of Object.keys(z)) assert.equal(z[k], vorher[k], `${k} is the same object`);
  assert.doesNotThrow(() => wendeStudioZuegeAn(['seq', 'seq', 'seq', 'seq'], () => null));
});

// ---------- the page follows the server: a place that holds a SEQ deck turns SEQ ----------
const stillAlle = () => true, offenAlle = () => false;

test('folgeServer: a deck on a silent place that is not SEQ switches the place to SEQ (also Strudel and Loops: they stop showing)', () => {
  const l = [...LAYOUT_STANDARD];
  const r = folgeServer(l, [3], stillAlle);
  assert.deepEqual(r, { layout: ['track', 'track', 'seq', 'loops'], gewechselt: [3], offen: [] });
  assert.deepEqual(folgeServer(l, [4], stillAlle).layout, ['track', 'track', 'strudel', 'seq']);
  assert.deepEqual(folgeServer(l, [1], stillAlle).layout, ['seq', 'track', 'strudel', 'loops']);
  assert.deepEqual(l, [...LAYOUT_STANDARD], 'the old layout is never touched');
  assert.equal(gueltig(r.layout), true);
});

test('folgeServer: a deck on a place that is not silent leaves the layout and names the place', () => {
  const l = [...LAYOUT_STANDARD];
  const r = folgeServer(l, [2], offenAlle);
  assert.deepEqual(r, { layout: l, gewechselt: [], offen: [2] });
  assert.notEqual(r.layout, l, 'a copy');
  const verdikt = folgeServer(l, [2], () => ({ still: false, offen: [{ kanal: 'deck/2', grund: 'open' }] }));
  assert.deepEqual(verdikt.offen, [2]);
});

test('folgeServer: the verdict is asked per place with the layout as it is; the real silence rule gives the verdict', () => {
  const l = [...LAYOUT_STANDARD];
  const regler = { 'erz/1/fader': -60, 'erz/2/fader': -60, 'erz/3/fader': -60, 'deck/2/fader': 0 };
  const r = folgeServer(l, [2, 3], (p, lay) => still(lay, p, regler));
  assert.deepEqual(r, { layout: ['track', 'track', 'seq', 'loops'], gewechselt: [3], offen: [2] });
  const gefragt = [];
  folgeServer(l, [3], (p, lay) => { gefragt.push([p, [...lay]]); return true; });
  assert.deepEqual(gefragt, [[3, l]]);
});

test('folgeServer: a layout that already matches is returned unchanged, and nothing is asked for a SEQ place', () => {
  const l = ['track', 'seq', 'strudel', 'loops'];
  let fragen = 0;
  const r = folgeServer(l, [2], () => { fragen += 1; return true; });
  assert.deepEqual(r, { layout: l, gewechselt: [], offen: [] });
  assert.equal(fragen, 0);
  assert.deepEqual(folgeServer(l, [], stillAlle), { layout: l, gewechselt: [], offen: [] });
});

test('folgeServer: two decks at once, one silent and one open, or both silent', () => {
  const l = [...LAYOUT_STANDARD];
  assert.deepEqual(folgeServer(l, [3, 4], stillAlle), { layout: ['track', 'track', 'seq', 'seq'], gewechselt: [3, 4], offen: [] });
  assert.deepEqual(folgeServer(l, [4, 1], (p) => p === 4), { layout: ['track', 'track', 'strudel', 'seq'], gewechselt: [4], offen: [1] });
  assert.deepEqual(folgeServer(l, [3, 3], stillAlle).gewechselt, [3], 'a place listed twice counts once');
});

test('folgeServer: an unknown project (null or absent) changes nothing; an unknown verdict leaves the place alone and unreported', () => {
  const l = [...LAYOUT_STANDARD];
  for (const b of [null, undefined]) assert.deepEqual(folgeServer(l, b, stillAlle), { layout: l, gewechselt: [], offen: [] });
  assert.deepEqual(folgeServer(l, [3], () => null), { layout: l, gewechselt: [], offen: [] });
  assert.deepEqual(folgeServer(l, [3], () => undefined), { layout: l, gewechselt: [], offen: [] });
  assert.deepEqual(folgeServer(l, [0, 5, 'x'], stillAlle), { layout: l, gewechselt: [], offen: [] }, 'places outside 1..4 are ignored');
  assert.deepEqual(folgeServer(['x'], [1], stillAlle).gewechselt, [], 'an invalid layout is not touched');
});

test('wechsel stays: a SEQ place that holds a deck cannot switch away (belegt), also after folgeServer made it SEQ', () => {
  const l = folgeServer([...LAYOUT_STANDARD], [3], stillAlle).layout;
  assert.deepEqual(wechsel(l, 3, 'strudel', true, true), { ok: false, grund: 'belegt' });
});
