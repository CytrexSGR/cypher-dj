// Package 1.9 U7 T2 (spec E11, 4.4): rack_glied_setzen, rack_glied_entfernen, rack_kette, the conversion by spur_aendern, and the pinned refusals
// of the single-device commands on a rack track.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus, vergleiche, BefehlFehler } from '../project/commands.ts';
import { pruefeProjekt, wiedergabeSicht } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { specProjekt } from './support/project.mjs';

const zwei = () => { const p = specProjekt(); p.format = 'cypherdj-projekt/2'; p.gruppen = []; p.master = { fader_db: 0 }; return p; };
const kit = (name) => ({ art: 'intern', name: 'kit', kit: name });
const rb = (parameter = {}) => ({ art: 'intern', name: 'rb338', parameter });
const spurMit = (i, geraet) => ({ id: `r${i}`, nr: i, name: `Rack ${i}`, farbe: '#3b8de0', art: 'instrument', ...(geraet ? { geraet } : {}),
  fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
const zweiKit = () => ({ art: 'rack', glieder: [{ id: 'g1', geraet: kit('kit_rack'), ton: [0, 59] }, { id: 'g2', geraet: kit('kit_zwei'), ton: [60, 127] }], kette: 0 });
const mitSpur = (geraet) => { const p = zwei(); p.spuren = [spurMit(1, geraet)]; return p; };
const lehntAb = (fn, grund) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const aendere = (p, b) => fuehreListeAus(p, [b]);
const json = (x) => JSON.stringify(x);

// positive case plus undo restoring the project bit-equal
function mitUndo(p, befehl) {
  const vorher = json(p);
  const e = aendere(p, befehl);
  assert.ok('projekt' in pruefeProjekt(JSON.parse(json(e.projekt))), 'valid project after the command');
  assert.equal(json(wende(e.projekt, e.zurueck)), vorher, 'undo restores the project bit-equal');
  assert.equal(json(wende(p, e.vor)), json(e.projekt), 'redo reproduces');
  assert.equal(vorher, json(p), 'the input project is not touched');
  return e;
}

test('T2 rack_glied_setzen: add takes the lowest free id, replace keeps the position, both undoable; refusals', () => {
  const p = mitSpur(zweiKit());
  const add = mitUndo(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: rb(), ton: [0, 127], gain_db: -3 } });
  assert.deepEqual(add.projekt.spuren[0].geraet.glieder.map((m) => m.id), ['g1', 'g2', 'g3']);
  assert.equal(add.projekt.spuren[0].geraet.glieder[2].gain_db, -3);
  // a freed id is reused: remove g1, add again -> g1 comes back at the end
  const ohne1 = aendere(p, { befehl: 'rack_glied_entfernen', spur_id: 'r1', glied_id: 'g1' }).projekt;
  const wieder = aendere(ohne1, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: kit('kit_impuls') } }).projekt;
  assert.deepEqual(wieder.spuren[0].geraet.glieder.map((m) => m.id), ['g2', 'g1']);
  // replace g2
  const rep = mitUndo(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { id: 'g2', geraet: rb({ cutoff: 0.3 }), ton: [60, 127] } });
  assert.deepEqual(rep.projekt.spuren[0].geraet.glieder.map((m) => m.id), ['g1', 'g2']);
  assert.equal(rep.projekt.spuren[0].geraet.glieder[1].geraet.name, 'rb338');
  // refusals
  const voll = aendere(aendere(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: kit('kit_rack') } }).projekt,
    { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: kit('kit_rack') } }).projekt;
  lehntAb(() => aendere(voll, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: kit('kit_rack') } }), 'rack_voll_glieder');
  lehntAb(() => aendere(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { id: 'g4', geraet: kit('kit_rack') } }), 'glied_unbekannt');
  lehntAb(() => aendere(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: { art: 'rack', glieder: [], kette: 0 } } }), 'argument_ungueltig');
  lehntAb(() => aendere(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: kit('kit_rack'), ton: [60, 59] } }), 'projekt_ungueltig');
  lehntAb(() => aendere(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: kit('kit_rack'), foo: 1 } }), 'argument_unbekannt');
  lehntAb(() => aendere(p, { befehl: 'rack_glied_setzen', spur_id: 'r1' }), 'argument_ungueltig');
  lehntAb(() => aendere(p, { befehl: 'rack_glied_setzen', spur_id: 'r9', glied: { geraet: kit('kit_rack') } }), 'spur_unbekannt');
});

test('T2 rack_glied_entfernen: removes one member, undoable; the last one and an unknown id are refused', () => {
  const p = mitSpur(zweiKit());
  const e = mitUndo(p, { befehl: 'rack_glied_entfernen', spur_id: 'r1', glied_id: 'g1' });
  assert.deepEqual(e.projekt.spuren[0].geraet.glieder.map((m) => m.id), ['g2']);
  lehntAb(() => aendere(e.projekt, { befehl: 'rack_glied_entfernen', spur_id: 'r1', glied_id: 'g2' }), 'rack_letztes_glied');
  lehntAb(() => aendere(p, { befehl: 'rack_glied_entfernen', spur_id: 'r1', glied_id: 'g3' }), 'glied_unbekannt');
  lehntAb(() => aendere(p, { befehl: 'rack_glied_entfernen', spur_id: 'r1', glied_id: 5 }), 'argument_ungueltig');
});

test('T2 rack_kette: integer 0..127, undoable; refusals', () => {
  const p = mitSpur(zweiKit());
  const e = mitUndo(p, { befehl: 'rack_kette', spur_id: 'r1', kette: 100 });
  assert.equal(e.projekt.spuren[0].geraet.kette, 100);
  assert.equal(aendere(p, { befehl: 'rack_kette', spur_id: 'r1', kette: 127 }).projekt.spuren[0].geraet.kette, 127);
  for (const k of [-1, 128, 1.5, '3', null, NaN]) lehntAb(() => aendere(p, { befehl: 'rack_kette', spur_id: 'r1', kette: k }), 'argument_ungueltig');
  lehntAb(() => aendere(p, { befehl: 'rack_kette', spur_id: 'r1', kette: 3, x: 1 }), 'argument_unbekannt');
});

test('T2 the three commands on a non-rack track are keine_rackspur', () => {
  const p = mitSpur(rb());
  lehntAb(() => aendere(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: kit('kit_rack') } }), 'keine_rackspur');
  lehntAb(() => aendere(p, { befehl: 'rack_glied_entfernen', spur_id: 'r1', glied_id: 'g1' }), 'keine_rackspur');
  lehntAb(() => aendere(p, { befehl: 'rack_kette', spur_id: 'r1', kette: 1 }), 'keine_rackspur');
  const audio = zwei(); // an audio track is no rack track either
  lehntAb(() => aendere(audio, { befehl: 'rack_kette', spur_id: audio.spuren.find((s) => s.art === 'audio').id, kette: 1 }), 'keine_rackspur');
});

test('T2 conversion: RB-338 track to rack by {art: rack} alone, explicit members, and back (undo bit-equal, slots freed)', () => {
  const p = mitSpur(rb({ cutoff: 0.4 }));
  const e = mitUndo(p, { befehl: 'spur_aendern', spur_id: 'r1', geraet: { art: 'rack' } });
  assert.deepEqual(e.projekt.spuren[0].geraet, { art: 'rack', glieder: [{ id: 'g1', geraet: rb({ cutoff: 0.4 }) }], kette: 0 });
  assert.equal(e.betrifft_wiedergabe, true);
  // explicit members
  const e2 = mitUndo(p, { befehl: 'spur_aendern', spur_id: 'r1', geraet: zweiKit() });
  assert.deepEqual(e2.projekt.spuren[0].geraet, zweiKit());
  // back to a plain device: the members are gone, undo restores the rack
  const rack = e2.projekt;
  const zurueck = mitUndo(rack, { befehl: 'spur_aendern', spur_id: 'r1', geraet: { art: 'intern', name: 'rb338', parameter: {} } });
  assert.deepEqual(zurueck.projekt.spuren[0].geraet, { art: 'intern', name: 'rb338', parameter: {} });
  assert.equal(zurueck.betrifft_wiedergabe, true);
  // frees the member count: eight single-member racks are the limit, a plain device in place of one makes room
  // Surge track to rack (T4): the Surge becomes member g1 and keeps its slot; the full case is in project_rack_host.test.mjs
  const surge = mitSpur({ art: 'wirt', name: 'surge', slot: 1 }); surge.spuren[0].freeze = null;
  assert.equal(aendere(surge, { befehl: 'spur_aendern', spur_id: 'r1', geraet: { art: 'rack' } }).projekt.spuren[0].geraet.glieder[0].geraet.slot, 1);
  // a track without a device has nothing to become g1
  lehntAb(() => aendere(mitSpur(undefined), { befehl: 'spur_aendern', spur_id: 'r1', geraet: { art: 'rack' } }), 'argument_ungueltig');
  // a rack track given {art: rack} alone keeps its members and its chain value
  const r = aendere(aendere(rack, { befehl: 'rack_kette', spur_id: 'r1', kette: 9 }).projekt, { befehl: 'spur_aendern', spur_id: 'r1', geraet: { art: 'rack' } });
  assert.deepEqual(r.projekt.spuren[0].geraet, { ...zweiKit(), kette: 9 });
  // conversion of a track that has geraet.* lanes is refused with the stated reason (the lane belongs to the single device)
  const mitLane = aendere(p, { befehl: 'auto_neu', spur_id: 'r1', ziel: 'geraet.cutoff' }).projekt;
  lehntAb(() => aendere(mitLane, { befehl: 'spur_aendern', spur_id: 'r1', geraet: { art: 'rack' } }), 'geraet_lanes');
});

test('T2 vergleiche: the three commands and the conversion are playback swaps (E11); a freeze goes with the device change', () => {
  const p = mitSpur(zweiKit());
  for (const b of [{ befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: rb() } },
    { befehl: 'rack_glied_entfernen', spur_id: 'r1', glied_id: 'g2' }, { befehl: 'rack_kette', spur_id: 'r1', kette: 64 }]) {
    const e = aendere(p, b);
    assert.equal(e.betrifft_wiedergabe, true, b.befehl);
    assert.equal(vergleiche(p, e.projekt).betrifft_wiedergabe, true, b.befehl);
    assert.notDeepEqual(wiedergabeSicht(e.projekt), wiedergabeSicht(p), b.befehl);
  }
  // a Surge track with a freeze that becomes a rack loses the freeze (the track's own device change rule)
  const f = mitSpur({ art: 'wirt', name: 'surge', slot: 1 }); f.spuren[0].freeze = null;
  const e = aendere(f, { befehl: 'spur_aendern', spur_id: 'r1', geraet: zweiKit() });
  assert.equal('freeze' in e.projekt.spuren[0], false);
});

test('T2 reason codes have texts and codes: keine_rackspur 409, glied_unbekannt 404', () => {
  for (const g of ['keine_rackspur', 'rack_voll_glieder', 'glied_unbekannt', 'rack_letztes_glied']) assert.ok(GRUND_TEXT[g], `${g} has a server text`);
  assert.equal(grundCode('glied_unbekannt'), 404);
  assert.equal(grundCode('keine_rackspur'), 409);
});

test('T2 pinned refusals on a rack track (Review Focus 3)', () => {
  const p = mitSpur(zweiKit());
  lehntAb(() => aendere(p, { befehl: 'geraet_richtung', spur_id: 'r1', wort: 'dunkler' }), 'richtung_unbekannt');
  lehntAb(() => aendere(p, { befehl: 'preset_anwenden', spur_id: 'r1', preset: 'werk:rb338/dark-dub' }), 'argument_ungueltig');
  lehntAb(() => aendere(p, { befehl: 'auto_neu', spur_id: 'r1', ziel: 'geraet.cutoff' }), 'ziel_unbekannt');
});

test('T2 review fix: rack_glied_setzen carries ctx, so kitDa and graphArt refuse like spur_neu', () => {
  const p = mitSpur(zweiKit());
  const kitDa = (n) => n !== 'nope';
  const graphArt = (n) => ({ 'juno-pad': 'instrument', 'fx-bandecho': 'effekt' })[n] ?? null;
  const setze = (geraet, ctx) => fuehreListeAus(p, [{ befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet } }], ctx);
  lehntAb(() => setze(kit('nope'), { kitDa }), 'kit_unbekannt');
  lehntAb(() => setze({ art: 'intern', name: 'bk', graph: 'nix', parameter: {} }, { graphArt }), 'argument_ungueltig');
  lehntAb(() => setze({ art: 'intern', name: 'bk', graph: 'fx-bandecho', parameter: {} }, { graphArt }), 'argument_ungueltig');
  assert.ok(setze(kit('kit_rack'), { kitDa }).projekt, 'a known kit passes');
  assert.ok(setze(kit('nope')).projekt, 'no lookup injected: the name rule only');
});

// --- 1.9 U8 T8 (review focus 5): the macro table stays valid when members go, are replaced or the rack is converted away -------------------
const zielG = (glied, param, von, bis) => ({ glied, param, von, bis });
const rackSetzen = (ziele) => ({ befehl: 'rack_setzen', strang_id: 'r1', makros: [{ ziel: ziele.slice(0, 3) }, { ziel: ziele.slice(3) }] });
// track r1: g1 rb, g2 rb, g3 kit; a table over them, set by the command itself (so the model checked it)
const mitTabelle = (ziele, mitKette = false) => {
  const roh = mitSpur({ art: 'rack', glieder: [{ id: 'g1', geraet: rb() }, { id: 'g2', geraet: rb() }, { id: 'g3', geraet: kit('kit_rack') }], kette: 0 });
  const vor = mitKette ? [{ befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'komp' }] : [];
  return fuehreListeAus(roh, [...vor, rackSetzen(ziele)]).projekt;
};
const alleZiele = (p) => p.spuren[0].rack?.makros.flatMap((m) => m.ziel);

test('T8 removing a mapped member removes its targets, keeps the others; undo restores bit-equal', () => {
  const p = mitTabelle([zielG('g1', 'cutoff', 0, 1), zielG('g2', 'cutoff', 0.2, 0.8), zielG('g2', 'gain_db', -12, 0), zielG('g3', 'gain_db', -60, 6)]);
  const e = mitUndo(p, { befehl: 'rack_glied_entfernen', spur_id: 'r1', glied_id: 'g2' });
  assert.deepEqual(alleZiele(e.projekt), [zielG('g1', 'cutoff', 0, 1), zielG('g3', 'gain_db', -60, 6)]);
  assert.equal(e.projekt.spuren[0].rack.makros.length, 4, 'the table keeps its four macros');
  // a member without targets: nothing changes in the table
  const q = mitUndo(p, { befehl: 'rack_glied_entfernen', spur_id: 'r1', glied_id: 'g3' });
  assert.equal(alleZiele(q.projekt).length, 3);
  // the last mapped member: the whole rack field goes (a strand rack without targets is invalid)
  const nur = mitTabelle([zielG('g2', 'cutoff', 0, 1)]);
  const w = mitUndo(nur, { befehl: 'rack_glied_entfernen', spur_id: 'r1', glied_id: 'g2' });
  assert.equal(w.projekt.spuren[0].rack, undefined);
});

test('T8 replacing an RB-338 member by a kit drops its cutoff target and keeps the gain_db target; the same device keeps all', () => {
  const p = mitTabelle([zielG('g1', 'cutoff', 0, 1), zielG('g1', 'gain_db', -6, 0), zielG('g2', 'resonanz', 0, 1)]);
  const e = mitUndo(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { id: 'g1', geraet: kit('kit_zwei') } });
  assert.deepEqual(alleZiele(e.projekt), [zielG('g1', 'gain_db', -6, 0), zielG('g2', 'resonanz', 0, 1)]);
  const gleich = mitUndo(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { id: 'g1', geraet: rb({ cutoff: 0.4 }) } });
  assert.equal(alleZiele(gleich.projekt).length, 3, 'an RB-338 replaced by an RB-338 keeps its targets');
  // replaced by a Surge member: it takes no macro target at all, the gain_db target goes too
  const s = mitUndo(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { id: 'g1', geraet: { art: 'wirt' } } });
  assert.deepEqual(alleZiele(s.projekt), [zielG('g2', 'resonanz', 0, 1)]);
  // adding a member never drops anything
  assert.equal(alleZiele(mitUndo(p, { befehl: 'rack_glied_setzen', spur_id: 'r1', glied: { geraet: kit('kit_zwei') } }).projekt).length, 3);
});

test('T8 converting the track to a plain device removes the member targets, keeps insert targets; only member targets: rack goes', () => {
  const p = mitTabelle([zielG('g1', 'cutoff', 0, 1), zielG('g3', 'gain_db', -6, 0)], true);
  const iid = p.spuren[0].inserts[0].id;
  const gemischt = fuehreListeAus(p, [{ befehl: 'rack_setzen', strang_id: 'r1', makros: [{ ziel: [{ insert: iid, param: 'schwelle', von: -60, bis: 0 }, zielG('g1', 'cutoff', 0, 1)] },
    { ziel: [zielG('g3', 'gain_db', -6, 0)] }] }]).projekt;
  const e = mitUndo(gemischt, { befehl: 'spur_aendern', spur_id: 'r1', geraet: rb() });
  assert.equal(e.projekt.spuren[0].geraet.art, 'intern');
  assert.deepEqual(alleZiele(e.projekt), [{ insert: iid, param: 'schwelle', von: -60, bis: 0 }], 'the insert target stays');
  const nur = mitTabelle([zielG('g1', 'cutoff', 0, 1), zielG('g3', 'gain_db', -6, 0)]);
  const f = mitUndo(nur, { befehl: 'spur_aendern', spur_id: 'r1', geraet: rb() });
  assert.equal(f.projekt.spuren[0].rack, undefined, 'only member targets: the rack field is deleted');
  // a rack reshaped to fewer members through spur_aendern keeps what still fits
  const klein = mitUndo(nur, { befehl: 'spur_aendern', spur_id: 'r1', geraet: { art: 'rack', glieder: [{ id: 'g1', geraet: rb() }], kette: 0 } });
  assert.deepEqual(alleZiele(klein.projekt), [zielG('g1', 'cutoff', 0, 1)]);
});
