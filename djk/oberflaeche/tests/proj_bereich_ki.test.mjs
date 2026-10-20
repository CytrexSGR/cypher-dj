// Bereich proj am Stapel, D1 S2-Integration Slice 6: KI-Stopp der Attrappe sperrt Cypher und lässt Cyphers laufenden Transport laufen (E-a, vorher stoppte er ihn); Kern-Neustart lädt
// die letzte Wiedergabe und setzt die Spur-Regler (Spec 2.12, 6.15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, anKern, CYPHER, warte } from './hilfen/proj_stapel.mjs';
import { GRUND_TEXT } from '../http/gruende.ts';   // Spec 6.34: jede Antwort mit Grund trägt einen englischen text

test('KI-Stopp mit der Kern-Attrappe (E-a): die Änderung sendet keine KI-Maske, Cyphers laufender Transport läuft weiter, Cyphers Schreiben 409, Andreas schreibt weiter', async (t) => {
  const { o, url, log } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Stopp' });
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine Spur', befehle: [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'tempo_setzen', bpm }] }, CYPHER);
  assert.equal(a.j.kern.ki, undefined, 'E-a: eine Änderung sendet keine KI-Maske');
  assert.equal((await ruf(url, 'POST', '/proj/transport', { aktion: 'start' }, CYPHER)).j.ok, true);
  const ctx = o.bereichKontext();   // echter KI-Stopp in der Attrappe (ein nur eingespeistes /e/ki überschriebe das periodische /zustand/kern)
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(o).kiGestoppt));
  await warte(800);
  assert.deepEqual(anKern(log, '/k/arr/stopp'), [], 'E-a: der Server stoppt Cyphers Transport nicht (vorher /k/arr/stopp als andreas)');
  assert.equal((await ruf(url, 'GET', '/proj/aktuell')).j.kern.status, 2, 'und der Kern spielt weiter (status 2)');
  assert.deepEqual((await ruf(url, 'POST', '/proj/aendern', { rev: 1, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, CYPHER)).j, { fehler: 'ki_gestoppt', text: GRUND_TEXT.ki_gestoppt });
  assert.equal((await ruf(url, 'POST', '/proj/aendern', { rev: 1, label: 'Andreas', befehle: [{ befehl: 'spur_neu', art: 'audio' }] })).code, 200);
});

test('Kern-Neustart (Spec 2.12): nach /e/neustart mit neuer Generation lädt der Server die letzte Wiedergabe und setzt die Spur-Regler', async (t) => {
  const { o, url, log } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Neu' });
  const nr = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.wiedergabe_rev;
  const vor = log.length;
  innen(o).vomKern('/e/neustart', { generation: 999, sample: 0 });
  assert.ok(await bis(() => anKern(log.slice(vor), '/k/ki/spur').length === 1, 5000));
  assert.deepEqual(anKern(log.slice(vor), '/k/arr/laden').map((z) => z.felder.nr), [nr]);
  assert.equal(anKern(log.slice(vor), '/k/teil').filter((z) => /^spur\//.test(z.felder.pfad)).length, 32);
});
