// The table of hand tool classes covers exactly the tools of hand.ts, and its details point at real code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handQuelle } from './support/hand_source.mjs';
import { HAND_KLASSEN, RANG, klasseVon } from '../../ui/http/hand_klassen.ts';

const zeilen = handQuelle().split('\n');
const starts = [];
zeilen.forEach((z, i) => { if (z.startsWith("  { name: '")) starts.push([z.slice(11).split("'")[0], i]); });
const block = (name) => {
  const k = starts.findIndex(([n]) => n === name);
  const bis = k + 1 < starts.length ? starts[k + 1][1] : zeilen.length;
  return zeilen.slice(starts[k][1], bis).join('\n');
};

test('every tool has a class and no class is left over', () => {
  const imCode = starts.map(([n]) => n);
  const fehlt = imCode.filter((n) => !(n in HAND_KLASSEN));
  const zuviel = Object.keys(HAND_KLASSEN).filter((n) => !imCode.includes(n));
  assert.deepEqual({ fehlt, zuviel }, { fehlt: [], zuviel: [] }, 'a new tool needs a class in djk/ui/http/hand_klassen.ts');
});

test('every aktion and lesendePost points into the source block of its tool', () => {
  for (const [n, e] of Object.entries(HAND_KLASSEN)) {
    const q = block(n);
    for (const a of Object.keys(e.aktionen ?? {})) assert.ok(q.includes(`'${a}'`), `${n}: aktion '${a}' not in its source`);
    for (const p of e.lesendePost ?? []) assert.ok(q.includes(p), `${n}: path ${p} not in its source`);
  }
});

test('art and warum only on zerstoerend, and every destructive entry has a reason', () => {
  const alle = [];
  for (const [n, e] of Object.entries(HAND_KLASSEN)) {
    alle.push([n, e]);
    for (const [a, k] of Object.entries(e.aktionen ?? {})) alle.push([`${n}.${a}`, k]);
  }
  for (const [n, k] of alle) {
    assert.ok(k.stufe in RANG, `${n}: unknown level`);
    if (k.stufe === 'zerstoerend') assert.ok(k.art && k.warum, `${n}: destructive needs art and warum`);
    else assert.ok(!k.art && !k.warum, `${n}: art or warum on a non-destructive class`);
  }
});

test('klasseVon: aktion override, entry, unknown', () => {
  assert.equal(klasseVon('lage').stufe, 'lesen');
  assert.equal(klasseVon('seq', 'stand').stufe, 'lesen');
  assert.equal(klasseVon('seq', 'unbekannt').stufe, 'schreiben');
  assert.equal(klasseVon('seq', 'leeren').art, 'loescht');
  assert.equal(klasseVon('deck_stopp').art, 'stoppt_klang');
  assert.equal(klasseVon('proj_export').art, 'exportiert');
  assert.equal(klasseVon('gibt_es_nicht'), null);
});
