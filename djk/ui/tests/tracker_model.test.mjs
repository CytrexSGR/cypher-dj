// Tracker task 3: the project marker `tracker`, the note field `spalte` and the command tracker_setzen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeFehler, pruefeProjekt } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { trackerPruefung, istTracker, LPB_WERTE, TICKS_MIN, TICKS_MAX, ABSCHNITTE_MAX, ABSCHNITT_BEATS_MAX, ABSCHNITT_ID, ABSCHNITT_NAME_MAX } from '../project/tracker.ts';
import { kopie } from './support/project.mjs';

const lauf = (p, ...b) => fuehreListeAus(kopie(p), b).projekt;
const grund = (p, b) => { try { fuehreListeAus(kopie(p), [b]); return null; } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e.grund; } };
const mitMarke = (m) => { const p = neuesProjekt('x'); p.tracker = m; return p; };
const instr = (p) => lauf(p, { befehl: 'spur_neu', art: 'instrument', name: 'I', geraet: { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} } });
function mitClip() {
  let p = instr(neuesProjekt('x'));
  p = lauf(p, { befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] });
  return p;
}
const clipVon = (p) => p.spuren[0].clips[0];

test('constants', () => {
  assert.deepEqual([...LPB_WERTE], [2, 3, 4, 6, 8, 12, 16]);
  assert.equal(TICKS_MIN, 1); assert.equal(TICKS_MAX, 24); assert.equal(ABSCHNITTE_MAX, 256);
  assert.equal(ABSCHNITT_BEATS_MAX, 1024); assert.equal(ABSCHNITT_NAME_MAX, 40);
  assert.ok(ABSCHNITT_ID.test('a1') && ABSCHNITT_ID.test('a999999') && !ABSCHNITT_ID.test('a') && !ABSCHNITT_ID.test('b1') && !ABSCHNITT_ID.test('a1234567'));
});

test('marker: valid cases', () => {
  for (const m of [{ schema: 1 }, { schema: 1, lpb: 8 }, { schema: 1, ticks: 24 }, { schema: 1, lpb: 3, ticks: 1 },
    { schema: 1, abschnitte: [{ id: 'a1', laenge_beats: 16 }, { id: 'a2', name: 'Intro', laenge_beats: 0.5 }] },
    { schema: 1, abschnitte: [{ id: 'a1', laenge_beats: 1 / 48 }] }, { schema: 1, abschnitte: [{ id: 'a1', laenge_beats: 1024 }] }]) {
    assert.equal(trackerPruefung(m), null, JSON.stringify(m));
    assert.equal(pruefeFehler(mitMarke(m)), null, JSON.stringify(m));
  }
  assert.ok(istTracker(mitMarke({ schema: 1 })));
  assert.ok(!istTracker(neuesProjekt('x')));
});

test('marker: every invalid case names the reason tracker', () => {
  const sec = (x) => ({ schema: 1, abschnitte: x });
  const lang = Array.from({ length: 257 }, (_, i) => ({ id: `a${i + 1}`, laenge_beats: 1 }));
  for (const m of [null, 5, [], 'x', {}, { schema: 2 }, { schema: 1, extra: 1 },
    { schema: 1, lpb: 5 }, { schema: 1, lpb: 4.5 }, { schema: 1, lpb: '4' }, { schema: 1, ticks: 0 }, { schema: 1, ticks: 25 }, { schema: 1, ticks: 2.5 },
    sec([]), sec('x'), sec(lang), sec([null]), sec([{ id: 'a1' }]), sec([{ id: 'b1', laenge_beats: 1 }]), sec([{ id: 'a1', laenge_beats: 0 }]),
    sec([{ id: 'a1', laenge_beats: -1 }]), sec([{ id: 'a1', laenge_beats: 1025 }]), sec([{ id: 'a1', laenge_beats: 0.01 }]),
    sec([{ id: 'a1', laenge_beats: 1 }, { id: 'a1', laenge_beats: 1 }]), sec([{ id: 'a1', laenge_beats: 1, name: '' }]),
    sec([{ id: 'a1', laenge_beats: 1, name: 'x'.repeat(41) }]), sec([{ id: 'a1', laenge_beats: 1, name: 3 }]), sec([{ id: 'a1', laenge_beats: 1, x: 1 }])]) {
    const r = trackerPruefung(m);
    assert.ok(r !== null, JSON.stringify(m));
    assert.equal(r.grund, 'tracker');
    assert.ok(typeof r.text === 'string' && r.text.length > 0);
    if (m !== null && typeof m === 'object') assert.notEqual(pruefeFehler(mitMarke(m)), null, JSON.stringify(m));
  }
  // exactly 256 sections is fine
  assert.equal(trackerPruefung({ schema: 1, abschnitte: lang.slice(0, 256) }), null);
});

test('marker with live or werkbank is refused; /1 refuses the field', () => {
  const a = neuesProjekt('x'); a.tracker = { schema: 1 }; a.live = true;
  assert.match(pruefeFehler(a), /tracker/);
  const b = neuesProjekt('x'); b.tracker = { schema: 1 }; b.werkbank = { schema: 1 };
  assert.match(pruefeFehler(b), /tracker/);
  const c = JSON.parse(JSON.stringify(neuesProjekt('x'))); c.format = 'cypherdj-projekt/1'; delete c.gruppen; delete c.master; c.tracker = { schema: 1 };
  assert.notEqual(pruefeFehler(c), null);
});

test('tracker_setzen: creates the marker, sets and removes fields', () => {
  let p = lauf(neuesProjekt('x'), { befehl: 'tracker_setzen', an: true });
  assert.deepEqual(p.tracker, { schema: 1 });
  p = lauf(p, { befehl: 'tracker_setzen', lpb: 8, ticks: 12 });
  assert.deepEqual(p.tracker, { schema: 1, lpb: 8, ticks: 12 });
  p = lauf(p, { befehl: 'tracker_setzen', lpb: null });
  assert.deepEqual(p.tracker, { schema: 1, ticks: 12 });
  p = lauf(p, { befehl: 'tracker_setzen', ticks: 6 });   // default removes the field
  assert.deepEqual(p.tracker, { schema: 1 });
  assert.equal(pruefeFehler(p), null);
  // lpb 4 on a marker with lpb 8 removes lpb
  assert.deepEqual(lauf(mitMarke({ schema: 1, lpb: 8 }), { befehl: 'tracker_setzen', lpb: 4 }).tracker, { schema: 1 });
  // lpb without `an` creates the marker too
  assert.deepEqual(lauf(neuesProjekt('x'), { befehl: 'tracker_setzen', lpb: 12 }).tracker, { schema: 1, lpb: 12 });
  // sections stay untouched
  const s = { schema: 1, abschnitte: [{ id: 'a1', laenge_beats: 16 }] };
  assert.deepEqual(lauf(mitMarke(s), { befehl: 'tracker_setzen', ticks: 8 }).tracker, { ...s, ticks: 8 });
});

test('tracker_setzen: one undo step, no playback change', () => {
  const r = fuehreListeAus(kopie(neuesProjekt('x')), [{ befehl: 'tracker_setzen', lpb: 8 }]);
  assert.equal(r.betrifft_wiedergabe, false);
  assert.ok(r.vor.length > 0 && r.zurueck.length > 0);
});

test('tracker_setzen: refusals', () => {
  const p = neuesProjekt('x');
  const live = neuesProjekt('x'); live.live = true;
  const wb = neuesProjekt('x'); wb.werkbank = { schema: 1 };
  assert.equal(grund(live, { befehl: 'tracker_setzen', lpb: 8 }), 'tracker_live');
  assert.equal(grund(live, { befehl: 'tracker_setzen', an: true }), 'tracker_live');
  assert.equal(grund(wb, { befehl: 'tracker_setzen', lpb: 8 }), 'tracker_werkbank');
  assert.equal(grund(p, { befehl: 'tracker_setzen' }), 'argument_ungueltig');
  for (const x of [{ lpb: 5 }, { lpb: '4' }, { lpb: 4.5 }, { ticks: 0 }, { ticks: 25 }, { ticks: 2.5 }, { ticks: '6' }, { an: false }, { an: 1 }]) {
    assert.equal(grund(p, { befehl: 'tracker_setzen', ...x }), 'argument_ungueltig', JSON.stringify(x));
  }
  assert.equal(grund(p, { befehl: 'tracker_setzen', lpb: 8, nope: 1 }), 'argument_unbekannt');
});

test('spalte: 1 is accepted and stored absent, 9 and bad values are refused', () => {
  const p = mitClip();
  const cid = clipVon(p).id;
  const q = lauf(p, { befehl: 'noten_neu', clip_id: cid, noten: [{ beat: 1, laenge: 1, ton: 62, vel: 90, spalte: 1 }, { beat: 2, laenge: 1, ton: 64, vel: 90, spalte: 3 }] });
  const n = clipVon(q).noten;
  assert.equal('spalte' in n[1], false);
  assert.equal(n[2].spalte, 3);
  assert.equal(pruefeFehler(q), null);
  for (const s of [9, 0, -1, 2.5, '2', true]) {
    assert.equal(grund(p, { befehl: 'noten_neu', clip_id: cid, noten: [{ beat: 1, laenge: 1, ton: 62, vel: 90, spalte: s }] }), 'argument_ungueltig', String(s));
  }
  // clip_neu with notes goes the same way
  const c = lauf(instr(neuesProjekt('x')), { befehl: 'clip_neu', spur_id: instr(neuesProjekt('x')).spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 4,
    noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100, spalte: 1 }, { beat: 1, laenge: 1, ton: 60, vel: 100, spalte: 2 }] });
  assert.deepEqual(clipVon(c).noten.map((x) => x.spalte), [undefined, 2]);
});

test('spalte: noten_aendern sets, 1 and null remove', () => {
  let p = mitClip();
  const cid = clipVon(p).id, nid = clipVon(p).noten[0].id;
  p = lauf(p, { befehl: 'noten_aendern', clip_id: cid, noten: [{ id: nid, spalte: 4 }] });
  assert.equal(clipVon(p).noten[0].spalte, 4);
  assert.equal(pruefeFehler(p), null);
  assert.equal('spalte' in clipVon(lauf(p, { befehl: 'noten_aendern', clip_id: cid, noten: [{ id: nid, spalte: null }] })).noten[0], false);
  assert.equal('spalte' in clipVon(lauf(p, { befehl: 'noten_aendern', clip_id: cid, noten: [{ id: nid, spalte: 1 }] })).noten[0], false);
  assert.equal(grund(p, { befehl: 'noten_aendern', clip_id: cid, noten: [{ id: nid, spalte: 9 }] }), 'argument_ungueltig');
  assert.equal(grund(p, { befehl: 'noten_aendern', clip_id: cid, noten: [{ id: nid, spalte: 0 }] }), 'argument_ungueltig');
  // removing a field that is absent is not an error
  const q = lauf(mitClip(), { befehl: 'noten_aendern', clip_id: cid, noten: [{ id: nid, spalte: null }] });
  assert.equal('spalte' in clipVon(q).noten[0], false);
});

test('a stored note: spalte 2..8 valid, 1 and 9 refused by pruefeProjekt', () => {
  const p = mitClip();
  for (const [s, ok] of [[2, true], [8, true], [1, false], [9, false], [3.5, false]]) {
    const q = kopie(p); clipVon(q).noten[0].spalte = s;
    assert.equal(pruefeFehler(q) === null, ok, String(s));
  }
});

test('old projects round-trip byte for byte', () => {
  const p = mitClip();
  const text = JSON.stringify(p);
  const r = pruefeProjekt(JSON.parse(text));
  assert.ok(r.projekt);
  assert.equal(JSON.stringify(r.projekt), text);
  const q = lauf(p, { befehl: 'noten_aendern', clip_id: clipVon(p).id, noten: [{ id: clipVon(p).noten[0].id, vel: 100 }] });
  assert.equal(JSON.stringify(q).includes('spalte'), false);
  assert.equal(JSON.stringify(q).includes('tracker'), false);
});
