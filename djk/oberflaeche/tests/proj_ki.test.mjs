// D1 S2-Integration, Slice 6: KI-Stopp, KI-Maske, Kern-Neustart (Spec 2.12, 6.15, 6.22).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, warteBis } from './hilfen/proj_kontext.mjs';

test('KI-Maske beim Öffnen (Spec 6.15): auch ohne Cyphers Spuren geht die Liste hinaus (spur/0 leert die Spur-Maske)', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('Leer', 'andreas');
  assert.deepEqual(k.an('/k/ki/spur').map((x) => x.felder), [{ quelle: 'andreas', kanaele: 'spur/0' }]);
  assert.equal(s.aktuell().j.projekt.rev, 0);
});

test('KI-Stopp beendet einen von Cypher gestarteten Transport (Spec 2.12); einen von Andreas nicht', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('S', 'andreas');
  await s.transport({ aktion: 'start' }, 'cypher'); k.leere();
  s.ereignis('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0n });
  assert.ok(await warteBis(() => k.an('/k/arr/stopp').length === 1));
  assert.deepEqual(k.an('/k/arr/stopp')[0].felder, { quelle: 'andreas', quant: 0 });
  s.ereignis('/e/ki', { gestoppt: 0, grund: 'frei', sample: 0n });
  await s.transport({ aktion: 'start' }, 'andreas'); k.leere();
  s.ereignis('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0n });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(k.an('/k/arr/stopp').length, 0);
});

test('KI-Maske (Spec 6.15, 6.22): Cyphers Spuren tragen sich ein, Andreas\' Spuren nicht; Löschen trägt aus; nach Wiederöffnen aus dem Feld von', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('M', 'andreas'); k.leere();
  await s.aendern({ rev: 0, label: 'Cypher', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'cypher');
  assert.deepEqual(k.an('/k/ki/spur').map((x) => x.felder.kanaele), ['spur/1']);
  await s.aendern({ rev: 1, label: 'Andreas', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  assert.equal(k.an('/k/ki/spur').length, 1, 'Liste unverändert: nichts gesendet');
  await s.oeffnen('m', 'andreas');
  assert.equal(k.an('/k/ki/spur').at(-1).felder.kanaele, 'spur/1', 'Urheber aus dem Feld von, nicht aus undo.jsonl');
  await s.aendern({ rev: 2, label: 'weg', befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' }] }, 'andreas');
  assert.equal(k.an('/k/ki/spur').at(-1).felder.kanaele, 'spur/0');
});

test('KI-Maske (P3b): jedes Undo und Redo sendet die Liste neu; eine Änderung ohne neue Spur sendet nichts', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('U', 'andreas');
  await s.aendern({ rev: 0, label: 'Cypher', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'cypher'); k.leere();
  await s.umkehr('undo', { rev: 1 }, 'andreas');
  assert.deepEqual(k.an('/k/ki/spur').map((x) => x.felder.kanaele), ['spur/0'], 'Undo trägt die Spur aus');
  await s.umkehr('redo', { rev: 2 }, 'andreas');
  assert.deepEqual(k.an('/k/ki/spur').map((x) => x.felder.kanaele), ['spur/0', 'spur/1'], 'Redo trägt sie wieder ein');
  await s.aendern({ rev: 3, label: 'Mixer', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', pan: 0.5 }] }, 'andreas');
  assert.equal(k.an('/k/ki/spur').length, 2, 'unverändert: nichts gesendet');
});

test('KI-Maske (P3b): eine abgelehnte Maske wird bei der nächsten Änderung erneut versucht', async (t) => {
  let ablehnen = false;
  const { s, k } = sitzung(t, {}, undefined);
  k.regel = (adresse) => (adresse === '/k/ki/spur' && ablehnen ? { status: 6, grund: 'abgelehnt' } : { status: 3, grund: '' });
  await s.neu('R', 'andreas');
  ablehnen = true;
  await s.aendern({ rev: 0, label: 'Cypher', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'cypher');
  ablehnen = false; k.leere();
  await s.aendern({ rev: 1, label: 'Mixer', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', pan: 0.5 }] }, 'andreas');
  assert.deepEqual(k.an('/k/ki/spur').map((x) => x.felder.kanaele), ['spur/1']);
});

test('Neustart des Kerns (Spec 2.12): letzte Wiedergabe neu laden, 32 Spur-Regler, Loop, Metronom, KI-Maske', async (t) => {
  const { s, k } = sitzung(t);
  s.ereignis('/k/willkommen', { generation: 1 });
  await s.neu('N', 'andreas');
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }] }, 'andreas');
  const nr = s.aktuell().j.projekt.wiedergabe_rev; k.leere();
  s.ereignis('/e/neustart', { generation: 1, sample: 0n });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(k.gesendet.length, 0, 'gleiche Generation: nichts');
  s.ereignis('/e/neustart', { generation: 2, sample: 0n });
  assert.ok(await warteBis(() => k.an('/k/ki/spur').length === 1));
  assert.deepEqual(k.an('/k/arr/laden').map((x) => x.felder.nr), [nr]);
  assert.equal(k.teile(/^spur\//).length, 32);
  assert.deepEqual(k.an('/k/arr/loop')[0].felder, { quelle: 'andreas', an: 1, von_beat: 0, bis_beat: 16 });
  assert.equal(k.an('/k/arr/metronom').length, 1);
});

test('Neustart ohne offenes Projekt tut nichts', async (t) => {
  const { s, k } = sitzung(t);
  s.ereignis('/k/willkommen', { generation: 1 });
  s.ereignis('/e/neustart', { generation: 2, sample: 0n });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(k.gesendet.length, 0);
});
