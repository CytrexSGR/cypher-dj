// I08 Task 5, Review-Nachzug: /zustand/ein (§5.14) geht an /strom (DURCHREICHEN) und wird auf 250 ms gedrosselt (DROSSEL_MS).
// Kern-Attrappe, kein Ton. Mutanten: Eintrag aus DURCHREICHEN streichen, Eintrag aus DROSSEL_MS streichen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel, warte } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';

const ein = (verbunden, n) => ({ verbunden, midi_gesehen: n, midi_verloren: 0, midi_sample: -1, flanke_sample: -1 });

test('Strom: /zustand/ein wird durchgereicht und auf 250 ms gedrosselt (erste Meldung sofort, der Rest verdichtet auf die letzte)', async (t) => {
  const { o, url } = await stapel(t);
  const zeilen = [];
  const ac = new AbortController();
  t.after(() => ac.abort());
  (async () => { const s = await fetch(`${url}/strom`, { signal: ac.signal }); for await (const teil of s.body) zeilen.push(new TextDecoder().decode(teil)); })().catch(() => {});
  for (let n = 0; n < 50 && zeilen.length === 0; n++) await warte(20);
  const treffer = () => zeilen.join('').split('\n').filter((z) => z.includes('"a":"/zustand/ein"')).map((z) => JSON.parse(z.slice(6)));
  const i = innen(o);
  i.vomKern('/zustand/ein', ein(1, 1));
  for (let n = 0; n < 50 && treffer().length < 1; n++) await warte(20);
  assert.equal(treffer().length, 1, 'durchgereicht, sofort');
  assert.equal(treffer()[0].f.verbunden, 1);
  i.vomKern('/zustand/ein', ein(3, 2));
  i.vomKern('/zustand/ein', ein(7, 3));
  await warte(100);
  assert.equal(treffer().length, 1, 'Drossel: innerhalb von 250 ms kommt nichts nach');
  for (let n = 0; n < 50 && treffer().length < 2; n++) await warte(20);
  assert.equal(treffer().length, 2, 'danach genau eine verdichtete Meldung');
  assert.equal(treffer()[1].f.verbunden, 7, 'die letzte gilt');
  // Negativ-Kontrolle: eine andere Adresse ohne Eintrag geht weiter nicht durch
  i.vomKern('/zustand/box', { box: 1, belegt: 0 });
  await warte(100);
  assert.ok(!zeilen.join('').includes('/zustand/box'));
});
