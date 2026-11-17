// Catalog reader: protected filter and priority order (media browser slice 1, task 1)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Katalog } from '../catalog.ts';
import { baueKatalog } from './support/catalog.mjs';

function bau(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vorrang-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const da = path.join(dir, 'da'); fs.mkdirSync(da);
  const weg = path.join(dir, 'weg');
  const zeilen = [
    { n: 1, typ: 'oneshot', name: 'a', instrument: 'kick', pfad: path.join(weg, 'a.wav') },
    { n: 2, typ: 'oneshot', name: 'b', instrument: 'kick', pfad: path.join(da, 'b.wav') },
    { n: 3, typ: 'oneshot', name: 'c', instrument: 'snare', pfad: path.join(da, 'c.wav') },
    { n: 4, typ: 'oneshot', name: 'p', instrument: 'pad', schutz: 'ableton', pfad: path.join(da, 'p.wav') },
  ];
  return { k: new Katalog(baueKatalog(dir, zeilen)), da, weg };
}
const namen = (r) => r.zeilen.map((z) => z.name);

test('seite: ohneSchutz drops protected rows from page and count', (t) => {
  const { k } = bau(t);
  const r = k.seite('oneshot', { ohneSchutz: true }, 'name', false, 0, 100);
  assert.equal(r.gesamt, 3);
  assert.ok(!namen(r).includes('p'));
  assert.equal(k.seite('oneshot', {}, 'name', false, 0, 100).gesamt, 4, 'without the flag the row stays');
});

test('seite: vorrang puts reachable folders first, then rank, then the sort column', (t) => {
  const { k, weg } = bau(t);
  const shaC = k.seite('oneshot', {}, 'name', false, 0, 100).zeilen.find((z) => z.name === 'c').sha;
  const vorrang = { fehlend: [path.dirname(path.join(weg, 'a.wav'))], rang: new Map([[shaC, 0]]) };
  assert.deepEqual(namen(k.seite('oneshot', { ohneSchutz: true }, 'name', false, 0, 100, vorrang)), ['c', 'b', 'a']);
  const nurFehlend = { fehlend: [weg], rang: new Map() };
  assert.deepEqual(namen(k.seite('oneshot', { ohneSchutz: true }, 'name', false, 0, 100, nurFehlend)), ['b', 'c', 'a'], 'reachable first, then the column');
  assert.deepEqual(namen(k.seite('oneshot', { ohneSchutz: true }, 'name', true, 0, 100, nurFehlend)), ['c', 'b', 'a'], 'direction applies behind the priority');
});

test('seite: all folders reachable and no rank gives the order without vorrang, for every sort column and direction', (t) => {
  const { k } = bau(t);
  const leer = { fehlend: [], rang: new Map() };
  for (const sort of ['name', 'instrument', 'pack', 'dauer']) for (const ab of [false, true]) {
    const mit = k.seite('oneshot', { ohneSchutz: true }, sort, ab, 0, 100, leer), ohne = k.seite('oneshot', { ohneSchutz: true }, sort, ab, 0, 100);
    assert.deepEqual(mit.zeilen.map((z) => z.id), ohne.zeilen.map((z) => z.id), `${sort} ${ab}`);
    assert.equal(mit.gesamt, ohne.gesamt);
  }
});

test('seite: a rank alone puts ranked rows first (rank ascending), the rest by column', (t) => {
  const { k } = bau(t);
  const sha = (n) => k.seite('oneshot', {}, 'name', false, 0, 100).zeilen.find((z) => z.name === n).sha;
  const r = { fehlend: [], rang: new Map([[sha('c'), 2], [sha('b'), 1]]) };
  assert.deepEqual(namen(k.seite('oneshot', { ohneSchutz: true }, 'name', false, 0, 100, r)), ['b', 'c', 'a']);
});

test('seite: without vorrang the order stays the column order', (t) => {
  const { k } = bau(t);
  assert.deepEqual(namen(k.seite('oneshot', { ohneSchutz: true }, 'name', false, 0, 100)), ['a', 'b', 'c']);
});

test('seite: vorrang paging stays stable across pages', (t) => {
  const { k, weg } = bau(t);
  const v = { fehlend: [weg], rang: new Map() };
  const s0 = k.seite('oneshot', { ohneSchutz: true }, 'name', false, 0, 2, v), s1 = k.seite('oneshot', { ohneSchutz: true }, 'name', false, 1, 2, v);
  assert.deepEqual([...namen(s0), ...namen(s1)], ['b', 'c', 'a']);
  assert.equal(s1.gesamt, 3);
});

test('baum: ohneSchutz leaves protected rows out of folders and facets', (t) => {
  const { k } = bau(t);
  const mit = k.baum('oneshot'), ohne = k.baum('oneshot', { ohneSchutz: true });
  assert.ok(mit.facetten.instrument.some((x) => x.wert === 'pad'));
  assert.ok(!ohne.facetten.instrument.some((x) => x.wert === 'pad'));
  assert.equal(ohne.ordner.reduce((s, o) => s + o.n, 0), 3);
  assert.equal(mit.ordner.reduce((s, o) => s + o.n, 0), 4);
});

test('seite: the four groups (reachable/missing x ranked/unranked) page like one sorted list, for every page size', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vorrang4-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ordner = ['da1', 'weg1', 'da2', 'weg2'].map((x) => path.join(dir, x));
  const zeilen = [];
  for (let i = 0; i < 24; i++) zeilen.push({ n: 100 + i, typ: 'oneshot', name: `n${String(i).padStart(2, '0')}`, pfad: path.join(ordner[i % 4], `n${i}.wav`) });
  zeilen.push({ n: 200, typ: 'oneshot', name: 'ohne-ordner', pfad: null, ordner: null });
  const k = new Katalog(baueKatalog(path.join(dir, 'kat'), zeilen));
  const alle = k.seite('oneshot', {}, 'name', false, 0, 100).zeilen;
  const rang = new Map([[alle[3].sha, 0], [alle[4].sha, 1], [alle[9].sha, 2], [alle[10].sha, 5], [alle[20].sha, 3], [alle[24].sha, 4]]);
  const fehlend = [ordner[1], ordner[3]];
  const weg = (z) => z.ordner === null || fehlend.includes(z.ordner);
  const soll = [...alle].sort((a, b) => Number(weg(a)) - Number(weg(b)) || (rang.get(a.sha) ?? 1000) - (rang.get(b.sha) ?? 1000) || (a.name < b.name ? -1 : 1)).map((z) => z.name);
  for (const v of [{ fehlend, rang }, { fehlend, rang: new Map() }, { fehlend: [], rang }]) {
    const erwartet = v.fehlend.length === 0 && v.rang.size > 0
      ? [...alle].sort((a, b) => (v.rang.get(a.sha) ?? 1000) - (v.rang.get(b.sha) ?? 1000) || (a.name < b.name ? -1 : 1)).map((z) => z.name)
      : v.rang.size === 0
        ? [...alle].sort((a, b) => Number(weg(a)) - Number(weg(b)) || (a.name < b.name ? -1 : 1)).map((z) => z.name) : soll;
    for (const limit of [1, 3, 7, 25, 100]) {
      const got = [];
      for (let s = 0; s * limit < alle.length + limit; s++) got.push(...k.seite('oneshot', {}, 'name', false, s, limit, v).zeilen.map((z) => z.name));
      assert.deepEqual(got, erwartet, `limit ${limit}, fehlend ${v.fehlend.length}, rang ${v.rang.size}`);
    }
  }
});
