// Paket 1.18, E-c, AK-c am Stapel (Server mit Kern-Attrappe): Cypher legt drei Basslines als Gruppe bass an, variante_waehlen B schaltet die
// Spur-Regler im Kern (mute), die Spur außerhalb der Gruppe bleibt, ein Undo stellt den Stand davor her.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER } from './hilfen/proj_stapel.mjs';

test('AK-c Stapel: variante_waehlen B macht genau B laut (A und C stumm), Kick bleibt; Undo stellt den Stand davor her', async (t) => {
  const { o, url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Varianten' });
  const aufbau = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Basslines', befehle: [
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass A', gruppe: 'bass' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass B', gruppe: 'bass' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass C', gruppe: 'bass' },
    { befehl: 'spur_neu', art: 'audio', name: 'Kick' },
    { befehl: 'spur_aendern', spur_id: 's2', mute: true }, { befehl: 'spur_aendern', spur_id: 's3', mute: true }] }, CYPHER);
  assert.equal(aufbau.code, 200);
  const regler = () => innen(o).stand.regler;
  const mutes = () => [1, 2, 3, 4].map((n) => regler()[`spur/${n}/mute`]);
  assert.ok(await bis(() => mutes().join() === '0,1,1,0'), `Kern nach dem Aufbau: ${mutes()}`);
  const wahl = await ruf(url, 'POST', '/proj/aendern', { rev: aufbau.j.rev, label: 'Variant bass B', befehle: [{ befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's2' }] }, CYPHER);
  assert.equal(wahl.code, 200);
  assert.ok(await bis(() => mutes().join() === '1,0,1,0'), `Kern nach B: ${mutes()}`);
  assert.deepEqual(wahl.j.projekt.spuren.map((s) => s.mute), [true, false, true, false]);
  const verlauf = (await ruf(url, 'GET', '/proj/verlauf')).j;
  assert.equal(verlauf.at(-1).label, 'Variant bass B', 'ein Eintrag für die ganze Wahl');
  // Undo: ein Schritt, der Stand davor
  const undo = await ruf(url, 'POST', '/proj/undo', { rev: wahl.j.rev });
  assert.equal(undo.code, 200);
  assert.ok(await bis(() => mutes().join() === '0,1,1,0'), `Kern nach Undo: ${mutes()}`);
  // Fehlerfall: Kick gehört nicht zur Gruppe
  const falsch = await ruf(url, 'POST', '/proj/aendern', { rev: undo.j.rev, label: 'x', befehle: [{ befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's4' }] }, CYPHER);
  assert.equal(falsch.code, 400);
  assert.equal(falsch.j.fehler, 'argument_ungueltig');
});
