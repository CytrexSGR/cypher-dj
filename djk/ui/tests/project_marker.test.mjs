// Arrangement markers: the project field `marker`, the commands marker_setzen and marker_loeschen, the time operations that move them, markerBereich.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { neuesProjekt, pruefeFehler, wiedergabeSicht } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { grundText } from '../http/reasons.ts';
import { markerBereich, markerNameFehler, MARKER_MAX } from '../public/production/marker.js';
import { kopie, tmpOrdner } from './support/project.mjs';

const lauf = (p, ...b) => fuehreListeAus(kopie(p), b);
const grund = (p, b) => { try { fuehreListeAus(kopie(p), [b]); return null; } catch (e) { return e.grund; } };
const detail = (p, b) => { try { fuehreListeAus(kopie(p), [b]); return null; } catch (e) { return e.detail; } };
const GERAET = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
const NOTE = { beat: 3, laenge: 0.5, ton: 72, vel: 80 };
const midi = (start, laenge = 16) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: start, laenge_beats: laenge, noten: [NOTE] });
const setze = (beat, name, extra = {}) => ({ befehl: 'marker_setzen', beat, name, ...extra });
const beats = (p) => (p.marker ?? []).map((m) => m.beat);
const ids = (p) => (p.marker ?? []).map((m) => m.id);

// clips at 0..16 and 32..48, so the stretch 16..32 is free of clips
function mitClips() {
  let p = lauf(neuesProjekt('x'), { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: GERAET }).projekt;
  p = lauf(p, midi(0), midi(32)).projekt;
  return p;
}
const mitMarkern = (p, ...bs) => lauf(p, ...bs.map((b, i) => setze(b, `M${i + 1}`))).projekt;

test('marker_setzen creates markers: ids from the counter, stored sorted by beat, optional colour', () => {
  const p = neuesProjekt('x');
  assert.equal('marker' in p, false);
  const a = lauf(p, setze(32, 'Drop', { farbe: 3 })).projekt;
  assert.deepEqual(a.marker, [{ id: 'm1', beat: 32, name: 'Drop', farbe: 3 }]);
  const b = lauf(a, setze(8, 'Intro')).projekt;
  assert.deepEqual(b.marker, [{ id: 'm2', beat: 8, name: 'Intro' }, { id: 'm1', beat: 32, name: 'Drop', farbe: 3 }]);
  assert.equal(b.naechste_id.marker, 3);
  assert.equal(pruefeFehler(b), null);
});

test('marker_setzen with an id changes each field; farbe null removes the colour; one change moves the sort position', () => {
  const p = mitMarkern(neuesProjekt('x'), 8, 32);
  const a = lauf(p, { befehl: 'marker_setzen', id: 'm1', name: 'Intro', farbe: 5 }).projekt;
  assert.deepEqual(a.marker[0], { id: 'm1', beat: 8, name: 'Intro', farbe: 5 });
  const b = lauf(a, { befehl: 'marker_setzen', id: 'm1', farbe: null }).projekt;
  assert.equal('farbe' in b.marker[0], false);
  const c = lauf(b, { befehl: 'marker_setzen', id: 'm1', beat: 64 }).projekt;
  assert.deepEqual(ids(c), ['m2', 'm1']);
  assert.deepEqual(beats(c), [32, 64]);
  const d = lauf(c, { befehl: 'marker_setzen', id: 'm2', beat: 32 }).projekt;
  assert.deepEqual(d.marker, c.marker, 'setting a marker to its own beat is no collision');
});

test('marker_loeschen removes; the last one removes the field; ids are never reused', () => {
  const p = mitMarkern(neuesProjekt('x'), 8, 32);
  const a = lauf(p, { befehl: 'marker_loeschen', id: 'm2' }).projekt;
  assert.deepEqual(ids(a), ['m1']);
  const b = lauf(a, setze(40, 'N')).projekt;
  assert.deepEqual(ids(b), ['m1', 'm3'], 'the id of a deleted marker does not come back');
  const c = lauf(lauf(b, { befehl: 'marker_loeschen', id: 'm1' }).projekt, { befehl: 'marker_loeschen', id: 'm3' }).projekt;
  assert.equal('marker' in c, false, 'never written as an empty list');
  assert.equal(lauf(c, setze(1, 'again')).projekt.marker[0].id, 'm4', 'the counter outlives the field');
});

test('refusals: unknown id, taken beat, the 65th marker, bad values', () => {
  const p = mitMarkern(neuesProjekt('x'), 8, 32);
  assert.equal(grund(p, { befehl: 'marker_setzen', id: 'm9', name: 'x' }), 'songmarker_unbekannt');
  assert.equal(grund(p, { befehl: 'marker_loeschen', id: 'm9' }), 'songmarker_unbekannt');
  assert.equal(grund(p, setze(8, 'Same')), 'marker_beat_belegt');
  assert.equal(grund(p, { befehl: 'marker_setzen', id: 'm2', beat: 8 }), 'marker_beat_belegt');
  assert.match(detail(p, setze(8, 'Same')), /m1/);
  let voll = neuesProjekt('x');
  for (let i = 0; i < MARKER_MAX; i += 1) voll = lauf(voll, setze(i, `M${i}`)).projekt;
  assert.equal(voll.marker.length, 64);
  assert.equal(grund(voll, setze(500, 'one too many')), 'marker_zu_viele');
  assert.equal(grund(voll, { befehl: 'marker_setzen', id: 'm1', beat: 500 }), null, 'a change at the limit is fine');
  const schlecht = [setze(-1, 'x'), setze(100001, 'x'), setze('8', 'x'), setze(NaN, 'x'), setze(8, ''), setze(8, 'x'.repeat(41)), setze(8, 'a\nb'), setze(8, 'a\u0000b'),
    setze(8, 5), setze(8, 'x', { farbe: 16 }), setze(8, 'x', { farbe: -1 }), setze(8, 'x', { farbe: 1.5 }), setze(8, 'x', { farbe: null }),
    { befehl: 'marker_setzen', name: 'no beat' }, { befehl: 'marker_setzen', beat: 4 }, { befehl: 'marker_setzen' }, { befehl: 'marker_setzen', id: 'm1' },
    { befehl: 'marker_setzen', id: 'm1', beat: -2 }, { befehl: 'marker_setzen', id: 'm1', name: '' }, { befehl: 'marker_setzen', id: 7, name: 'x' },
    { befehl: 'marker_loeschen' }, { befehl: 'marker_loeschen', id: '' }];
  for (const b of schlecht) assert.equal(grund(p, b), 'argument_ungueltig', JSON.stringify(b));
  assert.equal(grund(p, { befehl: 'marker_setzen', id: 'm1', laenge: 3 }), 'argument_unbekannt');
  assert.equal(grund(p, { befehl: 'marker_loeschen', id: 'm1', beat: 3 }), 'argument_unbekannt');
  assert.equal(lauf(neuesProjekt('x'), setze(8, 'x'.repeat(40))).projekt.marker.length, 1, '40 characters are fine');
  assert.equal(lauf(neuesProjekt('x'), setze(100000, 'end')).projekt.marker.length, 1, 'MAX_BEAT is fine');
});

test('the live container has no markers (tracker_live); a workbench module takes them', () => {
  const live = neuesProjekt('x'); live.live = true; live.plaetze = [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }];
  assert.equal(grund(live, setze(8, 'x')), 'tracker_live');
  assert.match(detail(live, setze(8, 'x')), /markers/);
  const wb = neuesProjekt('x'); wb.werkbank = { schema: 1 };
  const r = lauf(wb, setze(8, 'x'));
  assert.equal(r.projekt.marker.length, 1);
  assert.equal(pruefeFehler(r.projekt), null);
});

test('names with markup characters and an emoji are stored as given', () => {
  for (const n of ['<b>&amp;</b>', 'a < b & c', 'Drop \u{1F525}', "it's \"quoted\""]) {
    assert.equal(lauf(neuesProjekt('x'), setze(4, n)).projekt.marker[0].name, n);
  }
  assert.equal(lauf(neuesProjekt('x'), setze(4, '\u{1F525}'.repeat(40))).projekt.marker.length, 1, 'the limit counts characters, not code units');
});

test('a marker change does not touch the playback: no core reload', () => {
  const p = mitClips();
  const a = lauf(p, setze(8, 'A'), setze(16, 'B', { farbe: 2 }));
  assert.equal(a.betrifft_wiedergabe, false);
  assert.deepEqual(wiedergabeSicht(a.projekt), wiedergabeSicht(p));
  const b = lauf(a.projekt, { befehl: 'marker_setzen', id: 'm1', name: 'C', beat: 9 }, { befehl: 'marker_loeschen', id: 'm2' });
  assert.equal(b.betrifft_wiedergabe, false);
  assert.deepEqual(wiedergabeSicht(b.projekt), wiedergabeSicht(p));
});

test('marker commands are one undo step each, and redo brings them back', (t) => {
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { zeitgeber: false });
  const p = neuesProjekt('x');
  const a = aendere(v, p, [setze(8, 'A'), setze(16, 'B')], { quelle: 'andreas', label: 'Markers' });
  assert.equal(a.projekt.rev, p.rev + 1);
  const b = aendere(v, a.projekt, [{ befehl: 'marker_setzen', id: 'm1', name: 'Z' }], { quelle: 'andreas', label: 'Rename' });
  const u1 = rueckgaengig(v, b.projekt, { quelle: 'andreas' }).projekt;
  assert.equal(u1.marker[0].name, 'A');
  const u2 = rueckgaengig(v, u1, { quelle: 'andreas' }).projekt;
  assert.equal('marker' in u2, false);
  const r = wiederholen(v, u2, { quelle: 'andreas' }).projekt;
  assert.deepEqual(r.marker, a.projekt.marker);
});

test('a project without markers saves byte-identical; one with markers loads and saves unchanged', () => {
  const p = neuesProjekt('x');
  assert.equal(JSON.stringify(p).includes('marker'), false);
  const a = lauf(p, setze(8, 'A', { farbe: 1 }), setze(0, 'B')).projekt;
  assert.equal(pruefeFehler(kopie(a)), null);
  assert.equal(JSON.stringify(kopie(a)), JSON.stringify(a));
  const b = lauf(a, { befehl: 'marker_loeschen', id: 'm1' }, { befehl: 'marker_loeschen', id: 'm2' }).projekt;
  assert.equal(JSON.stringify({ ...b, rev: 0, naechste_id: 0 }), JSON.stringify({ ...p, rev: 0, naechste_id: 0 }));
});

test('a stored project with wrong markers is refused', () => {
  const p = neuesProjekt('x');
  const m = (beat, id = 'm1', extra = {}) => ({ id, beat, name: 'N', ...extra });
  const falsch = [[], 'x', {}, [m(8), m(8, 'm2')], [m(8), m(4, 'm2')], [m(8), m(9)], [m(-1)], [m(100001)], [m(8, 'x1')], [m(8, '')], [m(8, 'm1', { name: '' })],
    [m(8, 'm1', { name: 'a\nb' })], [m(8, 'm1', { name: 'x'.repeat(41) })], [m(8, 'm1', { farbe: 16 })], [m(8, 'm1', { farbe: 1.5 })], [m(8, 'm1', { extra: 1 })],
    [{ id: 'm1', beat: 8 }], Array.from({ length: 65 }, (_, i) => m(i, `m${i + 1}`))];
  for (const x of falsch) assert.match(String(pruefeFehler({ ...p, marker: x })), /marker/, JSON.stringify(x).slice(0, 80));
  assert.match(String(pruefeFehler({ ...p, marker: [m(8)], live: true, plaetze: [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }] })), /marker/);
  assert.equal(pruefeFehler({ ...p, marker: [m(4), m(8, 'm2', { farbe: 0 })], naechste_id: { spur: 1, clip: 1, gruppe: 1, marker: 3 } }), null);
  assert.match(String(pruefeFehler({ ...p, naechste_id: { spur: 1, clip: 1, gruppe: 1, marker: 0 } })), /naechste_id\.marker/);
});

test('zeit_einfuegen: markers at or behind the insert point move later, earlier ones stay', () => {
  const p = mitMarkern(mitClips(), 8, 16, 20, 40);
  const q = lauf(p, { befehl: 'zeit_einfuegen', beat: 16, beats: 4 });
  assert.deepEqual(beats(q.projekt), [8, 20, 24, 44]);
  assert.deepEqual(ids(q.projekt), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(pruefeFehler(q.projekt), null);
  const g = lauf(neuesProjekt('x'), setze(5, 'a'), { befehl: 'zeit_einfuegen', beat: 5, beats: 1 }).projekt;
  assert.deepEqual(beats(g), [6], 'a marker exactly at the insert point moves');
  assert.equal(grund(lauf(neuesProjekt('x'), setze(99999, 'a')).projekt, { befehl: 'zeit_einfuegen', beat: 0, beats: 5 }), 'zu_gross');
});

test('zeit_entfernen: a marker on the start beat goes, one on the end beat survives and moves to the start (the rule of the lane points)', (t) => {
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { zeitgeber: false });
  const p = mitMarkern(mitClips(), 8, 16, 20, 32, 40);          // M1 before, M2 on the start, M3 inside, M4 on the end, M5 behind; removed range 16..32
  const r = aendere(v, p, [{ befehl: 'zeit_entfernen', beat: 16, beats: 16 }], { quelle: 'andreas', label: 'Cut' });
  assert.deepEqual(r.projekt.marker.map((m) => [m.id, m.beat]), [['m1', 8], ['m4', 16], ['m5', 24]]);
  assert.equal(pruefeFehler(r.projekt), null);
  const u = rueckgaengig(v, r.projekt, { quelle: 'andreas' }).projekt;
  assert.deepEqual(u.marker, p.marker, 'one undo step brings all five back with their ids');
  const w = wiederholen(v, u, { quelle: 'andreas' }).projekt;
  assert.deepEqual(w.marker, r.projekt.marker);
});

test('zeit_entfernen that drops every marker removes the field; no two markers ever share a beat', () => {
  const p = mitMarkern(mitClips(), 16, 20);
  const q = lauf(p, { befehl: 'zeit_entfernen', beat: 16, beats: 16 }).projekt;
  assert.equal('marker' in q, false);
  const r = mitMarkern(mitClips(), 15, 16, 31, 32);
  const s = lauf(r, { befehl: 'zeit_entfernen', beat: 16, beats: 16 }).projekt;
  assert.deepEqual(beats(s), [15, 16], 'the marker at 32 lands on the cut, the one at 15 is before it');
  assert.equal(new Set(beats(s)).size, beats(s).length);
  assert.equal(pruefeFehler(s), null);
});

test('section commands move the markers with the material and keep them sorted', () => {
  let p = lauf(mitClips(), { befehl: 'abschnitt_umbenennen', id: 'a1', name: 'A' }).projekt;       // list a1 a2 a3 of 16 beats each
  p = mitMarkern(p, 5, 21, 40);
  const v = lauf(p, { befehl: 'abschnitt_verschieben', id: 'a1', richtung: 1 }).projekt;           // a1 and a2 swap
  assert.deepEqual(v.marker.map((m) => [m.id, m.beat]), [['m2', 5], ['m1', 21], ['m3', 40]]);
  const n = lauf(p, { befehl: 'abschnitt_neu', nach: 'a1', zeilen: 16 }).projekt;                  // 4 beats of new time at 16
  assert.deepEqual(beats(n), [5, 25, 44]);
  const l = lauf(p, { befehl: 'abschnitt_loeschen', id: 'a2' }).projekt;                           // 16..32 goes with M2 inside
  assert.deepEqual(l.marker.map((m) => [m.id, m.beat]), [['m1', 5], ['m3', 24]]);
});

test('markerBereich: a middle marker, the last marker, a marker behind all clips, unknown id', () => {
  const p = mitMarkern(mitClips(), 0, 16, 40);                      // the last clip ends at 48
  assert.deepEqual(markerBereich(p, 'm1'), { von_beat: 0, bis_beat: 16 });
  assert.deepEqual(markerBereich(p, 'm2'), { von_beat: 16, bis_beat: 40 });
  assert.deepEqual(markerBereich(p, 'm3'), { von_beat: 40, bis_beat: 48 }, 'the last marker runs to the end of the last clip');
  const ende = lauf(p, setze(48, 'at the end')).projekt;
  assert.equal(markerBereich(ende, 'm4'), null, 'a marker at the end of the last clip: no stretch');
  assert.deepEqual(markerBereich(ende, 'm3'), { von_beat: 40, bis_beat: 48 });
  const hinten = lauf(p, setze(60, 'behind')).projekt;
  assert.equal(markerBereich(hinten, 'm4'), null, 'a marker behind every clip: no stretch');
  assert.deepEqual(markerBereich(hinten, 'm3'), { von_beat: 40, bis_beat: 60 }, 'a middle marker still runs to the next one');
  assert.equal(markerBereich(p, 'm9'), null);
  assert.equal(markerBereich(neuesProjekt('x'), 'm1'), null);
  const eng = mitMarkern(mitClips(), 4, 4.5);
  assert.equal(markerBereich(eng, 'm1'), null, 'under one beat: loop_setzen would refuse it');
  assert.deepEqual(markerBereich({ ...p, marker: [...p.marker].reverse() }, 'm2'), { von_beat: 16, bis_beat: 40 }, 'order of the list does not matter');
});

test('every new refusal code has a literal text', () => {
  for (const g of ['songmarker_unbekannt', 'marker_beat_belegt', 'marker_zu_viele']) {
    const t = grundText(g);
    assert.ok(!t.startsWith('request refused') && /^[a-z]/.test(t), g);
  }
});

test('an unknown id is reported first, before "no change given" and value errors', () => {
  const p = mitMarkern(neuesProjekt('x'), 8, 32);
  assert.equal(grund(p, { befehl: 'marker_setzen', id: 'm9' }), 'songmarker_unbekannt');
  assert.equal(grund(p, { befehl: 'marker_setzen', id: 'm9', name: '' }), 'songmarker_unbekannt');
  assert.equal(grund(p, { befehl: 'marker_setzen', id: 'm9', beat: -1 }), 'songmarker_unbekannt');
  assert.equal(grund(p, { befehl: 'marker_setzen', id: 'm1' }), 'argument_ungueltig');
  assert.equal(detail(p, { befehl: 'marker_setzen', id: 'm1' }), 'no change given: send beat, name or farbe');
});

test('the warp reason marker_unbekannt keeps its own text, no key of GRUND_TEXT is written twice', () => {
  assert.match(grundText('marker_unbekannt'), /no warp marker lies at that beat/);
  assert.match(grundText('songmarker_unbekannt'), /^that marker does not exist/);
  const quelle = readFileSync(new URL('../http/reasons.ts', import.meta.url), 'utf8');
  const literal = quelle.slice(quelle.indexOf('export const GRUND_TEXT'), quelle.indexOf('export const grundText'));
  const schluessel = [...literal.matchAll(/^  ([a-z_0-9]+):/gm)].map((m) => m[1]);
  assert.ok(schluessel.length > 100);
  // three duplicates from before the markers (the later text wins) are known and left alone; a NEW duplicate fails here
  const bekannt = new Set(['preset_unbekannt', 'quelle_ungueltig', 'quelle_unbekannt']);
  assert.deepEqual(schluessel.filter((k, i) => schluessel.indexOf(k) !== i && !bekannt.has(k)), [], 'duplicate keys');
});

test('names: line separators and blank names are refused, with the page helper and the command', () => {
  for (const n of ['a\u0085b', 'a\u2028b', 'a\u2029b', '   ', '\u00a0\u2003', 'a\u0000']) {
    assert.notEqual(markerNameFehler(n), null, JSON.stringify(n));
    assert.equal(grund(neuesProjekt('x'), setze(1, n)), 'argument_ungueltig', JSON.stringify(n));
  }
  assert.equal(markerNameFehler('Drop 2 🎛'), null);
});

test('zeit_einfuegen past the last beat names the marker that would not fit', () => {
  const p = lauf(neuesProjekt('x'), setze(99999, 'a')).projekt;
  assert.match(detail(p, { befehl: 'zeit_einfuegen', beat: 0, beats: 5 }), /marker m1/);
});
