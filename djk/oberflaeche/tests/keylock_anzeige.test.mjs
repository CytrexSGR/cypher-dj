// Keylock 3b (Prüfung MINOR 4 bis 6): was die Seite aus Knopf und Hörweg zeigt und schickt (reine Funktionen, ohne Browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { keylockStand, keylockAnfrage, keylockMeldung, variText } from '../oeffentlich/meldungen.js';

test('Knopf: aus /e/regler keylock 0 bzw. 1, ohne Meldung unbekannt (null), nicht stillschweigend an', () => {
  assert.equal(keylockStand({ keylock: 0 }), false);
  assert.equal(keylockStand({ keylock: 1 }), true);
  assert.equal(keylockStand({}), null);
});

test('Klick schickt pfad keylock mit dem Gegenteil, sofort; unbekannt -> an (Vorgabe)', () => {
  assert.deepEqual(keylockAnfrage(true), { pfad: 'keylock', nach: 0, ab: 'jetzt' });
  assert.deepEqual(keylockAnfrage(false), { pfad: 'keylock', nach: 1, ab: 'jetzt' });
  assert.deepEqual(keylockAnfrage(null), { pfad: 'keylock', nach: 1, ab: 'jetzt' });
});

test('VARI nur, wenn das Deck wirklich im Varispeed klingt: fremdes Tempo und nicht (Knopf an UND Hörweg Ring)', () => {
  const d = { bpm: 132, basis: 128 };
  assert.match(variText({ ...d, knopf: false, hoerweg: 0 }), /^VARI \+0\.5 st/);   // /e/regler keylock 0 -> sichtbar
  assert.equal(variText({ ...d, knopf: true, hoerweg: 1 }), null);                 // keylock 1, Ring klingt -> nicht
  assert.match(variText({ ...d, knopf: true, hoerweg: 0 }), /^VARI/);              // an, aber kein Dehner (kern.toml) oder Deck-Loop
  assert.match(variText({ ...d, knopf: null, hoerweg: 0 }), /^VARI/);
  assert.equal(variText({ bpm: 128, basis: 128, knopf: false, hoerweg: 0 }), null); // Basistempo: nichts zu zeigen
  assert.equal(variText({ bpm: null, basis: 128, knopf: false, hoerweg: 0 }), null);
});

test('Antwort auf den Klick: Ablehnung und zu spät werden gemeldet, angenommen nicht', () => {
  assert.equal(keylockMeldung(200, { quittung: { status: 1 } }), null);
  assert.equal(keylockMeldung(200, { quittung: { status: 5 } }), null);
  assert.match(keylockMeldung(200, { quittung: { status: 6, grund: 'ki_gestoppt' } }), /refused.*ki_gestoppt/);
  assert.match(keylockMeldung(200, { quittung: { status: 4, grund: 'zu_spaet' } }), /too late/);
  assert.match(keylockMeldung(400, { fehler: 'pfad' }), /refused.*pfad/);
  assert.match(keylockMeldung(200, { quittung: null }), /no answer/);
});
