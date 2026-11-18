// Audit U12: a return number reused in one diff (return_loeschen + return_neu): the Hall rows of the new return are compared with the DELETED return of
// that number, so a value the old one had changed and the new one has at default is sent back to the default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, HALL_VORGABE } from '../project/model.ts';

const ok = (p, b) => fuehreAus(p, b).projekt;

test('return: delete + new in one step resets ret/<nr>/hall/* the old return had changed', () => {
  let p = neuesProjekt('T');
  p = ok(p, { befehl: 'return_neu', hall: { decay: 0.9, pre: 0.2 } });
  const alt = p.returns[0];
  assert.equal(alt.hall.decay, 0.9);
  const r = fuehreListeAus(p, [{ befehl: 'return_loeschen', return_id: alt.id }, { befehl: 'return_neu' }]);
  const neu = r.projekt.returns[0];
  assert.ok(neu.id !== alt.id && neu.nr === alt.nr, 'the new return takes the same nr');
  const hall = (k) => r.regler_aenderungen.find((x) => x.pfad === `ret/${neu.nr}/hall/${k}`);
  assert.deepEqual(hall('decay'), { pfad: `ret/${neu.nr}/hall/decay`, wert: HALL_VORGABE.decay }, JSON.stringify(r.regler_aenderungen));
  assert.deepEqual(hall('pre'), { pfad: `ret/${neu.nr}/hall/pre`, wert: HALL_VORGABE.pre });
  assert.equal(hall('groesse'), undefined, 'a value that was default in both is not sent');
});

test('negative control: a new return with a number nobody had sends only its own deviations', () => {
  const r = fuehreListeAus(neuesProjekt('T'), [{ befehl: 'return_neu', hall: { decay: 0.9 } }]);
  const hall = r.regler_aenderungen.filter((x) => x.pfad.includes('/hall/'));
  assert.deepEqual(hall.map((x) => x.pfad), ['ret/1/hall/decay']);
});
