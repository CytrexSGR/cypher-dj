// Slice 7 (D14): pure parts of "Merge Tracks" on the page: tracks of the selection, range, menu items, action, run text, texts of the reasons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSpuren, mergeBereich, mergePunkte, mergeAktion } from '../oeffentlich/produktion/merge.js';
import { laufText } from '../oeffentlich/produktion/ausgabe.js';
import { FEHLER_TEXT } from '../oeffentlich/produktion/produktion.js';

const au = (id, a, l, extra = {}) => ({ id, art: 'audio', start_beat: a, laenge_beats: l, dekodiert: 'fertig', ...extra });
const spur = (id, clips, extra = {}) => ({ id, clips, ...extra });
const projekt = (extra = {}) => ({ loop: { an: false, von_beat: 0, bis_beat: 32 },
  spuren: [spur('s1', [au('c1', 4, 8), au('c2', 20, 4)]), spur('s2', [au('c3', 8, 8)]), spur('s3', [au('c4', 0, 4)])], ...extra });

test('S7 page: mergeSpuren = tracks of the chosen clips, a click outside the selection selects anew, two clips of one track are one', () => {
  const p = projekt();
  assert.deepEqual(mergeSpuren(p, ['c3', 'c1'], 'c3'), ['s1', 's2']);
  assert.deepEqual(mergeSpuren(p, ['c3', 'c1'], 'c4'), ['s3'], 'click outside the selection');
  assert.deepEqual(mergeSpuren(p, ['c1', 'c2'], 'c1'), ['s1'], 'two clips of one track');
});

test('S7 page: mergeBereich = loop bracket when on and 1..1024 beats, else the hull of the clips', () => {
  const sp = ['s1', 's2'];
  assert.deepEqual(mergeBereich(projekt({ loop: { an: true, von_beat: 4.123, bis_beat: 12 } }), sp), { von_beat: 4.12, bis_beat: 12 });
  assert.deepEqual(mergeBereich(projekt(), sp), { von_beat: 4, bis_beat: 24 }, 'no loop: hull');
  assert.deepEqual(mergeBereich(projekt({ loop: { an: true, von_beat: 0, bis_beat: 2000 } }), sp), { von_beat: 4, bis_beat: 24 }, 'loop over 1024 beats: hull');
});

test('S7 page: mergePunkte text with numbers, aus in each of the six cases, the normal case is not aus', () => {
  const p = projekt(), c = p.spuren[0].clips[0];
  const [ok] = mergePunkte(p, ['c1', 'c3'], c, null);
  assert.equal(ok.text, 'Merge Tracks (2 tracks, beats 4–24)');
  assert.equal(ok.aus, false, 'negative control: the normal case is not aus');
  assert.deepEqual(ok.koerper, { spur_ids: ['s1', 's2'], von_beat: 4, bis_beat: 24 });
  assert.equal(mergePunkte(p, ['c1', 'c3'], c, { art: 'export' })[0].aus, true, 'run');
  const einzeln = mergePunkte(p, ['c1'], c, null)[0];
  assert.equal(einzeln.aus, true, 'fewer than two tracks (audio clip alone)');
  assert.match(einzeln.text, /^Merge Tracks \(1 track, beats /, 'singular for one track');
  const kurz = projekt({ loop: { an: true, von_beat: 0, bis_beat: 0.5 } });
  assert.equal(mergePunkte(kurz, ['c1', 'c3'], c, null)[0].aus, false, 'short loop falls back to the hull');
  const lang = projekt(); lang.spuren[1].clips[0] = au('c3', 8, 5000);
  assert.equal(mergePunkte(lang, ['c1', 'c3'], c, null)[0].aus, true, 'range over 1024 beats');
  const roh = projekt(); roh.spuren[1].clips[0].dekodiert = 'laeuft';
  assert.equal(mergePunkte(roh, ['c1', 'c3'], c, null)[0].aus, true, 'not decoded');
  const surge = projekt();
  surge.spuren[1] = spur('s2', [{ id: 'c3', art: 'midi', start_beat: 8, laenge_beats: 8, noten: [{ beat: 0 }] }], { geraet: { art: 'wirt' } });
  const sg = mergePunkte(surge, ['c1', 'c3'], c, null)[0];
  assert.equal(sg.aus, true, 'Surge with notes and no freeze'); assert.match(sg.grund, /Freeze/);
  surge.spuren[1].freeze = { datei: 'x' };
  assert.equal(mergePunkte(surge, ['c1', 'c3'], c, null)[0].aus, false, 'frozen: not aus');
  const solo = projekt(); solo.spuren[0].solo = true;
  const so = mergePunkte(solo, ['c1', 'c3'], c, null)[0];
  assert.equal(so.aus, true, 'partial solo'); assert.match(so.grund, /Solo all or none/);
  solo.spuren[1].solo = true;
  assert.equal(mergePunkte(solo, ['c1', 'c3'], c, null)[0].aus, false, 'solo on all: not aus');
  const midi = { id: 'm1', art: 'midi', start_beat: 0, laenge_beats: 4 };
  assert.deepEqual(mergePunkte(p, ['m1'], midi, null), [], 'MIDI clip without a second track: no item');
});

test('S7 page: mergeAktion shows the text of the reason (never Rejected) and the hint text', async () => {
  const meldungen = [];
  const melde = (t, f) => meldungen.push([t, !!f]);
  const p = { koerper: { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 8 } };
  const ctx = (antwort, fehlerText = () => 'x') => ({ zusammenfuehren: async () => antwort, melde, fehlerText });
  await mergeAktion(p, ctx({ rev: 3, spur_id: 's3' }));
  await mergeAktion(p, ctx({ rev: 3, spur_id: 's3', hinweis: 'quellen_laenger' }));
  await mergeAktion(p, ctx({ status: 409, j: { fehler: 'merge_gruppen' } }, (r) => FEHLER_TEXT[r.j.fehler]));
  await mergeAktion(p, ctx(null));
  assert.deepEqual(meldungen, [['Merged 2 tracks into one', false],
    ['Merged 2 tracks into one (the sources are muted completely, also outside the range)', false], [FEHLER_TEXT.merge_gruppen, true]]);
  assert.ok(!meldungen.some(([t]) => /Rejected/.test(t)));
});

test('S7 page: laufText for a merge run, and each of the six reasons has a text in FEHLER_TEXT', () => {
  assert.equal(laufText({ art: 'merge', seit: 1000 }, null, 4000), 'Merging tracks · 3 s');
  for (const g of ['merge_sends', 'merge_leer', 'merge_gruppen', 'merge_teil_solo', 'merge_freeze_noetig', 'merge_andreas_spur', 'merge_keine_spur_frei']) {
    assert.ok(typeof FEHLER_TEXT[g] === 'string' && FEHLER_TEXT[g].length > 5, `${g} has a text`);
  }
});
