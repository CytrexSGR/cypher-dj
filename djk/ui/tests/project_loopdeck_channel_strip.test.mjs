// Loop deck channel strip lane M: EQ and kill in the model (MZ1), later deck returns (MZ2) and the effect slot (MZ3).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { neuesProjekt, pruefeProjekt, eqZeilenWert, EQ_BAENDER, EQ_MIN, EQ_MAX } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { alleSpurRegler, reglerZuBefehl, istMixerRegler } from '../areas/proj/mapping.ts';
import { tmpOrdner } from './support/project.mjs';

const live = () => { const p = neuesProjekt('x'); p.live = true; return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const fehler = (p, ...b) => { try { fuehreListeAus(p, b); } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e; } return assert.fail(`${b.map((x) => x.befehl)} was not refused`); };
const kopie = (x) => JSON.parse(JSON.stringify(x));
const A = { quelle: 'andreas', label: 'Test' };
const mitDeck = (platz = 1) => lauf(live(), { befehl: 'loopdeck_neu', platz });
const mitPlain = () => lauf(mitDeck(1), { befehl: 'spur_neu', art: 'audio', name: 'Plain' });
const zeile = (r, pfad) => r.regler_aenderungen.filter((x) => x.pfad === pfad);

test('model constants and the row value helper', () => {
  assert.deepEqual([...EQ_BAENDER], ['tief', 'mitte', 'hoch']);
  assert.deepEqual([EQ_MIN, EQ_MAX], [-200, 6]);
  assert.equal(eqZeilenWert(undefined, 'tief'), 0);
  assert.equal(eqZeilenWert({ eq: { tief: -3 } }, 'tief'), -3);
  assert.equal(eqZeilenWert({ eq: { tief: -3 }, kill: { tief: true } }, 'tief'), -200);
  assert.equal(eqZeilenWert({ eq: { tief: -3 }, kill: { hoch: true } }, 'tief'), -3);
});

test('loopdeck_neu writes eq zeros next to filter 0', () => {
  const p = mitDeck(1);
  for (const s of p.spuren.slice(0, 4)) assert.deepEqual(s.eq, { tief: 0, mitte: 0, hoch: 0 });
  assert.equal(p.spuren[0].kill, undefined);
});

test('eq and kill validate: wrong band, range, non-true kill, outside a deck', () => {
  const p = mitPlain();
  const mut = (f) => { const q = kopie(p); f(q); return pruefeProjekt(q); };
  const ok = (u) => 'projekt' in u;
  assert.ok(ok(mut((q) => { q.spuren[0].eq = { tief: -200, hoch: 6 }; q.spuren[0].kill = { mitte: true }; })));
  assert.ok(!ok(mut((q) => { q.spuren[0].eq = { bass: 0 }; })), 'wrong band');
  assert.ok(!ok(mut((q) => { q.spuren[0].eq = { tief: 6.5 }; })), 'above range');
  assert.ok(!ok(mut((q) => { q.spuren[0].eq = { tief: -201 }; })), 'below range');
  assert.ok(!ok(mut((q) => { q.spuren[0].kill = { tief: 1 }; })), 'kill must be true');
  assert.ok(!ok(mut((q) => { q.spuren[0].kill = { tief: false }; })), 'false is never stored');
  assert.ok(!ok(mut((q) => { q.spuren[0].kill = { x: true }; })), 'wrong band');
  assert.ok(!ok(mut((q) => { q.spuren[4].eq = { tief: 0 }; })), 'eq on a plain track');
  assert.ok(!ok(mut((q) => { q.spuren[4].kill = { tief: true }; })), 'kill on a plain track');
  const nichtLive = kopie(neuesProjekt('n')); nichtLive.spuren.push({ ...kopie(p.spuren[4]), id: 's1', nr: 1, eq: { tief: 0 } });
  assert.ok(!ok(pruefeProjekt(nichtLive)));
});

test('spur_aendern eq merges per band, kill sets and deletes, empty objects vanish, refusals write nothing', () => {
  const p = mitPlain();
  const id = p.spuren[0].id, plain = p.spuren[4].id;
  let q = lauf(p, { befehl: 'spur_aendern', spur_id: id, eq: { mitte: -6 } });
  assert.deepEqual(q.spuren[0].eq, { tief: 0, mitte: -6, hoch: 0 });
  q = lauf(q, { befehl: 'spur_aendern', spur_id: id, eq: { tief: -3, hoch: 2 } });
  assert.deepEqual(q.spuren[0].eq, { tief: -3, mitte: -6, hoch: 2 });
  q = lauf(q, { befehl: 'spur_aendern', spur_id: id, kill: { tief: true, hoch: true } });
  assert.deepEqual(q.spuren[0].kill, { tief: true, hoch: true });
  assert.deepEqual(q.spuren[0].eq, { tief: -3, mitte: -6, hoch: 2 }, 'kill leaves the knob values');
  q = lauf(q, { befehl: 'spur_aendern', spur_id: id, kill: { tief: false } });
  assert.deepEqual(q.spuren[0].kill, { hoch: true });
  q = lauf(q, { befehl: 'spur_aendern', spur_id: id, kill: { hoch: false } });
  assert.equal('kill' in q.spuren[0], false, 'an empty kill object is removed');
  assert.equal(fehler(p, { befehl: 'spur_aendern', spur_id: id, eq: {} }).grund, 'argument_ungueltig', 'empty eq is no change');
  for (const eq of [{ bass: 1 }, { tief: 7 }, { tief: -201 }, { tief: 'x' }, 5, null]) {
    assert.equal(fehler(p, { befehl: 'spur_aendern', spur_id: id, eq }).grund, 'argument_ungueltig', JSON.stringify(eq));
  }
  for (const kill of [{ tief: 1 }, { bass: true }, 'x']) assert.equal(fehler(p, { befehl: 'spur_aendern', spur_id: id, kill }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'spur_aendern', spur_id: id, eq: { tief: -3, mitte: 99 } }).grund, 'argument_ungueltig', 'nothing written on a refusal');
  assert.equal(fehler(p, { befehl: 'spur_aendern', spur_id: plain, eq: { tief: -3 } }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'spur_aendern', spur_id: plain, kill: { tief: true } }).grund, 'argument_ungueltig');
  assert.equal(fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: id, eq: { mitte: -6 } }]).betrifft_wiedergabe, false, 'EQ is a control row, not playback');
});

test('kill sends -200 on the band row, kill off sends the stored value, undo restores', (t) => {
  let p = lauf(mitDeck(1), { befehl: 'spur_aendern', spur_id: mitDeck(1).spuren[0].id, eq: { tief: -4 } });
  const id = p.spuren[0].id;
  const an = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: id, kill: { tief: true } }]);
  assert.deepEqual(zeile(an, 'spur/1/eq/tief'), [{ pfad: 'spur/1/eq/tief', wert: -200 }]);
  assert.deepEqual(an.regler_aenderungen.filter((x) => /eq\/(mitte|hoch)/.test(x.pfad)), []);
  const killed = an.projekt;
  const aus = fuehreListeAus(killed, [{ befehl: 'spur_aendern', spur_id: id, kill: { tief: false } }]);
  assert.deepEqual(zeile(aus, 'spur/1/eq/tief'), [{ pfad: 'spur/1/eq/tief', wert: -4 }]);
  // a knob change while the kill is on moves no row
  const drehe = fuehreListeAus(killed, [{ befehl: 'spur_aendern', spur_id: id, eq: { tief: -9 } }]);
  assert.deepEqual(zeile(drehe, 'spur/1/eq/tief'), []);
  // undo
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 0, zeitgeber: false });
  const r = aendere(v, p, [{ befehl: 'spur_aendern', spur_id: id, kill: { tief: true } }], A);
  assert.deepEqual(zeile(r, 'spur/1/eq/tief'), [{ pfad: 'spur/1/eq/tief', wert: -200 }]);
  const u = rueckgaengig(v, r.projekt, { quelle: 'andreas' });
  assert.deepEqual(zeile(u, 'spur/1/eq/tief'), [{ pfad: 'spur/1/eq/tief', wert: -4 }]);
  assert.equal('kill' in u.projekt.spuren[0], false);
});

test('a new deck sends its zeros only when needed; a deleted deck track resets non-zero bands', () => {
  const neu = fuehreListeAus(live(), [{ befehl: 'loopdeck_neu', platz: 1 }]);
  assert.deepEqual(neu.regler_aenderungen.filter((x) => /\/eq\//.test(x.pfad)), [], 'defaults are not re-sent');
  const p = lauf(mitDeck(1), { befehl: 'spur_aendern', spur_id: mitDeck(1).spuren[1].id, eq: { hoch: 3 }, });
  const weg = fuehreListeAus(p, [...p.spuren.slice(0, 4).map((x) => ({ befehl: 'spur_loeschen', spur_id: x.id })), { befehl: 'gruppenspur_loeschen', gruppe_id: p.gruppen[0].id }]);
  assert.deepEqual(zeile(weg, 'spur/2/eq/hoch'), [{ pfad: 'spur/2/eq/hoch', wert: 0 }]);
  assert.deepEqual(zeile(weg, 'spur/1/eq/hoch'), [], 'a zero band is not sent');
});

test('alleSpurRegler carries the kill translation; free slots 0', () => {
  let p = mitDeck(1);
  p = lauf(p, { befehl: 'spur_aendern', spur_id: p.spuren[1].id, eq: { mitte: -5, hoch: 2 } });
  p = lauf(p, { befehl: 'spur_aendern', spur_id: p.spuren[1].id, kill: { hoch: true } });
  const r = alleSpurRegler(p);
  assert.equal(r.filter((x) => /\/eq\//.test(x.pfad)).length, 96);
  const w = (pfad) => r.find((x) => x.pfad === pfad).wert;
  assert.deepEqual([w('spur/2/eq/tief'), w('spur/2/eq/mitte'), w('spur/2/eq/hoch')], [0, -5, -200]);
  assert.equal(w('spur/9/eq/tief'), 0);
});

test('reglerZuBefehl maps an EQ row to spur_aendern eq; null for no cells, kill on, same value; clamped', () => {
  let p = mitPlain();
  const id = p.spuren[2].id;
  const r = reglerZuBefehl(p, 'spur/3/eq/tief', -12);
  assert.deepEqual(r.befehl, { befehl: 'spur_aendern', spur_id: id, eq: { tief: -12 } });
  assert.equal(reglerZuBefehl(p, 'spur/3/eq/tief', 0), null, 'already stored');
  assert.equal(reglerZuBefehl(p, 'spur/3/eq/mitte', 99).befehl.eq.mitte, 6, 'clamped');
  assert.equal(reglerZuBefehl(p, 'spur/3/eq/mitte', -500).befehl.eq.mitte, -200);
  assert.equal(reglerZuBefehl(p, 'spur/5/eq/tief', -3), null, 'a plain track has no EQ');
  assert.equal(reglerZuBefehl(p, 'spur/9/eq/tief', -3), null, 'no track');
  p = lauf(p, { befehl: 'spur_aendern', spur_id: id, kill: { tief: true } });
  assert.equal(reglerZuBefehl(p, 'spur/3/eq/tief', -200), null, 'the -200 of a kill never becomes the knob value');
  assert.notEqual(reglerZuBefehl(p, 'spur/3/eq/mitte', -3), null, 'other bands are not blocked');
  assert.ok(istMixerRegler('spur/3/eq/hoch'));
});

test('history: two drags on eq.mitte are one entry, two kill toggles are two', (t) => {
  const p = mitDeck(1), id = p.spuren[0].id;
  const dir = tmpOrdner(t), uhr = { t: 0 };
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const f = (q, b) => aendere(v, q, [{ befehl: 'spur_aendern', spur_id: id, ...b }], A).projekt;
  let q = f(p, { eq: { mitte: -2 } }); uhr.t += 300; q = f(q, { eq: { mitte: -8 } });
  assert.equal(q.spuren[0].eq.mitte, -8);
  let u = rueckgaengig(v, q, { quelle: 'andreas' });
  assert.equal(u.projekt.spuren[0].eq.mitte, 0, 'one undo takes both drags back');
  // kills never coalesce
  const v2 = new Verlauf(path.join(tmpOrdner(t), 'undo2.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const g = (x, b) => aendere(v2, x, [{ befehl: 'spur_aendern', spur_id: id, ...b }], A).projekt;
  let k = g(p, { kill: { tief: true } }); uhr.t += 300; k = g(k, { kill: { mitte: true } });
  u = rueckgaengig(v2, k, { quelle: 'andreas' });
  assert.deepEqual(u.projekt.spuren[0].kill, { tief: true }, 'the first toggle survives the first undo');
  u = rueckgaengig(v2, u.projekt, { quelle: 'andreas' });
  assert.equal('kill' in u.projekt.spuren[0], false);
});

// ---- MZ2: deck returns, the send command, the guard ----
import { HALL_VORGABE, loopDeckGruppe, loopDeckSpuren, LOOP_SEND_MAX, MAX_RETURNS } from '../project/model.ts';
import { LOOP_HALL, LOOP_DELAY } from '../project/commands_loopdeck.ts';

const send = (spurId, ziel, db) => ({ befehl: 'loopdeck_send', spur_id: spurId, ziel, db });
const retsDeck = (p, platz) => (p.returns ?? []).filter((r) => r.loopdeck?.platz === platz);

test('constants: send max, hall and delay defaults', () => {
  assert.equal(LOOP_SEND_MAX, 0);
  assert.deepEqual({ ...LOOP_HALL }, { decay: 0.25, groesse: 0.15, pre: 0, highcut: 0.7 });
  assert.equal(LOOP_DELAY.graph, 'fx-delay-sync');
  assert.deepEqual({ ...LOOP_DELAY.werte }, { k1: 0.3889, k2: 0.5 });
});

test('loopdeck_send hall creates exactly one return with loopdeck {1, hall}, merged hall values and the send; a second track reuses it', () => {
  const p0 = mitDeck(1);
  const [a, b] = p0.spuren;
  let p = lauf(p0, send(a.id, 'hall', -6));
  assert.equal(p.returns.length, 1);
  const r = p.returns[0];
  assert.deepEqual(r.loopdeck, { platz: 1, art: 'hall' });
  assert.equal(r.name, 'L1 HALL');
  assert.deepEqual(r.hall, { ...HALL_VORGABE, pre: 0, decay: 0.25, groesse: 0.15, highcut: 0.7 });
  assert.equal(r.fader_db, 0);
  assert.equal(r.inserts, undefined);
  assert.deepEqual(p.spuren[0].sends, [{ id: r.id, db: -6 }]);
  p = lauf(p, send(b.id, 'hall', -12));
  assert.equal(p.returns.length, 1, 'reused');
  assert.deepEqual(p.spuren[1].sends, [{ id: r.id, db: -12 }]);
  p = lauf(p, send(a.id, 'hall', -200));
  assert.equal(p.spuren[0].sends, undefined, '-200 removes the send, the return stays');
  assert.equal(p.returns.length, 1);
  assert.equal(fuehreListeAus(p0, [send(a.id, 'hall', -6)]).betrifft_wiedergabe, true, 'a new return changes the playback');
});

test('loopdeck_send delay creates a return with one bk stage fx-delay-sync, werte k1 0.3889, hall off', () => {
  const p = lauf(mitDeck(2), send(mitDeck(2).spuren[0].id, 'delay', -6));
  const r = p.returns[0];
  assert.deepEqual(r.loopdeck, { platz: 2, art: 'delay' });
  assert.equal(r.name, 'L2 DLY');
  assert.equal(r.hall.an, false);
  assert.equal(r.inserts.length, 1);
  assert.deepEqual([r.inserts[0].art, r.inserts[0].graph, r.inserts[0].werte.k1, r.inserts[0].werte.k2], ['bk', 'fx-delay-sync', 0.3889, 0.5]);
});

test('loopdeck_send: -200 with no return creates nothing; bad arguments; outside a deck', () => {
  const p = mitPlain();
  const id = p.spuren[0].id;
  const r = fuehreListeAus(p, [send(id, 'hall', -200)]);
  assert.equal(r.projekt.returns, undefined);
  assert.equal(r.betrifft_wiedergabe, false);
  assert.equal(fehler(p, send(id, 'hall', 1)).grund, 'argument_ungueltig', 'above LOOP_SEND_MAX');
  assert.equal(fehler(p, send(id, 'hall', -201)).grund, 'argument_ungueltig');
  assert.equal(fehler(p, send(id, 'chorus', -6)).grund, 'argument_ungueltig');
  assert.equal(fehler(p, send(p.spuren[4].id, 'hall', -6)).grund, 'kein_loopdeck');
  assert.equal(fehler(p, { ...send(id, 'hall', -6), extra: 1 }).grund, 'argument_unbekannt');
});

test('a fifth return is routing_grenze; no Baukasten stage left for the delay is ins_voll', () => {
  let p = mitDeck(1);
  for (let i = 0; i < MAX_RETURNS; i++) p = lauf(p, { befehl: 'return_neu' });
  assert.equal(fehler(p, send(p.spuren[0].id, 'hall', -6)).grund, 'routing_grenze');
  // a project with 8 Baukasten stages on a track: the delay return cannot take a stage
  let q = mitDeck(1);
  q = lauf(q, { befehl: 'spur_neu', art: 'audio', name: 'Plain' });
  const plain = q.spuren[4].id;
  for (let i = 0; i < 8; i++) {
    if (i % 5 === 0 && i > 0) q = lauf(q, { befehl: 'spur_neu', art: 'audio', name: `P${i}` });
    const t = q.spuren[q.spuren.length - 1];
    q = lauf(q, { befehl: 'insert_setzen', strang_id: t.id, pos: (t.inserts ?? []).length, art: 'bk', graph: 'fx-crunch' });
  }
  assert.equal(fehler(q, send(q.spuren[0].id, 'delay', -6)).grund, 'ins_voll');
  assert.equal(plain.length > 0, true);
});

test('a send from another deck or from a PRODUCTION track into a deck return is refused; loopdeck outside live is refused', () => {
  let p = lauf(mitDeck(1), { befehl: 'loopdeck_neu', platz: 2 });
  p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: 'Prod' });
  const retId = lauf(p, send(p.spuren[0].id, 'hall', -6)).returns[0].id;
  p = lauf(p, send(p.spuren[0].id, 'hall', -6));
  const deck2 = loopDeckSpuren(p, loopDeckGruppe(p, 2))[0], prod = p.spuren.find((s) => s.name === 'Prod');
  for (const s of [deck2, prod]) {
    const e = fehler(p, { befehl: 'send_setzen', strang_id: s.id, return_id: retId, db: -6 });
    assert.equal(e.grund, 'projekt_ungueltig');
    assert.match(e.detail ?? e.message, /only from its own deck/);
  }
  assert.equal(fehler(p, { befehl: 'send_setzen', strang_id: p.gruppen[0].id, return_id: retId, db: -6 }).grund, 'projekt_ungueltig', 'a group is no deck track');
  // own deck is fine
  lauf(p, { befehl: 'send_setzen', strang_id: p.spuren[1].id, return_id: retId, db: -6 });
  // model validation: loopdeck only with live, unique per (platz, art)
  const mut = (f) => { const q = kopie(p); f(q); return 'projekt' in pruefeProjekt(q); };
  assert.equal(mut(() => {}), true);
  assert.equal(mut((q) => { delete q.live; }), false, 'loopdeck return in a project without live');
  assert.equal(mut((q) => { q.returns.push({ ...kopie(q.returns[0]), id: 'r9', nr: 4 }); }), false, 'duplicate (platz, art)');
  assert.equal(mut((q) => { q.returns[0].loopdeck = { platz: 3, art: 'hall' }; }), false);
  assert.equal(mut((q) => { q.returns[0].loopdeck = { platz: 1, art: 'chorus' }; }), false);
});

test('undo of the first send removes the return too (one step)', (t) => {
  const p = mitDeck(1);
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 0, zeitgeber: false });
  const r = aendere(v, p, [send(p.spuren[0].id, 'delay', -6)], A);
  assert.equal(r.projekt.returns.length, 1);
  const u = rueckgaengig(v, r.projekt, { quelle: 'andreas' });
  assert.equal(u.projekt.returns, undefined);
  assert.equal(u.projekt.spuren[0].sends, undefined);
});

// ---- MZ3: the effect slot (first bk stage of the track) ----------------------------------------------------------------------------------
const fx = (spur_id, extra) => ({ befehl: 'loopdeck_effekt', spur_id, ...extra });
const bkStufen = (s) => (s.inserts ?? []).filter((i) => i.art === 'bk');

test('loopdeck_effekt: set appends one bk stage, set again replaces it in place, empty graph removes it, no slot + empty is a no-op', () => {
  let p = mitDeck(1);
  const id = p.spuren[0].id;
  p = lauf(p, fx(id, { graph: '' }));
  assert.equal(p.spuren[0].inserts, undefined, 'nothing to remove');
  p = lauf(p, { befehl: 'insert_setzen', strang_id: id, pos: 0, art: 'komp' });   // a compressor first: the slot goes to the chain end
  p = lauf(p, fx(id, { graph: 'fx-crunch' }));
  assert.deepEqual(p.spuren[0].inserts.map((i) => i.art), ['komp', 'bk']);
  assert.equal(p.spuren[0].inserts[1].graph, 'fx-crunch');
  const alt = p.spuren[0].inserts[1];
  p = lauf(p, fx(id, { graph: 'fx-remix' }));
  assert.deepEqual(p.spuren[0].inserts.map((i) => i.art), ['komp', 'bk']);
  assert.equal(p.spuren[0].inserts[1].graph, 'fx-remix');
  assert.equal(p.spuren[0].inserts[1].slot, alt.slot, 'the pool slot is reused');
  p = lauf(p, fx(id, { graph: '' }));
  assert.deepEqual(p.spuren[0].inserts.map((i) => i.art), ['komp']);
});

test('loopdeck_effekt an switches the slot; no slot, both fields, no field, a plain track and an unknown graph are refused', () => {
  let p = mitPlain();
  const id = p.spuren[0].id;
  assert.equal(fehler(p, fx(id, { an: false })).grund, 'argument_ungueltig');
  assert.match(fehler(p, fx(id, { an: false })).detail, /no effect on this track/);
  p = lauf(p, fx(id, { graph: 'fx-crunch' }));
  assert.equal(p.spuren[0].inserts[0].an, true);
  p = lauf(p, fx(id, { an: false }));
  assert.equal(p.spuren[0].inserts[0].an, false);
  p = lauf(p, fx(id, { an: true }));
  assert.equal(p.spuren[0].inserts[0].an, true);
  assert.equal(fehler(p, fx(id, { graph: 'fx-crunch', an: true })).grund, 'argument_ungueltig');
  assert.equal(fehler(p, fx(id, {})).grund, 'argument_ungueltig');
  assert.equal(fehler(p, fx(id, { an: 1 })).grund, 'argument_ungueltig');
  assert.equal(fehler(p, fx(p.spuren[4].id, { graph: 'fx-crunch' })).grund, 'kein_loopdeck');
  assert.equal(fehler(p, fx(id, { graph: 'x', extra: 1 })).grund, 'argument_unbekannt');
});

test('loopdeck_effekt: the ninth Baukasten stage of the project is ins_voll, a full chain is kette_voll', () => {
  let q = lauf(mitDeck(1), { befehl: 'loopdeck_neu', platz: 2 });
  const ids = q.spuren.filter((s) => s.zellen).map((s) => s.id);
  for (let i = 0; i < 8; i++) q = lauf(q, fx(ids[i], { graph: 'fx-crunch' }));
  assert.equal(q.spuren.filter((s) => s.zellen).flatMap(bkStufen).length, 8);
  q = lauf(q, fx(ids[0], { graph: 'fx-remix' }));   // a replace in a full pool still works
  assert.equal(bkStufen(q.spuren.find((x) => x.id === ids[0]))[0].graph, 'fx-remix');
  // fill the pool with eight stages on the production tracks, then the deck track gets ins_voll
  let r = mitDeck(1);
  for (let i = 0; i < 8; i++) {
    r = lauf(r, { befehl: 'spur_neu', art: 'audio', name: `P${i}` });
    const t = r.spuren[r.spuren.length - 1];
    r = lauf(r, { befehl: 'insert_setzen', strang_id: t.id, pos: 0, art: 'bk', graph: 'fx-crunch' });
  }
  assert.equal(fehler(r, fx(r.spuren[0].id, { graph: 'fx-crunch' })).grund, 'ins_voll');
  // chain of five
  let k = mitDeck(1);
  for (let i = 0; i < 4; i++) k = lauf(k, { befehl: 'insert_setzen', strang_id: k.spuren[0].id, pos: i, art: 'komp' });
  k = lauf(k, { befehl: 'insert_setzen', strang_id: k.spuren[0].id, pos: 4, art: 'eq' });
  assert.equal(fehler(k, fx(k.spuren[0].id, { graph: 'fx-crunch' })).grund, 'kette_voll');
});

test('undo of an effect set is one step, and the set is on the general path while an on the track is a light insert_an', (t) => {
  const p = mitDeck(1);
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 0, zeitgeber: false });
  const r = aendere(v, p, [fx(p.spuren[0].id, { graph: 'fx-crunch' })], A);
  assert.equal(r.projekt.spuren[0].inserts.length, 1);
  const u = rueckgaengig(v, r.projekt, { quelle: 'andreas' });
  assert.equal(u.projekt.spuren[0].inserts, undefined);
  const an = fuehreListeAus(r.projekt, [{ befehl: 'insert_an', insert_id: r.projekt.spuren[0].inserts[0].id, an: false }]);
  assert.deepEqual(an.regler_aenderungen.map((x) => x.pfad), [`ins/bk/${r.projekt.spuren[0].inserts[0].slot}/an`]);
});
