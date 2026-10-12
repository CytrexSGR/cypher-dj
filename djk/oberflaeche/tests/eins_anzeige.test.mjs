// „downbeat?“: das Ergebnis „unsicher“ des Tors eins wird in der Seite sichtbar (2026-10-11, Bericht grid-phase M4:
// nur_fuer_andreas war in 67 von 67 Fassungen true, ein gerissenes Tor erreichte Andreas nie).
import test from 'node:test';
import assert from 'node:assert/strict';
import { einsHinweis, EINS_HINWEIS_TEXT } from '../oeffentlich/meldungen.js';

test('einsHinweis: unsichere Eins → „downbeat?“, englisch', () => {
  assert.equal(einsHinweis({ eins_unsicher: true }), 'downbeat?');
  assert.match(EINS_HINWEIS_TEXT, /bar 1/i);
});

test('einsHinweis NEGATIV: sichere, unbewertete oder fehlende Fassung zeigt nichts', () => {
  assert.equal(einsHinweis({ eins_unsicher: false }), null);
  assert.equal(einsHinweis({}), null);
  assert.equal(einsHinweis(undefined), null);
  assert.equal(einsHinweis(null), null);
});
