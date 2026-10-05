import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BERICHT_FRIST_NS, TaktStrom, type TaktZustand } from '../src/takt.ts';
import { pruefer, SCHEMA_WS } from '../src/vertrag.ts';
import { jetztNs } from '../src/zeit.ts';
import { BERICHT, warte } from './hilfen/prozess.ts';

function strom(analyse: boolean) {
  const raus: { z: TaktZustand; t: number; mono: number }[] = [];
  const s = new TaktStrom({
    berichtFristNs: BERICHT_FRIST_NS, analyseDa: () => analyse, jetzt: jetztNs,
    lage: () => ({ set_basis_bpm: 128, autonomie: 1, ki_gestoppt: false }),
    senden: (z, _zeit, mono) => raus.push({ z, t: jetztNs(), mono }),
  });
  return { s, raus };
}
const m = (takt: number) => ({ takt, phrase: Math.floor((takt - 1) / 8) + 1, sample: (takt - 1) * 90000, beat: 4 * (takt - 1), bpm: 128 });
const umschlag = (z: TaktZustand) => ({ v: 1, seq: 1, von: 'leitstand', typ: 'takt',
  zeit: { sample: 0, beat: z.beat, takt: z.takt, phrase: z.phrase }, daten: z });

test('Negativ-Kontrolle ohne Analyse: takt geht sofort, mit allen Feldern aus §14.7 und den Ereignissen seit dem letzten Takt', () => {
  const { s, raus } = strom(false);
  s.merke({ art: 'luecke', takt: 20, sample: 1, frames: 256, zyklen: 1 });
  s.aufTakt(m(21), jetztNs());
  assert.equal(raus.length, 1);
  const z = raus[0].z;
  assert.deepEqual(Object.keys(z), ['takt', 'phrase', 'beat', 'bpm', 'set_basis_bpm', 'autonomie', 'ki_gestoppt', 'decks',
    'erzeuger', 'plaene', 'vorschlaege', 'hoerscheine', 'fristen', 'bericht_vorher', 'auftraege', 'neu_in_kiste', 'ereignisse_seit']);
  assert.equal(z.bericht_vorher, null);
  assert.deepEqual(z.ereignisse_seit.map((e) => e.art), ['luecke']);
  const p = pruefer(SCHEMA_WS)(umschlag(z));
  assert.equal(p.ok, true, p.fehler);
  s.aufTakt(m(22), jetztNs());
  assert.deepEqual(raus[1].z.ereignisse_seit, []); // jedes Ereignis nur einmal
});

test('mit Analyse: Bericht nach 30 ms → takt mit bericht_vorher, kurz nach dem Bericht', async () => {
  const { s, raus } = strom(true);
  const anfang = jetztNs();
  s.aufTakt(m(10), anfang);
  await warte(30);
  assert.equal(raus.length, 0);
  s.bericht({ ...BERICHT, takt: 9, phrase: 2 });
  assert.equal(raus.length, 1);
  assert.equal(raus[0].z.bericht_vorher?.takt, 9);
  assert.ok((raus[0].t - anfang) / 1e6 < 60);
  const p = pruefer(SCHEMA_WS)(umschlag(raus[0].z));
  assert.equal(p.ok, true, p.fehler);
});

test('Fehlerfall: Bericht bleibt aus → takt 120 ms nach Taktanfang mit bericht_vorher null, unter 150 ms', async () => {
  const { s, raus } = strom(true);
  const anfang = jetztNs();
  s.aufTakt(m(10), anfang);
  await warte(200);
  assert.equal(raus.length, 1);
  assert.equal(raus[0].z.bericht_vorher, null);
  const verzug = (raus[0].t - anfang) / 1e6;
  assert.ok(verzug >= 120 && verzug < 150, `Verzug ${verzug} ms`);
  s.bericht({ ...BERICHT, takt: 9, phrase: 2 }); // zu spät: ändert nichts mehr
  assert.equal(raus.length, 1);
});

test('Negativ-Kontrolle: ein Bericht für einen anderen Takt löst nichts aus', async () => {
  const { s, raus } = strom(true);
  s.aufTakt(m(10), jetztNs());
  s.bericht({ ...BERICHT, takt: 7, phrase: 1 });
  assert.equal(raus.length, 0);
  await warte(160);
  assert.equal(raus.length, 1);
  s.stoppe();
});

test('Taktanfang liegt schon über 120 ms zurück (Kern-Meldung verspätet): takt geht sofort', () => {
  const { s, raus } = strom(true);
  s.aufTakt(m(10), jetztNs() - 130e6);
  assert.equal(raus.length, 1);
});
