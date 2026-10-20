// D1 S2-Integration, zweite Fix-Runde F9 (Spec 6.30, 6.31): regler_fehler in synchronisiere (Öffnen), uebernimm (S3) und nachNeustart
// unterscheidet wie vollziehe: Quittung null heißt kein Kern (regler_ohne_kern), nur eine echte Ablehnung (Status 4, 6, 7, 8) ist ein Fehler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aendere } from '../projekt/verlauf.ts';
import { pruefKontext, sitzung, warteBis } from './hilfen/proj_kontext.mjs';

// Quittung je /k/teil: null (kein Kern) für spur/1/*, Ablehnung 6 für spur/2/fader, sonst angenommen
const regel = (adr, f) => (adr !== '/k/teil' ? { status: 3, grund: '' }
  : /^spur\/1\//.test(f.pfad) ? null : f.pfad === 'spur/2/fader' ? { status: 6, grund: 'nur_hand' } : { status: 3, grund: '' });
async function zweiSpuren(s) {
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
}

test('F9 Öffnen: Quittung null zählt als regler_ohne_kern, nicht als regler_fehler; die echte Ablehnung bleibt regler_fehler', async (t) => {
  const k = pruefKontext();
  const { s } = sitzung(t, {}, k);
  await s.neu('Eins', 'andreas');
  await zweiSpuren(s);
  k.regel = regel;
  const r = await s.oeffnen('eins', 'andreas');
  const kern = r.j.kern;
  console.log(`F9 oeffnen ${JSON.stringify({ fehler: kern.regler_fehler.map((x) => x.pfad), ohne_kern: kern.regler_ohne_kern })}`);
  assert.deepEqual(kern.regler_fehler.map((x) => x.pfad), ['spur/2/fader']);
  assert.equal(kern.regler_ohne_kern, 4, 'spur/1/fader, pan, mute, solo ohne Quittung');
});

test('F9 Kern-Neustart: das Protokoll führt nur die echte Ablehnung als regler_fehler', async (t) => {
  const k = pruefKontext();
  const { s } = sitzung(t, {}, k);
  await s.neu('N', 'andreas');
  await zweiSpuren(s);
  k.regel = regel;
  s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => k.protokoll.some((z) => z.typ === 'proj_neustart'), 2000));
  const z = k.protokoll.find((x) => x.typ === 'proj_neustart');
  assert.deepEqual(z.regler_fehler.map((x) => x.pfad), ['spur/2/fader']);
  assert.equal(z.regler_ohne_kern, 4);
});

test('F9 uebernimm (S3): proj_uebernimm_regler nennt nur echte Ablehnungen; ohne Kern steht kein_kern im Protokoll', async (t) => {
  const k = pruefKontext();
  const { s } = sitzung(t, {}, k);
  await s.neu('U', 'andreas');
  await zweiSpuren(s);
  k.regel = regel;
  const o = s.zugangOffen();
  const w = aendere(o.verlauf, o.projekt, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }, { befehl: 'spur_aendern', spur_id: 's2', fader_db: -4 }],
    { quelle: 'andreas', label: 'S3' }, s.zugangHaken());
  await s.uebernimm(w, { quelle: 'andreas', label: 'S3' });
  const z = k.protokoll.filter((x) => x.typ === 'proj_uebernimm_regler');
  console.log(`F9 uebernimm ${JSON.stringify(z)}`);
  assert.equal(z.length, 1);
  assert.deepEqual(z[0].abgelehnt, ['spur/2/fader']);
  assert.deepEqual(z[0].kein_kern, ['spur/1/fader']);
});

test('F9 Negativ-Kontrolle: alles angenommen → regler_fehler leer, regler_ohne_kern 0, kein proj_uebernimm_regler', async (t) => {
  const k = pruefKontext();
  const { s } = sitzung(t, {}, k);
  await s.neu('A', 'andreas');
  await zweiSpuren(s);
  const r = await s.oeffnen('a', 'andreas');
  assert.deepEqual(r.j.kern.regler_fehler, []);
  assert.equal(r.j.kern.regler_ohne_kern, 0);
  const o = s.zugangOffen();
  const w = aendere(o.verlauf, o.projekt, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }], { quelle: 'andreas', label: 'S3' }, s.zugangHaken());
  await s.uebernimm(w, { quelle: 'andreas', label: 'S3' });
  assert.equal(k.protokoll.filter((x) => x.typ === 'proj_uebernimm_regler').length, 0);
});
