// 1.12 automation slice 5 (plan PLAN-1.12-slices4-5-7.md, U6 T6.3): with Stop Cypher set, huellkurve_setzen and huellkurve_loeschen from the source
// cypher are refused with 409 ki_gestoppt (core mock); Andreas' same command reaches the command layer (it answers with the command's own reason).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { bis, ruf, CYPHER } from './support/proj_stack.mjs';
import { GRUND_TEXT } from '../http/reasons.ts';

test('U6 T6.3 KI stop: envelope commands from cypher are refused with ki_gestoppt, Andreas reaches the command', async (t) => {
  const { o, url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Huelle' });
  const befehle = [[{ befehl: 'huellkurve_setzen', clip_id: 'c9', ziel: 'gain', punkte: [{ beat: 0, wert: -6 }] }], [{ befehl: 'huellkurve_loeschen', clip_id: 'c9', ziel: 'gain' }]];
  for (const b of befehle) {     // before the stop: cypher reaches the command layer too (negative control)
    assert.equal((await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'x', befehle: b }, CYPHER)).j.fehler, 'clip_unbekannt');
  }
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(o).kiGestoppt));
  for (const b of befehle) {
    assert.deepEqual((await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'x', befehle: b }, CYPHER)).j, { fehler: 'ki_gestoppt', text: GRUND_TEXT.ki_gestoppt });
    const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'x', befehle: b });
    assert.deepEqual([a.code, a.j.fehler], [404, 'clip_unbekannt'], 'Andreas still reaches the command');
  }
});
