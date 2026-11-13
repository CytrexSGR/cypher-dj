// Places plan, slice 3 task 11 (page part): the deck buttons LOOP -> L1/L2 export into the loop slot (POST /modul/export {deck, slot}), and the
// library's load buttons put a library loop into a slot (POST /modul/loop {name, slot}, task 10). The calls run against a stub of holeJson.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportiereInSlot, ladeLoopInSlot, slotBuchstabe } from '../public/live_module.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const stub = (status, j) => { const calls = []; const f = async (weg, daten) => { calls.push([weg, daten]); return { status, j }; }; f.calls = calls; return f; };

test('slot numbers 1 and 2 are the slot letters A and B', () => {
  assert.equal(slotBuchstabe(1), 'A'); assert.equal(slotBuchstabe(2), 'B');
});

test('LOOP -> L1 posts /modul/export with the deck and slot A, L2 with slot B', async () => {
  const h1 = stub(200, { slot: 'A' });
  const r1 = await exportiereInSlot(3, 1, h1);
  assert.deepEqual(h1.calls, [['/modul/export', { deck: 3, slot: 'A' }]]);
  assert.equal(r1.ok, true); assert.match(r1.text, /Loop 1/);
  const h2 = stub(200, { slot: 'B' });
  await exportiereInSlot(1, 2, h2);
  assert.deepEqual(h2.calls, [['/modul/export', { deck: 1, slot: 'B' }]]);
});

test('a refused export names the reason (slot_belegt, kanal_offen) and is not ok', async () => {
  const r = await exportiereInSlot(2, 1, stub(409, { fehler: 'kanal_offen', text: 'the channel pad/1 is open' }));
  assert.equal(r.ok, false); assert.match(r.text, /the channel pad\/1 is open/);
  const r2 = await exportiereInSlot(2, 2, stub(409, { fehler: 'slot_belegt' }));
  assert.equal(r2.ok, false); assert.match(r2.text, /slot_belegt/);
});

test('loading a library loop posts /modul/loop with the name and the slot letter', async () => {
  const h = stub(200, { slot: 'B' });
  const r = await ladeLoopInSlot('komp-roh-drums', 2, h);
  assert.deepEqual(h.calls, [['/modul/loop', { name: 'komp-roh-drums', slot: 'B' }]]);
  assert.equal(r.ok, true); assert.match(r.text, /Loop 2/);
  const x = await ladeLoopInSlot('nope', 1, stub(404, { fehler: 'loop_unbekannt' }));
  assert.equal(x.ok, false); assert.match(x.text, /loop_unbekannt/);
});

test('the page buttons use the new verbs and no old box route', () => {
  const nb = app.slice(app.indexOf("for (const b of $$('[data-nachbox]', d))"), app.indexOf("for (const b of $$('[data-raster]', d))"));
  assert.match(nb, /exportiereInSlot\(n, Number\(b\.dataset\.nachbox\), holeJson\)/);
  assert.doesNotMatch(nb, /loop\/sichern/);
  assert.doesNotMatch(app, /loopAktion\(\{ aktion: 'laden'/);
  assert.match(app, /ladeLoopInSlot\(name, n, holeJson\)/);
  assert.match(app, /ladeLoopSlot\(l\.name, n\)/);
  assert.match(app, /await ladeLoopSlot\(r\.j\.name, n\)/);
  assert.match(html, /data-nachbox="1" title="Export the running loop into the loop slot L1/);
  assert.match(html, /data-nachbox="2" title="Export the running loop into the loop slot L2/);
});

test('a disabled button is dimmed like EXPORT: general button:disabled rule (opacity .35, cursor default)', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  assert.match(css, /^button:disabled \{ opacity: \.35; cursor: default; \}/m);
});

test('DJ view mixer strip: one grid, PFL and FX 1/2 in the cell beside LO, fader row takes the free room', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  assert.match(css, /body:not\(\.studio\) #pult \.zug \.knoepfe, body:not\(\.studio\) #pult \.zug \.faderspalte \{ display: contents; \}/);
  assert.match(css, /grid-template-rows: auto repeat\(3, auto\) minmax\(60px, 1fr\) auto auto;/);
  assert.match(css, /#pult \.zug \.pfl \{ grid-row: 4; grid-column: 1;/);
  assert.match(css, /#pult \.zug \.regler\.senkrecht \{ grid-row: 5; grid-column: 1 \/ -1; \}/);
});
