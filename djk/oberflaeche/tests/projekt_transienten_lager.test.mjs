// Slice 4, T9: Ablage der Transienten neben der .f32 des Dekodier-Caches
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findeTransienten, TransientenLager, TRANSIENTEN_VERSION, alsFloat32 } from '../projekt/transienten.ts';

const SR = 48000;
function stereo(mono) { const d = new Float32Array(mono.length * 2); for (let i = 0; i < mono.length; i++) { d[2 * i] = mono[i]; d[2 * i + 1] = mono[i]; } return d; }
function rauschen(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 31 - 1; }; }
function bursts(stellen, n) {
  const z = rauschen(7), m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = z() * 1e-4;
  for (const s of stellen) for (let j = 0; j < 0.03 * SR && s + j < n; j++) m[s + j] += z() * 0.8 * Math.exp(-j / (0.003 * SR));
  return m;
}
const ordner = (t) => { const o = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-lager-')); t.after(() => fs.rmSync(o, { recursive: true, force: true })); return o; };
const f32 = (o, sha, stellen, n = 72000) => fs.writeFileSync(path.join(o, `${sha}.f32`), Buffer.from(stereo(bursts(stellen, n)).buffer));

test('Lager: rechnet einmal, legt <sha>.transienten.json ab, liest sie danach (keine zweite Rechnung)', (t) => {
  const o = ordner(t); f32(o, 'aa', [24000, 48000]);
  let gerechnet = 0;
  const l = new TransientenLager(o, { rechne: (d, sr) => { gerechnet++; return findeTransienten(d, sr); } });
  assert.deepEqual(l.fuer('aa').map((s) => Math.round(s * 1000)), [500, 1000]);     // Quellsekunden, ±1 ms
  assert.equal(gerechnet, 1);
  assert.equal(l.fuer('aa').length, 2); assert.equal(gerechnet, 1, 'dasselbe Lager: aus dem Speicher');
  const l2 = new TransientenLager(o, { rechne: () => { gerechnet++; return []; } });
  assert.equal(l2.fuer('aa').length, 2);
  assert.equal(gerechnet, 1, 'neues Lager: aus der Datei');
  const j = JSON.parse(fs.readFileSync(path.join(o, 'aa.transienten.json'), 'utf8'));
  assert.equal(j.version, TRANSIENTEN_VERSION); assert.equal(j.sr, 48000); assert.equal(j.frames.length, 2);
});
test('Lager: andere Version wird neu gerechnet; fehlende .f32 ergibt null und wird nicht gemerkt', (t) => {
  const o = ordner(t); f32(o, 'aa', [24000]);
  fs.writeFileSync(path.join(o, 'aa.transienten.json'), JSON.stringify({ version: 0, sr: 48000, frames: [1, 2, 3] }));
  let gerechnet = 0;
  const l = new TransientenLager(o, { rechne: (d, sr) => { gerechnet++; return findeTransienten(d, sr); } });
  assert.equal(l.fuer('aa').length, 1); assert.equal(gerechnet, 1, 'Version 0 gilt nicht');
  assert.equal(l.fuer('bb'), null, 'keine .f32: null');
  f32(o, 'bb', [24000, 48000]);
  assert.equal(l.fuer('bb').length, 2, 'null wurde nicht gemerkt: nach dem Dekodieren gibt es die Liste');
  fs.writeFileSync(path.join(o, 'cc.f32'), '');
  assert.deepEqual(new TransientenLager(o).fuer('cc'), [], 'leere .f32: keine Transienten, kein Absturz');
});
test('Lager: beim Anlegen werden nur Reste *.transienten.json.*.tmp gelöscht', (t) => {
  const o = ordner(t);
  const rest = 'aa.transienten.json.123.tmp', bleibt = ['aa.transienten.json', 'aa.f32', `${'b'.repeat(64)}.99.teil`, 'x.tmp'];
  fs.writeFileSync(path.join(o, rest), 'x'); for (const b of bleibt) fs.writeFileSync(path.join(o, b), 'x');
  new TransientenLager(o);
  assert.equal(fs.existsSync(path.join(o, rest)), false);
  for (const b of bleibt) assert.ok(fs.existsSync(path.join(o, b)), b);
});

// ---- Fix-Runde Slice 4, Punkt 1 und 5: Speicher, Schreibfehler, Lücken des Lagers ----
test('alsFloat32: ausgerichtet ein View ohne Kopie (gleicher Speicher), schief eine Kopie mit denselben Werten; ein Rest unter 4 Byte fällt weg', () => {
  const roh = new ArrayBuffer(64), f = new Float32Array(roh); f.set([1, 2, 3, 4, 5, 6, 7, 8]);
  const ausger = Buffer.from(roh, 0, 30);                                   // 30 Byte: 7 Floats und 2 Byte Rest
  const v = alsFloat32(ausger);
  assert.equal(v.length, 7); assert.equal(v.buffer, roh, 'View auf denselben ArrayBuffer');
  f[0] = 99; assert.equal(v[0], 99, 'teilt den Speicher');
  const schief = Buffer.from(roh, 2, 32);                                   // byteOffset 2: kein Float32Array-View möglich
  assert.throws(() => new Float32Array(schief.buffer, schief.byteOffset, 8), RangeError, 'Voraussetzung: ein View wäre hier ein Fehler');
  const k = alsFloat32(schief);
  assert.equal(k.length, 8); assert.notEqual(k.buffer, roh, 'Kopie');
  const erwartet = new Float32Array(8); new Uint8Array(erwartet.buffer).set(new Uint8Array(roh, 2, 32));
  assert.deepEqual([...k], [...erwartet], 'gleiche Werte wie die Bytes ab Offset 2');
  assert.equal(alsFloat32(Buffer.alloc(0)).length, 0); assert.equal(alsFloat32(Buffer.alloc(3)).length, 0);
});
test('Lager: die .f32 wird ohne zweite Kopie gelesen (weder ArrayBuffer.slice noch Float32Array(TypedArray) über die Dateigröße)', (t) => {
  const o = ordner(t), n = 2_000_000, groesse = n * 8;                      // 16 MB
  fs.writeFileSync(path.join(o, 'aa.f32'), Buffer.alloc(groesse));
  // process.memoryUsage().arrayBuffers zählt ArrayBuffer.slice nicht verlässlich (gemessen: 48 MB gelesen und 48 MB kopiert ergeben 48), darum werden die Kopierwege selbst gezählt
  let kopiert = 0, laenge = null;
  const slice = ArrayBuffer.prototype.slice, F32 = globalThis.Float32Array;
  ArrayBuffer.prototype.slice = function (a, b) { const r = slice.call(this, a, b); kopiert += r.byteLength; return r; };
  globalThis.Float32Array = class extends F32 { constructor(...a) { super(...a); if (ArrayBuffer.isView(a[0])) kopiert += this.byteLength; } };
  try { new TransientenLager(o, { rechne: (d) => { laenge = d.length; return []; } }).fuer('aa'); }
  finally { ArrayBuffer.prototype.slice = slice; globalThis.Float32Array = F32; }
  assert.equal(laenge, n * 2);
  assert.ok(kopiert < groesse / 4, `${kopiert} Byte kopiert bei ${groesse} Byte Datei`);
});
test('Detektor: legt kein Array in Länge der Quelle an (nur Blockenergien und ein kleines Fenster)', () => {
  const d = stereo(bursts([24000, 60000], 120000)), grosse = [];
  const F32 = globalThis.Float32Array, F64 = globalThis.Float64Array;
  const merke = (K) => class extends K { constructor(...a) { super(...a); grosse.push(this.byteLength); } };
  globalThis.Float32Array = merke(F32); globalThis.Float64Array = merke(F64);
  try { assert.equal(findeTransienten(d, SR).length, 2); } finally { globalThis.Float32Array = F32; globalThis.Float64Array = F64; }
  const summe = grosse.reduce((a, b) => a + b, 0);
  assert.ok(summe <= d.byteLength / 16, `angelegte Typed Arrays zusammen ${summe} Byte bei ${d.byteLength} Byte Quelle (diff in voller Länge wären ${d.byteLength / 2})`);
});
test('Lager: schlägt das Schreiben fehl (schreibgeschützter Ordner), geht das Ergebnis nicht verloren, der Fehler geht an console.error, und es wird nicht erneut gerechnet', (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignoriert Schreibschutz');
  const o = ordner(t); f32(o, 'aa', [24000, 48000]);
  const meldungen = [], alt = console.error; console.error = (...a) => meldungen.push(a.join(' '));
  let gerechnet = 0, erg, nochmal;
  fs.chmodSync(o, 0o555);
  try {
    const l = new TransientenLager(o, { rechne: (d, sr) => { gerechnet++; return findeTransienten(d, sr); } });
    assert.doesNotThrow(() => { erg = l.fuer('aa'); });
    nochmal = l.fuer('aa');
  } finally { fs.chmodSync(o, 0o755); console.error = alt; }
  assert.deepEqual(erg.map((s) => Math.round(s * 1000)), [500, 1000], 'Ergebnis zurückgegeben');
  assert.equal(meldungen.length, 1, `console.error einmal: ${JSON.stringify(meldungen)}`); assert.match(meldungen[0], /transienten/i);
  assert.equal(fs.existsSync(path.join(o, 'aa.transienten.json')), false, 'nichts abgelegt');
  assert.equal(nochmal.length, 2); assert.equal(gerechnet, 1, 'gemerkt: kein zweites Rechnen');
  assert.equal(meldungen.length, 1, 'und keine zweite Meldung');
});
test('Lager: Ablage nach dem ersten Aufruf gelöscht, dasselbe Lager rechnet nicht noch einmal (Speicher-Merk)', (t) => {
  const o = ordner(t); f32(o, 'aa', [24000, 48000]);
  let gerechnet = 0;
  const l = new TransientenLager(o, { rechne: (d, sr) => { gerechnet++; return findeTransienten(d, sr); } });
  l.fuer('aa'); fs.rmSync(path.join(o, 'aa.transienten.json')); fs.rmSync(path.join(o, 'aa.f32'));
  assert.equal(l.fuer('aa').length, 2, 'aus dem Speicher, obwohl Datei und Quelle weg sind'); assert.equal(gerechnet, 1);
});
test('Lager: eine Ablage mit anderer Abtastrate (sr 44100) gilt nicht und wird neu gerechnet', (t) => {
  const o = ordner(t); f32(o, 'aa', [24000]);
  fs.writeFileSync(path.join(o, 'aa.transienten.json'), JSON.stringify({ version: TRANSIENTEN_VERSION, sr: 44100, frames: [1, 2, 3] }));
  let gerechnet = 0;
  const l = new TransientenLager(o, { rechne: (d, sr) => { gerechnet++; return findeTransienten(d, sr); } });
  assert.equal(l.fuer('aa').length, 1); assert.equal(gerechnet, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(o, 'aa.transienten.json'), 'utf8')).sr, 48000, 'neu abgelegt mit 48000');
});
