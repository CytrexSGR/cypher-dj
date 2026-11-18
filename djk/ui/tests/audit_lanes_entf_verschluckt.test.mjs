// Audit U19: Delete on a selected lane point that cannot be deleted (single point) must not fall through to the clip handler (which deletes the selected clips).
import test from 'node:test';
import assert from 'node:assert/strict';

const { installiere, El } = await import('./helpers/pages_mock.mjs');
const { bindeLanen } = await import('../public/production/lanes_operation.js');
const { zeilenTabelle } = await import('../public/production/layout.js');
const { wertZuY } = await import('../public/production/lanes.js');

function aufbau(lane) {
  installiere();
  const flaeche = new El('div'), ueber = new El('canvas');
  ueber.setPointerCapture = () => {};
  const $ = (id) => ({ flaeche, ueber })[id];
  const spuren = [{ id: 's1', clips: [{ id: 'c1' }], automation: [] }, { id: 's2', clips: [], automation: [lane] }];
  const tabelle = zeilenTabelle(2, [1]);
  const st = { projekt: { spuren, loop: null }, ansicht: { beat0: 0, pxProBeat: 10 }, raster: 1, sichtbar: true, laneZiel: new Map() };
  const ctx = { st, $, beimBild: [], melde() {}, aendere() { return Promise.resolve(true); }, zeilen: () => tabelle,
    zug: { beginne: () => ({ bewege() {}, lass() {}, verwirf() {} }) } };
  bindeLanen(ctx);
  const z = tabelle.find((r) => r.art === 'lane');
  return { flaeche, ueber, z };
}
const druecke = (ueber, key) => {
  let gestoppt = 0;
  for (const f of ueber.listeners.keydown ?? []) f({ key, preventDefault() {}, stopImmediatePropagation() { gestoppt++; }, stopPropagation() { gestoppt++; } });
  return gestoppt;
};
const waehle = (flaeche, ueber, z, lane) => {
  const e = { target: ueber, button: 0, pointerId: 1, offsetX: 0, offsetY: wertZuY(z, lane.punkte[0].wert, lane.ziel), stopImmediatePropagation() {} };
  for (const f of flaeche.listeners.pointerdown ?? []) f(e);
  for (const f of ueber.listeners.pointerup ?? []) f({ ...e });
};

test('audit U19: Delete on the only point of a lane is swallowed, so the clip handler does not delete the selected clips', () => {
  const lane = { id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }] };
  const { flaeche, ueber, z } = aufbau(lane);
  waehle(flaeche, ueber, z, lane);
  assert.ok(druecke(ueber, 'Delete') > 0, 'Delete must stop propagation (the point cannot go, the clip must stay)');
});

test('audit U19: Delete on a point of a locked lane is swallowed', () => {
  const lane = { id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: -6 }] };
  const { flaeche, ueber, z } = aufbau(lane);
  waehle(flaeche, ueber, z, lane);
  lane.gesperrt = true;                           // locked after the selection
  assert.ok(druecke(ueber, 'Backspace') > 0);
});

test('audit U19 control: without a selected lane point Delete is left to the clip handler', () => {
  const lane = { id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }] };
  const { ueber } = aufbau(lane);
  assert.equal(druecke(ueber, 'Delete'), 0);
});

test('audit U19: a press on a clip row ends the point selection, so Delete reaches the clips again', () => {
  const lane = { id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }] };
  const { flaeche, ueber, z } = aufbau(lane);
  waehle(flaeche, ueber, z, lane);
  for (const f of flaeche.listeners.pointerdown ?? []) f({ target: ueber, button: 0, pointerId: 1, offsetX: 5, offsetY: 5, stopImmediatePropagation() {} });
  assert.equal(druecke(ueber, 'Delete'), 0);
});
