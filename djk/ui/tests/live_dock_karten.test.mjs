// The generic cards of the dock (public/dock/allgemein.js, plan 2026-11-19-one-dock-stage-5a task 4) against the DOM stand-in, with a fake host:
// rows and master column, chips in model order with their state, the COMP knob group, chip menu vs card menu, a click in front, refresh in place vs rebuild.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

installiere();
const { montiereKarten } = await import('../public/dock/allgemein.js');
const { DOCK_TEXT } = await import('../public/dock/dock.js');

const chip = (teil, an = true, extra = {}) => ({ teil, text: teil.toUpperCase(), titel: teil, an, art: teil, gr: false, ...extra });
const karte = (id, extra = {}) => ({
  id, art: 'kanal', kurz: id.slice(-1), name: id.toUpperCase(), farbe: 'var(--c)', untertitel: 'silence', untertitelArt: 'inhalt', untertitelTitel: 'What plays',
  inhalt: null, teile: [chip('gate', false), chip('komp', true, { gr: true, grSkala: 24 }), chip('util')], plus: null, wechsel: false, auf: false,
  knoepfe: [{ param: 'komp/schwelle', name: 'THR', titel: 'Threshold', vorgabe: 0.7 }], knopfGruppe: 'COMP', meter: id, pegelText: true, menue: true, aktiv: false, ...extra,
});
const master = () => ({ ...karte('master'), art: 'master', kurz: '', farbe: '', untertitelArt: null, untertitel: '', teile: [chip('glue'), chip('limiter')], knopfGruppe: null, menue: false });

function aufbau(start) {
  let modell = start;
  const log = [];
  let haken = null;
  const dockEl = document.createElement('div');
  const host = {
    dockEl, masterSpalte: true,
    modell: () => modell, gestalt: (m) => JSON.stringify(m.zeilen.map((z) => z.karten.map((k) => [k.id, k.teile.map((t) => t.teil)]))),
    beimProjekt: (fn) => { haken = fn; },
    oeffneMenue: (punkte) => log.push(['menue', punkte.map((p) => p.text)]),
    aktionen: {
      wert: () => 0.5, setze: (id, p, k) => log.push(['setze', id, p, k]), text: (id, p, k) => k.toFixed(2), gr: () => 6,
      chip: (id, teil) => log.push(['chip', id, teil]), chipMenue: (id, teil) => [{ text: `chip ${teil}`, aktion() {} }],
      menue: (id) => [{ text: `card ${id}`, aktion() {} }], vorn: (id) => log.push(['vorn', id]),
    },
  };
  montiereKarten(host, DOCK_TEXT);
  const zeige = (m = modell) => { modell = m; haken({ t: 1 }); };
  return { dockEl, log, zeige, leere: () => haken(null) };
}
const modellAus = (karten) => ({ zeilen: [{ key: 'kanaele', titel: 'CHANNELS', w: 'dock-kanaele', karten }, { key: 'fx', titel: 'EFFECTS', w: 'dock-fx', karten: [] }], master: [master()] });

test('rows, master column, chips in model order, the COMP group with its name', () => {
  const a = aufbau(modellAus([karte('erz/1'), karte('erz/2')]));
  a.zeige();
  assert.equal(a.dockEl.querySelectorAll('[data-w="dock-kanaele"] [data-w="karte-live"]').length, 2);
  assert.equal(a.dockEl.querySelectorAll('[data-w="dock-master"] [data-w="karte-live"]').length, 1);
  const k = a.dockEl.querySelector('[data-strang="erz/1"]');
  assert.deepEqual(k.querySelectorAll('[data-w="karte-teil"]').map((b) => b.getAttribute('data-teil')), ['gate', 'komp', 'util']);
  assert.equal(k.querySelector('[data-teil="gate"]').classList.contains('aus'), true, 'an off chip is marked');
  assert.equal(k.querySelector('[data-teil="komp"]').classList.contains('aus'), false);
  assert.equal(k.querySelector('.w-karte-gruppe .w-karte-gruppe-name').textContent, 'COMP');
  assert.equal(k.querySelectorAll('.w-karte-gruppe [data-w="karte-knopf"]').length, 1);
  assert.equal(k.querySelector('[data-fxpegel]').getAttribute('data-fxpegel'), 'erz/1');
});

test('a right click on a chip opens the chip menu, never the card menu; on a free spot the card menu', () => {
  const a = aufbau(modellAus([karte('erz/1')]));
  a.zeige();
  const k = a.dockEl.querySelector('[data-strang="erz/1"]');
  k.querySelector('[data-teil="komp"]').dispatch('contextmenu');
  assert.deepEqual(a.log.filter((x) => x[0] === 'menue'), [['menue', ['chip komp']]]);
  a.log.length = 0;
  k.querySelector('.w-karte-name').dispatch('contextmenu');
  assert.deepEqual(a.log.filter((x) => x[0] === 'menue'), [['menue', ['card erz/1']]]);
});

test('a click on a free spot calls vorn, a click on a chip does not', () => {
  const a = aufbau(modellAus([karte('erz/1')]));
  a.zeige();
  const k = a.dockEl.querySelector('[data-strang="erz/1"]');
  k.querySelector('.w-karte-name').click();
  assert.deepEqual(a.log.filter((x) => x[0] === 'vorn'), [['vorn', 'erz/1']]);
  a.log.length = 0;
  k.querySelector('[data-teil="komp"]').click();
  assert.deepEqual(a.log, [['chip', 'erz/1', 'komp']], 'the chip action, no vorn');
});

test('a changed value refreshes in place; a changed shape rebuilds; null empties the rows', () => {
  const a = aufbau(modellAus([karte('erz/1')]));
  a.zeige();
  const alt = a.dockEl.querySelector('[data-strang="erz/1"]');
  a.zeige(modellAus([karte('erz/1', { teile: [chip('gate', true), chip('komp', false), chip('util')], aktiv: true, untertitel: '▶ Song' })]));
  const neu = a.dockEl.querySelector('[data-strang="erz/1"]');
  assert.ok(alt === neu, 'the same element');
  assert.equal(neu.querySelector('[data-teil="gate"]').classList.contains('aus'), false);
  assert.equal(neu.querySelector('[data-teil="komp"]').classList.contains('aus'), true);
  assert.equal(neu.classList.contains('aktiv'), true);
  assert.equal(neu.querySelector('[data-w="karte-untertitel"]').textContent, '▶ Song', 'what plays refreshes in place');
  a.zeige(modellAus([karte('erz/1', { teile: [chip('insert'), chip('gate'), chip('komp'), chip('util')] })]));
  assert.ok(a.dockEl.querySelector('[data-strang="erz/1"]') !== alt, 'rebuilt');
});

test('null empties the rows and the master column', () => {
  const a = aufbau(modellAus([karte('erz/1')]));
  a.zeige();
  assert.equal(a.dockEl.querySelectorAll('[data-w="karte-live"]').length, 2);
  a.leere();   // the host's hook with null (leaving the tab)
  assert.equal(a.dockEl.querySelectorAll('[data-w="karte-live"]').length, 0);
  assert.equal(a.dockEl.querySelectorAll('[data-w="dock-kanaele"]').length, 1, 'the row frame stays');
  a.zeige();
  assert.equal(a.dockEl.querySelectorAll('[data-w="karte-live"]').length, 2, 'the next snapshot builds again');
});
