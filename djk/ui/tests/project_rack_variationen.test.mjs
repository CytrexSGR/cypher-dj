// Package 1.9 U8 T10 (spec E13, E14, AK-M3): macro variations on strand racks. Pure project calculation, no server, no core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, kanonisch, wiedergabeSicht } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import path from 'node:path';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { tmpOrdner } from './support/project.mjs';
import { grundCode } from '../areas/proj/mapping.ts';
import { GRUND_TEXT } from '../http/reasons.ts';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 110)}`);
const json = (x) => JSON.stringify(x);
const MAKROS = [{ name: 'Duck', ziel: [{ insert: 'i1', param: 'schwelle', von: -60, bis: 0 }] }];
// track s1 with a compressor and a rack; track s2 without rack; a group g1 with a rack as well
const basis = () => {
  let p = neuesProjekt('T');
  for (const n of ['A', 'B']) p = ok(p, { befehl: 'spur_neu', art: 'audio', name: n }).projekt;
  p = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }).projekt;
  return ok(p, { befehl: 'rack_setzen', strang_id: 's1', makros: MAKROS }).projekt;
};
const werte = (p) => p.spuren[0].rack.werte;
const bewege = (p, w) => w.reduce((q, x, i) => ok(q, { befehl: 'rack_makro', strang_id: 's1', nr: i + 1, wert: x }).projekt, p);
const speichere = (p, name) => ok(p, { befehl: 'makro_variation_speichern', strang_id: 's1', name });
const lade = (p, name) => ok(p, { befehl: 'makro_variation_laden', strang_id: 's1', name });

test('AK-M3: save, move, load restores exactly, the undo of the load restores the moved values', (t) => {
  const a = bewege(basis(), [0.1, 0.2, 0.3, 0.4]);
  const s = speichere(a, 'warm');
  assert.deepEqual(s.projekt.spuren[0].rack.variationen, [{ name: 'warm', werte: [0.1, 0.2, 0.3, 0.4] }]);
  assert.equal(s.betrifft_wiedergabe, false);
  assert.equal(json(wende(s.projekt, s.zurueck)), json(a), 'undo of the save');
  assert.equal(pruefeProjekt(JSON.parse(json(s.projekt))).fehler, undefined);
  const bewegt = bewege(s.projekt, [0.9, 0.8, 0.7, 0.6]);
  const l = lade(bewegt, 'warm');
  assert.deepEqual(werte(l.projekt), [0.1, 0.2, 0.3, 0.4]);
  assert.equal(l.betrifft_wiedergabe, false, 'a load is a control change');
  assert.deepEqual(l.regler_aenderungen.map((x) => x.pfad).sort(), ['rack/1/m1', 'rack/1/m2', 'rack/1/m3', 'rack/1/m4']);
  assert.deepEqual(werte(wende(l.projekt, l.zurueck)), [0.9, 0.8, 0.7, 0.6]);
  assert.deepEqual(wiedergabeSicht(l.projekt), wiedergabeSicht(bewegt));
  // one undo step through the history
  const h = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { zeitgeber: false });
  const r = aendere(h, bewegt, [{ befehl: 'makro_variation_laden', strang_id: 's1', name: 'warm' }], { quelle: 'andreas', label: 'x' });
  assert.deepEqual(werte(r.projekt), [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(werte(rueckgaengig(h, r.projekt, { quelle: 'andreas' }).projekt), [0.9, 0.8, 0.7, 0.6]);
});

test('load: fast path equals general path', () => {
  const p = bewege(speichere(bewege(basis(), [0.5, 0.5, 0.5, 0.5]), 'v').projekt, [0.9, 0, 0, 0]);
  const b = [{ befehl: 'makro_variation_laden', strang_id: 's1', name: 'v' }];
  const l = fuehreListeAus(p, b), v = fuehreListeAus(p, b, { voll: true });
  assert.deepEqual(l.vor, v.vor); assert.deepEqual(l.zurueck, v.zurueck); assert.deepEqual(l.regler_aenderungen, v.regler_aenderungen);
  assert.equal(kanonisch(l.projekt), kanonisch(v.projekt));
  assert.equal(p.spuren[0].rack.variationen.length, 1, 'input untouched');
});

test('save replaces an existing name in place; the ninth distinct name is refused; delete frees a place and the last delete drops the field', () => {
  let p = basis();
  for (let i = 1; i <= 8; i++) p = speichere(bewege(p, [i / 10, 0, 0, 0]), `v${i}`).projekt;
  assert.equal(p.spuren[0].rack.variationen.length, 8);
  lehntAb(p, { befehl: 'makro_variation_speichern', strang_id: 's1', name: 'v9' }, 'variation_voll');
  const ers = speichere(bewege(p, [0, 0.5, 0, 0]), 'v3').projekt.spuren[0].rack.variationen;
  assert.equal(ers.length, 8);
  assert.deepEqual(ers[2], { name: 'v3', werte: [0, 0.5, 0, 0] });
  let q = p;
  for (let i = 1; i <= 8; i++) q = ok(q, { befehl: 'makro_variation_loeschen', strang_id: 's1', name: `v${i}` }).projekt;
  assert.equal('variationen' in q.spuren[0].rack, false, 'never written when empty');
  const d = ok(p, { befehl: 'makro_variation_loeschen', strang_id: 's1', name: 'v1' });
  assert.equal(d.projekt.spuren[0].rack.variationen.length, 7);
  assert.equal(json(wende(d.projekt, d.zurueck)), json(p));
  assert.equal(speichere(d.projekt, 'neu').projekt.spuren[0].rack.variationen.length, 8);
});

test('variations survive rack_setzen and work on a group', () => {
  const p = speichere(bewege(basis(), [0.3, 0, 0, 0]), 'keep').projekt;
  assert.equal(p.spuren[0].rack.variationen.length, 1);
  const q = ok(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ name: 'X', ziel: [{ insert: 'i1', param: 'ratio', von: 1, bis: 8 }] }] }).projekt;
  assert.deepEqual(q.spuren[0].rack.variationen, [{ name: 'keep', werte: [0.3, 0, 0, 0] }]);
  let g = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s1', 's2'] }).projekt;
  g = ok(g, { befehl: 'insert_setzen', strang_id: 'g1', pos: 0, art: 'komp' }).projekt;
  const id = g.gruppen[0].inserts[0].id;
  g = ok(g, { befehl: 'rack_setzen', strang_id: 'g1', makros: [{ ziel: [{ insert: id, param: 'ratio', von: 1, bis: 8 }] }] }).projekt;
  g = ok(g, { befehl: 'makro_variation_speichern', strang_id: 'g1', name: 'grp' }).projekt;
  assert.equal(g.gruppen[0].rack.variationen[0].name, 'grp');
});

test('error cases', () => {
  const p = speichere(basis(), 'a').projekt;
  lehntAb(p, { befehl: 'makro_variation_laden', strang_id: 's1', name: 'nope' }, 'variation_unbekannt');
  lehntAb(p, { befehl: 'makro_variation_loeschen', strang_id: 's1', name: 'nope' }, 'variation_unbekannt');
  lehntAb(basis(), { befehl: 'makro_variation_laden', strang_id: 's1', name: 'a' }, 'variation_unbekannt');
  for (const b of ['makro_variation_speichern', 'makro_variation_laden', 'makro_variation_loeschen']) {
    lehntAb(p, { befehl: b, strang_id: 's2', name: 'a' }, 'rack_unbekannt');
    lehntAb(p, { befehl: b, strang_id: 'zz', name: 'a' }, 'spur_unbekannt');
    lehntAb(p, { befehl: b, strang_id: 's1', name: '' }, 'argument_ungueltig');
    lehntAb(p, { befehl: b, strang_id: 's1', name: 'x'.repeat(33) }, 'argument_ungueltig');
    lehntAb(p, { befehl: b, strang_id: 's1' }, 'argument_ungueltig');
    lehntAb(p, { befehl: b, strang_id: 's1', name: 'a', foo: 1 }, 'argument_unbekannt');
  }
  assert.equal(speichere(p, 'x'.repeat(32)).projekt.spuren[0].rack.variationen.length, 2);
  assert.equal(grundCode('variation_unbekannt'), 404);
  for (const g of ['variation_voll', 'variation_unbekannt']) assert.match(GRUND_TEXT[g] ?? '', /^[\x20-\x7e]+$/, g);
});

test('file check: invalid variations are refused', () => {
  const p = speichere(basis(), 'a').projekt;
  const mit = (v) => { const q = JSON.parse(json(p)); q.spuren[0].rack.variationen = v; return pruefeProjekt(q); };
  assert.equal(mit([{ name: 'a', werte: [0, 0, 0, 0] }]).fehler, undefined);
  for (const v of [[], 'x', [{ name: 'a', werte: [0, 0, 0] }], [{ name: 'a', werte: [0, 0, 0, 2] }], [{ name: '', werte: [0, 0, 0, 0] }],
    [{ name: 'a', werte: [0, 0, 0, 0] }, { name: 'a', werte: [0, 0, 0, 0] }], [{ name: 'a', werte: [0, 0, 0, 0], x: 1 }],
    Array.from({ length: 9 }, (_, i) => ({ name: `n${i}`, werte: [0, 0, 0, 0] }))]) {
    assert.ok(mit(v).fehler, JSON.stringify(v).slice(0, 60));
  }
  const alt = JSON.parse(json(p)); alt.format = 'cypherdj-projekt/1';
  assert.ok(pruefeProjekt(alt).fehler, '/1 files refuse racks and so variations');
});
