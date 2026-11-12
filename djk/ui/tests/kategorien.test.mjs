// kategorien.json: category and one-line description of every instrument graph; served on GET /graphen entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listeGraphen, ladeKategorien, pruefeKategorien, KATEGORIE_IDS } from '../graphs.ts';
import { pfadeVon } from '../devices_parameter.ts';
import { REPO } from '../paths.ts';

const P = pfadeVon(REPO);
const kat = JSON.parse(fs.readFileSync(P.kategorien, 'utf8'));

test('kategorien.json covers every instrument graph of beispiele/ with a valid category and a text of at most 90 characters', () => {
  const inst = listeGraphen(P.beispiele).graphen.filter((g) => g.art === 'instrument').map((g) => g.name);
  assert.ok(inst.length >= 50, `${inst.length} instrument graphs`);
  for (const n of inst) {
    assert.ok(kat[n], `${n} has no entry`);
    assert.ok(KATEGORIE_IDS.includes(kat[n].kategorie), `${n}: ${kat[n].kategorie}`);
    assert.ok(typeof kat[n].text === 'string' && kat[n].text.length > 0 && kat[n].text.length <= 90, `${n}: text length ${kat[n].text?.length}`);
    assert.ok(!kat[n].text.includes('—'), `${n}: no em dash`);
  }
  assert.deepEqual(Object.keys(kat).filter((n) => !inst.includes(n)), [], 'no entry for a graph that is not an instrument');
  assert.deepEqual(pruefeKategorien(kat).fehler, []);
});

test('GET /graphen entries carry kategorie and text for instruments from <graph folder>/panels/kategorien.json; none without the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kat-'));
  try {
    const inst = { knoten: [{ id: 'a', art: 'note' }] }, fx = { knoten: [{ id: 'e', art: 'eingang' }] };
    fs.writeFileSync(path.join(dir, 'x-inst.json'), JSON.stringify(inst));
    fs.writeFileSync(path.join(dir, 'x-fx.json'), JSON.stringify(fx));
    fs.writeFileSync(path.join(dir, 'y-inst.json'), JSON.stringify(inst));
    assert.deepEqual(listeGraphen(dir).graphen.map((g) => Object.keys(g)), [['name', 'art', 'regler_namen'], ['name', 'art', 'regler_namen'], ['name', 'art', 'regler_namen']]);
    fs.mkdirSync(path.join(dir, 'panels'));
    fs.writeFileSync(path.join(dir, 'panels', 'kategorien.json'), JSON.stringify({ 'x-inst': { kategorie: 'bass', text: 'A bass.' }, 'x-fx': { kategorie: 'bass', text: 'ignored for effects' }, 'y-inst': { kategorie: 'nope', text: 'bad category' } }));
    const g = Object.fromEntries(listeGraphen(dir).graphen.map((e) => [e.name, e]));
    assert.equal(g['x-inst'].kategorie, 'bass');
    assert.equal(g['x-inst'].text, 'A bass.');
    assert.equal(g['x-fx'].kategorie, undefined, 'effects have no category');
    assert.equal(g['y-inst'].kategorie, undefined, 'an invalid entry is left out');
    assert.deepEqual(Object.keys(ladeKategorien(dir)), ['x-inst', 'x-fx']);
    fs.writeFileSync(path.join(dir, 'panels', 'kategorien.json'), '{kaputt');
    assert.deepEqual(ladeKategorien(dir), {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('djk-start installs kategorien.json into the panels folder with the cmp rule', () => {
  const sh = fs.readFileSync(path.join(REPO, 'djk', 'start', 'djk-start'), 'utf8');
  assert.match(sh, /kategorien\.json/);
  assert.match(sh, /cmp -s -- "\$kat" "\$ziel"/);
});
