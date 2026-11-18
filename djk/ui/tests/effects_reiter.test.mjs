// EFFECTS channel tabs: the pure parts (list, stored choice, lights) and a text check of the wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FX_REITER, reiterWahl, fxLichter, fxGlieder } from '../public/effects_reiter.js';
import { busStreifenHtml, masterPanelHtml, masterLimiterLesung, BUS_KANAELE } from '../public/effects.js';
const FX_KANAELE = [...readFileSync(new URL('../public/effects_gemeinsam.js', import.meta.url), 'utf8').match(/export const FX_KANAELE = \[(.*)\];/)[1].matchAll(/\['([a-z]+\/\d)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);

test('FX_REITER: MASTER first, then the ten channels, then SENDS and BUS', () => {
  assert.equal(FX_REITER.length, 13);
  assert.deepEqual(FX_REITER[0], { id: 'master', text: 'MASTER' });
  assert.deepEqual(FX_REITER.slice(1, 11).map((r) => r.id), FX_KANAELE.map(([k]) => k));
  assert.deepEqual(FX_REITER.slice(1, 11).map((r) => r.text), ['A', 'B', 'DRUMS', 'BASS', 'MELODY', 'I5', 'I6', 'I7', 'L1', 'L2'], 'channel tabs unchanged');
  assert.deepEqual(FX_REITER.slice(11).map((r) => r.id), ['sends', 'bus']);
});

test('reiterWahl: a stored id of the list, else the default', () => {
  assert.equal(reiterWahl('erz/3'), 'erz/3');
  assert.equal(reiterWahl('sends'), 'sends');
  assert.equal(reiterWahl('master'), 'master');
  assert.equal(reiterWahl('erz/9'), 'erz/1');
  assert.equal(reiterWahl(null), 'erz/1');
  assert.equal(reiterWahl(''), 'erz/1');
});

test('fxLichter: insert from the graph picker, comp and gate from the values, 0.5 is on', () => {
  assert.deepEqual(fxLichter({ 'erz/3/komp/an': 1, 'erz/3/gate/an': 0 }, () => ({ name: 'x' }), 'erz/3'), { insert: true, comp: true, gate: false });
  assert.deepEqual(fxLichter(undefined, () => null, 'erz/3'), { insert: false, comp: false, gate: false });
  assert.equal(fxLichter({ 'erz/3/komp/an': 0.5 }, () => null, 'erz/3').comp, true);
});

test('fxLichter: MASTER has the insert light only, never COMP or GATE', () => {
  assert.deepEqual(fxLichter({ 'master/komp/an': 1, 'master/gate/an': 1 }, () => ({ name: 'x' }), 'master'), { insert: true, comp: false, gate: false });
  assert.deepEqual(fxLichter({}, () => null, 'master'), { insert: false, comp: false, gate: false });
});

test('MASTER panel: the master chain in signal order, INSERT (picker, knob list), GLUE (master/kleber), LIMITER (meter); nothing of the buses', () => {
  const html = masterPanelHtml();
  const ort = ['data-graphplatz="master"', 'class="bkliste"', 'data-pfad="master/kleber"', 'data-messer="master|limiter_db"'].map((t) => html.indexOf(t));
  assert.ok(ort.every((i) => i >= 0), `all four parts present: ${ort}`);
  assert.deepEqual([...ort].sort((x, y) => x - y), ort, 'insert, then glue, then limiter');
  assert.deepEqual([...html.matchAll(/fx-glied-titel">([A-Z]+)</g)].map((m) => m[1]), ['INSERT', 'GLUE', 'LIMITER']);
  assert.ok(html.includes('data-kanal="master"') && html.includes('data-griff="kleber"'), 'row for the knob binding, glue knob like the mixer strip');
  assert.ok(!/lim\/an|lim_db|bus\/|komp|gate|util/.test(html), 'no bus limiter, no COMP/GATE/UTIL placeholders for stages the master does not have');
});

test('wiring (text check): the master insert knobs follow /e/regler, the LIMITER meter follows /zustand/arr', () => {
  const strom = readFileSync(new URL('../public/stream.js', import.meta.url), 'utf8');
  assert.ok(/if \(\/\^master\\\/bk\\\/\/\.test\(f\.pfad\)\) zeigeSendKnobs\(\);/.test(strom), 'master/bk echo refreshes the knob row');
  assert.ok(/if \(a === '\/zustand\/arr'\) \{ merkeArr\(f\); zeigeMasterLimiter\(f\); \}/.test(strom), 'limiter_db of /zustand/arr drives the meter');
});

test('glue knob of MASTER is the markup of the mixer MASTER strip (same data-griff, data-pfad, label, svg)', () => {
  const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const knopf = (t) => /<div class="knopf regler" data-griff="kleber" data-pfad="master\/kleber"[^>]*>.*?<\/svg><\/div>/.exec(t)[0];
  assert.equal(knopf(masterPanelHtml()), knopf(index));
});

test('masterLimiterLesung: reduction >= 0 from limiter_db <= 0; missing, text and NaN give no reading', () => {
  assert.equal(masterLimiterLesung({ limiter_db: -3.5 }), 3.5);
  assert.equal(masterLimiterLesung({ limiter_db: 0 }), 0);
  assert.equal(masterLimiterLesung({ limiter_db: 0.4 }), 0, 'never negative');
  for (const x of [{}, null, undefined, { limiter_db: '-3' }, { limiter_db: NaN }, { limiter_db: Infinity }]) assert.equal(masterLimiterLesung(x), null, JSON.stringify(x));
});

test('BUS panel: multiband, limiter (switch, ceiling, release, meter, reason) and utility on every bus, as before', () => {
  for (const k of BUS_KANAELE) {
    const html = busStreifenHtml(k, 'x');
    for (const f of ['lim/an', 'lim/decke', 'lim/abklingen', 'mb/an', 'util/dc', 'mb/grenze_tief']) assert.ok(html.includes(`data-werk-pfad="${k}/${f}"`), `${k} ${f}`);
    assert.ok(html.includes(`data-messer="${k}|lim_db"`) && html.includes('lim-grund'), `${k} limiter meter and reason`);
  }
});

test('wiring (text check): the strip builder builds the tab row, the stylesheet hides the strips that are not chosen', () => {
  const ansicht = readFileSync(new URL('../public/effects_view.js', import.meta.url), 'utf8');
  const i = ansicht.indexOf('export function baueFxStreifen(');
  const rumpf = ansicht.slice(i, ansicht.indexOf('\n}\n', i));
  assert.ok(rumpf.includes('baueFxReiterZeile(reihe'), 'tab row built inside baueFxStreifen');
  assert.ok(rumpf.includes('masterPanelHtml()') && rumpf.includes("className = 'masterpanel'"), 'MASTER panel built inside baueFxStreifen');
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
