// Session view M3: the scene commands (insert, capture, duplicate, delete, edit) over all columns (D17).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { neuesProjekt, pruefeProjekt, loopDeckGruppe, loopDeckSpuren, sessionSzenen, alleZellen, TEMPO_MIN, TEMPO_MAX } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { SESSION_LABEL, loescheSzene } from '../project/commands_session.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { tmpOrdner } from './support/project.mjs';

const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }]; return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const fehler = (p, ...b) => { try { fuehreListeAus(p, b); } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e; } return assert.fail(`${b.map((x) => x.befehl)} was not refused`); };
const kopie = (x) => JSON.parse(JSON.stringify(x));
const valide = (p) => { const u = pruefeProjekt(kopie(p)); assert.ok('projekt' in u, JSON.stringify(u)); };
const A = { quelle: 'andreas', label: 'Test' };
const sha = (n) => String(n % 10).repeat(64);
function mitUndo(t, p, ...befehle) {
  const dir = tmpOrdner(t);
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { jetzt: () => 0, zeitgeber: false });
  const r = aendere(v, p, befehle, A);
  valide(r.projekt);
  const u = rueckgaengig(v, r.projekt, { quelle: 'andreas' });
  // the id counters only rise and stay on undo (model.ts, neueId), so they are left out of the comparison
  assert.equal(JSON.stringify({ ...u.projekt, rev: 0, wiedergabe_rev: 0, naechste_id: 0 }), JSON.stringify({ ...p, rev: 0, wiedergabe_rev: 0, naechste_id: 0 }), `undo of ${befehle.map((b) => b.befehl)} restores the project byte-equal`);
  return r.projekt;
}
// two decks, 8 tracks; the cells of rows 1..`bis` are filled on every track, named t<track>r<row>
function voll(bis = 7) {
  let p = lauf(lauf(live(), { befehl: 'loopdeck_neu', platz: 1 }), { befehl: 'loopdeck_neu', platz: 2 });
  const befehle = [];
  spuren(p).forEach((s, t) => { for (let r = 1; r <= bis; r++) befehle.push({ befehl: 'zelle_setzen', spur_id: s.id, index: r, zelle: { name: `t${t}r${r}`, farbe: r, art: 'loop', sha256: sha(t * 8 + r), beats: 4, bpm: 120, gain_db: -r } }); });
  p = lauf(p, ...befehle);
  return p;
}
const spuren = (p) => [1, 2].flatMap((n) => loopDeckSpuren(p, loopDeckGruppe(p, n)));
const zeile = (p, r) => spuren(p).map((s) => s.zellen[r - 1]);
const namen = (p, r) => zeile(p, r).map((z) => (z ? z.name : null));
const ohneIds = (z) => (z && z.id ? (({ id, ...rest }) => rest)(z) : z);
const leerSzene = (s) => s.name === '' && s.farbe === 0 && s.bpm === undefined && s.takte === undefined && s.folge === undefined;

test('szene_neu { nach: 2 } shifts rows 3..7 to 4..8 on every track and in szenen; row 3 is empty; undo is byte-equal', (t) => {
  const p0 = voll(7);
  const p1 = lauf(p0, { befehl: 'szene_aendern', zeile: 5, name: 'Drop', farbe: 9 });
  const p = mitUndo(t, p1, { befehl: 'szene_neu', nach: 2 });
  assert.deepEqual(namen(p, 3), Array(8).fill(null));
  for (const r of [4, 5, 6, 7, 8]) assert.deepEqual(namen(p, r), namen(p1, r - 1), `row ${r}`);
  for (const r of [1, 2]) assert.deepEqual(namen(p, r), namen(p1, r));
  const sz = sessionSzenen(p);
  assert.equal(sz.length, 8);
  assert.ok(leerSzene(sz[2]) && sz[2].id !== sessionSzenen(p1)[2].id);
  assert.equal(sz[5].name, 'Drop'); assert.equal(sz[5].farbe, 9);
  assert.equal(new Set(sz.map((s) => s.id)).size, 8, 'scene ids stay unique');
  assert.equal(p.naechste_id.szene > 9, true);
  // cell ids survive the shift
  assert.equal(p.spuren.find((s) => s.id === spuren(p1)[0].id).zellen[3].id, spuren(p1)[0].zellen[2].id);
});

test('szene_neu at the top and after row 7; every column in step', () => {
  const p0 = voll(7);
  const top = lauf(p0, { befehl: 'szene_neu', nach: 0 });
  assert.deepEqual(namen(top, 1), Array(8).fill(null));
  assert.deepEqual(namen(top, 2), namen(p0, 1));
  const end = lauf(p0, { befehl: 'szene_neu', nach: 7 });
  assert.deepEqual(namen(end, 8), Array(8).fill(null));
  assert.deepEqual(namen(end, 7), namen(p0, 7));
  assert.equal(fehler(p0, { befehl: 'szene_neu', nach: 8 }).grund, 'argument_ungueltig');
  assert.equal(fehler(p0, { befehl: 'szene_neu', nach: -1 }).grund, 'argument_ungueltig');
  assert.equal(fehler(p0, { befehl: 'szene_neu' }).grund, 'argument_ungueltig');
});

test('szene_neu with a cell in row 8 of any track is refused zeilen_voll; an empty default scene in row 8 is allowed', () => {
  const p = voll(8);
  const e = fehler(p, { befehl: 'szene_neu', nach: 2 });
  assert.equal(e.grund, 'zeilen_voll');
  assert.match(e.detail || e.message, /All 8 rows are in use; 16 rows come with the next slice\./);
  // a single filled cell in row 8 of the last track is enough
  const q = voll(7);
  const s = spuren(q)[7];
  const r = lauf(q, { befehl: 'zelle_setzen', spur_id: s.id, index: 8, zelle: { name: 'x', farbe: 0, art: 'loop', sha256: sha(1), beats: 4, bpm: 120, gain_db: 0 } });
  assert.equal(fehler(r, { befehl: 'szene_neu', nach: 0 }).grund, 'zeilen_voll');
  // nothing shifted
  assert.deepEqual(namen(r, 8), [null, null, null, null, null, null, null, 'x']);
  // a scene with a name, a colour or a tempo in row 8 counts as used; so does a hold slot
  for (const f of [{ name: 'n' }, { farbe: 2 }, { bpm: 130 }, { takte: 4 }, { folge: 'loop' }]) {
    assert.equal(fehler(lauf(q, { befehl: 'szene_aendern', zeile: 8, ...f }), { befehl: 'szene_neu', nach: 0 }).grund, 'zeilen_voll', JSON.stringify(f));
  }
  assert.equal(fehler(lauf(q, { befehl: 'zelle_halten', spur_id: s.id, index: 8, an: true }), { befehl: 'szene_neu', nach: 0 }).grund, 'zeilen_voll');
  // empty row 8 and a default scene: fine, also after the scene was edited and cleared again
  lauf(q, { befehl: 'szene_neu', nach: 0 });
  const cleared = lauf(lauf(q, { befehl: 'szene_aendern', zeile: 8, name: 'n' }), { befehl: 'szene_aendern', zeile: 8, name: '' });
  lauf(cleared, { befehl: 'szene_neu', nach: 0 });
});

test('szene_fangen copies the chosen cells into a new row: same sha, beats, bpm, gain, name, colour, new id; the budget is unchanged', (t) => {
  const p0 = lauf(voll(7), { befehl: 'szene_aendern', zeile: 3, name: 'Named', bpm: 126 });
  const sp = spuren(p0);
  const zellen = {}; for (const s of sp) zellen[s.id] = null;
  zellen[sp[0].id] = 3; zellen[sp[7].id] = 1; zellen[sp[4].id] = 7;
  const p = mitUndo(t, p0, { befehl: 'szene_fangen', nach: 0, zellen });
  const neu = spuren(p);
  const alt = sp[0].zellen[2], kop = neu[0].zellen[0];
  assert.deepEqual(ohneIds(kop), ohneIds(alt));
  assert.notEqual(kop.id, alt.id);
  assert.equal(kop.sha256, alt.sha256);
  assert.equal(neu[1].zellen[0], null, 'L1.2 is empty');
  assert.deepEqual(ohneIds(neu[7].zellen[0]), ohneIds(sp[7].zellen[0]));
  assert.deepEqual(ohneIds(neu[4].zellen[0]), ohneIds(sp[4].zellen[6]));
  // the old rows moved down by one, the old cell 3 is now cell 4
  assert.equal(neu[0].zellen[3].id, alt.id);
  assert.deepEqual(neu.map((s) => s.zellen[0] !== null), [true, false, false, false, true, false, false, true]);
  // same audio: the set of distinct sha256 is unchanged
  const shas = (q) => new Set([...alleZellen(q)].map((z) => z.sha256));
  assert.deepEqual([...shas(p)].sort(), [...shas(p0)].sort());
  assert.equal(new Set([...alleZellen(p)].map((z) => z.id)).size, [...alleZellen(p)].length, 'cell ids unique');
  assert.ok(leerSzene(sessionSzenen(p)[0]));
  assert.equal(sessionSzenen(p)[3].name, 'Named', 'the scene list shifted with the rows');
  assert.equal(sessionSzenen(p)[3].bpm, 126);
  // a copy keeps the cell grid
  const mit = lauf(p0, { befehl: 'zelle_aendern', spur_id: sp[0].id, index: 3, raster: '1/2' });
  const q = lauf(mit, { befehl: 'szene_fangen', nach: 1, zellen: { [sp[0].id]: 3 } });
  assert.equal(spuren(q)[0].zellen[1].raster, '1/2');
});

test('szene_fangen: arguments, a stale or empty source and a full row 8', () => {
  const p = voll(7);
  const sp = spuren(p);
  assert.equal(fehler(p, { befehl: 'szene_fangen', nach: 0 }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'szene_fangen', nach: 0, zellen: { [sp[0].id]: 9 } }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'szene_fangen', nach: 0, zellen: { [sp[0].id]: 0 } }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'szene_fangen', nach: 0, zellen: [] }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'szene_fangen', nach: 0, zellen: { nope: 1 } }).grund.length > 0, true);
  const plain = lauf(p, { befehl: 'spur_neu', art: 'audio', name: 'plain' });
  assert.equal(fehler(plain, { befehl: 'szene_fangen', nach: 0, zellen: { [plain.spuren.at(-1).id]: 1 } }).grund, 'kein_loopdeck');
  // an empty source cell gives an empty slot; an empty map gives an empty row
  const leer = lauf(p, { befehl: 'szene_fangen', nach: 0, zellen: { [sp[0].id]: 8 } });
  assert.deepEqual(namen(leer, 1), Array(8).fill(null));
  assert.equal(fehler(voll(8), { befehl: 'szene_fangen', nach: 0, zellen: {} }).grund, 'zeilen_voll');
});

test('szene_doppeln { zeile: 2 } gives a row 3 equal to row 2 except the cell ids and the scene id', (t) => {
  const p0 = lauf(voll(7), { befehl: 'szene_aendern', zeile: 2, name: 'Build', farbe: 4, bpm: 128, takte: 8, folge: { sprung: 1 } });
  const hold = lauf(lauf(p0, { befehl: 'zelle_setzen', spur_id: spuren(p0)[3].id, index: 2, zelle: null }), { befehl: 'zelle_halten', spur_id: spuren(p0)[3].id, index: 2, an: true });   // one hold slot in row 2
  const p = mitUndo(t, hold, { befehl: 'szene_doppeln', zeile: 2 });
  const [r2, r3] = [zeile(p, 2), zeile(p, 3)];
  assert.deepEqual(r3.map(ohneIds), r2.map(ohneIds));
  r3.forEach((z, i) => { if (z && z.id) assert.notEqual(z.id, r2[i].id); });
  assert.deepEqual(r3[3], { halten: true });
  const sz = sessionSzenen(p);
  const { id: i2, ...s2 } = sz[1], { id: i3, ...s3 } = sz[2];
  assert.deepEqual(s3, s2);
  assert.notEqual(i2, i3);
  assert.deepEqual(namen(p, 4), namen(hold, 3), 'the rows below moved down');
  const mitName = lauf(hold, { befehl: 'szene_aendern', zeile: 3, name: 'Below' });
  assert.equal(sessionSzenen(lauf(mitName, { befehl: 'szene_doppeln', zeile: 2 }))[3].name, 'Below', 'the scene below moved down with its row');
  assert.equal(fehler(voll(8), { befehl: 'szene_doppeln', zeile: 2 }).grund, 'zeilen_voll');
  assert.equal(fehler(hold, { befehl: 'szene_doppeln', zeile: 9 }).grund, 'argument_ungueltig');
});

test('szene_loeschen { zeile: 1 } shifts the rows up; row 8 becomes empty with a default scene (handler over a draft)', () => {
  const p0 = lauf(voll(7), { befehl: 'szene_aendern', zeile: 3, name: 'Three' });
  const p = kopie(p0);
  loescheSzene(p, { befehl: 'szene_loeschen', zeile: 1 });
  valide(p);
  for (let r = 1; r <= 6; r++) assert.deepEqual(namen(p, r), namen(p0, r + 1), `row ${r}`);
  assert.deepEqual(namen(p, 7), Array(8).fill(null));
  assert.deepEqual(namen(p, 8), Array(8).fill(null));
  const sz = sessionSzenen(p);
  assert.equal(sz[1].name, 'Three');
  assert.ok(leerSzene(sz[7]));
  assert.equal(new Set(sz.map((s) => s.id)).size, 8);
  assert.throws(() => loescheSzene(kopie(p0), { befehl: 'szene_loeschen', zeile: 0 }), (e) => e instanceof BefehlFehler && e.grund === 'argument_ungueltig');
  assert.throws(() => loescheSzene(neuesProjekt('prod'), { befehl: 'szene_loeschen', zeile: 1 }), (e) => e instanceof BefehlFehler && e.grund === 'kein_liveprojekt');
  // row 8 deleted: nothing else moves
  const q = kopie(voll(8));
  loescheSzene(q, { befehl: 'szene_loeschen', zeile: 8 });
  assert.deepEqual(namen(q, 8), Array(8).fill(null));
  assert.deepEqual(namen(q, 7), namen(voll(8), 7));
});

test('szene_loeschen as a command: zeile deletes a session row, slot still empties the SEQ slot, both or neither is refused', (t) => {
  const p0 = voll(7);
  const p = mitUndo(t, p0, { befehl: 'szene_loeschen', zeile: 1 });
  for (let r = 1; r <= 6; r++) assert.deepEqual(namen(p, r), namen(p0, r + 1));
  assert.deepEqual(namen(p, 8), Array(8).fill(null));
  const dir = tmpOrdner(t);
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { jetzt: () => 0, zeitgeber: false });
  const r = aendere(v, p0, [{ befehl: 'szene_loeschen', zeile: 2 }], { ...A, label: SESSION_LABEL.szene_loeschen });
  assert.equal(r.projekt.spuren[0].zellen[1].name, 't0r3');
  // the SEQ path is unchanged: slot 3 is emptied
  const s = { ...p0, szenen: [null, null, null, { an: [], aus: [] }, null, null, null, null] };
  assert.equal(lauf(s, { befehl: 'szene_loeschen', slot: 3 }).szenen[3], null);
  for (const b of [{ slot: 3, zeile: 1 }, {}]) assert.equal(fehler(p0, { befehl: 'szene_loeschen', ...b }).grund, 'argument_ungueltig');
  assert.equal(fehler(neuesProjekt('prod'), { befehl: 'szene_loeschen', zeile: 1 }).grund, 'kein_liveprojekt');
  assert.equal(fehler(p0, { befehl: 'szene_loeschen', zeile: 9 }).grund, 'argument_ungueltig');
});

test('szene_aendern edits a scene; null removes bpm, takte and folge', (t) => {
  const p0 = voll(2);
  const p = mitUndo(t, p0, { befehl: 'szene_aendern', zeile: 4, bpm: 130 });
  assert.equal(sessionSzenen(p)[3].bpm, 130);
  assert.equal(p.session.szenen.length, 8, 'the first scene command writes the 8 default scenes');
  const q = lauf(p, { befehl: 'szene_aendern', zeile: 4, takte: 16, folge: { sprung: 2 }, name: 'Break', farbe: 6 });
  assert.deepEqual(sessionSzenen(q)[3], { id: sessionSzenen(p)[3].id, name: 'Break', farbe: 6, bpm: 130, takte: 16, folge: { sprung: 2 } });
  const n = lauf(q, { befehl: 'szene_aendern', zeile: 4, bpm: null, takte: null, folge: null });
  assert.deepEqual(sessionSzenen(n)[3], { id: sessionSzenen(p)[3].id, name: 'Break', farbe: 6 });
  assert.equal(Object.hasOwn(sessionSzenen(n)[3], 'bpm'), false);
  for (const f of ['loop', 'weiter', 'stopp']) assert.equal(sessionSzenen(lauf(p, { befehl: 'szene_aendern', zeile: 1, folge: f }))[0].folge, f);
  assert.equal(sessionSzenen(lauf(q, { befehl: 'szene_aendern', zeile: 4, name: '' }))[3].name, '');
  for (const [a, g] of [[{ zeile: 0, name: 'x' }, 'argument_ungueltig'], [{ zeile: 9, name: 'x' }, 'argument_ungueltig'], [{ name: 'x' }, 'argument_ungueltig'],
    [{ zeile: 1 }, 'argument_ungueltig'], [{ zeile: 1, name: 'x'.repeat(33) }, 'argument_ungueltig'], [{ zeile: 1, farbe: 16 }, 'argument_ungueltig'],
    [{ zeile: 1, bpm: TEMPO_MIN - 1 }, 'argument_ungueltig'], [{ zeile: 1, bpm: TEMPO_MAX + 1 }, 'argument_ungueltig'], [{ zeile: 1, takte: 0 }, 'argument_ungueltig'],
    [{ zeile: 1, takte: 257 }, 'argument_ungueltig'], [{ zeile: 1, folge: 'x' }, 'argument_ungueltig'], [{ zeile: 1, folge: { sprung: 9 } }, 'argument_ungueltig'],
    [{ zeile: 1, extra: 1 }, 'argument_unbekannt']]) assert.equal(fehler(p0, { befehl: 'szene_aendern', ...a }).grund, g, JSON.stringify(a));
});

test('the scene commands are refused on a production project and without a live deck they still move the scenes', () => {
  const prod = neuesProjekt('prod');
  for (const b of [{ befehl: 'szene_aendern', zeile: 1, name: 'x' }, { befehl: 'szene_neu', nach: 0 }, { befehl: 'szene_fangen', nach: 0, zellen: {} },
    { befehl: 'szene_doppeln', zeile: 1 }]) assert.equal(fehler(prod, b).grund, 'kein_liveprojekt', b.befehl);
  assert.equal(prod.session, undefined);
  const leer = lauf(live(), { befehl: 'szene_aendern', zeile: 2, name: 'solo' });
  assert.equal(sessionSzenen(leer)[1].name, 'solo');
  const q = lauf(leer, { befehl: 'szene_neu', nach: 0 });
  assert.equal(sessionSzenen(q)[2].name, 'solo');
});

test('the labels are the English undo texts', () => {
  assert.deepEqual([SESSION_LABEL.szene_neu, SESSION_LABEL.szene_fangen, SESSION_LABEL.szene_doppeln, SESSION_LABEL.szene_loeschen, SESSION_LABEL.szene_aendern],
    ['Insert scene', 'Capture scene', 'Duplicate scene', 'Delete scene', 'Edit scene']);
});

test('zelle_bewegen onto a { halten: true } slot swaps: the hold slot moves to the source cell (intended)', () => {
  const p0 = voll(2);
  const [s] = spuren(p0);
  const h = lauf(lauf(p0, { befehl: 'zelle_setzen', spur_id: s.id, index: 5, zelle: null }), { befehl: 'zelle_halten', spur_id: s.id, index: 5, an: true });
  const p = lauf(h, { befehl: 'zelle_bewegen', von: { spur_id: s.id, index: 1 }, nach: { spur_id: s.id, index: 5 } });
  const z = spuren(p)[0].zellen;
  assert.equal(z[4].name, 't0r1');
  assert.deepEqual(z[0], { halten: true });
  valide(p);
});
