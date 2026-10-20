// PRODUCTION V1: Texte und Werte der Spurköpfe (reine Teile von spurkoepfe.js; der DOM-Teil läuft in der Browserprobe)
import test from 'node:test';
import assert from 'node:assert/strict';
import { faderWert, faderText, panText, geraetText, naechsteFarbe, zielIndex, spurLabels, istUmbenennenTaste, FADER_AUS, FADER_MIN, FADER_MAX } from '../oeffentlich/produktion/spurkoepfe.js';
import { FARBEN } from '../oeffentlich/produktion/layout.js';

test('V1 Spurkopf: Fader ganz unten ist aus (−200), sonst der Wert; Text mit echtem Minus', () => {
  assert.equal(faderWert(-60), FADER_AUS);
  assert.equal(faderWert(-59.5), -59.5);
  assert.equal(faderWert(9), 6);
  assert.equal(faderText(-200), '−∞');
  assert.equal(faderText(-6), '−6.0');
  assert.equal(faderText(3), '+3.0');
  // Negativ-Kontrolle: 0 dB bleibt 0 und zeigt kein Vorzeichen
  assert.equal(faderWert(0), 0);
  assert.equal(faderText(0), '0.0');
});

test('V1 Spurkopf: Pan-Text C/L/R', () => {
  assert.equal(panText(0), 'C');
  assert.equal(panText(0.004), 'C');
  assert.equal(panText(-0.25), 'L25');
  assert.equal(panText(1), 'R100');
});

test('V1 Spurkopf: Gerätetext und Farbfolge', () => {
  assert.equal(geraetText({ art: 'audio' }), 'AUDIO');
  assert.equal(geraetText({ art: 'instrument', geraet: { art: 'intern', name: 'rb338' } }), 'RB-338');
  assert.equal(geraetText({ art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 } }), 'SURGE · 1');
  assert.equal(naechsteFarbe(FARBEN[0]), FARBEN[1]);
  assert.equal(naechsteFarbe(FARBEN.at(-1)), FARBEN[0]);
  assert.equal(naechsteFarbe('#123456'), FARBEN[0], 'fremde Farbe: Anfang der Folge');
});

test('V1 Spurkopf: Fader-Bereich −60..+6 dB, der Grenzwert gilt, darüber wird auf ihn gesetzt (Spec §4: fader_db −200..+6)', () => {
  assert.equal(FADER_MAX, 6);
  assert.equal(FADER_MIN, -60);
  assert.equal(faderWert(6), 6, 'Grenzwert selbst');
  assert.equal(faderWert(5.5), 5.5);
  assert.equal(faderWert(6.5), 6, 'knapp darüber');
  assert.equal(faderText(6), '+6.0');
  // Negativ-Kontrolle: nichts im Bereich wird verändert, und der untere Anschlag bleibt „aus“
  assert.equal(faderWert(-0.5), -0.5);
  assert.equal(faderWert(-60), FADER_AUS);
});

test('V1 Spurkopf: ↑/↓ liefern den Zielindex für spur_verschieben, am Rand nichts', () => {
  assert.equal(zielIndex(3, 1, 'hoch'), 0);
  assert.equal(zielIndex(3, 1, 'runter'), 2);
  assert.equal(zielIndex(3, 0, 'hoch'), null, 'erste Spur hat kein ↑');
  assert.equal(zielIndex(3, 2, 'runter'), null, 'letzte Spur hat kein ↓');
  assert.equal(zielIndex(1, 0, 'runter'), null);
  // Negativ-Kontrolle: unbekannte Richtung und unbekannte Spur (Index −1) bewegen nichts
  assert.equal(zielIndex(3, 1, 'quer'), null);
  assert.equal(zielIndex(3, -1, 'hoch'), null);
});

test('V1 Spurkopf: jedes Bedienelement trägt den Spurnamen im zugänglichen Namen (englisch)', () => {
  assert.deepEqual(spurLabels('Kick'), { mute: 'Mute Kick', solo: 'Solo Kick', hoch: 'Move Kick up', runter: 'Move Kick down', farbe: 'Colour Kick',
    loeschen: 'Delete track Kick', umbenennen: 'Rename track Kick', fader: 'Volume Kick', pan: 'Pan Kick' });
  // Negativ-Kontrolle: zwei Spuren, zwei verschiedene Namen je Element (sonst läsen sich acht Spuren als acht gleiche „M“)
  const a = spurLabels('Kick'), b = spurLabels('Bass');
  for (const k of Object.keys(a)) { assert.notEqual(a[k], b[k], k); assert.match(a[k], /Kick/); assert.match(a[k], /^[ -~]+$/, `${k}: ASCII, englisch`); }
});

test('V1 Spurkopf: Umbenennen per Tastatur mit Enter oder F2, nicht mit Zusatztasten oder anderen Tasten', () => {
  assert.equal(istUmbenennenTaste({ key: 'Enter' }), true);
  assert.equal(istUmbenennenTaste({ key: 'F2' }), true);
  assert.equal(istUmbenennenTaste({ key: 'F2', ctrlKey: true }), false);
  assert.equal(istUmbenennenTaste({ key: 'Enter', shiftKey: true }), false);
  assert.equal(istUmbenennenTaste({ key: 'a' }), false);
  assert.equal(istUmbenennenTaste({ key: ' ' }), false);
});
