// Paket 1.18, E-c, Seite: die reinen Teile der Varianten-Tasten (oeffentlich/produktion/varianten.js). Der DOM-Teil läuft in pruef/probe_varianten.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gruppenVon, wahlBefehl, wahlLabel, tastenLabel, buchstabe } from '../oeffentlich/produktion/varianten.js';
import { laufText } from '../oeffentlich/produktion/ausgabe.js';

const spur = (id, nr, name, gruppe, mute = false) => ({ id, nr, name, ...(gruppe === undefined ? {} : { gruppe }), mute });

test('Varianten: je Gruppe eine Reihe A, B, C in der Reihenfolge der Spuren; laut = nicht stumm; Spuren ohne Gruppe fehlen', () => {
  const p = { spuren: [spur('s1', 1, 'Bass A', 'bass'), spur('s2', 2, 'Kick'), spur('s3', 3, 'Bass B', 'bass', true), spur('s4', 4, 'Lead A', 'lead'), spur('s5', 5, 'Bass C', 'bass', true)] };
  assert.deepEqual(gruppenVon(p), [
    { gruppe: 'bass', tasten: [
      { spur_id: 's1', buchstabe: 'A', laut: true, name: 'Bass A' }, { spur_id: 's3', buchstabe: 'B', laut: false, name: 'Bass B' },
      { spur_id: 's5', buchstabe: 'C', laut: false, name: 'Bass C' }] },
    { gruppe: 'lead', tasten: [{ spur_id: 's4', buchstabe: 'A', laut: true, name: 'Lead A' }] },
  ]);
  // Negativ-Kontrolle: ohne Gruppen, ohne Projekt, leerer oder falscher Gruppentext → keine Reihe
  assert.deepEqual(gruppenVon({ spuren: [spur('s1', 1, 'A'), spur('s2', 2, 'B', '')] }), []);
  assert.deepEqual(gruppenVon(null), []);
  assert.deepEqual(gruppenVon({ spuren: [{ id: 's1', gruppe: 7, mute: false }] }), []);
});

test('Varianten: Klick sendet variante_waehlen mit Gruppe und Spur-ID; Label und zugänglicher Name englisch', () => {
  assert.deepEqual(wahlBefehl('bass', 's3'), [{ befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's3' }]);
  assert.equal(wahlLabel('bass', 'C'), 'Variant bass C');
  assert.equal(tastenLabel('bass', { buchstabe: 'B', laut: true, name: 'Bass B' }), 'Variant B of bass: Bass B (playing)');
  assert.equal(tastenLabel('bass', { buchstabe: 'A', laut: false, name: 'Bass A' }), 'Variant A of bass: Bass A');
  assert.deepEqual([0, 1, 7].map(buchstabe), ['A', 'B', 'H']);
});

test('ausgabe_lauf lautheit: die Seite zeigt "Measuring loudness", nicht "Exporting"', () => {
  assert.match(laufText({ art: 'lautheit', seit: 1000 }, null, 4000), /^Measuring loudness · 3 s$/);
  assert.match(laufText({ art: 'export' }, null, 4000), /^Exporting/);   // Negativ-Kontrolle
});
