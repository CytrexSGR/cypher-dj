// Scheibe 60m, Task 1: Ziel-Liste und Kurven (Griff → Wert → midi_roh der Attrappe und zurück)
import test from 'node:test';
import assert from 'node:assert/strict';
import { ZIELE, art, GRIFF, griffZuMidi, midiRoh, wertAusMidi, formatiere, vorgabe } from '../oeffentlich/kurven.js';

test('Ziel-Liste: 41 Pfade, je Deck 13 (mit PFL und Crossfader-Zuweisung), erz/1 11, pad/1 und pad/2 je 11 (ohne Tasten) plus xfader, master/pegel, cue/mix, cue/pegel', () => {
  assert.equal(ZIELE.size, 86);   // K2: plus master/kleber
  for (const p of ['deck/1/fader', 'deck/2/eq/tief', 'deck/1/kill/hoch', 'deck/2/play', 'deck/1/cue', 'xfader',
    'deck/1/pfl', 'deck/2/pfl', 'master/pegel', 'master/kleber', 'cue/mix', 'cue/pegel', 'erz/1/fader']) assert.ok(ZIELE.has(p), p);
});

test('Fehlerfall: falsche Ziele nicht in der Liste', () => {
  for (const p of ['deck/3/fader', 'deck/1/bogus', 'deck/3/pfl', 'deck/1/ziel', 'cue/split', 'master/fader', 'cue/pegel/x',
    'master/pegel/', 'deck/1/pfl/x', '', 'deck/1/fader/x']) {
    assert.ok(!ZIELE.has(p), p);
  }
});

test('Fader: Stellung 0 → −200 dB (midi 0), 1 → 0 dB (midi 1), 0,5 → −6,02 dB', () => {
  assert.equal(griffZuMidi('deck/1/fader', 0), 0);
  assert.equal(griffZuMidi('deck/1/fader', 1), 1);
  const w = GRIFF.fader.wert(0.5);
  assert.ok(Math.abs(w + 6.0206) < 1e-3, String(w));
  assert.ok(Math.abs(wertAusMidi('deck/1/fader', griffZuMidi('deck/1/fader', 0.5)) - w) < 1e-9);
});

test('EQ: Griff geteilt (Andreas 2026-09-28), Mitte 0 dB, Stellung 0 = Kill (−200), knapp darüber −26 dB; Kern bleibt linear', () => {
  assert.equal(GRIFF.eq.wert(0.5), 0);
  assert.ok(Math.abs(griffZuMidi('deck/1/eq/mitte', 0.5) - 26 / 32) < 1e-6, 'Mitte → Kern-Stellung von 0 dB');
  assert.equal(GRIFF.eq.wert(0), -200);
  assert.equal(midiRoh('deck/1/eq/tief', -26), 0);
  assert.ok(Math.abs(GRIFF.eq.wert(1e-4) + 26 - 0.0052) < 1e-4);
  assert.ok(Math.abs(midiRoh('deck/1/eq/mitte', 0) - 26 / 32) < 1e-6);
});

test('Gain, Filter, Crossfader: Mitte → 0; Kill und Tasten als Schalter', () => {
  assert.ok(Math.abs(wertAusMidi('deck/2/trim', griffZuMidi('deck/2/trim', 0.5))) < 1e-9);
  assert.equal(griffZuMidi('deck/2/filter', 0.5), 0.5);
  assert.equal(griffZuMidi('xfader', 0.5), 0.5);
  assert.equal(griffZuMidi('deck/1/kill/tief', 1), 1);
  assert.equal(griffZuMidi('deck/1/kill/tief', 0), 0);
  assert.equal(griffZuMidi('deck/1/play', 1), 1);
  assert.equal(art('deck/1/cue'), 'taste');
});

test('Stellung ↔ Wert rund für alle stetigen Regler', () => {
  for (const [a, xs] of [['fader', [0.1, 0.5, 0.9, 1]], ['trim', [0, 0.3, 1]], ['eq', [0, 0.5, 1]], ['filter', [0, 0.25, 1]]]) {
    for (const x of xs) assert.ok(Math.abs(GRIFF[a].stellung(GRIFF[a].wert(x)) - x) < 1e-6, `${a} ${x}`);
  }
});

test('Anzeige englisch', () => {
  assert.equal(formatiere('deck/1/fader', -200), '−∞ dB');
  assert.equal(formatiere('deck/1/eq/tief', 3), '+3.0 dB');
  assert.equal(formatiere('deck/1/filter', -0.4), 'LP 40');
  assert.equal(formatiere('xfader', 0), 'CENTER');
});

test('Nachtrag: Master- und Kopfhörer-Pegel wie Fader (0 → −200, 1 → 0 dB), Ziel fader_db (Kern)', () => {
  for (const p of ['master/pegel', 'cue/pegel']) {
    assert.equal(art(p), 'pegel');
    assert.equal(griffZuMidi(p, 0), 0);
    assert.equal(griffZuMidi(p, 1), 1);
    const w = GRIFF.pegel.wert(0.5);
    assert.ok(Math.abs(w + 6.0206) < 1e-3, String(w));
    assert.ok(Math.abs(wertAusMidi(p, griffZuMidi(p, 0.5)) - w) < 1e-9);
  }
  assert.equal(vorgabe('master/pegel'), 0);
  assert.equal(vorgabe('cue/pegel'), -12);
  assert.equal(formatiere('cue/pegel', -12), '−12.0 dB');
});

test('Nachtrag: cue/mix −1 (nur Cue) bis +1 (nur Master), Vorgabe −1; PFL als Schalter', () => {
  assert.equal(art('cue/mix'), 'mix');
  assert.equal(vorgabe('cue/mix'), -1);
  assert.equal(griffZuMidi('cue/mix', 0), 0);
  assert.equal(griffZuMidi('cue/mix', 0.5), 0.5);
  assert.ok(Math.abs(wertAusMidi('cue/mix', griffZuMidi('cue/mix', 0.75)) - 0.5) < 1e-12);
  assert.equal(formatiere('cue/mix', -1), 'CUE');
  assert.equal(formatiere('cue/mix', 1), 'MASTER');
  assert.equal(formatiere('cue/mix', 0), 'MIX');
  for (const p of ['deck/1/pfl', 'deck/2/pfl']) {
    assert.equal(art(p), 'pfl');
    assert.equal(griffZuMidi(p, 1), 1);
    assert.equal(griffZuMidi(p, 0), 0);
    assert.equal(wertAusMidi(p, 1), 1);
    assert.equal(vorgabe(p), 0);
  }
  assert.equal(formatiere('deck/1/pfl', 1), 'PFL');
  assert.equal(vorgabe('deck/1/fader'), -200);
  assert.equal(vorgabe('deck/1/eq/tief'), 0);
});

test('Crossfader-Zuweisung deck/<n>/xseite (2026-09-27): A 0, THRU 1, B 2 als midi_roh 0, 0,5, 1 (FORMAT 22 g)', () => {
  assert.ok(ZIELE.has('deck/1/xseite') && ZIELE.has('deck/2/xseite'));
  assert.ok(!ZIELE.has('deck/3/xseite'));
  assert.equal(art('deck/1/xseite'), 'xseite');
  assert.deepEqual([0, 1, 2].map((w) => midiRoh('deck/2/xseite', w)), [0, 0.5, 1]);
  assert.deepEqual([0, 0.5, 1].map((u) => GRIFF.xseite.wert(u)), [0, 1, 2]);
  assert.equal(vorgabe('deck/1/xseite'), 1);
});

test('Strudel-Kanal erz/1: Kanalzug greifbar, keine Tasten, andere Erzeuger nicht', () => {
  for (const p of ['erz/1/fader', 'erz/1/eq/tief', 'erz/1/kill/hoch', 'erz/1/filter', 'erz/1/trim', 'erz/1/pfl', 'erz/1/xseite']) {
    assert.ok(ZIELE.has(p), p);
  }
  assert.equal(art('erz/1/fader'), 'fader');
  assert.equal(art('erz/1/eq/mitte'), 'eq');
  for (const p of ['erz/1/play', 'erz/4/fader']) assert.ok(!ZIELE.has(p), p);
});
test('Loop-Boxen pad/1, pad/2: Kanalzug und Crossfader-Seite greifbar, keine Tasten, andere Pads nicht', () => {
  for (const k of ['pad/1', 'pad/2']) {
    for (const p of ['fader', 'eq/tief', 'kill/hoch', 'filter', 'trim', 'pfl', 'xseite']) assert.ok(ZIELE.has(`${k}/${p}`), `${k}/${p}`);
  }
  assert.equal(art('pad/2/fader'), 'fader');
  assert.equal(art('pad/1/filter'), 'filter');
  for (const p of ['pad/1/play', 'pad/3/fader', 'pad/1/send/1']) assert.ok(!ZIELE.has(p), p);
});

test('K2 Kleber: linear 0..1 (u = Wert), Vorgabe 0 = aus, Anzeige OFF / Prozent', () => {
  assert.equal(art('master/kleber'), 'kleber');
  for (const u of [0, 0.25, 0.55, 1]) {
    assert.equal(griffZuMidi('master/kleber', u), u);
    assert.ok(Math.abs(GRIFF.kleber.wert(u) - u) < 1e-6);
    assert.ok(Math.abs(GRIFF.kleber.stellung(GRIFF.kleber.wert(u)) - u) < 1e-6);
    assert.ok(Math.abs(wertAusMidi('master/kleber', u) - u) < 1e-6);
    assert.ok(Math.abs(midiRoh('master/kleber', u) - u) < 1e-6);
  }
  assert.equal(vorgabe('master/kleber'), 0);
  assert.equal(formatiere('master/kleber', 0), 'OFF');
  assert.equal(formatiere('master/kleber', 0.55), '55%');
});
