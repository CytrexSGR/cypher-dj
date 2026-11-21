// Loop deck M2: the command family, the module conversion (M5) and the filter in the mixer paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { neuesProjekt, pruefeProjekt, loopDeckGruppe, loopDeckSpuren } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { baueModul, modulAmPlatz } from '../project/live.ts';
import { alleSpurRegler, reglerZuBefehl } from '../areas/proj/mapping.ts';
import { tmpOrdner } from './support/project.mjs';

const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }]; return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const fehler = (p, ...b) => { try { fuehreListeAus(p, b); } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e; } return assert.fail(`${b.map((x) => x.befehl)} was not refused`); };
const kopie = (x) => JSON.parse(JSON.stringify(x));
const valide = (p) => { const u = pruefeProjekt(kopie(p)); assert.ok('projekt' in u, JSON.stringify(u)); };
const SHA = 'a'.repeat(64);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });
const A = { quelle: 'andreas', label: 'Test' };
// every command forward and back through the history (one undo step each)
function mitUndo(t, p, ...befehle) {
  const dir = tmpOrdner(t);
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { jetzt: () => 0, zeitgeber: false });
  const r = aendere(v, p, befehle, A);
  valide(r.projekt);
  const u = rueckgaengig(v, r.projekt, { quelle: 'andreas' });
  const ohne = (x) => JSON.stringify({ ...x, rev: 0, wiedergabe_rev: 0, naechste_id: undefined });
  assert.equal(ohne(u.projekt), ohne(p), `undo of ${befehle.map((b) => b.befehl)} restores the project`);
  return { v, vorher: p, nachher: r.projekt };
}
const mitDeck = (platz = 1) => lauf(live(), { befehl: 'loopdeck_neu', platz });

test('loopdeck_neu: group LOOP n, 4 audio tracks Ln.1..4 with 8 empty cells, default grid takt; one undo step', (t) => {
  const { nachher: p } = mitUndo(t, live(), { befehl: 'loopdeck_neu', platz: 2 });
  const g = loopDeckGruppe(p, 2);
  assert.deepEqual([g.name, g.loopdeck, g.ausgang], ['LOOP 2', { platz: 2, raster: 'takt' }, undefined]);
  const spuren = loopDeckSpuren(p, g);
  assert.deepEqual(spuren.map((s) => [s.name, s.art]), [1, 2, 3, 4].map((i) => [`L2.${i}`, 'audio']));
  assert.ok(spuren.every((s) => s.zellen.length === 8 && s.zellen.every((z) => z === null)));
  assert.equal(lauf(live(), { befehl: 'loopdeck_neu', platz: 1, raster: '1/2' }).gruppen[0].loopdeck.raster, '1/2');
});

test('loopdeck_neu twice on one place is refused platz_belegt; the other place and bad arguments', () => {
  const p = mitDeck(1);
  assert.equal(fehler(p, { befehl: 'loopdeck_neu', platz: 1 }).grund, 'platz_belegt');
  valide(lauf(p, { befehl: 'loopdeck_neu', platz: 2 }));
  assert.equal(fehler(live(), { befehl: 'loopdeck_neu', platz: 3 }).grund, 'argument_ungueltig');
  assert.equal(fehler(live(), { befehl: 'loopdeck_neu', platz: 1, raster: 'x' }).grund, 'argument_ungueltig');
  assert.equal(fehler(neuesProjekt('n'), { befehl: 'loopdeck_neu', platz: 1 }).grund, 'kein_liveprojekt');
});

const herkunft = () => ({ quelle_sha256: 'c'.repeat(64), titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 0, laenge_beats: 16, bpm: 120,
  datum: '2026-11-12' });
const LOOP = { sha256: 'e'.repeat(64), pfad: 'audio/e.wav', beats: 16, frames: 16 * 24000 };

test('loopdeck_neu next to a module leaves the module alone (no conversion into a cell) and takes the first free place; one undo restores the deck away', (t) => {
  const mit = baueModul(live(), 'C', LOOP, { drums: { sha256: 'd'.repeat(64), pfad: 'audio/d.wav' } }, herkunft());   // the module sits in place 3
  assert.ok(modulAmPlatz(mit, 'C'));
  const { nachher: p } = mitUndo(t, mit, { befehl: 'loopdeck_neu', platz: 2 });
  assert.equal(modulAmPlatz(p, 'C'), modulAmPlatz(mit, 'C'), 'the module stays in place 3');
  assert.equal(p.gruppen.filter((g) => g.modul).length, 1);
  assert.deepEqual(p.plaetze.map((x) => x.typ), ['leer', 'leer', 'stems', 'loops'], 'the deck took place 4, the first free one after 3');
  assert.equal(p.plaetze[3].gruppe, loopDeckGruppe(p, 2).id);
  const spuren = loopDeckSpuren(p, loopDeckGruppe(p, 2));
  assert.equal(spuren.length, 4);
  assert.ok(spuren.every((x) => x.zellen.every((z) => z === null)), 'all cells empty');
});

test('loopdeck_neu scans the places 3, 4, 1, 2 for a free one; with none free the deck is created parked and nothing is displaced', () => {
  let p = live();
  p = lauf(p, { befehl: 'loopdeck_neu', platz: 1 });
  assert.deepEqual(p.plaetze.map((x) => x.typ), ['leer', 'leer', 'loops', 'leer']);
  p = lauf(p, { befehl: 'loopdeck_neu', platz: 2 });
  assert.deepEqual(p.plaetze.map((x) => x.typ), ['leer', 'leer', 'loops', 'loops']);
  let voll = baueModul(live(), 'C', LOOP, {}, herkunft());
  voll = lauf(voll, { befehl: 'seq_anlegen', platz: 1 }, { befehl: 'platz_setzen', platz: 2, typ: 'strudel' }, { befehl: 'seq_anlegen', platz: 4 });
  assert.deepEqual(voll.plaetze.map((x) => x.typ), ['seq', 'strudel', 'stems', 'seq']);
  const q = lauf(voll, { befehl: 'loopdeck_neu', platz: 1 });
  assert.deepEqual(q.plaetze, voll.plaetze, 'no place changed');
  assert.ok(loopDeckGruppe(q, 1), 'the deck exists, parked');
});

test('a loop deck cell is written and read back on a deck that sits in a place; the deck is one undo step', (t) => {
  const { nachher: p } = mitUndo(t, mitDeck(1), { befehl: 'zelle_setzen', spur_id: loopDeckSpuren(mitDeck(1), loopDeckGruppe(mitDeck(1), 1))[0].id, index: 1, zelle: Z() });
  const z = loopDeckSpuren(p, loopDeckGruppe(p, 1))[0].zellen[0];
  assert.deepEqual([z.name, z.art, z.sha256, z.beats], ['Loop', 'loop', SHA, 4]);
});

test('a loop deck track takes no take lanes; a cell name of spaces only is refused', () => {
  const p = mitDeck(1);
  const [a] = loopDeckSpuren(p, p.gruppen[0]);
  assert.equal(fehler(p, { befehl: 'take_neu', spur_id: a.id }).grund, 'argument_ungueltig');
  const e = fehler(p, { befehl: 'zelle_setzen', spur_id: a.id, index: 1, zelle: Z({ name: '   ' }) });
  assert.match(String(e.detail ?? e.message), /spaces only/);
});

test('loopdeck_aendern sets the grid and loopdeck_leeren empties all cells; both forward and undo', (t) => {
  let p = mitDeck(1);
  const [a, b] = loopDeckSpuren(p, p.gruppen[0]);
  p = lauf(p, { befehl: 'zelle_setzen', spur_id: a.id, index: 1, zelle: Z() }, { befehl: 'zelle_setzen', spur_id: b.id, index: 8, zelle: Z() });
  assert.equal(mitUndo(t, p, { befehl: 'loopdeck_aendern', gruppe_id: p.gruppen[0].id, raster: '4takte' }).nachher.gruppen[0].loopdeck.raster, '4takte');
  const leer = mitUndo(t, p, { befehl: 'loopdeck_leeren', gruppe_id: p.gruppen[0].id }).nachher;
  assert.ok(loopDeckSpuren(leer, leer.gruppen[0]).every((s) => s.zellen.every((z) => z === null)));
  assert.equal(fehler(p, { befehl: 'loopdeck_aendern', gruppe_id: p.gruppen[0].id, raster: 'nope' }).grund, 'argument_ungueltig');
  const ohne = lauf(live(), { befehl: 'gruppenspur_neu', name: 'G' });
  assert.equal(fehler(ohne, { befehl: 'loopdeck_leeren', gruppe_id: ohne.gruppen[0].id }).grund, 'kein_loopdeck');
});

test('zelle_setzen writes with a new id, replaces, clears with null; zelle_aendern is partial and refused on an empty cell', (t) => {
  const p0 = mitDeck(1);
  const s = p0.spuren[0].id;
  const { nachher: p } = mitUndo(t, p0, { befehl: 'zelle_setzen', spur_id: s, index: 3, zelle: Z() });
  assert.equal(p.spuren[0].zellen[2].id, 'z1');
  const p2 = lauf(p, { befehl: 'zelle_setzen', spur_id: s, index: 3, zelle: Z({ name: 'Other' }) });
  assert.deepEqual([p2.spuren[0].zellen[2].id, p2.spuren[0].zellen[2].name], ['z2', 'Other']);
  assert.equal(mitUndo(t, p2, { befehl: 'zelle_setzen', spur_id: s, index: 3, zelle: null }).nachher.spuren[0].zellen[2], null);
  const a = mitUndo(t, p, { befehl: 'zelle_aendern', spur_id: s, index: 3, name: 'New', gain_db: -6, farbe: 9, beats: 8, art: 'einmal' }).nachher.spuren[0].zellen[2];
  assert.deepEqual([a.id, a.name, a.gain_db, a.farbe, a.beats, a.art, a.sha256], ['z1', 'New', -6, 9, 8, 'einmal', SHA]);
  assert.equal(fehler(p, { befehl: 'zelle_aendern', spur_id: s, index: 4, name: 'x' }).grund, 'zelle_leer');
  assert.equal(fehler(p, { befehl: 'zelle_aendern', spur_id: s, index: 3 }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'zelle_setzen', spur_id: s, index: 9, zelle: Z() }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'zelle_setzen', spur_id: s, index: 1, zelle: Z({ extra: 1 }) }).grund, 'argument_unbekannt');
  assert.equal(fehler(p, { befehl: 'zelle_setzen', spur_id: s, index: 1, zelle: Z({ beats: undefined }) }).grund, 'projekt_ungueltig');
  const ohne = lauf(live(), { befehl: 'spur_neu', art: 'audio' });
  assert.equal(fehler(ohne, { befehl: 'zelle_setzen', spur_id: ohne.spuren[0].id, index: 1, zelle: Z() }).grund, 'kein_loopdeck');
});

test('zelle_bewegen: move, swap when filled, across the two decks, ids kept; empty source refused', (t) => {
  let p = lauf(mitDeck(1), { befehl: 'loopdeck_neu', platz: 2 });
  const [a] = loopDeckSpuren(p, loopDeckGruppe(p, 1)), [b] = loopDeckSpuren(p, loopDeckGruppe(p, 2));
  p = lauf(p, { befehl: 'zelle_setzen', spur_id: a.id, index: 1, zelle: Z({ name: 'One' }) }, { befehl: 'zelle_setzen', spur_id: b.id, index: 5, zelle: Z({ name: 'Two' }) });
  const zelle = (q, id, i) => q.spuren.find((s) => s.id === id).zellen[i - 1];
  const m = mitUndo(t, p, { befehl: 'zelle_bewegen', von: { spur_id: a.id, index: 1 }, nach: { spur_id: a.id, index: 2 } }).nachher;
  assert.deepEqual([zelle(m, a.id, 1), zelle(m, a.id, 2).id], [null, 'z1']);
  const w = mitUndo(t, p, { befehl: 'zelle_bewegen', von: { spur_id: a.id, index: 1 }, nach: { spur_id: b.id, index: 5 } }).nachher;
  assert.deepEqual([zelle(w, a.id, 1).id, zelle(w, a.id, 1).name, zelle(w, b.id, 5).id, zelle(w, b.id, 5).name], ['z2', 'Two', 'z1', 'One']);
  assert.equal(fehler(p, { befehl: 'zelle_bewegen', von: { spur_id: a.id, index: 2 }, nach: { spur_id: a.id, index: 3 } }).grund, 'zelle_leer');
  assert.equal(fehler(p, { befehl: 'zelle_bewegen', von: { spur_id: a.id }, nach: { spur_id: a.id, index: 3 } }).grund, 'argument_ungueltig');
});

test('spur_aendern filter: ok on a deck track refused on another track; two changes coalesce into one undo step', (t) => {
  let p = lauf(mitDeck(1), { befehl: 'spur_neu', art: 'audio', name: 'Plain' });
  const deckSpur = p.spuren[0].id, plain = p.spuren[4].id;
  assert.equal(lauf(p, { befehl: 'spur_aendern', spur_id: deckSpur, filter: 0.5 }).spuren[0].filter, 0.5);
  assert.equal(fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: deckSpur, filter: 0.5 }]).betrifft_wiedergabe, false, 'the filter is a control row, not playback');
  assert.equal(fehler(p, { befehl: 'spur_aendern', spur_id: plain, filter: 0.5 }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'spur_aendern', spur_id: deckSpur, filter: 1.5 }).grund, 'argument_ungueltig');
  const r = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: deckSpur, filter: -0.25 }]);
  assert.deepEqual(r.regler_aenderungen.filter((x) => /filter/.test(x.pfad)), [{ pfad: 'spur/1/filter', wert: -0.25 }]);
  const dir = tmpOrdner(t), uhr = { t: 0 };
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const f = (q, w) => aendere(v, q, [{ befehl: 'spur_aendern', spur_id: deckSpur, filter: w }], A).projekt;
  let q = f(p, 0.2); uhr.t += 300; q = f(q, 0.7);
  assert.equal(q.spuren[0].filter, 0.7);
  const u = rueckgaengig(v, q, { quelle: 'andreas' });
  assert.equal(u.projekt.spuren[0].filter, 0, 'one undo step takes both drags back');
});

test('abbildung maps filter to spur/<nr>/filter, both ways', () => {
  let p = mitDeck(1);
  p = lauf(p, { befehl: 'spur_aendern', spur_id: p.spuren[1].id, filter: 0.4 });
  const regler = alleSpurRegler(p);
  assert.equal(regler.filter((x) => /\/filter$/.test(x.pfad)).length, 32);
  assert.deepEqual(regler.find((x) => x.pfad === 'spur/2/filter'), { pfad: 'spur/2/filter', wert: 0.4 });
  assert.equal(regler.find((x) => x.pfad === 'spur/3/filter').wert, 0);
  const r = reglerZuBefehl(p, 'spur/3/filter', -0.6);
  assert.deepEqual(r.befehl, { befehl: 'spur_aendern', spur_id: p.spuren[2].id, filter: -0.6 });
  assert.equal(reglerZuBefehl(p, 'spur/3/filter', 0), null, 'already there');
  assert.equal(reglerZuBefehl(p, 'spur/2/filter', 5).befehl.filter, 1, 'clamped');
  const plain = lauf(p, { befehl: 'spur_neu', art: 'audio' });
  assert.equal(reglerZuBefehl(plain, 'spur/5/filter', 0.5), null, 'a track outside a deck has no filter');
});
