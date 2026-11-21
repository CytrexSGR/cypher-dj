// Container core M2: lift /2 live projects to /3 and derive the places (D4 of the lane plan).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pruefeProjekt, FORMAT, MAX_RETURNS, platzVonGruppe } from '../project/model.ts';

const lies = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const kopie = (x) => JSON.parse(JSON.stringify(x));
const real = () => lies('live_projekt_form2.json');
const synth = () => lies('live_projekt_synthetisch.json');
const hebe = (x) => { const r = pruefeProjekt(kopie(x)); assert.ok(r.projekt, JSON.stringify(r)); return r.projekt; };
const typen = (p) => p.plaetze.map((e) => e.typ);
const gruppeDe = (p, i) => p.plaetze[i].gruppe;
const g = (id, nr, extra = {}) => ({ id, nr, name: id, farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false, ...extra });
const t = (id, nr, grp, extra = {}) => ({
  id, nr, name: id, farbe: '#3bb07a', art: 'instrument', fader_db: 0, pan: 0, mute: false, solo: false, clips: [],
  geraet: { art: 'intern', name: 'rb338', parameter: {} }, ausgang: { art: 'gruppe', id: grp }, ...extra,
});
const r = (id, nr, extra = {}) => ({
  id, nr, name: id, farbe: '#3bb07a', fader_db: 0, pan: 0, mute: false, solo: false,
  hall: { an: true, pre: 0.04, decay: 0.5, groesse: 0.3, tief: 0.5, highcut: 0.8, fahne: 0.6 }, ...extra,
});
const leeres = (extra = {}) => ({
  format: 'cypherdj-projekt/2', name: 'x', rev: 0, wiedergabe_rev: 0, tempo_bpm: 120, taktart: [4, 4], loop: { an: false, von_beat: 0, bis_beat: 32 },
  metronom: { an: false, pegel_db: -12, ziel: 'master' }, live: true, master: { fader_db: 0 }, gruppen: [], spuren: [], ...extra,
});
const deck = (id, nr, platz, ausgang) => g(id, nr, { loopdeck: { platz, raster: 'takt', ...(ausgang ? { ausgang_platz: ausgang } : {}) } });
const deckSpuren = (grp, nr0) => Array.from({ length: 4 }, (_, i) => ({
  id: `${grp}s${i}`, nr: nr0 + i, name: 'l', farbe: '#3bb07a', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [],
  ausgang: { art: 'gruppe', id: grp }, zellen: Array(8).fill(null),
}));

test('real live shape: places are seq g24, seq g17, loops g26, loops g25', () => {
  const p = hebe(real());
  assert.equal(p.format, FORMAT);
  assert.deepEqual(typen(p), ['seq', 'seq', 'loops', 'loops']);
  assert.deepEqual(p.plaetze.map((e) => e.gruppe), ['g24', 'g17', 'g26', 'g25']);
  assert.equal(p.gruppen.some((x) => x.strudel), false, 'no strudel group is invented');
});

test('real live shape: r1 and r2 are owned by g17, r3 and r4 by loop deck 1, nothing dropped', () => {
  const vor = real(), p = hebe(vor);
  assert.equal(p.returns.length, 4);
  const eigner = Object.fromEntries(p.returns.map((x) => [x.id, x.gruppe]));
  assert.deepEqual(eigner, { r1: 'g17', r2: 'g17', r3: 'g25', r4: 'g25' });
  const sends = (x) => x.spuren.map((s) => [s.id, JSON.stringify(s.sends ?? null)]);
  assert.deepEqual(sends(p), sends(vor));
});

test('real live shape: no group, track, return or send is lost', () => {
  const vor = real(), p = hebe(vor);
  assert.deepEqual(p.gruppen.map((x) => x.id), vor.gruppen.map((x) => x.id));
  assert.deepEqual(p.spuren.map((x) => x.id), vor.spuren.map((x) => x.id));
  assert.deepEqual(p.returns.map((x) => x.id), vor.returns.map((x) => x.id));
  assert.equal(p.spuren.reduce((n, s) => n + (s.sends ?? []).length, 0), vor.spuren.reduce((n, s) => n + (s.sends ?? []).length, 0));
  for (const x of p.gruppen) { assert.equal('platz' in (x.seq ?? {}), false); assert.equal('ausgang_platz' in (x.loopdeck ?? {}), false); }
  assert.equal(platzVonGruppe(p, 'g25'), 4);
});

test('synthetic: SEQ in place 1, loop deck on place 4, no other group gives [seq, track, strudel, loops]', () => {
  const p = hebe(synth());
  assert.deepEqual(typen(p), ['seq', 'track', 'strudel', 'loops']);
  const s = p.gruppen.find((x) => x.strudel);
  assert.ok(s, 'the empty strudel group exists');
  assert.equal(p.plaetze[2].gruppe, s.id);
  assert.equal(s.name, 'STRUDEL');
  assert.equal(p.spuren.some((x) => x.ausgang?.id === s.id), false, 'empty');
});

test('module slot A goes to place 3, slot B to place 4', () => {
  const modul = { quelle_sha256: 'a'.repeat(64), titel: 't', fassung: 'f', basis_bpm: 120, von_beat: 0, laenge_beats: 16, bpm: 120, datum: '2026-11-20' };
  const p = hebe(leeres({ gruppen: [g('g1', 1, { modul: { ...modul, slot: 'B' } }), g('g2', 2, { modul: { ...modul, slot: 'A' } })] }));
  assert.deepEqual(p.plaetze.slice(2).map((e) => [e.typ, e.gruppe]), [['stems', 'g2'], ['stems', 'g1']]);
  assert.equal('slot' in p.gruppen[0].modul, false);
});

test('loop deck without ausgang_platz: deck 1 -> place 3, deck 2 -> place 4', () => {
  const p = hebe(leeres({ gruppen: [deck('g1', 1, 1), deck('g2', 2, 2)], spuren: [...deckSpuren('g1', 1), ...deckSpuren('g2', 5)] }));
  assert.deepEqual(p.plaetze.slice(2).map((e) => e.gruppe), ['g1', 'g2']);
});

test('a second claimant of a place is parked, not dropped', () => {
  const p = hebe(leeres({ gruppen: [g('g1', 1, { seq: { schema: 2, platz: 1 } }), g('g2', 2, { seq: { schema: 2, platz: 1 } })] }));
  assert.equal(p.plaetze[0].gruppe, 'g1');
  assert.equal(platzVonGruppe(p, 'g2'), null);
  assert.ok(p.gruppen.some((x) => x.id === 'g2'));
});

test('loops is not added by default when a loop deck exists elsewhere; strudel is not added twice', () => {
  const p = hebe(leeres({ gruppen: [deck('g1', 1, 1, 1), g('g2', 2, { seq: { schema: 2, platz: 4 } })], spuren: deckSpuren('g1', 1) }));
  assert.deepEqual(typen(p), ['loops', 'track', 'strudel', 'seq']);
  assert.equal(p.gruppen.filter((x) => x.strudel).length, 1);
});

test('generic return sent into by two groups is duplicated per group', () => {
  const x = leeres({
    gruppen: [g('g1', 1, { seq: { schema: 2, platz: 1 } }), g('g2', 2, { seq: { schema: 2, platz: 2 } })],
    spuren: [t('s1', 1, 'g1', { sends: [{ id: 'r1', db: -6 }] }), t('s2', 2, 'g2', { sends: [{ id: 'r1', db: -9 }] })],
    returns: [r('r1', 1, { name: 'Hall' })],
  });
  const p = hebe(x);
  assert.equal(p.returns.length, 2);
  const [a, b] = p.returns;
  assert.equal(a.gruppe, 'g1'); assert.equal(b.gruppe, 'g2');
  assert.equal(b.name, 'Hall g2');
  assert.deepEqual(p.spuren[0].sends, [{ id: 'r1', db: -6 }]);
  assert.deepEqual(p.spuren[1].sends, [{ id: b.id, db: -9 }]);
});

test('over the limit: refused returns_voll', () => {
  const returns = Array.from({ length: MAX_RETURNS }, (_, i) => r(`r${i + 1}`, i + 1));
  const x = leeres({
    gruppen: [g('g1', 1, { seq: { schema: 2, platz: 1 } }), g('g2', 2, { seq: { schema: 2, platz: 2 } })],
    spuren: [t('s1', 1, 'g1', { sends: [{ id: 'r1', db: -6 }] }), t('s2', 2, 'g2', { sends: [{ id: 'r1', db: -9 }] })], returns,
  });
  // r2..r8 have no sender and no insert: dropped; make them used so that the duplicate no longer fits
  x.spuren[0].sends = returns.map((q) => ({ id: q.id, db: -6 }));
  const f = pruefeProjekt(kopie(x));
  assert.ok('fehler' in f, 'expected a refusal');
  assert.match(f.fehler, /returns_voll/);
});

test('unsent empty return is dropped; unsent return with an insert is kept and owned by the group of place 1', () => {
  const insert = { id: 'i1', art: 'bk', slot: 1, an: true, graph: 'fx-delay-sync', werte: Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`k${i + 1}`, 0.5])) };
  const x = leeres({
    gruppen: [g('g1', 1, { seq: { schema: 2, platz: 1 } })], spuren: [t('s1', 1, 'g1')],
    returns: [r('r1', 1), r('r2', 2, { inserts: [insert] })],
  });
  const p = hebe(x);
  assert.deepEqual(p.returns.map((q) => q.id), ['r2']);
  assert.equal(p.returns[0].gruppe, 'g1');
});

test('upgrade is idempotent', () => {
  for (const x of [real(), synth()]) {
    const a = hebe(x), b = hebe(a);
    assert.deepEqual(b, a);
  }
});

test('a /2 production project only changes its format string', () => {
  const x = leeres({ gruppen: [g('g1', 1)], spuren: [t('s1', 1, 'g1')], returns: [r('r1', 1)] });
  delete x.live;
  const p = hebe(x);
  const erwartet = kopie(hebe({ ...x, format: FORMAT }));
  assert.equal(p.format, FORMAT);
  assert.equal('plaetze' in p, false);
  assert.deepEqual(p, erwartet);
  assert.equal(p.returns[0].gruppe, undefined);
});

test('a /2 file with places, or with a /3 only field, is refused', () => {
  const x = leeres(); x.plaetze = [];
  assert.ok('fehler' in pruefeProjekt(kopie(x)));
});
