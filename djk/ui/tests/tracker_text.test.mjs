// Tracker task 9: the text form of a section (project/tracker_text.ts) and the pure parts of the tracker routes (areas/proj/tracker_routes.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { neuesProjekt, kanonisch } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { liesBereich, schreibeBereich, TrackerTextFehler } from '../project/tracker_text.ts';
import { trackerSong, trackerLesen, trackerSchreiben, trackerRouten } from '../areas/proj/tracker_routes.ts';
import { kopie, tmpOrdner } from './support/project.mjs';

const lauf = (p, b) => fuehreListeAus(kopie(p), b).projekt;
const GERAET = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
const N = (beat, laenge, ton = 60, extra = {}) => ({ beat, laenge, ton, vel: 100, ...extra });
// a project with the tracks `namen` (all bk instruments); clips: { spur: index, start_beat, laenge_beats, noten, huellkurven? }
function bau(namen, clips = []) {
  let p = neuesProjekt('x');
  for (const name of namen) p = lauf(p, [{ befehl: 'spur_neu', art: 'instrument', name, geraet: GERAET }]);
  for (const { spur, huellkurven, ...c } of clips) {
    p = lauf(p, [{ befehl: 'clip_neu', spur_id: p.spuren[spur].id, art: 'midi', ...c }]);
    for (const h of huellkurven ?? []) p = lauf(p, [{ befehl: 'huellkurve_setzen', clip_id: p.spuren[spur].clips.at(-1).id, ...h }]);
  }
  return p;
}
const wende = (p, r) => fuehreListeAus(kopie(p), r.befehle).projekt;
const fehler = (f) => { try { f(); } catch (e) { assert.ok(e instanceof TrackerTextFehler, String(e)); return e; } assert.fail('expected a TrackerTextFehler'); };
// replace the first line that matches `muster` by `neu`
const ersetze = (text, muster, neu) => text.split('\n').map((z, i, a) => (a.findIndex((x) => muster.test(x)) === i ? neu : z)).join('\n');

test('liesBereich: head, legend and rows of a small section, exactly', () => {
  const p = bau(['Bass'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 0.25, 60), N(0.25, 0.25, 62, { vel: 127, chance: 50 })] }]);
  const text = liesBereich(p, { abschnitt_id: 'a1', von: 0, bis: 3 });
  assert.equal(text, [
    'section 00 ""  rows 64  lpb 4  ticks 6  from 00 to 03',
    'row | A Bass',
    '00  | C-3 64 ... .. .  ... ..',
    '01  | D-3 7F ... 50 .  ... ..',
    '02  | === .. ... .. .  ... ..',
    '03  | ... .. ... .. .  ... ..',
    '',
  ].join('\n'));
});

test('liesBereich: the whole section has no from/to; tracks can be picked; two tracks are padded, columns and knob values show', () => {
  const p = bau(['Bass', 'Lead'], [
    { spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(0, 1, 64)],
      huellkurven: [{ ziel: 'geraet.k12', punkte: [{ beat: 0, wert: 0, form: 'sprung' }] }] },
    { spur: 1, start_beat: 0, laenge_beats: 16, noten: [N(1, 1, 67, { versatz: -25 })] }]);
  const text = liesBereich(p, { abschnitt_id: 'a1' });
  const zeilen = text.split('\n');
  assert.equal(zeilen[0], 'section 00 ""  rows 64  lpb 4  ticks 6');
  assert.equal(zeilen.length, 2 + 64 + 1);
  assert.match(zeilen[1], /^row \| A Bass {35} \| B Lead$/);
  assert.equal(zeilen[2], '00  | C-3 64 ... .. . / E-3 64 ... .. .  K12 80 | ... .. ... .. .  ... ..');
  assert.match(zeilen[6], /^04 {2}\| .* \| G-3 64 -25 \.\. \.  \.\.\. \.\.$/);
  const nurB = liesBereich(p, { abschnitt_id: 'a1', spuren: ['B'], von: 4, bis: 4 });
  assert.equal(nurB, ['section 00 ""  rows 64  lpb 4  ticks 6  from 04 to 04', 'row | B Lead', '04  | G-3 64 -25 .. .  ... ..', ''].join('\n'));
});

test('liesBereich: an unknown section, track or row range is refused', () => {
  const p = bau(['Bass']);
  assert.throws(() => liesBereich(p, { abschnitt_id: 'a9' }), (e) => e instanceof TrackerTextFehler && /section/.test(e.text));
  assert.throws(() => liesBereich(p, { abschnitt_id: 'a1', spuren: ['Z'] }), (e) => e instanceof TrackerTextFehler && /track Z/.test(e.text));
  assert.throws(() => liesBereich(p, { abschnitt_id: 'a1', von: 10, bis: 64 }), (e) => e instanceof TrackerTextFehler && /rows/.test(e.text));
  assert.throws(() => liesBereich(p, { abschnitt_id: 'a1', von: 5, bis: 2 }), (e) => e instanceof TrackerTextFehler);
});

// the project of the projection tests (task 1): chord, delay, chance, repeat, off-grid note, note below the grid, loop, curve, audio track
function t1() {
  const note = (id, beat, laenge, ton, vel = 100, extra = {}) => ({ id, beat, laenge, ton, vel, ...extra });
  return {
    format: 'cypherdj-projekt/2', name: 'T', tempo_bpm: 120, taktart: [4, 4],
    spuren: [
      { id: 's1', nr: 1, name: 'lead', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'lead', parameter: { k12: 0.5 } },
        clips: [{ id: 'c1', art: 'midi', name: 'a', start_beat: 0, laenge_beats: 16,
          noten: [note('n1', 0, 1, 60, 96), note('n2', 2, 0.125, 64), note('n3', 3.125, 0.5, 67), note('n4', 5, 1, 60), note('n5', 5, 1, 64),
            note('n6', 5, 1, 67, 100, { spalte: 2 }), note('n7', 8, 1, 62), note('n8', 9, 1, 62),
            note('n9', 12, 1, 72, 100, { versatz: 25, chance: 50, wdh: 3 }), note('n10', 15.5, 4, 55), note('n11', 14, 0.25, 12)],
          huellkurven: [{ ziel: 'geraet.k12', punkte: [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 2, wert: 0.25, form: 'sprung' }] },
            { ziel: 'geraet.k3', punkte: [{ beat: 2, wert: -1, form: 'sprung' }] }] }] },
      { id: 's2', nr: 2, name: 'loopy', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} },
        clips: [{ id: 'c2', art: 'midi', name: 'l', start_beat: 0, laenge_beats: 8, loop_beats: 2, noten: [note('m1', 0, 1, 48), note('m2', 2.5, 1, 50)] }] },
      { id: 's3', nr: 3, name: 'curvy', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'pad', parameter: {} },
        clips: [{ id: 'c3', art: 'midi', name: 'p', start_beat: 0, laenge_beats: 16, noten: [note('p1', 0, 2, 60)],
          huellkurven: [{ ziel: 'geraet.k5', punkte: [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }] }] }] },
      { id: 's4', nr: 4, name: 'vox', art: 'audio', clips: [{ id: 'c4', art: 'audio', name: 'vox.wav', start_beat: 4, laenge_beats: 40 }] },
    ],
  };
}

test('round trip: the text that was read writes nothing (every section, whole and in parts, with and without track picks)', () => {
  const p = t1();
  for (const id of ['a1', 'a2', 'a3']) {
    const text = liesBereich(p, { abschnitt_id: id });
    const r = schreibeBereich(p, text);
    assert.deepEqual(r.befehle, [], id);
    assert.equal(r.ohne_aenderung, true);
    assert.equal(typeof r.label, 'string');
  }
  assert.deepEqual(schreibeBereich(p, liesBereich(p, { abschnitt_id: 'a1', von: 4, bis: 15, spuren: ['A', 'C'] })).befehle, []);
  assert.deepEqual(schreibeBereich(p, liesBereich(p, { abschnitt_id: 'a1', spuren: ['B'] })).befehle, []);
  const t = liesBereich(p, { abschnitt_id: 'a1' });
  assert.match(t, /~~~/, 'the drawn curve shows');
  assert.match(t, /\blo +\d/, 'the note below the grid shows as lo');
  assert.match(t, /K12 /);
});

test('round trip: comments, blank lines, other spacing and lower case hex change nothing', () => {
  const p = t1();
  const text = liesBereich(p, { abschnitt_id: 'a1', von: 0, bis: 8, spuren: ['A'] });
  const lose = text.split('\n').map((z) => z.replace(/\s+/g, ' ').replace(/\b([0-9A-F]{2})\b/g, (m) => m.toLowerCase())).join('\n\n; a comment\n');
  assert.deepEqual(schreibeBereich(p, lose + ' ; at the end').befehle, []);
});

test('a changed velocity writes one noten_aendern', () => {
  const p = bau(['Bass'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(2, 1, 62)] }]);
  const text = liesBereich(p, { abschnitt_id: 'a1', von: 0, bis: 12 });
  const neu = ersetze(text, /^00 /, '00  | C-3 7F ... .. .  ... ..');
  const r = schreibeBereich(p, neu);
  const id = p.spuren[0].clips[0].noten.find((n) => n.ton === 60).id;
  assert.deepEqual(r.befehle, [{ befehl: 'noten_aendern', clip_id: p.spuren[0].clips[0].id, noten: [{ id, vel: 127 }] }]);
  assert.ok(!r.ohne_aenderung);
  assert.equal(wende(p, r).spuren[0].clips[0].noten.find((n) => n.id === id).vel, 127);
});

test('a note typed into an empty cell, a note off, a clear and a knob value are written with the builders of the page', () => {
  const p = bau(['Bass'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]);
  let text = liesBereich(p, { abschnitt_id: 'a1', von: 0, bis: 12 });
  assert.match(text, /^04 {2}\| === /m);
  text = ersetze(text, /^02 /, '02  | E-3 50 ... 30 .  ... ..');
  text = ersetze(text, /^08 /, '08  | ... .. ... .. .  K05 FF');
  const q = wende(p, schreibeBereich(p, text));
  const noten = q.spuren[0].clips[0].noten.map((n) => [n.beat, n.laenge, n.ton, n.vel, n.chance]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(noten, [[0, 0.5, 60, 100, undefined], [0.5, 0.5, 64, 80, 30]]);
  assert.deepEqual(q.spuren[0].clips[0].huellkurven.map((h) => [h.ziel, h.punkte]), [['geraet.k5', [{ beat: 2, wert: 1, form: 'sprung' }]]]);
  // back: clear the note and the knob value again
  const t2 = liesBereich(q, { abschnitt_id: 'a1', von: 0, bis: 12 });
  const t3 = ersetze(ersetze(t2, /^02 /, '02  | ... .. ... .. .  ... ..'), /^08 /, '08  | ... .. ... .. .  ... ..');
  const r = wende(q, schreibeBereich(q, t3));
  assert.equal(r.spuren[0].clips[0].noten.length, 1);
  assert.equal(r.spuren[0].clips[0].huellkurven, undefined);
});

test('a note typed into a row with no clip starts a clip; a knob value there is refused with the line', () => {
  const p = bau(['Bass']);
  const kopf = 'section 00 ""  rows 64  lpb 4  ticks 6\nrow | A Bass\n';
  const r = schreibeBereich(p, `${kopf}04  | G-3 64 ... .. .  ... ..`);
  assert.equal(r.befehle[0].befehl, 'clip_neu');
  assert.equal(wende(p, r).spuren[0].clips[0].noten[0].beat, 1);
  const e = fehler(() => schreibeBereich(p, `${kopf}\n04  | ... .. ... .. .  K01 80`));
  assert.equal(e.zeile, 4);
  assert.match(e.text, /No clip here/);
});

test('a note column that holds several notes of a row: edits go to their own columns', () => {
  const p = bau(['Bass'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(0, 1, 64, { spalte: 2 })] }]);
  const text = liesBereich(p, { abschnitt_id: 'a1', von: 0, bis: 0 });
  assert.match(text, /C-3 64 ... .. . \/ E-3 64 ... .. . /);
  const r = schreibeBereich(p, ersetze(text, /^00 /, '00  | C-3 64 ... .. . / G-3 64 ... .. .  ... ..'));
  const n = wende(p, r).spuren[0].clips[0].noten.sort((a, b) => a.ton - b.ton);
  assert.deepEqual(n.map((x) => x.ton), [60, 67]);
});

test('a text that does not parse is refused with its 1-based line number; nothing is returned', () => {
  const p = bau(['Bass', 'Lead'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]);
  const gut = liesBereich(p, { abschnitt_id: 'a1', von: 0, bis: 3 }).split('\n');
  const mit = (i, z) => gut.map((x, k) => (k === i ? z : x)).join('\n');
  assert.equal(fehler(() => schreibeBereich(p, mit(3, '01  | X-9 64 ... .. .  ... .. | ... .. ... .. .  ... ..'))).zeile, 4);
  assert.equal(fehler(() => schreibeBereich(p, mit(2, '00  | C-3 64 ... .. .  ... ..'))).zeile, 3, 'a block is missing');
  assert.equal(fehler(() => schreibeBereich(p, mit(2, 'nonsense'))).zeile, 3);
  assert.equal(fehler(() => schreibeBereich(p, mit(0, 'section x'))).zeile, 1);
  assert.equal(fehler(() => schreibeBereich(p, '')).zeile, 1);
  assert.equal(fehler(() => schreibeBereich(p, mit(3, '01  | C-3 GG ... .. .  ... .. | ... .. ... .. .  ... ..'))).zeile, 4);
  assert.equal(fehler(() => schreibeBereich(p, mit(3, '01  | ... 64 ... .. .  ... .. | ... .. ... .. .  ... ..'))).zeile, 4, 'a value without a note');
  assert.equal(fehler(() => schreibeBereich(p, mit(3, '01  | ... .. ... .. .  XYZ 37 | ... .. ... .. .  ... ..'))).zeile, 4, 'unknown effect code');
  const doppelt = [...gut, gut[3]].join('\n');
  assert.equal(fehler(() => schreibeBereich(p, doppelt)).zeile, gut.length + 1, 'a row twice');
  // a good line before the bad one writes nothing: the refusal carries no command list at all
  const e = fehler(() => schreibeBereich(p, mit(3, `${'02  | E-3 64 ... .. .  ... .. | ... .. ... .. .  ... ..'}\n01  | Q`)));
  assert.equal(e.zeile, 5);
});

test('review focus 5: a track letter the project does not have, or a row past the section end: refused with the line, nothing written', () => {
  const p = bau(['Bass']);
  const kopf = 'section 00 ""  rows 64  lpb 4  ticks 6\n';
  const e1 = fehler(() => schreibeBereich(p, `${kopf}row | A Bass | B Lead\n00  | C-3 64 ... .. .  ... .. | C-3 64 ... .. .  ... ..`));
  assert.equal(e1.zeile, 2); assert.match(e1.text, /track B/);
  const e2 = fehler(() => schreibeBereich(p, `${kopf}row | A Bass\n00  | C-3 64 ... .. .  ... ..\n40  | C-3 64 ... .. .  ... ..`));
  assert.equal(e2.zeile, 4); assert.match(e2.text, /row 40/);
  const e3 = fehler(() => schreibeBereich(p, 'section 00 ""  rows 32  lpb 4  ticks 6\nrow | A Bass\n'));
  assert.equal(e3.zeile, 1); assert.match(e3.text, /rows/);
  const e4 = fehler(() => schreibeBereich(p, 'section 07 ""  rows 64  lpb 4  ticks 6\nrow | A Bass\n'));
  assert.equal(e4.zeile, 1); assert.match(e4.text, /section 07/);
  const e5 = fehler(() => schreibeBereich(p, 'section 00 "other"  rows 64  lpb 4  ticks 6\nrow | A Bass\n'));
  assert.equal(e5.zeile, 1); assert.match(e5.text, /named/);
  const e6 = fehler(() => schreibeBereich(p, 'section 00 ""  rows 64  lpb 8  ticks 6\nrow | A Bass\n'));
  assert.equal(e6.zeile, 1); assert.match(e6.text, /lpb/);
  const e7 = fehler(() => schreibeBereich(p, 'section 00 ""  rows 64  lpb 4  ticks 6  from 00 to 03\nrow | A Bass\n05  | C-3 64 ... .. .  ... ..'));
  assert.equal(e7.zeile, 3);
});

test('a refusal of a builder carries the line of its row', () => {
  const p = bau(['Bass'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]);
  const kopf = 'section 00 ""  rows 64  lpb 4  ticks 6\nrow | A Bass\n';
  const e = fehler(() => schreibeBereich(p, `${kopf}00  | C-3 64 ... .. .  ... ..\n\n05  | C-3 64 ... 00 .  ... ..`));
  assert.equal(e.zeile, 5);
});

test('writing a range is ONE history step: one undo restores the project', (t) => {
  const p = bau(['Bass'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 4, 60)] }]);
  let text = liesBereich(p, { abschnitt_id: 'a1', von: 0, bis: 12 });
  text = ersetze(ersetze(text, /^02 /, '02  | E-3 50 ... .. .  ... ..'), /^08 /, '08  | G-3 40 ... .. .  K01 90');
  const r = schreibeBereich(p, text);
  assert.ok(r.befehle.length >= 3);
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 1_000_000, zeitgeber: false });
  const w = aendere(v, kopie(p), r.befehle, { quelle: 'andreas', label: r.label });
  assert.equal(w.projekt.rev, p.rev + 1);
  const u = rueckgaengig(v, w.projekt, { quelle: 'andreas' });
  assert.equal(JSON.stringify(kanonisch(u.projekt.spuren)), JSON.stringify(kanonisch(p.spuren)));
});

// ---- routes (pure parts) ----------------------------------------------------------------------------------------------------------------------
const zugangVon = (p) => {
  const gesehen = [];
  return { gesehen, offen: () => (p ? { slug: 'x', ordner: '/x', projekt: p, verlauf: null } : null),
    aendern: async (d, quelle) => { gesehen.push({ d, quelle }); return { code: 200, j: { rev: p.rev + 1, projekt: p } }; } };
};

test('GET /tracker/song: lpb, ticks and the sections with their patterns per track', () => {
  const p = lauf(bau(['Bass', 'Lead'], [
    { spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }, { spur: 0, start_beat: 16, laenge_beats: 16, noten: [N(0, 1, 62)] },
    { spur: 1, start_beat: 16, laenge_beats: 8, noten: [N(0, 1, 62)] }]), [{ befehl: 'clip_verknuepfen', clip_id: 'c2', mit: 'c1' }]);
  const s = trackerSong(p);
  assert.equal(s.lpb, 4); assert.equal(s.ticks, 6);
  assert.deepEqual(s.abschnitte.map((a) => [a.id, a.nr, a.name, a.von_beat, a.laenge_beats, a.zeilen]), [['a1', 0, '', 0, 16, 64], ['a2', 1, '', 16, 16, 64]]);
  assert.deepEqual(s.abschnitte[0].muster.map((m) => [m.spur_id, m.buchstabe, m.name, m.verbund]), [['s1', 'A', p.spuren[0].clips[0].name, p.spuren[0].clips[0].verbund]]);
  assert.equal(s.abschnitte[1].muster.length, 2);
  assert.ok(s.abschnitte[0].muster[0].verbund !== undefined && s.abschnitte[0].muster[0].verbund === s.abschnitte[1].muster[0].verbund);
  assert.equal(s.abschnitte[1].muster[1].verbund, undefined);
});

test('GET /tracker/text: query values become the range; a bad value is argument_ungueltig', () => {
  const p = bau(['Bass', 'Lead'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]);
  const q = (o) => new URLSearchParams(o);
  assert.equal(trackerLesen(p, q({ abschnitt: 'a1', von: '0', bis: '1', spuren: 'B' })).text.split('\n')[1], 'row | B Lead');
  assert.throws(() => trackerLesen(p, q({})), (e) => e.fehler === 'argument_ungueltig');
  assert.throws(() => trackerLesen(p, q({ abschnitt: 'a1', von: 'x' })), (e) => e.fehler === 'argument_ungueltig' && /von/.test(e.extra.text));
  assert.throws(() => trackerLesen(p, q({ abschnitt: 'a1', spuren: 'Z' })), (e) => e.fehler === 'argument_ungueltig');
  assert.throws(() => trackerLesen(p, q({ abschnitt: 'a9' })), (e) => e.fehler === 'argument_ungueltig');
});

test('POST /tracker/text: one /proj/aendern call with the commands, the label and the rev; a text that changes nothing writes nothing', async () => {
  const p = bau(['Bass'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]);
  const text = liesBereich(p, { abschnitt_id: 'a1', von: 0, bis: 3 });
  const z = zugangVon(p);
  const leer = await trackerSchreiben(z, { text }, 'cypher');
  assert.equal(leer.code, 200); assert.equal(leer.j.ohne_aenderung, true); assert.equal(leer.j.rev, p.rev);
  assert.equal(z.gesehen.length, 0);
  const r = await trackerSchreiben(z, { text: ersetze(text, /^00 /, '00  | C-3 7F ... .. .  ... ..') }, 'andreas');
  assert.equal(r.code, 200);
  assert.equal(z.gesehen.length, 1);
  assert.equal(z.gesehen[0].quelle, 'andreas');
  assert.equal(z.gesehen[0].d.rev, p.rev);
  assert.equal(z.gesehen[0].d.befehle[0].befehl, 'noten_aendern');
  assert.match(z.gesehen[0].d.label, /section 00/);
  const mitRev = await trackerSchreiben(z, { text: ersetze(text, /^00 /, '00  | C-3 7F ... .. .  ... ..'), rev: 3 }, 'andreas');
  assert.equal(z.gesehen[1].d.rev, 3); assert.equal(mitRev.code, 200);
});

test('POST /tracker/text: a bad line is argument_ungueltig with the line; no project, a live container and a workbench module are refused', async () => {
  const p = bau(['Bass']);
  const z = zugangVon(p);
  await assert.rejects(trackerSchreiben(z, { text: 'section 00 ""  rows 64  lpb 4  ticks 6\nrow | A Bass\n00  | Q' }, 'andreas'),
    (e) => e.fehler === 'argument_ungueltig' && e.extra.zeile === 3 && /line 3/.test(e.extra.text));
  assert.equal(z.gesehen.length, 0);
  await assert.rejects(trackerSchreiben(z, {}, 'andreas'), (e) => e.fehler === 'argument_ungueltig');
  await assert.rejects(trackerSchreiben(z, { text: 'x', rev: 'a' }, 'andreas'), (e) => e.fehler === 'argument_ungueltig');
  await assert.rejects(trackerSchreiben(z, { text: 'x', mehr: 1 }, 'andreas'), (e) => e.fehler === 'argument_ungueltig');
  await assert.rejects(trackerSchreiben(zugangVon(null), { text: 'x' }, 'andreas'), (e) => e.fehler === 'kein_projekt');
  await assert.rejects(trackerSchreiben(zugangVon({ ...p, live: true }), { text: 'x' }, 'andreas'), (e) => e.fehler === 'tracker_live');
  await assert.rejects(trackerSchreiben(zugangVon({ ...p, werkbank: true }), { text: 'x' }, 'andreas'), (e) => e.fehler === 'tracker_werkbank');
  assert.throws(() => trackerSong({ ...p, live: true }), (e) => e.fehler === 'tracker_live');
});

test('the routes: GET /tracker/song, GET /tracker/text, POST /tracker/text', () => {
  const rs = trackerRouten({ zugang: zugangVon(bau(['Bass'])), antworte: async () => {}, leseKoerper: async () => ({}), kurz: (r) => r });
  assert.deepEqual(rs.map((r) => `${r.methode} ${r.pfad}`), ['GET /tracker/song', 'GET /tracker/text', 'POST /tracker/text']);
  assert.deepEqual(rs.map((r) => r.schutz), ['offen', 'offen', 'fremdePost']);
});
