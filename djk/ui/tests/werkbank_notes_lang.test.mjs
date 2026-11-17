// Studio note grid 2026-11-17: long notes (drag), the key in the rows, chords, transformations of the selection, arpeggio, key search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fenster, tonZeilen, zellen, deckung } from '../public/werkbank/grid.js';
import { schiebeNotenBefehle, kopfZelle, laengeBefehle, langeNoteBefehle, akkordBefehle, formeBefehle, arpBefehle, findeTonart, wirkNoten } from '../public/werkbank/grid_seq.js';
import { SeqFehler } from '../public/seq_logic.js';

const aMoll = { grundton: 9, skala: 'minor' };
const klip = (noten) => ({ id: 'c1', art: 'midi', start_beat: 0, laenge_beats: 64, loop_beats: 16, noten });
const n = (id, beat, ton, laenge = 0.25, vel = 100) => ({ id, beat, laenge, ton, vel });
const f1 = fenster({ sicht: 1, start: 0 }, 4);

test('rows carry the key, SCALE shows the pitches of the key and every pitch in use', () => {
  const c = klip([n('a', 0, 56)]);   // G#2 is outside A minor
  const alle = tonZeilen(59, false, c, aMoll);
  assert.equal(alle.length, 24);
  assert.equal(alle.find((z) => z.ton === 57).grundton, true);
  assert.equal(alle.find((z) => z.ton === 57).inskala, true);
  assert.equal(alle.find((z) => z.ton === 58).inskala, false);
  assert.equal('inskala' in tonZeilen(59, false, c)[0], false);   // no key: rows as before
  const nur = tonZeilen(59, false, c, aMoll, true);
  assert.equal(nur.filter((z) => z.inskala).length, 24);
  assert.ok(nur.some((z) => z.ton === 56), 'a used pitch outside the key stays visible');
  assert.ok(!nur.some((z) => z.ton === 58));
  assert.equal(nur[0].ton, 59);
});

test('a long note covers its steps: body cells and the grip on the last one', () => {
  const c = klip([n('a', 0.5, 60, 1)]);   // steps 2..5
  const zs = zellen(c, 60, f1, 'note');
  assert.deepEqual(zs.slice(1, 7).map((z) => [z.an, !!z.fort, !!z.griff]), [[false, false, false], [true, false, false], [false, true, false], [false, true, false], [false, true, true], [false, false, false]]);
  assert.equal(zs[4].kopf, 2);
  assert.equal(deckung(c, 60, 64).get(5).kopf, 2);
  assert.equal(kopfZelle(c, 60, 4, 'note'), 2);
  assert.equal(kopfZelle(c, 60, 2, 'note'), 2);
  assert.equal(kopfZelle(c, 60, 6, 'note'), null);
  assert.equal(kopfZelle(c, 60, 4, 'drum'), null);
});

test('pulling the end of a note sets its length and swallows notes it runs over', () => {
  const c = klip([n('a', 0, 60), n('b', 0.5, 60), n('c', 0.5, 62)]);
  assert.deepEqual(laengeBefehle(c, 'note', 60, 0, 3), [
    { befehl: 'noten_loeschen', clip_id: 'c1', ids: ['b'] },
    { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'a', laenge: 1 }] },
  ]);
  assert.deepEqual(laengeBefehle(c, 'note', 60, 0, 0), []);                       // already one step
  assert.deepEqual(laengeBefehle(c, 'note', 60, 0, -5), []);                      // never shorter than one step
  assert.deepEqual(laengeBefehle(c, 'note', 60, 2, 999)[0].noten, [{ id: 'b', laenge: 15.5 }]);   // ends with the pattern
  assert.deepEqual(laengeBefehle(c, 'note', 60, 7, 9), []);                       // no note starts there
  assert.deepEqual(laengeBefehle(c, 'note', 60, 0, 1, 8), [{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['b'] }, { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'a', laenge: 1 }] }]);   // 8 steps per bar: two cells are a beat
});

test('dragging over empty steps writes one note, in either direction', () => {
  const c = klip([n('a', 0, 60, 1), n('b', 1.5, 60)]);
  const r = langeNoteBefehle(c, 'note', 60, 8, 2);
  assert.deepEqual(r, [
    { befehl: 'noten_loeschen', clip_id: 'c1', ids: ['b'] },
    { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'a', laenge: 0.5 }] },   // the note before it ends in front of it
    { befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 0.5, laenge: 1.75, ton: 60, vel: 100 }] },
  ]);
  assert.throws(() => langeNoteBefehle(null, 'note', 60, 0, 1), SeqFehler);
});

test('CHORD writes the chord of the key, a minor triad without a key', () => {
  const c = klip([]);
  assert.deepEqual(akkordBefehle(c, 'note', 60, 0, 3, aMoll)[0].noten.map((x) => [x.ton, x.beat, x.laenge]), [[60, 0, 1], [64, 0, 1], [67, 0, 1]]);
  assert.deepEqual(akkordBefehle(c, 'note', 60, 4, 4, null)[0].noten.map((x) => x.ton), [60, 63, 67]);
});

test('transformations work on the selection, or on all notes, and the selection follows', () => {
  const c = klip([n('a', 0, 57, 1), n('b', 0, 60, 1), n('c', 0, 64, 1), n('d', 4, 61, 1), n('aus', 20, 70)]);
  assert.deepEqual(wirkNoten(c, 'note', []).map((x) => x.id), ['a', 'b', 'c', 'd']);   // the note behind the pattern end is not part of it
  const sel = [{ ton: 57, quelle: 0 }, { ton: 60, quelle: 0 }];
  const t = formeBefehle(c, 'note', sel, 'halb', -2);
  assert.deepEqual(t.befehle, [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'a', ton: 55 }, { id: 'b', ton: 58 }] }]);
  assert.deepEqual(t.auswahl, [{ ton: 55, quelle: 0 }, { ton: 58, quelle: 0 }]);
  assert.deepEqual(formeBefehle(c, 'note', [], 'umkehr', 1).befehle[0].noten, [{ id: 'a', ton: 69 }]);
  assert.deepEqual(formeBefehle(c, 'note', [], 'tonart', 0, aMoll).befehle[0].noten, [{ id: 'd', ton: 60 }]);
  assert.deepEqual(formeBefehle(c, 'note', sel, 'stufe', 1, aMoll).befehle[0].noten, [{ id: 'a', ton: 59 }, { id: 'b', ton: 62 }]);
  assert.throws(() => formeBefehle(c, 'note', [], 'tonart', 0, null), SeqFehler);
  assert.deepEqual(formeBefehle(c, 'note', [{ ton: 99, quelle: 3 }], 'halb', 1), { befehle: [], auswahl: [{ ton: 99, quelle: 3 }] });
});

test('ARP turns the chords into steps of the view and selects them', () => {
  const c = klip([n('a', 0, 57, 1), n('b', 0, 60, 1), n('c', 0, 64, 1), n('solo', 4, 72, 1)]);
  const r = arpBefehle(c, 'note', [], 'up');
  assert.deepEqual(r.befehle[0], { befehl: 'noten_loeschen', clip_id: 'c1', ids: ['a', 'b', 'c'] });
  assert.deepEqual(r.befehle[1].noten.map((x) => [x.beat, x.ton]), [[0, 57], [0.25, 60], [0.5, 64], [0.75, 57]]);
  assert.deepEqual(r.auswahl, [{ ton: 57, quelle: 0 }, { ton: 60, quelle: 1 }, { ton: 64, quelle: 2 }, { ton: 57, quelle: 3 }]);
  assert.deepEqual(arpBefehle(c, 'note', [], 'up', 8).befehle[1].noten.map((x) => x.beat), [0, 0.5]);
  assert.deepEqual(arpBefehle(klip([n('solo', 4, 72, 1)]), 'note', [], 'up').befehle, []);
  assert.throws(() => arpBefehle(c, 'note', [], 'zufall'), SeqFehler);
});

test('FIND names the key of the pattern', () => {
  const prog = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [57, 60, 64]];
  const c = klip(prog.flatMap((toene, i) => toene.map((ton, j) => n(`n${i}${j}`, i * 4, ton, 4))));
  const r = findeTonart(c);
  assert.deepEqual(r.befehl, { befehl: 'tonart_setzen', grundton: 9, skala: 'minor' });
  assert.match(r.text, /^Key set to A minor: 100 % of the notes fit/);
  assert.equal(findeTonart(klip([])), null);
});

test('dragging a note moves it and the notes selected with it, inside the pattern', () => {
  const c = klip([n('a', 0, 57, 1), n('b', 0, 60, 1), n('c', 2, 62), n('ziel', 1, 59)]);
  const eine = schiebeNotenBefehle(c, 'note', [{ ton: 57, quelle: 0 }], 4, 2);
  assert.deepEqual(eine.befehle, [
    { befehl: 'noten_loeschen', clip_id: 'c1', ids: ['ziel'] },                                  // the note it lands on goes
    { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'a', beat: 1, ton: 59 }] },
  ]);
  assert.deepEqual(eine.auswahl, [{ ton: 59, quelle: 4 }]);
  assert.deepEqual(eine.zellen, [{ ton: 59, quelle: 4, laenge: 4 }]);
  const zwei = schiebeNotenBefehle(c, 'note', [{ ton: 57, quelle: 0 }, { ton: 60, quelle: 0 }], -3, 12);
  assert.deepEqual(zwei.befehle, [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'a', ton: 69 }, { id: 'b', ton: 72 }] }]);   // never before the start
  assert.deepEqual(schiebeNotenBefehle(c, 'note', [{ ton: 62, quelle: 8 }], 999, 0).befehle[0].noten, [{ id: 'c', beat: 15.75 }]);   // nor behind the end
  assert.deepEqual(schiebeNotenBefehle(c, 'note', [{ ton: 62, quelle: 8 }], 0, 0).befehle, []);
  assert.deepEqual(schiebeNotenBefehle(c, 'note', [{ ton: 99, quelle: 3 }], 1, 1), { befehle: [], auswahl: [], zellen: [] });
  assert.deepEqual(schiebeNotenBefehle(c, 'note', [{ ton: 62, quelle: 4 }], 1, 0, 8).befehle[0].noten, [{ id: 'c', beat: 2.5 }]);   // 8 steps per bar
});
