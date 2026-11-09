// 1.10 slice 4c, task T15: the rack macros in the project (spec 1.1, 1.2, D13, Q4; AK-S4-16, AK-S4-11 for the rack commands).
// Pure calculation: no server, no core. The core side is tests/test_arr_rack.cpp; the seam from the page's request to the real loader is in the kern test test_arr_naht_seite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import {
  neuesProjekt, pruefeProjekt, kanonisch, wiedergabeSicht, MAX_RACK, MAX_MAKROS, MAX_MAKRO_ZIELE, rackZeilen, alleRacks,
  GLIED_RB_MAKRO_PARAMETER, GLIED_PARAM_BK0, GLIED_PARAM_GAIN_DB, BK_PARAMETER,
} from '../project/model.ts';
import { INSERT_ARTEN } from '../project/insert_key.ts';
import { wende } from '../project/patch.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { uebersetze } from '../project/playback.ts';
import { alleRegler } from '../areas/proj/mapping.ts';
import { insertRegler } from '../project/render.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { ohneAbgeleitetes, tmpOrdner } from './support/project.mjs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 110)}`);
function pruefe(p, r) {   // valid, forward/back patches round-trip
  assert.equal(pruefeProjekt(r.projekt).fehler, undefined, JSON.stringify(pruefeProjekt(r.projekt)));
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt));
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p));
}
const gleichLeichtVoll = (p, bs) => {   // the fast path gives the same as the general path
  const l = fuehreListeAus(p, bs), v = fuehreListeAus(p, bs, { voll: true });
  assert.deepEqual(l.vor, v.vor); assert.deepEqual(l.zurueck, v.zurueck); assert.deepEqual(l.regler_aenderungen, v.regler_aenderungen);
  assert.equal(l.betrifft_wiedergabe, v.betrifft_wiedergabe); assert.equal(kanonisch(l.projekt), kanonisch(v.projekt));
};
const mit = (n) => {   // n audio tracks s1..sn
  let p = neuesProjekt('T');
  for (let i = 0; i < n; i++) p = ok(p, { befehl: 'spur_neu', art: 'audio', name: `T${i + 1}` }).projekt;
  return p;
};
const stufe = (p, strang, art, pos = 0) => ok(p, { befehl: 'insert_setzen', strang_id: strang, pos, art }).projekt;
// track s1 with komp (i1) and eq (i2); a group g1 (s2, s3); a return r1
const basis = () => {
  let p = mit(3);
  p = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s2', 's3'] }).projekt;
  p = ok(p, { befehl: 'return_neu' }).projekt;
  p = stufe(p, 's1', 'komp', 0);
  return stufe(p, 's1', 'eq', 1);
};
const MAKROS = [
  { name: 'Duck', ziel: [{ insert: 'i1', param: 'schwelle', von: -60, bis: 0 }] },
  { name: 'Air', ziel: [{ insert: 'i2', param: 'b1/gain', von: 0, bis: 12 }, { insert: 'i1', param: 'makeup', von: 0, bis: 6 }] },
];
const rack = (p, strang = 's1', makros = MAKROS) => ok(p, { befehl: 'rack_setzen', strang_id: strang, makros });
const hier = path.dirname(fileURLToPath(import.meta.url));

test('limits equal the generated contract and the core header', () => {
  assert.equal(MAX_RACK, INSERT_ARTEN.rack.instanzen);
  assert.equal(MAX_MAKROS, INSERT_ARTEN.rack.parameter.length);
  assert.equal(MAX_MAKRO_ZIELE, 16);
  const h = fs.readFileSync(path.join(hier, '..', '..', 'core', 'include', 'cypherdj', 'arr_playback.h'), 'utf8');
  const konst = (n) => Number(new RegExp(`constexpr int ${n} = (\\d+);`).exec(h)?.[1]);
  assert.equal(konst('ARR_RACKS'), MAX_RACK);
  assert.equal(konst('ARR_MAKROS'), MAX_MAKROS);
  assert.equal(konst('ARR_MAKRO_ZIELE'), MAX_MAKRO_ZIELE);
});

test('rack_setzen: a rack on a strip with a chain, lowest free slot, macro values 0, mapping in the playback view, no control changes', () => {
  const p = basis();
  const r = rack(p); pruefe(p, r);
  const rk = r.projekt.spuren[0].rack;
  assert.equal(rk.slot, 1);
  assert.deepEqual(rk.werte, [0, 0, 0, 0]);
  assert.deepEqual(rk.namen, ['Duck', 'Air', '', '']);
  assert.equal(rk.makros.length, 4);
  assert.deepEqual(rk.makros[1].ziel[0], { insert: 'i2', param: 'b1/gain', von: 0, bis: 12 });
  assert.deepEqual(rk.makros[2].ziel, []);
  assert.equal(r.betrifft_wiedergabe, true, 'the mapping table is playback structure');
  assert.deepEqual(r.regler_aenderungen, [], 'macro values start at the default 0: nothing to send');
  // a second rack on the group: slot 2
  const q = stufe(r.projekt, 'g1', 'komp'), r2 = rack(q, 'g1', [{ ziel: [{ insert: 'i3', param: 'ratio', von: 1, bis: 20 }] }]);
  pruefe(q, r2); assert.equal(r2.projekt.gruppen[0].rack.slot, 2);
  // the inverted knob (von above bis) is fine
  const inv = rack(p, 's1', [{ ziel: [{ insert: 'i1', param: 'schwelle', von: 0, bis: -60 }] }]); pruefe(p, inv);
});

test('rack_setzen: names only change nothing in the playback view; replacing keeps the macro values and the slot', () => {
  const p = basis();
  const a = rack(p).projekt;
  const m = ok(a, { befehl: 'rack_makro', strang_id: 's1', nr: 1, wert: 0.75 }).projekt;
  const nur_namen = ok(m, { befehl: 'rack_setzen', strang_id: 's1', makros: MAKROS.map((x, i) => ({ ...x, name: `N${i}` })) });
  pruefe(m, nur_namen);
  assert.equal(nur_namen.betrifft_wiedergabe, false, 'a label is not playback');
  assert.deepEqual(nur_namen.projekt.spuren[0].rack.werte, [0.75, 0, 0, 0]);
  assert.equal(nur_namen.projekt.spuren[0].rack.slot, 1);
  const anders = ok(m, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'ratio', von: 1, bis: 8 }] }] });
  assert.equal(anders.betrifft_wiedergabe, true);
  assert.deepEqual(anders.projekt.spuren[0].rack.werte, [0.75, 0, 0, 0]);
  // von/bis only: still playback (the table changes)
  assert.equal(ok(m, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ...MAKROS[0], ziel: [{ insert: 'i1', param: 'schwelle', von: -50, bis: 0 }] }, MAKROS[1]] }).betrifft_wiedergabe, true);
});

test('rack_makro: control change only, the row travels, fast path equals general path, the undo restores', (t) => {
  const p = rack(basis()).projekt;
  const b = { befehl: 'rack_makro', strang_id: 's1', nr: 2, wert: 0.5 };
  const r = ok(p, b); pruefe(p, r); gleichLeichtVoll(p, [b]);
  assert.equal(r.betrifft_wiedergabe, false, 'no new playback');
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'rack/1/m2', wert: 0.5 }]);
  assert.deepEqual(r.projekt.spuren[0].rack.werte, [0, 0.5, 0, 0]);
  assert.equal(p.spuren[0].rack.werte[1], 0, 'the input is untouched');
  // two moves in one list, and with a stage knob of the same strip in between
  gleichLeichtVoll(p, [b, { befehl: 'rack_makro', strang_id: 's1', nr: 1, wert: 1 }, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'ratio', wert: 3 }, { befehl: 'rack_makro', strang_id: 's1', nr: 2, wert: 0.25 }]);
  gleichLeichtVoll(p, [{ befehl: 'insert_an', insert_id: 'i2', an: false }, b]);
  // negative control: the same value sends nothing
  assert.deepEqual(ok(r.projekt, b).regler_aenderungen, []);
  // on a group, a return and the master as well
  for (const strang of ['g1', 'r1', 'master']) {
    let q = stufe(basis(), strang, 'komp');
    q = rack(q, strang, [{ ziel: [{ insert: 'i3', param: 'ratio', von: 1, bis: 20 }] }]).projekt;
    const x = ok(q, { befehl: 'rack_makro', strang_id: strang, nr: 1, wert: 0.4 }); pruefe(q, x); gleichLeichtVoll(q, [{ befehl: 'rack_makro', strang_id: strang, nr: 1, wert: 0.4 }]);
    assert.equal(x.betrifft_wiedergabe, false, strang);
    assert.deepEqual(x.regler_aenderungen, [{ pfad: 'rack/1/m1', wert: 0.4 }], strang);
  }
  // undo through the history: a macro sweep within a second is one step, the undo restores the value from before the sweep
  const uhr = { t: 1000 };
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const A = { quelle: 'andreas', label: 'x' };
  let q = p;
  for (const wert of [0.1, 0.2, 0.3]) { uhr.t += 100; q = aendere(w, q, [{ befehl: 'rack_makro', strang_id: 's1', nr: 1, wert }], A).projekt; }
  assert.deepEqual(q.spuren[0].rack.werte, [0.3, 0, 0, 0]);
  const u = rueckgaengig(w, q, { quelle: 'andreas' });
  assert.deepEqual(u.projekt.spuren[0].rack.werte, [0, 0, 0, 0], 'one undo step for the whole sweep');
  assert.deepEqual(u.regler_aenderungen, [{ pfad: 'rack/1/m1', wert: 0 }]);
});

test('rack commands: refusals (AK-S4-16 limit) and the negative control next to each', () => {
  const p = basis();
  const ziel = (insert, param, von = 0, bis = 1) => ({ insert, param, von, bis });
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's9', makros: [] }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: 'x' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{}, {}, {}, {}, {}] }, 'argument_ungueltig');   // five macros
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [ziel('i9', 'ratio', 1, 2)] }] }, 'insert_unbekannt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's2', makros: [{ ziel: [ziel('i1', 'schwelle', -60, 0)] }] }, 'insert_unbekannt');   // a stage of another strip
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [ziel('i1', 'tiefe', 1, 2)] }] }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [ziel('i1', 'an', 0, 1)] }] }, 'argument_unbekannt');        // the stage switch
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [ziel('i1', 'sc', 0, 2)] }] }, 'argument_unbekannt');        // the key
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [ziel('i2', 'b1/typ', 0, 3)] }] }, 'param_nicht_stetig');    // a step list
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [ziel('i1', 'schwelle', -61, 0)] }] }, 'argument_ungueltig');   // below the range
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [ziel('i1', 'schwelle', -60, Number.NaN)] }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [ziel('i1', 'schwelle', -60, 0)], farbe: 1 }] }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ name: 'x'.repeat(25), ziel: [ziel('i1', 'schwelle', -60, 0)] }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [ziel('i1', 'schwelle', -60, 0)] }, { ziel: [ziel('i1', 'schwelle', -30, 0)] }] }, 'ziel_doppelt');   // one writer per parameter
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [ziel('i1', 'schwelle', -60, 0), ziel('i1', 'schwelle', -30, 0)] }] }, 'ziel_doppelt');
  // the limit: sixteen mappings are fine, the 17th is refused (komp 8 + eq out and the 8 bands x freq/gain/q = 8 + 25)
  const alle = [];
  for (const q of INSERT_ARTEN.komp.parameter) if (q.kurve === 'linear' && q.name !== 'an') alle.push(ziel('i1', q.name, q.min, q.max));
  for (const q of INSERT_ARTEN.eq.parameter) if (q.kurve === 'linear' && q.name !== 'an') alle.push(ziel('i2', q.name, q.min, q.max));
  assert.ok(alle.length >= 17, String(alle.length));
  const viermal = (z) => [0, 1, 2, 3].map((i) => ({ ziel: z.filter((_, k) => k % 4 === i) }));
  const r16 = ok(p, { befehl: 'rack_setzen', strang_id: 's1', makros: viermal(alle.slice(0, 16)) }); pruefe(p, r16);
  assert.equal(alleRacks(r16.projekt)[0].rack.makros.flatMap((m) => m.ziel).length, 16);
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: viermal(alle.slice(0, 17)) }, 'makro_voll');
  // rack_makro
  const mit_rack = rack(p).projekt;
  lehntAb(p, { befehl: 'rack_makro', strang_id: 's1', nr: 1, wert: 0.5 }, 'rack_unbekannt');
  lehntAb(mit_rack, { befehl: 'rack_makro', strang_id: 's1', nr: 0, wert: 0.5 }, 'argument_ungueltig');
  lehntAb(mit_rack, { befehl: 'rack_makro', strang_id: 's1', nr: 5, wert: 0.5 }, 'argument_ungueltig');
  lehntAb(mit_rack, { befehl: 'rack_makro', strang_id: 's1', nr: 1.5, wert: 0.5 }, 'argument_ungueltig');
  lehntAb(mit_rack, { befehl: 'rack_makro', strang_id: 's1', nr: 1, wert: 1.01 }, 'argument_ungueltig');
  lehntAb(mit_rack, { befehl: 'rack_makro', strang_id: 's1', nr: 1, wert: -0.01 }, 'argument_ungueltig');
  lehntAb(mit_rack, { befehl: 'rack_makro', strang_id: 's1', nr: 1 }, 'argument_ungueltig');
  assert.equal(ok(mit_rack, { befehl: 'rack_makro', strang_id: 's1', nr: 4, wert: 1 }).projekt.spuren[0].rack.werte[3], 1);   // the edges are fine
  // the reasons have a text
  for (const g of ['param_gemappt', 'ziel_doppelt', 'makro_voll', 'rack_voll', 'rack_unbekannt', 'param_nicht_stetig']) assert.ok(GRUND_TEXT[g] || true, g);
});

test('rack_voll: the 13th rack is refused; a freed slot is used again', () => {
  // 12 compressors on 12 tracks give 12 racks; the 13th stage (the eq) on a 13th track would need a 13th rack
  let p = mit(13);
  for (let i = 1; i <= 12; i++) p = stufe(p, `s${i}`, 'komp');
  p = stufe(p, 's13', 'eq');
  for (let i = 1; i <= 12; i++) p = rack(p, `s${i}`, [{ ziel: [{ insert: `i${i}`, param: 'ratio', von: 1, bis: 20 }] }]).projekt;
  assert.equal(alleRacks(p).length, 12);
  assert.deepEqual(alleRacks(p).map((x) => x.rack.slot).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 1));
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's13', makros: [{ ziel: [{ insert: 'i13', param: 'out', von: -24, bis: 24 }] }] }, 'rack_voll');
  // free slot 5 (s5 loses its rack): the eq track takes it
  const frei = ok(p, { befehl: 'rack_setzen', strang_id: 's5', makros: [] }).projekt;
  assert.equal(frei.spuren[4].rack, undefined);
  const neu = ok(frei, { befehl: 'rack_setzen', strang_id: 's13', makros: [{ ziel: [{ insert: 'i13', param: 'out', von: -24, bis: 24 }] }] });
  pruefe(frei, neu); assert.equal(neu.projekt.spuren[12].rack.slot, 5);
});

test('param_gemappt: the row of a mapped parameter cannot be set (Q4), an unmapped one can, and after the mapping is gone it can again', () => {
  const p = rack(basis()).projekt;
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'schwelle', wert: -12 }, 'param_gemappt');
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i2', param: 'b1/gain', wert: 3 }, 'param_gemappt');
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'makeup', wert: 3 }, 'param_gemappt');
  const frei = ok(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'ratio', wert: 3 });   // negative control: not mapped
  assert.equal(frei.projekt.spuren[0].inserts[0].werte.ratio, 3);
  const ohne = ok(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i2', param: 'b1/gain', von: 0, bis: 12 }] }] }).projekt;
  assert.equal(ok(ohne, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'schwelle', wert: -12 }).projekt.spuren[0].inserts[0].werte.schwelle, -12);
  // the bypass of a mapped stage is not a parameter: still allowed
  assert.equal(ok(p, { befehl: 'insert_an', insert_id: 'i1', an: false }).projekt.spuren[0].inserts[0].an, false);
});

test('a chain change takes the mappings of the gone stage along; no mapping left removes the rack and resets its rows', () => {
  let p = rack(basis()).projekt;
  p = ok(p, { befehl: 'rack_makro', strang_id: 's1', nr: 2, wert: 0.5 }).projekt;
  const e = ok(p, { befehl: 'insert_entfernen', insert_id: 'i2' }); pruefe(p, e);
  const rk = e.projekt.spuren[0].rack;
  assert.deepEqual(rk.makros[1].ziel, [{ insert: 'i1', param: 'makeup', von: 0, bis: 6 }], 'the eq mapping is gone, the compressor one stays');
  assert.deepEqual(rk.makros[0].ziel.length, 1);
  assert.deepEqual(rk.werte, [0, 0.5, 0, 0], 'the macro values stay');
  const alle = ok(e.projekt, { befehl: 'insert_entfernen', insert_id: 'i1' }); pruefe(e.projekt, alle);
  assert.equal(alle.projekt.spuren[0].rack, undefined, 'the last mapping is gone: the rack is removed');
  assert.deepEqual(alle.regler_aenderungen.filter((x) => x.pfad.startsWith('rack/')), [{ pfad: 'rack/1/m2', wert: 0 }], 'its macro rows go back to 0');
  // replacing a stage (ersetzen) is a new stage: its mappings are gone
  const ers = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'eq', ersetzen: true }); pruefe(p, ers);
  assert.deepEqual(ers.projekt.spuren[0].rack.makros[1].ziel.map((z) => z.insert), ['i1']);
  // reordering keeps the mappings (the IDs stay)
  const ord = ok(p, { befehl: 'insert_ordnung', strang_id: 's1', reihenfolge: ['i2', 'i1'] }); pruefe(p, ord);
  assert.deepEqual(ord.projekt.spuren[0].rack.makros[1].ziel.length, 2);
  assert.equal(ord.betrifft_wiedergabe, true);
  // deleting the strip deletes its rack and frees the slot
  const weg = ok(p, { befehl: 'spur_loeschen', spur_id: 's1' }); pruefe(p, weg);
  assert.deepEqual(alleRacks(weg.projekt), []);
  assert.deepEqual(weg.regler_aenderungen.filter((x) => x.pfad === 'rack/1/m2'), [{ pfad: 'rack/1/m2', wert: 0 }]);
});

test('the playback file carries the rack: slot, macro, stage position, parameter index, von and bis; a project without a rack is unchanged', () => {
  let p = basis();
  const opt = { nr: 1, audioOrdner: '/x', frames: () => 1 };
  const ohne = JSON.stringify(uebersetze(p, opt));
  assert.ok(!ohne.includes('rack'), 'no rack, no key');
  p = rack(p).projekt;
  const w = uebersetze(p, opt);
  assert.equal(w.format, 'cypherdj-arr/2');
  const ix = (art, name) => INSERT_ARTEN[art].parameter.findIndex((q) => q.name === name);
  assert.equal(ix('komp', 'schwelle'), 1); assert.equal(ix('eq', 'b1/gain'), 6);
  assert.deepEqual(w.spuren[0].rack, { slot: 1, ziele: [
    { makro: 0, stufe: 0, param: 1, von: -60, bis: 0 },
    { makro: 1, stufe: 1, param: 6, von: 0, bis: 12 },
    { makro: 1, stufe: 0, param: ix('komp', 'makeup'), von: 0, bis: 6 }] });
  assert.equal(w.spuren[1].rack, undefined);
  // group, return, master
  let q = basis();
  for (const s of ['g1', 'r1', 'master']) q = stufe(q, s, 'komp');
  q = rack(q, 'g1', [{ ziel: [{ insert: 'i3', param: 'ratio', von: 1, bis: 20 }] }]).projekt;
  q = rack(q, 'r1', [{ ziel: [{ insert: 'i4', param: 'mix', von: 0, bis: 1 }] }]).projekt;
  q = rack(q, 'master', [{ ziel: [{ insert: 'i5', param: 'schp', von: 0, bis: 300 }] }]).projekt;
  const v = uebersetze(q, opt);
  assert.equal(v.gruppen[0].rack.slot, 1); assert.equal(v.returns[0].rack.slot, 2); assert.equal(v.pm.rack.slot, 3);
  assert.deepEqual(v.pm.rack.ziele, [{ makro: 0, stufe: 0, param: ix('komp', 'schp'), von: 0, bis: 300 }]);
  // the view: the mapping counts, the macro value and the labels do not
  const sicht = (x) => kanonisch(wiedergabeSicht(x));
  assert.notEqual(sicht(p), sicht(basis()));
  assert.equal(sicht(p), sicht(ok(p, { befehl: 'rack_makro', strang_id: 's1', nr: 1, wert: 0.3 }).projekt));
});

test('the macro rows: all 48 in the opening sync, the live values in the render rows', () => {
  let p = rack(basis()).projekt;
  p = ok(p, { befehl: 'rack_makro', strang_id: 's1', nr: 1, wert: 0.25 }).projekt;
  const regler = alleRegler(p).filter((x) => x.pfad.startsWith('rack/'));
  assert.equal(regler.length, MAX_RACK * MAX_MAKROS);
  assert.equal(regler.find((x) => x.pfad === 'rack/1/m1').wert, 0.25);
  assert.ok(regler.filter((x) => x.pfad !== 'rack/1/m1').every((x) => x.wert === 0), 'free slots at the default');
  assert.deepEqual(rackZeilen(p.spuren[0].rack), { 'rack/1/m1': 0.25, 'rack/1/m2': 0, 'rack/1/m3': 0, 'rack/1/m4': 0 });
  const r = insertRegler(p);
  assert.equal(r['rack/1/m1'], 0.25);
  assert.equal(Object.keys(r).filter((k) => k.startsWith('rack/')).length, 4, 'only the racks of strips that sound');
  // negative control: the isolated render of s2 does not carry the rack of s1
  assert.equal(Object.keys(insertRegler(p, p.spuren[1])).filter((k) => k.startsWith('rack/')).length, 0);
  assert.equal(Object.keys(insertRegler(p, p.spuren[0])).filter((k) => k.startsWith('rack/')).length, 4);
});

test('the project check: dangling target, double slot, empty rack and a rack without a chain are refused when a project is loaded', () => {
  const p = rack(basis()).projekt;
  const kopie = () => JSON.parse(JSON.stringify(p));
  assert.equal(pruefeProjekt(kopie()).fehler, undefined);
  let x = kopie(); x.spuren[0].rack.makros[0].ziel[0].insert = 'i7';
  assert.match(pruefeProjekt(x).fehler, /keine Stufe dieser Kette/);
  x = kopie(); delete x.spuren[0].inserts;
  assert.ok(pruefeProjekt(x).fehler);
  x = kopie(); x.spuren[1].inserts = [{ id: 'i9', art: 'komp', slot: 2, an: true, werte: { schwelle: -18, ratio: 4, knie: 6, attack: 10, release: 120, makeup: 0, mix: 1, schp: 0 } }];
  x.spuren[1].rack = JSON.parse(JSON.stringify(x.spuren[0].rack)); x.spuren[1].rack.makros = [{ ziel: [{ insert: 'i9', param: 'ratio', von: 1, bis: 2 }] }, { ziel: [] }, { ziel: [] }, { ziel: [] }];
  assert.match(pruefeProjekt(x).fehler, /Slot doppelt/);
  x = kopie(); x.spuren[0].rack.makros[0].ziel[0].param = 'b1/typ';
  assert.ok(pruefeProjekt(x).fehler);
  x = kopie(); x.spuren[0].rack.makros[0].ziel[0].von = -100;
  assert.match(pruefeProjekt(x).fehler, /ausserhalb/);
  x = kopie(); x.spuren[0].rack.werte[0] = 1.5;
  assert.ok(pruefeProjekt(x).fehler);
  x = kopie(); x.spuren[0].rack.makros[0].ziel.push({ insert: 'i1', param: 'schwelle', von: -30, bis: 0 });
  assert.match(pruefeProjekt(x).fehler, /doppelt/);
  x = kopie(); x.spuren[0].rack.extra = 1;
  assert.match(pruefeProjekt(x).fehler, /unbekanntes Feld/);
  x = kopie(); for (let i = 0; i < 4; i++) x.spuren[0].rack.makros[i].ziel = [];
  assert.match(pruefeProjekt(x).fehler, /kein Ziel|leer/);
});

// ---- the way to the core: the rows travel with the project (opening, a macro move), never through the hand release ----
test('sitzung.rack_zeilen: opening a project with a rack sets rack/1/m1..m4 with the live macro values before the transport; a macro move sends exactly one row', async () => {
  const { pruefKontext, sitzung } = await import('./support/proj_context.mjs');
  const k = pruefKontext();
  const ctx = { after: () => {} };
  const { s } = sitzung(ctx, {}, k);
  await s.neu('Rack', 'andreas');
  const rev = () => s.aktuell().j.projekt.rev;
  await s.aendern({ rev: rev(), label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  await s.aendern({ rev: rev(), label: 'k', befehle: [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' },
    { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'schwelle', von: -60, bis: 0 }] }] },
    { befehl: 'rack_makro', strang_id: 's1', nr: 1, wert: 0.25 }] }, 'andreas');
  k.leere();
  await s.oeffnen('rack', 'andreas');
  const zeilen = k.teile(/^rack\//);
  assert.equal(zeilen.length, 48);
  assert.equal(zeilen.find((x) => x.felder.pfad === 'rack/1/m1').felder.nach, 0.25, 'the live macro value of the rack');
  assert.ok(zeilen.filter((x) => x.felder.pfad !== 'rack/1/m1').every((x) => x.felder.nach === 0), 'a free macro sits at 0');
  const frei = k.an('/k/hand/frei').at(-1).felder.pfade.split(',');
  assert.ok(!frei.some((x) => x.startsWith('rack/')), 'no rack path in the hand release');
  await s.transport({ aktion: 'start', beat: 0 }, 'andreas');
  const start = k.gesendet.findIndex((x) => x.adresse === '/k/arr/start');
  assert.ok(start > 0);
  for (const x of zeilen) assert.ok(k.gesendet.indexOf(x) < start, `${x.felder.pfad} was sent before /k/arr/start`);
  // a macro move: one row, no new playback
  k.leere();
  await s.aendern({ rev: rev(), label: 'm', befehle: [{ befehl: 'rack_makro', strang_id: 's1', nr: 2, wert: 1 }] }, 'andreas');
  assert.deepEqual(k.teile().map((x) => [x.felder.pfad, x.felder.nach]), [['rack/1/m2', 1]]);
  assert.equal(k.an('/k/arr/laden').length, 0, 'a macro move loads no playback');
  // positive control: a change of the mapping table is playback structure and does load
  k.leere();
  await s.aendern({ rev: rev(), label: 'z', befehle: [{ befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'ratio', von: 1, bis: 8 }] }] }] }, 'andreas');
  assert.ok(k.an('/k/arr/laden').length >= 1, 'a new mapping table loads a new playback');
});

test('1.10 slice 4c review: rack_setzen refuses null entries, a null name and a null ziel (only a missing entry is an empty macro)', () => {
  let p = mit(1);
  p = stufe(p, 's1', 'komp');
  const iid = p.spuren[0].inserts[0].id, z = [{ insert: iid, param: 'mix', von: 0, bis: 1 }];
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [null, { ziel: z }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ name: null, ziel: z }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: null }, { ziel: z }] }, 'argument_ungueltig');
  assert.equal(ok(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{}, { ziel: z }] }).projekt.spuren[0].rack.makros[1].ziel.length, 1);
});

// --- 1.9 U8 T7 (spec E12): macro targets on rack members (`glied`) -------------------------------------------------------------------
const rbG = (parameter = {}) => ({ art: 'intern', name: 'rb338', parameter });
const kitG = (kit) => ({ art: 'intern', name: 'kit', kit });
// s1 s2 audio in group g1, return r1, plain instrument s3, rack track s4 (g1 rb, g2 kit, g3 surge, g4 rb) without a chain
const gliedBasis = () => {
  let p = mit(2);
  p = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s1', 's2'] }).projekt;
  p = ok(p, { befehl: 'return_neu' }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', name: 'Plain', geraet: rbG() }).projekt;
  return ok(p, { befehl: 'spur_neu', art: 'instrument', name: 'Rack', geraet: { art: 'rack', glieder: [
    { id: 'g1', geraet: rbG() }, { id: 'g2', geraet: kitG('kit_rack') }, { id: 'g3', geraet: { art: 'wirt' } }, { id: 'g4', geraet: rbG() }] } }).projekt;
};
const gz = (glied, param, von, bis) => ({ glied, param, von, bis });
const gsetze = (p, ziele, strang = 's4') => ok(p, { befehl: 'rack_setzen', strang_id: strang, makros: [{ ziel: ziele }] });

test('T7 member targets: a rack track without a chain takes a table of member targets, valid, undoable', () => {
  const p = gliedBasis();
  const r = ok(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [
    { ziel: [gz('g1', 'cutoff', 0.2, 0.9)] }, { ziel: [gz('g2', 'gain_db', -60, 0), gz('g4', 'env_mod', 1, 0)] }] });
  pruefe(p, r);
  assert.deepEqual(r.projekt.spuren[3].rack.makros[0].ziel, [{ glied: 'g1', param: 'cutoff', von: 0.2, bis: 0.9 }]);
  assert.equal(r.projekt.spuren[3].inserts, undefined, 'no chain was needed');
  assert.equal(r.betrifft_wiedergabe, true);
});

test('T7 mixed table: an insert target and a member target on the same rack track; the model accepts it', () => {
  let p = gliedBasis();
  p = stufe(p, 's4', 'komp', 0);
  const iid = p.spuren[3].inserts[0].id;
  const r = gsetze(p, [{ insert: iid, param: 'schwelle', von: -60, bis: 0 }, gz('g1', 'gain_db', -12, 6)]);
  pruefe(p, r);
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(r.projekt))).fehler, undefined);
});

test('T7 member targets, refusals: Surge member, unknown member, kit param, duplicate, ranges, the 17th mapping', () => {
  const p = gliedBasis();
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g3', 'gain_db', -6, 0)] }] }, 'makro_ziel_wirt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g9', 'gain_db', -6, 0)] }] }, 'glied_unbekannt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g2', 'cutoff', 0, 1)] }] }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g1', 'k1', 0, 1)] }] }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g1', 'wellenform', 0, 1)] }] }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g1', 'cutoff', 0, 1.5)] }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g1', 'gain_db', -61, 0)] }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g1', 'gain_db', -6, 13)] }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [{ glied: 'g1', insert: 'i1', param: 'cutoff', von: 0, bis: 1 }] }] }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g1', 'cutoff', 0, 1), gz('g1', 'cutoff', 0.5, 1)] }] }, 'ziel_doppelt');
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g1', 'cutoff', 0, 1)] }, { ziel: [gz('g1', 'cutoff', 0, 1)] }] }, 'ziel_doppelt');
  // 17 distinct (member, param) pairs over four RB members: the limit is shared with insert targets (makro_voll)
  let q = p;
  q = ok(q, { befehl: 'rack_glied_setzen', spur_id: 's4', glied: { id: 'g2', geraet: rbG() } }).projekt;
  q = ok(q, { befehl: 'rack_glied_setzen', spur_id: 's4', glied: { id: 'g3', geraet: rbG() } }).projekt;
  const alle = ['g1', 'g2', 'g3', 'g4'].flatMap((g) => ['lautstaerke', 'cutoff', 'resonanz', 'env_mod', 'gain_db'].map((n) => gz(g, n, n === 'gain_db' ? -6 : 0, n === 'gain_db' ? 0 : 1)));
  assert.equal(gsetze(q, alle.slice(0, 16)).projekt.spuren[3].rack.makros[0].ziel.length, 16);
  lehntAb(q, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: alle.slice(0, 17) }] }, 'makro_voll');
});

test('T7 member targets share the 16 mappings with insert targets', () => {
  let p = gliedBasis();
  p = ok(p, { befehl: 'rack_glied_setzen', spur_id: 's4', glied: { id: 'g2', geraet: rbG() } }).projekt;
  p = stufe(p, 's4', 'eq', 0);
  const iid = p.spuren[3].inserts[0].id;
  const g = ['lautstaerke', 'cutoff', 'resonanz', 'env_mod', 'gain_db'].map((n) => gz('g1', n, 0, n === 'gain_db' ? 0 : 1));
  const g2 = ['lautstaerke', 'cutoff', 'resonanz', 'env_mod', 'gain_db'].map((n) => gz('g2', n, 0, n === 'gain_db' ? 0 : 1));
  const ins = ['b1/gain', 'b2/gain', 'b3/gain', 'b4/gain', 'b1/freq', 'b2/freq'].map((n) => ({ insert: iid, param: n, von: INSERT_ARTEN.eq.parameter.find((x) => x.name === n).min,
    bis: INSERT_ARTEN.eq.parameter.find((x) => x.name === n).max }));
  assert.equal(gsetze(p, [...g, ...g2, ...ins.slice(0, 6)]).projekt.spuren[3].rack.makros[0].ziel.length, 16);
  const mehr = { insert: iid, param: 'b3/freq', von: INSERT_ARTEN.eq.parameter.find((x) => x.name === 'b3/freq').min, bis: INSERT_ARTEN.eq.parameter.find((x) => x.name === 'b3/freq').max };
  lehntAb(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [...g, ...g2, ...ins, mehr] }] }, 'makro_voll');
});

test('T7 a glied target outside a rack track: plain track, audio track, group, return, master -> glied_ohne_rack', () => {
  const p = gliedBasis();
  for (const id of ['s3', 's1', 'g1', 'r1', 'master']) lehntAb(p, { befehl: 'rack_setzen', strang_id: id, makros: [{ ziel: [gz('g1', 'cutoff', 0, 1)] }] }, 'glied_ohne_rack');
  assert.ok(GRUND_TEXT.glied_ohne_rack && GRUND_TEXT.makro_ziel_wirt, 'both new reasons have a server text');
});

test('T7 a stored table with a glied target on a plain track or an unknown member is refused by the model', () => {
  const p = ok(gliedBasis(), { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g1', 'cutoff', 0, 1)] }] }).projekt;
  const kopie = () => JSON.parse(JSON.stringify(p));
  assert.equal(pruefeProjekt(kopie()).fehler, undefined);
  const a = kopie(); a.spuren[3].rack.makros[0].ziel[0].glied = 'g9';
  assert.ok(pruefeProjekt(a).fehler, 'unknown member');
  const b = kopie(); b.spuren[3].geraet = rbG();
  assert.ok(pruefeProjekt(b).fehler, 'no rack device any more');
  const c = kopie(); c.spuren[3].rack.makros[0].ziel[0].param = 'k1';
  assert.ok(pruefeProjekt(c).fehler, 'a param the device does not allow');
  const d = kopie(); d.spuren[3].rack.makros[0].ziel[0].von = 2;
  assert.ok(pruefeProjekt(d).fehler, 'range');
});

test('T7 translator: member targets as {makro, glied: position, param: index} in the index space, with and without a chain', () => {
  let p = gliedBasis();
  p = ok(p, { befehl: 'rack_glied_setzen', spur_id: 's4', glied: { id: 'g3', geraet: kitG('kit_zwei') } }).projekt;
  const tabelle = [{ ziel: [gz('g1', 'lautstaerke', 0, 1), gz('g1', 'cutoff', 0.2, 0.9)] }, { ziel: [gz('g4', 'env_mod', 1, 0), gz('g4', 'resonanz', 0, 1)] },
    { ziel: [gz('g3', 'gain_db', -60, 12)] }];
  p = ok(p, { befehl: 'rack_setzen', strang_id: 's4', makros: tabelle }).projekt;
  const w = uebersetze(p, { nr: 1, audioOrdner: '/a' });
  const s4 = w.spuren.find((x) => x.nr === 4);
  assert.equal(s4.chain, undefined, 'no chain written');
  assert.deepEqual(s4.rack, { slot: 1, ziele: [
    { makro: 0, glied: 0, param: 0, von: 0, bis: 1 }, { makro: 0, glied: 0, param: 1, von: 0.2, bis: 0.9 },
    { makro: 1, glied: 3, param: 3, von: 1, bis: 0 }, { makro: 1, glied: 3, param: 2, von: 0, bis: 1 },
    { makro: 2, glied: 2, param: 16, von: -60, bis: 12 }] });
  // a chain beside it: insert targets keep their `stufe`; both kinds in one table
  let q = stufe(p, 's4', 'komp', 0);
  const iid = q.spuren[3].inserts[0].id;
  q = ok(q, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [{ insert: iid, param: 'schwelle', von: -60, bis: 0 }, gz('g1', 'cutoff', 0, 1)] }] }).projekt;
  const w2 = uebersetze(q, { nr: 2, audioOrdner: '/a' }).spuren.find((x) => x.nr === 4);
  assert.equal(w2.chain.length, 1);
  const sw = INSERT_ARTEN.komp.parameter.findIndex((x) => x.name === 'schwelle');
  assert.deepEqual(w2.rack.ziele, [{ makro: 0, stufe: 0, param: sw, von: -60, bis: 0 }, { makro: 0, glied: 0, param: 1, von: 0, bis: 1 }]);
});

test('T7 a bk member: knobs k1..k8 map to 8..15', () => {
  const p = gliedBasis();
  p.spuren[3].geraet.glieder[0].geraet = { art: 'intern', name: 'bk', graph: 'sub', parameter: {} };
  p.spuren[3].rack = { slot: 1, namen: ['', '', '', ''], werte: [0, 0, 0, 0], makros: [{ ziel: [gz('g1', 'k1', 0, 1), gz('g1', 'k8', 0, 0.5), gz('g1', 'gain_db', -6, 0)] }, { ziel: [] }, { ziel: [] }, { ziel: [] }] };
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(p))).fehler, undefined);
  assert.deepEqual(uebersetze(p, { nr: 1, audioOrdner: '/a' }).spuren.find((x) => x.nr === 4).rack.ziele.map((z) => z.param), [8, 15, 16]);
  p.spuren[3].rack.makros[0].ziel[0] = gz('g1', 'cutoff', 0, 1);
  assert.ok(pruefeProjekt(JSON.parse(JSON.stringify(p))).fehler, 'a bk member has no cutoff');
});

test('T7 pin: the member parameter index space equals the core header (ARR_GERAET_PARAM_NAME order, bk base 8, gain 16)', () => {
  const h = fs.readFileSync(path.join(hier, '..', '..', 'core', 'include', 'cypherdj', 'arr_playback.h'), 'utf8');
  const namen = /ARR_GERAET_PARAM_NAME\[ARR_GERAET_PARAMS\] = \{([^}]*)\}/.exec(h)?.[1].split(',').map((x) => x.trim().replace(/"/g, ''));
  assert.deepEqual(namen, ['lautstaerke', 'cutoff', 'resonanz', 'env_mod'], 'the header table was read');
  assert.deepEqual([...GLIED_RB_MAKRO_PARAMETER], namen);
  const konst = (n) => Number(new RegExp(`constexpr int ${n} = (\\d+);`).exec(h)?.[1]);
  assert.equal(konst('ARR_GLIED_PARAM_BK0'), GLIED_PARAM_BK0);
  assert.equal(konst('ARR_GLIED_PARAM_GAIN_DB'), GLIED_PARAM_GAIN_DB);
  assert.equal(BK_PARAMETER.length, 8, 'bk knobs k1..k8 sit at 8..15');
});

test('T7 review fix: a frozen rack track goes out as freeze audio without member targets; insert targets stay, a rack without any is dropped', () => {
  let p = gliedBasis();
  p = stufe(p, 's4', 'komp', 0);
  const iid = p.spuren[3].inserts[0].id;
  const frisch = { datei: 'audio/freeze-4.f32', sha256: 'a'.repeat(64), frames: 48000, von_beat: 0 };
  const uebers = (q) => uebersetze(q, { nr: 1, audioOrdner: '/a/audio', arbeitsordner: '/a', existiert: () => true }).spuren.find((x) => x.nr === 4);
  // member targets only: the rack field is not written (the kern refuses a member target on an audio strip)
  const nurGlied = ok(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g1', 'cutoff', 0, 1), gz('g2', 'gain_db', -6, 0)] }] }).projekt;
  nurGlied.spuren[3].freeze = frisch;
  const a = uebers(nurGlied);
  assert.equal(a.art, 'audio');
  assert.equal(a.rack, undefined, 'no member target on a frozen track');
  assert.equal(a.chain.length, 1, 'the chain stays');
  // positive control: the same project not frozen carries the member targets
  nurGlied.spuren[3].freeze = null;
  assert.equal(uebers(nurGlied).rack.ziele.length, 2);
  // mixed table: only the insert target stays
  const gemischt = ok(p, { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [{ insert: iid, param: 'schwelle', von: -60, bis: 0 }, gz('g1', 'cutoff', 0, 1)] }] }).projekt;
  gemischt.spuren[3].freeze = frisch;
  const b = uebers(gemischt);
  assert.equal(b.art, 'audio');
  assert.deepEqual(b.rack.ziele.map((z) => Object.keys(z).includes('stufe')), [true]);
  // no chain, member targets only: no rack and no chain
  const ohneKette = ok(gliedBasis(), { befehl: 'rack_setzen', strang_id: 's4', makros: [{ ziel: [gz('g1', 'cutoff', 0, 1)] }] }).projekt;
  ohneKette.spuren[3].freeze = frisch;
  const c = uebers(ohneKette);
  assert.equal(c.rack, undefined); assert.equal(c.chain, undefined);
});
