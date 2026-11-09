// Calibration of check/rec5_measure.mjs (the instrument of abnahme_rec5, 1.8 T8): every function runs on synthetic data with a known answer, and each
// negative control must turn the measurement red (a wrong offset, a hanging tone, a missing note is not read as right).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RATE, noteOnStempel, noteLaengen, frischeFlanken, platziertAbw, urteilVersatz, versatzFinding, endePruefung, onsetsNach, tonAb, verdoppelt,
} from '../check/rec5_measure.mjs';

const on = (sample, ton, kanal = 0, vel = 100) => ({ sample, status: 0x90 | kanal, d1: ton, d2: vel });
const off = (sample, ton, kanal = 0) => ({ sample, status: 0x80 | kanal, d1: ton, d2: 0 });

test('noteOnStempel: only note ons with velocity > 0, in file order; a velocity-0 on is an off', () => {
  const e = [on(100, 60), off(200, 60), { sample: 250, status: 0xB0, d1: 1, d2: 5 }, on(300, 62), on(350, 62, 0, 0), on(400, 64, 1)];
  assert.deepEqual(noteOnStempel(e), [{ sample: 100, ton: 60 }, { sample: 300, ton: 62 }, { sample: 400, ton: 64 }]);
});

test('noteLaengen: pairs by pitch alone (the core file rule), reports the frames between on and off; an on without off has no end', () => {
  // the core closes an open pitch with a synthetic off (old channel) at the retrigger; the player's off on the other channel is dropped by the core
  const e = [on(100, 60), off(150, 60), on(150, 60, 1), off(12200, 60, 1), on(30000, 61)];
  assert.deepEqual(noteLaengen(e), [{ ton: 60, kanal: 0, ein: 100, aus: 150, laenge: 50 }, { ton: 60, kanal: 1, ein: 150, aus: 12200, laenge: 12050 }, { ton: 61, kanal: 0, ein: 30000, aus: null, laenge: null }]);
  // an off on another channel than the on closes the pitch too (the key is the pitch)
  assert.deepEqual(noteLaengen([on(10, 62), off(90, 62, 3)]), [{ ton: 62, kanal: 0, ein: 10, aus: 90, laenge: 80 }]);
});

test('frischeFlanken: unique values in order, -1 and values before the take start are dropped (a stale flank of an earlier run is not a pair)', () => {
  assert.deepEqual(frischeFlanken([-1, 500, 500, 9000, 9000, 9000, 20000, 20000], 1000), [9000, 20000]);
  assert.deepEqual(frischeFlanken([], 0), []);
  assert.deepEqual(frischeFlanken([-1, -1], 0), []);
});

test('platziertAbw: the placed note against the impulse in samples; midi.versatz_samples m shifts the note earlier by m, the impulse reference only holds the core delay', () => {
  const bpm = 120, startBeat = 0, startSample = 10000, vorhalt = 340, proSample = bpm / (60 * RATE);
  const flanke = 58000;                                   // the impulse
  const beatVon = (stempel, m) => Math.round((startBeat + (stempel - startSample - (vorhalt + m)) * proSample) * 1e9) / 1e9;
  // the core stamps the note 5 samples after the impulse flank, m = 0: the note lies 5 samples late
  assert.ok(Math.abs(platziertAbw(beatVon(flanke + 5, 0), flanke, { startBeat, bpm, startSample, vorhalt }) - 5) < 1e-3);
  // m = 5 brings it onto the impulse
  assert.ok(Math.abs(platziertAbw(beatVon(flanke + 5, 5), flanke, { startBeat, bpm, startSample, vorhalt })) < 1e-3);
  // a note stamped before the impulse is early (negative)
  assert.ok(Math.abs(platziertAbw(beatVon(flanke - 3, 0), flanke, { startBeat, bpm, startSample, vorhalt }) + 3) < 1e-3);
  // the same at another tempo
  assert.ok(Math.abs(platziertAbw(Math.round((2 + (flanke + 7 - startSample - vorhalt) * 90 / (60 * RATE)) * 1e9) / 1e9, flanke, { startBeat: 2, bpm: 90, startSample, vorhalt }) - 7) < 1e-3);
});

test('urteilVersatz: within +-2 is ok; a constant offset (spread <= 2) is a finding with its mean; scatter is FEHL', () => {
  assert.equal(urteilVersatz([0, 1, -1, 2, -2, 0]).art, 'ok');
  const f = urteilVersatz([37, 38, 37, 36, 37, 38, 37, 37]);
  assert.equal(f.art, 'finding');
  assert.equal(f.versatz, 37);
  assert.ok(Math.abs(f.mittel - 37.125) < 1e-9);
  assert.equal(urteilVersatz([0, 40, -30, 5]).art, 'fehl', 'scatter');
  assert.equal(urteilVersatz([]).art, 'fehl', 'no pair is no verdict');
  assert.equal(urteilVersatz([NaN, 1]).art, 'fehl', 'a missing value is never 0');
  // spread is max - min: 2 passes as a constant offset, 3 does not
  assert.equal(urteilVersatz([10, 12, 11]).art, 'finding');
  assert.equal(urteilVersatz([10, 13, 11]).art, 'fehl');
});

test('versatzFinding: an offset the field can hold (0..48000, integer) is written; a negative one is reported, not written', () => {
  assert.deepEqual(versatzFinding({ art: 'finding', mittel: 36.6, versatz: 37 }), { schreibe: 37 });
  assert.deepEqual(versatzFinding({ art: 'finding', mittel: -12.2, versatz: -12 }), { schreibe: null, grund: 'negative' });
  assert.deepEqual(versatzFinding({ art: 'finding', mittel: 60000, versatz: 60000 }), { schreibe: null, grund: 'too_large' });
  assert.deepEqual(versatzFinding({ art: 'ok', mittel: 0.5, versatz: 1 }), { schreibe: null, grund: 'none' });
});

const still = (n) => new Float32Array(n);
const ton = (n, von, bis, amp) => { const x = new Float32Array(n); for (let i = von; i < bis; i++) x[i] = amp * Math.sin(i * 0.3); return x; };

test('endePruefung: a tone that ends within 100 ms and stays below -90 dBFS passes; a hanging tone fails; a tone that stops too early is seen', () => {
  const n = 5 * RATE;
  const gut = ton(n, 1000, 3 * RATE, 0.2);                       // ends at 3 s
  const a = endePruefung(gut, { stopIdx: 3 * RATE });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.ok(a.letzteLaut >= 3 * RATE - 20 && a.letzteLaut < 3 * RATE);
  // a tail that decays within 50 ms after the stop (60 dB in 1200 samples) passes
  const aus = ton(n, 1000, 3 * RATE, 0.2);
  for (let i = 3 * RATE; i < 3 * RATE + 2400; i++) aus[i] = 0.2 * Math.sin(i * 0.3) * 10 ** (-(i - 3 * RATE) * 0.05 / 20);
  assert.equal(endePruefung(aus, { stopIdx: 3 * RATE }).ok, true);
  // the same tail at a stop that lies 2000 samples later is still ok; a tail of 300 ms (a note that rings on) is not
  const lang = ton(n, 1000, 3 * RATE + 14400, 0.2);
  const l2 = endePruefung(lang, { stopIdx: 3 * RATE });
  assert.equal(l2.ok, false);
  assert.match(l2.grund, /-90/);
  // hanging: the tone runs to the end of the recording
  const haengt = ton(n, 1000, n, 0.2);
  const h = endePruefung(haengt, { stopIdx: 3 * RATE });
  assert.equal(h.ok, false);
  assert.match(h.grund, /still sounding|hang/);
  // a tone with a quiet residue above -90 dBFS (-80) 400 ms after the stop
  const r2 = ton(n, 1000, 3 * RATE, 0.2);
  for (let i = 3 * RATE + 20000; i < 3 * RATE + 20100; i++) r2[i] = 1e-4;     // -80 dBFS, above -90
  const rr = endePruefung(r2, { stopIdx: 3 * RATE });
  assert.equal(rr.ok, false);
  assert.match(rr.grund, /-90/);
  // it never sounded: no verdict that counts (a silent recording is not a pass)
  const s = endePruefung(still(n), { stopIdx: 3 * RATE });
  assert.equal(s.ok, false);
  assert.match(s.grund, /never sounded|no tone/);
  // it stopped long before the stop of the transport: not "ends at the stop"
  const frueh = ton(n, 1000, RATE, 0.2);
  const f = endePruefung(frueh, { stopIdx: 3 * RATE });
  assert.equal(f.ok, false);
  assert.match(f.grund, /before the stop/);
});

const ersteLaute = (amp, thr, von) => { for (let i = von; i < von + 200; i++) if (Math.abs(amp * Math.sin(i * 0.3)) >= thr) return i; return -1; };
test('onsetsNach: a tone that starts after a quiet stretch is one onset; a tone that keeps going is not a new one; the threshold is absolute', () => {
  const n = 4 * RATE, thr = 10 ** (-60 / 20);
  const x = new Float32Array(n);
  for (const s of [10000, 100000, 190000]) for (let i = s; i < s + 12000; i++) x[i] = 0.05 * Math.sin(i * 0.3);
  assert.deepEqual(onsetsNach(x, thr), [10000, 100000, 190000].map((s) => ersteLaute(0.05, thr, s)));
  // below the threshold nothing counts
  assert.deepEqual(onsetsNach(new Float32Array(n).fill(1e-5), thr), []);
  // a tone that never stops is one onset
  assert.equal(onsetsNach(new Float32Array(n).fill(0.1), thr).length, 1);
});

test('tonAb: the delay of the first loud sample at or after a stamp, null when the tone is not there; the peak before the stamp tells whether it was quiet', () => {
  const x = new Float32Array(RATE);
  for (let i = 5000; i < 8000; i++) x[i] = 0.1 * Math.sin(i * 0.2);
  const a = tonAb(x, 0, 4000, 10 ** (-60 / 20));
  assert.equal(a.laut, true);
  assert.ok(a.verzug >= 1000 && a.verzug < 1010, `delay ${a.verzug}`);
  assert.ok(a.spitzeDavorDb < -100, 'quiet before');
  const b = tonAb(x, 0, 20000, 10 ** (-60 / 20), 2000);
  assert.equal(b.laut, false);
  // s0 shifts the index: a stamp in core samples
  const c = tonAb(x, 100000, 104000, 10 ** (-60 / 20));
  assert.equal(c.laut, true);
  // a note that is not quiet before it is reported (a note against a tone that already sounds)
  const y = new Float32Array(RATE).fill(0.1);
  assert.ok(tonAb(y, 0, 4000, 10 ** (-60 / 20)).spitzeDavorDb > -40);
});

test('verdoppelt: overdub adds the new notes, the first ids and their content stay; replace (the break) fails', () => {
  const alt = [{ id: 'n1', beat: 1, ton: 45 }, { id: 'n2', beat: 2, ton: 48 }];
  const neu = [...alt, { id: 'n3', beat: 1.1, ton: 45 }, { id: 'n4', beat: 2.1, ton: 48 }];
  assert.equal(verdoppelt(alt, neu, 2).ok, true);
  // replace: the old notes are gone, two fresh ones came (count is the same, ids differ)
  const ersetzt = [{ id: 'n3', beat: 1.1, ton: 45 }, { id: 'n4', beat: 2.1, ton: 48 }];
  const e = verdoppelt(alt, ersetzt, 2);
  assert.equal(e.ok, false);
  assert.match(e.grund, /count|first ids/);
  // right count but an old id changed
  const geaendert = [{ id: 'n1', beat: 1.5, ton: 45 }, alt[1], neu[2], neu[3]];
  assert.equal(verdoppelt(alt, geaendert, 2).ok, false);
  // ids reused
  const doppelt = [...alt, { id: 'n1', beat: 1.1, ton: 45 }, { id: 'n4', beat: 2.1, ton: 48 }];
  assert.equal(verdoppelt(alt, doppelt, 2).ok, false);
  // wrong number of added notes
  assert.equal(verdoppelt(alt, [...alt, neu[2]], 2).ok, false);
});
