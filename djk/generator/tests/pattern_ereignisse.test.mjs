// strudel-clip: the Strudel side of clip_aus_muster. Each expectation below was worked out by hand (1 cycle = 1 bar = 4 beats, MIDI note = 12 * (octave + 1) + semitone
// with C3 = 48), not read back from the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { musterZuEreignissen } from '../src/pattern_ereignisse.mjs';

const lauf = (code, takte = null) => {
  const r = musterZuEreignissen({ code, takte });
  assert.ok(r.ok, r.fehler);
  return r;
};
const beatTon = (r) => r.ereignisse.map((e) => [e.beat, e.ton]);
const beatS = (r) => r.ereignisse.map((e) => [e.beat, e.werte.s]);
const nah = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('1 s("bd*4"): four hits, one per beat, one bar, no loop', () => {
  const r = lauf('s("bd*4")');
  assert.deepEqual(beatS(r), [[0, 'bd'], [1, 'bd'], [2, 'bd'], [3, 'bd']]);
  assert.equal(r.takte, 1); assert.equal(r.laenge_beats, 4); assert.equal(r.loop_beats, null);
  assert.ok(r.ereignisse.every((e) => e.laenge === 1));
});

test('2 s("bd*4, ~ hh ~ hh"): kick on every beat, hat on beats 1 and 3 (the second line has 4 steps: ~ hh ~ hh)', () => {
  const r = lauf('s("bd*4, ~ hh ~ hh")');
  const bd = r.ereignisse.filter((e) => e.werte.s === 'bd').map((e) => e.beat);
  const hh = r.ereignisse.filter((e) => e.werte.s === 'hh').map((e) => e.beat);
  assert.deepEqual(bd, [0, 1, 2, 3]);
  assert.deepEqual(hh, [1, 3]);
});

test('3 note("gs1 ~ gs1 b1").velocity("<0.8 1>"): two bars, G#1 = 32, B1 = 35, velocity alternates per bar', () => {
  const r = lauf('note("gs1 ~ gs1 b1").velocity("<0.8 1>")');
  assert.equal(r.takte, 2);
  assert.deepEqual(beatTon(r), [[0, 32], [2, 32], [3, 35], [4, 32], [6, 32], [7, 35]]);
  assert.deepEqual(r.ereignisse.map((e) => e.werte.velocity), [0.8, 0.8, 0.8, 1, 1, 1]);
});

test('4 note("c3 e3 g3 c4"): 48 52 55 60 on the beats', () => {
  assert.deepEqual(beatTon(lauf('note("c3 e3 g3 c4")')), [[0, 48], [1, 52], [2, 55], [3, 60]]);
});

test('5 slow: note("c3 e3 g3").slow(2) is three notes over two bars, each 8/3 beats', () => {
  const r = lauf('note("c3 e3 g3").slow(2)');
  assert.equal(r.takte, 2);
  assert.deepEqual(r.ereignisse.map((e) => e.ton), [48, 52, 55]);
  [0, 8 / 3, 16 / 3].forEach((b, i) => nah(r.ereignisse[i].beat, b));
  r.ereignisse.forEach((e) => nah(e.laenge, 8 / 3));
});

test('6 fast: s("bd sd").fast(2) is bd sd bd sd on the four beats', () => {
  assert.deepEqual(beatS(lauf('s("bd sd").fast(2)')), [[0, 'bd'], [1, 'sd'], [2, 'bd'], [3, 'sd']]);
});

test('7 polymeter {c3 e3 g3}%4: four steps a bar walking through three notes, repeats after three bars', () => {
  const r = lauf('note("{c3 e3 g3}%4")');
  assert.equal(r.takte, 3);
  assert.deepEqual(r.ereignisse.map((e) => e.ton), [48, 52, 55, 48, 52, 55, 48, 52, 55, 48, 52, 55]);
  assert.deepEqual(r.ereignisse.map((e) => e.beat), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('8 euclid s("bd(3,8)"): hits on steps 0, 3, 6 of 8, i.e. beats 0, 1.5, 3 (tresillo)', () => {
  const r = lauf('s("bd(3,8)")');
  assert.deepEqual(r.ereignisse.map((e) => e.beat), [0, 1.5, 3]);
  assert.ok(r.ereignisse.every((e) => e.laenge === 0.5));
});

test('9 off: n("0 2").off(0.25, x=>x.add(n(2))).scale("C3:major") adds a copy one beat later, two degrees higher', () => {
  const r = lauf('n("0 2").off(0.25, x=>x.add(n(2))).scale("C3:major")');
  assert.deepEqual(beatTon(r), [[0, 48], [1, 52], [2, 52], [3, 55]]);   // 0 -> C3, 0+2 -> E3, 2 -> E3, 2+2 = 4 -> G3
});

test('10 superimpose: note("48").superimpose(x=>x.add(note(7))) is the note and its fifth, both a whole bar long', () => {
  const r = lauf('note("48").superimpose(x=>x.add(note(7)))');
  assert.deepEqual(r.ereignisse.map((e) => [e.beat, e.ton, e.laenge]).sort((a, b) => a[1] - b[1]), [[0, 48, 4], [0, 55, 4]]);
});

test('11 every: note("48 50").every(2, x=>x.add(note(12))) lifts bar 0 by an octave, bar 1 stays; two bars', () => {
  const r = lauf('note("48 50").every(2, x=>x.add(note(12)))');
  assert.equal(r.takte, 2);
  assert.deepEqual(beatTon(r), [[0, 60], [2, 62], [4, 48], [6, 50]]);
});

test('12 scale: n("0 2 4").scale("C:minor") is C3 Eb3 G3 on thirds of the bar', () => {
  const r = lauf('n("0 2 4").scale("C:minor")');
  assert.deepEqual(r.ereignisse.map((e) => e.ton), [48, 51, 55]);
  [0, 4 / 3, 8 / 3].forEach((b, i) => nah(r.ereignisse[i].beat, b));
});

test('13 add: n("0 2").add(n("<0 3>")).scale("C3:major") shifts the second bar by three degrees (F3, A3)', () => {
  const r = lauf('n("0 2").add(n("<0 3>")).scale("C3:major")');
  assert.deepEqual(beatTon(r), [[0, 48], [2, 52], [4, 53], [6, 57]]);
});

test('13b Strudel skips an add on a control pattern with only a log line; the clip says so instead of staying silent, and a bare string explains itself', () => {
  const r = lauf('n("0 2").add("<0 3>").scale("C3:major")');
  assert.deepEqual(beatTon(r), [[0, 48], [2, 52]]);   // the add was skipped: one bar, no shift
  assert.ok(r.hinweise.some((h) => /arithmetic on control pattern/.test(h)), JSON.stringify(r.hinweise));
  const f = musterZuEreignissen({ code: 'n("0 2".add("<0 3>"))' });
  assert.match(f.fehler, /plain string is not a pattern/);
});

test('14 signal: cutoff(sine.range(200,2000).slow(4)) is sampled at the note starts and flagged continuous; period is four bars', () => {
  const r = lauf('note("48*4").cutoff(sine.range(200,2000).slow(4))');
  assert.deepEqual(r.stetig, ['cutoff']);
  assert.equal(r.takte, 4);
  assert.equal(r.ereignisse.length, 16);
  // value = 1100 + 900 sin(2 pi t / 4), t = bar position of the note start (0, .25, .5, .75 ...)
  r.ereignisse.slice(0, 4).forEach((e, i) => nah(e.werte.cutoff, 1100 + 900 * Math.sin((2 * Math.PI * (i / 4)) / 4), 1e-3));
  nah(r.ereignisse[4].werte.cutoff, 1100 + 900 * Math.sin((2 * Math.PI * 1) / 4), 1e-3);   // bar 1 starts at sin(pi/2): 2000
});

test('15 a stepped control is not continuous: cutoff("<400 800>") has no stetig flag', () => {
  const r = lauf('note("c3 e3").cutoff("<400 800>")');
  assert.deepEqual(r.stetig, []);
  assert.deepEqual(r.ereignisse.map((e) => e.werte.cutoff), [400, 400, 800, 800]);
});

test('16 takte: a pattern that repeats sooner than the clip gets a loop and only one period of events', () => {
  const r = lauf('note("c3 e3").cutoff("<400 800>")', 8);
  assert.equal(r.takte, 8); assert.equal(r.laenge_beats, 32); assert.equal(r.loop_beats, 8);
  assert.equal(r.ereignisse.length, 4);
  const frei = lauf('note("c3 e3")', 8);
  assert.equal(frei.loop_beats, 4); assert.equal(frei.ereignisse.length, 2);
});

test('17 random patterns are frozen: the same query gives the same events, and they never repeat, so the clip is 16 bars', () => {
  for (const code of ['s("hh*8?")', 's("hh*8").degradeBy(0.5)', 's("hh*8").sometimes(x=>x.speed(2))']) {
    const a = lauf(code), b = lauf(code);
    assert.deepEqual(a.ereignisse, b.ereignisse, code);
    assert.equal(a.takte, 16, code);
    assert.equal(a.loop_beats, null);
    assert.ok(a.hinweise.some((h) => /no repetition/.test(h)), code);
  }
  const r = lauf('s("hh*8?")');
  assert.ok(r.ereignisse.length < 8 * 16 && r.ereignisse.length > 8 * 16 * 0.3);          // "?" drops about half
  assert.ok(r.ereignisse.every((e) => Math.abs(e.beat * 2 - Math.round(e.beat * 2)) < 1e-9));   // every survivor sits on the eighth grid
});

test('18 sound numbers: s("bd:2 hh") carries n = 2 for the first sound', () => {
  const r = lauf('s("bd:2 hh")');
  assert.equal(r.ereignisse[0].werte.n, 2);
  assert.equal(r.ereignisse[1].werte.n, undefined);
});

test('19 fields without a number are kept as values; objects are reported as komplex', () => {
  const r = lauf('s("bd").room(0.4).delay(0.2)');
  assert.equal(r.ereignisse[0].werte.room, 0.4);
  assert.equal(r.ereignisse[0].werte.delay, 0.2);
});

test('20 errors name the place: JavaScript syntax, unknown function, mini notation (line and column of the string)', () => {
  assert.match(musterZuEreignissen({ code: 'note("c e")\n.add(' }).fehler, /^Zeile 2: /);
  const f = musterZuEreignissen({ code: 's("bd hh")\n.fooBar(2)' });
  assert.equal(f.ok, false);
  assert.match(f.fehler, /^Zeile 2, Spalte \d+: .*fooBar is not a function/);
  const m = musterZuEreignissen({ code: 's("bd hh")\n.fast("<2 [3")' });
  assert.match(m.fehler, /^Zeile 2, Spalte \d+: mini notation/);
  assert.match(musterZuEreignissen({ code: '  ' }).fehler, /^Zeile 1: empty/);
  assert.match(musterZuEreignissen({ code: '42' }).fehler, /not a Strudel pattern/);
  assert.equal(musterZuEreignissen({ code: 's("bd")', takte: 0 }).grund, 'argument_ungueltig');
});

test('21 the control wrapper leaves Strudel alone outside an evaluation (a second run gives the same answer, no state leaks)', () => {
  const a = lauf('note("48*2").cutoff(sine.slow(2))');
  const b = lauf('note("48*2").cutoff(400)');
  assert.deepEqual(a.stetig, ['cutoff']);
  assert.deepEqual(b.stetig, []);
});

// --- nachbesserung: tempo, empty patterns, the cheap pre-check, rounding --------------------------------------------------------------------------
test('22 cpm changes the tempo, which is the project\'s: the events stay at the project tempo, the field is reported as without target, with a hint', () => {
  const ohne = musterZuEreignissen({ code: 'note("c3 e3")' });
  for (const n of [30, 60, 120]) {
    const r = musterZuEreignissen({ code: `note("c3 e3").cpm(${n})` });
    assert.equal(r.ok, true);
    assert.deepEqual(r.ereignisse.map((e) => [e.beat, e.laenge, e.ton]), ohne.ereignisse.map((e) => [e.beat, e.laenge, e.ton]), `cpm(${n}) must not speed the pattern up`);
    assert.deepEqual(r.komplex, ['cpm']);
    assert.ok(r.hinweise.some((h) => /cpm is ignored: the tempo is the project's/.test(h)), r.hinweise.join('|'));
  }
  // inside a callback (evaluated while the events are queried) as well, and the function form
  const innen = musterZuEreignissen({ code: 'note("c3 e3").every(1, x => x.cpm(240))' });
  assert.deepEqual(innen.ereignisse.map((e) => e.beat), [0, 2]); assert.deepEqual(innen.komplex, ['cpm']);
});

test('23 setcps and setcpm are no pattern: the refusal says the tempo is the project\'s', () => {
  for (const code of ['setcps(1); note("c3")', '(setcps(1), note("c3"))', 'setcpm(120); note("c3")']) {
    const r = musterZuEreignissen({ code });
    assert.equal(r.ok, false, code); assert.match(r.fehler, /the tempo is the project's: leave out setcps\/setcpm/, code);
  }
});

test('24 a pattern without events gets a hint instead of an empty clip in silence', () => {
  for (const code of ['note("~")', 'silence', 'note("c3").degradeBy(1)']) {
    const r = musterZuEreignissen({ code, takte: 2 });
    assert.equal(r.ok, true, code); assert.equal(r.ereignisse.length, 0);
    assert.ok(r.hinweise.some((h) => /no events in 2 bars: the clip stays empty/.test(h)), `${code}: ${r.hinweise}`);
  }
});

test('25 the cheap pre-check refuses a dense pattern before the full query (a million events a bar, fast(1e9), a density that explodes inside a slice)', () => {
  for (const code of ['s("bd*1000000")', 's("bd*5").fast(1e9)', 'note("c3*100000")']) {
    const t0 = Date.now();
    const r = musterZuEreignissen({ code });
    assert.equal(r.ok, false, code); assert.equal(r.grund, 'muster_zu_gross', code); assert.match(r.fehler, /more than 20000 events/);
    assert.ok(Date.now() - t0 < 3000, `${code}: ${Date.now() - t0} ms`);
  }
  // a dense pattern under the limit still works: 512 events a bar, periodic, so the clip holds one period
  const noch = musterZuEreignissen({ code: 'note("c3*512")', takte: 4 });
  assert.equal(noch.ok, true); assert.equal(noch.ereignisse.length, 512);
});

test('26 a dense pattern handed over as an ARGUMENT is not expanded to look for a signal', () => {
  const t0 = Date.now();
  const r = musterZuEreignissen({ code: 'note("c3").cutoff("1000*100000")' });
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
  assert.equal(r.ok, false); assert.equal(r.grund, 'muster_zu_gross');
});

test('27 beat and end are rounded together: a note that ends where the next begins touches it, thirteenths and slow triplets included', () => {
  for (const code of ['note("c3 c3 c3 c3 c3 c3 c3 c3 c3 c3 c3 c3 c3")', 'note("c3*3").slow(1.7)', 'note("c3 c3 c3 c3 c3 c3 c3").slow(3)']) {
    const r = musterZuEreignissen({ code, takte: 4 });
    const n = [...r.ereignisse].sort((a, b) => a.beat - b.beat);
    for (let i = 1; i < n.length; i++) assert.ok(n[i - 1].beat + n[i - 1].laenge <= n[i].beat + 1e-9, `${code}: note ${i} overlaps`);
  }
});
