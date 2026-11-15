// EFFECTS channel tabs: the pure parts (list, stored choice, lights) and a text check of the wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FX_REITER, reiterWahl, fxLichter, fxGlieder } from '../public/effects_reiter.js';
const FX_KANAELE = [...readFileSync(new URL('../public/effects_gemeinsam.js', import.meta.url), 'utf8').match(/export const FX_KANAELE = \[(.*)\];/)[1].matchAll(/\['([a-z]+\/\d)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);

test('FX_REITER: the ten channels, then SENDS and BUS', () => {
  assert.equal(FX_REITER.length, 12);
  assert.deepEqual(FX_REITER.slice(0, 10).map((r) => r.id), FX_KANAELE.map(([k]) => k));
  assert.deepEqual(FX_REITER.slice(10).map((r) => r.id), ['sends', 'bus']);
});

test('reiterWahl: a stored id of the list, else the default', () => {
  assert.equal(reiterWahl('erz/3'), 'erz/3');
  assert.equal(reiterWahl('sends'), 'sends');
  assert.equal(reiterWahl('erz/9'), 'erz/1');
  assert.equal(reiterWahl(null), 'erz/1');
  assert.equal(reiterWahl(''), 'erz/1');
});

test('fxLichter: insert from the graph picker, comp and gate from the values, 0.5 is on', () => {
  assert.deepEqual(fxLichter({ 'erz/3/komp/an': 1, 'erz/3/gate/an': 0 }, () => ({ name: 'x' }), 'erz/3'), { insert: true, comp: true, gate: false });
  assert.deepEqual(fxLichter(undefined, () => null, 'erz/3'), { insert: false, comp: false, gate: false });
  assert.equal(fxLichter({ 'erz/3/komp/an': 0.5 }, () => null, 'erz/3').comp, true);
});

test('wiring (text check): the strip builder builds the tab row, the stylesheet hides the strips that are not chosen', () => {
  const ansicht = readFileSync(new URL('../public/effects_view.js', import.meta.url), 'utf8');
  const i = ansicht.indexOf('export function baueFxStreifen(');
  const rumpf = ansicht.slice(i, ansicht.indexOf('\n}\n', i));
  assert.ok(rumpf.includes('baueFxReiterZeile(reihe'), 'tab row built inside baueFxStreifen');
  for (const f of ['zeigeKomp', 'zeigeWerkzeug', 'waehleFx']) {
    const j = ansicht.indexOf(`function ${f}(`);
    assert.ok(ansicht.slice(j, ansicht.indexOf('\n}\n', j)).includes('zeigeFxReiter()') || ansicht.slice(j, ansicht.indexOf('\n}\n', j)).includes('waehleFxReiter('), `${f} calls the tab refresh`);
  }
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.fxstreifen-reihe\s*>\s*\.fx-aus\s*\{[^}]*display:\s*none/);
});

test('fxGlieder: the sections of a channel in signal order, insert only where a graph can go', () => {
  assert.deepEqual(fxGlieder('erz/1'), ['gate', 'comp', 'util']);
  for (const k of ['erz/3', 'deck/1', 'pad/2']) assert.deepEqual(fxGlieder(k), ['insert', 'gate', 'comp', 'util'], k);
});

test('chain (text check): the strip builder has the four sections, and the compressor, gate and util controls stay inside the strip', () => {
  const ansicht = readFileSync(new URL('../public/effects_view.js', import.meta.url), 'utf8');
  const i = ansicht.indexOf('export function baueFxStreifen(');
  const rumpf = ansicht.slice(i, ansicht.indexOf('\n}\n', i));
  assert.ok(rumpf.includes('fx-glied fx-glied-${') && rumpf.includes('fx-glied-titel'), 'section markup with a heading');
  for (const n of ['insert', 'gate', 'comp', 'util']) assert.ok(new RegExp(`\\b${n}:`).test(rumpf), `section ${n}`);
  assert.ok(rumpf.includes('fxGlieder(k)'));
  assert.ok(rumpf.includes('komp-an') && rumpf.includes('data-komp-feld') && rumpf.includes("werkzeugStreifenHtml(k, name, ['gate'])") && rumpf.includes("werkzeugStreifenHtml(k, name, ['util'])"));
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.fx-glied-titel\s*\{/);
});
