// Piano roll tools as project commands: noten_quantisieren and noten_humanisieren (CLIP family, fan-out to linked clips, fast note path, one undo step).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { FAECHER_BEFEHLE } from '../project/verbund.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { kopie, tmpOrdner } from './support/project.mjs';

const lauf = (p, ...b) => fuehreListeAus(kopie(p), b).projekt;
const grund = (p, ...b) => { try { fuehreListeAus(kopie(p), b); return null; } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e; } };
const GERAET = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
const clip = (p, id) => p.spuren.flatMap((s) => s.clips).find((c) => c.id === id);
const note = (beat, ton = 60, vel = 100) => ({ beat, laenge: 0.25, ton, vel });
// s1 with clip c1 (4 beats): notes n1..n5
function basis(noten = [note(0.1), note(0.4, 62), note(1.9, 65), note(2.5), note(3.99, 67)], extra = {}) {
  const p = lauf(neuesProjekt('x'), { befehl: 'spur_neu', art: 'instrument', name: 'I', geraet: GERAET });
  return lauf(p, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten, ...extra });
}
const beats = (p, id = 'c1') => clip(p, id).noten.map((n) => n.beat);
const Q = (o) => ({ befehl: 'noten_quantisieren', clip_id: 'c1', raster: '1/16', ...o });
const H = (o) => ({ befehl: 'noten_humanisieren', clip_id: 'c1', saat: 1, zeit: 20, ...o });

test('the two commands are in the fan-out list', () => {
  assert.ok(FAECHER_BEFEHLE.includes('noten_quantisieren') && FAECHER_BEFEHLE.includes('noten_humanisieren'));
});

test('quantise: every grid id of the table, lengths and other fields stay', () => {
  const p = basis();
  assert.deepEqual(beats(lauf(p, Q({}))), [0, 0.5, 2, 2.5, 3.75]);
  assert.deepEqual(beats(lauf(p, Q({ raster: '1/4' }))), [0, 0, 2, 2, 3], 'on 1/4 the last note takes beat 3 (4 is the end), a tie goes to the earlier beat');
  assert.deepEqual(beats(lauf(p, Q({ raster: '1/8T' }))).map((x) => Math.round(x * 1e9) / 1e9), [0, 0.333333333, 2, 2.333333333, 3.666666667]);
  const r = lauf(p, Q({ raster: '1/32' }));
  assert.deepEqual(clip(r, 'c1').noten.map((n) => [n.id, n.laenge, n.ton, n.vel]), clip(p, 'c1').noten.map((n) => [n.id, n.laenge, n.ton, n.vel]));
});

test('quantise: strength and swing', () => {
  const p = basis();
  assert.deepEqual(beats(lauf(p, Q({ staerke: 0.5 })))[0], 0.05);
  assert.deepEqual(beats(lauf(p, Q({ swing: 66 })))[1], 0.33);
  assert.deepEqual(beats(lauf(p, Q({ raster: '1/8', swing: 75 }))), [0, 0.75, 2, 2.75, 3.75]);
});

test('quantise: a note 0.01 before the loop end of a 4 beat loop lands on 3.75; the loop end is the limit, not the clip length', () => {
  const p = basis([note(3.99)]);
  assert.deepEqual(beats(lauf(p, Q({}))), [3.75]);
  const q = basis([note(2.99), note(3.5)], { laenge_beats: 8, loop_beats: 3 });
  assert.deepEqual(beats(lauf(q, Q({ raster: '1/4' }))), [2, 3.5], 'the note before the loop end takes beat 2, the one behind it stays');
  const r = basis([note(3.4), note(1.1)], { laenge_beats: 8, loop_beats: 3 });
  assert.deepEqual(beats(lauf(r, Q({ raster: '1/4' }))), [3.4, 1], 'a note behind the loop end is not touched');
});

test('quantise: triplet grid is idempotent; a second run changes nothing and creates no note', () => {
  const p = lauf(basis([note(0.34), note(1.01), note(2.7)], { laenge_beats: 3.9 }), Q({ raster: '1/8T' }));
  assert.deepEqual(beats(p), [0.333333333, 1, 2.666666667]);
  assert.deepEqual(clip(lauf(p, Q({ raster: '1/8T' })), 'c1').noten, clip(p, 'c1').noten);
  assert.equal(fuehreListeAus(kopie(p), [Q({ raster: '1/8T' })]).vor.length, 0, 'no patch at all');
});

test('quantise: two notes of one pitch onto one beat both stay, with their ids', () => {
  const p = lauf(basis([note(0.49), note(0.51), note(0.5)]), Q({ raster: '1/8' }));
  assert.deepEqual(clip(p, 'c1').noten.map((n) => [n.id, n.beat]), [['n1', 0.5], ['n2', 0.5], ['n3', 0.5]]);
});

test('quantise: noten_ids limits the notes; an id not in the clip refuses and changes nothing', () => {
  const p = basis();
  assert.deepEqual(beats(lauf(p, Q({ noten_ids: ['n2'] }))), [0.1, 0.5, 1.9, 2.5, 3.99]);
  const e = grund(p, Q({ noten_ids: ['n2', 'n99'] }));
  assert.equal(e.grund, 'noten_unbekannt');
  assert.equal(grund(p, Q({ noten_ids: [] })).grund, 'argument_ungueltig');
  assert.equal(grund(p, Q({ noten_ids: 'n1' })).grund, 'argument_ungueltig');
  assert.equal(grund(p, Q({ noten_ids: [5] })).grund, 'noten_unbekannt');
});

test('quantise: argument ranges and refusals', () => {
  const p = basis();
  for (const raster of [undefined, '1/64', 'bar', 'off', 0.25, null, '1/16 ']) assert.equal(grund(p, Q({ raster })).grund, 'argument_ungueltig', String(raster));
  for (const staerke of [-0.1, 1.1, '1', NaN, null]) assert.equal(grund(p, Q({ staerke })).grund, 'argument_ungueltig', String(staerke));
  for (const swing of [49.9, 75.1, '60', NaN]) assert.equal(grund(p, Q({ swing })).grund, 'argument_ungueltig', String(swing));
  for (const r of ['1/16T', '1/8T', '1/4T']) assert.equal(grund(p, Q({ raster: r, swing: 60 })).grund, 'argument_ungueltig', r);
  assert.equal(grund(p, Q({ raster: '1/8T', swing: 50 })), null);
  for (const [raster, swing, staerke] of [['1/32', 50, 1], ['1/4', 75, 1], ['1/16', 50, 0], ['1/8', 62.5, 0.5]]) assert.equal(grund(p, Q({ raster, swing, staerke })), null, raster);
  assert.equal(grund(p, Q({ tonart: 1 })).grund, 'argument_ungueltig');
  assert.equal(grund(p, Q({ foo: 1 })).grund, 'argument_unbekannt');
  assert.equal(grund(p, { befehl: 'noten_quantisieren', raster: '1/16' }).grund, 'argument_ungueltig');
  assert.equal(grund(p, Q({ clip_id: 'c9' })).grund, 'clip_unbekannt');
  assert.equal(grund(p, Q({ clip_id: 's1' })).grund !== null, true);
  for (const e of [grund(p, Q({ raster: 'x' })), grund(p, Q({ swing: 80 }))]) assert.match(e.detail ?? e.message, /\S/);
});

test('quantise: tonart true leaves a note outside [0, end) entirely alone, its pitch too', () => {
  const k = lauf(basis([note(0.1, 61), note(5, 61), note(4, 63)]), { befehl: 'tonart_setzen', grundton: 0, skala: 'major' });
  const r = lauf(k, Q({ tonart: true }));
  assert.deepEqual(clip(r, 'c1').noten.map((n) => [n.beat, n.ton]), [[0, 60], [5, 61], [4, 63]], 'only the note inside is touched');
});

test('quantise: tonart true moves the pitches to the key; without a project key it is refused', () => {
  const p = basis([note(0.1, 61), note(0.4, 63), note(1.9, 60)]);
  const e = grund(p, Q({ tonart: true }));
  assert.equal(e.grund, 'argument_ungueltig');
  assert.match(e.detail, /key/);
  const k = lauf(p, { befehl: 'tonart_setzen', grundton: 0, skala: 'major' });
  const r = lauf(k, Q({ tonart: true }));
  assert.deepEqual(clip(r, 'c1').noten.map((n) => n.ton), [60, 62, 60], 'C major: 61 and 63 tie down, 60 stays');
  assert.deepEqual(beats(r), [0, 0.5, 2]);
  const nurTon = lauf(k, Q({ tonart: true, noten_ids: ['n2'] }));
  assert.deepEqual(clip(nurTon, 'c1').noten.map((n) => n.ton), [61, 62, 60]);
  const aufRaster = lauf(lauf(k, Q({})), Q({ tonart: true }));
  assert.deepEqual(clip(aufRaster, 'c1').noten.map((n) => n.ton), [60, 62, 60], 'a pitch change alone counts as a change');
  assert.equal(lauf(k, Q({ tonart: false })).rev, k.rev);
  assert.deepEqual(beats(lauf(k, Q({ tonart: false }))), [0, 0.5, 2]);
});

test('quantise: no effect is not an error: the command succeeds and produces no patch (no revision, no undo step)', (t) => {
  const p = lauf(basis(), Q({}));
  const r = fuehreListeAus(kopie(p), [Q({})]);
  assert.equal(r.vor.length, 0);
  assert.deepEqual(clip(r.projekt, 'c1').noten, clip(p, 'c1').noten);
  const v = new Verlauf(path.join(tmpOrdner(t), 'u.jsonl'), { jetzt: () => 1, zeitgeber: false });
  const w = aendere(v, kopie(p), [Q({})], { quelle: 'andreas', label: 'Quantize' });
  assert.equal(w.eintrag, null);
});

test('humanise: ranges, refusals and the rule that one of zeit and vel is above 0', () => {
  const p = basis();
  for (const saat of [undefined, -1, 4294967296, 1.5, '1', NaN]) assert.equal(grund(p, H({ saat })).grund, 'argument_ungueltig', String(saat));
  for (const zeit of [-1, 50.1, '5', NaN]) assert.equal(grund(p, H({ zeit })).grund, 'argument_ungueltig', String(zeit));
  for (const vel of [-1, 40.1, '5', NaN]) assert.equal(grund(p, H({ vel })).grund, 'argument_ungueltig', String(vel));
  assert.equal(grund(p, { befehl: 'noten_humanisieren', clip_id: 'c1', saat: 1 }).grund, 'argument_ungueltig');
  assert.equal(grund(p, H({ zeit: 0, vel: 0 })).grund, 'argument_ungueltig');
  assert.equal(grund(p, H({ zeit: 0 })).grund, 'argument_ungueltig');
  assert.equal(grund(p, H({ zeit: 0, vel: 5 })), null);
  assert.equal(grund(p, H({ zeit: 50, vel: 40, saat: 0 })), null);
  assert.equal(grund(p, H({ zeit: 50, vel: 40, saat: 4294967295 })), null);
  assert.equal(grund(p, H({ foo: 1 })).grund, 'argument_unbekannt');
  assert.equal(grund(p, H({ noten_ids: ['n1', 'nX'] })).grund, 'noten_unbekannt');
  assert.equal(grund(p, H({ clip_id: 'c9' })).grund, 'clip_unbekannt');
});

test('humanise: deterministic from seed and note ids, inside the ranges, noten_ids limits the notes, velocity and clamp', () => {
  const noten = Array.from({ length: 40 }, (_, i) => note(0.25 + i * 0.09, 60, i === 0 ? 1 : i === 1 ? 127 : 80));
  const p = basis(noten, { laenge_beats: 4 });
  const r1 = lauf(p, H({ zeit: 50, vel: 40, saat: 5 })), r2 = lauf(p, H({ zeit: 50, vel: 40, saat: 5 })), r3 = lauf(p, H({ zeit: 50, vel: 40, saat: 6 }));
  assert.deepEqual(clip(r1, 'c1').noten, clip(r2, 'c1').noten);
  assert.notDeepEqual(clip(r1, 'c1').noten, clip(r3, 'c1').noten);
  for (const [i, n] of clip(r1, 'c1').noten.entries()) {
    const o = noten[i];
    assert.ok(Math.abs(n.beat - o.beat) <= 0.125 + 1e-9 && n.beat >= 0 && n.beat < 4);
    assert.ok(Number.isInteger(n.vel) && n.vel >= 1 && n.vel <= 127 && Math.abs(n.vel - o.vel) <= 40);
    assert.deepEqual([n.laenge, n.ton], [o.laenge, o.ton]);
  }
  const eine = lauf(p, H({ zeit: 50, vel: 40, saat: 5, noten_ids: ['n3'] }));
  const vorher = clip(p, 'c1').noten;
  assert.deepEqual(clip(eine, 'c1').noten.filter((n, i) => JSON.stringify(n) !== JSON.stringify(vorher[i])).map((n) => n.id), ['n3']);
  assert.deepEqual(clip(eine, 'c1').noten[2], clip(r1, 'c1').noten[2]);
  const nurVel = lauf(p, { befehl: 'noten_humanisieren', clip_id: 'c1', saat: 2, vel: 10 });
  assert.deepEqual(clip(nurVel, 'c1').noten.map((n) => n.beat), noten.map((n) => n.beat));
});

test('both commands are one undo step and undo restores', (t) => {
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 1_000_000, zeitgeber: false });
  const p0 = basis();
  const w = aendere(v, kopie(p0), [Q({}), H({ vel: 10 })], { quelle: 'andreas', label: 'tools' });
  assert.notDeepEqual(clip(w.projekt, 'c1').noten, clip(p0, 'c1').noten);
  assert.equal(v.eintraegeNach(p0.rev).length, 1, 'one history entry for the whole list');
  const u = rueckgaengig(v, w.projekt, { quelle: 'andreas' });
  assert.deepEqual(clip(u.projekt, 'c1').noten, clip(p0, 'c1').noten);
});

test('linked clips stay equal after either command (also humanise)', () => {
  let p = basis([note(0.1), note(0.4, 62), note(1.9, 65)]);
  p = lauf(p, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 8, laenge_beats: 4, noten: [note(3)] });
  p = lauf(p, { befehl: 'clip_verknuepfen', clip_id: 'c2', mit: 'c1' });
  const q = lauf(p, { ...Q({}), clip_id: 'c2' });
  assert.deepEqual(clip(q, 'c1').noten, clip(q, 'c2').noten);
  assert.deepEqual(beats(q, 'c1'), [0, 0.5, 2]);
  const h = lauf(p, { ...H({ vel: 20 }), clip_id: 'c1' });
  assert.deepEqual(clip(h, 'c1').noten, clip(h, 'c2').noten);
  assert.notDeepEqual(clip(h, 'c1').noten, clip(p, 'c1').noten);
  const hk = lauf(lauf(p, { befehl: 'tonart_setzen', grundton: 0, skala: 'major' }), { ...Q({ tonart: true }), clip_id: 'c2' });
  assert.deepEqual(clip(hk, 'c1').noten, clip(hk, 'c2').noten);
});

test('fast note path: other tracks and clips are shared untouched; 10 000 notes stay quick', () => {
  const viele = Array.from({ length: 10_000 }, (_, i) => note(((i * 7) % 3990) / 1000 + 0.001, 36 + (i % 48)));
  let p = basis(viele);
  p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: 'J', geraet: GERAET });
  p = lauf(p, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [note(0.1)] });
  for (const b of [Q({ raster: '1/32', staerke: 0.9 }), H({ zeit: 30, vel: 10 })]) {
    const eingang = kopie(p);
    const t0 = performance.now();
    const r = fuehreListeAus(eingang, [b]);
    const ms = performance.now() - t0;
    assert.ok(r.vor.length > 0);
    assert.equal(r.projekt.spuren[1], eingang.spuren[1], 'the other track is shared, not copied');
    assert.ok(ms < 500, `${b.befehl}: ${ms.toFixed(1)} ms`);
  }
});
