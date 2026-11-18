// SEQ scenes, task 1: the project field `szenen` and the commands szene_speichern, szene_loeschen and szene_anwenden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeFehler, pruefeProjekt } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { szeneAusMutes } from '../project/commands_szenen.ts';
import { wende } from '../project/patch.ts';
import { kopie } from './support/project.mjs';

const live = () => { const p = neuesProjekt('x'); p.live = true; return p; };
const lauf = (p, ...b) => fuehreListeAus(kopie(p), b).projekt;
const ergebnis = (p, ...b) => fuehreListeAus(kopie(p), b);
const grund = (p, b) => { try { fuehreListeAus(kopie(p), [b]); return null; } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e.grund; } };
const bk = () => ({ art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} });
const folge = (p, name, platz = 1, extra = {}) => lauf(p, { befehl: 'seq_folge_neu', gruppe_id: p.gruppen.find((g) => g.seq?.platz === platz).id, name, geraet: bk(), ...extra });
const mute = (p, name) => p.spuren.find((s) => s.name === name).mute;
const id = (p, name) => p.spuren.find((s) => s.name === name).id;

// two decks: A, B on place 1; C on place 2; all unmuted unless said otherwise
function deck() {
  let p = lauf(live(), { befehl: 'seq_anlegen', platz: 1 }, { befehl: 'seq_anlegen', platz: 2 });
  p = folge(p, 'A', 1); p = folge(p, 'B', 1); p = folge(p, 'C', 2, { stumm: true });
  return p;
}
const stumm = (p, name, an) => lauf(p, { befehl: 'spur_aendern', spur_id: id(p, name), mute: an });

test('szene_speichern stores the picture; one history entry; undo restores the absent field', () => {
  const p = deck();
  const bild = { an: [id(p, 'A'), id(p, 'B')], aus: [id(p, 'C')] };
  const r = ergebnis(p, { befehl: 'szene_speichern', slot: 2, ...bild });
  assert.deepEqual(r.projekt.szenen[2], bild);
  assert.equal(r.projekt.szenen.length, 8);
  assert.equal(r.projekt.szenen.filter((x) => x === null).length, 7);
  assert.equal(pruefeFehler(r.projekt), null);
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.regler_aenderungen, []);
  assert.ok(r.vor.length > 0);
  const zurueck = wende(r.projekt, r.zurueck);
  assert.equal(zurueck.szenen, undefined);
  assert.deepEqual(szeneAusMutes(p), bild);
});

test('szene_speichern rejects bad input', () => {
  const p = deck();
  const a = id(p, 'A'), b = id(p, 'B');
  for (const arg of [
    { slot: 8, an: [a], aus: [] }, { slot: -1, an: [a], aus: [] }, { slot: 1.5, an: [a], aus: [] }, { slot: '1', an: [a], aus: [] },
    { slot: 0, an: ['nope'], aus: [] }, { slot: 0, an: [a], aus: [a] }, { slot: 0, an: [a, a], aus: [] }, { slot: 0, an: [a], aus: 'x' },
    { slot: 0, an: [a] }, { slot: 0, an: [7], aus: [b] },
  ]) assert.equal(grund(p, { befehl: 'szene_speichern', ...arg }), 'argument_ungueltig', JSON.stringify(arg));
  const frei = lauf(p, { befehl: 'spur_neu', art: 'audio', name: 'Plain' });
  assert.equal(grund(frei, { befehl: 'szene_speichern', slot: 0, an: [id(frei, 'Plain')], aus: [] }), 'argument_ungueltig', 'a non-SEQ track is no pattern');
  assert.equal(grund(p, { befehl: 'szene_speichern', slot: 0, an: [a], aus: [], extra: 1 }), 'argument_unbekannt');
});

test('szene_anwenden is one undo step', () => {
  let p = deck();
  p = lauf(p, { befehl: 'szene_speichern', slot: 0, an: [id(p, 'A'), id(p, 'C')], aus: [id(p, 'B')] });
  p = stumm(p, 'A', true);
  p = stumm(p, 'B', false);
  assert.deepEqual([mute(p, 'A'), mute(p, 'B'), mute(p, 'C')], [true, false, true]);
  const r = ergebnis(p, { befehl: 'szene_anwenden', slot: 0 });
  assert.deepEqual([mute(r.projekt, 'A'), mute(r.projekt, 'B'), mute(r.projekt, 'C')], [false, true, false]);
  assert.ok(r.vor.length > 0, 'one entry carries all three changes');
  const undo = wende(r.projekt, r.zurueck);
  assert.deepEqual([mute(undo, 'A'), mute(undo, 'B'), mute(undo, 'C')], [true, false, true]);
});

test('szene_anwenden skips deleted patterns', () => {
  let p = deck();
  p = lauf(p, { befehl: 'szene_speichern', slot: 1, an: [id(p, 'A')], aus: [id(p, 'B'), id(p, 'C')] });
  p = stumm(p, 'A', true);
  p = lauf(p, { befehl: 'spur_loeschen', spur_id: id(p, 'B') });
  const r = lauf(p, { befehl: 'szene_anwenden', slot: 1 });
  assert.equal(mute(r, 'A'), false);
  assert.equal(mute(r, 'C'), true);
  assert.equal(r.spuren.some((s) => s.name === 'B'), false);
});

test('szene_anwenden leaves patterns outside the scene alone; a manual M change inside the scene is overwritten', () => {
  let p = deck();
  p = lauf(p, { befehl: 'szene_speichern', slot: 3, an: [id(p, 'A')], aus: [id(p, 'B')] });
  p = folge(p, 'Late', 2);                  // created after saving, unmuted
  p = stumm(p, 'C', false);                 // not in the scene, clicked
  p = stumm(p, 'A', true);                  // in the scene, clicked after the press: the scene wins (owner decision 2)
  const r = lauf(p, { befehl: 'szene_anwenden', slot: 3 });
  assert.equal(mute(r, 'A'), false);
  assert.equal(mute(r, 'B'), true);
  assert.equal(mute(r, 'Late'), false);
  assert.equal(mute(r, 'C'), false);
});

test('szene_anwenden yields regler rows only: one spur/N/mute row per changed track', () => {
  let p = deck();
  p = lauf(p, { befehl: 'szene_speichern', slot: 0, an: [id(p, 'A'), id(p, 'C')], aus: [id(p, 'B')] });
  const nr = (n) => p.spuren.find((s) => s.name === n).nr;
  const r = ergebnis(p, { befehl: 'szene_anwenden', slot: 0 });   // A already on, B off -> only B and C change
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.regler_aenderungen.slice().sort((x, y) => x.pfad.localeCompare(y.pfad)),
    [{ pfad: `spur/${nr('B')}/mute`, wert: 1 }, { pfad: `spur/${nr('C')}/mute`, wert: 0 }].sort((x, y) => x.pfad.localeCompare(y.pfad)));
  const gleich = ergebnis(r.projekt, { befehl: 'szene_anwenden', slot: 0 });
  assert.deepEqual(gleich.regler_aenderungen, []);
  assert.equal(gleich.vor.length, 0, 'a scene that changes nothing is no history entry');
});

test('szene_anwenden of an empty slot is szene_leer_slot', () => {
  const p = deck();
  assert.equal(grund(p, { befehl: 'szene_anwenden', slot: 4 }), 'szene_leer_slot');
  assert.equal(grund(p, { befehl: 'szene_anwenden', slot: 9 }), 'argument_ungueltig');
});

test('szene_loeschen empties the slot, undo refills', () => {
  let p = deck();
  const bild = { an: [id(p, 'A')], aus: [id(p, 'B')] };
  p = lauf(p, { befehl: 'szene_speichern', slot: 5, ...bild });
  const r = ergebnis(p, { befehl: 'szene_loeschen', slot: 5 });
  assert.equal(r.projekt.szenen[5], null);
  assert.deepEqual(wende(r.projekt, r.zurueck).szenen[5], bild);
  assert.equal(grund(p, { befehl: 'szene_loeschen', slot: 8 }), 'argument_ungueltig');
});

test('project without szenen loads and saves unchanged; a wrong field is refused', () => {
  const p = deck();
  assert.equal('szenen' in p, false);
  const u = pruefeProjekt(kopie(p));
  assert.ok('projekt' in u);
  assert.equal(JSON.stringify(u.projekt), JSON.stringify(p));
  const a = id(p, 'A');
  const gut = { ...kopie(p), szenen: [null, null, null, null, null, null, null, { an: [a], aus: [] }] };
  assert.equal(pruefeFehler(gut), null);
  assert.match(String(pruefeFehler({ ...kopie(p), szenen: [null, null, null, null, null, null, null] })), /szenen/);
  assert.match(String(pruefeFehler({ ...kopie(p), szenen: [null, null, null, null, null, null, null, { an: [3], aus: [] }] })), /szenen/);
  assert.match(String(pruefeFehler({ ...kopie(p), szenen: [null, null, null, null, null, null, null, { an: [a] }] })), /szenen/);
  assert.match(String(pruefeFehler({ ...kopie(p), szenen: [null, null, null, null, null, null, null, { an: [a], aus: [], x: 1 }] })), /szenen/);
});

test('existing tracks, groups and decks are untouched: group mute, solo and a non-SEQ track keep their rows', () => {
  let p = deck();
  p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: 'Plain' });
  p = lauf(p, { befehl: 'spur_aendern', spur_id: id(p, 'Plain'), mute: true, solo: true });
  p = lauf(p, { befehl: 'gruppenspur_aendern', gruppe_id: p.gruppen[0].id, mute: true });
  p = lauf(p, { befehl: 'spur_aendern', spur_id: id(p, 'A'), solo: true });
  p = lauf(p, { befehl: 'szene_speichern', slot: 0, an: [id(p, 'A'), id(p, 'B')], aus: [id(p, 'C')] });
  const r = ergebnis(p, { befehl: 'szene_anwenden', slot: 0 });
  const s = (q, n) => ({ ...q.spuren.find((x) => x.name === n) });
  assert.deepEqual(s(r.projekt, 'Plain'), s(p, 'Plain'));
  assert.equal(r.projekt.spuren.find((x) => x.name === 'A').solo, true);
  assert.equal(r.projekt.gruppen[0].mute, true);
  assert.deepEqual(r.projekt.gruppen.map((g) => [g.id, g.mute, g.solo, g.fader_db, g.seq]), p.gruppen.map((g) => [g.id, g.mute, g.solo, g.fader_db, g.seq]));
  assert.ok(r.regler_aenderungen.every((x) => x.pfad.endsWith('/mute')), JSON.stringify(r.regler_aenderungen));
  const nrPlain = p.spuren.find((x) => x.name === 'Plain').nr;
  assert.equal(r.regler_aenderungen.some((x) => x.pfad.startsWith(`spur/${nrPlain}/`)), false);
});

test('szene_anwenden with an/aus applies that picture whatever the slot holds (picture at press)', () => {
  let p = deck();
  p = lauf(p, { befehl: 'szene_speichern', slot: 0, an: [id(p, 'B')], aus: [id(p, 'A'), id(p, 'C')] });   // the slot now holds another picture
  const r = lauf(p, { befehl: 'szene_anwenden', slot: 0, an: [id(p, 'A'), id(p, 'C')], aus: [id(p, 'B')] });
  assert.deepEqual([mute(r, 'A'), mute(r, 'B'), mute(r, 'C')], [false, true, false]);
  const q = stumm(deck(), 'A', true);
  const leer = lauf(q, { befehl: 'szene_anwenden', slot: 5, an: [id(q, 'A')], aus: [] });
  assert.equal(mute(leer, 'A'), false, 'an empty slot is no error when the picture comes along');
  assert.equal(grund(p, { befehl: 'szene_anwenden', slot: 0, an: [id(p, 'A')] }), 'argument_ungueltig', 'an without aus');
});
