// Container core M1: project format /3 (places, strudel group, strom tracks, return owners). Pure functions, no file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  neuesProjekt, pruefeProjekt, pruefeFehler, FORMAT, FORMAT_ALT2, MAX_RETURNS, platzVonGruppe, strudelGruppe, stromSpur, geparkteGruppen, wiedergabeSicht,
} from '../project/model.ts';

const kopie = (x) => JSON.parse(JSON.stringify(x));
const gruppe = (id, nr, extra = {}) => ({ id, nr, name: id, farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false, ...extra });
const spur = (id, nr, extra = {}) => ({ id, nr, name: id, farbe: '#3b8de0', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [], ...extra });
const ret = (id, nr, extra = {}) => ({
  id, nr, name: id, farbe: '#3bb07a', fader_db: 0, pan: 0, mute: false, solo: false,
  hall: { an: true, pre: 0.04, decay: 0.5, groesse: 0.3, tief: 0.5, highcut: 0.8, fahne: 0.6 }, ...extra,
});
// a live project with one group of each kind: SEQ (g1), loop deck 1 (g2), strudel (g3) with one strom track, module (g4)
const lebendig = () => {
  const p = neuesProjekt('live'); p.live = true;
  p.gruppen = [
    gruppe('g1', 1, { seq: { schema: 2 } }),
    gruppe('g2', 2, { loopdeck: { platz: 1, raster: '1' } }),
    gruppe('g3', 3, { strudel: {} }),
    gruppe('g4', 4, { modul: { quelle_sha256: 'a'.repeat(64), titel: 't', fassung: 'f', basis_bpm: 120, von_beat: 0, laenge_beats: 16, bpm: 120, datum: '2026-11-20' } }),
  ];
  p.spuren = [spur('s1', 1, { art: 'strom', strom: 3, ausgang: { art: 'gruppe', id: 'g3' } })];
  p.plaetze = [{ typ: 'seq', gruppe: 'g1' }, { typ: 'loops', gruppe: 'g2' }, { typ: 'strudel', gruppe: 'g3' }, { typ: 'stems', gruppe: 'g4' }];
  p.naechste_id = { spur: 2, clip: 1, gruppe: 5 };
  return p;
};
// the loop deck needs its four audio member tracks; the helper adds them so tests that keep g2 stay valid
const mitDeck = (p) => {
  for (let i = 0; i < 4; i++) p.spuren.push(spur(`d${i + 1}`, 10 + i, { ausgang: { art: 'gruppe', id: 'g2' } }));
  return p;
};
const gut = () => mitDeck(lebendig());
const fehler = (p) => pruefeFehler(kopie(p));

test('format constants', () => {
  assert.equal(FORMAT, 'cypherdj-projekt/3'); assert.equal(FORMAT_ALT2, 'cypherdj-projekt/2'); assert.equal(MAX_RETURNS, 8);
});

test('a live project with four valid places passes', () => {
  const p = gut();
  assert.equal(fehler(p), null);
  const r = pruefeProjekt(kopie(p));
  assert.ok(r.projekt, JSON.stringify(r));
});

const ABLEHNUNGEN = [
  ['plaetze with three entries', (p) => { p.plaetze.pop(); }, /plaetze: array of 4/],
  ['unknown place type', (p) => { p.plaetze[0] = { typ: 'loops2', gruppe: 'g1' }; }, /plaetze\[0\]\.typ/],
  ['track with a gruppe', (p) => { p.plaetze[0] = { typ: 'track', gruppe: 'g1' }; }, /plaetze\[0\]\.gruppe: unbekanntes Feld/],
  ['leer with a gruppe', (p) => { p.plaetze[0] = { typ: 'leer', gruppe: 'g1' }; }, /plaetze\[0\]\.gruppe/],
  ['strudel without a gruppe', (p) => { p.plaetze[2] = { typ: 'strudel' }; }, /plaetze\[2\]\.gruppe: fehlt/],
  ['gruppe unknown', (p) => { p.plaetze[2] = { typ: 'strudel', gruppe: 'g99' }; }, /plaetze\[2\]\.gruppe: no top group/],
  ['gruppe of the wrong kind', (p) => { p.plaetze[2] = { typ: 'seq', gruppe: 'g3' }; }, /plaetze\[2\]\.gruppe: group g3 is not a seq group/],
  ['gruppe in two places', (p) => { p.plaetze[0] = { typ: 'strudel', gruppe: 'g3' }; }, /plaetze\[2\]\.gruppe: group g3 already sits/],
  ['nested group in a place', (p) => {
    p.gruppen.push(gruppe('g5', 5, { ausgang: { art: 'gruppe', id: 'g4' } })); p.plaetze[0] = { typ: 'seq', gruppe: 'g5' };
  }, /plaetze\[0\]\.gruppe: no top group/],
  ['strudel in two places', (p) => {
    p.gruppen.push(gruppe('g5', 5, { strudel: {} }));
    p.plaetze[0] = { typ: 'strudel', gruppe: 'g5' };
  }, /strudel is unique/],
  ['third loops place', (p) => {
    p.gruppen.push(gruppe('g5', 5, { loopdeck: { platz: 2, raster: '1' } }), gruppe('g6', 6, { loopdeck: { platz: 1, raster: '1' } }));
    p.plaetze[0] = { typ: 'loops', gruppe: 'g5' }; p.plaetze[2] = { typ: 'loops', gruppe: 'g6' };
  }, /loop deck|loops/],
  ['two loop decks with the same identity', (p) => { p.gruppen.push(gruppe('g5', 5, { loopdeck: { platz: 1, raster: '1' } })); }, /gruppen\[4\]\.loopdeck\.platz: duplicate/],
  ['third stems place', (p) => {
    const m = p.gruppen[3].modul;
    p.gruppen.push(gruppe('g5', 5, { modul: m }), gruppe('g6', 6, { modul: m }));
    p.plaetze[0] = { typ: 'stems', gruppe: 'g5' }; p.plaetze[1] = { typ: 'stems', gruppe: 'g6' };
  }, /at most two stems places/],
  ['strudel on a nested group', (p) => { p.gruppen[2].ausgang = { art: 'gruppe', id: 'g1' }; }, /strudel: the strudel module sits on a top group/],
  ['strudel with a seq marker', (p) => { p.gruppen[2].seq = { schema: 2 }; }, /not several/],
  ['strudel marker with a field', (p) => { p.gruppen[2].strudel = { x: 1 }; }, /strudel\.x: unbekanntes Feld/],
  ['two strudel groups', (p) => { p.gruppen.push(gruppe('g5', 5, { strudel: {} })); }, /strudel is unique/],
  ['strudel group in a production project', (p) => {
    p.gruppen = [p.gruppen[2]]; p.spuren = [p.spuren[0]]; delete p.live; delete p.plaetze;
  }, /strudel: the strudel module exists only in the live container/],
  ['strudel group with an audio member', (p) => { p.spuren.push(spur('s9', 20, { ausgang: { art: 'gruppe', id: 'g3' } })); }, /holds strom tracks only/],
  ['strom track outside the strudel group', (p) => { p.spuren[0].ausgang = { art: 'gruppe', id: 'g1' }; }, /spuren\[0\]\.ausgang: a strom track sits inside/],
  ['strom track without a group', (p) => { delete p.spuren[0].ausgang; }, /spuren\[0\]\.ausgang/],
  ['strom 17', (p) => { p.spuren[0].strom = 17; }, /spuren\[0\]\.strom/],
  ['strom 0', (p) => { p.spuren[0].strom = 0; }, /spuren\[0\]\.strom/],
  ['strom track without strom', (p) => { delete p.spuren[0].strom; }, /spuren\[0\]\.strom: fehlt/],
  ['strom duplicate', (p) => { p.spuren.push(spur('s2', 2, { art: 'strom', strom: 3, ausgang: { art: 'gruppe', id: 'g3' } })); }, /spuren\[\d+\]\.strom: duplicate/],
  ['strom track with a clip', (p) => {
    p.spuren[0].clips = [{ id: 'c1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [] }];
  }, /spuren\[0\]\.clips: a strom track has no clips/],
  ['strom track with a quelle', (p) => { p.spuren[0].quelle = { art: 'strom', strom: 3 }; }, /spuren\[0\]\.quelle: unbekanntes Feld/],
  ['strom on an audio track', (p) => { p.spuren.push(spur('s2', 2, { strom: 4 })); }, /strom: unbekanntes Feld/],
  ['return strudel without a strudel group', (p) => {
    p.gruppen = p.gruppen.filter((g) => !g.strudel); p.spuren = p.spuren.filter((s) => s.art !== 'strom'); p.plaetze[2] = { typ: 'track' };
    p.returns = [ret('r1', 1, { strudel: { art: 'hall' }, gruppe: 'g1' })];
  }, /returns\[0\]\.strudel: only with a strudel group/],
  ['return strudel twice per art', (p) => {
    p.returns = [ret('r1', 1, { strudel: { art: 'hall' }, gruppe: 'g3' }), ret('r2', 2, { strudel: { art: 'hall' }, gruppe: 'g3' })];
  }, /returns\[1\]\.strudel: duplicate/],
  ['return strudel owned by another group', (p) => { p.returns = [ret('r1', 1, { strudel: { art: 'hall' }, gruppe: 'g1' })]; }, /owned by the strudel group/],
  ['return with strudel and loopdeck', (p) => { p.returns = [ret('r1', 1, { strudel: { art: 'hall' }, loopdeck: { platz: 1, art: 'hall' }, gruppe: 'g3' })]; }, /not both/],
  ['loop deck return owned by a foreign group', (p) => { p.returns = [ret('r1', 1, { loopdeck: { platz: 1, art: 'hall' }, gruppe: 'g1' })]; }, /owned by its loop deck/],
  ['generic return without an owner in a live project', (p) => { p.returns = [ret('r1', 1)]; }, /returns\[0\]\.gruppe: fehlt/],
  ['return owner unknown', (p) => { p.returns = [ret('r1', 1, { gruppe: 'g77' })]; }, /returns\[0\]\.gruppe: no top group/],
  ['return owner is a nested group', (p) => { p.gruppen.push(gruppe('g5', 5, { ausgang: { art: 'gruppe', id: 'g4' } })); p.returns = [ret('r1', 1, { gruppe: 'g5' })]; }, /returns\[0\]\.gruppe: no top group/],
  ['nine returns', (p) => { p.returns = Array.from({ length: 9 }, (_, i) => ret(`r${i + 1}`, i + 1, { gruppe: 'g1' })); }, /returns: höchstens 8/],
  ['seq.platz is a removed field', (p) => { p.gruppen[0].seq = { schema: 2, platz: 1 }; }, /seq\.platz/],
  ['loopdeck.ausgang_platz is a removed field', (p) => { p.gruppen[1].loopdeck.ausgang_platz = 3; }, /ausgang_platz: unbekanntes Feld/],
  ['modul.slot is a removed field', (p) => { p.gruppen[3].modul.slot = 'A'; }, /modul\.slot: unbekanntes Feld/],
  ['a production project with plaetze', (p) => {
    p.gruppen = []; p.spuren = []; delete p.live; p.plaetze = [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }];
  }, /plaetze: unknown field/],
  ['a live project without plaetze', (p) => { delete p.plaetze; }, /plaetze: fehlt/],
];
for (const [name, aendere, muster] of ABLEHNUNGEN) {
  test(`refused: ${name}`, () => {
    const p = gut(); aendere(p);
    const f = fehler(p);
    assert.ok(f !== null, 'expected a refusal');
    assert.match(f, muster);
  });
}

test('a strom track keeps the track strip fields: sends, inserts fields, filter, eq', () => {
  const p = gut();
  p.returns = [ret('r1', 1, { strudel: { art: 'hall' }, gruppe: 'g3' })];
  p.spuren[0].sends = [{ id: 'r1', db: -6 }]; p.spuren[0].filter = 0.25; p.spuren[0].eq = { tief: -3 };
  assert.equal(fehler(p), null);
});

test('a project without containers validates exactly as before', () => {
  const p = neuesProjekt('plain');
  p.spuren = [spur('s1', 1), spur('s2', 2, { art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } })];
  p.gruppen = [gruppe('g1', 1)]; p.spuren[0].ausgang = { art: 'gruppe', id: 'g1' };
  p.returns = [ret('r1', 1)]; p.spuren[1].sends = [{ id: 'r1', db: -3 }];
  const r = pruefeProjekt(kopie(p));
  assert.ok(r.projekt, JSON.stringify(r));
  const erwartet = kopie(p); erwartet.spuren.forEach((s) => { s.von = 'andreas'; }); erwartet.naechste_id = r.projekt.naechste_id;
  assert.deepEqual(kopie(r.projekt), kopie(erwartet));
  assert.equal(r.projekt.format, 'cypherdj-projekt/3');
});

test('helpers: platzVonGruppe, strudelGruppe, stromSpur, geparkteGruppen', () => {
  const p = gut();
  assert.equal(platzVonGruppe(p, 'g1'), 1); assert.equal(platzVonGruppe(p, 'g3'), 3); assert.equal(platzVonGruppe(p, 'g99'), null);
  assert.equal(strudelGruppe(p)?.id, 'g3');
  assert.equal(stromSpur(p, 3)?.id, 's1'); assert.equal(stromSpur(p, 4), null);
  assert.deepEqual(geparkteGruppen(p), []);
  p.plaetze[0] = { typ: 'track' };
  assert.equal(platzVonGruppe(p, 'g1'), null);
  assert.deepEqual(geparkteGruppen(p).map((g) => g.id), ['g1']);
  const plain = neuesProjekt('x'); plain.gruppen = [gruppe('g1', 1, { seq: { schema: 2 } })];
  assert.deepEqual(geparkteGruppen(plain), [], 'a production project parks nothing');
});

test('the playback view carries the place of a group as dj and the stream of a strom track', () => {
  const p = gut();
  const v = wiedergabeSicht(p);
  assert.equal(v.gruppen.find((g) => g.id === 'g3').dj, 3);
  assert.equal(v.spuren.find((s) => s.nr === 1).strom, 3);
  p.plaetze[0] = { typ: 'track' };
  assert.equal('dj' in wiedergabeSicht(p).gruppen.find((g) => g.id === 'g1'), false, 'parked: no dj');
});
