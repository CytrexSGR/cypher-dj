// Page channel catalogue (container core lane U, U1): every list is derived from the generated pult module, never typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../public/pult.js';
import {
  CONTAINER, BUSSE, STROEME, ALIAS_SUFFIXE, containerName, platzVonPfad, pfadVonPlatz, stromKanal, stromVonKanal, fxIndex, fxReiter, bkKanaele,
} from '../public/kanaele.js';

test('CONTAINER has four entries A..D whose paths and players equal pult.js', () => {
  assert.deepEqual(CONTAINER.map((c) => [c.id, c.pfad, c.player]), [['A', 'deck/1', 1], ['B', 'deck/2', 2], ['C', 'pad/1', 3], ['D', 'pad/2', 4]]);
  assert.deepEqual(CONTAINER.map((c) => c.pfad), P.pultContainerPfad);
  assert.deepEqual(CONTAINER.map((c) => c.player), P.pultContainerPlayer);
  assert.deepEqual(CONTAINER.map((c) => c.platz), [1, 2, 3, 4]);
  assert.deepEqual(BUSSE, P.pultBusPfad);
});

test('containerName and platzVonPfad agree with containerVonPfad of pult.js for every container path, and are null for erz/1, deck/3, bus/1, master', () => {
  for (const [i, pfad] of P.pultContainerPfad.entries()) {
    assert.equal(platzVonPfad(pfad), P.containerVonPfad(pfad));
    assert.equal(platzVonPfad(`${pfad}/fader`), i + 1);
    assert.equal(containerName(pfad), 'ABCD'[i]);
    assert.equal(pfadVonPlatz(i + 1), pfad);
  }
  for (const p of ['erz/1', 'deck/3', 'bus/1', 'master']) { assert.equal(containerName(p), null, p); assert.equal(platzVonPfad(p), null, p); }
  assert.throws(() => pfadVonPlatz(0));
  assert.throws(() => pfadVonPlatz(5));
});

test('stromKanal and stromVonKanal are inverse for every number of STROEME, and stromVonKanal(erz/0) and (pad/1) are null', () => {
  assert.deepEqual(STROEME, P.PULT_ALIAS_STROEME);
  for (const n of STROEME) { assert.equal(stromKanal(n), `erz/${n}`); assert.equal(stromVonKanal(stromKanal(n)), n); }
  assert.equal(stromVonKanal('erz/0'), null);
  assert.equal(stromVonKanal('erz/4'), null, 'stream 4 is no alias stream');
  assert.equal(stromVonKanal('pad/1'), null);
});

test('fxIndex follows the F1 order', () => {
  assert.equal(fxIndex('deck/1'), 0);
  assert.equal(fxIndex('pad/2'), 3);
  assert.equal(fxIndex('bus/1'), 4);
  assert.equal(fxIndex('erz/1'), null);
});

test('fxReiter lists MASTER, A, B, C, D, SENDS, BUS in this order and no stream tab', () => {
  assert.deepEqual(fxReiter().map((r) => r.text), ['MASTER', 'A', 'B', 'C', 'D', 'SENDS', 'BUS']);
  assert.deepEqual(fxReiter().map((r) => r.id), ['master', 'deck/1', 'deck/2', 'pad/1', 'pad/2', 'sends', 'bus']);
});

test('ALIAS_SUFFIXE equals pult.js pultAliasSuffixe', () => {
  assert.deepEqual(ALIAS_SUFFIXE, P.pultAliasSuffixe);
});

test('bkKanaele: the containers, then every stream alias (the table carries bk/<k> for stream 1 too)', () => {
  assert.deepEqual(bkKanaele(), ['deck/1', 'deck/2', 'pad/1', 'pad/2', 'erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'erz/9', 'erz/10']);
});
