// Plan 18 Befund B3 (Kern-Neustart): stirbt der Kern zwischen Quittung und Fach, kommt ein eben gestarteter Teil nach
// dem Neustart ein zweites Mal mit gestartet. Der Leitstand nimmt das hin: kein zweites teil_gestartet, kein Rückschritt,
// eine Journal-Zeile quittung_doppelt. Verlorene gelten weiter nach §16.3 (Grund neustart).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annahme, welt } from './hilfen/welt.ts';

const KI_LEISER = { grund: 'leiser', teile: [{ regler: 'deck/3/fader', art: 'rampe' as const, ab_takt: 9, dauer_takte: 2, nach: -20 }] };
const q = (status: number, id: number) => ({ id, quelle: 'cypher', status, ist_sample: 0, ist_beat: 33, grund: '' });

test('B03 doppeltes gestartet (auch als 5 verspaetet_ausgefuehrt) nach Kern-Neustart: ein teil_gestartet, Journal quittung_doppelt', () => {
  const w = welt(); const a = annahme(w, 1);
  a.einreichen(KI_LEISER);
  const id = w.gesendet.find((g) => g.adresse === '/k/teil')!.felder.id as number;
  a.quittung(q(1, id), false);
  a.quittung(q(2, id), false);
  a.abgleichBeginnen('kern_neustart');
  a.quittung(q(2, id), false);   // live nach dem Neustart
  a.quittung(q(5, id), false);   // oder verspätet ausgeführt
  a.abgleichSchliessen();
  assert.equal(w.ereignisse.filter((e) => e.art === 'teil_gestartet').length, 1);
  assert.equal(w.journal.filter((z) => z.typ === 'quittung_doppelt').length, 2);
  assert.equal(a.offeneTeile()[0]?.status, 'gestartet');
  a.quittung(q(3, id), false);
  assert.equal(w.ereignisse.filter((e) => e.art === 'teil_fertig').length, 1); // Negativ-Kontrolle: fertig kommt an
});
