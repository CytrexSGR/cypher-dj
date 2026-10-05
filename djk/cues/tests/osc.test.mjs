// OSC-Kodierung/Dekodierung (osc.ts), Rundlauf gegen die Adressen des Vorhörer-Vertrags. Fehlerfall: unbekannter
// Typ wirft statt still falsch zu kodieren. Negativ-Kontrolle: eine Nachricht ohne Argumente bleibt leer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dekodiere, kodiere, vorhoererPort } from '../osc.ts';

test('Rundlauf: /v/laden (s), /v/springe (d), /v/loop (dd), /v/position (dh)', () => {
  for (const [adr, typen, werte] of [
    ['/v/laden', 's', ['/pfad/mit leerzeichen/ö.mp3']],
    ['/v/springe', 'd', [61.5]],
    ['/v/loop', 'dd', [10.0026, 11.2345]],
    ['/v/position', 'dh', [9.5026, 123456789]],
    ['/v/hallo', '', []],
  ]) {
    const b = kodiere(adr, typen, ...werte);
    const d = dekodiere(b);
    assert.equal(d.adr, adr);
    d.werte.forEach((w, i) => {
      if (typeof w === 'number') assert.ok(Math.abs(w - werte[i]) < 1e-6, `${adr}[${i}]: ${w} != ${werte[i]}`);
      else assert.equal(w, werte[i]);
    });
  }
});

test('Fehlerfall: unbekannter Typ wirft', () => {
  assert.throws(() => kodiere('/x', 'z', 1));
});

test('Negativ-Kontrolle: /v/play ohne Argumente bleibt leer, keine Werte erfunden', () => {
  const d = dekodiere(kodiere('/v/play', ''));
  assert.equal(d.adr, '/v/play');
  assert.deepEqual(d.werte, []);
});

test('vorhoererPort: wie vfern.py port() — leer 47740, a..i 1000·k, ungültig wirft', () => {
  assert.equal(vorhoererPort(undefined), 47740);
  assert.equal(vorhoererPort(''), 47740);
  assert.equal(vorhoererPort('a'), 48740);
  assert.equal(vorhoererPort('h'), 55740);
  assert.throws(() => vorhoererPort('x'));
  assert.throws(() => vorhoererPort('ab'));
});
