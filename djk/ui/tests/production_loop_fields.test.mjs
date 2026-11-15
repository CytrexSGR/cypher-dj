// Task 1 (backlog production): the BAR and TO fields next to LOOP set the loop range by bars.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loopTakte, loopBefehl } from '../public/production/layout.js';
import { bindeTransport } from '../public/production/transport.js';

test('loopTakte: first bar floor(von/4)+1, last bar ceil(bis/4)', () => {
  assert.deepEqual(loopTakte({ von_beat: 0, bis_beat: 32 }), { vonTakt: 1, bisTakt: 8 });
  assert.deepEqual(loopTakte({ von_beat: 560, bis_beat: 592 }), { vonTakt: 141, bisTakt: 148 });
  assert.deepEqual(loopTakte({ von_beat: 2, bis_beat: 6 }), { vonTakt: 1, bisTakt: 2 });
});
test('loopBefehl: bars become a loop_setzen that switches the loop on', () => {
  assert.deepEqual(loopBefehl('141', '148'), { befehl: 'loop_setzen', an: true, von_beat: 560, bis_beat: 592 });
  assert.deepEqual(loopBefehl('1', '1'), { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 4 });
  assert.deepEqual(loopBefehl(' 3 ', ' 4'), { befehl: 'loop_setzen', an: true, von_beat: 8, bis_beat: 16 });
});
test('loopBefehl: nonsense gives null', () => {
  for (const [a, b] of [['0', '4'], ['5', '4'], ['a', '4'], ['2.5', '4'], ['', '']]) assert.equal(loopBefehl(a, b), null, `${a}/${b}`);
});

test('meter 3/4: bars of 3 beats in both directions, 4/4 without the argument', () => {
  assert.deepEqual(loopBefehl('1', '2', 3), { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 6 });
  assert.deepEqual(loopTakte({ von_beat: 6, bis_beat: 12 }, 3), { vonTakt: 3, bisTakt: 4 });
  assert.deepEqual(loopTakte({ von_beat: 6, bis_beat: 12 }), { vonTakt: 2, bisTakt: 3 });
  assert.equal(loopBefehl('5', '4', 3), null);
});

function baue(loop) {
  const els = new Map();
  const mk = () => ({ textContent: '', disabled: false, value: '', on: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, style: {},
    addEventListener(n, f) { this.on[n] = f; } });
  const $ = (n) => { if (!els.has(n)) els.set(n, mk()); return els.get(n); };
  globalThis.document = { addEventListener() {}, activeElement: null };
  const z = { aufrufe: [], melde: [] };
  const ctx = {
    st: { projekt: { tempo_bpm: 120, loop, metronom: { an: false } }, start: 0, sichtbar: true, ansicht: { beat0: 0, pxProBeat: 10 } }, $,
    lies: (k, v) => v, merke() {}, bpm: () => 120, breite: () => 800,
    holeJson: async () => ({ status: 200, j: {} }), antwortText: () => '', fehlerText: (r) => `text:${r.j.fehler}`,
    melde: (t, f) => z.melde.push([t, f]),
    aendereAus: async (fn) => { z.aufrufe.push(fn); },
    beimProjekt: [], beimEreignis: [], vorBild: [],
  };
  bindeTransport(ctx);
  const zeige = () => ctx.beimProjekt.forEach((f) => f(ctx.st.projekt, false));
  zeige();
  return { $, z, ctx, zeige };
}

test('binding: the fields show the stored range in bars', () => {
  const b = baue({ an: false, von_beat: 0, bis_beat: 32 });
  assert.deepEqual([b.$('loop-von').value, b.$('loop-bis').value], ['1', '8']);
  assert.equal(b.$('loop-von').disabled, false);
});
test('binding: a typed range sends one loop_setzen with the loop switched on', async () => {
  const b = baue({ an: false, von_beat: 0, bis_beat: 32 });
  b.$('loop-von').value = '141'; b.$('loop-bis').value = '148';
  await b.$('loop-bis').on.change();
  assert.equal(b.z.aufrufe.length, 1);
  assert.deepEqual(b.z.aufrufe[0](b.ctx.st.projekt), { label: 'Loop range', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 560, bis_beat: 592 }] });
});
test('binding: nonsense sends nothing, reports once with true and shows the stored range again', async () => {
  const b = baue({ an: false, von_beat: 0, bis_beat: 32 });
  b.$('loop-von').value = '5'; b.$('loop-bis').value = '4';
  await b.$('loop-von').on.change();
  assert.equal(b.z.aufrufe.length, 0);
  assert.equal(b.z.melde.length, 1);
  assert.equal(b.z.melde[0][1], true);
  assert.deepEqual([b.$('loop-von').value, b.$('loop-bis').value], ['1', '8']);
});
