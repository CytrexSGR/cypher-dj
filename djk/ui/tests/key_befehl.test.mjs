// Project key: the field `tonart` of a project and the command tonart_setzen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeFehler, wiedergabeSicht } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { kopie } from './support/project.mjs';

const lauf = (p, befehle) => fuehreListeAus(kopie(p), befehle);
const grund = (p, b) => { try { fuehreListeAus(kopie(p), [b]); return null; } catch (e) { return e.grund; } };

test('tonart_setzen writes the key, aus removes it, playback does not change', () => {
  const p = neuesProjekt('k');
  const a = lauf(p, [{ befehl: 'tonart_setzen', grundton: 9, skala: 'minor' }]);
  assert.deepEqual(a.projekt.tonart, { grundton: 9, skala: 'minor' });
  assert.equal(pruefeFehler(a.projekt), null);
  assert.deepEqual(wiedergabeSicht(a.projekt), wiedergabeSicht(p));
  assert.equal(a.betrifft_wiedergabe, false);
  const b = lauf(a.projekt, [{ befehl: 'tonart_setzen', aus: true }]);
  assert.equal('tonart' in b.projekt, false);
});

test('tonart_setzen refuses a wrong key', () => {
  const p = neuesProjekt('k');
  for (const arg of [{ grundton: 12, skala: 'minor' }, { grundton: 0, skala: 'moll' }, { grundton: 0 }, { aus: true, grundton: 1 }, { aus: false }]) {
    assert.equal(grund(p, { befehl: 'tonart_setzen', ...arg }), 'argument_ungueltig', JSON.stringify(arg));
  }
});

test('a stored project with a wrong key is refused', () => {
  const p = { ...neuesProjekt('k'), tonart: { grundton: 3, skala: 'nope' } };
  assert.match(String(pruefeFehler(p)), /tonart/);
});
