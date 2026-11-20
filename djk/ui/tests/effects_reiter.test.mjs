// EFFECTS: the stored channel choice (FX_REITER, reiterWahl) and the pure markup the MASTER card's windows build on (master panel, bus strip, limiter reading).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FX_REITER, reiterWahl } from '../public/effects_reiter.js';
import { busStreifenHtml, masterPanelHtml, masterLimiterLesung, BUS_KANAELE } from '../public/effects.js';
const FX_KANAELE = [...readFileSync(new URL('../public/live_kanaele.js', import.meta.url), 'utf8').match(/export const FX_KANAELE = \[(.*)\];/)[1].matchAll(/\['([a-z]+\/\d)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);

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
