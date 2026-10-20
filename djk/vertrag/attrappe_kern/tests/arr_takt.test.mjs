// node --test tests/arr_takt.test.mjs: /zustand/arr geht wie im Kern (kern/src/kern_arr.cpp arr_zustand) nicht nur bei jeder Änderung hinaus,
// sondern auch im Takt: 50 Hz (je 960 Samples), solange er wartet oder spielt, sonst 2 Hz (je 24 000 Samples). Anlass: D1 S2-Integration Fix-Runde 4
// J1 (Spec 6.21, 6.35): ein Seiten-Server, der neu startet, erfährt die Wiedergabe-Nummer des Kerns nur so (sonst gälte nach der Frist „verschieden“).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { arbeitsbestand, sende } from './hilfe.mjs';

const cfg = { arbeitsbestand: arbeitsbestand() };
const zustand = (r, von, bis) => r.log.filter((m) => m.adresse === '/zustand/arr' && m.s >= von && m.s < bis);

test('arr Takt: steht er, kommt /zustand/arr mit 2 Hz (Stempel auf Vielfachen von 24 000), auch ohne Änderung', () => {
  const r = fahre([sende(1000, ['/k/arr/laden', 'hsi', 1, 'andreas', 17]), sende(120000, ['/k/ki/frei', 'hs', 2, 'andreas'])], { cfg });
  const z = zustand(r, 10000, 110000);
  console.log(`arr_takt steht ${JSON.stringify(z.map((m) => [m.s, m.werte[0]]))}`);
  assert.equal(z.length, 4, 'vier Vielfache von 24 000 zwischen 10 000 und 110 000');
  z.forEach((m, i) => { const ziel = 24000 * (i + 1); assert.ok(m.s <= ziel && ziel - m.s < 1024, `Meldung ${i}: Blockanfang ${m.s} vor ${ziel}`); });
  assert.ok(z.every((m) => m.werte[0] === 17 && m.werte[1] === 0));
});

test('arr Takt: wartet oder spielt er, 50 Hz (alle 960 Samples)', () => {
  const r = fahre([sende(1000, ['/k/arr/laden', 'hsi', 1, 'andreas', 17]), sende(10000, ['/k/arr/start', 'hsdi', 2, 'andreas', 0, 0]),
    sende(60000, ['/k/ki/frei', 'hs', 3, 'andreas'])], { cfg });
  const z = zustand(r, 20000, 50000);
  assert.ok(z.length >= 30 && z.length <= 33, `${z.length} Meldungen in 30 000 Samples (erwartet etwa 31)`);
  assert.ok(z.every((m) => m.werte[1] === 2), 'spielt');
});
