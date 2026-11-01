// S17 task 1: the sound snapshot field `baukasten` in the project model. Plan 2026-11-01-baukasten-s17.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { neuesProjekt, pruefeFehler } from '../projekt/modell.ts';
import { BK_KANAELE, BK_GRAPH_NAME, bkKanalVon, bkDefVonId } from '../projekt/baukasten.ts';
import { GRAPH_NAME } from '../graphen.ts';
import { Projekte } from '../projekt/ablage.ts';
import { specProjekt, tmpOrdner } from './hilfen/projekt.mjs';

const gueltig = () => {
  const p = neuesProjekt('T');
  p.baukasten = [
    { id: 'erz2', graph: 'juno-pad-dyn', regler: [0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5] },
    { id: 'deck1', graph: 'fx-bandecho', regler: Array(8).fill(0.5), sha256: 'a'.repeat(64) },
  ];
  return p;
};

test('S17 T1.1 a valid snapshot is accepted', () => {
  assert.equal(pruefeFehler(gueltig()), null);
});

test('S17 T1.2 every refusal from the valid case by one changed field', () => {
  const faelle = [
    ['id with slash', (p) => { p.baukasten[0].id = 'erz/2'; }],
    ['id not in the table', (p) => { p.baukasten[0].id = 'erz4'; }],
    ['empty graph', (p) => { p.baukasten[0].graph = ''; }],
    ['graph with upper case', (p) => { p.baukasten[0].graph = 'Lead'; }],
    ['regler length 7', (p) => { p.baukasten[0].regler = Array(7).fill(0.5); }],
    ['regler value 1.5', (p) => { p.baukasten[0].regler[2] = 1.5; }],
    ['regler value NaN', (p) => { p.baukasten[0].regler[2] = NaN; }],
    ['regler value -0.1', (p) => { p.baukasten[0].regler[0] = -0.1; }],
    ['sha256 xyz', (p) => { p.baukasten[1].sha256 = 'xyz'; }],
    ['duplicate id', (p) => { p.baukasten[1].id = 'erz2'; }],
    ['empty list', (p) => { p.baukasten = []; }],
    ['unknown key', (p) => { p.baukasten[0].extra = 1; }],
    ['not a list', (p) => { p.baukasten = {}; }],
  ];
  for (const [name, mut] of faelle) {
    const p = gueltig(); mut(p);
    const f = pruefeFehler(p);
    assert.match(f ?? '', /baukasten/, `${name} must be refused (got ${f})`);
    assert.equal(pruefeFehler(gueltig()), null, `control for ${name}: valid`);
  }
  const grenzen = gueltig(); grenzen.baukasten[0].regler = [0, 1, 0, 1, 0, 1, 0, 1];
  assert.equal(pruefeFehler(grenzen), null, 'bounds 0 and 1 inclusive');
});

test('S17 T1.3 a /1 file with baukasten has an unknown field', () => {
  const alt = specProjekt();
  assert.equal(pruefeFehler(alt), null, 'negative control: /1 without it is valid');
  alt.baukasten = [{ id: 'erz2', graph: 'x', regler: Array(8).fill(0.5) }];
  assert.match(pruefeFehler(alt) ?? '', /baukasten.*unbekanntes Feld/);
});

test('S17 T1.4 an old project stays byte-identical through open and save', (t) => {
  const wurzel = tmpOrdner(t);
  const pr = new Projekte(wurzel);
  const { slug } = pr.lege('Alt');
  const datei = path.join(wurzel, slug, 'project.json');
  const b0 = fs.readFileSync(datei);
  const o = pr.oeffne(slug);
  pr.speichere(slug, o.projekt);
  o.verlauf.schliesse();
  assert.ok(fs.readFileSync(datei).equals(b0), 'bytes unchanged');
  assert.equal('baukasten' in JSON.parse(b0.toString()), false);
});

test('S17 T1.5 the BK_KANAELE table', () => {
  const ids = BK_KANAELE.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const d of BK_KANAELE) {
    assert.ok(!d.id.includes('/'), `${d.id} has no slash`);
    assert.equal(bkKanalVon(d.kanal)?.id, d.id); assert.equal(bkDefVonId(d.id)?.kanal, d.kanal);
  }
  assert.deepEqual(BK_KANAELE.filter((d) => !d.regler).map((d) => d.id), ['fx3', 'fx4']);
  assert.deepEqual(BK_KANAELE.filter((d) => d.vorgabe).map((d) => d.id), ['erz2', 'erz3', 'deck1', 'deck2', 'deck3', 'deck4']);
  assert.deepEqual(ids.slice().sort(), ['deck1', 'deck2', 'deck3', 'deck4', 'erz2', 'erz3', 'erz5', 'erz6', 'erz7', 'fx3', 'fx4', 'pad1', 'pad2']);
  assert.equal(BK_GRAPH_NAME.source, GRAPH_NAME.source, 'the two name rules cannot drift');
  assert.equal(bkKanalVon('erz/4'), null);
});
