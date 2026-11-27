// PRODUCTION: the marker strip above the ruler (marker.js helpers, marker_operation.js DOM), tested with the DOM stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installiere, El } from './helpers/pages_mock.mjs';
import { markerNameFehler, markerVorgabeName, markerZielBeat, markerZugErkannt, markerSichtbar, MARKER_ZUG_PX } from '../public/production/marker.js';
import { bindeMarker } from '../public/production/marker_operation.js';
import { bindeTransport } from '../public/production/transport.js';
import { FEHLER_TEXT, fehlerText } from '../public/production/production.js';
import { KABEL_FARBEN } from '../public/panel.js';

const projekt = (marker = [], extra = {}) => ({ tempo_bpm: 120, taktart: [4, 4], loop: { an: false, von_beat: 0, bis_beat: 16 }, rev: 1,
  spuren: [{ id: 's1', clips: [{ id: 'c1', start_beat: 0, laenge_beats: 64 }] }], ...(marker.length ? { marker } : {}), ...extra });
const M = [{ id: 'm1', beat: 0, name: 'Intro' }, { id: 'm2', beat: 16, name: 'Drop', farbe: 2 }, { id: 'm3', beat: 48, name: 'Out' }];

function baue(p = projekt(M), { antwort = true } = {}) {
  installiere();
  const leiste = new El('div'), neu = new El('button');
  const z = { aend: [], melde: [], springe: [] };
  const ctx = {
    st: { projekt: p, slug: 'p', ansicht: { beat0: 0, pxProBeat: 10 }, raster: 'beat', start: 0, sichtbar: true },
    $: (n) => ({ 'marker-leiste': leiste, 'marker-neu': neu })[n],
    melde: (t, f) => z.melde.push([t, f]),
    aendere: async (label, befehle) => { z.aend.push({ label, befehle }); return antwort; },
    springeZu: (beat, o) => z.springe.push([beat, o]), breite: () => 800, beimBild: [], beimProjekt: [],
  };
  bindeMarker(ctx);
  const bild = () => { for (const f of ctx.beimProjekt) f(ctx.st.projekt, false); for (const f of ctx.beimBild) f(0); };
  bild();
  const flaggen = () => leiste.querySelectorAll('[data-p="marker"]');
  const flagge = (id) => flaggen().find((f) => f.dataset.id === id);
  return { ctx, leiste, neu, z, bild, flaggen, flagge };
}
const ev = (extra = {}) => ({ button: 0, pointerId: 1, clientX: 0, shiftKey: false, ...extra });

test('helpers: default name, snapped drag target, drag threshold, visibility', () => {
  assert.equal(markerVorgabeName([]), 'Marker 1');
  assert.equal(markerVorgabeName([{ name: 'Intro' }, { name: 'Drop' }]), 'Marker 3');
  assert.equal(markerVorgabeName([{ name: 'Marker 2' }, { name: 'Marker 1' }]), 'Marker 3', 'a taken name is skipped');
  assert.equal(markerVorgabeName(undefined), 'Marker 1');
  assert.equal(markerZielBeat(16, 25, 10, 1), 19, '16 + 2.5 beats snapped to the whole beat (half rounds up)');
  assert.equal(markerZielBeat(16, 24, 10, 1), 18);
  assert.equal(markerZielBeat(16, -400, 10, 1), 0, 'never before beat 0');
  assert.equal(markerZielBeat(16, 7, 10, 0), 16.7, 'grid OFF does not snap');
  assert.equal(MARKER_ZUG_PX, 4);
  assert.equal(markerZugErkannt(3), false); assert.equal(markerZugErkannt(-4), true);
  assert.equal(markerSichtbar(-500, 800), false); assert.equal(markerSichtbar(100, 800), true); assert.equal(markerSichtbar(801, 800), false);
});

test('flags: one button per marker at the pixel of its beat, name as text, colour as left border', () => {
  const b = baue();
  assert.equal(b.leiste.getAttribute('role'), 'group');
  assert.deepEqual(b.flaggen().map((f) => f.dataset.id), ['m1', 'm2', 'm3']);
  assert.deepEqual(b.flaggen().map((f) => f.style.left), ['0px', '160px', '480px']);
  assert.equal(b.flagge('m2').textContent, 'Drop');
  assert.equal(b.flagge('m2').title, 'Drop');
  assert.equal(b.flagge('m2').tagName, 'BUTTON');
  assert.equal(b.flagge('m2').getAttribute('type'), 'button');
  assert.equal(b.flagge('m2').style.borderLeftColor, KABEL_FARBEN[2]);
  assert.equal(b.flagge('m1').style.borderLeftColor ?? '', '', 'no colour: the stylesheet accent');
});

test('flags follow zoom and scroll on every frame', () => {
  const b = baue();
  b.ctx.st.ansicht = { beat0: 8, pxProBeat: 20 };
  b.bild();
  assert.equal(b.flagge('m2').style.left, '160px', '(16 - 8) * 20');
  b.ctx.st.ansicht = { beat0: 20, pxProBeat: 20 };
  b.bild();
  assert.equal(b.flagge('m1').hidden, true, 'beat 0 sits far left of the view');
  assert.equal(b.flagge('m2').style.left, '-80px', 'a flag that reaches into the view stays (its name may be long)');
  assert.equal(b.flagge('m2').hidden, false);
  b.ctx.st.ansicht = { beat0: 0, pxProBeat: 40 };
  b.bild();
  assert.equal(b.flagge('m2').style.left, '640px');
  assert.equal(b.flagge('m3').hidden, true, 'beat 48 sits right of an 800 px view at 40 px per beat');
  assert.equal(b.flagge('m1').hidden, false);
});

test('names are text, never markup', () => {
  const b = baue(projekt([{ id: 'm1', beat: 0, name: '<b>x</b> & 🎛' }]));
  assert.equal(b.flagge('m1').textContent, '<b>x</b> & 🎛');
  assert.equal(b.flagge('m1').children.length, 1);
  assert.equal(typeof b.flagge('m1').children[0], 'string');
});

test('a changed marker list is drawn again, a removed marker loses its flag', () => {
  const b = baue();
  b.ctx.st.projekt = projekt([{ id: 'm2', beat: 20, name: 'Break' }]);
  b.bild();
  assert.deepEqual(b.flaggen().map((f) => [f.dataset.id, f.textContent, f.style.left]), [['m2', 'Break', '200px']]);
});

test('without a project the strip is empty and + MARKER is disabled; the live container has no strip content and a tooltip', () => {
  const b = baue(null);
  assert.equal(b.flaggen().length, 0);
  assert.equal(b.neu.disabled, true);
  const l = baue(projekt(M, { live: true }));
  assert.equal(l.flaggen().length, 0);
  assert.equal(l.neu.disabled, true);
  assert.equal(l.neu.title, 'The live container has no markers');
  const o = baue();
  assert.equal(o.neu.disabled, false);
});

test('click sets the start marker through the transport function, at the exact marker beat', () => {
  const b = baue();
  b.flagge('m2').dispatch('click', ev());
  assert.deepEqual(b.z.springe, [[16, { exakt: true }]]);
  assert.deepEqual(b.z.aend, []);
});

test('Shift click sends loop_setzen with the range of the marker; the last marker runs to the end of the last clip', () => {
  const b = baue();
  b.flagge('m2').dispatch('click', ev({ shiftKey: true }));
  assert.deepEqual(b.z.aend.map((a) => a.befehle), [[{ befehl: 'loop_setzen', an: true, von_beat: 16, bis_beat: 48 }]]);
  b.flagge('m3').dispatch('click', ev({ shiftKey: true }));
  assert.deepEqual(b.z.aend.at(-1).befehle, [{ befehl: 'loop_setzen', an: true, von_beat: 48, bis_beat: 64 }]);
  assert.deepEqual(b.z.springe, [], 'a Shift click does not move the start marker');
});

test('Shift click on an empty range sends nothing and says why', () => {
  const b = baue(projekt([{ id: 'm1', beat: 0, name: 'A' }, { id: 'm2', beat: 80, name: 'Behind' }]));
  b.flagge('m2').dispatch('click', ev({ shiftKey: true }));
  assert.equal(b.z.aend.length, 0);
  assert.deepEqual(b.z.melde, [['No range behind this marker', true]]);
});

test('double click opens the name field: Enter sends marker_setzen {id, name}', () => {
  const b = baue();
  b.flagge('m2').dispatch('dblclick', ev());
  const f = b.leiste.querySelector('input');
  assert.ok(f, 'a name field');
  assert.equal(f.value, 'Drop');
  f.value = '  Drop 2  ';
  let gestoppt = 0;
  f.dispatch('keydown', { key: 'Enter', stopPropagation: () => gestoppt++ });
  assert.equal(gestoppt, 1, 'the key does not travel on');
  assert.deepEqual(b.z.aend.map((a) => a.befehle), [[{ befehl: 'marker_setzen', id: 'm2', name: 'Drop 2' }]]);
  assert.equal(b.leiste.querySelector('input'), null, 'the field closes');
});

test('Escape in the name field sends nothing; an unchanged name sends nothing; a bad name stays open with a message', () => {
  const b = baue();
  b.flagge('m2').dispatch('dblclick', ev());
  let f = b.leiste.querySelector('input');
  f.value = 'Other';
  f.dispatch('keydown', { key: 'Escape' });
  assert.equal(b.z.aend.length, 0);
  assert.equal(b.leiste.querySelector('input'), null);
  assert.equal(b.flagge('m2').textContent, 'Drop');
  b.flagge('m2').dispatch('dblclick', ev());
  f = b.leiste.querySelector('input');
  f.dispatch('keydown', { key: 'Enter' });
  assert.equal(b.z.aend.length, 0, 'unchanged');
  b.flagge('m2').dispatch('dblclick', ev());
  f = b.leiste.querySelector('input'); f.value = '   ';
  f.dispatch('keydown', { key: 'Enter' });
  assert.equal(b.z.aend.length, 0);
  assert.ok(b.leiste.querySelector('input'), 'stays open');
  assert.equal(b.z.melde.at(-1)[1], true);
});

test('the name field keeps every key (Delete, Space, Ctrl+Z) from the page', () => {
  const b = baue();
  b.flagge('m2').dispatch('dblclick', ev());
  const f = b.leiste.querySelector('input');
  for (const key of ['Delete', 'Backspace', ' ', 'z', 'a']) {
    let n = 0;
    f.dispatch('keydown', { key, ctrlKey: key === 'z', stopPropagation: () => n++ });
    assert.equal(n, 1, key);
  }
  assert.equal(b.z.aend.length, 0);
});

test('drag: under 4 px it is a click, from 4 px one marker_setzen {id, beat} on release, snapped to the grid', async () => {
  const b = baue();
  const f = b.flagge('m2');
  f.dispatch('pointerdown', ev({ clientX: 100 }));
  f.dispatch('pointermove', ev({ clientX: 103 }));
  f.dispatch('pointerup', ev({ clientX: 103 }));
  f.dispatch('click', ev());
  assert.equal(b.z.aend.length, 0);
  assert.equal(b.z.springe.length, 1, 'under the threshold the click goes through');
  f.dispatch('pointerdown', ev({ clientX: 100 }));
  f.dispatch('pointermove', ev({ clientX: 124 }));   // +2.4 beats
  assert.equal(b.z.aend.length, 0, 'while dragging only the display moves');
  b.bild();
  assert.equal(b.flagge('m2').style.left, '180px', 'the display follows the grid-snapped beat 18.4 -> 18');
});

test('drag release sends one marker_setzen and the click after it is not a click', async () => {
  const b = baue();
  const f = b.flagge('m2');
  f.dispatch('pointerdown', ev({ clientX: 100 }));
  f.dispatch('pointermove', ev({ clientX: 130 }));
  f.dispatch('pointermove', ev({ clientX: 124 }));
  f.dispatch('pointerup', ev({ clientX: 124 }));
  assert.deepEqual(b.z.aend.map((a) => a.befehle), [[{ befehl: 'marker_setzen', id: 'm2', beat: 18 }]]);
  f.dispatch('click', ev());
  assert.equal(b.z.springe.length, 0, 'the click that ends a drag is swallowed');
  assert.equal(b.z.aend.length, 1);
});

test('drag onto the beat of another marker: refused, the flag jumps back', async () => {
  const b = baue(projekt(M), { antwort: false });
  const f = b.flagge('m2');
  f.dispatch('pointerdown', ev({ clientX: 100 }));
  f.dispatch('pointermove', ev({ clientX: 100 - 160 }));   // to beat 0 = Intro
  f.dispatch('pointerup', ev({ clientX: 100 - 160 }));
  await new Promise((ok) => setImmediate(ok));
  b.bild();
  assert.equal(b.z.aend.length, 1);
  assert.equal(b.flagge('m2').style.left, '160px', 'back at its stored beat');
});

test('a drag that ends where it began sends nothing', () => {
  const b = baue();
  const f = b.flagge('m2');
  f.dispatch('pointerdown', ev({ clientX: 100 }));
  f.dispatch('pointermove', ev({ clientX: 110 }));
  f.dispatch('pointermove', ev({ clientX: 100 }));   // back over 4 px? no: 0 px, but the drag began
  f.dispatch('pointerup', ev({ clientX: 100 }));
  assert.equal(b.z.aend.length, 0);
});

test('Delete and Backspace on a focused flag send marker_loeschen and stop the key; other keys are left alone', () => {
  const b = baue();
  for (const key of ['Delete', 'Backspace']) {
    let n = 0, d = 0;
    b.flagge('m3').dispatch('keydown', { key, stopPropagation: () => n++, preventDefault: () => d++ });
    assert.equal(n, 1, key); assert.equal(d, 1, key);
  }
  assert.deepEqual(b.z.aend.map((a) => a.befehle), [[{ befehl: 'marker_loeschen', id: 'm3' }], [{ befehl: 'marker_loeschen', id: 'm3' }]]);
  let n = 0;
  b.flagge('m3').dispatch('keydown', { key: 'z', ctrlKey: true, stopPropagation: () => n++ });
  assert.equal(n, 0, 'Ctrl+Z reaches the page (undo)');
  assert.equal(b.z.aend.length, 2);
});

test('Space on a focused flag does not click it (it belongs to the transport) and is not stopped', () => {
  const b = baue();
  const f = b.flagge('m2');
  let d = 0, s = 0;
  f.dispatch('keydown', { key: ' ', preventDefault: () => d++, stopPropagation: () => s++ });
  f.dispatch('keyup', { key: ' ', preventDefault: () => d++, stopPropagation: () => s++ });
  assert.equal(d, 2, 'the button click of Space is prevented on both edges');
  assert.equal(s, 0, 'the key travels on to the page');
  assert.equal(b.z.springe.length, 0);
});

test('keys that no flag has focus for do nothing: a key on the strip itself is ignored', () => {
  const b = baue();
  let n = 0;
  b.leiste.dispatch('keydown', { key: 'Delete', stopPropagation: () => n++ });
  assert.equal(n, 0);
  assert.equal(b.z.aend.length, 0);
});

test('F2 on a focused flag opens the name field', () => {
  const b = baue();
  b.flagge('m1').dispatch('keydown', { key: 'F2' });
  assert.ok(b.leiste.querySelector('input'));
});

test('double click on the empty strip sends marker_setzen {beat, name} at the snapped beat with the default name, then opens the name field', async () => {
  const b = baue();
  b.leiste.dispatch('dblclick', { target: b.leiste, offsetX: 247, clientX: 247 });
  assert.deepEqual(b.z.aend.map((a) => a.befehle), [[{ befehl: 'marker_setzen', beat: 25, name: 'Marker 4' }]]);
  b.ctx.st.projekt = projekt([...M, { id: 'm4', beat: 25, name: 'Marker 4' }]);
  await new Promise((ok) => setImmediate(ok));
  b.bild();
  const f = b.leiste.querySelector('input');
  assert.ok(f, 'the field of the new marker is open');
  assert.equal(f.value, 'Marker 4');
});

test('a double click on a flag is not a double click on the strip', () => {
  const b = baue();
  b.flagge('m2').dispatch('dblclick', ev());
  assert.equal(b.z.aend.length, 0);
});

test('+ MARKER adds a marker at the start marker with the default name', () => {
  const b = baue();
  b.ctx.st.start = 12;
  b.neu.dispatch('click', ev());
  assert.deepEqual(b.z.aend.map((a) => a.befehle), [[{ befehl: 'marker_setzen', beat: 12, name: 'Marker 4' }]]);
});

test('+ MARKER on a taken beat sends nothing and names the marker that sits there', () => {
  const b = baue();
  b.ctx.st.start = 16;
  b.neu.dispatch('click', ev());
  assert.equal(b.z.aend.length, 0);
  assert.match(b.z.melde.at(-1)[0], /Drop/);
  assert.equal(b.z.melde.at(-1)[1], true);
});

test('the context menu offers Rename and Delete marker', async () => {
  const b = baue();
  const { menueOffen, schliesseMenue } = await import('../public/production/context_menu.js');
  let d = 0;
  b.flagge('m2').dispatch('contextmenu', { clientX: 5, clientY: 6, preventDefault: () => d++ });
  assert.equal(d, 1);
  assert.equal(menueOffen(), true);
  const punkte = globalThis.document.body.querySelectorAll('.p-menue button').map((x) => x.textContent);
  assert.deepEqual(punkte, ['Rename', 'Delete marker']);
  globalThis.document.body.querySelectorAll('.p-menue button')[1].click();
  assert.deepEqual(b.z.aend.map((a) => a.befehle), [[{ befehl: 'marker_loeschen', id: 'm2' }]]);
  schliesseMenue();
});

test('refusal texts: the three marker reasons have page texts, not "Rejected"', () => {
  for (const g of ['songmarker_unbekannt', 'marker_beat_belegt', 'marker_zu_viele']) {
    assert.equal(typeof FEHLER_TEXT[g], 'string', g);
    assert.doesNotMatch(fehlerText({ status: 409, j: { fehler: g } }), /^Rejected/, g);
  }
});

test('transport: springeZu sets the start marker exactly (no grid snap) and starts when the transport runs', async () => {
  installiere();
  const els = new Map(), anrufe = [];
  const mk = () => new El('button');
  const $ = (n) => { if (!els.has(n)) els.set(n, mk()); return els.get(n); };
  const ctx = { st: { projekt: projekt(M), slug: 'p', start: 0, raster: 'beat', ansicht: { beat0: 0, pxProBeat: 10 }, arr: { status: 0 }, arrUnbekannt: false }, $,
    lies: (k, v) => v, merke: (k, v) => anrufe.push(['merke', k, v]), bpm: () => 120, breite: () => 800,
    holeJson: async (weg, k) => { anrufe.push([weg, k]); return { status: 200, j: { quittung: { status: 0 } } }; }, antwortText: () => '', fehlerText: () => '',
    melde() {}, aendereAus: async () => true, beimProjekt: [], beimEreignis: [], vorBild: [] };
  bindeTransport(ctx);
  ctx.springeZu(10.3, { exakt: true });
  assert.equal(ctx.st.start, 10.3);
  ctx.springeZu(10.3);
  assert.equal(ctx.st.start, 10, 'the ruler click still snaps to the grid');
  ctx.st.arr = { status: 2 };
  ctx.springeZu(16, { exakt: true });
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(anrufe.at(-1), ['/proj/transport', { aktion: 'start', beat: 16 }]);
});

test('page wiring: the strip and the button are in the page skeleton, the binder is in the list, the strip sits above the ruler', () => {
  const src = readFileSync(new URL('../public/production/production.js', import.meta.url), 'utf8');
  assert.match(src, /data-p="marker-leiste"/);
  assert.match(src, /data-p="marker-neu"/);
  assert.match(src, /const BINDER = \[[^\]]*bindeMarker/);
  assert.ok(src.indexOf('data-p="marker-leiste"') < src.indexOf('data-p="lineal"'), 'strip before ruler');
  const css = readFileSync(new URL('../public/production/production.css', import.meta.url), 'utf8');
  assert.match(css, /\.p-marker-leiste\s*\{[^}]*height:\s*16px/);
  assert.match(css, /white-space:\s*nowrap/);
});

test('wheel and Ctrl+wheel over the strip get the ruler handling (scroll, zoom, never the browser page)', () => {
  const src = readFileSync(new URL('../public/production/timeline_operation.js', import.meta.url), 'utf8');
  assert.match(src, /\$\('marker-leiste'\)\.addEventListener\('wheel', \(e\) => rad\(\{[^]*?clientX[^]*?\{ passive: false \}\)/);
});

test('the click that ends a drag is swallowed only until the next tick: a later keyboard click works', async () => {
  const b = baue();
  const f = b.flagge('m2');
  f.dispatch('pointerdown', ev({ clientX: 100 }));
  f.dispatch('pointermove', ev({ clientX: 130 }));
  f.dispatch('pointerup', ev({ clientX: 130 }));
  await new Promise((ok) => setTimeout(ok, 5));
  f.dispatch('click', ev());   // Enter on the focused flag: no pointerdown before it
  assert.deepEqual(b.z.springe, [[16, { exakt: true }]]);
});

test('markerNameFehler refuses NEL, line and paragraph separators and blank names', () => {
  for (const n of ['a\u0085b', 'a\u2028b', 'a\u2029b', '   ', '\u00a0']) assert.notEqual(markerNameFehler(n), null, JSON.stringify(n));
});
