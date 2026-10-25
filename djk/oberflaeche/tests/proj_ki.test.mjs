// D1 S2-Integration, Slice 6: KI-Stopp, KI-Maske, Kern-Neustart (Spec 2.12, 6.15, 6.22).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SPUREN } from '../projekt/modell.ts';
import { sitzung, warteBis } from './hilfen/proj_kontext.mjs';

test('KI-Maske beim Öffnen (Spec 6.15): auch ohne Cyphers Spuren geht die Liste hinaus (spur/0 leert die Spur-Maske)', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('Leer', 'andreas');
  assert.deepEqual(k.an('/k/ki/spur').map((x) => x.felder), [{ quelle: 'andreas', kanaele: 'spur/0' }]);
  assert.equal(s.aktuell().j.projekt.rev, 0);
});

// Entscheidung E-a (Andreas 2026-10-20): der Server stoppt nach dem KI-Stopp keinen Transport mehr, auch keinen von Cypher gestarteten (vorher Spec 2.12: /k/arr/stopp als
// andreas); der Kern lässt einen laufenden weiterlaufen und verwirft nur einen noch wartenden Start von Cypher (7 ki_stopp). Die Übergabe an Andreas und die Sperre für
// Cypher prüft proj_e_a_transport.test.mjs.
test('KI-Stopp: der Server stoppt keinen Transport (E-a), weder einen von Cypher noch einen von Andreas gestarteten', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('S', 'andreas');
  await s.transport({ aktion: 'start' }, 'cypher'); k.leere();
  s.ereignis('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0n });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(k.an('/k/arr/stopp').length, 0, 'Cyphers Transport läuft weiter (vorher stoppte der Server ihn als andreas)');
  s.ereignis('/e/ki', { gestoppt: 0, grund: 'frei', sample: 0n });
  await s.transport({ aktion: 'start' }, 'andreas'); k.leere();
  s.ereignis('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0n });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(k.an('/k/arr/stopp').length, 0, 'Negativ-Kontrolle: Andreas\' Transport ebenso');
});

test('Neustart des Kerns (Spec 2.12): letzte Wiedergabe neu laden, alle Spur-Regler (4 · MAX_SPUREN), Loop, Metronom, KI-Maske', async (t) => {
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
  assert.equal(k.teile(/^spur\//).length, 4 * MAX_SPUREN);
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
