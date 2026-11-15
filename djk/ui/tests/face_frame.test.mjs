// Device faces: the shared frame (overlay, Esc, frame loop through a seam), the display helper (axes, paths, meter) and the knob plate from a table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { achse, pfadVon, baueMeter, baueAnzeige } from '../public/face/display.js';
import { oeffneFace, offenesFace, schliesseFace, baueReglerPlatte } from '../public/face/frame.js';
import { neuesDokument } from './support/face_dom.mjs';

test('display.js achse: linear and log round trip, both directions clamp', () => {
  for (const [o, laenge, umg] of [[{ min: -60, max: 0 }, 300, false], [{ min: -60, max: 24 }, 230, true], [{ min: 10, max: 22000, log: true }, 500, false], [{ min: 10, max: 22000, log: true }, 500, true]]) {
    const a = achse(o, laenge, umg);
    for (const w of [o.min, o.min + (o.max - o.min) * 0.1, o.log ? Math.sqrt(o.min * o.max) : (o.min + o.max) / 2, o.max * 0.9, o.max]) assert.ok(Math.abs(a.wert(a.pos(w)) - w) < 1e-6 * Math.max(1, Math.abs(w)), `${JSON.stringify(o)} ${w}`);
    assert.equal(a.pos(o.min - 100), umg ? laenge : 0); assert.equal(a.pos(o.max * 10 + 1000), umg ? 0 : laenge);
    assert.ok(Math.abs(a.wert(-50) - (umg ? o.max : o.min)) < 1e-9); assert.ok(Math.abs(a.wert(laenge + 50) - (umg ? o.min : o.max)) < 1e-6);
  }
  const lg = achse({ min: 10, max: 1000, log: true }, 200);
  assert.ok(Math.abs(lg.pos(100) - 100) < 1e-9, 'a decade is half of two decades');
});

test('display.js pfadVon: one decimal, a non-finite point is skipped and the path restarts with M', () => {
  assert.equal(pfadVon([[0, 0], [1.26, 2.04], [3, 4]]), 'M0.0,0.0 L1.3,2.0 L3.0,4.0');
  assert.equal(pfadVon([[0, 0], [NaN, 1], [2, 2], [3, Infinity], [4, 4], [5, 5]]), 'M0.0,0.0 M2.0,2.0 M4.0,4.0 L5.0,5.0');
  assert.equal(pfadVon([]), '');
  assert.doesNotMatch(pfadVon([[NaN, NaN], [1, 1]]), /NaN|Infinity/);
});

test('display.js baueAnzeige: grid carries fa-gitter, labels fa-skala; a NaN value never reaches a d attribute', () => {
  const dok = neuesDokument(), host = dok.createElement('div');
  const a = baueAnzeige(host, { breite: 400, hoehe: 270, x: { min: -60, max: 0 }, y: { min: -60, max: 24 }, gitterX: [-60, -30, 0], gitterY: [-60, 0, 24], titelX: 'INPUT dB', titelY: 'OUTPUT dB', label: 'x' });
  assert.equal(host.finde('fa-gitter').length, 6); assert.equal(host.finde('fa-skala').length, 6); assert.equal(host.finde('fa-titel').length, 2);
  const p = a.pfad('k', [[-60, -60], [NaN, 0], [-10, 5], [0, 0]]);
  assert.doesNotMatch(p.getAttribute('d'), /NaN|Infinity/);
  assert.match(p.getAttribute('d'), /^M[\d.]+,[\d.]+ M[\d.]+,[\d.]+ L/);
  assert.match(a.pfad('f', [[-60, 24], [0, 24]], { flaeche: true }).getAttribute('d'), / Z$/);
  assert.equal(a.linieH('h', 0).getAttribute('y1'), a.py(0).toFixed(1));
});

test('display.js baueMeter: null shows a dash and an empty bar; the hold marker holds 1500 ms and falls afterwards, time comes in by hand', () => {
  const dok = neuesDokument(), host = dok.createElement('div');
  const m = baueMeter(host, { min: 0, max: 24, label: 'Gain reduction', einheit: 'dB' });
  const text = host.alles().find((e) => e.klassen.has('fa-meter-text')), balken = host.alles().find((e) => e.klassen.has('fa-meter-balken')), halt = host.alles().find((e) => e.klassen.has('fa-meter-halt'));
  m.setze(null, 0);
  assert.equal(text.textContent, '–'); assert.equal(balken.style.height, '0%'); assert.equal(halt.hidden, true);
  m.setze(6, 0);
  assert.equal(text.textContent, '6.0 dB'); assert.equal(balken.style.height, '25.00%'); assert.equal(halt.dataset.wert, '6');
  m.setze(2, 1000); assert.equal(halt.dataset.wert, '6', 'held at 1000 ms');
  m.setze(2, 1499); assert.equal(halt.dataset.wert, '6', 'held at 1499 ms');
  m.setze(2, 1600);
  assert.ok(Number(halt.dataset.wert) < 6 && Number(halt.dataset.wert) > 2, `falls after 1500 ms: ${halt.dataset.wert}`);
  m.setze(2, 5000); assert.equal(halt.dataset.wert, '2', 'long after: down on the reading');
  m.setze(8, 5100); assert.equal(halt.dataset.wert, '8', 'a higher reading is the new peak');
  m.setze(null, 5200); assert.equal(halt.hidden, true, 'no stale peak after a null'); assert.equal(text.textContent, '–');
});

test('frame.js baueReglerPlatte: ratio (log) and threshold (linear) convert between knob position and real value, 5 values each', () => {
  const dok = neuesDokument(), host = dok.createElement('div');
  const parameter = { schwelle: { name: 'schwelle', label: 'Threshold', min: -60, max: 0, einheit: 'dB', vorgabe: -18 }, ratio: { name: 'ratio', label: 'Ratio', min: 1, max: 20, log: true, einheit: '', vorgabe: 4 } };
  const werte = { schwelle: -18, ratio: 4 }, gesetzt = [];
  const p = baueReglerPlatte(host, { abschnitte: [{ id: 'a', cols: 2, steuer: [{ param: 'schwelle', typ: 'knob', label: 'Threshold' }, { param: 'ratio', typ: 'knob', label: 'Ratio' }] }], parameter,
    adapter: { get: (n) => werte[n], set: (n, v) => gesetzt.push([n, v]) }, dokument: dok });
  for (const v of [-60, -45, -18, -3, 0]) { assert.ok(Math.abs(p.nachWert('schwelle', p.nachK('schwelle', v)) - v) < 1e-9); assert.ok(Math.abs(p.nachK('schwelle', v) - (v + 60) / 60) < 1e-9); }
  for (const v of [1, 1.5, 4, 12, 20]) { assert.ok(Math.abs(p.nachWert('ratio', p.nachK('ratio', v)) - v) < 1e-9); assert.ok(Math.abs(p.nachK('ratio', v) - Math.log(v) / Math.log(20)) < 1e-9); }
  assert.ok(Math.abs(p.werte().schwelle - 0.7) < 1e-9, 'the knob shows the real value as a position');
  assert.ok(Math.abs(p.werte().ratio - Math.log(4) / Math.log(20)) < 1e-9);
  const knoepfe = host.finde('fp-knopf');
  assert.equal(knoepfe.length, 2);
  knoepfe[1].feuere('keydown', { key: 'End' });
  assert.deepEqual(gesetzt.at(-1), ['ratio', 20], 'the adapter gets the real value, not the position');
  knoepfe[0].feuere('keydown', { key: 'Home' });
  assert.deepEqual(gesetzt.at(-1), ['schwelle', -60]);
  const t = host.alles().filter((e) => e.klassen.has('fp-wert')).map((e) => e.textContent);
  assert.deepEqual(t, ['-60.0 dB', '20.0'], 'readouts come from the table');
});

// ---- the frame cost (D5)
function zaehlTakt() {
  const t = { an: [], aus: [], n: 0, an_(fn) { t.n++; t.an.push(fn); return `h${t.n}`; }, aus_(h) { t.aus.push(h); } };
  return { takt: { an: (fn) => t.an_(fn), aus: (h) => t.aus_(h) }, t };
}
const baustein = (log = []) => ({ bauen: (inhalt) => { log.push('bauen'); return { aktualisiere() { log.push('akt'); }, zerstoere() { log.push('zerstoere'); } }; } });

test('frame.js: a face without live makes no takt call and registers exactly one keydown listener; closing removes it', () => {
  const dok = neuesDokument(), { takt, t } = zaehlTakt(), log = [];
  const f = oeffneFace({ id: 'a', titel: 'TEST', wurzel: dok, takt, ...baustein(log) });
  assert.equal(t.n, 0); assert.equal(dok.zaehler.add.keydown, 1);
  assert.deepEqual(offenesFace(dok).id, 'a'); assert.equal(dok.body.finde('p-face').length, 1);
  assert.equal(f.el.kinder[0].klassen.has('p-face-zu'), true, 'the close button is the first child');
  f.schliesse();
  assert.equal(dok.zaehler.remove.keydown, 1); assert.equal(dok.hoerer.length, 0); assert.equal(dok.body.finde('p-face').length, 0);
  assert.equal(t.aus.length, 0); assert.equal(log.filter((x) => x === 'zerstoere').length, 1);
  f.schliesse();   // idempotent
  assert.equal(dok.zaehler.remove.keydown, 1); assert.equal(log.filter((x) => x === 'zerstoere').length, 1);
  assert.equal(offenesFace(dok), null);
});

test('frame.js: with live exactly one takt.an, one more per frame; close cancels that handle and a stale callback does nothing', () => {
  const dok = neuesDokument(), { takt, t } = zaehlTakt();
  let lives = 0;
  const f = oeffneFace({ id: 'a', titel: 'TEST', wurzel: dok, takt, live: () => { lives++; return false; }, ...baustein() });
  assert.equal(t.n, 1); assert.equal(lives, 0);
  t.an[0](10); assert.equal(lives, 1); assert.equal(t.n, 2, 'one more scheduled after a frame');
  const stale = t.an[1];
  f.schliesse();
  assert.deepEqual(t.aus, ['h2'], 'cancelled with the current handle');
  assert.equal(dok.zaehler.add.keydown, dok.zaehler.remove.keydown);
  stale(20); assert.equal(lives, 1, 'no live call after close'); assert.equal(t.n, 2, 'no further takt.an after close');
});

test('frame.js: opening the same id again closes it (null); another id replaces it; Esc closes only the face and stops the event', () => {
  const dok = neuesDokument(), { takt, t } = zaehlTakt(), log = [];
  const a = oeffneFace({ id: 'a', titel: 'A', wurzel: dok, takt, live: () => false, ...baustein(log) });
  assert.ok(a);
  assert.equal(oeffneFace({ id: 'a', titel: 'A', wurzel: dok, takt, live: () => false, ...baustein(log) }), null);
  assert.equal(offenesFace(dok), null); assert.equal(t.aus.length, 1); assert.equal(dok.zaehler.add.keydown, dok.zaehler.remove.keydown);
  const b = oeffneFace({ id: 'b', titel: 'B', wurzel: dok, takt, ...baustein(log) });
  const c = oeffneFace({ id: 'c', titel: 'C', wurzel: dok, takt, ...baustein(log) });
  assert.equal(dok.body.finde('p-face').length, 1, 'one face at a time'); assert.equal(offenesFace(dok).id, 'c'); assert.ok(b && c);
  let weiter = false;
  dok.addEventListener('keydown', (e) => { if (e.key === 'Escape') weiter = true; });   // a listener below the face (the plug-in panel): added later in the bubble phase
  assert.equal(dok.taste('a'), false); assert.equal(offenesFace(dok).id, 'c', 'another key does nothing');
  assert.equal(dok.taste('Escape'), true, 'the face stopped the event'); assert.equal(weiter, false); assert.equal(offenesFace(dok), null);
  assert.equal(dok.taste('Escape'), false); assert.equal(weiter, true, 'the next Esc reaches the listener below');
  schliesseFace(dok);
  assert.equal(log.filter((x) => x === 'zerstoere').length, 3, 'every builder was destroyed once');
});

test('frame.js: the ON button of the header writes through an.set and shows the state; a throwing builder leaves nothing behind', () => {
  const dok = neuesDokument(); let an = true; const gesetzt = [];
  const f = oeffneFace({ id: 'a', titel: 'TEST', wurzel: dok, an: { get: () => an, set: (b) => { gesetzt.push(b); an = b; } }, ...baustein() });
  const knopf = f.el.alles().find((e) => e.klassen.has('p-face-an'));
  assert.equal(knopf.textContent, 'ON');
  knopf.feuere('click');
  assert.deepEqual(gesetzt, [false]); assert.equal(knopf.textContent, 'OFF'); assert.equal(knopf.getAttribute('aria-pressed'), 'false');
  f.schliesse();
  assert.throws(() => oeffneFace({ id: 'x', titel: 'X', wurzel: dok, bauen: () => { throw new Error('boom'); } }), /boom/);
  assert.equal(offenesFace(dok), null); assert.equal(dok.hoerer.length, 0); assert.equal(dok.body.finde('p-face').length, 0);
});
