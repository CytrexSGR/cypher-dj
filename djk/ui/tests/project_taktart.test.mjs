// Project meter n/4 (plan production, Task 13): model check, command taktart_setzen, 4/4 stays as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, kanonisch, TAKTART_ZAEHLER_MIN, TAKTART_ZAEHLER_MAX } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { specProjekt, kopie } from './support/project.mjs';

const mit = (taktart) => { const p = kopie(neuesProjekt('T')); p.taktart = taktart; return pruefeProjekt(p); };

test('model: n/4 with n = 2..12 passes, 4/4 is unchanged', () => {
  assert.equal(TAKTART_ZAEHLER_MIN, 2); assert.equal(TAKTART_ZAEHLER_MAX, 12);
  for (const n of [2, 3, 4, 5, 7, 12]) assert.deepEqual(mit([n, 4]).projekt?.taktart, [n, 4], `${n}/4`);
  assert.deepEqual(neuesProjekt('T').taktart, [4, 4]);
});

test('model: everything else is refused with a taktart error', () => {
  for (const t of [[3, 3], [1, 4], [13, 4], [3.5, 4], [6, 8], [3], '3/4']) {
    const r = mit(t);
    assert.ok(r.fehler && /taktart/.test(r.fehler), `${JSON.stringify(t)} must be refused: ${JSON.stringify(r)}`);
  }
});

test('an existing stored 4/4 project keeps its bytes and its check result', () => {
  const p = specProjekt();
  assert.deepEqual(p.taktart, [4, 4]);
  const geprueft = pruefeProjekt(kopie(p));
  assert.ok(geprueft.projekt);
  assert.deepEqual(geprueft.projekt.taktart, [4, 4]);
  assert.equal(kanonisch(pruefeProjekt(kopie(geprueft.projekt)).projekt), kanonisch(geprueft.projekt), 'checking a checked project changes no byte');
  assert.ok(!kanonisch(p).includes('"taktart":[3'), 'no meter other than 4/4 appears');
});

test('taktart_setzen: sets the meter, one undo step, not a playback change, undo restores 4/4', () => {
  const p = specProjekt();
  const r = fuehreAus(p, { befehl: 'taktart_setzen', taktart: [3, 4] });
  assert.deepEqual(r.projekt.taktart, [3, 4]);
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.regler_aenderungen, []);
  assert.deepEqual(wende(r.projekt, r.zurueck).taktart, [4, 4]);
  assert.ok(pruefeProjekt(r.projekt).projekt);
});

test('taktart_setzen: 6/8 and other nonsense is refused with argument_ungueltig', () => {
  const p = specProjekt();
  for (const t of [[6, 8], [1, 4], [13, 4], [3.5, 4], [3], '3/4', undefined]) {
    assert.throws(() => fuehreAus(p, { befehl: 'taktart_setzen', taktart: t }), (e) => e instanceof BefehlFehler && e.grund === 'argument_ungueltig', JSON.stringify(t));
  }
});
