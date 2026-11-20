// Tracker stage 6, task 25: the ProTracker parser (project/mod_import.ts). Modules are built here by a small writer; no file from the internet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leseMod, MOD_PERIODEN, periodeZuTon, ModFehler, MOD_RATE, MOD_GRUND } from '../project/mod_import.ts';
import { pruefeProjekt, pruefeFehler } from '../project/model.ts';

import { bauMod, zelle } from './support/mod_writer.mjs';
// the writer lives in tests/support/mod_writer.mjs
const ton = (name) => {   // project naming: C-3 = 60
  const st = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return (Number(name.slice(-1)) + 2) * 12 + st[name[0]] + (name[1] === '#' ? 1 : 0);
};
const SMP = (n, o = {}) => ({ name: 'smp', bytes: Array.from({ length: n }, (_, i) => ((i * 7) % 200) - 100), vol: 64, ...o });
const P = { 'C-1': 856, 'C-2': 428, 'D-2': 381, 'E-2': 339, 'G-2': 285, 'C-3': 214 };
const alleClips = (p) => p.spuren.map((s) => s.clips);

// ---- pitch table --------------------------------------------------------------------------------------------------------------------
test('period table: 36 periods of finetune 0, 856 = PT C-1 = project C-2 (48), 428 = C-3 (60), 214 = C-4 (72)', () => {
  assert.equal(MOD_PERIODEN.length, 36);
  assert.equal(MOD_PERIODEN[0], 856); assert.equal(MOD_PERIODEN[12], 428); assert.equal(MOD_PERIODEN[24], 214); assert.equal(MOD_PERIODEN[35], 113);
  assert.equal(periodeZuTon(856), 48);
  assert.equal(periodeZuTon(428), 60);
  assert.equal(periodeZuTon(214), 72);
  assert.equal(periodeZuTon(113), 83);
  assert.equal(periodeZuTon(0), null);
  // every table entry maps to its own index; an off-table period (finetuned, extended range) maps to the nearest note
  MOD_PERIODEN.forEach((p, i) => assert.equal(periodeZuTon(p), 48 + i));
  assert.equal(periodeZuTon(850), 48);
  assert.equal(periodeZuTon(100), 85);
});

test('pitch of a sample: 8287 Hz at C-3 (60), grund = the frequency of MIDI 60', () => {
  assert.equal(MOD_RATE, 8287);
  assert.ok(Math.abs(MOD_GRUND - 261.6256) < 1e-3);
  // the player steps through the data at hz/grund * rate: at MIDI 60 the rate, one octave up the double
  assert.ok(Math.abs(440 * 2 ** ((60 - 69) / 12) - MOD_GRUND) < 1e-9);
  assert.equal(Math.round(3546895 / 428), MOD_RATE);   // PAL clock over period 428
});

// ---- the main case: order 0 1 0 2 ---------------------------------------------------------------------------------------------------
const VIER = () => bauMod({
  ordnung: [0, 1, 0, 2],
  samples: [SMP(400, { name: 'bass', vol: 64 }), SMP(300, { name: 'lead', vol: 32, fine: 0xe })],
  muster: [
    { 0: { 0: [P['C-2'], 1, 0, 0], 1: [P['E-2'], 2, 0, 0], 2: [P['G-2'], 1, 0, 0], 3: [P['C-3'], 2, 0, 0] }, 8: { 0: [P['D-2'], 0, 0, 0] } },
    { 0: { 0: [P['G-2'], 1, 0, 0] }, 4: { 0: [P['C-1'], 2, 0, 0] } },
    { 0: { 0: [P['E-2'], 1, 0, 0], 3: [P['C-2'], 2, 0, 0] } },
  ],
});

test('four channels, order 0 1 0 2: four sections, sections 1 and 3 linked per track, valid project', () => {
  const r = leseMod(VIER());
  assert.deepEqual(r.bericht.kanaele, 4);
  assert.equal(r.bericht.muster, 3);
  assert.equal(r.bericht.positionen, 4);
  assert.equal(r.bericht.samples, 2);
  assert.equal(r.projekt.tracker.abschnitte.length, 4);
  assert.deepEqual(r.projekt.tracker.abschnitte.map((a) => a.id), ['a1', 'a2', 'a3', 'a4']);
  assert.ok(r.projekt.tracker.abschnitte.every((a) => a.laenge_beats === 16));
  assert.equal(r.projekt.tracker.lpb, undefined);
  assert.equal(r.projekt.tracker.ticks, undefined);
  assert.equal(r.projekt.spuren.length, 4);
  const cl = alleClips(r.projekt);
  // channel 1 has notes in every section; the clips at 0 and 32 beats are pattern 0
  const c0 = cl[0];
  assert.deepEqual(c0.map((c) => c.start_beat), [0, 16, 32, 48]);
  assert.ok(c0[0].verbund !== undefined && c0[0].verbund === c0[2].verbund);
  assert.equal(c0[1].verbund, undefined);
  assert.equal(c0[3].verbund, undefined);
  assert.deepEqual(c0[0].noten, c0[2].noten);
  // channels 2..4 (pattern 1 only has channel 1 notes) link the same way
  [1, 3].forEach((i) => { assert.ok(cl[i][0].verbund !== undefined); assert.equal(cl[i][0].verbund, cl[i][1].verbund); });
  assert.notEqual(c0[0].verbund, cl[1][0].verbund);
  assert.equal(pruefeFehler(r.projekt), null);
  const roundtrip = pruefeProjekt(JSON.parse(JSON.stringify(r.projekt)));
  assert.ok('projekt' in roundtrip, JSON.stringify(roundtrip));
});

test('notes: the table of periods, the sample as platz, length to the next note, volume of the sample, project names', () => {
  const r = leseMod(VIER());
  const n = r.projekt.spuren[0].clips[0].noten;
  assert.deepEqual(n.map((x) => [x.beat, x.laenge, x.ton, x.platz, x.vel]), [
    [0, 2, ton('C-3'), 1, 127],       // row 0 to row 8 = 2 beats; C-2 of ProTracker is C-3 here; sample 1 has volume 64 -> 127
    [2, 14, ton('D-3'), 1, 127],
  ]);
  const c3 = r.projekt.spuren[3].clips[0].noten;   // channel 4: C-3 of ProTracker = C-4 here, sample 2 volume 32 -> 64
  assert.deepEqual(c3.map((x) => [x.ton, x.platz, x.vel]), [[ton('C-4'), 2, 64]]);
  assert.equal(c3[0].laenge, 16);
  const eins = r.projekt.spuren[0].clips[1].noten;   // pattern 1: G-2 then C-1 on sample number 2 (row 4)
  assert.deepEqual(eins.map((x) => [x.beat, x.ton, x.platz]), [[0, ton('G-3'), 1], [1, ton('C-2'), 2]]);
  const ids = new Set(r.projekt.spuren.flatMap((s) => s.clips.flatMap((c) => c.noten.map((x) => x.id))));
  assert.ok(ids.size >= 8);
});

test('tracks: one amiga track per channel, placeholder graph amiga, pans -1 +1 +1 -1', () => {
  const r = leseMod(VIER());
  assert.deepEqual(r.projekt.spuren.map((s) => [s.name, s.geraet.graph, s.pan, s.art]), [
    ['Ch 1', 'amiga', -1, 'instrument'], ['Ch 2', 'amiga', 1, 'instrument'], ['Ch 3', 'amiga', 1, 'instrument'], ['Ch 4', 'amiga', -1, 'instrument'],
  ]);
  assert.equal(r.projekt.tempo_bpm, 125);
  assert.equal(r.projekt.name, 'test song');
});

test('samples: signed 8 bit to float, mono duplicated to stereo, rate and grund, finetune to fein, loops, volume baked into notes', () => {
  const s = leseMod(VIER()).samples;
  assert.deepEqual(s.map((x) => x.nr), [1, 2]);
  assert.equal(s[0].name, 'bass');
  assert.ok(s[0].daten instanceof Float32Array);
  assert.equal(s[0].daten.length, 800);
  assert.equal(s[0].daten[0], -100 / 128); assert.equal(s[0].daten[1], -100 / 128);
  assert.equal(s[0].daten[2], -93 / 128); assert.equal(s[0].daten[3], -93 / 128);
  assert.equal(s[0].rate, MOD_RATE);
  assert.equal(s[0].grund, MOD_GRUND);
  assert.deepEqual([s[0].schleife, s[0].s_von, s[0].s_laenge, s[0].pegel, s[0].fein], [0, 0, 0, 1, 0]);
  assert.equal(s[1].fein, -2);          // finetune nibble 14
  assert.equal(s[1].pegel, 1);
});

test('loop points: start and length in words become frames; a loop length of one word is no loop; a loop past the end is cut', () => {
  const m = bauMod({
    samples: [SMP(1000, { loopStart: 100, loopLen: 200 }), SMP(1000, { loopStart: 0, loopLen: 1 }), SMP(1000, { loopStart: 450, loopLen: 300 }),
      SMP(1000, { loopStart: 600, loopLen: 20 })],
  });
  const s = leseMod(m).samples;
  assert.deepEqual([s[0].schleife, s[0].s_von, s[0].s_laenge], [1, 200, 400]);
  assert.deepEqual([s[1].schleife, s[1].s_von, s[1].s_laenge], [0, 0, 0]);
  assert.deepEqual([s[2].schleife, s[2].s_von, s[2].s_laenge], [1, 900, 100]);   // 900 + 600 would pass the end 1000: cut to 100
  assert.deepEqual([s[3].schleife, s[3].s_von, s[3].s_laenge], [0, 0, 0]);       // loop start 1200 is behind the data
});

// ---- effects ------------------------------------------------------------------------------------------------------------------------
const mitEffekt = (eff, par, opts = {}) => {
  const r = leseMod(bauMod({ samples: [SMP(2000)], muster: [{ 0: { 0: [opts.periode ?? P['C-2'], 1, 0, 0] }, 2: { 0: [opts.note2 ?? 0, 0, eff, par] } }], ...opts.mod }));
  return r;
};
const fxVon = (r) => r.projekt.spuren[0].clips[0].fx ?? [];
const eintrag = (r, code) => fxVon(r).filter((e) => e.code === code);

test('0xy becomes ARP, 5xy GLD 00 and VSL, 6xy VIB 00 and VSL; 000 and 100 do nothing', () => {
  assert.deepEqual(fxVon(mitEffekt(0, 0x37)), [{ beat: 0.5, spalte: 0, code: 'ARP', wert: 0x37 }]);
  assert.deepEqual(fxVon(mitEffekt(0, 0)), []);
  assert.deepEqual(fxVon(mitEffekt(1, 0)), []);
  assert.deepEqual(fxVon(mitEffekt(5, 0x04)), [{ beat: 0.5, spalte: 0, code: 'GLD', wert: 0 }, { beat: 0.5, spalte: 1, code: 'VSL', wert: 0x04 }]);
  assert.deepEqual(fxVon(mitEffekt(6, 0x40)), [{ beat: 0.5, spalte: 0, code: 'VIB', wert: 0 }, { beat: 0.5, spalte: 1, code: 'VSL', wert: 0x40 }]);
});

test('1xx SLU and 2xx SLD: period units become 1/16 semitones at the period of the sounding note (C-2 = 428)', () => {
  // 1 unit at 428: 12*log2(428/427) = 0.0405 semitone = 0.65/16 -> 1; 8 units: 12*log2(428/420) = 0.3 semitone = 4.8/16 -> 5
  assert.deepEqual(eintrag(mitEffekt(1, 8), 'SLU'), [{ beat: 0.5, spalte: 0, code: 'SLU', wert: 5 }]);
  assert.deepEqual(eintrag(mitEffekt(2, 8), 'SLD'), [{ beat: 0.5, spalte: 0, code: 'SLD', wert: 5 }]);
  assert.equal(eintrag(mitEffekt(1, 1), 'SLU')[0].wert, 1);
  // one octave up (214) the same unit is a bigger step
  assert.equal(eintrag(mitEffekt(1, 8, { periode: P['C-3'] }), 'SLU')[0].wert, 11);   // 12*log2(214/206) = 0.66 semitone = 10.55/16
});

test('3xx GLD: the speed in period units becomes 1/16 semitones, 300 continues (wert 0); the note of the row stays as the target', () => {
  const r = mitEffekt(3, 0x10, { note2: P['E-2'] });
  assert.equal(eintrag(r, 'GLD').length, 1);
  assert.equal(eintrag(r, 'GLD')[0].wert, 11);                 // 16 units at 428 (the pitch it starts from): 0.66 semitone = 10.55/16 -> 11
  assert.deepEqual(r.projekt.spuren[0].clips[0].noten.map((n) => n.beat), [0, 0.5]);
  assert.equal(eintrag(mitEffekt(3, 0, { note2: P['E-2'] }), 'GLD')[0].wert, 0);
});

test('4xy VIB: speed nibble as is, the depth in period units becomes an eighth semitone depth (nibble); 400 continues', () => {
  assert.equal(eintrag(mitEffekt(4, 0x44), 'VIB')[0].wert, 0x42);   // depth 4 = 7 period units at 428 = 0.28 semitone = 2.25/8 -> 2
  assert.equal(eintrag(mitEffekt(4, 0), 'VIB')[0].wert, 0);
  assert.equal(eintrag(mitEffekt(4, 0x80), 'VIB')[0].wert, 0x80);
});

test('7xy TRM as is, Axy VSL as is, 8xx PAN as is, E9y RTG 0y', () => {
  assert.deepEqual(eintrag(mitEffekt(7, 0x84), 'TRM'), [{ beat: 0.5, spalte: 0, code: 'TRM', wert: 0x84 }]);
  assert.deepEqual(eintrag(mitEffekt(0xa, 0x03), 'VSL'), [{ beat: 0.5, spalte: 0, code: 'VSL', wert: 0x03 }]);
  assert.deepEqual(eintrag(mitEffekt(0xa, 0), 'VSL'), []);
  assert.deepEqual(eintrag(mitEffekt(8, 0x00), 'PAN'), [{ beat: 0.5, spalte: 0, code: 'PAN', wert: 0 }]);
  assert.deepEqual(eintrag(mitEffekt(8, 0xff), 'PAN'), [{ beat: 0.5, spalte: 0, code: 'PAN', wert: 255 }]);
  assert.deepEqual(eintrag(mitEffekt(0xe, 0x93), 'RTG'), [{ beat: 0.5, spalte: 0, code: 'RTG', wert: 3 }]);
  assert.deepEqual(eintrag(mitEffekt(0xe, 0x90), 'RTG'), []);
});

test('9xx OFS: xx * 256 bytes as a fraction of the sample length in 1/256; only on a row with a note', () => {
  // sample of 2000 bytes: 0x04 * 256 = 1024 bytes = 0.512 of the sample = 131/256
  const r = mitEffekt(9, 0x04, { periode: P['C-2'], note2: P['E-2'] });
  assert.deepEqual(eintrag(r, 'OFS'), [{ beat: 0.5, spalte: 0, code: 'OFS', wert: 131 }]);
  const weit = mitEffekt(9, 0x20, { note2: P['E-2'] });   // 8192 bytes is past the end of 2000: the largest value
  assert.equal(eintrag(weit, 'OFS')[0].wert, 255);
  const ohne = mitEffekt(9, 0x04);
  assert.deepEqual(eintrag(ohne, 'OFS'), []);
  assert.equal(ohne.bericht.weggelassen.unbekannt['9xx without note'], 1);
  assert.deepEqual(eintrag(mitEffekt(9, 0, { note2: P['E-2'] }), 'OFS'), []);
});

test('Cxx: with a note it is the velocity, without a note LVL; volume above 64 counts as 64', () => {
  const r = mitEffekt(0xc, 0x20, { note2: P['E-2'] });
  assert.deepEqual(r.projekt.spuren[0].clips[0].noten.map((n) => n.vel), [127, 64]);
  assert.deepEqual(fxVon(r), []);
  const l = mitEffekt(0xc, 0x20);
  assert.deepEqual(eintrag(l, 'LVL'), [{ beat: 0.5, spalte: 0, code: 'LVL', wert: 128 }]);   // 32/64 of 255 = 127.5 -> 128
  assert.equal(eintrag(mitEffekt(0xc, 0x40), 'LVL')[0].wert, 255);
  assert.equal(eintrag(mitEffekt(0xc, 0x7f), 'LVL')[0].wert, 255);
  assert.equal(eintrag(mitEffekt(0xc, 0), 'LVL')[0].wert, 0);
  assert.equal(mitEffekt(0xc, 0, { note2: P['E-2'] }).projekt.spuren[0].clips[0].noten[1].vel, 1);
});

test('a running sample: a note without a sample number plays the last one of its channel; a sample number sets the sample volume again', () => {
  const m = bauMod({ samples: [SMP(500, { vol: 64 }), SMP(500, { vol: 16 })], muster: [{
    0: { 0: [P['C-2'], 2, 0, 0] }, 4: { 0: [P['E-2'], 0, 0, 0] }, 8: { 0: [P['G-2'], 0, 0xc, 0x30] }, 12: { 0: [P['C-3'], 0, 0, 0] },
  }] });
  const n = leseMod(m).projekt.spuren[0].clips[0].noten;
  assert.deepEqual(n.map((x) => [x.platz, x.vel]), [[2, 32], [2, 32], [2, 95], [2, 95]]);   // vol 16 -> 32; Cxx 48 -> 95 stays for the next note
});

test('Fxx on the first row: tempo (>= 32) sets the BPM, speed (< 32) sets the ticks; a later one is counted', () => {
  const m = bauMod({ samples: [SMP(100)], muster: [{ 0: { 0: [P['C-2'], 1, 0xf, 0x7d], 1: [0, 0, 0xf, 0x06] }, 8: { 0: [0, 0, 0xf, 0x90] }, 9: { 0: [0, 0, 0xf, 0x03] } }] });
  const r = leseMod(m);
  assert.equal(r.projekt.tempo_bpm, 125);
  assert.equal(r.projekt.tracker.ticks, undefined);                     // 6 is the default and is not written
  assert.equal(r.bericht.weggelassen.tempo_wechsel, 2);
  const m2 = bauMod({ samples: [SMP(100)], muster: [{ 0: { 0: [P['C-2'], 1, 0xf, 0x88], 2: [0, 0, 0xf, 0x04] } }] });
  const r2 = leseMod(m2);
  assert.equal(r2.projekt.tracker.ticks, 4);
  assert.equal(r2.projekt.tempo_bpm, 200);                             // 136 * 6 / 4 = 204, cut to the project limit 200 and counted
  assert.equal(r2.bericht.weggelassen.unbekannt['tempo outside 60..200'], 1);
  assert.equal(leseMod(bauMod({ muster: [{}] })).projekt.tempo_bpm, 125);   // none: the ProTracker default 125 and speed 6
});

test('speed 6 with tempo 150: BPM 150; speed 3 with tempo 100: ticks 3 and BPM 200 (rows twice as fast)', () => {
  assert.equal(leseMod(bauMod({ muster: [{ 0: { 0: [0, 0, 0xf, 150] } }] })).projekt.tempo_bpm, 150);
  const r = leseMod(bauMod({ muster: [{ 0: { 0: [0, 0, 0xf, 100], 1: [0, 0, 0xf, 3] } }] }));
  assert.equal(r.projekt.tracker.ticks, 3);
  assert.equal(r.projekt.tempo_bpm, 200);
});

test('Dxx shortens the section and the next one starts at the row; Bxx counts, E6x counts, other Exy are counted by kind', () => {
  const m = bauMod({
    ordnung: [0, 1, 2], samples: [SMP(500)],
    muster: [
      { 0: { 0: [P['C-2'], 1, 0, 0] }, 15: { 1: [0, 0, 0xd, 0x00] }, 20: { 0: [P['E-2'], 1, 0, 0] } },        // 16 rows, row 20 is never played
      { 0: { 0: [P['G-2'], 1, 0, 0] }, 3: { 0: [P['C-3'], 1, 0, 0] }, 10: { 2: [0, 0, 0xd, 0x31] } },        // starts at row 0, breaks after row 10 -> next row 31
      { 30: { 0: [P['D-2'], 1, 0, 0] }, 33: { 0: [P['E-2'], 1, 0, 0] }, 40: { 0: [0, 0, 0xe, 0x60], 1: [0, 0, 0xe, 0x62] }, 50: { 3: [0, 0, 0xb, 0x00] },
        51: { 0: [0, 0, 0xe, 0x60] } },
    ],
  });
  const r = leseMod(m);
  assert.deepEqual(r.projekt.tracker.abschnitte.map((a) => a.laenge_beats), [4, 11 / 4, 20 / 4]);   // rows 0..15, 0..10, 31..50 (B at 50)
  const c = r.projekt.spuren[0].clips;
  assert.deepEqual(c.map((x) => [x.start_beat, x.laenge_beats, x.noten.length]), [[0, 4, 1], [4, 2.75, 2], [6.75, 5, 1]]);
  assert.deepEqual(c[2].noten.map((x) => [x.beat, x.ton]), [[0.5, ton('E-3')]]);   // row 33 is 2 rows after the start row 31; row 30 was never played
  assert.equal(r.bericht.weggelassen.sprung, 1);
  assert.equal(r.bericht.weggelassen.muster_schleife, 2);
  assert.deepEqual(r.bericht.weggelassen.unbekannt, {});
  assert.equal(pruefeFehler(r.projekt), null);
});

test('a row after a break (Bxx, Dxx) is not read at all; the effects of E-commands are counted by kind', () => {
  const m = bauMod({ samples: [SMP(500)], muster: [{
    1: { 0: [0, 0, 0xe, 0xc2], 1: [0, 0, 0xe, 0xd1], 2: [0, 0, 0xe, 0x11], 3: [0, 0, 0xe, 0xa4] },
    2: { 0: [0, 0, 0xe, 0xc2], 1: [0, 0, 0xe, 0x50], 2: [0, 0, 0xf, 0x00] },
    3: { 0: [0, 0, 0xd, 0x01] }, 4: { 0: [0, 0, 0xe, 0xc2] },
  }] });
  const r = leseMod(m);
  assert.deepEqual(r.bericht.weggelassen.unbekannt, { EC: 2, ED: 1, E1: 1, EA: 1, E5: 1, F00: 1 });
  assert.equal(r.projekt.tracker.abschnitte[0].laenge_beats, 1);
});

test('a note on an empty sample or without any sample is dropped and counted; a period out of range is dropped', () => {
  const m = bauMod({ samples: [SMP(100)], muster: [{ 0: { 0: [P['C-2'], 0, 0, 0], 1: [P['C-2'], 2, 0, 0], 2: [1, 1, 0, 0], 3: [P['C-2'], 1, 0, 0] } }] });
  const r = leseMod(m);
  assert.deepEqual(r.projekt.spuren.map((s) => s.clips.length), [0, 0, 0, 1]);
  assert.equal(r.bericht.weggelassen.unbekannt['note without sample'], 1);
  assert.equal(r.bericht.weggelassen.unbekannt['note on empty sample'], 1);
  assert.equal(r.bericht.weggelassen.unbekannt['period out of range'], 1);
});

// ---- channels and signatures --------------------------------------------------------------------------------------------------------
test('signatures M.K., M!K!, FLT4, 4CHN give four channels', () => {
  for (const sig of ['M.K.', 'M!K!', 'FLT4', '4CHN']) {
    const r = leseMod(bauMod({ sig, muster: [{ 0: { 3: [P['C-2'], 1, 0, 0] } }], samples: [SMP(100)] }));
    assert.equal(r.bericht.kanaele, 4, sig);
    assert.equal(r.projekt.spuren.length, 4, sig);
  }
});

test('6CHN and 8CHN: six and eight tracks, pans -1 +1 +1 -1 -1 +1 (+1 -1)', () => {
  const m6 = leseMod(bauMod({ sig: '6CHN', kanaele: 6, muster: [{ 0: { 5: [P['C-2'], 1, 0, 0] } }], samples: [SMP(100)] }));
  assert.equal(m6.bericht.kanaele, 6);
  assert.deepEqual(m6.projekt.spuren.map((s) => s.pan), [-1, 1, 1, -1, -1, 1]);
  assert.equal(m6.projekt.spuren[5].clips[0].noten.length, 1);
  const m8 = leseMod(bauMod({ sig: '8CHN', kanaele: 8, muster: [{ 0: { 7: [P['E-2'], 1, 0, 0] } }], samples: [SMP(100)] }));
  assert.equal(m8.bericht.kanaele, 8);
  assert.deepEqual(m8.projekt.spuren.map((s) => s.pan), [-1, 1, 1, -1, -1, 1, 1, -1]);
  assert.equal(m8.projekt.spuren[7].clips[0].noten[0].ton, ton('E-3'));
  assert.equal(pruefeFehler(m8.projekt), null);
});

test('FLT8: the patterns hold two blocks of four channels', () => {
  const r = leseMod(bauMod({ sig: 'FLT8', flt8: true, ordnung: [0, 2], muster: [{ 0: { 1: [P['C-2'], 1, 0, 0], 6: [P['G-2'], 1, 0, 0] } }, { 0: { 5: [P['D-2'], 1, 0, 0] } }],
    samples: [SMP(100)] }));
  assert.equal(r.bericht.kanaele, 8);
  assert.equal(r.bericht.muster, 2);
  assert.equal(r.projekt.spuren[1].clips[0].noten[0].ton, ton('C-3'));
  assert.equal(r.projekt.spuren[6].clips[0].noten[0].ton, ton('G-3'));
  assert.equal(r.projekt.spuren[5].clips[0].start_beat, 16);
  assert.equal(r.projekt.spuren[5].clips[0].noten[0].ton, ton('D-3'));
  assert.equal(pruefeFehler(r.projekt), null);
});

// ---- refusals -----------------------------------------------------------------------------------------------------------------------
const abgelehnt = (bytes) => {
  try { leseMod(bytes); } catch (e) { return e; }
  return null;
};
test('a broken file is refused with mod_ungueltig and the byte offset, in English', () => {
  const kurz = abgelehnt(new Uint8Array(500));
  assert.ok(kurz instanceof ModFehler);
  assert.equal(kurz.grund, 'mod_ungueltig');
  assert.equal(kurz.offset, 500);
  assert.match(kurz.message, /^mod_ungueltig at byte 500: /);
  assert.match(kurz.message, /1084/);
  const sig = bauMod({ muster: [{}] }); sig.set([65, 66, 67, 68], 1080);
  const s = abgelehnt(sig);
  assert.equal(s.offset, 1080); assert.match(s.message, /signature/);
  const nl = bauMod({ muster: [{}], laenge: 0 });
  assert.equal(abgelehnt(nl).offset, 950);
  const nl2 = bauMod({ muster: [{}], laenge: 129 });
  assert.equal(abgelehnt(nl2).offset, 950);
  const gut = bauMod({ ordnung: [0, 3], muster: [{}], samples: [SMP(100)] });   // pattern 3 is not in the file
  assert.ok(abgelehnt(gut) instanceof ModFehler);
  const abgeschnitten = bauMod({ ordnung: [0, 1], muster: [{}, {}] }).slice(0, 1084 + 1024 + 500);
  const e = abgelehnt(abgeschnitten);
  assert.equal(e.grund, 'mod_ungueltig'); assert.equal(e.offset, 1084 + 1024 + 500); assert.match(e.message, /pattern/);
});

test('nothing throws uncontrolled: wrong types, empty input, random bytes all end in ModFehler or a result', () => {
  for (const x of [null, undefined, 'abc', 5, {}, new Uint8Array(0), new Uint8Array(1083), []]) {
    const e = abgelehnt(x);
    assert.ok(e instanceof ModFehler, String(x));
    assert.equal(e.grund, 'mod_ungueltig');
    assert.ok(Number.isInteger(e.offset));
  }
  let z = 12345;
  for (let k = 0; k < 40; k++) {
    const b = new Uint8Array(1084 + 1024 * 2 + 300);
    for (let i = 0; i < b.length; i++) { z = (z * 1103515245 + 12345) & 0x7fffffff; b[i] = z >> 16; }
    b.set([77, 46, 75, 46], 1080);   // M.K.
    b[950] = 1 + (k % 2);
    const e = abgelehnt(b);
    if (e) assert.ok(e instanceof ModFehler);
  }
});

test('a truncated last sample is accepted and padded with silence, and counted', () => {
  const full = bauMod({ muster: [{ 0: { 0: [P['C-2'], 1, 0, 0] } }], samples: [SMP(400)] });
  const r = leseMod(full.slice(0, full.length - 100));
  assert.equal(r.samples[0].daten.length, 800);
  assert.equal(r.samples[0].daten[799], 0);
  assert.equal(r.bericht.weggelassen.unbekannt['sample data truncated'], 1);
});
