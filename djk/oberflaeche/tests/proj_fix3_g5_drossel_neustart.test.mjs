// D1 S2-Integration, dritte Fix-Runde G5 (Spec 6.32): Die Rückweg-Drossel wird nach einem Kern-Neustart unmittelbar vor dem Senden der Regler
// geleert, also nach der Lade-Quittung. Vorher leerte nachNeustart sie vor dem Laden; ein Handwert, der während des Wartens auf die Lade-Quittung
// kam, landete im Projekt (-9), an den Kern ging aber der alte Projektwert (-3). Beleg vorher: Quality-Re-Review Q2 (anKern [-3], imProjekt -9).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
const hand = (s, pfad, wert) => s.ereignis('/e/regler', { pfad, wert, halter: 'mensch', sample: 0n, beat: 0 });

function aufbau(t) {
  const halte = new Set(); const wartend = [];
  const k = pruefKontext({ quittung: (adr) => (halte.has(adr) ? new Promise((ok) => wartend.push(() => ok({ status: 3, grund: '' }))) : { status: 3, grund: '' }) });
  const d = tmpOrdner(t, 'djk-g5-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const loese = () => { halte.clear(); for (const f of wartend.splice(0)) f(); };
  return { k, b, s: b.sitzung, halte, wartend, loese };
}

for (const handWaehrendLaden of [true, false]) {
  test(`G5/Q2 Kern-Neustart, Laden wartet auf die Quittung (Handwert dazwischen=${handWaehrendLaden}): Kern und Projekt bekommen denselben Fader`, async (t) => {
    const e = aufbau(t);
    await e.s.neu('K', 'andreas');
    await e.s.aendern({ rev: 0, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }] }, 'andreas');
    e.s.ereignis('/k/willkommen', { generation: 1 });
    e.halte.add('/k/arr/laden');
    e.k.leere();
    e.s.ereignis('/e/neustart', { generation: 2 });
    assert.ok(await warteBis(() => e.wartend.length > 0, 1000), 'Laden wartet');
    if (handWaehrendLaden) hand(e.s, 'spur/1/fader', -9);       // Hand am neuen Kern, während der Server auf die Lade-Quittung wartet
    await schlaf(20);
    e.loese();
    assert.ok(await warteBis(() => e.k.teile(/^spur\/1\/fader$/).length > 0, 2000));
    await schlaf(500);                                          // ein Drossel-Timer liefe ab
    const anKern = e.k.teile(/^spur\/1\/fader$/).map((x) => x.felder.nach);
    const imProjekt = e.s.aktuell().j.projekt.spuren[0].fader_db;
    console.log(`G5 Q2 ${JSON.stringify({ handWaehrendLaden, anKern, imProjekt })}`);
    assert.equal(anKern.at(-1), imProjekt, 'letzter an den Kern gesendeter Wert = Projektwert');
    assert.equal(imProjekt, handWaehrendLaden ? -9 : -3);
    assert.equal(anKern.length, 1, 'ein Abgleich, kein Nachschieben');
  });
}
