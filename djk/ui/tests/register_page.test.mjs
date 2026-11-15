// Controller register, page side: registerZeilen (pure) and baueRegister over a tiny fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerZeilen, baueRegister, baueLernen } from '../public/register_view.js';

const daten = {
  geraete: [
    { id: 'pult', datei: 'pult.json', rolle: 'basis', eintraege: 2, leds: 0, fehler: null },
    { id: 'apc20', datei: 'apc20.json', rolle: 'inaktiv', eintraege: 1, leds: 0, fehler: null },
    { id: 'kaputt', datei: 'kaputt.json', rolle: 'inaktiv', eintraege: 0, leds: 0, fehler: 'json' },
  ],
  kanten: [
    { geraet: 'pult', weg: 'kern', quelle: { typ: 'cc', kanal: 1, nr: 7 }, ziel: 'deck/1/fader', art: 'absolut', kurve: 'fader_db', einheit: 'db' },
    { geraet: 'pult', weg: 'kern', quelle: { typ: 'note', kanal: 13, nr: 10 }, ziel: 'deck/1/pfl', art: 'taste', kurve: null, einheit: 'schalter' },
    { geraet: 'apc20', weg: 'kern', quelle: { typ: 'cc', kanal: 1, nr: 48 }, ziel: 'deck/2/filter', art: 'absolut', kurve: null, einheit: 'linear' },
    { geraet: 'bruecke', weg: 'seite', quelle: { name: 'left touch strip' }, ziel: 'deck/1/scrub', art: 'beruehrung', kurve: null, einheit: null },
  ],
};

test('registerZeilen: text of the source, role of the device, columns', () => {
  const z = registerZeilen(daten, '');
  assert.equal(z.length, 4);
  assert.deepEqual(z[0], { geraet: 'pult', rolle: 'basis', quelle: 'cc 1/7', ziel: 'deck/1/fader', art: 'absolut', kurve: 'fader_db', weg: 'kern' });
  assert.equal(z[1].quelle, 'note 13/10');
  assert.equal(z[3].quelle, 'left touch strip');
  assert.equal(z[3].kurve, '');
});
test('registerZeilen: the filter is case-insensitive over all columns; inactive rows stay inactive', () => {
  assert.deepEqual(registerZeilen(daten, 'deck/1/fader').map((r) => r.ziel), ['deck/1/fader']);
  assert.deepEqual(registerZeilen(daten, 'TOUCH').map((r) => r.ziel), ['deck/1/scrub']);
  assert.deepEqual(registerZeilen(daten, 'apc20').map((r) => r.rolle), ['inaktiv']);
  assert.deepEqual(registerZeilen(daten, 'nope'), []);
  assert.deepEqual(registerZeilen({}, ''), []);
});

function el(tag) {
  const e = { tag, kinder: [], klassen: new Set(), attr: {}, dataset: {}, ev: {}, textContent: '', value: '',
    classList: { add: (c) => e.klassen.add(c), toggle: (c, an) => { if (an) e.klassen.add(c); else e.klassen.delete(c); } },
    append(...k) { e.kinder.push(...k); }, replaceChildren(...k) { e.kinder = k; }, setAttribute(n, v) { e.attr[n] = String(v); },
    addEventListener(n, f) { (e.ev[n] ??= []).push(f); },
    alle(aus = []) { aus.push(e); for (const k of e.kinder) k.alle?.(aus); return aus; } };
  return e;
}
test('baueLernen: LEARN posts the typed target, CANCEL posts null while armed, one DELETE per learned row', () => {
  const dok = globalThis.document; globalThis.document = { createElement: el };
  try {
    const gesendet = [];
    const opt = { wert: '', ziele: async () => [], schicken: (p, d) => gesendet.push([p, d]) };
    const wurzel = el('div');
    baueLernen(wurzel, { zuordnungen: [{ pfad: 'deck/1/fader', kanal: 2, nr: 21 }, { pfad: 'master/pegel', kanal: 2, nr: 22 }], wartet: null, midi: { port: 'X:Y' } }, opt);
    const alle = wurzel.alle();
    alle.find((x) => x.klassen.has('reg-ziel')).value = ' deck/1/filter ';
    const knopf = alle.find((x) => x.klassen.has('reg-learn'));
    assert.equal(knopf.textContent, 'LEARN');
    knopf.ev.click[0]();
    assert.deepEqual(gesendet, [['/lernen', { pfad: 'deck/1/filter' }]]);
    const weg = alle.filter((x) => x.klassen.has('reg-loeschen'));
    assert.equal(weg.length, 2);
    weg[1].ev.click[0]();
    assert.deepEqual(gesendet[1], ['/lernen/loeschen', { pfad: 'master/pegel' }]);
    baueLernen(wurzel, { zuordnungen: [], wartet: { pfad: 'deck/1/filter' }, midi: { port: 'X:Y' } }, opt);
    const k2 = wurzel.alle().find((x) => x.klassen.has('reg-learn'));
    assert.equal(k2.textContent, 'CANCEL');
    k2.ev.click[0]();
    assert.deepEqual(gesendet[2], ['/lernen', { pfad: null }]);
  } finally { globalThis.document = dok; }
});
test('baueRegister: one table row per row of registerZeilen, a chip per device, error and inactive marked', () => {
  const dok = globalThis.document; globalThis.document = { createElement: el };
  try {
    const wurzel = el('div');
    baueRegister(wurzel, daten, '');
    const alle = wurzel.alle();
    assert.equal(alle.filter((x) => x.tag === 'tr' && x.klassen.has('reg-zeile')).length, registerZeilen(daten, '').length);
    assert.equal(alle.filter((x) => x.klassen.has('reg-chip')).length, 3);
    assert.equal(alle.filter((x) => x.klassen.has('reg-chip') && x.klassen.has('reg-fehler')).length, 1);
    assert.equal(alle.filter((x) => x.klassen.has('reg-chip') && x.klassen.has('reg-inaktiv')).length, 2);
    baueRegister(wurzel, daten, 'fader');
    assert.equal(wurzel.alle().filter((x) => x.tag === 'tr' && x.klassen.has('reg-zeile')).length, 1);
  } finally { globalThis.document = dok; }
});
