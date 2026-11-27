// NOTEN (note editor, N16): the handling of the host-neutral surface (public/noten/operation.js) against a canvas and an adapter made of stand-ins.
// Events go into the handlers the surface registered; the ops it sends are read from the adapter stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindeNotenEditor } from '../public/noten/operation.js';
import { notenKasten, neueAnsicht, TON_HOEHE } from '../public/noten/view.js';

const note = (id, qa, qe, qton, extra = {}) => ({ id, qa, qe, qton, p: 0.9, ...extra });
const NOTEN = () => [note('t1', 0.5, 1, 60), note('t2', 1, 2, 62), note('t3', 2, 3, 65, { ton: 66 })];
function aufbau({ noten = NOTEN(), antwort = { ok: true }, rasteTonart = null } = {}) {
  const handler = new Map(), rufe = [], gesendet = [], menues = [], bilder = [];
  let sicht = { quelleS: 4, hoerbarS: [0, 4], noten, kurve: null, welle: null, raster: null, rasteTonart, render: { zustand: 'quelle' }, analyse: null };
  const hoerer = new Set();
  const adapter = {
    lies: () => sicht,
    schreibe: (op) => { gesendet.push(op); return Promise.resolve(typeof antwort === 'function' ? antwort(op) : antwort); },
    abonniere: (f) => { hoerer.add(f); return () => hoerer.delete(f); },
  };
  const g = new Proxy({}, { get: (_, n) => (n === 'measureText' ? () => ({ width: 5 }) : (...a) => { rufe.push([n, ...a]); }), set: (_, n, v) => { rufe.push(['set:' + n, v]); return true; } });
  const canvas = { width: 0, height: 0, style: {}, getContext: () => g, getBoundingClientRect: () => ({ left: 100, top: 50, width: 440, height: 180 }),
    addEventListener: (n, f) => handler.set(n, f), removeEventListener: (n) => handler.delete(n), setPointerCapture() {}, releasePointerCapture() {}, focus() {} };
  const e = bindeNotenEditor(canvas, adapter, { menue: (punkte, x, y) => menues.push({ punkte, x, y }) });
  const ereignis = (name, o = {}) => handler.get(name)({ type: name, button: 0, offsetX: 0, offsetY: 0, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, pointerId: 1, preventDefault() {}, ...o });
  const a = neueAnsicht(sicht, 440, 180);
  const mitte = (id) => { const k = notenKasten(a, sicht.noten.find((n) => n.id === id)); return { offsetX: k.x + k.w / 2, offsetY: k.y + k.h / 2 }; };
  return { e, ereignis, gesendet, menues, rufe, handler, mitte, a, adapter, setzeSicht: (s) => { sicht = { ...sicht, ...s }; for (const f of hoerer) f(); }, hoerer, bilder };
}
const warte = () => new Promise((ok) => setTimeout(ok, 0));
// Redraw and return the bars of the notes: the first fillRect after a globalAlpha below 1 (the surface sets it per bar), in the order of the list
function balken(t) {
  t.rufe.length = 0; t.e.zeige();
  const aus = []; let dran = false;
  for (const r of t.rufe) { if (r[0] === 'set:globalAlpha') dran = r[1] < 1; else if (r[0] === 'fillRect' && dran) { aus.push(r.slice(1)); dran = false; } }
  return aus;
}
const hatRechteck = (rufe, k) => rufe.some((r) => r[0] === 'fillRect' && r[1] === k.x && r[2] === k.y && r[3] === k.w && r[4] === k.h);

test('drag one note two rows up sends {art:"ton", ids:["t2"], um:2} on release; Alt gives a fractional um; Escape sends nothing', async () => {
  const t = aufbau();
  const m = t.mitte('t2');
  t.ereignis('pointerdown', m);
  t.ereignis('pointermove', { ...m, offsetY: m.offsetY - 2 * TON_HOEHE });
  assert.equal(t.gesendet.length, 0, 'nothing is sent before the release');
  t.ereignis('pointerup', { ...m, offsetY: m.offsetY - 2 * TON_HOEHE });
  await warte();
  assert.deepEqual(t.gesendet, [{ art: 'ton', ids: ['t2'], um: 2 }]);
  // Alt at the release: free pitch
  const f = aufbau(), n = f.mitte('t2'), ziel = { ...n, offsetY: n.offsetY - 2.3 * TON_HOEHE };
  f.ereignis('pointerdown', n); f.ereignis('pointermove', ziel); f.ereignis('pointerup', { ...ziel, altKey: true });
  await warte();
  assert.deepEqual(f.gesendet, [{ art: 'ton', ids: ['t2'], um: 2.3 }]);
  // Shift: the key's tones
  const k = aufbau({ rasteTonart: (ton) => (ton === 63 ? 64 : ton) });
  k.ereignis('pointerdown', n); k.ereignis('pointermove', { ...n, offsetY: n.offsetY - TON_HOEHE }); k.ereignis('pointerup', { ...n, offsetY: n.offsetY - TON_HOEHE, shiftKey: true });
  await warte();
  assert.deepEqual(k.gesendet, [{ art: 'ton', ids: ['t2'], um: 2 }], 'a drag to 63 lands on 64 with Shift');
  // Escape cancels; the release after it sends nothing
  const x = aufbau(), p = x.mitte('t2');
  x.ereignis('pointerdown', p); x.ereignis('pointermove', { ...p, offsetY: p.offsetY - 2 * TON_HOEHE });
  x.ereignis('keydown', { key: 'Escape' });
  x.ereignis('pointerup', { ...p, offsetY: p.offsetY - 2 * TON_HOEHE });
  await warte();
  assert.deepEqual(x.gesendet, []);
  // pointercancel and a click without a drag send nothing either
  const c = aufbau(), q = c.mitte('t2');
  c.ereignis('pointerdown', q); c.ereignis('pointermove', { ...q, offsetY: q.offsetY - 30 }); c.ereignis('pointercancel', q);
  c.ereignis('pointerdown', q); c.ereignis('pointermove', { ...q, offsetY: q.offsetY - 3 }); c.ereignis('pointerup', { ...q, offsetY: q.offsetY - 3 });
  await warte();
  assert.deepEqual(c.gesendet, [], 'a move of 3 px or less is a click');
});

test('a drag of a selected group sends one um for the whole selection; Ctrl toggles the selection', async () => {
  const t = aufbau();
  t.ereignis('pointerdown', t.mitte('t1')); t.ereignis('pointerup', t.mitte('t1'));
  t.ereignis('pointerdown', { ...t.mitte('t2'), ctrlKey: true }); t.ereignis('pointerup', { ...t.mitte('t2'), ctrlKey: true });
  const m = t.mitte('t2');
  t.ereignis('pointerdown', m);                       // on a selected note: the group stays
  t.ereignis('pointermove', { ...m, offsetY: m.offsetY + TON_HOEHE });
  t.ereignis('pointerup', { ...m, offsetY: m.offsetY + TON_HOEHE });
  await warte();
  assert.deepEqual(t.gesendet, [{ art: 'ton', ids: ['t1', 't2'], um: -1 }]);
  const u = aufbau();                                 // Ctrl on a selected note takes it out again
  u.ereignis('pointerdown', u.mitte('t1')); u.ereignis('pointerup', u.mitte('t1'));
  u.ereignis('pointerdown', { ...u.mitte('t1'), ctrlKey: true }); u.ereignis('pointerup', { ...u.mitte('t1'), ctrlKey: true });
  u.ereignis('contextmenu', { ...u.mitte('t3'), clientX: 5, clientY: 6 });   // opens on t3 and selects it alone
  u.menues[0].punkte[0].aktion();
  await warte();
  assert.deepEqual(u.gesendet, [{ art: 'zuruecksetzen', ids: ['t3'] }]);
});

test('double click sends zuruecksetzen for the note; the menu items send their ops', async () => {
  const t = aufbau();
  t.ereignis('dblclick', t.mitte('t3'));
  await warte();
  assert.deepEqual(t.gesendet, [{ art: 'zuruecksetzen', ids: ['t3'] }]);
  t.ereignis('dblclick', { offsetX: 300, offsetY: 5 });
  await warte();
  assert.equal(t.gesendet.length, 1, 'a double click in empty space sends nothing');
  const m = aufbau();
  m.ereignis('contextmenu', { ...m.mitte('t2'), clientX: 300, clientY: 90 });
  assert.equal(m.menues.length, 1); assert.deepEqual([m.menues[0].x, m.menues[0].y], [300, 90]);
  assert.deepEqual(m.menues[0].punkte.map((p) => [p.text, !!p.aus]), [['Reset note', false], ['Reset all notes', false], ['Remove notes from clip', false]]);
  for (const p of m.menues[0].punkte) p.aktion();
  await warte();
  assert.deepEqual(m.gesendet, [{ art: 'zuruecksetzen', ids: ['t2'] }, { art: 'zuruecksetzen' }, { art: 'entfernen' }]);
  const leer = aufbau({ noten: [] });
  leer.ereignis('contextmenu', { offsetX: 100, offsetY: 50, clientX: 1, clientY: 2 });
  assert.deepEqual(leer.menues[0].punkte.map((p) => !!p.aus), [true, true, true], 'nothing to reset or remove in an empty list');
  for (const p of leer.menues[0].punkte) p.aktion();
  await warte();
  assert.deepEqual(leer.gesendet, [] , 'a disabled item sends nothing');
});

test('a click in empty space clears the selection and sends nothing', async () => {
  const t = aufbau();
  t.ereignis('pointerdown', t.mitte('t1')); t.ereignis('pointerup', t.mitte('t1'));
  t.ereignis('pointerdown', { offsetX: 400, offsetY: 5 }); t.ereignis('pointerup', { offsetX: 400, offsetY: 5 });
  // the cleared selection shows: no selection frame in the next drawing
  t.rufe.length = 0; t.e.zeige();
  assert.equal(t.rufe.filter((r) => r[0] === 'strokeRect').length, 1, 'only the outline of the edited note t3, no selection frame');
  await warte();
  assert.deepEqual(t.gesendet, []);
  // a right click does not drag and a right button down does not select
  t.ereignis('pointerdown', { ...t.mitte('t1'), button: 2 }); t.ereignis('pointerup', t.mitte('t1'));
  t.rufe.length = 0; t.e.zeige();
  assert.equal(t.rufe.filter((r) => r[0] === 'strokeRect').length, 1);
});

test('wheel: time, Shift pitch, Ctrl zoom; none of it sends anything', async () => {
  const t = aufbau();
  const balken1 = () => balken(t);
  const [x0, y0, w0] = balken1()[0];
  t.ereignis('wheel', { deltaY: 20, offsetX: 200 });
  assert.ok(balken1()[0][0] < x0, 'scrolled to the right: the note moved left');
  t.ereignis('wheel', { deltaY: -100, ctrlKey: true, offsetX: 200 });
  assert.ok(balken1()[0][2] > w0, 'Ctrl+wheel up zooms in: the bar is wider');
  const yVor = balken1()[0][1];
  t.ereignis('wheel', { deltaY: 100, shiftKey: true, offsetX: 200 });
  assert.ok(balken1()[0][1] < yVor, 'Shift+wheel down scrolls the rows down: the notes move up');
  assert.equal(y0, yVor, 'time scroll and zoom do not move the rows');
  await warte();
  assert.deepEqual(t.gesendet, []);
});

test('the adapter drives redraws; los() unsubscribes and removes the handlers', () => {
  const t = aufbau();
  t.rufe.length = 0;
  t.setzeSicht({ noten: [note('t1', 0.5, 1, 60)] });
  assert.ok(t.rufe.length > 0, 'a change from the adapter redraws');
  assert.equal(t.hoerer.size, 1);
  t.e.los();
  assert.equal(t.hoerer.size, 0);
  assert.equal(t.handler.size, 0, 'all handlers removed');
  t.rufe.length = 0; t.e.zeige();
  assert.equal(t.rufe.length, 0, 'nothing is drawn after los()');
});

test('a note that is gone at the release sends nothing; a refused op does not throw; a missing adapter member is named', async () => {
  const t = aufbau();
  const m = t.mitte('t2');
  t.ereignis('pointerdown', m); t.ereignis('pointermove', { ...m, offsetY: m.offsetY - 20 });
  t.setzeSicht({ noten: [note('t1', 0.5, 1, 60)] });          // t2 deleted from elsewhere during the drag
  t.ereignis('pointerup', { ...m, offsetY: m.offsetY - 20 });
  await warte();
  assert.deepEqual(t.gesendet, []);
  const r = aufbau({ antwort: { ok: false, grund: 'noten_unbekannt', text: 'No such note' } }), p = r.mitte('t2');
  r.ereignis('pointerdown', p); r.ereignis('pointermove', { ...p, offsetY: p.offsetY - 20 });
  assert.doesNotThrow(() => r.ereignis('pointerup', { ...p, offsetY: p.offsetY - 20 }));
  await warte();
  assert.equal(r.gesendet.length, 1);
  assert.throws(() => bindeNotenEditor({ getContext: () => ({}) }, { lies() {} }, { menue() {} }), /schreibe, abonniere/);
});

test('the preview follows the pointer: up shows the bar higher, down lower, before anything is sent', async () => {
  const t = aufbau(), m = t.mitte('t2'), n2 = t.adapter.lies().noten[1];
  t.ereignis('pointerdown', m);
  t.rufe.length = 0;
  t.ereignis('pointermove', { ...m, offsetY: m.offsetY - 2 * TON_HOEHE });
  assert.ok(hatRechteck(t.rufe, notenKasten(t.a, { ...n2, ton: 64 })), 'two rows up: the preview bar sits at pitch 64');
  assert.ok(!hatRechteck(t.rufe, notenKasten(t.a, { ...n2, ton: 60 })));
  t.rufe.length = 0;
  t.ereignis('pointermove', { ...m, offsetY: m.offsetY + TON_HOEHE });
  assert.ok(hatRechteck(t.rufe, notenKasten(t.a, { ...n2, ton: 61 })), 'one row down: the preview bar sits at pitch 61');
  assert.ok(!hatRechteck(t.rufe, notenKasten(t.a, { ...n2, ton: 63 })));
  await warte();
  assert.deepEqual(t.gesendet, [], 'a preview sends nothing');
});

test('the drag starts beyond 3 px of pointer travel in any direction, not before', async () => {
  const frei = (dx, dy, m) => ({ ...m, offsetX: m.offsetX + dx, offsetY: m.offsetY + dy });
  const lauf = async (dx, dy) => {
    const t = aufbau(), m = t.mitte('t2'), ziel = frei(dx, dy, m);
    t.ereignis('pointerdown', m); t.ereignis('pointermove', ziel); t.ereignis('pointerup', { ...ziel, altKey: true });   // Alt: a sub-row move would still give a um
    await warte();
    return t.gesendet;
  };
  assert.deepEqual(await lauf(0, -2), [], '2 px: a click');
  assert.deepEqual(await lauf(0, -3), [], '3 px: still a click');
  assert.deepEqual(await lauf(0, -4), [{ art: 'ton', ids: ['t2'], um: 0.44 }], '4 px: a drag');
  assert.deepEqual(await lauf(4, -2), [{ art: 'ton', ids: ['t2'], um: 0.22 }], 'sideways travel counts: 4.5 px starts the drag, only the vertical part moves the pitch');
  assert.deepEqual(await lauf(2, -2), [], 'a diagonal of 2.8 px is a click');
  // a drag that was started and brought back to the start sends nothing
  const t = aufbau(), m = t.mitte('t2');
  t.ereignis('pointerdown', m); t.ereignis('pointermove', frei(0, -30, m)); t.ereignis('pointermove', m); t.ereignis('pointerup', { ...m, altKey: true });
  await warte();
  assert.deepEqual(t.gesendet, []);
});

test('pointercancel ends the drag without sending, drops the preview, and the later release sends nothing', async () => {
  const t = aufbau(), m = t.mitte('t2'), n2 = t.adapter.lies().noten[1], oben = { ...m, offsetY: m.offsetY - 2 * TON_HOEHE };
  t.ereignis('pointerdown', m); t.ereignis('pointermove', oben);
  t.ereignis('pointercancel', oben);
  await warte();
  assert.deepEqual(t.gesendet, [], 'the cancel at the moved position sends nothing');
  t.rufe.length = 0; t.e.zeige();
  assert.ok(!hatRechteck(t.rufe, notenKasten(t.a, { ...n2, ton: 64 })), 'the preview is gone');
  t.ereignis('pointerup', oben);
  await warte();
  assert.deepEqual(t.gesendet, [], 'the release after the cancel has no drag to end');
});

test('a new source rebuilds the view and clears the selection; the same source keeps both', () => {
  const t = aufbau({ noten: [note('t1', 0.5, 1, 60)] });
  t.ereignis('pointerdown', t.mitte('t1')); t.ereignis('pointerup', t.mitte('t1'));
  t.ereignis('wheel', { deltaY: 20, offsetX: 200 });
  const [x1, , w1] = balken(t)[0];
  assert.equal(w1, 50, 'the 4 s source fits 400 px: 100 px per second');
  assert.ok(x1 < 90, 'scrolled');
  t.setzeSicht({ quelleS: 8, hoerbarS: [0, 8] });
  const [x2, , w2] = balken(t)[0];
  assert.equal(w2, 25, '8 s fit 400 px: 50 px per second');
  assert.equal(x2, 40 + 0.5 * 50, 'the view starts at second 0 again');
  assert.equal(t.rufe.filter((r) => r[0] === 'strokeRect').length, 0, 'the selection of the old clip is gone');
  const u = aufbau({ noten: [note('t1', 0.5, 1, 60)] });
  u.ereignis('pointerdown', u.mitte('t1')); u.ereignis('pointerup', u.mitte('t1'));
  u.ereignis('wheel', { deltaY: 20, offsetX: 200 });
  const vor = balken(u)[0][0];
  u.setzeSicht({ noten: [note('t1', 0.5, 1, 60)] });
  assert.equal(balken(u)[0][0], vor);
  assert.equal(u.rufe.filter((r) => r[0] === 'strokeRect').length, 1, 'still selected');
});

test('scrolling stops at second 0 and at the end of the source', () => {
  const t = aufbau({ noten: [note('t1', 3, 4, 60)] });     // the bar ends exactly at the end of the 4 s source
  const [x0] = balken(t)[0];
  assert.equal(x0, 40 + 3 * 100);
  t.ereignis('wheel', { deltaY: -1e6, offsetX: 200 });
  assert.equal(balken(t)[0][0], x0, 'no scrolling before second 0');
  t.ereignis('wheel', { deltaY: 1e6, offsetX: 200 });
  const ende = balken(t)[0];
  assert.deepEqual([ende[0], ende[2]], [40 + (3 - 4) * 100, 100], 'scrolled to the end: the source ends at the left edge of the note area, its last note is still drawn');
  t.ereignis('wheel', { deltaY: 1e6, offsetX: 200 });
  assert.equal(balken(t)[0][0], ende[0], 'not a pixel further');
  t.ereignis('wheel', { deltaY: -1e6, offsetX: 200 });
  assert.equal(balken(t)[0][0], x0, 'and back to the start');
});

test('Delete and Backspace in the canvas stop at the surface (no global clip delete); other keys pass', () => {
  const f = aufbau();
  for (const key of ['Delete', 'Backspace']) {
    let gestoppt = 0, verhindert = 0;
    f.ereignis('keydown', { key, stopPropagation() { gestoppt++; }, preventDefault() { verhindert++; } });
    assert.equal(gestoppt, 1, key + ': propagation stopped');
    assert.equal(verhindert, 1, key + ': default prevented');
  }
  let gestoppt = 0;
  f.ereignis('keydown', { key: 'a', stopPropagation() { gestoppt++; } });
  f.ereignis('keydown', { key: 'Escape', stopPropagation() { gestoppt++; } });
  assert.equal(gestoppt, 0, 'negative control: other keys are not swallowed');
  assert.deepEqual(f.gesendet, [], 'slice 1: the keys do nothing');
});
