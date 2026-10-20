// D1 S2-Integration, Fix-Runde B4 (Spec 6.30 Leistung, Quality-Befund 4): Mixer-Bewegungen über den Rückweg (/e/regler, Halter mensch) werden
// zusammengefasst: höchstens eine Speicherung je 250 ms, letzte Werte gewinnen, ein Verlaufseintrag je Geste, 500 ms Ruhe schließt die Geste.
// Vorher speicherte jedes Hand-Ereignis das ganze Projekt (bei 60.000 Noten je Ereignis einmal project.json mit fsync).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Projekte } from '../projekt/ablage.ts';
import { sitzung, warteBis } from './hilfen/proj_kontext.mjs';

const schlaf = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hand = (s, pfad, wert) => s.ereignis('/e/regler', { pfad, wert, halter: 'mensch', sample: 0n, beat: 0 });

async function aufbau(t) {
  const { s, k } = sitzung(t);
  await s.neu('R', 'andreas');
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const saves = [];
  const orig = Projekte.prototype.speichere;
  Projekte.prototype.speichere = function (...a) { saves.push(Date.now()); return orig.apply(this, a); };
  t.after(() => { Projekte.prototype.speichere = orig; });
  k.leere();
  return { s, k, saves };
}
const mixerEintraege = (s) => s.verlaufListe().j.filter((e) => e.label.startsWith('Mixer'));

test('B4 Rückweg: 26 Fader-Ereignisse über 500 ms → höchstens eine Speicherung je 250 ms, der letzte Wert gewinnt, ein Verlaufseintrag', async (t) => {
  const { s, k, saves } = await aufbau(t);
  for (let i = 0; i <= 25; i++) { hand(s, 'spur/1/fader', -1 - i); await schlaf(20); }
  assert.ok(await warteBis(() => s.aktuell().j.projekt.spuren[0].fader_db === -26, 2000), `fader ${s.aktuell().j.projekt.spuren[0].fader_db}`);
  await schlaf(300);
  const abstaende = saves.slice(1).map((x, i) => x - saves[i]);
  assert.ok(saves.length >= 2 && saves.length <= 4, `Speicherungen ${saves.length} (vorher je Ereignis eine)`);
  assert.ok(abstaende.every((d) => d >= 240), `Abstände ${abstaende}`);
  assert.deepEqual(mixerEintraege(s).map((e) => [e.label, e.quelle]), [['Mixer: Audio 1 fader', 'andreas']], 'ein Eintrag je Geste');
  assert.equal(k.gesendet.length, 0, 'der Rückweg sendet nichts an den Kern');
  const u = await s.umkehr('undo', { rev: s.aktuell().j.projekt.rev }, 'andreas');
  assert.equal(u.j.projekt.spuren[0].fader_db, 0, 'Undo nimmt die ganze Geste zurück');
});

test('B4 Rückweg: 500 ms Ruhe schließt die Geste (zweiter Eintrag); Fader und Mute in einer Geste sind ein Eintrag, Undo nimmt beide zurück', async (t) => {
  const { s } = await aufbau(t);
  hand(s, 'spur/1/fader', -3);
  assert.ok(await warteBis(() => s.aktuell().j.projekt.spuren[0].fader_db === -3, 1000));
  await schlaf(600);                                                             // Ruhe: die Geste ist zu
  hand(s, 'spur/1/fader', -6); await schlaf(40); hand(s, 'spur/1/mute', 1); await schlaf(40); hand(s, 'spur/1/fader', -9);
  assert.ok(await warteBis(() => s.aktuell().j.projekt.spuren[0].fader_db === -9 && s.aktuell().j.projekt.spuren[0].mute === true, 1500));
  await schlaf(300);
  assert.deepEqual(mixerEintraege(s).map((e) => e.label), ['Mixer: Audio 1 fader', 'Mixer: Audio 1 fader, Audio 1 mute']);
  const u = await s.umkehr('undo', { rev: s.aktuell().j.projekt.rev }, 'andreas');
  assert.deepEqual([u.j.projekt.spuren[0].fader_db, u.j.projekt.spuren[0].mute], [-3, false], 'zurück auf den Stand vor der zweiten Geste');
});

test('B4 Rückweg Negativ-Kontrolle: ein einzelnes Hand-Ereignis wird sofort gespeichert (kein Warten ohne vorherige Speicherung), Halter frei gar nicht', async (t) => {
  const { s, saves } = await aufbau(t);
  s.ereignis('/e/regler', { pfad: 'spur/1/pan', wert: 0.5, halter: 'frei', sample: 0n, beat: 0 });
  const t0 = Date.now();
  hand(s, 'spur/1/fader', -4);
  assert.ok(await warteBis(() => s.aktuell().j.projekt.spuren[0].fader_db === -4, 1000));
  assert.ok(Date.now() - t0 < 200, `${Date.now() - t0} ms`);
  assert.equal(s.aktuell().j.projekt.spuren[0].pan, 0);
  assert.equal(saves.length, 1);
});

test('B4 Rückweg: ein noch nicht gespeicherter letzter Wert geht beim Schliessen des Projekts nicht verloren', async (t) => {
  const { s, saves } = await aufbau(t);
  hand(s, 'spur/1/fader', -2);
  assert.ok(await warteBis(() => saves.length === 1, 1000));
  hand(s, 'spur/1/fader', -11);                                                 // innerhalb der 250 ms: wartet
  const slug = s.aktuell().j.slug;
  await s.neu('Anderes', 'andreas');
  const r = await s.oeffnen(slug, 'andreas');
  assert.equal(r.j.projekt.spuren[0].fader_db, -11);
});
