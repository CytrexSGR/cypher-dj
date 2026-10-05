// Plan Oberfläche T3: reine Teile von welle.js (Lesen, Farbe, Spalten, Kopf). Kein DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leseWelle, zeichneSpalte, spalten, Kopf } from '../oeffentlich/welle.js';

function welle(zeilen) {
  const b = new ArrayBuffer(16 + zeilen.length * 4), v = new DataView(b);
  [...'DJKW'].forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint32(4, 1, true); v.setUint32(8, 256, true); v.setUint32(12, zeilen.length, true);
  zeilen.forEach((z, i) => z.forEach((x, k) => v.setUint8(16 + 4 * i + k, x)));
  return b;
}

test('leseWelle: Kopf wird geprüft, Spalten stimmen', () => {
  const w = leseWelle(welle([[10, 1, 2, 3], [20, 4, 5, 6]]));
  assert.equal(w.hop, 256); assert.equal(w.spalten, 2); assert.equal(w.daten[4], 20);
  assert.throws(() => leseWelle(new ArrayBuffer(16)), /DJKW/);
});

test('spalten: Spitze ist Maximum, Bänder sind Mittel', () => {
  const w = leseWelle(welle([[10, 0, 0, 100], [200, 50, 0, 0]]));
  assert.deepEqual(spalten(w, 0, 2), [200, 25, 0, 50]);
  assert.deepEqual(spalten(w, 5, 9), [0, 0, 0, 0], 'außerhalb: nichts');
});

test('zeichneSpalte (echter Zeichenweg): Bass rot, Höhen violett, Mitten grün; Stille zeichnet nichts', () => {
  const ton = (spalte) => { const f = []; const g = { set fillStyle(v) { f.push(v); }, fillRect() {} };
    zeichneSpalte(g, 0, 50, spalte); return f.length ? Number(/hsla?\((\d+)/.exec(f[0])[1]) : null; };
  assert.ok(ton([200, 200, 0, 0]) < 30, 'nur Bass → rot');
  assert.ok(ton([200, 0, 0, 200]) > 240, 'nur Höhen → violett');
  const m = ton([200, 0, 200, 0]); assert.ok(m > 110 && m < 160, `nur Mitten → grün (${m})`);
  assert.equal(ton([0, 0, 0, 0]), null, 'Stille: kein fillRect');
});

test('Kopf: läuft zwischen Meldungen gleichmäßig, springt bei einer Meldung nicht', () => {
  const k = new Kopf();
  k.melde(100, 128, 0, true);                     // Beat 100 bei t = 0 ms, 128 BPM, läuft
  const proMs = 128 / 60 / 1000;
  let vorher = k.beat(0), groessterSchritt = 0;
  for (let t = 7; t <= 1000; t += 7) {            // 143 Hz
    if (t === 105) k.melde(100 + 105 * proMs + 0.02, 128, 105, true);   // Meldung 0,02 Beat vorn (Server-Drossel)
    const b = k.beat(t);
    groessterSchritt = Math.max(groessterSchritt, Math.abs(b - vorher - 7 * proMs));
    vorher = b;
  }
  assert.ok(groessterSchritt < 0.005, `Sprung ${groessterSchritt} Beat in einem Bild`);
  assert.ok(Math.abs(k.beat(1000) - (100 + 1000 * proMs + 0.02)) < 1e-6, 'nach 200 ms ist der Fehler ganz eingeholt');
});

test('Kopf: große Abweichung (Sprung im Material) wird sofort übernommen; gestoppt steht er', () => {
  const k = new Kopf();
  k.melde(10, 128, 0, true);
  k.melde(200, 128, 100, true);                   // Sprung um 190 Beats: hart
  assert.equal(k.beat(100), 200);
  k.melde(200, 128, 200, false);                  // gestoppt
  assert.equal(k.beat(900), 200);
});
