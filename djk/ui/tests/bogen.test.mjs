// Strand 11, task 7.4: the arc compiler (pure). Every compiled result also passes pruefeSpur on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kompiliereBogen } from '../bogen.ts';
import { pruefeSpur } from '../track.ts';
import { kompiliere } from '../../generator/src/compile.mjs';

// every layer text is emitted as (\n<text>\n); a stack puts its layers on separate lines
const W = (t) => `(\n${t}\n)`;
const ST = (...l) => `stack(\n${l.join(',\n')}\n)`;
const FAHRBAR = new Set(['a_filter1_cutoff']);
const HATS = 's("hh*8")', CLAP = 's("~ cp")', BASS = 'note("c2*4").s("sawtooth")';

// Compile, assert success, assert the output is a valid spur by itself
function ok(bogen) {
  const r = kompiliereBogen(bogen, FAHRBAR);
  assert.ok(!('fehler' in r), `unexpected error: ${r.text}`);
  const p = pruefeSpur(r.spur, FAHRBAR);
  assert.ok(!('fehler' in p), `pruefeSpur refused the output: ${p.fehler}`);
  return r;
}
// Pattern moves of one stream as [bar, text]
const zuege = (r, strom) => r.spur.fahrten.filter((f) => f.ziel === `strom:${strom}`).map((f) => [f.ab_takt, f.muster]);

const BASIS = {
  name: 'bogen-a', takte: 32,
  schichten: [
    { strom: 1, muster: HATS, ab_takt: 1, rein: 8, name: 'hats' },
    { strom: 1, muster: CLAP, ab_takt: 5, name: 'clap' },
    { strom: 2, muster: BASS, ab_takt: 1, name: 'bass' },
  ],
  bruch: { ab_takt: 13, takte: 4, behalte: [1] },
};

test('a layer entering mid-fade: the section at 5 continues the fade with .rein(8, 4)', () => {
  const r = ok(BASIS);
  assert.deepEqual(zuege(r, 1), [
    [1, `${W(HATS)}.rein(8)`],
    [5, ST(`${W(HATS)}.rein(8, 4)`, W(CLAP))],
  ]);
  const f5 = r.spur.fahrten.find((f) => f.ziel === 'strom:1' && f.ab_takt === 5);
  assert.equal(f5.bezeichnung, 'hats + clap');
});

test('break keeping stream 1: stream 2 silent at 13, back at 17; plan says break and drop', () => {
  const r = ok(BASIS);
  assert.deepEqual(zuege(r, 2), [[1, W(BASS)], [13, 'silence'], [17, W(BASS)]]);
  assert.equal(r.spur.fahrten.find((f) => f.ziel === 'strom:2' && f.ab_takt === 13).bezeichnung, undefined);
  assert.equal(r.spur.fahrten.find((f) => f.ziel === 'strom:2' && f.ab_takt === 17).bezeichnung, 'bass');
  // the kept stream is untouched by the break
  assert.ok(!zuege(r, 1).some(([b]) => b === 13 || b === 17));
  assert.deepEqual(r.plan.filter((p) => p.strom === null), [
    { takt: 13, strom: null, text: 'break (keeps 1)' },
    { takt: 17, strom: null, text: 'drop' },
  ]);
  assert.deepEqual(r.plan.filter((p) => p.takt === 5), [{ takt: 5, strom: 1, text: '+ clap' }]);
});

test('the whole stack returns after a break with nothing kept, a fade still running continues', () => {
  const r = ok({
    name: 'bogen-b', takte: 16,
    schichten: [
      { strom: 1, muster: HATS, ab_takt: 1, rein: 8 },
      { strom: 1, muster: CLAP, ab_takt: 2 },
      { strom: 3, muster: 'note("e4")', ab_takt: 1 },
    ],
    bruch: { ab_takt: 3, takte: 2 },
  });
  assert.deepEqual(zuege(r, 1), [
    [1, `${W(HATS)}.rein(8)`],
    [2, ST(`${W(HATS)}.rein(8, 1)`, W(CLAP))],
    [3, 'silence'],
    [5, ST(`${W(HATS)}.rein(8, 4)`, W(CLAP))],
  ]);
  assert.deepEqual(zuege(r, 3), [[1, W('note("e4")')], [3, 'silence'], [5, W('note("e4")')]]);
  assert.equal(r.plan.find((p) => p.text.startsWith('break')).text, 'break');
  // no name anywhere: no bezeichnung
  assert.ok(r.spur.fahrten.every((f) => f.bezeichnung === undefined));
});

test('raus 4 with bis_takt 25: .raus(4) at 21, silence at 25', () => {
  const r = ok({ name: 'bogen-c', takte: 32, schichten: [{ strom: 5, muster: 'note("a3")', ab_takt: 1, bis_takt: 25, raus: 4, name: 'pad' }] });
  assert.deepEqual(zuege(r, 5), [[1, W('note("a3")')], [21, `${W('note("a3")')}.raus(4)`], [25, 'silence']]);
  assert.deepEqual(r.plan, [{ takt: 1, strom: 5, text: '+ pad' }, { takt: 25, strom: 5, text: '- pad' }]);
});

test('a fade-out crossing a section boundary continues with .raus(n, schon)', () => {
  const r = ok({
    name: 'bogen-d', takte: 16,
    schichten: [
      { strom: 1, muster: HATS, ab_takt: 1, bis_takt: 9, raus: 4 },
      { strom: 1, muster: CLAP, ab_takt: 7, bis_takt: 13 },
    ],
  });
  assert.deepEqual(zuege(r, 1), [
    [1, W(HATS)],
    [5, `${W(HATS)}.raus(4)`],
    [7, ST(`${W(HATS)}.raus(4, 2)`, W(CLAP))],
    [9, W(CLAP)],
    [13, 'silence'],
  ]);
});

test('fade-in and fade-out overlapping on one layer chain both', () => {
  const r = ok({ name: 'bogen-e', takte: 8, schichten: [
    { strom: 1, muster: HATS, ab_takt: 1, bis_takt: 7, rein: 4, raus: 4 },
  ] });
  assert.deepEqual(zuege(r, 1), [[1, `${W(HATS)}.rein(4)`], [3, `${W(HATS)}.rein(4, 2).raus(4)`], [7, 'silence']]);
});

test('all layers of a stream end before the arc ends: the stream goes to silence, not the last stack', () => {
  const r = ok({
    name: 'bogen-f', takte: 32,
    schichten: [
      { strom: 6, muster: 'note("c4")', ab_takt: 3, bis_takt: 9 },
      { strom: 6, muster: 'note("g4")', ab_takt: 5, bis_takt: 11 },
      { strom: 1, muster: HATS, ab_takt: 1 },
    ],
  });
  assert.deepEqual(zuege(r, 6), [
    [3, W('note("c4")')],
    [5, ST(W('note("c4")'), W('note("g4")'))],
    [9, W('note("g4")')],
    [11, 'silence'],
  ]);
  // a stream with no layer before bar 3 is not touched before bar 3; an open-ended layer is not silenced
  assert.deepEqual(zuege(r, 1), [[1, W(HATS)]]);
});

test('identical consecutive sections are merged', () => {
  // the bis_takt-raus boundary of layer 2 sits on a stretch where layer 1 alone plays: no second move with the same text
  const r = ok({
    name: 'bogen-g', takte: 16,
    schichten: [
      { strom: 1, muster: HATS, ab_takt: 1 },
      { strom: 2, muster: BASS, ab_takt: 1, bis_takt: 5 },
      { strom: 2, muster: BASS, ab_takt: 5 },
    ],
  });
  assert.deepEqual(zuege(r, 2), [[1, W(BASS)]]);
  // a break that covers a stretch where the stream is already silent: one silence only
  const s = ok({ name: 'bogen-h', takte: 16, schichten: [{ strom: 3, muster: 'note("e4")', ab_takt: 1, bis_takt: 5 }], bruch: { ab_takt: 9, takte: 2 } });
  assert.deepEqual(zuege(s, 3), [[1, W('note("e4")')], [5, 'silence']]);
});

test('a layer entering inside the break stays silent until the drop', () => {
  const r = ok({
    name: 'bogen-i', takte: 16,
    schichten: [{ strom: 2, muster: BASS, ab_takt: 1 }, { strom: 2, muster: 'note("g1")', ab_takt: 6, rein: 4 }],
    bruch: { ab_takt: 5, takte: 4 },
  });
  assert.deepEqual(zuege(r, 2), [[1, W(BASS)], [5, 'silence'], [9, ST(W(BASS), `${W('note("g1")')}.rein(4, 3)`)]]);
});

test('pattern text with a trailing semicolon or a line comment stays valid inside the parentheses', () => {
  const r = ok({ name: 'bogen-j', takte: 8, schichten: [
    { strom: 1, muster: 's("bd*4");', ab_takt: 1, rein: 2 },
    { strom: 2, muster: 'note("c2") // low', ab_takt: 1, rein: 2 },
  ] });
  assert.deepEqual(zuege(r, 1), [[1, `${W('s("bd*4")')}.rein(2)`]]);
  assert.deepEqual(zuege(r, 2), [[1, `${W('note("c2") // low')}.rein(2)`]]);
});

test('a hand-written fahrten entry passes through unchanged', () => {
  const extra = { ziel: 'erz/1/fader', ab_takt: 9, takte: 4, nach: -6 };
  const r = ok({ ...BASIS, fahrten: [extra] });
  assert.deepEqual(r.spur.fahrten.at(-1), extra);
  assert.equal(r.spur.name, 'bogen-a');
});

test('pruefeSpur errors come back unchanged (a hand move colliding with a compiled pattern move)', () => {
  const r = kompiliereBogen({ ...BASIS, fahrten: [{ ziel: 'strom:2', ab_takt: 13, muster: 'silence' }] }, FAHRBAR);
  assert.equal(r.fehler, 'bogen');
  assert.match(r.text, /^fahrten\[\d+\]: overlaps another move on strom:2$/);
});

test('invalid input names the field and the layer', () => {
  const fehler = (b) => { const r = kompiliereBogen(b, FAHRBAR); assert.equal(r.fehler, 'bogen'); return r.text; };
  const mit = (i, s) => ({ ...BASIS, schichten: BASIS.schichten.map((x, k) => (k === i ? { ...x, ...s } : x)) });
  assert.equal(fehler(mit(1, { rein: 0 })), 'schichten[1].rein: integer 1..32');
  assert.equal(fehler(mit(2, { rein: 33 })), 'schichten[2].rein: integer 1..32');
  assert.equal(fehler(mit(0, { raus: 4 })), 'schichten[0].raus: needs bis_takt');
  assert.equal(fehler(mit(1, { bis_takt: 7, raus: 4 })), 'schichten[1].raus: bis_takt - raus must be >= ab_takt');
  assert.equal(fehler(mit(1, { bis_takt: 5 })), 'schichten[1].bis_takt: integer 6..33 (exclusive end)');
  assert.equal(fehler(mit(1, { bis_takt: 34 })), 'schichten[1].bis_takt: integer 6..33 (exclusive end)');
  assert.equal(fehler(mit(0, { strom: 4 })), 'schichten[0].strom: one of 1, 2, 3, 5, 6, 7, 9, 10');
  assert.equal(fehler(mit(0, { ab_takt: 33 })), 'schichten[0].ab_takt: integer 1..32');
  assert.equal(fehler(mit(0, { muster: ' ' })), 'schichten[0].muster: pattern text expected');
  assert.equal(fehler(mit(0, { name: 'x'.repeat(61) })), 'schichten[0].name: text 1..60');
  assert.equal(fehler({ ...BASIS, takte: 129 }), 'takte: integer 1..128');
  assert.equal(fehler({ ...BASIS, name: 'Bogen A' }), 'name: [a-z0-9_-]{1,32}');
  assert.equal(fehler({ ...BASIS, schichten: [] }), 'schichten: non-empty list expected');
  assert.equal(fehler({ ...BASIS, bruch: { ab_takt: 30, takte: 4 } }), 'bruch.takte: integer 1..3 (the break lies inside the arc)');
  assert.equal(fehler({ ...BASIS, bruch: { ab_takt: 13, takte: 4, behalte: [3] } }), 'bruch.behalte[0]: stream 3 has no layer in this arc');
});

test('a layer ending exactly at the arc end goes silent on bar takte + 1, still a valid spur', () => {
  const r = ok({ name: 'bogen-k', takte: 8, schichten: [{ strom: 7, muster: 'note("d5")', ab_takt: 1, bis_takt: 9 }] });
  assert.deepEqual(zuege(r, 7), [[1, W('note("d5")')], [9, 'silence']]);
});

test('two layers on one stream, one ending in a line comment: the stack compiles in the generator', () => {
  const r = ok({ name: 'bogen-l', takte: 8, schichten: [
    { strom: 1, muster: 'note("c2") // low', ab_takt: 1 },
    { strom: 1, muster: 's("bd*4")', ab_takt: 1 },
  ] });
  const text = zuege(r, 1)[0][1];
  assert.equal(text, ST(W('note("c2") // low'), W('s("bd*4")')));
  assert.ok(!('fehler' in kompiliere(text)), 'the generator parses the stack text');
  assert.ok('fehler' in kompiliere('stack(note("c2") // low, s("bd*4"))'), 'sanity: the old form is refused');
  const einzeln = ok({ name: 'bogen-m', takte: 8, schichten: [{ strom: 1, muster: 'note("c2") // low;', ab_takt: 1 }] });
  assert.ok(!('fehler' in kompiliere(zuege(einzeln, 1)[0][1])));
});

test('B5: a joined layer label over 60 characters is cut to 59 characters and an ellipsis', () => {
  const r = ok({ name: 'bogen-n', takte: 8, schichten: [
    { strom: 1, muster: HATS, ab_takt: 1, name: 'a'.repeat(40) },
    { strom: 1, muster: CLAP, ab_takt: 1, name: 'b'.repeat(40) },
  ] });
  const bez = r.spur.fahrten.find((f) => f.ziel === 'strom:1').bezeichnung;
  assert.equal(bez.length, 60);
  assert.ok(bez.endsWith('…'));
});

test('A2: a control character in a layer name is refused', () => {
  const r = kompiliereBogen({ name: 'bogen-o', takte: 4, schichten: [{ strom: 1, muster: HATS, ab_takt: 1, name: 'a\u0000b' }] }, FAHRBAR);
  assert.equal(r.fehler, 'bogen');
  assert.equal(r.text, 'schichten[0].name: no control characters');
});
