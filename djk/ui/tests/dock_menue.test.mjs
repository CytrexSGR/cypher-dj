// The ONE strip menu of heads and dock cards (production/context_menu.js): entries per strip kind in the spec order, rename, colour, rack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KOPF_MENUE, kopfMenuePunkte, strangArt } from '../public/production/context_menu.js';
import { naechsteFarbe } from '../public/production/track_heads.js';

const ins = (id) => ({ id, art: 'komp', slot: 1, an: true, werte: {} });
const projekt = (extra = {}) => ({
  spuren: [{ id: 's1', nr: 1, art: 'instrument', name: 'Bass', farbe: '#111111', geraet: { art: 'intern', name: 'rb338', parameter: {} }, inserts: [] },
    { id: 's2', nr: 2, art: 'instrument', name: 'Lead', farbe: '#222222', geraet: { art: 'intern', name: 'rb338', parameter: {} }, inserts: [ins('i1')] }],
  gruppen: [{ id: 'g1', nr: 1, name: 'Drums', farbe: '#aa0000', inserts: [] }],
  returns: [{ id: 'r1', nr: 1, name: 'Echo', farbe: '#ffaa00', pre: false, inserts: [] }],
  master: { inserts: [] }, ...extra,
});
const ctxFuer = (p, extra = {}) => { const log = []; return { log, st: { projekt: p, spurWahl: new Set(), laneOffen: new Set() }, aendere: (l, b) => log.push([l, b]), ...extra }; };
const texte = (ctx, strang) => kopfMenuePunkte(ctx, strang).map((x) => x.text);
const strang = (p, id) => p.spuren.find((s) => s.id === id) ?? p.gruppen.find((s) => s.id === id) ?? p.returns.find((s) => s.id === id) ?? { id, name: 'Master' };

test('strangArt: track, group, return, master and an unknown id', () => {
  const p = projekt();
  assert.equal(strangArt(p, 's1'), 'spur');
  assert.equal(strangArt(p, 'g1'), 'grp');
  assert.equal(strangArt(p, 'r1'), 'ret');
  assert.equal(strangArt(p, 'master'), 'pm');
  assert.equal(strangArt(p, 'nope'), null);
  assert.equal(strangArt(null, 's1'), null);
});

test('menu entries per kind in the spec order', () => {
  const p = projekt(), ctx = ctxFuer(p);
  assert.deepEqual(texte(ctx, strang(p, 's1')), ['Rename', 'Colour', 'Rack', 'Resample', 'MAKE RACK', 'Delete']);
  ctx.st.spurWahl.add('s1');
  assert.deepEqual(texte(ctx, strang(p, 's1')), ['Rename', 'Colour', 'Rack', 'Resample', 'Group selected tracks (Ctrl+G)', 'MAKE RACK', 'Delete']);
  assert.deepEqual(texte(ctxFuer(p), strang(p, 'g1')), ['Rename', 'Colour', 'Rack', 'Show automation lane', 'Resample', 'Delete']);
  assert.deepEqual(texte(ctxFuer(p), strang(p, 'r1')), ['Rename', 'Colour', 'Rack', 'Show automation lane', 'Sends PRE fader', 'Resample', 'Delete']);
  assert.deepEqual(texte(ctxFuer(p), strang(p, 'master')), ['Rack', 'Show automation lane', 'Resample']);
});

test('the lane entry reads Hide while the lane is open; PRE/POST names the other state', () => {
  const p = projekt(), ctx = ctxFuer(p);
  ctx.st.laneOffen.add('g1');
  assert.equal(texte(ctx, strang(p, 'g1'))[3], 'Hide automation lane');
  const q = projekt({ returns: [{ id: 'r1', nr: 1, name: 'Echo', farbe: '#ffaa00', pre: true, inserts: [] }] });
  assert.ok(texte(ctxFuer(q), strang(q, 'r1')).includes('Sends POST fader'));
});

test('Rack is disabled without stages or without ctx.oeffneRack, enabled with one stage and the callback', () => {
  const p = projekt(), gesehen = [];
  const rack = (ctx, id) => kopfMenuePunkte(ctx, strang(p, id)).find((x) => x.text === 'Rack');
  assert.equal(rack(ctxFuer(p, { oeffneRack: (s) => gesehen.push(s.id) }), 's1').aus, true, 'no stages');
  assert.match(rack(ctxFuer(p, { oeffneRack: () => {} }), 's1').titel, /^Add an insert stage first/);
  assert.equal(rack(ctxFuer(p), 's2').aus, true, 'no callback');
  const e = rack(ctxFuer(p, { oeffneRack: (s) => gesehen.push(s.id) }), 's2');
  assert.equal(e.aus, false);
  e.aktion();
  assert.deepEqual(gesehen, ['s2']);
});

test('Colour writes the next colour with the command of the kind', () => {
  const p = projekt();
  const farbe = (id, ctx) => { kopfMenuePunkte(ctx, strang(p, id)).find((x) => x.text === 'Colour').aktion(); return ctx.log.at(-1); };
  assert.deepEqual(farbe('r1', ctxFuer(p)), ['Colour return Echo', [{ befehl: 'return_aendern', return_id: 'r1', farbe: naechsteFarbe('#ffaa00') }]]);
  assert.deepEqual(farbe('g1', ctxFuer(p)), ['Colour group Drums', [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', farbe: naechsteFarbe('#aa0000') }]]);
  assert.deepEqual(farbe('s1', ctxFuer(p)), ['Colour Bass', [{ befehl: 'spur_aendern', spur_id: 's1', farbe: naechsteFarbe('#111111') }]]);
});

test('Rename hands the strip and the place to ctx.umbenennen; Delete asks first and writes the command of the kind', async () => {
  const p = projekt(), ort = {}, gesehen = [];
  const ctx = ctxFuer(p, { umbenennen: (s, o) => gesehen.push([s.id, o]), frage: () => true });
  kopfMenuePunkte(ctx, strang(p, 'g1'), ort).find((x) => x.text === 'Rename').aktion();
  assert.ok(gesehen[0][0] === 'g1' && gesehen[0][1] === ort);
  await kopfMenuePunkte(ctx, strang(p, 'r1')).find((x) => x.text === 'Delete').aktion();
  assert.deepEqual(ctx.log.at(-1), ['Delete return Echo', [{ befehl: 'return_loeschen', return_id: 'r1' }]]);
  const nein = ctxFuer(p, { frage: () => false });
  await kopfMenuePunkte(nein, strang(p, 's1')).find((x) => x.text === 'Delete').aktion();
  assert.equal(nein.log.length, 0, 'declined');
});

test('the master never shows Rename, Colour, PRE/POST or Delete; every entry text is printable ASCII', () => {
  const p = projekt();
  for (const t of texte(ctxFuer(p), strang(p, 'master'))) assert.ok(!/Rename|Colour|PRE|POST|Delete/.test(t), t);
  for (const e of KOPF_MENUE) assert.match(typeof e.text === 'function' ? e.text({ id: 'x' }, ctxFuer(p)) : e.text, /^[ -~]+$/);
});

import { kartenMenueWeicht } from '../public/dock/blocks.js';
test('the card menu stands back for a right click that comes from a stage chip', () => {
  const chip = {};
  assert.equal(kartenMenueWeicht({ closest: (sel) => (sel === '[data-w="karte-teil"]' ? chip : null) }), true);
  assert.equal(kartenMenueWeicht({ closest: () => null }), false);
  assert.equal(kartenMenueWeicht(null), false);
});
