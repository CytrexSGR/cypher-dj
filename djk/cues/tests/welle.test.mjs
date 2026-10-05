// Wellenform-Bänder: 60 Hz landet im tiefen Band, 8 kHz im hohen, 1 kHz in der Mitte; Stille überall null;
// dieselbe Aussage über den echten Weg (MP3 -> ffmpeg -> Bänder). Fehlerfall: unlesbare Datei, kein Cache-Rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Baender, RATE, RAHMEN, kodiere, dekodiereKopf, rechne, rechneUndCache, quantisiere, entquantisiere } from '../welle.ts';
import { mp3, tmpOrdner } from './hilfen.mjs';

function sinus(f, s = 2, a = 0.5) { const x = new Float32Array(RATE * s); for (let i = 0; i < x.length; i++) x[i] = f ? a * Math.sin(2 * Math.PI * f * i / RATE) : 0; return x; }

// mittlere RMS je Band nach dem Einschwingen (erste 0,2 s weg)
function mittel(w) {
  const s = [0, 0, 0]; let n = 0;
  for (let i = 20; i < w.rahmen; i++) { s[0] += w.werte[i * 6 + 1]; s[1] += w.werte[i * 6 + 3]; s[2] += w.werte[i * 6 + 5]; n++; }
  return s.map((x) => x / n);
}
function band(f) { const b = new Baender(); b.fuettere(sinus(f)); return mittel(b.ende()); }

test('Bänder direkt: 60 Hz tief, 8 kHz hoch, 1 kHz Mitte (jeweils > 20x die anderen)', () => {
  const [t60, m60, h60] = band(60);
  assert.ok(t60 > 0.3, `60 Hz tief ${t60}`); // Sinus a=0.5 hat RMS 0.354
  assert.ok(t60 > 20 * m60 && t60 > 20 * h60, `60 Hz: ${[t60, m60, h60]}`);
  const [t8k, m8k, h8k] = band(8000);
  assert.ok(h8k > 0.3 && h8k > 20 * t8k && h8k > 20 * m8k, `8 kHz: ${[t8k, m8k, h8k]}`);
  const [t1k, m1k, h1k] = band(1000);
  assert.ok(m1k > 0.25 && m1k > 5 * t1k && m1k > 5 * h1k, `1 kHz: ${[t1k, m1k, h1k]}`);
});

test('Negativ-Kontrolle: Stille ergibt null in allen Bändern, Rahmen = 10 ms', () => {
  const b = new Baender(); b.fuettere(sinus(0, 1)); const w = b.ende();
  assert.equal(w.rahmen, RATE / RAHMEN);
  assert.equal(RAHMEN / RATE, 0.01);
  assert.ok(w.werte.every((x) => x === 0));
});

test('Stückelung egal: in krummen Stücken gefüttert ergibt dasselbe wie am Stück', () => {
  const x = sinus(440, 1);
  const a = new Baender(); a.fuettere(x); const wa = a.ende();
  const b = new Baender(); for (let i = 0; i < x.length; i += 997) b.fuettere(x.subarray(i, i + 997)); const wb = b.ende();
  assert.equal(wa.rahmen, wb.rahmen);
  assert.deepEqual([...wa.werte], [...wb.werte]);
});

test('über MP3 und ffmpeg: 60-Hz-Ton tief, 8-kHz-Ton hoch; Dauer stimmt auf 50 ms', async (t) => {
  const d = tmpOrdner(t);
  const w60 = await rechne(mp3(path.join(d, '60.mp3'), { f: 60, dauer: 3 }));
  const [t60, m60, h60] = mittel(w60);
  assert.ok(t60 > 20 * m60 && t60 > 20 * h60, `60 Hz über MP3: ${[t60, m60, h60]}`);
  const w8k = await rechne(mp3(path.join(d, '8k.mp3'), { f: 8000, dauer: 3 }));
  const [t8k, m8k, h8k] = mittel(w8k);
  assert.ok(h8k > 20 * t8k && h8k > 20 * m8k, `8 kHz über MP3: ${[t8k, m8k, h8k]}`);
  assert.ok(Math.abs(w60.dauer_s - 3) < 0.05, `Dauer ${w60.dauer_s}`);
});

test('Kodierung: Kopf und Werte kommen zurück; sqrt-Verdichtung umkehrbar auf 1/255', () => {
  const b = new Baender(); b.fuettere(sinus(60, 1)); const w = b.ende();
  const k = kodiere(w);
  const h = dekodiereKopf(k);
  assert.equal(h.rahmen, w.rahmen); assert.equal(h.rate, RATE); assert.equal(h.rahmen_samples, RAHMEN);
  for (const x of [0, 0.001, 0.1, 0.5, 1]) assert.ok(Math.abs(Math.sqrt(entquantisiere(quantisiere(x))) - Math.sqrt(x)) <= 0.5 / 255 + 1e-9);
  assert.throws(() => dekodiereKopf(k.subarray(0, k.length - 1)), /unvollständig/);
  assert.throws(() => dekodiereKopf(Buffer.from('keine welle, nur text, 32 bytes lang!')), /keine Wellenform/);
});

test('Fehlerfall: kaputte oder fehlende Datei wirft, Cache-Ziel bleibt leer (keine halbe Datei)', async (t) => {
  const d = tmpOrdner(t);
  const kaputt = path.join(d, 'kaputt.mp3');
  fs.writeFileSync(kaputt, Buffer.alloc(5000, 7));
  const ziel = path.join(d, 'cache', 'x.welle');
  await assert.rejects(rechneUndCache(kaputt, ziel), /ffmpeg rc|keine Samples/);
  await assert.rejects(rechneUndCache(path.join(d, 'fehlt.mp3'), ziel), /Datei fehlt/);
  assert.equal(fs.existsSync(ziel), false);
  assert.deepEqual(fs.existsSync(path.join(d, 'cache')) ? fs.readdirSync(path.join(d, 'cache')) : [], []);
  // Gegenprobe: gültige Datei schreibt genau eine Datei
  await rechneUndCache(mp3(path.join(d, 'gut.mp3'), { f: 200, dauer: 1 }), ziel);
  assert.deepEqual(fs.readdirSync(path.join(d, 'cache')), ['x.welle']);
});
