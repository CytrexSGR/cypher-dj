// node --test tests/arr_host.test.mjs: /k/arr/ins_host, /k/arr/ins_mess and their answers in the stand-in (INTERFACES 4.11, 5.13; plan 1.11 T5).
// Like the core: the measurement is refused `laeuft` while the transport is not stopped and `host_fehlt` while the host is not healthy; else it answers 2 x quantum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neuerKern } from '../module.mjs';
import { kodiere } from '../osc.mjs';
import { arbeitsbestand } from './help.mjs';

const cfg = { arbeitsbestand: arbeitsbestand() };
function kern(mutationen = []) {
  const log = [];
  const K = neuerKern({ cfg, mutationen, sende: (m) => { if (m.ports.includes(1)) log.push(m); } });
  K.empfange(kodiere('/k/hallo', 'sii', ['t', 1, 1]), { port: 1 });
  const bis = (s) => { while (K.jetzt <= s) K.block(); };
  const cmd = (adr, typen, werte) => K.empfange(kodiere(adr, typen, werte), { port: 1 });
  return { K, log, bis, cmd };
}
const e = (log, adr) => log.filter((m) => m.adresse === adr).map((m) => m.werte);

test('ins_host: the flag is answered with /e/ins_host, a range error is /q 6 ausserhalb_bereich', () => {
  const { log, bis, cmd } = kern();
  cmd('/k/arr/ins_host', 'hsii', [1n, 'leitstand', 2, 1]);
  cmd('/k/arr/ins_host', 'hsii', [2n, 'leitstand', 5, 1]);
  cmd('/k/arr/ins_host', 'hsii', [3n, 'leitstand', 1, 2]);
  bis(2000);
  assert.deepEqual(e(log, '/e/ins_host'), [[2, 1]]);
  const q6 = log.filter((m) => m.adresse === '/q' && m.werte[2] === 6).map((m) => m.werte[5]);
  assert.deepEqual(q6, ['ausserhalb_bereich', 'ausserhalb_bereich']);
});

test('ins_mess: host_fehlt before the host is healthy, then 2 x quantum, empty reason', () => {
  const { log, bis, cmd } = kern();
  cmd('/k/arr/ins_mess', 'hsi', [1n, 'leitstand', 1]);
  bis(2000);
  assert.deepEqual(e(log, '/e/ins_mess'), [[1, -1, 'host_fehlt']]);
  cmd('/k/arr/ins_host', 'hsii', [2n, 'leitstand', 1, 1]);
  cmd('/k/arr/ins_mess', 'hsi', [3n, 'leitstand', 1]);
  bis(4000);
  assert.deepEqual(e(log, '/e/ins_mess').at(-1), [1, 512, '']);
});

test('ins_mess: laeuft while the transport plays', () => {
  const { log, bis, cmd } = kern();
  cmd('/k/arr/ins_host', 'hsii', [1n, 'leitstand', 1, 1]);
  cmd('/k/arr/laden', 'hsi', [4n, 'leitstand', 1]);
  bis(1000);
  cmd('/k/arr/start', 'hsdi', [2n, 'leitstand', 0.0, 0]);
  bis(4000);
  cmd('/k/arr/ins_mess', 'hsi', [3n, 'leitstand', 1]);
  bis(6000);
  assert.deepEqual(e(log, '/e/ins_mess').at(-1), [1, -1, 'laeuft']);
});
