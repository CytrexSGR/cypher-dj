// Tracker task 13: pure unrolling of effect commands (ADR 040). LPB 4, 6 ticks: a row is 0.25 beat, a tick 1/24 beat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rolleFxAus } from '../project/fx_ausrollen.ts';
import { fuerAusgerollteNoten } from '../project/playback.ts';

const TK = 1 / 24;
const rahmen = (o = {}) => ({ lpb: 4, ticks: 6, stufig: false, rollen: {}, ...o });
const note = (id, beat, laenge, ton, extra = {}) => ({ id, beat, laenge, ton, vel: 100, ...extra });
const clip = (noten, fx, extra = {}) => ({ id: 'c', art: 'midi', name: 'c', start_beat: 0, laenge_beats: 8, noten, ...(fx === undefined ? {} : { fx }), ...extra });
const e = (beat, code, wert, spalte = 0) => ({ beat, spalte, code, wert });
const lauf = (c, r) => { const calls = []; const aus = rolleFxAus(c, r, (id, beat, laenge, n) => calls.push({ id, beat, laenge, ton: n.ton })); return { calls, aus }; };
const nah = (ist, soll, text = '') => {
  assert.equal(ist.length, soll.length, `${text}: count ${JSON.stringify(ist)}`);
  ist.forEach((z, i) => z.forEach((v, j) => assert.ok(Math.abs(v - soll[i][j]) < 1e-9, `${text}: [${i}][${j}] ${v} vs ${soll[i][j]}`)));
};
const lang = [note('n1', 0, 4, 60)];
const rampe = (v0, d, von = 1, bis = 6) => { const l = []; for (let k = von; k <= bis; k++) l.push([1 + k * TK, v0 + k * d, 0]); return l; };

test('no fx: same calls as fuerAusgerollteNoten, empty lists', () => {
  for (const c of [clip(lang), clip(lang, []), clip([note('a', 0, 1, 60), note('b', 2, 9, 62)], undefined, { loop_beats: 4 })]) {
    const soll = []; fuerAusgerollteNoten(c, (id, beat, laenge, n) => soll.push({ id, beat, laenge, ton: n.ton }));
    const { calls, aus } = lauf(c, rahmen());
    assert.deepEqual(calls, soll);
    assert.deepEqual([aus.bend, aus.pegel, [...aus.regler], aus.pan], [[], [], [], []]);
  }
});

test('SLU: +xx/16 per tick, nothing on tick 0, held at the row end (stepped and smooth)', () => {
  const c = clip(lang, [e(1, 'SLU', 8)]);
  nah(lauf(c, rahmen({ stufig: true })).aus.bend, rampe(0, 0.5), 'stepped');   // 0.5 .. 3.0, the last jump at the row end
  nah(lauf(c, rahmen()).aus.bend, [[1, 3, 0.25]], 'smooth');
});

test('SLD: -xx/16 per tick', () => {
  const c = clip(lang, [e(1, 'SLD', 16)]);
  nah(lauf(c, rahmen({ stufig: true })).aus.bend, rampe(0, -1), 'stepped');
  nah(lauf(c, rahmen()).aus.bend, [[1, -6, 0.25]], 'smooth');
});

test('hold: the reached pitch stays until a new note, which resets (reset event at its start)', () => {
  const c = clip([note('n1', 0, 1.5, 60), note('n2', 2, 1, 60)], [e(1, 'SLU', 8)]);
  nah(lauf(c, rahmen()).aus.bend, [[1, 3, 0.25], [2, 0, 0]]);
});

test('ARP: +0, +x, +y per tick, always jumps (also smooth), back to the held pitch at the row end', () => {
  const c = clip(lang, [e(1, 'ARP', 0x37)]);
  const soll = [[1 + 1 * TK, 3, 0], [1 + 2 * TK, 7, 0], [1 + 3 * TK, 0, 0], [1 + 4 * TK, 3, 0], [1 + 5 * TK, 7, 0], [1.25, 0, 0]];
  nah(lauf(c, rahmen({ stufig: true })).aus.bend, soll, 'stepped');
  nah(lauf(c, rahmen()).aus.bend, soll, 'smooth');
});

test('VIB: x/64 cycle per tick, depth y/8 semitone, sine from phase 0', () => {
  const c = clip(lang, [e(1, 'VIB', 0x42)]);
  const s = (k) => (k >= 6 ? 0 : 0.25 * Math.sin(2 * Math.PI * k / 16));
  nah(lauf(c, rahmen({ stufig: true })).aus.bend, [1, 2, 3, 4, 5, 6].map((k) => [1 + k * TK, s(k), 0]), 'stepped');
  nah(lauf(c, rahmen()).aus.bend, [0, 1, 2, 3, 4, 5].map((k) => [1 + k * TK, s(k + 1), TK]).filter((z, i) => i > 0 || Math.abs(z[1]) > 1e-9), 'smooth: one glide of a tick per tick');
});

test('VIB 00 continues speed, depth and phase of the last VIB (D15)', () => {
  const c = clip(lang, [e(1, 'VIB', 0x42), e(1.25, 'VIB', 0)]);
  const { aus } = lauf(c, rahmen({ stufig: true }));
  const row2 = aus.bend.filter((z) => z[0] > 1.25 && z[0] < 1.5 - 1e-9);
  // phase after row 1 is 6 * 4/64 = 0.375 cycle; tick 0 of row 2 is already off zero: jump at the row start
  const s = (k) => 0.25 * Math.sin(2 * Math.PI * (0.375 + k * 4 / 64));
  nah(aus.bend.filter((z) => z[0] >= 1.25 - 1e-9 && z[0] < 1.5 - 1e-9), [[1.25, 0, 0], ...[0, 1, 2, 3, 4, 5].map((k) => [1.25 + k * TK, s(k), 0])], 'row end of row 1, then row 2');
  assert.equal(row2.length, 5);
});

test('a new note restarts the vibrato phase', () => {
  const c = clip([note('n1', 0, 1, 60), note('n2', 1, 1, 60)], [e(0.5, 'VIB', 0x42), e(1, 'VIB', 0)]);
  const { aus } = lauf(c, rahmen({ stufig: true }));
  const r2 = aus.bend.filter((z) => z[0] > 1 && z[0] < 1.25 - 1e-9);
  nah(r2, [1, 2, 3, 4, 5].map((k) => [1 + k * TK, 0.25 * Math.sin(2 * Math.PI * k / 16), 0]), 'phase 0 at the note');
});

test('GLD: the note does not start, the previous note is lengthened, pitch moves by xx/16 per tick and stops at the note', () => {
  const noten = [note('n1', 0, 1, 60), note('n2', 1, 1, 64)];
  let r = lauf(clip(noten, [e(1, 'GLD', 8)]), rahmen({ stufig: true }));
  assert.deepEqual(r.calls, [{ id: 'c/n1', beat: 0, laenge: 2, ton: 60 }]);
  nah(r.aus.bend, rampe(0, 0.5), 'slow: 3.0 reached of 4');
  r = lauf(clip(noten, [e(1, 'GLD', 16)]), rahmen({ stufig: true }));
  nah(r.aus.bend, rampe(0, 1, 1, 4), 'fast: stops at 4 on tick 4');
  r = lauf(clip(noten, [e(1, 'GLD', 16)]), rahmen());
  nah(r.aus.bend, [[1, 4, 4 * TK]], 'smooth: one event, glide until the target is reached');
  assert.equal(r.aus.pegel.length, 0);
});

test('GLD 00 continues the last speed toward the same note; a gap before the note keeps the note start', () => {
  const noten = [note('n1', 0, 1, 60), note('n2', 1, 1, 64)];
  const { aus } = lauf(clip(noten, [e(1, 'GLD', 8), e(1.25, 'GLD', 0)]), rahmen({ stufig: true }));
  nah(aus.bend.filter((z) => z[0] > 1.25), [[1.25 + TK, 3.5, 0], [1.25 + 2 * TK, 4, 0]], 'row 2');
  const luecke = lauf(clip([note('n1', 0, 0.5, 60), note('n2', 1, 1, 64)], [e(1, 'GLD', 8)]), rahmen());
  assert.equal(luecke.calls.length, 2, 'nothing sounds before the row: the note starts');
});

test('GLD chain: a later GLD lengthens the same note again', () => {
  const noten = [note('n1', 0, 1, 60), note('n2', 1, 1, 64), note('n3', 2, 1, 62)];
  const { calls, aus } = lauf(clip(noten, [e(1, 'GLD', 255), e(2, 'GLD', 255)]), rahmen());
  assert.deepEqual(calls, [{ id: 'c/n1', beat: 0, laenge: 3, ton: 60 }]);
  nah(aus.bend, [[1, 4, TK], [2, 2, TK]], 'up 4, then back down to 2');
});

test('TRM: depth y/16 of the level around the held level, speed as VIB', () => {
  const c = clip(lang, [e(0.75, 'LVL', 0x80), e(1, 'TRM', 0x42)]);
  const b = 128 / 255, s = (k) => (k >= 6 ? b : b + 0.125 * Math.sin(2 * Math.PI * k / 16));
  const { aus } = lauf(c, rahmen({ stufig: true }));
  nah(aus.pegel, [[0.75, b, 0], ...[1, 2, 3, 4, 5, 6].map((k) => [1 + k * TK, s(k), 0])], 'stepped');
  assert.equal(aus.bend.length, 0);
  const sm = lauf(c, rahmen()).aus.pegel;
  nah(sm, [[0.75, b, 0], ...[0, 1, 2, 3, 4, 5].map((k) => [1 + k * TK, s(k + 1), TK]).filter((z, i) => i > 0 || Math.abs(z[1] - b) > 1e-9)], 'smooth');
});

test('VSL: -y/64 or +x/64 of full level per tick, x wins, clamped 0..1', () => {
  nah(lauf(clip(lang, [e(1, 'VSL', 2)]), rahmen({ stufig: true })).aus.pegel, [1, 2, 3, 4, 5, 6].map((k) => [1 + k * TK, 1 - k / 32, 0]), 'down stepped');
  nah(lauf(clip(lang, [e(1, 'VSL', 2)]), rahmen()).aus.pegel, [[1, 1 - 6 / 32, 0.25]], 'down smooth');
  const b = 128 / 255;
  nah(lauf(clip(lang, [e(0.75, 'LVL', 0x80), e(1, 'VSL', 0x42)]), rahmen()).aus.pegel, [[0.75, b, 0], [1, b + 6 / 16, 0.25]], 'x wins');
  assert.equal(lauf(clip(lang, [e(1, 'VSL', 0x40)]), rahmen()).aus.pegel.length, 0, 'already at full level: clamped, no event');
  nah(lauf(clip(lang, [e(1, 'LVL', 0), e(1.25, 'VSL', 0x01)]), rahmen()).aus.pegel, [[1, 0, 0]], 'level 0 stays 0 under a slide down');
});

test('LVL: xx/255 from the row on, held until a new note', () => {
  const c = clip([note('n1', 0, 1, 60), note('n2', 2, 1, 60)], [e(1, 'LVL', 0x40)]);
  nah(lauf(c, rahmen()).aus.pegel, [[1, 64 / 255, 0], [2, 1, 0]]);
  nah(lauf(c, rahmen({ stufig: true })).aus.pegel, [[1, 64 / 255, 0], [2, 1, 0]]);
});

test('two commands on one row act together (GLD with VSL)', () => {
  const noten = [note('n1', 0, 1, 60), note('n2', 1, 1, 64)];
  const { aus } = lauf(clip(noten, [e(1, 'GLD', 16, 0), e(1, 'VSL', 2, 1)]), rahmen());
  nah(aus.bend, [[1, 4, 4 * TK]]);
  nah(aus.pegel, [[1, 1 - 6 / 32, 0.25]]);
});

test('RTG: the sounding note starts again every y ticks inside the row; the last piece keeps the old end', () => {
  const { calls, aus } = lauf(clip(lang, [e(1, 'RTG', 2)]), rahmen());
  assert.equal(calls.length, 3);
  nah(calls.map((x) => [x.beat, x.laenge]), [[0, 1 + 2 * TK], [1 + 2 * TK, 2 * TK], [1 + 4 * TK, 4 - 1 - 4 * TK]]);
  assert.deepEqual(calls.map((x) => x.id), ['c/n1', 'c/n1.r1', 'c/n1.r2']);
  assert.equal(aus.bend.length + aus.pegel.length, 0);
});

test('RTG 03 gives starts at tick 3 only (tick 6 is the row end)', () => {
  const { calls } = lauf(clip([note('n1', 1, 1, 60)], [e(1, 'RTG', 3)]), rahmen());
  nah(calls.map((x) => [x.beat, x.laenge]), [[1, 3 * TK], [1 + 3 * TK, 1 - 3 * TK]]);
});

test('PAN: (xx - 128) / 128, FF = 1, from the row on', () => {
  const { aus } = lauf(clip(lang, [e(1, 'PAN', 0), e(2, 'PAN', 0x80), e(3, 'PAN', 0xff), e(3.5, 'PAN', 0x40)]), rahmen());
  nah(aus.pan, [[1, -1], [2, 0], [3, 1], [3.5, -0.5]]);
});

test('OFS and REV: role points at the sounding start; ignored without the role; REV marks the other notes with 0', () => {
  const noten = [note('n1', 0, 1, 60), note('n2', 1, 1, 62, { versatz: 0 })];
  let r = lauf(clip(noten, [e(1, 'OFS', 0x40)]), rahmen({ rollen: { start: 7 } }));
  assert.deepEqual([...r.aus.regler], [[7, [[0, 0], [1, 0.25]]]], 'the note without OFS gets 0');
  r = lauf(clip(noten, [e(1, 'OFS', 0x40), e(1, 'REV', 1, 1)]), rahmen());
  assert.equal(r.aus.regler.size, 0);
  r = lauf(clip(noten, [e(1, 'REV', 1)]), rahmen({ rollen: { start: 7, rueckwaerts: 9 } }));
  assert.deepEqual([...r.aus.regler], [[9, [[0, 0], [1, 1]]]]);
  r = lauf(clip(noten, [e(1, 'OFS', 0xff)]), rahmen({ rollen: { start: 7, rueckwaerts: 9 } }));
  assert.deepEqual([...r.aus.regler], [[7, [[0, 0], [1, 255 / 256]]]], 'no REV in the clip: no reverse points');
});

test('OFS on the first of three notes only: later notes start at 0, not on the held knob', () => {
  const noten = [note('a', 0, 0.5, 60), note('b', 1, 0.5, 60), note('c', 2, 0.5, 60)];
  const { aus } = lauf(clip(noten, [e(0, 'OFS', 0x80)]), rahmen({ rollen: { start: 7 } }));
  assert.deepEqual([...aus.regler], [[7, [[0, 0.5], [1, 0], [2, 0]]]]);
});

test('OFS: a retrigger piece writes no point, the knob stays on the offset of its note', () => {
  const noten = [note('a', 0, 2, 60), note('b', 3, 0.5, 60)];
  const { calls, aus } = lauf(clip(noten, [e(0, 'OFS', 0x40), e(1, 'RTG', 2)]), rahmen({ rollen: { start: 7 } }));
  assert.equal(calls.length, 4, 'a, two retrigger pieces, b');
  assert.deepEqual([...aus.regler], [[7, [[0, 0.25], [3, 0]]]]);
});

test('a clip without any OFS writes no start points', () => {
  const { aus } = lauf(clip([note('a', 0, 0.5, 60), note('b', 1, 0.5, 60)], [e(1, 'PAN', 0x80)]), rahmen({ rollen: { start: 7 } }));
  assert.equal(aus.regler.size, 0);
});

// smooth VIB/TRM over several rows: every point lies on the sine, no hard jump at a row border, the last glide runs back to the unmodulated value
const phasePunkt = (z) => Math.round((z[0] + z[2]) / TK) * 4 / 64;   // phase (cycles) at the end of the glide, speed 4/64 per tick
test('VIB 48 over four rows, smooth: all points on the sine, no zero-length glide between rows, ends on 0', () => {
  const c = clip([note('n1', 0, 2, 60)], [0, 1, 2, 3].map((r) => e(r * 0.25, 'VIB', 0x48)));
  const bend = lauf(c, rahmen()).aus.bend;
  assert.ok(bend.length > 20);
  for (const z of bend) {
    assert.ok(z[2] > 0, `glide ${JSON.stringify(z)}`);
    assert.ok(Math.abs(z[1] - Math.sin(2 * Math.PI * phasePunkt(z))) < 1e-3, `on the sine ${JSON.stringify(z)}`);
  }
  assert.ok(Math.abs(bend[bend.length - 1][1]) < 1e-9);
  assert.ok(Math.abs(bend[bend.length - 1][0] + bend[bend.length - 1][2] - 1) < 1e-9, 'ends at the end of row 4');
});

test('VIB 48 then VIB 00 rows, smooth: the continuation is seamless as well', () => {
  const c = clip([note('n1', 0, 2, 60)], [e(0, 'VIB', 0x48), e(0.25, 'VIB', 0), e(0.5, 'VIB', 0)]);
  const bend = lauf(c, rahmen()).aus.bend;
  for (const z of bend.slice(0, -1)) { assert.ok(z[2] > 0); assert.ok(Math.abs(z[1] - Math.sin(2 * Math.PI * phasePunkt(z))) < 1e-3); }
  assert.ok(Math.abs(bend[bend.length - 1][1]) < 1e-9, 'the last glide runs back to 0 (the vibrato ends with row 3)');
});

test('TRM 44 over four rows, smooth: all points on the sine around the level, no jump between rows, ends on the level', () => {
  const c = clip([note('n1', 0, 2, 60)], [e(0, 'LVL', 0x80), ...[0, 1, 2, 3].map((r) => e(r * 0.25, 'TRM', 0x44))]);
  const pegel = lauf(c, rahmen()).aus.pegel;
  assert.ok(pegel.length > 20);
  assert.deepEqual(pegel[0].slice(1), [128 / 255, 0], 'the LVL jump');
  for (const z of pegel.slice(1)) {
    assert.ok(z[2] > 0, `glide ${JSON.stringify(z)}`);
    assert.ok(Math.abs(z[1] - (128 / 255 + 0.25 * Math.sin(2 * Math.PI * phasePunkt(z)))) < 1e-3, `on the sine ${JSON.stringify(z)}`);
  }
  assert.ok(Math.abs(pegel[pegel.length - 1][1] - 128 / 255) < 1e-9);
});

test('VIB with a gap row, smooth: the glide of the first row still runs back to 0', () => {
  const c = clip([note('n1', 0, 2, 60)], [e(0, 'VIB', 0x48), e(0.5, 'VIB', 0x48)]);
  const bend = lauf(c, rahmen()).aus.bend;
  const z = bend.filter((q) => q[0] + q[2] < 0.5 - 1e-9);
  assert.ok(Math.abs(z[z.length - 1][1]) < 1e-9);
});

test('Note.platz: slot role point (platz - 1) / 31 at the sounding start', () => {
  const c = clip([note('n1', 0, 1, 60, { platz: 3 }), note('n2', 1, 1, 60)], [e(1, 'PAN', 0x80)]);
  const { aus } = lauf(c, rahmen({ rollen: { slot: 5 } }));
  assert.deepEqual([...aus.regler], [[5, [[0, 2 / 31]]]]);
});

test('loop copies repeat the entries with beat < loop_beats; entries from loop_beats on are silent', () => {
  const c = clip([note('n1', 0, 1, 60)], [e(1, 'SLU', 8), e(5, 'SLD', 8)], { loop_beats: 4 });
  const { calls, aus } = lauf(c, rahmen());
  assert.deepEqual(calls.map((x) => [x.id, x.beat]), [['c~0/n1', 0], ['c~1/n1', 4]]);
  nah(aus.bend, [[1, 3, 0.25], [4, 0, 0], [5, 3, 0.25]]);
});

test('an entry at or past the clip end is silent', () => {
  const c = clip(lang, [e(1, 'SLU', 8), e(8, 'SLU', 8)]);
  nah(lauf(c, rahmen()).aus.bend, [[1, 3, 0.25]]);
});

test('ticks per row follow the frame: LPB 6, 4 ticks', () => {
  const c = clip(lang, [e(1, 'SLU', 16)]);
  nah(lauf(c, { lpb: 6, ticks: 4, stufig: true, rollen: {} }).aus.bend, [1, 2, 3, 4].map((k) => [1 + k / 24, k, 0]));
});

test('deterministic: the same input gives the same output', () => {
  const c = clip([note('n1', 0, 2, 60), note('n2', 2, 1, 65)], [e(1, 'VIB', 0x33), e(1, 'RTG', 2, 1), e(2, 'ARP', 0x47), e(3, 'PAN', 1)]);
  assert.deepEqual(lauf(c, rahmen()), lauf(c, rahmen()));
  assert.deepEqual(lauf(c, rahmen({ stufig: true })), lauf(c, rahmen({ stufig: true })));
});
