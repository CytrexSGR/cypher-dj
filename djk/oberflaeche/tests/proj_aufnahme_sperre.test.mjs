// 1.8 Task 26, Step 4a (Nachbesserung 1, B1): die Aufnahme hält die Lade-Sperre UND startet den Transport. Die Freeze-Sperre lehnt den Transport-Start ab (G3, sperreTransport);
// die Aufnahme-Sperre darf das nicht, sonst scheitert jeder Record-Start mit 409 beschaeftigt. Beide schließen einander aus; Öffnen, Anlegen, wiedergabewirksame
// Änderungen und POST /tempo bleiben unter beiden gesperrt.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { pruefKontext } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

function aufbau(t) {
  const k = pruefKontext();
  const d = tmpOrdner(t, 'djk-recsp-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  return { k, b, s: b.sitzung };
}
const n = (e, a) => e.k.an(a).length;
const ergebnis = async (p) => { try { const r = await p; return { code: r.code, j: r.j }; } catch (x) { return { code: x.code, fehler: x.fehler, text: x.extra?.text }; } };
const gesperrt = (f) => { try { f(); return null; } catch (x) { return [x.code, x.fehler]; } };

for (const art of [undefined, 'aufnahme']) {
  test(`B1: Transport-Start unter sperreLaden(${art ?? ''}): ${art ? 'geht, ein /k/arr/start' : '409 beschaeftigt, kein /k/arr/start (Freeze, G3)'}`, async (t) => {
    const e = aufbau(t);
    await e.s.neu('Eins', 'andreas');
    e.s.ereignis('/uhr', { beat: 2, bpm: 120 });          // Master gleich Projekttempo: keine Rampe
    e.k.leere();
    const frei = e.b.zugang.sperreLaden(art);
    const r = await ergebnis(e.s.transport({ aktion: 'start', beat: 4 }, 'andreas'));
    const m = { art, code: r.code, fehler: r.fehler, start: n(e, '/k/arr/start') };
    frei();
    assert.deepEqual(m, art === undefined ? { art, code: 409, fehler: 'beschaeftigt', start: 0 } : { art, code: 200, fehler: undefined, start: 1 });
  });
}

test('B1: Aufnahme- und Freeze-Sperre schließen einander aus; unter der Aufnahme-Sperre bleiben Öffnen, Anlegen und wiedergabewirksame Änderungen gesperrt; die Freigabe zählt einmal', async (t) => {
  const e = aufbau(t);
  await e.s.neu('Eins', 'andreas');
  const rec = e.b.zugang.sperreLaden('aufnahme');
  assert.deepEqual(gesperrt(() => e.b.zugang.sperreLaden()), [409, 'beschaeftigt'], 'ein Freeze unter der Aufnahme');
  assert.deepEqual(gesperrt(() => e.b.zugang.sperreLaden('aufnahme')), [409, 'beschaeftigt'], 'eine zweite Aufnahme');
  assert.equal(e.s.ladenGesperrt(), true, 'POST /tempo bleibt gesperrt');
  const neu = await ergebnis(e.s.neu('Zwei', 'andreas'));
  assert.deepEqual([neu.code, neu.fehler], [409, 'beschaeftigt'], 'Anlegen');
  const spur = await ergebnis(e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas'));
  assert.deepEqual([spur.code, spur.fehler], [409, 'beschaeftigt'], 'eine wiedergabewirksame Änderung');
  rec(); rec();                                           // doppelte Freigabe zählt einmal
  assert.equal(e.s.ladenGesperrt(), false);
  const fr = e.b.zugang.sperreLaden();                    // Negativ-Kontrolle: ein Freeze geht wieder, und er sperrt die Aufnahme
  assert.equal(e.s.ladenGesperrt(), true, 'die doppelte Freigabe hat nicht zweimal abgezogen');
  assert.deepEqual(gesperrt(() => e.b.zugang.sperreLaden('aufnahme')), [409, 'beschaeftigt'], 'eine Aufnahme unter dem Freeze');
  fr();
});
