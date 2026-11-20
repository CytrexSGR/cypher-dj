// Workbench helpers of public/werkbank/mix.js: strips by track number, the send taper, the effect menu, the stages and the rotary knob widget.
// (The MIX view itself is gone: its cards are tested in werkbank_dock.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

installiere();
const { mixZuege, fxMenue } = await import('../public/werkbank/mix.js');
const { sendPos, sendDb, sendText, neuerDrehknopf } = await import('../public/dock/drehknopf.js');
const { rackTeile, masterTeile } = await import('../public/dock/stages.js');

const HALL = { an: true, pre: 0.04, decay: 0.5, groesse: 0.3, tief: 0.5, highcut: 0.8, fahne: 0.6 };
const GRAPHEN = [{ name: 'fx-delay-sync', art: 'effekt' }, { name: 'fx-remix', art: 'effekt' }, { name: 'bass-banddrive', art: 'instrument' }];
const modul = (extra = {}) => ({
  name: 'M', rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, master: { fader_db: 0 },
  spuren: [
    { id: 's2', nr: 2, name: 'Bass', art: 'instrument', farbe: '#3b8fe0', fader_db: -6, clips: [], sends: [{ id: 'r1', db: -12 }] },
    { id: 's1', nr: 1, name: 'Drums', art: 'instrument', farbe: '#e0563b', fader_db: 0, clips: [] },
    { id: 's3', nr: 3, name: 'Loop', art: 'audio', clips: [] },
  ],
  returns: [{ id: 'r1', nr: 1, name: 'Echo', farbe: '#e0a33e', fader_db: 0, pan: 0, mute: false, solo: false, hall: { ...HALL, an: false },
    inserts: [{ id: 'i1', art: 'bk', slot: 1, an: true, graph: 'fx-delay-sync', werte: {} }] }],
  ...extra,
});

test('helpers: strips by track number, the send taper, the rack menu and the stages', () => {
  assert.deepEqual(mixZuege(modul()).map((z) => [z.buchstabe, z.name]), [['A', 'Drums'], ['B', 'Bass']]);
  assert.equal(sendDb(0), -200);
  assert.equal(sendDb(0.04), -200, 'the lowest twentieth is off');
  assert.equal(sendDb(sendPos(-12)), -12);
  assert.equal(sendDb(1), 6);
  assert.deepEqual([sendText(-200), sendText(-12), sendText(3)], ['off', '-12.0', '+3.0']);
  const m = fxMenue(modul({ returns: [] }), GRAPHEN);
  assert.deepEqual(m.find((e) => e.text === 'Hall').befehl, { befehl: 'return_neu', name: 'Hall' });
  assert.deepEqual(m.find((e) => e.text === 'Echo (tempo delay)').befehl, { befehl: 'return_neu', name: 'Echo', effekt: { graph: 'fx-delay-sync' } });
  assert.deepEqual(m.find((e) => e.text === 'fx-remix').befehl, { befehl: 'return_neu', name: 'Remix', effekt: { graph: 'fx-remix' } });
  assert.equal(m.some((e) => e.text === 'Phaser'), false, 'a quick entry whose graph is not installed is not offered');
  assert.equal(m.some((e) => e.text === 'bass-banddrive'), false, 'instruments are not effects');
  const voll = fxMenue(modul({ returns: [1, 2, 3, 4].map((nr) => ({ id: `r${nr}`, nr })) }), GRAPHEN);
  assert.ok(voll.filter((e) => !e.gruppe).every((e) => e.befehl === null && e.grund));
  assert.deepEqual(rackTeile(modul().returns[0]).map((t) => [t.teil, t.text]), [['i1', 'fx-delay-sync']]);
  assert.deepEqual(rackTeile({ hall: HALL }).map((t) => t.teil), ['hall']);
  assert.deepEqual(rackTeile({ hall: { ...HALL, an: false } }).map((t) => [t.teil, t.an]), [['hall', false]], 'a return without a stage still shows its Hall');
  assert.deepEqual(masterTeile({ master: { inserts: [{ id: 'i9', art: 'bk', graph: 'fx-remix', an: false }] } }), [{ teil: 'i9', text: 'fx-remix', an: false, art: 'bk' }]);
});

test('the rotary knob: drag and wheel call setze, ende comes at pointer up and (debounced) after the wheel, double click sets the default and ends', async () => {
  const log = [];
  let wert = 0.5;
  const k = neuerDrehknopf({ w: 'x', name: 'N', titel: 'T', lies: () => wert, setze: (v) => { wert = v; log.push(['setze', Number(v.toFixed(3))]); }, ende: () => log.push(['ende']), text: (v) => v.toFixed(2), vorgabe: 0.25 });
  k.frisch(); assert.equal(k.querySelector('.w-dreh-wert').textContent, '0.50');
  k.dispatch('pointerdown', { clientY: 100, pointerId: 1 });
  k.dispatch('pointermove', { clientY: 85, pointerId: 1 });
  k.dispatch('pointerup', { pointerId: 1 });
  assert.deepEqual(log, [['setze', 0.6], ['ende']]);
  log.length = 0;
  k.dispatch('pointerdown', { clientY: 100, pointerId: 1 }); k.dispatch('pointerup', { pointerId: 1 });
  assert.deepEqual(log, [], 'a click without a move is no gesture');
  k.dispatch('dblclick');
  assert.deepEqual(log, [['setze', 0.25], ['ende']]);
  const klein = neuerDrehknopf({ w: 'y', name: 'N', titel: 'Send A to Echo', lies: () => 0, setze() {}, text: () => 'off', klein: true, nummer: 2 });
  assert.equal(klein.querySelector('.w-dreh-rad').textContent, '2');
  klein.frisch(); assert.equal(klein.title, 'Send A to Echo: off');
});
