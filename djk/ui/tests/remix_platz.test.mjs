// REMIX place: the pure logic (target from the core state, lock of the type switch, confirmation before replacing another graph).
import test from 'node:test';
import assert from 'node:assert/strict';
import { aktuellesZiel, zielWahl, typSperre, zielKlick, hinweis, ablehnung, fremderGraph } from '../public/remix_platz.js';

test('the target is read off the core state: master, a deck, or none', () => {
  assert.equal(aktuellesZiel({}), null);
  assert.equal(aktuellesZiel(undefined), null);
  assert.equal(aktuellesZiel({ 'deck/1': 'fx-chorus' }), null);
  assert.equal(aktuellesZiel({ master: 'fx-remix' }), 'master');
  assert.equal(aktuellesZiel({ 'deck/2': 'fx-remix', 'fx/3': 'x' }), 'deck/2');
  assert.equal(aktuellesZiel({ 'fx/3': 'fx-remix' }), null, 'only master and the decks count');
});

test('the target choice lists MASTER, DECK 1..4, L1, L2, DRUMS, BASS, MELODY, OFF, marks the current one and names a foreign graph', () => {
  const w = zielWahl({ 'deck/3': 'fx-remix', master: 'fx-chorus' });
  assert.deepEqual(w.map((x) => x.name), ['MASTER', 'DECK 1', 'DECK 2', 'DECK 3', 'DECK 4', 'L1', 'L2', 'DRUMS', 'BASS', 'MELODY', 'OFF']);
  assert.deepEqual(w.filter((x) => x.aktuell).map((x) => x.name), ['DECK 3']);
  assert.equal(w[0].fremd, 'fx-chorus');
  assert.equal(w[1].fremd, '');
  assert.equal(zielWahl({}).find((x) => x.aktuell).name, 'OFF', 'nothing loaded: OFF');
});

test('the type switch is locked while the device sits on a target, with the reason', () => {
  assert.deepEqual(typSperre({}), { gesperrt: false, text: '' });
  assert.deepEqual(typSperre({ master: 'fx-remix' }), { gesperrt: true, text: 'remix is on MASTER: set target OFF first' });
  assert.equal(typSperre({ 'deck/2': 'fx-remix' }).text, 'remix is on DECK 2: set target OFF first');
  assert.equal(typSperre({ master: 'fx-chorus' }).gesperrt, false, 'a foreign graph does not lock');
});

test('a click on a free target loads the device there, on a used target it takes it off the old one first', () => {
  assert.deepEqual(zielKlick({}, 'master'), { art: 'schritte', schritte: [{ kanal: 'master', name: 'fx-remix' }] });
  assert.deepEqual(zielKlick({ master: 'fx-remix' }, 'deck/2'), { art: 'schritte', schritte: [{ kanal: 'master', name: '' }, { kanal: 'deck/2', name: 'fx-remix' }] });
});

test('OFF takes the device off; OFF while off and the current target change nothing', () => {
  assert.deepEqual(zielKlick({ 'deck/4': 'fx-remix' }, null), { art: 'schritte', schritte: [{ kanal: 'deck/4', name: '' }] });
  assert.deepEqual(zielKlick({}, null), { art: 'nichts' });
  assert.deepEqual(zielKlick({ master: 'fx-remix' }, 'master'), { art: 'nichts' });
  assert.deepEqual(zielKlick({}, 'fx/3'), { art: 'nichts' });
});

test('another graph on the target is never overwritten silently: a second click confirms', () => {
  const g = { master: 'fx-chorus' };
  assert.equal(fremderGraph(g, 'master'), 'fx-chorus');
  assert.deepEqual(zielKlick(g, 'master'), { art: 'bestaetigen', ziel: 'master', name: 'fx-chorus' });
  assert.deepEqual(zielKlick(g, 'master', 'deck/1'), { art: 'bestaetigen', ziel: 'master', name: 'fx-chorus' }, 'a confirmation for another target does not count');
  assert.deepEqual(zielKlick(g, 'master', 'master'), { art: 'schritte', schritte: [{ kanal: 'master', name: 'fx-remix' }] });
  const von = zielKlick({ 'deck/1': 'fx-remix', master: 'fx-chorus' }, 'master', 'master');
  assert.deepEqual(von.schritte, [{ kanal: 'deck/1', name: '' }, { kanal: 'master', name: 'fx-remix' }]);
});

test('the loop slots and the Strudel streams are targets; a graph there (perhaps an instrument) is taken off before the device goes on', () => {
  assert.deepEqual(zielWahl({}).map((w) => w.name), ['MASTER', 'DECK 1', 'DECK 2', 'DECK 3', 'DECK 4', 'L1', 'L2', 'DRUMS', 'BASS', 'MELODY', 'OFF']);
  assert.equal(aktuellesZiel({ 'pad/1': 'fx-remix' }), 'pad/1');
  assert.deepEqual(zielKlick({}, 'erz/1'), { art: 'schritte', schritte: [{ kanal: 'erz/1', name: 'fx-remix' }] });
  assert.deepEqual(zielKlick({ 'pad/2': 'juno-pad' }, 'pad/2'), { art: 'bestaetigen', ziel: 'pad/2', name: 'juno-pad' });
  assert.deepEqual(zielKlick({ 'pad/2': 'juno-pad', master: 'fx-remix' }, 'pad/2', 'pad/2').schritte,
    [{ kanal: 'master', name: '' }, { kanal: 'pad/2', name: '' }, { kanal: 'pad/2', name: 'fx-remix' }]);
  assert.match(hinweis({ 'erz/2': 'fx-remix' }), /on BASS: .*before the channel fader/);
});

test('the hint line and the text of a refusal', () => {
  assert.match(hinweis({}), /^choose where the effect sits/);
  assert.match(hinweis({ master: 'fx-remix' }), /^an effect on MASTER: it shapes what plays there; the PAD voices/);
  assert.match(hinweis({ 'deck/2': 'fx-remix' }), /on DECK 2: .*before the channel fader/);
  assert.equal(ablehnung({ ok: true, code: 200, j: { quittung: { status: 0 } } }), '');
  assert.equal(ablehnung({ ok: false, code: 409, j: { fehler: 'ki_gestoppt' } }), 'ki_gestoppt');
  assert.equal(ablehnung({ ok: false, code: 400, j: { text: 'unknown channel master' } }), 'unknown channel master');
  assert.equal(ablehnung({ ok: true, code: 200, j: { quittung: { status: 6, grund: 'no such channel' } } }), 'no such channel');
  assert.equal(ablehnung({ ok: true, code: 200, j: {} }), 'no answer from the core yet');
});
