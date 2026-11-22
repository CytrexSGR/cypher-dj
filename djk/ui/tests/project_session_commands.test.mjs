// Session view M2: session_aendern, zelle_halten, the one grid for both decks, zelle_aendern raster.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { neuesProjekt, pruefeProjekt, loopDeckGruppe, loopDeckSpuren, sessionRaster, sessionSzenen } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { SESSION_LABEL } from '../project/commands_session.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { tmpOrdner } from './support/project.mjs';
import { ldAufbau, schreibeLoop } from './support/loopdeck_write.mjs';
import { loopsetsBereich } from '../areas/live/loopsets.ts';

const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }]; return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const fehler = (p, ...b) => { try { fuehreListeAus(p, b); } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e; } return assert.fail(`${b.map((x) => x.befehl)} was not refused`); };
const kopie = (x) => JSON.parse(JSON.stringify(x));
const valide = (p) => { const u = pruefeProjekt(kopie(p)); assert.ok('projekt' in u, JSON.stringify(u)); };
const SHA = 'a'.repeat(64);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });
const A = { quelle: 'andreas', label: 'Test' };
const zwei = () => lauf(lauf(live(), { befehl: 'loopdeck_neu', platz: 1 }), { befehl: 'loopdeck_neu', platz: 2 });
const raster = (p) => [loopDeckGruppe(p, 1)?.loopdeck.raster, loopDeckGruppe(p, 2)?.loopdeck.raster, p.session?.raster];
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

test("session_aendern { raster: '1' } sets session.raster and both decks' raster in one undo step", (t) => {
  const { nachher: p } = mitUndo(t, zwei(), { befehl: 'session_aendern', raster: '1' });
  assert.deepEqual(raster(p), ['1', '1', '1']);
  assert.equal(sessionRaster(p), '1');
  assert.equal(sessionSzenen(p).length, 8, 'the first session command writes the 8 default scenes');
  assert.equal(p.session.szenen.length, 8);
  // with one deck, or none, the global grid is still written
  assert.deepEqual(raster(lauf(lauf(live(), { befehl: 'loopdeck_neu', platz: 2 }), { befehl: 'session_aendern', raster: '1/4' })), [undefined, '1/4', '1/4']);
  assert.equal(lauf(live(), { befehl: 'session_aendern', raster: '4takte' }).session.raster, '4takte');
  for (const r of ['1/4', '1/2', '1', 'takt', '4takte']) assert.equal(lauf(zwei(), { befehl: 'session_aendern', raster: r }).session.raster, r);
});

test('session_aendern is refused for a bad raster, a missing raster and an unknown argument', () => {
  assert.equal(fehler(zwei(), { befehl: 'session_aendern', raster: '1/8' }).grund, 'argument_ungueltig');
  assert.equal(fehler(zwei(), { befehl: 'session_aendern' }).grund, 'argument_ungueltig');
  assert.equal(fehler(zwei(), { befehl: 'session_aendern', raster: '1', szenen: [] }).grund, 'argument_unbekannt');
});

test('session_aendern on a production project is refused', () => {
  const p = neuesProjekt('prod');
  assert.equal(fehler(p, { befehl: 'session_aendern', raster: '1' }).grund, 'kein_liveprojekt');
  assert.equal(p.session, undefined);
});

test("loopdeck_aendern on deck 1 with raster '4takte' sets deck 2 and session too (one undo step)", (t) => {
  const p0 = zwei();
  const { nachher: p } = mitUndo(t, p0, { befehl: 'loopdeck_aendern', gruppe_id: loopDeckGruppe(p0, 1).id, raster: '4takte' });
  assert.deepEqual(raster(p), ['4takte', '4takte', '4takte']);
  const q = lauf(p, { befehl: 'loopdeck_aendern', gruppe_id: loopDeckGruppe(p, 2).id, raster: '1/2' });
  assert.deepEqual(raster(q), ['1/2', '1/2', '1/2']);
  // a write that changes nothing against the default grid writes no session
  assert.equal(lauf(p0, { befehl: 'loopdeck_aendern', gruppe_id: loopDeckGruppe(p0, 1).id, raster: 'takt' }).session, undefined);
});

test('a new deck joins the one grid: the session grid, else the other deck', () => {
  const a = lauf(live(), { befehl: 'loopdeck_neu', platz: 1, raster: '1/2' });
  assert.deepEqual(raster(lauf(a, { befehl: 'loopdeck_neu', platz: 2 })), ['1/2', '1/2', '1/2']);
  const sans = lauf(live(), { befehl: 'loopdeck_neu', platz: 1 });
  assert.deepEqual(raster(lauf(sans, { befehl: 'loopdeck_neu', platz: 2 })), ['takt', 'takt', undefined], 'no session without a grid change');
  const b = lauf(zwei(), { befehl: 'session_aendern', raster: '1' });
  const c = lauf(b, { befehl: 'loopdeck_leeren', gruppe_id: loopDeckGruppe(b, 2).id });
  assert.deepEqual(raster(c), ['1', '1', '1']);
  // an explicit raster on a new deck is the one grid
  assert.deepEqual(raster(lauf(a, { befehl: 'loopdeck_neu', platz: 2, raster: '4takte' })), ['4takte', '4takte', '4takte']);
});

test('zelle_halten an:true on an empty slot gives { halten: true }; an:false gives null; on a filled cell it is refused zelle_voll', (t) => {
  const p = zwei();
  const s = loopDeckSpuren(p, loopDeckGruppe(p, 1))[0].id;
  const { nachher: h } = mitUndo(t, p, { befehl: 'zelle_halten', spur_id: s, index: 3, an: true });
  assert.deepEqual(h.spuren.find((x) => x.id === s).zellen[2], { halten: true });
  const n = lauf(h, { befehl: 'zelle_halten', spur_id: s, index: 3, an: false });
  assert.equal(n.spuren.find((x) => x.id === s).zellen[2], null);
  assert.deepEqual(lauf(h, { befehl: 'zelle_halten', spur_id: s, index: 3, an: true }).spuren.find((x) => x.id === s).zellen, h.spuren.find((x) => x.id === s).zellen, 'idempotent');
  assert.equal(lauf(p, { befehl: 'zelle_halten', spur_id: s, index: 4, an: false }).spuren.find((x) => x.id === s).zellen[3], null);
  const f = lauf(p, { befehl: 'zelle_setzen', spur_id: s, index: 2, zelle: Z() });
  assert.equal(fehler(f, { befehl: 'zelle_halten', spur_id: s, index: 2, an: true }).grund, 'zelle_voll');
  assert.equal(fehler(f, { befehl: 'zelle_halten', spur_id: s, index: 2, an: false }).grund, 'zelle_voll');
  assert.equal(fehler(p, { befehl: 'zelle_halten', spur_id: s, index: 9, an: true }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'zelle_halten', spur_id: s, index: 1 }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'zelle_halten', spur_id: 'nope', index: 1, an: true }).grund.length > 0, true);
  const plain = lauf(p, { befehl: 'spur_neu', art: 'audio', name: 'plain' });
  assert.equal(fehler(plain, { befehl: 'zelle_halten', spur_id: plain.spuren.at(-1).id, index: 1, an: true }).grund, 'kein_loopdeck');
});

test('a halten slot is empty for the other cell commands and keeps no id', () => {
  const p = zwei();
  const s = loopDeckSpuren(p, loopDeckGruppe(p, 1))[0].id;
  const h = lauf(p, { befehl: 'zelle_halten', spur_id: s, index: 1, an: true });
  assert.equal(fehler(h, { befehl: 'zelle_aendern', spur_id: s, index: 1, name: 'x' }).grund, 'zelle_leer');
  assert.equal(fehler(h, { befehl: 'zelle_bewegen', von: { spur_id: s, index: 1 }, nach: { spur_id: s, index: 2 } }).grund, 'zelle_leer');
  const g = lauf(h, { befehl: 'zelle_setzen', spur_id: s, index: 1, zelle: Z() });
  assert.equal(g.spuren.find((x) => x.id === s).zellen[0].id, 'z1');
  assert.equal(lauf(h, { befehl: 'loopdeck_leeren', gruppe_id: loopDeckGruppe(h, 1).id }).spuren.find((x) => x.id === s).zellen[0], null);
});

test('zelle_aendern raster sets the cell grid; null removes the field', (t) => {
  const p = zwei();
  const s = loopDeckSpuren(p, loopDeckGruppe(p, 1))[1].id;
  const f = lauf(p, { befehl: 'zelle_setzen', spur_id: s, index: 5, zelle: Z() });
  const { nachher: r } = mitUndo(t, f, { befehl: 'zelle_aendern', spur_id: s, index: 5, raster: '1/2' });
  assert.equal(r.spuren.find((x) => x.id === s).zellen[4].raster, '1/2');
  const n = lauf(r, { befehl: 'zelle_aendern', spur_id: s, index: 5, raster: null });
  assert.equal(Object.hasOwn(n.spuren.find((x) => x.id === s).zellen[4], 'raster'), false);
  assert.equal(fehler(f, { befehl: 'zelle_aendern', spur_id: s, index: 5, raster: '1/8' }).grund, 'argument_ungueltig');
  assert.equal(fehler(f, { befehl: 'zelle_aendern', spur_id: s, index: 5, raster: 'ende' }).grund, 'argument_ungueltig');
  assert.equal(fehler(f, { befehl: 'zelle_aendern', spur_id: s, index: 5 }).grund, 'argument_ungueltig');
  assert.equal(r.session, undefined, 'a cell grid is no global grid');
});

test('the labels are the English undo texts', () => {
  assert.equal(SESSION_LABEL.session_aendern, 'Set launch grid');
  assert.equal(SESSION_LABEL.zelle_halten, 'Hold slot');
  assert.equal(SESSION_LABEL.szene_benennen, 'Name scene');
});

test('a loop set stores a halten slot as null (format 1) and loads without it', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  const store = path.join(z.tmp, 'loopsets');
  const sets = loopsetsBereich(z.ctx, z.zugang, { ordner: () => store, loopdeck: z.bereich });
  schreibeLoop(z.loops, 'groove', 4);
  assert.equal((await z.bereich.laden({ deck: 1, quelle: { loop: 'groove' } }, 'andreas')).code, 200);
  const spur = loopDeckSpuren(z.projekt(), loopDeckGruppe(z.projekt(), 1))[0].id;
  await z.aendern([{ befehl: 'zelle_halten', spur_id: spur, index: 3, an: true }]);
  assert.deepEqual(z.projekt().spuren.find((x) => x.id === spur).zellen[2], { halten: true });
  assert.equal((await sets.speichern({ deck: 1, name: 'h' }, 'andreas')).code, 200);
  const s = JSON.parse(fs.readFileSync(path.join(store, 'h', 'set.json'), 'utf8'));
  assert.equal(s.spuren[0].zellen[2], null);
  assert.equal(s.format, 1);
  assert.equal(sets.liste().j.sets[0].zellen, 1);
  // the deck view shows the slot as an empty cell
  const st = (await z.bereich.stand()).j;
  assert.equal(st.decks[1].spuren[0].zellen[2], null);
});
