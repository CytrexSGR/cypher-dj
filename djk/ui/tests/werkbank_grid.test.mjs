// Workbench task 6: the pure grid model (public/werkbank/grid.js). Window, counting, rows, cells, values, commands. No DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fenster, blaettere, taktWahl, leiste, zaehlung, drumZeilen, tonZeilen, startOben, radOben, oktavLeiste, zustand, zellen, musterTakte, zuLang,
  klickBefehle, wertZellen, wertBefehle, musterLaengeBefehle, SCHRITT, SCHRITTE_TAKT, SICHTEN, TON_MIN, TON_MAX, FENSTER, RAD, VEL_VORGABE, LAENGE_VORGABE,
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
  assert.deepEqual(fenster({ sicht: 4, start: 0 }, 2), { sicht: 4, breite: 2, start: 0, takte: [0, 1] });
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
test('pattern length: shortening reports what it deletes; longer than the module is flagged', () => {
  const s = vorlage().bass;
  assert.equal(musterLaengeBefehle(s, s.clips[0], 2).geloescht, 24);
  assert.equal(musterLaengeBefehle(s, s.clips[0], 8).geloescht, 0);
  assert.equal(musterLaengeBefehle(s, s.clips[0], 2).befehle.at(-1).loop_beats, 8);
  assert.throws(() => musterLaengeBefehle(s, s.clips[0], 3), SeqFehler);
  assert.equal(zuLang({ ...s.clips[0], loop_beats: 32 }, 4), true);
  assert.equal(zuLang(s.clips[0], 4), false);
});
