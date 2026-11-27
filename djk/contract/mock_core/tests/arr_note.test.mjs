// node --test tests/arr_note.test.mjs: /k/arr/note in the stand-in (INTERFACES 4.11; sampler plan A1 task 7).
// Like the core: spur 1..128 (spur_bereich), ton and vel 0..127 (ausserhalb_bereich), acknowledged 1 and 3, no arm and no running transport needed; cypher in the AI stop is
// refused ki_gestoppt before any range check; a refused note is not recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neuerKern } from '../module.mjs';
import { kodiere } from '../osc.mjs';
import { arbeitsbestand } from './help.mjs';

const cfg = { arbeitsbestand: arbeitsbestand() };
function kern() {
  const log = [];
  const K = neuerKern({ cfg, mutationen: [], sende: (m) => { if (m.ports.includes(1)) log.push(m); } });
  K.empfange(kodiere('/k/hallo', 'sii', ['t', 1, 1]), { port: 1 });
  const bis = (s) => { while (K.jetzt <= s) K.block(); };
  const cmd = (adr, typen, werte) => K.empfange(kodiere(adr, typen, werte), { port: 1 });
  const note = (id, quelle, spur, ton, vel) => cmd('/k/arr/note', 'hsiii', [BigInt(id), quelle, spur, ton, vel]);
  return { K, log, bis, note, cmd };
}
const grund = (log, id) => log.filter((m) => m.adresse === '/q' && m.werte[0] === BigInt(id)).map((m) => `${m.werte[2]}${m.werte[5] ? '/' + m.werte[5] : ''}`);

test('arr_note: a note with the transport standing and no arm is acknowledged 1, 3 and recorded; vel 0 is the off', () => {
  const { K, log, bis, note } = kern();
  note(1, 'andreas', 1, 60, 100);
  note(2, 'andreas', 1, 60, 0);
  note(3, 'cypher', 128, 127, 127);
  bis(4000);
  for (const id of [1, 2, 3]) assert.deepEqual(grund(log, id), ['1', '3'], `command ${id}`);
  assert.deepEqual(K.arr.noten, [{ spur: 1, ton: 60, vel: 100 }, { spur: 1, ton: 60, vel: 0 }, { spur: 128, ton: 127, vel: 127 }]);
  assert.equal(K.arr.status, 0, 'the transport stood');
});

test('arr_note: spur outside 1..128 is spur_bereich, ton or vel outside 0..127 is ausserhalb_bereich; nothing is recorded', () => {
  const { K, log, bis, note } = kern();
  note(10, 'andreas', 0, 60, 100);
  note(11, 'andreas', 129, 60, 100);
  note(12, 'andreas', -1, 60, 100);
  note(13, 'andreas', 1, 128, 100);
  note(14, 'andreas', 1, -1, 100);
  note(15, 'andreas', 1, 60, 128);
  bis(4000);
  for (const id of [10, 11, 12]) assert.deepEqual(grund(log, id), ['6/spur_bereich'], `command ${id}`);
  for (const id of [13, 14, 15]) assert.deepEqual(grund(log, id), ['6/ausserhalb_bereich'], `command ${id}`);
  assert.deepEqual(K.arr.noten, []);
});

test('arr_note: cypher in the AI stop is refused ki_gestoppt before any range check, andreas still plays', () => {
  const { K, log, bis, note, cmd } = kern();
  cmd('/k/ki/stopp', 'hs', [100n, 'andreas']);
  bis(2000);
  note(20, 'cypher', 1, 60, 100);
  note(21, 'cypher', 99, 60, 100);
  note(22, 'andreas', 1, 60, 100);
  bis(6000);
  assert.deepEqual(grund(log, 20), ['6/ki_gestoppt']);
  assert.deepEqual(grund(log, 21), ['6/ki_gestoppt']);
  assert.deepEqual(grund(log, 22), ['1', '3']);
  assert.deepEqual(K.arr.noten, [{ spur: 1, ton: 60, vel: 100 }]);
});
