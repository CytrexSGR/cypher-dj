import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findeTransienten } from '../projekt/transienten.ts';
import { beatsEinheiten } from '../projekt/warp.ts';
import { findeTransientenAlt } from './hilfen/transienten_referenz.mjs';

const SR = 48000;
function stereo(mono) { const d = new Float32Array(mono.length * 2); for (let i = 0; i < mono.length; i++) { d[2 * i] = mono[i]; d[2 * i + 1] = mono[i]; } return d; }
function rauschen(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 31 - 1; }; }
function bursts(stellen, n, { pegel = 0.8, abkl_ms = 3, boden = 1e-4 } = {}) {
  const z = rauschen(7), m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = z() * boden;
  for (const s of stellen) for (let j = 0; j < 0.03 * SR && s + j < n; j++) m[s + j] += z() * pegel * Math.exp(-j / (abkl_ms * SR / 1000));
  return m;
}

test('Klicks bei bekannter Lage: alle gefunden, je ≤ 48 Frames (1 ms) daneben, nichts extra', () => {
  const stellen = Array.from({ length: 32 }, (_, k) => 24000 + k * 11250 + ((k * 37) % 900) - 450);   // 128 BPM 1/8 mit Versatz bis ±9 ms
  const t = findeTransienten(stereo(bursts(stellen, 24000 + 33 * 11250)), SR);
  assert.equal(t.length, stellen.length);
  t.forEach((f, k) => assert.ok(Math.abs(f - stellen[k]) <= 48, `k=${k} f=${f} soll=${stellen[k]}`));
});
test('leise Schläge (−30 dB) zwischen lauten werden gefunden', () => {
  const laut = [24000, 48000, 72000], leise = [36000, 60000];
  const m = bursts(laut, 96000);
  const l2 = bursts(leise, 96000, { pegel: 0.025, boden: 0 });
  for (let i = 0; i < m.length; i++) m[i] += l2[i];
  assert.equal(findeTransienten(stereo(m), SR).length, 5);
});
test('Negativ-Kontrolle: Sinus 440 Hz und Stille ergeben 0', () => {
  const s = new Float32Array(96000).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / SR));
  assert.equal(findeTransienten(stereo(s), SR).length, 0);
  assert.equal(findeTransienten(new Float32Array(96000 * 2), SR).length, 0);
});
test('zwei Schläge näher als 20 ms zählen als einer (Fix T8: vorher 30 ms, verschluckte eng gesetzte Schläge)', () => {
  assert.equal(findeTransienten(stereo(bursts([24000, 24000 + 480], 72000)), SR).length, 1);
});
test('deterministisch: zweimal dieselbe Liste', () => {
  const d = stereo(bursts([24000, 50000], 80000));
  assert.deepEqual(findeTransienten(d, SR), findeTransienten(d, SR));
});

// ---- Fix T8 (Prüfung): NaN/Infinity, dicht gesetzte Schläge, Dauerton, Mutationslücken ----
const klicks3 = [24000, 48000, 72000];
test('NaN und Infinity vergiften die Rechnung nicht: nicht endliche Samples gelten als 0, danach werden alle Klicks gefunden', () => {
  for (const [name, stelle, wert] of [['NaN mittendrin', 36000, NaN], ['NaN vor den Klicks', 100, NaN], ['Infinity mittendrin', 36000, Infinity], ['-Infinity vor den Klicks', 100, -Infinity]]) {
    const m = bursts(klicks3, 96000); m[stelle] = wert;
    const t = findeTransienten(stereo(m), SR);
    assert.equal(t.length, 3, `${name}: ${JSON.stringify(t)}`);
    t.forEach((f, k) => assert.ok(Math.abs(f - klicks3[k]) <= 48, `${name} k=${k} f=${f}`));
  }
  const rechts = stereo(bursts(klicks3, 96000)); rechts[2 * 36000 + 1] = NaN;
  assert.equal(findeTransienten(rechts, SR).length, 3, 'NaN nur im rechten Kanal');
});
test('eng gesetzte Schläge: 21, 50 und 100 ms Abstand werden alle gefunden (ABSTAND_S ist 20 ms)', () => {
  const stellen = [24000, 24000 + 1000, 24000 + 1000 + 2400, 24000 + 1000 + 2400 + 4800];
  assert.equal(findeTransienten(stereo(bursts(stellen, 72000)), SR).length, 4);
});
function snareHat(n, snare, hat, { tailMs = 35, hatDb = -12 } = {}) {
  const z = rauschen(3), m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = z() * 1e-4;
  for (let j = 0; j < 0.3 * SR && snare + j < n; j++) m[snare + j] += z() * 0.8 * Math.exp(-j / (tailMs * SR / 1000)) + 0.5 * Math.sin(2 * Math.PI * 180 * j / SR) * Math.exp(-j / (0.04 * SR));
  const g = 0.8 * 10 ** (hatDb / 20);
  for (let j = 0; j < 0.05 * SR && hat + j < n; j++) m[hat + j] += z() * g * Math.exp(-j / (0.003 * SR));
  return m;
}
test('Hat mit −12 dB, 100 ms nach einer Snare mit langem Rauschausklang (35 ms), wird gefunden; die Snare auch', () => {
  const t = findeTransienten(stereo(snareHat(48000, 12000, 12000 + 4800)), SR);
  assert.equal(t.length, 2, JSON.stringify(t));
  assert.ok(Math.abs(t[1] - 16800) <= 96, `Hat bei ${t[1]}`);
  assert.equal(findeTransienten(stereo(snareHat(48000, 12000, 12000 + 4800, { tailMs: 25 })), SR).length, 2, 'Positivkontrolle: kürzerer Ausklang');
});
test('Dauerton mit Amplitudenpuls liefert keine Transienten (Fehlalarm an echtem Material: 11 Treffer je Sekunde)', () => {
  const z = rauschen(5);
  const ton = (treiber, rausch) => stereo(new Float32Array(96000).map((_, i) => 0.5 * (1 + Math.sin(2 * Math.PI * 4 * i / SR) / 3)
    * Math.tanh(treiber * Math.sin(2 * Math.PI * 60 * i / SR)) + z() * rausch));       // 60 Hz, 4 Hz AM mit ±6 dB Hub
  for (const [treiber, rausch] of [[1, 0], [4, 0], [8, 0.01]]) assert.equal(findeTransienten(ton(treiber, rausch), SR).length, 0, `treiber ${treiber}, rauschen ${rausch}`);
  const mitSchlag = ton(4, 0); for (let j = 0; j < 1440; j++) { mitSchlag[2 * (48000 + j)] += 0.3 * Math.exp(-j / 144) * (j % 2 ? 1 : -1); mitSchlag[2 * (48000 + j) + 1] = mitSchlag[2 * (48000 + j)]; }
  assert.equal(findeTransienten(mitSchlag, SR).length, 1, 'Positivkontrolle: ein Hochtonschlag auf dem Dauerton wird gefunden');
});
test('Schwelle: ein Schlag 14 dB über einem Rauschbett wird gefunden (SPRUNG_DB), ohne Schlag nichts', () => {
  const bett = (stellen) => { const z = rauschen(11), m = new Float32Array(96000); for (let i = 0; i < m.length; i++) m[i] = z() * 0.02;
    for (const s of stellen) for (let j = 0; j < 1440; j++) m[s + j] += z() * 0.1 * Math.exp(-j / 144); return stereo(m); };
  assert.equal(findeTransienten(bett([24000, 48000, 72000]), SR).length, 3);
  assert.equal(findeTransienten(bett([]), SR).length, 0);
});
// Fuß eines Anschlags, unabhängig vom Detektor gerechnet (Punkt 2 der Fix-Runde): der erste Frame, an dem die RMS-Hüllkurve (Fenster 1 ms, 48 Frames, zentriert)
// 10 % des Anstiegs über dem Grundpegel erreicht. Anstieg = Höchstwert der Hüllkurve bis `bis` minus Grundpegel (Hüllkurve bei `von`).
function fussFrame(m, von, bis) {
  const hue = (i) => { let s = 0; for (let k = i - 24; k < i + 24; k++) s += m[k] * m[k]; return Math.sqrt(s / 48); };
  const grund = hue(von); let hoch = 0;
  for (let i = von; i < bis; i++) hoch = Math.max(hoch, hue(i));
  for (let i = von; i < bis; i++) if (hue(i) >= grund + 0.1 * (hoch - grund)) return i;
  throw new Error('kein Fuß');
}
function langsamerSchlag(seed = 13) {
  const z = rauschen(seed), m = new Float32Array(48000);
  for (let i = 0; i < m.length; i++) m[i] = z() * 1e-4;
  for (let j = 0; j < 2400; j++) m[24000 + j] += z() * 0.8 * (j < 480 ? j / 480 : Math.exp(-(j - 480) / 144));
  return m;
}
// D14 verschärft die Grenze von 4 ms auf 0,25 ms: der Treffer ist jetzt selbst der Fuß (Rückwärtssuche bis 10 % des Anstiegs). Die frühere Fassung, die bis 4 ms dahinter lag:
// Ehrliche Formulierung (Fix-Runde, Punkt 2): der Detektor setzt seinen Treffer auf die Hälfte des Höchstwerts im Suchfenster (4 Blöcke), nicht an den Fuß des
// Anschlags. Bei einem langsamen Anschlag (10 ms Anstieg) liegt er darum hinter dem Fuß. Gemessen an echten Loops: im Median am Fuß, im p90 1,6 bis 4,2 ms
// dahinter (Entscheidung D12: BEATS beginnt deshalb 3 ms früher). Die Aussage ist "höchstens 4 ms (192 Frames) hinter dem Fuß und nicht vor dem Anstieg", sie
// hängt nicht an einem Band, das aus der Implementierung abgelesen wurde.
test('Lage: bei langsamem Anschlag (10 ms Anstieg) liegt der Treffer höchstens 0,25 ms hinter dem Fuß und nicht vor dem Anstieg (D14)', () => {
  const m = langsamerSchlag();
  const fuss = fussFrame(m, 23000, 24000 + 480 + 100);
  const [f] = findeTransienten(stereo(m), SR);
  assert.ok(fuss > 24000 && fuss < 24000 + 480, `Fuß ${fuss - 24000} Frames nach Beginn des Anstiegs liegt im Anstieg (Prüfung des Prüfwerts)`);
  assert.ok(f >= 24000, `Treffer ${f - 24000} Frames nach Beginn: nicht vor dem Anstieg`);
  assert.ok(f - fuss <= 12, `Treffer ${f - 24000}, Fuß ${fuss - 24000} Frames nach Beginn: höchstens 12 (0,25 ms) dahinter`);
});
test('Kanäle: ein Schlag nur im rechten Kanal und einer nur im linken werden gefunden', () => {
  const d = new Float32Array(96000 * 2), z = rauschen(17);
  for (let j = 0; j < 1440; j++) { d[2 * (24000 + j) + 1] = z() * 0.8 * Math.exp(-j / 144); d[2 * (60000 + j)] = z() * 0.8 * Math.exp(-j / 144); }
  assert.equal(findeTransienten(d, SR).length, 2);
});
test('Differenz: Hochtonschläge auf einem lauten Basston (60 Hz, 0,5) werden gefunden, weil die Differenz den Bass unterdrückt', () => {
  const z = rauschen(19), m = new Float32Array(96000);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * Math.sin(2 * Math.PI * 60 * i / SR);
  for (const s of [24000, 48000, 72000]) for (let j = 0; j < 1440; j++) m[s + j] += z() * 0.1 * Math.exp(-j / 144);
  assert.equal(findeTransienten(stereo(m), SR).length, 3);
});
test('Boden: Schläge unter −60 dB gelten nicht als Transienten (BODEN_DB)', () => {
  assert.equal(findeTransienten(stereo(bursts([24000, 48000, 72000], 96000, { pegel: 1e-4, boden: 1e-8 })), SR).length, 0);
  assert.equal(findeTransienten(stereo(bursts([24000, 48000, 72000], 96000, { pegel: 0.01, boden: 1e-8 })), SR).length, 3, 'Positivkontrolle: derselbe Aufbau, lauter');
});

// ---- Fix-Runde Slice 4, Punkt 5: Mutationen, die grün blieben ----
// Gemessen (scratchpad/scan.mjs, derselbe Aufbau, Spitzenpegel des Rauschens): Treffer erst ab 1,5e-3 mit BODEN_DB −60, ab 5e-3 mit −50, schon ab 5e-4 mit −70;
// mit Kanalmittel *1 statt *0,5 (alle Energien +6 dB) schon ab 8e-4. 1e-3 liegt knapp unter, 1,5e-3 knapp über der Grenze von −60 dB.
const boden = (pegel) => findeTransienten(stereo(bursts([24000, 48000, 72000], 96000, { pegel, boden: 1e-8 })), SR).length;
test('Boden: die Grenze liegt bei −60 dB, nicht bei −50 und nicht bei −70 (Pegel 1e-3 ergibt 0, 1,5e-3 ergibt 3)', () => {
  assert.equal(boden(1e-3), 0, 'knapp unter der Grenze: nichts (fängt BODEN_DB = −70 und das Kanalmittel *1)');
  assert.equal(boden(1.5e-3), 3, 'knapp darüber: alle drei (fängt BODEN_DB = −50)');
});
test('Kanalmittel: ein Schlag nur auf einem Kanal ist 6 dB leiser als derselbe auf beiden (Mittel statt Summe)', () => {
  const b = bursts([24000, 48000, 72000], 96000, { pegel: 1.5e-3, boden: 1e-8 });
  const eins = new Float32Array(192000); for (let i = 0; i < 96000; i++) eins[2 * i] = b[i];
  assert.equal(findeTransienten(eins, SR).length, 0, 'nur links: Mittel ergibt die halbe Differenz, −6 dB, unter dem Boden');
  assert.equal(findeTransienten(stereo(b), SR).length, 3, 'Positivkontrolle: derselbe Schlag auf beiden Kanälen');
});

// D14: findeTransientenAlt ist die Fassung vor D14 (Hit auf halber Höhe). Die neue Liste hat gleich viele Treffer, jeder liegt gleich oder höchstens 5 ms (240 Frames) früher.
const vorD14 = (neu, alt, name) => {
  assert.equal(neu.length, alt.length, `${name}: Trefferzahl`);
  neu.forEach((f, k) => assert.ok(f <= alt[k] && alt[k] - f <= 240, `${name}[${k}]: alt ${alt[k]}, neu ${f}`));
};
// ---- Fix-Runde Slice 4, Punkt 1: blockweise Rechnung ohne diff-Array, Ergebnis exakt wie die alte Fassung ----
test('D14 Trefferzahl: dieselbe Zahl wie die Fassung vor D14 (Referenz), jede Lage gleich oder bis 5 ms früher (alle Testsignale)', () => {
  const z = rauschen(5);
  const ton = (treiber, rausch) => stereo(new Float32Array(96000).map((_, i) => 0.5 * (1 + Math.sin(2 * Math.PI * 4 * i / SR) / 3) * Math.tanh(treiber * Math.sin(2 * Math.PI * 60 * i / SR)) + z() * rausch));
  const nanM = bursts([24000, 48000, 72000], 96000); nanM[36000] = NaN; nanM[100] = -Infinity;
  const bass = new Float32Array(96000).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 60 * i / SR));
  for (const s of [24000, 48000, 72000]) for (let j = 0; j < 1440; j++) bass[s + j] += z() * 0.1 * Math.exp(-j / 144);
  const nurRechts = new Float32Array(192000); { const b = bursts([24000, 60000], 96000); for (let i = 0; i < 96000; i++) nurRechts[2 * i + 1] = b[i]; }
  const faelle = {
    klicks: stereo(bursts(Array.from({ length: 32 }, (_, k) => 24000 + k * 11250 + ((k * 37) % 900) - 450), 24000 + 33 * 11250)),
    eng: stereo(bursts([24000, 25000, 27400, 32200], 72000)), zwei20ms: stereo(bursts([24000, 24480], 72000)), langsam: stereo(langsamerSchlag()),
    ton1: ton(1, 0), ton4: ton(4, 0), ton8: ton(8, 0.01), nan: stereo(nanM), bass: stereo(bass), nurRechts, stille: new Float32Array(192000),
    boden1: stereo(bursts([24000, 48000, 72000], 96000, { pegel: 1e-3, boden: 1e-8 })), boden2: stereo(bursts([24000, 48000, 72000], 96000, { pegel: 1.5e-3, boden: 1e-8 })),
    ungerade: stereo(bursts([24000, 48000], 72000)).subarray(0, 143999), kurz: new Float32Array(10), leer: new Float32Array(0),
    grenzen: stereo(bursts([60, 64 * 8, 64 * 8 + 3, 71936], 72000)),
  };
  let gesamt = 0;
  for (const [name, d] of Object.entries(faelle)) {
    const neu = findeTransienten(d, SR), alt = findeTransientenAlt(d, SR);
    vorD14(neu, alt, name); gesamt += alt.length;
  }
  assert.ok(gesamt > 40, `die Fälle enthalten Treffer (${gesamt}), die Gleichheit ist nicht leer`);
});
test('D14 Trefferzahl: echte Loops aus dem Dekodier-Cache (soweit vorhanden): dieselbe Zahl, Lagen höchstens 5 ms früher', (t) => {
  const ordner = path.join(os.homedir(), '.cache', 'cypherdj', 'arr', 'audio');
  let dateien = [];
  try { dateien = fs.readdirSync(ordner).filter((n) => /^(be6ae7f1|20440fb4|0b6a6f38|1eac3e41|a086bdfb)[0-9a-f]*\.f32$/.test(n)); } catch { /* kein Cache auf dieser Maschine */ }
  if (!dateien.length) return t.skip('kein Dekodier-Cache');
  let treffer = 0;
  for (const n of dateien) {
    const b = fs.readFileSync(path.join(ordner, n)), d = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
    const neu = findeTransienten(d, SR), alt = findeTransientenAlt(d, SR);
    vorD14(neu, alt, n); treffer += alt.length;
  }
  assert.ok(treffer > 20, `${dateien.length} Loops, ${treffer} Treffer`);
});

// ---- Fix-Runde Slice 4, Punkt 2 (D12): der Beginn der BEATS-Einheit liegt vor oder auf dem Fuß des Anschlags ----
test('D12: bei langsamem Anschlag beginnt die Einheit vor oder auf dem unabhängig gerechneten Fuß (der Treffer selbst liegt seit D14 höchstens 0,25 ms dahinter)', () => {
  const W125 = { an: true, modus: 'beats', marker: [[0, 0], [1.92, 4]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0 };
  for (const anstieg of [96, 480, 960]) {                                   // 2, 10 und 20 ms Anstieg
    const z = rauschen(13 + anstieg), m = new Float32Array(48000);
    for (let i = 0; i < m.length; i++) m[i] = z() * 1e-4;
    for (let j = 0; j < 2400; j++) m[24000 + j] += z() * 0.8 * (j < anstieg ? j / anstieg : Math.exp(-(j - anstieg) / 144));
    const fuss = fussFrame(m, 23000, 24000 + anstieg + 100);
    const treffer = findeTransienten(stereo(m), SR);
    assert.equal(treffer.length, 1, `Anstieg ${anstieg}: ein Treffer`);
    const e = beatsEinheiten(W125, 4, treffer.map((f) => f / SR));
    assert.equal(e.length, 2);
    const beginn = e[1][1] * SR;                                            // Quellframe, bei dem die Einheit beginnt
    assert.ok(beginn <= fuss + 1e-6, `Anstieg ${anstieg}: Einheit beginnt bei ${beginn - 24000}, Fuß bei ${fuss - 24000} Frames nach Beginn des Anstiegs`);
    const grenze = anstieg <= 96 ? 24 : 12;      // der unabhängige Fuß (RMS über 1 ms) sieht einen 2-ms-Anstieg schon 24 Frames früher: dort gilt die halbe Fensterbreite
    assert.ok(treffer[0] - fuss <= grenze && beginn < treffer[0], `Anstieg ${anstieg}: Treffer ${treffer[0] - 24000} höchstens ${grenze} Frames hinter dem Fuß ${fuss - 24000}, Einheit davor`);
  }
});

// ---- D14: der Treffer ist der Fuß des Anschlags ----
// Wahrheit analytisch: Rausch-Burst mit linearem Anstieg T ab Frame 24000; die Hüllkurve steigt linear, 10 % des Anstiegs sind bei 0,1 · T nach dem Beginn.
const rampe = (anstiegMs, stellen = [24000], n = 72000, seed = 21) => {
  const z = rauschen(seed), m = new Float32Array(n), T = Math.round(anstiegMs * 48);
  for (let i = 0; i < n; i++) m[i] = z() * 1e-4;
  for (const s of stellen) for (let j = 0; j < 1440; j++) m[s + j] += z() * 0.8 * (j < T ? j / T : Math.exp(-(j - T) / 144));
  return m;
};
test('D14: Burst mit 1, 2 und 4 ms linearem Anstieg: der Treffer liegt höchstens 0,25 ms (12 Frames) vom Fuß (10 % des Anstiegs)', () => {
  for (const ms of [1, 2, 4]) {
    const [f] = findeTransienten(stereo(rampe(ms)), SR), fuss = 24000 + 0.1 * ms * 48;
    assert.ok(Math.abs(f - fuss) <= 12, `Anstieg ${ms} ms: Treffer ${f - 24000}, Fuß ${fuss - 24000} Frames nach Beginn`);
  }
});
test('D14: ein Ein-Sample-Klick bleibt exakt auf seinem Frame (Negativkontrolle: der Fuß eines Klicks ist der Klick)', () => {
  const m = new Float32Array(48000); m[20000] = 0.8; m[30000] = 0.8; m[30001] = -0.8;
  assert.deepEqual(findeTransienten(stereo(m), SR), [20000, 30000]);
});
test('D14: zwei Schläge im Abstand von 25 ms: der Fuß des zweiten liegt nicht vor dem ersten Treffer, beide am Fuß', () => {
  const t = findeTransienten(stereo(rampe(2, [24000, 24000 + 1200])), SR);
  assert.equal(t.length, 2);
  assert.ok(t[1] > t[0], `streng steigend: ${t}`);
  assert.ok(Math.abs(t[1] - (25200 + 9.6)) <= 12 && Math.abs(t[0] - (24000 + 9.6)) <= 12, `Füße ${t[0] - 24000} und ${t[1] - 25200} Frames nach Beginn (Soll 9,6)`);
});
test('D14: das Suchfenster reicht höchstens 5 ms zurück (langsamer Anstieg über 20 ms: Treffer nie mehr als 240 Frames vor dem Hit der alten Lage)', () => {
  const alt = findeTransientenAlt(stereo(rampe(20)), SR)[0], neu = findeTransienten(stereo(rampe(20)), SR)[0];
  assert.ok(neu <= alt && alt - neu <= 240, `alt ${alt - 24000}, neu ${neu - 24000}`);
});
