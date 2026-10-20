// PRODUCTION V2 Nachzug (Slice 0b, Punkt 7b): OFFLINE heißt „der Server antwortet nicht“, nicht „der Server lehnt ab“.
// OFFLINE nur bei Status 0 (der Abruf selbst scheiterte) oder 5xx OHNE Grundfeld; ein 5xx mit Grund (503 katalog_fehlt, 503 kein_kern,
// 500 intern) ist eine Antwort des Servers und zeigt ihren Text. Jede erfolgreiche Antwort (auch eine Schreibantwort) nimmt OFFLINE zurück.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serverWeg, offlineNach } from '../oeffentlich/produktion/laden.js';

test('V2 OFFLINE: nur Status 0 oder 5xx ohne Grundfeld', () => {
  assert.equal(serverWeg({ status: 0, j: { fehler: 'netz', text: 'fetch failed' } }), true, 'Abruf gescheitert: auch mit Feld netz');
  assert.equal(serverWeg({ status: 503, j: null }), true, 'kein Körper');
  assert.equal(serverWeg({ status: 502, j: { text: 'bad gateway' } }), true, 'Körper ohne Grund');
  assert.equal(serverWeg({ status: 503, j: { fehler: 'katalog_fehlt', index: 0 } }), false, 'Re-Review 3: 503 katalog_fehlt bei laufendem Strom');
  assert.equal(serverWeg({ status: 503, j: { fehler: 'kein_kern' } }), false);
  assert.equal(serverWeg({ status: 500, j: { fehler: 'intern', text: 'x' } }), false);
  assert.equal(serverWeg({ status: 503, j: { grund: 'x' } }), false, 'grund zählt wie fehler');
  // Negativ-Kontrollen: 4xx und 2xx sind nie „weg“
  assert.equal(serverWeg({ status: 409, j: null }), false);
  assert.equal(serverWeg({ status: 200, j: { rev: 2 } }), false);
});

test('V2 OFFLINE: Erfolg nimmt es zurück, Ausfall setzt es, eine Ablehnung lässt es, wie es ist', () => {
  assert.equal(offlineNach({ status: 200, j: { rev: 3, projekt: {} } }), false, 'Schreibantwort');
  assert.equal(offlineNach({ status: 204, j: null }), false);
  assert.equal(offlineNach({ status: 0, j: { fehler: 'netz' } }), true);
  assert.equal(offlineNach({ status: 503, j: null }), true);
  assert.equal(offlineNach({ status: 503, j: { fehler: 'katalog_fehlt' } }), null);
  assert.equal(offlineNach({ status: 409, j: { fehler: 'rev_veraltet' } }), null);
});
