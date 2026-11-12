// E3 Task 10: die Seite kennt die Spurgrenze statisch (public/production/limits.js), weil das Projekt-Schema geschlossen ist und drei Tests
// die Antwortform exakt prüfen. Diese Datei hält beide Zahlen und alle Texte daran fest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SPUREN as SEITE, MAX_GRUPPEN as SEITE_GRUPPEN } from '../public/production/limits.js';
import { MAX_SPUREN as SERVER, MAX_GRUPPEN as SERVER_GRUPPEN } from '../project/model.ts';
import { FEHLER_TEXT } from '../public/production/production.js';
import { GRUND_TEXT } from '../http/reasons.ts';

test('Seite und Server haben dieselbe Spurgrenze', () => {
  assert.equal(SEITE, SERVER);
  assert.equal(SERVER, 32, 'S3b: MAX_SPUREN = 32');
});

test('1.10 Seite und Server haben dieselbe Gruppengrenze', () => {
  assert.equal(SEITE_GRUPPEN, SERVER_GRUPPEN);
  assert.equal(SERVER_GRUPPEN, 16, 'nested groups task 1: MAX_GRUPPEN = 16 (was 8 in 1.10, F1: eigene Plätze neben den 32 Spuren)');
});

test('Fehlertexte nennen die Grenze aus der Konstanten, nicht eine feste Zahl', () => {
  assert.equal(FEHLER_TEXT.spur_bereich, `At most ${SEITE} tracks`);
  assert.equal(GRUND_TEXT.spur_bereich, `at most ${SEITE} tracks`);
});

test('Seite: die Neu-Knöpfe sperren erst bei MAX_SPUREN Spuren (nicht bei 8)', async () => {
  const { element } = await import('./support/dom_mock.mjs');
  const { bindeSpuren } = await import('../public/production/track_heads.js');
  globalThis.document = { createElement: (t) => Object.assign(element(t), { style: { setProperty() {} }, value: '', querySelector: () => Object.assign(element(), { style: { setProperty() {} }, value: '' }), querySelectorAll: () => [] }) };   // kein HTML-Parser: jede Auswahl findet ein leeres Element
  try {
    const els = { koepfe: Object.assign(element(), { children: [], insertBefore(el) { this.children.push(el); } }) }; const $ = (k) => (els[k] ??= element());
    const beim = [];
    // st and beimEreignis as the page gives them (production.js:254, :277): since 1.12 S3 task 9 the binder writes st.autoArm
    // and hooks into beimEreignis (auto_recording.js)
    bindeSpuren({ st: {}, $, aendere() {}, aendereAus() {}, beimProjekt: beim, beimBild: [], beimEreignis: [] });
    const spur = (i) => ({ id: `s${i}`, nr: i, name: 'x', farbe: '#000000', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
    const mit = (n) => ({ spuren: Array.from({ length: n }, (_, i) => spur(i + 1)) });
    for (const [n, gesperrt] of [[8, false], [9, false], [SEITE - 1, false], [SEITE, true]]) {
      for (const f of beim) f(mit(n));
      assert.equal(els['neu-audio'].disabled, gesperrt, `${n} Spuren: + AUDIO ${gesperrt ? 'gesperrt' : 'frei'}`);
      assert.equal(els['neu-rb'].disabled, gesperrt, `${n} Spuren: + RB-338`);
      assert.equal(els['neu-surge'].disabled, gesperrt, `${n} Spuren: + Surge (ohne Wirt-Spur)`);
      assert.equal(els['neu-kit'].disabled, gesperrt, `${n} Spuren: + KIT (without a kit device)`);
    }
  } finally { delete globalThis.document; }
});

// 1.9 U3 (L10): two Surge host slots. The "+ SURGE" button sends the command WITHOUT a slot (the server takes the first free one) and is disabled
// only when both slots are taken; the title names the two slots.
test('1.9 U3: + SURGE sends no slot and is disabled only with two Surge tracks', async () => {
  const { element } = await import('./support/dom_mock.mjs');
  const { bindeSpuren } = await import('../public/production/track_heads.js');
  globalThis.document = { createElement: (t) => Object.assign(element(t), { style: { setProperty() {} }, value: '', querySelector: () => Object.assign(element(), { style: { setProperty() {} }, value: '' }), querySelectorAll: () => [] }) };
  try {
    const els = { koepfe: Object.assign(element(), { children: [], insertBefore(el) { this.children.push(el); } }) }; const $ = (k) => (els[k] ??= element());
    const beim = [], gesendet = [];
    bindeSpuren({ st: {}, $, aendere(label, befehle) { gesendet.push([label, befehle]); }, aendereAus() {}, beimProjekt: beim, beimBild: [], beimEreignis: [] });
    const spur = (i, wirtSlot) => ({ id: `s${i}`, nr: i, name: 'x', farbe: '#000000', art: wirtSlot ? 'instrument' : 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [],
      ...(wirtSlot ? { geraet: { art: 'wirt', name: 'surge', slot: wirtSlot } } : {}) });
    const mit = (...slots) => ({ spuren: slots.map((sl, i) => spur(i + 1, sl)) });
    const gesperrt = (p) => { for (const f of beim) f(p); return els['neu-surge'].disabled; };
    assert.equal(gesperrt(mit()), false, 'no Surge track: free');
    assert.equal(gesperrt(mit(1)), false, 'one Surge track (slot 1): still free');
    assert.equal(gesperrt(mit(2)), false, 'one Surge track (slot 2): still free');
    assert.equal(gesperrt(mit(1, 2)), true, 'two Surge tracks: disabled');
    // the click: one Surge track already there, the command carries no slot
    for (const f of beim) f(mit(1));
    for (const f of els['neu-surge'].ereignisse.click) f();
    assert.equal(gesendet.length, 1);
    const geraet = gesendet[0][1][0].geraet;
    assert.deepEqual([geraet.art, geraet.name, 'slot' in geraet], ['wirt', 'surge', false], 'no slot in the command: the server picks the first free one');
    // negative control: the other buttons are not affected by the Surge rule
    for (const f of beim) f(mit(1, 2));
    assert.equal(els['neu-audio'].disabled, false);
  } finally { delete globalThis.document; }
});

test('slice 3: page and server have the same return limit', async () => {
  const { MAX_RETURNS: SEITE_R } = await import('../public/production/limits.js');
  const { MAX_RETURNS: SERVER_R } = await import('../project/model.ts');
  assert.equal(SEITE_R, SERVER_R);
  assert.equal(SERVER_R, 4);
});

test('1.9 U3: page and server have the same Surge host slot count, and the button title names both', async () => {
  const { WIRT_SLOTS: SEITE_W } = await import('../public/production/limits.js');
  const { WIRT_SLOTS: SERVER_W } = await import('../project/model.ts');
  assert.equal(SEITE_W, SERVER_W);
  assert.equal(SERVER_W, 2);
  const seite = (await import('node:fs')).readFileSync(new URL('../public/production/production.js', import.meta.url), 'utf8');
  assert.match(seite, /title="Add an instrument track with Surge \(host slot 1 or 2\)"/);
  assert.doesNotMatch(seite, /Surge \(host slot 1\)/);
});

test('1.9: page and server have the same kit device limit', async () => {
  const { MAX_KIT_GERAETE: SEITE_K } = await import('../public/production/limits.js');
  const { MAX_KIT_GERAETE: SERVER_K } = await import('../project/model.ts');
  assert.equal(SEITE_K, SERVER_K);
  assert.equal(SERVER_K, 8);
});
