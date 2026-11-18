// Plan studio-taktart review finding: KernWeg.tempo (the tempo ramp before a transport start) puts the ramp on the bar of the open project meter.
// At beat 13.3 the 3-grid gives 15 and the 4-grid 16, so the test fails when the proTakt wiring in session.ts is lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../areas/proj/area.ts';
import { pruefKontext } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';

function aufbau(t) {
  const k = pruefKontext();
  const d = tmpOrdner(t, 'djk-kw-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30, uhrStillMs: 100 });
  t.after(() => b.sitzung.schliesse());
  return { k, b, s: b.sitzung };
}
async function rampeBei(meter, t) {
  const e = aufbau(t);
  await e.s.neu('Eins', 'andreas');
  if (meter) {
    const r = await e.s.aendern({ rev: e.s.aktuell().j.projekt.rev, label: 'meter', befehle: [{ befehl: 'taktart_setzen', taktart: meter }] }, 'andreas');
    assert.ok(r, 'meter set');
  }
  e.s.ereignis('/uhr', { beat: 13.3, bpm: 128 });   // project tempo 120: the start sends a ramp first
  e.k.leere();
  await e.s.transport({ aktion: 'start' }, 'andreas').catch(() => {});   // no core: the wait ends with an error, the ramp is already sent
  const r = e.k.an('/k/tempo/rampe');
  assert.equal(r.length, 1);
  return r[0].felder.ab_beat;
}

test('KernWeg tempo: with a 3/4 project the ramp starts on a bar of 3 (15), with 4/4 on a bar of 4 (16)', async (t) => {
  assert.equal(await rampeBei([3, 4], t), 15);
  assert.equal(await rampeBei(null, t), 16);
});
