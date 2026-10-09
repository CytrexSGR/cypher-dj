import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADRESSEN as VERTRAG } from '../../vertrag/osc_adressen.ts';
import { ADRESSEN, baue, liesUndDekodiere } from '../src/adressen.ts';
import { GENUTZT, NICHT_INS_JOURNAL } from '../src/ereignisse.ts';

test('die Tabelle kommt vollständig aus djk/vertrag/osc_adressen.ts (Typen ohne Komma, gleiche Felder)', () => {
  assert.equal(Object.keys(ADRESSEN).length, Object.keys(VERTRAG).length);
  assert.deepEqual(ADRESSEN['/uhr'], { typen: 'hhddd', felder: ['sample', 'mono_ns', 'beat', 'bpm', 'bpm_pro_s'] });
  assert.deepEqual(ADRESSEN['/takt'].felder, ['takt', 'phrase', 'sample', 'beat', 'bpm']);
});

test('jede Adresse, die der Leitstand liest oder schreibt, kennt der Vertrag', () => {
  assert.deepEqual(GENUTZT.filter((a) => !(a in ADRESSEN)), []);
});

test('baue und liesUndDekodiere sind zueinander invers; int64 wird number', () => {
  const felder = { sample: 1800000, mono_ns: 171571080000000, beat: 80, bpm: 128, bpm_pro_s: 0 };
  assert.deepEqual(liesUndDekodiere(baue('/uhr', felder)).felder, felder);
  const hallo = liesUndDekodiere(baue('/k/hallo', { name: 'leitstand', port: 47110, protokoll: 1 }));
  assert.deepEqual(hallo, { adresse: '/k/hallo', felder: { name: 'leitstand', port: 47110, protokoll: 1 } });
});

test('Fehlerfall: falsche Typen, unbekannte Adresse, fehlendes Feld werden abgelehnt', () => {
  const b = baue('/k/tschuess', { name: 'x' });
  b[13] = 0x69; // ",s" wird ",i"
  assert.throws(() => liesUndDekodiere(b), /Typen ,i statt ,s/);
  assert.throws(() => baue('/k/gibtsnicht', {}), /unbekannte Adresse/);
  assert.throws(() => baue('/k/hallo', { name: 'x', port: 1 }), /Feld protokoll fehlt/);
});

test('Keylock 7b.3: /zustand/box (§5.5b) wird dekodiert und bleibt aus dem Journal', () => {
  const felder = { box: 1, status: 3, keylock_unterlauf: 2, keylock_aufgegeben: 1, keylock_ring_voll: 0, keylock_kein_platz: 4 };
  assert.deepEqual(liesUndDekodiere(baue('/zustand/box', felder)), { adresse: '/zustand/box', felder });
  assert.ok(NICHT_INS_JOURNAL.has('/zustand/box'));
});
