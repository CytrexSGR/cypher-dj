// 1.10 slice 4a, task T5: project model, commands and merge refusal of the insert chain (`komp` in 4a; eq and saett in the 4b block at the end).
// Spec 1.1, 1.2, AK-S4-11. Pure calculation: no server, no core.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import {
  neuesProjekt, pruefeProjekt, kanonisch, wiedergabeSicht, MAX_INSERTS_PRO_STRANG, MAX_INS_KOMP, MAX_INS_EQ, MAX_INS_SAETT, MAX_INS_LIM, MAX_RACK,
} from '../project/model.ts';
import { INSERT_ARTEN } from '../project/insert_key.ts';
import { wende } from '../project/patch.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { uebersetze } from '../project/playback.ts';
import { mergePlan, MergeFehler } from '../project/merge.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { ohneAbgeleitetes, tmpOrdner } from './support/project.mjs';
import { basisProjekt, szenarioOhneInserts } from './support/inserts_scenario.mjs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 90)}`);
function pruefe(p, r) {   // valid, forward/back patches round-trip, input untouched
  assert.equal(pruefeProjekt(r.projekt).fehler, undefined, JSON.stringify(pruefeProjekt(r.projekt)));
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt));
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p));
}
const gleichLeichtVoll = (p, b) => {   // the fast path gives the same as the general path
  const l = fuehreListeAus(p, [b]), v = fuehreListeAus(p, [b], { voll: true });
  assert.deepEqual(l.vor, v.vor); assert.deepEqual(l.zurueck, v.zurueck); assert.deepEqual(l.regler_aenderungen, v.regler_aenderungen);
  assert.equal(l.betrifft_wiedergabe, v.betrifft_wiedergabe); assert.equal(kanonisch(l.projekt), kanonisch(v.projekt));
};
const setze = (p, strang, art = 'komp', extra = {}) => ok(p, { befehl: 'insert_setzen', strang_id: strang, pos: extra.pos ?? 0, art, ...extra.rest }).projekt;
const mit = (n) => {   // n audio tracks s1..sn
  let p = neuesProjekt('T');
  for (let i = 0; i < n; i++) p = ok(p, { befehl: 'spur_neu', art: 'audio', name: `T${i + 1}` }).projekt;
  return p;
};
const mitAllem = () => {   // 3 tracks, group g1 (s2, s3), return r1, r2
  let p = mit(3);
  p = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s2', 's3'] }).projekt;
  return ok(p, { befehl: 'return_neu' }).projekt;
};
const DEF = { schwelle: -18, ratio: 4, knie: 6, attack: 10, release: 120, makeup: 0, mix: 1, schp: 0 };

test('limits equal the generated contract (pool sizes and chain length)', () => {
  assert.equal(MAX_INSERTS_PRO_STRANG, 4);
  assert.equal(MAX_INS_KOMP, INSERT_ARTEN.komp.instanzen);
  assert.equal(MAX_INS_EQ, INSERT_ARTEN.eq.instanzen);
  assert.equal(MAX_INS_SAETT, INSERT_ARTEN.saett.instanzen);
  assert.equal(MAX_RACK, INSERT_ARTEN.rack.instanzen);
});

test('insert_setzen: a stage on every kind of strip, lowest free slot, defaults filled, controls emitted (values first, `an` last)', () => {
  const p = mitAllem();
  const r = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }); pruefe(p, r);
  assert.deepEqual(r.projekt.spuren[0].inserts, [{ id: 'i1', art: 'komp', slot: 1, an: true, werte: DEF }]);
  assert.equal(r.betrifft_wiedergabe, true, 'a new stage is a structure change');
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'ins/komp/1/an', wert: 1 }], 'defaults equal the pool defaults: only `an` differs');
  const g = setze(r.projekt, 'g1'), ret = setze(g, 'r1'), m = setze(ret, 'master');
  assert.deepEqual([g.gruppen[0].inserts[0].slot, ret.returns[0].inserts[0].slot, m.master.inserts[0].slot], [2, 3, 4]);
  assert.equal(pruefeProjekt(m).fehler, undefined);
  // werte and sc given: only the deviating values travel
  const w = ok(p, { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 }, sc: 1 });
  assert.deepEqual(w.regler_aenderungen, [{ pfad: 'ins/komp/1/schwelle', wert: -30 }, { pfad: 'ins/komp/1/ratio', wert: 8 },
    { pfad: 'ins/komp/1/sc', wert: 1 }, { pfad: 'ins/komp/1/an', wert: 1 }]);
  assert.equal(w.projekt.spuren[1].inserts[0].sc, 1);
  // negative control: a project without inserts has no insert controls and no inserts key anywhere
  assert.ok(!JSON.stringify(p).includes('inserts'));
});

test('insert_setzen: refusals (AK-S4-11) and the negative controls next to each', () => {
  const p = mitAllem();
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'hall' }, 'art_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'bk' }, 'art_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'rack' }, 'art_unbekannt');   // the rack comes in 4c; eq and saett are kinds since 4b
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0 }, 'art_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's9', pos: 0, art: 'komp' }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'komp' }, 'argument_ungueltig');   // gap
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 4, art: 'komp' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { schwelle: 3 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { gain: 3 } }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', sc: 33 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', sc: 9 }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', farbe: 'x' }, 'argument_unbekannt');
  // the 5th stage on one strand: kette_voll; the fourth is fine
  let q = p;
  for (let i = 0; i < MAX_INSERTS_PRO_STRANG; i++) q = ok(q, { befehl: 'insert_setzen', strang_id: 's1', pos: i, art: 'komp' }).projekt;
  assert.equal(q.spuren[0].inserts.length, 4, 'negative control: four stages are accepted');
  lehntAb(q, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }, 'kette_voll');
  lehntAb(q, { befehl: 'insert_setzen', strang_id: 's1', pos: 3, art: 'komp' }, 'kette_voll');
  // the 13th komp: ins_voll; the twelfth is fine
  let r = mit(12);
  for (let i = 1; i <= MAX_INS_KOMP; i++) r = ok(r, { befehl: 'insert_setzen', strang_id: `s${i}`, pos: 0, art: 'komp' }).projekt;
  assert.equal(r.spuren.length, 12, 'negative control: twelve stages are accepted');
  r = ok(r, { befehl: 'spur_neu', art: 'audio' }).projekt;
  lehntAb(r, { befehl: 'insert_setzen', strang_id: 's13', pos: 0, art: 'komp' }, 'ins_voll');
});

test('slot_eindeutig: twelve stages on twelve strips take twelve distinct slots; a freed slot is the next one taken', () => {
  let r = mit(12);
  for (let i = 1; i <= MAX_INS_KOMP; i++) r = ok(r, { befehl: 'insert_setzen', strang_id: `s${i}`, pos: 0, art: 'komp' }).projekt;
  assert.deepEqual(r.spuren.map((s) => s.inserts[0].slot), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(pruefeProjekt(r).fehler, undefined);
  const frei = ok(r, { befehl: 'insert_entfernen', insert_id: 'i5' }).projekt;
  assert.equal(setze(ok(frei, { befehl: 'spur_neu', art: 'audio' }).projekt, 's13').spuren[12].inserts[0].slot, 5);
});

test('insert_setzen with ersetzen: replaces the stage at pos, frees its slot; ersetzen on an empty position is refused', () => {
  const p = setze(setze(mitAllem(), 's1'), 's1', 'komp', { pos: 1 });
  const r = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', ersetzen: true, werte: { ratio: 2 } }); pruefe(p, r);
  assert.equal(r.projekt.spuren[0].inserts.length, 2);
  assert.equal(r.projekt.spuren[0].inserts[0].werte.ratio, 2);
  assert.deepEqual(r.projekt.spuren[0].inserts.map((i) => i.slot), [1, 2], 'the replaced slot is the lowest free one again');
  lehntAb(mitAllem(), { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', ersetzen: true }, 'argument_ungueltig');
  // inserting at the front shifts the others (order = signal order)
  const f = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }); pruefe(p, f);
  assert.deepEqual(f.projekt.spuren[0].inserts.map((i) => i.slot), [3, 1, 2]);
});

test('leicht_ohne_neue_wiedergabe: insert_param_setzen / insert_an: control change only, no new playback, fast path equals general path', () => {
  const p = setze(mitAllem(), 's1');
  const b1 = { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'schwelle', wert: -24 };
  const r = ok(p, b1); pruefe(p, r); gleichLeichtVoll(p, b1);
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'ins/komp/1/schwelle', wert: -24 }]);
  assert.equal(r.projekt.spuren[0].inserts[0].werte.schwelle, -24);
  const b2 = { befehl: 'insert_an', insert_id: 'i1', an: false };
  const a = ok(p, b2); pruefe(p, a); gleichLeichtVoll(p, b2);
  assert.equal(a.betrifft_wiedergabe, false, 'bypass is no swap');
  assert.deepEqual(a.regler_aenderungen, [{ pfad: 'ins/komp/1/an', wert: 0 }]);
  // on a group, a return and the master as well
  for (const strang of ['g1', 'r1', 'master']) {
    const q = setze(mitAllem(), strang);
    for (const b of [{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'makeup', wert: 3 }, { befehl: 'insert_an', insert_id: 'i1', an: false }]) {
      const x = ok(q, b); pruefe(q, x); gleichLeichtVoll(q, b); assert.equal(x.betrifft_wiedergabe, false, strang);
    }
  }
  // negative control: the same value again changes nothing, sends no control
  const same = ok(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'schwelle', wert: -18 });
  assert.deepEqual(same.regler_aenderungen, []); assert.equal(same.betrifft_wiedergabe, false);
  // refusals
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i9', param: 'ratio', wert: 2 }, 'insert_unbekannt');
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'tiefe', wert: 2 }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'ratio', wert: 21 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'ratio', wert: Number.NaN }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'ratio' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_an', insert_id: 'i1', an: 1 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_an', insert_id: 'i9', an: true }, 'insert_unbekannt');
  // the key is a row too (not on the fast path: sc 0 removes the key)
  const k = ok(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'sc', wert: 2 }); pruefe(p, k);
  assert.equal(k.projekt.spuren[0].inserts[0].sc, 2); assert.deepEqual(k.regler_aenderungen, [{ pfad: 'ins/komp/1/sc', wert: 2 }]);
  const k0 = ok(k.projekt, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'sc', wert: 0 }); pruefe(k.projekt, k0);
  assert.ok(!('sc' in k0.projekt.spuren[0].inserts[0]));
});

test('insert_entfernen: slot returns to the pool, values reset to the defaults through controls (`an` first)', () => {
  let p = setze(mitAllem(), 's1', 'komp', { rest: { werte: { ratio: 8 }, sc: 2 } });
  p = ok(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'schwelle', wert: -30 }).projekt;
  const r = ok(p, { befehl: 'insert_entfernen', insert_id: 'i1' }); pruefe(p, r);
  assert.ok(!('inserts' in r.projekt.spuren[0]), 'the last stage takes the key with it');
  assert.equal(r.betrifft_wiedergabe, true);
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'ins/komp/1/an', wert: 0 }, { pfad: 'ins/komp/1/schwelle', wert: -18 },
    { pfad: 'ins/komp/1/ratio', wert: 4 }, { pfad: 'ins/komp/1/sc', wert: 0 }]);
  assert.equal(setze(r.projekt, 's2').spuren[1].inserts[0].slot, 1, 'the slot is free again');
  lehntAb(p, { befehl: 'insert_entfernen', insert_id: 'i9' }, 'insert_unbekannt');
  // deleting the strip frees the slots through the same diff
  const t = ok(p, { befehl: 'spur_loeschen', spur_id: 's1' });
  assert.ok(t.regler_aenderungen.some((x) => x.pfad === 'ins/komp/1/an' && x.wert === 0));
  // a stage ID is never reused
  assert.equal(setze(r.projekt, 's1').spuren[0].inserts[0].id, 'i2');
});

test('insert_ordnung: reorder is a structure change (playback), must be a permutation of the chain', () => {
  let p = mitAllem();
  for (let i = 0; i < 3; i++) p = setze(p, 's1', 'komp', { pos: i });
  const r = ok(p, { befehl: 'insert_ordnung', strang_id: 's1', reihenfolge: ['i3', 'i1', 'i2'] }); pruefe(p, r);
  assert.deepEqual(r.projekt.spuren[0].inserts.map((i) => i.id), ['i3', 'i1', 'i2']);
  assert.equal(r.betrifft_wiedergabe, true); assert.deepEqual(r.regler_aenderungen, [], 'slots keep their values');
  lehntAb(p, { befehl: 'insert_ordnung', strang_id: 's1', reihenfolge: ['i3', 'i1'] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_ordnung', strang_id: 's1', reihenfolge: ['i1', 'i1', 'i2'] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_ordnung', strang_id: 's1', reihenfolge: ['i1', 'i2', 'i9'] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_ordnung', strang_id: 's2', reihenfolge: ['i1'] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_ordnung', strang_id: 's9', reihenfolge: [] }, 'spur_unbekannt');
});

test('return_aendern pre: a structure change with no control; absent = post; false removes the key', () => {
  const p = mitAllem();
  const r = ok(p, { befehl: 'return_aendern', return_id: 'r1', pre: true }); pruefe(p, r);
  assert.equal(r.projekt.returns[0].pre, true); assert.equal(r.betrifft_wiedergabe, true); assert.deepEqual(r.regler_aenderungen, []);
  const z = ok(r.projekt, { befehl: 'return_aendern', return_id: 'r1', pre: false }); pruefe(r.projekt, z);
  assert.ok(!('pre' in z.projekt.returns[0])); assert.equal(z.betrifft_wiedergabe, true);
  assert.equal(kanonisch(z.projekt), kanonisch(p), 'back to the old format');
  lehntAb(p, { befehl: 'return_aendern', return_id: 'r1', pre: 'ja' }, 'argument_ungueltig');
  // negative control: another return field does not touch playback
  assert.equal(ok(p, { befehl: 'return_aendern', return_id: 'r1', fader_db: -3 }).betrifft_wiedergabe, false);
});

test('undo of insert_entfernen restores slot and values; redo removes again (AK-S4-11)', (t) => {
  const uhr = { t: 1000 };
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const A = { quelle: 'andreas', label: 'x' };
  let q = aendere(w, mitAllem(), [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'komp' }], A).projekt;
  uhr.t += 5000; q = aendere(w, q, [{ befehl: 'insert_param_setzen', insert_id: 'i2', param: 'ratio', wert: 9 }], A).projekt;
  uhr.t += 5000; q = aendere(w, q, [{ befehl: 'insert_an', insert_id: 'i2', an: false }], A).projekt;
  const voll = q;
  uhr.t += 5000; q = aendere(w, q, [{ befehl: 'insert_entfernen', insert_id: 'i2' }], A).projekt;
  assert.equal(q.spuren[0].inserts.length, 1);
  const u = rueckgaengig(w, q, { quelle: 'andreas' });
  const ohneRev = (x) => ohneAbgeleitetes({ ...x, rev: 0, wiedergabe_rev: 0 });
  assert.equal(ohneRev(u.projekt), ohneRev(voll));
  assert.deepEqual(u.projekt.spuren[0].inserts[1], { id: 'i2', art: 'komp', slot: 2, an: false, werte: { ...DEF, ratio: 9 } });
  assert.ok(u.regler_aenderungen.some((x) => x.pfad === 'ins/komp/2/ratio' && x.wert === 9), 'the values travel back to the pool row');
  assert.ok(u.regler_aenderungen.every((x) => x.pfad !== 'ins/komp/2/an'), 'an stays 0, no change');
});

test('undo of a knob sweep is one step: insert_param_setzen on one parameter within a second coalesces, another parameter or another stage does not (T5 review)', (t) => {
  const uhr = { t: 1000 };
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const A = { quelle: 'andreas', label: 'x' };
  const knopf = (q, id, param, wert) => { uhr.t += 100; return aendere(w, q, [{ befehl: 'insert_param_setzen', insert_id: id, param, wert }], A).projekt; };
  const start = setze(setze(mitAllem(), 's1'), 's1', 'komp', { pos: 1 });
  let q = start;
  uhr.t += 5000;
  for (const v of [-20, -22, -24, -26, -28]) q = knopf(q, 'i1', 'schwelle', v);     // the sweep: five steps
  assert.equal(q.spuren[0].inserts[0].werte.schwelle, -28);
  q = knopf(q, 'i1', 'ratio', 8);                                                      // another parameter: its own step
  q = knopf(q, 'i2', 'ratio', 6);                                                      // another stage: its own step
  const u1 = rueckgaengig(w, q, { quelle: 'andreas' });
  assert.equal(u1.projekt.spuren[0].inserts[1].werte.ratio, DEF.ratio, 'one undo: stage i2 back');
  const u2 = rueckgaengig(w, u1.projekt, { quelle: 'andreas' });
  assert.equal(u2.projekt.spuren[0].inserts[0].werte.ratio, DEF.ratio, 'one undo: ratio of i1 back');
  assert.equal(u2.projekt.spuren[0].inserts[0].werte.schwelle, -28, 'the sweep is still there');
  const u3 = rueckgaengig(w, u2.projekt, { quelle: 'andreas' });
  assert.equal(u3.projekt.spuren[0].inserts[0].werte.schwelle, start.spuren[0].inserts[0].werte.schwelle, 'one undo takes the whole sweep back to where it began');
});

test('AK-S4-17: a lane aimed at an ins/* or rack/* path is refused with a reason that names Slice 5; an unknown target stays ziel_unbekannt', () => {
  const p = setze(mit(1), 's1');
  for (const ziel of ['ins/komp/1/schwelle', 'rack/1/m1', 'insert.schwelle', 'rack.m1']) {
    assert.throws(() => fuehreAus(p, { befehl: 'auto_neu', spur_id: 's1', ziel }), (e) => e instanceof BefehlFehler && e.grund === 'lane_ziel_spaeter' && /Slice 5/.test(e.message), ziel);
  }
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'quatsch/1' }, 'ziel_unbekannt');   // negative control: a target nobody knows
  assert.equal(ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }).projekt.spuren[0].automation.length, 1, 'a real target still works');
  assert.equal(GRUND_TEXT.lane_ziel_spaeter.includes('Slice 5'), true, 'the English text names Slice 5');
});

test('model validation is closed: unknown field, duplicate slot or id, range, 5 stages, bad pre, /1 project', () => {
  const base = setze(setze(mitAllem(), 's1'), 's2');
  const fehler = (mut) => { const x = structuredClone(base); mut(x); return pruefeProjekt(x).fehler; };
  assert.equal(pruefeProjekt(base).fehler, undefined);
  assert.match(fehler((x) => { x.spuren[0].inserts[0].foo = 1; }), /unbekanntes Feld/);
  assert.match(fehler((x) => { x.spuren[1].inserts[0].slot = 1; }), /doppelt/);
  assert.match(fehler((x) => { x.spuren[1].inserts[0].id = 'i1'; }), /doppelt/);
  assert.match(fehler((x) => { x.spuren[0].inserts[0].werte.schwelle = 5; }), /schwelle/);
  assert.match(fehler((x) => { delete x.spuren[0].inserts[0].werte.mix; }), /mix/);
  assert.match(fehler((x) => { x.spuren[0].inserts[0].werte.zzz = 1; }), /zzz/);
  assert.match(fehler((x) => { x.spuren[0].inserts[0].art = 'bk'; }), /art/);
  assert.match(fehler((x) => { x.spuren[0].inserts[0].an = 1; }), /an/);
  assert.match(fehler((x) => { x.spuren[0].inserts[0].slot = 13; }), /slot/);
  assert.match(fehler((x) => { x.spuren[0].inserts[0].sc = 33; }), /sc/);
  assert.match(fehler((x) => { x.spuren[0].inserts = []; }), /inserts/);
  assert.match(fehler((x) => { x.returns[0].pre = false; }), /pre/);
  assert.match(fehler((x) => {
    x.spuren[0].inserts = [1, 2, 3, 4, 5].map((n) => ({ id: `z${n}`, art: 'komp', slot: n + 2, an: true, werte: { ...DEF } }));
  }), /höchstens 4/);
  assert.match(fehler((x) => { x.format = 'cypherdj-projekt/1'; delete x.gruppen; delete x.master; delete x.returns; delete x.naechste_id.return; delete x.spuren[1].inserts; }), /inserts/);
});

test('wiedergabe_traegt_kette: the request holds chain (art, slot, an) per strip and pre per return; /2 is chosen', () => {
  let p = mitAllem();
  p = setze(p, 's1'); p = setze(p, 's1', 'komp', { pos: 1 }); p = setze(p, 'g1'); p = setze(p, 'r1'); p = setze(p, 'master');
  p = ok(p, { befehl: 'insert_an', insert_id: 'i2', an: false }).projekt;
  p = ok(p, { befehl: 'return_aendern', return_id: 'r1', pre: true }).projekt;
  const w = uebersetze(p, { nr: 1, audioOrdner: '/x', frames: () => 1 });
  assert.equal(w.format, 'cypherdj-arr/2');
  // draht-2: the chain flag is structural and always true; the bypass of stage i2 (project an=false) lives in the row ins/komp/2/an only
  assert.deepEqual(w.spuren[0].chain, [{ art: 'komp', slot: 1, an: true }, { art: 'komp', slot: 2, an: true }]);
  assert.equal(w.spuren[1].chain, undefined);
  assert.deepEqual(w.gruppen[0].chain, [{ art: 'komp', slot: 3, an: true }]);
  assert.deepEqual(w.returns[0].chain, [{ art: 'komp', slot: 4, an: true }]); assert.equal(w.returns[0].pre, true);
  assert.deepEqual(w.pm, { chain: [{ art: 'komp', slot: 5, an: true }] });   // draht-1: the kern loader reads `pm`
  assert.equal(w.master, undefined, 'the old key `master` is gone (the loader would ignore it silently)');
  // only a chain on a plain track (no group, no return) still needs /2
  const n = uebersetze(setze(mit(1), 's1'), { nr: 1, audioOrdner: '/x', frames: () => 1 });
  assert.equal(n.format, 'cypherdj-arr/2'); assert.deepEqual(n.spuren[0].chain, [{ art: 'komp', slot: 1, an: true }]);
  // the view: chain structure counts, `an` and the values do not
  const sicht = (x) => kanonisch(wiedergabeSicht(x));
  assert.notEqual(sicht(p), sicht(ok(p, { befehl: 'insert_entfernen', insert_id: 'i1' }).projekt));
  assert.equal(sicht(p), sicht(ok(p, { befehl: 'insert_an', insert_id: 'i1', an: false }).projekt));
  assert.equal(sicht(p), sicht(ok(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'ratio', wert: 3 }).projekt));
});

test('golden: a project without inserts serialises, translates and views byte-identical to the recorded old format', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'hilfen', 'inserts_ohne_golden.json'), 'utf8'));
  const s = szenarioOhneInserts();
  assert.equal(s.kanonisch, golden.kanonisch);
  assert.equal(s.wiedergabe, golden.wiedergabe);
  assert.equal(s.sicht, golden.sicht);
  // negative control of the golden: one stage and the same scenario differs
  assert.notEqual(kanonisch(setze(s.projekt, 's1')), golden.kanonisch);
});

test('merge_inserts: a chain on either track refuses the merge; no chain on both passes', () => {
  const SHA = 'c'.repeat(64);
  const A = { spur_ids: ['s1', 's2'], von_beat: 4, bis_beat: 12 };
  const grund = (f) => { try { f(); } catch (e) { assert.ok(e instanceof MergeFehler, String(e)); return e.grund; } return null; };
  const p = basisProjekt();
  assert.equal(grund(() => mergePlan(p, A, 'andreas')), null, 'negative control: no chain, the merge is planned');
  const eine = setze(p, 's1');
  assert.equal(grund(() => mergePlan(eine, A, 'andreas')), 'merge_inserts', 'chain on the first');
  assert.equal(grund(() => mergePlan(setze(p, 's2'), A, 'andreas')), 'merge_inserts', 'chain on the second');
  assert.equal(grund(() => mergePlan(setze(setze(p, 's1'), 's2'), A, 'andreas')), 'merge_inserts', 'identical chains are refused too');
  assert.equal(grund(() => mergePlan(setze(p, 's3'), A, 'andreas')), null, 'a chain on a track outside the merge does not matter');
  assert.ok(SHA);
});

test('spur_loeschen of the key track drops the key on every stage (no dangling sc, no silent re-binding by a reused number)', () => {
  let p = setze(mitAllem(), 's1', 'komp', { rest: { sc: 2 } });
  p = setze(p, 'master', 'komp', { rest: { sc: 2 } });
  p = setze(p, 's3', 'komp', { rest: { sc: 1 } });   // negative control: a key on another track stays (own number as key is refused since 1.10 T1, D13)
  const r = ok(p, { befehl: 'spur_loeschen', spur_id: 's2' }); pruefe(p, r);
  const ins = (q) => [q.spuren.find((s) => s.id === 's1').inserts[0], q.master.inserts[0], q.spuren.find((s) => s.id === 's3').inserts[0]];
  const [a, m, c] = ins(r.projekt);
  assert.ok(!('sc' in a), 'track stage: key dropped'); assert.ok(!('sc' in m), 'master stage: key dropped'); assert.equal(c.sc, 1, 'other key kept');
  const reset = r.regler_aenderungen.filter((x) => x.pfad.endsWith('/sc'));
  assert.deepEqual(reset.map((x) => x.wert), [0, 0], JSON.stringify(reset));
  // a new track taking the freed number is not keyed
  const n = ok(r.projekt, { befehl: 'spur_neu', art: 'audio', name: 'N' }).projekt;
  assert.ok(n.spuren.some((s) => s.nr === 2));
  assert.ok(!('sc' in ins(n)[0]));
  // negative control: deleting a track nobody keys on emits no sc row
  const harmlos = ok(setze(mitAllem(), 's1', 'komp', { rest: { sc: 3 } }), { befehl: 'spur_loeschen', spur_id: 's2' });
  assert.deepEqual(harmlos.regler_aenderungen.filter((x) => x.pfad.endsWith('/sc')), []);
});

test('loader: a sidechain key on a track number that does not exist is refused, like the command does (review vertrag-2)', () => {
  const p = mitAllem();
  const r = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', sc: 2 });
  assert.equal(pruefeProjekt(r.projekt).fehler, undefined, 'positive control: a key on an existing track loads');
  const q = structuredClone(r.projekt);
  q.spuren[0].inserts[0].sc = 7;
  assert.match(pruefeProjekt(q).fehler ?? '', /sc: Spur 7 existiert nicht/);
});

// ---- 1.10 slice 4b T12: the eq and saett stages ------------------------------------------------------------------------------------------------
const EQ_ZEILEN = INSERT_ARTEN.eq.parameter.filter((q) => q.name !== 'an');
test('4b: limits - the eq and saett pools are the measured sizes (T11), the project accepts both kinds', () => {
  assert.equal(MAX_INS_EQ, 2, 'eq pool 2, measured 2026-11-06');
  assert.equal(MAX_INS_SAETT, 1);
  assert.equal(EQ_ZEILEN.length, 58, 'out, propq and 8 x 7 band rows');
});

test('4b: insert_setzen eq: defaults from the contract, a band parameter travels as ins/eq/1/b3/gain, `an` last; saett likewise', () => {
  const p = mit(1);
  const e = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq' }); pruefe(p, e);
  assert.equal(e.projekt.spuren[0].inserts[0].art, 'eq');
  assert.equal(Object.keys(e.projekt.spuren[0].inserts[0].werte).length, 58);
  assert.equal(e.projekt.spuren[0].inserts[0].sc, undefined, 'only the compressor has a key');
  assert.deepEqual(e.regler_aenderungen, [{ pfad: 'ins/eq/1/an', wert: 1 }], 'defaults equal the pool defaults: only `an` differs');
  const w = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: { 'b3/gain': 6, 'b3/an': 1, out: -3 } });
  const pf = w.regler_aenderungen.map((x) => x.pfad);
  assert.equal(pf.at(-1), 'ins/eq/1/an', 'the switch of the stage is last');
  assert.deepEqual(new Set(pf), new Set(['ins/eq/1/out', 'ins/eq/1/b3/an', 'ins/eq/1/b3/gain', 'ins/eq/1/an']));
  const s = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'saett', werte: { drive: 20 } });
  assert.deepEqual(s.regler_aenderungen, [{ pfad: 'ins/saett/1/drive', wert: 20 }, { pfad: 'ins/saett/1/an', wert: 1 }]);
  // negative control: the compressor next to it still behaves as in 4a
  assert.deepEqual(ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }).regler_aenderungen, [{ pfad: 'ins/komp/1/an', wert: 1 }]);
});

test('4b: refusals - range, integer steps, unknown name, key on a non-compressor, pool full (ins_voll) with the stage next to it accepted', () => {
  const p = mit(2);
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: { 'b1/gain': 25 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: { 'b1/typ': 7 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: { 'b1/typ': 1.5 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: { 'b9/gain': 1 } }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: { schwelle: -10 } }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', sc: 2 }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'saett', werte: { drive: 37 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'saett', sc: 2 }, 'argument_unbekannt');
  assert.equal(ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: { 'b1/gain': 24, 'b1/typ': 6 } }).projekt.spuren[0].inserts.length, 1, 'negative control: the edges are accepted');
  // the pool of two: a second eq is accepted, a third anywhere is ins_voll, a saett next to it is not (the kinds count separately)
  const q = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq' }).projekt;
  const q2 = ok(q, { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'eq' });
  assert.ok(q2.regler_aenderungen.some((c) => c.pfad === 'ins/eq/2/an' && c.wert === 1), 'the second eq takes slot 2');
  lehntAb(q2.projekt, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'eq' }, 'ins_voll');
  assert.equal(ok(q2.projekt, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'saett' }).projekt.spuren[0].inserts.length, 2);
  // insert_param_setzen: eq band parameter ok, sc on an eq refused, unknown refused
  const id = q.spuren[0].inserts[0].id;
  assert.deepEqual(ok(q, { befehl: 'insert_param_setzen', insert_id: id, param: 'b2/freq', wert: 123 }).regler_aenderungen, [{ pfad: 'ins/eq/1/b2/freq', wert: 123 }]);
  lehntAb(q, { befehl: 'insert_param_setzen', insert_id: id, param: 'sc', wert: 1 }, 'argument_unbekannt');
  lehntAb(q, { befehl: 'insert_param_setzen', insert_id: id, param: 'b2/freq', wert: 5 }, 'argument_ungueltig');
  lehntAb(q, { befehl: 'insert_param_setzen', insert_id: id, param: 'b9/freq', wert: 500 }, 'argument_unbekannt');
});

test('4b T13: eq and saett may sit on several strips (the delay compensation of the core aligns them); the temporary refusal pdc_fehlt is gone', () => {
  const p = mit(3);
  const a = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq' }).projekt;
  const b = ok(a, { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'saett' }).projekt;
  assert.equal(b.spuren[0].inserts.length, 1);
  assert.equal(b.spuren[1].inserts.length, 1);
  assert.equal(ok(b, { befehl: 'insert_setzen', strang_id: 's3', pos: 0, art: 'komp' }).projekt.spuren[2].inserts.length, 1, 'a compressor on a third strip');
  assert.equal(GRUND_TEXT.pdc_fehlt, undefined, 'the reason text is removed with the refusal');
});

test('4b: leicht path equals general path for an eq band change; undo of a removed eq restores slot and values and resets through controls', () => {
  const p = mit(1);
  const e = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: { 'b2/gain': 5, 'b2/an': 1 } }).projekt;
  const id = e.spuren[0].inserts[0].id;
  gleichLeichtVoll(e, { befehl: 'insert_param_setzen', insert_id: id, param: 'b2/gain', wert: -4 });
  gleichLeichtVoll(e, { befehl: 'insert_an', insert_id: id, an: false });
  const x = ok(e, { befehl: 'insert_entfernen', insert_id: id });
  assert.equal(x.projekt.spuren[0].inserts, undefined);
  assert.equal(x.regler_aenderungen[0].pfad, 'ins/eq/1/an', 'a removed stage switches off first');
  assert.ok(x.regler_aenderungen.some((c) => c.pfad === 'ins/eq/1/b2/gain' && c.wert === 0), 'and resets its values to the pool defaults');
  assert.ok(x.regler_aenderungen.every((c) => c.pfad.startsWith('ins/eq/1/')));
});

test('4b: model validation - eq values are closed to the kind (a compressor name on an eq, a missing band row, an sc on a saett)', () => {
  const p = ok(mit(1), { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq' }).projekt;
  assert.equal(pruefeProjekt(p).fehler, undefined);
  const mut = (f) => { const c = JSON.parse(JSON.stringify(p)); f(c.spuren[0].inserts[0]); return pruefeProjekt(c).fehler; };
  assert.ok(mut((i) => { i.werte.schwelle = -10; }), 'a compressor name');
  assert.ok(mut((i) => { delete i.werte['b8/platz']; }), 'a missing band row');
  assert.ok(mut((i) => { i.werte['b1/typ'] = 9; }), 'out of range');
  assert.ok(mut((i) => { i.sc = 2; }), 'a key on an eq');
  assert.equal(mut((i) => { i.slot = 2; }), undefined, 'slot 2 is inside the pool of two');
  assert.ok(mut((i) => { i.slot = 3; }), 'slot beyond the pool of two');
  assert.ok(mut((i) => { i.art = 'saett'; }), 'saett with eq values');
});

// ---------- package 1.16 rest U2: preset origin on a stage and insert_werte_setzen (C3: written against `sc`, no 1.10 key object on the base) ----------
const ID = 'werk:komp/drum-bus';
test('insert preset: insert_setzen takes an optional preset id; the file check accepts it; a malformed id is refused', () => {
  const p = mit(1);
  const r = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { ratio: 4 }, preset: ID }); pruefe(p, r);
  assert.deepEqual(r.projekt.spuren[0].inserts[0], { id: 'i1', art: 'komp', slot: 1, an: true, werte: { ...DEF, ratio: 4 }, preset: ID });
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', preset: 'werk:komp' }, 'argument_ungueltig');
  const f = structuredClone(r.projekt); f.spuren[0].inserts[0].preset = 'x:komp/a';
  assert.ok('fehler' in pruefeProjekt(f));
  assert.equal('preset' in setze(p, 's1').spuren[0].inserts[0], false, 'negative control: no preset given, no key');
});

test('insert_werte_setzen: partial values with the insert_setzen ranges, preset set or cleared with null; never touches an or sc; refusals', () => {
  let p = mit(2);
  p = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', sc: 2 }).projekt;
  p = ok(p, { befehl: 'insert_an', insert_id: 'i1', an: false }).projekt;
  const r = ok(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -30, mix: 0.5 }, preset: ID }); pruefe(p, r);
  assert.deepEqual(r.projekt.spuren[0].inserts[0], { id: 'i1', art: 'komp', slot: 1, an: false, werte: { ...DEF, schwelle: -30, mix: 0.5 }, sc: 2, preset: ID });
  const weg = ok(r.projekt, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: {}, preset: null }); pruefe(r.projekt, weg);
  assert.equal('preset' in weg.projekt.spuren[0].inserts[0], false);
  assert.deepEqual(weg.projekt.spuren[0].inserts[0].werte, r.projekt.spuren[0].inserts[0].werte);
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -61 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { ratio: 21 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { an: 1 } }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { sc: 1 } }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: {} }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { ratio: 2 }, preset: 'nope' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { ratio: 2 }, an: true }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i9', werte: { ratio: 2 } }, 'insert_unbekannt');
  // negative control: edge values of the range pass
  assert.equal(ok(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -60, ratio: 20 } }).projekt.spuren[0].inserts[0].werte.ratio, 20);
});

test('insert_werte_setzen core effect: no new playback, exactly one control per changed value, a preset-only change sends nothing', () => {
  const p = setze(mit(1), 's1');
  const r = ok(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -30, ratio: 4, mix: 0.5 }, preset: ID });
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'ins/komp/1/schwelle', wert: -30 }, { pfad: 'ins/komp/1/mix', wert: 0.5 }], 'ratio 4 equals the old value: not sent');
  const nur = ok(r.projekt, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: {}, preset: 'werk:komp/bus-glue' });
  assert.equal(nur.betrifft_wiedergabe, false);
  assert.deepEqual(nur.regler_aenderungen, []);
  gleichLeichtVoll(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -30 }, preset: ID });
});

test('preset_nicht_in_sicht: a stage preset and a device preset are not part of the playback view', () => {
  const p = setze(mit(1), 's1');
  const r = ok(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: {}, preset: ID });
  assert.equal(kanonisch(wiedergabeSicht(r.projekt)), kanonisch(wiedergabeSicht(p)));
  let q = ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.3 } } }).projekt;
  const d = ok(q, { befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.3 }, preset: 'werk:rb338/dark-dub' } });
  assert.equal(d.betrifft_wiedergabe, false, 'adding only geraet.preset needs no new playback');
  assert.equal(kanonisch(wiedergabeSicht(d.projekt)), kanonisch(wiedergabeSicht(q)));
});

test('undo of insert_werte_setzen restores the values and the preset field; merge_inserts still refuses a stage with a preset', (t) => {
  const uhr = { t: 1000 };
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const A = { quelle: 'andreas', label: 'x' };
  let q = aendere(w, mit(1), [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', preset: 'werk:komp/bus-glue' }], A).projekt;
  const vorher = structuredClone(q.spuren[0].inserts[0]);
  uhr.t += 5000; q = aendere(w, q, [{ befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -40, knie: 0 }, preset: ID }], A).projekt;
  assert.equal(q.spuren[0].inserts[0].preset, ID);
  const u = rueckgaengig(w, q, { quelle: 'andreas' });
  assert.deepEqual(u.projekt.spuren[0].inserts[0], vorher);
  const m = setze(basisProjekt(), 's2');
  const mp = ok(m, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: {}, preset: ID }).projekt;
  assert.throws(() => mergePlan(mp, { spur_ids: ['s1', 's2'], von_beat: 4, bis_beat: 12 }, 'andreas'), (e) => e instanceof MergeFehler && e.grund === 'merge_inserts');
});

// ---------- integration of 1.16 rest (insert_werte_setzen, written against the compressor only) with 1.10 slice 4b/4c (eq, saett, rack) ----------
test('integration: insert_werte_setzen on an eq and a saett stage takes the names, ranges and steps of that kind; one control per changed value', () => {
  let p = mit(1);
  p = setze(p, 's1', 'eq'); p = setze(p, 's1', 'saett', { pos: 1 });
  const eq = ok(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { 'b3/gain': 6, 'b3/typ': 2, out: -3 }, preset: ID }); pruefe(p, eq);
  assert.equal(eq.projekt.spuren[0].inserts[0].werte['b3/gain'], 6);
  assert.equal(eq.projekt.spuren[0].inserts[0].preset, ID);
  assert.equal(eq.betrifft_wiedergabe, false);
  assert.deepEqual(new Set(eq.regler_aenderungen.map((x) => x.pfad)), new Set(['ins/eq/1/b3/gain', 'ins/eq/1/b3/typ', 'ins/eq/1/out']));
  const sa = ok(p, { befehl: 'insert_werte_setzen', insert_id: 'i2', werte: { drive: 20, mix: 0.5 } }); pruefe(p, sa);
  assert.deepEqual(sa.regler_aenderungen, [{ pfad: 'ins/saett/1/drive', wert: 20 }, { pfad: 'ins/saett/1/mix', wert: 0.5 }]);
  gleichLeichtVoll(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { 'b3/gain': 6 }, preset: ID });
  // refusals of the kind: a compressor name on an eq, a band out of range, a step value that is no integer; `an` and `sc` stay out
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -10 } }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { 'b1/gain': 25 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { 'b1/typ': 1.5 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { an: 1 } }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i2', werte: { sc: 1 } }, 'argument_unbekannt');
  // negative control: the compressor still takes its own names, and the edge of the eq range passes
  assert.equal(ok(setze(mit(1), 's1'), { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -30 } }).projekt.spuren[0].inserts[0].werte.schwelle, -30);
  assert.equal(ok(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { 'b1/gain': 24, 'b1/typ': 6 } }).projekt.spuren[0].inserts[0].werte['b1/typ'], 6);
});

test('integration: insert_werte_setzen refuses a value a rack macro drives (param_gemappt, as insert_param_setzen does); other values of the stage pass', () => {
  let p = setze(mit(1), 's1', 'eq');
  p = ok(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'b2/gain', von: -6, bis: 6 }] }] }).projekt;
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'b2/gain', wert: 1 }, 'param_gemappt');   // the rule the new command must follow
  lehntAb(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { 'b2/gain': 1, out: -3 } }, 'param_gemappt');
  const frei = ok(p, { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { 'b3/gain': 1, out: -3 } });   // negative control: no mapped value in it
  assert.equal(frei.projekt.spuren[0].inserts[0].werte.out, -3);
});

// ---------- defect of 1.10 slice 4b found by the integration: eq band rows are named 'b3/gain', a patch path split at every '/' could not address them ----------
test('integration: a change of an eq band row (name with a slash) round-trips through the patches, the general and the light path, and through undo and redo', (t) => {
  const p = setze(mit(1), 's1', 'eq');
  for (const b of [{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'b3/gain', wert: 6 },
    { befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { 'b2/freq': 123, 'b2/typ': 2, out: -3 } }]) {
    const r = ok(p, b); pruefe(p, r);   // forward and back patch apply and restore
    gleichLeichtVoll(p, b);             // the fast path writes the same patches
  }
  const uhr = { t: 1000 };
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo-eq.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const A = { quelle: 'andreas', label: 'x' };
  let q = aendere(w, p, [{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'b3/gain', wert: 6 }], A).projekt;
  assert.equal(q.spuren[0].inserts[0].werte['b3/gain'], 6);
  const u = rueckgaengig(w, q, { quelle: 'andreas' });
  assert.equal(u.projekt.spuren[0].inserts[0].werte['b3/gain'], p.spuren[0].inserts[0].werte['b3/gain'], 'undo restores the band gain');
  // negative control: a row without a slash (the compressor) takes the same way
  const k = setze(mit(1), 's1');
  pruefe(k, ok(k, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'schwelle', wert: -30 }));
});

// ---- limiter kind (master limiter, task 2): lim, pool 1, no key, no preset -----------------------------------------------------------------------
test('lim: the pool is 1 and the kind is accepted', () => {
  assert.equal(MAX_INS_LIM, 1);
});

test('lim: insert_setzen on the master without values gives only the switch; with decke the value row comes first, `an` last', () => {
  const p = mit(1);
  const a = ok(p, { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'lim' });
  assert.deepEqual(a.regler_aenderungen, [{ pfad: 'ins/lim/1/an', wert: 1 }]);
  pruefe(p, a);
  const b = ok(p, { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'lim', werte: { decke: -3 } });
  assert.deepEqual(b.regler_aenderungen, [{ pfad: 'ins/lim/1/decke', wert: -3 }, { pfad: 'ins/lim/1/an', wert: 1 }]);
});

test('lim: ranges (decke -60..0, abklingen 1..2000), unknown names and no key; the edges are accepted', () => {
  const p = mit(1);
  const lim = (extra) => ({ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'lim', ...extra });
  lehntAb(p, lim({ werte: { decke: -60.1 } }), 'argument_ungueltig');
  lehntAb(p, lim({ werte: { decke: 0.1 } }), 'argument_ungueltig');
  lehntAb(p, lim({ werte: { abklingen: 0.5 } }), 'argument_ungueltig');
  lehntAb(p, lim({ werte: { schwelle: -10 } }), 'argument_unbekannt');
  lehntAb(p, lim({ sc: 2 }), 'argument_unbekannt');
  for (const werte of [{ decke: -60 }, { decke: 0 }, { abklingen: 1 }, { abklingen: 2000 }]) {
    assert.equal(ok(p, lim({ werte })).projekt.spuren[0].inserts.length, 1, `negative control: ${JSON.stringify(werte)} is accepted`);
  }
});

test('lim: the pool of one counts over the whole project; a compressor next to it is fine', () => {
  const p = ok(mit(2), { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'lim' }).projekt;
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'lim' }, 'ins_voll');
  assert.equal(ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }).projekt.spuren[0].inserts.length, 1);
});

test('lim: model validation - slot 1 passes, slot 2 is beyond the pool', () => {
  const p = ok(mit(1), { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'lim' }).projekt;
  assert.equal(pruefeProjekt(p).fehler, undefined);
  const c = JSON.parse(JSON.stringify(p)); c.spuren[0].inserts[0].slot = 2;
  assert.ok(pruefeProjekt(c).fehler, 'slot 2 of a pool of one');
});

test('lim: a project without a limiter still sets the three lim rows at the defaults with the switch off', async () => {
  const { alleInsertRegler } = await import('../areas/proj/mapping.ts');
  const rows = alleInsertRegler(neuesProjekt('N')).filter((r) => r.pfad.startsWith('ins/lim/'));
  assert.deepEqual(rows, [{ pfad: 'ins/lim/1/decke', wert: -1 }, { pfad: 'ins/lim/1/abklingen', wert: 80 }, { pfad: 'ins/lim/1/an', wert: 0 }]);
});
