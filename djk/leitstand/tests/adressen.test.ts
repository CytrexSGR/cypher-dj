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

test('I08: /zustand/ein (§5.14, 20 Hz im Takt der Pegel, ohne Änderungs-Auslöser) bleibt aus dem Journal', () => {
  // M, 2026-10-25: Betriebs-Journal 2,26 GB in 5,6 Tagen, 60 % der Zeilen waren dieser Tick
  assert.ok(NICHT_INS_JOURNAL.has('/zustand/ein'));
});

test('A6: /zustand/mix (10 Hz x channels) and /zustand/spektrum (25 Hz) are in the table and stay out of the journal; /e/regler and /zustand/arr are not touched', () => {
  assert.deepEqual(ADRESSEN['/zustand/mix'], { typen: 'sfffff', felder: ['kanal', 'gate_db', 'mb_tief_db', 'mb_mitte_db', 'mb_hoch_db', 'lim_db'] });
  assert.deepEqual(ADRESSEN['/zustand/spektrum'], { typen: 'sis', felder: ['kanal', 'rahmen', 'pegel'] });
  assert.ok(NICHT_INS_JOURNAL.has('/zustand/mix'));
  assert.ok(NICHT_INS_JOURNAL.has('/zustand/spektrum'));
  // negative controls: this task adds exactly these two (a regler event is a journal fact, /zustand/arr is another task's decision)
  assert.equal(NICHT_INS_JOURNAL.has('/e/regler'), false);
  assert.equal(NICHT_INS_JOURNAL.has('/zustand/arr'), false);
  assert.ok(GENUTZT.includes('/zustand/mix') && GENUTZT.includes('/zustand/spektrum'));
});

test('4a: /e/ins_gr (up to 12 stages x 20 Hz) is in the table and stays out of the journal; a decision event next to it does not', () => {
  assert.deepEqual(ADRESSEN['/e/ins_gr'], { typen: 'sf', felder: ['kanal', 'gr_db'] });
  assert.ok(NICHT_INS_JOURNAL.has('/e/ins_gr'));
  assert.equal(NICHT_INS_JOURNAL.has('/e/luecke'), false);   // negative control: a journal fact is not excluded
  assert.ok(GENUTZT.includes('/e/ins_gr'));
});
