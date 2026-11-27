// Task 1.3: plugin lane targets on the page (pure module test): the label carries the parameter name, the range is 0..1, the lane is editable.
import test from 'node:test';
import assert from 'node:assert/strict';

const L = await import('../public/production/lanes.js');
const P = await import('../public/production/plugin_parameter.js');

const projekt = (insertId, index) => ({
  spuren: [{ id: 't1', inserts: [{ id: insertId, art: 'host', plugin: { name: 'Reverb X' } }],
    automation: [{ ziel: `plugin.${insertId}.${index}`, punkte: [{ beat: 0, wert: 0.5, form: 'linear' }] }] }],
  gruppen: [], returns: [], master: null,
});

test('plugin target regex and cap', () => {
  assert.equal(L.istPluginZiel('plugin.fx1.3'), true);
  assert.equal(L.istPluginZiel('plugin.fx1.03'), false);
  assert.equal(L.istPluginZiel('plugin.1x.3'), false);
  assert.equal(L.istPluginZiel('insert.fx1.gain'), false);
  assert.equal(L.MAX_PLUGIN_LANEN, 16);
});

test('with the cached parameter name the label shows it, range 0..1, lane not locked', () => {
  L.merkePluginParameter('fx1', [{ index: 3, name: 'Decay' }, { index: 4, name: 'Mix' }]);
  const pr = projekt('fx1', 3);
  L.setzeKettenZiele(pr);
  const ziel = 'plugin.fx1.3', b = L.bereich(ziel);
  assert.equal(L.zielLabel(ziel), 'Reverb X · Decay');
  assert.equal(b.min, 0); assert.equal(b.max, 1); assert.equal(b.unbekannt, undefined);
  assert.equal(L.laneSchutz(pr.spuren[0].automation[0]), null);
  assert.equal(L.unbekanntesZiel(pr.spuren[0].automation[0]), false);
  const zeile = { y: 0, h: 48 };
  assert.ok(Math.abs(L.yZuWert(zeile, L.wertZuY(zeile, 0.25, ziel), ziel) - 0.25) < 1e-9, 'linear round trip');
});

test('without the cache the label ends in #<index>', () => {
  const pr = projekt('fx2', 7);
  L.setzeKettenZiele(pr);
  assert.equal(L.zielLabel('plugin.fx2.7'), 'Reverb X · #7');
  assert.equal(L.laneSchutz(pr.spuren[0].automation[0]), null);
});

test('a plugin lane of a stage that is not a host stays unknown (locked)', () => {
  const pr = projekt('fx3', 1);
  pr.spuren[0].inserts[0].art = 'komp';
  L.setzeKettenZiele(pr);
  assert.equal(L.laneSchutz(pr.spuren[0].automation[0]), 'unbekannt');
});

test('lane button state: active with a lane, disabled at 16, otherwise free', () => {
  assert.deepEqual(P.laneKnopfZustand(2, new Set([2]), 16).aktiv, true);
  const voll = new Set(Array.from({ length: 16 }, (_, k) => k));
  const z = P.laneKnopfZustand(20, voll, 16);
  assert.equal(z.gesperrt, true); assert.equal(z.titel, '16 lanes per plugin');
  assert.equal(P.laneKnopfZustand(5, voll, 16).gesperrt, false, 'an existing lane stays active, not disabled');
  assert.equal(P.laneKnopfZustand(1, new Set(), 16).gesperrt, false);
  assert.match(P.paramListeHtml([{ index: 1, name: 'A', wert: 0 }], new Set(), 16), /class="p-hp-lane"/);
  assert.doesNotMatch(P.paramListeHtml([{ index: 1, name: 'A', wert: 0 }]), /p-hp-lane/);
});

test('MIDI button of a row (task 2.5): plain, waiting, learned K<n>, forget question; an assigned row without a CC is plain again', () => {
  assert.equal(P.midiKnopfZustand({ index: 3 }, undefined).text, 'MIDI');
  assert.equal(P.midiKnopfZustand({ index: 3 }, 'wartet').text, 'Move a controller…');
  assert.deepEqual(P.midiKnopfZustand({ index: 3, knopf: 4, gelernt: true }, undefined), { text: 'K4', titel: 'Controller knob 4 drives this parameter: click to forget', klasse: ' an' });
  assert.equal(P.midiKnopfZustand({ index: 3, knopf: 4, gelernt: true }, 'frage').text, 'Forget K4');
  assert.equal(P.midiKnopfZustand({ index: 3, knopf: 4, gelernt: false }, undefined).text, 'MIDI');
  assert.equal(P.midiKnopfZustand({ index: 3 }, 'frage').text, 'MIDI');
});

test('the list html carries a MIDI button per row only when the list offers MIDI', () => {
  const q = [{ index: 3, name: 'Decay', wert: 0.5, knopf: 2, gelernt: true }, { index: 4, name: 'Mix', wert: 0 }];
  assert.equal((P.paramListeHtml(q, new Set(), 16, new Map()).match(/class="p-hp-midi/g) ?? []).length, 2);
  assert.match(P.paramListeHtml(q, new Set(), 16, new Map()), />K2</);
  assert.match(P.paramListeHtml(q, new Set(), 16, new Map([[4, 'wartet']])), /Move a controller/);
  assert.equal(P.paramListeHtml(q, new Set(), 16), P.paramListeHtml(q, new Set(), 16, null));
  assert.doesNotMatch(P.paramListeHtml(q, new Set()), /p-hp-midi/);
});
