// http/router.ts (Plan 2026-10-15-d1-s1, Task 9): Reihenfolge, Methode '*', Pfadlisten und -muster, doppelte Bereiche.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../http/router.ts';

const h = (name) => Object.assign(() => {}, { kennung: name });
const r = (methode, pfad, name, schutz = 'offen') => ({ methode, pfad, schutz, handler: h(name) });

test('Router: erster Treffer in Melde-Reihenfolge gewinnt, Methode muss passen, * passt auf jede', () => {
  const ro = new Router();
  ro.melde({ name: 'a', routen: () => [r('GET', '/x', 'get-x'), r('POST', ['/x', '/y'], 'post-xy', 'fremdePost'), { ...r('*', (p) => p.startsWith('/s/'), 'alles-s'), offenErlaubt: true }] });
  ro.melde({ name: 'b', routen: () => [r('GET', '/x', 'spaeter-x'), r('GET', '/z', 'get-z')] });
  assert.equal(ro.finde('GET', '/x').handler.kennung, 'get-x', 'früher gemeldet gewinnt');
  assert.equal(ro.finde('POST', '/y').handler.kennung, 'post-xy');
  assert.equal(ro.finde('DELETE', '/s/1').handler.kennung, 'alles-s');
  assert.equal(ro.finde('GET', '/z').handler.kennung, 'get-z');
  assert.equal(ro.finde('PUT', '/x'), null, 'Negativ-Kontrolle: falsche Methode');
  assert.equal(ro.finde('GET', '/xx'), null, 'Negativ-Kontrolle: kein Präfix-Treffer bei festen Pfaden');
  assert.deepEqual(ro.liste().map((e) => `${e.bereich} ${e.methode} ${e.pfad} ${e.schutz}`),
    ['a GET /x offen', 'a POST /x|/y fremdePost', 'a * (muster) offen', 'b GET /x offen', 'b GET /z offen']);
});

test('Router: ein Bereichname nur einmal', () => {
  const ro = new Router();
  ro.melde({ name: 'proj', routen: () => [] });
  assert.throws(() => ro.melde({ name: 'proj', routen: () => [] }), /Bereich proj ist schon gemeldet/);
});

// Spec D1 2.10: optionaler Haken ereignis?(adresse, felder). Der Router reicht jedes Kern-Ereignis in Melde-Reihenfolge an alle
// Bereiche mit Haken; ein Bereich ohne Haken wird übersprungen, ein werfender Haken hält die übrigen nicht auf (Fehler an den Rückruf).
test('Router: ereignis geht in Melde-Reihenfolge an Bereiche mit Haken; ohne Haken übersprungen; Wurf hält die anderen nicht auf', () => {
  const ro = new Router();
  const gesehen = [];
  ro.melde({ name: 'a', routen: () => [], ereignis: (adr, f) => gesehen.push(['a', adr, f]) });
  ro.melde({ name: 'ohne', routen: () => [] });
  ro.melde({ name: 'kaputt', routen: () => [], ereignis: () => { throw new Error('boese'); } });
  ro.melde({ name: 'b', routen: () => [], ereignis: (adr, f) => gesehen.push(['b', adr, f]) });
  const fehler = [];
  ro.ereignis('/e/regler', { pfad: 'x', wert: 1 }, (bereich, e) => fehler.push([bereich, e.message]));
  assert.deepEqual(gesehen, [['a', '/e/regler', { pfad: 'x', wert: 1 }], ['b', '/e/regler', { pfad: 'x', wert: 1 }]]);
  assert.deepEqual(fehler, [['kaputt', 'boese']], 'Negativ-Kontrolle: nur der werfende Bereich wird gemeldet');
  assert.doesNotThrow(() => new Router().ereignis('/q', {}), 'ohne Bereiche und ohne Rückruf passiert nichts');
});

// „Ohne Haken keine Kosten“: ohne Bereich mit Haken wird nicht geklont. Eine Funktion in felder ist nicht klonbar (structuredClone wirft):
// ohne Haken darf das nicht auffallen, mit Haken wirft ereignis (die Kopie entsteht vor den Haken, also außerhalb ihres try).
test('Router: ereignis ohne Haken klont nicht (nicht klonbares felder wirft nicht); mit Haken entsteht die Kopie und wirft', () => {
  const felder = { f: () => {} };
  const ohne = new Router();
  ohne.melde({ name: 'ohne', routen: () => [] });
  assert.doesNotThrow(() => ohne.ereignis('/q', felder), 'ohne Haken keine Kopie, also kein Wurf');
  const mit = new Router();
  mit.melde({ name: 'a', routen: () => [], ereignis: () => {} });
  assert.throws(() => mit.ereignis('/q', felder), /clone|klon|DataCloneError/i, 'Negativ-Kontrolle: mit Haken wird geklont');
});

// Router-Schutz: eine Route mit Methode POST oder * und schutz 'offen' wird abgelehnt (ein schreibender Weg ohne fremdePost-Prüfung wäre
// ein Versehen), außer sie trägt ausdrücklich offenErlaubt: true. GET darf offen sein. Eine abgelehnte Meldung hinterlässt nichts.
test('Router: POST und * mit schutz offen werden abgelehnt, außer offenErlaubt; GET offen geht; abgelehnter Bereich hinterlässt nichts', () => {
  const ro = new Router();
  assert.throws(() => ro.melde({ name: 'x', routen: () => [r('GET', '/ok', 'g'), r('POST', '/offen', 'p')] }), /POST \/offen.*offen.*offenErlaubt/s);
  assert.throws(() => ro.melde({ name: 'x', routen: () => [r('*', '/alles', 'a')] }), /offenErlaubt/);
  assert.equal(ro.finde('GET', '/ok'), null, 'abgelehnt: auch die gültige Route des Bereichs ist nicht gemeldet');
  assert.deepEqual(ro.liste(), []);
  ro.melde({ name: 'x', routen: () => [r('GET', '/ok', 'g')] });   // der Name war nicht belegt
  ro.melde({ name: 'y', routen: () => [{ ...r('POST', '/bewusst', 'b'), offenErlaubt: true }, r('POST', '/geschuetzt', 'c', 'fremdePost')] });
  assert.equal(ro.finde('POST', '/bewusst').handler.kennung, 'b');
  assert.equal(ro.finde('POST', '/geschuetzt').handler.kennung, 'c');
});
