// Plan M-1 Blocker 4: die angezeigte dB-Zahl der Seite ist die WIRKLICHE Kern-Zahl.
// Referenz: hilfen/kern_kurven_referenz.json, erzeugt von hilfen/kern_kurven_referenz.cpp aus den ECHTEN Kern-Funktionen
// ReglerTabelle::aus_x / zu_x (djk/kern/stellwerk/src/regler.cpp) mit den Standard-Kurven der Regler-Tabelle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GRIFF, art, griffZuMidi, midiRoh, wertAusMidi, formatiere, vorgabe, ZIELE, ZIEL_KURVE, setzeZielKurve } from '../oeffentlich/kurven.js';

const REF = JSON.parse(fs.readFileSync(new URL('./hilfen/kern_kurven_referenz.json', import.meta.url), 'utf8'));
const STETIG = ['deck/1/fader', 'deck/2/fader', 'master/pegel', 'cue/pegel', 'deck/1/eq/tief', 'deck/1/eq/mitte', 'deck/2/eq/hoch',
  'deck/1/trim', 'deck/1/filter', 'xfader', 'cue/mix'];

test('Standard: Ziel-Kurve ist der Kern', () => assert.equal(ZIEL_KURVE, 'kern'));

test('aus_x: die Seite rechnet Stellung → Wert wie der Kern (alle Stützpunkte des echten Kerns)', () => {
  let n = 0;
  for (const p of STETIG) {
    for (const [x, w] of REF[p].aus_x) {
      const js = wertAusMidi(p, x);
      assert.ok(Math.abs(js - w) <= 1e-4 * Math.max(1, Math.abs(w)), `${p} x=${x}: Seite ${js}, Kern ${w}`);
      n++;
    }
  }
  assert.ok(n >= 11 * 47, `nur ${n} Stützpunkte`);
});

test('zu_x: Wert → Stellung wie der Kern, auch an den Grenzen (Kill, stumm unter −120)', () => {
  for (const p of STETIG) {
    for (const [w, x] of REF[p].zu_x) {
      const js = GRIFF[art(p)].stellung(w);   // EQ: der Griff ist geteilt (2026-09-28), nur midiRoh folgt dem Kern
      if (art(p) !== 'eq') assert.ok(Math.abs(js - x) <= 1e-6, `${p} w=${w}: Seite ${js}, Kern ${x}`);
      assert.ok(Math.abs(midiRoh(p, w) - x) <= 1e-6, `${p} midiRoh w=${w}`);
    }
  }
});

// Grenze dieses Tests: er belegt die KURVENFUNKTION (Anzeige = aus_x des Kerns). Der echte Kern nimmt Hand-Griffe
// über Stellwerk::hand_anwenden (hand.cpp:118-125: erster Wert setzt nur die Stellung, danach skalierte Übernahme
// relativ zu phys und zu_x(wert)). aus_x(midi_roh) gilt nur, wenn der Kernwert zur Stellung passt; am laufenden
// Kern ist das NICHT gezeigt (Plan M-1 Task 1, Wiederaufnahme aus /dev/shm).
// Soll/Ist über den Regelweg: Soll = was die Seite anzeigt (Griff x), Ist = was aus_x des Kerns aus dem
// gesendeten midi_roh macht (Fixture aus dem Kern, Stützpunkte x = j/8 liegen auf dem 41er Raster: j*5)
test('Soll/Ist je Regler, 9 Stützpunkte, Kurvenfunktion: Anzeige = aus_x des Kerns (nicht hand_anwenden)', (t) => {
  const zeilen = [];
  for (const p of STETIG) {
    const kernAt = new Map(REF[p].aus_x.map(([x, w]) => [Math.fround(x).toFixed(6), w]));
    for (let j = 0; j <= 8; j++) {
      const x = j / 8;
      const soll = GRIFF[art(p)].wert(x);
      const u = griffZuMidi(p, x);
      // EQ (geteilter Griff, 2026-09-28): midi_roh liegt nicht mehr auf den Stützpunkten; aus_x ist oben gegen den Kern belegt
      const ist = art(p) === 'eq' ? wertAusMidi(p, u, 'kern') : kernAt.get(Math.fround(u).toFixed(6));
      assert.notEqual(ist, undefined, `${p} x=${x}: midi_roh ${u} nicht im Kern-Raster`);
      assert.ok(Math.abs(ist - soll) <= 1e-4 * Math.max(1, Math.abs(soll)), `${p} x=${x}: Anzeige ${soll}, Kern ${ist}`);
      zeilen.push(`${p} x=${x.toFixed(3)} midi_roh=${u.toFixed(4)} Soll=${soll.toFixed(2)} Ist(Kern)=${ist.toFixed(2)}`);
    }
  }
  t.diagnostic(`\n${zeilen.join('\n')}`);
});

test('Fehlerfall aus Plan M-1: die alte Attrappen-Kurve landet im Kern falsch, die neue richtig', () => {
  const kern = (p, u) => wertAusMidi(p, u, 'kern');   // = aus_x des Kerns (oben gegen den echten Kern belegt)
  const alt = (p, w) => midiRoh(p, w, 'attrappe_linear');
  // Master "−30 dB" → −1,41 dB; Cue "−12" → −0,54 dB; EQ "−26" (Kill) → +1,0 dB; Fader-Griff 0,002 → −2,7 dB
  assert.ok(Math.abs(kern('master/pegel', alt('master/pegel', -30)) + 1.41) < 0.005);
  assert.ok(Math.abs(kern('cue/pegel', alt('cue/pegel', -12)) + 0.54) < 0.005);
  assert.ok(Math.abs(kern('deck/1/eq/mitte', alt('deck/1/eq/mitte', -26)) - 1.03) < 0.005);
  assert.ok(Math.abs(kern('deck/1/fader', alt('deck/1/fader', GRIFF.fader.wert(0.002))) + 2.73) < 0.005);
  // nachher, derselbe Fall über den Standardweg der Seite
  assert.ok(Math.abs(kern('master/pegel', midiRoh('master/pegel', -30)) + 30) < 1e-3);
  assert.ok(Math.abs(kern('cue/pegel', midiRoh('cue/pegel', -12)) + 12) < 1e-3);
  assert.equal(kern('deck/1/eq/mitte', midiRoh('deck/1/eq/mitte', -26)), -200, 'EQ-Kill ist Kill');
  assert.ok(Math.abs(kern('deck/1/fader', griffZuMidi('deck/1/fader', 0.002)) - GRIFF.fader.wert(0.002)) < 1e-3, 'kein Sprung');
  assert.equal(kern('deck/1/fader', griffZuMidi('deck/1/fader', 0)), -200);
});

test('Fader unter −60 dB ist im Kern stumm: die Seite zeigt dort −∞, nicht −70', () => {
  assert.equal(GRIFF.fader.wert(0.0005), -200);
  assert.equal(formatiere('deck/1/fader', GRIFF.fader.wert(0.0005)), '−∞ dB');
  assert.equal(GRIFF.eq.wert(0), -200);
  assert.equal(formatiere('deck/1/eq/tief', GRIFF.eq.wert(0)), '−∞ dB');
});

test('Vorgaben §1.5 kommen als richtige Kern-Stellung an (Master 0 dB, Cue −12 dB, EQ 0 dB, Fader stumm)', () => {
  for (const [p, w] of [['master/pegel', 0], ['cue/pegel', -12], ['deck/1/eq/hoch', 0], ['deck/1/fader', -200], ['deck/1/trim', 0], ['cue/mix', -1]]) {
    assert.equal(vorgabe(p), w, p);
    const ist = wertAusMidi(p, midiRoh(p, vorgabe(p)));
    assert.ok(Math.abs(ist - w) < 1e-3, `${p}: Vorgabe ${w}, Kern ${ist}`);
  }
});

test('Negativ-Kontrolle: harmlose Regler sind unter beiden Kurven gleich (Trim 0, Filter/Crossfader Mitte, Kill/PFL)', () => {
  for (const [p, w, u] of [['deck/1/trim', 0, 0.5], ['deck/2/filter', 0, 0.5], ['xfader', 0, 0.5], ['cue/mix', 0, 0.5],
    ['deck/1/xseite', 1, 0.5]]) {  // THRU (2026-09-27)
    assert.equal(midiRoh(p, w, 'kern'), u);
    assert.equal(midiRoh(p, w, 'attrappe_linear'), u);
  }
  assert.equal(griffZuMidi('deck/1/kill/tief', 1), 1);
  assert.equal(griffZuMidi('deck/1/pfl', 0), 0);
  assert.equal(ZIELE.size, 86);  // K2: + master/kleber; 28 + deck/1/xseite, deck/2/xseite (2026-09-27) + erz/1 11 (Strudel) + pad/1, pad/2 je 11 (MVP 2)
});

test('float32 wie der Kern: Schwelle 0,001 und Kill entscheiden auf fround(x)', () => {
  // double 0,001 liegt unter der float32-Schwelle f(0,001)? Nein: fround(0.001) > 0.001, der Kern sieht ≥ Schwelle → −60 dB, nicht stumm
  assert.ok(Math.abs(GRIFF.fader.wert(0.001) + 60) < 1e-3, `fader 0,001 → ${GRIFF.fader.wert(0.001)}`);
  assert.equal(GRIFF.eq.wert(1e-46), -200, 'float32(1e-46) = 0: Kill wie im Kern');
  // Negativ-Kontrolle: harmlose Werte unverändert
  assert.ok(Math.abs(GRIFF.fader.wert(0.5) + 6.0206) < 1e-3);
  assert.ok(Math.abs(GRIFF.eq.wert(0.25) + 13) < 1e-4);
});

test('Ziel-Kurve umschaltbar für die Seite (Attrappe): griffZuMidi folgt setzeZielKurve, Rückweg stellt kern her', () => {
  try {
    const p = 'deck/1/eq/hoch';
    assert.equal(griffZuMidi('deck/1/filter', 0.8125), 0.8125, 'kern: Stellung = midi_roh');
    setzeZielKurve('attrappe_linear');
    const u = griffZuMidi(p, 0.8125);
    assert.ok(Math.abs(u - midiRoh(p, GRIFF.eq.wert(0.8125), 'attrappe_linear')) < 1e-12);
    assert.ok(Math.abs(u - 0.8125) > 0.01, 'linear über −200..+6 ≠ Stellung');
    assert.ok(Math.abs(wertAusMidi(p, u) - GRIFF.eq.wert(0.8125)) < 1e-9, 'Anzeige = was die Attrappe daraus macht');
    assert.equal(griffZuMidi('deck/1/filter', 0.5), 0.5, 'linear-Regler unter beiden gleich');
    assert.throws(() => setzeZielKurve('quatsch'), /erlaubt sind/);
  } finally { setzeZielKurve('kern'); }
  assert.equal(griffZuMidi('deck/1/filter', 0.8125), 0.8125);
});

// Andreas 2026-09-28: „die eq an den kanälen sollten grundsätzlich alle immer erstmal mitte ausgerichtet sein.“
// Griff-Kurve geteilt wie am Pioneer: Mitte = 0 dB, links −26 dB (ganz links Kill), rechts +6 dB. Der Kern bleibt linear;
// die Seite schickt die Kern-Stellung des Werts, damit Anzeige = Kern-Zahl bleibt.
test('EQ: Mitte des Knopfs ist 0 dB, Vorgabe steht in der Mitte', () => {
  const kern = (p, u) => wertAusMidi(p, u, 'kern');
  for (const p of ['deck/1/eq/hoch', 'deck/2/eq/mitte', 'erz/1/eq/tief', 'pad/1/eq/tief']) {
    assert.equal(GRIFF.eq.stellung(vorgabe(p)), 0.5, `${p}: Vorgabe in der Mitte`);
    assert.equal(kern(p, griffZuMidi(p, 0.5)), 0, `${p}: Mitte kommt im Kern als 0 dB an`);
    assert.equal(kern(p, griffZuMidi(p, 0)), -200, `${p}: ganz links Kill`);
    assert.ok(Math.abs(kern(p, griffZuMidi(p, 1)) - 6) < 1e-4, `${p}: ganz rechts +6`);
    assert.ok(Math.abs(kern(p, griffZuMidi(p, 0.25)) + 13) < 1e-3, `${p}: Viertel −13`);
    assert.ok(Math.abs(kern(p, griffZuMidi(p, 0.75)) - 3) < 1e-3, `${p}: Dreiviertel +3`);
  }
  for (const w of [-25.9, -13, -1, 0, 1, 3, 6]) assert.ok(Math.abs(GRIFF.eq.wert(GRIFF.eq.stellung(w)) - w) < 1e-4, `Hin und zurück ${w}`);
  // Negativ-Kontrolle: Trim und Filter bleiben, wie sie waren
  assert.equal(griffZuMidi('deck/1/trim', 0.3), 0.3);
  assert.equal(griffZuMidi('deck/1/filter', 0.3), 0.3);
});
