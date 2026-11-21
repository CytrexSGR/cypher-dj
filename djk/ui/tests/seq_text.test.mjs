// SEQ deck v2, task 3: the text of a pattern (project/seq_text.ts). Writing, the pure parser, and the planner that turns a text into ONE command list.
// Every list is run through the project model (fuehreListeAus) and read back, so what the text says is what the project holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { seqGruppe } from '../project/seq.ts';
import { SeqFehler, zeileNeuBefehle } from '../public/seq_logic.js';
import { leseFolgeText, folgeBefehle, schreibeFolgeText, geraetText, geraetVonText, laengeText } from '../project/seq_text.ts';

// ---------- fixtures ----------
const INFO_BK = { art: 'bk', regler: [{ nr: 1, name: 'Wave', vorgabe: 0.5 }, { nr: 3, name: 'Cutoff', vorgabe: 0.5 }, { nr: 4, name: 'Resonance', vorgabe: 0.3 }, { nr: 5, name: 'Env amount', vorgabe: 0.5 }], klaenge: [] };
const INFO_KIT = { art: 'kit', regler: [], klaenge: [{ ton: 36, name: 'kick' }, { ton: 38, name: 'snare' }, { ton: 42, name: 'hat' }] };
const INFO_RB = { art: 'rb338', regler: [{ nr: 'cutoff', name: 'Cutoff', vorgabe: 0.4 }, { nr: 'env_mod', name: 'Env Mod', vorgabe: 0.5 }], klaenge: [] };
const geraetInfo = (g) => (g.name === 'bk' ? INFO_BK : g.name === 'kit' ? INFO_KIT : INFO_RB);
const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }]; return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const mitDeck = (platz = 2) => lauf(live(), { befehl: 'seq_anlegen', platz });
const gid = (p) => seqGruppe(p, 2).id;
const kopie = (x) => JSON.parse(JSON.stringify(x));
const parse = (text) => { const f = leseFolgeText(text); assert.ok(Array.isArray(f), JSON.stringify(f)); return f; };
const plane = (p, text, stumm = false) => folgeBefehle(p, gid(p), parse(text), { stumm, geraetInfo });
const schreibe = (p, text, stumm = false) => { const b = plane(p, text, stumm); return b.length ? lauf(p, ...b) : p; };
const spur = (p, name) => p.spuren.find((s) => s.name.toLowerCase() === name.toLowerCase());
const lies = (p, name) => { const s = spur(p, name); return schreibeFolgeText(s, s.clips[0] ?? null, geraetInfo(s.geraet)); };
const wirft = (f, ...teile) => assert.throws(f, (e) => e instanceof SeqFehler && teile.every((t) => (t instanceof RegExp ? t.test(e.message) : e.message.includes(t))), `a SeqFehler naming ${teile.join(' and ')}`);
const bass = 'noten bass       1/16  c1 ~ . c1 . . d#1 ~ . . c1 . g0 ~ ~ . | c1 ~ . c2 . . d#1 ~ . . f1 . g1 ~ . a#0';
const SPEC1 = `folge bass  bk:bassmusik  2bar
${bass}
werte vel        1/16  120 . . 64 . . 100 . . . 70 . 115 . . . | 120 . . 90 . . 100 . . . 76 . 108 . . 64
werte k3         1/16  .25 . . .30 . . .55 . . . .35 . .80 . . . | .25 . . .90 . . .50 . . . .65 . .75 . . .40   ; Cutoff
kurve k4         sinus .08 .92 je 3/4bar   ; Resonance`;
const SPEC2 = `folge drums  kit:909  1bar
noten kick 36   1/16  x...x...x.o.x...
noten hat  42   1/32  x...o...x...o...x...o...x.o.oxxX`;

// ---------- the examples of spec section 7 ----------
test('the two examples of spec section 7 read into one command list; applied, they read back as the same text, and writing that text changes nothing', () => {
  const p0 = mitDeck();
  const b = plane(p0, `${SPEC1}\n\n${SPEC2}`);
  assert.deepEqual(b.map((x) => x.befehl), ['seq_folge_neu', 'seq_folge_neu'], 'one list, one command per new pattern');
  assert.equal(b[0].geraet.graph, 'bassmusik');
  assert.ok(b[0].noten.length > 0 && b[0].seq.zeilen.length === 4 && b[0].huellkurven.length === 2);
  const p1 = lauf(p0, ...b);
  const text1 = `${lies(p1, 'bass')}\n${lies(p1, 'drums')}`;
  const [kopf, ...rest] = lies(p1, 'bass').split('\n');
  assert.match(kopf, /^folge bass {2}bk:bassmusik {2}2bar$/);
  assert.ok(rest.some((l) => l.startsWith('noten bass  1/16  c1 ~ . c1 . . d#1 ~ . . c1 . g0 ~ ~ .')), rest.join('\n'));
  assert.ok(rest.some((l) => /^werte k3 {2}1\/16 {2}\.25 \. \. \.3 /.test(l) && l.endsWith('; Cutoff')), rest.join('\n'));
  assert.ok(rest.some((l) => /^kurve k4 {2}sinus \.08 \.92 {2}je 3\/4bar {3}; Resonance$/.test(l)), rest.join('\n'));
  assert.ok(lies(p1, 'drums').includes('noten kick 36  1/16  x...'), lies(p1, 'drums'));
  assert.ok(lies(p1, 'drums').includes('noten hat 42  1/32  x...'));
  // read back: nothing to write (the same tokens, the same values, the same shape)
  assert.deepEqual(plane(p1, text1), []);
  // and the stable form: writing the project again after a second apply gives the same text
  assert.equal(`${lies(schreibe(p1, text1), 'bass')}\n${lies(schreibe(p1, text1), 'drums')}`, text1);
  // what the model holds: velocity lane applied, the shape stored with 2 points + closing point at its own length 3
  const c = spur(p1, 'bass').clips[0];
  assert.equal(c.loop_beats, 8);
  assert.deepEqual(c.noten.filter((n) => n.beat === 0 || n.beat === 0.75).map((n) => [n.beat, n.ton, n.vel]), [[0, 36, 120], [0.75, 36, 64]]);
  const hk4 = c.huellkurven.find((h) => h.ziel === 'geraet.k4');
  assert.deepEqual([hk4.verknuepft, hk4.loop_beats, hk4.punkte.length], [false, 3, 3]);
  assert.ok(c.seq.zeilen.find((z) => z.ziel === 'geraet.k4').form.abdruck.length > 0);
  const hat = spur(p1, 'drums').clips[0].noten.filter((n) => n.ton === 42);
  assert.equal(hat.length, 12);
  assert.equal(hat.find((n) => n.beat === 0.5).vel, 60);
  assert.equal(hat.find((n) => n.beat === 3.875).vel, 127);
});

// ---------- every token class ----------
test('trigger tokens: . rest, x 100, X 127, o 60; spaces and | between cells are ignored; written back velocity falls into the bands up to 79, 80 to 110, from 111', () => {
  const p = schreibe(mitDeck(), 'folge d kit:909 1bar\nnoten kick 36 1/16 x . X o | x..o x.X. | . . . .');
  assert.deepEqual(spur(p, 'd').clips[0].noten.map((n) => [n.beat, n.vel]), [[0, 100], [0.5, 127], [0.75, 60], [1, 100], [1.75, 60], [2, 100], [2.5, 127]]);
  const q = lauf(p, { befehl: 'noten_aendern', clip_id: spur(p, 'd').clips[0].id, noten: spur(p, 'd').clips[0].noten.slice(0, 3).map((n, i) => ({ id: n.id, vel: [79, 80, 111][i] })) });
  assert.ok(lies(q, 'd').includes('1/16  o.xX x..o x.X. ....'), lies(q, 'd'));
});

test('pitched tokens: note names (60 = C3), ~ lengthens the note before it, a chord c1+g1, a line that starts with a rest; upper case works, a flat too', () => {
  const p = schreibe(mitDeck(), 'folge lead bk:x 1bar\nnoten n 1/8 c3 ~ ~ . | C1+g1 Eb2 bb0 .');
  const n = spur(p, 'lead').clips[0].noten;
  assert.deepEqual(n.map((x) => [x.beat, x.ton, x.laenge]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), [[0, 60, 1.5], [2, 36, 0.5], [2, 43, 0.5], [2.5, 51, 0.5], [3, 34, 0.5]]);
  assert.match(lies(p, 'lead'), /noten n {2}1\/8 {2}c3 ~ ~ \. c1\+g1 d#2 a#0 \./);
});

test('value lanes: werte vel and len merge into the cells of their note lane, a knob by k<n>, by bare name, by quoted name; transpose, fader and pan', () => {
  const t = (zeilen) => `folge s bk:x 1bar\nnoten n 1/4 c1 c1 c1 c1\n${zeilen}`;
  const p = schreibe(mitDeck(), t(`werte vel 1/4 90 . 70 .\nwerte len 1/4 2 . .5 .\nwerte k3 1/4 .2 . . .8\nwerte Resonance 1/4 .5 . . .\nwerte "Env amount" 1/4 .1 . . .\nwerte transpose 1/4 0 . 2 .\nwerte fader 1/4 -6 . . .\nwerte pan 1/4 -1 . 1 .`));
  const c = spur(p, 's').clips[0];
  assert.deepEqual(c.noten.map((n) => [n.beat, n.vel, n.laenge]), [[0, 90, 2], [1, 100, 1], [2, 70, 0.5], [3, 100, 1]]);
  assert.deepEqual(c.huellkurven.map((h) => h.ziel).sort(), ['geraet.k3', 'geraet.k4', 'geraet.k5', 'spur_fader', 'spur_pan', 'transpose']);
  const k3 = c.huellkurven.find((h) => h.ziel === 'geraet.k3').punkte;
  assert.deepEqual(k3.map((x) => [x.beat, x.wert]), [[0, -0.3], [3, 0.3]]);
  const text = lies(p, 's');
  assert.match(text, /werte vel {2}1\/4 {2}90 100 70 100/);
  assert.match(text, /werte k3 {2}1\/4 {2}\.2 \. \. \.8 {3}; Cutoff/);
  assert.deepEqual(plane(p, text), [], 'the text written back is the data');
});

test('curve lanes: a named shape with its length, points with a form, a comment ends the line; a shape comes back as the shape, points as points', () => {
  const p = schreibe(mitDeck(), `folge s bk:x 2bar ; the head may carry a comment
noten n 1/16 ${Array(32).fill('.').join(' ')}
kurve k4 sinus .08 .92 je 3/4bar  ; Resonance
kurve k3 punkte 0:.2 1.5:.8@s 4:.5@sprung 8:.2`);
  const c = spur(p, 's').clips[0];
  assert.deepEqual(c.huellkurven.find((h) => h.ziel === 'geraet.k3').punkte.map((x) => [x.beat, x.form ?? 'linear']), [[0, 'linear'], [1.5, 's'], [4, 'sprung'], [8, 'linear']]);
  const text = lies(p, 's');
  assert.match(text, /^kurve k4 {2}sinus \.08 \.92 {2}je 3\/4bar/m);
  assert.match(text, /^kurve k3 {2}punkte 0:\.2 1\.5:\.8@s 4:\.5@sprung 8:\.2/m);
  assert.deepEqual(plane(p, text), []);
  // a different shape on the same lane re-writes it, the descriptor keeps the new shape
  const q = schreibe(p, 'folge s\nkurve k4 rampe 0 1 je 2bar');
  assert.equal(q.spuren[0].clips[0].huellkurven.find((h) => h.ziel === 'geraet.k4').loop_beats, 8);
  assert.equal(q.spuren[0].clips[0].seq.zeilen.find((z) => z.ziel === 'geraet.k4').form.art, 'rampe');
});

test('a value lane with its own length: je gives the envelope a length, the cell count follows it, and it reads back with je', () => {
  const p = schreibe(mitDeck(), `folge s bk:x 1bar\nnoten n 1/4 c1 . . .\nwerte k3 1/4 .2 . .8 . je 8b`.replace('.8 . je 8b', '.8 . . . . . je 8b').replace('.2 . .8', '.2 . .8'));
  const hk = p.spuren[0].clips[0].huellkurven[0];
  assert.deepEqual([hk.verknuepft, hk.loop_beats], [false, 8]);
  assert.match(lies(p, 's'), /werte k3 {2}1\/4 {2}\.2 \. \.8 \. \| \. \. \. \. {2}je 2bar/);
  wirft(() => plane(p, 'folge s\nwerte k3 1/4 .2 . .8 .'), 'lane k3', '4 cells found, 8 expected');
});

// ---------- the same data leaves the notes alone ----------
test('a token that says the same as the data leaves that note or point untouched: its id, off-grid start, odd velocity and length stay; a different token changes only its cell', () => {
  const p0 = schreibe(mitDeck(), 'folge d kit:909 1bar\nnoten kick 36 1/16 x...x...x...x...');
  const clip = spur(p0, 'd').clips[0];
  const [n0, n1] = clip.noten;
  const p1 = lauf(p0, { befehl: 'noten_aendern', clip_id: clip.id, noten: [{ id: n0.id, vel: 90, beat: 0.1 }, { id: n1.id, vel: 80, laenge: 0.3 }] });
  assert.deepEqual(plane(p1, 'folge d\nnoten kick 36 1/16 x...x...x...x...'), [], 'x says 80 to 110: same band');
  const b = plane(p1, 'folge d\nnoten kick 36 1/16 X...x...x.o.x...');
  assert.deepEqual(b.map((x) => x.befehl), ['noten_aendern', 'noten_neu'], 'cell 0 gets the accent, cell 10 a new ghost; the other cells are not touched');
  assert.deepEqual(b[0].noten, [{ id: n0.id, vel: 127 }]);
  const p2 = lauf(p1, ...b);
  const noten = spur(p2, 'd').clips[0].noten;
  assert.equal(noten.find((n) => n.id === n0.id).beat, 0.1, 'the off-grid start stays');
  assert.equal(noten.find((n) => n.id === n1.id).vel, 80);
  assert.equal(noten.find((n) => n.id === n1.id).laenge, 0.3);
});

test('a lane the text does not name stays as it is, with its notes; a lane line is the whole lane: a dot removes the note', () => {
  const p0 = schreibe(mitDeck(), 'folge d kit:909 1bar\nnoten kick 36 1/16 x...x...x...x...\nnoten hat 42 1/16 x.x.x.x.x.x.x.x.');
  const hat0 = spur(p0, 'd').clips[0].noten.filter((n) => n.ton === 42).map((n) => n.id);
  const p1 = schreibe(p0, 'folge d\nnoten kick 36 1/16 x.......x.......');
  const c = spur(p1, 'd').clips[0];
  assert.deepEqual(c.noten.filter((n) => n.ton === 42).map((n) => n.id), hat0);
  assert.deepEqual(c.noten.filter((n) => n.ton === 36).map((n) => n.beat), [0, 2]);
  assert.deepEqual(c.seq.zeilen.map((z) => z.id), ['kick', 'hat']);
});

test('an existing pattern is matched by name ignoring case; the head may leave out instrument and length; another length acts like the length control, another instrument is refused naming the playing one', () => {
  const p0 = schreibe(mitDeck(), 'folge Drums kit:909 2bar\nnoten kick 36 1/16 x...x...x...x... | x...x...x...x...');
  const b = plane(p0, 'folge dRUMS 1bar\nnoten kick 36 1/16 x...x...x...x...');
  assert.equal(b[0].befehl, 'noten_loeschen', 'the length comes first and takes the notes behind the new end along');
  const p1 = lauf(p0, ...b);
  assert.equal(p1.spuren.length, 1);
  assert.equal(p1.spuren[0].clips[0].loop_beats, 4);
  assert.equal(p1.spuren[0].clips[0].noten.length, 4);
  wirft(() => plane(p1, 'folge Drums bk:bassmusik'), 'plays kit:909', 'bk:bassmusik');
  wirft(() => plane(p1, 'folge Drums kit:909 3bar\nnoten kick 36 1/16 x...x...x...x...'), 'lane kick', '16 cells found, 48 expected');
  assert.equal(plane(p1, 'folge Drums kit:909 1bar').length, 0, 'same instrument and length: nothing to do');
});

test('a pattern name with spaces is in double quotes; a name twice in one text is refused; a new pattern needs an instrument', () => {
  const p = schreibe(mitDeck(), 'folge "Big Kick" kit:909 1bar\nnoten kick 36 1/4 x x x x');
  assert.equal(p.spuren[0].name, 'Big Kick');
  assert.match(lies(p, 'Big Kick'), /^folge "Big Kick" {2}kit:909 {2}1bar/);
  assert.equal(plane(p, lies(p, 'Big Kick')).length, 0);
  assert.match(leseFolgeText('folge a kit:909 1bar\nfolge A kit:909 1bar').text, /pattern A is named twice/);
  wirft(() => plane(p, 'folge new\nnoten k 36 1/4 x...'), 'pattern new', 'needs an instrument');
});

test('a pattern Cypher makes by text starts muted (stumm), a pattern of Andreas does not; an existing pattern keeps its mute', () => {
  const p = mitDeck();
  assert.equal(spur(schreibe(p, 'folge a kit:909 1bar', true), 'a').mute, true);
  assert.equal(spur(schreibe(p, 'folge a kit:909 1bar', false), 'a').mute, false);
  const hoerbar = schreibe(p, 'folge a kit:909 1bar', false);
  assert.equal(spur(schreibe(hoerbar, 'folge a\nnoten k 36 1/4 x...', true), 'a').mute, false);
});

// ---------- refusals ----------
test('refusals name lane and cell and write nothing: a wrong cell count, an unknown knob, a knob name with spaces outside quotes, a bad token', () => {
  const p = schreibe(mitDeck(), SPEC1);
  const vorher = kopie(p);
  const alt = lies(p, 'bass');
  wirft(() => plane(p, 'folge bass\nnoten bass 1/16 c1 . . .'), 'lane bass', '4 cells found, 32 expected');
  wirft(() => plane(p, 'folge bass\nwerte k65 1/16 ' + Array(32).fill('.').join(' ')), 'lane k65', 'unknown knob');
  wirft(() => plane(p, 'folge bass\nwerte Nothing 1/16 ' + Array(32).fill('.').join(' ')), 'lane Nothing', 'unknown knob');
  for (const t of ['folge bass\nwerte Env amount 1/16 .1 .', 'folge bass\nwerte Filter Cutoff 1/16 .1']) {
    const f = leseFolgeText(t);
    assert.ok('grund' in f, t);
    assert.match(f.text, /line 2 \(lane (Env|Filter)\)/);
    assert.match(f.text, /double quotes/);
  }
  const zell = Array(32).fill('.');
  zell[7] = '1.5';
  wirft(() => plane(p, 'folge bass\nwerte k3 1/16 ' + zell.join(' ')), 'lane k3, cell 7');
  const f = leseFolgeText('folge bass\nnoten bass 1/16 c1 . . q9 . . . .');
  assert.match(f.text, /lane bass, cell 3: q9 is no note/);
  assert.match(leseFolgeText('folge kit kit:909\nnoten k 36 1/16 x.Z.').text, /lane k, cell 2: Z is no hit/);
  assert.match(leseFolgeText('folge a bk:x\nnoten n 1/16 . ~').text, /lane n, cell 1: ~ lengthens the note before it/);
  assert.match(leseFolgeText('noten n 1/16 c1').text, /starts with a head line/);
  assert.match(leseFolgeText('folge a bk:x\nkurve k3 wobble 0 1').text, /wobble is no shape/);
  assert.match(leseFolgeText('folge a bk:x\nkurve k3 sinus .1').text, /needs a from and a to value/);
  assert.match(leseFolgeText('').text, /no pattern/);
  assert.deepEqual(kopie(p), vorher, 'the project is unchanged');
  assert.equal(lies(p, 'bass'), alt);
});

test('a vel value in a cell without a note names the velocity lane and the cell; a kit pattern refuses a knob lane with huellkurve_ziel; a note of another trigger lane in the pitched lane is refused', () => {
  const p = mitDeck();
  wirft(() => plane(p, 'folge s bk:x 1bar\nnoten n 1/4 c1 . . .\nwerte vel 1/4 90 . 70 .'), 'lane vel', 'cell 2', 'no note');
  try { plane(p, 'folge d kit:909 1bar\nwerte k3 1/4 .1 . . .'); assert.fail(); } catch (e) { assert.equal(e.grund, 'huellkurve_ziel'); assert.match(e.message, /lane k3/); }
  wirft(() => plane(p, 'folge m bk:x 1bar\nnoten a 1/4 c1 . . .\nnoten b 1/4 c1 . . .'), 'line 3', 'pitched notes have the lane a');
  // the pitched lane says a pitch a trigger lane of the pattern owns
  wirft(() => plane(p, 'folge m bk:x 1bar\nnoten kick 36 1/4 x . . .\nnoten n 1/4 c1 . . .'), 'lane n, cell 0', 'belongs to the trigger lane kick');
});

test('review focus 5: a new pattern whose third line does not fit creates nothing: no track, the project is the same', () => {
  const p = mitDeck();
  const vorher = kopie(p);
  const text = 'folge bass bk:bassmusik 1bar\nnoten bass 1/16 c1 . . . c1 . . . c1 . . . c1 . . .\nnoten hat 42 1/16 x...';
  wirft(() => plane(p, text), 'lane hat', '4 cells found, 16 expected');
  assert.deepEqual(kopie(p), vorher);
  // two patterns in one text: the second is wrong, the first is not made either
  wirft(() => plane(p, `${SPEC2}\nfolge b2 bk:x 1bar\nnoten n 1/16 c1`), 'lane n');
  assert.deepEqual(kopie(p), vorher);
});

test('an existing pattern whose lane line is wrong is refused as a whole, also when an earlier lane of the text would have written', () => {
  const p = schreibe(mitDeck(), 'folge d kit:909 1bar\nnoten kick 36 1/16 x...x...x...x...');
  const vorher = kopie(p);
  wirft(() => plane(p, 'folge d\nnoten kick 36 1/16 x.......x.......\nnoten hat 42 1/16 xx'), 'lane hat');
  assert.deepEqual(kopie(p), vorher);
});

// ---------- helpers of the text ----------
test('lengths and instruments: laengeText writes bars where it can; geraetVonText builds the device a new pattern gets; other instruments are not made from text', () => {
  assert.deepEqual([4, 8, 3, 2, 1, 6, 1.5, 0.125, 5].map(laengeText), ['1bar', '2bar', '3/4bar', '1/2bar', '1/4bar', '6b', '1.5b', '0.125b', '5b']);
  assert.deepEqual(geraetVonText('kit:909'), { art: 'intern', name: 'kit', kit: '909' });
  assert.equal(geraetVonText('bk:synth-mono').graph, 'synth-mono');
  assert.equal(geraetVonText('rb338').name, 'rb338');
  wirft(() => geraetVonText('surge'), 'bk:<graph>');
  assert.deepEqual(['bk:a', 'kit:b', 'rb338'].map((t) => geraetText(geraetVonText(t))), ['bk:a', 'kit:b', 'rb338']);
  const f = parse('folge a rb338 3/4bar\nfolge b bk:x 6b\nfolge c kit:k');
  assert.deepEqual(f.map((x) => [x.kopf.name, x.kopf.instrument, x.kopf.beats]), [['a', 'rb338', 3], ['b', 'bk:x', 6], ['c', 'kit:k', null]]);
  assert.match(leseFolgeText('folge a kit:k 65b').text, /multiple of 0.125/);
  assert.match(leseFolgeText('folge a kit:k flute').text, /neither an instrument/);
});

test('an RB-338 pattern writes its knobs by id with the name as comment and reads a name with spaces in quotes', () => {
  const p = schreibe(mitDeck(), 'folge acid rb338 1bar\nnoten n 1/4 c1 . . .\nwerte cutoff 1/4 .3 . . .\nwerte "Env Mod" 1/4 .9 . . .');
  assert.deepEqual(p.spuren[0].clips[0].huellkurven.map((h) => h.ziel).sort(), ['geraet.cutoff', 'geraet.env_mod']);
  const text = lies(p, 'acid');
  assert.match(text, /werte env_mod {2}1\/4 {2}\.9 \. \. \. {3}; Env Mod/);
  assert.deepEqual(plane(p, text), []);
  wirft(() => plane(p, 'folge acid\nwerte k3 1/4 .3 . . .'), 'unknown knob');
});

test('the lane ids of derived lanes are the contract of the text: a kit clip made without a descriptor shows t36, a clip with an envelope shows its short target name', () => {
  let p = mitDeck();
  p = lauf(p, { befehl: 'seq_folge_neu', gruppe_id: gid(p), name: 'Raw', geraet: geraetVonText('kit:909') });
  const clip = p.spuren[0].clips[0];
  p = lauf(p, { befehl: 'noten_neu', clip_id: clip.id, noten: [{ beat: 0, laenge: 0.1, ton: 36, vel: 100 }, { beat: 1, laenge: 0.1, ton: 38, vel: 100 }] });
  const text = lies(p, 'Raw');
  assert.match(text, /^noten t36 36 {2}1\/16 {2}x\.\.\./m);
  assert.match(text, /^noten t38 38/m);
  assert.deepEqual(plane(p, text), [], 'derived lanes stay derived: a text that says the same writes nothing');
  const q = schreibe(p, 'folge Raw\nnoten t36 36 1/16 x...x...x...x...');
  assert.equal(q.spuren[0].clips[0].noten.filter((n) => n.ton === 36).length, 4);
  assert.match(lies(q, 'Raw'), /^noten t38 38/m, 'the lane t38 is still there with the same id');
});

test('a pattern arranged in PRODUCTION (two clips) is refused with its name; a pattern without a clip gets one with the first text', () => {
  let p = mitDeck();
  p = lauf(p, { befehl: 'seq_folge_neu', gruppe_id: gid(p), name: 'Arr', geraet: geraetVonText('kit:909') });
  const spurId = p.spuren[0].id;
  const zwei = lauf(p, { befehl: 'clip_neu', spur_id: spurId, art: 'midi', name: 'Zwei', start_beat: 64, laenge_beats: 4 });
  wirft(() => plane(zwei, 'folge Arr\nnoten k 36 1/4 x...'), 'Arr', 'PRODUCTION');
  const leer = lauf(p, { befehl: 'clip_loeschen', clip_id: p.spuren[0].clips[0].id });
  assert.equal(leer.spuren[0].clips.length, 0);
  const b = plane(leer, 'folge Arr 2bar\nnoten k 36 1/4 x.x. x.x.');
  assert.equal(b[0].befehl, 'clip_neu');
  const q = lauf(leer, ...b);
  assert.deepEqual([q.spuren[0].clips[0].loop_beats, q.spuren[0].clips[0].noten.length], [8, 4]);
});

// ---------- review fixes, round 1 ----------
const punkte16 = (n) => Array(n).fill('.').join(' ');
const mitNote = (extra = '') => `folge b bk:bassmusik 1bar\nnoten n 1/16 c1 ${punkte16(15)}${extra}`;

test('review 1: zufall with the default steps, with 8 and with 64 steps is written by text and by the model, read back and written again changes nothing; 65 steps are refused', () => {
  for (const t of ['kurve pan zufall -1 1', 'kurve pan zufall -1 1 stufen 8 saat 3', 'kurve pan zufall -1 1 stufen 64 saat 5', 'kurve transpose zufall -12 12 stufen 64']) {
    const p = schreibe(mitDeck(), `${mitNote()}\n${t}`);
    const z = spur(p, 'b').clips[0].seq.zeilen.at(-1);
    assert.equal(z.form.art, 'zufall', t);
    assert.ok(z.form.abdruck.length >= 1 && z.form.abdruck.length <= 16, `${t}: the fingerprint is short (${z.form.abdruck.length})`);
    assert.deepEqual(plane(p, lies(p, 'b')), [], `${t}: read back and written again changes nothing`);
    assert.equal(spur(p, 'b').clips[0].huellkurven.at(-1).punkte.length, t.includes('stufen 64') ? 64 : 8, t);
  }
  wirft(() => plane(mitDeck(), `${mitNote()}\nkurve pan zufall -1 1 stufen 65`), 'stufen');
  // the model takes the same: a descriptor with 64 steps, not with 65
  const p = schreibe(mitDeck(), `${mitNote()}\nkurve pan zufall -1 1 stufen 64`);
  const clip = spur(p, 'b').clips[0];
  const mitStufen = (n) => ({ befehl: 'clip_aendern', clip_id: clip.id, seq: { ...clip.seq, zeilen: clip.seq.zeilen.map((z) => (z.form ? { ...z, form: { ...z.form, stufen: n } } : z)) } });
  assert.ok(lauf(p, mitStufen(64)));
  assert.throws(() => lauf(p, mitStufen(65)), /stufen/);
});

test('review 2: a value lane whose envelope has no point at beat 0 reads cell 0 as the value over the seam; writing the text back sends nothing; another change adds the seam point', () => {
  let p = schreibe(mitDeck(), `${mitNote()}\nwerte k3 1/16 .2 . .8 ${punkte16(13)}`);
  const c = spur(p, 'b').clips[0];
  p = lauf(p, { befehl: 'huellkurve_setzen', clip_id: c.id, ziel: 'geraet.k3', punkte: [{ beat: 0.5, wert: 0.3, form: 'sprung' }, { beat: 1, wert: -0.2, form: 'sprung' }] });
  const t = lies(p, 'b');
  const zellen = /\nwerte k3 {2}1\/16 {2}(.*?)(?: {3};.*)?$/m.exec(t)[1].split(' ').filter((x) => x !== '|');
  assert.notEqual(zellen[0], '.', `cell 0 shows the value over the seam: ${t}`);
  assert.equal(zellen[0], zellen[4], 'the value of the last point (cell 4 holds it)');
  assert.deepEqual(plane(p, t), [], 'writing the text back sends no command');
  const geaendert = t.replace(/(werte k3 {2}1\/16 {2})(\S+) (\S+) (\S+)/, '$1$2 $3 .55');
  const b = plane(p, geaendert);
  assert.equal(b.length, 1);
  assert.equal(b[0].punkte[0].beat, 0, 'written for another reason: the seam point comes along');
  assert.equal(b[0].punkte[0].wert, b[0].punkte.at(-1).wert, 'with the value of the last point');
  // a lane that has the point at beat 0 reads and writes as before
  const q = schreibe(mitDeck(), `${mitNote()}\nwerte k3 1/16 .2 . .8 ${punkte16(13)}`);
  assert.deepEqual(plane(q, lies(q, 'b')), []);
});

test('review 3: an envelope on a knob the graph does not have is read back with the comment "no such knob" and written back; k1..k64 is a target on a Baukasten instrument, an unknown knob NAME is still refused', () => {
  let p = schreibe(mitDeck(), mitNote());
  const c = spur(p, 'b').clips[0];
  p = lauf(p, { befehl: 'huellkurve_setzen', clip_id: c.id, ziel: 'geraet.k2', punkte: [{ beat: 0.37, wert: 0.1 }, { beat: 2, wert: -0.2, form: 's' }] });
  const t = lies(p, 'b');
  assert.match(t, /\nkurve k2 {2}punkte \.37:\S+ 2:\S+@s {3}; no such knob/, t);
  assert.deepEqual(plane(p, t), [], 'the text can be written back');
  const q = schreibe(mitDeck(), `${mitNote()}\nwerte k2 1/16 .2 . . . ${punkte16(12)}\nwerte k64 1/4 .1 . . .`);
  assert.deepEqual(spur(q, 'b').clips[0].huellkurven.map((h) => h.ziel).sort(), ['geraet.k2', 'geraet.k64']);
  wirft(() => plane(mitDeck(), `${mitNote()}\nwerte k65 1/4 .1 . . .`), 'unknown knob');
  wirft(() => plane(mitDeck(), `${mitNote()}\nwerte k0 1/4 .1 . . .`), 'unknown knob');
  wirft(() => plane(mitDeck(), `${mitNote()}\nwerte Nothing 1/4 .1 . . .`), 'unknown knob');
  // RB-338 and kit keep their refusals
  wirft(() => plane(mitDeck(), 'folge r rb338 1bar\nwerte k3 1/4 .3 . . .'), 'unknown knob');
});

test('review 4 (text): more than 32 lanes: derived lanes are all in the text and read back unchanged; 33 explicit lanes are refused naming the number', () => {
  let p = mitDeck();
  p = lauf(p, { befehl: 'seq_folge_neu', gruppe_id: gid(p), name: 'K', loop_beats: 16, geraet: { art: 'intern', name: 'kit', kit: '909' },
    noten: Array.from({ length: 40 }, (_, i) => ({ beat: i * 0.25, laenge: 0.1, ton: 30 + i, vel: 100 })) });
  const t = lies(p, 'K');
  assert.equal(t.split('\n').length, 1 + 40, 'all 40 lanes are in the text');
  for (let i = 0; i < 40; i++) assert.match(t, new RegExp(`\\nnoten t${30 + i} ${30 + i} `), `pitch ${30 + i}`);
  assert.deepEqual(plane(p, t), [], 'read back and written again changes nothing, no lane becomes explicit');
  // 32 explicit lanes and one more note
  const zeilen32 = Array.from({ length: 32 }, (_, i) => `noten l${i} ${40 + i} 1/4 x...`).join('\n');
  let q = schreibe(mitDeck(), `folge Z kit:909 1bar\n${zeilen32}`);
  q = lauf(q, { befehl: 'noten_neu', clip_id: spur(q, 'Z').clips[0].id, noten: [{ beat: 0.5, laenge: 0.1, ton: 100, vel: 99 }] });
  const tq = lies(q, 'Z');
  assert.match(tq, /\nnoten t100 100 /, 'the note on a 33rd pitch is in the text');
  assert.deepEqual(plane(q, tq), []);
  wirft(() => plane(mitDeck(), `folge Z kit:909 1bar\n${zeilen32}\nnoten l32 72 1/4 x...`), '33');
});

test('review 6: werte vel and werte len read back change no note; a changed value is set on every note of the cell', () => {
  let p = schreibe(mitDeck(), mitNote());
  const cid = spur(p, 'b').clips[0].id;
  p = lauf(p, { befehl: 'noten_neu', clip_id: cid, noten: [{ beat: 1, laenge: 1, ton: 52, vel: 90 }, { beat: 1, laenge: 1, ton: 55, vel: 40 },
    { beat: 3, laenge: 0.3333333, ton: 60, vel: 100 }, { beat: 2, laenge: 0.3, ton: 60, vel: 33 }] });
  const s = spur(p, 'b');
  const eine = (zeile) => lauf(p, ...zeileNeuBefehle(s, s.clips[0], zeile, geraetInfo(s.geraet)));
  p = eine({ art: 'werte', teiler: 0.25, ziel: 'vel' });
  const s2 = spur(p, 'b');
  p = lauf(p, ...zeileNeuBefehle(s2, s2.clips[0], { art: 'werte', teiler: 0.25, ziel: 'laenge' }, geraetInfo(s2.geraet)));
  const t = lies(p, 'b');
  assert.match(t, /werte vel/); assert.match(t, /werte len/);
  assert.deepEqual(plane(p, t), [], `nothing is sent for a text that says what the data says:\n${t}`);
  // a really different value goes to every note of the cell
  const neu = t.replace(/(werte vel {2}1\/16 {2}\S+ \. \. \. )90/, '$180');
  const b = plane(p, neu);
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].noten.map((n) => n.vel), [80, 80], 'both notes of the chord');
  const neuLen = t.replace(/(werte len {2}1\/16 {2}\S+ \. \. \. )4/, '$12');
  const b2 = plane(p, neuLen);
  assert.deepEqual(b2[0].noten.map((n) => n.laenge), [0.5, 0.5], '2 cells of 1/16 for both notes');
});

test('review 7: a lane id or a target twice in one pattern of the text is refused with the line number, nothing is written; the same id in two patterns is fine', () => {
  wirft(() => plane(mitDeck(), 'folge d kit:909 1bar\nnoten k 36 1/16 x...x...x...x...\nnoten k 36 1/16 ....x...x...x...x'), 'line 3', 'k');
  wirft(() => plane(mitDeck(), `${mitNote()}\nkurve k4 dreieck 0 1 je 3b\nkurve k4 sinus 0 1`), 'line 4', 'k4');
  wirft(() => plane(mitDeck(), `${mitNote()}\nwerte k3 1/16 .2 ${punkte16(15)}\nwerte Cutoff 1/4 .3 . . .`), 'line 4');
  wirft(() => plane(mitDeck(), 'folge d kit:909 1bar\nnoten a 36 1/4 x...\nnoten b 36 1/4 x...'), 'line 3', '36');
  wirft(() => plane(mitDeck(), `${mitNote()}\nwerte vel 1/16 100 ${punkte16(15)}\nwerte vel 1/16 90 ${punkte16(15)}`), 'line 4', 'vel');
  const p = schreibe(mitDeck(), 'folge d kit:909 1bar\nnoten k 36 1/4 x...\nfolge e kit:909 1bar\nnoten k 36 1/4 x...');
  assert.equal(spur(p, 'e').clips[0].noten.length, 1);
});
