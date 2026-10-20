// D1 S2-Integration, Fix-Runde A1 (Spec 6.30, Quality-Review R1): Öffnen eines anderen Projekts schliesst das laufende erst, wenn das neue
// geöffnet ist. Ein unbekannter, gesperrter oder kaputter Slug lässt das laufende Projekt offen (Verlauf offen, Transport läuft weiter).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sitzung } from './hilfen/proj_kontext.mjs';
import { Projekte } from '../projekt/ablage.ts';

const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
const laeuft = (nr) => ({ nr, status: 2, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0 });

// Eins ist offen und spielt; Zwei liegt daneben (über eine zweite Ablage angelegt, nie geöffnet)
async function aufbau(t) {
  const e = sitzung(t);
  await e.s.neu('Eins', 'andreas');
  e.s.ereignis('/zustand/arr', laeuft(1));
  new Projekte(e.wurzel).lege('Zwei');
  e.k.leere();
  return e;
}
// Das offene Projekt ist noch voll benutzbar: eine Änderung geht durch (der Verlauf ist nicht geschlossen)
async function bleibtOffen(s, k, wofuer) {
  assert.equal(s.aktuell().j.slug, 'eins', `${wofuer}: Eins bleibt offen`);
  assert.equal(k.an('/k/arr/stopp').length, 0, `${wofuer}: Transport nicht gestoppt`);
  const r = await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  assert.equal(r.code, 200, `${wofuer}: Eins nimmt Änderungen an`);
}

test('A1 404: Öffnen eines unbekannten Slugs lässt das laufende Projekt offen', async (t) => {
  const { s, k } = await aufbau(t);
  const e = await fehlerVon(s.oeffnen('gibt-es-nicht', 'andreas'));
  assert.deepEqual([e?.code, e?.fehler], [404, 'unbekannt']);
  await bleibtOffen(s, k, '404');
});

test('A1 projekt_busy: Öffnen eines Projekts, das ein anderer Schreiber hält, lässt das laufende offen', async (t) => {
  const { s, k, wurzel } = await aufbau(t);
  const fremd = new Projekte(wurzel).verlauf('zwei');           // ein anderer Schreiber hält Zwei
  t.after(() => fremd.schliesse());
  const e = await fehlerVon(s.oeffnen('zwei', 'andreas'));
  assert.deepEqual([e?.code, e?.fehler], [409, 'projekt_busy']);
  await bleibtOffen(s, k, 'projekt_busy');
});

test('A1 json_kaputt: Öffnen eines kaputten Projekts lässt das laufende offen', async (t) => {
  const { s, k, wurzel } = await aufbau(t);
  fs.writeFileSync(path.join(wurzel, 'zwei', 'project.json'), '{ kaputt');
  const e = await fehlerVon(s.oeffnen('zwei', 'andreas'));
  assert.deepEqual([e?.code, e?.fehler], [409, 'json_kaputt']);
  await bleibtOffen(s, k, 'json_kaputt');
});

test('A1 Negativ-Kontrolle: ein gültiges zweites Projekt öffnet, das erste ist dann geschlossen (Sperre frei, Transport gestoppt)', async (t) => {
  const { s, k, wurzel } = await aufbau(t);
  const r = await s.oeffnen('zwei', 'andreas');
  assert.equal(r.code, 200); assert.equal(s.aktuell().j.slug, 'zwei');
  assert.equal(k.an('/k/arr/stopp').length, 1, 'Transport von Eins gestoppt');
  const v = new Projekte(wurzel).verlauf('eins');               // die Sperre von Eins ist frei
  v.schliesse();
  assert.equal((await s.oeffnen('zwei', 'andreas')).code, 200, 'dasselbe Projekt noch einmal öffnen geht weiter');
  assert.equal(s.aktuell().j.slug, 'zwei');
});
