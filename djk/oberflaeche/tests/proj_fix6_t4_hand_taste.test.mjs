// D1 S2-Integration, sechste Fix-Runde T4 (Spec 6.37, Andreas 16.10.: Cypher stoppt nur einen Transport, den sie selbst gestartet hat): Der
// Server führt, wer den Transport gestartet hat, auch über die Hand-Taste am Gerät (/e/hand arr/start_stopp). Ein Start oder Stopp dort gehört
// Andreas; Stop Cypher (kiStoppTransport) stoppt danach nichts. Gemessen vor dem Bau (fix6/t4_hand_taste_probe_vorher.txt): die Attrappe meldet
// /e/hand arr/start_stopp mit wert 1 beim Druck (vor /zustand/arr) und wert 0 beim Loslassen; der Kern meldet nur den Druck, wert 1
// (kern_arr.cpp:165-186, hand_ein.cpp:55-58). transportQuelle blieb cypher, Stop Cypher sendete /k/arr/stopp und stoppte Andreas' Lauf
// (REVIEW-5-opus M2, proben-5-opus/t_transport_eigentum.json T2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, arrNr } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

const arr = (nr, status) => ({ ...arrNr(nr), status });
const hand = (s, wert) => s.ereignis('/e/hand', { pfad: 'arr/start_stopp', wert, sample: 0n, beat: 0 });
async function einheit(t) {
  const z = sitzung(t, { arrFristMs: 30 });
  await z.s.neu('H', 'andreas');
  const nr = z.s.aktuell().j.projekt.wiedergabe_rev;
  await z.s.transport({ aktion: 'start' }, 'cypher');
  z.s.ereignis('/zustand/arr', arr(nr, 2));
  return { ...z, nr };
}
const stoppCypher = async (z) => { z.k.leere(); z.k.ki = true; z.s.ereignis('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0n }); await warte(60); return z.k.an('/k/arr/stopp').map((x) => x.felder.quelle); };

test('T4 Einheit: Cypher startet, Andreas stoppt und startet per Hand-Taste, Stop Cypher → kein /k/arr/stopp', async (t) => {
  const z = await einheit(t);
  hand(z.s, 1); z.s.ereignis('/zustand/arr', arr(z.nr, 0)); hand(z.s, 0);   // Druck (Stopp), Loslassen (nur Attrappe)
  hand(z.s, 1); z.s.ereignis('/zustand/arr', arr(z.nr, 2)); hand(z.s, 0);   // Druck (Start)
  const stopps = await stoppCypher(z);
  console.log(`T4 einheit ${JSON.stringify({ arr_stopp: stopps })}`);
  assert.deepEqual(stopps, [], 'Andreas\' Lauf läuft weiter');
});

test('T4 Einheit, Negativ-Kontrollen: ohne Hand-Taste und nur Loslassen (wert 0) → Stop Cypher stoppt Cyphers Lauf; nach der Taste startet Cypher neu → wieder ihrer', async (t) => {
  let z = await einheit(t);
  assert.deepEqual(await stoppCypher(z), ['andreas'], 'Cyphers eigener Lauf stoppt');
  z = await einheit(t);
  hand(z.s, 0);
  assert.deepEqual(await stoppCypher(z), ['andreas'], 'Loslassen ist keine Bedienung');
  z = await einheit(t);
  hand(z.s, 1); z.s.ereignis('/zustand/arr', arr(z.nr, 0));
  await z.s.transport({ aktion: 'start' }, 'cypher');
  z.s.ereignis('/zustand/arr', arr(z.nr, 2));
  assert.deepEqual(await stoppCypher(z), ['andreas'], 'Cyphers neuer Start gehört ihr');
});

async function aufbau(t) {
  const st = await stapel(t);
  const { o, url } = st;
  await ruf(url, 'POST', '/proj/neu', { name: 'H' });
  await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'c', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
  let status = null;
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/zustand/arr') status = Number(d.felder.status); alt(d); };
  const ctx = o.bereichKontext();
  const r = await ruf(url, 'POST', '/proj/transport', { aktion: 'start' }, CYPHER);
  assert.equal(r.code, 200);
  assert.ok(await bis(() => status === 2, 3000), 'Cyphers Transport läuft');
  return { ...st, ctx, status: () => status };
}
const taste = async (ctx) => { ctx.sende('/test/hand', { pfad: 'arr/start_stopp', midi_roh: 1, sample: 0 }); await warte(200); ctx.sende('/test/hand', { pfad: 'arr/start_stopp', midi_roh: 0, sample: 0 }); await warte(200); };

test('T4 Stapel: Cypher startet, Andreas stoppt und startet per Hand-Taste, Stop Cypher → der Transport läuft weiter', async (t) => {
  const { ctx, status } = await aufbau(t);
  await taste(ctx);
  assert.ok(await bis(() => status() === 0, 2000), 'Hand-Taste stoppt');
  await taste(ctx);
  assert.ok(await bis(() => status() === 2, 3000), 'Hand-Taste startet');
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  await warte(800);
  console.log(`T4 stapel ${JSON.stringify({ status_nach_stop_cypher: status() })}`);
  assert.equal(status(), 2, 'Andreas\' Lauf läuft weiter');
});

test('T4 Stapel, Negativ-Kontrolle: Cypher startet, Stop Cypher → der Transport stoppt', async (t) => {
  const { ctx, status } = await aufbau(t);
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  const steht = await bis(() => status() === 0, 2000);
  console.log(`T4 stapel kontrolle ${JSON.stringify({ status: status() })}`);
  assert.ok(steht, 'Cyphers Lauf stoppt');
});
