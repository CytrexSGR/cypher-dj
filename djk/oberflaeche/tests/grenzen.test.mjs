// E3 Task 10: die Seite kennt die Spurgrenze statisch (oeffentlich/produktion/grenzen.js), weil das Projekt-Schema geschlossen ist und drei Tests
// die Antwortform exakt prüfen. Diese Datei hält beide Zahlen und alle Texte daran fest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SPUREN as SEITE, MAX_GRUPPEN as SEITE_GRUPPEN } from '../oeffentlich/produktion/grenzen.js';
import { MAX_SPUREN as SERVER, MAX_GRUPPEN as SERVER_GRUPPEN } from '../projekt/modell.ts';
import { FEHLER_TEXT } from '../oeffentlich/produktion/produktion.js';
import { GRUND_TEXT } from '../http/gruende.ts';

test('Seite und Server haben dieselbe Spurgrenze', () => {
  assert.equal(SEITE, SERVER);
  assert.equal(SERVER, 32, 'S3b: MAX_SPUREN = 32');
});

test('1.10 Seite und Server haben dieselbe Gruppengrenze', () => {
  assert.equal(SEITE_GRUPPEN, SERVER_GRUPPEN);
  assert.equal(SERVER_GRUPPEN, 8, '1.10: MAX_GRUPPEN = 8 (F1: eigene Plätze neben den 32 Spuren)');
});

test('Fehlertexte nennen die Grenze aus der Konstanten, nicht eine feste Zahl', () => {
  assert.equal(FEHLER_TEXT.spur_bereich, `At most ${SEITE} tracks`);
  assert.equal(GRUND_TEXT.spur_bereich, `at most ${SEITE} tracks`);
});

test('Seite: die Neu-Knöpfe sperren erst bei MAX_SPUREN Spuren (nicht bei 8)', async () => {
  const { element } = await import('./hilfen/dom_attrappe.mjs');
  const { bindeSpuren } = await import('../oeffentlich/produktion/spurkoepfe.js');
  globalThis.document = { createElement: (t) => Object.assign(element(t), { style: { setProperty() {} }, value: '', querySelector: () => Object.assign(element(), { style: { setProperty() {} }, value: '' }), querySelectorAll: () => [] }) };   // kein HTML-Parser: jede Auswahl findet ein leeres Element
  try {
    const els = { koepfe: Object.assign(element(), { children: [], insertBefore(el) { this.children.push(el); } }) }; const $ = (k) => (els[k] ??= element());
    const beim = [];
    bindeSpuren({ $, aendere() {}, aendereAus() {}, beimProjekt: beim });
    const spur = (i) => ({ id: `s${i}`, nr: i, name: 'x', farbe: '#000000', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
    const mit = (n) => ({ spuren: Array.from({ length: n }, (_, i) => spur(i + 1)) });
    for (const [n, gesperrt] of [[8, false], [9, false], [SEITE - 1, false], [SEITE, true]]) {
      for (const f of beim) f(mit(n));
      assert.equal(els['neu-audio'].disabled, gesperrt, `${n} Spuren: + AUDIO ${gesperrt ? 'gesperrt' : 'frei'}`);
      assert.equal(els['neu-rb'].disabled, gesperrt, `${n} Spuren: + RB-338`);
      assert.equal(els['neu-surge'].disabled, gesperrt, `${n} Spuren: + Surge (ohne Wirt-Spur)`);
    }
  } finally { delete globalThis.document; }
});
