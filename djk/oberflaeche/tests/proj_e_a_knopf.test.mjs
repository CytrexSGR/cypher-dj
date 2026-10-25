// Paket 1.18, Entscheidung E-a (2026-10-20), Produktion: der Knopf Stop Cypher hält nur Cyphers Hand an. Er senkt keinen Fader einer Spur mit
// von: cypher, und die Freigabe fährt nichts zurück. Cyphers Spuren stehen in keiner KI-Maske des Kerns (nur spur/0 geht beim Öffnen und nach
// einem Kern-Neustart hinaus, damit ein Kern, der noch eine alte Maske trägt, sie verliert). Vorher (D1 Spec 6.15, 6.21, 6.35 bis 6.37) blendete der
// Kern diese Fader über 4 Beats auf −200 aus, der Server fuhr sie bei der Freigabe zurück.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SPUREN } from '../projekt/modell.ts';
import { sitzung, neustart, arrNr, warteBis } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';
import { GRUND_TEXT } from '../http/gruende.ts';

test('E-a Einheit: Cyphers Spuren stehen in keiner KI-Maske; nur Öffnen und Anlegen senden spur/0, Änderungen und Undo nichts', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('M', 'andreas');
  assert.deepEqual(k.an('/k/ki/spur').map((x) => x.felder.kanaele), ['spur/0'], 'Anlegen leert die Spur-Maske des Kerns');
  k.leere();
  await s.aendern({ rev: 0, label: 'Cypher', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'cypher');
  await s.aendern({ rev: 1, label: 'Andreas', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  await s.umkehr('undo', { rev: 2 }, 'andreas');
  assert.equal(k.an('/k/ki/spur').length, 0, 'keine Maske nach Änderung, Undo oder Cyphers neuer Spur');
  assert.equal(s.aktuell().j.projekt.spuren[0].von, 'cypher', 'die Herkunft bleibt im Projekt, sie steuert keinen Regler mehr');
  k.leere();
  await s.oeffnen('m', 'andreas');
  assert.deepEqual(k.an('/k/ki/spur').map((x) => x.felder.kanaele), ['spur/0'], 'Öffnen: wieder nur spur/0');
});

test('E-a Einheit: Öffnen im KI-Stopp setzt den Fader von Cyphers Spur auf den Projektwert, nicht auf stumm', async (t) => {
  const { z, nr } = neustart(t);                        // Projekt "wa": s1 von andreas, s2 von cypher, beide 0 dB
  z.k.ki = true;
  z.s.ereignis('/zustand/arr', arrNr(nr + 1));          // andere Nummer: das Projekt gewinnt
  await z.s.oeffnen('wa', 'andreas');
  const nach = (n) => z.k.teile(new RegExp(`^spur/${n}/fader$`)).map((x) => x.felder.nach);
  assert.deepEqual(nach(2), [0], 'Cyphers Spur: Projektwert 0 dB (vorher −200)');
  assert.deepEqual(nach(1), [0], 'Negativ-Kontrolle: Andreas\' Spur wie bisher');
});

test('E-a Einheit: Kern-Neustart im KI-Stopp setzt alle Spur-Regler (4 · MAX_SPUREN) aus dem Projekt, auch Cyphers Fader', async (t) => {
  const { z } = neustart(t);
  await z.s.oeffnen('wa', 'andreas');
  z.k.ki = true;
  z.k.leere();
  z.s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => z.k.an('/k/arr/loop').length > 0), 'nachNeustart ist durch');
  await warte(20);
  const pfade = z.k.teile(/^spur\//).map((x) => x.felder.pfad);
  assert.equal(pfade.length, 4 * MAX_SPUREN);
  assert.deepEqual(z.k.teile(/^spur\/2\/fader$/).map((x) => x.felder.nach), [0], 'Cyphers Fader wird auf den Projektwert 0 dB gesetzt, nicht auf stumm');
});

// AK-a am Stapel (Server mit Kern-Attrappe): Projekt mit einer Spur von Cypher und einer von Andreas; Stop Cypher; nach der Zeit der alten Ausblende
// (4 Beats) stehen beide Fader unverändert. Cyphers Schreiben ist 409 ki_gestoppt, Andreas schreibt weiter.
test('E-a AK-a Stapel: Stop Cypher senkt weder Cyphers noch Andreas\' Spur; Cypher 409 ki_gestoppt, Andreas schreibt', async (t) => {
  const { o, log, url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Knopf' });
  let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
  r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Andreas', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  assert.equal(r.code, 200);
  const wert = (pfad) => innen(o).stand.regler[pfad];
  assert.ok(await bis(() => wert('spur/1/fader') === 0 && wert('spur/2/fader') === 0), 'beide Fader offen vor dem Stopp');
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(o).kiGestoppt), 'der Stopp gilt');
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  await warte(Math.max(800, 5 * 60000 / bpm));          // länger als die alte Ausblende (4 Beats)
  assert.deepEqual({ cypher: wert('spur/1/fader'), andreas: wert('spur/2/fader') }, { cypher: 0, andreas: 0 }, 'nichts wurde gesenkt');
  const abgelehnt = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, CYPHER);
  assert.deepEqual([abgelehnt.code, abgelehnt.j], [409, { fehler: 'ki_gestoppt', text: GRUND_TEXT.ki_gestoppt }]);
  assert.equal((await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Andreas', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', pan: 0.25 }] })).code, 200);
  // Freigabe: nichts fährt zurück, die Fader bleiben, wo sie sind
  // Der Endstand allein trennt nicht: die alte Rückfahrt endet auf dem Projektwert 0, den die Fader ohnehin tragen. Darum zählt, was nach der
  // Freigabe an den Kern geht: außer /k/ki/frei selbst nichts (keine Rampe, kein Setzen von spur/N/fader).
  const vor = log.length;
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  assert.ok(await bis(() => !innen(o).kiGestoppt), 'die Freigabe gilt');
  await warte(Math.max(800, 5 * 60000 / bpm));
  const danach = log.slice(vor).filter((z) => z.typ === 'an_kern' && z.adresse !== '/k/ki/frei').map((z) => `${z.adresse} ${JSON.stringify(z.felder, (_, v) => (typeof v === 'bigint' ? Number(v) : v))}`);
  assert.deepEqual(danach, [], 'nach der Freigabe geht nichts an den Kern: keine Rückfahrt');
  assert.deepEqual({ cypher: wert('spur/1/fader'), andreas: wert('spur/2/fader') }, { cypher: 0, andreas: 0 }, 'die Freigabe bewegt nichts');
});
