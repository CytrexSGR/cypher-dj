// PRODUCTION V1: Undo-Stand und Verlaufsanzeige (reine Funktionen)
import test from 'node:test';
import assert from 'node:assert/strict';
import { undoStand, verlaufZeilen, zeitText, labelText } from '../public/production/history.js';

const e = (rev, art, label, quelle = 'andreas') => ({ rev, zeit: Date.UTC(2026, 9, 15, 12, 0, rev), quelle, label, art });

test('V1 Verlauf: Undo-Zeiger aus dem Log', () => {
  assert.deepEqual(undoStand([]), { undo: null, redo: null, tiefe: 0 });
  const log = [e(1, 'aendern', 'Add track'), e(2, 'aendern', 'Add clip'), e(3, 'undo', 'Undo: Add clip')];   // Form von S2: das Präfix steht schon im Label (history.ts protokolliere)
  const s = undoStand(log);
  assert.equal(s.undo.label, 'Add track');
  assert.equal(s.redo.label, 'Add clip');
  // zweites Undo geht einen Schritt weiter zurück (nicht: macht das erste Undo rückgängig, Spec-Prüfung seite5)
  const s2 = undoStand([...log, e(4, 'undo', 'Undo: Add track')]);
  assert.equal(s2.undo, null);
  assert.equal(s2.redo.label, 'Add track');
  const s3 = undoStand([...log, e(4, 'redo', 'Redo: Add clip')]);
  assert.equal(s3.undo.label, 'Add clip');
  assert.equal(s3.redo, null);
  // neue Änderung macht den Redo-Stapel ungültig
  assert.equal(undoStand([...log, e(4, 'aendern', 'Fader')]).redo, null);
  // Reihenfolge der Antwort egal: nach rev sortiert
  assert.equal(undoStand([...log].reverse()).redo.label, 'Add clip');
});

test('V1 Verlauf: Zeilen neueste zuerst, Quelle Cypher sichtbar (A9)', () => {
  // Form von S2: undo/redo tragen das Präfix schon im Label; die Seite zeigt das Label unverändert (kein „Undo: Undo: Mute“)
  const z = verlaufZeilen([e(1, 'aendern', 'Add track'), e(2, 'aendern', 'Mute', 'cypher'), e(3, 'undo', 'Undo: Mute'), e(4, 'redo', 'Redo: Mute')]);
  assert.deepEqual(z.map((x) => x.text), ['Redo: Mute', 'Undo: Mute', 'Mute', 'Add track']);
  assert.ok(z.every((x) => !/(Undo|Redo): (Undo|Redo):/.test(x.text)), 'Präfix nie doppelt');
  // Negativ-Kontrolle: eine Änderung, deren Label mit „Undo“ nur beginnt, bleibt wie sie ist; eine undo-Zeile ohne Präfix bleibt ohne
  assert.deepEqual(verlaufZeilen([e(1, 'aendern', 'Undo drum fill'), e(2, 'undo', 'Mute')]).map((x) => x.text), ['Mute', 'Undo drum fill']);
  assert.deepEqual(z.map((x) => x.quelle), ['You', 'You', 'Cypher', 'You']);
  assert.match(z[0].zeit, /^\d\d:\d\d:\d\d$/);
  assert.equal(verlaufZeilen(Array.from({ length: 50 }, (_, i) => e(i + 1, 'aendern', `L${i + 1}`)), 40).length, 40);
  // Negativ-Kontrolle: unlesbare Zeit zeigt einen Strich statt NaN
  assert.equal(zeitText('kaputt'), '–');
  assert.equal(zeitText(null), '–', 'null wäre sonst die Epoche 1970');
  // S2 schreibt die Zeit als ISO-Text (history.ts Eintrag.zeit), die Attrappe als Millisekunden: beides lesbar
  assert.match(zeitText('2026-10-15T12:00:03.000Z'), /^\d\d:\d\d:03$/);
});

// Strg+Z/Strg+Y: Textfelder behalten ihr eigenes Zurück, Regler (Fader, Pan) nicht
import { istTextFeld } from '../public/production/history_display.js';
test('V1 Verlauf: Strg+Z greift mit der Hand am Regler, nicht im Textfeld', () => {
  assert.equal(istTextFeld({ tagName: 'INPUT', type: 'range' }), false, 'Fader und Pan sind type=range');
  // Negativ-Kontrollen: alles, worin Text steht, bleibt ausgeschlossen
  assert.equal(istTextFeld({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(istTextFeld({ tagName: 'INPUT' }), true, 'ohne type ist es Text');
  assert.equal(istTextFeld({ tagName: 'input', type: 'RANGE' }), false, 'Schreibweise egal');
  assert.equal(istTextFeld({ tagName: 'TEXTAREA' }), true);
  assert.equal(istTextFeld({ tagName: 'SELECT' }), true);
  assert.equal(istTextFeld({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(istTextFeld({ tagName: 'DIV', isContentEditable: false }), false);
  assert.equal(istTextFeld({ tagName: 'BUTTON' }), false);
  assert.equal(istTextFeld(null), false);
});

test('labelText: a stored "Baukasten:" label is shown as "Cypher Modular:", also behind Undo and Redo; other labels stay', () => {
  assert.equal(labelText('Baukasten: save sound'), 'Cypher Modular: save sound');
  assert.equal(labelText('Undo: Baukasten: save sound'), 'Undo: Cypher Modular: save sound');
  assert.equal(labelText('Redo: Baukasten: save sound'), 'Redo: Cypher Modular: save sound');
  assert.equal(labelText('Cypher Modular: save sound'), 'Cypher Modular: save sound');
  assert.equal(labelText('Tempo 124'), 'Tempo 124');
  assert.equal(labelText(undefined), '');
  assert.equal(verlaufZeilen([e(1, 'aendern', 'Baukasten: save sound')])[0].text, 'Cypher Modular: save sound');
});

// UI polish T7 (Nr. 19): the HISTORY list closes on Escape, on a click outside, and when the project or the view changes; aria-expanded follows
import { bindeVerlauf } from '../public/production/history_display.js';

function popupUmgebung() {
  const abh = { document: {}, window: {} }, alt = { document: globalThis.document, window: globalThis.window };
  const knoepfe = {}, attr = {};
  const mach = (id) => ({ id, hidden: true, disabled: false, title: '', textContent: '', children: [], setAttribute: (k, v) => { attr[`${id}.${k}`] = v; }, addEventListener(a, f) { (knoepfe[`${id}.${a}`] ??= []).push(f); }, append() {}, closest(s) { return s === `#${id}` ? this : null; } });
  const els = { undo: mach('undo'), redo: mach('redo'), verlauf: mach('verlauf'), 'verlauf-liste': mach('verlauf-liste') };
  globalThis.document = { body: { classList: { contains: () => false } }, addEventListener: (a, f) => { (abh.document[a] ??= []).push(f); }, createElement: () => ({ dataset: {} }) };
  globalThis.window = { addEventListener: (a, f) => { (abh.window[a] ??= []).push(f); } };
  const beimProjekt = [];
  bindeVerlauf({ st: { projekt: null, slug: null }, $: (n) => els[n], nachLaden: [], beimProjekt, holeGet: async () => ({ status: 200, j: [] }), schreiber: {} });
  return { els, abh, knoepfe, attr, beimProjekt, fertig: () => { globalThis.document = alt.document; globalThis.window = alt.window; } };
}
const klick = (u) => u.knoepfe['verlauf.click'][0]({ target: u.els.verlauf, stopPropagation() {} });

test('HISTORY popup: Escape, a click outside, a project change and a view change close it; aria-expanded follows', () => {
  const u = popupUmgebung();
  try {
    const liste = u.els['verlauf-liste'];
    klick(u);
    assert.equal(liste.hidden, false);
    assert.equal(u.attr['verlauf.aria-expanded'], 'true');
    u.abh.document.keydown[0]({ key: 'Escape' });
    assert.equal(liste.hidden, true);
    assert.equal(u.attr['verlauf.aria-expanded'], 'false');
    klick(u);
    u.abh.document.click[0]({ target: { closest: () => null } });
    assert.equal(liste.hidden, true, 'a click on the body closes it');
    klick(u);
    u.abh.document.click[0]({ target: { closest: (s) => (s === '#verlauf-liste' ? {} : null) } });
    assert.equal(liste.hidden, false, 'a click inside the list keeps it');
    u.beimProjekt[0]({}, true);
    assert.equal(liste.hidden, true, 'a project change closes it');
    klick(u);
    u.abh.window.hashchange[0]();
    assert.equal(liste.hidden, true, 'a view change (hash) closes it');
    klick(u);
    klick(u);
    assert.equal(liste.hidden, true, 'the key toggles');
    klick(u);
    u.abh.document.keydown[0]({ key: 'a' });
    assert.equal(liste.hidden, false, 'other keys do nothing');
  } finally { u.fertig(); }
});
