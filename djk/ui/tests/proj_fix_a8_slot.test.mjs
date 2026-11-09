// D1 S2-Integration, Fix-Runde A8 (Spec 6.28), extended by 1.9 U3 (T3.1): two Surge host slots (arr1, arr2). spur_neu/spur_aendern assign the first free
// slot (1, then 2); a third Surge track is 409 slot_belegt with a text naming both slots; slot 3 is invalid. A project file with two
// tracks on the same slot is invalid (model.ts), as is slot 3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { specProjekt } from './support/project.mjs';
import { sitzung } from './support/proj_context.mjs';

const SURGE = { art: 'wirt', name: 'surge' };
const grund = (p, b) => { try { fuehreAus(p, b); return null; } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return [e.grund, e.detail]; } };

test('A8 /proj/aendern: two Surge tracks get slots 1 and 2 (AK-W3), the third is 409 slot_belegt naming both slots, nothing stored', async (t) => {
  const { s } = sitzung(t);
  await s.neu('W', 'andreas');
  const r = await s.aendern({ rev: 0, label: 'Lead', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: SURGE }] }, 'andreas');
  assert.deepEqual(r.j.projekt.spuren[0].geraet, { art: 'wirt', name: 'surge', slot: 1 });
  const r2 = await s.aendern({ rev: 1, label: 'Lead 2', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: SURGE }] }, 'andreas');
  assert.deepEqual(r2.j.projekt.spuren[1].geraet, { art: 'wirt', name: 'surge', slot: 2 });
  let e = null;
  try { await s.aendern({ rev: 2, label: 'Lead 3', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: SURGE }] }, 'andreas'); } catch (x) { e = x; }
  assert.equal(e?.grund, 'slot_belegt'); assert.equal(e?.detail, 'both Surge slots are in use (1, 2)');
  assert.equal(s.aktuell().j.projekt.rev, 2); assert.equal(s.aktuell().j.projekt.spuren.length, 2);
});

test('A8 Befehle: a third Surge track via spur_neu (with and without slot) and spur_aendern on Surge is slot_belegt; slot 3 is invalid', () => {
  let p = neuesProjekt('W');
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', geraet: SURGE }).projekt;
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', geraet: SURGE }).projekt;
  assert.deepEqual(p.spuren.map((x) => x.geraet.slot), [1, 2], 'AK-W3: first free slot each time');
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument' }).projekt;                         // RB-338 intern on s3
  const BELEGT = ['slot_belegt', 'both Surge slots are in use (1, 2)'];
  assert.deepEqual(grund(p, { befehl: 'spur_neu', art: 'instrument', geraet: SURGE }), BELEGT);
  assert.deepEqual(grund(p, { befehl: 'spur_neu', art: 'instrument', geraet: { ...SURGE, slot: 1 } }), BELEGT);
  assert.deepEqual(grund(p, { befehl: 'spur_neu', art: 'instrument', geraet: { ...SURGE, slot: 2 } }), BELEGT);
  assert.deepEqual(grund(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: SURGE }), BELEGT);
  assert.deepEqual(grund(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { ...SURGE, slot: 2 } }), BELEGT);
  assert.deepEqual(grund(p, { befehl: 'spur_neu', art: 'instrument', geraet: { ...SURGE, slot: 3 } }),
    ['argument_ungueltig', 'geraet.slot: 1 or 2 expected']);
});

test('A8 an explicit slot 2 is taken when free, and the freed slot is reused', () => {
  let p = neuesProjekt('W');
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', geraet: { ...SURGE, slot: 2 } }).projekt;
  assert.equal(p.spuren[0].geraet.slot, 2);
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', geraet: SURGE }).projekt;
  assert.equal(p.spuren[1].geraet.slot, 1, 'the free one');
  p = fuehreAus(p, { befehl: 'spur_loeschen', spur_id: 's1' }).projekt;
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', geraet: SURGE }).projekt;
  assert.deepEqual(p.spuren.map((x) => x.geraet.slot).sort(), [1, 2]);
});

test('A8 Negativ-Kontrolle: die Surge-Spur behält ihren Slot 1 bei spur_aendern; nach dem Löschen bekommt eine neue Surge-Spur Slot 1', () => {
  let p = neuesProjekt('W');
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', geraet: SURGE }).projekt;
  assert.equal(grund(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: SURGE }), null, 'eigener Slot: kein Selbstkonflikt');
  assert.equal(grund(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: { ...SURGE, slot: 1 } }), null);
  p = fuehreAus(p, { befehl: 'spur_loeschen', spur_id: 's1' }).projekt;
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', geraet: SURGE }).projekt;
  assert.equal(p.spuren[0].geraet.slot, 1);
});

test('A8 Projektdatei: slots 1 and 2 valid, slot 3 and a doubled slot invalid', () => {
  const p = specProjekt();
  assert.ok('projekt' in pruefeProjekt(p), 'slot 1');
  p.spuren[2].geraet.slot = 2;
  assert.ok('projekt' in pruefeProjekt(p), 'slot 2');
  p.spuren[2].geraet.slot = 3;
  const g3 = pruefeProjekt(p);
  assert.ok('fehler' in g3 && /spuren\[2\]\.geraet\.slot/.test(g3.fehler), JSON.stringify(g3));
  const q = specProjekt();
  q.spuren.push({ ...structuredClone(q.spuren[2]), id: 's9', nr: 9, name: 'Surge two' });                       // second track on slot 1
  const gd = pruefeProjekt(q);
  assert.ok('fehler' in gd && /spuren\[\d+\]\.geraet\.slot.*doppelt/.test(gd.fehler), JSON.stringify(gd));
  q.spuren[q.spuren.length - 1].geraet.slot = 2;
  assert.ok('projekt' in pruefeProjekt(q), 'two Surge tracks on slots 1 and 2 are a valid project');
});
