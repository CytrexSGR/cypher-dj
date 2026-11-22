// Lane strip (review): a refused Mute, Solo, key 1 2 3 or EQ turn goes back to the value the server last ACCEPTED, not to the value of the click before it.
// The strip alone on the DOM stand-in with fake writes; no fetch, no studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

installiere({});
const { baueZug } = await import('../public/session/strip.js');
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };

function baue(spalte, { refuse = true } = {}) {
  const slot = document.createElement('div');
  const t = { sendungen: [], aenderungen: [] };
  const z = baueZug(slot, {
    sende: async (d) => { t.sendungen.push(d); await ruhe(); return refuse ? null : { ok: true }; },
    spurAendern: async (id, feld, wert) => { t.aenderungen.push([feld, wert]); await ruhe(); return !refuse; },
  });
  z.zeichne(spalte);
  t.z = (sel) => slot.querySelector(sel);
  t.an = (sel) => slot.querySelector(sel).classList.contains('an');
  return t;
}
const spalte = (extra = {}) => ({ spur_id: 'a1', deck: 1, spur: 1, nr: 1, name: 'Loop 1.1', zellen: [], mute: false, solo: false, kill: {}, ...extra });

test('two quick Mute clicks, both refused: the button ends at the accepted value (off), not on', async () => {
  const t = baue(spalte());
  t.z('.zug-m').click(); t.z('.zug-m').click(); await ruhe(); await ruhe();
  assert.equal(t.an('.zug-m'), false);
});

test('Mute accepted once, then two refused clicks: back at the accepted value (on)', async () => {
  const t = baue(spalte({ mute: true }));
  t.z('.zug-m').click(); t.z('.zug-m').click(); await ruhe(); await ruhe();
  assert.equal(t.an('.zug-m'), true, 'the stand said muted: that is what the server accepted');
});

test('two quick key 1 / 2 / 3 clicks, both refused: each key ends at the accepted value', async () => {
  const t = baue(spalte({ fx: { 1: false, 2: true, 3: false } }));
  const lit = (u) => t.z(`.zug-fx[data-einheit="${u}"]`).classList.contains('an');
  for (const u of ['1', '2', '3']) { t.z(`.zug-fx[data-einheit="${u}"]`).click(); t.z(`.zug-fx[data-einheit="${u}"]`).click(); }
  await ruhe(); await ruhe(); await ruhe();
  assert.equal(lit('1'), false); assert.equal(lit('2'), true); assert.equal(lit('3'), false);
});

test('a refused EQ turn on a killed band goes back to fully left and the kill is on again', async () => {
  const t = baue(spalte({ eq: { tief: 0, mitte: 3, hoch: 0 }, kill: { tief: false, mitte: true, hoch: false } }));
  const k = t.z('[data-art="eq/mitte"]'), s0 = k.getAttribute('aria-valuenow');
  assert.equal(s0, '-200.00');
  k.dispatch('keydown', { key: 'ArrowUp' });
  await ruhe(); await ruhe();
  assert.equal(k.getAttribute('aria-valuenow'), '-200.00');
  assert.deepEqual(t.sendungen.at(-1).kill, { mitte: false });
});

test('two quick Solo clicks, both refused: it ends at the accepted value (off)', async () => {
  const t = baue(spalte());
  t.z('.zug-s').click(); t.z('.zug-s').click();
  await ruhe(); await ruhe(); await ruhe();
  assert.equal(t.an('.zug-s'), false);
});

test('accepted Mute and Solo clicks stay on', async () => {
  const t = baue(spalte(), { refuse: false });
  t.z('.zug-m').click(); await ruhe(); await ruhe();
  assert.equal(t.an('.zug-m'), true);
  const u = baue(spalte(), { refuse: false });
  u.z('.zug-s').click(); await ruhe(); await ruhe();
  assert.equal(u.an('.zug-s'), true);
});
