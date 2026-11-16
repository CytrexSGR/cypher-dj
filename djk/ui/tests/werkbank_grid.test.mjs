// Workbench task 6: the pure grid model (public/werkbank/grid.js). Window, counting, rows, cells, values, commands. No DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fenster, blaettere, taktWahl, leiste, zaehlung, drumZeilen, tonZeilen, startOben, radOben, oktavLeiste, zustand, zellen, musterTakte, zuLang,
  klickBefehle, wertZellen, wertBefehle, sliceZeilen, rueckBefehle, pitchZellen, pitchBefehle, SCHRITT, SCHRITTE_TAKT, SICHTEN, fensterSpanne, TON_MIN, TON_MAX, FENSTER, RAD, VEL_VORGABE, LAENGE_VORGABE,
} from '../public/werkbank/grid.js';
import { SeqFehler } from '../public/seq_logic.js';

// The D3 template tracks as plain objects with ids.
function vorlage() {
  let n = 0;
  const id = () => `n${++n}`;
  const dn = [];
  for (let b = 0; b < 16; b++) dn.push({ id: id(), beat: b, laenge: 0.125, ton: 36, vel: 120 });
  for (let t = 0; t < 4; t++) for (const b of [1, 3]) dn.push({ id: id(), beat: t * 4 + b, laenge: 0.125, ton: 39, vel: 105 });
  for (let b = 0; b < 16; b++) dn.push({ id: id(), beat: b + 0.5, laenge: 0.125, ton: 42, vel: 90 });
  const bn = [];
  for (let b = 0; b < 16; b++) {
    const ton = b < 8 ? 40 : b < 12 ? 43 : 38;
    for (const [o, vel] of [[0.25, 96], [0.5, 112], [0.75, 96]]) bn.push({ id: id(), beat: b + o, laenge: 0.25, ton, vel });
  }
  const clip = (nm, noten) => ({ id: `c_${nm}`, art: 'midi', name: nm, start_beat: 0, laenge_beats: 64, loop_beats: 16, noten });
  return {
    drums: { id: 's_d', name: 'Drums', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} }, clips: [clip('d', dn)] },
    bass: { id: 's_b', name: 'Bass', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'bass-banddrive', parameter: {} }, clips: [clip('b', bn)] },
  };
}
const idBei = (c, beat) => c.noten.find((x) => Math.abs(x.beat - beat) < 1e-9).id;

test('constants', () => {
  assert.deepEqual([SCHRITT, SCHRITTE_TAKT, SICHTEN, TON_MIN, TON_MAX, FENSTER, RAD, VEL_VORGABE, LAENGE_VORGABE], [0.25, 16, [1, 2, 4], 24, 119, 24, 2, 100, 1]);
  assert.equal(vorlage().drums.clips[0].noten.length, 40);
  assert.equal(vorlage().bass.clips[0].noten.length, 48);
});
test('window: never wider than the module, start on its grid (review focus 3)', () => {
  assert.deepEqual(fenster({ sicht: 4, start: 0 }, 2), { sicht: 4, breite: 2, start: 0, aufl: 16, takte: [0, 1] });
  assert.deepEqual(fenster({ sicht: 2, start: 3 }, 16).takte, [2, 3]);
  assert.deepEqual(blaettere(fenster({ sicht: 4, start: 12 }, 16), 1, 16).start, 12);
  assert.deepEqual(blaettere(fenster({ sicht: 1, start: 0 }, 1), -1, 1).start, 0);
  assert.deepEqual(taktWahl(fenster({ sicht: 4, start: 0 }, 16), 9, 16).takte, [8, 9, 10, 11]);
  assert.deepEqual(fenster({ sicht: 3, start: 0 }, 16).sicht, 4);
  // LENGTH 1 or 2 with VIEW 4: arrows never page, no bar beyond the module
  assert.deepEqual(blaettere(fenster({ sicht: 4, start: 0 }, 2), 1, 2).takte, [0, 1]);
  assert.deepEqual(blaettere(fenster({ sicht: 4, start: 0 }, 1), 1, 1).takte, [0]);
  assert.equal(zellen(vorlage().drums.clips[0], 36, fenster({ sicht: 4, start: 0 }, 1)).length, 16);
  assert.ok(leiste(2, fenster({ sicht: 4, start: 0 }, 2)).length === 2);
});
test('counting: BAR and STEP rows, 1 5 9 13 emphasised, bar strip emphasis', () => {
  const z = zaehlung(fenster({ sicht: 2, start: 2 }, 16));
  assert.deepEqual(z.takte.map((t) => t.nr), [3, 4]);
  assert.deepEqual(z.schritte.filter((s) => s.betont).map((s) => s.nr), [1, 5, 9, 13, 1, 5, 9, 13]);
  assert.deepEqual(leiste(16, fenster({ sicht: 4, start: 4 }, 16)).filter((b) => b.betont).map((b) => b.nr), [1, 5, 9, 13]);
  assert.deepEqual(leiste(16, fenster({ sicht: 4, start: 4 }, 16)).filter((b) => b.sichtbar).map((b) => b.nr), [5, 6, 7, 8]);
});
test('drum rows: the sounds in their order, then pitches no sound names', () => {
  const rows = drumZeilen({ noten: [{ beat: 0, ton: 36 }, { beat: 1, ton: 60 }], loop_beats: 16 }, { klaenge: [{ ton: 36, name: 'Kick' }, { ton: 38, name: 'Snare' }] });
  assert.deepEqual(rows.map((r) => [r.ton, r.name]), [[36, 'Kick'], [38, 'Snare'], [60, 'C3']]);
  assert.deepEqual(drumZeilen(null, null), []);
});
test('pitch rows: two octaves, wheel, octave bar, fold', () => {
  const bass = vorlage().bass.clips[0];
  assert.equal(startOben(bass), 59);                       // lowest 38 (D1) → C1 = 36, top 59
  assert.equal(startOben({ noten: [] }), 59);
  assert.deepEqual(tonZeilen(59, false, bass).map((r) => r.ton).slice(0, 2), [59, 58]);
  assert.equal(tonZeilen(59, false, bass).length, 24);
  assert.deepEqual(tonZeilen(59, true, bass).map((r) => r.ton), [43, 40, 38]);
  assert.deepEqual(tonZeilen(59, true, { noten: [] }).length, 24);
  const r48 = tonZeilen(59, false, bass).find((r) => r.ton === 48);
  assert.deepEqual([r48.c, r48.schwarz, r48.name], [true, false, 'C2']);
  assert.equal(tonZeilen(59, false, bass).find((r) => r.ton === 49).schwarz, true);
  assert.deepEqual([radOben(59, -100), radOben(119, -100), radOben(47, 100)], [61, 119, 47]);   // up 2; clamped at B7; bottom row stays >= 24
  const o = oktavLeiste(59, bass);
  assert.deepEqual(o.filter((x) => x.sichtbar).map((x) => x.oktave), [2, 1]);   // window 36..59 = C1..B2
  assert.deepEqual(o.filter((x) => x.noten).map((x) => x.oktave), [1]);         // 38, 40, 43 lie in octave 1
  assert.equal(o.find((x) => x.oktave === 3).oben, 83);   // C3..B4 = 60..83
  assert.deepEqual(o.map((x) => x.oktave), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(o.find((x) => x.oktave === 7).oben, 119);  // R9: a click on octave 7 shows 96..119
  assert.equal(o.find((x) => x.oktave === 0).oben, 47);
});
test('cells: a 4-bar pattern in an 8-bar module repeats pale; a click on a repeat edits its source', () => {
  const kick = zellen(vorlage().drums.clips[0], 36, fenster({ sicht: 4, start: 4 }, 8));
  assert.equal(kick.length, 64);
  assert.deepEqual([kick[0].schritt, kick[0].quelle, kick[0].an, kick[0].wiederholung], [64, 0, true, true]);
  const b = klickBefehle(vorlage().drums, vorlage().drums.clips[0], 36, kick[0].quelle, 'drum');
  assert.deepEqual(b.map((x) => x.befehl), ['noten_loeschen']);
  const erste = zellen(vorlage().drums.clips[0], 36, fenster({ sicht: 4, start: 0 }, 8));
  assert.equal(erste[0].wiederholung, false);
  assert.equal(erste[1].an, false);
  assert.equal(musterTakte(vorlage().drums.clips[0]), 4);
  // pitch null: the lowest note represents the step
  const alle = zellen(vorlage().drums.clips[0], null, fenster({ sicht: 1, start: 0 }, 4));
  assert.deepEqual([alle[0].an, alle[2].an, alle[8].an], [true, true, true]);
});
test('a note step toggles a one-step note; values write noten_aendern; refusals', () => {
  const s = vorlage().bass, c = s.clips[0];
  assert.deepEqual(klickBefehle(s, c, 52, 0, 'note'), [{ befehl: 'noten_neu', clip_id: c.id, noten: [{ beat: 0, laenge: 0.25, ton: 52, vel: 100 }] }]);
  assert.deepEqual(klickBefehle(s, c, 40, 1, 'note').map((x) => x.befehl), ['noten_loeschen']);
  assert.deepEqual(wertBefehle(c, null, 2, 'vel', 64), [{ befehl: 'noten_aendern', clip_id: c.id, noten: [{ id: idBei(c, 0.5), vel: 64 }] }]);
  assert.deepEqual(wertBefehle(c, null, 1, 'laenge', 3)[0].noten[0].laenge, 0.75);
  assert.throws(() => wertBefehle(c, 52, 2, 'vel', 64), SeqFehler);   // ton filter: no note of pitch 52 there
  assert.deepEqual(wertBefehle(c, 40, 2, 'vel', 112), []);              // already that value: nothing to write
  for (const [q, f, w] of [[0, 'vel', 64], [2, 'vel', 0], [2, 'vel', 1.5], [2, 'laenge', 17], [2, 'laenge', 0], [2, 'laenge', 1.5], [2, 'farbe', 1]]) assert.throws(() => wertBefehle(c, null, q, f, w), SeqFehler);
  const v = wertZellen(c, null, fenster({ sicht: 1, start: 0 }, 4), 'vel');
  assert.deepEqual(v.slice(0, 4).map((x) => [x.da, x.wert, x.anders]), [[false, null, false], [true, 96, true], [true, 112, true], [true, 96, true]]);
  const l = wertZellen(c, null, fenster({ sicht: 1, start: 0 }, 4), 'laenge');
  assert.deepEqual(l.slice(0, 2).map((x) => [x.da, x.wert, x.anders]), [[false, null, false], [true, 1, false]]);
  const k = wertZellen(vorlage().drums.clips[0], 36, fenster({ sicht: 1, start: 0 }, 4), 'vel');
  assert.deepEqual([k[0].wert, k[1].da], [120, false]);
});
test('state: a clip arranged in PRODUCTION is locked, no clip is kein_clip (review focus 5)', () => {
  assert.equal(zustand({ art: 'instrument', clips: [{ art: 'midi', start_beat: 8, laenge_beats: 16 }] }), 'gesperrt');
  assert.equal(zustand({ art: 'instrument', clips: [] }), 'kein_clip');
  assert.equal(zustand(vorlage().bass), 'muster');
  assert.throws(() => klickBefehle({ id: 's1', art: 'instrument', clips: [] }, null, 36, 0, 'drum'), SeqFehler);
  const g = { id: 's1', art: 'instrument', clips: [{ id: 'c', art: 'midi', start_beat: 8, laenge_beats: 16, noten: [] }] };
  assert.throws(() => klickBefehle(g, g.clips[0], 36, 0, 'drum'), SeqFehler);
});
test('a clip longer than 64 beats stays a pattern; a pattern clip shorter than 64 beats is locked', () => {
  const s = vorlage().bass;
  assert.equal(zustand({ ...s, clips: [{ ...s.clips[0], laenge_beats: 512 }] }), 'muster');
  assert.equal(zustand({ ...s, clips: [{ ...s.clips[0], laenge_beats: 32 }] }), 'gesperrt');
  assert.equal(zuLang({ ...s.clips[0], loop_beats: 32 }, 4), true);
  assert.equal(zuLang(s.clips[0], 4), false);
});
test('resolution: a window has 4, 8 or 16 cells per bar; the counting row follows', () => {
  for (const aufl of [4, 8, 16]) {
    const f = fenster({ sicht: 2, start: 0, aufl }, 8);
    assert.deepEqual(fensterSpanne(f), [0, 2 * aufl]);
    const z = zaehlung(f);
    assert.equal(z.schritte.length, 2 * aufl);
    assert.deepEqual(z.takte.map((t) => [t.nr, t.schritt, t.spanne]), [[1, 0, aufl], [2, aufl, aufl]]);
    assert.equal(blaettere(f, 1, 8).aufl, aufl);
    assert.equal(taktWahl(f, 5, 8).aufl, aufl);
  }
  assert.equal(fenster({ sicht: 1 }, 4).aufl, 16, 'the default is 16');
});
test('windows page over 128 bars', () => {
  let f = fenster({ sicht: 4, start: 0 }, 128);
  assert.equal(leiste(128, f).length, 128);
  f = blaettere(f, 1, 128);
  assert.deepEqual(f.takte, [4, 5, 6, 7]);
  assert.deepEqual(taktWahl(f, 127, 128).takte, [124, 125, 126, 127]);
  assert.equal(blaettere(taktWahl(f, 127, 128), 1, 128).start, 124, 'the last page stays');
  assert.equal(fenster({ sicht: 2, start: 40 }, 32).start, 30);
});
test('cells at 4, 8 and 32... resolutions: cell count, cell on when a note starts in its span, click writes at the cell start', () => {
  const clip = { id: 'c', art: 'midi', start_beat: 0, laenge_beats: 64, loop_beats: 4, noten: [{ id: 'a', beat: 0.75, laenge: 0.25, ton: 36, vel: 90 }, { id: 'b', beat: 2, laenge: 0.25, ton: 36, vel: 100 }] };
  const spur = { id: 's1', art: 'instrument', clips: [clip] };
  const z4 = zellen(clip, 36, fenster({ sicht: 1, start: 0, aufl: 4 }, 1), 'drum');
  assert.equal(z4.length, 4);
  assert.deepEqual(z4.map((z) => z.an), [true, false, true, false], 'a note on the 4th sixteenth belongs to cell 0 of 4');
  assert.equal(z4[0].vel, 90);
  const z8 = zellen(clip, 36, fenster({ sicht: 1, start: 0, aufl: 8 }, 1), 'drum');
  assert.deepEqual(z8.map((z) => z.an), [false, true, false, false, true, false, false, false]);
  const k4 = klickBefehle(spur, clip, 38, 3, 'drum', null, 4);
  assert.deepEqual(k4, [{ befehl: 'noten_neu', clip_id: 'c', noten: [{ beat: 3, laenge: 0.125, ton: 38, vel: 100 }] }]);
  assert.deepEqual(klickBefehle(spur, clip, 40, 5, 'note', null, 8)[0].noten[0], { beat: 2.5, laenge: 0.5, ton: 40, vel: 100 });
  assert.deepEqual(klickBefehle(spur, clip, 36, 0, 'drum', null, 4), [{ befehl: 'noten_loeschen', clip_id: 'c', ids: ['a'] }], 'a click on a cell with a note inside it turns it off');
  assert.throws(() => klickBefehle(spur, clip, 36, 4, 'drum', null, 4), SeqFehler, 'cell 4 of 4 does not exist');
});
test('a pattern shorter than the module shows its repeats pale, a repeat names its source cell', () => {
  const clip = { id: 'c', art: 'midi', start_beat: 0, laenge_beats: 64, loop_beats: 2, noten: [{ id: 'a', beat: 0.5, laenge: 0.25, ton: 36, vel: 90 }] };
  const z = zellen(clip, 36, fenster({ sicht: 1, start: 0, aufl: 8 }, 1), 'drum');
  assert.equal(z.length, 8);
  assert.deepEqual(z.map((z) => z.wiederholung), [false, false, false, false, true, true, true, true]);
  assert.deepEqual(z.map((z) => z.quelle), [0, 1, 2, 3, 0, 1, 2, 3]);
  assert.deepEqual(z.map((z) => z.an), [false, true, false, false, false, true, false, false]);
});
test('a note value LENGTH counts cells of the resolution and is written as beats', () => {
  const clip = { id: 'c', art: 'midi', start_beat: 0, laenge_beats: 64, loop_beats: 4, noten: [{ id: 'a', beat: 1, laenge: 0.5, ton: 36, vel: 90 }] };
  assert.equal(zellen(clip, 36, fenster({ sicht: 1, aufl: 8 }, 1), 'note')[2].laenge, 1);
  assert.equal(zellen(clip, 36, fenster({ sicht: 1, aufl: 16 }, 1), 'note')[4].laenge, 2);
  assert.deepEqual(wertBefehle(clip, 36, 2, 'laenge', 3, 'note', 8), [{ befehl: 'noten_aendern', clip_id: 'c', noten: [{ id: 'a', laenge: 1.5 }] }]);
});

// ---- SLICE grid (sampler A1 task 6) ----
// a cut of 4 slices: 0.5, 0.5, 1 and 2 beats (pattern 4 beats); slice i plays on note i, reversed on i + 64
const SLICE_INFO = { art: 'bk', regler: [], klaenge: [0, 1, 2, 3].map((ton) => ({ ton, name: String(ton + 1) })), schnitt: { id: 'x', scheiben: 4, laengen_beats: [0.5, 0.5, 1, 2] } };
const sliceSpur = (noten, loop = 4) => ({ id: 's_s', name: 'S', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'smp-x', parameter: {} },
  clips: [{ id: 'c_s', art: 'midi', name: 's', start_beat: 0, laenge_beats: 64, loop_beats: loop, noten }] });
test('slice rows: the slices in order, then foreign pitches below 64 that no slice names', () => {
  const clip = { loop_beats: 4, noten: [{ id: 'a', beat: 0, ton: 60 }, { id: 'b', beat: 1, ton: 3 + 64 }, { id: 'c', beat: 2, ton: 1 }, { id: 'd', beat: 3, ton: 90 }] };
  assert.deepEqual(sliceZeilen(clip, SLICE_INFO).map((r) => [r.ton, r.name]), [[0, '1'], [1, '2'], [2, '3'], [3, '4'], [60, 'C3']]);
  assert.deepEqual(sliceZeilen(null, SLICE_INFO).map((r) => r.ton), [0, 1, 2, 3]);
});
test('a reversed hit lives on its row; a click removes it and adds nothing (review focus 4)', () => {
  const f = fenster({ sicht: 1, start: 0 }, 1);
  const spur = sliceSpur([{ id: 'n1', beat: 0.5, laenge: 0.25, ton: 64 + 3, vel: 100 }, { id: 'n2', beat: 1, laenge: 1, ton: 3, vel: 80 }]);
  const clip = spur.clips[0];
  assert.deepEqual(zellen(clip, 3, f, 'slice')[2], { schritt: 2, quelle: 2, an: true, vel: 100, laenge: 1, wiederholung: false, rueck: true });
  assert.deepEqual(zellen(clip, 3, f, 'slice')[4], { schritt: 4, quelle: 4, an: true, vel: 80, laenge: 4, wiederholung: false, rueck: false });
  assert.equal(zellen(clip, 2, f, 'slice')[2].an, false, 'another row does not see it');
  assert.ok(!('rueck' in zellen(clip, 3, f)[4]) && !('rueck' in zellen(clip, 3, f, 'drum')[4]), 'other grids are unchanged');
  assert.equal(zellen(clip, 3, f)[2].an, false, 'without the slice kind the reversed note is not on the row');
  assert.deepEqual(klickBefehle(spur, clip, 3, 2, 'slice', SLICE_INFO), [{ befehl: 'noten_loeschen', clip_id: clip.id, ids: ['n1'] }]);
  assert.deepEqual(klickBefehle(spur, clip, 3, 4, 'slice', SLICE_INFO), [{ befehl: 'noten_loeschen', clip_id: clip.id, ids: ['n2'] }]);
  assert.deepEqual(rueckBefehle(clip, 3, 2), [{ befehl: 'noten_aendern', clip_id: clip.id, noten: [{ id: 'n1', ton: 3 }] }]);
  assert.deepEqual(rueckBefehle(clip, 3, 4), [{ befehl: 'noten_aendern', clip_id: clip.id, noten: [{ id: 'n2', ton: 3 + 64 }] }]);
});
test('a click deletes every hit of the row that starts in the step, forward and reversed', () => {
  const spur = sliceSpur([{ id: 'a', beat: 0, laenge: 0.5, ton: 1, vel: 100 }, { id: 'b', beat: 0, laenge: 0.5, ton: 65, vel: 100 }, { id: 'c', beat: 0, laenge: 0.5, ton: 2, vel: 100 }]);
  assert.deepEqual(klickBefehle(spur, spur.clips[0], 1, 0, 'slice', SLICE_INFO), [{ befehl: 'noten_loeschen', clip_id: 'c_s', ids: ['a', 'b'] }]);
  // REVERSE on a step with mixed hits makes them all reversed; with all reversed, all forward
  const mix = sliceSpur([{ id: 'a', beat: 0, laenge: 0.5, ton: 1, vel: 100 }, { id: 'b', beat: 0, laenge: 0.5, ton: 65, vel: 100 }]);
  assert.deepEqual(rueckBefehle(mix.clips[0], 1, 0)[0].noten, [{ id: 'a', ton: 65 }]);
  assert.deepEqual(wertBefehle(mix.clips[0], 1, 0, 'rueck', 0, 'slice')[0].noten, [{ id: 'b', ton: 1 }]);
  assert.deepEqual(wertBefehle(mix.clips[0], 1, 0, 'rueck', 1, 'slice')[0].noten, [{ id: 'a', ton: 65 }]);
  assert.deepEqual(wertBefehle(sliceSpur([{ id: 'a', beat: 0, laenge: 0.5, ton: 65, vel: 100 }]).clips[0], 1, 0, 'rueck', 1, 'slice'), [], 'already reversed: nothing to write');
});
test('a new hit lasts its slice in whole steps, at least 1 and at most 16', () => {
  const info = { ...SLICE_INFO, klaenge: [0, 1, 2, 3, 4].map((ton) => ({ ton, name: String(ton + 1) })), schnitt: { id: 'x', scheiben: 5, laengen_beats: [0.5, 0.1, 1, 8, 0.31] } };
  const spur = sliceSpur([], 16);
  const neu = (ton, q) => klickBefehle(spur, spur.clips[0], ton, q, 'slice', info);
  assert.deepEqual(neu(0, 0), [{ befehl: 'noten_neu', clip_id: 'c_s', noten: [{ beat: 0, laenge: 0.5, ton: 0, vel: 100 }] }]);
  assert.equal(neu(1, 1)[0].noten[0].laenge, 0.25, '0.1 beat rounds to 0 steps: at least one');
  assert.equal(neu(3, 4)[0].noten[0].laenge, 4, '8 beats are 32 steps: at most 16');
  assert.equal(neu(4, 2)[0].noten[0].laenge, 0.25, '0.31 beat is 1.24 steps: 1');
  assert.deepEqual([neu(2, 3)[0].noten[0].beat, neu(2, 3)[0].noten[0].laenge], [0.75, 1]);
  assert.equal(klickBefehle(spur, spur.clips[0], 40, 0, 'slice', info)[0].noten[0].laenge, 0.25, 'a foreign row: one step');
});
test('slice grid: the value lanes VELOCITY, LENGTH, REVERSE; refusals', () => {
  const spur = sliceSpur([{ id: 'n1', beat: 0.5, laenge: 0.25, ton: 64 + 3, vel: 100 }, { id: 'n2', beat: 1, laenge: 1, ton: 3, vel: 80 }]);
  const clip = spur.clips[0], f = fenster({ sicht: 1, start: 0 }, 1);
  assert.deepEqual(wertBefehle(clip, 3, 2, 'vel', 64, 'slice'), [{ befehl: 'noten_aendern', clip_id: 'c_s', noten: [{ id: 'n1', vel: 64 }] }]);
  assert.deepEqual(wertBefehle(clip, 3, 4, 'laenge', 2, 'slice')[0].noten, [{ id: 'n2', laenge: 0.5 }]);
  const r = wertZellen(clip, 3, f, 'rueck', 'slice');
  assert.deepEqual([r[2], r[4], r[3]].map((x) => [x.da, x.wert, x.anders]), [[true, 1, true], [true, 0, false], [false, null, false]]);
  assert.deepEqual(wertZellen(clip, 3, f, 'vel', 'slice')[2].wert, 100);
  assert.throws(() => wertZellen(clip, 3, f, 'rueck'), SeqFehler, 'REVERSE exists in a slice grid only');
  assert.throws(() => wertBefehle(clip, 3, 2, 'rueck', 1), SeqFehler);
  assert.throws(() => rueckBefehle(clip, 3, 3), (e) => e instanceof SeqFehler && e.message.includes('no note starts in this step'), 'a step without a hit');
  assert.throws(() => rueckBefehle(clip, 2, 2), SeqFehler, 'another row has no hit there');
  assert.throws(() => rueckBefehle(null, 3, 2), SeqFehler);
  assert.throws(() => klickBefehle({ id: 's1', art: 'instrument', clips: [{ id: 'c', art: 'midi', start_beat: 8, laenge_beats: 16, noten: [] }] }, { id: 'c', noten: [] }, 3, 0, 'slice', SLICE_INFO), SeqFehler);
  assert.throws(() => klickBefehle(spur, clip, 3, 16, 'slice', SLICE_INFO), SeqFehler, 'a step outside the pattern');
});

// ---- SLICE grid: a hit belongs to the NEAREST step (fix round 2) ----
// A hit sits a few milliseconds in front of its step (a cut at the hits, a rounded slice bound). The window of step q is [q - 1/2, q + 1/2) steps; a hit in
// the last half cell of the pattern is the upbeat of the next pass and belongs to step 1 (index 0). DRUM and NOTE grids keep rounding down.
test('slice grid: a hit just before its step belongs to that step; the last half cell belongs to step 1; drum and note grids round down', () => {
  const spur = sliceSpur([{ id: 'v', beat: 0.994, laenge: 0.25, ton: 3, vel: 80 }, { id: 'w', beat: 3.99, laenge: 0.25, ton: 3, vel: 90 }], 4);
  const clip = spur.clips[0], f = fenster({ sicht: 1, start: 0 }, 1);
  const z = zellen(clip, 3, f, 'slice');
  assert.deepEqual([z[3].an, z[4].an, z[15].an, z[0].an], [false, true, false, true], 'beat 0.994 is step 5, beat 3.99 is step 1 of the next pass');
  assert.deepEqual([z[4].vel, z[0].vel], [80, 90]);
  assert.deepEqual([zellen(clip, 3, f)[3].an, zellen(clip, 3, f)[4].an, zellen(clip, 3, f)[15].an], [true, false, true], 'the drum grid rounds down: the same hits are in steps 4 and 16');
  // a hit just after its step stays, and the half cell edges: 0.875 is step 5 (round half up), 1.1249 is still step 5
  const rand = sliceSpur([{ id: 'a', beat: 1.004, laenge: 0.25, ton: 3, vel: 100 }, { id: 'b', beat: 0.875, laenge: 0.25, ton: 2, vel: 100 }, { id: 'c', beat: 1.1249, laenge: 0.25, ton: 1, vel: 100 }], 4).clips[0];
  assert.ok(zellen(rand, 3, f, 'slice')[4].an && zellen(rand, 2, f, 'slice')[4].an && zellen(rand, 1, f, 'slice')[4].an);
  assert.ok(!zellen(rand, 2, f, 'slice')[3].an);
  // click on step 5 deletes the hit at 0.994, a click on step 4 adds a hit; step 1 deletes the one at 3.99
  assert.deepEqual(klickBefehle(spur, clip, 3, 4, 'slice', SLICE_INFO), [{ befehl: 'noten_loeschen', clip_id: 'c_s', ids: ['v'] }]);
  assert.deepEqual(klickBefehle(spur, clip, 3, 0, 'slice', SLICE_INFO), [{ befehl: 'noten_loeschen', clip_id: 'c_s', ids: ['w'] }]);
  assert.equal(klickBefehle(spur, clip, 3, 3, 'slice', SLICE_INFO)[0].befehl, 'noten_neu');
  // value lanes see them in their own step
  assert.deepEqual(wertBefehle(clip, 3, 4, 'vel', 64, 'slice'), [{ befehl: 'noten_aendern', clip_id: 'c_s', noten: [{ id: 'v', vel: 64 }] }]);
  assert.deepEqual(wertBefehle(clip, 3, 0, 'laenge', 2, 'slice')[0].noten, [{ id: 'w', laenge: 0.5 }]);
  assert.deepEqual(wertBefehle(clip, 3, 4, 'rueck', 1, 'slice')[0].noten, [{ id: 'v', ton: 67 }]);
  assert.deepEqual(rueckBefehle(clip, 3, 0)[0].noten, [{ id: 'w', ton: 67 }]);
  assert.deepEqual(wertZellen(clip, 3, f, 'vel', 'slice').map((x) => x.wert).filter((x) => x !== null), [90, 80]);
  assert.throws(() => wertBefehle(clip, 3, 3, 'vel', 64, 'slice'), SeqFehler, 'step 4 has no hit any more');
});

// ---- PITCH lane of the slice grid (sampler A2 task 7): a step lock on geraet.k3, whole semitones -12..12 ----
// A value on step s holds for the hits of step s only (the window [s - 1/2, s + 1/2) steps); every step without a value of its own plays the track knob (offset 0).
const mitKurve = (spur, befehle) => {
  const b = befehle.find((x) => x.befehl === 'huellkurve_setzen');
  const clip = { ...spur.clips[0], huellkurven: b ? [{ ziel: b.ziel, punkte: b.punkte }] : [] };
  return { ...spur, clips: [clip] };
};
const pitchSpur = (k3 = 0.5) => { const sp = sliceSpur([], 4); return { ...sp, geraet: { ...sp.geraet, parameter: { k3 } } }; };
const f1 = fenster({ sicht: 1, start: 0 }, 1);
// write a list of [step, semitones] one after the other, each on the result of the one before; returns { spur, befehle of the last one }
function schreibe(spur, liste) {
  let letzte = [];
  for (const [q, h] of liste) { letzte = pitchBefehle(spur, spur.clips[0], q, h, SLICE_INFO); spur = mitKurve(spur, letzte); }
  return { spur, letzte };
}
const zeigt = (spur, f = f1) => pitchZellen(spur, spur.clips[0], f, SLICE_INFO);
test('PITCH is a step lock: the first value changes its own step only', () => {
  const spur = pitchSpur(0.5), clip = spur.clips[0];
  const b = pitchBefehle(spur, clip, 4, 12, SLICE_INFO);
  // 12 semitones = knob 1.0 = an offset of 0.5 from the track knob; the value holds from half a step before step 5 (beat 0.875) to half a step after (1.125)
  assert.deepEqual(b, [{ befehl: 'huellkurve_setzen', clip_id: clip.id, ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }, { beat: 0.875, wert: 0.5, form: 'sprung' }, { beat: 1.125, wert: 0, form: 'sprung' }] }]);
  const z = zeigt(mitKurve(spur, b));
  assert.equal(z.length, 16);
  assert.deepEqual([z[4].halb, z[4].eigen], [12, true]);
  assert.ok(z.filter((x) => x.schritt !== 4).every((x) => x.halb === 0 && x.eigen === false), 'steps 0-3 and 5-15 play the track knob and are not their own');
  assert.deepEqual([z[4].schritt, z[4].quelle], [4, 4]);
  assert.throws(() => pitchBefehle(spur, clip, 4, 13, SLICE_INFO), SeqFehler);
  assert.throws(() => pitchBefehle(spur, clip, 4, -13, SLICE_INFO), SeqFehler);
  assert.throws(() => pitchBefehle(spur, clip, 4, 1.5, SLICE_INFO), SeqFehler, 'whole semitones only');
  assert.throws(() => pitchBefehle(spur, clip, 4, undefined, SLICE_INFO), SeqFehler);
  assert.throws(() => pitchBefehle(spur, clip, 16, 0, SLICE_INFO), SeqFehler, 'a step outside the pattern');
  assert.throws(() => pitchBefehle(spur, null, 4, 0, SLICE_INFO), SeqFehler);
});
test('PITCH: neighbours share no return point, the one after the pair returns; a second value elsewhere; the track knob as base', () => {
  const { spur, letzte } = schreibe(pitchSpur(0.5), [[4, 12], [5, -5]]);
  assert.deepEqual(letzte[0].punkte, [{ beat: 0, wert: 0 }, { beat: 0.875, wert: 0.5, form: 'sprung' }, { beat: 1.125, wert: -0.208333333, form: 'sprung' }, { beat: 1.375, wert: 0, form: 'sprung' }]);
  const z = zeigt(spur);
  assert.deepEqual([3, 4, 5, 6].map((i) => [z[i].halb, z[i].eigen]), [[0, false], [12, true], [-5, true], [0, false]]);
  // a track knob of 0.75 (+6): the steps without a value show +6; a value of -12 is an offset of -0.75; writing +6 is no value of its own
  const b = schreibe(pitchSpur(0.75), [[4, -12]]);
  assert.deepEqual(b.letzte[0].punkte.find((p) => p.beat === 0.875), { beat: 0.875, wert: -0.75, form: 'sprung' });
  assert.deepEqual([3, 4, 5].map((i) => [zeigt(b.spur)[i].halb, zeigt(b.spur)[i].eigen]), [[6, false], [-12, true], [6, false]]);
  assert.deepEqual(pitchBefehle(pitchSpur(0.75), pitchSpur(0.75).clips[0], 4, 6, SLICE_INFO), [], 'the track knob value is no value of its own');
  // a repeat shows the step it repeats
  const z2 = zeigt(b.spur, fenster({ sicht: 2, start: 0 }, 2));
  assert.equal(z2.length, 32);
  assert.deepEqual([z2[20].schritt, z2[20].quelle, z2[20].halb, z2[20].eigen, z2[20].wiederholung], [20, 4, -12, true, true]);
  assert.deepEqual(pitchZellen(null, null, f1, null).slice(0, 2).map((x) => [x.halb, x.eigen]), [[0, false], [0, false]], 'no track, no clip: the default knob');
});
test('PITCH: the last step returns over the loop seam, step 1 takes the upbeat', () => {
  const letzte = schreibe(pitchSpur(0.5), [[15, 7]]).letzte;
  assert.deepEqual(letzte[0].punkte, [{ beat: 0, wert: 0 }, { beat: 3.625, wert: 0.291666667, form: 'sprung' }, { beat: 3.875, wert: 0, form: 'sprung' }], 'the last window ends half a step before the loop end, step 1 takes over');
  const erste = schreibe(pitchSpur(0.5), [[0, 12]]).letzte;
  assert.deepEqual(erste[0].punkte, [{ beat: 0, wert: 0.5 }, { beat: 0.125, wert: 0, form: 'sprung' }, { beat: 3.875, wert: 0.5, form: 'sprung' }], 'step 1 holds from the upbeat (beat 3.875) to half a step in');
  const beide = schreibe(pitchSpur(0.5), [[0, 12], [15, 7]]).letzte;
  assert.deepEqual(beide[0].punkte, [{ beat: 0, wert: 0.5 }, { beat: 0.125, wert: 0, form: 'sprung' }, { beat: 3.625, wert: 0.291666667, form: 'sprung' }, { beat: 3.875, wert: 0.5, form: 'sprung' }]);
});
test('PITCH null (or the track knob value) removes the value of a step, the last one removes the envelope; nothing to remove sends nothing', () => {
  const spur0 = pitchSpur(0.5);
  assert.deepEqual(pitchBefehle(spur0, spur0.clips[0], 4, null, SLICE_INFO), [], 'no lane yet');
  const { spur: s1 } = schreibe(spur0, [[4, 12], [8, -3]]);
  assert.deepEqual(pitchBefehle(s1, s1.clips[0], 6, null, SLICE_INFO), [], 'a step without a value of its own');
  assert.deepEqual(pitchBefehle(s1, s1.clips[0], 4, 12, SLICE_INFO), [], 'the same value again');
  const eins = pitchBefehle(s1, s1.clips[0], 8, null, SLICE_INFO);
  assert.deepEqual(eins[0].punkte, [{ beat: 0, wert: 0 }, { beat: 0.875, wert: 0.5, form: 'sprung' }, { beat: 1.125, wert: 0, form: 'sprung' }], 'one value left, its return point stays');
  assert.deepEqual(pitchBefehle(s1, s1.clips[0], 8, 0, SLICE_INFO)[0].punkte, eins[0].punkte, 'writing the knob value is the same as removing');
  const { spur: s2 } = schreibe(spur0, [[4, 12]]);
  assert.deepEqual(pitchBefehle(s2, s2.clips[0], 4, null, SLICE_INFO), [{ befehl: 'huellkurve_loeschen', clip_id: 'c_s', ziel: 'geraet.k3' }], 'the only value: the envelope goes');
  assert.deepEqual(pitchBefehle(s2, s2.clips[0], 4, 0, SLICE_INFO), [{ befehl: 'huellkurve_loeschen', clip_id: 'c_s', ziel: 'geraet.k3' }]);
});
test('PITCH: equal neighbours share one window; the written list reads back as exactly the own steps; a drawn envelope is read at the step beats', () => {
  const { spur: s1, letzte } = schreibe(pitchSpur(0.5), [[4, 12], [5, 12]]);
  assert.deepEqual(letzte[0].punkte, [{ beat: 0, wert: 0 }, { beat: 0.875, wert: 0.5, form: 'sprung' }, { beat: 1.375, wert: 0, form: 'sprung' }], 'no point between equal neighbours');
  assert.deepEqual(zeigt(s1).map((x) => x.eigen).flatMap((e, i) => (e ? [i] : [])), [4, 5]);
  const liste = [[0, 12], [4, 3], [5, 3], [6, -7], [15, -12]];
  const { spur: s2 } = schreibe(pitchSpur(0.5), liste);
  const z = zeigt(s2);
  assert.deepEqual(z.flatMap((x, i) => (x.eigen ? [i] : [])), [0, 4, 5, 6, 15], 'the own steps and no others');
  assert.deepEqual([0, 4, 5, 6, 15].map((i) => z[i].halb), [12, 3, 3, -7, -12]);
  assert.ok(z.filter((x, i) => ![0, 4, 5, 6, 15].includes(i)).every((x) => x.halb === 0 && !x.eigen));
  // every written value is read back from the written list: removing one step leaves the others unchanged
  const ohne = pitchBefehle(s2, s2.clips[0], 5, null, SLICE_INFO);
  assert.deepEqual(zeigt(mitKurve(s2, ohne)).flatMap((x, i) => (x.eigen ? [i] : [])), [0, 4, 6, 15]);
  // a hand-drawn linear envelope (0 at beat 0 to +0.5 at beat 2) is read at the step beats: step 5 (beat 1) holds +0.25 = 6 semitones
  const hand = { ...pitchSpur(0.5) };
  hand.clips = [{ ...hand.clips[0], huellkurven: [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }, { beat: 2, wert: 0.5 }] }] }];
  const zh = zeigt(hand);
  assert.deepEqual([zh[0], zh[4], zh[8], zh[12]].map((x) => [x.halb, x.eigen]), [[0, false], [6, true], [12, true], [12, true]]);
});
