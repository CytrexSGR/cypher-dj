// Session view S1b, B1: the cell fields transponieren, rueckwaerts, blende, scheiben, keylock and huellen, their commands and the
// rule that the model refuses everything the core loader (zell_map.h, zelle_erweitern) would refuse.
// Reasons: shape and range errors are argument_ungueltig (as every command argument), the named ones nur_keylock, scheiben_ungueltig, huelle_ungueltig.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { neuesProjekt, pruefeProjekt, loopDeckGruppe, loopDeckSpuren, ZELL_ZIEL_BEREICH } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { tmpOrdner } from './support/project.mjs';

const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }]; return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const fehler = (p, ...b) => { try { fuehreListeAus(p, b); } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e; } return assert.fail(`${b.map((x) => x.befehl)} was not refused`); };
const kopie = (x) => JSON.parse(JSON.stringify(x));
const valide = (p) => { const u = pruefeProjekt(kopie(p)); assert.ok('projekt' in u, JSON.stringify(u)); };
const SHA = 'a'.repeat(64);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });
const A = { quelle: 'andreas', label: 'Test' };
// a live project with deck 1; cell 1 of its first track holds `zelle`, cell 2 an one-shot
function mitZelle(extra = {}) {
  let p = lauf(live(), { befehl: 'loopdeck_neu', platz: 1 });
  const id = loopDeckSpuren(p, loopDeckGruppe(p, 1))[0].id;
  p = lauf(p, { befehl: 'zelle_setzen', spur_id: id, index: 1, zelle: Z(extra) },
    { befehl: 'zelle_setzen', spur_id: id, index: 2, zelle: Z({ art: 'einmal', name: 'Hit' }) });
  return { p, id };
}
const cell = (p, id, i = 1) => p.spuren.find((s) => s.id === id).zellen[i - 1];
const aendern = (id, felder, index = 1) => ({ befehl: 'zelle_aendern', spur_id: id, index, ...felder });
const huelle = (id, ziel, punkte, index = 1) => ({ befehl: 'zelle_huelle', spur_id: id, index, ziel, punkte });
const gleichmaessig = (n, beats = 4) => Array.from({ length: n }, (_, i) => i * beats / n);
const scheiben = (grenzen, folge = grenzen.map((_, i) => i + 1), teilung = '1/16') => ({ teilung, grenzen, folge });
function mitUndo(t, p, ...befehle) {
  const dir = tmpOrdner(t);
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { jetzt: () => 0, zeitgeber: false });
  const r = aendere(v, p, befehle, A);
  valide(r.projekt);
  const u = rueckgaengig(v, r.projekt, { quelle: 'andreas' });
  const ohne = (x) => JSON.stringify({ ...x, rev: 0, wiedergabe_rev: 0, naechste_id: undefined });
  assert.equal(ohne(u.projekt), ohne(p), `undo of ${befehle.map((b) => b.befehl)} restores the project`);
  return r.projekt;
}

test('transponieren: integer -24..24 on a loop cell; 0 is not stored; null removes', (t) => {
  const { p, id } = mitZelle();
  const q = mitUndo(t, p, aendern(id, { transponieren: 7 }));
  assert.equal(cell(q, id).transponieren, 7);
  assert.equal(cell(lauf(q, aendern(id, { transponieren: -24 })), id).transponieren, -24);
  assert.equal(cell(lauf(q, aendern(id, { transponieren: 0 })), id).transponieren, undefined);
  const r = mitUndo(t, q, aendern(id, { transponieren: null }));
  assert.ok(!('transponieren' in cell(r, id)));
  assert.equal(fehler(p, aendern(id, { transponieren: 2.5 })).grund, 'argument_ungueltig');
  assert.equal(fehler(p, aendern(id, { transponieren: 25 })).grund, 'argument_ungueltig');
  assert.equal(fehler(p, aendern(id, { transponieren: '3' })).grund, 'argument_ungueltig');
});

test('transponieren on a one-shot, with keylock off, or kept across a change to one-shot or keylock off: nur_keylock', () => {
  const { p, id } = mitZelle();
  assert.equal(fehler(p, aendern(id, { transponieren: 3 }, 2)).grund, 'nur_keylock');
  const q = lauf(p, aendern(id, { keylock: false }));
  assert.equal(fehler(q, aendern(id, { transponieren: 3 })).grund, 'nur_keylock');
  assert.equal(fehler(p, aendern(id, { keylock: false, transponieren: 3 })).grund, 'nur_keylock', 'both in one command');
  const t3 = lauf(p, aendern(id, { transponieren: 3 }));
  assert.equal(fehler(t3, aendern(id, { keylock: false })).grund, 'nur_keylock');
  assert.equal(fehler(t3, aendern(id, { art: 'einmal' })).grund, 'nur_keylock');
  assert.equal(cell(lauf(t3, aendern(id, { keylock: false, transponieren: null })), id).keylock, false);
});

test('keylock: false only on loop cells; true is never stored; null removes', (t) => {
  const { p, id } = mitZelle();
  const q = mitUndo(t, p, aendern(id, { keylock: false }));
  assert.equal(cell(q, id).keylock, false);
  assert.ok(!('keylock' in cell(lauf(q, aendern(id, { keylock: true })), id)), 'true removes the field');
  assert.ok(!('keylock' in cell(lauf(q, aendern(id, { keylock: null })), id)));
  assert.equal(fehler(p, aendern(id, { keylock: false }, 2)).grund, 'argument_ungueltig', 'a one-shot plays unstretched anyway');
  assert.ok(!('keylock' in cell(lauf(p, aendern(id, { keylock: true }, 2)), id, 2)));
  assert.equal(fehler(q, aendern(id, { art: 'einmal' })).grund, 'argument_ungueltig', 'a cell with keylock off cannot become a one-shot');
  assert.equal(fehler(p, aendern(id, { keylock: 0 })).grund, 'argument_ungueltig');
});

test('rueckwaerts and blende are true or absent', (t) => {
  const { p, id } = mitZelle();
  const q = mitUndo(t, p, aendern(id, { rueckwaerts: true, blende: true }));
  assert.equal(cell(q, id).rueckwaerts, true);
  assert.equal(cell(q, id).blende, true);
  const r = mitUndo(t, q, aendern(id, { rueckwaerts: null, blende: null }));
  assert.ok(!('rueckwaerts' in cell(r, id)) && !('blende' in cell(r, id)));
  assert.ok(!('blende' in cell(lauf(q, aendern(id, { blende: false })), id)), 'false removes');
  assert.equal(fehler(p, aendern(id, { rueckwaerts: 1 })).grund, 'argument_ungueltig');
  assert.equal(cell(lauf(p, aendern(id, { rueckwaerts: true, blende: true }, 2)), id, 2).rueckwaerts, true, 'a one-shot may be reversed');
});

test('scheiben: rising grenzen from 0 below beats, at most 64, folge of the same length with 1..n', (t) => {
  const { p, id } = mitZelle();
  const g = gleichmaessig(16);
  const q = mitUndo(t, p, aendern(id, { scheiben: scheiben(g) }));
  assert.deepEqual(cell(q, id).scheiben.grenzen, g);
  assert.equal(cell(lauf(q, aendern(id, { scheiben: scheiben(g, g.map((_, i) => (i * 5) % 16 + 1)) })), id).scheiben.folge[1], 6);
  assert.equal(cell(lauf(q, aendern(id, { scheiben: scheiben(g, g.map(() => 1)) })), id).scheiben.folge.length, 16, 'repeats = stutter');
  const r = mitUndo(t, q, aendern(id, { scheiben: null }));
  assert.ok(!('scheiben' in cell(r, id)));
  assert.equal(cell(lauf(p, aendern(id, { scheiben: scheiben(gleichmaessig(64, 16)) , beats: 16 })), id).scheiben.grenzen.length, 64);
  // the one-shot slices like a loop
  assert.equal(cell(lauf(p, aendern(id, { scheiben: scheiben(gleichmaessig(4)) }, 2)), id, 2).scheiben.grenzen.length, 4);
});

test('scheiben violations are scheiben_ungueltig', () => {
  const { p, id } = mitZelle();
  const schlecht = {
    'first boundary not 0': scheiben([0.5, 1, 2]),
    'not rising': scheiben([0, 2, 2, 3]),
    'falling': scheiben([0, 2, 1]),
    'boundary at beats': scheiben([0, 2, 4]),
    'boundary beyond beats': scheiben([0, 5]),
    'empty': scheiben([], []),
    'folge too short': scheiben([0, 1, 2], [1, 2]),
    'folge too long': scheiben([0, 1], [1, 2, 3]),
    'folge 0-based': scheiben([0, 1, 2], [0, 1, 2]),
    'folge beyond n': scheiben([0, 1, 2], [1, 2, 4]),
    'folge fractional': scheiben([0, 1, 2], [1, 2, 2.5]),
    'unknown teilung': scheiben([0, 1], [1, 2], '1/32'),
    'boundary not a number': scheiben([0, 'x'], [1, 2]),
    'extra key': { ...scheiben([0, 1]), extra: 1 },
    'not an object': [0, 1],
  };
  for (const [was, s] of Object.entries(schlecht)) assert.equal(fehler(p, aendern(id, { scheiben: s })).grund, 'scheiben_ungueltig', was);
  assert.equal(fehler(p, aendern(id, { scheiben: scheiben(gleichmaessig(65, 16)), beats: 16 })).grund, 'scheiben_ungueltig', '65 slots');
});

test('lader rules caught by the model: a slot shorter than 192 frames (from beats and the source tempo) and a one-shot without beats', () => {
  const { p, id } = mitZelle();   // 4 beats at 120 bpm = 2 s = 96000 frames; 192 frames = 0.004 beats
  assert.equal(fehler(p, aendern(id, { scheiben: scheiben([0, 0.003]) })).grund, 'scheiben_ungueltig', 'first slot of 144 frames');
  assert.equal(fehler(p, aendern(id, { scheiben: scheiben([0, 3.998]) })).grund, 'scheiben_ungueltig', 'last slot of 96 frames');
  assert.ok(cell(lauf(p, aendern(id, { scheiben: scheiben([0, 0.01, 3.9]) })), id).scheiben, 'long enough slots pass');
  // at 200 bpm the same beat grid holds fewer frames: 0.01 beats = 144 frames (at 120 bpm it is 240)
  const schnell = lauf(p, aendern(id, { bpm: 200 }));
  assert.equal(cell(schnell, id).bpm, 200);
  assert.equal(fehler(schnell, aendern(id, { scheiben: scheiben([0, 0.01]) })).grund, 'scheiben_ungueltig', '0.01 beats at 200 bpm = 144 frames');
  // a one-shot without beats cannot take slices (the loader needs beats > 0)
  let q = lauf(p, { befehl: 'zelle_setzen', spur_id: id, index: 3, zelle: { name: 'Hit', farbe: 1, art: 'einmal', sha256: SHA, gain_db: 0 } });
  assert.equal(fehler(q, aendern(id, { scheiben: scheiben([0, 1]) }, 3)).grund, 'scheiben_ungueltig');
  assert.equal(fehler(q, huelle(id, 'gain', [{ beat: 0, wert: -3 }], 3)).grund, 'huelle_ungueltig');
  q = lauf(q, aendern(id, { beats: 2 }, 3));
  assert.ok(cell(lauf(q, aendern(id, { scheiben: scheiben([0, 1]) }, 3)), id, 3).scheiben);
});

test('huellen: gain, filter, send.hall, send.delay, one per target, at most 4', (t) => {
  const { p, id } = mitZelle();
  const q = mitUndo(t, p, huelle(id, 'filter', [{ beat: 0, wert: -1 }, { beat: 3, wert: 1, form: 's' }]));
  assert.deepEqual(cell(q, id).huellen, [{ ziel: 'filter', punkte: [{ beat: 0, wert: -1 }, { beat: 3, wert: 1, form: 's' }] }]);
  let r = lauf(q, huelle(id, 'gain', [{ beat: 0, wert: 0 }]), huelle(id, 'send.hall', [{ beat: 1, wert: -12 }]), huelle(id, 'send.delay', [{ beat: 2, wert: -200 }]));
  assert.deepEqual(cell(r, id).huellen.map((h) => h.ziel), ['filter', 'gain', 'send.hall', 'send.delay']);
  // replacing an envelope of the same target keeps one
  r = lauf(r, huelle(id, 'gain', [{ beat: 0, wert: -6 }, { beat: 2, wert: -1 }]));
  assert.equal(cell(r, id).huellen.filter((h) => h.ziel === 'gain').length, 1);
  assert.equal(cell(r, id).huellen.find((h) => h.ziel === 'gain').punkte.length, 2);
  // null removes that envelope; the last one takes the field with it
  const s = mitUndo(t, r, huelle(id, 'filter', null));
  assert.deepEqual(cell(s, id).huellen.map((h) => h.ziel), ['gain', 'send.hall', 'send.delay']);
  let u = q;
  u = lauf(u, huelle(id, 'filter', null));
  assert.ok(!('huellen' in cell(u, id)));
  assert.equal(fehler(u, huelle(id, 'filter', null)).grund, 'huelle_ungueltig', 'removing a missing envelope is refused, not silent');
});

test('huellen violations are huelle_ungueltig', () => {
  const { p, id } = mitZelle();
  const P = (...b) => b.map((beat) => ({ beat, wert: 0 }));
  const schlecht = [
    ['eq.hoch', P(0)], ['fader', P(0)], ['pitch', P(0)], ['pan', P(0)], ['bogus', P(0)], [7, P(0)],
    ['gain', []], ['gain', P(0, 5)], ['gain', P(4)], ['gain', P(-1)], ['gain', P(0, 1, 1, 1)],
    ['gain', [{ beat: 0, wert: 1 }]], ['gain', [{ beat: 0, wert: -201 }]],
    ['filter', [{ beat: 0, wert: 1.5 }]], ['filter', [{ beat: 0, wert: -1.01 }]],
    ['send.hall', [{ beat: 0, wert: 1 }]], ['send.delay', [{ beat: 0, wert: -300 }]],
    ['gain', [{ beat: 0, wert: 'x' }]], ['gain', [{ beat: 0, wert: NaN }]], ['gain', [{ beat: 0, wert: 0, form: 'zack' }]],
    ['gain', [{ beat: 0, wert: 0, extra: 1 }]], ['gain', 'x'], ['gain', [1, 2]],
    ['gain', Array.from({ length: 65 }, (_, i) => ({ beat: i * 0.05, wert: 0 }))],
  ];
  for (const [ziel, punkte] of schlecht) assert.equal(fehler(p, huelle(id, ziel, punkte)).grund, 'huelle_ungueltig', `${ziel} ${JSON.stringify(punkte)}`);
  // 64 points, beats rising, two at one beat (a jump), all fine
  const ok64 = Array.from({ length: 64 }, (_, i) => ({ beat: i * 0.05, wert: -1 }));
  assert.equal(cell(lauf(p, huelle(id, 'gain', ok64)), id).huellen[0].punkte.length, 64);
  assert.ok(cell(lauf(p, huelle(id, 'gain', [{ beat: 1, wert: 0 }, { beat: 1, wert: -6 }])), id).huellen, 'two points at one beat are allowed');
  // the fifth envelope: only four targets exist, so the cap is reached by the hand-written model; the model check refuses a fifth
  const q = kopie(lauf(p, huelle(id, 'gain', P(0))));
  q.spuren.find((s) => s.id === id).zellen[0].huellen = ['gain', 'filter', 'send.hall', 'send.delay', 'gain'].map((ziel) => ({ ziel, punkte: P(0) }));
  assert.ok('fehler' in pruefeProjekt(q), 'five envelopes (and a double target) are refused by the model check');
  assert.equal(fehler(p, huelle(id, 'gain', P(0)), huelle(id, 'gain', null), huelle(id, 'gain', null)).grund, 'huelle_ungueltig');
  assert.equal(fehler(p, { ...huelle(id, 'gain', P(0)), extra: 1 }).grund, 'argument_unbekannt');
  assert.equal(fehler(p, huelle(id, 'gain', P(0), 5)).grund, 'zelle_leer');
});

test('ZELL_ZIEL_BEREICH is the range of the loader per target', () => {
  assert.deepEqual([ZELL_ZIEL_BEREICH('gain').min, ZELL_ZIEL_BEREICH('gain').max], [-200, 0]);
  assert.deepEqual([ZELL_ZIEL_BEREICH('filter').min, ZELL_ZIEL_BEREICH('filter').max], [-1, 1]);
  for (const z of ['send.hall', 'send.delay']) assert.deepEqual([ZELL_ZIEL_BEREICH(z).min, ZELL_ZIEL_BEREICH(z).max], [-200, 0]);
  assert.equal(ZELL_ZIEL_BEREICH('eq.hoch'), undefined);
});

test('zelle_aendern { beats } that shortens the cell drops points and slots beyond the new length in the same undo step', (t) => {
  const { p, id } = mitZelle();
  const g = gleichmaessig(8);   // 0, .5 .. 3.5
  const mit = lauf(p, aendern(id, { scheiben: scheiben(g, [3, 2, 1, 4, 5, 6, 7, 8]) }),
    huelle(id, 'gain', [{ beat: 0, wert: 0 }, { beat: 1.5, wert: -3 }, { beat: 3, wert: -6 }]), huelle(id, 'filter', [{ beat: 3.5, wert: 1 }]));
  const k = mitUndo(t, mit, aendern(id, { beats: 2 }));
  const z = cell(k, id);
  assert.equal(z.beats, 2);
  assert.deepEqual(z.scheiben.grenzen, [0, 0.5, 1, 1.5]);
  assert.equal(z.scheiben.folge.length, 4);
  assert.ok(z.scheiben.folge.every((f) => f >= 1 && f <= 4), 'folge keeps pointing at existing slots');
  assert.deepEqual(z.huellen.map((h) => [h.ziel, h.punkte.length]), [['gain', 2]], 'the filter envelope lost its only point and is gone');
  // lengthening drops nothing
  const l = lauf(mit, aendern(id, { beats: 8 }));
  assert.equal(cell(l, id).scheiben.grenzen.length, 8);
  assert.equal(cell(l, id).huellen.length, 2);
});

test('zelle_aendern takes bpm (the source tempo); null only on a one-shot', () => {
  const { p, id } = mitZelle();
  assert.equal(cell(lauf(p, aendern(id, { bpm: 128 })), id).bpm, 128);
  assert.equal(fehler(p, aendern(id, { bpm: 5 })).grund, 'argument_ungueltig');
  assert.equal(fehler(p, aendern(id, { bpm: null })).grund, 'projekt_ungueltig', 'a loop needs its bpm');
  assert.ok(!('bpm' in cell(lauf(p, aendern(id, { bpm: null }, 2)), id, 2)));
});

test('an untouched cell and a no-change command stay as before', () => {
  const { p, id } = mitZelle();
  assert.equal(fehler(p, aendern(id, {})).grund, 'argument_ungueltig');
  assert.deepEqual(Object.keys(cell(p, id)).sort(), ['art', 'beats', 'bpm', 'farbe', 'gain_db', 'id', 'name', 'sha256']);
});

test('zelle_setzen carries the new fields and the model refuses a bad cell there too', () => {
  const { p, id } = mitZelle();
  const q = lauf(p, { befehl: 'zelle_setzen', spur_id: id, index: 3, zelle: Z({ transponieren: 2, rueckwaerts: true, scheiben: scheiben([0, 2]),
    huellen: [{ ziel: 'gain', punkte: [{ beat: 0, wert: -3 }] }] }) });
  assert.equal(cell(q, id, 3).transponieren, 2);
  assert.equal(fehler(p, { befehl: 'zelle_setzen', spur_id: id, index: 3, zelle: Z({ art: 'einmal', transponieren: 2 }) }).grund, 'nur_keylock');
  assert.equal(fehler(p, { befehl: 'zelle_setzen', spur_id: id, index: 3, zelle: Z({ scheiben: scheiben([1, 2]) }) }).grund, 'scheiben_ungueltig');
  assert.equal(fehler(p, { befehl: 'zelle_setzen', spur_id: id, index: 3, zelle: Z({ huellen: [{ ziel: 'eq.tief', punkte: [{ beat: 0, wert: 0 }] }] }) }).grund, 'huelle_ungueltig');
});

test('a halten slot and an empty slot are refused by zelle_huelle as zelle_leer', () => {
  const { p, id } = mitZelle();
  const q = lauf(p, { befehl: 'zelle_halten', spur_id: id, index: 4, an: true });
  assert.equal(fehler(q, huelle(id, 'gain', [{ beat: 0, wert: 0 }], 4)).grund, 'zelle_leer');
});
