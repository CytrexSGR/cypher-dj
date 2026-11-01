// 1.10 slice 3: the page, pure parts of the returns, the sends and the Hall units (routing.js, returns.js). The DOM parts are checked by the browser probe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { returnListe, sendWert, sendBefehl, neuerReturnBefehl, returnLabels, sendLabel, hallEinheit, hallText, HALL_TABELLE } from '../oeffentlich/produktion/routing.js';
import { MAX_RETURNS } from '../oeffentlich/produktion/grenzen.js';
import { RETURN_VOLL_TEXT } from '../oeffentlich/produktion/returns.js';

const r = (nr) => ({ id: `r${nr}`, nr, name: `Return ${nr}`, farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false });
const REF = JSON.parse(fs.readFileSync(new URL('../../kern/tests/daten/hall_abbildung_ref.json', import.meta.url), 'utf8'));
// the field of the project -> the name in the reference table
const FELD_ZU_REF = { pre: 'pre', decay: 'decay', groesse: 'size', tief: 'low', highcut: 'highcut', fahne: 'tail' };

test('slice 3 page: "+ Return: Hall" makes return_neu without arguments, locked at 4 returns with the text "All 4 returns are used"', () => {
  assert.deepEqual(neuerReturnBefehl({ returns: [] }), { befehl: 'return_neu' });
  assert.deepEqual(neuerReturnBefehl({}), { befehl: 'return_neu' });
  assert.equal(neuerReturnBefehl(null), null);
  assert.equal(neuerReturnBefehl({ returns: Array.from({ length: MAX_RETURNS }, (_, i) => r(i + 1)) }), null, 'four returns are the end');
  assert.equal(RETURN_VOLL_TEXT, 'All 4 returns are used');
});

test('slice 3 page: returns by number, the send value of a strand (-200 without an entry), the send command, the labels name the strand and the return', () => {
  assert.deepEqual(returnListe({ returns: [r(3), r(1)] }).map((x) => x.nr), [1, 3]);
  assert.deepEqual(returnListe(null), []);
  const spur = { id: 's1', sends: [{ id: 'r2', db: -6 }] };
  assert.equal(sendWert(spur, 'r2'), -6); assert.equal(sendWert(spur, 'r1'), -200); assert.equal(sendWert({ id: 's2' }, 'r1'), -200);
  assert.deepEqual(sendBefehl('s1', 'r2', -9), { befehl: 'send_setzen', strang_id: 's1', return_id: 'r2', db: -9 });
  assert.deepEqual(returnLabels('Hall'), { mute: 'Mute return Hall', solo: 'Solo return Hall', fader: 'Volume return Hall', pan: 'Balance return Hall',
    loeschen: 'Delete return Hall', umbenennen: 'Rename return Hall', hall: 'Hall on or off, return Hall' });
  assert.equal(sendLabel('Kick', 'Hall'), 'Send Kick to Hall');
});

test('slice 3 page: the Hall unit guard, 6 parameters x 5 points against hall_abbildung_ref.json (relative tolerance 1e-4)', () => {
  let n = 0;
  for (const [feld, refName] of Object.entries(FELD_ZU_REF)) {
    const p = REF.parameters[refName];
    assert.ok(p, refName);
    assert.equal(HALL_TABELLE[feld].einheit === 'x' ? 'factor' : HALL_TABELLE[feld].einheit, p.unit, `${feld} unit`);
    p.x.forEach((x, i) => {
      const soll = p.y[i], ist = hallEinheit(feld, x);
      assert.ok(Math.abs(ist - soll) <= 1e-4 * Math.max(1, Math.abs(soll)), `${feld}(${x}) = ${ist}, reference ${soll}`);
      n++;
    });
  }
  assert.equal(n, 30);
  assert.equal(hallText('decay', 0.5), '1.73 s'); assert.equal(hallText('highcut', 1), '22.0 kHz'); assert.equal(hallText('fahne', 0), '-24.0 dB');
  assert.throws(() => hallEinheit('mix', 0.5));
});

test('slice 3 page: negative control for the guard: a changed curve is red (decay as a linear curve misses the reference)', () => {
  const echt = HALL_TABELLE.decay.kurve;
  HALL_TABELLE.decay.kurve = 'linear';
  try {
    const p = REF.parameters.decay;
    const rot = p.x.some((x, i) => Math.abs(hallEinheit('decay', x) - p.y[i]) > 1e-4 * Math.max(1, Math.abs(p.y[i])));
    assert.ok(rot, 'the mutation must make the guard fail');
  } finally { HALL_TABELLE.decay.kurve = echt; }
});

test('slice 3 page: every data-p id that returns.js asks for stands in the frame of produktion.js (negative control: an invented one does not)', () => {
  const dom = fs.readFileSync(new URL('../oeffentlich/produktion/returns.js', import.meta.url), 'utf8');
  const geruest = fs.readFileSync(new URL('../oeffentlich/produktion/produktion.js', import.meta.url), 'utf8');
  const gefragt = [...dom.matchAll(/\$\('([a-z-]+)'\)/g)].map((m) => m[1]);
  assert.ok(gefragt.length >= 4, `found: ${gefragt}`);
  for (const k of gefragt) assert.ok(geruest.includes(`data-p="${k}"`), `data-p="${k}" is missing in the frame`);
  assert.ok(!geruest.includes('data-p="gibt-es-nicht"'));
  assert.match(geruest, /bindeReturns/);
});
