// Workbench dock/sequencer, strand B: per-note fields (chance, wdh, versatz), per-row fields (MidiClip.zeilen), the unrolling that reads them
// (fuerAusgerollteNoten), the commands noten_neu / noten_aendern / zeile_setzen / werkbank_bereich, the module length and the export range.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeFehler, pruefeProjekt, wiedergabeSicht } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { fuerAusgerollteNoten, zaehleAusgerollt } from '../project/playback.ts';
import { werkbankPruefung } from '../project/werkbank.ts';
import { midiTeile } from '../project/export_midi.ts';
import { kopie } from './support/project.mjs';
import { aufbau } from './support/output_setup.mjs';
import { alsAntwort } from '../areas/proj/output.ts';

const klip = (o) => ({ id: 'c', art: 'midi', name: 'c', start_beat: 0, laenge_beats: 4, noten: [], ...o });
const n = (id, beat, ton, extra = {}) => ({ id, beat, laenge: 0.125, ton, vel: 100, ...extra });
const rolle = (c) => {
  const aus = [];
  fuerAusgerollteNoten(c, (id, beat, laenge, no) => { aus.push({ id, beat, laenge, ton: no.ton, vel: no.vel }); });
  return aus.sort((x, y) => x.beat - y.beat || (x.id < y.id ? -1 : 1));
};
const beats = (c, ton) => rolle(c).filter((x) => x.ton === ton).map((x) => x.beat);
const nah = (a, b) => { assert.equal(a.length, b.length, `${a} vs ${b}`); a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `${a} vs ${b}`)); };

// the unrolling as it was before the new fields (reference for the byte-equal test)
function alt(c) {
  const aus = [];
  const ende = c.start_beat + c.laenge_beats, loop = c.loop_beats ?? null;
  if (loop === null) {
    for (const x of c.noten) { const beat = c.start_beat + x.beat; if (beat < ende) aus.push([`${c.id}/${x.id}`, beat, Math.min(x.laenge, ende - beat), x.ton, x.vel]); }
    return aus;
  }
  for (let k = 0; k * loop < c.laenge_beats - 1e-9; k++) {
    const basis = c.start_beat + k * loop, kopieEnde = Math.min(basis + loop, ende);
    for (const x of c.noten) { const beat = basis + x.beat; if (beat < kopieEnde) aus.push([`${c.id}~${k}/${x.id}`, beat, Math.min(x.laenge, kopieEnde - beat), x.ton, x.vel]); }
  }
  return aus;
}

test('a clip without the new fields unrolls byte for byte as before (looped, unlooped, offset start), and the playback view has no zeilen key', () => {
  const noten = [n('a', 0, 36), n('b', 0.5, 38, { laenge: 3 }), n('c', 2.75, 42), n('d', 7, 36)];
  for (const c of [klip({ noten }), klip({ noten, loop_beats: 2, laenge_beats: 9 }), klip({ noten, start_beat: 3.5, loop_beats: 3, laenge_beats: 10 })]) {
    const neu = [];
    fuerAusgerollteNoten(c, (id, beat, laenge, no) => { neu.push([id, beat, laenge, no.ton, no.vel]); });
    assert.equal(JSON.stringify(neu), JSON.stringify(alt(c)));
  }
  const p = neuesProjekt('x');
  assert.equal(JSON.stringify(wiedergabeSicht(p)).includes('zeilen'), false);
});

test('row length: 6 steps against 16 steps over 4 bars give exact beats, independent of loop_beats; notes past the row length are silent', () => {
  const c = klip({ laenge_beats: 16, noten: [n('k6', 0, 36), n('k6b', 1.25, 36), n('k6x', 1.5, 36), n('k16', 0, 38)],
    zeilen: { 36: { schritte: 6 }, 38: { schritte: 16 } } });
  nah(beats(c, 36), [0, 1.25, 1.5, 2.75, 3, 4.25, 4.5, 5.75, 6, 7.25, 7.5, 8.75, 9, 10.25, 10.5, 11.75, 12, 13.25, 13.5, 14.75, 15]);
  nah(beats(c, 38), [0, 4, 8, 12]);
  // the note at step 6 of a 6-step row (beat 1.5) is the next pass's first position, not part of this pass: it never sounds as its own note
  assert.equal(rolle(c).filter((x) => x.id.endsWith('/k6x')).length, 0);
  const lang = klip({ laenge_beats: 16, loop_beats: 8, noten: [n('a', 0, 36)], zeilen: { 36: { schritte: 6 } } });
  assert.equal(beats(lang, 36).length, 11, 'the clip loop of 8 beats does not touch a row with its own length');
});

test('row length: the last pass is cut at the clip end and a note behind it is silent', () => {
  const c = klip({ laenge_beats: 4, noten: [n('a', 0, 36, { laenge: 2 }), n('b', 1, 36)], zeilen: { 36: { schritte: 6 } } });
  const r = rolle(c);
  assert.deepEqual(r.map((x) => [x.id, x.beat, x.laenge]), [['c~0/a', 0, 1.5], ['c~0/b', 1, 0.125], ['c~1/a', 1.5, 1.5], ['c~2/a', 3, 1],
    ['c~1/b', 2.5, 0.125]].sort((x, y) => x[1] - y[1]), 'a note is cut at its pass end; pass 2 starts at beat 3 and ends with the clip at 4');
});

test('pendel: every second pass of the row runs backwards; with own length, with the clip loop, and not at all without a loop', () => {
  const c = klip({ noten: [n('a', 0, 36), n('b', 0.25, 36)], zeilen: { 36: { schritte: 4, richtung: 'pendel' } } });
  nah(beats(c, 36), [0, 0.25, 1.5, 1.75, 2, 2.25, 3.5, 3.75]);
  const l = klip({ loop_beats: 2, noten: [n('a', 0, 36), n('b', 0.25, 36)], zeilen: { 36: { richtung: 'pendel' } } });
  nah(beats(l, 36), [0, 0.25, 3.5, 3.75], 'row period = loop_beats 2: step i of pass 1 sounds at step 7 - i');
  const o = klip({ noten: [n('a', 0, 36), n('b', 0.25, 36)], zeilen: { 36: { richtung: 'pendel' } } });
  nah(beats(o, 36), [0, 0.25], 'without a loop and without a row length the row is left alone');
});

test('swing: the odd sixteenths of the row pass are delayed by swing / 100 * 0.125 beats; other rows stay; the pass counts, not the clip', () => {
  const steps = [0, 0.25, 0.5, 0.75].flatMap((b) => [n(`a${b * 4}`, b, 42), n(`b${b * 4}`, b, 36)]);
  nah(beats(klip({ noten: steps, zeilen: { 42: { swing: 50 } } }), 42), [0, 0.3125, 0.5, 0.8125]);
  nah(beats(klip({ noten: steps, zeilen: { 42: { swing: 100 } } }), 42), [0, 0.375, 0.5, 0.875]);
  nah(beats(klip({ noten: steps, zeilen: { 42: { swing: 100 } } }), 36), [0, 0.25, 0.5, 0.75]);
  const k = klip({ laenge_beats: 3, noten: [n('a', 0, 42), n('b', 0.25, 42)], zeilen: { 42: { schritte: 6, swing: 100 } } });
  nah(beats(k, 42), [0, 0.375, 1.5, 1.875], 'pass 1 starts at beat 1.5: its step 1 is delayed again, a 6-step pass restarts the odd/even count');
});

test('versatz: moves a note by versatz / 100 * 0.25 beats, never before the clip start (copies may reach back into the pass before)', () => {
  nah(beats(klip({ start_beat: 4, noten: [n('a', 1, 36, { versatz: 50 }), n('b', 2, 38, { versatz: -50 }), n('c', 0, 40, { versatz: -95 })] }), 36), [5.125]);
  const c = klip({ start_beat: 4, noten: [n('b', 2, 38, { versatz: -50 }), n('c', 0, 40, { versatz: -95 })] });
  nah(beats(c, 38), [5.875]);
  assert.deepEqual(rolle(c).filter((x) => x.ton === 40).map((x) => [x.beat, x.laenge]), [[4, 0.125]], 'clamped to the clip start, length kept');
  nah(beats(klip({ loop_beats: 1, laenge_beats: 3, noten: [n('a', 0, 36, { versatz: -50 })] }), 36), [0, 0.875, 1.875], 'copy 0 is clamped, later copies reach back');
  nah(beats(klip({ loop_beats: 1, laenge_beats: 2, noten: [n('a', 0.9, 36, { versatz: 95 })] }), 36), [], 'moved behind its pass end it is silent (like a note behind loop_beats)');
});

test('wdh: n hits spread evenly over max(0.25, length), each one share long, same velocity, unique stable ids', () => {
  const r = rolle(klip({ noten: [n('a', 1, 36, { laenge: 1, wdh: 4, vel: 77 }), n('s', 3, 38, { laenge: 0.1, wdh: 2 })] }));
  assert.deepEqual(r.filter((x) => x.ton === 36).map((x) => [x.id, x.beat, x.laenge, x.vel]),
    [['c/a', 1, 0.25, 77], ['c/a.1', 1.25, 0.25, 77], ['c/a.2', 1.5, 0.25, 77], ['c/a.3', 1.75, 0.25, 77]]);
  assert.deepEqual(r.filter((x) => x.ton === 38).map((x) => [x.id, x.beat, x.laenge]), [['c/s', 3, 0.125], ['c/s.1', 3.125, 0.125]], 'a short note spreads over 0.25');
});

test('chance: deterministic (two runs equal, other edits do not move it), a plausible share over many copies, 1 and 99 differ from always', () => {
  const mk = (chance, extra = []) => klip({ laenge_beats: 4000, loop_beats: 1, noten: [n('a', 0, 36, { chance }), ...extra] });
  const ids = (c) => rolle(c).filter((x) => x.ton === 36).map((x) => x.id).join();
  assert.equal(ids(mk(25)), ids(mk(25)));
  assert.equal(ids(mk(25)), ids(mk(25, [n('z', 0.5, 42)])), 'an unrelated note does not change the draws of this one');
  const anteil = (chance) => rolle(mk(chance)).length / 4000;
  assert.ok(Math.abs(anteil(25) - 0.25) < 0.04, String(anteil(25)));
  assert.ok(Math.abs(anteil(50) - 0.5) < 0.04, String(anteil(50)));
  assert.ok(Math.abs(anteil(99) - 0.99) < 0.02, String(anteil(99)));
  assert.ok(anteil(1) < 0.04, String(anteil(1)));
  const zwei = klip({ laenge_beats: 400, loop_beats: 1, noten: [n('a', 0, 36, { chance: 50 }), n('b', 0, 38, { chance: 50 })] });
  const aus = (ton) => rolle(zwei).filter((x) => x.ton === ton).map((x) => x.id.split('/')[0]).join();
  assert.notEqual(aus(36), aus(38), 'every note id has its own draws');
  assert.notEqual(ids(mk(50)), ids({ ...mk(50), id: 'd' }), 'and so does every clip id');
});

test('the ids of all copies are unique and stable, with loops, rows, repeats and mirrored passes together', () => {
  const c = klip({ laenge_beats: 16, loop_beats: 4, noten: [n('a', 0, 36, { wdh: 3 }), n('b', 0.5, 38), n('c', 1, 42, { wdh: 2, laenge: 1 }), n('d', 0.25, 44, { versatz: 30 })],
    zeilen: { 36: { schritte: 6, richtung: 'pendel' }, 42: { richtung: 'pendel', swing: 20 }, 44: { schritte: 8 } } });
  const r = rolle(c), a = r.map((x) => x.id);
  assert.equal(new Set(a).size, a.length);
  assert.ok(a.length > 30);
  assert.equal(a.join(), rolle(klip({ ...c, noten: [...c.noten, n('zz', 3, 50)] })).filter((x) => !x.id.endsWith('/zz')).map((x) => x.id).join());
  assert.ok(a.every((x) => /^c(~\d+)?\/[A-Za-z][A-Za-z0-9_-]*(\.\d+)?$/.test(x)), a.join());
});

test('the note count of the core limits counts what sounds (repeats yes, dropped chances no)', () => {
  const p = neuesProjekt('x');
  p.spuren.push({ id: 's1', nr: 1, name: 'A', farbe: '#000000', art: 'instrument', fader_db: 0, pan: 0, mute: false, solo: false,
    clips: [klip({ noten: [n('a', 0, 36, { wdh: 4 })] })] });
  assert.equal(zaehleAusgerollt(p).noten, 4);
});

// ---- model ----------------------------------------------------------------------------------------------------------------------
const modul = (o = {}) => ({ ...neuesProjekt('M'), werkbank: { schema: 1 }, ...o });
const mitClip = (c) => { const p = modul(); p.spuren.push({ id: 's1', nr: 1, name: 'A', farbe: '#000000', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} },
  fader_db: 0, pan: 0, mute: false, solo: false, clips: [c] }); return p; };

test('model: the note fields and zeilen are checked, never accepted with a default or empty', () => {
  assert.equal(pruefeFehler(mitClip(klip({ noten: [n('a', 0, 36, { chance: 50, wdh: 3, versatz: -20 })], zeilen: { 36: { schritte: 6, swing: 30, richtung: 'pendel' }, 127: { swing: 1 } } }))), null);
  for (const x of [{ chance: 0 }, { chance: 100 }, { chance: 1.5 }, { chance: '5' }, { wdh: 1 }, { wdh: 9 }, { wdh: 2.5 }, { versatz: 0 }, { versatz: 96 }, { versatz: -96 }, { versatz: 0.5 }]) {
    assert.match(pruefeFehler(mitClip(klip({ noten: [n('a', 0, 36, x)] }))) ?? '', /noten\[0\]\.(chance|wdh|versatz)/, JSON.stringify(x));
  }
  for (const z of [{ 36: {} }, {}, { 128: { swing: 5 } }, { x: { swing: 5 } }, { '01': { swing: 5 } }, { 36: { schritte: 0 } }, { 36: { schritte: 129 } }, { 36: { schritte: 2.5 } },
    { 36: { swing: 0 } }, { 36: { swing: 101 } }, { 36: { richtung: 'rueckwaerts' } }, { 36: { extra: 1 } }, [], 'a']) {
    assert.match(pruefeFehler(mitClip(klip({ zeilen: z }))) ?? '', /zeilen/, JSON.stringify(z));
  }
});

test('model: werkbank {schema: 1, laenge_beats?} takes a whole number of beats from 1 and nothing else', () => {
  assert.equal(werkbankPruefung({ schema: 1, laenge_beats: 16 }), null);
  assert.equal(pruefeFehler(modul({ werkbank: { schema: 1, laenge_beats: 8 } })), null);
  for (const w of [{ schema: 1, laenge_beats: 0 }, { schema: 1, laenge_beats: 1.5 }, { schema: 1, laenge_beats: '16' }, { schema: 1, laenge_beats: -4 }, { schema: 1, laenge_beats: null }]) {
    assert.notEqual(werkbankPruefung(w), null, JSON.stringify(w));
  }
  assert.equal(pruefeProjekt(kopie(modul({ werkbank: { schema: 1, laenge_beats: 8 } }))).projekt.werkbank.laenge_beats, 8);
});

// ---- commands -------------------------------------------------------------------------------------------------------------------
const grund = (p, b) => { try { fuehreListeAus(p, [b]); return null; } catch (e) { return e.grund; } };
const basis = () => fuehreListeAus(modul(), [{ befehl: 'werkbank_spur_neu', name: 'D', geraet: { art: 'intern', name: 'rb338', parameter: {} }, loop_beats: 16 }]).projekt;
const clipVon = (p) => p.spuren[0].clips[0];

test('noten_neu and noten_aendern take chance, wdh, versatz; null removes one; absent fields are never written; the change reaches the playback', () => {
  const p0 = basis(), id = clipVon(p0).id;
  const r = fuehreListeAus(p0, [{ befehl: 'noten_neu', clip_id: id, noten: [{ beat: 0, laenge: 0.25, ton: 36, vel: 100, chance: 40, wdh: 3, versatz: -10 }, { beat: 1, laenge: 0.25, ton: 36, vel: 100 }] }]);
  const [a, b] = clipVon(r.projekt).noten;
  assert.deepEqual([a.chance, a.wdh, a.versatz], [40, 3, -10]);
  assert.deepEqual(Object.keys(b).sort(), ['beat', 'id', 'laenge', 'ton', 'vel']);
  const s = fuehreListeAus(r.projekt, [{ befehl: 'noten_aendern', clip_id: id, noten: [{ id: a.id, chance: 70, wdh: null }, { id: b.id, versatz: 5 }] }]);
  const [a2, b2] = clipVon(s.projekt).noten;
  assert.deepEqual([a2.chance, 'wdh' in a2, a2.versatz, b2.versatz], [70, false, -10, 5]);
  assert.equal(s.betrifft_wiedergabe, true);
  const t = fuehreListeAus(s.projekt, [{ befehl: 'noten_aendern', clip_id: id, noten: [{ id: a.id, chance: null, versatz: null }, { id: b.id, versatz: null }] }]);
  assert.deepEqual(Object.keys(clipVon(t.projekt).noten[0]).sort(), ['beat', 'id', 'laenge', 'ton', 'vel']);
  assert.equal('versatz' in clipVon(t.projekt).noten[1], false);
  assert.equal(grund(r.projekt, { befehl: 'noten_aendern', clip_id: id, noten: [{ id: a.id, wdh: null, chance: null }] }), null, 'removing is a change');
  assert.equal(grund(r.projekt, { befehl: 'noten_aendern', clip_id: id, noten: [{ id: a.id }] }), 'argument_ungueltig');
  assert.equal(pruefeFehler(t.projekt), null);
});

test('noten_neu and noten_aendern refuse bad values of the new fields', () => {
  const p0 = basis(), id = clipVon(p0).id, ok = { beat: 0, laenge: 0.25, ton: 36, vel: 100 };
  for (const x of [{ chance: 0 }, { chance: 100 }, { chance: 2.5 }, { chance: '50' }, { chance: null }, { wdh: 1 }, { wdh: 9 }, { wdh: null }, { versatz: 0 }, { versatz: 96 }, { versatz: -96 }, { versatz: 1.5 }]) {
    assert.equal(grund(p0, { befehl: 'noten_neu', clip_id: id, noten: [{ ...ok, ...x }] }), 'argument_ungueltig', `neu ${JSON.stringify(x)}`);
  }
  const p1 = fuehreListeAus(p0, [{ befehl: 'noten_neu', clip_id: id, noten: [ok] }]).projekt, nid = clipVon(p1).noten[0].id;
  for (const x of [{ chance: 0 }, { chance: 100 }, { wdh: 1 }, { wdh: 9 }, { versatz: 0 }, { versatz: -96 }, { versatz: 96 }]) {
    assert.equal(grund(p1, { befehl: 'noten_aendern', clip_id: id, noten: [{ id: nid, ...x }] }), 'argument_ungueltig', `aendern ${JSON.stringify(x)}`);
  }
});

test('zeile_setzen sets, changes and removes row fields; an empty row and an empty zeilen disappear; refusals', () => {
  const p0 = basis(), id = clipVon(p0).id;
  const a = fuehreListeAus(p0, [{ befehl: 'zeile_setzen', clip_id: id, ton: 36, schritte: 6, swing: 30, richtung: 'pendel' }]);
  assert.deepEqual(clipVon(a.projekt).zeilen, { 36: { schritte: 6, swing: 30, richtung: 'pendel' } });
  assert.equal(a.betrifft_wiedergabe, true);
  const b = fuehreListeAus(a.projekt, [{ befehl: 'zeile_setzen', clip_id: id, ton: 36, swing: null, richtung: null }, { befehl: 'zeile_setzen', clip_id: id, ton: 38, swing: 10 }]);
  assert.deepEqual(clipVon(b.projekt).zeilen, { 36: { schritte: 6 }, 38: { swing: 10 } });
  const c = fuehreListeAus(b.projekt, [{ befehl: 'zeile_setzen', clip_id: id, ton: 36, schritte: null }, { befehl: 'zeile_setzen', clip_id: id, ton: 38, swing: null }]);
  assert.equal('zeilen' in clipVon(c.projekt), false, 'the last field removed: no empty object stays');
  assert.equal(JSON.stringify(wiedergabeSicht(c.projekt)), JSON.stringify(wiedergabeSicht(p0)), 'back to the old playback view');
  assert.equal(pruefeFehler(b.projekt), null);
  const bad = (x) => grund(p0, { befehl: 'zeile_setzen', clip_id: id, ton: 36, ...x });
  for (const x of [{ schritte: 0 }, { schritte: 129 }, { schritte: 1.5 }, { schritte: '6' }, { swing: 0 }, { swing: 101 }, { swing: 2.5 }, { richtung: 'rueckwaerts' }, { richtung: 'pendel2' },
    { ton: -1, schritte: 4 }, { ton: 128, schritte: 4 }, { ton: 36.5, schritte: 4 }, { ton: undefined, schritte: 4 }, {}]) {
    assert.equal(bad(x.ton === undefined && 'ton' in x ? { ...x, ton: undefined } : x), 'argument_ungueltig', JSON.stringify(x));
  }
  assert.equal(bad({ schritte: 4, laenge: 1 }), 'argument_unbekannt');
  assert.equal(grund(p0, { befehl: 'zeile_setzen', clip_id: 'nope', ton: 36, schritte: 4 }) !== null, true);
  const au = kopie(p0); au.spuren.push({ id: 's9', nr: 9, name: 'Au', farbe: '#000000', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false,
    clips: [{ id: 'c9', art: 'audio', name: 'x', start_beat: 0, laenge_beats: 1, quelle: { sha256: 'a'.repeat(64), pfad_hinweis: '' }, dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }] });
  assert.equal(grund(au, { befehl: 'zeile_setzen', clip_id: 'c9', ton: 36, schritte: 4 }), 'clip_nicht_midi');
});

test('werkbank_bereich sets the loop to a range of whole beats, remembers the module length once, and aus puts the loop back and removes the field', () => {
  const p0 = modul({ loop: { an: true, von_beat: 0, bis_beat: 16 } });
  const a = fuehreListeAus(p0, [{ befehl: 'werkbank_bereich', von_beat: 4, bis_beat: 8 }]).projekt;
  assert.deepEqual([a.loop, a.werkbank], [{ an: true, von_beat: 4, bis_beat: 8 }, { schema: 1, laenge_beats: 16 }]);
  const b = fuehreListeAus(a, [{ befehl: 'werkbank_bereich', von_beat: 0, bis_beat: 16 }]).projekt;
  assert.deepEqual([b.loop, b.werkbank.laenge_beats], [{ an: true, von_beat: 0, bis_beat: 16 }, 16], 'the full length is a range, too');
  const c = fuehreListeAus(a, [{ befehl: 'werkbank_bereich', von_beat: 8, bis_beat: 12 }]).projekt;
  assert.equal(c.werkbank.laenge_beats, 16, 'the remembered length stays when the range moves');
  const aus = fuehreListeAus(c, [{ befehl: 'werkbank_bereich', aus: true }]);
  assert.deepEqual([aus.projekt.loop, aus.projekt.werkbank], [{ an: true, von_beat: 0, bis_beat: 16 }, { schema: 1 }]);
  assert.equal(fuehreListeAus(p0, [{ befehl: 'werkbank_bereich', aus: true }]).projekt.loop.bis_beat, 16, 'aus without a range changes nothing');
  assert.equal(pruefeFehler(c), null);
  assert.equal(fuehreListeAus(a, [{ befehl: 'werkbank_bereich', von_beat: 2, bis_beat: 3 }]).projekt.loop.bis_beat, 3, 'one beat is the minimum');
});

test('werkbank_bereich refusals: not a module, fractions, less than a beat, outside the module length, extra or mixed arguments', () => {
  const p0 = modul({ loop: { an: true, von_beat: 0, bis_beat: 16 } });
  const g = (b, p = p0) => grund(p, { befehl: 'werkbank_bereich', ...b });
  assert.equal(grund(kopie(neuesProjekt('x')), { befehl: 'werkbank_bereich', von_beat: 0, bis_beat: 4 }), 'kein_werkbank');
  assert.equal(grund(kopie(neuesProjekt('x')), { befehl: 'werkbank_bereich', aus: true }), 'kein_werkbank');
  for (const x of [{ von_beat: 0.5, bis_beat: 4 }, { von_beat: 0, bis_beat: 4.5 }, { von_beat: '0', bis_beat: 4 }, { von_beat: 0 }, { bis_beat: 4 }, {}, { aus: false }, { aus: 'ja' },
    { aus: true, von_beat: 0, bis_beat: 4 }, { von_beat: -1, bis_beat: 4 }]) assert.equal(g(x), 'argument_ungueltig', JSON.stringify(x));
  assert.equal(g({ von_beat: 4, bis_beat: 4 }), 'loop_bereich');
  assert.equal(g({ von_beat: 6, bis_beat: 4 }), 'loop_bereich');
  assert.equal(g({ von_beat: 8, bis_beat: 17 }), 'modul_bereich');
  assert.equal(g({ von_beat: 0, bis_beat: 4, extra: 1 }), 'argument_unbekannt');
  const mit = modul({ loop: { an: true, von_beat: 2, bis_beat: 6 }, werkbank: { schema: 1, laenge_beats: 8 } });
  assert.equal(g({ von_beat: 0, bis_beat: 9 }, mit), 'modul_bereich', 'the remembered length limits the range, not the current loop');
  assert.equal(g({ von_beat: 0, bis_beat: 8 }, mit), null);
});

// ---- export ---------------------------------------------------------------------------------------------------------------------
test('midiTeile exports what the unrolling plays, with the new fields (the range is relative to von)', () => {
  const p = { spuren: [{ id: 's', nr: 1, name: 'A', art: 'instrument', mute: false, solo: false, clips: [klip({ noten: [n('a', 1, 36, { wdh: 2, laenge: 0.5, versatz: 40 })] })] }] };
  const t = midiTeile(p, 0, 4);
  assert.deepEqual(t[0].noten.map((x) => [x.beat, x.laenge]), [[1.1, 0.25], [1.35, 0.25]].map(([b, l]) => [b, l]));
});

test('export of a workbench module takes the module length, not the loop range (MIDI); without a remembered length the loop stays the default', async (t) => {
  const a = await aufbau(t);
  await a.s.neu('Modul', 'andreas', true, { werkbank: true });
  await a.aendern([{ befehl: 'werkbank_spur_neu', name: 'D', geraet: { art: 'intern', name: 'rb338', parameter: {} }, loop_beats: 16,
    noten: [{ beat: 0, laenge: 0.25, ton: 36, vel: 100 }, { beat: 9, laenge: 0.25, ton: 36, vel: 100 }, { beat: 14, laenge: 0.25, ton: 36, vel: 100 }] }]);
  const rufe = async (methode, d) => { try { return { code: 200, body: await a.ausgabe[methode](d) }; } catch (e) { return alsAntwort(e); } };
  const ohne = await rufe('exportiereMidi', {});
  assert.equal(ohne.code, 200, JSON.stringify(ohne.body));
  assert.deepEqual([ohne.body.von_beat, ohne.body.bis_beat], [0, 16], 'loop 0..16 and no range: the same as before');
  await a.aendern([{ befehl: 'werkbank_bereich', von_beat: 8, bis_beat: 12 }]);
  assert.deepEqual([a.offen().projekt.loop.von_beat, a.offen().projekt.loop.bis_beat], [8, 12]);
  const mit = await rufe('exportiereMidi', {});
  assert.equal(mit.code, 200, JSON.stringify(mit.body));
  assert.deepEqual([mit.body.von_beat, mit.body.bis_beat], [0, 16], 'the module length, not the range');
  assert.equal(mit.body.dateien[0].noten, 3);
  const teil = await rufe('exportiereMidi', { von_beat: 8, bis_beat: 12 });
  assert.deepEqual([teil.body.von_beat, teil.body.bis_beat], [8, 12], 'an explicit range still wins');
});
