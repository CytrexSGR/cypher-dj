// Audit U16: POST /seq/befehle with a command name that is an inherited key of FELDER ('constructor', 'toString', '__proto__', ...) must be refused with 400
// (argument_ungueltig, "not allowed here"), not crash with a TypeError (500 intern).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SeqBereich } from '../areas/live/seq.ts';
import { ProjFehler } from '../areas/proj/session.ts';

const bereich = Object.create(SeqBereich.prototype);   // pruefeBefehle reads only its arguments
const projekt = { spuren: [{ id: 's1', name: 'A', ausgang: { id: 'g1' }, clips: [] }] };
const deck = { id: 'g1' };
const pruefe = (b) => bereich.pruefeBefehle(projekt, deck, [b]);

for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
  test(`command ${name} is refused as 400 argument_ungueltig`, () => {
    assert.throws(() => pruefe({ befehl: name, spur_id: 's1' }),
      (e) => e instanceof ProjFehler && e.code === 400 && e.fehler === 'argument_ungueltig' && /not allowed here/.test(String(e.extra?.text)), name);
  });
}

test('negative control: an allowed command still passes, an unknown one is refused as before', () => {
  assert.equal(pruefe({ befehl: 'spur_aendern', spur_id: 's1', name: 'B' }).length, 1);
  assert.throws(() => pruefe({ befehl: 'unbekannt' }), (e) => e instanceof ProjFehler && e.code === 400);
});
