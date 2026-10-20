// D1 S2-Integration, zweite Fix-Runde F8 (Spec 6.31): Rückweg-Werte, die noch in der Drossel warten, werden vor dem Abgleich nach einem
// Kern-Neustart und nach dem letzten await beim Schliessen weggeschrieben. Belege: Quality-Probe p6 K (an den neuen Kern -3, im Projekt -15)
// und p1 R5 (Handwert während des Stopps beim Projektwechsel: weder im alten Projekt noch im Protokoll).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { Projekte } from '../projekt/ablage.ts';
import { pruefKontext, sitzung, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
const hand = (s, pfad, wert) => s.ereignis('/e/regler', { pfad, wert, halter: 'mensch', sample: 0n, beat: 0 });
const laeuft = (nr) => ({ nr, status: 2, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0 });

test('F8 Kern-Neustart, während ein Handwert in der Drossel wartet (Quality K): der neue Kern bekommt den Wert, den das Projekt speichert', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('K', 'andreas');
  await s.aendern({ rev: 0, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  s.ereignis('/k/willkommen', { generation: 1 });
  hand(s, 'spur/1/fader', -3);                                      // sofort gespeichert
  assert.ok(await warteBis(() => s.aktuell().j.projekt.spuren[0].fader_db === -3, 1000));
  hand(s, 'spur/1/fader', -15);                                     // gedrosselt: wartet bis zu 250 ms
  k.leere();
  s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => k.teile(/^spur\/1\/fader$/).length > 0, 1000));
  const anKern = k.teile(/^spur\/1\/fader$/).map((x) => x.felder.nach);
  const imProjekt = s.aktuell().j.projekt.spuren[0].fader_db;
  console.log(`F8 K ${JSON.stringify({ anKern, imProjekt })}`);
  assert.deepEqual(anKern, [-15], 'der neue Kern bekommt den letzten Handwert');
  assert.equal(imProjekt, -15);
  await schlaf(400);
  assert.equal(s.aktuell().j.projekt.spuren[0].fader_db, -15, 'der Timer der Drossel schreibt danach nichts anderes');
});

test('F8 Handwert während des Stopps beim Projektwechsel (Quality R5): er landet im alten Projekt', async (t) => {
  const halte = new Set(); const wartend = [];
  const k = pruefKontext({ quittung: (adr) => (halte.has(adr) ? new Promise((ok) => wartend.push(() => ok({ status: 3, grund: '' }))) : { status: 3, grund: '' }) });
  const d = tmpOrdner(t, 'djk-f8-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  const s = b.sitzung;
  t.after(() => s.schliesse());
  await s.neu('Eins', 'andreas');
  await s.aendern({ rev: 0, label: 'A', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  new Projekte(path.join(d, 'projekte')).lege('Zwei');
  s.ereignis('/zustand/arr', laeuft(s.aktuell().j.projekt.wiedergabe_rev));
  halte.add('/k/arr/stopp');
  const p = s.oeffnen('zwei', 'andreas');
  for (let i = 0; i < 200 && wartend.length === 0; i++) await schlaf(5);
  assert.ok(wartend.length > 0, 'der Stopp wartet');
  hand(s, 'spur/1/fader', -12);                                     // Andreas' Hand, während der Server auf die Stopp-Quittung wartet
  halte.clear(); for (const f of wartend.splice(0)) f();
  assert.equal((await p).code, 200);
  await schlaf(400);
  const eins = JSON.parse(fs.readFileSync(path.join(d, 'projekte', 'eins', 'project.json'), 'utf8'));
  const verlauf = fs.readFileSync(path.join(d, 'projekte', 'eins', 'undo.jsonl'), 'utf8').trim().split('\n').map((z) => JSON.parse(z).label);
  console.log(`F8 R5 ${JSON.stringify({ fader: eins.spuren[0].fader_db, rev: eins.rev, verlauf, offen: s.aktuell().j.slug })}`);
  assert.equal(eins.spuren[0].fader_db, -12, 'Handwert im alten Projekt');
  assert.equal(s.aktuell().j.slug, 'zwei');
  assert.equal(s.aktuell().j.projekt.spuren.length, 0, 'nichts im neuen Projekt');
});

test('F8 Negativ-Kontrolle: ohne wartenden Handwert sendet der Neustart den gespeicherten Fader und speichert nichts dazu', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('N', 'andreas');
  await s.aendern({ rev: 0, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -7 }] }, 'andreas');
  const rev = s.aktuell().j.projekt.rev;
  k.leere();
  s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => k.teile(/^spur\/1\/fader$/).length > 0, 1000));
  await schlaf(100);
  assert.deepEqual(k.teile(/^spur\/1\/fader$/).map((x) => x.felder.nach), [-7]);
  assert.equal(s.aktuell().j.projekt.rev, rev, 'keine neue rev');
});
