// D1 S2-Integration, Fix-Runde A8 (Spec 6.28): in D1 läuft genau ein Wirt (arr1). S2 vergibt nur Slot 1; eine zweite Surge-Spur lehnt
// spur_neu/spur_aendern mit 409 slot_belegt ab („D1 has one Surge slot“). Vorher vergab S2 Slot 2, und die Spur blieb ohne Wirt stumm.
// Ein Projekt mit Slot 2 ist ungültig (modell.ts), der Kern behält die Ports für Slot 2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, BefehlFehler } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeProjekt } from '../projekt/modell.ts';
import { specProjekt } from './hilfen/projekt.mjs';
import { sitzung } from './hilfen/proj_kontext.mjs';

const SURGE = { art: 'wirt', name: 'surge' };
const grund = (p, b) => { try { fuehreAus(p, b); return null; } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return [e.grund, e.detail]; } };

test('A8 /proj/aendern: zweite Surge-Spur → 409 slot_belegt „D1 has one Surge slot“, nichts gespeichert; die erste bekommt Slot 1', async (t) => {
  const { s } = sitzung(t);
  await s.neu('W', 'andreas');
  const r = await s.aendern({ rev: 0, label: 'Lead', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: SURGE }] }, 'andreas');
  assert.deepEqual(r.j.projekt.spuren[0].geraet, { art: 'wirt', name: 'surge', slot: 1 });
  let e = null;
  try { await s.aendern({ rev: 1, label: 'Lead 2', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: SURGE }] }, 'andreas'); } catch (x) { e = x; }
  assert.equal(e?.grund, 'slot_belegt'); assert.equal(e?.detail, 'D1 has one Surge slot');
  assert.equal(s.aktuell().j.projekt.rev, 1); assert.equal(s.aktuell().j.projekt.spuren.length, 1);
});

test('A8 Befehle: zweite Surge-Spur über spur_neu, spur_neu mit slot 2 und spur_aendern auf Surge → slot_belegt; slot 3 ungültig', () => {
  let p = neuesProjekt('W');
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', geraet: SURGE }).projekt;
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument' }).projekt;                         // RB-338 intern auf s2
  assert.deepEqual(grund(p, { befehl: 'spur_neu', art: 'instrument', geraet: SURGE }), ['slot_belegt', 'D1 has one Surge slot']);
  // Fix2 F10 (Spec 6.31): Slot 2 und Slot 3 mit nachvollziehbarem Grund
  assert.deepEqual(grund(p, { befehl: 'spur_neu', art: 'instrument', geraet: { ...SURGE, slot: 2 } }), ['slot_belegt', 'D1 has one Surge slot (slot 2 has no host)']);
  assert.deepEqual(grund(p, { befehl: 'spur_aendern', spur_id: 's2', geraet: SURGE }), ['slot_belegt', 'D1 has one Surge slot']);
  assert.deepEqual(grund(p, { befehl: 'spur_aendern', spur_id: 's2', geraet: { ...SURGE, slot: 2 } }), ['slot_belegt', 'D1 has one Surge slot (slot 2 has no host)']);
  assert.deepEqual(grund(p, { befehl: 'spur_neu', art: 'instrument', geraet: { ...SURGE, slot: 3 } }),
    ['argument_ungueltig', 'geraet.slot: 1 expected (Surge slots are 1 and 2, D1 has one Surge slot)']);
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

test('A8 Projektdatei: Slot 2 ist ungültig, Slot 1 gültig', () => {
  const p = specProjekt();
  assert.ok('projekt' in pruefeProjekt(p), 'Slot 1');
  p.spuren[2].geraet.slot = 2;
  const g = pruefeProjekt(p);
  assert.ok('fehler' in g && /spuren\[2\]\.geraet\.slot/.test(g.fehler), JSON.stringify(g));
});
